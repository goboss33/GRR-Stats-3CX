"use client";

import { useState } from "react";
import {
    ArrowUpDown,
    ArrowUp,
    ArrowDown,
    Phone,
    Globe,
    Asterisk,
    PhoneIncoming,
    PhoneOutgoing,
    TrendingUp,
    TrendingDown,
    Minus,
    Info,
} from "lucide-react";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    Tip,
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import type { ExtensionStats } from "@/types/extension-stats.types";

interface ExtensionResultsTableProps {
    extensions: ExtensionStats[];
    /** Currently selected entry (raw input), highlighted in the table */
    selectedInput?: string | null;
    onSelectEntry?: (entry: ExtensionStats) => void;
    /** Date range used to build pre-filtered links to the logs page */
    /** null = pas de droit sur les logs : les boutons vers les journaux disparaissent. */
    logsLinkParams: { start: string; end: string } | null;
}

type SortField = "extension" | "name" | "totalCalls" | "inbound" | "outbound" | "answered" | "missed" | "answerRate" | "duration";
type SortDirection = "asc" | "desc";

function KindBadge({ kind }: { kind: ExtensionStats["kind"] }) {
    if (kind === "ddi") {
        return (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-sky-300 text-sky-700 bg-sky-50">
                <Globe className="h-3 w-3 mr-1" />
                DDI
            </Badge>
        );
    }
    if (kind === "pattern") {
        return (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-violet-300 text-violet-700 bg-violet-50">
                <Asterisk className="h-3 w-3 mr-1" />
                Modèle
            </Badge>
        );
    }
    return (
        <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-emerald-300 text-emerald-700 bg-emerald-50">
            <Phone className="h-3 w-3 mr-1" />
            Ext.
        </Badge>
    );
}

function DeltaBadge({ current, previous }: { current: number; previous: number | null | undefined }) {
    if (previous === null || previous === undefined) return null;
    if (previous === 0 && current === 0) return null;

    if (previous === 0) {
        return (
            <Tip content="Période précédente : 0 appel">
                <span className="inline-flex items-center text-[10px] font-medium text-emerald-600">
                    <TrendingUp className="h-3 w-3 mr-0.5" />
                    new
                </span>
            </Tip>
        );
    }

    const delta = Math.round(((current - previous) / previous) * 100);
    if (delta === 0) {
        return (
            <Tip content={`Période précédente : ${previous}`}>
                <span className="inline-flex items-center text-[10px] font-medium text-slate-400">
                    <Minus className="h-3 w-3 mr-0.5" />
                    0%
                </span>
            </Tip>
        );
    }

    const isUp = delta > 0;
    return (
        <Tip content={`Période précédente : ${previous}`}>
            <span className={`inline-flex items-center text-[10px] font-medium ${isUp ? "text-emerald-600" : "text-red-500"}`}>
                {isUp ? <TrendingUp className="h-3 w-3 mr-0.5" /> : <TrendingDown className="h-3 w-3 mr-0.5" />}
                {isUp ? "+" : ""}{delta}%
            </span>
        </Tip>
    );
}

export function ExtensionResultsTable({ extensions, selectedInput, onSelectEntry, logsLinkParams }: ExtensionResultsTableProps) {
    const [sortField, setSortField] = useState<SortField>("totalCalls");
    const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

    const handleSort = (field: SortField) => {
        if (sortField === field) {
            setSortDirection(sortDirection === "asc" ? "desc" : "asc");
        } else {
            setSortField(field);
            setSortDirection("desc");
        }
    };

    const sortedExtensions = [...extensions].sort((a, b) => {
        let aValue: number | string;
        let bValue: number | string;

        switch (sortField) {
            case "extension":
                aValue = a.extension;
                bValue = b.extension;
                break;
            case "name":
                aValue = a.displayName ?? "";
                bValue = b.displayName ?? "";
                break;
            case "totalCalls":
                aValue = a.totalCalls;
                bValue = b.totalCalls;
                break;
            case "inbound":
                aValue = a.inbound.total;
                bValue = b.inbound.total;
                break;
            case "outbound":
                aValue = a.outbound.total;
                bValue = b.outbound.total;
                break;
            case "answered":
                aValue = a.inbound.answered;
                bValue = b.inbound.answered;
                break;
            case "missed":
                aValue = a.inbound.missed;
                bValue = b.inbound.missed;
                break;
            case "answerRate":
                aValue = a.inbound.answerRate;
                bValue = b.inbound.answerRate;
                break;
            case "duration":
                aValue = a.duration.totalSeconds;
                bValue = b.duration.totalSeconds;
                break;
            default:
                return 0;
        }

        if (typeof aValue === "string" && typeof bValue === "string") {
            return sortDirection === "asc"
                ? aValue.localeCompare(bValue)
                : bValue.localeCompare(aValue);
        }

        return sortDirection === "asc"
            ? (aValue as number) - (bValue as number)
            : (bValue as number) - (aValue as number);
    });

    const SortIcon = ({ field }: { field: SortField }) => {
        if (sortField !== field) {
            return <ArrowUpDown className="h-3 w-3 ml-1 opacity-50" />;
        }
        return sortDirection === "asc"
            ? <ArrowUp className="h-3 w-3 ml-1" />
            : <ArrowDown className="h-3 w-3 ml-1" />;
    };

    const buildLogsLink = (ext: ExtensionStats, direction: "inbound" | "outbound") => {
        const params = new URLSearchParams();
        params.set("start", logsLinkParams?.start ?? "");
        params.set("end", logsLinkParams?.end ?? "");
        const searchValue = ext.kind === "ddi"
            ? `*${ext.input.replace(/\D/g, "")}`
            : ext.input;
        params.set(direction === "inbound" ? "callee" : "caller", searchValue);
        return `/admin/logs?${params.toString()}`;
    };

    return (
        <div className="border rounded-lg overflow-x-auto">
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead className="w-[70px]">Type</TableHead>
                        <TableHead
                            className="cursor-pointer hover:bg-slate-50"
                            onClick={() => handleSort("extension")}
                        >
                            <div className="flex items-center">
                                Numéro
                                <SortIcon field="extension" />
                            </div>
                        </TableHead>
                        <TableHead
                            className="cursor-pointer hover:bg-slate-50"
                            onClick={() => handleSort("name")}
                        >
                            <div className="flex items-center">
                                Nom
                                <SortIcon field="name" />
                            </div>
                        </TableHead>
                        <TableHead>Ext. associée</TableHead>
                        <TableHead
                            className="cursor-pointer hover:bg-slate-50 text-right"
                            onClick={() => handleSort("totalCalls")}
                        >
                            <div className="flex items-center justify-end">
                                Total
                                <SortIcon field="totalCalls" />
                            </div>
                        </TableHead>
                        <TableHead
                            className="cursor-pointer hover:bg-slate-50 text-right"
                            onClick={() => handleSort("inbound")}
                        >
                            <div className="flex items-center justify-end">
                                Entrants
                                <SortIcon field="inbound" />
                            </div>
                        </TableHead>
                        <TableHead
                            className="cursor-pointer hover:bg-slate-50 text-right"
                            onClick={() => handleSort("outbound")}
                        >
                            <div className="flex items-center justify-end">
                                Sortants
                                <SortIcon field="outbound" />
                            </div>
                        </TableHead>
                        <TableHead
                            className="cursor-pointer hover:bg-slate-50 text-right"
                            onClick={() => handleSort("answered")}
                        >
                            <div className="flex items-center justify-end">
                                Répondus
                                <SortIcon field="answered" />
                            </div>
                        </TableHead>
                        <TableHead
                            className="cursor-pointer hover:bg-slate-50 text-right"
                            onClick={() => handleSort("missed")}
                        >
                            <div className="flex items-center justify-end">
                                Manqués
                                <SortIcon field="missed" />
                            </div>
                        </TableHead>
                        <TableHead
                            className="cursor-pointer hover:bg-slate-50 text-right"
                            onClick={() => handleSort("answerRate")}
                        >
                            <div className="flex items-center justify-end">
                                Taux rép.
                                <SortIcon field="answerRate" />
                            </div>
                        </TableHead>
                        <TableHead
                            className="cursor-pointer hover:bg-slate-50 text-right"
                            onClick={() => handleSort("duration")}
                        >
                            <div className="flex items-center justify-end">
                                Durée totale
                                <SortIcon field="duration" />
                            </div>
                        </TableHead>
                        <TableHead className="text-right">Durée moy.</TableHead>
                        <TableHead className="text-center w-[90px]">Logs</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {sortedExtensions.map((ext) => {
                        const isSelected = selectedInput === ext.input;
                        return (
                            <TableRow
                                key={ext.input}
                                className={`${onSelectEntry ? "cursor-pointer" : ""} ${isSelected ? "bg-blue-50 hover:bg-blue-100" : ""}`}
                                onClick={() => onSelectEntry?.(ext)}
                            >
                                <TableCell>
                                    <KindBadge kind={ext.kind} />
                                </TableCell>
                                <TableCell className="font-medium">
                                    <Badge variant="secondary" className="font-mono">
                                        {ext.extension}
                                    </Badge>
                                </TableCell>
                                <TableCell className="max-w-[180px] truncate" title={ext.displayName ?? undefined}>
                                    {ext.displayName ?? <span className="text-slate-300">—</span>}
                                </TableCell>
                                <TableCell>
                                    {ext.associatedExtension ? (
                                        <TooltipProvider delayDuration={0}>
                                            <Tooltip>
                                                <TooltipTrigger asChild>
                                                    <span className="inline-flex items-center gap-1 text-sm">
                                                        <Badge variant="outline" className="font-mono">
                                                            {ext.associatedExtension}
                                                        </Badge>
                                                        {ext.associatedName && (
                                                            <span className="text-xs text-slate-500 max-w-[120px] truncate">
                                                                {ext.associatedName}
                                                            </span>
                                                        )}
                                                    </span>
                                                </TooltipTrigger>
                                                <TooltipContent>
                                                    <p>Les appels sortants de cette extension sont inclus dans les statistiques de la DDI.</p>
                                                </TooltipContent>
                                            </Tooltip>
                                        </TooltipProvider>
                                    ) : (
                                        <span className="text-slate-300">—</span>
                                    )}
                                </TableCell>
                                <TableCell className="text-right">
                                    <div className="flex items-center justify-end gap-2">
                                        <span className="font-semibold">{ext.totalCalls}</span>
                                        <DeltaBadge current={ext.totalCalls} previous={ext.previousPeriod?.totalCalls} />
                                    </div>
                                </TableCell>
                                <TableCell className="text-right">{ext.inbound.total}</TableCell>
                                <TableCell className="text-right">{ext.outbound.total}</TableCell>
                                <TableCell className="text-right text-emerald-600">{ext.inbound.answered}</TableCell>
                                <TableCell className="text-right text-red-600">
                                    <span className="inline-flex items-center justify-end gap-1">
                                        {ext.inbound.missed}
                                        {ext.totalCalls === 0 && (
                                            <TooltipProvider delayDuration={0}>
                                                <Tooltip>
                                                    <TooltipTrigger asChild>
                                                        <Info className="h-3.5 w-3.5 text-slate-300" />
                                                    </TooltipTrigger>
                                                    <TooltipContent>
                                                        <p>Aucun appel trouvé. Vérifiez le numéro ou élargissez la période.</p>
                                                    </TooltipContent>
                                                </Tooltip>
                                            </TooltipProvider>
                                        )}
                                    </span>
                                </TableCell>
                                <TableCell className="text-right">
                                    <Badge
                                        variant={ext.inbound.answerRate >= 70 ? "default" : "secondary"}
                                        className={ext.inbound.answerRate >= 70 ? "bg-emerald-100 text-emerald-800 border-emerald-200" : ""}
                                    >
                                        {ext.inbound.answerRate}%
                                    </Badge>
                                </TableCell>
                                <TableCell className="text-right">{ext.duration.totalFormatted}</TableCell>
                                <TableCell className="text-right text-slate-600">{ext.duration.averageFormatted}</TableCell>
                                <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
                                    {logsLinkParams && <div className="flex items-center justify-center gap-1">
                                        <Tip content="Voir les appels entrants dans les logs">
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-7 w-7 text-slate-400 hover:text-blue-600"
                                                asChild
                                            >
                                                <a href={buildLogsLink(ext, "inbound")} target="_blank" rel="noopener noreferrer">
                                                    <PhoneIncoming className="h-4 w-4" />
                                                </a>
                                            </Button>
                                        </Tip>
                                        <Tip content="Voir les appels sortants dans les logs">
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-7 w-7 text-slate-400 hover:text-blue-600"
                                                asChild
                                            >
                                                <a href={buildLogsLink(ext, "outbound")} target="_blank" rel="noopener noreferrer">
                                                    <PhoneOutgoing className="h-4 w-4" />
                                                </a>
                                            </Button>
                                        </Tip>
                                    </div>}
                                </TableCell>
                            </TableRow>
                        );
                    })}
                </TableBody>
            </Table>
        </div>
    );
}
