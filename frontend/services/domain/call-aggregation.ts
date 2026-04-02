/**
 * Call Aggregation Domain Layer
 * 
 * Single source of truth for all call-related business logic:
 * - Constants (system types, entity types)
 * - Status determination (answered, abandoned, voicemail, busy)
 * - Direction determination (inbound, outbound, internal, bridge)
 * - SQL helpers for consistent query building
 * 
 * All services MUST import from here — no duplicated logic allowed.
 */

import { CallDirection, CallStatus, SegmentCategory } from './call.types';

// ============================================
// CONSTANTS
// ============================================

/**
 * Destination types considered as "system" types.
 * For these, an answered_at from the system doesn't mean a human answered.
 */
export const SYSTEM_DESTINATION_TYPES = [
    'queue',
    'ring_group',
    'ring_group_ring_all',
    'ivr',
    'process',
    'parking',
    'script'
] as const;

/**
 * Entity types considered as "system" types.
 */
export const SYSTEM_ENTITY_TYPES = [
    'queue',
    'ivr'
] as const;

/**
 * SQL-formatted list of system destination types for use in raw queries.
 */
export const SQL_SYSTEM_DEST_TYPES = SYSTEM_DESTINATION_TYPES
    .map(t => `'${t}'`)
    .join(', ');

/**
 * SQL-formatted list of system entity types for use in raw queries.
 */
export const SQL_SYSTEM_ENTITY_TYPES = SYSTEM_ENTITY_TYPES
    .map(t => `'${t}'`)
    .join(', ');

/**
 * Internal system destination types used for direction determination.
 */
export const INTERNAL_SYSTEM_DEST_TYPES = [
    'queue',
    'ring_group',
    'ring_group_ring_all',
    'ivr',
    'process',
    'parking'
];

// ============================================
// STATUS DETERMINATION — SINGLE SOURCE OF TRUTH
// ============================================

/**
 * Determines the final status of an aggregated call based on its segments.
 * This is the ONLY function that should be used to determine call status across the app.
 * 
 * Priority: voicemail > busy > answered > abandoned
 */
export function determineCallStatus(params: {
    lastDestType: string | null;
    lastDestEntityType: string | null;
    lastAnsweredAt: Date | null;
    lastStartedAt: Date | null;
    lastEndedAt: Date | null;
    terminationReasonDetails: string | null;
    humanAnsweredAt: Date | null; // From answered_segments CTE (extension that answered)
}): CallStatus {
    const { lastDestType, lastDestEntityType, lastAnsweredAt, lastStartedAt, lastEndedAt, terminationReasonDetails, humanAnsweredAt } = params;

    const lastDestTypeLower = lastDestType?.toLowerCase() || '';
    const lastDestEntityTypeLower = lastDestEntityType?.toLowerCase() || '';
    const termDetails = terminationReasonDetails?.toLowerCase() || '';

    // 1. Voicemail check
    if (lastDestTypeLower === 'vmail_console' || lastDestTypeLower === 'voicemail' || lastDestEntityTypeLower === 'voicemail') {
        return 'voicemail';
    }

    // 2. Busy check
    if (termDetails.includes('busy')) {
        return 'busy';
    }

    // 3. Answered check
    const lastSegmentAnswered = lastAnsweredAt !== null;
    const lastStarted = lastStartedAt ? new Date(lastStartedAt) : null;
    const lastEnded = lastEndedAt ? new Date(lastEndedAt) : null;
    const lastDurationSeconds = lastStarted && lastEnded
        ? (lastEnded.getTime() - lastStarted.getTime()) / 1000
        : 0;

    if (lastSegmentAnswered && lastDurationSeconds > 1) {
        // System types: only consider answered if a human (extension) answered
        if (isSystemType(lastDestType, lastDestEntityType)) {
            return humanAnsweredAt ? 'answered' : 'abandoned';
        }
        // Non-system types: standard answered logic
        return 'answered';
    }

    // 4. Not answered = abandoned
    return 'abandoned';
}

/**
 * Determines the status of an individual segment (used in call chain modal).
 */
export function determineSegmentStatus(params: {
    answeredAt: Date | null;
    startedAt: Date | null;
    endedAt: Date | null;
    destType: string | null;
    destEntityType: string | null;
    terminationReasonDetails: string | null;
}): CallStatus {
    const { answeredAt, destType, destEntityType, terminationReasonDetails } = params;

    const destTypeLower = destType?.toLowerCase() || '';
    const destEntityTypeLower = destEntityType?.toLowerCase() || '';

    // Voicemail
    if (destTypeLower === 'vmail_console' || destTypeLower === 'voicemail' || destEntityTypeLower === 'voicemail') {
        return 'voicemail';
    }

    // Busy
    if (terminationReasonDetails?.toLowerCase()?.includes('busy')) {
        return 'busy';
    }

    // Answered
    if (answeredAt) {
        const isHumanAnswer = destTypeLower === 'extension' && destEntityTypeLower !== 'voicemail';
        return isHumanAnswer ? 'answered' : 'abandoned';
    }

    return 'abandoned';
}

/**
 * Determines the category of a segment for display in the call chain modal.
 */
export function determineSegmentCategory(params: {
    terminationReason: string | null;
    terminationReasonDetails: string | null;
    creationMethod: string | null;
    creationForwardReason: string | null;
    destinationType: string | null;
    destinationEntityType: string | null;
    sourceType: string | null;
    durationSeconds: number;
    wasAnswered: boolean;
}): SegmentCategory {
    const { terminationReason, terminationReasonDetails, creationMethod, creationForwardReason, destinationType, destinationEntityType, sourceType, durationSeconds, wasAnswered } = params;

    const termReason = terminationReason?.toLowerCase() || '';
    const termDetails = terminationReasonDetails?.toLowerCase() || '';
    const createMethod = creationMethod?.toLowerCase() || '';
    const createForward = creationForwardReason?.toLowerCase() || '';
    const destType = destinationType?.toLowerCase() || '';
    const destEntityType = destinationEntityType?.toLowerCase() || '';
    const srcType = sourceType?.toLowerCase() || '';

    // Bridge segments
    if (srcType === 'bridge' || destType === 'bridge') {
        return 'bridge';
    }

    // Voicemail segments
    if (destType === 'vmail_console' || destType === 'voicemail' || destEntityType === 'voicemail') {
        return 'voicemail';
    }

    // IVR/Script segments
    if (destType === 'script' || destType === 'ivr') {
        return 'ivr';
    }

    // Queue segments
    if (destType === 'queue') {
        return 'queue';
    }

    // System routing segments
    if (destType === 'unknown') {
        return 'routing';
    }
    if (termReason === 'redirected' && durationSeconds < 1) {
        return 'routing';
    }

    // Ringing segments: agent polled but didn't answer
    if (createMethod === 'route_to' && createForward === 'polling') {
        if (termReason === 'cancelled') {
            if (termDetails === 'completed_elsewhere' || termDetails === '') {
                return 'ringing';
            }
            if (termDetails === 'terminated_by_originator') {
                return 'abandoned';
            }
        }
    }

    // Conversation: answered with significant duration
    if (wasAnswered && destType === 'extension' && durationSeconds > 1) {
        return 'conversation';
    }

    // Transfer segments
    if (createMethod === 'transfer' || createMethod === 'divert') {
        if (wasAnswered && durationSeconds > 1) {
            return 'conversation';
        }
        if (termReason === 'continued_in') {
            return 'transfer';
        }
    }

    // Busy
    if (termDetails.includes('busy')) {
        return 'busy';
    }

    // Rejected
    if (termReason === 'rejected') {
        return 'rejected';
    }

    // No route
    if (termDetails === 'no_route') {
        return 'routing';
    }

    // Caller/destination hung up before answer
    if (!wasAnswered && (termReason === 'src_participant_terminated' || termReason === 'dst_participant_terminated')) {
        return 'abandoned';
    }

    // Fallback
    if (wasAnswered) {
        return 'conversation';
    }

    return 'unknown';
}

// ============================================
// DIRECTION DETERMINATION — SINGLE SOURCE OF TRUTH
// ============================================

/**
 * Determines the direction of a call based on its first and last segments.
 */
export function determineCallDirection(params: {
    sourceType: string | null;
    firstDestType: string | null;
    lastDestType: string | null;
}): CallDirection {
    const { sourceType, firstDestType, lastDestType } = params;

    // Bridge calls
    const srcIsBridge = sourceType?.toLowerCase() === 'bridge';
    const firstDestIsBridge = firstDestType?.toLowerCase() === 'bridge';
    const lastDestIsBridge = lastDestType?.toLowerCase() === 'bridge';
    if (srcIsBridge || firstDestIsBridge || lastDestIsBridge) return 'bridge';

    const srcIsExt = sourceType?.toLowerCase() === 'extension';
    const destIsExt = firstDestType?.toLowerCase() === 'extension';

    // Internal: extension -> extension
    if (srcIsExt && destIsExt) return 'internal';

    // Internal: extension -> internal system (queue, IVR, etc)
    if (srcIsExt && INTERNAL_SYSTEM_DEST_TYPES.includes(firstDestType?.toLowerCase() || '')) {
        return 'internal';
    }

    // Outbound: extension -> external
    if (srcIsExt && !destIsExt) return 'outbound';

    // Inbound: everything else
    return 'inbound';
}

// ============================================
// HELPERS
// ============================================

/**
 * Checks if a destination type is a system type.
 */
export function isSystemType(
    destType: string | null | undefined,
    destEntityType?: string | null | undefined
): boolean {
    const normalizedDestType = destType?.toLowerCase() || '';
    const normalizedEntityType = destEntityType?.toLowerCase() || '';

    return (SYSTEM_DESTINATION_TYPES as readonly string[]).includes(normalizedDestType) ||
        (SYSTEM_ENTITY_TYPES as readonly string[]).includes(normalizedEntityType);
}

/**
 * SQL condition to strictly determine if a segment represents a human answer.
 * Ignores system answering segments (IVR/script pickups).
 */
export function getSqlIsHumanAnswered(alias: string = ''): string {
    const p = alias ? `${alias}.` : '';
    return `(${p}cdr_answered_at IS NOT NULL 
             AND COALESCE(${p}destination_dn_type, '') NOT IN (${SQL_SYSTEM_DEST_TYPES})
             AND COALESCE(${p}destination_entity_type, '') NOT IN (${SQL_SYSTEM_ENTITY_TYPES}))`;
}

/**
 * Formats duration in seconds to human-readable string.
 */
export function formatDuration(seconds: number): string {
    if (seconds < 0) seconds = 0;
    const mins = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

/**
 * Gets the display number for a participant.
 */
export function getDisplayNumber(
    dnNumber: string | null,
    participantNumber: string | null,
    presentation: string | null = null
): string {
    if (participantNumber && participantNumber.trim() !== '') {
        return participantNumber;
    }
    if (presentation && presentation.trim() !== '' && !presentation.includes(':')) {
        return presentation;
    }
    return dnNumber || '-';
}

/**
 * Gets the display name for a participant.
 */
export function getDisplayName(
    participantName: string | null,
    dnName: string | null
): string {
    if (participantName && participantName.trim() !== '') {
        return participantName.replace(/:$/, '').trim();
    }
    if (dnName && dnName.trim() !== '') {
        return dnName;
    }
    return '';
}

/**
 * Determines queue call outcome based on answered/overflow flags.
 * Priority: answered > overflow > abandoned
 */
export function determineQueueOutcome(
    answeredHere: number,
    forwardedToOtherQueue: number
): 'answered' | 'abandoned' | 'overflow' {
    if (answeredHere === 1) return 'answered';
    if (forwardedToOtherQueue === 1) return 'overflow';
    return 'abandoned';
}

// ============================================
// SQL CTE BUILDERS (for raw query composition)
// ============================================

/**
 * Builds the SQL CTE for getting unique queue calls (one per call_history_id).
 */
export function buildUniqueQueueCallsCTE(
    queueNumberParam: string = '$1',
    startDateParam: string = '$2',
    endDateParam: string = '$3'
): string {
    return `
        unique_queue_calls AS (
            SELECT DISTINCT ON (call_history_id)
                call_history_id, cdr_id, cdr_started_at, cdr_ended_at
            FROM cdroutput
            WHERE destination_dn_number = ${queueNumberParam}
              AND destination_dn_type = 'queue'
              AND cdr_started_at >= ${startDateParam}
              AND cdr_started_at <= ${endDateParam}
            ORDER BY call_history_id, cdr_started_at ASC
        )`;
}

/**
 * SQL CASE expression for determining if a call was answered by an agent.
 */
export const SQL_ANSWERED_CASE = `
    CASE 
        WHEN ans.originating_cdr_id = uqc.cdr_id 
             AND ans.destination_dn_type = 'extension'
             AND ans.cdr_answered_at IS NOT NULL
        THEN 1 ELSE 0 
    END`;

/**
 * SQL CASE expression for determining if a call overflowed to another queue.
 */
export const SQL_OVERFLOW_CASE = (queueNumberParam: string = '$1') => `
    CASE 
        WHEN other_q.destination_dn_type = 'queue'
             AND other_q.destination_dn_number != ${queueNumberParam}
             AND other_q.cdr_started_at > uqc.cdr_started_at
        THEN 1 ELSE 0 
    END`;
