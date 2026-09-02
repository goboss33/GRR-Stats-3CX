import { prismaAuth } from "@/lib/prisma-auth";
import type { ServerId } from "@/lib/prisma-cdr";
import { resoudreLigne, type Periode } from "@/services/domain/collaborator-profile";

/**
 * PROFILS DES COLLABORATEURS POUR LE TABLEAU D'ACTIVITÉ — la partie E/S.
 *
 * Pour chaque ligne (poste, nom) du tableau, le titre de poste et l'adresse
 * de la photo — tous deux tirés du journal des collaborateurs (poste + nom →
 * ligne → e-mail → photo). Rien n'est inventé : pas de ligne qui concorde,
 * pas de titre ni de photo, et l'écran montre des initiales.
 *
 * Intégration M365 éteinte = profils vides, même si des photos dorment encore
 * en base jusqu'au prochain relevé : c'est ce que promet la modale (« les
 * collaborateurs s'affichent avec leurs initiales »).
 */

export interface ProfilCollaborateur {
    jobTitle: string | null;
    /** Adresse à donner à <img> ; opaque (identifiant Graph), jamais l'e-mail. */
    photoUrl: string | null;
}

export const cleAgent = (a: { extension: string; name: string }) => `${a.extension}|${a.name}`;

export async function getProfilsCollaborateurs(
    serverId: ServerId,
    agents: { extension: string; name: string }[],
    periode: Periode,
): Promise<Map<string, ProfilCollaborateur>> {
    const out = new Map<string, ProfilCollaborateur>();
    if (agents.length === 0) return out;

    try {
        const reglages = await prismaAuth.tenantSettings.findUnique({
            where: { serverId },
            select: { m365Enabled: true },
        });
        if (!reglages?.m365Enabled) return out;

        const extensions = [...new Set(agents.map((a) => a.extension))];
        const [lignes, photos] = await Promise.all([
            prismaAuth.collaboratorDirectoryInterval.findMany({
                where: { serverId, extension: { in: extensions } },
                select: { extension: true, displayName: true, email: true, jobTitle: true, firstSeenAt: true, closedAt: true },
            }),
            prismaAuth.collaboratorPhoto.findMany({
                where: { serverId },
                select: { email: true, graphId: true },
            }),
        ]);
        const photoDe = new Map(photos.map((p) => [p.email, p.graphId]));

        for (const agent of agents) {
            const ligne = resoudreLigne(lignes, agent, periode);
            if (!ligne) continue;
            const graphId = ligne.email ? photoDe.get(ligne.email) : undefined;
            out.set(cleAgent(agent), {
                jobTitle: ligne.jobTitle,
                photoUrl: graphId ? `/api/collaborateurs/photo/${encodeURIComponent(graphId)}?server=${encodeURIComponent(serverId)}` : null,
            });
        }
    } catch {
        // Le tableau d'activité ne dépend pas de cette surcouche : en cas de
        // pépin, il s'affiche comme avant, initiales et sans titre.
    }
    return out;
}
