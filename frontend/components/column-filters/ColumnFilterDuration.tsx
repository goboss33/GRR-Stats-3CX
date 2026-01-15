"use client";

import * as React from "react";
import { Clock, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";

interface ColumnFilterDurationProps {
    min?: number;
    max?: number;
    onChange: (range: { min?: number; max?: number }) => void;
    className?: string;
}

// Duration presets in seconds
const DURATION_MAX = 600; // 10 minutes max
const DURATION_PRESETS = [
    { label: "< 30s", min: 0, max: 30 },
    { label: "30s - 2m", min: 30, max: 120 },
    { label: "2 - 5m", min: 120, max: 300 },
    { label: "> 5m", min: 300, max: undefined },
];

function formatDuration(seconds: number): string {
    if (seconds >= 60) {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return secs > 0 ? `${mins}m${secs}s` : `${mins}m`;
    }
    return `${seconds}s`;
}

export function ColumnFilterDuration({
    min,
    max,
    onChange,
    className,
}: ColumnFilterDurationProps) {
    const [open, setOpen] = React.useState(false);

    const hasFilter = min !== undefined || max !== undefined;

    const handleSliderChange = (values: number[]) => {
        const newMin = values[0] === 0 ? undefined : values[0];
        const newMax = values[1] === DURATION_MAX ? undefined : values[1];
        onChange({ min: newMin, max: newMax });
    };

    const handlePreset = (preset: typeof DURATION_PRESETS[0]) => {
        onChange({ min: preset.min || undefined, max: preset.max });
    };

    const handleClear = () => {
        onChange({ min: undefined, max: undefined });
    };

    const getLabel = () => {
        if (!hasFilter) return "Durée";
        const minStr = min !== undefined ? formatDuration(min) : "0s";
        const maxStr = max !== undefined ? formatDuration(max) : "∞";
        return `${minStr} - ${maxStr}`;
    };

    const sliderValue = [min ?? 0, max ?? DURATION_MAX];

    return (
        <div className={cn("w-full min-w-[90px]", className)}>
            <Popover open={open} onOpenChange={setOpen}>
                <PopoverTrigger asChild>
                    <Button
                        variant="outline"
                        size="sm"
                        className={cn(
                            "h-8 w-full justify-start text-xs font-normal bg-white/80 border-input gap-1",
                            hasFilter && "border-primary/50 bg-primary/5"
                        )}
                    >
                        <Clock className="h-3 w-3 text-slate-500" />
                        <span className="truncate">{getLabel()}</span>
                    </Button>
                </PopoverTrigger>
                <PopoverContent className="w-56 p-3" align="start">
                    <div className="space-y-3">
                        <div className="flex items-center justify-between">
                            <span className="text-sm font-medium">Durée</span>
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
                                value={sliderValue}
                                min={0}
                                max={DURATION_MAX}
                                step={15}
                                onValueChange={handleSliderChange}
                                className="w-full"
                            />
                            <div className="flex justify-between text-xs text-slate-500 mt-1">
                                <span>{formatDuration(sliderValue[0])}</span>
                                <span>{sliderValue[1] === DURATION_MAX ? "∞" : formatDuration(sliderValue[1])}</span>
                            </div>
                        </div>

                        {/* Presets */}
                        <div className="border-t border-slate-100 pt-2">
                            <p className="text-xs text-slate-500 mb-1.5">Raccourcis</p>
                            <div className="flex flex-wrap gap-1">
                                {DURATION_PRESETS.map((preset) => {
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
