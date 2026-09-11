import { NextRequest, NextResponse } from "next/server";

import { requireApiRole } from "@/lib/auth-guard";
import { logger } from "@/lib/logger";
import { estVisite } from "@/services/domain/visite-guidee";
import { lireVisites, marquerVisiteVue, remettreVisiteAJouer } from "@/services/visite-guidee.service";

/**
 * Onglet « Onboarding » du dialogue d'accès : quelles visites guidées cet
 * utilisateur a vues, et les remettre à jouer. ADMIN uniquement, comme le
 * reste du dialogue.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const guard = await requireApiRole(["ADMIN"]);
    if (!guard.ok) return guard.response;
    const { id } = await params;
    return NextResponse.json({ visites: await lireVisites(id) });
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const guard = await requireApiRole(["ADMIN"]);
    if (!guard.ok) return guard.response;

    try {
        const { id } = await params;
        const { visite, aRevoir } = await request.json();
        if (!estVisite(visite) || typeof aRevoir !== "boolean") {
            return NextResponse.json({ error: "Requête invalide" }, { status: 400 });
        }
        if (aRevoir) await remettreVisiteAJouer(id, visite);
        else await marquerVisiteVue(id, visite);
        return NextResponse.json({ visites: await lireVisites(id) });
    } catch (error) {
        logger.error("[onboarding] mise à jour en échec", error);
        return NextResponse.json({ error: "Mise à jour impossible" }, { status: 500 });
    }
}
