import { describe, expect, it } from "vitest";
import { adressesCandidates, lireRevendications } from "./rattachement-compte";

describe("lecture des revendications du jeton", () => {
    it("lit oid, email et preferred_username", () => {
        expect(lireRevendications({
            oid: "dd55b899-c81a-445a-ada3-aff0636a491f",
            email: "alain.chaboudez@grrsa.ch",
            preferred_username: "alain.chaboudez@regierhone.ch",
            sub: "AAAAAAAAAAAAAAAAAAAAAIkzqFVrSaSaFHy782bbtaQ",
        })).toEqual({
            oid: "dd55b899-c81a-445a-ada3-aff0636a491f",
            email: "alain.chaboudez@grrsa.ch",
            preferredUsername: "alain.chaboudez@regierhone.ch",
        });
    });
    it("un profil absent, vide ou mal formé donne trois null", () => {
        const vide = { oid: null, email: null, preferredUsername: null };
        expect(lireRevendications(undefined)).toEqual(vide);
        expect(lireRevendications("pas un objet")).toEqual(vide);
        expect(lireRevendications({ oid: 42, email: "   ", preferred_username: null })).toEqual(vide);
    });
});

describe("adresses candidates", () => {
    const jeton = { oid: "x", email: "Alain.Chaboudez@grrsa.ch", preferredUsername: "alain.chaboudez@regierhone.ch" };

    it("l'annuaire 3CX d'abord, puis l'adresse principale, puis le nom de connexion", () => {
        expect(adressesCandidates(jeton, ["alain.chaboudez@regierhone.ch"]))
            .toEqual(["alain.chaboudez@regierhone.ch", "alain.chaboudez@grrsa.ch"]);
    });
    it("le cas du 16 septembre : sans annuaire, le nom de connexion reste un repli", () => {
        expect(adressesCandidates(jeton, [])).toEqual(["alain.chaboudez@grrsa.ch", "alain.chaboudez@regierhone.ch"]);
    });
    it("minuscules, sans doublon, sans vide ni valeur qui n'est pas une adresse", () => {
        expect(adressesCandidates(
            { oid: null, email: "Yves.Batardon@GRRSA.ch", preferredUsername: "yves.batardon@grrsa.ch" },
            [null, undefined, "", "  ", "yves.batardon@gerofinance.ch", "YVES.BATARDON@gerofinance.ch", "pas-une-adresse"],
        )).toEqual(["yves.batardon@gerofinance.ch", "yves.batardon@grrsa.ch"]);
    });
    it("rien à chercher quand le jeton ne porte aucune adresse", () => {
        expect(adressesCandidates({ oid: null, email: null, preferredUsername: null }, [])).toEqual([]);
    });
});
