"use client";

import * as React from "react";
import { Filter, Plus, X, Settings2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { QueueAgentPicker } from "@/components/queue-agent-picker";

import type { JourneyCondition, JourneyStepType, JourneyStepResult } from "@/types/logs.types";
import type { QueueInfo } from "@/types/queues.types";

interface ColumnFilterJourneyProps {
    conditions: JourneyCondition[];
    onChange: (conditions: JourneyCondition[]) => void;
    queues: QueueInfo[];
    className?: string;
}

const TYPE_OPTIONS: { value: string; label: string; icon: string }[] = [
    { value: "_all", label: "Tous", icon: "" },
    { value: "direct", label: "Direct", icon: "📞" },
    { value: "queue", label: "Queue", icon: "👥" },
    { value: "voicemail", label: "Messagerie", icon: "📫" },
];

const RESULT_OPTIONS: { value: string; label: string }[] = [
    { value: "_all", label: "Tous" },
    { value: "answered", label: "Répondu" },
    { value: "not_answered", label: "Non répondu" },
    { value: "busy", label: "Occupé" },
    { value: "voicemail", label: "Messagerie" },
];

const PRESETS: { label: string; conditions: JourneyCondition[] }[] = [
    { label: "Queue répondus", conditions: [{ type: "queue", result: "answered" }] },
    { label: "Queue abandonnés", conditions: [{ type: "queue", result: "not_answered" }] },
    { label: "Queue ping-pong", conditions: [{ type: "queue", passageMode: "multi" }] },
    { label: "Messagerie", conditions: [{ type: "voicemail" }] },
    { label: "Direct répondus", conditions: [{ type: "direct", result: "answered" }] },
];

function conditionsEqual(a: JourneyCondition[], b: JourneyCondition[]): boolean {
    if (a.length !== b.length) return false;
    return a.every((c, i) => JSON.stringify(c) === JSON.stringify(b[i]));
}

function getPickerDisplayValue(
    condition: JourneyCondition,
    queues: QueueInfo[]
): string {
    if (condition.queueNumber) {
        const q = queues.find(q => q.queueNumber === condition.queueNumber);
        return q ? `${q.queueNumber} - ${q.queueName}` : condition.queueNumber;
    }
    if (condition.agentNumber) {
        for (const q of queues) {
            const agent = q.agents?.find(a => a.extensionNumber === condition.agentNumber);
            if (agent) return `${agent.extensionNumber} - ${agent.agentName}`;
        }
        return condition.agentNumber;
    }
    return "";
}

export function ColumnFilterJourney({
    conditions,
    onChange,
    queues,
    className,
}: ColumnFilterJourneyProps) {
    const [open, setOpen] = React.useState(false);
    const [localConditions, setLocalConditions] = React.useState<JourneyCondition[]>(conditions);
    const [expandedAdvanced, setExpandedAdvanced] = React.useState<Set<number>>(new Set());

    // Sync local state when props change
    React.useEffect(() => {
        setLocalConditions(conditions);
    }, [conditions]);

    const hasFilter = conditions.length > 0;

    const handleAddCondition = () => {
        setLocalConditions([...localConditions, {}]);
    };

    const handleRemoveCondition = (index: number) => {
        setLocalConditions(localConditions.filter((_, i) => i !== index));
        setExpandedAdvanced(prev => {
            const next = new Set<number>();
            prev.forEach(i => {
                if (i < index) next.add(i);
                else if (i > index) next.add(i - 1);
            });
            return next;
        });
    };

    const handleUpdateCondition = (index: number, updates: Partial<JourneyCondition>) => {
        const updated = [...localConditions];
        updated[index] = { ...updated[index], ...updates };
        setLocalConditions(updated);
    };

    const handleTypeChange = (index: number, value: string) => {
        const type = value === "_all" ? undefined : value as JourneyStepType;
        const updated = { ...localConditions[index], type };
        // Clear target fields when type changes
        if (type !== "queue") {
            delete updated.queueNumber;
            delete updated.passageMode;
            delete updated.hasOverflow;
        }
        if (type === "queue") {
            delete updated.agentNumber;
        }
        const all = [...localConditions];
        all[index] = updated;
        setLocalConditions(all);
    };

    const handleResultChange = (index: number, value: string) => {
        const result = value === "_all" ? undefined : value as JourneyStepResult;
        handleUpdateCondition(index, { result });
    };

    const handlePickerSelect = (index: number, item: { type: string; queueNumber: string; agentExtension?: string }) => {
        if (item.type === 'queue') {
            handleUpdateCondition(index, {
                queueNumber: item.queueNumber,
                agentNumber: undefined,
                type: 'queue',
            });
        } else if (item.type === 'agent' && item.agentExtension) {
            handleUpdateCondition(index, {
                agentNumber: item.agentExtension,
                queueNumber: undefined,
                passageMode: undefined,
                hasOverflow: undefined,
            });
        }
    };

    const handleClearTarget = (index: number) => {
        handleUpdateCondition(index, {
            queueNumber: undefined,
            agentNumber: undefined,
            passageMode: undefined,
            hasOverflow: undefined,
        });
    };

    const toggleAdvanced = (index: number) => {
        setExpandedAdvanced(prev => {
            const next = new Set(prev);
            if (next.has(index)) next.delete(index);
            else next.add(index);
            return next;
        });
    };

    const handleApply = () => {
        // Clean empty conditions before applying
        const cleaned = localConditions.filter(c =>
            c.type || c.queueNumber || c.agentNumber || c.result
        );
        onChange(cleaned);
        setOpen(false);
    };

    const handlePreset = (preset: typeof PRESETS[0]) => {
        setLocalConditions(preset.conditions);
        onChange(preset.conditions);
    };

    const handleClear = () => {
        setLocalConditions([]);
        onChange([]);
        setExpandedAdvanced(new Set());
    };

    const getLabel = () => {
        if (!hasFilter) return "Parcours";
        if (conditions.length === 1) {
            const c = conditions[0];
            const parts: string[] = [];
            const typeOpt = TYPE_OPTIONS.find(o => o.value === c.type);
            if (typeOpt && c.type) parts.push(typeOpt.icon + typeOpt.label);
            if (c.queueNumber) parts.push(`Q${c.queueNumber}`);
            if (c.agentNumber) parts.push(`Ag.${c.agentNumber}`);
            const resultOpt = RESULT_OPTIONS.find(o => o.value === c.result);
            if (resultOpt && c.result) parts.push(resultOpt.label);
            return parts.join(' ') || "1 condition";
        }
        return `${conditions.length} conditions`;
    };

    const hasShowQueueAdvanced = (c: JourneyCondition) =>
        c.type === 'queue' && !!c.queueNumber;

    return (
        <div className={cn("w-full min-w-[90px]", className)}>
            <Popover open={open} onOpenChange={setOpen}>
                <PopoverTrigger asChild>
                    <Button
                        variant="outline"
                        size="sm"
                        className={cn(
                            "h-8 w-full justify-start text-xs font-normal bg-white/80 border-input gap-1",
                            hasFilter && "border-blue-500 bg-blue-50/50"
                        )}
                    >
                        <Filter className="h-3 w-3 text-slate-500" />
                        <span className="truncate">{getLabel()}</span>
                    </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[420px] p-3" align="start">
                    <div className="space-y-3">
                        {/* Header */}
                        <div className="flex items-center justify-between">
                            <span className="text-sm font-medium">Filtres parcours</span>
                            {hasFilter && (
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={handleClear}
                                    className="h-6 px-2 text-xs"
                                >
                                    <X className="h-3 w-3 mr-1" />
                                    Effacer
                                </Button>
                            )}
                        </div>

                        {/* Conditions list */}
                        <div className="space-y-2">
                            {localConditions.length === 0 && (
                                <p className="text-xs text-slate-400 text-center py-2">
                                    Aucune condition — tous les parcours
                                </p>
                            )}

                            {/* Column headers */}
                            {localConditions.length > 0 && (
                                <div className="grid grid-cols-[90px_1fr_100px_28px_28px] gap-1.5 px-0.5">
                                    <span className="text-[10px] text-slate-400 font-medium">Type</span>
                                    <span className="text-[10px] text-slate-400 font-medium">Cible</span>
                                    <span className="text-[10px] text-slate-400 font-medium">Résultat</span>
                                    <span></span>
                                    <span></span>
                                </div>
                            )}

                            {localConditions.map((condition, index) => (
                                <div key={index} className={cn(
                                    "rounded-md border border-slate-100 p-1.5",
                                    condition.negate && "bg-red-50/50 border-red-200"
                                )}>
                                    {/* Main row: Type | Target | Result | Advanced | Remove */}
                                    <div className="grid grid-cols-[90px_1fr_100px_28px_28px] gap-1.5 items-center">
                                        {/* Type select */}
                                        <Select
                                            value={condition.type || "_all"}
                                            onValueChange={(v) => handleTypeChange(index, v)}
                                        >
                                            <SelectTrigger className="h-7 text-xs px-2">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {TYPE_OPTIONS.map(opt => (
                                                    <SelectItem key={opt.value} value={opt.value} className="text-xs">
                                                        {opt.icon ? `${opt.icon} ${opt.label}` : opt.label}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>

                                        {/* Target (Queue/Agent picker) */}
                                        <div className="relative">
                                            {(condition.queueNumber || condition.agentNumber) ? (
                                                <div className="flex items-center h-7 text-xs border border-slate-200 rounded px-2 bg-white gap-1">
                                                    <span className="truncate flex-1">
                                                        {getPickerDisplayValue(condition, queues)}
                                                    </span>
                                                    <button
                                                        type="button"
                                                        onClick={() => handleClearTarget(index)}
                                                        className="text-slate-400 hover:text-red-500 flex-shrink-0"
                                                    >
                                                        <X className="h-3 w-3" />
                                                    </button>
                                                </div>
                                            ) : (
                                                <QueueAgentPicker
                                                    queues={queues}
                                                    show={condition.type === 'queue' ? 'queues' : condition.type === 'direct' ? 'agents' : 'both'}
                                                    size="compact"
                                                    selectedQueueNumber={null}
                                                    onSelect={(item) => handlePickerSelect(index, item)}
                                                    placeholder="Tous..."
                                                    displayValue=""
                                                />
                                            )}
                                        </div>

                                        {/* Result select */}
                                        <Select
                                            value={condition.result || "_all"}
                                            onValueChange={(v) => handleResultChange(index, v)}
                                        >
                                            <SelectTrigger className="h-7 text-xs px-2">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {RESULT_OPTIONS.map(opt => (
                                                    <SelectItem key={opt.value} value={opt.value} className="text-xs">
                                                        {opt.label}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>

                                        {/* Advanced toggle */}
                                        <button
                                            type="button"
                                            onClick={() => toggleAdvanced(index)}
                                            className={cn(
                                                "h-7 w-7 flex items-center justify-center rounded transition-colors",
                                                expandedAdvanced.has(index)
                                                    ? "text-blue-600 bg-blue-50"
                                                    : "text-slate-400 hover:text-slate-600 hover:bg-slate-50",
                                                (condition.negate || condition.passageMode === 'first' || condition.passageMode === 'multi' || condition.hasOverflow !== undefined) &&
                                                    !expandedAdvanced.has(index) && "text-blue-500"
                                            )}
                                            title="Options avancées"
                                        >
                                            <Settings2 className="h-3.5 w-3.5" />
                                        </button>

                                        {/* Remove button */}
                                        <button
                                            type="button"
                                            onClick={() => handleRemoveCondition(index)}
                                            className="h-7 w-7 flex items-center justify-center text-slate-400 hover:text-red-500 transition-colors"
                                        >
                                            <X className="h-3 w-3" />
                                        </button>
                                    </div>

                                    {/* Advanced options (collapsible) */}
                                    {expandedAdvanced.has(index) && (
                                        <div className="mt-1.5 pt-1.5 border-t border-slate-100 space-y-1.5 pl-1">
                                            {/* Negate checkbox */}
                                            <div className="flex items-center gap-2">
                                                <Checkbox
                                                    id={`negate-${index}`}
                                                    checked={condition.negate || false}
                                                    onCheckedChange={(checked) =>
                                                        handleUpdateCondition(index, { negate: checked as boolean || undefined })
                                                    }
                                                />
                                                <Label htmlFor={`negate-${index}`} className="text-xs cursor-pointer text-red-600 font-medium">
                                                    Exclure (inverser cette condition)
                                                </Label>
                                            </div>

                                            {/* Queue-specific: passage mode */}
                                            {hasShowQueueAdvanced(condition) && (
                                                <div className="space-y-1">
                                                    <Label className="text-[10px] text-slate-500">Passage</Label>
                                                    <RadioGroup
                                                        value={condition.passageMode || "all"}
                                                        onValueChange={(v) =>
                                                            handleUpdateCondition(index, {
                                                                passageMode: v === 'all' ? undefined : v as 'first' | 'multi'
                                                            })
                                                        }
                                                        className="flex gap-3"
                                                    >
                                                        <div className="flex items-center space-x-1">
                                                            <RadioGroupItem value="all" id={`passage-all-${index}`} />
                                                            <Label htmlFor={`passage-all-${index}`} className="text-xs cursor-pointer font-normal">
                                                                Tous
                                                            </Label>
                                                        </div>
                                                        <div className="flex items-center space-x-1">
                                                            <RadioGroupItem value="first" id={`passage-first-${index}`} />
                                                            <Label htmlFor={`passage-first-${index}`} className="text-xs cursor-pointer font-normal">
                                                                1er passage
                                                            </Label>
                                                        </div>
                                                        <div className="flex items-center space-x-1">
                                                            <RadioGroupItem value="multi" id={`passage-multi-${index}`} />
                                                            <Label htmlFor={`passage-multi-${index}`} className="text-xs cursor-pointer font-normal">
                                                                Multi (ping-pong)
                                                            </Label>
                                                        </div>
                                                    </RadioGroup>
                                                </div>
                                            )}

                                            {/* Queue-specific: overflow */}
                                            {hasShowQueueAdvanced(condition) && (
                                                <div className="flex items-center gap-2">
                                                    <Checkbox
                                                        id={`overflow-${index}`}
                                                        checked={condition.hasOverflow || false}
                                                        onCheckedChange={(checked) =>
                                                            handleUpdateCondition(index, {
                                                                hasOverflow: checked as boolean || undefined
                                                            })
                                                        }
                                                    />
                                                    <Label htmlFor={`overflow-${index}`} className="text-xs cursor-pointer font-normal">
                                                        Redirigé vers autre queue après
                                                    </Label>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>

                        {/* Add condition + Apply buttons */}
                        <div className="flex items-center gap-2">
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={handleAddCondition}
                                className="h-7 text-xs flex-1 gap-1"
                            >
                                <Plus className="h-3 w-3" />
                                Ajouter une condition
                            </Button>
                            {localConditions.length > 0 && !conditionsEqual(localConditions, conditions) && (
                                <Button
                                    size="sm"
                                    onClick={handleApply}
                                    className="h-7 text-xs"
                                >
                                    Appliquer
                                </Button>
                            )}
                        </div>

                        {/* Presets */}
                        <div className="border-t border-slate-100 pt-2">
                            <p className="text-xs text-slate-500 mb-1.5">Raccourcis</p>
                            <div className="flex flex-wrap gap-1">
                                {PRESETS.map((preset) => {
                                    const isActive = conditionsEqual(conditions, preset.conditions);
                                    return (
                                        <Button
                                            key={preset.label}
                                            variant={isActive ? "default" : "outline"}
                                            size="sm"
                                            className="h-7 text-xs"
                                            onClick={() => handlePreset(preset)}
                                        >
                                            {preset.label}
                                        </Button>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                </PopoverContent>
            </Popover>
        </div>
    );
}
