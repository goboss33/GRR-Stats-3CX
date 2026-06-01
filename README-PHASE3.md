# Phase 3 : Migration Multi-Tenant - Guide Rapide

## 🎯 Objectif
Migrer de l'architecture actuelle (1 base `callcenter`) vers l'architecture multi-tenant (3 bases).

## ⏱️ Durée estimée
**5-10 minutes** d'interruption de service

## 📦 Fichiers créés

| Fichier | Rôle |
|---------|------|
| `scripts/migration-multitenant.sql` | Script SQL de migration |
| `docker-compose.multitenant.yml` | Nouveau docker-compose pour multi-tenant |
| `GUIDE-MIGRATION.md` | Guide détaillé avec rollback |

---

## 🚀 Commandes à exécuter sur le serveur

### 1. Backup (RECOMMANDÉ)
```bash
docker exec callcenter-db pg_dump -U postgres callcenter > backup_callcenter_$(date +%Y%m%d_%H%M%S).sql
```

### 2. Arrêter l'application
```bash
docker stop callcenter-frontend
```

### 3. Exécuter la migration
```bash
# Copier le script dans le conteneur
docker cp scripts/migration-multitenant.sql callcenter-db:/tmp/

# Exécuter
docker exec -it callcenter-db psql -U postgres -d callcenter -f /tmp/migration-multitenant.sql
```

### 4. Vérifier
```bash
# Les 3 bases doivent exister
docker exec callcenter-db psql -U postgres -c "\l" | grep callcenter

# Vérifier le contenu
docker exec callcenter-db psql -U postgres -d callcenter_auth -c "SELECT COUNT(*) FROM \"User\";"
docker exec callcenter-db psql -U postgres -d callcenter_gerofinance -c "SELECT COUNT(*) FROM cdroutput;"
```

### 5. Remplacer docker-compose.yml
```bash
# Backup de l'ancien
cp docker-compose.yml docker-compose.yml.backup

# Utiliser le nouveau
cp docker-compose.multitenant.yml docker-compose.yml
```

### 6. Mettre à jour .env
```bash
# Éditer frontend/.env et ajouter :
DATABASE_URL_AUTH="postgresql://postgres:postgres@192.168.2.100:5432/callcenter_auth"
DATABASE_URL_GEROFINANCE="postgresql://postgres:postgres@192.168.2.100:5432/callcenter_gerofinance"
DATABASE_URL_EDIFEA="postgresql://postgres:postgres@192.168.2.100:5432/callcenter_edifea"

# Modifier DATABASE_URL existant :
DATABASE_URL="postgresql://postgres:postgres@192.168.2.100:5432/callcenter_gerofinance"
```

### 7. Redémarrer
```bash
docker-compose down
docker-compose up -d
```

### 8. Vérifier que tout fonctionne
```bash
docker logs callcenter-frontend --tail 50
```

---

## ✅ Checklist

- [ ] Backup créé
- [ ] Application arrêtée
- [ ] Migration exécutée sans erreur
- [ ] 3 bases créées (`callcenter_auth`, `callcenter_gerofinance`, `callcenter_edifea`)
- [ ] docker-compose.yml remplacé
- [ ] .env mis à jour
- [ ] Conteneurs redémarrés
- [ ] Application accessible
- [ ] Sélecteur de serveur visible
- [ ] Stats Gérofinance fonctionnelles

---

## 🔄 En cas de problème

Voir `GUIDE-MIGRATION.md` pour le plan de rollback complet.

**Rollback rapide :**
```bash
# Renommer la base
docker exec callcenter-db psql -U postgres -c "ALTER DATABASE callcenter_gerofinance RENAME TO callcenter;"

# Restaurer docker-compose.yml
cp docker-compose.yml.backup docker-compose.yml

# Redémarrer
docker-compose down
docker-compose up -d
```

---

## 📞 Questions ?

1. Le script SQL affiche des erreurs → Vérifier que la base `callcenter` existe et contient les tables
2. L'application ne démarre pas → Vérifier les logs : `docker logs callcenter-frontend`
3. Le sélecteur n'apparaît pas → Vérifier que `DATABASE_URL_EDIFEA` est défini dans .env
4. Les stats sont vides → Vérifier que `callcenter_gerofinance` contient des données

---

## 🎯 Prochaine étape

Une fois la migration réussie :
1. Configurer le connecteur 3CX Edifea pour pointer vers `callcenter_edifea`
2. Attendre les premières données Edifea
3. Tester le sélecteur avec les 2 serveurs
