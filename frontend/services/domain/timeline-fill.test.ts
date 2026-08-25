import { describe, expect, it } from "vitest";
import { enumerateWallBuckets, wallClockMs } from "./timeline-fill";

const TZ = "Europe/Zurich";

describe("wallClockMs", () => {
    it("encode les composantes locales en UTC (été, UTC+2)", () => {
        // 1er juillet 2026 00:00 à Zurich = 30 juin 22:00Z
        const instant = new Date("2026-06-30T22:00:00.000Z");
        expect(wallClockMs(instant, TZ)).toBe(Date.UTC(2026, 6, 1, 0, 0, 0, 0));
    });

    it("encode les composantes locales en UTC (hiver, UTC+1)", () => {
        // 15 janvier 2026 09:30 à Zurich = 08:30Z
        const instant = new Date("2026-01-15T08:30:00.000Z");
        expect(wallClockMs(instant, TZ)).toBe(Date.UTC(2026, 0, 15, 9, 30, 0, 0));
    });

    it("minuit local ne devient jamais « 24 h »", () => {
        const instant = new Date("2026-01-14T23:00:00.000Z"); // minuit local
        expect(wallClockMs(instant, TZ)).toBe(Date.UTC(2026, 0, 15, 0, 0, 0, 0));
    });
});

describe("enumerateWallBuckets — jours", () => {
    it("un mois complet donne un seau par jour calendaire, week-ends compris", () => {
        // Juillet 2026, bornes locales [1er 00:00, 31 23:59:59.999]
        const start = new Date("2026-06-30T22:00:00.000Z");
        const end = new Date("2026-07-31T21:59:59.999Z");
        const buckets = enumerateWallBuckets(start, end, TZ, "day");
        expect(buckets).toHaveLength(31);
        expect(buckets[0]).toBe(Date.UTC(2026, 6, 1));
        expect(buckets[30]).toBe(Date.UTC(2026, 6, 31));
        // les seaux sont consécutifs : aucun trou possible sur l'axe
        for (let i = 1; i < buckets.length; i++) {
            expect(buckets[i] - buckets[i - 1]).toBe(86_400_000);
        }
    });

    it("une borne de fin EXCLUSIVE (minuit pile) n'ajoute pas de jour fantôme", () => {
        const start = new Date("2026-06-30T22:00:00.000Z"); // 1er juillet 00:00 local
        const end = new Date("2026-07-31T22:00:00.000Z"); // 1er août 00:00 local
        const buckets = enumerateWallBuckets(start, end, TZ, "day");
        expect(buckets).toHaveLength(31);
        expect(buckets[30]).toBe(Date.UTC(2026, 6, 31));
    });

    it("le passage à l'heure d'été (29 mars 2026, jour de 23 h) ne saute aucun jour", () => {
        const start = new Date("2026-03-27T23:00:00.000Z"); // 28 mars 00:00 local (UTC+1)
        const end = new Date("2026-03-30T21:59:59.999Z"); // 30 mars 23:59:59 local (UTC+2)
        const buckets = enumerateWallBuckets(start, end, TZ, "day");
        expect(buckets).toEqual([Date.UTC(2026, 2, 28), Date.UTC(2026, 2, 29), Date.UTC(2026, 2, 30)]);
    });

    it("le passage à l'heure d'hiver (25 octobre 2026, jour de 25 h) ne double aucun jour", () => {
        const start = new Date("2026-10-23T22:00:00.000Z"); // 24 octobre 00:00 local (UTC+2)
        const end = new Date("2026-10-26T22:59:59.999Z"); // 26 octobre 23:59:59 local (UTC+1)
        const buckets = enumerateWallBuckets(start, end, TZ, "day");
        expect(buckets).toEqual([Date.UTC(2026, 9, 24), Date.UTC(2026, 9, 25), Date.UTC(2026, 9, 26)]);
    });

    it("un début en cours de journée est tronqué à SON jour", () => {
        const start = new Date("2026-07-15T12:30:00.000Z"); // 15 juillet 14:30 local
        const end = new Date("2026-07-17T21:59:59.999Z");
        const buckets = enumerateWallBuckets(start, end, TZ, "day");
        expect(buckets[0]).toBe(Date.UTC(2026, 6, 15));
        expect(buckets).toHaveLength(3);
    });
});

describe("enumerateWallBuckets — heures", () => {
    it("une journée locale complète donne 24 seaux", () => {
        const start = new Date("2026-06-30T22:00:00.000Z"); // 1er juillet 00:00 local
        const end = new Date("2026-07-01T22:00:00.000Z"); // 2 juillet 00:00 local
        const buckets = enumerateWallBuckets(start, end, TZ, "hour");
        expect(buckets).toHaveLength(24);
        expect(buckets[0]).toBe(Date.UTC(2026, 6, 1, 0));
        expect(buckets[23]).toBe(Date.UTC(2026, 6, 1, 23));
    });

    it("un début en cours d'heure est tronqué à SON heure", () => {
        const start = new Date("2026-07-01T08:25:00.000Z"); // 10:25 local
        const end = new Date("2026-07-01T10:00:00.000Z"); // 12:00 local
        const buckets = enumerateWallBuckets(start, end, TZ, "hour");
        expect(buckets).toEqual([Date.UTC(2026, 6, 1, 10), Date.UTC(2026, 6, 1, 11)]);
    });
});

describe("enumerateWallBuckets — garde-fous", () => {
    it("fenêtre inversée : aucun seau", () => {
        const start = new Date("2026-07-10T00:00:00.000Z");
        const end = new Date("2026-07-01T00:00:00.000Z");
        expect(enumerateWallBuckets(start, end, TZ, "day")).toHaveLength(0);
    });

    it("fenêtre aberrante : plafonnée, jamais de boucle démesurée", () => {
        const start = new Date("1970-01-01T00:00:00.000Z");
        const end = new Date("2070-01-01T00:00:00.000Z");
        expect(enumerateWallBuckets(start, end, TZ, "day").length).toBe(3000);
    });
});
