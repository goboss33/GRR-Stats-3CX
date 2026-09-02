import { describe, expect, it } from "vitest";
import { initiales, normaliserNom, resoudreLigne, type LigneJournalCollaborateur } from "./collaborator-profile";

const d = (iso: string) => new Date(iso);
const ligne = (p: Partial<LigneJournalCollaborateur> & { extension: string; displayName: string }): LigneJournalCollaborateur => ({
    email: "x@grrsa.ch", jobTitle: "Gérant", firstSeenAt: d("2026-09-02T03:00:00Z"), closedAt: null, ...p,
});
const juin = { start: d("2026-06-01T00:00:00Z"), end: d("2026-06-30T23:59:59Z") };

describe("resoudreLigne — poste + nom, jamais le poste seul", () => {
    const journal = [
        ligne({ extension: "139", displayName: "Robert-Charrue, Xavier", email: "rc@grrsa.ch", jobTitle: "Gérant", firstSeenAt: d("2026-09-02T03:00:00Z"), closedAt: d("2026-10-01T03:00:00Z") }),
        ligne({ extension: "139", displayName: "Thaqi, Yll", email: "thaqi@grrsa.ch", jobTitle: "Assistant", firstSeenAt: d("2026-10-01T03:00:00Z") }),
    ];

    it("le nom décide : la ligne de Robert-Charrue pour sa ligne du tableau…", () => {
        const l = resoudreLigne(journal, { extension: "139", name: "Robert-Charrue, Xavier" }, juin);
        expect(l?.email).toBe("rc@grrsa.ch");
    });
    it("… et celle de Thaqi pour la sienne, sur le même poste", () => {
        const l = resoudreLigne(journal, { extension: "139", name: "Thaqi, Yll" }, juin);
        expect(l?.email).toBe("thaqi@grrsa.ch");
    });
    it("un nom que le journal ne connaît pas sur ce poste ne rend RIEN", () => {
        expect(resoudreLigne(journal, { extension: "139", name: "Inconnu, Jean" }, juin)).toBeNull();
    });
    it("préfère la ligne qui recouvre la période quand la personne a changé de titre", () => {
        const j = [
            ligne({ extension: "100", displayName: "Sequeiros, Lucia", jobTitle: "Gérante", firstSeenAt: d("2026-09-02T03:00:00Z"), closedAt: d("2026-11-01T03:00:00Z") }),
            ligne({ extension: "100", displayName: "Sequeiros, Lucia", jobTitle: "Directrice", firstSeenAt: d("2026-11-01T03:00:00Z") }),
        ];
        const octobre = { start: d("2026-10-01T00:00:00Z"), end: d("2026-10-31T23:59:59Z") };
        const decembre = { start: d("2026-12-01T00:00:00Z"), end: d("2026-12-31T23:59:59Z") };
        expect(resoudreLigne(j, { extension: "100", name: "Sequeiros, Lucia" }, octobre)?.jobTitle).toBe("Gérante");
        expect(resoudreLigne(j, { extension: "100", name: "Sequeiros, Lucia" }, decembre)?.jobTitle).toBe("Directrice");
        // Période ANTÉRIEURE au journal : la plus récente fait foi, le nom concorde.
        expect(resoudreLigne(j, { extension: "100", name: "Sequeiros, Lucia" }, juin)?.jobTitle).toBe("Directrice");
    });
    it("tolère casse et espaces, pas plus", () => {
        expect(normaliserNom("  Buvelot,   Alexis ")).toBe("buvelot, alexis");
        const j = [ligne({ extension: "314", displayName: "Buvelot, Alexis" })];
        expect(resoudreLigne(j, { extension: "314", name: "BUVELOT,  Alexis" }, juin)).not.toBeNull();
        expect(resoudreLigne(j, { extension: "314", name: "Buvelot, Alexis-Marie" }, juin)).toBeNull();
    });
});

describe("initiales — prénom puis nom", () => {
    it("lit le format 3CX « Nom, Prénom »", () => {
        expect(initiales("Buvelot, Alexis")).toBe("AB");
        expect(initiales("Robert-Charrue, Xavier")).toBe("XR");
    });
    it("lit aussi « Prénom Nom », et une particule ne compte pas comme initiale", () => {
        expect(initiales("Alexis Buvelot")).toBe("AB");
        expect(initiales("Anne de la Tour")).toBe("AT");
    });
    it("un seul mot, une lettre ; du bruit, un point d'interrogation", () => {
        expect(initiales("Réception")).toBe("R");
        expect(initiales("administrateur (Virtuel Q), Evolink")).toBe("EA");
        expect(initiales("   ")).toBe("?");
        expect(initiales("123")).toBe("?");
    });
    it("respecte les lettres accentuées", () => {
        expect(initiales("Étienne, Émile")).toBe("ÉÉ");
    });
});
