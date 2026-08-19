"use server";

import { ServerId } from "@/lib/prisma-cdr";
import { getQueueMembersRaw } from "@/services/repositories/cdr.repository";
import type { QueueInfo, QueueMember } from "@/services/domain/call.types";
import { resolveAccessScope } from "@/lib/access-scope";
import type { AgentRatiosLevel } from "@/lib/ratios-access";

/**
 * Queues Service — Queue Members
 * 
 * Orchestrates repository calls and formats data for the Queues UI.
 */

export async function getQueueMembers(serverId: ServerId): Promise<QueueInfo[]> {
    // Portée résolue ici (module "use server" : un paramètre serait forgeable).
    const scope = await resolveAccessScope(serverId);
    const result = await getQueueMembersRaw(serverId);

    const queuesMap = new Map<string, QueueInfo>();
    const queueMembersMap = new Map<string, Map<string, QueueMember>>();

    result.forEach((row) => {
        const qNum = row.queue_number;
        const agentExt = row.agent_extension;

        if (!queuesMap.has(qNum)) {
            queuesMap.set(qNum, {
                queueNumber: qNum,
                queueName: row.queue_name,
                queueDepartment: row.queue_department,
                members: [],
                memberCount: 0
            });
            queueMembersMap.set(qNum, new Map());
        }

        const membersMap = queueMembersMap.get(qNum)!;
        const attempts = Number(row.attempts_count);
        const lastSeen = new Date(row.last_seen_at);

        if (membersMap.has(agentExt)) {
            const existing = membersMap.get(agentExt)!;
            existing.attemptsCount += attempts;
            if (lastSeen > new Date(existing.lastSeenAt)) {
                existing.lastSeenAt = lastSeen.toISOString();
                existing.agentName = row.agent_name;
            }
        } else {
            membersMap.set(agentExt, {
                agentExtension: agentExt,
                agentName: row.agent_name,
                attemptsCount: attempts,
                lastSeenAt: lastSeen.toISOString()
            });
        }
    });

    queuesMap.forEach((queue, qNum) => {
        const uniqueMembers = Array.from(queueMembersMap.get(qNum)!.values());
        queue.members = uniqueMembers;
        queue.memberCount = uniqueMembers.length;
    });

    const queues = Array.from(queuesMap.values());

    // Le sélecteur ne propose que le périmètre de l'utilisateur — c'est lui,
    // désormais, qui écarte les files des clients hébergés : elles ne sont
    // dans le périmètre de personne (août 2026, fin de « exclue des stats »).
    if (scope.unrestricted) return queues;
    if (scope.empty || !scope.queueNumbers) return [];
    const allowed = new Set(scope.queueNumbers);
    return queues.filter((q) => allowed.has(q.queueNumber));
}

/**
 * Files accessibles à l'utilisateur courant, et ce qu'il a le droit d'en faire.
 *
 * La liste des files est déjà bornée à son périmètre par `getQueueMembers`.
 * `canViewCompanyWide` décide si la vue entreprise des logs lui est proposée :
 * réservée aux portées globales (ADMIN/MODERATOR) — l'ancienne permission du
 * même nom a disparu. `canViewLogs` dit si les logs lui sont accessibles tout
 * court : sans ce droit, les écrans éteignent chaque lien vers les logs. Les
 * décisions sont prises ICI, côté serveur — le client ne fait qu'afficher ce
 * qu'on lui autorise (le service des logs revérifie de toute façon).
 */
export async function getScopedQueueOptions(serverId: ServerId): Promise<{
    queues: QueueInfo[];
    canViewCompanyWide: boolean;
    canViewLogs: boolean;
    agentRatiosLevel: AgentRatiosLevel;
    noPerimeter: boolean;
}> {
    const scope = await resolveAccessScope(serverId);
    const queues = await getQueueMembers(serverId);
    return {
        queues,
        canViewCompanyWide: scope.canBrowseAllQueues,
        canViewLogs: scope.canViewLogs,
        agentRatiosLevel: scope.agentRatiosLevel,
        // Distingue « aucun droit » de « aucune file dans ce tenant » : les deux
        // donnent une liste vide, mais appellent des messages opposés.
        noPerimeter: scope.empty,
    };
}

/**
 * Permissions du consultant utiles aux écrans qui n'ont pas besoin de la liste
 * des files (Extension/DDI) : évite de payer getQueueMembers juste pour savoir
 * si les liens vers les logs doivent exister.
 */
export async function getViewerPermissions(serverId: ServerId): Promise<{ canViewLogs: boolean }> {
    const scope = await resolveAccessScope(serverId);
    return { canViewLogs: scope.canViewLogs };
}
