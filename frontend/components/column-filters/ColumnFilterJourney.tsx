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

import type { JourneyStepType } from "@/types/logs.types";

interface ColumnFilterJourneyProps {
    selected: JourneyStepType[];
    onChange: (types: JourneyStepType[]) => void;
    className?: string;
}

const journeyOptions: { value: JourneyStepType; label: string; icon: string }[] = [
    { value: "direct", label: "Direct", icon: "📞" },
    { value: "queue", label: "Queue", icon: "🔄" },
    { value: "transfer", label: "Transfert", icon: "↗️" },
    { value: "ring_group", label: "Ring Group", icon: "👥" },
    { value: "ivr", label: "IVR", icon: "🤖" },
];

export function ColumnFilterJourney({
    selected,
    onChange,
    className,
}: ColumnFilterJourneyProps) {
    const [open, setOpen] = React.useState(false);
    const [localSelected, setLocalSelected] = React.useState<JourneyStepType[]>(selected);

    React.useEffect(() => {
        if (!open) {
            setLocalSelected(selected);
        }
    }, [selected, open]);

    const handleOpenChange = (isOpen: boolean) => {
        if (!isOpen && open) {
            const hasChanged =
                localSelected.length !== selected.length ||
                !localSelected.every(t => selected.includes(t));
            if (hasChanged) {
                onChange(localSelected);
            }
        }
        if (isOpen) {
            setLocalSelected(selected);
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
                <PopoverContent className="w-44 p-2" align="start">
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
                    </div>
                </PopoverContent>
            </Popover>
        </div>
    );
}
