import { NextRequest, NextResponse } from "next/server";
import { requireApiRole } from "@/lib/auth-guard";
import { getDefaultServer, isValidServer } from "@/lib/servers";
import { ServerId } from "@/lib/prisma-cdr";
import { getQueueDetail } from "@/services/queue-registry.service";
import { logger } from "@/lib/logger";

/** Détail d'une file du registre (agents, historique des noms). ADMIN uniquement. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const guard = await requireApiRole(["ADMIN"]);
    if (!guard.ok) return guard.response;

    try {
        const { id } = await params;
        const param = new URL(request.url).searchParams.get("server");
        const tenantId: ServerId = param && isValidServer(param) ? (param as ServerId) : getDefaultServer();

        const detail = await getQueueDetail(tenantId, id);
        if (!detail) return NextResponse.json({ error: "File introuvable" }, { status: 404 });

        return NextResponse.json({ queue: detail });
    } catch (error) {
        logger.error("[admin/queues/:id] GET error:", error);
        return NextResponse.json({ error: "Erreur interne du serveur" }, { status: 500 });
    }
}
