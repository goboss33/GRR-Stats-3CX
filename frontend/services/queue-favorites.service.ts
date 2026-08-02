"use server";

import { auth } from "@/lib/auth";
import { prismaAuth } from "@/lib/prisma-auth";
import type { ServerId } from "@/lib/prisma-cdr";

/**
 * Files favorites de l'utilisateur courant — épinglées en tête du sous-menu
 * « Mes équipes ». Purement personnel : aucun effet sur les droits (le
 * périmètre reste seul juge de ce qui est visible) ni sur les chiffres.
 */

export async function getQueueFavorites(serverId: ServerId): Promise<string[]> {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) return [];

    const rows = await prismaAuth.userQueueFavorite.findMany({
        where: { userId, tenantId: serverId },
        select: { queueNumber: true },
    });
    return rows.map((r) => r.queueNumber);
}

/** Bascule l'étoile d'une file ; renvoie le nouvel état (true = favorite). */
export async function toggleQueueFavorite(serverId: ServerId, queueNumber: string): Promise<boolean> {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) throw new Error("Session requise");

    const key = { userId, tenantId: serverId, queueNumber };
    const existing = await prismaAuth.userQueueFavorite.findUnique({
        where: { userId_tenantId_queueNumber: key },
    });
    if (existing) {
        await prismaAuth.userQueueFavorite.delete({ where: { userId_tenantId_queueNumber: key } });
        return false;
    }
    await prismaAuth.userQueueFavorite.create({ data: key });
    return true;
}
