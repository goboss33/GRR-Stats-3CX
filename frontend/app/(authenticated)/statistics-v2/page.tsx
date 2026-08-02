"use client";

import { getSelectedServer } from "@/lib/selected-server";
import { logger } from "@/lib/logger";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { startOfDay, endOfDay, format } from "date-fns";
import { useUrlPeriod, useUrlOrigin } from "@/lib/url-state";
import { useReportLoadedOrigins, useRegisterHeaderRefresh } from "@/components/header-scope";
import { BarChart3, Users } from "lucide-react";
import { QueueInfo } from "@/types/queues.types";
import { getQueueStatistics } from "@/services/queue-statistics.service";
import { getScopedQueueOptions } from "@/services/queues.service";
import { NoPerimeterNotice } from "@/components/no-perimeter-notice";
import { TeamOverview } from "@/components/stats-v2/team-overview";
import { AgentPerformanceTableV2 } from "@/components/stats-v2/agent-performance-table-v2";
import { CallsChart } from "@/components/calls-chart";
import { HeatmapChart } from "@/components/heatmap-chart";
import { QueueSelector } from "@/components/stats/queue-selector";
import { QueueOverviewGrid } from "@/components/stats-v2/queue-overview-grid";
import { ServerId } from "@/lib/prisma-cdr";
import type { QueueStatistics } from "@/types/statistics.types";
import type { CallOrigin } from "@/services/domain/call-classification";


const ORIGINS: CallOrigin[] = ["both", "external", "internal"];

export default function StatisticsV2Page() {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const [queues, setQueues] = useState<QueueInfo[]>([]);
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

    /**
     * Charge UNE variante de provenance et la range dans le cache — sauf si le
     * contexte a changé entre-temps (la réponse est alors simplement ignorée).
     * `withSpinner` distingue le chargement affiché (variante active) du
     * préchargement silencieux.
     */
    const fetchIntoCache = useCallback(async (ctxKey: string, o: CallOrigin, withSpinner: boolean) => {
        if (!selectedQueueNumber) return;
        if (withSpinner) setIsLoading(true);
        try {
            const serverId = getSelectedServer();
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

    // Sélectionner une équipe est une navigation (le bouton Retour ramène à
    // l'écran précédent) ; le reste du contexte (période, provenance) voyage.
    const handleQueueSelect = (queueNumber: string) => {
        const params = new URLSearchParams(searchParams.toString());
        params.set("queue", queueNumber);
        router.push(`${pathname}?${params.toString()}`, { scroll: false });
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
                        Statistiques par groupe
                    </h1>
                    <p className="text-slate-500 mt-1">
                        Vue d'ensemble des performances par équipe (file d'attente + appels directs)
                    </p>
                </div>

                {noPerimeter && (
                    <NoPerimeterNotice context="Les statistiques portent sur les groupes qui vous sont attribués, et aucun ne l'est pour le moment." />
                )}

                {/* Filters Row */}
                {!noPerimeter && (
                <div className="flex flex-wrap items-center gap-4 p-4 bg-slate-50 rounded-xl border border-slate-200">
                    {/* Queue selector */}
                    <div className="flex-1 min-w-[300px] max-w-md">
                        <label className="text-sm font-medium text-slate-600 mb-1.5 block">
                            Groupe
                        </label>
                        <QueueSelector
                            queues={queues}
                            selectedQueueNumber={selectedQueueNumber}
                            onSelect={handleQueueSelect}
                            placeholder="Rechercher un groupe ou un agent..."
                        />
                    </div>
                </div>
                )}
            </div>

            {/* Aucun groupe choisi : l'aperçu du périmètre — une carte par
                groupe, remplie au fil de l'eau. La recherche au-dessus reste
                le chemin rapide pour qui sait où il va. */}
            {!noPerimeter && !selectedQueueNumber && !isLoadingQueues && queues.length > 0 && (
                <QueueOverviewGrid
                    queues={queues}
                    startDate={dateRange.startDate}
                    endDate={dateRange.endDate}
                    origin={origin}
                    onSelect={handleQueueSelect}
                />
            )}
            {!noPerimeter && !selectedQueueNumber && !isLoadingQueues && queues.length === 0 && (
                <div className="flex flex-col items-center justify-center py-20 text-slate-500">
                    <Users className="h-16 w-16 mb-4 text-slate-300" />
                    <h2 className="text-xl font-semibold text-slate-700">Aucune file dans votre périmètre</h2>
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
                        origin={origin}
                        agentExtensions={statistics.agents.map(a => a.extension)}
                    />

                    {/* Agent Performance Table V2 - Avec Total + Score + % */}
                    <AgentPerformanceTableV2
                        agents={statistics.agents}
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
