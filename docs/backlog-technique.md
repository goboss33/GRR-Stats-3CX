# Backlog technique — post mise en production

*Constitué pendant la mise en production du 7 août 2026. Rien d'urgent ;
ordre indicatif par valeur/risque.*

## 1. Supprimer l'API interne auto-appelée (`INTERNAL_API_KEY`)

Les statistiques d'équipe (vignettes du dashboard, cartes KPI, tableau des
agents) passent par `/api/analytics/*` en HTTP sur localhost, authentifiées
par une clé API stockée en base et rattachée à un utilisateur. Trois défauts
constatés :

- **amorçage** : une installation neuve est cassée tant qu'une clé n'a pas
  été créée à la main (vécu le 7 août : 401 « Invalid API key » sur toutes
  les vignettes de la prod fraîche) ;
- **couplage au propriétaire** : la clé hérite du périmètre de son
  propriétaire — compte désactivé ou périmètre réduit = vignettes cassées
  pour tout le monde ;
- **boucle HTTP locale** : latence et surface d'erreur inutiles.

**Cible** : extraire la logique des routes `/api/analytics/*` dans des
fonctions de service appelées directement (les routes restent l'enveloppe
pour les consommateurs EXTERNES — Excel, scripts — avec leurs clés et
quotas). La source unique est conservée ; `INTERNAL_API_KEY` disparaît du
compose, du Dockerfile et des runbooks.

**Leçon d'exploitation en attendant** : `INTERNAL_API_KEY` doit être créée
DANS l'application cible (Réglages ▸ Clés API) puis recopiée dans la stack —
jamais transportée d'un environnement à l'autre.

## 2. Sécuriser PostgreSQL

- Remplacer `postgres/postgres` : paramétrer `POSTGRES_PASSWORD` dans le
  compose ET les quatre `DATABASE_URL*` — à coordonner avec les connecteurs
  3CX (gerofinance + edifea) qui utilisent les mêmes identifiants.
  Changement à 3 endroits simultanés : compose/stack, 3CX ×2.
- Pare-feu : le port 5432 de `192.168.21.80` ne doit être joignable QUE
  depuis les machines 3CX (aujourd'hui : ouvert au LAN).

## 3. Certificats internes propres

Les certificats actuels n'ont pas d'extension SAN (les navigateurs les
refusent depuis ~2017, d'où l'avertissement permanent cliqué par tout le
monde). Réémettre sur la CA interne un certificat avec SAN
(`stats.grrsa.ch`, `*.gerofinance.local`) et déployer la CA par GPO :
supprime les avertissements pour TOUS les services du serveur
(Grafana, Portainer, l'app…).

## 4. Traefik : dashboard non protégé

`--api.insecure=true` expose le dashboard sur `:8080` sans
authentification. Le passer derrière l'entrypoint websecure avec un
middleware d'auth (ou restreindre par pare-feu aux IP d'administration).

## 5. Divers hérités de la bascule

- Recréer les clés API des consommateurs externes (Excel…) en prod, ou
  copier la base auth (étape 7 du runbook).
- Pré-prod (`192.168.2.100`) : geler 2-3 semaines après la bascule DNS,
  puis recycler en environnement d'essai — avec copie des données de prod,
  jamais l'inverse.
- Mettre à jour le runbook `deploiement-production.md` en « as-built »
  (CDR auto-réenvoyés par la 3CX : pas de dump/restore ; Traefik provider
  fichier ; leçons ANALYZE après chargement massif et shm_size).
