"use client";

import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { TooltipProvider } from "@/components/ui/tooltip";

import {
    ColumnFilterInput,
    ColumnFilterDateRange,
    ColumnFilterSens,
    ColumnFilterStatus,
    ColumnFilterQueueOutcome,
    ColumnFilterQueueOrigin,
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
    CallSens,
    CallStatus,
    ColumnVisibility,
    SortField,
    LogsSort,
    JourneyFilter,
    TimeSlot,
} from "@/types/logs.types";

import { SortableHeader } from "@/components/logs-table-helpers";
import { LogRow } from "@/components/log-row";
import type { KpiBucket } from "@/services/domain/call-classification";
import type { QueueOrigin } from "@/components/column-filters/ColumnFilterQueueOrigin";

type QueueBucket = Exclude<KpiBucket, "received">;
import { LogsTableSkeleton } from "@/components/logs-table-skeleton";

interface LogsTableProps {
    logs: AggregatedCallLog[];
    /** Vue file active : ajoute une colonne « Statut dans la file ». */
    queueView?: { number: string; name: string } | null;
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
    selectedSens: CallSens[];
    onSensChange: (sens: CallSens[]) => void;
    selectedStatuses: CallStatus[];
    onStatusesChange: (statuses: CallStatus[]) => void;
    /** Statuts « dans la file » retenus ; vide = tous. */
    queueOutcomes?: QueueBucket[];
    onQueueOutcomesChange?: (buckets: QueueBucket[]) => void;
    queueOrigin?: QueueOrigin | null;
    onQueueOriginChange?: (origin: QueueOrigin | null) => void;
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
    // Journey filter (groups with AND/OR operators)
    journeyFilter: JourneyFilter | null;
    onJourneyFilterChange: (filter: JourneyFilter | null) => void;
    // Row click
    onRowClick?: (callHistoryId: string) => void;
}

export function LogsTable({
    logs,
    queueView,
    isLoading,
    columnVisibility,
    sort,
    onSort,
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
    selectedSens,
    onSensChange,
    selectedStatuses,
    onStatusesChange,
    queueOutcomes,
    onQueueOutcomesChange,
    queueOrigin,
    onQueueOriginChange,
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
    // Journey filter (groups with AND/OR operators)
    journeyFilter,
    onJourneyFilterChange,
    // Row click
    onRowClick,
}: LogsTableProps) {
    if (isLoading) {
        return <LogsTableSkeleton columnVisibility={columnVisibility} />;
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
                            {columnVisibility.provenance && (
                                <TableHead className="w-28 text-center">Provenance</TableHead>
                            )}
                            {columnVisibility.sens && (
                                <TableHead className="w-24 text-center">Sens</TableHead>
                            )}
                            {queueView && (
                                <TableHead className="w-20 text-center">Origine</TableHead>
                            )}
                            {queueView && (
                                <TableHead className="w-28 text-center">
                                    Statut groupe {queueView.number}
                                </TableHead>
                            )}
                            {columnVisibility.status && (
                                // w-32 : « Non répondu » (sortants) est le libellé le
                                // plus long et doit tenir sur une ligne.
                                <TableHead className="w-32 text-center">Statut final</TableHead>
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
                                        filter={journeyFilter}
                                        onChange={onJourneyFilterChange}
                                        queues={queues}
                                    />
                                </TableHead>
                            )}
                            {/* Provenance : filtrée par le toggle du header —
                                pas de second filtre qui pourrait le contredire. */}
                            {columnVisibility.provenance && <TableHead className="py-2" />}
                            {columnVisibility.sens && (
                                <TableHead className="py-2">
                                    <ColumnFilterSens
                                        selected={selectedSens}
                                        onChange={onSensChange}
                                    />
                                </TableHead>
                            )}
                            {queueView && (
                                <TableHead className="py-2">
                                    <ColumnFilterQueueOrigin
                                        selected={queueOrigin ?? null}
                                        onChange={onQueueOriginChange ?? (() => {})}
                                    />
                                </TableHead>
                            )}
                            {queueView && (
                                <TableHead className="py-2">
                                    <ColumnFilterQueueOutcome
                                        selected={queueOutcomes ?? []}
                                        onChange={onQueueOutcomesChange ?? (() => {})}
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
                            logs.map((log) => (
                                <LogRow
                                    key={log.callHistoryId}
                                    queueViewActive={Boolean(queueView)}
                                    log={log}
                                    columnVisibility={columnVisibility}
                                    onRowClick={onRowClick}
                                />
                            ))
                        )}
                    </TableBody>
                </Table>
            </div>
        </TooltipProvider>
    );
}
