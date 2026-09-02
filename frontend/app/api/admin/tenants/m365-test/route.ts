import { NextResponse } from "next/server";

import { getAvailableServers } from "@/lib/servers";
import { ServerId } from "@/lib/prisma-cdr";
import { requireApiRole } from "@/lib/auth-guard";
import { getServerM365Config } from "@/lib/m365-config";
import { requestGraphToken, sonderGraph } from "@/lib/graph-client";
import { diagnostiquerRoles, etatSecret } from "@/lib/graph-diagnostic";

/**
 * « Tester la connexion » Microsoft 365 — avec les identifiants ENREGISTRÉS.
 *
 * Trois étages, et le verdict dit lequel a cédé : le jeton (identifiants,
 * secret expiré…), les permissions portées par le jeton (consentement), puis
 * les deux lectures réelles — utilisateurs avec titre, photo. Le secret et le
 * jeton ne sont jamais renvoyés.
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

        const config = await getServerM365Config(serverId as ServerId);
        const secret = etatSecret(config.secretExpiresAt);
        if (!config.enabled) return NextResponse.json({ ok: false, reason: "L'intégration Microsoft 365 est désactivée pour ce tenant.", secret });
        if (!config.tenantId) return NextResponse.json({ ok: false, reason: "ID de l'annuaire non renseigné.", secret });
        if (!config.clientId) return NextResponse.json({ ok: false, reason: "ID d'application non renseigné.", secret });
        if (!config.secret) {
            return NextResponse.json({ ok: false, reason: "Aucun secret exploitable : enregistrez (ou ressaisissez) le secret client.", secret });
        }

        const jeton = await requestGraphToken(config.tenantId, config.clientId, config.secret);
        if (!jeton.ok) {
            return NextResponse.json({ ok: false, reason: jeton.reason, codes: jeton.codes, secret });
        }

        const roles = diagnostiquerRoles(jeton.roles);
        const sonde = await sonderGraph(jeton.accessToken);

        const complet = roles.manquants.length === 0 && sonde.utilisateurs === "ok" && sonde.titre && sonde.photo !== "refuse" && sonde.photo !== "erreur";
        const reason = complet
            ? null
            : roles.manquants.length > 0 && jeton.roles.length === 0
                ? "Le jeton ne porte aucune permission : dans Entra, cliquez « Accorder un consentement d'administrateur » sur l'inscription."
                : roles.manquants.length > 0
                    ? `Permission(s) manquante(s) sur l'inscription : ${roles.manquants.join(", ")} — à ajouter en « autorisations d'application », puis consentir.`
                    : sonde.detail ?? "Les lectures Graph n'ont pas toutes abouti.";

        return NextResponse.json({ ok: complet, reason, accordes: roles.accordes, manquants: roles.manquants, sonde, secret });
    } catch (error) {
        console.error("[m365-test] Error:", error);
        return NextResponse.json({ error: "Échec du test de connexion" }, { status: 500 });
    }
}
