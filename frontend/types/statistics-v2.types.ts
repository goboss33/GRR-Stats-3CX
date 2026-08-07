/**
 * Types pour Statistiques d'Agence V2
 * 
 * Extension des types existants pour supporter les nouvelles fonctionnalités :
 * - Score + % participation
 * - Multi-agents pour les filtres de logs
 * - Répartition Direct vs File
 */

import type { AgentStats, QueueKPIs, OverflowDestination } from "@/services/domain/call.types";

// ============================================
// AGENT STATS V2 (étendu)
// ============================================

export interface AgentStatsV2 extends AgentStats {
    score: number;              // Score 0-100 (existant)
    participationRate: number;  // % de participation (nouveau)
}

// ============================================
// KPI CARDS V2
// ============================================

export interface TeamKpiData {
    totalReceived: number;      // Total appels reçus (file + directs)
    totalAnswered: number;      // Total appels répondus (file + directs)
    totalLost: number;          // Total appels perdus
    totalOverflow: number;      // Total appels débordés
    performanceRate: number;    // % de performance (répondus/reçus)
    avgWaitTimeSeconds: number; // Temps d'attente moyen
}

// ============================================
// CALL DISTRIBUTION
// ============================================

export interface CallDistributionData {
    directReceived: number;
    directAnswered: number;
    queueReceived: number;
    queueAnswered: number;
    directRate: number;         // % répondus directs
    queueRate: number;          // % répondus file
}

// ============================================
// MULTI-AGENTS FILTER (pour logs)
// ============================================

export interface MultiAgentsFilter {
    agentNumbers: string[];     // Liste des extensions d'agents
}

// ============================================
// LOGS FILTERS V2 (étendu)
// ============================================

export interface LogsFiltersV2 {
    directions: string[];
    statuses: string[];
    entityTypes: string[];
    callerSearch?: string;
    calleeSearch?: string;
    handledBySearch?: string;        // Single agent (existant)
    handledByMultiSearch?: string[]; // Multi agents (nouveau)
    queueSearch?: string;
    idSearch?: string;
    segmentCountMin?: number;
    segmentCountMax?: number;
    durationMin?: number;
    durationMax?: number;
    waitTimeMin?: number;
    waitTimeMax?: number;
    journeyConditions?: Array<{
        type?: string;
        queueNumber?: string;
        agentNumber?: string;
        result?: string;
        negate?: boolean;
        passageMode?: 'all' | 'first' | 'multi';
        hasOverflow?: boolean;
    }>;
    timeSlots?: Array<{ start: string; end: string }>;
}

// ============================================
// RE-EXPORTS (pour compatibilité)
// ============================================

export type {
    AgentStats,
    QueueKPIs,
    OverflowDestination,
} from "@/services/domain/call.types";
