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
    [switch] $SansScanDelegations
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
    EnvoyerMail        = $true
    Gerer3CX           = $true
    CreerTachePlanner  = $true
    ScanDelegations    = $true
    DossierLogs        = ''
}
if ($ModeTest)            { $Reglages.ModeTest = $true }
if ($Simulation)          { $Reglages.Simulation = $true }
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
    Poste3CX = $null; Files3CX = @(); Sda3CX = @()
}
$proprietesAd = @('DisplayName', 'GivenName', 'Surname', 'Title', 'Department', 'Office', 'UserPrincipalName', 'Enabled', 'DistinguishedName', 'mail')

Set-Etape 'Le collaborateur'
if ($Job) {
    $j = Get-Content -Path $Job -Raw -Encoding UTF8 | ConvertFrom-Json
    $dossier.Societe = Get-Societe -Id $j.societe
    $dossier.Sam = "$(Get-Prop -Objet $j -Nom 'identifiant' -Defaut '')"
    if (-not $dossier.Sam) { throw "Le fichier de travail ne donne pas d'identifiant." }
    $ad = Connect-Domaine -Societe $dossier.Societe
    $dossier.Utilisateur = Get-ADUser -Identity $dossier.Sam -Properties $proprietesAd @ad
    $vers = Get-Prop -Objet $j -Nom 'redirectionVers'
    if ($vers) {
        $dossier.Redirection = 'activer'; $dossier.RedirectionVers = "$vers"
        $dossier.RedirectionVersNom = "$(Get-Prop -Objet $j -Nom 'redirectionVersNom' -Defaut $vers)"
    } elseif ((Get-Prop -Objet $j -Nom 'redirection') -eq 'desactiver') { $dossier.Redirection = 'desactiver' }
} else {
    $dossier.Societe = Read-Choix -Titre 'Quelle société ?' -Elements @($config.societes) -Colonnes nom, domaineMail
    Add-Resume -Cle 'Société' -Valeur $dossier.Societe.id
    $ad = Connect-Domaine -Societe $dossier.Societe
    do {
        $recherche = Read-Texte -Invite 'Qui part ?' -Aide 'nom, prénom, identifiant ou e-mail — q pour quitter' -Obligatoire -QuitteSurQ
        $trouves = @(Invoke-Attente -Titre "Recherche de « $recherche » dans l'Active Directory" -Action {
            @(Find-AdUtilisateur -Recherche $recherche -Ad $ad | Select-Object *, @{ n = 'Etat'; e = { if ($_.Enabled) { '' } else { 'déjà désactivé' } } })
        })
        if ($trouves.Count -eq 0) { Show-Note 'Aucun compte ne correspond.' -Niveau Alerte }
    } while ($trouves.Count -eq 0)
    $choix = Read-Choix -Titre "Quel compte ? ($($trouves.Count) trouvé$(if ($trouves.Count -gt 1) { 's' }))" -Elements $trouves -Colonnes Name, SamAccountName, Title, Department, Etat
    $dossier.Utilisateur = Get-ADUser -Identity $choix.SamAccountName -Properties $proprietesAd @ad
}
$soc = $dossier.Societe
$u = $dossier.Utilisateur
$dossier.Sam = $u.SamAccountName; $dossier.Upn = $u.UserPrincipalName; $dossier.Nom = $u.Name; $dossier.Bureau = "$($u.Office)"
$dossier.Prenom = "$($u.GivenName)"; $dossier.NomFamille = "$($u.Surname)"
if (-not $Job) {
    Add-Resume -Cle 'Qui part' -Valeur "$($dossier.Nom) · $($dossier.Sam)"
    Show-Constat -Titre 'Compte retenu' -Valeurs @($dossier.Nom, $dossier.Sam, $dossier.Upn)
}
if (-not $u.Enabled) { Add-Journal -Message "Le compte $($u.SamAccountName) est DÉJÀ désactivé — le script reprend là où il en est." -Categorie AD -Niveau Alerte }

# Les variables que les modèles de réponse automatique peuvent utiliser.
function Get-VariablesReponse {
    return @{
        Prenom = $dossier.Prenom; Nom = $dossier.NomFamille; NomComplet = $dossier.Nom
        Societe = $soc.nom; Date = (Get-Date -Format 'dd.MM.yyyy')
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

# ============================================================ 2. MESSAGERIE
if ($Job) {
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
} else {
    Set-Etape 'Messagerie'

    # --- Redirection : vers un utilisateur ou une liste, choisi dans une recherche.
    $optionsRedirection = @(
        [pscustomobject]@{ Code = 'activer';    Texte = "Rediriger les mails vers un collaborateur ou une liste" },
        [pscustomobject]@{ Code = 'desactiver'; Texte = 'Désactiver la redirection existante' },
        [pscustomobject]@{ Code = 'aucune';     Texte = 'Ne rien changer à la redirection' }
    )
    $r = Read-Choix -Titre "Redirection des mails de $($dossier.Upn) ?" -Elements $optionsRedirection -Colonnes Texte -SansAnnulation
    if ($r.Code -eq 'activer') {
        do {
            $recherche = Read-Texte -Invite 'Vers qui ?' -Aide 'nom, prénom, identifiant, adresse ou nom de liste' -Obligatoire -QuitteSurQ
            $cibles = @(Invoke-Attente -Titre "Recherche de « $recherche »" -Action {
                @(Find-AdDestinataire -Recherche $recherche -Ad $ad | Select-Object *, @{ n = 'Etat'; e = { if ($_.Actif) { '' } else { 'compte désactivé' } } })
            })
            if ($cibles.Count -eq 0) { Show-Note "Rien ne correspond dans l'Active Directory." -Niveau Alerte; continue }
            $cible = Read-Choix -Titre "Vers quel destinataire ? ($($cibles.Count) trouvé$(if ($cibles.Count -gt 1) { 's' }))" -Elements $cibles -Colonnes Type, Nom, Adresse, Detail, Etat
            if (-not $cible.Actif -and -not (Confirm-Choix -Question 'Ce compte est désactivé — rediriger quand même vers lui ?')) { $cible = $null }
        } while (-not $cible)
        $dossier.Redirection = 'activer'; $dossier.RedirectionVers = $cible.Adresse; $dossier.RedirectionVersNom = $cible.Nom
        Show-Constat -Titre 'Les mails seront redirigés' -Valeurs @($cible.Nom, $cible.Adresse)
        Add-Resume -Cle 'Redirection' -Valeur $cible.Adresse
    } elseif ($r.Code -eq 'desactiver') {
        $dossier.Redirection = 'desactiver'
        Add-Resume -Cle 'Redirection' -Valeur 'désactivée'
    }

    # --- Réponse automatique : un modèle, ou un texte tapé / collé ; aperçu avant de retenir.
    $modeles = @(Get-Prop -Objet (Get-Prop -Objet $config.sortie -Nom 'reponsesAutomatiques') -Nom 'modeles' -Defaut @())
    $optionsReponse = @()
    foreach ($m in $modeles) { $optionsReponse += [pscustomobject]@{ Code = 'modele'; Modele = $m; Texte = "Modèle — $($m.nom)" } }
    $optionsReponse += [pscustomobject]@{ Code = 'libre';      Modele = $null; Texte = 'Texte personnalisé — à taper ou à coller' }
    $optionsReponse += [pscustomobject]@{ Code = 'desactiver'; Modele = $null; Texte = 'Désactiver la réponse automatique existante' }
    $optionsReponse += [pscustomobject]@{ Code = 'aucune';     Modele = $null; Texte = 'Ne rien changer à la réponse automatique' }
    do {
        $decide = $true
        $a = Read-Choix -Titre 'Réponse automatique ?' -Elements $optionsReponse -Colonnes Texte -SansAnnulation
        $texte = ''
        switch ($a.Code) {
            'modele'     { $texte = Resolve-Modele -Modele $a.Modele }
            'libre'      { $texte = Read-TexteMultiligne -Invite 'Message de réponse automatique' }
            'desactiver' { $dossier.ReponseAuto = 'desactiver'; Add-Resume -Cle 'Réponse auto' -Valeur 'désactivée' }
            'aucune'     { $dossier.ReponseAuto = 'aucune' }
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

    if ($Reglages.ScanDelegations) { $dossier.ForcerCache = Confirm-Choix -Question 'Reconstruire le cache des redirections et délégations (long, toutes les boîtes) ?' }
}

# =========================================== 3. CONNEXIONS ET LECTURE 3CX
Set-Etape 'Connexions'
if ($soc.tenantId) { Connect-M365 -Societe $soc } else { Add-Journal -Message "Pas de tenant Microsoft 365 pour $($soc.id) : étapes Exchange, licences et délégations ignorées." -Niveau Alerte }
$pbx = if ($Reglages.Gerer3CX) { Get-Pbx -Societe $soc } else { $null }
if ($pbx) {
    $lecture = Invoke-Attente -Titre "Lecture du 3CX ($($pbx.adresse))" -Action {
        $postes = @(Find-XapiUtilisateurParEmail -Pbx $pbx -Email $dossier.Upn)
        if ($postes.Count -eq 0) { Add-Journal -Message "Aucun poste 3CX ne porte l'adresse $($dossier.Upn)." -Categorie 3CX -Niveau Alerte; return $null }
        $poste = $postes[0]
        return @{
            Poste = $poste
            Files = @(Get-XapiFilesDuPoste -Pbx $pbx -Numero "$($poste.Number)")
            Sda   = @(Get-XapiSdaVersPoste -Pbx $pbx -Numero "$($poste.Number)")
        }
    }
    if ($lecture) {
        $dossier.Poste3CX = $lecture.Poste; $dossier.Files3CX = @($lecture.Files); $dossier.Sda3CX = @($lecture.Sda)
        Show-Constat -Titre "Poste 3CX trouvé — $($dossier.Files3CX.Count) file(s) d'attente, $($dossier.Sda3CX.Count) règle(s) entrante(s)" `
                     -Valeurs @("poste $($dossier.Poste3CX.Number)", "$($dossier.Poste3CX.DisplayName)")
        if (-not $Job) { Add-Resume -Cle 'Poste' -Valeur "$($dossier.Poste3CX.Number)" }
    }
}

# ====================================================== 4. RÉCAPITULATIF
Set-Etape 'Confirmation'
$texteRedirection = switch ($dossier.Redirection) { 'activer' { "vers $($dossier.RedirectionVersNom) <$($dossier.RedirectionVers)>" } 'desactiver' { 'désactivée' } default { 'inchangée' } }
$texteReponse = switch ($dossier.ReponseAuto) { 'activer' { "activée ($(if ($dossier.ReponseAutoModele -eq 'personnalise') { 'texte personnalisé' } else { "modèle $($dossier.ReponseAutoModele)" }))" } 'desactiver' { 'désactivée' } default { 'inchangée' } }
$recap = [ordered]@{
    'Société'             = $soc.nom
    'Compte'              = "$($dossier.Nom)  ($($dossier.Sam))  —  $($dossier.Upn)"
    'Bureau'              = $(if ($dossier.Bureau) { $dossier.Bureau } else { '—' })
    'Redirection'         = $texteRedirection
    'Réponse automatique' = $texteReponse
    'OU de destination'   = $(if ($soc.ouDesactives) { $soc.ouDesactives } else { 'AUCUNE (pas de déplacement)' })
    'Microsoft 365'       = $(if ($soc.tenantId) { 'boîte partagée, licences, délégations' } else { 'pas de tenant : ignoré' })
    'Poste 3CX'           = $(if ($dossier.Poste3CX) { "$($dossier.Poste3CX.Number) « $($dossier.Poste3CX.DisplayName) » — $($dossier.Files3CX.Count) file(s), $($dossier.Sda3CX.Count) SDA" } elseif ($pbx) { 'aucun trouvé' } else { 'pas de PBX / désactivé' })
    'Mode'                = $(if ($Reglages.Simulation) { 'SIMULATION — rien ne sera écrit' } else { 'RÉEL — les actions seront faites' })
}
Show-Recap -Paires $recap -Titre 'Récapitulatif avant exécution'
if (-not $Job -and -not (Confirm-Choix -Question $(if ($Reglages.Simulation) { 'Lancer la simulation ?' } else { 'Confirmer et EXÉCUTER ?' }))) { Stop-Script }

# ============================================================ 5. EXÉCUTION
Set-Etape 'Exécution'
Start-Flux
$sam = $dossier.Sam; $upn = $dossier.Upn
$m365 = [bool]$soc.tenantId

try {
    Invoke-Etape -Nom 'Compte AD désactivé' -Categorie AD -Critique -Action {
        Invoke-Ecriture -Categorie AD -Description "Disable-ADAccount $sam" -Action {
            Disable-ADAccount -Identity $sam @ad
            Add-Journal -Message "Compte $sam désactivé." -Categorie AD -Niveau Succes
        } | Out-Null
    } | Out-Null

    Invoke-Etape -Nom 'Champs AD vidés (fonction, service, société, responsable, téléphones)' -Categorie AD -Action {
        $avant = Get-ADUser -Identity $sam -Properties Title, Department, Company, Manager, TelephoneNumber, Mobile @ad
        Add-Journal -Message "Avant : fonction « $($avant.Title) », service « $($avant.Department) », société « $($avant.Company) », responsable « $($avant.Manager -replace '^CN=([^,]+).*', '$1') », fixe « $($avant.TelephoneNumber) », mobile « $($avant.Mobile) »" -Categorie AD
        Invoke-Ecriture -Categorie AD -Description "Set-ADUser $sam -Clear Title, Department, Company, Manager, TelephoneNumber, Mobile" -Action {
            Set-ADUser -Identity $sam -Clear Title, Department, Company, Manager, TelephoneNumber, Mobile @ad
            Add-Journal -Message 'Champs vidés.' -Categorie AD -Niveau Succes
        } | Out-Null
    } | Out-Null

    Invoke-Etape -Nom "Masqué de l'annuaire Exchange" -Categorie AD -Action {
        Invoke-Ecriture -Categorie AD -Description "Set-ADUser $sam -Replace msExchHideFromAddressLists = true" -Action {
            Set-ADUser -Identity $sam -Replace @{ msExchHideFromAddressLists = $true } @ad
            Add-Journal -Message 'msExchHideFromAddressLists posé.' -Categorie AD -Niveau Succes
        } | Out-Null
    } | Out-Null

    Invoke-Etape -Nom 'Groupes AD retirés' -Categorie Groupes -Action {
        $conserves = @($config.sortie.groupesConserves)
        $dns = @((Get-ADUser -Identity $sam -Properties MemberOf @ad).MemberOf)
        $retires = @(); $gardes = @()
        foreach ($dn in $dns) {
            $nom = $dn -replace '^CN=([^,]+).*', '$1'
            try { $membres = @(Get-ADGroupMember -Identity $dn @ad); if ($membres.Count -eq 1 -and $membres[0].SamAccountName -eq $sam) { Add-Journal -Message "ATTENTION : $sam est le DERNIER membre de $nom." -Categorie Groupes -Niveau Alerte } } catch { }
            if (@($conserves | Where-Object { $nom -like $_ }).Count -gt 0) { $gardes += $nom; continue }
            if (Test-Simulation) { $retires += $nom; continue }
            Invoke-Ecriture -Categorie Groupes -Description "Remove-ADGroupMember $nom -Members $sam" -Action { Remove-ADGroupMember -Identity $dn -Members $sam -Confirm:$false @ad } | Out-Null
            $retires += $nom
        }
        if (Test-Simulation) { Add-Journal -Message "SIMULATION : retrait de $($retires.Count) groupe(s) — $($retires -join ', ')" -Categorie Groupes -Niveau Simule }
        else { Add-Journal -Message "Groupes retirés ($($retires.Count)) : $($retires -join ', ')" -Categorie Groupes -Niveau Succes }
        if ($gardes.Count) { Add-Journal -Message "Groupes conservés ($($gardes.Count)) : $($gardes -join ', ')" -Categorie Groupes -Niveau Alerte }
    } | Out-Null

    Invoke-Etape -Nom "Déplacé dans l'OU des désactivés" -Categorie AD -Ignorer:(-not $soc.ouDesactives) -Action {
        $obj = Get-ADUser -Identity $sam @ad
        Invoke-Ecriture -Categorie AD -Description "Move-ADObject $($obj.DistinguishedName) → $($soc.ouDesactives)" -Action {
            Move-ADObject -Identity $obj.DistinguishedName -TargetPath $soc.ouDesactives @ad
            Add-Journal -Message "Déplacé dans $($soc.ouDesactives)." -Categorie AD -Niveau Succes
        } | Out-Null
    } | Out-Null

    Invoke-Etape -Nom 'Boîte convertie en boîte partagée' -Categorie Exchange -Ignorer:(-not $m365) -Action {
        $boite = Get-Mailbox -Identity $upn -ErrorAction SilentlyContinue
        if (-not $boite) { Add-Journal -Message "Pas de boîte Exchange Online pour $upn." -Categorie Exchange -Niveau Alerte; return }
        if ("$($boite.RecipientTypeDetails)" -eq 'SharedMailbox') { Add-Journal -Message "La boîte $upn est déjà partagée." -Categorie Exchange -Niveau Alerte; return }
        Invoke-Ecriture -Categorie Exchange -Description "Set-Mailbox $upn -Type Shared" -Action {
            Set-Mailbox -Identity $upn -Type Shared
            Add-Journal -Message "Boîte $upn convertie en boîte partagée." -Categorie Exchange -Niveau Succes
        } | Out-Null
    } | Out-Null

    Invoke-Etape -Nom 'Redirection des mails' -Categorie Exchange -Ignorer:(-not $m365 -or $dossier.Redirection -eq 'aucune') -Action {
        if ($dossier.Redirection -eq 'activer') {
            if (-not (Get-Recipient -Identity $dossier.RedirectionVers -ErrorAction SilentlyContinue)) { throw "Cible de redirection inconnue d'Exchange Online : $($dossier.RedirectionVers)" }
            Invoke-Ecriture -Categorie Exchange -Description "Set-Mailbox $upn -ForwardingAddress $($dossier.RedirectionVers) -DeliverToMailboxAndForward true" -Action {
                Set-Mailbox -Identity $upn -ForwardingAddress $dossier.RedirectionVers -DeliverToMailboxAndForward $true
                Add-Journal -Message "Redirection vers $($dossier.RedirectionVers) (copie conservée)." -Categorie Exchange -Niveau Succes
            } | Out-Null
        } else {
            Invoke-Ecriture -Categorie Exchange -Description "Set-Mailbox $upn -ForwardingAddress null" -Action {
                Set-Mailbox -Identity $upn -ForwardingAddress $null
                Add-Journal -Message 'Redirection désactivée.' -Categorie Exchange -Niveau Succes
            } | Out-Null
        }
    } | Out-Null

    Invoke-Etape -Nom 'Réponse automatique' -Categorie Exchange -Ignorer:(-not $m365 -or $dossier.ReponseAuto -eq 'aucune') -Action {
        if ($dossier.ReponseAuto -eq 'activer') {
            $htmlAuto = "<div style='font-family:Montserrat,sans-serif;font-size:10pt'>$(([Net.WebUtility]::HtmlEncode($dossier.ReponseAutoTexte)) -replace "`r?`n", '<br>')</div>"
            $apercu = ($dossier.ReponseAutoTexte -replace "`r?`n", ' ')
            if ($apercu.Length -gt 90) { $apercu = $apercu.Substring(0, 89) + '…' }
            Invoke-Ecriture -Categorie Exchange -Description "Set-MailboxAutoReplyConfiguration $upn -AutoReplyState Enabled — « $apercu »" -Action {
                Set-MailboxAutoReplyConfiguration -Identity $upn -AutoReplyState Enabled -InternalMessage $htmlAuto -ExternalMessage $htmlAuto
                Add-Journal -Message "Réponse automatique activée." -Categorie Exchange -Niveau Succes
            } | Out-Null
        } else {
            Invoke-Ecriture -Categorie Exchange -Description "Set-MailboxAutoReplyConfiguration $upn -AutoReplyState Disabled" -Action {
                Set-MailboxAutoReplyConfiguration -Identity $upn -AutoReplyState Disabled
                Add-Journal -Message 'Réponse automatique désactivée.' -Categorie Exchange -Niveau Succes
            } | Out-Null
        }
    } | Out-Null

    Invoke-Etape -Nom 'Licences Microsoft 365 retirées (sauf conservées)' -Categorie Licences -Ignorer:(-not $m365) -Action { Remove-LicencesM365 -Upn $upn } | Out-Null

    Invoke-Etape -Nom 'Redirections et délégations vers ce compte' -Categorie Delegations -Ignorer:(-not $m365 -or -not $Reglages.ScanDelegations) -Action {
        Invoke-ScanDelegations -Cible $upn -Societe $soc.id -ForcerCache $dossier.ForcerCache
    } | Out-Null

    Invoke-Etape -Nom 'Poste 3CX retiré de ses files et désactivé' -Categorie 3CX -Ignorer:(-not $dossier.Poste3CX) -Action {
        $num = "$($dossier.Poste3CX.Number)"
        Remove-XapiPosteDesFiles -Pbx $pbx -Numero $num | Out-Null
        Set-XapiPoste -Pbx $pbx -Id $dossier.Poste3CX.Id -Numero $num -Proprietes @{ Enabled = $false; EmailAddress = '' }
        if (-not (Test-Simulation)) { Add-Journal -Message "Poste $num désactivé, e-mail vidé — le numéro reste réservé." -Categorie 3CX -Niveau Succes }
        if ($dossier.Sda3CX.Count -gt 0) {
            Add-Journal -Message "À REROUTER À LA MAIN — $($dossier.Sda3CX.Count) règle(s) entrante(s) visent encore le poste $num :" -Categorie 3CX -Niveau Alerte
            foreach ($s in $dossier.Sda3CX) {
                # Deux règles peuvent porter le même nom et la même SDA : l'identifiant les départage.
                $ref = @("règle $(Get-Prop -Objet $s -Nom 'Id' -Defaut '?')")
                if (Get-Prop -Objet $s -Nom 'TrunkDN') { $ref += "trunk $($s.TrunkDN)" }
                Add-Journal -Message "  $($s.RuleName) — SDA $($s.Data)  ($($ref -join ', '))" -Categorie 3CX -Niveau Alerte
            }
        } else { Add-Journal -Message 'Aucune règle entrante ne vise ce poste.' -Categorie 3CX -Niveau Succes }
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
$html = ConvertTo-RapportHtml -Titre "Sortie — $($dossier.Nom)" -SousTitre $soc.nom -Corps $corps
Invoke-Etape -Nom 'Rapport envoyé au helpdesk' -Categorie General -Action { Send-Rapport -Sujet "Rapport de désactivation - $($dossier.Nom)" -Html $html } | Out-Null
$donnees = [ordered]@{}; foreach ($k in $dossier.Keys) { if ($k -ne 'Utilisateur') { $donnees[$k] = $dossier[$k] } }
Save-Rapport -Nom "sortie-$sam" -Html $html -Donnees $donnees | Out-Null

Disconnect-M365
Complete-Session
