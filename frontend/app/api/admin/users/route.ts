import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { Role } from "@prisma/client";

async function requireAdmin() {
    const session = await auth();
    if (!session?.user || session.user.role !== "ADMIN") {
        throw new Error("Non autorisé");
    }
    return session.user;
}

export async function GET() {
    try {
        await requireAdmin();
    } catch {
        return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const users = await prisma.user.findMany({
        select: { id: true, email: true, firstName: true, lastName: true, role: true, createdAt: true },
        orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ users });
}

export async function PUT(request: Request) {
    try {
        await requireAdmin();
    } catch {
        return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const body = await request.json();
    const { id, email, firstName, lastName, role, password } = body;

    if (!id) {
        return NextResponse.json({ error: "ID utilisateur requis" }, { status: 400 });
    }

    if (!email || !email.includes("@")) {
        return NextResponse.json({ error: "Email invalide" }, { status: 400 });
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing && existing.id !== id) {
        return NextResponse.json({ error: "Un utilisateur avec cet email existe déjà" }, { status: 400 });
    }

    const updateData: { email: string; firstName: string | null; lastName: string | null; role: Role; password?: string } = {
        email,
        firstName: firstName || null,
        lastName: lastName || null,
        role: role as Role,
    };

    if (password && password.length >= 4) {
        updateData.password = await bcrypt.hash(password, 10);
    }

    await prisma.user.update({ where: { id }, data: updateData });
    return NextResponse.json({ success: true });
}

export async function DELETE(request: Request) {
    try {
        await requireAdmin();
    } catch {
        return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
        return NextResponse.json({ error: "ID utilisateur requis" }, { status: 400 });
    }

    const session = await auth();
    if (session?.user?.id === id) {
        return NextResponse.json({ error: "Vous ne pouvez pas supprimer votre propre compte" }, { status: 400 });
    }

    await prisma.user.delete({ where: { id } });
    return NextResponse.json({ success: true });
}
