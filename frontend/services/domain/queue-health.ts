// ============================================
// ÉTAT DE SANTÉ D'UNE FILE
//
// Objectif : repérer d'un coup d'œil, dans une liste de 100+ files, celles qui
// méritent l'attention — sans avoir à ouvrir chaque fiche.
//
// Deux dimensions seulement, car ce sont celles qui trahissent un vrai problème :
//   1. la file a-t-elle des agents réellement disponibles ?
//   2. reçoit-elle encore des appels ?
// ============================================

/** Seuils d'activité (en jours). */
export const AGENT_ACTIVE_DAYS = 7;
export const AGENT_STALE_DAYS = 30;
export const QUEUE_IDLE_DAYS = 7;

export type HealthLevel = "ok" | "warning" | "critical";

export interface QueueHealthInput {
    agents: { lastSeenAt: string }[];
    lastCallAt: string | null;
    status: string;
}

export interface QueueHealth {
    level: HealthLevel;
    /** Motifs, du plus grave au moins grave — sert d'infobulle. */
    reasons: string[];
    activeAgents: number;
    staleAgents: number;
    idleDays: number | null;
}

function daysSince(iso: string | null, now: number): number | null {
    if (!iso) return null;
    return (now - new Date(iso).getTime()) / (1000 * 60 * 60 * 24);
}

export function assessQueueHealth(queue: QueueHealthInput, now: number = Date.now()): QueueHealth {
    const ages = queue.agents.map((a) => daysSince(a.lastSeenAt, now) ?? Infinity);
    const activeAgents = ages.filter((d) => d < AGENT_ACTIVE_DAYS).length;
    const staleAgents = ages.filter((d) => d >= AGENT_STALE_DAYS).length;
    const idleDays = daysSince(queue.lastCallAt, now);

    const reasons: string[] = [];
    let level: HealthLevel = "ok";

    // Une file archivée n'a plus vocation à fonctionner : ne pas la signaler.
    if (queue.status === "ARCHIVED") {
        return { level: "ok", reasons: ["File archivée"], activeAgents, staleAgents, idleDays };
    }

    if (queue.agents.length === 0) {
        level = "critical";
        reasons.push("Aucun agent rattaché : les appels ne peuvent aboutir");
    } else if (activeAgents === 0) {
        level = "critical";
        reasons.push(`Aucun agent actif depuis ${AGENT_ACTIVE_DAYS} jours`);
    }

    if (idleDays === null) {
        if (level === "ok") level = "warning";
        reasons.push("Aucun appel enregistré");
    } else if (idleDays >= QUEUE_IDLE_DAYS) {
        if (level === "ok") level = "warning";
        reasons.push(`Aucun appel depuis ${Math.floor(idleDays)} jours`);
    }

    if (staleAgents > 0) {
        if (level === "ok") level = "warning";
        reasons.push(`${staleAgents} agent(s) inactif(s) depuis plus de ${AGENT_STALE_DAYS} jours`);
    }

    if (level === "ok") {
        reasons.push(`${activeAgents} agent(s) actif(s), appels récents`);
    }

    return { level, reasons, activeAgents, staleAgents, idleDays };
}
