/**
 * QueueAgentPicker Component
 * 
 * A reusable search/select component for queues and/or agents.
 * 
 * Features:
 * - Search by queue name/number/department or agent name/extension
 * - Filter to show only queues, only agents, or both
 * - Grouped results with counts
 * - Size variants (default, compact)
 * 
 * @example
 * // Show only queues (for statistics page)
 * <QueueAgentPicker
 *   queues={queues}
 *   show="queues"
 *   onSelect={(item) => handleSelect(item)}
 * />
 * 
 * // Show both queues and agents (for queues page)
 * <QueueAgentPicker
 *   queues={queues}
 *   show="both"
 *   onSelect={(item) => handleSelect(item)}
 * />
 */
"use client";

import * as React from "react";
import { Search, X, Users, User, ChevronDown, Phone } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { QueueInfo } from "@/types/queues.types";

// ============================================
// TYPES
// ============================================

export type ShowFilter = "queues" | "agents" | "both";

export interface QueueAgentPickerItem {
    type: "queue" | "agent" | "type-only" | "any-agent" | "any-queue";
    queueNumber: string;
    queueName: string;
    /** Département 3CX de la file — critère de recherche uniquement, pas affiché. */
    queueDepartment?: string | null;
    agentExtension?: string;
    agentName?: string;
    label: string;
    sublabel?: string;
    journeyType?: "direct" | "queue";
}

export interface QueueAgentPickerProps {
    /** List of queues with their members */
    queues: QueueInfo[];
    /** What to show in the dropdown */
    show?: ShowFilter;
    /** Currently selected queue number (for highlighting) */
    selectedQueueNumber?: string | null;
    /** Callback when an item is selected */
    onSelect: (item: QueueAgentPickerItem) => void;
    /** Placeholder text */
    placeholder?: string;
    /** Size variant */
    size?: "default" | "compact";
    /** Additional CSS classes */
    className?: string;
    /** Display value when an item is selected (overrides default) */
    displayValue?: string;
    /** Additional CSS classes for the input element */
    inputClassName?: string;
    /** Show special type-only options (for journey filter) */
    showTypeOptions?: boolean;
    /** Show "any" option at top (for advanced filters) */
    showAnyOption?: boolean;
}

// ============================================
// COMPONENT
// ============================================

export function QueueAgentPicker({
    queues,
    show = "both",
    selectedQueueNumber,
    onSelect,
    placeholder,
    size = "default",
    className,
    displayValue,
    inputClassName,
    showTypeOptions = false,
    showAnyOption = false,
}: QueueAgentPickerProps) {
    const [open, setOpen] = React.useState(false);
    const [inputValue, setInputValue] = React.useState("");
    const containerRef = React.useRef<HTMLDivElement>(null);
    const inputRef = React.useRef<HTMLInputElement>(null);

    // Compute default placeholder based on show filter
    const defaultPlaceholder = React.useMemo(() => {
        switch (show) {
            case "queues":
                return "Rechercher une file...";
            case "agents":
                return "Rechercher un agent...";
            default:
                return "Rechercher une file ou un agent...";
        }
    }, [show]);

    const actualPlaceholder = placeholder || defaultPlaceholder;

    // Find selected queue for display
    const selectedQueue = queues.find(q => q.queueNumber === selectedQueueNumber);

    // Close dropdown when clicking outside
    React.useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setOpen(false);
            }
        };

        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    // Build searchable items from queues
    const searchItems = React.useMemo(() => {
        const items: QueueAgentPickerItem[] = [];

        // Add "any" option at the top (for advanced filters)
        if (showAnyOption) {
            if (show === "agents" || show === "both") {
                items.push({
                    type: "any-agent",
                    queueNumber: "",
                    queueName: "",
                    label: "L'un des agents de la file",
                    sublabel: "N'importe quel agent ayant répondu",
                });
            }
            if (show === "queues" || show === "both") {
                items.push({
                    type: "any-queue",
                    queueNumber: "",
                    queueName: "",
                    label: "L'une des files d'attente",
                    sublabel: "N'importe quelle file de redirection",
                });
            }
        }

        // Add type-only options at the top (for journey filter)
        if (showTypeOptions) {
            items.push({
                type: "type-only",
                queueNumber: "",
                queueName: "",
                label: "Tous les appels directs",
                sublabel: "Appels sans passage en file",
                journeyType: "direct",
            });
            items.push({
                type: "type-only",
                queueNumber: "",
                queueName: "",
                label: "Tous les passages en queue",
                sublabel: "Toutes les files d'attente",
                journeyType: "queue",
            });
        }

        queues.forEach((queue) => {
            // Add queue itself (if showing queues)
            if (show === "queues" || show === "both") {
                items.push({
                    type: "queue",
                    queueNumber: queue.queueNumber,
                    queueName: queue.queueName,
                    queueDepartment: queue.queueDepartment,
                    label: queue.queueName,
                    sublabel: `File ${queue.queueNumber} • ${queue.memberCount} agent${queue.memberCount > 1 ? "s" : ""}`,
                });
            }

            // Add each agent in the queue (if showing agents)
            if (show === "agents" || show === "both") {
                queue.members.forEach((member) => {
                    items.push({
                        type: "agent",
                        queueNumber: queue.queueNumber,
                        queueName: queue.queueName,
                        queueDepartment: queue.queueDepartment,
                        agentExtension: member.agentExtension,
                        agentName: member.agentName,
                        label: member.agentName,
                        sublabel: `Ext. ${member.agentExtension} • ${queue.queueName}`,
                    });
                });
            }
        });

        return items;
    }, [queues, show]);

    // Filter items based on input
    const filteredItems = React.useMemo(() => {
        const search = inputValue.toLowerCase().trim();
        if (!search) return searchItems;

        // Le département matche comme le NOM de la file : une recherche
        // « neuchatel » remonte la file du département GRR NEUCHATEL — et ses
        // agents, exactement comme une recherche sur le nom de la file.
        return searchItems.filter((item) => {
            if (item.type === "queue" || item.type === "any-queue") {
                return (
                    item.queueName.toLowerCase().includes(search) ||
                    item.queueNumber.includes(search) ||
                    item.queueDepartment?.toLowerCase().includes(search) ||
                    item.label.toLowerCase().includes(search)
                );
            } else {
                return (
                    item.agentName?.toLowerCase().includes(search) ||
                    item.agentExtension?.includes(search) ||
                    item.queueName.toLowerCase().includes(search) ||
                    item.queueNumber.includes(search) ||
                    item.queueDepartment?.toLowerCase().includes(search) ||
                    item.label.toLowerCase().includes(search)
                );
            }
        });
    }, [searchItems, inputValue]);

    // Group filtered items
    const groupedItems = React.useMemo(() => {
        const anyItems = filteredItems.filter((i) => i.type === "any-agent" || i.type === "any-queue");
        const typeOnlyItems = filteredItems.filter((i) => i.type === "type-only");
        const queueItems = filteredItems.filter((i) => i.type === "queue");
        const agentItems = filteredItems.filter((i) => i.type === "agent");
        return { anyItems, typeOnlyItems, queueItems, agentItems };
    }, [filteredItems]);

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setInputValue(e.target.value);
        if (!open) setOpen(true);
    };

    const handleSelect = (item: QueueAgentPickerItem) => {
        onSelect(item);
        setInputValue("");
        setOpen(false);
    };

    const handleClear = () => {
        setInputValue("");
        inputRef.current?.focus();
    };

    const handleInputClick = () => {
        setOpen(true);
    };

    // Display text calculation
    const getDisplayText = () => {
        if (displayValue) return displayValue;
        if (selectedQueue) return `${selectedQueue.queueNumber} - ${selectedQueue.queueName}`;
        return "";
    };

    // Size-based styles
    const inputHeight = size === "compact" ? "h-8" : "h-11";
    const inputTextSize = size === "compact" ? "text-sm" : "text-base";
    const iconSize = size === "compact" ? "h-3.5 w-3.5" : "h-4 w-4";

    return (
        <div ref={containerRef} className={cn("relative w-full", className)}>
            <Search className={cn(
                "absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none z-10",
                iconSize
            )} />
            <Input
                ref={inputRef}
                placeholder={inputValue ? actualPlaceholder : (getDisplayText() || actualPlaceholder)}
                className={cn(
                    "pl-9 pr-8 bg-white",
                    inputHeight,
                    inputTextSize,
                    selectedQueueNumber && !inputValue && "text-slate-900",
                    inputClassName
                )}
                value={inputValue}
                onChange={handleInputChange}
                onClick={handleInputClick}
                onFocus={handleInputClick}
            />
            {inputValue && (
                <button
                    type="button"
                    onClick={(e) => {
                        e.stopPropagation();
                        handleClear();
                    }}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 z-10"
                >
                    <X className={iconSize} />
                </button>
            )}
            {!inputValue && selectedQueueNumber && (
                <ChevronDown className={cn(
                    "absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none",
                    iconSize
                )} />
            )}

            {/* Dropdown */}
            {open && (
                <div className="absolute top-full left-0 w-full min-w-[280px] mt-1 bg-white border border-slate-200 rounded-md shadow-lg max-h-80 overflow-auto z-50">
                    {filteredItems.length === 0 ? (
                        <div className="p-4 text-center text-sm text-slate-500">
                            Aucun résultat trouvé
                        </div>
                    ) : (
                        <div className="py-1">
                            {/* Any option section (for advanced filters) */}
                            {groupedItems.anyItems.length > 0 && (
                                <>
                                    <div className="px-3 py-2 text-xs font-semibold text-slate-500 bg-slate-50 border-b sticky top-0">
                                        Option
                                    </div>
                                    {groupedItems.anyItems.map((item, index) => (
                                        <button
                                            key={`any-${item.type}-${index}`}
                                            type="button"
                                            className="w-full px-3 py-2 text-left hover:bg-slate-100 flex items-center gap-3 transition-colors"
                                            onClick={() => handleSelect(item)}
                                        >
                                            <div className="p-1.5 rounded bg-slate-100 text-slate-600">
                                                <Users className="h-4 w-4" />
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <p className="text-sm font-medium text-slate-900 truncate">
                                                    {item.label}
                                                </p>
                                                <p className="text-xs text-slate-500 truncate">
                                                    {item.sublabel}
                                                </p>
                                            </div>
                                        </button>
                                    ))}
                                </>
                            )}

                            {/* Type-only section (for journey filter) */}
                            {groupedItems.typeOnlyItems.length > 0 && (
                                <>
                                    <div className={cn(
                                        "px-3 py-2 text-xs font-semibold text-slate-500 bg-slate-50 border-b sticky top-0",
                                        groupedItems.anyItems.length > 0 && "border-t"
                                    )}>
                                        Type de parcours
                                    </div>
                                    {groupedItems.typeOnlyItems.map((item, index) => (
                                        <button
                                            key={`type-only-${item.journeyType}-${index}`}
                                            type="button"
                                            className="w-full px-3 py-2 text-left hover:bg-slate-100 flex items-center gap-3 transition-colors"
                                            onClick={() => handleSelect(item)}
                                        >
                                            <div className={cn(
                                                "p-1.5 rounded",
                                                item.journeyType === "direct" ? "bg-emerald-100 text-emerald-600" : "bg-blue-100 text-blue-600"
                                            )}>
                                                {item.journeyType === "direct" ? (
                                                    <Phone className="h-4 w-4" />
                                                ) : (
                                                    <Users className="h-4 w-4" />
                                                )}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <p className="text-sm font-medium text-slate-900 truncate">
                                                    {item.label}
                                                </p>
                                                <p className="text-xs text-slate-500 truncate">
                                                    {item.sublabel}
                                                </p>
                                            </div>
                                        </button>
                                    ))}
                                </>
                            )}

                            {/* Queues section */}
                            {groupedItems.queueItems.length > 0 && (
                                <>
                                    <div className={cn(
                                        "px-3 py-2 text-xs font-semibold text-slate-500 bg-slate-50 border-b sticky top-0",
                                        groupedItems.typeOnlyItems.length > 0 && "border-t"
                                    )}>
                                        Équipes ({groupedItems.queueItems.length})
                                    </div>
                                    {groupedItems.queueItems.map((item) => (
                                        <button
                                            key={`queue-${item.queueNumber}`}
                                            type="button"
                                            className={cn(
                                                "w-full px-3 py-2 text-left hover:bg-slate-100 flex items-center gap-3 transition-colors",
                                                selectedQueueNumber === item.queueNumber && "bg-blue-50"
                                            )}
                                            onClick={() => handleSelect(item)}
                                        >
                                            <div className="p-1.5 bg-blue-100 rounded text-blue-600">
                                                <Users className="h-4 w-4" />
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <p className="text-sm font-medium text-slate-900 truncate">
                                                    {item.label}
                                                </p>
                                                <p className="text-xs text-slate-500 truncate">
                                                    {item.sublabel}
                                                </p>
                                            </div>
                                        </button>
                                    ))}
                                </>
                            )}

                            {/* Agents section */}
                            {groupedItems.agentItems.length > 0 && (
                                <>
                                    <div className={cn(
                                        "px-3 py-2 text-xs font-semibold text-slate-500 bg-slate-50 border-b sticky top-0",
                                        (groupedItems.queueItems.length > 0 || groupedItems.typeOnlyItems.length > 0) && "border-t"
                                    )}>
                                        Agents ({groupedItems.agentItems.length})
                                    </div>
                                    {groupedItems.agentItems.map((item, index) => (
                                        <button
                                            key={`agent-${item.agentExtension}-${item.queueNumber}-${index}`}
                                            type="button"
                                            className={cn(
                                                "w-full px-3 py-2 text-left hover:bg-slate-100 flex items-center gap-3 transition-colors",
                                                selectedQueueNumber === item.queueNumber && "bg-blue-50"
                                            )}
                                            onClick={() => handleSelect(item)}
                                        >
                                            <div className="p-1.5 bg-emerald-100 rounded text-emerald-600">
                                                <User className="h-4 w-4" />
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <p className="text-sm font-medium text-slate-900 truncate">
                                                    {item.label}
                                                </p>
                                                <p className="text-xs text-slate-500 truncate">
                                                    {item.sublabel}
                                                </p>
                                            </div>
                                        </button>
                                    ))}
                                </>
                            )}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
