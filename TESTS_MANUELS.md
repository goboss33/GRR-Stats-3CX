# Tests Manuels de Validation — Refonte Architecture Données

## Contexte
Cette refonte centralise toute la logique de données dans une architecture Repository/Domain/Service.
L'objectif principal : **les mêmes filtres = les mêmes chiffres partout**.

---

## Test 1 : Parité Dashboard vs Logs — Volume d'appels

**Objectif** : Vérifier que le nombre total d'appels sur une période donnée est identique entre le Dashboard et les Logs.

1. Ouvrir le **Dashboard** (`/dashboard`)
2. Noter le chiffre **"Appels Uniques"** affiché (ex: `1 234`)
3. Noter la période sélectionnée (ex: `24/03/2026 → 31/03/2026`)
4. Aller sur **Logs d'appels** (`/admin/logs`)
5. Appliquer **exactement la même période** via le sélecteur de dates
6. **Ne filtrer aucune direction ni statut** (laisser tout coché)
7. Vérifier que le compteur **"X appels trouvés"** correspond au Dashboard

**Résultat attendu** : Les chiffres doivent être identiques (ou à ±1 près si un appel arrive entre les deux requêtes).

---

## Test 2 : Parité Dashboard vs Logs — Appels répondus

1. Sur le **Dashboard**, noter le chiffre **"Répondus"** et le **taux de réponse** (ex: `987` répondus, `80.0%`)
2. Sur **Logs**, avec la même période et sans filtre :
   - Filtrer uniquement le statut **"Répondu"**
   - Vérifier que le nombre de résultats correspond au Dashboard

**Résultat attendu** : Le nombre d'appels filtrés "Répondu" dans les Logs = "Répondus" du Dashboard.

---

## Test 3 : Parité Dashboard vs Logs — Appels manqués/abandonnés

1. Sur le **Dashboard**, noter le chiffre **"Manqués"** (ex: `247`)
2. Sur **Logs**, même période :
   - Filtrer uniquement le statut **"Abandonné"**
   - Vérifier la correspondance

**Résultat attendu** : Même chiffre.

---

## Test 4 : Cohérence des statuts dans les Logs

**Objectif** : Vérifier que la détermination de statut est cohérente entre la table et le détail d'un appel.

1. Aller sur **Logs d'appels**
2. Identifier un appel avec statut **"Répondu"**
3. Cliquer dessus pour ouvrir le **détail (Call Chain Modal)**
4. Vérifier qu'au moins un segment est catégorisé **"conversation"**
5. Identifier un appel avec statut **"Abandonné"**
6. Ouvrir le détail et vérifier qu'aucun segment n'est "conversation"

**Résultat attendu** : Le statut affiché dans la table correspond à la logique des segments dans le modal.

---

## Test 5 : Statistiques par file — Cohérence interne

**Objectif** : Vérifier que les KPIs d'une file sont cohérents entre eux.

1. Aller sur **Statistiques d'Agence** (`/statistics`)
2. Sélectionner une file d'attente
3. Noter les KPIs :
   - Appels reçus : `X`
   - Appels répondus : `Y`
   - Appels abandonnés : `Z`
   - Appels overflow : `W`
4. Vérifier que `Y + Z + W = X` (ou très proche, ±1 pour les cas limites)

**Résultat attendu** : La somme des outcomes = le total des appels reçus.

---

## Test 6 : Performance — Pas de régression

**Objectif** : Vérifier que la refonte n'a pas dégradé les performances.

1. Sur le **Dashboard**, mesurer le temps de chargement (devrait être < 3s)
2. Sur **Logs**, charger la première page avec 7 jours de données (devrait être < 5s)
3. Sur **Statistics**, charger les stats d'une file sur un mois (devrait être < 5s)

---

## Test 7 : Filtre directionnel cohérent

1. Sur **Logs**, filtrer uniquement **"Entrant"** (inbound)
2. Noter le nombre de résultats
3. Filtrer uniquement **"Sortant"** (outbound)
4. Noter le nombre de résultats
5. Filtrer uniquement **"Interne"** (internal)
6. Vérifier que la somme des 3 filtres individuels ≈ le total sans filtre

**Résultat attendu** : La somme des directions individuelles ≈ total global.

---

## Test 8 : Export CSV cohérent

1. Sur **Logs**, appliquer des filtres (période + statut)
2. Noter le nombre de résultats affichés
3. Cliquer sur **"CSV"** pour exporter
4. Ouvrir le CSV et compter le nombre de lignes
5. Vérifier la correspondance avec le nombre affiché

---

## Checklist de validation rapide

| Test | Dashboard | Logs | Statistics | Résultat |
|------|-----------|------|------------|----------|
| Volume total appels | [ ] | [ ] | — | ☐ PASS / ☐ FAIL |
| Appels répondus | [ ] | [ ] | — | ☐ PASS / ☐ FAIL |
| Appels manqués | [ ] | [ ] | — | ☐ PASS / ☐ FAIL |
| Cohérence statuts table/modal | — | [ ] | — | ☐ PASS / ☐ FAIL |
| Somme KPIs file | — | — | [ ] | ☐ PASS / ☐ FAIL |
| Performance | [ ] | [ ] | [ ] | ☐ PASS / ☐ FAIL |
| Filtres direction | — | [ ] | — | ☐ PASS / ☐ FAIL |
| Export CSV | — | [ ] | — | ☐ PASS / ☐ FAIL |
