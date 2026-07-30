import { NextRequest, NextResponse } from "next/server";
import { validateApiKey } from "../auth";
import { getPrismaCdr, ServerId } from "@/lib/prisma-cdr";
import { getDefaultServer, isValidServer } from "@/lib/servers";
import { parseDateParam } from "@/lib/date-params";
import { logger } from "@/lib/logger";
import { resolveApiKeyScope } from "@/lib/access-scope";
import {
    DEFAULT_CLASSIFICATION_RULES,
    buildTeamCTEChain,
} from "@/services/domain/call-classification";

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
        
        // La clé API hérite du périmètre de son propriétaire : sans cela, un
        // manager créerait une clé et lirait toutes les files via l'API.
        const scope = await resolveApiKeyScope(authResult.apiKeyId, serverId);

        const queueNumber = url.searchParams.get("queueNumber");
        logger.debug("[queue/route] Received queueNumber:", queueNumber);
        if (!queueNumber) {
            return NextResponse.json({ error: "queueNumber parameter is required" }, { status: 400 });
        }
        if (!scope.unrestricted && (scope.empty || !scope.queueNumbers?.includes(queueNumber))) {
            return NextResponse.json({ error: "Cette file d'attente n'est pas dans votre périmètre" }, { status: 403 });
        }

        const start = parseDateParam(url.searchParams.get("start"), new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));
        const end = parseDateParam(url.searchParams.get("end"), new Date());
        logger.debug("[queue/route] Date range:", { start, end });

        // Les KPIs et le filtre de parcours des logs consomment désormais LE MÊME
        // socle de classement (services/domain/call-classification.ts). C'est ce
        // qui garantit qu'un clic sur un KPI ramène exactement autant de lignes
        // que le chiffre affiché — auparavant les deux SQL divergeaient.
        const rules = DEFAULT_CLASSIFICATION_RULES;

        // Requête paramétrée : $1 = queueNumber (texte), $2 = start, $3 = end (Date).
        const query = `
            WITH ${buildTeamCTEChain(rules, { queueExpr: "$1", startExpr: "$2", endExpr: "$3" })},
            queue_kpis AS (
                SELECT
                    COUNT(*) as unique_calls,
                    COUNT(*) FILTER (WHERE outcome = 'answered') as unique_answered,
                    COUNT(*) FILTER (WHERE outcome = 'abandoned') as unique_abandoned,
                    COUNT(*) FILTER (WHERE outcome = 'short_abandon') as unique_short_abandon,
                    COUNT(*) FILTER (WHERE outcome = 'overflow') as unique_overflow,
                    COUNT(*) FILTER (WHERE outcome = 'voicemail') as unique_voicemail,
                    ROUND(AVG(answer_wait_seconds)::numeric, 1) as avg_wait_time,
                    ROUND(AVG(talk_seconds) FILTER (WHERE outcome = 'answered')::numeric, 1) as avg_talk_time
                FROM queue_calls
            ),
            passage_count AS (SELECT COUNT(*) as n FROM queue_passages),
            direct_calls_stats AS (
                SELECT
                    COUNT(*) as direct_received,
                    COUNT(*) FILTER (WHERE answered) as direct_answered
                FROM direct_calls
            ),
            overflow_destinations AS (
                SELECT
                    other_q.destination_dn_number as destination,
                    COALESCE(other_q.destination_dn_name, other_q.destination_dn_number) as destination_name,
                    COUNT(DISTINCT qc.call_history_id) as count
                FROM queue_calls qc
                JOIN cdroutput other_q ON other_q.call_history_id = qc.call_history_id
                    AND other_q.destination_dn_type = 'queue'
                    AND other_q.destination_dn_number != $1
                WHERE qc.outcome = 'overflow'
                GROUP BY other_q.destination_dn_number, other_q.destination_dn_name
                ORDER BY count DESC
                LIMIT 10
            ),
            queue_name AS (
                SELECT COALESCE(destination_dn_name, destination_dn_number) as name
                FROM cdroutput
                WHERE destination_dn_number = $1 AND destination_dn_type = 'queue'
                LIMIT 1
            )
            SELECT
                qn.name as queue_name,
                qk.unique_calls,
                qk.unique_answered,
                qk.unique_abandoned,
                qk.unique_short_abandon,
                qk.unique_overflow,
                qk.unique_voicemail,
                pc.n as total_passages,
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
            CROSS JOIN passage_count pc
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
            // « Perdus » n'inclut plus les abandons courts ni les messageries :
            // ce sont désormais des catégories distinctes, mutuellement
            // exclusives, dont la somme avec les autres redonne le total.
            callsAbandoned: Number(row.unique_abandoned),
            callsShortAbandon: Number(row.unique_short_abandon),
            callsToVoicemail: Number(row.unique_voicemail),
            abandonedBefore10s: Number(row.unique_short_abandon),
            abandonedAfter10s: Number(row.unique_abandoned),
            callsOverflow: Number(row.unique_overflow),
            classificationRules: rules,
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
