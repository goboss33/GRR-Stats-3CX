import { describe, it, expect } from "vitest";
import {
    DEFAULT_CLASSIFICATION_RULES,
    classifyPassage,
    reducePassages,
    buildOriginConditionSQL,
    buildPassageOutcomeSQL,
    buildDirectExclusionSQL,
    buildQueueExclusionSQL,
    buildCallQueueOutcomesCTE,
    buildDirectCallsCTE,
    buildTeamCTEChain,
    cdrTable,
    OUTCOME_RANK,
    DEFAULT_OUTCOME_GROUPING,
    outcomesForBucket,
    sumBucket,
    type ClassificationRules,
    type PassageFacts,
    type PassageOutcome,
} from "./call-classification";

const rules = (over: Partial<ClassificationRules> = {}): ClassificationRules => ({
    ...DEFAULT_CLASSIFICATION_RULES,
    ...over,
});

const facts = (over: Partial<PassageFacts> = {}): PassageFacts => ({
    answeredHere: false,
    overflowed: false,
    toVoicemail: false,
    waitSeconds: 60,
    ...over,
});

describe("classifyPassage — préséance", () => {
    it("« répondu » l'emporte sur tout le reste", () => {
        const f = facts({ answeredHere: true, overflowed: true, toVoicemail: true, waitSeconds: 1 });
        expect(classifyPassage(f, rules())).toBe("answered");
    });

    it("le débordement passe avant la messagerie", () => {
        // Une messagerie survenue après un débordement relève de la file suivante,
        // pas de celle-ci.
        const f = facts({ overflowed: true, toVoicemail: true });
        expect(classifyPassage(f, rules())).toBe("overflow");
    });

    it("un abandon court n'est pas un abandon", () => {
        expect(classifyPassage(facts({ waitSeconds: 4 }), rules())).toBe("short_abandon");
        expect(classifyPassage(facts({ waitSeconds: 40 }), rules())).toBe("abandoned");
    });

    it("le seuil d'abandon court est exclusif", () => {
        const r = rules({ shortAbandonThresholdSeconds: 10 });
        expect(classifyPassage(facts({ waitSeconds: 9.9 }), r)).toBe("short_abandon");
        expect(classifyPassage(facts({ waitSeconds: 10 }), r)).toBe("abandoned");
    });

    it("seuil désactivé : tout abandon compte", () => {
        const r = rules({ shortAbandonThresholdSeconds: null });
        expect(classifyPassage(facts({ waitSeconds: 1 }), r)).toBe("abandoned");
    });

    it("une durée inconnue ne peut pas être un abandon court", () => {
        expect(classifyPassage(facts({ waitSeconds: null }), rules())).toBe("abandoned");
    });
});

describe("classifyPassage — règles reconfigurables", () => {
    it("débordement compté comme perdu", () => {
        const f = facts({ overflowed: true });
        expect(classifyPassage(f, rules({ overflow: "lost" }))).toBe("abandoned");
    });

    it("débordement compté comme répondu (vue entreprise)", () => {
        const f = facts({ overflowed: true });
        expect(classifyPassage(f, rules({ overflow: "answered" }))).toBe("answered");
    });

    it("messagerie comptée comme perdue", () => {
        const f = facts({ toVoicemail: true });
        expect(classifyPassage(f, rules({ voicemail: "lost" }))).toBe("abandoned");
    });

    it("messagerie comptée comme répondue", () => {
        const f = facts({ toVoicemail: true });
        expect(classifyPassage(f, rules({ voicemail: "answered" }))).toBe("answered");
    });

    it("messagerie exclue : le statut reste « messagerie » — la présence se joue en aval", () => {
        // La règle "excluded" décide de la PRÉSENCE de l'appel dans les
        // chiffres, pas de son statut : c'est queue_calls / direct_calls qui
        // écartent l'appel, pour que tous les consommateurs le fassent ensemble.
        const f = facts({ toVoicemail: true });
        expect(classifyPassage(f, rules({ voicemail: "excluded" }))).toBe("voicemail");
    });
});

describe("exclusion des messageries (voicemail: « excluded »)", () => {
    const P = { queueExpr: "$1", startExpr: "$2", endExpr: "$3" };

    it("le bloc file écarte les appels messagerie", () => {
        const sql = buildTeamCTEChain(rules({ voicemail: "excluded" }), P);
        expect(sql).toContain("cqo.outcome <> 'voicemail'");
    });

    it("sous les autres règles, le bloc file ne les écarte pas", () => {
        for (const voicemail of ["separate", "lost", "answered"] as const) {
            expect(buildTeamCTEChain(rules({ voicemail }), P))
                .not.toContain("cqo.outcome <> 'voicemail'");
        }
    });

    it("le bloc direct écarte les appels messagerie non répondus", () => {
        const sql = buildDirectCallsCTE(rules({ voicemail: "excluded" }));
        // Un appel répondu reste compté même passé par la messagerie ; seul
        // l'appel non répondu fini sur messagerie sort des chiffres.
        expect(sql).toContain("WHERE (answered OR NOT EXISTS");
        expect(sql).toContain("destination_entity_type");
    });

    it("sous les autres règles, le bloc direct est inchangé", () => {
        const sql = buildDirectCallsCTE(rules({ voicemail: "separate" }));
        expect(sql).not.toContain("answered OR NOT EXISTS");
    });

    it("le SQL du statut de passage garde la branche « voicemail »", () => {
        // L'exclusion ne remappe pas le statut : elle filtre après coup.
        expect(buildPassageOutcomeSQL(rules({ voicemail: "excluded" }))).toContain("'voicemail'");
    });
});

describe("reducePassages — appels repassant dans la même file", () => {
    // Le cas mesuré en production : 211 appels repassent dans la file 900, dont
    // 16 abandonnés puis répondus. C'est précisément l'écart de +16 constaté
    // entre le KPI et les logs avant ce socle.
    const abandonPuisRepondu: PassageOutcome[] = ["abandoned", "answered"];

    it("« best » retient le meilleur résultat", () => {
        expect(reducePassages(abandonPuisRepondu, rules({ multiPassage: "best" }))).toBe("answered");
    });

    it("« last » retient le dernier passage", () => {
        expect(reducePassages(["answered", "abandoned"], rules({ multiPassage: "last" }))).toBe("abandoned");
    });

    it("« best » est indépendant de l'ordre", () => {
        const r = rules({ multiPassage: "best" });
        expect(reducePassages(["answered", "abandoned"], r)).toBe("answered");
        expect(reducePassages(["abandoned", "answered"], r)).toBe("answered");
    });

    it("un abandon court cède devant un abandon caractérisé", () => {
        expect(reducePassages(["short_abandon", "abandoned"], rules())).toBe("abandoned");
    });

    it("refuse une liste vide plutôt que d'inventer un statut", () => {
        expect(() => reducePassages([], rules())).toThrow();
    });
});

describe("cohérence TypeScript / SQL", () => {
    // Le classement existe en deux exemplaires : TypeScript (tests, logique
    // applicative) et SQL (exécution sur des millions de lignes). Ils doivent
    // décrire la même chose, sinon on recrée exactement le bug qu'on corrige.
    it("le SQL couvre les mêmes branches que la fonction, dans le même ordre", () => {
        const sql = buildPassageOutcomeSQL(rules());
        const ordre = ["answered_here", "overflowed", "to_voicemail", "wait_seconds"];
        const positions = ordre.map((k) => sql.indexOf(k));
        expect(positions.every((p) => p >= 0)).toBe(true);
        expect([...positions]).toEqual([...positions].sort((a, b) => a - b));
    });

    it("le SQL omet la branche « abandon court » quand la règle est désactivée", () => {
        expect(buildPassageOutcomeSQL(rules({ shortAbandonThresholdSeconds: null })))
            .not.toContain("short_abandon");
    });

    it("le SQL reflète le remappage du débordement", () => {
        expect(buildPassageOutcomeSQL(rules({ overflow: "lost" }))).not.toContain("'overflow'");
        expect(buildPassageOutcomeSQL(rules({ overflow: "neutral" }))).toContain("'overflow'");
    });

    it("le seuil est injecté comme un nombre, jamais interpolé depuis une chaîne", () => {
        const sql = buildPassageOutcomeSQL(rules({ shortAbandonThresholdSeconds: 15 }));
        expect(sql).toContain("wait_seconds < 15");
    });
});

describe("partition direct / file", () => {
    it("« firstContact » garde en direct les appels entrés avant la file", () => {
        const sql = buildDirectExclusionSQL(rules({ directAndQueue: "firstContact" }), "c");
        expect(sql).toContain("qp.cdr_started_at <= c.cdr_started_at");
    });

    it("« queueWins » exclut tout appel ayant touché la file", () => {
        const sql = buildDirectExclusionSQL(rules({ directAndQueue: "queueWins" }), "c");
        expect(sql).toContain("NOT EXISTS");
        expect(sql).not.toContain("cdr_started_at <=");
    });

    it("« both » n'exclut rien — et rend le total non comparable aux logs", () => {
        expect(buildDirectExclusionSQL(rules({ directAndQueue: "both" }), "c")).toBe("TRUE");
    });

    it("les deux exclusions sont symétriques en mode « firstContact »", () => {
        const r = rules({ directAndQueue: "firstContact" });
        expect(buildDirectExclusionSQL(r, "c")).toContain("NOT EXISTS");
        expect(buildQueueExclusionSQL(r, "x.call_history_id", "x.cdr_started_at")).toContain("NOT EXISTS");
    });

    it("hors « firstContact », le bloc file n'exclut rien", () => {
        const r = rules({ directAndQueue: "queueWins" });
        expect(buildQueueExclusionSQL(r, "x.call_history_id", "x.cdr_started_at")).toBe("TRUE");
    });
});

describe("regroupement d'affichage", () => {
    // L'écran reste à quatre vignettes. Ce qui compte ici est que la même table
    // serve à additionner les compteurs ET à construire le lien du clic : c'est
    // la seule façon d'être sûr que le chiffre affiché et la liste coïncident.
    const counts = { answered: 1722, overflow: 31, voicemail: 11, short_abandon: 110, abandoned: 95 };

    it("« Perdus » absorbe messagerie et abandons courts", () => {
        expect(outcomesForBucket("lost").sort()).toEqual(["abandoned", "short_abandon", "voicemail"]);
        expect(sumBucket(counts, "lost")).toBe(216);
    });

    it("« Répondus » et « Redirigés » restent isolés", () => {
        expect(sumBucket(counts, "answered")).toBe(1722);
        expect(sumBucket(counts, "overflow")).toBe(31);
    });

    it("« Total reçus » couvre tous les statuts", () => {
        expect(outcomesForBucket("received")).toHaveLength(5);
        expect(sumBucket(counts, "received")).toBe(1969);
    });

    it("les vignettes forment une partition : leur somme égale le total", () => {
        const somme = sumBucket(counts, "answered") + sumBucket(counts, "lost") + sumBucket(counts, "overflow");
        expect(somme).toBe(sumBucket(counts, "received"));
    });

    it("un regroupement alternatif est suivi sans toucher au reste", () => {
        const grouping = { ...DEFAULT_OUTCOME_GROUPING, voicemail: "answered" as const };
        expect(sumBucket(counts, "lost", grouping)).toBe(205);
        expect(sumBucket(counts, "answered", grouping)).toBe(1733);
    });

    it("un compteur absent vaut zéro plutôt que NaN", () => {
        expect(sumBucket({ abandoned: 5 }, "lost")).toBe(5);
    });
});

describe("provenance des appels (origin)", () => {
    const P = { queueExpr: "$1", startExpr: "$2", endExpr: "$3" };

    it("« both » ou absent : aucun filtre dans la chaîne", () => {
        expect(buildTeamCTEChain(rules(), P)).not.toContain("source_dn_type = 'extension'");
        expect(buildTeamCTEChain(rules(), { ...P, origin: "both" }))
            .not.toContain("source_dn_type = 'extension'");
    });

    it("« internal » : la source du premier segment doit être une extension", () => {
        const sql = buildTeamCTEChain(rules(), { ...P, origin: "internal" });
        expect(sql).toContain("COALESCE(o.source_dn_type, '') = 'extension'");
        expect(sql).toContain("= TRUE");
    });

    it("« external » : tout le reste, y compris une source sans type", () => {
        const sql = buildTeamCTEChain(rules(), { ...P, origin: "external" });
        expect(sql).toContain("IS NOT TRUE");
    });

    it("le filtre s'applique aux DEUX blocs de la partition", () => {
        const sql = buildTeamCTEChain(rules(), { ...P, origin: "internal" });
        // Bloc file (cqo) ET bloc directs (direct_grouped) : sans l'un des
        // deux, le total ne serait plus la somme des vignettes.
        expect(sql).toContain("cqo.call_history_id\n        ORDER BY");
        expect(sql).toContain("direct_grouped.call_history_id\n        ORDER BY");
    });

    it("le critère lit la table au grain choisi", () => {
        const sql = buildOriginConditionSQL("internal", "x.call_history_id", "cdroutput_merged");
        expect(sql).toContain("FROM cdroutput_merged o");
    });
});

describe("grain de comptage (callGrain)", () => {
    const P = { queueExpr: "$1", startExpr: "$2", endExpr: "$3" };

    it("« leg » lit la table brute, « merged » la vue fusionnée", () => {
        expect(cdrTable(rules({ callGrain: "leg" }))).toBe("cdroutput");
        expect(cdrTable(rules({ callGrain: "merged" }))).toBe("cdroutput_merged");
    });

    it("au grain fusionné, TOUTE la chaîne d'équipe lit la vue", () => {
        const sql = buildTeamCTEChain(rules({ callGrain: "merged" }), P);
        // Une seule occurrence de la table brute qui subsisterait ferait
        // diverger les corrélations « même appel » entre jambes et principal.
        expect(sql).not.toMatch(/\bcdroutput\b(?!_merged)/);
        expect(sql).toContain("cdroutput_merged");
    });

    it("au grain « jambe », la vue n'apparaît nulle part", () => {
        const sql = buildTeamCTEChain(rules({ callGrain: "leg" }), P);
        expect(sql).not.toContain("cdroutput_merged");
    });
});

describe("réduction SQL des passages", () => {
    it("« each » ne déduplique pas", () => {
        expect(buildCallQueueOutcomesCTE(rules({ multiPassage: "each" }))).not.toContain("DISTINCT ON");
    });

    it("« last » trie par date décroissante", () => {
        expect(buildCallQueueOutcomesCTE(rules({ multiPassage: "last" }))).toContain("cdr_started_at DESC");
    });

    it("« best » trie par rang de statut", () => {
        const sql = buildCallQueueOutcomesCTE(rules({ multiPassage: "best" }));
        expect(sql).toContain("DISTINCT ON");
        expect(sql).toContain(`WHEN 'answered' THEN ${OUTCOME_RANK.answered}`);
    });
});
