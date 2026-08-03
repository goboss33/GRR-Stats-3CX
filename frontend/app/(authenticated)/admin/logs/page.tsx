import { redirect } from "next/navigation";
import { requirePageRole } from "@/lib/auth-guard";
import { prismaAuth } from "@/lib/prisma-auth";
import LogsClient from "./logs-client";

// Les managers accèdent aux logs : c'est le détail derrière les KPIs de leurs
// statistiques. Les données sont filtrées par périmètre et les numéros masqués
// côté serveur (cf. PRD droits d'accès §4.1 et D9). Le droit « Voir les logs »
// est individuel et révocable : sans lui, l'écran entier est fermé (les liens
// des KPI sont éteints partout, mais l'URL directe doit l'être aussi).
export default async function AdminLogsPage() {
    const user = await requirePageRole(["ADMIN", "MODERATOR", "MANAGER"]);
    const dbUser = await prismaAuth.user.findUnique({
        where: { id: user.id },
        select: { canViewLogs: true },
    });
    if (!dbUser?.canViewLogs) redirect("/dashboard");
    return <LogsClient />;
}
