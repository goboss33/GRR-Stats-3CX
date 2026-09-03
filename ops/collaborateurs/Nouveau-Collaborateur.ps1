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

    RÉGLAGES : le bloc $Reglages ci-dessous ; chaque clé se surcharge en ligne
    de commande (ex. .\Nouveau-Collaborateur.ps1 -Simulation).
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

# ------------------------------------------------------------------ RÉGLAGES
$Reglages = @{
    ModeTest              = $true        # mails détournés vers DestinataireTest, sujet [TEST]
    DestinataireTest      = 'geoffrey.bossens@grrsa.ch'
    Simulation            = $false       # AUCUNE écriture (AD, 3CX, mail) : tout est listé
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
    $dossier.Societe = Select-Option -Titre "Société" -Elements @($config.societes) -Colonnes id, nom
    $dossier.Site    = Select-Option -Titre "Site — $($dossier.Societe.nom)" -Elements @($dossier.Societe.sites) -Colonnes id, adresse, codePostal, telephone
    Write-Host "`n  $($dossier.Societe.nom) › $($dossier.Site.id)   (q pour quitter à tout moment)`n" -ForegroundColor Cyan
    $dossier.Prenom   = Read-Texte -Invite "Prénom" -Obligatoire -QuitteSurQ
    $dossier.Nom      = Read-Texte -Invite "Nom" -Obligatoire -QuitteSurQ
    $dossier.Fonction = Read-Texte -Invite "Fonction" -QuitteSurQ
    $dossier.Service  = Read-Texte -Invite "Service" -QuitteSurQ
    $dossier.Titre    = Read-Texte -Invite "Titre" -QuitteSurQ
}

$ids = ConvertTo-Identifiants -Prenom $dossier.Prenom -Nom $dossier.Nom -DomaineMail $dossier.Societe.domaineMail
if (-not $dossier.Sam) { $dossier.Sam = $ids.Sam }
$dossier.Email = $ids.Email; $dossier.MailNickname = $ids.MailNickname; $dossier.DisplayName = $ids.DisplayName
$dossier.MotDePasse = New-MotDePasse

# ====================================================== 2. VÉRIFICATIONS
# Avant la moindre écriture : on se connecte, on vérifie l'unicité, on lit le PBX.
$ad = Connect-Domaine -Societe $dossier.Societe
$pbx = if ($Reglages.Gerer3CX) { Get-Pbx -Societe $dossier.Societe } else { $null }

while ($true) {
    $existant = Get-ADUser -Filter "SamAccountName -eq '$($dossier.Sam)'" @ad -ErrorAction SilentlyContinue
    if (-not $existant) { break }
    Write-Host "  L'identifiant $($dossier.Sam) est déjà utilisé par $($existant.Name)." -ForegroundColor Yellow
    if ($Job) { throw "Identifiant déjà pris : $($dossier.Sam)" }
    $dossier.Sam = Read-Texte -Invite "Identifiant alternatif" -Obligatoire -QuitteSurQ
}
$doublonUpn = Get-ADUser -Filter "UserPrincipalName -eq '$($dossier.Email)'" @ad -ErrorAction SilentlyContinue
if ($doublonUpn) { throw "L'adresse $($dossier.Email) existe déjà dans l'AD ($($doublonUpn.Name))." }

if ($pbx) {
    $memeEmail = @(Find-XapiUtilisateurParEmail -Pbx $pbx -Email $dossier.Email)
    if ($memeEmail.Count -gt 0) { throw "L'adresse $($dossier.Email) est déjà portée par le poste 3CX $($memeEmail[0].Number)." }

    # Poste : un poste libre du site (désactivé ou nommé « libre »), ou aucun.
    $prefixe = "$(Get-Prop -Objet $dossier.Site -Nom 'prefixePostes' -Defaut '')"
    $candidats = @(Get-XapiPostesLibres -Pbx $pbx -Prefixe $prefixe)
    if ($candidats.Count -eq 0 -and $prefixe) { $candidats = @(Get-XapiPostesLibres -Pbx $pbx) }
    $posteVoulu = if ($Job) { "$(Get-Prop -Objet $j -Nom 'poste3cx' -Defaut '')" } else { '' }
    if ($posteVoulu) {
        $dossier.Poste3CX = @(Get-XapiUtilisateurs -Pbx $pbx | Where-Object { "$($_.Number)" -eq $posteVoulu })[0]
        if (-not $dossier.Poste3CX) { throw "Poste 3CX introuvable : $posteVoulu" }
    } elseif (-not $Job) {
        Write-Host "  $($candidats.Count) poste(s) libre(s) au 3CX." -ForegroundColor Cyan
        if ($candidats.Count -gt 0 -and (Confirm-Choix -Question "  Réaffecter un poste libre ?" -DefautOui)) {
            $dossier.Poste3CX = Select-Option -Titre "Poste 3CX à réaffecter (désactivés ou « libre »)" -Elements $candidats -Colonnes Number, DisplayName, EmailAddress, Enabled
        }
    }
    if ($dossier.Poste3CX) {
        $toutesFiles = @(Get-XapiFiles -Pbx $pbx | Select-Object Id, Number, Name | Sort-Object Name)
        $filesVoulues = if ($Job) { @(Get-Prop -Objet $j -Nom 'files3cx' -Defaut @() | ForEach-Object { "$_" }) } else { @() }
        if ($filesVoulues.Count -gt 0) {
            $dossier.Files3CX = @($toutesFiles | Where-Object { $filesVoulues -contains "$($_.Number)" })
        } elseif (-not $Job -and (Confirm-Choix -Question "  Inscrire ce poste dans des files d'attente ?" -DefautOui)) {
            $dossier.Files3CX = @(Select-Option -Titre "Files d'attente (sélection multiple)" -Elements $toutesFiles -Colonnes Number, Name -Multiple)
        }
    }
}

# ====================================================== 3. RÉCAPITULATIF
Write-Host ""
Write-Host "  RÉCAPITULATIF" -ForegroundColor Cyan
Write-Host ("  {0,-18} {1}" -f 'Société', $dossier.Societe.nom)
Write-Host ("  {0,-18} {1} — {2}, {3}" -f 'Site', $dossier.Site.id, $dossier.Site.adresse, $dossier.Site.codePostal)
Write-Host ("  {0,-18} {1}" -f 'Nom complet', $dossier.DisplayName)
Write-Host ("  {0,-18} {1}" -f 'Identifiant', $dossier.Sam)
Write-Host ("  {0,-18} {1}" -f 'E-mail', $dossier.Email)
Write-Host ("  {0,-18} {1} / {2} / {3}" -f 'Fonction/Service', $dossier.Fonction, $dossier.Service, $dossier.Titre)
Write-Host ("  {0,-18} {1}" -f 'OU', $dossier.Site.ou)
Write-Host ("  {0,-18} {1}" -f 'Groupes auto', ($(if ($dossier.Societe.groupesAuto) { $dossier.Societe.groupesAuto -join ', ' } else { '—' })))
Write-Host ("  {0,-18} {1}" -f 'Poste 3CX', $(if ($dossier.Poste3CX) { "$($dossier.Poste3CX.Number) (ex « $($dossier.Poste3CX.DisplayName) »)" } elseif ($pbx) { 'aucun' } else { 'pas de PBX pour cette société' }))
Write-Host ("  {0,-18} {1}" -f 'Files 3CX', $(if ($dossier.Files3CX.Count) { ($dossier.Files3CX | ForEach-Object { "$($_.Number) $($_.Name)" }) -join ' · ' } else { '—' }))
Write-Host ""
if (-not $Job -and -not (Confirm-Choix -Question "  Confirmer et exécuter ?")) { Stop-Script }
Write-Host ""

# ============================================================ 4. EXÉCUTION
$site = $dossier.Site; $soc = $dossier.Societe
$proxy = @("SMTP:$($dossier.Email)")

Invoke-Etape -Nom "Création du compte AD ($($dossier.Sam))" -Categorie AD -Critique -Action {
    $params = @{
        Name = $dossier.DisplayName; GivenName = $dossier.Prenom; Surname = $dossier.Nom; DisplayName = $dossier.DisplayName
        SamAccountName = $dossier.Sam; UserPrincipalName = $dossier.Email; EmailAddress = $dossier.Email
        Path = $site.ou; Title = $dossier.Fonction; Department = $dossier.Service; Description = $dossier.Titre
        Company = $soc.nom; Office = $site.bureau; StreetAddress = $site.adresse; POBox = $site.case; PostalCode = $site.codePostal
        HomePhone = $site.telephone; Enabled = $true; PasswordNeverExpires = $true   # politique actuelle, à rediscuter
        AccountPassword = (ConvertTo-SecureString -AsPlainText $dossier.MotDePasse -Force)
        OtherAttributes = @{ mailNickname = $dossier.MailNickname; proxyAddresses = $proxy }
    }
    New-ADUser @params @ad
    if (-not (Test-Simulation)) { Wait-AdUtilisateur -Sam $dossier.Sam -Ad $ad | Out-Null }
    Add-Journal -Message "Compte $($dossier.Sam) créé dans $($site.ou)." -Categorie AD -Niveau Succes
} | Out-Null

Invoke-Etape -Nom "Groupes automatiques" -Categorie Groupes -Ignorer:(-not $soc.groupesAuto -or $soc.groupesAuto.Count -eq 0) -Action {
    foreach ($g in $soc.groupesAuto) {
        Add-ADGroupMember -Identity $g -Members $dossier.Sam @ad
        Add-Journal -Message "Ajouté au groupe $g." -Categorie Groupes -Niveau Succes
    }
} | Out-Null

Invoke-Etape -Nom "Synchronisation AD Connect (delta)" -Categorie AD -Ignorer:(-not $Reglages.SynchroniserAdConnect) -Action { Invoke-AdConnectDelta } | Out-Null

Invoke-Etape -Nom "Poste 3CX : réaffectation" -Categorie 3CX -Ignorer:(-not $dossier.Poste3CX) -Action {
    Set-XapiPoste -Pbx $pbx -Id $dossier.Poste3CX.Id -Proprietes @{
        FirstName = $dossier.Prenom; LastName = $dossier.Nom; EmailAddress = $dossier.Email; Enabled = $true
    }
    Add-Journal -Message "Poste $($dossier.Poste3CX.Number) réaffecté à $($dossier.DisplayName) ($($dossier.Email))." -Categorie 3CX -Niveau Succes
} | Out-Null

Invoke-Etape -Nom "Poste 3CX : files d'attente" -Categorie 3CX -Ignorer:(-not $dossier.Poste3CX -or $dossier.Files3CX.Count -eq 0) -Action {
    Add-XapiPosteAuxFiles -Pbx $pbx -Numero "$($dossier.Poste3CX.Number)" -Files $dossier.Files3CX
} | Out-Null

# ============================================================ 5. LA FICHE
$groupes = try { @(Get-ADPrincipalGroupMembership -Identity $dossier.Sam @ad -ErrorAction Stop | Select-Object -ExpandProperty Name) } catch { @($soc.groupesAuto) }
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
Invoke-Etape -Nom "Fiche envoyée au helpdesk" -Categorie General -Action { Send-Rapport -Sujet "Fiche Outlook - $($dossier.DisplayName)" -Html $html } | Out-Null
$donnees = [ordered]@{}; foreach ($k in $dossier.Keys) { if ($k -ne 'MotDePasse') { $donnees[$k] = $dossier[$k] } }
Save-Rapport -Nom "entree-$($dossier.Sam)" -Html $html -Donnees $donnees | Out-Null

Complete-Session
Write-Host "  Mot de passe initial : $($dossier.MotDePasse)" -ForegroundColor Yellow
Write-Host ""
