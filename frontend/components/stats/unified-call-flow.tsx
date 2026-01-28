"use client";

import { QueueKPIs } from "@/types/statistics.types";
import { Card, CardContent } from "@/components/ui/card";
import { Clock } from "lucide-react";

interface UnifiedCallFlowProps {
    kpis: QueueKPIs;
    queueName: string;
    queueNumber: string;
}

export function UnifiedCallFlow({ kpis, queueName, queueNumber }: UnifiedCallFlowProps) {
    const totalEntrants = kpis.callsReceived;

    const formatDuration = (seconds: number): string => {
        if (seconds < 60) return `${seconds}s`;
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
    };

    const getPercentage = (value: number, total: number): string => {
        if (total === 0) return "0%";
        return `${Math.round((value / total) * 100)}%`;
    };

    return (
        <Card className="overflow-hidden">
            {/* Queue Header */}
            <div className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white px-6 py-4">
                <div className="flex items-center justify-between">
                    <div>
                        <h2 className="text-xl font-bold">{queueName}</h2>
                        <p className="text-blue-100 text-sm">File {queueNumber}</p>
                    </div>
                    <div className="flex items-center gap-2 bg-white/20 rounded-lg px-3 py-1.5">
                        <Clock className="h-4 w-4" />
                        <span className="text-sm">Attente moy: <strong>{formatDuration(kpis.avgWaitTimeSeconds)}</strong></span>
                    </div>
                </div>
            </div>

            <CardContent className="p-6">
                {/* Flow Diagram - Simplified version without Messagerie */}
                <div className="space-y-6">
                    {/* Level 1: Total Entrants */}
                    <div className="flex justify-center">
                        <div className="bg-slate-100 border-2 border-slate-300 rounded-xl px-8 py-4 text-center">
                            <p className="text-sm text-slate-500 font-medium">Appels en file d'attente</p>
                            <p className="text-4xl font-bold text-slate-900">{totalEntrants}</p>
                        </div>
                    </div>

                    {/* Connecting line */}
                    <div className="flex justify-center">
                        <div className="w-px h-8 bg-slate-300" />
                    </div>

                    {/* Level 2: Outcomes */}
                    <div className="grid grid-cols-3 gap-4">
                        {/* Répondus */}
                        <div className="space-y-2">
                            <div className="bg-emerald-50 border-2 border-emerald-300 rounded-xl p-4 text-center">
                                <p className="text-sm text-emerald-600 font-medium">✅ Répondus</p>
                                <p className="text-3xl font-bold text-emerald-700">{kpis.callsAnswered}</p>
                                <p className="text-sm text-emerald-500 font-medium">
                                    {getPercentage(kpis.callsAnswered, totalEntrants)}
                                </p>
                            </div>
                            {/* Progress bar */}
                            <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                                <div
                                    className="h-full bg-emerald-500 rounded-full transition-all duration-500"
                                    style={{ width: getPercentage(kpis.callsAnswered, totalEntrants) }}
                                />
                            </div>
                        </div>

                        {/* Abandonnés */}
                        <div className="space-y-2">
                            <div className="bg-red-50 border-2 border-red-200 rounded-xl p-4 text-center">
                                <p className="text-sm text-red-600 font-medium">❌ Abandonnés</p>
                                <p className="text-3xl font-bold text-red-700">{kpis.callsAbandoned}</p>
                                <p className="text-sm text-red-500 font-medium">
                                    {getPercentage(kpis.callsAbandoned, totalEntrants)}
                                </p>
                                <div className="flex justify-center gap-3 mt-2 text-xs">
                                    <span className="bg-red-100 text-red-600 px-2 py-0.5 rounded">
                                        &lt;10s: {kpis.abandonedBefore10s}
                                    </span>
                                    <span className="bg-red-100 text-red-600 px-2 py-0.5 rounded">
                                        ≥10s: {kpis.abandonedAfter10s}
                                    </span>
                                </div>
                            </div>
                            {/* Progress bar */}
                            <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                                <div
                                    className="h-full bg-red-500 rounded-full transition-all duration-500"
                                    style={{ width: getPercentage(kpis.callsAbandoned, totalEntrants) }}
                                />
                            </div>
                        </div>

                        {/* Redirigés */}
                        <div className="space-y-2">
                            <div className="bg-amber-50 border-2 border-amber-200 rounded-xl p-4 text-center">
                                <p className="text-sm text-amber-600 font-medium">↗️ Redirigés ailleurs</p>
                                <p className="text-3xl font-bold text-amber-700">{kpis.callsOverflow}</p>
                                <p className="text-sm text-amber-500 font-medium">
                                    {getPercentage(kpis.callsOverflow, totalEntrants)}
                                </p>
                            </div>
                            {/* Progress bar */}
                            <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                                <div
                                    className="h-full bg-amber-500 rounded-full transition-all duration-500"
                                    style={{ width: getPercentage(kpis.callsOverflow, totalEntrants) }}
                                />
                            </div>
                        </div>
                    </div>

                    {/* Overflow destinations */}
                    {kpis.overflowDestinations.length > 0 && (
                        <div className="pt-4 border-t border-slate-200">
                            <p className="text-sm font-medium text-slate-600 mb-2">Destinations des appels redirigés :</p>
                            <div className="flex flex-wrap gap-2">
                                {kpis.overflowDestinations.map((dest) => (
                                    <span
                                        key={dest.destination}
                                        className="inline-flex items-center px-3 py-1 rounded-full text-sm bg-amber-50 text-amber-700 border border-amber-200"
                                    >
                                        {dest.destinationName}
                                        <span className="ml-2 bg-amber-200 text-amber-800 px-1.5 py-0.5 rounded-full text-xs font-medium">
                                            {dest.count}
                                        </span>
                                    </span>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </CardContent>
        </Card>
    );
}
