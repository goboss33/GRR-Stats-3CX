// Types for Call Logs module

export type CallDirection = "inbound" | "outbound" | "internal";
export type CallStatus = "answered" | "missed" | "abandoned";
export type EntityType = "extension" | "external" | "queue" | "ivr" | "script" | "unknown";
export type SortDirection = "asc" | "desc";
export type SortField = "startedAt" | "duration" | "sourceNumber" | "destinationNumber";

export interface CallLog {
    id: string;
    callHistoryId: string;       // Full UUID for chain lookup
    callHistoryIdShort: string;  // Last 4 chars for display
    startedAt: string;
    // Source (Appelant)
    sourceNumber: string;
    sourceName: string;
    sourceType: string;
    // Destination (Appelé)
    destinationNumber: string;
    destinationName: string;
    destinationType: string;
    // Computed fields
    direction: CallDirection;
    status: CallStatus;
    durationSeconds: number;
    durationFormatted: string;
    ringDurationSeconds: number;  // Time before answer/abandon
    // Extra info
    trunkDid: string;
    terminationReason: string;
}

export interface LogsFilters {
    directions: CallDirection[];
    statuses: CallStatus[];
    entityTypes: EntityType[];
    extensionExact?: string;    // Exact match for internal extensions
    externalNumber?: string;    // Partial match for external numbers
    callerSearch?: string;      // Search on source number/name
    calleeSearch?: string;      // Search on destination number/name
    durationMin?: number;       // In seconds
    durationMax?: number;
}

export interface LogsPagination {
    page: number;
    pageSize: number;
}

export interface LogsSort {
    field: SortField;
    direction: SortDirection;
}

export interface CallLogsResponse {
    logs: CallLog[];
    totalCount: number;
    totalPages: number;
    currentPage: number;
}

// Column visibility settings
export interface ColumnVisibility {
    trunkDid: boolean;
    ringDuration: boolean;
    terminationReason: boolean;
    callHistoryId: boolean;
}

// For call chain modal
export interface CallChainSegment {
    id: string;
    startedAt: string;
    sourceNumber: string;
    sourceName: string;
    sourceType: string;
    destinationNumber: string;
    destinationName: string;
    destinationType: string;
    status: CallStatus;
    durationFormatted: string;
    terminationReason: string;
}
