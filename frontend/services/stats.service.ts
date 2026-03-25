"use server";

import { prisma } from "@/lib/prisma";
import {
    GlobalMetrics,
    TimelineDataPoint,
    HeatmapDataPoint,
} from "@/types/stats.types";

interface PeriodMetrics {
    total_calls: bigint;
    answered_calls: bigint;
    missed_calls: bigint;
    avg_human_duration: number | null;
    avg_wait_time: number | null;
    avg_agents_per_call: number | null;
    agents_1: bigint;
    agents_2: bigint;
    agents_3_plus: bigint;
}

/**
 * Get global metrics based on UNIQUE CALLS (DISTINCT call_history_id).
 * Now calculates both current and previous (N-1) periods.
 */
export async function getGlobalMetrics(
    startDate: Date,
    endDate: Date
): Promise<GlobalMetrics> {
    // Calculate N-1 period
    const diffTime = endDate.getTime() - startDate.getTime();
    const prevEndDate = new Date(startDate.getTime() - 1);
    const prevStartDate = new Date(prevEndDate.getTime() - diffTime);

    const getMetricsQuery = (start: Date, end: Date) => prisma.$queryRaw<[PeriodMetrics]>`
        WITH unique_calls AS (
            SELECT
                call_history_id,
                -- A call is "answered" if ANY segment was answered (priority-based)
                bool_or(cdr_answered_at IS NOT NULL) AS was_answered,
                
                -- Human talk time (Only extension segments that are answered)
                SUM(
                    CASE WHEN destination_dn_type = 'extension' AND cdr_answered_at IS NOT NULL AND cdr_ended_at IS NOT NULL
                         THEN EXTRACT(EPOCH FROM (cdr_ended_at - cdr_answered_at))
                         ELSE 0
                    END
                ) AS human_talk_time,
                
                -- Total clock duration of the call
                EXTRACT(EPOCH FROM (MAX(COALESCE(cdr_ended_at, cdr_started_at)) - MIN(cdr_started_at))) AS total_clock_duration,
                
                -- Unique agents
                COUNT(DISTINCT CASE WHEN destination_dn_type = 'extension' AND cdr_answered_at IS NOT NULL THEN destination_dn_number ELSE NULL END) AS unique_agents_count
            FROM cdroutput
            WHERE cdr_started_at >= ${start}
              AND cdr_started_at <= ${end}
            GROUP BY call_history_id
        )
        SELECT
            COUNT(*) AS total_calls,
            COUNT(*) FILTER (WHERE was_answered) AS answered_calls,
            COUNT(*) FILTER (WHERE NOT was_answered) AS missed_calls,
            
            -- Averages based ONLY on answered calls
            AVG(human_talk_time) FILTER (WHERE was_answered) AS avg_human_duration,
            
            -- Wait time = total clock duration - human talk time
            AVG(GREATEST(0, total_clock_duration - human_talk_time)) FILTER (WHERE was_answered) AS avg_wait_time,
            
            AVG(unique_agents_count) FILTER (WHERE was_answered AND unique_agents_count > 0) AS avg_agents_per_call,
            
            COUNT(*) FILTER (WHERE was_answered AND unique_agents_count = 1) AS agents_1,
            COUNT(*) FILTER (WHERE was_answered AND unique_agents_count = 2) AS agents_2,
            COUNT(*) FILTER (WHERE was_answered AND unique_agents_count >= 3) AS agents_3_plus
        FROM unique_calls
    `;

    const [currentResult, prevResult] = await Promise.all([
        getMetricsQuery(startDate, endDate),
        getMetricsQuery(prevStartDate, prevEndDate)
    ]);

    const curr = currentResult[0];
    const prev = prevResult[0];

    const totalCalls = Number(curr.total_calls || 0);
    const answeredCalls = Number(curr.answered_calls || 0);
    const missedCalls = Number(curr.missed_calls || 0);
    const answerRate = totalCalls > 0 ? (answeredCalls / totalCalls) * 100 : 0;

    const prevTotalCalls = Number(prev.total_calls || 0);
    const prevAnsweredCalls = Number(prev.answered_calls || 0);
    const prevMissedCalls = Number(prev.missed_calls || 0);
    const prevAnswerRate = prevTotalCalls > 0 ? (prevAnsweredCalls / prevTotalCalls) * 100 : 0;

    return {
        totalCalls,
        answeredCalls,
        missedCalls,
        avgDurationSeconds: curr.avg_human_duration ? Math.round(Number(curr.avg_human_duration)) : 0,
        answerRate: Math.round(answerRate * 10) / 10,
        avgWaitTimeSeconds: curr.avg_wait_time ? Math.round(Number(curr.avg_wait_time)) : 0,
        avgAgentsPerCall: curr.avg_agents_per_call ? Math.round(Number(curr.avg_agents_per_call) * 10) / 10 : 0,

        prevTotalCalls,
        prevAnsweredCalls,
        prevMissedCalls,
        prevAvgDurationSeconds: prev.avg_human_duration ? Math.round(Number(prev.avg_human_duration)) : 0,
        prevAnswerRate: Math.round(prevAnswerRate * 10) / 10,
        prevAvgWaitTimeSeconds: prev.avg_wait_time ? Math.round(Number(prev.avg_wait_time)) : 0,
        prevAvgAgentsPerCall: prev.avg_agents_per_call ? Math.round(Number(prev.avg_agents_per_call) * 10) / 10 : 0,

        agentsDistribution: {
            oneAgent: Number(curr.agents_1 || 0),
            twoAgents: Number(curr.agents_2 || 0),
            threePlusAgents: Number(curr.agents_3_plus || 0),
        }
    };
}

/**
 * Get timeline data grouped by hour or day, counting UNIQUE CALLS.
 */
export async function getTimelineData(
    startDate: Date,
    endDate: Date
): Promise<TimelineDataPoint[]> {
    const diffMs = endDate.getTime() - startDate.getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);

    const interval = diffDays <= 2 ? 'hour' : 'day';

    const rawData = await prisma.$queryRaw<Array<{ date_group: Date, answered: bigint, missed: bigint }>>`
        WITH unique_calls AS (
            SELECT
                call_history_id,
                MIN(cdr_started_at) AS first_started_at,
                bool_or(cdr_answered_at IS NOT NULL) AS was_answered
            FROM cdroutput
            WHERE cdr_started_at >= ${startDate}
              AND cdr_started_at <= ${endDate}
            GROUP BY call_history_id
        )
        SELECT
            date_trunc(${interval}, first_started_at) AS date_group,
            COUNT(*) FILTER (WHERE was_answered) AS answered,
            COUNT(*) FILTER (WHERE NOT was_answered) AS missed
        FROM unique_calls
        GROUP BY date_group
        ORDER BY date_group ASC
    `;

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

/**
 * Get heatmap data grouped by day of week and hour of day
 */
export async function getHeatmapData(
    startDate: Date,
    endDate: Date
): Promise<HeatmapDataPoint[]> {
    const rawData = await prisma.$queryRaw<Array<{ day_of_week: number, hour_of_day: number, volume: bigint }>>`
        WITH unique_calls AS (
            SELECT
                call_history_id,
                MIN(cdr_started_at) AS first_started_at
            FROM cdroutput
            WHERE cdr_started_at >= ${startDate}
              AND cdr_started_at <= ${endDate}
            GROUP BY call_history_id
        )
        SELECT
            EXTRACT(ISODOW FROM first_started_at)::int AS day_of_week,
            EXTRACT(HOUR FROM first_started_at)::int AS hour_of_day,
            COUNT(*) AS volume
        FROM unique_calls
        GROUP BY day_of_week, hour_of_day
    `;

    return rawData.map(row => ({
        dayOfWeek: row.day_of_week, // 1 = Monday, 7 = Sunday
        hourOfDay: row.hour_of_day, // 0 - 23
        value: Number(row.volume),
    }));
}