"use server";

import { ServerId } from "@/lib/prisma-cdr";
import {
    getTimelineDataRaw,
    getHeatmapDataRaw,
    getConcurrentCallsData,
    getQueueTimelineDataRaw,
    getQueueHeatmapDataRaw,
    getGlobalMetricsRaw,
    getGlobalMetricsByOriginRaw,
    getTimelineByOriginRaw,
    getHeatmapByOriginRaw,
    type GlobalMetricsByOriginRow,
    type TimelineByOriginRow,
} from "@/services/repositories/cdr.repository";
import { resolveAccessScope, unrestrictedScope, type AccessScope } from "@/lib/access-scope";
import { weekAlignedPreviousPeriod } from "@/services/domain/period-comparison";
// Le toggle Externe/Interne se traduit en SENS d'appels (ORIGIN_SENS) : la
// même constante alimente les requêtes groupées ET les liens KPI → journaux.
import { ORIGIN_SENS } from "@/services/domain/call-aggregation";
import type { CallOrigin } from "@/services/domain/call-classification";
import type { DashboardDirection } from "@/services/domain/call-aggregation";
import type {
    GlobalMetrics,
    TimelineDataPoint,
    HeatmapDataPoint,
    ConcurrentCallsDataPoint,
    ConcurrentCallsSummary,
} from "@/services/domain/call.types";
import { getServerTimezone, getServerLicenceThreshold, getServerTrunkThreshold } from "@/lib/servers";

interface ApiGlobalResponse {
    totalCalls: number;
    answeredCalls: number;
    missedCalls: number;
    voicemailCalls: number;
    busyCalls: number;
    avgDurationSeconds: number;
    avgWaitTimeSeconds: number;
    avgAgentsPerCall: number;
    agentsDistribution: { agents1: number; agents2: number; agents3Plus: number };
    previousPeriod: {
        totalCalls: number;
        answeredCalls: number;
        missedCalls: number;
        voicemailCalls: number;
        busyCalls: number;
        avgDurationSeconds: number;
        avgWaitTimeSeconds: number;
        avgAgentsPerCall: number;
        agentsDistribution: { agents1: number; agents2: number; agents3Plus: number };
    } | null;
}

/**
 * Portée applicable au dashboard : TOUJOURS filtrée par périmètre.
 * L'option « Voir les chiffres de l'entreprise » a disparu en août 2026 —
 * chacun voit les chiffres de son périmètre, sans exception (ADMIN/MODERATOR
 * gardent leur portée globale par leur rôle, pas par une permission à part).
 */
async function resolveDashboardScope(serverId: ServerId): Promise<AccessScope> {
    return resolveAccessScope(serverId);
}

export async function getGlobalMetrics(
    serverId: ServerId,
    startDate: Date,
    endDate: Date,
    direction: DashboardDirection = "inbound",
    origin: CallOrigin = "both"
): Promise<GlobalMetrics> {
    const scope = await resolveDashboardScope(serverId);

    // Période N-1 de même durée, se terminant juste avant le début de la période.
    const durationMs = endDate.getTime() - startDate.getTime();
    const prevEnd = new Date(startDate.getTime() - 1);
    const prevStart = new Date(prevEnd.getTime() - durationMs);

    // Requête locale filtrée (l'API interne, elle, n'est pas consciente du périmètre).
    // Exécution SÉQUENTIELLE, comme le faisait la route : cette requête est lourde
    // (sous-requête corrélée par appel) et la paralléliser aggrave la contention.
    const current = await getGlobalMetricsRaw(serverId, startDate, endDate, scope, direction, origin);
    const previous = await getGlobalMetricsRaw(serverId, prevStart, prevEnd, scope, direction, origin);

    const num = (v: string | null) => Number(v) || 0;
    const apiData: ApiGlobalResponse = {
        totalCalls: Number(current.total_calls),
        answeredCalls: Number(current.answered_calls),
        missedCalls: Number(current.missed_calls),
        voicemailCalls: Number(current.voicemail_calls),
        busyCalls: Number(current.busy_calls),
        avgDurationSeconds: num(current.avg_human_duration),
        avgWaitTimeSeconds: num(current.avg_wait_time),
        avgAgentsPerCall: num(current.avg_agents_per_call),
        agentsDistribution: {
            agents1: Number(current.agents_1),
            agents2: Number(current.agents_2),
            agents3Plus: Number(current.agents_3_plus),
        },
        previousPeriod: {
            totalCalls: Number(previous.total_calls),
            answeredCalls: Number(previous.answered_calls),
            missedCalls: Number(previous.missed_calls),
            voicemailCalls: Number(previous.voicemail_calls),
            busyCalls: Number(previous.busy_calls),
            avgDurationSeconds: num(previous.avg_human_duration),
            avgWaitTimeSeconds: num(previous.avg_wait_time),
            avgAgentsPerCall: num(previous.avg_agents_per_call),
            agentsDistribution: {
                agents1: Number(previous.agents_1),
                agents2: Number(previous.agents_2),
                agents3Plus: Number(previous.agents_3_plus),
            },
        },
    };

    const totalCalls = apiData.totalCalls;
    const answeredCalls = apiData.answeredCalls;
    const answerRate = totalCalls > 0 ? (answeredCalls / totalCalls) * 100 : 0;

    const prev = apiData.previousPeriod;
    const prevTotalCalls = prev?.totalCalls || 0;
    const prevAnsweredCalls = prev?.answeredCalls || 0;
    const prevAnswerRate = prevTotalCalls > 0 ? (prevAnsweredCalls / prevTotalCalls) * 100 : 0;

    return {
        totalCalls,
        answeredCalls,
        missedCalls: apiData.missedCalls,
        voicemailCalls: apiData.voicemailCalls,
        busyCalls: apiData.busyCalls,
        avgDurationSeconds: apiData.avgDurationSeconds,
        answerRate: Math.round(answerRate * 10) / 10,
        avgWaitTimeSeconds: apiData.avgWaitTimeSeconds,
        avgAgentsPerCall: apiData.avgAgentsPerCall,
        prevTotalCalls,
        prevAnsweredCalls,
        prevMissedCalls: prev?.missedCalls || 0,
        prevVoicemailCalls: prev?.voicemailCalls || 0,
        prevBusyCalls: prev?.busyCalls || 0,
        prevAvgDurationSeconds: prev?.avgDurationSeconds || 0,
        prevAnswerRate: Math.round(prevAnswerRate * 10) / 10,
        prevAvgWaitTimeSeconds: prev?.avgWaitTimeSeconds || 0,
        prevAvgAgentsPerCall: prev?.avgAgentsPerCall || 0,
        agentsDistribution: {
            oneAgent: apiData.agentsDistribution.agents1,
            twoAgents: apiData.agentsDistribution.agents2,
            threePlusAgents: apiData.agentsDistribution.agents3Plus,
        },
    };
}

// ============================================
// LES TROIS PROVENANCES EN UN CHARGEMENT
// ============================================

/** Ce que le tableau de bord affiche pour UNE provenance. */
export interface DashboardOriginBundle {
    metrics: GlobalMetrics;
    timelineData: TimelineDataPoint[];
    heatmapData: HeatmapDataPoint[];
}

const ALL_ORIGINS: CallOrigin[] = ["external", "internal", "both"];

/** Compteurs d'une variante, composés depuis les lignes par classe. */
function composeMetrics(rows: GlobalMetricsByOriginRow[], classes: readonly string[]) {
    const picked = rows.filter((r) => classes.includes(r.direction_class));
    const sum = (f: (r: GlobalMetricsByOriginRow) => number) => picked.reduce((a, r) => a + f(r), 0);
    const totalCalls = sum((r) => Number(r.total_calls));
    const talkCount = sum((r) => Number(r.talk_count));
    const waitCount = sum((r) => Number(r.wait_count));
    const agentsCount = sum((r) => Number(r.agents_count));
    return {
        totalCalls,
        answeredCalls: sum((r) => Number(r.answered_calls)),
        missedCalls: sum((r) => Number(r.missed_calls)),
        voicemailCalls: sum((r) => Number(r.voicemail_calls)),
        busyCalls: sum((r) => Number(r.busy_calls)),
        // Moyennes recomposées en pondérant par les effectifs : c'est pour cela
        // que les lignes par classe voyagent en (somme, effectif).
        avgDurationSeconds: talkCount > 0 ? Math.round((sum((r) => Number(r.talk_sum ?? 0)) / talkCount) * 10) / 10 : 0,
        avgWaitTimeSeconds: waitCount > 0 ? Math.round((sum((r) => Number(r.wait_sum ?? 0)) / waitCount) * 10) / 10 : 0,
        avgAgentsPerCall: agentsCount > 0 ? Math.round((sum((r) => Number(r.agents_sum ?? 0)) / agentsCount) * 100) / 100 : 0,
        agents1: sum((r) => Number(r.agents_1)),
        agents2: sum((r) => Number(r.agents_2)),
        agents3Plus: sum((r) => Number(r.agents_3_plus)),
    };
}

function timelineLabel(date: Date, interval: "hour" | "day"): string {
    if (interval === "hour") return `${String(date.getUTCHours()).padStart(2, "0")}:00`;
    return `${String(date.getUTCDate()).padStart(2, "0")}/${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Courbe d'une variante : sommes par point de date, sur les classes retenues. */
function composeTimeline(
    rows: TimelineByOriginRow[],
    classes: readonly string[],
    interval: "hour" | "day"
): TimelineDataPoint[] {
    const byDate = new Map<number, { date: Date; answered: number; missed: number }>();
    for (const row of rows) {
        if (!classes.includes(row.direction_class)) continue;
        const date = new Date(row.date_group);
        const key = date.getTime();
        const entry = byDate.get(key) ?? { date, answered: 0, missed: 0 };
        entry.answered += Number(row.answered);
        entry.missed += Number(row.missed);
        byDate.set(key, entry);
    }
    return [...byDate.values()]
        .sort((a, b) => a.date.getTime() - b.date.getTime())
        .map((e) => ({
            date: e.date.toISOString(),
            label: timelineLabel(e.date, interval),
            answered: e.answered,
            missed: e.missed,
        }));
}

/**
 * Les trois variantes de provenance du tableau de bord en UN chargement.
 *
 * Les requêtes sont groupées par classe de direction et composées ici : le
 * coût est celui d'UNE variante (mesuré : ~2,5 s de métriques par variante en
 * exécution séparée), et le toggle entier devient consultable d'un coup — plus
 * de préchargement séquentiel ni de spinners qui traînent.
 */
export async function getDashboardAllOrigins(
    serverId: ServerId,
    startDate: Date,
    endDate: Date
): Promise<Record<CallOrigin, DashboardOriginBundle>> {
    const scope = await resolveDashboardScope(serverId);
    const timezone = await getServerTimezone(serverId);

    const durationMs = endDate.getTime() - startDate.getTime();
    const prevEnd = new Date(startDate.getTime() - 1);
    const prevStart = new Date(prevEnd.getTime() - durationMs);

    const diffDays = durationMs / (1000 * 60 * 60 * 24);
    const interval: "hour" | "day" = diffDays <= 2 ? "hour" : "day";

    // Métriques N puis N-1 en SÉQUENCE (requêtes lourdes qui se contentionnent
    // en parallèle) ; la courbe et la heatmap, plus légères, en parallèle.
    const [metricsRows, timelineRows, heatmapRows] = await Promise.all([
        getGlobalMetricsByOriginRaw(serverId, startDate, endDate, scope),
        getTimelineByOriginRaw(serverId, startDate, endDate, timezone, scope),
        getHeatmapByOriginRaw(serverId, startDate, endDate, timezone, scope),
    ]);
    const prevMetricsRows = await getGlobalMetricsByOriginRaw(serverId, prevStart, prevEnd, scope);

    const result = {} as Record<CallOrigin, DashboardOriginBundle>;
    for (const origin of ALL_ORIGINS) {
        const classes: readonly string[] = ORIGIN_SENS[origin];
        const cur = composeMetrics(metricsRows, classes);
        const prev = composeMetrics(prevMetricsRows, classes);

        // Courbe : sommes par point de date, sur les classes de la variante.
        const timelineData = composeTimeline(timelineRows, classes, interval);

        // Heatmap : mêmes sommes, par case (jour × heure).
        const byCell = new Map<string, HeatmapDataPoint>();
        for (const row of heatmapRows) {
            if (!classes.includes(row.direction_class)) continue;
            const key = `${row.day_of_week}|${row.hour_of_day}`;
            const cell = byCell.get(key) ?? { dayOfWeek: row.day_of_week, hourOfDay: row.hour_of_day, value: 0 };
            cell.value += Number(row.volume);
            byCell.set(key, cell);
        }

        const answerRate = cur.totalCalls > 0 ? (cur.answeredCalls / cur.totalCalls) * 100 : 0;
        const prevAnswerRate = prev.totalCalls > 0 ? (prev.answeredCalls / prev.totalCalls) * 100 : 0;

        result[origin] = {
            metrics: {
                totalCalls: cur.totalCalls,
                answeredCalls: cur.answeredCalls,
                missedCalls: cur.missedCalls,
                voicemailCalls: cur.voicemailCalls,
                busyCalls: cur.busyCalls,
                avgDurationSeconds: cur.avgDurationSeconds,
                answerRate: Math.round(answerRate * 10) / 10,
                avgWaitTimeSeconds: cur.avgWaitTimeSeconds,
                avgAgentsPerCall: cur.avgAgentsPerCall,
                prevTotalCalls: prev.totalCalls,
                prevAnsweredCalls: prev.answeredCalls,
                prevMissedCalls: prev.missedCalls,
                prevVoicemailCalls: prev.voicemailCalls,
                prevBusyCalls: prev.busyCalls,
                prevAvgDurationSeconds: prev.avgDurationSeconds,
                prevAnswerRate: Math.round(prevAnswerRate * 10) / 10,
                prevAvgWaitTimeSeconds: prev.avgWaitTimeSeconds,
                prevAvgAgentsPerCall: prev.avgAgentsPerCall,
                agentsDistribution: {
                    oneAgent: cur.agents1,
                    twoAgents: cur.agents2,
                    threePlusAgents: cur.agents3Plus,
                },
            },
            timelineData,
            heatmapData: [...byCell.values()],
        };
    }
    return result;
}

/**
 * Courbes N-1 du tableau de bord, pour la superposition du graphique — les
 * trois provenances d'un coup, préchargées en tâche de fond à côté du
 * chargement principal : le toggle « Période précédente » s'active à leur
 * arrivée, sans jamais faire attendre l'activation.
 *
 * Période précédente ALIGNÉE SEMAINE (cf. period-comparison) : le trafic est
 * hebdomadaire, la superposition doit faire tomber les lundis sur des lundis —
 * ce n'est PAS la définition des flèches N-1 des vignettes, et c'est voulu.
 */
export async function getPrevTimelineAllOrigins(
    serverId: ServerId,
    startDate: Date,
    endDate: Date
): Promise<Record<CallOrigin, TimelineDataPoint[]>> {
    const scope = await resolveDashboardScope(serverId);
    const timezone = await getServerTimezone(serverId);
    const prev = weekAlignedPreviousPeriod(startDate, endDate);

    // Même granularité que la courbe N (durées identiques par construction).
    const diffDays = (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24);
    const interval: "hour" | "day" = diffDays <= 2 ? "hour" : "day";

    const rows = await getTimelineByOriginRaw(serverId, prev.startDate, prev.endDate, timezone, scope);
    const result = {} as Record<CallOrigin, TimelineDataPoint[]>;
    for (const origin of ALL_ORIGINS) {
        result[origin] = composeTimeline(rows, ORIGIN_SENS[origin], interval);
    }
    return result;
}

export async function getTimelineData(
    serverId: ServerId,
    startDate: Date,
    endDate: Date,
    direction: DashboardDirection = "inbound",
    origin: CallOrigin = "both"
): Promise<TimelineDataPoint[]> {
    const diffMs = endDate.getTime() - startDate.getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    const interval = diffDays <= 2 ? "hour" : "day";
    const timezone = await getServerTimezone(serverId);
    const scope = await resolveDashboardScope(serverId);

    const rawData = await getTimelineDataRaw(serverId, startDate, endDate, timezone, scope, direction, origin);

    return rawData.map((row) => {
        const date = new Date(row.date_group);
        let label = "";
        if (interval === "hour") {
            label = `${String(date.getUTCHours()).padStart(2, "0")}:00`;
        } else {
            label = `${String(date.getUTCDate()).padStart(2, "0")}/${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
        }
        return {
            date: date.toISOString(),
            label,
            answered: Number(row.answered),
            missed: Number(row.missed),
        };
    });
}

export async function getHeatmapData(
    serverId: ServerId,
    startDate: Date,
    endDate: Date,
    direction: DashboardDirection = "inbound",
    origin: CallOrigin = "both"
): Promise<HeatmapDataPoint[]> {
    const timezone = await getServerTimezone(serverId);
    const scope = await resolveDashboardScope(serverId);
    const rawData = await getHeatmapDataRaw(serverId, startDate, endDate, timezone, undefined, scope, direction, origin);
    return rawData.map((row) => ({
        dayOfWeek: row.day_of_week,
        hourOfDay: row.hour_of_day,
        value: Number(row.volume),
    }));
}

export async function getQueueTimelineData(
    serverId: ServerId,
    queueNumber: string,
    startDate: Date,
    endDate: Date,
    origin: CallOrigin = "both"
): Promise<TimelineDataPoint[]> {
    const diffMs = endDate.getTime() - startDate.getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    const interval = diffDays <= 2 ? "hour" : "day";
    const timezone = await getServerTimezone(serverId);

    const rawData = await getQueueTimelineDataRaw(serverId, queueNumber, startDate, endDate, timezone, origin);

    return rawData.map((row) => {
        const date = new Date(row.date_group);
        let label = "";
        if (interval === "hour") {
            label = `${String(date.getUTCHours()).padStart(2, "0")}:00`;
        } else {
            label = `${String(date.getUTCDate()).padStart(2, "0")}/${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
        }
        return {
            date: date.toISOString(),
            label,
            answered: Number(row.answered),
            missed: Number(row.missed),
            overflow: row.overflow === undefined ? undefined : Number(row.overflow),
        };
    });
}

export async function getQueueHeatmapData(
    serverId: ServerId,
    queueNumber: string,
    startDate: Date,
    endDate: Date,
    origin: CallOrigin = "both"
): Promise<HeatmapDataPoint[]> {
    const timezone = await getServerTimezone(serverId);
    const rawData = await getQueueHeatmapDataRaw(serverId, queueNumber, startDate, endDate, timezone, origin);
    return rawData.map((row) => ({
        dayOfWeek: row.day_of_week,
        hourOfDay: row.hour_of_day,
        value: Number(row.volume),
    }));
}

export async function getConcurrentCallsChartData(
    serverId: ServerId,
    startDate: Date,
    endDate: Date
): Promise<{ data: ConcurrentCallsDataPoint[]; summary: ConcurrentCallsSummary }> {
    const timezone = await getServerTimezone(serverId);
    // Monitoring de LICENCE : la seule vue d'INFRASTRUCTURE de l'application.
    // Elle compte les appels simultanés de la machine — clients hébergés
    // compris, puisque ce sont eux qui occupent les lignes 3CX facturées.
    // La borner au périmètre sous-estimerait la consommation réelle.
    const rawData = await getConcurrentCallsData(serverId, startDate, endDate, timezone, unrestrictedScope());
    const threshold = await getServerLicenceThreshold(serverId);
    const trunkThreshold = await getServerTrunkThreshold(serverId);

    const data: ConcurrentCallsDataPoint[] = rawData.map((row) => {
        const date = new Date(row.timestamp);
        const diffMs = endDate.getTime() - startDate.getTime();
        const diffDays = diffMs / (1000 * 60 * 60 * 24);

        let label: string;
        if (diffDays <= 1) {
            label = `${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")}`;
        } else if (diffDays <= 7) {
            label = `${String(date.getUTCDate()).padStart(2, "0")}/${String(date.getUTCMonth() + 1).padStart(2, "0")} ${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")}`;
        } else {
            label = `${String(date.getUTCDate()).padStart(2, "0")}/${String(date.getUTCMonth() + 1).padStart(2, "0")} ${String(date.getUTCHours()).padStart(2, "0")}h`;
        }

        return {
            timestamp: date.toISOString(),
            label,
            concurrentCalls: Number(row.concurrent_calls),
        };
    });

    let peak = 0;
    let peakTime = "";
    let sum = 0;

    for (const point of data) {
        sum += point.concurrentCalls;
        if (point.concurrentCalls > peak) {
            peak = point.concurrentCalls;
            peakTime = point.timestamp;
        }
    }

    const avg = data.length > 0 ? Math.round(sum / data.length) : 0;

    return {
        data,
        summary: { peak, peakTime, avg, threshold, trunkThreshold },
    };
}
