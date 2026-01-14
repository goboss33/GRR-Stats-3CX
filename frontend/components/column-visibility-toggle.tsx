"use client";

import { Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuCheckboxItem,
    DropdownMenuTrigger,
    DropdownMenuLabel,
    DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import type { ColumnVisibility } from "@/types/logs.types";

interface ColumnVisibilityToggleProps {
    visibility: ColumnVisibility;
    onChange: (visibility: ColumnVisibility) => void;
}

const columnLabels: Record<keyof ColumnVisibility, string> = {
    callHistoryId: "ID Chaîne",
    trunkDid: "Trunk DID",
    ringDuration: "Temps de sonnerie",
    terminationReason: "Raison fin",
};

export function ColumnVisibilityToggle({
    visibility,
    onChange,
}: ColumnVisibilityToggleProps) {
    const handleToggle = (key: keyof ColumnVisibility) => {
        onChange({ ...visibility, [key]: !visibility[key] });
    };

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                    <Settings2 className="h-4 w-4 mr-2" />
                    Colonnes
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuLabel>Colonnes visibles</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {(Object.keys(columnLabels) as (keyof ColumnVisibility)[]).map((key) => (
                    <DropdownMenuCheckboxItem
                        key={key}
                        checked={visibility[key]}
                        onCheckedChange={() => handleToggle(key)}
                    >
                        {columnLabels[key]}
                    </DropdownMenuCheckboxItem>
                ))}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
