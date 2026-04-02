"use server";

import {
    getQueueName,
    getQueueKpisRaw,
    getOverflowDestinationsRaw,
    getTeamDirectStatsRaw,
    getAgentStatsRaw,
    getDailyTrendRaw,
    getHourlyTrendRaw,
} from "@/services/repositories/cdr.repository";
import type {
    QueueStatistics,
    QueueKPIs,
    AgentStats,
    DailyTrend,
    HourlyTrend,
    OverflowDestination,
} from "@/services/domain/call.types";

/**
 * Statistics Service — Per-Queue Statistics
 * 
 * Orchestrates repository calls and formats data for the Statistics UI.
 * No SQL logic here — all queries are in cdr.repository.ts.
 */

export async function getQueueStatistics(
    queueNumber: string,
    startDate: Date,
    endDate: Date
): Promise<QueueStatistics> {
    const [queueName, kpis, agents, dailyTrend, hourlyTrend] = await Promise.all([
        getQueueName(queueNumber),
        computeQueueKPIs(queueNumber, startDate, endDate),
        computeAgentStats(queueNumber, startDate, endDate),
        computeDailyTrend(queueNumber, startDate, endDate),
        computeHourlyTrend(queueNumber, startDate, endDate),
    ]);

    return {
        queueNumber,
        queueName,
        period: {
            start: startDate.toISOString(),
            end: endDate.toISOString(),
        },
        kpis,
        agents,
        dailyTrend,
        hourlyTrend,
    };
}

async function computeQueueKPIs(
    queueNumber: string,
    startDate: Date,
    endDate: Date
): Promise<QueueKPIs> {
    const [row, overflowDests, teamDirect] = await Promise.all([
        getQueueKpisRaw(queueNumber, startDate, endDate),
        getOverflowDestinationsRaw(queueNumber, startDate, endDate),
        getTeamDirectStatsRaw(queueNumber, startDate, endDate),
    ]);

    const uniqueCallsCount = Number(row.unique_calls || 0);
    const totalPassages = Number(row.total_passages || 0);
    const pingPongCount = totalPassages - uniqueCallsCount;
    const pingPongPercentage = totalPassages > 0
        ? Math.round((pingPongCount / totalPassages) * 100)
        : 0;

    const overflowDestinations: OverflowDestination[] = overflowDests.map((d) => ({
        destination: d.destination,
        destinationName: d.destination_name || d.destination,
        count: Number(d.count),
    }));

    return {
        callsReceived: uniqueCallsCount,
        callsAnswered: Number(row.unique_answered || 0),
        callsAbandoned: Number(row.unique_abandoned || 0),
        abandonedBefore10s: Number(row.unique_abandoned_before_10s || 0),
        abandonedAfter10s: Number(row.unique_abandoned_after_10s || 0),
        callsToVoicemail: 0,
        callsOverflow: Number(row.unique_overflow || 0),
        totalPassages,
        pingPongCount,
        pingPongPercentage,
        teamDirectReceived: Number(teamDirect?.direct_received || 0),
        teamDirectAnswered: Number(teamDirect?.direct_answered || 0),
        overflowDestinations,
        avgWaitTimeSeconds: Math.round(Number(row.avg_wait_time || 0)),
        avgTalkTimeSeconds: Math.round(Number(row.avg_talk_time || 0)),
    };
}

async function computeAgentStats(
    queueNumber: string,
    startDate: Date,
    endDate: Date
): Promise<AgentStats[]> {
    const result = await getAgentStatsRaw(queueNumber, startDate, endDate);

    return result.map((row) => {
        const callsReceived = Number(row.calls_received || 0);
        const answered = Number(row.resolved || 0);
        const directReceived = Number(row.direct_received || 0);
        const directAnswered = Number(row.direct_answered || 0);
        const directTalkTime = Math.round(Number(row.direct_talk_time || 0));
        const queueTalkTime = Math.round(Number(row.total_handling_time || 0));

        const totalReceived = callsReceived + directReceived;
        const totalAnswered = answered + directAnswered;

        return {
            extension: row.extension,
            name: row.name || row.extension,
            callsReceived,
            answered,
            directReceived,
            directAnswered,
            directTalkTimeSeconds: directTalkTime,
            answerRate: totalReceived > 0 ? Math.round((totalAnswered / totalReceived) * 100) : 0,
            avgHandlingTimeSeconds: totalAnswered > 0 ? Math.round((queueTalkTime + directTalkTime) / totalAnswered) : 0,
            totalHandlingTimeSeconds: queueTalkTime + directTalkTime,
        };
    });
}

async function computeDailyTrend(
    queueNumber: string,
    startDate: Date,
    endDate: Date
): Promise<DailyTrend[]> {
    const result = await getDailyTrendRaw(queueNumber, startDate, endDate);
    return result.map((row) => {
        const dateStr = row.call_date
            ? new Date(row.call_date).toISOString().split('T')[0]
            : '';
        return {
            date: dateStr,
            received: Number(row.received || 0),
            answered: Number(row.answered || 0),
            abandoned: Number(row.abandoned || 0),
        };
    });
}

async function computeHourlyTrend(
    queueNumber: string,
    startDate: Date,
    endDate: Date
): Promise<HourlyTrend[]> {
    const result = await getHourlyTrendRaw(queueNumber, startDate, endDate);

    const hourlyMap = new Map<number, HourlyTrend>();
    for (let h = 0; h < 24; h++) {
        hourlyMap.set(h, { hour: h, received: 0, answered: 0, abandoned: 0 });
    }

    result.forEach((row) => {
        const hour = Number(row.call_hour);
        hourlyMap.set(hour, {
            hour,
            received: Number(row.received || 0),
            answered: Number(row.answered || 0),
            abandoned: Number(row.abandoned || 0),
        });
    });

    return Array.from(hourlyMap.values());
}
