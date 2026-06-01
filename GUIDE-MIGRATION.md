# Guide de Migration Multi-Tenant - Phase 3

## ⚠️ IMPORTANT : À lire avant de commencer

Cette migration va **temporairement interrompre** l'application en production (5-10 minutes).

**Prérequis :**
- Accès SSH au serveur Docker
- Accès à la base PostgreSQL (psql ou pgAdmin)
- Backup récent de la base `callcenter` (recommandé)

---

## 📋 Plan d'exécution

### Étape 1 : Backup de sécurité (RECOMMANDÉ)

```bash
# Sur le serveur Docker
docker exec callcenter-db pg_dump -U postgres callcenter > backup_callcenter_$(date +%Y%m%d_%H%M%S).sql
```

### Étape 2 : Arrêter l'application (pour éviter les écritures pendant la migration)

```bash
# Arrêter uniquement le conteneur frontend (la base reste active)
docker stop callcenter-frontend
```

### Étape 3 : Exécuter le script de migration

**Option A : Via psql directement**
```bash
# Copier le script dans le conteneur
docker cp scripts/migration-multitenant.sql callcenter-db:/tmp/

# Exécuter le script
docker exec -it callcenter-db psql -U postgres -d callcenter -f /tmp/migration-multitenant.sql
```

**Option B : Via psql depuis votre machine**
```bash
psql -h 192.168.2.100 -U postgres -d callcenter -f scripts/migration-multitenant.sql
```

**Option C : Via pgAdmin**
1. Se connecter à PostgreSQL (192.168.2.100:5432)
2. Ouvrir l'éditeur SQL
3. Copier-coller le contenu de `migration-multitenant.sql`
4. Exécuter

### Étape 4 : Vérifier que la migration a réussi

```bash
# Vérifier que les 3 bases existent
docker exec callcenter-db psql -U postgres -c "\l" | grep callcenter

# Vous devriez voir :
# callcenter_auth
# callcenter_gerofinance
# callcenter_edifea
```

```bash
# Vérifier le contenu de callcenter_auth
docker exec callcenter-db psql -U postgres -d callcenter_auth -c "SELECT COUNT(*) FROM \"User\";"
docker exec callcenter-db psql -U postgres -d callcenter_auth -c "SELECT COUNT(*) FROM \"ApiKey\";"

# Vérifier le contenu de callcenter_gerofinance
docker exec callcenter-db psql -U postgres -d callcenter_gerofinance -c "SELECT COUNT(*) FROM cdroutput;"
```

### Étape 5 : Mettre à jour docker-compose.yml

**AVANT :**
```yaml
services:
  postgres:
    image: postgres:16-alpine
    container_name: callcenter-db
    environment:
      POSTGRES_DB: callcenter
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
    # ...

  frontend:
    image: callcenter-frontend
    container_name: callcenter-frontend
    environment:
      DATABASE_URL: postgresql://postgres:postgres@postgres:5432/callcenter
      # ...
```

**APRÈS :**
```yaml
services:
  postgres:
    image: postgres:16-alpine
    container_name: callcenter-db
    environment:
      POSTGRES_DB: callcenter_auth  # ← Changé
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
    # ...

  frontend:
    image: callcenter-frontend
    container_name: callcenter-frontend
    environment:
      DATABASE_URL_AUTH: postgresql://postgres:postgres@postgres:5432/callcenter_auth
      DATABASE_URL_GEROFINANCE: postgresql://postgres:postgres@postgres:5432/callcenter_gerofinance
      DATABASE_URL_EDIFEA: postgresql://postgres:postgres@postgres:5432/callcenter_edifea
      # Garder DATABASE_URL pour compatibilité temporaire
      DATABASE_URL: postgresql://postgres:postgres@postgres:5432/callcenter_gerofinance
      # ...
```

### Étape 6 : Mettre à jour le fichier .env (si utilisé)

```bash
# Sur le serveur, éditer le fichier .env
nano frontend/.env

# Ajouter ces lignes :
DATABASE_URL_AUTH="postgresql://postgres:postgres@192.168.2.100:5432/callcenter_auth"
DATABASE_URL_GEROFINANCE="postgresql://postgres:postgres@192.168.2.100:5432/callcenter_gerofinance"
DATABASE_URL_EDIFEA="postgresql://postgres:postgres@192.168.2.100:5432/callcenter_edifea"

# Modifier DATABASE_URL (temporaire, pour compatibilité)
DATABASE_URL="postgresql://postgres:postgres@192.168.2.100:5432/callcenter_gerofinance"
```

### Étape 7 : Redémarrer les conteneurs

```bash
# Redémarrer avec la nouvelle configuration
docker-compose down
docker-compose up -d

# Vérifier que les conteneurs tournent
docker-compose ps
```

### Étape 8 : Vérifier que l'application fonctionne

```bash
# Vérifier les logs
docker logs callcenter-frontend --tail 50

# Tester l'application
curl http://localhost:3000/api/health  # ou votre endpoint de santé
```

1. Ouvrir l'application dans le navigateur
2. Se connecter
3. Vérifier que le sélecteur de serveur apparaît dans la sidebar
4. Basculer entre Gérofinance et Edifea
5. Vérifier que les stats s'affichent correctement pour Gérofinance
6. Edifea sera vide (normal, pas encore de données)

---

## 🔄 Plan de Rollback (en cas de problème)

Si quelque chose ne fonctionne pas après la migration :

### Option 1 : Restaurer depuis le backup

```bash
# Arrêter l'application
docker stop callcenter-frontend

# Supprimer les nouvelles bases
docker exec callcenter-db psql -U postgres -c "DROP DATABASE IF EXISTS callcenter_auth;"
docker exec callcenter-db psql -U postgres -c "DROP DATABASE IF EXISTS callcenter_edifea;"

# Renommer callcenter_gerofinance → callcenter
docker exec callcenter-db psql -U postgres -c "ALTER DATABASE callcenter_gerofinance RENAME TO callcenter;"

# Restaurer les tables d'auth depuis le backup
docker exec -i callcenter-db psql -U postgres -d callcenter < backup_callcenter_YYYYMMDD_HHMMSS.sql

# Restaurer docker-compose.yml et .env (version précédente)
# Redémarrer
docker-compose down
docker-compose up -d
```

### Option 2 : Rollback rapide (sans backup)

```bash
# Renommer callcenter_gerofinance → callcenter
docker exec callcenter-db psql -U postgres -c "ALTER DATABASE callcenter_gerofinance RENAME TO callcenter;"

# Recréer les tables d'auth dans callcenter
docker exec callcenter-db psql -U postgres -d callcenter << 'EOF'
-- Recréer les tables (le script de migration les a supprimées)
CREATE TABLE "User" (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    role TEXT NOT NULL DEFAULT 'USER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE TABLE "AppSettings" (
    id TEXT PRIMARY KEY DEFAULT 'global',
    "minSignificantDurationSec" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE TABLE "ApiKey" (
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

CREATE INDEX "ApiKey_isActive_idx" ON "ApiKey"("isActive");
CREATE INDEX "ApiKey_createdBy_idx" ON "ApiKey"("createdBy");
EOF

# Copier les données depuis callcenter_auth
docker exec callcenter-db psql -U postgres -d callcenter << 'EOF'
INSERT INTO "User" SELECT * FROM dblink('dbname=callcenter_auth', 'SELECT * FROM "User"') AS t(id TEXT, email TEXT, password TEXT, "firstName" TEXT, "lastName" TEXT, role TEXT, "createdAt" TIMESTAMP(3), "updatedAt" TIMESTAMP(3));
INSERT INTO "AppSettings" SELECT * FROM dblink('dbname=callcenter_auth', 'SELECT * FROM "AppSettings"') AS t(id TEXT, "minSignificantDurationSec" INTEGER, "createdAt" TIMESTAMP(3), "updatedAt" TIMESTAMP(3));
INSERT INTO "ApiKey" SELECT * FROM dblink('dbname=callcenter_auth', 'SELECT * FROM "ApiKey"') AS t(id TEXT, "keyHash" TEXT, name TEXT, description TEXT, "quotaPerMinute" INTEGER, "isActive" BOOLEAN, "createdBy" TEXT, "createdAt" TIMESTAMP(3), "lastUsedAt" TIMESTAMP(3), "revokedAt" TIMESTAMP(3), "revokedBy" TEXT);
EOF

# Supprimer les bases inutiles
docker exec callcenter-db psql -U postgres -c "DROP DATABASE IF EXISTS callcenter_auth;"
docker exec callcenter-db psql -U postgres -c "DROP DATABASE IF EXISTS callcenter_edifea;"

# Restaurer docker-compose.yml et .env
# Redémarrer
docker-compose down
docker-compose up -d
```

---

## ✅ Checklist post-migration

- [ ] Les 3 bases existent (`callcenter_auth`, `callcenter_gerofinance`, `callcenter_edifea`)
- [ ] `callcenter_auth` contient les utilisateurs et API keys
- [ ] `callcenter_gerofinance` contient les CDR (vérifier le count)
- [ ] `callcenter_edifea` est vide (normal)
- [ ] L'application démarre sans erreur
- [ ] La connexion fonctionne
- [ ] Le sélecteur de serveur apparaît dans la sidebar
- [ ] Les stats Gérofinance s'affichent correctement
- [ ] Edifea affiche "Aucune donnée" (normal)
- [ ] docker-compose.yml est à jour
- [ ] .env est à jour

---

## 📞 Support

En cas de problème :
1. Vérifier les logs : `docker logs callcenter-frontend`
2. Vérifier la connexion DB : `docker exec callcenter-db psql -U postgres -c "\l"`
3. Tester manuellement les requêtes SQL
4. Utiliser le plan de rollback si nécessaire

---

## 🎯 Prochaine étape

Une fois la migration réussie :
- Configurer le connecteur 3CX Edifea pour pointer vers `callcenter_edifea`
- Attendre que les premières données Edifea arrivent
- Vérifier que le sélecteur fonctionne correctement avec les 2 serveurs
