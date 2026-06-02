"use server";

import { ServerId } from "@/lib/prisma-cdr";
import { getExtensionAggregatedStats } from "@/services/logs.service";
import { formatDuration } from "@/services/domain/call-aggregation";
import type { ExtensionStats, ExtensionStatisticsResponse } from "@/types/extension-stats.types";
import type { LogsFilters } from "@/services/domain/call.types";

/**
 * Computes statistics for a list of extensions over a given period.
 *
 * For each extension, two queries are executed:
 * 1. Inbound calls: uses calleeSearch filter (matches the "Destinataire" column in logs)
 * 2. Outbound calls: uses callerSearch filter (matches the "Appelant" column in logs)
 *
 * This ensures the numbers match exactly what users see when filtering
 * the call logs page by the same extension.
 */
export async function getExtensionStatistics(
    serverId: ServerId,
    extensions: string[],
    startDate: Date,
    endDate: Date
): Promise<ExtensionStatisticsResponse> {
    const results = await Promise.all(
        extensions.map((ext) => computeSingleExtensionStats(serverId, ext, startDate, endDate))
    );

    const totals = computeTotals(results);

    return {
        extensions: results,
        period: {
            start: startDate.toISOString(),
            end: endDate.toISOString(),
        },
        totals,
    };
}

/**
 * Computes stats for a single extension by querying inbound and outbound calls separately.
 * Uses the same filter logic as the call logs page to ensure consistency.
 */
async function computeSingleExtensionStats(
    serverId: ServerId,
    extension: string,
    startDate: Date,
    endDate: Date
): Promise<ExtensionStats> {
    const [inboundStats, outboundStats] = await Promise.all([
        getExtensionAggregatedStats(serverId, startDate, endDate, {
            calleeSearch: extension,
        } as LogsFilters),
        getExtensionAggregatedStats(serverId, startDate, endDate, {
            callerSearch: extension,
        } as LogsFilters),
    ]);

    const inboundTotal = inboundStats.totalCount;
    const inboundAnswered = inboundStats.answeredCount;
    const inboundMissed = inboundStats.missedCount;
    const inboundVoicemail = inboundStats.voicemailCount;
    const inboundBusy = inboundStats.busyCount;
    const inboundAnswerRate = inboundTotal > 0
        ? Math.round((inboundAnswered / inboundTotal) * 100)
        : 0;

    const outboundTotal = outboundStats.totalCount;
    const outboundSuccessful = outboundStats.answeredCount;
    const outboundFailed = outboundTotal - outboundSuccessful;

    const totalCalls = inboundTotal + outboundTotal;
    const totalDurationSeconds = inboundStats.totalDurationSeconds + outboundStats.totalDurationSeconds;
    const avgDurationSeconds = totalCalls > 0
        ? Math.round(totalDurationSeconds / totalCalls)
        : 0;
    const maxDurationSeconds = Math.max(inboundStats.maxDurationSeconds, outboundStats.maxDurationSeconds);

    return {
        extension,
        totalCalls,
        inbound: {
            total: inboundTotal,
            answered: inboundAnswered,
            missed: inboundMissed,
            voicemail: inboundVoicemail,
            busy: inboundBusy,
            answerRate: inboundAnswerRate,
        },
        outbound: {
            total: outboundTotal,
            successful: outboundSuccessful,
            failed: outboundFailed,
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
}

/**
 * Aggregates totals across all extensions for the summary cards.
 */
function computeTotals(extensions: ExtensionStats[]): ExtensionStatisticsResponse["totals"] {
    const totalCalls = extensions.reduce((sum, e) => sum + e.totalCalls, 0);
    const totalInbound = extensions.reduce((sum, e) => sum + e.inbound.total, 0);
    const totalOutbound = extensions.reduce((sum, e) => sum + e.outbound.total, 0);
    const totalAnswered = extensions.reduce((sum, e) => sum + e.inbound.answered, 0);
    const totalMissed = extensions.reduce((sum, e) => sum + e.inbound.missed, 0);
    const totalDurationSeconds = extensions.reduce((sum, e) => sum + e.duration.totalSeconds, 0);
    const averageDurationSeconds = totalCalls > 0
        ? Math.round(totalDurationSeconds / totalCalls)
        : 0;
    const overallAnswerRate = totalInbound > 0
        ? Math.round((totalAnswered / totalInbound) * 100)
        : 0;

    return {
        totalCalls,
        totalInbound,
        totalOutbound,
        totalAnswered,
        totalMissed,
        overallAnswerRate,
        totalDurationSeconds,
        averageDurationSeconds,
    };
}
