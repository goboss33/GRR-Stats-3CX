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

import type { CallOrigin } from "@/services/domain/call-classification";

/**
 * Filtre de la colonne « Provenance » — une DEUXIÈME poignée sur le MÊME état
 * que le toggle Externe / Interne / Les deux du header : choisir ici bascule
 * le toggle, et inversement. Un seul état, plusieurs poignées — la colonne ne
 * peut pas faire mentir le header, ni l'inverse.
 */

const OPTIONS: { value: CallOrigin; label: string }[] = [
    { value: "both", label: "Toutes" },
    { value: "external", label: "Externe" },
    { value: "internal", label: "Interne" },
];

interface ColumnFilterProvenanceProps {
    value: CallOrigin;
    onChange: (origin: CallOrigin) => void;
    className?: string;
}

export function ColumnFilterProvenance({
    value,
    onChange,
    className,
}: ColumnFilterProvenanceProps) {
    const [open, setOpen] = React.useState(false);

    const label = OPTIONS.find((o) => o.value === value)?.label ?? "Toutes";

    return (
        <div className={cn("w-full min-w-[80px]", className)}>
            <Popover open={open} onOpenChange={setOpen}>
                <PopoverTrigger asChild>
                    <Button
                        variant="outline"
                        size="sm"
                        className={cn(
                            "h-8 w-full justify-between text-xs font-normal bg-white/80 border-input",
                            value !== "both" && "border-blue-500 bg-blue-50/50",
                        )}
                    >
                        <span className="truncate">{label}</span>
                        <ChevronDown className="ml-1 h-3 w-3 text-slate-500" />
                    </Button>
                </PopoverTrigger>
                <PopoverContent className="w-32 p-1" align="start">
                    {OPTIONS.map((opt) => (
                        <button
                            key={opt.value}
                            type="button"
                            className={cn(
                                "w-full rounded px-2 py-1.5 text-left text-sm hover:bg-slate-100",
                                value === opt.value && "bg-slate-100 font-medium",
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
