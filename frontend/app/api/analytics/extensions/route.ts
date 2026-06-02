import { NextRequest, NextResponse } from "next/server";
import { validateApiKey } from "../auth";
import { ServerId } from "@/lib/prisma-cdr";
import { getDefaultServer, isValidServer } from "@/lib/servers";
import { getExtensionAggregatedStats } from "@/services/logs.service";
import { formatDuration } from "@/services/domain/call-aggregation";
import type { LogsFilters } from "@/services/domain/call.types";

function parseDateParam(param: string | null, defaultDate: Date): Date {
    if (!param) return defaultDate;
    const parsed = new Date(param);
    return isNaN(parsed.getTime()) ? defaultDate : parsed;
}

/**
 * GET /api/analytics/extensions
 *
 * Returns aggregated statistics for one or more extensions.
 *
 * Query params:
 * - server: tenant ID (optional, defaults to primary server)
 * - extensions: comma-separated list of extensions/numbers (required)
 * - start: ISO date string (optional, defaults to 30 days ago)
 * - end: ISO date string (optional, defaults to now)
 *
 * Example:
 * GET /api/analytics/extensions?extensions=101,102,103&start=2024-01-01&end=2024-01-31
 */
export async function GET(request: NextRequest) {
    const authResult = await validateApiKey(request);
    if (!authResult.valid) return authResult.response;

    try {
        const url = new URL(request.url);

        const serverParam = url.searchParams.get("server");
        const serverId: ServerId = serverParam && isValidServer(serverParam)
            ? serverParam as ServerId
            : getDefaultServer();

        const extensionsParam = url.searchParams.get("extensions");
        if (!extensionsParam) {
            return NextResponse.json(
                { error: "extensions parameter is required (comma-separated list)" },
                { status: 400 }
            );
        }

        const extensions = extensionsParam.split(",").map(e => e.trim()).filter(e => e.length > 0);
        if (extensions.length === 0) {
            return NextResponse.json(
                { error: "extensions parameter must contain at least one extension" },
                { status: 400 }
            );
        }

        const start = parseDateParam(url.searchParams.get("start"), new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));
        const end = parseDateParam(url.searchParams.get("end"), new Date());

        const results = await Promise.all(
            extensions.map(async (extension) => {
                const [inbound, outbound] = await Promise.all([
                    getExtensionAggregatedStats(serverId, start, end, {
                        calleeSearch: extension,
                    } as LogsFilters),
                    getExtensionAggregatedStats(serverId, start, end, {
                        callerSearch: extension,
                    } as LogsFilters),
                ]);

                const totalCalls = inbound.totalCount + outbound.totalCount;
                const totalDurationSeconds = inbound.totalDurationSeconds + outbound.totalDurationSeconds;
                const avgDurationSeconds = totalCalls > 0
                    ? Math.round(totalDurationSeconds / totalCalls)
                    : 0;
                const maxDurationSeconds = Math.max(inbound.maxDurationSeconds, outbound.maxDurationSeconds);

                return {
                    extension,
                    totalCalls,
                    inbound: {
                        total: inbound.totalCount,
                        answered: inbound.answeredCount,
                        missed: inbound.missedCount,
                        voicemail: inbound.voicemailCount,
                        busy: inbound.busyCount,
                        answerRate: inbound.totalCount > 0
                            ? Math.round((inbound.answeredCount / inbound.totalCount) * 100)
                            : 0,
                    },
                    outbound: {
                        total: outbound.totalCount,
                        successful: outbound.answeredCount,
                        failed: outbound.totalCount - outbound.answeredCount,
                    },
                    duration: {
                        totalSeconds: totalDurationSeconds,
                        averageSeconds: avgDurationSeconds,
                        maxSeconds: maxDurationSeconds,
                        totalFormatted: formatDuration(totalDurationSeconds),
                        averageFormatted: formatDuration(avgDurationSeconds),
                        maxFormatted: formatDuration(maxDurationSeconds),
                    },
                };
            })
        );

        const totals = {
            totalCalls: results.reduce((sum, r) => sum + r.totalCalls, 0),
            totalInbound: results.reduce((sum, r) => sum + r.inbound.total, 0),
            totalOutbound: results.reduce((sum, r) => sum + r.outbound.total, 0),
            totalAnswered: results.reduce((sum, r) => sum + r.inbound.answered, 0),
            totalMissed: results.reduce((sum, r) => sum + r.inbound.missed, 0),
            totalDurationSeconds: results.reduce((sum, r) => sum + r.duration.totalSeconds, 0),
            averageDurationSeconds: results.reduce((sum, r) => sum + r.totalCalls, 0) > 0
                ? Math.round(results.reduce((sum, r) => sum + r.duration.totalSeconds, 0) / results.reduce((sum, r) => sum + r.totalCalls, 0))
                : 0,
            overallAnswerRate: results.reduce((sum, r) => sum + r.inbound.total, 0) > 0
                ? Math.round(results.reduce((sum, r) => sum + r.inbound.answered, 0) / results.reduce((sum, r) => sum + r.inbound.total, 0) * 100)
                : 0,
        };

        return NextResponse.json({
            server: serverId,
            period: {
                start: start.toISOString(),
                end: end.toISOString(),
            },
            extensions: results,
            totals,
        });
    } catch (error) {
        console.error("Error in /api/analytics/extensions:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
