#Requires -Version 5.1
<#
    ENTRÉE D'UN COLLABORATEUR — Service Informatique.

    Crée le compte dans l'Active Directory de la société (OU du site, attributs,
    adresses), l'ajoute aux groupes automatiques et, au choix, aux groupes
    d'un ou d'une collègue pris pour modèle, déclenche la synchronisation
    vers Microsoft 365, réaffecte son poste 3CX et l'inscrit dans ses files,
    puis envoie la fiche au helpdesk.

    Sans argument : assistant interactif, une étape par écran. Avec -Job :
    aucun dialogue, tout vient du fichier JSON (voir exemples\entree.json) —
    c'est le contrat avec le futur portail.

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

# Un échec non rattrapé se présente comme le reste de l'interface, puis on
# ferme proprement — plutôt qu'une pile d'exception au milieu d'un encadré.
trap {
    Show-Erreur -Message (Get-MessageErreur $_)
    Stop-Script -Code 1
}
$etapes = @('Le collaborateur', 'Vérifications', 'Confirmation', 'Exécution')
Initialize-Collaborateurs -Reglages $Reglages -Dossier $PSScriptRoot -Operation 'entree' -Etapes $etapes -Interactif (-not $Job)
$config = Get-Config

# ================================================================ 1. DOSSIER
# Tout ce qu'on sait du collaborateur, réuni AVANT d'agir : c'est ce que le
# récapitulatif montre, ce que le rapport enregistre, et ce que le portail
# enverra un jour à la place des questions.
$dossier = [ordered]@{
    Societe = $null; Site = $null; Prenom = ''; Nom = ''; Fonction = ''; Service = ''; Titre = ''
    Sam = ''; Email = ''; MailNickname = ''; DisplayName = ''; MotDePasse = ''
    Modele = ''; GroupesRepris = @()          # les groupes repris d'un ou d'une collègue
    Poste3CX = $null; Files3CX = @()
}

Set-Etape 'Le collaborateur'
if ($Job) {
    $j = Get-Content -Path $Job -Raw -Encoding UTF8 | ConvertFrom-Json
    $dossier.Societe = Get-Societe -Id $j.societe
    $dossier.Site = $dossier.Societe.sites | Where-Object { $_.id -eq $j.site } | Select-Object -First 1
    if (-not $dossier.Site) { throw "Site inconnu pour $($j.societe) : $($j.site)" }
    foreach ($k in 'Prenom', 'Nom', 'Fonction', 'Service', 'Titre') { $dossier[$k] = "$(Get-Prop -Objet $j -Nom $k.ToLower() -Defaut '')" }
    if (Get-Prop -Objet $j -Nom 'identifiant') { $dossier.Sam = "$(Get-Prop -Objet $j -Nom 'identifiant')" }
} else {
    $dossier.Societe = Read-Choix -Titre 'Quelle société ?' -Elements @($config.societes) -Colonnes nom, domaineMail
    Add-Resume -Cle 'Société' -Valeur $dossier.Societe.id
    $dossier.Site = Read-Choix -Titre 'Quel site ?' -Elements @($dossier.Societe.sites) -Colonnes id, adresse, codePostal, telephone
    Add-Resume -Cle 'Site' -Valeur $dossier.Site.id
    $dossier.Prenom   = Read-Champ -Libelle 'Prénom' -Obligatoire -QuitteSurQ
    $dossier.Nom      = Read-Champ -Libelle 'Nom' -Obligatoire -QuitteSurQ
    $dossier.Fonction = Read-Champ -Libelle 'Fonction' -QuitteSurQ
    $dossier.Service  = Read-Champ -Libelle 'Service' -QuitteSurQ
    $dossier.Titre    = Read-Champ -Libelle 'Titre' -QuitteSurQ
}
$soc = $dossier.Societe; $site = $dossier.Site

$ids = ConvertTo-Identifiants -Prenom $dossier.Prenom -Nom $dossier.Nom -DomaineMail $soc.domaineMail
if (-not $dossier.Sam) { $dossier.Sam = $ids.Sam }
$dossier.Email = $ids.Email; $dossier.MailNickname = $ids.MailNickname; $dossier.DisplayName = $ids.DisplayName
$dossier.MotDePasse = New-MotDePasse
if (-not $Job) { Add-Resume -Cle 'Collaborateur' -Valeur $dossier.DisplayName }

# ====================================================== 2. VÉRIFICATIONS
# Avant la moindre écriture : on se connecte, on vérifie l'unicité, on lit le PBX.
Set-Etape 'Vérifications'
$ad = Connect-Domaine -Societe $soc
$pbx = if ($Reglages.Gerer3CX) { Get-Pbx -Societe $soc } else { $null }

while ($true) {
    $existant = Get-ADUser -Filter "SamAccountName -eq '$($dossier.Sam)'" @ad -ErrorAction SilentlyContinue
    if (-not $existant) { break }
    Show-Note "L'identifiant $($dossier.Sam) est déjà utilisé par $($existant.Name)." -Niveau Alerte
    if ($Job) { throw "Identifiant déjà pris : $($dossier.Sam)" }
    $dossier.Sam = Read-Texte -Invite 'Identifiant à utiliser' -Defaut (New-IdentifiantLibre -Prenom $dossier.Prenom -Nom $dossier.Nom -Ad $ad) -Obligatoire -QuitteSurQ
}

# L'adresse se traite comme l'identifiant : un homonyme ne doit pas arrêter le
# script, il doit demander quelle adresse prendre — et en proposer une libre.
while ($true) {
    $occupant = Find-AdParAdresse -Adresse $dossier.Email -Ad $ad
    if (-not $occupant) { break }
    Show-Note "L'adresse $($dossier.Email) est déjà portée par $($occupant.Name)." -Niveau Alerte
    if ($Job) { throw "Adresse déjà prise : $($dossier.Email)" }
    $proposition = New-AdresseLibre -Base $ids.MailNickname -Domaine $soc.domaineMail -Ad $ad
    $saisie = Read-Texte -Invite 'Adresse e-mail à utiliser' -Defaut $proposition -Aide 'le domaine est ajouté si vous ne le mettez pas' -Obligatoire -QuitteSurQ
    if ($saisie -notlike '*@*') { $saisie = "$saisie$($soc.domaineMail)" }
    $dossier.Email = $saisie
    $dossier.MailNickname = ($saisie -split '@')[0]
}
Show-Constat -Titre "Identifiant et adresse libres dans l'Active Directory" -Valeurs @($dossier.Sam, $dossier.Email)

# --- Les groupes d'un ou d'une collègue : le nouveau reçoit les mêmes accès.
#     Les groupes automatiques de la société sont déjà prévus ; les groupes
#     « sensibles » (config entree.groupesSensibles) sont proposés décochés.
$sensibles = @(Get-Prop -Objet (Get-Prop -Objet $config -Nom 'entree') -Nom 'groupesSensibles' -Defaut @())
function Get-GroupesReprenables {
    param([Parameter(Mandatory)] [string] $Sam)
    $liste = @(Get-AdGroupesDe -Sam $Sam -Ad $ad | Where-Object { $soc.groupesAuto -notcontains $_.Nom })
    return @($liste | ForEach-Object {
        $nom = $_.Nom
        $sensible = @($sensibles | Where-Object { $nom -like $_ }).Count -gt 0
        [pscustomobject]@{ Nom = $_.Nom; DN = $_.DN; Note = $(if ($sensible) { 'sensible — décoché' } else { '' }) }
    })
}
if ($Job) {
    $modeleSam = "$(Get-Prop -Objet $j -Nom 'groupesDe' -Defaut '')"
    if ($modeleSam) {
        $modele = Get-ADUser -Identity $modeleSam @ad
        $dossier.Modele = $modele.Name
        $dossier.GroupesRepris = @(Get-GroupesReprenables -Sam $modeleSam | Where-Object { -not $_.Note })
    }
} elseif (Confirm-Choix -Question "Reprendre les groupes d'un ou d'une collègue ?" -DefautOui) {
    $modele = $null
    $collegues = @(Invoke-Attente -Titre "Lecture des collègues du site $($site.id)" -Action { @(Get-AdCollegues -Ou $site.ou -Ad $ad) })
    $ailleurs = [pscustomobject]@{ Name = "Chercher quelqu'un d'autre…"; SamAccountName = ''; Title = ''; Department = '' }
    $choix = Read-Choix -Titre "Sur le modèle de qui ? ($($collegues.Count) sur le site)" -Elements (@($ailleurs) + $collegues) -Colonnes Name, SamAccountName, Title, Department
    if ($choix.SamAccountName) { $modele = $choix }
    while (-not $modele) {
        $recherche = Read-Texte -Invite 'Qui ?' -Aide 'nom, prénom ou identifiant' -Obligatoire -QuitteSurQ
        $trouves = @(Invoke-Attente -Titre "Recherche de « $recherche » dans l'Active Directory" -Action { @(Find-AdUtilisateur -Recherche $recherche -Ad $ad) })
        if ($trouves.Count -eq 0) { Show-Note 'Aucun compte ne correspond.' -Niveau Alerte; continue }
        $modele = Read-Choix -Titre "Quel compte ? ($($trouves.Count) trouvé$(if ($trouves.Count -gt 1) { 's' }))" -Elements $trouves -Colonnes Name, SamAccountName, Title, Department
    }
    $reprenables = @(Invoke-Attente -Titre "Lecture des groupes de $($modele.Name)" -Action { @(Get-GroupesReprenables -Sam $modele.SamAccountName) })
    if ($reprenables.Count -eq 0) {
        Show-Note "$($modele.Name) n'a aucun groupe à reprendre en plus des groupes automatiques." -Niveau Alerte
    } else {
        $coches = @(); for ($i = 0; $i -lt $reprenables.Count; $i++) { if (-not $reprenables[$i].Note) { $coches += $i } }
        $dossier.Modele = $modele.Name
        $dossier.GroupesRepris = @(Read-Choix -Titre "Quels groupes reprendre de $($modele.Name) ? ($($reprenables.Count))" -Elements $reprenables -Colonnes Nom, Note -Multiple -IndicesCoches $coches)
        Show-Constat -Titre "$($dossier.GroupesRepris.Count) groupe(s) repris de $($modele.Name)" -Niveau Info
        Add-Resume -Cle 'Groupes' -Valeur "$($dossier.GroupesRepris.Count) de $($modele.Name)"
    }
}

if ($pbx) {
    $lecture = Invoke-Attente -Titre "Lecture du 3CX ($($pbx.adresse))" -Action {
        $memeEmail = @(Find-XapiUtilisateurParEmail -Pbx $pbx -Email $dossier.Email)
        if ($memeEmail.Count -gt 0) { throw "L'adresse $($dossier.Email) est déjà portée par le poste 3CX $($memeEmail[0].Number)." }
        $prefixe = "$(Get-Prop -Objet $site -Nom 'prefixePostes' -Defaut '')"
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
        Show-Constat -Titre "$($candidats.Count) postes libres au 3CX — désactivés, ou nommés « libre »" -Niveau Info
        if ($candidats.Count -gt 0 -and (Confirm-Choix -Question 'Réaffecter un poste libre à ce collaborateur ?' -DefautOui)) {
            $vue = @($candidats | Select-Object *, @{ n = 'Etat'; e = { if ($_.Enabled) { 'actif' } else { 'désactivé' } } })
            $dossier.Poste3CX = Read-Choix -Titre 'Quel poste 3CX réaffecter ?' -Elements $vue -Colonnes Number, DisplayName, EmailAddress, Etat
        }
    }
    if ($dossier.Poste3CX) {
        if (-not $Job) { Add-Resume -Cle 'Poste' -Valeur "$($dossier.Poste3CX.Number)" }
        $filesVoulues = if ($Job) { @(Get-Prop -Objet $j -Nom 'files3cx' -Defaut @() | ForEach-Object { "$_" }) } else { @() }
        if ($filesVoulues.Count -gt 0) {
            $dossier.Files3CX = @($toutesFiles | Where-Object { $filesVoulues -contains "$($_.Number)" })
        } elseif (-not $Job -and (Confirm-Choix -Question "Inscrire ce poste dans des files d'attente ?" -DefautOui)) {
            $dossier.Files3CX = @(Read-Choix -Titre "Dans quelles files d'attente ?" -Elements $toutesFiles -Colonnes Number, Name -Multiple)
        }
    }
}

# ====================================================== 3. RÉCAPITULATIF
Set-Etape 'Confirmation'
$recap = [ordered]@{
    'Société'         = $soc.nom
    'Site'            = "$($site.id) — $($site.adresse), $($site.codePostal)"
    'Nom complet'     = $dossier.DisplayName
    'Identifiant'     = $dossier.Sam
    'E-mail'          = $dossier.Email
    'Fonction'        = $(if ($dossier.Fonction) { $dossier.Fonction } else { '—' })
    'Service'         = $(if ($dossier.Service) { $dossier.Service } else { '—' })
    'Titre'           = $(if ($dossier.Titre) { $dossier.Titre } else { '—' })
    'OU'              = $site.ou
    'Groupes auto'    = $(if ($soc.groupesAuto) { $soc.groupesAuto -join '; ' } else { '—' })
    'Groupes repris'  = $(if ($dossier.GroupesRepris.Count) { "$($dossier.GroupesRepris.Count) de $($dossier.Modele) : $(($dossier.GroupesRepris | ForEach-Object { $_.Nom }) -join '; ')" } else { '—' })
    'Poste 3CX'       = $(if ($dossier.Poste3CX) { "$($dossier.Poste3CX.Number) (ex « $($dossier.Poste3CX.DisplayName) »)" } elseif ($pbx) { 'aucun' } else { 'pas de PBX pour cette société' })
    'Files 3CX'       = $(if ($dossier.Files3CX.Count) { ($dossier.Files3CX | ForEach-Object { "$($_.Number) $($_.Name)" }) -join ' · ' } else { '—' })
    'Mode'            = $(if ($Reglages.Simulation) { 'SIMULATION — rien ne sera écrit' } else { 'RÉEL — le compte sera créé' })
}
Show-Recap -Paires $recap -Titre 'Récapitulatif avant création'
if (-not $Job -and -not (Confirm-Choix -Question $(if ($Reglages.Simulation) { 'Lancer la simulation ?' } else { 'Confirmer et CRÉER le compte ?' }))) { Stop-Script }

# ============================================================ 4. EXÉCUTION
Set-Etape 'Exécution'
Start-Flux
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
        Invoke-Ecriture -Categorie AD -Description "Créer $($dossier.DisplayName) — $($dossier.Email) — dans $($site.ou)" -Action {
            New-ADUser @params @ad
            Wait-AdUtilisateur -Sam $dossier.Sam -Ad $ad | Out-Null
            Add-Journal -Message "Dans $($site.ou), UPN $($dossier.Email)." -Categorie AD
        } | Out-Null
    } | Out-Null

    Invoke-Etape -Nom 'Groupes automatiques' -Categorie Groupes -Ignorer:(-not $soc.groupesAuto -or $soc.groupesAuto.Count -eq 0) -Action {
        foreach ($g in $soc.groupesAuto) {
            Invoke-Ecriture -SansJournal -Categorie Groupes -Description "Ajouter à $g" -Action { Add-ADGroupMember -Identity $g -Members $dossier.Sam @ad } | Out-Null
        }
        if (Test-Simulation) { Add-Journal -Message "SIMULATION : ajouter à $($soc.groupesAuto -join '; ')" -Categorie Groupes -Niveau Simule }
        else { Add-Journal -Message "Ajouté à $($soc.groupesAuto -join '; ')" -Categorie Groupes -Niveau Succes }
    } | Out-Null

    Invoke-Etape -Nom $(if ($dossier.Modele) { "Groupes repris de $($dossier.Modele)" } else { "Groupes repris d'un collègue" }) -Categorie Groupes -Ignorer:($dossier.GroupesRepris.Count -eq 0) -Action {
        foreach ($g in $dossier.GroupesRepris) {
            Invoke-Ecriture -SansJournal -Categorie Groupes -Description "Ajouter à $($g.Nom)" -Action { Add-ADGroupMember -Identity $g.DN -Members $dossier.Sam @ad } | Out-Null
        }
        $noms = @($dossier.GroupesRepris | ForEach-Object { $_.Nom })
        if (Test-Simulation) { Add-Journal -Message "SIMULATION : ajouter à $($noms.Count) groupe(s)" -Categorie Groupes -Niveau Simule }
        else { Add-Journal -Message "Ajouté à $($noms.Count) groupe(s)." -Categorie Groupes -Niveau Succes }
        Add-Journal -Message ($noms -join '; ') -Categorie Groupes
    } | Out-Null

    Invoke-Etape -Nom 'Synchronisation AD Connect (delta)' -Categorie AD -Ignorer:(-not $Reglages.SynchroniserAdConnect) -Action { Invoke-AdConnectDelta } | Out-Null

    Invoke-Etape -Nom 'Poste 3CX réaffecté' -Categorie 3CX -Ignorer:(-not $dossier.Poste3CX) -Action {
        $num = "$($dossier.Poste3CX.Number)"
        Set-XapiPoste -Pbx $pbx -Id $dossier.Poste3CX.Id -Numero $num -Proprietes @{
            FirstName = $dossier.Prenom; LastName = $dossier.Nom; EmailAddress = $dossier.Email; Enabled = $true
        } -Libelle "Réaffecter le poste $num à $($dossier.DisplayName) ($($dossier.Email)) et le réactiver"
        if (-not (Test-Simulation)) { Add-Journal -Message "Poste $num à $($dossier.DisplayName) ($($dossier.Email)), réactivé." -Categorie 3CX -Niveau Succes }
    } | Out-Null

    Invoke-Etape -Nom "Poste 3CX inscrit dans ses files d'attente" -Categorie 3CX -Ignorer:(-not $dossier.Poste3CX -or $dossier.Files3CX.Count -eq 0) -Action {
        Add-XapiPosteAuxFiles -Pbx $pbx -Numero "$($dossier.Poste3CX.Number)" -Files $dossier.Files3CX
    } | Out-Null
} catch {
    Show-Note "Exécution interrompue : $(Get-MessageErreur $_)" -Niveau Erreur
    Add-Journal -Message "Exécution interrompue : $(Get-MessageErreur $_)" -Niveau Erreur
}

# ============================================================ 5. LA FICHE
$groupes = if (Test-Simulation) { @($soc.groupesAuto) + @($dossier.GroupesRepris | ForEach-Object { $_.Nom }) }
           else { try { @(Get-ADPrincipalGroupMembership -Identity $dossier.Sam @ad -ErrorAction Stop | Select-Object -ExpandProperty Name | Sort-Object) } catch { @($soc.groupesAuto) + @($dossier.GroupesRepris | ForEach-Object { $_.Nom }) } }
$pourLeMail = [ordered]@{}
foreach ($k in $recap.Keys) { if ($k -notin @('Mode', 'Groupes auto', 'Groupes repris')) { $pourLeMail[$k] = $recap[$k] } }   # le mode a son bandeau, les groupes leur liste
$corps  = New-BlocEncadre -Titre 'À transmettre au collaborateur' -Paires ([ordered]@{
    "Nom d'utilisateur" = $dossier.Sam
    'Mot de passe'      = $dossier.MotDePasse
    'Adresse e-mail'    = $dossier.Email
})
$corps += New-BlocPaires -Titre 'Le dossier' -Paires $pourLeMail
$corps += New-BlocListe -Titre $(if ($dossier.Modele) { "Membre de — sur le modèle de $($dossier.Modele)" } else { 'Membre de' }) -Lignes @($groupes)
$html = ConvertTo-RapportHtml -Mot 'Entrée' -Nom $dossier.DisplayName -Corps $corps
Invoke-Etape -Nom 'Fiche envoyée au helpdesk' -Categorie General -Action { Send-Rapport -Sujet "Fiche Outlook - $($dossier.DisplayName)" -Html $html } | Out-Null
$donnees = [ordered]@{}; foreach ($k in $dossier.Keys) { if ($k -ne 'MotDePasse') { $donnees[$k] = $dossier[$k] } }
Save-Rapport -Nom "entree-$($dossier.Sam)" -Html $html -Donnees $donnees | Out-Null

Complete-Session
Show-Panneau -Texte "Identifiant : $($dossier.Sam)`nMot de passe initial : $($dossier.MotDePasse)" -Titre 'À transmettre' -Accent
