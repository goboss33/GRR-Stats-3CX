"use client";

import { Phone, PhoneIncoming, PhoneMissed, ArrowRightLeft } from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";

import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { computeTeamTotals, performanceTone } from "@/services/domain/team-totals";
import type { QueueKPIs } from "@/types/statistics.types";

/**
 * Carte d'aperçu d'un groupe — le « clin d'œil » du manager.
 *
 * Les chiffres viennent de computeTeamTotals sur la MÊME réponse d'API que
 * l'écran détail : la carte et le détail ne peuvent pas se contredire. La
 * pastille reprend les seuils de la barre de prise en charge (vert ≥ 80 %,
 * ambre ≥ 60 %, rouge en dessous) ; le donut est la version simple à trois
 * segments — les couleurs des vignettes Répondus / Perdus / Redirigés.
 */

const DONUT_COLORS = { answered: "#10b981", lost: "#ef4444", redirected: "#f59e0b" };

interface Props {
    queueNumber: string;
    queueName: string;
    /** null = en cours de chargement (squelette). */
    kpis: QueueKPIs | null;
    onSelect: (queueNumber: string, queueName: string) => void;
}

export function QueueOverviewCard({ queueNumber, queueName, kpis, onSelect }: Props) {
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
    const tone = performanceTone(totals.performanceRate);

    const donut = [
        { name: "Répondus", value: totals.totalAnswered, color: DONUT_COLORS.answered },
        { name: "Perdus", value: totals.totalLost, color: DONUT_COLORS.lost },
        { name: "Redirigés", value: totals.totalRedirected, color: DONUT_COLORS.redirected },
    ].filter((d) => d.value > 0);

    return (
        <Card
            className="cursor-pointer border-slate-200 transition-all hover:border-blue-300 hover:shadow-md"
            onClick={() => onSelect(queueNumber, queueName)}
            title={`Ouvrir le détail de ${queueName}`}
        >
            <CardContent className="p-4">
                <div className="mb-3 flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-semibold text-slate-800">
                        <span className="font-mono text-xs text-slate-400">{queueNumber}</span> · {queueName}
                    </span>
                    <span
                        className={`flex shrink-0 items-center gap-1.5 text-sm font-bold ${tone.text}`}
                        title="Taux de prise en charge (répondus + transferts accomplis / reçus)"
                    >
                        <span className={`inline-block h-2.5 w-2.5 rounded-full ${tone.dot}`} />
                        {totals.performanceRate} %
                    </span>
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
                            <dd className="font-semibold tabular-nums text-slate-800">{totals.totalReceived}</dd>
                        </div>
                        <div className="flex items-center justify-between">
                            <dt className="flex items-center gap-1.5 text-slate-500">
                                <Phone className="h-3.5 w-3.5 text-emerald-600" /> Répondus
                            </dt>
                            <dd className="font-semibold tabular-nums text-emerald-700">{totals.totalAnswered}</dd>
                        </div>
                        <div className="flex items-center justify-between">
                            <dt className="flex items-center gap-1.5 text-slate-500">
                                <PhoneMissed className="h-3.5 w-3.5 text-red-500" /> Perdus
                            </dt>
                            <dd className="font-semibold tabular-nums text-red-700">{totals.totalLost}</dd>
                        </div>
                        <div className="flex items-center justify-between">
                            <dt className="flex items-center gap-1.5 text-slate-500">
                                <ArrowRightLeft className="h-3.5 w-3.5 text-amber-500" /> Redirigés
                            </dt>
                            <dd className="font-semibold tabular-nums text-amber-700">{totals.totalRedirected}</dd>
                        </div>
                    </dl>
                </div>
            </CardContent>
        </Card>
    );
}
