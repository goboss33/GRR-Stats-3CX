# Entrée et sortie des collaborateurs — scripts du service IT

Refonte des anciens `NouveauCollaborateur.ps1` et `DIsable-USerAccount.ps1`.
Même logique, même ordre d'étapes, mais : une configuration en données, un module
commun, un mode simulation, un mode test, des sélecteurs graphiques, une
checklist vivante, un rapport JSON, et le 3CX pris en charge par la XAPI.

| Fichier | Rôle |
|---|---|
| `config.json` | Sociétés, sites, OU, domaines, tenants, Planner, SMTP, PBX, opérateurs. **Tout ce qui était en dur.** |
| `Collaborateurs.psm1` | Le module commun : configuration, journal, étapes, mail, AD, Exchange, Graph, XAPI, coffre. |
| `Nouveau-Collaborateur.ps1` | L'entrée. |
| `Sortie-Collaborateur.ps1` | La sortie. |
| `Set-Secret.ps1` | Enregistre la clé XAPI, chiffrée pour la machine. |
| `exemples\*.json` | Fichiers de travail pour le mode sans dialogue (`-Job`). |

## Installation sur AD-VD01

1. Copier ce dossier dans `C:\SCRIPTS\Collaborateurs\` (les anciens scripts restent où ils sont, on ne les touche pas).
2. Dans une console PowerShell **5.1** en administrateur, dans ce dossier :

```powershell
Get-ChildItem -Recurse | Unblock-File
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
Get-Module -ListAvailable ActiveDirectory, ExchangeOnlineManagement, Microsoft.Graph.Authentication, Microsoft.Graph.Users, Microsoft.Graph.Identity.DirectoryManagement
```

   Les trois modules Microsoft sont ceux que l'ancien script de sortie utilisait déjà. S'il en manque un :

```powershell
Install-Module ExchangeOnlineManagement, Microsoft.Graph.Authentication, Microsoft.Graph.Users, Microsoft.Graph.Identity.DirectoryManagement -Scope AllUsers
```

3. Enregistrer la clé XAPI (une fois par machine) :

```powershell
.\Set-Secret.ps1
```

   Le script vérifie aussitôt qu'un jeton s'obtient. Utilisez de préférence un **principal de service dédié** aux scripts (Intégrations ▸ API du 3CX), et reportez son ID client dans `config.json` → `pbx.gerofinance.clientId`.

4. Vérifier `config.json` → `operateurs` : la clé est le **nom de session Windows** de chacun (`$env:USERNAME`). Si vous ouvrez la session avec `gbossens` et non `admingbo`, renommez la clé.

5. Vérifier la société **BARNES COMMERCIAL** : les deux anciens scripts ne s'accordaient pas (domaine `bcr` à la création, `prekf` à la sortie, tenant vide). `config.json` porte les valeurs de la sortie, marquées `_aVerifier`.

## Premier lancement — toujours en simulation

```powershell
.\Sortie-Collaborateur.ps1 -Simulation
```

Rien n'est écrit : chaque étape s'affiche avec ce qu'elle *aurait* fait, le rapport arrive sur `geoffrey.bossens@grrsa.ch` avec le sujet `[SIMULATION] [TEST] …`. Faites-le sur un départ récent, lisez le rapport, puis :

```powershell
.\Sortie-Collaborateur.ps1
```

Les deux scripts démarrent avec `ModeTest = $true` dans leur bloc `$Reglages` : **passez-le à `$false` quand vous êtes prêt** à envoyer au helpdesk et à créer les tâches Planner.

## Les réglages

En tête de chaque script, un bloc `$Reglages` ; chaque clé se surcharge en ligne de commande.

| Réglage | Effet |
|---|---|
| `ModeTest` | Mails vers `DestinataireTest`, sujet `[TEST]`, pas de tâche Planner. **Les actions sont réelles.** |
| `Simulation` | **Aucune écriture** : AD, Exchange, Graph, 3CX, mail. Tout est listé. Se combine avec `ModeTest`. |
| `EnvoyerMail` | Couper le mail (`-SansMail`). |
| `Gerer3CX` | Couper le volet 3CX (`-Sans3CX`). |
| `SynchroniserAdConnect` | Entrée : déclencher la synchronisation delta sur le serveur AD Connect (`giffre`), à distance. |
| `CreerTachePlanner` | Sortie : la tâche de suivi à 180 jours. |
| `ScanDelegations` | Sortie : le scan des redirections et délégations (le plus long). |

## Mode sans dialogue

```powershell
.\Nouveau-Collaborateur.ps1 -Job .\exemples\entree.json
.\Sortie-Collaborateur.ps1  -Job .\exemples\sortie.json -Simulation
```

Le JSON décrit tout, aucune question n'est posée. C'est le contrat avec le futur portail : il déposera un fichier, le script l'exécutera.

## Ce que fait le volet 3CX

**Entrée** : propose les postes libres — désactivés, ou nommés « libre » — du site (préfixe `prefixePostes` dans `config.json`, sinon tous), pose nom, prénom, e-mail, réactive, inscrit dans les files choisies. Le lendemain, l'application de statistiques le reconnaît par l'e-mail.

**Sortie** : retrouve le poste par l'e-mail, le retire de toutes ses files, vide l'e-mail, le **désactive** — le numéro reste réservé. Les règles entrantes (SDA) qui visent encore le poste sont **listées dans le rapport, pas réécrites** : à faire à la main pour l'instant.

## Où sont les traces

`logs\` : par opération, une transcription complète, le rapport en HTML et en JSON (avec les étapes et leur verdict). `cache\` : le cache des délégations, par société, valable dix jours.
