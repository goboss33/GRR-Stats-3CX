"use client";

import { getSelectedServer } from "@/lib/selected-server";

import { useState, useEffect, useCallback, useRef } from "react";
import { RefreshCw, Phone, PhoneOff, Clock, TrendingUp, Hourglass, Voicemail } from "lucide-react";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { formatDurationHuman as formatDuration } from "@/services/domain/call-aggregation";
import { finalStatusesForBucket } from "@/services/domain/call-aggregation";
import { format } from "date-fns";
import { useUrlPeriod, useUrlOrigin } from "@/lib/url-state";
import { useReportLoadedOrigins } from "@/components/header-scope";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CallsChart } from "@/components/calls-chart";
import { HeatmapChart } from "@/components/heatmap-chart";

import {
    getGlobalMetrics,
    getTimelineData,
    getHeatmapData,
} from "@/services/dashboard.service";
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

interface DashboardData {
    metrics: GlobalMetrics;
    timelineData: TimelineDataPoint[];
    heatmapData: HeatmapDataPoint[];
}

/** Ordre de préchargement : la lecture client d'abord, puis collègues, puis tout. */
const ORIGINS: CallOrigin[] = ["external", "internal", "both"];

export default function DashboardClient() {
    const [isLoading, setIsLoading] = useState(true);
    const [isInitialLoad, setIsInitialLoad] = useState(true);

    // La période vient de l'URL (cf. lib/url-state) : une seule source, lue
    // aussi bien par le serveur que par le client.
    const dateRange = useUrlPeriod();

    // Provenance (collègue / client). Le tableau de bord ne montre QUE le flux
    // entrant — décision d'août 2026 : les sortants polluaient les « manqués »
    // (3 270 sur juin), et qui veut leurs chiffres passe par les journaux, où
    // le filtre de direction existe. Le socle SQL sait toujours les filtrer
    // (API analytics/global : paramètre direction).
    //
    // « Externe » d'abord : c'est la lecture client, celle qu'on vient chercher.
    // Les deux autres provenances se préchargent en tâche de fond — le toggle
    // du HEADER les grise (spinner) tant qu'elles ne sont pas consultables,
    // puis bascule sans rechargement. La provenance est un contexte global :
    // elle vit dans l'URL (cf. lib/url-state), comme la période.
    const { origin } = useUrlOrigin();
    const [dataCache, setDataCache] = useState<Partial<Record<CallOrigin, DashboardData>>>({});
    // Le jeton de contexte écarte les réponses devenues obsolètes (changement
    // de période — ou « Rafraîchir » — pendant un préchargement en vol).
    const contextKeyRef = useRef<string>("");
    const originRef = useRef<CallOrigin>(origin);
    originRef.current = origin;

    useReportLoadedOrigins(ORIGINS.filter((o) => !!dataCache[o]));

    const current = dataCache[origin] ?? null;
    const metrics = current?.metrics ?? null;
    const timelineData = current?.timelineData ?? [];
    const heatmapData = current?.heatmapData ?? [];

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
        // provenance du tableau de bord voyage avec le lien (le filtre
        // « directions » des journaux parle en directions fines).
        const directions = origin === "internal" ? ["internal"]
            : origin === "external" ? ["inbound", "bridge"]
                : ["inbound", "internal", "bridge"];
        p.set("directions", directions.join(","));
        // Toujours explicite : le défaut global étant « externe », un lien sans
        // origin depuis la vue « Les deux » ferait mentir la liste.
        p.set("origin", origin);
        return `/admin/logs?${p.toString()}`;
    };

    const answerRate = metrics?.totalCalls
        ? Math.round(((metrics.answeredCalls || 0) / metrics.totalCalls) * 1000) / 10
        : 0;
    const prevLostCalls = (metrics?.prevMissedCalls || 0) + (metrics?.prevBusyCalls || 0);

    /**
     * Charge UNE provenance et la range dans le cache — sauf si le contexte a
     * changé entre-temps (la réponse est alors ignorée). `withSpinner`
     * distingue le chargement affiché du préchargement silencieux.
     */
    const fetchIntoCache = useCallback(async (ctxKey: string, o: CallOrigin, withSpinner: boolean) => {
        if (withSpinner) setIsLoading(true);
        try {
            const serverId = getSelectedServer();
            const [metricsData, timeline, heatmap] = await Promise.all([
                getGlobalMetrics(serverId, dateRange.startDate, dateRange.endDate, "inbound", o),
                getTimelineData(serverId, dateRange.startDate, dateRange.endDate, "inbound", o),
                getHeatmapData(serverId, dateRange.startDate, dateRange.endDate, "inbound", o),
            ]);
            if (contextKeyRef.current !== ctxKey) return;
            setDataCache((cache) => ({ ...cache, [o]: { metrics: metricsData, timelineData: timeline, heatmapData: heatmap } }));
            if (withSpinner) setIsInitialLoad(false);
        } catch (error) {
            console.error("Error fetching dashboard data:", error);
            if (withSpinner) setIsInitialLoad(false);
        } finally {
            if (withSpinner && contextKeyRef.current === ctxKey) setIsLoading(false);
        }
    }, [dateRange.startDate, dateRange.endDate]);

    /**
     * (Re)charge le contexte : la provenance affichée d'abord — visible dès
     * qu'elle arrive — puis les deux autres EN SÉQUENCE et en tâche de fond
     * (ces requêtes sont lourdes ; parallélisées, elles se contentionnent).
     */
    const reloadAll = useCallback((primary: CallOrigin) => {
        const ctxKey = `${getSelectedServer()}|${dateRange.startDate.toISOString()}|${dateRange.endDate.toISOString()}|${Date.now()}`;
        contextKeyRef.current = ctxKey;
        setDataCache({});
        void (async () => {
            await fetchIntoCache(ctxKey, primary, true);
            for (const o of ORIGINS) {
                if (o === primary) continue;
                if (contextKeyRef.current !== ctxKey) return;
                await fetchIntoCache(ctxKey, o, false);
            }
        })();
    }, [dateRange.startDate, dateRange.endDate, fetchIntoCache]);

    useEffect(() => {
        reloadAll(originRef.current);
    }, [reloadAll]);

    const handleRefresh = () => reloadAll(origin);

    // Bascule par le header : instantanée quand la provenance est en cache ;
    // sinon chargement classique (clic plus rapide que le préchargement).
    useEffect(() => {
        if (!dataCache[origin] && contextKeyRef.current) {
            void fetchIntoCache(contextKeyRef.current, origin, true);
        }
        // dataCache volontairement absent des dépendances : l'effet ne doit
        // réagir qu'à la bascule de provenance, pas au remplissage du cache.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [origin, fetchIntoCache]);


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
                    label="Appels reçus"
                    href={lienLogs()}
                    value={(metrics?.totalCalls ?? 0).toLocaleString("fr-CH")}
                    icon={Phone}
                    subtitle="Volume de la période"
                    trend={{ current: metrics?.totalCalls ?? 0, previous: metrics?.prevTotalCalls ?? 0 }}
                    isLoading={isLoading}
                />
                <KpiCard
                    label="Répondus"
                    href={lienLogs(finalStatusesForBucket('answered'))}
                    value={(metrics?.answeredCalls ?? 0).toLocaleString("fr-CH")}
                    icon={TrendingUp}
                    tone="positive"
                    subtitle={`${answerRate} % de taux global`}
                    trend={{ current: metrics?.answeredCalls ?? 0, previous: metrics?.prevAnsweredCalls ?? 0 }}
                    isLoading={isLoading}
                />
                <KpiCard
                    label="Perdus"
                    href={lienLogs(finalStatusesForBucket('lost'))}
                    value={lostCalls.toLocaleString("fr-CH")}
                    icon={PhoneOff}
                    tone="negative"
                    subtitle="Appels non aboutis"
                    trend={{ current: lostCalls, previous: prevLostCalls, lowerIsBetter: true }}
                    isLoading={isLoading}
                />
                <KpiCard
                    label="Messagerie"
                    href={lienLogs(finalStatusesForBucket('voicemail'))}
                    value={(metrics?.voicemailCalls ?? 0).toLocaleString("fr-CH")}
                    icon={Voicemail}
                    tone="info"
                    subtitle="Hors heures ou renvoi"
                    trend={{ current: metrics?.voicemailCalls ?? 0, previous: metrics?.prevVoicemailCalls ?? 0, lowerIsBetter: true }}
                    isLoading={isLoading}
                />
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
                    subtitle="Avant ou entre transferts"
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
