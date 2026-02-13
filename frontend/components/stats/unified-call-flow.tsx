"use client";

import Link from "next/link";
import { QueueKPIs } from "@/types/statistics.types";
import { Card, CardContent } from "@/components/ui/card";
import { Clock, ExternalLink, Info } from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip } from "recharts";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import { format } from "date-fns";

interface UnifiedCallFlowProps {
    kpis: QueueKPIs;
    queueName: string;
    queueNumber: string;
    dateRange?: { startDate: Date; endDate: Date }; // For building filter URLs
}

export function UnifiedCallFlow({ kpis, queueName, queueNumber, dateRange }: UnifiedCallFlowProps) {
    // Wrap component with TooltipProvider for the new Info icon tooltips
    const totalPassages = kpis.callsReceived;
    const uniqueCalls = kpis.uniqueCalls;
    const pingPongCount = kpis.pingPongCount;
    const pingPongPercentage = kpis.pingPongPercentage;

    // Helper to build logs URL for ALL calls (no outcome filter)
    const buildAllCallsUrl = (): string | undefined => {
        if (!dateRange) return undefined;
        const params = new URLSearchParams({
            start: format(dateRange.startDate, 'yyyy-MM-dd'),
            end: format(dateRange.endDate, 'yyyy-MM-dd'),
            queue: queueNumber,
        });
        return `/admin/logs?${params.toString()}`;
    };

    // Helper to build logs URL with filters (exact match with statistics logic)
    const buildLogsUrl = (outcome: 'answered' | 'abandoned' | 'overflow'): string | undefined => {
        if (!dateRange) return undefined;

        const params = new URLSearchParams({
            start: format(dateRange.startDate, 'yyyy-MM-dd'),
            end: format(dateRange.endDate, 'yyyy-MM-dd'),
            journeyQueue: queueNumber,
        });

        // Map KPI outcome to journey result and queue count filter
        // This EXACTLY replicates the statistics.service.ts logic
        if (outcome === 'answered') {
            // Répondus: calls answered in THIS queue
            params.set('journeyResult', 'answered');
            // No hasMultipleQueues filter - we don't care if there are other queues
        } else if (outcome === 'abandoned') {
            // Abandonnés: calls not answered in THIS queue AND no other queues
            params.set('journeyResult', 'not_answered');
            params.set('multiQueues', 'false'); // Single queue only
        } else if (outcome === 'overflow') {
            // Redirigés: calls not answered in THIS queue AND went to other queues
            params.set('journeyResult', 'not_answered');
            params.set('multiQueues', 'true'); // Multiple queues
        }

        return `/admin/logs?${params.toString()}`;
    };

    const isClickable = !!dateRange;

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

    const answeredNotTransferred = kpis.callsAnswered - kpis.callsAnsweredAndTransferred;

    const data = [
        { name: "Répondus", value: answeredNotTransferred, color: "#10b981" }, // emerald-500
        { name: "Répondus (transférés)", value: kpis.callsAnsweredAndTransferred, color: "#10b981" }, // same green, will use pattern
        { name: "Abandonnés", value: kpis.callsAbandoned, color: "#ef4444" }, // red-500
        { name: "Redirigés", value: kpis.callsOverflow, color: "#f59e0b" }, // amber-500
    ].filter(d => d.value > 0);

    // Unique pattern ID to avoid SVG conflicts
    const patternId = "hatchPattern";

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
                    {/* Colonne Gauche: Donut Chart */}
                    <div className="col-span-1 md:col-span-4 h-64 relative">
                        <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                                {/* SVG Pattern definition for hatched green */}
                                <defs>
                                    <pattern id={patternId} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                                        <rect width="6" height="6" fill="#10b981" />
                                        <line x1="0" y1="0" x2="0" y2="6" stroke="white" strokeWidth="2" />
                                    </pattern>
                                </defs>
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
                                            fill={entry.name === "Répondus (transférés)" ? `url(#${patternId})` : entry.color}
                                        />
                                    ))}
                                </Pie>
                                <RechartsTooltip
                                    formatter={(value: number) => [`${value} appels`, '']}
                                    contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                                />
                            </PieChart>
                        </ResponsiveContainer>
                        {/* Centre du Donut - Dual metrics (passages + unique calls) */}
                        <div className="absolute inset-0 flex flex-col items-center justify-center">
                            {/* Total passages - non-clickable, informative only */}
                            <div className="text-center pointer-events-none">
                                <span className="text-3xl font-bold text-slate-900">{totalPassages}</span>
                                <span className="text-xs text-slate-500 uppercase tracking-wide block">passages</span>
                            </div>
                            {/* Unique calls - clickable to navigate to all logs for this queue */}
                            {isClickable && (
                                <Link
                                    href={buildAllCallsUrl() || '#'}
                                    className="mt-1.5 text-sm text-slate-600 hover:text-blue-600 hover:underline transition-colors pointer-events-auto flex items-center gap-1"
                                >
                                    <span>📞 {uniqueCalls} appels uniques</span>
                                </Link>
                            )}
                            {!isClickable && (
                                <div className="mt-1.5 text-sm text-slate-600 pointer-events-none">
                                    📞 {uniqueCalls} appels uniques
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Colonne Droite: Détails */}
                    <div className="col-span-1 md:col-span-8 space-y-6">
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                            {/* Répondus - Clickable */}
                            {isClickable ? (
                                <Link
                                    href={buildLogsUrl('answered') || '#'}
                                    className="block p-4 rounded-xl bg-emerald-50/50 border border-emerald-100 transition-all hover:shadow-md hover:border-emerald-200 cursor-pointer group"
                                >
                                    <div className="flex items-center justify-between mb-2">
                                        <div className="flex items-center gap-2">
                                            <div className="w-3 h-3 rounded-full bg-emerald-500 group-hover:scale-110 transition-transform" />
                                            <span className="font-medium text-emerald-900 group-hover:underline">Répondus</span>
                                        </div>
                                        <div className="flex items-center gap-1.5">
                                            <span className="text-xs font-semibold bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">
                                                {getPercentage(kpis.callsAnswered, totalPassages)}%
                                            </span>
                                            <ExternalLink className="h-3 w-3 text-emerald-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                                        </div>
                                    </div>
                                    <div className="flex items-end justify-between">
                                        <div className="flex items-center gap-2">
                                            <p className="text-2xl font-bold text-emerald-700">{kpis.callsAnswered}</p>
                                            {/* Info icon with tooltip */}
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
                                        {kpis.callsAnsweredAndTransferred > 0 && (
                                            <div className="text-xs text-emerald-600 text-right">
                                                <div>dont transférés: <strong>{kpis.callsAnsweredAndTransferred}</strong></div>
                                            </div>
                                        )}
                                    </div>
                                </Link>
                            ) : (
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
                                    <div className="flex items-end justify-between">
                                        <div className="flex items-center gap-2">
                                            <p className="text-2xl font-bold text-emerald-700">{kpis.callsAnswered}</p>
                                            {/* Info icon with tooltip */}
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
                                        {kpis.callsAnsweredAndTransferred > 0 && (
                                            <div className="text-xs text-emerald-600 text-right">
                                                <div>dont transférés: <strong>{kpis.callsAnsweredAndTransferred}</strong></div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}

                            {/* Redirigés - Clickable */}
                            {isClickable ? (
                                <Link
                                    href={buildLogsUrl('overflow') || '#'}
                                    className="block p-4 rounded-xl bg-amber-50/50 border border-amber-100 transition-all hover:shadow-md hover:border-amber-200 cursor-pointer group"
                                >
                                    <div className="flex items-center justify-between mb-2">
                                        <div className="flex items-center gap-2">
                                            <div className="w-3 h-3 rounded-full bg-amber-500 group-hover:scale-110 transition-transform" />
                                            <span className="font-medium text-amber-900 group-hover:underline">Redirigés</span>
                                        </div>
                                        <div className="flex items-center gap-1.5">
                                            <span className="text-xs font-semibold bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">
                                                {getPercentage(kpis.callsOverflow, totalPassages)}%
                                            </span>
                                            <ExternalLink className="h-3 w-3 text-amber-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <p className="text-2xl font-bold text-amber-700">{kpis.callsOverflow}</p>
                                        {/* Info icon with tooltip */}
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
                                </Link>
                            ) : (
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
                                        {/* Info icon with tooltip */}
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
                            )}

                            {/* Abandonnés - Clickable */}
                            {isClickable ? (
                                <Link
                                    href={buildLogsUrl('abandoned') || '#'}
                                    className="block p-4 rounded-xl bg-red-50/50 border border-red-100 transition-all hover:shadow-md hover:border-red-200 cursor-pointer group"
                                >
                                    <div className="flex items-center justify-between mb-2">
                                        <div className="flex items-center gap-2">
                                            <div className="w-3 h-3 rounded-full bg-red-500 group-hover:scale-110 transition-transform" />
                                            <span className="font-medium text-red-900 group-hover:underline">Abandonnés</span>
                                        </div>
                                        <div className="flex items-center gap-1.5">
                                            <span className="text-xs font-semibold bg-red-100 text-red-700 px-2 py-0.5 rounded-full">
                                                {getPercentage(kpis.callsAbandoned, totalPassages)}%
                                            </span>
                                            <ExternalLink className="h-3 w-3 text-red-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                                        </div>
                                    </div>
                                    <div className="flex items-baseline justify-between">
                                        <div className="flex items-center gap-2">
                                            <p className="text-2xl font-bold text-red-700">{kpis.callsAbandoned}</p>
                                            {/* Info icon with tooltip */}
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
                                </Link>
                            ) : (
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
                                            {/* Info icon with tooltip */}
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
                            )}
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

                        {/* Destinations Transfert */}
                        {kpis.transferDestinations.length > 0 && (
                            <div className={`pt-4 ${kpis.overflowDestinations.length > 0 ? '' : 'border-t border-slate-100'}`}>
                                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
                                    Top Destinations Transfert
                                </p>
                                <div className="flex flex-wrap gap-2">
                                    {kpis.transferDestinations.slice(0, 5).map((dest) => {
                                        const isQueue = dest.destinationType === 'queue';
                                        const badgeColor = isQueue
                                            ? 'bg-amber-50 text-amber-700 border-amber-200'
                                            : 'bg-violet-50 text-violet-700 border-violet-200';
                                        const dotColor = isQueue ? 'bg-amber-500' : 'bg-violet-500';
                                        const countColor = isQueue
                                            ? 'bg-amber-100 text-amber-800'
                                            : 'bg-violet-100 text-violet-800';
                                        const prefix = isQueue ? 'Queue' : 'Ext.';

                                        return (
                                            <span
                                                key={`${dest.destinationType}-${dest.destination}`}
                                                className={`inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium ${badgeColor} border`}
                                            >
                                                <span className={`w-2 h-2 rounded-full ${dotColor} mr-1.5`} />
                                                {prefix}: {dest.destination} - {dest.destinationName}
                                                <span className={`ml-1.5 ${countColor} px-1.5 rounded-sm`}>
                                                    {dest.count}
                                                </span>
                                            </span>
                                        );
                                    })}
                                    {kpis.transferDestinations.length > 5 && (
                                        <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium text-slate-400 border border-dashed border-slate-300">
                                            +{kpis.transferDestinations.length - 5} autres
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
