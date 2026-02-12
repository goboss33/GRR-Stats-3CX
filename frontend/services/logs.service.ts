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

    // Check if destination is an internal system (Queue, IVR, RingGroup, etc.)
    const internalSystemDestinations = ['queue', 'ring_group', 'ring_group_ring_all', 'ivr', 'process', 'parking'];
    if (srcIsExt && internalSystemDestinations.includes(firstDestType?.toLowerCase() || '')) {
        return "internal";
    }

    if (srcIsExt && !destIsExt) return "outbound";
    return "inbound";
}

function determineStatus(
    answeredAt: Date | null,
    startedAt: Date | null,
    endedAt: Date | null,
    destType: string | null,
    destEntityType: string | null,
    terminationReasonDetails: string | null
): CallStatus {
    // Check for voicemail
    const isVoicemail = destType?.toLowerCase() === 'vmail_console' ||
        destType?.toLowerCase() === 'voicemail' ||
        destEntityType?.toLowerCase() === 'voicemail';
    if (isVoicemail) {
        return "voicemail";
    }

    // Check for busy
    if (terminationReasonDetails?.toLowerCase()?.includes('busy')) {
        return "busy";
    }

    if (answeredAt) {
        // Check if answered by a human (extension) or by IVR/queue/script
        const isHumanAnswer = destType?.toLowerCase() === "extension" &&
            destEntityType?.toLowerCase() !== "voicemail";
        return isHumanAnswer ? "answered" : "abandoned"; // If not human, treat as abandoned
    }

    // Not answered = abandoned
    return "abandoned";
}

function determineSegmentCategory(
    terminationReason: string | null,
    terminationReasonDetails: string | null,
    creationMethod: string | null,
    creationForwardReason: string | null,
    destinationType: string | null,
    destinationEntityType: string | null,
    sourceType: string | null,
    durationSeconds: number,
    wasAnswered: boolean
): SegmentCategory {
    const termReason = terminationReason?.toLowerCase() || "";
    const termDetails = terminationReasonDetails?.toLowerCase() || "";
    const createMethod = creationMethod?.toLowerCase() || "";
    const createForward = creationForwardReason?.toLowerCase() || "";
    const destType = destinationType?.toLowerCase() || "";
    const destEntityType = destinationEntityType?.toLowerCase() || "";
    const srcType = sourceType?.toLowerCase() || "";

    // Bridge segments
    if (srcType === "bridge" || destType === "bridge") {
        return "bridge";
    }

    // Voicemail segments - check both destination_dn_type AND destination_entity_type
    if (destType === "vmail_console" || destType === "voicemail" || destEntityType === "voicemail") {
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

    // System routing segments: outbound_rule, inbound_routing, or ultra-short redirections
    // These are internal system routing, not real call attempts
    // destType === "unknown" covers outbound_rule and inbound_routing
    if (destType === "unknown") {
        return "routing";
    }
    if (termReason === "redirected" && durationSeconds < 1) {
        return "routing";
    }

    // Ringing segments: agent polled but didn't answer (another agent answered)
    // Important: cancelled + terminated_by_originator means CALLER hung up, not ringing
    if (createMethod === "route_to" && createForward === "polling") {
        if (termReason === "cancelled") {
            // Check WHY it was cancelled
            if (termDetails === "completed_elsewhere" || termDetails === "") {
                // Empty details or completed_elsewhere = someone else answered
                return "ringing";
            }
            if (termDetails === "terminated_by_originator") {
                // Caller hung up before getting an answer
                return "abandoned";
            }
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

    // Busy segments - the recipient was busy
    if (termDetails.includes("busy")) {
        return "busy";
    }

    // Rejected segments - call was explicitly rejected by destination
    if (termReason === "rejected") {
        return "rejected";
    }

    // No route - routing failure
    if (termDetails === "no_route") {
        return "routing";
    }

    // Caller/destination hung up before answer
    if (!wasAnswered && (termReason === "src_participant_terminated" || termReason === "dst_participant_terminated")) {
        return "abandoned";
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
    const internalSystemTypes = "'queue', 'ring_group', 'ring_group_ring_all', 'ivr', 'process', 'parking'";

    if (directions.includes('bridge')) {
        conditions.push("(fs.source_dn_type = 'bridge' OR fs.destination_dn_type = 'bridge' OR ls.last_dest_type = 'bridge')");
    }
    if (directions.includes('inbound')) {
        conditions.push("(fs.source_dn_type != 'extension' AND fs.source_dn_type != 'bridge' AND (ls.last_dest_type != 'bridge' OR ls.last_dest_type IS NULL))");
    }
    if (directions.includes('outbound')) {
        // Outbound: extension -> external (previous logic was just != extension)
        // Now we must ensure destination is NOT one of the internal system types either
        conditions.push(`(fs.source_dn_type = 'extension' AND fs.destination_dn_type NOT IN ('extension', 'bridge', ${internalSystemTypes}) AND (ls.last_dest_type != 'bridge' OR ls.last_dest_type IS NULL))`);
    }
    if (directions.includes('internal')) {
        // Internal: extension -> extension OR extension -> internal system (queue, ivr, etc)
        conditions.push(`(fs.source_dn_type = 'extension' AND (fs.destination_dn_type = 'extension' OR fs.destination_dn_type IN (${internalSystemTypes})))`);
    }
    return conditions.length > 0 ? `(${conditions.join(' OR ')})` : '';
}

// Build SQL condition for status filter (applied on aggregated data)
// Uses the SAME LOGIC as determineSegmentCategory for consistency
function buildSqlStatusFilter(statuses: CallStatus[] | undefined): string {
    if (!statuses || statuses.length === 0 || statuses.length === 5) {
        return ''; // No filter needed
    }
    const conditions: string[] = [];

    // Status detection logic - MUST MATCH the finalStatus logic in getAggregatedCallLogs:
    // 1. voicemail: last_dest_type or last_dest_entity_type is voicemail
    // 2. busy: termination_reason_details contains 'busy'
    // 3. answered: for system types (queue, ring_group, etc.), requires ans.answered_at
    //              for other types, requires ls.cdr_answered_at AND duration > 1s
    // 4. abandoned: not answered (for system types: answered by system but no human answer)

    // System types that need special handling
    const systemTypes = "'queue', 'ring_group', 'ring_group_ring_all', 'ivr', 'process', 'parking'";
    const systemEntityTypes = "'queue', 'ivr'";

    if (statuses.includes('voicemail')) {
        // Messagerie: le dernier segment est du voicemail
        conditions.push("(ls.last_dest_type IN ('vmail_console', 'voicemail') OR ls.last_dest_entity_type = 'voicemail')");
    }
    if (statuses.includes('busy')) {
        // Occupé: le correspondant était occupé
        conditions.push("(ls.termination_reason_details ILIKE '%busy%')");
    }
    if (statuses.includes('answered')) {
        // Répondu: 
        // - Pour les types système: ans.answered_at doit exister (un humain a répondu)
        // - Pour les autres types: ls.cdr_answered_at ET durée > 1s
        conditions.push(`(
            COALESCE(ls.last_dest_entity_type, '') NOT IN ('voicemail') 
            AND COALESCE(ls.termination_reason_details, '') NOT ILIKE '%busy%'
            AND COALESCE(ls.last_dest_type, '') NOT IN ('vmail_console', 'voicemail')
            AND (
                -- System types: need human answer (from answered_segments)
                (COALESCE(ls.last_dest_type, '') IN (${systemTypes}) OR COALESCE(ls.last_dest_entity_type, '') IN (${systemEntityTypes}))
                AND ans.answered_at IS NOT NULL
                OR
                -- Non-system types: standard logic
                (COALESCE(ls.last_dest_type, '') NOT IN (${systemTypes}) AND COALESCE(ls.last_dest_entity_type, '') NOT IN (${systemEntityTypes}))
                AND ls.cdr_answered_at IS NOT NULL 
                AND EXTRACT(EPOCH FROM (ls.last_ended_at - ls.last_started_at)) > 1
            )
        )`);
    }
    if (statuses.includes('abandoned')) {
        // Abandonné:
        // - Pour les types système: le système a répondu mais aucun humain n'a répondu (ans.answered_at IS NULL)
        // - Pour les autres types: ls.cdr_answered_at IS NULL ou durée <= 1s
        conditions.push(`(
            COALESCE(ls.termination_reason_details, '') NOT ILIKE '%busy%' 
            AND COALESCE(ls.last_dest_type, '') NOT IN ('vmail_console', 'voicemail') 
            AND COALESCE(ls.last_dest_entity_type, '') != 'voicemail'
            AND (
                -- System types: answered by system but no human answer
                (COALESCE(ls.last_dest_type, '') IN (${systemTypes}) OR COALESCE(ls.last_dest_entity_type, '') IN (${systemEntityTypes}))
                AND ls.cdr_answered_at IS NOT NULL
                AND ans.answered_at IS NULL
                OR
                -- System types: not even answered by system
                (COALESCE(ls.last_dest_type, '') IN (${systemTypes}) OR COALESCE(ls.last_dest_entity_type, '') IN (${systemEntityTypes}))
                AND ls.cdr_answered_at IS NULL
                OR
                -- Non-system types: not answered or very short
                (COALESCE(ls.last_dest_type, '') NOT IN (${systemTypes}) AND COALESCE(ls.last_dest_entity_type, '') NOT IN (${systemEntityTypes}))
                AND (ls.cdr_answered_at IS NULL OR EXTRACT(EPOCH FROM (ls.last_ended_at - ls.last_started_at)) <= 1)
            )
        )`);
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

    // Callee search - filter calls based on the FIRST segment's destination (what's displayed)
    // Also includes source_participant_name for SDA name search (e.g., "Direct Teresa Troiano")
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
                        destination_dn_name,
                        source_participant_name
                    FROM cdroutput
                    WHERE cdr_started_at >= '${startDate.toISOString()}'
                      AND cdr_started_at <= '${endDate.toISOString()}'
                    ORDER BY call_history_id, cdr_started_at ASC
                ) first_dest
                WHERE (
                    ${buildSqlSearchCondition('destination_dn_number', pattern)} OR
                    ${buildSqlSearchCondition('destination_participant_phone_number', pattern)} OR
                    ${buildSqlSearchCondition('destination_participant_name', pattern)} OR
                    ${buildSqlSearchCondition('destination_dn_name', pattern)} OR
                    ${buildSqlSearchCondition('source_participant_name', pattern)}
                )
            )`;
        calleeFilterJoin = 'JOIN callee_filter cf ON ca.call_history_id = cf.call_history_id';
    }

    // Duration filter (total duration)
    if (filters.durationMin !== undefined) {
        whereConditions.push(`EXTRACT(EPOCH FROM (cdr_ended_at - cdr_answered_at)) >= ${filters.durationMin}`);
    }
    if (filters.durationMax !== undefined) {
        whereConditions.push(`EXTRACT(EPOCH FROM (cdr_ended_at - cdr_answered_at)) <= ${filters.durationMax}`);
    }

    // ID search filter (on call_history_id - cast to text for ILIKE on UUID)
    if (filters.idSearch?.trim()) {
        const pattern = parseSearchPattern(filters.idSearch);
        whereConditions.push(buildSqlSearchCondition('call_history_id::text', pattern));
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
    // Always use contains mode for consistency with other search columns
    if (filters.handledBySearch?.trim()) {
        const pattern = parseSearchPattern(filters.handledBySearch);
        const searchValue = pattern.value.replace(/'/g, "''"); // Escape quotes
        // Always wrap with % for contains search (JSON text search needs this)
        const likePattern = `%${searchValue}%`;
        // Search in the JSON array of agents (number and name)
        aggregatedWhereConditions.push(`(
            hb.agents::text ILIKE '${likePattern}'
        )`);
    }

    // Queue search filter (on call_queues CTE data)
    // Always use contains mode for consistency with other search columns
    if (filters.queueSearch?.trim()) {
        const pattern = parseSearchPattern(filters.queueSearch);
        const searchValue = pattern.value.replace(/'/g, "''"); // Escape quotes
        // Always wrap with % for contains search (JSON text search needs this)
        const likePattern = `%${searchValue}%`;
        // Search in the JSON array of queues (number and name)
        aggregatedWhereConditions.push(`(
            cq.queues::text ILIKE '${likePattern}'
        )`);
    }

    // Segment count filter (on aggregated data)
    if (filters.segmentCountMin !== undefined) {
        aggregatedWhereConditions.push(`ca.segment_count >= ${filters.segmentCountMin}`);
    }
    if (filters.segmentCountMax !== undefined) {
        aggregatedWhereConditions.push(`ca.segment_count <= ${filters.segmentCountMax}`);
    }

    // Journey type filter (on call_journey CTE data)
    if (filters.journeyTypes && filters.journeyTypes.length > 0) {
        const validTypes = ['direct', 'queue', 'voicemail'];
        const safeTypes = filters.journeyTypes.filter(t => validTypes.includes(t));
        if (safeTypes.length > 0) {
            const matchMode = filters.journeyMatchMode || 'or';
            const typesConditions = safeTypes.map(t => `cj.journey::jsonb @> '[{"type":"${t}"}]'::jsonb`);
            if (matchMode === 'and') {
                // AND mode: all selected types must be present in the journey
                aggregatedWhereConditions.push(`(${typesConditions.join(' AND ')})`);
            } else {
                // OR mode (default): at least one selected type matches
                aggregatedWhereConditions.push(`(${typesConditions.join(' OR ')})`);
            }
        }
    }

    // Queue-specific journey filter (exact match with statistics logic)
    // Used for clickable KPI cards to filter by queue outcome
    if (filters.journeyQueueNumber && filters.journeyQueueResult) {
        const queueNum = filters.journeyQueueNumber.replace(/'/g, "''"); // SQL escape
        const result = filters.journeyQueueResult;

        // Step 1: Filter by queue number and result
        aggregatedWhereConditions.push(
            `cj.journey::jsonb @> '[{"type":"queue", "label":"${queueNum}", "result":"${result}"}]'::jsonb`
        );

        // Step 2: If hasMultipleQueues is specified, filter by queue count
        // CRITICAL: Match statistics logic exactly - count only queues that appear AFTER this queue
        // Statistics use: other_q.cdr_started_at > uqc.cdr_started_at
        // Journey is chronologically ordered, so we use array index to determine "after"
        if (filters.hasMultipleQueues !== undefined) {
            if (filters.hasMultipleQueues === true) {
                // Redirigés (overflow): OTHER queues exist AFTER this queue in the journey
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
                    ) > 0
                `);
            } else {
                // Abandonnés: NO other queues exist AFTER this queue in the journey
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
                    ) = 0
                `);
            }
        }
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
                ORDER BY call_history_id, cdr_ended_at DESC
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
                ORDER BY p.originating_cdr_id, p.cdr_answered_at ASC
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
                            'agent', j.agent_name
                        ) ORDER BY j.step_order
                    ) as journey
                FROM (
                    SELECT
                        c.call_history_id,
                        c.cdr_started_at as step_order,
                        CASE 
                            WHEN c.destination_entity_type = 'voicemail' THEN 'voicemail'
                            WHEN c.destination_dn_type = 'queue' THEN 'queue'
                            ELSE 'direct'
                        END as step_type,
                        CASE 
                            WHEN c.destination_entity_type = 'voicemail' THEN c.destination_dn_number
                            WHEN c.destination_dn_type = 'queue' THEN c.destination_dn_number
                            ELSE c.destination_dn_number
                        END as step_label,
                        CASE 
                            WHEN c.destination_entity_type = 'voicemail' THEN 'Messagerie ' || COALESCE(c.destination_dn_name, c.destination_dn_number)
                            WHEN c.destination_dn_type = 'queue' THEN COALESCE(c.destination_dn_name, c.destination_dn_number)
                            ELSE COALESCE(c.destination_dn_name, c.destination_dn_number)
                        END as step_detail,
                        COALESCE(qo.agent_name, qo.agent_number) as agent_name,
                        CASE 
                            WHEN c.destination_entity_type = 'voicemail' THEN 'voicemail'
                            WHEN c.destination_dn_type = 'queue' THEN
                                CASE 
                                    WHEN qo.originating_cdr_id IS NOT NULL THEN 'answered'
                                    ELSE 'not_answered'
                                END
                            ELSE
                                CASE
                                    WHEN c.cdr_answered_at IS NOT NULL THEN 'answered'
                                    WHEN c.termination_reason_details = 'busy' THEN 'busy'
                                    ELSE 'not_answered'
                                END
                        END as step_result
                    FROM cdroutput c
                    LEFT JOIN queue_outcome qo ON c.cdr_id = qo.originating_cdr_id
                    WHERE ${dateOnlyWhereClause}
                      AND c.call_history_id IN (SELECT call_history_id FROM call_aggregates)
                      AND (
                          c.destination_entity_type = 'voicemail'
                          OR c.destination_dn_type = 'queue'
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
                ) j
                GROUP BY j.call_history_id
            )${calleeFilterCTE}
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
                cj.journey as call_journey
            FROM call_aggregates ca
            JOIN first_segments fs ON ca.call_history_id = fs.call_history_id
            JOIN last_segments ls ON ca.call_history_id = ls.call_history_id
            LEFT JOIN answered_segments ans ON ca.call_history_id = ans.call_history_id
            LEFT JOIN handled_by hb ON ca.call_history_id = hb.call_history_id
            LEFT JOIN call_queues cq ON ca.call_history_id = cq.call_history_id
            LEFT JOIN call_journey cj ON ca.call_history_id = cj.call_history_id
            ${calleeFilterJoin}
            ${aggregatedWhereConditions.length > 0 ? 'WHERE ' + aggregatedWhereConditions.join(' AND ') : ''}
            ORDER BY ca.first_started_at DESC
            LIMIT ${limit} OFFSET ${skip}
        `;

        // Count query - optimize by only including expensive CTEs when filtering on them
        const needsHandledBy = !!filters.handledBySearch?.trim();
        const needsCallQueues = !!filters.queueSearch?.trim();
        const needsCallJourney = !!((filters.journeyTypes && filters.journeyTypes.length > 0) || filters.journeyQueueNumber);

        // Build conditional CTEs for count query
        const handledByCTEForCount = needsHandledBy ? `,
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

        const callQueuesCTEForCount = needsCallQueues ? `,
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

        // Build conditional JOINs for count query
        const handledByJoinForCount = needsHandledBy
            ? 'LEFT JOIN handled_by hb ON ca.call_history_id = hb.call_history_id'
            : '';
        const callQueuesJoinForCount = needsCallQueues
            ? 'LEFT JOIN call_queues cq ON ca.call_history_id = cq.call_history_id'
            : '';

        // Build conditional call_journey CTE and JOIN for count query
        const callJourneyCTEForCount = needsCallJourney ? `,
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
                ORDER BY p.originating_cdr_id, p.cdr_answered_at ASC
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
                            'agent', j.agent_name
                        ) ORDER BY j.step_order
                    ) as journey
                FROM (
                    SELECT
                        c.call_history_id,
                        c.cdr_started_at as step_order,
                        CASE 
                            WHEN c.destination_entity_type = 'voicemail' THEN 'voicemail'
                            WHEN c.destination_dn_type = 'queue' THEN 'queue'
                            ELSE 'direct'
                        END as step_type,
                        c.destination_dn_number as step_label,
                        COALESCE(c.destination_dn_name, c.destination_dn_number) as step_detail,
                        COALESCE(qo.agent_name, qo.agent_number) as agent_name,
                        CASE 
                            WHEN c.destination_entity_type = 'voicemail' THEN 'voicemail'
                            WHEN c.destination_dn_type = 'queue' THEN
                                CASE 
                                    WHEN qo.originating_cdr_id IS NOT NULL THEN 'answered'
                                    ELSE 'not_answered'
                                END
                            ELSE
                                CASE
                                    WHEN c.cdr_answered_at IS NOT NULL THEN 'answered'
                                    WHEN c.termination_reason_details = 'busy' THEN 'busy'
                                    ELSE 'not_answered'
                                END
                        END as step_result
                    FROM cdroutput c
                    LEFT JOIN queue_outcome qo ON c.cdr_id = qo.originating_cdr_id
                    WHERE ${dateOnlyWhereClause}
                      AND c.call_history_id IN (SELECT call_history_id FROM call_aggregates)
                      AND (
                          c.destination_entity_type = 'voicemail'
                          OR c.destination_dn_type = 'queue'
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
                ) j
                GROUP BY j.call_history_id
            )` : '';
        const callJourneyJoinForCount = needsCallJourney
            ? 'LEFT JOIN call_journey cj ON ca.call_history_id = cj.call_history_id'
            : '';

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
                ORDER BY call_history_id, cdr_ended_at DESC
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
            )${handledByCTEForCount}${callQueuesCTEForCount}${callJourneyCTEForCount}${calleeFilterCTE}
            SELECT COUNT(*) as total
            FROM call_aggregates ca
            JOIN first_segments fs ON ca.call_history_id = fs.call_history_id
            JOIN last_segments ls ON ca.call_history_id = ls.call_history_id
            LEFT JOIN answered_segments ans ON ca.call_history_id = ans.call_history_id
            ${handledByJoinForCount}
            ${callQueuesJoinForCount}
            ${callJourneyJoinForCount}
            ${calleeFilterJoin}
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

            // Determine final status using the SAME LOGIC as determineSegmentCategory
            // This ensures consistency between aggregated table and modal
            let finalStatus: CallStatus;
            const termReason = row.termination_reason?.toLowerCase() || "";
            const termDetails = row.termination_reason_details?.toLowerCase() || "";
            const lastDestType = row.last_dest_type?.toLowerCase() || "";
            const lastDestEntityType = row.last_dest_entity_type?.toLowerCase() || "";
            const sourceType = row.source_dn_type?.toLowerCase() || "";

            // Check if the LAST segment was answered (any destination type, not just extensions)
            const lastSegmentAnswered = row.last_answered_at !== null;

            // Calculate duration of last segment
            const lastStarted = row.last_started_at ? new Date(row.last_started_at) : null;
            const lastDurationSeconds = lastStarted && lastEnded
                ? (lastEnded.getTime() - lastStarted.getTime()) / 1000
                : 0;

            // Apply the SAME logic as determineSegmentCategory:

            // 1. Voicemail check first
            const isVoicemail = lastDestType === 'vmail_console' ||
                lastDestType === 'voicemail' ||
                lastDestEntityType === 'voicemail';

            if (isVoicemail) {
                finalStatus = "voicemail";
            }
            // 2. Busy check - recipient was busy
            else if (termDetails.includes('busy')) {
                finalStatus = "busy";
            }
            // 3. Answered - last segment was answered with real conversation
            else if (lastSegmentAnswered && lastDurationSeconds > 1) {
                // Fix: specific check for system types (Queue, Ring Group, IVR)
                // These segments often have an 'answered_at' time (system pick up) but should act as Abandoned
                // unless a real human/extension answered later.
                const isSystemType = ['queue', 'ring_group', 'ring_group_ring_all', 'ivr', 'process', 'parking'].includes(lastDestType) ||
                    ['queue', 'ivr'].includes(lastDestEntityType);

                if (isSystemType) {
                    // It's a system segment. Only consider Answered if we have a record of a human answer (from answered_segments CTE)
                    // answered_segments CTE filters for destination_dn_type = 'extension'
                    if (row.answered_at) {
                        finalStatus = "answered";
                    } else {
                        finalStatus = "abandoned";
                    }
                } else {
                    // Standard logic for other types (Extension, External, etc.)
                    finalStatus = "answered";
                }
            }
            // 4. Not answered = abandoned (regardless of direction)
            else {
                finalStatus = "abandoned";
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
                totalDurationSeconds: lastSegmentAnswered ? totalTalkSeconds : totalDurationSeconds,
                totalDurationFormatted: formatDuration(lastSegmentAnswered ? totalTalkSeconds : totalDurationSeconds),
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
                // For inbound calls: if destination name is empty, use SDA name from source_participant_name
                calleeNumber: getDisplayNumber(row.first_dest_number, row.first_dest_participant_phone),
                calleeName: row.source_dn_type?.toLowerCase() === 'provider'
                    ? (getDisplayName(row.first_dest_participant_name, row.first_dest_dn_name)
                        || (row.source_participant_name?.trim().endsWith(':') ? getDisplayName(row.source_participant_name, null) : null))
                    : (getDisplayName(row.first_dest_participant_name, row.first_dest_dn_name) || null),

                // Handled by data
                handledBy: handledByAgents,
                handledByDisplay,
                totalTalkDurationSeconds: totalTalkSeconds,
                totalTalkDurationFormatted: formatDuration(totalTalkSeconds),

                direction,
                finalStatus,
                wasTransferred,

                // Queues data - parse from JSON
                queues: (() => {
                    if (!row.call_queues) return [];
                    try {
                        const parsed = typeof row.call_queues === 'string'
                            ? JSON.parse(row.call_queues)
                            : row.call_queues;
                        return Array.isArray(parsed) ? parsed : [];
                    } catch {
                        return [];
                    }
                })(),
                queuesDisplay: (() => {
                    if (!row.call_queues) return "-";
                    try {
                        const parsed = typeof row.call_queues === 'string'
                            ? JSON.parse(row.call_queues)
                            : row.call_queues;
                        if (!Array.isArray(parsed) || parsed.length === 0) return "-";
                        const queueNames = parsed.map((q: { number: string; name: string }) => q.name || q.number);
                        return queueNames.join(", ");
                    } catch {
                        return "-";
                    }
                })(),

                // Journey steps for "Parcours" column
                journey: (() => {
                    if (!row.call_journey) return [];
                    try {
                        const parsed = typeof row.call_journey === 'string'
                            ? JSON.parse(row.call_journey)
                            : row.call_journey;
                        return Array.isArray(parsed) ? parsed : [];
                    } catch {
                        return [];
                    }
                })(),
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
                seg.destination_entity_type,
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
                status: determineStatus(
                    seg.cdr_answered_at,
                    seg.cdr_started_at,
                    seg.cdr_ended_at,
                    seg.destination_dn_type,
                    seg.destination_entity_type,
                    seg.termination_reason_details
                ),
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


