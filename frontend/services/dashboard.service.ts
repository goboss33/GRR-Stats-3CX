"use server";

import { ServerId } from "@/lib/prisma-cdr";
import {
    getTimelineDataRaw,
    getHeatmapDataRaw,
    getConcurrentCallsData,
    getQueueTimelineDataRaw,
    getQueueHeatmapDataRaw,
    getGlobalMetricsRaw,
} from "@/services/repositories/cdr.repository";
import { resolveAccessScope, unrestrictedScope, type AccessScope } from "@/lib/access-scope";
import type { CallOrigin } from "@/services/domain/call-classification";
import type { DashboardDirection } from "@/services/domain/call-aggregation";
import type {
    GlobalMetrics,
    TimelineDataPoint,
    HeatmapDataPoint,
    ConcurrentCallsDataPoint,
    ConcurrentCallsSummary,
} from "@/services/domain/call.types";
import { getServerTimezone, getServerLicenceThreshold, getServerTrunkThreshold } from "@/lib/servers";

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

/**
 * Portée applicable au dashboard : filtrée par périmètre, sauf pour les
 * utilisateurs autorisés à voir les chiffres de l'entreprise (option C du PRD).
 */
async function resolveDashboardScope(serverId: ServerId): Promise<AccessScope> {
    const scope = await resolveAccessScope(serverId);
    return scope.canViewCompanyWide ? unrestrictedScope() : scope;
}

export async function getGlobalMetrics(
    serverId: ServerId,
    startDate: Date,
    endDate: Date,
    direction: DashboardDirection = "inbound",
    origin: CallOrigin = "both"
): Promise<GlobalMetrics> {
    const scope = await resolveDashboardScope(serverId);

    // Période N-1 de même durée, se terminant juste avant le début de la période.
    const durationMs = endDate.getTime() - startDate.getTime();
    const prevEnd = new Date(startDate.getTime() - 1);
    const prevStart = new Date(prevEnd.getTime() - durationMs);

    // Requête locale filtrée (l'API interne, elle, n'est pas consciente du périmètre).
    // Exécution SÉQUENTIELLE, comme le faisait la route : cette requête est lourde
    // (sous-requête corrélée par appel) et la paralléliser aggrave la contention.
    const current = await getGlobalMetricsRaw(serverId, startDate, endDate, scope, direction, origin);
    const previous = await getGlobalMetricsRaw(serverId, prevStart, prevEnd, scope, direction, origin);

    const num = (v: string | null) => Number(v) || 0;
    const apiData: ApiGlobalResponse = {
        totalCalls: Number(current.total_calls),
        answeredCalls: Number(current.answered_calls),
        missedCalls: Number(current.missed_calls),
        voicemailCalls: Number(current.voicemail_calls),
        busyCalls: Number(current.busy_calls),
        avgDurationSeconds: num(current.avg_human_duration),
        avgWaitTimeSeconds: num(current.avg_wait_time),
        avgAgentsPerCall: num(current.avg_agents_per_call),
        agentsDistribution: {
            agents1: Number(current.agents_1),
            agents2: Number(current.agents_2),
            agents3Plus: Number(current.agents_3_plus),
        },
        previousPeriod: {
            totalCalls: Number(previous.total_calls),
            answeredCalls: Number(previous.answered_calls),
            missedCalls: Number(previous.missed_calls),
            voicemailCalls: Number(previous.voicemail_calls),
            busyCalls: Number(previous.busy_calls),
            avgDurationSeconds: num(previous.avg_human_duration),
            avgWaitTimeSeconds: num(previous.avg_wait_time),
            avgAgentsPerCall: num(previous.avg_agents_per_call),
            agentsDistribution: {
                agents1: Number(previous.agents_1),
                agents2: Number(previous.agents_2),
                agents3Plus: Number(previous.agents_3_plus),
            },
        },
    };

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
    endDate: Date,
    direction: DashboardDirection = "inbound",
    origin: CallOrigin = "both"
): Promise<TimelineDataPoint[]> {
    const diffMs = endDate.getTime() - startDate.getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    const interval = diffDays <= 2 ? "hour" : "day";
    const timezone = await getServerTimezone(serverId);
    const scope = await resolveDashboardScope(serverId);

    const rawData = await getTimelineDataRaw(serverId, startDate, endDate, timezone, scope, direction, origin);

    return rawData.map((row) => {
        const date = new Date(row.date_group);
        let label = "";
        if (interval === "hour") {
            label = `${String(date.getUTCHours()).padStart(2, "0")}:00`;
        } else {
            label = `${String(date.getUTCDate()).padStart(2, "0")}/${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
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
    endDate: Date,
    direction: DashboardDirection = "inbound",
    origin: CallOrigin = "both"
): Promise<HeatmapDataPoint[]> {
    const timezone = await getServerTimezone(serverId);
    const scope = await resolveDashboardScope(serverId);
    const rawData = await getHeatmapDataRaw(serverId, startDate, endDate, timezone, undefined, scope, direction, origin);
    return rawData.map((row) => ({
        dayOfWeek: row.day_of_week,
        hourOfDay: row.hour_of_day,
        value: Number(row.volume),
    }));
}

export async function getQueueTimelineData(
    serverId: ServerId,
    queueNumber: string,
    startDate: Date,
    endDate: Date,
    origin: CallOrigin = "both"
): Promise<TimelineDataPoint[]> {
    const diffMs = endDate.getTime() - startDate.getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    const interval = diffDays <= 2 ? "hour" : "day";
    const timezone = await getServerTimezone(serverId);

    const rawData = await getQueueTimelineDataRaw(serverId, queueNumber, startDate, endDate, timezone, origin);

    return rawData.map((row) => {
        const date = new Date(row.date_group);
        let label = "";
        if (interval === "hour") {
            label = `${String(date.getUTCHours()).padStart(2, "0")}:00`;
        } else {
            label = `${String(date.getUTCDate()).padStart(2, "0")}/${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
        }
        return {
            date: date.toISOString(),
            label,
            answered: Number(row.answered),
            missed: Number(row.missed),
            overflow: row.overflow === undefined ? undefined : Number(row.overflow),
        };
    });
}

export async function getQueueHeatmapData(
    serverId: ServerId,
    queueNumber: string,
    startDate: Date,
    endDate: Date,
    origin: CallOrigin = "both"
): Promise<HeatmapDataPoint[]> {
    const timezone = await getServerTimezone(serverId);
    const rawData = await getQueueHeatmapDataRaw(serverId, queueNumber, startDate, endDate, timezone, origin);
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
    const timezone = await getServerTimezone(serverId);
    const scope = await resolveDashboardScope(serverId);
    const rawData = await getConcurrentCallsData(serverId, startDate, endDate, timezone, scope);
    const threshold = await getServerLicenceThreshold(serverId);
    const trunkThreshold = await getServerTrunkThreshold(serverId);

    const data: ConcurrentCallsDataPoint[] = rawData.map((row) => {
        const date = new Date(row.timestamp);
        const diffMs = endDate.getTime() - startDate.getTime();
        const diffDays = diffMs / (1000 * 60 * 60 * 24);

        let label: string;
        if (diffDays <= 1) {
            label = `${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")}`;
        } else if (diffDays <= 7) {
            label = `${String(date.getUTCDate()).padStart(2, "0")}/${String(date.getUTCMonth() + 1).padStart(2, "0")} ${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")}`;
        } else {
            label = `${String(date.getUTCDate()).padStart(2, "0")}/${String(date.getUTCMonth() + 1).padStart(2, "0")} ${String(date.getUTCHours()).padStart(2, "0")}h`;
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
        summary: { peak, peakTime, avg, threshold, trunkThreshold },
    };
}
