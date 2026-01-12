# Call Center Analytics

Application web moderne pour l'analyse des statistiques d'un centre d'appels 3CX.

## 📋 Stack Technique

- **Frontend** : Next.js 15 (App Router), TypeScript, Tailwind CSS, Shadcn/ui, Lucide React
- **Backend** : Python 3.11+, FastAPI
- **Base de données** : PostgreSQL avec Prisma ORM
- **Authentification** : NextAuth.js v5 (Auth.js)
- **Infrastructure** : Docker & Docker Compose

## 🚀 Démarrage rapide

### Prérequis

- [Docker](https://www.docker.com/get-started) & Docker Compose
- [Git](https://git-scm.com/)

### Installation

1. **Cloner le projet**
   ```bash
   git clone <repository-url>
   cd GRR-Stats-3CX
   ```

2. **Lancer l'environnement de développement**
   ```bash
   docker-compose -f docker-compose.dev.yml up --build
   ```

3. **Initialiser la base de données** (première fois uniquement)
   
   Dans un nouveau terminal :
   ```bash
   docker exec -it callcenter-frontend-dev npx prisma db push
   docker exec -it callcenter-frontend-dev npm run db:seed
   ```

4. **Accéder à l'application**
   - Frontend : [http://localhost:3000](http://localhost:3000)
   - Backend API : [http://localhost:8000](http://localhost:8000)
   - API Docs (Swagger) : [http://localhost:8000/docs](http://localhost:8000/docs)

## 👤 Utilisateurs de test

| Email | Mot de passe | Rôle | Accès |
|-------|-------------|------|-------|
| admin@demo.com | 1234 | Admin | Accès complet (Settings, Upload, Users) |
| manager@demo.com | 1234 | Superuser | Dashboards globaux |
| user@demo.com | 1234 | User | Dashboard personnel |

## 📁 Structure du projet

```
GRR-Stats-3CX/
├── docker-compose.yml          # Configuration prod
├── docker-compose.dev.yml      # Configuration dev (Hot reload)
├── README.md
│
├── backend/                    # Application FastAPI
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── main.py                 # Point d'entrée
│   └── app/                    # Logique métier
│
└── frontend/                   # Application Next.js
    ├── Dockerfile
    ├── Dockerfile.dev
    ├── package.json
    ├── next.config.mjs
    ├── tailwind.config.ts
    ├── middleware.ts           # Protection des routes
    │
    ├── app/                    # Pages (App Router)
    │   ├── layout.tsx
    │   ├── page.tsx
    │   ├── globals.css
    │   ├── login/
    │   ├── api/auth/
    │   └── (authenticated)/    # Routes protégées
    │       ├── layout.tsx
    │       ├── dashboard/
    │       └── admin/
    │
    ├── components/             # Composants React
    │   ├── header.tsx
    │   ├── sidebar.tsx
    │   └── ui/                 # Composants Shadcn
    │
    ├── lib/                    # Utilitaires
    │   ├── auth.ts             # Configuration NextAuth
    │   ├── prisma.ts
    │   └── utils.ts
    │
    └── prisma/                 # Schéma & Migrations
        ├── schema.prisma
        └── seed.ts
```

## 🔧 Commandes utiles

### Développement

```bash
# Démarrer l'environnement de dev
docker-compose -f docker-compose.dev.yml up --build

# Arrêter les containers
docker-compose -f docker-compose.dev.yml down

# Voir les logs
docker-compose -f docker-compose.dev.yml logs -f

# Accéder au container frontend
docker exec -it callcenter-frontend-dev sh
```

### Base de données

```bash
# Appliquer le schéma Prisma
docker exec -it callcenter-frontend-dev npx prisma db push

# Générer le client Prisma
docker exec -it callcenter-frontend-dev npx prisma generate

# Seed de la base de données
docker exec -it callcenter-frontend-dev npm run db:seed

# Ouvrir Prisma Studio
docker exec -it callcenter-frontend-dev npx prisma studio
```

### Production

```bash
# Démarrer en production
docker-compose up --build -d

# Arrêter
docker-compose down
```

## 🔒 Sécurité

- Toutes les routes `/dashboard/*` et `/admin/*` sont protégées par le middleware NextAuth
- Les routes `/admin/*` sont réservées aux utilisateurs avec le rôle `ADMIN`
- Les mots de passe sont hashés avec bcrypt

## 📝 Variables d'environnement

Copiez `.env.example` vers `.env` et modifiez les valeurs :

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/callcenter"
NEXTAUTH_URL="http://localhost:3000"
NEXTAUTH_SECRET="votre-secret-unique"
BACKEND_URL="http://localhost:8000"
```

## 🛣️ Roadmap

### Phase 1 (Actuelle)
- [x] Architecture Docker
- [x] Authentification NextAuth
- [x] Structure Frontend/Backend
- [x] UI Squelette (Dashboard, Upload, Settings)

### Phase 2 (À venir)
- [ ] Upload et parsing CSV
- [ ] Nettoyage des données (Pandas)
- [ ] Modèles de données complets (Extensions, CallRecords)
- [ ] API REST pour les statistiques

### Phase 3 (À venir)
- [ ] Dashboards interactifs avec graphiques
- [ ] Comparaisons mensuelles
- [ ] Export PDF/Excel
- [ ] Microsoft OAuth

## 📄 Licence

Projet propriétaire - Tous droits réservés.
