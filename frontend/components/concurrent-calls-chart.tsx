"use client";

import {
    LineChart,
    Line,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ReferenceLine,
    ResponsiveContainer,
} from "recharts";
import { ConcurrentCallsDataPoint, ConcurrentCallsSummary } from "@/types/stats.types";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { AlertTriangle, TrendingUp, Activity, Shield } from "lucide-react";

interface ConcurrentCallsChartProps {
    data: ConcurrentCallsDataPoint[];
    summary: ConcurrentCallsSummary;
}

const CustomTooltip = ({
    active,
    payload,
}: {
    active?: boolean;
    payload?: Array<{ value: number; payload: ConcurrentCallsDataPoint }>;
}) => {
    if (active && payload && payload.length) {
        const point = payload[0].payload;
        const date = new Date(point.timestamp);

        return (
            <div className="bg-white/95 backdrop-blur-sm border border-slate-200 rounded-xl shadow-xl p-4 transition-all">
                <p className="font-semibold text-slate-900 mb-2">
                    {format(date, "dd MMM yyyy HH:mm", { locale: fr })}
                </p>
                <div className="space-y-1.5 text-sm">
                    <div className="flex items-center gap-3">
                        <span className="w-3 h-3 rounded-full bg-cyan-500 shadow-sm shadow-cyan-200"></span>
                        <span className="text-slate-600 flex-1">Appels simultanés:</span>
                        <span className="font-bold text-slate-900">{point.concurrentCalls}</span>
                    </div>
                </div>
            </div>
        );
    }
    return null;
};

function KpiCard({
    icon: Icon,
    label,
    value,
    subtext,
    color,
}: {
    icon: React.ElementType;
    label: string;
    value: string | number;
    subtext?: string;
    color: "cyan" | "emerald" | "rose" | "amber";
}) {
    const colorMap = {
        cyan: {
            icon: "text-cyan-500",
            bg: "from-white to-cyan-50/10",
            value: "text-slate-900",
        },
        emerald: {
            icon: "text-emerald-500",
            bg: "from-white to-emerald-50/10",
            value: "text-emerald-600",
        },
        rose: {
            icon: "text-rose-500",
            bg: "from-white to-rose-50/10",
            value: "text-rose-600",
        },
        amber: {
            icon: "text-amber-500",
            bg: "from-white to-amber-50/10",
            value: "text-amber-600",
        },
    };

    const c = colorMap[color];

    return (
        <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border border-slate-200/60 bg-gradient-to-br ${c.bg}`}>
            <Icon className={`h-5 w-5 ${c.icon} opacity-80 shrink-0`} />
            <div className="min-w-0">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{label}</p>
                <p className={`text-lg font-bold ${c.value} truncate`}>{value}</p>
                {subtext && <p className="text-[11px] text-slate-400 font-medium">{subtext}</p>}
            </div>
        </div>
    );
}

export function ConcurrentCallsChart({ data, summary }: ConcurrentCallsChartProps) {
    if (!data || data.length === 0) {
        return (
            <div className="h-[300px] flex items-center justify-center bg-slate-50/50 rounded-xl border-2 border-dashed border-slate-200">
                <p className="text-slate-500 font-medium">Aucune donnée pour cette période</p>
            </div>
        );
    }

    const margin = summary.threshold - summary.peak;
    const isOverThreshold = summary.peak >= summary.threshold;
    const peakDate = summary.peakTime ? new Date(summary.peakTime) : null;
    const peakDateFormatted = peakDate ? format(peakDate, "dd MMM yyyy 'à' HH:mm", { locale: fr }) : "N/A";

    const maxDataValue = Math.max(...data.map((d) => d.concurrentCalls));
    const yAxisMax = Math.max(maxDataValue, summary.threshold) + 5;

    return (
        <div className="space-y-4">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <KpiCard
                    icon={TrendingUp}
                    label="Pic maximum"
                    value={summary.peak}
                    subtext={peakDateFormatted}
                    color={isOverThreshold ? "rose" : "cyan"}
                />
                <KpiCard
                    icon={Activity}
                    label="Moyenne"
                    value={summary.avg}
                    subtext="appels simultanés"
                    color="cyan"
                />
                <KpiCard
                    icon={Shield}
                    label="Seuil licence"
                    value={summary.threshold}
                    subtext="appels simultanés"
                    color="amber"
                />
                <KpiCard
                    icon={isOverThreshold ? AlertTriangle : Shield}
                    label="Marge"
                    value={isOverThreshold ? `+${Math.abs(margin)}` : margin}
                    subtext={isOverThreshold ? "dépassement !" : "appels restants"}
                    color={isOverThreshold ? "rose" : "emerald"}
                />
            </div>

            <div className="h-[300px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                    <LineChart
                        data={data}
                        margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                    >
                        <defs>
                            <linearGradient id="ecgLineGradient" x1="0" y1="0" x2="1" y2="0">
                                <stop offset="0%" stopColor="#06b6d4" />
                                <stop offset="50%" stopColor="#0891b2" />
                                <stop offset="100%" stopColor="#06b6d4" />
                            </linearGradient>
                            <filter id="glow">
                                <feGaussianBlur stdDeviation="2" result="coloredBlur" />
                                <feMerge>
                                    <feMergeNode in="coloredBlur" />
                                    <feMergeNode in="SourceGraphic" />
                                </feMerge>
                            </filter>
                        </defs>
                        <CartesianGrid
                            strokeDasharray="2 4"
                            vertical={true}
                            stroke="#e2e8f0"
                            strokeOpacity={0.5}
                        />
                        <XAxis
                            dataKey="label"
                            tick={{ fontSize: 11, fill: "#94a3b8" }}
                            tickLine={false}
                            axisLine={false}
                            dy={10}
                            interval="preserveStartEnd"
                            minTickGap={60}
                        />
                        <YAxis
                            tick={{ fontSize: 11, fill: "#94a3b8" }}
                            tickLine={false}
                            axisLine={false}
                            dx={-10}
                            domain={[0, yAxisMax]}
                        />
                        <Tooltip
                            content={<CustomTooltip />}
                            cursor={{
                                stroke: "#94a3b8",
                                strokeWidth: 1,
                                strokeDasharray: "4 4",
                            }}
                        />
                        <ReferenceLine
                            y={summary.threshold}
                            stroke="#f43f5e"
                            strokeDasharray="6 4"
                            strokeWidth={2}
                            label={{
                                value: `Licence ${summary.threshold} SC`,
                                position: "insideTopRight",
                                fill: "#f43f5e",
                                fontSize: 11,
                                fontWeight: 600,
                            }}
                        />
                        <Line
                            type="monotone"
                            dataKey="concurrentCalls"
                            stroke="url(#ecgLineGradient)"
                            strokeWidth={2}
                            dot={false}
                            activeDot={{
                                r: 5,
                                strokeWidth: 0,
                                fill: "#06b6d4",
                                filter: "url(#glow)",
                            }}
                            name="Appels simultanés"
                        />
                    </LineChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}
