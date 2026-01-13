"use server";

import { prisma } from "@/lib/prisma";
import {
    GlobalMetrics,
    TimelineDataPoint,
    ExtensionStats,
    RecentCall,
} from "@/types/stats.types";

/**
 * Get global metrics for the dashboard
 * Returns: Total calls, answered, missed, average duration, answer rate
 */
export async function getGlobalMetrics(
    startDate: Date,
    endDate: Date
): Promise<GlobalMetrics> {
    // Fetch all calls within the date range
    const calls = await prisma.cdroutput.findMany({
        where: {
            cdr_started_at: {
                gte: startDate,
                lte: endDate,
            },
        },
        select: {
            cdr_answered_at: true,
            cdr_started_at: true,
            cdr_ended_at: true,
        },
    });

    const totalCalls = calls.length;
    const answeredCalls = calls.filter((c) => c.cdr_answered_at !== null).length;
    const missedCalls = totalCalls - answeredCalls;

    // Calculate average duration for answered calls
    let totalDurationMs = 0;
    let answeredWithDuration = 0;

    for (const call of calls) {
        if (call.cdr_answered_at && call.cdr_ended_at) {
            const duration =
                new Date(call.cdr_ended_at).getTime() -
                new Date(call.cdr_answered_at).getTime();
            if (duration > 0) {
                totalDurationMs += duration;
                answeredWithDuration++;
            }
        }
    }

    const avgDurationSeconds =
        answeredWithDuration > 0
            ? Math.round(totalDurationMs / answeredWithDuration / 1000)
            : 0;

    const answerRate = totalCalls > 0 ? (answeredCalls / totalCalls) * 100 : 0;

    return {
        totalCalls,
        answeredCalls,
        missedCalls,
        avgDurationSeconds,
        answerRate: Math.round(answerRate * 10) / 10,
    };
}

/**
 * Get timeline data for the chart
 * Groups calls by day (or hour if the range is "today")
 */
export async function getTimelineData(
    startDate: Date,
    endDate: Date
): Promise<TimelineDataPoint[]> {
    const calls = await prisma.cdroutput.findMany({
        where: {
            cdr_started_at: {
                gte: startDate,
                lte: endDate,
            },
        },
        select: {
            cdr_started_at: true,
            cdr_answered_at: true,
        },
        orderBy: {
            cdr_started_at: "asc",
        },
    });

    // Determine if we should group by hour (same day) or by day
    const diffMs = endDate.getTime() - startDate.getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    const groupByHour = diffDays <= 1;

    const groups: Map<string, { answered: number; missed: number }> = new Map();

    for (const call of calls) {
        if (!call.cdr_started_at) continue;

        const date = new Date(call.cdr_started_at);
        let key: string;
        let label: string;

        if (groupByHour) {
            // Group by hour (format: "2024-01-15 14:00")
            key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:00`;
            label = `${String(date.getHours()).padStart(2, "0")}:00`;
        } else {
            // Group by day (format: "2024-01-15")
            key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
            label = `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}`;
        }

        if (!groups.has(key)) {
            groups.set(key, { answered: 0, missed: 0 });
        }

        const group = groups.get(key)!;
        if (call.cdr_answered_at) {
            group.answered++;
        } else {
            group.missed++;
        }
    }

    // Convert to array and sort by date
    const result: TimelineDataPoint[] = Array.from(groups.entries())
        .map(([date, data]) => ({
            date,
            label: groupByHour ? date.split(" ")[1] : date.split("-").slice(1, 3).reverse().join("/"),
            answered: data.answered,
            missed: data.missed,
        }))
        .sort((a, b) => a.date.localeCompare(b.date));

    return result;
}

/**
 * Get top extensions by call volume
 * Groups by destination_dn_number (extensions receiving calls)
 */
export async function getTopExtensions(
    startDate: Date,
    endDate: Date,
    limit: number = 10
): Promise<ExtensionStats[]> {
    const calls = await prisma.cdroutput.findMany({
        where: {
            cdr_started_at: {
                gte: startDate,
                lte: endDate,
            },
            destination_dn_number: {
                not: null,
            },
        },
        select: {
            destination_dn_number: true,
            cdr_answered_at: true,
        },
    });

    // Group by extension
    const extensionMap: Map<
        string,
        { total: number; answered: number }
    > = new Map();

    for (const call of calls) {
        const ext = call.destination_dn_number || "Unknown";

        if (!extensionMap.has(ext)) {
            extensionMap.set(ext, { total: 0, answered: 0 });
        }

        const stats = extensionMap.get(ext)!;
        stats.total++;
        if (call.cdr_answered_at) {
            stats.answered++;
        }
    }

    // Sort by total calls and take top N
    const sorted = Array.from(extensionMap.entries())
        .map(([ext, stats]) => ({
            extensionNumber: ext,
            totalCalls: stats.total,
            answeredCalls: stats.answered,
            answerRate:
                stats.total > 0
                    ? Math.round((stats.answered / stats.total) * 100 * 10) / 10
                    : 0,
        }))
        .sort((a, b) => b.totalCalls - a.totalCalls)
        .slice(0, limit);

    return sorted;
}

/**
 * Get recent calls for the live log
 * Returns the last N calls with formatted data
 */
export async function getRecentCalls(limit: number = 50): Promise<RecentCall[]> {
    const calls = await prisma.cdroutput.findMany({
        orderBy: {
            cdr_started_at: "desc",
        },
        take: limit,
        select: {
            cdr_id: true,
            cdr_started_at: true,
            cdr_answered_at: true,
            cdr_ended_at: true,
            source_dn_number: true,
            destination_dn_number: true,
        },
    });

    return calls.map((call) => {
        // Calculate duration
        let durationSeconds = 0;
        if (call.cdr_answered_at && call.cdr_ended_at) {
            durationSeconds = Math.round(
                (new Date(call.cdr_ended_at).getTime() -
                    new Date(call.cdr_answered_at).getTime()) /
                1000
            );
        }

        // Format duration as MM:SS
        const minutes = Math.floor(durationSeconds / 60);
        const seconds = durationSeconds % 60;
        const durationFormatted = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;

        // Format startedAt for local timezone display
        const startedAt = call.cdr_started_at
            ? new Date(call.cdr_started_at).toISOString()
            : "";

        return {
            id: call.cdr_id,
            startedAt,
            sourceExtension: call.source_dn_number || "-",
            destinationExtension: call.destination_dn_number || "-",
            status: call.cdr_answered_at ? ("answered" as const) : ("missed" as const),
            durationSeconds,
            durationFormatted,
        };
    });
}
