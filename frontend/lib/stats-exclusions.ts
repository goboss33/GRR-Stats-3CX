import { prismaAuth } from "@/lib/prisma-auth";
import type { ServerId } from "@/lib/prisma-cdr";

/**
 * Exclusions de statistiques — les clients hébergés sur le tenant (Barnes,
 * BCR…) dont le trafic ne doit apparaître dans AUCUN chiffre.
 *
 * Le jeu d'exclusion se compose de :
 *  1. les files cochées « Exclue des statistiques » (QueueRegistry) ;
 *  2. leurs agents EXCLUSIFS — membres d'une file exclue et d'aucune file
 *     comptée (dérivés de l'annuaire CDR, déjà en cache). La nuance protège
 *     les postes mixtes : un agent qui sert aussi une file comptée reste
 *     compté ;
 *  3. les postes/plages déclarés à la main (TenantSettings.excludedExtensions)
 *     — pour les postes clients membres d'aucune file, indétectables
 *     autrement (audit d'août 2026 : 188 postes hors de toute file).
 *
 * Ne s'applique JAMAIS au monitoring de licence : ces appels occupent
 * réellement les lignes 3CX du tenant.
 */

export interface StatsExclusions {
    queueNumbers: string[];
    extensions: string[];
}

const EMPTY: StatsExclusions = { queueNumbers: [], extensions: [] };
const TTL_MS = 60_000;
const cache = new Map<string, { value: StatsExclusions; expiresAt: number }>();

/** Vide le cache — appelé après une écriture pour que l'auteur voie son effet. */
export function invalidateStatsExclusions(): void {
    cache.clear();
}

/**
 * « 260-299, 803 » → ["260", …, "299", "803"]. Les zéros de tête sont
 * préservés à la largeur de la borne basse (« 001-009 » → 001…009), car les
 * extensions 3CX sont des chaînes. Les entrées illisibles ou les plages
 * déraisonnables (> 1000 postes) sont ignorées plutôt que d'exploser.
 */
export function parseExtensionRanges(raw: string): string[] {
    const out = new Set<string>();
    for (const piece of raw.split(",")) {
        const token = piece.trim();
        if (!token) continue;
        const range = token.match(/^(\d+)\s*-\s*(\d+)$/);
        if (range) {
            const [, fromRaw, toRaw] = range;
            const from = parseInt(fromRaw, 10);
            const to = parseInt(toRaw, 10);
            if (Number.isNaN(from) || Number.isNaN(to) || to < from || to - from > 1000) continue;
            for (let n = from; n <= to; n++) {
                out.add(String(n).padStart(fromRaw.length, "0"));
            }
        } else if (/^\d+$/.test(token)) {
            out.add(token);
        }
    }
    return [...out];
}

export async function getStatsExclusions(serverId: ServerId): Promise<StatsExclusions> {
    const hit = cache.get(serverId);
    if (hit && hit.expiresAt > Date.now()) return hit.value;

    let value = EMPTY;
    try {
        const [excludedQueues, tenant] = await Promise.all([
            prismaAuth.queueRegistry.findMany({
                where: { tenantId: serverId, excludedFromStats: true },
                select: { queueNumber: true },
            }),
            prismaAuth.tenantSettings.findUnique({
                where: { serverId },
                select: { excludedExtensions: true },
            }),
        ]);

        const queueNumbers = excludedQueues.map((q) => q.queueNumber);
        const extensions = new Set(parseExtensionRanges(tenant?.excludedExtensions ?? ""));

        if (queueNumbers.length > 0) {
            // Import dynamique : le repository importe ce module (filtre), la
            // dérivation des agents lit son annuaire en cache — le cycle est
            // cassé en ne résolvant cette direction qu'à l'exécution.
            const { getQueueMembersRaw } = await import("@/services/repositories/cdr.repository");
            const members = await getQueueMembersRaw(serverId);
            const excluded = new Set(queueNumbers);
            const inCounted = new Set<string>();
            const inExcluded = new Set<string>();
            for (const row of members) {
                (excluded.has(row.queue_number) ? inExcluded : inCounted).add(row.agent_extension);
            }
            for (const ext of inExcluded) {
                if (!inCounted.has(ext)) extensions.add(ext);
            }
        }

        value = { queueNumbers, extensions: [...extensions] };
    } catch {
        // Base indisponible : ne pas faire tomber les statistiques — on sert
        // sans exclusion, l'état d'avant la fonctionnalité.
        value = EMPTY;
    }

    cache.set(serverId, { value, expiresAt: Date.now() + TTL_MS });
    return value;
}
