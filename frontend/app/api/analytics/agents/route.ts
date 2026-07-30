import { NextRequest, NextResponse } from "next/server";
import { validateApiKey } from "../auth";
import { getPrismaCdr, ServerId } from "@/lib/prisma-cdr";
import { getDefaultServer, isValidServer } from "@/lib/servers";
import { parseDateParam } from "@/lib/date-params";
import { logger } from "@/lib/logger";
import { resolveApiKeyScope, isQueueInScope } from "@/lib/access-scope";
import {
    buildTeamCTEChain,
    buildAgentCTEChain,
} from "@/services/domain/call-classification";
import { getClassificationRules } from "@/lib/classification-rules";

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

        // Même règle que pour les files : la clé n'ouvre que le périmètre de son
        // propriétaire.
        const scope = await resolveApiKeyScope(authResult.apiKeyId, serverId);
        if (!isQueueInScope(scope, queueNumber)) {
            return NextResponse.json({ error: "Cette file d'attente n'est pas dans votre périmètre" }, { status: 403 });
        }

        const start = parseDateParam(url.searchParams.get("start"), new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));
        const end = parseDateParam(url.searchParams.get("end"), new Date());
        logger.debug("[agents/route] Date range:", { start, end });

        // Le tableau par agent lit LA MÊME partition que les vignettes du bilan
        // d'équipe (socle de classement) : sans cela, un appel exclu du bloc
        // « file » par la règle du premier contact resterait compté ici.
        const rules = await getClassificationRules();

        // Requête paramétrée : $1 = queueNumber (texte), $2 = start, $3 = end (Date).
        const query = `
            WITH ${buildTeamCTEChain(rules, { queueExpr: "$1", startExpr: "$2", endExpr: "$3" })},
            agent_names AS (
                SELECT DISTINCT ON (destination_dn_number)
                    destination_dn_number as extension,
                    COALESCE(destination_dn_name, destination_participant_name, destination_dn_number) as name
                FROM cdroutput
                WHERE destination_dn_type = 'extension'
                  AND destination_dn_number IN (SELECT extension FROM queue_agents)
                ORDER BY destination_dn_number, cdr_started_at DESC
            ),
            ${buildAgentCTEChain(rules)}
            SELECT
                qa.extension,
                COALESCE(an.name, qa.extension) as name,
                COALESCE(aqs.calls_received, 0) as calls_received,
                COALESCE(aqs.resolved, 0) as resolved,
                COALESCE(aqs.queue_talk_time, 0) as queue_talk_time,
                COALESCE(ad.direct_received, 0) as direct_received,
                COALESCE(ad.direct_answered, 0) as direct_answered,
                COALESCE(ad.direct_talk_time, 0) as direct_talk_time
            FROM queue_agents qa
            LEFT JOIN agent_names an ON qa.extension = an.extension
            LEFT JOIN agent_queue_stats aqs ON qa.extension = aqs.extension
            LEFT JOIN agent_direct ad ON qa.extension = ad.extension
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
