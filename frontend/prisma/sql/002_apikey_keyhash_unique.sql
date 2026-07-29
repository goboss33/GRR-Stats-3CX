-- Rattrapage d'une dérive de schéma antérieure.
--
-- Le schéma déclare `keyHash String @unique` sur ApiKey, mais l'index unique
-- correspondant est absent de la base (créée avant l'ajout de cette contrainte).
-- `prisma db push` veut donc l'ajouter et s'interrompt : il refuse toute
-- opération pouvant échouer sur des données existantes.
--
-- On crée l'index ici, explicitement et sans risque, pour que `db push` ne voie
-- plus aucune dérive — et puisse rester STRICT (pas de --accept-data-loss, qui
-- autoriserait aussi de vraies destructions lors de futurs changements).
--
-- Nom de l'index : convention Prisma pour un @unique de champ -> {Table}_{champ}_key
-- IDEMPOTENT.

DO $$
DECLARE
    duplicates INT;
BEGIN
    IF to_regclass('"ApiKey"') IS NULL THEN
        RAISE NOTICE 'Table ApiKey absente : rien a faire';
        RETURN;
    END IF;

    IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'ApiKey_keyHash_key') THEN
        RAISE NOTICE 'Index ApiKey_keyHash_key deja present';
        RETURN;
    END IF;

    -- Garde-fou : une création d'index unique échouerait sur des doublons.
    -- En pratique impossible (chaque clé produit un hash bcrypt distinct), mais
    -- on préfère un message explicite à une erreur obscure.
    SELECT COUNT(*) INTO duplicates
    FROM (SELECT "keyHash" FROM "ApiKey" GROUP BY "keyHash" HAVING COUNT(*) > 1) d;

    IF duplicates > 0 THEN
        RAISE EXCEPTION 'Index unique impossible : % valeur(s) keyHash dupliquee(s) dans ApiKey', duplicates;
    END IF;

    CREATE UNIQUE INDEX "ApiKey_keyHash_key" ON "ApiKey"("keyHash");
    RAISE NOTICE 'Index unique ApiKey_keyHash_key cree';
END $$;
