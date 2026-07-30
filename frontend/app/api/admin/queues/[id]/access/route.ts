import { NextRequest, NextResponse } from "next/server";
import { requireApiRole } from "@/lib/auth-guard";
import { listQueueAccess, grantQueueAccess, revokeQueueAccess } from "@/services/user-access.service";
import { logger } from "@/lib/logger";

// Gestion des accès à une file, vue « depuis la file ». ADMIN uniquement.

/** Utilisateurs ayant accès à cette file + ceux qui peuvent y être ajoutés. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const guard = await requireApiRole(["ADMIN"]);
    if (!guard.ok) return guard.response;

    try {
        const { id } = await params;
        return NextResponse.json(await listQueueAccess(id));
    } catch (error) {
        logger.error("[admin/queues/:id/access] GET error:", error);
        return NextResponse.json({ error: "Erreur interne du serveur" }, { status: 500 });
    }
}

/** Ajoute la file au périmètre d'un utilisateur. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const guard = await requireApiRole(["ADMIN"]);
    if (!guard.ok) return guard.response;

    try {
        const { id } = await params;
        const { userId } = await request.json();
        if (!userId || typeof userId !== "string") {
            return NextResponse.json({ error: "Utilisateur requis" }, { status: 400 });
        }

        await grantQueueAccess(userId, id);
        return NextResponse.json({ success: true });
    } catch (error) {
        logger.error("[admin/queues/:id/access] POST error:", error);
        const message = error instanceof Error && error.message === "File introuvable" ? error.message : "Erreur interne du serveur";
        return NextResponse.json({ error: message }, { status: message === "File introuvable" ? 404 : 500 });
    }
}

/** Retire la file du périmètre d'un utilisateur. */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const guard = await requireApiRole(["ADMIN"]);
    if (!guard.ok) return guard.response;

    try {
        const { id } = await params;
        const userId = new URL(request.url).searchParams.get("userId");
        if (!userId) return NextResponse.json({ error: "Utilisateur requis" }, { status: 400 });

        await revokeQueueAccess(userId, id);
        return NextResponse.json({ success: true });
    } catch (error) {
        logger.error("[admin/queues/:id/access] DELETE error:", error);
        return NextResponse.json({ error: "Erreur interne du serveur" }, { status: 500 });
    }
}
