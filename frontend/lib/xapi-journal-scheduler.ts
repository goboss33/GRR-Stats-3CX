import { getAvailableServers } from "@/lib/servers";

/**
 * Déclencheur du relevé nocturne du journal d'équipe (surcouche XAPI).
 *
 * Pas de cron système : le conteneur est seul maître à bord, un réveil
 * horaire en mémoire suffit pour une cadence quotidienne. Règles :
 *  - jamais relevé → relevé immédiat (l'histoire commence tout de suite) ;
 *  - sinon, relevé quand le dernier date de plus de 24 h ET qu'il est au
 *    moins 3 h du matin (heure serveur) — cadence nocturne, rattrapage
 *    automatique dans la journée si le conteneur dormait à 3 h.
 *
 * Tolérance aux pannes : tout échec est journalisé (table XapiSnapshotRun et
 * console) et réessayé au réveil suivant. Un tenant sans surcouche est
 * simplement ignoré — ni erreur, ni bruit.
 */

const CHECK_EVERY_MS = 60 * 60 * 1000;
const FIRST_CHECK_AFTER_MS = 2 * 60 * 1000;
const NIGHT_HOUR = 3;

// Garde anti-double-enregistrement : le rechargement à chaud de next dev
// réévalue les modules, mais globalThis survit.
const FLAG = Symbol.for("grr-stats.xapi-journal-scheduler");

async function checkAndRun(force = false): Promise<void> {
    try {
        const { isSnapshotDue, runQueueMembershipSnapshot } = await import("@/services/xapi-journal.service");
        for (const serverId of getAvailableServers()) {
            const due = await isSnapshotDue(serverId);
            if (!due) continue;
            const { prismaAuth } = await import("@/lib/prisma-auth");
            const hasHistory = (await prismaAuth.xapiSnapshotRun.count({ where: { serverId } })) > 0;
            // Première fois : tout de suite. Ensuite : cadence nocturne.
            if (!force && hasHistory && new Date().getHours() < NIGHT_HOUR) continue;
            const summary = await runQueueMembershipSnapshot(serverId);
            if (summary.ran) {
                console.log(`[journal-xapi] ${serverId} : ${summary.ok
                    ? `relevé ok — ${summary.members} membres, ${summary.queues} files, ${summary.changes} mouvement(s)`
                    : `relevé en échec — ${summary.reason}`}`);
            }
        }
    } catch (error) {
        console.error("[journal-xapi] réveil en échec :", error);
    }
}

export function registerXapiJournalScheduler(): void {
    const g = globalThis as Record<symbol, unknown>;
    if (g[FLAG]) return;
    g[FLAG] = true;

    setTimeout(() => void checkAndRun(), FIRST_CHECK_AFTER_MS).unref?.();
    setInterval(() => void checkAndRun(), CHECK_EVERY_MS).unref?.();
    console.log("[journal-xapi] déclencheur armé (contrôle horaire, relevé nocturne)");
}
