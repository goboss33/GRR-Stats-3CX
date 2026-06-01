import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getServers } from "@/lib/prisma-cdr";
import { getAvailableServers } from "@/lib/servers";

export async function GET() {
    try {
        const cookieStore = await cookies();
        const currentServer = cookieStore.get("selectedServer")?.value || "gerofinance";
        
        const availableServerIds = getAvailableServers();
        const servers = getServers();
        
        const availableServers = availableServerIds.map(id => ({
            id,
            name: servers[id].name,
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
    try {
        const { serverId } = await request.json();
        
        if (!serverId || typeof serverId !== "string") {
            return NextResponse.json(
                { error: "Invalid serverId" },
                { status: 400 }
            );
        }

        const availableServerIds = getAvailableServers();
        if (!availableServerIds.includes(serverId as any)) {
            return NextResponse.json(
                { error: "Server not available" },
                { status: 400 }
            );
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
