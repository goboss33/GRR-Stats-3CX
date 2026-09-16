/**
 * RATTACHEMENT D'UNE CONNEXION MICROSOFT À UN COMPTE (sept. 2026).
 *
 * Ce que Microsoft remet à la connexion n'est pas ce que la personne a tapé.
 * Le jeton porte l'ADRESSE PRINCIPALE de la boîte (`email`), le nom de
 * connexion à part (`preferred_username`) et l'identifiant d'objet Entra
 * (`oid`). Chez ce tenant, les trois ne coïncident pas : Alain se connecte en
 * alain.chaboudez@regierhone.ch, son adresse principale est
 * alain.chaboudez@grrsa.ch, et le 3CX — donc le compte PRÉPARÉ depuis
 * l'annuaire — porte la première. Comparer la seule adresse principale a
 * créé six doublons le 16 septembre 2026.
 *
 * D'où l'ordre de recherche : l'identifiant d'objet Entra, que la synchro
 * Microsoft 365 a déjà rapproché d'un poste 3CX et donc d'une adresse ; puis,
 * en repli, les deux adresses du jeton. Ici : la lecture des revendications
 * et l'ordre des adresses candidates, sans base ni navigateur.
 *
 * À ne pas confondre avec `azureAdId` : ce champ reçoit le `sub` du jeton,
 * identifiant propre à l'application de connexion, différent de l'`oid`.
 */

import { normaliserEmail } from "./compte-collaborateur";

export interface RevendicationsEntra {
    /** Identifiant d'objet Entra de la personne — celui que Graph appelle `id`. */
    oid: string | null;
    /** L'adresse principale de la boîte, celle que l'app comparait seule. */
    email: string | null;
    /** Le nom de connexion (UPN), ce que la personne tape. */
    preferredUsername: string | null;
}

const texte = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** Les revendications utiles du jeton, tolérantes à un profil absent ou mal formé. */
export function lireRevendications(profile: unknown): RevendicationsEntra {
    const p = (profile && typeof profile === "object" ? profile : {}) as Record<string, unknown>;
    return { oid: texte(p.oid), email: texte(p.email), preferredUsername: texte(p.preferred_username) };
}

/**
 * Les adresses sous lesquelles chercher le compte, par ordre de confiance :
 * celles que l'annuaire 3CX donne pour cet objet Entra (c'est là que vit un
 * compte préparé), puis l'adresse principale, puis le nom de connexion.
 * En minuscules, sans doublon ni vide.
 */
export function adressesCandidates(jeton: RevendicationsEntra, adressesAnnuaire: readonly (string | null | undefined)[]): string[] {
    const vues = new Set<string>();
    for (const brute of [...adressesAnnuaire, jeton.email, jeton.preferredUsername]) {
        const adresse = brute ? normaliserEmail(brute) : "";
        if (adresse && adresse.includes("@")) vues.add(adresse);
    }
    return [...vues];
}
