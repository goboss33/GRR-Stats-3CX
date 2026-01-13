// Types for CDR Statistics

export interface DateRange {
    startDate: Date;
    endDate: Date;
}

export interface GlobalMetrics {
    totalCalls: number;
    answeredCalls: number;
    missedCalls: number;
    avgDurationSeconds: number;
    answerRate: number;
}

export interface TimelineDataPoint {
    date: string;
    label: string;
    answered: number;
    missed: number;
}

export interface ExtensionStats {
    extensionNumber: string;
    totalCalls: number;
    answeredCalls: number;
    answerRate: number;
}

export interface RecentCall {
    id: string;
    startedAt: string;
    sourceExtension: string;
    destinationExtension: string;
    status: "answered" | "missed";
    durationSeconds: number;
    durationFormatted: string;
}

// Serialized versions for client components (Date -> string)
export interface SerializedDateRange {
    startDate: string;
    endDate: string;
}
