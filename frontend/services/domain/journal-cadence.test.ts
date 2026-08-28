import { describe, expect, it } from "vitest";
import { prochainReleveApres, releveAttendu, HEURE_NOCTURNE } from "./journal-cadence";

/** Date locale lisible (les fonctions travaillent en heure locale). */
const d = (iso: string) => new Date(iso);

describe("prochainReleveApres", () => {
    it("un relevé de nuit vise le 3 h du lendemain", () => {
        expect(prochainReleveApres(d("2026-08-27T03:00:04"))).toEqual(d("2026-08-28T03:00:00"));
    });

    it("un relevé de midi vise le 3 h du lendemain", () => {
        expect(prochainReleveApres(d("2026-08-27T12:07:00"))).toEqual(d("2026-08-28T03:00:00"));
    });

    it("un relevé d'avant 3 h vise le 3 h du JOUR MÊME", () => {
        expect(prochainReleveApres(d("2026-08-27T01:30:00"))).toEqual(d("2026-08-27T03:00:00"));
    });

    it("3 h pile compte comme déjà fait : la cible passe au lendemain", () => {
        expect(prochainReleveApres(d("2026-08-27T03:00:00"))).toEqual(d("2026-08-28T03:00:00"));
    });

    it("franchit le mois", () => {
        expect(prochainReleveApres(d("2026-08-31T22:00:00"))).toEqual(d("2026-09-01T03:00:00"));
    });
});

describe("releveAttendu", () => {
    it("jamais relevé : tout de suite, sans attendre la nuit", () => {
        expect(releveAttendu(null, d("2026-08-27T14:00:00"))).toBe(true);
    });

    it("relevé de la nuit dernière : rien à faire dans la journée", () => {
        expect(releveAttendu(d("2026-08-27T03:00:02"), d("2026-08-27T11:00:00"))).toBe(false);
        expect(releveAttendu(d("2026-08-27T03:00:02"), d("2026-08-27T23:59:00"))).toBe(false);
    });

    it("la nuit suivante, le relevé est attendu", () => {
        expect(releveAttendu(d("2026-08-27T03:00:02"), d("2026-08-28T03:00:00"))).toBe(true);
    });

    it("LE DÉFAUT CORRIGÉ : un relevé de midi ne verrouille plus la cadence à midi", () => {
        const midi = d("2026-08-27T12:07:00");
        // Le lendemain à midi, l'ancienne règle (« plus de 24 h ») aurait
        // relancé — et fixé la cadence à midi pour toujours.
        expect(releveAttendu(midi, d("2026-08-28T12:08:00"))).toBe(true);
        // La nouvelle règle a déjà relevé à 3 h ce jour-là.
        expect(releveAttendu(midi, d("2026-08-28T03:00:00"))).toBe(true);
    });

    it("retour à la nuit après un rattrapage de journée", () => {
        // Conteneur réveillé à 11 h 40 : il rattrape…
        const rattrapage = d("2026-08-26T11:40:00");
        // …et dès le lendemain 3 h, la cadence est de nouveau nocturne.
        expect(releveAttendu(rattrapage, d("2026-08-27T02:59:00"))).toBe(false);
        expect(releveAttendu(rattrapage, d("2026-08-27T03:00:00"))).toBe(true);
    });

    it("conteneur endormi toute la nuit : rattrapage au réveil", () => {
        const veille = d("2026-08-26T03:00:01");
        // Réveil à 9 h : la cible (27.08 à 3 h) est dépassée.
        expect(releveAttendu(veille, d("2026-08-27T09:00:00"))).toBe(true);
    });

    it("l'heure visée est bien 3 h", () => {
        expect(HEURE_NOCTURNE).toBe(3);
    });
});
