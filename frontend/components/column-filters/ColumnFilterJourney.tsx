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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { QueueAgentPicker } from "@/components/queue-agent-picker";

import type { JourneyStepType, JourneyMatchMode } from "@/types/logs.types";
import type { QueueInfo } from "@/types/queues.types";

// Queue-specific result types for UI
type QueueResultType = "answered" | "abandoned" | "redirected";

interface ColumnFilterJourneyProps {
    selected: JourneyStepType[];
    onChange: (types: JourneyStepType[]) => void;
    matchMode: JourneyMatchMode;
    onMatchModeChange: (mode: JourneyMatchMode) => void;
    // Queue-specific filters (new)
    queues?: QueueInfo[];
    queueNumber?: string | null;
    onQueueNumberChange?: (queueNumber: string | null) => void;
    queueResults?: QueueResultType[];
    onQueueResultsChange?: (results: QueueResultType[]) => void;
    // Multi-passage filter (Method N°2)
    multiPassageSameQueue?: boolean;
    onMultiPassageSameQueueChange?: (enabled: boolean) => void;
    className?: string;
}

const journeyOptions: { value: JourneyStepType; label: string; icon: string }[] = [
    { value: "direct", label: "Direct", icon: "📞" },
    { value: "queue", label: "Queue", icon: "👥" },
    { value: "voicemail", label: "Messagerie", icon: "📫" },
];

const queueResultOptions: { value: QueueResultType; label: string; color: string }[] = [
    { value: "answered", label: "Répondu", color: "text-emerald-700" },
    { value: "abandoned", label: "Abandonné", color: "text-red-700" },
    { value: "redirected", label: "Redirigé", color: "text-amber-700" },
];

export function ColumnFilterJourney({
    selected,
    onChange,
    matchMode,
    onMatchModeChange,
    queues,
    queueNumber,
    onQueueNumberChange,
    queueResults,
    onQueueResultsChange,
    multiPassageSameQueue,
    onMultiPassageSameQueueChange,
    className,
}: ColumnFilterJourneyProps) {
    const [open, setOpen] = React.useState(false);
    const [localSelected, setLocalSelected] = React.useState<JourneyStepType[]>(selected);
    const [localMatchMode, setLocalMatchMode] = React.useState<JourneyMatchMode>(matchMode);
    const [localQueueNumber, setLocalQueueNumber] = React.useState<string | null>(queueNumber ?? null);
    const [localQueueResults, setLocalQueueResults] = React.useState<QueueResultType[]>(queueResults ?? []);
    const [localMultiPassage, setLocalMultiPassage] = React.useState<boolean>(multiPassageSameQueue ?? false);

    // Radio group state for passage filter (all/first/multi)
    const [localPassageFilter, setLocalPassageFilter] = React.useState<"all" | "first" | "multi">(() => {
        if (multiPassageSameQueue === true) return "multi";
        if (multiPassageSameQueue === false) return "first";
        return "all";
    });

    React.useEffect(() => {
        if (!open) {
            setLocalSelected(selected);
            setLocalMatchMode(matchMode);
            setLocalQueueNumber(queueNumber ?? null);
            setLocalQueueResults(queueResults ?? []);
            setLocalMultiPassage(multiPassageSameQueue ?? false);
            setLocalPassageFilter(
                multiPassageSameQueue === true ? "multi" :
                multiPassageSameQueue === false ? "first" :
                "all"
            );
        }
    }, [selected, matchMode, queueNumber, queueResults, multiPassageSameQueue, open]);

    const handleOpenChange = (isOpen: boolean) => {
        if (!isOpen && open) {
            // Commit changes on close
            const hasTypesChanged =
                localSelected.length !== selected.length ||
                !localSelected.every(t => selected.includes(t));
            const hasModeChanged = localMatchMode !== matchMode;
            const hasQueueNumberChanged = localQueueNumber !== (queueNumber ?? null);
            const hasQueueResultsChanged =
                (localQueueResults ?? []).length !== (queueResults ?? []).length ||
                !(localQueueResults ?? []).every(r => (queueResults ?? []).includes(r));

            // Check if passage filter (radio group) has changed
            const hasPassageFilterChanged = (() => {
                const currentValue = multiPassageSameQueue === true ? "multi" :
                                    multiPassageSameQueue === false ? "first" : "all";
                return localPassageFilter !== currentValue;
            })();

            if (hasTypesChanged) {
                onChange(localSelected);
            }
            if (hasModeChanged) {
                onMatchModeChange(localMatchMode);
            }
            if (hasQueueNumberChanged && onQueueNumberChange) {
                onQueueNumberChange(localQueueNumber);
            }
            if (hasQueueResultsChanged && onQueueResultsChange) {
                onQueueResultsChange(localQueueResults);
            }
            if (hasPassageFilterChanged && onMultiPassageSameQueueChange) {
                const newValue = localPassageFilter === "multi" ? true :
                                localPassageFilter === "first" ? false :
                                undefined;
                onMultiPassageSameQueueChange(newValue);
            }
        }
        if (isOpen) {
            setLocalSelected(selected);
            setLocalMatchMode(matchMode);
            setLocalQueueNumber(queueNumber ?? null);
            setLocalQueueResults(queueResults ?? []);
            setLocalMultiPassage(multiPassageSameQueue ?? false);
            setLocalPassageFilter(
                multiPassageSameQueue === true ? "multi" :
                multiPassageSameQueue === false ? "first" :
                "all"
            );
        }
        setOpen(isOpen);
    };

    const handleToggle = (type: JourneyStepType, checked: boolean) => {
        if (checked) {
            setLocalSelected([...localSelected, type]);
        } else {
            setLocalSelected(localSelected.filter((t) => t !== type));
        }
    };

    const handleSelectAll = () => {
        if (localSelected.length === journeyOptions.length || localSelected.length === 0) {
            setLocalSelected([]);
        } else {
            setLocalSelected(journeyOptions.map((o) => o.value));
        }
    };

    const getLabel = () => {
        // Check if ANY filter is active (not just journey types)
        const hasJourneyTypeFilter = selected.length > 0;
        const hasQueueFilter = queueNumber !== null && queueNumber !== undefined;
        const hasResultFilter = queueResults && queueResults.length > 0;
        const hasPassageFilter = multiPassageSameQueue !== undefined;

        // If queue-specific filters are active, show custom label
        if (hasQueueFilter || hasResultFilter || hasPassageFilter) {
            const parts: string[] = [];

            if (hasQueueFilter) {
                parts.push(`Q${queueNumber}`);
            }

            if (hasResultFilter) {
                parts.push(`${queueResults.length} rés.`);
            }

            if (hasPassageFilter) {
                const passageLabel = multiPassageSameQueue === true ? 'Multi' :
                                    multiPassageSameQueue === false ? 'Premier' : '';
                if (passageLabel) parts.push(passageLabel);
            }

            return parts.length > 0 ? parts.join(' • ') : "Filtré";
        }

        // Otherwise, show journey type label (existing logic)
        if (!hasJourneyTypeFilter) {
            return "Tout";
        }
        if (selected.length === 1) {
            const opt = journeyOptions.find((o) => o.value === selected[0]);
            return opt ? `${opt.icon} ${opt.label}` : "1 sél.";
        }
        return `${selected.length} sél.`;
    };

    const allSelected = localSelected.length === 0;

    return (
        <div className={cn("w-full min-w-[90px]", className)}>
            <Popover open={open} onOpenChange={handleOpenChange}>
                <PopoverTrigger asChild>
                    <Button
                        variant="outline"
                        size="sm"
                        className={cn(
                            "h-8 w-full justify-between text-xs font-normal bg-white/80 border-input",
                            // Visual highlighting when filter is active
                            (selected.length > 0 || queueNumber || (queueResults && queueResults.length > 0) || multiPassageSameQueue !== undefined) &&
                                "ring-2 ring-blue-500 ring-offset-1 border-blue-500"
                        )}
                    >
                        <span className="truncate">{getLabel()}</span>
                        <ChevronDown className="ml-1 h-3 w-3 text-slate-500" />
                    </Button>
                </PopoverTrigger>
                <PopoverContent className="w-48 p-2" align="start">
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
                            {journeyOptions.map((opt) => (
                                <div key={opt.value} className="flex items-center gap-2 px-1 py-1">
                                    <Checkbox
                                        id={`col-journey-${opt.value}`}
                                        checked={localSelected.includes(opt.value)}
                                        onCheckedChange={(checked) => handleToggle(opt.value, checked as boolean)}
                                    />
                                    <Label
                                        htmlFor={`col-journey-${opt.value}`}
                                        className="text-sm cursor-pointer flex-1"
                                    >
                                        <span className="mr-1">{opt.icon}</span>
                                        {opt.label}
                                    </Label>
                                </div>
                            ))}
                        </div>

                        {/* Queue-specific filters - only show when Queue is selected */}
                        {localSelected.includes("queue") && queues && onQueueNumberChange && onQueueResultsChange && (
                            <div className="border-t border-slate-100 pt-2 space-y-2">
                                <div className="px-1">
                                    <Label className="text-xs text-slate-500 mb-1.5 block">Queue :</Label>
                                    <QueueAgentPicker
                                        queues={queues}
                                        agents={[]}
                                        selectedItem={localQueueNumber ? {
                                            type: 'queue' as const,
                                            queueNumber: localQueueNumber,
                                            queueName: queues.find(q => q.number === localQueueNumber)?.name || localQueueNumber
                                        } : null}
                                        onSelect={(item) => {
                                            if (item && item.type === 'queue') {
                                                setLocalQueueNumber(item.queueNumber);
                                            } else {
                                                setLocalQueueNumber(null);
                                            }
                                        }}
                                        show="queues"
                                        size="compact"
                                        placeholder="Toutes les queues"
                                    />
                                </div>

                                {localQueueNumber && (
                                    <div className="px-1">
                                        <Label className="text-xs text-slate-500 mb-1.5 block">Résultat :</Label>
                                        <div className="space-y-1">
                                            {queueResultOptions.map((opt) => (
                                                <div key={opt.value} className="flex items-center gap-2">
                                                    <Checkbox
                                                        id={`queue-result-${opt.value}`}
                                                        checked={localQueueResults.includes(opt.value)}
                                                        onCheckedChange={(checked) => {
                                                            if (checked) {
                                                                setLocalQueueResults([...localQueueResults, opt.value]);
                                                            } else {
                                                                setLocalQueueResults(localQueueResults.filter(r => r !== opt.value));
                                                            }
                                                        }}
                                                    />
                                                    <Label
                                                        htmlFor={`queue-result-${opt.value}`}
                                                        className={cn("text-sm cursor-pointer flex-1 font-medium", opt.color)}
                                                    >
                                                        {opt.label}
                                                    </Label>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* Multi-passage filter (Method N°2) - Radio group for passage filtering */}
                                {localQueueNumber && onMultiPassageSameQueueChange && (
                                    <div className="px-1 mt-3 pt-2 border-t border-slate-200">
                                        <Label className="text-xs text-slate-500 mb-1.5 block">Filtre de passage :</Label>
                                        <RadioGroup
                                            value={localPassageFilter}
                                            onValueChange={(value) => setLocalPassageFilter(value as "all" | "first" | "multi")}
                                        >
                                            <div className="flex items-center space-x-2 py-1">
                                                <RadioGroupItem value="all" id="passage-all" />
                                                <Label htmlFor="passage-all" className="text-sm cursor-pointer font-normal">
                                                    Tous les passages
                                                </Label>
                                            </div>
                                            <div className="flex items-center space-x-2 py-1">
                                                <RadioGroupItem value="first" id="passage-first" />
                                                <Label htmlFor="passage-first" className="text-sm cursor-pointer font-normal">
                                                    Premier passage uniquement
                                                </Label>
                                            </div>
                                            <div className="flex items-center space-x-2 py-1">
                                                <RadioGroupItem value="multi" id="passage-multi" />
                                                <Label htmlFor="passage-multi" className="text-sm cursor-pointer font-normal">
                                                    <span className="mr-1">🔄</span>
                                                    Passages multiples (ping-pong)
                                                </Label>
                                            </div>
                                        </RadioGroup>
                                        <p className="text-[10px] text-slate-400 px-1 mt-1.5">
                                            {localPassageFilter === "all" ? "Affiche tous les appels sans distinction" :
                                             localPassageFilter === "first" ? "Affiche uniquement les appels lors de leur premier passage dans cette queue" :
                                             "Affiche uniquement les appels qui sont repassés plusieurs fois par cette queue"}
                                        </p>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* OU/ET toggle - only show when multiple types selected */}
                        {localSelected.length >= 2 && (
                            <div className="border-t border-slate-100 pt-2">
                                <div className="flex items-center justify-between px-1">
                                    <span className="text-xs text-slate-500">Mode :</span>
                                    <div className="flex rounded-md border border-slate-200 overflow-hidden">
                                        <button
                                            type="button"
                                            className={cn(
                                                "px-2.5 py-1 text-xs font-medium transition-colors",
                                                localMatchMode === "or"
                                                    ? "bg-blue-500 text-white"
                                                    : "bg-white text-slate-600 hover:bg-slate-50"
                                            )}
                                            onClick={() => setLocalMatchMode("or")}
                                        >
                                            OU
                                        </button>
                                        <button
                                            type="button"
                                            className={cn(
                                                "px-2.5 py-1 text-xs font-medium transition-colors border-l border-slate-200",
                                                localMatchMode === "and"
                                                    ? "bg-blue-500 text-white"
                                                    : "bg-white text-slate-600 hover:bg-slate-50"
                                            )}
                                            onClick={() => setLocalMatchMode("and")}
                                        >
                                            ET
                                        </button>
                                    </div>
                                </div>
                                <p className="text-[10px] text-slate-400 px-1 mt-1">
                                    {localMatchMode === "or"
                                        ? "Au moins un type sélectionné"
                                        : "Tous les types sélectionnés"}
                                </p>
                            </div>
                        )}
                    </div>
                </PopoverContent>
            </Popover>
        </div>
    );
}
