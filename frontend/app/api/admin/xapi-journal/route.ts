import { NextResponse } from "next/server";

import { getAvailableServers } from "@/lib/servers";
import { ServerId } from "@/lib/prisma-cdr";
import { requireApiRole } from "@/lib/auth-guard";
import { getServerXapiConfig, isXapiUsable } from "@/lib/xapi-config";
import {
    getJournalOverview, getQueueJournal, runQueueMembershipSnapshot,
} from "@/services/xapi-journal.service";

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

        const config = await getServerXapiConfig(serverId);
        const overview = await getJournalOverview(serverId);
        return NextResponse.json({
            xapiUsable: isXapiUsable(config),
            xapiEnabled: config.enabled,
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
