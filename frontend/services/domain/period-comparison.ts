/**
 * Comparaison avec la période précédente — LES définitions, en un seul endroit.
 *
 * Deux définitions de « période précédente » coexistent, et c'est VOULU :
 *
 * - `previousPeriod` : même durée, immédiatement avant. C'est la convention
 *   des KPI globaux du tableau de bord (cf. getGlobalMetrics dans
 *   dashboard.service) — reprise ici pour les flèches de tendance des cartes.
 *   Sur des TOTAUX de période, le désalignement des jours de semaine se dilue
 *   dans la durée : la simplicité l'emporte.
 *
 * - `weekAlignedPreviousPeriod` : recul d'un multiple de 7 jours couvrant la
 *   durée. Pour la SUPERPOSITION de courbes : le trafic est fortement
 *   hebdomadaire (week-ends à zéro), une courbe N-1 décalée de 2-3 jours de
 *   semaine comparerait un lundi à un samedi — illisible et trompeur. Ici,
 *   un lundi tombe toujours sur un lundi.
 *
 * Arithmétique en millisecondes PURES, sans ajustement d'heure d'hiver/été :
 * le décalage doit être identique côté client (alignement des points du
 * graphique) et côté serveur (bornes SQL), quel que soit le fuseau du
 * processus. Une période chevauchant un changement d'heure dérive d'une heure
 * d'horloge murale — arbitrage assumé, deux semaines par an.
 */

export interface Period {
    startDate: Date;
    endDate: Date;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Période de même durée se terminant juste avant le début de la courante. */
export function previousPeriod(startDate: Date, endDate: Date): Period {
    const durationMs = endDate.getTime() - startDate.getTime();
    const prevEnd = new Date(startDate.getTime() - 1);
    return { startDate: new Date(prevEnd.getTime() - durationMs), endDate: prevEnd };
}

/**
 * Période décalée d'un multiple de 7 jours couvrant la durée : 1 à 7 jours →
 * recul de 7 ; 31 jours → recul de 35. L'arrondi au-dessus garantit que les
 * deux périodes ne se chevauchent jamais.
 */
export function weekAlignedPreviousPeriod(startDate: Date, endDate: Date): Period {
    const days = Math.ceil((endDate.getTime() - startDate.getTime()) / DAY_MS);
    const shiftMs = Math.max(1, Math.ceil(days / 7)) * 7 * DAY_MS;
    return {
        startDate: new Date(startDate.getTime() - shiftMs),
        endDate: new Date(endDate.getTime() - shiftMs),
    };
}

export type TrendDirection = "up" | "down" | "flat";

/**
 * Sous ±3 % d'écart relatif, la variation est du bruit : la flèche affiche
 * « équivalent » (gris) plutôt qu'une hausse ou une baisse anecdotique.
 */
export const EQUIVALENCE_THRESHOLD = 0.03;

/**
 * Sens de la variation N vs N-1. Une période précédente à zéro ne fournit pas
 * de base de calcul : toute valeur non nulle est une hausse, deux zéros sont
 * équivalents. (Le cas « aucune activité N-1 du tout » se traite en amont —
 * pas de flèche du tout, cf. les cartes d'aperçu.)
 */
export function trendDirection(current: number, previous: number): TrendDirection {
    if (previous === 0) return current === 0 ? "flat" : "up";
    const relative = (current - previous) / previous;
    if (Math.abs(relative) < EQUIVALENCE_THRESHOLD) return "flat";
    return relative > 0 ? "up" : "down";
}
