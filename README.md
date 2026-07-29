# Call Center Analytics

Application web moderne pour l'analyse des statistiques d'un centre d'appels 3CX (multi-tenant).

## 📋 Stack technique

- **Frontend** : Next.js 15 (App Router), React 19, TypeScript (strict), Tailwind CSS, Shadcn/ui, Lucide React, Recharts
- **Base de données** : PostgreSQL (une base d'authentification + une base CDR par client) via Prisma ORM
- **Authentification** : NextAuth.js v5 (Auth.js) — identifiants + Microsoft Entra ID
- **Tests** : Vitest (logique métier du domaine)
- **Infrastructure** : Docker & Docker Compose

> **Note** : les données CDR sont reçues en temps réel depuis le serveur 3CX.

## 🚀 Démarrage rapide

### Prérequis

- Node.js 20+
- Docker & Docker Compose (pour PostgreSQL)

### Installation

1. **Cloner le projet**

   ```bash
   git clone <repository-url>
   cd GRR-Stats-3CX
   ```

2. **Configurer l'environnement**

   ```bash
   cp frontend/.env.example frontend/.env
   # puis renseigner les variables (bases de données, NEXTAUTH_SECRET,
   # Microsoft Entra ID, SEED_ADMIN_PASSWORD, ...)
   ```

3. **Installer les dépendances**

   ```bash
   cd frontend
   npm install
   ```

4. **Lancer la base de données**

   ```bash
   # depuis la racine du projet
   docker compose up -d postgres
   ```

5. **Initialiser la base** (première fois uniquement)

   ```bash
   cd frontend
   npm run db:push
   SEED_ADMIN_PASSWORD="<mot-de-passe-fort>" npm run db:seed
   ```

6. **Démarrer le serveur de développement**

   ```bash
   npm run dev
   ```

   L'application est disponible sur http://localhost:3000.

## 🚢 Déploiement & migrations

En conteneur, les migrations sont **automatiques** : `docker-entrypoint.sh` s'exécute
avant le serveur et applique, dans cet ordre :

1. les **migrations de données** (`frontend/prisma/sql/*.sql`) — idempotentes, non bloquantes ;
2. la **synchronisation du schéma** (`prisma db push`) — bloquante : sans les tables
   attendues, l'application serait dans un état indéfini ;
3. le démarrage du serveur.

> L'ordre importe : un renommage de valeur d'enum doit être appliqué **avant** `db push`,
> sinon `db push` détruirait le type au lieu de le renommer.

Un `pull & redeploy` suffit donc — aucune commande manuelle à lancer.

## 🧰 Scripts utiles (dans `frontend/`)

| Script | Description |
|---|---|
| `npm run dev` | Serveur de développement (Turbopack) |
| `npm run build` | Build de production (vérifie types + lint) |
| `npm run typecheck` | Vérification TypeScript seule |
| `npm run lint` | ESLint |
| `npm run test` | Tests unitaires (Vitest) |
| `npm run format` | Formatage Prettier |

## 📄 Licence

Projet propriétaire — Tous droits réservés.
