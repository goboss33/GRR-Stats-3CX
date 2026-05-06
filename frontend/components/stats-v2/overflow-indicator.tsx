"use client";

import { OverflowDestination } from "@/types/statistics.types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowRightLeft, TrendingUp } from "lucide-react";

interface OverflowIndicatorProps {
    overflowDestinations: OverflowDestination[];
    callsOverflow: number;
    callsReceived: number;
}

export function OverflowIndicator({ overflowDestinations, callsOverflow, callsReceived }: OverflowIndicatorProps) {
    if (overflowDestinations.length === 0 && callsOverflow === 0) {
        return null;
    }

    const overflowRate = callsReceived > 0
        ? Math.round((callsOverflow / callsReceived) * 100)
        : 0;

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <ArrowRightLeft className="h-5 w-5 text-amber-600" />
                    Indicateur de Débordement
                </CardTitle>
            </CardHeader>
            <CardContent>
                <div className="space-y-4">
                    {/* Summary */}
                    <div className="flex items-center justify-between p-4 rounded-xl bg-amber-50/50 border border-amber-100">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center">
                                <TrendingUp className="h-5 w-5 text-amber-600" />
                            </div>
                            <div>
                                <div className="text-sm font-medium text-amber-900">
                                    {callsOverflow} appels redirigés
                                </div>
                                <div className="text-xs text-amber-700">
                                    {overflowRate}% des appels reçus par la file
                                </div>
                            </div>
                        </div>
                        <div className="text-right">
                            <div className="text-2xl font-bold text-amber-700">{overflowRate}%</div>
                            <div className="text-xs text-amber-600">Taux de débordement</div>
                        </div>
                    </div>

                    {/* Top Destinations */}
                    {overflowDestinations.length > 0 && (
                        <div>
                            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
                                Top destinations de redirection
                            </p>
                            <div className="space-y-2">
                                {overflowDestinations.slice(0, 5).map((dest, index) => {
                                    const destPercentage = callsOverflow > 0
                                        ? Math.round((dest.count / callsOverflow) * 100)
                                        : 0;
                                    return (
                                        <div
                                            key={dest.destination}
                                            className="flex items-center justify-between p-3 rounded-lg bg-slate-50 border border-slate-200"
                                        >
                                            <div className="flex items-center gap-3">
                                                <div className="w-6 h-6 rounded-full bg-amber-100 flex items-center justify-center text-xs font-bold text-amber-700">
                                                    {index + 1}
                                                </div>
                                                <div>
                                                    <div className="text-sm font-medium text-slate-900">
                                                        {dest.destinationName}
                                                    </div>
                                                    <div className="text-xs text-slate-500">
                                                        File {dest.destination}
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="text-right">
                                                <div className="text-sm font-semibold text-amber-700">
                                                    {dest.count} appels
                                                </div>
                                                <div className="text-xs text-amber-600">
                                                    {destPercentage}%
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                                {overflowDestinations.length > 5 && (
                                    <div className="text-center text-xs text-slate-400 py-2">
                                        +{overflowDestinations.length - 5} autres destinations
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </CardContent>
        </Card>
    );
}
