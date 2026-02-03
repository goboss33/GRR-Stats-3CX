/**
 * ColumnFilterQueue
 * 
 * A column filter for queue selection using QueueAgentPicker.
 * Shows only queues (not agents) with compact size for column headers.
 */
"use client";

import { QueueAgentPicker, QueueAgentPickerItem } from "@/components/queue-agent-picker";
import { QueueInfo } from "@/types/queues.types";

interface ColumnFilterQueueProps {
    /** List of available queues */
    queues: QueueInfo[];
    /** Current selected queue number (null for all) */
    selectedQueueNumber: string | null;
    /** Callback when a queue is selected */
    onSelect: (queueNumber: string | null) => void;
    /** Placeholder text */
    placeholder?: string;
    /** Additional CSS classes */
    className?: string;
}

export function ColumnFilterQueue({
    queues,
    selectedQueueNumber,
    onSelect,
    placeholder = "Queue...",
    className,
}: ColumnFilterQueueProps) {
    const handleSelect = (item: QueueAgentPickerItem) => {
        onSelect(item.queueNumber);
    };

    // Find selected queue for display
    const selectedQueue = queues.find(q => q.queueNumber === selectedQueueNumber);
    const displayValue = selectedQueue
        ? `${selectedQueue.queueNumber} - ${selectedQueue.queueName}`
        : "";

    return (
        <QueueAgentPicker
            queues={queues}
            show="queues"
            size="compact"
            selectedQueueNumber={selectedQueueNumber}
            onSelect={handleSelect}
            placeholder={placeholder}
            className={className}
            displayValue={displayValue}
        />
    );
}
