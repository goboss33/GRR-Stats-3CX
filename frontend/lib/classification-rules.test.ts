import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Le chargeur traduit une ligne de base en règles de calcul. Une valeur
 * inattendue ne doit jamais produire une règle inattendue : elle fausserait
 * silencieusement tous les chiffres, sans erreur visible.
 */

const { db } = vi.hoisted(() => ({
    db: { appSettings: { findUnique: vi.fn() } },
}));

vi.mock("@/lib/prisma-auth", () => ({ prismaAuth: db }));

import { getClassificationRules, invalidateClassificationRules } from "./classification-rules";
import { DEFAULT_CLASSIFICATION_RULES } from "@/services/domain/call-classification";

const ROW_COMPLETE = {
    ruleMultiPassage: "last",
    ruleOverflow: "lost",
    ruleShortAbandonSec: 25,
    ruleDirectAndQueue: "queueWins",
    ruleVoicemail: "answered",
    ruleOutOfScopeFinalStatus: "hide",
    ruleMinAnswerSec: 3,
    ruleCallGrain: "merged",
    ruleAnsweredThenTransferred: "answered",
    ruleAgentCredit: "each",
    ruleHandedOffInPerformance: "neutral",
};

beforeEach(() => {
    vi.clearAllMocks();
    invalidateClassificationRules();
});

describe("lecture des réglages", () => {
    it("reprend les valeurs enregistrées", async () => {
        db.appSettings.findUnique.mockResolvedValue(ROW_COMPLETE);
        expect(await getClassificationRules()).toEqual({
            multiPassage: "last",
            overflow: "lost",
            shortAbandonThresholdSeconds: 25,
            directAndQueue: "queueWins",
            voicemail: "answered",
            outOfScopeFinalStatus: "hide",
            minAnswerSeconds: 3,
            callGrain: "merged",
            answeredThenTransferred: "answered",
            agentCredit: "each",
            handedOffInPerformance: "neutral",
        });
    });

    it("aucune ligne en base : valeurs par défaut", async () => {
        db.appSettings.findUnique.mockResolvedValue(null);
        expect(await getClassificationRules()).toEqual(DEFAULT_CLASSIFICATION_RULES);
    });

    it("base indisponible : valeurs par défaut plutôt qu'une erreur", async () => {
        // Les statistiques ne doivent pas tomber parce que la base
        // d'authentification est momentanément injoignable.
        db.appSettings.findUnique.mockRejectedValue(new Error("connexion refusée"));
        expect(await getClassificationRules()).toEqual(DEFAULT_CLASSIFICATION_RULES);
    });
});

describe("robustesse des valeurs", () => {
    it("une valeur inconnue retombe sur le défaut, sans faire échouer le reste", async () => {
        db.appSettings.findUnique.mockResolvedValue({
            ...ROW_COMPLETE,
            ruleMultiPassage: "n_importe_quoi",
        });
        const rules = await getClassificationRules();
        expect(rules.multiPassage).toBe("best");
        expect(rules.overflow).toBe("lost");
    });

    it("null sur le seuil désactive la règle et ne devient pas le défaut", async () => {
        // Distinction essentielle : `null` est un choix explicite de
        // l'administrateur, pas une absence de valeur.
        db.appSettings.findUnique.mockResolvedValue({ ...ROW_COMPLETE, ruleShortAbandonSec: null });
        expect((await getClassificationRules()).shortAbandonThresholdSeconds).toBeNull();
    });

    it("un seuil à zéro est conservé tel quel", async () => {
        db.appSettings.findUnique.mockResolvedValue({ ...ROW_COMPLETE, ruleShortAbandonSec: 0 });
        expect((await getClassificationRules()).shortAbandonThresholdSeconds).toBe(0);
    });
});

describe("cache", () => {
    it("ne relit pas la base à chaque appel", async () => {
        db.appSettings.findUnique.mockResolvedValue(ROW_COMPLETE);
        await getClassificationRules();
        await getClassificationRules();
        await getClassificationRules();
        expect(db.appSettings.findUnique).toHaveBeenCalledTimes(1);
    });

    it("l'invalidation force une relecture", async () => {
        db.appSettings.findUnique.mockResolvedValue(ROW_COMPLETE);
        await getClassificationRules();

        invalidateClassificationRules();
        db.appSettings.findUnique.mockResolvedValue({ ...ROW_COMPLETE, ruleOverflow: "neutral" });

        expect((await getClassificationRules()).overflow).toBe("neutral");
        expect(db.appSettings.findUnique).toHaveBeenCalledTimes(2);
    });
});
