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

import { ServerId, getPrismaCdr } from "@/lib/prisma-cdr";
import {
    SQL_SYSTEM_DEST_TYPES,
    SQL_SYSTEM_ENTITY_TYPES,
} from "@/services/domain/call-aggregation";

// ============================================
// TYPES
// ============================================

export interface TimelineRow {
    date_group: Date;
    answered: bigint;
    missed: bigint;
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
// TIMELINE & HEATMAP (Dashboard charts)
// ============================================

export async function getTimelineDataRaw(
    serverId: ServerId,
    startDate: Date,
    endDate: Date
): Promise<TimelineRow[]> {
    const prisma = getPrismaCdr(serverId);
    const diffMs = endDate.getTime() - startDate.getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    const interval = diffDays <= 2 ? "hour" : "day";

    return prisma.$queryRaw<TimelineRow[]>`
        WITH call_aggregates AS (
            SELECT call_history_id,
                   MIN(cdr_started_at) AS first_started_at
            FROM cdroutput
            WHERE cdr_started_at >= ${startDate}
              AND cdr_started_at <= ${endDate}
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
            FROM cdroutput
            WHERE call_history_id IN (SELECT call_history_id FROM call_aggregates)
            ORDER BY call_history_id, cdr_ended_at DESC, cdr_started_at DESC, cdr_id DESC
        ),
        answered_segments AS (
            SELECT DISTINCT ON (call_history_id)
                call_history_id,
                cdr_answered_at AS answered_at
            FROM cdroutput
            WHERE call_history_id IN (SELECT call_history_id FROM call_aggregates)
              AND cdr_answered_at IS NOT NULL
              AND destination_dn_type = 'extension'
            ORDER BY call_history_id, cdr_answered_at ASC, cdr_id ASC
        ),
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
                            WHEN ls.last_dest_type IN (${SQL_SYSTEM_DEST_TYPES})
                                 OR ls.last_dest_entity_type IN (${SQL_SYSTEM_ENTITY_TYPES})
                                THEN CASE WHEN ans.answered_at IS NOT NULL THEN 'answered' ELSE 'abandoned' END
                            ELSE 'answered'
                            END
                    ELSE 'abandoned'
                END AS outcome
            FROM call_aggregates ca
            JOIN last_segments ls ON ls.call_history_id = ca.call_history_id
            LEFT JOIN answered_segments ans ON ans.call_history_id = ca.call_history_id
        )
        SELECT
            date_trunc(${interval}, first_started_at) AS date_group,
            COUNT(*) FILTER (WHERE outcome = 'answered') AS answered,
            COUNT(*) FILTER (WHERE outcome IN ('abandoned', 'busy')) AS missed
        FROM call_outcomes
        GROUP BY date_group
        ORDER BY date_group ASC
    `;
}

export async function getHeatmapDataRaw(
    serverId: ServerId,
    startDate: Date,
    endDate: Date
): Promise<HeatmapRow[]> {
    const prisma = getPrismaCdr(serverId);
    return prisma.$queryRaw<HeatmapRow[]>`
        WITH unique_calls AS (
            SELECT
                call_history_id,
                MIN(cdr_started_at) AS first_started_at
            FROM cdroutput
            WHERE cdr_started_at >= ${startDate}
              AND cdr_started_at <= ${endDate}
            GROUP BY call_history_id
        )
        SELECT
            EXTRACT(ISODOW FROM first_started_at)::int AS day_of_week,
            EXTRACT(HOUR FROM first_started_at)::int AS hour_of_day,
            COUNT(*) AS volume
        FROM unique_calls
        GROUP BY day_of_week, hour_of_day
    `;
}

// ============================================
// CONCURRENT CALLS (Licence monitoring)
// ============================================

export async function getConcurrentCallsData(
    serverId: ServerId,
    startDate: Date,
    endDate: Date
): Promise<ConcurrentCallsRow[]> {
    const prisma = getPrismaCdr(serverId);
    const diffMs = endDate.getTime() - startDate.getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);

    if (diffDays <= 1) {
        return prisma.$queryRaw<ConcurrentCallsRow[]>`
            WITH call_spans AS (
                SELECT
                    call_history_id,
                    MIN(cdr_started_at) AS call_start,
                    MAX(cdr_ended_at) AS call_end
                FROM cdroutput
                WHERE cdr_started_at >= ${startDate}
                  AND cdr_started_at <= ${endDate}
                  AND call_history_id IS NOT NULL
                GROUP BY call_history_id
                HAVING MIN(cdr_started_at) IS NOT NULL
                   AND MAX(cdr_ended_at) IS NOT NULL
            ),
            bucketed_events AS (
                SELECT 
                    date_trunc('minute', call_start) AS bucket,
                    1 AS change
                FROM call_spans
                UNION ALL
                SELECT 
                    date_trunc('minute', call_end) AS bucket,
                    -1 AS change
                FROM call_spans
            ),
            bucket_changes AS (
                SELECT 
                    bucket,
                    SUM(change) AS net_change
                FROM bucketed_events
                GROUP BY bucket
            )
            SELECT
                bucket AS timestamp,
                SUM(net_change) OVER (ORDER BY bucket ASC)::bigint AS concurrent_calls
            FROM bucket_changes
            ORDER BY bucket ASC
        `;
    } else if (diffDays <= 7) {
        return prisma.$queryRaw<ConcurrentCallsRow[]>`
            WITH call_spans AS (
                SELECT
                    call_history_id,
                    MIN(cdr_started_at) AS call_start,
                    MAX(cdr_ended_at) AS call_end
                FROM cdroutput
                WHERE cdr_started_at >= ${startDate}
                  AND cdr_started_at <= ${endDate}
                  AND call_history_id IS NOT NULL
                GROUP BY call_history_id
                HAVING MIN(cdr_started_at) IS NOT NULL
                   AND MAX(cdr_ended_at) IS NOT NULL
            ),
            bucketed_events AS (
                SELECT 
                    date_trunc('hour', call_start) + (EXTRACT(MINUTE FROM call_start)::int / 5) * INTERVAL '5 minutes' AS bucket,
                    1 AS change
                FROM call_spans
                UNION ALL
                SELECT 
                    date_trunc('hour', call_end) + (EXTRACT(MINUTE FROM call_end)::int / 5) * INTERVAL '5 minutes' AS bucket,
                    -1 AS change
                FROM call_spans
            ),
            bucket_changes AS (
                SELECT 
                    bucket,
                    SUM(change) AS net_change
                FROM bucketed_events
                GROUP BY bucket
            )
            SELECT
                bucket AS timestamp,
                SUM(net_change) OVER (ORDER BY bucket ASC)::bigint AS concurrent_calls
            FROM bucket_changes
            ORDER BY bucket ASC
        `;
    } else {
        return prisma.$queryRaw<ConcurrentCallsRow[]>`
            WITH call_spans AS (
                SELECT
                    call_history_id,
                    MIN(cdr_started_at) AS call_start,
                    MAX(cdr_ended_at) AS call_end
                FROM cdroutput
                WHERE cdr_started_at >= ${startDate}
                  AND cdr_started_at <= ${endDate}
                  AND call_history_id IS NOT NULL
                GROUP BY call_history_id
                HAVING MIN(cdr_started_at) IS NOT NULL
                   AND MAX(cdr_ended_at) IS NOT NULL
            ),
            bucketed_events AS (
                SELECT 
                    date_trunc('hour', call_start) AS bucket,
                    1 AS change
                FROM call_spans
                UNION ALL
                SELECT 
                    date_trunc('hour', call_end) AS bucket,
                    -1 AS change
                FROM call_spans
            ),
            bucket_changes AS (
                SELECT 
                    bucket,
                    SUM(change) AS net_change
                FROM bucketed_events
                GROUP BY bucket
            )
            SELECT
                bucket AS timestamp,
                SUM(net_change) OVER (ORDER BY bucket ASC)::bigint AS concurrent_calls
            FROM bucket_changes
            ORDER BY bucket ASC
        `;
    }
}

// ============================================
// QUEUE TRENDS (daily/hourly breakdown)
// ============================================

export async function getDailyTrendRaw(
    serverId: ServerId,
    queueNumber: string,
    startDate: Date,
    endDate: Date
): Promise<TrendRow[]> {
    const prisma = getPrismaCdr(serverId);
    return prisma.$queryRaw<TrendRow[]>`
        WITH unique_queue_calls AS (
            SELECT DISTINCT ON (call_history_id)
                call_history_id, cdr_id, DATE(cdr_started_at) as call_date
            FROM cdroutput
            WHERE destination_dn_number = ${queueNumber}
              AND destination_dn_type = 'queue'
              AND cdr_started_at >= ${startDate}
              AND cdr_started_at <= ${endDate}
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
            LEFT JOIN cdroutput c ON c.originating_cdr_id = uqc.cdr_id
            GROUP BY uqc.call_date
        )
        SELECT * FROM daily_stats ORDER BY call_date;
    `;
}

export async function getHourlyTrendRaw(
    serverId: ServerId,
    queueNumber: string,
    startDate: Date,
    endDate: Date
): Promise<TrendRow[]> {
    const prisma = getPrismaCdr(serverId);
    return prisma.$queryRaw<TrendRow[]>`
        WITH unique_queue_calls AS (
            SELECT DISTINCT ON (call_history_id)
                call_history_id, cdr_id, EXTRACT(HOUR FROM cdr_started_at) as call_hour
            FROM cdroutput
            WHERE destination_dn_number = ${queueNumber}
              AND destination_dn_type = 'queue'
              AND cdr_started_at >= ${startDate}
              AND cdr_started_at <= ${endDate}
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
            LEFT JOIN cdroutput c ON c.originating_cdr_id = uqc.cdr_id
            GROUP BY uqc.call_hour
        )
        SELECT * FROM hourly_stats ORDER BY call_hour;
    `;
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
