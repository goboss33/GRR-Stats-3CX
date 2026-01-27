"use client";

import * as React from "react";
import { Search, X, Users, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { QueueInfo } from "@/types/queues.types";

interface QueueSearchComboboxProps {
    queues: QueueInfo[];
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    className?: string;
}

type SearchResult = {
    type: "queue" | "agent";
    queueNumber: string;
    queueName: string;
    agentExtension?: string;
    agentName?: string;
    label: string;
    sublabel?: string;
};

export function QueueSearchCombobox({
    queues,
    value,
    onChange,
    placeholder = "Rechercher une file ou un agent...",
    className,
}: QueueSearchComboboxProps) {
    const [open, setOpen] = React.useState(false);
    const [inputValue, setInputValue] = React.useState(value);
    const containerRef = React.useRef<HTMLDivElement>(null);
    const inputRef = React.useRef<HTMLInputElement>(null);

    // Sync external value with internal state
    React.useEffect(() => {
        setInputValue(value);
    }, [value]);

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
        const items: SearchResult[] = [];

        queues.forEach((queue) => {
            // Add queue itself
            items.push({
                type: "queue",
                queueNumber: queue.queueNumber,
                queueName: queue.queueName,
                label: queue.queueName,
                sublabel: `File ${queue.queueNumber} • ${queue.memberCount} agent${queue.memberCount > 1 ? "s" : ""}`,
            });

            // Add each agent in the queue
            queue.members.forEach((member) => {
                items.push({
                    type: "agent",
                    queueNumber: queue.queueNumber,
                    queueName: queue.queueName,
                    agentExtension: member.agentExtension,
                    agentName: member.agentName,
                    label: member.agentName,
                    sublabel: `Ext. ${member.agentExtension} • ${queue.queueName}`,
                });
            });
        });

        return items;
    }, [queues]);

    // Filter items based on input
    const filteredItems = React.useMemo(() => {
        const search = inputValue.toLowerCase().trim();
        if (!search) return searchItems; // Show all when empty

        return searchItems.filter((item) => {
            if (item.type === "queue") {
                return (
                    item.queueName.toLowerCase().includes(search) ||
                    item.queueNumber.includes(search)
                );
            } else {
                return (
                    item.agentName?.toLowerCase().includes(search) ||
                    item.agentExtension?.includes(search) ||
                    item.queueName.toLowerCase().includes(search) ||
                    item.queueNumber.includes(search)
                );
            }
        });
    }, [searchItems, inputValue]);

    // Group filtered items
    const groupedItems = React.useMemo(() => {
        const queueItems = filteredItems.filter((i) => i.type === "queue");
        const agentItems = filteredItems.filter((i) => i.type === "agent");
        return { queueItems, agentItems };
    }, [filteredItems]);

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const newValue = e.target.value;
        setInputValue(newValue);
        onChange(newValue);
        if (!open) setOpen(true);
    };

    const handleSelect = (item: SearchResult) => {
        const searchValue = item.type === "queue" ? item.queueName : (item.agentName || "");
        setInputValue(searchValue);
        onChange(searchValue);
        setOpen(false);
    };

    const handleClear = () => {
        setInputValue("");
        onChange("");
        inputRef.current?.focus();
    };

    const handleInputClick = () => {
        setOpen(true);
    };

    return (
        <div ref={containerRef} className={cn("relative w-full", className)}>
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none z-10" />
            <Input
                ref={inputRef}
                placeholder={placeholder}
                className="pl-10 pr-8 h-11 text-base bg-white"
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
                    <X className="h-4 w-4" />
                </button>
            )}

            {/* Dropdown */}
            {open && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-md shadow-lg max-h-80 overflow-auto z-50">
                    {filteredItems.length === 0 ? (
                        <div className="p-4 text-center text-sm text-slate-500">
                            Aucun résultat trouvé
                        </div>
                    ) : (
                        <div className="py-1">
                            {/* Queues section */}
                            {groupedItems.queueItems.length > 0 && (
                                <>
                                    <div className="px-3 py-2 text-xs font-semibold text-slate-500 bg-slate-50 border-b sticky top-0">
                                        Files d'attente ({groupedItems.queueItems.length})
                                    </div>
                                    {groupedItems.queueItems.map((item) => (
                                        <button
                                            key={`queue-${item.queueNumber}`}
                                            type="button"
                                            className="w-full px-3 py-2 text-left hover:bg-slate-100 flex items-center gap-3 transition-colors"
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
                                    <div className="px-3 py-2 text-xs font-semibold text-slate-500 bg-slate-50 border-b border-t sticky top-0">
                                        Agents ({groupedItems.agentItems.length})
                                    </div>
                                    {groupedItems.agentItems.map((item, index) => (
                                        <button
                                            key={`agent-${item.agentExtension}-${item.queueNumber}-${index}`}
                                            type="button"
                                            className="w-full px-3 py-2 text-left hover:bg-slate-100 flex items-center gap-3 transition-colors"
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
