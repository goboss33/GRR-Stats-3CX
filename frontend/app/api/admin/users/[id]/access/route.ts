import { NextRequest, NextResponse } from "next/server";
import { requireApiRole } from "@/lib/auth-guard";
import { getUserAccess, setUserAccess, describeUserScope, type UserAccessPayload } from "@/services/user-access.service";
import { logger } from "@/lib/logger";

// Administration des accès d'un utilisateur : ADMIN uniquement
// (cf. PRD droits d'accès §4.1 — seul l'IT accorde tenants et périmètres).

/**
 * Accès configurés de l'utilisateur.
 * `?describe=1` renvoie en plus la portée effective (écran « qui voit quoi »).
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const guard = await requireApiRole(["ADMIN"]);
    if (!guard.ok) return guard.response;

    try {
        const { id } = await params;
        const wantsDescription = new URL(request.url).searchParams.get("describe") === "1";

        const access = await getUserAccess(id);
        if (!wantsDescription) return NextResponse.json({ access });

        const scope = await describeUserScope(id);
        return NextResponse.json({ access, scope });
    } catch (error) {
        logger.error("[admin/users/access] GET error:", error);
        const message = error instanceof Error && error.message === "Utilisateur introuvable" ? error.message : "Erreur interne du serveur";
        return NextResponse.json({ error: message }, { status: message === "Utilisateur introuvable" ? 404 : 500 });
    }
}

/** Remplace les accès de l'utilisateur. */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const guard = await requireApiRole(["ADMIN"]);
    if (!guard.ok) return guard.response;

    try {
        const { id } = await params;
        const body = await request.json();

        const tenants = Array.isArray(body.tenants) ? body.tenants.filter((t: unknown) => typeof t === "string") : [];
        const queueIds = Array.isArray(body.queueIds) ? body.queueIds.filter((q: unknown) => typeof q === "string") : [];
        const extensionOverrides = Array.isArray(body.extensionOverrides)
            ? body.extensionOverrides.filter(
                  (o: { tenantId?: unknown; extensionNumber?: unknown; mode?: unknown }) =>
                      typeof o?.tenantId === "string" &&
                      typeof o?.extensionNumber === "string" &&
                      (o.mode === "INCLUDE" || o.mode === "EXCLUDE"),
              )
            : [];

        const payload: UserAccessPayload = {
            tenants,
            queueIds,
            extensionOverrides,
            canViewLogs: Boolean(body.canViewLogs),
            canViewExtensionStats: Boolean(body.canViewExtensionStats),
            canViewFullPhoneNumbers: Boolean(body.canViewFullPhoneNumbers),
            canCreateApiKeys: Boolean(body.canCreateApiKeys),
            canViewNotifications: Boolean(body.canViewNotifications),
        };

        await setUserAccess(id, payload);
        return NextResponse.json({ success: true });
    } catch (error) {
        logger.error("[admin/users/access] PUT error:", error);
        return NextResponse.json({ error: "Erreur interne du serveur" }, { status: 500 });
    }
}
