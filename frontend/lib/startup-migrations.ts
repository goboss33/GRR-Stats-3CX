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
