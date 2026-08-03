"use client";

import { useEffect, useState } from "react";
import { X, Phone, Globe, Asterisk, PhoneIncoming, PhoneOutgoing, Clock, TrendingUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { HeatmapChart } from "@/components/heatmap-chart";
import { ExtensionTrendChart } from "@/components/stats-extension/extension-trend-chart";
import { getExtensionEntryHeatmap } from "@/services/extension-statistics.service";
import { formatDuration } from "@/services/domain/call-aggregation";
import type { HeatmapDataPoint } from "@/services/domain/call.types";
import type { ExtensionStats, ExtensionStatsOptions } from "@/types/extension-stats.types";
import type { ServerId } from "@/lib/prisma-cdr";

interface ExtensionDetailPanelProps {
    entry: ExtensionStats;
    serverId: ServerId;
    dateRange: { startDate: Date; endDate: Date };
    options?: ExtensionStatsOptions;
    /** null = pas de droit sur les logs : les boutons vers les journaux disparaissent. */
    logsLinkParams: { start: string; end: string } | null;
    onClose: () => void;
}

function KindBadge({ kind }: { kind: ExtensionStats["kind"] }) {
    if (kind === "ddi") {
        return (
            <Badge variant="outline" className="border-sky-300 text-sky-700 bg-sky-50">
                <Globe className="h-3 w-3 mr-1" />
                DDI
            </Badge>
        );
    }
    if (kind === "pattern") {
        return (
            <Badge variant="outline" className="border-violet-300 text-violet-700 bg-violet-50">
                <Asterisk className="h-3 w-3 mr-1" />
                Modèle
            </Badge>
        );
    }
    return (
        <Badge variant="outline" className="border-emerald-300 text-emerald-700 bg-emerald-50">
            <Phone className="h-3 w-3 mr-1" />
            Extension
        </Badge>
    );
}

export function ExtensionDetailPanel({
    entry,
    serverId,
    dateRange,
    options,
    logsLinkParams,
    onClose,
}: ExtensionDetailPanelProps) {
    const [heatmapData, setHeatmapData] = useState<HeatmapDataPoint[]>([]);
    const [isLoadingHeatmap, setIsLoadingHeatmap] = useState(true);

    useEffect(() => {
        let cancelled = false;
        setIsLoadingHeatmap(true);
        setHeatmapData([]);

        getExtensionEntryHeatmap(
            serverId,
            { input: entry.input, kind: entry.kind },
            dateRange.startDate.toISOString(),
            dateRange.endDate.toISOString(),
            options
        ).then((data) => {
            if (cancelled) return;
            setHeatmapData(data);
            setIsLoadingHeatmap(false);
        });

        return () => {
            cancelled = true;
        };
    }, [entry.input, entry.kind, serverId, dateRange.startDate, dateRange.endDate, options]);

    const searchValue = entry.kind === "ddi" ? `*${entry.input.replace(/\D/g, "")}` : entry.input;
    const inboundLink = logsLinkParams
        ? `/admin/logs?start=${logsLinkParams.start}&end=${logsLinkParams.end}&callee=${encodeURIComponent(searchValue)}`
        : null;
    const outboundLink = logsLinkParams
        ? `/admin/logs?start=${logsLinkParams.start}&end=${logsLinkParams.end}&caller=${encodeURIComponent(searchValue)}`
        : null;

    return (
        <Card className="border-blue-200 shadow-sm">
            <CardHeader>
                <div className="flex items-start justify-between">
                    <div className="space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                            <CardTitle className="font-mono text-xl">{entry.extension}</CardTitle>
                            <KindBadge kind={entry.kind} />
                        </div>
                        <div className="text-sm text-slate-500 space-y-0.5">
                            {entry.displayName && <p>{entry.displayName}</p>}
                            {entry.associatedExtension && (
                                <p>
                                    Extension associée : <span className="font-mono">{entry.associatedExtension}</span>
                                    {entry.associatedName ? ` (${entry.associatedName})` : ""}
                                    — ses appels sortants sont inclus.
                                </p>
                            )}
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        {inboundLink && (
                            <Button variant="outline" size="sm" asChild>
                                <a href={inboundLink} target="_blank" rel="noopener noreferrer">
                                    <PhoneIncoming className="h-4 w-4 mr-1.5" />
                                    Logs entrants
                                </a>
                            </Button>
                        )}
                        {outboundLink && (
                            <Button variant="outline" size="sm" asChild>
                                <a href={outboundLink} target="_blank" rel="noopener noreferrer">
                                    <PhoneOutgoing className="h-4 w-4 mr-1.5" />
                                    Logs sortants
                                </a>
                            </Button>
                        )}
                        <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8">
                            <X className="h-4 w-4" />
                        </Button>
                    </div>
                </div>
            </CardHeader>
            <CardContent className="space-y-6">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="rounded-lg bg-slate-50 p-3">
                        <div className="flex items-center gap-1.5 text-xs text-slate-500 mb-1">
                            <TrendingUp className="h-3.5 w-3.5" />
                            Total appels
                        </div>
                        <p className="text-xl font-bold">{entry.totalCalls}</p>
                    </div>
                    <div className="rounded-lg bg-slate-50 p-3">
                        <div className="flex items-center gap-1.5 text-xs text-slate-500 mb-1">
                            <PhoneIncoming className="h-3.5 w-3.5" />
                            Taux de réponse
                        </div>
                        <p className="text-xl font-bold">{entry.inbound.answerRate}%</p>
                    </div>
                    <div className="rounded-lg bg-slate-50 p-3">
                        <div className="flex items-center gap-1.5 text-xs text-slate-500 mb-1">
                            <Clock className="h-3.5 w-3.5" />
                            Durée moyenne
                        </div>
                        <p className="text-xl font-bold">{entry.duration.averageFormatted}</p>
                    </div>
                    <div className="rounded-lg bg-slate-50 p-3">
                        <div className="flex items-center gap-1.5 text-xs text-slate-500 mb-1">
                            <Clock className="h-3.5 w-3.5" />
                            Durée max
                        </div>
                        <p className="text-xl font-bold">{formatDuration(entry.duration.maxSeconds)}</p>
                    </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <div>
                        <h3 className="text-sm font-semibold text-slate-700 mb-3">Évolution quotidienne</h3>
                        <ExtensionTrendChart data={entry.trend} height={240} />
                    </div>
                    <div>
                        <h3 className="text-sm font-semibold text-slate-700 mb-3">
                            Répartition par jour / heure
                            <span className="text-xs font-normal text-slate-400 ml-2">(tous segments de l'appel)</span>
                        </h3>
                        {isLoadingHeatmap ? (
                            <Skeleton className="h-[300px] w-full rounded-xl" />
                        ) : (
                            <HeatmapChart data={heatmapData} />
                        )}
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}
