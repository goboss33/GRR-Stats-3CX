# 📋 Décisions de Design — GRR Stats 3CX

> Ce document recense les choix de conception effectués pour l'outil de statistiques 3CX.
> Chaque décision est accompagnée de son contexte, de sa justification et des alternatives écartées.
> Dernière mise à jour : 3 mars 2026

---

## Table des matières

1. [Page Statistiques — Vue Queue](#1-page-statistiques--vue-queue)
    - [1.1 Le graphique ne montre que les appels queue](#11-le-graphique-ne-montre-que-les-appels-queue)
    - [1.2 Distinction appels répondus vs transférés](#12-distinction-appels-répondus-vs-transférés)
    - [1.3 Comptage des passages : Méthode N°2 (Tous les Passages)](#13-comptage-des-passages--méthode-n2-tous-les-passages)
    - [1.4 Filtrage des transferts : uniquement hors queue](#14-filtrage-des-transferts--uniquement-hors-queue)
    - [1.5 Exclusion des destinations techniques](#15-exclusion-des-destinations-techniques)
    - [1.6 Redirections = Overflow automatique](#16-redirections--overflow-automatique)
    - [1.7 Le phénomène du "Ping-Pong" — Décision Architecturale Majeure](#17-le-phénomène-du-ping-pong--décision-architecturale-majeure)
    - [1.8 Pivot vers les Appels Uniques comme métrique principale](#18-pivot-vers-les-appels-uniques-comme-métrique-principale)
    - [1.9 Bandeau "Bilan de l'équipe"](#19-bandeau-bilan-de-léquipe)
2. [Tableau Performance Agents](#2-tableau-performance-agents)
    - [2.1 Pourquoi pas de "Taux de réponse" individuel sur la queue](#21-pourquoi-pas-de-taux-de-réponse-individuel-sur-la-queue)
    - [2.2 Ajout des appels directs pour contextualiser](#22-ajout-des-appels-directs-pour-contextualiser)
    - [2.3 Score de performance (0–100)](#23-score-de-performance-0100)
    - [2.4 Jauge de charge visuelle](#24-jauge-de-charge-visuelle)
    - [2.5 Format "X/Total" pour Queue et Directs](#25-format-xtotal-pour-queue-et-directs)
    - [2.6 Colonnes supprimées et pourquoi](#26-colonnes-supprimées-et-pourquoi)
    - [2.7 Comment les transferts reçus sont comptabilisés](#27-comment-les-transferts-reçus-sont-comptabilisés)
    - [2.8 Les appels DID redirigés sont comptés comme "directs"](#28-les-appels-did-redirigés-sont-comptés-comme-directs)
    - [2.9 Résolveur Final — Crédit agent par appel unique](#29-résolveur-final--crédit-agent-par-appel-unique)
    - [2.10 Colonne "Interventions"](#210-colonne-interventions)
3. [Page Logs d'Appels](#3-page-logs-dappels)
    - [3.1 Détection des transferts dans le CDR](#31-détection-des-transferts-dans-le-cdr)
    - [3.2 Détection des interceptions (pickup)](#32-détection-des-interceptions-pickup)
    - [3.3 Tableau agrégé et modal de détail](#33-tableau-agrégé-et-modal-de-détail)
4. [Limitations connues](#4-limitations-connues)

---

## 1. Page Statistiques — Vue Queue

### 1.1 Le graphique ne montre que les appels queue

**Problème :** Faut-il intégrer les appels directs dans le graphique donut de la queue ?

**Décision :** Non. Le graphique montre **uniquement** les appels qui transitent par la queue.

**Justification :**
- Le donut raconte l'histoire d'un flux unique : "266 appels sont entrés dans la queue → que sont-ils devenus ?"
- Les appels directs sont propres à chaque agent, avec des volumes très différents. Les mélanger perdrait toute cohérence du total.
- Un graphique queue+direct n'aurait pas de "total" significatif puisque les directs de chaque agent sont indépendants.

**Alternative écartée :** Un second graphique pour les directs a été envisagé mais rejeté — il n'apporterait pas d'information actionnable au manager.

---

### 1.2 Distinction appels répondus vs transférés

**Problème :** Comment classifier un appel répondu par un agent puis transféré ?

**Décision :** Les appels transférés sont un **sous-ensemble** des appels répondus.

**Justification :**
- L'appel a bien été répondu (le client n'est pas resté sans interlocuteur).
- Le transfert est une action **volontaire** de l'agent après avoir décroché.
- Affichage : "156 répondus **dont transférés : 4**" → clair et non-ambiguë.

**Impact sur les données :**
- "Répondus" inclut les transférés → le taux de réponse de la queue n'est pas artificiellement gonflé ou dégonflé.
- Le nombre de transferts apparaît séparément pour information.

---

### 1.3 Comptage des passages : Méthode N°2 (Tous les Passages)

**⚠️ CHANGEMENT MAJEUR (12 février 2026) :** Cette section a été complètement révisée suite à la découverte que les passages multiples à travers une même queue (ping-pong) sont **très fréquents** dans notre système.

**Problème :** Un même appel peut passer plusieurs fois par la même queue (ex: client se trompe de choix, est transféré, puis revient à la réception qui le redirige correctement → 3-4 passages).

**Ancienne approche (Méthode N°1 - abandonnée) :**
- Comptage avec `DISTINCT ON (call_history_id)` pour ne compter que le premier passage
- **Problème identifié :** Masque complètement le phénomène du ping-pong (très fréquent)
- Ne reflète pas la charge réelle des agents (qui traitent plusieurs fois le même appel)

**Nouvelle approche (Méthode N°2 - retenue) :**
- Compter **tous les passages** à travers la queue, incluant les passages multiples
- Afficher **deux métriques simultanément** :
  - **Passages** : nombre total de fois qu'un appel entre dans la queue (incluant ping-pong)
  - **Appels uniques** : nombre de `call_history_id` distincts (appels réels)

**SQL utilisé :**
```sql
-- Plus de DISTINCT ON - compter chaque passage
WITH all_queue_passages AS (
    SELECT call_history_id, cdr_id, cdr_started_at, cdr_ended_at
    FROM cdroutput
    WHERE destination_dn_number = ${queueNumber}
      AND destination_dn_type = 'queue'
    -- PAS de ORDER BY, PAS de DISTINCT
)

SELECT
    COUNT(*) as total_passages,
    COUNT(DISTINCT call_history_id) as unique_calls,
    (COUNT(*) - COUNT(DISTINCT call_history_id)) as ping_pong_count
FROM all_queue_passages
```

**Affichage UI :**

**Donut center :**
```
┌─────────────────┐
│   360 passages  │  ← Grand, non-cliquable (information)
│ 📞 300 appels   │  ← Petit, cliquable (vers les logs)
│     uniques     │
└─────────────────┘
```

**KPI cards :**
```
┌────────────────────────────────┐
│ 🟢 Répondus            [65%] 🔗│
│                                │
│ 218 passages         ← Niveau 1│
│ 📞 210 appels uniques← Niveau 2│
│ 🔄 8 avec ping-pong  ← Niveau 3│
│    (3.8%)                      │
└────────────────────────────────┘
```

**Justification :**
- ✅ Reflète la charge **réelle** des agents : 218 passages = 218 interactions à gérer
- ✅ Rend visible le phénomène du ping-pong (essentiel pour l'optimisation opérationnelle)
- ✅ Transparence totale : les deux métriques sont affichées simultanément
- ✅ Correspondance exacte garantie entre statistiques et logs filtrés
- ✅ Le taux de ping-pong devient un **KPI stratégique** pour identifier les problèmes de routage

**Voir aussi :** [Section 1.7](#17-le-phénomène-du-ping-pong--décision-architecturale-majeure) pour l'analyse complète et les alternatives écartées.

---

### 1.4 Filtrage des transferts : uniquement hors queue

**Problème :** Un agent transfère un appel à un collègue de la même queue. Est-ce un "transfert" du point de vue du manager ?

**Décision :** **Non.** Seuls les transferts vers des personnes **en dehors de la queue** sont comptés.

**Justification :**
- Un transfert Diane → Filip (tous deux dans la même queue) est un "passage de relais" interne, pas un transfert du point de vue du flux de la queue.
- Le manager s'intéresse aux appels qui **quittent** la queue, pas aux réorganisations internes.
- Cela permet d'aligner le nombre de transferts dans les pastilles (graphique) et dans le tableau agents.

**Comment c'est implémenté :**
- Une CTE `queue_agents` identifie toutes les extensions qui sont agents de la queue.
- Le transfert est uniquement compté si la destination (`continued_in_cdr_id`) pointe vers une extension ou queue **hors** de cette liste.

---

### 1.5 Exclusion des destinations techniques

**Problème :** Certains transferts pointent vers des entrées techniques (ring groups `*.Main`, IVR, etc.) qui ne représentent pas un vrai transfert agent-à-agent.

**Décision :** Les destinations de type autre que `extension` ou `queue` sont exclues des transferts affichés.

**Justification :**
- Ces entrées techniques sont des artefacts du système 3CX, pas des actions volontaires d'un agent.
- Les inclure fausserait le comptage des "vrais" transferts vers des personnes.

---

### 1.6 Redirections = Overflow automatique

**Problème :** Quelle est la différence entre "redirigé" et "transféré" ?

**Décision :**
- **Redirigé (overflow)** = le **système** a automatiquement envoyé l'appel ailleurs (timeout, débordement, règles de routage)
- **Transféré** = un **agent** a manuellement transféré l'appel après l'avoir décroché

**Justification :**
- Ce sont deux mécanismes fondamentalement différents : automatique vs manuel.
- Le manager doit pouvoir distinguer "l'appel a été renvoyé car personne ne répondait" vs "l'agent a répondu et a choisi de transférer".

---

### 1.7 Le phénomène du "Ping-Pong" — Décision Architecturale Majeure

**Date de la décision :** 12 février 2026

**Contexte :** Lors de l'implémentation des KPI cards cliquables, nous avons découvert une **discordance systématique** entre les statistiques et les logs filtrés (ex: Queue 993 affichait 210 appels "Répondus" dans les statistiques, mais 218 résultats dans les logs filtrés).

#### Le Problème

**Cause identifiée :**
- Les **statistiques** comptaient le **premier passage uniquement** (via `DISTINCT ON (call_history_id, queue_number)`)
- Les **logs filtrés** matchaient **n'importe quel passage** à travers la queue

**Révélation majeure :**
> "En fait ce ne sont pas des cas aussi rare et exceptionnel en fait. C'est même plutôt fréquent. Les appels sont sans arrêt repassé à la réception. Imagine qu'un client se trompe de choix, il appuie 2 pour transporter, parle avec quelqu'un qui dit non finalement, donc redirigé vers la réception, qui lui réexplique les choix et le revoie vers le département correct. Plusieurs appels font donc 3-4 tours par les queues."

Cette révélation a **fondamentalement changé notre approche** : le ping-pong n'est pas un cas edge, c'est un **comportement normal et fréquent** du système.

#### Analyse des Approches

**Méthode N°1 : Premier Passage Uniquement (❌ REJETÉE)**

*Description :* Compter uniquement le premier passage via `DISTINCT ON (call_history_id, queue_number)`.

**Avantages ✅**
- Comptage "propre" : 1 appel = 1 passage
- Cohérence mathématique simple
- Correspond au nombre d'appelants uniques

**Inconvénients ❌**
- **Masque complètement le phénomène du ping-pong** (très fréquent selon le client)
- **Ne reflète pas la charge réelle** des agents (qui traitent plusieurs fois le même appel)
- **Incompatible avec le filtrage des logs** : impossible de garantir le match exact entre KPI et logs
- **Perte d'information critique** pour l'optimisation opérationnelle

**Verdict :** ❌ Rejetée car elle masque un comportement fréquent et important du système.

---

**Méthode N°2 : Tous les Passages (✅ RETENUE)**

*Description :* Compter **tous les passages** incluant les passages multiples, et afficher **deux métriques simultanément** (passages + appels uniques).

**Avantages ✅**
- **Rend visible le phénomène du ping-pong** (très fréquent selon le client)
- **Reflète la charge réelle** des agents : 218 passages = 218 interactions à gérer
- **Compatible avec le filtrage des logs** : match exact garanti entre KPI et logs filtrés
- **Transparence totale** : affichage simultané des deux métriques (passages + appels uniques)
- **Information exploitable** pour l'optimisation : taux de ping-pong = indicateur de qualité du routage
- **Permet de mesurer l'efficacité** : pourcentage de ping-pong = KPI stratégique

**Inconvénients ❌**
- Risque de confusion si les deux métriques ne sont pas clairement distinguées (résolu par le double affichage)
- Comptage "moins intuitif" pour les non-initiés (mais plus précis pour le métier)

**Verdict :** ✅ Retenue car elle fournit une vision complète et honnête du système, essentielle pour l'optimisation.

---

**Méthode N°3 : Filtrage Strict Premier Passage (❌ NON RETENUE)**

*Description :* Modifier le filtrage des logs pour matcher uniquement le premier passage via `WITH ORDINALITY`.

**Inconvénients ❌**
- Même problème fondamental que Méthode N°1 : masque le ping-pong
- Complexité SQL accrue (ORDINALITY, sous-requêtes groupées)
- Ne résout pas le problème métier : les passages multiples existent et doivent être visibles

**Verdict :** ❌ Non retenue car elle perpétue le même problème que la Méthode N°1.

---

#### Justification de la Décision Finale

**1. Fidélité à la Réalité Opérationnelle**

Les agents traitent réellement plusieurs fois le même appel. Ignorer ce phénomène reviendrait à sous-estimer leur charge de travail.

**2. Information Exploitable**

Le pourcentage de ping-pong devient un **KPI stratégique** pour identifier les problèmes de routage :

| Queue | Ping-pong | Interprétation |
|---|---|---|
| Queue 993 | 8 appels / 210 = **3.8%** | ✅ Bon routage |
| Queue 928 | 45 appels / 120 = **37.5%** | ⚠️ Problème à investiguer |

**3. Transparence vs Masquage**

Plutôt que de **choisir** entre "passages" ou "appels uniques", nous affichons **les deux simultanément**. Cette double affichage évite toute ambiguïté et permet à l'utilisateur de comprendre la situation complète.

**4. Cohérence avec les Logs Filtrés**

Les logs filtrés matchent **au moins un passage** avec le résultat demandé, ce qui correspond exactement au comptage de la Méthode N°2.

**Garantie de correspondance exacte :**
- Statistiques : `COUNT(*)` WHERE `result = 'answered'` → 218 passages
- Logs filtrés : `journeyQueue=903&journeyResult=answered` → 218 résultats
- **Match parfait** ✅

**5. Validation par le Client**

Lorsque présentée avec le choix entre Méthode N°1 et N°2, le client a confirmé :
> "tout en parallèle si tu t'en sens capable"

Et a validé les décisions UX/UI (terminologie "passages", double affichage, center non-cliquable, etc.).

---

#### Impact Métier

Les passages multiples à travers une même queue ont un **impact réel** sur :

1. **Charge de travail des agents** : ils traitent plusieurs fois le même appel
2. **Temps d'attente total des appelants** : augmente à chaque rebond
3. **Perception de l'efficacité** du routage téléphonique
4. **Décisions d'optimisation** du flux d'appels (IVR, scripts, formation des agents)

**Il est donc crucial de rendre ce phénomène visible et mesurable.**

---

#### Décisions UX/UI Associées

**Terminologie retenue :** "Passages" (pas "interactions")
- Plus précis techniquement (passage à travers une queue)
- Évite la confusion avec "interactions agent-client"
- Correspond au vocabulaire métier 3CX

**Cliquabilité du Donut Center :**
- Total "passages" : **non-cliquable** (information pure)
- "Appels uniques" : **cliquable** (redirige vers les logs)
- Justification : évite la surcharge cognitive, le total "passages" est purement informatif

**Hiérarchie Visuelle des Métriques :**
1. **Niveau 1 : Passages** (text-2xl, bold) → charge réelle
2. **Niveau 2 : Appels uniques** (text-sm, normal) → contexte
3. **Niveau 3 : Ping-pong** (text-[10px], conditionnel) → diagnostic

**Logique de Filtrage :**
- **"Au moins un passage répond au critère"** (logique OR)
- Exemple : Si un appel passe 2 fois par Queue 903 (1er passage abandonné, 2ème répondu) → compté dans "Répondus"
- Plus intuitif pour l'utilisateur final
- Correspond au comportement des KPI clickables

---

#### Filtre Multi-Passage (Bonus)

**Nouveau filtre ajouté :** `multiPassageSameQueue` (boolean)
- Permet de filtrer les appels avec passages multiples à travers la **même** queue
- Requiert `journeyQueueNumber` d'être défini
- URL exemple : `?journeyQueue=903&journeyResult=answered&multiPassage=true`

**UI :**
- Checkbox visible uniquement quand une queue est sélectionnée
- Texte : "🔄 Appels avec passages multiples"
- Description : "Filtre les appels qui sont repassés plusieurs fois par cette queue (ping-pong)"

**SQL :**
```sql
-- Compter les occurrences de la queue dans le journey
(SELECT COUNT(*)
 FROM jsonb_array_elements(cj.journey::jsonb) elem
 WHERE elem->>'type' = 'queue'
   AND elem->>'label' = '903') > 1
```

---

#### Nouveaux Champs dans `QueueKPIs`

```typescript
export interface QueueKPIs {
    // PASSAGES (Method N°2): Count ALL passages through queue, including ping-pong
    callsReceived: number;        // Total passages entrant dans la queue
    callsAnswered: number;        // Passages répondus par un agent
    callsAbandoned: number;       // Passages abandonnés total
    callsOverflow: number;        // Passages repartis ailleurs

    // APPELS UNIQUES (Method N°2): Count unique calls (DISTINCT call_history_id)
    uniqueCalls: number;          // Nombre d'appels uniques
    uniqueCallsAnswered: number;  // Appels uniques avec au moins un passage répondu
    uniqueCallsAbandoned: number; // Appels uniques avec au moins un passage abandonné
    uniqueCallsOverflow: number;  // Appels uniques avec au moins un passage overflow

    // PING-PONG METRICS (Method N°2): Measure multi-passage calls
    pingPongCount: number;        // callsReceived - uniqueCalls
    pingPongPercentage: number;   // (pingPongCount / callsReceived) * 100
}
```

---

#### Fichiers Modifiés

1. **`frontend/types/statistics.types.ts`** - Ajout des 6 nouveaux champs pour Méthode N°2
2. **`frontend/services/statistics.service.ts`** - Suppression `DISTINCT ON`, calcul double métriques
3. **`frontend/components/stats/unified-call-flow.tsx`** - Affichage double métriques (donut + cards)
4. **`frontend/types/logs.types.ts`** - Ajout `multiPassageSameQueue` filter
5. **`frontend/services/logs.service.ts`** - Implémentation filtre multi-passage (JSONB)
6. **`frontend/app/(authenticated)/admin/logs/page.tsx`** - State management multi-passage
7. **`frontend/components/column-filters/ColumnFilterJourney.tsx`** - UI checkbox multi-passage

---

#### Performances

**Impact de la suppression du DISTINCT ON :**
- **Avant :** Opération coûteuse (tri + déduplication)
- **Après :** Scan simple avec index sur `(destination_dn_number, destination_dn_type)`
- **Résultat :** Amélioration potentielle des performances

**Volumes estimés (1 mois) :**
- ~60000 appels + ~6000 passages supplémentaires (ping-pong 10%)
- Scan : ~66000 lignes
- Avec index : **< 100ms** ✅

---

#### Tests et Validation

**✅ Tests effectués :**
1. Correspondance exacte statistiques ↔ logs filtrés (Queue 993 : 218 = 218)
2. Double affichage (passages + appels uniques)
3. Filtre multi-passage fonctionnel
4. Cliquabilité correcte (center non-cliquable, KPI cards cliquables)

**✅ Cas d'usage validés :**
- Exemple concret : Appel `00000000-01dc-9c2f-9e44-d9cf00002e2d`
- Extension 593 → Extension 610 → Ring group 430 → IVR script → Queue 928 (abandonné)
- Journey complet visible dans les logs ✅
- Comptabilisé correctement comme 1 passage dans Queue 928 ✅

---

#### Évolutions Futures Possibles

1. **Analyse temporelle du ping-pong** : Graphique montrant l'évolution du taux dans le temps
2. **Top N des appels avec plus de passages** : Liste des appels avec 5+ passages (cas extrêmes)
3. **Détection automatique des boucles** : Alerter si un appel passe 3+ fois par la même queue
4. **Comparaison inter-queues** : Dashboard comparant les taux de ping-pong entre queues
5. **Export des données ping-pong** : CSV/Excel pour analyse approfondie avec les responsables

---

#### Conclusion

**Synthèse :** Nous avons choisi la **Méthode N°2** parce que :

1. ✅ Reflète la réalité opérationnelle (agents traitent plusieurs fois le même appel)
2. ✅ Rend visible un phénomène fréquent (ping-pong = quotidien, pas exception)
3. ✅ Fournit une information exploitable (taux de ping-pong = KPI stratégique)
4. ✅ Garantit la cohérence (match exact statistiques ↔ logs)
5. ✅ Transparence totale (double affichage évite toute confusion)
6. ✅ Validé par le client

**Leçon apprise :**
> Ne jamais faire d'hypothèses sur les "cas edge" sans valider avec les utilisateurs finaux. Ce qui semble anormal pour un développeur peut être le comportement normal du métier.

**Impact attendu :**
- Meilleure compréhension de la charge réelle des agents
- Détection proactive des problèmes de routage
- Optimisation guidée par les données (réduction du ping-pong = meilleure expérience client)
- Confiance des utilisateurs (correspondance exacte KPI ↔ logs)

---

### 1.8 Pivot vers les Appels Uniques comme métrique principale

**Date de la décision :** 3 mars 2026

**⚠️ CHANGEMENT MAJEUR :** Les **appels uniques** remplacent les **passages** comme métrique principale dans toute l'interface statistiques.

**Contexte :**
La Méthode N°2 (section 1.3) affichait les passages comme métrique principale et les appels uniques en secondaire. Après utilisation, plusieurs problèmes ont émergé :

1. **Incohérence avec les logs** : la page Logs affiche 1 ligne = 1 appel unique (`GROUP BY call_history_id`). Les managers comparant les deux pages voyaient des chiffres différents.
2. **Incohérence interne** : les trends daily/hourly utilisaient déjà `DISTINCT ON (call_history_id)` (appels uniques), alors que les KPIs et le donut utilisaient les passages.
3. **Complexité pour les managers** : le concept de "passages" nécessitait une explication systématique. Les managers comparaient le donut au total du tableau agents et ne comprenaient pas les différences.

**Décision :** Inverser la hiérarchie :
- **Primary** : Appels uniques (`DISTINCT call_history_id`) = tous les champs `callsReceived`, `callsAnswered`, etc.
- **Secondary** : Passages = champ `totalPassages`, utilisé uniquement pour la jauge de qualité ping-pong

**Détermination de l'outcome d'un appel unique — Approche par priorité :**

Un même appel peut passer plusieurs fois dans la queue (ping-pong). La première version utilisait le résultat du **premier passage** pour déterminer l'outcome. Cela créait une incohérence : un appel d'abord abandonné puis re-entré et décroché était classé "abandonné" par les KPIs mais crédité à un agent dans le tableau.

**Règle corrigée :** L'outcome d'un appel unique est déterminé par **priorité** :
1. Si **un passage quelconque** a été répondu → l'appel est **"répondu"**
2. Sinon, si **un passage quelconque** a été redirigé (overflow) → **"redirigé"**
3. Sinon → **"abandonné"**

```sql
-- Priority-based outcome per unique call
CASE
    WHEN bool_or(outcome = 'answered') THEN 'answered'
    WHEN bool_or(outcome = 'overflow') THEN 'overflow'
    ELSE 'abandoned'
END
```

Cette règle garantit que `SUM(agents.answered) == kpis.callsAnswered` (invariant donut ↔ tableau) car les deux utilisent la même définition de "répondu".

**Invariants fondamentaux :**
- `callsAnswered + callsAbandoned + callsOverflow == callsReceived` (partitionnement strict)
- `SUM(agents[].answered) == callsAnswered` (cohérence donut ↔ tableau)

**Justification :**
- Cohérence totale entre KPIs, donut, tableau agents, trends et logs
- Lecture immédiate pour les managers : 1 appel = 1 comptage
- Un appel finalement décroché = "répondu" (logique intuitive)
- Le ping-pong reste visible via la jauge de qualité (info secondaire)

---

### 1.9 Bandeau "Bilan de l'équipe"

**Date de la décision :** 3 mars 2026

**Problème :** Les appels directs des agents n'apparaissaient nulle part dans la vue d'ensemble. Le manager voyait uniquement les stats queue, mais un agent peu actif en queue peut être très chargé en directs.

**Décision :** Ajouter un bandeau "Bilan de l'équipe" au-dessus du donut, combinant queue + directs.

**Affichage :**
```
Bilan de l'équipe · Queue 3001
89 appels répondus
Queue: 42/55 (76%) · Directs: 47/55 (85%)
8 abandonnés · 5 redirigés
```

**Calculs :**
- Total répondus = `kpis.callsAnswered + kpis.teamDirectAnswered`
- Queue rate = `kpis.callsAnswered / kpis.callsReceived`
- Direct rate = `kpis.teamDirectAnswered / kpis.teamDirectReceived`
- `teamDirectReceived` / `teamDirectAnswered` = somme de tous les agents de la queue

**Justification :**
- Vue d'ensemble immédiate de l'activité totale de l'équipe
- Les directs et la queue sont présentés côte à côte avec leurs taux respectifs
- Le bandeau est un résumé, le détail reste dans le donut (queue) et le tableau (agents)

---

## 2. Tableau Performance Agents

### 2.1 Pourquoi pas de "Taux de réponse" individuel sur la queue

**Problème :** Un taux de réponse calculé sur les appels queue est **structurellement biaisé** à la baisse.

**Exemple concret :**
> Queue RC VEVEY : 632 appels, 9 agents.
> Chaque appel fait sonner ~5 agents simultanément.
> Van Hove reçoit 534 sonneries queue → décroche 116.
> Taux brut = 116/534 = **22%** ... mais est-ce mauvais ?
>
> Non ! Les 418 autres appels ont été **décrochés par un collègue**. Elle n'a pas "raté" ces appels — un seul agent peut décrocher chaque appel.

**Décision :** Le taux de réponse individuel basé sur la queue a été **supprimé** car il ne reflète pas la réalité du terrain.

**Constat clé :** Plus il y a d'agents dans une queue, plus le taux individuel est mathématiquement bas — même si la queue performe excellemment (70% de réponse globale). Ce chiffre créerait de la confusion et des conclusions erronées auprès du management.

**Alternative retenue :** Le [Score de performance](#23-score-de-performance-0100) remplace ce taux par une métrique composite plus juste.

---

### 2.2 Ajout des appels directs pour contextualiser

**Problème :** En ne regardant que les appels queue, un agent avec 15 appels queue répondus sur 286 semble inactif. Mais s'il a en parallèle traité 55 appels directs, il est en réalité très chargé.

**Décision :** Afficher les appels directs (reçus et répondus) dans le tableau agents.

**Justification :**
- Les agents reçoivent deux types d'appels : **queue** (partagés) et **directs** (nominatifs).
- Sans cette information, le manager pourrait conclure à tort qu'un agent ne travaille pas, alors qu'il est occupé sur des directs.
- La colonne "Directs" affiche le ratio `répondus/reçus` pour montrer la réactivité.

**Définition "appel direct" dans le CDR :**
- Appel où `destination_dn_type = 'extension'`
- ET qui n'est **pas** issu d'un polling queue (`creation_forward_reason != 'polling'`)
- ET qui n'est **pas** une sous-jambe d'un appel queue (exclu via `NOT EXISTS` sur les appels queue)

---

### 2.3 Score de performance (0–100)

**Problème :** Comment évaluer et comparer la performance globale des agents de manière juste ?

**Décision :** Un score composite sur 100, calculé comme suit :

| Composante | Poids | Formule | Logique |
|---|---|---|---|
| **Volume** | 60% | `min(mes_appels / moyenne_équipe, 1) × 60` | L'agent traite-t-il sa part du travail ? |
| **Réactivité directe** | 40% | `(directs_répondus / directs_reçus) × 40` | Quand on l'appelle directement, décroche-t-il ? |

**Interprétation :**
- 🟢 **70–100** : Agent performant, charge et réactivité solides
- 🟡 **40–69** : Performance dans la moyenne
- 🔴 **0–39** : Signal d'attention — volume faible ET/OU faible réactivité

**Pourquoi cette formule est juste :**
- Le **volume** est relatif à la moyenne de l'équipe, pas au total queue → pas de biais lié au nombre d'agents
- La **réactivité directe** utilise uniquement les appels directs (ratio individuel, pas "dilué" par le partage queue)
- Si un agent ne reçoit aucun appel direct → il reçoit le plein de réactivité (40/40), pas de pénalité

**Alternatives écartées :**
- Taux de réponse queue individuel → biaisé à la baisse (voir [2.1](#21-pourquoi-pas-de-taux-de-réponse-individuel-sur-la-queue))
- Taux global (queue+direct) → le dénominateur queue est partagé entre N agents, rendant le % structurellement bas
- Durée totale seule → ne mesure pas la réactivité

---

### 2.4 Jauge de charge visuelle

**Problème :** Comment voir instantanément si un agent est chargé ou non, et d'où vient sa charge ?

**Décision :** Une barre horizontale empilée (type "barre de vie") sous le nom de chaque agent.

**Composition :**
- 🟢 **Vert** = appels queue répondus
- 🔵 **Bleu** = appels directs répondus

**Mise à l'échelle :** La barre est proportionnelle à l'agent le **plus chargé** de l'équipe (= 100% de la largeur). Les autres sont proportionnels.

**Justification :**
- Le manager voit d'un coup d'œil qui est chargé et qui ne l'est pas.
- Le ratio vert/bleu montre la répartition queue vs directs.
- Un agent avec une barre courte est clairement sous-chargé par rapport à ses collègues.

---

### 2.5 Format "X/Total" pour Queue et Directs

**Décision :**
- **Queue** : `44/286` → 44 appels répondus sur 286 entrés dans la queue
- **Directs** : `30/38` → 30 appels directs répondus sur 38 reçus

**Justification :**
- Plus lisible qu'un pourcentage pour les petits nombres
- Le dénominateur donne immédiatement le contexte
- Pour la queue, le `/286` est le **même pour tous les agents** → comparaison directe
- Pour les directs, le `/38` est **propre à chaque agent** → montre le volume reçu

---

### 2.6 Colonnes supprimées et pourquoi

| Colonne supprimée | Raison |
|---|---|
| **Sollicitations** | Jargon technique (nombre de fois que le téléphone a sonné). Un même appel peut sonner N fois. Non actionnable pour le manager. |
| **Appels reçus** | Nombre d'appels uniques ayant fait sonner l'agent. Redondant avec le `/286` dans la colonne Queue et source de confusion avec le "taux de réponse". |
| **Taux de disponibilité** | Dépendait de "Appels reçus / Total queue". Impossible de distinguer "en ligne" vs "en pause" avec les données CDR. Remplacé par la jauge de charge. |
| **Taux de réponse** | Mathématiquement biaisé à la baisse pour les queues partagées (voir [2.1](#21-pourquoi-pas-de-taux-de-réponse-individuel-sur-la-queue)). Remplacé par le Score. |

---

### 2.7 Comment les transferts reçus sont comptabilisés

**Problème :** Quand un agent reçoit un appel par transfert (et non directement), comment est-il classé ?

**Décision :** Un appel transféré vers un agent est comptabilisé comme un **appel direct** pour cet agent.

**Deux scénarios concrets :**

**Scénario 1 — Transfert depuis une autre queue :**
> Lucia (réception) transfère un appel à Maxime (queue 905).
> Le CDR crée un nouveau segment : `destination = Maxime`, `creation_forward_reason ≠ 'polling'`, `originating_cdr_id = CDR de Lucia`.
> Le `originating_cdr_id` ne pointe pas vers un appel de la queue 905.
> → **Compté comme "direct" pour Maxime.** ✅

**Scénario 2 — Transfert au sein de la même queue :**
> Gabriela (queue 905) décroche un appel queue, puis le transfère à Maxime (même queue 905).
> La chaîne CDR : Appel → Queue 905 → Gabriela (polling) → transfert → Maxime.
> Le `originating_cdr_id` de Maxime pointe vers le CDR de Gabriela (pas directement vers la queue).
> → **Compté aussi comme "direct" pour Maxime.** ✅

**Pourquoi c'est correct :**
- **Côté queue** : l'appel est crédité à Gabriela (elle a décroché via polling). Pas de double comptage.
- **Côté Maxime** : il reçoit un appel et le traite — que ce soit un transfert ou un vrai appel direct, le travail est identique. Sa charge de travail est fidèlement représentée.
- Le score et la jauge de charge reflètent donc le **travail réel** de chaque agent, quelle que soit l'origine de l'appel.

**En résumé :** Le système ne fait pas de distinction entre "vrai appel direct" et "transfert reçu", car du point de vue de la charge de travail de l'agent, c'est équivalent.

---

### 2.8 Les appels DID redirigés sont comptés comme "directs"

**Problème :** Un appel destiné au numéro direct (DID) d'un agent peut être automatiquement redirigé vers sa queue si l'agent est absent (`forward_all`) ou occupé (`busy`). Le leg CDR vers l'extension de l'agent existe **avant** l'entrée en queue. Comment est-il comptabilisé ?

**Décision :** Ces legs sont comptés comme un **appel direct reçu non-répondu** (`direct_received +1`, `direct_answered +0`), puis l'appel est **aussi** compté dans la queue.

**3 exemples réels analysés (queue 905, semaine du 04–11/02) :**

**Exemple 1 - 00000000-01dc-9a8d-ff71-4b0700001448 - Appel DID Gabriela, busy, queue 905, Gabriela décroche :**
> `call_init → ext 189 (busy) → ring_group → script → queue 905 → Gabriela répond (polling)`
> - Direct Gabriela : `received +1`, `answered +0` (elle était occupée)
> - Queue 905 : `received +1`, `answered +1` (Gabriela via polling)

**Exemple 2 - 00000000-01dc-9b32-4f8f-6e0300001a70 — Appel DID Kevin (queue 093), David répond, transfert Gabriela, puis queue 905, Maxime répond :**
> `call_init → ext 132 Kevin (forward_all) → queue 093 → David répond → transfert ext 189 Gabriela (no_answer) → queue 905 → Maxime répond`
> - Queue 093 : `received +1`, `answered +1` (David), transfert +1
> - Direct Kevin (dans stats 093) : `received +1`, `answered +0`
> - Queue 905 : `received +1`, `answered +1` (Maxime)
> - Direct Gabriela (dans stats 905) : `received +1`, `answered +0` (transfert de David)

**Exemple 3 - 00000000-01dc-9b2c-9a7a-df8500001944 — Appel DID Maxime, forward_all, queue 905, Gabriela décroche :**
> `call_init → ext 186 Maxime (forward_all) → ring_group → script → queue 905 → Gabriela répond`
> - Direct Maxime : `received +1`, `answered +0` (forward_all actif)
> - Queue 905 : `received +1`, `answered +1` (Gabriela)

**Pourquoi c'est acceptable :**
- Le compteur `direct_received` reflète fidèlement le nombre d'appels ciblant l'agent par son DID
- Le `direct_answered = 0` montre que l'agent n'a **pas** décroché ces appels directs (busy ou absent)
- La queue comptabilise séparément le traitement effectif de l'appel
- Le manager peut repérer un agent avec beaucoup de `direct_received` mais peu de `direct_answered` → indication de `forward_all` activé ou saturation

**Alternative envisagée :** Exclure les legs `forward_all` des directs (via `termination_reason_details IS DISTINCT FROM 'forward_all'`). Rejeté car cela masquerait une information utile au manager.

---

### 2.9 Résolveur Final — Crédit agent par appel unique

**Date de la décision :** 3 mars 2026

**Problème :** Avec le passage aux appels uniques (section 1.8), comment créditer les agents ? Si un même appel est décroché 3 fois par différents agents (ping-pong), lequel obtient le crédit ?

**Décision :** Le **dernier agent à décrocher** dans la queue pour un appel donné = le "résolveur final" → il obtient le crédit dans la colonne `answered`.

**SQL :**
```sql
-- Pour chaque call_history_id, le DERNIER passage répondu
SELECT DISTINCT ON (call_history_id)
    call_history_id, cdr_id
FROM answered_passages
ORDER BY call_history_id, cdr_started_at DESC  -- DESC = dernier
```

**Invariant critique :**
`SUM(agents[].answered) == kpis.callsAnswered`

Cet invariant garantit que le total de la colonne "Queue (résolu)" dans le tableau = le nombre dans le donut "Répondus". Le manager voit des chiffres parfaitement cohérents.

**Justification :**
- Le dernier agent à décrocher est celui qui a effectivement résolu la demande du client
- Les agents intermédiaires ont contribué mais n'ont pas finalisé → comptés en "Interventions" (voir 2.10)
- Cohérence parfaite donut ↔ tableau : pas de confusion possible pour le manager

**Alternative écartée :** Créditer tous les agents qui ont décroché (style passages). Rejeté car `SUM(agents.answered)` > `kpis.callsAnswered`, créant une incohérence visible entre donut et tableau.

---

### 2.10 Colonne "Interventions"

**Date de la décision :** 3 mars 2026

**Problème :** Avec le résolveur final (2.9), un agent qui décroche un appel sans le résoudre (l'appel repart en ping-pong) perdrait toute trace de sa contribution.

**Décision :** Ajouter une colonne "Interventions" montrant le nombre d'appels où l'agent a décroché **sans être le résolveur final**.

**Affichage :** `+3` en badge discret (gris) — info secondaire de valorisation, pas de lien avec le donut.

**Exemple :**
```
| Agent   | Queue (résolu) | Interv. | Directs |
| Diane   | 15/50          | +3      | 12/18   |
| Filip   | 12/50          | +1      | 8/10    |
| TOTAL   | 40/50          | +6      | 27/46   |
```

**Invariant :** Pour un agent donné, un même `call_history_id` compte dans `answered` OU `interventions`, jamais les deux.

**Justification :**
- Valorise le travail intermédiaire des agents (ils ont quand même décroché et parlé au client)
- Ne casse pas la cohérence donut ↔ tableau (seul `answered` est lié au donut)
- Information complémentaire utile : un agent avec beaucoup d'interventions et peu de résolutions peut indiquer un problème de routing

---

## 3. Page Logs d'Appels

### 3.1 Détection des transferts dans le CDR

**Problème :** Comment identifier un transfert dans les données 3CX CDR ?

**Décision :** Un transfert est détecté quand `termination_reason = 'continued_in'` et qu'un `continued_in_cdr_id` pointe vers le segment suivant de l'appel.

**Justification :**
- C'est le mécanisme natif 3CX : l'agent met fin à sa participation (`continued_in`) et l'appel continue vers une autre destination.
- En suivant la chaîne `continued_in_cdr_id`, on peut reconstituer tout le parcours d'un appel.

### 3.2 Détection des interceptions (pickup)

**Décision :** Un appel intercepté est identifié par `creation_method = 'pickup'`.

**Justification :** Le pickup (interception) est un mécanisme distinct du polling queue : un agent choisit activement de prendre un appel qui sonne sur le poste d'un collègue.

### 3.3 Tableau agrégé et modal de détail

**Décision :** Le tableau principal affiche une vue agrégée (un appel = une ligne), et un clic ouvre une modale montrant tous les segments CDR de cet appel.

**Justification :**
- Un seul appel client peut générer 5 à 15 entrées CDR (queue, polling, transferts, ring groups...).
- Afficher tous les segments en liste serait illisible.
- L'agrégation par `call_history_id` donne une vue "1 appel = 1 ligne" qui correspond à la réalité perçue par le manager.
- La modale permet aux personnes techniques d'inspecter le détail quand nécessaire.

---

## 4. Limitations connues

| Limitation | Impact | Explication |
|---|---|---|
| **Impossible de distinguer "en ligne" vs "en pause/DND"** | Le taux de disponibilité ne peut pas être calculé précisément | Les données CDR ne contiennent que les appels effectifs. L'état "DND activé" ou "en pause" n'est pas enregistré dans le CDR. Une intégration avec l'API temps réel 3CX serait nécessaire. |
| **Les appels directs incluent les transferts reçus** | Le compteur "Directs" d'un agent peut inclure des appels transférés par un collègue | Un appel transféré vers l'agent crée un nouveau segment CDR identique à un appel direct. C'est acceptable car du point de vue charge de travail, c'est équivalent. |
| **Le score ne prend pas en compte les heures de travail** | Un agent à mi-temps aura un score de volume plus bas | Les données CDR ne contiennent pas les plannings. Une pondération par temps de présence nécessiterait une intégration RH. |
| **Les messageries vocales** | Les appels allant en messagerie ne sont pas comptabilisés dans les statistiques queue | Ils sont intentionnellement exclus car ils ne représentent pas un travail d'agent. |
