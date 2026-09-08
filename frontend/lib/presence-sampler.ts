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

/**
 * Dernier motif d'échec ANNONCÉ, par tenant : un relevé qui tourne à la
 * minute ne doit pas noyer les logs du conteneur. Une base injoignable
 * pendant une heure écrit UNE ligne, pas soixante traces de pile — et le
 * retour à la normale s'annonce une fois.
 */
const dernierMotif = new Map<string, string | null>();

/** Message d'erreur sur UNE ligne, borné — les traces Prisma font 25 lignes. */
function bref(erreur: unknown): string {
    const texte = erreur instanceof Error ? erreur.message : String(erreur);
    return texte.replace(/\s+/g, " ").trim().slice(0, 200);
}

function signaler(serverId: string, motif: string | null): void {
    const avant = dernierMotif.get(serverId) ?? null;
    if (motif === avant) return;
    dernierMotif.set(serverId, motif);
    if (motif) console.warn(`[présence] ${serverId} : relevé en échec — ${motif}`);
    else console.log(`[présence] ${serverId} : relevé rétabli`);
}

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
                // Éteint ou sans XAPI : un silence complet, pas même une
                // remise à zéro du motif — ce tenant ne relève rien.
                if (r.reason === "éteint" || r.reason === "XAPI inutilisable") continue;
                signaler(serverId, r.ran ? null : (r.reason ?? "motif inconnu"));
            } catch (error) {
                // Base d'authentification injoignable, par exemple : une seule
                // ligne, sur une seule ligne, tant que le motif ne change pas.
                signaler(serverId, bref(error));
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
