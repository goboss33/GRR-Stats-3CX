"use server";

import { prismaAuth } from "@/lib/prisma-auth";
import bcrypt from "bcryptjs";
import { Role } from "@prisma/client";
import { requireActionRole } from "@/lib/auth-guard";

/** Longueur minimale imposée pour tout nouveau mot de passe. */
const MIN_PASSWORD_LENGTH = 8;

type ActionResult<T = void> =
    | { success: true; data: T }
    | { success: false; error: string };

export type UserRow = {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
    role: Role;
    authProvider: string;
    createdAt: Date;
};

export async function getUsers(): Promise<UserRow[]> {
    await requireActionRole(["ADMIN"]);
    return prismaAuth.user.findMany({
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
}

export async function createUser(data: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    role: Role;
}): Promise<ActionResult<UserRow>> {
    await requireActionRole(["ADMIN"]);

    if (!data.email || !data.email.includes("@")) {
        return { success: false, error: "Email invalide" };
    }
    if (!data.password || data.password.length < MIN_PASSWORD_LENGTH) {
        return { success: false, error: `Le mot de passe doit contenir au moins ${MIN_PASSWORD_LENGTH} caractères` };
    }

    const existing = await prismaAuth.user.findUnique({ where: { email: data.email } });
    if (existing) {
        return { success: false, error: "Un utilisateur avec cet email existe déjà" };
    }

    const hashedPassword = await bcrypt.hash(data.password, 10);
    const user = await prismaAuth.user.create({
        data: {
            email: data.email,
            password: hashedPassword,
            firstName: data.firstName || null,
            lastName: data.lastName || null,
            role: data.role,
        },
        select: { id: true, email: true, firstName: true, lastName: true, role: true, authProvider: true, createdAt: true },
    });

    return { success: true, data: user };
}

export async function updateUser(
    id: string,
    data: { email: string; firstName: string; lastName: string; role: Role; password?: string }
): Promise<ActionResult> {
    const currentUser = await requireActionRole(["ADMIN"]);

    if (currentUser.id === id && data.role !== "ADMIN") {
        return { success: false, error: "Vous ne pouvez pas modifier votre propre rôle" };
    }

    if (!data.email || !data.email.includes("@")) {
        return { success: false, error: "Email invalide" };
    }

    const existing = await prismaAuth.user.findUnique({ where: { email: data.email } });
    if (existing && existing.id !== id) {
        return { success: false, error: "Un utilisateur avec cet email existe déjà" };
    }

    if (data.password && data.password.length < MIN_PASSWORD_LENGTH) {
        return { success: false, error: `Le mot de passe doit contenir au moins ${MIN_PASSWORD_LENGTH} caractères` };
    }

    const updateData: { email: string; firstName: string | null; lastName: string | null; role: Role; password?: string } = {
        email: data.email,
        firstName: data.firstName || null,
        lastName: data.lastName || null,
        role: data.role,
    };

    if (data.password) {
        updateData.password = await bcrypt.hash(data.password, 10);
    }

    await prismaAuth.user.update({ where: { id }, data: updateData });
    return { success: true, data: undefined };
}

export async function deleteUser(id: string): Promise<ActionResult> {
    const currentUser = await requireActionRole(["ADMIN"]);

    if (currentUser.id === id) {
        return { success: false, error: "Vous ne pouvez pas supprimer votre propre compte" };
    }

    await prismaAuth.user.delete({ where: { id } });
    return { success: true, data: undefined };
}
