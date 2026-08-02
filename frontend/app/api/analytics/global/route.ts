import { NextRequest, NextResponse } from "next/server";
import { validateApiKey } from "../auth";
import { ServerId } from "@/lib/prisma-cdr";
import { getDefaultServer, isValidServer } from "@/lib/servers";
import { parseDateParam } from "@/lib/date-params";
import { logger } from "@/lib/logger";
import { resolveApiKeyScope } from "@/lib/access-scope";
import { getGlobalMetricsRaw } from "@/services/repositories/cdr.repository";
import type { DashboardDirection } from "@/services/domain/call-aggregation";
import type { CallOrigin } from "@/services/domain/call-classification";

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
        const serverId: ServerId = serverParam && isValidServer(serverParam) 
            ? serverParam as ServerId 
            : getDefaultServer();
        
        const start = parseDateParam(url.searchParams.get("start"), new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));
        const end = parseDateParam(url.searchParams.get("end"), new Date());
        const includePrevious = url.searchParams.get("includePrevious") !== "false";

        const { prevStart, prevEnd } = computePreviousPeriod(start, end);

        // Direction (entrant / sortant) et provenance (interne / externe) :
        // mêmes filtres que le tableau de bord. Absents = toutes directions,
        // le comportement historique de l'API.
        const directionParam = url.searchParams.get("direction");
        const direction: DashboardDirection | undefined =
            directionParam === "inbound" || directionParam === "outbound" ? directionParam : undefined;
        const originParam = url.searchParams.get("origin");
        const origin: CallOrigin | undefined =
            originParam === "internal" || originParam === "external" || originParam === "both"
                ? originParam : undefined;

        // Portée héritée du propriétaire de la clé.
        const scope = await resolveApiKeyScope(authResult.apiKeyId, serverId);

        logger.debug("[global/route] Executing current period query:", { start, end });
        const current = await getGlobalMetricsRaw(serverId, start, end, scope, direction, origin);
        logger.debug("[global/route] Current period query completed");

        let previous = null;
        if (includePrevious) {
            logger.debug("[global/route] Executing previous period query:", { prevStart, prevEnd });
            const prevRow = await getGlobalMetricsRaw(serverId, prevStart, prevEnd, scope, direction, origin);
            logger.debug("[global/route] Previous period query completed");
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

        logger.debug("[global/route] Returning global stats:", {
            totalCalls: Number(current.total_calls),
            answeredCalls: Number(current.answered_calls),
            missedCalls: Number(current.missed_calls),
        });
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
        logger.error("[global/route] Error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
