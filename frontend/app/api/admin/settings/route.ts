import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prismaAuth } from "@/lib/prisma-auth";

export async function GET() {
    try {
        const session = await auth();
        if (!session || (session.user.role !== "ADMIN" && session.user.role !== "MODERATOR")) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
        }

        let settings = await prismaAuth.appSettings.findUnique({
            where: { id: "global" },
        });

        if (!settings) {
            settings = await prismaAuth.appSettings.create({
                data: { id: "global" },
            });
        }

        return NextResponse.json({
            minSignificantDurationSec: settings.minSignificantDurationSec,
        });
    } catch (error) {
        console.error("Error fetching app settings:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}

export async function PUT(request: NextRequest) {
    try {
        const session = await auth();
        if (!session || (session.user.role !== "ADMIN" && session.user.role !== "MODERATOR")) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
        }

        const body = await request.json();
        const { minSignificantDurationSec } = body;

        if (typeof minSignificantDurationSec !== "number" || minSignificantDurationSec < 0 || minSignificantDurationSec > 60) {
            return NextResponse.json({ error: "Invalid minSignificantDurationSec. Must be between 0 and 60." }, { status: 400 });
        }

        const settings = await prismaAuth.appSettings.upsert({
            where: { id: "global" },
            update: { minSignificantDurationSec },
            create: { id: "global", minSignificantDurationSec },
        });

        return NextResponse.json({
            minSignificantDurationSec: settings.minSignificantDurationSec,
        });
    } catch (error) {
        console.error("Error updating app settings:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
