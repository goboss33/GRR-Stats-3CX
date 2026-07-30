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

import { queueOutcomeConfig } from "@/components/logs-table-helpers";
import type { PassageOutcome } from "@/services/domain/call-classification";

/**
 * Filtre de la colonne « Statut dans la file ».
 *
 * Contrairement aux autres filtres de colonne, celui-ci ne restreint pas un
 * champ du tableau : il repasse par le socle de classement côté serveur, donc
 * la requête est rejouée. C'est aussi lui que positionnent les liens des
 * vignettes de statistiques — arriver depuis un KPI revient exactement à
 * cocher une case ici, ce qui rend le filtre lisible et modifiable.
 */
interface ColumnFilterQueueOutcomeProps {
    selected: PassageOutcome[];
    /**
     * Appels directs de l'équipe, sans passage par la file. Ils n'ont pas de
     * statut dans la colonne, mais les vignettes de statistiques les
     * additionnent aux appels de file : sans cette case, impossible de
     * retrouver « Total reçus » depuis les logs.
     */
    includeTeamDirect: boolean;
    onChange: (outcomes: PassageOutcome[], includeTeamDirect: boolean) => void;
    className?: string;
}

const OUTCOME_ORDER: PassageOutcome[] = [
    "answered",
    "overflow",
    "voicemail",
    "short_abandon",
    "abandoned",
];

export function ColumnFilterQueueOutcome({
    selected,
    includeTeamDirect,
    onChange,
    className,
}: ColumnFilterQueueOutcomeProps) {
    const [open, setOpen] = React.useState(false);
    const [localSelected, setLocalSelected] = React.useState<PassageOutcome[]>(selected);
    const [localDirect, setLocalDirect] = React.useState(includeTeamDirect);

    React.useEffect(() => {
        if (!open) {
            setLocalSelected(selected);
            setLocalDirect(includeTeamDirect);
        }
    }, [selected, includeTeamDirect, open]);

    // Les changements ne sont appliqués qu'à la fermeture : cocher trois cases
    // ne doit pas déclencher trois requêtes.
    const handleOpenChange = (isOpen: boolean) => {
        if (!isOpen && open) {
            const hasChanged =
                localSelected.length !== selected.length ||
                !localSelected.every((o) => selected.includes(o)) ||
                localDirect !== includeTeamDirect;
            if (hasChanged) onChange(localSelected, localDirect);
        }
        if (isOpen) {
            setLocalSelected(selected);
            setLocalDirect(includeTeamDirect);
        }
        setOpen(isOpen);
    };

    const handleToggle = (outcome: PassageOutcome, checked: boolean) => {
        setLocalSelected(
            checked
                ? [...localSelected, outcome]
                : localSelected.filter((o) => o !== outcome),
        );
    };

    const handleSelectAll = () => {
        setLocalSelected([]);
        setLocalDirect(false);
    };

    const getLabel = () => {
        const count = selected.length + (includeTeamDirect ? 1 : 0);
        if (count === 0) return "Tous";
        if (count === 1) {
            return selected.length === 1 ? queueOutcomeConfig[selected[0]].label : "Directs";
        }
        return `${count} sél.`;
    };

    const active = selected.length > 0 || includeTeamDirect;
    const allSelected = localSelected.length === 0 && !localDirect;

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
                            {OUTCOME_ORDER.map((outcome) => (
                                <div key={outcome} className="flex items-center gap-2 px-1 py-1">
                                    <Checkbox
                                        id={`col-queue-outcome-${outcome}`}
                                        checked={localSelected.includes(outcome)}
                                        onCheckedChange={(checked) => handleToggle(outcome, checked as boolean)}
                                    />
                                    <Label
                                        htmlFor={`col-queue-outcome-${outcome}`}
                                        className="text-sm cursor-pointer flex-1"
                                    >
                                        {queueOutcomeConfig[outcome].label}
                                    </Label>
                                </div>
                            ))}
                        </div>

                        {/* Les appels directs de l'équipe n'ont pas de statut
                            dans la file, mais entrent dans les vignettes de
                            statistiques. Tout cocher redonne « Total reçus ». */}
                        <div className="border-t border-slate-100 pt-1">
                            <div className="flex items-center gap-2 px-1 py-1">
                                <Checkbox
                                    id="col-queue-outcome-team-direct"
                                    checked={localDirect}
                                    onCheckedChange={(checked) => setLocalDirect(checked as boolean)}
                                />
                                <Label
                                    htmlFor="col-queue-outcome-team-direct"
                                    className="text-sm cursor-pointer flex-1"
                                >
                                    Directs de l&apos;équipe
                                </Label>
                            </div>
                        </div>
                    </div>
                </PopoverContent>
            </Popover>
        </div>
    );
}
