"use client";

import {
    ComposedChart,
    Area,
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
}

// Custom tooltip component
const CustomTooltip = ({
    active,
    payload,
    label,
}: {
    active?: boolean;
    payload?: Array<{ value: number; dataKey: string; color: string }>;
    label?: string;
}) => {
    if (active && payload && payload.length) {
        const answered = payload.find((p) => p.dataKey === "answered")?.value || 0;
        const missed = payload.find((p) => p.dataKey === "missed")?.value || 0;
        const overflow = payload.find((p) => p.dataKey === "overflow")?.value || 0;
        const total = payload.find((p) => p.dataKey === "total")?.value ?? (answered + missed + overflow);
        // La série n'existe que sur le bilan d'équipe ; le tableau de bord
        // global ne raisonne pas par file.
        const hasOverflow = payload.some((p) => p.dataKey === "overflow");
        const rate = total > 0 ? Math.round((answered / total) * 100) : 0;

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
                            <span className="text-slate-600 flex-1">Redirigés:</span>
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
                </div>
            </div>
        );
    }
    return null;
};

export function CallsChart({ data }: CallsChartProps) {
    // Le volume total est derive plutot que transmis : il vaut par construction
    // la somme des trois series, et le calculer ici garantit que l'enveloppe
    // grise ne peut pas contredire les courbes qu'elle contient.
    const points = (data ?? []).map((d) => ({
        ...d,
        total: d.answered + d.missed + (d.overflow ?? 0),
    }));

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
                    desormais directement contre l'axe, et l'enveloppe grise
                    porte le volume total — ce que le titre annonce. */}
                <ComposedChart
                    data={points}
                    margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                >
                    <defs>
                        <linearGradient id="colorTotal" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#94a3b8" stopOpacity={0.28}/>
                            <stop offset="95%" stopColor="#94a3b8" stopOpacity={0}/>
                        </linearGradient>
                    </defs>
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
                                    : value === "overflow" ? "Redirigés"
                                    : value === "total" ? "Total reçus"
                                    : "Perdus"}
                            </span>
                        )}
                    />
                    {/* Enveloppe du volume : sert de toile de fond, sans trait
                        marque, pour ne pas concurrencer les trois courbes. */}
                    <Area
                        type="monotone"
                        dataKey="total"
                        stroke="#cbd5e1"
                        strokeWidth={1}
                        fillOpacity={1}
                        fill="url(#colorTotal)"
                        activeDot={false}
                        name="total"
                    />
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
