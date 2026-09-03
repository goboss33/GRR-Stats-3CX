#Requires -Version 5.1
<#
    MODULE COMMUN — entrée et sortie des collaborateurs.

    Ce que les deux anciens scripts dupliquaient vit ici une seule fois :
    la configuration, le journal et les étapes, le mail, les connexions
    (AD, Exchange Online, Graph), le client XAPI du 3CX et le coffre des
    secrets. Les scripts eux-mêmes ne sont plus que des assistants.

    Compatible Windows PowerShell 5.1 (et 7). Pas d'opérateur ?? ni ternaire,
    pas de -AsHashtable : tout ce qui suit passe sur les deux versions.
#>

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

# TLS 1.2 obligatoire pour Entra et le PBX sous Windows PowerShell 5.1.
try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch { }

# ====================================================================
#  ÉTAT DE SESSION
# ====================================================================

$script:Config      = $null
$script:Reglages    = $null
$script:Dossier     = $null
$script:Journal     = New-Object System.Collections.ArrayList   # lignes du rapport, par catégorie
$script:Etapes      = New-Object System.Collections.ArrayList   # la checklist
$script:Credentials = @{}                                        # domaine -> PSCredential (une saisie par session)
$script:Xapi        = @{}                                        # clé PBX -> jeton + expiration
$script:Session     = @{ Operateur = $env:USERNAME; Debut = Get-Date; Transcription = $null }

# ====================================================================
#  CONFIGURATION ET RÉGLAGES
# ====================================================================

function Initialize-Collaborateurs {
    <#
      Charge la configuration, applique les réglages du script appelant,
      ouvre le dossier de logs et la transcription. À appeler en premier.
    #>
    param(
        [Parameter(Mandatory)] [hashtable] $Reglages,
        [Parameter(Mandatory)] [string]    $Dossier,      # dossier du script ($PSScriptRoot)
        [Parameter(Mandatory)] [string]    $Operation     # "entree" | "sortie"
    )
    $script:Dossier  = $Dossier
    $script:Reglages = $Reglages
    $script:Journal.Clear(); $script:Etapes.Clear()

    $chemin = Join-Path $Dossier 'config.json'
    if (-not (Test-Path $chemin)) { throw "Configuration introuvable : $chemin" }
    $script:Config = Get-Content -Path $chemin -Raw -Encoding UTF8 | ConvertFrom-Json
    if (-not $script:Config.societes) { throw "config.json : aucune société définie." }

    if (-not $Reglages.ContainsKey('DossierLogs') -or -not $Reglages.DossierLogs) { $Reglages.DossierLogs = Join-Path $Dossier 'logs' }
    New-Item -ItemType Directory -Path $Reglages.DossierLogs -Force -WhatIf:$false | Out-Null
    # Accents corrects dans la console, quelle que soit la page de codes du serveur.
    try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch { }

    # SIMULATION : les cmdlets qui savent simuler (AD, Exchange, Graph) le font
    # d'eux-mêmes grâce à la préférence globale ; le reste (XAPI, mail, Planner)
    # consulte Test-Simulation.
    $global:WhatIfPreference = [bool]$Reglages.Simulation

    $horodatage = Get-Date -Format 'yyyyMMdd-HHmmss'
    $script:Session.Transcription = Join-Path $Reglages.DossierLogs "$Operation-$horodatage-transcription.txt"
    try { Start-Transcript -Path $script:Session.Transcription -Append -WhatIf:$false | Out-Null } catch { }

    Write-Bandeau -Titre $(if ($Operation -eq 'entree') { "Entrée d'un collaborateur" } else { "Sortie d'un collaborateur" })
    if ($Reglages.Simulation) { Write-Host " SIMULATION : aucune écriture ne sera faite, tout est listé " -ForegroundColor Black -BackgroundColor Yellow }
    if ($Reglages.ModeTest)   { Write-Host " MODE TEST : mails détournés vers $($Reglages.DestinataireTest), pas de tâche Planner " -ForegroundColor Black -BackgroundColor Cyan }
    Write-Host ""
}

function Get-Config { return $script:Config }

function Get-Prop {
    <# Lit une propriété qui peut ne pas exister (JSON, OData) sans que StrictMode ne s'en offusque. #>
    param([Parameter(Mandatory)] $Objet, [Parameter(Mandatory)] [string] $Nom, $Defaut = $null)
    if ($null -eq $Objet) { return $Defaut }
    $p = $Objet.PSObject.Properties[$Nom]
    if ($p -and $null -ne $p.Value) { return $p.Value }
    return $Defaut
}
function Get-Reglages { return $script:Reglages }
function Test-Simulation { return [bool]$script:Reglages.Simulation }
function Test-ModeTest { return [bool]$script:Reglages.ModeTest }

function Get-Societe {
    param([Parameter(Mandatory)] [string] $Id)
    $s = $script:Config.societes | Where-Object { $_.id -eq $Id } | Select-Object -First 1
    if (-not $s) { throw "Société inconnue dans config.json : $Id" }
    return $s
}

function Get-Operateur {
    <# L'opérateur courant, tel que config.json le connaît (ou null). #>
    $ops = $script:Config.operateurs
    $nom = $env:USERNAME.ToLower()
    foreach ($p in $ops.PSObject.Properties) {
        if ($p.Name.ToLower() -eq $nom) { return $p.Value }
    }
    return $null
}

# ====================================================================
#  AFFICHAGE, JOURNAL, ÉTAPES
# ====================================================================

function Write-Bandeau {
    param([string] $Titre)
    $ligne = '#' * 65
    Write-Host $ligne -ForegroundColor Green
    Write-Host ("##  {0,-59}##" -f $Titre) -ForegroundColor Green
    Write-Host ("##  {0,-59}##" -f "Service Informatique — opérateur : $($script:Session.Operateur)") -ForegroundColor Green
    Write-Host $ligne -ForegroundColor Green
}

function Add-Journal {
    <# Une ligne du rapport final, rangée par catégorie. Niveau : Info | Succes | Alerte | Erreur #>
    param(
        [Parameter(Mandatory)] [string] $Message,
        [ValidateSet('AD', 'Groupes', 'Exchange', 'Licences', 'Delegations', '3CX', 'Planner', 'General')] [string] $Categorie = 'General',
        [ValidateSet('Info', 'Succes', 'Alerte', 'Erreur')] [string] $Niveau = 'Info'
    )
    [void] $script:Journal.Add([pscustomobject]@{ Quand = Get-Date; Categorie = $Categorie; Niveau = $Niveau; Message = $Message })
    $couleur = switch ($Niveau) { 'Succes' { 'Green' } 'Alerte' { 'Yellow' } 'Erreur' { 'Red' } default { 'Gray' } }
    $prefixe = switch ($Niveau) { 'Succes' { '[OK] ' } 'Alerte' { '[!]  ' } 'Erreur' { '[X]  ' } default { '     ' } }
    Write-Host "$prefixe$Message" -ForegroundColor $couleur
}

function Invoke-Etape {
    <#
      Exécute UNE étape de la checklist, avec son try/catch, sa durée, son
      verdict. Une étape critique qui échoue arrête tout ; une étape
      secondaire note l'échec et laisse continuer. Le scriptblock reçoit la
      main dans l'état de simulation courant ($WhatIfPreference global).
    #>
    param(
        [Parameter(Mandatory)] [string]      $Nom,
        [Parameter(Mandatory)] [scriptblock] $Action,
        [ValidateSet('AD', 'Groupes', 'Exchange', 'Licences', 'Delegations', '3CX', 'Planner', 'General')] [string] $Categorie = 'General',
        [switch] $Critique,
        [switch] $Ignorer        # déjà décidé de ne pas la faire (réglage éteint)
    )
    $etape = [pscustomobject]@{ Nom = $Nom; Categorie = $Categorie; Etat = 'ignoree'; Duree = 0; Detail = '' }
    [void] $script:Etapes.Add($etape)
    if ($Ignorer) {
        Write-Host ("  [--] {0}" -f $Nom) -ForegroundColor DarkGray
        return $null
    }
    Write-Host ("  [..] {0}" -f $Nom) -ForegroundColor Gray
    $chrono = [Diagnostics.Stopwatch]::StartNew()
    try {
        $resultat = & $Action
        $chrono.Stop()
        $etape.Etat = 'ok'; $etape.Duree = [math]::Round($chrono.Elapsed.TotalSeconds, 1)
        Write-Host ("  [OK] {0}  ({1} s)" -f $Nom, $etape.Duree) -ForegroundColor Green
        return $resultat
    } catch {
        $chrono.Stop()
        $etape.Etat = 'echec'; $etape.Duree = [math]::Round($chrono.Elapsed.TotalSeconds, 1); $etape.Detail = $_.Exception.Message
        Write-Host ("  [KO] {0}  ({1} s)" -f $Nom, $etape.Duree) -ForegroundColor Red
        Write-Host "       $($_.Exception.Message)" -ForegroundColor Red
        Add-Journal -Message "$Nom : $($_.Exception.Message)" -Categorie $Categorie -Niveau Erreur
        if ($Critique) { throw "Étape critique en échec : $Nom" }
        return $null
    }
}

function Show-Checklist {
    Write-Host ""
    Write-Host "  Bilan des étapes" -ForegroundColor Cyan
    foreach ($e in $script:Etapes) {
        $symbole = switch ($e.Etat) { 'ok' { '[OK]' } 'echec' { '[KO]' } default { '[--]' } }
        $couleur = switch ($e.Etat) { 'ok' { 'Green' } 'echec' { 'Red' } default { 'DarkGray' } }
        Write-Host ("  {0} {1}{2}" -f $symbole, $e.Nom, $(if ($e.Etat -eq 'ignoree') { '' } else { "  ($($e.Duree) s)" })) -ForegroundColor $couleur
    }
    Write-Host ""
}

function Read-Texte {
    param([Parameter(Mandatory)] [string] $Invite, [string] $Defaut = '', [switch] $Obligatoire, [switch] $QuitteSurQ)
    do {
        $affichage = if ($Defaut) { "$Invite [$Defaut]" } else { $Invite }
        $valeur = Read-Host $affichage
        if ($QuitteSurQ -and $valeur -eq 'q') { Stop-Script }
        if (-not $valeur -and $Defaut) { $valeur = $Defaut }
        if ($Obligatoire -and -not $valeur) { Write-Host "  Valeur obligatoire." -ForegroundColor Yellow }
    } while ($Obligatoire -and -not $valeur)
    return $valeur.Trim()
}

function Confirm-Choix {
    param([Parameter(Mandatory)] [string] $Question, [switch] $DefautOui)
    $suffixe = if ($DefautOui) { '(O/n)' } else { '(o/N)' }
    $r = Read-Host "$Question $suffixe"
    if (-not $r) { return [bool]$DefautOui }
    return $r -match '^[oOyY]'
}

function Stop-Script {
    Write-Host "`nFermeture du script..." -ForegroundColor Green
    try { Stop-Transcript | Out-Null } catch { }
    exit
}

function Select-Option {
    <#
      Un choix parmi des objets : une grille avec recherche (Out-GridView)
      quand l'interface graphique est là, un menu numéroté sinon.
      -Colonnes : propriétés affichées, dans l'ordre.
    #>
    param(
        [Parameter(Mandatory)] [string]   $Titre,
        [Parameter(Mandatory)] [object[]] $Elements,
        [string[]] $Colonnes,
        [switch]   $Multiple
    )
    if (-not $Elements -or $Elements.Count -eq 0) { throw "Rien à choisir pour « $Titre »." }
    $vue = if ($Colonnes) { $Elements | Select-Object -Property $Colonnes } else { $Elements }
    $grille = Get-Command Out-GridView -ErrorAction SilentlyContinue
    if ($grille -and -not $env:COLLABORATEURS_SANS_GUI) {
        $mode = if ($Multiple) { 'Multiple' } else { 'Single' }
        $choix = $vue | Out-GridView -Title $Titre -OutputMode $mode
        if (-not $choix) { throw "Sélection annulée : $Titre" }
        # On rend les objets d'origine, pas la projection.
        $indices = @()
        foreach ($c in @($choix)) { $indices += [array]::IndexOf(@($vue | ForEach-Object { "$($_ | ConvertTo-Json -Compress)" }), "$($c | ConvertTo-Json -Compress)") }
        $retour = @($indices | ForEach-Object { $Elements[$_] })
        if ($Multiple) { return $retour } else { return $retour[0] }
    }
    # Repli console
    Write-Host "`n$Titre" -ForegroundColor Cyan
    for ($i = 0; $i -lt $Elements.Count; $i++) {
        $libelle = if ($Colonnes) { ($Colonnes | ForEach-Object { $Elements[$i].$_ }) -join ' · ' } else { "$($Elements[$i])" }
        Write-Host ("  {0,3}) {1}" -f ($i + 1), $libelle)
    }
    do {
        $saisie = Read-Host $(if ($Multiple) { "Numéros séparés par des virgules (q pour quitter)" } else { "Numéro (q pour quitter)" })
        if ($saisie -eq 'q') { Stop-Script }
        $nums = @($saisie -split '[,; ]+' | Where-Object { $_ -match '^\d+$' } | ForEach-Object { [int]$_ } | Where-Object { $_ -ge 1 -and $_ -le $Elements.Count })
    } while ($nums.Count -eq 0)
    $retour = @($nums | ForEach-Object { $Elements[$_ - 1] })
    if ($Multiple) { return $retour } else { return $retour[0] }
}

# ====================================================================
#  OUTILS TEXTE ET MOT DE PASSE
# ====================================================================

function Remove-Accents {
    param([Parameter(Mandatory)] [string] $Texte)
    $norm = $Texte.Normalize([Text.NormalizationForm]::FormD)
    $sb = New-Object Text.StringBuilder
    foreach ($c in $norm.ToCharArray()) {
        if ([Globalization.CharUnicodeInfo]::GetUnicodeCategory($c) -ne [Globalization.UnicodeCategory]::NonSpacingMark) { [void]$sb.Append($c) }
    }
    return $sb.ToString().Normalize([Text.NormalizationForm]::FormC)
}

function New-MotDePasse {
    <# 12 caractères, au moins une minuscule, une majuscule, un chiffre, un signe — sans caractères ambigus. #>
    param([int] $Longueur = 12)
    $groupes = @('abcdefghijkmnpqrstuvwxyz', 'ABCDEFGHJKLMNPQRSTUVWXYZ', '23456789', '!#%&*+-=?@')
    $rng = New-Object Security.Cryptography.RNGCryptoServiceProvider
    $tire = {
        param($alphabet)
        $b = New-Object byte[] 4; $rng.GetBytes($b)
        $alphabet[[BitConverter]::ToUInt32($b, 0) % $alphabet.Length]
    }
    $chars = @()
    foreach ($g in $groupes) { $chars += & $tire $g }
    $tous = -join $groupes
    while ($chars.Count -lt $Longueur) { $chars += & $tire $tous }
    # Mélange de Fisher-Yates
    for ($i = $chars.Count - 1; $i -gt 0; $i--) {
        $b = New-Object byte[] 4; $rng.GetBytes($b)
        $j = [BitConverter]::ToUInt32($b, 0) % ($i + 1)
        $t = $chars[$i]; $chars[$i] = $chars[$j]; $chars[$j] = $t
    }
    return -join $chars
}

function ConvertTo-Identifiants {
    <# Prénom + nom → identifiant, e-mail, nom court, sans accents ni espaces. #>
    param([Parameter(Mandatory)] [string] $Prenom, [Parameter(Mandatory)] [string] $Nom, [Parameter(Mandatory)] [string] $DomaineMail)
    $p = (Remove-Accents $Prenom).ToLower() -replace '\s+', ''
    $n = (Remove-Accents $Nom).ToLower() -replace '\s+', ''
    return [pscustomobject]@{
        Sam          = $p.Substring(0, 1) + $n
        MailNickname = "$p.$n"
        Email        = "$p.$n$DomaineMail"
        DisplayName  = "$Prenom $Nom"
    }
}

# ====================================================================
#  ACTIVE DIRECTORY
# ====================================================================

function Connect-Domaine {
    <#
      Rend le « splat » à passer aux cmdlets AD pour cette société : le
      contrôleur, et les identifiants si la machine n'est pas dans ce domaine.
      Une saisie par domaine et par session — plus de mot de passe redemandé
      à chaque étape.
    #>
    param([Parameter(Mandatory)] $Societe)
    Import-Module ActiveDirectory -ErrorAction Stop
    $splat = @{ Server = $Societe.dc }
    $domaineLocal = try { (Get-WmiObject Win32_ComputerSystem).Domain } catch { '' }
    if ($domaineLocal -and $Societe.dc -like "*.$domaineLocal") { return $splat }

    if (-not $script:Credentials.ContainsKey($Societe.domaineAd)) {
        $op = Get-Operateur
        $compte = $null
        if ($op -and $op.PSObject.Properties[$Societe.id]) { $compte = $op.($Societe.id).domaine }
        if (-not $compte) { $compte = "$($Societe.domaineAd)\" }
        $script:Credentials[$Societe.domaineAd] = Get-Credential -Message "Compte administrateur du domaine $($Societe.domaineAd)" -UserName $compte
    }
    $splat.Credential = $script:Credentials[$Societe.domaineAd]
    return $splat
}

function Find-AdUtilisateur {
    <# Recherche large (nom, prénom, identifiant, e-mail) → liste pour le sélecteur. #>
    param([Parameter(Mandatory)] [string] $Recherche, [Parameter(Mandatory)] [hashtable] $Ad)
    $r = $Recherche.Replace("'", "''")
    $filtre = "Name -like '*$r*' -or SamAccountName -like '*$r*' -or UserPrincipalName -like '*$r*' -or GivenName -like '*$r*' -or Surname -like '*$r*'"
    return @(Get-ADUser -Filter $filtre -Properties DisplayName, Title, Department, Enabled, UserPrincipalName, DistinguishedName @Ad |
        Sort-Object Name | Select-Object Name, SamAccountName, UserPrincipalName, Title, Department, Enabled, DistinguishedName)
}

function Wait-AdUtilisateur {
    <# Attend que l'objet soit lisible sur le contrôleur, au lieu de dormir cinq secondes à l'aveugle. #>
    param([Parameter(Mandatory)] [string] $Sam, [Parameter(Mandatory)] [hashtable] $Ad, [int] $DelaiSec = 30)
    $fin = (Get-Date).AddSeconds($DelaiSec)
    do {
        try { $u = Get-ADUser -Identity $Sam @Ad -ErrorAction Stop; if ($u) { return $u } } catch { }
        Start-Sleep -Milliseconds 500
    } while ((Get-Date) -lt $fin)
    throw "L'utilisateur $Sam n'est pas visible après $DelaiSec s."
}

function Invoke-AdConnectDelta {
    <# Synchronisation delta, déclenchée SUR le serveur AD Connect. #>
    $serveur = $script:Config.adConnect.serveur
    if (Test-Simulation) { Add-Journal -Message "SIMULATION : synchronisation AD Connect delta sur $serveur" -Categorie AD -Niveau Info; return }
    Invoke-Command -ComputerName $serveur -ScriptBlock {
        Import-Module ADSync -ErrorAction Stop
        Start-ADSyncSyncCycle -PolicyType Delta | Out-Null
    } -ErrorAction Stop
    Add-Journal -Message "Synchronisation AD Connect (delta) déclenchée sur $serveur." -Categorie AD -Niveau Succes
}

# ====================================================================
#  MICROSOFT 365 — EXCHANGE ONLINE ET GRAPH
# ====================================================================

function Connect-M365 {
    <# Exchange Online + Graph (délégué, interactif) pour le tenant de la société. #>
    param([Parameter(Mandatory)] $Societe)
    if (-not $Societe.tenantId) { throw "Pas de tenant Microsoft 365 configuré pour $($Societe.id)." }
    $op = Get-Operateur
    $upn = $null
    if ($op -and $op.PSObject.Properties[$Societe.id]) { $upn = $op.($Societe.id).o365 }
    if (-not $upn) { $upn = Read-Texte -Invite "Compte administrateur Microsoft 365 (UPN)" -Obligatoire }

    Import-Module ExchangeOnlineManagement -ErrorAction Stop
    Connect-ExchangeOnline -UserPrincipalName $upn -ShowBanner:$false -ShowProgress:$false
    Add-Journal -Message "Connecté à Exchange Online ($upn)." -Categorie Exchange -Niveau Succes

    Import-Module Microsoft.Graph.Authentication -ErrorAction Stop
    Connect-MgGraph -TenantId $Societe.tenantId -Scopes 'User.ReadWrite.All', 'Directory.ReadWrite.All' -NoWelcome
    Add-Journal -Message "Connecté à Microsoft Graph (tenant $($Societe.id))." -Categorie Licences -Niveau Succes
}

function Disconnect-M365 {
    try { Disconnect-ExchangeOnline -Confirm:$false -ErrorAction SilentlyContinue | Out-Null } catch { }
    try { Disconnect-MgGraph -ErrorAction SilentlyContinue | Out-Null } catch { }
}

function Remove-LicencesM365 {
    <# Retire toutes les licences sauf celles conservées (config sortie.licencesConservees). Rend le détail pour le rapport. #>
    param([Parameter(Mandatory)] [string] $Upn)
    $conservees = @($script:Config.sortie.licencesConservees)
    $noms = $script:Config.sortie.licencesNoms
    $user = Get-MgUser -UserId $Upn -ErrorAction SilentlyContinue
    if (-not $user) { Add-Journal -Message "$Upn n'existe pas dans Microsoft Graph pour ce tenant." -Categorie Licences -Niveau Alerte; return }
    $licences = @(Get-MgUserLicenseDetail -UserId $Upn)
    if ($licences.Count -eq 0) { Add-Journal -Message "Aucune licence active pour $Upn." -Categorie Licences -Niveau Alerte; return }
    $aRetirer = @($licences | Where-Object { $conservees -notcontains $_.SkuPartNumber } | Select-Object -ExpandProperty SkuId)
    if ($aRetirer.Count -gt 0) {
        if (Test-Simulation) { Add-Journal -Message "SIMULATION : retrait de $($aRetirer.Count) licence(s)" -Categorie Licences }
        else { Set-MgUserLicense -UserId $Upn -RemoveLicenses $aRetirer -AddLicenses @() | Out-Null }
    }
    $skus = Get-MgSubscribedSku
    foreach ($l in $licences) {
        $sku = $skus | Where-Object { $_.SkuId -eq $l.SkuId }
        $libelle = if ($noms.PSObject.Properties[$l.SkuPartNumber]) { $noms.($l.SkuPartNumber) } else { $l.SkuPartNumber }
        $restantes = if ($sku) { $sku.PrepaidUnits.Enabled - $sku.ConsumedUnits } else { '?' }
        $total = if ($sku) { $sku.PrepaidUnits.Enabled } else { '?' }
        if ($aRetirer -contains $l.SkuId) { Add-Journal -Message "$libelle — retirée ($restantes restante(s) sur $total)" -Categorie Licences -Niveau Succes }
        else { Add-Journal -Message "$libelle — CONSERVÉE ($restantes restante(s) sur $total)" -Categorie Licences -Niveau Alerte }
    }
}

function Invoke-ScanDelegations {
    <#
      Redirections et délégations (SendOnBehalf, FullAccess, SendAs) pointant
      vers le collaborateur, avec le cache de l'ancien script. Les délégations
      trouvées sont retirées (comme avant), les redirections seulement listées.
    #>
    param([Parameter(Mandatory)] [string] $Cible, [Parameter(Mandatory)] [string] $Societe, [bool] $ForcerCache = $false)
    $dossierCache = Join-Path $script:Dossier 'cache'
    New-Item -ItemType Directory -Path $dossierCache -Force -WhatIf:$false | Out-Null
    $fichier = Join-Path $dossierCache "$($Societe -replace '[^A-Za-z0-9]', '_')_delegations.json"
    $validite = [int]$script:Config.sortie.cacheDelegationsHeures
    $cible = $Cible.Trim().ToLower()

    $cache = $null; $valide = $false
    if (Test-Path $fichier) {
        $cache = Get-Content $fichier -Raw -Encoding UTF8 | ConvertFrom-Json
        $valide = (Get-Date) -le ([datetime]::Parse($cache.LastUpdated)).AddHours($validite)
    }
    if ($ForcerCache -or -not $valide -or -not $cache) {
        Write-Host "     Analyse des boîtes aux lettres (cache absent, périmé ou forcé)…" -ForegroundColor Cyan
        $redirs = @(); $delegs = @()
        $boites = @(Get-Mailbox -ResultSize Unlimited -RecipientTypeDetails UserMailbox, SharedMailbox)
        $i = 0
        foreach ($b in $boites) {
            $i++; Write-Progress -Activity "Analyse des boîtes aux lettres" -Status "$i / $($boites.Count)" -PercentComplete (100 * $i / [math]::Max(1, $boites.Count))
            if ($b.ForwardingAddress -or $b.ForwardingSmtpAddress) {
                $vers = $b.ForwardingSmtpAddress
                if ($b.ForwardingAddress) { $r = Get-Recipient -Identity $b.ForwardingAddress -ErrorAction SilentlyContinue; if ($r) { $vers = $r.PrimarySmtpAddress } }
                $redirs += [pscustomobject]@{ Boite = $b.UserPrincipalName; Vers = "$vers" }
            }
            foreach ($d in @($b.GrantSendOnBehalfTo)) {
                $r = Get-Recipient -Identity "$d" -ErrorAction SilentlyContinue
                if ($r) { $delegs += [pscustomobject]@{ Type = 'SendOnBehalf'; Boite = $b.UserPrincipalName; Qui = "$($r.PrimarySmtpAddress)" } }
            }
            foreach ($p in @(Get-MailboxPermission -Identity $b.UserPrincipalName -ErrorAction SilentlyContinue | Where-Object { $_.AccessRights -contains 'FullAccess' -and -not $_.IsInherited -and $_.User -notlike 'NT AUTHORITY*' })) {
                $delegs += [pscustomobject]@{ Type = 'FullAccess'; Boite = $b.UserPrincipalName; Qui = "$($p.User)" }
            }
            foreach ($p in @(Get-RecipientPermission -Identity $b.UserPrincipalName -ErrorAction SilentlyContinue | Where-Object { $_.AccessRights -contains 'SendAs' -and $_.Trustee -notlike 'NT AUTHORITY*' })) {
                $delegs += [pscustomobject]@{ Type = 'SendAs'; Boite = $b.UserPrincipalName; Qui = "$($p.Trustee)" }
            }
        }
        Write-Progress -Activity "Analyse des boîtes aux lettres" -Completed
        $cache = [pscustomobject]@{ LastUpdated = (Get-Date).ToString('o'); Redirections = $redirs; Delegations = $delegs }
        $cache | ConvertTo-Json -Depth 4 | Set-Content -Path $fichier -Encoding UTF8 -WhatIf:$false
    } else {
        Write-Host "     Cache des délégations du $([datetime]::Parse($cache.LastUpdated).ToString('dd.MM.yyyy HH:mm')) utilisé." -ForegroundColor Cyan
    }

    $redirVers = @($cache.Redirections | Where-Object { "$($_.Vers)".ToLower() -eq $cible })
    if ($redirVers.Count -gt 0) {
        Add-Journal -Message "ATTENTION : $($redirVers.Count) boîte(s) redirigent vers $Cible :" -Categorie Delegations -Niveau Alerte
        foreach ($r in $redirVers) { Add-Journal -Message "  $($r.Boite) → $($r.Vers)" -Categorie Delegations }
    } else { Add-Journal -Message "$Cible n'était la cible d'aucune redirection." -Categorie Delegations -Niveau Succes }

    $mesDelegs = @($cache.Delegations | Where-Object { "$($_.Qui)".ToLower() -eq $cible })
    if ($mesDelegs.Count -eq 0) { Add-Journal -Message "Aucune délégation trouvée pour $Cible." -Categorie Delegations -Niveau Succes; return }
    Add-Journal -Message "$($mesDelegs.Count) délégation(s) trouvée(s) pour $Cible :" -Categorie Delegations -Niveau Alerte
    foreach ($d in $mesDelegs) {
        try {
            if (Test-Simulation) { Add-Journal -Message "  SIMULATION : retrait $($d.Type) sur $($d.Boite)" -Categorie Delegations; continue }
            switch ($d.Type) {
                'SendOnBehalf' {
                    $actuels = @((Get-Mailbox -Identity $d.Boite).GrantSendOnBehalfTo)
                    $nouveaux = @($actuels | Where-Object { $r = Get-Recipient -Identity "$_" -ErrorAction SilentlyContinue; -not $r -or "$($r.PrimarySmtpAddress)".ToLower() -ne $cible })
                    Set-Mailbox -Identity $d.Boite -GrantSendOnBehalfTo $nouveaux
                }
                'FullAccess' { Remove-MailboxPermission -Identity $d.Boite -User $Cible -AccessRights FullAccess -Confirm:$false | Out-Null }
                'SendAs'     { Remove-RecipientPermission -Identity $d.Boite -Trustee $Cible -AccessRights SendAs -Confirm:$false | Out-Null }
            }
            Add-Journal -Message "  $($d.Type) retirée sur $($d.Boite)" -Categorie Delegations -Niveau Succes
        } catch { Add-Journal -Message "  échec du retrait $($d.Type) sur $($d.Boite) : $($_.Exception.Message)" -Categorie Delegations -Niveau Erreur }
    }
}

function Add-TachePlanner {
    <# La tâche « désactivation » dans le Planner du service IT (application + certificat, tenant Gérofinance). #>
    param([Parameter(Mandatory)] [string] $Titre, [string] $Description = '', [string] $Bureau = '')
    $p = $script:Config.planner
    if (Test-ModeTest -or (Test-Simulation)) { Add-Journal -Message "MODE TEST/SIMULATION : tâche Planner non créée (« $Titre »)." -Categorie Planner -Niveau Alerte; return }
    $tenant = (Get-Societe -Id $p.tenant).tenantId
    $ctx = Get-MgContext -ErrorAction SilentlyContinue
    if (-not $ctx -or $ctx.TenantId -ne $tenant -or $ctx.ClientId -ne $p.appId) {
        Connect-MgGraph -TenantId $tenant -ClientId $p.appId -CertificateThumbprint $p.empreinteCertificat -NoWelcome
    }
    $bucketId = $null
    try {
        $buckets = Invoke-MgGraphRequest -Method GET -Uri "https://graph.microsoft.com/v1.0/planner/plans/$($p.planId)/buckets"
        $b = $buckets.value | Where-Object { $_.name -like "*$($p.compartiment)*" } | Select-Object -First 1
        if ($b) { $bucketId = $b.id }
    } catch { }
    $corps = @{ title = $Titre; planId = $p.planId; description = $Description; dueDateTime = (Get-Date).AddDays([int]$p.echeanceJours).ToString('o') }
    if ($bucketId) { $corps.bucketId = $bucketId }
    if ($p.assigneA) { $corps.assignments = @{ $p.assigneA = @{ '@odata.type' = 'microsoft.graph.plannerAssignment'; orderHint = ' !' } } }
    $cat = $null
    foreach ($k in $p.categoriesParBureau.PSObject.Properties) { if ($Bureau -and $Bureau.ToUpper() -like "*$($k.Name)*") { $cat = $k.Value } }
    if ($cat) { $corps.appliedCategories = @{ $cat = $true } }
    Invoke-MgGraphRequest -Method POST -Uri 'https://graph.microsoft.com/v1.0/planner/tasks' -Body ($corps | ConvertTo-Json -Depth 4) -ContentType 'application/json' | Out-Null
    Add-Journal -Message "Tâche Planner créée : $Titre" -Categorie Planner -Niveau Succes
}

# ====================================================================
#  3CX — CLIENT XAPI
# ====================================================================

function Protect-Secret {
    <# Chiffre pour CETTE machine (DPAPI, portée LocalMachine) : lisible par quiconque y ouvre une session — un contrôleur de domaine n'a que des admins. #>
    param([Parameter(Mandatory)] [string] $Valeur, [Parameter(Mandatory)] [string] $Chemin)
    Add-Type -AssemblyName System.Security
    $octets = [Text.Encoding]::UTF8.GetBytes($Valeur)
    $sceau = [Security.Cryptography.ProtectedData]::Protect($octets, $null, [Security.Cryptography.DataProtectionScope]::LocalMachine)
    New-Item -ItemType Directory -Path (Split-Path $Chemin) -Force -WhatIf:$false | Out-Null
    [IO.File]::WriteAllBytes($Chemin, $sceau)
}

function Unprotect-Secret {
    param([Parameter(Mandatory)] [string] $Chemin)
    if (-not (Test-Path $Chemin)) { throw "Secret introuvable : $Chemin — lancez Set-Secret.ps1 sur cette machine." }
    Add-Type -AssemblyName System.Security
    $sceau = [IO.File]::ReadAllBytes($Chemin)
    $octets = [Security.Cryptography.ProtectedData]::Unprotect($sceau, $null, [Security.Cryptography.DataProtectionScope]::LocalMachine)
    return [Text.Encoding]::UTF8.GetString($octets)
}

function Get-Pbx {
    param([Parameter(Mandatory)] $Societe)
    if (-not $Societe.pbx) { return $null }
    $p = $script:Config.pbx.($Societe.pbx)
    if (-not $p) { throw "PBX « $($Societe.pbx) » absent de config.json." }
    return $p
}

function Connect-Xapi {
    <# Jeton d'application du PBX (client credentials), gardé en session jusqu'à expiration. #>
    param([Parameter(Mandatory)] $Pbx)
    $cle = $Pbx.adresse
    if ($script:Xapi.ContainsKey($cle) -and $script:Xapi[$cle].Expire -gt (Get-Date).AddMinutes(1)) { return $script:Xapi[$cle].Token }
    $secret = Unprotect-Secret -Chemin (Join-Path $script:Dossier $Pbx.fichierSecret)
    $rep = Invoke-RestMethod -Method Post -Uri "$($Pbx.adresse)/connect/token" -ContentType 'application/x-www-form-urlencoded' `
        -Body @{ grant_type = 'client_credentials'; client_id = $Pbx.clientId; client_secret = $secret } -TimeoutSec 20
    if (-not (Get-Prop -Objet $rep -Nom 'access_token')) { throw "Le PBX n'a pas rendu de jeton." }
    $duree = [int](Get-Prop -Objet $rep -Nom 'expires_in' -Defaut 1800)
    $script:Xapi[$cle] = @{ Token = $rep.access_token; Expire = (Get-Date).AddSeconds($duree) }
    return $rep.access_token
}

function Invoke-Xapi {
    <# Un appel XAPI. Les écritures (PATCH/POST/DELETE) sont retenues en simulation et journalisées. #>
    param(
        [Parameter(Mandatory)] $Pbx,
        [ValidateSet('GET', 'POST', 'PATCH', 'DELETE')] [string] $Methode = 'GET',
        [Parameter(Mandatory)] [string] $Chemin,     # ex. "Users?%24top=100"
        $Corps = $null
    )
    if ($Methode -ne 'GET' -and (Test-Simulation)) {
        $apercu = if ($Corps) { ($Corps | ConvertTo-Json -Depth 6 -Compress) } else { '' }
        Add-Journal -Message "SIMULATION 3CX : $Methode $Chemin $apercu" -Categorie 3CX
        return $null
    }
    $token = Connect-Xapi -Pbx $Pbx
    $params = @{ Method = $Methode; Uri = "$($Pbx.adresse)/xapi/v1/$Chemin"; Headers = @{ Authorization = "Bearer $token" }; TimeoutSec = 30 }
    if ($Corps) { $params.Body = ($Corps | ConvertTo-Json -Depth 6); $params.ContentType = 'application/json' }
    return Invoke-RestMethod @params
}

function Get-XapiUtilisateurs {
    <# Tous les utilisateurs du PBX. « Users » ne renvoie pas de nextLink : on avance par $skip, 100 par page. #>
    param([Parameter(Mandatory)] $Pbx)
    $tous = @(); $skip = 0
    do {
        $page = Invoke-Xapi -Pbx $Pbx -Chemin "Users?%24top=100&%24skip=$skip&%24select=Id,Number,FirstName,LastName,DisplayName,EmailAddress,Enabled,PrimaryGroupId"
        $lot = @($page.value); $tous += $lot; $skip += 100
    } while ($lot.Count -eq 100 -and $skip -lt 5000)
    return $tous
}

function Find-XapiUtilisateurParEmail {
    param([Parameter(Mandatory)] $Pbx, [Parameter(Mandatory)] [string] $Email)
    $e = $Email.Replace("'", "''")
    $rep = Invoke-Xapi -Pbx $Pbx -Chemin "Users?%24filter=EmailAddress%20eq%20'$([uri]::EscapeDataString($e))'&%24select=Id,Number,FirstName,LastName,DisplayName,EmailAddress,Enabled"
    return @($rep.value)
}

function Get-XapiPostesLibres {
    <# Candidats à la réaffectation : postes désactivés, ou nommés « libre » (motif de config), filtrés par préfixe de site si connu. #>
    param([Parameter(Mandatory)] $Pbx, [string] $Prefixe = '')
    $motif = $Pbx.motifPosteLibre
    $tous = Get-XapiUtilisateurs -Pbx $Pbx
    $libres = @($tous | Where-Object { ($_.Enabled -eq $false) -or ("$($_.DisplayName)" -match $motif) })
    if ($Prefixe) { $libres = @($libres | Where-Object { "$($_.Number)".StartsWith($Prefixe) }) }
    return @($libres | Sort-Object { [int]("$($_.Number)" -replace '\D', '0') } | Select-Object Number, DisplayName, EmailAddress, Enabled, Id)
}

function Get-XapiFiles {
    <# Toutes les files avec leurs agents. #>
    param([Parameter(Mandatory)] $Pbx)
    $tous = @(); $url = "Queues?%24top=100&%24expand=Agents&%24select=Id,Number,Name"
    for ($i = 0; $url -and $i -lt 25; $i++) {
        $page = Invoke-Xapi -Pbx $Pbx -Chemin $url
        $tous += @($page.value)
        $suivant = Get-Prop -Objet $page -Nom '@odata.nextLink'
        $url = if ($suivant) { "$suivant" -replace '^.*?/xapi/v1/', '' } else { $null }
    }
    return $tous
}

function Get-XapiFilesDuPoste {
    param([Parameter(Mandatory)] $Pbx, [Parameter(Mandatory)] [string] $Numero)
    return @(Get-XapiFiles -Pbx $Pbx | Where-Object { @($_.Agents | ForEach-Object { "$($_.Number)" }) -contains $Numero })
}

function Set-XapiAgentsDeFile {
    <# Remplace la liste des agents d'une file (PATCH). On envoie TOUJOURS la liste complète : le PBX ne fait pas de diff. #>
    param([Parameter(Mandatory)] $Pbx, [Parameter(Mandatory)] $File, [Parameter(Mandatory)] [object[]] $Agents)
    $corps = @{ Agents = @($Agents | ForEach-Object { @{ Number = "$($_.Number)"; SkillGroup = $(if ($_.SkillGroup) { "$($_.SkillGroup)" } else { "$($Pbx.skillGroupParDefaut)" }) } }) }
    Invoke-Xapi -Pbx $Pbx -Methode PATCH -Chemin "Queues($($File.Id))" -Corps $corps | Out-Null
}

function Remove-XapiPosteDesFiles {
    <# Retire un poste de toutes ses files ; rend les files touchées. #>
    param([Parameter(Mandatory)] $Pbx, [Parameter(Mandatory)] [string] $Numero)
    $files = Get-XapiFilesDuPoste -Pbx $Pbx -Numero $Numero
    foreach ($f in $files) {
        $restants = @($f.Agents | Where-Object { "$($_.Number)" -ne $Numero })
        Set-XapiAgentsDeFile -Pbx $Pbx -File $f -Agents $restants
        Add-Journal -Message "Poste $Numero retiré de la file $($f.Number) « $($f.Name) »" -Categorie 3CX -Niveau Succes
    }
    return $files
}

function Add-XapiPosteAuxFiles {
    param([Parameter(Mandatory)] $Pbx, [Parameter(Mandatory)] [string] $Numero, [Parameter(Mandatory)] [object[]] $Files)
    $toutes = Get-XapiFiles -Pbx $Pbx
    foreach ($choisie in $Files) {
        $f = $toutes | Where-Object { $_.Id -eq $choisie.Id } | Select-Object -First 1
        if (-not $f) { continue }
        if (@($f.Agents | ForEach-Object { "$($_.Number)" }) -contains $Numero) { Add-Journal -Message "Poste $Numero déjà dans la file $($f.Number)" -Categorie 3CX; continue }
        $agents = @($f.Agents) + @([pscustomobject]@{ Number = $Numero; SkillGroup = $Pbx.skillGroupParDefaut })
        Set-XapiAgentsDeFile -Pbx $Pbx -File $f -Agents $agents
        Add-Journal -Message "Poste $Numero ajouté à la file $($f.Number) « $($f.Name) »" -Categorie 3CX -Niveau Succes
    }
}

function Set-XapiPoste {
    <# Modifie un utilisateur du PBX (PATCH Users({Id})). #>
    param([Parameter(Mandatory)] $Pbx, [Parameter(Mandatory)] [int] $Id, [Parameter(Mandatory)] [hashtable] $Proprietes)
    Invoke-Xapi -Pbx $Pbx -Methode PATCH -Chemin "Users($Id)" -Corps $Proprietes | Out-Null
}

function Get-XapiSdaVersPoste {
    <# Règles entrantes (SDA) dont une destination vise ce poste. Version 1 : on LISTE, on ne réécrit pas. #>
    param([Parameter(Mandatory)] $Pbx, [Parameter(Mandatory)] [string] $Numero)
    $tous = @(); $skip = 0
    do {
        $page = Invoke-Xapi -Pbx $Pbx -Chemin "InboundRules?%24top=100&%24skip=$skip"
        $lot = @($page.value); $tous += $lot; $skip += 100
    } while ($lot.Count -eq 100 -and $skip -lt 5000)
    $motif = '"' + [regex]::Escape($Numero) + '"'
    return @($tous | Where-Object { ($_ | ConvertTo-Json -Depth 6 -Compress) -match $motif } | Select-Object RuleName, Data, TrunkDN)
}

# ====================================================================
#  RAPPORT ET MAIL
# ====================================================================

function ConvertTo-RapportHtml {
    param([Parameter(Mandatory)] [string] $Titre, [string] $EnTete = '')
    $sb = New-Object Text.StringBuilder
    [void]$sb.Append("<html><body style='font-family:Arial,sans-serif;font-size:14px'><h1 style='color:#00B400;font-size:22px'>$Titre</h1>$EnTete")
    [void]$sb.Append("<p>Date : $(Get-Date -Format 'dd.MM.yyyy HH:mm') · Opérateur : $($script:Session.Operateur)")
    if (Test-Simulation) { [void]$sb.Append(" · <b style='color:#b45309'>SIMULATION</b>") }
    [void]$sb.Append("</p><h2 style='color:#0000ff;font-size:16px'>Étapes</h2><table style='border-collapse:collapse'>")
    foreach ($e in $script:Etapes) {
        $c = switch ($e.Etat) { 'ok' { '#16a34a' } 'echec' { '#dc2626' } default { '#94a3b8' } }
        $s = switch ($e.Etat) { 'ok' { '&#10003;' } 'echec' { '&#10007;' } default { '&ndash;' } }
        [void]$sb.Append("<tr><td style='color:$c;padding:2px 8px'>$s</td><td style='padding:2px 8px'>$([Net.WebUtility]::HtmlEncode($e.Nom))</td><td style='color:#64748b;padding:2px 8px'>$($e.Detail)</td></tr>")
    }
    [void]$sb.Append("</table>")
    foreach ($cat in @('General', 'AD', 'Groupes', '3CX', 'Exchange', 'Licences', 'Delegations', 'Planner')) {
        $lignes = @($script:Journal | Where-Object { $_.Categorie -eq $cat })
        if ($lignes.Count -eq 0) { continue }
        [void]$sb.Append("<h2 style='color:#0000ff;font-size:16px'>$cat</h2><p>")
        foreach ($l in $lignes) {
            $c = switch ($l.Niveau) { 'Succes' { '#16a34a' } 'Alerte' { '#d97706' } 'Erreur' { '#dc2626' } default { '#334155' } }
            [void]$sb.Append("<span style='color:$c'>&#9679;</span> $([Net.WebUtility]::HtmlEncode($l.Message))<br>")
        }
        [void]$sb.Append("</p>")
    }
    [void]$sb.Append("</body></html>")
    return $sb.ToString()
}

function Send-Rapport {
    <# Envoi au helpdesk — ou, en MODE TEST, à l'adresse de test avec le sujet préfixé. #>
    param([Parameter(Mandatory)] [string] $Sujet, [Parameter(Mandatory)] [string] $Html)
    if (-not $script:Reglages.EnvoyerMail) { Add-Journal -Message "Mail non envoyé (EnvoyerMail = false)." -Niveau Alerte; return }
    $m = $script:Config.mail
    $vers = $m.helpdesk; $s = $Sujet
    if (Test-ModeTest) { $vers = $script:Reglages.DestinataireTest; $s = "[TEST] $Sujet" }
    if (Test-Simulation) { $s = "[SIMULATION] $s" }
    $mail = New-Object Net.Mail.MailMessage
    $mail.From = $m.expediteur; $mail.To.Add($vers); $mail.Subject = $s; $mail.IsBodyHtml = $true; $mail.Body = $Html
    $mail.BodyEncoding = [Text.Encoding]::UTF8; $mail.SubjectEncoding = [Text.Encoding]::UTF8
    (New-Object Net.Mail.SmtpClient($m.smtp)).Send($mail)
    Add-Journal -Message "Rapport envoyé à $vers." -Niveau Succes
}

function Save-Rapport {
    <# Le rapport en JSON (pour le futur portail) et en texte lisible, dans le dossier de logs. #>
    param([Parameter(Mandatory)] [string] $Nom, [Parameter(Mandatory)] [string] $Html, $Donnees = $null)
    $base = Join-Path $script:Reglages.DossierLogs ("{0}-{1}" -f (Get-Date -Format 'yyyyMMdd-HHmm'), ($Nom -replace '[^A-Za-z0-9_.-]', '_'))
    $objet = [pscustomobject]@{
        Quand = (Get-Date).ToString('o'); Operateur = $script:Session.Operateur
        Simulation = (Test-Simulation); ModeTest = (Test-ModeTest)
        Donnees = $Donnees; Etapes = @($script:Etapes); Journal = @($script:Journal)
    }
    $objet | ConvertTo-Json -Depth 6 | Set-Content -Path "$base.json" -Encoding UTF8 -WhatIf:$false
    Set-Content -Path "$base.html" -Value $Html -Encoding UTF8 -WhatIf:$false
    Add-Journal -Message "Rapport enregistré : $base.json" -Niveau Info
    return "$base.json"
}

function Complete-Session {
    Show-Checklist
    try { Stop-Transcript | Out-Null } catch { }
}

Export-ModuleMember -Function *
