"use server";

import { ServerId } from "@/lib/prisma-cdr";
import { logger } from "@/lib/logger";
import { resolveAccessScope, isQueueInScope } from "@/lib/access-scope";
import {
    getQueueName,
    getQueueDepartment,
} from "@/services/repositories/cdr.repository";
import { getAnnuaireXapi } from "@/services/queue-directory.service";
import { cleAgent, getProfilsCollaborateurs } from "@/services/collaborator-profile.service";
import {
    getQueueTimelineData,
    getQueueHeatmapData,
} from "@/services/dashboard.service";
import type {
    QueueStatistics,
    QueueKPIs,
    AgentStats,
    OverflowDestination,
} from "@/services/domain/call.types";
import type { CallOrigin, PassageOutcome } from "@/services/domain/call-classification";
import { getClassificationRules } from "@/lib/classification-rules";
import { previousPeriod, weekAlignedPreviousPeriod } from "@/services/domain/period-comparison";
import type { TimelineDataPoint } from "@/services/domain/call.types";

const INTERNAL_API_URL = process.env.INTERNAL_API_URL || "http://localhost:3000";
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || "";

/**
 * Délai au-delà duquel un appel interne est abandonné.
 *
 * Sans borne explicite, `fetch` laisse courir jusqu'à son propre délai de
 * 300 s puis échoue par un laconique « fetch failed » — cinq minutes d'attente
 * pour un écran qui, jusqu'au lot 2, ne montrait alors rien du tout. Après la
 * correction des requêtes du 26 août 2026, la pire fenêtre mesurée coûte
 * quelques secondes : 45 s laissent une marge confortable tout en transformant
 * un incident en message, et non plus en attente indéfinie.
 */
const INTERNAL_API_TIMEOUT_MS = 45_000;

async function fetchApi<T>(endpoint: string, params: Record<string, string>): Promise<T> {
    const url = new URL(`${INTERNAL_API_URL}${endpoint}`);
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));

    logger.debug("[fetchApi] Calling:", url.toString());

    let res: Response;
    try {
        res = await fetch(url.toString(), {
            headers: { "X-API-Key": INTERNAL_API_KEY },
            signal: AbortSignal.timeout(INTERNAL_API_TIMEOUT_MS),
        });
    } catch (error) {
        // Un dépassement doit se lire comme tel : « fetch failed » ne dit ni
        // ce qui a échoué, ni qu'il s'agit d'une question de durée.
        const depassement = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
        logger.error("[fetchApi] Échec réseau :", { endpoint, url: url.toString(), depassement, error });
        throw new Error(depassement
            ? `Le calcul a dépassé ${INTERNAL_API_TIMEOUT_MS / 1000} s. Réduisez la période demandée, puis réessayez.`
            : `Les données n'ont pas pu être récupérées (${endpoint}).`);
    }

    if (!res.ok) {
        const errorText = await res.text().catch(() => "Unknown error");
        logger.error("[fetchApi] Error:", { status: res.status, error: errorText, url: url.toString() });
        throw new Error(`API ${endpoint} returned ${res.status}: ${errorText}`);
    }

    const data = await res.json() as T;
    logger.debug("[fetchApi] Success:", { endpoint, data });
    return data;
}

interface ApiQueueResponse {
    queueNumber: string;
    queueName: string;
    callsReceived: number;
    callsAnswered: number;
    callsAbandoned: number;
    callsShortAbandon: number;
    callsToVoicemail: number;
    outcomeCounts: Record<PassageOutcome, number>;
    abandonedBefore10s: number;
    abandonedAfter10s: number;
    callsOverflow: number;
    callsHandedOff: number;
    totalPassages: number;
    pingPongCount: number;
    pingPongPercentage: number;
    avgWaitTimeSeconds: number;
    avgTalkTimeSeconds: number;
    directReceived: number;
    directAnswered: number;
    directHandedOff: number;
    directOverflow: number;
    directLost: number;
    classificationRules?: { handedOffInPerformance?: "success" | "neutral" };
    overflowDestinations: Array<{ destination: string; destinationName: string; count: number }>;
}

interface ApiAgentResponse {
    agents: Array<{
        extension: string;
        name: string;
        callsReceived: number;
        answered: number;
        queueTransferred: number;
        queueTalkTimeSeconds: number;
        directReceived: number;
        directAnswered: number;
        directTransferred: number;
        directTalkTimeSeconds: number;
    }>;
    queueNumber: string;
}

export async function getQueueStatistics(
    serverId: ServerId,
    queueNumber: string,
    startDate: Date,
    endDate: Date,
    // Provenance (toggle Externe / Interne / Les deux) : transmise à TOUTES les
    // sous-requêtes — vignettes, agents, tendances, courbe, heatmap — pour que
    // l'écran entier décrive la même population.
    origin: CallOrigin = "both"
): Promise<QueueStatistics> {
    // Une file hors périmètre doit être refusée même si son numéro est deviné :
    // masquer l'entrée du sélecteur ne suffit pas.
    const scope = await resolveAccessScope(serverId);
    if (!isQueueInScope(scope, queueNumber)) {
        throw new Error("Cette file d'attente n'est pas dans votre périmètre");
    }

    // Nom et département : l'annuaire du PBX passe devant quand il connaît la
    // file, les appels prennent le relais sinon (cf. queue-directory.service).
    const [nomCdr, departementCdr, annuaire, kpis, agents, timelineData, heatmapData] = await Promise.all([
        getQueueName(serverId, queueNumber),
        getQueueDepartment(serverId, queueNumber),
        getAnnuaireXapi(serverId),
        computeQueueKPIs(serverId, queueNumber, startDate, endDate, origin),
        computeAgentStats(serverId, queueNumber, startDate, endDate, origin),
        getQueueTimelineData(serverId, queueNumber, startDate, endDate, origin),
        getQueueHeatmapData(serverId, queueNumber, startDate, endDate, origin),
    ]);

    const profils = await getProfilsCollaborateurs(serverId, agents, { start: startDate, end: endDate });

    return {
        queueNumber,
        queueName: annuaire?.get(queueNumber)?.queueName || nomCdr,
        queueDepartment: annuaire?.get(queueNumber)?.department ?? departementCdr,
        period: {
            start: startDate.toISOString(),
            end: endDate.toISOString(),
        },
        kpis,
        // Titre de poste et photo, résolus par POSTE + NOM dans le journal des
        // collaborateurs : les noms d'époque du tableau ne se voient jamais
        // attribuer le visage du titulaire actuel d'un poste réattribué.
        agents: agents.map((a) => ({ ...a, ...(profils.get(cleAgent(a)) ?? {}) })),
        timelineData,
        heatmapData,
    };
}

/**
 * KPIs seuls d'une file — pour les cartes de l'aperçu des groupes.
 *
 * MÊME route d'API que l'écran détail (computeQueueKPIs) : une carte et le
 * détail qu'elle ouvre affichent les mêmes chiffres par construction. Les
 * sous-requêtes lourdes du détail (agents, courbes, heatmap) ne sont pas
 * exécutées ici.
 */
export async function getQueueOverviewKpis(
    serverId: ServerId,
    queueNumber: string,
    startDate: Date,
    endDate: Date,
    origin: CallOrigin = "both"
): Promise<QueueKPIs> {
    const scope = await resolveAccessScope(serverId);
    if (!isQueueInScope(scope, queueNumber)) {
        throw new Error("Cette file d'attente n'est pas dans votre périmètre");
    }
    return computeQueueKPIs(serverId, queueNumber, startDate, endDate, origin);
}

/**
 * KPI et stats agents de la période N-1 — pour les flèches de tendance du
 * bilan d'équipe (vignettes, prise en charge, % de participation du tableau).
 *
 * Période de MÊME DURÉE juste avant (previousPeriod) : la même définition que
 * les flèches des cartes d'aperçu — la carte et le bilan qu'elle ouvre
 * racontent la même histoire. Un seul aller-retour pour les deux volets,
 * préchargé en tâche de fond par l'écran (cf. fetchIntoCache).
 */
export async function getQueuePreviousStats(
    serverId: ServerId,
    queueNumber: string,
    startDate: Date,
    endDate: Date,
    origin: CallOrigin = "both"
): Promise<{ kpis: QueueKPIs; agents: AgentStats[] }> {
    const scope = await resolveAccessScope(serverId);
    if (!isQueueInScope(scope, queueNumber)) {
        throw new Error("Cette file d'attente n'est pas dans votre périmètre");
    }
    const prev = previousPeriod(startDate, endDate);
    const [kpis, agents] = await Promise.all([
        computeQueueKPIs(serverId, queueNumber, prev.startDate, prev.endDate, origin),
        computeAgentStats(serverId, queueNumber, prev.startDate, prev.endDate, origin),
    ]);
    return { kpis, agents };
}

/**
 * Courbe N-1 d'une file, pour la superposition du graphique d'évolution —
 * préchargée en tâche de fond avec les statistiques de la provenance : le
 * toggle « Période précédente » s'active à son arrivée.
 *
 * Période ALIGNÉE SEMAINE (cf. period-comparison), PAS la définition des
 * flèches des cartes : superposer un lundi sur un samedi rendrait la courbe
 * pointillée illisible, le trafic étant hebdomadaire.
 */
export async function getQueuePreviousTimeline(
    serverId: ServerId,
    queueNumber: string,
    startDate: Date,
    endDate: Date,
    origin: CallOrigin = "both"
): Promise<TimelineDataPoint[]> {
    const scope = await resolveAccessScope(serverId);
    if (!isQueueInScope(scope, queueNumber)) {
        throw new Error("Cette file d'attente n'est pas dans votre périmètre");
    }
    const prev = weekAlignedPreviousPeriod(startDate, endDate);
    return getQueueTimelineData(serverId, queueNumber, prev.startDate, prev.endDate, origin);
}

async function computeQueueKPIs(
    serverId: ServerId,
    queueNumber: string,
    startDate: Date,
    endDate: Date,
    origin: CallOrigin = "both"
): Promise<QueueKPIs> {
    const apiData = await fetchApi<ApiQueueResponse>("/api/analytics/queue", {
        server: serverId,
        queueNumber,
        start: startDate.toISOString(),
        end: endDate.toISOString(),
        origin,
    });

    const teamDirectReceived = apiData.directReceived;
    const teamDirectAnswered = apiData.directAnswered;
    const teamQueueAnswered = apiData.callsAnswered;
    const totalAnswered = teamQueueAnswered + teamDirectAnswered;

    const overflowDestinations: OverflowDestination[] = apiData.overflowDestinations.map((d) => ({
        destination: d.destination,
        destinationName: d.destinationName,
        count: d.count,
    }));

    return {
        callsReceived: apiData.callsReceived,
        callsAnswered: teamQueueAnswered,
        callsAbandoned: apiData.callsAbandoned,
        abandonedBefore10s: apiData.abandonedBefore10s,
        abandonedAfter10s: apiData.abandonedAfter10s,
        callsShortAbandon: apiData.callsShortAbandon,
        callsToVoicemail: apiData.callsToVoicemail,
        outcomeCounts: apiData.outcomeCounts,
        callsOverflow: apiData.callsOverflow,
        callsHandedOff: apiData.callsHandedOff,
        totalPassages: apiData.totalPassages,
        pingPongCount: apiData.pingPongCount,
        pingPongPercentage: apiData.pingPongPercentage,
        teamDirectReceived,
        teamDirectAnswered,
        directHandedOff: apiData.directHandedOff,
        directOverflow: apiData.directOverflow,
        directLost: apiData.directLost,
        handedOffInPerformance: apiData.classificationRules?.handedOffInPerformance ?? "success",
        overflowDestinations,
        avgWaitTimeSeconds: apiData.avgWaitTimeSeconds,
        avgTalkTimeSeconds: apiData.avgTalkTimeSeconds,
    };
}

async function computeAgentStats(
    serverId: ServerId,
    queueNumber: string,
    startDate: Date,
    endDate: Date,
    origin: CallOrigin = "both"
): Promise<AgentStats[]> {
    const apiData = await fetchApi<ApiAgentResponse>("/api/analytics/agents", {
        server: serverId,
        queueNumber,
        start: startDate.toISOString(),
        end: endDate.toISOString(),
        origin,
    });

    // Le taux d'un agent suit la même définition que la barre d'équipe : un
    // transfert accompli est une prise en charge (règle handedOffInPerformance).
    const rules = await getClassificationRules();
    const handedOffCounts = rules.handedOffInPerformance === "success";

    return apiData.agents.map((agent) => {
        const totalReceived = agent.callsReceived + agent.directReceived;
        const totalAnswered = agent.answered + agent.directAnswered;
        const totalTransferred = agent.queueTransferred + agent.directTransferred;
        const totalHandled = totalAnswered + (handedOffCounts ? totalTransferred : 0);

        return {
            extension: agent.extension,
            name: agent.name,
            callsReceived: agent.callsReceived,
            answered: agent.answered,
            queueTransferred: agent.queueTransferred,
            directReceived: agent.directReceived,
            directAnswered: agent.directAnswered,
            directTransferred: agent.directTransferred,
            directTalkTimeSeconds: agent.directTalkTimeSeconds,
            answerRate: totalReceived > 0 ? Math.round((totalHandled / totalReceived) * 100) : 0,
            avgHandlingTimeSeconds: totalAnswered > 0
                ? Math.round((agent.queueTalkTimeSeconds + agent.directTalkTimeSeconds) / totalAnswered)
                : 0,
            totalHandlingTimeSeconds: agent.queueTalkTimeSeconds + agent.directTalkTimeSeconds,
        };
    });
}
