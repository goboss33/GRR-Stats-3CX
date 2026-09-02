import { NextResponse, type NextRequest } from "next/server";

import { prismaAuth } from "@/lib/prisma-auth";
import { getAvailableServers } from "@/lib/servers";
import type { ServerId } from "@/lib/prisma-cdr";
import { requireApiRole } from "@/lib/auth-guard";

/**
 * Photo d'un collaborateur, servie depuis notre base (jamais depuis Graph en
 * direct : le navigateur n'a pas de jeton Microsoft, et n'en aura pas).
 *
 * Adressée par identifiant Graph — opaque — plutôt que par e-mail : une adresse
 * n'a rien à faire dans une URL. Réservée aux utilisateurs connectés, tous
 * rôles : ces visages s'affichent déjà dans Teams et Outlook de toute la
 * maison. Cache navigateur d'un jour, revalidé par ETag : les photos changent
 * à l'échelle du trimestre, les statistiques à chaque clic.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ graphId: string }> }) {
    const guard = await requireApiRole(["ADMIN", "MODERATOR", "MANAGER", "AGENT"]);
    if (!guard.ok) return guard.response;

    const { graphId } = await params;
    const serverId = request.nextUrl.searchParams.get("server") ?? "";
    if (!graphId || !getAvailableServers().includes(serverId as ServerId)) {
        return NextResponse.json({ error: "Requête invalide" }, { status: 400 });
    }

    const photo = await prismaAuth.collaboratorPhoto.findFirst({
        where: { serverId, graphId },
        select: { data: true, contentType: true, etag: true, fetchedAt: true },
    });
    if (!photo) return new NextResponse(null, { status: 404 });

    // ETag maison, stable tant que la photo ne change pas : celui de Graph
    // quand on l'a, sinon la date de lecture.
    const etag = `"${(photo.etag ?? photo.fetchedAt.toISOString()).replace(/"/g, "")}"`;
    const headers = {
        "Content-Type": photo.contentType,
        "Cache-Control": "private, max-age=86400",
        ETag: etag,
    };
    if (request.headers.get("if-none-match") === etag) {
        return new NextResponse(null, { status: 304, headers });
    }
    return new NextResponse(new Uint8Array(photo.data), { status: 200, headers });
}
