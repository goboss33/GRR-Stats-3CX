"use server";

import {
    getGlobalMetricsRaw,
    getTimelineDataRaw,
    getHeatmapDataRaw,
} from "@/services/repositories/cdr.repository";
import type {
    GlobalMetrics,
    TimelineDataPoint,
    HeatmapDataPoint,
} from "@/services/domain/call.types";

/**
 * Dashboard Service — Global Metrics
 * 
 * Orchestrates repository calls and formats data for the Dashboard UI.
 * No SQL logic here — all queries are in cdr.repository.ts.
 */

export async function getGlobalMetrics(
    startDate: Date,
    endDate: Date
): Promise<GlobalMetrics> {
    const diffTime = endDate.getTime() - startDate.getTime();
    const prevEndDate = new Date(startDate.getTime() - 1);
    const prevStartDate = new Date(prevEndDate.getTime() - diffTime);

    const [current, prev] = await Promise.all([
        getGlobalMetricsRaw(startDate, endDate),
        getGlobalMetricsRaw(prevStartDate, prevEndDate),
    ]);

    const totalCalls = Number(current.total_calls || 0);
    const answeredCalls = Number(current.answered_calls || 0);
    const missedCalls = Number(current.missed_calls || 0);
    const voicemailCalls = Number(current.voicemail_calls || 0);
    const busyCalls = Number(current.busy_calls || 0);
    const answerRate = totalCalls > 0 ? (answeredCalls / totalCalls) * 100 : 0;

    const prevTotalCalls = Number(prev.total_calls || 0);
    const prevAnsweredCalls = Number(prev.answered_calls || 0);
    const prevMissedCalls = Number(prev.missed_calls || 0);
    const prevVoicemailCalls = Number(prev.voicemail_calls || 0);
    const prevBusyCalls = Number(prev.busy_calls || 0);
    const prevAnswerRate = prevTotalCalls > 0 ? (prevAnsweredCalls / prevTotalCalls) * 100 : 0;

    return {
        totalCalls,
        answeredCalls,
        missedCalls,
        voicemailCalls,
        busyCalls,
        avgDurationSeconds: current.avg_human_duration ? Math.round(Number(current.avg_human_duration)) : 0,
        answerRate: Math.round(answerRate * 10) / 10,
        avgWaitTimeSeconds: current.avg_wait_time ? Math.round(Number(current.avg_wait_time)) : 0,
        avgAgentsPerCall: current.avg_agents_per_call ? Math.round(Number(current.avg_agents_per_call) * 10) / 10 : 0,
        prevTotalCalls,
        prevAnsweredCalls,
        prevMissedCalls,
        prevVoicemailCalls,
        prevBusyCalls,
        prevAvgDurationSeconds: prev.avg_human_duration ? Math.round(Number(prev.avg_human_duration)) : 0,
        prevAnswerRate: Math.round(prevAnswerRate * 10) / 10,
        prevAvgWaitTimeSeconds: prev.avg_wait_time ? Math.round(Number(prev.avg_wait_time)) : 0,
        prevAvgAgentsPerCall: prev.avg_agents_per_call ? Math.round(Number(prev.avg_agents_per_call) * 10) / 10 : 0,
        agentsDistribution: {
            oneAgent: Number(current.agents_1 || 0),
            twoAgents: Number(current.agents_2 || 0),
            threePlusAgents: Number(current.agents_3_plus || 0),
        },
    };
}

export async function getTimelineData(
    startDate: Date,
    endDate: Date
): Promise<TimelineDataPoint[]> {
    const diffMs = endDate.getTime() - startDate.getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    const interval = diffDays <= 2 ? 'hour' : 'day';

    const rawData = await getTimelineDataRaw(startDate, endDate);

    return rawData.map((row) => {
        const date = new Date(row.date_group);
        let label = "";
        if (interval === 'hour') {
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
    startDate: Date,
    endDate: Date
): Promise<HeatmapDataPoint[]> {
    const rawData = await getHeatmapDataRaw(startDate, endDate);
    return rawData.map(row => ({
        dayOfWeek: row.day_of_week,
        hourOfDay: row.hour_of_day,
        value: Number(row.volume),
    }));
}
