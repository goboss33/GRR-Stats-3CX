/**
 * Shared Call Aggregation Layer
 * 
 * This module provides shared types, constants, and helpers used by both
 * logs.service.ts and statistics.service.ts to ensure consistent call counting
 * and status determination.
 * 
 * DRY Principle: All call-related logic should be defined here and imported
 * by consuming services.
 * 
 * @module shared/call-aggregation
 */

// ============================================
// TYPES
// ============================================

/**
 * Possible outcomes for a call that enters a queue
 */
export type QueueCallOutcome = 'answered' | 'abandoned' | 'overflow';

/**
 * Raw result from queue call outcome query
 */
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

// ============================================
// CONSTANTS
// ============================================

/**
 * Destination types that are considered "system" types.
 * For these types, an answered_at from the system itself doesn't mean
 * a human answered - we must check for an extension segment.
 * 
 * Used in both logs and statistics for consistent status determination.
 */
export const SYSTEM_DESTINATION_TYPES = [
    'queue',
    'ring_group',
    'ring_group_ring_all',
    'ivr',
    'process',
    'parking'
] as const;

/**
 * Entity types that are considered "system" types.
 */
export const SYSTEM_ENTITY_TYPES = [
    'queue',
    'ivr'
] as const;

/**
 * SQL-formatted list of system destination types for use in queries
 */
export const SQL_SYSTEM_DEST_TYPES = SYSTEM_DESTINATION_TYPES
    .map(t => `'${t}'`)
    .join(', ');

/**
 * SQL-formatted list of system entity types for use in queries
 */
export const SQL_SYSTEM_ENTITY_TYPES = SYSTEM_ENTITY_TYPES
    .map(t => `'${t}'`)
    .join(', ');

// ============================================
// SQL CTE BUILDERS
// ============================================

/**
 * Builds the SQL CTE for getting unique queue calls (one per call_history_id).
 * This ensures we count each unique call only once, even if it entered
 * the queue multiple times.
 * 
 * @param queueNumber - The queue number to filter on
 * @param startDateParam - SQL parameter name for start date
 * @param endDateParam - SQL parameter name for end date
 * @returns SQL CTE string
 */
export function buildUniqueQueueCallsCTE(
    queueNumberParam: string = '$1',
    startDateParam: string = '$2',
    endDateParam: string = '$3'
): string {
    return `
        unique_queue_calls AS (
            -- One record per unique call (call_history_id)
            -- Takes the FIRST entry into this queue if multiple entries exist
            SELECT DISTINCT ON (call_history_id)
                call_history_id,
                cdr_id,
                cdr_started_at,
                cdr_ended_at
            FROM cdroutput
            WHERE destination_dn_number = ${queueNumberParam}
              AND destination_dn_type = 'queue'
              AND cdr_started_at >= ${startDateParam}
              AND cdr_started_at <= ${endDateParam}
            ORDER BY call_history_id, cdr_started_at ASC
        )`;
}

/**
 * Builds the SQL for determining if a call was answered by an agent.
 * An answer is valid when:
 * 1. The segment's originating_cdr_id matches the queue's cdr_id
 * 2. The destination is an extension (human)
 * 3. The segment has an answered_at timestamp
 * 
 * This is a CASE expression to be used in a SELECT with MAX()
 */
export const SQL_ANSWERED_CASE = `
    CASE 
        WHEN ans.originating_cdr_id = uqc.cdr_id 
             AND ans.destination_dn_type = 'extension'
             AND ans.cdr_answered_at IS NOT NULL
        THEN 1 ELSE 0 
    END`;

/**
 * Builds the SQL for determining if a call overflowed to another queue.
 * Overflow is when:
 * 1. There's another queue in the same call_history_id
 * 2. That queue started AFTER this queue
 * 3. It's a different queue number
 */
export const SQL_OVERFLOW_CASE = (queueNumberParam: string = '$1') => `
    CASE 
        WHEN other_q.destination_dn_type = 'queue'
             AND other_q.destination_dn_number != ${queueNumberParam}
             AND other_q.cdr_started_at > uqc.cdr_started_at
        THEN 1 ELSE 0 
    END`;

// ============================================
// HELPERS
// ============================================

/**
 * Determines the final outcome of a queue call based on flags
 * Priority: answered > overflow > abandoned
 * 
 * @param answeredHere - 1 if answered by an agent from this queue
 * @param forwardedToOtherQueue - 1 if forwarded to another queue
 * @returns The queue call outcome
 */
export function determineQueueOutcome(
    answeredHere: number,
    forwardedToOtherQueue: number
): QueueCallOutcome {
    if (answeredHere === 1) return 'answered';
    if (forwardedToOtherQueue === 1) return 'overflow';
    return 'abandoned';
}

/**
 * Checks if a destination type is a system type (queue, ring_group, etc.)
 * 
 * @param destType - The destination_dn_type value
 * @param destEntityType - The destination_entity_type value (optional)
 * @returns true if it's a system type
 */
export function isSystemType(
    destType: string | null | undefined,
    destEntityType?: string | null | undefined
): boolean {
    const normalizedDestType = destType?.toLowerCase() || '';
    const normalizedEntityType = destEntityType?.toLowerCase() || '';

    return SYSTEM_DESTINATION_TYPES.includes(normalizedDestType as any) ||
        SYSTEM_ENTITY_TYPES.includes(normalizedEntityType as any);
}
