import { PrismaClient } from "@prisma/cdr-client";

export type ServerId = "gerofinance" | "edifea";

export interface ServerConfig {
    id: ServerId;
    name: string;
    databaseUrl: string;
}

let _servers: Record<ServerId, ServerConfig> | null = null;

export function getServers(): Record<ServerId, ServerConfig> {
    if (!_servers) {
        _servers = {
            gerofinance: {
                id: "gerofinance",
                name: "Gérofinance",
                databaseUrl: process.env.DATABASE_URL_GEROFINANCE || "",
            },
            edifea: {
                id: "edifea",
                name: "Edifea",
                databaseUrl: process.env.DATABASE_URL_EDIFEA || "",
            },
        };
    }
    return _servers;
}

export const SERVERS = new Proxy({} as Record<ServerId, ServerConfig>, {
    get(_, prop) {
        return getServers()[prop as ServerId];
    },
});

const globalForPrismaCdr = globalThis as unknown as {
    prismaCdrClients: Partial<Record<ServerId, PrismaClient>> | undefined;
};

function getCdrClients(): Partial<Record<ServerId, PrismaClient>> {
    if (!globalForPrismaCdr.prismaCdrClients) {
        globalForPrismaCdr.prismaCdrClients = {};
    }
    return globalForPrismaCdr.prismaCdrClients;
}

export function getPrismaCdr(serverId: ServerId): PrismaClient {
    const clients = getCdrClients();

    if (!clients[serverId]) {
        const server = SERVERS[serverId];
        if (!server.databaseUrl) {
            throw new Error(`DATABASE_URL_${serverId.toUpperCase()} is not configured`);
        }

        clients[serverId] = new PrismaClient({
            log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
            datasources: {
                db: {
                    url: server.databaseUrl,
                },
            },
        });
    }

    return clients[serverId]!;
}
