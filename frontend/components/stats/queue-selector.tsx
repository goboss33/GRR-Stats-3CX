/**
 * QueueSelector - Wrapper for statistics page
 * 
 * This component wraps QueueAgentPicker for backward compatibility.
 * It selects queue by number and returns both number and name.
 */
"use client";

import { QueueAgentPicker, QueueAgentPickerItem } from "@/components/queue-agent-picker";
import { QueueInfo } from "@/types/queues.types";

interface QueueSelectorProps {
    queues: QueueInfo[];
    selectedQueueNumber: string | null;
    onSelect: (queueNumber: string, queueName: string) => void;
    placeholder?: string;
    className?: string;
}

export function QueueSelector({
    queues,
    selectedQueueNumber,
    onSelect,
    placeholder,
    className,
}: QueueSelectorProps) {
    const handleSelect = (item: QueueAgentPickerItem) => {
        onSelect(item.queueNumber, item.queueName);
    };

    return (
        <QueueAgentPicker
            queues={queues}
            show="both"
            selectedQueueNumber={selectedQueueNumber}
            onSelect={handleSelect}
            placeholder={placeholder}
            className={className}
            size="default"
        />
    );
}
