"use client";

import { useEffect, useState } from "react";
import { startOfMonth, endOfMonth, startOfDay, endOfDay } from "date-fns";
import { BarChart3, RefreshCw, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { QueueInfo } from "@/types/queues.types";
import { QueueStatistics } from "@/types/statistics.types";
import { getQueuesForSelector, getQueueStatistics } from "@/services/statistics.service";
import { AgentPerformanceTable } from "@/components/stats/agent-performance-table";
import { TrendCharts } from "@/components/stats/trend-charts";
import { UnifiedCallFlow } from "@/components/stats/unified-call-flow";
import { QueueSelector } from "@/components/stats/queue-selector";
import { DateRangePicker } from "@/components/date-range-picker";

export default function StatisticsPage() {
    const [queues, setQueues] = useState<QueueInfo[]>([]);
    const [selectedQueueNumber, setSelectedQueueNumber] = useState<string | null>(null);
    const [selectedQueueName, setSelectedQueueName] = useState<string>("");
    const [statistics, setStatistics] = useState<QueueStatistics | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [isLoadingQueues, setIsLoadingQueues] = useState(true);

    // Default to current month
    const [dateRange, setDateRange] = useState(() => {
        const now = new Date();
        return {
            startDate: startOfMonth(now),
            endDate: endOfMonth(now),
        };
    });

    // Load queues on mount
    useEffect(() => {
        getQueuesForSelector()
            .then(setQueues)
            .finally(() => setIsLoadingQueues(false));
    }, []);

    // Load statistics when queue or date changes
    useEffect(() => {
        if (!selectedQueueNumber) return;

        setIsLoading(true);
        getQueueStatistics(selectedQueueNumber, dateRange.startDate, dateRange.endDate)
            .then(setStatistics)
            .finally(() => setIsLoading(false));
    }, [selectedQueueNumber, dateRange]);

    const handleRefresh = () => {
        if (!selectedQueueNumber) return;
        setIsLoading(true);
        getQueueStatistics(selectedQueueNumber, dateRange.startDate, dateRange.endDate)
            .then(setStatistics)
            .finally(() => setIsLoading(false));
    };

    const handleQueueSelect = (queueNumber: string, queueName: string) => {
        setSelectedQueueNumber(queueNumber);
        setSelectedQueueName(queueName);
    };

    const handleDateRangeChange = (range: { startDate: Date; endDate: Date }) => {
        setDateRange({
            startDate: startOfDay(range.startDate),
            endDate: endOfDay(range.endDate),
        });
    };

    if (isLoadingQueues) {
        return (
            <div className="flex items-center justify-center h-screen text-slate-500">
                <div className="flex flex-col items-center gap-4">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-slate-900" />
                    <p>Chargement des files d'attente...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="p-6 max-w-[1800px] mx-auto space-y-6">
            {/* Header */}
            <div className="flex flex-col gap-4">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight text-slate-900 flex items-center gap-3">
                        <BarChart3 className="h-8 w-8 text-blue-600" />
                        Statistiques d'Agence
                    </h1>
                    <p className="text-slate-500 mt-1">
                        Vue d'ensemble des performances par file d'attente
                    </p>
                </div>

                {/* Filters Row */}
                <div className="flex flex-wrap items-center gap-4 p-4 bg-slate-50 rounded-xl border border-slate-200">
                    {/* Queue selector - reusing same logic as queues page */}
                    <div className="flex-1 min-w-[300px] max-w-md">
                        <label className="text-sm font-medium text-slate-600 mb-1.5 block">
                            File d'attente
                        </label>
                        <QueueSelector
                            queues={queues}
                            selectedQueueNumber={selectedQueueNumber}
                            onSelect={handleQueueSelect}
                            placeholder="Rechercher une file ou un agent..."
                        />
                    </div>

                    {/* Date range picker - same as logs page */}
                    <div>
                        <label className="text-sm font-medium text-slate-600 mb-1.5 block">
                            Période
                        </label>
                        <DateRangePicker
                            dateRange={dateRange}
                            onDateRangeChange={handleDateRangeChange}
                        />
                    </div>

                    {/* Refresh */}
                    <div className="flex items-end">
                        <Button
                            variant="outline"
                            size="icon"
                            onClick={handleRefresh}
                            disabled={!selectedQueueNumber || isLoading}
                            className="h-11 w-11"
                        >
                            <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
                        </Button>
                    </div>
                </div>
            </div>

            {/* No queue selected */}
            {!selectedQueueNumber && (
                <div className="flex flex-col items-center justify-center py-20 text-slate-500">
                    <Users className="h-16 w-16 mb-4 text-slate-300" />
                    <h2 className="text-xl font-semibold text-slate-700">
                        Sélectionnez une file d'attente
                    </h2>
                    <p className="mt-2">
                        Choisissez une file pour voir ses statistiques détaillées
                    </p>
                </div>
            )}

            {/* Loading */}
            {isLoading && selectedQueueNumber && (
                <div className="flex items-center justify-center py-20">
                    <div className="flex flex-col items-center gap-4">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
                        <p className="text-slate-500">Chargement des statistiques...</p>
                    </div>
                </div>
            )}

            {/* Statistics content */}
            {statistics && !isLoading && (
                <>
                    {/* Unified Call Flow (replaces KPI cards + old flow diagram) */}
                    <UnifiedCallFlow
                        kpis={statistics.kpis}
                        queueName={statistics.queueName}
                        queueNumber={statistics.queueNumber}
                    />

                    {/* Agent Performance */}
                    <AgentPerformanceTable agents={statistics.agents} />

                    {/* Trend Charts */}
                    <TrendCharts
                        dailyTrend={statistics.dailyTrend}
                        hourlyTrend={statistics.hourlyTrend}
                    />
                </>
            )}
        </div>
    );
}
