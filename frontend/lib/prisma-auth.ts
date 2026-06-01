import { PrismaClient } from "@prisma/auth-client";

const globalForPrismaAuth = globalThis as unknown as {
    prismaAuth: PrismaClient | undefined;
};

export const prismaAuth = globalForPrismaAuth.prismaAuth ?? new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
});

if (process.env.NODE_ENV !== "production") globalForPrismaAuth.prismaAuth = prismaAuth;
