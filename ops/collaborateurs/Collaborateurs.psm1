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
$script:Session     = @{ Operateur = $env:USERNAME; Debut = Get-Date; Transcription = $null }
$script:Ui          = @{ Spectre = $false; Tampon = $null; Statut = $null; Resultat = $null; Params = @{}; Avertissements = @{}; Accent = '#8ccaae'; Ombre = '#085440'; Ligne = 'grey27'; Succes = 'green' }

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
#
#  Direction visuelle : UNE couleur d'accent (terracotta) pour ce qui guide
#  l'œil — titre, pointeur, question, bordure du panneau d'accueil ; du gris
#  pour tout ce qui est secondaire ; le blanc pour les données ; vert et
#  rouge réservés aux verdicts. Bordures minimales, colonnes alignées,
#  de l'air entre les blocs. Jamais de texte sur fond de couleur.
# ====================================================================

function Initialize-Interface {
    $script:Ui.Spectre = $false
    try { [Console]::OutputEncoding = [Text.Encoding]::UTF8; [Console]::InputEncoding = [Text.Encoding]::UTF8 } catch { }

    # Couleurs de la charte Gérofinance (le dégradé du site : #085440 → #8ccaae),
    # surchargeables dans config.json → interface.
    $reglagesUi = Get-Prop -Objet $script:Config -Nom 'interface'
    foreach ($cle in @('Accent', 'Ombre', 'Ligne', 'Succes')) {
        $valeur = "$(Get-Prop -Objet $reglagesUi -Nom $cle.ToLower() -Defaut '')"
        if ($valeur -match '^(#[0-9a-fA-F]{6}|[a-z][a-z0-9_]*)$') { $script:Ui[$cle] = $valeur }
    }

    if ($PSVersionTable.PSVersion.Major -lt 7 -or $env:COLLABORATEURS_SANS_SPECTRE) { return }
    $m = Get-Module -ListAvailable PwshSpectreConsole -ErrorAction SilentlyContinue | Sort-Object Version -Descending | Select-Object -First 1
    if (-not $m -or $m.Version -lt [version]'2.0') { return }
    try { Import-Module PwshSpectreConsole -MinimumVersion 2.0 -ErrorAction Stop; $script:Ui.Spectre = $true } catch { return }
}

function Test-Spectre { return [bool]$script:Ui.Spectre }

function Get-Largeur {
    <# Largeur utile des panneaux : la console, plafonnée pour rester lisible sur un grand écran. #>
    $l = 100
    try { $l = [Math]::Min([Console]::WindowWidth - 2, 100) } catch { }
    if ($l -lt 60) { $l = 60 }
    return $l
}

function Protect-Texte {
    <# Échappe les crochets : Spectre lit [ceci] comme du balisage. À appliquer à TOUTE donnée affichée. #>
    param([AllowNull()] [AllowEmptyString()] [string] $Texte)
    if ($null -eq $Texte) { return '' }
    return $Texte.Replace('[', '[[').Replace(']', ']]')
}

function Test-Param {
    <# Une commande Spectre a-t-elle ce paramètre ? (les noms ont bougé entre versions) #>
    param([Parameter(Mandatory)] [string] $Commande, [Parameter(Mandatory)] [string] $Nom)
    $cle = "$Commande/$Nom"
    if (-not $script:Ui.Params.ContainsKey($cle)) {
        $c = Get-Command $Commande -ErrorAction SilentlyContinue
        $script:Ui.Params[$cle] = [bool]($c -and $c.Parameters.ContainsKey($Nom))
    }
    return $script:Ui.Params[$cle]
}

function Get-NomInvite {
    <# Le paramètre « question » des invites Spectre : Message (v2) ou Title (v1). #>
    param([Parameter(Mandatory)] [string] $Commande)
    if (Test-Param $Commande 'Message') { return 'Message' }
    if (Test-Param $Commande 'Title') { return 'Title' }
    return 'Prompt'
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

function New-Panneau {
    <# Un panneau Spectre aux réglages maison : bordure arrondie, largeur plafonnée, titre discret. #>
    param([Parameter(Mandatory)] [string] $Contenu, [string] $Titre = '', [string] $Couleur = '')
    if (-not $Couleur) { $Couleur = $script:Ui.Ligne }
    $p = @{ Data = $Contenu; Border = 'Rounded'; Color = $Couleur }
    if ($Titre) { $p.Title = $Titre }
    if (Test-Param 'Format-SpectrePanel' 'Width') { $p.Width = Get-Largeur }
    return Format-SpectrePanel @p
}

# --------------------------------------------------------------------
#  LE TITRE EN LETTRES PLEINES
#
#  Un alphabet maison : que des rectangles pleins, des montants deux fois
#  plus larges que les traverses (une cellule de terminal est deux fois
#  plus haute que large : à l'écran, les traits ont la même épaisseur), et
#  une ombre portée décalée d'un cran en bas à droite, dans le vert profond
#  de la charte. Les polices figlet livrées avec Spectre dessinent au trait
#  ( / \ | _ ) : ce n'est pas ce qu'on veut.
# --------------------------------------------------------------------

$script:Blocs = @{
    'A' = @('######', '##..##', '######', '##..##', '##..##')
    'C' = @('######', '##....', '##....', '##....', '######')
    'D' = @('#####.', '##..##', '##..##', '##..##', '#####.')
    'E' = @('######', '##....', '#####.', '##....', '######')
    'I' = @('######', '..##..', '..##..', '..##..', '######')
    'N' = @('##..##', '###.##', '######', '##.###', '##..##')
    'O' = @('######', '##..##', '##..##', '##..##', '######')
    'P' = @('######', '##..##', '######', '##....', '##....')
    'R' = @('######', '##..##', '######', '##.##.', '##..##')
    'S' = @('######', '##....', '######', '....##', '######')
    'T' = @('######', '..##..', '..##..', '..##..', '..##..')
    'U' = @('##..##', '##..##', '##..##', '##..##', '######')
    'É' = @('...##.', '######', '##....', '#####.', '##....', '######')
    'È' = @('.##...', '######', '##....', '#####.', '##....', '######')
    ' ' = @('......', '......', '......', '......', '......')
}

function Get-GrilleTitre {
    <#
      Le mot en grille de caractères : 'P' plein, 'O' ombre, ' ' vide.
      Rend $null si une lettre manque à l'alphabet — l'appelant se rabat
      alors sur du texte simple.
    #>
    param([Parameter(Mandatory)] [string] $Texte)
    $glyphes = @()
    foreach ($c in $Texte.ToUpper().ToCharArray()) {
        if (-not $script:Blocs.ContainsKey("$c")) { return $null }
        $glyphes += , $script:Blocs["$c"]
    }
    if ($glyphes.Count -eq 0) { return $null }

    $hauteur = 0
    foreach ($g in $glyphes) { if ($g.Count -gt $hauteur) { $hauteur = $g.Count } }

    # Les lettres sans accent sont calées en bas.
    $lignes = @()
    for ($y = 0; $y -lt $hauteur; $y++) {
        $s = ''
        foreach ($g in $glyphes) {
            $creux = $hauteur - $g.Count
            $s += $(if ($y -lt $creux) { '......' } else { $g[$y - $creux] }) + '...'
        }
        $lignes += $s.Substring(0, $s.Length - 3)
    }

    # Composition : le plein par-dessus, l'ombre décalée d'un cran en dessous.
    $largeur = $lignes[0].Length
    $grille = @()
    for ($y = 0; $y -le $hauteur; $y++) {
        $sb = New-Object Text.StringBuilder
        for ($x = 0; $x -le $largeur; $x++) {
            $plein = ($y -lt $hauteur -and $x -lt $largeur -and $lignes[$y][$x] -eq '#')
            $ombre = ($y -gt 0 -and $x -gt 0 -and $lignes[$y - 1][$x - 1] -eq '#')
            [void]$sb.Append($(if ($plein) { 'P' } elseif ($ombre) { 'O' } else { ' ' }))
        }
        $grille += $sb.ToString().TrimEnd()
    }
    return $grille
}

function Show-Titre {
    <# Le mot en grand, plein, avec son ombre portée. #>
    param([Parameter(Mandatory)] [string] $Texte, [int] $Marge = 1)
    $grille = Get-GrilleTitre -Texte $Texte
    if (-not $grille) {
        Invoke-Rendu -Composant 'titre' -Spectre { Write-SpectreHost "[bold $($script:Ui.Accent)]$(Protect-Texte $Texte.ToUpper())[/]" } -Repli { Write-Host "  $($Texte.ToUpper())" -ForegroundColor Green }
        return
    }
    $bloc = [string][char]0x2588   # █
    Invoke-Rendu -Composant 'titre' -Spectre {
        foreach ($ligne in $grille) {
            $sb = New-Object Text.StringBuilder
            [void]$sb.Append(' ' * $Marge)
            foreach ($suite in (Get-Suites -Ligne $ligne)) {
                switch ($suite.Signe) {
                    'P' { [void]$sb.Append("[$($script:Ui.Accent)]$($bloc * $suite.Nombre)[/]") }
                    'O' { [void]$sb.Append("[$($script:Ui.Ombre)]$($bloc * $suite.Nombre)[/]") }
                    default { [void]$sb.Append(' ' * $suite.Nombre) }
                }
            }
            Write-SpectreHost $sb.ToString()
        }
    } -Repli {
        foreach ($ligne in $grille) {
            Write-Host (' ' * $Marge) -NoNewline
            foreach ($suite in (Get-Suites -Ligne $ligne)) {
                $texte = $(if ($suite.Signe -eq ' ') { ' ' * $suite.Nombre } else { $bloc * $suite.Nombre })
                $couleur = switch ($suite.Signe) { 'P' { 'Green' } 'O' { 'DarkGreen' } default { 'Black' } }
                Write-Host $texte -NoNewline -ForegroundColor $couleur
            }
            Write-Host ''
        }
    }
}

function Get-Suites {
    <# Une ligne de grille → ses suites de caractères identiques, pour n'écrire qu'une balise par suite. #>
    param([Parameter(Mandatory)] [AllowEmptyString()] [string] $Ligne)
    $suites = @()
    if (-not $Ligne) { return $suites }
    $signe = $Ligne[0]; $n = 0
    foreach ($c in $Ligne.ToCharArray()) {
        if ($c -eq $signe) { $n++; continue }
        $suites += [pscustomobject]@{ Signe = "$signe"; Nombre = $n }
        $signe = $c; $n = 1
    }
    $suites += [pscustomobject]@{ Signe = "$signe"; Nombre = $n }
    return $suites
}

function Show-EnTete {
    param([Parameter(Mandatory)] [string] $Titre)
    $r = $script:Reglages
    $a = $script:Ui.Accent
    $mot = if ($Titre -like 'Entrée*') { 'Entrée' } else { 'Sortie' }
    $culture = [Globalization.CultureInfo]::GetCultureInfo('fr-CH')
    $quand = (Get-Date).ToString('dddd d MMMM yyyy, HH:mm', $culture)
    $modes = @()
    if ($r.Simulation) { $modes += @{ Point = $script:Ui.Succes; Nom = 'SIMULATION'; Texte = 'rien ne sera écrit, chaque geste est décrit'; Console = 'Green' } }
    else               { $modes += @{ Point = 'red';   Nom = 'RÉEL';       Texte = 'les actions seront exécutées';               Console = 'Red' } }
    if ($r.ModeTest)   { $modes += @{ Point = 'grey62'; Nom = 'MODE TEST'; Texte = "rapport vers $($r.DestinataireTest), pas de tâche Planner"; Console = 'Cyan' } }
    Invoke-Rendu -Composant 'en-tête' -Spectre {
        Write-SpectreHost ''
        Show-Titre -Texte $mot
        Write-SpectreHost ''
        $lignes = @(
            '',
            " [bold white]$(Protect-Texte $Titre)[/]   [grey62]Service Informatique[/]",
            " [grey62]$(Protect-Texte $script:Session.Operateur) · $(Protect-Texte $quand) · PowerShell $($PSVersionTable.PSVersion)[/]",
            ''
        )
        foreach ($m in $modes) { $lignes += " [$($m.Point)]●[/] [bold]$(Protect-Texte $m.Nom.PadRight(11))[/] [grey62]$(Protect-Texte $m.Texte)[/]" }
        $lignes += ''
        $lignes += " [grey50]↑ ↓ choisir     Entrée valider     taper pour filtrer     ← Annuler pour quitter[/]"
        New-Panneau -Contenu ($lignes -join "`n") -Titre "[bold $a] Collaborateurs [/]" -Couleur $a | Out-Rendu
        Write-SpectreHost ''
    } -Repli {
        $ligne = '=' * 72
        Write-Host ''
        Show-Titre -Texte $mot
        Write-Host ''
        Write-Host $ligne -ForegroundColor DarkGray
        Write-Host "  $Titre   Service Informatique" -ForegroundColor White
        Write-Host "  $($script:Session.Operateur) · $quand · PowerShell $($PSVersionTable.PSVersion)" -ForegroundColor DarkGray
        foreach ($m in $modes) { Write-Host ("  * {0,-11} {1}" -f $m.Nom, $m.Texte) -ForegroundColor $m.Console }
        Write-Host $ligne -ForegroundColor DarkGray
        Write-Host ''
    }
}

function Show-Section {
    param([Parameter(Mandatory)] [string] $Titre)
    $a = $script:Ui.Accent
    Invoke-Rendu -Composant 'section' -Spectre {
        Write-SpectreHost ''
        Write-SpectreRule -Title "[bold $a]$(Protect-Texte $Titre)[/]" -Alignment Left -Color $script:Ui.Ligne
        Write-SpectreHost ''
    } -Repli {
        Write-Host ''
        Write-Host "-- $Titre " -ForegroundColor Cyan -NoNewline
        Write-Host ('-' * [math]::Max(4, 68 - $Titre.Length)) -ForegroundColor DarkGray
        Write-Host ''
    }
}

function Show-Note {
    <# Une ligne d'information hors journal. Niveau : Info | Sourdine | Succes | Alerte | Erreur #>
    param([Parameter(Mandatory)] [AllowEmptyString()] [string] $Texte, [ValidateSet('Info', 'Sourdine', 'Succes', 'Alerte', 'Erreur')] [string] $Niveau = 'Info')
    $couleurSpectre = switch ($Niveau) { 'Sourdine' { 'grey50' } 'Succes' { $script:Ui.Succes } 'Alerte' { 'yellow' } 'Erreur' { 'red' } default { 'grey85' } }
    $couleurConsole = switch ($Niveau) { 'Sourdine' { 'DarkGray' } 'Succes' { 'Green' } 'Alerte' { 'Yellow' } 'Erreur' { 'Red' } default { 'Gray' } }
    $puce = switch ($Niveau) { 'Succes' { '✓ ' } 'Alerte' { '! ' } 'Erreur' { '✗ ' } default { '' } }
    Invoke-Rendu -Composant 'note' -Spectre { Write-SpectreHost "  [$couleurSpectre]$puce$(Protect-Texte $Texte)[/]" } -Repli { Write-Host "  $Texte" -ForegroundColor $couleurConsole }
}

function Show-Tableau {
    <# Des objets en tableau : lignes horizontales seulement, en-têtes en accent. -Colonnes = propriétés affichées, dans l'ordre. #>
    param([Parameter(Mandatory)] [AllowEmptyCollection()] [object[]] $Lignes, [string[]] $Colonnes, [string] $Titre = '')
    if (-not $Lignes -or $Lignes.Count -eq 0) { return }
    $vue = if ($Colonnes) { @($Lignes | Select-Object -Property $Colonnes) } else { @($Lignes) }
    Invoke-Rendu -Composant 'tableau' -Spectre {
        $p = @{ Data = $vue; Border = 'Horizontal'; Color = $script:Ui.Ligne }
        if (Test-Param 'Format-SpectreTable' 'HeaderColor') { $p.HeaderColor = $script:Ui.Accent }
        if ($Titre) { $p.Title = "[grey62]$(Protect-Texte $Titre)[/]" }
        Format-SpectreTable @p | Out-Rendu
    } -Repli {
        if ($Titre) { Write-Host "  $Titre" -ForegroundColor Cyan }
        $vue | Format-Table -AutoSize | Out-String -Width 200 | ForEach-Object { $_.TrimEnd() } | Where-Object { $_ } | ForEach-Object { Write-Host "  $_" }
    }
}

function Show-Recap {
    <# Un récapitulatif clé → valeur, avant la confirmation : libellés en gris alignés, valeurs en blanc. #>
    param([Parameter(Mandatory)] [System.Collections.Specialized.OrderedDictionary] $Paires, [string] $Titre = 'Récapitulatif')
    $largeurCle = 4; foreach ($k in $Paires.Keys) { if ("$k".Length -gt $largeurCle) { $largeurCle = "$k".Length } }
    Invoke-Rendu -Composant 'récapitulatif' -Spectre {
        $lignes = @('')
        foreach ($k in $Paires.Keys) { $lignes += " [grey62]$(Protect-Texte "$k".PadRight($largeurCle))[/]   [white]$(Protect-Texte "$($Paires[$k])")[/]" }
        $lignes += ''
        New-Panneau -Contenu ($lignes -join "`n") -Titre "[bold white] $(Protect-Texte $Titre) [/]" | Out-Rendu
    } -Repli {
        Write-Host ''
        Write-Host "  $Titre" -ForegroundColor Cyan
        foreach ($k in $Paires.Keys) { Write-Host ("  {0}   {1}" -f "$k".PadRight($largeurCle), $Paires[$k]) }
        Write-Host ''
    }
}

function Show-Panneau {
    <# Un bloc de texte encadré (aperçu d'un message, mot de passe…). -Accent : bordure en couleur d'accent. #>
    param([Parameter(Mandatory)] [AllowEmptyString()] [string] $Texte, [string] $Titre = '', [switch] $Accent)
    Invoke-Rendu -Composant 'panneau' -Spectre {
        $contenu = "`n" + ((($Texte -split "`r?`n") | ForEach-Object { " $(Protect-Texte $_)" }) -join "`n") + "`n"
        $couleur = if ($Accent) { $script:Ui.Accent } else { $script:Ui.Ligne }
        $titre = if ($Titre) { "[bold $(if ($Accent) { $script:Ui.Accent } else { 'white' })] $(Protect-Texte $Titre) [/]" } else { '' }
        New-Panneau -Contenu $contenu -Titre $titre -Couleur $couleur | Out-Rendu
    } -Repli {
        Write-Host ''
        if ($Titre) { Write-Host "  -- $Titre" -ForegroundColor DarkGray }
        foreach ($l in ($Texte -split "`r?`n")) { Write-Host "  | $l" }
        Write-Host '  --' -ForegroundColor DarkGray
    }
}

function Format-Question {
    <# « ? » en accent puis la question en gras : la même signature pour toutes les invites. #>
    param([Parameter(Mandatory)] [string] $Texte)
    return "[$($script:Ui.Accent)]?[/] [bold]$(Protect-Texte $Texte)[/]"
}

function Read-Texte {
    param([Parameter(Mandatory)] [string] $Invite, [string] $Defaut = '', [switch] $Obligatoire, [switch] $QuitteSurQ)
    do {
        $valeur = Invoke-Rendu -Composant 'saisie' -Spectre {
            $p = @{ AllowEmpty = (-not $Obligatoire) }
            $p[(Get-NomInvite 'Read-SpectreText')] = Format-Question $Invite
            if ($Defaut) { $p.DefaultAnswer = $Defaut }
            if (Test-Param 'Read-SpectreText' 'AnswerColor') { $p.AnswerColor = 'white' }
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
      Un bloc de texte tapé ou COLLÉ dans le terminal, dans une zone de saisie
      délimitée. Fin de saisie : deux lignes vides d'affilée (Entrée, Entrée)
      ou une ligne ne contenant qu'un point. Les lignes vides isolées
      (paragraphes) sont conservées.
    #>
    param([Parameter(Mandatory)] [string] $Invite)
    $a = $script:Ui.Accent
    Invoke-Rendu -Composant 'saisie multiligne' -Spectre {
        Write-SpectreHost (Format-Question $Invite)
        Write-SpectreHost "  [grey50]Tapez ou collez le texte. Pour terminer : deux fois Entrée sur une ligne vide, ou un point seul.[/]"
        Write-SpectreRule -Color $a
    } -Repli {
        Write-Host "  $Invite" -ForegroundColor Cyan
        Write-Host '  Tapez ou collez le texte. Pour terminer : deux fois Entrée sur une ligne vide, ou un point seul.' -ForegroundColor DarkGray
    }
    $lignes = New-Object System.Collections.ArrayList
    $vides = 0
    while ($true) {
        if (Test-Spectre) { Write-SpectreHost "[$a]›[/] " -NoNewline } else { Write-Host '> ' -NoNewline -ForegroundColor DarkGray }
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
    Invoke-Rendu -Composant 'saisie multiligne' -Spectre { Write-SpectreRule -Color $a } -Repli { }
    return (@($lignes) -join "`n")
}

function Confirm-Choix {
    <# Oui / Non au clavier, le choix par défaut sous le pointeur. #>
    param([Parameter(Mandatory)] [string] $Question, [switch] $DefautOui)
    return [bool](Invoke-Rendu -Composant 'confirmation' -Spectre {
        $choix = if ($DefautOui) { @('Oui', 'Non') } else { @('Non', 'Oui') }
        $p = @{ Choices = $choix; Color = $script:Ui.Accent }
        $p[(Get-NomInvite 'Read-SpectreSelection')] = Format-Question $Question
        "$(Read-SpectreSelection @p)" -eq 'Oui'
    } -Repli {
        $suffixe = if ($DefautOui) { '(O/n)' } else { '(o/N)' }
        $r = Read-Host "$Question $suffixe"
        if (-not $r) { [bool]$DefautOui } else { [bool]($r -match '^[oOyY]') }
    })
}

function Format-Colonnes {
    <# Des objets → des lignes de texte à colonnes alignées (l'œil lit une grille, pas une phrase). #>
    param([Parameter(Mandatory)] [object[]] $Elements, [Parameter(Mandatory)] [string[]] $Colonnes, [int] $MaxColonne = 42)
    $cellules = @()
    foreach ($e in $Elements) {
        $cellules += , @($Colonnes | ForEach-Object { $v = "$($e.$_)" -replace "\s+", ' '; if ($v.Length -gt $MaxColonne) { $v.Substring(0, $MaxColonne - 1) + '…' } else { $v } })
    }
    $largeurs = @(0) * $Colonnes.Count
    foreach ($ligne in $cellules) { for ($i = 0; $i -lt $Colonnes.Count; $i++) { if ($ligne[$i].Length -gt $largeurs[$i]) { $largeurs[$i] = $ligne[$i].Length } } }
    $textes = @()
    foreach ($ligne in $cellules) {
        $parts = @(); for ($i = 0; $i -lt $Colonnes.Count; $i++) { if ($largeurs[$i] -gt 0) { $parts += $ligne[$i].PadRight($largeurs[$i]) } }
        $textes += ($parts -join '   ').TrimEnd()
    }
    return $textes
}

function Read-Choix {
    <#
      Un choix parmi des objets, au clavier (flèches + filtre en tapant avec
      Spectre, numéros sinon). -Colonnes : propriétés affichées, alignées ;
      -Libelle : scriptblock qui rend le texte d'une ligne ($_) ; sinon "$e".
      -Multiple : sélection multiple (rend un tableau).
      Sans -SansAnnulation, une entrée « Annuler » ferme le script.
    #>
    param(
        [Parameter(Mandatory)] [string]   $Titre,
        [Parameter(Mandatory)] [AllowEmptyCollection()] [object[]] $Elements,
        [string[]]    $Colonnes,
        [scriptblock] $Libelle,
        [string]      $Aide = '',
        [switch]      $Multiple,
        [switch]      $SansAnnulation
    )
    if (-not $Elements -or $Elements.Count -eq 0) { throw "Rien à choisir pour « $Titre »." }
    $textes = @()
    if ($Colonnes) { $textes = @(Format-Colonnes -Elements $Elements -Colonnes $Colonnes) }
    else {
        foreach ($e in $Elements) { $textes += $(if ($Libelle) { "$(ForEach-Object -InputObject $e -Process $Libelle)" } else { "$e" }) }
    }
    # Libellés uniques : c'est par eux qu'on retrouve l'objet choisi.
    $vus = @{}
    for ($i = 0; $i -lt $textes.Count; $i++) {
        if ($vus.ContainsKey($textes[$i])) { $textes[$i] = "$($textes[$i])  ($($i + 1))" }
        $vus[$textes[$i]] = $i
    }
    $annuler = '← Annuler'
    $aide = if ($Aide) { $Aide } elseif ($Multiple) { 'espace pour cocher, Entrée pour valider' } elseif ($textes.Count -gt 6) { 'tapez pour filtrer' } else { '' }
    $question = (Format-Question $Titre) + $(if ($aide) { "  [grey50]$(Protect-Texte $aide)[/]" } else { '' })

    $indices = Invoke-Rendu -Composant 'sélection' -Spectre {
        $affiches = @($textes | ForEach-Object { Protect-Texte $_ })
        Write-SpectreHost ''
        if ($Multiple) {
            $p = @{ Choices = $affiches; Color = $script:Ui.Accent }
            if (Test-Param 'Read-SpectreMultiSelection' 'PageSize') { $p.PageSize = 14 }
            $p[(Get-NomInvite 'Read-SpectreMultiSelection')] = $question
            $retenus = @(Read-SpectreMultiSelection @p)
            @($retenus | ForEach-Object { [array]::IndexOf($affiches, "$_") } | Where-Object { $_ -ge 0 })
        } else {
            $liste = @($affiches); if (-not $SansAnnulation) { $liste += $annuler }
            $p = @{ Choices = $liste; Color = $script:Ui.Accent }
            if (Test-Param 'Read-SpectreSelection' 'PageSize') { $p.PageSize = 14 }
            if ($liste.Count -gt 6 -and (Test-Param 'Read-SpectreSelection' 'EnableSearch')) { $p.EnableSearch = $true }
            $p[(Get-NomInvite 'Read-SpectreSelection')] = $question
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
        Invoke-SpectreCommandWithStatus -Title "[grey62]$(Protect-Texte $Titre)[/]" -Spinner Line -Color $script:Ui.Accent -ScriptBlock { param($ctx) $script:Ui.Statut = $ctx; $script:Ui.Resultat = & $act } | Out-Null
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
    if ($script:Ui.Statut) { try { $script:Ui.Statut.Status = "[grey62]$(Protect-Texte $Texte)[/]" } catch { } ; return }
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
    $texte = $Ligne.Message
    $console = switch ($Ligne.Niveau) { 'Succes' { 'Gray' } 'Alerte' { 'Yellow' } 'Erreur' { 'Red' } 'Simule' { 'DarkYellow' } default { 'DarkGray' } }
    $puceConsole = switch ($Ligne.Niveau) { 'Succes' { '+' } 'Alerte' { '!' } 'Erreur' { 'x' } 'Simule' { '>' } default { '·' } }
    Invoke-Rendu -Composant 'journal' -Spectre {
        $a = $script:Ui.Accent
        switch ($Ligne.Niveau) {
            'Succes' { Write-SpectreHost "      [$($script:Ui.Succes)]·[/] [grey85]$(Protect-Texte $texte)[/]" }
            'Alerte' { Write-SpectreHost "      [yellow]![/] [yellow]$(Protect-Texte $texte)[/]" }
            'Erreur' { Write-SpectreHost "      [red]✗[/] [red]$(Protect-Texte $texte)[/]" }
            'Simule' { Write-SpectreHost "      [$a]▸[/] [grey62]$(Protect-Texte ($texte -replace '^SIMULATION : ', ''))[/]" }
            default  { Write-SpectreHost "      [grey50]·[/] [grey62]$(Protect-Texte $texte)[/]" }
        }
    } -Repli { Write-Host "       $puceConsole $texte" -ForegroundColor $console }
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

function Write-LigneEtape {
    <# La ligne de verdict d'une étape : coche, nom, durée calée à droite. #>
    param([Parameter(Mandatory)] $Etape, [string] $Suffixe = '')
    $largeur = Get-Largeur
    $nom = $Etape.Nom
    $droite = if ($Etape.Etat -eq 'ignoree') { 'ignorée' } else { "$($Etape.Duree) s$Suffixe" }
    $espace = [Math]::Max(2, $largeur - 4 - $nom.Length - $droite.Length)
    Invoke-Rendu -Composant 'étape' -Spectre {
        $coche = switch ($Etape.Etat) { 'ok' { "[$($script:Ui.Succes)]✓[/]" } 'echec' { '[red]✗[/]' } default { '[grey35]○[/]' } }
        $texte = if ($Etape.Etat -eq 'ignoree') { "[grey35]$(Protect-Texte $nom)[/]" } else { "[white]$(Protect-Texte $nom)[/]" }
        Write-SpectreHost "  $coche $texte$(' ' * $espace)[grey50]$(Protect-Texte $droite)[/]"
    } -Repli {
        $symbole = switch ($Etape.Etat) { 'ok' { '[OK]' } 'echec' { '[KO]' } default { '[--]' } }
        $couleur = switch ($Etape.Etat) { 'ok' { 'Green' } 'echec' { 'Red' } default { 'DarkGray' } }
        Write-Host ("  {0} {1}{2}{3}" -f $symbole, $nom, (' ' * $espace), $droite) -ForegroundColor $couleur
    }
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
    if ($Ignorer) { Write-LigneEtape -Etape $etape; return $null }
    $script:Ui.Tampon = New-Object System.Collections.ArrayList
    $chrono = [Diagnostics.Stopwatch]::StartNew()
    $resultat = $null; $erreur = $null
    try {
        if (Test-Spectre) {
            $act = $Action
            $script:Ui.Resultat = $null
            try {
                Invoke-SpectreCommandWithStatus -Title "[grey62]$(Protect-Texte $Nom)[/]" -Spinner Line -Color $script:Ui.Accent -ScriptBlock { param($ctx) $script:Ui.Statut = $ctx; $script:Ui.Resultat = & $act } | Out-Null
                $resultat = $script:Ui.Resultat
            } finally { $script:Ui.Statut = $null; $script:Ui.Resultat = $null }
        } else {
            Write-Host ("  [..] {0}" -f $Nom) -ForegroundColor DarkGray
            $resultat = & $Action
        }
    } catch { $erreur = Get-MessageErreur $_ }
    $chrono.Stop()
    $etape.Duree = [math]::Round($chrono.Elapsed.TotalSeconds, 1)
    $tampon = @($script:Ui.Tampon); $script:Ui.Tampon = $null
    $simule = @($tampon | Where-Object { $_.Niveau -eq 'Simule' }).Count -gt 0
    if ($erreur) { $etape.Etat = 'echec'; $etape.Detail = $erreur } else { $etape.Etat = 'ok' }
    Write-LigneEtape -Etape $etape -Suffixe $(if ($simule) { '  ·  simulée' } else { '' })
    foreach ($l in $tampon) { Write-LigneJournal -Ligne $l }
    if ($erreur) {
        Add-Journal -Message "$Nom : $erreur" -Categorie $Categorie -Niveau Erreur
        if ($Critique) { throw "Étape critique en échec : $Nom — $erreur" }
        return $null
    }
    return $resultat
}

function Show-Checklist {
    <# Le bilan des étapes, en fin de session : une ligne par étape, le compte en tête. #>
    $ok = @($script:Etapes | Where-Object { $_.Etat -eq 'ok' }).Count
    $ko = @($script:Etapes | Where-Object { $_.Etat -eq 'echec' }).Count
    $ig = @($script:Etapes | Where-Object { $_.Etat -eq 'ignoree' }).Count
    Show-Section 'Bilan'
    Invoke-Rendu -Composant 'bilan' -Spectre {
        $parts = @("[bold $($script:Ui.Succes)]$ok réussie$(if ($ok -gt 1) { 's' })[/]")
        if ($ko -gt 0) { $parts += "[bold red]$ko en échec[/]" } else { $parts += "[grey50]0 en échec[/]" }
        $parts += "[grey50]$ig ignorée$(if ($ig -gt 1) { 's' })[/]"
        if (Test-Simulation) { $parts += "[$($script:Ui.Accent)]simulation — rien n'a été écrit[/]" }
        Write-SpectreHost "  $($parts -join '   [grey35]·[/]   ')"
        Write-SpectreHost ''
        foreach ($e in $script:Etapes) {
            Write-LigneEtape -Etape $e
            if ($e.Etat -eq 'echec' -and $e.Detail) { Write-SpectreHost "      [red]$(Protect-Texte $e.Detail)[/]" }
        }
        Write-SpectreHost ''
    } -Repli {
        Write-Host "  $ok réussie(s) · $ko en échec · $ig ignorée(s)$(if (Test-Simulation) { ' · SIMULATION' })" -ForegroundColor Cyan
        Write-Host ''
        foreach ($e in $script:Etapes) {
            Write-LigneEtape -Etape $e
            if ($e.Etat -eq 'echec' -and $e.Detail) { Write-Host "       $($e.Detail)" -ForegroundColor Red }
        }
        Write-Host ''
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
    <# Exchange Online puis Microsoft Graph (délégué, interactif), pour le tenant de la société — comme avant. #>
    param([Parameter(Mandatory)] $Societe)
    if (-not $Societe.tenantId) { throw "Pas de tenant Microsoft 365 configuré pour $($Societe.id)." }
    $upn = Get-UpnAdministrateur -Societe $Societe
    Import-Module ExchangeOnlineManagement -ErrorAction Stop
    Import-Module Microsoft.Graph.Authentication -ErrorAction Stop

    Show-Note "Connexion à Exchange Online ($upn) — fenêtre du navigateur." -Niveau Sourdine
    Connect-ExchangeOnline -UserPrincipalName $upn -ShowBanner:$false -ShowProgress:$false
    Add-Journal -Message "Connecté à Exchange Online ($upn)." -Categorie Exchange -Niveau Succes
    Show-Note "Connexion à Microsoft Graph (tenant $($Societe.id)) — fenêtre du navigateur." -Niveau Sourdine
    Connect-MgGraph -TenantId $Societe.tenantId -Scopes 'User.ReadWrite.All', 'Directory.ReadWrite.All' -NoWelcome
    Add-Journal -Message "Connecté à Microsoft Graph (tenant $($Societe.id))." -Categorie Licences -Niveau Succes
}

function Disconnect-M365 {
    try { if (Get-Command Disconnect-ExchangeOnline -ErrorAction SilentlyContinue) { Disconnect-ExchangeOnline -Confirm:$false -ErrorAction SilentlyContinue *> $null } } catch { }
    try { if (Get-Command Disconnect-MgGraph -ErrorAction SilentlyContinue) { Disconnect-MgGraph -ErrorAction SilentlyContinue *> $null } } catch { }
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
