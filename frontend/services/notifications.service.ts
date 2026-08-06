"use server";

/**
 * Cloche d'alertes : la façade invocable depuis le client.
 * Droit individuel (cf. lib/notification-access) puis filtrage par périmètre ;
 * la détection elle-même vit dans services/repositories/anomaly-detector.
 *
 * L'ignorance d'une alerte est GLOBALE (partagée entre lecteurs, tracée « par
 * qui, quand ») et réversible : les alertes étant recalculées à la lecture,
 * ignorer = filtrer à l'affichage — l'onglet Ignorées restaure d'un clic.
 * Sans durée : « définitivement », tant qu'on ne la restaure pas. Si
 * l'anomalie cesse, l'alerte disparaît des deux onglets ; l'entrée reste
 * dormante et réappliquée si l'anomalie revient.
 */

import { auth } from "@/lib/auth";
import { prismaAuth } from "@/lib/prisma-auth";
import { ServerId } from "@/lib/prisma-cdr";
import { resolveAccessScope, isQueueInScope } from "@/lib/access-scope";
import { effectiveCanViewNotifications } from "@/lib/notification-access";
import { getAlertsForTenant, type AnomalyAlert } from "@/services/repositories/anomaly-detector";

export type IgnoredAlert = {
    alert: AnomalyAlert;
    ignoredByName: string;
    ignoredAt: string;
};

export type AlertsPayload = {
    allowed: boolean;
    windowDays: number;
    alerts: AnomalyAlert[];
    ignored: IgnoredAlert[];
};

/** Session + droit + périmètre du lecteur ; null si la cloche lui est fermée. */
async function authorizeReader(serverId: ServerId) {
    const session = await auth();
    if (!session?.user?.id) return null;
    const user = await prismaAuth.user.findUnique({
        where: { id: session.user.id },
        select: { id: true, firstName: true, lastName: true, role: true, canViewNotifications: true },
    });
    if (!user || !effectiveCanViewNotifications(user)) return null;
    const scope = await resolveAccessScope(serverId);
    return { user, scope };
}

/**
 * Alertes visibles par l'utilisateur courant : droit individuel d'abord,
 * périmètre ensuite, ignorées à part (pour l'onglet Ignorées).
 */
export async function getAlerts(serverId: ServerId): Promise<AlertsPayload> {
    const reader = await authorizeReader(serverId);
    if (!reader) return { allowed: false, windowDays: 0, alerts: [], ignored: [] };

    const settings = await prismaAuth.appSettings.findUnique({
        where: { id: "global" },
        select: { notificationWindowDays: true },
    });
    const windowDays = settings?.notificationWindowDays ?? 7;

    const computed = await getAlertsForTenant(serverId, windowDays);
    const inScope = computed.filter((a) => isQueueInScope(reader.scope, a.queueNumber));

    const ignoreEntries = await prismaAuth.alertIgnore.findMany({
        where: { tenantId: serverId, alertId: { in: inScope.map((a) => a.id) } },
    });
    const ignoreById = new Map(ignoreEntries.map((e) => [e.alertId, e]));

    const alerts: AnomalyAlert[] = [];
    const ignored: IgnoredAlert[] = [];
    for (const a of inScope) {
        const entry = ignoreById.get(a.id);
        if (entry) {
            ignored.push({ alert: a, ignoredByName: entry.ignoredByName, ignoredAt: entry.createdAt.toISOString() });
        } else {
            alerts.push(a);
        }
    }
    return { allowed: true, windowDays, alerts, ignored };
}

/** L'alerte est-elle actuellement visible par ce lecteur ? (garde des actions) */
async function assertAlertVisible(serverId: ServerId, alertId: string, reader: NonNullable<Awaited<ReturnType<typeof authorizeReader>>>) {
    const settings = await prismaAuth.appSettings.findUnique({
        where: { id: "global" },
        select: { notificationWindowDays: true },
    });
    const computed = await getAlertsForTenant(serverId, settings?.notificationWindowDays ?? 7);
    const alert = computed.find((a) => a.id === alertId);
    if (!alert || !isQueueInScope(reader.scope, alert.queueNumber)) {
        throw new Error("Alerte introuvable dans votre périmètre");
    }
}

/** Ignore une alerte — pour tous les lecteurs, tracé, réversible. */
export async function ignoreAlert(serverId: ServerId, alertId: string): Promise<void> {
    const reader = await authorizeReader(serverId);
    if (!reader) throw new Error("Accès refusé");
    await assertAlertVisible(serverId, alertId, reader);
    const name = [reader.user.firstName, reader.user.lastName].filter(Boolean).join(" ") || "Utilisateur";
    await prismaAuth.alertIgnore.upsert({
        where: { tenantId_alertId: { tenantId: serverId, alertId } },
        update: {},
        create: { tenantId: serverId, alertId, ignoredById: reader.user.id, ignoredByName: name },
    });
}

/** Restaure une alerte ignorée. */
export async function restoreAlert(serverId: ServerId, alertId: string): Promise<void> {
    const reader = await authorizeReader(serverId);
    if (!reader) throw new Error("Accès refusé");
    await assertAlertVisible(serverId, alertId, reader);
    await prismaAuth.alertIgnore.deleteMany({ where: { tenantId: serverId, alertId } });
}
