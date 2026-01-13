"use client";

import * as React from "react";
import { CalendarIcon } from "lucide-react";
import { format, subDays, startOfDay, endOfDay } from "date-fns";
import { fr } from "date-fns/locale";
import { DateRange } from "react-day-picker";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";

interface DateRangePickerProps {
    className?: string;
    dateRange: { startDate: Date; endDate: Date };
    onDateRangeChange: (range: { startDate: Date; endDate: Date }) => void;
}

const presets = [
    { label: "Aujourd'hui", days: 0 },
    { label: "7 derniers jours", days: 7 },
    { label: "30 derniers jours", days: 30 },
    { label: "90 derniers jours", days: 90 },
];

export function DateRangePicker({
    className,
    dateRange,
    onDateRangeChange,
}: DateRangePickerProps) {
    const [open, setOpen] = React.useState(false);

    const handlePreset = (days: number) => {
        const end = endOfDay(new Date());
        const start = days === 0 ? startOfDay(new Date()) : startOfDay(subDays(new Date(), days));
        onDateRangeChange({ startDate: start, endDate: end });
        setOpen(false);
    };

    const handleCalendarChange = (range: DateRange | undefined) => {
        if (range?.from && range?.to) {
            onDateRangeChange({
                startDate: startOfDay(range.from),
                endDate: endOfDay(range.to),
            });
        } else if (range?.from) {
            onDateRangeChange({
                startDate: startOfDay(range.from),
                endDate: endOfDay(range.from),
            });
        }
    };

    return (
        <div className={cn("grid gap-2", className)}>
            <Popover open={open} onOpenChange={setOpen}>
                <PopoverTrigger asChild>
                    <Button
                        id="date"
                        variant="outline"
                        className={cn(
                            "w-[300px] justify-start text-left font-normal bg-white border-slate-200",
                            !dateRange && "text-muted-foreground"
                        )}
                    >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {dateRange.startDate && dateRange.endDate ? (
                            <>
                                {format(dateRange.startDate, "dd MMM yyyy", { locale: fr })} -{" "}
                                {format(dateRange.endDate, "dd MMM yyyy", { locale: fr })}
                            </>
                        ) : (
                            <span>Sélectionner une période</span>
                        )}
                    </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                    <div className="flex">
                        {/* Presets */}
                        <div className="p-3 border-r border-slate-200 space-y-1">
                            <p className="text-sm font-medium text-slate-700 mb-2">Raccourcis</p>
                            {presets.map((preset) => (
                                <Button
                                    key={preset.days}
                                    variant="ghost"
                                    size="sm"
                                    className="w-full justify-start text-sm"
                                    onClick={() => handlePreset(preset.days)}
                                >
                                    {preset.label}
                                </Button>
                            ))}
                        </div>
                        {/* Calendar */}
                        <div className="p-3">
                            <Calendar
                                initialFocus
                                mode="range"
                                defaultMonth={dateRange.startDate}
                                selected={{
                                    from: dateRange.startDate,
                                    to: dateRange.endDate,
                                }}
                                onSelect={handleCalendarChange}
                                numberOfMonths={2}
                                locale={fr}
                            />
                        </div>
                    </div>
                </PopoverContent>
            </Popover>
        </div>
    );
}
