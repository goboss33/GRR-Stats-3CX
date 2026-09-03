#Requires -Version 5.1
<#
    MODULE COMMUN — entrée et sortie des collaborateurs.

    Ce que les deux anciens scripts dupliquaient vit ici une seule fois :
    la configuration, l'interface, le journal et les étapes, le mail, les
    connexions (AD, Exchange Online, Graph), le client XAPI du 3CX et le
    coffre des secrets. Les scripts eux-mêmes ne sont plus que des assistants.

    DEUX RÈGLES QUI NE SE DISCUTENT PAS :

    1. Toute écriture — AD, Exchange, Graph, 3CX, Planner — passe par
       Invoke-Ecriture. En simulation elle est DÉCRITE, jamais exécutée.
       On ne s'appuie plus sur $WhatIfPreference : les cmdlets Exchange
       Online l'ignorent (elles affichent « WhatIf : » et écrivent quand même,
       constaté le 03.09.2026 sur une vraie boîte).

    2. L'interface passe par les fonctions Show-* et Read-* : PwshSpectreConsole
       quand PowerShell 7 et le module sont là, console nue sinon. Les scripts
       ne connaissent ni l'un ni l'autre.

    Compatible Windows PowerShell 5.1 (interface nue) et PowerShell 7
    (interface complète). Pas d'opérateur ?? ni ternaire, pas de -AsHashtable.
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
$script:Session     = @{ Operateur = $env:USERNAME; Debut = Get-Date; Transcription = $null; M365 = $null }
$script:Ui          = @{ Spectre = $false; Tampon = $null; Statut = $null; Resultat = $null; ParamInvite = @{}; Avertissements = @{} }

$script:Categories  = @('AD', 'Groupes', 'Exchange', 'Licences', 'Delegations', '3CX', 'Planner', 'General')

# ====================================================================
#  CONFIGURATION ET RÉGLAGES
# ====================================================================

function Initialize-Collaborateurs {
    <#
      Charge la configuration, applique les réglages du script appelant,
      ouvre le dossier de logs et la transcription, choisit l'interface.
      À appeler en premier.
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
    New-Item -ItemType Directory -Path $Reglages.DossierLogs -Force | Out-Null

    # La simulation ne repose PLUS sur WhatIf (voir l'en-tête). On le dit
    # explicitement pour qu'aucun réglage hérité de la console ne s'invite.
    $global:WhatIfPreference = $false

    Initialize-Interface

    $horodatage = Get-Date -Format 'yyyyMMdd-HHmmss'
    $script:Session.Transcription = Join-Path $Reglages.DossierLogs "$Operation-$horodatage-transcription.txt"
    try { Start-Transcript -Path $script:Session.Transcription -Append | Out-Null } catch { }

    Show-EnTete -Titre $(if ($Operation -eq 'entree') { "Entrée d'un collaborateur" } else { "Sortie d'un collaborateur" })
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

function Get-MessageErreur {
    <# Le vrai message, débarrassé des enveloppes « Exception calling … » que .NET et Spectre ajoutent. #>
    param([Parameter(Mandatory)] $Erreur)
    $ex = if ($Erreur -is [Exception]) { $Erreur } else { $Erreur.Exception }
    while ($ex -and $ex.InnerException -and ($ex -is [Management.Automation.MethodInvocationException] -or $ex.Message -like 'Exception calling*' -or $ex -is [AggregateException])) { $ex = $ex.InnerException }
    if ($ex) { return $ex.Message }
    return "$Erreur"
}

# ====================================================================
#  INTERFACE — Spectre quand c'est possible, console nue sinon
# ====================================================================

function Initialize-Interface {
    $script:Ui.Spectre = $false
    try { [Console]::OutputEncoding = [Text.Encoding]::UTF8; [Console]::InputEncoding = [Text.Encoding]::UTF8 } catch { }
    if ($PSVersionTable.PSVersion.Major -lt 7 -or $env:COLLABORATEURS_SANS_SPECTRE) { return }
    $m = Get-Module -ListAvailable PwshSpectreConsole -ErrorAction SilentlyContinue | Sort-Object Version -Descending | Select-Object -First 1
    if (-not $m -or $m.Version -lt [version]'2.0') { return }
    try { Import-Module PwshSpectreConsole -MinimumVersion 2.0 -ErrorAction Stop; $script:Ui.Spectre = $true } catch { }
}

function Test-Spectre { return [bool]$script:Ui.Spectre }

function Protect-Texte {
    <# Échappe les crochets : Spectre lit [ceci] comme du balisage. À appliquer à TOUTE donnée affichée. #>
    param([AllowNull()] [AllowEmptyString()] [string] $Texte)
    if ($null -eq $Texte) { return '' }
    return $Texte.Replace('[', '[[').Replace(']', ']]')
}

function Get-NomInvite {
    <# Le paramètre « question » des invites Spectre a changé de nom entre versions (Title → Message). #>
    param([Parameter(Mandatory)] [string] $Commande)
    if (-not $script:Ui.ParamInvite.ContainsKey($Commande)) {
        $p = (Get-Command $Commande -ErrorAction Stop).Parameters
        $script:Ui.ParamInvite[$Commande] = if ($p.ContainsKey('Message')) { 'Message' } elseif ($p.ContainsKey('Title')) { 'Title' } else { 'Prompt' }
    }
    return $script:Ui.ParamInvite[$Commande]
}

function Invoke-Rendu {
    <#
      Exécute la version Spectre si l'interface complète est là, la version
      nue sinon. Si Spectre échoue (paramètre inconnu selon la version…), on
      bascule sur la version nue et on le dit UNE fois : le script continue.
    #>
    param([Parameter(Mandatory)] [scriptblock] $Spectre, [Parameter(Mandatory)] [scriptblock] $Repli, [string] $Composant = 'composant')
    if (Test-Spectre) {
        try { return & $Spectre }
        catch {
            if (-not $script:Ui.Avertissements.ContainsKey($Composant)) {
                $script:Ui.Avertissements[$Composant] = $true
                Write-Host "  (interface Spectre indisponible pour « $Composant » : $(Get-MessageErreur $_) — affichage simple)" -ForegroundColor DarkYellow
            }
        }
    }
    return & $Repli
}

function Out-Rendu {
    <# Affiche un objet Spectre (table, panneau…) quel que soit le mode de sortie. #>
    param([Parameter(Mandatory, ValueFromPipeline)] $Rendu)
    process {
        if (Get-Command Out-SpectreHost -ErrorAction SilentlyContinue) { $Rendu | Out-SpectreHost } else { $Rendu | Out-Host }
    }
}

function Show-EnTete {
    param([Parameter(Mandatory)] [string] $Titre)
    $r = $script:Reglages
    $etiquettes = @()
    if ($r.Simulation) { $etiquettes += @{ Texte = 'SIMULATION — aucune écriture, tout est décrit'; Fond = 'yellow'; Encre = 'black'; Console = 'Yellow' } }
    else               { $etiquettes += @{ Texte = 'ACTIONS RÉELLES'; Fond = 'red'; Encre = 'white'; Console = 'Red' } }
    if ($r.ModeTest)   { $etiquettes += @{ Texte = "MODE TEST — mails vers $($r.DestinataireTest), pas de tâche Planner"; Fond = 'cyan'; Encre = 'black'; Console = 'Cyan' } }
    $sousTitre = "Service Informatique · opérateur $($script:Session.Operateur) · $(Get-Date -Format 'dd.MM.yyyy HH:mm') · PowerShell $($PSVersionTable.PSVersion)"
    Invoke-Rendu -Composant 'en-tête' -Spectre {
        $lignes = @("[bold white]$(Protect-Texte $Titre)[/]", "[grey]$(Protect-Texte $sousTitre)[/]", '')
        foreach ($e in $etiquettes) { $lignes += "[$($e.Encre) on $($e.Fond)] $(Protect-Texte $e.Texte) [/]" }
        Format-SpectrePanel -Data ($lignes -join "`n") -Border Rounded -Color Grey -Expand | Out-Rendu
    } -Repli {
        $ligne = '=' * 72
        Write-Host $ligne -ForegroundColor DarkGray
        Write-Host "  $Titre" -ForegroundColor White
        Write-Host "  $sousTitre" -ForegroundColor DarkGray
        foreach ($e in $etiquettes) { Write-Host "  $($e.Texte)" -ForegroundColor $e.Console }
        Write-Host $ligne -ForegroundColor DarkGray
    }
}

function Show-Section {
    param([Parameter(Mandatory)] [string] $Titre)
    Invoke-Rendu -Composant 'section' -Spectre {
        Write-SpectreHost ''
        Write-SpectreRule -Title "[bold white]$(Protect-Texte $Titre)[/]" -Alignment Left -Color Grey
    } -Repli {
        Write-Host ''
        Write-Host "── $Titre " -ForegroundColor Cyan -NoNewline
        Write-Host ('─' * [math]::Max(4, 68 - $Titre.Length)) -ForegroundColor DarkGray
    }
}

function Show-Note {
    <# Une ligne d'information hors journal. Niveau : Info | Sourdine | Succes | Alerte | Erreur #>
    param([Parameter(Mandatory)] [AllowEmptyString()] [string] $Texte, [ValidateSet('Info', 'Sourdine', 'Succes', 'Alerte', 'Erreur')] [string] $Niveau = 'Info')
    $couleurSpectre = switch ($Niveau) { 'Sourdine' { 'grey' } 'Succes' { 'green' } 'Alerte' { 'yellow' } 'Erreur' { 'red' } default { 'white' } }
    $couleurConsole = switch ($Niveau) { 'Sourdine' { 'DarkGray' } 'Succes' { 'Green' } 'Alerte' { 'Yellow' } 'Erreur' { 'Red' } default { 'Gray' } }
    Invoke-Rendu -Composant 'note' -Spectre { Write-SpectreHost "  [$couleurSpectre]$(Protect-Texte $Texte)[/]" } -Repli { Write-Host "  $Texte" -ForegroundColor $couleurConsole }
}

function Show-Tableau {
    <# Des objets en tableau ; -Colonnes = propriétés affichées, dans l'ordre. #>
    param([Parameter(Mandatory)] [AllowEmptyCollection()] [object[]] $Lignes, [string[]] $Colonnes, [string] $Titre = '')
    if (-not $Lignes -or $Lignes.Count -eq 0) { return }
    $vue = if ($Colonnes) { @($Lignes | Select-Object -Property $Colonnes) } else { @($Lignes) }
    Invoke-Rendu -Composant 'tableau' -Spectre {
        $p = @{ Data = $vue; Border = 'Rounded'; Color = 'Grey' }
        if ($Titre) { $p.Title = "[grey]$(Protect-Texte $Titre)[/]" }
        Format-SpectreTable @p | Out-Rendu
    } -Repli {
        if ($Titre) { Write-Host "  $Titre" -ForegroundColor Cyan }
        $vue | Format-Table -AutoSize | Out-String -Width 200 | ForEach-Object { $_.TrimEnd() } | Where-Object { $_ } | ForEach-Object { Write-Host "  $_" }
    }
}

function Show-Recap {
    <# Un récapitulatif clé → valeur, avant la confirmation. #>
    param([Parameter(Mandatory)] [System.Collections.Specialized.OrderedDictionary] $Paires, [string] $Titre = 'Récapitulatif')
    Invoke-Rendu -Composant 'récapitulatif' -Spectre {
        $lignes = @()
        foreach ($k in $Paires.Keys) { $lignes += [pscustomobject]@{ Champ = "[grey]$(Protect-Texte $k)[/]"; Valeur = "[white]$(Protect-Texte "$($Paires[$k])")[/]" } }
        Format-SpectreTable -Data $lignes -Border Rounded -Color Grey -HideHeaders -AllowMarkup -Title "[bold white]$(Protect-Texte $Titre)[/]" | Out-Rendu
    } -Repli {
        Write-Host ''
        Write-Host "  $Titre" -ForegroundColor Cyan
        foreach ($k in $Paires.Keys) { Write-Host ("  {0,-24} {1}" -f $k, $Paires[$k]) }
        Write-Host ''
    }
}

function Show-Panneau {
    <# Un bloc de texte encadré (aperçu d'un message, mot de passe…). #>
    param([Parameter(Mandatory)] [AllowEmptyString()] [string] $Texte, [string] $Titre = '', [string] $Couleur = 'Grey')
    Invoke-Rendu -Composant 'panneau' -Spectre {
        $p = @{ Data = (Protect-Texte $Texte); Border = 'Rounded'; Color = $Couleur }
        if ($Titre) { $p.Title = "[grey]$(Protect-Texte $Titre)[/]" }
        Format-SpectrePanel @p | Out-Rendu
    } -Repli {
        Write-Host ''
        if ($Titre) { Write-Host "  ┌─ $Titre" -ForegroundColor DarkGray }
        foreach ($l in ($Texte -split "`r?`n")) { Write-Host "  │ $l" }
        Write-Host "  └─" -ForegroundColor DarkGray
    }
}

function Read-Texte {
    param([Parameter(Mandatory)] [string] $Invite, [string] $Defaut = '', [switch] $Obligatoire, [switch] $QuitteSurQ)
    do {
        $valeur = Invoke-Rendu -Composant 'saisie' -Spectre {
            $p = @{ AllowEmpty = (-not $Obligatoire) }
            $p[(Get-NomInvite 'Read-SpectreText')] = "[bold]$(Protect-Texte $Invite)[/]"
            if ($Defaut) { $p.DefaultAnswer = $Defaut }
            "$(Read-SpectreText @p)"
        } -Repli {
            $affichage = if ($Defaut) { "$Invite [$Defaut]" } else { $Invite }
            "$(Read-Host $affichage)"
        }
        if ($null -eq $valeur) { $valeur = '' }
        $valeur = $valeur.Trim()
        if ($QuitteSurQ -and $valeur -eq 'q') { Stop-Script }
        if (-not $valeur -and $Defaut) { $valeur = $Defaut }
        if ($Obligatoire -and -not $valeur) { Show-Note 'Valeur obligatoire.' -Niveau Alerte }
    } while ($Obligatoire -and -not $valeur)
    return $valeur
}

function Read-TexteMultiligne {
    <#
      Un bloc de texte tapé ou COLLÉ dans le terminal. Fin de saisie : deux
      lignes vides d'affilée (Entrée, Entrée) ou une ligne ne contenant qu'un
      point. Les lignes vides isolées (paragraphes) sont conservées.
    #>
    param([Parameter(Mandatory)] [string] $Invite)
    Show-Note $Invite
    Show-Note 'Tapez ou collez le texte. Pour terminer : deux fois Entrée sur une ligne vide, ou un point seul.' -Niveau Sourdine
    $lignes = New-Object System.Collections.ArrayList
    $vides = 0
    while ($true) {
        # Read-Host plutôt que [Console]::ReadLine : même tampon d'entrée que les autres questions.
        $l = try { Read-Host } catch { $null }
        if ($null -eq $l) { break }
        $l = "$l"
        if ($l.Trim() -eq '.') { break }
        if ($l.Trim() -eq '') {
            $vides++
            if ($vides -ge 2) { break }
            [void]$lignes.Add('')
            continue
        }
        $vides = 0
        [void]$lignes.Add($l.TrimEnd())
    }
    while ($lignes.Count -gt 0 -and $lignes[$lignes.Count - 1] -eq '') { $lignes.RemoveAt($lignes.Count - 1) }
    return (@($lignes) -join "`n")
}

function Confirm-Choix {
    param([Parameter(Mandatory)] [string] $Question, [switch] $DefautOui)
    return [bool](Invoke-Rendu -Composant 'confirmation' -Spectre {
        $p = @{ DefaultAnswer = $(if ($DefautOui) { 'y' } else { 'n' }) }
        $p[(Get-NomInvite 'Read-SpectreConfirm')] = "[bold]$(Protect-Texte $Question)[/]"
        [bool](Read-SpectreConfirm @p)
    } -Repli {
        $suffixe = if ($DefautOui) { '(O/n)' } else { '(o/N)' }
        $r = Read-Host "$Question $suffixe"
        if (-not $r) { [bool]$DefautOui } else { [bool]($r -match '^[oOyY]') }
    })
}

function Read-Choix {
    <#
      Un choix parmi des objets, au clavier (flèches + recherche avec Spectre,
      numéros sinon). -Libelle : scriptblock qui rend le texte d'une ligne à
      partir de l'objet ($_) ; à défaut -Colonnes, jointes par « · ».
      -Multiple : sélection multiple (rend un tableau).
      Sans -SansAnnulation, une entrée « Annuler » ferme le script.
    #>
    param(
        [Parameter(Mandatory)] [string]   $Titre,
        [Parameter(Mandatory)] [AllowEmptyCollection()] [object[]] $Elements,
        [scriptblock] $Libelle,
        [string[]]    $Colonnes,
        [switch]      $Multiple,
        [switch]      $SansAnnulation
    )
    if (-not $Elements -or $Elements.Count -eq 0) { throw "Rien à choisir pour « $Titre »." }
    $textes = @()
    for ($i = 0; $i -lt $Elements.Count; $i++) {
        $e = $Elements[$i]
        $t = if ($Libelle) { "$(ForEach-Object -InputObject $e -Process $Libelle)" }
             elseif ($Colonnes) { (@($Colonnes | ForEach-Object { "$($e.$_)" }) | Where-Object { $_ }) -join '  ·  ' }
             else { "$e" }
        $textes += $t
    }
    # Libellés uniques : c'est par eux qu'on retrouve l'objet choisi.
    $vus = @{}
    for ($i = 0; $i -lt $textes.Count; $i++) {
        if ($vus.ContainsKey($textes[$i])) { $textes[$i] = "$($textes[$i])  ($($i + 1))" }
        $vus[$textes[$i]] = $i
    }
    $annuler = '← Annuler et quitter'

    $indices = Invoke-Rendu -Composant 'sélection' -Spectre {
        $affiches = @($textes | ForEach-Object { Protect-Texte $_ })
        if ($Multiple) {
            $p = @{ Choices = $affiches; PageSize = 18; Color = 'DeepSkyBlue1' }
            $p[(Get-NomInvite 'Read-SpectreMultiSelection')] = "[bold]$(Protect-Texte $Titre)[/]  [grey](espace pour cocher, Entrée pour valider)[/]"
            $retenus = @(Read-SpectreMultiSelection @p)
            @($retenus | ForEach-Object { [array]::IndexOf($affiches, "$_") } | Where-Object { $_ -ge 0 })
        } else {
            $liste = @($affiches); if (-not $SansAnnulation) { $liste += $annuler }
            $p = @{ Choices = $liste; PageSize = 18; Color = 'DeepSkyBlue1'; EnableSearch = ($liste.Count -gt 6) }
            $p[(Get-NomInvite 'Read-SpectreSelection')] = "[bold]$(Protect-Texte $Titre)[/]"
            $retenu = "$(Read-SpectreSelection @p)"
            if ($retenu -eq $annuler) { @(-1) } else { @([array]::IndexOf($affiches, $retenu)) }
        }
    } -Repli {
        Write-Host ''
        Write-Host "  $Titre" -ForegroundColor Cyan
        for ($i = 0; $i -lt $textes.Count; $i++) { Write-Host ("  {0,3}) {1}" -f ($i + 1), $textes[$i]) }
        do {
            $saisie = Read-Host $(if ($Multiple) { '  Numéros séparés par des virgules (q pour quitter)' } else { '  Numéro (q pour quitter)' })
            if ($saisie -eq 'q') { @(-1); break }
            $nums = @($saisie -split '[,; ]+' | Where-Object { $_ -match '^\d+$' } | ForEach-Object { [int]$_ - 1 } | Where-Object { $_ -ge 0 -and $_ -lt $textes.Count })
        } while ($nums.Count -eq 0)
        if ($saisie -ne 'q') { @($nums) }
    }
    $indices = @($indices)
    if ($indices.Count -eq 0 -or $indices[0] -lt 0) {
        if ($Multiple) { return @() }
        Stop-Script
    }
    $retour = @($indices | ForEach-Object { $Elements[$_] })
    if ($Multiple) { return $retour }
    return $retour[0]
}

function Invoke-Attente {
    <# Un travail qui dure (lecture du PBX, connexion…) : un indicateur d'activité, puis le résultat. #>
    param([Parameter(Mandatory)] [string] $Titre, [Parameter(Mandatory)] [scriptblock] $Action)
    if (-not (Test-Spectre)) {
        Write-Host "  … $Titre" -ForegroundColor DarkGray
        return & $Action
    }
    # Le journal attend la fin de l'indicateur, sinon il s'écrit par-dessus.
    $script:Ui.Tampon = New-Object System.Collections.ArrayList
    $act = $Action
    # Le résultat passe par l'état du module : on ne dépend pas de ce que Spectre rend.
    $script:Ui.Resultat = $null
    try {
        Invoke-SpectreCommandWithStatus -Title (Protect-Texte $Titre) -Spinner Line -Color DeepSkyBlue1 -ScriptBlock { param($ctx) $script:Ui.Statut = $ctx; $script:Ui.Resultat = & $act } | Out-Null
        return $script:Ui.Resultat
    } catch {
        throw (Get-MessageErreur $_)
    } finally {
        $script:Ui.Statut = $null; $script:Ui.Resultat = $null
        $tampon = @($script:Ui.Tampon); $script:Ui.Tampon = $null
        foreach ($l in $tampon) { Write-LigneJournal -Ligne $l }
    }
}

function Update-Statut {
    <# Met à jour le texte de l'indicateur d'activité (Spectre) ou une barre de progression (console nue). #>
    param([Parameter(Mandatory)] [string] $Texte, [int] $Pourcent = -1)
    if ($script:Ui.Statut) { try { $script:Ui.Statut.Status = (Protect-Texte $Texte) } catch { } ; return }
    if ($Pourcent -ge 0) { Write-Progress -Activity $Texte -PercentComplete $Pourcent } else { Write-Progress -Activity $Texte }
}

function Stop-Script {
    Show-Note 'Fermeture du script.' -Niveau Sourdine
    Disconnect-M365
    try { Stop-Transcript | Out-Null } catch { }
    exit
}

# ====================================================================
#  JOURNAL, ÉCRITURES ET ÉTAPES
# ====================================================================

function Add-Journal {
    <# Une ligne du rapport final, rangée par catégorie. Niveau : Info | Succes | Alerte | Erreur | Simule #>
    param(
        [Parameter(Mandatory)] [string] $Message,
        [ValidateSet('AD', 'Groupes', 'Exchange', 'Licences', 'Delegations', '3CX', 'Planner', 'General')] [string] $Categorie = 'General',
        [ValidateSet('Info', 'Succes', 'Alerte', 'Erreur', 'Simule')] [string] $Niveau = 'Info'
    )
    $ligne = [pscustomobject]@{ Quand = Get-Date; Categorie = $Categorie; Niveau = $Niveau; Message = $Message }
    [void] $script:Journal.Add($ligne)
    # Pendant une étape, l'affichage attend la fin de l'indicateur d'activité.
    if ($null -ne $script:Ui.Tampon) { [void] $script:Ui.Tampon.Add($ligne); return }
    Write-LigneJournal -Ligne $ligne
}

function Write-LigneJournal {
    param([Parameter(Mandatory)] $Ligne)
    $spectre = switch ($Ligne.Niveau) { 'Succes' { 'green' } 'Alerte' { 'yellow' } 'Erreur' { 'red' } 'Simule' { 'orange1' } default { 'grey' } }
    $console = switch ($Ligne.Niveau) { 'Succes' { 'Green' } 'Alerte' { 'Yellow' } 'Erreur' { 'Red' } 'Simule' { 'DarkYellow' } default { 'DarkGray' } }
    $puce    = switch ($Ligne.Niveau) { 'Succes' { '+' } 'Alerte' { '!' } 'Erreur' { 'x' } 'Simule' { '>' } default { '·' } }
    $texte = $Ligne.Message
    Invoke-Rendu -Composant 'journal' -Spectre { Write-SpectreHost "       [$spectre]$puce $(Protect-Texte $texte)[/]" } -Repli { Write-Host "       $puce $texte" -ForegroundColor $console }
}

function Invoke-Ecriture {
    <#
      LA porte unique des écritures. En simulation : la description va au
      journal, l'action n'est pas exécutée. Sinon : l'action est exécutée et
      son résultat rendu. Aucune cmdlet n'écrit ailleurs qu'ici.
    #>
    param(
        [Parameter(Mandatory)] [string]      $Description,   # ce qui serait fait, en clair : « Set-Mailbox x -Type Shared »
        [Parameter(Mandatory)] [scriptblock] $Action,
        [ValidateSet('AD', 'Groupes', 'Exchange', 'Licences', 'Delegations', '3CX', 'Planner', 'General')] [string] $Categorie = 'General'
    )
    if (Test-Simulation) {
        Add-Journal -Message "SIMULATION : $Description" -Categorie $Categorie -Niveau Simule
        return $null
    }
    return & $Action
}

function Invoke-Etape {
    <#
      Exécute UNE étape de la checklist, avec son try/catch, sa durée, son
      verdict. Une étape critique qui échoue arrête tout ; une étape
      secondaire note l'échec et laisse continuer.
    #>
    param(
        [Parameter(Mandatory)] [string]      $Nom,
        [Parameter(Mandatory)] [scriptblock] $Action,
        [ValidateSet('AD', 'Groupes', 'Exchange', 'Licences', 'Delegations', '3CX', 'Planner', 'General')] [string] $Categorie = 'General',
        [switch] $Critique,
        [switch] $Ignorer        # déjà décidé de ne pas la faire (réglage éteint, rien à faire)
    )
    $etape = [pscustomobject]@{ Nom = $Nom; Categorie = $Categorie; Etat = 'ignoree'; Duree = 0; Detail = '' }
    [void] $script:Etapes.Add($etape)
    if ($Ignorer) {
        Invoke-Rendu -Composant 'étape' -Spectre { Write-SpectreHost "  [grey]  --   $(Protect-Texte $Nom)   ignorée[/]" } -Repli { Write-Host ("  [--] {0}" -f $Nom) -ForegroundColor DarkGray }
        return $null
    }
    $script:Ui.Tampon = New-Object System.Collections.ArrayList
    $chrono = [Diagnostics.Stopwatch]::StartNew()
    $resultat = $null; $erreur = $null
    try {
        if (Test-Spectre) {
            $act = $Action
            $script:Ui.Resultat = $null
            try {
                Invoke-SpectreCommandWithStatus -Title (Protect-Texte $Nom) -Spinner Line -Color DeepSkyBlue1 -ScriptBlock { param($ctx) $script:Ui.Statut = $ctx; $script:Ui.Resultat = & $act } | Out-Null
                $resultat = $script:Ui.Resultat
            } finally { $script:Ui.Statut = $null; $script:Ui.Resultat = $null }
        } else {
            Write-Host ("  [..] {0}" -f $Nom) -ForegroundColor Gray
            $resultat = & $Action
        }
    } catch { $erreur = Get-MessageErreur $_ }
    $chrono.Stop()
    $etape.Duree = [math]::Round($chrono.Elapsed.TotalSeconds, 1)
    $tampon = @($script:Ui.Tampon); $script:Ui.Tampon = $null
    $simule = @($tampon | Where-Object { $_.Niveau -eq 'Simule' }).Count -gt 0
    if ($erreur) {
        $etape.Etat = 'echec'; $etape.Detail = $erreur
        Invoke-Rendu -Composant 'étape' -Spectre { Write-SpectreHost "  [bold red] KO [/]  $(Protect-Texte $Nom)  [grey]$($etape.Duree) s[/]" } -Repli { Write-Host ("  [KO] {0}  ({1} s)" -f $Nom, $etape.Duree) -ForegroundColor Red }
    } else {
        $etape.Etat = 'ok'
        $suffixe = if ($simule) { '  simulée' } else { '' }
        Invoke-Rendu -Composant 'étape' -Spectre { Write-SpectreHost "  [bold green] OK [/]  $(Protect-Texte $Nom)  [grey]$($etape.Duree) s$suffixe[/]" } -Repli { Write-Host ("  [OK] {0}  ({1} s{2})" -f $Nom, $etape.Duree, $suffixe) -ForegroundColor Green }
    }
    foreach ($l in $tampon) { Write-LigneJournal -Ligne $l }
    if ($erreur) {
        Add-Journal -Message "$Nom : $erreur" -Categorie $Categorie -Niveau Erreur
        if ($Critique) { throw "Étape critique en échec : $Nom — $erreur" }
        return $null
    }
    return $resultat
}

function Show-Checklist {
    <# Le bilan des étapes, en fin de session. #>
    $lignes = @()
    foreach ($e in $script:Etapes) {
        $lignes += [pscustomobject]@{
            Etat  = $e.Etat; Etape = $e.Nom
            Duree = $(if ($e.Etat -eq 'ignoree') { '' } else { "$($e.Duree) s" })
            Detail = $e.Detail
        }
    }
    $ok = @($script:Etapes | Where-Object { $_.Etat -eq 'ok' }).Count
    $ko = @($script:Etapes | Where-Object { $_.Etat -eq 'echec' }).Count
    $ig = @($script:Etapes | Where-Object { $_.Etat -eq 'ignoree' }).Count
    $resume = "$ok réussie(s) · $ko en échec · $ig ignorée(s)" + $(if (Test-Simulation) { ' · SIMULATION' } else { '' })
    Show-Section 'Bilan'
    Invoke-Rendu -Composant 'bilan' -Spectre {
        $vue = @($lignes | ForEach-Object {
            $badge = switch ($_.Etat) { 'ok' { '[bold green] OK [/]' } 'echec' { '[bold red] KO [/]' } default { '[grey] -- [/]' } }
            [pscustomobject]@{ 'État' = $badge; 'Étape' = (Protect-Texte $_.Etape); 'Durée' = "[grey]$(Protect-Texte $_.Duree)[/]"; 'Détail' = "[red]$(Protect-Texte $_.Detail)[/]" }
        })
        Format-SpectreTable -Data $vue -Border Rounded -Color Grey -AllowMarkup -Title "[grey]$(Protect-Texte $resume)[/]" | Out-Rendu
    } -Repli {
        foreach ($l in $lignes) {
            $symbole = switch ($l.Etat) { 'ok' { '[OK]' } 'echec' { '[KO]' } default { '[--]' } }
            $couleur = switch ($l.Etat) { 'ok' { 'Green' } 'echec' { 'Red' } default { 'DarkGray' } }
            Write-Host ("  {0} {1}  {2}  {3}" -f $symbole, $l.Etape, $l.Duree, $l.Detail) -ForegroundColor $couleur
        }
        Write-Host "  $resume" -ForegroundColor Cyan
    }
}

# ====================================================================
#  OUTILS TEXTE, MODÈLES ET MOT DE PASSE
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

function Expand-Modele {
    <# Remplace les {Variables} d'un modèle (insensible à la casse). Les variables inconnues restent telles quelles. #>
    param([Parameter(Mandatory)] [AllowEmptyString()] [string] $Texte, [Parameter(Mandatory)] [hashtable] $Variables)
    $r = $Texte
    foreach ($k in $Variables.Keys) { $r = [regex]::Replace($r, '\{' + [regex]::Escape($k) + '\}', [string]$Variables[$k], 'IgnoreCase') }
    return $r
}

function Get-VariablesDuModele {
    <# Les {Variables} présentes dans un texte, dans l'ordre d'apparition, sans doublon. #>
    param([Parameter(Mandatory)] [AllowEmptyString()] [string] $Texte)
    $vues = @(); $liste = @()
    foreach ($m in [regex]::Matches($Texte, '\{([A-Za-z][A-Za-z0-9]*)\}')) {
        $n = $m.Groups[1].Value
        if ($vues -notcontains $n.ToLower()) { $vues += $n.ToLower(); $liste += $n }
    }
    return $liste
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
      Une saisie par domaine et par session.
    #>
    param([Parameter(Mandatory)] $Societe)
    Import-Module ActiveDirectory -ErrorAction Stop
    $splat = @{ Server = $Societe.dc }
    $domaineLocal = try { (Get-CimInstance Win32_ComputerSystem -ErrorAction Stop).Domain } catch { '' }
    if ($domaineLocal -and $Societe.dc -like "*.$domaineLocal") { return $splat }

    if (-not $script:Credentials.ContainsKey($Societe.domaineAd)) {
        $op = Get-Operateur
        $compte = $null
        if ($op -and $op.PSObject.Properties[$Societe.id]) { $compte = Get-Prop -Objet $op.($Societe.id) -Nom 'domaine' }
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
    $filtre = "Name -like '*$r*' -or SamAccountName -like '*$r*' -or UserPrincipalName -like '*$r*' -or GivenName -like '*$r*' -or Surname -like '*$r*' -or mail -like '*$r*'"
    return @(Get-ADUser -Filter $filtre -Properties DisplayName, Title, Department, Enabled, UserPrincipalName, DistinguishedName, mail @Ad |
        Sort-Object Name | Select-Object Name, SamAccountName, UserPrincipalName, mail, Title, Department, Enabled, DistinguishedName)
}

function Find-AdDestinataire {
    <#
      Cibles possibles d'une redirection : utilisateurs ET groupes (listes de
      distribution) portant une adresse. Rend Type, Nom, Adresse, Actif.
    #>
    param([Parameter(Mandatory)] [string] $Recherche, [Parameter(Mandatory)] [hashtable] $Ad)
    $liste = @()
    foreach ($u in @(Find-AdUtilisateur -Recherche $Recherche -Ad $Ad)) {
        $adresse = if ($u.mail) { "$($u.mail)" } else { "$($u.UserPrincipalName)" }
        $liste += [pscustomobject]@{ Type = 'Utilisateur'; Nom = $u.Name; Adresse = $adresse; Actif = [bool]$u.Enabled; Detail = "$($u.Title)" }
    }
    $r = $Recherche.Replace("'", "''")
    try {
        foreach ($g in @(Get-ADGroup -Filter "(Name -like '*$r*' -or mail -like '*$r*') -and mail -like '*'" -Properties mail, Description @Ad)) {
            $liste += [pscustomobject]@{ Type = 'Liste'; Nom = $g.Name; Adresse = "$($g.mail)"; Actif = $true; Detail = "$($g.Description)" }
        }
    } catch { }
    return @($liste | Sort-Object Type, Nom)
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
    Invoke-Ecriture -Categorie AD -Description "Start-ADSyncSyncCycle -PolicyType Delta sur $serveur" -Action {
        Invoke-Command -ComputerName $serveur -ScriptBlock {
            Import-Module ADSync -ErrorAction Stop
            Start-ADSyncSyncCycle -PolicyType Delta | Out-Null
        } -ErrorAction Stop
        Add-Journal -Message "Synchronisation AD Connect (delta) déclenchée sur $serveur." -Categorie AD -Niveau Succes
    } | Out-Null
}

# ====================================================================
#  MICROSOFT 365 — EXCHANGE ONLINE ET GRAPH
# ====================================================================

function Get-UpnAdministrateur {
    param([Parameter(Mandatory)] $Societe)
    $op = Get-Operateur
    $upn = $null
    if ($op -and $op.PSObject.Properties[$Societe.id]) { $upn = Get-Prop -Objet $op.($Societe.id) -Nom 'o365' }
    if (-not $upn) { $upn = Read-Texte -Invite "Compte administrateur Microsoft 365 de $($Societe.id) (UPN)" -Obligatoire }
    return "$upn"
}

function Connect-M365 {
    <#
      Exchange Online + Microsoft Graph pour le tenant de la société.

      CONNEXION UNIQUE (config m365.appId renseigné, module MSAL.PS présent) :
      une seule ouverture de session dans le navigateur ; le jeton Graph et le
      jeton Exchange sont obtenus l'un après l'autre sur cette même session et
      transmis aux deux modules (-AccessToken). Prérequis côté Entra : voir
      README « Connexion unique ».

      Sinon : les deux connexions classiques, l'une après l'autre.
    #>
    param([Parameter(Mandatory)] $Societe)
    if (-not $Societe.tenantId) { throw "Pas de tenant Microsoft 365 configuré pour $($Societe.id)." }
    $upn = Get-UpnAdministrateur -Societe $Societe
    Import-Module ExchangeOnlineManagement -ErrorAction Stop
    Import-Module Microsoft.Graph.Authentication -ErrorAction Stop

    $m365 = Get-Prop -Objet $script:Config -Nom 'm365'
    $appId = Get-Prop -Objet $Societe -Nom 'm365AppId'
    if (-not $appId -and $m365) { $appId = Get-Prop -Objet $m365 -Nom 'appId' }
    $unique = $appId -and $m365 -and [bool](Get-Prop -Objet $m365 -Nom 'connexionUnique' -Defaut $true) -and (Get-Module -ListAvailable MSAL.PS -ErrorAction SilentlyContinue)

    if ($unique) {
        try {
            Import-Module MSAL.PS -ErrorAction Stop
            $scopesGraph = @('https://graph.microsoft.com/User.ReadWrite.All', 'https://graph.microsoft.com/Directory.ReadWrite.All')
            $scopeExo    = 'https://outlook.office365.com/.default'
            Show-Note "Ouverture de session Microsoft 365 ($upn) — une seule fois pour Exchange et Graph." -Niveau Sourdine
            $jetonGraph = Get-MsalToken -ClientId $appId -TenantId $Societe.tenantId -Scopes $scopesGraph -Interactive -LoginHint $upn -RedirectUri 'http://localhost' -ErrorAction Stop
            $jetonExo = $null
            try { $jetonExo = Get-MsalToken -ClientId $appId -TenantId $Societe.tenantId -Scopes $scopeExo -Silent -LoginHint $upn -ErrorAction Stop }
            catch { $jetonExo = Get-MsalToken -ClientId $appId -TenantId $Societe.tenantId -Scopes $scopeExo -Interactive -LoginHint $upn -RedirectUri 'http://localhost' -ErrorAction Stop }

            Connect-ExchangeOnline -AccessToken $jetonExo.AccessToken -UserPrincipalName $upn -ShowBanner:$false -ShowProgress:$false
            $typeJeton = (Get-Command Connect-MgGraph).Parameters['AccessToken'].ParameterType
            if ($typeJeton -eq [securestring]) { Connect-MgGraph -AccessToken (ConvertTo-SecureString -String $jetonGraph.AccessToken -AsPlainText -Force) -NoWelcome }
            else { Connect-MgGraph -AccessToken $jetonGraph.AccessToken -NoWelcome }
            $script:Session.M365 = @{ Mode = 'unique'; Expire = $jetonExo.ExpiresOn.LocalDateTime }
            Add-Journal -Message "Connecté à Exchange Online et Microsoft Graph ($upn, connexion unique, valable jusqu'à $($script:Session.M365.Expire.ToString('HH:mm')))." -Categorie Exchange -Niveau Succes
            return
        } catch {
            Show-Note "Connexion unique impossible ($(Get-MessageErreur $_)) — connexions classiques." -Niveau Alerte
        }
    }

    Connect-ExchangeOnline -UserPrincipalName $upn -ShowBanner:$false -ShowProgress:$false
    Add-Journal -Message "Connecté à Exchange Online ($upn)." -Categorie Exchange -Niveau Succes
    Connect-MgGraph -TenantId $Societe.tenantId -Scopes 'User.ReadWrite.All', 'Directory.ReadWrite.All' -NoWelcome
    $script:Session.M365 = @{ Mode = 'classique'; Expire = $null }
    Add-Journal -Message "Connecté à Microsoft Graph (tenant $($Societe.id))." -Categorie Licences -Niveau Succes
}

function Disconnect-M365 {
    try { if (Get-Command Disconnect-ExchangeOnline -ErrorAction SilentlyContinue) { Disconnect-ExchangeOnline -Confirm:$false -ErrorAction SilentlyContinue *> $null } } catch { }
    try { if (Get-Command Disconnect-MgGraph -ErrorAction SilentlyContinue) { Disconnect-MgGraph -ErrorAction SilentlyContinue *> $null } } catch { }
    $script:Session.M365 = $null
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
        $libelles = @($licences | Where-Object { $aRetirer -contains $_.SkuId } | ForEach-Object { $_.SkuPartNumber }) -join ', '
        Invoke-Ecriture -Categorie Licences -Description "Set-MgUserLicense $Upn -RemoveLicenses $libelles" -Action {
            Set-MgUserLicense -UserId $Upn -RemoveLicenses $aRetirer -AddLicenses @() | Out-Null
        } | Out-Null
    }
    $skus = Get-MgSubscribedSku
    foreach ($l in $licences) {
        $sku = $skus | Where-Object { $_.SkuId -eq $l.SkuId }
        $libelle = if ($noms.PSObject.Properties[$l.SkuPartNumber]) { $noms.($l.SkuPartNumber) } else { $l.SkuPartNumber }
        $restantes = if ($sku) { $sku.PrepaidUnits.Enabled - $sku.ConsumedUnits } else { '?' }
        $total = if ($sku) { $sku.PrepaidUnits.Enabled } else { '?' }
        if ($aRetirer -contains $l.SkuId) { Add-Journal -Message "$libelle — $(if (Test-Simulation) { 'à retirer' } else { 'retirée' }) ($restantes restante(s) sur $total)" -Categorie Licences -Niveau Succes }
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
    New-Item -ItemType Directory -Path $dossierCache -Force | Out-Null
    $fichier = Join-Path $dossierCache "$($Societe -replace '[^A-Za-z0-9]', '_')_delegations.json"
    $validite = [int]$script:Config.sortie.cacheDelegationsHeures
    $cible = $Cible.Trim().ToLower()

    $cache = $null; $valide = $false
    if (Test-Path $fichier) {
        $cache = Get-Content $fichier -Raw -Encoding UTF8 | ConvertFrom-Json
        $valide = (Get-Date) -le ([datetime]::Parse($cache.LastUpdated)).AddHours($validite)
    }
    if ($ForcerCache -or -not $valide -or -not $cache) {
        Add-Journal -Message "Analyse de toutes les boîtes aux lettres (cache absent, périmé ou forcé)." -Categorie Delegations
        $redirs = @(); $delegs = @()
        $boites = @(Get-Mailbox -ResultSize Unlimited -RecipientTypeDetails UserMailbox, SharedMailbox)
        $i = 0
        foreach ($b in $boites) {
            $i++
            Update-Statut -Texte "Analyse des boîtes aux lettres  $i / $($boites.Count)" -Pourcent (100 * $i / [math]::Max(1, $boites.Count))
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
        if (-not $script:Ui.Statut) { Write-Progress -Activity 'Analyse des boîtes aux lettres' -Completed }
        $cache = [pscustomobject]@{ LastUpdated = (Get-Date).ToString('o'); Redirections = $redirs; Delegations = $delegs }
        # Le cache est une trace locale, pas une écriture métier : il se met à jour même en simulation.
        $cache | ConvertTo-Json -Depth 4 | Set-Content -Path $fichier -Encoding UTF8
    } else {
        Add-Journal -Message "Cache des délégations du $([datetime]::Parse($cache.LastUpdated).ToString('dd.MM.yyyy HH:mm')) utilisé." -Categorie Delegations
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
            switch ($d.Type) {
                'SendOnBehalf' {
                    Invoke-Ecriture -Categorie Delegations -Description "Set-Mailbox $($d.Boite) -GrantSendOnBehalfTo (sans $Cible)" -Action {
                        $actuels = @((Get-Mailbox -Identity $d.Boite).GrantSendOnBehalfTo)
                        $nouveaux = @($actuels | Where-Object { $r = Get-Recipient -Identity "$_" -ErrorAction SilentlyContinue; -not $r -or "$($r.PrimarySmtpAddress)".ToLower() -ne $cible })
                        Set-Mailbox -Identity $d.Boite -GrantSendOnBehalfTo $nouveaux
                    } | Out-Null
                }
                'FullAccess' { Invoke-Ecriture -Categorie Delegations -Description "Remove-MailboxPermission $($d.Boite) -User $Cible -AccessRights FullAccess" -Action { Remove-MailboxPermission -Identity $d.Boite -User $Cible -AccessRights FullAccess -Confirm:$false | Out-Null } | Out-Null }
                'SendAs'     { Invoke-Ecriture -Categorie Delegations -Description "Remove-RecipientPermission $($d.Boite) -Trustee $Cible -AccessRights SendAs" -Action { Remove-RecipientPermission -Identity $d.Boite -Trustee $Cible -AccessRights SendAs -Confirm:$false | Out-Null } | Out-Null }
            }
            if (-not (Test-Simulation)) { Add-Journal -Message "  $($d.Type) retirée sur $($d.Boite)" -Categorie Delegations -Niveau Succes }
        } catch { Add-Journal -Message "  échec du retrait $($d.Type) sur $($d.Boite) : $(Get-MessageErreur $_)" -Categorie Delegations -Niveau Erreur }
    }
}

function Add-TachePlanner {
    <# La tâche « désactivation » dans le Planner du service IT (application + certificat, tenant Gérofinance). #>
    param([Parameter(Mandatory)] [string] $Titre, [string] $Description = '', [string] $Bureau = '')
    $p = $script:Config.planner
    if (Test-ModeTest) { Add-Journal -Message "MODE TEST : tâche Planner non créée (« $Titre »)." -Categorie Planner -Niveau Alerte; return }
    Invoke-Ecriture -Categorie Planner -Description "POST planner/tasks « $Titre » (plan $($p.planId), compartiment $($p.compartiment))" -Action {
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
    } | Out-Null
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
    New-Item -ItemType Directory -Path (Split-Path $Chemin) -Force | Out-Null
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
    <# Un appel XAPI. Les écritures (PATCH/POST/DELETE) passent par Invoke-Ecriture : décrites en simulation. #>
    param(
        [Parameter(Mandatory)] $Pbx,
        [ValidateSet('GET', 'POST', 'PATCH', 'DELETE')] [string] $Methode = 'GET',
        [Parameter(Mandatory)] [string] $Chemin,     # ex. "Users?%24top=100"
        $Corps = $null
    )
    $appel = {
        $token = Connect-Xapi -Pbx $Pbx
        $params = @{ Method = $Methode; Uri = "$($Pbx.adresse)/xapi/v1/$Chemin"; Headers = @{ Authorization = "Bearer $token" }; TimeoutSec = 30 }
        if ($Corps) { $params.Body = ($Corps | ConvertTo-Json -Depth 6); $params.ContentType = 'application/json' }
        Invoke-RestMethod @params
    }
    if ($Methode -eq 'GET') { return & $appel }
    $apercu = if ($Corps) { ($Corps | ConvertTo-Json -Depth 6 -Compress) } else { '' }
    return Invoke-Ecriture -Categorie 3CX -Description "3CX $Methode $Chemin $apercu" -Action $appel
}

function Get-XapiUtilisateurs {
    <# Tous les utilisateurs du PBX. « Users » ne renvoie pas de nextLink : on avance par $skip, 100 par page, trié pour que les pages ne se chevauchent pas. #>
    param([Parameter(Mandatory)] $Pbx)
    $tous = @(); $skip = 0
    do {
        $page = Invoke-Xapi -Pbx $Pbx -Chemin "Users?%24top=100&%24skip=$skip&%24orderby=Id&%24select=Id,Number,FirstName,LastName,DisplayName,EmailAddress,Enabled,PrimaryGroupId"
        $lot = @($page.value); $tous += $lot; $skip += 100
    } while ($lot.Count -eq 100 -and $skip -lt 5000)
    return @($tous | Sort-Object Id -Unique)
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
    return @($tous | Sort-Object Id -Unique)
}

function Get-XapiFilesDuPoste {
    param([Parameter(Mandatory)] $Pbx, [Parameter(Mandatory)] [string] $Numero)
    return @(Get-XapiFiles -Pbx $Pbx | Where-Object { @($_.Agents | ForEach-Object { "$($_.Number)" }) -contains $Numero })
}

function Set-XapiAgentsDeFile {
    <# Remplace la liste des agents d'une file (PATCH). On envoie TOUJOURS la liste complète : le PBX ne fait pas de diff. #>
    param([Parameter(Mandatory)] $Pbx, [Parameter(Mandatory)] $File, [Parameter(Mandatory)] [AllowEmptyCollection()] [object[]] $Agents)
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
        if (-not (Test-Simulation)) { Add-Journal -Message "Poste $Numero retiré de la file $($f.Number) « $($f.Name) »" -Categorie 3CX -Niveau Succes }
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
        if (-not (Test-Simulation)) { Add-Journal -Message "Poste $Numero ajouté à la file $($f.Number) « $($f.Name) »" -Categorie 3CX -Niveau Succes }
    }
}

function Set-XapiPoste {
    <# Modifie un utilisateur du PBX (PATCH Users({Id})). #>
    param([Parameter(Mandatory)] $Pbx, [Parameter(Mandatory)] [int] $Id, [Parameter(Mandatory)] [hashtable] $Proprietes)
    Invoke-Xapi -Pbx $Pbx -Methode PATCH -Chemin "Users($Id)" -Corps $Proprietes | Out-Null
}

function Get-XapiSdaVersPoste {
    <# Règles entrantes (SDA) dont une destination vise ce poste — une ligne par règle. Version 1 : on LISTE, on ne réécrit pas. #>
    param([Parameter(Mandatory)] $Pbx, [Parameter(Mandatory)] [string] $Numero)
    $tous = @(); $skip = 0
    do {
        $page = Invoke-Xapi -Pbx $Pbx -Chemin "InboundRules?%24top=100&%24skip=$skip&%24orderby=Id"
        $lot = @($page.value); $tous += $lot; $skip += 100
    } while ($lot.Count -eq 100 -and $skip -lt 5000)
    $motif = '"' + [regex]::Escape($Numero) + '"'
    return @($tous | Sort-Object Id -Unique | Where-Object { ($_ | ConvertTo-Json -Depth 6 -Compress) -match $motif } | Select-Object Id, RuleName, Data, TrunkDN)
}

# ====================================================================
#  RAPPORT ET MAIL
# ====================================================================

function ConvertTo-RapportHtml {
    param([Parameter(Mandatory)] [string] $Titre, [string] $EnTete = '')
    $sb = New-Object Text.StringBuilder
    [void]$sb.Append("<html><body style='font-family:Arial,sans-serif;font-size:14px'><h1 style='color:#00B400;font-size:22px'>$Titre</h1>$EnTete")
    [void]$sb.Append("<p>Date : $(Get-Date -Format 'dd.MM.yyyy HH:mm') · Opérateur : $($script:Session.Operateur)")
    if (Test-Simulation) { [void]$sb.Append(" · <b style='color:#b45309'>SIMULATION — rien n'a été écrit</b>") }
    [void]$sb.Append("</p><h2 style='color:#0000ff;font-size:16px'>Étapes</h2><table style='border-collapse:collapse'>")
    foreach ($e in $script:Etapes) {
        $c = switch ($e.Etat) { 'ok' { '#16a34a' } 'echec' { '#dc2626' } default { '#94a3b8' } }
        $s = switch ($e.Etat) { 'ok' { '&#10003;' } 'echec' { '&#10007;' } default { '&ndash;' } }
        [void]$sb.Append("<tr><td style='color:$c;padding:2px 8px'>$s</td><td style='padding:2px 8px'>$([Net.WebUtility]::HtmlEncode($e.Nom))</td><td style='color:#64748b;padding:2px 8px'>$([Net.WebUtility]::HtmlEncode($e.Detail))</td></tr>")
    }
    [void]$sb.Append("</table>")
    foreach ($cat in @('General', 'AD', 'Groupes', '3CX', 'Exchange', 'Licences', 'Delegations', 'Planner')) {
        $lignes = @($script:Journal | Where-Object { $_.Categorie -eq $cat })
        if ($lignes.Count -eq 0) { continue }
        [void]$sb.Append("<h2 style='color:#0000ff;font-size:16px'>$cat</h2><p>")
        foreach ($l in $lignes) {
            $c = switch ($l.Niveau) { 'Succes' { '#16a34a' } 'Alerte' { '#d97706' } 'Erreur' { '#dc2626' } 'Simule' { '#b45309' } default { '#334155' } }
            [void]$sb.Append("<span style='color:$c'>&#9679;</span> $([Net.WebUtility]::HtmlEncode($l.Message))<br>")
        }
        [void]$sb.Append("</p>")
    }
    [void]$sb.Append("</body></html>")
    return $sb.ToString()
}

function Send-Rapport {
    <#
      Envoi au helpdesk — ou, en MODE TEST, à l'adresse de test avec le sujet
      préfixé. Le rapport part AUSSI en simulation (préfixe [SIMULATION]) :
      c'est la preuve de ce qui aurait été fait.
    #>
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
    <# Le rapport en JSON (pour le futur portail) et en HTML, dans le dossier de logs. #>
    param([Parameter(Mandatory)] [string] $Nom, [Parameter(Mandatory)] [string] $Html, $Donnees = $null)
    $base = Join-Path $script:Reglages.DossierLogs ("{0}-{1}" -f (Get-Date -Format 'yyyyMMdd-HHmm'), ($Nom -replace '[^A-Za-z0-9_.-]', '_'))
    $objet = [pscustomobject]@{
        Quand = (Get-Date).ToString('o'); Operateur = $script:Session.Operateur
        Simulation = (Test-Simulation); ModeTest = (Test-ModeTest)
        Donnees = $Donnees; Etapes = @($script:Etapes); Journal = @($script:Journal)
    }
    $objet | ConvertTo-Json -Depth 6 | Set-Content -Path "$base.json" -Encoding UTF8
    Set-Content -Path "$base.html" -Value $Html -Encoding UTF8
    Add-Journal -Message "Rapport enregistré : $base.json" -Niveau Info
    return "$base.json"
}

function Complete-Session {
    Show-Checklist
    try { Stop-Transcript | Out-Null } catch { }
}

Export-ModuleMember -Function *
