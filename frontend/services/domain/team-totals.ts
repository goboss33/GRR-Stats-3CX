import { sumBucket } from "@/services/domain/call-classification";
import type { QueueKPIs } from "@/types/statistics.types";

/**
 * Totaux du bilan d'équipe — LES formules des vignettes, en un seul endroit.
 *
 * L'aperçu des groupes (cartes de l'écran de sélection) et l'écran détail
 * affichent les mêmes chiffres parce qu'ils appellent CETTE fonction sur la
 * même réponse d'API — l'égalité est garantie par construction, pas par
 * vigilance. Toute évolution des vignettes passe par ici.
 */
export interface TeamTotals {
    totalReceived: number;
    totalAnswered: number;
    /** Perdus : statuts « lost » de la file + directs perdus. */
    totalLost: number;
    /** Transferts accomplis (décrochés ici, servis ailleurs), file + directs. */
    totalHandedOff: number;
    /** Débordés (partis sans décroché), file + directs. */
    totalOverflowed: number;
    /** Vignette « Redirigés » = transférés + débordés. */
    totalRedirected: number;
    /** Prise en charge (%), règle handedOffInPerformance appliquée. */
    performanceRate: number;
}

export function computeTeamTotals(kpis: QueueKPIs): TeamTotals {
    const totalReceived = kpis.callsReceived + kpis.teamDirectReceived;
    const totalAnswered = kpis.callsAnswered + kpis.teamDirectAnswered;
    const totalLost = sumBucket(kpis.outcomeCounts, "lost") + kpis.directLost;
    const totalHandedOff = kpis.callsHandedOff + kpis.directHandedOff;
    const totalOverflowed = kpis.callsOverflow + kpis.directOverflow;
    const totalRedirected = totalOverflowed + totalHandedOff;

    // Un transfert accompli est un travail fait — décisif pour les réceptions
    // (règle handedOffInPerformance, configurable) ; le débordement sans
    // décroché reste toujours hors du numérateur.
    const handedOffCounts = kpis.handedOffInPerformance === "success";
    const totalHandled = totalAnswered + (handedOffCounts ? totalHandedOff : 0);
    const performanceRate = totalReceived > 0
        ? Math.round((totalHandled / totalReceived) * 100)
        : 0;

    return { totalReceived, totalAnswered, totalLost, totalHandedOff, totalOverflowed, totalRedirected, performanceRate };
}

/**
 * Couleur de la prise en charge — les seuils de la barre du détail, partagés
 * par la pastille des cartes d'aperçu. `dot`/`text` sont des classes Tailwind.
 */
export function performanceTone(rate: number): { dot: string; text: string } {
    if (rate >= 80) return { dot: "bg-emerald-500", text: "text-emerald-700" };
    if (rate >= 60) return { dot: "bg-amber-500", text: "text-amber-700" };
    return { dot: "bg-red-500", text: "text-red-700" };
}
