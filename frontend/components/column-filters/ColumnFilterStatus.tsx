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

import type { CallStatus } from "@/types/logs.types";

interface ColumnFilterStatusProps {
    selected: CallStatus[];
    onChange: (statuses: CallStatus[]) => void;
    className?: string;
}

/**
 * Trois choix, comme le tableau. « Perdu » recouvre les manqués et les occupés ;
 * la messagerie garde sa case, elle ne dit pas la même chose qu'un abandon.
 */
const statusOptions: { value: CallStatus; label: string; covers: CallStatus[] }[] = [
    { value: "answered", label: "Répondu", covers: ["answered"] },
    { value: "missed", label: "Perdu", covers: ["missed", "busy"] },
    { value: "voicemail", label: "Messagerie", covers: ["voicemail"] },
];

export function ColumnFilterStatus({
    selected,
    onChange,
    className,
}: ColumnFilterStatusProps) {
    const [open, setOpen] = React.useState(false);
    // Local state to track selections while popover is open
    const [localSelected, setLocalSelected] = React.useState<CallStatus[]>(selected);

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
                !localSelected.every(s => selected.includes(s));
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

    const handleToggle = (status: CallStatus, checked: boolean) => {
        const covers = statusOptions.find((o) => o.value === status)?.covers ?? [status];
        setLocalSelected(
            checked
                ? [...new Set([...localSelected, ...covers])]
                : localSelected.filter((s) => !covers.includes(s)),
        );
    };

    const handleSelectAll = () => {
        if (localSelected.length === statusOptions.length || localSelected.length === 0) {
            setLocalSelected([]);
        } else {
            setLocalSelected(statusOptions.flatMap((o) => o.covers));
        }
    };

    const getLabel = () => {
        if (selected.length === 0) {
            return "Tous";
        }
        const buckets = statusOptions.filter((o) => o.covers.every((c) => selected.includes(c)));
        if (buckets.length === 1) return buckets[0].label;
        return `${buckets.length || selected.length} sél.`;
    };

    const allSelected = localSelected.length === 0; // Empty = all

    return (
        <div className={cn("w-full min-w-[80px]", className)}>
            <Popover open={open} onOpenChange={handleOpenChange}>
                <PopoverTrigger asChild>
                    <Button
                        variant="outline"
                        size="sm"
                        className={cn(
                            "h-8 w-full justify-between text-xs font-normal bg-white/80 border-input",
                            selected.length > 0 && "border-blue-500 bg-blue-50/50"
                        )}
                    >
                        <span className="truncate">{getLabel()}</span>
                        <ChevronDown className="ml-1 h-3 w-3 text-slate-500" />
                    </Button>
                </PopoverTrigger>
                <PopoverContent className="w-36 p-2" align="start">
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
                            <span className="text-sm font-medium">Tous</span>
                        </div>

                        <div className="border-t border-slate-100 pt-1">
                            {statusOptions.map((opt) => (
                                <div key={opt.value} className="flex items-center gap-2 px-1 py-1">
                                    <Checkbox
                                        id={`col-status-${opt.value}`}
                                        checked={opt.covers.every((c) => localSelected.includes(c))}
                                        onCheckedChange={(checked) => handleToggle(opt.value, checked as boolean)}
                                    />
                                    <Label
                                        htmlFor={`col-status-${opt.value}`}
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

