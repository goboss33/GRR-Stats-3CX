import { describe, expect, it } from "vitest";
import { libelleCible, peutVoirComme } from "./vue-en-tant-que";

describe("qui peut voir en tant que qui", () => {
    const admin = { id: "a1", role: "ADMIN" };

    it("un administrateur regarde n'importe quel autre compte", () => {
        expect(peutVoirComme(admin, "u2")).toBe(true);
    });
    it("jamais lui-même, jamais sans cible", () => {
        expect(peutVoirComme(admin, "a1")).toBe(false);
        expect(peutVoirComme(admin, "")).toBe(false);
    });
    it("un modérateur ou un manager ne regarde personne", () => {
        expect(peutVoirComme({ id: "m1", role: "MODERATOR" }, "u2")).toBe(false);
        expect(peutVoirComme({ id: "g1", role: "MANAGER" }, "u2")).toBe(false);
    });
});

describe("le nom de la personne regardée", () => {
    it("prénom, nom et rôle en clair", () => {
        expect(libelleCible({ email: "yves.batardon@gerofinance.ch", role: "MANAGER", firstName: "Yves", lastName: "Batardon" }))
            .toBe("Yves Batardon (Manager)");
    });
    it("l'e-mail quand le nom manque, le code du rôle quand il est inconnu", () => {
        expect(libelleCible({ email: "x@grrsa.ch", role: "AGENT", firstName: null, lastName: " " })).toBe("x@grrsa.ch (Collaborateur)");
        expect(libelleCible({ email: "x@grrsa.ch", role: "INVITE", firstName: "A", lastName: "B" })).toBe("A B (INVITE)");
    });
});
