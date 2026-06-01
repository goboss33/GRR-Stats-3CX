import { ServerId, SERVERS } from "./prisma-cdr";

export function getAvailableServers(): ServerId[] {
    return (Object.keys(SERVERS) as ServerId[]).filter(
        (id) => SERVERS[id].databaseUrl.length > 0
    );
}

export function isValidServer(serverId: string): serverId is ServerId {
    return serverId in SERVERS && SERVERS[serverId as ServerId].databaseUrl.length > 0;
}

export function getServerName(serverId: ServerId): string {
    return SERVERS[serverId].name;
}

export function getDefaultServer(): ServerId {
    const available = getAvailableServers();
    return available[0] || "gerofinance";
}
