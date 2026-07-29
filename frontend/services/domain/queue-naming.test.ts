import { describe, it, expect } from "vitest";
import { parseQueueName, normalizeRegion } from "./queue-naming";

describe("normalizeRegion", () => {
    it("uniformise casse et accents", () => {
        expect(normalizeRegion("Genève")).toBe("GENEVE");
        expect(normalizeRegion("GENEVE")).toBe("GENEVE");
        expect(normalizeRegion(" pully ")).toBe("PULLY");
    });
});

describe("parseQueueName", () => {
    it("découpe la forme standard [ENTITÉ] [RÉGION] [SERVICE]", () => {
        expect(parseQueueName("RC BULLE Gérance")).toEqual({
            entity: "RC",
            region: "BULLE",
            service: "Gérance",
        });
    });

    it("conserve un service en plusieurs mots", () => {
        expect(parseQueueName("GRR GENEVE Gérance (Bureau 513)")).toEqual({
            entity: "GRR",
            region: "GENEVE",
            service: "Gérance (Bureau 513)",
        });
    });

    it("reconnaît une région accentuée ou en minuscules", () => {
        expect(parseQueueName("RR Genève Service Client").region).toBe("GENEVE");
        expect(parseQueueName("RC Pully Gérance").region).toBe("PULLY");
    });

    it("ne devine PAS de région quand aucune n'est reconnue", () => {
        // « Direction » n'est pas une région : mieux vaut ne rien proposer.
        expect(parseQueueName("GRR Direction")).toEqual({
            entity: "GRR",
            region: null,
            service: "Direction",
        });
        expect(parseQueueName("BS Ventes").region).toBeNull();
    });

    it("gère les régions composées", () => {
        expect(parseQueueName("RC CRANS-MONTANA Gérance").region).toBe("CRANS-MONTANA");
    });

    it("gère une file sans service", () => {
        expect(parseQueueName("GD COPPET")).toEqual({
            entity: "GD",
            region: "COPPET",
            service: null,
        });
    });

    it("gère les entrées vides ou nulles", () => {
        expect(parseQueueName(null)).toEqual({ entity: null, region: null, service: null });
        expect(parseQueueName("   ")).toEqual({ entity: null, region: null, service: null });
    });

    it("gère un nom d'un seul mot", () => {
        expect(parseQueueName("Groupe")).toEqual({ entity: null, region: null, service: "Groupe" });
    });
});
