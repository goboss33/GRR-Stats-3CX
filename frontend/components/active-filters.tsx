"use client";

import * as React from "react";
import { X, RotateCcw } from "lucide-react";
import { format } from "date-fns";
import { fr } from "date-fns/locale";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import type { CallDirection, CallStatus, JourneyCondition, LogsFilters } from "@/types/logs.types";

interface ActiveFiltersProps {
    dateRange: { startDate: Date; endDate: Date };
    filters: LogsFilters;
    onRemoveDateRange?: () => void;
    onRemoveDirection: (direction: CallDirection) => void;
    onRemoveStatus: (status: CallStatus) => void;
    onRemoveCallerSearch: () => void;
    onRemoveCalleeSearch: () => void;
    onRemoveHandledBySearch: () => void;
    onRemoveQueueSearch: () => void;
    onRemoveIdSearch: () => void;
    onRemoveSegmentCount: () => void;
    onRemoveDuration: () => void;
    onRemoveWaitTime: () => void;
    onRemoveJourneyConditions?: () => void;
    onRemoveTimeSlots?: () => void;
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
    busy: "Occupé",
};

function formatConditionLabel(
    condition: JourneyCondition,
    typeLabels: Record<string, string>,
    resultLabels: Record<string, string>,
): string {
    const parts: string[] = [];
    if (condition.negate) parts.push("PAS");
    if (condition.type) parts.push(typeLabels[condition.type] || condition.type);
    if (condition.queueNumber) parts.push(`Q${condition.queueNumber}`);
    if (condition.agentNumber) parts.push(`Agent ${condition.agentNumber}`);
    if (condition.result) parts.push(resultLabels[condition.result] || condition.result);
    if (condition.passageMode === 'multi') parts.push("(ping-pong)");
    if (condition.passageMode === 'first') parts.push("(1er passage)");
    if (condition.hasOverflow) parts.push("(redirigé)");
    return parts.length > 0 ? parts.join(" ") : "Tous";
}

export function ActiveFilters({
    dateRange,
    filters,
    onRemoveDirection,
    onRemoveStatus,
    onRemoveCallerSearch,
    onRemoveCalleeSearch,
    onRemoveHandledBySearch,
    onRemoveQueueSearch,
    onRemoveIdSearch,
    onRemoveSegmentCount,
    onRemoveDuration,
    onRemoveWaitTime,
    onRemoveJourneyConditions,
    onRemoveTimeSlots,
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

    // Handled by search
    if (filters.handledBySearch?.trim()) {
        activeFilters.push(
            <Badge
                key="handledBy"
                variant="secondary"
                className="bg-teal-100 text-teal-700 gap-1 px-2 py-1 cursor-pointer hover:bg-teal-200 transition-colors"
                onClick={onRemoveHandledBySearch}
            >
                Traité par: "{filters.handledBySearch}"
                <X className="h-3 w-3" />
            </Badge>
        );
    }

    // Queue search
    if (filters.queueSearch?.trim()) {
        activeFilters.push(
            <Badge
                key="queue"
                variant="secondary"
                className="bg-cyan-100 text-cyan-700 gap-1 px-2 py-1 cursor-pointer hover:bg-cyan-200 transition-colors"
                onClick={onRemoveQueueSearch}
            >
                Queue: "{filters.queueSearch}"
                <X className="h-3 w-3" />
            </Badge>
        );
    }

    // ID search
    if (filters.idSearch?.trim()) {
        activeFilters.push(
            <Badge
                key="id"
                variant="secondary"
                className="bg-gray-100 text-gray-700 gap-1 px-2 py-1 cursor-pointer hover:bg-gray-200 transition-colors"
                onClick={onRemoveIdSearch}
            >
                ID: "{filters.idSearch}"
                <X className="h-3 w-3" />
            </Badge>
        );
    }

    // Segment count filter
    if (filters.segmentCountMin !== undefined || filters.segmentCountMax !== undefined) {
        const segmentLabel = filters.segmentCountMin !== undefined && filters.segmentCountMax !== undefined
            ? `${filters.segmentCountMin} - ${filters.segmentCountMax}`
            : filters.segmentCountMin !== undefined
                ? `≥ ${filters.segmentCountMin}`
                : `≤ ${filters.segmentCountMax}`;
        activeFilters.push(
            <Badge
                key="segmentCount"
                variant="secondary"
                className="bg-indigo-100 text-indigo-700 gap-1 px-2 py-1 cursor-pointer hover:bg-indigo-200 transition-colors"
                onClick={onRemoveSegmentCount}
            >
                Segments: {segmentLabel}
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

    // Wait time filter
    if (filters.waitTimeMin !== undefined || filters.waitTimeMax !== undefined) {
        const waitLabel = filters.waitTimeMin !== undefined && filters.waitTimeMax !== undefined
            ? `${filters.waitTimeMin}s - ${filters.waitTimeMax}s`
            : filters.waitTimeMin !== undefined
                ? `≥ ${filters.waitTimeMin}s`
                : `≤ ${filters.waitTimeMax}s`;
        activeFilters.push(
            <Badge
                key="waitTime"
                variant="secondary"
                className="bg-yellow-100 text-yellow-700 gap-1 px-2 py-1 cursor-pointer hover:bg-yellow-200 transition-colors"
                onClick={onRemoveWaitTime}
            >
                Attente: {waitLabel}
                <X className="h-3 w-3" />
            </Badge>
        );
    }

    // Journey conditions filter
    if (filters.journeyConditions && filters.journeyConditions.length > 0 && onRemoveJourneyConditions) {
        const typeLabels: Record<string, string> = {
            direct: "Direct",
            queue: "Queue",
            voicemail: "Messagerie",
        };
        const resultLabels: Record<string, string> = {
            answered: "Répondu",
            not_answered: "Non rép.",
            abandoned: "Abandonné",
            overflow: "Redirigé",
            busy: "Occupé",
            voicemail: "Messagerie",
        };

        const conditionLabel = filters.journeyConditions.length === 1
            ? formatConditionLabel(filters.journeyConditions[0], typeLabels, resultLabels)
            : `${filters.journeyConditions.length} conditions`;

        activeFilters.push(
            <Badge
                key="journey-conditions"
                variant="secondary"
                className="bg-violet-100 text-violet-700 gap-1 px-2 py-1 cursor-pointer hover:bg-violet-200 transition-colors"
                onClick={onRemoveJourneyConditions}
            >
                Parcours: {conditionLabel}
                <X className="h-3 w-3" />
            </Badge>
        );
    }

    // Time slot filters
    if (filters.timeSlots && filters.timeSlots.length > 0 && onRemoveTimeSlots) {
        const slotLabel = filters.timeSlots.length === 1
            ? `${filters.timeSlots[0].start}-${filters.timeSlots[0].end}`
            : `${filters.timeSlots.length} créneaux`;
        activeFilters.push(
            <Badge
                key="timeSlots"
                variant="secondary"
                className="bg-sky-100 text-sky-700 gap-1 px-2 py-1 cursor-pointer hover:bg-sky-200 transition-colors"
                onClick={onRemoveTimeSlots}
            >
                Heure: {slotLabel}
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
