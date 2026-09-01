import { describe, expect, it } from "vitest";
import type { HealthLevel } from "@/services/domain/queue-health";
import {
    SENS_INITIAL,
    TRI_PAR_DEFAUT,
    trierFiles,
    type FileTriable,
} from "@/services/domain/queue-sort";

interface File extends FileTriable {
    sante: HealthLevel;
}

const niveau = (q: File) => q.sante;

function file(partiel: Partial<File> & { currentName: string }): File {
    return {
        queueNumber: "900",
        department: "GRR GENEVE",
        agentCount: 0,
        lastCallAt: "2026-09-01T08:00:00Z",
        sante: "ok",
        ...partiel,
    };
}

const noms = (fs: File[]) => fs.map((f) => f.currentName);

describe("trierFiles", () => {
    it("classe par nom, du A au Z, par défaut", () => {
        const files = [file({ currentName: "Zermatt" }), file({ currentName: "Bulle" }), file({ currentName: "Nyon" })];
        expect(noms(trierFiles(files, TRI_PAR_DEFAUT, niveau))).toEqual(["Bulle", "Nyon", "Zermatt"]);
    });

    it("inverse quand on demande l'ordre décroissant", () => {
        const files = [file({ currentName: "Bulle" }), file({ currentName: "Zermatt" })];
        expect(noms(trierFiles(files, { colonne: "nom", sens: "desc" }, niveau))).toEqual(["Zermatt", "Bulle"]);
    });

    it("ignore la casse et les accents sur les noms", () => {
        const files = [file({ currentName: "gérance" }), file({ currentName: "Gerance A" })];
        expect(noms(trierFiles(files, TRI_PAR_DEFAUT, niveau))).toEqual(["gérance", "Gerance A"]);
    });

    it("ne modifie pas le tableau reçu", () => {
        const files = [file({ currentName: "Zermatt" }), file({ currentName: "Bulle" })];
        const copie = [...files];
        trierFiles(files, TRI_PAR_DEFAUT, niveau);
        expect(files).toEqual(copie);
    });

    // Les numéros sont stockés en texte : l'ordre lexical placerait 103 avant 97.
    it("classe les numéros de file comme des nombres", () => {
        const files = [
            file({ currentName: "c", queueNumber: "103" }),
            file({ currentName: "a", queueNumber: "97" }),
            file({ currentName: "b", queueNumber: "901" }),
        ];
        expect(trierFiles(files, { colonne: "numero", sens: "asc" }, niveau).map((f) => f.queueNumber)).toEqual([
            "97",
            "103",
            "901",
        ]);
    });

    it("met le plus urgent en tête quand on trie par état", () => {
        const files = [
            file({ currentName: "a", sante: "ok" }),
            file({ currentName: "b", sante: "critical" }),
            file({ currentName: "c", sante: "warning" }),
        ];
        expect(noms(trierFiles(files, { colonne: "sante", sens: "asc" }, niveau))).toEqual(["b", "c", "a"]);
    });

    it("classe les effectifs et les dates comme des nombres", () => {
        const files = [
            file({ currentName: "a", agentCount: 3 }),
            file({ currentName: "b", agentCount: 11 }),
            file({ currentName: "c", agentCount: 7 }),
        ];
        expect(trierFiles(files, { colonne: "agents", sens: "desc" }, niveau).map((f) => f.agentCount)).toEqual([
            11, 7, 3,
        ]);

        const parDate = [
            file({ currentName: "a", lastCallAt: "2026-01-01T00:00:00Z" }),
            file({ currentName: "b", lastCallAt: "2026-08-01T00:00:00Z" }),
        ];
        expect(noms(trierFiles(parDate, { colonne: "dernierAppel", sens: "desc" }, niveau))).toEqual(["b", "a"]);
    });

    // Le cœur de la règle : inverser le tri ne doit pas hisser en tête les
    // files qui n'ont rien à dire sur le critère trié.
    describe("les valeurs absentes restent au bout dans les deux sens", () => {
        const files = [
            file({ currentName: "sans", department: null }),
            file({ currentName: "avec Z", department: "ZURICH" }),
            file({ currentName: "avec A", department: "AIGLE" }),
        ];

        it("croissant", () => {
            expect(noms(trierFiles(files, { colonne: "departement", sens: "asc" }, niveau))).toEqual([
                "avec A",
                "avec Z",
                "sans",
            ]);
        });

        it("décroissant", () => {
            expect(noms(trierFiles(files, { colonne: "departement", sens: "desc" }, niveau))).toEqual([
                "avec Z",
                "avec A",
                "sans",
            ]);
        });

        it("vaut aussi pour une file sans aucun appel", () => {
            const sansAppel = [
                file({ currentName: "jamais", lastCallAt: null }),
                file({ currentName: "ancien", lastCallAt: "2026-01-01T00:00:00Z" }),
                file({ currentName: "récent", lastCallAt: "2026-08-01T00:00:00Z" }),
            ];
            expect(noms(trierFiles(sansAppel, { colonne: "dernierAppel", sens: "asc" }, niveau))).toEqual([
                "ancien",
                "récent",
                "jamais",
            ]);
            expect(noms(trierFiles(sansAppel, { colonne: "dernierAppel", sens: "desc" }, niveau))).toEqual([
                "récent",
                "ancien",
                "jamais",
            ]);
        });
    });

    // Sans départage, l'ordre à l'intérieur d'un département dépendrait de
    // l'ordre d'arrivée des lignes et changerait d'un chargement à l'autre.
    describe("à égalité, le nom départage", () => {
        const files = [
            file({ currentName: "Zermatt", department: "GRR GENEVE" }),
            file({ currentName: "Bulle", department: "GRR GENEVE" }),
            file({ currentName: "Nyon", department: "GRR GENEVE" }),
        ];

        it("dans le sens croissant", () => {
            expect(noms(trierFiles(files, { colonne: "departement", sens: "asc" }, niveau))).toEqual([
                "Bulle",
                "Nyon",
                "Zermatt",
            ]);
        });

        // Le départage n'est PAS inversé avec la colonne : à effectif égal, on
        // veut toujours lire les noms dans l'ordre.
        it("et reste alphabétique même en décroissant", () => {
            expect(noms(trierFiles(files, { colonne: "departement", sens: "desc" }, niveau))).toEqual([
                "Bulle",
                "Nyon",
                "Zermatt",
            ]);
        });
    });

    it("part du sens utile selon le type de colonne", () => {
        expect(SENS_INITIAL.nom).toBe("asc");
        expect(SENS_INITIAL.departement).toBe("asc");
        // Le plus gros effectif et l'appel le plus récent d'abord.
        expect(SENS_INITIAL.agents).toBe("desc");
        expect(SENS_INITIAL.dernierAppel).toBe("desc");
        // L'urgence d'abord.
        expect(SENS_INITIAL.sante).toBe("asc");
    });
});
