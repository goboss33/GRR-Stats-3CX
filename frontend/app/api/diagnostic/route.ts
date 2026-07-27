import { NextRequest, NextResponse } from "next/server";
import { runDiagnostic } from "@/services/diagnostic.service";
import { ServerId } from "@/lib/prisma-cdr";
import { getDefaultServer, isValidServer } from "@/lib/servers";
import { requireApiRole } from "@/lib/auth-guard";

export async function POST(request: NextRequest) {
    const guard = await requireApiRole(["ADMIN", "MODERATOR"]);
    if (!guard.ok) return guard.response;

    try {
        const body = await request.json();
        const { startDate, endDate, server } = body;

        if (!startDate || !endDate) {
            return NextResponse.json(
                { error: "startDate and endDate are required" },
                { status: 400 }
            );
        }

        const serverId: ServerId = server && isValidServer(server) 
            ? server as ServerId 
            : getDefaultServer();

        console.log("[DIAGNOSTIC] Running diagnostic from", startDate, "to", endDate, "for server", serverId);
        const result = await runDiagnostic(serverId, new Date(startDate), new Date(endDate));
        console.log("[DIAGNOSTIC] Success:", result.summary.totalCalls, "calls,", result.summary.divergences, "divergences");
        return NextResponse.json(result);
    } catch (error) {
        // Détail loggé côté serveur uniquement — jamais renvoyé au client.
        console.error("[DIAGNOSTIC] API error:", error);
        return NextResponse.json(
            { error: "Erreur interne du serveur" },
            { status: 500 }
        );
    }
}
