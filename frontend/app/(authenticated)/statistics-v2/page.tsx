"use client";

import { getSelectedServer } from "@/lib/selected-server";
import { logger } from "@/lib/logger";

import { useEffect, useState } from "react";
import { startOfDay, endOfDay, format } from "date-fns";
import { useUrlPeriod } from "@/lib/url-state";
import { BarChart3, RefreshCw, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { QueueInfo } from "@/types/queues.types";
import { getQueueStatistics } from "@/services/queue-statistics.service";
import { getScopedQueueOptions } from "@/services/queues.service";
import { NoPerimeterNotice } from "@/components/no-perimeter-notice";
import { TeamOverview } from "@/components/stats-v2/team-overview";
import { AgentPerformanceTableV2 } from "@/components/stats-v2/agent-performance-table-v2";
import { CallsChart } from "@/components/calls-chart";
import { HeatmapChart } from "@/components/heatmap-chart";
import { QueueSelector } from "@/components/stats/queue-selector";
import { ServerId } from "@/lib/prisma-cdr";
import type { QueueStatistics } from "@/types/statistics.types";


export default function StatisticsV2Page() {
    const [queues, setQueues] = useState<QueueInfo[]>([]);
    const [noPerimeter, setNoPerimeter] = useState(false);
    const [selectedQueueNumber, setSelectedQueueNumber] = useState<string | null>(null);
    const [selectedQueueName, setSelectedQueueName] = useState<string>("");
    const [statistics, setStatistics] = useState<QueueStatistics | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [isLoadingQueues, setIsLoadingQueues] = useState(true);

    // Default to current month
    // La période vient de l'URL (cf. lib/url-state).
    const dateRange = useUrlPeriod();

    // Load queues on mount
    useEffect(() => {
        const serverId = getSelectedServer();
        getScopedQueueOptions(serverId)
            .then((options) => {
                setQueues(options.queues);
                setNoPerimeter(options.noPerimeter);
            })
            .finally(() => setIsLoadingQueues(false));
    }, []);

    // Load statistics when queue or date changes
    useEffect(() => {
        logger.debug("[StatisticsV2] useEffect triggered:", { selectedQueueNumber, startDate: dateRange.startDate, endDate: dateRange.endDate });
        if (!selectedQueueNumber) return;

        setIsLoading(true);
        const serverId = getSelectedServer();
        logger.debug("[StatisticsV2] Calling getQueueStatistics with:", { serverId, queueNumber: selectedQueueNumber, startDate: dateRange.startDate, endDate: dateRange.endDate });
        getQueueStatistics(serverId, selectedQueueNumber, dateRange.startDate, dateRange.endDate)
            .then((data) => {
                logger.debug("[StatisticsV2] getQueueStatistics success:", data);
                setStatistics(data);
            })
            .catch((error) => {
                logger.error("[StatisticsV2] getQueueStatistics error:", error);
            })
            .finally(() => setIsLoading(false));
    }, [selectedQueueNumber, dateRange.startDate, dateRange.endDate]);

    const handleRefresh = () => {
        if (!selectedQueueNumber) return;
        setIsLoading(true);
        const serverId = getSelectedServer();
        getQueueStatistics(serverId, selectedQueueNumber, dateRange.startDate, dateRange.endDate)
            .then(setStatistics)
            .finally(() => setIsLoading(false));
    };

    const handleQueueSelect = (queueNumber: string, queueName: string) => {
        logger.debug("[QueueSelector] handleQueueSelect called:", { queueNumber, queueName });
        setSelectedQueueNumber(queueNumber);
        setSelectedQueueName(queueName);
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
                        Statistiques d'Agence V2
                    </h1>
                    <p className="text-slate-500 mt-1">
                        Vue d'ensemble des performances par équipe (file d'attente + appels directs)
                    </p>
                </div>

                {noPerimeter && (
                    <NoPerimeterNotice context="Les statistiques d'agence portent sur les files qui vous sont attribuées, et aucune ne l'est pour le moment." />
                )}

                {/* Filters Row */}
                {!noPerimeter && (
                <div className="flex flex-wrap items-center gap-4 p-4 bg-slate-50 rounded-xl border border-slate-200">
                    {/* Queue selector */}
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
                )}
            </div>

            {/* No queue selected */}
            {!noPerimeter && !selectedQueueNumber && (
                <div className="flex flex-col items-center justify-center py-20 text-slate-500">
                    <Users className="h-16 w-16 mb-4 text-slate-300" />
                    <h2 className="text-xl font-semibold text-slate-700">
                        Sélectionnez une file d'attente
                    </h2>
                    <p className="mt-2">
                        Choisissez une file pour voir les statistiques détaillées de l'équipe
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
                    {/* Team Overview - KPIs + Répartition fusionnés */}
                    <TeamOverview
                        kpis={statistics.kpis}
                        queueName={statistics.queueName}
                        queueNumber={statistics.queueNumber}
                        startDate={format(dateRange.startDate, "yyyy-MM-dd")}
                        endDate={format(dateRange.endDate, "yyyy-MM-dd")}
                        agentExtensions={statistics.agents.map(a => a.extension)}
                    />

                    {/* Agent Performance Table V2 - Avec Total + Score + % */}
                    <AgentPerformanceTableV2
                        agents={statistics.agents}
                        totalQueueCallsAnswered={statistics.kpis.callsAnswered}
                        totalQueueCallsReceived={statistics.kpis.callsReceived}
                        totalDirectCallsAnswered={statistics.kpis.teamDirectAnswered}
                        totalDirectCallsReceived={statistics.kpis.teamDirectReceived}
                    />

                    {/* Évolution du Volume + Carte des Affluences */}
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                        <div className="lg:col-span-2">
                            <div className="bg-white rounded-xl border border-slate-200 p-6">
                                <h3 className="text-lg font-semibold text-slate-900 mb-4">Évolution du Volume</h3>
                                <CallsChart data={statistics.timelineData} />
                            </div>
                        </div>
                        <div className="lg:col-span-1">
                            <div className="bg-white rounded-xl border border-slate-200 p-6">
                                <h3 className="text-lg font-semibold text-slate-900 mb-4">Carte des Affluences</h3>
                                <HeatmapChart data={statistics.heatmapData} />
                            </div>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}
