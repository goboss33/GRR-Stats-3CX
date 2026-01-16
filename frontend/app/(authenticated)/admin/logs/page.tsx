"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { RefreshCw, Download, FileText, Columns3 } from "lucide-react";
import { subDays, startOfDay, endOfDay, parseISO } from "date-fns";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { LogsTable } from "@/components/logs-table";
import { Pagination } from "@/components/pagination";
import { CallChainModal } from "@/components/call-chain-modal";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

import { getAggregatedCallLogs, exportCallLogsCSV } from "@/services/logs.service";
import { useDebounce } from "@/lib/use-debounce";
import type {
    AggregatedCallLog,
    CallDirection,
    CallStatus,
    LogsFilters,
    LogsSort,
    SortField,
    ColumnVisibility,
    AggregatedCallLogsResponse,
} from "@/types/logs.types";

const PAGE_SIZE = 50;

const defaultColumnVisibility: ColumnVisibility = {
    callHistoryId: true,
};

export default function AdminLogsPage() {
    const router = useRouter();
    const searchParams = useSearchParams();

    // Parse URL params
    const getInitialDateRange = () => {
        const startParam = searchParams.get("start");
        const endParam = searchParams.get("end");
        return {
            startDate: startParam ? parseISO(startParam) : startOfDay(subDays(new Date(), 7)),
            endDate: endParam ? parseISO(endParam) : endOfDay(new Date()),
        };
    };

    const getInitialPage = () => {
        const pageParam = searchParams.get("page");
        return pageParam ? parseInt(pageParam, 10) : 1;
    };

    // Date range state
    const [dateRange, setDateRange] = useState(getInitialDateRange);
    const [currentPage, setCurrentPage] = useState(getInitialPage);
    const [sort, setSort] = useState<LogsSort | undefined>(undefined);
    const [columnVisibility, setColumnVisibility] = useState<ColumnVisibility>(defaultColumnVisibility);

    // Filter states
    const [selectedDirections, setSelectedDirections] = useState<CallDirection[]>(["inbound", "outbound", "internal"]);
    const [selectedStatuses, setSelectedStatuses] = useState<CallStatus[]>([]);
    const [callerSearch, setCallerSearch] = useState("");
    const [calleeSearch, setCalleeSearch] = useState("");
    const [durationMin, setDurationMin] = useState<number | undefined>(undefined);
    const [durationMax, setDurationMax] = useState<number | undefined>(undefined);

    // Data state
    const [data, setData] = useState<AggregatedCallLogsResponse | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isExporting, setIsExporting] = useState(false);

    // Modal state
    const [selectedCallHistoryId, setSelectedCallHistoryId] = useState<string | null>(null);

    // Debounce search inputs (500ms)
    const debouncedCallerSearch = useDebounce(callerSearch, 500);
    const debouncedCalleeSearch = useDebounce(calleeSearch, 500);

    // Build effective filters
    const effectiveFilters: LogsFilters = {
        directions: selectedDirections,
        statuses: selectedStatuses,
        entityTypes: [],
        callerSearch: debouncedCallerSearch || undefined,
        calleeSearch: debouncedCalleeSearch || undefined,
        durationMin,
        durationMax,
    };

    // Update URL when filters change
    const updateUrl = useCallback(
        (range: { startDate: Date; endDate: Date }, page: number) => {
            const params = new URLSearchParams();
            params.set("start", range.startDate.toISOString().split("T")[0]);
            params.set("end", range.endDate.toISOString().split("T")[0]);
            if (page > 1) {
                params.set("page", page.toString());
            }
            router.replace(`/admin/logs?${params.toString()}`, { scroll: false });
        },
        [router]
    );

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
        debouncedCallerSearch,
        debouncedCalleeSearch,
        selectedDirections,
        selectedStatuses,
        durationMin,
        durationMax,
        currentPage,
        sort
    ]);

    // Fetch on filter/page change
    useEffect(() => {
        fetchData();
        updateUrl(dateRange, currentPage);
    }, [fetchData, updateUrl, dateRange, currentPage]);

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
