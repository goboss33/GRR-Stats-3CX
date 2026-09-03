#Requires -Version 5.1
<#
    BANC D'ESSAI DE L'INTERFACE — aucune connexion, aucune écriture.

    Fait défiler tous les composants (en-tête, sections, tableau, sélection,
    saisie, bloc multi-ligne, confirmation, étapes avec indicateur, bilan) sur
    des données inventées. À lancer sur le serveur APRÈS l'installation de
    PowerShell 7 et de PwshSpectreConsole, pour voir l'interface complète avant
    le premier vrai lancement :

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
Initialize-Collaborateurs -Reglages $Reglages -Dossier $PSScriptRoot -Operation 'sortie'

$mode = if (Test-Spectre) { 'PwshSpectreConsole (interface complète)' } else { 'console nue (PowerShell 7 ou PwshSpectreConsole absent)' }
Show-Note "Mode d'affichage : $mode" -Niveau $(if (Test-Spectre) { 'Succes' } else { 'Alerte' })
Show-Note "Caractères à vérifier : é è à ç ê ô — « » · → ✓" -Niveau Sourdine

Show-Section '1 · Tableau et récapitulatif'
$comptes = @(
    [pscustomobject]@{ Name = 'Marie Exemple';   SamAccountName = 'mexemple';  Title = 'Comptable';        Department = 'Comptabilité'; Enabled = $true },
    [pscustomobject]@{ Name = 'Jean Modèle';     SamAccountName = 'jmodele';   Title = 'Gérant [test]';    Department = 'Gérance';      Enabled = $false },
    [pscustomobject]@{ Name = 'Léa Témoin';      SamAccountName = 'ltemoin';   Title = '';                 Department = 'Direction';    Enabled = $true }
)
Show-Tableau -Lignes $comptes -Colonnes Name, SamAccountName, Title, Department, Enabled -Titre 'Résultat de recherche (données inventées)'
Show-Recap -Paires ([ordered]@{ 'Société' = 'GEROFINANCE - RÉGIE DU RHÔNE SA'; 'Compte' = 'Marie Exemple (mexemple)'; 'Redirection' = 'vers Comptabilité Pully <comptabilite.pully@grrsa.ch>'; 'Mode' = 'SIMULATION' }) -Titre 'Récapitulatif (exemple)'
Show-Panneau -Texte "Bonjour,`n`nJe ne fais plus partie de la société.`nMerci d'adresser vos demandes à comptabilite.pully@grrsa.ch.`n`nMeilleures salutations" -Titre 'Aperçu (exemple)'

if (-not $SansSaisie) {
    Show-Section '2 · Questions'
    $vue = @($comptes | Select-Object *, @{ n = 'Etat'; e = { if ($_.Enabled) { '' } else { 'déjà désactivé' } } })
    $choisi = Read-Choix -Titre 'Quel compte ? (3 trouvés)' -Elements $vue -Colonnes Name, SamAccountName, Title, Department, Etat
    Show-Note "Choisi : $($choisi.Name)" -Niveau Succes
    $files = @([pscustomobject]@{ Number = '901'; Name = 'Vevey' }, [pscustomobject]@{ Number = '906'; Name = 'Compta Pully' }, [pscustomobject]@{ Number = '910'; Name = 'Gérance Genève' }, [pscustomobject]@{ Number = '912'; Name = 'Direction' })
    $plusieurs = @(Read-Choix -Titre "Dans quelles files d'attente ?" -Elements $files -Colonnes Number, Name -Multiple)
    Show-Note "Choisies : $(($plusieurs | ForEach-Object { $_.Number }) -join ', ')" -Niveau Succes
    $texte = Read-Texte -Invite 'Une saisie libre (Entrée pour la valeur par défaut)' -Defaut 'valeur par défaut'
    Show-Note "Saisi : $texte" -Niveau Succes
    $bloc = Read-TexteMultiligne -Invite 'Message de réponse automatique'
    Show-Panneau -Texte $bloc -Titre 'Aperçu de la réponse automatique'
    $oui = Confirm-Choix -Question 'Retenir ce texte ?' -DefautOui
    Show-Note "Réponse : $oui" -Niveau Succes
}

Show-Section '3 · Étapes'
Invoke-Etape -Nom 'Étape rapide qui réussit' -Categorie AD -Action { Start-Sleep -Milliseconds 600; Add-Journal -Message 'Détail de ce qui a été fait.' -Categorie AD -Niveau Succes } | Out-Null
Invoke-Etape -Nom 'Étape avec écriture (simulée ici)' -Categorie Exchange -Action {
    Start-Sleep -Milliseconds 800
    Invoke-Ecriture -Categorie Exchange -Description 'Set-Mailbox exemple@grrsa.ch -Type Shared' -Action { throw 'ne doit jamais être exécuté en simulation' } | Out-Null
} | Out-Null
Invoke-Etape -Nom 'Étape longue avec statut' -Categorie Delegations -Action {
    for ($i = 1; $i -le 5; $i++) { Update-Statut -Texte "Analyse des boîtes  $i / 5" -Pourcent (20 * $i); Start-Sleep -Milliseconds 300 }
    Add-Journal -Message 'Aucune délégation trouvée.' -Categorie Delegations -Niveau Succes
} | Out-Null
Invoke-Etape -Nom 'Étape ignorée (réglage éteint)' -Categorie Planner -Ignorer -Action { } | Out-Null
Invoke-Etape -Nom 'Étape qui échoue (secondaire)' -Categorie 3CX -Action { Start-Sleep -Milliseconds 400; throw "Le PBX a répondu 401 [non autorisé]" } | Out-Null

Complete-Session
Show-Panneau -Texte "Identifiant : mexemple`nMot de passe initial : Xk7#pQ2m!vR9" -Titre 'À transmettre (exemple)' -Accent
Show-Note "Transcription : $((Get-Reglages).DossierLogs)" -Niveau Sourdine
