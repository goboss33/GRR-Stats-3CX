import type { Session } from "next-auth";
import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";
import { redirect } from "next/navigation";
import { roleEffectif } from "@/lib/vue-en-tant-que";

/**
 * Rôles applicatifs reconnus (miroir de l'enum Prisma `Role`).
 * `session.user.role` est typé `string` côté next-auth ; on centralise ici la
 * liste des valeurs valides pour les gardes d'autorisation.
 */
export type AppRole = "ADMIN" | "MODERATOR" | "MANAGER" | "AGENT";

type SessionUser = Session["user"];

/**
 * L'utilisateur tel que les gardes le jugent : pendant « voir en tant que »
 * (lib/vue-en-tant-que), le rôle est celui de la personne regardée — un
 * administrateur qui regarde un manager perd les réglages le temps de la vue.
 * L'identifiant reste le sien : ce qu'il écrit reste écrit en son nom.
 */
async function utilisateurJuge(user: SessionUser): Promise<SessionUser> {
    return { ...user, role: await roleEffectif(user) };
}

/**
 * Garde d'autorisation pour les Route Handlers (API).
 *
 * Renvoie soit l'utilisateur de session, soit une réponse HTTP prête à retourner
 * (401 si non authentifié, 403 si le rôle n'est pas autorisé). Usage :
 *
 *   const guard = await requireApiRole(["ADMIN", "MODERATOR"]);
 *   if (!guard.ok) return guard.response;
 *   // ... guard.user est disponible et typé
 */
export async function requireApiRole(
    allowedRoles: AppRole[],
): Promise<{ ok: true; user: SessionUser } | { ok: false; response: NextResponse }> {
    const session = await auth();
    if (!session?.user) {
        return { ok: false, response: NextResponse.json({ error: "Non authentifié" }, { status: 401 }) };
    }
    const user = await utilisateurJuge(session.user);
    if (!allowedRoles.includes(user.role as AppRole)) {
        return { ok: false, response: NextResponse.json({ error: "Accès refusé" }, { status: 403 }) };
    }
    return { ok: true, user };
}

/**
 * Garde d'autorisation pour les Server Components (pages protégées).
 *
 * Redirige vers `/login` si non authentifié, ou vers `redirectTo` si le rôle est
 * insuffisant. Renvoie l'utilisateur de session une fois l'accès validé.
 */
export async function requirePageRole(
    allowedRoles: AppRole[],
    redirectTo = "/dashboard",
): Promise<SessionUser> {
    const session = await auth();
    if (!session?.user) redirect("/login");
    const user = await utilisateurJuge(session.user);
    if (!allowedRoles.includes(user.role as AppRole)) redirect(redirectTo);
    return user;
}

/**
 * Garde d'autorisation pour les Server Actions.
 * Lève une erreur si l'utilisateur n'est pas authentifié ou n'a pas le rôle requis.
 */
export async function requireActionRole(allowedRoles: AppRole[]): Promise<SessionUser> {
    const session = await auth();
    const user = session?.user ? await utilisateurJuge(session.user) : null;
    if (!user || !allowedRoles.includes(user.role as AppRole)) {
        throw new Error("Non autorisé");
    }
    return user;
}
