"use server";

// ============================================
// ACCÈS D'UN UTILISATEUR — tenants, périmètre de files, permissions
//
// Le périmètre est une liste EXPLICITE de files (cf. PRD droits d'accès D2) :
// aucune règle dynamique, une nouvelle file n'entre jamais seule dans un périmètre.
// Les extensions, elles, en découlent automatiquement (les agents sollicités par
// ces files), avec possibilité de surcharge manuelle.
// ============================================

import { prismaAuth } from "@/lib/prisma-auth";

export type OverrideMode = "INCLUDE" | "EXCLUDE";

export interface ExtensionOverride {
    tenantId: string;
    extensionNumber: string;
    mode: OverrideMode;
}

export interface UserAccessPayload {
    tenants: string[];
    queueIds: string[];
    extensionOverrides: ExtensionOverride[];
    canViewCompanyWide: boolean;
    canViewFullPhoneNumbers: boolean;
    canCreateApiKeys: boolean;
}

/** Accès configurés d'un utilisateur. */
export async function getUserAccess(userId: string): Promise<UserAccessPayload> {
    const [user, tenants, perimeter, overrides] = await Promise.all([
        prismaAuth.user.findUnique({
            where: { id: userId },
            select: { canViewCompanyWide: true, canViewFullPhoneNumbers: true, canCreateApiKeys: true },
        }),
        prismaAuth.userTenantAccess.findMany({ where: { userId }, select: { tenantId: true } }),
        prismaAuth.userQueuePerimeter.findMany({ where: { userId }, select: { queueId: true } }),
        prismaAuth.userExtensionOverride.findMany({
            where: { userId },
            select: { tenantId: true, extensionNumber: true, mode: true },
        }),
    ]);

    if (!user) throw new Error("Utilisateur introuvable");

    return {
        tenants: tenants.map((t) => t.tenantId),
        queueIds: perimeter.map((p) => p.queueId),
        extensionOverrides: overrides.map((o) => ({
            tenantId: o.tenantId,
            extensionNumber: o.extensionNumber,
            mode: o.mode as OverrideMode,
        })),
        canViewCompanyWide: user.canViewCompanyWide,
        canViewFullPhoneNumbers: user.canViewFullPhoneNumbers,
        canCreateApiKeys: user.canCreateApiKeys,
    };
}

/**
 * Remplace intégralement les accès d'un utilisateur.
 * Transactionnel : on ne veut pas d'état intermédiaire où le périmètre serait
 * vidé sans être reconstitué.
 */
export async function setUserAccess(userId: string, payload: UserAccessPayload): Promise<void> {
    await prismaAuth.$transaction([
        prismaAuth.user.update({
            where: { id: userId },
            data: {
                canViewCompanyWide: payload.canViewCompanyWide,
                canViewFullPhoneNumbers: payload.canViewFullPhoneNumbers,
                canCreateApiKeys: payload.canCreateApiKeys,
            },
        }),
        prismaAuth.userTenantAccess.deleteMany({ where: { userId } }),
        prismaAuth.userQueuePerimeter.deleteMany({ where: { userId } }),
        prismaAuth.userExtensionOverride.deleteMany({ where: { userId } }),
        prismaAuth.userTenantAccess.createMany({
            data: payload.tenants.map((tenantId) => ({ userId, tenantId })),
            skipDuplicates: true,
        }),
        prismaAuth.userQueuePerimeter.createMany({
            data: payload.queueIds.map((queueId) => ({ userId, queueId })),
            skipDuplicates: true,
        }),
        prismaAuth.userExtensionOverride.createMany({
            data: payload.extensionOverrides.map((o) => ({
                userId,
                tenantId: o.tenantId,
                extensionNumber: o.extensionNumber,
                mode: o.mode,
            })),
            skipDuplicates: true,
        }),
    ]);
}

export interface ScopeQueue {
    id: string;
    tenantId: string;
    queueNumber: string;
    currentName: string;
    region: string | null;
}

export interface UserScopeDescription {
    role: string;
    /** true = accès global (ADMIN/MODERATOR) : le périmètre de files ne s'applique pas */
    unrestricted: boolean;
    tenants: string[];
    queues: ScopeQueue[];
    /** Extensions déduites des files du périmètre, surcharges appliquées */
    extensions: string[];
    autoExtensionCount: number;
    includedByOverride: string[];
    excludedByOverride: string[];
    canViewCompanyWide: boolean;
    canViewFullPhoneNumbers: boolean;
    canCreateApiKeys: boolean;
}

/**
 * Décrit ce qu'un utilisateur voit réellement — utilisé par l'écran de contrôle
 * « qui voit quoi », et socle de l'application du filtrage (lot 3).
 */
export async function describeUserScope(userId: string): Promise<UserScopeDescription> {
    const user = await prismaAuth.user.findUnique({
        where: { id: userId },
        select: {
            role: true,
            canViewCompanyWide: true,
            canViewFullPhoneNumbers: true,
            canCreateApiKeys: true,
        },
    });
    if (!user) throw new Error("Utilisateur introuvable");

    const access = await getUserAccess(userId);
    const unrestricted = user.role === "ADMIN" || user.role === "MODERATOR";

    // ADMIN/MODERATOR : portée globale (limitée aux tenants autorisés pour MODERATOR).
    const queues = unrestricted
        ? await prismaAuth.queueRegistry.findMany({
              where: {
                  status: "ACTIVE",
                  ...(user.role === "MODERATOR" && access.tenants.length > 0
                      ? { tenantId: { in: access.tenants } }
                      : {}),
              },
              select: { id: true, tenantId: true, queueNumber: true, currentName: true, region: true },
              orderBy: [{ tenantId: "asc" }, { queueNumber: "asc" }],
          })
        : await prismaAuth.queueRegistry.findMany({
              where: { id: { in: access.queueIds } },
              select: { id: true, tenantId: true, queueNumber: true, currentName: true, region: true },
              orderBy: [{ tenantId: "asc" }, { queueNumber: "asc" }],
          });

    // Extensions déduites : agents sollicités par les files du périmètre.
    const links = queues.length
        ? await prismaAuth.queueAgentLink.findMany({
              where: {
                  OR: queues.map((q) => ({ tenantId: q.tenantId, queueNumber: q.queueNumber })),
              },
              select: { extensionNumber: true },
          })
        : [];

    const auto = new Set(links.map((l) => l.extensionNumber));
    const autoExtensionCount = auto.size;

    const includedByOverride: string[] = [];
    const excludedByOverride: string[] = [];
    for (const o of access.extensionOverrides) {
        if (o.mode === "INCLUDE") {
            if (!auto.has(o.extensionNumber)) includedByOverride.push(o.extensionNumber);
            auto.add(o.extensionNumber);
        } else {
            if (auto.delete(o.extensionNumber)) excludedByOverride.push(o.extensionNumber);
        }
    }

    return {
        role: user.role,
        unrestricted,
        tenants: access.tenants,
        queues,
        extensions: [...auto].sort(),
        autoExtensionCount,
        includedByOverride,
        excludedByOverride,
        canViewCompanyWide: user.canViewCompanyWide,
        canViewFullPhoneNumbers: user.canViewFullPhoneNumbers,
        canCreateApiKeys: user.canCreateApiKeys,
    };
}
