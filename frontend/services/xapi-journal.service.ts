import { prismaAuth } from "@/lib/prisma-auth";
import { getServerXapiConfig, isXapiUsable } from "@/lib/xapi-config";
import { releveAttendu } from "@/services/domain/journal-cadence";
import { requestXapiToken, decodeTokenClaims } from "@/lib/xapi-client";
import { getAvailableServers } from "@/lib/servers";
import type { ServerId } from "@/lib/prisma-cdr";
import {
    normalizeSnapshot, planJournalChanges, windowReachesCutover,
    type SnapshotMember,
} from "@/services/domain/membership-journal";
import { getServerTimezone } from "@/lib/servers";
import type { ClassificationRules, RosterMember } from "@/services/domain/call-classification";

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
    // Cadence NOCTURNE : le prochain relevé est le premier 3 h qui suit le
    // dernier — et non « dernier + 24 h », qui faisait dériver l'heure.
    return releveAttendu(last?.ranAt ?? null, now);
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
        // Les appartenances EN COURS, membres compris : le sélecteur de
        // l'onglet cherche aussi par nom de collaborateur, comme la recherche
        // du header. Une file vidée de tous ses membres n'apparaît donc plus
        // ici — c'est l'écart que le nombre d'équipes du relevé (vues au PBX)
        // rend visible.
        prismaAuth.queueMembershipInterval.findMany({
            where: { serverId, closedAt: null },
            select: { queueNumber: true, extension: true, agentName: true, lastSeenAt: true },
            orderBy: [{ queueNumber: "asc" }, { agentName: "asc" }],
        }),
    ]);

    // Nom d'équipe : l'annuaire des files vit dans la même base. Sans lui,
    // le sélecteur n'offrait qu'un numéro — illisible pour un manager.
    const annuaire = await prismaAuth.queueRegistry.findMany({
        where: { tenantId: serverId },
        select: { queueNumber: true, currentName: true, entity: true, region: true, service: true },
    });
    const nomDe = new Map(annuaire.map((q) => [q.queueNumber, q]));

    const parFile = new Map<string, typeof queues>();
    for (const ligne of queues) {
        const existant = parFile.get(ligne.queueNumber);
        if (existant) existant.push(ligne);
        else parFile.set(ligne.queueNumber, [ligne]);
    }

    return {
        runs: runs.map((r) => ({
            ranAt: r.ranAt.toISOString(), ok: r.ok,
            queues: r.queues, members: r.members, changes: r.changes, error: r.error,
        })),
        openCount,
        queues: [...parFile.entries()].map(([queueNumber, lignes]) => {
            const fiche = nomDe.get(queueNumber);
            return {
                queueNumber,
                queueName: fiche?.currentName ?? `File ${queueNumber}`,
                // Regroupement du sélecteur, au niveau du SITE (entité · région).
                // Y ajouter le service donnait 90 groupes pour 93 équipes : un
                // titre par ligne, donc aucun regroupement. Le service, lui,
                // reste lisible dans le nom de l'équipe.
                queueDepartment: [fiche?.entity, fiche?.region].filter(Boolean).join(" · ") || null,
                members: lignes.length,
                membres: lignes.map((l) => ({
                    extension: l.extension,
                    name: l.agentName,
                    lastSeenAt: l.lastSeenAt.toISOString(),
                })),
            };
        }),
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

/**
 * ROSTER FERMÉ pour le socle de classement (règle rosterSource=journalAuto).
 *
 * Renvoie la composition de l'équipe selon le journal si — et seulement si —
 * la fenêtre est entièrement postérieure au premier mois calendaire complet
 * couvert (fuseau du tenant). Sinon null : le socle retombe sur le roster
 * déduit de l'activité, comme depuis toujours. Un tenant sans journal (pas de
 * relevé réussi) renvoie donc null pour toute fenêtre — edifea ne change pas.
 *
 * Le nom renvoyé est celui du dernier intervalle chevauchant la fenêtre : un
 * simple SECOURS d'affichage — les noms d'époque des statistiques restent
 * portés par les segments CDR.
 */
export async function resolveJournalRoster(
    serverId: ServerId,
    queueNumber: string,
    start: Date,
    end: Date,
): Promise<RosterMember[] | null> {
    // Doctrine surcouche : le journal INDISPONIBLE (base auth en panne,
    // table absente…) n'est pas une erreur des statistiques — on retombe sur
    // le roster déduit de l'activité, comme un tenant sans XAPI. Vérifié le
    // 25.08 : sans ce filet, une panne de la base auth cassait les écrans de
    // stats qui ne dépendaient jusqu'ici que de la base CDR.
    try {
        return await resolveJournalRosterUnsafe(serverId, queueNumber, start, end);
    } catch (error) {
        console.error("[journal-xapi] roster indisponible, repli sur l'activité :", error instanceof Error ? error.message : error);
        return null;
    }
}

async function resolveJournalRosterUnsafe(
    serverId: ServerId,
    queueNumber: string,
    start: Date,
    end: Date,
): Promise<RosterMember[] | null> {
    const firstOk = await prismaAuth.xapiSnapshotRun.findFirst({
        where: { serverId, ok: true },
        orderBy: { ranAt: "asc" },
        select: { ranAt: true },
    });
    if (!firstOk) return null;
    const timezone = await getServerTimezone(serverId);
    if (!windowReachesCutover(start, firstOk.ranAt, timezone)) return null;

    const intervals = await prismaAuth.queueMembershipInterval.findMany({
        where: {
            serverId, queueNumber,
            firstSeenAt: { lte: end },
            OR: [{ closedAt: null }, { closedAt: { gte: start } }],
        },
        orderBy: { lastSeenAt: "desc" },
        select: { extension: true, agentName: true },
    });
    const byExtension = new Map<string, RosterMember>();
    for (const interval of intervals) {
        if (!byExtension.has(interval.extension)) {
            byExtension.set(interval.extension, { extension: interval.extension, name: interval.agentName });
        }
    }
    return [...byExtension.values()];
}

/** Raccourci : applique la règle avant de résoudre. */
export async function resolveRosterForRules(
    rules: Pick<ClassificationRules, "rosterSource">,
    serverId: ServerId,
    queueNumber: string,
    start: Date,
    end: Date,
): Promise<RosterMember[] | null> {
    if (rules.rosterSource !== "journalAuto") return null;
    return resolveJournalRoster(serverId, queueNumber, start, end);
}
