import { describe, it, expect } from "vitest";
import {
    determineCallStatus,
    FINAL_STATUS_RULES,
    buildFinalStatusFilterSQL,
    DEFAULT_MIN_ANSWER_SECONDS,
    determineCallDirection,
    determineSegmentCategory,
    isSystemType,
    formatDuration,
    formatDurationHuman,
    formatDurationCompact,
    getDisplayNumber,
    getDisplayName,
    maskPhoneNumber,
    determineQueueOutcome,
    buildDirectSegmentWhereClause,
} from "./call-aggregation";

// Petits fabricants de paramètres avec valeurs par défaut, pour ne renseigner
// que les champs pertinents à chaque cas de test.
function statusParams(over: Partial<Parameters<typeof determineCallStatus>[0]> = {}) {
    return {
        lastDestType: null,
        lastDestEntityType: null,
        terminationReasonDetails: null,
        lastHumanAnsweredAt: null,
        lastHumanStartedAt: null,
        lastHumanEndedAt: null,
        ...over,
    };
}

function categoryParams(over: Partial<Parameters<typeof determineSegmentCategory>[0]> = {}) {
    return {
        terminationReason: null,
        terminationReasonDetails: null,
        creationMethod: null,
        creationForwardReason: null,
        destinationType: null,
        destinationEntityType: null,
        sourceType: null,
        durationSeconds: 0,
        wasAnswered: false,
        ...over,
    };
}

const answeredAt = new Date("2024-01-01T10:00:00Z");
const start = new Date("2024-01-01T10:00:00Z");
const end5s = new Date("2024-01-01T10:00:05Z");
const endHalfSec = new Date("2024-01-01T10:00:00.500Z");

describe("determineCallStatus", () => {
    it("détecte la messagerie via le type de destination", () => {
        expect(determineCallStatus(statusParams({ lastDestType: "voicemail" }))).toBe("voicemail");
        expect(determineCallStatus(statusParams({ lastDestType: "vmail_console" }))).toBe("voicemail");
    });

    it("détecte la messagerie via le type d'entité", () => {
        expect(determineCallStatus(statusParams({ lastDestEntityType: "voicemail" }))).toBe("voicemail");
    });

    it("détecte l'occupation (busy)", () => {
        expect(determineCallStatus(statusParams({ terminationReasonDetails: "user_busy" }))).toBe("busy");
    });

    it("marque 'answered' si un segment humain a répondu > 1s", () => {
        expect(
            determineCallStatus(
                statusParams({ lastHumanAnsweredAt: answeredAt, lastHumanStartedAt: start, lastHumanEndedAt: end5s }),
            ),
        ).toBe("answered");
    });

    it("marque 'missed' si aucun segment humain n'a répondu", () => {
        expect(determineCallStatus(statusParams())).toBe("missed");
    });

    it("marque 'missed' si la réponse humaine dure <= 1s (bruit système)", () => {
        expect(
            determineCallStatus(
                statusParams({ lastHumanAnsweredAt: answeredAt, lastHumanStartedAt: start, lastHumanEndedAt: endHalfSec }),
            ),
        ).toBe("missed");
    });

    it("priorise la messagerie sur l'occupation", () => {
        expect(
            determineCallStatus(statusParams({ lastDestType: "voicemail", terminationReasonDetails: "user_busy" })),
        ).toBe("voicemail");
    });
});

describe("determineCallDirection", () => {
    it("détecte un appel bridge", () => {
        expect(determineCallDirection({ sourceType: "bridge", firstDestType: "extension", lastDestType: "extension" })).toBe("bridge");
        expect(determineCallDirection({ sourceType: "extension", firstDestType: "bridge", lastDestType: null })).toBe("bridge");
    });

    it("détecte un appel interne extension -> extension", () => {
        expect(determineCallDirection({ sourceType: "extension", firstDestType: "extension", lastDestType: "extension" })).toBe("internal");
    });

    it("détecte un appel interne extension -> système (file)", () => {
        expect(determineCallDirection({ sourceType: "extension", firstDestType: "queue", lastDestType: "queue" })).toBe("internal");
    });

    it("détecte un appel sortant extension -> externe", () => {
        expect(determineCallDirection({ sourceType: "extension", firstDestType: "external", lastDestType: "external" })).toBe("outbound");
    });

    it("détecte un appel entrant par défaut", () => {
        expect(determineCallDirection({ sourceType: "external", firstDestType: "queue", lastDestType: "extension" })).toBe("inbound");
    });
});

describe("isSystemType", () => {
    it("reconnaît les types système", () => {
        expect(isSystemType("queue")).toBe(true);
        expect(isSystemType("ivr")).toBe(true);
        expect(isSystemType("QUEUE")).toBe(true); // insensible à la casse
    });

    it("reconnaît un type système via l'entité", () => {
        expect(isSystemType("extension", "ivr")).toBe(true);
    });

    it("rejette une extension", () => {
        expect(isSystemType("extension")).toBe(false);
        expect(isSystemType(null)).toBe(false);
    });
});

describe("formatDuration (mm:ss)", () => {
    it("formate correctement", () => {
        expect(formatDuration(0)).toBe("00:00");
        expect(formatDuration(65)).toBe("01:05");
        expect(formatDuration(3600)).toBe("60:00");
    });
    it("borne les valeurs négatives à zéro", () => {
        expect(formatDuration(-10)).toBe("00:00");
    });
});

describe("formatDurationHuman (avec espace)", () => {
    it("formate en Xs / Xm Ys / Xm", () => {
        expect(formatDurationHuman(45)).toBe("45s");
        expect(formatDurationHuman(65)).toBe("1m 5s");
        expect(formatDurationHuman(120)).toBe("2m");
    });
});

describe("formatDurationCompact (sans espace)", () => {
    it("formate en Xs / XmYs / Xm", () => {
        expect(formatDurationCompact(45)).toBe("45s");
        expect(formatDurationCompact(65)).toBe("1m5s");
        expect(formatDurationCompact(120)).toBe("2m");
    });
});

describe("getDisplayNumber", () => {
    it("privilégie le numéro du participant", () => {
        expect(getDisplayNumber("100", "0791234567", null)).toBe("0791234567");
    });
    it("retombe sur la présentation si valide (sans ':')", () => {
        expect(getDisplayNumber("100", "", "0791234567")).toBe("0791234567");
        expect(getDisplayNumber("100", "", "sip:foo")).toBe("100");
    });
    it("retombe sur le dnNumber puis sur '-'", () => {
        expect(getDisplayNumber("100", "", "")).toBe("100");
        expect(getDisplayNumber(null, "", "")).toBe("-");
    });
});

describe("maskPhoneNumber", () => {
    it("masque un numéro externe en gardant début et fin", () => {
        expect(maskPhoneNumber("0791234567")).toBe("07• ••• ••67");
        expect(maskPhoneNumber("+41791234567")).toBe("+4• ••• ••67");
    });
    it("ne masque pas les extensions internes (<= 5 chiffres)", () => {
        expect(maskPhoneNumber("164")).toBe("164");
        expect(maskPhoneNumber("10003")).toBe("10003");
    });
    it("gère les valeurs vides", () => {
        expect(maskPhoneNumber(null)).toBe("");
        expect(maskPhoneNumber("")).toBe("");
    });
});

describe("getDisplayName", () => {
    it("privilégie le nom du participant et retire le ':' final", () => {
        expect(getDisplayName("Jean Dupont:", null)).toBe("Jean Dupont");
    });
    it("retombe sur le dnName puis sur ''", () => {
        expect(getDisplayName("", "Accueil")).toBe("Accueil");
        expect(getDisplayName(null, null)).toBe("");
    });
});

describe("determineQueueOutcome", () => {
    it("priorité answered > overflow > abandoned", () => {
        expect(determineQueueOutcome(1, 0)).toBe("answered");
        expect(determineQueueOutcome(1, 1)).toBe("answered");
        expect(determineQueueOutcome(0, 1)).toBe("overflow");
        expect(determineQueueOutcome(0, 0)).toBe("abandoned");
    });
});

describe("determineSegmentCategory", () => {
    it("catégorise les segments non ambigus", () => {
        expect(determineSegmentCategory(categoryParams({ sourceType: "bridge" }))).toBe("bridge");
        expect(determineSegmentCategory(categoryParams({ destinationType: "voicemail" }))).toBe("voicemail");
        expect(determineSegmentCategory(categoryParams({ destinationType: "queue" }))).toBe("queue");
        expect(determineSegmentCategory(categoryParams({ destinationType: "ivr" }))).toBe("ivr");
    });

    it("catégorise une conversation répondue", () => {
        expect(
            determineSegmentCategory(categoryParams({ destinationType: "extension", wasAnswered: true, durationSeconds: 30 })),
        ).toBe("conversation");
    });

    it("catégorise un abandon avant réponse", () => {
        expect(
            determineSegmentCategory(categoryParams({ destinationType: "extension", terminationReason: "src_participant_terminated" })),
        ).toBe("abandoned");
    });
});

describe("buildDirectSegmentWhereClause", () => {
    it("cible les segments d'extension hors voicemail/polling", () => {
        const clause = buildDirectSegmentWhereClause("c");
        expect(clause).toContain("c.destination_dn_type = 'extension'");
        expect(clause).toContain("'voicemail'");
        expect(clause).toContain("polling");
    });

    it("ajoute l'exclusion des appels passés par une file quand demandé", () => {
        const clause = buildDirectSegmentWhereClause("c", { excludeQueueOriginated: true, queuePassagesCTEName: "all_queue_passages" });
        expect(clause).toContain("NOT EXISTS");
        expect(clause).toContain("all_queue_passages");
    });
});

describe("statut final — définition unique TypeScript / SQL", () => {
    // Le statut final existait en deux exemplaires sans lien entre eux, ce qui
    // est exactement ce qui avait fait diverger les KPIs et les logs. Les deux
    // dérivent maintenant de FINAL_STATUS_RULES ; ces tests vérifient que la
    // dérivation reste fidèle, notamment sur la priorité.
    it("chaque statut de la table est filtrable", () => {
        for (const rule of FINAL_STATUS_RULES) {
            const sql = buildFinalStatusFilterSQL([rule.status]);
            expect(sql, `statut ${rule.status}`).not.toBe("");
        }
    });

    it("le SQL d'un statut exclut les statuts prioritaires", () => {
        // « Répondu » vient après messagerie et occupé : un appel tombé sur la
        // messagerie ne doit pas ressortir comme répondu.
        const sql = buildFinalStatusFilterSQL(["answered"]);
        expect(sql).toContain("NOT");
        expect(sql).toContain("voicemail");
        expect(sql).toContain("busy");
    });

    it("« manqué » n'est que l'absence des autres", () => {
        // Sa condition propre vaut TRUE : seules les négations le définissent.
        const sql = buildFinalStatusFilterSQL(["missed"]);
        expect(sql).not.toContain("TRUE");
        expect(sql).toContain("NOT");
    });

    it("tous les statuts demandés : aucun filtre", () => {
        expect(buildFinalStatusFilterSQL(["answered", "voicemail", "missed", "busy"])).toBe("");
    });

    it("aucun statut demandé : aucun filtre", () => {
        expect(buildFinalStatusFilterSQL([])).toBe("");
        expect(buildFinalStatusFilterSQL(undefined)).toBe("");
    });

    it("le seuil de réponse est injecté dans le SQL comme dans la fonction", () => {
        expect(buildFinalStatusFilterSQL(["answered"], 5)).toContain("> 5");

        const conversationDe3s = {
            lastDestType: "extension",
            lastDestEntityType: null,
            terminationReasonDetails: null,
            lastHumanAnsweredAt: new Date("2026-07-01T10:00:00Z"),
            lastHumanStartedAt: new Date("2026-07-01T10:00:00Z"),
            lastHumanEndedAt: new Date("2026-07-01T10:00:03Z"),
        };
        expect(determineCallStatus(conversationDe3s, 1)).toBe("answered");
        expect(determineCallStatus(conversationDe3s, 5)).toBe("missed");
    });

    it("le seuil par défaut reste celui d'avant la mise en réglage", () => {
        expect(DEFAULT_MIN_ANSWER_SECONDS).toBe(1);
    });
});
