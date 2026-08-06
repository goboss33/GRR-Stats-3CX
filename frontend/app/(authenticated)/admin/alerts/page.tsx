import { redirect } from "next/navigation";
import { requirePageRole } from "@/lib/auth-guard";
import { prismaAuth } from "@/lib/prisma-auth";
import { effectiveCanViewNotifications } from "@/lib/notification-access";
import AlertsClient from "./alerts-client";

// Détail des alertes (la cloche du header n'en donne qu'un aperçu). Droit
// individuel, défaut par rôle : ADMIN/MODERATOR oui, MANAGER sur activation
// (cf. lib/notification-access). Le contenu est filtré par périmètre.
export default async function AdminAlertsPage() {
    const user = await requirePageRole(["ADMIN", "MODERATOR", "MANAGER"]);
    const dbUser = await prismaAuth.user.findUnique({
        where: { id: user.id },
        select: { role: true, canViewNotifications: true },
    });
    if (!dbUser || !effectiveCanViewNotifications(dbUser)) redirect("/dashboard");
    return <AlertsClient />;
}
