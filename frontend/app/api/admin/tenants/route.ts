import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getServers, ServerId } from "@/lib/prisma-cdr";
import { getAvailableServers } from "@/lib/servers";
import { prismaAuth } from "@/lib/prisma-auth";
import { requireApiRole } from "@/lib/auth-guard";

export async function GET() {
    const guard = await requireApiRole(["ADMIN"]);
    if (!guard.ok) return guard.response;

    try {
        const cookieStore = await cookies();
        const currentServer = cookieStore.get("selectedServer")?.value || "gerofinance";
        
        const availableServerIds = getAvailableServers();
        const servers = getServers();
        
        const tenantSettings = await prismaAuth.tenantSettings.findMany();
        const settingsMap = new Map(tenantSettings.map(s => [s.serverId, s]));

        const availableServers = availableServerIds.map(id => ({
            id,
            name: servers[id].name,
            timezone: settingsMap.get(id)?.timezone || servers[id].timezone,
            licenceThreshold: settingsMap.get(id)?.licenceThreshold ?? servers[id].licenceThreshold,
            trunkThreshold: settingsMap.get(id)?.trunkThreshold ?? servers[id].trunkThreshold,
        }));

        return NextResponse.json({
            currentServer,
            availableServers,
        });
    } catch (error) {
        console.error("[tenants] Error:", error);
        return NextResponse.json(
            { error: "Failed to fetch tenants" },
            { status: 500 }
        );
    }
}

export async function POST(request: Request) {
    const guard = await requireApiRole(["ADMIN"]);
    if (!guard.ok) return guard.response;

    try {
        const { serverId, timezone, licenceThreshold, trunkThreshold } = await request.json();
        
        if (!serverId || typeof serverId !== "string") {
            return NextResponse.json(
                { error: "Invalid serverId" },
                { status: 400 }
            );
        }

        const availableServerIds = getAvailableServers();
        if (!availableServerIds.includes(serverId as ServerId)) {
            return NextResponse.json(
                { error: "Server not available" },
                { status: 400 }
            );
        }

        if (timezone && typeof timezone === "string") {
            try {
                Intl.DateTimeFormat(undefined, { timeZone: timezone });
            } catch {
                return NextResponse.json(
                    { error: "Invalid timezone" },
                    { status: 400 }
                );
            }

            await prismaAuth.tenantSettings.upsert({
                where: { serverId },
                update: { timezone },
                create: { serverId, timezone },
            });

            return NextResponse.json({ success: true, serverId, timezone });
        }

        if (licenceThreshold !== undefined) {
            if (typeof licenceThreshold !== "number" || licenceThreshold < 1 || licenceThreshold > 10000) {
                return NextResponse.json(
                    { error: "Invalid licenceThreshold. Must be between 1 and 10000." },
                    { status: 400 }
                );
            }

            await prismaAuth.tenantSettings.upsert({
                where: { serverId },
                update: { licenceThreshold },
                create: { serverId, licenceThreshold },
            });

            return NextResponse.json({ success: true, serverId, licenceThreshold });
        }

        if (trunkThreshold !== undefined) {
            if (typeof trunkThreshold !== "number" || trunkThreshold < 0 || trunkThreshold > 10000) {
                return NextResponse.json(
                    { error: "Invalid trunkThreshold. Must be between 0 and 10000." },
                    { status: 400 }
                );
            }

            await prismaAuth.tenantSettings.upsert({
                where: { serverId },
                update: { trunkThreshold },
                create: { serverId, trunkThreshold },
            });

            return NextResponse.json({ success: true, serverId, trunkThreshold });
        }

        const cookieStore = await cookies();
        cookieStore.set("selectedServer", serverId, {
            path: "/",
            maxAge: 60 * 60 * 24 * 365,
            httpOnly: false,
            sameSite: "lax",
        });

        return NextResponse.json({ success: true, serverId });
    } catch (error) {
        console.error("[tenants] Error:", error);
        return NextResponse.json(
            { error: "Failed to update tenant" },
            { status: 500 }
        );
    }
}
