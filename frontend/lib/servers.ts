import { ServerId, getServers } from "./prisma-cdr";

export function getAvailableServers(): ServerId[] {
    const servers = getServers();
    return (Object.keys(servers) as ServerId[]).filter(
        (id) => servers[id].databaseUrl.length > 0
    );
}

export function isValidServer(serverId: string): serverId is ServerId {
    const servers = getServers();
    return serverId in servers && servers[serverId as ServerId].databaseUrl.length > 0;
}

export function getServerName(serverId: ServerId): string {
    return getServers()[serverId].name;
}

export function getDefaultServer(): ServerId {
    const available = getAvailableServers();
    return available[0] || "gerofinance";
}
