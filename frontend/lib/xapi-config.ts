import { prismaAuth } from "./prisma-auth";
import { openSecret } from "./secret-box";
import type { ServerId } from "./prisma-cdr";

/**
 * Surcouche XAPI d'un tenant — interrupteur et clé, SERVEUR UNIQUEMENT.
 *
 * ⚠️ Vit dans son propre module, et pas dans lib/servers.ts, pour une raison
 * de construction : servers.ts est importé transitivement par du code qui
 * finit dans le bundle du navigateur, or `secret-box` dépend de `node:crypto`
 * — l'y brancher fait échouer le build. Ne JAMAIS importer ce module depuis
 * un composant client : la valeur renvoyée contient un credential en clair.
 *
 * Doctrine : XAPI s'AJOUTE au socle CDR, il ne le remplace jamais. Tout
 * appelant doit donc savoir se passer d'une réponse ici — `enabled: false` ou
 * `key: null` n'est pas une panne, c'est le mode nominal d'un tenant sans
 * licence XAPI, et le chemin sans XAPI doit rester complet.
 */
export async function getServerXapiConfig(
    serverId: ServerId,
): Promise<{ enabled: boolean; key: string | null }> {
    try {
        const settings = await prismaAuth.tenantSettings.findUnique({
            where: { serverId },
        });
        if (!settings?.xapiEnabled) return { enabled: false, key: null };
        return { enabled: true, key: openSecret(settings.xapiKeyEncrypted) };
    } catch {
        // Réglages illisibles : on retombe sur le socle CDR, jamais d'erreur.
        return { enabled: false, key: null };
    }
}
