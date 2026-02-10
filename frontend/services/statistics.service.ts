"use server";

import { prisma } from "@/lib/prisma";
import {
    QueueStatistics,
    QueueKPIs,
    AgentStats,
    DailyTrend,
    HourlyTrend,
    OverflowDestination,
    TransferDestination,
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

    // Get agent stats (pass totalQueueCalls for availability rate calculation)
    const agents = await getAgentStats(queueNumber, startDate, endDate, kpis.callsReceived);

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
    // - ANSWERED_AND_TRANSFERRED: Answered by agent AND agent's segment has termination_reason = 'continued_in'
    //
    // KEY INSIGHT: Overflow queues are NOT direct children (originating_cdr_id).
    // They share the same call_history_id but go through scripts/ring_groups in between.

    const result = await prisma.$queryRaw<any[]>`
        -- REFACTORED: Count by unique call_history_id (DRY - aligned with logs.service.ts)
        -- This ensures statistics match the logs count (e.g., 673 instead of 751)
        WITH unique_queue_calls AS (
            -- One record per unique call (call_history_id)
            -- Takes the FIRST entry into this queue if multiple entries exist
            SELECT DISTINCT ON (call_history_id)
                call_history_id,
                cdr_id,
                cdr_started_at,
                cdr_ended_at
            FROM cdroutput
            WHERE destination_dn_number = ${queueNumber}
              AND destination_dn_type = 'queue'
              AND cdr_started_at >= ${startDate}
              AND cdr_started_at <= ${endDate}
            ORDER BY call_history_id, cdr_started_at ASC
        ),
        outcomes AS (
            SELECT 
                uqc.cdr_id,
                uqc.call_history_id,
                uqc.cdr_started_at,
                uqc.cdr_ended_at,
                -- Answered by an agent from THIS queue?
                MAX(CASE 
                    WHEN ans.originating_cdr_id = uqc.cdr_id 
                         AND ans.destination_dn_type = 'extension'
                         AND ans.cdr_answered_at IS NOT NULL
                    THEN 1 ELSE 0 END) as answered_here,
                -- Answered AND then transferred by the agent?
                MAX(CASE 
                    WHEN ans.originating_cdr_id = uqc.cdr_id 
                         AND ans.destination_dn_type = 'extension'
                         AND ans.cdr_answered_at IS NOT NULL
                         AND ans.termination_reason = 'continued_in'
                    THEN 1 ELSE 0 END) as answered_and_transferred,
                -- Forwarded to another queue? (via call_history_id, not originating_cdr_id)
                MAX(CASE 
                    WHEN other_q.destination_dn_type = 'queue'
                         AND other_q.destination_dn_number != ${queueNumber}
                         AND other_q.cdr_started_at > uqc.cdr_started_at
                    THEN 1 ELSE 0 END) as forwarded_to_other_queue,
                -- Wait time (time before answer by agent from this queue)
                MIN(CASE 
                    WHEN ans.originating_cdr_id = uqc.cdr_id 
                         AND ans.destination_dn_type = 'extension'
                         AND ans.cdr_answered_at IS NOT NULL
                    THEN EXTRACT(EPOCH FROM (ans.cdr_answered_at - uqc.cdr_started_at))
                    ELSE NULL END) as wait_time_seconds,
                -- Talk time
                MAX(CASE 
                    WHEN ans.originating_cdr_id = uqc.cdr_id 
                         AND ans.destination_dn_type = 'extension'
                         AND ans.cdr_answered_at IS NOT NULL
                    THEN EXTRACT(EPOCH FROM (ans.cdr_ended_at - ans.cdr_answered_at)) 
                    ELSE 0 END) as talk_time_seconds
            FROM unique_queue_calls uqc
            LEFT JOIN cdroutput ans ON ans.originating_cdr_id = uqc.cdr_id
            LEFT JOIN cdroutput other_q ON other_q.call_history_id = uqc.call_history_id
                                       AND other_q.cdr_started_at > uqc.cdr_started_at
            GROUP BY uqc.cdr_id, uqc.call_history_id, uqc.cdr_started_at, uqc.cdr_ended_at
        ),
        final_outcomes AS (
            SELECT 
                cdr_id,
                call_history_id,
                cdr_started_at,
                cdr_ended_at,
                wait_time_seconds,
                talk_time_seconds,
                answered_and_transferred,
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
            SUM(CASE WHEN outcome = 'answered' AND answered_and_transferred = 1 THEN 1 ELSE 0 END) as answered_and_transferred,
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
        WITH unique_queue_calls AS (
            SELECT DISTINCT ON (call_history_id)
                call_history_id,
                cdr_id,
                cdr_started_at
            FROM cdroutput
            WHERE destination_dn_number = ${queueNumber}
              AND destination_dn_type = 'queue'
              AND cdr_started_at >= ${startDate}
              AND cdr_started_at <= ${endDate}
            ORDER BY call_history_id, cdr_started_at ASC
        ),
        queue_with_answer_status AS (
            SELECT 
                uqc.cdr_id,
                uqc.call_history_id,
                uqc.cdr_started_at,
                MAX(CASE 
                    WHEN ans.originating_cdr_id = uqc.cdr_id 
                         AND ans.destination_dn_type = 'extension'
                         AND ans.cdr_answered_at IS NOT NULL
                    THEN 1 ELSE 0 END) as answered_here
            FROM unique_queue_calls uqc
            LEFT JOIN cdroutput ans ON ans.originating_cdr_id = uqc.cdr_id
            GROUP BY uqc.cdr_id, uqc.call_history_id, uqc.cdr_started_at
        ),
        first_overflow_destination AS (
            -- For each overflow call, get only the FIRST other queue it went to
            SELECT DISTINCT ON (qas.call_history_id)
                qas.call_history_id,
                other_q.destination_dn_number as destination,
                other_q.destination_dn_name as destination_name
            FROM queue_with_answer_status qas
            JOIN cdroutput other_q ON other_q.call_history_id = qas.call_history_id
                                  AND other_q.destination_dn_type = 'queue'
                                  AND other_q.destination_dn_number != ${queueNumber}
                                  AND other_q.cdr_started_at > qas.cdr_started_at
            WHERE qas.answered_here = 0
            ORDER BY qas.call_history_id, other_q.cdr_started_at ASC
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

    // Get transfer destinations (answered then transferred by agent)
    // Only show transfers OUTSIDE the queue (exclude queue member agents + technical destinations)
    const transferDests = await prisma.$queryRaw<any[]>`
        WITH unique_queue_calls AS (
            SELECT DISTINCT ON (call_history_id)
                call_history_id,
                cdr_id,
                cdr_started_at
            FROM cdroutput
            WHERE destination_dn_number = ${queueNumber}
              AND destination_dn_type = 'queue'
              AND cdr_started_at >= ${startDate}
              AND cdr_started_at <= ${endDate}
            ORDER BY call_history_id, cdr_started_at ASC
        ),
        queue_agents AS (
            -- Get all extensions that are agents of this queue
            SELECT DISTINCT c.destination_dn_number as extension
            FROM unique_queue_calls uqc
            JOIN cdroutput c ON c.originating_cdr_id = uqc.cdr_id
            WHERE c.destination_dn_type = 'extension'
              AND c.cdr_answered_at IS NOT NULL
        ),
        agent_transferred AS (
            -- Find agents who answered from this queue and then transferred
            SELECT 
                ans.cdr_id as agent_cdr_id,
                ans.continued_in_cdr_id
            FROM unique_queue_calls uqc
            JOIN cdroutput ans ON ans.originating_cdr_id = uqc.cdr_id
                              AND ans.destination_dn_type = 'extension'
                              AND ans.cdr_answered_at IS NOT NULL
                              AND ans.termination_reason = 'continued_in'
        ),
        transfer_destinations AS (
            -- Follow continued_in_cdr_id to find the transfer destination
            -- Exclude queue member agents and technical destinations
            SELECT
                dest.destination_dn_number as destination,
                dest.destination_dn_name as destination_name,
                dest.destination_dn_type as destination_type
            FROM agent_transferred at_
            JOIN cdroutput dest ON dest.cdr_id = at_.continued_in_cdr_id
            WHERE dest.destination_dn_type IN ('extension', 'queue')
              AND dest.destination_dn_number NOT IN (SELECT extension FROM queue_agents)
        )
        SELECT 
            destination,
            destination_name,
            destination_type,
            COUNT(*) as count
        FROM transfer_destinations
        GROUP BY destination, destination_name, destination_type
        ORDER BY count DESC;
    `;

    const transferDestinations: TransferDestination[] = transferDests.map((d: any) => ({
        destination: d.destination,
        destinationName: d.destination_name || d.destination,
        destinationType: d.destination_type || 'unknown',
        count: Number(d.count),
    }));

    // Compute external transfer count from filtered destinations
    const externalTransferCount = transferDestinations.reduce((sum, d) => sum + d.count, 0);

    const totalCalls = Number(row.total_calls || 0);

    return {
        callsReceived: totalCalls,
        callsAnswered: Number(row.answered || 0),
        callsAnsweredAndTransferred: externalTransferCount,
        callsAbandoned: Number(row.abandoned || 0),
        abandonedBefore10s: Number(row.abandoned_before_10s || 0),
        abandonedAfter10s: Number(row.abandoned_after_10s || 0),
        callsToVoicemail: 0,
        callsOverflow: Number(row.overflow || 0),
        overflowDestinations,
        transferDestinations,
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
    endDate: Date,
    totalQueueCalls: number
): Promise<AgentStats[]> {
    const result = await prisma.$queryRaw<any[]>`
        WITH unique_queue_calls AS (
            -- Aligned with KPIs: DISTINCT ON call_history_id to avoid double-counting
            SELECT DISTINCT ON (call_history_id)
                call_history_id,
                cdr_id,
                cdr_started_at
            FROM cdroutput
            WHERE destination_dn_number = ${queueNumber}
              AND destination_dn_type = 'queue'
              AND cdr_started_at >= ${startDate}
              AND cdr_started_at <= ${endDate}
            ORDER BY call_history_id, cdr_started_at ASC
        ),
        agent_activity AS (
            SELECT 
                c.destination_dn_number as extension,
                c.destination_dn_name as name,
                -- Sollicitations: total times phone rang (polling)
                COUNT(CASE WHEN c.creation_forward_reason = 'polling' THEN 1 END) as attempts,
                -- Appels reçus: unique calls where phone rang
                COUNT(DISTINCT CASE WHEN c.creation_forward_reason = 'polling' THEN qc.call_history_id END) as calls_received,
                -- Calls answered from queue
                COUNT(CASE WHEN c.cdr_answered_at IS NOT NULL 
                           AND c.creation_forward_reason = 'polling'
                      THEN 1 END) as answered,
                -- Answered then transferred out
                COUNT(CASE WHEN c.cdr_answered_at IS NOT NULL
                           AND c.termination_reason = 'continued_in'
                      THEN 1 END) as transferred,
                -- Avg handling time (only for answered calls)
                AVG(CASE WHEN c.cdr_answered_at IS NOT NULL 
                    THEN EXTRACT(EPOCH FROM (c.cdr_ended_at - c.cdr_answered_at)) ELSE NULL END) as avg_handling_time,
                -- Total handling time
                SUM(CASE WHEN c.cdr_answered_at IS NOT NULL 
                    THEN EXTRACT(EPOCH FROM (c.cdr_ended_at - c.cdr_answered_at)) ELSE 0 END) as total_handling_time
            FROM unique_queue_calls qc
            JOIN cdroutput c ON c.originating_cdr_id = qc.cdr_id
            WHERE c.destination_dn_type = 'extension'
            GROUP BY c.destination_dn_number, c.destination_dn_name
        )
        SELECT 
            extension,
            name,
            attempts,
            calls_received,
            answered,
            transferred,
            avg_handling_time,
            total_handling_time
        FROM agent_activity
        WHERE answered > 0
        ORDER BY answered DESC;
    `;

    return result.map((row: any) => {
        const attempts = Number(row.attempts || 0);
        const callsReceived = Number(row.calls_received || 0);
        const answered = Number(row.answered || 0);
        const transferred = Number(row.transferred || 0);

        return {
            extension: row.extension,
            name: row.name || row.extension,
            callsReceived,
            attempts,
            answered,
            transferred,
            answerRate: callsReceived > 0 ? Math.round((answered / callsReceived) * 100) : 0,
            availabilityRate: totalQueueCalls > 0 ? Math.round((callsReceived / totalQueueCalls) * 100) : 0,
            avgHandlingTimeSeconds: Math.round(Number(row.avg_handling_time || 0)),
            totalHandlingTimeSeconds: Math.round(Number(row.total_handling_time || 0)),
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
        -- REFACTORED: Count by unique call_history_id (aligned with KPIs)
        WITH unique_queue_calls AS (
            SELECT DISTINCT ON (call_history_id)
                call_history_id,
                cdr_id,
                DATE(cdr_started_at) as call_date
            FROM cdroutput
            WHERE destination_dn_number = ${queueNumber}
              AND destination_dn_type = 'queue'
              AND cdr_started_at >= ${startDate}
              AND cdr_started_at <= ${endDate}
            ORDER BY call_history_id, cdr_started_at ASC
        ),
        daily_stats AS (
            SELECT 
                uqc.call_date,
                COUNT(DISTINCT uqc.call_history_id) as received,
                COUNT(DISTINCT CASE WHEN c.cdr_answered_at IS NOT NULL 
                                    AND c.destination_dn_type = 'extension'
                               THEN uqc.call_history_id END) as answered,
                COUNT(DISTINCT CASE WHEN c.termination_reason_details = 'terminated_by_originator'
                                    AND c.cdr_answered_at IS NULL
                               THEN uqc.call_history_id END) as abandoned
            FROM unique_queue_calls uqc
            LEFT JOIN cdroutput c ON c.originating_cdr_id = uqc.cdr_id
            GROUP BY uqc.call_date
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
        -- REFACTORED: Count by unique call_history_id (aligned with KPIs)
        WITH unique_queue_calls AS (
            SELECT DISTINCT ON (call_history_id)
                call_history_id,
                cdr_id,
                EXTRACT(HOUR FROM cdr_started_at) as call_hour
            FROM cdroutput
            WHERE destination_dn_number = ${queueNumber}
              AND destination_dn_type = 'queue'
              AND cdr_started_at >= ${startDate}
              AND cdr_started_at <= ${endDate}
            ORDER BY call_history_id, cdr_started_at ASC
        ),
        hourly_stats AS (
            SELECT 
                uqc.call_hour,
                COUNT(DISTINCT uqc.call_history_id) as received,
                COUNT(DISTINCT CASE WHEN c.cdr_answered_at IS NOT NULL 
                                    AND c.destination_dn_type = 'extension'
                               THEN uqc.call_history_id END) as answered,
                COUNT(DISTINCT CASE WHEN c.termination_reason_details = 'terminated_by_originator'
                                    AND c.cdr_answered_at IS NULL
                               THEN uqc.call_history_id END) as abandoned
            FROM unique_queue_calls uqc
            LEFT JOIN cdroutput c ON c.originating_cdr_id = uqc.cdr_id
            GROUP BY uqc.call_hour
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
