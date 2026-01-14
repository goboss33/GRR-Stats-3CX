"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { RefreshCw, Download, FileText, Layers } from "lucide-react";
import { subDays, startOfDay, endOfDay, parseISO } from "date-fns";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { DateRangePicker } from "@/components/date-range-picker";
import { LogsTable } from "@/components/logs-table";
import { Pagination } from "@/components/pagination";
import { AdvancedFilters } from "@/components/advanced-filters";
import { ColumnVisibilityToggle } from "@/components/column-visibility-toggle";
import { CallChainModal } from "@/components/call-chain-modal";

import { getCallLogs, exportCallLogsCSV } from "@/services/logs.service";
import { useDebounce } from "@/lib/use-debounce";
import type {
    CallLog,
    CallDirection,
    CallStatus,
    EntityType,
    LogsFilters,
    LogsSort,
    SortField,
    ColumnVisibility,
    CallLogsResponse,
} from "@/types/logs.types";

const PAGE_SIZE = 50;

const defaultFilters: LogsFilters = {
    directions: ["inbound", "outbound", "internal"],
    statuses: [],
    entityTypes: [],
    extensionExact: undefined,
    externalNumber: undefined,
    durationMin: undefined,
    durationMax: undefined,
};

const defaultColumnVisibility: ColumnVisibility = {
    callHistoryId: true,
    trunkDid: false,
    ringDuration: false,
    terminationReason: false,
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

    // State
    const [dateRange, setDateRange] = useState(getInitialDateRange);
    const [filters, setFilters] = useState<LogsFilters>(defaultFilters);
    const [currentPage, setCurrentPage] = useState(getInitialPage);
    const [sort, setSort] = useState<LogsSort | undefined>(undefined);
    const [columnVisibility, setColumnVisibility] = useState<ColumnVisibility>(defaultColumnVisibility);
    const [uniqueCallsMode, setUniqueCallsMode] = useState(false);

    // Data state
    const [data, setData] = useState<CallLogsResponse | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isExporting, setIsExporting] = useState(false);

    // Modal state
    const [selectedCallHistoryId, setSelectedCallHistoryId] = useState<string | null>(null);

    // Debounce searches
    const debouncedExtension = useDebounce(filters.extensionExact, 300);
    const debouncedExternalNumber = useDebounce(filters.externalNumber, 300);

    // Build debounced filters
    const effectiveFilters: LogsFilters = {
        ...filters,
        extensionExact: debouncedExtension,
        externalNumber: debouncedExternalNumber,
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

    // Fetch data - using regular async/await with proper loading state
    const fetchData = useCallback(async () => {
        setIsLoading(true);
        try {
            const result = await getCallLogs(
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
    }, [dateRange.startDate, dateRange.endDate, debouncedExtension, debouncedExternalNumber, filters.directions, filters.statuses, filters.entityTypes, filters.durationMin, filters.durationMax, currentPage, sort]);

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

    const handleFiltersChange = (newFilters: LogsFilters) => {
        setFilters(newFilters);
        setCurrentPage(1);
    };

    const handlePageChange = (page: number) => {
        setCurrentPage(page);
    };

    const handleSort = (field: SortField) => {
        setSort((prev) => {
            if (prev?.field === field) {
                // Toggle direction
                return { field, direction: prev.direction === "asc" ? "desc" : "asc" };
            }
            return { field, direction: "desc" };
        });
    };

    const handleRefresh = () => {
        fetchData();
    };

    const handleExport = async () => {
        setIsExporting(true);
        try {
            const csv = await exportCallLogsCSV(dateRange.startDate, dateRange.endDate, effectiveFilters);
            const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = `logs_${dateRange.startDate.toISOString().split("T")[0]}_${dateRange.endDate.toISOString().split("T")[0]}.csv`;
            link.click();
            URL.revokeObjectURL(url);
        } catch (error) {
            console.error("Export error:", error);
        } finally {
            setIsExporting(false);
        }
    };

    return (
        <div className="space-y-6">
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
                    <ColumnVisibilityToggle
                        visibility={columnVisibility}
                        onChange={setColumnVisibility}
                    />
                    <Button
                        variant="outline"
                        onClick={handleExport}
                        disabled={isExporting || !data?.logs.length}
                    >
                        <Download className={`h-4 w-4 mr-2 ${isExporting ? "animate-pulse" : ""}`} />
                        Exporter CSV
                    </Button>
                </div>
            </div>

            {/* Filters Card */}
            <Card className="border-slate-200 shadow-sm">
                <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                        <CardTitle className="text-base font-medium">Filtres</CardTitle>
                        <div className="flex items-center gap-4">
                            {/* Unique calls toggle */}
                            <div className="flex items-center gap-2">
                                <Switch
                                    id="unique-calls"
                                    checked={uniqueCallsMode}
                                    onCheckedChange={setUniqueCallsMode}
                                />
                                <Label htmlFor="unique-calls" className="text-sm cursor-pointer flex items-center gap-1">
                                    <Layers className="h-4 w-4" />
                                    Appels uniques
                                </Label>
                            </div>
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="space-y-4">
                    {/* Date Range */}
                    <div className="flex flex-wrap items-end gap-4">
                        <div>
                            <Label className="text-sm text-slate-600 mb-1.5 block">Période</Label>
                            <DateRangePicker
                                dateRange={dateRange}
                                onDateRangeChange={handleDateRangeChange}
                            />
                        </div>
                        <Button
                            variant="outline"
                            onClick={handleRefresh}
                            disabled={isLoading}
                        >
                            <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? "animate-spin" : ""}`} />
                            Actualiser
                        </Button>
                    </div>

                    {/* Advanced Filters */}
                    <AdvancedFilters filters={filters} onChange={handleFiltersChange} />
                </CardContent>
            </Card>

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

            {/* Table */}
            <Card className="border-slate-200 shadow-sm overflow-hidden">
                <LogsTable
                    logs={data?.logs || []}
                    isLoading={isLoading}
                    columnVisibility={columnVisibility}
                    sort={sort}
                    onSort={handleSort}
                    onViewChain={setSelectedCallHistoryId}
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
