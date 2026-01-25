"use client";

import * as React from "react";
import { X, RotateCcw } from "lucide-react";
import { format } from "date-fns";
import { fr } from "date-fns/locale";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import type { CallDirection, CallStatus, LogsFilters } from "@/types/logs.types";

interface ActiveFiltersProps {
    dateRange: { startDate: Date; endDate: Date };
    filters: LogsFilters;
    onRemoveDateRange?: () => void;
    onRemoveDirection: (direction: CallDirection) => void;
    onRemoveStatus: (status: CallStatus) => void;
    onRemoveCallerSearch: () => void;
    onRemoveCalleeSearch: () => void;
    onRemoveDuration: () => void;
    onResetAll: () => void;
}

const directionLabels: Record<CallDirection, string> = {
    inbound: "Entrant",
    outbound: "Sortant",
    internal: "Interne",
    bridge: "Bridge",
};

const statusLabels: Record<CallStatus, string> = {
    answered: "Répondu",
    voicemail: "Messagerie",
    abandoned: "Abandonné",
    unanswered: "Sans réponse",
    busy: "Occupé",
};

export function ActiveFilters({
    dateRange,
    filters,
    onRemoveDirection,
    onRemoveStatus,
    onRemoveCallerSearch,
    onRemoveCalleeSearch,
    onRemoveDuration,
    onResetAll,
}: ActiveFiltersProps) {
    const activeFilters: React.ReactNode[] = [];

    // Date range (always shown as context)
    const dateLabel = `${format(dateRange.startDate, "dd/MM/yy", { locale: fr })} - ${format(dateRange.endDate, "dd/MM/yy", { locale: fr })}`;
    activeFilters.push(
        <Badge key="date" variant="outline" className="bg-slate-100 text-slate-700 gap-1 px-2 py-1">
            📅 {dateLabel}
        </Badge>
    );

    // Direction filters (only show if not all 4 selected)
    if (filters.directions && filters.directions.length > 0 && filters.directions.length < 4) {
        filters.directions.forEach((dir) => {
            activeFilters.push(
                <Badge
                    key={`dir-${dir}`}
                    variant="secondary"
                    className="bg-blue-100 text-blue-700 gap-1 px-2 py-1 cursor-pointer hover:bg-blue-200 transition-colors"
                    onClick={() => onRemoveDirection(dir)}
                >
                    {directionLabels[dir]}
                    <X className="h-3 w-3" />
                </Badge>
            );
        });
    }

    // Status filters
    if (filters.statuses && filters.statuses.length > 0 && filters.statuses.length < 5) {
        filters.statuses.forEach((status) => {
            const className = status === "answered" ? "bg-emerald-100 text-emerald-700" :
                status === "voicemail" ? "bg-blue-100 text-blue-700" :
                    status === "abandoned" ? "bg-amber-100 text-amber-700" :
                        status === "busy" ? "bg-red-100 text-red-700" :
                            "bg-slate-100 text-slate-600";
            activeFilters.push(
                <Badge
                    key={`status-${status}`}
                    variant="secondary"
                    className={`${className} gap-1 px-2 py-1 cursor-pointer hover:opacity-80 transition-opacity`}
                    onClick={() => onRemoveStatus(status)}
                >
                    {statusLabels[status]}
                    <X className="h-3 w-3" />
                </Badge>
            );
        });
    }

    // Caller search
    if (filters.callerSearch?.trim()) {
        activeFilters.push(
            <Badge
                key="caller"
                variant="secondary"
                className="bg-purple-100 text-purple-700 gap-1 px-2 py-1 cursor-pointer hover:bg-purple-200 transition-colors"
                onClick={onRemoveCallerSearch}
            >
                Appelant: "{filters.callerSearch}"
                <X className="h-3 w-3" />
            </Badge>
        );
    }

    // Callee search
    if (filters.calleeSearch?.trim()) {
        activeFilters.push(
            <Badge
                key="callee"
                variant="secondary"
                className="bg-purple-100 text-purple-700 gap-1 px-2 py-1 cursor-pointer hover:bg-purple-200 transition-colors"
                onClick={onRemoveCalleeSearch}
            >
                Destinataire: "{filters.calleeSearch}"
                <X className="h-3 w-3" />
            </Badge>
        );
    }

    // Duration filter
    if (filters.durationMin !== undefined || filters.durationMax !== undefined) {
        const durationLabel = filters.durationMin !== undefined && filters.durationMax !== undefined
            ? `${filters.durationMin}s - ${filters.durationMax}s`
            : filters.durationMin !== undefined
                ? `≥ ${filters.durationMin}s`
                : `≤ ${filters.durationMax}s`;
        activeFilters.push(
            <Badge
                key="duration"
                variant="secondary"
                className="bg-orange-100 text-orange-700 gap-1 px-2 py-1 cursor-pointer hover:bg-orange-200 transition-colors"
                onClick={onRemoveDuration}
            >
                Durée: {durationLabel}
                <X className="h-3 w-3" />
            </Badge>
        );
    }

    // Count removable filters (excluding date range)
    const removableCount = activeFilters.length - 1;

    return (
        <div className="flex flex-wrap items-center gap-2 py-2">
            <span className="text-sm text-slate-500 mr-1">Filtres actifs:</span>
            {activeFilters}
            {removableCount > 0 && (
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={onResetAll}
                    className="h-7 px-2 text-slate-500 hover:text-slate-700"
                >
                    <RotateCcw className="h-3 w-3 mr-1" />
                    Réinitialiser
                </Button>
            )}
        </div>
    );
}
