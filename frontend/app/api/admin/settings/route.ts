import { NextRequest, NextResponse } from "next/server";
import { prismaAuth } from "@/lib/prisma-auth";
import { requireApiRole } from "@/lib/auth-guard";
import { logger } from "@/lib/logger";

// Règles métier = configuration applicative -> réservé à l'ADMIN (cf. PRD droits d'accès §4).

export async function GET() {
    const guard = await requireApiRole(["ADMIN"]);
    if (!guard.ok) return guard.response;

    try {
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
            perimeterEnforcementEnabled: settings.perimeterEnforcementEnabled,
        });
    } catch (error) {
        logger.error("Error fetching app settings:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}

export async function PUT(request: NextRequest) {
    const guard = await requireApiRole(["ADMIN"]);
    if (!guard.ok) return guard.response;

    try {
        const body = await request.json();
        const { minSignificantDurationSec, perimeterEnforcementEnabled } = body;

        if (minSignificantDurationSec !== undefined &&
            (typeof minSignificantDurationSec !== "number" || minSignificantDurationSec < 0 || minSignificantDurationSec > 60)) {
            return NextResponse.json({ error: "Invalid minSignificantDurationSec. Must be between 0 and 60." }, { status: 400 });
        }

        const data = {
            ...(minSignificantDurationSec !== undefined ? { minSignificantDurationSec } : {}),
            ...(perimeterEnforcementEnabled !== undefined
                ? { perimeterEnforcementEnabled: Boolean(perimeterEnforcementEnabled) }
                : {}),
        };

        const settings = await prismaAuth.appSettings.upsert({
            where: { id: "global" },
            update: data,
            create: { id: "global", ...data },
        });

        return NextResponse.json({
            minSignificantDurationSec: settings.minSignificantDurationSec,
            perimeterEnforcementEnabled: settings.perimeterEnforcementEnabled,
        });
    } catch (error) {
        logger.error("Error updating app settings:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
