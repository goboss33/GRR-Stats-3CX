"use server";

import { ServerId } from "@/lib/prisma-cdr";
import {
    getTimelineDataRaw,
    getHeatmapDataRaw,
    getConcurrentCallsData,
} from "@/services/repositories/cdr.repository";
import type {
    GlobalMetrics,
    TimelineDataPoint,
    HeatmapDataPoint,
    ConcurrentCallsDataPoint,
    ConcurrentCallsSummary,
} from "@/services/domain/call.types";
import { SERVERS } from "@/lib/prisma-cdr";

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

interface ApiGlobalResponse {
    totalCalls: number;
    answeredCalls: number;
    missedCalls: number;
    voicemailCalls: number;
    busyCalls: number;
    avgDurationSeconds: number;
    avgWaitTimeSeconds: number;
    avgAgentsPerCall: number;
    agentsDistribution: { agents1: number; agents2: number; agents3Plus: number };
    previousPeriod: {
        totalCalls: number;
        answeredCalls: number;
        missedCalls: number;
        voicemailCalls: number;
        busyCalls: number;
        avgDurationSeconds: number;
        avgWaitTimeSeconds: number;
        avgAgentsPerCall: number;
        agentsDistribution: { agents1: number; agents2: number; agents3Plus: number };
    } | null;
}

export async function getGlobalMetrics(
    serverId: ServerId,
    startDate: Date,
    endDate: Date
): Promise<GlobalMetrics> {
    const apiData = await fetchApi<ApiGlobalResponse>("/api/analytics/global", {
        server: serverId,
        start: startDate.toISOString(),
        end: endDate.toISOString(),
        includePrevious: "true",
    });

    const totalCalls = apiData.totalCalls;
    const answeredCalls = apiData.answeredCalls;
    const answerRate = totalCalls > 0 ? (answeredCalls / totalCalls) * 100 : 0;

    const prev = apiData.previousPeriod;
    const prevTotalCalls = prev?.totalCalls || 0;
    const prevAnsweredCalls = prev?.answeredCalls || 0;
    const prevAnswerRate = prevTotalCalls > 0 ? (prevAnsweredCalls / prevTotalCalls) * 100 : 0;

    return {
        totalCalls,
        answeredCalls,
        missedCalls: apiData.missedCalls,
        voicemailCalls: apiData.voicemailCalls,
        busyCalls: apiData.busyCalls,
        avgDurationSeconds: apiData.avgDurationSeconds,
        answerRate: Math.round(answerRate * 10) / 10,
        avgWaitTimeSeconds: apiData.avgWaitTimeSeconds,
        avgAgentsPerCall: apiData.avgAgentsPerCall,
        prevTotalCalls,
        prevAnsweredCalls,
        prevMissedCalls: prev?.missedCalls || 0,
        prevVoicemailCalls: prev?.voicemailCalls || 0,
        prevBusyCalls: prev?.busyCalls || 0,
        prevAvgDurationSeconds: prev?.avgDurationSeconds || 0,
        prevAnswerRate: Math.round(prevAnswerRate * 10) / 10,
        prevAvgWaitTimeSeconds: prev?.avgWaitTimeSeconds || 0,
        prevAvgAgentsPerCall: prev?.avgAgentsPerCall || 0,
        agentsDistribution: {
            oneAgent: apiData.agentsDistribution.agents1,
            twoAgents: apiData.agentsDistribution.agents2,
            threePlusAgents: apiData.agentsDistribution.agents3Plus,
        },
    };
}

export async function getTimelineData(
    serverId: ServerId,
    startDate: Date,
    endDate: Date
): Promise<TimelineDataPoint[]> {
    const diffMs = endDate.getTime() - startDate.getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    const interval = diffDays <= 2 ? "hour" : "day";

    const rawData = await getTimelineDataRaw(serverId, startDate, endDate);

    return rawData.map((row) => {
        const date = new Date(row.date_group);
        let label = "";
        if (interval === "hour") {
            label = `${String(date.getHours()).padStart(2, "0")}:00`;
        } else {
            label = `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}`;
        }
        return {
            date: date.toISOString(),
            label,
            answered: Number(row.answered),
            missed: Number(row.missed),
        };
    });
}

export async function getHeatmapData(
    serverId: ServerId,
    startDate: Date,
    endDate: Date
): Promise<HeatmapDataPoint[]> {
    const rawData = await getHeatmapDataRaw(serverId, startDate, endDate);
    return rawData.map((row) => ({
        dayOfWeek: row.day_of_week,
        hourOfDay: row.hour_of_day,
        value: Number(row.volume),
    }));
}

export async function getConcurrentCallsChartData(
    serverId: ServerId,
    startDate: Date,
    endDate: Date
): Promise<{ data: ConcurrentCallsDataPoint[]; summary: ConcurrentCallsSummary }> {
    const rawData = await getConcurrentCallsData(serverId, startDate, endDate);
    const threshold = SERVERS[serverId].licenceThreshold;

    const data: ConcurrentCallsDataPoint[] = rawData.map((row) => {
        const date = new Date(row.timestamp);
        const diffMs = endDate.getTime() - startDate.getTime();
        const diffDays = diffMs / (1000 * 60 * 60 * 24);

        let label: string;
        if (diffDays <= 1) {
            label = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
        } else if (diffDays <= 7) {
            label = `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
        } else {
            label = `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}h`;
        }

        return {
            timestamp: date.toISOString(),
            label,
            concurrentCalls: Number(row.concurrent_calls),
        };
    });

    let peak = 0;
    let peakTime = "";
    let sum = 0;

    for (const point of data) {
        sum += point.concurrentCalls;
        if (point.concurrentCalls > peak) {
            peak = point.concurrentCalls;
            peakTime = point.timestamp;
        }
    }

    const avg = data.length > 0 ? Math.round(sum / data.length) : 0;

    return {
        data,
        summary: { peak, peakTime, avg, threshold },
    };
}
