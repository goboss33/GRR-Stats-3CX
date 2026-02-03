/**
 * QueueSearchCombobox - Wrapper for queues page
 * 
 * This component wraps QueueAgentPicker for backward compatibility.
 * It returns a search string value on change.
 */
"use client";

import { QueueAgentPicker, QueueAgentPickerItem } from "@/components/queue-agent-picker";
import { QueueInfo } from "@/types/queues.types";

interface QueueSearchComboboxProps {
    queues: QueueInfo[];
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    className?: string;
}

export function QueueSearchCombobox({
    queues,
    value,
    onChange,
    placeholder,
    className,
}: QueueSearchComboboxProps) {
    const handleSelect = (item: QueueAgentPickerItem) => {
        // Return the name as the search value
        const searchValue = item.type === "queue" ? item.queueName : (item.agentName || "");
        onChange(searchValue);
    };

    return (
        <QueueAgentPicker
            queues={queues}
            show="both"
            onSelect={handleSelect}
            placeholder={placeholder}
            className={className}
            size="default"
            displayValue={value}
        />
    );
}
