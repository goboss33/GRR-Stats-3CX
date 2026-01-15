"use server";

import { prisma } from "@/lib/prisma";
import {
    CallLog,
    CallDirection,
    CallStatus,
    EntityType,
    LogsFilters,
    LogsPagination,
    LogsSort,
    CallLogsResponse,
    CallChainSegment,
} from "@/types/logs.types";

// ============================================
// HELPER FUNCTIONS
// ============================================

function determineDirection(
    sourceType: string | null,
    destType: string | null
): CallDirection {
    // Case-insensitive comparison
    const srcIsExt = sourceType?.toLowerCase() === "extension";
    const destIsExt = destType?.toLowerCase() === "extension";
    if (srcIsExt && destIsExt) return "internal";
    if (srcIsExt && !destIsExt) return "outbound";
    return "inbound";
}

function determineStatus(
    answeredAt: Date | null,
    startedAt: Date | null,
    endedAt: Date | null
): CallStatus {
    if (answeredAt) return "answered";
    if (startedAt && endedAt) {
        const ringTime = endedAt.getTime() - startedAt.getTime();
        if (ringTime > 5000) return "abandoned";
    }
    return "missed";
}

function formatDuration(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function transformCallToLog(call: any): CallLog {
    const durationSeconds = call.cdr_answered_at && call.cdr_ended_at
        ? Math.round((new Date(call.cdr_ended_at).getTime() - new Date(call.cdr_answered_at).getTime()) / 1000)
        : 0;

    const ringDurationSeconds = call.cdr_started_at && (call.cdr_answered_at || call.cdr_ended_at)
        ? Math.round(
            ((call.cdr_answered_at || call.cdr_ended_at)!.getTime() - new Date(call.cdr_started_at).getTime()) / 1000
        )
        : 0;

    return {
        id: call.cdr_id,
        callHistoryId: call.call_history_id || "",
        callHistoryIdShort: call.call_history_id?.slice(-4).toUpperCase() || "-",
        startedAt: call.cdr_started_at?.toISOString() || "",
        sourceNumber: getDisplayNumber(
            call.source_dn_number,
            call.source_participant_phone_number,
            call.source_presentation
        ),
        sourceName: getDisplayName(call.source_participant_name, call.source_dn_name),
        sourceType: call.source_dn_type || "-",
        destinationNumber: getDisplayNumber(
            call.destination_dn_number,
            call.destination_participant_phone_number,
            null
        ),
        destinationName: getDisplayName(call.destination_participant_name, call.destination_dn_name),
        destinationType: call.destination_dn_type || "-",
        direction: determineDirection(call.source_dn_type, call.destination_dn_type),
        status: determineStatus(call.cdr_answered_at, call.cdr_started_at, call.cdr_ended_at),
        durationSeconds,
        durationFormatted: formatDuration(durationSeconds),
        ringDurationSeconds,
        trunkDid: call.source_participant_trunk_did || "-",
        terminationReason: call.termination_reason || "-",
    };
}

// Raw SQL query for duration filtering
async function getCallLogsWithDurationFilter(
    startDate: Date,
    endDate: Date,
    filters: LogsFilters,
    pageNumber: number,
    limit: number,
    skip: number,
    sort?: LogsSort
): Promise<CallLogsResponse> {
    // Build WHERE conditions
    const whereConditions: string[] = [
        `cdr_started_at >= '${startDate.toISOString()}'`,
        `cdr_started_at <= '${endDate.toISOString()}'`,
        `cdr_answered_at IS NOT NULL`,
        `cdr_ended_at IS NOT NULL`,
    ];

    // Duration filter in SQL: EXTRACT(EPOCH FROM (cdr_ended_at - cdr_answered_at))
    if (filters.durationMin !== undefined) {
        whereConditions.push(`EXTRACT(EPOCH FROM (cdr_ended_at - cdr_answered_at)) >= ${filters.durationMin}`);
    }
    if (filters.durationMax !== undefined) {
        whereConditions.push(`EXTRACT(EPOCH FROM (cdr_ended_at - cdr_answered_at)) <= ${filters.durationMax}`);
    }

    // Direction filter
    if (filters.directions && filters.directions.length > 0 && filters.directions.length < 3) {
        const dirConditions: string[] = [];
        if (filters.directions.includes("internal")) {
            dirConditions.push(`(LOWER(source_dn_type) = 'extension' AND LOWER(destination_dn_type) = 'extension')`);
        }
        if (filters.directions.includes("outbound")) {
            dirConditions.push(`(LOWER(source_dn_type) = 'extension' AND LOWER(destination_dn_type) != 'extension')`);
        }
        if (filters.directions.includes("inbound")) {
            dirConditions.push(`(LOWER(source_dn_type) != 'extension')`);
        }
        if (dirConditions.length > 0) {
            whereConditions.push(`(${dirConditions.join(" OR ")})`);
        }
    }

    // Status filter
    if (filters.statuses && filters.statuses.length > 0 && filters.statuses.length < 3) {
        if (filters.statuses.includes("answered") && !filters.statuses.includes("missed") && !filters.statuses.includes("abandoned")) {
            whereConditions.push(`cdr_answered_at IS NOT NULL`);
        } else if (!filters.statuses.includes("answered")) {
            whereConditions.push(`cdr_answered_at IS NULL`);
        }
    }

    // Caller search
    if (filters.callerSearch?.trim()) {
        const search = filters.callerSearch.trim().replace(/'/g, "''");
        whereConditions.push(`(
            source_dn_number ILIKE '%${search}%' OR
            source_participant_phone_number ILIKE '%${search}%' OR
            source_participant_name ILIKE '%${search}%' OR
            source_dn_name ILIKE '%${search}%'
        )`);
    }

    // Callee search
    if (filters.calleeSearch?.trim()) {
        const search = filters.calleeSearch.trim().replace(/'/g, "''");
        whereConditions.push(`(
            destination_dn_number ILIKE '%${search}%' OR
            destination_participant_phone_number ILIKE '%${search}%' OR
            destination_participant_name ILIKE '%${search}%' OR
            destination_dn_name ILIKE '%${search}%'
        )`);
    }

    const whereClause = whereConditions.join(" AND ");

    // Sort
    let orderClause = "cdr_started_at DESC";
    if (sort?.field) {
        const fieldMap: Record<string, string> = {
            startedAt: "cdr_started_at",
            duration: "EXTRACT(EPOCH FROM (cdr_ended_at - cdr_answered_at))",
            sourceNumber: "source_dn_number",
            destinationNumber: "destination_dn_number",
        };
        const sqlField = fieldMap[sort.field] || "cdr_started_at";
        orderClause = `${sqlField} ${sort.direction?.toUpperCase() || "DESC"}`;
    }

    try {
        // Count query
        const countResult = await prisma.$queryRawUnsafe<[{ count: bigint }]>(
            `SELECT COUNT(*) as count FROM cdroutput WHERE ${whereClause}`
        );
        const totalCount = Number(countResult[0].count);

        // Data query
        const calls = await prisma.$queryRawUnsafe<any[]>(`
            SELECT 
                cdr_id,
                call_history_id,
                cdr_started_at,
                cdr_answered_at,
                cdr_ended_at,
                source_dn_number,
                source_participant_phone_number,
                source_presentation,
                source_participant_name,
                source_dn_name,
                source_dn_type,
                source_participant_trunk_did,
                destination_dn_number,
                destination_participant_phone_number,
                destination_participant_name,
                destination_dn_name,
                destination_dn_type,
                termination_reason
            FROM cdroutput 
            WHERE ${whereClause}
            ORDER BY ${orderClause}
            LIMIT ${limit} OFFSET ${skip}
        `);

        const logs: CallLog[] = calls.map((call) => transformCallToLog(call));
        const totalPages = Math.ceil(totalCount / limit);

        return {
            logs,
            totalCount,
            totalPages: totalPages || 1,
            currentPage: pageNumber,
        };
    } catch (error) {
        console.error("❌ Error in raw SQL query:", error);
        return { logs: [], totalCount: 0, totalPages: 0, currentPage: 1 };
    }
}

// ============================================
// FILTER BUILDERS
// ============================================

function buildDirectionFilter(directions: CallDirection[] | undefined) {
    if (!directions || directions.length === 0 || directions.length === 3) {
        return {};
    }
    const conditions: object[] = [];
    // Database stores types in lowercase: 'extension', 'provider', etc.
    if (directions.includes("internal")) {
        // Internal: extension → extension
        conditions.push({
            source_dn_type: "extension",
            destination_dn_type: "extension"
        });
    }
    if (directions.includes("outbound")) {
        // Outbound: extension → NOT extension
        conditions.push({
            source_dn_type: "extension",
            NOT: { destination_dn_type: "extension" }
        });
    }
    if (directions.includes("inbound")) {
        // Inbound: NOT extension → anything
        conditions.push({
            NOT: { source_dn_type: "extension" }
        });
    }
    return conditions.length === 1 ? conditions[0] : { OR: conditions };
}

function buildEntityTypeFilter(entityTypes: EntityType[] | undefined) {
    if (!entityTypes || entityTypes.length === 0) {
        return {};
    }
    const typeMap: Record<EntityType, string[]> = {
        extension: ["Extension"],
        external: ["provider", "Provider"],
        queue: ["Queue"],
        ivr: ["script", "Script", "IVR"],
        script: ["script", "Script"],
        unknown: ["unknown"],
    };
    const dnTypes = entityTypes.flatMap((et) => typeMap[et] || []);
    if (dnTypes.length === 0) return {};
    return {
        OR: [
            { source_dn_type: { in: dnTypes } },
            { destination_dn_type: { in: dnTypes } },
        ],
    };
}

// Build status filter at DB level (answered = has answered_at)
function buildStatusFilter(statuses: CallStatus[] | undefined) {
    if (!statuses || statuses.length === 0 || statuses.length === 3) {
        return {};
    }
    const conditions: object[] = [];
    if (statuses.includes("answered")) {
        conditions.push({ cdr_answered_at: { not: null } });
    }
    if (statuses.includes("missed") || statuses.includes("abandoned")) {
        // Both missed and abandoned have no answered_at
        conditions.push({ cdr_answered_at: null });
    }
    return conditions.length === 1 ? conditions[0] : { OR: conditions };
}

// ============================================
// MAIN QUERY (OPTIMIZED)
// ============================================

export async function getCallLogs(
    startDate: Date,
    endDate: Date,
    filters: LogsFilters,
    pagination: LogsPagination,
    sort?: LogsSort
): Promise<CallLogsResponse> {
    const pageNumber = Math.max(1, Number(pagination.page) || 1);
    const limit = Math.max(1, Math.min(100, Number(pagination.pageSize) || 50));
    const skip = (pageNumber - 1) * limit;

    // Build where clause
    const conditions: object[] = [
        { cdr_started_at: { gte: startDate, lte: endDate } },
    ];

    // Direction filter
    const dirFilter = buildDirectionFilter(filters.directions);
    if (Object.keys(dirFilter).length > 0) conditions.push(dirFilter);

    // Entity type filter
    const entityFilter = buildEntityTypeFilter(filters.entityTypes);
    if (Object.keys(entityFilter).length > 0) conditions.push(entityFilter);

    // Status filter (now at DB level!)
    const statusFilter = buildStatusFilter(filters.statuses);
    if (Object.keys(statusFilter).length > 0) conditions.push(statusFilter);

    // Extension exact match (case-insensitive for dn_type)
    if (filters.extensionExact?.trim()) {
        const ext = filters.extensionExact.trim();
        conditions.push({
            OR: [
                // Source is this extension
                { source_dn_number: ext },
                // Destination is this extension
                { destination_dn_number: ext },
            ],
        });
    }

    // External number partial match
    if (filters.externalNumber?.trim()) {
        const num = filters.externalNumber.trim();
        conditions.push({
            OR: [
                { source_participant_phone_number: { contains: num, mode: "insensitive" } },
                { destination_participant_phone_number: { contains: num, mode: "insensitive" } },
            ],
        });
    }

    // Caller search (source number or name)
    if (filters.callerSearch?.trim()) {
        const search = filters.callerSearch.trim();
        conditions.push({
            OR: [
                { source_dn_number: { contains: search, mode: "insensitive" } },
                { source_participant_phone_number: { contains: search, mode: "insensitive" } },
                { source_participant_name: { contains: search, mode: "insensitive" } },
                { source_dn_name: { contains: search, mode: "insensitive" } },
            ],
        });
    }

    // Callee search (destination number or name)
    if (filters.calleeSearch?.trim()) {
        const search = filters.calleeSearch.trim();
        conditions.push({
            OR: [
                { destination_dn_number: { contains: search, mode: "insensitive" } },
                { destination_participant_phone_number: { contains: search, mode: "insensitive" } },
                { destination_participant_name: { contains: search, mode: "insensitive" } },
                { destination_dn_name: { contains: search, mode: "insensitive" } },
            ],
        });
    }

    // Duration filter - using SQL expressions for computed duration
    // Duration = (cdr_ended_at - cdr_answered_at) in seconds
    // We need answered calls for duration filter
    if (filters.durationMin !== undefined || filters.durationMax !== undefined) {
        // Must have answered_at to calculate duration
        conditions.push({ cdr_answered_at: { not: null } });
        conditions.push({ cdr_ended_at: { not: null } });
    }

    const baseWhere = conditions.length === 1 ? conditions[0] : { AND: conditions };

    // Sorting
    const orderBy: Record<string, "asc" | "desc"> = {};
    if (sort?.field) {
        const fieldMap: Record<string, string> = {
            startedAt: "cdr_started_at",
            duration: "cdr_ended_at",
            sourceNumber: "source_dn_number",
            destinationNumber: "destination_dn_number",
        };
        orderBy[fieldMap[sort.field] || "cdr_started_at"] = sort.direction || "desc";
    } else {
        orderBy.cdr_started_at = "desc";
    }

    try {
        // Check if we need raw SQL for duration filtering
        const hasDurationFilter = filters.durationMin !== undefined || filters.durationMax !== undefined;

        if (hasDurationFilter) {
            // Use raw SQL for duration filtering (computed field)
            return await getCallLogsWithDurationFilter(
                startDate, endDate, filters, pageNumber, limit, skip, sort
            );
        }

        // Standard Prisma query when no duration filter
        const [totalCount, calls] = await Promise.all([
            prisma.cdroutput.count({ where: baseWhere }),
            prisma.cdroutput.findMany({
                where: baseWhere,
                orderBy,
                skip,
                take: limit,
                select: {
                    cdr_id: true,
                    call_history_id: true,
                    cdr_started_at: true,
                    cdr_answered_at: true,
                    cdr_ended_at: true,
                    source_dn_number: true,
                    source_participant_phone_number: true,
                    source_presentation: true,
                    source_participant_name: true,
                    source_dn_name: true,
                    source_dn_type: true,
                    source_participant_trunk_did: true,
                    destination_dn_number: true,
                    destination_participant_phone_number: true,
                    destination_participant_name: true,
                    destination_dn_name: true,
                    destination_dn_type: true,
                    termination_reason: true,
                },
            }),
        ]);

        // Transform results
        const logs: CallLog[] = calls.map((call) => transformCallToLog(call));

        const totalPages = Math.ceil(totalCount / limit);

        return {
            logs,
            totalCount,
            totalPages: totalPages || 1,
            currentPage: pageNumber,
        };
    } catch (error) {
        console.error("❌ Error fetching call logs:", error);
        return { logs: [], totalCount: 0, totalPages: 0, currentPage: 1 };
    }
}

// ============================================
// CALL CHAIN (for modal)
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
                source_presentation: true,
                source_participant_name: true,
                source_dn_name: true,
                source_dn_type: true,
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
                status: determineStatus(seg.cdr_answered_at, seg.cdr_started_at, seg.cdr_ended_at),
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
// CSV EXPORT (limited to 5000 for performance)
// ============================================

export async function exportCallLogsCSV(
    startDate: Date,
    endDate: Date,
    filters: LogsFilters
): Promise<string> {
    // Limit export to 5000 records for performance
    const response = await getCallLogs(startDate, endDate, filters, { page: 1, pageSize: 5000 });

    const headers = [
        "Date/Heure",
        "Appelant",
        "Nom Appelant",
        "Appelé",
        "Nom Appelé",
        "Direction",
        "Statut",
        "Durée",
        "Trunk DID",
        "Raison",
    ];

    const rows = response.logs.map((log) => [
        log.startedAt,
        log.sourceNumber,
        log.sourceName,
        log.destinationNumber,
        log.destinationName,
        log.direction,
        log.status,
        log.durationFormatted,
        log.trunkDid,
        log.terminationReason,
    ]);

    const csvContent = [
        headers.join(";"),
        ...rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(";")),
    ].join("\n");

    return csvContent;
}