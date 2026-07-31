"use client";

import { getSelectedServer } from "@/lib/selected-server";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { format } from "date-fns";
import { useUrlPeriod } from "@/lib/url-state";
import {
    Hash,
    Search,
    TrendingUp,
    PhoneIncoming,
    PhoneOutgoing,
    Clock,
    FileDown,
    FileSpreadsheet,
    AlertTriangle,
    RefreshCw,
    XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ExtensionSearchTable } from "@/components/stats-extension/extension-search-table";
import { ExtensionResultsTable } from "@/components/stats-extension/extension-results-table";
import { ExtensionTrendChart } from "@/components/stats-extension/extension-trend-chart";
import { ExtensionDetailPanel } from "@/components/stats-extension/extension-detail-panel";
import { AdvancedFilters, DEFAULT_ADVANCED_FILTERS, type AdvancedFiltersValue } from "@/components/stats-extension/advanced-filters";
import { PresetMenu } from "@/components/stats-extension/preset-menu";
import { getExtensionStatisticsChunk, getExtensionDirectory } from "@/services/extension-statistics.service";
import { generateExtensionStatsPDF, generateExtensionStatsCSV } from "@/services/extension-pdf-export";
import { computeTotals, mergeTrends } from "@/services/domain/extension-search";
import { formatDuration } from "@/services/domain/call-aggregation";
import { ServerId } from "@/lib/prisma-cdr";
import type {
    ExtensionDirectory,
    ExtensionStats,
    ExtensionStatsOptions,
    SearchEntry,
    SearchEntryKind,
} from "@/types/extension-stats.types";

const CHUNK_SIZE = 8;


// --------------------------------------------
// URL (de)serialization — entries survive a refresh and are shareable
// --------------------------------------------

const KIND_TO_PREFIX: Record<SearchEntryKind, string> = { extension: "e", ddi: "d", pattern: "p" };
const PREFIX_TO_KIND: Record<string, SearchEntryKind> = { e: "extension", d: "ddi", p: "pattern" };

function serializeEntries(entries: SearchEntry[]): string {
    return entries
        .map((e) => `${KIND_TO_PREFIX[e.kind]}:${encodeURIComponent(e.input)}`)
        .join(",");
}

function deserializeEntries(param: string | null): SearchEntry[] {
    if (!param) return [];
    return param
        .split(",")
        .map((token) => {
            const sepIndex = token.indexOf(":");
            if (sepIndex < 1) return null;
            const kind = PREFIX_TO_KIND[token.slice(0, sepIndex)];
            const input = decodeURIComponent(token.slice(sepIndex + 1)).trim();
            if (!kind || !input) return null;
            return { input, kind };
        })
        .filter((e): e is SearchEntry => e !== null);
}

function StatisticsExtensionPageInner() {
    const router = useRouter();
    const searchParams = useSearchParams();

    const [entries, setEntries] = useState<SearchEntry[]>(() => deserializeEntries(searchParams.get("entries")));
    // La période vient de l'URL (cf. lib/url-state).
    const { startDate: periodStart, endDate: periodEnd } = useUrlPeriod();
    const dateRange = { startDate: periodStart, endDate: periodEnd };

    const [advancedFilters, setAdvancedFilters] = useState<AdvancedFiltersValue>(DEFAULT_ADVANCED_FILTERS);

    const [directory, setDirectory] = useState<ExtensionDirectory>({ extensions: [], ddis: [] });
    const [results, setResults] = useState<ExtensionStats[] | null>(null);
    const [partialWarning, setPartialWarning] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [progress, setProgress] = useState({ done: 0, total: 0 });
    const [error, setError] = useState<string | null>(null);
    const [selectedInput, setSelectedInput] = useState<string | null>(null);
    const cancelRef = useRef(false);

    // Load the directory once (autocomplete + name display)
    useEffect(() => {
        const serverId = getSelectedServer();
        getExtensionDirectory(serverId).then(setDirectory);
    }, []);

    // Persist search state in the URL (shareable / survives refresh)
    useEffect(() => {
        const params = new URLSearchParams();
        if (entries.length > 0) params.set("entries", serializeEntries(entries));
        params.set("start", format(dateRange.startDate, "yyyy-MM-dd"));
        params.set("end", format(dateRange.endDate, "yyyy-MM-dd"));
        router.replace(`/statistics-extension?${params.toString()}`, { scroll: false });
    }, [entries, dateRange, router]);

    const statsOptions: ExtensionStatsOptions = useMemo(() => ({
        weekdays: advancedFilters.weekdays.length < 7 ? advancedFilters.weekdays : undefined,
        timeStart: advancedFilters.timeStart || undefined,
        timeEnd: advancedFilters.timeEnd || undefined,
        minDurationSeconds: advancedFilters.minDurationSeconds ?? undefined,
        directions: advancedFilters.directions,
        includePreviousPeriod: advancedFilters.includePrevious,
    }), [advancedFilters]);

    const handleSearch = async () => {
        if (entries.length === 0 || isLoading) return;

        cancelRef.current = false;
        setIsLoading(true);
        setError(null);
        setPartialWarning(null);
        setResults(null);
        setSelectedInput(null);

        const serverId = getSelectedServer();
        const chunks: SearchEntry[][] = [];
        for (let i = 0; i < entries.length; i += CHUNK_SIZE) {
            chunks.push(entries.slice(i, i + CHUNK_SIZE));
        }

        const accumulated: ExtensionStats[] = [];
        setProgress({ done: 0, total: entries.length });

        try {
            for (let i = 0; i < chunks.length; i++) {
                if (cancelRef.current) {
                    setPartialWarning(`Recherche interrompue — résultats partiels (${accumulated.length}/${entries.length} numéros).`);
                    break;
                }
                const chunkResults = await getExtensionStatisticsChunk(
                    serverId,
                    chunks[i],
                    dateRange.startDate.toISOString(),
                    dateRange.endDate.toISOString(),
                    statsOptions
                );
                accumulated.push(...chunkResults);
                setProgress({ done: accumulated.length, total: entries.length });
                setResults([...accumulated]);
            }
        } catch (err) {
            console.error("Error during statistics search:", err);
            if (accumulated.length > 0) {
                setPartialWarning(
                    `Une erreur est survenue pendant l'analyse — résultats partiels (${accumulated.length}/${entries.length} numéros).`
                );
            } else {
                setError(
                    err instanceof Error && err.message
                        ? `La recherche a échoué : ${err.message}`
                        : "La recherche a échoué. Essayez une période plus courte ou moins de numéros."
                );
            }
        } finally {
            setIsLoading(false);
        }
    };

    const handleCancel = () => {
        cancelRef.current = true;
    };

    const totals = useMemo(() => (results ? computeTotals(results) : null), [results]);
    const mergedTrend = useMemo(() => (results ? mergeTrends(results) : []), [results]);
    const selectedEntry = useMemo(
        () => results?.find((r) => r.input === selectedInput) ?? null,
        [results, selectedInput]
    );

    const responseForExport = useMemo(() => {
        if (!results || !totals) return null;
        return {
            extensions: results,
            period: {
                start: dateRange.startDate.toISOString(),
                end: dateRange.endDate.toISOString(),
            },
            totals,
        };
    }, [results, totals, dateRange]);

    const logsLinkParams = {
        start: format(dateRange.startDate, "yyyy-MM-dd"),
        end: format(dateRange.endDate, "yyyy-MM-dd"),
    };

    return (
        <div className="p-6 space-y-6">
            <div className="flex items-center gap-3">
                <Hash className="h-8 w-8 text-blue-600" />
                <h1 className="text-2xl font-bold">Statistiques par Extension / DDI</h1>
            </div>

            <Card>
                <CardHeader>
                    <div className="flex items-center justify-between">
                        <CardTitle>Recherche</CardTitle>
                        <PresetMenu
                            currentEntries={entries}
                            onApplyPreset={(presetEntries) => setEntries(presetEntries)}
                            disabled={isLoading}
                        />
                    </div>
                </CardHeader>
                <CardContent className="space-y-6">
                    <ExtensionSearchTable
                        entries={entries}
                        onEntriesChange={setEntries}
                        directory={directory}
                        disabled={isLoading}
                    />

                    <AdvancedFilters
                        value={advancedFilters}
                        onChange={setAdvancedFilters}
                        disabled={isLoading}
                    />

                    <div className="flex flex-wrap items-end gap-4">
                        <Button
                            onClick={handleSearch}
                            disabled={entries.length === 0 || isLoading}
                            size="lg"
                            className="h-12 px-8"
                        >
                            {isLoading ? (
                                <>
                                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white mr-2" />
                                    Analyse en cours...
                                </>
                            ) : (
                                <>
                                    <Search className="h-5 w-5 mr-2" />
                                    Rechercher
                                </>
                            )}
                        </Button>
                    </div>

                    {isLoading && (
                        <div className="space-y-2">
                            <div className="flex items-center justify-between text-sm text-slate-600">
                                <span>
                                    Analyse des numéros : {progress.done}/{progress.total}
                                </span>
                                <Button variant="ghost" size="sm" onClick={handleCancel} className="text-slate-500">
                                    <XCircle className="h-4 w-4 mr-1.5" />
                                    Arrêter
                                </Button>
                            </div>
                            <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                                <div
                                    className="h-full bg-blue-600 rounded-full transition-all duration-300"
                                    style={{ width: progress.total > 0 ? `${(progress.done / progress.total) * 100}%` : "0%" }}
                                />
                            </div>
                        </div>
                    )}
                </CardContent>
            </Card>

            {error && (
                <Card className="border-red-200 bg-red-50">
                    <CardContent className="pt-6">
                        <div className="flex items-center justify-between gap-4">
                            <div className="flex items-center gap-3">
                                <AlertTriangle className="h-5 w-5 text-red-500 flex-shrink-0" />
                                <p className="text-red-600">{error}</p>
                            </div>
                            <Button variant="outline" size="sm" onClick={handleSearch}>
                                <RefreshCw className="h-4 w-4 mr-2" />
                                Réessayer
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            )}

            {partialWarning && (
                <Card className="border-amber-200 bg-amber-50">
                    <CardContent className="pt-6">
                        <div className="flex items-center gap-3">
                            <AlertTriangle className="h-5 w-5 text-amber-500 flex-shrink-0" />
                            <p className="text-amber-700">{partialWarning}</p>
                        </div>
                    </CardContent>
                </Card>
            )}

            {results && totals && (
                <>
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                        <Card>
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                <CardTitle className="text-sm font-medium">Total Appels</CardTitle>
                                <TrendingUp className="h-4 w-4 text-muted-foreground" />
                            </CardHeader>
                            <CardContent>
                                <div className="text-2xl font-bold">{totals.totalCalls}</div>
                                <p className="text-xs text-muted-foreground">
                                    {totals.totalInbound} entrants, {totals.totalOutbound} sortants
                                </p>
                                {totals.previousTotalCalls !== null && (
                                    <p className="text-xs text-muted-foreground mt-1">
                                        Période précédente : {totals.previousTotalCalls}
                                    </p>
                                )}
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                <CardTitle className="text-sm font-medium">Appels Répondus</CardTitle>
                                <PhoneIncoming className="h-4 w-4 text-muted-foreground" />
                            </CardHeader>
                            <CardContent>
                                <div className="text-2xl font-bold">{totals.totalAnswered}</div>
                                <p className="text-xs text-muted-foreground">
                                    Taux de réponse: {totals.overallAnswerRate}%
                                </p>
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                <CardTitle className="text-sm font-medium">Appels Manqués</CardTitle>
                                <PhoneOutgoing className="h-4 w-4 text-muted-foreground" />
                            </CardHeader>
                            <CardContent>
                                <div className="text-2xl font-bold">{totals.totalMissed}</div>
                                <p className="text-xs text-muted-foreground">
                                    Sur {totals.totalInbound} appels entrants
                                </p>
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                <CardTitle className="text-sm font-medium">Durée Moyenne</CardTitle>
                                <Clock className="h-4 w-4 text-muted-foreground" />
                            </CardHeader>
                            <CardContent>
                                <div className="text-2xl font-bold">
                                    {formatDuration(totals.averageDurationSeconds)}
                                </div>
                                <p className="text-xs text-muted-foreground">
                                    Total: {formatDuration(totals.totalDurationSeconds)}
                                </p>
                            </CardContent>
                        </Card>
                    </div>

                    {mergedTrend.length > 0 && (
                        <Card>
                            <CardHeader>
                                <CardTitle>Évolution sur la période</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <ExtensionTrendChart data={mergedTrend} height={260} />
                            </CardContent>
                        </Card>
                    )}

                    <Card>
                        <CardHeader>
                            <div className="flex items-center justify-between">
                                <CardTitle>Détails par numéro</CardTitle>
                                <div className="flex items-center gap-2">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => responseForExport && generateExtensionStatsCSV(responseForExport)}
                                    >
                                        <FileSpreadsheet className="h-4 w-4 mr-2" />
                                        Export CSV
                                    </Button>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => responseForExport && generateExtensionStatsPDF(responseForExport)}
                                    >
                                        <FileDown className="h-4 w-4 mr-2" />
                                        Export PDF
                                    </Button>
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent>
                            <p className="text-xs text-slate-400 mb-3">
                                Cliquez sur une ligne pour afficher le détail (tendance, répartition horaire).
                            </p>
                            <ExtensionResultsTable
                                extensions={results}
                                selectedInput={selectedInput}
                                onSelectEntry={(entry) =>
                                    setSelectedInput(selectedInput === entry.input ? null : entry.input)
                                }
                                logsLinkParams={logsLinkParams}
                            />
                        </CardContent>
                    </Card>

                    {selectedEntry && (
                        <ExtensionDetailPanel
                            entry={selectedEntry}
                            serverId={getSelectedServer()}
                            dateRange={dateRange}
                            options={statsOptions}
                            logsLinkParams={logsLinkParams}
                            onClose={() => setSelectedInput(null)}
                        />
                    )}
                </>
            )}

            {!results && !error && !isLoading && (
                <Card>
                    <CardHeader>
                        <CardTitle>Résultats</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="border border-dashed rounded-lg p-12 text-center text-slate-400">
                            <Search className="h-10 w-10 mx-auto mb-3 opacity-50" />
                            <p className="text-sm">Ajoutez des extensions ou des DDI et lancez une recherche pour voir les statistiques</p>
                        </div>
                    </CardContent>
                </Card>
            )}
        </div>
    );
}

export default function StatisticsExtensionPage() {
    return (
        <Suspense>
            <StatisticsExtensionPageInner />
        </Suspense>
    );
}
