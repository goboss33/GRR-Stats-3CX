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

import { CallProvenance, CallSens, CallStatus, SegmentCategory } from './call.types';
// Import de TYPE uniquement : call-classification importe déjà des valeurs
// d'ici, un import de valeur créerait un cycle de modules.
import type { CallOrigin } from './call-classification';

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

/**
 * Types de destination correspondant à une VRAIE partie jointe.
 *
 * Liste BLANCHE, et c'est essentiel. Le tableau de bord raisonnait avec une
 * liste NOIRE — il énumérait les types « système » et considérait tout le reste
 * comme humain. Résultat : un segment technique `EndCall` de type `unknown`,
 * portant un horodatage de décroché, passait pour une réponse. 657 appels sur
 * juillet 2026, dont 500 de ce seul motif.
 *
 * Une liste blanche ne peut pas se tromper de ce côté : un type inconnu n'y
 * figure pas, donc ne compte pas.
 */
export const SQL_REAL_PARTY_DEST_TYPES = "'extension', 'provider', 'external_line'";

/**
 * Expression SQL du statut final — image fidèle de `determineCallStatus`, dans
 * le même ordre de priorité.
 *
 * Attend des colonnes nommées : `ls_last_dest_type`, `ls_last_dest_entity_type`,
 * `ls_termination_reason_details` pour le dernier segment, et `lh_answered_at`,
 * `lh_started_at`, `lh_ended_at` pour le dernier segment ayant joint une vraie
 * partie.
 *
 * Sert aux écrans qui AGRÈGENT (tableau de bord) ; ceux qui LISTENT emploient
 * `determineCallStatus`. Deux usages, une seule définition — c'est le partage
 * de la règle, pas celui des requêtes : compter et lister restent deux métiers.
 */
export function buildFinalStatusCaseSQL(minAnswerSeconds: number = DEFAULT_MIN_ANSWER_SECONDS): string {
    return `CASE
        WHEN ls_last_dest_type IN ('vmail_console', 'voicemail') OR ls_last_dest_entity_type = 'voicemail' THEN 'voicemail'
        WHEN ls_termination_reason_details ILIKE '%busy%' THEN 'busy'
        WHEN lh_answered_at IS NOT NULL
             AND EXTRACT(EPOCH FROM (lh_ended_at - lh_started_at)) > ${minAnswerSeconds}
        THEN 'answered'
        ELSE 'missed'
    END`;
}

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
 * Regroupement d'affichage des statuts finaux : Répondu, Perdu, Messagerie.
 *
 * « Occupé » rejoint « Perdu » — c'est un appel qu'on n'a pas pris. La
 * messagerie garde sa case, parce qu'elle décrit autre chose qu'un échec.
 */

/**
 * Étiquette d'un statut final, selon le SENS de l'appel.
 *
 * « Perdu » porte l'idée d'un échec de service : un client qu'on n'a pas su
 * prendre. Appliqué à un appel SORTANT, le mot est faux — un correspondant
 * absent n'est pas un client perdu. Le statut sous-jacent est le même dans les
 * deux cas ; seul le mot s'adapte, pour rester exact.
 */
export function finalStatusLabel(status: CallStatus, sens: CallSens): string {
    if (status === "answered") return "Répondu";
    if (status === "voicemail") return "Messagerie";
    return sens === "outbound" ? "Non répondu" : "Perdu";
}
export type FinalBucket = "answered" | "lost" | "voicemail";

export const DEFAULT_FINAL_GROUPING: Record<CallStatus, FinalBucket> = {
    answered: "answered",
    // La messagerie reste distincte : elle ne dit pas la même chose qu'un
    // abandon. Hors heures, elle est le fonctionnement normal ; en heures, elle
    // signale un renvoi par un agent. La fondre dans « Perdu » effacerait une
    // information que l'exploitation utilise.
    voicemail: "voicemail",
    busy: "lost",
    missed: "lost",
};

/** Statuts fins regroupés sous une étiquette d'affichage. */
export function finalStatusesForBucket(bucket: FinalBucket): CallStatus[] {
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
// ============================================
// PROVENANCE & SENS — le modèle à deux axes
//
// La PROVENANCE répond à « qui a lancé l'appel ? » : la source du PREMIER
// segment, rien d'autre — le vocabulaire exact du toggle Externe / Interne.
// Le SENS répond à « dans quel sens circule-t-il ? » : entrant (une source
// externe nous joint), sortant (un poste appelle l'extérieur — y compris
// l'autre entité via le pont), intra (poste → poste ou système interne).
// Externe ⇒ entrant, par construction.
//
// Le pont EDIFEA n'est PAS un sens : c'est un attribut (viaBridge). Sa
// promotion en « direction » faisait compter les appels SORTANTS vers
// l'autre entité dans les reçus externes du tableau de bord (94 appels en
// juillet 2026, tous « perdus » de surcroît) : l'écart KPI ↔ journaux venait
// de là. Chaque règle existe en deux dialectes, TypeScript et SQL, définis
// côte à côte : toute évolution doit toucher les deux, les tests les
// confrontent.
// ============================================

export function determineCallProvenance(sourceType: string | null): CallProvenance {
    return sourceType?.toLowerCase() === "extension" ? "internal" : "external";
}

export function determineCallSens(params: {
    sourceType: string | null;
    firstDestType: string | null;
}): CallSens {
    if (params.sourceType?.toLowerCase() !== "extension") return "inbound";
    const fdst = params.firstDestType?.toLowerCase() ?? "";
    if (fdst === "extension" || INTERNAL_SYSTEM_DEST_TYPES.includes(fdst)) return "intra";
    return "outbound";
}

/** L'appel traverse-t-il le pont EDIFEA ? (dans un sens ou dans l'autre) */
export function callTouchesBridge(params: {
    sourceType: string | null;
    firstDestType: string | null;
    lastDestType: string | null;
}): boolean {
    return [params.sourceType, params.firstDestType, params.lastDestType]
        .some((t) => t?.toLowerCase() === "bridge");
}

/** Miroir SQL de `determineCallProvenance`. */
export function buildCallProvenanceCaseSQL(sourceTypeExpr: string): string {
    return `CASE WHEN LOWER(COALESCE(${sourceTypeExpr}, '')) = 'extension' THEN 'internal' ELSE 'external' END`;
}

/** Miroir SQL de `determineCallSens`. */
export function buildCallSensCaseSQL(params: {
    sourceTypeExpr: string;
    firstDestTypeExpr: string;
}): string {
    const src = `LOWER(COALESCE(${params.sourceTypeExpr}, ''))`;
    const fdst = `LOWER(COALESCE(${params.firstDestTypeExpr}, ''))`;
    const internalSystem = INTERNAL_SYSTEM_DEST_TYPES.map((t) => `'${t}'`).join(", ");
    return `CASE
        WHEN ${src} != 'extension' THEN 'inbound'
        WHEN ${fdst} = 'extension' OR ${fdst} IN (${internalSystem}) THEN 'intra'
        ELSE 'outbound'
    END`;
}

/** Miroir SQL de `callTouchesBridge`. */
export function buildBridgeTouchSQL(params: {
    sourceTypeExpr: string;
    firstDestTypeExpr: string;
    lastDestTypeExpr: string;
}): string {
    return `(LOWER(COALESCE(${params.sourceTypeExpr}, '')) = 'bridge'`
        + ` OR LOWER(COALESCE(${params.firstDestTypeExpr}, '')) = 'bridge'`
        + ` OR LOWER(COALESCE(${params.lastDestTypeExpr}, '')) = 'bridge')`;
}

/**
 * Filtre « sens » des journaux — dérivé du CASE partagé, jamais un prédicat
 * parallèle : c'est un prédicat réécrit à la main qui avait fait diverger
 * journaux et tableau de bord.
 */
export function buildSensFilterSQL(
    sens: CallSens[] | undefined,
    exprs: { sourceTypeExpr: string; firstDestTypeExpr: string },
): string {
    if (!sens || sens.length === 0 || sens.length >= 3) return "";
    const values = sens.map((v) => `'${v}'`).join(", ");
    return `${buildCallSensCaseSQL(exprs)} IN (${values})`;
}

/** Filtre « provenance » (toggle Externe / Interne) : même CASE, même mot. */
export function buildProvenanceFilterSQL(
    origin: CallOrigin | undefined,
    sourceTypeExpr: string,
): string {
    if (!origin || origin === "both") return "";
    return `${buildCallProvenanceCaseSQL(sourceTypeExpr)} = '${origin}'`;
}

/**
 * Filtre de POPULATION des journaux : l'intersection provenance ∩ sens,
 * exprimée avec le MOINS de prédicats possible.
 *
 * Les deux axes sont corrélés (externe ⇔ entrant, par construction) : pousser
 * les deux prédicats séparément — le couple exact posé par un lien de
 * vignette — faisait dérailler l'estimation du planificateur Postgres
 * (127 s au lieu de 3 s sur juillet 2026, ORDER BY + LIMIT en tête). Jamais
 * deux conditions équivalentes : une seule, la plus simple.
 */
export function buildPopulationFilterSQL(
    origin: CallOrigin | undefined,
    sens: CallSens[] | undefined,
    exprs: { sourceTypeExpr: string; firstDestTypeExpr: string },
): string[] {
    const all: CallSens[] = ["inbound", "outbound", "intra"];
    const wanted = !sens || sens.length === 0 ? all : sens;
    const allowed: CallSens[] = !origin || origin === "both" ? all
        : origin === "external" ? ["inbound"]
            : ["outbound", "intra"];
    const effective = wanted.filter((v) => allowed.includes(v));

    if (effective.length === 0) return ["FALSE"];
    if (effective.length === all.length) return [];
    // Externe ⇔ entrant : le prédicat de provenance suffit, et il ne lit
    // qu'une colonne — le plus lisible pour le planificateur.
    if (effective.length === 1 && effective[0] === "inbound") {
        return [`${buildCallProvenanceCaseSQL(exprs.sourceTypeExpr)} = 'external'`];
    }
    // { sortant, intra } = tout l'interne : même raisonnement.
    if (effective.length === 2 && !effective.includes("inbound")) {
        return [`${buildCallProvenanceCaseSQL(exprs.sourceTypeExpr)} = 'internal'`];
    }
    return [buildSensFilterSQL(effective, exprs)];
}

/**
 * Sens retenus pour chaque position du toggle Externe / Interne / Les deux.
 * Le tableau de bord ne montre QUE le flux entrant : Externe = entrants
 * (pont compris), Interne = intra — les sortants ne vivent que dans les
 * journaux. Les liens KPI → journaux transportent la MÊME constante : les
 * deux écrans décrivent la même population par construction.
 */
export const ORIGIN_SENS: Record<CallOrigin, CallSens[]> = {
    external: ["inbound"],
    internal: ["intra"],
    both: ["inbound", "intra"],
};

/** Direction retenue par le tableau de bord : le flux reçu, ou le flux émis. */
export type DashboardDirection = "inbound" | "outbound";

/**
 * Condition SQL du couple de filtres du tableau de bord (direction +
 * provenance). Côté « Entrant », la provenance ventile selon ORIGIN_SENS ;
 * côté « Sortant », elle est ignorée (un sortant est par nature émis par
 * l'interne vers l'externe).
 */
export function buildDirectionConditionSQL(params: {
    direction: DashboardDirection;
    origin?: CallOrigin;
    sourceTypeExpr: string;
    firstDestTypeExpr: string;
}): string {
    const sensCase = buildCallSensCaseSQL(params);
    if (params.direction === "outbound") return `${sensCase} = 'outbound'`;
    const sens = ORIGIN_SENS[params.origin ?? "both"];
    return sens.length === 1
        ? `${sensCase} = '${sens[0]}'`
        : `${sensCase} <> 'outbound'`;
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
 * Variante « humaine » avec espace : "45s", "5m 3s", "1h 20m".
 *
 * ⚠️ Arrondit AVANT tout calcul. Les durées viennent de moyennes SQL et sont
 * donc décimales : un modulo direct produisait « 2m 13.90000000000s » à
 * l'écran. L'arrondi doit précéder la décomposition, pas la suivre.
 */
export function formatDurationHuman(seconds: number): string {
    const total = Math.round(seconds);
    if (total <= 0) return "0s";
    if (total < 60) return `${total}s`;

    const minutes = Math.floor(total / 60);
    if (minutes < 60) {
        const secs = total % 60;
        return secs > 0 ? `${minutes}m ${secs}s` : `${minutes}m`;
    }

    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
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
