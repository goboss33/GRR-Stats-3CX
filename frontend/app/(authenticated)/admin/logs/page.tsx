"use client";

import { useState, useEffect, useTransition, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { RefreshCw, Search, FileText } from "lucide-react";
import { subDays, startOfDay, endOfDay, parseISO } from "date-fns";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { DateRangePicker } from "@/components/date-range-picker";
import { LogsTable } from "@/components/logs-table";
import { Pagination } from "@/components/pagination";

import { getCallLogs } from "@/services/logs.service";
import { useDebounce } from "@/lib/use-debounce";
import type { CallLog, CallDirection, CallLogsResponse } from "@/types/logs.types";

const PAGE_SIZE = 50;

export default function AdminLogsPage() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const [isPending, startTransition] = useTransition();

    // Parse URL params
    const getInitialDateRange = () => {
        const startParam = searchParams.get("start");
        const endParam = searchParams.get("end");
        return {
            startDate: startParam ? parseISO(startParam) : startOfDay(subDays(new Date(), 7)),
            endDate: endParam ? parseISO(endParam) : endOfDay(new Date()),
        };
    };

    const getInitialDirections = (): CallDirection[] => {
        const dirParam = searchParams.get("dir");
        if (!dirParam) return ["inbound", "outbound", "internal"];
        return dirParam.split(",") as CallDirection[];
    };

    const getInitialPage = () => {
        const pageParam = searchParams.get("page");
        return pageParam ? parseInt(pageParam, 10) : 1;
    };

    // State
    const [dateRange, setDateRange] = useState(getInitialDateRange);
    const [directions, setDirections] = useState<CallDirection[]>(getInitialDirections);
    const [extensionSearch, setExtensionSearch] = useState(searchParams.get("ext") || "");
    const [currentPage, setCurrentPage] = useState(getInitialPage);

    // Data state
    const [data, setData] = useState<CallLogsResponse | null>(null);
    const [isInitialLoad, setIsInitialLoad] = useState(true);

    // Debounce extension search
    const debouncedExtension = useDebounce(extensionSearch, 300);

    // Update URL when filters change
    const updateUrl = useCallback(
        (
            range: { startDate: Date; endDate: Date },
            dirs: CallDirection[],
            ext: string,
            page: number
        ) => {
            const params = new URLSearchParams();
            params.set("start", range.startDate.toISOString().split("T")[0]);
            params.set("end", range.endDate.toISOString().split("T")[0]);
            if (dirs.length > 0 && dirs.length < 3) {
                params.set("dir", dirs.join(","));
            }
            if (ext) {
                params.set("ext", ext);
            }
            if (page > 1) {
                params.set("page", page.toString());
            }
            router.replace(`/admin/logs?${params.toString()}`, { scroll: false });
        },
        [router]
    );

    // Fetch data
    const fetchData = useCallback(async () => {
        startTransition(async () => {
            try {
                const result = await getCallLogs(
                    dateRange.startDate,
                    dateRange.endDate,
                    {
                        directions,
                        extension: debouncedExtension || undefined,
                    },
                    {
                        page: currentPage,
                        pageSize: PAGE_SIZE,
                    }
                );
                setData(result);
                setIsInitialLoad(false);
            } catch (error) {
                console.error("Error fetching logs:", error);
                setIsInitialLoad(false);
            }
        });
    }, [dateRange, directions, debouncedExtension, currentPage]);

    // Fetch on filter/page change
    useEffect(() => {
        fetchData();
        updateUrl(dateRange, directions, debouncedExtension, currentPage);
    }, [fetchData, updateUrl, dateRange, directions, debouncedExtension, currentPage]);

    // Handlers
    const handleDateRangeChange = (range: { startDate: Date; endDate: Date }) => {
        setDateRange(range);
        setCurrentPage(1); // Reset to page 1
    };

    const handleDirectionChange = (direction: CallDirection, checked: boolean) => {
        const newDirs = checked
            ? [...directions, direction]
            : directions.filter((d) => d !== direction);
        setDirections(newDirs);
        setCurrentPage(1);
    };

    const handlePageChange = (page: number) => {
        setCurrentPage(page);
    };

    const handleRefresh = () => {
        fetchData();
    };

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center gap-3">
                <FileText className="h-8 w-8 text-slate-700" />
                <div>
                    <h1 className="text-2xl font-bold text-slate-900">Logs d&apos;appels</h1>
                    <p className="text-slate-500">Exploration et audit des CDR</p>
                </div>
            </div>

            {/* Filters */}
            <Card className="border-slate-200 shadow-sm">
                <CardHeader className="pb-3">
                    <CardTitle className="text-base font-medium">Filtres</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="flex flex-wrap items-end gap-4">
                        {/* Date Range */}
                        <div>
                            <Label className="text-sm text-slate-600 mb-1.5 block">Période</Label>
                            <DateRangePicker
                                dateRange={dateRange}
                                onDateRangeChange={handleDateRangeChange}
                            />
                        </div>

                        {/* Direction Filters */}
                        <div>
                            <Label className="text-sm text-slate-600 mb-2 block">Direction</Label>
                            <div className="flex items-center gap-4">
                                <div className="flex items-center gap-2">
                                    <Checkbox
                                        id="dir-inbound"
                                        checked={directions.includes("inbound")}
                                        onCheckedChange={(checked) =>
                                            handleDirectionChange("inbound", checked as boolean)
                                        }
                                    />
                                    <Label htmlFor="dir-inbound" className="text-sm cursor-pointer">
                                        Entrant
                                    </Label>
                                </div>
                                <div className="flex items-center gap-2">
                                    <Checkbox
                                        id="dir-outbound"
                                        checked={directions.includes("outbound")}
                                        onCheckedChange={(checked) =>
                                            handleDirectionChange("outbound", checked as boolean)
                                        }
                                    />
                                    <Label htmlFor="dir-outbound" className="text-sm cursor-pointer">
                                        Sortant
                                    </Label>
                                </div>
                                <div className="flex items-center gap-2">
                                    <Checkbox
                                        id="dir-internal"
                                        checked={directions.includes("internal")}
                                        onCheckedChange={(checked) =>
                                            handleDirectionChange("internal", checked as boolean)
                                        }
                                    />
                                    <Label htmlFor="dir-internal" className="text-sm cursor-pointer">
                                        Interne
                                    </Label>
                                </div>
                            </div>
                        </div>

                        {/* Extension Search */}
                        <div className="flex-1 min-w-[200px]">
                            <Label className="text-sm text-slate-600 mb-1.5 block">
                                Rechercher extension
                            </Label>
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                                <Input
                                    placeholder="Ex: 101"
                                    value={extensionSearch}
                                    onChange={(e) => {
                                        setExtensionSearch(e.target.value);
                                        setCurrentPage(1);
                                    }}
                                    className="pl-9"
                                />
                            </div>
                        </div>

                        {/* Refresh */}
                        <Button
                            variant="outline"
                            onClick={handleRefresh}
                            disabled={isPending}
                        >
                            <RefreshCw className={`h-4 w-4 mr-2 ${isPending ? "animate-spin" : ""}`} />
                            Actualiser
                        </Button>
                    </div>
                </CardContent>
            </Card>

            {/* Results Info */}
            {data && (
                <div className="flex items-center justify-between text-sm text-slate-600">
                    <span>
                        <span className="font-medium">{data.totalCount.toLocaleString()}</span> appels trouvés
                    </span>
                    <span>
                        Affichage de {((currentPage - 1) * PAGE_SIZE) + 1} à{" "}
                        {Math.min(currentPage * PAGE_SIZE, data.totalCount)} sur {data.totalCount}
                    </span>
                </div>
            )}

            {/* Table */}
            <Card className="border-slate-200 shadow-sm overflow-hidden">
                <LogsTable logs={data?.logs || []} isLoading={isInitialLoad || isPending} />
                {data && data.totalPages > 1 && (
                    <Pagination
                        currentPage={data.currentPage}
                        totalPages={data.totalPages}
                        onPageChange={handlePageChange}
                    />
                )}
            </Card>
        </div>
    );
}
