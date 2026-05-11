"use server";

import {
    getQueueName,
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

const INTERNAL_API_URL = process.env.INTERNAL_API_URL || "http://localhost:3000";
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || "";

async function fetchApi<T>(endpoint: string, params: Record<string, string>): Promise<T> {
    const url = new URL(`${INTERNAL_API_URL}${endpoint}`);
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));

    const res = await fetch(url.toString(), {
        headers: { "X-API-Key": INTERNAL_API_KEY },
    });

    if (!res.ok) {
        const errorText = await res.text().catch(() => "Unknown error");
        throw new Error(`API ${endpoint} returned ${res.status}: ${errorText}`);
    }

    return res.json() as Promise<T>;
}

interface ApiQueueResponse {
    queueNumber: string;
    queueName: string;
    callsReceived: number;
    callsAnswered: number;
    callsAbandoned: number;
    abandonedBefore10s: number;
    abandonedAfter10s: number;
    callsOverflow: number;
    totalPassages: number;
    pingPongCount: number;
    pingPongPercentage: number;
    avgWaitTimeSeconds: number;
    avgTalkTimeSeconds: number;
    directReceived: number;
    directAnswered: number;
    directLost: number;
    overflowDestinations: Array<{ destination: string; destinationName: string; count: number }>;
}

interface ApiAgentResponse {
    agents: Array<{
        extension: string;
        name: string;
        callsReceived: number;
        answered: number;
        queueTalkTimeSeconds: number;
        directReceived: number;
        directAnswered: number;
        directTalkTimeSeconds: number;
    }>;
    queueNumber: string;
}

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
    const [apiData, agentsData] = await Promise.all([
        fetchApi<ApiQueueResponse>("/api/analytics/queue", {
            queueNumber,
            start: startDate.toISOString(),
            end: endDate.toISOString(),
        }),
        fetchApi<ApiAgentResponse>("/api/analytics/agents", {
            queueNumber,
            start: startDate.toISOString(),
            end: endDate.toISOString(),
        }),
    ]);

    const teamDirectReceived = apiData.directReceived;
    const teamDirectAnswered = apiData.directAnswered;
    const teamQueueAnswered = agentsData.agents.reduce((sum, a) => sum + a.answered, 0);
    const totalAnswered = teamQueueAnswered + teamDirectAnswered;

    const overflowDestinations: OverflowDestination[] = apiData.overflowDestinations.map((d) => ({
        destination: d.destination,
        destinationName: d.destinationName,
        count: d.count,
    }));

    return {
        callsReceived: apiData.callsReceived,
        callsAnswered: teamQueueAnswered,
        callsAbandoned: apiData.callsAbandoned,
        abandonedBefore10s: apiData.abandonedBefore10s,
        abandonedAfter10s: apiData.abandonedAfter10s,
        callsToVoicemail: 0,
        callsOverflow: apiData.callsOverflow,
        totalPassages: apiData.totalPassages,
        pingPongCount: apiData.pingPongCount,
        pingPongPercentage: apiData.pingPongPercentage,
        teamDirectReceived,
        teamDirectAnswered,
        directLost: apiData.directLost,
        overflowDestinations,
        avgWaitTimeSeconds: apiData.avgWaitTimeSeconds,
        avgTalkTimeSeconds: apiData.avgTalkTimeSeconds,
    };
}

async function computeAgentStats(
    queueNumber: string,
    startDate: Date,
    endDate: Date
): Promise<AgentStats[]> {
    const apiData = await fetchApi<ApiAgentResponse>("/api/analytics/agents", {
        queueNumber,
        start: startDate.toISOString(),
        end: endDate.toISOString(),
    });

    return apiData.agents.map((agent) => {
        const totalReceived = agent.callsReceived + agent.directReceived;
        const totalAnswered = agent.answered + agent.directAnswered;

        return {
            extension: agent.extension,
            name: agent.name,
            callsReceived: agent.callsReceived,
            answered: agent.answered,
            directReceived: agent.directReceived,
            directAnswered: agent.directAnswered,
            directTalkTimeSeconds: agent.directTalkTimeSeconds,
            answerRate: totalReceived > 0 ? Math.round((totalAnswered / totalReceived) * 100) : 0,
            avgHandlingTimeSeconds: totalAnswered > 0
                ? Math.round((agent.queueTalkTimeSeconds + agent.directTalkTimeSeconds) / totalAnswered)
                : 0,
            totalHandlingTimeSeconds: agent.queueTalkTimeSeconds + agent.directTalkTimeSeconds,
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
            ? new Date(row.call_date).toISOString().split("T")[0]
            : "";
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
