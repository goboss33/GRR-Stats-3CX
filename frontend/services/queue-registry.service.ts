"use server";

// ============================================
// REGISTRE DES FILES — découverte et synchronisation
//
// Sans XAPI 3CX, les files ne sont connues que par les CDR. Ce service lit la base
// CDR (lecture seule) et alimente le registre dans la base d'authentification :
//   - nouvelle file      -> créée en UNCLASSIFIED, étiquettes pré-remplies
//   - file renommée      -> currentName mis à jour + historique + signalement
//   - file sans appel    -> ARCHIVED après queueArchiveAfterDays
//   - rattachement agent -> QueueAgentLink reconstruit
//
// ⚠️ Les étiquettes validées par un ADMIN ne sont JAMAIS écrasées par la découverte.
// ============================================

import { ServerId, getPrismaCdr } from "@/lib/prisma-cdr";
import { prismaAuth } from "@/lib/prisma-auth";
import { parseQueueName } from "@/services/domain/queue-naming";
import { logger } from "@/lib/logger";

interface DiscoveredQueue {
    number: string;
    name: string;
    first_seen: Date;
    last_seen: Date;
}

interface DiscoveredName {
    number: string;
    name: string;
}

interface DiscoveredLink {
    queue_number: string;
    extension_number: string;
    last_seen: Date;
}

export interface RenameNotice {
    queueNumber: string;
    from: string;
    to: string;
}

export interface DiscoveryResult {
    tenantId: ServerId;
    discovered: number;
    created: number;
    renamed: RenameNotice[];
    archived: number;
    agentLinks: number;
}

/**
 * Synchronise le registre d'un tenant à partir de ses CDR.
 * Idempotent : peut être relancé autant que nécessaire.
 */
export async function discoverQueues(serverId: ServerId): Promise<DiscoveryResult> {
    const prisma = getPrismaCdr(serverId);

    // 1. Files présentes dans les CDR, avec leur nom le plus récent.
    const queues = await prisma.$queryRaw<DiscoveredQueue[]>`
        WITH agg AS (
            SELECT destination_dn_number AS number,
                   MIN(cdr_started_at)   AS first_seen,
                   MAX(cdr_started_at)   AS last_seen
            FROM cdroutput
            WHERE destination_dn_type = 'queue' AND destination_dn_number IS NOT NULL
            GROUP BY 1
        ),
        latest AS (
            SELECT DISTINCT ON (destination_dn_number)
                   destination_dn_number AS number,
                   destination_dn_name   AS name
            FROM cdroutput
            WHERE destination_dn_type = 'queue' AND destination_dn_name IS NOT NULL
            ORDER BY destination_dn_number, cdr_started_at DESC
        )
        SELECT a.number, COALESCE(l.name, a.number) AS name, a.first_seen, a.last_seen
        FROM agg a
        LEFT JOIN latest l ON l.number = a.number
    `;

    // 2. Tous les noms jamais observés (pour l'historique des renommages).
    const allNames = await prisma.$queryRaw<DiscoveredName[]>`
        SELECT DISTINCT destination_dn_number AS number, destination_dn_name AS name
        FROM cdroutput
        WHERE destination_dn_type = 'queue' AND destination_dn_name IS NOT NULL
    `;

    // 3. Rattachement agent -> file (segments de sollicitation).
    const links = await prisma.$queryRaw<DiscoveredLink[]>`
        SELECT parent.destination_dn_number AS queue_number,
               child.destination_dn_number  AS extension_number,
               MAX(child.cdr_started_at)    AS last_seen
        FROM cdroutput child
        JOIN cdroutput parent ON child.originating_cdr_id = parent.cdr_id
        WHERE child.creation_method = 'route_to'
          AND child.creation_forward_reason = 'polling'
          AND parent.destination_dn_type = 'queue'
          AND child.destination_dn_number IS NOT NULL
        GROUP BY 1, 2
    `;

    const existing = await prismaAuth.queueRegistry.findMany({ where: { tenantId: serverId } });
    const byNumber = new Map(existing.map((q) => [q.queueNumber, q]));

    const renamed: RenameNotice[] = [];
    let created = 0;

    for (const q of queues) {
        const current = byNumber.get(q.number);

        if (!current) {
            // Nouvelle file : directement exploitable (reviewedAt null la signale
            // comme « nouvelle » à l'ADMIN, sans bloquer son utilisation).
            const tags = parseQueueName(q.name);
            await prismaAuth.queueRegistry.create({
                data: {
                    tenantId: serverId,
                    queueNumber: q.number,
                    currentName: q.name,
                    entity: tags.entity,
                    region: tags.region,
                    service: tags.service,
                    firstSeenAt: q.first_seen,
                    lastSeenAt: q.last_seen,
                },
            });
            created++;
            continue;
        }

        if (current.currentName !== q.name) {
            renamed.push({ queueNumber: q.number, from: current.currentName, to: q.name });
        }

        // Le nom et la date de dernier appel suivent la réalité ; les étiquettes
        // (validées par un ADMIN) restent inchangées.
        await prismaAuth.queueRegistry.update({
            where: { id: current.id },
            data: { currentName: q.name, lastSeenAt: q.last_seen },
        });
    }

    // Historique des noms (ignore les doublons via la contrainte d'unicité).
    const registry = await prismaAuth.queueRegistry.findMany({ where: { tenantId: serverId } });
    const idByNumber = new Map(registry.map((q) => [q.queueNumber, q.id]));
    for (const n of allNames) {
        const queueId = idByNumber.get(n.number);
        if (!queueId) continue;
        await prismaAuth.queueNameHistory.upsert({
            where: { queueId_name: { queueId, name: n.name } },
            update: {},
            create: { queueId, name: n.name },
        });
    }

    // Archivage des files sans appel récent.
    const settings = await prismaAuth.appSettings.findUnique({ where: { id: "global" } });
    const archiveAfterDays = settings?.queueArchiveAfterDays ?? 90;
    const cutoff = new Date(Date.now() - archiveAfterDays * 24 * 60 * 60 * 1000);
    const { count: archived } = await prismaAuth.queueRegistry.updateMany({
        where: { tenantId: serverId, lastSeenAt: { lt: cutoff }, status: { not: "ARCHIVED" } },
        data: { status: "ARCHIVED" },
    });

    // Rattachements agents : on remplace l'état précédent par l'état courant.
    await prismaAuth.queueAgentLink.deleteMany({ where: { tenantId: serverId } });
    if (links.length > 0) {
        await prismaAuth.queueAgentLink.createMany({
            data: links.map((l) => ({
                tenantId: serverId,
                queueNumber: l.queue_number,
                extensionNumber: l.extension_number,
                lastSeenAt: l.last_seen,
            })),
            skipDuplicates: true,
        });
    }

    const result: DiscoveryResult = {
        tenantId: serverId,
        discovered: queues.length,
        created,
        renamed,
        archived,
        agentLinks: links.length,
    };
    logger.info("[queue-registry] Découverte terminée", result);
    return result;
}

/** Files du registre d'un tenant (pour l'écran d'administration). */
export async function listRegistryQueues(serverId: ServerId) {
    const [queues, agentCounts] = await Promise.all([
        prismaAuth.queueRegistry.findMany({
            where: { tenantId: serverId },
            orderBy: [{ status: "asc" }, { queueNumber: "asc" }],
            include: { nameHistory: { orderBy: { seenAt: "desc" } } },
        }),
        // Nombre d'agents rattachés, par file.
        prismaAuth.queueAgentLink.groupBy({
            by: ["queueNumber"],
            where: { tenantId: serverId },
            _count: { extensionNumber: true },
        }),
    ]);

    const countByQueue = new Map(agentCounts.map((c) => [c.queueNumber, c._count.extensionNumber]));

    // Activité en direct : permet d'afficher un état de santé fiable et de
    // rechercher une file par le nom d'un de ses agents.
    const live = await getQueuesLiveActivity(serverId);

    return queues.map((q) => ({
        ...q,
        agentCount: live[q.queueNumber]?.agents.length ?? countByQueue.get(q.queueNumber) ?? 0,
        lastCallAt: live[q.queueNumber]?.lastCallAt ?? null,
        agents: live[q.queueNumber]?.agents ?? [],
    }));
}

/**
 * Met à jour les étiquettes et le statut d'une file (action ADMIN).
 * Toute modification vaut examen : la file cesse d'être signalée « nouvelle ».
 */
export async function updateRegistryQueue(
    id: string,
    data: {
        entity?: string | null; region?: string | null; service?: string | null;
        status?: "ACTIVE" | "ARCHIVED"; excludedFromStats?: boolean;
    },
) {
    return prismaAuth.queueRegistry.update({
        where: { id },
        data: { ...data, reviewedAt: new Date() },
    });
}

export interface QueueAgentActivity {
    extension: string;
    name: string;
    attempts: number;
    lastSeenAt: string;
}

export interface QueueLiveActivity {
    lastCallAt: string | null;
    agents: QueueAgentActivity[];
}

/**
 * Activité réelle des files, lue DIRECTEMENT dans les CDR.
 *
 * Le registre ne se met à jour qu'à la découverte : ses dates s'y figent. Les
 * indicateurs affichés à l'écran doivent refléter la réalité du moment, sinon on
 * mélange deux fraîcheurs (une file « vue il y a 19 h » dont les agents ont été
 * sollicités il y a 15 min).
 */
export async function getQueuesLiveActivity(serverId: ServerId): Promise<Record<string, QueueLiveActivity>> {
    const prisma = getPrismaCdr(serverId);

    const [lastCalls, agents] = await Promise.all([
        prisma.$queryRaw<{ queue_number: string; last_call: Date }[]>`
            SELECT destination_dn_number AS queue_number, MAX(cdr_started_at) AS last_call
            FROM cdroutput
            WHERE destination_dn_type = 'queue' AND destination_dn_number IS NOT NULL
            GROUP BY destination_dn_number
        `,
        prisma.$queryRaw<
            { queue_number: string; extension: string; name: string | null; attempts: bigint; last_seen: Date }[]
        >`
            SELECT parent.destination_dn_number AS queue_number,
                   child.destination_dn_number  AS extension,
                   MAX(child.destination_dn_name) AS name,
                   COUNT(*)::bigint             AS attempts,
                   MAX(child.cdr_started_at)    AS last_seen
            FROM cdroutput child
            JOIN cdroutput parent ON child.originating_cdr_id = parent.cdr_id
            WHERE child.creation_method = 'route_to'
              AND child.creation_forward_reason = 'polling'
              AND parent.destination_dn_type = 'queue'
              AND child.destination_dn_number IS NOT NULL
            GROUP BY parent.destination_dn_number, child.destination_dn_number
        `,
    ]);

    const result: Record<string, QueueLiveActivity> = {};
    for (const c of lastCalls) {
        result[c.queue_number] = { lastCallAt: c.last_call.toISOString(), agents: [] };
    }
    for (const a of agents) {
        const entry = (result[a.queue_number] ??= { lastCallAt: null, agents: [] });
        entry.agents.push({
            extension: a.extension,
            name: a.name ?? a.extension,
            attempts: Number(a.attempts),
            lastSeenAt: a.last_seen.toISOString(),
        });
    }
    for (const entry of Object.values(result)) {
        entry.agents.sort((x, y) => y.lastSeenAt.localeCompare(x.lastSeenAt));
    }
    return result;
}

export interface QueueDetail {
    id: string;
    tenantId: string;
    queueNumber: string;
    currentName: string;
    entity: string | null;
    region: string | null;
    service: string | null;
    status: string;
    isNew: boolean;
    firstSeenAt: string;
    lastSeenAt: string;
    previousNames: { name: string; seenAt: string }[];
    agents: { extension: string; name: string; attempts: number; lastSeenAt: string }[];
}

/**
 * Détail d'une file : étiquettes, historique des noms et agents rattachés.
 * Les agents proviennent des CDR (nom + sollicitations), croisés avec le
 * rattachement matérialisé du registre.
 */
export async function getQueueDetail(serverId: ServerId, id: string): Promise<QueueDetail | null> {
    const queue = await prismaAuth.queueRegistry.findUnique({
        where: { id },
        include: { nameHistory: { orderBy: { seenAt: "desc" } } },
    });
    if (!queue || queue.tenantId !== serverId) return null;

    const prisma = getPrismaCdr(serverId);
    const [agents, lastCall] = await Promise.all([
        prisma.$queryRaw<{ extension: string; name: string | null; attempts: bigint; last_seen: Date }[]>`
            SELECT child.destination_dn_number AS extension,
                   MAX(child.destination_dn_name) AS name,
                   COUNT(*)::bigint              AS attempts,
                   MAX(child.cdr_started_at)     AS last_seen
            FROM cdroutput child
            JOIN cdroutput parent ON child.originating_cdr_id = parent.cdr_id
            WHERE child.creation_method = 'route_to'
              AND child.creation_forward_reason = 'polling'
              AND parent.destination_dn_type = 'queue'
              AND parent.destination_dn_number = ${queue.queueNumber}
              AND child.destination_dn_number IS NOT NULL
            GROUP BY child.destination_dn_number
            ORDER BY MAX(child.cdr_started_at) DESC
        `,
        // Dernier appel lu EN DIRECT : la date du registre est figée à la
        // dernière découverte et serait incohérente avec l'activité des agents.
        prisma.$queryRaw<{ last_call: Date | null }[]>`
            SELECT MAX(cdr_started_at) AS last_call
            FROM cdroutput
            WHERE destination_dn_type = 'queue' AND destination_dn_number = ${queue.queueNumber}
        `,
    ]);

    return {
        id: queue.id,
        tenantId: queue.tenantId,
        queueNumber: queue.queueNumber,
        currentName: queue.currentName,
        entity: queue.entity,
        region: queue.region,
        service: queue.service,
        status: queue.status,
        isNew: queue.reviewedAt === null,
        firstSeenAt: queue.firstSeenAt.toISOString(),
        lastSeenAt: (lastCall[0]?.last_call ?? queue.lastSeenAt).toISOString(),
        previousNames: queue.nameHistory
            .filter((h) => h.name !== queue.currentName)
            .map((h) => ({ name: h.name, seenAt: h.seenAt.toISOString() })),
        agents: agents.map((a) => ({
            extension: a.extension,
            name: a.name ?? a.extension,
            attempts: Number(a.attempts),
            lastSeenAt: a.last_seen.toISOString(),
        })),
    };
}

/** Marque des files comme examinées (bouton « J'ai vu ces nouvelles files »). */
export async function markQueuesReviewed(tenantId: ServerId, ids?: string[]) {
    const { count } = await prismaAuth.queueRegistry.updateMany({
        where: { tenantId, reviewedAt: null, ...(ids && ids.length > 0 ? { id: { in: ids } } : {}) },
        data: { reviewedAt: new Date() },
    });
    return count;
}
