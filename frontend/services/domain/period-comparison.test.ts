import { describe, it, expect } from "vitest";
import { previousPeriod, weekAlignedPreviousPeriod, trendDirection } from "./period-comparison";

describe("previousPeriod — même durée, immédiatement avant", () => {
    it("juillet entier → une fenêtre de 31 jours se terminant le 30 juin", () => {
        const start = new Date("2026-07-01T00:00:00.000Z");
        const end = new Date("2026-07-31T23:59:59.999Z");
        const prev = previousPeriod(start, end);
        expect(prev.endDate.toISOString()).toBe("2026-06-30T23:59:59.999Z");
        // Même durée exacte que la période courante.
        expect(prev.endDate.getTime() - prev.startDate.getTime())
            .toBe(end.getTime() - start.getTime());
    });

    it("les deux périodes sont contiguës, sans chevauchement", () => {
        const start = new Date("2026-07-01T00:00:00.000Z");
        const prev = previousPeriod(start, new Date("2026-07-07T23:59:59.999Z"));
        expect(prev.endDate.getTime()).toBe(start.getTime() - 1);
    });
});

describe("weekAlignedPreviousPeriod — recul multiple de 7 jours", () => {
    it("7 jours → recul d'exactement une semaine, jours alignés", () => {
        const start = new Date("2026-07-06T00:00:00.000Z"); // lundi
        const end = new Date("2026-07-12T23:59:59.999Z");
        const prev = weekAlignedPreviousPeriod(start, end);
        expect(prev.startDate.toISOString()).toBe("2026-06-29T00:00:00.000Z"); // lundi aussi
        expect(prev.startDate.getUTCDay()).toBe(start.getUTCDay());
    });

    it("31 jours → recul de 35 jours (5 semaines), sans chevauchement", () => {
        const start = new Date("2026-07-01T00:00:00.000Z");
        const end = new Date("2026-07-31T23:59:59.999Z");
        const prev = weekAlignedPreviousPeriod(start, end);
        expect(prev.startDate.getUTCDay()).toBe(start.getUTCDay());
        expect(prev.endDate.getTime()).toBeLessThan(start.getTime());
        expect(start.getTime() - prev.startDate.getTime()).toBe(35 * 24 * 60 * 60 * 1000);
    });

    it("une seule journée → recul d'une semaine quand même", () => {
        const start = new Date("2026-08-03T00:00:00.000Z");
        const prev = weekAlignedPreviousPeriod(start, new Date("2026-08-03T23:59:59.999Z"));
        expect(prev.startDate.toISOString()).toBe("2026-07-27T00:00:00.000Z");
    });
});

describe("trendDirection — seuil d'équivalence à ±3 %", () => {
    it("les petites variations sont du bruit", () => {
        expect(trendDirection(102, 100)).toBe("flat");
        expect(trendDirection(98, 100)).toBe("flat");
    });

    it("au-delà du seuil, la direction est franche", () => {
        expect(trendDirection(104, 100)).toBe("up");
        expect(trendDirection(96, 100)).toBe("down");
        expect(trendDirection(0, 100)).toBe("down");
    });

    it("période précédente à zéro : hausse si activité, équivalent sinon", () => {
        expect(trendDirection(5, 0)).toBe("up");
        expect(trendDirection(0, 0)).toBe("flat");
    });
});
