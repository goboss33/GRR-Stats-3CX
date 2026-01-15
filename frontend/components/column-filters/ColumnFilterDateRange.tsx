"use client";

import * as React from "react";
import { CalendarIcon, ChevronLeft, ChevronRight } from "lucide-react";
import {
    format,
    subDays,
    startOfDay,
    endOfDay,
    isAfter,
    isBefore,
    isSameDay,
    addMonths,
    subMonths,
    startOfMonth,
    eachDayOfInterval,
    endOfMonth,
    getDay,
    isWithinInterval
} from "date-fns";
import { fr } from "date-fns/locale";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";

interface ColumnFilterDateRangeProps {
    dateRange: { startDate: Date; endDate: Date };
    onDateRangeChange: (range: { startDate: Date; endDate: Date }) => void;
    className?: string;
}

const presets = [
    { label: "Aujourd'hui", days: 0 },
    { label: "7 jours", days: 7 },
    { label: "30 jours", days: 30 },
    { label: "90 jours", days: 90 },
];

const WEEKDAYS = ["lu", "ma", "me", "je", "ve", "sa", "di"];

export function ColumnFilterDateRange({
    dateRange,
    onDateRangeChange,
    className,
}: ColumnFilterDateRangeProps) {
    const [open, setOpen] = React.useState(false);

    // Selection state
    const [startDate, setStartDate] = React.useState<Date | null>(null);
    const [endDate, setEndDate] = React.useState<Date | null>(null);
    const [hoveredDate, setHoveredDate] = React.useState<Date | null>(null);

    // Calendar navigation
    const [currentMonth, setCurrentMonth] = React.useState(startOfMonth(dateRange.startDate));

    // Reset state when opening
    const handleOpenChange = (newOpen: boolean) => {
        setOpen(newOpen);
        if (newOpen) {
            setStartDate(null);
            setEndDate(null);
            setHoveredDate(null);
            setCurrentMonth(startOfMonth(dateRange.startDate));
        }
    };

    const handlePreset = (days: number) => {
        const end = endOfDay(new Date());
        const start = days === 0 ? startOfDay(new Date()) : startOfDay(subDays(new Date(), days));
        onDateRangeChange({ startDate: start, endDate: end });
        setOpen(false);
    };

    const handleDayClick = (day: Date) => {
        if (!startDate) {
            // First click - set start date
            setStartDate(day);
            setEndDate(null);
        } else if (!endDate) {
            // Second click - set end date and apply
            let from = startDate;
            let to = day;

            // Ensure from <= to
            if (isAfter(from, to)) {
                [from, to] = [to, from];
            }

            onDateRangeChange({
                startDate: startOfDay(from),
                endDate: endOfDay(to),
            });
            setOpen(false);
        }
    };

    const formatCompact = () => {
        const start = format(dateRange.startDate, "dd/MM", { locale: fr });
        const end = format(dateRange.endDate, "dd/MM", { locale: fr });
        return `${start} - ${end}`;
    };

    const helpText = () => {
        if (!startDate) {
            return "Cliquez sur une date de début";
        }
        const startStr = format(startDate, "dd/MM/yyyy", { locale: fr });
        if (hoveredDate && !isSameDay(hoveredDate, startDate)) {
            const endStr = format(hoveredDate, "dd/MM/yyyy", { locale: fr });
            const [dispStart, dispEnd] = isBefore(hoveredDate, startDate)
                ? [endStr, startStr]
                : [startStr, endStr];
            return `${dispStart} → ${dispEnd}`;
        }
        return `Début: ${startStr} — Sélectionnez la fin`;
    };

    // Check if a day is in the preview range
    const isInPreviewRange = (day: Date): boolean => {
        if (!startDate || !hoveredDate || isSameDay(startDate, hoveredDate)) return false;
        const rangeStart = isBefore(hoveredDate, startDate) ? hoveredDate : startDate;
        const rangeEnd = isAfter(hoveredDate, startDate) ? hoveredDate : startDate;
        return isWithinInterval(day, { start: rangeStart, end: rangeEnd });
    };

    // Check if a day is in the applied range
    const isInAppliedRange = (day: Date): boolean => {
        if (startDate) return false; // Don't show applied range during selection
        return isWithinInterval(day, { start: dateRange.startDate, end: dateRange.endDate });
    };

    const isRangeStart = (day: Date): boolean => {
        if (startDate) return isSameDay(day, startDate);
        return isSameDay(day, dateRange.startDate);
    };

    const isRangeEnd = (day: Date): boolean => {
        if (startDate && hoveredDate) {
            const end = isAfter(hoveredDate, startDate) ? hoveredDate : startDate;
            return isSameDay(day, end);
        }
        if (!startDate) return isSameDay(day, dateRange.endDate);
        return false;
    };

    // Render a single month
    const renderMonth = (monthDate: Date) => {
        const monthStart = startOfMonth(monthDate);
        const monthEnd = endOfMonth(monthDate);
        const days = eachDayOfInterval({ start: monthStart, end: monthEnd });

        // Get the day of week for the first day (0 = Sunday, adjust for Monday start)
        const firstDayOfWeek = getDay(monthStart);
        const offset = firstDayOfWeek === 0 ? 6 : firstDayOfWeek - 1;

        return (
            <div className="w-[220px]">
                <div className="text-center font-medium text-sm mb-2">
                    {format(monthDate, "MMMM yyyy", { locale: fr })}
                </div>
                <div className="grid grid-cols-7 gap-0.5 mb-1">
                    {WEEKDAYS.map((day) => (
                        <div key={day} className="text-center text-xs text-slate-400 py-1">
                            {day}
                        </div>
                    ))}
                </div>
                <div className="grid grid-cols-7 gap-0.5">
                    {/* Empty cells for offset */}
                    {Array.from({ length: offset }).map((_, i) => (
                        <div key={`empty-${i}`} className="h-8" />
                    ))}
                    {/* Day cells */}
                    {days.map((day) => {
                        const inPreview = isInPreviewRange(day);
                        const inApplied = isInAppliedRange(day);
                        const isStart = isRangeStart(day);
                        const isEnd = isRangeEnd(day);
                        const isToday = isSameDay(day, new Date());
                        const isInRange = inPreview || inApplied;

                        return (
                            <button
                                key={day.toISOString()}
                                type="button"
                                onClick={() => handleDayClick(day)}
                                onMouseEnter={() => startDate && setHoveredDate(day)}
                                onMouseLeave={() => setHoveredDate(null)}
                                className={cn(
                                    "h-8 w-full text-sm rounded-md transition-colors",
                                    "hover:bg-primary/10",
                                    isToday && !isStart && !isEnd && "font-bold",
                                    isInRange && !isStart && !isEnd && "bg-primary/10 text-primary",
                                    (isStart || isEnd) && "bg-primary text-white hover:bg-primary/90",
                                    isStart && isEnd && "rounded-md",
                                    isStart && !isEnd && "rounded-l-md rounded-r-none",
                                    isEnd && !isStart && "rounded-r-md rounded-l-none",
                                )}
                            >
                                {format(day, "d")}
                            </button>
                        );
                    })}
                </div>
            </div>
        );
    };

    return (
        <div className={cn("w-full min-w-[120px]", className)}>
            <Popover open={open} onOpenChange={handleOpenChange}>
                <PopoverTrigger asChild>
                    <Button
                        variant="outline"
                        size="sm"
                        className="h-8 w-full justify-start text-xs font-normal bg-white/80 border-input"
                    >
                        <CalendarIcon className="mr-1.5 h-3 w-3 text-slate-500" />
                        <span className="truncate">{formatCompact()}</span>
                    </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                    <div className="flex">
                        {/* Presets */}
                        <div className="p-3 border-r border-slate-200 space-y-0.5">
                            <p className="text-xs font-medium text-slate-600 mb-2">Raccourcis</p>
                            {presets.map((preset) => (
                                <Button
                                    key={preset.days}
                                    variant="ghost"
                                    size="sm"
                                    className="w-full justify-start text-xs h-7"
                                    onClick={() => handlePreset(preset.days)}
                                >
                                    {preset.label}
                                </Button>
                            ))}
                        </div>

                        {/* Calendar */}
                        <div className="p-3">
                            <p className="text-xs text-slate-500 mb-3 min-h-[16px]">
                                {helpText()}
                            </p>

                            {/* Navigation */}
                            <div className="flex items-center justify-between mb-3">
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7"
                                    onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
                                >
                                    <ChevronLeft className="h-4 w-4" />
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7"
                                    onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
                                >
                                    <ChevronRight className="h-4 w-4" />
                                </Button>
                            </div>

                            {/* Two months side by side */}
                            <div className="flex gap-4">
                                {renderMonth(currentMonth)}
                                {renderMonth(addMonths(currentMonth, 1))}
                            </div>
                        </div>
                    </div>
                </PopoverContent>
            </Popover>
        </div>
    );
}
