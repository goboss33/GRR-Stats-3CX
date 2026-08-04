"use client";

import { getSelectedServer } from "@/lib/selected-server";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { RefreshCw, Download, FileText, Columns3, Code } from "lucide-react";
import { format } from "date-fns";
import { useUrlPeriod, useUrlOrigin, applyPeriodToParams } from "@/lib/url-state";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tip } from "@/components/ui/tooltip";
import { LogsTable } from "@/components/logs-table";
import { Pagination } from "@/components/pagination";
import { CallChainModal } from "@/components/call-chain-modal";
import { SqlQueryModal } from "@/components/sql-query-modal";
import { ActiveFilters } from "@/components/active-filters";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { QueueSelector } from "@/components/stats/queue-selector";
import { NoPerimeterNotice } from "@/components/no-perimeter-notice";
import { Label } from "@/components/ui/label";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { getAggregatedCallLogs, exportCallLogsCSV, getCallLogsSQL } from "@/services/logs.service";
import { getScopedQueueOptions } from "@/services/queues.service";
import { useDebounce } from "@/lib/use-debounce";
import { ServerId } from "@/lib/prisma-cdr";
import type { QueueInfo } from "@/types/queues.types";
import type {
    AggregatedCallLog,
    CallSens,
    CallStatus,
    LogsFilters,
    LogsSort,
    SortField,
    ColumnVisibility,
    AggregatedCallLogsResponse,
    JourneyFilter,
    TimeSlot,
} from "@/types/logs.types";
import { outcomesForBucket, type KpiBucket, type PassageOutcome } from "@/services/domain/call-classification";
import { finalStatusesForBucket, DEFAULT_FINAL_GROUPING } from "@/services/domain/call-aggregation";
import type { QueueOrigin } from "@/components/column-filters/ColumnFilterQueueOrigin";

const PAGE_SIZE = 50;


const defaultColumnVisibility: ColumnVisibility = {
    callHistoryId: false,
    segmentCount: false,
    dateTime: true,
    timeSlot: true,
    caller: true,
    callee: true,
    handledBy: false,
    queues: false,
    journey: true,
    // Provenance = le mot du toggle du header ; Sens = Entrant/Sortant/Intra.
    // Les deux visibles par défaut : c'est la matérialisation du modèle à
    // deux axes (le pont n'est qu'une pastille sur la provenance).
    provenance: true,
    sens: true,
    status: true,
    duration: false,
    waitTime: false,
};

export default function AdminLogsPage() {
    const router = useRouter();
    const searchParams = useSearchParams();

    // Parse URL params for filters
    const getInitialPage = () => {
        const pageParam = searchParams.get("page");
        return pageParam ? parseInt(pageParam, 10) : 1;
    };

    const getInitialSens = (): CallSens[] => {
        const param = searchParams.get("sens");
        if (!param) return [];
        return param.split(",").filter(d => ["inbound", "outbound", "intra"].includes(d)) as CallSens[];
    };

    const getInitialStatuses = (): CallStatus[] => {
        const param = searchParams.get("statuses");
        if (!param) return [];
        const bruts = param.split(",").filter(s => ["answered", "voicemail", "missed", "busy"].includes(s)) as CallStatus[];
        // L'écran ne connaît que deux statuts, Répondu et Perdu, alors que
        // « Perdu » en recouvre trois. Une URL ne portant qu'un statut fin est
        // donc complétée : sans cela le filtre affichait « 1 sél. » sans qu'aucune
        // case ne soit cochée, et restreignait plus que ce qu'il montrait.
        const complet = new Set<CallStatus>();
        for (const statut of bruts) {
            for (const s of finalStatusesForBucket(DEFAULT_FINAL_GROUPING[statut])) complet.add(s);
        }
        return [...complet];
    };

    const getInitialNumberParam = (key: string): number | undefined => {
        const param = searchParams.get(key);
        if (!param) return undefined;
        const num = parseInt(param, 10);
        return isNaN(num) ? undefined : num;
    };

    // Date range state
    // La période vient de l'URL (cf. lib/url-state) : un lien de vignette la
    // porte donc naturellement, sans mécanisme d'adoption.
    const { startDate: periodStart, endDate: periodEnd, setPeriod: setDateRange } = useUrlPeriod();
    // Mémoïsé : cet objet est transmis à des composants enfants, et une
    // identité neuve à chaque rendu les ferait travailler pour rien.
    const dateRange = useMemo(
        () => ({ startDate: periodStart, endDate: periodEnd }),
        [periodStart, periodEnd],
    );
    const [currentPage, setCurrentPage] = useState(getInitialPage);
    const [sort, setSort] = useState<LogsSort | undefined>(undefined);
    const [columnVisibility, setColumnVisibility] = useState<ColumnVisibility>(defaultColumnVisibility);

    // Filter states - initialized from URL
    const [selectedSens, setSelectedSens] = useState<CallSens[]>(getInitialSens);
    const [selectedStatuses, setSelectedStatuses] = useState<CallStatus[]>(getInitialStatuses);
    const [callerSearch, setCallerSearch] = useState(searchParams.get("caller") || "");
    const [calleeSearch, setCalleeSearch] = useState(searchParams.get("callee") || "");
    const [handledBySearch, setHandledBySearch] = useState(searchParams.get("handledBy") || "");
    const [selectedQueueNumber, setSelectedQueueNumber] = useState<string | null>(searchParams.get("queue") || null);
    // La vue file se reflète dans l'URL : le champ de recherche du header
    // affiche la file consultée, et les liens vers les stats la transportent.
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        if ((params.get("queue") ?? null) === (selectedQueueNumber ?? null)) return;
        if (selectedQueueNumber) params.set("queue", selectedQueueNumber);
        else params.delete("queue");
        router.replace(`${window.location.pathname}?${params.toString()}`, { scroll: false });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedQueueNumber]);
    const [idSearch, setIdSearch] = useState(searchParams.get("id") || "");
    const [segmentCountMin, setSegmentCountMin] = useState<number | undefined>(() => getInitialNumberParam("segMin"));
    const [segmentCountMax, setSegmentCountMax] = useState<number | undefined>(() => getInitialNumberParam("segMax"));
    const [durationMin, setDurationMin] = useState<number | undefined>(() => getInitialNumberParam("durMin"));
    const [durationMax, setDurationMax] = useState<number | undefined>(() => getInitialNumberParam("durMax"));
    const [waitTimeMin, setWaitTimeMin] = useState<number | undefined>(() => getInitialNumberParam("waitMin"));
    const [waitTimeMax, setWaitTimeMax] = useState<number | undefined>(() => getInitialNumberParam("waitMax"));
    const [timeSlots, setTimeSlots] = useState<TimeSlot[]>(() => {
        const param = searchParams.get("timeSlots");
        if (!param) return [];
        return param.split(",").map(s => {
            const [start, end] = s.split("-");
            return { start, end };
        }).filter(s => s.start && s.end);
    });
    // Journey filter (groups with AND/OR operators)
    const [journeyFilter, setJourneyFilter] = useState<JourneyFilter | null>(() => {
        const param = searchParams.get("journeyFilter");
        if (!param) return null;
        try {
            return JSON.parse(decodeURIComponent(param));
        } catch {
            return null;
        }
    });

    // Filtre « statut dans une file », posé par les liens des KPIs sous la forme
    // `queueOutcome=900:answered` (plusieurs statuts séparés par une virgule).
    // Il s'appuie sur le même socle de classement que les KPIs, ce qui garantit
    // que le nombre de lignes listées est exactement le chiffre affiché.
    const [queueOutcomeFilter, setQueueOutcomeFilter] = useState<{ queueNumber: string; outcomes: PassageOutcome[]; includeTeamDirect?: boolean } | null>(() => {
        const param = searchParams.get("queueOutcome");
        if (!param) return null;
        const [queueNumber, outcomes, team] = param.split(":");
        if (!queueNumber || !outcomes) return null;
        const parsed = outcomes.split(",").filter((o): o is PassageOutcome =>
            ["answered", "handed_off", "overflow", "voicemail", "short_abandon", "abandoned"].includes(o),
        );
        return parsed.length > 0 ? { queueNumber, outcomes: parsed, includeTeamDirect: team === "team" } : null;
    });

    // Vue file : soit posee par un lien de KPI, soit choisie ici. Elle n'agit
    // pas comme un filtre — elle ajoute au tableau le statut de chaque appel
    // dans la file consultee, a cote de son statut final.
    const [queueView, setQueueView] = useState<string | null>(
        () => searchParams.get("queueView") || searchParams.get("queueOutcome")?.split(":")[0] || null,
    );
    const [canViewCompanyWide, setCanViewCompanyWide] = useState(true);
    const [noPerimeter, setNoPerimeter] = useState(false);
    const [queueOrigin, setQueueOrigin] = useState<QueueOrigin | null>(() => {
        const param = searchParams.get("queueOrigin");
        return param === "queue" || param === "direct" ? param : null;
    });
    // Provenance : le CONTEXTE GLOBAL (toggle du header, paramètre d'URL
    // partagé avec le tableau de bord et les statistiques). Une seule vérité :
    // le header et cette liste ne peuvent pas se contredire. « Les deux »
    // équivaut à « pas de filtre ».
    const { origin: urlOrigin, setOrigin: setUrlOrigin } = useUrlOrigin();
    const callOrigin: "internal" | "external" | null = urlOrigin === "both" ? null : urlOrigin;
    // L'écran raisonne en vignettes (Répondu / Perdu / Redirigé) ; le socle, en
    // statuts fins. DEFAULT_OUTCOME_GROUPING fait le pont, et c'est la même
    // table que celle utilisée par les statistiques.
    const [queueBuckets, setQueueBuckets] = useState<Array<Exclude<KpiBucket, "received">>>(() => {
        // Arrivée depuis une vignette : le filtre est posé par l'URL en statuts
        // fins. On remonte aux vignettes pour que la colonne montre ce qui est
        // réellement appliqué, au lieu d'afficher « Tous ».
        const param = searchParams.get("queueOutcome");
        if (!param) return [];
        const outcomes = (param.split(":")[1] ?? "").split(",");
        return (["answered", "lost", "overflow"] as const).filter((bucket) =>
            outcomesForBucket(bucket).every((o) => outcomes.includes(o)),
        );
    });

    // Data state
    const [data, setData] = useState<AggregatedCallLogsResponse | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isExporting, setIsExporting] = useState(false);
    const [resetCounter, setResetCounter] = useState(0); // Incremented on reset to trigger immediate fetch

    // Modal state
    const [selectedCallHistoryId, setSelectedCallHistoryId] = useState<string | null>(null);
    const [showSqlModal, setShowSqlModal] = useState(false);
    const [sqlQuery, setSqlQuery] = useState("");
    const [isLoadingSql, setIsLoadingSql] = useState(false);

    // Queues state for filter
    const [queues, setQueues] = useState<QueueInfo[]>([]);

    // Changer de file (ou revenir à la vue entreprise) libère le filtre de
    // statut : il désignait des statuts DANS l'ancienne file et n'aurait plus
    // de sens ailleurs.
    const changeQueueView = (next: string | null) => {
        setQueueView(next);
        setQueueOutcomeFilter(null);
        setQueueBuckets([]);
        setQueueOrigin(null);
        setCurrentPage(1);
    };

    // File consultée, résolue avec son libellé pour l'affichage.
    const selectedQueueView = queueView
        ? {
            number: queueView,
            name: queues.find((q) => q.queueNumber === queueView)?.queueName || queueView,
        }
        : null;


    // Debounce search inputs (1000ms)
    const debouncedCallerSearch = useDebounce(callerSearch, 1000);
    const debouncedCalleeSearch = useDebounce(calleeSearch, 1000);
    const debouncedHandledBySearch = useDebounce(handledBySearch, 1000);
    const debouncedIdSearch = useDebounce(idSearch, 1000);

    // Build effective filters
    // Key fix: if actual value is empty, use it immediately (for reset case)
    // Otherwise use debounced value (for typing case)
    const effectiveFilters: LogsFilters = {
        sens: selectedSens,
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
        waitTimeMin,
        waitTimeMax,
        timeSlots: timeSlots.length > 0 ? timeSlots : undefined,
        // Journey filter (groups with AND/OR)
        journeyFilter: journeyFilter || undefined,
        queueOutcomeFilter: queueOutcomeFilter || undefined,
        queueView: queueView || undefined,
        queueOriginFilter: queueOrigin ?? undefined,
        callOrigin: callOrigin ?? undefined,
    };

    // Update URL when filters change - uses DEBOUNCED values for text search
    const updateUrl = useCallback(() => {
        const params = new URLSearchParams();

        // Date range (always present) - use LOCAL date format, not UTC
        applyPeriodToParams(params, dateRange);

        // Page (only if > 1)
        if (currentPage > 1) {
            params.set("page", currentPage.toString());
        }

        // Directions (only if filtered, not all 4)
        if (selectedSens.length > 0 && selectedSens.length < 3) {
            params.set("sens", selectedSens.join(","));
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
        if (waitTimeMin !== undefined) params.set("waitMin", waitTimeMin.toString());
        if (waitTimeMax !== undefined) params.set("waitMax", waitTimeMax.toString());

        // Time slots
        if (timeSlots.length > 0) {
            params.set("timeSlots", timeSlots.map(s => `${s.start}-${s.end}`).join(","));
        }

        // Journey filter
        if (journeyFilter) {
            params.set("journeyFilter", JSON.stringify(journeyFilter));
        }

        // Conservé tel quel : ce filtre vient d'un KPI et n'est pas modifiable
        // depuis l'écran, mais il doit survivre aux changements de page.
        if (queueView) {
            params.set("queueView", queueView);
        }

        if (queueOrigin) {
            params.set("queueOrigin", queueOrigin);
        }

        if (callOrigin) {
            params.set("origin", callOrigin);
        }

        if (queueOutcomeFilter) {
            params.set(
                "queueOutcome",
                `${queueOutcomeFilter.queueNumber}:${queueOutcomeFilter.outcomes.join(",")}${queueOutcomeFilter.includeTeamDirect ? ":team" : ""}`,
            );
        }

        router.replace(`/admin/logs?${params.toString()}`, { scroll: false });
    }, [
        router,
        dateRange,
        currentPage,
        selectedSens,
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
        waitTimeMin,
        waitTimeMax,
        timeSlots,
        journeyFilter,
        queueOutcomeFilter,
        queueView,
        queueOrigin,
        callOrigin,
    ]);

    // Fetch data
    const fetchData = useCallback(async () => {
        setIsLoading(true);
        try {
            const serverId = getSelectedServer();
            const result = await getAggregatedCallLogs(
                serverId,
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
        selectedSens,
        selectedStatuses,
        segmentCountMin,
        segmentCountMax,
        durationMin,
        durationMax,
        waitTimeMin,
        waitTimeMax,
        timeSlots,
        currentPage,
        sort,
        journeyFilter,
        // Sans ces dependances, changer de vue file ou cocher un statut
        // ne relançait aucune requête : le tableau restait figé.
        queueOutcomeFilter,
        queueView,
        callOrigin,
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
                const serverId = getSelectedServer();
                const options = await getScopedQueueOptions(serverId);
                setQueues(options.queues);
                setCanViewCompanyWide(options.canViewCompanyWide);
                setNoPerimeter(options.noPerimeter);
                // Sans droit sur la vue entreprise, la vue file est obligatoire.
                if (!options.canViewCompanyWide && options.queues.length > 0) {
                    setQueueView((current) => current ?? options.queues[0].queueNumber);
                }
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
            const serverId = getSelectedServer();
            const csv = await exportCallLogsCSV(serverId, dateRange.startDate, dateRange.endDate, effectiveFilters);
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

    const handleExportIdsOnly = async () => {
        setIsExporting(true);
        try {
            const serverId = getSelectedServer();
            const csv = await exportCallLogsCSV(serverId, dateRange.startDate, dateRange.endDate, effectiveFilters, true);
            const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
            const link = document.createElement("a");
            link.href = URL.createObjectURL(blob);
            link.download = `call-ids-${new Date().toISOString().split("T")[0]}.csv`;
            link.click();
        } catch (error) {
            console.error("Error exporting CSV:", error);
        } finally {
            setIsExporting(false);
        }
    };

    const handleShowSQL = async () => {
        setShowSqlModal(true);
        setIsLoadingSql(true);
        try {
            const serverId = getSelectedServer();
            const sql = await getCallLogsSQL(serverId, dateRange.startDate, dateRange.endDate, effectiveFilters, { page: currentPage, pageSize: PAGE_SIZE }, sort);
            setSqlQuery(sql);
        } catch (error) {
            console.error("Error fetching SQL:", error);
            setSqlQuery("-- Erreur lors de la génération de la requête SQL");
        } finally {
            setIsLoadingSql(false);
        }
    };

    const handleSensChange = (sens: CallSens[]) => {
        setSelectedSens(sens);
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

    const handleWaitTimeChange = (range: { min?: number; max?: number }) => {
        setWaitTimeMin(range.min);
        setWaitTimeMax(range.max);
        setCurrentPage(1);
    };

    const handleTimeSlotsChange = (slots: TimeSlot[]) => {
        setTimeSlots(slots);
        setCurrentPage(1);
    };

    const handleRemoveTimeSlots = () => {
        setTimeSlots([]);
        setCurrentPage(1);
    };

    const handleRowClick = (callHistoryId: string) => {
        setSelectedCallHistoryId(callHistoryId);
    };

    // Handlers for removing individual filters
    const handleRemoveSens = (sens: CallSens) => {
        const newSens = selectedSens.filter(d => d !== sens);
        setSelectedSens(newSens);
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

    const handleRemoveWaitTime = () => {
        setWaitTimeMin(undefined);
        setWaitTimeMax(undefined);
        setCurrentPage(1);
    };

    const handleJourneyFilterChange = (filter: JourneyFilter | null) => {
        setJourneyFilter(filter);
        setCurrentPage(1);
    };

    const handleRemoveJourneyConditions = () => {
        setJourneyFilter(null);
        setCurrentPage(1);
    };

    const handleRemoveCallOrigin = () => {
        // Retirer le filtre = repasser le contexte global sur « Les deux » —
        // le toggle du header suit, puisqu'il lit le même paramètre d'URL.
        setUrlOrigin("both");
        setCurrentPage(1);
    };

    const handleResetAllFilters = () => {
        // Reset all filter states
        setSelectedSens([]);
        setSelectedStatuses([]);
        setUrlOrigin("both");
        setCallerSearch("");
        setCalleeSearch("");
        setHandledBySearch("");
        setSelectedQueueNumber(null);
        setIdSearch("");
        setSegmentCountMin(undefined);
        setSegmentCountMax(undefined);
        setDurationMin(undefined);
        setDurationMax(undefined);
        setWaitTimeMin(undefined);
        setWaitTimeMax(undefined);
        setTimeSlots([]);
        setJourneyFilter(null);
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
                                {([
                                    { key: "callHistoryId", label: "ID" },
                                    { key: "segmentCount", label: "Segments" },
                                    { key: "dateTime", label: "Date" },
                                    { key: "timeSlot", label: "Heure" },
                                    { key: "caller", label: "Appelant" },
                                    { key: "callee", label: "Destinataire" },
                                    { key: "handledBy", label: "Traité par" },
                                    { key: "queues", label: "Queue(s)" },
                                    { key: "journey", label: "Parcours" },
                                    { key: "provenance", label: "Provenance" },
                                    { key: "sens", label: "Sens" },
                                    { key: "status", label: "Statut" },
                                    { key: "duration", label: "Durée" },
                                    { key: "waitTime", label: "Attente" },
                                ] as { key: keyof ColumnVisibility; label: string }[]).map((col) => (
                                    <div key={col.key} className="flex items-center gap-2 px-1 py-1">
                                        <Checkbox
                                            id={`col-${col.key}`}
                                            checked={columnVisibility[col.key]}
                                            onCheckedChange={(checked) =>
                                                setColumnVisibility({ ...columnVisibility, [col.key]: checked as boolean })
                                            }
                                        />
                                        <Label htmlFor={`col-${col.key}`} className="text-sm cursor-pointer">
                                            {col.label}
                                        </Label>
                                    </div>
                                ))}
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

                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button
                                variant="outline"
                                size="sm"
                                disabled={isExporting || isLoading}
                                className="gap-2"
                            >
                                <Download className={`h-4 w-4 ${isExporting ? "animate-pulse" : ""}`} />
                                CSV
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={handleExportCSV}>
                                <FileText className="h-4 w-4 mr-2" />
                                Export complet
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={handleExportIdsOnly}>
                                <FileText className="h-4 w-4 mr-2" />
                                IDs uniquement
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>

                    <Button
                        variant="outline"
                        size="sm"
                        onClick={handleShowSQL}
                        className="gap-2"
                    >
                        <Code className="h-4 w-4" />
                        SQL
                    </Button>
                </div>
            </div>

            {/* Active Filters Badges */}
            <ActiveFilters
                dateRange={dateRange}
                filters={effectiveFilters}
                onRemoveSens={handleRemoveSens}
                onRemoveQueueView={canViewCompanyWide ? () => changeQueueView(null) : undefined}
                onRemoveQueueOutcome={() => { setQueueOutcomeFilter(null); setCurrentPage(1); }}
                onRemoveQueueOrigin={() => { setQueueOrigin(null); setCurrentPage(1); }}
                onRemoveStatus={handleRemoveStatus}
                onRemoveCallerSearch={handleRemoveCallerSearch}
                onRemoveCalleeSearch={handleRemoveCalleeSearch}
                onRemoveHandledBySearch={handleRemoveHandledBySearch}
                onRemoveQueueSearch={handleRemoveQueueSearch}
                onRemoveIdSearch={handleRemoveIdSearch}
                onRemoveSegmentCount={handleRemoveSegmentCount}
                onRemoveDuration={handleRemoveDuration}
                onRemoveWaitTime={handleRemoveWaitTime}
                onRemoveTimeSlots={handleRemoveTimeSlots}
                onRemoveJourneyConditions={handleRemoveJourneyConditions}
                onRemoveCallOrigin={handleRemoveCallOrigin}
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

            {noPerimeter && (
                <NoPerimeterNotice context="Les journaux d'appels sont filtrés selon les groupes qui vous sont attribués, et aucun ne l'est pour le moment." />
            )}

            {/* Sélecteur de vue. La vue file ne filtre pas : elle ajoute au
                tableau le statut de chaque appel dans la file consultée, à côté
                de son statut final. Un manager voit ainsi que ses « perdus »
                ont pu être récupérés ailleurs. */}
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5">
                <span className="text-sm font-medium text-slate-600">Vue</span>

                <div className="flex items-center gap-1.5">
                    {/* Span intermédiaire : le bouton est désactivé précisément
                        quand l'explication doit pouvoir s'afficher. */}
                    <Tip content={canViewCompanyWide ? undefined : "Votre périmètre ne donne pas accès à la vue entreprise"}>
                        <span className="inline-flex">
                            <Button
                                variant={queueView ? "outline" : "default"}
                                size="sm"
                                disabled={!canViewCompanyWide}
                                onClick={() => changeQueueView(null)}
                            >
                                Entreprise
                            </Button>
                        </span>
                    </Tip>

                    <QueueSelector
                        queues={queues}
                        selectedQueueNumber={queueView}
                        onSelect={(queueNumber) => changeQueueView(queueNumber)}
                        placeholder="Choisir un groupe…"
                        className="w-[320px]"
                    />
                </div>

                {selectedQueueView && (
                    <span className="text-sm text-slate-500">
                        Statut affiché du point de vue du groupe{" "}
                        <span className="font-medium text-slate-700">
                            {selectedQueueView.number} – {selectedQueueView.name}
                        </span>
                    </span>
                )}
            </div>

            {/* Table with integrated filters */}
            <Card className="border-slate-200 shadow-sm overflow-hidden">
                <LogsTable
                    logs={data?.logs || []}
                    queueView={selectedQueueView}
                    queueOutcomes={queueBuckets}
                    onQueueOutcomesChange={(buckets) => {
                        setCurrentPage(1);
                        setQueueBuckets(buckets);
                        // La vue file porte toujours sur la population de
                        // l'équipe ; le filtre ne fait que réduire à l'intérieur.
                        const outcomes = buckets.flatMap((b) => outcomesForBucket(b));
                        setQueueOutcomeFilter(
                            outcomes.length > 0 && queueView
                                ? { queueNumber: queueView, outcomes, includeTeamDirect: true }
                                : null,
                        );
                    }}
                    queueOrigin={queueOrigin}
                    onQueueOriginChange={(origin) => {
                        setCurrentPage(1);
                        setQueueOrigin(origin);
                    }}
                    isLoading={isLoading}
                    columnVisibility={columnVisibility}
                    sort={sort}
                    onSort={handleSort}
                    onViewChain={setSelectedCallHistoryId}
                    // Filter props
                    dateRange={dateRange}
                    onDateRangeChange={handleDateRangeChange}
                    timeSlots={timeSlots}
                    onTimeSlotsChange={handleTimeSlotsChange}
                    callerSearch={callerSearch}
                    onCallerSearchChange={setCallerSearch}
                    calleeSearch={calleeSearch}
                    onCalleeSearchChange={setCalleeSearch}
                    selectedSens={selectedSens}
                    onSensChange={handleSensChange}
                    selectedStatuses={selectedStatuses}
                    onStatusesChange={handleStatusesChange}
                    durationMin={durationMin}
                    durationMax={durationMax}
                    onDurationChange={handleDurationChange}
                    waitTimeMin={waitTimeMin}
                    waitTimeMax={waitTimeMax}
                    onWaitTimeChange={handleWaitTimeChange}
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
                    // Journey filter (groups with AND/OR operators)
                    journeyFilter={journeyFilter}
                    onJourneyFilterChange={handleJourneyFilterChange}
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

            {/* SQL Query Modal */}
            <SqlQueryModal
                open={showSqlModal}
                onOpenChange={setShowSqlModal}
                sql={sqlQuery}
                isLoading={isLoadingSql}
            />
        </div>
    );
}
