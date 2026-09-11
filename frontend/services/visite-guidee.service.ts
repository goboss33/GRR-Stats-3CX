import { prismaAuth } from "@/lib/prisma-auth";
import { VISITES, type Visite } from "@/services/domain/visite-guidee";

/**
 * VISITE GUIDÉE — ce que la base sait de chaque utilisateur : quelles visites
 * il a vues (terminées ou passées), et quand. Absente = à jouer à la prochaine
 * visite de l'écran. L'administrateur peut la remettre à jouer.
 */

export type EtatVisites = Record<Visite, string | null>;

/** Date de fin de chaque visite, ou null si elle est encore à jouer. */
export async function lireVisites(userId: string): Promise<EtatVisites> {
    const lignes = await prismaAuth.userOnboardingTour.findMany({ where: { userId }, select: { tour: true, completedAt: true } });
    const vues = new Map(lignes.map((l) => [l.tour, l.completedAt.toISOString()]));
    return Object.fromEntries(VISITES.map((v) => [v, vues.get(v) ?? null])) as EtatVisites;
}

export async function visiteAJouer(userId: string, visite: Visite): Promise<boolean> {
    const ligne = await prismaAuth.userOnboardingTour.findUnique({ where: { userId_tour: { userId, tour: visite } }, select: { tour: true } });
    return ligne === null;
}

/** Terminée ou passée : dans les deux cas, on ne la rejoue pas d'office. */
export async function marquerVisiteVue(userId: string, visite: Visite): Promise<void> {
    await prismaAuth.userOnboardingTour.upsert({
        where: { userId_tour: { userId, tour: visite } },
        update: { completedAt: new Date() },
        create: { userId, tour: visite },
    });
}

/** L'administrateur la remet à jouer : la ligne disparaît. */
export async function remettreVisiteAJouer(userId: string, visite: Visite): Promise<void> {
    await prismaAuth.userOnboardingTour.deleteMany({ where: { userId, tour: visite } });
}
