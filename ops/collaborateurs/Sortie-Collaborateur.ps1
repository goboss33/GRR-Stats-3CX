#Requires -Version 5.1
<#
    SORTIE D'UN COLLABORATEUR — Service Informatique.

    Les douze étapes de l'ancien script, inchangées dans leur logique, plus le
    3CX : désactivation AD, champs vidés, masquage de l'annuaire, groupes
    retirés, déplacement dans l'OU des désactivés, boîte partagée, redirection,
    réponse automatique, licences, délégations, poste 3CX retiré de ses files
    et désactivé, tâche Planner, rapport.

    Sans argument : assistant, une étape par écran. Avec -Job : aucun dialogue
    (exemples\sortie.json). Commencez TOUJOURS par -Simulation sur un vrai
    compte : tout est décrit, rien n'est écrit — chaque écriture passe par
    Invoke-Ecriture, y compris Exchange Online.

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
    [switch] $SansPlanner,
    [switch] $SansScanDelegations,
    [switch] $Simulation3CX,      # simuler le 3CX même si le reste est réel
    [switch] $Reel3CX,            # écrire sur le 3CX POUR DE VRAI même si le reste est simulé
    [string] $Poste3CX = ''       # désigner le poste 3CX par son numéro, au lieu de le chercher par l'adresse du compte
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
    ModeTest           = $true          # mails détournés vers DestinataireTest, sujet [TEST], pas de tâche Planner
    DestinataireTest   = 'geoffrey.bossens@grrsa.ch'
    Simulation         = $false         # AUCUNE écriture : tout est décrit
    Simulation3CX      = $null          # $null = suit Simulation ; $true/$false pour trancher à part
    EnvoyerMail        = $true
    Gerer3CX           = $true
    CreerTachePlanner  = $true
    ScanDelegations    = $true
    DossierLogs        = ''
}
if ($ModeTest)            { $Reglages.ModeTest = $true }
if ($Simulation)          { $Reglages.Simulation = $true }
if ($Simulation3CX)       { $Reglages.Simulation3CX = $true }
if ($Reel3CX)             { $Reglages.Simulation3CX = $false }
if ($SansMail)            { $Reglages.EnvoyerMail = $false }
if ($Sans3CX)             { $Reglages.Gerer3CX = $false }
if ($SansPlanner)         { $Reglages.CreerTachePlanner = $false }
if ($SansScanDelegations) { $Reglages.ScanDelegations = $false }
# ---------------------------------------------------------------------------

Import-Module (Join-Path $PSScriptRoot 'Collaborateurs.psm1') -Force

# Un échec non rattrapé se présente comme le reste de l'interface, puis on
# ferme proprement — plutôt qu'une pile d'exception au milieu d'un encadré.
trap {
    Show-Erreur -Message (Get-MessageErreur $_)
    Stop-Script -Code 1
}
$etapes = @('Le collaborateur', 'Messagerie', 'Connexions', 'Confirmation', 'Exécution')
Initialize-Collaborateurs -Reglages $Reglages -Dossier $PSScriptRoot -Operation 'sortie' -Etapes $etapes -Interactif (-not $Job)
$config = Get-Config

# ================================================================ 1. DOSSIER
$dossier = [ordered]@{
    Societe = $null; Utilisateur = $null; Sam = ''; Upn = ''; Nom = ''; Prenom = ''; NomFamille = ''; Bureau = ''
    Redirection = 'aucune'; RedirectionVers = ''; RedirectionVersNom = ''      # 'activer' | 'desactiver' | 'aucune'
    ReponseAuto = 'aucune'; ReponseAutoTexte = ''; ReponseAutoModele = ''     # idem
    ForcerCache = $false
    Poste3CX = $null; Files3CX = @(); Sda3CX = @(); ToutesFiles3CX = @()
    SupprimerPoste = $false; FileSda = $null       # supprimer le poste, ou le libérer « Libre <file> » ; la file qui reçoit ses numéros directs
    Recherche = ''                                  # la dernière recherche du compte, reproposée quand on revient
}
$proprietesAd = @('DisplayName', 'GivenName', 'Surname', 'Title', 'Department', 'Office', 'UserPrincipalName', 'Enabled', 'DistinguishedName', 'mail')

Set-Etape 'Le collaborateur'

# ---------------------------------------------- ce que les deux modes partagent
function Connect-Annuaire {
    <# La connexion au domaine, une fois par société. #>
    if ($script:adSociete -ne $dossier.Societe.id) {
        $script:ad = Connect-Domaine -Societe $dossier.Societe
        $script:adSociete = $dossier.Societe.id
        $avis = Test-EcritureAdRisquee -Ad $script:ad
        if ($avis) { Show-Note $avis -Niveau Alerte; Add-JournalUnique -Cle 'elevation' -Message $avis -Categorie AD -Niveau Alerte }
    }
}

function Set-Compte {
    <# Le compte retenu, et ce qu'on en garde. #>
    param([Parameter(Mandatory)] [string] $Sam)
    $ad = $script:ad
    $dossier.Utilisateur = Get-ADUser -Identity $Sam -Properties $proprietesAd @ad
    $u = $dossier.Utilisateur
    $dossier.Sam = $u.SamAccountName; $dossier.Upn = $u.UserPrincipalName; $dossier.Nom = $u.Name; $dossier.Bureau = "$($u.Office)"
    $dossier.Prenom = "$($u.GivenName)"; $dossier.NomFamille = "$($u.Surname)"
    if ($u.Enabled -eq $false) { Add-JournalUnique -Cle "desactive/$($u.SamAccountName)" -Message "Le compte $($u.SamAccountName) est DÉJÀ désactivé — le script reprend là où il en est." -Categorie AD -Niveau Alerte }
}

# Les variables que les modèles de réponse automatique peuvent utiliser.
function Get-VariablesReponse {
    return @{
        Prenom = $dossier.Prenom; Nom = $dossier.NomFamille; NomComplet = $dossier.Nom
        Societe = $dossier.Societe.nom; Date = (Get-Date -Format 'dd.MM.yyyy')
        Successeur = $dossier.RedirectionVersNom; SuccesseurEmail = $dossier.RedirectionVers
    }
}
function Resolve-Modele {
    <# Remplit un modèle : variables connues, puis questions pour celles qui manquent. #>
    param([Parameter(Mandatory)] $Modele, [hashtable] $Fournies = @{})
    $variables = Get-VariablesReponse
    foreach ($k in $Fournies.Keys) { $variables[$k] = "$($Fournies[$k])" }
    foreach ($v in @(Get-VariablesDuModele -Texte $Modele.texte)) {
        $connue = $null; foreach ($k in @($variables.Keys)) { if ($k -ieq $v) { $connue = $k } }
        if ($connue -and "$($variables[$connue])") { continue }
        if ($Job) { throw "Le modèle « $($Modele.nom) » attend la variable {$v} : donnez-la dans « variables »." }
        $variables[$v] = Read-Texte -Invite "Valeur pour {$v}" -Obligatoire
    }
    return Expand-Modele -Texte $Modele.texte -Variables $variables
}

function Connect-Services {
    <# Microsoft 365 une seule fois ; le PBX de la société. #>
    if ($dossier.Societe.tenantId) { if (-not $script:m365Connecte) { Connect-M365 -Societe $dossier.Societe; $script:m365Connecte = $true } }
    else { Add-JournalUnique -Cle 'tenant' -Message "Pas de tenant Microsoft 365 pour $($dossier.Societe.id) : étapes Exchange, licences et délégations ignorées." -Niveau Alerte }
    $script:pbx = if ($Reglages.Gerer3CX) { Get-Pbx -Societe $dossier.Societe } else { $null }
}

function Read-Poste3CX {
    <# Le poste 3CX de la personne, ses files et ses numéros directs — lus une fois par compte, montrés à chaque passage. #>
    if (-not $script:pbx) { $dossier.Poste3CX = $null; $dossier.Files3CX = @(); $dossier.Sda3CX = @(); $dossier.ToutesFiles3CX = @(); $dossier.FileSda = $null; return }
    # Le poste se trouve par l'adresse du compte ; -Poste3CX (ou poste3cx en -Job) le désigne par son numéro.
    $script:numeroVoulu = $(if ($Job) { "$(Get-Prop -Objet $j -Nom 'poste3cx' -Defaut '')" } else { $Poste3CX })
    $cle = "$($dossier.Sam)/$($script:numeroVoulu)"
    if ($script:posteCle -ne $cle) {
        $script:upnCherche = $dossier.Upn
        $poste = Invoke-Attente -Titre $(if ($script:numeroVoulu) { "Recherche du poste 3CX $($script:numeroVoulu)" } else { "Recherche du poste 3CX de $($dossier.Upn)" }) -Action {
            $trouves = @($(if ($script:numeroVoulu) { Find-XapiUtilisateurParNumero -Pbx $script:pbx -Numero $script:numeroVoulu } else { Find-XapiUtilisateurParEmail -Pbx $script:pbx -Email $script:upnCherche }))
            if ($trouves.Count -gt 0) { return $trouves[0] }
            if ($script:numeroVoulu) { throw "Aucun poste 3CX ne porte le numéro $($script:numeroVoulu)." }
            return $null
        }
        if (-not $poste) {
            Add-JournalUnique -Cle "poste/$($dossier.Upn)" -Message "Aucun poste 3CX ne porte l'adresse $($dossier.Upn)." -Categorie 3CX -Niveau Alerte
            # Un ancien poste n'a pas toujours d'adresse : on peut le désigner à la main.
            if (-not $Job -and (Confirm-Choix -Question "Aucun poste 3CX ne porte l'adresse $($dossier.Upn). En désigner un à la main ?")) {
                $tous = @(Invoke-Attente -Titre 'Lecture des postes du 3CX' -Action { @(Get-XapiUtilisateurs -Pbx $script:pbx | Sort-Object { [int]("$($_.Number)" -replace '\D', '0') }) })
                if ($tous.Count -gt 0) {
                    $poste = Read-Choix -Titre "Quel poste 3CX est celui de $($dossier.Nom) ? ($($tous.Count) postes au central)" -Aide 'tapez un numéro ou un nom pour filtrer' `
                        -Elements $tous -Colonnes Number, DisplayName, EmailAddress
                }
            }
        }
        $dossier.Poste3CX = $poste; $dossier.Files3CX = @(); $dossier.Sda3CX = @(); $dossier.ToutesFiles3CX = @(); $dossier.FileSda = $null
        if ($poste) {
            $script:posteTrouve = $poste
            $lecture = Invoke-Attente -Titre "Lecture du 3CX ($($script:pbx.adresse))" -Action {
                $toutes = @(Get-XapiFiles -Pbx $script:pbx | Sort-Object Name)
                return @{
                    Toutes = $toutes
                    Files  = @($toutes | Where-Object { (Get-NumerosAgents -File $_) -contains "$($script:posteTrouve.Number)" })
                    Sda    = @(Get-XapiSdaVersPoste -Pbx $script:pbx -Numero "$($script:posteTrouve.Number)")
                }
            }
            $dossier.Files3CX = @($lecture.Files); $dossier.Sda3CX = @($lecture.Sda); $dossier.ToutesFiles3CX = @($lecture.Toutes)
        }
        $script:posteCle = $cle
    }
    if ($dossier.Poste3CX) {
        Show-Constat -Titre "Poste 3CX trouvé — $($dossier.Files3CX.Count) file(s) d'attente, $($dossier.Sda3CX.Count) règle(s) entrante(s)" `
                     -Valeurs @("poste $($dossier.Poste3CX.Number)", "$($dossier.Poste3CX.DisplayName)")
    }
}

function Get-Recap {
    <# Le récapitulatif — le même à l'écran, en mode -Job et dans le rapport. #>
    $soc = $dossier.Societe; $pbx = $script:pbx
    $texteRedirection = switch ($dossier.Redirection) { 'activer' { "vers $($dossier.RedirectionVersNom) <$($dossier.RedirectionVers)>" } 'desactiver' { 'désactivée' } default { 'inchangée' } }
    $texteReponse = switch ($dossier.ReponseAuto) { 'activer' { "activée ($(if ($dossier.ReponseAutoModele -eq 'personnalise') { 'texte personnalisé' } else { "modèle $($dossier.ReponseAutoModele)" }))" } 'desactiver' { 'désactivée' } default { 'inchangée' } }
    $nomEx = "ex $($dossier.Prenom) $($dossier.NomFamille) (date du jour)"
    return [ordered]@{
        'Société'             = $soc.nom
        'Compte'              = "$($dossier.Nom)  ($($dossier.Sam))  —  $($dossier.Upn)"
        'Bureau'              = $(if ($dossier.Bureau) { $dossier.Bureau } else { '—' })
        'Redirection'         = $texteRedirection
        'Réponse automatique' = $texteReponse
        'OU de destination'   = $(if ($soc.ouDesactives) { $soc.ouDesactives } else { 'AUCUNE (pas de déplacement)' })
        'Microsoft 365'       = $(if ($soc.tenantId) { 'boîte partagée, licences, délégations' } else { 'pas de tenant : ignoré' })
        'Poste 3CX'           = $(if ($dossier.Poste3CX) { "$($dossier.Poste3CX.Number) « $($dossier.Poste3CX.DisplayName) » — $(if ($dossier.SupprimerPoste) { 'SUPPRIMÉ' } else { "libéré, nommé « Libre $(if ($dossier.FileSda) { $dossier.FileSda.Name } else { '?' }) »" }), retiré de $($dossier.Files3CX.Count) file(s)" } elseif ($pbx) { 'aucun trouvé' } else { 'pas de PBX / désactivé' })
        'Numéros directs'     = $(if (-not $dossier.Poste3CX) { '—' } elseif ($dossier.Sda3CX.Count -eq 0) { 'aucun' }
                                  elseif (-not $dossier.SupprimerPoste) { "$($dossier.Sda3CX.Count) règle(s) renommée(s) « $nomEx », destination inchangée : le poste reste" }
                                  elseif ($dossier.FileSda) { "$($dossier.Sda3CX.Count) règle(s) vers la $(Get-NomFile $dossier.FileSda), renommée(s) « $nomEx »" }
                                  else { "$($dossier.Sda3CX.Count) règle(s), AUCUNE file désignée : à rerouter à la main" })
        'Écriture AD'         = (Get-CompteAdEcriture -Ad $script:ad)
        'Mode'                = (Get-ModeEcriture)
    }
}

if ($Job) {
    # ---------------------------------------------- sans dialogue : le fichier de travail décide
    $j = Get-Content -Path $Job -Raw -Encoding UTF8 | ConvertFrom-Json
    $dossier.Societe = Get-Societe -Id $j.societe
    $samVoulu = "$(Get-Prop -Objet $j -Nom 'identifiant' -Defaut '')"
    if (-not $samVoulu) { throw "Le fichier de travail ne donne pas d'identifiant." }
    Connect-Annuaire
    Set-Compte -Sam $samVoulu
    $vers = Get-Prop -Objet $j -Nom 'redirectionVers'
    if ($vers) {
        $dossier.Redirection = 'activer'; $dossier.RedirectionVers = "$vers"
        $dossier.RedirectionVersNom = "$(Get-Prop -Objet $j -Nom 'redirectionVersNom' -Defaut $vers)"
    } elseif ((Get-Prop -Objet $j -Nom 'redirection') -eq 'desactiver') { $dossier.Redirection = 'desactiver' }

    $texte = Get-Prop -Objet $j -Nom 'reponseAuto'
    $modeleId = Get-Prop -Objet $j -Nom 'reponseAutoModele'
    if ($texte) { $dossier.ReponseAuto = 'activer'; $dossier.ReponseAutoTexte = "$texte" }
    elseif ($modeleId) {
        $m = @(Get-Prop -Objet (Get-Prop -Objet $config.sortie -Nom 'reponsesAutomatiques') -Nom 'modeles' -Defaut @()) | Where-Object { $_.id -eq $modeleId } | Select-Object -First 1
        if (-not $m) { throw "Modèle de réponse automatique inconnu : $modeleId" }
        $fournies = @{}; $vars = Get-Prop -Objet $j -Nom 'variables'
        if ($vars) { foreach ($p in $vars.PSObject.Properties) { $fournies[$p.Name] = "$($p.Value)" } }
        $dossier.ReponseAuto = 'activer'; $dossier.ReponseAutoModele = $m.id; $dossier.ReponseAutoTexte = Resolve-Modele -Modele $m -Fournies $fournies
    } elseif ((Get-Prop -Objet $j -Nom 'reponseAutoEtat') -eq 'desactiver') { $dossier.ReponseAuto = 'desactiver' }

    Set-Etape 'Connexions'
    Connect-Services
    Read-Poste3CX
    if ($dossier.Poste3CX) {
        $dossier.SupprimerPoste = [bool](Get-Prop -Objet $j -Nom 'supprimerPoste3cx' -Defaut $false)
        $voulue = "$(Get-Prop -Objet $j -Nom 'fileSda3cx' -Defaut '')"
        if ($voulue) {
            $dossier.FileSda = @($dossier.ToutesFiles3CX | Where-Object { "$($_.Number)" -eq $voulue })[0]
            if (-not $dossier.FileSda) { throw "File 3CX inconnue du PBX : $voulue" }
        } elseif ($dossier.Files3CX.Count -eq 1) { $dossier.FileSda = $dossier.Files3CX[0] }
    }

    Set-Etape 'Confirmation'
    Show-Recap -Paires (Get-Recap) -Titre 'Récapitulatif avant exécution'
} else {
    # ---------------------------------------------- l'assistant : des sections qu'on peut reprendre
    # Échap dans une liste, « q » dans un champ : question précédente. Au
    # récapitulatif, « Non » ouvre la liste des réponses à modifier. Chaque
    # question reprend sa réponse précédente comme défaut.
    $optionsRedirection = @(
        [pscustomobject]@{ Code = 'activer';    Texte = "Rediriger les mails vers un collaborateur ou une liste" },
        [pscustomobject]@{ Code = 'desactiver'; Texte = 'Désactiver la redirection existante' },
        [pscustomobject]@{ Code = 'aucune';     Texte = 'Ne rien changer à la redirection' }
    )
    $modeles = @(Get-Prop -Objet (Get-Prop -Objet $config.sortie -Nom 'reponsesAutomatiques') -Nom 'modeles' -Defaut @())
    $optionsReponse = @()
    foreach ($m in $modeles) { $optionsReponse += [pscustomobject]@{ Code = 'modele'; Modele = $m; Texte = "Modèle — $($m.nom)" } }
    $optionsReponse += [pscustomobject]@{ Code = 'libre';      Modele = $null; Texte = 'Texte personnalisé — à taper ou à coller' }
    $optionsReponse += [pscustomobject]@{ Code = 'desactiver'; Modele = $null; Texte = 'Désactiver la réponse automatique existante' }
    $optionsReponse += [pscustomobject]@{ Code = 'aucune';     Modele = $null; Texte = 'Ne rien changer à la réponse automatique' }

    $sections = @(
        @{ Etape = 'Le collaborateur'; Nom = 'Société'; Resume = { $dossier.Societe.id }; Action = {
            $societes = @($config.societes)
            $dossier.Societe = Read-Choix -Titre 'Quelle société ?' -Elements $societes -Colonnes nom, domaineMail `
                -DefautIndice (Get-IndiceDe -Elements $societes -Ou { $dossier.Societe -and $_.id -eq $dossier.Societe.id })
            Add-Resume -Cle 'Société' -Valeur $dossier.Societe.id
            Connect-Annuaire
        } },
        @{ Nom = 'Qui part'; Resume = { if ($dossier.Sam) { "$($dossier.Nom) ($($dossier.Sam))" } }; Action = {
            $choix = $null
            do {
                $script:recherche = Read-Texte -Invite 'Qui part ?' -Defaut $dossier.Recherche -Aide 'nom, prénom, identifiant ou e-mail' -Obligatoire -QuitteSurQ
                $dossier.Recherche = $script:recherche
                $trouves = @(Invoke-Attente -Titre "Recherche de « $($script:recherche) » dans l'Active Directory" -Action {
                    # « déjà désactivé » seulement si l'annuaire l'affirme : une propriété absente n'est pas un compte fermé.
                    @(Find-AdUtilisateur -Recherche $script:recherche -Ad $script:ad | Select-Object *, @{ n = 'Etat'; e = { if ($_.Enabled -eq $false) { 'déjà désactivé' } else { '' } } })
                })
                if ($trouves.Count -eq 0) { Show-Note 'Aucun compte ne correspond.' -Niveau Alerte; continue }
                $choix = Read-Choix -Titre "Quel compte ? ($($trouves.Count) trouvé$(if ($trouves.Count -gt 1) { 's' }))" -Elements $trouves -Colonnes Name, SamAccountName, Title, Department, Etat `
                    -DefautIndice (Get-IndiceDe -Elements $trouves -Ou { $_.SamAccountName -eq $dossier.Sam })
            } while (-not $choix)
            Set-Compte -Sam $choix.SamAccountName
            Add-Resume -Cle 'Qui part' -Valeur "$($dossier.Nom) · $($dossier.Sam)"
            Show-Constat -Titre 'Compte retenu' -Valeurs @($dossier.Nom, $dossier.Sam, $dossier.Upn)
        } },

        @{ Etape = 'Messagerie'; Nom = 'Redirection des mails'; Resume = { switch ($dossier.Redirection) { 'activer' { $dossier.RedirectionVers } 'desactiver' { 'désactivée' } default { 'inchangée' } } }; Action = {
            # --- Redirection : vers un utilisateur ou une liste, choisi dans une recherche.
            $r = Read-Choix -Titre "Redirection des mails de $($dossier.Upn) ?" -Elements $optionsRedirection -Colonnes Texte `
                -DefautIndice (Get-IndiceDe -Elements $optionsRedirection -Ou { $_.Code -eq $dossier.Redirection })
            if ($r.Code -eq 'activer') {
                $cible = $null
                do {
                    $script:rechercheCible = Read-Texte -Invite 'Vers qui ?' -Defaut $dossier.RedirectionVersNom -Aide 'nom, prénom, identifiant, adresse ou nom de liste' -Obligatoire -QuitteSurQ
                    $cibles = @(Invoke-Attente -Titre "Recherche de « $($script:rechercheCible) »" -Action {
                        @(Find-AdDestinataire -Recherche $script:rechercheCible -Ad $script:ad | Select-Object *, @{ n = 'Etat'; e = { if ($_.Actif) { '' } else { 'compte désactivé' } } })
                    })
                    if ($cibles.Count -eq 0) { Show-Note "Rien ne correspond dans l'Active Directory." -Niveau Alerte; continue }
                    $cible = Read-Choix -Titre "Vers quel destinataire ? ($($cibles.Count) trouvé$(if ($cibles.Count -gt 1) { 's' }))" -Elements $cibles -Colonnes Type, Nom, Adresse, Detail, Etat `
                        -DefautIndice (Get-IndiceDe -Elements $cibles -Ou { $_.Adresse -eq $dossier.RedirectionVers })
                    if (-not $cible.Actif -and -not (Confirm-Choix -Question 'Ce compte est désactivé — rediriger quand même vers lui ?')) { $cible = $null }
                } while (-not $cible)
                $dossier.Redirection = 'activer'; $dossier.RedirectionVers = $cible.Adresse; $dossier.RedirectionVersNom = $cible.Nom
                Show-Constat -Titre 'Les mails seront redirigés' -Valeurs @($cible.Nom, $cible.Adresse)
                Add-Resume -Cle 'Redirection' -Valeur $cible.Adresse
            } elseif ($r.Code -eq 'desactiver') {
                $dossier.Redirection = 'desactiver'; $dossier.RedirectionVers = ''; $dossier.RedirectionVersNom = ''
                Add-Resume -Cle 'Redirection' -Valeur 'désactivée'
            } else {
                $dossier.Redirection = 'aucune'; $dossier.RedirectionVers = ''; $dossier.RedirectionVersNom = ''
                Remove-Resume -Cle 'Redirection'
            }
        } },

        @{ Nom = 'Réponse automatique'; Resume = { switch ($dossier.ReponseAuto) { 'activer' { $(if ($dossier.ReponseAutoModele -eq 'personnalise') { 'texte personnalisé' } else { "modèle $($dossier.ReponseAutoModele)" }) } 'desactiver' { 'désactivée' } default { 'inchangée' } } }; Action = {
            # --- Réponse automatique : un modèle, ou un texte tapé / collé ; aperçu avant de retenir.
            do {
                $decide = $true
                $a = Read-Choix -Titre 'Réponse automatique ?' -Elements $optionsReponse -Colonnes Texte `
                    -DefautIndice (Get-IndiceDe -Elements $optionsReponse -Ou {
                        ($dossier.ReponseAuto -eq 'activer' -and $_.Code -eq 'modele' -and $_.Modele.id -eq $dossier.ReponseAutoModele) -or
                        ($dossier.ReponseAuto -eq 'activer' -and $_.Code -eq 'libre' -and $dossier.ReponseAutoModele -eq 'personnalise') -or
                        ($dossier.ReponseAuto -ne 'activer' -and $_.Code -eq $dossier.ReponseAuto) })
                $texte = ''
                switch ($a.Code) {
                    'modele'     { $texte = Resolve-Modele -Modele $a.Modele }
                    'libre'      { $texte = Read-TexteMultiligne -Invite 'Message de réponse automatique' }
                    'desactiver' { $dossier.ReponseAuto = 'desactiver'; $dossier.ReponseAutoTexte = ''; $dossier.ReponseAutoModele = ''; Add-Resume -Cle 'Réponse auto' -Valeur 'désactivée' }
                    'aucune'     { $dossier.ReponseAuto = 'aucune'; $dossier.ReponseAutoTexte = ''; $dossier.ReponseAutoModele = ''; Remove-Resume -Cle 'Réponse auto' }
                }
                if ($a.Code -eq 'modele' -or $a.Code -eq 'libre') {
                    if (-not $texte.Trim()) { Show-Note 'Texte vide.' -Niveau Alerte; $decide = $false; continue }
                    Show-Panneau -Texte $texte -Titre 'Aperçu de la réponse automatique'
                    if (Confirm-Choix -Question 'Retenir ce texte ?' -DefautOui) {
                        $dossier.ReponseAuto = 'activer'; $dossier.ReponseAutoTexte = $texte.Trim()
                        $dossier.ReponseAutoModele = if ($a.Modele) { $a.Modele.id } else { 'personnalise' }
                        Add-Resume -Cle 'Réponse auto' -Valeur $(if ($a.Modele) { $a.Modele.nom } else { 'texte personnalisé' })
                    } else { $decide = $false }
                }
            } while (-not $decide)
        } },

        @{ Nom = 'Cache des délégations'; Resume = { if ($dossier.ForcerCache) { 'reconstruit' } else { 'réutilisé' } }; Action = {
            if ($Reglages.ScanDelegations) { $dossier.ForcerCache = Confirm-Choix -Question 'Reconstruire le cache des redirections et délégations (long, toutes les boîtes) ?' -DefautOui:([bool]$dossier.ForcerCache) }
        } },

        @{ Etape = 'Connexions'; Nom = 'Connexions et lecture du 3CX'; Action = { Connect-Services; Read-Poste3CX } },

        @{ Nom = 'Poste 3CX'; Resume = { if ($dossier.Poste3CX) { "$($dossier.Poste3CX.Number) $(if ($dossier.SupprimerPoste) { 'supprimé' } else { 'libéré' })$(if ($dossier.FileSda) { " · file $($dossier.FileSda.Number)" })" } }; Action = {
            if (-not $dossier.Poste3CX) { return }
            # Supprimer, ou libérer : le numéro reste alors réservé à son équipe, sous le nom « Libre <file> ».
            $dossier.SupprimerPoste = Confirm-Choix -Question "Supprimer le poste 3CX $($dossier.Poste3CX.Number) ? (Non : il reste, désactivé, nommé « Libre <file> »)" -DefautOui:([bool]$dossier.SupprimerPoste)
            # La file nomme le poste libéré ; si le poste est supprimé, elle reçoit ses numéros directs.
            $besoin = (-not $dossier.SupprimerPoste) -or ($dossier.Sda3CX.Count -gt 0)
            if (-not $besoin) { $dossier.FileSda = $null; Remove-Resume -Cle 'File' }
            elseif ($dossier.Files3CX.Count -eq 1) {
                $dossier.FileSda = $dossier.Files3CX[0]
                Show-Constat -Titre "File d'attente de $($dossier.Nom)" -Valeurs @((Get-NomFile $dossier.FileSda)) -Niveau Info
            } else {
                $pourquoi = if ($dossier.Files3CX.Count -eq 0) { "le poste n'est dans aucune file" } else { "le poste est dans $($dossier.Files3CX.Count) files" }
                $vue = @(Get-VueFiles -Files $dossier.ToutesFiles3CX)
                $dossier.FileSda = Read-Choix -Titre "Quelle file $(if ($dossier.SupprimerPoste) { 'reçoit ses numéros directs' } else { 'nomme le poste libéré' }) ? ($pourquoi)" `
                    -Aide "tapez un numéro, un nom de file ou celui d'un collègue — Entrée pour retenir" `
                    -Elements $vue -Colonnes Number, Name, Equipe -MotsCles { $_.Equipe } `
                    -DefautIndice (Get-IndiceDe -Elements $vue -Ou { $dossier.FileSda -and $_.Id -eq $dossier.FileSda.Id })
            }
            if ($dossier.FileSda) { Add-Resume -Cle 'File' -Valeur "$($dossier.FileSda.Number)" }
            Add-Resume -Cle 'Poste' -Valeur "$($dossier.Poste3CX.Number) $(if ($dossier.SupprimerPoste) { 'supprimé' } else { 'libéré' })"
        } },

        @{ Etape = 'Confirmation'; Nom = 'Récapitulatif'; Action = {
            Show-Recap -Paires (Get-Recap) -Titre 'Récapitulatif avant exécution'
            if (Confirm-Choix -Question $(if ($Reglages.Simulation) { 'Lancer la simulation ?' } else { 'Confirmer et EXÉCUTER ?' })) { return }
            Read-SectionAModifier
        } }
    )
    Invoke-Parcours -Sections $sections
}
$soc = $dossier.Societe; $u = $dossier.Utilisateur
$recap = Get-Recap

# ============================================================ 5. EXÉCUTION
Set-Etape 'Exécution'
Start-Flux
$sam = $dossier.Sam; $upn = $dossier.Upn
$m365 = [bool]$soc.tenantId

try {
    Invoke-Etape -Nom 'Compte AD désactivé' -Categorie AD -Critique -Action {
        Invoke-Ecriture -Categorie AD -Description "Désactiver le compte $sam" -Action { Disable-ADAccount -Identity $sam @ad } | Out-Null
    } | Out-Null

    Invoke-Etape -Nom 'Champs AD vidés (fonction, service, société, responsable, téléphones)' -Categorie AD -Action {
        $avant = Get-ADUser -Identity $sam -Properties Title, Department, Company, Manager, TelephoneNumber, Mobile @ad
        $valeurs = [ordered]@{
            fonction = "$($avant.Title)"; service = "$($avant.Department)"; société = "$($avant.Company)"
            responsable = "$($avant.Manager -replace '^CN=([^,]+).*', '$1')"; fixe = "$($avant.TelephoneNumber)"; mobile = "$($avant.Mobile)"
        }
        $remplis = @($valeurs.Keys | Where-Object { $valeurs[$_] } | ForEach-Object { "$_ $($valeurs[$_])" })
        Add-Journal -Message $(if ($remplis.Count) { "Avant : $($remplis -join ' · ')" } else { 'Les champs étaient déjà vides.' }) -Categorie AD
        Invoke-Ecriture -Categorie AD -Description 'Vider fonction, service, société, responsable et téléphones' -Action {
            Set-ADUser -Identity $sam -Clear Title, Department, Company, Manager, TelephoneNumber, Mobile @ad
        } | Out-Null
    } | Out-Null

    Invoke-Etape -Nom "Masqué de l'annuaire Exchange" -Categorie AD -Action {
        Invoke-Ecriture -Categorie AD -Description "Masquer $sam de l'annuaire Exchange" -Action {
            Set-ADUser -Identity $sam -Replace @{ msExchHideFromAddressLists = $true } @ad
        } | Out-Null
    } | Out-Null

    Invoke-Etape -Nom 'Groupes AD retirés' -Categorie Groupes -Action {
        $conserves = @($config.sortie.groupesConserves)
        $dns = @((Get-ADUser -Identity $sam -Properties MemberOf @ad).MemberOf)
        $retires = @(); $gardes = @()
        foreach ($dn in $dns) {
            $nom = $dn -replace '^CN=([^,]+).*', '$1'
            try { $membres = @(Get-ADGroupMember -Identity $dn @ad); if ($membres.Count -eq 1 -and $membres[0].SamAccountName -eq $sam) { Add-Journal -Message "$sam était le DERNIER membre de $nom." -Categorie Groupes -Niveau Alerte } } catch { }
            if (@($conserves | Where-Object { $nom -like $_ }).Count -gt 0) { $gardes += $nom; continue }
            Invoke-Ecriture -SansJournal -Categorie Groupes -Description "Retirer de $nom" -Action { Remove-ADGroupMember -Identity $dn -Members $sam -Confirm:$false @ad } | Out-Null
            $retires += $nom
        }
        # Le bilan en trois lignes : le compte, les retirés, les conservés.
        if (Test-Simulation) { Add-Journal -Message "SIMULATION : retirer $($retires.Count) groupe(s), en conserver $($gardes.Count)" -Categorie Groupes -Niveau Simule }
        else { Add-Journal -Message "$($retires.Count) groupe(s) retiré(s), $($gardes.Count) conservé(s)." -Categorie Groupes -Niveau Succes }
        if ($retires.Count) { Add-Journal -Message "$(if (Test-Simulation) { 'À retirer' } else { 'Retirés' }) : $($retires -join '; ')" -Categorie Groupes }
        if ($gardes.Count)  { Add-Journal -Message "Conservés : $($gardes -join '; ')" -Categorie Groupes -Niveau Alerte }
    } | Out-Null

    Invoke-Etape -Nom "Déplacé dans l'OU des désactivés" -Categorie AD -Ignorer:(-not $soc.ouDesactives) -Action {
        $obj = Get-ADUser -Identity $sam @ad
        Invoke-Ecriture -Categorie AD -Description "Déplacer dans $($soc.ouDesactives)" -Action {
            Move-ADObject -Identity $obj.DistinguishedName -TargetPath $soc.ouDesactives @ad
            Add-Journal -Message "Dans $($soc.ouDesactives)." -Categorie AD
        } | Out-Null
    } | Out-Null

    Invoke-Etape -Nom 'Boîte convertie en boîte partagée' -Categorie Exchange -Ignorer:(-not $m365) -Action {
        $boite = Get-Mailbox -Identity $upn -ErrorAction SilentlyContinue
        if (-not $boite) { Add-Journal -Message "Pas de boîte Exchange Online pour $upn." -Categorie Exchange -Niveau Alerte; return }
        if ("$($boite.RecipientTypeDetails)" -eq 'SharedMailbox') { Add-Journal -Message "La boîte $upn est déjà partagée." -Categorie Exchange -Niveau Alerte; return }
        Invoke-Ecriture -Categorie Exchange -Description 'Convertir la boîte en boîte partagée' -Action { Set-Mailbox -Identity $upn -Type Shared } | Out-Null
    } | Out-Null

    Invoke-Etape -Nom 'Redirection des mails' -Categorie Exchange -Ignorer:(-not $m365 -or $dossier.Redirection -eq 'aucune') -Action {
        if ($dossier.Redirection -eq 'activer') {
            if (-not (Get-Recipient -Identity $dossier.RedirectionVers -ErrorAction SilentlyContinue)) { throw "Cible de redirection inconnue d'Exchange Online : $($dossier.RedirectionVers)" }
            Invoke-Ecriture -Categorie Exchange -Description "Rediriger vers $($dossier.RedirectionVersNom) <$($dossier.RedirectionVers)>, copie conservée" -Action {
                Set-Mailbox -Identity $upn -ForwardingAddress $dossier.RedirectionVers -DeliverToMailboxAndForward $true
                Add-Journal -Message "Vers $($dossier.RedirectionVersNom) <$($dossier.RedirectionVers)>, copie conservée." -Categorie Exchange -Niveau Succes
            } | Out-Null
        } else {
            Invoke-Ecriture -Categorie Exchange -Description 'Retirer la redirection existante' -Action { Set-Mailbox -Identity $upn -ForwardingAddress $null } | Out-Null
        }
    } | Out-Null

    Invoke-Etape -Nom 'Réponse automatique' -Categorie Exchange -Ignorer:(-not $m365 -or $dossier.ReponseAuto -eq 'aucune') -Action {
        if ($dossier.ReponseAuto -eq 'activer') {
            $htmlAuto = "<div style='font-family:Montserrat,sans-serif;font-size:10pt'>$(([Net.WebUtility]::HtmlEncode($dossier.ReponseAutoTexte)) -replace "`r?`n", '<br>')</div>"
            $apercu = ($dossier.ReponseAutoTexte -replace "`r?`n", ' ')
            if ($apercu.Length -gt 90) { $apercu = $apercu.Substring(0, 89) + '…' }
            $origine = if ($dossier.ReponseAutoModele -eq 'personnalise') { 'texte personnalisé' } else { "modèle $($dossier.ReponseAutoModele)" }
            Invoke-Ecriture -Categorie Exchange -Description "Activer la réponse automatique ($origine) : « $apercu »" -Action {
                Set-MailboxAutoReplyConfiguration -Identity $upn -AutoReplyState Enabled -InternalMessage $htmlAuto -ExternalMessage $htmlAuto
                Add-Journal -Message "Activée ($origine), le texte est plus haut dans ce rapport." -Categorie Exchange -Niveau Succes
            } | Out-Null
        } else {
            Invoke-Ecriture -Categorie Exchange -Description 'Désactiver la réponse automatique' -Action { Set-MailboxAutoReplyConfiguration -Identity $upn -AutoReplyState Disabled } | Out-Null
        }
    } | Out-Null

    Invoke-Etape -Nom 'Licences Microsoft 365 retirées (sauf conservées)' -Categorie Licences -Ignorer:(-not $m365) -Action { Remove-LicencesM365 -Upn $upn } | Out-Null

    Invoke-Etape -Nom 'Redirections et délégations vers ce compte' -Categorie Delegations -Ignorer:(-not $m365 -or -not $Reglages.ScanDelegations) -Action {
        Invoke-ScanDelegations -Cible $upn -Societe $soc.id -ForcerCache $dossier.ForcerCache
    } | Out-Null

    # Les numéros directs prennent le nom de la personne qui part, daté du jour.
    # Ils ne vont à l'équipe QUE si le poste est supprimé ; s'il reste, ils
    # gardent leur destination (décision du 10.09.2026).
    $nomEx = "ex $($dossier.Prenom) $($dossier.NomFamille) ($(Get-Date -Format 'dd.MM.yyyy'))" -replace '\s+', ' '
    $nomEtapeSda = if (-not $dossier.SupprimerPoste) { 'Numéros directs renommés, destination inchangée' }
                   elseif ($dossier.FileSda) { "Numéros directs redirigés vers la $(Get-NomFile $dossier.FileSda)" } else { 'Numéros directs' }
    Invoke-Etape -Nom $nomEtapeSda -Categorie 3CX -Ignorer:(-not $dossier.Poste3CX -or $dossier.Sda3CX.Count -eq 0) -Action {
        if ($dossier.SupprimerPoste -and -not $dossier.FileSda) {
            Add-Journal -Message "$($dossier.Sda3CX.Count) règle(s) entrante(s) visent le poste $($dossier.Poste3CX.Number) et aucune file n'a été désignée : à rerouter à la main." -Categorie 3CX -Niveau Alerte
            foreach ($s in $dossier.Sda3CX) { Add-Journal -Message "  $($s.RuleName) — SDA $($s.Data)  (règle $(Get-Prop -Objet $s -Nom 'Id' -Defaut '?'))" -Categorie 3CX -Niveau Alerte }
            return
        }
        $fileCible = $(if ($dossier.FileSda) { $dossier.FileSda } else { [pscustomobject]@{ Number = ''; Name = '' } })
        Set-XapiReglesVersFile -Pbx $pbx -Regles $dossier.Sda3CX -File $fileCible -NomRegle $nomEx -SansRediriger:(-not $dossier.SupprimerPoste)
    } | Out-Null

    Invoke-Etape -Nom 'Poste 3CX retiré de ses files' -Categorie 3CX -Ignorer:(-not $dossier.Poste3CX -or $dossier.Files3CX.Count -eq 0) -Action {
        Remove-XapiPosteDesFiles -Pbx $pbx -Numero "$($dossier.Poste3CX.Number)" | Out-Null
    } | Out-Null

    Invoke-Etape -Nom $(if ($dossier.SupprimerPoste) { "Poste 3CX $($dossier.Poste3CX.Number) supprimé" } else { "Poste 3CX $($dossier.Poste3CX.Number) libéré pour son équipe" }) `
                 -Categorie 3CX -Ignorer:(-not $dossier.Poste3CX) -Action {
        $num = "$($dossier.Poste3CX.Number)"
        if ($dossier.SupprimerPoste) {
            Remove-XapiPoste -Pbx $pbx -Id ([int]$dossier.Poste3CX.Id) -Numero $num
        } else {
            # Le PBX compose le nom affiché à partir du nom et du prénom : « Libre <file> » tient dans le nom, prénom vide.
            $libre = "Libre $(if ($dossier.FileSda) { $dossier.FileSda.Name } else { '' })".Trim()
            Set-XapiPoste -Pbx $pbx -Id ([int]$dossier.Poste3CX.Id) -Numero $num -Proprietes @{ FirstName = ''; LastName = $libre; EmailAddress = ''; Enabled = $false } `
                -Libelle "Libérer le poste $num : nommé « $libre », désactivé, e-mail vidé — le numéro reste réservé à l'équipe"
            if (-not (Test-Simulation3CX)) { Add-Journal -Message "Poste $num nommé « $libre », désactivé, e-mail vidé — le numéro reste réservé à l'équipe." -Categorie 3CX -Niveau Succes }
        }
    } | Out-Null

    Invoke-Etape -Nom 'Tâche Planner (suivi à 180 jours)' -Categorie Planner -Ignorer:(-not $Reglages.CreerTachePlanner) -Action {
        Add-TachePlanner -Titre "Désactivation de l'utilisateur $($dossier.Nom) - $($soc.id)" -Description "L'utilisateur $($dossier.Nom) ($upn) a été désactivé. Vérifier les redirections et les délégations." -Bureau $dossier.Bureau
    } | Out-Null
} catch {
    Show-Note "Exécution interrompue : $(Get-MessageErreur $_)" -Niveau Erreur
    Add-Journal -Message "Exécution interrompue : $(Get-MessageErreur $_)" -Niveau Erreur
}

# ============================================================== 6. RAPPORT
$pourLeMail = [ordered]@{}
foreach ($k in $recap.Keys) { if ($k -ne 'Mode') { $pourLeMail[$k] = $recap[$k] } }   # le mode a déjà son bandeau
$corps  = New-BlocPaires -Titre 'Le dossier' -Paires $pourLeMail
if ($dossier.ReponseAuto -eq 'activer') { $corps += New-BlocTexte -Titre 'Message de réponse automatique' -Texte $dossier.ReponseAutoTexte }
$html = ConvertTo-RapportHtml -Mot 'Sortie' -Nom $dossier.Nom -Corps $corps
Invoke-Etape -Nom 'Rapport envoyé au helpdesk' -Categorie General -Action { Send-Rapport -Sujet "Rapport de désactivation - $($dossier.Nom)" -Html $html } | Out-Null
$donnees = [ordered]@{}; foreach ($k in $dossier.Keys) { if ($k -ne 'Utilisateur') { $donnees[$k] = $dossier[$k] } }
Save-Rapport -Nom "sortie-$sam" -Html $html -Donnees $donnees | Out-Null

Disconnect-M365
Complete-Session
