import { describe, it, expect } from "vitest";
import {
    DROITS_PAR_DEFAUT,
    DROITS_PAR_DEFAUT_LIBELLES,
    LIBELLES_ROLE_COMPTE,
    ROLES_COMPTE,
    motifBlocage,
    normaliserEmail,
    separerNom,
} from "./compte-collaborateur";

describe("préparer le compte — les droits par défaut", () => {
    it("sont ceux arbitrés le 11 septembre 2026, restrictifs sauf les numéros complets", () => {
        expect(DROITS_PAR_DEFAUT).toEqual({
            canViewLogs: false,
            canViewExtensionStats: false,
            canViewFullPhoneNumbers: true,
            canCreateApiKeys: false,
            agentRatiosLevel: "totals",
        });
    });
    it("s'énoncent en six lignes, une par droit plus le périmètre", () => {
        expect(DROITS_PAR_DEFAUT_LIBELLES).toHaveLength(6);
    });
    it("ne proposent que deux natures de compte, jamais administrateur ni modérateur", () => {
        expect(ROLES_COMPTE).toEqual(["MANAGER", "AGENT"]);
        expect(LIBELLES_ROLE_COMPTE.AGENT).toBe("Collaborateur");
    });
});

describe("e-mail et nom", () => {
    it("normalise l'e-mail en minuscules, sans espaces autour", () => {
        expect(normaliserEmail("  Geoffrey.Bossens@GRRSA.ch ")).toBe("geoffrey.bossens@grrsa.ch");
    });
    it("sépare « Nom, Prénom » du 3CX ; sans virgule, tout est le nom", () => {
        expect(separerNom("Bossens, Geoffrey")).toEqual({ lastName: "Bossens", firstName: "Geoffrey" });
        expect(separerNom("Van Hove, Noémie")).toEqual({ lastName: "Van Hove", firstName: "Noémie" });
        expect(separerNom("Réception Pully")).toEqual({ lastName: "Réception Pully", firstName: null });
        expect(separerNom("  ")).toEqual({ lastName: null, firstName: null });
        expect(separerNom("Libre,")).toEqual({ lastName: "Libre", firstName: null });
    });
});

describe("motif de blocage", () => {
    it("un compte existant prime, puis l'e-mail manquant, puis le rapprochement", () => {
        expect(motifBlocage({ email: null, matchState: "sans-email", compteExistant: true })).toMatch(/existe déjà/);
        expect(motifBlocage({ email: null, matchState: "sans-email", compteExistant: false })).toMatch(/pas d'e-mail/);
        expect(motifBlocage({ email: "a@b.ch", matchState: "inconnu-m365", compteExistant: false })).toMatch(/pas rapproché/);
        expect(motifBlocage({ email: "a@b.ch", matchState: "compte-desactive", compteExistant: false })).toMatch(/pas rapproché/);
    });
    it("rien ne bloque un poste rapproché sans compte", () => {
        expect(motifBlocage({ email: "a@b.ch", matchState: "ok", compteExistant: false })).toBeNull();
    });
});
