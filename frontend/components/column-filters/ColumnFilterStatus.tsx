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

const statusOptions: { value: CallStatus; label: string }[] = [
    { value: "answered", label: "Répondu" },
    { value: "missed", label: "Manqué" },
    { value: "abandoned", label: "Abandonné" },
];

export function ColumnFilterStatus({
    selected,
    onChange,
    className,
}: ColumnFilterStatusProps) {
    const [open, setOpen] = React.useState(false);

    const handleToggle = (status: CallStatus, checked: boolean) => {
        if (checked) {
            onChange([...selected, status]);
        } else {
            onChange(selected.filter((s) => s !== status));
        }
    };

    const handleSelectAll = () => {
        if (selected.length === statusOptions.length || selected.length === 0) {
            onChange([]);
        } else {
            onChange(statusOptions.map((o) => o.value));
        }
    };

    const getLabel = () => {
        if (selected.length === 0) {
            return "Tous";
        }
        if (selected.length === 1) {
            return statusOptions.find((o) => o.value === selected[0])?.label;
        }
        return `${selected.length} sél.`;
    };

    const allSelected = selected.length === 0; // Empty = all

    return (
        <div className={cn("w-full min-w-[80px]", className)}>
            <Popover open={open} onOpenChange={setOpen}>
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
                                        checked={selected.includes(opt.value)}
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
