import { NextRequest, NextResponse } from "next/server";
import { validateApiKey } from "../auth";
import { getPrismaCdr, ServerId } from "@/lib/prisma-cdr";
import { getDefaultServer, isValidServer } from "@/lib/servers";
import { parseDateParam } from "@/lib/date-params";
import { logger } from "@/lib/logger";
import { buildDirectSegmentWhereClause } from "@/services/domain/call-aggregation";

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
        logger.debug("[agents/route] Received queueNumber:", queueNumber);
        if (!queueNumber) {
            return NextResponse.json({ error: "queueNumber parameter is required" }, { status: 400 });
        }

        const start = parseDateParam(url.searchParams.get("start"), new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));
        const end = parseDateParam(url.searchParams.get("end"), new Date());
        logger.debug("[agents/route] Date range:", { start, end });

        // Requête paramétrée : $1 = queueNumber (texte), $2 = start, $3 = end (Date).
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
                  AND parent.destination_dn_number = $1
                  AND child.cdr_started_at >= $2
                  AND child.cdr_started_at <= $3
            ),
            all_queue_passages AS (
                SELECT DISTINCT c.cdr_id, c.call_history_id, c.originating_cdr_id
                FROM cdroutput c
                WHERE c.destination_dn_number = $1
                  AND c.destination_dn_type = 'queue'
                  AND c.cdr_started_at >= $2
                  AND c.cdr_started_at <= $3
            ),
            queue_passages_outcomes AS (
                SELECT
                    p.originating_cdr_id,
                    p.call_history_id,
                    p.destination_dn_number as agent_ext,
                    CASE WHEN p.cdr_answered_at IS NOT NULL THEN 1 ELSE 0 END as was_answered,
                    EXTRACT(EPOCH FROM (p.cdr_ended_at - p.cdr_answered_at)) as talk_seconds,
                    p.cdr_answered_at
                FROM cdroutput p
                JOIN all_queue_passages aqp ON aqp.cdr_id = p.originating_cdr_id
                WHERE p.creation_forward_reason = 'polling'
                  AND p.destination_dn_type = 'extension'
            ),
            last_answered_agent AS (
                SELECT DISTINCT ON (call_history_id)
                    call_history_id,
                    agent_ext as last_agent
                FROM queue_passages_outcomes
                WHERE was_answered = 1
                ORDER BY call_history_id, cdr_answered_at DESC
            ),
            agent_queue_stats AS (
                SELECT
                    qpo.agent_ext as extension,
                    COUNT(DISTINCT qpo.originating_cdr_id) as calls_received,
                    COUNT(DISTINCT CASE WHEN la.last_agent = qpo.agent_ext THEN qpo.call_history_id END) as resolved,
                    SUM(CASE WHEN qpo.was_answered = 1 THEN qpo.talk_seconds ELSE 0 END) as queue_talk_time
                FROM queue_passages_outcomes qpo
                LEFT JOIN last_answered_agent la ON qpo.call_history_id = la.call_history_id
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
                  AND c.cdr_started_at >= $2
                  AND c.cdr_started_at <= $3
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

        logger.debug("[agents/route] Executing query with queueNumber:", queueNumber);
        const rawResults = await prisma.$queryRawUnsafe(query, queueNumber, start, end);
        logger.debug("[agents/route] Query returned", (rawResults as any[]).length, "agents");

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

        logger.debug("[agents/route] Returning agents:", agents.map(a => a.extension));
        return NextResponse.json({ agents, queueNumber });
    } catch (error) {
        logger.error("[agents/route] Error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
