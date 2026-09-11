/**
 * L'ÉCRAN « UTILISATEURS » — ce qui n'a pas besoin du navigateur (sept. 2026).
 *
 * Un seul écran pour deux anciens : les comptes de l'application et
 * l'annuaire des postes 3CX. Une ligne par personne, rapprochée par e-mail.
 * Ici : le catalogue des colonnes et leur choix mémorisé, et les trois vues
 * rapides qui ne sont que des réglages de filtres.
 */

export type CleColonne =
    | "collaborateur" | "poste" | "equipes" | "compte" | "presence" | "actions"
    | "email" | "m365" | "files" | "perimetre" | "cree" | "depuis";

export interface ColonneCatalogue {
    cle: CleColonne;
    libelle: string;
    /** Toujours affichée, pas dans le menu. */
    fixe?: boolean;
    /** Cochée par défaut. */
    defaut?: boolean;
    /** N'existe que si l'échantillonnage de présence est actif pour le tenant. */
    presence?: boolean;
}

/**
 * L'ordre du catalogue est l'ordre des colonnes à l'écran. Par défaut, ce
 * qu'il faut pour gérer des comptes : la personne, son compte, son e-mail,
 * son périmètre (arbitrage du 11 sept. 2026). La dernière activité n'est pas
 * une colonne : elle est la date portée par la cellule Compte.
 */
export const CATALOGUE_COLONNES: readonly ColonneCatalogue[] = [
    { cle: "collaborateur", libelle: "Collaborateur", fixe: true, defaut: true },
    { cle: "poste", libelle: "Poste" },
    { cle: "equipes", libelle: "Équipes" },
    { cle: "compte", libelle: "Compte", defaut: true },
    { cle: "presence", libelle: "Présence", presence: true },
    { cle: "email", libelle: "E-mail", defaut: true },
    { cle: "m365", libelle: "Microsoft 365" },
    { cle: "files", libelle: "Files", presence: true },
    { cle: "perimetre", libelle: "Périmètre", defaut: true },
    { cle: "cree", libelle: "Compte créé le" },
    { cle: "depuis", libelle: "Au 3CX depuis" },
    { cle: "actions", libelle: "Actions", fixe: true, defaut: true },
];

export const CLE_MEMO_COLONNES = "grr.utilisateurs.colonnes";

export function colonnesParDefaut(): Set<CleColonne> {
    return new Set(CATALOGUE_COLONNES.filter((c) => c.defaut).map((c) => c.cle));
}

/**
 * Relit un choix mémorisé (JSON d'un tableau de clés). Une clé inconnue est
 * ignorée, une colonne fixe est toujours présente ; un texte illisible rend
 * le défaut — le navigateur n'a jamais raison contre le catalogue.
 */
export function lireColonnesMemorisees(json: string | null | undefined): Set<CleColonne> {
    if (!json) return colonnesParDefaut();
    let brut: unknown;
    try { brut = JSON.parse(json); } catch { return colonnesParDefaut(); }
    if (!Array.isArray(brut)) return colonnesParDefaut();
    const connues = new Set(CATALOGUE_COLONNES.map((c) => c.cle as string));
    const choisies = new Set<CleColonne>(brut.filter((x): x is CleColonne => typeof x === "string" && connues.has(x)));
    for (const c of CATALOGUE_COLONNES) if (c.fixe) choisies.add(c.cle);
    return choisies;
}

// ============================================
// VUES RAPIDES
// ============================================

export type Vue = "comptes" | "a-preparer" | "tous";

export const LIBELLES_VUE: Record<Vue, string> = {
    comptes: "Comptes",
    "a-preparer": "À préparer",
    tous: "Tous",
};

/** Ce que chaque vue règle : le filtre « Compte » et le filtre « Équipe ». */
export const FILTRES_DES_VUES: Record<Vue, { compte: readonly string[]; equipe: readonly string[] }> = {
    comptes: { compte: ["existant"], equipe: [] },
    "a-preparer": { compte: ["a-preparer"], equipe: ["en-equipe"] },
    tous: { compte: [], equipe: [] },
};

const memesEnsembles = (a: ReadonlySet<string>, b: readonly string[]) => a.size === b.length && b.every((x) => a.has(x));

/** La vue que les filtres courants incarnent, ou null quand l'utilisateur a composé le sien. */
export function vueDepuisFiltres(compte: ReadonlySet<string>, equipe: ReadonlySet<string>): Vue | null {
    for (const vue of Object.keys(FILTRES_DES_VUES) as Vue[]) {
        const f = FILTRES_DES_VUES[vue];
        if (memesEnsembles(compte, f.compte) && memesEnsembles(equipe, f.equipe)) return vue;
    }
    return null;
}

/** « Bossens, Geoffrey » depuis un compte, ou l'e-mail quand le nom manque. */
export function nomAffichable(compte: { firstName: string | null; lastName: string | null; email: string }): string {
    const nom = [compte.lastName, compte.firstName].filter((x) => x && x.trim()).join(", ");
    return nom || compte.email;
}
