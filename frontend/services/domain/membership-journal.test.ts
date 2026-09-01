import { describe, it, expect } from "vitest";
import {
    normalizeSnapshot,
    planJournalChanges,
    localDateKey,
    journalCutoverKey,
    windowReachesCutover,
    normalizeQueueSnapshot,
    planDirectoryChanges,
    type OpenInterval,
    type OpenQueueEntry,
    type SnapshotQueue,
} from "./membership-journal";

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

describe("frontière de bascule — le premier mois entièrement couvert", () => {
    const TZ = "Europe/Zurich";

    it("clé de date locale : minuit local d'été = veille en UTC", () => {
        // Le 1er septembre 00:00 à Zurich (UTC+2) est le 31 août 22:00 UTC.
        expect(localDateKey(new Date("2026-08-31T22:00:00.000Z"), TZ)).toBe(20260901);
        expect(localDateKey(new Date("2026-08-31T21:59:59.999Z"), TZ)).toBe(20260831);
    });

    it("journal né le 25 août → la bascule est le 1er septembre", () => {
        expect(journalCutoverKey(new Date("2026-08-25T07:06:00.000Z"), TZ)).toBe(20260901);
    });

    it("journal né un 1er du mois → ce mois est déjà entier", () => {
        // 1er septembre 03:00 locale = 01:00 UTC.
        expect(journalCutoverKey(new Date("2026-09-01T01:00:00.000Z"), TZ)).toBe(20260901);
    });

    it("passage d'année : journal né le 15 décembre → bascule au 1er janvier", () => {
        expect(journalCutoverKey(new Date("2026-12-15T10:00:00.000Z"), TZ)).toBe(20270101);
    });

    it("fenêtre de septembre → journal ; fenêtre d'août ou à cheval → activité", () => {
        const firstRun = new Date("2026-08-25T07:06:00.000Z");
        // Filtre « 1er septembre » : commence le 31 août 22:00 UTC (minuit local).
        expect(windowReachesCutover(new Date("2026-08-31T22:00:00.000Z"), firstRun, TZ)).toBe(true);
        // Filtre « 30 août » ou « août entier » : ancien régime.
        expect(windowReachesCutover(new Date("2026-08-29T22:00:00.000Z"), firstRun, TZ)).toBe(false);
        expect(windowReachesCutover(new Date("2026-07-31T22:00:00.000Z"), firstRun, TZ)).toBe(false);
    });
});

describe("annuaire des files — normalizeQueueSnapshot", () => {
    it("déduplique par numéro et nettoie les espaces", () => {
        const out = normalizeQueueSnapshot([
            { queueNumber: " 925 ", queueName: " Gérance FR-G01 ", department: " GRR BULLE " },
            { queueNumber: "925", queueName: "Gérance FR-G01", department: "GRR BULLE" },
        ]);
        expect(out).toEqual([{ queueNumber: "925", queueName: "Gérance FR-G01", department: "GRR BULLE" }]);
    });

    it("nom vide : le numéro fait office de nom ; département vide : null", () => {
        expect(normalizeQueueSnapshot([{ queueNumber: "807", queueName: "  ", department: "" }]))
            .toEqual([{ queueNumber: "807", queueName: "807", department: null }]);
    });

    it("une file sans numéro est ignorée", () => {
        expect(normalizeQueueSnapshot([{ queueNumber: "", queueName: "X", department: "Y" }])).toEqual([]);
    });
});

describe("annuaire des files — planDirectoryChanges", () => {
    const ligne = (over: Partial<OpenQueueEntry> = {}): OpenQueueEntry => ({
        id: "i1", queueNumber: "925", queueName: "Gérance FR-G01", department: "GRR BULLE", ...over,
    });
    const vue = (over: Partial<SnapshotQueue> = {}): SnapshotQueue => ({
        queueNumber: "925", queueName: "Gérance FR-G01", department: "GRR BULLE", ...over,
    });

    it("rien n'a bougé : simple prolongation", () => {
        const p = planDirectoryChanges([ligne()], [vue()]);
        expect(p).toEqual({ toClose: [], toOpen: [], toTouch: ["i1"] });
    });

    it("file renommée : la ligne se ferme, une nouvelle s'ouvre", () => {
        const p = planDirectoryChanges([ligne()], [vue({ queueName: "Gérance Fribourg" })]);
        expect(p.toClose).toEqual(["i1"]);
        expect(p.toOpen).toEqual([vue({ queueName: "Gérance Fribourg" })]);
        expect(p.toTouch).toEqual([]);
    });

    it("changement de département : même traitement — le cas RC → GRR", () => {
        const p = planDirectoryChanges([ligne({ department: "RC BULLE" })], [vue()]);
        expect(p.toClose).toEqual(["i1"]);
        expect(p.toOpen).toEqual([vue()]);
    });

    it("file disparue du PBX : la ligne se ferme, rien ne s'ouvre", () => {
        const p = planDirectoryChanges([ligne()], []);
        expect(p).toEqual({ toClose: ["i1"], toOpen: [], toTouch: [] });
    });

    it("nouvelle file : une ligne s'ouvre", () => {
        const p = planDirectoryChanges([], [vue({ queueNumber: "958", queueName: "Service Client", department: "GRR GENEVE" })]);
        expect(p.toOpen).toHaveLength(1);
        expect(p.toClose).toEqual([]);
    });

    it("département perdu (null) : c'est aussi un mouvement", () => {
        const p = planDirectoryChanges([ligne()], [vue({ department: null })]);
        expect(p.toClose).toEqual(["i1"]);
        expect(p.toOpen[0].department).toBeNull();
    });
});
