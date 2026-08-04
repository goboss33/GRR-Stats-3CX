"use server";

import { ServerId, getPrismaCdr } from "@/lib/prisma-cdr";
import { getServerTimezone } from "@/lib/servers";
import { parseSearchPattern, type SearchPattern, type SearchPatternMode } from "@/services/domain/extension-search";
import { resolveAccessScope, type AccessScope } from "@/lib/access-scope";
import { requireActionRole } from "@/lib/auth-guard";
import { maskPhoneNumber } from "@/services/domain/call-aggregation";
import {
    DEFAULT_CLASSIFICATION_RULES,
    buildQueueOutcomeSubquery,
    buildTeamCTEChain,
    cdrTable,
    type ClassificationRules,
    type PassageOutcome,
} from "@/services/domain/call-classification";
import { getClassificationRules } from "@/lib/classification-rules";
import type {
    AggregatedCallLog,
    CallStatus,
    LogsFilters,
    LogsSort,
    AggregatedCallLogsResponse,
    CallChainSegment,
    JourneyFilter,
    JourneyConditionNode,
    JourneyGroupCondition,
} from "@/services/domain/call.types";
import {
    determineCallProvenance,
    determineCallSens,
    callTouchesBridge,
    buildPopulationFilterSQL,
    determineCallStatus,
    buildFinalStatusFilterSQL,
    determineSegmentStatus,
    determineSegmentCategory,
    formatDuration,
    getDisplayNumber,
    getDisplayName,
    buildDirectSegmentWhereClause,
} from "@/services/domain/call-aggregation";

// ============================================
// SEARCH PATTERN PARSER
// ============================================


/**
 * Échappe une valeur en littéral SQL (`'...'`). Réservé aux rares cas non
 * paramétrables (fragments jsonb/jsonpath) ; ailleurs on utilise des paramètres liés.
 * Sûr avec standard_conforming_strings = on (défaut PostgreSQL).
 */
function sqlQuote(value: string): string {
    return `'${value.replace(/'/g, "''")}'`;
}

/** Valeur à lier pour une recherche ILIKE, jokers intégrés selon le mode. */
function likeValue(pattern: SearchPattern): string {
    switch (pattern.mode) {
        case "startsWith": return `${pattern.value}%`;
        case "endsWith": return `%${pattern.value}`;
        case "contains": return `%${pattern.value}%`;
        case "exact": return pattern.value;
    }
}

/** Condition de recherche sur un champ, utilisant un placeholder déjà lié ($N). */
function searchCondition(field: string, mode: SearchPatternMode, placeholder: string): string {
    return mode === "exact"
        ? `LOWER(${field}) = LOWER(${placeholder})`
        : `${field} ILIKE ${placeholder}`;
}



function buildOrderByClause(sort?: LogsSort, timezone: string = "Europe/Zurich"): string {
    if (!sort) return "ca.first_started_at DESC";
    const dir = sort.direction === "asc" ? "ASC" : "DESC";
    switch (sort.field) {
        case "startedAt": return `ca.first_started_at ${dir}`;
        case "timeOfDay": return `(ca.first_started_at AT TIME ZONE '${timezone}')::time ${dir}`;
        case "duration": return `(ca.last_ended_at - ca.first_started_at) ${dir}`;
        case "sourceNumber": return `fs.source_dn_number ${dir}`;
        case "destinationNumber": return `fs.first_dest_number ${dir}`;
        default: return "ca.first_started_at DESC";
    }
}

// ============================================
// QUERY BUILDER — shared parts (filters + pagination)
// ============================================

function buildAggregatedQueryParts(
    startDate: Date,
    endDate: Date,
    filters: LogsFilters,
    pagination: { page: number; pageSize: number },
    sort?: LogsSort,
    timezone: string = "Europe/Zurich",
    scope?: AccessScope,
    // Passées en paramètre plutôt que lues ici : ce constructeur est synchrone,
    // et le rendre asynchrone pour un réglage contaminerait tous ses appelants.
    rules: ClassificationRules = DEFAULT_CLASSIFICATION_RULES,
): {
    whereClause: string;
    dateOnlyWhereClause: string;
    queueViewCTE?: string;
    queueViewJoin?: string;
    queueViewSelect?: string;
    viewQueue?: string;
    aggregatedWhereConditions: string[];
    calleeFilterCTE: string;
    calleeFilterJoin: string;
    limit: number;
    skip: number;
    sortClause: string;
    params: unknown[];
} {
    const pageNumber = Math.max(1, pagination.page);
    const limit = Math.min(100, Math.max(1, pagination.pageSize));
    const skip = (pageNumber - 1) * limit;

    // Grain de comptage : la même table que les statistiques, pour que la liste
    // des logs décrive la même population que les chiffres.
    const cdr = cdrTable(rules);

    // Collecteur de paramètres liés : bind() auto-numérote les $N (aucune erreur
    // de numérotation possible). La même valeur (dates, motif de recherche) est
    // liée une seule fois et son placeholder réutilisé.
    const params: unknown[] = [];
    const bind = (value: unknown): string => {
        params.push(value);
        return `$${params.length}`;
    };

    const startP = bind(startDate); // $1
    const endP = bind(endDate); // $2

    const whereConditions: string[] = [
        `cdr_started_at >= ${startP}`,
        `cdr_started_at <= ${endP}`,
    ];

    // ── Filtrage par périmètre (cf. PRD droits d'accès §8.3) ──────────────────
    // Un appel est visible dès qu'AU MOINS UN de ses segments touche une file ou
    // une extension du périmètre (option A du PRD) : c'est cohérent avec les KPIs,
    // notamment les débordements, où l'appel quitte le périmètre en cours de route.
    if (scope && !scope.unrestricted) {
        if (scope.empty) {
            whereConditions.push("false"); // aucun périmètre : aucune donnée
        } else {
            const parts: string[] = [];
            if (scope.queueNumbers && scope.queueNumbers.length > 0) {
                const ph = scope.queueNumbers.map((q) => bind(q));
                parts.push(`(destination_dn_type = 'queue' AND destination_dn_number IN (${ph.join(", ")}))`);
            }
            // ⚠️ ASYMÉTRIE ASSUMÉE, jumelle de celle de buildScopeFilter
            // (cdr.repository) : les postes ne comptent qu'en DESTINATION.
            // Un manager voit les appels REÇUS par ses agents, pas ceux
            // qu'ils émettent vers l'extérieur de son périmètre. Sans effet
            // aujourd'hui puisque aucun écran ne montre les sortants ; à
            // lever en même temps que le filtre jumeau le jour d'un tableau
            // de bord des sortants.
            // `allExcept` sans exclusion = tous les postes : la condition se
            // réduit au type, sans liste — c'est le cas d'un administrateur
            // dont le périmètre couvre toutes les files du tenant.
            if (scope.extensions.kind === "only") {
                if (scope.extensions.numbers.length > 0) {
                    const ph = scope.extensions.numbers.map((e) => bind(e));
                    parts.push(`(destination_dn_type = 'extension' AND destination_dn_number IN (${ph.join(", ")}))`);
                }
            } else if (scope.extensions.numbers.length > 0) {
                const ph = scope.extensions.numbers.map((e) => bind(e));
                parts.push(`(destination_dn_type = 'extension' AND destination_dn_number NOT IN (${ph.join(", ")}))`);
            } else {
                parts.push(`(destination_dn_type = 'extension')`);
            }
            whereConditions.push(
                parts.length > 0
                    ? `call_history_id IN (
                           SELECT call_history_id FROM ${cdr}
                           WHERE cdr_started_at >= ${startP} AND cdr_started_at <= ${endP}
                             AND (${parts.join(" OR ")})
                       )`
                    : "false",
            );
        }
    }

    if (filters.callerSearch?.trim()) {
        const pattern = parseSearchPattern(filters.callerSearch);
        const ph = bind(likeValue(pattern));
        whereConditions.push(`(
            ${searchCondition('source_dn_number', pattern.mode, ph)} OR
            ${searchCondition('source_participant_phone_number', pattern.mode, ph)} OR
            ${searchCondition('source_participant_name', pattern.mode, ph)} OR
            ${searchCondition('source_dn_name', pattern.mode, ph)} OR
            ${searchCondition('source_participant_trunk_did', pattern.mode, ph)}
        )`);
    }

    let calleeFilterCTE = '';
    let calleeFilterJoin = '';
    if (filters.calleeSearch?.trim()) {
        const pattern = parseSearchPattern(filters.calleeSearch);
        const ph = bind(likeValue(pattern));
        calleeFilterCTE = `,
            callee_filter AS (
                SELECT call_history_id
                FROM (
                    SELECT DISTINCT ON (call_history_id)
                        call_history_id,
                        destination_dn_number,
                        destination_participant_phone_number,
                        destination_participant_name,
                        destination_dn_name,
                        source_participant_name,
                        source_dn_type
                    FROM ${cdr}
                    WHERE cdr_started_at >= ${startP}
                      AND cdr_started_at <= ${endP}
                    ORDER BY call_history_id, cdr_started_at ASC
                ) first_dest
                WHERE (
                    ${searchCondition('destination_dn_number', pattern.mode, ph)} OR
                    ${searchCondition('destination_participant_phone_number', pattern.mode, ph)} OR
                    ${searchCondition('destination_participant_name', pattern.mode, ph)} OR
                    ${searchCondition('destination_dn_name', pattern.mode, ph)} OR
                    (source_dn_type = 'provider'
                     AND source_participant_name LIKE '%:%'
                     AND ${searchCondition('source_participant_name', pattern.mode, ph)})
                )
                UNION
                -- DDI search: the called DID lives in source_participant_trunk_did (any segment)
                SELECT call_history_id
                FROM ${cdr}
                WHERE cdr_started_at >= ${startP}
                  AND cdr_started_at <= ${endP}
                  AND ${searchCondition('source_participant_trunk_did', pattern.mode, ph)}
            )`;
        calleeFilterJoin = 'JOIN callee_filter cf ON ca.call_history_id = cf.call_history_id';
    }

    if (filters.durationMin !== undefined) {
        whereConditions.push(`EXTRACT(EPOCH FROM (cdr_ended_at - cdr_answered_at)) >= ${filters.durationMin}`);
    }
    if (filters.durationMax !== undefined) {
        whereConditions.push(`EXTRACT(EPOCH FROM (cdr_ended_at - cdr_answered_at)) <= ${filters.durationMax}`);
    }
    if (filters.idSearch?.trim()) {
        const pattern = parseSearchPattern(filters.idSearch);
        const ph = bind(likeValue(pattern));
        whereConditions.push(searchCondition('call_history_id::text', pattern.mode, ph));
    }

    // Filtre « statut dans une file » : même socle de classement que les KPIs,
    // donc même population. C'est ce qui rend le clic sur un KPI exact.
    // Vue file : le tableau affiche alors DEUX statuts — celui de l'appel dans
    // la file consultée, et son sort final. C'est ce qui permet à un manager de
    // lire « perdu chez moi, mais récupéré ailleurs » sans qu'on ait à choisir
    // entre les deux points de vue.
    const viewQueue = filters.queueView ?? filters.queueOutcomeFilter?.queueNumber;
    let queueViewCTE = "";
    let queueViewJoin = "";
    let queueViewSelect = "";
    if (viewQueue) {
        const qExpr = bind(viewQueue);
        // La chaîne complète, et non les seuls passages : elle applique la règle
        // du premier contact, si bien qu'un appel attribué au bloc « directs »
        // n'affiche plus de statut de file. Elle donne aussi l'appartenance à
        // l'équipe, qui sert à distinguer « Direct » d'un appel étranger.
        queueViewCTE = `,
        ${buildTeamCTEChain(rules, { queueExpr: qExpr, startExpr: startP, endExpr: endP })},
        answering_queue AS (
            SELECT DISTINCT ON (c.call_history_id)
                c.call_history_id,
                c.destination_dn_number AS queue_number,
                COALESCE(c.destination_dn_name, c.destination_dn_number) AS queue_name
            FROM ${cdr} c
            WHERE c.destination_dn_type = 'queue'
              AND c.destination_dn_number <> ${qExpr}
              AND c.cdr_started_at >= ${startP} AND c.cdr_started_at <= ${endP}
              AND EXISTS (
                  SELECT 1 FROM ${cdr} p
                  WHERE p.originating_cdr_id = c.cdr_id
                    AND p.creation_forward_reason = 'polling'
                    AND p.cdr_answered_at IS NOT NULL
                    AND p.destination_dn_type = 'extension'
              )
            ORDER BY c.call_history_id, c.cdr_started_at DESC
        )`;
        queueViewJoin = `LEFT JOIN queue_calls qv ON qv.call_history_id = ca.call_history_id
        LEFT JOIN direct_calls dc ON dc.call_history_id = ca.call_history_id
        LEFT JOIN answering_queue aq ON aq.call_history_id = ca.call_history_id`;
        // Un appel direct de l'équipe a lui aussi un sort, et la vignette le
        // compte (« Répondus : File 32 · Directs 620 »). Trois issues possibles :
        // répondu, redirigé (servi hors du groupe), ou perdu.
        queueViewSelect = `,
            COALESCE(qv.outcome, dc.outcome) as queue_view_status,
            (dc.call_history_id IS NOT NULL) as queue_view_is_direct,
            aq.queue_number as answering_queue_number,
            aq.queue_name as answering_queue_name`;
    }

    // La vue file RESTREINT la liste à la population de l'équipe : les appels
    // passés par la file, plus ses appels directs. C'est la même population que
    // celle agrégée par la vignette « Total reçus », donc le compte affiché en
    // haut des logs est celui de la statistique. Sans filtre explicite on prend
    // tout ; le filtre de colonne ne fait ensuite que réduire à l'intérieur.
    const ALL_OUTCOMES: PassageOutcome[] = ["answered", "handed_off", "overflow", "voicemail", "short_abandon", "abandoned"];
    const outcomeFilter = filters.queueOutcomeFilter
        ?? (viewQueue ? { queueNumber: viewQueue, outcomes: ALL_OUTCOMES, includeTeamDirect: true } : null);

    if (outcomeFilter && (outcomeFilter.outcomes.length > 0 || outcomeFilter.includeTeamDirect)) {
        const subquery = buildQueueOutcomeSubquery(rules, {
            queueExpr: bind(outcomeFilter.queueNumber),
            startExpr: startP,
            endExpr: endP,
            outcomes: outcomeFilter.outcomes,
            includeTeamDirect: outcomeFilter.includeTeamDirect,
        });
        whereConditions.push(`call_history_id IN ${subquery}`);
    }

    // Origine : file ou direct. Exprimée avec le même constructeur que le
    // filtre de statut — « tous les statuts sans les directs » d'un côté,
    // « les directs sans statut de file » de l'autre — et combinée en ET, ce
    // qui donne bien l'intersection des deux critères.
    if (viewQueue && filters.queueOriginFilter) {
        const originSubquery = buildQueueOutcomeSubquery(rules, {
            queueExpr: bind(viewQueue),
            startExpr: startP,
            endExpr: endP,
            outcomes: filters.queueOriginFilter === "queue" ? ALL_OUTCOMES : [],
            includeTeamDirect: filters.queueOriginFilter === "direct",
        });
        whereConditions.push(`call_history_id IN ${originSubquery}`);
    }

    const whereClause = whereConditions.join(" AND ");
    const dateOnlyWhereClause = `cdr_started_at >= ${startP} AND cdr_started_at <= ${endP}`;

    const aggregatedWhereConditions: string[] = [];
    // Population (provenance ∩ sens) : UN filtre normalisé, dérivé des CASE
    // du domaine — mêmes expressions que le tableau de bord, correspondance
    // par construction, et jamais deux prédicats redondants (le planificateur
    // Postgres en perdait pied). `fs` est le premier segment, déjà joint par
    // les requêtes de données ET de comptage.
    const fsExprs = { sourceTypeExpr: "fs.source_dn_type", firstDestTypeExpr: "fs.destination_dn_type" };
    aggregatedWhereConditions.push(...buildPopulationFilterSQL(filters.callOrigin, filters.sens, fsExprs));
    const statusFilter = buildFinalStatusFilterSQL(filters.statuses, rules.minAnswerSeconds);
    if (statusFilter) aggregatedWhereConditions.push(statusFilter);

    if (filters.handledBySearch?.trim()) {
        const pattern = parseSearchPattern(filters.handledBySearch);
        const ph = bind(`%${pattern.value}%`);
        aggregatedWhereConditions.push(`(hb.agents::text ILIKE ${ph})`);
    }
    if (filters.handledByMultiSearch && filters.handledByMultiSearch.length > 0) {
        // jsonpath : non paramétrable proprement, valeurs contraintes (picker) -> sqlQuote.
        const agentNumbers = filters.handledByMultiSearch.map(sqlQuote).join(", ");
        aggregatedWhereConditions.push(`(hb.agents::jsonb @? '$[*] ? (@.number in (${agentNumbers}))')`);
    }
    if (filters.queueSearch?.trim()) {
        const pattern = parseSearchPattern(filters.queueSearch);
        const ph = bind(`%${pattern.value}%`);
        aggregatedWhereConditions.push(`(cq.queues::text ILIKE ${ph})`);
    }
    if (filters.segmentCountMin !== undefined) {
        aggregatedWhereConditions.push(`ca.segment_count >= ${filters.segmentCountMin}`);
    }
    if (filters.segmentCountMax !== undefined) {
        aggregatedWhereConditions.push(`ca.segment_count <= ${filters.segmentCountMax}`);
    }
    if (filters.waitTimeMin !== undefined) {
        aggregatedWhereConditions.push(`EXTRACT(EPOCH FROM (COALESCE(ans.answered_at, ca.first_answered_at) - ca.first_started_at)) >= ${Number(filters.waitTimeMin)}`);
    }
    if (filters.waitTimeMax !== undefined) {
        aggregatedWhereConditions.push(`EXTRACT(EPOCH FROM (COALESCE(ans.answered_at, ca.first_answered_at) - ca.first_started_at)) <= ${Number(filters.waitTimeMax)}`);
    }
    if (filters.timeSlots && filters.timeSlots.length > 0) {
        const slotConditions = filters.timeSlots.map(slot => {
            const startPh = bind(slot.start);
            const endPh = bind(slot.end);
            return `((ca.first_started_at AT TIME ZONE '${timezone}')::time >= ${startPh}::time
                AND (ca.first_started_at AT TIME ZONE '${timezone}')::time < ${endPh}::time)`;
        });
        aggregatedWhereConditions.push(`(${slotConditions.join(' OR ')})`);
    }
    if (filters.journeyFilter && filters.journeyFilter.groups.length > 0) {
        const groupSqlParts = filters.journeyFilter.groups.map((filterGroup, gi) => {
            const group = filterGroup.group;
            const conditionSqlParts = group.conditions.map((gc, ci) => {
                const sql = buildSingleConditionSQL(gc.condition);
                if (!sql) return null;
                if (ci === 0) return `( ${sql} )`;
                const op = gc.operator === 'AND' ? ' AND ' : ' OR ';
                return `${op}( ${sql} )`;
            }).filter((s): s is string => s !== null);

            if (conditionSqlParts.length === 0) return null;
            return `( ${conditionSqlParts.join('')} )`;
        }).filter((s): s is string => s !== null);

        if (groupSqlParts.length > 0) {
            if (groupSqlParts.length === 1) {
                aggregatedWhereConditions.push(groupSqlParts[0]);
            } else {
                let combined = groupSqlParts[0];
                for (let i = 1; i < groupSqlParts.length; i++) {
                    const op = filters.journeyFilter.groups[i - 1].operator === 'AND' ? ' AND ' : ' OR ';
                    combined = `${combined}${op}${groupSqlParts[i]}`;
                }
                aggregatedWhereConditions.push(`( ${combined} )`);
            }
        }
    }

    return { whereClause, dateOnlyWhereClause, aggregatedWhereConditions, calleeFilterCTE, calleeFilterJoin, limit, skip, sortClause: buildOrderByClause(sort, timezone), params, queueViewCTE, queueViewJoin, queueViewSelect, viewQueue };
}

// ============================================
// JOURNEY CONDITION SQL BUILDER
// Builds SQL for a single journey condition node
// ============================================

function buildSingleConditionSQL(condition: JourneyConditionNode): string | null {
    const validTypes = ['direct', 'queue', 'voicemail'];
    const validResults = ['answered', 'not_answered', 'busy', 'voicemail', 'abandoned', 'overflow'];
    const clauses: string[] = [];

    const inferredType = condition.type
        || (condition.queueNumber ? 'queue' : undefined);

    if (inferredType && validTypes.includes(inferredType)) {
        clauses.push(`elem->>'type' = '${inferredType}'`);
    }
    if (condition.queueNumber) {
        const queueNum = condition.queueNumber.replace(/'/g, "''");
        clauses.push(`elem->>'label' = '${queueNum}'`);
    }
    if (condition.queueAgentNumber && condition.queueAgentNumber !== '*') {
        const agentNum = condition.queueAgentNumber.replace(/'/g, "''");
        clauses.push(`elem->>'agentNumber' = '${agentNum}'`);
    }
    if (condition.agentNumber) {
        const agentNum = condition.agentNumber.replace(/'/g, "''");
        clauses.push(`elem->>'agentNumber' = '${agentNum}'`);
    }
    if (condition.result && validResults.includes(condition.result)) {
        clauses.push(`elem->>'result' = '${condition.result}'`);
    }

    if (clauses.length === 0 && !condition.firstSegment && !condition.lastSegment && !condition.overflowQueueNumber) {
        return null;
    }

    const existsOp = condition.negate ? 'NOT EXISTS' : 'EXISTS';
    const queueNum = condition.queueNumber ? condition.queueNumber.replace(/'/g, "''") : null;

    const baseWhereClause = clauses.length > 0 ? clauses.join(' AND ') : 'true';

    if (condition.firstSegment) {
        return `${existsOp} (SELECT 1 FROM jsonb_array_elements(cj.journey::jsonb) WITH ORDINALITY AS t(elem, idx) WHERE (${baseWhereClause}) AND idx = 1)`;
    }

    if (condition.lastSegment) {
        return `${existsOp} (SELECT 1 FROM jsonb_array_elements(cj.journey::jsonb) WITH ORDINALITY AS t(elem, idx) WHERE (${baseWhereClause}) AND idx = (SELECT COUNT(*) FROM jsonb_array_elements(cj.journey::jsonb)))`;
    }

    if (condition.overflowQueueNumber && condition.overflowQueueNumber !== '*') {
        const overflowQueueNum = condition.overflowQueueNumber.replace(/'/g, "''");
        return `${existsOp} (SELECT 1 FROM jsonb_array_elements(cj.journey::jsonb) WITH ORDINALITY AS t(elem, idx) WHERE (${baseWhereClause})) AND EXISTS (SELECT 1 FROM jsonb_array_elements(cj.journey::jsonb) WITH ORDINALITY AS t(o_elem, o_idx) WHERE o_elem->>'type' = 'queue' AND o_elem->>'label' = '${overflowQueueNum}' AND o_idx > (SELECT MIN(idx2) FROM jsonb_array_elements(cj.journey::jsonb) WITH ORDINALITY AS t2(elem2, idx2) WHERE elem2->>'type' = 'queue' AND elem2->>'label' = '${queueNum}'))`;
    }

    if (condition.overflowQueueNumber === '*') {
        return `${existsOp} (SELECT 1 FROM jsonb_array_elements(cj.journey::jsonb) WITH ORDINALITY AS t(elem, idx) WHERE (${baseWhereClause})) AND EXISTS (SELECT 1 FROM jsonb_array_elements(cj.journey::jsonb) WITH ORDINALITY AS t(o_elem, o_idx) WHERE o_elem->>'type' = 'queue' AND o_elem->>'label' != '${queueNum}' AND o_idx > (SELECT MIN(idx2) FROM jsonb_array_elements(cj.journey::jsonb) WITH ORDINALITY AS t2(elem2, idx2) WHERE elem2->>'type' = 'queue' AND elem2->>'label' = '${queueNum}'))`;
    }

    return `${existsOp} (SELECT 1 FROM jsonb_array_elements(cj.journey::jsonb) elem WHERE ${baseWhereClause})`;
}

// ============================================
// SHARED SQL BUILDER — Single source for CTEs body
// Eliminates duplication between getCallLogsSQL() and getAggregatedCallLogs()
// ============================================

function buildAggregateCTEs(
    whereClause: string,
    dateOnlyWhereClause: string,
    calleeFilterCTE: string,
    extraCTE: string = "",
    // Table CDR au grain choisi (cf. cdrTable) — même grain que les statistiques.
    cdr: string = "cdroutput",
    // Seuil du bruit de routage (règle minSignificantDurationSeconds).
    noiseThresholdSec: number = 1
): string {
    return `
        WITH call_aggregates AS (
            SELECT
                call_history_id,
                COUNT(*) as segment_count,
                MIN(cdr_started_at) as first_started_at,
                MAX(cdr_ended_at) as last_ended_at,
                MIN(cdr_answered_at) as first_answered_at
            FROM ${cdr}
            WHERE ${whereClause}
            GROUP BY call_history_id
        ),
        first_segments AS (
            SELECT DISTINCT ON (c.call_history_id)
                c.call_history_id,
                c.source_dn_number,
                c.source_participant_phone_number,
                c.source_participant_name,
                c.source_dn_name,
                c.source_dn_type,
                c.source_presentation,
                c.destination_dn_number as first_dest_number,
                c.destination_participant_phone_number as first_dest_participant_phone,
                c.destination_participant_name as first_dest_participant_name,
                c.destination_dn_name as first_dest_dn_name,
                c.destination_dn_type
            FROM ${cdr} c
            WHERE ${dateOnlyWhereClause}
              AND c.call_history_id IN (SELECT call_history_id FROM call_aggregates)
            ORDER BY c.call_history_id, c.cdr_started_at ASC
        ),
        last_segments AS (
            SELECT DISTINCT ON (call_history_id)
                call_history_id,
                destination_dn_number,
                destination_participant_phone_number,
                destination_participant_name,
                destination_dn_name,
                destination_dn_type as last_dest_type,
                destination_entity_type as last_dest_entity_type,
                cdr_answered_at,
                cdr_started_at as last_started_at,
                cdr_ended_at as last_ended_at,
                termination_reason,
                termination_reason_details
            FROM ${cdr}
            WHERE ${whereClause}
            ORDER BY call_history_id, cdr_ended_at DESC, cdr_started_at DESC, cdr_id DESC
        ),
        last_human_segments AS (
            SELECT DISTINCT ON (call_history_id)
                call_history_id,
                destination_dn_type as last_human_dest_type,
                destination_entity_type as last_human_dest_entity_type,
                cdr_answered_at as last_human_answered_at,
                cdr_started_at as last_human_started_at,
                cdr_ended_at as last_human_ended_at,
                termination_reason_details as last_human_termination_reason_details
            FROM ${cdr}
            WHERE ${whereClause}
              -- Un appel SORTANT n'a jamais d'extension en destination : c'est
              -- la source. Ne retenir que les destinations « extension »
              -- rendait donc tout appel sortant « non répondu » — 10 488 cas
              -- sur le seul mois de juillet 2026, tous pourtant décrochés.
              -- On retient ici le dernier segment où une VRAIE partie a été
              -- jointe, interne ou externe, quel que soit le sens de l'appel.
              AND (destination_dn_type = 'extension' OR destination_dn_type IN ('provider', 'external_line'))
              AND COALESCE(destination_entity_type, '') != 'voicemail'
            ORDER BY call_history_id, cdr_ended_at DESC, cdr_started_at DESC, cdr_id DESC
        ),
        answered_segments AS (
            SELECT DISTINCT ON (c.call_history_id)
                c.call_history_id,
                c.destination_dn_number as answered_dest_number,
                c.destination_participant_name as answered_dest_name,
                c.destination_dn_name as answered_dn_name,
                c.destination_dn_type as answered_dest_type,
                c.cdr_answered_at as answered_at,
                c.cdr_ended_at as answered_ended_at,
                EXTRACT(EPOCH FROM (c.cdr_ended_at - c.cdr_answered_at)) as talk_duration_seconds
            FROM ${cdr} c
            WHERE ${dateOnlyWhereClause}
              AND c.cdr_answered_at IS NOT NULL
              AND c.destination_dn_type = 'extension'
              AND c.call_history_id IN (SELECT call_history_id FROM call_aggregates)
            ORDER BY c.call_history_id, c.cdr_answered_at ASC, c.cdr_id ASC
        ),
        handled_by AS (
            SELECT
                c.call_history_id,
                JSON_AGG(
                    JSON_BUILD_OBJECT(
                        'number', c.destination_dn_number,
                        'name', COALESCE(c.destination_dn_name, c.destination_participant_name, c.destination_dn_number)
                    ) ORDER BY c.cdr_answered_at DESC
                ) as agents,
                SUM(EXTRACT(EPOCH FROM (c.cdr_ended_at - c.cdr_answered_at))) as total_talk_seconds,
                COUNT(*) as agent_count
            FROM ${cdr} c
            WHERE ${dateOnlyWhereClause}
              AND c.cdr_answered_at IS NOT NULL
              AND c.destination_dn_type = 'extension'
              AND c.call_history_id IN (SELECT call_history_id FROM call_aggregates)
            GROUP BY c.call_history_id
        ),
        call_queues AS (
            SELECT
                dq.call_history_id,
                JSON_AGG(
                    JSON_BUILD_OBJECT(
                        'number', dq.destination_dn_number,
                        'name', dq.queue_name
                    )
                ) as queues,
                COUNT(*) as queue_count
            FROM (
                SELECT DISTINCT
                    c.call_history_id,
                    c.destination_dn_number,
                    COALESCE(c.destination_dn_name, c.destination_dn_number) as queue_name
                FROM ${cdr} c
                WHERE ${dateOnlyWhereClause}
                  AND c.destination_dn_type = 'queue'
                  AND c.call_history_id IN (SELECT call_history_id FROM call_aggregates)
            ) dq
            GROUP BY dq.call_history_id
        ),
        queue_outcome AS (
            SELECT DISTINCT ON (p.originating_cdr_id)
                p.originating_cdr_id,
                p.destination_dn_name as agent_name,
                p.destination_dn_number as agent_number
            FROM ${cdr} p
            WHERE ${dateOnlyWhereClause}
              AND p.call_history_id IN (SELECT call_history_id FROM call_aggregates)
              AND p.creation_forward_reason = 'polling'
              AND p.cdr_answered_at IS NOT NULL
            ORDER BY p.originating_cdr_id, p.cdr_answered_at ASC, p.cdr_id ASC
        ),
        queue_overflow AS (
            SELECT c.cdr_id
            FROM ${cdr} c
            WHERE ${dateOnlyWhereClause}
              AND c.destination_dn_type = 'queue'
              AND c.call_history_id IN (SELECT call_history_id FROM call_aggregates)
              AND NOT EXISTS (
                  SELECT 1 FROM ${cdr} p
                  WHERE p.originating_cdr_id = c.cdr_id
                    AND p.creation_forward_reason = 'polling'
                    AND p.cdr_answered_at IS NOT NULL
              )
              AND EXISTS (
                  SELECT 1 FROM ${cdr} c2
                  WHERE c2.call_history_id = c.call_history_id
                    AND c2.destination_dn_type = 'queue'
                    AND c2.destination_dn_number != c.destination_dn_number
                    AND c2.cdr_started_at > c.cdr_started_at
              )
        ),
        call_journey AS (
            SELECT
                j.call_history_id,
                JSON_AGG(
                    JSON_BUILD_OBJECT(
                        'type', j.step_type,
                        'label', j.step_label,
                        'detail', j.step_detail,
                        'result', j.step_result,
                        'agent', j.agent_name,
                        'agentNumber', j.agent_number
                    ) ORDER BY j.step_order
                ) as journey
            FROM (
                SELECT * FROM (
                    SELECT
                        c.call_history_id,
                        c.cdr_started_at as step_order,
                        CASE
                            WHEN c.destination_entity_type = 'voicemail' THEN 'voicemail'
                            WHEN c.destination_dn_type = 'queue' THEN 'queue'
                            ELSE 'direct'
                        END as step_type,
                        c.destination_dn_number as step_label,
                        CASE
                            WHEN c.destination_entity_type = 'voicemail' THEN 'Messagerie ' || COALESCE(c.destination_dn_name, c.destination_dn_number)
                            WHEN c.destination_dn_type = 'queue' THEN COALESCE(c.destination_dn_name, c.destination_dn_number)
                            ELSE COALESCE(c.destination_dn_name, c.destination_dn_number)
                        END as step_detail,
                        CASE
                            WHEN c.destination_dn_type = 'queue' THEN COALESCE(qo.agent_name, qo.agent_number)
                            WHEN c.destination_dn_type = 'extension' THEN COALESCE(c.destination_dn_name, c.destination_dn_number)
                            WHEN c.destination_dn_type IN ('provider', 'external_line') THEN COALESCE(c.destination_participant_phone_number, c.destination_dn_name, c.destination_dn_number)
                            ELSE NULL
                        END as agent_name,
                        CASE
                            WHEN c.destination_dn_type = 'queue' THEN qo.agent_number
                            WHEN c.destination_dn_type = 'extension' THEN c.destination_dn_number
                            WHEN c.destination_dn_type IN ('provider', 'external_line') THEN c.destination_participant_phone_number
                            ELSE NULL
                        END as agent_number,
                        CASE
                            WHEN c.destination_entity_type = 'voicemail' THEN 'voicemail'
                            WHEN c.destination_dn_type = 'queue' THEN
                                CASE
                                    WHEN qo.originating_cdr_id IS NOT NULL THEN 'answered'
                                    WHEN qov.cdr_id IS NOT NULL THEN 'overflow'
                                    ELSE 'abandoned'
                                END
                            ELSE
                                CASE
                                    WHEN c.cdr_answered_at IS NOT NULL THEN 'answered'
                                    WHEN c.termination_reason_details = 'busy' THEN 'busy'
                                    ELSE 'not_answered'
                                END
                        END as step_result,
                        ROW_NUMBER() OVER (PARTITION BY c.call_history_id ORDER BY c.cdr_started_at) as step_num
                    FROM ${cdr} c
                    LEFT JOIN queue_outcome qo ON c.cdr_id = qo.originating_cdr_id
                    LEFT JOIN queue_overflow qov ON c.cdr_id = qov.cdr_id
                    WHERE ${dateOnlyWhereClause}
                      AND c.call_history_id IN (SELECT call_history_id FROM call_aggregates)
                      AND (
                          c.destination_entity_type = 'voicemail'
                          OR c.destination_dn_type = 'queue'
                          OR c.destination_dn_type IN ('provider', 'external_line')
                          OR (${buildDirectSegmentWhereClause('c', { durationThreshold: noiseThresholdSec })})
                      )
                ) all_steps
                WHERE all_steps.step_num <= 15
            ) j
            GROUP BY j.call_history_id
        )${calleeFilterCTE}${extraCTE}`;
}

// Shared SELECT columns for data queries
const DATA_SELECT_BASE = `
        SELECT
            ca.call_history_id,
            ca.segment_count,
            ca.first_started_at,
            ca.last_ended_at,
            ca.first_answered_at,
            fs.source_dn_number,
            fs.source_participant_phone_number,
            fs.source_participant_name,
            fs.source_dn_name,
            fs.source_dn_type,
            fs.source_presentation,
            fs.first_dest_number,
            fs.first_dest_participant_phone,
            fs.first_dest_participant_name,
            fs.first_dest_dn_name,
            fs.destination_dn_type as first_dest_type,
            ls.destination_dn_number,
            ls.destination_participant_phone_number,
            ls.destination_participant_name,
            ls.destination_dn_name,
            ls.last_dest_type,
            ls.last_dest_entity_type,
            ls.cdr_answered_at as last_answered_at,
            ls.last_started_at,
            ls.last_ended_at,
            ls.termination_reason,
            ls.termination_reason_details,
            lhs.last_human_answered_at,
            lhs.last_human_started_at,
            lhs.last_human_ended_at,
            ans.answered_dest_number,
            ans.answered_dest_name,
            ans.answered_dn_name,
            ans.answered_dest_type,
            ans.answered_at,
            ans.answered_ended_at,
            ans.talk_duration_seconds,
            hb.agents as handled_by_agents,
            hb.total_talk_seconds as handled_by_total_talk,
            hb.agent_count as handled_by_count,
            cq.queues as call_queues,
            cq.queue_count,
            cj.journey as call_journey`;

/**
 * Colonnes de la vue file : le statut de l'appel DANS la file consultee, et la
 * file qui l'a finalement traite le cas echeant. Les deux ensemble permettent
 * de lire « perdu chez moi, mais recupere ailleurs » sans avoir a choisir entre
 * la vue file et la vue entreprise.
 */
function buildDataSelect(queueViewSelect: string): string {
    return DATA_SELECT_BASE + queueViewSelect;
}

// Shared FROM + JOINs for data queries
function buildDataJoins(calleeFilterJoin: string, aggregatedWhereConditions: string[], sortClause: string, limit: number, skip: number, queueViewJoin: string = ""): string {
    return `
        FROM call_aggregates ca
        JOIN first_segments fs ON ca.call_history_id = fs.call_history_id
        JOIN last_segments ls ON ca.call_history_id = ls.call_history_id
        LEFT JOIN last_human_segments lhs ON ca.call_history_id = lhs.call_history_id
        LEFT JOIN answered_segments ans ON ca.call_history_id = ans.call_history_id
        LEFT JOIN handled_by hb ON ca.call_history_id = hb.call_history_id
        LEFT JOIN call_queues cq ON ca.call_history_id = cq.call_history_id
        LEFT JOIN call_journey cj ON ca.call_history_id = cj.call_history_id
        ${queueViewJoin}
        ${calleeFilterJoin}
        ${aggregatedWhereConditions.length > 0 ? 'WHERE ' + aggregatedWhereConditions.join(' AND ') : ''}
        ORDER BY ${sortClause}
        LIMIT ${limit} OFFSET ${skip}`;
}

// ============================================
// GET SQL QUERY STRING (for debugging)
// ============================================

/** Outil de diagnostic : réservé aux administrateurs. */
export async function getCallLogsSQL(
    serverId: ServerId,
    startDate: Date,
    endDate: Date,
    filters: LogsFilters,
    pagination: { page: number; pageSize: number },
    sort?: LogsSort
): Promise<string> {
    await requireActionRole(["ADMIN"]);
    const timezone = await getServerTimezone(serverId);
    const rules = await getClassificationRules();
    const { whereClause, dateOnlyWhereClause, aggregatedWhereConditions, calleeFilterCTE, calleeFilterJoin, limit, skip, sortClause } =
        buildAggregatedQueryParts(startDate, endDate, filters, pagination, sort, timezone, undefined, rules);

    return buildAggregateCTEs(whereClause, dateOnlyWhereClause, calleeFilterCTE, "", cdrTable(rules), rules.minSignificantDurationSeconds)
        + buildDataSelect("")
        + buildDataJoins(calleeFilterJoin, aggregatedWhereConditions, sortClause, limit, skip);
}

// ============================================
// OPTIMIZED COUNT QUERY — conditional CTEs
// Only includes expensive CTEs when actually filtering on them.
//
// ⚠️ NE PAS "dé-dupliquer" en réutilisant buildAggregateCTEs : la différence est
// VOLONTAIRE. buildAggregateCTEs construit toujours les CTEs coûteuses (handled_by /
// call_queues / call_journey) car la requête de données les AFFICHE ; le comptage ne
// les construit que si un filtre les utilise. Les fusionner reconstruirait le JSON du
// parcours à chaque comptage = régression de perf sur la page la plus utilisée (Logs).
// Validé : le comptage tombe exactement sur le nb de lignes de la requête de données
// (cf. harnais de caractérisation, scripts/characterize-logs.ts).
// ============================================

function buildCountQuery(
    whereClause: string,
    dateOnlyWhereClause: string,
    calleeFilterCTE: string,
    calleeFilterJoin: string,
    aggregatedWhereConditions: string[],
    filters: LogsFilters,
    // Table CDR au grain choisi (cf. cdrTable) — même grain que les statistiques.
    cdr: string = "cdroutput",
    // Seuil du bruit de routage (règle minSignificantDurationSeconds).
    noiseThresholdSec: number = 1
): string {
    const needsHandledBy = !!filters.handledBySearch?.trim();
    const needsCallQueues = !!filters.queueSearch?.trim();
    const needsCallJourney = !!(filters.journeyFilter && filters.journeyFilter.groups.length > 0);

    const handledByCTE = needsHandledBy ? `,
        handled_by AS (
            SELECT
                c.call_history_id,
                JSON_AGG(
                    JSON_BUILD_OBJECT(
                        'number', c.destination_dn_number,
                        'name', COALESCE(c.destination_dn_name, c.destination_participant_name, c.destination_dn_number)
                    ) ORDER BY c.cdr_answered_at DESC
                ) as agents
            FROM ${cdr} c
            WHERE ${dateOnlyWhereClause}
              AND c.cdr_answered_at IS NOT NULL
              AND c.destination_dn_type = 'extension'
              AND c.call_history_id IN (SELECT call_history_id FROM call_aggregates)
            GROUP BY c.call_history_id
        )` : '';

    const callQueuesCTE = needsCallQueues ? `,
        call_queues AS (
            SELECT
                dq.call_history_id,
                JSON_AGG(
                    JSON_BUILD_OBJECT(
                        'number', dq.destination_dn_number,
                        'name', dq.queue_name
                    )
                ) as queues
            FROM (
                SELECT DISTINCT
                    c.call_history_id,
                    c.destination_dn_number,
                    COALESCE(c.destination_dn_name, c.destination_dn_number) as queue_name
                FROM ${cdr} c
                WHERE ${dateOnlyWhereClause}
                  AND c.destination_dn_type = 'queue'
                  AND c.call_history_id IN (SELECT call_history_id FROM call_aggregates)
            ) dq
            GROUP BY dq.call_history_id
        )` : '';

    const callJourneyCTE = needsCallJourney ? `,
        queue_outcome AS (
            SELECT DISTINCT ON (p.originating_cdr_id)
                p.originating_cdr_id,
                p.destination_dn_name as agent_name,
                p.destination_dn_number as agent_number
            FROM ${cdr} p
            WHERE ${dateOnlyWhereClause}
              AND p.call_history_id IN (SELECT call_history_id FROM call_aggregates)
              AND p.creation_forward_reason = 'polling'
              AND p.cdr_answered_at IS NOT NULL
            ORDER BY p.originating_cdr_id, p.cdr_answered_at ASC, p.cdr_id ASC
        ),
        queue_overflow AS (
            SELECT c.cdr_id
            FROM ${cdr} c
            WHERE ${dateOnlyWhereClause}
              AND c.destination_dn_type = 'queue'
              AND c.call_history_id IN (SELECT call_history_id FROM call_aggregates)
              AND NOT EXISTS (
                  SELECT 1 FROM ${cdr} p
                  WHERE p.originating_cdr_id = c.cdr_id
                    AND p.creation_forward_reason = 'polling'
                    AND p.cdr_answered_at IS NOT NULL
              )
              AND EXISTS (
                  SELECT 1 FROM ${cdr} c2
                  WHERE c2.call_history_id = c.call_history_id
                    AND c2.destination_dn_type = 'queue'
                    AND c2.destination_dn_number != c.destination_dn_number
                    AND c2.cdr_started_at > c.cdr_started_at
              )
        ),
        call_journey AS (
            SELECT
                j.call_history_id,
                JSON_AGG(
                    JSON_BUILD_OBJECT(
                        'type', j.step_type, 'label', j.step_label,
                        'detail', j.step_detail, 'result', j.step_result,
                        'agent', j.agent_name, 'agentNumber', j.agent_number
                    ) ORDER BY j.step_order
                ) as journey
            FROM (
                SELECT * FROM (
                    SELECT
                        c.call_history_id,
                        c.cdr_started_at as step_order,
                        CASE WHEN c.destination_entity_type = 'voicemail' THEN 'voicemail'
                             WHEN c.destination_dn_type = 'queue' THEN 'queue' ELSE 'direct' END as step_type,
                        c.destination_dn_number as step_label,
                        COALESCE(c.destination_dn_name, c.destination_dn_number) as step_detail,
                        CASE
                            WHEN c.destination_dn_type = 'queue' THEN COALESCE(qo.agent_name, qo.agent_number)
                            WHEN c.destination_dn_type = 'extension' THEN c.destination_dn_number
                            WHEN c.destination_dn_type IN ('provider', 'external_line') THEN c.destination_participant_phone_number
                            ELSE NULL
                        END as agent_name,
                        CASE
                            WHEN c.destination_dn_type = 'queue' THEN qo.agent_number
                            WHEN c.destination_dn_type = 'extension' THEN c.destination_dn_number
                            WHEN c.destination_dn_type IN ('provider', 'external_line') THEN c.destination_participant_phone_number
                            ELSE NULL
                        END as agent_number,
                        CASE WHEN c.destination_entity_type = 'voicemail' THEN 'voicemail'
                             WHEN c.destination_dn_type = 'queue' THEN
                                 CASE WHEN qo.originating_cdr_id IS NOT NULL THEN 'answered'
                                      WHEN qov.cdr_id IS NOT NULL THEN 'overflow' ELSE 'abandoned' END
                             ELSE CASE WHEN c.cdr_answered_at IS NOT NULL THEN 'answered'
                                       WHEN c.termination_reason_details = 'busy' THEN 'busy'
                                       ELSE 'not_answered' END
                        END as step_result,
                        ROW_NUMBER() OVER (PARTITION BY c.call_history_id ORDER BY c.cdr_started_at) as step_num
                    FROM ${cdr} c
                    LEFT JOIN queue_outcome qo ON c.cdr_id = qo.originating_cdr_id
                    LEFT JOIN queue_overflow qov ON c.cdr_id = qov.cdr_id
                    WHERE ${dateOnlyWhereClause}
                      AND c.call_history_id IN (SELECT call_history_id FROM call_aggregates)
                      AND (
                          c.destination_entity_type = 'voicemail'
                          OR c.destination_dn_type = 'queue'
                          OR c.destination_dn_type IN ('provider', 'external_line')
                          OR (${buildDirectSegmentWhereClause('c', { durationThreshold: noiseThresholdSec })})
                      )
                ) all_steps WHERE all_steps.step_num <= 15
            ) j GROUP BY j.call_history_id
        )` : '';

    const handledByJoin = needsHandledBy ? 'LEFT JOIN handled_by hb ON ca.call_history_id = hb.call_history_id' : '';
    const callQueuesJoin = needsCallQueues ? 'LEFT JOIN call_queues cq ON ca.call_history_id = cq.call_history_id' : '';
    const callJourneyJoin = needsCallJourney ? 'LEFT JOIN call_journey cj ON ca.call_history_id = cj.call_history_id' : '';

    return `
        WITH call_aggregates AS (
            SELECT
                call_history_id,
                COUNT(*) as segment_count,
                MIN(cdr_started_at) as first_started_at,
                MIN(cdr_answered_at) as first_answered_at
            FROM ${cdr}
            WHERE ${whereClause}
            GROUP BY call_history_id
        ),
        first_segments AS (
            SELECT DISTINCT ON (call_history_id)
                call_history_id,
                source_dn_type,
                destination_dn_type
            FROM ${cdr}
            WHERE ${dateOnlyWhereClause}
              AND call_history_id IN (SELECT call_history_id FROM call_aggregates)
            ORDER BY call_history_id, cdr_started_at ASC
        ),
        last_segments AS (
            SELECT DISTINCT ON (call_history_id)
                call_history_id,
                destination_dn_type as last_dest_type,
                destination_entity_type as last_dest_entity_type,
                cdr_answered_at,
                cdr_started_at as last_started_at,
                cdr_ended_at as last_ended_at,
                termination_reason,
                termination_reason_details
            FROM ${cdr}
            WHERE ${whereClause}
            ORDER BY call_history_id, cdr_ended_at DESC, cdr_started_at DESC, cdr_id DESC
        ),
        last_human_segments AS (
            SELECT DISTINCT ON (call_history_id)
                call_history_id,
                cdr_answered_at as last_human_answered_at,
                cdr_started_at as last_human_started_at,
                cdr_ended_at as last_human_ended_at
            FROM ${cdr}
            WHERE ${whereClause}
              -- Un appel SORTANT n'a jamais d'extension en destination : c'est
              -- la source. Ne retenir que les destinations « extension »
              -- rendait donc tout appel sortant « non répondu » — 10 488 cas
              -- sur le seul mois de juillet 2026, tous pourtant décrochés.
              -- On retient ici le dernier segment où une VRAIE partie a été
              -- jointe, interne ou externe, quel que soit le sens de l'appel.
              AND (destination_dn_type = 'extension' OR destination_dn_type IN ('provider', 'external_line'))
              AND COALESCE(destination_entity_type, '') != 'voicemail'
            ORDER BY call_history_id, cdr_ended_at DESC, cdr_started_at DESC, cdr_id DESC
        ),
        answered_segments AS (
            SELECT DISTINCT ON (c.call_history_id)
                c.call_history_id,
                c.cdr_answered_at as answered_at
            FROM ${cdr} c
            WHERE ${dateOnlyWhereClause}
              AND c.cdr_answered_at IS NOT NULL
              AND c.destination_dn_type = 'extension'
              AND c.call_history_id IN (SELECT call_history_id FROM call_aggregates)
            ORDER BY c.call_history_id, c.cdr_answered_at ASC, c.cdr_id ASC
        )${handledByCTE}${callQueuesCTE}${callJourneyCTE}${calleeFilterCTE}
        SELECT COUNT(*) as total
        FROM call_aggregates ca
        JOIN first_segments fs ON ca.call_history_id = fs.call_history_id
        JOIN last_segments ls ON ca.call_history_id = ls.call_history_id
        LEFT JOIN last_human_segments lhs ON ca.call_history_id = lhs.call_history_id
        LEFT JOIN answered_segments ans ON ca.call_history_id = ans.call_history_id
        ${handledByJoin}
        ${callQueuesJoin}
        ${callJourneyJoin}
        ${calleeFilterJoin}
        ${aggregatedWhereConditions.length > 0 ? 'WHERE ' + aggregatedWhereConditions.join(' AND ') : ''}
    `;
}

// ============================================
// TRANSFORM raw SQL row → AggregatedCallLog
// ============================================

 
/** Applique le masquage seulement quand la portée l'exige. */
function maybeMask(value: string, mask: boolean): string {
    return mask ? maskPhoneNumber(value) : value;
}

/**
 * Décrit la file ayant finalement répondu, en respectant la règle 6 du socle
 * (`outOfScopeFinalStatus`).
 *
 * L'intérêt de la double colonne est de montrer au manager que ses « perdus »
 * ont pu être récupérés — mais « ailleurs » est souvent hors de son périmètre.
 * Le réglage décide si l'on nomme la file, si l'on reste vague, ou si l'on se
 * tait. Appliqué CÔTÉ SERVEUR : masquer la colonne au client ne suffirait pas.
 */
function buildAnsweringQueue(
    row: any,
    scope?: AccessScope,
    rules: ClassificationRules = DEFAULT_CLASSIFICATION_RULES,
): { number: string; name: string; inScope: boolean } | null {
    const number = row.answering_queue_number;
    if (!number) return null;

    // Sans ce garde-fou, un appel bien traité par la file consultée puis
    // transféré afficherait « répondu par 993 », ce qui laisse croire que la
    // file n'a rien fait. La colonne ne sert que si la file n'a PAS répondu.
    if (row.queue_view_status === "answered") return null;

    const inScope = !scope || scope.unrestricted || (scope.queueNumbers?.includes(number) ?? false);
    if (inScope) return { number, name: row.answering_queue_name || number, inScope: true };

    switch (rules.outOfScopeFinalStatus) {
        case "hide":
            return null;
        case "anonymize":
            return { number: "", name: "hors périmètre", inScope: false };
        default:
            return { number, name: row.answering_queue_name || number, inScope: false };
    }
}

function transformRow(row: any, maskNumbers = false, scope?: AccessScope, rules?: ClassificationRules): AggregatedCallLog {
    const firstStarted = row.first_started_at ? new Date(row.first_started_at) : null;
    const lastEnded = row.last_ended_at ? new Date(row.last_ended_at) : null;
    const firstAnswered = row.first_answered_at ? new Date(row.first_answered_at) : null;
    const answeredByHuman = row.answered_at ? new Date(row.answered_at) : null;
    const talkDurationSeconds = row.talk_duration_seconds ? Math.round(Number(row.talk_duration_seconds)) : 0;

    let parsedHandledByAgents: Array<{ number: string; name: string }> = [];
    if (row.handled_by_agents) {
        try {
            parsedHandledByAgents = typeof row.handled_by_agents === 'string'
                ? JSON.parse(row.handled_by_agents)
                : row.handled_by_agents;
        } catch { parsedHandledByAgents = []; }
    }
    const parsedHandledByCount = Number(row.handled_by_count || 0);

    const totalDurationSeconds = firstStarted && lastEnded
        ? Math.round((lastEnded.getTime() - firstStarted.getTime()) / 1000)
        : 0;
    const waitTimeSeconds = firstStarted && (answeredByHuman || firstAnswered)
        ? Math.round(((answeredByHuman || firstAnswered)!.getTime() - firstStarted.getTime()) / 1000)
        : (firstStarted && lastEnded ? Math.round((lastEnded.getTime() - firstStarted.getTime()) / 1000) : 0);

    const lastSegmentAnswered = row.answered_at !== null;
    const finalStatus = determineCallStatus({
        lastDestType: row.last_dest_type,
        lastDestEntityType: row.last_dest_entity_type,
        terminationReasonDetails: row.termination_reason_details,
        lastHumanAnsweredAt: row.last_human_answered_at ? new Date(row.last_human_answered_at) : null,
        lastHumanStartedAt: row.last_human_started_at ? new Date(row.last_human_started_at) : null,
        lastHumanEndedAt: row.last_human_ended_at ? new Date(row.last_human_ended_at) : null,
    }, rules?.minAnswerSeconds);
    const provenance = determineCallProvenance(row.source_dn_type);
    const sens = determineCallSens({
        sourceType: row.source_dn_type,
        firstDestType: row.first_dest_type,
    });
    const viaBridge = callTouchesBridge({
        sourceType: row.source_dn_type,
        firstDestType: row.first_dest_type,
        lastDestType: row.last_dest_type,
    });

    const totalTalkSeconds = Math.round(Number(row.handled_by_total_talk || 0));

    let handledByDisplay = "-";
    if (parsedHandledByAgents.length > 0) {
        const displayAgents = parsedHandledByAgents.slice(0, 5);
        handledByDisplay = displayAgents.map(a => a.name || a.number).join(", ");
        if (parsedHandledByCount > 5) {
            handledByDisplay += ` (+${parsedHandledByCount - 5})`;
        }
    }

    const parseJsonCol = (col: unknown): unknown[] => {
        if (!col) return [];
        try {
            const parsed = typeof col === 'string' ? JSON.parse(col) : col;
            return Array.isArray(parsed) ? parsed : [];
        } catch { return []; }
    };

    const queues = parseJsonCol(row.call_queues) as Array<{ number: string; name: string }>;
    const journey = parseJsonCol(row.call_journey);

    return {
        callHistoryId: row.call_history_id,
        callHistoryIdShort: row.call_history_id?.slice(-4).toUpperCase() || "-",
        segmentCount: Number(row.segment_count),
        startedAt: row.first_started_at?.toISOString() || "",
        endedAt: row.last_ended_at?.toISOString() || "",
        totalDurationSeconds: lastSegmentAnswered ? totalTalkSeconds : totalDurationSeconds,
        totalDurationFormatted: formatDuration(lastSegmentAnswered ? totalTalkSeconds : totalDurationSeconds),
        waitTimeSeconds,
        waitTimeFormatted: formatDuration(waitTimeSeconds),
        // Masquage appliqué côté serveur : le numéro complet ne quitte jamais le
        // serveur pour un utilisateur sans la permission correspondante.
        callerNumber: maybeMask(
            getDisplayNumber(row.source_dn_number, row.source_participant_phone_number, row.source_presentation),
            maskNumbers,
        ),
        callerName: row.source_dn_type?.toLowerCase() === 'provider'
            ? (row.source_participant_name && !row.source_participant_name.trim().endsWith(':')
                ? getDisplayName(row.source_participant_name, null)
                : null)
            : (getDisplayName(row.source_participant_name, row.source_dn_name) || null),
        calleeNumber: maybeMask(getDisplayNumber(row.first_dest_number, row.first_dest_participant_phone), maskNumbers),
        calleeName: row.source_dn_type?.toLowerCase() === 'provider'
            ? (getDisplayName(row.first_dest_participant_name, row.first_dest_dn_name)
                || (row.source_participant_name?.trim().endsWith(':') ? getDisplayName(row.source_participant_name, null) : null))
            : (getDisplayName(row.first_dest_participant_name, row.first_dest_dn_name) || null),
        handledBy: parsedHandledByAgents,
        handledByDisplay,
        totalTalkDurationSeconds: totalTalkSeconds,
        totalTalkDurationFormatted: formatDuration(totalTalkSeconds),
        provenance,
        sens,
        viaBridge,
        finalStatus,
        wasTransferred: Number(row.segment_count) > 1,
        queues,
        queuesDisplay: queues.length > 0
            ? queues.map((q: { number: string; name: string }) => q.name || q.number).join(", ")
            : "-",
        journey: journey as import("@/services/domain/call.types").JourneyStep[],
        queueViewStatus: row.queue_view_status ?? null,
        queueViewIsDirect: Boolean(row.queue_view_is_direct),
        answeringQueue: buildAnsweringQueue(row, scope, rules),
    };
}

// ============================================
// GET AGGREGATED CALL LOGS (paginated)
// ============================================

export async function getAggregatedCallLogs(
    serverId: ServerId,
    startDate: Date,
    endDate: Date,
    filters: LogsFilters,
    pagination: { page: number; pageSize: number },
    sort?: LogsSort
): Promise<AggregatedCallLogsResponse> {
    const prisma = getPrismaCdr(serverId);
    const timezone = await getServerTimezone(serverId);
    // ⚠️ La portée est résolue ICI, jamais reçue en paramètre : ce module est
    // "use server", donc ses arguments sont contrôlables par le client.
    const scope = await resolveAccessScope(serverId);
    // Le droit aux logs se vérifie côté serveur : masquer les liens dans
    // l'interface n'est pas un contrôle d'accès.
    if (!scope.canViewLogs) {
        throw new Error("L'accès aux logs d'appels ne vous est pas autorisé");
    }
    const rules = await getClassificationRules();
    const { whereClause, dateOnlyWhereClause, aggregatedWhereConditions, calleeFilterCTE, calleeFilterJoin, limit, skip, sortClause, params,
        queueViewCTE, queueViewJoin, queueViewSelect, viewQueue } =
        buildAggregatedQueryParts(startDate, endDate, filters, pagination, sort, timezone, scope, rules);
    const pageNumber = Math.max(1, pagination.page);

    try {
        const dataQuery = buildAggregateCTEs(whereClause, dateOnlyWhereClause, calleeFilterCTE, queueViewCTE, cdrTable(rules), rules.minSignificantDurationSeconds)
            + buildDataSelect(queueViewSelect ?? "")
            + buildDataJoins(calleeFilterJoin, aggregatedWhereConditions, sortClause, limit, skip, queueViewJoin);

        const countQuery = buildCountQuery(
            whereClause, dateOnlyWhereClause, calleeFilterCTE, calleeFilterJoin,
            aggregatedWhereConditions, filters, cdrTable(rules), rules.minSignificantDurationSeconds
        );

         
        const [rawResults, countResult] = await Promise.all([
            prisma.$queryRawUnsafe<any[]>(dataQuery, ...params),
            prisma.$queryRawUnsafe<{ total: bigint }[]>(countQuery, ...params),
        ]);

        const totalCount = Number(countResult[0]?.total || 0);
        const totalPages = Math.ceil(totalCount / limit);
        const logs = rawResults.map((row) => transformRow(row, scope.maskPhoneNumbers, scope, rules));

        return { logs, totalCount, totalPages, currentPage: pageNumber };
    } catch (error) {
        console.error("❌ Error fetching aggregated call logs:", error);
        return { logs: [], totalCount: 0, totalPages: 0, currentPage: pageNumber };
    }
}

// ============================================
// GET CALL CHAIN (for modal - shows all segments)
// ============================================

export async function getCallChain(serverId: ServerId, callHistoryId: string): Promise<CallChainSegment[]> {
    if (!callHistoryId) return [];

    try {
        const prisma = getPrismaCdr(serverId);
        const rules = await getClassificationRules();
        const cdr = cdrTable(rules);
        const merged = rules.callGrain === "merged";

        // L'identifiant d'appel arrive du client : sans cette vérification, il
        // suffirait d'en deviner un pour lire la chaîne complète d'un appel hors
        // périmètre (numéros compris). Le contrôle porte sur l'appel AU GRAIN
        // CHOISI : au grain fusionné, une jambe dans le périmètre ouvre le
        // parcours entier — comme dans les listes qui y mènent.
        const scope = await resolveAccessScope(serverId);
        if (!scope.canViewLogs) return [];
        if (!scope.unrestricted) {
            if (scope.empty) return [];
            const scopeParams: unknown[] = [callHistoryId];
            const bindScope = (value: unknown): string => {
                scopeParams.push(value);
                return `$${scopeParams.length}`;
            };
            const scopeParts: string[] = [];
            if (scope.queueNumbers && scope.queueNumbers.length > 0) {
                const ph = scope.queueNumbers.map(bindScope);
                scopeParts.push(`(destination_dn_type = 'queue' AND destination_dn_number IN (${ph.join(", ")}))`);
            }
            if (scope.extensions.kind === "only") {
                if (scope.extensions.numbers.length > 0) {
                    const ph = scope.extensions.numbers.map(bindScope);
                    scopeParts.push(`(destination_dn_type = 'extension' AND destination_dn_number IN (${ph.join(", ")}))`);
                }
            } else if (scope.extensions.numbers.length > 0) {
                const ph = scope.extensions.numbers.map(bindScope);
                scopeParts.push(`(destination_dn_type = 'extension' AND destination_dn_number NOT IN (${ph.join(", ")}))`);
            } else {
                scopeParts.push(`(destination_dn_type = 'extension')`);
            }
            if (scopeParts.length === 0) return [];
            const touches = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
                `SELECT COUNT(*) AS n FROM ${cdr}
                 WHERE call_history_id = $1::uuid AND (${scopeParts.join(" OR ")})`,
                ...scopeParams,
            );
            if (Number(touches[0]?.n ?? 0) === 0) return [];
        }

        // Au grain fusionné, la vue expose l'identifiant de la jambe d'origine :
        // la modale peut alors marquer chaque frontière de transfert.
        const segments = await prisma.$queryRawUnsafe<Array<{
            cdr_id: string;
            cdr_started_at: Date | null;
            cdr_answered_at: Date | null;
            cdr_ended_at: Date | null;
            source_dn_number: string | null;
            source_participant_phone_number: string | null;
            source_participant_name: string | null;
            source_dn_name: string | null;
            source_dn_type: string | null;
            source_presentation: string | null;
            destination_dn_number: string | null;
            destination_participant_phone_number: string | null;
            destination_participant_name: string | null;
            destination_dn_name: string | null;
            destination_dn_type: string | null;
            destination_entity_type: string | null;
            termination_reason: string | null;
            termination_reason_details: string | null;
            creation_method: string | null;
            creation_forward_reason: string | null;
            originating_cdr_id: string | null;
            leg_call_history_id: string | null;
        }>>(
            `SELECT cdr_id, cdr_started_at, cdr_answered_at, cdr_ended_at,
                    source_dn_number, source_participant_phone_number, source_participant_name,
                    source_dn_name, source_dn_type, source_presentation,
                    destination_dn_number, destination_participant_phone_number, destination_participant_name,
                    destination_dn_name, destination_dn_type, destination_entity_type,
                    termination_reason, termination_reason_details,
                    creation_method, creation_forward_reason, originating_cdr_id,
                    ${merged ? "leg_call_history_id" : "call_history_id AS leg_call_history_id"}
             FROM ${cdr}
             WHERE call_history_id = $1::uuid
             ORDER BY cdr_started_at ASC`,
            callHistoryId,
        );

        return segments.map((seg) => {
            const startedAt = seg.cdr_started_at ? new Date(seg.cdr_started_at) : null;
            const endedAt = seg.cdr_ended_at ? new Date(seg.cdr_ended_at) : null;
            const answeredAt = seg.cdr_answered_at ? new Date(seg.cdr_answered_at) : null;
            const durationSeconds = startedAt && endedAt
                ? Math.round((endedAt.getTime() - startedAt.getTime()) / 1000 * 10) / 10
                : 0;

            const category = determineSegmentCategory({
                terminationReason: seg.termination_reason,
                terminationReasonDetails: seg.termination_reason_details,
                creationMethod: seg.creation_method,
                creationForwardReason: seg.creation_forward_reason,
                destinationType: seg.destination_dn_type,
                destinationEntityType: seg.destination_entity_type,
                sourceType: seg.source_dn_type,
                durationSeconds,
                wasAnswered: !!answeredAt,
            });

            return {
                id: seg.cdr_id,
                startedAt: seg.cdr_started_at?.toISOString() || "",
                answeredAt: answeredAt?.toISOString() || null,
                sourceNumber: maybeMask(
                    getDisplayNumber(seg.source_dn_number, seg.source_participant_phone_number, seg.source_presentation),
                    scope.maskPhoneNumbers,
                ),
                sourceName: seg.source_dn_type?.toLowerCase() === 'provider'
                    ? (seg.source_participant_name && !seg.source_participant_name.trim().endsWith(':')
                        ? getDisplayName(seg.source_participant_name, null)
                        : "")
                    : getDisplayName(seg.source_participant_name, seg.source_dn_name),
                sourceType: seg.source_dn_type || "-",
                destinationNumber: maybeMask(
                    getDisplayNumber(seg.destination_dn_number, seg.destination_participant_phone_number, null),
                    scope.maskPhoneNumbers,
                ),
                destinationName: seg.source_dn_type?.toLowerCase() === 'provider'
                    ? (getDisplayName(seg.destination_participant_name, seg.destination_dn_name)
                        || (seg.source_participant_name?.trim().endsWith(':') ? getDisplayName(seg.source_participant_name, null) : ""))
                    : getDisplayName(seg.destination_participant_name, seg.destination_dn_name),
                destinationType: seg.destination_dn_type || "-",
                status: determineSegmentStatus({
                    answeredAt: seg.cdr_answered_at,
                    startedAt: seg.cdr_started_at,
                    endedAt: seg.cdr_ended_at,
                    destType: seg.destination_dn_type,
                    destEntityType: seg.destination_entity_type,
                    terminationReasonDetails: seg.termination_reason_details,
                }),
                durationSeconds,
                durationFormatted: formatDuration(Math.round(durationSeconds)),
                terminationReason: seg.termination_reason || "-",
                terminationReasonDetails: seg.termination_reason_details || "",
                creationMethod: seg.creation_method || "-",
                creationForwardReason: seg.creation_forward_reason || "",
                originatingCdrId: seg.originating_cdr_id || null,
                category,
                legCallHistoryId: seg.leg_call_history_id || null,
                // Une jambe fusionnée est un segment dont l'identifiant de
                // jambe diffère de l'appel affiché — impossible au grain « jambe ».
                isMergedLeg: merged
                    && !!seg.leg_call_history_id
                    && seg.leg_call_history_id !== callHistoryId,
            };
        });
    } catch (error) {
        console.error("❌ Error fetching call chain:", error);
        return [];
    }
}

// ============================================
// CSV EXPORT
// ============================================

async function exportAllCallLogs(
    serverId: ServerId,
    startDate: Date,
    endDate: Date,
    filters: LogsFilters,
): Promise<AggregatedCallLogsResponse> {
    const PAGE_SIZE = 100;
    const allLogs: AggregatedCallLog[] = [];
    let page = 1;
    let totalPages = 1;

    while (page <= totalPages) {
        const response = await getAggregatedCallLogs(serverId, startDate, endDate, filters, { page, pageSize: PAGE_SIZE });
        allLogs.push(...response.logs);
        totalPages = response.totalPages;
        page++;
    }

    return { logs: allLogs, totalCount: allLogs.length, totalPages: 1, currentPage: 1 };
}

export async function exportCallLogsCSV(
    serverId: ServerId,
    startDate: Date,
    endDate: Date,
    filters: LogsFilters,
    idsOnly: boolean = false
): Promise<string> {
    const response = await exportAllCallLogs(serverId, startDate, endDate, filters);

    if (idsOnly) {
        return ["call_history_id", ...response.logs.map((log) => log.callHistoryId)].join("\n");
    }

    const headers = ["ID", "Date/Heure", "Appelant", "Nom Appelant", "Appelé", "Nom Appelé", "Provenance", "Sens", "Pont", "Statut", "Durée Totale", "Temps Attente", "Segments", "Transféré"];
    const rows = response.logs.map((log) => [
        log.callHistoryIdShort,
        log.startedAt,
        log.callerNumber,
        log.callerName || "",
        log.calleeNumber,
        log.calleeName || "",
        log.provenance,
        log.sens,
        log.viaBridge ? "oui" : "",
        log.finalStatus,
        log.totalDurationFormatted,
        log.waitTimeFormatted,
        log.segmentCount,
        log.wasTransferred ? "Oui" : "Non",
    ]);

    return [
        headers.join(";"),
        ...rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(";")),
    ].join("\n");
}

// ============================================
// EXTENSION STATISTICS — Aggregated stats for a single extension
// Reuses the same CTEs and filters as the logs page to ensure
// numbers match exactly what users see in the call logs.
// ============================================

export interface ExtensionAggregatedStats {
    totalCount: number;
    inboundCount: number;
    outboundCount: number;
    answeredCount: number;
    missedCount: number;
    voicemailCount: number;
    busyCount: number;
    totalDurationSeconds: number;
    avgDurationSeconds: number;
    maxDurationSeconds: number;
}

/**
 * Returns aggregated statistics for calls matching the given filters.
 * This function reuses the exact same CTEs and filter logic as getAggregatedCallLogs()
 * to ensure consistency with the call logs page.
 *
 * Used by extension-statistics.service.ts to compute per-extension stats.
 */
export async function getExtensionAggregatedStats(
    serverId: ServerId,
    startDate: Date,
    endDate: Date,
    filters: LogsFilters
): Promise<ExtensionAggregatedStats> {
    const prisma = getPrismaCdr(serverId);

    const scope = await resolveAccessScope(serverId);
    const rules = await getClassificationRules();
    const { whereClause, dateOnlyWhereClause, aggregatedWhereConditions, calleeFilterCTE, calleeFilterJoin, params } =
        buildAggregatedQueryParts(startDate, endDate, filters, { page: 1, pageSize: 1 }, undefined, undefined, scope, rules);

    const ctes = buildAggregateCTEs(whereClause, dateOnlyWhereClause, calleeFilterCTE, "", cdrTable(rules), rules.minSignificantDurationSeconds);

    const statsQuery = `${ctes}
        SELECT
            COUNT(*) as total_count,
            COUNT(*) FILTER (WHERE fs.source_dn_type = 'provider' OR (fs.source_dn_type != 'extension' AND fs.source_dn_type != 'bridge')) as inbound_count,
            COUNT(*) FILTER (WHERE fs.source_dn_type = 'extension') as outbound_count,
            COUNT(*) FILTER (WHERE
                COALESCE(ls.last_dest_entity_type, '') NOT IN ('voicemail')
                AND COALESCE(ls.termination_reason_details, '') NOT ILIKE '%busy%'
                AND COALESCE(ls.last_dest_type, '') NOT IN ('vmail_console', 'voicemail')
                AND lhs.last_human_answered_at IS NOT NULL
                AND EXTRACT(EPOCH FROM (lhs.last_human_ended_at - lhs.last_human_started_at)) > 1
            ) as answered_count,
            COUNT(*) FILTER (WHERE
                COALESCE(ls.termination_reason_details, '') NOT ILIKE '%busy%'
                AND COALESCE(ls.last_dest_type, '') NOT IN ('vmail_console', 'voicemail')
                AND COALESCE(ls.last_dest_entity_type, '') != 'voicemail'
                AND (
                    lhs.last_human_answered_at IS NULL
                    OR EXTRACT(EPOCH FROM (lhs.last_human_ended_at - lhs.last_human_started_at)) <= 1
                )
            ) as missed_count,
            COUNT(*) FILTER (WHERE
                ls.last_dest_type IN ('vmail_console', 'voicemail')
                OR ls.last_dest_entity_type = 'voicemail'
            ) as voicemail_count,
            COUNT(*) FILTER (WHERE ls.termination_reason_details ILIKE '%busy%') as busy_count,
            COALESCE(SUM(EXTRACT(EPOCH FROM (ls.last_ended_at - ca.first_started_at))), 0) as total_duration_seconds,
            COALESCE(AVG(EXTRACT(EPOCH FROM (ls.last_ended_at - ca.first_started_at))), 0) as avg_duration_seconds,
            COALESCE(MAX(EXTRACT(EPOCH FROM (ls.last_ended_at - ca.first_started_at))), 0) as max_duration_seconds
        FROM call_aggregates ca
        JOIN first_segments fs ON ca.call_history_id = fs.call_history_id
        JOIN last_segments ls ON ca.call_history_id = ls.call_history_id
        LEFT JOIN last_human_segments lhs ON ca.call_history_id = lhs.call_history_id
        LEFT JOIN answered_segments ans ON ca.call_history_id = ans.call_history_id
        ${calleeFilterJoin}
        ${aggregatedWhereConditions.length > 0 ? 'WHERE ' + aggregatedWhereConditions.join(' AND ') : ''}
    `;

    const result = await prisma.$queryRawUnsafe(statsQuery, ...params);
    const row = (result as any[])[0];

    return {
        totalCount: Number(row.total_count || 0),
        inboundCount: Number(row.inbound_count || 0),
        outboundCount: Number(row.outbound_count || 0),
        answeredCount: Number(row.answered_count || 0),
        missedCount: Number(row.missed_count || 0),
        voicemailCount: Number(row.voicemail_count || 0),
        busyCount: Number(row.busy_count || 0),
        totalDurationSeconds: Math.round(Number(row.total_duration_seconds || 0)),
        avgDurationSeconds: Math.round(Number(row.avg_duration_seconds || 0)),
        maxDurationSeconds: Math.round(Number(row.max_duration_seconds || 0)),
    };
}
