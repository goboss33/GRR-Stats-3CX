"use server";

import { prisma } from "@/lib/prisma";
import {
    AggregatedCallLog,
    CallDirection,
    CallStatus,
    LogsFilters,
    LogsSort,
    AggregatedCallLogsResponse,
    CallChainSegment,
    SegmentCategory,
} from "@/types/logs.types";

// ============================================
// HELPER FUNCTIONS
// ============================================

function determineDirection(
    sourceType: string | null,
    firstDestType: string | null,
    lastDestType: string | null
): CallDirection {
    // Bridge calls: if source, first destination, or last destination involves bridge
    const srcIsBridge = sourceType?.toLowerCase() === "bridge";
    const firstDestIsBridge = firstDestType?.toLowerCase() === "bridge";
    const lastDestIsBridge = lastDestType?.toLowerCase() === "bridge";
    if (srcIsBridge || firstDestIsBridge || lastDestIsBridge) return "bridge";

    const srcIsExt = sourceType?.toLowerCase() === "extension";
    const destIsExt = firstDestType?.toLowerCase() === "extension";
    if (srcIsExt && destIsExt) return "internal";
    if (srcIsExt && !destIsExt) return "outbound";
    return "inbound";
}

function determineStatus(
    answeredAt: Date | null,
    startedAt: Date | null,
    endedAt: Date | null,
    destType: string | null
): CallStatus {
    if (answeredAt) {
        // Check if answered by a human (extension) or by IVR/queue/script
        const isHumanAnswer = destType?.toLowerCase() === "extension";
        return isHumanAnswer ? "answered" : "routed";
    }
    if (startedAt && endedAt) {
        const ringTime = endedAt.getTime() - startedAt.getTime();
        if (ringTime > 5000) return "abandoned";
    }
    return "missed";
}

function determineSegmentCategory(
    terminationReason: string | null,
    terminationReasonDetails: string | null,
    creationMethod: string | null,
    creationForwardReason: string | null,
    destinationType: string | null,
    sourceType: string | null,
    durationSeconds: number,
    wasAnswered: boolean
): SegmentCategory {
    const termReason = terminationReason?.toLowerCase() || "";
    const termDetails = terminationReasonDetails?.toLowerCase() || "";
    const createMethod = creationMethod?.toLowerCase() || "";
    const createForward = creationForwardReason?.toLowerCase() || "";
    const destType = destinationType?.toLowerCase() || "";
    const srcType = sourceType?.toLowerCase() || "";

    // Bridge segments
    if (srcType === "bridge" || destType === "bridge") {
        return "bridge";
    }

    // Voicemail segments
    if (destType === "vmail_console" || destType === "voicemail") {
        return "voicemail";
    }

    // IVR/Script segments
    if (destType === "script" || destType === "ivr") {
        return "ivr";
    }

    // Queue segments
    if (destType === "queue") {
        return "queue";
    }

    // Routing segments: ultra-short redirections (system routing)
    if (termReason === "redirected" && durationSeconds < 1) {
        return "routing";
    }

    // Ringing segments: agent polled but didn't answer
    if (createMethod === "route_to" && createForward === "polling") {
        if (termReason === "cancelled") {
            return "ringing";
        }
    }

    // Conversation: answered with significant duration
    if (wasAnswered && destType === "extension" && durationSeconds > 1) {
        return "conversation";
    }

    // Transfer segments
    if (createMethod === "transfer" || createMethod === "divert") {
        if (wasAnswered && durationSeconds > 1) {
            return "conversation";
        }
        if (termReason === "continued_in") {
            return "transfer";
        }
    }

    // Missed/Rejected segments
    if (termReason === "rejected" || termDetails === "no_route") {
        return "missed";
    }
    if (!wasAnswered && (termReason === "src_participant_terminated" || termReason === "dst_participant_terminated")) {
        return "missed";
    }

    // Fallback based on answered status
    if (wasAnswered) {
        return "conversation";
    }

    return "unknown";
}

function formatDuration(seconds: number): string {
    if (seconds < 0) seconds = 0;
    const mins = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);
    return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function getDisplayNumber(
    dnNumber: string | null,
    participantNumber: string | null,
    presentation: string | null = null
): string {
    if (participantNumber && participantNumber.trim() !== "") {
        return participantNumber;
    }
    if (presentation && presentation.trim() !== "" && !presentation.includes(":")) {
        return presentation;
    }
    return dnNumber || "-";
}

function getDisplayName(
    participantName: string | null,
    dnName: string | null
): string {
    if (participantName && participantName.trim() !== "") {
        return participantName.replace(/:$/, "").trim();
    }
    if (dnName && dnName.trim() !== "") {
        return dnName;
    }
    return "";
}

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

// Build SQL condition for direction filter (applied on aggregated data)
function buildSqlDirectionFilter(directions: CallDirection[] | undefined): string {
    if (!directions || directions.length === 0 || directions.length === 4) {
        return ''; // No filter needed
    }
    const conditions: string[] = [];
    // Direction is based on: source_dn_type (first segment) and first_dest_type
    // bridge: source OR destination is bridge
    // inbound: source is NOT extension (and not bridge)
    // outbound: source IS extension AND destination is NOT extension (and not bridge)
    // internal: source IS extension AND destination IS extension
    if (directions.includes('bridge')) {
        conditions.push("(fs.source_dn_type = 'bridge' OR fs.destination_dn_type = 'bridge' OR ls.last_dest_type = 'bridge')");
    }
    if (directions.includes('inbound')) {
        conditions.push("(fs.source_dn_type != 'extension' AND fs.source_dn_type != 'bridge' AND (ls.last_dest_type != 'bridge' OR ls.last_dest_type IS NULL))");
    }
    if (directions.includes('outbound')) {
        conditions.push("(fs.source_dn_type = 'extension' AND fs.destination_dn_type != 'extension' AND fs.destination_dn_type != 'bridge' AND (ls.last_dest_type != 'bridge' OR ls.last_dest_type IS NULL))");
    }
    if (directions.includes('internal')) {
        conditions.push("(fs.source_dn_type = 'extension' AND fs.destination_dn_type = 'extension')");
    }
    return conditions.length > 0 ? `(${conditions.join(' OR ')})` : '';
}

// Build SQL condition for status filter (applied on aggregated data)
function buildSqlStatusFilter(statuses: CallStatus[] | undefined): string {
    if (!statuses || statuses.length === 0 || statuses.length === 4) {
        return ''; // No filter needed
    }
    const conditions: string[] = [];
    // Status is based on:
    // answered: ans.answered_at IS NOT NULL (human answered)
    // routed: ca.first_answered_at IS NOT NULL AND ans.answered_at IS NULL (IVR/queue answered but no human)
    // missed: no answer with short ring time
    // abandoned: no answer with longer ring time
    if (statuses.includes('answered')) {
        conditions.push("(ans.answered_at IS NOT NULL)");
    }
    if (statuses.includes('routed')) {
        conditions.push("(ca.first_answered_at IS NOT NULL AND ans.answered_at IS NULL)");
    }
    if (statuses.includes('missed')) {
        // Missed = not answered, short ring time (< 5 seconds)
        conditions.push("(ca.first_answered_at IS NULL AND EXTRACT(EPOCH FROM (ca.last_ended_at - ca.first_started_at)) <= 5)");
    }
    if (statuses.includes('abandoned')) {
        // Abandoned = not answered, longer ring time (> 5 seconds)
        conditions.push("(ca.first_answered_at IS NULL AND EXTRACT(EPOCH FROM (ca.last_ended_at - ca.first_started_at)) > 5)");
    }
    return conditions.length > 0 ? `(${conditions.join(' OR ')})` : '';
}


// ============================================
// MAIN FUNCTION: GET AGGREGATED CALL LOGS
// ============================================

export async function getAggregatedCallLogs(
    startDate: Date,
    endDate: Date,
    filters: LogsFilters,
    pagination: { page: number; pageSize: number },
    sort?: LogsSort
): Promise<AggregatedCallLogsResponse> {
    const pageNumber = Math.max(1, pagination.page);
    const limit = Math.min(100, Math.max(1, pagination.pageSize));
    const skip = (pageNumber - 1) * limit;

    // Build WHERE conditions for segments
    const whereConditions: string[] = [
        `cdr_started_at >= '${startDate.toISOString()}'`,
        `cdr_started_at <= '${endDate.toISOString()}'`,
    ];

    // Direction filter (applied on first segment later via subquery)
    // Status filter (applied on final status after aggregation)

    // Caller search (on first segment fields)
    if (filters.callerSearch?.trim()) {
        const pattern = parseSearchPattern(filters.callerSearch);
        whereConditions.push(`(
            ${buildSqlSearchCondition('source_dn_number', pattern)} OR
            ${buildSqlSearchCondition('source_participant_phone_number', pattern)} OR
            ${buildSqlSearchCondition('source_participant_name', pattern)} OR
            ${buildSqlSearchCondition('source_dn_name', pattern)}
        )`);
    }

    // Callee search (on last segment fields)
    if (filters.calleeSearch?.trim()) {
        const pattern = parseSearchPattern(filters.calleeSearch);
        whereConditions.push(`(
            ${buildSqlSearchCondition('destination_dn_number', pattern)} OR
            ${buildSqlSearchCondition('destination_participant_phone_number', pattern)} OR
            ${buildSqlSearchCondition('destination_participant_name', pattern)} OR
            ${buildSqlSearchCondition('destination_dn_name', pattern)}
        )`);
    }

    // Duration filter (total duration)
    if (filters.durationMin !== undefined) {
        whereConditions.push(`EXTRACT(EPOCH FROM (cdr_ended_at - cdr_answered_at)) >= ${filters.durationMin}`);
    }
    if (filters.durationMax !== undefined) {
        whereConditions.push(`EXTRACT(EPOCH FROM (cdr_ended_at - cdr_answered_at)) <= ${filters.durationMax}`);
    }

    // ID search filter (on call_history_id)
    if (filters.idSearch?.trim()) {
        const pattern = parseSearchPattern(filters.idSearch);
        whereConditions.push(buildSqlSearchCondition('call_history_id', pattern));
    }

    const whereClause = whereConditions.join(" AND ");

    // Build a minimal WHERE clause for answered_segments and handled_by CTEs
    // These CTEs should NOT include calleeSearch filter because the answered segment
    // might have a different destination than the first segment that matches the search
    const dateOnlyWhereClause = [
        `cdr_started_at >= '${startDate.toISOString()}'`,
        `cdr_started_at <= '${endDate.toISOString()}'`,
    ].join(" AND ");

    // Build aggregated-level filters (applied after CTEs join)
    const aggregatedWhereConditions: string[] = [];
    const directionFilter = buildSqlDirectionFilter(filters.directions);
    if (directionFilter) aggregatedWhereConditions.push(directionFilter);
    const statusFilter = buildSqlStatusFilter(filters.statuses);
    if (statusFilter) aggregatedWhereConditions.push(statusFilter);

    // Handled by search filter (on handled_by CTE data)
    if (filters.handledBySearch?.trim()) {
        const pattern = parseSearchPattern(filters.handledBySearch);
        const searchValue = pattern.value.replace(/'/g, "''"); // Escape quotes
        // Search in the JSON array of agents
        aggregatedWhereConditions.push(`(
            hb.agents::text ILIKE '%${searchValue}%'
        )`);
    }

    // Segment count filter (on aggregated data)
    if (filters.segmentCountMin !== undefined) {
        aggregatedWhereConditions.push(`ca.segment_count >= ${filters.segmentCountMin}`);
    }
    if (filters.segmentCountMax !== undefined) {
        aggregatedWhereConditions.push(`ca.segment_count <= ${filters.segmentCountMax}`);
    }

    try {
        // Step 1: Get distinct call_history_ids with aggregated data
        const aggregatedQuery = `
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
                    cdr_answered_at,
                    cdr_started_at as last_started_at,
                    cdr_ended_at as last_ended_at,
                    termination_reason
                FROM cdroutput
                WHERE ${whereClause}
                ORDER BY call_history_id, cdr_started_at DESC
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
                ORDER BY c.call_history_id, c.cdr_answered_at ASC
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
            )
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
                fs.first_dest_participant_name,
                fs.first_dest_dn_name,
                fs.destination_dn_type as first_dest_type,
                ls.destination_dn_number,
                ls.destination_participant_phone_number,
                ls.destination_participant_name,
                ls.destination_dn_name,
                ls.last_dest_type,
                ls.cdr_answered_at as last_answered_at,
                ls.last_started_at,
                ls.last_ended_at,
                ls.termination_reason,
                ans.answered_dest_number,
                ans.answered_dest_name,
                ans.answered_dn_name,
                ans.answered_dest_type,
                ans.answered_at,
                ans.answered_ended_at,
                ans.talk_duration_seconds,
                hb.agents as handled_by_agents,
                hb.total_talk_seconds as handled_by_total_talk,
                hb.agent_count as handled_by_count
            FROM call_aggregates ca
            JOIN first_segments fs ON ca.call_history_id = fs.call_history_id
            JOIN last_segments ls ON ca.call_history_id = ls.call_history_id
            LEFT JOIN answered_segments ans ON ca.call_history_id = ans.call_history_id
            LEFT JOIN handled_by hb ON ca.call_history_id = hb.call_history_id
            ${aggregatedWhereConditions.length > 0 ? 'WHERE ' + aggregatedWhereConditions.join(' AND ') : ''}
            ORDER BY ca.first_started_at DESC
            LIMIT ${limit} OFFSET ${skip}
        `;

        // Count query uses same CTEs and filters to get accurate count
        const countQuery = `
            WITH call_aggregates AS (
                SELECT 
                    call_history_id,
                    COUNT(*) as segment_count
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
                WHERE ${whereClause}
                ORDER BY call_history_id, cdr_started_at ASC
            ),
            last_segments AS (
                SELECT DISTINCT ON (call_history_id)
                    call_history_id,
                    destination_dn_type as last_dest_type,
                    cdr_answered_at,
                    cdr_started_at as last_started_at,
                    cdr_ended_at as last_ended_at
                FROM cdroutput
                WHERE ${whereClause}
                ORDER BY call_history_id, cdr_started_at DESC
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
                ORDER BY c.call_history_id, c.cdr_answered_at ASC
            )
            SELECT COUNT(*) as total
            FROM call_aggregates ca
            JOIN first_segments fs ON ca.call_history_id = fs.call_history_id
            JOIN last_segments ls ON ca.call_history_id = ls.call_history_id
            LEFT JOIN answered_segments ans ON ca.call_history_id = ans.call_history_id
            ${aggregatedWhereConditions.length > 0 ? 'WHERE ' + aggregatedWhereConditions.join(' AND ') : ''}
        `;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const [rawResults, countResult] = await Promise.all([
            prisma.$queryRawUnsafe<any[]>(aggregatedQuery),
            prisma.$queryRawUnsafe<{ total: bigint }[]>(countQuery),
        ]);

        const totalCount = Number(countResult[0]?.total || 0);
        const totalPages = Math.ceil(totalCount / limit);

        // Transform results to AggregatedCallLog
        const logs: AggregatedCallLog[] = rawResults.map((row) => {
            const firstStarted = row.first_started_at ? new Date(row.first_started_at) : null;
            const lastEnded = row.last_ended_at ? new Date(row.last_ended_at) : null;
            const firstAnswered = row.first_answered_at ? new Date(row.first_answered_at) : null;

            // Use answered_segment data if available (call was answered by human)
            const answeredByHuman = row.answered_at ? new Date(row.answered_at) : null;
            const answeredEndedAt = row.answered_ended_at ? new Date(row.answered_ended_at) : null;
            const talkDurationSeconds = row.talk_duration_seconds ? Math.round(Number(row.talk_duration_seconds)) : 0;

            // Parse handled_by_agents - PostgreSQL may return JSON as string
            let parsedHandledByAgents: Array<{ number: string; name: string }> = [];
            if (row.handled_by_agents) {
                try {
                    parsedHandledByAgents = typeof row.handled_by_agents === 'string'
                        ? JSON.parse(row.handled_by_agents)
                        : row.handled_by_agents;
                } catch {
                    parsedHandledByAgents = [];
                }
            }
            const parsedHandledByCount = Number(row.handled_by_count || 0);

            // Total duration = from first start to last end
            const totalDurationSeconds = firstStarted && lastEnded
                ? Math.round((lastEnded.getTime() - firstStarted.getTime()) / 1000)
                : 0;

            // Wait time = time until answered by human (or first answered segment)
            const waitTimeSeconds = firstStarted && (answeredByHuman || firstAnswered)
                ? Math.round(((answeredByHuman || firstAnswered)!.getTime() - firstStarted.getTime()) / 1000)
                : (firstStarted && lastEnded ? Math.round((lastEnded.getTime() - firstStarted.getTime()) / 1000) : 0);

            // Determine final status - prioritize answered_segment (human answered)
            // New logic based on final result:
            // - Traité (answered): someone answered AND call ended normally (not abandoned in queue)
            // - Abandonné (abandoned): caller hung up while in queue/waiting or call ended after being transferred without resolution
            // - Manqué (missed): no one ever answered
            let finalStatus: CallStatus;
            const termReason = row.termination_reason?.toLowerCase() || "";
            const hasConversation = answeredByHuman !== null || parsedHandledByAgents.length > 0;

            if (hasConversation) {
                // Someone had a conversation
                // Check if call ended properly or was abandoned
                if (termReason === "src_participant_terminated" && row.last_dest_type === "queue") {
                    // Caller hung up while in queue after transfer - abandoned
                    finalStatus = "abandoned";
                } else {
                    // Call ended normally after conversation - answered/treated
                    finalStatus = "answered";
                }
            } else if (firstAnswered) {
                // Call was answered by IVR/queue/script but not by human
                finalStatus = "routed";
            } else {
                // Call was never answered
                const lastStarted = row.last_started_at ? new Date(row.last_started_at) : null;
                if (lastStarted && lastEnded) {
                    const ringTime = lastEnded.getTime() - lastStarted.getTime();
                    finalStatus = ringTime > 5000 ? "abandoned" : "missed";
                } else {
                    finalStatus = "missed";
                }
            }

            // Determine direction - check first and last segments for bridge
            const direction = determineDirection(row.source_dn_type, row.first_dest_type, row.last_dest_type);

            // Was transferred if more than 1 segment
            const wasTransferred = Number(row.segment_count) > 1;

            // Process handledBy data - using already parsed values from above
            const handledByAgents = parsedHandledByAgents;
            const handledByCount = parsedHandledByCount;
            const totalTalkSeconds = Math.round(Number(row.handled_by_total_talk || 0));

            // Format display: max 5 agents + "et N autres"
            let handledByDisplay = "-";
            if (handledByAgents.length > 0) {
                const displayAgents = handledByAgents.slice(0, 5);
                const agentNames = displayAgents.map(a => a.name || a.number);
                handledByDisplay = agentNames.join(", ");
                if (handledByCount > 5) {
                    handledByDisplay += ` (+${handledByCount - 5})`;
                }
            }

            return {
                callHistoryId: row.call_history_id,
                callHistoryIdShort: row.call_history_id?.slice(-4).toUpperCase() || "-",
                segmentCount: Number(row.segment_count),

                startedAt: row.first_started_at?.toISOString() || "",
                endedAt: row.last_ended_at?.toISOString() || "",
                // Use talk duration for answered calls, otherwise show total duration
                totalDurationSeconds: hasConversation ? totalTalkSeconds : totalDurationSeconds,
                totalDurationFormatted: formatDuration(hasConversation ? totalTalkSeconds : totalDurationSeconds),
                waitTimeSeconds,
                waitTimeFormatted: formatDuration(waitTimeSeconds),

                callerNumber: getDisplayNumber(row.source_dn_number, row.source_participant_phone_number, row.source_presentation),
                // For 'provider' source: 
                // - If source_participant_name ends with ':' → it's a SDA/rule name, caller is unknown
                // - If source_participant_name does NOT end with ':' → it's the actual caller's name (recognized employee)
                callerName: row.source_dn_type?.toLowerCase() === 'provider'
                    ? (row.source_participant_name && !row.source_participant_name.trim().endsWith(':')
                        ? getDisplayName(row.source_participant_name, null)
                        : null)
                    : (getDisplayName(row.source_participant_name, row.source_dn_name) || null),

                // Use FIRST destination (initial recipient the caller tried to reach)
                calleeNumber: row.first_dest_number || "",
                calleeName: getDisplayName(row.first_dest_participant_name, row.first_dest_dn_name) || null,

                // Handled by data
                handledBy: handledByAgents,
                handledByDisplay,
                totalTalkDurationSeconds: totalTalkSeconds,
                totalTalkDurationFormatted: formatDuration(totalTalkSeconds),

                direction,
                finalStatus,
                wasTransferred,
            };
        });

        // No post-query filtering needed - filters are applied in SQL

        return {
            logs,
            totalCount,
            totalPages,
            currentPage: pageNumber,
        };
    } catch (error) {
        console.error("❌ Error fetching aggregated call logs:", error);
        return {
            logs: [],
            totalCount: 0,
            totalPages: 0,
            currentPage: pageNumber,
        };
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
                termination_reason: true,
                termination_reason_details: true,
                creation_method: true,
                creation_forward_reason: true,
            },
        });

        return segments.map((seg) => {
            const startedAt = seg.cdr_started_at ? new Date(seg.cdr_started_at) : null;
            const endedAt = seg.cdr_ended_at ? new Date(seg.cdr_ended_at) : null;
            const answeredAt = seg.cdr_answered_at ? new Date(seg.cdr_answered_at) : null;

            // Calculate duration in seconds (from start to end)
            const durationSeconds = startedAt && endedAt
                ? Math.round((endedAt.getTime() - startedAt.getTime()) / 1000 * 10) / 10
                : 0;

            // Determine segment category
            const category = determineSegmentCategory(
                seg.termination_reason,
                seg.termination_reason_details,
                seg.creation_method,
                seg.creation_forward_reason,
                seg.destination_dn_type,
                seg.source_dn_type,
                durationSeconds,
                !!answeredAt
            );

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
                status: determineStatus(seg.cdr_answered_at, seg.cdr_started_at, seg.cdr_ended_at, seg.destination_dn_type),
                durationSeconds,
                durationFormatted: formatDuration(Math.round(durationSeconds)),
                terminationReason: seg.termination_reason || "-",
                terminationReasonDetails: seg.termination_reason_details || "",
                creationMethod: seg.creation_method || "-",
                creationForwardReason: seg.creation_forward_reason || "",
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

export async function exportCallLogsCSV(
    startDate: Date,
    endDate: Date,
    filters: LogsFilters
): Promise<string> {
    const response = await getAggregatedCallLogs(startDate, endDate, filters, { page: 1, pageSize: 5000 });

    const headers = [
        "ID",
        "Date/Heure",
        "Appelant",
        "Nom Appelant",
        "Appelé",
        "Nom Appelé",
        "Direction",
        "Statut",
        "Durée Totale",
        "Temps Attente",
        "Segments",
        "Transféré",
    ];

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

    const csvContent = [
        headers.join(";"),
        ...rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(";")),
    ].join("\n");

    return csvContent;
}