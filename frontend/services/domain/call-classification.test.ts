import { describe, it, expect } from "vitest";
import {
    DEFAULT_CLASSIFICATION_RULES,
    classifyPassage,
    reducePassages,
    buildPassageOutcomeSQL,
    buildDirectExclusionSQL,
    buildQueueExclusionSQL,
    buildCallQueueOutcomesCTE,
    OUTCOME_RANK,
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
