# Entrée et sortie des collaborateurs — scripts du service IT

Refonte des anciens `NouveauCollaborateur.ps1` et `DIsable-USerAccount.ps1`.
Même logique, même ordre d'étapes, mais : une configuration en données, un module
commun, une **simulation qui ne peut pas écrire**, un mode test, une interface
entièrement dans le terminal, une checklist vivante, un rapport JSON, et le 3CX
pris en charge par la XAPI.

| Fichier | Rôle |
|---|---|
| `config.json` | Sociétés, sites, OU, domaines, tenants, Planner, SMTP, PBX, opérateurs, modèles de réponse automatique. **Tout ce qui était en dur.** |
| `Collaborateurs.psm1` | Le module commun : configuration, interface, journal, étapes, écritures, mail, AD, Exchange, Graph, XAPI, coffre. |
| `Nouveau-Collaborateur.ps1` | L'entrée. |
| `Sortie-Collaborateur.ps1` | La sortie. |
| `Test-Interface.ps1` | Banc d'essai de l'interface : aucune connexion, aucune écriture. |
| `Set-Secret.ps1` | Enregistre la clé XAPI, chiffrée pour la machine. |
| `exemples\*.json` | Fichiers de travail pour le mode sans dialogue (`-Job`). |

## Installation sur AD-VD01

1. Copier ce dossier dans `C:\SCRIPTS\Collaborateurs\` (les anciens scripts restent où ils sont, on ne les touche pas).

2. **PowerShell 7** porte l'interface complète. S'il manque :

```powershell
winget install --id Microsoft.PowerShell --source winget
```

   (ou le MSI depuis https://aka.ms/powershell-release?tag=stable). Les scripts se relancent d'eux-mêmes sous `pwsh` quand il est installé, quelle que soit la console de départ. **Windows Terminal** est recommandé pour les couleurs et les caractères (Store, ou `winget install Microsoft.WindowsTerminal`) ; la console classique fonctionne aussi.

3. Dans une console **PowerShell 7** en administrateur, dans le dossier :

```powershell
Get-ChildItem -Recurse | Unblock-File
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
Install-Module PwshSpectreConsole, MSAL.PS, ExchangeOnlineManagement, Microsoft.Graph.Authentication, Microsoft.Graph.Users, Microsoft.Graph.Identity.DirectoryManagement -Scope AllUsers
Get-Module -ListAvailable ActiveDirectory, PwshSpectreConsole, MSAL.PS, ExchangeOnlineManagement, Microsoft.Graph.Authentication
```

   `PwshSpectreConsole` = l'interface (panneaux, menus au clavier, indicateurs). `MSAL.PS` = la connexion unique à Microsoft 365. Les quatre autres sont ceux de l'ancien script. Sans Spectre, tout fonctionne en affichage simple ; sans MSAL.PS, les deux connexions classiques s'enchaînent.

4. Vérifier l'interface, sans rien connecter :

```powershell
.\Test-Interface.ps1
```

5. Enregistrer la clé XAPI (une fois par machine) :

```powershell
.\Set-Secret.ps1
```

   Le script vérifie aussitôt qu'un jeton s'obtient. Utilisez de préférence un **principal de service dédié** aux scripts (Intégrations ▸ API du 3CX), et reportez son ID client dans `config.json` → `pbx.gerofinance.clientId`.

6. Vérifier `config.json` → `operateurs` : la clé est le **nom de session Windows** de chacun (`$env:USERNAME`). Si vous ouvrez la session avec `gbossens` et non `admingbo`, renommez la clé.

7. Vérifier la société **BARNES COMMERCIAL** : domaine `bcr` confirmé, mais contrôleur, OU des désactivés et tenant restent marqués `_aVerifier`.

## Connexion unique à Microsoft 365

Sans réglage, Exchange Online puis Graph ouvrent chacun leur fenêtre de connexion. Pour n'en avoir **qu'une**, il faut une inscription d'application Entra en *client public* dont le jeton est transmis aux deux modules. À faire une fois, dans le portail Entra du tenant Gérofinance (vous pouvez étendre l'application « Service IT Planner » déjà utilisée pour le Planner, ou en créer une « Scripts IT ») :

1. **Authentification** ▸ *Ajouter une plateforme* ▸ **Applications mobiles et de bureau** ▸ URI de redirection `http://localhost`. Plus bas, **Autoriser les flux de client public : Oui**.
2. **Autorisations d'API** ▸ *Ajouter* ▸ Microsoft Graph ▸ **Déléguées** : `User.ReadWrite.All`, `Directory.ReadWrite.All`.
3. **Autorisations d'API** ▸ *Ajouter* ▸ onglet **API utilisées par mon organisation** ▸ chercher **Office 365 Exchange Online** ▸ **Déléguées** ▸ `Exchange.Manage`.
4. **Accorder le consentement d'administrateur** pour le tenant.
5. Reporter l'*ID d'application (client)* dans `config.json` → `m365.appId`.

Le compte qui se connecte reste le vôtre (`adminXXX@…onmicrosoft.com`) : l'application ne fait que porter la session, l'audit Microsoft montre toujours la personne. Le jeton Exchange vaut environ une heure : largement assez pour une sortie, sauf reconstruction complète du cache des délégations sur un très grand tenant — dans ce cas relancez sans connexion unique (`m365.connexionUnique: false`).

Edifea est un autre tenant : soit vous y inscrivez la même application et renseignez `m365AppId` sur la société, soit la connexion classique s'applique pour elle.

## La simulation ne peut pas écrire

Chaque écriture — AD, Exchange Online, Graph, 3CX, Planner — passe par une seule fonction du module, `Invoke-Ecriture`, qui en simulation **décrit** le geste dans le journal (`SIMULATION : Set-Mailbox x -Type Shared`) et ne l'exécute pas. On ne s'appuie plus sur `$WhatIfPreference` : les cmdlets Exchange Online l'ignorent, elles affichent « WhatIf : » et écrivent quand même — constaté le 03.09.2026 sur une vraie boîte. Le rapport part quand même (préfixe `[SIMULATION]`) : c'est la preuve de ce qui aurait été fait.

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
| `Simulation` | **Aucune écriture** : AD, Exchange, Graph, 3CX, Planner. Tout est décrit. Se combine avec `ModeTest`. |
| `EnvoyerMail` | Couper le mail (`-SansMail`). |
| `Gerer3CX` | Couper le volet 3CX (`-Sans3CX`). |
| `SynchroniserAdConnect` | Entrée : déclencher la synchronisation delta sur le serveur AD Connect (`giffre`), à distance. |
| `CreerTachePlanner` | Sortie : la tâche de suivi à 180 jours. |
| `ScanDelegations` | Sortie : le scan des redirections et délégations (le plus long). |

Variables d'environnement utiles : `COLLABORATEURS_SANS_PWSH=1` (ne pas se relancer sous PowerShell 7), `COLLABORATEURS_SANS_SPECTRE=1` (affichage simple).

## La réponse automatique

À la sortie, trois façons : un **modèle** de `config.json` → `sortie.reponsesAutomatiques.modeles`, un **texte personnalisé** tapé ou collé directement dans le terminal (fin par deux Entrée sur ligne vide, ou un point seul), ou désactiver. Dans les modèles, le script remplit `{Prenom}` `{Nom}` `{NomComplet}` `{Societe}` `{Date}` et, si une redirection a été choisie, `{Successeur}` `{SuccesseurEmail}` ; toute autre `{Variable}` est demandée. L'aperçu s'affiche avant de retenir le texte.

## Mode sans dialogue

```powershell
.\Nouveau-Collaborateur.ps1 -Job .\exemples\entree.json
.\Sortie-Collaborateur.ps1  -Job .\exemples\sortie.json -Simulation
```

Le JSON décrit tout, aucune question n'est posée. C'est le contrat avec le futur portail : il déposera un fichier, le script l'exécutera. Pour la sortie : `redirectionVers` (+ `redirectionVersNom`), et `reponseAuto` (texte) **ou** `reponseAutoModele` (id du modèle) avec `variables` pour ce que le script ne déduit pas.

## Ce que fait le volet 3CX

**Entrée** : propose les postes libres — désactivés, ou nommés « libre » — du site (préfixe `prefixePostes` dans `config.json`, sinon tous), pose nom, prénom, e-mail, réactive, inscrit dans les files choisies. Le lendemain, l'application de statistiques le reconnaît par l'e-mail.

**Sortie** : retrouve le poste par l'e-mail, le retire de toutes ses files, vide l'e-mail, le **désactive** — le numéro reste réservé. Les règles entrantes (SDA) qui visent encore le poste sont **listées dans le rapport, pas réécrites** : à faire à la main pour l'instant.

## Où sont les traces

`logs\` : par opération, une transcription complète, le rapport en HTML et en JSON (avec les étapes et leur verdict). `cache\` : le cache des délégations, par société, valable dix jours.
