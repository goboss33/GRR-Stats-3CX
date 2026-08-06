"use server";

/**
 * Cloche d'alertes : la façade invocable depuis le client.
 * Droit individuel (cf. lib/notification-access) puis filtrage par périmètre ;
 * la détection elle-même vit dans services/repositories/anomaly-detector.
 */

import { auth } from "@/lib/auth";
import { prismaAuth } from "@/lib/prisma-auth";
import { ServerId } from "@/lib/prisma-cdr";
import { resolveAccessScope, isQueueInScope } from "@/lib/access-scope";
import { effectiveCanViewNotifications } from "@/lib/notification-access";
import { getAlertsForTenant, type AnomalyAlert } from "@/services/repositories/anomaly-detector";

export type AlertsPayload = {
    allowed: boolean;
    windowDays: number;
    alerts: AnomalyAlert[];
};

/**
 * Alertes visibles par l'utilisateur courant : droit individuel d'abord,
 * périmètre ensuite.
 */
export async function getAlerts(serverId: ServerId): Promise<AlertsPayload> {
    const session = await auth();
    if (!session?.user?.id) return { allowed: false, windowDays: 0, alerts: [] };

    const user = await prismaAuth.user.findUnique({
        where: { id: session.user.id },
        select: { role: true, canViewNotifications: true },
    });
    if (!user || !effectiveCanViewNotifications(user)) {
        return { allowed: false, windowDays: 0, alerts: [] };
    }

    const settings = await prismaAuth.appSettings.findUnique({
        where: { id: "global" },
        select: { notificationWindowDays: true },
    });
    const windowDays = settings?.notificationWindowDays ?? 7;

    const alerts = await getAlertsForTenant(serverId, windowDays);

    // Filtrage par périmètre : un lecteur ne voit que les anomalies de SES files.
    const scope = await resolveAccessScope(serverId);
    const visible = alerts.filter((a) => isQueueInScope(scope, a.queueNumber));
    return { allowed: true, windowDays, alerts: visible };
}
