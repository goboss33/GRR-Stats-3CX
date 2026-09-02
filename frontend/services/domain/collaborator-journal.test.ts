import { describe, expect, it } from "vitest";
import {
    emailsAvecPhotoAttendue,
    indexerGraph,
    normaliserEmail,
    normalizeCollaborators,
    planCollaboratorChanges,
    type GraphUserLike,
    type OpenCollaboratorRow,
} from "./collaborator-journal";

const graphUser = (partiel: Partial<GraphUserLike> & { id: string }): GraphUserLike => ({
    mail: null, userPrincipalName: null, jobTitle: null, accountEnabled: true, ...partiel,
});

describe("normaliserEmail — la clé de jointure", () => {
    it("met en minuscules et ignore les espaces", () => {
        expect(normaliserEmail("  Alexis.Buvelot@GRRSA.ch ")).toBe("alexis.buvelot@grrsa.ch");
    });
    it("refuse ce qui n'est pas une adresse", () => {
        expect(normaliserEmail("")).toBeNull();
        expect(normaliserEmail("Buvelot, Alexis")).toBeNull();
        expect(normaliserEmail(42)).toBeNull();
    });
});

describe("indexerGraph — par e-mail ET par nom principal", () => {
    it("retrouve la même personne par l'un ou l'autre", () => {
        const u = graphUser({ id: "g1", mail: "prenom.nom@grrsa.ch", userPrincipalName: "pnom@grrsa.onmicrosoft.com" });
        const index = indexerGraph([u]);
        expect(index.get("prenom.nom@grrsa.ch")?.id).toBe("g1");
        expect(index.get("pnom@grrsa.onmicrosoft.com")?.id).toBe("g1");
    });
});

describe("normalizeCollaborators — le rapprochement", () => {
    const graph = indexerGraph([
        graphUser({ id: "g-lucia", mail: "lucia@grrsa.ch", jobTitle: "Gérante technique" }),
        graphUser({ id: "g-parti", mail: "parti@grrsa.ch", jobTitle: "Comptable", accountEnabled: false }),
    ]);
    const users = [
        { Number: "100", DisplayName: "Sequeiros, Lucia", EmailAddress: "Lucia@grrsa.ch" },
        { Number: "103", DisplayName: "Pully, Conférence", EmailAddress: "" },
        { Number: "104", DisplayName: "Inconnu, Jean", EmailAddress: "jean@ailleurs.ch" },
        { Number: "105", DisplayName: "Parti, Paul", EmailAddress: "parti@grrsa.ch" },
    ];

    it("rapproche par e-mail, sans regarder le nom, et prend le titre", () => {
        const [lucia] = normalizeCollaborators(users, graph);
        expect(lucia).toEqual({
            extension: "100", displayName: "Sequeiros, Lucia", email: "lucia@grrsa.ch",
            jobTitle: "Gérante technique", graphId: "g-lucia", matchState: "ok",
        });
    });
    it("qualifie chaque échec : sans e-mail, inconnu de Microsoft, compte désactivé", () => {
        const etats = normalizeCollaborators(users, graph).map((c) => c.matchState);
        expect(etats).toEqual(["ok", "sans-email", "inconnu-m365", "compte-desactive"]);
    });
    it("un compte désactivé garde son titre (histoire) mais pas de photo attendue", () => {
        const snapshot = normalizeCollaborators(users, graph);
        expect(snapshot[3].jobTitle).toBe("Comptable");
        expect([...emailsAvecPhotoAttendue(snapshot).keys()]).toEqual(["lucia@grrsa.ch"]);
    });
    it("sans intégration M365, le journal s'écrit quand même, sans titre, et le dit", () => {
        const [lucia] = normalizeCollaborators(users, null);
        expect(lucia.matchState).toBe("m365-inactif");
        expect(lucia.email).toBe("lucia@grrsa.ch");
        expect(lucia.jobTitle).toBeNull();
    });
    it("ne rapproche JAMAIS par le nom", () => {
        const g = indexerGraph([graphUser({ id: "g-x", mail: "autre@grrsa.ch", jobTitle: "Directeur" })]);
        const [c] = normalizeCollaborators([{ Number: "200", DisplayName: "Autre, Marc", EmailAddress: "" }], g);
        expect(c.matchState).toBe("sans-email");
        expect(c.jobTitle).toBeNull();
    });
    it("recompose un nom absent et ignore un poste vide ou en double", () => {
        const c = normalizeCollaborators([
            { Number: "300", FirstName: "Marie", LastName: "Curie", EmailAddress: "" },
            { Number: "300", DisplayName: "Doublon" },
            { Number: "", DisplayName: "Fantôme" },
        ], null);
        expect(c).toHaveLength(1);
        expect(c[0].displayName).toBe("Curie, Marie");
    });
});

describe("planCollaboratorChanges — dater, jamais réécrire", () => {
    const ligne = (partiel: Partial<OpenCollaboratorRow> & { id: string; extension: string }): OpenCollaboratorRow => ({
        displayName: "Sequeiros, Lucia", email: "lucia@grrsa.ch", jobTitle: "Gérante", graphId: "g1", matchState: "ok", ...partiel,
    });
    const actuel = (partiel: Partial<ReturnType<typeof normalizeCollaborators>[number]> & { extension: string }) => ({
        displayName: "Sequeiros, Lucia", email: "lucia@grrsa.ch", jobTitle: "Gérante", graphId: "g1", matchState: "ok" as const, ...partiel,
    });

    it("rien ne change : on revoit la ligne", () => {
        const plan = planCollaboratorChanges([ligne({ id: "a", extension: "100" })], [actuel({ extension: "100" })]);
        expect(plan).toEqual({ toClose: [], toTouch: ["a"], toOpen: [] });
    });
    it("un titre de poste change : fermeture + ouverture, le passé reste", () => {
        const plan = planCollaboratorChanges(
            [ligne({ id: "a", extension: "100" })],
            [actuel({ extension: "100", jobTitle: "Directrice" })],
        );
        expect(plan.toClose).toEqual(["a"]);
        expect(plan.toOpen.map((c) => c.jobTitle)).toEqual(["Directrice"]);
    });
    it("le poste change de titulaire : même mécanique (cas 993/139)", () => {
        const plan = planCollaboratorChanges(
            [ligne({ id: "a", extension: "139", displayName: "Robert-Charrue, X", email: "rc@grrsa.ch", graphId: "g-rc" })],
            [actuel({ extension: "139", displayName: "Thaqi, Y", email: "thaqi@grrsa.ch", graphId: "g-th" })],
        );
        expect(plan.toClose).toEqual(["a"]);
        expect(plan.toOpen[0].displayName).toBe("Thaqi, Y");
    });
    it("un poste disparu ferme sa ligne ; un nouveau poste en ouvre une", () => {
        const plan = planCollaboratorChanges(
            [ligne({ id: "a", extension: "100" })],
            [actuel({ extension: "101", displayName: "Nouveau, N", email: "n@grrsa.ch", graphId: "g-n" })],
        );
        expect(plan.toClose).toEqual(["a"]);
        expect(plan.toOpen.map((c) => c.extension)).toEqual(["101"]);
    });
    it("est idempotent : rejouer le même relevé ne produit aucun mouvement", () => {
        const snapshot = [actuel({ extension: "100" }), actuel({ extension: "101", displayName: "B", email: "b@grrsa.ch", graphId: "g-b" })];
        const ouvertes = snapshot.map((c, i) => ligne({ id: `l${i}`, ...c }));
        const plan = planCollaboratorChanges(ouvertes, snapshot);
        expect(plan.toClose).toEqual([]);
        expect(plan.toOpen).toEqual([]);
        expect(plan.toTouch).toHaveLength(2);
    });
});
