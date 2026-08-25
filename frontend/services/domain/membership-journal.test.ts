import { describe, it, expect } from "vitest";
import { normalizeSnapshot, planJournalChanges, type OpenInterval } from "./membership-journal";

const interval = (id: string, queueNumber: string, extension: string, agentName: string): OpenInterval =>
    ({ id, queueNumber, extension, agentName });

describe("normalizeSnapshot — hygiène du relevé", () => {
    it("nettoie espaces et doublons, garde la première occurrence", () => {
        expect(normalizeSnapshot([
            { queueNumber: " 904 ", extension: " 140 ", agentName: " Dupont Marc " },
            { queueNumber: "904", extension: "140", agentName: "Autre Nom" },
        ])).toEqual([{ queueNumber: "904", extension: "140", agentName: "Dupont Marc" }]);
    });

    it("nom vide (piège 3CX : chaîne vide, pas null) → le poste fait office de nom", () => {
        expect(normalizeSnapshot([{ queueNumber: "904", extension: "140", agentName: "  " }]))
            .toEqual([{ queueNumber: "904", extension: "140", agentName: "140" }]);
    });

    it("écarte les entrées sans file ou sans poste", () => {
        expect(normalizeSnapshot([
            { queueNumber: "", extension: "140", agentName: "X" },
            { queueNumber: "904", extension: " ", agentName: "X" },
        ])).toEqual([]);
    });
});

describe("planJournalChanges — les mouvements du journal", () => {
    it("premier relevé : tout s'ouvre", () => {
        const plan = planJournalChanges([], [
            { queueNumber: "904", extension: "140", agentName: "Dupont" },
            { queueNumber: "904", extension: "152", agentName: "Nicole" },
        ]);
        expect(plan.toOpen).toHaveLength(2);
        expect(plan.toClose).toEqual([]);
        expect(plan.toTouch).toEqual([]);
    });

    it("rien ne change : simple prolongation", () => {
        const plan = planJournalChanges(
            [interval("a", "904", "140", "Dupont")],
            [{ queueNumber: "904", extension: "140", agentName: "Dupont" }],
        );
        expect(plan).toEqual({ toClose: [], toOpen: [], toTouch: ["a"] });
    });

    it("départ : l'intervalle se ferme", () => {
        const plan = planJournalChanges([interval("a", "904", "152", "Nicole")], []);
        expect(plan).toEqual({ toClose: ["a"], toOpen: [], toTouch: [] });
    });

    it("passation Nicole → Martine sur le même poste : fermeture ET ouverture", () => {
        const plan = planJournalChanges(
            [interval("a", "904", "152", "Nicole")],
            [{ queueNumber: "904", extension: "152", agentName: "Martine" }],
        );
        expect(plan.toClose).toEqual(["a"]);
        expect(plan.toOpen).toEqual([{ queueNumber: "904", extension: "152", agentName: "Martine" }]);
        expect(plan.toTouch).toEqual([]);
    });

    it("le même poste dans deux files = deux intervalles indépendants", () => {
        const plan = planJournalChanges(
            [interval("a", "904", "140", "Dupont"), interval("b", "906", "140", "Dupont")],
            [{ queueNumber: "904", extension: "140", agentName: "Dupont" }],
        );
        expect(plan.toClose).toEqual(["b"]);
        expect(plan.toTouch).toEqual(["a"]);
    });

    it("une file disparue ferme tous ses intervalles", () => {
        const plan = planJournalChanges(
            [interval("a", "999", "140", "Dupont"), interval("b", "999", "152", "Martine")],
            [{ queueNumber: "904", extension: "140", agentName: "Dupont" }],
        );
        expect(plan.toClose.sort()).toEqual(["a", "b"]);
        expect(plan.toOpen).toEqual([{ queueNumber: "904", extension: "140", agentName: "Dupont" }]);
    });

    it("doublon d'intervalles ouverts (état hérité d'un incident) : pas de double ouverture", () => {
        const plan = planJournalChanges(
            [interval("a", "904", "140", "Dupont"), interval("a2", "904", "140", "Dupont")],
            [{ queueNumber: "904", extension: "140", agentName: "Dupont" }],
        );
        expect(plan.toOpen).toEqual([]);
        expect(plan.toTouch.sort()).toEqual(["a", "a2"]);
    });
});
