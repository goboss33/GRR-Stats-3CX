import { NextRequest, NextResponse } from "next/server";
import { validateApiKey } from "@/app/api/analytics/auth";
import { getPrismaCdr, ServerId } from "@/lib/prisma-cdr";
import { isValidServer } from "@/lib/servers";
import {
    SQL_SYSTEM_DEST_TYPES,
    SQL_SYSTEM_ENTITY_TYPES,
} from "@/services/domain/call-aggregation";

function parseDateParam(param: string | null, defaultDate: Date): Date {
    if (!param) return defaultDate;
    const parsed = new Date(param);
    return isNaN(parsed.getTime()) ? defaultDate : parsed;
}

function computePreviousPeriod(startDate: Date, endDate: Date): { prevStart: Date; prevEnd: Date } {
    const durationMs = endDate.getTime() - startDate.getTime();
    const prevEnd = new Date(startDate.getTime() - 1);
    const prevStart = new Date(prevEnd.getTime() - durationMs);
    return { prevStart, prevEnd };
}

export async function GET(request: NextRequest) {
    const authResult = await validateApiKey(request);
    if (!authResult.valid) return authResult.response;

    try {
        const url = new URL(request.url);
        const serverParam = url.searchParams.get("server");
        
        if (!serverParam || !isValidServer(serverParam)) {
            return NextResponse.json(
                { error: "Invalid or missing 'server' parameter" },
                { status: 400 }
            );
        }

        const serverId = serverParam as ServerId;
        const prisma = getPrismaCdr(serverId);

        const start = parseDateParam(url.searchParams.get("start"), new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));
        const end = parseDateParam(url.searchParams.get("end"), new Date());
        const includePrevious = url.searchParams.get("includePrevious") !== "false";

        const { prevStart, prevEnd } = computePreviousPeriod(start, end);

        const buildMetricsQuery = (startDate: Date, endDate: Date) => `
            WITH call_aggregates AS (
                SELECT
                    call_history_id,
                    COUNT(*) as segment_count,
                    MIN(cdr_started_at) as first_started_at,
                    MAX(cdr_ended_at) as last_ended_at,
                    MIN(cdr_answered_at) as first_answered_at
                FROM cdroutput
                WHERE cdr_started_at >= '${startDate.toISOString()}'
                  AND cdr_started_at <= '${endDate.toISOString()}'
                GROUP BY call_history_id
            ),
            last_segments AS (
                SELECT DISTINCT ON (call_history_id)
                    call_history_id,
                    destination_dn_type as last_dest_type,
                    destination_entity_type as last_dest_entity_type,
                    cdr_answered_at,
                    cdr_started_at as last_started_at,
                    cdr_ended_at as last_ended_at,
                    termination_reason_details
                FROM cdroutput
                WHERE cdr_started_at >= '${startDate.toISOString()}'
                  AND cdr_started_at <= '${endDate.toISOString()}'
                ORDER BY call_history_id, cdr_ended_at DESC, cdr_started_at DESC, cdr_id DESC
            ),
            answered_segments AS (
                SELECT DISTINCT ON (c.call_history_id)
                    c.call_history_id,
                    c.cdr_answered_at as answered_at
                FROM cdroutput c
                WHERE c.cdr_answered_at IS NOT NULL
                  AND c.destination_dn_type = 'extension'
                  AND c.cdr_started_at >= '${startDate.toISOString()}'
                  AND c.cdr_started_at <= '${endDate.toISOString()}'
                ORDER BY c.call_history_id, c.cdr_answered_at ASC, c.cdr_id ASC
            ),
            call_outcomes AS (
                SELECT
                    ca.call_history_id,
                    CASE
                        WHEN ls.last_dest_type IN ('vmail_console', 'voicemail') OR ls.last_dest_entity_type = 'voicemail' THEN 'voicemail'
                        WHEN ls.termination_reason_details ILIKE '%busy%' THEN 'busy'
                        WHEN ls.cdr_answered_at IS NOT NULL
                             AND EXTRACT(EPOCH FROM (ls.last_ended_at - ls.last_started_at)) > 1
                             AND (
                                 (ls.last_dest_type IN (${SQL_SYSTEM_DEST_TYPES}) OR ls.last_dest_entity_type IN (${SQL_SYSTEM_ENTITY_TYPES}))
                                 AND ans.answered_at IS NOT NULL
                                 OR
                                 (ls.last_dest_type NOT IN (${SQL_SYSTEM_DEST_TYPES}) AND ls.last_dest_entity_type NOT IN (${SQL_SYSTEM_ENTITY_TYPES}))
                             )
                        THEN 'answered'
                        ELSE 'missed'
                    END as status
                FROM call_aggregates ca
                JOIN last_segments ls ON ca.call_history_id = ls.call_history_id
                LEFT JOIN answered_segments ans ON ca.call_history_id = ans.call_history_id
            ),
            answered_calls_data AS (
                SELECT
                    ca.call_history_id,
                    EXTRACT(EPOCH FROM (ls.last_ended_at - ls.cdr_answered_at)) as talk_duration,
                    EXTRACT(EPOCH FROM (COALESCE(ans.answered_at, ca.first_answered_at) - ca.first_started_at)) as wait_time,
                    (SELECT COUNT(DISTINCT c2.destination_dn_number)
                     FROM cdroutput c2
                     WHERE c2.call_history_id = ca.call_history_id
                       AND c2.cdr_answered_at IS NOT NULL
                       AND c2.destination_dn_type = 'extension'
                    ) as agent_count
                FROM call_aggregates ca
                JOIN last_segments ls ON ca.call_history_id = ls.call_history_id
                LEFT JOIN answered_segments ans ON ca.call_history_id = ans.call_history_id
                WHERE ls.cdr_answered_at IS NOT NULL
            )
            SELECT
                COUNT(*) as total_calls,
                COUNT(*) FILTER (WHERE co.status = 'answered') as answered_calls,
                COUNT(*) FILTER (WHERE co.status = 'missed') as missed_calls,
                COUNT(*) FILTER (WHERE co.status = 'voicemail') as voicemail_calls,
                COUNT(*) FILTER (WHERE co.status = 'busy') as busy_calls,
                ROUND(AVG(acd.talk_duration)::numeric, 1) as avg_human_duration,
                ROUND(AVG(acd.wait_time)::numeric, 1) as avg_wait_time,
                ROUND(AVG(acd.agent_count)::numeric, 2) as avg_agents_per_call,
                COUNT(*) FILTER (WHERE acd.agent_count = 1) as agents_1,
                COUNT(*) FILTER (WHERE acd.agent_count = 2) as agents_2,
                COUNT(*) FILTER (WHERE acd.agent_count >= 3) as agents_3_plus
            FROM call_aggregates ca
            JOIN call_outcomes co ON ca.call_history_id = co.call_history_id
            LEFT JOIN answered_calls_data acd ON ca.call_history_id = acd.call_history_id
        `;

        const currentResult = await prisma.$queryRawUnsafe(buildMetricsQuery(start, end));
        const current = (currentResult as any[])[0];

        let previous = null;
        if (includePrevious) {
            const prevResult = await prisma.$queryRawUnsafe(buildMetricsQuery(prevStart, prevEnd));
            const prevRow = (prevResult as any[])[0];
            previous = {
                totalCalls: Number(prevRow.total_calls),
                answeredCalls: Number(prevRow.answered_calls),
                missedCalls: Number(prevRow.missed_calls),
                voicemailCalls: Number(prevRow.voicemail_calls),
                busyCalls: Number(prevRow.busy_calls),
                avgDurationSeconds: Number(prevRow.avg_human_duration) || 0,
                avgWaitTimeSeconds: Number(prevRow.avg_wait_time) || 0,
                avgAgentsPerCall: Number(prevRow.avg_agents_per_call) || 0,
                agentsDistribution: {
                    agents1: Number(prevRow.agents_1),
                    agents2: Number(prevRow.agents_2),
                    agents3Plus: Number(prevRow.agents_3_plus),
                },
            };
        }

        return NextResponse.json({
            totalCalls: Number(current.total_calls),
            answeredCalls: Number(current.answered_calls),
            missedCalls: Number(current.missed_calls),
            voicemailCalls: Number(current.voicemail_calls),
            busyCalls: Number(current.busy_calls),
            avgDurationSeconds: Number(current.avg_human_duration) || 0,
            avgWaitTimeSeconds: Number(current.avg_wait_time) || 0,
            avgAgentsPerCall: Number(current.avg_agents_per_call) || 0,
            agentsDistribution: {
                agents1: Number(current.agents_1),
                agents2: Number(current.agents_2),
                agents3Plus: Number(current.agents_3_plus),
            },
            previousPeriod: previous,
        });
    } catch (error) {
        console.error("[v2/global/route] Error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
