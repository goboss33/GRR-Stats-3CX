export interface QueueMember {
    agentExtension: string;
    agentName: string;
    attemptsCount: number;
    lastSeenAt: string;
}

export interface QueueInfo {
    queueNumber: string;
    queueName: string;
    members: QueueMember[];
    memberCount: number;
}
