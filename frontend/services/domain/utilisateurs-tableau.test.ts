import { describe, it, expect } from "vitest";
import {
    CATALOGUE_COLONNES,
    FILTRES_DES_VUES,
    colonnesParDefaut,
    lireColonnesMemorisees,
    nomAffichable,
    vueDepuisFiltres,
} from "./utilisateurs-tableau";

describe("catalogue des colonnes", () => {
    it("les colonnes fixes sont dans le défaut, et le défaut tient en peu de colonnes", () => {
        const defaut = colonnesParDefaut();
        for (const c of CATALOGUE_COLONNES) if (c.fixe) expect(defaut.has(c.cle)).toBe(true);
        expect(defaut.has("poste")).toBe(true);
        expect(defaut.has("email")).toBe(false);
        expect(defaut.size).toBeLessThanOrEqual(6);
    });
    it("un choix mémorisé est relu, une clé inconnue ignorée, une colonne fixe toujours rajoutée", () => {
        const lu = lireColonnesMemorisees(JSON.stringify(["email", "poste", "inconnue"]));
        expect(lu.has("email")).toBe(true);
        expect(lu.has("poste")).toBe(true);
        expect(lu.has("inconnue" as never)).toBe(false);
        expect(lu.has("collaborateur")).toBe(true);
        expect(lu.has("actions")).toBe(true);
    });
    it("un texte illisible ou absent rend le défaut", () => {
        expect(lireColonnesMemorisees("{pas du json")).toEqual(colonnesParDefaut());
        expect(lireColonnesMemorisees(null)).toEqual(colonnesParDefaut());
        expect(lireColonnesMemorisees(JSON.stringify({ a: 1 }))).toEqual(colonnesParDefaut());
    });
});

describe("vues rapides", () => {
    it("retrouve la vue depuis les filtres, et null quand ils sont composés à la main", () => {
        expect(vueDepuisFiltres(new Set(["existant"]), new Set())).toBe("comptes");
        expect(vueDepuisFiltres(new Set(["a-preparer"]), new Set(["en-equipe"]))).toBe("a-preparer");
        expect(vueDepuisFiltres(new Set(), new Set())).toBe("tous");
        expect(vueDepuisFiltres(new Set(["existant", "a-preparer"]), new Set())).toBeNull();
        expect(vueDepuisFiltres(new Set(["a-preparer"]), new Set())).toBeNull();
    });
    it("la vue « comptes » n'exclut pas les comptes sans poste : aucun filtre d'équipe", () => {
        expect(FILTRES_DES_VUES.comptes.equipe).toEqual([]);
    });
});

describe("nom affichable d'un compte", () => {
    it("« Nom, Prénom », sinon ce qu'on a, sinon l'e-mail", () => {
        expect(nomAffichable({ firstName: "Geoffrey", lastName: "Bossens", email: "g@x.ch" })).toBe("Bossens, Geoffrey");
        expect(nomAffichable({ firstName: null, lastName: "Bossens", email: "g@x.ch" })).toBe("Bossens");
        expect(nomAffichable({ firstName: " ", lastName: null, email: "g@x.ch" })).toBe("g@x.ch");
    });
});
