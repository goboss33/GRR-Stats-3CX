import { describe, it, expect } from "vitest";
import {
    determineCallStatus,
    FINAL_STATUS_RULES,
    buildFinalStatusFilterSQL,
    DEFAULT_MIN_ANSWER_SECONDS,
    determineCallProvenance,
    determineCallSens,
    callTouchesBridge,
    buildCallProvenanceCaseSQL,
    buildCallSensCaseSQL,
    buildBridgeTouchSQL,
    buildSensFilterSQL,
    buildProvenanceFilterSQL,
    buildDirectionConditionSQL,
    ORIGIN_SENS,
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

describe("provenance & sens — le modèle à deux axes", () => {
    it("la provenance ne dépend que de la source du premier segment", () => {
        expect(determineCallProvenance("provider")).toBe("external");
        expect(determineCallProvenance("bridge")).toBe("external");
        expect(determineCallProvenance(null)).toBe("external");
        expect(determineCallProvenance("EXTENSION")).toBe("internal");
    });

    it("un entrant via le pont reste externe et entrant (l'autre entité nous appelle)", () => {
        expect(determineCallProvenance("bridge")).toBe("external");
        expect(determineCallSens({ sourceType: "bridge", firstDestType: "extension" })).toBe("inbound");
        expect(callTouchesBridge({ sourceType: "bridge", firstDestType: "extension", lastDestType: "extension" })).toBe(true);
    });

    it("un poste qui appelle l'autre entité via le pont est interne et SORTANT — l'écart des 94 de juillet 2026", () => {
        expect(determineCallProvenance("extension")).toBe("internal");
        expect(determineCallSens({ sourceType: "extension", firstDestType: "unknown" })).toBe("outbound");
        expect(callTouchesBridge({ sourceType: "extension", firstDestType: "unknown", lastDestType: "bridge" })).toBe(true);
    });

    it("intra : poste vers poste, ou vers un système interne (file, SVI…)", () => {
        expect(determineCallSens({ sourceType: "extension", firstDestType: "extension" })).toBe("intra");
        expect(determineCallSens({ sourceType: "extension", firstDestType: "queue" })).toBe("intra");
    });

    it("externe implique entrant, par construction", () => {
        for (const src of ["provider", "bridge", "line", null, "unknown"]) {
            if (determineCallProvenance(src) === "external") {
                expect(determineCallSens({ sourceType: src, firstDestType: "queue" })).toBe("inbound");
            }
        }
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

describe("formatDurationHuman", () => {
    // Les durées viennent de moyennes SQL, donc décimales : c'est là que se
    // logeait « 2m 13.90000000000s ».
    it("arrondit avant de décomposer", () => {
        expect(formatDurationHuman(133.9)).toBe("2m 14s");
        expect(formatDurationHuman(18.7)).toBe("19s");
        expect(formatDurationHuman(59.6)).toBe("1m");
    });

    it("passe aux heures au-delà de soixante minutes", () => {
        expect(formatDurationHuman(3600)).toBe("1h");
        expect(formatDurationHuman(4820.4)).toBe("1h 20m");
    });

    it("n'affiche pas de reste nul", () => {
        expect(formatDurationHuman(120)).toBe("2m");
    });

    it("une durée nulle ou négative reste lisible", () => {
        expect(formatDurationHuman(0)).toBe("0s");
        expect(formatDurationHuman(-3)).toBe("0s");
    });
});

describe("miroirs SQL des règles provenance / sens / pont", () => {
    const exprs = { sourceTypeExpr: "fs.src", firstDestTypeExpr: "fs.fdst" };

    it("le CASE du sens couvre les trois valeurs, dans l'ordre de la fonction TS", () => {
        const sql = buildCallSensCaseSQL(exprs);
        const ordre = ["'inbound'", "'intra'", "'outbound'"];
        const positions = ordre.map((k) => sql.indexOf(k));
        expect(positions.every((x) => x >= 0)).toBe(true);
        expect([...positions]).toEqual([...positions].sort((a, b) => a - b));
        expect(sql).toContain("'queue'"); // systèmes internes inclus dans l'intra
    });

    it("le CASE de la provenance ne regarde que la source, NULL compris", () => {
        const sql = buildCallProvenanceCaseSQL("fs.src");
        expect(sql).toContain("COALESCE(fs.src, '')");
        expect(sql).toContain("'internal'");
        expect(sql).toContain("'external'");
    });

    it("le pont est détecté sur les trois colonnes", () => {
        const sql = buildBridgeTouchSQL({ ...exprs, lastDestTypeExpr: "ls.ldst" });
        expect(sql.split("= 'bridge'")).toHaveLength(4);
    });
});

describe("filtres dérivés des CASE partagés — jamais de prédicat parallèle", () => {
    const exprs = { sourceTypeExpr: "fs.src", firstDestTypeExpr: "fs.fdst" };

    it("le filtre de sens contient le CASE partagé", () => {
        const sql = buildSensFilterSQL(["inbound"], exprs);
        expect(sql).toContain(buildCallSensCaseSQL(exprs));
        expect(sql).toContain("IN ('inbound')");
    });

    it("vide quand rien ou tout est sélectionné", () => {
        expect(buildSensFilterSQL([], exprs)).toBe("");
        expect(buildSensFilterSQL(["inbound", "outbound", "intra"], exprs)).toBe("");
        expect(buildSensFilterSQL(undefined, exprs)).toBe("");
    });

    it("le filtre de provenance emploie le mot du toggle", () => {
        expect(buildProvenanceFilterSQL("external", "fs.src")).toContain("= 'external'");
        expect(buildProvenanceFilterSQL("internal", "fs.src")).toContain("= 'internal'");
        expect(buildProvenanceFilterSQL("both", "fs.src")).toBe("");
        expect(buildProvenanceFilterSQL(undefined, "fs.src")).toBe("");
    });
});

describe("buildDirectionConditionSQL — filtres du tableau de bord", () => {
    const exprs = { sourceTypeExpr: "fs.src", firstDestTypeExpr: "fs.fdst" };

    it("« Sortant » : la provenance est ignorée", () => {
        const sql = buildDirectionConditionSQL({ direction: "outbound", origin: "internal", ...exprs });
        expect(sql).toContain("= 'outbound'");
    });

    it("« Entrant + Externe » : les entrants seulement — le sortant via pont n'y est plus", () => {
        expect(ORIGIN_SENS.external).toEqual(["inbound"]);
        expect(buildDirectionConditionSQL({ direction: "inbound", origin: "external", ...exprs }))
            .toContain("= 'inbound'");
    });

    it("« Entrant + Interne » : seuls les appels intra", () => {
        expect(buildDirectionConditionSQL({ direction: "inbound", origin: "internal", ...exprs }))
            .toContain("= 'intra'");
    });

    it("« Entrant + Les deux » : tout sauf le flux émis", () => {
        expect(buildDirectionConditionSQL({ direction: "inbound", origin: "both", ...exprs }))
            .toContain("<> 'outbound'");
        expect(buildDirectionConditionSQL({ direction: "inbound", ...exprs }))
            .toContain("<> 'outbound'");
    });
});
