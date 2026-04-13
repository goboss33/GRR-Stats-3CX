# 🔍 Rapport d'Analyse — GRR-Stats-3CX

## Contexte & Vue d'ensemble

Application Next.js 15 pour l'analyse des logs d'appels 3CX (CDR). Elle se connecte à une base PostgreSQL via Prisma et affiche un dashboard, des statistiques par file d'attente, et un journal d'appels très filtrable.

---

## 🏗️ Architecture Générale

```
frontend/
├── app/                    # Pages Next.js (App Router)
│   ├── (authenticated)/    # Pages protégées (dashboard, queues, statistics, admin)
│   └── api/                # API Routes (auth, export CSV, diagnostic)
├── components/             # Composants React UI
├── services/               # Couche métier
│   ├── domain/             # Types et logique métier (call.types.ts, call-aggregation.ts)
│   ├── repositories/       # Accès BDD (cdr.repository.ts)
│   ├── logs.service.ts     # Service pour les logs d'appels
│   ├── stats.service.ts    # Service pour le dashboard
│   └── statistics.service.ts # Service pour les stats par queue
├── types/                  # Re-exports pour compatibilité
└── lib/                    # Utilitaires (auth, prisma, utils)
```

Le pattern en couches (**Repository → Service → Page**) est clair et intentionnel. C'est une bonne base.

---

## ✅ Ce qui est bien fait

### 1. Architecture en couches bien définie
- Le `cdr.repository.ts` est clairement désigné comme **source unique** d'accès à la BDD. C'est documenté dans les commentaires.
- Le fichier `call-aggregation.ts` centralise la logique métier (direction, statut, catégorie des segments).
- Les types dans `call.types.ts` sont centralisés, et les vieux fichiers (`types/logs.types.ts`) font des **re-exports propres** pour la compatibilité.

### 2. Bonne gestion de l'authentification
- NextAuth v5 + middleware bien configuré.
- Les routes protégées sont gérées proprement dans `middleware.ts`.
- Gestion des rôles (ADMIN) pour l'accès au module logs.

### 3. UX du tableau de logs (très riche)
- Filtres inline dans les en-têtes de colonnes : très pratique.
- Le composant `active-filters.tsx` affiche clairement les filtres actifs, avec la possibilité de les supprimer un par un.
- Tri par colonne, pagination, visibilité des colonnes.
- Le **parcours d'appel** (journey) est visuel et informatif.

### 4. Stack technique solide et moderne
- Next.js 15, React 19, TypeScript strict, Prisma, shadcn/ui, Recharts.
- TailwindCSS bien utilisé pour un design cohérent.

---

## ⚠️ Problèmes identifiés

### 🔴 CRITIQUE — Duplication massive dans `logs.service.ts`

C'est le problème le plus important du projet.

**Le fichier fait 1629 lignes** et contient la même requête SQL complexe (avec ~10 CTEs) **trois fois** :
1. Fonction `getCallLogsSQL()` — pour afficher la requête en mode debug
2. Fonction `getAggregatedCallLogs()` — pour la vraie pagination
3. La même requête encore dans la **requête de comptage** (avec variations conditionnelles)

Le `buildAggregatedQueryParts()` centralise les paramètres WHERE, mais le corps de la requête SQL (les CTEs `call_aggregates`, `first_segments`, `last_segments`, `answered_segments`, `handled_by`, `call_queues`, `queue_outcome`, `queue_overflow`, `call_journey`) est **copié-collé** en quasi-totalité.

> **Conséquence** : chaque correction/amélioration de la logique doit être faite 2-3 fois manuellement.

---

### 🟠 MAJEUR — Incohérence entre `logs.service.ts` et `cdr.repository.ts`

Le principe du Repository Pattern est **partiellement respecté** :
- `cdr.repository.ts` gère correctement les métriques globales, les stats de files, etc.
- **Mais** `logs.service.ts` contient lui-même tout le SQL de la vue logs (1600 lignes de SQL inline dans le service).

Cela crée deux couches qui font du SQL direct : le Repository ET le Service. La frontière n'est pas respectée.

---

### 🟠 MAJEUR — SQL construit par concaténation de chaînes

Dans `logs.service.ts`, les requêtes sont construites par **interpolation de chaînes** (template literals), pas via les paramètres préparés de Prisma :

```typescript
// Exemple problématique
`cdr_started_at >= '${startDate.toISOString()}'`
```

Il y a bien une tentative d'échappement pour les recherches (`escapedValue.replace(/'/g, "''"`), mais c'est manuellement géré, ce qui est fragile. Prisma offre `prisma.$queryRaw` avec des paramètres typés pour éviter ça.

> **Risque d'injection SQL** sur les champs de recherche si l'échappement est incomplet.

---

### 🟡 MOYEN — Deux services trop similaires : `stats.service.ts` vs `statistics.service.ts`

- `stats.service.ts` (113 lignes) → Dashboard global
- `statistics.service.ts` (environ 200 lignes) → Stats par file d'attente

Les noms sont **trop proches** et prêtent à confusion. Renommer en `dashboard.service.ts` et `queue-statistics.service.ts` serait bien plus lisible.

---

### 🟡 MOYEN — `formatDuration` dupliqué

La même fonction `formatDuration` (secondes → `mm:ss`) existe à **deux endroits** :
- `services/domain/call-aggregation.ts` → retourne `"mm:ss"`
- `app/(authenticated)/dashboard/dashboard-client.tsx` — version locale → retourne `"Xm Ys"` (format différent !)

Deux formats différents pour la "même" chose, et personne ne sait laquelle utiliser.

---

### 🟡 MOYEN — LogsTable a trop de props (prop drilling massif)

Le composant `LogsTable` accepte **31 props** différentes. C'est un signe clair que la gestion d'état devrait être remontée dans un contexte React (ou un état global type Zustand) pour éviter ce passage de props en cascade.

---

### 🟡 MOYEN — Heatmap timezone non-gérée côté client

Dans le `cdr.repository.ts`, la heatmap utilise `MIN(cdr_started_at)` sans conversion de timezone (les données sont en UTC). L'heure affichée peut être décalée de 1h ou 2h pour les utilisateurs en Europe/Zurich selon la saison.

---

### 🟢 MINEUR — Fichiers de debug présents dans le repo

- `build_error.log` et `tsc_errors.log` dans `/frontend/`
- `cdr-analysis.txt`, `logs CDR bizarre à analyser.txt`, `test-queries.sql` à la racine du projet

Ces fichiers ne devraient pas être versionnés (ou au moins dans le `.gitignore`).

---

### 🟢 MINEUR — Pas de tests automatisés

Aucun test unitaire ou d'intégration. Pour la logique métier complexe (détermination du statut d'un appel, direction, etc.), quelques tests unitaires sur `call-aggregation.ts` seraient très précieux lors des refactors.

---

## 🖥️ UX — Analyse

### Points forts
- **Dashboard** : KPIs visuels clairs, comparaison N-1 avec flèches colorées, animations des chiffres, liens directs vers les logs filtrés. Très bien.
- **Logs** : Filtres inline dans les en-têtes, filtres actifs en chips supprimables, le parcours visuel (journey) est une vraie valeur ajoutée.
- **Queues** : Vue par file d'attente avec KPIs détaillés et tableau d'agents.

### Points à améliorer

| Problème | Impact |
|---|---|
| **Pas de retour visuel pendant le chargement des filtres** (le tableau disparaît et revient) | Moyen |
| **Le modal "Chaîne d'appel"** est très dense, difficile à lire sur petits écrans | Moyen |
| **Le sélecteur de file d'attente** (stats) ne mémorise pas le dernier choix | Faible |
| **Le modal "Chaîne d'appel"** est dense, difficile à lire sur petits écrans | Moyen |
| **Le sélecteur de file d'attente** (pour les stats) ne mémorise pas le dernier choix | Faible |
| **Pas de message d'erreur clair** si le serveur ne répond pas | Moyen |
| **Le dashboard ne s'auto-rafraîchit pas** — bouton manuel uniquement | Faible |
| **Mobile : le tableau des logs est difficilement utilisable** (scroll horizontal, filtres) | Fort |

---

## 🎯 Recommandations Prioritaires

### Priorité 1 — Réduire `logs.service.ts` (impact technique fort)
Extraire la requête SQL principale dans `cdr.repository.ts` et la réutiliser dans les deux fonctions (data + count). Le fichier devrait passer à ~400 lignes.

> [!IMPORTANT]
> **Point de vigilance :** La cohérence dashboard ↔ logs est un acquis précieux et fragile. Les logs sont la source de vérité (logique la plus testée). Lors du refactoring, les deux requêtes (dashboard et logs) doivent utiliser **exactement la même logique** de calcul de statut. Un clic sur un KPI du dashboard doit toujours retourner le même nombre de lignes que le filtre correspondant dans les logs.

### Priorité 2 — ~~Persister les filtres dans l'URL~~ ✅ Déjà fait
~~Utiliser `useSearchParams`~~ — Cette fonctionnalité est **déjà totalement implémentée** via `useSearchParams` et `router.replace()`. Tous les filtres (dates, statuts, texte, parcours, créneaux...) sont persistés dans l'URL et survivent à un refresh.

### Priorité 3 — Skeleton loading dans les tableaux
Remplacer le spinner simple par des `Skeleton` (shadcn/ui en a) pendant le rechargement. L'interface reste stable et l'utilisateur comprend qu'une mise à jour est en cours.

### Priorité 4 — Renommer les services
`stats.service.ts` → `dashboard.service.ts`  
`statistics.service.ts` → `queue-statistics.service.ts`

### Priorité 5 — Ajouter `DECISIONS.md` dans `.gitignore`... non
Ce fichier est en réalité très utile ! Il documente les choix techniques. Continuer à l'enrichir.

---

## 📊 Synthèse

| Critère | Note | Commentaire |
|---|---|---|
| Architecture générale | ⭐⭐⭐⭐ | Pattern Repository bien pensé |
| DRY | ⭐⭐ | logs.service.ts = gros problème |
| Sécurité | ⭐⭐⭐ | SQL injection partielle via concat |
| Types TypeScript | ⭐⭐⭐⭐⭐ | Excellent, tout est typé |
| UX Desktop | ⭐⭐⭐⭐ | Très riche, filtres excellents |
| UX Mobile | ⭐⭐ | Tableau difficile en mobile |
| Maintenabilité | ⭐⭐⭐ | Bonne base, service trop gros |
| Documentation | ⭐⭐⭐⭐ | DECISIONS.md très utile |
