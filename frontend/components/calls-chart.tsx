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
            <div className="bg-white border border-slate-200 rounded-lg shadow-lg p-3">
                <p className="font-medium text-slate-900 mb-2">{label}</p>
                <div className="space-y-1 text-sm">
                    <div className="flex items-center gap-2">
                        <span className="w-3 h-3 rounded bg-emerald-500"></span>
                        <span className="text-slate-600">Répondus:</span>
                        <span className="font-medium text-slate-900">{answered}</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="w-3 h-3 rounded bg-rose-500"></span>
                        <span className="text-slate-600">Manqués:</span>
                        <span className="font-medium text-slate-900">{missed}</span>
                    </div>
                    <div className="border-t border-slate-200 pt-1 mt-1">
                        <span className="text-slate-600">Taux réponse:</span>
                        <span className="font-medium text-slate-900 ml-2">{rate}%</span>
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
            <div className="h-[300px] flex items-center justify-center bg-slate-50 rounded-lg border-2 border-dashed border-slate-200">
                <p className="text-slate-500">Aucune donnée pour cette période</p>
            </div>
        );
    }

    return (
        <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
                <BarChart
                    data={data}
                    margin={{ top: 10, right: 30, left: 0, bottom: 0 }}
                >
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis
                        dataKey="label"
                        tick={{ fontSize: 12, fill: "#64748b" }}
                        tickLine={false}
                        axisLine={{ stroke: "#e2e8f0" }}
                    />
                    <YAxis
                        tick={{ fontSize: 12, fill: "#64748b" }}
                        tickLine={false}
                        axisLine={{ stroke: "#e2e8f0" }}
                    />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend
                        wrapperStyle={{ paddingTop: "20px" }}
                        formatter={(value) =>
                            value === "answered" ? "Répondus" : "Manqués"
                        }
                    />
                    <Bar
                        dataKey="answered"
                        stackId="calls"
                        fill="#10b981"
                        radius={[0, 0, 0, 0]}
                        name="answered"
                    />
                    <Bar
                        dataKey="missed"
                        stackId="calls"
                        fill="#f43f5e"
                        radius={[4, 4, 0, 0]}
                        name="missed"
                    />
                </BarChart>
            </ResponsiveContainer>
        </div>
    );
}
