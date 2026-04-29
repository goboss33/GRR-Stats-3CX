"use client";

import { useState, useEffect, useCallback } from "react";
import { RefreshCw, Phone, PhoneOff, Clock, TrendingUp, Users2, Hourglass, Voicemail, PhoneCall, Download } from "lucide-react";
import { subDays, startOfDay, endOfDay, format } from "date-fns";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { DateRangePicker } from "@/components/date-range-picker";
import { CallsChart } from "@/components/calls-chart";
import { HeatmapChart } from "@/components/heatmap-chart";

import Link from "next/link";
import {
    getGlobalMetrics,
    getTimelineData,
    getHeatmapData,
} from "@/services/dashboard.service";

import type {
    GlobalMetrics,
    TimelineDataPoint,
    HeatmapDataPoint,
} from "@/types/stats.types";

// Helper to format duration seconds to human readable
function formatDuration(seconds: number): string {
    if (seconds === 0) return "0s";
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return `${hours}h ${remainingMinutes}m`;
}

// Animation du chiffre progressif (CountUp simple)
function AnimatedNumber({ value }: { value: number }) {
    const [display, setDisplay] = useState(0);
    
    useEffect(() => {
        let startTime: number;
        const duration = 1000; // 1s
        
        const animate = (timestamp: number) => {
            if (!startTime) startTime = timestamp;
            const progress = Math.min((timestamp - startTime) / duration, 1);
            const easeProgress = progress * (2 - progress); // easeOutQuad
            setDisplay(Math.floor(value * easeProgress));
            
            if (progress < 1) requestAnimationFrame(animate);
            else setDisplay(value);
        };
        requestAnimationFrame(animate);
    }, [value]);
    
    return <span>{display.toLocaleString()}</span>;
}

// Helper to download CSV of call IDs for a given status
function downloadCallIdsCsv(startDate: Date, endDate: Date, status: string) {
    const start = format(startDate, 'yyyy-MM-dd');
    const end = format(endDate, 'yyyy-MM-dd');
    const url = `/api/export-call-ids?start=${start}&end=${end}&status=${status}`;
    window.open(url, '_blank');
}

// Composant pour afficher l'évolution N-1 avec une petite flèche de couleur
function TrendIndicator({ current, prev, inverseGood = false }: { current: number; prev: number; inverseGood?: boolean }) {
    if (!prev || prev === 0) return null;
    const diff = current - prev;
    if (diff === 0) return <span className="ml-2 text-xs font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">=</span>;
    
    const isUp = diff > 0;
    const isGood = inverseGood ? !isUp : isUp;
    const percent = Math.abs((diff / prev) * 100).toFixed(1);
    
    return (
        <span className={`ml-2 text-xs font-bold px-2 py-0.5 rounded-full ${isGood ? 'bg-emerald-100/80 text-emerald-700' : 'bg-rose-100/80 text-rose-700'}`}>
            {isUp ? '↑' : '↓'} {percent}%
        </span>
    );
}

export default function DashboardClient() {
    const [isLoading, setIsLoading] = useState(true);
    const [isInitialLoad, setIsInitialLoad] = useState(true);

    const [dateRange, setDateRange] = useState({
        startDate: startOfDay(subDays(new Date(), 7)),
        endDate: endOfDay(new Date()),
    });

    const [metrics, setMetrics] = useState<GlobalMetrics | null>(null);
    const [timelineData, setTimelineData] = useState<TimelineDataPoint[]>([]);
    const [heatmapData, setHeatmapData] = useState<HeatmapDataPoint[]>([]);

    const fetchData = useCallback(async () => {
        setIsLoading(true);
        try {
            const [metricsData, timeline, heatmap] = await Promise.all([
                getGlobalMetrics(dateRange.startDate, dateRange.endDate),
                getTimelineData(dateRange.startDate, dateRange.endDate),
                getHeatmapData(dateRange.startDate, dateRange.endDate),
            ]);

            setMetrics(metricsData);
            setTimelineData(timeline);
            setHeatmapData(heatmap);
            setIsInitialLoad(false);
        } catch (error) {
            console.error("Error fetching dashboard data:", error);
            setIsInitialLoad(false);
        } finally {
            setIsLoading(false);
        }
    }, [dateRange]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const handleRefresh = () => fetchData();
    const handleDateRangeChange = (range: { startDate: Date; endDate: Date }) => setDateRange(range);

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">
                        Tableau de bord
                    </h1>
                    <p className="text-slate-500 mt-1">
                        Vue d'ensemble et performances de l'entreprise
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
                        disabled={isLoading}
                        className="bg-white shadow-sm hover:bg-slate-50 transition-colors"
                    >
                        <RefreshCw className={`h-4 w-4 text-slate-600 ${isLoading ? "animate-spin" : ""}`} />
                    </Button>
                </div>
            </div>

            {/* KPI Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-7 gap-4">
                {/* Total Calls */}
                <Card className="border-slate-200/60 shadow-sm hover:shadow-md transition-shadow bg-gradient-to-br from-white to-slate-50/50">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-semibold text-slate-600">Appels Uniques</CardTitle>
                        <Phone className="h-5 w-5 text-blue-500 opacity-80" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-bold text-slate-900 flex items-center">
                            {isInitialLoad ? <Skeleton className="h-8 w-16" /> : (
                                <>
                                    <Link
                                        href={`/admin/logs?start=${format(dateRange.startDate, 'yyyy-MM-dd')}&end=${format(dateRange.endDate, 'yyyy-MM-dd')}`}
                                        className="hover:underline cursor-pointer"
                                    >
                                        <AnimatedNumber value={metrics?.totalCalls || 0} />
                                    </Link>
                                    <TrendIndicator current={metrics?.totalCalls || 0} prev={metrics?.prevTotalCalls || 0} />
                                </>
                            )}
                        </div>
                        <p className="text-xs text-slate-500 mt-1.5 font-medium">Volume de la période</p>
                    </CardContent>
                </Card>

                {/* Answered */}
                <Card className="border-slate-200/60 shadow-sm hover:shadow-md transition-shadow bg-gradient-to-br from-white to-emerald-50/10">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-semibold text-slate-600">Répondus</CardTitle>
                        <div className="flex items-center gap-1">
                            <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 w-6 p-0 text-slate-400 hover:text-emerald-600"
                                title="Exporter CSV"
                                onClick={() => downloadCallIdsCsv(dateRange.startDate, dateRange.endDate, 'answered')}
                            >
                                <Download className="h-3.5 w-3.5" />
                            </Button>
                            <TrendingUp className="h-5 w-5 text-emerald-500 opacity-80" />
                        </div>
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-bold text-emerald-600 flex items-center">
                            {isInitialLoad ? <Skeleton className="h-8 w-16" /> : (
                                <>
                                    <Link
                                        href={`/admin/logs?start=${format(dateRange.startDate, 'yyyy-MM-dd')}&end=${format(dateRange.endDate, 'yyyy-MM-dd')}&statuses=answered`}
                                        className="hover:underline cursor-pointer"
                                    >
                                        <AnimatedNumber value={metrics?.answeredCalls || 0} />
                                    </Link>
                                    <TrendIndicator current={metrics?.answeredCalls || 0} prev={metrics?.prevAnsweredCalls || 0} />
                                </>
                            )}
                        </div>
                        <div className="flex items-center gap-1 mt-1.5 text-xs">
                            {isInitialLoad
                                ? <Skeleton className="h-4 w-20" />
                                : <><span className="font-semibold text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded">{metrics?.answerRate}%</span><span className="text-slate-500 font-medium">taux global</span></>
                            }
                        </div>
                    </CardContent>
                </Card>

                {/* Missed */}
                <Card className="border-slate-200/60 shadow-sm hover:shadow-md transition-shadow bg-gradient-to-br from-white to-rose-50/10">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-semibold text-slate-600">Manqués</CardTitle>
                        <div className="flex items-center gap-1">
                            <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 w-6 p-0 text-slate-400 hover:text-rose-600"
                                title="Exporter CSV"
                                onClick={() => downloadCallIdsCsv(dateRange.startDate, dateRange.endDate, 'missed')}
                            >
                                <Download className="h-3.5 w-3.5" />
                            </Button>
                            <PhoneOff className="h-5 w-5 text-rose-500 opacity-80" />
                        </div>
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-bold text-rose-600 flex items-center">
                            {isInitialLoad ? <Skeleton className="h-8 w-16" /> : (
                                <>
                                    <Link
                                        href={`/admin/logs?start=${format(dateRange.startDate, 'yyyy-MM-dd')}&end=${format(dateRange.endDate, 'yyyy-MM-dd')}&statuses=missed`}
                                        className="hover:underline cursor-pointer"
                                    >
                                        <AnimatedNumber value={metrics?.missedCalls || 0} />
                                    </Link>
                                    <TrendIndicator current={metrics?.missedCalls || 0} prev={metrics?.prevMissedCalls || 0} inverseGood={true} />
                                </>
                            )}
                        </div>
                        <p className="text-xs text-slate-500 mt-1.5 font-medium">Appels non aboutis</p>
                    </CardContent>
                </Card>

                {/* Voicemail */}
                <Card className="border-slate-200/60 shadow-sm hover:shadow-md transition-shadow bg-gradient-to-br from-white to-purple-50/10">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-semibold text-slate-600">Messagerie</CardTitle>
                        <div className="flex items-center gap-1">
                            <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 w-6 p-0 text-slate-400 hover:text-purple-600"
                                title="Exporter CSV"
                                onClick={() => downloadCallIdsCsv(dateRange.startDate, dateRange.endDate, 'voicemail')}
                            >
                                <Download className="h-3.5 w-3.5" />
                            </Button>
                            <Voicemail className="h-5 w-5 text-purple-500 opacity-80" />
                        </div>
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-bold text-purple-600 flex items-center">
                            {isInitialLoad ? <Skeleton className="h-8 w-16" /> : (
                                <>
                                    <Link
                                        href={`/admin/logs?start=${format(dateRange.startDate, 'yyyy-MM-dd')}&end=${format(dateRange.endDate, 'yyyy-MM-dd')}&statuses=voicemail`}
                                        className="hover:underline cursor-pointer"
                                    >
                                        <AnimatedNumber value={metrics?.voicemailCalls || 0} />
                                    </Link>
                                    <TrendIndicator current={metrics?.voicemailCalls || 0} prev={metrics?.prevVoicemailCalls || 0} inverseGood={true} />
                                </>
                            )}
                        </div>
                        <p className="text-xs text-slate-500 mt-1.5 font-medium">Vers messagerie vocale</p>
                    </CardContent>
                </Card>

                {/* Busy */}
                <Card className="border-slate-200/60 shadow-sm hover:shadow-md transition-shadow bg-gradient-to-br from-white to-orange-50/10">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-semibold text-slate-600">Occupé</CardTitle>
                        <div className="flex items-center gap-1">
                            <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 w-6 p-0 text-slate-400 hover:text-orange-600"
                                title="Exporter CSV"
                                onClick={() => downloadCallIdsCsv(dateRange.startDate, dateRange.endDate, 'busy')}
                            >
                                <Download className="h-3.5 w-3.5" />
                            </Button>
                            <PhoneCall className="h-5 w-5 text-orange-500 opacity-80" />
                        </div>
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-bold text-orange-600 flex items-center">
                            {isInitialLoad ? <Skeleton className="h-8 w-16" /> : (
                                <>
                                    <Link
                                        href={`/admin/logs?start=${format(dateRange.startDate, 'yyyy-MM-dd')}&end=${format(dateRange.endDate, 'yyyy-MM-dd')}&statuses=busy`}
                                        className="hover:underline cursor-pointer"
                                    >
                                        <AnimatedNumber value={metrics?.busyCalls || 0} />
                                    </Link>
                                    <TrendIndicator current={metrics?.busyCalls || 0} prev={metrics?.prevBusyCalls || 0} inverseGood={true} />
                                </>
                            )}
                        </div>
                        <p className="text-xs text-slate-500 mt-1.5 font-medium">Ligne occupée</p>
                    </CardContent>
                </Card>

                {/* Talk Time */}
                <Card className="border-slate-200/60 shadow-sm hover:shadow-md transition-shadow bg-gradient-to-br from-white to-indigo-50/10">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-semibold text-slate-600">Discussion</CardTitle>
                        <Clock className="h-5 w-5 text-indigo-500 opacity-80" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl lg:text-3xl font-bold text-slate-900 flex items-center">
                            {isInitialLoad ? <Skeleton className="h-8 w-20" /> : (
                                <>
                                    {formatDuration(metrics?.avgDurationSeconds || 0)}
                                    <TrendIndicator current={metrics?.avgDurationSeconds || 0} prev={metrics?.prevAvgDurationSeconds || 0} />
                                </>
                            )}
                        </div>
                        <p className="text-xs text-slate-500 mt-1.5 font-medium">Temps humain par appel</p>
                    </CardContent>
                </Card>

                {/* Wait Time */}
                <Card className="border-slate-200/60 shadow-sm hover:shadow-md transition-shadow bg-gradient-to-br from-white to-amber-50/10">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-semibold text-slate-600">Attente moy.</CardTitle>
                        <Hourglass className="h-5 w-5 text-amber-500 opacity-80" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl lg:text-3xl font-bold text-slate-900 flex items-center">
                            {isInitialLoad ? <Skeleton className="h-8 w-20" /> : (
                                <>
                                    {formatDuration(metrics?.avgWaitTimeSeconds || 0)}
                                    <TrendIndicator current={metrics?.avgWaitTimeSeconds || 0} prev={metrics?.prevAvgWaitTimeSeconds || 0} inverseGood={true} />
                                </>
                            )}
                        </div>
                        <p className="text-[11px] text-slate-500 mt-1.5 font-medium leading-tight">Avant et/ou entre transferts</p>
                    </CardContent>
                </Card>


            </div>

            <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
                {/* Chart main */}
                <Card className="border-none shadow-md xl:col-span-2 bg-gradient-to-b from-white to-slate-50/50">
                    <CardHeader>
                        <CardTitle className="text-lg font-bold text-slate-900">Évolution du Volume</CardTitle>
                    </CardHeader>
                    <CardContent>
                        {isLoading && !isInitialLoad ? (
                            <div className="h-[425px] space-y-3 pt-4">
                                <div className="flex gap-2 items-end h-[380px]">
                                    {Array.from({ length: 14 }).map((_, i) => (
                                        <Skeleton
                                            key={i}
                                            className="flex-1 rounded-sm"
                                            style={{ height: `${25 + Math.random() * 75}%` }}
                                        />
                                    ))}
                                </div>
                            </div>
                        ) : (
                            <CallsChart data={timelineData} />
                        )}
                    </CardContent>
                </Card>

                {/* Heatmap */}
                <Card className="border-none shadow-md bg-gradient-to-b from-white to-slate-50/50">
                    <CardHeader>
                        <CardTitle className="text-lg font-bold text-slate-900">Carte des Affluences</CardTitle>
                    </CardHeader>
                    <CardContent className="px-4">
                        {isLoading && !isInitialLoad ? (
                            <div className="h-[425px] grid grid-cols-7 gap-1 pt-4">
                                {Array.from({ length: 7 * 11 }).map((_, i) => (
                                    <Skeleton key={i} className="rounded-sm" style={{ opacity: 0.3 + Math.random() * 0.7 }} />
                                ))}
                            </div>
                        ) : (
                            <HeatmapChart data={heatmapData} />
                        )}
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
