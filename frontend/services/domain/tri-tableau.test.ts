import { describe, expect, it } from "vitest";
import { basculerTri, sensInitial, trierLignes, type DefinitionColonne } from "./tri-tableau";

interface L { nom: string; poste: string | null; equipes: number; depuis: string | null }
type K = "nom" | "poste" | "equipes" | "depuis";
const colonnes: Record<K, DefinitionColonne<L>> = {
    nom: { type: "texte", valeur: (l) => l.nom },
    poste: { type: "texte", valeur: (l) => l.poste },
    equipes: { type: "nombre", valeur: (l) => l.equipes },
    depuis: { type: "date", valeur: (l) => l.depuis },
};
const nom = (l: L) => l.nom;
const noms = (ls: L[]) => ls.map((l) => l.nom);
const l = (p: Partial<L> & { nom: string }): L => ({ poste: "100", equipes: 1, depuis: "2026-09-02T00:00:00Z", ...p });

describe("trierLignes — les règles du registre, pour tous les tableaux", () => {
    it("texte : A→Z, casse et accents ignorés, numéros de poste classés comme des nombres", () => {
        const ls = [l({ nom: "b", poste: "103" }), l({ nom: "a", poste: "97" }), l({ nom: "c", poste: "1000" })];
        expect(trierLignes(ls, { colonne: "poste", sens: "asc" }, colonnes, nom).map((x) => x.poste)).toEqual(["97", "103", "1000"]);
        expect(noms(trierLignes([l({ nom: "élise" }), l({ nom: "Emile" }), l({ nom: "Zoé" })], { colonne: "nom", sens: "asc" }, colonnes, nom))).toEqual(["élise", "Emile", "Zoé"]);
    });
    it("nombre et date : décroissant inverse bien", () => {
        const ls = [l({ nom: "a", equipes: 1 }), l({ nom: "b", equipes: 5 }), l({ nom: "c", equipes: 3 })];
        expect(noms(trierLignes(ls, { colonne: "equipes", sens: "desc" }, colonnes, nom))).toEqual(["b", "c", "a"]);
        const d = [l({ nom: "vieux", depuis: "2026-01-01T00:00:00Z" }), l({ nom: "récent", depuis: "2026-08-01T00:00:00Z" })];
        expect(noms(trierLignes(d, { colonne: "depuis", sens: "desc" }, colonnes, nom))).toEqual(["récent", "vieux"]);
    });
    it("les absents restent au bout dans les deux sens", () => {
        const ls = [l({ nom: "sans", poste: null }), l({ nom: "z", poste: "900" }), l({ nom: "a", poste: "100" })];
        expect(noms(trierLignes(ls, { colonne: "poste", sens: "asc" }, colonnes, nom))).toEqual(["a", "z", "sans"]);
        expect(noms(trierLignes(ls, { colonne: "poste", sens: "desc" }, colonnes, nom))).toEqual(["z", "a", "sans"]);
    });
    it("à égalité, le départage reste alphabétique, même en décroissant", () => {
        const ls = [l({ nom: "Zed", equipes: 2 }), l({ nom: "Ana", equipes: 2 }), l({ nom: "Mia", equipes: 2 })];
        expect(noms(trierLignes(ls, { colonne: "equipes", sens: "desc" }, colonnes, nom))).toEqual(["Ana", "Mia", "Zed"]);
    });
    it("ne modifie pas le tableau reçu", () => {
        const ls = [l({ nom: "b" }), l({ nom: "a" })];
        const copie = [...ls];
        trierLignes(ls, { colonne: "nom", sens: "asc" }, colonnes, nom);
        expect(ls).toEqual(copie);
    });
});

describe("basculerTri — un clic trie, un second inverse", () => {
    it("part du sens utile de la colonne", () => {
        expect(sensInitial("texte")).toBe("asc");
        expect(sensInitial("nombre")).toBe("desc");
        expect(sensInitial("date")).toBe("desc");
        expect(basculerTri({ colonne: "nom", sens: "asc" }, "equipes", colonnes)).toEqual({ colonne: "equipes", sens: "desc" });
    });
    it("inverse quand on reclique", () => {
        expect(basculerTri({ colonne: "nom", sens: "asc" }, "nom", colonnes)).toEqual({ colonne: "nom", sens: "desc" });
    });
});
