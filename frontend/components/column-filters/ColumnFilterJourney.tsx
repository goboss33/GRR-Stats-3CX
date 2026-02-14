"use client";

import * as React from "react";
import { ChevronDown, Check, X } from "lucide-react";

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
    // Queue-specific filters
    queues?: QueueInfo[];
    queueNumber?: string | null;
    onQueueNumberChange?: (queueNumber: string | null) => void;
    queueResults?: QueueResultType[];
    onQueueResultsChange?: (results: QueueResultType[]) => void;
    // Multi-passage filter
    multiPassageSameQueue?: boolean;
    onMultiPassageSameQueueChange?: (enabled: boolean | undefined) => void;
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

function passageFilterFromBoolean(value: boolean | undefined): "all" | "first" | "multi" {
    if (value === true) return "multi";
    if (value === false) return "first";
    return "all";
}

function passageFilterToBoolean(value: "all" | "first" | "multi"): boolean | undefined {
    if (value === "multi") return true;
    if (value === "first") return false;
    return undefined;
}

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
    const [localPassageFilter, setLocalPassageFilter] = React.useState<"all" | "first" | "multi">(
        () => passageFilterFromBoolean(multiPassageSameQueue)
    );

    // Sync local state from parent props when popover is closed
    React.useEffect(() => {
        if (!open) {
            setLocalSelected(selected);
            setLocalMatchMode(matchMode);
            setLocalQueueNumber(queueNumber ?? null);
            setLocalQueueResults(queueResults ?? []);
            setLocalPassageFilter(passageFilterFromBoolean(multiPassageSameQueue));
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
            const hasPassageFilterChanged =
                localPassageFilter !== passageFilterFromBoolean(multiPassageSameQueue);

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
                onMultiPassageSameQueueChange(passageFilterToBoolean(localPassageFilter));
            }
        }
        if (isOpen) {
            // Sync from parent on open
            setLocalSelected(selected);
            setLocalMatchMode(matchMode);
            setLocalQueueNumber(queueNumber ?? null);
            setLocalQueueResults(queueResults ?? []);
            setLocalPassageFilter(passageFilterFromBoolean(multiPassageSameQueue));
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
        setLocalSelected([]);
    };

    const handleClearQueue = () => {
        setLocalQueueNumber(null);
        setLocalQueueResults([]);
        setLocalPassageFilter("all");
    };

    const getLabel = () => {
        const hasQueueFilter = queueNumber !== null && queueNumber !== undefined;
        const hasResultFilter = queueResults && queueResults.length > 0;
        const hasPassageFilter = multiPassageSameQueue !== undefined;

        // Queue-specific filters take priority in the label
        if (hasQueueFilter || hasResultFilter || hasPassageFilter) {
            const parts: string[] = [];

            if (hasQueueFilter) {
                const queue = queues?.find(q => q.queueNumber === queueNumber);
                parts.push(queue ? `Q${queueNumber}` : `Q${queueNumber}`);
            }

            if (hasResultFilter) {
                const labels = queueResults.map(r => {
                    const opt = queueResultOptions.find(o => o.value === r);
                    return opt?.label ?? r;
                });
                parts.push(labels.join(', '));
            }

            if (hasPassageFilter) {
                const passageLabel = multiPassageSameQueue === true ? 'Multi' :
                                    multiPassageSameQueue === false ? '1er passage' : '';
                if (passageLabel) parts.push(passageLabel);
            }

            return parts.length > 0 ? parts.join(' · ') : "Filtré";
        }

        // Journey type label
        if (selected.length === 0) {
            return "Tout";
        }
        if (selected.length === 1) {
            const opt = journeyOptions.find((o) => o.value === selected[0]);
            return opt ? `${opt.icon} ${opt.label}` : "1 sél.";
        }
        return `${selected.length} sél.`;
    };

    const isFilterActive = selected.length > 0 ||
        (queueNumber !== null && queueNumber !== undefined) ||
        (queueResults && queueResults.length > 0) ||
        multiPassageSameQueue !== undefined;

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
                            isFilterActive && "ring-2 ring-blue-500 ring-offset-1 border-blue-500"
                        )}
                    >
                        <span className="truncate">{getLabel()}</span>
                        <ChevronDown className="ml-1 h-3 w-3 text-slate-500" />
                    </Button>
                </PopoverTrigger>
                <PopoverContent className="w-64 p-2" align="start">
                    <div className="space-y-2">
                        {/* Section 1: Journey type filter */}
                        <div>
                            <Label className="text-xs text-slate-500 mb-1.5 block px-1">Type de parcours</Label>
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

                        {/* OU/ET toggle - only when multiple types selected */}
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

                        {/* Section 2: Queue-specific filters - only when Queue is selected */}
                        {localSelected.includes("queue") && queues && onQueueNumberChange && onQueueResultsChange && (
                            <div className="border-t border-slate-200 pt-2 space-y-2">
                                {/* Queue picker */}
                                <div className="px-1">
                                    <div className="flex items-center justify-between mb-1.5">
                                        <Label className="text-xs text-slate-500">Queue</Label>
                                        {localQueueNumber && (
                                            <button
                                                type="button"
                                                onClick={handleClearQueue}
                                                className="text-xs text-slate-400 hover:text-slate-600 flex items-center gap-0.5"
                                            >
                                                <X className="h-3 w-3" />
                                                <span>Effacer</span>
                                            </button>
                                        )}
                                    </div>
                                    <QueueAgentPicker
                                        queues={queues}
                                        show="queues"
                                        size="compact"
                                        selectedQueueNumber={localQueueNumber}
                                        onSelect={(item) => {
                                            if (item && item.type === 'queue') {
                                                setLocalQueueNumber(item.queueNumber);
                                            } else {
                                                setLocalQueueNumber(null);
                                            }
                                        }}
                                        placeholder="Toutes les queues"
                                        displayValue={
                                            localQueueNumber
                                                ? (() => {
                                                    const q = queues.find(q => q.queueNumber === localQueueNumber);
                                                    return q ? `${q.queueNumber} - ${q.queueName}` : localQueueNumber;
                                                })()
                                                : ""
                                        }
                                    />
                                </div>

                                {/* Section 3: Queue result filter */}
                                {localQueueNumber && (
                                    <div className="px-1">
                                        <Label className="text-xs text-slate-500 mb-1.5 block">Résultat</Label>
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

                                {/* Section 4: Passage filter */}
                                {localQueueNumber && onMultiPassageSameQueueChange && (
                                    <div className="px-1 pt-2 border-t border-slate-100">
                                        <Label className="text-xs text-slate-500 mb-1.5 block">Filtre de passage</Label>
                                        <RadioGroup
                                            value={localPassageFilter}
                                            onValueChange={(value) => setLocalPassageFilter(value as "all" | "first" | "multi")}
                                        >
                                            <div className="flex items-center space-x-2 py-0.5">
                                                <RadioGroupItem value="all" id="passage-all" />
                                                <Label htmlFor="passage-all" className="text-sm cursor-pointer font-normal">
                                                    Tous les passages
                                                </Label>
                                            </div>
                                            <div className="flex items-center space-x-2 py-0.5">
                                                <RadioGroupItem value="first" id="passage-first" />
                                                <Label htmlFor="passage-first" className="text-sm cursor-pointer font-normal">
                                                    Premier passage uniquement
                                                </Label>
                                            </div>
                                            <div className="flex items-center space-x-2 py-0.5">
                                                <RadioGroupItem value="multi" id="passage-multi" />
                                                <Label htmlFor="passage-multi" className="text-sm cursor-pointer font-normal">
                                                    Passages multiples (ping-pong)
                                                </Label>
                                            </div>
                                        </RadioGroup>
                                        <p className="text-[10px] text-slate-400 px-1 mt-1">
                                            {localPassageFilter === "all" ? "Tous les appels sans distinction" :
                                             localPassageFilter === "first" ? "Résultat du premier passage dans cette queue" :
                                             "Appels repassés plusieurs fois par cette queue"}
                                        </p>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </PopoverContent>
            </Popover>
        </div>
    );
}
