import { describe, it, expect } from "vitest";
import {
    CATALOGUE_COLONNES,
    FILTRES_DES_VUES,
    colonnesParDefaut,
    derniereActivite,
    lireColonnesMemorisees,
    nomAffichable,
    valeurTriCompte,
    vueDepuisFiltres,
} from "./utilisateurs-tableau";
import { basculerTri, trierLignes, type DefinitionColonne } from "./tri-tableau";

describe("la colonne Compte se trie par date de connexion", () => {
    type Ligne = { nom: string; compte: { lastSeenAt: string | null; lastLoginAt: string | null } | null };
    const lignes: Ligne[] = [
        { nom: "Sans compte", compte: null },
        { nom: "Jamais B", compte: { lastSeenAt: null, lastLoginAt: null } },
        { nom: "Ce matin", compte: { lastSeenAt: "2026-09-17T07:30:00Z", lastLoginAt: "2026-09-16T12:44:00Z" } },
        { nom: "Jamais A", compte: { lastSeenAt: null, lastLoginAt: null } },
        { nom: "En août", compte: { lastSeenAt: null, lastLoginAt: "2026-08-18T08:21:00Z" } },
    ];
    const colonnes: Record<"compte", DefinitionColonne<Ligne>> = { compte: { type: "date", valeur: (l) => valeurTriCompte(l.compte) } };
    const trier = (sens: "asc" | "desc") => trierLignes(lignes, { colonne: "compte", sens }, colonnes, (l) => l.nom).map((l) => l.nom);

    it("la date affichée est l'activité, à défaut l'authentification", () => {
        expect(derniereActivite({ lastSeenAt: "2026-09-17T07:30:00Z", lastLoginAt: "2026-09-16T12:44:00Z" })).toBe("2026-09-17T07:30:00Z");
        expect(derniereActivite({ lastSeenAt: null, lastLoginAt: "2026-08-18T08:21:00Z" })).toBe("2026-08-18T08:21:00Z");
        expect(derniereActivite({ lastSeenAt: null, lastLoginAt: null })).toBeNull();
    });
    it("premier clic : les plus récents d'abord, les jamais connectés ensuite, les lignes sans compte au bout", () => {
        expect(basculerTri({ colonne: "autre" as "compte", sens: "asc" }, "compte", colonnes).sens).toBe("desc");
        expect(trier("desc")).toEqual(["Ce matin", "En août", "Jamais A", "Jamais B", "Sans compte"]);
    });
    it("second clic : les jamais connectés en tête, puis les plus anciens ; les lignes sans compte toujours au bout", () => {
        expect(trier("asc")).toEqual(["Jamais A", "Jamais B", "En août", "Ce matin", "Sans compte"]);
    });
});

describe("catalogue des colonnes", () => {
    it("les colonnes fixes sont dans le défaut, et le défaut tient en peu de colonnes", () => {
        const defaut = colonnesParDefaut();
        for (const c of CATALOGUE_COLONNES) if (c.fixe) expect(defaut.has(c.cle)).toBe(true);
        // Arbitrage du 11 sept. 2026 : compte, e-mail, périmètre — pas le poste ni les équipes.
        expect([...defaut].sort()).toEqual(["actions", "collaborateur", "compte", "email", "perimetre"]);
        expect(CATALOGUE_COLONNES.some((c) => (c.cle as string) === "activite")).toBe(false);
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
