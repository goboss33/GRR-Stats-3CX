import { getAvailableServers } from "@/lib/servers";

/**
 * Déclencheur du relevé nocturne du journal d'équipe (surcouche XAPI).
 *
 * Pas de cron système : le conteneur est seul maître à bord, un réveil
 * horaire en mémoire suffit pour une cadence quotidienne. Règles :
 *  - jamais relevé → relevé immédiat (l'histoire commence tout de suite) ;
 *  - sinon, relevé au premier 3 h qui suit le dernier (cf.
 *    services/domain/journal-cadence) — avec rattrapage au réveil si le
 *    conteneur dormait à cette heure-là, puis retour à la cadence nocturne.
 *
 * L'heure est jugée à UN SEUL endroit, isSnapshotDue. Le déclencheur se
 * contente de réveiller : il portait autrefois sa propre condition d'heure,
 * qui contredisait la première et laissait la cadence dériver.
 *
 * Tolérance aux pannes : tout échec est journalisé (table XapiSnapshotRun et
 * console) et réessayé au réveil suivant. Un tenant sans surcouche est
 * simplement ignoré — ni erreur, ni bruit.
 */

const CHECK_EVERY_MS = 60 * 60 * 1000;
const FIRST_CHECK_AFTER_MS = 2 * 60 * 1000;

// Garde anti-double-enregistrement : le rechargement à chaud de next dev
// réévalue les modules, mais globalThis survit.
const FLAG = Symbol.for("grr-stats.xapi-journal-scheduler");

async function checkAndRun(): Promise<void> {
    try {
        const { isSnapshotDue, runQueueMembershipSnapshot } = await import("@/services/xapi-journal.service");
        for (const serverId of getAvailableServers()) {
            if (!await isSnapshotDue(serverId)) continue;
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
