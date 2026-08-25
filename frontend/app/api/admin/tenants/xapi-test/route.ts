import { NextResponse } from "next/server";

import { getAvailableServers } from "@/lib/servers";
import { ServerId } from "@/lib/prisma-cdr";
import { requireApiRole } from "@/lib/auth-guard";
import { getServerXapiConfig } from "@/lib/xapi-config";
import { requestXapiToken, decodeTokenClaims } from "@/lib/xapi-client";

/**
 * « Tester la connexion » — demande un jeton au PBX avec les identifiants
 * ENREGISTRÉS, et renvoie un verdict lisible.
 *
 * La clé ne transite jamais par la requête : l'administrateur enregistre
 * d'abord, puis teste. Le jeton obtenu n'est pas renvoyé non plus — seul
 * compte le fait qu'il ait pu être obtenu.
 */
export async function POST(request: Request) {
    const guard = await requireApiRole(["ADMIN"]);
    if (!guard.ok) return guard.response;

    try {
        const { serverId } = await request.json();
        if (!serverId || typeof serverId !== "string") {
            return NextResponse.json({ error: "Invalid serverId" }, { status: 400 });
        }
        if (!getAvailableServers().includes(serverId as ServerId)) {
            return NextResponse.json({ error: "Server not available" }, { status: 400 });
        }

        const config = await getServerXapiConfig(serverId as ServerId);
        if (!config.enabled) {
            return NextResponse.json({ ok: false, reason: "La surcouche XAPI est désactivée pour ce tenant." });
        }
        if (!config.baseUrl) {
            return NextResponse.json({ ok: false, reason: "Adresse du PBX non renseignée." });
        }
        if (!config.clientId) {
            return NextResponse.json({ ok: false, reason: "ID client non renseigné." });
        }
        if (!config.key) {
            // Couvre aussi le cas d'une clé devenue illisible (secret de
            // chiffrement changé) : il faut la ressaisir.
            return NextResponse.json({ ok: false, reason: "Aucune clé exploitable : enregistrez (ou ressaisissez) la clé API." });
        }

        const result = await requestXapiToken(config.baseUrl, config.clientId, config.key);
        if (!result.ok) {
            return NextResponse.json({ ok: false, reason: result.reason });
        }

        // Jamais le jeton lui-même — mais ses CLAIMS déclaratives (rôle,
        // principal) sont la pièce à conviction des 403 : les montrer ici
        // évite d'aller décoder un JWT à la main pour comprendre un refus.
        const claims = decodeTokenClaims(result.accessToken);
        return NextResponse.json({
            ok: true,
            expiresInSeconds: result.expiresInSeconds,
            role: claims.role ?? null,
            principal: claims.sub ?? claims.client_id ?? null,
        });
    } catch (error) {
        console.error("[xapi-test] Error:", error);
        return NextResponse.json({ error: "Échec du test de connexion" }, { status: 500 });
    }
}
