"use client";

import { getSelectedServer } from "@/lib/selected-server";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Phone, PhoneOff, Clock, TrendingUp, Hourglass, Voicemail } from "lucide-react";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { formatDurationHuman as formatDuration, finalStatusesForBucket, ORIGIN_SENS } from "@/services/domain/call-aggregation";
import { format } from "date-fns";
import { useUrlPeriod, useUrlOrigin } from "@/lib/url-state";
import { useReportLoadedOrigins, useRegisterHeaderRefresh } from "@/components/header-scope";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { CallsChart } from "@/components/calls-chart";
import { HeatmapChart } from "@/components/heatmap-chart";
import { PeriodComparisonToggle, usePeriodComparisonPreference } from "@/components/period-comparison-toggle";
import { weekAlignedPreviousPeriod } from "@/services/domain/period-comparison";

import { getDashboardAllOrigins, getPrevTimelineAllOrigins } from "@/services/dashboard.service";
import { getScopedQueueOptions } from "@/services/queues.service";
import { QueueOverviewGrid } from "@/components/stats-v2/queue-overview-grid";
import type { QueueInfo } from "@/types/queues.types";
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
    const router = useRouter();
    const searchParams = useSearchParams();
    // Les équipes du périmètre, pour la grille de cartes sous les graphiques.
    const [teamQueues, setTeamQueues] = useState<QueueInfo[]>([]);
    // Droit « Voir les logs » : sans lui, les vignettes KPI perdent leur lien
    // vers les journaux (décision serveur, relayée par getScopedQueueOptions).
    // null = pas encore su : les vignettes NAISSENT sans lien, qui apparaît à
    // la confirmation — l'inverse (lien actif puis retiré) faisait scintiller.
    const [canViewLogs, setCanViewLogs] = useState<boolean | null>(null);
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

    // Superposition N-1 du graphique : préférence personnelle (localStorage).
    // Les courbes N-1 se préchargent en tâche de fond avec l'écran (cf.
    // reloadAll) — le toggle reste grisé avec un spinner tant qu'elles ne sont
    // pas là, puis l'activation est instantanée.
    const [compareEnabled, setCompareEnabled] = usePeriodComparisonPreference();
    const [prevTimelineCache, setPrevTimelineCache] =
        useState<Partial<Record<CallOrigin, TimelineDataPoint[]>> | null>(null);
    const [prevTimelineFailed, setPrevTimelineFailed] = useState(false);
    // L'alignement des points N-1 se fait par DATE décalée dans CallsChart.
    const previousOffsetMs = dateRange.startDate.getTime()
        - weekAlignedPreviousPeriod(dateRange.startDate, dateRange.endDate).startDate.getTime();

    // « Perdus » = manqués et occupés. La messagerie garde sa case : elle
    // décrit autre chose qu'un abandon, et l'exploitation s'en sert.
    const lostCalls = (metrics?.missedCalls || 0) + (metrics?.busyCalls || 0);
    // Chaque vignette de statut ouvre les journaux sur la meme population, avec
    // la periode courante — la liste des statuts vient de la table de
    // regroupement, donc elle suivra un changement de vocabulaire. Sans le
    // droit « Voir les logs », pas de lien : la vignette redevient un chiffre.
    const lienLogs = (statuts?: string[]) => {
        if (!canViewLogs) return undefined;
        const p = new URLSearchParams();
        p.set("start", format(dateRange.startDate, "yyyy-MM-dd"));
        p.set("end", format(dateRange.endDate, "yyyy-MM-dd"));
        if (statuts?.length) p.set("statuses", statuts.join(","));
        // La population listée doit être exactement celle du chiffre cliqué :
        // provenance ET sens voyagent avec le lien, tirés de la MÊME constante
        // que les requêtes du tableau de bord (ORIGIN_SENS) — la
        // correspondance KPI ↔ journaux tient par construction.
        p.set("sens", ORIGIN_SENS[origin].join(","));
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
     * (Re)charge le contexte : UN SEUL chargement produit les trois
     * provenances (requêtes groupées par classe de direction, composées côté
     * service) — le toggle entier devient consultable en même temps que
     * l'écran. Le jeton de contexte écarte les réponses périmées.
     */
    const reloadAll = useCallback(() => {
        const ctxKey = `${getSelectedServer()}|${dateRange.startDate.toISOString()}|${dateRange.endDate.toISOString()}|${Date.now()}`;
        contextKeyRef.current = ctxKey;
        setDataCache({});
        setIsLoading(true);
        getDashboardAllOrigins(getSelectedServer(), dateRange.startDate, dateRange.endDate)
            .then((all) => {
                if (contextKeyRef.current !== ctxKey) return;
                setDataCache(all);
                setIsInitialLoad(false);
            })
            .catch((error) => {
                console.error("Error fetching dashboard data:", error);
                if (contextKeyRef.current === ctxKey) setIsInitialLoad(false);
            })
            .finally(() => {
                if (contextKeyRef.current === ctxKey) setIsLoading(false);
            });

        // Courbes N-1 en tâche de fond, sans retenir l'écran : le toggle
        // « Période précédente » s'active à leur arrivée. Un échec ne prive
        // que la superposition — « Actualiser » relance tout, donc réessaie.
        setPrevTimelineCache(null);
        setPrevTimelineFailed(false);
        getPrevTimelineAllOrigins(getSelectedServer(), dateRange.startDate, dateRange.endDate)
            .then((all) => {
                if (contextKeyRef.current === ctxKey) setPrevTimelineCache(all);
            })
            .catch((error) => {
                console.error("Error fetching previous timeline:", error);
                if (contextKeyRef.current === ctxKey) setPrevTimelineFailed(true);
            });
    }, [dateRange.startDate, dateRange.endDate]);

    useEffect(() => {
        reloadAll();
    }, [reloadAll]);

    useEffect(() => {
        getScopedQueueOptions(getSelectedServer())
            .then((options) => {
                setTeamQueues(options.queues);
                setCanViewLogs(options.canViewLogs);
            })
            .catch(() => undefined);
    }, []);

    // Cliquer une carte ouvre la statistique de l'équipe, contexte conservé.
    const openTeamStats = useCallback((queueNumber: string) => {
        const params = new URLSearchParams();
        for (const key of ["start", "end", "origin"]) {
            const value = searchParams.get(key);
            if (value) params.set(key, value);
        }
        params.set("queue", queueNumber);
        router.push(`/statistics-v2?${params.toString()}`);
    }, [router, searchParams]);

    // Le bouton « Actualiser » vit dans le header de l'application : la page
    // lui déclare son action (et l'état de rotation).
    useRegisterHeaderRefresh(reloadAll, isLoading);


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

            </div>

            {/* Chiffres-clés. Une seule vignette réutilisée : le balisage n'est
                plus recopié, donc plus de divergences de mise en forme. */}
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
                <KpiCard
                    label="Appels reçus"
                    href={lienLogs()}
                    linkPending={canViewLogs === null}
                    value={(metrics?.totalCalls ?? 0).toLocaleString("fr-CH")}
                    icon={Phone}
                    subtitle="Volume de la période"
                    trend={{ current: metrics?.totalCalls ?? 0, previous: metrics?.prevTotalCalls ?? 0 }}
                    isLoading={isLoading}
                />
                <KpiCard
                    label="Répondus"
                    href={lienLogs(finalStatusesForBucket('answered'))}
                    linkPending={canViewLogs === null}
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
                    linkPending={canViewLogs === null}
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
                    linkPending={canViewLogs === null}
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
                        <div className="flex items-center justify-between gap-4">
                            <CardTitle className="text-lg font-bold text-slate-900">Évolution du Volume</CardTitle>
                            <PeriodComparisonToggle
                                checked={compareEnabled}
                                onCheckedChange={setCompareEnabled}
                                loading={!prevTimelineCache && !prevTimelineFailed}
                                unavailable={prevTimelineFailed}
                            />
                        </div>
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
                            <CallsChart
                                data={timelineData}
                                previousData={compareEnabled ? prevTimelineCache?.[origin] ?? null : null}
                                previousOffsetMs={previousOffsetMs}
                            />
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

            {/* Mes équipes — l'aperçu du périmètre, favorites d'abord. Le
                clin d'œil du manager : pastille rouge = équipe à aller voir. */}
            {teamQueues.length > 0 && (
                <div className="space-y-3">
                    <h2 className="text-lg font-bold text-slate-900">Mes équipes</h2>
                    <QueueOverviewGrid
                        queues={teamQueues}
                        startDate={dateRange.startDate}
                        endDate={dateRange.endDate}
                        origin={origin}
                        onSelect={openTeamStats}
                    />
                </div>
            )}
        </div>
    );
}
