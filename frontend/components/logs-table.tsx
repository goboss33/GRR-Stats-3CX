"use client";

import * as React from "react";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import {
    ArrowDownLeft,
    ArrowUpRight,
    ArrowLeftRight,
    ArrowRight,
    Shuffle,
    Phone,
    PhoneOff,
    PhoneMissed,
    Voicemail,
    PhoneCall,
    ArrowUpDown,
    ArrowUp,
    ArrowDown,
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

import {
    ColumnFilterInput,
    ColumnFilterDateRange,
    ColumnFilterDirection,
    ColumnFilterStatus,
    ColumnFilterDuration,
    ColumnFilterSegmentCount,
} from "@/components/column-filters";

import type {
    AggregatedCallLog,
    CallDirection,
    CallStatus,
    ColumnVisibility,
    SortField,
    LogsSort,
} from "@/types/logs.types";

interface LogsTableProps {
    logs: AggregatedCallLog[];
    isLoading?: boolean;
    columnVisibility: ColumnVisibility;
    sort?: LogsSort;
    onSort: (field: SortField) => void;
    onViewChain: (callHistoryId: string) => void;
    // Filter props
    dateRange: { startDate: Date; endDate: Date };
    onDateRangeChange: (range: { startDate: Date; endDate: Date }) => void;
    callerSearch: string;
    onCallerSearchChange: (value: string) => void;
    calleeSearch: string;
    onCalleeSearchChange: (value: string) => void;
    selectedDirections: CallDirection[];
    onDirectionsChange: (directions: CallDirection[]) => void;
    selectedStatuses: CallStatus[];
    onStatusesChange: (statuses: CallStatus[]) => void;
    durationMin?: number;
    durationMax?: number;
    onDurationChange: (range: { min?: number; max?: number }) => void;
    // Handled by filter
    handledBySearch: string;
    onHandledBySearchChange: (value: string) => void;
    // Queue filter
    queueSearch: string;
    onQueueSearchChange: (value: string) => void;
    // ID filter (supports * wildcard)
    idSearch: string;
    onIdSearchChange: (value: string) => void;
    // Segment count filter
    segmentCountMin?: number;
    segmentCountMax?: number;
    onSegmentCountChange: (range: { min?: number; max?: number }) => void;
    // Row click
    onRowClick?: (callHistoryId: string) => void;
}

const directionConfig: Record<CallDirection, { icon: typeof ArrowDownLeft; label: string; className: string }> = {
    inbound: { icon: ArrowDownLeft, label: "Entrant", className: "bg-emerald-100 text-emerald-700" },
    outbound: { icon: ArrowUpRight, label: "Sortant", className: "bg-blue-100 text-blue-700" },
    internal: { icon: ArrowLeftRight, label: "Interne", className: "bg-slate-100 text-slate-700" },
    bridge: { icon: Shuffle, label: "Bridge", className: "bg-purple-100 text-purple-700" },
};

const statusConfig: Record<CallStatus, { icon: typeof Phone; label: string; className: string }> = {
    answered: { icon: Phone, label: "Répondu", className: "bg-emerald-100 text-emerald-700" },
    voicemail: { icon: Voicemail, label: "Messagerie", className: "bg-blue-100 text-blue-700" },
    abandoned: { icon: PhoneOff, label: "Abandonné", className: "bg-amber-100 text-amber-700" },
    busy: { icon: PhoneCall, label: "Occupé", className: "bg-red-100 text-red-700" },
};

function formatDateTime(isoString: string): string {
    if (!isoString) return "-";
    try {
        const date = new Date(isoString);
        return format(date, "dd/MM/yyyy HH:mm:ss", { locale: fr });
    } catch {
        return "-";
    }
}

// Get color for segment count badge
function getSegmentBadgeColor(count: number): string {
    if (count === 1) return "bg-emerald-100 text-emerald-700";
    if (count <= 3) return "bg-yellow-100 text-yellow-700";
    if (count <= 5) return "bg-orange-100 text-orange-700";
    return "bg-red-100 text-red-700";
}

// Get color for wait time
function getWaitTimeColor(seconds: number): string {
    if (seconds < 15) return "text-emerald-600";
    if (seconds < 30) return "text-yellow-600";
    if (seconds < 60) return "text-orange-600";
    return "text-red-600";
}

// Sortable header component
function SortableHeader({
    label,
    field,
    currentSort,
    onSort,
}: {
    label: string;
    field: SortField;
    currentSort?: LogsSort;
    onSort: (field: SortField) => void;
}) {
    const isActive = currentSort?.field === field;
    const direction = isActive ? currentSort.direction : undefined;

    return (
        <button
            onClick={() => onSort(field)}
            className="flex items-center gap-1 hover:text-slate-900 transition-colors text-left w-full"
        >
            <span className="truncate">{label}</span>
            {isActive ? (
                direction === "asc" ? (
                    <ArrowUp className="h-3 w-3 text-primary flex-shrink-0" />
                ) : (
                    <ArrowDown className="h-3 w-3 text-primary flex-shrink-0" />
                )
            ) : (
                <ArrowUpDown className="h-3 w-3 text-slate-400 flex-shrink-0" />
            )}
        </button>
    );
}

export function LogsTable({
    logs,
    isLoading,
    columnVisibility,
    sort,
    onSort,
    onViewChain,
    // Filter props
    dateRange,
    onDateRangeChange,
    callerSearch,
    onCallerSearchChange,
    calleeSearch,
    onCalleeSearchChange,
    selectedDirections,
    onDirectionsChange,
    selectedStatuses,
    onStatusesChange,
    durationMin,
    durationMax,
    onDurationChange,
    // Handled by
    handledBySearch,
    onHandledBySearchChange,
    // Queue filter
    queueSearch,
    onQueueSearchChange,
    // ID filter
    idSearch,
    onIdSearchChange,
    // Segment count
    segmentCountMin,
    segmentCountMax,
    onSegmentCountChange,
    // Row click
    onRowClick,
}: LogsTableProps) {
    if (isLoading) {
        return (
            <div className="h-96 flex items-center justify-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-slate-900" />
            </div>
        );
    }

    return (
        <div className="overflow-x-auto">
            <Table>
                <TableHeader>
                    {/* Row 1: Column Labels + Sort */}
                    <TableRow className="bg-slate-50 hover:bg-slate-50">
                        {columnVisibility.callHistoryId && (
                            <TableHead className="w-20">ID</TableHead>
                        )}
                        {columnVisibility.segmentCount && (
                            <TableHead className="w-16 text-center">Seg.</TableHead>
                        )}
                        <TableHead className="w-40">
                            <SortableHeader label="Date/Heure" field="startedAt" currentSort={sort} onSort={onSort} />
                        </TableHead>
                        <TableHead>
                            <SortableHeader label="Appelant" field="sourceNumber" currentSort={sort} onSort={onSort} />
                        </TableHead>
                        <TableHead className="w-10 text-center"></TableHead>
                        <TableHead>
                            <SortableHeader label="Destinataire" field="destinationNumber" currentSort={sort} onSort={onSort} />
                        </TableHead>
                        <TableHead className="w-10 text-center"></TableHead>
                        <TableHead>Traité par</TableHead>
                        <TableHead>Queue(s)</TableHead>
                        <TableHead className="w-24 text-center">Direction</TableHead>
                        <TableHead className="w-24 text-center">Statut</TableHead>
                        <TableHead className="w-20 text-right">
                            <SortableHeader label="Durée" field="duration" currentSort={sort} onSort={onSort} />
                        </TableHead>
                        <TableHead className="w-20 text-right">Attente</TableHead>
                    </TableRow>

                    {/* Row 2: Filter Inputs */}
                    <TableRow className="bg-slate-50/70 hover:bg-slate-50/70 border-b-2 border-slate-200">
                        {columnVisibility.callHistoryId && (
                            <TableHead className="py-2">
                                <ColumnFilterInput
                                    value={idSearch}
                                    onChange={onIdSearchChange}
                                    placeholder="*ID34"
                                />
                            </TableHead>
                        )}
                        {columnVisibility.segmentCount && (
                            <TableHead className="py-2">
                                <ColumnFilterSegmentCount
                                    min={segmentCountMin}
                                    max={segmentCountMax}
                                    onChange={onSegmentCountChange}
                                />
                            </TableHead>
                        )}
                        <TableHead className="py-2">
                            <ColumnFilterDateRange
                                dateRange={dateRange}
                                onDateRangeChange={onDateRangeChange}
                            />
                        </TableHead>
                        <TableHead className="py-2">
                            <ColumnFilterInput
                                value={callerSearch}
                                onChange={onCallerSearchChange}
                                placeholder="Rechercher..."
                            />
                        </TableHead>
                        <TableHead className="py-2"></TableHead>
                        <TableHead className="py-2">
                            <ColumnFilterInput
                                value={calleeSearch}
                                onChange={onCalleeSearchChange}
                                placeholder="Rechercher..."
                            />
                        </TableHead>
                        <TableHead className="py-2"></TableHead>
                        <TableHead className="py-2">
                            <ColumnFilterInput
                                value={handledBySearch}
                                onChange={onHandledBySearchChange}
                                placeholder="Agent..."
                            />
                        </TableHead>
                        <TableHead className="py-2">
                            <ColumnFilterInput
                                value={queueSearch}
                                onChange={onQueueSearchChange}
                                placeholder="Queue..."
                            />
                        </TableHead>
                        <TableHead className="py-2">
                            <ColumnFilterDirection
                                selected={selectedDirections}
                                onChange={onDirectionsChange}
                            />
                        </TableHead>
                        <TableHead className="py-2">
                            <ColumnFilterStatus
                                selected={selectedStatuses}
                                onChange={onStatusesChange}
                            />
                        </TableHead>
                        <TableHead className="py-2">
                            <ColumnFilterDuration
                                min={durationMin}
                                max={durationMax}
                                onChange={onDurationChange}
                            />
                        </TableHead>
                        <TableHead className="py-2"></TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {logs.length === 0 ? (
                        <TableRow>
                            <TableCell
                                colSpan={13}
                                className="h-48 text-center text-slate-500"
                            >
                                Aucun appel trouvé pour ces critères
                            </TableCell>
                        </TableRow>
                    ) : (
                        logs.map((log) => {
                            const dirConfig = directionConfig[log.direction];
                            const statConfig = statusConfig[log.finalStatus];
                            const DirIcon = dirConfig.icon;
                            const StatIcon = statConfig.icon;

                            return (
                                <TableRow
                                    key={log.callHistoryId}
                                    className="cursor-pointer hover:bg-slate-50 transition-colors"
                                    onClick={() => onRowClick?.(log.callHistoryId)}
                                >
                                    {/* ID column */}
                                    {columnVisibility.callHistoryId && (
                                        <TableCell className="font-mono text-xs">
                                            <span className="text-slate-500">{log.callHistoryIdShort}</span>
                                        </TableCell>
                                    )}

                                    {/* Segment count column */}
                                    {columnVisibility.segmentCount && (
                                        <TableCell className="text-center">
                                            <Badge
                                                variant="secondary"
                                                className={`text-[10px] px-1.5 py-0.5 ${getSegmentBadgeColor(log.segmentCount)}`}
                                            >
                                                {log.segmentCount}
                                            </Badge>
                                        </TableCell>
                                    )}

                                    {/* Date/Time */}
                                    <TableCell className="text-sm tabular-nums">
                                        {formatDateTime(log.startedAt)}
                                    </TableCell>

                                    {/* Caller */}
                                    <TableCell>
                                        <div className="flex flex-col">
                                            <span className="font-medium text-sm">{log.callerNumber}</span>
                                            {log.callerName && (
                                                <span className="text-xs text-slate-500 truncate max-w-[180px]">
                                                    {log.callerName}
                                                </span>
                                            )}
                                        </div>
                                    </TableCell>

                                    {/* Empty spacer column */}
                                    <TableCell className="text-center">
                                        <ArrowRight className="h-4 w-4 text-slate-400 mx-auto" />
                                    </TableCell>

                                    {/* Callee (initial destination) */}
                                    <TableCell>
                                        <div className="flex flex-col">
                                            <span className={`font-medium text-sm ${log.finalStatus !== "answered" ? "text-slate-400 italic" : ""}`}>
                                                {log.calleeNumber}
                                            </span>
                                            {log.calleeName && (
                                                <span className={`text-xs truncate max-w-[180px] ${log.finalStatus !== "answered" ? "text-slate-400 italic" : "text-slate-500"}`}>
                                                    {log.calleeName}
                                                </span>
                                            )}
                                        </div>
                                    </TableCell>

                                    {/* Arrow (direct or transferred) - between Destinataire and Traité par */}
                                    <TableCell className="text-center">
                                        {log.wasTransferred ? (
                                            <span title="Transféré">
                                                <Shuffle className="h-4 w-4 text-amber-500 mx-auto" />
                                            </span>
                                        ) : (
                                            <ArrowRight className="h-4 w-4 text-slate-400 mx-auto" />
                                        )}
                                    </TableCell>

                                    {/* Handled By - same format as Appelant/Destinataire */}
                                    <TableCell>
                                        {log.handledBy && log.handledBy.length > 0 ? (
                                            <div className="flex flex-col">
                                                <span className="font-medium text-sm">
                                                    {log.handledBy[0].number}
                                                </span>
                                                <span className="text-xs text-slate-500 truncate max-w-[180px]">
                                                    {log.handledBy[0].name || log.handledBy[0].number}
                                                    {log.handledBy.length > 1 && (
                                                        <span className="text-slate-400"> +{log.handledBy.length - 1}</span>
                                                    )}
                                                </span>
                                            </div>
                                        ) : (
                                            <span className="text-xs text-slate-300">-</span>
                                        )}
                                    </TableCell>

                                    {/* Queue(s) */}
                                    <TableCell>
                                        {log.queues && log.queues.length > 0 ? (
                                            <div className="flex flex-col">
                                                <span className="font-medium text-sm">
                                                    {log.queues[0].number}
                                                </span>
                                                <span className="text-xs text-slate-500 truncate max-w-[180px]">
                                                    {log.queues[0].name || log.queues[0].number}
                                                    {log.queues.length > 1 && (
                                                        <span className="text-slate-400"> +{log.queues.length - 1}</span>
                                                    )}
                                                </span>
                                            </div>
                                        ) : (
                                            <span className="text-xs text-slate-300">-</span>
                                        )}
                                    </TableCell>

                                    {/* Direction */}
                                    <TableCell className="text-center">
                                        <Badge variant="secondary" className={`gap-1 ${dirConfig.className}`}>
                                            <DirIcon className="h-3 w-3" />
                                            {dirConfig.label}
                                        </Badge>
                                    </TableCell>

                                    {/* Status */}
                                    <TableCell className="text-center">
                                        <Badge variant="secondary" className={`gap-1 ${statConfig.className}`}>
                                            <StatIcon className="h-3 w-3" />
                                            {statConfig.label}
                                        </Badge>
                                    </TableCell>

                                    {/* Total Duration */}
                                    <TableCell className="text-right font-mono text-sm tabular-nums">
                                        {log.totalDurationFormatted}
                                    </TableCell>

                                    {/* Wait Time with color */}
                                    <TableCell className={`text-right font-mono text-sm tabular-nums ${getWaitTimeColor(log.waitTimeSeconds)}`}>
                                        {log.waitTimeFormatted}
                                    </TableCell>
                                </TableRow>
                            );
                        })
                    )}
                </TableBody>
            </Table>
        </div>
    );
}
