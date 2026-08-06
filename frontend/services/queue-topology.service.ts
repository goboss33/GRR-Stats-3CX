"use server";

/**
 * Topologie DÉDUITE d'une file — la carte de parcours de la modale des
 * réglages (Réglages ▸ Files d'attente ▸ icône schéma).
 *
 * Tout est lu dans les CDR, rien n'est inventé : on montre le COMPORTEMENT
 * OBSERVÉ sur une fenêtre glissante, pas la configuration 3CX réelle (qui
 * n'est pas dans les données — cf. le dossier XAPI). Conséquences assumées :
 * un chemin configuré mais jamais emprunté est invisible, et un changement de
 * configuration laisse ses deux versions visibles, datées.
 *
 * Liaisons vérifiées sur données réelles (sonde du 6 août 2026, file 900) :
 * - AMONT : le parent d'un passage (originating_cdr_id) porte le hop
 *   précédent — script, groupe d'appel, renvoi de poste, débordement d'une
 *   autre file, ou racine (numérotation directe / SDA).
 * - AVAL : continued_in_cdr_id pointe vers le segment suivant, l'AGENT
 *   GAGNANT compris (termination_reason_details = 'polling') — la partition
 *   répondu / routé / raccroché / autre se referme sur le total des passages
 *   (conservation des flux : 5410+110+706+2 ≈ 6229 sur la sonde).
 * - Le nom des scripts vit dans participant_name, pas dn_name.
 * - Les SCRIPTS SONT TRAVERSÉS : un script est une rotule de routage, pas une
 *   destination — on suit son continued_in jusqu'à l'atterrissage réel et le
 *   script devient une étiquette « via » sur la route (vérifié : le script de
 *   débordement de la 993 atterrit sur la file 900 pour 666 passages). Même
 *   traitement en amont (le hop d'avant le script). Un script sans
 *   continuation reste affiché tel quel (messagerie, terminus).
 * - Un parent de type 'unknown' est un SDA : le segment d'arrivée de l'appel
 *   (call_init) porte le numéro composé.
 *
 * Ces chiffres sont des FLUX BRUTS PAR PASSAGE : sans les règles de
 * classement, sans le grain « appel », sans filtre de provenance — ils ne
 * doivent PAS être comparés aux KPIs des statistiques.
 */

import { requireActionRole } from "@/lib/auth-guard";
import { ServerId, getPrismaCdr } from "@/lib/prisma-cdr";
import { getQueueName, getQueueDepartment } from "@/services/repositories/cdr.repository";
import { getAlertsForTenant } from "@/services/repositories/anomaly-detector";
import { prismaAuth } from "@/lib/prisma-auth";

/** Fenêtre d'observation des FLUX : la configuration récente est la vraie. */
const FLOW_WINDOW_DAYS = 90;
/** Appartenance des agents : l'horizon des alertes (un lien plus vieux n'engage plus). */
const MEMBERSHIP_DAYS = 365;
/** Sollicité plus récemment que ça = considéré connecté à la Q. */
const CONNECTED_DAYS = 7;
/** Par catégorie d'entrée/sortie : les N plus gros en satellites, le reste agrégé. */
const TOP_PER_KIND = 5;

const CACHE_TTL_MS = 10 * 60_000;
const topologyCache = new Map<string, { data: QueueTopology; fetchedAt: number }>();
const journeysCache = new Map<string, { data: QueueJourney[]; fetchedAt: number }>();

/** Un trajet type : la séquence des étapes réellement empruntées par N appels. */
export interface QueueJourney {
    /** Les étapes, dans l'ordre (« SDA », « Poste direct », « rrpully_gerance63.Main », « File RR PULLY Gérance 63 »…). */
    steps: string[];
    answered: boolean;
    count: number;
}

export type FlowKind = "did" | "script" | "ring_group" | "extension" | "queue" | "ivr" | "direct_dial" | "external" | "other";

export interface FlowNode {
    kind: FlowKind;
    /** Numéro (file, poste) quand il existe — permet le re-centrage sur une file. */
    number: string | null;
    name: string;
    volume: number;
    lastSeenAt: string | null;
    /** Regroupement de la longue traîne (« N autres SDA ») : le détail au survol. */
    grouped?: Array<{ name: string; volume: number }>;
    /** Script traversé pour atteindre ce nœud (rotule de routage). */
    via?: string;
}

export interface DownstreamFlow extends FlowNode {
    /** Raison du renvoi observée (no_answer, no_destinations…). */
    reason: string;
    /** Profondeur 2, pour les destinations qui sont des files : leurs issues. */
    next?: {
        answered: number;
        abandoned: number;
        routed: Array<{ name: string; volume: number }>;
    };
}

export interface TopologyAgent {
    extension: string;
    name: string;
    /** Passages répondus par cet agent sur la fenêtre de flux. */
    answered: number;
    lastPolledAt: string;
    status: "connected" | "disconnected" | "away";
}

export interface QueueTopology {
    queueNumber: string;
    queueName: string;
    department: string | null;
    windowDays: number;
    strategy: "ring_all" | "sequential" | "mixed" | null;
    totalPassages: number;
    answeredByTeam: number;
    abandoned: number;
    otherEndings: number;
    upstream: FlowNode[];
    downstream: DownstreamFlow[];
    agents: TopologyAgent[];
}

interface UpstreamRow {
    parent_type: string | null;
    parent_number: string | null;
    parent_name: string | null;
    gp_type: string | null;
    gp_number: string | null;
    gp_name: string | null;
    creation_method: string | null;
    creation_forward_reason: string | null;
    trunk_did: string | null;
    n: bigint;
    last_at: Date;
}

interface DownstreamRow {
    reason: string | null;
    next_type: string | null;
    next_number: string | null;
    next_name: string | null;
    land_type: string | null;
    land_number: string | null;
    land_name: string | null;
    n: bigint;
    last_at: Date;
}

/** Partition d'une file : répondus / routés (par destination) / raccrochés / autres. */
async function queryOutcomes(serverId: ServerId, queueNumber: string, since: Date) {
    const prisma = getPrismaCdr(serverId);
    const [balance, routed] = await Promise.all([
        prisma.$queryRaw<Array<{ passages: bigint; answered: bigint; abandoned: bigint; others: bigint }>>`
            SELECT
                COUNT(*) AS passages,
                COUNT(*) FILTER (WHERE q.termination_reason_details = 'polling') AS answered,
                COUNT(*) FILTER (WHERE q.continued_in_cdr_id IS NULL
                    AND q.termination_reason = 'src_participant_terminated'
                    AND COALESCE(q.termination_reason_details, '') <> 'polling') AS abandoned,
                COUNT(*) FILTER (WHERE q.continued_in_cdr_id IS NULL
                    AND q.termination_reason <> 'src_participant_terminated'
                    AND COALESCE(q.termination_reason_details, '') <> 'polling') AS others
            FROM cdroutput q
            WHERE q.destination_dn_number = ${queueNumber} AND q.destination_dn_type = 'queue'
              AND q.cdr_started_at >= ${since}
        `,
        prisma.$queryRaw<DownstreamRow[]>`
            SELECT q.termination_reason_details AS reason,
                   n.destination_dn_type AS next_type,
                   n.destination_dn_number AS next_number,
                   COALESCE(NULLIF(n.destination_dn_name, ''), NULLIF(n.destination_participant_name, ''), n.destination_dn_number, '(sans nom)') AS next_name,
                   l.destination_dn_type AS land_type,
                   l.destination_dn_number AS land_number,
                   COALESCE(NULLIF(l.destination_dn_name, ''), NULLIF(l.destination_participant_name, ''), l.destination_dn_number) AS land_name,
                   COUNT(*) AS n,
                   MAX(q.cdr_started_at) AS last_at
            FROM cdroutput q
            JOIN cdroutput n ON n.cdr_id = q.continued_in_cdr_id
            LEFT JOIN cdroutput l ON n.destination_dn_type = 'script' AND l.cdr_id = n.continued_in_cdr_id
            WHERE q.destination_dn_number = ${queueNumber} AND q.destination_dn_type = 'queue'
              AND q.cdr_started_at >= ${since}
              AND COALESCE(q.termination_reason_details, '') <> 'polling'
            GROUP BY 1, 2, 3, 4, 5, 6, 7 ORDER BY 8 DESC
        `,
    ]);
    return { balance: balance[0], routed };
}

function kindOfType(dnType: string | null): FlowKind {
    switch (dnType) {
        case "queue": return "queue";
        case "script": return "script";
        case "ring_group_ring_all": return "ring_group";
        case "extension": return "extension";
        case "ivr": return "ivr";
        case "provider": return "external";
        default: return "other";
    }
}

/** Replie une liste par catégorie : les TOP_PER_KIND plus gros restent des
 *  satellites, la traîne devient UN nœud agrégé — rien n'est masqué. */
function foldLongTail(nodes: FlowNode[]): FlowNode[] {
    const byKind = new Map<FlowKind, FlowNode[]>();
    for (const node of nodes) {
        if (!byKind.has(node.kind)) byKind.set(node.kind, []);
        byKind.get(node.kind)!.push(node);
    }
    const out: FlowNode[] = [];
    for (const [kind, list] of byKind) {
        list.sort((a, b) => b.volume - a.volume);
        out.push(...list.slice(0, TOP_PER_KIND));
        const tail = list.slice(TOP_PER_KIND);
        if (tail.length === 1) {
            out.push(tail[0]);
        } else if (tail.length > 1) {
            out.push({
                kind,
                number: null,
                name: `${tail.length} autres`,
                volume: tail.reduce((acc, t) => acc + t.volume, 0),
                lastSeenAt: tail.reduce<string | null>((acc, t) =>
                    acc === null || (t.lastSeenAt !== null && t.lastSeenAt > acc) ? t.lastSeenAt : acc, null),
                grouped: tail.map((t) => ({ name: t.name, volume: t.volume })),
            });
        }
    }
    return out.sort((a, b) => b.volume - a.volume);
}

async function computeTopology(serverId: ServerId, queueNumber: string): Promise<QueueTopology> {
    const prisma = getPrismaCdr(serverId);
    const flowSince = new Date(Date.now() - FLOW_WINDOW_DAYS * 24 * 3600 * 1000);
    const memberSince = new Date(Date.now() - MEMBERSHIP_DAYS * 24 * 3600 * 1000);
    const connectedSince = new Date(Date.now() - CONNECTED_DAYS * 24 * 3600 * 1000);

    const [queueName, department, upstreamRows, outcomes, agentRows, strategyRows] = await Promise.all([
        getQueueName(serverId, queueNumber),
        getQueueDepartment(serverId, queueNumber),
        prisma.$queryRaw<UpstreamRow[]>`
            SELECT p.destination_dn_type AS parent_type,
                   p.destination_dn_number AS parent_number,
                   COALESCE(NULLIF(p.destination_dn_name, ''), NULLIF(p.destination_participant_name, ''), p.destination_dn_number) AS parent_name,
                   gp.destination_dn_type AS gp_type,
                   gp.destination_dn_number AS gp_number,
                   COALESCE(NULLIF(gp.destination_dn_name, ''), NULLIF(gp.destination_participant_name, ''), gp.destination_dn_number) AS gp_name,
                   q.creation_method, q.creation_forward_reason,
                   q.source_participant_trunk_did AS trunk_did,
                   COUNT(*) AS n,
                   MAX(q.cdr_started_at) AS last_at
            FROM cdroutput q
            LEFT JOIN cdroutput p ON p.cdr_id = q.originating_cdr_id
            LEFT JOIN cdroutput gp ON p.destination_dn_type = 'script' AND gp.cdr_id = p.originating_cdr_id
            WHERE q.destination_dn_number = ${queueNumber} AND q.destination_dn_type = 'queue'
              AND q.cdr_started_at >= ${flowSince}
            GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9
        `,
        queryOutcomes(serverId, queueNumber, flowSince),
        // Membres (12 mois) avec répondus (fenêtre de flux) et dernière sollicitation.
        prisma.$queryRaw<Array<{ extension: string; name: string | null; answered: bigint; last_polled: Date }>>`
            SELECT c.destination_dn_number AS extension,
                   (ARRAY_AGG(COALESCE(NULLIF(c.destination_dn_name, ''), NULLIF(c.destination_participant_name, ''))
                              ORDER BY c.cdr_started_at DESC))[1] AS name,
                   COUNT(*) FILTER (WHERE c.cdr_answered_at IS NOT NULL AND c.cdr_started_at >= ${flowSince}) AS answered,
                   MAX(c.cdr_started_at) AS last_polled
            FROM cdroutput c
            JOIN cdroutput q ON q.cdr_id = c.originating_cdr_id
            WHERE c.creation_method = 'route_to' AND c.creation_forward_reason = 'polling'
              AND q.destination_dn_type = 'queue' AND q.destination_dn_number = ${queueNumber}
              AND c.cdr_started_at >= ${memberSince}
            GROUP BY 1 ORDER BY 3 DESC
        `,
        // Stratégie : étalement des sollicitations d'un même passage.
        prisma.$queryRaw<Array<{ multi: bigint; simultaneous: bigint }>>`
            WITH per_passage AS (
                SELECT q.cdr_id,
                       EXTRACT(EPOCH FROM (MAX(c.cdr_started_at) - MIN(c.cdr_started_at))) AS spread_s
                FROM cdroutput q
                JOIN cdroutput c ON c.originating_cdr_id = q.cdr_id AND c.creation_forward_reason = 'polling'
                WHERE q.destination_dn_number = ${queueNumber} AND q.destination_dn_type = 'queue'
                  AND q.cdr_started_at >= ${flowSince}
                GROUP BY q.cdr_id HAVING COUNT(c.cdr_id) >= 2
            )
            SELECT COUNT(*) AS multi,
                   COUNT(*) FILTER (WHERE spread_s <= 2) AS simultaneous
            FROM per_passage
        `,
    ]);

    // ---- Amont : catégorisation par parent (ou racine) ----
    const upstreamMap = new Map<string, FlowNode>();
    for (const r of upstreamRows) {
        let kind: FlowKind;
        let name: string;
        let number: string | null = null;
        let via: string | undefined;
        // Le hop affiché : le grand-parent quand le parent est un script
        // traversable (le script devient l'étiquette « via »).
        const viaScript = r.parent_type === "script" && r.gp_type !== null;
        const hopType = viaScript ? r.gp_type : r.parent_type;
        const hopNumber = viaScript ? r.gp_number : r.parent_number;
        const hopName = viaScript ? r.gp_name : r.parent_name;
        if (viaScript) via = r.parent_name ?? "script";

        if (hopType === null) {
            // Racine : appel arrivé directement sur la file — SDA (by_did) ou
            // numérotation interne du numéro de file.
            if (r.creation_forward_reason === "by_did" && r.trunk_did) {
                kind = "did";
                name = r.trunk_did;
            } else if (r.creation_method === "call_init") {
                kind = "direct_dial";
                name = "Numérotation directe";
            } else {
                kind = "other";
                name = r.creation_method ? `Arrivée ${r.creation_method}` : "Origine inconnue";
            }
        } else if (hopType === "unknown") {
            // Segment d'arrivée de l'appel (call_init) : son numéro EST le SDA.
            kind = "did";
            name = hopName || hopNumber || r.trunk_did || "SDA";
        } else {
            kind = kindOfType(hopType);
            name = hopName || hopNumber || "(sans nom)";
            number = hopNumber;
            if (kind === "script" && !hopName) name = "Script";
        }
        const key = `${kind}|${number ?? name}|${via ?? ""}`;
        const existing = upstreamMap.get(key);
        const lastAt = r.last_at.toISOString();
        if (existing) {
            existing.volume += Number(r.n);
            if (existing.lastSeenAt === null || lastAt > existing.lastSeenAt) existing.lastSeenAt = lastAt;
        } else {
            upstreamMap.set(key, { kind, number, name, volume: Number(r.n), lastSeenAt: lastAt, via });
        }
    }
    const upstream = foldLongTail([...upstreamMap.values()]);

    // ---- Aval : renvois groupés par destination (raison dominante affichée) ----
    const downstreamMap = new Map<string, DownstreamFlow>();
    for (const r of outcomes.routed) {
        // Script AVEC atterrissage : le nœud est la destination réelle, le
        // script n'est qu'une étiquette de route. Sans atterrissage (script
        // terminal, messagerie…), le script reste le nœud.
        const landed = r.next_type === "script" && r.land_type !== null;
        const kind = landed ? kindOfType(r.land_type) : kindOfType(r.next_type);
        const number = landed ? r.land_number : r.next_number;
        const name = (landed ? r.land_name : r.next_name) || "(sans nom)";
        const via = landed ? (r.next_name ?? undefined) : undefined;
        const key = `${kind}|${number ?? name}|${via ?? ""}`;
        const existing = downstreamMap.get(key);
        const lastAt = r.last_at.toISOString();
        if (existing) {
            existing.volume += Number(r.n);
            if (existing.lastSeenAt === null || lastAt > existing.lastSeenAt) existing.lastSeenAt = lastAt;
        } else {
            downstreamMap.set(key, {
                kind,
                number,
                name,
                volume: Number(r.n),
                lastSeenAt: lastAt,
                reason: r.reason ?? "renvoi",
                via,
            });
        }
    }
    const downstream = [...downstreamMap.values()].sort((a, b) => b.volume - a.volume);

    // Profondeur 2 : les issues des files de destination les plus empruntées.
    await Promise.all(
        downstream.filter((d) => d.kind === "queue" && d.number).slice(0, 3).map(async (d) => {
            const sub = await queryOutcomes(serverId, d.number!, flowSince);
            d.next = {
                answered: Number(sub.balance?.answered ?? 0),
                abandoned: Number(sub.balance?.abandoned ?? 0),
                routed: sub.routed.slice(0, 3).map((r) => ({
                    name: r.next_name || "(sans nom)",
                    volume: Number(r.n),
                })),
            };
        }),
    );

    // ---- Agents : états repris du détecteur d'anomalies (mêmes signatures) ----
    const settings = await prismaAuth.appSettings.findUnique({
        where: { id: "global" }, select: { notificationWindowDays: true },
    });
    const alerts = await getAlertsForTenant(serverId, settings?.notificationWindowDays ?? 7);
    const awayExts = new Set(alerts.filter((a) => a.type === "away_forgotten").map((a) => a.agentExtension));
    const agents: TopologyAgent[] = agentRows.map((a) => ({
        extension: a.extension,
        name: a.name ?? a.extension,
        answered: Number(a.answered),
        lastPolledAt: a.last_polled.toISOString(),
        status: awayExts.has(a.extension) ? "away"
            : a.last_polled >= connectedSince ? "connected"
            : "disconnected",
    }));

    const multi = Number(strategyRows[0]?.multi ?? 0);
    const simultaneous = Number(strategyRows[0]?.simultaneous ?? 0);
    const strategy = multi < 5 ? null
        : simultaneous / multi >= 0.7 ? "ring_all"
        : simultaneous / multi <= 0.3 ? "sequential"
        : "mixed";

    return {
        queueNumber,
        queueName,
        department,
        windowDays: FLOW_WINDOW_DAYS,
        strategy,
        totalPassages: Number(outcomes.balance?.passages ?? 0),
        answeredByTeam: Number(outcomes.balance?.answered ?? 0),
        abandoned: Number(outcomes.balance?.abandoned ?? 0),
        otherEndings: Number(outcomes.balance?.others ?? 0),
        upstream,
        downstream,
        agents,
    };
}

/**
 * Trajets types : les chemins complets réellement empruntés par les appels
 * qui traversent la file — LA réponse à « dans quel ordre ça se passe ».
 *
 * Chaque appel est réduit à sa séquence d'étapes (les sollicitations d'agents
 * exclues : ce sont les rouages internes des files ; les étapes consécutives
 * identiques fusionnées), puis les chemins identiques sont comptés. Les
 * postes sont anonymisés en « Poste direct » — sinon chaque extension
 * fragmenterait les chemins — mais scripts, files et groupes gardent leur nom :
 * ce sont eux, la structure. « Répondu » = au moins un poste a décroché
 * quelque part dans l'appel.
 */
async function computeJourneys(serverId: ServerId, queueNumber: string): Promise<QueueJourney[]> {
    const prisma = getPrismaCdr(serverId);
    const since = new Date(Date.now() - FLOW_WINDOW_DAYS * 24 * 3600 * 1000);
    const rows = await prisma.$queryRaw<Array<{ path: string; answered: boolean; n: bigint }>>`
        WITH calls AS (
            SELECT DISTINCT call_history_id
            FROM cdroutput
            WHERE destination_dn_number = ${queueNumber} AND destination_dn_type = 'queue'
              AND cdr_started_at >= ${since}
              AND call_history_id IS NOT NULL
        ),
        segs AS (
            SELECT c.call_history_id, c.cdr_started_at, c.cdr_id,
                CASE c.destination_dn_type
                    WHEN 'queue' THEN 'File ' || COALESCE(NULLIF(c.destination_dn_name, ''), c.destination_dn_number)
                    WHEN 'script' THEN COALESCE(NULLIF(c.destination_participant_name, ''), NULLIF(c.destination_dn_name, ''), 'Script')
                    WHEN 'ring_group_ring_all' THEN 'Groupe ' || COALESCE(NULLIF(c.destination_dn_name, ''), c.destination_dn_number, '')
                    WHEN 'ivr' THEN 'IVR'
                    WHEN 'extension' THEN 'Poste direct'
                    WHEN 'provider' THEN 'Externe'
                    WHEN 'unknown' THEN 'SDA'
                    ELSE COALESCE(c.destination_dn_type, '?')
                END AS token
            FROM cdroutput c
            JOIN calls ON calls.call_history_id = c.call_history_id
            WHERE COALESCE(c.creation_forward_reason, '') <> 'polling'
        ),
        dedup AS (
            SELECT call_history_id, cdr_started_at, cdr_id, token,
                   LAG(token) OVER (PARTITION BY call_history_id ORDER BY cdr_started_at, cdr_id) AS prev
            FROM segs
        ),
        paths AS (
            SELECT call_history_id,
                   STRING_AGG(token, '→' ORDER BY cdr_started_at, cdr_id) AS path
            FROM dedup
            WHERE prev IS DISTINCT FROM token
            GROUP BY call_history_id
        ),
        answered AS (
            SELECT DISTINCT c.call_history_id
            FROM cdroutput c
            JOIN calls ON calls.call_history_id = c.call_history_id
            WHERE c.destination_dn_type = 'extension' AND c.cdr_answered_at IS NOT NULL
        )
        SELECT p.path,
               (a.call_history_id IS NOT NULL) AS answered,
               COUNT(*) AS n
        FROM paths p
        LEFT JOIN answered a ON a.call_history_id = p.call_history_id
        GROUP BY 1, 2 ORDER BY 3 DESC
        LIMIT 12
    `;
    return rows.map((r) => ({
        // Les noms 3CX de groupes commencent souvent déjà par « Groupe » :
        // éviter le doublon avec notre préfixe.
        steps: r.path.split("→").map((step) => step.replace(/^Groupe Groupe /, "Groupe ")),
        answered: r.answered,
        count: Number(r.n),
    }));
}

/** Trajets types d'une file — ADMIN uniquement, même cache que la topologie. */
export async function getQueueJourneys(serverId: ServerId, queueNumber: string): Promise<QueueJourney[]> {
    await requireActionRole(["ADMIN"]);
    const key = `${serverId}|${queueNumber}`;
    const cached = journeysCache.get(key);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.data;
    const data = await computeJourneys(serverId, queueNumber);
    journeysCache.set(key, { data, fetchedAt: Date.now() });
    return data;
}

/** Topologie d'une file — ADMIN uniquement (l'onglet Files l'est déjà). */
export async function getQueueTopology(serverId: ServerId, queueNumber: string): Promise<QueueTopology> {
    await requireActionRole(["ADMIN"]);

    const key = `${serverId}|${queueNumber}`;
    const cached = topologyCache.get(key);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.data;

    const data = await computeTopology(serverId, queueNumber);
    topologyCache.set(key, { data, fetchedAt: Date.now() });
    return data;
}
