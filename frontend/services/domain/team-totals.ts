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
    /** Vignette « Répondus » = répondus fins + transferts accomplis. */
    totalAnswered: number;
    /** Perdus : statuts « lost » de la file + directs perdus. */
    totalLost: number;
    /** Transferts accomplis (décrochés ici, servis ailleurs), file + directs. */
    totalHandedOff: number;
    /** Débordés (partis sans décroché), file + directs. */
    totalOverflowed: number;
    /** Vignette « Débordements » = débordés seuls (les transférés sont dans Répondus). */
    totalRedirected: number;
    /** Prise en charge (%), règle handedOffInPerformance appliquée. */
    performanceRate: number;
    /** Taux de perte (%) = perdus / reçus — LA consigne managériale (seuil 30 %). */
    lossRate: number;
}

export function computeTeamTotals(kpis: QueueKPIs): TeamTotals {
    const totalReceived = kpis.callsReceived + kpis.teamDirectReceived;
    const totalHandedOff = kpis.callsHandedOff + kpis.directHandedOff;
    // Décision d'août 2026 : le transfert accompli s'affiche dans « Répondus »
    // (l'équipe a décroché, le client a été servi) — la vignette orange ne
    // garde que les vrais débordements. Miroir de DEFAULT_OUTCOME_GROUPING.
    const answeredStrict = kpis.callsAnswered + kpis.teamDirectAnswered;
    const totalAnswered = answeredStrict + totalHandedOff;
    const totalLost = sumBucket(kpis.outcomeCounts, "lost") + kpis.directLost;
    const totalOverflowed = kpis.callsOverflow + kpis.directOverflow;
    const totalRedirected = totalOverflowed;

    // Un transfert accompli est un travail fait — décisif pour les réceptions
    // (règle handedOffInPerformance, configurable) ; le débordement sans
    // décroché reste toujours hors du numérateur.
    const handedOffCounts = kpis.handedOffInPerformance === "success";
    const totalHandled = answeredStrict + (handedOffCounts ? totalHandedOff : 0);
    const performanceRate = totalReceived > 0
        ? Math.round((totalHandled / totalReceived) * 100)
        : 0;
    const lossRate = totalReceived > 0
        ? Math.round((totalLost / totalReceived) * 100)
        : 0;

    return { totalReceived, totalAnswered, totalLost, totalHandedOff, totalOverflowed, totalRedirected, performanceRate, lossRate };
}

/**
 * Consigne managériale : le taux de perte doit rester SOUS ce seuil (en %).
 * La perte, c'est les perdus seuls — les débordements ne comptent pas dedans
 * (définition validée avec le métier, août 2026).
 */
export const LOSS_RATE_THRESHOLD = 30;
/** Pré-alerte : on passe en orange à seuil − marge, avant la sanction. */
export const LOSS_RATE_WARNING_MARGIN = 5;

export type LossVerdict = "ok" | "warning" | "over";

/** Verdict face à la consigne — « inférieur à 30 % » : 30 tout rond est déjà dépassé. */
export function lossVerdict(rate: number): LossVerdict {
    if (rate >= LOSS_RATE_THRESHOLD) return "over";
    if (rate >= LOSS_RATE_THRESHOLD - LOSS_RATE_WARNING_MARGIN) return "warning";
    return "ok";
}

