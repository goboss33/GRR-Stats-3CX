import { ServerId, getServers } from "./prisma-cdr";
import { prismaAuth } from "./prisma-auth";

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

export async function getServerTimezone(serverId: ServerId): Promise<string> {
    try {
        const settings = await prismaAuth.tenantSettings.findUnique({
            where: { serverId },
        });
        return settings?.timezone || getServers()[serverId].timezone;
    } catch {
        return getServers()[serverId].timezone;
    }
}

export async function getServerLicenceThreshold(serverId: ServerId): Promise<number> {
    try {
        const settings = await prismaAuth.tenantSettings.findUnique({
            where: { serverId },
        });
        return settings?.licenceThreshold ?? getServers()[serverId].licenceThreshold;
    } catch {
        return getServers()[serverId].licenceThreshold;
    }
}
