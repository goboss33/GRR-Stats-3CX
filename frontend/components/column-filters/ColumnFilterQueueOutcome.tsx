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

import type { KpiBucket } from "@/services/domain/call-classification";

/**
 * Filtre de la colonne « Statut dans la file ».
 *
 * Contrairement aux autres filtres de colonne, celui-ci ne restreint pas un
 * champ du tableau : il repasse par le socle de classement côté serveur, donc
 * la requête est rejouée. C'est aussi lui que positionnent les liens des
 * vignettes de statistiques — arriver depuis un KPI revient exactement à
 * cocher une case ici, ce qui rend le filtre lisible et modifiable.
 */
type Bucket = Exclude<KpiBucket, "received">;

interface ColumnFilterQueueOutcomeProps {
    selected: Bucket[];
    onChange: (buckets: Bucket[]) => void;
    className?: string;
}

/** Mêmes trois catégories que les vignettes du bilan d'équipe. */
const BUCKETS: { value: Bucket; label: string }[] = [
    { value: "answered", label: "Répondu" },
    { value: "lost", label: "Perdu" },
    { value: "overflow", label: "Redirigé" },
];

export function ColumnFilterQueueOutcome({
    selected,
    onChange,
    className,
}: ColumnFilterQueueOutcomeProps) {
    const [open, setOpen] = React.useState(false);
    const [localSelected, setLocalSelected] = React.useState<Bucket[]>(selected);

    React.useEffect(() => {
        if (!open) setLocalSelected(selected);
    }, [selected, open]);

    // Les changements ne sont appliqués qu'à la fermeture : cocher trois cases
    // ne doit pas déclencher trois requêtes.
    const handleOpenChange = (isOpen: boolean) => {
        if (!isOpen && open) {
            const hasChanged =
                localSelected.length !== selected.length ||
                !localSelected.every((o) => selected.includes(o));
            if (hasChanged) onChange(localSelected);
        }
        if (isOpen) setLocalSelected(selected);
        setOpen(isOpen);
    };

    const handleToggle = (outcome: Bucket, checked: boolean) => {
        setLocalSelected(
            checked
                ? [...localSelected, outcome]
                : localSelected.filter((o) => o !== outcome),
        );
    };

    const handleSelectAll = () => setLocalSelected([]);

    const getLabel = () => {
        if (selected.length === 0) return "Tous";
        if (selected.length === 1) return BUCKETS.find((b) => b.value === selected[0])?.label;
        return `${selected.length} sél.`;
    };

    const active = selected.length > 0;
    const allSelected = localSelected.length === 0;

    return (
        <div className={cn("w-full min-w-[80px]", className)}>
            <Popover open={open} onOpenChange={handleOpenChange}>
                <PopoverTrigger asChild>
                    <Button
                        variant="outline"
                        size="sm"
                        className={cn(
                            "h-8 w-full justify-between text-xs font-normal bg-white/80 border-input",
                            active && "border-blue-500 bg-blue-50/50",
                        )}
                    >
                        <span className="truncate">{getLabel()}</span>
                        <ChevronDown className="ml-1 h-3 w-3 text-slate-500" />
                    </Button>
                </PopoverTrigger>
                <PopoverContent className="w-44 p-2" align="start">
                    <div className="space-y-2">
                        <div
                            className="flex items-center gap-2 px-1 py-1 hover:bg-slate-100 rounded cursor-pointer"
                            onClick={handleSelectAll}
                        >
                            <div className={cn(
                                "flex h-4 w-4 items-center justify-center rounded border",
                                allSelected ? "bg-primary border-primary text-primary-foreground" : "border-input",
                            )}>
                                {allSelected && <Check className="h-3 w-3" />}
                            </div>
                            <span className="text-sm font-medium">Tous</span>
                        </div>

                        <div className="border-t border-slate-100 pt-1">
                            {BUCKETS.map((bucket) => (
                                <div key={bucket.value} className="flex items-center gap-2 px-1 py-1">
                                    <Checkbox
                                        id={`col-queue-outcome-${bucket.value}`}
                                        checked={localSelected.includes(bucket.value)}
                                        onCheckedChange={(checked) => handleToggle(bucket.value, checked as boolean)}
                                    />
                                    <Label
                                        htmlFor={`col-queue-outcome-${bucket.value}`}
                                        className="text-sm cursor-pointer flex-1"
                                    >
                                        {bucket.label}
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
