import type { ClassificationRules } from "@/services/domain/call-classification";

/**
 * Configuration déclarative de l'écran « Règles métier ».
 *
 * L'écran raconte la vie d'un appel en cinq questions ; chaque règle est une
 * carte-question dont les options portent leur conséquence ET leur phrase de
 * résumé. Le résumé exécutif en tête d'écran est construit à partir de ces
 * mêmes phrases : il ne peut pas diverger des choix affichés.
 *
 * Les types de cas réels (`caseKind`) relient une règle à l'explorateur : la
 * modale va chercher en base un appel DISCRIMINANT — dont le sort change selon
 * l'option choisie — et le fait trancher sur pièce.
 */

export type SectionId = 1 | 2 | 3 | 4 | 5;

export interface SectionSpec {
    id: SectionId;
    title: string;
    subtitle: string;
}

export const SECTIONS: SectionSpec[] = [
    { id: 1, title: "Qu'est-ce qu'un appel ?", subtitle: "L'unité de comptage, avant toute statistique." },
    { id: 2, title: "Quels appels comptent ?", subtitle: "Ce qui entre — ou pas — dans les « reçus »." },
    { id: 3, title: "Comment juge-t-on un appel ?", subtitle: "Le statut : répondu, transféré, débordé ou perdu." },
    { id: 4, title: "Crédit & performance", subtitle: "Qui est crédité, et ce que mesure la prise en charge." },
    { id: 5, title: "Qui voit quoi ?", subtitle: "Périmètres et confidentialité — sans effet sur les chiffres." },
];

export type CaseKind =
    | "handoff" | "voicemail" | "grain" | "pingpong" | "short_abandon"
    | "team_clock" | "direct_overflow";

/** Clés de ClassificationRules dont la valeur est un choix parmi des chaînes. */
export type ChoiceRuleKey =
    | "callGrain" | "voicemail" | "shortAbandonDisposition" | "answeredThenTransferred"
    | "multiPassage" | "overflow" | "agentCredit" | "handedOffInPerformance"
    | "outOfScopeFinalStatus" | "directAndQueue"
    | "shortAbandonClock" | "unansweredDirectOverflow";

export interface ChoiceOption {
    value: string;
    label: string;
    /** Conséquence affichée sous les boutons quand l'option est active. */
    consequence: string;
    /** Phrase du résumé exécutif quand l'option est active. */
    summary: string;
}

export interface ChoiceRuleSpec {
    kind: "choice";
    key: ChoiceRuleKey;
    section: SectionId | "advanced";
    question: string;
    options: ChoiceOption[];
    /** Explication longue, repliée derrière « En savoir plus ». */
    more?: string;
    /** Type de cas réel pour l'explorateur (absent = pas de bouton). */
    caseKind?: CaseKind;
    /** Question posée dans la modale de cas réel ({queue} = nom de la file). */
    caseQuestion?: string;
}

export interface NumberRuleSpec {
    kind: "number";
    key: "minSignificantDurationSeconds" | "minAnswerSeconds";
    section: SectionId;
    question: string;
    unit: string;
    min: number;
    max: number;
    consequence: string;
    /** Phrase du résumé ({v} = valeur). */
    summary: string;
    more?: string;
}

/** Carte composite : seuil des abandons courts + leur sort. */
export interface ShortAbandonSpec {
    kind: "shortAbandon";
    key: "shortAbandonThresholdSeconds";
    section: SectionId;
    question: string;
    consequence: string;
    dispositionQuestion: string;
    options: ChoiceOption[];
    caseKind: CaseKind;
    caseQuestion: string;
}

export type RuleSpec = ChoiceRuleSpec | NumberRuleSpec | ShortAbandonSpec;

export const RULE_SPECS: RuleSpec[] = [
    // ── 1. Qu'est-ce qu'un appel ? ─────────────────────────────────────────
    {
        kind: "choice", key: "callGrain", section: 1,
        question: "Un client transféré entre collègues devient-il deux appels ?",
        caseKind: "grain",
        caseQuestion: "Ce parcours doit-il compter comme UN appel ou DEUX ?",
        options: [
            { value: "merged", label: "Non — un client, un appel",
              consequence: "Les jambes de transfert 3CX sont fusionnées dans l'appel principal — le grain des rapports Excel historiques. Le déroulement complet reste visible dans la modale, jambe par jambe.",
              summary: "Un appel = un client — les transferts internes ne créent pas de doublon" },
            { value: "leg", label: "Oui — chaque jambe technique compte",
              consequence: "Un client transféré une fois devient deux appels (~2 % de plus à l'échelle de l'entreprise, mesuré sur juin 2026).",
              summary: "Chaque jambe technique 3CX compte comme un appel" },
        ],
        more: "3CX crée un identifiant d'appel distinct pour chaque jambe de transfert (consultation, renvoi), relié à l'appel d'origine. Compter les jambes gonfle les totaux et double-compte les clients transférés.",
    },
    {
        kind: "number", key: "minSignificantDurationSeconds", section: 1,
        question: "En dessous de quelle durée une sonnerie directe non répondue est-elle du bruit ?",
        unit: "seconde(s)", min: 0, max: 60,
        consequence: "Un appel de 9 millisecondes vers un poste en renvoi n'est pas une vraie tentative : il n'entre pas dans les statistiques. Ce seuil décide de la présence de l'appel, jamais de son statut.",
        summary: "Les sonneries directes non répondues de moins de {v} s sont ignorées (artefacts de routage)",
    },

    // ── 2. Quels appels comptent ? ─────────────────────────────────────────
    {
        kind: "choice", key: "voicemail", section: 2,
        question: "Un appel terminé sur la messagerie est-il un appel reçu ?",
        caseKind: "voicemail",
        caseQuestion: "Cet appel doit-il compter comme un appel REÇU par l'équipe ?",
        options: [
            { value: "excluded", label: "Non — exclu des reçus",
              consequence: "L'appel sort complètement des statistiques (ni reçu, ni perdu) — la convention des rapports Excel historiques.",
              summary: "Les messageries ne comptent pas dans les reçus" },
            { value: "separate", label: "Oui — catégorie à part",
              consequence: "Compté reçu et distingué dans le calcul, mais affiché dans Perdus.",
              summary: "Les messageries comptent, rangées dans Perdus (catégorie à part)" },
            { value: "lost", label: "Oui — compté Perdu",
              consequence: "Fondu dans les abandons dès le calcul.",
              summary: "Les messageries comptent comme Perdus" },
            { value: "answered", label: "Oui — compté Répondu",
              consequence: "Déconseillé : chez vous l'appelant ne peut pas laisser de message, l'appel se termine simplement.",
              summary: "Les messageries comptent comme Répondus" },
        ],
        more: "Le critère est le sort final : l'appel a été « traité » par la messagerie vocale. Un appel répondu par un agent puis passé en messagerie reste Répondu — la préséance protège le travail fait.",
    },
    {
        kind: "shortAbandon", key: "shortAbandonThresholdSeconds", section: 2,
        question: "Et les appelants qui raccrochent presque aussitôt ?",
        consequence: "Sous ce seuil, l'abandon est distingué dans le calcul (« abandon très court » : mauvais numéro, hésitation). Laisser vide pour ne pas distinguer.",
        dispositionQuestion: "Que fait-on de ces abandons très courts ?",
        caseKind: "short_abandon",
        caseQuestion: "Cet appelant a raccroché en quelques secondes : son appel doit-il compter ?",
        options: [
            { value: "lost", label: "Comptés dans Perdus",
              consequence: "Un client qui a réellement appelé compte, même trois secondes. Seule la ventilation interne distingue l'abandon court.",
              summary: "Les abandons de moins de {v} s restent comptés (dans Perdus)" },
            { value: "excluded", label: "Exclus des reçus",
              consequence: "L'appel sort complètement des statistiques — même mécanique que la messagerie exclue. Le taux de prise en charge remonte mécaniquement.",
              summary: "Les abandons de moins de {v} s ne comptent pas du tout" },
        ],
    },

    {
        kind: "choice", key: "shortAbandonClock", section: 2,
        question: "Sur quelle durée juge-t-on cet abandon court ?",
        caseKind: "team_clock",
        caseQuestion: "Cet appelant a longuement sonné chez un agent avant de raccrocher vite en file : son appel doit-il compter pour {queue} ?",
        options: [
            { value: "passage", label: "Le passage en file seul",
              consequence: "Seul le temps passé dans la file est jugé. Angle mort : l'appelant qui a déjà sonné ~30 s sur la ligne directe d'un agent puis raccroche en 2 s de file est traité comme un fantôme — c'est le motif dominant des abandons courts (~45 % mesuré).",
              summary: "L'abandon court est jugé sur le seul passage en file" },
            { value: "team", label: "Toute la sollicitation de l'équipe",
              consequence: "On cumule sonneries directes sur les agents du groupe + passages dans sa file. L'appelant qui a sonné 30 s chez un agent avant la file compte (Perdu) ; l'équipe qui ne l'a vu que 2 s en débordement reste non pénalisée — chaque équipe a sa propre horloge.",
              summary: "L'abandon court est jugé sur toute la sollicitation de l'équipe (sonneries directes + file)" },
        ],
        more: "Chaque équipe a sa propre horloge : on n'y compte que le temps passé avec ELLE (ses agents en direct + sa file). Le même appel peut donc être Perdu chez l'équipe qui l'a laissé filer 30 secondes, et rester invisible chez la réception qui ne l'a vu que 2 secondes en débordement. Mesuré en juillet 2026 : ~1 250 appels/mois redeviendraient visibles avec l'horloge d'équipe.",
    },

    // ── 3. Comment juge-t-on un appel ? ────────────────────────────────────
    {
        kind: "choice", key: "answeredThenTransferred", section: 3,
        question: "Un client transféré à une autre équipe compte-t-il « répondu » chez les deux ?",
        caseKind: "handoff",
        caseQuestion: "Pour {queue}, cet appel doit-il compter comme répondu ?",
        options: [
            { value: "overflow", label: "Non — Transféré chez l'origine",
              consequence: "L'appel garde le statut « Transféré » chez l'équipe qui a décroché (visible dans le tableau des agents et les logs) et « Répondu » chez celle qui a servi le client en dernier. La vignette Répondus des deux équipes le compte : le transfert accompli est du travail fait. Un transfert qui échoue laisse l'appel Répondu ici.",
              summary: "Le transfert accompli reste visible comme Transféré chez l'équipe d'origine" },
            { value: "answered", label: "Oui — Répondu partout",
              consequence: "Chaque équipe est jugée sur son décroché ; un même client peut être « répondu » chez deux équipes.",
              summary: "Un appel transféré est Répondu chez chaque équipe qui a décroché" },
        ],
        more: "Le critère est le dernier décroché humain de l'appel — y compris un numéro externe qui décroche après transfert. Si le transfert échoue (personne ne répond ailleurs), le groupe reste le dernier à avoir servi le client : l'appel reste Répondu.",
    },
    {
        kind: "choice", key: "unansweredDirectOverflow", section: 3,
        question: "Une sonnerie directe non répondue qui part vers la file d'une autre équipe, c'est… ?",
        caseKind: "direct_overflow",
        caseQuestion: "Cet appel a sonné chez un agent de {queue} sans réponse, puis est parti vers une autre file : Perdu ou Débordé pour {queue} ?",
        options: [
            { value: "lost", label: "Perdu",
              consequence: "L'équipe de l'agent est jugée comme si l'appel était mort chez elle, même s'il a continué — et peut-être abouti — ailleurs.",
              summary: "Une sonnerie directe non répondue partie vers une autre file compte Perdue" },
            { value: "overflow", label: "Débordé",
              consequence: "La même case que le débordement de file : « l'appel nous a échappé ». Ne change ni les reçus ni la prise en charge — seulement la ventilation Perdus → Débordements. Symétrique du transfert accompli, côté non-décroché.",
              summary: "Une sonnerie directe non répondue partie vers une autre file est Débordée" },
        ],
        more: "Le cas type : le renvoi sans réponse d'un collaborateur pointe directement vers une réception ou une file sœur, sans passer par la file de son propre groupe. Quand l'appel passe par la file du groupe, le débordement de file s'applique déjà — cette règle couvre l'autre chemin. Mesuré : ~230-310 appels/mois, concentrés sur les réceptions.",
    },
    {
        kind: "choice", key: "multiPassage", section: 3,
        question: "Un appel qui repasse deux fois dans la même file compte-t-il deux fois ?",
        caseKind: "pingpong",
        caseQuestion: "Combien de fois cet appel doit-il compter pour la file ?",
        options: [
            { value: "best", label: "Non — le meilleur résultat l'emporte",
              consequence: "Un appel abandonné puis repris et répondu compte une fois, Répondu : la file est jugée sur le service finalement rendu.",
              summary: "Un appel qui repasse en file compte une fois, à son meilleur résultat" },
            { value: "last", label: "Non — le dernier passage fait foi",
              consequence: "Un appel répondu puis rappelé et abandonné devient Perdu.",
              summary: "Un appel qui repasse en file compte une fois, au sort de son dernier passage" },
            { value: "each", label: "Oui — chaque passage compte",
              consequence: "Le total dépasse alors le nombre d'appels et ne correspond plus aux logs.",
              summary: "Chaque passage en file compte séparément" },
        ],
    },
    {
        kind: "choice", key: "overflow", section: 3,
        question: "Un appel qui déborde vers une autre file sans décroché ici, c'est… ?",
        options: [
            { value: "neutral", label: "Débordé",
              consequence: "Ni répondu ni perdu pour la file d'origine — une catégorie à part.",
              summary: "Un débordement sans décroché est Débordé (ni répondu, ni perdu)" },
            { value: "lost", label: "Perdu pour la file d'origine",
              consequence: "Vision exigeante, utile pour piloter les effectifs : la file n'a pas su répondre dans son délai.",
              summary: "Un débordement sans décroché compte Perdu pour la file d'origine" },
            { value: "answered", label: "Répondu",
              consequence: "Gonfle le taux de service pour un travail fait par une autre équipe.",
              summary: "Un débordement compte Répondu (vue entreprise)" },
        ],
    },
    {
        kind: "number", key: "minAnswerSeconds", section: 3,
        question: "Combien de temps une conversation doit-elle durer pour compter comme une réponse ?",
        unit: "seconde(s)", min: 0, max: 60,
        consequence: "Écarte les décrochés-raccrochés immédiats et les transferts qui échouent à l'aboutissement. On juge l'aboutissement, pas l'effort.",
        summary: "Un décroché de moins de {v} s n'est pas une réponse",
    },

    // ── 4. Crédit & performance ────────────────────────────────────────────
    {
        kind: "choice", key: "agentCredit", section: 4,
        question: "Plusieurs agents décrochent le même appel : qui a le crédit ?",
        options: [
            { value: "lastAnswer", label: "Le dernier décrocheur",
              consequence: "Un appel = un agent crédité (celui qui a servi le client en dernier) ; les transferts accomplis sont crédités à part, dans la colonne Transférés. La somme du tableau par agent égale les vignettes.",
              summary: "Le crédit d'un appel va au dernier décrocheur — la somme du tableau agents égale les vignettes" },
            { value: "each", label: "Chaque décrocheur",
              consequence: "On lit l'activité de chacun, mais un appel partagé compte dans plusieurs lignes : la somme du tableau dépasse le total.",
              summary: "Chaque agent décrocheur est crédité (la somme du tableau dépasse le total)" },
        ],
    },
    {
        kind: "choice", key: "handedOffInPerformance", section: 4,
        question: "Un transfert accompli compte-t-il dans le taux de prise en charge ?",
        caseKind: "handoff",
        caseQuestion: "Ce transfert accompli est-il un travail réussi pour {queue} ?",
        options: [
            { value: "success", label: "Oui — c'est un travail fait",
              consequence: "Prise en charge = (répondus + transferts accomplis) / reçus. Le débordement SANS décroché reste un échec. Même formule pour toutes les équipes — décisif pour les réceptions.",
              summary: "La prise en charge = répondus + transferts accomplis, rapportés aux reçus" },
            { value: "neutral", label: "Non",
              consequence: "Prise en charge = répondus / reçus. Les équipes qui transfèrent beaucoup (réceptions) chutent mécaniquement.",
              summary: "La prise en charge ne compte que les répondus" },
        ],
        more: "Sans cette règle, la réception de Pully affichait 23 % de performance pour un travail fait à 88 % (mesuré sur juin 2026) : son métier est précisément de décrocher puis router.",
    },

    // ── 5. Qui voit quoi ? ─────────────────────────────────────────────────
    {
        kind: "choice", key: "outOfScopeFinalStatus", section: 5,
        question: "Un appel « perdu chez moi » a été récupéré hors de mon périmètre : qu'affiche-t-on ?",
        options: [
            { value: "name", label: "On nomme la file",
              consequence: "« Répondu par 910 – Neuchâtel » — le plus informatif, mais révèle l'existence de files hors périmètre.",
              summary: "Une file hors périmètre qui récupère un appel est nommée" },
            { value: "anonymize", label: "On reste vague",
              consequence: "« Répondu (hors périmètre) » — le manager sait que le client a été servi, sans voir l'organisation des autres régions.",
              summary: "Une file hors périmètre est signalée sans être nommée" },
            { value: "hide", label: "On ne dit rien",
              consequence: "Cloisonnement strict : le manager croira ses appels définitivement perdus.",
              summary: "Les récupérations hors périmètre sont masquées" },
        ],
    },

    // ── Avancé ─────────────────────────────────────────────────────────────
    {
        kind: "choice", key: "directAndQueue", section: "advanced",
        question: "Un appel à la fois direct et passé en file : dans quel bloc du bilan d'équipe ?",
        options: [
            { value: "queueWins", label: "La file prime",
              consequence: "Classé en File. Total juste, volume des lignes directes sous-estimé.",
              summary: "Un appel direct puis en file est classé « File »" },
            { value: "firstContact", label: "Le premier contact prime",
              consequence: "Classé selon la façon dont il est entré dans l'équipe. Total juste, lecture par canal d'entrée.",
              summary: "Un appel direct puis en file est classé selon son premier contact" },
            { value: "both", label: "Compté dans les deux blocs",
              consequence: "Mesure la charge réelle mais le total dépasse le nombre d'appels et ne correspond plus aux logs.",
              summary: "Un appel direct puis en file compte dans les deux blocs" },
        ],
    },
];

/** Pastilles du glossaire — mêmes couleurs que les vignettes des statistiques. */
export const GLOSSARY = [
    { label: "Répondu", className: "bg-emerald-50 text-emerald-700 border-emerald-200", title: "Un agent du groupe a servi le client en dernier" },
    { label: "Transféré", className: "bg-emerald-50 text-emerald-600 border-emerald-200", title: "Décroché ici, puis client servi ailleurs — le transfert accompli, compté dans Répondus" },
    { label: "Débordé", className: "bg-orange-50 text-orange-700 border-orange-200", title: "Parti vers une autre file SANS décroché ici" },
    { label: "Perdu", className: "bg-red-50 text-red-700 border-red-200", title: "Personne n'a servi le client" },
    { label: "Messagerie", className: "bg-indigo-50 text-indigo-700 border-indigo-200", title: "Terminé sur la messagerie vocale" },
] as const;

/** Valeur affichée par une règle à choix, quelle que soit sa forme. */
export function choiceValue(rules: ClassificationRules, key: ChoiceRuleKey): string {
    return String(rules[key]);
}

/**
 * Le résumé exécutif : une phrase par règle, dans l'ordre du pipeline.
 * Construit à partir des MÊMES textes que les cartes — il ne peut pas diverger.
 */
export function buildSummary(rules: ClassificationRules): string[] {
    const phrases: string[] = [];
    for (const spec of RULE_SPECS) {
        if (spec.section === "advanced") continue;
        if (spec.kind === "number") {
            phrases.push(spec.summary.replace("{v}", String(rules[spec.key])));
        } else if (spec.kind === "shortAbandon") {
            const threshold = rules.shortAbandonThresholdSeconds;
            if (threshold === null) { phrases.push("Les abandons courts ne sont pas distingués"); continue; }
            const opt = spec.options.find((o) => o.value === rules.shortAbandonDisposition);
            if (opt) phrases.push(opt.summary.replace("{v}", String(threshold)));
        } else {
            const opt = spec.options.find((o) => o.value === choiceValue(rules, spec.key));
            if (opt) phrases.push(opt.summary);
        }
    }
    return phrases;
}
