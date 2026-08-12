import type { PassageOutcome } from "./call-classification";

/**
 * Unified Call Domain Types
 * 
 * Single source of truth for all call-related types across the application.
 * Replaces fragmented definitions in stats.types.ts, statistics.types.ts, and logs.types.ts.
 */

// ============================================
// CORE ENUMS
// ============================================

/**
 * Provenance d'un appel — le vocabulaire exact du toggle Externe / Interne :
 * la source du PREMIER segment décide, et rien d'autre.
 */
export type CallProvenance = "external" | "internal";

/**
 * Sens d'un appel : entrant (une source externe nous joint — pont compris),
 * sortant (un poste appelle l'extérieur, y compris l'autre entité via le
 * pont), intra (poste → poste ou système interne). Externe ⇒ entrant, par
 * construction. Le pont n'est pas un sens : c'est l'attribut `viaBridge`.
 */
export type CallSens = "inbound" | "outbound" | "intra";
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

export interface JourneyConditionNode {
    type?: JourneyStepType;
    queueNumber?: string;
    queueAgentNumber?: string;
    agentNumber?: string;
    result?: JourneyStepResult;
    negate?: boolean;
    firstSegment?: boolean;
    lastSegment?: boolean;
    overflowQueueNumber?: string;
}

export interface JourneyGroupCondition {
    condition: JourneyConditionNode;
    operator: 'AND' | 'OR';
}

export interface JourneyGroup {
    conditions: JourneyGroupCondition[];
}

export interface JourneyFilterGroup {
    group: JourneyGroup;
    operator: 'AND' | 'OR';
}

export interface JourneyFilter {
    groups: JourneyFilterGroup[];
}

// Legacy alias for backward compatibility
export type JourneyCondition = JourneyConditionNode;

export interface TimeSlot {
    start: string;
    end: string;
}

export interface DateRange {
    startDate: Date;
    endDate: Date;
}

export interface LogsFilters {
    sens: CallSens[];
    statuses: CallStatus[];
    entityTypes: EntityType[];
    callerSearch?: string;
    calleeSearch?: string;
    handledBySearch?: string;
    handledByMultiSearch?: string[]; // Multi-agents filter (Stat V2)
    queueSearch?: string;
    idSearch?: string;
    segmentCountMin?: number;
    segmentCountMax?: number;
    durationMin?: number;
    durationMax?: number;
    waitTimeMin?: number;
    waitTimeMax?: number;
    journeyFilter?: JourneyFilter;
    /**
     * Filtre « statut dans une file », alimenté par le socle de classement
     * (services/domain/call-classification.ts). C'est celui qu'utilisent les
     * liens des KPIs : il garantit que le nombre de lignes listées est
     * exactement le chiffre affiché sur la carte.
     */
    queueOutcomeFilter?: { queueNumber: string; outcomes: PassageOutcome[]; includeTeamDirect?: boolean };
    /**
     * Numéro de file consultée en « vue file ». N'agit pas comme un filtre : il
     * ajoute au tableau le statut de chaque appel DANS cette file, à côté de son
     * statut final. Déduit du filtre KPI quand on arrive par une vignette.
     */
    queueView?: string;
    /** Restreint la vue file aux appels arrivés par la file, ou en direct. */
    queueOriginFilter?: "queue" | "direct";
    /**
     * Provenance de l'appel : « interne » si la SOURCE de son premier segment
     * est une extension, « externe » sinon. C'est le critère du toggle
     * Externe / Interne des statistiques de groupe — le lien d'une vignette le
     * transmet pour que la liste décrive la même population que le chiffre.
     */
    callOrigin?: "internal" | "external";
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
    provenance: CallProvenance;
    sens: CallSens;
    /** L'appel traverse le pont EDIFEA (dans un sens ou dans l'autre). */
    viaBridge: boolean;
    finalStatus: CallStatus;
    wasTransferred: boolean;
    queues: Array<{ number: string; name: string }>;
    queuesDisplay: string;
    journey: JourneyStep[];
    /** Statut de l'appel dans la file consultée (vue file uniquement). */
    queueViewStatus?: PassageOutcome | null;
    /** Appel direct de l'équipe : sans statut de file, mais bien à son actif. */
    queueViewIsDirect?: boolean;
    /** File ayant finalement répondu, si ce n'est pas celle consultée. */
    answeringQueue?: { number: string; name: string; inScope: boolean } | null;
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
    /**
     * Identifiant 3CX de la jambe portant ce segment. Au grain fusionné, il
     * diffère d'une jambe de transfert à l'autre : la modale s'en sert pour
     * marquer discrètement chaque frontière. Au grain « jambe », il est
     * identique pour tous les segments.
     */
    legCallHistoryId: string | null;
    /** true si le segment appartient à une jambe fusionnée (pas l'appel principal). */
    isMergedLeg: boolean;
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
    /**
     * Débordés vers une autre file (sans décroché ici). Présent sur la courbe
     * d'une équipe, où la somme des trois séries doit égaler « Total reçus ».
     * Absent du tableau de bord global, qui ne raisonne pas par file.
     */
    overflow?: number;
}

export interface HeatmapDataPoint {
    dayOfWeek: number;
    hourOfDay: number;
    value: number;
}

export interface ConcurrentCallsDataPoint {
    timestamp: string;
    label: string;
    concurrentCalls: number;
}

export interface ConcurrentCallsSummary {
    peak: number;
    peakTime: string;
    avg: number;
    threshold: number;
    trunkThreshold: number;
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
    /** Abandons caractérisés : hors abandons courts et hors messagerie. */
    callsAbandoned: number;
    /** Raccrochés sous le seuil configuré (défaut 10 s). */
    callsShortAbandon: number;
    /** Compteurs par statut fin ; l'affichage les regroupe en quatre vignettes. */
    outcomeCounts: Record<PassageOutcome, number>;
    abandonedBefore10s: number;
    abandonedAfter10s: number;
    callsToVoicemail: number;
    /** Débordements : partis vers une autre file SANS décroché ici. */
    callsOverflow: number;
    /** Transferts accomplis (file) : décrochés ici puis servis ailleurs. */
    callsHandedOff: number;
    totalPassages: number;
    pingPongCount: number;
    pingPongPercentage: number;
    teamDirectReceived: number;
    teamDirectAnswered: number;
    /** Transferts accomplis (directs) : décrochés ici puis servis ailleurs. */
    directHandedOff: number;
    /** Directs non répondus repartis vers la file d'une autre équipe (Débordés). */
    directOverflow: number;
    directLost: number;
    /** Le transfert accompli compte-t-il dans le taux de prise en charge ? */
    handedOffInPerformance: "success" | "neutral";
    overflowDestinations: OverflowDestination[];
    avgWaitTimeSeconds: number;
    avgTalkTimeSeconds: number;
}

export interface AgentStats {
    extension: string;
    name: string;
    callsReceived: number;
    answered: number;
    /** Transferts accomplis crédités à l'agent, côté file. */
    queueTransferred: number;
    directReceived: number;
    directAnswered: number;
    /** Transferts accomplis crédités à l'agent, côté directs. */
    directTransferred: number;
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
    /** Département 3CX (déduit des CDR) — null quand il n'a jamais été observé. */
    queueDepartment: string | null;
    period: {
        start: string;
        end: string;
    };
    kpis: QueueKPIs;
    agents: AgentStats[];
    dailyTrend: DailyTrend[];
    hourlyTrend: HourlyTrend[];
    timelineData: TimelineDataPoint[];
    heatmapData: HeatmapDataPoint[];
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
    /** Département 3CX (déduit des CDR) — sert à la recherche, jamais affiché seul. */
    queueDepartment: string | null;
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
    provenance: boolean;
    sens: boolean;
    status: boolean;
    duration: boolean;
    waitTime: boolean;
}

// ============================================
// LEGACY TYPES (for backward compatibility)
// ============================================

export type CallStatusLegacy = CallStatus;


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
