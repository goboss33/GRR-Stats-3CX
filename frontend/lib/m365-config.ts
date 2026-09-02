import { prismaAuth } from "@/lib/prisma-auth";
import type { ServerId } from "@/lib/prisma-cdr";
import { openSecret } from "@/lib/secret-box";

/**
 * Configuration Microsoft 365 d'un tenant, secret DÉCHIFFRÉ compris.
 *
 * ⚠️ Module SERVEUR uniquement, comme lib/xapi-config : la valeur renvoyée
 * contient un credential en clair. Ne jamais l'importer depuis un composant
 * client.
 *
 * Doctrine : Microsoft 365 s'AJOUTE. `enabled: false` ou `secret: null` n'est
 * pas une panne, c'est le mode nominal d'un tenant sans intégration — les
 * collaborateurs s'affichent alors avec leurs initiales.
 */
export interface M365Config {
    enabled: boolean;
    tenantId: string | null;
    clientId: string | null;
    secret: string | null;
    secretExpiresAt: Date | null;
}

const M365_OFF: M365Config = { enabled: false, tenantId: null, clientId: null, secret: null, secretExpiresAt: null };

export async function getServerM365Config(serverId: ServerId): Promise<M365Config> {
    try {
        const s = await prismaAuth.tenantSettings.findUnique({
            where: { serverId },
            select: { m365Enabled: true, m365TenantId: true, m365ClientId: true, m365SecretEncrypted: true, m365SecretExpiresAt: true },
        });
        if (!s?.m365Enabled) return M365_OFF;
        return {
            enabled: true,
            tenantId: s.m365TenantId,
            clientId: s.m365ClientId,
            secret: await openSecret(s.m365SecretEncrypted),
            secretExpiresAt: s.m365SecretExpiresAt,
        };
    } catch {
        return M365_OFF;
    }
}

/** L'intégration est-elle réellement exploitable (allumée ET complète) ? */
export function isM365Usable(config: M365Config): boolean {
    return config.enabled && Boolean(config.tenantId && config.clientId && config.secret);
}
