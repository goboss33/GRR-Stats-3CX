import { describe, it, expect } from "vitest";
import { mergeTwinLegs } from "./call-chain";
import type { CallChainSegment } from "./call.types";

/** Segment de chaîne minimal ; seuls les champs discriminants varient. */
function seg(over: Partial<CallChainSegment> & { id: string }): CallChainSegment {
    return {
        startedAt: "2026-09-07T15:54:17.683Z",
        answeredAt: null,
        sourceNumber: "+41799362422",
        sourceName: "",
        sourceType: "provider",
        destinationNumber: "998",
        destinationName: "GRR Horaires Fermé",
        destinationType: "ivr",
        status: "missed",
        durationSeconds: 0,
        durationFormatted: "00:00",
        terminationReason: "src_participant_terminated",
        terminationReasonDetails: "",
        creationMethod: "route_to",
        creationForwardReason: "out_of_office",
        originatingCdrId: "queue-900",
        category: "ivr",
        legCallHistoryId: null,
        isMergedLeg: false,
        ...over,
    };
}

// L'appel de test du 7 septembre 2026 (00000000-01dd-3ee1-238d-2bac00000b82).
const routing = seg({ id: "r", destinationNumber: "+41219257100", destinationType: "unknown", originatingCdrId: null, creationMethod: "call_init", creationForwardReason: "none", terminationReason: "continued_in", terminationReasonDetails: "by_did", category: "routing", startedAt: "2026-09-07T15:54:17.616Z" });
const queue = seg({ id: "queue-900", destinationNumber: "900", destinationType: "queue", originatingCdrId: "r", creationMethod: "divert", creationForwardReason: "by_did", terminationReason: "continued_in", terminationReasonDetails: "out_of_office", category: "queue", startedAt: "2026-09-07T15:54:17.636Z" });
const ivrKept = seg({ id: "ivr-1", answeredAt: "2026-09-07T15:54:17.776Z", durationSeconds: 7.3, durationFormatted: "00:07" });
const ivrGhost = seg({ id: "ivr-2", startedAt: "2026-09-07T15:54:17.684Z", terminationReason: "cancelled", terminationReasonDetails: "completed_elsewhere", durationSeconds: 0.1 });

describe("mergeTwinLegs — jambes jumelles d'un routage", () => {
    it("écarte la jambe annulée jumelle et garde celle qui a décroché", () => {
        const out = mergeTwinLegs([routing, queue, ivrKept, ivrGhost]);
        expect(out.map((s) => s.id)).toEqual(["r", "queue-900", "ivr-1"]);
    });

    it("l'ordre des jambes n'importe pas", () => {
        const out = mergeTwinLegs([routing, queue, ivrGhost, ivrKept]);
        expect(out.map((s) => s.id)).toEqual(["r", "queue-900", "ivr-1"]);
    });

    it("rend le tableau d'origine quand il n'y a rien à fusionner", () => {
        const input = [routing, queue, ivrKept];
        expect(mergeTwinLegs(input)).toBe(input);
    });

    it("ne touche pas une jambe annulée sans jumelle survivante", () => {
        // Une tentative annulée seule est une information : on la montre.
        expect(mergeTwinLegs([routing, queue, ivrGhost])).toHaveLength(3);
    });

    it("ne fusionne pas deux destinations différentes", () => {
        const autre = seg({ ...ivrGhost, id: "ivr-3", destinationNumber: "999" });
        expect(mergeTwinLegs([queue, ivrKept, autre])).toHaveLength(3);
    });

    it("ne fusionne pas des jambes issues de segments d'origine différents", () => {
        const autre = seg({ ...ivrGhost, id: "ivr-3", originatingCdrId: "autre-passage" });
        expect(mergeTwinLegs([queue, ivrKept, autre])).toHaveLength(3);
    });

    it("ne fusionne pas une tentative ultérieure (au-delà de deux secondes)", () => {
        const tardive = seg({ ...ivrGhost, id: "ivr-3", startedAt: "2026-09-07T15:54:25.000Z" });
        expect(mergeTwinLegs([queue, ivrKept, tardive])).toHaveLength(3);
    });

    it("laisse les sonneries d'agents tranquilles — la frise les regroupe déjà", () => {
        const sonnerieDecrochee = seg({ id: "a1", destinationNumber: "152", destinationType: "extension", creationForwardReason: "polling", answeredAt: "2026-09-07T15:54:20.000Z" });
        const sonnerieFantome = seg({ id: "a2", destinationNumber: "152", destinationType: "extension", creationForwardReason: "polling", terminationReason: "cancelled", terminationReasonDetails: "completed_elsewhere" });
        expect(mergeTwinLegs([queue, sonnerieDecrochee, sonnerieFantome])).toHaveLength(3);
    });

    it("ne retire jamais une jambe décrochée, même jumelle d'une autre", () => {
        const deuxDecrochees = [ivrKept, seg({ ...ivrKept, id: "ivr-2b" })];
        expect(mergeTwinLegs([queue, ...deuxDecrochees])).toHaveLength(3);
    });
});
