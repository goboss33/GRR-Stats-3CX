import { NextResponse } from "next/server";

import { getAvailableServers } from "@/lib/servers";
import { ServerId } from "@/lib/prisma-cdr";
import { requireApiRole } from "@/lib/auth-guard";
import { getServerXapiConfig, isXapiUsable } from "@/lib/xapi-config";
import {
    getJournalOverview, getQueueJournal, getRunDetail, runQueueMembershipSnapshot,
} from "@/services/xapi-journal.service";
import { getCollaborateurs, getFicheCollaborateur, getResumeM365 } from "@/services/collaborators.service";

/**
 * Journal de composition des équipes (surcouche XAPI) — lecture pour
 * l'onglet des réglages, et déclenchement manuel d'un relevé.
 */

function resolveServer(url: URL): ServerId | null {
    const serverId = url.searchParams.get("server") ?? "";
    return getAvailableServers().includes(serverId as ServerId) ? (serverId as ServerId) : null;
}

export async function GET(request: Request) {
    const guard = await requireApiRole(["ADMIN"]);
    if (!guard.ok) return guard.response;

    try {
        const url = new URL(request.url);
        const serverId = resolveServer(url);
        if (!serverId) return NextResponse.json({ error: "Invalid server" }, { status: 400 });

        const queueNumber = url.searchParams.get("queue");
        if (queueNumber) {
            return NextResponse.json({ intervals: await getQueueJournal(serverId, queueNumber) });
        }

        // Onglet Collaborateurs : la liste complète, puis la fiche d'un poste.
        if (url.searchParams.get("view") === "collaborateurs") {
            return NextResponse.json(await getCollaborateurs(serverId));
        }
        const collab = url.searchParams.get("collab");
        if (collab) {
            return NextResponse.json({ fiche: await getFicheCollaborateur(serverId, collab) });
        }

        // Détail d'UN relevé : ses mouvements, reconstitués depuis le journal
        // (les lignes ouvertes ou fermées à l'instant du relevé).
        const runAt = url.searchParams.get("run");
        if (runAt) {
            const instant = new Date(runAt);
            if (Number.isNaN(instant.getTime())) {
                return NextResponse.json({ error: "Instant de relevé invalide" }, { status: 400 });
            }
            return NextResponse.json({ detail: await getRunDetail(serverId, instant) });
        }

        const [config, overview, resumeM365] = await Promise.all([
            getServerXapiConfig(serverId), getJournalOverview(serverId), getResumeM365(serverId),
        ]);
        return NextResponse.json({
            xapiUsable: isXapiUsable(config),
            xapiEnabled: config.enabled,
            resumeM365,
            ...overview,
        });
    } catch (error) {
        console.error("[xapi-journal] Error:", error);
        return NextResponse.json({ error: "Lecture du journal impossible" }, { status: 500 });
    }
}

export async function POST(request: Request) {
    const guard = await requireApiRole(["ADMIN"]);
    if (!guard.ok) return guard.response;

    try {
        const { serverId } = await request.json();
        if (!serverId || !getAvailableServers().includes(serverId as ServerId)) {
            return NextResponse.json({ error: "Invalid server" }, { status: 400 });
        }
        // Relevé à la demande — même chemin exact que le relevé nocturne :
        // ce que le bouton valide, la nuit le reproduira.
        const summary = await runQueueMembershipSnapshot(serverId as ServerId);
        return NextResponse.json(summary);
    } catch (error) {
        console.error("[xapi-journal] Error:", error);
        return NextResponse.json({ error: "Relevé impossible" }, { status: 500 });
    }
}
