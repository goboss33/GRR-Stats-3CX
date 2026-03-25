"use server";

import { prisma } from "@/lib/prisma";
import {
    GlobalMetrics,
    TimelineDataPoint,
} from "@/types/stats.types";

/**
 * Get global metrics based on UNIQUE CALLS (DISTINCT call_history_id).
 * 
 * An call is "answered" if at least one CDR segment has cdr_answered_at IS NOT NULL.
 * This matches the approach in DECISIONS.md section 1.8 (priority-based outcome).
 * 
 * Average duration = average of total call duration per unique call (sum of answered segments).
 */
export async function getGlobalMetrics(
    startDate: Date,
    endDate: Date
): Promise<GlobalMetrics> {
    const result = await prisma.$queryRaw<[{
        total_calls: bigint,
        answered_calls: bigint,
        missed_calls: bigint,
        avg_duration: number | null
    }]>`
        WITH unique_calls AS (
            SELECT
                call_history_id,
                -- A call is "answered" if ANY segment was answered (priority-based)
                bool_or(cdr_answered_at IS NOT NULL) AS was_answered,
                -- Total duration = sum of answered segments' durations
                SUM(
                    CASE WHEN cdr_answered_at IS NOT NULL AND cdr_ended_at IS NOT NULL
                         THEN EXTRACT(EPOCH FROM (cdr_ended_at - cdr_answered_at))
                         ELSE 0
                    END
                ) AS total_duration_seconds
            FROM cdroutput
            WHERE cdr_started_at >= ${startDate}
              AND cdr_started_at <= ${endDate}
            GROUP BY call_history_id
        )
        SELECT
            COUNT(*) AS total_calls,
            COUNT(*) FILTER (WHERE was_answered) AS answered_calls,
            COUNT(*) FILTER (WHERE NOT was_answered) AS missed_calls,
            AVG(total_duration_seconds) FILTER (WHERE was_answered) AS avg_duration
        FROM unique_calls
    `;

    const totalCalls = Number(result[0].total_calls);
    const answeredCalls = Number(result[0].answered_calls);
    const missedCalls = Number(result[0].missed_calls);
    const avgDurationSeconds = result[0].avg_duration
        ? Math.round(Number(result[0].avg_duration))
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
 * Get timeline data grouped by hour or day, counting UNIQUE CALLS (DISTINCT call_history_id).
 * 
 * Each unique call is assigned to a time bucket based on its earliest segment's start time.
 * A call is "answered" if any segment was answered, otherwise "missed".
 */
export async function getTimelineData(
    startDate: Date,
    endDate: Date
): Promise<TimelineDataPoint[]> {
    const diffMs = endDate.getTime() - startDate.getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);

    // Si la période est <= 2 jours, on groupe par heure, sinon par jour
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

    // Transformation pour le frontend
    return rawData.map((row) => {
        const date = new Date(row.date_group);
        let label = "";

        if (interval === 'hour') {
            // Format HH:00
            label = `${String(date.getHours()).padStart(2, "0")}:00`;
        } else {
            // Format DD/MM
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