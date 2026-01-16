"use client";

import * as React from "react";
import { Info, X, Check } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";

// 3CX Termination Reasons with explanations
export const TERMINATION_REASONS = {
    "src_partic": {
        label: "Raccroché par l'appelant",
        short: "Appelant",
        description: "L'appelant a raccroché le téléphone",
    },
    "dst_partic": {
        label: "Raccroché par l'appelé",
        short: "Appelé",
        description: "Le destinataire a raccroché le téléphone",
    },
    "redirected": {
        label: "Transféré/Renvoyé",
        short: "Transféré",
        description: "L'appel a été transféré ou renvoyé vers une autre destination",
    },
    "timeout": {
        label: "Délai dépassé",
        short: "Timeout",
        description: "L'appel n'a pas été répondu dans le délai imparti",
    },
    "voicemail": {
        label: "Messagerie vocale",
        short: "Vmail",
        description: "L'appel a été dirigé vers la messagerie vocale",
    },
    "busy": {
        label: "Occupé",
        short: "Occupé",
        description: "Le destinataire était en ligne ou a refusé l'appel",
    },
    "failed": {
        label: "Échec",
        short: "Échec",
        description: "L'appel n'a pas pu aboutir (erreur technique)",
    },
    "no_answer": {
        label: "Pas de réponse",
        short: "Non répondu",
        description: "L'appel a sonné mais personne n'a décroché",
    },
    "cancelled": {
        label: "Annulé",
        short: "Annulé",
        description: "L'appelant a raccroché avant que l'appel soit établi",
    },
} as const;

export type TerminationReasonKey = keyof typeof TERMINATION_REASONS;

interface ColumnFilterTerminationReasonProps {
    selected: string[];
    onChange: (reasons: string[]) => void;
    className?: string;
}

// Tooltip component showing all reasons
export function TerminationReasonTooltip() {
    return (
        <TooltipProvider delayDuration={200}>
            <Tooltip>
                <TooltipTrigger asChild>
                    <Info className="h-3.5 w-3.5 text-slate-400 hover:text-slate-600 cursor-help" />
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-xs p-3">
                    <p className="font-medium mb-2">Codes de terminaison :</p>
                    <ul className="space-y-1.5 text-xs">
                        {Object.entries(TERMINATION_REASONS).map(([key, value]) => (
                            <li key={key} className="flex gap-2">
                                <code className="text-primary font-mono bg-slate-100 px-1 rounded">
                                    {key}
                                </code>
                                <span className="text-slate-600">{value.description}</span>
                            </li>
                        ))}
                    </ul>
                </TooltipContent>
            </Tooltip>
        </TooltipProvider>
    );
}

export function ColumnFilterTerminationReason({
    selected,
    onChange,
    className,
}: ColumnFilterTerminationReasonProps) {
    const [open, setOpen] = React.useState(false);

    const allReasons = Object.keys(TERMINATION_REASONS) as TerminationReasonKey[];
    const hasFilter = selected.length > 0 && selected.length < allReasons.length;

    const handleToggle = (reason: string) => {
        if (selected.includes(reason)) {
            onChange(selected.filter(r => r !== reason));
        } else {
            onChange([...selected, reason]);
        }
    };

    const handleSelectAll = () => {
        onChange([]);
    };

    const handleClear = () => {
        onChange([]);
    };

    const getLabel = () => {
        if (selected.length === 0 || selected.length === allReasons.length) return "Raison";
        if (selected.length === 1) {
            const reason = TERMINATION_REASONS[selected[0] as TerminationReasonKey];
            return reason?.short || selected[0];
        }
        return `${selected.length} sélectionnés`;
    };

    return (
        <div className={cn("w-full min-w-[80px]", className)}>
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
                        <span className="truncate">{getLabel()}</span>
                    </Button>
                </PopoverTrigger>
                <PopoverContent className="w-64 p-3" align="start">
                    <div className="space-y-2">
                        <div className="flex items-center justify-between">
                            <span className="text-sm font-medium">Raison terminaison</span>
                            {hasFilter && (
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={handleClear}
                                    className="h-6 px-2 text-xs"
                                >
                                    <X className="h-3 w-3 mr-1" />
                                    Tout
                                </Button>
                            )}
                        </div>

                        {/* Checkboxes */}
                        <div className="space-y-1 max-h-60 overflow-y-auto">
                            {allReasons.map((reason) => {
                                const config = TERMINATION_REASONS[reason];
                                const isChecked = selected.length === 0 || selected.includes(reason);
                                return (
                                    <label
                                        key={reason}
                                        className="flex items-center gap-2 p-1.5 rounded hover:bg-slate-50 cursor-pointer"
                                    >
                                        <Checkbox
                                            checked={isChecked}
                                            onCheckedChange={() => {
                                                if (selected.length === 0) {
                                                    // First selection: select only this one
                                                    onChange([reason]);
                                                } else {
                                                    handleToggle(reason);
                                                }
                                            }}
                                        />
                                        <div className="flex-1 min-w-0">
                                            <div className="text-xs font-medium">{config.label}</div>
                                            <div className="text-[10px] text-slate-500 truncate">
                                                {config.description}
                                            </div>
                                        </div>
                                    </label>
                                );
                            })}
                        </div>

                        {/* Select all button */}
                        <div className="border-t border-slate-100 pt-2">
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={handleSelectAll}
                                className="h-7 w-full text-xs"
                            >
                                <Check className="h-3 w-3 mr-1" />
                                Tout sélectionner
                            </Button>
                        </div>
                    </div>
                </PopoverContent>
            </Popover>
        </div>
    );
}
