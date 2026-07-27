import { describe, it, expect } from "vitest";
import {
    normalizeDigits,
    detectEntryKind,
    buildDdiVariants,
    formatDdiDisplay,
    parseSearchPattern,
    parseBulkInput,
    toSearchEntries,
    findAssociatedExtension,
    mergeTrends,
} from "./extension-search";
import type { ExtensionStats } from "@/types/extension-stats.types";

describe("normalizeDigits", () => {
    it("ne garde que les chiffres", () => {
        expect(normalizeDigits("+41 27 484 20 20")).toBe("41274842020");
        expect(normalizeDigits("abc123def")).toBe("123");
        expect(normalizeDigits("")).toBe("");
    });
});

describe("detectEntryKind", () => {
    it("détecte un pattern via le wildcard", () => {
        expect(detectEntryKind("*2020")).toBe("pattern");
    });
    it("détecte une extension (<= 6 chiffres)", () => {
        expect(detectEntryKind("2020")).toBe("extension");
        expect(detectEntryKind("123456")).toBe("extension");
    });
    it("détecte un DDI (>= 7 chiffres)", () => {
        expect(detectEntryKind("1234567")).toBe("ddi");
        expect(detectEntryKind("41274842020")).toBe("ddi");
    });
    it("traite un nom (sans chiffre) comme un pattern", () => {
        expect(detectEntryKind("Jean Dupont")).toBe("pattern");
    });
});

describe("buildDdiVariants", () => {
    it("retourne un tableau vide pour une entrée vide", () => {
        expect(buildDdiVariants("")).toEqual([]);
    });

    it("génère les formats de stockage d'un DDI international suisse", () => {
        const variants = buildDdiVariants("41274842020");
        expect(variants).toContain("41274842020");
        expect(variants).toContain("+41274842020");
        expect(variants).toContain("0041274842020");
        expect(variants).toContain("0274842020");
    });

    it("génère les variantes internationales depuis un format national (0…)", () => {
        const variants = buildDdiVariants("0274842020");
        expect(variants).toContain("0274842020");
        expect(variants).toContain("41274842020");
        expect(variants).toContain("+41274842020");
        expect(variants).toContain("0041274842020");
    });
});

describe("formatDdiDisplay", () => {
    it("formate un numéro suisse international", () => {
        expect(formatDdiDisplay("41274842020")).toBe("+41 27 484 20 20");
    });
    it("laisse inchangé ce qui ne ressemble pas à un numéro suisse", () => {
        expect(formatDdiDisplay("2020")).toBe("2020");
    });
});

describe("parseSearchPattern", () => {
    it("interprète les wildcards", () => {
        expect(parseSearchPattern("*2020*")).toEqual({ mode: "contains", value: "2020" });
        expect(parseSearchPattern("*2020")).toEqual({ mode: "endsWith", value: "2020" });
        expect(parseSearchPattern("2020*")).toEqual({ mode: "startsWith", value: "2020" });
        expect(parseSearchPattern("2020")).toEqual({ mode: "exact", value: "2020" });
    });
});

describe("parseBulkInput", () => {
    it("sépare des numéros à groupes uniformes", () => {
        expect(parseBulkInput("2020 2021 2022")).toEqual(["2020", "2021", "2022"]);
    });
    it("garde un numéro préfixé '+' comme une seule entrée", () => {
        expect(parseBulkInput("+41 27 484 20 20")).toEqual(["+41 27 484 20 20"]);
    });
    it("garde un numéro à groupes variables comme une seule entrée", () => {
        expect(parseBulkInput("027 484 20 20")).toEqual(["027 484 20 20"]);
    });
    it("gère les séparateurs multi-lignes", () => {
        expect(parseBulkInput("2020\n2021")).toEqual(["2020", "2021"]);
    });
    it("déduplique et ignore le bruit (< 2 chiffres, sans wildcard)", () => {
        expect(parseBulkInput("2020, 2020")).toEqual(["2020"]);
        expect(parseBulkInput("a")).toEqual([]);
    });
});

describe("findAssociatedExtension", () => {
    it("retourne l'extension la plus longue en suffixe du DDI", () => {
        expect(findAssociatedExtension("41274842020", ["2020", "20"])).toBe("2020");
    });
    it("retourne null si aucune extension ne correspond", () => {
        expect(findAssociatedExtension("41274842020", ["999"])).toBeNull();
    });
});

describe("toSearchEntries", () => {
    it("détecte le type et nettoie l'entrée", () => {
        expect(toSearchEntries(["2020", " Jean "])).toEqual([
            { input: "2020", kind: "extension" },
            { input: "Jean", kind: "pattern" },
        ]);
    });
});

describe("mergeTrends", () => {
    it("agrège les séries par date et trie chronologiquement", () => {
        const extensions = [
            { trend: [{ date: "2024-01-02", inbound: 1, outbound: 2 }] },
            { trend: [{ date: "2024-01-01", inbound: 3, outbound: 0 }, { date: "2024-01-02", inbound: 4, outbound: 1 }] },
        ] as unknown as ExtensionStats[];

        expect(mergeTrends(extensions)).toEqual([
            { date: "2024-01-01", inbound: 3, outbound: 0 },
            { date: "2024-01-02", inbound: 5, outbound: 3 },
        ]);
    });
});
