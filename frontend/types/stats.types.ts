// Types for CDR Statistics

export interface DateRange {
    startDate: Date;
    endDate: Date;
}

export interface GlobalMetrics {
    totalCalls: number;
    answeredCalls: number;
    missedCalls: number;
    avgDurationSeconds: number; // Represents average human talk time
    answerRate: number;
    avgWaitTimeSeconds: number;
    avgAgentsPerCall: number;

    // N-1 period comparison
    prevTotalCalls: number;
    prevAnsweredCalls: number;
    prevMissedCalls: number;
    prevAvgDurationSeconds: number;
    prevAnswerRate: number;
    prevAvgWaitTimeSeconds: number;
    prevAvgAgentsPerCall: number;

    // Ping pong / Agents distribution for answered calls
    agentsDistribution: {
        oneAgent: number;
        twoAgents: number;
        threePlusAgents: number;
    };
}

export interface HeatmapDataPoint {
    dayOfWeek: number; // 0-6 or 1-7 depending on ISO (1 = Monday, 7 = Sunday)
    hourOfDay: number; // 0-23
    value: number; // Call volume
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
