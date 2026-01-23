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

import type { CallDirection } from "@/types/logs.types";

interface ColumnFilterDirectionProps {
    selected: CallDirection[];
    onChange: (directions: CallDirection[]) => void;
    className?: string;
}

const directionOptions: { value: CallDirection; label: string }[] = [
    { value: "inbound", label: "Entrant" },
    { value: "outbound", label: "Sortant" },
    { value: "internal", label: "Interne" },
    { value: "bridge", label: "Bridge" },
];

export function ColumnFilterDirection({
    selected,
    onChange,
    className,
}: ColumnFilterDirectionProps) {
    const [open, setOpen] = React.useState(false);
    // Local state to track selections while popover is open
    const [localSelected, setLocalSelected] = React.useState<CallDirection[]>(selected);

    // Sync local state when prop changes (e.g., from external reset)
    React.useEffect(() => {
        if (!open) {
            setLocalSelected(selected);
        }
    }, [selected, open]);

    // Apply changes when popover closes
    const handleOpenChange = (isOpen: boolean) => {
        if (!isOpen && open) {
            // Popover is closing - apply the changes
            const hasChanged =
                localSelected.length !== selected.length ||
                !localSelected.every(d => selected.includes(d));
            if (hasChanged) {
                onChange(localSelected);
            }
        }
        if (isOpen) {
            // Popover is opening - sync local state
            setLocalSelected(selected);
        }
        setOpen(isOpen);
    };

    const handleToggle = (dir: CallDirection, checked: boolean) => {
        if (checked) {
            setLocalSelected([...localSelected, dir]);
        } else {
            setLocalSelected(localSelected.filter((d) => d !== dir));
        }
    };

    const handleSelectAll = () => {
        if (localSelected.length === directionOptions.length) {
            setLocalSelected([]);
        } else {
            setLocalSelected(directionOptions.map((o) => o.value));
        }
    };

    const getLabel = () => {
        if (selected.length === 0 || selected.length === directionOptions.length) {
            return "Tout";
        }
        if (selected.length === 1) {
            return directionOptions.find((o) => o.value === selected[0])?.label;
        }
        return `${selected.length} sél.`;
    };

    const allSelected = localSelected.length === directionOptions.length;

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
                <PopoverContent className="w-40 p-2" align="start">
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
                            {directionOptions.map((opt) => (
                                <div key={opt.value} className="flex items-center gap-2 px-1 py-1">
                                    <Checkbox
                                        id={`col-dir-${opt.value}`}
                                        checked={localSelected.includes(opt.value)}
                                        onCheckedChange={(checked) => handleToggle(opt.value, checked as boolean)}
                                    />
                                    <Label
                                        htmlFor={`col-dir-${opt.value}`}
                                        className="text-sm cursor-pointer flex-1"
                                    >
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

