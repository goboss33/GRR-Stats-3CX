import type { HealthLevel } from "@/services/domain/queue-health";

/**
 * ORDRE DES FILES DANS LE REGISTRE.
 *
 * Sorti du composant pour être prouvable : trois règles s'y cachent qui se
 * cassent en silence si personne ne les vérifie — le classement numérique des
 * numéros de file, le sort des valeurs absentes, et le départage des égalités.
 */

/**
 * Colonnes ordonnables.
 *
 * « Statut » et la colonne d'actions n'en sont pas : chaque onglet du registre
 * ne montre qu'un seul statut, il n'y a rien à classer.
 */
export type ColonneTri = "sante" | "numero" | "nom" | "departement" | "agents" | "dernierAppel";
export type SensTri = "asc" | "desc";
export interface Tri {
    colonne: ColonneTri;
    sens: SensTri;
}

/** Ce qu'il faut connaître d'une file pour la classer. */
export interface FileTriable {
    queueNumber: string;
    currentName: string;
    department: string | null;
    agentCount: number;
    lastCallAt: string | null;
}

/** L'ordre de la santé est celui de l'urgence, pas celui de l'alphabet. */
export const ORDRE_SANTE: Record<HealthLevel, number> = { critical: 0, warning: 1, ok: 2 };

/**
 * Sens du PREMIER clic sur chaque colonne.
 *
 * Convention habituelle, et surtout prévisible : le texte part au début de
 * l'alphabet, les nombres et les dates partent par le plus grand — la plus
 * grosse équipe, l'appel le plus récent. La santé part par le plus urgent.
 * Un second clic inverse.
 */
export const SENS_INITIAL: Record<ColonneTri, SensTri> = {
    sante: "asc",
    numero: "asc",
    nom: "asc",
    departement: "asc",
    agents: "desc",
    dernierAppel: "desc",
};

/**
 * Tri par défaut : l'ordre alphabétique du nom.
 *
 * C'est la colonne qu'on lit, donc celle par laquelle on cherche. Elle est
 * elle-même triable, si bien qu'un clic dessus ramène toujours à cet état —
 * pas besoin d'un troisième clic « remise à zéro » sur chaque en-tête.
 */
export const TRI_PAR_DEFAUT: Tri = { colonne: "nom", sens: "asc" };

const horodatage = (iso: string | null) => (iso ? new Date(iso).getTime() : 0);

/** Compare deux files sur une colonne, dans le sens croissant. */
function comparer<T extends FileTriable>(
    a: T,
    b: T,
    colonne: ColonneTri,
    niveau: (q: T) => HealthLevel,
): number {
    switch (colonne) {
        case "sante":
            return ORDRE_SANTE[niveau(a)] - ORDRE_SANTE[niveau(b)];
        // « numeric » pour que la file 97 précède la 103 : les numéros sont
        // stockés en texte, et l'ordre lexical y placerait 103 avant 97.
        case "numero":
            return a.queueNumber.localeCompare(b.queueNumber, "fr", { numeric: true });
        case "nom":
            return a.currentName.localeCompare(b.currentName, "fr", { sensitivity: "base" });
        case "departement":
            return (a.department ?? "").localeCompare(b.department ?? "", "fr", { sensitivity: "base" });
        case "agents":
            return a.agentCount - b.agentCount;
        case "dernierAppel":
            return horodatage(a.lastCallAt) - horodatage(b.lastCallAt);
    }
}

/** Une file dont la colonne triée est vide : « — » ne se classe pas. */
function valeurAbsente(q: FileTriable, colonne: ColonneTri): boolean {
    if (colonne === "departement") return !q.department;
    if (colonne === "dernierAppel") return !q.lastCallAt;
    return false;
}

/**
 * Classe les files, sans toucher au tableau reçu.
 *
 * Deux règles au-delà de la comparaison brute :
 *
 *   - les valeurs absentes restent au bout dans les DEUX sens. Inverser le
 *     tri ne doit pas hisser en tête les files sans département — elles n'ont
 *     rien à dire sur ce critère, où qu'on regarde.
 *   - à égalité, le nom départage. Sans lui, l'ordre à l'intérieur d'un même
 *     département ou d'un même effectif dépendrait de l'ordre d'arrivée des
 *     lignes, et changerait d'un chargement à l'autre sans raison visible.
 */
export function trierFiles<T extends FileTriable>(
    files: T[],
    tri: Tri,
    niveau: (q: T) => HealthLevel,
): T[] {
    const signe = tri.sens === "asc" ? 1 : -1;
    return [...files].sort((a, b) => {
        const absenteA = valeurAbsente(a, tri.colonne);
        const absenteB = valeurAbsente(b, tri.colonne);
        if (absenteA !== absenteB) return absenteA ? 1 : -1;
        return (
            comparer(a, b, tri.colonne, niveau) * signe ||
            a.currentName.localeCompare(b.currentName, "fr", { sensitivity: "base" })
        );
    });
}
