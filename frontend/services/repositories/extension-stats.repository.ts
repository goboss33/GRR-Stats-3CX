// ============================================
// EXTENSION / DDI STATS REPOSITORY
// Purpose-built, lightweight SQL for the statistics-extension page.
//
// Performance design (vs. the old approach that reused the full logs query):
// - ONE grouped query per direction for a whole list of entries
//   (instead of 2 heavy queries per extension => pool timeouts).
// - Only the CTEs that are strictly needed: no call_journey / call_queues /
//   handled_by / queue_outcome (they are display-only on the logs page).
// - Match FIRST (via indexed columns), aggregate only the matched calls
//   afterwards — instead of aggregating the whole period then filtering.
//
// Consistency design:
// - Inbound ("callee") semantics = same as the logs page: the FIRST segment
//   destination decides, plus the provider "Name:" special case. For DDIs,
//   source_participant_trunk_did on ANY segment qualifies the call (the DDI
//   genuinely carried it).
// - Outbound ("caller") semantics = same as the logs page: aggregation over
//   the segments whose source matches.
// ============================================

import { ServerId, getPrismaCdr } from "@/lib/prisma-cdr";
import { cdrTable } from "@/services/domain/call-classification";
import { getClassificationRules } from "@/lib/classification-rules";
import type { HeatmapDataPoint } from "@/services/domain/call.types";
import type { SearchPatternMode } from "@/services/domain/extension-search";
import type { ExtensionDirectory } from "@/types/extension-stats.types";

// --------------------------------------------
// Public types
// --------------------------------------------

export interface StatsMatcherInput {
    /** Unique id of the search entry (the raw user input) */
    entryId: string;
    /** Exact extension number (kind = extension) */
    extNumber: string | null;
    /** Textual DDI variants matched by equality (kind = ddi) */
    ddiVariants: string[] | null;
    /** Extension associated with a DDI (outbound calls made presenting this DDI) */
    assocExt: string | null;
    /** Wildcard pattern (kind = pattern) */
    patMode: SearchPatternMode | null;
    patValue: string | null;
}

export interface StatsQueryOptions {
    weekdays?: number[];
    timeStart?: string;
    timeEnd?: string;
    minDurationSeconds?: number;
}

export interface DayStatsRow {
    entryId: string;
    /** yyyy-MM-dd in the tenant timezone */
    day: string;
    totalCount: number;
    answeredCount: number;
    missedCount: number;
    voicemailCount: number;
    busyCount: number;
    totalDurationSeconds: number;
    maxDurationSeconds: number;
}

// --------------------------------------------
// SQL helpers (values are digits/names coming from the user — escape quotes)
// --------------------------------------------

function esc(value: string): string {
    return value.replace(/'/g, "''");
}

function sqlStr(value: string): string {
    return `'${esc(value)}'`;
}

function sqlTextArray(values: string[]): string {
    return `ARRAY[${values.map(sqlStr).join(", ")}]::text[]`;
}

function buildMatchListValues(matchers: StatsMatcherInput[]): string {
    return matchers
        .map((m) => {
            const ext = m.extNumber ? sqlStr(m.extNumber) : "NULL::text";
            const ddi = m.ddiVariants && m.ddiVariants.length > 0 ? sqlTextArray(m.ddiVariants) : "NULL::text[]";
            const assoc = m.assocExt ? sqlStr(m.assocExt) : "NULL::text";
            const mode = m.patMode ? sqlStr(m.patMode) : "NULL::text";
            const val = m.patValue ? sqlStr(m.patValue) : "NULL::text";
            return `(${sqlStr(m.entryId)}, ${ext}, ${ddi}, ${assoc}, ${mode}, ${val})`;
        })
        .join(",\n        ");
}

/** Pattern condition on a column, driven by match_list columns (data, not code). */
function patCond(field: string): string {
    return `(CASE m.pat_mode
        WHEN 'exact' THEN LOWER(${field}) = LOWER(m.pat_value)
        WHEN 'startsWith' THEN ${field} ILIKE m.pat_value || '%'
        WHEN 'endsWith' THEN ${field} ILIKE '%' || m.pat_value
        ELSE ${field} ILIKE '%' || m.pat_value || '%'
    END)`;
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Optional advanced filters, applied on per-call aggregates (alias exposes first_started_at / last_ended_at). */
function buildCallFilters(alias: string, timezone: string, options: StatsQueryOptions): string {
    const tz = esc(timezone);
    const clauses: string[] = [];

    if (options.weekdays && options.weekdays.length > 0 && options.weekdays.length < 7) {
        const days = options.weekdays.filter((d) => Number.isInteger(d) && d >= 1 && d <= 7);
        if (days.length > 0) {
            clauses.push(`EXTRACT(ISODOW FROM (${alias}.first_started_at AT TIME ZONE '${tz}'))::int = ANY(ARRAY[${days.join(",")}])`);
        }
    }
    if (options.timeStart && TIME_RE.test(options.timeStart)) {
        clauses.push(`(${alias}.first_started_at AT TIME ZONE '${tz}')::time >= '${options.timeStart}'::time`);
    }
    if (options.timeEnd && TIME_RE.test(options.timeEnd)) {
        clauses.push(`(${alias}.first_started_at AT TIME ZONE '${tz}')::time < '${options.timeEnd}'::time`);
    }
    if (options.minDurationSeconds && options.minDurationSeconds > 0) {
        clauses.push(`EXTRACT(EPOCH FROM (${alias}.last_ended_at - ${alias}.first_started_at)) >= ${Math.floor(options.minDurationSeconds)}`);
    }

    return clauses.length > 0 ? `WHERE ${clauses.join("\n  AND ")}` : "";
}

/** Status counters — identical definitions to the logs page (source of truth). */
const STATUS_AGGREGATES = `
    COUNT(*) AS total_count,
    COUNT(*) FILTER (WHERE
        COALESCE(ls.last_dest_entity_type, '') NOT IN ('voicemail')
        AND COALESCE(ls.termination_reason_details, '') NOT ILIKE '%busy%'
        AND COALESCE(ls.last_dest_type, '') NOT IN ('vmail_console', 'voicemail')
        AND lh.lh_answered_at IS NOT NULL
        AND EXTRACT(EPOCH FROM (lh.lh_ended_at - lh.lh_started_at)) > 1
    ) AS answered_count,
    COUNT(*) FILTER (WHERE
        COALESCE(ls.termination_reason_details, '') NOT ILIKE '%busy%'
        AND COALESCE(ls.last_dest_type, '') NOT IN ('vmail_console', 'voicemail')
        AND COALESCE(ls.last_dest_entity_type, '') != 'voicemail'
        AND (
            lh.lh_answered_at IS NULL
            OR EXTRACT(EPOCH FROM (lh.lh_ended_at - lh.lh_started_at)) <= 1
        )
    ) AS missed_count,
    COUNT(*) FILTER (WHERE
        ls.last_dest_type IN ('vmail_console', 'voicemail')
        OR ls.last_dest_entity_type = 'voicemail'
    ) AS voicemail_count,
    COUNT(*) FILTER (WHERE ls.termination_reason_details ILIKE '%busy%') AS busy_count
`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapDayRow(row: any): DayStatsRow {
    return {
        entryId: String(row.entry_id),
        day: String(row.day),
        totalCount: Number(row.total_count || 0),
        answeredCount: Number(row.answered_count || 0),
        missedCount: Number(row.missed_count || 0),
        voicemailCount: Number(row.voicemail_count || 0),
        busyCount: Number(row.busy_count || 0),
        totalDurationSeconds: Math.round(Number(row.total_duration_seconds || 0)),
        maxDurationSeconds: Math.round(Number(row.max_duration_seconds || 0)),
    };
}

// --------------------------------------------
// INBOUND (callee) — grouped per entry and per day
// --------------------------------------------

export async function getInboundDayStats(
    serverId: ServerId,
    matchers: StatsMatcherInput[],
    startDate: Date,
    endDate: Date,
    timezone: string,
    options: StatsQueryOptions
): Promise<DayStatsRow[]> {
    if (matchers.length === 0) return [];
    const prisma = getPrismaCdr(serverId);
    const start = startDate.toISOString();
    const end = endDate.toISOString();
    const tz = esc(timezone);
    // Grain de comptage partagé avec le reste de l'application (règle callGrain).
    const cdr = cdrTable(await getClassificationRules());

    const query = `
    WITH match_list(entry_id, ext_number, ddi_variants, assoc_ext, pat_mode, pat_value) AS (
        VALUES ${buildMatchListValues(matchers)}
    ),
    cand AS (
        -- Candidate calls: destination match (extension) or trunk DID on any segment (DDI)
        SELECT m.entry_id, s.call_history_id,
            BOOL_OR(m.ddi_variants IS NOT NULL AND s.source_participant_trunk_did = ANY(m.ddi_variants)) AS via_trunk
        FROM match_list m
        JOIN ${cdr} s ON s.cdr_started_at >= '${start}' AND s.cdr_started_at <= '${end}'
          AND (
              (m.ext_number IS NOT NULL AND (
                  s.destination_dn_number = m.ext_number
                  OR s.destination_participant_phone_number = m.ext_number))
              OR (m.ddi_variants IS NOT NULL AND (
                  s.source_participant_trunk_did = ANY(m.ddi_variants)
                  OR s.destination_dn_number = ANY(m.ddi_variants)
                  OR s.destination_participant_phone_number = ANY(m.ddi_variants)))
              OR (m.pat_mode IS NOT NULL AND (
                  ${patCond("s.destination_dn_number")}
                  OR ${patCond("s.destination_participant_phone_number")}
                  OR ${patCond("s.destination_participant_name")}
                  OR ${patCond("s.destination_dn_name")}))
          )
        GROUP BY m.entry_id, s.call_history_id
    ),
    first_seg AS (
        SELECT DISTINCT ON (c.call_history_id)
            c.call_history_id,
            c.destination_dn_number,
            c.destination_participant_phone_number,
            c.destination_participant_name,
            c.destination_dn_name,
            c.source_dn_type,
            c.source_participant_name
        FROM ${cdr} c
        JOIN cand ON cand.call_history_id = c.call_history_id
        WHERE c.cdr_started_at >= '${start}' AND c.cdr_started_at <= '${end}'
        ORDER BY c.call_history_id, c.cdr_started_at ASC
    ),
    matched_calls AS (
        -- Logs-page callee semantics: first-segment destination decides.
        -- Exception: a trunk-DID match on any segment is sufficient (real DDI usage).
        SELECT c.entry_id, c.call_history_id
        FROM cand c
        JOIN first_seg f ON f.call_history_id = c.call_history_id
        JOIN match_list m ON m.entry_id = c.entry_id
        WHERE c.via_trunk
           OR (m.ext_number IS NOT NULL AND (
                  f.destination_dn_number = m.ext_number
               OR f.destination_participant_phone_number = m.ext_number
               OR (f.source_dn_type = 'provider' AND f.source_participant_name LIKE '%:%'
                   AND LOWER(f.source_participant_name) = LOWER(m.ext_number))))
           OR (m.ddi_variants IS NOT NULL AND (
                  f.destination_dn_number = ANY(m.ddi_variants)
               OR f.destination_participant_phone_number = ANY(m.ddi_variants)
               OR (f.source_dn_type = 'provider' AND f.source_participant_name LIKE '%:%' AND EXISTS (
                      SELECT 1 FROM unnest(m.ddi_variants) v
                      WHERE f.source_participant_name ILIKE '%' || v))))
           OR (m.pat_mode IS NOT NULL AND (
                  ${patCond("f.destination_dn_number")}
               OR ${patCond("f.destination_participant_phone_number")}
               OR ${patCond("f.destination_participant_name")}
               OR ${patCond("f.destination_dn_name")}
               OR (f.source_dn_type = 'provider' AND f.source_participant_name LIKE '%:%'
                   AND ${patCond("f.source_participant_name")})))
    ),
    call_stats AS (
        SELECT mc.entry_id, c.call_history_id,
            MIN(c.cdr_started_at) AS first_started_at,
            MAX(c.cdr_ended_at) AS last_ended_at
        FROM matched_calls mc
        JOIN ${cdr} c ON c.call_history_id = mc.call_history_id
        WHERE c.cdr_started_at >= '${start}' AND c.cdr_started_at <= '${end}'
        GROUP BY mc.entry_id, c.call_history_id
    ),
    last_seg AS (
        SELECT DISTINCT ON (c.call_history_id)
            c.call_history_id,
            c.destination_dn_type AS last_dest_type,
            c.destination_entity_type AS last_dest_entity_type,
            c.termination_reason_details
        FROM ${cdr} c
        JOIN matched_calls mc ON mc.call_history_id = c.call_history_id
        WHERE c.cdr_started_at >= '${start}' AND c.cdr_started_at <= '${end}'
        ORDER BY c.call_history_id, c.cdr_ended_at DESC, c.cdr_started_at DESC, c.cdr_id DESC
    ),
    last_human AS (
        SELECT DISTINCT ON (c.call_history_id)
            c.call_history_id,
            c.cdr_answered_at AS lh_answered_at,
            c.cdr_started_at AS lh_started_at,
            c.cdr_ended_at AS lh_ended_at
        FROM ${cdr} c
        JOIN matched_calls mc ON mc.call_history_id = c.call_history_id
        WHERE c.cdr_started_at >= '${start}' AND c.cdr_started_at <= '${end}'
          AND c.destination_dn_type = 'extension'
          AND COALESCE(c.destination_entity_type, '') != 'voicemail'
        ORDER BY c.call_history_id, c.cdr_ended_at DESC, c.cdr_started_at DESC, c.cdr_id DESC
    )
    SELECT
        cs.entry_id,
        TO_CHAR(cs.first_started_at AT TIME ZONE '${tz}', 'YYYY-MM-DD') AS day,
        ${STATUS_AGGREGATES},
        COALESCE(SUM(EXTRACT(EPOCH FROM (cs.last_ended_at - cs.first_started_at))), 0) AS total_duration_seconds,
        COALESCE(MAX(EXTRACT(EPOCH FROM (cs.last_ended_at - cs.first_started_at))), 0) AS max_duration_seconds
    FROM call_stats cs
    JOIN last_seg ls ON ls.call_history_id = cs.call_history_id
    LEFT JOIN last_human lh ON lh.call_history_id = cs.call_history_id
    ${buildCallFilters("cs", timezone, options)}
    GROUP BY cs.entry_id, day
    ORDER BY cs.entry_id, day
    `;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = await prisma.$queryRawUnsafe<any[]>(query);
    return rows.map(mapDayRow);
}

// --------------------------------------------
// OUTBOUND (caller) — grouped per entry and per day
// --------------------------------------------

export async function getOutboundDayStats(
    serverId: ServerId,
    matchers: StatsMatcherInput[],
    startDate: Date,
    endDate: Date,
    timezone: string,
    options: StatsQueryOptions
): Promise<DayStatsRow[]> {
    if (matchers.length === 0) return [];
    const prisma = getPrismaCdr(serverId);
    const start = startDate.toISOString();
    const end = endDate.toISOString();
    const tz = esc(timezone);
    // Grain de comptage partagé avec le reste de l'application (règle callGrain).
    const cdr = cdrTable(await getClassificationRules());

    const query = `
    WITH match_list(entry_id, ext_number, ddi_variants, assoc_ext, pat_mode, pat_value) AS (
        VALUES ${buildMatchListValues(matchers)}
    ),
    matched_segments AS (
        -- Logs-page caller semantics: keep the segments whose source matches.
        -- For DDIs: source trunk DID (presented caller id) + associated extension.
        SELECT DISTINCT m.entry_id, c.cdr_id, c.call_history_id,
            c.cdr_started_at, c.cdr_ended_at, c.cdr_answered_at,
            c.destination_dn_type, c.destination_entity_type, c.termination_reason_details
        FROM match_list m
        JOIN ${cdr} c ON c.cdr_started_at >= '${start}' AND c.cdr_started_at <= '${end}'
          AND (
              (m.ext_number IS NOT NULL AND (
                  c.source_dn_number = m.ext_number
                  OR c.source_participant_phone_number = m.ext_number))
              OR (m.assoc_ext IS NOT NULL AND c.source_dn_number = m.assoc_ext)
              OR (m.ddi_variants IS NOT NULL AND (
                  c.source_participant_trunk_did = ANY(m.ddi_variants)
                  OR c.source_participant_phone_number = ANY(m.ddi_variants)
                  OR c.source_dn_number = ANY(m.ddi_variants)))
              OR (m.pat_mode IS NOT NULL AND (
                  ${patCond("c.source_dn_number")}
                  OR ${patCond("c.source_participant_phone_number")}
                  OR ${patCond("c.source_participant_name")}
                  OR ${patCond("c.source_dn_name")}))
          )
    ),
    seg_stats AS (
        SELECT entry_id, call_history_id,
            MIN(cdr_started_at) AS first_started_at,
            MAX(cdr_ended_at) AS last_ended_at
        FROM matched_segments
        GROUP BY entry_id, call_history_id
    ),
    last_seg AS (
        SELECT DISTINCT ON (entry_id, call_history_id)
            entry_id, call_history_id,
            destination_dn_type AS last_dest_type,
            destination_entity_type AS last_dest_entity_type,
            termination_reason_details
        FROM matched_segments
        ORDER BY entry_id, call_history_id, cdr_ended_at DESC, cdr_started_at DESC, cdr_id DESC
    ),
    last_human AS (
        SELECT DISTINCT ON (entry_id, call_history_id)
            entry_id, call_history_id,
            cdr_answered_at AS lh_answered_at,
            cdr_started_at AS lh_started_at,
            cdr_ended_at AS lh_ended_at
        FROM matched_segments
        WHERE destination_dn_type = 'extension'
          AND COALESCE(destination_entity_type, '') != 'voicemail'
        ORDER BY entry_id, call_history_id, cdr_ended_at DESC, cdr_started_at DESC, cdr_id DESC
    )
    SELECT
        ss.entry_id,
        TO_CHAR(ss.first_started_at AT TIME ZONE '${tz}', 'YYYY-MM-DD') AS day,
        ${STATUS_AGGREGATES},
        COALESCE(SUM(EXTRACT(EPOCH FROM (ss.last_ended_at - ss.first_started_at))), 0) AS total_duration_seconds,
        COALESCE(MAX(EXTRACT(EPOCH FROM (ss.last_ended_at - ss.first_started_at))), 0) AS max_duration_seconds
    FROM seg_stats ss
    JOIN last_seg ls ON ls.call_history_id = ss.call_history_id AND ls.entry_id = ss.entry_id
    LEFT JOIN last_human lh ON lh.call_history_id = ss.call_history_id AND lh.entry_id = ss.entry_id
    ${buildCallFilters("ss", timezone, options)}
    GROUP BY ss.entry_id, day
    ORDER BY ss.entry_id, day
    `;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = await prisma.$queryRawUnsafe<any[]>(query);
    return rows.map(mapDayRow);
}

// --------------------------------------------
// DIRECTORY — known extensions / DDIs with names (autocomplete + resolution)
// Cached in memory (10 min) to avoid rescanning 12 months on each page load.
// --------------------------------------------

// Cet annuaire coûte un balayage de DOUZE MOIS de CDR (~7 s en local, bien
// davantage sur le serveur) et il est identique pour tous les utilisateurs.
// Il est donc servi comme celui des files (cf. getQueueMembersRaw) : version
// périmée rendue IMMÉDIATEMENT pendant qu'UN rafraîchissement tourne en fond,
// démarrage à froid dédoublonné, et préchauffage au démarrage.
//
// L'ancienne version bloquait à chaque expiration et ne dédoublonnait rien :
// quatre actions serveur simultanées lançaient quatre balayages (mesuré :
// 4 × 7,4 s au lieu d'un seul). Depuis que la résolution de portée le
// consulte, cela se voyait comme un écran de journaux qui ne charge jamais.
const DIRECTORY_TTL_MS = 10 * 60 * 1000;
interface DirectoryCacheEntry {
    data: ExtensionDirectory;
    fetchedAt: number;
    refreshing: boolean;
}
const directoryCache = new Map<ServerId, DirectoryCacheEntry>();
const directoryColdFetch = new Map<ServerId, Promise<ExtensionDirectory>>();

export async function getDirectory(serverId: ServerId, forceRefresh = false): Promise<ExtensionDirectory> {
    const cached = directoryCache.get(serverId);
    if (!forceRefresh && cached) {
        if (Date.now() - cached.fetchedAt >= DIRECTORY_TTL_MS && !cached.refreshing) {
            cached.refreshing = true;
            void queryDirectory(serverId).catch((error) => {
                cached.refreshing = false;
                console.error("[annuaire postes] rafraîchissement en arrière-plan échoué :", error);
            });
        }
        return cached.data;
    }
    if (forceRefresh) return queryDirectory(serverId);

    // Jamais chargé (préchauffage en cours ou en échec) : une seule requête,
    // même si plusieurs visiteurs arrivent en même temps.
    let pending = directoryColdFetch.get(serverId);
    if (!pending) {
        pending = queryDirectory(serverId).finally(() => directoryColdFetch.delete(serverId));
        directoryColdFetch.set(serverId, pending);
    }
    return pending;
}

/** Préchauffe l'annuaire des postes d'un tenant (cf. warmExtensionDirectory). */
export async function warmExtensionDirectory(): Promise<void> {
    const { getAvailableServers } = await import("@/lib/servers");
    for (const serverId of getAvailableServers()) {
        try {
            const t0 = Date.now();
            await queryDirectory(serverId);
            console.log(`[annuaire postes] préchauffé pour ${serverId} en ${Date.now() - t0} ms`);
        } catch (error) {
            console.error(`[annuaire postes] préchauffage impossible pour ${serverId} :`, error);
        }
    }
}

async function queryDirectory(serverId: ServerId): Promise<ExtensionDirectory> {
    const prisma = getPrismaCdr(serverId);

    const extensionsQuery = `
        WITH recent AS (
            SELECT destination_dn_number AS number,
                   NULLIF(TRIM(destination_dn_name), '') AS name,
                   cdr_started_at
            FROM cdroutput
            WHERE cdr_started_at >= NOW() - INTERVAL '12 months'
              AND destination_dn_type = 'extension'
              AND destination_dn_number IS NOT NULL AND destination_dn_number <> ''
            UNION ALL
            SELECT source_dn_number AS number, NULL AS name, cdr_started_at
            FROM cdroutput
            WHERE cdr_started_at >= NOW() - INTERVAL '12 months'
              AND source_dn_type = 'extension'
              AND source_dn_number IS NOT NULL AND source_dn_number <> ''
        ),
        named AS (
            SELECT DISTINCT ON (number) number, name
            FROM recent
            WHERE name IS NOT NULL
            ORDER BY number, cdr_started_at DESC
        ),
        all_numbers AS (SELECT DISTINCT number FROM recent)
        SELECT a.number, n.name
        FROM all_numbers a
        LEFT JOIN named n ON n.number = a.number
        ORDER BY a.number
    `;

    const ddisQuery = `
        SELECT DISTINCT ON (source_participant_trunk_did)
            source_participant_trunk_did AS number,
            NULLIF(TRIM(split_part(COALESCE(source_participant_name, ''), ':', 1)), '') AS name
        FROM cdroutput
        WHERE cdr_started_at >= NOW() - INTERVAL '12 months'
          AND source_dn_type = 'provider'
          AND source_participant_trunk_did IS NOT NULL
          AND source_participant_trunk_did <> ''
        ORDER BY source_participant_trunk_did, cdr_started_at DESC
    `;

     
    const [extRows, ddiRows] = await Promise.all([
        prisma.$queryRawUnsafe<any[]>(extensionsQuery),
        prisma.$queryRawUnsafe<any[]>(ddisQuery),
    ]);

    const data: ExtensionDirectory = {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        extensions: extRows.map((r: any) => ({ number: String(r.number), name: r.name ? String(r.name) : null })),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ddis: ddiRows.map((r: any) => ({ number: String(r.number), name: r.name ? String(r.name) : null })),
    };

    directoryCache.set(serverId, { data, fetchedAt: Date.now(), refreshing: false });
    return data;
}

// --------------------------------------------
// HEATMAP — call volume per weekday/hour for a single entry
// --------------------------------------------

export async function getEntryHeatmap(
    serverId: ServerId,
    matcher: StatsMatcherInput,
    startDate: Date,
    endDate: Date,
    timezone: string,
    options: StatsQueryOptions
): Promise<HeatmapDataPoint[]> {
    const prisma = getPrismaCdr(serverId);
    const start = startDate.toISOString();
    const end = endDate.toISOString();
    const tz = esc(timezone);
    // Grain de comptage partagé avec le reste de l'application (règle callGrain).
    const cdr = cdrTable(await getClassificationRules());

    const query = `
    WITH match_list(entry_id, ext_number, ddi_variants, assoc_ext, pat_mode, pat_value) AS (
        VALUES ${buildMatchListValues([matcher])}
    ),
    cand AS (
        SELECT m.entry_id, s.call_history_id,
            BOOL_OR(m.ddi_variants IS NOT NULL AND s.source_participant_trunk_did = ANY(m.ddi_variants)) AS via_trunk
        FROM match_list m
        JOIN ${cdr} s ON s.cdr_started_at >= '${start}' AND s.cdr_started_at <= '${end}'
          AND (
              (m.ext_number IS NOT NULL AND (
                  s.destination_dn_number = m.ext_number
                  OR s.destination_participant_phone_number = m.ext_number
                  OR s.source_dn_number = m.ext_number
                  OR s.source_participant_phone_number = m.ext_number))
              OR (m.ddi_variants IS NOT NULL AND (
                  s.source_participant_trunk_did = ANY(m.ddi_variants)
                  OR s.destination_dn_number = ANY(m.ddi_variants)
                  OR s.destination_participant_phone_number = ANY(m.ddi_variants)
                  OR s.source_dn_number = ANY(m.ddi_variants)
                  OR s.source_participant_phone_number = ANY(m.ddi_variants)))
              OR (m.assoc_ext IS NOT NULL AND s.source_dn_number = m.assoc_ext)
              OR (m.pat_mode IS NOT NULL AND (
                  ${patCond("s.destination_dn_number")}
                  OR ${patCond("s.destination_participant_phone_number")}
                  OR ${patCond("s.destination_participant_name")}
                  OR ${patCond("s.destination_dn_name")}
                  OR ${patCond("s.source_dn_number")}
                  OR ${patCond("s.source_participant_phone_number")}))
          )
        GROUP BY m.entry_id, s.call_history_id
    ),
    call_stats AS (
        SELECT c.call_history_id,
            MIN(c.cdr_started_at) AS first_started_at,
            MAX(c.cdr_ended_at) AS last_ended_at
        FROM cand
        JOIN ${cdr} c ON c.call_history_id = cand.call_history_id
        WHERE c.cdr_started_at >= '${start}' AND c.cdr_started_at <= '${end}'
        GROUP BY c.call_history_id
    )
    SELECT
        EXTRACT(ISODOW FROM (first_started_at AT TIME ZONE '${tz}'))::int AS dow,
        EXTRACT(HOUR FROM (first_started_at AT TIME ZONE '${tz}'))::int AS hour,
        COUNT(*) AS value
    FROM call_stats cs
    ${buildCallFilters("cs", timezone, options)}
    GROUP BY 1, 2
    `;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = await prisma.$queryRawUnsafe<any[]>(query);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return rows.map((r: any) => ({
        dayOfWeek: Number(r.dow),
        hourOfDay: Number(r.hour),
        value: Number(r.value || 0),
    }));
}
