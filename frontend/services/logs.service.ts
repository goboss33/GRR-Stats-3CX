"use server";

import { prisma } from "@/lib/prisma";
import {
    CallLog,
    CallDirection,
    LogsFilters,
    LogsPagination,
    CallLogsResponse,
} from "@/types/logs.types";

/**
 * Build Prisma where clause based on direction filters
 */
function buildDirectionFilter(directions: CallDirection[]) {
    if (!directions || directions.length === 0 || directions.length === 3) {
        return {};
    }

    const conditions: object[] = [];

    if (directions.includes("internal")) {
        conditions.push({
            source_dn_type: "Extension",
            destination_dn_type: "Extension",
        });
    }

    if (directions.includes("outbound")) {
        conditions.push({
            source_dn_type: "Extension",
            NOT: { destination_dn_type: "Extension" },
        });
    }

    if (directions.includes("inbound")) {
        conditions.push({
            NOT: { source_dn_type: "Extension" },
        });
    }

    return conditions.length === 1 ? conditions[0] : { OR: conditions };
}

/**
 * Determine call direction
 */
function determineDirection(
    sourceType: string | null,
    destType: string | null
): CallDirection {
    const srcIsExt = sourceType === "Extension";
    const destIsExt = destType === "Extension";

    if (srcIsExt && destIsExt) return "internal";
    if (srcIsExt && !destIsExt) return "outbound";
    return "inbound";
}

/**
 * Format duration
 */
function formatDuration(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

/**
 * Helper to pick the best display number for caller/callee
 * Priority: participant_phone_number (real caller ID) > presentation > dn_number
 */
function getDisplayNumber(
    dnNumber: string | null,
    participantNumber: string | null,
    presentation: string | null = null
): string {
    // 1. source_participant_phone_number contient le VRAI Caller ID (ex: +41798728245)
    if (participantNumber && participantNumber.trim() !== "") {
        return participantNumber;
    }
    // 2. source_presentation (fallback, parfois contient le nom du trunk)
    if (presentation && presentation.trim() !== "") {
        return presentation;
    }
    // 3. Fallback sur le DN (extension interne ou trunk ID)
    return dnNumber || "-";
}

/**
 * Get paginated call logs with filters
 */
export async function getCallLogs(
    startDate: Date,
    endDate: Date,
    filters: LogsFilters,
    pagination: LogsPagination
): Promise<CallLogsResponse> {

    // 1. Sécuriser la pagination
    const pageNumber = Math.max(1, Number(pagination.page) || 1);
    const limit = Math.max(1, Math.min(100, Number(pagination.pageSize) || 50));
    const skip = (pageNumber - 1) * limit;

    // 2. Construire la requête
    const baseWhere: Record<string, unknown> = {
        cdr_started_at: {
            gte: startDate,
            lte: endDate,
        },
    };

    if (filters.directions) {
        const directionFilter = buildDirectionFilter(filters.directions);
        Object.assign(baseWhere, directionFilter);
    }

    if (filters.extension && filters.extension.trim() !== "") {
        const ext = filters.extension.trim();
        baseWhere.OR = [
            { source_dn_number: { contains: ext, mode: 'insensitive' } },
            { destination_dn_number: { contains: ext, mode: 'insensitive' } },
            // On cherche aussi dans les numéros participants
            { source_participant_phone_number: { contains: ext, mode: 'insensitive' } },
            { destination_participant_phone_number: { contains: ext, mode: 'insensitive' } },
        ];
    }

    try {
        const [totalCount, calls] = await Promise.all([
            prisma.cdroutput.count({ where: baseWhere }),
            prisma.cdroutput.findMany({
                where: baseWhere,
                orderBy: {
                    cdr_started_at: "desc",
                },
                skip: skip,
                take: limit,
                select: {
                    cdr_id: true,
                    call_history_id: true,
                    cdr_started_at: true,
                    cdr_answered_at: true,
                    cdr_ended_at: true,
                    // Source (appelant)
                    source_dn_number: true,
                    source_participant_phone_number: true,
                    source_presentation: true, // <-- Vrai Caller ID pour appels entrants
                    source_dn_type: true,
                    // Destination (appelé)
                    destination_dn_number: true,
                    destination_participant_phone_number: true,
                    destination_dn_type: true,

                    termination_reason: true,
                },
            }),
        ]);

        const logs: CallLog[] = calls.map((call) => {
            let durationSeconds = 0;
            if (call.cdr_answered_at && call.cdr_ended_at) {
                durationSeconds = Math.round(
                    (new Date(call.cdr_ended_at).getTime() -
                        new Date(call.cdr_answered_at).getTime()) /
                    1000
                );
            }

            const callHistoryId = call.call_history_id
                ? call.call_history_id.slice(-4).toUpperCase()
                : "-";

            return {
                id: call.cdr_id,
                callHistoryId,
                startedAt: call.cdr_started_at
                    ? new Date(call.cdr_started_at).toISOString()
                    : "",
                // source_presentation contient le vrai Caller ID pour les appels entrants
                sourceNumber: getDisplayNumber(
                    call.source_dn_number,
                    call.source_participant_phone_number,
                    call.source_presentation // <- Priorité au Caller ID
                ),
                sourceType: call.source_dn_type || "-",

                destinationNumber: getDisplayNumber(
                    call.destination_dn_number,
                    call.destination_participant_phone_number
                ),
                destinationType: call.destination_dn_type || "-",

                direction: determineDirection(
                    call.source_dn_type,
                    call.destination_dn_type
                ),
                status: call.cdr_answered_at ? "answered" : "missed",
                durationSeconds,
                durationFormatted: formatDuration(durationSeconds),
                terminationReason: call.termination_reason || "-",
            };
        });

        const totalPages = Math.ceil(totalCount / limit);

        return {
            logs,
            totalCount,
            totalPages,
            currentPage: pageNumber,
        };

    } catch (error) {
        console.error("❌ Error fetching call logs:", error);
        return {
            logs: [],
            totalCount: 0,
            totalPages: 0,
            currentPage: 1
        };
    }
}