"use client";

import * as React from "react";
import { ChevronDown, Check } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";

import type { JourneyStepType, JourneyMatchMode } from "@/types/logs.types";

interface ColumnFilterJourneyProps {
    selected: JourneyStepType[];
    onChange: (types: JourneyStepType[]) => void;
    matchMode: JourneyMatchMode;
    onMatchModeChange: (mode: JourneyMatchMode) => void;
    className?: string;
}

const journeyOptions: { value: JourneyStepType; label: string; icon: string }[] = [
    { value: "direct", label: "Direct", icon: "📞" },
    { value: "queue", label: "Queue", icon: "👥" },
    { value: "voicemail", label: "Messagerie", icon: "📫" },
];

export function ColumnFilterJourney({
    selected,
    onChange,
    matchMode,
    onMatchModeChange,
    className,
}: ColumnFilterJourneyProps) {
    const [open, setOpen] = React.useState(false);
    const [localSelected, setLocalSelected] = React.useState<JourneyStepType[]>(selected);
    const [localMatchMode, setLocalMatchMode] = React.useState<JourneyMatchMode>(matchMode);

    React.useEffect(() => {
        if (!open) {
            setLocalSelected(selected);
            setLocalMatchMode(matchMode);
        }
    }, [selected, matchMode, open]);

    const handleOpenChange = (isOpen: boolean) => {
        if (!isOpen && open) {
            const hasTypesChanged =
                localSelected.length !== selected.length ||
                !localSelected.every(t => selected.includes(t));
            const hasModeChanged = localMatchMode !== matchMode;
            if (hasTypesChanged) {
                onChange(localSelected);
            }
            if (hasModeChanged) {
                onMatchModeChange(localMatchMode);
            }
        }
        if (isOpen) {
            setLocalSelected(selected);
            setLocalMatchMode(matchMode);
        }
        setOpen(isOpen);
    };

    const handleToggle = (type: JourneyStepType, checked: boolean) => {
        if (checked) {
            setLocalSelected([...localSelected, type]);
        } else {
            setLocalSelected(localSelected.filter((t) => t !== type));
        }
    };

    const handleSelectAll = () => {
        if (localSelected.length === journeyOptions.length || localSelected.length === 0) {
            setLocalSelected([]);
        } else {
            setLocalSelected(journeyOptions.map((o) => o.value));
        }
    };

    const getLabel = () => {
        if (selected.length === 0) {
            return "Tout";
        }
        if (selected.length === 1) {
            const opt = journeyOptions.find((o) => o.value === selected[0]);
            return opt ? `${opt.icon} ${opt.label}` : "1 sél.";
        }
        return `${selected.length} sél.`;
    };

    const allSelected = localSelected.length === 0;

    return (
        <div className={cn("w-full min-w-[90px]", className)}>
            <Popover open={open} onOpenChange={handleOpenChange}>
                <PopoverTrigger asChild>
                    <Button
                        variant="outline"
                        size="sm"
                        className="h-8 w-full justify-between text-xs font-normal bg-white/80 border-input"
                    >
                        <span className="truncate">{getLabel()}</span>
                        <ChevronDown className="ml-1 h-3 w-3 text-slate-500" />
                    </Button>
                </PopoverTrigger>
                <PopoverContent className="w-48 p-2" align="start">
                    <div className="space-y-2">
                        {/* Select All */}
                        <div
                            className="flex items-center gap-2 px-1 py-1 hover:bg-slate-100 rounded cursor-pointer"
                            onClick={handleSelectAll}
                        >
                            <div className={cn(
                                "flex h-4 w-4 items-center justify-center rounded border",
                                allSelected ? "bg-primary border-primary text-primary-foreground" : "border-input"
                            )}>
                                {allSelected && <Check className="h-3 w-3" />}
                            </div>
                            <span className="text-sm font-medium">Tout</span>
                        </div>

                        <div className="border-t border-slate-100 pt-1">
                            {journeyOptions.map((opt) => (
                                <div key={opt.value} className="flex items-center gap-2 px-1 py-1">
                                    <Checkbox
                                        id={`col-journey-${opt.value}`}
                                        checked={localSelected.includes(opt.value)}
                                        onCheckedChange={(checked) => handleToggle(opt.value, checked as boolean)}
                                    />
                                    <Label
                                        htmlFor={`col-journey-${opt.value}`}
                                        className="text-sm cursor-pointer flex-1"
                                    >
                                        <span className="mr-1">{opt.icon}</span>
                                        {opt.label}
                                    </Label>
                                </div>
                            ))}
                        </div>

                        {/* OU/ET toggle - only show when multiple types selected */}
                        {localSelected.length >= 2 && (
                            <div className="border-t border-slate-100 pt-2">
                                <div className="flex items-center justify-between px-1">
                                    <span className="text-xs text-slate-500">Mode :</span>
                                    <div className="flex rounded-md border border-slate-200 overflow-hidden">
                                        <button
                                            type="button"
                                            className={cn(
                                                "px-2.5 py-1 text-xs font-medium transition-colors",
                                                localMatchMode === "or"
                                                    ? "bg-blue-500 text-white"
                                                    : "bg-white text-slate-600 hover:bg-slate-50"
                                            )}
                                            onClick={() => setLocalMatchMode("or")}
                                        >
                                            OU
                                        </button>
                                        <button
                                            type="button"
                                            className={cn(
                                                "px-2.5 py-1 text-xs font-medium transition-colors border-l border-slate-200",
                                                localMatchMode === "and"
                                                    ? "bg-blue-500 text-white"
                                                    : "bg-white text-slate-600 hover:bg-slate-50"
                                            )}
                                            onClick={() => setLocalMatchMode("and")}
                                        >
                                            ET
                                        </button>
                                    </div>
                                </div>
                                <p className="text-[10px] text-slate-400 px-1 mt-1">
                                    {localMatchMode === "or"
                                        ? "Au moins un type sélectionné"
                                        : "Tous les types sélectionnés"}
                                </p>
                            </div>
                        )}
                    </div>
                </PopoverContent>
            </Popover>
        </div>
    );
}
