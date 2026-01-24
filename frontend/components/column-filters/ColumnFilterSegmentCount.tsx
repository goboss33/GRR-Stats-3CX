"use client";

import * as React from "react";
import { Layers, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";

interface ColumnFilterSegmentCountProps {
    min?: number;
    max?: number;
    onChange: (range: { min?: number; max?: number }) => void;
    className?: string;
}

const SEGMENT_MAX = 20;
const SEGMENT_PRESETS = [
    { label: "1", min: 1, max: 1 },
    { label: "2-3", min: 2, max: 3 },
    { label: "4-10", min: 4, max: 10 },
    { label: ">10", min: 10, max: undefined },
];

export function ColumnFilterSegmentCount({
    min,
    max,
    onChange,
    className,
}: ColumnFilterSegmentCountProps) {
    const [open, setOpen] = React.useState(false);
    const [localValue, setLocalValue] = React.useState<number[]>([min ?? 1, max ?? SEGMENT_MAX]);

    React.useEffect(() => {
        setLocalValue([min ?? 1, max ?? SEGMENT_MAX]);
    }, [min, max]);

    const hasFilter = min !== undefined || max !== undefined;

    const handleSliderChange = (values: number[]) => {
        setLocalValue(values);
    };

    const handleSliderCommit = (values: number[]) => {
        const newMin = values[0] === 1 ? undefined : values[0];
        const newMax = values[1] === SEGMENT_MAX ? undefined : values[1];
        onChange({ min: newMin, max: newMax });
    };

    const handlePreset = (preset: typeof SEGMENT_PRESETS[0]) => {
        const newMin = preset.min === 1 ? undefined : preset.min;
        const newMax = preset.max;
        setLocalValue([preset.min ?? 1, preset.max ?? SEGMENT_MAX]);
        onChange({ min: newMin, max: newMax });
    };

    const handleClear = () => {
        setLocalValue([1, SEGMENT_MAX]);
        onChange({ min: undefined, max: undefined });
    };

    const getLabel = () => {
        if (!hasFilter) return "Segments";
        const minStr = min !== undefined ? min.toString() : "1";
        const maxStr = max !== undefined ? max.toString() : "∞";
        return min === max ? minStr : `${minStr}-${maxStr}`;
    };

    return (
        <div className={cn("w-full min-w-[70px]", className)}>
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
                        <Layers className="h-3 w-3 text-slate-500" />
                        <span className="truncate">{getLabel()}</span>
                    </Button>
                </PopoverTrigger>
                <PopoverContent className="w-48 p-3" align="start">
                    <div className="space-y-3">
                        <div className="flex items-center justify-between">
                            <span className="text-sm font-medium">Nb segments</span>
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

                        <div className="px-1">
                            <Slider
                                value={localValue}
                                min={1}
                                max={SEGMENT_MAX}
                                step={1}
                                onValueChange={handleSliderChange}
                                onValueCommit={handleSliderCommit}
                                className="w-full"
                            />
                            <div className="flex justify-between text-xs text-slate-500 mt-1">
                                <span>{localValue[0]}</span>
                                <span>{localValue[1] === SEGMENT_MAX ? "∞" : localValue[1]}</span>
                            </div>
                        </div>

                        <div className="border-t border-slate-100 pt-2">
                            <p className="text-xs text-slate-500 mb-1.5">Raccourcis</p>
                            <div className="flex flex-wrap gap-1">
                                {SEGMENT_PRESETS.map((preset) => {
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
