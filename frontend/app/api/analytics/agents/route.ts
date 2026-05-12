import { NextRequest, NextResponse } from "next/server";
import { validateApiKey } from "../auth";
import { prisma } from "@/lib/prisma";
import { buildDirectSegmentWhereClause } from "@/services/domain/call-aggregation";

function parseDateParam(param: string | null, defaultDate: Date): Date {
    if (!param) return defaultDate;
    const parsed = new Date(param);
    return isNaN(parsed.getTime()) ? defaultDate : parsed;
}

export async function GET(request: NextRequest) {
    const authResult = await validateApiKey(request);
    if (!authResult.valid) return authResult.response;

    try {
        const url = new URL(request.url);
        const queueNumber = url.searchParams.get("queueNumber");
        if (!queueNumber) {
            return NextResponse.json({ error: "queueNumber parameter is required" }, { status: 400 });
        }

        const start = parseDateParam(url.searchParams.get("start"), new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));
        const end = parseDateParam(url.searchParams.get("end"), new Date());
        const qn = queueNumber.replace(/'/g, "''");

        const query = `
            WITH queue_agents AS (
                SELECT DISTINCT
                    child.destination_dn_number as extension,
                    COALESCE(child.destination_dn_name, child.destination_participant_name, child.destination_dn_number) as name
                FROM cdroutput child
                JOIN cdroutput parent ON child.originating_cdr_id = parent.cdr_id
                WHERE child.creation_method = 'route_to'
                  AND child.creation_forward_reason = 'polling'
                  AND parent.destination_dn_type = 'queue'
                  AND parent.destination_dn_number = '${qn}'
                  AND child.cdr_started_at >= '${start.toISOString()}'
                  AND child.cdr_started_at <= '${end.toISOString()}'
            ),
            all_queue_passages AS (
                SELECT DISTINCT c.cdr_id, c.call_history_id, c.originating_cdr_id
                FROM cdroutput c
                WHERE c.destination_dn_number = '${qn}'
                  AND c.destination_dn_type = 'queue'
                  AND c.cdr_started_at >= '${start.toISOString()}'
                  AND c.cdr_started_at <= '${end.toISOString()}'
            ),
            queue_passages_outcomes AS (
                SELECT
                    p.originating_cdr_id,
                    p.destination_dn_number as agent_ext,
                    CASE WHEN p.cdr_answered_at IS NOT NULL THEN 1 ELSE 0 END as was_answered,
                    EXTRACT(EPOCH FROM (p.cdr_ended_at - p.cdr_answered_at)) as talk_seconds
                FROM cdroutput p
                WHERE p.call_history_id IN (SELECT call_history_id FROM all_queue_passages)
                  AND p.creation_forward_reason = 'polling'
                  AND p.destination_dn_type = 'extension'
            ),
            agent_queue_stats AS (
                SELECT
                    qpo.agent_ext as extension,
                    COUNT(DISTINCT qpo.originating_cdr_id) as calls_received,
                    SUM(qpo.was_answered) as resolved,
                    SUM(CASE WHEN qpo.was_answered = 1 THEN qpo.talk_seconds ELSE 0 END) as queue_talk_time
                FROM queue_passages_outcomes qpo
                WHERE qpo.agent_ext IN (SELECT extension FROM queue_agents)
                GROUP BY qpo.agent_ext
            ),
            direct_calls AS (
                SELECT
                    c.destination_dn_number as extension,
                    COUNT(DISTINCT c.call_history_id) as direct_received,
                    COUNT(DISTINCT CASE WHEN c.cdr_answered_at IS NOT NULL THEN c.call_history_id END) as direct_answered,
                    SUM(CASE WHEN c.cdr_answered_at IS NOT NULL
                        THEN EXTRACT(EPOCH FROM (c.cdr_ended_at - c.cdr_answered_at)) ELSE 0 END) as direct_talk_time
                FROM cdroutput c
                WHERE ${buildDirectSegmentWhereClause('c', { excludeQueueOriginated: true, queuePassagesCTEName: 'all_queue_passages' })}
                  AND c.destination_dn_number IN (SELECT extension FROM queue_agents)
                  AND c.cdr_started_at >= '${start.toISOString()}'
                  AND c.cdr_started_at <= '${end.toISOString()}'
                GROUP BY c.destination_dn_number
            ),
            agent_names AS (
                SELECT DISTINCT ON (destination_dn_number)
                    destination_dn_number as extension,
                    COALESCE(destination_dn_name, destination_participant_name, destination_dn_number) as name
                FROM cdroutput
                WHERE destination_dn_type = 'extension'
                  AND destination_dn_number IN (SELECT extension FROM queue_agents)
                ORDER BY destination_dn_number, cdr_started_at DESC
            )
            SELECT
                qa.extension,
                COALESCE(an.name, qa.name) as name,
                COALESCE(aqs.calls_received, 0) as calls_received,
                COALESCE(aqs.resolved, 0) as resolved,
                COALESCE(aqs.queue_talk_time, 0) as queue_talk_time,
                COALESCE(dc.direct_received, 0) as direct_received,
                COALESCE(dc.direct_answered, 0) as direct_answered,
                COALESCE(dc.direct_talk_time, 0) as direct_talk_time
            FROM queue_agents qa
            LEFT JOIN agent_names an ON qa.extension = an.extension
            LEFT JOIN agent_queue_stats aqs ON qa.extension = aqs.extension
            LEFT JOIN direct_calls dc ON qa.extension = dc.extension
            ORDER BY qa.extension
        `;

        const rawResults = await prisma.$queryRawUnsafe(query);

        const agents = (rawResults as any[]).map((row) => ({
            extension: row.extension,
            name: row.name,
            callsReceived: Number(row.calls_received),
            answered: Number(row.resolved),
            queueTalkTimeSeconds: Math.round(Number(row.queue_talk_time)),
            directReceived: Number(row.direct_received),
            directAnswered: Number(row.direct_answered),
            directTalkTimeSeconds: Math.round(Number(row.direct_talk_time)),
        }));

        return NextResponse.json({ agents, queueNumber });
    } catch (error) {
        console.error("Error in /api/analytics/agents:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
