"use client";

import * as React from "react";
import { Clock, Plus, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";

import type { TimeSlot } from "@/types/logs.types";

interface ColumnFilterTimeSlotProps {
    slots: TimeSlot[];
    onChange: (slots: TimeSlot[]) => void;
    className?: string;
}

const TIME_PRESETS: { label: string; slots: TimeSlot[] }[] = [
    { label: "Journée (08-18h)", slots: [{ start: "08:00", end: "18:00" }] },
    { label: "Matin (08-12h)", slots: [{ start: "08:00", end: "12:00" }] },
    { label: "Après-midi (14-18h)", slots: [{ start: "14:00", end: "18:00" }] },
    {
        label: "Sans pause (08-12 + 14-18)",
        slots: [
            { start: "08:00", end: "12:00" },
            { start: "14:00", end: "18:00" },
        ],
    },
];

function slotsEqual(a: TimeSlot[], b: TimeSlot[]): boolean {
    if (a.length !== b.length) return false;
    return a.every((s, i) => s.start === b[i].start && s.end === b[i].end);
}

export function ColumnFilterTimeSlot({
    slots,
    onChange,
    className,
}: ColumnFilterTimeSlotProps) {
    const [open, setOpen] = React.useState(false);
    const [localSlots, setLocalSlots] = React.useState<TimeSlot[]>(slots);

    // Sync local state when props change
    React.useEffect(() => {
        setLocalSlots(slots);
    }, [slots]);

    const hasFilter = slots.length > 0;

    const handleSlotChange = (index: number, field: "start" | "end", value: string) => {
        const updated = [...localSlots];
        updated[index] = { ...updated[index], [field]: value };
        setLocalSlots(updated);
    };

    const handleAddSlot = () => {
        setLocalSlots([...localSlots, { start: "08:00", end: "18:00" }]);
    };

    const handleRemoveSlot = (index: number) => {
        const updated = localSlots.filter((_, i) => i !== index);
        setLocalSlots(updated);
    };

    const handleApply = () => {
        onChange(localSlots);
        setOpen(false);
    };

    const handlePreset = (preset: typeof TIME_PRESETS[0]) => {
        setLocalSlots(preset.slots);
        onChange(preset.slots);
    };

    const handleClear = () => {
        setLocalSlots([]);
        onChange([]);
    };

    const getLabel = () => {
        if (!hasFilter) return "Heure";
        if (slots.length === 1) return `${slots[0].start}-${slots[0].end}`;
        return `${slots.length} créneaux`;
    };

    return (
        <div className={cn("w-full min-w-[90px]", className)}>
            <Popover open={open} onOpenChange={setOpen}>
                <PopoverTrigger asChild>
                    <Button
                        variant="outline"
                        size="sm"
                        className={cn(
                            "h-8 w-full justify-start text-xs font-normal bg-white/80 border-input gap-1",
                            hasFilter && "border-blue-500 bg-blue-50/50"
                        )}
                    >
                        <Clock className="h-3 w-3 text-slate-500" />
                        <span className="truncate">{getLabel()}</span>
                    </Button>
                </PopoverTrigger>
                <PopoverContent className="w-72 p-3" align="start">
                    <div className="space-y-3">
                        <div className="flex items-center justify-between">
                            <span className="text-sm font-medium">Créneaux horaires</span>
                            {hasFilter && (
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={handleClear}
                                    className="h-6 px-2 text-xs"
                                >
                                    <X className="h-3 w-3 mr-1" />
                                    Effacer
                                </Button>
                            )}
                        </div>

                        {/* Time slots list */}
                        <div className="space-y-2">
                            {localSlots.length === 0 && (
                                <p className="text-xs text-slate-400 text-center py-2">
                                    Aucun créneau — toute la journée
                                </p>
                            )}
                            {localSlots.map((slot, index) => (
                                <div key={index} className="flex items-center gap-1.5">
                                    <input
                                        type="time"
                                        value={slot.start}
                                        onChange={(e) => handleSlotChange(index, "start", e.target.value)}
                                        className="flex-1 h-7 text-xs border border-slate-200 rounded px-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                                    />
                                    <span className="text-xs text-slate-400">à</span>
                                    <input
                                        type="time"
                                        value={slot.end}
                                        onChange={(e) => handleSlotChange(index, "end", e.target.value)}
                                        className="flex-1 h-7 text-xs border border-slate-200 rounded px-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => handleRemoveSlot(index)}
                                        className="h-7 w-7 flex items-center justify-center text-slate-400 hover:text-red-500 transition-colors"
                                    >
                                        <X className="h-3 w-3" />
                                    </button>
                                </div>
                            ))}
                        </div>

                        {/* Add slot + Apply buttons */}
                        <div className="flex items-center gap-2">
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={handleAddSlot}
                                className="h-7 text-xs flex-1 gap-1"
                            >
                                <Plus className="h-3 w-3" />
                                Ajouter un créneau
                            </Button>
                            {localSlots.length > 0 && !slotsEqual(localSlots, slots) && (
                                <Button
                                    size="sm"
                                    onClick={handleApply}
                                    className="h-7 text-xs"
                                >
                                    Appliquer
                                </Button>
                            )}
                        </div>

                        {/* Presets */}
                        <div className="border-t border-slate-100 pt-2">
                            <p className="text-xs text-slate-500 mb-1.5">Raccourcis</p>
                            <div className="flex flex-col gap-1">
                                {TIME_PRESETS.map((preset) => {
                                    const isActive = slotsEqual(slots, preset.slots);
                                    return (
                                        <Button
                                            key={preset.label}
                                            variant={isActive ? "default" : "outline"}
                                            size="sm"
                                            className="h-7 text-xs justify-start"
                                            onClick={() => handlePreset(preset)}
                                        >
                                            {preset.label}
                                        </Button>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                </PopoverContent>
            </Popover>
        </div>
    );
}
