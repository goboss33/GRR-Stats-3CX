"use client";

import * as React from "react";
import { SlidersHorizontal, X } from "lucide-react";

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
    // Agent filter
    agentNumber?: string | null;
    onAgentNumberChange?: (agentNumber: string | null) => void;
    // Transfer filter
    hasTransfer?: boolean;
    onHasTransferChange?: (enabled: boolean) => void;
    className?: string;
}

const journeyChips: { value: JourneyStepType; label: string; icon: string; activeClass: string }[] = [
    { value: "direct", label: "Direct", icon: "📞", activeClass: "bg-blue-100 text-blue-800 border-blue-300" },
    { value: "queue", label: "Queue", icon: "👥", activeClass: "bg-green-100 text-green-800 border-green-300" },
    { value: "voicemail", label: "Msg", icon: "📫", activeClass: "bg-purple-100 text-purple-800 border-purple-300" },
    { value: "transfer", label: "Transf.", icon: "↗", activeClass: "bg-amber-100 text-amber-800 border-amber-300" },
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
    agentNumber,
    onAgentNumberChange,
    hasTransfer,
    onHasTransferChange,
    className,
}: ColumnFilterJourneyProps) {
    const [advancedOpen, setAdvancedOpen] = React.useState(false);
    const [localQueueNumber, setLocalQueueNumber] = React.useState<string | null>(queueNumber ?? null);
    const [localAgentNumber, setLocalAgentNumber] = React.useState<string | null>(agentNumber ?? null);
    const [localQueueResults, setLocalQueueResults] = React.useState<QueueResultType[]>(queueResults ?? []);
    const [localPassageFilter, setLocalPassageFilter] = React.useState<"all" | "first" | "multi">(
        () => passageFilterFromBoolean(multiPassageSameQueue)
    );
    const [localHasTransfer, setLocalHasTransfer] = React.useState(hasTransfer ?? false);

    // Sync local state from parent props when popover is closed
    React.useEffect(() => {
        if (!advancedOpen) {
            setLocalQueueNumber(queueNumber ?? null);
            setLocalAgentNumber(agentNumber ?? null);
            setLocalQueueResults(queueResults ?? []);
            setLocalPassageFilter(passageFilterFromBoolean(multiPassageSameQueue));
            setLocalHasTransfer(hasTransfer ?? false);
        }
    }, [queueNumber, agentNumber, queueResults, multiPassageSameQueue, hasTransfer, advancedOpen]);

    // Toggle a chip type (immediate, no popover needed)
    const handleChipToggle = (type: JourneyStepType) => {
        if (selected.includes(type)) {
            onChange(selected.filter(t => t !== type));
        } else {
            onChange([...selected, type]);
        }
    };

    // Commit advanced popover changes on close
    const handleAdvancedOpenChange = (isOpen: boolean) => {
        if (!isOpen && advancedOpen) {
            // Commit changes
            if (localQueueNumber !== (queueNumber ?? null) && onQueueNumberChange) {
                onQueueNumberChange(localQueueNumber);
            }
            if (localAgentNumber !== (agentNumber ?? null) && onAgentNumberChange) {
                onAgentNumberChange(localAgentNumber);
            }
            const hasQueueResultsChanged =
                (localQueueResults ?? []).length !== (queueResults ?? []).length ||
                !(localQueueResults ?? []).every(r => (queueResults ?? []).includes(r));
            if (hasQueueResultsChanged && onQueueResultsChange) {
                onQueueResultsChange(localQueueResults);
            }
            const hasPassageFilterChanged =
                localPassageFilter !== passageFilterFromBoolean(multiPassageSameQueue);
            if (hasPassageFilterChanged && onMultiPassageSameQueueChange) {
                onMultiPassageSameQueueChange(passageFilterToBoolean(localPassageFilter));
            }
            if (localHasTransfer !== (hasTransfer ?? false) && onHasTransferChange) {
                onHasTransferChange(localHasTransfer);
            }
        }
        if (isOpen) {
            // Sync from parent on open
            setLocalQueueNumber(queueNumber ?? null);
            setLocalAgentNumber(agentNumber ?? null);
            setLocalQueueResults(queueResults ?? []);
            setLocalPassageFilter(passageFilterFromBoolean(multiPassageSameQueue));
            setLocalHasTransfer(hasTransfer ?? false);
        }
        setAdvancedOpen(isOpen);
    };

    const handleClearAdvanced = () => {
        setLocalQueueNumber(null);
        setLocalAgentNumber(null);
        setLocalQueueResults([]);
        setLocalPassageFilter("all");
        setLocalHasTransfer(false);
    };

    const handlePickerSelect = (item: { type: string; queueNumber: string; agentExtension?: string }) => {
        if (item.type === 'queue') {
            setLocalQueueNumber(item.queueNumber);
            setLocalAgentNumber(null);
        } else if (item.type === 'agent' && item.agentExtension) {
            setLocalAgentNumber(item.agentExtension);
            setLocalQueueNumber(null);
            setLocalQueueResults([]);
            setLocalPassageFilter("all");
        }
    };

    const hasAdvancedFilters =
        (queueNumber !== null && queueNumber !== undefined) ||
        (agentNumber !== null && agentNumber !== undefined) ||
        (queueResults && queueResults.length > 0) ||
        multiPassageSameQueue !== undefined ||
        hasTransfer === true;

    const pickerDisplayValue = (() => {
        if (localQueueNumber) {
            const q = queues?.find(q => q.queueNumber === localQueueNumber);
            return q ? `${q.queueNumber} - ${q.queueName}` : localQueueNumber;
        }
        if (localAgentNumber) {
            for (const q of queues ?? []) {
                const agent = q.agents?.find(a => a.extensionNumber === localAgentNumber);
                if (agent) return `${agent.extensionNumber} - ${agent.agentName}`;
            }
            return localAgentNumber;
        }
        return "";
    })();

    return (
        <div className={cn("w-full min-w-[180px]", className)}>
            <div className="flex items-center gap-1">
                {/* Chip toggles */}
                {journeyChips.map((chip) => {
                    const isActive = selected.includes(chip.value);
                    return (
                        <button
                            key={chip.value}
                            type="button"
                            onClick={() => handleChipToggle(chip.value)}
                            className={cn(
                                "inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded border text-[11px] font-medium transition-colors cursor-pointer whitespace-nowrap",
                                isActive
                                    ? chip.activeClass
                                    : "bg-white text-slate-400 border-slate-200 hover:bg-slate-50 hover:text-slate-600"
                            )}
                            title={chip.label}
                        >
                            <span className="text-xs">{chip.icon}</span>
                            <span className="hidden sm:inline">{chip.label}</span>
                        </button>
                    );
                })}

                {/* Advanced filter popover button */}
                <Popover open={advancedOpen} onOpenChange={handleAdvancedOpenChange}>
                    <PopoverTrigger asChild>
                        <Button
                            variant="ghost"
                            size="sm"
                            className={cn(
                                "h-6 w-6 p-0 flex-shrink-0",
                                hasAdvancedFilters && "text-blue-600 bg-blue-50"
                            )}
                            title="Filtres avancés"
                        >
                            <SlidersHorizontal className="h-3.5 w-3.5" />
                        </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-72 p-2" align="start">
                        <div className="space-y-2">
                            {/* Header */}
                            <div className="flex items-center justify-between px-1">
                                <Label className="text-xs font-medium text-slate-700">Filtres avancés</Label>
                                {(localQueueNumber || localAgentNumber || localQueueResults.length > 0 ||
                                  localPassageFilter !== "all" || localHasTransfer) && (
                                    <button
                                        type="button"
                                        onClick={handleClearAdvanced}
                                        className="text-xs text-slate-400 hover:text-slate-600 flex items-center gap-0.5"
                                    >
                                        <X className="h-3 w-3" />
                                        <span>Tout effacer</span>
                                    </button>
                                )}
                            </div>

                            {/* OU/ET toggle when multiple chip types selected */}
                            {selected.length >= 2 && (
                                <div className="px-1 pb-1">
                                    <div className="flex items-center justify-between">
                                        <span className="text-xs text-slate-500">Mode combinaison :</span>
                                        <div className="flex rounded-md border border-slate-200 overflow-hidden">
                                            <button
                                                type="button"
                                                className={cn(
                                                    "px-2.5 py-1 text-xs font-medium transition-colors",
                                                    matchMode === "or"
                                                        ? "bg-blue-500 text-white"
                                                        : "bg-white text-slate-600 hover:bg-slate-50"
                                                )}
                                                onClick={() => onMatchModeChange("or")}
                                            >
                                                OU
                                            </button>
                                            <button
                                                type="button"
                                                className={cn(
                                                    "px-2.5 py-1 text-xs font-medium transition-colors border-l border-slate-200",
                                                    matchMode === "and"
                                                        ? "bg-blue-500 text-white"
                                                        : "bg-white text-slate-600 hover:bg-slate-50"
                                                )}
                                                onClick={() => onMatchModeChange("and")}
                                            >
                                                ET
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Queue/Agent picker */}
                            {queues && (onQueueNumberChange || onAgentNumberChange) && (
                                <div className="border-t border-slate-100 pt-2 px-1">
                                    <Label className="text-xs text-slate-500 mb-1.5 block">Queue ou Agent</Label>
                                    <QueueAgentPicker
                                        queues={queues}
                                        show="both"
                                        size="compact"
                                        selectedQueueNumber={localQueueNumber}
                                        onSelect={handlePickerSelect}
                                        placeholder="Rechercher..."
                                        displayValue={pickerDisplayValue}
                                    />
                                </div>
                            )}

                            {/* Queue result filter (when queue selected) */}
                            {localQueueNumber && onQueueResultsChange && (
                                <div className="px-1">
                                    <Label className="text-xs text-slate-500 mb-1.5 block">Résultat queue</Label>
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

                            {/* Passage filter (when queue selected) */}
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
                                </div>
                            )}

                            {/* Transfer filter */}
                            {onHasTransferChange && (
                                <div className="px-1 pt-2 border-t border-slate-100">
                                    <div className="flex items-center gap-2">
                                        <Checkbox
                                            id="has-transfer"
                                            checked={localHasTransfer}
                                            onCheckedChange={(checked) => setLocalHasTransfer(checked as boolean)}
                                        />
                                        <Label htmlFor="has-transfer" className="text-sm cursor-pointer font-medium text-amber-700">
                                            Avec transfert manuel
                                        </Label>
                                    </div>
                                    <p className="text-[10px] text-slate-400 px-1 mt-1">
                                        Appels où un agent a manuellement transféré
                                    </p>
                                </div>
                            )}
                        </div>
                    </PopoverContent>
                </Popover>
            </div>
        </div>
    );
}
