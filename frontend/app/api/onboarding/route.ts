import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
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

    await marquerVisiteVue(session.user.id, visite);
    return NextResponse.json({ success: true });
}
