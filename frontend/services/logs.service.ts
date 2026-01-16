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
} from "@/types/logs.types";

// ============================================
// HELPER FUNCTIONS
// ============================================

function determineDirection(
    sourceType: string | null,
    destType: string | null
): CallDirection {
    const srcIsExt = sourceType?.toLowerCase() === "extension";
    const destIsExt = destType?.toLowerCase() === "extension";
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
    if (!directions || directions.length === 0 || directions.length === 3) {
        return ''; // No filter needed
    }
    const conditions: string[] = [];
    // Direction is based on: source_dn_type (first segment) and first_dest_type
    // inbound: source is NOT extension
    // outbound: source IS extension AND destination is NOT extension
    // internal: source IS extension AND destination IS extension
    if (directions.includes('inbound')) {
        conditions.push("(fs.source_dn_type != 'extension' OR fs.source_dn_type IS NULL)");
    }
    if (directions.includes('outbound')) {
        conditions.push("(fs.source_dn_type = 'extension' AND fs.destination_dn_type != 'extension')");
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
    // Status is based on: last_answered_at and last_dest_type
    // answered: answered IS NOT NULL AND last_dest_type = 'extension'
    // routed: answered IS NOT NULL AND last_dest_type != 'extension'
    // missed: answered IS NULL (with short ring time - approximated)
    // abandoned: answered IS NULL (with longer ring time - approximated)
    if (statuses.includes('answered')) {
        conditions.push("(ls.cdr_answered_at IS NOT NULL AND ls.last_dest_type = 'extension')");
    }
    if (statuses.includes('routed')) {
        conditions.push("(ls.cdr_answered_at IS NOT NULL AND (ls.last_dest_type != 'extension' OR ls.last_dest_type IS NULL))");
    }
    if (statuses.includes('missed')) {
        // Missed = not answered, short ring time (< 5 seconds)
        conditions.push("(ls.cdr_answered_at IS NULL AND EXTRACT(EPOCH FROM (ls.last_ended_at - ls.last_started_at)) <= 5)");
    }
    if (statuses.includes('abandoned')) {
        // Abandoned = not answered, longer ring time (> 5 seconds)
        conditions.push("(ls.cdr_answered_at IS NULL AND EXTRACT(EPOCH FROM (ls.last_ended_at - ls.last_started_at)) > 5)");
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

    const whereClause = whereConditions.join(" AND ");

    // Build aggregated-level filters (applied after CTEs join)
    const aggregatedWhereConditions: string[] = [];
    const directionFilter = buildSqlDirectionFilter(filters.directions);
    if (directionFilter) aggregatedWhereConditions.push(directionFilter);
    const statusFilter = buildSqlStatusFilter(filters.statuses);
    if (statusFilter) aggregatedWhereConditions.push(statusFilter);

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
                SELECT DISTINCT ON (call_history_id)
                    call_history_id,
                    source_dn_number,
                    source_participant_phone_number,
                    source_participant_name,
                    source_dn_name,
                    source_dn_type,
                    source_presentation,
                    destination_dn_number as first_dest_number,
                    destination_dn_type
                FROM cdroutput
                WHERE ${whereClause}
                ORDER BY call_history_id, cdr_started_at ASC
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
                fs.destination_dn_type as first_dest_type,
                ls.destination_dn_number,
                ls.destination_participant_phone_number,
                ls.destination_participant_name,
                ls.destination_dn_name,
                ls.last_dest_type,
                ls.cdr_answered_at as last_answered_at,
                ls.last_started_at,
                ls.last_ended_at,
                ls.termination_reason
            FROM call_aggregates ca
            JOIN first_segments fs ON ca.call_history_id = fs.call_history_id
            JOIN last_segments ls ON ca.call_history_id = ls.call_history_id
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
            )
            SELECT COUNT(*) as total
            FROM call_aggregates ca
            JOIN first_segments fs ON ca.call_history_id = fs.call_history_id
            JOIN last_segments ls ON ca.call_history_id = ls.call_history_id
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
            const lastAnswered = row.last_answered_at ? new Date(row.last_answered_at) : null;

            // Total duration = from first start to last end
            const totalDurationSeconds = firstStarted && lastEnded
                ? Math.round((lastEnded.getTime() - firstStarted.getTime()) / 1000)
                : 0;

            // Wait time = time until first answered segment (or total if never answered)
            const waitTimeSeconds = firstStarted && firstAnswered
                ? Math.round((firstAnswered.getTime() - firstStarted.getTime()) / 1000)
                : (firstStarted && lastEnded ? Math.round((lastEnded.getTime() - firstStarted.getTime()) / 1000) : 0);

            // Determine final status from last segment
            const finalStatus = determineStatus(lastAnswered, row.last_started_at ? new Date(row.last_started_at) : null, lastEnded, row.last_dest_type);

            // Determine direction from first segment
            const direction = determineDirection(row.source_dn_type, row.first_dest_type);

            // Was transferred if more than 1 segment
            const wasTransferred = Number(row.segment_count) > 1;

            return {
                callHistoryId: row.call_history_id,
                callHistoryIdShort: row.call_history_id?.slice(-4).toUpperCase() || "-",
                segmentCount: Number(row.segment_count),

                startedAt: row.first_started_at?.toISOString() || "",
                endedAt: row.last_ended_at?.toISOString() || "",
                totalDurationSeconds,
                totalDurationFormatted: formatDuration(totalDurationSeconds),
                waitTimeSeconds,
                waitTimeFormatted: formatDuration(waitTimeSeconds),

                callerNumber: getDisplayNumber(row.source_dn_number, row.source_participant_phone_number, row.source_presentation),
                callerName: getDisplayName(row.source_participant_name, row.source_dn_name) || null,

                calleeNumber: getDisplayNumber(row.destination_dn_number, row.destination_participant_phone_number, null),
                calleeName: getDisplayName(row.destination_participant_name, row.destination_dn_name) || null,

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
            },
        });

        return segments.map((seg) => {
            const durationSeconds = seg.cdr_answered_at && seg.cdr_ended_at
                ? Math.round((new Date(seg.cdr_ended_at).getTime() - new Date(seg.cdr_answered_at).getTime()) / 1000)
                : 0;

            return {
                id: seg.cdr_id,
                startedAt: seg.cdr_started_at?.toISOString() || "",
                sourceNumber: getDisplayNumber(seg.source_dn_number, seg.source_participant_phone_number, seg.source_presentation),
                sourceName: getDisplayName(seg.source_participant_name, seg.source_dn_name),
                sourceType: seg.source_dn_type || "-",
                destinationNumber: getDisplayNumber(seg.destination_dn_number, seg.destination_participant_phone_number, null),
                destinationName: getDisplayName(seg.destination_participant_name, seg.destination_dn_name),
                destinationType: seg.destination_dn_type || "-",
                status: determineStatus(seg.cdr_answered_at, seg.cdr_started_at, seg.cdr_ended_at, seg.destination_dn_type),
                durationFormatted: formatDuration(durationSeconds),
                terminationReason: seg.termination_reason || "-",
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