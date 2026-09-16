/**
 * « VOIR EN TANT QUE » (sept. 2026) — un administrateur regarde l'application
 * comme un autre compte : même périmètre, même rôle, mêmes droits, sur tous
 * les écrans. Son identité, elle, ne change pas : il reste connecté avec son
 * compte, et rien n'est écrit au nom de la personne regardée — ni sa dernière
 * activité, ni sa visite guidée. Le cas fondateur : Yves Batardon écrit qu'il
 * ne voit qu'une équipe sur trois, et personne ne peut voir son écran.
 *
 * Ici, ce qui se décide sans requête : qui peut regarder qui, et comment on
 * nomme la personne regardée. La lecture du cookie et de la session vit dans
 * lib/vue-en-tant-que.
 */

export const COOKIE_VUE_EN_TANT_QUE = "grr.vue-en-tant-que";

export interface CibleVue {
    id: string;
    email: string;
    role: string;
    firstName: string | null;
    lastName: string | null;
}

export const LIBELLES_ROLE: Record<string, string> = {
    ADMIN: "Administrateur",
    MODERATOR: "Modérateur",
    MANAGER: "Manager",
    AGENT: "Collaborateur",
};

/** Seul un administrateur regarde, et jamais lui-même : ce serait sa propre vue. */
export function peutVoirComme(reel: { id: string; role: string }, cibleId: string): boolean {
    return reel.role === "ADMIN" && Boolean(cibleId) && reel.id !== cibleId;
}

/** « Yves Batardon (Manager) », ou l'e-mail quand le nom manque. */
export function libelleCible(c: Pick<CibleVue, "email" | "role" | "firstName" | "lastName">): string {
    const nom = [c.firstName, c.lastName].filter((x) => x && x.trim()).join(" ").trim() || c.email;
    return `${nom} (${LIBELLES_ROLE[c.role] ?? c.role})`;
}
