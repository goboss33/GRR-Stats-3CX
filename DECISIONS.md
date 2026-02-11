# 📋 Décisions de Design — GRR Stats 3CX

> Ce document recense les choix de conception effectués pour l'outil de statistiques 3CX.
> Chaque décision est accompagnée de son contexte, de sa justification et des alternatives écartées.
> Dernière mise à jour : 11 février 2025

---

## Table des matières

1. [Page Statistiques — Vue Queue](#1-page-statistiques--vue-queue)
    - [1.1 Le graphique ne montre que les appels queue](#11-le-graphique-ne-montre-que-les-appels-queue)
    - [1.2 Distinction appels répondus vs transférés](#12-distinction-appels-répondus-vs-transférés)
    - [1.3 Comptage unique des appels (DISTINCT)](#13-comptage-unique-des-appels-distinct)
    - [1.4 Filtrage des transferts : uniquement hors queue](#14-filtrage-des-transferts--uniquement-hors-queue)
    - [1.5 Exclusion des destinations techniques](#15-exclusion-des-destinations-techniques)
    - [1.6 Redirections = Overflow automatique](#16-redirections--overflow-automatique)
2. [Tableau Performance Agents](#2-tableau-performance-agents)
    - [2.1 Pourquoi pas de "Taux de réponse" individuel sur la queue](#21-pourquoi-pas-de-taux-de-réponse-individuel-sur-la-queue)
    - [2.2 Ajout des appels directs pour contextualiser](#22-ajout-des-appels-directs-pour-contextualiser)
    - [2.3 Score de performance (0–100)](#23-score-de-performance-0100)
    - [2.4 Jauge de charge visuelle](#24-jauge-de-charge-visuelle)
    - [2.5 Format "X/Total" pour Queue et Directs](#25-format-xtotal-pour-queue-et-directs)
    - [2.6 Colonnes supprimées et pourquoi](#26-colonnes-supprimées-et-pourquoi)
    - [2.7 Comment les transferts reçus sont comptabilisés](#27-comment-les-transferts-reçus-sont-comptabilisés)
    - [2.8 Les appels DID redirigés sont comptés comme "directs"](#28-les-appels-did-redirigés-sont-comptés-comme-directs)
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

### 1.3 Comptage unique des appels (DISTINCT)

**Problème :** Un même appel peut générer plusieurs entrées CDR quand il est re-présenté à la queue (ex: un appel rebondit 3 fois avant d'être décroché).

**Décision :** Chaque appel est compté **une seule fois** grâce à `DISTINCT ON (call_history_id)`.

**Justification :**
- Sans ce filtre, un appel rebondissant 3 fois serait compté 3 fois dans les "reçus", gonflant artificiellement les chiffres.
- Avec le filtre, le total correspond au nombre **réel** de personnes ayant appelé.

**SQL utilisé :**
```sql
SELECT DISTINCT ON (call_history_id) ...
ORDER BY call_history_id, cdr_started_at ASC
```
La première entrée chronologique est conservée pour chaque `call_history_id`.

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
