import { describe, it, expect } from "vitest";
import { computeTeamTotals, lossVerdict, LOSS_RATE_THRESHOLD, LOSS_RATE_WARNING_MARGIN } from "./team-totals";
import type { QueueKPIs } from "@/types/statistics.types";

// Fixture minimale : seuls les champs lus par computeTeamTotals sont
// significatifs, le reste est du remplissage de type.
const kpis = (over: Partial<QueueKPIs> = {}): QueueKPIs => ({
    callsReceived: 100, callsAnswered: 60, callsAbandoned: 20,
    abandonedBefore10s: 0, abandonedAfter10s: 20, callsShortAbandon: 5,
    callsToVoicemail: 3,
    outcomeCounts: { answered: 60, handed_off: 7, overflow: 5, voicemail: 3, short_abandon: 5, abandoned: 20 },
    callsOverflow: 5, callsHandedOff: 7, totalPassages: 0, pingPongCount: 0,
    pingPongPercentage: 0, teamDirectReceived: 50, teamDirectAnswered: 30,
    directHandedOff: 4, directOverflow: 2, directLost: 14,
    handedOffInPerformance: "success", overflowDestinations: [],
    avgWaitTimeSeconds: 0, avgTalkTimeSeconds: 0,
    ...over,
});

describe("computeTeamTotals — les formules des vignettes, partagées", () => {
    it("additionne file et directs, et forme une partition exacte", () => {
        const t = computeTeamTotals(kpis());
        expect(t.totalReceived).toBe(150);
        // Répondus = répondus fins (60+30) + transferts accomplis (7+4).
        expect(t.totalAnswered).toBe(90 + 11);
        expect(t.totalLost).toBe(28 + 14); // lost file (20+5+3) + directs
        // Débordements = débordés seuls, les transférés vivent dans Répondus.
        expect(t.totalRedirected).toBe(5 + 2);
        // Partition : répondus + perdus + débordements = reçus.
        expect(t.totalAnswered + t.totalLost + t.totalRedirected).toBe(t.totalReceived);
    });

    it("la prise en charge compte les transferts accomplis quand la règle le dit", () => {
        expect(computeTeamTotals(kpis()).performanceRate)
            .toBe(Math.round(((90 + 11) / 150) * 100));
        expect(computeTeamTotals(kpis({ handedOffInPerformance: "neutral" })).performanceRate)
            .toBe(Math.round((90 / 150) * 100));
    });

    it("la partition tient aussi quand les transferts sortent de la prise en charge", () => {
        // Règle « neutral » : les transferts forment un segment à part dans la
        // barre de répartition — la somme des segments vaut toujours les reçus.
        const t = computeTeamTotals(kpis({ handedOffInPerformance: "neutral" }));
        expect((t.totalAnswered - t.totalHandedOff) + t.totalHandedOff + t.totalRedirected + t.totalLost)
            .toBe(t.totalReceived);
    });

    it("zéro reçu : 0 % plutôt qu'une division par zéro", () => {
        const empty = kpis({
            callsReceived: 0, callsAnswered: 0, teamDirectReceived: 0, teamDirectAnswered: 0,
            callsHandedOff: 0, callsOverflow: 0, directHandedOff: 0, directOverflow: 0, directLost: 0,
            outcomeCounts: { answered: 0, handed_off: 0, overflow: 0, voicemail: 0, short_abandon: 0, abandoned: 0 },
        });
        expect(computeTeamTotals(empty).performanceRate).toBe(0);
        expect(computeTeamTotals(empty).lossRate).toBe(0);
    });
});

describe("computeTeamTotals — taux de perte", () => {
    it("perte = perdus / reçus, indépendante de la règle des transferts", () => {
        expect(computeTeamTotals(kpis()).lossRate).toBe(28); // 42 / 150
        // La règle des transferts ne bouge que la prise en charge, jamais la perte.
        expect(computeTeamTotals(kpis({ handedOffInPerformance: "neutral" })).lossRate).toBe(28);
    });
});

describe("lossVerdict — la consigne « inférieur à 30 % »", () => {
    it("sous la zone d'approche → ok", () => {
        expect(lossVerdict(0)).toBe("ok");
        expect(lossVerdict(LOSS_RATE_THRESHOLD - LOSS_RATE_WARNING_MARGIN - 1)).toBe("ok");
    });

    it("zone d'approche → warning, dès seuil − marge", () => {
        expect(lossVerdict(LOSS_RATE_THRESHOLD - LOSS_RATE_WARNING_MARGIN)).toBe("warning");
        expect(lossVerdict(LOSS_RATE_THRESHOLD - 1)).toBe("warning");
    });

    it("30 tout rond est déjà dépassé : « inférieur à 30 », pas « au plus 30 »", () => {
        expect(lossVerdict(LOSS_RATE_THRESHOLD)).toBe("over");
        expect(lossVerdict(LOSS_RATE_THRESHOLD + 1)).toBe("over");
    });
});
