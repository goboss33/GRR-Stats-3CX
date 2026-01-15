"use client";

import { format } from "date-fns";
import { fr } from "date-fns/locale";
import {
    ArrowDownLeft,
    ArrowUpRight,
    ArrowLeftRight,
    Phone,
    PhoneOff,
    PhoneMissed,
    ChevronDown,
    ChevronRight,
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
import { Button } from "@/components/ui/button";

import {
    ColumnFilterInput,
    ColumnFilterDateRange,
    ColumnFilterDirection,
    ColumnFilterStatus,
    ColumnFilterDuration,
} from "@/components/column-filters";

import type {
    CallLog,
    CallDirection,
    CallStatus,
    ColumnVisibility,
    SortField,
    LogsSort,
} from "@/types/logs.types";

interface LogsTableProps {
    logs: CallLog[];
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
    // Expandable row
    expandedRowId?: string | null;
    onRowClick?: (callHistoryId: string) => void;
}

const directionConfig: Record<CallDirection, { icon: typeof ArrowDownLeft; label: string; className: string }> = {
    inbound: { icon: ArrowDownLeft, label: "Entrant", className: "bg-emerald-100 text-emerald-700" },
    outbound: { icon: ArrowUpRight, label: "Sortant", className: "bg-blue-100 text-blue-700" },
    internal: { icon: ArrowLeftRight, label: "Interne", className: "bg-slate-100 text-slate-700" },
};

const statusConfig: Record<CallStatus, { icon: typeof Phone; label: string; className: string }> = {
    answered: { icon: Phone, label: "Répondu", className: "bg-emerald-100 text-emerald-700" },
    missed: { icon: PhoneOff, label: "Manqué", className: "bg-rose-100 text-rose-700" },
    abandoned: { icon: PhoneMissed, label: "Abandonné", className: "bg-amber-100 text-amber-700" },
};

function formatDateTime(isoString: string): string {
    if (!isoString) return "-";
    return format(new Date(isoString), "dd/MM/yyyy HH:mm:ss", { locale: fr });
}

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
    const Icon = isActive
        ? currentSort?.direction === "asc"
            ? ArrowUp
            : ArrowDown
        : ArrowUpDown;

    return (
        <button
            onClick={() => onSort(field)}
            className="flex items-center gap-1 hover:text-slate-900 transition-colors"
        >
            {label}
            <Icon className={`h-3 w-3 ${isActive ? "text-slate-900" : "text-slate-400"}`} />
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
    // Expandable row
    expandedRowId,
    onRowClick,
}: LogsTableProps) {
    if (isLoading) {
        return (
            <div className="h-96 flex items-center justify-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-slate-900" />
            </div>
        );
    }

    // Note: We no longer return early for empty logs - we show the header with filters

    return (
        <div className="overflow-x-auto">
            <Table>
                <TableHeader>
                    {/* Row 1: Column Labels + Sort */}
                    <TableRow className="bg-slate-50 hover:bg-slate-50">
                        {columnVisibility.callHistoryId && (
                            <TableHead className="w-[70px]">ID</TableHead>
                        )}
                        <TableHead className="w-[150px]">
                            <SortableHeader label="Date/Heure" field="startedAt" currentSort={sort} onSort={onSort} />
                        </TableHead>
                        <TableHead className="min-w-[140px]">
                            <SortableHeader label="Appelant" field="sourceNumber" currentSort={sort} onSort={onSort} />
                        </TableHead>
                        <TableHead className="w-[40px] text-center">→</TableHead>
                        <TableHead className="min-w-[140px]">
                            <SortableHeader label="Appelé" field="destinationNumber" currentSort={sort} onSort={onSort} />
                        </TableHead>
                        <TableHead className="w-[100px] text-center">Direction</TableHead>
                        <TableHead className="w-[100px] text-center">Statut</TableHead>
                        <TableHead className="w-[100px] text-right">
                            <SortableHeader label="Durée" field="duration" currentSort={sort} onSort={onSort} />
                        </TableHead>
                        {columnVisibility.ringDuration && (
                            <TableHead className="w-[80px] text-right">Sonnerie</TableHead>
                        )}
                        {columnVisibility.trunkDid && (
                            <TableHead className="w-[120px]">Trunk DID</TableHead>
                        )}
                        {columnVisibility.terminationReason && (
                            <TableHead className="w-[120px]">Raison</TableHead>
                        )}
                    </TableRow>

                    {/* Row 2: Filter Inputs */}
                    <TableRow className="bg-slate-50/70 hover:bg-slate-50/70 border-b-2 border-slate-200">
                        {columnVisibility.callHistoryId && (
                            <TableHead className="py-2"></TableHead>
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
                        {columnVisibility.ringDuration && (
                            <TableHead className="py-2"></TableHead>
                        )}
                        {columnVisibility.trunkDid && (
                            <TableHead className="py-2"></TableHead>
                        )}
                        {columnVisibility.terminationReason && (
                            <TableHead className="py-2"></TableHead>
                        )}
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {logs.length === 0 ? (
                        <TableRow>
                            <TableCell
                                colSpan={20}
                                className="h-48 text-center text-slate-500"
                            >
                                Aucun appel trouvé pour ces critères
                            </TableCell>
                        </TableRow>
                    ) : (
                        logs.map((log) => {
                            const dirConfig = directionConfig[log.direction];
                            const statConfig = statusConfig[log.status];
                            const DirIcon = dirConfig.icon;
                            const StatIcon = statConfig.icon;
                            const isExpanded = expandedRowId === log.callHistoryId;

                            return (
                                <TableRow
                                    key={log.id}
                                    className={`hover:bg-slate-50 cursor-pointer ${isExpanded ? "bg-slate-100" : ""}`}
                                    onClick={() => log.callHistoryId && onRowClick?.(log.callHistoryId)}
                                >
                                    {/* ID Chaîne */}
                                    {columnVisibility.callHistoryId && (
                                        <TableCell className="font-mono text-xs text-slate-500">
                                            <div className="flex items-center gap-1">
                                                {isExpanded ? (
                                                    <ChevronDown className="h-3 w-3" />
                                                ) : (
                                                    <ChevronRight className="h-3 w-3" />
                                                )}
                                                {log.callHistoryIdShort}
                                            </div>
                                        </TableCell>
                                    )}

                                    {/* Date/Heure */}
                                    <TableCell className="text-sm whitespace-nowrap">
                                        {formatDateTime(log.startedAt)}
                                    </TableCell>

                                    {/* Appelant (2-line) */}
                                    <TableCell>
                                        <div className="min-w-[120px]">
                                            <div className="font-mono font-medium text-sm">{log.sourceNumber}</div>
                                            {log.sourceName && (
                                                <div className="text-xs text-slate-500 truncate max-w-[150px]">
                                                    {log.sourceName}
                                                </div>
                                            )}
                                        </div>
                                    </TableCell>

                                    {/* Arrow */}
                                    <TableCell className="text-center text-slate-400">→</TableCell>

                                    {/* Appelé (2-line) */}
                                    <TableCell>
                                        <div className="min-w-[120px]">
                                            <div className="font-mono font-medium text-sm">{log.destinationNumber}</div>
                                            {log.destinationName && (
                                                <div className="text-xs text-slate-500 truncate max-w-[150px]">
                                                    {log.destinationName}
                                                </div>
                                            )}
                                        </div>
                                    </TableCell>

                                    {/* Direction */}
                                    <TableCell className="text-center">
                                        <Badge variant="outline" className={`${dirConfig.className} gap-1`}>
                                            <DirIcon className="h-3 w-3" />
                                            <span className="hidden sm:inline">{dirConfig.label}</span>
                                        </Badge>
                                    </TableCell>

                                    {/* Statut */}
                                    <TableCell className="text-center">
                                        <Badge variant="outline" className={`${statConfig.className} gap-1`}>
                                            <StatIcon className="h-3 w-3" />
                                            <span className="hidden sm:inline">{statConfig.label}</span>
                                        </Badge>
                                    </TableCell>

                                    {/* Durée */}
                                    <TableCell className="text-right font-mono text-sm">
                                        {log.durationFormatted}
                                    </TableCell>

                                    {/* Ring Duration */}
                                    {columnVisibility.ringDuration && (
                                        <TableCell className="text-right font-mono text-sm text-slate-500">
                                            {log.ringDurationSeconds}s
                                        </TableCell>
                                    )}

                                    {/* Trunk DID */}
                                    {columnVisibility.trunkDid && (
                                        <TableCell className="font-mono text-xs text-slate-500">
                                            {log.trunkDid}
                                        </TableCell>
                                    )}

                                    {/* Raison */}
                                    {columnVisibility.terminationReason && (
                                        <TableCell className="text-xs text-slate-500 truncate max-w-[120px]">
                                            {log.terminationReason}
                                        </TableCell>
                                    )}
                                </TableRow>
                            );
                        })
                    )}
                </TableBody>
            </Table>
        </div>
    );
}
