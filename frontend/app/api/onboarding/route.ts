import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { lireVueEnTantQue } from "@/lib/vue-en-tant-que";
import { estVisite } from "@/services/domain/visite-guidee";
import { marquerVisiteVue, visiteAJouer } from "@/services/visite-guidee.service";

/**
 * La visite guidée de l'utilisateur CONNECTÉ : faut-il la jouer sur cet
 * écran, et la marquer vue quand elle est terminée ou passée. Chacun ne
 * touche qu'à la sienne ; l'administration passe par /api/admin/users.
 */
export async function GET(request: Request) {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

    const visite = new URL(request.url).searchParams.get("visite") ?? "";
    if (!estVisite(visite)) return NextResponse.json({ error: "Visite inconnue" }, { status: 400 });

    // Pendant « voir en tant que », pas de visite : elle serait celle de
    // l'administrateur, sur les écrans d'un autre.
    if (await lireVueEnTantQue()) return NextResponse.json({ pending: false });

    try {
        return NextResponse.json({ pending: await visiteAJouer(session.user.id, visite) });
    } catch {
        // Ne jamais gêner l'écran pour une visite : en cas de doute, on ne la joue pas.
        return NextResponse.json({ pending: false });
    }
}

export async function POST(request: Request) {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

    const { visite } = await request.json().catch(() => ({ visite: "" }));
    if (!estVisite(visite)) return NextResponse.json({ error: "Visite inconnue" }, { status: 400 });

    // Rien n'est écrit pendant « voir en tant que » — pas même pour soi.
    if (await lireVueEnTantQue()) return NextResponse.json({ success: true });

    await marquerVisiteVue(session.user.id, visite);
    return NextResponse.json({ success: true });
}
