"use client";

import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    Legend,
    ResponsiveContainer,
} from "recharts";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import type { ExtensionTrendPoint } from "@/types/extension-stats.types";

interface ExtensionTrendChartProps {
    data: ExtensionTrendPoint[];
    height?: number;
}

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
        const inbound = payload.find((p) => p.dataKey === "inbound")?.value || 0;
        const outbound = payload.find((p) => p.dataKey === "outbound")?.value || 0;

        return (
            <div className="bg-white/95 backdrop-blur-sm border border-slate-200 rounded-xl shadow-xl p-4">
                <p className="font-semibold text-slate-900 mb-3">{label}</p>
                <div className="space-y-2 text-sm">
                    <div className="flex items-center gap-3">
                        <span className="w-3 h-3 rounded-full bg-sky-500"></span>
                        <span className="text-slate-600 flex-1">Entrants:</span>
                        <span className="font-bold text-slate-900">{inbound}</span>
                    </div>
                    <div className="flex items-center gap-3">
                        <span className="w-3 h-3 rounded-full bg-indigo-500"></span>
                        <span className="text-slate-600 flex-1">Sortants:</span>
                        <span className="font-bold text-slate-900">{outbound}</span>
                    </div>
                    <div className="border-t border-slate-100 pt-2 mt-2 flex items-center justify-between">
                        <span className="text-slate-500 text-xs uppercase tracking-wider font-semibold">Total</span>
                        <span className="font-bold text-slate-900">{inbound + outbound}</span>
                    </div>
                </div>
            </div>
        );
    }
    return null;
};

export function ExtensionTrendChart({ data, height = 260 }: ExtensionTrendChartProps) {
    if (!data || data.length === 0) {
        return (
            <div
                className="flex items-center justify-center bg-slate-50/50 rounded-xl border-2 border-dashed border-slate-200"
                style={{ height }}
            >
                <p className="text-slate-500 font-medium">Aucune donnée pour cette période</p>
            </div>
        );
    }

    const chartData = data.map((point) => {
        const parsed = new Date(point.date + "T00:00:00");
        return {
            ...point,
            label: isNaN(parsed.getTime())
                ? point.date
                : format(parsed, "dd MMM", { locale: fr }),
        };
    });

    return (
        <div style={{ height }}>
            <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 5, right: 10, left: -15, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                    <XAxis
                        dataKey="label"
                        tick={{ fontSize: 11, fill: "#64748b" }}
                        tickLine={false}
                        axisLine={{ stroke: "#e2e8f0" }}
                        interval="preserveStartEnd"
                        minTickGap={30}
                    />
                    <YAxis
                        tick={{ fontSize: 11, fill: "#64748b" }}
                        tickLine={false}
                        axisLine={false}
                        allowDecimals={false}
                    />
                    <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(148, 163, 184, 0.1)" }} />
                    <Legend
                        formatter={(value: string) => (value === "inbound" ? "Entrants" : "Sortants")}
                        wrapperStyle={{ fontSize: 12 }}
                    />
                    <Bar dataKey="inbound" stackId="calls" fill="#0ea5e9" radius={[0, 0, 0, 0]} name="inbound" />
                    <Bar dataKey="outbound" stackId="calls" fill="#6366f1" radius={[3, 3, 0, 0]} name="outbound" />
                </BarChart>
            </ResponsiveContainer>
        </div>
    );
}
