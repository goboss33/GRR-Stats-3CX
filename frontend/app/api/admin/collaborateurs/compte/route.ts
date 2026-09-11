import { NextResponse } from "next/server";

import { getAvailableServers } from "@/lib/servers";
import type { ServerId } from "@/lib/prisma-cdr";
import { requireApiRole } from "@/lib/auth-guard";
import { logger } from "@/lib/logger";
import { ROLES_COMPTE, type RoleCompte } from "@/services/domain/compte-collaborateur";
import { preparerCompteCollaborateur } from "@/services/collaborators.service";

/**
 * « Préparer le compte » d'un collaborateur de l'annuaire : crée le compte
 * de l'application avant sa première connexion Microsoft, avec son périmètre
 * et les droits par défaut. ADMIN uniquement — c'est une création de compte
 * et un octroi de périmètre (cf. PRD droits d'accès §4.1).
 */
export async function POST(request: Request) {
    const guard = await requireApiRole(["ADMIN"]);
    if (!guard.ok) return guard.response;

    try {
        const { serverId, extension, role } = await request.json();
        if (!serverId || !getAvailableServers().includes(serverId as ServerId)) {
            return NextResponse.json({ error: "Invalid server" }, { status: 400 });
        }
        if (typeof extension !== "string" || !extension.trim()) {
            return NextResponse.json({ error: "Poste manquant" }, { status: 400 });
        }
        if (!ROLES_COMPTE.includes(role as RoleCompte)) {
            return NextResponse.json({ error: "Nature de compte invalide" }, { status: 400 });
        }

        const resultat = await preparerCompteCollaborateur(serverId as ServerId, extension.trim(), role as RoleCompte);
        if (!resultat.ok) return NextResponse.json({ error: resultat.error }, { status: 400 });
        return NextResponse.json(resultat);
    } catch (error) {
        logger.error("[collaborateurs] préparation de compte en échec", error);
        return NextResponse.json({ error: "Création du compte impossible" }, { status: 500 });
    }
}
