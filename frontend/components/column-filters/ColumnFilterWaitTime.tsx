"use client";

import * as React from "react";
import { Hourglass, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";

interface ColumnFilterWaitTimeProps {
    min?: number;
    max?: number;
    onChange: (range: { min?: number; max?: number }) => void;
    className?: string;
}

const WAIT_MAX = 300; // 5 minutes max
const WAIT_PRESETS = [
    { label: "< 15s", min: 0, max: 15 },
    { label: "15 - 30s", min: 15, max: 30 },
    { label: "30s - 1m", min: 30, max: 60 },
    { label: "> 1m", min: 60, max: undefined },
];

function formatDuration(seconds: number): string {
    if (seconds >= 60) {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return secs > 0 ? `${mins}m${secs}s` : `${mins}m`;
    }
    return `${seconds}s`;
}

export function ColumnFilterWaitTime({
    min,
    max,
    onChange,
    className,
}: ColumnFilterWaitTimeProps) {
    const [open, setOpen] = React.useState(false);

    // Local state for slider while dragging (so it's responsive)
    const [localValue, setLocalValue] = React.useState<number[]>([min ?? 0, max ?? WAIT_MAX]);

    // Sync local value when props change (e.g., from URL or external update)
    React.useEffect(() => {
        setLocalValue([min ?? 0, max ?? WAIT_MAX]);
    }, [min, max]);

    const hasFilter = min !== undefined || max !== undefined;

    // Called during dragging - update local state only (visual feedback)
    const handleSliderChange = (values: number[]) => {
        setLocalValue(values);
    };

    // Called on mouse/touch release - apply the filter
    const handleSliderCommit = (values: number[]) => {
        const newMin = values[0] === 0 ? undefined : values[0];
        const newMax = values[1] === WAIT_MAX ? undefined : values[1];
        onChange({ min: newMin, max: newMax });
    };

    const handlePreset = (preset: typeof WAIT_PRESETS[0]) => {
        const newMin = preset.min || undefined;
        const newMax = preset.max;
        setLocalValue([preset.min ?? 0, preset.max ?? WAIT_MAX]);
        onChange({ min: newMin, max: newMax });
    };

    const handleClear = () => {
        setLocalValue([0, WAIT_MAX]);
        onChange({ min: undefined, max: undefined });
    };

    const getLabel = () => {
        if (!hasFilter) return "Attente";
        const minStr = min !== undefined ? formatDuration(min) : "0s";
        const maxStr = max !== undefined ? formatDuration(max) : "∞";
        return `${minStr} - ${maxStr}`;
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
                        <Hourglass className="h-3 w-3 text-slate-500" />
                        <span className="truncate">{getLabel()}</span>
                    </Button>
                </PopoverTrigger>
                <PopoverContent className="w-56 p-3" align="start">
                    <div className="space-y-3">
                        <div className="flex items-center justify-between">
                            <span className="text-sm font-medium">Attente</span>
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

                        {/* Slider */}
                        <div className="px-1">
                            <Slider
                                value={localValue}
                                min={0}
                                max={WAIT_MAX}
                                step={5}
                                onValueChange={handleSliderChange}
                                onValueCommit={handleSliderCommit}
                                className="w-full"
                            />
                            <div className="flex justify-between text-xs text-slate-500 mt-1">
                                <span>{formatDuration(localValue[0])}</span>
                                <span>{localValue[1] === WAIT_MAX ? "∞" : formatDuration(localValue[1])}</span>
                            </div>
                        </div>

                        {/* Presets */}
                        <div className="border-t border-slate-100 pt-2">
                            <p className="text-xs text-slate-500 mb-1.5">Raccourcis</p>
                            <div className="flex flex-wrap gap-1">
                                {WAIT_PRESETS.map((preset) => {
                                    const isActive = min === preset.min && max === preset.max;
                                    return (
                                        <Button
                                            key={preset.label}
                                            variant={isActive ? "default" : "outline"}
                                            size="sm"
                                            className="h-6 text-xs px-2"
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
