"use client";

import {
    ComposedChart,
    Line,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    Legend,
    ResponsiveContainer,
} from "recharts";
import { TimelineDataPoint } from "@/types/stats.types";

interface CallsChartProps {
    data: TimelineDataPoint[];
    /**
     * Courbe de la période précédente, superposée en pointillés estompés
     * (null / absente = superposition inactive). Période ALIGNÉE SEMAINE
     * (cf. period-comparison) : un lundi se superpose à un lundi.
     */
    previousData?: TimelineDataPoint[] | null;
    /**
     * Décalage (ms) entre la période courante et la précédente : les points
     * N-1 s'alignent par DATE décalée, pas par rang — un jour sans appel
     * manquant dans une des deux séries ne désynchronise pas le reste.
     */
    previousOffsetMs?: number;
}

/** Point du graphique : la journée N, enrichie de son vis-à-vis N-1. */
interface ChartPoint extends TimelineDataPoint {
    answeredPrev?: number;
    missedPrev?: number;
    prevLabel?: string;
}

// Custom tooltip component
const CustomTooltip = ({
    active,
    payload,
    label,
}: {
    active?: boolean;
    payload?: Array<{ value: number; dataKey: string; color: string; payload?: ChartPoint }>;
    label?: string;
}) => {
    if (active && payload && payload.length) {
        const answered = payload.find((p) => p.dataKey === "answered")?.value || 0;
        const missed = payload.find((p) => p.dataKey === "missed")?.value || 0;
        const overflow = payload.find((p) => p.dataKey === "overflow")?.value || 0;
        const total = answered + missed + overflow;
        // La série n'existe que sur le bilan d'équipe ; le tableau de bord
        // global ne raisonne pas par file.
        const hasOverflow = payload.some((p) => p.dataKey === "overflow");
        const rate = total > 0 ? Math.round((answered / total) * 100) : 0;
        const point = payload[0]?.payload;
        const hasPrev = point !== undefined
            && (point.answeredPrev !== undefined || point.missedPrev !== undefined);

        return (
            <div className="bg-white/95 backdrop-blur-sm border border-slate-200 rounded-xl shadow-xl p-4 transition-all">
                <p className="font-semibold text-slate-900 mb-3">{label}</p>
                <div className="space-y-2 text-sm">
                    <div className="flex items-center gap-3">
                        <span className="w-3 h-3 rounded-full bg-emerald-500 shadow-sm shadow-emerald-200"></span>
                        <span className="text-slate-600 flex-1">Répondus:</span>
                        <span className="font-bold text-slate-900">{answered}</span>
                    </div>
                    <div className="flex items-center gap-3">
                        <span className="w-3 h-3 rounded-full bg-rose-500 shadow-sm shadow-rose-200"></span>
                        <span className="text-slate-600 flex-1">Perdus:</span>
                        <span className="font-bold text-slate-900">{missed}</span>
                    </div>
                    {hasOverflow && (
                        <div className="flex items-center gap-3">
                            <span className="w-3 h-3 rounded-full bg-amber-500 shadow-sm shadow-amber-200"></span>
                            <span className="text-slate-600 flex-1">Débordements:</span>
                            <span className="font-bold text-slate-900">{overflow}</span>
                        </div>
                    )}
                    <div className="flex items-center justify-between border-t border-slate-100 pt-2">
                        <span className="text-slate-500 text-xs uppercase tracking-wider font-semibold">Total reçus</span>
                        <span className="font-bold text-slate-900">{total}</span>
                    </div>
                    <div className="border-t border-slate-100 pt-2 mt-2">
                        <div className="flex items-center justify-between">
                            <span className="text-slate-500 text-xs uppercase tracking-wider font-semibold">Taux réponse</span>
                            <span className="font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-md">{rate}%</span>
                        </div>
                    </div>
                    {hasPrev && (
                        <div className="border-t border-slate-100 pt-2 mt-2 space-y-1.5">
                            <p className="text-slate-400 text-xs uppercase tracking-wider font-semibold">
                                Période préc.{point.prevLabel ? ` (${point.prevLabel})` : ""}
                            </p>
                            <div className="flex items-center gap-3">
                                <span className="w-3 h-3 rounded-full bg-emerald-500 opacity-40"></span>
                                <span className="text-slate-500 flex-1">Répondus:</span>
                                <span className="font-semibold text-slate-600">{point.answeredPrev ?? 0}</span>
                            </div>
                            <div className="flex items-center gap-3">
                                <span className="w-3 h-3 rounded-full bg-rose-500 opacity-40"></span>
                                <span className="text-slate-500 flex-1">Perdus:</span>
                                <span className="font-semibold text-slate-600">{point.missedPrev ?? 0}</span>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        );
    }
    return null;
};

export function CallsChart({ data, previousData, previousOffsetMs = 0 }: CallsChartProps) {
    // Alignement N-1 par date décalée : chaque point N cherche son vis-à-vis
    // exactement previousOffsetMs plus tôt. Un jour absent d'une série (SQL ne
    // produit pas de ligne sans appel) laisse simplement un trou dans la
    // courbe pointillée, sans décaler les jours suivants.
    const prevByTime = new Map<number, TimelineDataPoint>();
    if (previousData && previousOffsetMs > 0) {
        for (const p of previousData) {
            prevByTime.set(new Date(p.date).getTime() + previousOffsetMs, p);
        }
    }
    const showPrevious = prevByTime.size > 0;

    const points: ChartPoint[] = (data ?? []).map((d) => {
        const prev = prevByTime.get(new Date(d.date).getTime());
        return {
            ...d,
            answeredPrev: prev?.answered,
            missedPrev: prev?.missed,
            prevLabel: prev?.label,
        };
    });

    // Le tableau de bord global ne raisonne pas par file : ni courbe ni entrée
    // de légende pour une série qui n'existe pas.
    const hasOverflow = points.some((p) => p.overflow !== undefined);

    if (!data || data.length === 0) {
        return (
            <div className="h-[300px] flex items-center justify-center bg-slate-50/50 rounded-xl border-2 border-dashed border-slate-200">
                <p className="text-slate-500 font-medium">Aucune donnée pour cette période</p>
            </div>
        );
    }

    return (
        <div className="h-[425px] w-full">
            <ResponsiveContainer width="100%" height="100%">
                {/* Courbes SUPERPOSEES, non empilees.

                    L'empilement rendait le graphique illisible : le bord d'une
                    bande valant la somme cumulee, une serie de 8 appels se
                    lisait entre 20 et 40 sur l'axe. Chaque courbe se lit
                    desormais directement contre l'axe. Le total recu vit dans
                    l'infobulle : l'enveloppe grise qui le portait ecrasait
                    l'echelle sans rien apprendre de plus. */}
                <ComposedChart
                    data={points}
                    margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                >
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis
                        dataKey="label"
                        tick={{ fontSize: 12, fill: "#94a3b8" }}
                        tickLine={false}
                        axisLine={false}
                        dy={10}
                    />
                    <YAxis
                        tick={{ fontSize: 12, fill: "#94a3b8" }}
                        tickLine={false}
                        axisLine={false}
                        dx={-10}
                        allowDecimals={false}
                    />
                    <Tooltip content={<CustomTooltip />} cursor={{ stroke: '#cbd5e1', strokeWidth: 1, strokeDasharray: '4 4' }} />
                    <Legend
                        wrapperStyle={{ paddingTop: "20px" }}
                        iconType="circle"
                        formatter={(value) => (
                            <span className="text-slate-600 font-medium ml-1">
                                {value === "answered" ? "Répondus"
                                    : value === "overflow" ? "Débordements"
                                    : "Perdus"}
                            </span>
                        )}
                    />
                    {/* Superposition N-1 : pointillés estompés, seulement les
                        deux séries de tête — doubler aussi Débordements noierait
                        le graphique. Hors légende : le toggle « Période
                        précédente » les nomme déjà, et leurs pastilles y
                        seraient identiques aux courbes N. */}
                    {showPrevious && (
                        <Line
                            type="monotone"
                            dataKey="answeredPrev"
                            stroke="#10b981"
                            strokeWidth={2}
                            strokeOpacity={0.35}
                            strokeDasharray="6 4"
                            dot={false}
                            activeDot={false}
                            legendType="none"
                            name="answeredPrev"
                        />
                    )}
                    {showPrevious && (
                        <Line
                            type="monotone"
                            dataKey="missedPrev"
                            stroke="#f43f5e"
                            strokeWidth={2}
                            strokeOpacity={0.35}
                            strokeDasharray="6 4"
                            dot={false}
                            activeDot={false}
                            legendType="none"
                            name="missedPrev"
                        />
                    )}
                    <Line
                        type="monotone"
                        dataKey="answered"
                        stroke="#10b981"
                        strokeWidth={2.5}
                        dot={false}
                        activeDot={{ r: 5, strokeWidth: 0, fill: '#10b981' }}
                        name="answered"
                    />
                    <Line
                        type="monotone"
                        dataKey="missed"
                        stroke="#f43f5e"
                        strokeWidth={2.5}
                        dot={false}
                        activeDot={{ r: 5, strokeWidth: 0, fill: '#f43f5e' }}
                        name="missed"
                    />
                    {hasOverflow && <Line
                        type="monotone"
                        dataKey="overflow"
                        stroke="#f59e0b"
                        strokeWidth={2.5}
                        dot={false}
                        activeDot={{ r: 5, strokeWidth: 0, fill: '#f59e0b' }}
                        name="overflow"
                    />}
                </ComposedChart>
            </ResponsiveContainer>
        </div>
    );
}
