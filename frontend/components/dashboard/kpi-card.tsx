"use client";

import Link from "next/link";
import { ExternalLink, type LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tip } from "@/components/ui/tooltip";

/**
 * Vignette de chiffre-clé du tableau de bord.
 *
 * Les vignettes étaient écrites une par une, avec le même balisage recopié à
 * chaque fois : d'où des divergences de mise en forme, une valeur tronquée
 * (« 2m 13… ») et une flèche d'évolution qui passait à la ligne.
 *
 * La cause tenait à la mise en page : la valeur et l'évolution se disputaient
 * la même ligne, si bien que la plus longue des deux chassait l'autre. Elles
 * occupent désormais deux lignes distinctes — la valeur seule, puis
 * l'évolution avec la légende. Aucune ne peut plus rogner l'autre, quelle que
 * soit la largeur.
 */

export interface KpiTrend {
    current: number;
    previous: number;
    /** true quand une BAISSE est une bonne nouvelle (appels perdus, attente). */
    lowerIsBetter?: boolean;
}

interface KpiCardProps {
    label: string;
    /** Déjà formatée : nombre, durée, pourcentage. */
    value: string;
    icon: LucideIcon;
    /** Teinte de la valeur ; le reste de la vignette demeure neutre. */
    tone?: "neutral" | "positive" | "negative" | "info";
    subtitle?: string;
    trend?: KpiTrend;
    isLoading?: boolean;
    /** Rend la vignette cliquable vers les journaux correspondants. */
    href?: string;
}

const TONES: Record<NonNullable<KpiCardProps["tone"]>, { value: string; icon: string }> = {
    neutral: { value: "text-slate-900", icon: "text-slate-400" },
    positive: { value: "text-emerald-600", icon: "text-emerald-500" },
    negative: { value: "text-rose-600", icon: "text-rose-500" },
    info: { value: "text-indigo-600", icon: "text-indigo-500" },
};

function Trend({ current, previous, lowerIsBetter = false }: KpiTrend) {
    // Sans point de comparaison, mieux vaut ne rien dire qu'afficher « +∞ ».
    if (!previous) return null;

    const diff = current - previous;
    if (diff === 0) {
        return <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-500">=</span>;
    }

    const rising = diff > 0;
    const good = lowerIsBetter ? !rising : rising;
    const percent = Math.abs((diff / previous) * 100).toFixed(1);

    return (
        <Tip content={`Période précédente : ${previous.toLocaleString("fr-CH")}`}>
            <span
                className={`shrink-0 whitespace-nowrap rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${
                    good ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"
                }`}
            >
                {rising ? "↑" : "↓"} {percent} %
            </span>
        </Tip>
    );
}

export function KpiCard({
    label,
    value,
    icon: Icon,
    tone = "neutral",
    subtitle,
    trend,
    isLoading = false,
    href,
}: KpiCardProps) {
    const colors = TONES[tone];

    const contenu = (
        <Card className={`border-slate-200/70 shadow-sm transition-shadow hover:shadow-md ${href ? "h-full hover:border-blue-300" : ""}`}>
            <CardContent className="p-4">
                <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium text-slate-600">{label}</span>
                    {/* Le lien se signale par une icône discrète, comme sur les
                        vignettes des statistiques de groupe. */}
                    {href
                        ? <ExternalLink className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                        : <Icon className={`h-4 w-4 shrink-0 ${colors.icon}`} />}
                </div>

                {/* La valeur occupe sa propre ligne : rien ne peut la tronquer. */}
                {isLoading ? (
                    <Skeleton className="h-9 w-24" />
                ) : (
                    <div
                        className={`truncate whitespace-nowrap text-3xl font-bold tabular-nums leading-none ${colors.value}`}
                        title={value}
                    >
                        {value}
                    </div>
                )}

                {(trend || subtitle) && (
                    <div className="mt-2 flex items-center gap-2">
                        {trend && !isLoading && <Trend {...trend} />}
                        {subtitle && (
                            <span className="truncate text-xs text-slate-500" title={subtitle}>
                                {subtitle}
                            </span>
                        )}
                    </div>
                )}
            </CardContent>
        </Card>
    );

    if (!href) return contenu;
    return (
        <Link href={href} target="_blank" rel="noopener noreferrer" className="group block">
            {contenu}
        </Link>
    );
}
