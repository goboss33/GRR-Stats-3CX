import { auth } from "@/lib/auth";
import { prismaAuth } from "@/lib/prisma-auth";
import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import crypto from "crypto";

async function requireAdmin() {
    const session = await auth();
    if (!session?.user || (session.user.role !== "ADMIN" && session.user.role !== "MODERATOR")) {
        throw new Error("Non autorisé");
    }
    return session.user;
}

function generateApiKey(): string {
    return `sk_live_${crypto.randomBytes(32).toString("hex")}`;
}

export async function GET() {
    try {
        await requireAdmin();
    } catch {
        return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const keys = await prismaAuth.apiKey.findMany({
        orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({
        keys: keys.map((k) => ({
            id: k.id,
            name: k.name,
            description: k.description,
            quotaPerMinute: k.quotaPerMinute,
            isActive: k.isActive,
            createdBy: k.createdBy,
            createdAt: k.createdAt.toISOString(),
            lastUsedAt: k.lastUsedAt?.toISOString() || null,
            revokedAt: k.revokedAt?.toISOString() || null,
            revokedBy: k.revokedBy,
            keyPrefix: k.keyHash ? `sk_live_${k.keyHash.slice(0, 8)}...` : null,
        })),
    });
}

export async function POST(request: NextRequest) {
    try {
        await requireAdmin();
    } catch {
        return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const body = await request.json();
    const { name, description, quotaPerMinute } = body;

    if (!name || name.trim().length === 0) {
        return NextResponse.json({ error: "Le nom de la clé est requis" }, { status: 400 });
    }

    const quota = typeof quotaPerMinute === "number" && quotaPerMinute > 0 ? quotaPerMinute : 100;
    const session = await auth();
    const plainKey = generateApiKey();
    const keyHash = await bcrypt.hash(plainKey, 10);

    const apiKey = await prismaAuth.apiKey.create({
        data: {
            keyHash,
            name: name.trim(),
            description: description?.trim() || null,
            quotaPerMinute: quota,
            createdBy: session?.user?.id || null,
        },
    });

    return NextResponse.json({
        key: {
            id: apiKey.id,
            name: apiKey.name,
            description: apiKey.description,
            quotaPerMinute: apiKey.quotaPerMinute,
            isActive: apiKey.isActive,
            createdAt: apiKey.createdAt.toISOString(),
        },
        plainKey,
    });
}

export async function PUT(request: NextRequest) {
    try {
        await requireAdmin();
    } catch {
        return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const body = await request.json();
    const { id, name, description, quotaPerMinute, isActive } = body;

    if (!id) {
        return NextResponse.json({ error: "ID de clé requis" }, { status: 400 });
    }

    const updateData: Record<string, unknown> = {};
    if (name !== undefined) updateData.name = name.trim();
    if (description !== undefined) updateData.description = description?.trim() || null;
    if (quotaPerMinute !== undefined) updateData.quotaPerMinute = quotaPerMinute;
    if (isActive !== undefined) updateData.isActive = isActive;

    await prismaAuth.apiKey.update({ where: { id }, data: updateData });
    return NextResponse.json({ success: true });
}

export async function DELETE(request: NextRequest) {
    try {
        await requireAdmin();
    } catch {
        return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
        return NextResponse.json({ error: "ID de clé requis" }, { status: 400 });
    }

    const session = await auth();
    await prismaAuth.apiKey.update({
        where: { id },
        data: {
            isActive: false,
            revokedAt: new Date(),
            revokedBy: session?.user?.id || null,
        },
    });

    return NextResponse.json({ success: true });
}
