import { cache } from "react";
import { cookies } from "next/headers";

import { auth } from "@/lib/auth";
import { prismaAuth } from "@/lib/prisma-auth";
import { COOKIE_VUE_EN_TANT_QUE, peutVoirComme, type CibleVue } from "@/services/domain/vue-en-tant-que";

/**
 * La personne que l'administrateur regarde, ou null. Lue une fois par requête.
 *
 * Le cookie ne vaut rien par lui-même : il n'a d'effet que si la session
 * RÉELLE est celle d'un administrateur, et jamais sur lui-même — un cookie
 * forgé par quelqu'un d'autre est ignoré. Hors d'une requête (tâche de fond),
 * il n'y a pas de cookie : pas de vue.
 *
 * Ce qui en dépend : la portée (lib/access-scope), le rôle des gardes
 * (lib/auth-guard), la navigation et le bandeau (layout authentifié), la
 * visite guidée (éteinte pendant la vue).
 */
export const lireVueEnTantQue = cache(async (): Promise<CibleVue | null> => {
    let id: string | undefined;
    try {
        id = (await cookies()).get(COOKIE_VUE_EN_TANT_QUE)?.value;
    } catch {
        return null;
    }
    if (!id) return null;
    const session = await auth();
    if (!session?.user || !peutVoirComme(session.user, id)) return null;
    return prismaAuth.user.findUnique({
        where: { id },
        select: { id: true, email: true, role: true, firstName: true, lastName: true },
    });
});

/** Le rôle qui commande : celui de la personne regardée pendant la vue, sinon le sien. */
export async function roleEffectif(user: { role: string }): Promise<string> {
    return (await lireVueEnTantQue())?.role ?? user.role;
}
