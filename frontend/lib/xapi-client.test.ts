import { describe, it, expect } from "vitest";
import { normalizeXapiBaseUrl } from "./xapi-client";

describe("normalizeXapiBaseUrl — l'adresse du PBX", () => {
    it("garde une adresse correcte, port compris", () => {
        expect(normalizeXapiBaseUrl("https://gerofinance.3cx.ch:5001")).toBe("https://gerofinance.3cx.ch:5001");
    });

    it("rattrape la faute de frappe « /5001 » au lieu de « :5001 »", () => {
        // Cas réellement rencontré : un chemin résiduel se retrouverait collé
        // devant /connect/token et tous les appels échoueraient.
        expect(normalizeXapiBaseUrl("https://gerofinance.3cx.ch/5001")).toBe("https://gerofinance.3cx.ch");
    });

    it("retire la barre oblique finale et tout chemin", () => {
        expect(normalizeXapiBaseUrl("https://pbx.exemple.ch:5001/")).toBe("https://pbx.exemple.ch:5001");
        expect(normalizeXapiBaseUrl("https://pbx.exemple.ch:5001/xapi/v1/Users")).toBe("https://pbx.exemple.ch:5001");
    });

    it("tolère les espaces autour", () => {
        expect(normalizeXapiBaseUrl("  https://pbx.exemple.ch:5001  ")).toBe("https://pbx.exemple.ch:5001");
    });

    it("refuse le HTTP en clair : on y envoie un credential", () => {
        expect(normalizeXapiBaseUrl("http://pbx.exemple.ch:5001")).toBeNull();
    });

    it("refuse ce qui n'est pas une URL", () => {
        expect(normalizeXapiBaseUrl("gerofinance.3cx.ch:5001")).toBeNull();
        expect(normalizeXapiBaseUrl("")).toBeNull();
        expect(normalizeXapiBaseUrl("   ")).toBeNull();
    });
});
