"use client";

import { getSelectedServer } from "@/lib/selected-server";

import { useState, useEffect, useCallback } from "react";
import { RefreshCw, Phone, PhoneOff, Clock, TrendingUp, Hourglass, Voicemail } from "lucide-react";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { formatDurationHuman as formatDuration } from "@/services/domain/call-aggregation";
import { finalStatusesForBucket } from "@/services/domain/call-aggregation";
import { format } from "date-fns";
import { useUrlPeriod } from "@/lib/url-state";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CallsChart } from "@/components/calls-chart";
import { HeatmapChart } from "@/components/heatmap-chart";
import { OriginToggle } from "@/components/stats-v2/origin-toggle";

import {
    getGlobalMetrics,
    getTimelineData,
    getHeatmapData,
} from "@/services/dashboard.service";
import type { DashboardDirection } from "@/services/domain/call-aggregation";
import type { CallOrigin } from "@/services/domain/call-classification";

import type {
    GlobalMetrics,
    TimelineDataPoint,
    HeatmapDataPoint,
} from "@/types/stats.types";


// Helper to format duration seconds to human readable

// Animation du chiffre progressif (CountUp simple)

// Helper to download CSV of call IDs for a given status

// Composant pour afficher l'évolution N-1 avec une petite flèche de couleur

export default function DashboardClient() {
    const [isLoading, setIsLoading] = useState(true);
    const [isInitialLoad, setIsInitialLoad] = useState(true);

    // La période vient de l'URL (cf. lib/url-state) : une seule source, lue
    // aussi bien par le serveur que par le client.
    const dateRange = useUrlPeriod();

    const [metrics, setMetrics] = useState<GlobalMetrics | null>(null);
    const [timelineData, setTimelineData] = useState<TimelineDataPoint[]>([]);
    const [heatmapData, setHeatmapData] = useState<HeatmapDataPoint[]>([]);
    // Direction (flux reçu / flux émis) et provenance (collègue / client).
    // En mode Sortant, la provenance n'a pas de sens : le toggle se grise et
    // les libellés changent (« Aboutis » : c'est l'interlocuteur qui décroche).
    const [direction, setDirection] = useState<DashboardDirection>("inbound");
    const [origin, setOrigin] = useState<CallOrigin>("both");
    const isOutbound = direction === "outbound";

    // « Perdus » = manqués et occupés. La messagerie garde sa case : elle
    // décrit autre chose qu'un abandon, et l'exploitation s'en sert.
    const lostCalls = (metrics?.missedCalls || 0) + (metrics?.busyCalls || 0);
    // Chaque vignette de statut ouvre les journaux sur la meme population, avec
    // la periode courante — la liste des statuts vient de la table de
    // regroupement, donc elle suivra un changement de vocabulaire.
    const lienLogs = (statuts?: string[]) => {
        const p = new URLSearchParams();
        p.set("start", format(dateRange.startDate, "yyyy-MM-dd"));
        p.set("end", format(dateRange.endDate, "yyyy-MM-dd"));
        if (statuts?.length) p.set("statuses", statuts.join(","));
        // La population listée doit être celle du chiffre cliqué : la
        // direction et la provenance du tableau de bord voyagent avec le lien
        // (le filtre « directions » des journaux parle en directions fines).
        const directions = isOutbound
            ? ["outbound"]
            : origin === "internal" ? ["internal"]
                : origin === "external" ? ["inbound", "bridge"]
                    : ["inbound", "internal", "bridge"];
        p.set("directions", directions.join(","));
        return `/admin/logs?${p.toString()}`;
    };

    const answerRate = metrics?.totalCalls
        ? Math.round(((metrics.answeredCalls || 0) / metrics.totalCalls) * 1000) / 10
        : 0;
    const prevLostCalls = (metrics?.prevMissedCalls || 0) + (metrics?.prevBusyCalls || 0);

    const fetchData = useCallback(async () => {
        setIsLoading(true);
        try {
            const serverId = getSelectedServer();
            const [metricsData, timeline, heatmap] = await Promise.all([
                getGlobalMetrics(serverId, dateRange.startDate, dateRange.endDate, direction, origin),
                getTimelineData(serverId, dateRange.startDate, dateRange.endDate, direction, origin),
                getHeatmapData(serverId, dateRange.startDate, dateRange.endDate, direction, origin),
            ]);

            setMetrics(metricsData);
            setTimelineData(timeline);
            setHeatmapData(heatmap);
            setIsInitialLoad(false);
        } catch (error) {
            console.error("Error fetching dashboard data:", error);
            setIsInitialLoad(false);
        } finally {
            setIsLoading(false);
        }
    }, [dateRange.startDate, dateRange.endDate, direction, origin]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const handleRefresh = () => fetchData();


    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">
                        Tableau de bord
                    </h1>
                    <p className="text-slate-500 mt-1">
                        Vue d'ensemble et performances de l'entreprise
                    </p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                    {/* Direction : flux reçu ou flux émis. Pas d'option cumulée —
                        les statuts n'ont pas le même sens dans les deux sens. */}
                    <div
                        role="group"
                        aria-label="Direction des appels"
                        className="inline-flex items-center rounded-full bg-slate-200/70 p-1"
                    >
                        {([
                            { value: "inbound", label: "Entrants", title: "Appels reçus par l'entreprise" },
                            { value: "outbound", label: "Sortants", title: "Appels émis vers l'extérieur" },
                        ] as const).map((opt) => (
                            <button
                                key={opt.value}
                                type="button"
                                title={opt.title}
                                aria-pressed={direction === opt.value}
                                onClick={() => setDirection(opt.value)}
                                className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                                    direction === opt.value
                                        ? "bg-blue-600 text-white shadow-sm"
                                        : "text-slate-600 hover:text-slate-900"
                                }`}
                            >
                                {opt.label}
                            </button>
                        ))}
                    </div>
                    {/* Provenance : grisée côté Sortant (un sortant est par
                        nature émis par l'interne vers l'externe). */}
                    <OriginToggle value={origin} onChange={setOrigin} disabled={isOutbound} />
                    <Button
                        variant="outline"
                        size="icon"
                        onClick={handleRefresh}
                        disabled={isLoading}
                        className="bg-white shadow-sm hover:bg-slate-50 transition-colors"
                    >
                        <RefreshCw className={`h-4 w-4 text-slate-600 ${isLoading ? "animate-spin" : ""}`} />
                    </Button>
                </div>
            </div>

            {/* Chiffres-clés. Une seule vignette réutilisée : le balisage n'est
                plus recopié, donc plus de divergences de mise en forme. */}
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
                <KpiCard
                    label={isOutbound ? "Appels émis" : "Appels reçus"}
                    href={lienLogs()}
                    value={(metrics?.totalCalls ?? 0).toLocaleString("fr-CH")}
                    icon={Phone}
                    subtitle="Volume de la période"
                    trend={{ current: metrics?.totalCalls ?? 0, previous: metrics?.prevTotalCalls ?? 0 }}
                    isLoading={isLoading}
                />
                <KpiCard
                    label={isOutbound ? "Aboutis" : "Répondus"}
                    href={lienLogs(finalStatusesForBucket('answered'))}
                    value={(metrics?.answeredCalls ?? 0).toLocaleString("fr-CH")}
                    icon={TrendingUp}
                    tone="positive"
                    subtitle={isOutbound
                        ? `${answerRate} % décrochés en face`
                        : `${answerRate} % de taux global`}
                    trend={{ current: metrics?.answeredCalls ?? 0, previous: metrics?.prevAnsweredCalls ?? 0 }}
                    isLoading={isLoading}
                />
                <KpiCard
                    label={isOutbound ? "Sans réponse" : "Perdus"}
                    href={lienLogs(finalStatusesForBucket('lost'))}
                    value={lostCalls.toLocaleString("fr-CH")}
                    icon={PhoneOff}
                    tone="negative"
                    subtitle={isOutbound ? "L'interlocuteur n'a pas décroché" : "Appels non aboutis"}
                    trend={{ current: lostCalls, previous: prevLostCalls, lowerIsBetter: true }}
                    isLoading={isLoading}
                />
                {!isOutbound && <KpiCard
                    label="Messagerie"
                    href={lienLogs(finalStatusesForBucket('voicemail'))}
                    value={(metrics?.voicemailCalls ?? 0).toLocaleString("fr-CH")}
                    icon={Voicemail}
                    tone="info"
                    subtitle="Hors heures ou renvoi"
                    trend={{ current: metrics?.voicemailCalls ?? 0, previous: metrics?.prevVoicemailCalls ?? 0, lowerIsBetter: true }}
                    isLoading={isLoading}
                />}
                <KpiCard
                    label="Discussion"
                    value={formatDuration(metrics?.avgDurationSeconds ?? 0)}
                    icon={Clock}
                    subtitle="Temps humain par appel"
                    trend={{ current: metrics?.avgDurationSeconds ?? 0, previous: metrics?.prevAvgDurationSeconds ?? 0 }}
                    isLoading={isLoading}
                />
                <KpiCard
                    label="Attente moy."
                    value={formatDuration(metrics?.avgWaitTimeSeconds ?? 0)}
                    icon={Hourglass}
                    subtitle={isOutbound ? "Avant le décroché en face" : "Avant ou entre transferts"}
                    trend={{ current: metrics?.avgWaitTimeSeconds ?? 0, previous: metrics?.prevAvgWaitTimeSeconds ?? 0, lowerIsBetter: true }}
                    isLoading={isLoading}
                />
            </div>
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
                {/* Chart main */}
                <Card className="border-none shadow-md xl:col-span-2 bg-gradient-to-b from-white to-slate-50/50">
                    <CardHeader>
                        <CardTitle className="text-lg font-bold text-slate-900">Évolution du Volume</CardTitle>
                    </CardHeader>
                    <CardContent>
                        {isLoading && !isInitialLoad ? (
                            <div className="h-[425px] space-y-3 pt-4">
                                <div className="flex gap-2 items-end h-[380px]">
                                    {Array.from({ length: 14 }).map((_, i) => (
                                        <Skeleton
                                            key={i}
                                            className="flex-1 rounded-sm"
                                            style={{ height: `${25 + Math.random() * 75}%` }}
                                        />
                                    ))}
                                </div>
                            </div>
                        ) : (
                            <CallsChart data={timelineData} />
                        )}
                    </CardContent>
                </Card>

                {/* Heatmap */}
                <Card className="border-none shadow-md bg-gradient-to-b from-white to-slate-50/50">
                    <CardHeader>
                        <CardTitle className="text-lg font-bold text-slate-900">Carte des Affluences</CardTitle>
                    </CardHeader>
                    <CardContent className="px-4">
                        {isLoading && !isInitialLoad ? (
                            <div className="h-[425px] grid grid-cols-7 gap-1 pt-4">
                                {Array.from({ length: 7 * 11 }).map((_, i) => (
                                    <Skeleton key={i} className="rounded-sm" style={{ opacity: 0.3 + Math.random() * 0.7 }} />
                                ))}
                            </div>
                        ) : (
                            <HeatmapChart data={heatmapData} />
                        )}
                    </CardContent>
                </Card>
            </div>

        </div>
    );
}
