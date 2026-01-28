"use client";

import { DailyTrend, HourlyTrend } from "@/types/statistics.types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp, Clock } from "lucide-react";
import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    Legend,
    ResponsiveContainer,
    LineChart,
    Line,
} from "recharts";
import { format, parseISO } from "date-fns";
import { fr } from "date-fns/locale";

interface TrendChartsProps {
    dailyTrend: DailyTrend[];
    hourlyTrend: HourlyTrend[];
}

export function TrendCharts({ dailyTrend, hourlyTrend }: TrendChartsProps) {
    // Format daily data for chart
    const formattedDailyData = dailyTrend.map((d) => ({
        ...d,
        dateLabel: format(parseISO(d.date), "dd/MM", { locale: fr }),
        dateFull: format(parseISO(d.date), "EEEE d MMMM", { locale: fr }),
    }));

    // Format hourly data for chart
    const formattedHourlyData = hourlyTrend.map((h) => ({
        ...h,
        hourLabel: `${h.hour}h`,
    }));

    const CustomTooltip = ({ active, payload, label }: any) => {
        if (active && payload && payload.length) {
            return (
                <div className="bg-white p-3 border rounded-lg shadow-lg">
                    <p className="font-medium text-slate-900 mb-1">{payload[0]?.payload?.dateFull || label}</p>
                    {payload.map((entry: any, index: number) => (
                        <p key={index} style={{ color: entry.color }} className="text-sm">
                            {entry.name}: {entry.value}
                        </p>
                    ))}
                </div>
            );
        }
        return null;
    };

    return (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Daily Trend */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <TrendingUp className="h-5 w-5 text-blue-600" />
                        Évolution journalière
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    {dailyTrend.length === 0 ? (
                        <div className="h-64 flex items-center justify-center text-slate-500">
                            Aucune donnée disponible
                        </div>
                    ) : (
                        <ResponsiveContainer width="100%" height={300}>
                            <BarChart data={formattedDailyData}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                                <XAxis
                                    dataKey="dateLabel"
                                    tick={{ fontSize: 11, fill: "#64748b" }}
                                    tickLine={{ stroke: "#e2e8f0" }}
                                />
                                <YAxis
                                    tick={{ fontSize: 11, fill: "#64748b" }}
                                    tickLine={{ stroke: "#e2e8f0" }}
                                />
                                <Tooltip content={<CustomTooltip />} />
                                <Legend />
                                <Bar
                                    dataKey="received"
                                    name="Reçus"
                                    fill="#3b82f6"
                                    radius={[4, 4, 0, 0]}
                                />
                                <Bar
                                    dataKey="answered"
                                    name="Répondus"
                                    fill="#10b981"
                                    radius={[4, 4, 0, 0]}
                                />
                                <Bar
                                    dataKey="abandoned"
                                    name="Abandonnés"
                                    fill="#ef4444"
                                    radius={[4, 4, 0, 0]}
                                />
                            </BarChart>
                        </ResponsiveContainer>
                    )}
                </CardContent>
            </Card>

            {/* Hourly Trend */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Clock className="h-5 w-5 text-blue-600" />
                        Répartition horaire
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <ResponsiveContainer width="100%" height={300}>
                        <LineChart data={formattedHourlyData}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                            <XAxis
                                dataKey="hourLabel"
                                tick={{ fontSize: 11, fill: "#64748b" }}
                                tickLine={{ stroke: "#e2e8f0" }}
                            />
                            <YAxis
                                tick={{ fontSize: 11, fill: "#64748b" }}
                                tickLine={{ stroke: "#e2e8f0" }}
                            />
                            <Tooltip />
                            <Legend />
                            <Line
                                type="monotone"
                                dataKey="received"
                                name="Reçus"
                                stroke="#3b82f6"
                                strokeWidth={2}
                                dot={{ fill: "#3b82f6", strokeWidth: 2, r: 3 }}
                            />
                            <Line
                                type="monotone"
                                dataKey="answered"
                                name="Répondus"
                                stroke="#10b981"
                                strokeWidth={2}
                                dot={{ fill: "#10b981", strokeWidth: 2, r: 3 }}
                            />
                            <Line
                                type="monotone"
                                dataKey="abandoned"
                                name="Abandonnés"
                                stroke="#ef4444"
                                strokeWidth={2}
                                dot={{ fill: "#ef4444", strokeWidth: 2, r: 3 }}
                            />
                        </LineChart>
                    </ResponsiveContainer>
                </CardContent>
            </Card>
        </div>
    );
}
