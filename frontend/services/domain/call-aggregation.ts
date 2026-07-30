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
 * STATUT FINAL D'UN APPEL — définition unique.
 *
 * Ce statut existait en deux exemplaires : une fonction TypeScript pour
 * l'affichage, une construction SQL pour le filtrage. Les deux décrivaient les
 * mêmes règles sans aucun lien entre elles — exactement le motif qui a fait
 * diverger les KPIs et les logs.
 *
 * Les deux dérivent désormais de cette table ordonnée. Ajouter ou modifier un
 * statut d'un seul côté n'est plus possible : il n'y a plus qu'un côté.
 *
 * L'ORDRE est la sémantique : messagerie > occupé > répondu > manqué. Le premier
 * critère satisfait l'emporte, et le SQL reproduit cette priorité en excluant
 * les statuts de rang supérieur.
 */
export interface FinalStatusParams {
    lastDestType: string | null;
    lastDestEntityType: string | null;
    terminationReasonDetails: string | null;
    lastHumanAnsweredAt: Date | null;
    lastHumanStartedAt: Date | null;
    lastHumanEndedAt: Date | null;
}

/**
 * Durée minimale d'une conversation pour qu'un décroché compte comme une
 * réponse. Écarte les décrochés-raccrochés immédiats et les transferts ratés,
 * qui ne sont pas un service rendu au client.
 */
export const DEFAULT_MIN_ANSWER_SECONDS = 1;

interface FinalStatusRule {
    status: CallStatus;
    /** Verdict TypeScript, pour l'affichage. */
    matches: (p: FinalStatusParams, minAnswerSeconds: number) => boolean;
    /** Condition SQL équivalente, pour le filtrage. */
    sql: (minAnswerSeconds: number) => string;
}

const SQL_IS_VOICEMAIL =
    "(COALESCE(ls.last_dest_type, '') IN ('vmail_console', 'voicemail') OR COALESCE(ls.last_dest_entity_type, '') = 'voicemail')";
const SQL_IS_BUSY = "(COALESCE(ls.termination_reason_details, '') ILIKE '%busy%')";
const sqlIsAnswered = (min: number) => `(
    lhs.last_human_answered_at IS NOT NULL
    AND EXTRACT(EPOCH FROM (lhs.last_human_ended_at - lhs.last_human_started_at)) > ${min}
)`;

export const FINAL_STATUS_RULES: FinalStatusRule[] = [
    {
        status: "voicemail",
        matches: (p) => {
            const destType = p.lastDestType?.toLowerCase() ?? "";
            const entityType = p.lastDestEntityType?.toLowerCase() ?? "";
            return destType === "vmail_console" || destType === "voicemail" || entityType === "voicemail";
        },
        sql: () => SQL_IS_VOICEMAIL,
    },
    {
        status: "busy",
        matches: (p) => (p.terminationReasonDetails?.toLowerCase() ?? "").includes("busy"),
        sql: () => SQL_IS_BUSY,
    },
    {
        status: "answered",
        matches: (p, minAnswerSeconds) => {
            if (p.lastHumanAnsweredAt === null) return false;
            const started = p.lastHumanStartedAt ? new Date(p.lastHumanStartedAt).getTime() : null;
            const ended = p.lastHumanEndedAt ? new Date(p.lastHumanEndedAt).getTime() : null;
            const seconds = started && ended ? (ended - started) / 1000 : 0;
            return seconds > minAnswerSeconds;
        },
        sql: sqlIsAnswered,
    },
    {
        // Dernier de la liste : tout ce qui n'est rien d'autre.
        status: "missed",
        matches: () => true,
        sql: () => "TRUE",
    },
];

/**
 * Regroupement d'affichage des statuts finaux.
 *
 * L'application n'emploie qu'un vocabulaire : Répondu / Perdu. Messagerie et
 * Occupé restent des statuts internes — ils décrivent COMMENT l'appel s'est
 * terminé et se lisent dans le parcours — mais un manager n'a pas à jongler
 * entre « Perdu » côté file et « Manqué » côté entreprise pour la même idée.
 */
export const DEFAULT_FINAL_GROUPING: Record<CallStatus, "answered" | "lost"> = {
    answered: "answered",
    voicemail: "lost",
    busy: "lost",
    missed: "lost",
};

/** Statuts fins regroupés sous une étiquette d'affichage. */
export function finalStatusesForBucket(bucket: "answered" | "lost"): CallStatus[] {
    return (Object.keys(DEFAULT_FINAL_GROUPING) as CallStatus[])
        .filter((s) => DEFAULT_FINAL_GROUPING[s] === bucket);
}

/**
 * Statut final d'un appel agrégé. Unique fonction à utiliser pour cela.
 */
export function determineCallStatus(
    params: FinalStatusParams,
    minAnswerSeconds: number = DEFAULT_MIN_ANSWER_SECONDS,
): CallStatus {
    for (const rule of FINAL_STATUS_RULES) {
        if (rule.matches(params, minAnswerSeconds)) return rule.status;
    }
    return "missed";
}

/**
 * Condition SQL sélectionnant les appels dont le statut final figure parmi ceux
 * demandés. Construite à partir de la MÊME table, priorité comprise : le SQL
 * d'un statut exclut explicitement les statuts qui le précèdent.
 */
export function buildFinalStatusFilterSQL(
    statuses: CallStatus[] | undefined,
    minAnswerSeconds: number = DEFAULT_MIN_ANSWER_SECONDS,
): string {
    if (!statuses || statuses.length === 0) return "";
    // Tous les statuts demandés : la condition serait toujours vraie.
    if (FINAL_STATUS_RULES.every((r) => statuses.includes(r.status))) return "";

    const conditions: string[] = [];
    for (let i = 0; i < FINAL_STATUS_RULES.length; i++) {
        const rule = FINAL_STATUS_RULES[i];
        if (!statuses.includes(rule.status)) continue;

        const higher = FINAL_STATUS_RULES.slice(0, i).map((r) => `NOT ${r.sql(minAnswerSeconds)}`);
        const own = rule.sql(minAnswerSeconds);
        const parts = own === "TRUE" ? higher : [...higher, own];
        conditions.push(parts.length > 0 ? `(${parts.join(" AND ")})` : "TRUE");
    }

    return conditions.length > 0 ? `(${conditions.join(" OR ")})` : "";
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
        return isHumanAnswer ? 'answered' : 'missed';
    }

    return 'missed';
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
 * Variante « humaine » avec espace : "45s", "5m 3s", "5m".
 */
export function formatDurationHuman(seconds: number): string {
    if (seconds < 60) return `${seconds}s`;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
}

/**
 * Variante compacte sans espace : "45s", "5m3s", "5m".
 */
export function formatDurationCompact(seconds: number): string {
    if (seconds >= 60) {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return secs > 0 ? `${mins}m${secs}s` : `${mins}m`;
    }
    return `${seconds}s`;
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
 * Masque un numéro d'appelant en ne conservant que les 2 derniers chiffres :
 * "0791234567" -> "07• ••• ••67".
 *
 * Appliqué CÔTÉ SERVEUR pour les utilisateurs sans la permission
 * « voir les numéros complets » (cf. PRD droits d'accès D9, nLPD/RGPD).
 * Les numéros courts (extensions internes) ne sont pas masqués : ils
 * n'identifient pas une personne extérieure et sont nécessaires à l'exploitation.
 */
export function maskPhoneNumber(value: string | null | undefined): string {
    const raw = (value ?? "").trim();
    if (!raw) return raw;

    const digits = raw.replace(/\D/g, "");
    // Extensions internes (≤ 5 chiffres) : pas de masquage.
    if (digits.length <= 5) return raw;

    const prefix = raw.slice(0, 2);
    const suffix = raw.slice(-2);
    return `${prefix}• ••• ••${suffix}`;
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

// ============================================
// BUSINESS RULES — Configurable thresholds
// ============================================

/**
 * Default business rules configuration.
 * These values should match the defaults in the AppSettings database model.
 */
export const DEFAULT_BUSINESS_RULES = {
    /**
     * Minimum duration (in seconds) for a direct call segment to be considered "significant".
     * 
     * Direct call segments shorter than this threshold that were NOT answered are
     * considered "system noise" and excluded from statistics.
     * 
     * Rationale: A 9ms segment to extension 164 where the agent had call forwarding
     * active is not a real call attempt — it's a routing artifact.
     * 
     * Used in:
     * - services/analytics/query-builder.ts (CTE builders)
     * - app/api/analytics/agents/route.ts (direct calls CTE)
     * - app/api/analytics/queue/route.ts (direct calls CTE)
     * - services/logs.service.ts (call_journey CTE)
     */
    minSignificantDurationSec: 1,
};

/**
 * Builds the SQL WHERE clause for identifying valid direct call segments.
 * 
 * A "valid direct segment" is a CDR segment that represents a genuine call attempt
 * to an agent's extension, excluding:
 * - Queue polling segments (creation_forward_reason = 'polling')
 * - Segments originating from a queue passage (if excludeQueueOriginated is true)
 * - Very short unanswered segments (< minSignificantDurationSec) that are system noise
 * 
 * @param alias - Table alias to use (default: 'c')
 * @param options.excludeQueueOriginated - Exclude segments that originated from a queue passage
 * @param options.queuePassagesCTEName - Name of the CTE containing queue passages
 * @param options.durationThreshold - Minimum duration in seconds (default: from DEFAULT_BUSINESS_RULES)
 * 
 * @returns SQL WHERE clause string
 * 
 * @example
 * // Basic usage
 * buildDirectSegmentWhereClause('c')
 * // Returns: "c.destination_dn_type = 'extension' AND ..."
 * 
 * @example
 * // With queue exclusion
 * buildDirectSegmentWhereClause('c', { excludeQueueOriginated: true, queuePassagesCTEName: 'all_queue_passages' })
 */
export function buildDirectSegmentWhereClause(
    alias: string = 'c',
    options: {
        excludeQueueOriginated?: boolean;
        queuePassagesCTEName?: string;
        durationThreshold?: number;
    } = {}
): string {
    const {
        excludeQueueOriginated = false,
        queuePassagesCTEName = 'all_queue_passages',
        durationThreshold = DEFAULT_BUSINESS_RULES.minSignificantDurationSec,
    } = options;

    const p = alias ? `${alias}.` : '';

    const conditions = [
        `${p}destination_dn_type = 'extension'`,
        `COALESCE(${p}destination_entity_type, '') != 'voicemail'`,
        `${p}creation_forward_reason IS DISTINCT FROM 'polling'`,
        `(${p}creation_forward_reason = 'by_did' OR NOT (${p}cdr_answered_at IS NULL AND EXTRACT(EPOCH FROM (${p}cdr_ended_at - ${p}cdr_started_at)) < ${durationThreshold}))`,
    ];

    if (excludeQueueOriginated) {
        conditions.push(`NOT EXISTS (SELECT 1 FROM ${queuePassagesCTEName} aqp WHERE aqp.call_history_id = ${p}call_history_id)`);
    }

    return conditions.join(' AND ');
}
