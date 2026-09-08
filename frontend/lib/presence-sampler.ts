import { getAvailableServers } from "@/lib/servers";

/**
 * Déclencheur de l'échantillonnage de présence (surcouche XAPI).
 *
 * Même esprit que le relevé nocturne du journal d'équipe, mais à la minute :
 * un réveil en mémoire, sans cron système. Chaque réveil relève chaque tenant
 * qui l'a demandé (interrupteur presenceSamplingEnabled + XAPI utilisable) ;
 * les autres ne paient rien, pas même une ligne de log. Un réveil qui
 * trouve le précédent encore en cours (PBX lent) est simplement sauté.
 *
 * Tolérance aux pannes : tout échec est noté (PresenceSampler.lastError) et
 * réessayé à la minute suivante ; rien ne remonte jamais jusqu'aux écrans.
 */

const SAMPLE_EVERY_MS = 60 * 1000;
const FIRST_SAMPLE_AFTER_MS = 20 * 1000;

// Garde anti-double-enregistrement : le rechargement à chaud de next dev
// réévalue les modules, mais globalThis survit.
const FLAG = Symbol.for("grr-stats.presence-sampler");
const BUSY = Symbol.for("grr-stats.presence-sampler.busy");

async function tick(): Promise<void> {
    const g = globalThis as Record<symbol, unknown>;
    if (g[BUSY]) return;
    g[BUSY] = true;
    try {
        const { echantillonner } = await import("@/services/presence.service");
        for (const serverId of getAvailableServers()) {
            try {
                const r = await echantillonner(serverId);
                // Un relevé qui tourne ne parle qu'aux changements notables ;
                // l'échec, lui, se voit toujours.
                if (!r.ran && r.reason && r.reason !== "éteint" && r.reason !== "XAPI inutilisable") {
                    console.warn(`[présence] ${serverId} : relevé en échec — ${r.reason}`);
                }
            } catch (error) {
                console.error(`[présence] ${serverId} : erreur inattendue`, error);
            }
        }
    } finally {
        g[BUSY] = false;
    }
}

export function registerPresenceSampler(): void {
    const g = globalThis as Record<symbol, unknown>;
    if (g[FLAG]) return;
    g[FLAG] = true;

    setTimeout(() => void tick(), FIRST_SAMPLE_AFTER_MS).unref?.();
    setInterval(() => void tick(), SAMPLE_EVERY_MS).unref?.();
    console.log("[présence] échantillonneur armé (relevé à la minute, pour les tenants qui l'ont demandé)");
}
