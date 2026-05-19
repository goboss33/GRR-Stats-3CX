# Call Center Analytics

Application web moderne pour l'analyse des statistiques d'un centre d'appels 3CX.

## 📋 Stack Technique

- **Frontend** : Next.js 15 (App Router), TypeScript, Tailwind CSS, Shadcn/ui, Lucide React
- **Base de données** : PostgreSQL avec Prisma ORM
- **Authentification** : NextAuth.js v5 (Auth.js)
- **Infrastructure** : Docker & Docker Compose

> **Note** : Les données CDR sont reçues en temps réel depuis le serveur 3CX.

## 🚀 Démarrage rapide

### Installation

1. **Cloner le projet**
   ```bash
   git clone <repository-url>
   cd GRR-Stats-3CX
   ```

2. **Lancer l'environnement de développement**


3. **Initialiser la base de données** (première fois uniquement)
   
   Dans un nouveau terminal :
   ```bash
   docker exec -it callcenter-frontend-dev npx prisma db push
   docker exec -it callcenter-frontend-dev npm run db:seed
   ```

## 📄 Licence

Projet propriétaire - Tous droits réservés.
