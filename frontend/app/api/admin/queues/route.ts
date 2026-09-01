import { NextRequest, NextResponse } from "next/server";
import { getQueueChangeLog } from "@/services/queue-changelog.service";
import { requireApiRole } from "@/lib/auth-guard";
import { getDefaultServer, isValidServer } from "@/lib/servers";
import { ServerId } from "@/lib/prisma-cdr";
import { discoverQueues, listRegistryQueues, updateRegistryQueue, markQueuesReviewed } from "@/services/queue-registry.service";
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

        // Journal des changements : assemblé à part, il balaie les appels et
        // n'a pas à ralentir la liste du registre, consultée bien plus souvent.
        if (new URL(request.url).searchParams.get("view") === "changelog") {
            return NextResponse.json({ changements: await getQueueChangeLog(tenantId) });
        }

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
                agentCount: q.agentCount,
                isNew: q.reviewedAt === null,
                // Activité réelle (CDR), et non la date figée du registre.
                lastCallAt: q.lastCallAt,
                // Département 3CX déduit des CDR — null si jamais observé.
                department: q.department,
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
        const { id, entity, region, service, status } = body;

        if (!id || typeof id !== "string") {
            return NextResponse.json({ error: "ID de file requis" }, { status: 400 });
        }
        if (status !== undefined && !["ACTIVE", "ARCHIVED"].includes(status)) {
            return NextResponse.json({ error: "Statut invalide" }, { status: 400 });
        }

        const normalize = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

        // L'auteur du geste accompagne le changement de statut : « archivée le
        // 12 mars » vaut mieux seule que rien, mais « par qui » évite d'avoir
        // à le demander.
        const auteur = [guard.user.firstName, guard.user.lastName].filter(Boolean).join(" ")
            || guard.user.email
            || null;

        await updateRegistryQueue(id, {
            ...(entity !== undefined ? { entity: normalize(entity) } : {}),
            ...(region !== undefined ? { region: normalize(region) } : {}),
            ...(service !== undefined ? { service: normalize(service) } : {}),
            ...(status !== undefined ? { status } : {}),
        }, auteur);

        return NextResponse.json({ success: true });
    } catch (error) {
        logger.error("[admin/queues] PUT error:", error);
        return NextResponse.json({ error: "Erreur interne du serveur" }, { status: 500 });
    }
}
