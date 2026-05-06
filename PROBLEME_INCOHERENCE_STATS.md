# Problème d'Incohérence des Statistiques d'Agence V2

## Contexte Métier

### Architecture 3CX actuelle
- Les clients appellent soit le **numéro public de l'agence** (Google, etc.), soit **directement un agent** (ils ont son numéro direct)
- Les **files d'attente** servent principalement de **filet de sécurité** (débordement après 30s, ou redirection en cas de non-réponse)
- **Très rarement** le numéro de la file d'attente est appelé directement

### Le dilemme
L'ancienne statistique (PDF Excel) regroupait manuellement des agents faisant partie de la même file d'attente dans un même écran. Ils sont regroupés car ils **travaillent ensemble**, pas parce qu'ils partagent la même source d'appels.

**Le conflit** :
- 3CX donne des stats par **file d'attente** (technique)
- Le métier a besoin de stats par **équipe** (concept métier)
- Ces deux notions **ne correspondent pas** car la plupart des appels arrivent en DIRECT sur les extensions, pas via la file

### Objectif des statistiques
- Mesurer la performance **individuelle** des agents
- Mesurer la performance **globale de l'équipe**
- **Règle métier critique** : Si la stat a >20% d'appels perdus au niveau du groupe, les agents n'ont plus le droit au télétravail

---

## Le Problème d'Incohérence

### Symptôme
Sur une période d'un mois (avril 2026, file 993 - RR PULLY Gérance) :

| Métrique | KPIs (en haut) | Tableau agents (somme) | Écart |
|----------|---------------|----------------------|-------|
| **Directs reçus** | 1408 | 1489 | **+81** |
| **Directs répondus** | 659 | 670 | +11 |
| **Total reçus** | 2092 | 2173 | +81 |
| **Total répondus** | 1158 | 1169 | +11 |

**Les chiffres de la File sont cohérents** (684 reçus, 499 répondus dans les deux sections), mais les **Directs ne matchent pas**.

### Contrainte absolue
> "Quand les cadres vont lire cette stats, **aucune incohérence ne doit être visible**. Le total doit correspondre à ce qu'on voit en haut dans les KPIs. Faut que tout soit cohérent et pure."

---

## Investigation SQL

### Requête 1 : Compter les directs au niveau équipe (comme les KPIs)
```sql
-- Résultat attendu : ~1408
WITH all_queue_passages AS (...),
queue_agents AS (...)
SELECT
    COUNT(DISTINCT c.call_history_id) as direct_received_team,
    COUNT(DISTINCT CASE WHEN c.cdr_answered_at IS NOT NULL THEN c.call_history_id END) as direct_answered_team
FROM cdroutput c
WHERE ... (mêmes filtres que getTeamDirectStatsRaw)
```

**Résultat obtenu** : `0` (problème de paramètre lors de l'exécution, mais le chiffre réel est ~1408)

### Requête 2 : Compter les directs par agent et sommer (comme le tableau)
```sql
-- Résultat attendu : ~1489
WITH ... (même logique que getAgentStatsRaw CTE direct_calls)
SELECT SUM(direct_received) as direct_received_sum FROM direct_per_agent;
```

**Résultat obtenu** : `1422`

### Requête 3 : Identifier les call_history_id comptés plusieurs fois
```sql
-- Liste les appels "directs" qui touchent PLUSIEURS agents
SELECT 
    call_history_id,
    COUNT(DISTINCT agent_ext) as agent_count,
    STRING_AGG(DISTINCT agent_ext, ', ') as agents,
    BOOL_OR(was_answered) as any_answered
FROM direct_segments
GROUP BY call_history_id
HAVING COUNT(DISTINCT agent_ext) > 1
```

**Résultat obtenu** : **77 appels** touchant 2 agents chacun

**Calcul** :
- 77 appels × 2 agents = 154 "comptages agent"
- Au lieu de 77 "comptages équipe"
- Excédent : 154 - 77 = **77 appels en trop**

Les 77 appels multi-agents expliquent la quasi-totalité du delta de 81. Les 4 restants viennent d'autres cas limites.

### Requête 4 : Analyse d'un appel concret (call_history_id: ...0000012a)
Tracé complet de l'appel :
```
09:12:09 → Appel externe → Maxime (162) via DID → Maxime redirige (ne répond pas)
09:12:09 → File 993 → Overflow vers file 900 (RC PULLY) → Lucia (100) répond
09:13:16 → Lucia TRANSFÈRE l'appel à Maxime (162) → Maxime redirige encore
09:13:17 → File 993 → Aude (164) sonne mais annule
09:18:24 → Appel TRANSFÉRÉ à Filip (174) → Filip redirige
09:18:25 → File 993 → Aude (164) répond cette fois
```

---

## Cause Racine Identifiée

### Le problème
Les **transferts entre agents** sont comptés comme des "appels directs" pour chaque agent qui reçoit un transfert.

**Filtre actuel dans les requêtes SQL** :
```sql
AND (c.creation_forward_reason IS DISTINCT FROM 'polling')
```

Ce filtre exclut les appels via file (`polling`) mais **inclut les transferts** (`creation_forward_reason = 'none'`).

### Analyse du cas concret

| Segment | Agent | creation_forward_reason | Qualifie comme "direct" ? | Pourquoi ? |
|---------|-------|------------------------|--------------------------|------------|
| 2 | Maxime (162) | `by_did` | ✅ OUI | Appel externe via DID |
| 13 | Maxime (162) | `none` | ✅ OUI (INCORRECT) | C'est un TRANSFERT de Lucia ! |
| 24 | Filip (174) | `none` | ✅ OUI (INCORRECT) | C'est un TRANSFERT d'Aude ! |

### Scénario type d'un appel multi-agent
```
Externe → Maxime → File → Lucia → Maxime → File → Filip → File → Aude
```

**Comptage actuel (incorrect)** :
- 1 direct pour Maxime (segment 2 : vrai direct)
- 1 direct pour Maxime (segment 13 : transfert de Lucia)
- 1 direct pour Filip (segment 24 : transfert d'Aude)
- **Total tableau** : 3 "directs" (en fait 2 agents distincts)
- **Total équipe** : 1 direct (un seul appel)

---

## Définitions Discutées

### Qu'est-ce qu'un "appel direct" ?

**Définition retenue** : Un appel qui arrive **directement sur l'extension d'un agent** (pas via la file) OU un appel où **l'agent est le premier destinataire**.

**Nuance discutée** :
- Option 1 : Appel qui arrive directement sur l'extension (pas via file)
- Option 2 : Appel où l'agent est le premier destinataire
- **Conclusion** : Ces deux options sont quasi identiques dans la pratique car il est rare qu'un agent reçoive un appel via la file dont il serait le 1er destinataire

### Cas limites discutés

**Appels passant par un IVR/script** :
- Ex: `Externe → IVR → Maxime`
- Maxime est-il le "premier agent" ? → **Oui** (l'IVR n'est pas un agent)

**Appels transférés entre agents** :
- Ex: `Externe → Maxime → File → Lucia → Maxime`
- Pour Maxime : 1 direct (premier segment) + 1 via groupe (transfert de Lucia)
- Pour Lucia : 1 via groupe (transfert)
- **Règle** : Seul le **premier agent destinataire** reçoit un "direct", les autres reçoivent un "via groupe"

### Qu'est-ce qu'un "appel via groupe" ?

**Définition proposée** : L'agent reçoit l'appel mais **n'est pas le premier destinataire**.

**Exemples** :
- Appels de la file d'attente
- Appels interceptés
- Appels transférés par les collègues du groupe

---

## Pistes de Solution

### Solution A : Redéfinir "Direct" comme "Premier Agent Destinataire"

**Logique SQL proposée** :
```sql
-- Pour chaque call_history_id, trouver le PREMIER agent destinataire
first_agent AS (
    SELECT DISTINCT ON (call_history_id)
        call_history_id,
        destination_dn_number as first_agent_ext
    FROM cdroutput
    WHERE destination_dn_type = 'extension'
      AND cdr_started_at >= ${startDate}
      AND cdr_started_at <= ${endDate}
    ORDER BY call_history_id, cdr_started_at ASC, cdr_id ASC
)

-- Compter comme "direct" uniquement si first_agent_ext est dans l'équipe
```

**Avantages** :
- Élimine le double-comptage des transferts
- Total KPIs = Somme des lignes du tableau
- Logique claire et vérifiable

**Inconvénients** :
- Nécessite de modifier les deux requêtes SQL (`getTeamDirectStatsRaw` et `getAgentStatsRaw`)
- Changement de sémantique pour les utilisateurs habitués

### Solution B : Ajouter une colonne "Transferts reçus"

Séparer les appels en 3 catégories :
1. **Directs** : Premier agent destinataire
2. **Via file** : Appels passés par la file d'attente
3. **Transferts** : Appels transférés entre agents

**Avantages** : Plus de transparence
**Inconvénients** : Plus complexe, nécessite de nouvelles métriques

### Solution C : Utiliser les logs comme source de vérité

S'assurer que les KPIs cliquables mènent aux logs filtrés correctement, et que les chiffres correspondent.

**Vérifications nécessaires** :
- Cliquer sur "Directs: 128" → logs filtrés par `journeyFilter=[{type:"direct"}]`
- Cliquer sur "File: 104" → logs filtrés par `journeyFilter=[{type:"queue",queueNumber:"993"}]`
- Vérifier que les chiffres dans les logs correspondent aux KPIs

---

## État des Filtres dans les Logs

### Filtres existants

| Filtre | UI | SQL | Fonctionne ? |
|--------|-----|-----|-------------|
| `handledBySearch` (texte) | ✅ Input texte | `hb.agents::text ILIKE` | ✅ Oui |
| `journeyConditions` (parcours) | ✅ Popover complexe | `EXISTS jsonb_array_elements` | ✅ Oui |
| `queueSearch` | ✅ Combobox | `cq.queues::text ILIKE` | ✅ Oui |
| `handledByMultiSearch` | ❌ **Pas connecté à l'UI** | `hb.agents::jsonb @?` | ⚠️ SQL OK, UI manquante |

### Comment filtrer "appels directs pour Maxime (Ext. 162)" ?

**Méthode actuelle** (fonctionnelle mais complexe) :
1. Ouvrir le filtre "Parcours" (journey)
2. Ajouter une condition : `type: 'direct'`, `agentNumber: '162'`, `result: 'answered'`
3. Ou utiliser `handledBySearch = "162"` + `journeyConditions type: 'direct'`

**Limite** : Pas de filtre "en un clic" pour "directs de Maxime"

### Comment filtrer "appels via file pour Maxime" ?

**Méthode actuelle** :
- `journeyConditions` = `type: 'queue'`, `agentNumber: '162'`, `result: 'answered'`

### Ce qui manque

| Besoin | État | Action nécessaire |
|--------|------|-------------------|
| Filtrer par agent (texte) | ✅ OK | Rien |
| Filtrer par agent (multi-sélection) | ❌ UI manquante | Connecter `handledByMultiSearch` à l'UI |
| Distinguer direct vs file | ✅ OK via journey | Rien |
| Combinaison "agent + type" en un clic | ❌ Pas possible | Filtre composé ou preset |
| `handledByMultiSearch` dans l'URL | ❌ Non sérialisé | Ajouter dans `updateUrl()` |

---

## Données Clés pour Debug

### Fichiers de résultats SQL
- `result1.txt` : Requête équipe (retourne 0, problème de paramètre)
- `result2.txt` : Somme par agent = 1422
- `result3.txt` : 77 appels multi-agents identifiés
- `result4.txt` : Tracé complet d'un call_history_id problématique

### Exemples d'appels multi-agents (extrait de result3.txt)
```
call_history_id                     | agent_count | agents    | any_answered
------------------------------------+-------------+-----------+------------
...00001aa4                         | 2           | 162, 174  | true
...00001b46                         | 2           | 162, 164  | true
...00001bce                         | 2           | 164, 174  | true
...00001be4                         | 2           | 174, 177  | true
...00001c49                         | 2           | 174, 177  | true
... (77 appels au total)
```

### Extensions des agents de la file 993
- 139 : Robert-Charrue, Nicole
- 162 : Hofstetter, Maxime
- 163 : Meylan, Eva
- 164 : Devanthery, Aude
- 167 : Beauge, Damien
- 174 : Veseli, Filip
- 177 : Ahmetxhekaj, Merit

---

## Questions en Suspens

1. **Définition de "Direct"** : Es-tu d'accord avec "Direct = premier agent destinataire de l'appel" ?
2. **Appels via IVR** : Si un appel passe par un IVR avant d'arriver à un agent, l'agent est-il le "premier agent" ? (probablement oui)
3. **Priorité** : Commencer par la correction SQL (Phase 1) ou vérifier d'abord la cohérence avec les logs (Phase 2) ?
4. **Filtre multi-agents** : Est-ce une priorité ou peut-on le faire plus tard ?
5. **Exemples concrets** : As-tu des call_history_id spécifiques à tracer pour valider la nouvelle logique ?

---

## Prochaines Étapes Recommandées

### Phase 1 : Corriger le comptage des directs (racine du problème)
- Ajouter une CTE `first_agent_segment` dans les deux requêtes
- Modifier le filtre pour ne compter que les appels où l'agent est le `first_agent_ext`
- **Résultat attendu** : Plus de double-comptage, total KPIs = somme tableau

### Phase 2 : Vérifier la cohérence avec les logs
- Tester les KPIs cliquables vers les logs
- Vérifier que les chiffres correspondent
- S'assurer que les filtres journey fonctionnent correctement

### Phase 3 : (Optionnel) Améliorer le filtre multi-agents dans les logs
- Connecter `handledByMultiSearch` à l'UI
- Ajouter le paramètre dans `updateUrl()` pour la persistance
- Ajouter un composant de sélection multi-agents

---

## Notes Techniques

### Requêtes SQL concernées
- `getTeamDirectStatsRaw` (KPIs équipe) : `frontend/services/repositories/cdr.repository.ts` ligne ~438
- `getAgentStatsRaw` (tableau agents) : `frontend/services/repositories/cdr.repository.ts` ligne ~473
- CTE `direct_calls` dans `getAgentStatsRaw` : ligne ~550

### Filtre problématique à modifier
```sql
-- Actuel (inclut les transferts)
AND (c.creation_forward_reason IS DISTINCT FROM 'polling')

-- Problème : 'none' (transferts) est inclus car DISTINCT FROM 'polling'
```

### Composants Stat V2 concernés
- `team-overview.tsx` : Affiche les KPIs avec liens cliquables
- `agent-performance-table-v2.tsx` : Tableau des agents avec totaux
- Les deux utilisent les mêmes données mais les agrègent différemment

---

*Document créé le 06.05.2026 - Conversation avec opencode*
*Projet : GRR-Stats-3CX - Statistiques d'Agence V2*
*Branche : feat/statistics-v2*
