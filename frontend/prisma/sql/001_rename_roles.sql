-- Migration de données : renommage des rôles (cf. PRD droits d'accès).
--   SUPERUSER -> MANAGER
--   USER      -> AGENT
--
-- Pourquoi ce fichier plutôt que `prisma db push` ? Sur un renommage de valeur
-- d'enum, `db push` SUPPRIME et recrée le type, ce qui détruirait le rôle des
-- utilisateurs existants. `ALTER TYPE ... RENAME VALUE` préserve les données
-- (et la valeur par défaut de la colonne, qui référence le libellé en interne).
--
-- IDEMPOTENT : peut être rejoué à chaque démarrage sans effet de bord.
-- Doit être exécuté AVANT `prisma db push`, sinon push verra un enum divergent.

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_type t
        JOIN pg_enum e ON e.enumtypid = t.oid
        WHERE t.typname = 'Role' AND e.enumlabel = 'SUPERUSER'
    ) THEN
        ALTER TYPE "Role" RENAME VALUE 'SUPERUSER' TO 'MANAGER';
        RAISE NOTICE 'Rôle SUPERUSER renommé en MANAGER';
    END IF;

    IF EXISTS (
        SELECT 1 FROM pg_type t
        JOIN pg_enum e ON e.enumtypid = t.oid
        WHERE t.typname = 'Role' AND e.enumlabel = 'USER'
    ) THEN
        ALTER TYPE "Role" RENAME VALUE 'USER' TO 'AGENT';
        RAISE NOTICE 'Rôle USER renommé en AGENT';
    END IF;
END $$;
