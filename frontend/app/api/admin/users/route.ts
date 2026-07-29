import { prismaAuth } from "@/lib/prisma-auth";
import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { Role } from "@prisma/auth-client";
import { requireApiRole } from "@/lib/auth-guard";

/** Longueur minimale imposée pour tout nouveau mot de passe. */
const MIN_PASSWORD_LENGTH = 8;

export async function GET() {
    const guard = await requireApiRole(["ADMIN"]);
    if (!guard.ok) return guard.response;

    const users = await prismaAuth.user.findMany({
        select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            role: true,
            authProvider: true,
            createdAt: true,
        },
        orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ users });
}

export async function POST(request: Request) {
    const guard = await requireApiRole(["ADMIN"]);
    if (!guard.ok) return guard.response;

    const body = await request.json();
    const { email, firstName, lastName, role, password } = body;

    if (!email || !email.includes("@")) {
        return NextResponse.json({ error: "Email invalide" }, { status: 400 });
    }

    if (!password || password.length < MIN_PASSWORD_LENGTH) {
        return NextResponse.json({ error: `Le mot de passe doit contenir au moins ${MIN_PASSWORD_LENGTH} caractères` }, { status: 400 });
    }

    if (guard.user.role === "MODERATOR" && role === "ADMIN") {
        return NextResponse.json({ error: "Un modérateur ne peut pas créer un administrateur" }, { status: 403 });
    }

    const existing = await prismaAuth.user.findUnique({ where: { email } });
    if (existing) {
        return NextResponse.json({ error: "Un utilisateur avec cet email existe déjà" }, { status: 400 });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    await prismaAuth.user.create({
        data: {
            email,
            firstName: firstName || null,
            lastName: lastName || null,
            role: (role || "AGENT") as Role,
            password: hashedPassword,
        },
    });

    return NextResponse.json({ success: true });
}

export async function PUT(request: Request) {
    const guard = await requireApiRole(["ADMIN"]);
    if (!guard.ok) return guard.response;

    const body = await request.json();
    const { id, email, firstName, lastName, role, password } = body;

    if (!id) {
        return NextResponse.json({ error: "ID utilisateur requis" }, { status: 400 });
    }

    const targetUser = await prismaAuth.user.findUnique({ where: { id } });
    if (!targetUser) {
        return NextResponse.json({ error: "Utilisateur non trouvé" }, { status: 404 });
    }

    if (guard.user.role === "MODERATOR" && targetUser.role === "ADMIN") {
        return NextResponse.json({ error: "Un modérateur ne peut pas modifier un administrateur" }, { status: 403 });
    }

    if (!email || !email.includes("@")) {
        return NextResponse.json({ error: "Email invalide" }, { status: 400 });
    }

    const existing = await prismaAuth.user.findUnique({ where: { email } });
    if (existing && existing.id !== id) {
        return NextResponse.json({ error: "Un utilisateur avec cet email existe déjà" }, { status: 400 });
    }

    const updateData: { email: string; firstName: string | null; lastName: string | null; role: Role; password?: string } = {
        email,
        firstName: firstName || null,
        lastName: lastName || null,
        role: role as Role,
    };

    if (password) {
        if (password.length < MIN_PASSWORD_LENGTH) {
            return NextResponse.json({ error: `Le mot de passe doit contenir au moins ${MIN_PASSWORD_LENGTH} caractères` }, { status: 400 });
        }
        updateData.password = await bcrypt.hash(password, 10);
    }

    await prismaAuth.user.update({ where: { id }, data: updateData });
    return NextResponse.json({ success: true });
}

export async function DELETE(request: Request) {
    const guard = await requireApiRole(["ADMIN"]);
    if (!guard.ok) return guard.response;

    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
        return NextResponse.json({ error: "ID utilisateur requis" }, { status: 400 });
    }

    if (guard.user.id === id) {
        return NextResponse.json({ error: "Vous ne pouvez pas supprimer votre propre compte" }, { status: 400 });
    }

    const targetUser = await prismaAuth.user.findUnique({ where: { id } });
    if (!targetUser) {
        return NextResponse.json({ error: "Utilisateur non trouvé" }, { status: 404 });
    }

    if (guard.user.role === "MODERATOR" && targetUser.role === "ADMIN") {
        return NextResponse.json({ error: "Un modérateur ne peut pas supprimer un administrateur" }, { status: 403 });
    }

    await prismaAuth.user.delete({ where: { id } });
    return NextResponse.json({ success: true });
}
