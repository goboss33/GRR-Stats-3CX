/**
 * CDR Repository — Single Source of Truth for Database Access
 * 
 * This is the ONLY module that executes raw SQL queries against the cdroutput table.
 * All services (dashboard, logs, statistics) must go through this repository.
 * 
 * Architecture: Repository Pattern
 * - Encapsulates all SQL query logic
 * - Returns typed data structures
 * - Services compose repository calls + business logic
 */

"use server";

import { prisma } from "@/lib/prisma";

// ============================================
// TYPES
// ============================================

export interface PeriodMetrics {
    total_calls: bigint;
    answered_calls: bigint;
    missed_calls: bigint;
    voicemail_calls: bigint;
    busy_calls: bigint;
    avg_human_duration: number | null;
    avg_wait_time: number | null;
    avg_agents_per_call: number | null;
    agents_1: bigint;
    agents_2: bigint;
    agents_3_plus: bigint;
}

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

export interface QueueKpiRow {
    total_passages: bigint;
    unique_calls: bigint;
    unique_answered: bigint;
    unique_abandoned: bigint;
    unique_abandoned_before_10s: bigint;
    unique_abandoned_after_10s: bigint;
    unique_overflow: bigint;
    avg_wait_time: number | null;
    avg_talk_time: number | null;
}

export interface AgentDataRow {
    extension: string;
    name: string;
    calls_received: bigint;
    resolved: bigint;
    total_handling_time: number;
    direct_received: bigint;
    direct_answered: bigint;
    direct_talk_time: number;
}

export interface TrendRow {
    call_date: Date | null;
    call_hour: number | null;
    received: bigint;
    answered: bigint;
    abandoned: bigint;
}

export interface OverflowDestRow {
    destination: string;
    destination_name: string;
    count: bigint;
}

export interface TeamDirectRow {
    direct_received: bigint;
    direct_answered: bigint;
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
// GLOBAL METRICS (Dashboard)
// ============================================

export async function getGlobalMetricsRaw(
    startDate: Date,
    endDate: Date
): Promise<PeriodMetrics> {
    const result = await prisma.$queryRaw<[PeriodMetrics]>`
        WITH call_aggregates AS (
            SELECT call_history_id,
                   MIN(cdr_started_at) AS first_started_at,
                   MAX(cdr_ended_at) AS last_ended_at
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
                ls.call_history_id,
                CASE
                    WHEN ls.last_dest_type IN ('vmail_console', 'voicemail') OR ls.last_dest_entity_type = 'voicemail'
                        THEN 'voicemail'
                    WHEN LOWER(COALESCE(ls.termination_reason_details, '')) LIKE '%busy%'
                        THEN 'busy'
                    WHEN ls.last_answered_at IS NOT NULL
                         AND EXTRACT(EPOCH FROM (ls.last_ended_at - ls.last_started_at)) > 1
                        THEN CASE
                            WHEN ls.last_dest_type IN ('queue', 'ring_group', 'ring_group_ring_all', 'ivr', 'process', 'parking', 'script')
                                 OR ls.last_dest_entity_type IN ('queue', 'ivr')
                                THEN CASE WHEN ans.answered_at IS NOT NULL THEN 'answered' ELSE 'abandoned' END
                            ELSE 'answered'
                            END
                    ELSE 'abandoned'
                END AS outcome
            FROM last_segments ls
            LEFT JOIN answered_segments ans ON ans.call_history_id = ls.call_history_id
        ),
        answered_calls_data AS (
            SELECT
                ca.call_history_id,
                SUM(
                    CASE WHEN c.destination_dn_type = 'extension' AND c.cdr_answered_at IS NOT NULL AND c.cdr_ended_at IS NOT NULL
                         THEN EXTRACT(EPOCH FROM (c.cdr_ended_at - c.cdr_answered_at))
                         ELSE 0
                    END
                ) AS human_talk_time,
                EXTRACT(EPOCH FROM (ca.last_ended_at - ca.first_started_at)) AS total_clock_duration,
                COUNT(DISTINCT CASE WHEN c.destination_dn_type = 'extension' AND c.cdr_answered_at IS NOT NULL THEN c.destination_dn_number ELSE NULL END) AS unique_agents_count
            FROM call_aggregates ca
            JOIN cdroutput c ON c.call_history_id = ca.call_history_id
            WHERE ca.call_history_id IN (SELECT call_history_id FROM call_outcomes WHERE outcome = 'answered')
            GROUP BY ca.call_history_id, ca.last_ended_at, ca.first_started_at
        )
        SELECT
            (SELECT COUNT(*) FROM call_outcomes) AS total_calls,
            (SELECT COUNT(*) FROM call_outcomes WHERE outcome = 'answered') AS answered_calls,
            (SELECT COUNT(*) FROM call_outcomes WHERE outcome = 'abandoned') AS missed_calls,
            (SELECT COUNT(*) FROM call_outcomes WHERE outcome = 'voicemail') AS voicemail_calls,
            (SELECT COUNT(*) FROM call_outcomes WHERE outcome = 'busy') AS busy_calls,
            AVG(human_talk_time) AS avg_human_duration,
            AVG(GREATEST(0, total_clock_duration - human_talk_time)) AS avg_wait_time,
            AVG(unique_agents_count) FILTER (WHERE unique_agents_count > 0) AS avg_agents_per_call,
            COUNT(*) FILTER (WHERE unique_agents_count = 1) AS agents_1,
            COUNT(*) FILTER (WHERE unique_agents_count = 2) AS agents_2,
            COUNT(*) FILTER (WHERE unique_agents_count >= 3) AS agents_3_plus
        FROM answered_calls_data
    `;
    return result[0];
}

export async function getTimelineDataRaw(
    startDate: Date,
    endDate: Date
): Promise<TimelineRow[]> {
    const diffMs = endDate.getTime() - startDate.getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    const interval = diffDays <= 2 ? 'hour' : 'day';

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
                            WHEN ls.last_dest_type IN ('queue', 'ring_group', 'ring_group_ring_all', 'ivr', 'process', 'parking', 'script')
                                 OR ls.last_dest_entity_type IN ('queue', 'ivr')
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
    startDate: Date,
    endDate: Date
): Promise<HeatmapRow[]> {
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
// QUEUE STATISTICS
// ============================================

export async function getQueueName(queueNumber: string): Promise<string> {
    const queueInfo = await prisma.$queryRaw<any[]>`
        SELECT DISTINCT destination_dn_name AS queue_name
        FROM cdroutput
        WHERE destination_dn_number = ${queueNumber}
          AND destination_dn_type = 'queue'
        LIMIT 1;
    `;
    return queueInfo[0]?.queue_name || queueNumber;
}

export async function getQueueKpisRaw(
    queueNumber: string,
    startDate: Date,
    endDate: Date
): Promise<QueueKpiRow> {
    const result = await prisma.$queryRaw<QueueKpiRow[]>`
        WITH all_queue_passages AS (
            SELECT call_history_id, cdr_id, cdr_started_at, cdr_ended_at
            FROM cdroutput
            WHERE destination_dn_number = ${queueNumber}
              AND destination_dn_type = 'queue'
              AND cdr_started_at >= ${startDate}
              AND cdr_started_at <= ${endDate}
        ),
        outcomes AS (
            SELECT
                aqp.cdr_id, aqp.call_history_id, aqp.cdr_started_at, aqp.cdr_ended_at,
                MAX(CASE WHEN ans.originating_cdr_id = aqp.cdr_id AND ans.destination_dn_type = 'extension'
                          AND ans.cdr_answered_at IS NOT NULL AND ans.creation_forward_reason = 'polling'
                     THEN 1 ELSE 0 END) as answered_here,
                MAX(CASE WHEN ans.originating_cdr_id = aqp.cdr_id AND ans.destination_dn_type = 'extension'
                          AND ans.cdr_answered_at IS NOT NULL AND ans.creation_forward_reason = 'polling'
                          AND ans.termination_reason = 'continued_in'
                     THEN 1 ELSE 0 END) as answered_and_transferred,
                MAX(CASE WHEN other_q.destination_dn_type = 'queue' AND other_q.destination_dn_number != ${queueNumber}
                          AND other_q.cdr_started_at > aqp.cdr_started_at
                     THEN 1 ELSE 0 END) as forwarded_to_other_queue,
                MIN(CASE WHEN ans.originating_cdr_id = aqp.cdr_id AND ans.destination_dn_type = 'extension'
                          AND ans.cdr_answered_at IS NOT NULL AND ans.creation_forward_reason = 'polling'
                     THEN EXTRACT(EPOCH FROM (ans.cdr_answered_at - aqp.cdr_started_at)) ELSE NULL END) as wait_time_seconds,
                MAX(CASE WHEN ans.originating_cdr_id = aqp.cdr_id AND ans.destination_dn_type = 'extension'
                          AND ans.cdr_answered_at IS NOT NULL AND ans.creation_forward_reason = 'polling'
                     THEN EXTRACT(EPOCH FROM (ans.cdr_ended_at - ans.cdr_answered_at)) ELSE 0 END) as talk_time_seconds
            FROM all_queue_passages aqp
            LEFT JOIN cdroutput ans ON ans.originating_cdr_id = aqp.cdr_id
            LEFT JOIN cdroutput other_q ON other_q.call_history_id = aqp.call_history_id
                                       AND other_q.cdr_started_at > aqp.cdr_started_at
            GROUP BY aqp.cdr_id, aqp.call_history_id, aqp.cdr_started_at, aqp.cdr_ended_at
        ),
        final_outcomes AS (
            SELECT cdr_id, call_history_id, cdr_started_at, cdr_ended_at, wait_time_seconds, talk_time_seconds,
                   answered_and_transferred,
                   CASE WHEN answered_here = 1 THEN 'answered'
                        WHEN forwarded_to_other_queue = 1 THEN 'overflow'
                        ELSE 'abandoned' END as outcome,
                   EXTRACT(EPOCH FROM (cdr_ended_at - cdr_started_at)) as time_in_queue
            FROM outcomes
        ),
        call_outcomes AS (
            SELECT call_history_id,
                   CASE WHEN bool_or(outcome = 'answered') THEN 'answered'
                        WHEN bool_or(outcome = 'overflow') THEN 'overflow'
                        ELSE 'abandoned' END as call_outcome
            FROM final_outcomes
            GROUP BY call_history_id
        ),
        abandoned_timing AS (
            SELECT DISTINCT ON (fo.call_history_id) fo.call_history_id, fo.time_in_queue
            FROM final_outcomes fo
            JOIN call_outcomes co ON co.call_history_id = fo.call_history_id
            WHERE co.call_outcome = 'abandoned'
            ORDER BY fo.call_history_id, fo.cdr_started_at ASC, fo.cdr_id ASC
        )
        SELECT
            COUNT(*) as total_passages,
            (SELECT COUNT(*) FROM call_outcomes) as unique_calls,
            (SELECT COUNT(*) FROM call_outcomes WHERE call_outcome = 'answered') as unique_answered,
            (SELECT COUNT(*) FROM call_outcomes WHERE call_outcome = 'abandoned') as unique_abandoned,
            (SELECT COUNT(*) FROM abandoned_timing WHERE time_in_queue < 10) as unique_abandoned_before_10s,
            (SELECT COUNT(*) FROM abandoned_timing WHERE time_in_queue >= 10) as unique_abandoned_after_10s,
            (SELECT COUNT(*) FROM call_outcomes WHERE call_outcome = 'overflow') as unique_overflow,
            AVG(wait_time_seconds) as avg_wait_time,
            AVG(CASE WHEN outcome = 'answered' THEN talk_time_seconds ELSE NULL END) as avg_talk_time
        FROM final_outcomes;
    `;
    return result[0];
}

export async function getOverflowDestinationsRaw(
    queueNumber: string,
    startDate: Date,
    endDate: Date
): Promise<OverflowDestRow[]> {
    return prisma.$queryRaw<OverflowDestRow[]>`
        WITH first_queue_passage AS (
            SELECT DISTINCT ON (call_history_id) call_history_id, cdr_id, cdr_started_at
            FROM cdroutput
            WHERE destination_dn_number = ${queueNumber}
              AND destination_dn_type = 'queue'
              AND cdr_started_at >= ${startDate}
              AND cdr_started_at <= ${endDate}
            ORDER BY call_history_id, cdr_started_at ASC, cdr_id ASC
        ),
        queue_with_answer_status AS (
            SELECT fqp.cdr_id, fqp.call_history_id, fqp.cdr_started_at,
                   MAX(CASE WHEN ans.originating_cdr_id = fqp.cdr_id AND ans.destination_dn_type = 'extension'
                             AND ans.cdr_answered_at IS NOT NULL AND ans.creation_forward_reason = 'polling'
                        THEN 1 ELSE 0 END) as answered_here
            FROM first_queue_passage fqp
            LEFT JOIN cdroutput ans ON ans.originating_cdr_id = fqp.cdr_id
            GROUP BY fqp.cdr_id, fqp.call_history_id, fqp.cdr_started_at
        ),
        first_overflow_destination AS (
            SELECT DISTINCT ON (qas.call_history_id)
                qas.call_history_id,
                other_q.destination_dn_number as destination,
                other_q.destination_dn_name as destination_name
            FROM queue_with_answer_status qas
            JOIN cdroutput other_q ON other_q.call_history_id = qas.call_history_id
                                  AND other_q.destination_dn_type = 'queue'
                                  AND other_q.destination_dn_number != ${queueNumber}
                                  AND other_q.cdr_started_at > qas.cdr_started_at
            WHERE qas.answered_here = 0
              AND NOT EXISTS (
                  SELECT 1 FROM cdroutput aqp2
                  JOIN cdroutput ans2 ON ans2.originating_cdr_id = aqp2.cdr_id
                  WHERE aqp2.call_history_id = qas.call_history_id
                    AND aqp2.destination_dn_number = ${queueNumber}
                    AND aqp2.destination_dn_type = 'queue'
                    AND aqp2.cdr_started_at >= ${startDate}
                    AND aqp2.cdr_started_at <= ${endDate}
                    AND ans2.destination_dn_type = 'extension'
                    AND ans2.cdr_answered_at IS NOT NULL
                    AND ans2.creation_forward_reason = 'polling'
              )
            ORDER BY qas.call_history_id, other_q.cdr_started_at ASC, other_q.cdr_id ASC
        )
        SELECT destination, destination_name, COUNT(*) as count
        FROM first_overflow_destination
        GROUP BY destination, destination_name
        ORDER BY count DESC;
    `;
}

export async function getTeamDirectStatsRaw(
    queueNumber: string,
    startDate: Date,
    endDate: Date
): Promise<TeamDirectRow> {
    const result = await prisma.$queryRaw<TeamDirectRow[]>`
        WITH all_queue_passages AS (
            SELECT call_history_id, cdr_id
            FROM cdroutput
            WHERE destination_dn_number = ${queueNumber}
              AND destination_dn_type = 'queue'
              AND cdr_started_at >= ${startDate}
              AND cdr_started_at <= ${endDate}
        ),
        queue_agents AS (
            SELECT DISTINCT c.destination_dn_number as extension
            FROM all_queue_passages aqp
            JOIN cdroutput c ON c.originating_cdr_id = aqp.cdr_id
            WHERE c.destination_dn_type = 'extension'
        )
        SELECT
            COUNT(DISTINCT c.call_history_id) as direct_received,
            COUNT(DISTINCT CASE WHEN c.cdr_answered_at IS NOT NULL THEN c.call_history_id END) as direct_answered
        FROM cdroutput c
        WHERE c.destination_dn_type = 'extension'
          AND c.destination_dn_number IN (SELECT extension FROM queue_agents)
          AND c.cdr_started_at >= ${startDate}
          AND c.cdr_started_at <= ${endDate}
          AND (c.creation_forward_reason IS DISTINCT FROM 'polling')
          AND NOT EXISTS (SELECT 1 FROM all_queue_passages aqp WHERE aqp.cdr_id = c.originating_cdr_id)
          AND NOT (c.cdr_answered_at IS NULL AND EXTRACT(EPOCH FROM (c.cdr_ended_at - c.cdr_started_at)) < 1);
    `;
    return result[0];
}

export async function getAgentStatsRaw(
    queueNumber: string,
    startDate: Date,
    endDate: Date
): Promise<AgentDataRow[]> {
    return prisma.$queryRaw<AgentDataRow[]>`
        WITH all_queue_passages AS (
            SELECT call_history_id, cdr_id, cdr_started_at
            FROM cdroutput
            WHERE destination_dn_number = ${queueNumber}
              AND destination_dn_type = 'queue'
              AND cdr_started_at >= ${startDate}
              AND cdr_started_at <= ${endDate}
        ),
        latest_agent_names AS (
            SELECT DISTINCT ON (destination_dn_number)
                destination_dn_number as extension,
                destination_dn_name as latest_name
            FROM cdroutput
            WHERE destination_dn_type = 'extension'
              AND destination_dn_name IS NOT NULL
              AND destination_dn_name != ''
            ORDER BY destination_dn_number, cdr_started_at DESC, cdr_id DESC
        ),
        passage_outcomes AS (
            SELECT aqp.cdr_id, aqp.call_history_id, aqp.cdr_started_at,
                   MAX(CASE WHEN ans.originating_cdr_id = aqp.cdr_id AND ans.destination_dn_type = 'extension'
                             AND ans.cdr_answered_at IS NOT NULL AND ans.creation_forward_reason = 'polling'
                        THEN 1 ELSE 0 END) as answered_here
            FROM all_queue_passages aqp
            LEFT JOIN cdroutput ans ON ans.originating_cdr_id = aqp.cdr_id
            GROUP BY aqp.cdr_id, aqp.call_history_id, aqp.cdr_started_at
        ),
        answered_passages AS (
            SELECT po.call_history_id, po.cdr_id, po.cdr_started_at,
                   c.destination_dn_number as extension,
                   c.destination_dn_name as name,
                   c.cdr_answered_at, c.cdr_ended_at
            FROM passage_outcomes po
            JOIN cdroutput c ON c.originating_cdr_id = po.cdr_id
            WHERE po.answered_here = 1
              AND c.destination_dn_type = 'extension'
              AND c.cdr_answered_at IS NOT NULL
              AND c.creation_forward_reason = 'polling'
        ),
        last_answered AS (
            SELECT DISTINCT ON (call_history_id) call_history_id, cdr_id
            FROM answered_passages
            ORDER BY call_history_id, cdr_started_at DESC, cdr_id DESC
        ),
        queue_agents AS (
            SELECT DISTINCT c.destination_dn_number as extension
            FROM all_queue_passages aqp
            JOIN cdroutput c ON c.originating_cdr_id = aqp.cdr_id
            WHERE c.destination_dn_type = 'extension'
        ),
        agent_resolved AS (
            SELECT extension, name, COUNT(DISTINCT call_history_id) as resolved
            FROM answered_passages
            WHERE cdr_id IN (SELECT cdr_id FROM last_answered)
            GROUP BY extension, name
        ),
        agent_calls_received AS (
            SELECT c.destination_dn_number as extension,
                   COUNT(DISTINCT aqp.call_history_id) as calls_received
            FROM all_queue_passages aqp
            JOIN cdroutput c ON c.originating_cdr_id = aqp.cdr_id
            WHERE c.destination_dn_type = 'extension'
              AND c.creation_forward_reason = 'polling'
            GROUP BY c.destination_dn_number
        ),
        agent_handling AS (
            SELECT extension,
                   SUM(EXTRACT(EPOCH FROM (cdr_ended_at - cdr_answered_at))) as total_handling_time
            FROM answered_passages
            GROUP BY extension
        ),
        direct_calls AS (
            SELECT c.destination_dn_number as extension,
                   COUNT(DISTINCT c.call_history_id) as direct_received,
                   COUNT(DISTINCT CASE WHEN c.cdr_answered_at IS NOT NULL THEN c.call_history_id END) as direct_answered,
                   SUM(CASE WHEN c.cdr_answered_at IS NOT NULL
                       THEN EXTRACT(EPOCH FROM (c.cdr_ended_at - c.cdr_answered_at)) ELSE 0 END) as direct_talk_time
            FROM cdroutput c
            WHERE c.destination_dn_type = 'extension'
              AND c.destination_dn_number IN (SELECT extension FROM queue_agents)
              AND c.cdr_started_at >= ${startDate}
              AND c.cdr_started_at <= ${endDate}
              AND (c.creation_forward_reason IS DISTINCT FROM 'polling')
              AND NOT EXISTS (SELECT 1 FROM all_queue_passages aqp WHERE aqp.cdr_id = c.originating_cdr_id)
              AND NOT (c.cdr_answered_at IS NULL AND EXTRACT(EPOCH FROM (c.cdr_ended_at - c.cdr_started_at)) < 1)
            GROUP BY c.destination_dn_number
        )
        SELECT
            COALESCE(ar.extension, dc.extension) as extension,
            COALESCE(lan.latest_name, ar.name, COALESCE(ar.extension, dc.extension)) as name,
            COALESCE(acr.calls_received, 0) as calls_received,
            COALESCE(ar.resolved, 0) as resolved,
            COALESCE(ah.total_handling_time, 0) as total_handling_time,
            COALESCE(dc.direct_received, 0) as direct_received,
            COALESCE(dc.direct_answered, 0) as direct_answered,
            COALESCE(dc.direct_talk_time, 0) as direct_talk_time
        FROM agent_resolved ar
        FULL OUTER JOIN direct_calls dc ON dc.extension = ar.extension
        LEFT JOIN agent_calls_received acr ON acr.extension = COALESCE(ar.extension, dc.extension)
        LEFT JOIN agent_handling ah ON ah.extension = COALESCE(ar.extension, dc.extension)
        LEFT JOIN latest_agent_names lan ON lan.extension = COALESCE(ar.extension, dc.extension)
        WHERE COALESCE(ar.resolved, 0) > 0 OR COALESCE(dc.direct_answered, 0) > 0
        ORDER BY COALESCE(ar.resolved, 0) DESC;
    `;
}

export async function getDailyTrendRaw(
    queueNumber: string,
    startDate: Date,
    endDate: Date
): Promise<TrendRow[]> {
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
    queueNumber: string,
    startDate: Date,
    endDate: Date
): Promise<TrendRow[]> {
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
// QUEUE MEMBERS
// ============================================

export async function getQueueMembersRaw(): Promise<QueueMemberRow[]> {
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

export async function getCallSegments(callHistoryId: string): Promise<CallSegmentRow[]> {
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
