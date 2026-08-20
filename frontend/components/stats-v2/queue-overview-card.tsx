"use client";

import { Phone, PhoneIncoming, PhoneMissed, ArrowRightLeft } from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";

import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tip } from "@/components/ui/tooltip";
import { LOSS_ICON } from "@/components/stats-v2/loss-badge";
import { TrendArrow } from "@/components/stats-v2/trend-arrow";
import { computeTeamTotals, lossVerdict, type TeamTotals } from "@/services/domain/team-totals";
import type { QueueKPIs } from "@/types/statistics.types";

/**
 * Carte d'aperçu d'un groupe — le « clin d'œil » du manager.
 *
 * Les chiffres viennent de computeTeamTotals sur la MÊME réponse d'API que
 * l'écran détail : la carte et le détail ne peuvent pas se contredire. Le
 * donut est la version simple à trois segments — les couleurs et l'ordre des
 * vignettes Répondus / Débordements / Perdus.
 *
 * Le coin supérieur droit porte le VERDICT de perte en symbole (LOSS_ICON) :
 * coche verte quand la consigne des 30 % est tenue, triangle orange à
 * l'approche, rouge au dépassement — dans la grille on scanne des symboles,
 * l'anomalie saute aux yeux et un agrégat multi-équipes de l'écran détail ne
 * peut plus la masquer. Son infobulle dit LE taux de perte, rien d'autre
 * (arbitrage utilisateur : pas de pédagogie ici, la consigne est connue).
 * Un groupe sans appel n'affiche RIEN : ni fausse coche rassurante, ni
 * fausse alarme.
 *
 * Chaque chiffre porte sa flèche de comparaison N-1 (période de même durée
 * juste avant, cf. period-comparison) — les mêmes formules computeTeamTotals
 * appliquées à la réponse N-1, donc comparables terme à terme.
 */

const DONUT_COLORS = { answered: "#10b981", lost: "#ef4444", redirected: "#f59e0b" };

interface Props {
    queueNumber: string;
    queueName: string;
    /** Département 3CX — enrichit l'infobulle du nom, jamais affiché seul. */
    queueDepartment?: string | null;
    /** null = en cours de chargement (squelette). */
    kpis: QueueKPIs | null;
    /** KPI de la période précédente — arrive après les chiffres N. */
    previousKpis: QueueKPIs | "loading" | "unavailable";
    onSelect: (queueNumber: string, queueName: string) => void;
}

export function QueueOverviewCard({ queueNumber, queueName, queueDepartment, kpis, previousKpis, onSelect }: Props) {
    if (!kpis) {
        return (
            <Card className="border-slate-200">
                <CardContent className="p-4">
                    <div className="mb-3 flex items-center justify-between">
                        <Skeleton className="h-4 w-40" />
                        <Skeleton className="h-4 w-12" />
                    </div>
                    <div className="flex items-center gap-4">
                        <Skeleton className="h-20 w-20 rounded-full" />
                        <div className="flex-1 space-y-2">
                            {Array.from({ length: 4 }).map((_, i) => (
                                <Skeleton key={i} className="h-3 w-full" />
                            ))}
                        </div>
                    </div>
                </CardContent>
            </Card>
        );
    }

    const totals = computeTeamTotals(kpis);
    const status = totals.totalReceived > 0 ? LOSS_ICON[lossVerdict(totals.lossRate)] : null;

    // Une période précédente sans AUCUN appel (groupe nouveau, données
    // absentes) ne compare rien : toutes les variations seraient « +∞ » —
    // pas de flèche du tout, comme pour une comparaison en échec.
    const prevTotals = typeof previousKpis === "object" ? computeTeamTotals(previousKpis) : null;
    const prevState: TeamTotals | "loading" | "unavailable" =
        previousKpis === "loading" ? "loading"
            : prevTotals && prevTotals.totalReceived > 0 ? prevTotals
                : "unavailable";
    const prevOf = (pick: (t: TeamTotals) => number) =>
        typeof prevState === "object" ? pick(prevState) : prevState;

    // Même ordre que la barre et les vignettes du détail : vert, ambre, rouge.
    const donut = [
        { name: "Répondus", value: totals.totalAnswered, color: DONUT_COLORS.answered },
        { name: "Débordements", value: totals.totalRedirected, color: DONUT_COLORS.redirected },
        { name: "Perdus", value: totals.totalLost, color: DONUT_COLORS.lost },
    ].filter((d) => d.value > 0);

    return (
        <Card
            className="cursor-pointer border-slate-200 transition-all hover:border-blue-300 hover:shadow-md"
            onClick={() => onSelect(queueNumber, queueName)}
        >
            <CardContent className="p-4">
                <div className="mb-3 flex items-center justify-between gap-2">
                    {/* Pas de numéro (bruit pour les managers) ni de title natif
                        sur la carte : le nom, souvent tronqué par le chip
                        d'alerte, porte l'infobulle instantanée avec la
                        filiation complète. */}
                    <Tip content={`${queueDepartment ? `${queueDepartment} — ` : ""}${queueName}`}>
                        <span className="truncate text-sm font-semibold text-slate-800">
                            {queueName}
                        </span>
                    </Tip>
                    {status && (
                        <Tip content={`Taux de perte ${totals.lossRate} %`}>
                            <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${status.wrap}`}>
                                <status.Icon className={`h-3.5 w-3.5 ${status.icon}`} strokeWidth={2.5} />
                            </span>
                        </Tip>
                    )}
                </div>

                <div className="flex items-center gap-4">
                    <div className="h-20 w-20 shrink-0">
                        <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                                <Pie
                                    data={donut}
                                    dataKey="value"
                                    innerRadius="62%"
                                    outerRadius="100%"
                                    strokeWidth={1}
                                    isAnimationActive={false}
                                >
                                    {donut.map((d) => (
                                        <Cell key={d.name} fill={d.color} />
                                    ))}
                                </Pie>
                            </PieChart>
                        </ResponsiveContainer>
                    </div>

                    <dl className="flex-1 space-y-1 text-[13px]">
                        <div className="flex items-center justify-between">
                            <dt className="flex items-center gap-1.5 text-slate-500">
                                <PhoneIncoming className="h-3.5 w-3.5" /> Total reçus
                            </dt>
                            <dd className="flex items-center gap-1 font-semibold tabular-nums text-slate-800">
                                {totals.totalReceived}
                                <TrendArrow current={totals.totalReceived} previous={prevOf((t) => t.totalReceived)} sense="neutral" />
                            </dd>
                        </div>
                        <div className="flex items-center justify-between">
                            <dt className="flex items-center gap-1.5 text-slate-500">
                                <Phone className="h-3.5 w-3.5 text-emerald-600" /> Répondus
                            </dt>
                            <dd className="flex items-center gap-1 font-semibold tabular-nums text-emerald-700">
                                {totals.totalAnswered}
                                <TrendArrow current={totals.totalAnswered} previous={prevOf((t) => t.totalAnswered)} sense="higher-better" />
                            </dd>
                        </div>
                        <div className="flex items-center justify-between">
                            <dt className="flex items-center gap-1.5 text-slate-500">
                                <ArrowRightLeft className="h-3.5 w-3.5 text-amber-500" /> Débordements
                            </dt>
                            <dd className="flex items-center gap-1 font-semibold tabular-nums text-amber-700">
                                {totals.totalRedirected}
                                <TrendArrow current={totals.totalRedirected} previous={prevOf((t) => t.totalRedirected)} sense="neutral" />
                            </dd>
                        </div>
                        <div className="flex items-center justify-between">
                            <dt className="flex items-center gap-1.5 text-slate-500">
                                <PhoneMissed className="h-3.5 w-3.5 text-red-500" /> Perdus
                            </dt>
                            <dd className="flex items-center gap-1 font-semibold tabular-nums text-red-700">
                                {totals.totalLost}
                                <TrendArrow current={totals.totalLost} previous={prevOf((t) => t.totalLost)} sense="lower-better" />
                            </dd>
                        </div>
                    </dl>
                </div>
            </CardContent>
        </Card>
    );
}
