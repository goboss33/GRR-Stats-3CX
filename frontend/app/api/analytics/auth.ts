import { NextRequest, NextResponse } from "next/server";
import { prismaAuth } from "@/lib/prisma-auth";
import bcrypt from "bcryptjs";

const RATE_LIMIT_WINDOW_MS = 60_000;

export async function validateApiKey(request: NextRequest): Promise<{ valid: true; apiKeyId: string } | { valid: false; response: NextResponse }> {
    const keyHeader = request.headers.get("x-api-key");

    if (!keyHeader) {
        return {
            valid: false,
            response: NextResponse.json({ error: "Missing API key. Provide it in the X-API-Key header." }, { status: 401 }),
        };
    }

    const apiKeys = await prismaAuth.apiKey.findMany({
        where: { isActive: true },
    });

    let matchedKey = null;
    for (const apiKey of apiKeys) {
        const isMatch = await bcrypt.compare(keyHeader, apiKey.keyHash);
        if (isMatch) {
            matchedKey = apiKey;
            break;
        }
    }

    if (!matchedKey) {
        return {
            valid: false,
            response: NextResponse.json({ error: "Invalid API key." }, { status: 401 }),
        };
    }

    if (matchedKey.revokedAt) {
        return {
            valid: false,
            response: NextResponse.json({ error: "API key has been revoked." }, { status: 401 }),
        };
    }

    const oneMinuteAgo = new Date(Date.now() - RATE_LIMIT_WINDOW_MS);
    const recentCalls = await prismaAuth.apiKey.findUnique({
        where: { id: matchedKey.id },
        select: { lastUsedAt: true },
    });

    if (recentCalls?.lastUsedAt && recentCalls.lastUsedAt > oneMinuteAgo) {
        const timeSinceLastCall = Date.now() - recentCalls.lastUsedAt.getTime();
        const minIntervalMs = RATE_LIMIT_WINDOW_MS / matchedKey.quotaPerMinute;
        if (timeSinceLastCall < minIntervalMs) {
            const retryAfter = Math.ceil((minIntervalMs - timeSinceLastCall) / 1000);
            return {
                valid: false,
                response: NextResponse.json(
                    { error: `Rate limit exceeded. Quota: ${matchedKey.quotaPerMinute} requests/minute. Retry after ${retryAfter}s.` },
                    { status: 429, headers: { "Retry-After": String(retryAfter) } }
                ),
            };
        }
    }

    await prismaAuth.apiKey.update({
        where: { id: matchedKey.id },
        data: { lastUsedAt: new Date() },
    });

    return { valid: true, apiKeyId: matchedKey.id };
}
