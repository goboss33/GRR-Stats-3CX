import { NextRequest, NextResponse } from "next/server";
import { validateApiKey } from "../auth";
import { getPrismaCdr, ServerId } from "@/lib/prisma-cdr";
import { getDefaultServer, isValidServer } from "@/lib/servers";
import { parseDateParam } from "@/lib/date-params";
import { logger } from "@/lib/logger";

export async function GET(request: NextRequest) {
    const authResult = await validateApiKey(request);
    if (!authResult.valid) return authResult.response;

    try {
        const url = new URL(request.url);
        const serverParam = url.searchParams.get("server");
        const serverId: ServerId = serverParam && isValidServer(serverParam) 
            ? serverParam as ServerId 
            : getDefaultServer();
        
        const prisma = getPrismaCdr(serverId);
        
        const queueNumber = url.searchParams.get("queueNumber");
        logger.debug("[queue/route] Received queueNumber:", queueNumber);
        if (!queueNumber) {
            return NextResponse.json({ error: "queueNumber parameter is required" }, { status: 400 });
        }

        const start = parseDateParam(url.searchParams.get("start"), new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));
        const end = parseDateParam(url.searchParams.get("end"), new Date());
        logger.debug("[queue/route] Date range:", { start, end });

        // Requête paramétrée : $1 = queueNumber (texte), $2 = start, $3 = end (Date).
        const query = `
            WITH all_queue_passages AS (
                SELECT
                    c.call_history_id,
                    c.cdr_id,
                    c.originating_cdr_id,
                    c.cdr_started_at
                FROM cdroutput c
                WHERE c.destination_dn_number = $1
                  AND c.destination_dn_type = 'queue'
                  AND c.cdr_started_at >= $2
                  AND c.cdr_started_at <= $3
            ),
            unique_calls AS (
                SELECT DISTINCT ON (call_history_id)
                    call_history_id, cdr_id, cdr_started_at
                FROM all_queue_passages
                ORDER BY call_history_id, cdr_started_at ASC
            ),
            passage_outcomes AS (
                SELECT
                    aqp.call_history_id,
                    aqp.cdr_id,
                    aqp.cdr_started_at,
                    bool_or(p.cdr_answered_at IS NOT NULL AND p.destination_dn_type = 'extension') as was_answered,
                    bool_or(other_q.destination_dn_type = 'queue'
                            AND other_q.destination_dn_number != $1
                            AND other_q.cdr_started_at > aqp.cdr_started_at) as overflowed,
                    MAX(CASE WHEN p.cdr_answered_at IS NOT NULL AND p.destination_dn_type = 'extension'
                        THEN EXTRACT(EPOCH FROM (p.cdr_ended_at - p.cdr_answered_at)) ELSE NULL END) as talk_time,
                    MIN(CASE WHEN p.cdr_answered_at IS NOT NULL AND p.destination_dn_type = 'extension'
                        THEN EXTRACT(EPOCH FROM (p.cdr_answered_at - aqp.cdr_started_at)) ELSE NULL END) as wait_time
                FROM all_queue_passages aqp
                LEFT JOIN cdroutput p ON p.originating_cdr_id = aqp.cdr_id
                    AND p.creation_forward_reason = 'polling'
                LEFT JOIN cdroutput other_q ON other_q.call_history_id = aqp.call_history_id
                    AND other_q.destination_dn_type = 'queue'
                    AND other_q.destination_dn_number != $1
                    AND other_q.cdr_started_at > aqp.cdr_started_at
                GROUP BY aqp.call_history_id, aqp.cdr_id, aqp.cdr_started_at
            ),
            call_outcomes AS (
                SELECT
                    call_history_id,
                    CASE WHEN bool_or(was_answered) THEN 'answered'
                         WHEN bool_or(overflowed) AND NOT bool_or(was_answered) THEN 'overflow'
                         ELSE 'abandoned' END as outcome,
                    MAX(talk_time) as talk_time,
                    MIN(wait_time) as wait_time
                FROM passage_outcomes
                GROUP BY call_history_id
            ),
            abandoned_timing AS (
                SELECT DISTINCT ON (po.call_history_id)
                    po.call_history_id,
                    EXTRACT(EPOCH FROM (po.cdr_started_at - (
                        SELECT MIN(c2.cdr_started_at) FROM cdroutput c2
                        WHERE c2.call_history_id = po.call_history_id
                    ))) as time_in_queue
                FROM passage_outcomes po
                JOIN call_outcomes co ON co.call_history_id = po.call_history_id AND co.outcome = 'abandoned'
                ORDER BY po.call_history_id, po.cdr_started_at ASC
            ),
            queue_kpis AS (
                SELECT
                    COUNT(DISTINCT uc.call_history_id) as unique_calls,
                    COUNT(DISTINCT CASE WHEN co.outcome = 'answered' THEN uc.call_history_id END) as unique_answered,
                    COUNT(DISTINCT CASE WHEN co.outcome = 'abandoned' THEN uc.call_history_id END) as unique_abandoned,
                    COUNT(DISTINCT CASE WHEN co.outcome = 'abandoned' AND at.time_in_queue < 10 THEN uc.call_history_id END) as unique_abandoned_before_10s,
                    COUNT(DISTINCT CASE WHEN co.outcome = 'abandoned' AND at.time_in_queue >= 10 THEN uc.call_history_id END) as unique_abandoned_after_10s,
                    COUNT(DISTINCT CASE WHEN co.outcome = 'overflow' THEN uc.call_history_id END) as unique_overflow,
                    (SELECT COUNT(*) FROM all_queue_passages) as total_passages,
                    ROUND(AVG(co.wait_time)::numeric, 1) as avg_wait_time,
                    ROUND(AVG(co.talk_time) FILTER (WHERE co.outcome = 'answered')::numeric, 1) as avg_talk_time
                FROM unique_calls uc
                JOIN call_outcomes co ON co.call_history_id = uc.call_history_id
                LEFT JOIN abandoned_timing at ON at.call_history_id = uc.call_history_id
            ),
            overflow_destinations AS (
                SELECT
                    other_q.destination_dn_number as destination,
                    COALESCE(other_q.destination_dn_name, other_q.destination_dn_number) as destination_name,
                    COUNT(DISTINCT co.call_history_id) as count
                FROM call_outcomes co
                JOIN cdroutput other_q ON other_q.call_history_id = co.call_history_id
                    AND other_q.destination_dn_type = 'queue'
                    AND other_q.destination_dn_number != $1
                WHERE co.outcome = 'overflow'
                GROUP BY other_q.destination_dn_number, other_q.destination_dn_name
                ORDER BY count DESC
                LIMIT 10
            ),
            queue_name AS (
                SELECT COALESCE(destination_dn_name, destination_dn_number) as name
                FROM cdroutput
                WHERE destination_dn_number = $1 AND destination_dn_type = 'queue'
                LIMIT 1
            ),
            queue_agents AS (
                SELECT DISTINCT child.destination_dn_number as extension
                FROM cdroutput child
                JOIN cdroutput parent ON child.originating_cdr_id = parent.cdr_id
                WHERE child.creation_method = 'route_to'
                  AND child.creation_forward_reason = 'polling'
                  AND parent.destination_dn_type = 'queue'
                  AND parent.destination_dn_number = $1
                  AND child.cdr_started_at >= $2
                  AND child.cdr_started_at <= $3
            ),
            direct_calls_stats AS (
                SELECT
                    COUNT(DISTINCT c.call_history_id) as direct_received,
                    COUNT(DISTINCT CASE WHEN c.cdr_answered_at IS NOT NULL THEN c.call_history_id END) as direct_answered
                FROM cdroutput c
                WHERE c.destination_dn_type = 'extension'
                  AND COALESCE(c.destination_entity_type, '') != 'voicemail'
                  AND c.creation_forward_reason IS DISTINCT FROM 'polling'
                  AND (c.creation_forward_reason = 'by_did' OR NOT (c.cdr_answered_at IS NULL AND EXTRACT(EPOCH FROM (c.cdr_ended_at - c.cdr_started_at)) < 1))
                  AND c.destination_dn_number IN (SELECT extension FROM queue_agents)
                  AND c.cdr_started_at >= $2
                  AND c.cdr_started_at <= $3
                  AND NOT EXISTS (
                      SELECT 1 FROM all_queue_passages aqp WHERE aqp.call_history_id = c.call_history_id
                  )
            )
            SELECT
                qn.name as queue_name,
                qk.unique_calls,
                qk.unique_answered,
                qk.unique_abandoned,
                qk.unique_abandoned_before_10s,
                qk.unique_abandoned_after_10s,
                qk.unique_overflow,
                qk.total_passages,
                qk.avg_wait_time,
                qk.avg_talk_time,
                COALESCE(dcs.direct_received, 0) as direct_received,
                COALESCE(dcs.direct_answered, 0) as direct_answered,
                COALESCE(
                    (SELECT json_agg(json_build_object('destination', od.destination, 'destinationName', od.destination_name, 'count', od.count))
                     FROM overflow_destinations od),
                    '[]'
                ) as overflow_destinations
            FROM queue_kpis qk
            CROSS JOIN queue_name qn
            CROSS JOIN direct_calls_stats dcs
        `;

        logger.debug("[queue/route] Executing query with queueNumber:", queueNumber);
        const rawResults = await prisma.$queryRawUnsafe(query, queueNumber, start, end);
        logger.debug("[queue/route] Query returned results");
        const row = (rawResults as any[])[0];

        if (!row) {
            return NextResponse.json({ error: "No data found for this queue" }, { status: 404 });
        }

        const totalPassages = Number(row.total_passages);
        const uniqueCalls = Number(row.unique_calls);
        const pingPongCount = totalPassages - uniqueCalls;
        const pingPongPercentage = totalPassages > 0 ? (pingPongCount / totalPassages) * 100 : 0;

        logger.debug("[queue/route] Returning queue stats:", {
            queueNumber,
            queueName: row.queue_name,
            callsReceived: uniqueCalls,
            callsAnswered: Number(row.unique_answered),
        });
        return NextResponse.json({
            queueNumber,
            queueName: row.queue_name,
            callsReceived: uniqueCalls,
            callsAnswered: Number(row.unique_answered),
            callsAbandoned: Number(row.unique_abandoned),
            abandonedBefore10s: Number(row.unique_abandoned_before_10s),
            abandonedAfter10s: Number(row.unique_abandoned_after_10s),
            callsOverflow: Number(row.unique_overflow),
            totalPassages,
            pingPongCount,
            pingPongPercentage: Math.round(pingPongPercentage * 10) / 10,
            avgWaitTimeSeconds: Number(row.avg_wait_time) || 0,
            avgTalkTimeSeconds: Number(row.avg_talk_time) || 0,
            directReceived: Number(row.direct_received),
            directAnswered: Number(row.direct_answered),
            directLost: Number(row.direct_received) - Number(row.direct_answered),
            overflowDestinations: typeof row.overflow_destinations === 'string'
                ? JSON.parse(row.overflow_destinations)
                : row.overflow_destinations,
        });
    } catch (error) {
        logger.error("[queue/route] Error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
