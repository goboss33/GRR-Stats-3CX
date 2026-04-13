"use server";

import { prisma } from "@/lib/prisma";
import type {
    AggregatedCallLog,
    CallDirection,
    CallStatus,
    LogsFilters,
    LogsSort,
    AggregatedCallLogsResponse,
    CallChainSegment,
} from "@/services/domain/call.types";
import {
    SQL_SYSTEM_DEST_TYPES,
    SQL_SYSTEM_ENTITY_TYPES,
    determineCallDirection,
    determineCallStatus,
    determineSegmentStatus,
    determineSegmentCategory,
    formatDuration,
    getDisplayNumber,
    getDisplayName,
    INTERNAL_SYSTEM_DEST_TYPES,
} from "@/services/domain/call-aggregation";

// ============================================
// SEARCH PATTERN PARSER
// ============================================

function parseSearchPattern(input: string): { mode: 'exact' | 'startsWith' | 'endsWith' | 'contains'; value: string } {
    const trimmed = input.trim();
    const startsWithWildcard = trimmed.startsWith('*');
    const endsWithWildcard = trimmed.endsWith('*');
    let value = trimmed;
    if (startsWithWildcard) value = value.slice(1);
    if (endsWithWildcard) value = value.slice(0, -1);

    if (startsWithWildcard && endsWithWildcard) {
        return { mode: 'contains', value };
    } else if (startsWithWildcard) {
        return { mode: 'endsWith', value };
    } else if (endsWithWildcard) {
        return { mode: 'startsWith', value };
    } else {
        return { mode: 'exact', value };
    }
}

function buildSqlSearchCondition(field: string, pattern: ReturnType<typeof parseSearchPattern>): string {
    const escapedValue = pattern.value.replace(/'/g, "''");
    switch (pattern.mode) {
        case 'exact':
            return `LOWER(${field}) = LOWER('${escapedValue}')`;
        case 'startsWith':
            return `${field} ILIKE '${escapedValue}%'`;
        case 'endsWith':
            return `${field} ILIKE '%${escapedValue}'`;
        case 'contains':
            return `${field} ILIKE '%${escapedValue}%'`;
    }
}

function buildSqlDirectionFilter(directions: CallDirection[] | undefined): string {
    if (!directions || directions.length === 0 || directions.length === 4) return '';
    const conditions: string[] = [];
    const internalSystemTypes = INTERNAL_SYSTEM_DEST_TYPES.map(t => `'${t}'`).join(', ');

    if (directions.includes('bridge')) {
        conditions.push("(fs.source_dn_type = 'bridge' OR fs.destination_dn_type = 'bridge' OR ls.last_dest_type = 'bridge')");
    }
    if (directions.includes('inbound')) {
        conditions.push("(fs.source_dn_type != 'extension' AND fs.source_dn_type != 'bridge' AND (ls.last_dest_type != 'bridge' OR ls.last_dest_type IS NULL))");
    }
    if (directions.includes('outbound')) {
        conditions.push(`(fs.source_dn_type = 'extension' AND fs.destination_dn_type NOT IN ('extension', 'bridge', ${internalSystemTypes}) AND (ls.last_dest_type != 'bridge' OR ls.last_dest_type IS NULL))`);
    }
    if (directions.includes('internal')) {
        conditions.push(`(fs.source_dn_type = 'extension' AND (fs.destination_dn_type = 'extension' OR fs.destination_dn_type IN (${internalSystemTypes})))`);
    }
    return conditions.length > 0 ? `(${conditions.join(' OR ')})` : '';
}

function buildSqlStatusFilter(statuses: CallStatus[] | undefined): string {
    if (!statuses || statuses.length === 0 || statuses.length === 5) return '';
    const conditions: string[] = [];
    const systemTypes = SQL_SYSTEM_DEST_TYPES;
    const systemEntityTypes = SQL_SYSTEM_ENTITY_TYPES;

    if (statuses.includes('voicemail')) {
        conditions.push("(ls.last_dest_type IN ('vmail_console', 'voicemail') OR ls.last_dest_entity_type = 'voicemail')");
    }
    if (statuses.includes('busy')) {
        conditions.push("(ls.termination_reason_details ILIKE '%busy%')");
    }
    if (statuses.includes('answered')) {
        conditions.push(`(
            COALESCE(ls.last_dest_entity_type, '') NOT IN ('voicemail') 
            AND COALESCE(ls.termination_reason_details, '') NOT ILIKE '%busy%'
            AND COALESCE(ls.last_dest_type, '') NOT IN ('vmail_console', 'voicemail')
            AND (
                (
                    (COALESCE(ls.last_dest_type, '') IN (${systemTypes}) OR COALESCE(ls.last_dest_entity_type, '') IN (${systemEntityTypes}))
                    AND ans.answered_at IS NOT NULL
                    AND EXTRACT(EPOCH FROM (ls.last_ended_at - ls.last_started_at)) > 1
                )
                OR
                (
                    (COALESCE(ls.last_dest_type, '') NOT IN (${systemTypes}) AND COALESCE(ls.last_dest_entity_type, '') NOT IN (${systemEntityTypes}))
                    AND ls.cdr_answered_at IS NOT NULL 
                    AND EXTRACT(EPOCH FROM (ls.last_ended_at - ls.last_started_at)) > 1
                )
            )
        )`);
    }
    if (statuses.includes('missed')) {
        conditions.push(`(
            COALESCE(ls.termination_reason_details, '') NOT ILIKE '%busy%' 
            AND COALESCE(ls.last_dest_type, '') NOT IN ('vmail_console', 'voicemail') 
            AND COALESCE(ls.last_dest_entity_type, '') != 'voicemail'
            AND (
                (
                    (COALESCE(ls.last_dest_type, '') IN (${systemTypes}) OR COALESCE(ls.last_dest_entity_type, '') IN (${systemEntityTypes}))
                    AND (
                        ans.answered_at IS NULL
                        OR EXTRACT(EPOCH FROM (ls.last_ended_at - ls.last_started_at)) <= 1
                    )
                )
                OR
                (
                    (COALESCE(ls.last_dest_type, '') IN (${systemTypes}) OR COALESCE(ls.last_dest_entity_type, '') IN (${systemEntityTypes}))
                    AND ls.cdr_answered_at IS NULL
                )
                OR
                (
                    (COALESCE(ls.last_dest_type, '') NOT IN (${systemTypes}) AND COALESCE(ls.last_dest_entity_type, '') NOT IN (${systemEntityTypes}))
                    AND (ls.cdr_answered_at IS NULL OR EXTRACT(EPOCH FROM (ls.last_ended_at - ls.last_started_at)) <= 1)
                )
            )
        )`);
    }
    return conditions.length > 0 ? `(${conditions.join(' OR ')})` : '';
}

function buildOrderByClause(sort?: LogsSort): string {
    if (!sort) return "ca.first_started_at DESC";
    const dir = sort.direction === "asc" ? "ASC" : "DESC";
    switch (sort.field) {
        case "startedAt": return `ca.first_started_at ${dir}`;
        case "timeOfDay": return `(ca.first_started_at AT TIME ZONE 'Europe/Zurich')::time ${dir}`;
        case "duration": return `(ca.last_ended_at - ca.first_started_at) ${dir}`;
        case "sourceNumber": return `fs.source_dn_number ${dir}`;
        case "destinationNumber": return `fs.first_dest_number ${dir}`;
        default: return "ca.first_started_at DESC";
    }
}

// ============================================
// QUERY BUILDER — shared parts (filters + pagination)
// ============================================

function buildAggregatedQueryParts(
    startDate: Date,
    endDate: Date,
    filters: LogsFilters,
    pagination: { page: number; pageSize: number },
    sort?: LogsSort
): {
    whereClause: string;
    dateOnlyWhereClause: string;
    aggregatedWhereConditions: string[];
    calleeFilterCTE: string;
    calleeFilterJoin: string;
    limit: number;
    skip: number;
    sortClause: string;
} {
    const pageNumber = Math.max(1, pagination.page);
    const limit = Math.min(100, Math.max(1, pagination.pageSize));
    const skip = (pageNumber - 1) * limit;

    const whereConditions: string[] = [
        `cdr_started_at >= '${startDate.toISOString()}'`,
        `cdr_started_at <= '${endDate.toISOString()}'`,
    ];

    if (filters.callerSearch?.trim()) {
        const pattern = parseSearchPattern(filters.callerSearch);
        whereConditions.push(`(
            ${buildSqlSearchCondition('source_dn_number', pattern)} OR
            ${buildSqlSearchCondition('source_participant_phone_number', pattern)} OR
            ${buildSqlSearchCondition('source_participant_name', pattern)} OR
            ${buildSqlSearchCondition('source_dn_name', pattern)}
        )`);
    }

    let calleeFilterCTE = '';
    let calleeFilterJoin = '';
    if (filters.calleeSearch?.trim()) {
        const pattern = parseSearchPattern(filters.calleeSearch);
        calleeFilterCTE = `,
            callee_filter AS (
                SELECT call_history_id
                FROM (
                    SELECT DISTINCT ON (call_history_id)
                        call_history_id,
                        destination_dn_number,
                        destination_participant_phone_number,
                        destination_participant_name,
                        destination_dn_name
                    FROM cdroutput
                    WHERE cdr_started_at >= '${startDate.toISOString()}'
                      AND cdr_started_at <= '${endDate.toISOString()}'
                    ORDER BY call_history_id, cdr_started_at ASC
                ) first_dest
                WHERE (
                    ${buildSqlSearchCondition('destination_dn_number', pattern)} OR
                    ${buildSqlSearchCondition('destination_participant_phone_number', pattern)} OR
                    ${buildSqlSearchCondition('destination_participant_name', pattern)} OR
                    ${buildSqlSearchCondition('destination_dn_name', pattern)}
                )
            )`;
        calleeFilterJoin = 'JOIN callee_filter cf ON ca.call_history_id = cf.call_history_id';
    }

    if (filters.durationMin !== undefined) {
        whereConditions.push(`EXTRACT(EPOCH FROM (cdr_ended_at - cdr_answered_at)) >= ${filters.durationMin}`);
    }
    if (filters.durationMax !== undefined) {
        whereConditions.push(`EXTRACT(EPOCH FROM (cdr_ended_at - cdr_answered_at)) <= ${filters.durationMax}`);
    }
    if (filters.idSearch?.trim()) {
        const pattern = parseSearchPattern(filters.idSearch);
        whereConditions.push(buildSqlSearchCondition('call_history_id::text', pattern));
    }

    const whereClause = whereConditions.join(" AND ");
    const dateOnlyWhereClause = [
        `cdr_started_at >= '${startDate.toISOString()}'`,
        `cdr_started_at <= '${endDate.toISOString()}'`,
    ].join(" AND ");

    const aggregatedWhereConditions: string[] = [];
    const directionFilter = buildSqlDirectionFilter(filters.directions);
    if (directionFilter) aggregatedWhereConditions.push(directionFilter);
    const statusFilter = buildSqlStatusFilter(filters.statuses);
    if (statusFilter) aggregatedWhereConditions.push(statusFilter);

    if (filters.handledBySearch?.trim()) {
        const pattern = parseSearchPattern(filters.handledBySearch);
        const searchValue = pattern.value.replace(/'/g, "''");
        aggregatedWhereConditions.push(`(hb.agents::text ILIKE '%${searchValue}%')`);
    }
    if (filters.queueSearch?.trim()) {
        const pattern = parseSearchPattern(filters.queueSearch);
        const searchValue = pattern.value.replace(/'/g, "''");
        aggregatedWhereConditions.push(`(cq.queues::text ILIKE '%${searchValue}%')`);
    }
    if (filters.segmentCountMin !== undefined) {
        aggregatedWhereConditions.push(`ca.segment_count >= ${filters.segmentCountMin}`);
    }
    if (filters.segmentCountMax !== undefined) {
        aggregatedWhereConditions.push(`ca.segment_count <= ${filters.segmentCountMax}`);
    }
    if (filters.waitTimeMin !== undefined) {
        aggregatedWhereConditions.push(`EXTRACT(EPOCH FROM (COALESCE(ans.answered_at, ca.first_answered_at) - ca.first_started_at)) >= ${Number(filters.waitTimeMin)}`);
    }
    if (filters.waitTimeMax !== undefined) {
        aggregatedWhereConditions.push(`EXTRACT(EPOCH FROM (COALESCE(ans.answered_at, ca.first_answered_at) - ca.first_started_at)) <= ${Number(filters.waitTimeMax)}`);
    }
    if (filters.timeSlots && filters.timeSlots.length > 0) {
        const slotConditions = filters.timeSlots.map(slot => {
            const startTime = slot.start.replace(/'/g, "");
            const endTime = slot.end.replace(/'/g, "");
            return `((ca.first_started_at AT TIME ZONE 'Europe/Zurich')::time >= '${startTime}'::time
                AND (ca.first_started_at AT TIME ZONE 'Europe/Zurich')::time < '${endTime}'::time)`;
        });
        aggregatedWhereConditions.push(`(${slotConditions.join(' OR ')})`);
    }
    if (filters.journeyConditions && filters.journeyConditions.length > 0) {
        const validTypes = ['direct', 'queue', 'voicemail'];
        const validResults = ['answered', 'not_answered', 'busy', 'voicemail', 'abandoned', 'overflow'];
        for (const condition of filters.journeyConditions) {
            const clauses: string[] = [];
            if (condition.type && validTypes.includes(condition.type)) {
                clauses.push(`elem->>'type' = '${condition.type}'`);
            }
            if (condition.queueNumber) {
                const queueNum = condition.queueNumber.replace(/'/g, "''");
                clauses.push(`elem->>'label' = '${queueNum}'`);
            }
            if (condition.agentNumber) {
                const agentNum = condition.agentNumber.replace(/'/g, "''");
                clauses.push(`elem->>'agentNumber' = '${agentNum}'`);
            }
            if (condition.result && validResults.includes(condition.result)) {
                clauses.push(`elem->>'result' = '${condition.result}'`);
            }

            if (condition.queueNumber && condition.passageMode === 'first' && condition.result) {
                const queueNum = condition.queueNumber.replace(/'/g, "''");
                const existsOp = condition.negate ? 'NOT' : '';
                aggregatedWhereConditions.push(`
                    ${existsOp} (SELECT elem->>'result'
                     FROM jsonb_array_elements(cj.journey::jsonb) WITH ORDINALITY AS t(elem, idx)
                     WHERE elem->>'type' = 'queue' AND elem->>'label' = '${queueNum}'
                     ORDER BY idx ASC
                     LIMIT 1
                    ) = '${condition.result}'
                `);
            } else if (clauses.length > 0) {
                const existsOp = condition.negate ? 'NOT EXISTS' : 'EXISTS';
                aggregatedWhereConditions.push(`
                    ${existsOp} (
                        SELECT 1 FROM jsonb_array_elements(cj.journey::jsonb) elem
                        WHERE ${clauses.join(' AND ')}
                    )
                `);
            }

            if (condition.queueNumber && condition.passageMode === 'multi') {
                const queueNum = condition.queueNumber.replace(/'/g, "''");
                aggregatedWhereConditions.push(`
                    (SELECT COUNT(*)
                     FROM jsonb_array_elements(cj.journey::jsonb) elem
                     WHERE elem->>'type' = 'queue'
                       AND elem->>'label' = '${queueNum}') > 1
                `);
            }
            if (condition.queueNumber && condition.hasOverflow !== undefined) {
                const queueNum = condition.queueNumber.replace(/'/g, "''");
                const countOp = condition.hasOverflow ? '> 0' : '= 0';
                aggregatedWhereConditions.push(`
                    (SELECT COUNT(DISTINCT elem->>'label')
                     FROM jsonb_array_elements(cj.journey::jsonb) WITH ORDINALITY AS t(elem, idx)
                     WHERE elem->>'type' = 'queue'
                       AND elem->>'label' != '${queueNum}'
                       AND idx > (
                           SELECT MIN(idx2)
                           FROM jsonb_array_elements(cj.journey::jsonb) WITH ORDINALITY AS t2(elem2, idx2)
                           WHERE elem2->>'type' = 'queue' AND elem2->>'label' = '${queueNum}'
                       )
                    ) ${countOp}
                `);
            }
        }
    }

    return { whereClause, dateOnlyWhereClause, aggregatedWhereConditions, calleeFilterCTE, calleeFilterJoin, limit, skip, sortClause: buildOrderByClause(sort) };
}

// ============================================
// SHARED SQL BUILDER — Single source for CTEs body
// Eliminates duplication between getCallLogsSQL() and getAggregatedCallLogs()
// ============================================

function buildAggregateCTEs(
    whereClause: string,
    dateOnlyWhereClause: string,
    calleeFilterCTE: string
): string {
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
                          OR (
                              c.destination_dn_type = 'extension'
                              AND c.destination_entity_type != 'voicemail'
                              AND c.creation_forward_reason IS DISTINCT FROM 'polling'
                              AND (
                                  c.creation_forward_reason = 'by_did'
                                  OR NOT (
                                      c.cdr_answered_at IS NULL
                                      AND EXTRACT(EPOCH FROM (c.cdr_ended_at - c.cdr_started_at)) < 1
                                  )
                              )
                          )
                      )
                ) all_steps
                WHERE all_steps.step_num <= 15
            ) j
            GROUP BY j.call_history_id
        )${calleeFilterCTE}`;
}

// Shared SELECT columns for data queries
const DATA_SELECT = `
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

// Shared FROM + JOINs for data queries
function buildDataJoins(calleeFilterJoin: string, aggregatedWhereConditions: string[], sortClause: string, limit: number, skip: number): string {
    return `
        FROM call_aggregates ca
        JOIN first_segments fs ON ca.call_history_id = fs.call_history_id
        JOIN last_segments ls ON ca.call_history_id = ls.call_history_id
        LEFT JOIN answered_segments ans ON ca.call_history_id = ans.call_history_id
        LEFT JOIN handled_by hb ON ca.call_history_id = hb.call_history_id
        LEFT JOIN call_queues cq ON ca.call_history_id = cq.call_history_id
        LEFT JOIN call_journey cj ON ca.call_history_id = cj.call_history_id
        ${calleeFilterJoin}
        ${aggregatedWhereConditions.length > 0 ? 'WHERE ' + aggregatedWhereConditions.join(' AND ') : ''}
        ORDER BY ${sortClause}
        LIMIT ${limit} OFFSET ${skip}`;
}

// ============================================
// GET SQL QUERY STRING (for debugging)
// ============================================

export async function getCallLogsSQL(
    startDate: Date,
    endDate: Date,
    filters: LogsFilters,
    pagination: { page: number; pageSize: number },
    sort?: LogsSort
): Promise<string> {
    const { whereClause, dateOnlyWhereClause, aggregatedWhereConditions, calleeFilterCTE, calleeFilterJoin, limit, skip, sortClause } =
        buildAggregatedQueryParts(startDate, endDate, filters, pagination, sort);

    return buildAggregateCTEs(whereClause, dateOnlyWhereClause, calleeFilterCTE)
        + DATA_SELECT
        + buildDataJoins(calleeFilterJoin, aggregatedWhereConditions, sortClause, limit, skip);
}

// ============================================
// OPTIMIZED COUNT QUERY — conditional CTEs
// Only includes expensive CTEs when actually filtering on them
// ============================================

function buildCountQuery(
    whereClause: string,
    dateOnlyWhereClause: string,
    calleeFilterCTE: string,
    calleeFilterJoin: string,
    aggregatedWhereConditions: string[],
    filters: LogsFilters
): string {
    const needsHandledBy = !!filters.handledBySearch?.trim();
    const needsCallQueues = !!filters.queueSearch?.trim();
    const needsCallJourney = !!(filters.journeyConditions && filters.journeyConditions.length > 0);

    const handledByCTE = needsHandledBy ? `,
        handled_by AS (
            SELECT
                c.call_history_id,
                JSON_AGG(
                    JSON_BUILD_OBJECT(
                        'number', c.destination_dn_number,
                        'name', COALESCE(c.destination_dn_name, c.destination_participant_name, c.destination_dn_number)
                    ) ORDER BY c.cdr_answered_at DESC
                ) as agents
            FROM cdroutput c
            WHERE ${dateOnlyWhereClause}
              AND c.cdr_answered_at IS NOT NULL
              AND c.destination_dn_type = 'extension'
              AND c.call_history_id IN (SELECT call_history_id FROM call_aggregates)
            GROUP BY c.call_history_id
        )` : '';

    const callQueuesCTE = needsCallQueues ? `,
        call_queues AS (
            SELECT
                dq.call_history_id,
                JSON_AGG(
                    JSON_BUILD_OBJECT(
                        'number', dq.destination_dn_number,
                        'name', dq.queue_name
                    )
                ) as queues
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
        )` : '';

    const callJourneyCTE = needsCallJourney ? `,
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
                        'type', j.step_type, 'label', j.step_label,
                        'detail', j.step_detail, 'result', j.step_result,
                        'agent', j.agent_name, 'agentNumber', j.agent_number
                    ) ORDER BY j.step_order
                ) as journey
            FROM (
                SELECT * FROM (
                    SELECT
                        c.call_history_id,
                        c.cdr_started_at as step_order,
                        CASE WHEN c.destination_entity_type = 'voicemail' THEN 'voicemail'
                             WHEN c.destination_dn_type = 'queue' THEN 'queue' ELSE 'direct' END as step_type,
                        c.destination_dn_number as step_label,
                        COALESCE(c.destination_dn_name, c.destination_dn_number) as step_detail,
                        COALESCE(qo.agent_name, qo.agent_number) as agent_name,
                        qo.agent_number as agent_number,
                        CASE WHEN c.destination_entity_type = 'voicemail' THEN 'voicemail'
                             WHEN c.destination_dn_type = 'queue' THEN
                                 CASE WHEN qo.originating_cdr_id IS NOT NULL THEN 'answered'
                                      WHEN qov.cdr_id IS NOT NULL THEN 'overflow' ELSE 'abandoned' END
                             ELSE CASE WHEN c.cdr_answered_at IS NOT NULL THEN 'answered'
                                       WHEN c.termination_reason_details = 'busy' THEN 'busy'
                                       ELSE 'not_answered' END
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
                          OR (
                              c.destination_dn_type = 'extension'
                              AND c.destination_entity_type != 'voicemail'
                              AND c.creation_forward_reason IS DISTINCT FROM 'polling'
                              AND (
                                  c.creation_forward_reason = 'by_did'
                                  OR NOT (c.cdr_answered_at IS NULL AND EXTRACT(EPOCH FROM (c.cdr_ended_at - c.cdr_started_at)) < 1)
                              )
                          )
                      )
                ) all_steps WHERE all_steps.step_num <= 15
            ) j GROUP BY j.call_history_id
        )` : '';

    const handledByJoin = needsHandledBy ? 'LEFT JOIN handled_by hb ON ca.call_history_id = hb.call_history_id' : '';
    const callQueuesJoin = needsCallQueues ? 'LEFT JOIN call_queues cq ON ca.call_history_id = cq.call_history_id' : '';
    const callJourneyJoin = needsCallJourney ? 'LEFT JOIN call_journey cj ON ca.call_history_id = cj.call_history_id' : '';

    return `
        WITH call_aggregates AS (
            SELECT
                call_history_id,
                COUNT(*) as segment_count,
                MIN(cdr_started_at) as first_started_at,
                MIN(cdr_answered_at) as first_answered_at
            FROM cdroutput
            WHERE ${whereClause}
            GROUP BY call_history_id
        ),
        first_segments AS (
            SELECT DISTINCT ON (call_history_id)
                call_history_id,
                source_dn_type,
                destination_dn_type
            FROM cdroutput
            WHERE ${dateOnlyWhereClause}
              AND call_history_id IN (SELECT call_history_id FROM call_aggregates)
            ORDER BY call_history_id, cdr_started_at ASC
        ),
        last_segments AS (
            SELECT DISTINCT ON (call_history_id)
                call_history_id,
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
        answered_segments AS (
            SELECT DISTINCT ON (c.call_history_id)
                c.call_history_id,
                c.cdr_answered_at as answered_at
            FROM cdroutput c
            WHERE ${dateOnlyWhereClause}
              AND c.cdr_answered_at IS NOT NULL
              AND c.destination_dn_type = 'extension'
              AND c.call_history_id IN (SELECT call_history_id FROM call_aggregates)
            ORDER BY c.call_history_id, c.cdr_answered_at ASC, c.cdr_id ASC
        )${handledByCTE}${callQueuesCTE}${callJourneyCTE}${calleeFilterCTE}
        SELECT COUNT(*) as total
        FROM call_aggregates ca
        JOIN first_segments fs ON ca.call_history_id = fs.call_history_id
        JOIN last_segments ls ON ca.call_history_id = ls.call_history_id
        LEFT JOIN answered_segments ans ON ca.call_history_id = ans.call_history_id
        ${handledByJoin}
        ${callQueuesJoin}
        ${callJourneyJoin}
        ${calleeFilterJoin}
        ${aggregatedWhereConditions.length > 0 ? 'WHERE ' + aggregatedWhereConditions.join(' AND ') : ''}
    `;
}

// ============================================
// TRANSFORM raw SQL row → AggregatedCallLog
// ============================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function transformRow(row: any): AggregatedCallLog {
    const firstStarted = row.first_started_at ? new Date(row.first_started_at) : null;
    const lastEnded = row.last_ended_at ? new Date(row.last_ended_at) : null;
    const firstAnswered = row.first_answered_at ? new Date(row.first_answered_at) : null;
    const answeredByHuman = row.answered_at ? new Date(row.answered_at) : null;
    const talkDurationSeconds = row.talk_duration_seconds ? Math.round(Number(row.talk_duration_seconds)) : 0;

    let parsedHandledByAgents: Array<{ number: string; name: string }> = [];
    if (row.handled_by_agents) {
        try {
            parsedHandledByAgents = typeof row.handled_by_agents === 'string'
                ? JSON.parse(row.handled_by_agents)
                : row.handled_by_agents;
        } catch { parsedHandledByAgents = []; }
    }
    const parsedHandledByCount = Number(row.handled_by_count || 0);

    const totalDurationSeconds = firstStarted && lastEnded
        ? Math.round((lastEnded.getTime() - firstStarted.getTime()) / 1000)
        : 0;
    const waitTimeSeconds = firstStarted && (answeredByHuman || firstAnswered)
        ? Math.round(((answeredByHuman || firstAnswered)!.getTime() - firstStarted.getTime()) / 1000)
        : (firstStarted && lastEnded ? Math.round((lastEnded.getTime() - firstStarted.getTime()) / 1000) : 0);

    const lastSegmentAnswered = row.answered_at !== null;
    const finalStatus = determineCallStatus({
        lastDestType: row.last_dest_type,
        lastDestEntityType: row.last_dest_entity_type,
        lastAnsweredAt: row.last_answered_at ? new Date(row.last_answered_at) : null,
        lastStartedAt: row.last_started_at ? new Date(row.last_started_at) : null,
        lastEndedAt: lastEnded,
        terminationReasonDetails: row.termination_reason_details,
        humanAnsweredAt: answeredByHuman,
    });
    const direction = determineCallDirection({
        sourceType: row.source_dn_type,
        firstDestType: row.first_dest_type,
        lastDestType: row.last_dest_type,
    });

    const totalTalkSeconds = Math.round(Number(row.handled_by_total_talk || 0));

    let handledByDisplay = "-";
    if (parsedHandledByAgents.length > 0) {
        const displayAgents = parsedHandledByAgents.slice(0, 5);
        handledByDisplay = displayAgents.map(a => a.name || a.number).join(", ");
        if (parsedHandledByCount > 5) {
            handledByDisplay += ` (+${parsedHandledByCount - 5})`;
        }
    }

    const parseJsonCol = (col: unknown): unknown[] => {
        if (!col) return [];
        try {
            const parsed = typeof col === 'string' ? JSON.parse(col) : col;
            return Array.isArray(parsed) ? parsed : [];
        } catch { return []; }
    };

    const queues = parseJsonCol(row.call_queues) as Array<{ number: string; name: string }>;
    const journey = parseJsonCol(row.call_journey);

    return {
        callHistoryId: row.call_history_id,
        callHistoryIdShort: row.call_history_id?.slice(-4).toUpperCase() || "-",
        segmentCount: Number(row.segment_count),
        startedAt: row.first_started_at?.toISOString() || "",
        endedAt: row.last_ended_at?.toISOString() || "",
        totalDurationSeconds: lastSegmentAnswered ? totalTalkSeconds : totalDurationSeconds,
        totalDurationFormatted: formatDuration(lastSegmentAnswered ? totalTalkSeconds : totalDurationSeconds),
        waitTimeSeconds,
        waitTimeFormatted: formatDuration(waitTimeSeconds),
        callerNumber: getDisplayNumber(row.source_dn_number, row.source_participant_phone_number, row.source_presentation),
        callerName: row.source_dn_type?.toLowerCase() === 'provider'
            ? (row.source_participant_name && !row.source_participant_name.trim().endsWith(':')
                ? getDisplayName(row.source_participant_name, null)
                : null)
            : (getDisplayName(row.source_participant_name, row.source_dn_name) || null),
        calleeNumber: getDisplayNumber(row.first_dest_number, row.first_dest_participant_phone),
        calleeName: row.source_dn_type?.toLowerCase() === 'provider'
            ? (getDisplayName(row.first_dest_participant_name, row.first_dest_dn_name)
                || (row.source_participant_name?.trim().endsWith(':') ? getDisplayName(row.source_participant_name, null) : null))
            : (getDisplayName(row.first_dest_participant_name, row.first_dest_dn_name) || null),
        handledBy: parsedHandledByAgents,
        handledByDisplay,
        totalTalkDurationSeconds: totalTalkSeconds,
        totalTalkDurationFormatted: formatDuration(totalTalkSeconds),
        direction,
        finalStatus,
        wasTransferred: Number(row.segment_count) > 1,
        queues,
        queuesDisplay: queues.length > 0
            ? queues.map((q: { number: string; name: string }) => q.name || q.number).join(", ")
            : "-",
        journey: journey as import("@/services/domain/call.types").JourneyStep[],
    };
}

// ============================================
// GET AGGREGATED CALL LOGS (paginated)
// ============================================

export async function getAggregatedCallLogs(
    startDate: Date,
    endDate: Date,
    filters: LogsFilters,
    pagination: { page: number; pageSize: number },
    sort?: LogsSort
): Promise<AggregatedCallLogsResponse> {
    const { whereClause, dateOnlyWhereClause, aggregatedWhereConditions, calleeFilterCTE, calleeFilterJoin, limit, skip, sortClause } =
        buildAggregatedQueryParts(startDate, endDate, filters, pagination, sort);
    const pageNumber = Math.max(1, pagination.page);

    try {
        const dataQuery = buildAggregateCTEs(whereClause, dateOnlyWhereClause, calleeFilterCTE)
            + DATA_SELECT
            + buildDataJoins(calleeFilterJoin, aggregatedWhereConditions, sortClause, limit, skip);

        const countQuery = buildCountQuery(
            whereClause, dateOnlyWhereClause, calleeFilterCTE, calleeFilterJoin,
            aggregatedWhereConditions, filters
        );

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const [rawResults, countResult] = await Promise.all([
            prisma.$queryRawUnsafe<any[]>(dataQuery),
            prisma.$queryRawUnsafe<{ total: bigint }[]>(countQuery),
        ]);

        const totalCount = Number(countResult[0]?.total || 0);
        const totalPages = Math.ceil(totalCount / limit);
        const logs = rawResults.map(transformRow);

        return { logs, totalCount, totalPages, currentPage: pageNumber };
    } catch (error) {
        console.error("❌ Error fetching aggregated call logs:", error);
        return { logs: [], totalCount: 0, totalPages: 0, currentPage: pageNumber };
    }
}

// ============================================
// GET CALL CHAIN (for modal - shows all segments)
// ============================================

export async function getCallChain(callHistoryId: string): Promise<CallChainSegment[]> {
    if (!callHistoryId) return [];

    try {
        const segments = await prisma.cdroutput.findMany({
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
        });

        return segments.map((seg) => {
            const startedAt = seg.cdr_started_at ? new Date(seg.cdr_started_at) : null;
            const endedAt = seg.cdr_ended_at ? new Date(seg.cdr_ended_at) : null;
            const answeredAt = seg.cdr_answered_at ? new Date(seg.cdr_answered_at) : null;
            const durationSeconds = startedAt && endedAt
                ? Math.round((endedAt.getTime() - startedAt.getTime()) / 1000 * 10) / 10
                : 0;

            const category = determineSegmentCategory({
                terminationReason: seg.termination_reason,
                terminationReasonDetails: seg.termination_reason_details,
                creationMethod: seg.creation_method,
                creationForwardReason: seg.creation_forward_reason,
                destinationType: seg.destination_dn_type,
                destinationEntityType: seg.destination_entity_type,
                sourceType: seg.source_dn_type,
                durationSeconds,
                wasAnswered: !!answeredAt,
            });

            return {
                id: seg.cdr_id,
                startedAt: seg.cdr_started_at?.toISOString() || "",
                answeredAt: answeredAt?.toISOString() || null,
                sourceNumber: getDisplayNumber(seg.source_dn_number, seg.source_participant_phone_number, seg.source_presentation),
                sourceName: seg.source_dn_type?.toLowerCase() === 'provider'
                    ? (seg.source_participant_name && !seg.source_participant_name.trim().endsWith(':')
                        ? getDisplayName(seg.source_participant_name, null)
                        : "")
                    : getDisplayName(seg.source_participant_name, seg.source_dn_name),
                sourceType: seg.source_dn_type || "-",
                destinationNumber: getDisplayNumber(seg.destination_dn_number, seg.destination_participant_phone_number, null),
                destinationName: seg.source_dn_type?.toLowerCase() === 'provider'
                    ? (getDisplayName(seg.destination_participant_name, seg.destination_dn_name)
                        || (seg.source_participant_name?.trim().endsWith(':') ? getDisplayName(seg.source_participant_name, null) : ""))
                    : getDisplayName(seg.destination_participant_name, seg.destination_dn_name),
                destinationType: seg.destination_dn_type || "-",
                status: determineSegmentStatus({
                    answeredAt: seg.cdr_answered_at,
                    startedAt: seg.cdr_started_at,
                    endedAt: seg.cdr_ended_at,
                    destType: seg.destination_dn_type,
                    destEntityType: seg.destination_entity_type,
                    terminationReasonDetails: seg.termination_reason_details,
                }),
                durationSeconds,
                durationFormatted: formatDuration(Math.round(durationSeconds)),
                terminationReason: seg.termination_reason || "-",
                terminationReasonDetails: seg.termination_reason_details || "",
                creationMethod: seg.creation_method || "-",
                creationForwardReason: seg.creation_forward_reason || "",
                originatingCdrId: seg.originating_cdr_id || null,
                category,
            };
        });
    } catch (error) {
        console.error("❌ Error fetching call chain:", error);
        return [];
    }
}

// ============================================
// CSV EXPORT
// ============================================

async function exportAllCallLogs(
    startDate: Date,
    endDate: Date,
    filters: LogsFilters,
): Promise<AggregatedCallLogsResponse> {
    const PAGE_SIZE = 100;
    const allLogs: AggregatedCallLog[] = [];
    let page = 1;
    let totalPages = 1;

    while (page <= totalPages) {
        const response = await getAggregatedCallLogs(startDate, endDate, filters, { page, pageSize: PAGE_SIZE });
        allLogs.push(...response.logs);
        totalPages = response.totalPages;
        page++;
    }

    return { logs: allLogs, totalCount: allLogs.length, totalPages: 1, currentPage: 1 };
}

export async function exportCallLogsCSV(
    startDate: Date,
    endDate: Date,
    filters: LogsFilters,
    idsOnly: boolean = false
): Promise<string> {
    const response = await exportAllCallLogs(startDate, endDate, filters);

    if (idsOnly) {
        return ["call_history_id", ...response.logs.map((log) => log.callHistoryId)].join("\n");
    }

    const headers = ["ID", "Date/Heure", "Appelant", "Nom Appelant", "Appelé", "Nom Appelé", "Direction", "Statut", "Durée Totale", "Temps Attente", "Segments", "Transféré"];
    const rows = response.logs.map((log) => [
        log.callHistoryIdShort,
        log.startedAt,
        log.callerNumber,
        log.callerName || "",
        log.calleeNumber,
        log.calleeName || "",
        log.direction,
        log.finalStatus,
        log.totalDurationFormatted,
        log.waitTimeFormatted,
        log.segmentCount,
        log.wasTransferred ? "Oui" : "Non",
    ]);

    return [
        headers.join(";"),
        ...rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(";")),
    ].join("\n");
}
