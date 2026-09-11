/**
 * PRÉPARER LE COMPTE d'un collaborateur — la logique pure (septembre 2026).
 *
 * L'annuaire des collaborateurs connaît, pour chaque poste 3CX rapproché de
 * Microsoft 365, l'e-mail, le titre et les équipes. Un administrateur peut
 * donc créer le compte de l'application AVANT la première connexion : la
 * personne se connecte avec Microsoft, le compte est reconnu par son e-mail,
 * et son périmètre l'attend déjà. Plus d'appel téléphonique, plus de saisie.
 *
 * Deux natures de compte, un seul jeu de droits par défaut — restrictif,
 * arbitré le 11 septembre 2026 : ses propres équipes pour périmètre, pas les
 * journaux d'appels, la ligne TOTAL des ratios seulement, pas les
 * statistiques par poste, mais les numéros complets.
 */

export type RoleCompte = "MANAGER" | "AGENT";

export const ROLES_COMPTE: readonly RoleCompte[] = ["MANAGER", "AGENT"];

/** Les libellés de l'écran Utilisateurs : un AGENT s'y appelle « Collaborateur ». */
export const LIBELLES_ROLE_COMPTE: Record<RoleCompte, string> = {
    MANAGER: "Manager",
    AGENT: "Collaborateur",
};

export interface DroitsCompte {
    canViewLogs: boolean;
    canViewExtensionStats: boolean;
    canViewFullPhoneNumbers: boolean;
    canCreateApiKeys: boolean;
    agentRatiosLevel: "none" | "totals" | "all";
}

export const DROITS_PAR_DEFAUT: DroitsCompte = {
    canViewLogs: false,
    canViewExtensionStats: false,
    canViewFullPhoneNumbers: true,
    canCreateApiKeys: false,
    agentRatiosLevel: "totals",
};

/** Ce que l'écran énumère avant de créer : les droits, en français. */
export const DROITS_PAR_DEFAUT_LIBELLES: readonly string[] = [
    "Périmètre : ses équipes uniquement",
    "Journaux d'appels : non",
    "Ratios du tableau : ligne TOTAL",
    "Statistiques par poste et SDA : non",
    "Numéros complets : oui",
    "Clés API : non",
];

/**
 * L'e-mail tel qu'il est stocké et comparé : en minuscules. La connexion
 * Microsoft cherche le compte par e-mail, et Postgres compare à la lettre
 * près — une majuscule de différence créerait un second compte.
 */
export function normaliserEmail(email: string): string {
    return email.trim().toLowerCase();
}

/** « Bossens, Geoffrey » (format du 3CX) → nom et prénom ; sans virgule, tout est le nom. */
export function separerNom(displayName: string): { lastName: string | null; firstName: string | null } {
    const texte = displayName.trim();
    if (!texte) return { lastName: null, firstName: null };
    const virgule = texte.indexOf(",");
    if (virgule < 0) return { lastName: texte, firstName: null };
    const lastName = texte.slice(0, virgule).trim() || null;
    const firstName = texte.slice(virgule + 1).trim() || null;
    return { lastName, firstName };
}

export interface SituationCompte {
    email: string | null;
    matchState: string;
    /** Un compte de l'application existe déjà pour cet e-mail. */
    compteExistant: boolean;
}

/**
 * Pourquoi un compte ne peut pas être préparé ; null quand il peut l'être.
 * Un compte existant n'est pas un blocage à réparer, c'est l'état normal
 * après la préparation — l'écran le montre autrement.
 */
export function motifBlocage(s: SituationCompte): string | null {
    if (s.compteExistant) return "Un compte existe déjà pour cet e-mail.";
    if (!s.email) return "Ce poste n'a pas d'e-mail dans le 3CX.";
    if (s.matchState !== "ok") return "Ce poste n'est pas rapproché d'un compte Microsoft 365 actif.";
    return null;
}
