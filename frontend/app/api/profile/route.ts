import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";

export async function GET() {
    const session = await auth();
    if (!session?.user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
        where: { id: session.user.id },
        select: { id: true, email: true, firstName: true, lastName: true, role: true, createdAt: true },
    });

    if (!user) {
        return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    return NextResponse.json({ user });
}

export async function PUT(request: Request) {
    const session = await auth();
    if (!session?.user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { firstName, lastName, email, password } = body;

    if (!email || !email.includes("@")) {
        return NextResponse.json({ error: "Email invalide" }, { status: 400 });
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing && existing.id !== session.user.id) {
        return NextResponse.json({ error: "Un utilisateur avec cet email existe déjà" }, { status: 400 });
    }

    const updateData: { firstName: string | null; lastName: string | null; email: string; password?: string } = {
        firstName: firstName || null,
        lastName: lastName || null,
        email,
    };

    if (password && password.length >= 4) {
        updateData.password = await bcrypt.hash(password, 10);
    }

    const updated = await prisma.user.update({
        where: { id: session.user.id },
        data: updateData,
        select: { id: true, email: true, firstName: true, lastName: true, role: true, createdAt: true },
    });

    return NextResponse.json({ user: updated });
}
