"use server";

import { ServerId } from "@/lib/prisma-cdr";
import { getQueueMembersRaw } from "@/services/repositories/cdr.repository";
import type { QueueInfo, QueueMember } from "@/services/domain/call.types";
import { resolveAccessScope } from "@/lib/access-scope";

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

    // Le sélecteur de files ne doit proposer que le périmètre de l'utilisateur.
    if (scope.unrestricted) return queues;
    if (scope.empty || !scope.queueNumbers) return [];
    const allowed = new Set(scope.queueNumbers);
    return queues.filter((q) => allowed.has(q.queueNumber));
}
