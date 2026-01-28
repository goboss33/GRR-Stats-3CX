"use server";

import { prisma } from "@/lib/prisma";
import {
    QueueStatistics,
    QueueKPIs,
    AgentStats,
    DailyTrend,
    HourlyTrend,
    OverflowDestination,
} from "@/types/statistics.types";
import { QueueInfo } from "@/types/queues.types";

// ============================================
// GET ALL QUEUES (for selector)
// ============================================
export async function getQueuesForSelector(): Promise<QueueInfo[]> {
    // Use DISTINCT ON to get unique queue numbers with their most recent name
    const result = await prisma.$queryRaw<any[]>`
        SELECT DISTINCT ON (destination_dn_number)
            destination_dn_number AS queue_number,
            destination_dn_name AS queue_name
        FROM cdroutput
        WHERE destination_dn_type = 'queue'
        ORDER BY destination_dn_number, cdr_started_at DESC;
    `;

    return result.map((row) => ({
        queueNumber: row.queue_number,
        queueName: row.queue_name,
        members: [],
        memberCount: 0,
    }));
}

// ============================================
// GET QUEUE STATISTICS
// ============================================
export async function getQueueStatistics(
    queueNumber: string,
    startDate: Date,
    endDate: Date
): Promise<QueueStatistics> {
    // Get queue name
    const queueInfo = await prisma.$queryRaw<any[]>`
        SELECT DISTINCT destination_dn_name AS queue_name
        FROM cdroutput
        WHERE destination_dn_number = ${queueNumber}
          AND destination_dn_type = 'queue'
        LIMIT 1;
    `;
    const queueName = queueInfo[0]?.queue_name || queueNumber;

    // Get KPIs
    const kpis = await getQueueKPIs(queueNumber, startDate, endDate);

    // Get agent stats
    const agents = await getAgentStats(queueNumber, startDate, endDate);

    // Get daily trend
    const dailyTrend = await getDailyTrend(queueNumber, startDate, endDate);

    // Get hourly trend
    const hourlyTrend = await getHourlyTrend(queueNumber, startDate, endDate);

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

// ============================================
// KPIs CALCULATION
// ============================================
async function getQueueKPIs(
    queueNumber: string,
    startDate: Date,
    endDate: Date
): Promise<QueueKPIs> {
    // VALIDATED LOGIC (based on CDR data analysis):
    // - ANSWERED: Agent with originating_cdr_id = this queue's cdr_id AND cdr_answered_at IS NOT NULL
    // - OVERFLOW: Another queue in same call_history_id with cdr_started_at > this queue's cdr_started_at
    // - ABANDONED: Neither answered nor overflowed
    //
    // KEY INSIGHT: Overflow queues are NOT direct children (originating_cdr_id).
    // They share the same call_history_id but go through scripts/ring_groups in between.

    const result = await prisma.$queryRaw<any[]>`
        WITH queue_entries AS (
            -- All entries into this queue
            SELECT cdr_id, call_history_id, cdr_started_at, cdr_ended_at
            FROM cdroutput
            WHERE destination_dn_number = ${queueNumber}
              AND destination_dn_type = 'queue'
              AND cdr_started_at >= ${startDate}
              AND cdr_started_at <= ${endDate}
        ),
        outcomes AS (
            SELECT 
                qe.cdr_id,
                qe.call_history_id,
                qe.cdr_started_at,
                qe.cdr_ended_at,
                -- Answered by an agent from THIS queue?
                MAX(CASE 
                    WHEN ans.originating_cdr_id = qe.cdr_id 
                         AND ans.destination_dn_type = 'extension'
                         AND ans.cdr_answered_at IS NOT NULL
                    THEN 1 ELSE 0 END) as answered_here,
                -- Forwarded to another queue? (via call_history_id, not originating_cdr_id)
                MAX(CASE 
                    WHEN other_q.destination_dn_type = 'queue'
                         AND other_q.destination_dn_number != ${queueNumber}
                         AND other_q.cdr_started_at > qe.cdr_started_at
                    THEN 1 ELSE 0 END) as forwarded_to_other_queue,
                -- Wait time (time before answer by agent from this queue)
                MIN(CASE 
                    WHEN ans.originating_cdr_id = qe.cdr_id 
                         AND ans.destination_dn_type = 'extension'
                         AND ans.cdr_answered_at IS NOT NULL
                    THEN EXTRACT(EPOCH FROM (ans.cdr_answered_at - qe.cdr_started_at))
                    ELSE NULL END) as wait_time_seconds,
                -- Talk time
                MAX(CASE 
                    WHEN ans.originating_cdr_id = qe.cdr_id 
                         AND ans.destination_dn_type = 'extension'
                         AND ans.cdr_answered_at IS NOT NULL
                    THEN EXTRACT(EPOCH FROM (ans.cdr_ended_at - ans.cdr_answered_at)) 
                    ELSE 0 END) as talk_time_seconds
            FROM queue_entries qe
            LEFT JOIN cdroutput ans ON ans.originating_cdr_id = qe.cdr_id
            LEFT JOIN cdroutput other_q ON other_q.call_history_id = qe.call_history_id
                                       AND other_q.cdr_started_at > qe.cdr_started_at
            GROUP BY qe.cdr_id, qe.call_history_id, qe.cdr_started_at, qe.cdr_ended_at
        ),
        final_outcomes AS (
            SELECT 
                cdr_id,
                call_history_id,
                cdr_started_at,
                cdr_ended_at,
                wait_time_seconds,
                talk_time_seconds,
                -- Determine SINGLE outcome: answered > overflow > abandoned
                CASE 
                    WHEN answered_here = 1 THEN 'answered'
                    WHEN forwarded_to_other_queue = 1 THEN 'overflow'
                    ELSE 'abandoned'
                END as outcome,
                -- Time in queue for abandoned calls
                EXTRACT(EPOCH FROM (cdr_ended_at - cdr_started_at)) as time_in_queue
            FROM outcomes
        )
        SELECT 
            COUNT(*) as total_calls,
            SUM(CASE WHEN outcome = 'answered' THEN 1 ELSE 0 END) as answered,
            SUM(CASE WHEN outcome = 'abandoned' THEN 1 ELSE 0 END) as abandoned,
            SUM(CASE WHEN outcome = 'abandoned' AND time_in_queue < 10 THEN 1 ELSE 0 END) as abandoned_before_10s,
            SUM(CASE WHEN outcome = 'abandoned' AND time_in_queue >= 10 THEN 1 ELSE 0 END) as abandoned_after_10s,
            SUM(CASE WHEN outcome = 'overflow' THEN 1 ELSE 0 END) as overflow,
            AVG(wait_time_seconds) as avg_wait_time,
            AVG(CASE WHEN outcome = 'answered' THEN talk_time_seconds ELSE NULL END) as avg_talk_time
        FROM final_outcomes;
    `;

    const row = result[0] || {};

    // Get overflow destinations - only FIRST destination per overflow call
    const overflowDests = await prisma.$queryRaw<any[]>`
        WITH queue_entries AS (
            SELECT cdr_id, call_history_id, cdr_started_at
            FROM cdroutput
            WHERE destination_dn_number = ${queueNumber}
              AND destination_dn_type = 'queue'
              AND cdr_started_at >= ${startDate}
              AND cdr_started_at <= ${endDate}
        ),
        queue_with_answer_status AS (
            SELECT 
                qe.cdr_id,
                qe.call_history_id,
                qe.cdr_started_at,
                MAX(CASE 
                    WHEN ans.originating_cdr_id = qe.cdr_id 
                         AND ans.destination_dn_type = 'extension'
                         AND ans.cdr_answered_at IS NOT NULL
                    THEN 1 ELSE 0 END) as answered_here
            FROM queue_entries qe
            LEFT JOIN cdroutput ans ON ans.originating_cdr_id = qe.cdr_id
            GROUP BY qe.cdr_id, qe.call_history_id, qe.cdr_started_at
        ),
        first_overflow_destination AS (
            -- For each overflow call, get only the FIRST other queue it went to
            SELECT DISTINCT ON (qas.cdr_id)
                qas.cdr_id,
                other_q.destination_dn_number as destination,
                other_q.destination_dn_name as destination_name
            FROM queue_with_answer_status qas
            JOIN cdroutput other_q ON other_q.call_history_id = qas.call_history_id
                                  AND other_q.destination_dn_type = 'queue'
                                  AND other_q.destination_dn_number != ${queueNumber}
                                  AND other_q.cdr_started_at > qas.cdr_started_at
            WHERE qas.answered_here = 0
            ORDER BY qas.cdr_id, other_q.cdr_started_at ASC
        )
        SELECT 
            destination,
            destination_name,
            COUNT(*) as count
        FROM first_overflow_destination
        GROUP BY destination, destination_name
        ORDER BY count DESC;
    `;

    const overflowDestinations: OverflowDestination[] = overflowDests.map((d) => ({
        destination: d.destination,
        destinationName: d.destination_name || d.destination,
        count: Number(d.count),
    }));

    const totalCalls = Number(row.total_calls || 0);

    return {
        callsReceived: totalCalls,
        callsAnswered: Number(row.answered || 0),
        callsAbandoned: Number(row.abandoned || 0),
        abandonedBefore10s: Number(row.abandoned_before_10s || 0),
        abandonedAfter10s: Number(row.abandoned_after_10s || 0),
        callsToVoicemail: 0,
        callsOverflow: Number(row.overflow || 0),
        overflowDestinations,
        avgWaitTimeSeconds: Math.round(Number(row.avg_wait_time || 0)),
        avgTalkTimeSeconds: Math.round(Number(row.avg_talk_time || 0)),
    };
}

// ============================================
// AGENT STATS
// ============================================
async function getAgentStats(
    queueNumber: string,
    startDate: Date,
    endDate: Date
): Promise<AgentStats[]> {
    const result = await prisma.$queryRaw<any[]>`
        WITH queue_calls AS (
            SELECT q.cdr_id, q.call_history_id
            FROM cdroutput q
            WHERE q.destination_dn_number = ${queueNumber}
              AND q.destination_dn_type = 'queue'
              AND q.cdr_started_at >= ${startDate}
              AND q.cdr_started_at <= ${endDate}
        ),
        agent_activity AS (
            SELECT 
                c.destination_dn_number as extension,
                c.destination_dn_name as name,
                -- Calls from queue (answered)
                COUNT(CASE WHEN c.cdr_answered_at IS NOT NULL 
                           AND c.creation_forward_reason = 'polling'
                      THEN 1 END) as calls_from_queue,
                -- Total attempts from queue
                COUNT(CASE WHEN c.creation_forward_reason = 'polling' THEN 1 END) as attempts_from_queue,
                -- Transferred out
                COUNT(CASE WHEN c.termination_reason = 'continued_in' THEN 1 END) as transferred,
                -- Intercepted (pickup)
                COUNT(CASE WHEN c.creation_method = 'pickup' THEN 1 END) as intercepted,
                -- Avg handling time
                AVG(CASE WHEN c.cdr_answered_at IS NOT NULL 
                    THEN EXTRACT(EPOCH FROM (c.cdr_ended_at - c.cdr_answered_at)) ELSE NULL END) as avg_handling_time
            FROM queue_calls qc
            JOIN cdroutput c ON c.originating_cdr_id = qc.cdr_id
            WHERE c.destination_dn_type = 'extension'
            GROUP BY c.destination_dn_number, c.destination_dn_name
        )
        SELECT 
            extension,
            name,
            calls_from_queue,
            attempts_from_queue,
            transferred,
            intercepted,
            avg_handling_time
        FROM agent_activity
        WHERE calls_from_queue > 0 OR intercepted > 0
        ORDER BY calls_from_queue DESC;
    `;

    // Get direct calls for these agents in the same period
    const extensions = result.map((r) => r.extension);

    let directCallsMap: Map<string, number> = new Map();
    if (extensions.length > 0) {
        const directResult = await prisma.$queryRaw<any[]>`
            SELECT 
                destination_dn_number as extension,
                COUNT(*) as direct_calls
            FROM cdroutput
            WHERE destination_dn_number = ANY(${extensions})
              AND destination_dn_type = 'extension'
              AND cdr_answered_at IS NOT NULL
              AND cdr_started_at >= ${startDate}
              AND cdr_started_at <= ${endDate}
              AND (originating_cdr_id IS NULL 
                   OR originating_cdr_id NOT IN (
                       SELECT cdr_id FROM cdroutput WHERE destination_dn_type = 'queue'
                   ))
            GROUP BY destination_dn_number;
        `;
        directResult.forEach((r) => {
            directCallsMap.set(r.extension, Number(r.direct_calls));
        });
    }

    return result.map((row) => {
        const callsFromQueue = Number(row.calls_from_queue || 0);
        const attempts = Number(row.attempts_from_queue || 0);
        const directCalls = directCallsMap.get(row.extension) || 0;
        const totalAnswered = callsFromQueue + directCalls;
        const totalAttempts = attempts + directCalls;

        return {
            extension: row.extension,
            name: row.name || row.extension,
            callsFromQueue,
            callsDirect: directCalls,
            callsIntercepted: Number(row.intercepted || 0),
            callsTransferred: Number(row.transferred || 0),
            totalAnswered,
            answerRate: totalAttempts > 0 ? Math.round((totalAnswered / totalAttempts) * 100) : 0,
            avgHandlingTimeSeconds: Math.round(Number(row.avg_handling_time || 0)),
        };
    });
}

// ============================================
// DAILY TREND
// ============================================
async function getDailyTrend(
    queueNumber: string,
    startDate: Date,
    endDate: Date
): Promise<DailyTrend[]> {
    const result = await prisma.$queryRaw<any[]>`
        WITH queue_calls AS (
            SELECT 
                q.cdr_id,
                DATE(q.cdr_started_at) as call_date
            FROM cdroutput q
            WHERE q.destination_dn_number = ${queueNumber}
              AND q.destination_dn_type = 'queue'
              AND q.cdr_started_at >= ${startDate}
              AND q.cdr_started_at <= ${endDate}
        ),
        daily_stats AS (
            SELECT 
                qc.call_date,
                COUNT(DISTINCT qc.cdr_id) as received,
                COUNT(DISTINCT CASE WHEN c.cdr_answered_at IS NOT NULL 
                                    AND c.destination_dn_type = 'extension'
                               THEN qc.cdr_id END) as answered,
                COUNT(DISTINCT CASE WHEN c.termination_reason_details = 'terminated_by_originator'
                                    AND c.cdr_answered_at IS NULL
                               THEN qc.cdr_id END) as abandoned
            FROM queue_calls qc
            LEFT JOIN cdroutput c ON c.originating_cdr_id = qc.cdr_id
            GROUP BY qc.call_date
        )
        SELECT * FROM daily_stats ORDER BY call_date;
    `;

    return result.map((row) => ({
        date: row.call_date instanceof Date
            ? row.call_date.toISOString().split('T')[0]
            : String(row.call_date),
        received: Number(row.received || 0),
        answered: Number(row.answered || 0),
        abandoned: Number(row.abandoned || 0),
    }));
}

// ============================================
// HOURLY TREND
// ============================================
async function getHourlyTrend(
    queueNumber: string,
    startDate: Date,
    endDate: Date
): Promise<HourlyTrend[]> {
    const result = await prisma.$queryRaw<any[]>`
        WITH queue_calls AS (
            SELECT 
                q.cdr_id,
                EXTRACT(HOUR FROM q.cdr_started_at) as call_hour
            FROM cdroutput q
            WHERE q.destination_dn_number = ${queueNumber}
              AND q.destination_dn_type = 'queue'
              AND q.cdr_started_at >= ${startDate}
              AND q.cdr_started_at <= ${endDate}
        ),
        hourly_stats AS (
            SELECT 
                qc.call_hour,
                COUNT(DISTINCT qc.cdr_id) as received,
                COUNT(DISTINCT CASE WHEN c.cdr_answered_at IS NOT NULL 
                                    AND c.destination_dn_type = 'extension'
                               THEN qc.cdr_id END) as answered,
                COUNT(DISTINCT CASE WHEN c.termination_reason_details = 'terminated_by_originator'
                                    AND c.cdr_answered_at IS NULL
                               THEN qc.cdr_id END) as abandoned
            FROM queue_calls qc
            LEFT JOIN cdroutput c ON c.originating_cdr_id = qc.cdr_id
            GROUP BY qc.call_hour
        )
        SELECT * FROM hourly_stats ORDER BY call_hour;
    `;

    // Fill in missing hours with zeros
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
