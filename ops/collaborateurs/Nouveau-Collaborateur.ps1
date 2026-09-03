#Requires -Version 5.1
<#
    ENTRÉE D'UN COLLABORATEUR — Service Informatique.

    Crée le compte dans l'Active Directory de la société (OU du site, attributs,
    adresses), l'ajoute aux groupes automatiques, déclenche la synchronisation
    vers Microsoft 365, réaffecte ou crée son poste 3CX et l'inscrit dans ses
    files, puis envoie la fiche au helpdesk.

    Sans argument : assistant interactif. Avec -Job : aucun dialogue, tout vient
    du fichier JSON (voir exemples\entree.json) — c'est le contrat avec le futur
    portail.

    -Simulation : aucune écriture, chaque geste est décrit (Invoke-Ecriture).
    Interface complète sous PowerShell 7 + PwshSpectreConsole ; le script s'y
    relance de lui-même quand pwsh est installé.
#>
[CmdletBinding()]
param(
    [string] $Job,
    [switch] $ModeTest,
    [switch] $Simulation,
    [switch] $SansMail,
    [switch] $Sans3CX,
    [switch] $SansAdConnect
)

# ------------------------------------------- RELANCE SOUS POWERSHELL 7
if ($PSVersionTable.PSVersion.Major -lt 7 -and -not $env:COLLABORATEURS_SANS_PWSH) {
    $pwsh = Get-Command pwsh -ErrorAction SilentlyContinue
    if ($pwsh) {
        Write-Host "PowerShell 7 est installé : relance sous pwsh pour l'interface complète." -ForegroundColor DarkGray
        $arguments = @('-NoProfile', '-File', $PSCommandPath)
        foreach ($k in $PSBoundParameters.Keys) {
            $v = $PSBoundParameters[$k]
            if ($v -is [switch]) { if ($v.IsPresent) { $arguments += "-$k" } } else { $arguments += "-$k"; $arguments += "$v" }
        }
        & $pwsh.Source @arguments
        exit $LASTEXITCODE
    }
}

# ------------------------------------------------------------------ RÉGLAGES
$Reglages = @{
    ModeTest              = $true        # mails détournés vers DestinataireTest, sujet [TEST]
    DestinataireTest      = 'geoffrey.bossens@grrsa.ch'
    Simulation            = $false       # AUCUNE écriture (AD, 3CX) : tout est décrit
    EnvoyerMail           = $true
    Gerer3CX              = $true
    SynchroniserAdConnect = $true
    DossierLogs           = ''           # vide = .\logs
}
if ($ModeTest)      { $Reglages.ModeTest = $true }
if ($Simulation)    { $Reglages.Simulation = $true }
if ($SansMail)      { $Reglages.EnvoyerMail = $false }
if ($Sans3CX)       { $Reglages.Gerer3CX = $false }
if ($SansAdConnect) { $Reglages.SynchroniserAdConnect = $false }
# ---------------------------------------------------------------------------

Import-Module (Join-Path $PSScriptRoot 'Collaborateurs.psm1') -Force
Initialize-Collaborateurs -Reglages $Reglages -Dossier $PSScriptRoot -Operation 'entree'
$config = Get-Config

# ================================================================ 1. DOSSIER
# Tout ce qu'on sait du collaborateur, réuni AVANT d'agir : c'est ce que le
# récapitulatif montre, ce que le rapport enregistre, et ce que le portail
# enverra un jour à la place des questions.
$dossier = [ordered]@{
    Societe = $null; Site = $null; Prenom = ''; Nom = ''; Fonction = ''; Service = ''; Titre = ''
    Sam = ''; Email = ''; MailNickname = ''; DisplayName = ''; MotDePasse = ''
    Poste3CX = $null; Files3CX = @()
}

if ($Job) {
    $j = Get-Content -Path $Job -Raw -Encoding UTF8 | ConvertFrom-Json
    $dossier.Societe = Get-Societe -Id $j.societe
    $dossier.Site = $dossier.Societe.sites | Where-Object { $_.id -eq $j.site } | Select-Object -First 1
    if (-not $dossier.Site) { throw "Site inconnu pour $($j.societe) : $($j.site)" }
    foreach ($k in 'Prenom', 'Nom', 'Fonction', 'Service', 'Titre') { $dossier[$k] = "$(Get-Prop -Objet $j -Nom $k.ToLower() -Defaut '')" }
    if (Get-Prop -Objet $j -Nom 'identifiant') { $dossier.Sam = "$(Get-Prop -Objet $j -Nom 'identifiant')" }
} else {
    Show-Section '1 · Le collaborateur'
    $dossier.Societe = Read-Choix -Titre 'Société' -Elements @($config.societes) -Libelle { "$($_.nom)   ·   $($_.domaineMail)" }
    $dossier.Site    = Read-Choix -Titre "Site — $($dossier.Societe.nom)" -Elements @($dossier.Societe.sites) -Libelle { (@("$($_.id)", "$($_.adresse)", "$($_.codePostal)", "$($_.telephone)") | Where-Object { $_ }) -join '   ·   ' }
    Show-Note "$($dossier.Societe.nom) › $($dossier.Site.id)   (q pour quitter à tout moment)" -Niveau Sourdine
    $dossier.Prenom   = Read-Texte -Invite 'Prénom' -Obligatoire -QuitteSurQ
    $dossier.Nom      = Read-Texte -Invite 'Nom' -Obligatoire -QuitteSurQ
    $dossier.Fonction = Read-Texte -Invite 'Fonction' -QuitteSurQ
    $dossier.Service  = Read-Texte -Invite 'Service' -QuitteSurQ
    $dossier.Titre    = Read-Texte -Invite 'Titre' -QuitteSurQ
}

$ids = ConvertTo-Identifiants -Prenom $dossier.Prenom -Nom $dossier.Nom -DomaineMail $dossier.Societe.domaineMail
if (-not $dossier.Sam) { $dossier.Sam = $ids.Sam }
$dossier.Email = $ids.Email; $dossier.MailNickname = $ids.MailNickname; $dossier.DisplayName = $ids.DisplayName
$dossier.MotDePasse = New-MotDePasse

# ====================================================== 2. VÉRIFICATIONS
# Avant la moindre écriture : on se connecte, on vérifie l'unicité, on lit le PBX.
if (-not $Job) { Show-Section '2 · Vérifications et poste 3CX' }
$ad = Connect-Domaine -Societe $dossier.Societe
$pbx = if ($Reglages.Gerer3CX) { Get-Pbx -Societe $dossier.Societe } else { $null }

while ($true) {
    $existant = Get-ADUser -Filter "SamAccountName -eq '$($dossier.Sam)'" @ad -ErrorAction SilentlyContinue
    if (-not $existant) { break }
    Show-Note "L'identifiant $($dossier.Sam) est déjà utilisé par $($existant.Name)." -Niveau Alerte
    if ($Job) { throw "Identifiant déjà pris : $($dossier.Sam)" }
    $dossier.Sam = Read-Texte -Invite 'Identifiant alternatif' -Obligatoire -QuitteSurQ
}
$doublonUpn = Get-ADUser -Filter "UserPrincipalName -eq '$($dossier.Email)'" @ad -ErrorAction SilentlyContinue
if ($doublonUpn) { throw "L'adresse $($dossier.Email) existe déjà dans l'AD ($($doublonUpn.Name))." }
Show-Note "Identifiant $($dossier.Sam) et adresse $($dossier.Email) libres dans l'AD." -Niveau Succes

if ($pbx) {
    $lecture = Invoke-Attente -Titre "Lecture du 3CX ($($pbx.adresse))" -Action {
        $memeEmail = @(Find-XapiUtilisateurParEmail -Pbx $pbx -Email $dossier.Email)
        if ($memeEmail.Count -gt 0) { throw "L'adresse $($dossier.Email) est déjà portée par le poste 3CX $($memeEmail[0].Number)." }
        $prefixe = "$(Get-Prop -Objet $dossier.Site -Nom 'prefixePostes' -Defaut '')"
        $candidats = @(Get-XapiPostesLibres -Pbx $pbx -Prefixe $prefixe)
        if ($candidats.Count -eq 0 -and $prefixe) { $candidats = @(Get-XapiPostesLibres -Pbx $pbx) }
        return @{ Candidats = $candidats; Files = @(Get-XapiFiles -Pbx $pbx | Select-Object Id, Number, Name | Sort-Object Name) }
    }
    $candidats = @($lecture.Candidats); $toutesFiles = @($lecture.Files)

    # Poste : un poste libre du site (désactivé ou nommé « libre »), ou aucun.
    $posteVoulu = if ($Job) { "$(Get-Prop -Objet $j -Nom 'poste3cx' -Defaut '')" } else { '' }
    if ($posteVoulu) {
        $dossier.Poste3CX = @(Get-XapiUtilisateurs -Pbx $pbx | Where-Object { "$($_.Number)" -eq $posteVoulu })[0]
        if (-not $dossier.Poste3CX) { throw "Poste 3CX introuvable : $posteVoulu" }
    } elseif (-not $Job) {
        Show-Note "$($candidats.Count) poste(s) libre(s) au 3CX (désactivés ou nommés « libre »)." -Niveau Sourdine
        if ($candidats.Count -gt 0 -and (Confirm-Choix -Question 'Réaffecter un poste libre à ce collaborateur ?' -DefautOui)) {
            $dossier.Poste3CX = Read-Choix -Titre 'Poste 3CX à réaffecter' -Elements $candidats -Libelle {
                $etat = if ($_.Enabled) { 'actif' } else { 'désactivé' }
                (@("$($_.Number)", "$($_.DisplayName)", "$($_.EmailAddress)", $etat) | Where-Object { $_ }) -join '   ·   '
            }
        }
    }
    if ($dossier.Poste3CX) {
        $filesVoulues = if ($Job) { @(Get-Prop -Objet $j -Nom 'files3cx' -Defaut @() | ForEach-Object { "$_" }) } else { @() }
        if ($filesVoulues.Count -gt 0) {
            $dossier.Files3CX = @($toutesFiles | Where-Object { $filesVoulues -contains "$($_.Number)" })
        } elseif (-not $Job -and (Confirm-Choix -Question "Inscrire ce poste dans des files d'attente ?" -DefautOui)) {
            $dossier.Files3CX = @(Read-Choix -Titre "Files d'attente" -Elements $toutesFiles -Libelle { "$($_.Number)   ·   $($_.Name)" } -Multiple)
        }
    }
}

# ====================================================== 3. RÉCAPITULATIF
$recap = [ordered]@{
    'Société'          = $dossier.Societe.nom
    'Site'             = "$($dossier.Site.id) — $($dossier.Site.adresse), $($dossier.Site.codePostal)"
    'Nom complet'      = $dossier.DisplayName
    'Identifiant'      = $dossier.Sam
    'E-mail'           = $dossier.Email
    'Fonction'         = $(if ($dossier.Fonction) { $dossier.Fonction } else { '—' })
    'Service'          = $(if ($dossier.Service) { $dossier.Service } else { '—' })
    'Titre'            = $(if ($dossier.Titre) { $dossier.Titre } else { '—' })
    'OU'               = $dossier.Site.ou
    'Groupes auto'     = $(if ($dossier.Societe.groupesAuto) { $dossier.Societe.groupesAuto -join ', ' } else { '—' })
    'Poste 3CX'        = $(if ($dossier.Poste3CX) { "$($dossier.Poste3CX.Number) (ex « $($dossier.Poste3CX.DisplayName) »)" } elseif ($pbx) { 'aucun' } else { 'pas de PBX pour cette société' })
    'Files 3CX'        = $(if ($dossier.Files3CX.Count) { ($dossier.Files3CX | ForEach-Object { "$($_.Number) $($_.Name)" }) -join ' · ' } else { '—' })
    'Mode'             = $(if ($Reglages.Simulation) { 'SIMULATION — rien ne sera écrit' } else { 'RÉEL — le compte sera créé' })
}
Show-Recap -Paires $recap -Titre 'Récapitulatif avant création'
if (-not $Job -and -not (Confirm-Choix -Question $(if ($Reglages.Simulation) { 'Lancer la simulation ?' } else { 'Confirmer et CRÉER ?' }))) { Stop-Script }

# ============================================================ 4. EXÉCUTION
Show-Section '3 · Exécution'
$site = $dossier.Site; $soc = $dossier.Societe
$proxy = @("SMTP:$($dossier.Email)")

try {
    Invoke-Etape -Nom "Compte AD créé ($($dossier.Sam))" -Categorie AD -Critique -Action {
        $params = @{
            Name = $dossier.DisplayName; GivenName = $dossier.Prenom; Surname = $dossier.Nom; DisplayName = $dossier.DisplayName
            SamAccountName = $dossier.Sam; UserPrincipalName = $dossier.Email; EmailAddress = $dossier.Email
            Path = $site.ou; Title = $dossier.Fonction; Department = $dossier.Service; Description = $dossier.Titre
            Company = $soc.nom; Office = $site.bureau; StreetAddress = $site.adresse; POBox = $site.case; PostalCode = $site.codePostal
            HomePhone = $site.telephone; Enabled = $true; PasswordNeverExpires = $true   # politique actuelle, à rediscuter
            AccountPassword = (ConvertTo-SecureString -AsPlainText $dossier.MotDePasse -Force)
            OtherAttributes = @{ mailNickname = $dossier.MailNickname; proxyAddresses = $proxy }
        }
        Invoke-Ecriture -Categorie AD -Description "New-ADUser $($dossier.Sam) « $($dossier.DisplayName) » dans $($site.ou), UPN $($dossier.Email)" -Action {
            New-ADUser @params @ad
            Wait-AdUtilisateur -Sam $dossier.Sam -Ad $ad | Out-Null
            Add-Journal -Message "Compte $($dossier.Sam) créé dans $($site.ou)." -Categorie AD -Niveau Succes
        } | Out-Null
    } | Out-Null

    Invoke-Etape -Nom 'Groupes automatiques' -Categorie Groupes -Ignorer:(-not $soc.groupesAuto -or $soc.groupesAuto.Count -eq 0) -Action {
        foreach ($g in $soc.groupesAuto) {
            Invoke-Ecriture -Categorie Groupes -Description "Add-ADGroupMember $g -Members $($dossier.Sam)" -Action {
                Add-ADGroupMember -Identity $g -Members $dossier.Sam @ad
                Add-Journal -Message "Ajouté au groupe $g." -Categorie Groupes -Niveau Succes
            } | Out-Null
        }
    } | Out-Null

    Invoke-Etape -Nom 'Synchronisation AD Connect (delta)' -Categorie AD -Ignorer:(-not $Reglages.SynchroniserAdConnect) -Action { Invoke-AdConnectDelta } | Out-Null

    Invoke-Etape -Nom 'Poste 3CX réaffecté' -Categorie 3CX -Ignorer:(-not $dossier.Poste3CX) -Action {
        Set-XapiPoste -Pbx $pbx -Id $dossier.Poste3CX.Id -Proprietes @{
            FirstName = $dossier.Prenom; LastName = $dossier.Nom; EmailAddress = $dossier.Email; Enabled = $true
        }
        if (-not (Test-Simulation)) { Add-Journal -Message "Poste $($dossier.Poste3CX.Number) réaffecté à $($dossier.DisplayName) ($($dossier.Email))." -Categorie 3CX -Niveau Succes }
    } | Out-Null

    Invoke-Etape -Nom "Poste 3CX inscrit dans ses files d'attente" -Categorie 3CX -Ignorer:(-not $dossier.Poste3CX -or $dossier.Files3CX.Count -eq 0) -Action {
        Add-XapiPosteAuxFiles -Pbx $pbx -Numero "$($dossier.Poste3CX.Number)" -Files $dossier.Files3CX
    } | Out-Null
} catch {
    Show-Note "Exécution interrompue : $(Get-MessageErreur $_)" -Niveau Erreur
    Add-Journal -Message "Exécution interrompue : $(Get-MessageErreur $_)" -Niveau Erreur
}

# ============================================================ 5. LA FICHE
Show-Section '4 · Fiche et rapport'
$groupes = if (Test-Simulation) { @($soc.groupesAuto) } else { try { @(Get-ADPrincipalGroupMembership -Identity $dossier.Sam @ad -ErrorAction Stop | Select-Object -ExpandProperty Name) } catch { @($soc.groupesAuto) } }
$fiche = @"
<h2 style='color:#0000ff;font-size:16px'>Informations utilisateur</h2>
<b>Nom :</b> $($dossier.DisplayName)<br>
<b>Nom d'utilisateur :</b> $($dossier.Sam)<br>
<b>Mot de passe :</b> $($dossier.MotDePasse)<br>
<b>E-mail :</b> $($dossier.Email)<br>
<b>Service :</b> $($dossier.Service)<br>
<b>Fonction :</b> $($dossier.Fonction)<br>
<b>Titre :</b> $($dossier.Titre)<br>
<b>Société :</b> $($soc.nom) — $($site.id)<br>
<b>Téléphone fixe :</b> $(if ($dossier.Poste3CX) { "poste $($dossier.Poste3CX.Number)" } else { '' })<br>
<b>Téléphone mobile :</b> <br>
<h2 style='color:#0000ff;font-size:16px'>Membre de</h2>$(($groupes | ForEach-Object { "$_<br>" }) -join '')
<h2 style='color:#0000ff;font-size:16px'>Files 3CX</h2>$(if ($dossier.Files3CX.Count) { ($dossier.Files3CX | ForEach-Object { "$($_.Number) $($_.Name)<br>" }) -join '' } else { '—<br>' })
<h2 style='color:#0000ff;font-size:16px'>Reste à faire</h2>
<b>SDA :</b> <br><b>Imprimantes :</b> <br><b>Forticlient :</b> <br><b>Quorum :</b> <br><b>Badge :</b> <br><b>TNI :</b> <br><b>PC :</b> GFNB*** — charger profil<br><b>Flyer remis aux RH :</b> <br>
"@
$html = ConvertTo-RapportHtml -Titre "Entrée — $($dossier.DisplayName)" -EnTete $fiche
Invoke-Etape -Nom 'Fiche envoyée au helpdesk' -Categorie General -Action { Send-Rapport -Sujet "Fiche Outlook - $($dossier.DisplayName)" -Html $html } | Out-Null
$donnees = [ordered]@{}; foreach ($k in $dossier.Keys) { if ($k -ne 'MotDePasse') { $donnees[$k] = $dossier[$k] } }
Save-Rapport -Nom "entree-$($dossier.Sam)" -Html $html -Donnees $donnees | Out-Null

Complete-Session
Show-Panneau -Texte "Identifiant : $($dossier.Sam)`nMot de passe initial : $($dossier.MotDePasse)" -Titre 'À transmettre' -Couleur Yellow
