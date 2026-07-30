import { requirePageRole } from "@/lib/auth-guard";
import LogsClient from "./logs-client";

// Les managers accèdent aux logs : c'est le détail derrière les KPIs de leurs
// statistiques. Les données sont filtrées par périmètre et les numéros masqués
// côté serveur (cf. PRD droits d'accès §4.1 et D9).
export default async function AdminLogsPage() {
    await requirePageRole(["ADMIN", "MODERATOR", "MANAGER"]);
    return <LogsClient />;
}
