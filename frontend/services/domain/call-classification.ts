import { buildDirectSegmentWhereClause } from "./call-aggregation";

/**
 * Socle de classement des appels — SOURCE UNIQUE DE VÉRITÉ.
 *
 * Ce module répond à un défaut structurel de l'application : les KPIs de file
 * et le filtre de parcours des logs implémentaient chacun leur propre SQL pour
 * les mêmes notions (« répondu », « perdu », « redirigé »). Les deux comptages
 * divergeaient donc dès que l'appel se compliquait — mesuré en juin 2026 sur la
 * file 900 : 228 perdus côté KPI contre 250 côté logs, pour un total identique.
 *
 * Le remède n'est pas de réaligner deux requêtes (elles rederiveraient), mais de
 * n'en avoir plus qu'une. On modélise explicitement trois grains :
 *
 *   1. SEGMENT   — une ligne CDR (affichage du parcours)
 *   2. PASSAGE   — un couple (appel × file), avec un `statut_dans_la_file`
 *   3. APPEL     — un `call_history_id`, avec son `statut_final`
 *
 * Les KPIs agrègent la couche PASSAGE ; le clic sur un KPI filtre sur LA MÊME
 * couche. L'égalité entre le chiffre affiché et le nombre de lignes de logs
 * devient vraie par construction, et non plus par vigilance.
 *
 * Les fonctions d'ici sont pures : elles produisent du SQL, n'accèdent pas à la
 * base, et sont donc testables unitairement (cf. call-classification.test.ts).
 */

// ============================================
// RÈGLES MÉTIER
// ============================================

/**
 * Sort d'un appel vis-à-vis d'UNE file donnée.
 *
 * Ces catégories sont mutuellement exclusives : un appel tombe dans une et une
 * seule d'entre elles pour une file donnée. C'est ce qui garantit que
 * `répondus + redirigés + messagerie + perdus + abandons courts = total`.
 */
export type PassageOutcome =
    | "answered"        // un agent de la file a décroché
    | "overflow"        // l'appel est reparti vers une autre file
    | "voicemail"       // l'appel s'est terminé sur la messagerie
    | "short_abandon"   // raccroché avant le seuil (hésitation, erreur de numéro)
    | "abandoned";      // abandon caractérisé

/**
 * Ordre de préséance quand un appel repasse plusieurs fois dans la même file et
 * que la règle `multiPassage` vaut "best". Le plus petit rang l'emporte.
 *
 * « Répondu » prime sur tout : si la file a fini par traiter l'appel, c'est le
 * fait marquant. « Abandon court » est le rang le plus faible : c'est le sort
 * le moins engageant pour la file.
 */
export const OUTCOME_RANK: Record<PassageOutcome, number> = {
    answered: 1,
    overflow: 2,
    voicemail: 3,
    abandoned: 4,
    short_abandon: 5,
};

export interface ClassificationRules {
    /**
     * Appel repassant plusieurs fois dans la MÊME file.
     * - "best" : le meilleur résultat l'emporte (cf. OUTCOME_RANK)
     * - "last" : le sort du dernier passage fait foi
     * - "each" : chaque passage compte séparément (le total devient le nombre
     *            de passages, pas d'appels)
     */
    multiPassage: "best" | "last" | "each";

    /**
     * Appel non pris qui déborde vers une autre file et y est répondu.
     * - "neutral"  : catégorie « redirigé », ni répondu ni perdu
     * - "lost"     : compté comme perdu pour la file d'origine
     * - "answered" : compté comme répondu (vue entreprise)
     */
    overflow: "neutral" | "lost" | "answered";

    /**
     * Seuil (secondes) en dessous duquel un abandon est jugé non significatif.
     * `null` désactive la règle : tout abandon est un abandon.
     */
    shortAbandonThresholdSeconds: number | null;

    /**
     * Appel à la fois direct et passé en file, dans le bilan d'équipe.
     * - "firstContact" : classé selon la façon dont il est ENTRÉ dans l'équipe
     * - "queueWins"    : la file prime toujours
     * - "both"         : compté dans les deux blocs (le total dépasse alors le
     *                    nombre d'appels et ne peut pas matcher les logs)
     */
    directAndQueue: "firstContact" | "queueWins" | "both";

    /**
     * Appel terminé sur la messagerie.
     * - "separate" : catégorie à part
     * - "lost"     : compté comme perdu
     * - "answered" : compté comme répondu
     */
    voicemail: "separate" | "lost" | "answered";

    /**
     * Statut final affiché à un utilisateur dont le périmètre ne couvre pas la
     * file ayant finalement traité l'appel.
     * - "name"      : nommer la file (« Répondu par 910 – Neuchâtel »)
     * - "anonymize" : « Répondu (hors périmètre) »
     * - "hide"      : ne pas afficher le statut final
     */
    outOfScopeFinalStatus: "name" | "anonymize" | "hide";
}

/**
 * Valeurs par défaut arbitrées avec le métier (juillet 2026).
 *
 * ⚠️ Ces règles sont appliquées AU CALCUL, pas au stockage : modifier un
 * réglage change rétroactivement les chiffres des périodes passées. L'écran de
 * réglages doit le dire explicitement.
 */
export const DEFAULT_CLASSIFICATION_RULES: ClassificationRules = {
    multiPassage: "best",
    overflow: "neutral",
    shortAbandonThresholdSeconds: 10,
    directAndQueue: "firstContact",
    voicemail: "separate",
    outOfScopeFinalStatus: "name",
};

// ============================================
// CLASSEMENT (logique pure, testable)
// ============================================

/** Faits observés sur un passage en file, indépendamment des règles. */
export interface PassageFacts {
    answeredHere: boolean;
    overflowed: boolean;
    toVoicemail: boolean;
    waitSeconds: number | null;
}

/**
 * Applique les règles à un passage pour en déduire son statut dans la file.
 *
 * L'ordre des tests EST la sémantique métier :
 *   répondu > débordement > messagerie > abandon (court ou non).
 *
 * Le débordement passe avant la messagerie parce qu'il décrit la façon dont
 * l'appel a quitté CETTE file ; une messagerie survenue après coup relève de la
 * file suivante.
 */
export function classifyPassage(facts: PassageFacts, rules: ClassificationRules): PassageOutcome {
    if (facts.answeredHere) return "answered";

    if (facts.overflowed) {
        if (rules.overflow === "answered") return "answered";
        if (rules.overflow === "lost") return "abandoned";
        return "overflow";
    }

    if (facts.toVoicemail) {
        if (rules.voicemail === "answered") return "answered";
        if (rules.voicemail === "lost") return "abandoned";
        return "voicemail";
    }

    const threshold = rules.shortAbandonThresholdSeconds;
    if (threshold !== null && facts.waitSeconds !== null && facts.waitSeconds < threshold) {
        return "short_abandon";
    }

    return "abandoned";
}

/**
 * Réduit les passages d'un même appel dans une même file à un statut unique,
 * selon la règle `multiPassage`. En mode "each", l'appelant ne doit pas réduire
 * (chaque passage reste une ligne) : la fonction renvoie alors le premier.
 */
export function reducePassages(
    outcomes: PassageOutcome[],
    rules: ClassificationRules,
): PassageOutcome {
    if (outcomes.length === 0) throw new Error("reducePassages : aucun passage");
    if (rules.multiPassage === "last") return outcomes[outcomes.length - 1];
    if (rules.multiPassage === "each") return outcomes[0];
    return outcomes.reduce((a, b) => (OUTCOME_RANK[b] < OUTCOME_RANK[a] ? b : a));
}

// ============================================
// PRODUCTION DE SQL
// ============================================

/** Traduit un statut en son rang SQL, pour l'agrégation "best". */
function sqlOutcomeRankCase(column: string): string {
    const branches = (Object.keys(OUTCOME_RANK) as PassageOutcome[])
        .map((o) => `WHEN '${o}' THEN ${OUTCOME_RANK[o]}`)
        .join(" ");
    return `CASE ${column} ${branches} ELSE 99 END`;
}

/** Réciproque : d'un rang vers le statut. */
function sqlRankToOutcomeCase(column: string): string {
    const branches = (Object.keys(OUTCOME_RANK) as PassageOutcome[])
        .map((o) => `WHEN ${OUTCOME_RANK[o]} THEN '${o}'`)
        .join(" ");
    return `CASE ${column} ${branches} ELSE 'abandoned' END`;
}

/**
 * Expression SQL de classement d'un passage, image fidèle de `classifyPassage`.
 * Les deux DOIVENT rester synchronisées — le test unitaire compare leurs
 * tables de vérité sur l'ensemble des combinaisons.
 */
export function buildPassageOutcomeSQL(rules: ClassificationRules): string {
    const overflowResult =
        rules.overflow === "answered" ? "'answered'" : rules.overflow === "lost" ? "'abandoned'" : "'overflow'";
    const voicemailResult =
        rules.voicemail === "answered" ? "'answered'" : rules.voicemail === "lost" ? "'abandoned'" : "'voicemail'";

    const shortAbandonBranch =
        rules.shortAbandonThresholdSeconds !== null
            ? `WHEN wait_seconds IS NOT NULL AND wait_seconds < ${rules.shortAbandonThresholdSeconds} THEN 'short_abandon'`
            : "";

    return `CASE
        WHEN answered_here THEN 'answered'
        WHEN overflowed    THEN ${overflowResult}
        WHEN to_voicemail  THEN ${voicemailResult}
        ${shortAbandonBranch}
        ELSE 'abandoned'
    END`;
}

export interface PassageCTEParams {
    /** Placeholder ou littéral SQL désignant la file ; `null` = toutes les files. */
    queueExpr: string | null;
    startExpr: string;
    endExpr: string;
}

/**
 * COUCHE 2 — un enregistrement par passage en file, avec son statut.
 *
 * Produit deux CTE : `queue_passage_facts` (les faits bruts) puis
 * `queue_passages` (les faits + le statut résultant des règles). La séparation
 * permet de rejouer les mêmes faits sous d'autres règles sans retoucher le SQL.
 */
export function buildQueuePassagesCTE(rules: ClassificationRules, params: PassageCTEParams): string {
    const queueFilter = params.queueExpr ? `AND c.destination_dn_number = ${params.queueExpr}` : "";

    return `
    queue_passage_facts AS (
        SELECT
            c.call_history_id,
            c.cdr_id,
            c.destination_dn_number AS queue_number,
            c.cdr_started_at,
            c.cdr_ended_at,
            -- Répondu ici : un appel « polling » issu de ce passage a été
            -- décroché par une extension (et non par un automate). Le LATERAL
            -- ramène dans la même passe les temps d'attente et de conversation,
            -- au lieu de trois sous-requêtes corrélées sur la même ligne.
            COALESCE(poll.answered_here, FALSE) AS answered_here,
            poll.talk_seconds,
            poll.answer_wait_seconds,
            -- Débordement : une AUTRE file est sollicitée plus tard dans l'appel.
            EXISTS (
                SELECT 1 FROM cdroutput o
                WHERE o.call_history_id = c.call_history_id
                  AND o.destination_dn_type = 'queue'
                  AND o.destination_dn_number <> c.destination_dn_number
                  AND o.cdr_started_at > c.cdr_started_at
            ) AS overflowed,
            -- Messagerie postérieure au passage. Pas besoin d'exclure les
            -- messageries d'une file suivante : le débordement est évalué avant
            -- dans buildPassageOutcomeSQL et l'emporte.
            EXISTS (
                SELECT 1 FROM cdroutput v
                WHERE v.call_history_id = c.call_history_id
                  AND COALESCE(v.destination_entity_type, '') = 'voicemail'
                  AND v.cdr_started_at >= c.cdr_started_at
            ) AS to_voicemail,
            -- Temps réellement passé DANS la file. L'ancien calcul mesurait le
            -- délai entre le début de l'appel et l'entrée en file, ce qui n'est
            -- pas une attente.
            EXTRACT(EPOCH FROM (c.cdr_ended_at - c.cdr_started_at)) AS wait_seconds
        FROM cdroutput c
        LEFT JOIN LATERAL (
            SELECT
                bool_or(p.cdr_answered_at IS NOT NULL) AS answered_here,
                MAX(EXTRACT(EPOCH FROM (p.cdr_ended_at - p.cdr_answered_at)))
                    FILTER (WHERE p.cdr_answered_at IS NOT NULL) AS talk_seconds,
                MIN(EXTRACT(EPOCH FROM (p.cdr_answered_at - c.cdr_started_at)))
                    FILTER (WHERE p.cdr_answered_at IS NOT NULL) AS answer_wait_seconds
            FROM cdroutput p
            WHERE p.originating_cdr_id = c.cdr_id
              AND p.creation_forward_reason = 'polling'
              AND p.destination_dn_type = 'extension'
        ) poll ON TRUE
        WHERE c.destination_dn_type = 'queue'
          ${queueFilter}
          AND c.cdr_started_at >= ${params.startExpr}
          AND c.cdr_started_at <= ${params.endExpr}
    ),
    queue_passages AS (
        SELECT f.*, ${buildPassageOutcomeSQL(rules)} AS outcome
        FROM queue_passage_facts f
    )`;
}

/**
 * COUCHE 2 bis — un enregistrement par (appel × file), statut unique.
 *
 * C'est LA table que consomment à la fois les KPIs et le filtre du clic.
 * En mode `each`, aucune réduction n'est faite : chaque passage reste une ligne.
 */
export function buildCallQueueOutcomesCTE(rules: ClassificationRules): string {
    if (rules.multiPassage === "each") {
        return `
    call_queue_outcomes AS (
        SELECT call_history_id, queue_number, outcome, cdr_started_at, cdr_ended_at,
            wait_seconds, talk_seconds, answer_wait_seconds
        FROM queue_passages
    )`;
    }

    if (rules.multiPassage === "last") {
        return `
    call_queue_outcomes AS (
        SELECT DISTINCT ON (call_history_id, queue_number)
            call_history_id, queue_number, outcome, cdr_started_at, cdr_ended_at,
            wait_seconds, talk_seconds, answer_wait_seconds
        FROM queue_passages
        ORDER BY call_history_id, queue_number, cdr_started_at DESC
    )`;
    }

    // "best" : le statut de meilleur rang, et les temps du passage correspondant.
    return `
    call_queue_outcomes AS (
        SELECT DISTINCT ON (call_history_id, queue_number)
            call_history_id, queue_number, outcome, cdr_started_at, cdr_ended_at,
            wait_seconds, talk_seconds, answer_wait_seconds
        FROM queue_passages
        ORDER BY call_history_id, queue_number, ${sqlOutcomeRankCase("outcome")} ASC, cdr_started_at ASC
    )`;
}

/**
 * Arbitrage direct / file pour le bilan d'équipe (règle `directAndQueue`).
 *
 * Renvoie la condition SQL excluant, du bloc « appels directs », les appels qui
 * doivent être comptés dans le bloc « file ». Sans cet arbitrage un appel passé
 * par les deux serait compté deux fois dans le KPI mais une seule fois dans les
 * logs — impossible à faire matcher.
 *
 * @param alias        alias de la table des segments directs
 * @param passagesCTE  nom du CTE listant les passages en file
 */
export function buildDirectExclusionSQL(
    rules: ClassificationRules,
    alias: string,
    passagesCTE: string = "queue_passages",
): string {
    if (rules.directAndQueue === "both") return "TRUE";

    if (rules.directAndQueue === "queueWins") {
        return `NOT EXISTS (SELECT 1 FROM ${passagesCTE} qp WHERE qp.call_history_id = ${alias}.call_history_id)`;
    }

    // "firstContact" : l'appel reste dans le bloc « direct » si son premier
    // contact avec l'équipe est ce segment direct, c'est-à-dire s'il précède
    // tout passage en file.
    return `NOT EXISTS (
        SELECT 1 FROM ${passagesCTE} qp
        WHERE qp.call_history_id = ${alias}.call_history_id
          AND qp.cdr_started_at <= ${alias}.cdr_started_at
    )`;
}

/**
 * Symétrique du précédent : condition excluant du bloc « file » les appels qui
 * reviennent au bloc « direct ». Nécessaire pour que les deux blocs forment
 * une partition exacte.
 *
 * @param callIdExpr    expression donnant le call_history_id côté file
 * @param queueStartExpr expression donnant l'instant du passage en file
 * @param directCTE     nom du CTE listant les segments directs de l'équipe
 */
export function buildQueueExclusionSQL(
    rules: ClassificationRules,
    callIdExpr: string,
    queueStartExpr: string,
    directCTE: string = "team_direct_segments",
): string {
    if (rules.directAndQueue !== "firstContact") return "TRUE";

    return `NOT EXISTS (
        SELECT 1 FROM ${directCTE} d
        WHERE d.call_history_id = ${callIdExpr}
          AND d.cdr_started_at < ${queueStartExpr}
    )`;
}

/**
 * CTE des appels attribués au bloc « directs » de l'équipe, avec leur sort.
 *
 * Subtilité qui vaut d'être explicitée : le BLOC dit par quel canal l'appel est
 * entré dans l'équipe ; il ne dit pas si l'équipe a servi le client. Un appel
 * arrivé en direct chez un agent absent, puis traité par la file, est un appel
 * « direct » ET « répondu ». Sans ce OR, il serait compté direct-non-répondu et
 * le total des répondus baisserait artificiellement (15 appels sur la file 900
 * en juin 2026, mesuré avec scripts/compare-kpis.ts).
 */
export function buildDirectCallsCTE(
    rules: ClassificationRules,
    directCTE: string = "team_direct_segments",
    outcomesCTE: string = "call_queue_outcomes",
): string {
    return `
    direct_calls AS (
        SELECT
            d.call_history_id,
            bool_or(d.cdr_answered_at IS NOT NULL)
                OR EXISTS (
                    SELECT 1 FROM ${outcomesCTE} q
                    WHERE q.call_history_id = d.call_history_id
                      AND q.outcome = 'answered'
                ) AS answered
        FROM ${directCTE} d
        WHERE ${buildDirectExclusionSQL(rules, "d")}
        GROUP BY d.call_history_id
    )`;
}

/**
 * Chaîne complète de CTE du « bilan d'équipe » d'une file : passages, statuts
 * par appel, agents de la file, segments directs, puis la partition
 * `queue_calls` / `direct_calls`.
 *
 * UN SEUL endroit produit ce SQL, et il est consommé aussi bien par la route
 * des KPIs que par le filtre des logs. C'est la garantie mécanique que les deux
 * portent sur la même population : elles n'exécutent pas deux requêtes qui se
 * ressemblent, elles exécutent la même.
 *
 * À insérer derrière un `WITH`.
 */
export function buildTeamCTEChain(rules: ClassificationRules, params: PassageCTEParams): string {
    if (!params.queueExpr) throw new Error("buildTeamCTEChain : une file doit être précisée");

    return `
    ${buildQueuePassagesCTE(rules, params)},
    ${buildCallQueueOutcomesCTE(rules)},
    queue_agents AS (
        SELECT DISTINCT child.destination_dn_number AS extension
        FROM cdroutput child
        JOIN cdroutput parent ON child.originating_cdr_id = parent.cdr_id
        WHERE child.creation_method = 'route_to'
          AND child.creation_forward_reason = 'polling'
          AND parent.destination_dn_type = 'queue'
          AND parent.destination_dn_number = ${params.queueExpr}
          AND child.cdr_started_at >= ${params.startExpr}
          AND child.cdr_started_at <= ${params.endExpr}
    ),
    team_direct_segments AS (
        SELECT c.call_history_id, c.cdr_started_at, c.cdr_answered_at
        FROM cdroutput c
        WHERE ${buildDirectSegmentWhereClause("c")}
          AND c.destination_dn_number IN (SELECT extension FROM queue_agents)
          AND c.cdr_started_at >= ${params.startExpr}
          AND c.cdr_started_at <= ${params.endExpr}
    ),
    queue_calls AS (
        SELECT cqo.*
        FROM call_queue_outcomes cqo
        WHERE ${buildQueueExclusionSQL(rules, "cqo.call_history_id", "cqo.cdr_started_at")}
    ),
    ${buildDirectCallsCTE(rules)}`;
}

/**
 * Sous-requête listant les appels dont le statut DANS UNE FILE donnée figure
 * parmi ceux demandés.
 *
 * C'est la pièce qui rend le clic sur un KPI exact : la liste des logs est
 * filtrée par LA MÊME couche `call_queue_outcomes` que celle agrégée par le
 * KPI. Le nombre de lignes affichées ne peut donc plus différer du chiffre
 * annoncé — auparavant les logs testaient `EXISTS(un segment de résultat X)`,
 * un critère non exclusif qui laissait un appel satisfaire plusieurs KPIs.
 *
 * Renvoie une sous-requête parenthésée, utilisable derrière `IN`.
 */
export function buildQueueOutcomeSubquery(
    rules: ClassificationRules,
    params: PassageCTEParams & { outcomes: PassageOutcome[]; includeTeamDirect?: boolean },
): string {
    const list = params.outcomes.map((o) => `'${o}'`).join(", ");

    // Les cartes du bilan d'équipe additionnent file ET appels directs ; le
    // filtre doit donc couvrir la même union, sans quoi le clic sur « Total
    // reçus » ne ramènerait que la part « file ».
    // Côté directs, seuls deux sorts existent : répondu, ou perdu.
    const directMapped: string[] = [];
    if (params.includeTeamDirect) {
        if (params.outcomes.includes("answered")) directMapped.push("answered");
        if (params.outcomes.includes("abandoned")) directMapped.push("NOT answered");
    }

    const directUnion = directMapped.length > 0
        ? `
        UNION
        SELECT call_history_id FROM direct_calls
        WHERE ${directMapped.join(" OR ")}`
        : "";

    return `(
        WITH ${buildTeamCTEChain(rules, params)}
        SELECT call_history_id FROM queue_calls
        WHERE outcome IN (${list})${directUnion}
    )`;
}

/** Expression SQL de comptage d'un statut donné, pour les KPIs. */
export function sqlCountOutcome(outcome: PassageOutcome, alias = "cqo"): string {
    return `COUNT(*) FILTER (WHERE ${alias}.outcome = '${outcome}')`;
}

export { sqlOutcomeRankCase, sqlRankToOutcomeCase };
