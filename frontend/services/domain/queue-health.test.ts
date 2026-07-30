import { describe, it, expect } from "vitest";
import { assessQueueHealth } from "./queue-health";

const NOW = new Date("2026-07-30T12:00:00Z").getTime();
const daysAgo = (d: number) => new Date(NOW - d * 24 * 60 * 60 * 1000).toISOString();

describe("assessQueueHealth", () => {
    it("est OK avec des agents actifs et des appels récents", () => {
        const h = assessQueueHealth(
            { agents: [{ lastSeenAt: daysAgo(0.5) }, { lastSeenAt: daysAgo(2) }], lastCallAt: daysAgo(0.1), status: "ACTIVE" },
            NOW,
        );
        expect(h.level).toBe("ok");
        expect(h.activeAgents).toBe(2);
    });

    it("est critique sans aucun agent rattaché", () => {
        const h = assessQueueHealth({ agents: [], lastCallAt: daysAgo(1), status: "ACTIVE" }, NOW);
        expect(h.level).toBe("critical");
        expect(h.reasons[0]).toContain("Aucun agent rattaché");
    });

    it("est critique quand plus aucun agent n'est actif", () => {
        const h = assessQueueHealth(
            { agents: [{ lastSeenAt: daysAgo(40) }, { lastSeenAt: daysAgo(60) }], lastCallAt: daysAgo(1), status: "ACTIVE" },
            NOW,
        );
        expect(h.level).toBe("critical");
        expect(h.activeAgents).toBe(0);
    });

    it("avertit quand la file ne reçoit plus d'appels", () => {
        const h = assessQueueHealth({ agents: [{ lastSeenAt: daysAgo(1) }], lastCallAt: daysAgo(20), status: "ACTIVE" }, NOW);
        expect(h.level).toBe("warning");
        expect(h.reasons.some((r) => r.includes("Aucun appel depuis"))).toBe(true);
    });

    it("avertit quand certains agents sont inactifs de longue date", () => {
        const h = assessQueueHealth(
            { agents: [{ lastSeenAt: daysAgo(1) }, { lastSeenAt: daysAgo(45) }], lastCallAt: daysAgo(0.5), status: "ACTIVE" },
            NOW,
        );
        expect(h.level).toBe("warning");
        expect(h.staleAgents).toBe(1);
    });

    it("ne signale pas une file archivée", () => {
        const h = assessQueueHealth({ agents: [], lastCallAt: daysAgo(200), status: "ARCHIVED" }, NOW);
        expect(h.level).toBe("ok");
    });

    it("le critique l'emporte sur l'avertissement", () => {
        const h = assessQueueHealth({ agents: [{ lastSeenAt: daysAgo(90) }], lastCallAt: daysAgo(60), status: "ACTIVE" }, NOW);
        expect(h.level).toBe("critical");
    });
});
