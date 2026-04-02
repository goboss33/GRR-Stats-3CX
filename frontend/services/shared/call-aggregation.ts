/**
 * Shared Call Aggregation Layer — DEPRECATED
 * 
 * This module is kept for backward compatibility only.
 * All exports are now delegated to the new domain layer.
 * 
 * @deprecated Import from "@/services/domain/call-aggregation" instead
 */

export {
    SYSTEM_DESTINATION_TYPES,
    SYSTEM_ENTITY_TYPES,
    SQL_SYSTEM_DEST_TYPES,
    SQL_SYSTEM_ENTITY_TYPES,
    getSqlIsHumanAnswered,
    buildUniqueQueueCallsCTE,
    SQL_ANSWERED_CASE,
    SQL_OVERFLOW_CASE,
    determineQueueOutcome,
    isSystemType,
} from "@/services/domain/call-aggregation";

export type {
    QueueCallOutcome,
    QueueCallOutcomeRow,
} from "@/services/domain/call.types";
