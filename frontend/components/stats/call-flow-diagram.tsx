"use client";

import { QueueKPIs } from "@/types/statistics.types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { GitBranch } from "lucide-react";

interface CallFlowDiagramProps {
    kpis: QueueKPIs;
}

export function CallFlowDiagram({ kpis }: CallFlowDiagramProps) {
    const total = kpis.callsReceived + kpis.callsToVoicemail;

    const getPercentage = (value: number): string => {
        if (total === 0) return "0%";
        return `${Math.round((value / total) * 100)}%`;
    };

    const getBarWidth = (value: number): string => {
        if (total === 0) return "0%";
        const percentage = Math.max((value / total) * 100, 2); // Min 2% for visibility
        return `${percentage}%`;
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <GitBranch className="h-5 w-5 text-blue-600" />
                    Flux des Appels
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
                {/* Entry point */}
                <div className="text-center">
                    <div className="inline-block bg-slate-100 rounded-lg px-6 py-3 border-2 border-slate-300">
                        <p className="text-sm text-slate-500">Appels entrants (total)</p>
                        <p className="text-3xl font-bold text-slate-900">{total}</p>
                    </div>
                </div>

                {/* Flow branches */}
                <div className="relative">
                    {/* Connecting lines */}
                    <div className="absolute left-1/2 top-0 w-px h-4 bg-slate-300" />
                    <div className="absolute left-1/2 top-4 w-[60%] -translate-x-1/2 h-px bg-slate-300" />

                    {/* Branches */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-8">
                        {/* Answered */}
                        <div className="space-y-2">
                            <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 text-center">
                                <p className="text-sm font-medium text-emerald-700">Répondus</p>
                                <p className="text-2xl font-bold text-emerald-600">{kpis.callsAnswered}</p>
                                <p className="text-xs text-emerald-500">{getPercentage(kpis.callsAnswered)}</p>
                            </div>
                            <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                                <div
                                    className="h-full bg-emerald-500 rounded-full transition-all duration-500"
                                    style={{ width: getBarWidth(kpis.callsAnswered) }}
                                />
                            </div>
                        </div>

                        {/* Abandoned */}
                        <div className="space-y-2">
                            <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-center">
                                <p className="text-sm font-medium text-red-700">Abandonnés</p>
                                <p className="text-2xl font-bold text-red-600">{kpis.callsAbandoned}</p>
                                <p className="text-xs text-red-500">{getPercentage(kpis.callsAbandoned)}</p>
                                <div className="mt-2 flex justify-center gap-4 text-xs">
                                    <span className="text-slate-500">
                                        &lt;10s: <span className="font-medium text-red-600">{kpis.abandonedBefore10s}</span>
                                    </span>
                                    <span className="text-slate-500">
                                        ≥10s: <span className="font-medium text-red-600">{kpis.abandonedAfter10s}</span>
                                    </span>
                                </div>
                            </div>
                            <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                                <div
                                    className="h-full bg-red-500 rounded-full transition-all duration-500"
                                    style={{ width: getBarWidth(kpis.callsAbandoned) }}
                                />
                            </div>
                        </div>

                        {/* Other */}
                        <div className="space-y-2">
                            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-center">
                                <p className="text-sm font-medium text-amber-700">Autres</p>
                                <p className="text-2xl font-bold text-amber-600">
                                    {kpis.callsOverflow + kpis.callsToVoicemail}
                                </p>
                                <p className="text-xs text-amber-500">
                                    {getPercentage(kpis.callsOverflow + kpis.callsToVoicemail)}
                                </p>
                                <div className="mt-2 flex justify-center gap-4 text-xs">
                                    <span className="text-slate-500">
                                        Overflow: <span className="font-medium text-amber-600">{kpis.callsOverflow}</span>
                                    </span>
                                    <span className="text-slate-500">
                                        Msg: <span className="font-medium text-purple-600">{kpis.callsToVoicemail}</span>
                                    </span>
                                </div>
                            </div>
                            <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                                <div
                                    className="h-full bg-amber-500 rounded-full transition-all duration-500"
                                    style={{ width: getBarWidth(kpis.callsOverflow + kpis.callsToVoicemail) }}
                                />
                            </div>
                        </div>
                    </div>
                </div>

                {/* Overflow destinations */}
                {kpis.overflowDestinations.length > 0 && (
                    <div className="mt-6 pt-4 border-t">
                        <p className="text-sm font-medium text-slate-700 mb-3">Destinations des appels repartis :</p>
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
            </CardContent>
        </Card>
    );
}
