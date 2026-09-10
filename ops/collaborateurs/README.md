# Entrée et sortie des collaborateurs — scripts du service IT

Refonte des anciens `NouveauCollaborateur.ps1` et `DIsable-USerAccount.ps1`.
Même logique, même ordre d'étapes, mais : une configuration en données, un module
commun, une **simulation qui ne peut pas écrire**, un mode test, une interface
entièrement dans le terminal (PowerShell 7 + Spectre), une checklist vivante, un
rapport JSON, et le 3CX pris en charge par la XAPI.

| Fichier | Rôle |
|---|---|
| `config.json` | Sociétés, sites, OU, domaines, tenants, Planner, SMTP, PBX, opérateurs, modèles de réponse automatique. **Tout ce qui était en dur.** |
| `Collaborateurs.psm1` | Le module commun : configuration, interface, journal, étapes, écritures, mail, AD, Exchange, Graph, XAPI, coffre. |
| `Nouveau-Collaborateur.ps1` | L'entrée. |
| `Sortie-Collaborateur.ps1` | La sortie. |
| `Test-Interface.ps1` | Banc d'essai de l'interface : aucune connexion, aucune écriture. |
| `Test-Annuaire.ps1` | Sonde de l'Active Directory : montre ce que l'annuaire répond pour un compte donné. Lecture seule. |

Côté application de statistiques, `frontend/scripts/diag-xapi-postes.ts` vérifie ce que la XAPI du 3CX permet d'écrire : sans argument il ne fait que lire, avec `--go` il crée un poste d'essai au premier numéro libre, y copie un modèle, compare, puis le supprime.
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
Install-Module PwshSpectreConsole, ExchangeOnlineManagement, Microsoft.Graph.Authentication, Microsoft.Graph.Users, Microsoft.Graph.Identity.DirectoryManagement -Scope AllUsers
Get-Module -ListAvailable ActiveDirectory, PwshSpectreConsole, ExchangeOnlineManagement, Microsoft.Graph.Authentication
```

   `PwshSpectreConsole` = l'interface (panneaux, menus au clavier, indicateurs). Les quatre autres sont ceux de l'ancien script. Sans Spectre, tout fonctionne en affichage simple.

4. Vérifier l'interface, sans rien connecter :

```powershell
.\Test-Interface.ps1
```

   Il fait défiler tous les composants sur des données inventées et écrit un **rapport d'exemple** dans `logs\rapport-exemple.html` : ouvrez-le dans un navigateur pour voir la tête du courriel sans rien envoyer.

5. Enregistrer la clé XAPI (une fois par machine) :

```powershell
.\Set-Secret.ps1
```

   Le script vérifie aussitôt qu'un jeton s'obtient.

   **Utilisez un principal de service dédié aux scripts** (Intégrations ▸ API du 3CX), avec un ID client distinct de celui de l'application de statistiques, et reportez-le dans `config.json` → `pbx.gerofinance.clientId`. Ce n'est pas une préférence de style : **le 3CX ne garde qu'un jeton par ID client**. Dès qu'un autre consommateur en demande un, le précédent est révoqué et l'appel suivant repart en 401. L'application échantillonne la présence chaque minute avec le client `stats` : tant que le script partage cet identifiant, il se fait révoquer en pleine exécution. Le script sait désormais redemander un jeton et réessayer une fois, ce qui suffit à passer, mais un client dédié supprime le problème à la racine.

6. Vérifier `config.json` → `operateurs` : la clé est le **nom de session Windows** de chacun (`$env:USERNAME`). Si vous ouvrez la session avec `gbossens` et non `admingbo`, renommez la clé.

7. Vérifier la société **BARNES COMMERCIAL** : domaine `bcr` confirmé, mais contrôleur, OU des désactivés et tenant restent marqués `_aVerifier`.

## Connexion à Microsoft 365

Comme avant : Exchange Online puis Microsoft Graph, chacun sa fenêtre de connexion dans le navigateur, avec le compte administrateur de l'opérateur (`config.json` → `operateurs`). Une connexion unique (jeton partagé par les deux modules, ou certificat) a été étudiée et mise de côté : simple d'abord.

## L'interface

Les couleurs sont celles de la charte : le dégradé du site (`#085440` → `#8ccaae`) donne le vert clair de l'accent et le vert profond de l'ombre portée du titre. L'accent porte tout ce qui guide — le titre, la question, le pointeur, les coches, la bordure du panneau d'accueil ; du gris pour le secondaire, du blanc pour les données, le rouge pour les échecs et le jaune pour les avertissements. Les trois couleurs se changent dans `config.json` → `interface`.

Le titre du haut est dessiné par le module (`Get-LignesTitre`) : des lettres pleines, que des angles droits, une ombre portée décalée d'un cran. Les polices figlet livrées avec Spectre dessinent au trait (`/ \ | _`), ce n'est pas le même effet.

**Un écran par étape, pas un défilement.** À chaque question la console est effacée et tout est redessiné : le titre, la frise du parcours (faites, en cours, à venir), un encadré qui garde les décisions sous l'œil, puis le contenu de la **seule** étape en cours. Le bloc est centré horizontalement dans une colonne de largeur fixe et posé au tiers supérieur de la fenêtre. Les champs déjà remplis restent affichés, pastille verte à gauche, valeur alignée à droite : on lit un formulaire, pas un journal.

Quand l'exécution commence, l'en-tête se cale en haut et le script bascule en **flux** : les étapes s'écrivent à la suite, chacune avec sa coche, sa durée à droite, et ses lignes de détail tenues par un filet vertical. Les textes longs sont coupés à la largeur de la colonne, jamais au hasard du terminal, et les écritures 3CX sont décrites en français (`File 906 « Compta Pully » : 4 agents — 330, 664, 110, 334`) plutôt qu'en JSON brut.

En mode `-Job`, aucun effacement : le script écrit un journal linéaire, lisible dans un fichier de sortie.

**Les invites sont dessinées par le module**, pas par Spectre : lui pose ses listes et ses saisies au bord gauche de la console, ce qui casserait le centrage. Les listes se parcourent aux flèches, se filtrent en tapant, se valident par Entrée et s'annulent par Échap ; la ligne courante porte un fond légèrement plus clair. Les saisies libres s'écrivent dans un champ encadré **sous** la question, au même fond. Si la console ne se pilote pas — entrée redirigée, sortie capturée — tout retombe sur un menu numéroté et `Read-Host`, sans rien casser.

La console classique de Windows suffit ; **Windows Terminal** rend mieux les caractères et les couleurs.

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
| `Simulation3CX` | Le central téléphonique a son propre interrupteur. Vide, il suit `Simulation`. `-Simulation3CX` l'épargne alors que le reste s'exécute ; **`-Reel3CX` fait l'inverse** : tout est simulé sauf le 3CX, qui est écrit pour de vrai. L'en-tête, le bilan et le rapport le disent en toutes lettres quand les deux modes divergent. |
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

## Les groupes d'un ou d'une collègue

À l'entrée, après les vérifications, le script propose de reprendre les groupes d'un modèle : un champ de recherche, comme pour la redirection des mails — on tape un nom, on choisit parmi les comptes actifs trouvés. Ses groupes sont alors présentés cochés, sauf ceux qui correspondent aux motifs de `config.json` → `entree.groupesSensibles` (administration, opérateurs…), proposés décochés et marqués « sensible » : on les coche en connaissance de cause. Les groupes automatiques de la société ne sont pas proposés deux fois. En mode `-Job`, `groupesDe` désigne le modèle par son identifiant et les groupes sensibles ne sont jamais repris.

Les **groupes automatiques** sont ceux que `config.json` → société → `groupesAuto` donne à tout nouveau compte de cette société, sans rien demander : pour GEROFINANCE, `SEC_DOCSERIES` et `SEC_OPTIMISO_ACTEURS`. Ils ne sont pas proposés une seconde fois dans la liste du modèle.

Quand la lecture d'un compte ou de ses groupes ne donne pas ce qu'on attend, la sonde montre ce que l'annuaire répond vraiment, sans passer par les écrans :

```powershell
.\Test-Annuaire.ps1 parsa
```

## Ce que fait le volet 3CX

**Entrée** : demande d'abord s'il faut **créer** un poste — le PBX propose lui-même le premier numéro libre — sinon propose de réaffecter un poste libre, désactivé ou nommé « libre », du site (préfixe `prefixePostes` dans `config.json`). Viennent ensuite les files d'attente, puis la **copie de la configuration d'un collègue**, proposé parmi les agents des files retenues, avec la recherche libre en secours. Le lendemain, l'application de statistiques le reconnaît par l'e-mail.

Ce que la copie reprend, chaque bloc décochable : les réglages généraux et les touches BLF, les profils de renvoi et leurs exceptions, les départements avec les droits « Visualiser » du modèle. Ce qu'elle ne reprend **jamais** : le numéro, l'identité, l'adresse, l'identifiant appelant sortant qui est le numéro direct du modèle, les mots de passe SIP, le code de messagerie, la photo, le téléphone physique, la poste flexible, et les réglages de double authentification. La touche BLF qui pointait sur le modèle est reportée sur le nouveau numéro.

Deux contraintes du PBX, constatées à l'essai : le nom affiché est composé par le 3CX à partir du nom et du prénom, et le **département principal n'est accepté qu'une fois le poste membre du département** — le script fait donc le rattachement d'abord.

**Le numéro direct.** Le script propose d'abord les SDA **libres**, une ligne par numéro et non par trunk : est libre un numéro sans aucune règle entrante, ou dont les règles ne mènent nulle part. Sur le central de Gérofinance, 597 des 1570 numéros sont dans ce cas. Une entrée en tête de liste bascule vers la liste complète, avec ce vers quoi chaque numéro pointe aujourd'hui, pour reprendre celui d'un poste qui part. On tape le début d'un numéro pour filtrer, `+4122` par exemple, ou le mot `libre` pour ne garder que les attribuables. Le numéro retenu est dirigé vers le nouveau poste sur **les deux trunks**, aux heures ouvrables comme en dehors et les jours fériés, et les deux règles prennent le nom de la personne. Une SDA qui n'a encore aucune règle en reçoit une par trunk.

**Le central n'est interrogé que pour Gérofinance.** Les autres sociétés ont `pbx: null` dans la configuration : ni lecture ni écriture, à l'entrée comme à la sortie.

**Sortie** : retrouve le poste par l'e-mail, le retire de toutes ses files, vide l'e-mail, le **désactive** — le numéro reste réservé. Les règles entrantes (SDA) qui visent encore le poste sont **listées dans le rapport, pas réécrites** : à faire à la main pour l'instant.

## Le rapport envoyé au helpdesk

Le bandeau reprend le titre du terminal — ENTRÉE ou SORTIE en pavés, dessinés par le même alphabet mais en cellules de tableau, ce qu'Outlook rend le plus fidèlement — avec le nom de la personne en dessous. Puis le dossier, puis — avant tout le détail — un encadré **Points d'attention** qui rassemble automatiquement toutes les lignes d'alerte : SDA à rerouter à la main, groupes et licences conservés, boîtes qui redirigent vers le partant, tâche Planner non créée. C'est la partie que le helpdesk doit lire.

Viennent ensuite les **étapes, chacune avec son détail juste en dessous** : plus de journal séparé. Chaque étape est enveloppée dans une balise de dépliage — pliée sur iPhone, sur Mac et dans le navigateur quand vous ouvrez le rapport enregistré dans `logs\`, déployée dans Outlook qui ignore la balise. Les étapes en échec ou porteuses d'une alerte s'ouvrent d'office. Au-delà de douze lignes, le reste est dans le rapport enregistré.

Le détail est écrit pour être lu : les gestes en français plutôt qu'en lignes de commande, les groupes en trois lignes (le compte, les retirés, les conservés) plutôt qu'une par groupe, les files 3CX par leur nom, et rien de ce que l'étape dit déjà.

Pour l'entrée, les identifiants sont dans un encadré vert en tête, et la liste « Membre de » indique sur le modèle de qui les groupes ont été repris.

Le corps propre à chaque opération se compose avec les fonctions `New-BlocPaires`, `New-BlocEncadre`, `New-BlocListe` et `New-BlocTexte` : le reste du courriel est commun aux deux scripts. Le récapitulatif affiché dans le terminal et celui du courriel viennent de la même source, il n'y a rien à tenir à jour deux fois.

## Où sont les traces

`logs\` : par opération, une transcription complète, le rapport en HTML et en JSON (avec les étapes et leur verdict). `cache\` : le cache des délégations, par société, valable dix jours.
