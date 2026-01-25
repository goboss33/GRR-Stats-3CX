// Types for Call Logs module

export type CallDirection = "inbound" | "outbound" | "internal" | "bridge";
export type CallStatus = "answered" | "voicemail" | "abandoned" | "unanswered" | "busy";
export type EntityType = "extension" | "external" | "queue" | "ivr" | "script" | "unknown";
export type SortDirection = "asc" | "desc";
export type SortField = "startedAt" | "duration" | "sourceNumber" | "destinationNumber";

// Aggregated call log (1 call = 1 row, grouped by call_history_id)
export interface AggregatedCallLog {
    callHistoryId: string;
    callHistoryIdShort: string;
    segmentCount: number;

    // Timing
    startedAt: string;
    endedAt: string;
    totalDurationSeconds: number;
    totalDurationFormatted: string;
    waitTimeSeconds: number;
    waitTimeFormatted: string;

    // Caller (1er segment)
    callerNumber: string;
    callerName: string | null;

    // Callee (dernier segment - destination finale)
    calleeNumber: string;
    calleeName: string | null;

    // Handled by (all agents who had conversation)
    handledBy: Array<{ number: string; name: string }>;  // All agents with their numbers
    handledByDisplay: string;  // Formatted for display (max 5 + "et N autres")
    totalTalkDurationSeconds: number;  // Sum of all conversation durations
    totalTalkDurationFormatted: string;

    // Status
    direction: CallDirection;
    finalStatus: CallStatus;
    wasTransferred: boolean;
}

// Legacy: Single segment call log (kept for call chain modal)
export interface CallLog {
    id: string;
    callHistoryId: string;
    callHistoryIdShort: string;
    startedAt: string;
    sourceNumber: string;
    sourceName: string;
    sourceType: string;
    destinationNumber: string;
    destinationName: string;
    destinationType: string;
    direction: CallDirection;
    status: CallStatus;
    durationSeconds: number;
    durationFormatted: string;
    ringDurationSeconds: number;
    trunkDid: string;
    terminationReason: string;
}

export interface LogsFilters {
    directions: CallDirection[];
    statuses: CallStatus[];
    entityTypes: EntityType[];
    callerSearch?: string;
    calleeSearch?: string;
    handledBySearch?: string;  // Filter by agent number/name
    idSearch?: string;         // Filter by call history ID (supports * wildcard)
    segmentCountMin?: number;  // Min number of segments
    segmentCountMax?: number;  // Max number of segments
    durationMin?: number;
    durationMax?: number;
    waitTimeMin?: number;
    waitTimeMax?: number;
}

export interface LogsPagination {
    page: number;
    pageSize: number;
}

export interface LogsSort {
    field: SortField;
    direction: SortDirection;
}

export interface AggregatedCallLogsResponse {
    logs: AggregatedCallLog[];
    totalCount: number;
    totalPages: number;
    currentPage: number;
}

// Legacy response type (kept for compatibility)
export interface CallLogsResponse {
    logs: CallLog[];
    totalCount: number;
    totalPages: number;
    currentPage: number;
}

// Column visibility settings (simplified)
export interface ColumnVisibility {
    callHistoryId: boolean;
    segmentCount: boolean;
}

// Segment category for display in modal
export type SegmentCategory =
    | "routing"      // Ultra-short system routing (<1s, redirected)
    | "ringing"      // Extension ringing but not answered
    | "conversation" // Answered call with real interaction
    | "queue"        // Queue/waiting segment
    | "voicemail"    // Voicemail segment
    | "ivr"          // IVR/script interaction
    | "bridge"       // Bridge (EDIFEA) segment
    | "transfer"     // Transfer segment
    | "missed"       // Missed/abandoned/rejected
    | "unknown";     // Fallback

// For call chain modal
export interface CallChainSegment {
    id: string;
    startedAt: string;
    answeredAt: string | null;
    sourceNumber: string;
    sourceName: string;
    sourceType: string;
    destinationNumber: string;
    destinationName: string;
    destinationType: string;
    status: CallStatus;
    durationSeconds: number;
    durationFormatted: string;
    terminationReason: string;
    terminationReasonDetails: string;
    creationMethod: string;
    creationForwardReason: string;
    originatingCdrId: string | null; // Links to the parent segment (e.g., queue) that spawned this
    category: SegmentCategory;
}
