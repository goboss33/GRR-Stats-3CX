-- ============================================
-- SCRIPT DE MIGRATION MULTI-TENANT
-- Phase 3 : Restructuration des bases de données
-- ============================================
-- 
-- Ce script crée la nouvelle architecture :
-- - callcenter_auth (utilisateurs, API keys, settings)
-- - callcenter_gerofinance (CDR Gérofinance)
-- - callcenter_edifea (CDR Edifea - vide)
--
-- ⚠️  ATTENTION : Ce script doit être exécuté sur la base "callcenter" existante
-- ⏱️  Durée estimée : 2-5 minutes selon la taille des données
-- 🔄  Rollback possible (voir guide)
-- ============================================

-- Connexion : psql -h 192.168.2.100 -U postgres -d callcenter

BEGIN;

-- ============================================
-- ÉTAPE 1 : Créer les nouvelles bases
-- ============================================

\echo 'Étape 1/5 : Création des nouvelles bases de données...'

-- Créer callcenter_auth
SELECT 'CREATE DATABASE callcenter_auth'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'callcenter_auth')\gexec

-- Créer callcenter_edifea
SELECT 'CREATE DATABASE callcenter_edifea'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'callcenter_edifea')\gexec

\echo '✓ Bases créées'

-- ============================================
-- ÉTAPE 2 : Migrer les tables d'authentification vers callcenter_auth
-- ============================================

\echo 'Étape 2/5 : Migration des tables d''authentification...'

-- Connecter à callcenter_auth
\c callcenter_auth

-- Créer les tables dans callcenter_auth
CREATE TABLE IF NOT EXISTS "User" (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    role TEXT NOT NULL DEFAULT 'USER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE TABLE IF NOT EXISTS "AppSettings" (
    id TEXT PRIMARY KEY DEFAULT 'global',
    "minSignificantDurationSec" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE TABLE IF NOT EXISTS "ApiKey" (
    id TEXT PRIMARY KEY,
    "keyHash" TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    "quotaPerMinute" INTEGER NOT NULL DEFAULT 100,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokedBy" TEXT
);

CREATE INDEX IF NOT EXISTS "ApiKey_isActive_idx" ON "ApiKey"("isActive");
CREATE INDEX IF NOT EXISTS "ApiKey_createdBy_idx" ON "ApiKey"("createdBy");

\echo '✓ Tables d''authentification créées dans callcenter_auth'

-- Copier les données depuis callcenter
\echo 'Copie des données depuis callcenter...'

INSERT INTO "User" (id, email, password, "firstName", "lastName", role, "createdAt", "updatedAt")
SELECT id, email, password, "firstName", "lastName", role, "createdAt", "updatedAt"
FROM dblink(
    'dbname=callcenter',
    'SELECT id, email, password, "firstName", "lastName", role, "createdAt", "updatedAt" FROM "User"'
) AS t(id TEXT, email TEXT, password TEXT, "firstName" TEXT, "lastName" TEXT, role TEXT, "createdAt" TIMESTAMP(3), "updatedAt" TIMESTAMP(3))
ON CONFLICT (id) DO NOTHING;

INSERT INTO "AppSettings" (id, "minSignificantDurationSec", "createdAt", "updatedAt")
SELECT id, "minSignificantDurationSec", "createdAt", "updatedAt"
FROM dblink(
    'dbname=callcenter',
    'SELECT id, "minSignificantDurationSec", "createdAt", "updatedAt" FROM "AppSettings"'
) AS t(id TEXT, "minSignificantDurationSec" INTEGER, "createdAt" TIMESTAMP(3), "updatedAt" TIMESTAMP(3))
ON CONFLICT (id) DO NOTHING;

INSERT INTO "ApiKey" (id, "keyHash", name, description, "quotaPerMinute", "isActive", "createdBy", "createdAt", "lastUsedAt", "revokedAt", "revokedBy")
SELECT id, "keyHash", name, description, "quotaPerMinute", "isActive", "createdBy", "createdAt", "lastUsedAt", "revokedAt", "revokedBy"
FROM dblink(
    'dbname=callcenter',
    'SELECT id, "keyHash", name, description, "quotaPerMinute", "isActive", "createdBy", "createdAt", "lastUsedAt", "revokedAt", "revokedBy" FROM "ApiKey"'
) AS t(id TEXT, "keyHash" TEXT, name TEXT, description TEXT, "quotaPerMinute" INTEGER, "isActive" BOOLEAN, "createdBy" TEXT, "createdAt" TIMESTAMP(3), "lastUsedAt" TIMESTAMP(3), "revokedAt" TIMESTAMP(3), "revokedBy" TEXT)
ON CONFLICT (id) DO NOTHING;

\echo '✓ Données d''authentification migrées'

-- ============================================
-- ÉTAPE 3 : Renommer callcenter → callcenter_gerofinance
-- ============================================

\echo 'Étape 3/5 : Renommage de callcenter en callcenter_gerofinance...'

\c postgres

-- Déconnecter tous les utilisateurs de callcenter
SELECT pg_terminate_backend(pid) 
FROM pg_stat_activity 
WHERE datname = 'callcenter' AND pid <> pg_backend_pid();

-- Renommer la base
ALTER DATABASE callcenter RENAME TO callcenter_gerofinance;

\echo '✓ Base renommée : callcenter → callcenter_gerofinance'

-- ============================================
-- ÉTAPE 4 : Nettoyer les tables d'auth de callcenter_gerofinance
-- ============================================

\echo 'Étape 4/5 : Nettoyage des tables d''authentification dans callcenter_gerofinance...'

\c callcenter_gerofinance

-- Supprimer les tables d'auth (elles sont maintenant dans callcenter_auth)
DROP TABLE IF EXISTS "User" CASCADE;
DROP TABLE IF EXISTS "ApiKey" CASCADE;
DROP TABLE IF EXISTS "AppSettings" CASCADE;

\echo '✓ Tables d''authentification supprimées de callcenter_gerofinance'

-- ============================================
-- ÉTAPE 5 : Vérification
-- ============================================

\echo 'Étape 5/5 : Vérification...'

-- Vérifier callcenter_auth
\c callcenter_auth
SELECT 'callcenter_auth - Users: ' || COUNT(*) FROM "User";
SELECT 'callcenter_auth - ApiKeys: ' || COUNT(*) FROM "ApiKey";
SELECT 'callcenter_auth - AppSettings: ' || COUNT(*) FROM "AppSettings";

-- Vérifier callcenter_gerofinance
\c callcenter_gerofinance
SELECT 'callcenter_gerofinance - CDR records: ' || COUNT(*) FROM cdroutput;

-- Vérifier callcenter_edifea
\c callcenter_edifea
SELECT 'callcenter_edifea - Tables: ' || COUNT(*) FROM information_schema.tables WHERE table_schema = 'public';

COMMIT;

\echo ''
\echo '============================================'
\echo '✓ MIGRATION TERMINÉE AVEC SUCCÈS'
\echo '============================================'
\echo ''
\echo 'Prochaines étapes :'
\echo '1. Mettre à jour docker-compose.yml'
\echo '2. Mettre à jour le fichier .env'
\echo '3. Redémarrer les conteneurs : docker-compose down && docker-compose up -d'
\echo '4. Vérifier que l''application fonctionne'
\echo ''
