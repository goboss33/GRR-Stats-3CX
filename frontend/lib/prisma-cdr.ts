import { PrismaClient } from "@prisma/cdr-client";

export type ServerId = "gerofinance" | "edifea";

export interface ServerConfig {
    id: ServerId;
    name: string;
    databaseUrl: string;
}

export const SERVERS: Record<ServerId, ServerConfig> = {
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

export const prismaCdr = getPrismaCdr("gerofinance");
