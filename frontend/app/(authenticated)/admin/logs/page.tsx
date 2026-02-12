"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { RefreshCw, Download, FileText, Columns3 } from "lucide-react";
import { subDays, startOfDay, endOfDay, parseISO, format } from "date-fns";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { LogsTable } from "@/components/logs-table";
import { Pagination } from "@/components/pagination";
import { CallChainModal } from "@/components/call-chain-modal";
import { ActiveFilters } from "@/components/active-filters";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

import { getAggregatedCallLogs, exportCallLogsCSV } from "@/services/logs.service";
import { getQueueMembers } from "@/services/queues.service";
import { useDebounce } from "@/lib/use-debounce";
import type { QueueInfo } from "@/types/queues.types";
import type {
    AggregatedCallLog,
    CallDirection,
    CallStatus,
    LogsFilters,
    LogsSort,
    SortField,
    ColumnVisibility,
    AggregatedCallLogsResponse,
    JourneyStepType,
    JourneyStepResult,
    JourneyMatchMode,
} from "@/types/logs.types";

const PAGE_SIZE = 50;

const defaultColumnVisibility: ColumnVisibility = {
    callHistoryId: true,
    segmentCount: true,
};

export default function AdminLogsPage() {
    const router = useRouter();
    const searchParams = useSearchParams();

    // Parse URL params for filters
    const getInitialDateRange = () => {
        const startParam = searchParams.get("start");
        const endParam = searchParams.get("end");
        return {
            // Use startOfDay/endOfDay to anchor dates in LOCAL timezone
            startDate: startParam ? startOfDay(parseISO(startParam)) : startOfDay(subDays(new Date(), 7)),
            endDate: endParam ? endOfDay(parseISO(endParam)) : endOfDay(new Date()),
        };
    };

    const getInitialPage = () => {
        const pageParam = searchParams.get("page");
        return pageParam ? parseInt(pageParam, 10) : 1;
    };

    const getInitialDirections = (): CallDirection[] => {
        const param = searchParams.get("directions");
        if (!param) return [];
        return param.split(",").filter(d => ["inbound", "outbound", "internal", "bridge"].includes(d)) as CallDirection[];
    };

    const getInitialStatuses = (): CallStatus[] => {
        const param = searchParams.get("statuses");
        if (!param) return [];
        return param.split(",").filter(s => ["answered", "voicemail", "abandoned", "busy"].includes(s)) as CallStatus[];
    };

    const getInitialNumberParam = (key: string): number | undefined => {
        const param = searchParams.get(key);
        if (!param) return undefined;
        const num = parseInt(param, 10);
        return isNaN(num) ? undefined : num;
    };

    // Date range state
    const [dateRange, setDateRange] = useState(getInitialDateRange);
    const [currentPage, setCurrentPage] = useState(getInitialPage);
    const [sort, setSort] = useState<LogsSort | undefined>(undefined);
    const [columnVisibility, setColumnVisibility] = useState<ColumnVisibility>(defaultColumnVisibility);

    // Filter states - initialized from URL
    const [selectedDirections, setSelectedDirections] = useState<CallDirection[]>(getInitialDirections);
    const [selectedStatuses, setSelectedStatuses] = useState<CallStatus[]>(getInitialStatuses);
    const [callerSearch, setCallerSearch] = useState(searchParams.get("caller") || "");
    const [calleeSearch, setCalleeSearch] = useState(searchParams.get("callee") || "");
    const [handledBySearch, setHandledBySearch] = useState(searchParams.get("handledBy") || "");
    const [selectedQueueNumber, setSelectedQueueNumber] = useState<string | null>(searchParams.get("queue") || null);
    const [idSearch, setIdSearch] = useState(searchParams.get("id") || "");
    const [segmentCountMin, setSegmentCountMin] = useState<number | undefined>(() => getInitialNumberParam("segMin"));
    const [segmentCountMax, setSegmentCountMax] = useState<number | undefined>(() => getInitialNumberParam("segMax"));
    const [durationMin, setDurationMin] = useState<number | undefined>(() => getInitialNumberParam("durMin"));
    const [durationMax, setDurationMax] = useState<number | undefined>(() => getInitialNumberParam("durMax"));
    const [selectedJourneyTypes, setSelectedJourneyTypes] = useState<JourneyStepType[]>(() => {
        const param = searchParams.get("journey");
        if (!param) return [];
        const validTypes: JourneyStepType[] = ['direct', 'queue', 'voicemail'];
        return param.split(",").filter(t => validTypes.includes(t as JourneyStepType)) as JourneyStepType[];
    });
    const [journeyMatchMode, setJourneyMatchMode] = useState<JourneyMatchMode>(() => {
        const param = searchParams.get("journeyMode");
        return param === 'and' ? 'and' : 'or';
    });

    // Queue-specific journey filter states (for clickable KPIs)
    const getInitialJourneyQueueNumber = () => searchParams.get("journeyQueue") || undefined;

    const getInitialJourneyQueueResult = (): JourneyStepResult | undefined => {
        const param = searchParams.get("journeyResult");
        if (!param) return undefined;
        const validResults: JourneyStepResult[] = ['answered', 'not_answered', 'busy', 'voicemail'];
        return validResults.includes(param as JourneyStepResult)
            ? param as JourneyStepResult
            : undefined;
    };

    const getInitialHasMultipleQueues = (): boolean | undefined => {
        const param = searchParams.get("multiQueues");
        if (param === "true") return true;
        if (param === "false") return false;
        return undefined;
    };

    const [journeyQueueNumber, setJourneyQueueNumber] = useState<string | undefined>(
        () => getInitialJourneyQueueNumber()
    );
    const [journeyQueueResult, setJourneyQueueResult] = useState<JourneyStepResult | undefined>(
        () => getInitialJourneyQueueResult()
    );
    const [hasMultipleQueues, setHasMultipleQueues] = useState<boolean | undefined>(
        () => getInitialHasMultipleQueues()
    );

    // Data state
    const [data, setData] = useState<AggregatedCallLogsResponse | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isExporting, setIsExporting] = useState(false);
    const [resetCounter, setResetCounter] = useState(0); // Incremented on reset to trigger immediate fetch

    // Modal state
    const [selectedCallHistoryId, setSelectedCallHistoryId] = useState<string | null>(null);

    // Queues state for filter
    const [queues, setQueues] = useState<QueueInfo[]>([]);

    // Debounce search inputs (500ms)
    const debouncedCallerSearch = useDebounce(callerSearch, 500);
    const debouncedCalleeSearch = useDebounce(calleeSearch, 500);
    const debouncedHandledBySearch = useDebounce(handledBySearch, 500);
    const debouncedIdSearch = useDebounce(idSearch, 500);

    // Build effective filters
    // Key fix: if actual value is empty, use it immediately (for reset case)
    // Otherwise use debounced value (for typing case)
    const effectiveFilters: LogsFilters = {
        directions: selectedDirections,
        statuses: selectedStatuses,
        entityTypes: [],
        callerSearch: callerSearch === "" ? undefined : (debouncedCallerSearch || undefined),
        calleeSearch: calleeSearch === "" ? undefined : (debouncedCalleeSearch || undefined),
        handledBySearch: handledBySearch === "" ? undefined : (debouncedHandledBySearch || undefined),
        queueSearch: selectedQueueNumber || undefined,
        idSearch: idSearch === "" ? undefined : (debouncedIdSearch || undefined),
        segmentCountMin,
        segmentCountMax,
        durationMin,
        durationMax,
        journeyTypes: selectedJourneyTypes.length > 0 ? selectedJourneyTypes : undefined,
        journeyMatchMode: journeyMatchMode,
        // Queue-specific journey filters (for clickable KPIs)
        journeyQueueNumber: journeyQueueNumber,
        journeyQueueResult: journeyQueueResult,
        hasMultipleQueues: hasMultipleQueues,
    };

    // Update URL when filters change - uses DEBOUNCED values for text search
    const updateUrl = useCallback(() => {
        const params = new URLSearchParams();

        // Date range (always present) - use LOCAL date format, not UTC
        params.set("start", format(dateRange.startDate, "yyyy-MM-dd"));
        params.set("end", format(dateRange.endDate, "yyyy-MM-dd"));

        // Page (only if > 1)
        if (currentPage > 1) {
            params.set("page", currentPage.toString());
        }

        // Directions (only if filtered, not all 4)
        if (selectedDirections.length > 0 && selectedDirections.length < 4) {
            params.set("directions", selectedDirections.join(","));
        }

        // Statuses (only if filtered)
        if (selectedStatuses.length > 0) {
            params.set("statuses", selectedStatuses.join(","));
        }

        // Text search filters - use DEBOUNCED values
        if (debouncedCallerSearch.trim()) params.set("caller", debouncedCallerSearch.trim());
        if (debouncedCalleeSearch.trim()) params.set("callee", debouncedCalleeSearch.trim());
        if (debouncedHandledBySearch.trim()) params.set("handledBy", debouncedHandledBySearch.trim());
        if (selectedQueueNumber) params.set("queue", selectedQueueNumber);
        if (debouncedIdSearch.trim()) params.set("id", debouncedIdSearch.trim());

        // Numeric range filters
        if (segmentCountMin !== undefined) params.set("segMin", segmentCountMin.toString());
        if (segmentCountMax !== undefined) params.set("segMax", segmentCountMax.toString());
        if (durationMin !== undefined) params.set("durMin", durationMin.toString());
        if (durationMax !== undefined) params.set("durMax", durationMax.toString());

        // Journey types
        if (selectedJourneyTypes.length > 0) {
            params.set("journey", selectedJourneyTypes.join(","));
            if (journeyMatchMode === 'and') {
                params.set("journeyMode", "and");
            }
        }

        // Queue-specific journey filters (for clickable KPIs)
        if (journeyQueueNumber) params.set("journeyQueue", journeyQueueNumber);
        if (journeyQueueResult) params.set("journeyResult", journeyQueueResult);
        if (hasMultipleQueues !== undefined) params.set("multiQueues", String(hasMultipleQueues));

        router.replace(`/admin/logs?${params.toString()}`, { scroll: false });
    }, [
        router,
        dateRange.startDate,
        dateRange.endDate,
        currentPage,
        selectedDirections,
        selectedStatuses,
        debouncedCallerSearch,
        debouncedCalleeSearch,
        debouncedHandledBySearch,
        selectedQueueNumber,
        debouncedIdSearch,
        segmentCountMin,
        segmentCountMax,
        durationMin,
        durationMax,
        selectedJourneyTypes,
        journeyMatchMode,
        journeyQueueNumber,
        journeyQueueResult,
        hasMultipleQueues,
    ]);

    // Fetch data
    const fetchData = useCallback(async () => {
        setIsLoading(true);
        try {
            const result = await getAggregatedCallLogs(
                dateRange.startDate,
                dateRange.endDate,
                effectiveFilters,
                { page: currentPage, pageSize: PAGE_SIZE },
                sort
            );
            setData(result);
        } catch (error) {
            console.error("Error fetching logs:", error);
        } finally {
            setIsLoading(false);
        }
    }, [
        dateRange.startDate,
        dateRange.endDate,
        // Debounced values for search inputs (preserves typing delay)
        debouncedCallerSearch,
        debouncedCalleeSearch,
        debouncedHandledBySearch,
        selectedQueueNumber,
        debouncedIdSearch,
        // Reset counter triggers immediate refetch on reset
        resetCounter,
        selectedDirections,
        selectedStatuses,
        segmentCountMin,
        segmentCountMax,
        durationMin,
        durationMax,
        currentPage,
        sort,
        selectedJourneyTypes,
        journeyMatchMode
    ]);

    // Fetch on filter/page change and update URL
    useEffect(() => {
        fetchData();
        updateUrl();
    }, [fetchData, updateUrl]);

    // Load queues for filter dropdown
    useEffect(() => {
        const loadQueues = async () => {
            try {
                const queueList = await getQueueMembers();
                setQueues(queueList);
            } catch (error) {
                console.error("Error loading queues:", error);
            }
        };
        loadQueues();
    }, []);

    // Handlers
    const handleDateRangeChange = (range: { startDate: Date; endDate: Date }) => {
        setDateRange(range);
        setCurrentPage(1);
    };

    const handlePageChange = (page: number) => {
        setCurrentPage(page);
    };

    const handleSort = (field: SortField) => {
        setSort((prev) => {
            if (prev?.field === field) {
                return { field, direction: prev.direction === "asc" ? "desc" : "asc" };
            }
            return { field, direction: "desc" };
        });
    };

    const handleRefresh = () => {
        fetchData();
    };

    const handleExportCSV = async () => {
        setIsExporting(true);
        try {
            const csv = await exportCallLogsCSV(dateRange.startDate, dateRange.endDate, effectiveFilters);
            const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
            const link = document.createElement("a");
            link.href = URL.createObjectURL(blob);
            link.download = `logs-appels-${new Date().toISOString().split("T")[0]}.csv`;
            link.click();
        } catch (error) {
            console.error("Error exporting CSV:", error);
        } finally {
            setIsExporting(false);
        }
    };

    const handleDirectionsChange = (directions: CallDirection[]) => {
        setSelectedDirections(directions.length === 0 ? ["inbound", "outbound", "internal"] : directions);
        setCurrentPage(1);
    };

    const handleStatusesChange = (statuses: CallStatus[]) => {
        setSelectedStatuses(statuses);
        setCurrentPage(1);
    };

    const handleDurationChange = (range: { min?: number; max?: number }) => {
        setDurationMin(range.min);
        setDurationMax(range.max);
        setCurrentPage(1);
    };

    const handleRowClick = (callHistoryId: string) => {
        setSelectedCallHistoryId(callHistoryId);
    };

    // Handlers for removing individual filters
    const handleRemoveDirection = (direction: CallDirection) => {
        const newDirections = selectedDirections.filter(d => d !== direction);
        setSelectedDirections(newDirections.length === 0 ? ["inbound", "outbound", "internal", "bridge"] : newDirections);
        setCurrentPage(1);
    };

    const handleRemoveStatus = (status: CallStatus) => {
        setSelectedStatuses(selectedStatuses.filter(s => s !== status));
        setCurrentPage(1);
    };

    const handleRemoveCallerSearch = () => {
        setCallerSearch("");
        setCurrentPage(1);
    };

    const handleRemoveCalleeSearch = () => {
        setCalleeSearch("");
        setCurrentPage(1);
    };

    const handleRemoveHandledBySearch = () => {
        setHandledBySearch("");
        setCurrentPage(1);
    };

    const handleRemoveQueueSearch = () => {
        setSelectedQueueNumber(null);
        setCurrentPage(1);
    };

    const handleRemoveIdSearch = () => {
        setIdSearch("");
        setCurrentPage(1);
    };

    const handleRemoveSegmentCount = () => {
        setSegmentCountMin(undefined);
        setSegmentCountMax(undefined);
        setCurrentPage(1);
    };

    const handleRemoveDuration = () => {
        setDurationMin(undefined);
        setDurationMax(undefined);
        setCurrentPage(1);
    };

    const handleJourneyTypesChange = (types: JourneyStepType[]) => {
        setSelectedJourneyTypes(types);
        setCurrentPage(1);
    };

    const handleRemoveJourneyType = (type: JourneyStepType) => {
        setSelectedJourneyTypes(selectedJourneyTypes.filter(t => t !== type));
        setCurrentPage(1);
    };

    const handleRemoveJourneyQueueFilter = () => {
        setJourneyQueueNumber(undefined);
        setJourneyQueueResult(undefined);
        setHasMultipleQueues(undefined);
        setCurrentPage(1);
    };

    const handleResetAllFilters = () => {
        // Reset all filter states
        setSelectedDirections([]);
        setSelectedStatuses([]);
        setCallerSearch("");
        setCalleeSearch("");
        setHandledBySearch("");
        setSelectedQueueNumber(null);
        setIdSearch("");
        setSegmentCountMin(undefined);
        setSegmentCountMax(undefined);
        setDurationMin(undefined);
        setDurationMax(undefined);
        setSelectedJourneyTypes([]);
        setJourneyMatchMode('or');
        // Reset queue-specific journey filters
        setJourneyQueueNumber(undefined);
        setJourneyQueueResult(undefined);
        setHasMultipleQueues(undefined);
        setCurrentPage(1);
        // Increment reset counter to trigger immediate refetch (bypasses debounce)
        setResetCounter(c => c + 1);
    };

    return (
        <div className="space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <FileText className="h-8 w-8 text-slate-700" />
                    <div>
                        <h1 className="text-2xl font-bold text-slate-900">Logs d&apos;appels</h1>
                        <p className="text-slate-500">Exploration et audit des CDR</p>
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    {/* Column visibility toggle */}
                    <Popover>
                        <PopoverTrigger asChild>
                            <Button variant="outline" size="sm" className="gap-2">
                                <Columns3 className="h-4 w-4" />
                                Colonnes
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-48 p-2" align="end">
                            <p className="text-xs font-medium text-slate-600 mb-2 px-1">Colonnes visibles</p>
                            <div className="space-y-1">
                                <div className="flex items-center gap-2 px-1 py-1">
                                    <Checkbox
                                        id="col-id"
                                        checked={columnVisibility.callHistoryId}
                                        onCheckedChange={(checked) =>
                                            setColumnVisibility({ ...columnVisibility, callHistoryId: checked as boolean })
                                        }
                                    />
                                    <Label htmlFor="col-id" className="text-sm cursor-pointer">
                                        ID
                                    </Label>
                                </div>
                            </div>
                        </PopoverContent>
                    </Popover>

                    <Button
                        variant="outline"
                        size="sm"
                        onClick={handleRefresh}
                        disabled={isLoading}
                        className="gap-2"
                    >
                        <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
                        Actualiser
                    </Button>

                    <Button
                        variant="outline"
                        size="sm"
                        onClick={handleExportCSV}
                        disabled={isExporting || isLoading}
                        className="gap-2"
                    >
                        <Download className={`h-4 w-4 ${isExporting ? "animate-pulse" : ""}`} />
                        CSV
                    </Button>
                </div>
            </div>

            {/* Active Filters Badges */}
            <ActiveFilters
                dateRange={dateRange}
                filters={effectiveFilters}
                onRemoveDirection={handleRemoveDirection}
                onRemoveStatus={handleRemoveStatus}
                onRemoveCallerSearch={handleRemoveCallerSearch}
                onRemoveCalleeSearch={handleRemoveCalleeSearch}
                onRemoveHandledBySearch={handleRemoveHandledBySearch}
                onRemoveQueueSearch={handleRemoveQueueSearch}
                onRemoveIdSearch={handleRemoveIdSearch}
                onRemoveSegmentCount={handleRemoveSegmentCount}
                onRemoveDuration={handleRemoveDuration}
                onRemoveJourneyType={handleRemoveJourneyType}
                onRemoveJourneyQueueFilter={handleRemoveJourneyQueueFilter}
                onResetAll={handleResetAllFilters}
            />

            {/* Results Info */}
            {data && (
                <div className="flex items-center justify-between text-sm text-slate-600">
                    <span>
                        <span className="font-medium">{data.totalCount.toLocaleString()}</span> appels trouvés
                    </span>
                    <span>
                        Page {data.currentPage} sur {data.totalPages}
                    </span>
                </div>
            )}

            {/* Table with integrated filters */}
            <Card className="border-slate-200 shadow-sm overflow-hidden">
                <LogsTable
                    logs={data?.logs || []}
                    isLoading={isLoading}
                    columnVisibility={columnVisibility}
                    sort={sort}
                    onSort={handleSort}
                    onViewChain={setSelectedCallHistoryId}
                    // Filter props
                    dateRange={dateRange}
                    onDateRangeChange={handleDateRangeChange}
                    callerSearch={callerSearch}
                    onCallerSearchChange={setCallerSearch}
                    calleeSearch={calleeSearch}
                    onCalleeSearchChange={setCalleeSearch}
                    selectedDirections={selectedDirections}
                    onDirectionsChange={handleDirectionsChange}
                    selectedStatuses={selectedStatuses}
                    onStatusesChange={handleStatusesChange}
                    durationMin={durationMin}
                    durationMax={durationMax}
                    onDurationChange={handleDurationChange}
                    handledBySearch={handledBySearch}
                    onHandledBySearchChange={setHandledBySearch}
                    queues={queues}
                    selectedQueueNumber={selectedQueueNumber}
                    onQueueSelect={(qn) => {
                        setSelectedQueueNumber(qn);
                        setCurrentPage(1);
                    }}
                    // ID filter
                    idSearch={idSearch}
                    onIdSearchChange={setIdSearch}
                    // Segment count filter
                    segmentCountMin={segmentCountMin}
                    segmentCountMax={segmentCountMax}
                    onSegmentCountChange={({ min, max }) => {
                        setSegmentCountMin(min);
                        setSegmentCountMax(max);
                        setCurrentPage(1);
                    }}
                    // Journey filter
                    selectedJourneyTypes={selectedJourneyTypes}
                    onJourneyTypesChange={handleJourneyTypesChange}
                    journeyMatchMode={journeyMatchMode}
                    onJourneyMatchModeChange={(mode) => {
                        setJourneyMatchMode(mode);
                        setCurrentPage(1);
                    }}
                    // Row click
                    onRowClick={handleRowClick}
                />
                {data && data.totalPages > 1 && (
                    <Pagination
                        currentPage={data.currentPage}
                        totalPages={data.totalPages}
                        onPageChange={handlePageChange}
                    />
                )}
            </Card>

            {/* Call Chain Modal */}
            <CallChainModal
                callHistoryId={selectedCallHistoryId}
                onClose={() => setSelectedCallHistoryId(null)}
            />
        </div>
    );
}
