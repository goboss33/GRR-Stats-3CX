#Requires -Version 5.1
<#
    BANC D'ESSAI DE L'INTERFACE — aucune connexion, aucune écriture.

    Fait défiler les écrans (en-tête, frise des étapes, encadré de suivi,
    champs de formulaire, sélections, saisie multiligne, exécution, bilan)
    sur des données inventées, et écrit un rapport d'exemple sur le disque.
    À lancer sur le serveur pour voir l'interface avant le premier vrai
    lancement :

        pwsh -File .\Test-Interface.ps1

    -SansSaisie : ne pose aucune question (contrôle automatique).
#>
[CmdletBinding()]
param([switch] $SansSaisie)

if ($PSVersionTable.PSVersion.Major -lt 7 -and -not $env:COLLABORATEURS_SANS_PWSH) {
    $pwsh = Get-Command pwsh -ErrorAction SilentlyContinue
    if ($pwsh) {
        Write-Host "PowerShell 7 est installé : relance sous pwsh pour l'interface complète." -ForegroundColor DarkGray
        $arguments = @('-NoProfile', '-File', $PSCommandPath); if ($SansSaisie) { $arguments += '-SansSaisie' }
        & $pwsh.Source @arguments
        exit $LASTEXITCODE
    }
}

Import-Module (Join-Path $PSScriptRoot 'Collaborateurs.psm1') -Force
$Reglages = @{ ModeTest = $true; DestinataireTest = 'geoffrey.bossens@grrsa.ch'; Simulation = $true; EnvoyerMail = $false; DossierLogs = (Join-Path $env:TEMP 'collaborateurs-test') }
$etapes = @('Le collaborateur', 'Vérifications', 'Confirmation', 'Exécution')
Initialize-Collaborateurs -Reglages $Reglages -Dossier $PSScriptRoot -Operation 'sortie' -Etapes $etapes -Interactif $true

$comptes = @(
    [pscustomobject]@{ Name = 'Marie Exemple'; SamAccountName = 'mexemple'; Title = 'Comptable';     Department = 'Comptabilité'; Etat = '' },
    [pscustomobject]@{ Name = 'Jean Modèle';   SamAccountName = 'jmodele';  Title = 'Gérant [test]'; Department = 'Gérance';      Etat = 'déjà désactivé' },
    [pscustomobject]@{ Name = 'Léa Témoin';    SamAccountName = 'ltemoin';  Title = '';              Department = 'Direction';    Etat = '' }
)
$files = @(
    [pscustomobject]@{ Number = '901'; Name = 'Vevey' }, [pscustomobject]@{ Number = '906'; Name = 'Compta Pully' },
    [pscustomobject]@{ Number = '910'; Name = 'Gérance Genève' }, [pscustomobject]@{ Number = '912'; Name = 'Direction' }
)

# ------------------------------------------------------------- ÉTAPE 1
Set-Etape 'Le collaborateur'
$mode = if (Test-Spectre) { 'PwshSpectreConsole — interface complète' } else { 'console nue — PowerShell 7 ou PwshSpectreConsole absent' }
Show-Constat -Titre "Mode d'affichage : $mode" -Niveau $(if (Test-Spectre) { 'Succes' } else { 'Alerte' }) -Valeurs @('é è à ç ê ô — « » · → ✓ ● ▸ │ ╭ ╯')
Add-Resume -Cle 'Société' -Valeur 'GEROFINANCE'
Add-Resume -Cle 'Site' -Valeur 'PULLY'

if (-not $SansSaisie) {
    $choisi = Read-Choix -Titre 'Quel compte ? (3 trouvés)' -Elements $comptes -Colonnes Name, SamAccountName, Title, Department, Etat
    Add-Resume -Cle 'Qui part' -Valeur "$($choisi.Name) · $($choisi.SamAccountName)"
    Show-Constat -Titre 'Compte retenu' -Valeurs @($choisi.Name, $choisi.SamAccountName, "$($choisi.SamAccountName)@grrsa.ch")
    Read-Champ -Libelle 'Prénom' -Obligatoire | Out-Null
    Read-Champ -Libelle 'Nom' -Obligatoire | Out-Null
    Read-Champ -Libelle 'Fonction' | Out-Null
}

# ------------------------------------------------------------- ÉTAPE 2
Set-Etape 'Vérifications'
Show-Constat -Titre "Identifiant et adresse libres dans l'Active Directory" -Valeurs @('mexemple', 'marie.exemple@grrsa.ch')
Show-Constat -Titre '113 postes libres au 3CX — désactivés, ou nommés « libre »' -Niveau Info
Show-Tableau -Lignes $comptes -Colonnes Name, SamAccountName, Title, Department -Titre 'Un tableau, pour mémoire'
if (-not $SansSaisie) {
    $plusieurs = @(Read-Choix -Titre "Dans quelles files d'attente ?" -Elements $files -Colonnes Number, Name -Multiple)
    Show-Constat -Titre "$($plusieurs.Count) file(s) retenue(s)" -Valeurs @($plusieurs | ForEach-Object { "$($_.Number) $($_.Name)" })
    $bloc = Read-TexteMultiligne -Invite 'Message de réponse automatique'
    Show-Panneau -Texte $bloc -Titre 'Aperçu de la réponse automatique'
    Confirm-Choix -Question 'Retenir ce texte ?' -DefautOui | Out-Null
}

# ------------------------------------------------------------- ÉTAPE 3
Set-Etape 'Confirmation'
$recap = [ordered]@{
    'Société'             = 'GEROFINANCE - RÉGIE DU RHÔNE SA'
    'Compte'              = 'Marie Exemple  (mexemple)  —  marie.exemple@grrsa.ch'
    'Redirection'         = 'vers Comptabilité Pully <comptabilite.pully@grrsa.ch>'
    'Réponse automatique' = 'activée (modèle successeur)'
    'Poste 3CX'           = '129 « Exemple, Marie » — 2 file(s), 2 SDA'
    'Mode'                = 'SIMULATION — rien ne sera écrit'
}
Show-Recap -Paires $recap -Titre 'Récapitulatif avant exécution'
if (-not $SansSaisie) { Confirm-Choix -Question 'Lancer la simulation ?' -DefautOui | Out-Null }

# ------------------------------------------------------------- ÉTAPE 4
Set-Etape 'Exécution'
Start-Flux
Invoke-Etape -Nom 'Étape rapide qui réussit' -Categorie AD -Action {
    Start-Sleep -Milliseconds 600; Add-Journal -Message 'Détail de ce qui a été fait.' -Categorie AD -Niveau Succes
} | Out-Null
Invoke-Etape -Nom 'Étape avec écriture (simulée ici)' -Categorie Exchange -Action {
    Start-Sleep -Milliseconds 700
    Invoke-Ecriture -Categorie Exchange -Description 'Set-Mailbox marie.exemple@grrsa.ch -Type Shared' -Action { throw 'ne doit jamais être exécuté en simulation' } | Out-Null
    Invoke-Ecriture -Categorie Exchange -Description "Set-MailboxAutoReplyConfiguration marie.exemple@grrsa.ch -AutoReplyState Enabled — « Bonjour, je ne fais plus partie de la société, merci d'adresser vos demandes à comptabilite.pully@grrsa.ch »" -Action { } | Out-Null
} | Out-Null
Invoke-Etape -Nom 'Étape longue avec statut' -Categorie Delegations -Action {
    for ($i = 1; $i -le 5; $i++) { Update-Statut -Texte "Analyse des boîtes  $i / 5" -Pourcent (20 * $i); Start-Sleep -Milliseconds 250 }
    Add-Journal -Message 'Aucune délégation trouvée.' -Categorie Delegations -Niveau Succes
} | Out-Null
Invoke-Etape -Nom 'Étape qui laisse du travail à la main' -Categorie 3CX -Action {
    Add-Journal -Message 'File 906 « Compta Pully » : 4 agent(s) — 330, 664, 110, 334' -Categorie 3CX -Niveau Simule
    Add-Journal -Message 'Poste 129 : EmailAddress = (vide), Enabled = False' -Categorie 3CX -Niveau Simule
    Add-Journal -Message 'À REROUTER À LA MAIN — 2 règle(s) entrante(s) visent encore le poste 129 :' -Categorie 3CX -Niveau Alerte
    Add-Journal -Message '  Direct Marie Exemple — SDA +41219257110  (règle 41)' -Categorie 3CX -Niveau Alerte
    Add-Journal -Message '  Libre Marie Exemple — SDA +41223255110  (règle 42)' -Categorie 3CX -Niveau Alerte
    Add-Journal -Message 'Groupes conservés (2) : SEC_MFILES_IT_RR, SEC_MFILES_IT_BS' -Categorie Groupes -Niveau Alerte
} | Out-Null
Invoke-Etape -Nom 'Étape ignorée (réglage éteint)' -Categorie Planner -Ignorer -Action { } | Out-Null
Invoke-Etape -Nom 'Étape qui échoue (secondaire)' -Categorie 3CX -Action { Start-Sleep -Milliseconds 300; throw "Le PBX a répondu 401 [non autorisé]" } | Out-Null

Complete-Session
Show-Panneau -Texte "Identifiant : mexemple`nMot de passe initial : Xk7#pQ2m!vR9" -Titre 'À transmettre (exemple)' -Accent

# Le rapport tel qu'il arrivera dans Outlook, écrit sur le disque sans rien envoyer.
$corps  = New-BlocEncadre -Titre 'À transmettre au collaborateur' -Paires ([ordered]@{
    "Nom d'utilisateur" = 'mexemple'; 'Mot de passe' = 'Xk7#pQ2m!vR9'; 'Adresse e-mail' = 'marie.exemple@grrsa.ch'
})
$corps += New-BlocPaires -Titre 'Le dossier' -Paires $recap
$corps += New-BlocTexte -Titre 'Message de réponse automatique' -Texte "Bonjour,`n`nJe ne fais plus partie de GEROFINANCE - RÉGIE DU RHÔNE SA depuis le 04.09.2026. Comptabilité Pully (comptabilite.pully@grrsa.ch) reprend mes dossiers.`n`nMeilleures salutations"
$corps += New-BlocListe -Titre 'Membre de' -Lignes @('SEC_DOCSERIES', 'SEC_OPTIMISO_ACTEURS')
$corps += New-BlocListe -Titre 'Reste à faire' -Cases -Lignes @(Get-Prop -Objet (Get-Prop -Objet (Get-Config) -Nom 'entree') -Nom 'resteAFaire' -Defaut @('SDA', 'Badge'))
$html = ConvertTo-RapportHtml -Titre 'Sortie — Marie Exemple' -SousTitre 'GEROFINANCE - RÉGIE DU RHÔNE SA' -Corps $corps
$chemin = Join-Path (Get-Reglages).DossierLogs 'rapport-exemple.html'
Set-Content -Path $chemin -Value $html -Encoding UTF8
Show-Note "Rapport d'exemple écrit (ouvrez-le dans un navigateur) : $chemin" -Niveau Succes
Show-Note "Transcription : $((Get-Reglages).DossierLogs)" -Niveau Sourdine
