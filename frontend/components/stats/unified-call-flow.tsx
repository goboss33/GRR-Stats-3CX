"use client";

import { QueueKPIs } from "@/types/statistics.types";
import { Card, CardContent } from "@/components/ui/card";
import { Clock, Info } from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip } from "recharts";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";

interface UnifiedCallFlowProps {
    kpis: QueueKPIs;
    queueName: string;
    queueNumber: string;
}

export function UnifiedCallFlow({ kpis, queueName, queueNumber }: UnifiedCallFlowProps) {
    const totalPassages = kpis.callsReceived;
    const uniqueCalls = kpis.uniqueCalls;
    const pingPongCount = kpis.pingPongCount;
    const pingPongPercentage = kpis.pingPongPercentage;

    const formatDuration = (seconds: number): string => {
        if (seconds < 60) return `${seconds}s`;
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
    };

    const getPercentage = (value: number, total: number): number => {
        if (total === 0) return 0;
        return Math.round((value / total) * 100);
    };

    const data = [
        { name: "Répondus", value: kpis.callsAnswered, color: "#10b981" }, // emerald-500 (all answered, including transferred)
        { name: "Abandonnés", value: kpis.callsAbandoned, color: "#ef4444" }, // red-500
        { name: "Redirigés", value: kpis.callsOverflow, color: "#f59e0b" }, // amber-500
    ].filter(d => d.value > 0);

    return (
        <TooltipProvider delayDuration={200}>
        <Card className="overflow-hidden">
            {/* Header Compact */}
            <div className="bg-slate-50 border-b px-6 py-4 flex items-center justify-between">
                <div>
                    <h2 className="text-lg font-bold text-slate-800">{queueName}</h2>
                    <p className="text-slate-500 text-sm">File {queueNumber}</p>
                </div>
                <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-lg px-3 py-1.5 shadow-sm">
                    <Clock className="h-4 w-4 text-slate-500" />
                    <span className="text-sm font-medium text-slate-700">Attente moy: <span className="text-slate-900">{formatDuration(kpis.avgWaitTimeSeconds)}</span></span>
                </div>
            </div>

            <CardContent className="p-6">
                <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-center">
                    {/* Colonne Gauche: Quality Bar + Donut */}
                    <div className="col-span-1 md:col-span-4">
                        <div className="flex items-center gap-8 px-8">
                            {/* Quality Bar - LEFT - Vertical segmented bar with gradient */}
                            <div className="flex items-center gap-3">
                                {/* Vertical segmented bar */}
                                <div className="flex flex-col-reverse gap-0.5">
                                    {[...Array(10)].map((_, index) => {
                                        const segmentThreshold = ((index + 1) / 10) * 100;
                                        const currentPercentage = Math.round((uniqueCalls / totalPassages) * 100);
                                        const isFilled = currentPercentage >= segmentThreshold;

                                        // Calculate gradient color: Rouge 0-15%, Orange 15-25%, Vert 25-100%
                                        const getSegmentColor = (idx: number) => {
                                            const position = (idx + 1) / 10; // 0.1 to 1.0
                                            if (position <= 0.15) return '#ef4444'; // red-500 (0-15%)
                                            if (position <= 0.25) return '#f97316'; // orange-500 (15-25%)
                                            // Gradient vert de 25% à 100%
                                            if (position <= 0.4) return '#fb923c'; // orange-400 → transition
                                            if (position <= 0.55) return '#fbbf24'; // amber-400
                                            if (position <= 0.7) return '#a3e635'; // lime-400
                                            if (position <= 0.85) return '#4ade80'; // green-400
                                            return '#22c55e'; // green-500 (top)
                                        };

                                        return (
                                            <div
                                                key={index}
                                                className={`w-8 h-2 rounded-sm transition-all duration-300 ${
                                                    isFilled ? 'opacity-100' : 'opacity-20'
                                                }`}
                                                style={{
                                                    backgroundColor: getSegmentColor(index),
                                                }}
                                            />
                                        );
                                    })}
                                </div>

                                {/* Label and info */}
                                <div className="flex flex-col justify-center gap-1">
                                    <div className="flex items-center gap-1.5">
                                        <div className="text-2xl font-bold text-slate-700">
                                            {Math.round((uniqueCalls / totalPassages) * 100)}%
                                        </div>
                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <Info className="h-4 w-4 text-slate-400 cursor-help hover:text-slate-600 transition-colors flex-shrink-0" />
                                            </TooltipTrigger>
                                            <TooltipContent side="right" className="max-w-xs">
                                                <div className="space-y-1 text-xs">
                                                    <p><strong>Taux d'appels uniques:</strong> {uniqueCalls} / {totalPassages} = {Math.round((uniqueCalls / totalPassages) * 100)}%</p>
                                                    <p className="text-slate-400 mt-2 pt-2 border-t">
                                                        Plus ce taux est élevé, moins il y a de passages multiples (ping-pong)
                                                    </p>
                                                    <div className="mt-2 pt-2 border-t space-y-0.5">
                                                        <p className="text-slate-400 text-[10px]">
                                                            {pingPongCount} appels avec ping-pong ({pingPongPercentage}%)
                                                        </p>
                                                    </div>
                                                </div>
                                            </TooltipContent>
                                        </Tooltip>
                                    </div>
                                    <div className="text-[10px] text-slate-500 uppercase tracking-wider">
                                        Qualité
                                    </div>
                                </div>
                            </div>

                            {/* Donut Chart - RIGHT */}
                            <div className="flex-1 h-52 relative">
                                <ResponsiveContainer width="100%" height="100%">
                                    <PieChart>
                                        <Pie
                                            data={data}
                                            cx="50%"
                                            cy="50%"
                                            innerRadius={60}
                                            outerRadius={80}
                                            paddingAngle={2}
                                            dataKey="value"
                                            stroke="none"
                                        >
                                            {data.map((entry, index) => (
                                                <Cell
                                                    key={`cell-${index}`}
                                                    fill={entry.color}
                                                />
                                            ))}
                                        </Pie>
                                        <RechartsTooltip
                                            formatter={(value: number) => [`${value} appels`, '']}
                                            contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                                        />
                                    </PieChart>
                                </ResponsiveContainer>
                                {/* Centre du Donut - Number + Info icon */}
                                <div className="absolute inset-0 flex items-center justify-center">
                                    <div className="flex items-center gap-2 pointer-events-auto">
                                        <span className="text-4xl font-bold text-slate-900">{totalPassages}</span>
                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <Info className="h-5 w-5 text-slate-400 cursor-help hover:text-slate-600 transition-colors flex-shrink-0" />
                                            </TooltipTrigger>
                                            <TooltipContent side="right" className="max-w-xs">
                                                <div className="space-y-1 text-xs">
                                                    <p><strong>Total passages:</strong> {totalPassages}</p>
                                                    <p><strong>Appels uniques:</strong> {uniqueCalls}</p>
                                                    <p><strong>Passages multiples (ping-pong):</strong> {pingPongCount}</p>
                                                    <p className="text-slate-400 mt-2 pt-2 border-t">
                                                        Le total inclut les appels qui repassent plusieurs fois par la queue
                                                    </p>
                                                </div>
                                            </TooltipContent>
                                        </Tooltip>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Colonne Droite: Détails */}
                    <div className="col-span-1 md:col-span-8 space-y-6">
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                            {/* Répondus */}
                            <div className="p-4 rounded-xl bg-emerald-50/50 border border-emerald-100">
                                <div className="flex items-center justify-between mb-2">
                                    <div className="flex items-center gap-2">
                                        <div className="w-3 h-3 rounded-full bg-emerald-500" />
                                        <span className="font-medium text-emerald-900">Répondus</span>
                                    </div>
                                    <span className="text-xs font-semibold bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">
                                        {getPercentage(kpis.callsAnswered, totalPassages)}%
                                    </span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <p className="text-2xl font-bold text-emerald-700">{kpis.callsAnswered}</p>
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <Info className="h-4 w-4 text-emerald-500 cursor-help flex-shrink-0" />
                                        </TooltipTrigger>
                                        <TooltipContent side="right" className="max-w-xs">
                                            <div className="space-y-1 text-xs">
                                                <p><strong>Passages:</strong> {kpis.callsAnswered}</p>
                                                <p><strong>Appels uniques:</strong> {kpis.uniqueCallsAnswered}</p>
                                                <p><strong>Ping-pong:</strong> {kpis.callsAnswered - kpis.uniqueCallsAnswered} ({Math.round(((kpis.callsAnswered - kpis.uniqueCallsAnswered) / kpis.callsAnswered) * 100)}%)</p>
                                                <p className="text-slate-400 mt-2 pt-2 border-t">
                                                    Les appels uniques sont basés sur le résultat du premier passage dans cette queue
                                                </p>
                                            </div>
                                        </TooltipContent>
                                    </Tooltip>
                                </div>
                            </div>

                            {/* Redirigés */}
                            <div className="p-4 rounded-xl bg-amber-50/50 border border-amber-100">
                                <div className="flex items-center justify-between mb-2">
                                    <div className="flex items-center gap-2">
                                        <div className="w-3 h-3 rounded-full bg-amber-500" />
                                        <span className="font-medium text-amber-900">Redirigés</span>
                                    </div>
                                    <span className="text-xs font-semibold bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">
                                        {getPercentage(kpis.callsOverflow, totalPassages)}%
                                    </span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <p className="text-2xl font-bold text-amber-700">{kpis.callsOverflow}</p>
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <Info className="h-4 w-4 text-amber-500 cursor-help flex-shrink-0" />
                                        </TooltipTrigger>
                                        <TooltipContent side="right" className="max-w-xs">
                                            <div className="space-y-1 text-xs">
                                                <p><strong>Passages:</strong> {kpis.callsOverflow}</p>
                                                <p><strong>Appels uniques:</strong> {kpis.uniqueCallsOverflow}</p>
                                                <p><strong>Ping-pong:</strong> {kpis.callsOverflow - kpis.uniqueCallsOverflow} ({Math.round(((kpis.callsOverflow - kpis.uniqueCallsOverflow) / (kpis.callsOverflow || 1)) * 100)}%)</p>
                                                <p className="text-slate-400 mt-2 pt-2 border-t">
                                                    Les appels uniques sont basés sur le résultat du premier passage dans cette queue
                                                </p>
                                            </div>
                                        </TooltipContent>
                                    </Tooltip>
                                </div>
                            </div>

                            {/* Abandonnés */}
                            <div className="p-4 rounded-xl bg-red-50/50 border border-red-100">
                                <div className="flex items-center justify-between mb-2">
                                    <div className="flex items-center gap-2">
                                        <div className="w-3 h-3 rounded-full bg-red-500" />
                                        <span className="font-medium text-red-900">Abandonnés</span>
                                    </div>
                                    <span className="text-xs font-semibold bg-red-100 text-red-700 px-2 py-0.5 rounded-full">
                                        {getPercentage(kpis.callsAbandoned, totalPassages)}%
                                    </span>
                                </div>
                                <div className="flex items-baseline justify-between">
                                    <div className="flex items-center gap-2">
                                        <p className="text-2xl font-bold text-red-700">{kpis.callsAbandoned}</p>
                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <Info className="h-4 w-4 text-red-500 cursor-help flex-shrink-0" />
                                            </TooltipTrigger>
                                            <TooltipContent side="right" className="max-w-xs">
                                                <div className="space-y-1 text-xs">
                                                    <p><strong>Passages:</strong> {kpis.callsAbandoned}</p>
                                                    <p><strong>Appels uniques:</strong> {kpis.uniqueCallsAbandoned}</p>
                                                    <p><strong>Ping-pong:</strong> {kpis.callsAbandoned - kpis.uniqueCallsAbandoned} ({Math.round(((kpis.callsAbandoned - kpis.uniqueCallsAbandoned) / (kpis.callsAbandoned || 1)) * 100)}%)</p>
                                                    <p className="text-slate-400 mt-2 pt-2 border-t">
                                                        Les appels uniques sont basés sur le résultat du premier passage dans cette queue
                                                    </p>
                                                </div>
                                            </TooltipContent>
                                        </Tooltip>
                                    </div>
                                    <div className="text-xs text-red-600 text-right">
                                        <div>&lt;10s: <strong>{kpis.abandonedBefore10s}</strong></div>
                                        <div>≥10s: <strong>{kpis.abandonedAfter10s}</strong></div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Destinations Overflow */}
                        {kpis.overflowDestinations.length > 0 && (
                            <div className="pt-4 border-t border-slate-100">
                                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
                                    Top Destinations Redirection
                                </p>
                                <div className="flex flex-wrap gap-2">
                                    {kpis.overflowDestinations.slice(0, 5).map((dest) => (
                                        <span
                                            key={dest.destination}
                                            className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200"
                                        >
                                            <span className="w-2 h-2 rounded-full bg-amber-500 mr-1.5" />
                                            {dest.destinationName}
                                            <span className="ml-1.5 bg-amber-100 text-amber-800 px-1.5 rounded-sm">
                                                {dest.count}
                                            </span>
                                        </span>
                                    ))}
                                    {kpis.overflowDestinations.length > 5 && (
                                        <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium text-slate-400 border border-dashed border-slate-300">
                                            +{kpis.overflowDestinations.length - 5} autres
                                        </span>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </CardContent>
        </Card>
        </TooltipProvider>
    );
}
