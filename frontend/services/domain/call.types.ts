/**
 * Unified Call Domain Types
 * 
 * Single source of truth for all call-related types across the application.
 * Replaces fragmented definitions in stats.types.ts, statistics.types.ts, and logs.types.ts.
 */

// ============================================
// CORE ENUMS
// ============================================

export type CallDirection = "inbound" | "outbound" | "internal" | "bridge";
export type CallStatus = "answered" | "voicemail" | "missed" | "busy";
export type EntityType = "extension" | "external" | "queue" | "ivr" | "script" | "unknown";
export type QueueCallOutcome = 'answered' | 'abandoned' | 'overflow';

export type SortDirection = "asc" | "desc";
export type SortField = "startedAt" | "timeOfDay" | "duration" | "sourceNumber" | "destinationNumber";

export type JourneyStepType = "direct" | "queue" | "voicemail";
export type JourneyStepResult = "answered" | "not_answered" | "busy" | "voicemail" | "abandoned" | "overflow";

export type SegmentCategory =
    | "routing"
    | "ringing"
    | "conversation"
    | "queue"
    | "voicemail"
    | "ivr"
    | "bridge"
    | "transfer"
    | "abandoned"
    | "rejected"
    | "busy"
    | "unknown";

// ============================================
// FILTERS
// ============================================

export interface JourneyCondition {
    type?: JourneyStepType;
    queueNumber?: string;
    agentNumber?: string;
    result?: JourneyStepResult;
    negate?: boolean;
    passageMode?: 'all' | 'first' | 'multi';
    hasOverflow?: boolean;
}

export interface TimeSlot {
    start: string;
    end: string;
}

export interface DateRange {
    startDate: Date;
    endDate: Date;
}

export interface LogsFilters {
    directions: CallDirection[];
    statuses: CallStatus[];
    entityTypes: EntityType[];
    callerSearch?: string;
    calleeSearch?: string;
    handledBySearch?: string;
    queueSearch?: string;
    idSearch?: string;
    segmentCountMin?: number;
    segmentCountMax?: number;
    durationMin?: number;
    durationMax?: number;
    waitTimeMin?: number;
    waitTimeMax?: number;
    journeyConditions?: JourneyCondition[];
    timeSlots?: TimeSlot[];
}

export interface LogsPagination {
    page: number;
    pageSize: number;
}

export interface LogsSort {
    field: SortField;
    direction: SortDirection;
}

export interface StatisticsFilters {
    queueNumber: string;
    startDate: Date;
    endDate: Date;
}

// ============================================
// AGGREGATED CALL LOG
// ============================================

export interface JourneyStep {
    type: JourneyStepType;
    label: string;
    detail: string;
    result: JourneyStepResult;
    agent?: string;
    agentNumber?: string;
}

export interface AggregatedCallLog {
    callHistoryId: string;
    callHistoryIdShort: string;
    segmentCount: number;
    startedAt: string;
    endedAt: string;
    totalDurationSeconds: number;
    totalDurationFormatted: string;
    waitTimeSeconds: number;
    waitTimeFormatted: string;
    callerNumber: string;
    callerName: string | null;
    calleeNumber: string;
    calleeName: string | null;
    handledBy: Array<{ number: string; name: string }>;
    handledByDisplay: string;
    totalTalkDurationSeconds: number;
    totalTalkDurationFormatted: string;
    direction: CallDirection;
    finalStatus: CallStatus;
    wasTransferred: boolean;
    queues: Array<{ number: string; name: string }>;
    queuesDisplay: string;
    journey: JourneyStep[];
}

export interface AggregatedCallLogsResponse {
    logs: AggregatedCallLog[];
    totalCount: number;
    totalPages: number;
    currentPage: number;
}

// ============================================
// CALL CHAIN SEGMENT
// ============================================

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
    originatingCdrId: string | null;
    category: SegmentCategory;
}

// ============================================
// DASHBOARD / GLOBAL METRICS
// ============================================

export interface GlobalMetrics {
    totalCalls: number;
    answeredCalls: number;
    missedCalls: number;
    voicemailCalls: number;
    busyCalls: number;
    avgDurationSeconds: number;
    answerRate: number;
    avgWaitTimeSeconds: number;
    avgAgentsPerCall: number;
    prevTotalCalls: number;
    prevAnsweredCalls: number;
    prevMissedCalls: number;
    prevVoicemailCalls: number;
    prevBusyCalls: number;
    prevAvgDurationSeconds: number;
    prevAnswerRate: number;
    prevAvgWaitTimeSeconds: number;
    prevAvgAgentsPerCall: number;
    agentsDistribution: {
        oneAgent: number;
        twoAgents: number;
        threePlusAgents: number;
    };
}

export interface TimelineDataPoint {
    date: string;
    label: string;
    answered: number;
    missed: number;
}

export interface HeatmapDataPoint {
    dayOfWeek: number;
    hourOfDay: number;
    value: number;
}

// ============================================
// QUEUE STATISTICS
// ============================================

export interface OverflowDestination {
    destination: string;
    destinationName: string;
    count: number;
}

export interface QueueKPIs {
    callsReceived: number;
    callsAnswered: number;
    callsAbandoned: number;
    abandonedBefore10s: number;
    abandonedAfter10s: number;
    callsToVoicemail: number;
    callsOverflow: number;
    totalPassages: number;
    pingPongCount: number;
    pingPongPercentage: number;
    teamDirectReceived: number;
    teamDirectAnswered: number;
    overflowDestinations: OverflowDestination[];
    avgWaitTimeSeconds: number;
    avgTalkTimeSeconds: number;
}

export interface AgentStats {
    extension: string;
    name: string;
    callsReceived: number;
    answered: number;
    directReceived: number;
    directAnswered: number;
    directTalkTimeSeconds: number;
    answerRate: number;
    avgHandlingTimeSeconds: number;
    totalHandlingTimeSeconds: number;
}

export interface DailyTrend {
    date: string;
    received: number;
    answered: number;
    abandoned: number;
}

export interface HourlyTrend {
    hour: number;
    received: number;
    answered: number;
    abandoned: number;
}

export interface QueueStatistics {
    queueNumber: string;
    queueName: string;
    period: {
        start: string;
        end: string;
    };
    kpis: QueueKPIs;
    agents: AgentStats[];
    dailyTrend: DailyTrend[];
    hourlyTrend: HourlyTrend[];
}

// ============================================
// QUEUE MEMBERS
// ============================================

export interface QueueMember {
    agentExtension: string;
    agentName: string;
    attemptsCount: number;
    lastSeenAt: string;
}

export interface QueueInfo {
    queueNumber: string;
    queueName: string;
    members: QueueMember[];
    memberCount: number;
}

// ============================================
// COLUMN VISIBILITY (Logs UI)
// ============================================

export interface ColumnVisibility {
    callHistoryId: boolean;
    segmentCount: boolean;
    dateTime: boolean;
    timeSlot: boolean;
    caller: boolean;
    callee: boolean;
    handledBy: boolean;
    queues: boolean;
    journey: boolean;
    direction: boolean;
    status: boolean;
    duration: boolean;
    waitTime: boolean;
}

// ============================================
// LEGACY TYPES (for backward compatibility)
// ============================================

export type CallDirectionLegacy = CallDirection;
export type CallStatusLegacy = CallStatus;

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

export interface CallLogsResponse {
    logs: CallLog[];
    totalCount: number;
    totalPages: number;
    currentPage: number;
}

export interface SerializedDateRange {
    startDate: string;
    endDate: string;
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

export interface QueueCallOutcomeRow {
    call_history_id: string;
    cdr_id: string;
    cdr_started_at: Date;
    cdr_ended_at: Date;
    outcome: QueueCallOutcome;
    wait_time_seconds: number | null;
    talk_time_seconds: number | null;
    time_in_queue: number;
}
