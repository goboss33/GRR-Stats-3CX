"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tip } from "@/components/ui/tooltip";

export interface AdvancedFiltersValue {
    /** ISO days of week kept (1 = Monday … 7 = Sunday). All selected by default. */
    weekdays: number[];
    timeStart: string;
    timeEnd: string;
    minDurationSeconds: number | null;
    directions: Array<"inbound" | "outbound">;
    includePrevious: boolean;
}

export const DEFAULT_ADVANCED_FILTERS: AdvancedFiltersValue = {
    weekdays: [1, 2, 3, 4, 5, 6, 7],
    timeStart: "",
    timeEnd: "",
    minDurationSeconds: null,
    directions: ["inbound", "outbound"],
    includePrevious: true,
};

const WEEKDAY_LABELS = [
    { value: 1, label: "Lun" },
    { value: 2, label: "Mar" },
    { value: 3, label: "Mer" },
    { value: 4, label: "Jeu" },
    { value: 5, label: "Ven" },
    { value: 6, label: "Sam" },
    { value: 7, label: "Dim" },
];

interface AdvancedFiltersProps {
    value: AdvancedFiltersValue;
    onChange: (value: AdvancedFiltersValue) => void;
    disabled?: boolean;
}

/** Returns true when at least one filter differs from defaults (for the badge). */
export function hasActiveAdvancedFilters(value: AdvancedFiltersValue): boolean {
    return (
        value.weekdays.length !== 7 ||
        value.timeStart !== "" ||
        value.timeEnd !== "" ||
        value.minDurationSeconds !== null ||
        value.directions.length !== 2 ||
        !value.includePrevious
    );
}

export function AdvancedFilters({ value, onChange, disabled }: AdvancedFiltersProps) {
    const [isOpen, setIsOpen] = useState(false);
    const isActive = hasActiveAdvancedFilters(value);

    const toggleWeekday = (day: number) => {
        const next = value.weekdays.includes(day)
            ? value.weekdays.filter((d) => d !== day)
            : [...value.weekdays, day].sort();
        // Never allow an empty weekday selection (would return nothing)
        if (next.length === 0) return;
        onChange({ ...value, weekdays: next });
    };

    const toggleDirection = (direction: "inbound" | "outbound") => {
        const next = value.directions.includes(direction)
            ? value.directions.filter((d) => d !== direction)
            : [...value.directions, direction];
        if (next.length === 0) return;
        onChange({ ...value, directions: next });
    };

    return (
        <div className="border rounded-lg">
            <button
                type="button"
                className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50 rounded-lg"
                onClick={() => setIsOpen(!isOpen)}
            >
                <span className="flex items-center gap-2">
                    <SlidersHorizontal className="h-4 w-4" />
                    Filtres avancés
                    {isActive && (
                        <Tip content="Filtres actifs">
                            <span className="inline-flex h-2 w-2 rounded-full bg-blue-600" />
                        </Tip>
                    )}
                </span>
                {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>

            {isOpen && (
                <div className="px-4 pb-4 pt-1 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 border-t">
                    <div className="space-y-2 pt-3">
                        <Label className="text-xs font-semibold uppercase text-slate-500">Direction</Label>
                        <div className="flex flex-col gap-2">
                            <label className="flex items-center gap-2 text-sm cursor-pointer">
                                <Checkbox
                                    checked={value.directions.includes("inbound")}
                                    onCheckedChange={() => toggleDirection("inbound")}
                                    disabled={disabled}
                                />
                                Appels entrants
                            </label>
                            <label className="flex items-center gap-2 text-sm cursor-pointer">
                                <Checkbox
                                    checked={value.directions.includes("outbound")}
                                    onCheckedChange={() => toggleDirection("outbound")}
                                    disabled={disabled}
                                />
                                Appels sortants
                            </label>
                        </div>
                    </div>

                    <div className="space-y-2 pt-3">
                        <Label className="text-xs font-semibold uppercase text-slate-500">Jours de la semaine</Label>
                        <div className="flex flex-wrap gap-1">
                            {WEEKDAY_LABELS.map((day) => (
                                <Button
                                    key={day.value}
                                    type="button"
                                    size="sm"
                                    variant={value.weekdays.includes(day.value) ? "default" : "outline"}
                                    className="h-7 px-2 text-xs"
                                    onClick={() => toggleWeekday(day.value)}
                                    disabled={disabled}
                                >
                                    {day.label}
                                </Button>
                            ))}
                        </div>
                    </div>

                    <div className="space-y-2 pt-3">
                        <Label className="text-xs font-semibold uppercase text-slate-500">Plage horaire (début d'appel)</Label>
                        <div className="flex items-center gap-2">
                            <Input
                                type="time"
                                value={value.timeStart}
                                onChange={(e) => onChange({ ...value, timeStart: e.target.value })}
                                className="h-8 text-sm"
                                disabled={disabled}
                            />
                            <span className="text-slate-400 text-sm">→</span>
                            <Input
                                type="time"
                                value={value.timeEnd}
                                onChange={(e) => onChange({ ...value, timeEnd: e.target.value })}
                                className="h-8 text-sm"
                                disabled={disabled}
                            />
                        </div>
                    </div>

                    <div className="space-y-2 pt-3">
                        <Label className="text-xs font-semibold uppercase text-slate-500">Divers</Label>
                        <div className="flex items-center gap-2">
                            <Label htmlFor="min-duration" className="text-sm whitespace-nowrap">Durée min (s)</Label>
                            <Input
                                id="min-duration"
                                type="number"
                                min={0}
                                placeholder="0"
                                value={value.minDurationSeconds ?? ""}
                                onChange={(e) =>
                                    onChange({
                                        ...value,
                                        minDurationSeconds: e.target.value === "" ? null : Math.max(0, Number(e.target.value)),
                                    })
                                }
                                className="h-8 text-sm w-24"
                                disabled={disabled}
                            />
                        </div>
                        <label className="flex items-center gap-2 text-sm cursor-pointer pt-1">
                            <Switch
                                checked={value.includePrevious}
                                onCheckedChange={(checked) => onChange({ ...value, includePrevious: checked })}
                                disabled={disabled}
                            />
                            Comparer à la période précédente
                        </label>
                    </div>
                </div>
            )}
        </div>
    );
}
