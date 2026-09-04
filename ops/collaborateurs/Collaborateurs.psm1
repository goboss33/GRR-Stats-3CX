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
$script:Ui          = @{ Spectre = $false; Tampon = $null; Params = @{}; Avertissements = @{}; Accent = '#8ccaae'; Ombre = '#085440'; Ligne = 'grey27'; Succes = 'green'; Champ = '#17211f'; LigneY = -1 }
$script:Ecran       = @{ Actif = $false; Flux = $false; Mot = ''; Titre = ''; Etapes = @(); Index = 0; Resume = [ordered]@{}; Lignes = @() }

$script:Categories  = @('AD', 'Groupes', 'Exchange', 'Licences', 'Delegations', '3CX', 'Planner', 'General')
$script:EtapeCourante = ''                                      # l'étape en cours d'exécution : chaque ligne du journal s'y rattache

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
        [Parameter(Mandatory)] [string]    $Operation,    # "entree" | "sortie"
        [string[]] $Etapes = @(),                         # la frise du parcours
        [bool]     $Interactif = $true                    # $false en mode -Job : un journal, pas des écrans
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

    $mot = if ($Operation -eq 'entree') { 'Entrée' } else { 'Sortie' }
    Initialize-Ecran -Mot $mot -Titre "$mot d'un collaborateur" -Etapes $Etapes -Actif $Interactif
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
#  INTERFACE
#
#  Modèle d'ÉCRAN, pas de défilement : à chaque question, la console est
#  effacée et tout est redessiné — un en-tête permanent (le titre, la
#  frise des étapes, l'encadré « sous l'œil »), puis le contenu de la SEULE
#  étape en cours, puis l'invite. Le bloc est centré horizontalement dans
#  une colonne de largeur fixe et posé au tiers supérieur de la fenêtre.
#
#  Pendant l'exécution on bascule en mode FLUX : l'en-tête reste en haut et
#  les étapes s'écrivent à la suite, puisque leur nombre n'est pas connu
#  d'avance. Hors interactif (-Job), aucun effacement : un journal simple.
#
#  Tout passe par Write-Ligne, qui pose la marge gauche. Rien n'écrit
#  directement dans la console en dehors de cette couche.
# ====================================================================

function Initialize-Interface {
    $script:Ui.Spectre = $false
    try { [Console]::OutputEncoding = [Text.Encoding]::UTF8; [Console]::InputEncoding = [Text.Encoding]::UTF8 } catch { }

    # Couleurs de la charte Gérofinance (le dégradé du site : #085440 → #8ccaae),
    # surchargeables dans config.json → interface.
    $reglagesUi = Get-Prop -Objet $script:Config -Nom 'interface'
    foreach ($cle in @('Accent', 'Ombre', 'Ligne', 'Succes', 'Champ')) {
        $valeur = "$(Get-Prop -Objet $reglagesUi -Nom $cle.ToLower() -Defaut '')"
        if ($valeur -match '^(#[0-9a-fA-F]{6}|[a-z][a-z0-9_]*)$') { $script:Ui[$cle] = $valeur }
    }

    if ($PSVersionTable.PSVersion.Major -lt 7 -or $env:COLLABORATEURS_SANS_SPECTRE) { return }
    $m = Get-Module -ListAvailable PwshSpectreConsole -ErrorAction SilentlyContinue | Sort-Object Version -Descending | Select-Object -First 1
    if (-not $m -or $m.Version -lt [version]'2.0') { return }
    try { Import-Module PwshSpectreConsole -MinimumVersion 2.0 -ErrorAction Stop; $script:Ui.Spectre = $true } catch { return }
}

function Test-Spectre { return [bool]$script:Ui.Spectre }

function Protect-Texte {
    <# Échappe les crochets : Spectre lit [ceci] comme du balisage. À appliquer à TOUTE donnée affichée. #>
    param([AllowNull()] [AllowEmptyString()] [string] $Texte)
    if ($null -eq $Texte) { return '' }
    return $Texte.Replace('[', '[[').Replace(']', ']]')
}

function ConvertFrom-Markup {
    <# Le texte nu derrière le balisage : sert à mesurer une ligne et à l'affichage de repli. #>
    param([AllowNull()] [AllowEmptyString()] [string] $Markup)
    if (-not $Markup) { return '' }
    $t = $Markup.Replace('[[', "`u{0001}").Replace(']]', "`u{0002}")
    $t = [regex]::Replace($t, '\[[^\]]*\]', '')
    return $t.Replace("`u{0001}", '[').Replace("`u{0002}", ']')
}

function Get-LongueurVisible {
    param([AllowNull()] [AllowEmptyString()] [string] $Markup)
    return (ConvertFrom-Markup $Markup).Length
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
    param(
        [Parameter(Mandatory)] [scriptblock] $Spectre,
        [Parameter(Mandatory)] [scriptblock] $Repli,
        [string] $Composant = 'composant',
        [switch] $Valeur          # sans lui, ce que le bloc écrit est jeté : un affichage ne rend rien
    )
    if (Test-Spectre) {
        $r = $null; $echec = $false
        try { $r = & $Spectre }
        catch {
            $echec = $true
            if (-not $script:Ui.Avertissements.ContainsKey($Composant)) {
                $script:Ui.Avertissements[$Composant] = $true
                Write-Host "  (interface Spectre indisponible pour « $Composant » : $(Get-MessageErreur $_) — affichage simple)" -ForegroundColor DarkYellow
            }
        }
        if (-not $echec) { if ($Valeur) { return $r } else { return } }
    }
    $r = & $Repli
    if ($Valeur) { return $r }
}

function Out-Rendu {
    <# Affiche un objet Spectre (table…) quel que soit le mode de sortie. #>
    param([Parameter(Mandatory, ValueFromPipeline)] $Rendu)
    process {
        if (Get-Command Out-SpectreHost -ErrorAction SilentlyContinue) { $Rendu | Out-SpectreHost } else { $Rendu | Out-Host }
    }
}

# ------------------------------------------------------------ GÉOMÉTRIE

function Get-Colonne {
    <# Largeur de la colonne de contenu : la console, plafonnée pour rester lisible. #>
    $largeurFenetre = 120
    try { $largeurFenetre = [Console]::WindowWidth } catch { }
    $l = [Math]::Min($largeurFenetre - 6, 96)
    # Sur une fenêtre étroite, mieux vaut serrer que déborder : une ligne plus
    # large que la console se replie et casse le compte de lignes du sélecteur.
    if ($l -lt 48) { $l = [Math]::Max(20, $largeurFenetre - 6) }
    return $l
}

function Get-Marge {
    <# Ce qu'il faut à gauche pour centrer la colonne dans la fenêtre. #>
    $m = 2
    try { $m = [Math]::Max(2, [int][Math]::Floor(([Console]::WindowWidth - (Get-Colonne)) / 2)) } catch { }
    return $m
}

function Get-Hauteur {
    $h = 40
    try { $h = [Console]::WindowHeight } catch { }
    if ($h -lt 16) { $h = 16 }
    return $h
}

function Format-Ajuste {
    <# Coupe un texte nu à la largeur donnée, aux espaces ; rend les lignes. #>
    param([AllowEmptyString()] [string] $Texte, [int] $Largeur)
    if ($Largeur -lt 12) { $Largeur = 12 }
    $lignes = @()
    foreach ($paragraphe in ($Texte -split "`r?`n")) {
        if ($paragraphe.Length -le $Largeur) { $lignes += $paragraphe; continue }
        $courant = ''
        foreach ($mot in ($paragraphe -split ' ')) {
            if ($courant -and ($courant.Length + 1 + $mot.Length) -gt $Largeur) { $lignes += $courant; $courant = '' }
            while ($mot.Length -gt $Largeur) {
                # un mot plus long que la colonne (adresse, JSON) : on le tranche
                if ($courant) { $lignes += $courant; $courant = '' }
                $lignes += $mot.Substring(0, $Largeur)
                $mot = $mot.Substring($Largeur)
            }
            $courant = if ($courant) { "$courant $mot" } else { $mot }
        }
        if ($courant) { $lignes += $courant }
    }
    return @($lignes)
}

function Format-Deux {
    <# Un texte à gauche, un texte à droite, calés sur la largeur de la colonne. #>
    param([string] $Gauche, [string] $Droite)
    $espace = [Math]::Max(2, (Get-Colonne) - (Get-LongueurVisible $Gauche) - (Get-LongueurVisible $Droite))
    return "$Gauche$(' ' * $espace)$Droite"
}

# ------------------------------------------------------------- ÉCRITURE

function Write-Ligne {
    <# LA sortie : une ligne de balisage, précédée de la marge de centrage. #>
    param([AllowEmptyString()] [string] $Markup = '', [int] $Retrait = 0)
    $marge = ' ' * ((Get-Marge) + $Retrait)
    Invoke-Rendu -Composant 'ligne' -Spectre { Write-SpectreHost "$marge$Markup" } -Repli { Write-Host "$marge$(ConvertFrom-Markup $Markup)" }
}

function Write-Vide { param([int] $Combien = 1) ; for ($i = 0; $i -lt $Combien; $i++) { Write-Ligne '' } }

function New-Encadre {
    <# Un cadre, rendu sous forme de lignes de balisage : mesurable, donc centrable. #>
    param([string] $Titre = '', [AllowEmptyCollection()] [string[]] $Lignes = @(), [string] $Couleur = '')
    $c = if ($Couleur) { $Couleur } else { $script:Ui.Ligne }
    $largeur = Get-Colonne
    $interieur = $largeur - 4
    $sortie = @()
    if ($Titre) {
        $reste = [Math]::Max(0, $largeur - 5 - (Get-LongueurVisible $Titre))
        $sortie += "[$c]╭─[/] $Titre [$c]$('─' * $reste)╮[/]"
    } else {
        $sortie += "[$c]╭$('─' * ($largeur - 2))╮[/]"
    }
    foreach ($l in $Lignes) {
        $bourre = [Math]::Max(0, $interieur - (Get-LongueurVisible $l))
        $sortie += "[$c]│[/] $l$(' ' * $bourre) [$c]│[/]"
    }
    $sortie += "[$c]╰$('─' * ($largeur - 2))╯[/]"
    return $sortie
}

# ---------------------------------------------------------------- ÉCRAN

function Initialize-Ecran {
    <# Ouvre le mode écran : efface la console et retient les étapes du parcours. #>
    param(
        [Parameter(Mandatory)] [string] $Mot,          # SORTIE | ENTRÉE — le grand titre
        [Parameter(Mandatory)] [string] $Titre,        # « Sortie d'un collaborateur »
        [Parameter(Mandatory)] [AllowEmptyCollection()] [string[]] $Etapes,
        [bool] $Actif = $true
    )
    $script:Ecran.Mot = $Mot
    $script:Ecran.Titre = $Titre
    $script:Ecran.Etapes = @($Etapes)
    $script:Ecran.Index = 0
    $script:Ecran.Resume = [ordered]@{}
    $script:Ecran.Lignes = @()
    $script:Ecran.Flux = $false
    $script:Ecran.Actif = $Actif
    if ($Actif) { try { Clear-Host } catch { } }
    Show-Ecran
}

function Get-LignesEnTete {
    <# L'en-tête permanent, en lignes de balisage. #>
    $e = $script:Ecran
    $r = $script:Reglages
    $a = $script:Ui.Accent
    $lignes = @()

    # Le grand titre — remplacé par une ligne en capitales sur les fenêtres courtes.
    if ((Get-Hauteur) -ge 34 -and $e.Mot) {
        $lignes += Get-LignesTitre -Texte $e.Mot
        $lignes += ''
    } elseif ($e.Mot) {
        $lignes += "[bold $a]$(Protect-Texte $e.Mot.ToUpper())[/]"
    }

    $modes = @()
    if ($r.Simulation) { $modes += "[$($script:Ui.Succes)]●[/] [grey62]SIMULATION[/]" } else { $modes += "[red]●[/] [grey62]RÉEL[/]" }
    if ($r.ModeTest)   { $modes += "[grey50]●[/] [grey62]MODE TEST[/]" }
    $lignes += Format-Deux -Gauche "[bold white]$(Protect-Texte $e.Titre)[/]" -Droite ($modes -join '   ')
    $lignes += "[grey50]$(Protect-Texte "Service Informatique · $($script:Session.Operateur) · $(Get-Date -Format 'dd.MM.yyyy HH:mm')")[/]"
    $lignes += ''

    # La frise des étapes : faites, en cours, à venir.
    if ($e.Etapes.Count -gt 0) {
        $frise = @()
        for ($i = 0; $i -lt $e.Etapes.Count; $i++) {
            $nom = Protect-Texte $e.Etapes[$i]
            $n = $i + 1
            if ($n -lt $e.Index)      { $frise += "[$($script:Ui.Succes)]✓[/] [grey50]$nom[/]" }
            elseif ($n -eq $e.Index)  { $frise += "[$a]▸[/] [bold $a]$nom[/]" }
            else                      { $frise += "[grey35]○ $nom[/]" }
        }
        $lignes += ($frise -join '  [grey27]·[/]  ')
        $lignes += ''
    }

    # Ce qu'on garde sous l'œil, sur une ligne.
    if ($e.Resume.Count -gt 0) {
        $bouts = @()
        foreach ($k in $e.Resume.Keys) { $bouts += "[grey50]$(Protect-Texte "$k")[/] [white]$(Protect-Texte "$($e.Resume[$k])")[/]" }
        $texte = $bouts -join '   [grey27]·[/]   '
        $trop = (Get-LongueurVisible $texte) - ((Get-Colonne) - 4)
        if ($trop -gt 0) {
            # trop long : on ne garde que les dernières décisions, celles qui comptent
            while ($bouts.Count -gt 1 -and ((Get-LongueurVisible ($bouts -join '   ·   ')) -gt ((Get-Colonne) - 8))) { $bouts = $bouts[1..($bouts.Count - 1)] }
            $texte = "[grey35]…[/]   " + ($bouts -join '   [grey27]·[/]   ')
        }
        $lignes += New-Encadre -Lignes @($texte)
        $lignes += ''
    }
    return @($lignes)
}

function Show-Ecran {
    <#
      Efface et redessine : en-tête, contenu de l'étape en cours, puis on
      rend la main à l'appelant qui posera son invite en dessous.
      -Reserve : le nombre de lignes que l'invite va prendre, pour le calcul
      du centrage vertical.
    #>
    param([int] $Reserve = 3, [switch] $EnHaut)
    if (-not $script:Ecran.Actif -or $script:Ecran.Flux) { return }
    try { Clear-Host } catch { }
    $entete = @(Get-LignesEnTete)
    $corps = @($script:Ecran.Lignes)
    $haut = if ($EnHaut) { 1 } else { [Math]::Max(1, [int][Math]::Floor(((Get-Hauteur) - $entete.Count - $corps.Count - $Reserve) / 3)) }
    Write-Vide $haut
    foreach ($l in $entete) { Write-Ligne $l }
    foreach ($l in $corps) { Write-Ligne $l }
    if ($corps.Count -gt 0) { Write-Vide }
}

function Set-Etape {
    <# On passe à l'étape suivante : le contenu de la précédente disparaît. #>
    param([Parameter(Mandatory)] [string] $Nom)
    $i = [array]::IndexOf($script:Ecran.Etapes, $Nom)
    $script:Ecran.Index = if ($i -ge 0) { $i + 1 } else { $script:Ecran.Index + 1 }
    $script:Ecran.Lignes = @()
    if ($script:Ecran.Flux -or -not $script:Ecran.Actif) {
        Write-Vide
        Write-Ligne "[$($script:Ui.Accent)]▸[/] [bold $($script:Ui.Accent)]$(Protect-Texte $Nom)[/]"
        Write-Vide
        return
    }
    Show-Ecran
}

function Add-Resume {
    <# Une décision à garder sous l'œil, dans l'encadré du haut. #>
    param([Parameter(Mandatory)] [string] $Cle, [Parameter(Mandatory)] [AllowEmptyString()] [string] $Valeur)
    $script:Ecran.Resume[$Cle] = $Valeur
    Show-Ecran
}

function Add-Ligne {
    <# Une ligne au contenu de l'étape en cours. Redessine tant qu'on est en mode écran. #>
    param([AllowEmptyString()] [string] $Markup = '')
    if ($script:Ecran.Flux -or -not $script:Ecran.Actif) { Write-Ligne $Markup; return }
    $script:Ecran.Lignes += $Markup
    Show-Ecran
}

function Start-Flux {
    <# Fin des questions : l'en-tête se cale en haut et on écrit à la suite. #>
    if ($script:Ecran.Actif) { Show-Ecran -Reserve 0 -EnHaut }
    $script:Ecran.Flux = $true
    Write-Vide
}

# ---------------------------------------------------------- AFFICHAGES

function Show-Note {
    <# Une ligne d'information. Niveau : Info | Sourdine | Succes | Alerte | Erreur #>
    param([Parameter(Mandatory)] [AllowEmptyString()] [string] $Texte, [ValidateSet('Info', 'Sourdine', 'Succes', 'Alerte', 'Erreur')] [string] $Niveau = 'Info')
    $couleur = switch ($Niveau) { 'Sourdine' { 'grey50' } 'Succes' { $script:Ui.Succes } 'Alerte' { 'yellow' } 'Erreur' { 'red' } default { 'grey85' } }
    $puce = switch ($Niveau) { 'Succes' { '●' } 'Alerte' { '!' } 'Erreur' { '✗' } default { ' ' } }
    foreach ($l in (Format-Ajuste -Texte $Texte -Largeur ((Get-Colonne) - 4))) {
        Add-Ligne "[$couleur]$puce[/]  [$couleur]$(Protect-Texte $l)[/]"
        $puce = ' '
    }
}

function Show-Constat {
    <#
      Un constat qui doit se voir : pastille pleine, énoncé en clair, et les
      valeurs qu'il porte en dessous, en gras. « Identifiant et adresse
      libres dans l'AD » puis « gfavon · georges.favon@grrsa.ch ».
    #>
    param(
        [Parameter(Mandatory)] [string] $Titre,
        [string[]] $Valeurs = @(),
        [ValidateSet('Succes', 'Alerte', 'Info')] [string] $Niveau = 'Succes'
    )
    $couleur = switch ($Niveau) { 'Alerte' { 'yellow' } 'Info' { $script:Ui.Accent } default { $script:Ui.Succes } }
    Add-Ligne "[$couleur]●[/]  [white]$(Protect-Texte $Titre)[/]"
    $valables = @($Valeurs | Where-Object { "$_" })
    if ($valables.Count -gt 0) {
        Add-Ligne "   [bold $couleur]$(($valables | ForEach-Object { Protect-Texte "$_" }) -join "[/][grey35]  ·  [/][bold $couleur]")[/]"
    }
}

function Show-Recap {
    <# Le récapitulatif clé → valeur, dans un cadre. #>
    param([Parameter(Mandatory)] [System.Collections.Specialized.OrderedDictionary] $Paires, [string] $Titre = 'Récapitulatif')
    $large = 4
    foreach ($k in $Paires.Keys) { if ("$k".Length -gt $large) { $large = "$k".Length } }
    $lignes = @('')
    foreach ($k in $Paires.Keys) {
        $valeurs = @(Format-Ajuste -Texte "$($Paires[$k])" -Largeur ((Get-Colonne) - $large - 8))
        $etiquette = "[grey62]$(Protect-Texte "$k".PadRight($large))[/]"
        foreach ($v in $valeurs) {
            $lignes += "$etiquette   [white]$(Protect-Texte $v)[/]"
            $etiquette = "[grey62]$(' ' * $large)[/]"
        }
    }
    $lignes += ''
    foreach ($l in (New-Encadre -Titre "[bold white]$(Protect-Texte $Titre)[/]" -Lignes $lignes)) { Add-Ligne $l }
}

function Show-Panneau {
    <# Un bloc de texte encadré (aperçu d'un message, identifiants…). #>
    param([Parameter(Mandatory)] [AllowEmptyString()] [string] $Texte, [string] $Titre = '', [switch] $Accent)
    $couleur = if ($Accent) { $script:Ui.Accent } else { $script:Ui.Ligne }
    $lignes = @('')
    foreach ($l in (Format-Ajuste -Texte $Texte -Largeur ((Get-Colonne) - 6))) { $lignes += "[white]$(Protect-Texte $l)[/]" }
    $lignes += ''
    $titre = if ($Titre) { "[bold $(if ($Accent) { $couleur } else { 'white' })]$(Protect-Texte $Titre)[/]" } else { '' }
    foreach ($l in (New-Encadre -Titre $titre -Lignes $lignes -Couleur $couleur)) { Add-Ligne $l }
}

function Show-Tableau {
    <# Des objets en colonnes alignées. #>
    param([Parameter(Mandatory)] [AllowEmptyCollection()] [object[]] $Lignes, [string[]] $Colonnes, [string] $Titre = '')
    if (-not $Lignes -or $Lignes.Count -eq 0) { return }
    if (-not $Colonnes) { $Colonnes = @($Lignes[0].PSObject.Properties | ForEach-Object { $_.Name }) }
    if ($Titre) { Add-Ligne "[grey62]$(Protect-Texte $Titre)[/]" }
    $entete = [pscustomobject]@{}
    foreach ($c in $Colonnes) { $entete | Add-Member -NotePropertyName $c -NotePropertyValue $c }
    $textes = @(Format-Colonnes -Elements (@($entete) + @($Lignes)) -Colonnes $Colonnes)
    Add-Ligne "[$($script:Ui.Accent)]$(Protect-Texte $textes[0])[/]"
    for ($i = 1; $i -lt $textes.Count; $i++) { Add-Ligne "[white]$(Protect-Texte $textes[$i])[/]" }
}

function Show-Filet {
    <# Un filet plein, à la largeur de la colonne. #>
    param([string] $Couleur = '')
    if (-not $Couleur) { $Couleur = $script:Ui.Ligne }
    Add-Ligne "[$Couleur]$('─' * (Get-Colonne))[/]"
}

# ------------------------------------------------------------- INVITES
#
#  Les invites sont dessinées ICI, pas par Spectre : lui pose ses listes et
#  ses saisies au bord gauche de la console, ce qui casse le centrage. On
#  garde la main sur la colonne, le pointeur, le fond du champ.
#
#  Repli automatique dès que la console ne se pilote pas (entrée redirigée,
#  sortie capturée) : menu numéroté et Read-Host, comme avant.

function Test-ConsolePilotable {
    <# Peut-on lire les touches et déplacer le curseur ? (pas quand l'entrée est redirigée) #>
    try { return (-not [Console]::IsInputRedirected) -and (-not [Console]::IsOutputRedirected) } catch { return $false }
}

function Get-AnsiFond {
    <# La séquence qui pose une couleur de fond 24 bits sur ce que la console va écrire. #>
    param([Parameter(Mandatory)] [string] $Hex)
    if ($Hex -notmatch '^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$') { return '' }
    $r = [Convert]::ToInt32($Matches[1], 16); $v = [Convert]::ToInt32($Matches[2], 16); $b = [Convert]::ToInt32($Matches[3], 16)
    return "$([char]27)[48;2;$r;$v;${b}m"
}
function Get-AnsiFin { return "$([char]27)[0m" }

function Format-Question {
    <# « ? » en accent puis la question en gras. #>
    param([Parameter(Mandatory)] [string] $Texte, [string] $Aide = '')
    $q = "[$($script:Ui.Accent)]?[/]  [bold white]$(Protect-Texte $Texte)[/]"
    if ($Aide) { $q += "   [grey50]$(Protect-Texte $Aide)[/]" }
    return $q
}

function Format-Champ {
    <# Un champ déjà rempli, dans la liste des réponses de l'étape. #>
    param([Parameter(Mandatory)] [string] $Libelle, [AllowEmptyString()] [string] $Valeur)
    return "[$($script:Ui.Succes)]●[/]  [grey62]$(Protect-Texte $Libelle.PadRight(20))[/][white]$(Protect-Texte $Valeur)[/]"
}

function Write-Champ {
    <#
      Le champ de saisie : un cadre au fond légèrement plus clair, sous la
      question. Rend la position (colonne, ligne) où poser le curseur.
    #>
    param([int] $Largeur)
    $c = $script:Ui.Ligne
    $fond = $script:Ui.Champ
    Write-Ligne "[$c]╭$('─' * ($Largeur - 2))╮[/]"
    $y = -1
    try { $y = [Console]::CursorTop } catch { }
    Write-Ligne "[$c]│[/][on $fond]$(' ' * ($Largeur - 2))[/][$c]│[/]"
    Write-Ligne "[$c]╰$('─' * ($Largeur - 2))╯[/]"
    return @{ X = (Get-Marge) + 2; Y = $y }
}

function Read-Texte {
    <#
      Une saisie libre. La question en haut, le champ juste en dessous,
      aligné avec elle — pas au bout de la ligne.
    #>
    param([Parameter(Mandatory)] [string] $Invite, [string] $Defaut = '', [switch] $Obligatoire, [switch] $QuitteSurQ, [string] $Aide = '')
    $aide = $Aide
    if ($Defaut) { $aide = if ($aide) { "$aide — Entrée pour « $Defaut »" } else { "Entrée pour « $Defaut »" } }
    do {
        Show-Ecran -Reserve 7
        $valeur = $null
        if (Test-ConsolePilotable) {
            try {
                Write-Ligne (Format-Question -Texte $Invite -Aide $aide)
                Write-Vide
                $pos = Write-Champ -Largeur (Get-Colonne)
                if ($pos.Y -lt 0) { throw 'position du curseur inconnue' }
                [Console]::SetCursorPosition($pos.X, $pos.Y)
                [Console]::Write((Get-AnsiFond $script:Ui.Champ))
                try { $valeur = "$(Read-Host)" } finally { [Console]::Write((Get-AnsiFin)) }
            } catch {
                $valeur = $null
                if (-not $script:Ui.Avertissements.ContainsKey('champ')) {
                    $script:Ui.Avertissements['champ'] = $true
                    Add-Ligne "[yellow]!  Champ de saisie indisponible ($(Protect-Texte (Get-MessageErreur $_))) — saisie simple.[/]"
                }
            }
        }
        if ($null -eq $valeur) {
            Write-Ligne (Format-Question -Texte $Invite -Aide $aide)
            $valeur = "$(Read-Host "$(' ' * (Get-Marge))›")"
        }
        $valeur = "$valeur".Trim()
        if ($QuitteSurQ -and $valeur -eq 'q') { Stop-Script }
        if (-not $valeur -and $Defaut) { $valeur = $Defaut }
        if ($Obligatoire -and -not $valeur) { Add-Ligne '[yellow]!  Valeur obligatoire.[/]' }
    } while ($Obligatoire -and -not $valeur)
    return $valeur
}

function Read-Champ {
    <# Une question de formulaire : la réponse rejoint la liste des champs remplis. #>
    param([Parameter(Mandatory)] [string] $Libelle, [string] $Defaut = '', [switch] $Obligatoire, [switch] $QuitteSurQ, [string] $SiVide = '—', [string] $Aide = '')
    $v = Read-Texte -Invite $Libelle -Defaut $Defaut -Obligatoire:$Obligatoire -QuitteSurQ:$QuitteSurQ -Aide $Aide
    Add-Ligne (Format-Champ -Libelle $Libelle -Valeur $(if ($v) { $v } else { $SiVide }))
    return $v
}

function Read-TexteMultiligne {
    <#
      Un bloc de texte tapé ou COLLÉ. Fin de saisie : deux lignes vides
      d'affilée, ou une ligne ne contenant qu'un point. Les lignes vides
      isolées (paragraphes) sont conservées.
    #>
    param([Parameter(Mandatory)] [string] $Invite)
    Show-Ecran -Reserve 10
    $a = $script:Ui.Accent
    Write-Ligne (Format-Question -Texte $Invite -Aide 'deux fois Entrée pour terminer, ou un point seul')
    Write-Vide
    Write-Ligne "[$($script:Ui.Ligne)]╭$('─' * ((Get-Colonne) - 2))╮[/]"
    $lignes = New-Object System.Collections.ArrayList
    $vides = 0
    while ($true) {
        Invoke-Rendu -Composant 'invite multiligne' -Spectre { Write-SpectreHost "$(' ' * (Get-Marge))[$($script:Ui.Ligne)]│[/] [$a]›[/] " -NoNewline } -Repli { Write-Host "$(' ' * (Get-Marge))| > " -NoNewline }
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
    Write-Ligne "[$($script:Ui.Ligne)]╰$('─' * ((Get-Colonne) - 2))╯[/]"
    return (@($lignes) -join "`n")
}

function Format-Colonnes {
    <# Des objets → des lignes à colonnes alignées (l'œil lit une grille, pas une phrase). #>
    param([Parameter(Mandatory)] [object[]] $Elements, [Parameter(Mandatory)] [string[]] $Colonnes, [int] $MaxColonne = 38)
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

function Read-Liste {
    <#
      LE sélecteur : flèches, filtre en tapant, Entrée pour valider, Échap
      pour annuler ; espace pour cocher en sélection multiple. Dessiné dans
      la colonne, ligne courante sur fond légèrement plus clair.
      Rend les index choisis dans $Textes, ou @(-1) si annulé.
    #>
    param(
        [Parameter(Mandatory)] [string] $Question,
        [Parameter(Mandatory)] [string[]] $Textes,
        [string] $Aide = '',
        [switch] $Multiple,
        [switch] $SansAnnulation,
        [int[]] $Precoches = @()       # index déjà cochés à l'ouverture (sélection multiple)
    )
    $largeur = Get-Colonne
    $marge = Get-Marge
    # PowerShell ne distingue pas les majuscules : un paramètre $Coches et une
    # variable $coches sont la même chose. D'où le nom distinct du paramètre.
    $coches = @{}
    foreach ($c in $Precoches) { if ($c -ge 0 -and $c -lt $Textes.Count) { $coches[$c] = $true } }
    $filtre = ''
    $curseur = 0
    $sommet = 0
    $indices = @(0..($Textes.Count - 1))

    Show-Ecran -Reserve ([Math]::Min($Textes.Count, 14) + 6)
    $haut = -1
    try { $haut = [Console]::CursorTop } catch { }
    if ($haut -lt 0) { throw 'position du curseur inconnue' }
    # ce qui reste sous le bloc : la liste s'y adapte, elle ne doit jamais faire défiler
    $visible = [Math]::Max(3, [Math]::Min($Textes.Count, (Get-Hauteur) - $haut - 6))
    $curseurVisible = $true
    try { $curseurVisible = [Console]::CursorVisible; [Console]::CursorVisible = $false } catch { }

    try {
        while ($true) {
            # Ce que le filtre laisse passer.
            $indices = @()
            for ($i = 0; $i -lt $Textes.Count; $i++) {
                if (-not $filtre -or $Textes[$i] -like "*$filtre*") { $indices += $i }
            }
            if ($indices.Count -eq 0) { $indices = @() }
            if ($curseur -ge $indices.Count) { $curseur = [Math]::Max(0, $indices.Count - 1) }
            if ($curseur -lt $sommet) { $sommet = $curseur }
            if ($curseur -ge $sommet + $visible) { $sommet = $curseur - $visible + 1 }
            if ($sommet -gt [Math]::Max(0, $indices.Count - $visible)) { $sommet = [Math]::Max(0, $indices.Count - $visible) }

            # Dessin, toujours sur le même nombre de lignes : rien à effacer.
            try { if ($haut -ge 0) { [Console]::SetCursorPosition(0, $haut) } } catch { }
            $aideAffichee = @()
            if ($Multiple) { $aideAffichee += 'espace pour cocher' }
            $aideAffichee += '↑↓ choisir'
            $aideAffichee += 'Entrée valider'
            if (-not $SansAnnulation) { $aideAffichee += 'Échap annuler' }
            if ($Textes.Count -gt 6) { $aideAffichee += 'tapez pour filtrer' }
            if ($Aide) { $aideAffichee = @($Aide) + $aideAffichee }
            Write-Ligne (Format-Question -Texte $Question)
            $prefixe = if ($filtre) { "filtre « $filtre »   " } else { '' }
            while ($aideAffichee.Count -gt 1 -and ($prefixe.Length + ($aideAffichee -join '  ·  ').Length) -gt $largeur - 4) {
                $aideAffichee = @($aideAffichee[0..($aideAffichee.Count - 2)])
            }
            $etat = "[grey50]$(Protect-Texte ($aideAffichee -join '  ·  '))[/]"
            if ($filtre) { $etat = "[$($script:Ui.Accent)]filtre « $(Protect-Texte $filtre) »[/]   $etat" }
            Write-Ligne "   $etat$(' ' * [Math]::Max(0, $largeur - 3 - (Get-LongueurVisible $etat)))"
            Write-Ligne ''

            for ($r = 0; $r -lt $visible; $r++) {
                $n = $sommet + $r
                if ($n -ge $indices.Count) { Write-Ligne (' ' * $largeur); continue }
                $i = $indices[$n]
                $texte = $Textes[$i]
                $largeurCase = if ($Multiple) { 2 } else { 0 }
                $place = $largeur - 4 - $largeurCase
                if ($texte.Length -gt $place) { $texte = $texte.Substring(0, $place - 1) + '…' }
                $case = ''
                if ($Multiple) {
                    $case = if ($coches.ContainsKey($i)) { "[$($script:Ui.Succes)]●[/] " } else { '[grey35]○[/] ' }
                }
                $encre = if ($n -eq $curseur) { 'white' } else { 'grey70' }
                $corps = "$case[$encre]$(Protect-Texte $texte)[/]$(' ' * [Math]::Max(0, $place - $texte.Length))"
                if ($n -eq $curseur) {
                    Write-Ligne "[$($script:Ui.Accent)]›[/] [on $($script:Ui.Champ)] $corps [/]"
                } else {
                    Write-Ligne "   $corps "
                }
            }
            $pied = if ($indices.Count -eq 0) { 'aucune correspondance' } elseif ($indices.Count -gt $visible) { "$($curseur + 1) / $($indices.Count)" } else { '' }
            Write-Ligne "   [grey35]$(Protect-Texte $pied)[/]$(' ' * [Math]::Max(0, $largeur - 3 - $pied.Length))"

            # Une touche.
            $t = [Console]::ReadKey($true)
            switch ($t.Key) {
                'UpArrow'    { if ($curseur -gt 0) { $curseur-- } }
                'DownArrow'  { if ($curseur -lt $indices.Count - 1) { $curseur++ } }
                'PageUp'     { $curseur = [Math]::Max(0, $curseur - $visible) }
                'PageDown'   { $curseur = [Math]::Min($indices.Count - 1, $curseur + $visible) }
                'Home'       { $curseur = 0 }
                'End'        { $curseur = [Math]::Max(0, $indices.Count - 1) }
                'Escape'     { if (-not $SansAnnulation) { return @(-1) } }
                'Backspace'  { if ($filtre) { $filtre = $filtre.Substring(0, $filtre.Length - 1); $curseur = 0; $sommet = 0 } }
                'Spacebar'   {
                    if ($Multiple -and $indices.Count -gt 0) {
                        $i = $indices[$curseur]
                        if ($coches.ContainsKey($i)) { $coches.Remove($i) } else { $coches[$i] = $true }
                        if ($curseur -lt $indices.Count - 1) { $curseur++ }
                    } elseif (-not $Multiple) { $filtre += ' '; $curseur = 0; $sommet = 0 }
                }
                'Enter' {
                    if ($Multiple) { return @($coches.Keys | Sort-Object) }
                    if ($indices.Count -gt 0) { return @($indices[$curseur]) }
                }
                default {
                    if (($t.KeyChar -and [char]::IsLetterOrDigit($t.KeyChar)) -or ($t.KeyChar -in @('-', '_', '.', '@', ''''))) {
                        $filtre += $t.KeyChar; $curseur = 0; $sommet = 0
                    }
                }
            }
        }
    } finally {
        try { [Console]::CursorVisible = $curseurVisible } catch { }
    }
}

function Read-Choix {
    <#
      Un choix parmi des objets. -Colonnes : propriétés affichées, alignées ;
      -Libelle : scriptblock qui rend le texte d'une ligne ($_) ; sinon "$e".
      -Multiple : sélection multiple. Sans -SansAnnulation, Échap ferme.
    #>
    param(
        [Parameter(Mandatory)] [string]   $Titre,
        [Parameter(Mandatory)] [AllowEmptyCollection()] [object[]] $Elements,
        [string[]]    $Colonnes,
        [scriptblock] $Libelle,
        [string]      $Aide = '',
        [switch]      $Multiple,
        [switch]      $SansAnnulation,
        [int[]]       $IndicesCoches = @()   # sélection multiple : les éléments déjà cochés à l'ouverture
    )
    if (-not $Elements -or $Elements.Count -eq 0) { throw "Rien à choisir pour « $Titre »." }
    $textes = @()
    if ($Colonnes) { $textes = @(Format-Colonnes -Elements $Elements -Colonnes $Colonnes) }
    else { foreach ($e in $Elements) { $textes += $(if ($Libelle) { "$(ForEach-Object -InputObject $e -Process $Libelle)" } else { "$e" }) } }

    $indices = $null
    if (Test-ConsolePilotable) {
        try { $indices = @(Read-Liste -Question $Titre -Textes $textes -Aide $Aide -Multiple:$Multiple -SansAnnulation:$SansAnnulation -Precoches $IndicesCoches) }
        catch {
            $indices = $null
            # L'avertissement rejoint le contenu de l'étape : il survit au redessin, on le voit.
            if (-not $script:Ui.Avertissements.ContainsKey('sélection')) {
                $script:Ui.Avertissements['sélection'] = $true
                Add-Ligne "[yellow]!  Sélecteur au clavier indisponible ($(Protect-Texte (Get-MessageErreur $_))) — menu numéroté.[/]"
            }
        }
    }
    if ($null -eq $indices) {
        # Console non pilotable, ou sélecteur en défaut : menu numéroté.
        Show-Ecran -Reserve ($textes.Count + 4)
        Write-Ligne (Format-Question -Texte $Titre -Aide $Aide)
        for ($i = 0; $i -lt $textes.Count; $i++) { Write-Ligne ("  [grey70]{0,3}) $(Protect-Texte $textes[$i])[/]" -f ($i + 1)) }
        $nums = @()
        do {
            $saisie = Read-Host "$(' ' * (Get-Marge))$(if ($Multiple) { 'Numéros séparés par des virgules (q pour quitter)' } else { 'Numéro (q pour quitter)' })"
            if ($saisie -eq 'q') { $nums = @(-1); break }
            $nums = @($saisie -split '[,; ]+' | Where-Object { $_ -match '^\d+$' } | ForEach-Object { [int]$_ - 1 } | Where-Object { $_ -ge 0 -and $_ -lt $textes.Count })
        } while ($nums.Count -eq 0)
        $indices = @($nums)
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

function Confirm-Choix {
    <# Oui / Non, au clavier, le choix par défaut sous le pointeur. #>
    param([Parameter(Mandatory)] [string] $Question, [switch] $DefautOui)
    $choix = if ($DefautOui) { @('Oui', 'Non') } else { @('Non', 'Oui') }
    $elements = @($choix | ForEach-Object { [pscustomobject]@{ Texte = $_ } })
    $r = Read-Choix -Titre $Question -Elements $elements -Colonnes Texte -SansAnnulation
    return ("$($r.Texte)" -eq 'Oui')
}

# -------------------------------------------------------------- ATTENTE

function Start-Ligne {
    <#
      Écrit une ligne « en cours » et retient sa position, pour pouvoir la
      réécrire ou l'effacer une fois le travail fini. Spectre sait animer un
      indicateur, mais il le pose au bord gauche de la console : on perdrait
      l'alignement de la colonne.
    #>
    param([Parameter(Mandatory)] [string] $Markup)
    $script:Ui.LigneY = -1
    # Sortie capturée (transcription, redirection) : pas de jeu avec le curseur,
    # la ligne « en cours » reste et le verdict s'écrit en dessous.
    if (Test-ConsolePilotable) { try { $script:Ui.LigneY = [Console]::CursorTop } catch { } }
    Write-Ligne $Markup
}

function Update-Ligne {
    <#
      Réécrit la ligne « en cours » — seulement si elle est toujours la
      dernière écrite : dès que la console a défilé, sa position ne veut plus
      rien dire et on rend $false pour que l'appelant écrive à la suite.
      -Rembobiner : laisse le curseur sur la ligne, qui sera donc écrasée.
    #>
    param([AllowEmptyString()] [string] $Markup = '', [switch] $Rembobiner)
    $y = $script:Ui.LigneY
    if ($y -lt 0) { return $false }
    try {
        if ([Console]::CursorTop -ne $y + 1) { return $false }
        [Console]::SetCursorPosition(0, $y)
        $bourre = [Math]::Max(0, (Get-Colonne) - (Get-LongueurVisible $Markup))
        Write-Ligne "$Markup$(' ' * $bourre)"
        if ($Rembobiner) { [Console]::SetCursorPosition(0, $y); $script:Ui.LigneY = $y }
        return $true
    } catch { return $false }
}

function Invoke-Attente {
    <# Un travail qui dure (lecture du PBX, connexion…) : une ligne d'attente, puis le résultat. #>
    param([Parameter(Mandatory)] [string] $Titre, [Parameter(Mandatory)] [scriptblock] $Action)
    $script:Ui.Tampon = New-Object System.Collections.ArrayList
    Start-Ligne "[$($script:Ui.Accent)]▸[/]  [grey62]$(Protect-Texte $Titre)…[/]"
    try {
        return & $Action
    } finally {
        # La ligne d'attente s'efface : ce qui suit prendra sa place.
        Update-Ligne -Markup '' -Rembobiner | Out-Null
        $script:Ui.LigneY = -1
        $tampon = @($script:Ui.Tampon); $script:Ui.Tampon = $null
        foreach ($l in $tampon) { Write-LigneJournal -Ligne $l }
    }
}

function Update-Statut {
    <# Le texte de la ligne d'attente, pendant un travail long (scan des boîtes…). #>
    param([Parameter(Mandatory)] [string] $Texte, [int] $Pourcent = -1)
    $fait = Update-Ligne -Markup "[$($script:Ui.Accent)]▸[/]  [grey62]$(Protect-Texte $Texte)[/]"
    if ($fait) { return }
    if ($Pourcent -ge 0) { Write-Progress -Activity $Texte -PercentComplete $Pourcent } else { Write-Progress -Activity $Texte }
}

function Show-Erreur {
    <# Un échec qui arrête tout : encadré rouge, à la marge, lisible. #>
    param([Parameter(Mandatory)] [string] $Message)
    Write-Vide 2
    $lignes = @('')
    foreach ($l in (Format-Ajuste -Texte $Message -Largeur ((Get-Colonne) - 6))) { $lignes += "[red]$(Protect-Texte $l)[/]" }
    $lignes += ''
    foreach ($l in (New-Encadre -Titre '[bold red] Arrêt [/]' -Lignes $lignes -Couleur 'red')) { Write-Ligne $l }
    Write-Vide
}

function Stop-Script {
    param([int] $Code = 0)
    Write-Vide
    Write-Ligne '[grey50]Fermeture du script.[/]'
    Disconnect-M365
    try { Stop-Transcript | Out-Null } catch { }
    exit $Code
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
    $ligne = [pscustomobject]@{ Quand = Get-Date; Categorie = $Categorie; Niveau = $Niveau; Message = $Message; Etape = "$($script:EtapeCourante)" }
    [void] $script:Journal.Add($ligne)
    # Pendant une étape, l'affichage attend la fin de l'indicateur d'activité.
    if ($null -ne $script:Ui.Tampon) { [void] $script:Ui.Tampon.Add($ligne); return }
    Write-LigneJournal -Ligne $ligne
}

function Write-LigneJournal {
    <#
      Une ligne sous son étape, tenue par un filet vertical : la lecture
      suit la colonne. Le texte est coupé à la largeur utile — les charges
      JSON et les longues listes ne partent plus à la ligne n'importe où.
    #>
    param([Parameter(Mandatory)] $Ligne)
    $couleur = switch ($Ligne.Niveau) {
        'Succes' { 'grey85' } 'Alerte' { 'yellow' } 'Erreur' { 'red' } 'Simule' { 'grey62' } default { 'grey50' }
    }
    $puce = switch ($Ligne.Niveau) {
        'Succes' { "[$($script:Ui.Succes)]●[/]" } 'Alerte' { '[yellow]![/]' } 'Erreur' { '[red]✗[/]' }
        'Simule' { "[$($script:Ui.Accent)]▸[/]" } default { '[grey35]·[/]' }
    }
    $texte = if ($Ligne.Niveau -eq 'Simule') { $Ligne.Message -replace '^SIMULATION : ', '' } else { $Ligne.Message }
    $guide = "[$($script:Ui.Ligne)]│[/]"
    $premier = $true
    foreach ($l in (Format-Ajuste -Texte $texte -Largeur ((Get-Colonne) - 9))) {
        if ($premier) { Add-Ligne "   $guide  $puce [$couleur]$(Protect-Texte $l)[/]"; $premier = $false }
        else { Add-Ligne "   $guide    [$couleur]$(Protect-Texte $l)[/]" }
    }
}

function Invoke-Ecriture {
    <#
      LA porte unique des écritures. En simulation : la description va au
      journal, l'action n'est pas exécutée. Sinon : l'action est exécutée et
      son résultat rendu. Aucune cmdlet n'écrit ailleurs qu'ici.
    #>
    param(
        [Parameter(Mandatory)] [string]      $Description,   # ce qui serait fait, en clair
        [Parameter(Mandatory)] [scriptblock] $Action,
        [ValidateSet('AD', 'Groupes', 'Exchange', 'Licences', 'Delegations', '3CX', 'Planner', 'General')] [string] $Categorie = 'General',
        [switch] $SansJournal      # l'appelant résume lui-même (une ligne pour vingt groupes, pas vingt lignes)
    )
    if (Test-Simulation) {
        if (-not $SansJournal) { Add-Journal -Message "SIMULATION : $Description" -Categorie $Categorie -Niveau Simule }
        return $null
    }
    return & $Action
}

function Write-LigneEtape {
    <# La ligne de verdict d'une étape : marqueur, nom, durée calée à droite. #>
    param([Parameter(Mandatory)] $Etape, [string] $Suffixe = '', [switch] $EnCours)
    $droite = if ($EnCours) { '' } elseif ($Etape.Etat -eq 'ignoree') { 'ignorée' } else { "$($Etape.Duree) s$Suffixe" }
    $marqueur = if ($EnCours) { "[$($script:Ui.Accent)]▸[/]" } else {
        switch ($Etape.Etat) { 'ok' { "[$($script:Ui.Succes)]✓[/]" } 'echec' { '[red]✗[/]' } default { '[grey35]○[/]' } }
    }
    $encre = if ($Etape.Etat -eq 'ignoree' -and -not $EnCours) { 'grey35' } else { 'white' }
    $markup = Format-Deux -Gauche "$marqueur  [$encre]$(Protect-Texte $Etape.Nom)[/]" -Droite "[grey50]$(Protect-Texte $droite)[/]"
    if ($EnCours) { Start-Ligne $markup; return }
    # Le verdict prend la place de la ligne « en cours » si elle est encore visible.
    if (-not (Update-Ligne -Markup $markup)) { Write-Ligne $markup }
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
    Write-LigneEtape -Etape $etape -EnCours
    $script:EtapeCourante = $Nom
    try { $resultat = & $Action } catch { $erreur = Get-MessageErreur $_ }
    $chrono.Stop()
    $etape.Duree = [math]::Round($chrono.Elapsed.TotalSeconds, 1)
    $tampon = @($script:Ui.Tampon); $script:Ui.Tampon = $null
    $simule = @($tampon | Where-Object { $_.Niveau -eq 'Simule' }).Count -gt 0
    if ($erreur) { $etape.Etat = 'echec'; $etape.Detail = $erreur } else { $etape.Etat = 'ok' }
    Write-LigneEtape -Etape $etape -Suffixe $(if ($simule) { '  ·  simulée' } else { '' })
    $script:Ui.LigneY = -1
    foreach ($l in $tampon) { Write-LigneJournal -Ligne $l }
    if ($erreur) {
        Add-Journal -Message $erreur -Categorie $Categorie -Niveau Erreur
        $script:EtapeCourante = ''
        if ($Critique) { throw "Étape critique en échec : $Nom — $erreur" }
        Write-Vide
        return $null
    }
    $script:EtapeCourante = ''
    Write-Vide
    return $resultat
}

function Show-Checklist {
    <# Le bilan des étapes, en fin de session : le compte, puis une ligne par étape. #>
    $ok = @($script:Etapes | Where-Object { $_.Etat -eq 'ok' }).Count
    $ko = @($script:Etapes | Where-Object { $_.Etat -eq 'echec' }).Count
    $ig = @($script:Etapes | Where-Object { $_.Etat -eq 'ignoree' }).Count
    $parts = @("[bold $($script:Ui.Succes)]$ok réussie$(if ($ok -gt 1) { 's' })[/]")
    if ($ko -gt 0) { $parts += "[bold red]$ko en échec[/]" } else { $parts += '[grey50]0 en échec[/]' }
    $parts += "[grey50]$ig ignorée$(if ($ig -gt 1) { 's' })[/]"
    if (Test-Simulation) { $parts += "[$($script:Ui.Accent)]simulation — rien n'a été écrit[/]" }
    Write-Vide
    Write-Ligne "[$($script:Ui.Ligne)]$('─' * (Get-Colonne))[/]"
    Write-Vide
    Write-Ligne ($parts -join '   [grey27]·[/]   ')
    Write-Vide
    foreach ($e in $script:Etapes) {
        Write-LigneEtape -Etape $e
        if ($e.Etat -eq 'echec' -and $e.Detail) {
            foreach ($l in (Format-Ajuste -Texte $e.Detail -Largeur ((Get-Colonne) - 6))) { Write-Ligne "   [red]$(Protect-Texte $l)[/]" }
        }
    }
    Write-Vide
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

function Get-LignesTitre {
    <# Le mot en grand, plein, avec son ombre portée — rendu en lignes de balisage. #>
    param([Parameter(Mandatory)] [string] $Texte)
    $grille = Get-GrilleTitre -Texte $Texte
    if (-not $grille) { return @("[bold $($script:Ui.Accent)]$(Protect-Texte $Texte.ToUpper())[/]") }
    $bloc = [string][char]0x2588   # █
    $lignes = @()
    foreach ($ligne in $grille) {
        $sb = New-Object Text.StringBuilder
        foreach ($suite in (Get-Suites -Ligne $ligne)) {
            switch ($suite.Signe) {
                'P' { [void]$sb.Append("[$($script:Ui.Accent)]$($bloc * $suite.Nombre)[/]") }
                'O' { [void]$sb.Append("[$($script:Ui.Ombre)]$($bloc * $suite.Nombre)[/]") }
                default { [void]$sb.Append(' ' * $suite.Nombre) }
            }
        }
        $lignes += $sb.ToString()
    }
    return @($lignes)
}

function Show-Titre {
    param([Parameter(Mandatory)] [string] $Texte)
    foreach ($l in (Get-LignesTitre -Texte $Texte)) { Write-Ligne $l }
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
        # Actif sauf si l'annuaire affirme le contraire : sur ce domaine, la
        # propriété revient parfois vide, et un vide n'est pas un compte fermé.
        $liste += [pscustomobject]@{ Type = 'Utilisateur'; Nom = $u.Name; Adresse = $adresse; Actif = ($u.Enabled -ne $false); Detail = "$($u.Title)" }
    }
    $r = $Recherche.Replace("'", "''")
    try {
        foreach ($g in @(Get-ADGroup -Filter "(Name -like '*$r*' -or mail -like '*$r*') -and mail -like '*'" -Properties mail, Description @Ad)) {
            $liste += [pscustomobject]@{ Type = 'Liste'; Nom = $g.Name; Adresse = "$($g.mail)"; Actif = $true; Detail = "$($g.Description)" }
        }
    } catch { }
    return @($liste | Sort-Object Type, Nom)
}

function Find-AdParAdresse {
    <#
      Qui porte déjà cette adresse ? On regarde l'UPN, l'attribut mail ET les
      alias (proxyAddresses) : une adresse peut être libre en UPN et déjà prise
      en alias, et Exchange refusera quand même.
    #>
    param([Parameter(Mandatory)] [string] $Adresse, [Parameter(Mandatory)] [hashtable] $Ad)
    $a = $Adresse.Replace("'", "''")
    $filtre = "UserPrincipalName -eq '$a' -or mail -eq '$a' -or proxyAddresses -like '*:$a'"
    return @(Get-ADUser -Filter $filtre -Properties mail, proxyAddresses @Ad -ErrorAction SilentlyContinue | Select-Object -First 1)[0]
}

function New-IdentifiantLibre {
    <#
      Une proposition d'identifiant pour un homonyme : d'abord la pratique
      maison (deux, puis trois lettres du prénom + le nom), ensuite un chiffre.
      Le sAMAccountName ne dépasse pas 20 caractères.
    #>
    param([Parameter(Mandatory)] [string] $Prenom, [Parameter(Mandatory)] [string] $Nom, [Parameter(Mandatory)] [hashtable] $Ad)
    $p = (Remove-Accents $Prenom).ToLower() -replace '\s+', ''
    $n = (Remove-Accents $Nom).ToLower() -replace '\s+', ''
    if (-not $p -or -not $n) { return '' }
    $candidats = @()
    for ($k = 2; $k -le [Math]::Min(4, $p.Length); $k++) { $candidats += $p.Substring(0, $k) + $n }
    for ($i = 2; $i -le 9; $i++) { $candidats += $p.Substring(0, 1) + $n + $i }
    foreach ($c in $candidats) {
        if ($c.Length -gt 20) { continue }
        if (-not (Get-ADUser -Filter "SamAccountName -eq '$c'" @Ad -ErrorAction SilentlyContinue)) { return $c }
    }
    return ''
}

function New-AdresseLibre {
    <# Une proposition d'adresse qui ne heurte personne : la base, puis 2, 3, 4… #>
    param([Parameter(Mandatory)] [string] $Base, [Parameter(Mandatory)] [string] $Domaine, [Parameter(Mandatory)] [hashtable] $Ad)
    for ($i = 2; $i -le 20; $i++) {
        $essai = "$Base$i$Domaine"
        if (-not (Find-AdParAdresse -Adresse $essai -Ad $Ad)) { return $essai }
    }
    return ''
}

function Get-AdGroupesDe {
    <#
      Les groupes d'un compte : nom lisible et DN — c'est le DN qu'on donne à
      Add-ADGroupMember, le nom affiché pouvant différer du sAMAccountName.

      TROIS chemins, du plus direct au plus sûr, parce qu'aucun ne marche
      partout : l'attribut MemberOf du compte ; puis
      Get-ADPrincipalGroupMembership ; puis la recherche des groupes qui
      citent ce compte (`member`), qui lit le lien à l'endroit, et non le
      lien retour — le seul chemin qui ne dépend pas des attributs du compte.
      Le groupe principal (« Utilisateurs du domaine ») est écarté : tout
      compte l'a déjà, le recopier n'a pas de sens.
    #>
    param([Parameter(Mandatory)] [string] $Sam, [Parameter(Mandatory)] [hashtable] $Ad)
    $dns = @()
    $principal = ''
    $compte = $null
    try { $compte = Get-ADUser -Identity $Sam -Properties MemberOf, PrimaryGroup, DistinguishedName @Ad } catch { }
    if ($compte) {
        $dns = @($compte.MemberOf)
        $principal = "$(Get-Prop -Objet $compte -Nom 'PrimaryGroup' -Defaut '')"
    }
    if ($dns.Count -eq 0) {
        try { $dns = @(Get-ADPrincipalGroupMembership -Identity $Sam @Ad | Select-Object -ExpandProperty DistinguishedName) } catch { $dns = @() }
    }
    if ($dns.Count -le 1 -and $compte) {
        # Le lien à l'endroit : on demande aux groupes qui ils contiennent.
        try {
            $dnCompte = "$($compte.DistinguishedName)" -replace '\\', '\5c' -replace '\(', '\28' -replace '\)', '\29' -replace '\*', '\2a'
            $parGroupe = @(Get-ADGroup -LDAPFilter "(member=$dnCompte)" @Ad | Select-Object -ExpandProperty DistinguishedName)
            if ($parGroupe.Count -gt $dns.Count) { $dns = $parGroupe }
        } catch { }
    }
    if ($principal) { $dns = @($dns | Where-Object { "$_" -ne $principal }) }
    return @($dns | Where-Object { $_ } | ForEach-Object {
        $nom = ([regex]::Match("$_", '^CN=((?:\\,|[^,])+)').Groups[1].Value) -replace '\\,', ','
        if (-not $nom) { $nom = "$_" }
        [pscustomobject]@{ Nom = $nom; DN = "$_" }
    } | Sort-Object Nom)
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
    Invoke-Ecriture -Categorie AD -Description "Déclencher la synchronisation delta sur $serveur" -Action {
        Invoke-Command -ComputerName $serveur -ScriptBlock {
            Import-Module ADSync -ErrorAction Stop
            Start-ADSyncSyncCycle -PolicyType Delta | Out-Null
        } -ErrorAction Stop
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
    Show-Note "Connexion à Microsoft Graph (tenant $($Societe.id)) — fenêtre du navigateur." -Niveau Sourdine
    Connect-MgGraph -TenantId $Societe.tenantId -Scopes 'User.ReadWrite.All', 'Directory.ReadWrite.All' -NoWelcome
    Show-Constat -Titre 'Connecté à Exchange Online et à Microsoft Graph' -Valeurs @($upn, $Societe.id)
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
        # Le détail par licence, en dessous, vaut description : pas de ligne de commande en plus.
        Invoke-Ecriture -SansJournal -Categorie Licences -Description "Retirer $($aRetirer.Count) licence(s)" -Action {
            Set-MgUserLicense -UserId $Upn -RemoveLicenses $aRetirer -AddLicenses @() | Out-Null
        } | Out-Null
    }
    $skus = Get-MgSubscribedSku
    foreach ($l in $licences) {
        $sku = $skus | Where-Object { $_.SkuId -eq $l.SkuId }
        $libelle = if ($noms.PSObject.Properties[$l.SkuPartNumber]) { $noms.($l.SkuPartNumber) } else { $l.SkuPartNumber }
        $stock = if ($sku) { " · $($sku.PrepaidUnits.Enabled - $sku.ConsumedUnits) restantes sur $($sku.PrepaidUnits.Enabled)" } else { '' }
        if ($aRetirer -contains $l.SkuId) {
            if (Test-Simulation) { Add-Journal -Message "SIMULATION : retirer $libelle$stock" -Categorie Licences -Niveau Simule }
            else { Add-Journal -Message "$libelle — retirée$stock" -Categorie Licences -Niveau Succes }
        } else { Add-Journal -Message "$libelle — conservée$stock" -Categorie Licences -Niveau Alerte }
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
        Add-Journal -Message "Toutes les boîtes analysées, cache reconstruit." -Categorie Delegations
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
        Write-Progress -Activity 'Analyse des boîtes aux lettres' -Completed
        $cache = [pscustomobject]@{ LastUpdated = (Get-Date).ToString('o'); Redirections = $redirs; Delegations = $delegs }
        # Le cache est une trace locale, pas une écriture métier : il se met à jour même en simulation.
        $cache | ConvertTo-Json -Depth 4 | Set-Content -Path $fichier -Encoding UTF8
    } else {
        Add-Journal -Message "D'après le cache du $([datetime]::Parse($cache.LastUpdated).ToString('dd.MM.yyyy à HH:mm'))." -Categorie Delegations
    }

    $redirVers = @($cache.Redirections | Where-Object { "$($_.Vers)".ToLower() -eq $cible })
    $mesDelegs = @($cache.Delegations | Where-Object { "$($_.Qui)".ToLower() -eq $cible })
    if ($redirVers.Count -eq 0 -and $mesDelegs.Count -eq 0) { Add-Journal -Message 'Aucune redirection ni délégation vers ce compte.' -Categorie Delegations -Niveau Succes; return }
    if ($redirVers.Count -gt 0) {
        Add-Journal -Message "$($redirVers.Count) boîte(s) redirigent encore vers ce compte, à corriger à la main :" -Categorie Delegations -Niveau Alerte
        foreach ($r in $redirVers) { Add-Journal -Message "  $($r.Boite)" -Categorie Delegations -Niveau Alerte }
    }
    if ($mesDelegs.Count -eq 0) { return }
    $typesFr = @{ SendOnBehalf = 'envoi de la part de'; FullAccess = 'accès complet'; SendAs = 'envoi en tant que' }
    foreach ($d in $mesDelegs) {
        $type = if ($typesFr.ContainsKey("$($d.Type)")) { $typesFr["$($d.Type)"] } else { "$($d.Type)" }
        try {
            switch ($d.Type) {
                'SendOnBehalf' {
                    Invoke-Ecriture -Categorie Delegations -Description "Retirer l'envoi de la part de sur $($d.Boite)" -Action {
                        $actuels = @((Get-Mailbox -Identity $d.Boite).GrantSendOnBehalfTo)
                        $nouveaux = @($actuels | Where-Object { $r = Get-Recipient -Identity "$_" -ErrorAction SilentlyContinue; -not $r -or "$($r.PrimarySmtpAddress)".ToLower() -ne $cible })
                        Set-Mailbox -Identity $d.Boite -GrantSendOnBehalfTo $nouveaux
                    } | Out-Null
                }
                'FullAccess' { Invoke-Ecriture -Categorie Delegations -Description "Retirer l'accès complet sur $($d.Boite)" -Action { Remove-MailboxPermission -Identity $d.Boite -User $Cible -AccessRights FullAccess -Confirm:$false | Out-Null } | Out-Null }
                'SendAs'     { Invoke-Ecriture -Categorie Delegations -Description "Retirer l'envoi en tant que sur $($d.Boite)" -Action { Remove-RecipientPermission -Identity $d.Boite -Trustee $Cible -AccessRights SendAs -Confirm:$false | Out-Null } | Out-Null }
            }
            if (-not (Test-Simulation)) { Add-Journal -Message "$type retiré sur $($d.Boite)" -Categorie Delegations -Niveau Succes }
        } catch { Add-Journal -Message "Échec du retrait « $type » sur $($d.Boite) : $(Get-MessageErreur $_)" -Categorie Delegations -Niveau Erreur }
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
        $Corps = $null,
        [string] $Libelle = ''                       # la description lisible, pour le journal
    )
    $appel = {
        $token = Connect-Xapi -Pbx $Pbx
        $params = @{ Method = $Methode; Uri = "$($Pbx.adresse)/xapi/v1/$Chemin"; Headers = @{ Authorization = "Bearer $token" }; TimeoutSec = 30 }
        if ($Corps) { $params.Body = ($Corps | ConvertTo-Json -Depth 6); $params.ContentType = 'application/json' }
        Invoke-RestMethod @params
    }
    if ($Methode -eq 'GET') { return & $appel }
    $description = $Libelle
    if (-not $description) {
        $apercu = if ($Corps) { ($Corps | ConvertTo-Json -Depth 6 -Compress) } else { '' }
        $description = "3CX $Methode $Chemin $apercu"
    }
    return Invoke-Ecriture -Categorie 3CX -Description $description -Action $appel
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
    param([Parameter(Mandatory)] $Pbx, [Parameter(Mandatory)] $File, [Parameter(Mandatory)] [AllowEmptyCollection()] [object[]] $Agents, [string] $Libelle = '')
    $corps = @{ Agents = @($Agents | ForEach-Object { @{ Number = "$($_.Number)"; SkillGroup = $(if ($_.SkillGroup) { "$($_.SkillGroup)" } else { "$($Pbx.skillGroupParDefaut)" }) } }) }
    if (-not $Libelle) { $Libelle = "File $($File.Number) : $(@($Agents).Count) agent(s)" }
    Invoke-Xapi -Pbx $Pbx -Methode PATCH -Chemin "Queues($($File.Id))" -Corps $corps -Libelle $Libelle | Out-Null
}

function Get-NomFile {
    param([Parameter(Mandatory)] $File)
    $nom = Get-Prop -Objet $File -Nom 'Name'
    return "file $($File.Number)$(if ($nom) { " « $nom »" })"
}

function Remove-XapiPosteDesFiles {
    <# Retire un poste de toutes ses files ; rend les files touchées. #>
    param([Parameter(Mandatory)] $Pbx, [Parameter(Mandatory)] [string] $Numero)
    $files = Get-XapiFilesDuPoste -Pbx $Pbx -Numero $Numero
    foreach ($f in $files) {
        $restants = @($f.Agents | Where-Object { "$($_.Number)" -ne $Numero })
        Set-XapiAgentsDeFile -Pbx $Pbx -File $f -Agents $restants -Libelle "Retirer de la $(Get-NomFile $f) — $($restants.Count) agent(s) restant(s)"
        if (-not (Test-Simulation)) { Add-Journal -Message "Retiré de la $(Get-NomFile $f)" -Categorie 3CX -Niveau Succes }
    }
    return $files
}

function Add-XapiPosteAuxFiles {
    param([Parameter(Mandatory)] $Pbx, [Parameter(Mandatory)] [string] $Numero, [Parameter(Mandatory)] [object[]] $Files)
    $toutes = Get-XapiFiles -Pbx $Pbx
    foreach ($choisie in $Files) {
        $f = $toutes | Where-Object { $_.Id -eq $choisie.Id } | Select-Object -First 1
        if (-not $f) { continue }
        if (@($f.Agents | ForEach-Object { "$($_.Number)" }) -contains $Numero) { Add-Journal -Message "Déjà dans la $(Get-NomFile $f)" -Categorie 3CX; continue }
        $agents = @($f.Agents) + @([pscustomobject]@{ Number = $Numero; SkillGroup = $Pbx.skillGroupParDefaut })
        Set-XapiAgentsDeFile -Pbx $Pbx -File $f -Agents $agents -Libelle "Inscrire dans la $(Get-NomFile $f) — $($agents.Count) agent(s)"
        if (-not (Test-Simulation)) { Add-Journal -Message "Inscrit dans la $(Get-NomFile $f)" -Categorie 3CX -Niveau Succes }
    }
}

function Set-XapiPoste {
    <# Modifie un utilisateur du PBX (PATCH Users({Id})). #>
    param([Parameter(Mandatory)] $Pbx, [Parameter(Mandatory)] [int] $Id, [Parameter(Mandatory)] [hashtable] $Proprietes, [string] $Numero = '', [string] $Libelle = '')
    if (-not $Libelle) {
        $details = @($Proprietes.Keys | Sort-Object | ForEach-Object { "$_ = $(if ("$($Proprietes[$_])" -eq '') { '(vide)' } else { "$($Proprietes[$_])" })" })
        $Libelle = "Poste $(if ($Numero) { $Numero } else { "#$Id" }) : $($details -join ', ')"
    }
    Invoke-Xapi -Pbx $Pbx -Methode PATCH -Chemin "Users($Id)" -Corps $Proprietes -Libelle $Libelle | Out-Null
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
#
#  Le rapport part au helpdesk : il doit se lire d'un coup d'œil, sur un
#  téléphone comme dans Outlook. D'où : un bandeau aux couleurs de la
#  maison, le dossier en tête, LES POINTS D'ATTENTION REMONTÉS AVANT LE
#  DÉTAIL (SDA à rerouter, groupes et licences conservés…), puis les
#  étapes, puis le journal complet par catégorie.
#
#  Contraintes du courriel : Outlook rend le HTML avec le moteur de Word.
#  Pas de flexbox, pas de grille, pas de dégradé, pas de feuille de style
#  externe : des tableaux, des styles en ligne, des couleurs pleines.
# ====================================================================

$script:Palette = @{
    Marque   = '#085440'   # le vert profond de la charte
    Clair    = '#8ccaae'   # le vert clair de la charte
    Bande    = '#0b1f1a'   # le fond du bandeau : presque le noir du terminal, teinté
    Encre    = '#1f2937'
    Sourdine = '#6b7280'
    Bord     = '#e5e7eb'
    Fond     = '#f6faf8'
    Succes   = '#15803d'
    Alerte   = '#b45309'
    Erreur   = '#b91c1c'
}
$script:Police = "font-family:'Segoe UI',Arial,Helvetica,sans-serif"

function Format-Html {
    param([AllowNull()] [AllowEmptyString()] [string] $Texte)
    if ($null -eq $Texte) { return '' }
    return ([Net.WebUtility]::HtmlEncode($Texte) -replace "`r?`n", '<br>')
}

function New-TitreBloc {
    param([Parameter(Mandatory)] [string] $Texte)
    $p = $script:Palette
    return "<div style=""$($script:Police);font-size:12px;font-weight:600;letter-spacing:.09em;text-transform:uppercase;color:$($p.Marque);padding-bottom:10px"">$(Format-Html $Texte)</div>"
}

function New-BlocPaires {
    <# Un bloc « libellé → valeur » : le dossier, le récapitulatif. #>
    param([Parameter(Mandatory)] [string] $Titre, [Parameter(Mandatory)] [System.Collections.Specialized.OrderedDictionary] $Paires)
    $p = $script:Palette
    $sb = New-Object Text.StringBuilder
    [void]$sb.Append("<tr><td style=""padding:22px 28px 4px 28px"">$(New-TitreBloc $Titre)")
    [void]$sb.Append("<table width=""100%"" cellpadding=""0"" cellspacing=""0"" border=""0"" style=""border-collapse:collapse;$($script:Police);font-size:14px"">")
    foreach ($k in $Paires.Keys) {
        [void]$sb.Append("<tr><td width=""170"" style=""padding:5px 14px 5px 0;color:$($p.Sourdine);vertical-align:top;white-space:nowrap"">$(Format-Html "$k")</td>")
        [void]$sb.Append("<td style=""padding:5px 0;color:$($p.Encre);vertical-align:top"">$(Format-Html "$($Paires[$k])")</td></tr>")
    }
    [void]$sb.Append('</table></td></tr>')
    return $sb.ToString()
}

function New-BlocEncadre {
    <# Un encadré vert clair : ce que le helpdesk doit recopier (identifiants). #>
    param([Parameter(Mandatory)] [string] $Titre, [Parameter(Mandatory)] [System.Collections.Specialized.OrderedDictionary] $Paires)
    $p = $script:Palette
    $sb = New-Object Text.StringBuilder
    [void]$sb.Append("<tr><td style=""padding:22px 28px 4px 28px"">")
    [void]$sb.Append("<table width=""100%"" cellpadding=""0"" cellspacing=""0"" border=""0"" style=""border-collapse:collapse;background:$($p.Fond);border:1px solid $($p.Clair);border-radius:6px"">")
    [void]$sb.Append("<tr><td style=""padding:18px 20px"">$(New-TitreBloc $Titre)")
    [void]$sb.Append("<table width=""100%"" cellpadding=""0"" cellspacing=""0"" border=""0"" style=""border-collapse:collapse;$($script:Police);font-size:15px"">")
    foreach ($k in $Paires.Keys) {
        [void]$sb.Append("<tr><td width=""150"" style=""padding:5px 14px 5px 0;color:$($p.Sourdine);font-size:14px;vertical-align:top;white-space:nowrap"">$(Format-Html "$k")</td>")
        [void]$sb.Append("<td style=""padding:5px 0;color:$($p.Marque);font-weight:600;vertical-align:top"">$(Format-Html "$($Paires[$k])")</td></tr>")
    }
    [void]$sb.Append('</table></td></tr></table></td></tr>')
    return $sb.ToString()
}

function New-BlocListe {
    <# Une liste : groupes, files, cases à cocher de ce qui reste à faire. #>
    param([Parameter(Mandatory)] [string] $Titre, [AllowEmptyCollection()] [string[]] $Lignes, [switch] $Cases, [string] $SiVide = '—')
    $p = $script:Palette
    $sb = New-Object Text.StringBuilder
    [void]$sb.Append("<tr><td style=""padding:22px 28px 4px 28px"">$(New-TitreBloc $Titre)")
    [void]$sb.Append("<table width=""100%"" cellpadding=""0"" cellspacing=""0"" border=""0"" style=""border-collapse:collapse;$($script:Police);font-size:14px"">")
    $liste = @($Lignes | Where-Object { "$_" })
    if ($liste.Count -eq 0) { $liste = @($SiVide) }
    foreach ($l in $liste) {
        $puce = if ($Cases) { '&#9744;' } else { '&#8226;' }
        [void]$sb.Append("<tr><td width=""22"" style=""padding:4px 0;color:$($p.Clair);vertical-align:top"">$puce</td>")
        [void]$sb.Append("<td style=""padding:4px 0;color:$($p.Encre)"">$(Format-Html "$l")</td></tr>")
    }
    [void]$sb.Append('</table></td></tr>')
    return $sb.ToString()
}

function New-BlocTexte {
    <# Un bloc de texte tel quel, encadré : le message de réponse automatique. #>
    param([Parameter(Mandatory)] [string] $Titre, [AllowEmptyString()] [string] $Texte)
    if (-not $Texte) { return '' }
    $p = $script:Palette
    $sb = New-Object Text.StringBuilder
    [void]$sb.Append("<tr><td style=""padding:22px 28px 4px 28px"">$(New-TitreBloc $Titre)")
    [void]$sb.Append("<table width=""100%"" cellpadding=""0"" cellspacing=""0"" border=""0"" style=""border-collapse:collapse;border-left:3px solid $($p.Clair);background:$($p.Fond)"">")
    [void]$sb.Append("<tr><td style=""padding:14px 18px;$($script:Police);font-size:14px;color:$($p.Encre);line-height:21px"">$(Format-Html $Texte)</td></tr>")
    [void]$sb.Append('</table></td></tr>')
    return $sb.ToString()
}

function New-BlocAttention {
    <# Les lignes d'alerte du journal, remontées AVANT le détail : c'est ce qui reste à traiter à la main. #>
    $p = $script:Palette
    $alertes = @($script:Journal | Where-Object { $_.Niveau -eq 'Alerte' })
    if ($alertes.Count -eq 0) { return '' }
    $sb = New-Object Text.StringBuilder
    [void]$sb.Append("<tr><td style=""padding:22px 28px 4px 28px"">")
    [void]$sb.Append("<table width=""100%"" cellpadding=""0"" cellspacing=""0"" border=""0"" style=""border-collapse:collapse;border:1px solid #fcd9a4;background:#fffbf3;border-radius:6px"">")
    [void]$sb.Append("<tr><td style=""padding:18px 20px""><div style=""$($script:Police);font-size:12px;font-weight:600;letter-spacing:.09em;text-transform:uppercase;color:$($p.Alerte);padding-bottom:10px"">Points d'attention &#183; $($alertes.Count)</div>")
    [void]$sb.Append("<table width=""100%"" cellpadding=""0"" cellspacing=""0"" border=""0"" style=""border-collapse:collapse;$($script:Police);font-size:14px"">")
    foreach ($a in $alertes) {
        [void]$sb.Append("<tr><td width=""22"" style=""padding:4px 0;color:$($p.Alerte);vertical-align:top"">&#8226;</td>")
        [void]$sb.Append("<td style=""padding:4px 0;color:$($p.Encre)"">$(Format-Html $a.Message)</td>")
        [void]$sb.Append("<td width=""90"" align=""right"" style=""padding:4px 0;color:$($p.Sourdine);font-size:12px;vertical-align:top"">$(Format-Html $a.Categorie)</td></tr>")
    }
    [void]$sb.Append('</table></td></tr></table></td></tr>')
    return $sb.ToString()
}

function New-EnTeteRapport {
    <#
      Le titre en pavés, comme au terminal : une cellule colorée par pavé,
      fusionnées par suites (colspan). C'est ce qu'Outlook rend le plus
      fidèlement — mieux qu'une image, qui serait bloquée, ou qu'un SVG,
      qu'il ignore. Le même alphabet sert les deux supports.
    #>
    param([Parameter(Mandatory)] [string] $Mot, [Parameter(Mandatory)] [string] $Nom)
    $p = $script:Palette
    $sb = New-Object Text.StringBuilder
    [void]$sb.Append("<tr><td style=""background:$($p.Bande);padding:28px 28px 24px 28px"">")
    $grille = Get-GrilleTitre -Texte $Mot
    if ($grille) {
        $l = 7; $h = 14
        $largeurMax = 0
        foreach ($ligne in $grille) { if ($ligne.Length -gt $largeurMax) { $largeurMax = $ligne.Length } }
        [void]$sb.Append("<table cellpadding=""0"" cellspacing=""0"" border=""0"" style=""border-collapse:collapse"">")
        # Une première ligne d'une cellule par colonne : Outlook calcule alors les largeurs sans se tromper sur les colspan.
        [void]$sb.Append('<tr>')
        for ($i = 0; $i -lt $largeurMax; $i++) { [void]$sb.Append("<td width=""$l"" height=""1"" style=""width:${l}px;height:1px;font-size:1px;line-height:1px;padding:0""></td>") }
        [void]$sb.Append('</tr>')
        foreach ($ligne in $grille) {
            [void]$sb.Append('<tr>')
            $pose = 0
            foreach ($s in @(Get-Suites -Ligne $ligne)) {
                $couleur = switch ($s.Signe) { 'P' { $p.Clair } 'O' { $p.Marque } default { $p.Bande } }
                $w = $l * $s.Nombre
                [void]$sb.Append("<td colspan=""$($s.Nombre)"" width=""$w"" height=""$h"" bgcolor=""$couleur"" style=""width:${w}px;height:${h}px;background:$couleur;font-size:1px;line-height:1px;padding:0"">&nbsp;</td>")
                $pose += $s.Nombre
            }
            if ($pose -lt $largeurMax) {
                $reste = $largeurMax - $pose
                [void]$sb.Append("<td colspan=""$reste"" width=""$($l * $reste)"" height=""$h"" bgcolor=""$($p.Bande)"" style=""width:$($l * $reste)px;height:${h}px;background:$($p.Bande);font-size:1px;line-height:1px;padding:0"">&nbsp;</td>")
            }
            [void]$sb.Append('</tr>')
        }
        [void]$sb.Append('</table>')
    } else {
        [void]$sb.Append("<div style=""$($script:Police);font-size:34px;font-weight:700;letter-spacing:.12em;color:$($p.Clair)"">$(Format-Html $Mot.ToUpper())</div>")
    }
    [void]$sb.Append("<div style=""$($script:Police);font-size:15px;letter-spacing:.22em;text-transform:uppercase;color:#ffffff;padding-top:20px"">$(Format-Html $Nom)</div>")
    [void]$sb.Append('</td></tr>')
    return $sb.ToString()
}

function New-LigneDetail {
    <# Une ligne de journal, sous son étape. #>
    param([Parameter(Mandatory)] $Ligne)
    $p = $script:Palette
    $couleur = switch ($Ligne.Niveau) { 'Succes' { $p.Succes } 'Alerte' { $p.Alerte } 'Erreur' { $p.Erreur } 'Simule' { $p.Clair } default { '#9ca3af' } }
    $encre   = switch ($Ligne.Niveau) { 'Alerte' { $p.Alerte } 'Erreur' { $p.Erreur } 'Simule' { $p.Sourdine } default { '#4b5563' } }
    $texte   = if ($Ligne.Niveau -eq 'Simule') { $Ligne.Message -replace '^SIMULATION : ', '' } else { $Ligne.Message }
    $puce    = if ($Ligne.Niveau -eq 'Simule') { '&#9656;' } else { '&#8226;' }
    return "<tr><td width=""18"" style=""padding:2px 0;color:$couleur;vertical-align:top;font-size:13px"">$puce</td><td style=""padding:2px 0;color:$encre;font-size:13px;line-height:19px;word-break:break-word"">$(Format-Html $texte)</td></tr>"
}

function New-BlocEtapes {
    <#
      Les étapes, chacune avec son propre détail juste en dessous — plus de
      journal séparé. Chaque étape est enveloppée dans une balise de
      dépliage : pliée là où le client de messagerie la comprend (Apple,
      iPhone, navigateur), déployée dans Outlook, qui l'ignore. Les étapes
      en échec ou avec une alerte s'ouvrent d'office. Au-delà de douze
      lignes, le reste est dans le rapport enregistré.
    #>
    param([int] $MaxLignes = 12)
    $p = $script:Palette
    $sb = New-Object Text.StringBuilder
    [void]$sb.Append("<tr><td style=""padding:22px 28px 10px 28px"">$(New-TitreBloc 'Étapes')")
    foreach ($e in $script:Etapes) {
        $lignes = @($script:Journal | Where-Object { $_.Etape -eq $e.Nom })
        $simulee = @($lignes | Where-Object { $_.Niveau -eq 'Simule' }).Count -gt 0
        $ouvert = ($e.Etat -eq 'echec') -or (@($lignes | Where-Object { $_.Niveau -eq 'Alerte' -or $_.Niveau -eq 'Erreur' }).Count -gt 0)
        $couleur = switch ($e.Etat) { 'ok' { $p.Succes } 'echec' { $p.Erreur } default { '#9ca3af' } }
        $signe   = switch ($e.Etat) { 'ok' { '&#10003;' } 'echec' { '&#10007;' } default { '&#8211;' } }
        $droite  = if ($e.Etat -eq 'ignoree') { 'ignorée' } else { "$($e.Duree) s" }
        $encre   = if ($e.Etat -eq 'ignoree') { $p.Sourdine } else { $p.Encre }
        [void]$sb.Append("<details$(if ($ouvert) { ' open' }) style=""border-top:1px solid $($p.Bord)"">")
        [void]$sb.Append("<summary style=""$($script:Police);font-size:14px;padding:8px 0;color:$encre;cursor:pointer;list-style-position:outside"">")
        [void]$sb.Append("<span style=""color:$couleur"">$signe</span>&nbsp;&nbsp;$(Format-Html $e.Nom)")
        if ($simulee) { [void]$sb.Append("<span style=""color:$($p.Sourdine);font-size:12px"">&nbsp;&nbsp;&#183;&nbsp;&nbsp;simulée</span>") }
        [void]$sb.Append("<span style=""float:right;color:$($p.Sourdine);font-size:12px;padding-left:12px"">$droite</span>")
        [void]$sb.Append('</summary>')
        if ($lignes.Count -gt 0) {
            [void]$sb.Append("<table width=""100%"" cellpadding=""0"" cellspacing=""0"" border=""0"" style=""border-collapse:collapse;$($script:Police);margin:0 0 8px 24px"">")
            $n = 0
            foreach ($l in $lignes) {
                $n++
                if ($n -gt $MaxLignes) { break }
                [void]$sb.Append((New-LigneDetail -Ligne $l))
            }
            if ($lignes.Count -gt $MaxLignes) {
                [void]$sb.Append("<tr><td></td><td style=""padding:4px 0;color:$($p.Sourdine);font-size:12px;font-style:italic"">… et $($lignes.Count - $MaxLignes) autres lignes dans le rapport enregistré</td></tr>")
            }
            [void]$sb.Append('</table>')
        }
        [void]$sb.Append('</details>')
    }
    [void]$sb.Append('</td></tr>')
    return $sb.ToString()
}

function New-BlocHorsEtapes {
    <# Ce que le journal a noté en dehors des étapes (préparation, connexions) — seulement s'il y a quelque chose. #>
    $p = $script:Palette
    $lignes = @($script:Journal | Where-Object { -not $_.Etape -and $_.Niveau -ne 'Alerte' })
    if ($lignes.Count -eq 0) { return '' }
    $sb = New-Object Text.StringBuilder
    [void]$sb.Append("<tr><td style=""padding:6px 28px 10px 28px""><div style=""$($script:Police);font-size:12px;color:$($p.Sourdine);padding-bottom:4px"">Avant l'exécution</div>")
    [void]$sb.Append("<table width=""100%"" cellpadding=""0"" cellspacing=""0"" border=""0"" style=""border-collapse:collapse;$($script:Police)"">")
    foreach ($l in $lignes) { [void]$sb.Append((New-LigneDetail -Ligne $l)) }
    [void]$sb.Append('</table></td></tr>')
    return $sb.ToString()
}

function ConvertTo-RapportHtml {
    <#
      Le rapport complet. -Corps reçoit les blocs propres à l'opération,
      composés par le script avec New-BlocPaires / New-BlocListe /
      New-BlocEncadre. Le reste (bandeau, points d'attention, étapes,
      journal, pied) est commun aux deux.
    #>
    param(
        [Parameter(Mandatory)] [string] $Mot,      # Sortie | Entrée — dessiné en pavés
        [Parameter(Mandatory)] [string] $Nom,      # la personne
        [string] $Corps = ''
    )
    $p = $script:Palette
    $sb = New-Object Text.StringBuilder
    [void]$sb.Append("<html><body style=""margin:0;padding:0;background:#eef2f0"">")
    [void]$sb.Append("<table width=""100%"" cellpadding=""0"" cellspacing=""0"" border=""0"" style=""background:#eef2f0""><tr><td align=""center"" style=""padding:18px 10px"">")
    [void]$sb.Append("<table width=""700"" cellpadding=""0"" cellspacing=""0"" border=""0"" style=""width:700px;max-width:100%;border-collapse:collapse;background:#ffffff;border-radius:8px;overflow:hidden"">")

    # Bandeau : le mot en pavés, la personne en dessous
    [void]$sb.Append((New-EnTeteRapport -Mot $Mot -Nom $Nom))
    [void]$sb.Append("<tr><td style=""height:4px;background:$($p.Clair);font-size:0;line-height:0"">&nbsp;</td></tr>")

    # Le mode, quand il n'est pas le mode normal
    $etiquettes = @()
    if (Test-Simulation) { $etiquettes += "SIMULATION &#183; rien n'a été écrit, chaque geste est seulement décrit" }
    if (Test-ModeTest)   { $etiquettes += "MODE TEST &#183; rapport détourné, aucune tâche Planner créée" }
    if ($etiquettes.Count -gt 0) {
        [void]$sb.Append("<tr><td style=""background:#fff7ed;border-bottom:1px solid #fcd9a4;padding:12px 28px;$($script:Police);font-size:13px;color:$($p.Alerte)"">")
        [void]$sb.Append(($etiquettes -join '<br>'))
        [void]$sb.Append('</td></tr>')
    }

    [void]$sb.Append($Corps)
    [void]$sb.Append((New-BlocAttention))
    [void]$sb.Append((New-BlocEtapes))
    [void]$sb.Append((New-BlocHorsEtapes))

    # Pied
    [void]$sb.Append("<tr><td style=""padding:22px 28px;border-top:1px solid $($p.Bord);$($script:Police);font-size:12px;color:$($p.Sourdine)"">")
    [void]$sb.Append("$(Format-Html "$(Get-Date -Format 'dd.MM.yyyy à HH:mm') · opérateur $($script:Session.Operateur) · $($env:COMPUTERNAME) · PowerShell $($PSVersionTable.PSVersion)")<br>")
    [void]$sb.Append("Message émis automatiquement par les scripts d'entrée et de sortie des collaborateurs.")
    [void]$sb.Append('</td></tr>')

    [void]$sb.Append('</table></td></tr></table></body></html>')
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
