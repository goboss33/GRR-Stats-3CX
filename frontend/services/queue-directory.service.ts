"use server";

import { prismaAuth } from "@/lib/prisma-auth";
import type { ServerId } from "@/lib/prisma-cdr";

/**
 * SURCOUCHE D'ANNUAIRE — les noms et départements déclarés par le 3CX.
 *
 * Le socle reste les appels : le nom d'une file y est celui de son dernier
 * appel, son département le dernier groupe 3CX observé. C'est complet, mais
 * en retard d'un appel — une file renommée garde son ancien nom jusqu'à ce
 * qu'elle sonne, et une base CDR figée (pré-production) ment indéfiniment.
 *
 * L'annuaire XAPI, lui, suit le serveur. Mesuré le 1er septembre 2026 sur les
 * 99 files de production :
 *
 *     noms         89 concordants, 2 divergents  (967 et 982)
 *     départements 87 concordants, 2 divergents, 2 connus du seul annuaire,
 *                  ZÉRO connu des seuls appels
 *     8 files connues des appels et absentes de l'annuaire — les 8 archivées,
 *       supprimées du 3CX mais dont l'historique reste exploitable
 *
 * D'où la règle, et elle ne souffre pas d'exception : **l'annuaire quand il
 * connaît la file, les appels sinon.** Un remplacement pur priverait ces huit
 * files de tout libellé dans les statistiques passées.
 *
 * L'écran « Registre (CDR) » n'appelle volontairement PAS ce service : il
 * montre ce que les appels racontent, et c'est là qu'on lit l'écart.
 */

export interface FicheAnnuaire {
    queueName: string;
    department: string | null;
}

/**
 * Cache de l'annuaire.
 *
 * Il ne bouge qu'au relevé nocturne : une minute de fraîcheur serait déjà du
 * luxe, cinq suffisent. Sans lui, chaque affichage de la barre latérale
 * paierait une lecture de la base d'authentification.
 */
const CACHE_MS = 5 * 60 * 1000;
const cache = new Map<string, { at: number; valeur: Map<string, FicheAnnuaire> | null }>();

/** Vide le cache — appelé après un relevé XAPI ou un changement de réglage. */
export async function invaliderCacheAnnuaire(serverId?: ServerId): Promise<void> {
    if (serverId) cache.delete(serverId);
    else cache.clear();
}

/**
 * Noms et départements déclarés par le 3CX, indexés par numéro de file.
 *
 * Rend `null` — et non une table vide — quand la surcouche est éteinte ou que
 * le PBX n'a jamais été relevé. La nuance compte : `null` dit « pas d'avis,
 * garde ce que tu as », une table vide dirait « le PBX ne connaît aucune
 * file », ce qui effacerait tous les libellés.
 */
export async function getAnnuaireXapi(serverId: ServerId): Promise<Map<string, FicheAnnuaire> | null> {
    const enCache = cache.get(serverId);
    if (enCache && Date.now() - enCache.at < CACHE_MS) return enCache.valeur;

    const reglages = await prismaAuth.tenantSettings.findUnique({
        where: { serverId },
        select: { xapiEnabled: true, xapiDirectoryEnabled: true },
    });

    let valeur: Map<string, FicheAnnuaire> | null = null;
    if (reglages?.xapiEnabled && reglages.xapiDirectoryEnabled) {
        // Seules les lignes OUVERTES : une ligne fermée décrit un état passé,
        // que le journal des équipes raconte mais que l'affichage ne doit pas
        // reprendre.
        const lignes = await prismaAuth.queueDirectoryInterval.findMany({
            where: { serverId, closedAt: null },
            select: { queueNumber: true, queueName: true, department: true },
        });
        // Un annuaire vide n'est pas un annuaire : si le relevé n'a jamais
        // tourné, on s'abstient plutôt que d'effacer tous les libellés.
        if (lignes.length > 0) {
            valeur = new Map(lignes.map((l) => [l.queueNumber, { queueName: l.queueName, department: l.department }]));
        }
    }

    cache.set(serverId, { at: Date.now(), valeur });
    return valeur;
}

// Pas de fonction d'aide pour la fusion : ce module est un « use server »,
// où tout export doit être asynchrone — envelopper une lecture de Map dans
// une promesse coûterait plus de lignes que la lecture elle-même. Les quatre
// appelants écrivent donc :
//
//     annuaire?.get(numero)?.queueName || nomVenantDesAppels
//     annuaire?.get(numero)?.department ?? departementVenantDesAppels
//
// Le `??` sur le département est délibéré : l'annuaire peut connaître une
// file sans lui attribuer de groupe, et le groupe vu dans les appels vaut
// mieux que rien.

/**
 * Numéros des files que le 3CX ne connaît plus, parmi celles proposées.
 *
 * Mesuré sur la production : les 8 files absentes de l'annuaire étaient les
 * 8 archivées, sans un seul faux positif — l'absence prédit la suppression au
 * 3CX bien mieux que le silence prolongé. Ce n'est POURTANT qu'un signal :
 * l'archivage reste un geste d'administrateur. Un relevé incomplet
 * archiverait sinon des dizaines de files d'un coup.
 *
 * Rend un ensemble vide tant que la surcouche est éteinte ou jamais relevée —
 * on ne signale pas une absence qu'on n'a pas les moyens de constater.
 */
export async function filesAbsentesDuPbx(
    serverId: ServerId,
    numeros: string[],
): Promise<Set<string>> {
    const reglages = await prismaAuth.tenantSettings.findUnique({
        where: { serverId },
        select: { xapiEnabled: true },
    });
    if (!reglages?.xapiEnabled) return new Set();

    const lignes = await prismaAuth.queueDirectoryInterval.findMany({
        where: { serverId, closedAt: null },
        select: { queueNumber: true },
    });
    if (lignes.length === 0) return new Set();

    // Le signal ne dépend PAS de xapiDirectoryEnabled : savoir qu'une file a
    // disparu du PBX est utile même quand on garde les libellés des appels.
    const connues = new Set(lignes.map((l) => l.queueNumber));
    return new Set(numeros.filter((n) => !connues.has(n)));
}
