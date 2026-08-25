import { prismaAuth } from "@/lib/prisma-auth";
import { getServerXapiConfig, isXapiUsable } from "@/lib/xapi-config";
import { requestXapiToken, decodeTokenClaims } from "@/lib/xapi-client";
import { getAvailableServers } from "@/lib/servers";
import type { ServerId } from "@/lib/prisma-cdr";
import {
    normalizeSnapshot, planJournalChanges,
    type SnapshotMember,
} from "@/services/domain/membership-journal";

/**
 * JOURNAL DE COMPOSITION DES ÉQUIPES — la couche d'entrée-sortie.
 *
 * Chaque relevé lit la composition réelle des files via la XAPI et la date
 * dans QueueMembershipInterval (voir services/domain/membership-journal pour
 * la logique pure). Le journal n'est encore CONSOMMÉ par aucun écran de
 * statistiques : il accumule, c'est tout — chaque jour sans relevé est de
 * l'histoire perdue, d'où le démarrage avant toute exploitation.
 *
 * Doctrine surcouche : un tenant sans XAPI n'est PAS en erreur, il est
 * simplement hors du jeu — aucun run n'est enregistré pour lui.
 */

const PAGE_LIMIT = 25;
const RUNS_RETENTION_DAYS = 180;

export interface SnapshotSummary {
    ran: boolean;
    ok: boolean;
    reason?: string;
    queues?: number;
    members?: number;
    changes?: number;
}

/** Extraction défensive d'un champ texte parmi plusieurs noms candidats. */
function pick(obj: Record<string, unknown> | null | undefined, keys: string[]): string {
    if (!obj) return "";
    for (const key of keys) {
        const value = obj[key];
        if (typeof value === "string" && value.trim()) return value.trim();
        if (typeof value === "number") return String(value);
    }
    return "";
}

/**
 * Lit toutes les files et leurs membres via l'API de configuration (OData).
 * Le parseur est volontairement tolérant sur les noms de champs : la forme
 * exacte varie selon les versions v20 — en cas d'échec total, un extrait des
 * clés reçues est renvoyé pour diagnostiquer depuis l'onglet des réglages.
 */
async function fetchQueueMembers(
    baseUrl: string,
    accessToken: string,
): Promise<{ ok: true; queues: number; members: SnapshotMember[] } | { ok: false; reason: string }> {
    const members: SnapshotMember[] = [];
    let queues = 0;
    // Plafond OData du PBX : 100 elements par page (verifie sur le 3CX v20
    // reel — au-dela, HTTP 400 « The limit of 100 for Top query has been
    // exceeded ») ; la pagination @odata.nextLink enchaine les pages.
    let url: string | null = `${baseUrl}/xapi/v1/Queues?%24expand=Agents&%24top=100`;
    let firstShape = "";

    for (let page = 0; url && page < PAGE_LIMIT; page++) {
        let res: Response;
        try {
            res = await fetch(url, {
                headers: { Authorization: `Bearer ${accessToken}` },
                signal: AbortSignal.timeout(20_000),
                cache: "no-store",
            });
        } catch (error) {
            return { ok: false, reason: `PBX injoignable pendant la lecture des files (${error instanceof Error ? error.message : String(error)})` };
        }
        if (!res.ok) {
            const body = (await res.text().catch(() => "")).trim();
            const authHeader = res.headers.get("www-authenticate");
            const parts = [
                `Lecture des files refusée (HTTP ${res.status})`,
                `corps: ${body ? body.slice(0, 200) : "vide"}`,
            ];
            if (authHeader) parts.push(`www-authenticate: ${authHeader.slice(0, 120)}`);
            // Contre-test : une autre entité répond-elle ? Discrimine « tout
            // est interdit » (rôle du principal insuffisant) d'un blocage
            // propre à l'entité Queues.
            try {
                const users = await fetch(`${baseUrl}/xapi/v1/Users?%24top=1&%24select=Id`, {
                    headers: { Authorization: `Bearer ${accessToken}` },
                    signal: AbortSignal.timeout(10_000),
                    cache: "no-store",
                });
                parts.push(`contre-test Users: HTTP ${users.status}`);
            } catch {
                parts.push("contre-test Users: injoignable");
            }
            const claims = decodeTokenClaims(accessToken);
            if (claims.role) parts.push(`rôle du jeton: ${claims.role}`);
            if (claims.sub || claims.client_id) parts.push(`principal: ${claims.sub ?? claims.client_id}`);
            return { ok: false, reason: parts.join(" · ") };
        }

        let payload: unknown;
        try {
            payload = await res.json();
        } catch {
            return { ok: false, reason: "Réponse du PBX illisible (JSON attendu)." };
        }

        const list = Array.isArray((payload as { value?: unknown })?.value)
            ? (payload as { value: unknown[] }).value
            : Array.isArray(payload) ? (payload as unknown[]) : [];
        if (!firstShape && list.length > 0) {
            firstShape = Object.keys(list[0] as Record<string, unknown>).join(",").slice(0, 200);
        }

        for (const raw of list) {
            const queue = raw as Record<string, unknown>;
            const queueNumber = pick(queue, ["Number", "number", "Extension"]);
            if (!queueNumber) continue;
            queues++;
            const agents = (queue.Agents ?? queue.agents ?? queue.Users ?? []) as unknown[];
            if (!Array.isArray(agents)) continue;
            for (const rawAgent of agents) {
                const agent = rawAgent as Record<string, unknown>;
                const nested = (agent.User ?? agent.user) as Record<string, unknown> | undefined;
                const extension = pick(agent, ["Number", "number", "Extension", "extension"]) || pick(nested, ["Number", "Extension"]);
                if (!extension) continue;
                const first = pick(agent, ["FirstName"]) || pick(nested, ["FirstName"]);
                const last = pick(agent, ["LastName"]) || pick(nested, ["LastName"]);
                const agentName = pick(agent, ["Name", "DisplayName"]) || pick(nested, ["DisplayName", "Name"])
                    || [first, last].filter(Boolean).join(" ");
                members.push({ queueNumber, extension, agentName });
            }
        }

        const next = (payload as Record<string, unknown>)["@odata.nextLink"];
        url = typeof next === "string" && next
            ? (next.startsWith("http") ? next : `${baseUrl}${next.startsWith("/") ? "" : "/"}${next}`)
            : null;
    }

    if (queues === 0) {
        return { ok: false, reason: `Aucune file lisible dans la réponse du PBX — forme reçue : [${firstShape || "vide"}]` };
    }
    return { ok: true, queues, members };
}

/** Un relevé complet pour un tenant : lecture XAPI, plan, application, trace. */
export async function runQueueMembershipSnapshot(serverId: ServerId): Promise<SnapshotSummary> {
    const config = await getServerXapiConfig(serverId);
    if (!isXapiUsable(config)) {
        // Pas de ligne de run : l'absence de surcouche n'est pas un incident.
        return { ran: false, ok: false, reason: "Surcouche XAPI inactive ou incomplète pour ce tenant." };
    }

    const now = new Date();
    const recordFailure = async (reason: string): Promise<SnapshotSummary> => {
        await prismaAuth.xapiSnapshotRun.create({
            data: { serverId, ranAt: now, ok: false, error: reason.slice(0, 500) },
        }).catch(() => undefined);
        return { ran: true, ok: false, reason };
    };

    const token = await requestXapiToken(config.baseUrl!, config.clientId!, config.key!);
    if (!token.ok) return recordFailure(token.reason);

    const fetched = await fetchQueueMembers(config.baseUrl!, token.accessToken);
    if (!fetched.ok) return recordFailure(fetched.reason);

    const snapshot = normalizeSnapshot(fetched.members);
    const open = await prismaAuth.queueMembershipInterval.findMany({
        where: { serverId, closedAt: null },
        select: { id: true, queueNumber: true, extension: true, agentName: true },
    });
    const plan = planJournalChanges(open, snapshot);

    await prismaAuth.$transaction([
        prismaAuth.queueMembershipInterval.updateMany({
            where: { id: { in: plan.toClose } },
            data: { closedAt: now, lastSeenAt: now },
        }),
        prismaAuth.queueMembershipInterval.updateMany({
            where: { id: { in: plan.toTouch } },
            data: { lastSeenAt: now },
        }),
        prismaAuth.queueMembershipInterval.createMany({
            data: plan.toOpen.map((m) => ({
                serverId, queueNumber: m.queueNumber, extension: m.extension,
                agentName: m.agentName, firstSeenAt: now, lastSeenAt: now,
            })),
        }),
        prismaAuth.xapiSnapshotRun.create({
            data: {
                serverId, ranAt: now, ok: true,
                queues: fetched.queues, members: snapshot.length,
                changes: plan.toClose.length + plan.toOpen.length,
            },
        }),
        // Ménage : les traces de runs au-delà de la rétention.
        prismaAuth.xapiSnapshotRun.deleteMany({
            where: { serverId, ranAt: { lt: new Date(now.getTime() - RUNS_RETENTION_DAYS * 24 * 3600 * 1000) } },
        }),
    ]);

    return {
        ran: true, ok: true,
        queues: fetched.queues, members: snapshot.length,
        changes: plan.toClose.length + plan.toOpen.length,
    };
}

/** Relevé pour tous les tenants dont la surcouche est exploitable. */
export async function runDueSnapshots(): Promise<void> {
    for (const serverId of getAvailableServers()) {
        try {
            const summary = await runQueueMembershipSnapshot(serverId);
            if (summary.ran) {
                console.log(`[journal-xapi] ${serverId} : ${summary.ok
                    ? `${summary.members} membres sur ${summary.queues} files, ${summary.changes} mouvement(s)`
                    : `ÉCHEC — ${summary.reason}`}`);
            }
        } catch (error) {
            console.error(`[journal-xapi] ${serverId} : erreur inattendue`, error);
        }
    }
}

/** Le relevé quotidien de ce tenant est-il encore à faire ? */
export async function isSnapshotDue(serverId: ServerId, now = new Date()): Promise<boolean> {
    const config = await getServerXapiConfig(serverId);
    if (!isXapiUsable(config)) return false;
    const last = await prismaAuth.xapiSnapshotRun.findFirst({
        where: { serverId, ok: true },
        orderBy: { ranAt: "desc" },
        select: { ranAt: true },
    });
    if (!last) return true; // jamais relevé : on démarre l'histoire tout de suite
    return now.getTime() - last.ranAt.getTime() > 24 * 3600 * 1000;
}

/** Vue d'ensemble pour l'onglet des réglages. */
export async function getJournalOverview(serverId: ServerId) {
    const [runs, openCount, queues] = await Promise.all([
        prismaAuth.xapiSnapshotRun.findMany({
            where: { serverId },
            orderBy: { ranAt: "desc" },
            take: 10,
        }),
        prismaAuth.queueMembershipInterval.count({ where: { serverId, closedAt: null } }),
        prismaAuth.queueMembershipInterval.groupBy({
            by: ["queueNumber"],
            where: { serverId, closedAt: null },
            _count: { _all: true },
            orderBy: { queueNumber: "asc" },
        }),
    ]);
    return {
        runs: runs.map((r) => ({
            ranAt: r.ranAt.toISOString(), ok: r.ok,
            queues: r.queues, members: r.members, changes: r.changes, error: r.error,
        })),
        openCount,
        queues: queues.map((q) => ({ queueNumber: q.queueNumber, members: q._count._all })),
    };
}

/** Le journal d'une file : intervalles en cours puis fermés, du plus récent au plus ancien. */
export async function getQueueJournal(serverId: ServerId, queueNumber: string) {
    const intervals = await prismaAuth.queueMembershipInterval.findMany({
        where: { serverId, queueNumber },
        orderBy: [{ closedAt: { sort: "asc", nulls: "first" } }, { firstSeenAt: "desc" }],
        take: 300,
    });
    return intervals.map((i) => ({
        extension: i.extension, agentName: i.agentName,
        firstSeenAt: i.firstSeenAt.toISOString(),
        lastSeenAt: i.lastSeenAt.toISOString(),
        closedAt: i.closedAt?.toISOString() ?? null,
    }));
}
