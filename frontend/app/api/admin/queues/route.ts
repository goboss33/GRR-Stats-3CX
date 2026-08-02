import { NextRequest, NextResponse } from "next/server";
import { requireApiRole } from "@/lib/auth-guard";
import { getDefaultServer, isValidServer } from "@/lib/servers";
import { ServerId } from "@/lib/prisma-cdr";
import { discoverQueues, listRegistryQueues, updateRegistryQueue, markQueuesReviewed } from "@/services/queue-registry.service";
import { invalidateStatsExclusions } from "@/lib/stats-exclusions";
import { logger } from "@/lib/logger";

// Registre des files : administration réservée à l'ADMIN (cf. PRD droits d'accès §4.1).

function resolveTenant(request: NextRequest): ServerId {
    const param = new URL(request.url).searchParams.get("server");
    return param && isValidServer(param) ? (param as ServerId) : getDefaultServer();
}

/** Liste le registre du tenant demandé. */
export async function GET(request: NextRequest) {
    const guard = await requireApiRole(["ADMIN"]);
    if (!guard.ok) return guard.response;

    try {
        const tenantId = resolveTenant(request);
        const queues = await listRegistryQueues(tenantId);
        return NextResponse.json({
            tenantId,
            queues: queues.map((q) => ({
                id: q.id,
                queueNumber: q.queueNumber,
                currentName: q.currentName,
                entity: q.entity,
                region: q.region,
                service: q.service,
                status: q.status,
                excludedFromStats: q.excludedFromStats,
                agentCount: q.agentCount,
                isNew: q.reviewedAt === null,
                // Activité réelle (CDR), et non la date figée du registre.
                lastCallAt: q.lastCallAt,
                agents: q.agents,
                firstSeenAt: q.firstSeenAt.toISOString(),
                lastSeenAt: q.lastSeenAt.toISOString(),
                previousNames: q.nameHistory.map((h) => h.name).filter((n) => n !== q.currentName),
            })),
        });
    } catch (error) {
        logger.error("[admin/queues] GET error:", error);
        return NextResponse.json({ error: "Erreur interne du serveur" }, { status: 500 });
    }
}

/**
 * `?action=review` marque les files comme examinées ; sinon déclenche la
 * découverte depuis les CDR.
 */
export async function POST(request: NextRequest) {
    const guard = await requireApiRole(["ADMIN"]);
    if (!guard.ok) return guard.response;

    try {
        const tenantId = resolveTenant(request);

        if (new URL(request.url).searchParams.get("action") === "review") {
            // Liste vide ou absente : on marque toutes les files du tenant.
            const body = await request.json().catch(() => ({}));
            const ids = Array.isArray(body?.ids) ? body.ids.filter((i: unknown) => typeof i === "string") : [];
            const count = await markQueuesReviewed(tenantId, ids);
            return NextResponse.json({ reviewed: count });
        }

        const result = await discoverQueues(tenantId);
        return NextResponse.json(result);
    } catch (error) {
        logger.error("[admin/queues] POST error:", error);
        return NextResponse.json({ error: "Erreur interne du serveur" }, { status: 500 });
    }
}

/** Met à jour les étiquettes / le statut d'une file. */
export async function PUT(request: NextRequest) {
    const guard = await requireApiRole(["ADMIN"]);
    if (!guard.ok) return guard.response;

    try {
        const body = await request.json();
        const { id, entity, region, service, status, excludedFromStats } = body;

        if (!id || typeof id !== "string") {
            return NextResponse.json({ error: "ID de file requis" }, { status: 400 });
        }
        if (status !== undefined && !["ACTIVE", "ARCHIVED"].includes(status)) {
            return NextResponse.json({ error: "Statut invalide" }, { status: 400 });
        }
        if (excludedFromStats !== undefined && typeof excludedFromStats !== "boolean") {
            return NextResponse.json({ error: "excludedFromStats doit être un booléen" }, { status: 400 });
        }

        const normalize = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

        await updateRegistryQueue(id, {
            ...(entity !== undefined ? { entity: normalize(entity) } : {}),
            ...(region !== undefined ? { region: normalize(region) } : {}),
            ...(service !== undefined ? { service: normalize(service) } : {}),
            ...(status !== undefined ? { status } : {}),
            ...(excludedFromStats !== undefined ? { excludedFromStats } : {}),
        });
        // L'effet doit être immédiat pour l'auteur du changement.
        if (excludedFromStats !== undefined) invalidateStatsExclusions();

        return NextResponse.json({ success: true });
    } catch (error) {
        logger.error("[admin/queues] PUT error:", error);
        return NextResponse.json({ error: "Erreur interne du serveur" }, { status: 500 });
    }
}
