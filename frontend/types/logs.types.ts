// Types for Call Logs module

export type CallDirection = "inbound" | "outbound" | "internal";

export interface CallLog {
    id: string;
    callHistoryId: string;
    startedAt: string;
    sourceNumber: string;
    sourceType: string;
    destinationNumber: string;
    destinationType: string;
    direction: CallDirection;
    status: "answered" | "missed";
    durationSeconds: number;
    durationFormatted: string;
    terminationReason: string;
}

export interface LogsFilters {
    directions: CallDirection[];
    extension?: string;
}

export interface LogsPagination {
    page: number;
    pageSize: number;
}

export interface CallLogsResponse {
    logs: CallLog[];
    totalCount: number;
    totalPages: number;
    currentPage: number;
}
