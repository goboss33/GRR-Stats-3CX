import { describe, it, expect, vi } from "vitest";

// Le module importe le client Prisma (chargeur) : on le neutralise, seul le
// parseur pur est testé ici.
vi.mock("@/lib/prisma-auth", () => ({ prismaAuth: {} }));

import { parseExtensionRanges } from "./stats-exclusions";

describe("parseExtensionRanges — plages de postes exclus", () => {
    it("mélange numéros isolés et plages", () => {
        expect(parseExtensionRanges("260-263, 803").sort())
            .toEqual(["260", "261", "262", "263", "803"]);
    });

    it("préserve les zéros de tête à la largeur de la borne basse", () => {
        // Les extensions 3CX sont des chaînes : « 039 » n'est pas « 39 ».
        expect(parseExtensionRanges("001-003")).toEqual(["001", "002", "003"]);
    });

    it("ignore les entrées illisibles plutôt que d'échouer", () => {
        expect(parseExtensionRanges("abc, 12-xy, , 42")).toEqual(["42"]);
    });

    it("refuse les plages inversées ou déraisonnables", () => {
        expect(parseExtensionRanges("300-200")).toEqual([]);
        expect(parseExtensionRanges("0-999999")).toEqual([]);
    });

    it("déduplique", () => {
        expect(parseExtensionRanges("100, 100-101")).toEqual(["100", "101"]);
    });

    it("chaîne vide : aucune exclusion", () => {
        expect(parseExtensionRanges("")).toEqual([]);
    });
});
