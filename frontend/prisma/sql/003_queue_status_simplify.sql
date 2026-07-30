-- Simplification des statuts de file : ACTIVE | ARCHIVED (fin de UNCLASSIFIED).
--
-- Pourquoi ? Le statut « à classer » empêchait d'utiliser une file sans rien
-- protéger : la sécurité vient du périmètre (liste explicite de files), pas du
-- statut. Il imposait donc une corvée de classement sans bénéfice. Le suivi des
-- nouvelles files passe désormais par la colonne reviewedAt (null = nouvelle).
--
-- PostgreSQL ne sait pas supprimer une valeur d'enum : il faut recréer le type.
-- On le fait ici plutôt que de laisser `prisma db push` s'en charger, car il
-- refuserait l'opération (potentiellement destructrice) et bloquerait le
-- démarrage. Après ce script, db push ne voit plus aucun écart.
--
-- IDEMPOTENT : ne fait rien si UNCLASSIFIED a déjà disparu du type.

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t
        JOIN pg_enum e ON e.enumtypid = t.oid
        WHERE t.typname = 'QueueStatus' AND e.enumlabel = 'UNCLASSIFIED'
    ) THEN
        RAISE NOTICE 'QueueStatus deja simplifie';
        RETURN;
    END IF;

    -- Les files « à classer » deviennent simplement actives.
    EXECUTE 'UPDATE "QueueRegistry" SET status = ''ACTIVE'' WHERE status::text = ''UNCLASSIFIED''';

    ALTER TYPE "QueueStatus" RENAME TO "QueueStatus_old";
    CREATE TYPE "QueueStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

    ALTER TABLE "QueueRegistry" ALTER COLUMN status DROP DEFAULT;
    ALTER TABLE "QueueRegistry"
        ALTER COLUMN status TYPE "QueueStatus" USING (status::text::"QueueStatus");
    ALTER TABLE "QueueRegistry" ALTER COLUMN status SET DEFAULT 'ACTIVE';

    DROP TYPE "QueueStatus_old";
    RAISE NOTICE 'QueueStatus simplifie : ACTIVE | ARCHIVED';
END $$;
