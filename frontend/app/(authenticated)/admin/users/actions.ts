"use server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { Role } from "@prisma/client";

type ActionResult<T = void> =
    | { success: true; data: T }
    | { success: false; error: string };

export type UserRow = {
    id: string;
    email: string;
    name: string | null;
    role: Role;
    createdAt: Date;
};

async function requireAdmin() {
    const session = await auth();
    if (!session?.user || session.user.role !== "ADMIN") {
        throw new Error("Non autorisé");
    }
    return session.user;
}

export async function getUsers(): Promise<UserRow[]> {
    await requireAdmin();
    return prisma.user.findMany({
        select: { id: true, email: true, name: true, role: true, createdAt: true },
        orderBy: { createdAt: "desc" },
    });
}

export async function createUser(data: {
    email: string;
    password: string;
    name: string;
    role: Role;
}): Promise<ActionResult<UserRow>> {
    await requireAdmin();

    if (!data.email || !data.email.includes("@")) {
        return { success: false, error: "Email invalide" };
    }
    if (!data.password || data.password.length < 4) {
        return { success: false, error: "Le mot de passe doit contenir au moins 4 caractères" };
    }

    const existing = await prisma.user.findUnique({ where: { email: data.email } });
    if (existing) {
        return { success: false, error: "Un utilisateur avec cet email existe déjà" };
    }

    const hashedPassword = await bcrypt.hash(data.password, 10);
    const user = await prisma.user.create({
        data: {
            email: data.email,
            password: hashedPassword,
            name: data.name || null,
            role: data.role,
        },
        select: { id: true, email: true, name: true, role: true, createdAt: true },
    });

    return { success: true, data: user };
}

export async function updateUser(
    id: string,
    data: { email: string; name: string; role: Role; password?: string }
): Promise<ActionResult> {
    const currentUser = await requireAdmin();

    if (currentUser.id === id && data.role !== "ADMIN") {
        return { success: false, error: "Vous ne pouvez pas modifier votre propre rôle" };
    }

    if (!data.email || !data.email.includes("@")) {
        return { success: false, error: "Email invalide" };
    }

    const existing = await prisma.user.findUnique({ where: { email: data.email } });
    if (existing && existing.id !== id) {
        return { success: false, error: "Un utilisateur avec cet email existe déjà" };
    }

    if (data.password && data.password.length < 4) {
        return { success: false, error: "Le mot de passe doit contenir au moins 4 caractères" };
    }

    const updateData: { email: string; name: string | null; role: Role; password?: string } = {
        email: data.email,
        name: data.name || null,
        role: data.role,
    };

    if (data.password) {
        updateData.password = await bcrypt.hash(data.password, 10);
    }

    await prisma.user.update({ where: { id }, data: updateData });
    return { success: true, data: undefined };
}

export async function deleteUser(id: string): Promise<ActionResult> {
    const currentUser = await requireAdmin();

    if (currentUser.id === id) {
        return { success: false, error: "Vous ne pouvez pas supprimer votre propre compte" };
    }

    await prisma.user.delete({ where: { id } });
    return { success: true, data: undefined };
}
