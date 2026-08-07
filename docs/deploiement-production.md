# Mise en production — runbook

*Établi le 6 août 2026. Pré-prod : `192.168.2.100` (Docker + Portainer + NPM,
stack opérationnelle, DNS interne `stats.grrsa.ch`). Production cible :
`192.168.21.80` (à confirmer — le message initial disait « 192.168.21..80 »).*

**Le point critique à comprendre avant de commencer** : les tables `cdroutput`
sont alimentées PAR la 3CX (sortie CDR vers PostgreSQL). Migrer l'application
ne suffit pas — il faut aussi **repointer la source CDR** vers la nouvelle
base, pour chaque tenant (gerofinance ET edifea, s'ils ont chacun leur 3CX).
C'est l'étape C3, la seule délicate du runbook.

---

## Décisions à prendre AVANT (5 minutes)

| # | Question | Recommandation |
|---|---|---|
| D1 | Le hostname reste `stats.grrsa.ch` ? | Oui — zéro changement Entra ID ni habitudes utilisateurs ; la bascule = un changement DNS |
| D2 | On copie l'historique CDR et la base auth ? | Oui aux deux — l'historique EST le produit, et la base auth porte utilisateurs, périmètres, réglages, registre |
| D3 | Que devient la pré-prod après ? | La garder 2-3 semaines en secours (rollback = re-bascule DNS), puis la recycler en vraie pré-prod avec une copie périodique des données |

---

## Phase A — Préparer le serveur `192.168.21.80`

```bash
# 1. Docker + compose
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER   # se reconnecter ensuite

# 2. Portainer
docker volume create portainer_data
docker run -d -p 9443:9443 --name portainer --restart=always \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v portainer_data:/data portainer/portainer-ce:latest

# 3. Nginx Proxy Manager (même outil qu'en pré-prod)
mkdir -p ~/npm && cd ~/npm
cat > docker-compose.yml <<'EOF'
services:
  npm:
    image: jc21/nginx-proxy-manager:latest
    restart: unless-stopped
    ports: ["80:80", "443:443", "81:81"]
    volumes:
      - ./data:/data
      - ./letsencrypt:/etc/letsencrypt
EOF
docker compose up -d
```

**Pare-feu** (principe : rien d'ouvert au-delà du nécessaire) :
- `443` : ouvert au LAN (utilisateurs) ;
- `5432` : ouvert UNIQUEMENT depuis les machines 3CX (sources CDR) — c'est la
  différence avec la pré-prod où `5432:5432` est exposé à tout le LAN ;
- `81` / `9443` (admin NPM / Portainer) : restreints aux IP d'administration.

---

## Phase B — Secrets et variables d'environnement

À générer sur n'importe quelle machine : `openssl rand -base64 32`

| Variable | Valeur en prod | Note |
|---|---|---|
| `NEXTAUTH_URL` | `https://stats.grrsa.ch` | Si D1 = oui |
| `NEXTAUTH_SECRET` | **NOUVELLE** (openssl) | Indépendante de la pré-prod ; seule conséquence : tout le monde se reconnecte une fois |
| `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` | **NOUVELLE** (openssl) | Clé propre à la prod — même rôle qu'en pré-prod (onglets qui survivent aux redéploiements) |
| `INTERNAL_API_KEY` | **Réutiliser** celle de pré-prod SI des consommateurs externes l'utilisent (Excel, scripts) ; sinon nouvelle | Inventorier qui l'appelle avant de trancher |
| `INTERNAL_API_URL` | `http://localhost:3000` | Inchangé |
| `AUTH_TRUST_HOST` | `true` | Inchangé |
| `AUTH_MICROSOFT_ENTRA_ID_ID` / `_SECRET` / `_TENANT_ID` | **Mêmes valeurs** qu'en pré-prod | Même app Entra. ⚠️ Si D1 = non (nouveau hostname) : ajouter l'URI de redirection `https://<nouveau>/api/auth/callback/microsoft-entra-id` dans l'app Entra AVANT la bascule |
| `AZURE_GROUP_ADMIN_ID` / `_MODERATOR_ID` / `_MANAGER_ID` / `_AGENT_ID` | **Mêmes valeurs** | Mêmes groupes Azure |
| `AZURE_GROUP_SUPERUSER_ID` / `_USER_ID` | Mêmes valeurs (héritage, repli) | |
| `DATABASE_URL`, `DATABASE_URL_AUTH`, `DATABASE_URL_GEROFINANCE`, `DATABASE_URL_EDIFEA` | Définies dans le compose (postgres interne) | Rien à saisir dans Portainer |

⚠️ **Durcissement reporté, à inscrire au backlog** : le compose embarque
`postgres:postgres` en dur (mot de passe ET URLs). Pour le jour J on garde
tel quel (le pare-feu 5432 compense) ; un commit ultérieur paramétrera
`POSTGRES_PASSWORD` proprement dans le compose ET les URLs.

---

## Phase C — Les bases de données

### C1. Dump depuis la pré-prod (`192.168.2.100`)

```bash
# Sur la pré-prod — noter l'HEURE EXACTE du dump (sert au rattrapage C4)
docker exec callcenter-db pg_dump -U postgres -Fc callcenter_auth        > auth.dump
docker exec callcenter-db pg_dump -U postgres -Fc callcenter_gerofinance > gerofinance.dump
docker exec callcenter-db pg_dump -U postgres -Fc callcenter_edifea      > edifea.dump
```

### C2. Restore sur la prod

Déployer d'abord la stack (Phase D) pour que le conteneur `callcenter-db`
existe, puis :

```bash
# Copier les dumps sur 192.168.21.80, puis :
docker exec -i callcenter-db createdb -U postgres callcenter_gerofinance
docker exec -i callcenter-db createdb -U postgres callcenter_edifea
docker exec -i callcenter-db pg_restore -U postgres -d callcenter_auth --clean --if-exists < auth.dump
docker exec -i callcenter-db pg_restore -U postgres -d callcenter_gerofinance < gerofinance.dump
docker exec -i callcenter-db pg_restore -U postgres -d callcenter_edifea < edifea.dump
# Redémarrer le frontend pour qu'il rejoue ses migrations/préchauffages sur les données restaurées
```

### C3. Repointer les sources CDR ⚠️ *l'étape délicate*

Dans la console de CHAQUE 3CX (gerofinance, et edifea si distincte) :
sortie CDR / intégration base de données → remplacer l'hôte `192.168.2.100`
par `192.168.21.80` (mêmes base/utilisateur/mot de passe). Noter l'heure de
bascule. Vérifier immédiatement qu'une ligne fraîche arrive :

```bash
docker exec callcenter-db psql -U postgres -d callcenter_gerofinance \
  -c "SELECT MAX(cdr_started_at) FROM cdroutput;"
```

### C4. Rattraper le delta (les appels entre C1 et C3)

```bash
# Sur la pré-prod — remplacer l'horodatage par l'heure du dump C1 (marge incluse)
docker exec callcenter-db psql -U postgres -d callcenter_gerofinance -c \
  "\copy (SELECT * FROM cdroutput WHERE cdr_started_at >= 'YYYY-MM-DD HH:MM:00+02') TO '/tmp/delta.csv' CSV"
docker cp callcenter-db:/tmp/delta.csv .
# Sur la prod :
docker cp delta.csv callcenter-db:/tmp/delta.csv
docker exec callcenter-db psql -U postgres -d callcenter_gerofinance -c \
  "CREATE TEMP TABLE delta (LIKE cdroutput INCLUDING DEFAULTS);
   \copy delta FROM '/tmp/delta.csv' CSV;
   INSERT INTO cdroutput SELECT * FROM delta ON CONFLICT (cdr_id) DO NOTHING;"
# Répéter pour edifea et pour cdrbilling si utilisé
```

### C5. Tuning PostgreSQL (fait à la main en pré-prod, à refaire)

```sql
ALTER SYSTEM SET work_mem = '32MB';
ALTER SYSTEM SET random_page_cost = 1.1;
ALTER SYSTEM SET maintenance_work_mem = '256MB';
ALTER SYSTEM SET shared_buffers = '1GB';
```
Puis `docker restart callcenter-db` (shared_buffers exige le redémarrage).
Les objets applicatifs (jit off par base, index composites, autovacuum) sont
rejoués automatiquement par l'entrypoint du frontend — rien à faire.

---

## Phase D — La stack dans Portainer

1. Portainer ▸ Stacks ▸ **Add stack** ▸ *Repository* :
   - URL : `https://github.com/goboss33/GRR-Stats-3CX`
   - Compose path : `docker-compose.yml`
   - Référence : `refs/heads/main`
   - Si le dépôt est privé : renseigner un PAT GitHub (droits `repo` lecture).
2. **Environment variables** : saisir la table de la Phase B.
3. Deploy. Premier build ~5-10 min. Suivre les logs du conteneur `callcenter-frontend` :
   les 4 étapes `[1/4]`→`[4/4]` doivent défiler, puis les préchauffages
   `[annuaire] préchauffé…`.

---

## Phase E — Proxy, certificat, DNS

1. **NPM prod** : Proxy Host `stats.grrsa.ch` → `http://192.168.21.80:3000`,
   WebSockets ON, Block common exploits ON.
2. **Certificat** : réutiliser celui de la pré-prod (NPM ▸ SSL Certificates ▸
   télécharger clé+cert sur l'ancien, importer *Custom* sur le nouveau) — ou en
   émettre un neuf sur la CA interne.
3. **Test AVANT la bascule DNS** : sur ton poste, pointer `stats.grrsa.ch` vers
   `192.168.21.80` dans `C:\Windows\System32\drivers\etc\hosts`, puis dérouler
   la Phase F complète. Retirer la ligne ensuite.
4. **Bascule DNS interne** : `stats.grrsa.ch` → `192.168.21.80`. Prévenir que
   chacun devra se reconnecter (nouveau NEXTAUTH_SECRET).

---

## Phase F — Vérifications post-déploiement

- [ ] Logs conteneur : migrations `[1/4]`→`[4/4]` sans erreur, préchauffages OK
- [ ] Connexion Microsoft ET connexion par mot de passe
- [ ] Dashboard : les chiffres du mois passé = ceux de la pré-prod (même donnée restaurée)
- [ ] `MAX(cdr_started_at)` avance en continu (la 3CX écrit bien sur la prod)
- [ ] Un appel de test → visible dans les logs de l'app en ~1 min
- [ ] Logs, statistiques d'équipe, carte de parcours d'une file
- [ ] Cloche d'alertes : les anomalies connues réapparaissent ; refaire les « ignorer » si la base auth n'a pas été copiée
- [ ] Réglages ▸ utilisateurs, périmètres, règles métier présents (preuve du restore auth)
- [ ] Changement de filtre dans les logs (pas de gel — Next 15.5 + clé d'actions)

## Phase G — Après la bascule

1. **Sauvegardes — la prod n'attend pas** : cron quotidien sur l'hôte :
   ```bash
   # /etc/cron.d/backup-callcenter  (03h00, rétention 14 jours)
   0 3 * * * root docker exec callcenter-db sh -c 'pg_dump -U postgres -Fc callcenter_auth > /tmp/a.dump && pg_dump -U postgres -Fc callcenter_gerofinance > /tmp/g.dump && pg_dump -U postgres -Fc callcenter_edifea > /tmp/e.dump' && d=$(date +\%F) && mkdir -p /backup/$d && docker cp callcenter-db:/tmp/a.dump /backup/$d/ && docker cp callcenter-db:/tmp/g.dump /backup/$d/ && docker cp callcenter-db:/tmp/e.dump /backup/$d/ && find /backup -maxdepth 1 -mtime +14 -exec rm -rf {} +
   ```
   Idéalement copiées HORS du serveur (NAS).
2. **Rollback** (si gros pépin < 48 h) : re-pointer le DNS ET les sorties CDR
   3CX vers `192.168.2.100` — la pré-prod intacte reprend, au trou de données
   près (rattrapable en sens inverse avec la méthode C4).
3. Pré-prod : geler 2-3 semaines, puis la dédier aux essais (avec une copie
   des données de prod, jamais l'inverse).
4. Backlog durcissement : mot de passe PostgreSQL paramétré, 5432 non exposé
   au-delà des 3CX, mises à jour Watchtower ou procédure de pull manuelle.
