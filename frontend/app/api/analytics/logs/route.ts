import { NextRequest, NextResponse } from "next/server";
import { validateApiKey } from "../auth";
import { getPrismaCdr, ServerId } from "@/lib/prisma-cdr";
import { getDefaultServer, isValidServer } from "@/lib/servers";
import {
    buildAnalyticsCTEs,
    ANALYTICS_DATA_SELECT,
    buildAnalyticsDataJoins,
    buildAnalyticsCountQuery,
    buildAnalyticsOrderByClause,
} from "@/services/analytics/query-builder";
import {
    determineCallStatus,
    determineCallDirection,
    formatDuration,
    getDisplayNumber,
    getDisplayName,
} from "@/services/domain/call-aggregation";
import type { CallDirection, CallStatus, LogsSort } from "@/services/domain/call.types";

function parseDateParam(param: string | null, defaultDate: Date): Date {
    if (!param) return defaultDate;
    const parsed = new Date(param);
    return isNaN(parsed.getTime()) ? defaultDate : parsed;
}

function parseSortParam(sortField?: string, sortDir?: string): LogsSort | undefined {
    if (!sortField) return undefined;
    const validFields = ["startedAt", "timeOfDay", "duration", "sourceNumber", "destinationNumber"];
    if (!validFields.includes(sortField)) return undefined;
    return {
        field: sortField as LogsSort["field"],
        direction: sortDir === "asc" ? "asc" : "desc",
    };
}

export async function GET(request: NextRequest) {
    const authResult = await validateApiKey(request);
    if (!authResult.valid) return authResult.response;

    try {
        const url = new URL(request.url);
        const serverParam = url.searchParams.get("server");
        const serverId: ServerId = serverParam && isValidServer(serverParam) 
            ? serverParam as ServerId 
            : getDefaultServer();
        
        const prisma = getPrismaCdr(serverId);
        
        const start = parseDateParam(url.searchParams.get("start"), new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));
        const end = parseDateParam(url.searchParams.get("end"), new Date());
        const queueNumber = url.searchParams.get("queueNumber") || undefined;
        const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
        const pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get("pageSize") || "20", 10)));
        const sort = parseSortParam(url.searchParams.get("sort") || undefined, url.searchParams.get("dir") || undefined);

        const skip = (page - 1) * pageSize;

        const ctes = buildAnalyticsCTEs(start, end, queueNumber);
        const orderBy = buildAnalyticsOrderByClause(sort);
        const countQuery = buildAnalyticsCountQuery(start, end, queueNumber, []);

        const dataQuery = ctes + ANALYTICS_DATA_SELECT + buildAnalyticsDataJoins([], orderBy, pageSize, skip);

        const [rawResults, countResult] = await Promise.all([
            prisma.$queryRawUnsafe(dataQuery),
            prisma.$queryRawUnsafe(countQuery),
        ]);

        const totalCount = Number((countResult as any)[0]?.total || 0);
        const totalPages = Math.ceil(totalCount / pageSize);

        const logs = (rawResults as any[]).map((row) => {
            const firstStarted = row.first_started_at ? new Date(row.first_started_at) : null;
            const lastEnded = row.last_ended_at ? new Date(row.last_ended_at) : null;
            const answeredByHuman = row.answered_at ? new Date(row.answered_at) : null;
            const firstAnswered = row.first_answered_at ? new Date(row.first_answered_at) : null;

            let parsedHandledByAgents: Array<{ number: string; name: string }> = [];
            if (row.handled_by_agents) {
                try {
                    parsedHandledByAgents = typeof row.handled_by_agents === 'string'
                        ? JSON.parse(row.handled_by_agents)
                        : row.handled_by_agents;
                } catch { parsedHandledByAgents = []; }
            }

            const totalDurationSeconds = firstStarted && lastEnded
                ? Math.round((lastEnded.getTime() - firstStarted.getTime()) / 1000)
                : 0;
            const waitTimeSeconds = firstStarted && (answeredByHuman || firstAnswered)
                ? Math.round(((answeredByHuman || firstAnswered)!.getTime() - firstStarted.getTime()) / 1000)
                : (firstStarted && lastEnded ? Math.round((lastEnded.getTime() - firstStarted.getTime()) / 1000) : 0);

            const totalTalkSeconds = Math.round(Number(row.handled_by_total_talk || 0));
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

            let handledByDisplay = "-";
            if (parsedHandledByAgents.length > 0) {
                const displayAgents = parsedHandledByAgents.slice(0, 5);
                handledByDisplay = displayAgents.map(a => a.name || a.number).join(", ");
                if (parsedHandledByAgents.length > 5) {
                    handledByDisplay += ` (+${parsedHandledByAgents.length - 5})`;
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
                journey,
            };
        });

        return NextResponse.json({
            logs,
            totalCount,
            totalPages,
            currentPage: page,
        });
    } catch (error) {
        console.error("Error in /api/analytics/logs:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
