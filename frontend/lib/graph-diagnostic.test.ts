import { describe, expect, it } from "vitest";
import {
    decoderRoles,
    diagnostiquerRoles,
    etatSecret,
    expliquerErreurJeton,
    normaliserClientId,
    normaliserTenantId,
} from "./graph-diagnostic";

const GUID = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";

describe("normaliserTenantId — l'ID de l'annuaire", () => {
    it("accepte un GUID, quelle que soit la casse, espaces compris", () => {
        expect(normaliserTenantId(`  ${GUID.toUpperCase()}  `)).toBe(GUID);
    });
    it("accepte un domaine vérifié du tenant", () => {
        expect(normaliserTenantId("Contoso.onmicrosoft.com")).toBe("contoso.onmicrosoft.com");
    });
    it("refuse le vide et le n'importe quoi", () => {
        expect(normaliserTenantId("")).toBeNull();
        expect(normaliserTenantId("mon tenant")).toBeNull();
        expect(normaliserTenantId("https://login.microsoftonline.com/x")).toBeNull();
    });
});

describe("normaliserClientId — l'ID d'application", () => {
    it("n'accepte qu'un GUID", () => {
        expect(normaliserClientId(GUID)).toBe(GUID);
        expect(normaliserClientId("contoso.onmicrosoft.com")).toBeNull();
        expect(normaliserClientId("")).toBeNull();
    });
});

describe("expliquerErreurJeton — dire quoi faire", () => {
    it("reconnaît le secret expiré, le cas qu'on attend tous les 24 mois", () => {
        expect(expliquerErreurJeton([7000222], "AADSTS7000222: The provided client secret keys are expired.")).toMatch(/EXPIRÉ/);
    });
    it("distingue la mauvaise valeur collée", () => {
        expect(expliquerErreurJeton([7000215], null)).toMatch(/Valeur/);
    });
    it("distingue l'application introuvable de l'annuaire introuvable", () => {
        expect(expliquerErreurJeton([700016], null)).toMatch(/Application introuvable/);
        expect(expliquerErreurJeton([90002], null)).toMatch(/Annuaire introuvable/);
    });
    it("garde le code brut quand il ne connaît pas la cause", () => {
        expect(expliquerErreurJeton([123456], null)).toMatch(/code 123456/);
    });
    it("ne recopie que la première ligne de la description, bornée", () => {
        const longue = "AADSTS7000222: " + "x".repeat(500) + "\nTrace ID: abc";
        const phrase = expliquerErreurJeton([7000222], longue);
        expect(phrase).not.toMatch(/Trace ID/);
        expect(phrase.length).toBeLessThan(320);
    });
});

describe("diagnostiquerRoles — ce que le jeton porte vraiment", () => {
    it("tout est là", () => {
        expect(diagnostiquerRoles(["User.Read.All", "ProfilePhoto.Read.All"]).manquants).toEqual([]);
    });
    it("ReadBasic ne compte pas : il manque le titre de poste", () => {
        const d = diagnostiquerRoles(["User.ReadBasic.All", "ProfilePhoto.Read.All"]);
        expect(d.manquants).toEqual(["User.Read.All"]);
        expect(d.accordes).toEqual(["ProfilePhoto.Read.All"]);
    });
    it("aucun rôle = consentement pas accordé : tout manque", () => {
        expect(diagnostiquerRoles([]).manquants).toEqual(["User.Read.All", "ProfilePhoto.Read.All"]);
    });
});

describe("decoderRoles — lecture du claim sans vérification", () => {
    const jeton = (payload: object) =>
        `${btoa("{}")}.${btoa(JSON.stringify(payload)).replace(/=+$/, "")}.sig`;

    it("lit les rôles d'un jeton d'application", () => {
        expect(decoderRoles(jeton({ roles: ["User.Read.All", "ProfilePhoto.Read.All"] }))).toEqual([
            "User.Read.All",
            "ProfilePhoto.Read.All",
        ]);
    });
    it("rend vide sans claim, et ne plante jamais sur un jeton malformé", () => {
        expect(decoderRoles(jeton({ aud: "graph" }))).toEqual([]);
        expect(decoderRoles("pas.un.jwt.valide")).toEqual([]);
        expect(decoderRoles("")).toEqual([]);
    });
});

describe("etatSecret — prévenir avant que ça casse", () => {
    const maintenant = new Date("2026-09-01T12:00:00Z");

    it("inconnu quand rien n'est déclaré ou que la date est illisible", () => {
        expect(etatSecret(null, maintenant).etat).toBe("inconnu");
        expect(etatSecret("pas une date", maintenant).etat).toBe("inconnu");
    });
    it("valide loin de l'échéance", () => {
        const e = etatSecret("2028-08-31T00:00:00Z", maintenant);
        expect(e.etat).toBe("valide");
        expect(e.joursRestants).toBeGreaterThan(700);
    });
    it("prévient un mois avant, jour près", () => {
        expect(etatSecret("2026-09-25T00:00:00Z", maintenant)).toEqual({ etat: "bientot", joursRestants: 24 });
        expect(etatSecret("2026-10-01T12:00:00Z", maintenant)).toEqual({ etat: "bientot", joursRestants: 30 });
        expect(etatSecret("2026-10-02T12:00:00Z", maintenant).etat).toBe("valide");
    });
    it("expiré une fois la date passée", () => {
        expect(etatSecret("2026-08-30T00:00:00Z", maintenant).etat).toBe("expire");
    });
    it("accepte une Date aussi bien qu'une chaîne", () => {
        expect(etatSecret(new Date("2026-08-01T00:00:00Z"), maintenant).etat).toBe("expire");
    });
});
