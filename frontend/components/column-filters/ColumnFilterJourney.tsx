"use client";

import * as React from "react";
import { Filter, Plus, X, Settings2, Phone, Users } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Tip } from "@/components/ui/tooltip";
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

import type { JourneyFilter, JourneyGroupCondition, JourneyConditionNode, JourneyStepResult } from "@/types/logs.types";
import type { QueueInfo, QueueMember } from "@/types/queues.types";

interface ColumnFilterJourneyProps {
    filter: JourneyFilter | null;
    onChange: (filter: JourneyFilter | null) => void;
    queues: QueueInfo[];
    className?: string;
}

const RESULT_OPTIONS: { value: string; label: string }[] = [
    { value: "_all", label: "Tous" },
    { value: "answered", label: "Répondu" },
    { value: "not_answered", label: "Non répondu" },
    { value: "abandoned", label: "Manqué" },
    { value: "overflow", label: "Débordé" },
    { value: "busy", label: "Occupé" },
    { value: "voicemail", label: "Messagerie" },
];

function createEmptyCondition(): JourneyConditionNode {
    return {
        type: undefined,
        queueNumber: undefined,
        queueAgentNumber: undefined,
        agentNumber: undefined,
        result: undefined,
        negate: false,
        firstSegment: false,
        lastSegment: false,
        overflowQueueNumber: undefined,
    };
}

function createEmptyGroupCondition(operator: "AND" | "OR" = "AND"): JourneyGroupCondition {
    return {
        condition: createEmptyCondition(),
        operator,
    };
}

function getConditionCount(filter: JourneyFilter | null): number {
    if (!filter) return 0;
    return filter.groups.reduce((sum, fg) => sum + fg.group.conditions.length, 0);
}

function getPickerDisplayValue(
    condition: JourneyConditionNode,
    queues: QueueInfo[]
): string {
    if (condition.queueNumber) {
        const q = queues.find(q => q.queueNumber === condition.queueNumber);
        return q ? `${q.queueNumber} - ${q.queueName}` : condition.queueNumber;
    }
    if (condition.agentNumber) {
        for (const q of queues) {
            const member = q.members?.find((m: QueueMember) => m.agentExtension === condition.agentNumber);
            if (member) return `${member.agentExtension} - ${member.agentName}`;
        }
        return condition.agentNumber;
    }
    return "";
}

function getQueueAgentDisplayValue(
    agentNumber: string | undefined,
    queues: QueueInfo[]
): string {
    if (!agentNumber) return "";
    for (const q of queues) {
        const member = q.members?.find((m: QueueMember) => m.agentExtension === agentNumber);
        if (member) return `${member.agentExtension} - ${member.agentName}`;
    }
    return agentNumber;
}

function getQueueDisplayValue(
    queueNumber: string | undefined,
    queues: QueueInfo[]
): string {
    if (!queueNumber) return "";
    const q = queues.find(q => q.queueNumber === queueNumber);
    return q ? `${q.queueNumber} - ${q.queueName}` : queueNumber;
}

function getAgentsForQueue(queueNumber: string | undefined, queues: QueueInfo[]): QueueMember[] {
    if (!queueNumber) return [];
    const queue = queues.find(q => q.queueNumber === queueNumber);
    return queue?.members || [];
}

function OperatorToggle({
    value,
    onChange,
    size = "sm",
}: {
    value: "AND" | "OR";
    onChange: () => void;
    size?: "sm" | "xs";
}) {
    const isAnd = value === "AND";
    return (
        <div
            className={cn(
                "inline-flex items-center rounded-lg border bg-slate-100 cursor-pointer select-none transition-all hover:shadow-sm",
                size === "sm" ? "h-6 px-0.5 gap-0.5" : "h-5 px-0.5 gap-0.5",
                isAnd ? "border-blue-300" : "border-violet-300"
            )}
            onClick={(e) => { e.stopPropagation(); onChange(); }}
        >
            <span className={cn(
                "font-semibold transition-all rounded-md px-1.5",
                size === "sm" ? "text-[10px]" : "text-[9px]",
                isAnd ? "bg-blue-500 text-white shadow-sm" : "text-slate-500"
            )}>ET</span>
            <span className={cn(
                "font-semibold transition-all rounded-md px-1.5",
                size === "sm" ? "text-[10px]" : "text-[9px]",
                !isAnd ? "bg-violet-500 text-white shadow-sm" : "text-slate-500"
            )}>OU</span>
        </div>
    );
}

function Toggle({
    checked,
    onCheckedChange,
    disabled = false,
}: {
    checked: boolean;
    onCheckedChange: (checked: boolean) => void;
    disabled?: boolean;
}) {
    return (
        <div
            className={cn(
                "inline-flex items-center rounded-lg border bg-slate-100 cursor-pointer select-none transition-all hover:shadow-sm",
                "h-5 px-0.5 gap-0.5",
                checked ? "border-slate-400" : "border-slate-200",
                disabled && "opacity-50 cursor-not-allowed"
            )}
            onClick={() => !disabled && onCheckedChange(!checked)}
        >
            <span className={cn(
                "font-semibold transition-all rounded-md px-1.5 text-[9px]",
                !checked ? "bg-slate-400 text-white shadow-sm" : "text-slate-400"
            )}>OFF</span>
            <span className={cn(
                "font-semibold transition-all rounded-md px-1.5 text-[9px]",
                checked ? "bg-slate-800 text-white shadow-sm" : "text-slate-400"
            )}>ON</span>
        </div>
    );
}

export function ColumnFilterJourney({
    filter,
    onChange,
    queues,
    className,
}: ColumnFilterJourneyProps) {
    const [open, setOpen] = React.useState(false);
    const [localFilter, setLocalFilter] = React.useState<JourneyFilter | null>(filter);
    const [expandedAdvanced, setExpandedAdvanced] = React.useState<Set<string>>(new Set());

    React.useEffect(() => {
        setLocalFilter(filter);
    }, [filter]);

    const conditionCount = getConditionCount(localFilter);
    const hasFilter = conditionCount > 0;

    const updateFilter = (updater: (prev: JourneyFilter) => JourneyFilter | null) => {
        setLocalFilter(prev => prev ? updater(prev) : null);
    };

    const handleAddCondition = (groupIndex: number, operator: "AND" | "OR") => {
        updateFilter(prev => {
            const groups = [...prev.groups];
            const fg = { ...groups[groupIndex] };
            const group = { ...fg.group };
            group.conditions = [...group.conditions, createEmptyGroupCondition(operator)];
            fg.group = group;
            groups[groupIndex] = fg;
            return { ...prev, groups };
        });
    };

    const handleRemoveCondition = (groupIndex: number, conditionIndex: number) => {
        updateFilter(prev => {
            const groups = [...prev.groups];
            const fg = { ...groups[groupIndex] };
            const group = { ...fg.group };
            group.conditions = group.conditions.filter((_, i) => i !== conditionIndex);
            if (group.conditions.length === 0) {
                groups.splice(groupIndex, 1);
                if (groups.length === 0) return null;
                return { ...prev, groups };
            }
            fg.group = group;
            groups[groupIndex] = fg;
            return { ...prev, groups };
        });
        setExpandedAdvanced(prev => {
            const next = new Set(prev);
            next.forEach(key => {
                if (key.startsWith(`g${groupIndex}-c${conditionIndex}`)) next.delete(key);
            });
            return next;
        });
    };

    const handleUpdateCondition = (groupIndex: number, conditionIndex: number, updates: Partial<JourneyConditionNode>) => {
        updateFilter(prev => {
            const groups = [...prev.groups];
            const fg = { ...groups[groupIndex] };
            const group = { ...fg.group };
            const conditions = [...group.conditions];
            conditions[conditionIndex] = {
                ...conditions[conditionIndex],
                condition: { ...conditions[conditionIndex].condition, ...updates },
            };
            group.conditions = conditions;
            fg.group = group;
            groups[groupIndex] = fg;
            return { ...prev, groups };
        });
    };

    const handlePickerSelect = (groupIndex: number, conditionIndex: number, item: { type: string; queueNumber: string; agentExtension?: string; journeyType?: "direct" | "queue" }) => {
        if (item.type === 'type-only' && item.journeyType) {
            handleUpdateCondition(groupIndex, conditionIndex, {
                type: item.journeyType,
                queueNumber: undefined,
                agentNumber: undefined,
                firstSegment: false,
                lastSegment: false,
                overflowQueueNumber: undefined,
            });
        } else if (item.type === 'queue') {
            handleUpdateCondition(groupIndex, conditionIndex, {
                queueNumber: item.queueNumber,
                agentNumber: undefined,
                type: 'queue',
            });
        } else if (item.type === 'agent' && item.agentExtension) {
            handleUpdateCondition(groupIndex, conditionIndex, {
                agentNumber: item.agentExtension,
                queueNumber: undefined,
                type: 'direct',
                firstSegment: false,
                lastSegment: false,
                overflowQueueNumber: undefined,
            });
        }
    };

    const handleClearTarget = (groupIndex: number, conditionIndex: number) => {
        handleUpdateCondition(groupIndex, conditionIndex, {
            queueNumber: undefined,
            queueAgentNumber: undefined,
            agentNumber: undefined,
            type: undefined,
            firstSegment: false,
            lastSegment: false,
            overflowQueueNumber: undefined,
        });
    };

    const handleResultChange = (groupIndex: number, conditionIndex: number, value: string) => {
        const result = value === "_all" ? undefined : value as JourneyStepResult;
        handleUpdateCondition(groupIndex, conditionIndex, { result });
    };

    const handleQueueAgentChange = (groupIndex: number, conditionIndex: number, agentExtension: string | undefined) => {
        handleUpdateCondition(groupIndex, conditionIndex, { queueAgentNumber: agentExtension });
    };

    const handleQueueAgentAny = (groupIndex: number, conditionIndex: number) => {
        handleUpdateCondition(groupIndex, conditionIndex, { queueAgentNumber: '*' });
    };

    const handleOverflowQueueChange = (groupIndex: number, conditionIndex: number, item: { type: string; queueNumber: string }) => {
        if (item.type === 'queue') {
            handleUpdateCondition(groupIndex, conditionIndex, { overflowQueueNumber: item.queueNumber });
        } else if (item.type === 'any-queue') {
            handleUpdateCondition(groupIndex, conditionIndex, { overflowQueueNumber: '*' });
        }
    };

    const handleOverflowQueueAny = (groupIndex: number, conditionIndex: number) => {
        handleUpdateCondition(groupIndex, conditionIndex, { overflowQueueNumber: '*' });
    };

    const toggleAdvanced = (groupIndex: number, conditionIndex: number) => {
        const key = `g${groupIndex}-c${conditionIndex}`;
        setExpandedAdvanced(prev => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });
    };

    const handleToggleConditionOperator = (groupIndex: number, conditionIndex: number) => {
        updateFilter(prev => {
            const groups = [...prev.groups];
            const fg = { ...groups[groupIndex] };
            const group = { ...fg.group };
            const conditions = [...group.conditions];
            const gc = conditions[conditionIndex];
            conditions[conditionIndex] = { ...gc, operator: gc.operator === "AND" ? "OR" : "AND" };
            group.conditions = conditions;
            fg.group = group;
            groups[groupIndex] = fg;
            return { ...prev, groups };
        });
    };

    const handleToggleGroupOperator = (groupIndex: number) => {
        updateFilter(prev => {
            const groups = [...prev.groups];
            const fg = groups[groupIndex];
            groups[groupIndex] = { ...fg, operator: fg.operator === "AND" ? "OR" : "AND" };
            return { ...prev, groups };
        });
    };

    const handleAddGroup = () => {
        setLocalFilter(prev => {
            if (!prev) {
                return { groups: [{ group: { conditions: [createEmptyGroupCondition("AND")] }, operator: "AND" }] };
            }
            return {
                ...prev,
                groups: [...prev.groups, { group: { conditions: [createEmptyGroupCondition("AND")] }, operator: "AND" }],
            };
        });
    };

    const handleRemoveGroup = (groupIndex: number) => {
        updateFilter(prev => {
            const groups = prev.groups.filter((_, i) => i !== groupIndex);
            if (groups.length === 0) return null;
            return { ...prev, groups };
        });
    };

    const handleApply = () => {
        if (!localFilter) {
            onChange(null);
            setOpen(false);
            return;
        }
        const cleaned = {
            ...localFilter,
            groups: localFilter.groups.map(fg => ({
                ...fg,
                group: {
                    ...fg.group,
                    conditions: fg.group.conditions.filter(gc => {
                        const c = gc.condition;
                        return c.type || c.queueNumber || c.agentNumber || c.result || c.firstSegment || c.lastSegment || c.overflowQueueNumber;
                    }),
                },
            })).filter(fg => fg.group.conditions.length > 0),
        };

        if (cleaned.groups.length === 0) {
            onChange(null);
        } else {
            onChange(cleaned);
        }
        setOpen(false);
    };

    const handleClear = () => {
        setLocalFilter(null);
        onChange(null);
        setExpandedAdvanced(new Set());
    };

    const getLabel = () => {
        if (!hasFilter || !localFilter) return "Parcours";
        if (conditionCount === 1) {
            const c = localFilter.groups[0]?.group.conditions[0]?.condition;
            if (!c) return "1 condition";
            const parts: React.ReactNode[] = [];

            if (c.type === 'direct' && !c.queueNumber && !c.agentNumber) {
                parts.push(
                    <span key="type" className="inline-flex items-center gap-1">
                        <Phone className="h-3.5 w-3.5" /> <span>Directs</span>
                    </span>
                );
            } else if (c.type === 'queue' && !c.queueNumber && !c.agentNumber) {
                parts.push(
                    <span key="type" className="inline-flex items-center gap-1">
                        <Users className="h-3.5 w-3.5" /> <span>Queues</span>
                    </span>
                );
            }

            if (c.queueNumber) parts.push(<span key="q">Q{c.queueNumber}</span>);
            if (c.queueAgentNumber) parts.push(<span key="qa">Col.{c.queueAgentNumber}</span>);
            if (c.agentNumber) parts.push(<span key="ag">Col.{c.agentNumber}</span>);
            const resultOpt = RESULT_OPTIONS.find(o => o.value === c.result);
            if (resultOpt && c.result) parts.push(<span key="res">{resultOpt.label}</span>);
            if (c.firstSegment) parts.push(<span key="first">1er</span>);
            if (c.lastSegment) parts.push(<span key="last">Dernier</span>);

            if (parts.length === 0) return "1 condition";

            return (
                <span className="inline-flex items-center gap-1.5">
                    {parts.map((part, i) => (
                        <React.Fragment key={i}>{part}</React.Fragment>
                    ))}
                </span>
            );
        }
        return `${conditionCount} conditions`;
    };

    const hasShowQueueAdvanced = (c: JourneyConditionNode) => !!c.queueNumber;

    const hasShowSegmentOptions = (c: JourneyConditionNode) =>
        !!c.type || !!c.queueNumber || !!c.agentNumber;

    const renderCondition = (groupIndex: number, conditionIndex: number, gc: JourneyGroupCondition) => {
        const condition = gc.condition;
        const key = `g${groupIndex}-c${conditionIndex}`;
        const isExpanded = expandedAdvanced.has(key);

        const queueAgents = getAgentsForQueue(condition.queueNumber, queues);

        return (
            <div key={key} className={cn(
                "rounded-md border p-1.5",
                condition.negate && "bg-red-50/50 border-red-200"
            )}>
                <div className="grid grid-cols-[56px_1fr_100px_28px_28px] gap-1.5 items-center">
                    {conditionIndex > 0 && (
                        <div className="w-fit">
                            <OperatorToggle
                                value={gc.operator}
                                onChange={() => handleToggleConditionOperator(groupIndex, conditionIndex)}
                                size="xs"
                            />
                        </div>
                    )}

                    <div className={cn("relative min-w-0", conditionIndex === 0 && "col-start-1 col-span-2")}>
                        {(condition.queueNumber || condition.queueAgentNumber || condition.agentNumber || (condition.type && !condition.queueNumber && !condition.queueAgentNumber && !condition.agentNumber)) ? (
                            <div className="flex items-center h-7 text-xs border border-slate-200 rounded px-2 bg-white gap-1 w-full">
                                <span
                                    className="truncate flex-1"
                                    title={getPickerDisplayValue(condition, queues) || (condition.type === 'direct' ? 'Tous les directs' : condition.type === 'queue' ? 'Toutes les queues' : '')}
                                >
                                    {condition.queueNumber || condition.agentNumber
                                        ? getPickerDisplayValue(condition, queues)
                                        : condition.type === 'direct'
                                            ? 'Tous les directs'
                                            : condition.type === 'queue'
                                                ? 'Toutes les queues'
                                                : ''}
                                </span>
                                <button
                                    type="button"
                                    onClick={() => handleClearTarget(groupIndex, conditionIndex)}
                                    className="text-slate-400 hover:text-red-500 flex-shrink-0"
                                >
                                    <X className="h-3 w-3" />
                                </button>
                            </div>
                        ) : (
                            <QueueAgentPicker
                                queues={queues}
                                show="both"
                                showTypeOptions={true}
                                size="compact"
                                selectedQueueNumber={null}
                                onSelect={(item) => handlePickerSelect(groupIndex, conditionIndex, item)}
                                placeholder="Tous..."
                                displayValue=""
                            />
                        )}
                    </div>

                    <Select
                        value={condition.result || "_all"}
                        onValueChange={(v) => handleResultChange(groupIndex, conditionIndex, v)}
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

                    <Tip content="Options avancées">
                        <button
                            type="button"
                            onClick={() => toggleAdvanced(groupIndex, conditionIndex)}
                            className={cn(
                                "h-7 w-7 flex items-center justify-center rounded transition-colors",
                                isExpanded
                                    ? "text-blue-600 bg-blue-50"
                                    : "text-slate-400 hover:text-slate-600 hover:bg-slate-50",
                                (condition.negate || condition.firstSegment || condition.lastSegment || condition.queueAgentNumber || condition.overflowQueueNumber) &&
                                !isExpanded && "text-blue-500"
                            )}
                        >
                            <Settings2 className="h-3.5 w-3.5" />
                        </button>
                    </Tip>

                    <button
                        type="button"
                        onClick={() => handleRemoveCondition(groupIndex, conditionIndex)}
                        className="h-7 w-7 flex items-center justify-center text-slate-400 hover:text-red-500 transition-colors"
                    >
                        <X className="h-3 w-3" />
                    </button>
                </div>

                {isExpanded && (
                    <div className="mt-2 pt-2 border-t border-slate-100 space-y-2">
                        <div className="flex items-center gap-3">
                            <Toggle
                                checked={condition.negate || false}
                                onCheckedChange={(checked) =>
                                    handleUpdateCondition(groupIndex, conditionIndex, { negate: checked })
                                }
                            />
                            <Label className="text-sm cursor-pointer text-red-600 font-medium">
                                Exclure (inverser cette condition)
                            </Label>
                        </div>

                        {hasShowQueueAdvanced(condition) && (
                            <div className="flex items-center gap-3">
                                <Toggle
                                    checked={!!condition.queueAgentNumber}
                                    onCheckedChange={(checked) => {
                                        if (checked) {
                                            handleQueueAgentAny(groupIndex, conditionIndex);
                                        } else {
                                            handleQueueAgentChange(groupIndex, conditionIndex, undefined);
                                        }
                                    }}
                                />
                                <Label className="text-sm cursor-pointer whitespace-nowrap">Répondu par</Label>
                                <div className={cn(
                                    "flex-1 transition-opacity",
                                    !condition.queueAgentNumber && "opacity-50 pointer-events-none"
                                )}>
                                    <QueueAgentPicker
                                        queues={queues.filter(q => q.queueNumber === condition.queueNumber)}
                                        show="agents"
                                        size="compact"
                                        selectedQueueNumber={null}
                                        onSelect={(item) => {
                                            if (item.type === 'any-agent') {
                                                handleQueueAgentAny(groupIndex, conditionIndex);
                                            } else if (item.agentExtension) {
                                                handleQueueAgentChange(groupIndex, conditionIndex, item.agentExtension);
                                            }
                                        }}
                                        placeholder="Sélectionner un collaborateur..."
                                        displayValue={condition.queueAgentNumber === '*' ? 'L\'un des agents de la file' : getQueueAgentDisplayValue(condition.queueAgentNumber, queues)}
                                        inputClassName="h-7 text-xs"
                                        showAnyOption={true}
                                    />
                                </div>
                            </div>
                        )}

                        {hasShowSegmentOptions(condition) && (
                            <div className="flex items-center gap-3">
                                <Toggle
                                    checked={condition.firstSegment || false}
                                    onCheckedChange={(checked) => {
                                        handleUpdateCondition(groupIndex, conditionIndex, {
                                            firstSegment: checked,
                                            lastSegment: checked ? false : condition.lastSegment,
                                        });
                                    }}
                                />
                                <Label className="text-sm cursor-pointer">1er segment</Label>
                            </div>
                        )}

                        {hasShowSegmentOptions(condition) && (
                            <div className="flex items-center gap-3">
                                <Toggle
                                    checked={condition.lastSegment || false}
                                    onCheckedChange={(checked) => {
                                        handleUpdateCondition(groupIndex, conditionIndex, {
                                            lastSegment: checked,
                                            firstSegment: checked ? false : condition.firstSegment,
                                        });
                                    }}
                                />
                                <Label className="text-sm cursor-pointer">Dernier segment</Label>
                            </div>
                        )}

                        {hasShowQueueAdvanced(condition) && (
                            <div className="flex items-center gap-3">
                                <Toggle
                                    checked={!!condition.overflowQueueNumber}
                                    onCheckedChange={(checked) => {
                                        if (checked) {
                                            handleOverflowQueueAny(groupIndex, conditionIndex);
                                        } else {
                                            handleUpdateCondition(groupIndex, conditionIndex, { overflowQueueNumber: undefined });
                                        }
                                    }}
                                />
                                <Label className="text-sm cursor-pointer whitespace-nowrap">Débordé vers</Label>
                                <div className={cn(
                                    "flex-1 transition-opacity",
                                    !condition.overflowQueueNumber && "opacity-50 pointer-events-none"
                                )}>
                                    <QueueAgentPicker
                                        queues={queues.filter(q => q.queueNumber !== condition.queueNumber)}
                                        show="queues"
                                        size="compact"
                                        selectedQueueNumber={null}
                                        onSelect={(item) => handleOverflowQueueChange(groupIndex, conditionIndex, item)}
                                        placeholder="Sélectionner une file..."
                                        displayValue={condition.overflowQueueNumber === '*' ? 'L\'une des files d\'attente' : getQueueDisplayValue(condition.overflowQueueNumber, queues)}
                                        inputClassName="h-7 text-xs"
                                        showAnyOption={true}
                                    />
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>
        );
    };

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
                <PopoverContent className="w-[520px] p-3" align="end">
                    <div className="space-y-3">
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

                        {conditionCount > 0 && (
                            <div className="grid grid-cols-[56px_1fr_100px_28px_28px] gap-1.5 px-0.5">
                                <span className="col-span-2 text-[10px] text-slate-400 font-medium">Cible</span>
                                <span className="text-[10px] text-slate-400 font-medium">Résultat</span>
                                <span></span>
                                <span></span>
                            </div>
                        )}

                        <div className="space-y-2">
                            {!localFilter || localFilter.groups.length === 0 ? (
                                <p className="text-xs text-slate-400 text-center py-4">
                                    Aucun filtre — ajoutez un groupe pour commencer
                                </p>
                            ) : (
                                localFilter.groups.map((filterGroup, groupIndex) => (
                                    <React.Fragment key={`group-${groupIndex}`}>
                                        <div className="rounded-lg border-2 border-slate-300 bg-slate-50/50 p-2">
                                            <div className="flex justify-end mb-1">
                                                <Tip content="Supprimer ce groupe">
                                                    <button
                                                        type="button"
                                                        onClick={() => handleRemoveGroup(groupIndex)}
                                                        className="text-slate-400 hover:text-red-500 transition-colors"
                                                    >
                                                        <X className="h-3.5 w-3.5" />
                                                    </button>
                                                </Tip>
                                            </div>

                                            <div className="space-y-2">
                                                {filterGroup.group.conditions.map((gc, conditionIndex) =>
                                                    renderCondition(groupIndex, conditionIndex, gc)
                                                )}
                                            </div>

                                            <div className="flex items-center gap-2 mt-2">
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={() => handleAddCondition(groupIndex, "AND")}
                                                    className="h-6 text-[10px] gap-1 flex-1 bg-blue-50 border-blue-200 hover:bg-blue-100"
                                                >
                                                    <Plus className="h-3 w-3" /> ET
                                                </Button>
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={() => handleAddCondition(groupIndex, "OR")}
                                                    className="h-6 text-[10px] gap-1 flex-1 bg-violet-50 border-violet-200 hover:bg-violet-100"
                                                >
                                                    <Plus className="h-3 w-3" /> OU
                                                </Button>
                                            </div>
                                        </div>

                                        {groupIndex < localFilter.groups.length - 1 && (
                                            <div className="flex justify-center -my-1 relative z-20">
                                                <OperatorToggle
                                                    value={localFilter.groups[groupIndex].operator}
                                                    onChange={() => handleToggleGroupOperator(groupIndex)}
                                                />
                                            </div>
                                        )}
                                    </React.Fragment>
                                ))
                            )}
                        </div>

                        <Button
                            variant="outline"
                            size="sm"
                            onClick={handleAddGroup}
                            className="h-7 text-xs w-full gap-1 border-dashed"
                        >
                            <Plus className="h-3 w-3" /> Ajouter un groupe
                        </Button>

                        <Button
                            size="sm"
                            onClick={handleApply}
                            className="h-7 text-xs w-full"
                            disabled={!hasFilter}
                        >
                            Appliquer
                        </Button>
                    </div>
                </PopoverContent>
            </Popover>
        </div>
    );
}
