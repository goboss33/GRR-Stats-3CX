"use server";

import { ServerId } from "@/lib/prisma-cdr";
import { getServerTimezone } from "@/lib/servers";
import { logger } from "@/lib/logger";
import { resolveAccessScope } from "@/lib/access-scope";
import {
    getQueueName,
    getDailyTrendRaw,
    getHourlyTrendRaw,
} from "@/services/repositories/cdr.repository";
import {
    getQueueTimelineData,
    getQueueHeatmapData,
} from "@/services/dashboard.service";
import type {
    QueueStatistics,
    QueueKPIs,
    AgentStats,
    DailyTrend,
    HourlyTrend,
    OverflowDestination,
} from "@/services/domain/call.types";
import type { PassageOutcome } from "@/services/domain/call-classification";

const INTERNAL_API_URL = process.env.INTERNAL_API_URL || "http://localhost:3000";
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || "";

async function fetchApi<T>(endpoint: string, params: Record<string, string>): Promise<T> {
    const url = new URL(`${INTERNAL_API_URL}${endpoint}`);
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));

    logger.debug("[fetchApi] Calling:", url.toString());

    const res = await fetch(url.toString(), {
        headers: { "X-API-Key": INTERNAL_API_KEY },
    });

    if (!res.ok) {
        const errorText = await res.text().catch(() => "Unknown error");
        logger.error("[fetchApi] Error:", { status: res.status, error: errorText, url: url.toString() });
        throw new Error(`API ${endpoint} returned ${res.status}: ${errorText}`);
    }

    const data = await res.json() as T;
    logger.debug("[fetchApi] Success:", { endpoint, data });
    return data;
}

interface ApiQueueResponse {
    queueNumber: string;
    queueName: string;
    callsReceived: number;
    callsAnswered: number;
    callsAbandoned: number;
    callsShortAbandon: number;
    callsToVoicemail: number;
    outcomeCounts: Record<PassageOutcome, number>;
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
    serverId: ServerId,
    queueNumber: string,
    startDate: Date,
    endDate: Date
): Promise<QueueStatistics> {
    // Une file hors périmètre doit être refusée même si son numéro est deviné :
    // masquer l'entrée du sélecteur ne suffit pas.
    const scope = await resolveAccessScope(serverId);
    if (!scope.unrestricted && (scope.empty || !scope.queueNumbers?.includes(queueNumber))) {
        throw new Error("Cette file d'attente n'est pas dans votre périmètre");
    }

    const [queueName, kpis, agents, dailyTrend, hourlyTrend, timelineData, heatmapData] = await Promise.all([
        getQueueName(serverId, queueNumber),
        computeQueueKPIs(serverId, queueNumber, startDate, endDate),
        computeAgentStats(serverId, queueNumber, startDate, endDate),
        computeDailyTrend(serverId, queueNumber, startDate, endDate),
        computeHourlyTrend(serverId, queueNumber, startDate, endDate),
        getQueueTimelineData(serverId, queueNumber, startDate, endDate),
        getQueueHeatmapData(serverId, queueNumber, startDate, endDate),
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
        timelineData,
        heatmapData,
    };
}

async function computeQueueKPIs(
    serverId: ServerId,
    queueNumber: string,
    startDate: Date,
    endDate: Date
): Promise<QueueKPIs> {
    const apiData = await fetchApi<ApiQueueResponse>("/api/analytics/queue", {
        server: serverId,
        queueNumber,
        start: startDate.toISOString(),
        end: endDate.toISOString(),
    });

    const teamDirectReceived = apiData.directReceived;
    const teamDirectAnswered = apiData.directAnswered;
    const teamQueueAnswered = apiData.callsAnswered;
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
        callsShortAbandon: apiData.callsShortAbandon,
        callsToVoicemail: apiData.callsToVoicemail,
        outcomeCounts: apiData.outcomeCounts,
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
    serverId: ServerId,
    queueNumber: string,
    startDate: Date,
    endDate: Date
): Promise<AgentStats[]> {
    const apiData = await fetchApi<ApiAgentResponse>("/api/analytics/agents", {
        server: serverId,
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
    serverId: ServerId,
    queueNumber: string,
    startDate: Date,
    endDate: Date
): Promise<DailyTrend[]> {
    const timezone = await getServerTimezone(serverId);
    const result = await getDailyTrendRaw(serverId, queueNumber, startDate, endDate, timezone);
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
    serverId: ServerId,
    queueNumber: string,
    startDate: Date,
    endDate: Date
): Promise<HourlyTrend[]> {
    const timezone = await getServerTimezone(serverId);
    const result = await getHourlyTrendRaw(serverId, queueNumber, startDate, endDate, timezone);

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
