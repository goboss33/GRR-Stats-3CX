import { redirect } from "next/navigation";
import { requirePageRole } from "@/lib/auth-guard";
import { prismaAuth } from "@/lib/prisma-auth";
import StatisticsExtensionClient from "./statistics-extension-client";

// L'écran Extension / DDI est soumis au droit individuel « Voir les
// statistiques Extension / DDI » (canViewExtensionStats), comme les logs :
// sans lui, l'entrée de navigation disparaît, mais l'URL directe doit être
// fermée aussi — et les services de données refusent de leur côté.
export default async function StatisticsExtensionPage() {
    const user = await requirePageRole(["ADMIN", "MODERATOR", "MANAGER"]);
    const dbUser = await prismaAuth.user.findUnique({
        where: { id: user.id },
        select: { canViewExtensionStats: true },
    });
    if (!dbUser?.canViewExtensionStats) redirect("/dashboard");
    return <StatisticsExtensionClient />;
}
