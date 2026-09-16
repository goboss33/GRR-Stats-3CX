import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { requireApiRole } from "@/lib/auth-guard";
import { logger } from "@/lib/logger";
import { prismaAuth } from "@/lib/prisma-auth";
import { COOKIE_VUE_EN_TANT_QUE, libelleCible, peutVoirComme } from "@/services/domain/vue-en-tant-que";

/**
 * Commence « voir en tant que » : pose le cookie de la personne regardée.
 * Administrateur seulement, jamais soi-même. Le cookie vit le temps du
 * navigateur ; la sortie est le bouton « Quitter » du bandeau, dans le layout
 * authentifié. Chaque début est journalisé : c'est un regard sur les données
 * d'un autre — en `warn`, le seul niveau que la production garde.
 */
export async function POST(request: Request) {
    const guard = await requireApiRole(["ADMIN"]);
    if (!guard.ok) return guard.response;

    const { userId } = await request.json().catch(() => ({ userId: "" }));
    if (typeof userId !== "string" || !peutVoirComme(guard.user, userId)) {
        return NextResponse.json({ error: "Ce compte ne peut pas être regardé — ou c'est le vôtre." }, { status: 400 });
    }
    const cible = await prismaAuth.user.findUnique({
        where: { id: userId },
        select: { id: true, email: true, role: true, firstName: true, lastName: true },
    });
    if (!cible) return NextResponse.json({ error: "Compte introuvable" }, { status: 404 });

    (await cookies()).set(COOKIE_VUE_EN_TANT_QUE, cible.id, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
    });
    logger.warn(`[vue-en-tant-que] ${guard.user.email} regarde l'application comme ${cible.email} (${cible.role})`);
    return NextResponse.json({ cible: libelleCible(cible) });
}
