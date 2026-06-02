"use client";

import { useState } from "react";
import { startOfMonth, endOfMonth } from "date-fns";
import { Hash, Search, TrendingUp, PhoneIncoming, PhoneOutgoing, Clock, FileDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DateRangePicker } from "@/components/date-range-picker";
import { ExtensionSearchTable } from "@/components/stats-extension/extension-search-table";
import { ExtensionResultsTable } from "@/components/stats-extension/extension-results-table";
import { getExtensionStatistics } from "@/services/extension-statistics.service";
import { generateExtensionStatsPDF } from "@/services/extension-pdf-export";
import { ServerId } from "@/lib/prisma-cdr";
import { formatDuration } from "@/services/domain/call-aggregation";
import type { ExtensionStatisticsResponse } from "@/types/extension-stats.types";

function getSelectedServer(): ServerId {
    if (typeof document === "undefined") return "gerofinance";
    const match = document.cookie.match(/selectedServer=([^;]+)/);
    return (match?.[1] as ServerId) || "gerofinance";
}

export default function StatisticsExtensionPage() {
    const [extensions, setExtensions] = useState<string[]>([]);
    const [dateRange, setDateRange] = useState(() => {
        const now = new Date();
        return {
            startDate: startOfMonth(now),
            endDate: endOfMonth(now),
        };
    });
    const [results, setResults] = useState<ExtensionStatisticsResponse | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleSearch = async () => {
        if (extensions.length === 0) return;

        setIsLoading(true);
        setError(null);
        setResults(null);

        try {
            const serverId = getSelectedServer();
            const data = await getExtensionStatistics(serverId, extensions, dateRange.startDate, dateRange.endDate);
            setResults(data);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Une erreur est survenue");
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="p-6 space-y-6">
            <div className="flex items-center gap-3">
                <Hash className="h-8 w-8 text-blue-600" />
                <h1 className="text-2xl font-bold">Statistiques par Extension</h1>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>Recherche</CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                    <ExtensionSearchTable
                        extensions={extensions}
                        onExtensionsChange={setExtensions}
                    />

                    <div className="flex flex-wrap items-end gap-4">
                        <div className="flex-1 min-w-[300px]">
                            <label className="text-sm font-medium text-slate-700 mb-2 block">Période</label>
                            <DateRangePicker
                                dateRange={dateRange}
                                onDateRangeChange={setDateRange}
                            />
                        </div>

                        <Button
                            onClick={handleSearch}
                            disabled={extensions.length === 0 || isLoading}
                            size="lg"
                            className="h-12 px-8"
                        >
                            {isLoading ? (
                                <>
                                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white mr-2" />
                                    Recherche...
                                </>
                            ) : (
                                <>
                                    <Search className="h-5 w-5 mr-2" />
                                    Rechercher
                                </>
                            )}
                        </Button>
                    </div>
                </CardContent>
            </Card>

            {error && (
                <Card className="border-red-200 bg-red-50">
                    <CardContent className="pt-6">
                        <p className="text-red-600">{error}</p>
                    </CardContent>
                </Card>
            )}

            {results && (
                <>
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                        <Card>
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                <CardTitle className="text-sm font-medium">Total Appels</CardTitle>
                                <TrendingUp className="h-4 w-4 text-muted-foreground" />
                            </CardHeader>
                            <CardContent>
                                <div className="text-2xl font-bold">{results.totals.totalCalls}</div>
                                <p className="text-xs text-muted-foreground">
                                    {results.totals.totalInbound} entrants, {results.totals.totalOutbound} sortants
                                </p>
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                <CardTitle className="text-sm font-medium">Appels Répondus</CardTitle>
                                <PhoneIncoming className="h-4 w-4 text-muted-foreground" />
                            </CardHeader>
                            <CardContent>
                                <div className="text-2xl font-bold">{results.totals.totalAnswered}</div>
                                <p className="text-xs text-muted-foreground">
                                    Taux de réponse: {results.totals.overallAnswerRate}%
                                </p>
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                <CardTitle className="text-sm font-medium">Appels Manqués</CardTitle>
                                <PhoneOutgoing className="h-4 w-4 text-muted-foreground" />
                            </CardHeader>
                            <CardContent>
                                <div className="text-2xl font-bold">{results.totals.totalMissed}</div>
                                <p className="text-xs text-muted-foreground">
                                    Sur {results.totals.totalInbound} appels entrants
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
                                    {formatDuration(results.totals.averageDurationSeconds)}
                                </div>
                                <p className="text-xs text-muted-foreground">
                                    Total: {formatDuration(results.totals.totalDurationSeconds)}
                                </p>
                            </CardContent>
                        </Card>
                    </div>

                    <Card>
                        <CardHeader>
                            <div className="flex items-center justify-between">
                                <CardTitle>Détails par Extension</CardTitle>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => generateExtensionStatsPDF(results)}
                                >
                                    <FileDown className="h-4 w-4 mr-2" />
                                    Export PDF
                                </Button>
                            </div>
                        </CardHeader>
                        <CardContent>
                            <ExtensionResultsTable extensions={results.extensions} />
                        </CardContent>
                    </Card>
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
                            <p className="text-sm">Ajoutez des extensions et lancez une recherche pour voir les statistiques</p>
                        </div>
                    </CardContent>
                </Card>
            )}
        </div>
    );
}
