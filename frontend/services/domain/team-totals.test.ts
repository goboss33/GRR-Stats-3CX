import { describe, it, expect } from "vitest";
import { computeTeamTotals, performanceTone } from "./team-totals";
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

    it("zéro reçu : 0 % plutôt qu'une division par zéro", () => {
        const empty = kpis({
            callsReceived: 0, callsAnswered: 0, teamDirectReceived: 0, teamDirectAnswered: 0,
            callsHandedOff: 0, callsOverflow: 0, directHandedOff: 0, directOverflow: 0, directLost: 0,
            outcomeCounts: { answered: 0, handed_off: 0, overflow: 0, voicemail: 0, short_abandon: 0, abandoned: 0 },
        });
        expect(computeTeamTotals(empty).performanceRate).toBe(0);
    });
});

describe("performanceTone — les seuils de la barre du détail", () => {
    it("vert ≥ 80, ambre ≥ 60, rouge en dessous", () => {
        expect(performanceTone(80).dot).toBe("bg-emerald-500");
        expect(performanceTone(79).dot).toBe("bg-amber-500");
        expect(performanceTone(60).dot).toBe("bg-amber-500");
        expect(performanceTone(59).dot).toBe("bg-red-500");
    });
});
