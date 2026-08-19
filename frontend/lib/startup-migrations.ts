import { prismaAuth } from "@/lib/prisma-auth";

/**
 * Migrations exécutées au démarrage du serveur (via instrumentation.ts).
 *
 * Pourquoi ici plutôt qu'avec `prisma db push` ? Le projet n'utilise pas de
 * dossier de migrations : `db push` compare le schéma et la base, et sur un
 * renommage de valeur d'enum il SUPPRIME puis recrée le type — ce qui détruirait
 * les rôles des utilisateurs existants. `ALTER TYPE ... RENAME VALUE` préserve
 * les données (les lignes gardent leur valeur, seul le libellé change).
 *
 * Toutes les opérations sont IDEMPOTENTES : elles peuvent tourner à chaque
 * démarrage sans effet de bord.
 */
export async function runStartupMigrations(): Promise<void> {
    await renameLegacyRoles();
    await seedGlobalRolePerimeters();
    await replaceCompanyWideWithCanViewLogs();
}

/**
 * Août 2026 : « Voir les chiffres de l'entreprise » disparaît (le tableau de
 * bord est TOUJOURS filtré par périmètre), remplacé par « Voir les logs
 * d'appels » — ouvert par défaut : personne ne perd l'accès au déploiement,
 * un ADMIN retire le droit au cas par cas.
 *
 * ADD seulement, PAS de DROP de canViewCompanyWide : la base auth est partagée
 * entre instances (dev local + prod), et cette migration tourne au démarrage de
 * n'importe laquelle — supprimer la colonne casserait toute instance encore
 * sur l'ancien code, qui la SELECTionne. La colonne, ignorée par le nouveau
 * code ET par Prisma, sera supprimée dans une release ultérieure, une fois
 * qu'aucune ancienne instance ne tourne.
 */
async function replaceCompanyWideWithCanViewLogs(): Promise<void> {
    await prismaAuth.$executeRawUnsafe(
        `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "canViewLogs" BOOLEAN NOT NULL DEFAULT true`,
    );
    // Même logique pour l'écran Extension / DDI : droit ouvert par défaut.
    await prismaAuth.$executeRawUnsafe(
        `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "canViewExtensionStats" BOOLEAN NOT NULL DEFAULT true`,
    );
    // Cloche d'alertes (août 2026) : NULLABLE à dessein — null = non arbitré,
    // le défaut se calcule alors PAR RÔLE (ADMIN/MODERATOR oui, MANAGER non),
    // y compris pour les utilisateurs créés après cette migration.
    await prismaAuth.$executeRawUnsafe(
        `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "canViewNotifications" BOOLEAN`,
    );
    // Ratios du tableau des agents (août 2026) : NULLABLE à dessein — null =
    // non arbitré, le défaut se calcule par rôle (cf. lib/ratios-access).
    // Sans cet ALTER, une instance `next dev` sur une base pas encore poussée
    // planterait à CHAQUE résolution de portée (la colonne est SELECTionnée).
    await prismaAuth.$executeRawUnsafe(
        `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "agentRatiosLevel" TEXT`,
    );
    // Fenêtre d'observation du détecteur d'anomalies (jours).
    await prismaAuth.$executeRawUnsafe(
        `ALTER TABLE "AppSettings" ADD COLUMN IF NOT EXISTS "notificationWindowDays" INTEGER NOT NULL DEFAULT 7`,
    );
}

/**
 * Août 2026 : ADMIN et MODERATOR cessent de tout voir par leur rôle et
 * reçoivent un PÉRIMÈTRE, comme les managers. Sans amorçage, leur premier
 * écran après déploiement serait vide — d'où cette attribution unique.
 *
 * Le périmètre initial est « toutes les files actives SAUF celles cochées
 * exclues des statistiques » : la case des clients hébergés, qu'on retire par
 * ailleurs, sert une dernière fois à dire ce qui n'appartient pas à la maison.
 *
 * NE REJOUE JAMAIS (marqueur `adminPerimeterSeededAt`) : sinon chaque
 * redémarrage réattribuerait les files qu'un administrateur vient de retirer.
 * Les comptes ayant DÉJÀ un périmètre sont laissés tels quels — une
 * configuration explicite prime toujours sur un amorçage.
 */
async function seedGlobalRolePerimeters(): Promise<void> {
    // La colonne est créée ici plutôt que d'attendre `db push` : cette
    // migration doit pouvoir tourner sur une base qui n'a pas encore vu le
    // nouveau schéma (dev local pointant sur la base auth partagée).
    await prismaAuth.$executeRawUnsafe(
        `ALTER TABLE "AppSettings" ADD COLUMN IF NOT EXISTS "adminPerimeterSeededAt" TIMESTAMP(3)`,
    );

    const marker = await prismaAuth.$queryRawUnsafe<{ seeded: Date | null }[]>(
        `SELECT "adminPerimeterSeededAt" AS seeded FROM "AppSettings" WHERE id = 'global'`,
    );
    if (marker.length > 0 && marker[0].seeded !== null) return;

    const [users, queues] = await Promise.all([
        prismaAuth.user.findMany({
            where: { role: { in: ["ADMIN", "MODERATOR"] } },
            select: {
                id: true,
                role: true,
                tenantAccess: { select: { tenantId: true } },
                _count: { select: { queuePerimeter: true } },
            },
        }),
        prismaAuth.queueRegistry.findMany({
            where: { status: "ACTIVE", excludedFromStats: false },
            select: { id: true, tenantId: true },
        }),
    ]);

    let granted = 0;
    for (const user of users) {
        if (user._count.queuePerimeter > 0) continue;

        // Un MODERATOR reste borné aux tenants qui lui sont ouverts ; l'ADMIN
        // administre l'ensemble, son périmètre couvre donc tous les tenants.
        const allowed = new Set(user.tenantAccess.map((t) => t.tenantId));
        const mine = user.role === "ADMIN" ? queues : queues.filter((q) => allowed.has(q.tenantId));
        if (mine.length === 0) continue;

        await prismaAuth.$transaction([
            prismaAuth.userTenantAccess.createMany({
                data: [...new Set(mine.map((q) => q.tenantId))].map((tenantId) => ({ userId: user.id, tenantId })),
                skipDuplicates: true,
            }),
            prismaAuth.userQueuePerimeter.createMany({
                data: mine.map((q) => ({ userId: user.id, queueId: q.id })),
                skipDuplicates: true,
            }),
        ]);
        granted++;
    }

    await prismaAuth.appSettings.upsert({
        where: { id: "global" },
        update: { adminPerimeterSeededAt: new Date() },
        create: { id: "global", adminPerimeterSeededAt: new Date() },
    });
    console.info(`[migrations] Périmètres amorcés pour ${granted} compte(s) ADMIN/MODERATOR (${queues.length} files)`);
}

/**
 * SUPERUSER -> MANAGER et USER -> AGENT (cf. PRD droits d'accès).
 * Le renommage met aussi à jour la valeur par défaut de la colonne, qui référence
 * le libellé par son identifiant interne (inchangé par le renommage).
 */
async function renameLegacyRoles(): Promise<void> {
    const rows = await prismaAuth.$queryRaw<{ enumlabel: string }[]>`
        SELECT e.enumlabel
        FROM pg_type t
        JOIN pg_enum e ON e.enumtypid = t.oid
        WHERE t.typname = 'Role'
    `;
    const labels = new Set(rows.map((r) => r.enumlabel));

    if (labels.has("SUPERUSER")) {
        await prismaAuth.$executeRawUnsafe(`ALTER TYPE "Role" RENAME VALUE 'SUPERUSER' TO 'MANAGER'`);
        console.info("[migrations] Rôle SUPERUSER renommé en MANAGER");
    }
    if (labels.has("USER")) {
        await prismaAuth.$executeRawUnsafe(`ALTER TYPE "Role" RENAME VALUE 'USER' TO 'AGENT'`);
        console.info("[migrations] Rôle USER renommé en AGENT");
    }
}
