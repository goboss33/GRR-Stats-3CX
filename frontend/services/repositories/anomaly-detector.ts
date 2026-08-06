/**
 * Détection d'anomalies pour la cloche d'alertes — le DÉTECTEUR.
 * Module serveur ordinaire (pas « use server ») : rien ici n'est invocable
 * depuis le client, le résultat n'étant pas filtré par périmètre.
 *
 * Première (et pour l'instant seule) famille d'anomalies : la DÉCONNEXION DE
 * LA FILE. L'état temps réel du bouton « Q » de la 3CX n'existe pas dans les
 * CDR ; on détecte donc sa SIGNATURE comportementale sur une fenêtre
 * glissante (réglage `notificationWindowDays`, onglet Alertes des réglages).
 *
 * Le principe qui limite le bruit : un poste sollicité par N'IMPORTE QUELLE
 * file sur la fenêtre est « casé » — une équipe l'a. L'anomalie ne concerne
 * que les postes ACTIFS (appels décrochés ou émis) mais sollicités NULLE
 * PART, rapportés aux files qui les sollicitaient encore il y a moins d'un
 * an. Ce discriminant permet un horizon d'appartenance long (des équipes
 * restent déconnectées des mois — cas fondateur : GD NYON, novembre à août)
 * sans faire de bruit sur les changements d'équipe : l'agent parti ailleurs
 * est sollicité par sa nouvelle file, donc « casé ». Angle mort assumé : un
 * agent censé être dans DEUX files mais connecté à une seule n'est pas signalé.
 *
 * - « équipe déconnectée » : la file n'a sollicité personne sur la fenêtre et
 *   au moins un membre est actif-nulle-part. Le croisement avec la présence
 *   élimine le faux positif des congés (silencieux partout = pas d'alerte).
 * - « agent déconnecté » : la file distribue (au-dessus du plancher), mais un
 *   membre actif-nulle-part n'a reçu aucune sollicitation. « Probable » : une
 *   distribution séquentielle sollicite inégalement.
 * - « statut Absent oublié » : les appels directs du poste sont renvoyés pour
 *   cause d'absence (creation_forward_reason = 'away' sur le segment enfant
 *   du renvoi) de façon répétée, alors que le poste montre une activité
 *   FRAÎCHE (dernier signe de vie ≤ AWAY_PRESENCE_FRESH_DAYS). La fraîcheur
 *   est LE discriminant des départs en vacances (cas réel, ext 651) : on
 *   boucle ses derniers appels, on passe Absent, on part — l'activité CESSE
 *   pendant que les renvois continuent. À l'inverse, un statut oublié au
 *   retour (cas réel, ext 561) entrelace renvois et signes de vie. Un poste
 *   à signature Absent n'émet JAMAIS d'alerte « déconnecté » : le statut
 *   explique la non-sollicitation — soit Absent oublié (activité fraîche),
 *   soit rien (vacances).
 *
 * Les noms affichés sont ceux du TITULAIRE ACTUEL du poste (dernier segment
 * connu) : une alerte décrit le présent — contrairement aux statistiques de
 * période, qui portent le nom de l'époque (cf. route analytics/agents).
 *
 * Les alertes sont SANS ÉTAT : recalculées (avec cache) à la lecture, elles
 * disparaissent d'elles-mêmes quand l'anomalie cesse — décision d'août 2026,
 * pas d'acquittement pour l'instant.
 */

import { getPrismaCdr, ServerId } from "@/lib/prisma-cdr";
import { getQueueMembersRaw } from "@/services/repositories/cdr.repository";
import { logger } from "@/lib/logger";

export type AnomalyAlert = {
    id: string;
    type: "queue_disconnected" | "agent_disconnected" | "away_forgotten";
    queueNumber: string;
    queueName: string;
    /** Renseignés pour `agent_disconnected` uniquement. */
    agentExtension?: string;
    agentName?: string;
    /** Dernière sollicitation connue de la file vers ce membre (ou l'équipe). */
    lastPollAt: string | null;
    /** Membres concernés — actifs mais sollicités nulle part (pour `queue_disconnected`). */
    activeMembers?: Array<{ extension: string; name: string }>;
};

/** Un lien file↔agent plus vieux que ça n'engage plus l'équipe. Long à
 *  dessein : des équipes restent déconnectées des mois, et le bruit des
 *  changements d'équipe est déjà éliminé par le discriminant « sollicité
 *  ailleurs ». Constante interne — la fenêtre d'OBSERVATION est un réglage. */
const MEMBERSHIP_HORIZON_DAYS = 365;

/** En-dessous de ce volume de sollicitations de la file sur la fenêtre, le
 *  silence envers UN agent ne prouve rien (distribution séquentielle). */
const AGENT_POLL_FLOOR = 5;

/** Signature « Absent oublié » : au moins N renvois 'away', étalés sur au
 *  moins M jours distincts — un après-midi d'absence ne déclenche rien. */
const AWAY_MIN_CALLS = 3;
const AWAY_MIN_DAYS = 3;

/** Fraîcheur exigée du dernier signe de vie pour « Absent oublié » : 4 jours
 *  — assez long pour survivre à un week-end, assez court pour qu'un départ en
 *  vacances (activité qui cesse, renvois qui continuent) se taise vite. */
const AWAY_PRESENCE_FRESH_DAYS = 4;

const CACHE_TTL_MS = 10 * 60_000;
const alertsCache = new Map<string, { alerts: AnomalyAlert[]; windowDays: number; fetchedAt: number }>();

interface PollRow {
    queue_number: string;
    agent_extension: string;
    polls: bigint;
    last_poll_at: Date;
}

interface PresenceRow {
    extension: string;
    current_name: string | null;
    activity: bigint;
    last_activity_at: Date | null;
}

async function computeAlerts(serverId: ServerId, windowDays: number): Promise<AnomalyAlert[]> {
    const prisma = getPrismaCdr(serverId);
    const windowStart = new Date(Date.now() - windowDays * 24 * 3600 * 1000);
    const memberHorizon = new Date(Date.now() - MEMBERSHIP_HORIZON_DAYS * 24 * 3600 * 1000);

    // Sollicitations de chaque file vers chaque agent sur la fenêtre.
    const polls = await prisma.$queryRaw<PollRow[]>`
        SELECT
            parent.destination_dn_number AS queue_number,
            child.destination_dn_number AS agent_extension,
            COUNT(*) AS polls,
            MAX(child.cdr_started_at) AS last_poll_at
        FROM cdroutput child
        JOIN cdroutput parent ON child.originating_cdr_id = parent.cdr_id
        WHERE child.creation_method = 'route_to'
          AND child.creation_forward_reason = 'polling'
          AND parent.destination_dn_type = 'queue'
          AND child.cdr_started_at >= ${windowStart}
        GROUP BY 1, 2
    `;

    // Signes de présence par poste (appels décrochés ou émis), avec le nom
    // porté par le segment décroché le plus récent — le titulaire ACTUEL.
    const presence = await prisma.$queryRaw<PresenceRow[]>`
        WITH answered AS (
            SELECT
                destination_dn_number AS extension,
                COUNT(*) AS activity,
                (ARRAY_AGG(COALESCE(destination_dn_name, destination_participant_name)
                           ORDER BY cdr_started_at DESC))[1] AS current_name,
                MAX(cdr_started_at) AS last_at
            FROM cdroutput
            WHERE destination_dn_type = 'extension'
              AND cdr_answered_at IS NOT NULL
              AND cdr_started_at >= ${windowStart}
            GROUP BY 1
        ),
        outbound AS (
            -- call_init uniquement : un renvoi automatique porte parfois le
            -- poste en source — ce n'est pas un geste humain, seuls les appels
            -- réellement INITIÉS témoignent d'une présence.
            SELECT source_dn_number AS extension, COUNT(*) AS activity,
                   (ARRAY_AGG(source_dn_name ORDER BY cdr_started_at DESC))[1] AS current_name,
                   MAX(cdr_started_at) AS last_at
            FROM cdroutput
            WHERE source_dn_number IS NOT NULL
              AND creation_method = 'call_init'
              AND cdr_started_at >= ${windowStart}
            GROUP BY 1
        )
        SELECT
            COALESCE(a.extension, o.extension) AS extension,
            COALESCE(a.current_name, o.current_name) AS current_name,
            COALESCE(a.activity, 0) + COALESCE(o.activity, 0) AS activity,
            GREATEST(a.last_at, o.last_at) AS last_activity_at
        FROM answered a
        FULL OUTER JOIN outbound o ON a.extension = o.extension
    `;
    // Renvois « Absent » : segment enfant créé avec la raison 'away' depuis un
    // segment direct non décroché du poste. On garde le volume, l'étalement en
    // jours distincts, et si le DERNIER appel direct du poste a encore renvoyé
    // ainsi (signature toujours courante, pas un épisode passé).
    const awayRows = await prisma.$queryRaw<Array<{
        extension: string;
        away_count: bigint;
        away_days: bigint;
        last_away_at: Date;
    }>>`
        SELECT
            parent.destination_dn_number AS extension,
            COUNT(*) AS away_count,
            COUNT(DISTINCT DATE(child.cdr_started_at)) AS away_days,
            MAX(child.cdr_started_at) AS last_away_at
        FROM cdroutput child
        JOIN cdroutput parent ON child.originating_cdr_id = parent.cdr_id
        WHERE child.creation_forward_reason = 'away'
          AND parent.destination_dn_type = 'extension'
          AND child.cdr_started_at >= ${windowStart}
        GROUP BY 1
    `;
    const awaySignature = new Map(
        awayRows
            .filter((r) => Number(r.away_count) >= AWAY_MIN_CALLS && Number(r.away_days) >= AWAY_MIN_DAYS)
            .map((r) => [r.extension, r.last_away_at]),
    );

    const activeByExtension = new Map(
        presence
            .filter((r) => Number(r.activity) > 0)
            .map((r) => [r.extension, { name: r.current_name, lastActivityAt: r.last_activity_at }]),
    );
    // Postes « casés » : sollicités par au moins une file sur la fenêtre.
    const polledAnywhere = new Set(polls.map((r) => r.agent_extension));

    const pollsByQueue = new Map<string, Map<string, PollRow>>();
    for (const row of polls) {
        if (!pollsByQueue.has(row.queue_number)) pollsByQueue.set(row.queue_number, new Map());
        pollsByQueue.get(row.queue_number)!.set(row.agent_extension, row);
    }

    // Équipes de référence : les liens file↔agent de l'annuaire, sous l'horizon.
    // Dédoublonnés par (file, poste) : un poste renommé a plusieurs lignes de
    // lien (une par nom d'époque) — on garde la plus récente, sinon la même
    // anomalie sortirait en double.
    const members = (await getQueueMembersRaw(serverId)).filter((m) => m.last_seen_at >= memberHorizon);
    const latestLink = new Map<string, (typeof members)[number]>();
    for (const m of members) {
        const key = `${m.queue_number}:${m.agent_extension}`;
        const known = latestLink.get(key);
        if (!known || m.last_seen_at > known.last_seen_at) latestLink.set(key, m);
    }
    const byQueue = new Map<string, (typeof members)[number][]>();
    for (const m of latestLink.values()) {
        if (!byQueue.has(m.queue_number)) byQueue.set(m.queue_number, []);
        byQueue.get(m.queue_number)!.push(m);
    }

    // « Absent oublié » concerne la PERSONNE, pas chaque file : une seule
    // alerte par poste, rattachée à sa file la plus récente (les autres files
    // du poste n'émettent rien pour lui).
    const awayHomeQueue = new Map<string, string>();
    for (const m of latestLink.values()) {
        if (!awaySignature.has(m.agent_extension)) continue;
        const current = awayHomeQueue.get(m.agent_extension);
        const currentLink = current ? latestLink.get(`${current}:${m.agent_extension}`) : undefined;
        if (!currentLink || m.last_seen_at > currentLink.last_seen_at) {
            awayHomeQueue.set(m.agent_extension, m.queue_number);
        }
    }

    // Nom affiché : le titulaire actuel du poste si connu, sinon celui du lien.
    const displayName = (extension: string, linkName: string) =>
        activeByExtension.get(extension)?.name || linkName || extension;

    const alerts: AnomalyAlert[] = [];
    for (const [queueNumber, team] of byQueue) {
        const queuePolls = pollsByQueue.get(queueNumber);
        const queueName = team[0].queue_name || queueNumber;

        // Membres candidats à l'anomalie : actifs, sollicités nulle part, et
        // SANS signature Absent — le statut Absent explique à lui seul la
        // non-sollicitation, la passe dédiée en dessous s'en charge.
        const strandedActive = team.filter(
            (m) => !polledAnywhere.has(m.agent_extension)
                && activeByExtension.has(m.agent_extension)
                && !awaySignature.has(m.agent_extension),
        );

        if (!queuePolls || queuePolls.size === 0) {
            // La file n'a sollicité personne : anomalie seulement si des
            // membres montrent des signes de vie sans être casés ailleurs
            // (sinon : congés, file dormante, équipe partie ailleurs).
            if (strandedActive.length > 0) {
                const lastPoll = team.reduce<Date | null>(
                    (acc, m) => (acc === null || m.last_seen_at > acc ? m.last_seen_at : acc),
                    null,
                );
                alerts.push({
                    id: `queue_disconnected:${queueNumber}`,
                    type: "queue_disconnected",
                    queueNumber,
                    queueName,
                    lastPollAt: lastPoll ? lastPoll.toISOString() : null,
                    activeMembers: strandedActive.map((m) => ({
                        extension: m.agent_extension,
                        name: displayName(m.agent_extension, m.agent_name),
                    })),
                });
            }
            continue;
        }

        // La file distribue : chaque membre actif-nulle-part jamais sollicité
        // est probablement déconnecté de la Q.
        const totalPolls = [...queuePolls.values()].reduce((acc, r) => acc + Number(r.polls), 0);
        if (totalPolls < AGENT_POLL_FLOOR) continue;
        for (const m of strandedActive) {
            if (queuePolls.has(m.agent_extension)) continue;
            alerts.push({
                id: `agent_disconnected:${queueNumber}:${m.agent_extension}`,
                type: "agent_disconnected",
                queueNumber,
                queueName,
                agentExtension: m.agent_extension,
                agentName: displayName(m.agent_extension, m.agent_name),
                lastPollAt: m.last_seen_at.toISOString(),
            });
        }
    }

    // Passe « Absent oublié » : une alerte par POSTE à signature Absent, sur
    // sa file de rattachement, à condition d'un signe de vie FRAIS — c'est le
    // discriminant des vacances : l'activité qui CESSE pendant que les
    // renvois continuent est un départ, pas un oubli.
    const freshLimit = new Date(Date.now() - AWAY_PRESENCE_FRESH_DAYS * 24 * 3600 * 1000);
    for (const [extension, homeQueue] of awayHomeQueue) {
        if (polledAnywhere.has(extension)) continue;
        const activity = activeByExtension.get(extension);
        if (!activity?.lastActivityAt || activity.lastActivityAt < freshLimit) continue;
        const link = latestLink.get(`${homeQueue}:${extension}`);
        if (!link) continue;
        alerts.push({
            id: `away_forgotten:${homeQueue}:${extension}`,
            type: "away_forgotten",
            queueNumber: homeQueue,
            queueName: link.queue_name || homeQueue,
            agentExtension: extension,
            agentName: displayName(extension, link.agent_name),
            lastPollAt: link.last_seen_at.toISOString(),
        });
    }

    // Les équipes entières d'abord (plus grave), puis les statuts Absent
    // oubliés (remède simple), puis les déconnexions individuelles.
    const typeRank = { queue_disconnected: 0, away_forgotten: 1, agent_disconnected: 2 } as const;
    alerts.sort((a, b) => (a.type === b.type
        ? a.queueNumber.localeCompare(b.queueNumber)
        : typeRank[a.type] - typeRank[b.type]));
    return alerts;
}

/**
 * Alertes d'un tenant, cache 10 min : le détecteur balaye la fenêtre entière,
 * inutile de recommencer à chaque ouverture de la cloche. NON exposé en
 * action serveur : le résultat n'est PAS filtré par périmètre — c'est
 * services/notifications.service qui applique droit et périmètre.
 */
export async function getAlertsForTenant(serverId: ServerId, windowDays: number): Promise<AnomalyAlert[]> {
    const cached = alertsCache.get(serverId);
    if (cached && cached.windowDays === windowDays && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
        return cached.alerts;
    }
    try {
        const alerts = await computeAlerts(serverId, windowDays);
        alertsCache.set(serverId, { alerts, windowDays, fetchedAt: Date.now() });
        return alerts;
    } catch (error) {
        logger.error("[alertes] échec du calcul :", error);
        return cached?.alerts ?? [];
    }
}
