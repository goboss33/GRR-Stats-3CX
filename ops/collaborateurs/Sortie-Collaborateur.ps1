#Requires -Version 5.1
<#
    SORTIE D'UN COLLABORATEUR — Service Informatique.

    Les douze étapes de l'ancien script, inchangées dans leur logique, plus le
    3CX : désactivation AD, champs vidés, masquage de l'annuaire, groupes
    retirés, déplacement dans l'OU des désactivés, boîte partagée, redirection,
    réponse automatique, licences, délégations, poste 3CX retiré de ses files
    et désactivé, tâche Planner, rapport.

    Sans argument : assistant. Avec -Job : aucun dialogue (exemples\sortie.json).
    Commencez TOUJOURS par -Simulation sur un vrai compte : tout est listé,
    rien n'est écrit.
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

# ------------------------------------------------------------------ RÉGLAGES
$Reglages = @{
    ModeTest           = $true
    DestinataireTest   = 'geoffrey.bossens@grrsa.ch'
    Simulation         = $false
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
Initialize-Collaborateurs -Reglages $Reglages -Dossier $PSScriptRoot -Operation 'sortie'
$config = Get-Config

# ================================================================ 1. DOSSIER
$dossier = [ordered]@{
    Societe = $null; Utilisateur = $null; Sam = ''; Upn = ''; Nom = ''; Bureau = ''
    Redirection = 'aucune'; RedirectionVers = ''      # 'activer' | 'desactiver' | 'aucune'
    ReponseAuto = 'aucune'; ReponseAutoTexte = ''     # idem
    ForcerCache = $false
    Poste3CX = $null; Files3CX = @(); Sda3CX = @()
}

if ($Job) {
    $j = Get-Content -Path $Job -Raw -Encoding UTF8 | ConvertFrom-Json
    $dossier.Societe = Get-Societe -Id $j.societe
    $dossier.Sam = "$(Get-Prop -Objet $j -Nom 'identifiant' -Defaut '')"
    if (-not $dossier.Sam) { throw "Le fichier de travail ne donne pas d'identifiant." }
    $vers = Get-Prop -Objet $j -Nom 'redirectionVers'
    if ($vers) { $dossier.Redirection = 'activer'; $dossier.RedirectionVers = "$vers" }
    elseif ((Get-Prop -Objet $j -Nom 'redirection') -eq 'desactiver') { $dossier.Redirection = 'desactiver' }
    $texte = Get-Prop -Objet $j -Nom 'reponseAuto'
    if ($texte) { $dossier.ReponseAuto = 'activer'; $dossier.ReponseAutoTexte = "$texte" }
    elseif ((Get-Prop -Objet $j -Nom 'reponseAutoEtat') -eq 'desactiver') { $dossier.ReponseAuto = 'desactiver' }
} else {
    $dossier.Societe = Select-Option -Titre "Société" -Elements @($config.societes) -Colonnes id, nom
}
$soc = $dossier.Societe
$ad = Connect-Domaine -Societe $soc

# Le compte : recherche large, choix dans la grille — plus d'identifiant tapé sans faute.
if ($Job) {
    $dossier.Utilisateur = Get-ADUser -Identity $dossier.Sam -Properties DisplayName, Title, Department, Office, UserPrincipalName, Enabled, DistinguishedName @ad
} else {
    do {
        $recherche = Read-Texte -Invite "Collaborateur à désactiver (nom, prénom ou identifiant)" -Obligatoire -QuitteSurQ
        $trouves = @(Find-AdUtilisateur -Recherche $recherche -Ad $ad)
        if ($trouves.Count -eq 0) { Write-Host "  Aucun compte ne correspond." -ForegroundColor Yellow }
    } while ($trouves.Count -eq 0)
    $choix = Select-Option -Titre "Compte à désactiver" -Elements $trouves -Colonnes Name, SamAccountName, UserPrincipalName, Title, Department, Enabled
    $dossier.Utilisateur = Get-ADUser -Identity $choix.SamAccountName -Properties DisplayName, Title, Department, Office, UserPrincipalName, Enabled, DistinguishedName @ad
}
$u = $dossier.Utilisateur
$dossier.Sam = $u.SamAccountName; $dossier.Upn = $u.UserPrincipalName; $dossier.Nom = $u.Name; $dossier.Bureau = "$($u.Office)"
if (-not $u.Enabled) { Add-Journal -Message "Le compte $($u.SamAccountName) est DÉJÀ désactivé — le script reprend là où il en est." -Categorie AD -Niveau Alerte }

# Redirection et réponse automatique (comme avant, en trois choix).
if (-not $Job) {
    Write-Host ""
    $r = Read-Texte -Invite "Redirection des mails de $($dossier.Upn) : 1) activer  2) désactiver  3) ne rien changer" -Defaut '3'
    if ($r -eq '1') {
        do {
            $cible = Read-Texte -Invite "Vers quel compte ou liste (nom AD)" -Obligatoire -QuitteSurQ
            $vers = $null
            try { $vu = Get-ADUser -Identity $cible -Properties Enabled, UserPrincipalName @ad -ErrorAction Stop; $vers = $vu.UserPrincipalName; if (-not $vu.Enabled -and -not (Confirm-Choix -Question "  Ce compte est désactivé, l'utiliser quand même ?")) { $vers = $null } }
            catch { try { $g = Get-ADGroup -Identity $cible -Properties mail @ad -ErrorAction Stop; $vers = $g.mail } catch { Write-Host "  Introuvable dans l'AD." -ForegroundColor Yellow } }
        } while (-not $vers)
        $dossier.Redirection = 'activer'; $dossier.RedirectionVers = $vers
    } elseif ($r -eq '2') { $dossier.Redirection = 'desactiver' }

    $a = Read-Texte -Invite "Réponse automatique : 1) activer  2) désactiver  3) ne rien changer" -Defaut '3'
    if ($a -eq '1') {
        $tmp = Join-Path $env:TEMP 'reponse-automatique.txt'
        Set-Content -Path $tmp -Value "Entrez le message de réponse automatique, enregistrez et fermez le Bloc-notes." -Encoding UTF8 -WhatIf:$false
        Start-Process notepad.exe $tmp -Wait
        $dossier.ReponseAuto = 'activer'; $dossier.ReponseAutoTexte = (Get-Content -Path $tmp -Raw -Encoding UTF8).Trim()
        Remove-Item $tmp -Force -ErrorAction SilentlyContinue -WhatIf:$false
    } elseif ($a -eq '2') { $dossier.ReponseAuto = 'desactiver' }
    if ($Reglages.ScanDelegations) { $dossier.ForcerCache = Confirm-Choix -Question "Reconstruire le cache des redirections et délégations (long) ?" }
}

# =========================================== 2. CONNEXIONS ET LECTURE 3CX
if ($soc.tenantId) { Connect-M365 -Societe $soc } else { Add-Journal -Message "Pas de tenant Microsoft 365 pour $($soc.id) : étapes Exchange, licences et délégations ignorées." -Niveau Alerte }
$pbx = if ($Reglages.Gerer3CX) { Get-Pbx -Societe $soc } else { $null }
if ($pbx) {
    $postes = @(Find-XapiUtilisateurParEmail -Pbx $pbx -Email $dossier.Upn)
    if ($postes.Count -eq 0) { Add-Journal -Message "Aucun poste 3CX ne porte l'adresse $($dossier.Upn)." -Categorie 3CX -Niveau Alerte }
    else {
        $dossier.Poste3CX = $postes[0]
        $dossier.Files3CX = @(Get-XapiFilesDuPoste -Pbx $pbx -Numero "$($dossier.Poste3CX.Number)")
        $dossier.Sda3CX   = @(Get-XapiSdaVersPoste -Pbx $pbx -Numero "$($dossier.Poste3CX.Number)")
    }
}

# ====================================================== 3. RÉCAPITULATIF
$texteRedirection = switch ($dossier.Redirection) { 'activer' { "vers $($dossier.RedirectionVers)" } 'desactiver' { 'désactivée' } default { 'inchangée' } }
$texteReponse = switch ($dossier.ReponseAuto) { 'activer' { 'activée (texte saisi)' } 'desactiver' { 'désactivée' } default { 'inchangée' } }
Write-Host ""
Write-Host "  RÉCAPITULATIF" -ForegroundColor Cyan
Write-Host ("  {0,-22} {1}" -f 'Société', $soc.nom)
Write-Host ("  {0,-22} {1} ({2}) — {3}" -f 'Compte', $dossier.Nom, $dossier.Sam, $dossier.Upn)
Write-Host ("  {0,-22} {1}" -f 'Redirection', $texteRedirection)
Write-Host ("  {0,-22} {1}" -f 'Réponse automatique', $texteReponse)
Write-Host ("  {0,-22} {1}" -f 'OU de destination', $(if ($soc.ouDesactives) { $soc.ouDesactives } else { 'AUCUNE (pas de déplacement)' }))
Write-Host ("  {0,-22} {1}" -f 'Poste 3CX', $(if ($dossier.Poste3CX) { "$($dossier.Poste3CX.Number) « $($dossier.Poste3CX.DisplayName) » — $($dossier.Files3CX.Count) file(s), $($dossier.Sda3CX.Count) SDA" } elseif ($pbx) { 'aucun trouvé' } else { 'pas de PBX / désactivé' }))
Write-Host ""
if (-not $Job -and -not (Confirm-Choix -Question "  Confirmer et exécuter ?")) { Disconnect-M365; Stop-Script }
Write-Host ""

# ============================================================ 4. EXÉCUTION
$sam = $dossier.Sam; $upn = $dossier.Upn

Invoke-Etape -Nom "Désactivation du compte AD" -Categorie AD -Critique -Action {
    Disable-ADAccount -Identity $sam @ad
    Add-Journal -Message "Compte $sam désactivé." -Categorie AD -Niveau Succes
} | Out-Null

Invoke-Etape -Nom "Champs AD vidés (fonction, service, société, responsable, téléphones)" -Categorie AD -Action {
    $avant = Get-ADUser -Identity $sam -Properties Title, Department, Company, Manager, TelephoneNumber, Mobile @ad
    Add-Journal -Message "Avant : fonction « $($avant.Title) », service « $($avant.Department) », société « $($avant.Company) », responsable « $($avant.Manager -replace '^CN=([^,]+).*', '$1') », fixe « $($avant.TelephoneNumber) », mobile « $($avant.Mobile) »" -Categorie AD
    Set-ADUser -Identity $sam -Clear Title, Department, Company, Manager, TelephoneNumber, Mobile @ad
    Add-Journal -Message "Champs vidés." -Categorie AD -Niveau Succes
} | Out-Null

Invoke-Etape -Nom "Masqué de l'annuaire Exchange" -Categorie AD -Action {
    Set-ADUser -Identity $sam -Replace @{ msExchHideFromAddressLists = $true } @ad
    Add-Journal -Message "msExchHideFromAddressLists posé." -Categorie AD -Niveau Succes
} | Out-Null

Invoke-Etape -Nom "Retrait des groupes AD" -Categorie Groupes -Action {
    $conserves = @($config.sortie.groupesConserves)
    $dns = @((Get-ADUser -Identity $sam -Properties MemberOf @ad).MemberOf)
    $retires = @(); $gardes = @()
    foreach ($dn in $dns) {
        $nom = $dn -replace '^CN=([^,]+).*', '$1'
        try { $membres = @(Get-ADGroupMember -Identity $dn @ad); if ($membres.Count -eq 1 -and $membres[0].SamAccountName -eq $sam) { Add-Journal -Message "ATTENTION : $sam est le DERNIER membre de $nom." -Categorie Groupes -Niveau Alerte } } catch { }
        if (@($conserves | Where-Object { $nom -like $_ }).Count -gt 0) { $gardes += $nom; continue }
        Remove-ADGroupMember -Identity $dn -Members $sam -Confirm:$false @ad
        $retires += $nom
    }
    Add-Journal -Message "Groupes retirés ($($retires.Count)) : $($retires -join '; ')" -Categorie Groupes -Niveau Succes
    if ($gardes.Count) { Add-Journal -Message "Groupes conservés : $($gardes -join '; ')" -Categorie Groupes -Niveau Alerte }
} | Out-Null

Invoke-Etape -Nom "Déplacement dans l'OU des désactivés" -Categorie AD -Ignorer:(-not $soc.ouDesactives) -Action {
    $obj = Get-ADUser -Identity $sam @ad
    Move-ADObject -Identity $obj.DistinguishedName -TargetPath $soc.ouDesactives @ad
    Add-Journal -Message "Déplacé dans $($soc.ouDesactives)." -Categorie AD -Niveau Succes
} | Out-Null

$m365 = [bool]$soc.tenantId
Invoke-Etape -Nom "Boîte convertie en boîte partagée" -Categorie Exchange -Ignorer:(-not $m365) -Action {
    if (-not (Get-Mailbox -Identity $upn -ErrorAction SilentlyContinue)) { Add-Journal -Message "Pas de boîte Exchange Online pour $upn." -Categorie Exchange -Niveau Alerte; return }
    Set-Mailbox -Identity $upn -Type Shared
    Add-Journal -Message "Boîte $upn convertie en boîte partagée." -Categorie Exchange -Niveau Succes
} | Out-Null

Invoke-Etape -Nom "Redirection des mails" -Categorie Exchange -Ignorer:(-not $m365 -or $dossier.Redirection -eq 'aucune') -Action {
    if ($dossier.Redirection -eq 'activer') {
        if (-not (Get-Recipient -Identity $dossier.RedirectionVers -ErrorAction SilentlyContinue)) { throw "Cible de redirection inconnue d'Exchange Online : $($dossier.RedirectionVers)" }
        Set-Mailbox -Identity $upn -ForwardingAddress $dossier.RedirectionVers -DeliverToMailboxAndForward $true
        Add-Journal -Message "Redirection vers $($dossier.RedirectionVers) (copie conservée)." -Categorie Exchange -Niveau Succes
    } else {
        Set-Mailbox -Identity $upn -ForwardingAddress $null
        Add-Journal -Message "Redirection désactivée." -Categorie Exchange -Niveau Succes
    }
} | Out-Null

Invoke-Etape -Nom "Réponse automatique" -Categorie Exchange -Ignorer:(-not $m365 -or $dossier.ReponseAuto -eq 'aucune') -Action {
    if ($dossier.ReponseAuto -eq 'activer') {
        $htmlAuto = "<div style='font-family:Montserrat,sans-serif;font-size:10pt'>$(([Net.WebUtility]::HtmlEncode($dossier.ReponseAutoTexte)) -replace "`r?`n", '<br>')</div>"
        Set-MailboxAutoReplyConfiguration -Identity $upn -AutoReplyState Enabled -InternalMessage $htmlAuto -ExternalMessage $htmlAuto
        Add-Journal -Message "Réponse automatique activée : $($dossier.ReponseAutoTexte)" -Categorie Exchange -Niveau Succes
    } else {
        Set-MailboxAutoReplyConfiguration -Identity $upn -AutoReplyState Disabled
        Add-Journal -Message "Réponse automatique désactivée." -Categorie Exchange -Niveau Succes
    }
} | Out-Null

Invoke-Etape -Nom "Licences Microsoft 365 (sauf conservées)" -Categorie Licences -Ignorer:(-not $m365) -Action { Remove-LicencesM365 -Upn $upn } | Out-Null

Invoke-Etape -Nom "Redirections et délégations vers ce compte" -Categorie Delegations -Ignorer:(-not $m365 -or -not $Reglages.ScanDelegations) -Action {
    Invoke-ScanDelegations -Cible $upn -Societe $soc.id -ForcerCache $dossier.ForcerCache
} | Out-Null

Invoke-Etape -Nom "Poste 3CX : retrait des files et désactivation" -Categorie 3CX -Ignorer:(-not $dossier.Poste3CX) -Action {
    $num = "$($dossier.Poste3CX.Number)"
    Remove-XapiPosteDesFiles -Pbx $pbx -Numero $num | Out-Null
    Set-XapiPoste -Pbx $pbx -Id $dossier.Poste3CX.Id -Proprietes @{ Enabled = $false; EmailAddress = '' }
    Add-Journal -Message "Poste $num désactivé, e-mail vidé — le numéro reste réservé." -Categorie 3CX -Niveau Succes
    if ($dossier.Sda3CX.Count -gt 0) {
        Add-Journal -Message "À REROUTER À LA MAIN — $($dossier.Sda3CX.Count) règle(s) entrante(s) visent encore ce poste :" -Categorie 3CX -Niveau Alerte
        foreach ($s in $dossier.Sda3CX) { Add-Journal -Message "  $($s.RuleName) — SDA $($s.Data) (trunk $($s.TrunkDN))" -Categorie 3CX }
    } else { Add-Journal -Message "Aucune règle entrante ne vise ce poste." -Categorie 3CX -Niveau Succes }
} | Out-Null

Invoke-Etape -Nom "Tâche Planner (suivi à 180 jours)" -Categorie Planner -Ignorer:(-not $Reglages.CreerTachePlanner) -Action {
    Add-TachePlanner -Titre "Désactivation de l'utilisateur $($dossier.Nom) - $($soc.id)" -Description "L'utilisateur $($dossier.Nom) ($upn) a été désactivé. Vérifier les redirections et les délégations." -Bureau $dossier.Bureau
} | Out-Null

# ============================================================== 5. RAPPORT
$entete = "<p><b>Société :</b> $($soc.nom)<br><b>Utilisateur :</b> $($dossier.Nom) ($upn)<br><b>Redirection :</b> $texteRedirection<br><b>Réponse automatique :</b> $texteReponse</p>"
$html = ConvertTo-RapportHtml -Titre "Sortie — $($dossier.Nom)" -EnTete $entete
Invoke-Etape -Nom "Rapport envoyé au helpdesk" -Categorie General -Action { Send-Rapport -Sujet "Rapport de désactivation - $($dossier.Nom)" -Html $html } | Out-Null
$donnees = [ordered]@{}; foreach ($k in $dossier.Keys) { if ($k -ne 'Utilisateur') { $donnees[$k] = $dossier[$k] } }
Save-Rapport -Nom "sortie-$sam" -Html $html -Donnees $donnees | Out-Null

Disconnect-M365
Complete-Session
