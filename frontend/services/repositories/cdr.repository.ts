/**
 * CDR Repository — Database Access Layer
 * 
 * Executes raw SQL queries against the cdroutput table.
 * 
 * Note: Queue KPIs, agent stats, and global metrics are now served
 * via /api/analytics/* endpoints. This repository retains only:
 * - Timeline/heatmap queries (not yet in API)
 * - Simple lookups (queue names, members, segments)
 */

"use server";

import { Prisma } from "@prisma/cdr-client";
import { ServerId, getPrismaCdr } from "@/lib/prisma-cdr";
import type { AccessScope } from "@/lib/access-scope";
import {
    buildOriginConditionSQL,
    buildTeamCTEChain,
    cdrTable,
    outcomesForBucket,
    TEAM_CALLS_UNION_SQL,
    type CallOrigin,
} from "@/services/domain/call-classification";
import { getClassificationRules } from "@/lib/classification-rules";
import {
    SQL_SYSTEM_DEST_TYPES,
    SQL_REAL_PARTY_DEST_TYPES,
    buildFinalStatusCaseSQL,
    buildDirectionConditionSQL,
    SQL_SYSTEM_ENTITY_TYPES,
    type DashboardDirection,
} from "@/services/domain/call-aggregation";

// ============================================
// TYPES
// ============================================

export interface TimelineRow {
    date_group: Date;
    answered: bigint;
    missed: bigint;
    overflow?: bigint;
}

export interface HeatmapRow {
    day_of_week: number;
    hour_of_day: number;
    volume: bigint;
}

export interface ConcurrentCallsRow {
    timestamp: Date;
    concurrent_calls: bigint;
}

export interface TrendRow {
    call_date: Date | null;
    call_hour: number | null;
    received: bigint;
    answered: bigint;
    abandoned: bigint;
}

export interface QueueMemberRow {
    queue_number: string;
    queue_name: string;
    agent_extension: string;
    agent_name: string;
    attempts_count: bigint;
    last_seen_at: Date;
}

// ============================================
// FILTRAGE PAR PÉRIMÈTRE
// ============================================

/**
 * Fragment SQL restreignant les appels au périmètre de l'utilisateur.
 * Un appel est retenu dès qu'AU MOINS UN de ses segments touche une file ou une
 * extension autorisée (cf. PRD droits d'accès §8.3).
 *
 * Renvoie `Prisma.empty` quand il n'y a rien à filtrer, et `AND false` quand la
 * portée est vide : on préfère ne rien afficher plutôt que tout afficher.
 *
 * ⚠️ Le fragment doit être composé avec Prisma.sql PUIS passé en argument unique
 * à $queryRaw() — dans un tagged template il serait lié comme une valeur.
 */
// Non exportée : ce module est "use server", où tout export doit être une
// fonction asynchrone (un helper synchrone exporté casse la compilation).
// `table` porte le grain de comptage (cf. cdrTable) : au grain fusionné, une
// jambe dans le périmètre ramène l'appel principal ENTIER, et réciproquement.
function buildScopeFilter(scope: AccessScope | undefined, table: Prisma.Sql): Prisma.Sql {
    if (!scope || scope.unrestricted) return Prisma.empty;
    if (scope.empty) return Prisma.sql`AND false`;

    const conditions: Prisma.Sql[] = [];
    if (scope.queueNumbers && scope.queueNumbers.length > 0) {
        conditions.push(
            Prisma.sql`(destination_dn_type = 'queue' AND destination_dn_number IN (${Prisma.join(scope.queueNumbers)}))`,
        );
    }
    if (scope.extensionNumbers && scope.extensionNumbers.length > 0) {
        conditions.push(
            Prisma.sql`(destination_dn_type = 'extension' AND destination_dn_number IN (${Prisma.join(scope.extensionNumbers)}))`,
        );
    }
    if (conditions.length === 0) return Prisma.sql`AND false`;

    return Prisma.sql`AND call_history_id IN (
        SELECT call_history_id FROM ${table} WHERE ${Prisma.join(conditions, " OR ")}
    )`;
}

// ============================================
// MÉTRIQUES GLOBALES (KPIs du dashboard)
// ============================================

export interface GlobalMetricsRow {
    total_calls: bigint;
    answered_calls: bigint;
    missed_calls: bigint;
    voicemail_calls: bigint;
    busy_calls: bigint;
    avg_human_duration: string | null;
    avg_wait_time: string | null;
    avg_agents_per_call: string | null;
    agents_1: bigint;
    agents_2: bigint;
    agents_3_plus: bigint;
}

/**
 * KPIs globaux d'une période, filtrés par périmètre.
 *
 * Source unique partagée par le dashboard et /api/analytics/global : dupliquer
 * cette requête ferait diverger les chiffres de l'interface et de l'API.
 */
/**
 * Fragments du filtre de direction du tableau de bord (Entrant / Sortant ×
 * provenance) : la CTE des premiers segments, sa jointure, et la condition —
 * vides quand aucun filtre n'est demandé, pour ne rien coûter aux appels
 * existants (API sans paramètre).
 */
function buildDirectionFragments(
    direction: DashboardDirection | undefined,
    origin: CallOrigin | undefined,
    cdr: Prisma.Sql,
    startDate: Date,
    endDate: Date,
    lastDestTypeExpr: string,
): { firstsCTE: Prisma.Sql; firstsJoin: Prisma.Sql; condition: Prisma.Sql } {
    if (!direction) {
        return { firstsCTE: Prisma.empty, firstsJoin: Prisma.empty, condition: Prisma.empty };
    }
    return {
        firstsCTE: Prisma.sql`
        firsts AS (
            SELECT DISTINCT ON (call_history_id)
                call_history_id,
                source_dn_type AS first_source_type,
                destination_dn_type AS first_dest_type
            FROM ${cdr}
            WHERE cdr_started_at >= ${startDate}
              AND cdr_started_at <= ${endDate}
            ORDER BY call_history_id, cdr_started_at ASC, cdr_id ASC
        ),`,
        firstsJoin: Prisma.raw(`JOIN firsts fs ON fs.call_history_id = ca.call_history_id`),
        condition: Prisma.raw(`AND ${buildDirectionConditionSQL({
            direction,
            origin,
            sourceTypeExpr: "fs.first_source_type",
            firstDestTypeExpr: "fs.first_dest_type",
            lastDestTypeExpr,
        })}`),
    };
}

export async function getGlobalMetricsRaw(
    serverId: ServerId,
    startDate: Date,
    endDate: Date,
    scope?: AccessScope,
    direction?: DashboardDirection,
    origin?: CallOrigin
): Promise<GlobalMetricsRow> {
    const prisma = getPrismaCdr(serverId);
    // Le grain de comptage (jambe ou appel fusionné) vient des règles de
    // classement : même unité que les statistiques d'équipe et les journaux.
    const rules = await getClassificationRules();
    const cdr = Prisma.raw(cdrTable(rules));
    const scopeFilter = buildScopeFilter(scope, cdr);
    // Listes de types système : du SQL, pas des valeurs (cf. note sur getTimelineDataRaw).
    const realPartyTypes = Prisma.raw(SQL_REAL_PARTY_DEST_TYPES);
    const statusCase = Prisma.raw(buildFinalStatusCaseSQL());
    const dir = buildDirectionFragments(direction, origin, cdr, startDate, endDate, "ls.last_dest_type");

    const query = Prisma.sql`
        -- Les trois CTE de base etaient assemblees TROIS fois — pour les statuts,
        -- pour les durees, puis pour l'agregat final — et chaque assemblage
        -- imposait un tri complet de 400 000 lignes. Elles ne le sont plus
        -- qu'une fois, ce qui ramene la requete de 10,2 s a 7,2 s sur sept mois
        -- de donnees, a valeurs rigoureusement identiques
        -- (cf. scripts/bench-metrics-fusion.ts).
        WITH call_aggregates AS (
            SELECT
                call_history_id,
                MIN(cdr_started_at) as first_started_at,
                MIN(cdr_answered_at) as first_answered_at
            FROM ${cdr}
            WHERE cdr_started_at >= ${startDate}
              AND cdr_started_at <= ${endDate}
              ${scopeFilter}
            GROUP BY call_history_id
        ),
        last_segments AS (
            SELECT DISTINCT ON (call_history_id)
                call_history_id,
                destination_dn_type as last_dest_type,
                destination_entity_type as last_dest_entity_type,
                cdr_answered_at,
                cdr_started_at as last_started_at,
                cdr_ended_at as last_ended_at,
                termination_reason_details
            FROM ${cdr}
            WHERE cdr_started_at >= ${startDate}
              AND cdr_started_at <= ${endDate}
            ORDER BY call_history_id, cdr_ended_at DESC, cdr_started_at DESC, cdr_id DESC
        ),
        answered_segments AS (
            SELECT DISTINCT ON (c.call_history_id)
                c.call_history_id,
                c.cdr_answered_at as answered_at
            FROM ${cdr} c
            WHERE c.cdr_answered_at IS NOT NULL
              AND c.destination_dn_type = 'extension'
              AND c.cdr_started_at >= ${startDate}
              AND c.cdr_started_at <= ${endDate}
            ORDER BY c.call_history_id, c.cdr_answered_at ASC, c.cdr_id ASC
        ),
        last_real_party AS (
            SELECT DISTINCT ON (call_history_id)
                call_history_id,
                cdr_answered_at as lh_answered_at,
                cdr_started_at as lh_started_at,
                cdr_ended_at as lh_ended_at
            FROM ${cdr}
            WHERE cdr_started_at >= ${startDate}
              AND cdr_started_at <= ${endDate}
              AND destination_dn_type IN (${realPartyTypes})
              AND COALESCE(destination_entity_type, '') != 'voicemail'
            ORDER BY call_history_id, cdr_ended_at DESC, cdr_started_at DESC, cdr_id DESC
        ),
        agent_counts AS (
            SELECT c2.call_history_id, COUNT(DISTINCT c2.destination_dn_number) as agent_count
            FROM ${cdr} c2
            WHERE c2.cdr_answered_at IS NOT NULL
              AND c2.destination_dn_type = 'extension'
              AND c2.cdr_started_at >= ${startDate}
              AND c2.cdr_started_at <= ${endDate}
            GROUP BY c2.call_history_id
        ),${dir.firstsCTE}
        assemble AS (
            SELECT
                ca.call_history_id,
                ca.first_started_at,
                ca.first_answered_at,
                ls.last_dest_type        as ls_last_dest_type,
                ls.last_dest_entity_type as ls_last_dest_entity_type,
                ls.cdr_answered_at       as ls_cdr_answered_at,
                ls.last_started_at       as ls_last_started_at,
                ls.last_ended_at         as ls_last_ended_at,
                ls.termination_reason_details as ls_termination_reason_details,
                ans.answered_at,
                lrp.lh_answered_at,
                lrp.lh_started_at,
                lrp.lh_ended_at,
                agc.agent_count as raw_agent_count
            FROM call_aggregates ca
            JOIN last_segments ls ON ls.call_history_id = ca.call_history_id
            LEFT JOIN answered_segments ans ON ans.call_history_id = ca.call_history_id
            LEFT JOIN last_real_party lrp ON lrp.call_history_id = ca.call_history_id
            LEFT JOIN agent_counts agc ON agc.call_history_id = ca.call_history_id
            ${dir.firstsJoin}
            WHERE TRUE ${dir.condition}
        ),
        enrichi AS (
            SELECT
                call_history_id,
                -- Statut final produit par la definition partagee : le tableau de
                -- bord et les journaux ne peuvent plus en avoir deux lectures.
                ${statusCase} as status,
                -- Ces trois mesures ne valent que pour un appel dont le dernier
                -- segment a ete decroche : c'est la condition que portait le
                -- WHERE de l'ancienne CTE answered_calls_data.
                CASE WHEN ls_cdr_answered_at IS NOT NULL
                     THEN EXTRACT(EPOCH FROM (ls_last_ended_at - ls_cdr_answered_at)) END as talk_duration,
                CASE WHEN ls_cdr_answered_at IS NOT NULL
                     THEN EXTRACT(EPOCH FROM (COALESCE(answered_at, first_answered_at) - first_started_at)) END as wait_time,
                CASE WHEN ls_cdr_answered_at IS NOT NULL
                     THEN COALESCE(raw_agent_count, 0) END as agent_count
            FROM assemble
        )
        SELECT
            COUNT(*) as total_calls,
            COUNT(*) FILTER (WHERE status = 'answered') as answered_calls,
            COUNT(*) FILTER (WHERE status = 'missed') as missed_calls,
            COUNT(*) FILTER (WHERE status = 'voicemail') as voicemail_calls,
            COUNT(*) FILTER (WHERE status = 'busy') as busy_calls,
            ROUND(AVG(talk_duration)::numeric, 1) as avg_human_duration,
            ROUND(AVG(wait_time)::numeric, 1) as avg_wait_time,
            ROUND(AVG(agent_count)::numeric, 2) as avg_agents_per_call,
            COUNT(*) FILTER (WHERE agent_count = 1) as agents_1,
            COUNT(*) FILTER (WHERE agent_count = 2) as agents_2,
            COUNT(*) FILTER (WHERE agent_count >= 3) as agents_3_plus
        FROM enrichi
    `;

    const rows = await prisma.$queryRaw<GlobalMetricsRow[]>(query);
    return rows[0];
}

// ============================================
// TIMELINE & HEATMAP (Dashboard charts)
// ============================================

export async function getTimelineDataRaw(
    serverId: ServerId,
    startDate: Date,
    endDate: Date,
    timezone: string = "Europe/Zurich",
    scope?: AccessScope,
    direction?: DashboardDirection,
    origin?: CallOrigin
): Promise<TimelineRow[]> {
    const prisma = getPrismaCdr(serverId);
    const diffMs = endDate.getTime() - startDate.getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    const interval = diffDays <= 2 ? "hour" : "day";

    // ⚠️ Les listes de types système sont du SQL, pas des valeurs : elles doivent
    // être injectées avec Prisma.raw. Interpolées dans un tagged template, elles
    // seraient liées comme UNE SEULE chaîne et la condition IN serait toujours
    // fausse — un appel décroché par une file/IVR sans humain aurait alors été
    // compté comme « répondu » (constaté : 178 appels sur une seule journée).
    // Ce sont des constantes du code, jamais des entrées utilisateur.
    const systemDestTypes = Prisma.raw(SQL_SYSTEM_DEST_TYPES);
    const systemEntityTypes = Prisma.raw(SQL_SYSTEM_ENTITY_TYPES);
    const rules = await getClassificationRules();
    const cdr = Prisma.raw(cdrTable(rules));
    const dir = buildDirectionFragments(direction, origin, cdr, startDate, endDate, "ls.last_dest_type");

    const query = Prisma.sql`
        WITH call_aggregates AS (
            SELECT call_history_id,
                   MIN(cdr_started_at) AS first_started_at
            FROM ${cdr}
            WHERE cdr_started_at >= ${startDate}
              AND cdr_started_at <= ${endDate}
              ${buildScopeFilter(scope, cdr)}
            GROUP BY call_history_id
        ),
        last_segments AS (
            SELECT DISTINCT ON (call_history_id)
                call_history_id,
                destination_dn_type AS last_dest_type,
                destination_entity_type AS last_dest_entity_type,
                cdr_answered_at AS last_answered_at,
                cdr_started_at AS last_started_at,
                cdr_ended_at AS last_ended_at,
                termination_reason_details
            FROM ${cdr}
            WHERE call_history_id IN (SELECT call_history_id FROM call_aggregates)
            ORDER BY call_history_id, cdr_ended_at DESC, cdr_started_at DESC, cdr_id DESC
        ),
        answered_segments AS (
            SELECT DISTINCT ON (call_history_id)
                call_history_id,
                cdr_answered_at AS answered_at
            FROM ${cdr}
            WHERE call_history_id IN (SELECT call_history_id FROM call_aggregates)
              AND cdr_answered_at IS NOT NULL
              AND destination_dn_type = 'extension'
            ORDER BY call_history_id, cdr_answered_at ASC, cdr_id ASC
        ),${dir.firstsCTE}
        call_outcomes AS (
            SELECT
                ca.call_history_id,
                ca.first_started_at,
                CASE
                    WHEN ls.last_dest_type IN ('vmail_console', 'voicemail') OR ls.last_dest_entity_type = 'voicemail'
                        THEN 'voicemail'
                    WHEN LOWER(COALESCE(ls.termination_reason_details, '')) LIKE '%busy%'
                        THEN 'busy'
                    WHEN ls.last_answered_at IS NOT NULL
                         AND EXTRACT(EPOCH FROM (ls.last_ended_at - ls.last_started_at)) > 1
                        THEN CASE
                            WHEN ls.last_dest_type IN (${systemDestTypes})
                                 OR ls.last_dest_entity_type IN (${systemEntityTypes})
                                THEN CASE WHEN ans.answered_at IS NOT NULL THEN 'answered' ELSE 'abandoned' END
                            ELSE 'answered'
                            END
                    ELSE 'abandoned'
                END AS outcome
            FROM call_aggregates ca
            JOIN last_segments ls ON ls.call_history_id = ca.call_history_id
            LEFT JOIN answered_segments ans ON ans.call_history_id = ca.call_history_id
            ${dir.firstsJoin}
            WHERE TRUE ${dir.condition}
        )
        SELECT
            date_trunc(${interval}, first_started_at AT TIME ZONE ${timezone}) AS date_group,
            COUNT(*) FILTER (WHERE outcome = 'answered') AS answered,
            COUNT(*) FILTER (WHERE outcome IN ('abandoned', 'busy')) AS missed
        FROM call_outcomes
        GROUP BY date_group
        ORDER BY date_group ASC
    `;

    return prisma.$queryRaw<TimelineRow[]>(query);
}

/**
 * Courbe de volume d'une équipe.
 *
 * Consomme le socle de classement, comme les vignettes : même population —
 * passages en file ET appels directs de l'équipe — et mêmes statuts. La somme
 * des trois séries égale donc « Total reçus ».
 *
 * Auparavant cette requête comptait tout appel ayant touché la file, sans la
 * partition du premier contact et sans les appels directs : elle affichait une
 * troisième population, ni « File » ni « Total reçus ». Mesuré sur la file 906
 * le 24 juillet 2026 : 5 appels sur la courbe contre 3 et 10 sur les vignettes.
 */
export async function getQueueTimelineDataRaw(
    serverId: ServerId,
    queueNumber: string,
    startDate: Date,
    endDate: Date,
    timezone: string = "Europe/Zurich",
    origin: CallOrigin = "both"
): Promise<TimelineRow[]> {
    const prisma = getPrismaCdr(serverId);
    const rules = await getClassificationRules();
    const diffDays = (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24);
    const interval = diffDays <= 2 ? "hour" : "day";

    // Les statuts regroupés sous « Perdus » et « Redirigés » viennent de la
    // même table que les vignettes : changer le regroupement met la courbe à
    // jour du même coup. « Redirigés » couvre donc transférés ET débordés —
    // sans quoi les transferts accomplis (le métier des réceptions)
    // disparaissaient de la courbe et du total.
    const lostList = outcomesForBucket("lost").map((o) => `'${o}'`).join(", ");
    const overflowList = outcomesForBucket("overflow").map((o) => `'${o}'`).join(", ");

    return prisma.$queryRawUnsafe<TimelineRow[]>(
        `WITH ${buildTeamCTEChain(rules, { queueExpr: "$1", startExpr: "$2", endExpr: "$3", origin })},
         team_calls AS (${TEAM_CALLS_UNION_SQL})
         SELECT
             date_trunc($4, started_at AT TIME ZONE $5) AS date_group,
             COUNT(*) FILTER (WHERE outcome = 'answered')          AS answered,
             COUNT(*) FILTER (WHERE outcome IN (${lostList}))      AS missed,
             COUNT(*) FILTER (WHERE outcome IN (${overflowList}))  AS overflow
         FROM team_calls
         GROUP BY 1
         ORDER BY 1`,
        queueNumber, startDate, endDate, interval, timezone,
    );
}

export async function getHeatmapDataRaw(
    serverId: ServerId,
    startDate: Date,
    endDate: Date,
    timezone: string = "Europe/Zurich",
    queueNumber?: string,
    scope?: AccessScope,
    direction?: DashboardDirection,
    origin?: CallOrigin
): Promise<HeatmapRow[]> {
    const prisma = getPrismaCdr(serverId);
    const rules = await getClassificationRules();
    const cdr = Prisma.raw(cdrTable(rules));
    const queueFilter = queueNumber
        ? Prisma.sql`AND destination_dn_number = ${queueNumber} AND destination_dn_type = 'queue'`
        : Prisma.empty;
    // Filtre de direction : la heatmap n'a ni CTE des premiers ni des derniers
    // segments — elle reçoit les deux, en bloc, quand le filtre est demandé.
    const dir = buildDirectionFragments(direction, origin, cdr, startDate, endDate, "ls.last_dest_type");
    const extraCTEs = direction
        ? Prisma.sql`,
        firsts AS (
            SELECT DISTINCT ON (call_history_id)
                call_history_id,
                source_dn_type AS first_source_type,
                destination_dn_type AS first_dest_type
            FROM ${cdr}
            WHERE cdr_started_at >= ${startDate}
              AND cdr_started_at <= ${endDate}
            ORDER BY call_history_id, cdr_started_at ASC, cdr_id ASC
        ),
        lasts AS (
            SELECT DISTINCT ON (call_history_id)
                call_history_id, destination_dn_type AS last_dest_type
            FROM ${cdr}
            WHERE cdr_started_at >= ${startDate}
              AND cdr_started_at <= ${endDate}
            ORDER BY call_history_id, cdr_ended_at DESC, cdr_started_at DESC, cdr_id DESC
        )`
        : Prisma.empty;
    const lastsJoin = direction
        ? Prisma.raw(`JOIN lasts ls ON ls.call_history_id = ca.call_history_id`)
        : Prisma.empty;

    // ⚠️ La requête est composée avec Prisma.sql PUIS passée en argument unique à
    // $queryRaw(). Dans la forme "tagged template" (`$queryRaw`...``), un fragment
    // imbriqué serait lié comme une VALEUR ($3) au lieu d'être injecté dans le SQL
    // -> "syntax error at or near $3".
    const query = Prisma.sql`
        WITH unique_calls AS (
            SELECT
                call_history_id,
                MIN(cdr_started_at) AS first_started_at
            FROM ${cdr}
            WHERE cdr_started_at >= ${startDate}
              AND cdr_started_at <= ${endDate}
              ${queueFilter}
              ${buildScopeFilter(scope, cdr)}
            GROUP BY call_history_id
        )${extraCTEs}
        SELECT
            EXTRACT(ISODOW FROM first_started_at AT TIME ZONE ${timezone})::int AS day_of_week,
            EXTRACT(HOUR FROM first_started_at AT TIME ZONE ${timezone})::int AS hour_of_day,
            COUNT(*) AS volume
        FROM unique_calls ca
        ${dir.firstsJoin}
        ${lastsJoin}
        WHERE TRUE ${dir.condition}
        GROUP BY day_of_week, hour_of_day
    `;

    return prisma.$queryRaw<HeatmapRow[]>(query);
}

/** Heatmap d'une file d'attente. Délègue à getHeatmapDataRaw avec le filtre file. */
/**
 * Carte des affluences d'une équipe — même population que la courbe et les
 * vignettes, et non plus les seuls appels ayant touché la file.
 */
export async function getQueueHeatmapDataRaw(
    serverId: ServerId,
    queueNumber: string,
    startDate: Date,
    endDate: Date,
    timezone: string = "Europe/Zurich",
    origin: CallOrigin = "both"
): Promise<HeatmapRow[]> {
    const prisma = getPrismaCdr(serverId);
    const rules = await getClassificationRules();

    return prisma.$queryRawUnsafe<HeatmapRow[]>(
        `WITH ${buildTeamCTEChain(rules, { queueExpr: "$1", startExpr: "$2", endExpr: "$3", origin })},
         team_calls AS (${TEAM_CALLS_UNION_SQL})
         SELECT
             EXTRACT(ISODOW FROM started_at AT TIME ZONE $4)::int AS day_of_week,
             EXTRACT(HOUR  FROM started_at AT TIME ZONE $4)::int  AS hour_of_day,
             COUNT(*) AS volume
         FROM team_calls
         GROUP BY 1, 2
         ORDER BY 1, 2`,
        queueNumber, startDate, endDate, timezone,
    );
}

// ============================================
// CONCURRENT CALLS (Licence monitoring)
// ============================================

export async function getConcurrentCallsData(
    serverId: ServerId,
    startDate: Date,
    endDate: Date,
    timezone: string = "Europe/Zurich",
    scope?: AccessScope
): Promise<ConcurrentCallsRow[]> {
    const prisma = getPrismaCdr(serverId);
    const diffMs = endDate.getTime() - startDate.getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    // Volontairement au grain « jambe », quel que soit le réglage : la licence
    // 3CX compte les communications simultanées, et un transfert en cours
    // occupe bien DEUX communications. Fusionner ici sous-estimerait la charge.
    const scopeFilter = buildScopeFilter(scope, Prisma.raw("cdroutput"));

    // Granularité du regroupement selon la période analysée.
    const bucketExpr = (column: string): Prisma.Sql => {
        const col = Prisma.raw(column);
        if (diffDays <= 1) {
            return Prisma.sql`date_trunc('minute', ${col} AT TIME ZONE ${timezone})`;
        }
        if (diffDays <= 7) {
            return Prisma.sql`date_trunc('hour', ${col} AT TIME ZONE ${timezone}) + (EXTRACT(MINUTE FROM ${col})::int / 5) * INTERVAL '5 minutes'`;
        }
        return Prisma.sql`date_trunc('hour', ${col} AT TIME ZONE ${timezone})`;
    };

    // Une seule requête : seule l'expression de regroupement variait entre les
    // trois anciennes variantes, dupliquées à l'identique par ailleurs.
    const query = Prisma.sql`
        WITH call_spans AS (
            SELECT
                call_history_id,
                MIN(cdr_started_at) AS call_start,
                MAX(cdr_ended_at) AS call_end
            FROM cdroutput
            WHERE cdr_started_at >= ${startDate}
              AND cdr_started_at <= ${endDate}
              AND call_history_id IS NOT NULL
              ${scopeFilter}
            GROUP BY call_history_id
            HAVING MIN(cdr_started_at) IS NOT NULL
               AND MAX(cdr_ended_at) IS NOT NULL
        ),
        bucketed_events AS (
            SELECT ${bucketExpr("call_start")} AS bucket, 1 AS change FROM call_spans
            UNION ALL
            SELECT ${bucketExpr("call_end")} AS bucket, -1 AS change FROM call_spans
        ),
        bucket_changes AS (
            SELECT bucket, SUM(change) AS net_change
            FROM bucketed_events
            GROUP BY bucket
        )
        SELECT
            bucket AS timestamp,
            SUM(net_change) OVER (ORDER BY bucket ASC)::bigint AS concurrent_calls
        FROM bucket_changes
        ORDER BY bucket ASC
    `;

    return prisma.$queryRaw<ConcurrentCallsRow[]>(query);
}

// ============================================
// QUEUE TRENDS (daily/hourly breakdown)
// ============================================

export async function getDailyTrendRaw(
    serverId: ServerId,
    queueNumber: string,
    startDate: Date,
    endDate: Date,
    timezone: string = "Europe/Zurich",
    origin: CallOrigin = "both"
): Promise<TrendRow[]> {
    const prisma = getPrismaCdr(serverId);
    const table = cdrTable(await getClassificationRules());
    const cdr = Prisma.raw(table);
    // Provenance : valeur d'énumération contrôlée, jamais une entrée libre.
    const originCond = Prisma.raw(buildOriginConditionSQL(origin, "call_history_id", table));
    // ⚠️ Composée avec Prisma.sql PUIS passée en argument : dans la forme
    // « tagged template », un fragment Prisma.raw serait lié comme une VALEUR
    // ($2) au lieu d'être injecté dans le SQL -> "syntax error at or near $2"
    // (cf. note sur getHeatmapDataRaw).
    const query = Prisma.sql`
        WITH unique_queue_calls AS (
            SELECT DISTINCT ON (call_history_id)
                call_history_id, cdr_id, DATE(cdr_started_at AT TIME ZONE ${timezone}) as call_date
            FROM ${cdr}
            WHERE destination_dn_number = ${queueNumber}
              AND destination_dn_type = 'queue'
              AND cdr_started_at >= ${startDate}
              AND cdr_started_at <= ${endDate}
              AND ${originCond}
            ORDER BY call_history_id, cdr_started_at ASC, cdr_id ASC
        ),
        daily_stats AS (
            SELECT uqc.call_date,
                   COUNT(DISTINCT uqc.call_history_id) as received,
                   COUNT(DISTINCT CASE WHEN c.cdr_answered_at IS NOT NULL AND c.destination_dn_type = 'extension'
                                  THEN uqc.call_history_id END) as answered,
                   COUNT(DISTINCT CASE WHEN c.termination_reason_details = 'terminated_by_originator'
                                  AND c.cdr_answered_at IS NULL THEN uqc.call_history_id END) as abandoned
            FROM unique_queue_calls uqc
            LEFT JOIN ${cdr} c ON c.originating_cdr_id = uqc.cdr_id
            GROUP BY uqc.call_date
        )
        SELECT * FROM daily_stats ORDER BY call_date;
    `;
    return prisma.$queryRaw<TrendRow[]>(query);
}

export async function getHourlyTrendRaw(
    serverId: ServerId,
    queueNumber: string,
    startDate: Date,
    endDate: Date,
    timezone: string = "Europe/Zurich",
    origin: CallOrigin = "both"
): Promise<TrendRow[]> {
    const prisma = getPrismaCdr(serverId);
    const table = cdrTable(await getClassificationRules());
    const cdr = Prisma.raw(table);
    const originCond = Prisma.raw(buildOriginConditionSQL(origin, "call_history_id", table));
    // ⚠️ Même précaution que getDailyTrendRaw : Prisma.sql puis appel en argument.
    const query = Prisma.sql`
        WITH unique_queue_calls AS (
            SELECT DISTINCT ON (call_history_id)
                call_history_id, cdr_id, EXTRACT(HOUR FROM cdr_started_at AT TIME ZONE ${timezone}) as call_hour
            FROM ${cdr}
            WHERE destination_dn_number = ${queueNumber}
              AND destination_dn_type = 'queue'
              AND cdr_started_at >= ${startDate}
              AND cdr_started_at <= ${endDate}
              AND ${originCond}
            ORDER BY call_history_id, cdr_started_at ASC, cdr_id ASC
        ),
        hourly_stats AS (
            SELECT uqc.call_hour,
                   COUNT(DISTINCT uqc.call_history_id) as received,
                   COUNT(DISTINCT CASE WHEN c.cdr_answered_at IS NOT NULL AND c.destination_dn_type = 'extension'
                                  THEN uqc.call_history_id END) as answered,
                   COUNT(DISTINCT CASE WHEN c.termination_reason_details = 'terminated_by_originator'
                                  AND c.cdr_answered_at IS NULL THEN uqc.call_history_id END) as abandoned
            FROM unique_queue_calls uqc
            LEFT JOIN ${cdr} c ON c.originating_cdr_id = uqc.cdr_id
            GROUP BY uqc.call_hour
        )
        SELECT * FROM hourly_stats ORDER BY call_hour;
    `;
    return prisma.$queryRaw<TrendRow[]>(query);
}

// ============================================
// SIMPLE LOOKUPS
// ============================================

export async function getQueueName(serverId: ServerId, queueNumber: string): Promise<string> {
    const prisma = getPrismaCdr(serverId);
    const queueInfo = await prisma.$queryRaw<any[]>`
        SELECT DISTINCT destination_dn_name AS queue_name
        FROM cdroutput
        WHERE destination_dn_number = ${queueNumber}
          AND destination_dn_type = 'queue'
        LIMIT 1;
    `;
    return queueInfo[0]?.queue_name || queueNumber;
}

export async function getQueueMembersRaw(serverId: ServerId): Promise<QueueMemberRow[]> {
    const prisma = getPrismaCdr(serverId);
    return prisma.$queryRaw<QueueMemberRow[]>`
        WITH QueueMembers AS (
            SELECT 
                parent.destination_dn_number AS queue_number,
                parent.destination_dn_name AS queue_name,
                child.destination_dn_number AS agent_extension,
                child.destination_dn_name AS agent_name,
                COUNT(*) as attempts_count,
                MAX(child.cdr_started_at) as last_seen_at
            FROM cdroutput child
            JOIN cdroutput parent ON child.originating_cdr_id = parent.cdr_id
            WHERE child.creation_method = 'route_to' 
              AND child.creation_forward_reason = 'polling'
              AND parent.destination_dn_type = 'queue'
            GROUP BY parent.destination_dn_number, parent.destination_dn_name,
                     child.destination_dn_number, child.destination_dn_name
        )
        SELECT * FROM QueueMembers ORDER BY queue_number, agent_extension;
    `;
}

// ============================================
// CALL CHAIN (individual segments)
// ============================================

export interface CallSegmentRow {
    cdr_id: string;
    cdr_started_at: Date | null;
    cdr_answered_at: Date | null;
    cdr_ended_at: Date | null;
    source_dn_number: string | null;
    source_participant_phone_number: string | null;
    source_participant_name: string | null;
    source_dn_name: string | null;
    source_dn_type: string | null;
    source_presentation: string | null;
    destination_dn_number: string | null;
    destination_participant_phone_number: string | null;
    destination_participant_name: string | null;
    destination_dn_name: string | null;
    destination_dn_type: string | null;
    destination_entity_type: string | null;
    termination_reason: string | null;
    termination_reason_details: string | null;
    creation_method: string | null;
    creation_forward_reason: string | null;
    originating_cdr_id: string | null;
}

export async function getCallSegments(serverId: ServerId, callHistoryId: string): Promise<CallSegmentRow[]> {
    const prisma = getPrismaCdr(serverId);
    return prisma.cdroutput.findMany({
        where: { call_history_id: callHistoryId },
        orderBy: { cdr_started_at: "asc" },
        select: {
            cdr_id: true,
            cdr_started_at: true,
            cdr_answered_at: true,
            cdr_ended_at: true,
            source_dn_number: true,
            source_participant_phone_number: true,
            source_participant_name: true,
            source_dn_name: true,
            source_dn_type: true,
            source_presentation: true,
            destination_dn_number: true,
            destination_participant_phone_number: true,
            destination_participant_name: true,
            destination_dn_name: true,
            destination_dn_type: true,
            destination_entity_type: true,
            termination_reason: true,
            termination_reason_details: true,
            creation_method: true,
            creation_forward_reason: true,
            originating_cdr_id: true,
        },
    }) as Promise<CallSegmentRow[]>;
}
