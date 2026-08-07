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
 * Débordements) restent grises quel que soit le sens — un volume n'est ni bien
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
    /** Contexte ajouté à l'infobulle (ex. « — 47 pris en charge »). */
    detail?: string;
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

export function TrendArrow({ current, previous, sense, unit = "count", detail }: Props) {
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
        <Tip content={tooltip(current, previous, unit, direction) + (detail ? ` ${detail}` : "")}>
            <span className={`inline-flex w-3.5 shrink-0 justify-center ${arrowClass(direction, sense)}`}>
                <Icon className="h-3.5 w-3.5" strokeWidth={2.5} />
            </span>
        </Tip>
    );
}

/**
 * Variante « pastille » de la flèche — pour les vignettes du bilan d'équipe,
 * qui ont la place d'afficher le delta en clair (« ↗ +9,9 % », « +5 pts »)
 * façon Shopify. Mêmes états et même sémantique de couleur que TrendArrow ;
 * « unavailable » ne réserve aucun slot : la pastille vit en bout de ligne,
 * son absence ne décale rien.
 */
function pillClass(direction: TrendDirection, sense: TrendSense): string {
    if (direction === "flat" || sense === "neutral") return "bg-slate-100 text-slate-500";
    const good = sense === "higher-better" ? direction === "up" : direction === "down";
    return good ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700";
}

function pillLabel(current: number, previous: number, unit: "count" | "points"): string {
    if (unit === "points") {
        const diff = current - previous;
        return `${diff > 0 ? "+" : ""}${diff} pts`;
    }
    // Depuis zéro, aucun pourcentage n'est calculable : flèche seule.
    if (previous === 0) return "";
    const pct = ((current - previous) / previous) * 100;
    return `${pct > 0 ? "+" : ""}${pct.toLocaleString("fr-CH", { maximumFractionDigits: 1 })} %`;
}

export function TrendPill({ current, previous, sense, unit = "count", detail }: Props) {
    if (previous === "loading") {
        return <Skeleton className="h-[18px] w-12 shrink-0 rounded-full" />;
    }
    if (previous === "unavailable") return null;

    const direction = trendDirection(current, previous);
    const Icon = direction === "up" ? ArrowUpRight : direction === "down" ? ArrowDownRight : Minus;

    return (
        <Tip content={tooltip(current, previous, unit, direction) + (detail ? ` ${detail}` : "")}>
            <span className={`inline-flex shrink-0 items-center gap-0.5 whitespace-nowrap rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${pillClass(direction, sense)}`}>
                <Icon className="h-3 w-3" strokeWidth={2.5} />
                {pillLabel(current, previous, unit)}
            </span>
        </Tip>
    );
}
