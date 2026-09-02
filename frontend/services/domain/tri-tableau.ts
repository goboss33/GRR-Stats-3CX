/**
 * TRI GÉNÉRIQUE D'UN TABLEAU — les mêmes règles que celles du registre des
 * files (services/domain/queue-sort), écrites une fois pour tous les tableaux
 * de l'application.
 *
 *   - le texte part au début de l'alphabet, les nombres et les dates par le
 *     plus grand (sens du premier clic) ;
 *   - une valeur absente reste au bout dans les DEUX sens : « — » ne se classe
 *     pas entre deux valeurs ;
 *   - à égalité, un départage stable (le nom), toujours croissant — sans lui
 *     l'ordre changerait d'un chargement à l'autre sans raison visible.
 */

export type TypeColonne = "texte" | "nombre" | "date";
export type SensTri = "asc" | "desc";

export interface DefinitionColonne<T> {
    type: TypeColonne;
    /** null / undefined / "" = valeur absente. Les dates en ISO ou en millisecondes. */
    valeur: (ligne: T) => string | number | null | undefined;
}

export interface TriTableau<K extends string> {
    colonne: K;
    sens: SensTri;
}

export function sensInitial(type: TypeColonne): SensTri {
    return type === "texte" ? "asc" : "desc";
}

/** Un clic trie dans le sens utile de la colonne, un second inverse. */
export function basculerTri<K extends string, T>(
    courant: TriTableau<K>,
    colonne: K,
    colonnes: Record<K, DefinitionColonne<T>>,
): TriTableau<K> {
    if (courant.colonne === colonne) return { colonne, sens: courant.sens === "asc" ? "desc" : "asc" };
    return { colonne, sens: sensInitial(colonnes[colonne].type) };
}

const absente = (v: string | number | null | undefined) => v === null || v === undefined || v === "";

function comparer(a: string | number, b: string | number, type: TypeColonne): number {
    switch (type) {
        case "texte":
            return String(a).localeCompare(String(b), "fr", { sensitivity: "base", numeric: true });
        case "nombre":
            return Number(a) - Number(b);
        case "date": {
            const ta = typeof a === "number" ? a : Date.parse(String(a));
            const tb = typeof b === "number" ? b : Date.parse(String(b));
            return (Number.isNaN(ta) ? 0 : ta) - (Number.isNaN(tb) ? 0 : tb);
        }
    }
}

export function trierLignes<T, K extends string>(
    lignes: T[],
    tri: TriTableau<K>,
    colonnes: Record<K, DefinitionColonne<T>>,
    departage: (ligne: T) => string,
): T[] {
    const def = colonnes[tri.colonne];
    const signe = tri.sens === "asc" ? 1 : -1;
    return [...lignes].sort((x, y) => {
        const a = def.valeur(x);
        const b = def.valeur(y);
        const ax = absente(a);
        const bx = absente(b);
        if (ax !== bx) return ax ? 1 : -1;
        const brut = ax ? 0 : comparer(a as string | number, b as string | number, def.type) * signe;
        return brut || departage(x).localeCompare(departage(y), "fr", { sensitivity: "base" });
    });
}
