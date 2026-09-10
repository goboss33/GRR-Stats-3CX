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
    [switch] $SansAdConnect,
    [switch] $Simulation3CX,      # simuler le 3CX même si le reste est réel
    [switch] $Reel3CX             # écrire sur le 3CX POUR DE VRAI même si le reste est simulé
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
    Simulation            = $false       # AUCUNE écriture : tout est décrit
    Simulation3CX         = $null        # $null = suit Simulation ; $true/$false pour trancher à part
    EnvoyerMail           = $true
    Gerer3CX              = $true
    SynchroniserAdConnect = $true
    DossierLogs           = ''           # vide = .\logs
}
if ($ModeTest)      { $Reglages.ModeTest = $true }
if ($Simulation)    { $Reglages.Simulation = $true }
if ($Simulation3CX) { $Reglages.Simulation3CX = $true }
if ($Reel3CX)       { $Reglages.Simulation3CX = $false }
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
    Poste3CX = $null; Files3CX = @(); Numero3CX = ''; NouveauPoste = $false
    Modele3CX = $null; Copie3CX = @(); Departements3CX = @(); Sda3CX = $null
    DepartementsAFaire = @()                  # ceux du modèle quand le script n'écrit pas les départements : listés dans le rapport
    SamChoisi = ''; EmailChoisi = ''          # identifiant et adresse donnés à la main sur un homonyme, gardés tant que le nom ne bouge pas
    # Les réponses aux questions oui/non, reprises comme défauts quand on revient en arrière.
    ReprendreGroupes = $null; CreerPoste = $null; ReaffecterPoste = $null; InscrireFile = $null; AttribuerSda = $null; CopierModele = $null
}

Set-Etape 'Le collaborateur'

# ---------------------------------------------- ce que les deux modes partagent
function Update-Identifiants {
    <#
      Identifiant, adresse et nom complet dérivés du nom, recalculés dès que
      le nom bouge. Une réponse donnée à la main sur un homonyme (SamChoisi,
      EmailChoisi) est gardée tant que le nom ne change pas.
    #>
    $script:ids = ConvertTo-Identifiants -Prenom $dossier.Prenom -Nom $dossier.Nom -DomaineMail $dossier.Societe.domaineMail
    $dossier.Sam = $(if ($dossier.SamChoisi) { $dossier.SamChoisi } else { $script:ids.Sam })
    if ($dossier.EmailChoisi) { $dossier.Email = $dossier.EmailChoisi; $dossier.MailNickname = ($dossier.EmailChoisi -split '@')[0] }
    else { $dossier.Email = $script:ids.Email; $dossier.MailNickname = $script:ids.MailNickname }
    $dossier.DisplayName = $script:ids.DisplayName
    if (-not $dossier.MotDePasse) { $dossier.MotDePasse = New-MotDePasse }
}

function Connect-Annuaire {
    <# La connexion au domaine et le PBX de la société, une fois par société. #>
    if ($script:adSociete -ne $dossier.Societe.id) {
        $script:ad = Connect-Domaine -Societe $dossier.Societe
        $script:adSociete = $dossier.Societe.id
        $avis = Test-EcritureAdRisquee -Ad $script:ad
        if ($avis) { Show-Note $avis -Niveau Alerte; Add-JournalUnique -Cle 'elevation' -Message $avis -Categorie AD -Niveau Alerte }
    }
    $script:pbx = if ($Reglages.Gerer3CX) { Get-Pbx -Societe $dossier.Societe } else { $null }
}

function Read-Pbx {
    <# Ce que l'entrée lit au 3CX, une fois par société et par site ; les listes sont posées au niveau du script. #>
    if (-not $script:pbx) { $script:candidats = @(); $script:toutesFiles = @(); $script:tousPostes = @(); $script:departements = @(); return }
    $cle = "$($dossier.Societe.id)/$($dossier.Site.id)"
    if ($script:lectureCle -ne $cle) {
        $script:prefixePostes = "$(Get-Prop -Objet $dossier.Site -Nom 'prefixePostes' -Defaut '')"
        $script:lecture = Invoke-Attente -Titre "Lecture du 3CX ($($script:pbx.adresse))" -Action {
            $candidats = @(Get-XapiPostesLibres -Pbx $script:pbx -Prefixe $script:prefixePostes)
            if ($candidats.Count -eq 0 -and $script:prefixePostes) { $candidats = @(Get-XapiPostesLibres -Pbx $script:pbx) }
            return @{
                Candidats    = $candidats
                Files        = @(Get-XapiFiles -Pbx $script:pbx | Sort-Object Name)
                Utilisateurs = @(Get-XapiUtilisateurs -Pbx $script:pbx)
                Departements = @(Get-XapiDepartements -Pbx $script:pbx)
                NumeroLibre  = "$(Get-XapiNumeroLibre -Pbx $script:pbx)"
            }
        }
        $script:lectureCle = $cle
        $script:sda = $null
    }
    $script:candidats = @($script:lecture.Candidats); $script:toutesFiles = @($script:lecture.Files)
    $script:tousPostes = @($script:lecture.Utilisateurs); $script:departements = @($script:lecture.Departements)
}

function Set-ModeleCopie {
    <#
      Tout est repris du modèle, sans rien demander : réglages et touches
      BLF, profils de renvoi et exceptions, départements si config.json
      l'autorise — sinon ils sont listés dans le rapport, à faire à la main.
    #>
    param([Parameter(Mandatory)] [string] $Numero)
    $script:numeroModele = $Numero
    $dossier.Modele3CX = Invoke-Attente -Titre "Lecture du poste $Numero" -Action { Get-XapiPosteComplet -Pbx $script:pbx -Numero $script:numeroModele }
    if (-not $dossier.Modele3CX) { throw "Poste modèle introuvable : $Numero" }
    $dossier.Copie3CX = @('reglages', 'renvois')
    $sesDepartements = @(Get-XapiDepartementsDuPoste -Departements $script:departements -Numero $Numero)
    if ([bool](Get-Prop -Objet $script:pbx -Nom 'rattacherDepartements' -Defaut $false)) { $dossier.Copie3CX += 'departements'; $dossier.Departements3CX = $sesDepartements; $dossier.DepartementsAFaire = @() }
    else { $dossier.Departements3CX = @(); $dossier.DepartementsAFaire = $sesDepartements }
    $nbBlf = ([regex]::Matches("$(Get-Prop -Objet $dossier.Modele3CX -Nom 'Blfs' -Defaut '')", '<BLF ')).Count
    $nbRenvois = @(Get-Prop -Objet $dossier.Modele3CX -Nom 'ForwardingProfiles' -Defaut @()).Count
    $valeurs = @("$nbBlf touches BLF", "$nbRenvois profils de renvoi")
    if ($dossier.Departements3CX.Count) { $valeurs += "$($dossier.Departements3CX.Count) départements" }
    elseif ($sesDepartements.Count) { $valeurs += "$($sesDepartements.Count) départements à faire dans la console" }
    Show-Constat -Titre "Tout est repris du poste $Numero « $($dossier.Modele3CX.DisplayName) »" -Valeurs $valeurs -Niveau Info
}

function Get-Recap {
    <# Le récapitulatif — le même à l'écran, en mode -Job et dans le rapport. #>
    $soc = $dossier.Societe; $site = $dossier.Site; $pbx = $script:pbx
    $mots = @{ reglages = 'réglages et BLF'; renvois = 'renvois'; departements = 'départements' }
    $copie = @($dossier.Copie3CX | ForEach-Object { if ($mots.ContainsKey($_)) { $mots[$_] } else { $_ } })
    return [ordered]@{
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
        'Poste 3CX'       = $(if ($dossier.NouveauPoste) { "$($dossier.Numero3CX) — à CRÉER" } elseif ($dossier.Poste3CX) { "$($dossier.Numero3CX) réaffecté (ex « $($dossier.Poste3CX.DisplayName) »)" } elseif ($pbx) { 'aucun' } else { 'pas de PBX pour cette société' })
        'File 3CX'        = $(if ($dossier.Files3CX.Count) { ($dossier.Files3CX | ForEach-Object { "$($_.Number) $($_.Name)" }) -join ' · ' } else { '—' })
        'Config 3CX'      = $(if ($dossier.Modele3CX) { "tout repris du poste $($dossier.Modele3CX.Number) « $($dossier.Modele3CX.DisplayName) » : $($copie -join ', ')" } else { '—' })
        'Départements'    = $(if ($dossier.Departements3CX.Count) { ($dossier.Departements3CX | ForEach-Object { $_.Name }) -join '; ' }
                               elseif ($dossier.DepartementsAFaire.Count) { "à faire dans la console : $(($dossier.DepartementsAFaire | ForEach-Object { $_.Name }) -join '; ')" }
                               else { '—' })
        'Numéro direct'   = $(if ($dossier.Sda3CX) { "$($dossier.Sda3CX.Numero) — aujourd'hui : $($dossier.Sda3CX.Etat)" } else { '—' })
        'Écriture AD'     = (Get-CompteAdEcriture -Ad $script:ad)
        'Mode'            = (Get-ModeEcriture)
    }
}

# --- Les groupes d'un ou d'une collègue : le nouveau reçoit les mêmes accès.
#     Les groupes automatiques de la société sont déjà prévus ; les groupes
#     « sensibles » (config entree.groupesSensibles) sont marqués.
$sensibles = @(Get-Prop -Objet (Get-Prop -Objet $config -Nom 'entree') -Nom 'groupesSensibles' -Defaut @())
function Get-GroupesReprenables {
    <# Les groupes du modèle, moins ceux que la société donne déjà. Les groupes sensibles sont marqués, pas retirés. #>
    param([AllowEmptyCollection()] [object[]] $Groupes = @())
    $auto = @($dossier.Societe.groupesAuto)
    $liste = @($Groupes | Where-Object { $auto -notcontains $_.Nom })
    return @($liste | ForEach-Object {
        $nom = $_.Nom
        $sensible = @($sensibles | Where-Object { $nom -like $_ }).Count -gt 0
        [pscustomobject]@{ Nom = $_.Nom; DN = $_.DN; Note = $(if ($sensible) { 'sensible' } else { '' }) }
    })
}

if ($Job) {
    # ---------------------------------------------- sans dialogue : le fichier de travail décide
    $j = Get-Content -Path $Job -Raw -Encoding UTF8 | ConvertFrom-Json
    $dossier.Societe = Get-Societe -Id $j.societe
    $dossier.Site = $dossier.Societe.sites | Where-Object { $_.id -eq $j.site } | Select-Object -First 1
    if (-not $dossier.Site) { throw "Site inconnu pour $($j.societe) : $($j.site)" }
    foreach ($k in 'Prenom', 'Nom', 'Fonction', 'Service', 'Titre') { $dossier[$k] = "$(Get-Prop -Objet $j -Nom $k.ToLower() -Defaut '')" }
    if (Get-Prop -Objet $j -Nom 'identifiant') { $dossier.SamChoisi = "$(Get-Prop -Objet $j -Nom 'identifiant')" }
    Update-Identifiants

    Set-Etape 'Vérifications'
    Connect-Annuaire
    $existant = Get-ADUser -Filter "SamAccountName -eq '$($dossier.Sam)'" @ad -ErrorAction SilentlyContinue
    if ($existant) { throw "Identifiant déjà pris : $($dossier.Sam) ($($existant.Name))" }
    $occupant = Find-AdParAdresse -Adresse $dossier.Email -Ad $ad
    if ($occupant) { throw "Adresse déjà prise : $($dossier.Email) ($($occupant.Name))" }
    if ($pbx) {
        $memeEmail = @(Find-XapiUtilisateurParEmail -Pbx $pbx -Email $dossier.Email)
        if ($memeEmail.Count -gt 0) { throw "L'adresse $($dossier.Email) est déjà portée par le poste 3CX $($memeEmail[0].Number)." }
    }
    Show-Constat -Titre "Identifiant et adresse libres dans l'Active Directory$(if ($pbx) { ' et au 3CX' })" -Valeurs @($dossier.Sam, $dossier.Email)

    $modeleSam = "$(Get-Prop -Objet $j -Nom 'groupesDe' -Defaut '')"
    if ($modeleSam) {
        $modele = Get-ADUser -Identity $modeleSam @ad
        $dossier.Modele = $modele.Name
        $dossier.GroupesRepris = @(Get-GroupesReprenables -Groupes @(Get-AdGroupesDe -Sam $modeleSam -Ad $ad) | Where-Object { -not $_.Note })
    }

    Read-Pbx
    if ($pbx) {
        $posteVoulu = "$(Get-Prop -Objet $j -Nom 'poste3cx' -Defaut '')"
        $nouveau = "$(Get-Prop -Objet $j -Nom 'nouveauPoste3cx' -Defaut '')"
        if ($nouveau) {
            $dossier.NouveauPoste = $true
            $dossier.Numero3CX = $(if ($nouveau -match '^\d+$') { $nouveau } else { $lecture.NumeroLibre })
        } elseif ($posteVoulu) {
            $dossier.Poste3CX = @($tousPostes | Where-Object { "$($_.Number)" -eq $posteVoulu })[0]
            if (-not $dossier.Poste3CX) { throw "Poste 3CX introuvable : $posteVoulu" }
            $dossier.Numero3CX = "$($dossier.Poste3CX.Number)"
        }
        # Une seule file : la première de la liste donnée, pour rester compatible avec « files3cx ».
        $filesVoulues = @(Get-Prop -Objet $j -Nom 'files3cx' -Defaut @() | ForEach-Object { "$_" })
        $fileVoulue = "$(Get-Prop -Objet $j -Nom 'file3cx' -Defaut '')"
        if ($fileVoulue) { $filesVoulues = @($fileVoulue) }
        if ($filesVoulues.Count -gt 0) { $dossier.Files3CX = @($toutesFiles | Where-Object { "$($_.Number)" -eq $filesVoulues[0] } | Select-Object -First 1) }
        $sdaVoulue = "$(Get-Prop -Objet $j -Nom 'sda' -Defaut '')"
        if ($sdaVoulue) {
            $dossier.Sda3CX = @(Get-XapiSda -Pbx $pbx | Where-Object { $_.Numero -eq $sdaVoulue })[0]
            if (-not $dossier.Sda3CX) { throw "SDA inconnue du PBX : $sdaVoulue" }
        }
        $modeleVoulu = "$(Get-Prop -Objet $j -Nom 'copierPoste3cxDe' -Defaut '')"
        if ($modeleVoulu -and $dossier.NouveauPoste) { Set-ModeleCopie -Numero $modeleVoulu }
    }

    Set-Etape 'Confirmation'
    Show-Recap -Paires (Get-Recap) -Titre 'Récapitulatif avant création'
} else {
    # ---------------------------------------------- l'assistant : des sections qu'on peut reprendre
    # Échap dans une liste, « q » dans un champ : question précédente. Au
    # récapitulatif, « Non » ouvre la liste des réponses à modifier. Chaque
    # question reprend sa réponse précédente comme défaut.
    $sections = @(
        @{ Etape = 'Le collaborateur'; Nom = 'Société'; Resume = { $dossier.Societe.id }; Action = {
            $societes = @($config.societes)
            $dossier.Societe = Read-Choix -Titre 'Quelle société ?' -Elements $societes -Colonnes nom, domaineMail `
                -DefautIndice (Get-IndiceDe -Elements $societes -Ou { $dossier.Societe -and $_.id -eq $dossier.Societe.id })
            Add-Resume -Cle 'Société' -Valeur $dossier.Societe.id
            if ($dossier.Site -and @($dossier.Societe.sites | Where-Object { $_.id -eq $dossier.Site.id }).Count -eq 0) { $dossier.Site = $null }
        } },
        @{ Nom = 'Site'; Resume = { if ($dossier.Site) { $dossier.Site.id } }; Action = {
            $sites = @($dossier.Societe.sites)
            $dossier.Site = Read-Choix -Titre 'Quel site ?' -Elements $sites -Colonnes id, adresse, codePostal, telephone `
                -DefautIndice (Get-IndiceDe -Elements $sites -Ou { $dossier.Site -and $_.id -eq $dossier.Site.id })
            Add-Resume -Cle 'Site' -Valeur $dossier.Site.id
        } },
        @{ Nom = 'Prénom'; Resume = { $dossier.Prenom }; Action = {
            $avant = $dossier.Prenom
            $dossier.Prenom = Read-Champ -Libelle 'Prénom' -Defaut $dossier.Prenom -Obligatoire -QuitteSurQ
            if ($dossier.Prenom -ne $avant) { $dossier.SamChoisi = ''; $dossier.EmailChoisi = '' }
        } },
        @{ Nom = 'Nom'; Resume = { $dossier.Nom }; Action = {
            $avant = $dossier.Nom
            $dossier.Nom = Read-Champ -Libelle 'Nom' -Defaut $dossier.Nom -Obligatoire -QuitteSurQ
            if ($dossier.Nom -ne $avant) { $dossier.SamChoisi = ''; $dossier.EmailChoisi = '' }
        } },
        @{ Nom = 'Fonction'; Resume = { $dossier.Fonction }; Action = { $dossier.Fonction = Read-Champ -Libelle 'Fonction' -Defaut $dossier.Fonction -QuitteSurQ } },
        @{ Nom = 'Service';  Resume = { $dossier.Service };  Action = { $dossier.Service  = Read-Champ -Libelle 'Service'  -Defaut $dossier.Service  -QuitteSurQ } },
        @{ Nom = 'Titre';    Resume = { $dossier.Titre };    Action = {
            $dossier.Titre = Read-Champ -Libelle 'Titre' -Defaut $dossier.Titre -QuitteSurQ
            Update-Identifiants
            Add-Resume -Cle 'Collaborateur' -Valeur $dossier.DisplayName
        } },

        @{ Etape = 'Vérifications'; Nom = "Unicité dans l'annuaire"; Action = {
            Connect-Annuaire
            Update-Identifiants
            $ad = $script:ad; $pbx = $script:pbx
            while ($true) {
                $existant = Get-ADUser -Filter "SamAccountName -eq '$($dossier.Sam)'" @ad -ErrorAction SilentlyContinue
                if (-not $existant) { break }
                Show-Note "L'identifiant $($dossier.Sam) est déjà utilisé par $($existant.Name)." -Niveau Alerte
                $dossier.SamChoisi = Read-Texte -Invite 'Identifiant à utiliser' -Defaut (New-IdentifiantLibre -Prenom $dossier.Prenom -Nom $dossier.Nom -Ad $ad) -Obligatoire -QuitteSurQ
                $dossier.Sam = $dossier.SamChoisi
            }
            # L'adresse doit être libre dans l'annuaire ET au central : un poste qui la porte déjà bloquerait plus tard.
            while ($true) {
                $occupant = Find-AdParAdresse -Adresse $dossier.Email -Ad $ad
                $posteMemeAdresse = $null
                if (-not $occupant -and $pbx) { $posteMemeAdresse = @(Find-XapiUtilisateurParEmail -Pbx $pbx -Email $dossier.Email)[0] }
                if (-not $occupant -and -not $posteMemeAdresse) { break }
                if ($occupant) { Show-Note "L'adresse $($dossier.Email) est déjà portée par $($occupant.Name)." -Niveau Alerte }
                else { Show-Note "L'adresse $($dossier.Email) est déjà portée par le poste 3CX $($posteMemeAdresse.Number) « $($posteMemeAdresse.DisplayName) »." -Niveau Alerte }
                $proposition = New-AdresseLibre -Base $script:ids.MailNickname -Domaine $dossier.Societe.domaineMail -Ad $ad
                $saisie = Read-Texte -Invite 'Adresse e-mail à utiliser' -Defaut $proposition -Aide 'le domaine est ajouté si vous ne le mettez pas' -Obligatoire -QuitteSurQ
                if ($saisie -notlike '*@*') { $saisie = "$saisie$($dossier.Societe.domaineMail)" }
                $dossier.EmailChoisi = $saisie; $dossier.Email = $saisie; $dossier.MailNickname = ($saisie -split '@')[0]
            }
            Show-Constat -Titre "Identifiant et adresse libres dans l'Active Directory$(if ($pbx) { ' et au 3CX' })" -Valeurs @($dossier.Sam, $dossier.Email)
        } },

        @{ Nom = "Groupes d'un collègue"; Resume = { if ($dossier.Modele) { "$($dossier.GroupesRepris.Count) de $($dossier.Modele)" } else { 'non' } }; Action = {
            $defautOui = $(if ($null -eq $dossier.ReprendreGroupes) { $true } else { [bool]$dossier.ReprendreGroupes })
            $dossier.ReprendreGroupes = Confirm-Choix -Question "Reprendre les groupes d'un ou d'une collègue ?" -DefautOui:$defautOui
            if (-not $dossier.ReprendreGroupes) { $dossier.Modele = ''; $dossier.GroupesRepris = @(); Remove-Resume -Cle 'Groupes'; return }
            # Le même champ de recherche que pour la redirection des mails, à l'identique.
            $modele = $null
            do {
                $script:rechercheModele = Read-Texte -Invite 'Sur le modèle de qui ?' -Defaut $dossier.Modele -Aide 'nom, prénom ou identifiant' -Obligatoire -QuitteSurQ
                $trouves = @(Invoke-Attente -Titre "Recherche de « $($script:rechercheModele) » dans l'Active Directory" -Action {
                    # « désactivé » seulement si l'annuaire l'affirme : une propriété absente n'est pas un compte fermé.
                    @(Find-AdUtilisateur -Recherche $script:rechercheModele -Ad $script:ad | Select-Object *, @{ n = 'Etat'; e = { if ($_.Enabled -eq $false) { 'désactivé' } else { '' } } })
                })
                if ($trouves.Count -eq 0) { Show-Note "Aucun compte ne correspond à « $($script:rechercheModele) »." -Niveau Alerte; continue }
                $modele = Read-Choix -Titre "Quel compte ? ($($trouves.Count) trouvé$(if ($trouves.Count -gt 1) { 's' }))" -Elements $trouves -Colonnes Name, SamAccountName, Title, Department, Etat `
                    -DefautIndice (Get-IndiceDe -Elements $trouves -Ou { $_.Name -eq $dossier.Modele })
            } while (-not $modele)
            $script:samModele = $modele.SamAccountName
            $tousSesGroupes = @(Invoke-Attente -Titre "Lecture des groupes de $($modele.Name)" -Action { @(Get-AdGroupesDe -Sam $script:samModele -Ad $script:ad) })
            $reprenables = @(Get-GroupesReprenables -Groupes $tousSesGroupes)
            if ($reprenables.Count -eq 0) {
                # On distingue les deux cas : rien lu du tout, ou tout déjà couvert par la société.
                if ($tousSesGroupes.Count -eq 0) { Show-Note "Aucun groupe lu pour $($modele.SamAccountName) — lancez .\Test-Annuaire.ps1 $($modele.SamAccountName) pour voir ce que l'annuaire répond." -Niveau Alerte }
                else { Show-Note "Les $($tousSesGroupes.Count) groupes de $($modele.Name) sont déjà donnés à tout nouveau compte de $($dossier.Societe.id) ($($dossier.Societe.groupesAuto -join '; '))." -Niveau Alerte }
                $dossier.Modele = $modele.Name; $dossier.GroupesRepris = @(); Remove-Resume -Cle 'Groupes'
                return
            }
            # Tout est coché d'avance — ou la sélection précédente, quand on revient sur le même modèle.
            $coches = @(0..($reprenables.Count - 1))
            if ($dossier.Modele -eq $modele.Name -and $dossier.GroupesRepris.Count -gt 0) {
                $gardes = @($dossier.GroupesRepris | ForEach-Object { $_.Nom })
                $coches = @(); for ($k = 0; $k -lt $reprenables.Count; $k++) { if ($gardes -contains $reprenables[$k].Nom) { $coches += $k } }
            }
            $dossier.Modele = $modele.Name
            $dossier.GroupesRepris = @(Read-Choix -Titre "Quels groupes reprendre de $($modele.Name) ?" -Aide 'tout est coché — décochez ce qui ne doit pas suivre' -Elements $reprenables -Colonnes Nom, Note -Multiple -IndicesCoches $coches)
            Show-Constat -Titre "$($dossier.GroupesRepris.Count) groupe(s) sur $($reprenables.Count) repris de $($modele.Name)" -Niveau Info
            Add-Resume -Cle 'Groupes' -Valeur "$($dossier.GroupesRepris.Count) de $($modele.Name)"
        } },

        @{ Nom = 'Lecture du 3CX'; Action = { Read-Pbx } },

        @{ Nom = 'Poste 3CX'; Resume = { if ($dossier.Numero3CX) { "$($dossier.Numero3CX) $(if ($dossier.NouveauPoste) { 'à créer' } else { 'réaffecté' })" } elseif ($script:pbx) { 'aucun' } }; Action = {
            if (-not $script:pbx) { return }
            $defautOui = $(if ($null -eq $dossier.CreerPoste) { $true } else { [bool]$dossier.CreerPoste })
            $dossier.CreerPoste = Confirm-Choix -Question 'Créer un nouveau poste 3CX pour ce collaborateur ?' -DefautOui:$defautOui
            if ($dossier.CreerPoste) {
                $defautNumero = $(if ($dossier.NouveauPoste -and $dossier.Numero3CX) { $dossier.Numero3CX } else { $script:lecture.NumeroLibre })
                $dossier.NouveauPoste = $true; $dossier.Poste3CX = $null
                $dossier.Numero3CX = Read-Texte -Invite 'Numéro du nouveau poste' -Defaut $defautNumero -Aide 'le 3CX propose le premier numéro libre' -Obligatoire -QuitteSurQ
                while (@($script:tousPostes | Where-Object { "$($_.Number)" -eq $dossier.Numero3CX }).Count -gt 0) {
                    Show-Note "Le poste $($dossier.Numero3CX) existe déjà." -Niveau Alerte
                    $dossier.Numero3CX = Read-Texte -Invite 'Numéro du nouveau poste' -Defaut $script:lecture.NumeroLibre -Obligatoire -QuitteSurQ
                }
                Show-Constat -Titre 'Nouveau poste à créer' -Valeurs @("poste $($dossier.Numero3CX)") -Niveau Info
            } else {
                $dossier.NouveauPoste = $false; $dossier.Modele3CX = $null; $dossier.Copie3CX = @(); $dossier.Departements3CX = @(); $dossier.DepartementsAFaire = @()
                Show-Constat -Titre "$($script:candidats.Count) postes libres au 3CX — désactivés, ou nommés « libre »" -Niveau Info
                $defautReaffecter = $(if ($null -eq $dossier.ReaffecterPoste) { $true } else { [bool]$dossier.ReaffecterPoste })
                $dossier.ReaffecterPoste = ($script:candidats.Count -gt 0) -and (Confirm-Choix -Question 'Réaffecter un poste libre à ce collaborateur ?' -DefautOui:$defautReaffecter)
                if ($dossier.ReaffecterPoste) {
                    $vue = @($script:candidats | Select-Object *, @{ n = 'Etat'; e = { if ($_.Enabled) { 'actif' } else { 'désactivé' } } })
                    $dossier.Poste3CX = Read-Choix -Titre 'Quel poste 3CX réaffecter ?' -Elements $vue -Colonnes Number, DisplayName, EmailAddress, Etat `
                        -DefautIndice (Get-IndiceDe -Elements $vue -Ou { $dossier.Poste3CX -and "$($_.Number)" -eq "$($dossier.Poste3CX.Number)" })
                    $dossier.Numero3CX = "$($dossier.Poste3CX.Number)"
                } else { $dossier.Poste3CX = $null; $dossier.Numero3CX = '' }
            }
            if ($dossier.Numero3CX) { Add-Resume -Cle 'Poste' -Valeur $dossier.Numero3CX } else { Remove-Resume -Cle 'Poste' }
        } },

        @{ Nom = "File d'attente"; Resume = { if ($dossier.Files3CX.Count) { "$($dossier.Files3CX[0].Number) $($dossier.Files3CX[0].Name)" } elseif ($dossier.Numero3CX) { 'aucune' } }; Action = {
            if (-not $dossier.Numero3CX) { return }
            $defautOui = $(if ($null -eq $dossier.InscrireFile) { $true } else { [bool]$dossier.InscrireFile })
            $dossier.InscrireFile = Confirm-Choix -Question "Inscrire ce poste dans une file d'attente ?" -DefautOui:$defautOui
            if (-not $dossier.InscrireFile) { $dossier.Files3CX = @(); Remove-Resume -Cle 'File'; return }
            # Une seule file : on la trouve par son numéro, son nom ou celui d'un collègue, Entrée la retient.
            $vue = @(Get-VueFiles -Files $script:toutesFiles)
            $choix = Read-Choix -Titre "Dans quelle file d'attente ?" -Aide "tapez un numéro, un nom de file ou celui d'un collègue — Entrée pour retenir" `
                -Elements $vue -Colonnes Number, Name, Equipe -MotsCles { $_.Equipe } `
                -DefautIndice (Get-IndiceDe -Elements $vue -Ou { $dossier.Files3CX.Count -gt 0 -and $_.Id -eq $dossier.Files3CX[0].Id })
            $dossier.Files3CX = @($choix)
            Add-Resume -Cle 'File' -Valeur "$($choix.Number)"
        } },

        @{ Nom = 'Numéro direct'; Resume = { if ($dossier.Sda3CX) { $dossier.Sda3CX.Numero } elseif ($dossier.Numero3CX) { 'aucun' } }; Action = {
            if (-not $dossier.Numero3CX) { return }
            $defautOui = $(if ($null -eq $dossier.AttribuerSda) { $true } else { [bool]$dossier.AttribuerSda })
            $dossier.AttribuerSda = Confirm-Choix -Question 'Attribuer un numéro direct (SDA) à ce poste ?' -DefautOui:$defautOui
            if (-not $dossier.AttribuerSda) { $dossier.Sda3CX = $null; Remove-Resume -Cle 'SDA'; return }
            if (-not $script:sda) { $script:sda = @(Invoke-Attente -Titre 'Lecture des numéros directs du 3CX' -Action { @(Get-XapiSda -Pbx $script:pbx) }) }
            $sda = $script:sda
            $libres = @($sda | Where-Object { $_.Libre })
            # On propose les numéros attribuables ; les autres restent à une
            # touche, pour le cas où l'on reprend celui d'un poste qui part.
            $choisie = $null
            $liste = $(if ($dossier.Sda3CX -and -not $dossier.Sda3CX.Libre) { $sda } else { $libres })
            while (-not $choisie) {
                $tousVisibles = ($liste.Count -eq $sda.Count)
                if ($liste.Count -eq 0) { $liste = $sda; $tousVisibles = $true }
                $bascule = [pscustomobject]@{
                    Numero = ''
                    Etat = $(if ($tousVisibles) { "← Ne montrer que les $($libres.Count) numéros libres" } else { "Voir aussi les $($sda.Count - $libres.Count) numéros déjà attribués" })
                    Nom = ''
                }
                $titre = if ($tousVisibles) { "Quel numéro direct ? ($($sda.Count) SDA, dont $($libres.Count) libres)" } else { "Quel numéro direct ? ($($libres.Count) libres sur $($sda.Count))" }
                $elements = @($bascule) + @($liste | Select-Object Numero, Etat, Nom)
                $rendu = Read-Choix -Titre $titre -Aide 'tapez le début du numéro pour filtrer, +4122 par exemple' -Elements $elements -Colonnes Numero, Etat, Nom `
                    -DefautIndice (Get-IndiceDe -Elements $elements -Ou { $dossier.Sda3CX -and $_.Numero -eq $dossier.Sda3CX.Numero } -Sinon 1)
                if ($rendu.Numero) { $choisie = $rendu } else { $liste = $(if ($tousVisibles) { $libres } else { $sda }) }
            }
            $dossier.Sda3CX = @($sda | Where-Object { $_.Numero -eq $choisie.Numero })[0]
            $combien = if ($dossier.Sda3CX.Regles.Count) { "$($dossier.Sda3CX.Regles.Count) règle(s) à réécrire" } else { "$(@($dossier.Sda3CX.Trunks).Count) règle(s) à créer" }
            Show-Constat -Titre "Numéro direct retenu — $combien" -Valeurs @($dossier.Sda3CX.Numero, "vers le poste $($dossier.Numero3CX)") -Niveau Info
            Add-Resume -Cle 'SDA' -Valeur $dossier.Sda3CX.Numero
        } },

        @{ Nom = 'Modèle 3CX'; Resume = { if ($dossier.Modele3CX) { "poste $($dossier.Modele3CX.Number)" } elseif ($dossier.NouveauPoste) { 'aucun' } }; Action = {
            if (-not $dossier.NouveauPoste) { return }
            $defautOui = $(if ($null -eq $dossier.CopierModele) { $true } else { [bool]$dossier.CopierModele })
            $dossier.CopierModele = Confirm-Choix -Question "Copier la configuration 3CX d'un collègue sur ce poste ?" -DefautOui:$defautOui
            if (-not $dossier.CopierModele) { $dossier.Modele3CX = $null; $dossier.Copie3CX = @(); $dossier.Departements3CX = @(); $dossier.DepartementsAFaire = @(); return }
            # La liste des postes s'ouvre sur les collègues de la file choisie — ce
            # sont les bons modèles — avec une bascule vers l'annuaire complet du
            # central ; elle se filtre en tapant un numéro ou un nom.
            $numerosFiles = @()
            foreach ($f in $dossier.Files3CX) { $numerosFiles += @(Get-NumerosAgents -File $f) }
            $numerosFiles = @($numerosFiles | Sort-Object -Unique)
            $annuaire = @($script:tousPostes | Where-Object { "$($_.Number)" -ne $dossier.Numero3CX } |
                Sort-Object { [int]("$($_.Number)" -replace '\D', '0') } |
                Select-Object Number, DisplayName, EmailAddress)
            $desFiles = @($annuaire | Where-Object { $numerosFiles -contains "$($_.Number)" })
            $modele = $null
            if ($annuaire.Count -eq 0) { Show-Note "Le central n'a rendu aucun poste : rien à prendre pour modèle." -Niveau Alerte }
            elseif ($dossier.Files3CX.Count -gt 0 -and $desFiles.Count -eq 0) { Show-Note "Aucun agent lisible dans la file choisie : l'annuaire complet est proposé." -Niveau Alerte }
            $dansLaFile = ($desFiles.Count -gt 0 -and -not ($dossier.Modele3CX -and @($desFiles | Where-Object { "$($_.Number)" -eq "$($dossier.Modele3CX.Number)" }).Count -eq 0))
            $liste = $(if ($dansLaFile) { $desFiles } else { $annuaire })
            while (-not $modele -and $annuaire.Count -gt 0) {
                $tousVisibles = ($liste.Count -eq $annuaire.Count)
                $elements = @($liste)
                $bascule = ($desFiles.Count -gt 0 -and $desFiles.Count -lt $annuaire.Count)
                if ($bascule) {
                    $texte = $(if ($tousVisibles) { "← Ne montrer que les $($desFiles.Count) postes de la file choisie" } else { "Chercher parmi les $($annuaire.Count) postes du central" })
                    $elements = @([pscustomobject]@{ Number = ''; DisplayName = $texte; EmailAddress = '' }) + $elements
                }
                $titre = $(if ($tousVisibles) { "Sur le modèle de quel poste ? ($($annuaire.Count) postes au central)" } else { "Sur le modèle de quel poste ? ($($desFiles.Count) dans la file choisie)" })
                $choix = Read-Choix -Titre $titre -Aide 'tapez un numéro ou un nom pour filtrer' -Elements $elements -Colonnes Number, DisplayName, EmailAddress `
                    -DefautIndice (Get-IndiceDe -Elements $elements -Ou { $dossier.Modele3CX -and "$($_.Number)" -eq "$($dossier.Modele3CX.Number)" } -Sinon $(if ($bascule) { 1 } else { 0 }))
                if ($choix.Number) { $modele = $choix } else { $liste = $(if ($tousVisibles) { $desFiles } else { $annuaire }) }
            }
            if ($modele) { Set-ModeleCopie -Numero "$($modele.Number)" }
        } },

        @{ Etape = 'Confirmation'; Nom = 'Récapitulatif'; Action = {
            Show-Recap -Paires (Get-Recap) -Titre 'Récapitulatif avant création'
            if (Confirm-Choix -Question $(if ($Reglages.Simulation) { 'Lancer la simulation ?' } else { 'Confirmer et CRÉER le compte ?' })) { return }
            Read-SectionAModifier
        } }
    )
    Invoke-Parcours -Sections $sections
}
$soc = $dossier.Societe; $site = $dossier.Site
$recap = Get-Recap

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
            try { New-ADUser @params @ad }
            catch {
                # « Accès refusé » nu ne dit ni qui écrivait, ni où : le 10.09.2026, une
                # vraie entrée lancée depuis une session sans droits sur l'OU s'est
                # arrêtée là-dessus sans que l'opérateur comprenne.
                if (Test-ErreurAccesRefuse -Erreur $_) {
                    $avis = Test-EcritureAdRisquee -Ad $ad
                    throw "Accès refusé par l'annuaire pour $(Get-CompteAdEcriture -Ad $ad) à la création dans $($site.ou). $(if ($avis) { $avis } else { "Ce compte n'a pas le droit d'y créer un utilisateur, ou d'y écrire le mot de passe et les adresses : relancez avec un compte administrateur du domaine, ou déléguez ce droit sur cette OU." })"
                }
                throw
            }
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

    # L'identifiant du poste créé, que les étapes suivantes réclament. En
    # simulation il n'existe pas : les appels sont décrits, jamais envoyés.
    $idPoste = 0
    if ($dossier.Poste3CX) { $idPoste = [int]$dossier.Poste3CX.Id }

    Invoke-Etape -Nom $(if ($dossier.NouveauPoste) { "Poste 3CX $($dossier.Numero3CX) créé" } else { "Poste 3CX $($dossier.Numero3CX) réaffecté" }) `
                 -Categorie 3CX -Ignorer:(-not $dossier.Numero3CX) -Action {
        if ($dossier.NouveauPoste) {
            $cree = New-XapiPoste -Pbx $pbx -Numero $dossier.Numero3CX -Prenom $dossier.Prenom -Nom $dossier.Nom -Email $dossier.Email
            if ($cree) { $script:idPoste = [int]$cree.Id; Add-Journal -Message "Poste $($dossier.Numero3CX) créé pour $($dossier.DisplayName)." -Categorie 3CX -Niveau Succes }
        } else {
            Set-XapiPoste -Pbx $pbx -Id $idPoste -Numero $dossier.Numero3CX -Proprietes @{
                FirstName = $dossier.Prenom; LastName = $dossier.Nom; EmailAddress = $dossier.Email; Enabled = $true
            } -Libelle "Réaffecter le poste $($dossier.Numero3CX) à $($dossier.DisplayName) ($($dossier.Email)) et le réactiver"
            if (-not (Test-Simulation3CX)) { Add-Journal -Message "Poste $($dossier.Numero3CX) à $($dossier.DisplayName), réactivé." -Categorie 3CX -Niveau Succes }
        }
    } | Out-Null
    if ($script:idPoste) { $idPoste = $script:idPoste }

    Invoke-Etape -Nom $(if ($dossier.Modele3CX) { "Configuration copiée du poste $($dossier.Modele3CX.Number)" } else { 'Configuration 3CX copiée' }) `
                 -Categorie 3CX -Ignorer:(-not $dossier.Modele3CX -or -not ($dossier.Copie3CX | Where-Object { $_ -ne 'departements' })) -Action {
        Copy-XapiConfigurationPoste -Pbx $pbx -Modele $dossier.Modele3CX -Id $idPoste -Numero $dossier.Numero3CX -Quoi $dossier.Copie3CX
    } | Out-Null

    # Le rôle du modèle dans chacun de ses départements, tel que lu au départ.
    function Get-DroitsDuModele($Departement) {
        $sien = @(Get-Prop -Objet $Departement -Nom 'Members' -Defaut @() | Where-Object { "$(Get-Prop -Objet $_ -Nom 'Number' -Defaut '')" -eq "$($dossier.Modele3CX.Number)" })[0]
        return (Get-Prop -Objet $sien -Nom 'Rights')
    }

    Invoke-Etape -Nom 'Départements 3CX et droits' -Categorie 3CX -Ignorer:($dossier.Departements3CX.Count -eq 0) -Action {
        # On écrit sur le poste, jamais sur le département (voir Set-XapiDepartementsDuPoste).
        $voulus = @()
        foreach ($dep in $dossier.Departements3CX) { $voulus += @{ Departement = $dep; Droits = (Get-DroitsDuModele $dep) } }
        Set-XapiDepartementsDuPoste -Pbx $pbx -Id $idPoste -Numero $dossier.Numero3CX -Voulus $voulus
        # Le département principal ne s'accepte QU'APRÈS le rattachement.
        $principal = @($dossier.Departements3CX | Where-Object { $_.Id -eq (Get-Prop -Objet $dossier.Modele3CX -Nom 'PrimaryGroupId') })[0]
        if ($principal) { Set-XapiDepartementPrincipal -Pbx $pbx -Id $idPoste -DepartementId ([int]$principal.Id) -Nom $principal.Name }
    } | Out-Null

    Invoke-Etape -Nom 'Départements 3CX : à rattacher dans la console' -Categorie 3CX -Ignorer:($dossier.DepartementsAFaire.Count -eq 0) -Action {
        $liste = @()
        foreach ($dep in $dossier.DepartementsAFaire) {
            $liste += "« $($dep.Name) » ($(Get-Prop -Objet (Get-DroitsDuModele $dep) -Nom 'RoleName' -Defaut 'rôle inconnu'))$(if ($dep.Id -eq (Get-Prop -Objet $dossier.Modele3CX -Nom 'PrimaryGroupId')) { ', principal' })"
        }
        Add-Journal -Message "Le script n'écrit pas les départements (config.json). À faire dans la console 3CX pour le poste $($dossier.Numero3CX), comme le poste $($dossier.Modele3CX.Number) : $($liste -join ' ; ')." -Categorie 3CX -Niveau Alerte
    } | Out-Null

    Invoke-Etape -Nom "Poste 3CX inscrit dans ses files d'attente" -Categorie 3CX -Ignorer:(-not $dossier.Numero3CX -or $dossier.Files3CX.Count -eq 0) -Action {
        Add-XapiPosteAuxFiles -Pbx $pbx -Numero $dossier.Numero3CX -Files $dossier.Files3CX
    } | Out-Null

    Invoke-Etape -Nom $(if ($dossier.Sda3CX) { "Numéro direct $($dossier.Sda3CX.Numero) dirigé vers le poste" } else { 'Numéro direct' }) `
                 -Categorie 3CX -Ignorer:(-not $dossier.Sda3CX -or -not $dossier.Numero3CX) -Action {
        Set-XapiSdaVersPoste -Pbx $pbx -Sda $dossier.Sda3CX -Numero $dossier.Numero3CX -NomRegle $dossier.DisplayName
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
