import { buildDirectSegmentWhereClause, SQL_REAL_PARTY_DEST_TYPES } from "./call-aggregation";

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
 * `répondus + transférés + débordés + messagerie + perdus + abandons courts = total`.
 */
export type PassageOutcome =
    | "answered"        // un agent de la file a décroché
    | "handed_off"      // décroché ICI puis servi ailleurs : le transfert accompli
    | "overflow"        // reparti vers une autre file SANS avoir été décroché ici
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
    // Le transfert accompli vaut presque une réponse : l'équipe a décroché et
    // le client a fini servi. Il prime donc sur le simple débordement.
    handed_off: 2,
    overflow: 3,
    voicemail: 4,
    abandoned: 5,
    short_abandon: 6,
};

/**
 * Vignette d'affichage du bilan d'équipe.
 *
 * L'écran reste volontairement à quatre chiffres : c'est le langage commun des
 * managers, et multiplier les catégories déplace la complexité du calcul vers
 * la lecture. Le détail fin ne disparaît pas pour autant — il pilote le filtre
 * du clic, et se lit donc dans les logs quand un chiffre surprend.
 */
export type KpiBucket = "received" | "answered" | "lost" | "overflow";

/**
 * Quels statuts fins alimentent quelle vignette.
 *
 * Une seule table fait foi : elle sert à la fois à additionner les compteurs et
 * à construire le lien vers les logs. Les deux ne peuvent donc pas diverger,
 * même si le regroupement change.
 */
export const DEFAULT_OUTCOME_GROUPING: Record<PassageOutcome, Exclude<KpiBucket, "received">> = {
    answered: "answered",
    // Le transfert accompli s'affiche dans « Répondus » (décision août 2026) :
    // l'équipe a décroché et le client a fini servi — c'est du travail fait,
    // pas de la fuite. La vignette orange (« Débordements ») ne contient plus
    // que les appels partis SANS décroché ici. Revers assumé : un appel
    // transféré est « répondu » chez l'équipe qui a décroché ET chez celle qui
    // a servi en dernier — la somme des répondus par équipe n'est plus
    // additive (l'écran, lui, déduplique par préséance).
    handed_off: "answered",
    overflow: "overflow",
    voicemail: "lost",
    short_abandon: "lost",
    abandoned: "lost",
};

/** Statuts fins agrégés par une vignette donnée. */
export function outcomesForBucket(
    bucket: KpiBucket,
    grouping: Record<PassageOutcome, Exclude<KpiBucket, "received">> = DEFAULT_OUTCOME_GROUPING,
): PassageOutcome[] {
    const all = Object.keys(grouping) as PassageOutcome[];
    if (bucket === "received") return all;
    return all.filter((o) => grouping[o] === bucket);
}

/** Somme des compteurs fins pour une vignette. */
export function sumBucket(
    counts: Partial<Record<PassageOutcome, number>>,
    bucket: KpiBucket,
    grouping: Record<PassageOutcome, Exclude<KpiBucket, "received">> = DEFAULT_OUTCOME_GROUPING,
): number {
    return outcomesForBucket(bucket, grouping).reduce((total, o) => total + (counts[o] ?? 0), 0);
}

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
     * - "neutral"  : catégorie « débordé », ni répondu ni perdu
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
     * - "excluded" : pas compté du tout — l'appel sort des « reçus », comme
     *                dans les rapports Excel historiques des managers
     */
    voicemail: "separate" | "lost" | "answered" | "excluded";

    /**
     * Statut final affiché à un utilisateur dont le périmètre ne couvre pas la
     * file ayant finalement traité l'appel.
     * - "name"      : nommer la file (« Répondu par 910 – Neuchâtel »)
     * - "anonymize" : « Répondu (hors périmètre) »
     * - "hide"      : ne pas afficher le statut final
     */
    outOfScopeFinalStatus: "name" | "anonymize" | "hide";

    /**
     * Durée minimale (secondes) d'une conversation pour qu'un décroché compte
     * comme une réponse, du point de vue de l'ENTREPRISE (statut final).
     *
     * Écarte les décrochés-raccrochés immédiats et les transferts ratés. Cette
     * règle vivait en dur dans le code : elle décidait du sort de tous les
     * appels sans que personne ne puisse la constater.
     */
    minAnswerSeconds: number;

    /**
     * Unité de comptage : qu'est-ce qu'« un appel » ?
     *
     * 3CX crée un call_history_id DISTINCT pour chaque jambe de transfert
     * (consultation, renvoi), relié à l'appel d'origine par
     * main_call_history_id. Un client transféré une fois devient donc deux
     * « appels » au grain technique — et il était compté deux fois (mesuré :
     * 111 appels sur la file 901 en juin 2026, ~2 % à l'échelle entreprise).
     *
     * - "leg"    : chaque call_history_id compte (comportement historique)
     * - "merged" : les jambes sont fusionnées dans l'appel principal — le
     *              grain des rapports 3CX et de l'Excel des managers
     */
    callGrain: "leg" | "merged";

    /**
     * Appel RÉPONDU par le groupe puis reparti hors du groupe (transfert vers
     * une autre équipe ou un numéro externe), et effectivement décroché là-bas.
     *
     * Le critère est le DERNIER décroché humain de l'appel : s'il est hors des
     * agents du groupe, le client a finalement été servi ailleurs. Un transfert
     * qui échoue (personne ne décroche ailleurs, ou l'agent reprend l'appel)
     * laisse le groupe dernier serveur → l'appel reste Répondu.
     *
     * - "overflow" : l'appel devient « Transféré » (statut handed_off — depuis
     *                août 2026 affiché dans la vignette Répondus, sous-ligne
     *                « Transférés ») ; le statut fin reste distinct, ce qui
     *                garde le transfert visible (colonne du tableau, logs)
     * - "answered" : compté Répondu tout court — le statut fin « Transféré »
     *                disparaît, le groupe est jugé sur son décroché
     */
    answeredThenTransferred: "overflow" | "answered";

    /**
     * Durée minimale (secondes) d'une sollicitation directe NON RÉPONDUE pour
     * qu'elle compte comme une vraie tentative. En dessous, c'est un artefact
     * de routage (renvoi actif, rebond système) : le segment n'entre pas dans
     * les statistiques. Décide de la PRÉSENCE, jamais du statut.
     *
     * Longtemps un « réglage fantôme » : enregistré et affiché, mais jamais lu
     * par les requêtes, qui utilisaient la constante à 1 s. Il vit désormais
     * ici, dans l'objet de règles chargé par toutes les requêtes.
     */
    minSignificantDurationSeconds: number;

    /**
     * Sort des abandons très courts (sous le seuil shortAbandonThresholdSeconds).
     * - "lost"     : comptés reçus, rangés dans Perdus (comportement historique)
     * - "excluded" : pas comptés du tout — l'appel sort des « reçus », comme
     *                la messagerie sous voicemail: "excluded"
     */
    shortAbandonDisposition: "lost" | "excluded";

    /**
     * Sur quelle durée le seuil d'abandon court est-il jugé ?
     *
     * - "passage" : le seul passage en file (comportement historique). Angle
     *   mort : l'appelant qui a déjà sonné ~30 s sur la ligne directe d'un
     *   agent puis raccroche en 2 s de file est traité comme un fantôme — le
     *   motif DOMINANT des abandons courts (mesuré : ~45 % en juillet 2026).
     * - "team" : toute la sollicitation de l'équipe — cumul des passages dans
     *   SA file et des sonneries directes significatives sur SES agents.
     *   Chaque équipe a sa propre horloge : le même appel peut être Perdu chez
     *   l'équipe qui l'a laissé filer 30 s, et rester un abandon court (donc
     *   invisible) chez celle qui ne l'a vu que 2 s en débordement.
     */
    shortAbandonClock: "passage" | "team";

    /**
     * Sonnerie directe NON RÉPONDUE dont l'appel repart vers la file d'une
     * AUTRE équipe (renvoi sans réponse configuré vers une réception, une file
     * sœur…). Ne concerne que le bloc « directs » : si l'appel passe par la
     * file du groupe, le débordement de file s'applique déjà.
     *
     * - "lost"     : Perdu pour l'équipe de l'agent (comportement historique)
     * - "overflow" : Débordé — la même case que le débordement de file :
     *                « l'appel nous a échappé ». Symétrique de la règle
     *                answeredThenTransferred (décroché puis parti = Transféré ;
     *                pas décroché puis parti = Débordé). Ne change ni les
     *                reçus ni la prise en charge, seulement la ventilation
     *                Perdus → Débordements.
     */
    unansweredDirectOverflow: "lost" | "overflow";

    /**
     * Un transfert accompli (handed_off) compte-t-il dans la PERFORMANCE de
     * l'équipe (taux de prise en charge) ?
     *
     * C'est la question des réceptions : leur métier EST de transférer. Un
     * appel décroché puis remis en mains propres à quelqu'un qui a servi le
     * client est un travail fait — le débordement sans décroché, lui, reste
     * toujours un échec.
     *
     * - "success" : performance = (répondus + transférés) / reçus
     * - "neutral" : performance = répondus / reçus (le transfert ne compte ni
     *               pour ni contre)
     *
     * Ne change QUE le taux affiché (barre de performance, % agents), jamais
     * les vignettes ni les listes.
     */
    handedOffInPerformance: "success" | "neutral";

    /**
     * Appel décroché par PLUSIEURS agents (transferts internes, renvois) :
     * qui reçoit le crédit dans le tableau par agent ?
     *
     * - "lastAnswer" : le dernier décrocheur du groupe — la somme du tableau
     *                  égale alors la vignette Répondus (règle historique de
     *                  la file, étendue aux appels directs)
     * - "each"       : chaque agent décrocheur — montre l'activité de chacun,
     *                  mais un appel partagé compte dans plusieurs lignes et la
     *                  somme dépasse le total
     *
     * Ne change QUE le tableau par agent, jamais les vignettes.
     */
    agentCredit: "lastAnswer" | "each";
}

/**
 * Table CDR portant le grain choisi.
 *
 * La vue `cdroutput_merged` présente cdroutput avec, pour call_history_id, la
 * clé FUSIONNÉE (COALESCE(main_call_history_id, call_history_id)) — l'identité
 * de la jambe restant lisible dans leg_call_history_id. Basculer de table
 * suffit donc à changer le grain d'une requête sans toucher à sa logique :
 * c'est la garantie que tous les écrans changent de grain ENSEMBLE.
 * (Vue et index : prisma/cdr/sql/001_effective_call_id.sql.)
 */
export function cdrTable(rules: ClassificationRules): string {
    return rules.callGrain === "merged" ? "cdroutput_merged" : "cdroutput";
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
    minAnswerSeconds: 1,
    // "leg" par défaut : le grain fusionné exige la vue cdroutput_merged en
    // base CDR (cf. cdrTable) — une installation neuve ne doit pas en dépendre.
    callGrain: "leg",
    // Arbitrages d'août 2026 : un appel n'est « Répondu » que chez l'équipe qui
    // a servi le client en dernier, et le crédit agent suit la même logique.
    answeredThenTransferred: "overflow",
    agentCredit: "lastAnswer",
    // Le transfert accompli est un travail fait — décisif pour les réceptions
    // (mesuré : Pully passait de 23 % à 88 % de prise en charge sur juin 2026).
    handedOffInPerformance: "success",
    minSignificantDurationSeconds: 1,
    shortAbandonDisposition: "lost",
    // Défauts conservateurs : le comportement historique. Les valeurs "team"
    // et "overflow" ont été arbitrées avec le métier en août 2026 (scénarios
    // Jean/file 500 et Marie/files 950-951) et s'activent par les réglages.
    shortAbandonClock: "passage",
    unansweredDirectOverflow: "lost",
};

// ============================================
// CLASSEMENT (logique pure, testable)
// ============================================

/** Faits observés sur un passage en file, indépendamment des règles. */
export interface PassageFacts {
    answeredHere: boolean;
    overflowed: boolean;
    toVoicemail: boolean;
    /**
     * Durée jugée par le seuil d'abandon court. Ce que cette horloge mesure
     * dépend de la règle `shortAbandonClock` : le seul passage en file, ou le
     * cumul de sollicitation de l'équipe (directs + file). Le choix est fait
     * EN AMONT, au calcul du fait — le classement, lui, ne compare qu'au seuil.
     */
    clockSeconds: number | null;
    /**
     * Le DERNIER décroché humain de l'appel appartient au groupe. Faux quand
     * l'appel, répondu ici, a fini par être servi ailleurs (règle
     * `answeredThenTransferred`).
     */
    servedInTeam: boolean;
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
    if (facts.answeredHere) {
        // Répondu ici mais finalement servi hors du groupe : la règle décide
        // si le groupe garde le crédit (Répondu) ou si c'est un « Transféré ».
        if (rules.answeredThenTransferred === "overflow" && !facts.servedInTeam) return "handed_off";
        return "answered";
    }

    if (facts.overflowed) {
        if (rules.overflow === "answered") return "answered";
        if (rules.overflow === "lost") return "abandoned";
        return "overflow";
    }

    if (facts.toVoicemail) {
        if (rules.voicemail === "answered") return "answered";
        if (rules.voicemail === "lost") return "abandoned";
        // "separate" ET "excluded" : le statut reste « messagerie ». Pour
        // « excluded », c'est la couche de consommation (queue_calls,
        // direct_calls) qui écarte l'appel — la règle décide alors de la
        // PRÉSENCE dans les chiffres, pas du statut.
        return "voicemail";
    }

    const threshold = rules.shortAbandonThresholdSeconds;
    if (threshold !== null && facts.clockSeconds !== null && facts.clockSeconds < threshold) {
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
    // Miroir de la branche « répondu ici mais servi ailleurs » de classifyPassage.
    const answeredResult = rules.answeredThenTransferred === "overflow"
        ? "CASE WHEN served_in_team THEN 'answered' ELSE 'handed_off' END"
        : "'answered'";
    const overflowResult =
        rules.overflow === "answered" ? "'answered'" : rules.overflow === "lost" ? "'abandoned'" : "'overflow'";
    const voicemailResult =
        rules.voicemail === "answered" ? "'answered'" : rules.voicemail === "lost" ? "'abandoned'" : "'voicemail'";

    const shortAbandonBranch =
        rules.shortAbandonThresholdSeconds !== null
            ? `WHEN clock_seconds IS NOT NULL AND clock_seconds < ${rules.shortAbandonThresholdSeconds} THEN 'short_abandon'`
            : "";

    return `CASE
        WHEN answered_here THEN ${answeredResult}
        WHEN overflowed    THEN ${overflowResult}
        WHEN to_voicemail  THEN ${voicemailResult}
        ${shortAbandonBranch}
        ELSE 'abandoned'
    END`;
}

/**
 * Condition SQL « le dernier décroché humain de l'appel appartient au groupe »
 * (fait `servedInTeam`). Le groupe est la CTE `queue_agents`, qui doit donc
 * précéder tout usage. Un appel jamais décroché vaut TRUE par convention : le
 * fait ne sert qu'aux appels répondus, et cette convention évite de requalifier
 * les autres branches.
 *
 * Renvoie "TRUE" quand la règle est inactive : aucun coût dans la requête.
 */
export function buildServedInTeamSQL(
    rules: ClassificationRules,
    callIdExpr: string,
    params: PassageCTEParams,
): string {
    if (rules.answeredThenTransferred !== "overflow") return "TRUE";
    const cdr = cdrTable(rules);
    return `COALESCE((
        SELECT la.destination_dn_type = 'extension'
               AND la.destination_dn_number IN (SELECT extension FROM queue_agents)
        FROM ${cdr} la
        WHERE la.call_history_id = ${callIdExpr}
          AND la.cdr_answered_at IS NOT NULL
          AND la.destination_dn_type IN (${SQL_REAL_PARTY_DEST_TYPES})
          AND COALESCE(la.destination_entity_type, '') != 'voicemail'
          AND la.cdr_started_at >= ${params.startExpr}
          AND la.cdr_started_at <= ${params.endExpr}
        ORDER BY la.cdr_ended_at DESC, la.cdr_started_at DESC, la.cdr_id DESC
        LIMIT 1
    ), TRUE)`;
}

/**
 * Provenance d'un appel, du point de vue de l'équipe qui le reçoit.
 *
 * Le critère est la SOURCE DU PREMIER SEGMENT de l'appel : une extension →
 * « interne » (un collègue appelle) ; tout le reste — provider, ligne externe,
 * bridge — → « externe » (un client appelle). Au grain fusionné, le premier
 * segment est celui de l'appel principal : une jambe de transfert interne d'un
 * appel client reste donc un appel externe, ce qui est le sens attendu.
 */
export type CallOrigin = "both" | "external" | "internal";

/**
 * Condition SQL « l'appel vient de l'interne / de l'externe ».
 *
 * @param callIdExpr expression SQL donnant le call_history_id à qualifier
 * @param cdr        table CDR au grain choisi (cf. cdrTable)
 */
export function buildOriginConditionSQL(
    origin: CallOrigin | undefined,
    callIdExpr: string,
    cdr: string,
): string {
    if (!origin || origin === "both") return "TRUE";
    const firstIsInternal = `(
        SELECT COALESCE(o.source_dn_type, '') = 'extension'
        FROM ${cdr} o
        WHERE o.call_history_id = ${callIdExpr}
        ORDER BY o.cdr_started_at ASC, o.cdr_id ASC
        LIMIT 1
    )`;
    // « IS NOT TRUE » côté externe : un premier segment sans type de source
    // n'est pas un appel interne, il reste compté côté externe.
    return origin === "internal" ? `${firstIsInternal} = TRUE` : `${firstIsInternal} IS NOT TRUE`;
}

export interface PassageCTEParams {
    /** Placeholder ou littéral SQL désignant la file ; `null` = toutes les files. */
    queueExpr: string | null;
    startExpr: string;
    endExpr: string;
    /** Provenance des appels retenus ; absent ou "both" = pas de filtre. */
    origin?: CallOrigin;
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
    // Au grain fusionné, les corrélations « même appel » (débordement,
    // messagerie) couvrent l'appel principal ET ses jambes : c'est le but.
    const cdr = cdrTable(rules);

    // Horloge de l'abandon court (règle shortAbandonClock) :
    // - "passage" : la durée du passage lui-même.
    // - "team"    : cumul des passages du même appel dans la MÊME file (fenêtre
    //   de partition) + sonneries directes significatives sur les agents du
    //   groupe (CTE team_direct_secs, fournie par buildTeamCTEChain — qui
    //   déclare team_direct_segments AVANT ce CTE précisément pour cela).
    const teamClock = rules.shortAbandonClock === "team";
    const clockSecondsExpr = teamClock
        ? `SUM(EXTRACT(EPOCH FROM (c.cdr_ended_at - c.cdr_started_at)))
                OVER (PARTITION BY c.call_history_id, c.destination_dn_number)
                + COALESCE(tds.direct_seconds, 0)`
        : `EXTRACT(EPOCH FROM (c.cdr_ended_at - c.cdr_started_at))`;
    const teamClockJoin = teamClock
        ? `
        LEFT JOIN team_direct_secs tds ON tds.call_history_id = c.call_history_id`
        : "";

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
                SELECT 1 FROM ${cdr} o
                WHERE o.call_history_id = c.call_history_id
                  AND o.destination_dn_type = 'queue'
                  AND o.destination_dn_number <> c.destination_dn_number
                  AND o.cdr_started_at > c.cdr_started_at
            ) AS overflowed,
            -- Messagerie postérieure au passage. Pas besoin d'exclure les
            -- messageries d'une file suivante : le débordement est évalué avant
            -- dans buildPassageOutcomeSQL et l'emporte.
            EXISTS (
                SELECT 1 FROM ${cdr} v
                WHERE v.call_history_id = c.call_history_id
                  AND COALESCE(v.destination_entity_type, '') = 'voicemail'
                  AND v.cdr_started_at >= c.cdr_started_at
            ) AS to_voicemail,
            -- Temps réellement passé DANS la file. L'ancien calcul mesurait le
            -- délai entre le début de l'appel et l'entrée en file, ce qui n'est
            -- pas une attente.
            EXTRACT(EPOCH FROM (c.cdr_ended_at - c.cdr_started_at)) AS wait_seconds,
            -- Durée jugée par le seuil d'abandon court (règle shortAbandonClock).
            ${clockSecondsExpr} AS clock_seconds,
            -- Le dernier décroché humain de l'appel est-il un agent du groupe ?
            -- (règle answeredThenTransferred ; "TRUE" constant quand inactive)
            ${buildServedInTeamSQL(rules, "c.call_history_id", params)} AS served_in_team
        FROM ${cdr} c${teamClockJoin}
        LEFT JOIN LATERAL (
            SELECT
                bool_or(p.cdr_answered_at IS NOT NULL) AS answered_here,
                MAX(EXTRACT(EPOCH FROM (p.cdr_ended_at - p.cdr_answered_at)))
                    FILTER (WHERE p.cdr_answered_at IS NOT NULL) AS talk_seconds,
                MIN(EXTRACT(EPOCH FROM (p.cdr_answered_at - c.cdr_started_at)))
                    FILTER (WHERE p.cdr_answered_at IS NOT NULL) AS answer_wait_seconds
            FROM ${cdr} p
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
    /** Condition SQL supplémentaire sur `direct_grouped.call_history_id` (provenance). */
    extraCallCondition: string = "",
    /**
     * Condition « servi dans le groupe » sur `direct_grouped.call_history_id`
     * (règle answeredThenTransferred). Vide = règle inactive, sorts binaires.
     */
    servedInTeamCondition: string = "",
    /**
     * Condition « l'appel est reparti vers la file d'une autre équipe » sur
     * `direct_grouped` (règle unansweredDirectOverflow). Vide = règle inactive,
     * un direct non répondu reste 'abandoned'.
     */
    overflowCondition: string = "",
): string {
    const wrapperConditions: string[] = [];

    // Règle `voicemail: "excluded"` : un appel direct parti sur la messagerie
    // sans avoir été répondu n'est pas un appel reçu — il sort du bloc, comme
    // les statuts « messagerie » sortent du bloc file. Un appel RÉPONDU reste
    // compté même s'il a fini par toucher une messagerie : la préséance est la
    // même que côté file (répondu > messagerie). Le critère
    // (destination_entity_type = 'voicemail') est celui du fait `to_voicemail`
    // des passages en file.
    if (rules.voicemail === "excluded") {
        wrapperConditions.push(`(answered OR NOT EXISTS (
            SELECT 1 FROM ${cdrTable(rules)} v
            WHERE v.call_history_id = direct_grouped.call_history_id
              AND COALESCE(v.destination_entity_type, '') = 'voicemail'
        ))`);
    }
    if (extraCallCondition) {
        wrapperConditions.push(extraCallCondition);
    }
    const wrapperWhere = wrapperConditions.length > 0
        ? `
        WHERE ${wrapperConditions.join("\n          AND ")}`
        : "";

    // Sort d'un direct non répondu : abandonné, ou « Débordé » si l'appel est
    // reparti vers la file d'une autre équipe (règle unansweredDirectOverflow —
    // le symétrique, côté non-décroché, du transfert accompli).
    const lostOutcome = overflowCondition
        ? `CASE WHEN ${overflowCondition} THEN 'overflow' ELSE 'abandoned' END`
        : `'abandoned'`;

    // Statut du bloc directs — jusqu'à quatre sorts depuis les règles
    // `answeredThenTransferred` et `unansweredDirectOverflow` : répondu,
    // transféré (répondu ici mais servi ailleurs), débordé (non répondu, parti
    // vers une autre file), ou abandonné. Le CASE est l'unique définition,
    // consommée par les vignettes, les graphiques et le filtre du clic.
    const directOutcome = servedInTeamCondition
        ? `CASE
                WHEN NOT answered THEN ${lostOutcome}
                WHEN ${servedInTeamCondition} THEN 'answered'
                ELSE 'handed_off'
           END`
        : `CASE WHEN answered THEN 'answered' ELSE ${lostOutcome} END`;

    return `
    direct_calls AS (
        SELECT call_history_id, started_at,
               ${directOutcome} AS outcome
        FROM (
            SELECT
                d.call_history_id,
                MIN(d.cdr_started_at) AS started_at,
                bool_or(d.cdr_answered_at IS NOT NULL)
                    OR EXISTS (
                        SELECT 1 FROM ${outcomesCTE} q
                        WHERE q.call_history_id = d.call_history_id
                          AND q.outcome = 'answered'
                    ) AS answered
            FROM ${directCTE} d
            WHERE ${buildDirectExclusionSQL(rules, "d")}
            GROUP BY d.call_history_id
        ) direct_grouped${wrapperWhere}
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
    const cdr = cdrTable(rules);

    // Filtre de provenance : appliqué aux DEUX blocs de la partition
    // (queue_calls et direct_calls), donc hérité mécaniquement par tous les
    // consommateurs — vignettes, tableau par agent, graphiques et logs.
    const hasOrigin = !!params.origin && params.origin !== "both";
    const queueOriginCond = hasOrigin
        ? `\n          AND ${buildOriginConditionSQL(params.origin, "cqo.call_history_id", cdr)}`
        : "";
    const directOriginCond = hasOrigin
        ? buildOriginConditionSQL(params.origin, "direct_grouped.call_history_id", cdr)
        : "";

    // Fait « servi dans le groupe » pour le bloc directs (même définition que
    // côté file). Vide quand la règle est inactive.
    const directServedCond = rules.answeredThenTransferred === "overflow"
        ? buildServedInTeamSQL(rules, "direct_grouped.call_history_id", params)
        : "";

    // Fait « reparti vers la file d'une autre équipe » pour le bloc directs
    // (règle unansweredDirectOverflow). La borne temporelle part du PREMIER
    // segment direct : un passage de file antérieur n'est pas un débordement.
    const directOverflowCond = rules.unansweredDirectOverflow === "overflow"
        ? `EXISTS (
                SELECT 1 FROM ${cdr} oq
                WHERE oq.call_history_id = direct_grouped.call_history_id
                  AND oq.destination_dn_type = 'queue'
                  AND oq.destination_dn_number <> ${params.queueExpr}
                  AND oq.cdr_started_at >= direct_grouped.started_at
                  AND oq.cdr_started_at <= ${params.endExpr}
           )`
        : "";

    // Horloge d'équipe des abandons courts : le cumul des sonneries directes,
    // agrégé une fois par appel pour être joint (hashable) aux passages.
    const teamDirectSecsCTE = rules.shortAbandonClock === "team"
        ? `
    team_direct_secs AS (
        SELECT call_history_id,
               SUM(EXTRACT(EPOCH FROM (cdr_ended_at - cdr_started_at))) AS direct_seconds
        FROM team_direct_segments
        GROUP BY call_history_id
    ),`
        : "";

    // ⚠️ L'ordre des CTE est contraint : queue_agents d'abord (served_in_team
    // la référence), puis team_direct_segments AVANT les passages — l'horloge
    // d'équipe (clock_seconds) lit team_direct_secs, qui en dérive.
    return `
    queue_agents AS (
        -- Le nom retenu est celui porté par le segment AU MOMENT de l'appel :
        -- un poste réattribué sur la période produit une paire (extension,
        -- nom) PAR titulaire — chacun ne répond que de ses propres appels.
        SELECT DISTINCT
            child.destination_dn_number AS extension,
            COALESCE(child.destination_dn_name, child.destination_participant_name, child.destination_dn_number) AS agent_name
        FROM ${cdr} child
        JOIN ${cdr} parent ON child.originating_cdr_id = parent.cdr_id
        WHERE child.creation_method = 'route_to'
          AND child.creation_forward_reason = 'polling'
          AND parent.destination_dn_type = 'queue'
          AND parent.destination_dn_number = ${params.queueExpr}
          AND child.cdr_started_at >= ${params.startExpr}
          AND child.cdr_started_at <= ${params.endExpr}
    ),
    team_direct_segments AS (
        SELECT
            c.call_history_id,
            c.cdr_started_at,
            c.cdr_answered_at,
            c.cdr_ended_at,
            -- L'extension et le nom d'époque servent au tableau par agent ;
            -- les autres consommateurs les ignorent.
            c.destination_dn_number AS extension,
            COALESCE(c.destination_dn_name, c.destination_participant_name, c.destination_dn_number) AS agent_name
        FROM ${cdr} c
        WHERE ${buildDirectSegmentWhereClause("c", { durationThreshold: rules.minSignificantDurationSeconds })}
          AND c.destination_dn_number IN (SELECT extension FROM queue_agents)
          AND c.cdr_started_at >= ${params.startExpr}
          AND c.cdr_started_at <= ${params.endExpr}
    ),${teamDirectSecsCTE}
    ${buildQueuePassagesCTE(rules, params)},
    ${buildCallQueueOutcomesCTE(rules)},
    queue_calls AS (
        SELECT cqo.*
        FROM call_queue_outcomes cqo
        WHERE ${buildQueueExclusionSQL(rules, "cqo.call_history_id", "cqo.cdr_started_at")}${
            // Règle `voicemail: "excluded"` : les appels finis sur la messagerie
            // ne comptent pas comme reçus. Écarter ici, dans la table que TOUS
            // les consommateurs lisent (KPIs, logs, graphiques), garantit que
            // chiffres et listes restent d'accord.
            rules.voicemail === "excluded" ? "\n          AND cqo.outcome <> 'voicemail'" : ""}${
            // Même doctrine pour les abandons très courts quand la règle
            // `shortAbandonDisposition: "excluded"` les sort des reçus.
            rules.shortAbandonDisposition === "excluded" ? "\n          AND cqo.outcome <> 'short_abandon'" : ""}${queueOriginCond}
    ),
    ${buildDirectCallsCTE(rules, "team_direct_segments", "call_queue_outcomes", directOriginCond, directServedCond, directOverflowCond)}`;
}

/**
 * CTE du tableau par agent, à insérer après `buildTeamCTEChain`.
 *
 * Le tableau lit la MÊME partition que les vignettes : sans cela, un appel
 * écarté du bloc « file » par la règle du premier contact resterait compté au
 * crédit d'un agent, et la somme du tableau dépasserait la vignette.
 *
 * Le CRÉDIT suit la règle `agentCredit` :
 * - "lastAnswer" : un appel répondu est crédité au dernier décrocheur du
 *   groupe, et seulement s'il est resté « Répondu » (un appel requalifié
 *   Transféré par `answeredThenTransferred` crédite son décrocheur via le
 *   compteur transferts, pas via répondus). Invariant : la somme des crédits
 *   « répondus » égale les répondus au sens fin (la vignette Répondus, elle,
 *   ajoute les transferts accomplis depuis août 2026), bloc par bloc.
 * - "each" : chaque agent décrocheur compte l'appel — la somme peut dépasser
 *   la vignette, c'est le prix de la lecture « activité de chacun ».
 *
 * Les SOLLICITATIONS (calls_received / direct_received) restent par agent dans
 * tous les cas : un appel qui sonne chez trois agents a occupé trois personnes.
 */
export function buildAgentCTEChain(rules: ClassificationRules): string {
    const lastAnswerCredit = rules.agentCredit === "lastAnswer";

    // File : crédit au dernier décrocheur (restreint aux appels Répondus), ou
    // à chaque décrocheur.
    const queueResolved = lastAnswerCredit
        ? `COUNT(DISTINCT CASE WHEN la.last_agent = qp.agent_ext AND qp.outcome = 'answered'
                THEN qp.call_history_id END) AS resolved`
        : `COUNT(DISTINCT CASE WHEN qp.was_answered = 1 THEN qp.call_history_id END) AS resolved`;

    // Transferts accomplis : crédités à l'agent qui a accompli le transfert —
    // le dernier décrocheur du groupe avant que l'appel soit servi ailleurs.
    // C'est le travail des réceptions ; il a sa propre colonne, jamais mélangé
    // aux résolus. Invariant : la somme égale la vignette « Transférés ».
    const queueTransferred = lastAnswerCredit
        ? `COUNT(DISTINCT CASE WHEN la.last_agent = qp.agent_ext AND qp.outcome = 'handed_off'
                THEN qp.call_history_id END) AS transferred`
        : `COUNT(DISTINCT CASE WHEN qp.was_answered = 1 AND qp.outcome = 'handed_off'
                THEN qp.call_history_id END) AS transferred`;

    // Directs : même logique. NB : sous « firstContact », un appel direct
    // répondu via la file n'a pas de décroché direct — il reste alors sans
    // crédit dans le tableau (cas marginal, documenté).
    const directAnswered = lastAnswerCredit
        ? `COUNT(DISTINCT CASE WHEN dla.last_ext = d.extension AND dc.outcome = 'answered'
                THEN d.call_history_id END) AS direct_answered`
        : `COUNT(DISTINCT CASE WHEN d.cdr_answered_at IS NOT NULL THEN d.call_history_id END) AS direct_answered`;

    const directTransferred = lastAnswerCredit
        ? `COUNT(DISTINCT CASE WHEN dla.last_ext = d.extension AND dc.outcome = 'handed_off'
                THEN d.call_history_id END) AS direct_transferred`
        : `COUNT(DISTINCT CASE WHEN d.cdr_answered_at IS NOT NULL AND dc.outcome = 'handed_off'
                THEN d.call_history_id END) AS direct_transferred`;

    return `
    queue_polling AS (
        SELECT
            p.originating_cdr_id,
            p.call_history_id,
            p.destination_dn_number AS agent_ext,
            COALESCE(p.destination_dn_name, p.destination_participant_name, p.destination_dn_number) AS agent_name,
            CASE WHEN p.cdr_answered_at IS NOT NULL THEN 1 ELSE 0 END AS was_answered,
            EXTRACT(EPOCH FROM (p.cdr_ended_at - p.cdr_answered_at)) AS talk_seconds,
            p.cdr_answered_at,
            qc.outcome
        FROM ${cdrTable(rules)} p
        JOIN queue_passages qp ON qp.cdr_id = p.originating_cdr_id
        JOIN queue_calls qc ON qc.call_history_id = p.call_history_id
        WHERE p.creation_forward_reason = 'polling'
          AND p.destination_dn_type = 'extension'
    ),
    last_answered_agent AS (
        SELECT DISTINCT ON (call_history_id)
            call_history_id,
            agent_ext AS last_agent
        FROM queue_polling
        WHERE was_answered = 1
        ORDER BY call_history_id, cdr_answered_at DESC
    ),
    agent_queue_stats AS (
        SELECT
            qp.agent_ext AS extension,
            qp.agent_name AS name,
            COUNT(DISTINCT qp.originating_cdr_id) AS calls_received,
            ${queueResolved},
            ${queueTransferred},
            SUM(CASE WHEN qp.was_answered = 1 THEN qp.talk_seconds ELSE 0 END) AS queue_talk_time
        FROM queue_polling qp
        LEFT JOIN last_answered_agent la ON qp.call_history_id = la.call_history_id
        WHERE qp.agent_ext IN (SELECT extension FROM queue_agents)
        GROUP BY qp.agent_ext, qp.agent_name
    ),
    direct_last_answer AS (
        -- Dernier décrocheur DIRECT de chaque appel du bloc directs.
        SELECT DISTINCT ON (d.call_history_id)
            d.call_history_id,
            d.extension AS last_ext
        FROM team_direct_segments d
        WHERE ${buildDirectExclusionSQL(rules, "d")}
          AND d.cdr_answered_at IS NOT NULL
        ORDER BY d.call_history_id, d.cdr_answered_at DESC, d.cdr_ended_at DESC
    ),
    agent_direct AS (
        SELECT
            d.extension,
            d.agent_name AS name,
            COUNT(DISTINCT d.call_history_id) AS direct_received,
            ${directAnswered},
            ${directTransferred},
            SUM(CASE WHEN d.cdr_answered_at IS NOT NULL
                THEN EXTRACT(EPOCH FROM (d.cdr_ended_at - d.cdr_answered_at)) ELSE 0 END) AS direct_talk_time
        FROM team_direct_segments d
        -- Même population que la vignette « Directs » : un appel écarté du bloc
        -- (messagerie exclue, provenance) ne compte pas au débit d'un agent.
        JOIN direct_calls dc ON dc.call_history_id = d.call_history_id
        LEFT JOIN direct_last_answer dla ON dla.call_history_id = d.call_history_id
        WHERE ${buildDirectExclusionSQL(rules, "d")}
        GROUP BY d.extension, d.agent_name
    ),
    agent_roster AS (
        -- Une ligne par (extension, nom-de-l'époque) : la réattribution d'un
        -- poste sur la période affiche autant de lignes que de titulaires.
        -- L'union couvre le cas marginal d'un nom vu uniquement sur des
        -- appels directs (renommage entre deux sollicitations de la file).
        SELECT DISTINCT extension, agent_name AS name FROM queue_agents
        UNION
        SELECT DISTINCT d.extension, d.agent_name
        FROM team_direct_segments d
        JOIN direct_calls dc ON dc.call_history_id = d.call_history_id
    )`;
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
    // La liste peut être vide lorsqu'on ne demande que les appels directs de
    // l'équipe : `IN ()` est invalide en SQL, d'où le `false`.
    const outcomeCondition = params.outcomes.length > 0
        ? `outcome IN (${params.outcomes.map((o) => `'${o}'`).join(", ")})`
        : "false";

    // Les cartes du bilan d'équipe additionnent file ET appels directs ; le
    // filtre doit donc couvrir la même union, sans quoi le clic sur « Total
    // reçus » ne ramènerait que la part « file ».
    // Côté directs, quatre sorts existent : répondu, transféré (règle
    // answeredThenTransferred), débordé (règle unansweredDirectOverflow), ou
    // perdu.
    const DIRECT_OUTCOMES: PassageOutcome[] = ["answered", "handed_off", "overflow", "abandoned"];
    const directMapped: string[] = [];
    if (params.includeTeamDirect) {
        // Si aucun statut de file n'est demandé, c'est qu'on veut les directs
        // dans leur ensemble.
        if (params.outcomes.length === 0) {
            directMapped.push("TRUE");
        } else {
            const wanted = DIRECT_OUTCOMES.filter((o) => params.outcomes.includes(o));
            if (wanted.length > 0) {
                directMapped.push(`outcome IN (${wanted.map((o) => `'${o}'`).join(", ")})`);
            }
        }
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
        WHERE ${outcomeCondition}${directUnion}
    )`;
}

/**
 * Vue unifiée des appels de l'équipe : passages en file et appels directs,
 * ramenés à un même triplet (appel, instant, statut).
 *
 * C'est ce dont ont besoin les graphiques temporels — courbe de volume et carte
 * des affluences — pour représenter la MÊME population que les vignettes. Sans
 * elle, ils comptaient les appels ayant touché la file sans appliquer la
 * partition, et affichaient donc une troisième population, ni « File » ni
 * « Total reçus ».
 *
 * `UNION ALL` est correct ici : les deux ensembles sont disjoints par
 * construction, c'est tout l'objet de la règle `directAndQueue`.
 *
 * À utiliser après `buildTeamCTEChain`.
 */
export const TEAM_CALLS_UNION_SQL = `
    SELECT call_history_id, cdr_started_at AS started_at, outcome
    FROM queue_calls
    UNION ALL
    SELECT call_history_id, started_at, outcome
    FROM direct_calls
`;

/** Expression SQL de comptage d'un statut donné, pour les KPIs. */
export function sqlCountOutcome(outcome: PassageOutcome, alias = "cqo"): string {
    return `COUNT(*) FILTER (WHERE ${alias}.outcome = '${outcome}')`;
}

export { sqlOutcomeRankCase, sqlRankToOutcomeCase };
