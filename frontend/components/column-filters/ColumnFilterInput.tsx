"use client";

import * as React from "react";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface ColumnFilterInputProps {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    className?: string;
}

export function ColumnFilterInput({
    value,
    onChange,
    placeholder = "Rechercher...",
    className,
}: ColumnFilterInputProps) {
    return (
        <div className={cn("relative w-full min-w-[120px]", className)}>
            <Input
                type="text"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder={placeholder}
                className="h-8 text-xs pr-7 bg-white/80"
            />
            {value && (
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => onChange("")}
                    className="absolute right-0 top-0 h-8 w-7 p-0 hover:bg-transparent"
                >
                    <X className="h-3 w-3 text-slate-400 hover:text-slate-600" />
                </Button>
            )}
        </div>
    );
}
