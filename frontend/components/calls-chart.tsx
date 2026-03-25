"use client";

import {
    AreaChart,
    Area,
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
        const total = answered + missed;
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
                        <span className="text-slate-600 flex-1">Manqués:</span>
                        <span className="font-bold text-slate-900">{missed}</span>
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
    if (!data || data.length === 0) {
        return (
            <div className="h-[300px] flex items-center justify-center bg-slate-50/50 rounded-xl border-2 border-dashed border-slate-200">
                <p className="text-slate-500 font-medium">Aucune donnée pour cette période</p>
            </div>
        );
    }

    return (
        <div className="h-[400px] w-full">
            <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                    data={data}
                    margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                >
                    <defs>
                        <linearGradient id="colorAnswered" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#10b981" stopOpacity={0.4}/>
                            <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                        </linearGradient>
                        <linearGradient id="colorMissed" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.4}/>
                            <stop offset="95%" stopColor="#f43f5e" stopOpacity={0}/>
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
                    />
                    <Tooltip content={<CustomTooltip />} cursor={{ stroke: '#cbd5e1', strokeWidth: 1, strokeDasharray: '4 4' }} />
                    <Legend
                        wrapperStyle={{ paddingTop: "20px" }}
                        iconType="circle"
                        formatter={(value) => (
                            <span className="text-slate-600 font-medium ml-1">
                                {value === "answered" ? "Répondus" : "Manqués"}
                            </span>
                        )}
                    />
                    <Area
                        type="monotone"
                        dataKey="missed"
                        stackId="1"
                        stroke="#f43f5e"
                        strokeWidth={3}
                        fillOpacity={1}
                        fill="url(#colorMissed)"
                        activeDot={{ r: 6, strokeWidth: 0, fill: '#f43f5e' }}
                        name="missed"
                    />
                    <Area
                        type="monotone"
                        dataKey="answered"
                        stackId="1"
                        stroke="#10b981"
                        strokeWidth={3}
                        fillOpacity={1}
                        fill="url(#colorAnswered)"
                        activeDot={{ r: 6, strokeWidth: 0, fill: '#10b981' }}
                        name="answered"
                    />
                </AreaChart>
            </ResponsiveContainer>
        </div>
    );
}
