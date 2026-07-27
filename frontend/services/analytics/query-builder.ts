import {
    SQL_SYSTEM_DEST_TYPES,
    SQL_SYSTEM_ENTITY_TYPES,
    buildDirectSegmentWhereClause,
    DEFAULT_BUSINESS_RULES,
} from "@/services/domain/call-aggregation";
import type { LogsFilters, LogsSort } from "@/services/domain/call.types";
import { parseSearchPattern } from "@/services/domain/extension-search";

export interface AnalyticsQueryParams {
    startDate: Date;
    endDate: Date;
    queueNumber?: string;
    agentNumber?: string;
    filters?: LogsFilters;
    sort?: LogsSort;
    page?: number;
    pageSize?: number;
}


function buildSqlSearchCondition(field: string, pattern: ReturnType<typeof parseSearchPattern>): string {
    const escapedValue = pattern.value.replace(/'/g, "''");
    switch (pattern.mode) {
        case 'exact': return `LOWER(${field}) = LOWER('${escapedValue}')`;
        case 'startsWith': return `${field} ILIKE '${escapedValue}%'`;
        case 'endsWith': return `${field} ILIKE '%${escapedValue}'`;
        case 'contains': return `${field} ILIKE '%${escapedValue}%'`;
    }
}

function buildBaseWhereClause(startDate: Date, endDate: Date, queueNumber?: string): string {
    const conditions = [
        `cdr_started_at >= '${startDate.toISOString()}'`,
        `cdr_started_at <= '${endDate.toISOString()}'`,
    ];
    if (queueNumber) {
        conditions.push(`call_history_id IN (SELECT DISTINCT call_history_id FROM cdroutput WHERE destination_dn_number = '${queueNumber.replace(/'/g, "''")}' AND destination_dn_type = 'queue' AND cdr_started_at >= '${startDate.toISOString()}' AND cdr_started_at <= '${endDate.toISOString()}')`);
    }
    return conditions.join(" AND ");
}

function buildDateOnlyWhereClause(startDate: Date, endDate: Date, queueNumber?: string): string {
    const conditions = [
        `cdr_started_at >= '${startDate.toISOString()}'`,
        `cdr_started_at <= '${endDate.toISOString()}'`,
    ];
    if (queueNumber) {
        conditions.push(`call_history_id IN (SELECT DISTINCT call_history_id FROM cdroutput WHERE destination_dn_number = '${queueNumber.replace(/'/g, "''")}' AND destination_dn_type = 'queue' AND cdr_started_at >= '${startDate.toISOString()}' AND cdr_started_at <= '${endDate.toISOString()}')`);
    }
    return conditions.join(" AND ");
}

export function buildAnalyticsCTEs(
    startDate: Date,
    endDate: Date,
    queueNumber?: string
): string {
    const whereClause = buildBaseWhereClause(startDate, endDate, queueNumber);
    const dateOnlyWhereClause = buildDateOnlyWhereClause(startDate, endDate, queueNumber);

    return `
        WITH call_aggregates AS (
            SELECT
                call_history_id,
                COUNT(*) as segment_count,
                MIN(cdr_started_at) as first_started_at,
                MAX(cdr_ended_at) as last_ended_at,
                MIN(cdr_answered_at) as first_answered_at
            FROM cdroutput
            WHERE ${whereClause}
            GROUP BY call_history_id
        ),
        first_segments AS (
            SELECT DISTINCT ON (c.call_history_id)
                c.call_history_id,
                c.source_dn_number,
                c.source_participant_phone_number,
                c.source_participant_name,
                c.source_dn_name,
                c.source_dn_type,
                c.source_presentation,
                c.destination_dn_number as first_dest_number,
                c.destination_participant_phone_number as first_dest_participant_phone,
                c.destination_participant_name as first_dest_participant_name,
                c.destination_dn_name as first_dest_dn_name,
                c.destination_dn_type
            FROM cdroutput c
            WHERE ${dateOnlyWhereClause}
              AND c.call_history_id IN (SELECT call_history_id FROM call_aggregates)
            ORDER BY c.call_history_id, c.cdr_started_at ASC
        ),
        last_segments AS (
            SELECT DISTINCT ON (call_history_id)
                call_history_id,
                destination_dn_number,
                destination_participant_phone_number,
                destination_participant_name,
                destination_dn_name,
                destination_dn_type as last_dest_type,
                destination_entity_type as last_dest_entity_type,
                cdr_answered_at,
                cdr_started_at as last_started_at,
                cdr_ended_at as last_ended_at,
                termination_reason,
                termination_reason_details
            FROM cdroutput
            WHERE ${whereClause}
            ORDER BY call_history_id, cdr_ended_at DESC, cdr_started_at DESC, cdr_id DESC
        ),
        last_human_segments AS (
            SELECT DISTINCT ON (call_history_id)
                call_history_id,
                destination_dn_type as last_human_dest_type,
                destination_entity_type as last_human_dest_entity_type,
                cdr_answered_at as last_human_answered_at,
                cdr_started_at as last_human_started_at,
                cdr_ended_at as last_human_ended_at,
                termination_reason_details as last_human_termination_reason_details
            FROM cdroutput
            WHERE ${whereClause}
              AND destination_dn_type = 'extension'
              AND COALESCE(destination_entity_type, '') != 'voicemail'
            ORDER BY call_history_id, cdr_ended_at DESC, cdr_started_at DESC, cdr_id DESC
        ),
        answered_segments AS (
            SELECT DISTINCT ON (c.call_history_id)
                c.call_history_id,
                c.destination_dn_number as answered_dest_number,
                c.destination_participant_name as answered_dest_name,
                c.destination_dn_name as answered_dn_name,
                c.destination_dn_type as answered_dest_type,
                c.cdr_answered_at as answered_at,
                c.cdr_ended_at as answered_ended_at,
                EXTRACT(EPOCH FROM (c.cdr_ended_at - c.cdr_answered_at)) as talk_duration_seconds
            FROM cdroutput c
            WHERE ${dateOnlyWhereClause}
              AND c.cdr_answered_at IS NOT NULL
              AND c.destination_dn_type = 'extension'
              AND c.call_history_id IN (SELECT call_history_id FROM call_aggregates)
            ORDER BY c.call_history_id, c.cdr_answered_at ASC, c.cdr_id ASC
        ),
        handled_by AS (
            SELECT
                c.call_history_id,
                JSON_AGG(
                    JSON_BUILD_OBJECT(
                        'number', c.destination_dn_number,
                        'name', COALESCE(c.destination_dn_name, c.destination_participant_name, c.destination_dn_number)
                    ) ORDER BY c.cdr_answered_at DESC
                ) as agents,
                SUM(EXTRACT(EPOCH FROM (c.cdr_ended_at - c.cdr_answered_at))) as total_talk_seconds,
                COUNT(*) as agent_count
            FROM cdroutput c
            WHERE ${dateOnlyWhereClause}
              AND c.cdr_answered_at IS NOT NULL
              AND c.destination_dn_type = 'extension'
              AND c.call_history_id IN (SELECT call_history_id FROM call_aggregates)
            GROUP BY c.call_history_id
        ),
        call_queues AS (
            SELECT
                dq.call_history_id,
                JSON_AGG(
                    JSON_BUILD_OBJECT(
                        'number', dq.destination_dn_number,
                        'name', dq.queue_name
                    )
                ) as queues,
                COUNT(*) as queue_count
            FROM (
                SELECT DISTINCT
                    c.call_history_id,
                    c.destination_dn_number,
                    COALESCE(c.destination_dn_name, c.destination_dn_number) as queue_name
                FROM cdroutput c
                WHERE ${dateOnlyWhereClause}
                  AND c.destination_dn_type = 'queue'
                  AND c.call_history_id IN (SELECT call_history_id FROM call_aggregates)
            ) dq
            GROUP BY dq.call_history_id
        ),
        queue_outcome AS (
            SELECT DISTINCT ON (p.originating_cdr_id)
                p.originating_cdr_id,
                p.destination_dn_name as agent_name,
                p.destination_dn_number as agent_number
            FROM cdroutput p
            WHERE ${dateOnlyWhereClause}
              AND p.call_history_id IN (SELECT call_history_id FROM call_aggregates)
              AND p.creation_forward_reason = 'polling'
              AND p.cdr_answered_at IS NOT NULL
            ORDER BY p.originating_cdr_id, p.cdr_answered_at ASC, p.cdr_id ASC
        ),
        queue_overflow AS (
            SELECT c.cdr_id
            FROM cdroutput c
            WHERE ${dateOnlyWhereClause}
              AND c.destination_dn_type = 'queue'
              AND c.call_history_id IN (SELECT call_history_id FROM call_aggregates)
              AND NOT EXISTS (
                  SELECT 1 FROM cdroutput p
                  WHERE p.originating_cdr_id = c.cdr_id
                    AND p.creation_forward_reason = 'polling'
                    AND p.cdr_answered_at IS NOT NULL
              )
              AND EXISTS (
                  SELECT 1 FROM cdroutput c2
                  WHERE c2.call_history_id = c.call_history_id
                    AND c2.destination_dn_type = 'queue'
                    AND c2.destination_dn_number != c.destination_dn_number
                    AND c2.cdr_started_at > c.cdr_started_at
              )
        ),
        call_journey AS (
            SELECT
                j.call_history_id,
                JSON_AGG(
                    JSON_BUILD_OBJECT(
                        'type', j.step_type,
                        'label', j.step_label,
                        'detail', j.step_detail,
                        'result', j.step_result,
                        'agent', j.agent_name,
                        'agentNumber', j.agent_number
                    ) ORDER BY j.step_order
                ) as journey
            FROM (
                SELECT * FROM (
                    SELECT
                        c.call_history_id,
                        c.cdr_started_at as step_order,
                        CASE
                            WHEN c.destination_entity_type = 'voicemail' THEN 'voicemail'
                            WHEN c.destination_dn_type = 'queue' THEN 'queue'
                            ELSE 'direct'
                        END as step_type,
                        c.destination_dn_number as step_label,
                        CASE
                            WHEN c.destination_entity_type = 'voicemail' THEN 'Messagerie ' || COALESCE(c.destination_dn_name, c.destination_dn_number)
                            WHEN c.destination_dn_type = 'queue' THEN COALESCE(c.destination_dn_name, c.destination_dn_number)
                            ELSE COALESCE(c.destination_dn_name, c.destination_dn_number)
                        END as step_detail,
                        CASE
                            WHEN c.destination_dn_type = 'queue' THEN COALESCE(qo.agent_name, qo.agent_number)
                            WHEN c.destination_dn_type = 'extension' THEN COALESCE(c.destination_dn_name, c.destination_dn_number)
                            WHEN c.destination_dn_type IN ('provider', 'external_line') THEN COALESCE(c.destination_participant_phone_number, c.destination_dn_name, c.destination_dn_number)
                            ELSE NULL
                        END as agent_name,
                        CASE
                            WHEN c.destination_dn_type = 'queue' THEN qo.agent_number
                            WHEN c.destination_dn_type = 'extension' THEN c.destination_dn_number
                            WHEN c.destination_dn_type IN ('provider', 'external_line') THEN c.destination_participant_phone_number
                            ELSE NULL
                        END as agent_number,
                        CASE
                            WHEN c.destination_entity_type = 'voicemail' THEN 'voicemail'
                            WHEN c.destination_dn_type = 'queue' THEN
                                CASE
                                    WHEN qo.originating_cdr_id IS NOT NULL THEN 'answered'
                                    WHEN qov.cdr_id IS NOT NULL THEN 'overflow'
                                    ELSE 'abandoned'
                                END
                            ELSE
                                CASE
                                    WHEN c.cdr_answered_at IS NOT NULL THEN 'answered'
                                    WHEN c.termination_reason_details = 'busy' THEN 'busy'
                                    ELSE 'not_answered'
                                END
                        END as step_result,
                        ROW_NUMBER() OVER (PARTITION BY c.call_history_id ORDER BY c.cdr_started_at) as step_num
                    FROM cdroutput c
                    LEFT JOIN queue_outcome qo ON c.cdr_id = qo.originating_cdr_id
                    LEFT JOIN queue_overflow qov ON c.cdr_id = qov.cdr_id
                    WHERE ${dateOnlyWhereClause}
                      AND c.call_history_id IN (SELECT call_history_id FROM call_aggregates)
                      AND (
                          c.destination_entity_type = 'voicemail'
                          OR c.destination_dn_type = 'queue'
                          OR c.destination_dn_type IN ('provider', 'external_line')
                          OR (${buildDirectSegmentWhereClause('c', { excludeQueueOriginated: true, queuePassagesCTEName: 'all_queue_passages_for_journey' })})
                      )
                ) all_steps
                WHERE all_steps.step_num <= 15
            ) j
            GROUP BY j.call_history_id
        ),
        all_queue_passages_for_journey AS (
            SELECT DISTINCT c.call_history_id, c.cdr_id
            FROM cdroutput c
            WHERE ${dateOnlyWhereClause}
              AND c.destination_dn_type = 'queue'
              AND c.call_history_id IN (SELECT call_history_id FROM call_aggregates)
        )`;
}

export const ANALYTICS_DATA_SELECT = `
        SELECT
            ca.call_history_id,
            ca.segment_count,
            ca.first_started_at,
            ca.last_ended_at,
            ca.first_answered_at,
            fs.source_dn_number,
            fs.source_participant_phone_number,
            fs.source_participant_name,
            fs.source_dn_name,
            fs.source_dn_type,
            fs.source_presentation,
            fs.first_dest_number,
            fs.first_dest_participant_phone,
            fs.first_dest_participant_name,
            fs.first_dest_dn_name,
            fs.destination_dn_type as first_dest_type,
            ls.destination_dn_number,
            ls.destination_participant_phone_number,
            ls.destination_participant_name,
            ls.destination_dn_name,
            ls.last_dest_type,
            ls.last_dest_entity_type,
            ls.cdr_answered_at as last_answered_at,
            ls.last_started_at,
            ls.last_ended_at,
            ls.termination_reason,
            ls.termination_reason_details,
            lhs.last_human_answered_at,
            lhs.last_human_started_at,
            lhs.last_human_ended_at,
            ans.answered_dest_number,
            ans.answered_dest_name,
            ans.answered_dn_name,
            ans.answered_dest_type,
            ans.answered_at,
            ans.answered_ended_at,
            ans.talk_duration_seconds,
            hb.agents as handled_by_agents,
            hb.total_talk_seconds as handled_by_total_talk,
            hb.agent_count as handled_by_count,
            cq.queues as call_queues,
            cq.queue_count,
            cj.journey as call_journey`;

export function buildAnalyticsDataJoins(
    aggregatedWhereConditions: string[],
    sortClause: string,
    limit: number,
    skip: number
): string {
    return `
        FROM call_aggregates ca
        JOIN first_segments fs ON ca.call_history_id = fs.call_history_id
        JOIN last_segments ls ON ca.call_history_id = ls.call_history_id
        LEFT JOIN last_human_segments lhs ON ca.call_history_id = lhs.call_history_id
        LEFT JOIN answered_segments ans ON ca.call_history_id = ans.call_history_id
        LEFT JOIN handled_by hb ON ca.call_history_id = hb.call_history_id
        LEFT JOIN call_queues cq ON ca.call_history_id = cq.call_history_id
        LEFT JOIN call_journey cj ON ca.call_history_id = cj.call_history_id
        ${aggregatedWhereConditions.length > 0 ? 'WHERE ' + aggregatedWhereConditions.join(' AND ') : ''}
        ORDER BY ${sortClause}
        LIMIT ${limit} OFFSET ${skip}`;
}

export function buildAnalyticsCountQuery(
    startDate: Date,
    endDate: Date,
    queueNumber: string | undefined,
    aggregatedWhereConditions: string[]
): string {
    const whereClause = buildBaseWhereClause(startDate, endDate, queueNumber);
    const dateOnlyWhereClause = buildDateOnlyWhereClause(startDate, endDate, queueNumber);

    return `
        WITH call_aggregates AS (
            SELECT call_history_id
            FROM cdroutput
            WHERE ${whereClause}
            GROUP BY call_history_id
        )
        SELECT COUNT(*) as total
        FROM call_aggregates ca`;
}

export function buildAnalyticsOrderByClause(sort?: LogsSort, timezone: string = "Europe/Zurich"): string {
    if (!sort) return "ca.first_started_at DESC";
    const dir = sort.direction === "asc" ? "ASC" : "DESC";
    switch (sort.field) {
        case "startedAt": return `ca.first_started_at ${dir}`;
        case "timeOfDay": return `(ca.first_started_at AT TIME ZONE '${timezone}')::time ${dir}`;
        case "duration": return `(ca.last_ended_at - ca.first_started_at) ${dir}`;
        case "sourceNumber": return `fs.source_dn_number ${dir}`;
        case "destinationNumber": return `fs.first_dest_number ${dir}`;
        default: return "ca.first_started_at DESC";
    }
}
