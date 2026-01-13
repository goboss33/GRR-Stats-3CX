"use client";

import { useState, useEffect, useCallback, useTransition } from "react";
import { RefreshCw, Phone, PhoneOff, Clock, TrendingUp } from "lucide-react";
import { subDays, startOfDay, endOfDay } from "date-fns";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DateRangePicker } from "@/components/date-range-picker";
import { CallsChart } from "@/components/calls-chart";
import { TopExtensionsTable } from "@/components/top-extensions-table";
import { RecentCallsTable } from "@/components/recent-calls-table";

import {
    getGlobalMetrics,
    getTimelineData,
    getTopExtensions,
    getRecentCalls,
} from "@/services/stats.service";

import type {
    GlobalMetrics,
    TimelineDataPoint,
    ExtensionStats,
    RecentCall,
} from "@/types/stats.types";

// Helper to format duration seconds to human readable
function formatDuration(seconds: number): string {
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return `${hours}h ${remainingMinutes}m`;
}

export default function DashboardClient() {
    const [isPending, startTransition] = useTransition();
    const [isInitialLoad, setIsInitialLoad] = useState(true);

    // Date range state
    const [dateRange, setDateRange] = useState({
        startDate: startOfDay(subDays(new Date(), 7)),
        endDate: endOfDay(new Date()),
    });

    // Data state
    const [metrics, setMetrics] = useState<GlobalMetrics | null>(null);
    const [timelineData, setTimelineData] = useState<TimelineDataPoint[]>([]);
    const [topExtensions, setTopExtensions] = useState<ExtensionStats[]>([]);
    const [recentCalls, setRecentCalls] = useState<RecentCall[]>([]);

    // Fetch all data
    const fetchData = useCallback(async () => {
        startTransition(async () => {
            try {
                const [metricsData, timeline, extensions, calls] = await Promise.all([
                    getGlobalMetrics(dateRange.startDate, dateRange.endDate),
                    getTimelineData(dateRange.startDate, dateRange.endDate),
                    getTopExtensions(dateRange.startDate, dateRange.endDate, 10),
                    getRecentCalls(50),
                ]);

                setMetrics(metricsData);
                setTimelineData(timeline);
                setTopExtensions(extensions);
                setRecentCalls(calls);
                setIsInitialLoad(false);
            } catch (error) {
                console.error("Error fetching dashboard data:", error);
                setIsInitialLoad(false);
            }
        });
    }, [dateRange]);

    // Initial load and date range change
    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const handleRefresh = () => {
        fetchData();
    };

    const handleDateRangeChange = (range: { startDate: Date; endDate: Date }) => {
        setDateRange(range);
    };

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-slate-900">
                        Global Call Monitor
                    </h1>
                    <p className="text-slate-500">
                        Activité des appels en temps réel
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    <DateRangePicker
                        dateRange={dateRange}
                        onDateRangeChange={handleDateRangeChange}
                    />
                    <Button
                        variant="outline"
                        size="icon"
                        onClick={handleRefresh}
                        disabled={isPending}
                        className="bg-white"
                    >
                        <RefreshCw className={`h-4 w-4 ${isPending ? "animate-spin" : ""}`} />
                    </Button>
                </div>
            </div>

            {/* KPI Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* Total Calls */}
                <Card className="border-slate-200 shadow-sm">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-medium text-slate-600">
                            Total Appels
                        </CardTitle>
                        <Phone className="h-5 w-5 text-blue-500" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-bold text-slate-900">
                            {isInitialLoad ? (
                                <span className="animate-pulse">...</span>
                            ) : (
                                metrics?.totalCalls.toLocaleString() || 0
                            )}
                        </div>
                        <p className="text-xs text-slate-500 mt-1">Sur la période</p>
                    </CardContent>
                </Card>

                {/* Answered Calls */}
                <Card className="border-slate-200 shadow-sm">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-medium text-slate-600">
                            Appels Répondus
                        </CardTitle>
                        <TrendingUp className="h-5 w-5 text-emerald-500" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-bold text-emerald-600">
                            {isInitialLoad ? (
                                <span className="animate-pulse">...</span>
                            ) : (
                                metrics?.answeredCalls.toLocaleString() || 0
                            )}
                        </div>
                        <p className="text-xs text-slate-500 mt-1">
                            {metrics ? `${metrics.answerRate}% taux de réponse` : ""}
                        </p>
                    </CardContent>
                </Card>

                {/* Missed Calls */}
                <Card className="border-slate-200 shadow-sm">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-medium text-slate-600">
                            Appels Manqués
                        </CardTitle>
                        <PhoneOff className="h-5 w-5 text-rose-500" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-bold text-rose-600">
                            {isInitialLoad ? (
                                <span className="animate-pulse">...</span>
                            ) : (
                                metrics?.missedCalls.toLocaleString() || 0
                            )}
                        </div>
                        <p className="text-xs text-slate-500 mt-1">À traiter</p>
                    </CardContent>
                </Card>

                {/* Average Duration */}
                <Card className="border-slate-200 shadow-sm">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-medium text-slate-600">
                            Durée Moyenne
                        </CardTitle>
                        <Clock className="h-5 w-5 text-amber-500" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-bold text-slate-900">
                            {isInitialLoad ? (
                                <span className="animate-pulse">...</span>
                            ) : (
                                formatDuration(metrics?.avgDurationSeconds || 0)
                            )}
                        </div>
                        <p className="text-xs text-slate-500 mt-1">Par appel répondu</p>
                    </CardContent>
                </Card>
            </div>

            {/* Chart */}
            <Card className="border-slate-200 shadow-sm">
                <CardHeader>
                    <CardTitle className="text-lg font-semibold text-slate-900">
                        Volume d&apos;appels
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    {isPending && !isInitialLoad ? (
                        <div className="h-[300px] flex items-center justify-center">
                            <RefreshCw className="h-8 w-8 animate-spin text-slate-400" />
                        </div>
                    ) : (
                        <CallsChart data={timelineData} />
                    )}
                </CardContent>
            </Card>

            {/* Bottom Grid: Extensions & Recent Calls */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Top Extensions */}
                <Card className="border-slate-200 shadow-sm">
                    <CardHeader>
                        <CardTitle className="text-lg font-semibold text-slate-900">
                            Top Extensions
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        {isPending && !isInitialLoad ? (
                            <div className="h-[300px] flex items-center justify-center">
                                <RefreshCw className="h-6 w-6 animate-spin text-slate-400" />
                            </div>
                        ) : (
                            <TopExtensionsTable data={topExtensions} />
                        )}
                    </CardContent>
                </Card>

                {/* Recent Calls */}
                <Card className="border-slate-200 shadow-sm">
                    <CardHeader>
                        <CardTitle className="text-lg font-semibold text-slate-900">
                            Appels Récents
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        {isPending && !isInitialLoad ? (
                            <div className="h-[300px] flex items-center justify-center">
                                <RefreshCw className="h-6 w-6 animate-spin text-slate-400" />
                            </div>
                        ) : (
                            <RecentCallsTable data={recentCalls} />
                        )}
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
