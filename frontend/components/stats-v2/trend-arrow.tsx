"use client";

import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";

import { Skeleton } from "@/components/ui/skeleton";
import { Tip } from "@/components/ui/tooltip";
import { trendDirection, type TrendDirection } from "@/services/domain/period-comparison";

/**
 * Flèche de comparaison N-1 d'un chiffre de vignette (façon Shopify).
 *
 * La couleur dit « bonne ou mauvaise nouvelle », pas « monte ou descend » :
 * une hausse des Perdus est ROUGE. Les métriques de volume (Total reçus,
 * Redirigés) restent grises quel que soit le sens — un volume n'est ni bien
 * ni mal. Le détail chiffré vit dans l'infobulle, pas sur la carte.
 *
 * Le slot a une largeur FIXE dans ses trois états — squelette (comparaison en
 * chargement), flèche, vide (pas de période de comparaison) : les chiffres ne
 * se décalent jamais quand la flèche apparaît… ou n'apparaît pas.
 */

export type TrendSense = "higher-better" | "lower-better" | "neutral";

interface Props {
    current: number;
    /** « loading » = squelette ; « unavailable » = slot vide, aucune flèche. */
    previous: number | "loading" | "unavailable";
    sense: TrendSense;
    /** « points » pour un taux (écart en points) ; « count » pour un volume. */
    unit?: "count" | "points";
}

const FLAT_CLASS = "text-slate-400";

function arrowClass(direction: TrendDirection, sense: TrendSense): string {
    if (direction === "flat" || sense === "neutral") return FLAT_CLASS;
    const good = sense === "higher-better" ? direction === "up" : direction === "down";
    return good ? "text-emerald-600" : "text-red-500";
}

function tooltip(current: number, previous: number, unit: "count" | "points", direction: TrendDirection): string {
    const base = unit === "points"
        ? `Période précédente : ${previous} %`
        : `Période précédente : ${previous.toLocaleString("fr-CH")}`;
    if (direction === "flat") return `${base} (équivalent)`;
    if (unit === "points") {
        const diff = current - previous;
        return `${base} (${diff > 0 ? "+" : ""}${diff} pts)`;
    }
    // Depuis zéro, aucun pourcentage n'est calculable : la base suffit.
    if (previous === 0) return base;
    const pct = ((current - previous) / previous) * 100;
    return `${base} (${pct > 0 ? "+" : ""}${pct.toLocaleString("fr-CH", { maximumFractionDigits: 1 })} %)`;
}

export function TrendArrow({ current, previous, sense, unit = "count" }: Props) {
    if (previous === "loading") {
        return (
            <span className="inline-flex w-3.5 shrink-0 justify-center">
                <Skeleton className="h-3 w-3 rounded-sm" />
            </span>
        );
    }
    if (previous === "unavailable") {
        return <span className="inline-flex w-3.5 shrink-0" aria-hidden />;
    }

    const direction = trendDirection(current, previous);
    const Icon = direction === "up" ? ArrowUpRight : direction === "down" ? ArrowDownRight : Minus;

    return (
        <Tip content={tooltip(current, previous, unit, direction)}>
            <span className={`inline-flex w-3.5 shrink-0 justify-center ${arrowClass(direction, sense)}`}>
                <Icon className="h-3.5 w-3.5" strokeWidth={2.5} />
            </span>
        </Tip>
    );
}
