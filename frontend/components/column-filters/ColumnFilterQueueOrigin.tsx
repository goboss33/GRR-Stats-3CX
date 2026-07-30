"use client";

import * as React from "react";
import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";

/**
 * Filtre de la colonne « Origine » de la vue file : l'appel est-il arrivé par
 * la file, ou en direct chez un agent de l'équipe ?
 *
 * Les deux origines forment une partition de la population de l'équipe — c'est
 * la décomposition « File : 72 · Directs : 1157 » des vignettes — donc un choix
 * exclusif plutôt que des cases à cocher.
 */
export type QueueOrigin = "queue" | "direct";

interface ColumnFilterQueueOriginProps {
    selected: QueueOrigin | null;
    onChange: (origin: QueueOrigin | null) => void;
    className?: string;
}

const OPTIONS: { value: QueueOrigin | null; label: string }[] = [
    { value: null, label: "Toutes" },
    { value: "queue", label: "File" },
    { value: "direct", label: "Direct" },
];

export function ColumnFilterQueueOrigin({
    selected,
    onChange,
    className,
}: ColumnFilterQueueOriginProps) {
    const [open, setOpen] = React.useState(false);

    const label = OPTIONS.find((o) => o.value === selected)?.label ?? "Toutes";

    return (
        <div className={cn("w-full min-w-[70px]", className)}>
            <Popover open={open} onOpenChange={setOpen}>
                <PopoverTrigger asChild>
                    <Button
                        variant="outline"
                        size="sm"
                        className={cn(
                            "h-8 w-full justify-between text-xs font-normal bg-white/80 border-input",
                            selected && "border-blue-500 bg-blue-50/50",
                        )}
                    >
                        <span className="truncate">{label}</span>
                        <ChevronDown className="ml-1 h-3 w-3 text-slate-500" />
                    </Button>
                </PopoverTrigger>
                <PopoverContent className="w-32 p-1" align="start">
                    {OPTIONS.map((opt) => (
                        <button
                            key={opt.label}
                            type="button"
                            className={cn(
                                "w-full rounded px-2 py-1.5 text-left text-sm hover:bg-slate-100",
                                selected === opt.value && "bg-slate-100 font-medium",
                            )}
                            onClick={() => {
                                onChange(opt.value);
                                setOpen(false);
                            }}
                        >
                            {opt.label}
                        </button>
                    ))}
                </PopoverContent>
            </Popover>
        </div>
    );
}
