"use client";

import * as React from "react";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import {
    ArrowDownLeft,
    ArrowUpRight,
    ArrowLeftRight,
    Shuffle,
    Phone,
    PhoneOff,
    PhoneMissed,
    Voicemail,
    PhoneCall,
    ArrowUpDown,
    ArrowUp,
    ArrowDown,
    Users,
    HelpCircle,
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
import { Skeleton } from "@/components/ui/skeleton";
import {
    Tooltip,
    TooltipTrigger,
    TooltipContent,
    TooltipProvider,
} from "@/components/ui/tooltip";

import {
    ColumnFilterInput,
    ColumnFilterDateRange,
    ColumnFilterDirection,
    ColumnFilterStatus,
    ColumnFilterDuration,
    ColumnFilterWaitTime,
    ColumnFilterSegmentCount,
    ColumnFilterQueue,
    ColumnFilterJourney,
    ColumnFilterTimeSlot,
} from "@/components/column-filters";
import { QueueInfo } from "@/types/queues.types";

import type {
    AggregatedCallLog,
    CallDirection,
    CallStatus,
    ColumnVisibility,
    SortField,
    LogsSort,
    JourneyStep,
    JourneyCondition,
    TimeSlot,
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
    // Time slot filter
    timeSlots: TimeSlot[];
    onTimeSlotsChange: (slots: TimeSlot[]) => void;
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
    // Wait time filter
    waitTimeMin?: number;
    waitTimeMax?: number;
    onWaitTimeChange: (range: { min?: number; max?: number }) => void;
    // Handled by filter
    handledBySearch: string;
    onHandledBySearchChange: (value: string) => void;
    // Queue filter
    queues: QueueInfo[];
    selectedQueueNumber: string | null;
    onQueueSelect: (queueNumber: string | null) => void;
    // ID filter (supports * wildcard)
    idSearch: string;
    onIdSearchChange: (value: string) => void;
    // Segment count filter
    segmentCountMin?: number;
    segmentCountMax?: number;
    onSegmentCountChange: (range: { min?: number; max?: number }) => void;
    // Journey filter (composable conditions)
    journeyConditions: JourneyCondition[];
    onJourneyConditionsChange: (conditions: JourneyCondition[]) => void;
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
    missed: { icon: PhoneOff, label: "Manqué", className: "bg-red-100 text-red-700" },
    busy: { icon: PhoneCall, label: "Occupé", className: "bg-red-100 text-red-700" },
};

// Journey step icon & style config — dynamic based on result
function getJourneyStepStyle(step: JourneyStep): { icon: React.ReactNode; className: string } {
    const iconClass = "w-4 h-4";
    switch (step.type) {
        case 'direct':
            switch (step.result) {
                case 'answered': return { icon: <Phone className={iconClass} />, className: 'text-emerald-600' };
                case 'busy':
                case 'not_answered':
                default: return { icon: <Phone className={iconClass} />, className: 'text-red-600' };
            }
        case 'queue':
            switch (step.result) {
                case 'answered': return { icon: <Users className={iconClass} />, className: 'text-emerald-600' };
                case 'overflow':
                case 'abandoned':
                case 'not_answered':
                default: return { icon: <Users className={iconClass} />, className: 'text-red-600' };
            }
        case 'voicemail':
            return { icon: <Voicemail className={iconClass} />, className: 'text-purple-600' };
        default:
            return { icon: <HelpCircle className={iconClass} />, className: 'text-slate-400' };
    }
}

function formatDateTime(isoString: string): string {
    if (!isoString) return "-";
    try {
        const date = new Date(isoString);
        return format(date, "dd/MM/yyyy", { locale: fr });
    } catch {
        return "-";
    }
}

function formatTime(isoString: string): string {
    if (!isoString) return "-";
    try {
        const date = new Date(isoString);
        return format(date, "HH:mm:ss", { locale: fr });
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
    // Time slots
    timeSlots,
    onTimeSlotsChange,
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
    // Wait time
    waitTimeMin,
    waitTimeMax,
    onWaitTimeChange,
    // Handled by
    handledBySearch,
    onHandledBySearchChange,
    // Queue filter
    queues,
    selectedQueueNumber,
    onQueueSelect,
    // ID filter
    idSearch,
    onIdSearchChange,
    // Segment count
    segmentCountMin,
    segmentCountMax,
    onSegmentCountChange,
    // Journey filter (composable conditions)
    journeyConditions,
    onJourneyConditionsChange,
    // Row click
    onRowClick,
}: LogsTableProps) {
    if (isLoading) {
        // Count visible columns to span correctly
        const visibleColCount = Object.values(columnVisibility).filter(Boolean).length + 1; // +1 for actions
        return (
            <TooltipProvider delayDuration={0}>
                <div className="overflow-x-auto">
                    <Table>
                        <TableHeader>
                            <TableRow className="bg-slate-50 hover:bg-slate-50">
                                {columnVisibility.callHistoryId && <TableHead className="w-20">ID</TableHead>}
                                {columnVisibility.segmentCount && <TableHead className="w-16 text-center">Seg.</TableHead>}
                                {columnVisibility.dateTime && <TableHead className="w-40">Date</TableHead>}
                                {columnVisibility.timeSlot && <TableHead>Heure</TableHead>}
                                {columnVisibility.caller && <TableHead>Appelant</TableHead>}
                                {columnVisibility.callee && <TableHead>Destinataire</TableHead>}
                                {columnVisibility.handledBy && <TableHead>Traité par</TableHead>}
                                {columnVisibility.queues && <TableHead>Queue(s)</TableHead>}
                                {columnVisibility.journey && <TableHead>Parcours</TableHead>}
                                {columnVisibility.direction && <TableHead>Direction</TableHead>}
                                {columnVisibility.status && <TableHead>Statut</TableHead>}
                                {columnVisibility.duration && <TableHead>Durée</TableHead>}
                                {columnVisibility.waitTime && <TableHead>Attente</TableHead>}
                                <TableHead className="w-10" />
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {Array.from({ length: 8 }).map((_, i) => (
                                <TableRow key={i} className="opacity-60">
                                    {columnVisibility.callHistoryId && (
                                        <TableCell><Skeleton className="h-4 w-10" /></TableCell>
                                    )}
                                    {columnVisibility.segmentCount && (
                                        <TableCell><Skeleton className="h-5 w-6 mx-auto" /></TableCell>
                                    )}
                                    {columnVisibility.dateTime && (
                                        <TableCell>
                                            <Skeleton className="h-4 w-20 mb-1" />
                                            <Skeleton className="h-3 w-14" />
                                        </TableCell>
                                    )}
                                    {columnVisibility.timeSlot && (
                                        <TableCell><Skeleton className="h-4 w-14" /></TableCell>
                                    )}
                                    {columnVisibility.caller && (
                                        <TableCell>
                                            <Skeleton className="h-4 w-24 mb-1" />
                                            <Skeleton className="h-3 w-16" />
                                        </TableCell>
                                    )}
                                    {columnVisibility.callee && (
                                        <TableCell>
                                            <Skeleton className="h-4 w-24 mb-1" />
                                            <Skeleton className="h-3 w-16" />
                                        </TableCell>
                                    )}
                                    {columnVisibility.handledBy && (
                                        <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                                    )}
                                    {columnVisibility.queues && (
                                        <TableCell><Skeleton className="h-5 w-16" /></TableCell>
                                    )}
                                    {columnVisibility.journey && (
                                        <TableCell>
                                            <div className="flex gap-1">
                                                <Skeleton className="h-6 w-16 rounded-full" />
                                                <Skeleton className="h-6 w-16 rounded-full" />
                                            </div>
                                        </TableCell>
                                    )}
                                    {columnVisibility.direction && (
                                        <TableCell><Skeleton className="h-5 w-16 rounded-full" /></TableCell>
                                    )}
                                    {columnVisibility.status && (
                                        <TableCell><Skeleton className="h-5 w-18 rounded-full" /></TableCell>
                                    )}
                                    {columnVisibility.duration && (
                                        <TableCell><Skeleton className="h-4 w-12" /></TableCell>
                                    )}
                                    {columnVisibility.waitTime && (
                                        <TableCell><Skeleton className="h-4 w-12" /></TableCell>
                                    )}
                                    <TableCell />
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>
            </TooltipProvider>
        );
    }

    return (
        <TooltipProvider delayDuration={0}>
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
                            {columnVisibility.dateTime && (
                                <TableHead className="w-40">
                                    <SortableHeader label="Date" field="startedAt" currentSort={sort} onSort={onSort} />
                                </TableHead>
                            )}
                            {columnVisibility.timeSlot && (
                                <TableHead>
                                    <SortableHeader label="Heure" field="timeOfDay" currentSort={sort} onSort={onSort} />
                                </TableHead>
                            )}
                            {columnVisibility.caller && (
                                <TableHead>
                                    <SortableHeader label="Appelant" field="sourceNumber" currentSort={sort} onSort={onSort} />
                                </TableHead>
                            )}
                            {columnVisibility.callee && (
                                <TableHead>
                                    <SortableHeader label="Destinataire" field="destinationNumber" currentSort={sort} onSort={onSort} />
                                </TableHead>
                            )}
                            {columnVisibility.handledBy && (
                                <TableHead>Traité par</TableHead>
                            )}
                            {columnVisibility.queues && (
                                <TableHead>Queue(s)</TableHead>
                            )}
                            {columnVisibility.journey && (
                                <TableHead>Parcours</TableHead>
                            )}
                            {columnVisibility.direction && (
                                <TableHead className="w-24 text-center">Direction</TableHead>
                            )}
                            {columnVisibility.status && (
                                <TableHead className="w-24 text-center">Statut</TableHead>
                            )}
                            {columnVisibility.duration && (
                                <TableHead className="w-20 text-right">
                                    <SortableHeader label="Durée" field="duration" currentSort={sort} onSort={onSort} />
                                </TableHead>
                            )}
                            {columnVisibility.waitTime && (
                                <TableHead className="w-20 text-right">Attente</TableHead>
                            )}
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
                            {columnVisibility.dateTime && (
                                <TableHead className="py-2">
                                    <ColumnFilterDateRange
                                        dateRange={dateRange}
                                        onDateRangeChange={onDateRangeChange}
                                    />
                                </TableHead>
                            )}
                            {columnVisibility.timeSlot && (
                                <TableHead className="py-2">
                                    <ColumnFilterTimeSlot
                                        slots={timeSlots}
                                        onChange={onTimeSlotsChange}
                                    />
                                </TableHead>
                            )}
                            {columnVisibility.caller && (
                                <TableHead className="py-2">
                                    <ColumnFilterInput
                                        value={callerSearch}
                                        onChange={onCallerSearchChange}
                                        placeholder="Rechercher..."
                                    />
                                </TableHead>
                            )}
                            {columnVisibility.callee && (
                                <TableHead className="py-2">
                                    <ColumnFilterInput
                                        value={calleeSearch}
                                        onChange={onCalleeSearchChange}
                                        placeholder="Rechercher..."
                                    />
                                </TableHead>
                            )}
                            {columnVisibility.handledBy && (
                                <TableHead className="py-2">
                                    <ColumnFilterInput
                                        value={handledBySearch}
                                        onChange={onHandledBySearchChange}
                                        placeholder="Agent..."
                                    />
                                </TableHead>
                            )}
                            {columnVisibility.queues && (
                                <TableHead className="py-2">
                                    <ColumnFilterQueue
                                        queues={queues}
                                        selectedQueueNumber={selectedQueueNumber}
                                        onSelect={onQueueSelect}
                                    />
                                </TableHead>
                            )}
                            {columnVisibility.journey && (
                                <TableHead className="py-2">
                                    <ColumnFilterJourney
                                        conditions={journeyConditions}
                                        onChange={onJourneyConditionsChange}
                                        queues={queues}
                                    />
                                </TableHead>
                            )}
                            {columnVisibility.direction && (
                                <TableHead className="py-2">
                                    <ColumnFilterDirection
                                        selected={selectedDirections}
                                        onChange={onDirectionsChange}
                                    />
                                </TableHead>
                            )}
                            {columnVisibility.status && (
                                <TableHead className="py-2">
                                    <ColumnFilterStatus
                                        selected={selectedStatuses}
                                        onChange={onStatusesChange}
                                    />
                                </TableHead>
                            )}
                            {columnVisibility.duration && (
                                <TableHead className="py-2">
                                    <ColumnFilterDuration
                                        min={durationMin}
                                        max={durationMax}
                                        onChange={onDurationChange}
                                    />
                                </TableHead>
                            )}
                            {columnVisibility.waitTime && (
                                <TableHead className="py-2">
                                    <ColumnFilterWaitTime
                                        min={waitTimeMin}
                                        max={waitTimeMax}
                                        onChange={onWaitTimeChange}
                                    />
                                </TableHead>
                            )}
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {logs.length === 0 ? (
                            <TableRow>
                                <TableCell
                                    colSpan={Object.values(columnVisibility).filter(Boolean).length + 2}
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
                                        {columnVisibility.dateTime && (
                                            <TableCell className="text-sm tabular-nums">
                                                {formatDateTime(log.startedAt)}
                                            </TableCell>
                                        )}

                                        {/* Time */}
                                        {columnVisibility.timeSlot && (
                                            <TableCell className="text-sm tabular-nums text-slate-600">
                                                {formatTime(log.startedAt)}
                                            </TableCell>
                                        )}

                                        {/* Caller */}
                                        {columnVisibility.caller && (
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
                                        )}

                                        {/* Callee (initial destination) */}
                                        {columnVisibility.callee && (
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
                                        )}

                                        {/* Handled By - same format as Appelant/Destinataire */}
                                        {columnVisibility.handledBy && (
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
                                        )}

                                        {/* Queue(s) */}
                                        {columnVisibility.queues && (
                                            <TableCell>
                                                {log.queues && log.queues.length > 0 ? (
                                                    <div className="flex flex-col gap-0.5">
                                                        {log.queues.slice(0, 2).map((q, idx) => (
                                                            <span key={idx} className="text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded px-1.5 py-0.5 truncate max-w-[140px]" title={q.name}>
                                                                {q.name || q.number}
                                                            </span>
                                                        ))}
                                                        {log.queues.length > 2 && (
                                                            <span className="text-[10px] text-slate-400">+{log.queues.length - 2}</span>
                                                        )}
                                                    </div>
                                                ) : (
                                                    <span className="text-xs text-slate-300">-</span>
                                                )}
                                            </TableCell>
                                        )}

                                        {/* Parcours (Journey) */}
                                        {columnVisibility.journey && (
                                            <TableCell>
                                                {log.journey && log.journey.length > 0 ? (() => {
                                                    const maxVisible = 8;
                                                    const visibleSteps = log.journey.slice(0, maxVisible);
                                                    const hiddenCount = log.journey.length - maxVisible;
                                                    return (
                                                        <div className="flex items-center gap-0.5">
                                                            {visibleSteps.map((step, idx) => {
                                                                const config = getJourneyStepStyle(step);
                                                                return (
                                                                    <React.Fragment key={idx}>
                                                                        {idx > 0 && (
                                                                            <span className="text-slate-300 text-xs mx-0.5">→</span>
                                                                        )}
                                                                        <Tooltip>
                                                                            <TooltipTrigger asChild>
                                                                                <span
                                                                                    className={`inline-flex items-center justify-center cursor-default ${config.className}`}
                                                                                >
                                                                                    {config.icon}
                                                                                </span>
                                                                            </TooltipTrigger>
                                                                            <TooltipContent side="top" className="text-xs max-w-[200px]">
                                                                                <div className="flex flex-col gap-1">
                                                                                    <span>{step.detail}</span>
                                                                                    {step.agent && (
                                                                                        <div className={`flex items-center gap-1 font-medium ${config.className}`}>
                                                                                            <Phone className="w-3 h-3" />
                                                                                            <span>{step.agent}</span>
                                                                                        </div>
                                                                                    )}
                                                                                </div>
                                                                            </TooltipContent>
                                                                        </Tooltip>
                                                                    </React.Fragment>
                                                                );
                                                            })}
                                                            {hiddenCount > 0 && (
                                                                <span className="text-[10px] text-slate-400 ml-0.5">+{hiddenCount}</span>
                                                            )}
                                                        </div>
                                                    );
                                                })() : (
                                                    <span className="text-xs text-slate-300">-</span>
                                                )}
                                            </TableCell>
                                        )}

                                        {/* Direction */}
                                        {columnVisibility.direction && (
                                            <TableCell className="text-center">
                                                <Badge variant="secondary" className={`gap-1 ${dirConfig.className}`}>
                                                    <DirIcon className="h-3 w-3" />
                                                    {dirConfig.label}
                                                </Badge>
                                            </TableCell>
                                        )}

                                        {/* Status */}
                                        {columnVisibility.status && (
                                            <TableCell className="text-center">
                                                <Badge variant="secondary" className={`gap-1 ${statConfig.className}`}>
                                                    <StatIcon className="h-3 w-3" />
                                                    {statConfig.label}
                                                </Badge>
                                            </TableCell>
                                        )}

                                        {/* Total Duration */}
                                        {columnVisibility.duration && (
                                            <TableCell className="text-right font-mono text-sm tabular-nums">
                                                {log.totalDurationFormatted}
                                            </TableCell>
                                        )}

                                        {/* Wait Time with color */}
                                        {columnVisibility.waitTime && (
                                            <TableCell className={`text-right font-mono text-sm tabular-nums ${getWaitTimeColor(log.waitTimeSeconds)}`}>
                                                {log.waitTimeFormatted}
                                            </TableCell>
                                        )}
                                    </TableRow>
                                );
                            })
                        )}
                    </TableBody>
                </Table>
            </div>
        </TooltipProvider>
    );
}
