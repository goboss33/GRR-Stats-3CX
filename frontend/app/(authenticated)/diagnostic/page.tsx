import { requirePageRole } from "@/lib/auth-guard";
import DiagnosticClient from "./diagnostic-client";

// Le diagnostic expose des données transverses (comparaison dashboard/logs sur
// l'ensemble des appels) : réservé à l'ADMIN, comme /api/diagnostic.
export default async function DiagnosticPage() {
    await requirePageRole(["ADMIN"]);
    return <DiagnosticClient />;
}
