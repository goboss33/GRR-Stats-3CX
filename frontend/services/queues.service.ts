"use server";

import { prisma } from "@/lib/prisma";
import { QueueInfo, QueueMember } from "@/types/queues.types";

export async function getQueueMembers(): Promise<QueueInfo[]> {
    const result = await prisma.$queryRaw<any[]>`
        WITH QueueMembers AS (
            SELECT 
                parent.destination_dn_number AS queue_number,
                parent.destination_dn_name AS queue_name,
                child.destination_dn_number AS agent_extension,
                child.destination_dn_name AS agent_name,
                COUNT(*) as attempts_count,
                MAX(child.cdr_started_at) as last_seen_at
            FROM 
                cdroutput child
            JOIN 
                cdroutput parent ON child.originating_cdr_id = parent.cdr_id
            WHERE 
                child.creation_method = 'route_to' 
                AND child.creation_forward_reason = 'polling'
                AND parent.destination_dn_type = 'queue'
            GROUP BY 
                parent.destination_dn_number, 
                parent.destination_dn_name, 
                child.destination_dn_number, 
                child.destination_dn_name
        )
        SELECT * FROM QueueMembers
        ORDER BY queue_number, agent_extension;
    `;

    const queuesMap = new Map<string, QueueInfo>();
    // Helper map to track members within a queue -> Map<QueueNumber, Map<Extension, QueueMember>>
    const queueMembersMap = new Map<string, Map<string, QueueMember>>();

    result.forEach((row: any) => {
        const qNum = row.queue_number;
        const agentExt = row.agent_extension;

        // Initialize queue if needed
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
            // Member already exists (duplicate extension, likely name change)
            // Merge logic: sum attempts, keep most recent name/date
            const existing = membersMap.get(agentExt)!;
            existing.attemptsCount += attempts;

            if (lastSeen > new Date(existing.lastSeenAt)) {
                existing.lastSeenAt = lastSeen.toISOString();
                existing.agentName = row.agent_name; // Update to newer name
            }
        } else {
            // New member
            membersMap.set(agentExt, {
                agentExtension: agentExt,
                agentName: row.agent_name,
                attemptsCount: attempts,
                lastSeenAt: lastSeen.toISOString()
            });
        }
    });

    // Populate the members array from the deduplicated map
    queuesMap.forEach((queue, qNum) => {
        const uniqueMembers = Array.from(queueMembersMap.get(qNum)!.values());
        queue.members = uniqueMembers;
        queue.memberCount = uniqueMembers.length;
    });

    return Array.from(queuesMap.values());
}
