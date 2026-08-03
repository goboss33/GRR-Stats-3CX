"use client";

import { getSelectedServer } from "@/lib/selected-server";
import { logger } from "@/lib/logger";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { format } from "date-fns";
import { useUrlPeriod, useUrlOrigin } from "@/lib/url-state";
import { useReportLoadedOrigins, useRegisterHeaderRefresh } from "@/components/header-scope";
import { getQueueStatistics, getQueuePreviousTimeline, getQueuePreviousStats } from "@/services/queue-statistics.service";
import { getScopedQueueOptions } from "@/services/queues.service";
import { NoPerimeterNotice } from "@/components/no-perimeter-notice";
import { TeamOverview } from "@/components/stats-v2/team-overview";
import { AgentPerformanceTableV2 } from "@/components/stats-v2/agent-performance-table-v2";
import { CallsChart } from "@/components/calls-chart";
import { HeatmapChart } from "@/components/heatmap-chart";
import { PeriodComparisonToggle, usePeriodComparisonPreference } from "@/components/period-comparison-toggle";
import { weekAlignedPreviousPeriod } from "@/services/domain/period-comparison";
import type { QueueStatistics, QueueKPIs, AgentStats } from "@/types/statistics.types";
import type { TimelineDataPoint } from "@/types/stats.types";
import type { CallOrigin } from "@/services/domain/call-classification";

/** Volet N-1 du bilan : KPI + agents, chargés en un aller-retour. */
type PreviousStats = { kpis: QueueKPIs; agents: AgentStats[] };


const ORIGINS: CallOrigin[] = ["both", "external", "internal"];

export default function StatisticsV2Page() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const [noPerimeter, setNoPerimeter] = useState(false);
    // La file consultée EST l'URL (?queue=…) : cartes du dashboard, recherche
    // du header, sous-menu et liens partagés naviguent tous vers le même
    // endroit — plus d'état local à synchroniser.
    const selectedQueueNumber = searchParams.get("queue");
    const [isLoading, setIsLoading] = useState(false);
    const [isLoadingQueues, setIsLoadingQueues] = useState(true);
    // Provenance des appels (Externe / Interne / Les deux) : contexte global,
    // lue dans l'URL et pilotée par le toggle du HEADER. Transmise au service,
    // qui filtre TOUTES les sous-requêtes de l'écran d'un coup.
    const { origin } = useUrlOrigin();

    // Cache des trois variantes de provenance pour le contexte courant
    // (serveur + groupe + période) : la variante affichée est chargée d'abord,
    // les deux autres suivent en tâche de fond — le toggle bascule alors sans
    // rechargement. Le jeton de contexte écarte les réponses devenues
    // obsolètes (changement de groupe ou de période en cours de route).
    const [statsCache, setStatsCache] = useState<Partial<Record<CallOrigin, QueueStatistics>>>({});
    const contextKeyRef = useRef<string>("");
    const originRef = useRef<CallOrigin>(origin);
    originRef.current = origin;

    const statistics = statsCache[origin] ?? null;

    // Remonte au header les provenances déjà consultables (spinners du
    // toggle). Sans groupe choisi, rien n'est à charger : la bascule est une
    // simple présélection, tout reste cliquable.
    useReportLoadedOrigins(selectedQueueNumber ? ORIGINS.filter((o) => !!statsCache[o]) : ORIGINS);

    // Default to current month
    // La période vient de l'URL (cf. lib/url-state).
    const dateRange = useUrlPeriod();

    // Superposition N-1 du graphique : préférence personnelle (localStorage).
    // La courbe N-1 de chaque provenance se précharge en tâche de fond avec
    // ses statistiques (cf. fetchIntoCache) — le toggle reste grisé avec un
    // spinner tant qu'elle n'est pas là, puis l'activation est instantanée.
    // « failed » ne prive que la superposition, jamais l'écran.
    const [compareEnabled, setCompareEnabled] = usePeriodComparisonPreference();
    const [prevTimelineCache, setPrevTimelineCache] =
        useState<Partial<Record<CallOrigin, TimelineDataPoint[] | "failed">>>({});
    // Stats N-1 (KPI + agents) pour les flèches de tendance du bilan — même
    // préchargement en tâche de fond, même règle : un échec prive des
    // flèches, jamais des chiffres.
    const [prevStatsCache, setPrevStatsCache] =
        useState<Partial<Record<CallOrigin, PreviousStats | "failed">>>({});
    // L'alignement des points N-1 se fait par DATE décalée dans CallsChart.
    const previousOffsetMs = dateRange.startDate.getTime()
        - weekAlignedPreviousPeriod(dateRange.startDate, dateRange.endDate).startDate.getTime();

    // Droit « Voir les logs » : sans lui, les vignettes du bilan perdent leurs
    // liens vers les journaux (décision serveur, l'interface ne fait qu'obéir).
    const [canViewLogs, setCanViewLogs] = useState(true);

    // Seul le signal « aucun périmètre » est encore utile ici : la liste des
    // files vit désormais sur le tableau de bord (aperçu) et dans le header.
    useEffect(() => {
        getScopedQueueOptions(getSelectedServer())
            .then((options) => {
                setNoPerimeter(options.noPerimeter);
                setCanViewLogs(options.canViewLogs);
            })
            .finally(() => setIsLoadingQueues(false));
    }, []);

    /**
     * Charge UNE variante de provenance et la range dans le cache — sauf si le
     * contexte a changé entre-temps (la réponse est alors simplement ignorée).
     * `withSpinner` distingue le chargement affiché (variante active) du
     * préchargement silencieux.
     */
    const fetchIntoCache = useCallback(async (ctxKey: string, o: CallOrigin, withSpinner: boolean) => {
        if (!selectedQueueNumber) return;
        if (withSpinner) setIsLoading(true);
        const serverId = getSelectedServer();

        // Courbe N-1 en tâche de fond, à côté du chargement principal : le
        // toggle « Période précédente » s'active dès qu'elle arrive.
        getQueuePreviousTimeline(serverId, selectedQueueNumber, dateRange.startDate, dateRange.endDate, o)
            .then((data) => {
                if (contextKeyRef.current !== ctxKey) return;
                setPrevTimelineCache((cache) => ({ ...cache, [o]: data }));
            })
            .catch((error) => {
                logger.error("[StatisticsV2] timeline N-1 en échec :", { origin: o, error });
                if (contextKeyRef.current === ctxKey) {
                    setPrevTimelineCache((cache) => ({ ...cache, [o]: "failed" }));
                }
            });

        // Stats N-1 (KPI + agents) pour les flèches du bilan, même principe.
        getQueuePreviousStats(serverId, selectedQueueNumber, dateRange.startDate, dateRange.endDate, o)
            .then((data) => {
                if (contextKeyRef.current !== ctxKey) return;
                setPrevStatsCache((cache) => ({ ...cache, [o]: data }));
            })
            .catch((error) => {
                logger.error("[StatisticsV2] stats N-1 en échec :", { origin: o, error });
                if (contextKeyRef.current === ctxKey) {
                    setPrevStatsCache((cache) => ({ ...cache, [o]: "failed" }));
                }
            });

        try {
            const data = await getQueueStatistics(serverId, selectedQueueNumber, dateRange.startDate, dateRange.endDate, o);
            if (contextKeyRef.current !== ctxKey) return;
            setStatsCache((cache) => ({ ...cache, [o]: data }));
        } catch (error) {
            logger.error("[StatisticsV2] getQueueStatistics error:", { origin: o, error });
        } finally {
            if (withSpinner && contextKeyRef.current === ctxKey) setIsLoading(false);
        }
    }, [selectedQueueNumber, dateRange.startDate, dateRange.endDate]);

    /**
     * (Re)charge le contexte : la variante affichée d'abord — visible dès
     * qu'elle arrive — puis les deux autres EN SÉQUENCE et en tâche de fond.
     * Séquence volontaire : ces requêtes sont lourdes et se contentionnent
     * quand on les parallélise (cf. note dans dashboard.service).
     */
    const reloadAll = useCallback((primary: CallOrigin) => {
        if (!selectedQueueNumber) return;
        // Date.now() dans le jeton : un « Rafraîchir » sur le même contexte
        // doit lui aussi périmer les réponses encore en vol.
        const ctxKey = `${getSelectedServer()}|${selectedQueueNumber}|${dateRange.startDate.toISOString()}|${dateRange.endDate.toISOString()}|${Date.now()}`;
        contextKeyRef.current = ctxKey;
        setStatsCache({});
        setPrevTimelineCache({});
        setPrevStatsCache({});
        void (async () => {
            await fetchIntoCache(ctxKey, primary, true);
            for (const o of ORIGINS) {
                if (o === primary) continue;
                if (contextKeyRef.current !== ctxKey) return;
                await fetchIntoCache(ctxKey, o, false);
            }
        })();
    }, [selectedQueueNumber, dateRange.startDate, dateRange.endDate, fetchIntoCache]);

    // Load statistics when queue or date changes
    useEffect(() => {
        logger.debug("[StatisticsV2] contexte modifié :", { selectedQueueNumber });
        reloadAll(originRef.current);
    }, [reloadAll, selectedQueueNumber]);

    // « Actualiser » est dans le header de l'application ; sans groupe choisi
    // il n'y a rien à recharger côté détail, mais l'aperçu se rafraîchit via
    // le rechargement de la page — on ne déclare l'action que pour le détail.
    const handleRefresh = useCallback(() => reloadAll(originRef.current), [reloadAll]);
    useRegisterHeaderRefresh(handleRefresh, isLoading);

    // Bascule par le header : instantanée quand la variante est en cache ;
    // sinon chargement classique (clic plus rapide que le préchargement).
    useEffect(() => {
        if (!statsCache[origin] && contextKeyRef.current && selectedQueueNumber) {
            void fetchIntoCache(contextKeyRef.current, origin, true);
        }
        // statsCache volontairement absent : ne réagir qu'à la bascule.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [origin, fetchIntoCache, selectedQueueNumber]);

    // Cet écran est le DÉTAIL d'une équipe ; sans file dans l'URL, la page
    // d'atterrissage est le tableau de bord (qui porte l'aperçu des groupes).
    useEffect(() => {
        if (selectedQueueNumber) return;
        const params = new URLSearchParams();
        for (const key of ["start", "end", "origin"]) {
            const value = searchParams.get(key);
            if (value) params.set(key, value);
        }
        router.replace(`/dashboard${params.size > 0 ? `?${params.toString()}` : ""}`);
    }, [selectedQueueNumber, searchParams, router]);



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
            {noPerimeter && (
                <NoPerimeterNotice context="Les statistiques portent sur les groupes qui vous sont attribués, et aucun ne l'est pour le moment." />
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
                        previousKpis={prevStatsCache[origin] === undefined ? "loading"
                            : prevStatsCache[origin] === "failed" ? "unavailable"
                                : (prevStatsCache[origin] as PreviousStats).kpis}
                        logsEnabled={canViewLogs}
                        queueName={statistics.queueName}
                        queueNumber={statistics.queueNumber}
                        startDate={format(dateRange.startDate, "yyyy-MM-dd")}
                        endDate={format(dateRange.endDate, "yyyy-MM-dd")}
                        origin={origin}
                        agentExtensions={statistics.agents.map(a => a.extension)}
                    />

                    {/* Agent Performance Table V2 - Avec Total + Score + % */}
                    <AgentPerformanceTableV2
                        agents={statistics.agents}
                        previousStats={prevStatsCache[origin] === undefined ? "loading"
                            : prevStatsCache[origin] === "failed" ? "unavailable"
                                : (prevStatsCache[origin] as PreviousStats)}
                        totalQueueCallsAnswered={statistics.kpis.callsAnswered}
                        totalQueueCallsReceived={statistics.kpis.callsReceived}
                        totalDirectCallsAnswered={statistics.kpis.teamDirectAnswered}
                        totalDirectCallsReceived={statistics.kpis.teamDirectReceived}
                        handedOffInPerformance={statistics.kpis.handedOffInPerformance}
                    />

                    {/* Évolution du Volume + Carte des Affluences */}
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                        <div className="lg:col-span-2">
                            <div className="bg-white rounded-xl border border-slate-200 p-6">
                                <div className="mb-4 flex items-center justify-between gap-4">
                                    <h3 className="text-lg font-semibold text-slate-900">Évolution du Volume</h3>
                                    <PeriodComparisonToggle
                                        checked={compareEnabled}
                                        onCheckedChange={setCompareEnabled}
                                        loading={prevTimelineCache[origin] === undefined}
                                        unavailable={prevTimelineCache[origin] === "failed"}
                                    />
                                </div>
                                <CallsChart
                                    data={statistics.timelineData}
                                    previousData={compareEnabled && Array.isArray(prevTimelineCache[origin])
                                        ? (prevTimelineCache[origin] as TimelineDataPoint[])
                                        : null}
                                    previousOffsetMs={previousOffsetMs}
                                />
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
