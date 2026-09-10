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
    <# Les groupes du modèle, moins ceux que la société donne déjà. Les groupes sensibles sont marqués, pas retirés. #>
    param([AllowEmptyCollection()] [object[]] $Groupes = @())
    $liste = @($Groupes | Where-Object { $soc.groupesAuto -notcontains $_.Nom })
    return @($liste | ForEach-Object {
        $nom = $_.Nom
        $sensible = @($sensibles | Where-Object { $nom -like $_ }).Count -gt 0
        [pscustomobject]@{ Nom = $_.Nom; DN = $_.DN; Note = $(if ($sensible) { 'sensible' } else { '' }) }
    })
}
if ($Job) {
    $modeleSam = "$(Get-Prop -Objet $j -Nom 'groupesDe' -Defaut '')"
    if ($modeleSam) {
        $modele = Get-ADUser -Identity $modeleSam @ad
        $dossier.Modele = $modele.Name
        $dossier.GroupesRepris = @(Get-GroupesReprenables -Groupes @(Get-AdGroupesDe -Sam $modeleSam -Ad $ad) | Where-Object { -not $_.Note })
    }
} elseif (Confirm-Choix -Question "Reprendre les groupes d'un ou d'une collègue ?" -DefautOui) {
    # Le même champ de recherche que pour la redirection des mails, à l'identique.
    $modele = $null
    do {
        $recherche = Read-Texte -Invite 'Sur le modèle de qui ?' -Aide 'nom, prénom ou identifiant — q pour quitter' -Obligatoire -QuitteSurQ
        $trouves = @(Invoke-Attente -Titre "Recherche de « $recherche » dans l'Active Directory" -Action {
            # « désactivé » seulement si l'annuaire l'affirme : une propriété absente n'est pas un compte fermé.
            @(Find-AdUtilisateur -Recherche $recherche -Ad $ad | Select-Object *, @{ n = 'Etat'; e = { if ($_.Enabled -eq $false) { 'désactivé' } else { '' } } })
        })
        # Le terme cherché est répété : si la recherche ne donne rien, on voit sur quoi elle a porté.
        if ($trouves.Count -eq 0) { Show-Note "Aucun compte ne correspond à « $recherche »." -Niveau Alerte; continue }
        $modele = Read-Choix -Titre "Quel compte ? ($($trouves.Count) trouvé$(if ($trouves.Count -gt 1) { 's' }))" -Elements $trouves -Colonnes Name, SamAccountName, Title, Department, Etat
    } while (-not $modele)
    $tousSesGroupes = @(Invoke-Attente -Titre "Lecture des groupes de $($modele.Name)" -Action { @(Get-AdGroupesDe -Sam $modele.SamAccountName -Ad $ad) })
    $reprenables = @(Get-GroupesReprenables -Groupes $tousSesGroupes)
    if ($reprenables.Count -eq 0) {
        # On distingue les deux cas : rien lu du tout, ou tout déjà couvert par la société.
        if ($tousSesGroupes.Count -eq 0) { Show-Note "Aucun groupe lu pour $($modele.SamAccountName) — lancez .\Test-Annuaire.ps1 $($modele.SamAccountName) pour voir ce que l'annuaire répond." -Niveau Alerte }
        else { Show-Note "Les $($tousSesGroupes.Count) groupes de $($modele.Name) sont déjà donnés à tout nouveau compte de $($soc.id) ($($soc.groupesAuto -join '; '))." -Niveau Alerte }
    } else {
        # Tout est coché d'avance : le cas courant est de tout reprendre, on décoche l'exception.
        $tous = @(0..($reprenables.Count - 1))
        $dossier.Modele = $modele.Name
        $dossier.GroupesRepris = @(Read-Choix -Titre "Quels groupes reprendre de $($modele.Name) ?" -Aide 'tout est coché — décochez ce qui ne doit pas suivre' -Elements $reprenables -Colonnes Nom, Note -Multiple -IndicesCoches $tous)
        Show-Constat -Titre "$($dossier.GroupesRepris.Count) groupe(s) sur $($reprenables.Count) repris de $($modele.Name)" -Niveau Info
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
        return @{
            Candidats     = $candidats
            Files         = @(Get-XapiFiles -Pbx $pbx | Sort-Object Name)
            Utilisateurs  = @(Get-XapiUtilisateurs -Pbx $pbx)
            Departements  = @(Get-XapiDepartements -Pbx $pbx)
            NumeroLibre   = "$(Get-XapiNumeroLibre -Pbx $pbx)"
        }
    }
    $candidats = @($lecture.Candidats); $toutesFiles = @($lecture.Files)
    $tousPostes = @($lecture.Utilisateurs); $departements = @($lecture.Departements)

    if ($Job) {
        # Sans dialogue : le fichier de travail décide.
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
        $filesVoulues = @(Get-Prop -Objet $j -Nom 'files3cx' -Defaut @() | ForEach-Object { "$_" })
        if ($filesVoulues.Count -gt 0) { $dossier.Files3CX = @($toutesFiles | Where-Object { $filesVoulues -contains "$($_.Number)" }) }
        $sdaVoulue = "$(Get-Prop -Objet $j -Nom 'sda' -Defaut '')"
        if ($sdaVoulue) {
            $dossier.Sda3CX = @(Get-XapiSda -Pbx $pbx | Where-Object { $_.Numero -eq $sdaVoulue })[0]
            if (-not $dossier.Sda3CX) { throw "SDA inconnue du PBX : $sdaVoulue" }
        }
        $modeleVoulu = "$(Get-Prop -Objet $j -Nom 'copierPoste3cxDe' -Defaut '')"
        if ($modeleVoulu -and $dossier.NouveauPoste) {
            $dossier.Modele3CX = Get-XapiPosteComplet -Pbx $pbx -Numero $modeleVoulu
            if (-not $dossier.Modele3CX) { throw "Poste modèle introuvable : $modeleVoulu" }
            $dossier.Copie3CX = @('reglages', 'renvois', 'departements')
        }
    } else {
        # --- Le poste : on en crée un, ou on en reprend un qui dort.
        if (Confirm-Choix -Question 'Créer un nouveau poste 3CX pour ce collaborateur ?' -DefautOui) {
            $dossier.NouveauPoste = $true
            $dossier.Numero3CX = Read-Texte -Invite 'Numéro du nouveau poste' -Defaut $lecture.NumeroLibre `
                -Aide 'le 3CX propose le premier numéro libre' -Obligatoire -QuitteSurQ
            while (@($tousPostes | Where-Object { "$($_.Number)" -eq $dossier.Numero3CX }).Count -gt 0) {
                Show-Note "Le poste $($dossier.Numero3CX) existe déjà." -Niveau Alerte
                $dossier.Numero3CX = Read-Texte -Invite 'Numéro du nouveau poste' -Defaut $lecture.NumeroLibre -Obligatoire -QuitteSurQ
            }
            Show-Constat -Titre 'Nouveau poste à créer' -Valeurs @("poste $($dossier.Numero3CX)") -Niveau Info
        } else {
            Show-Constat -Titre "$($candidats.Count) postes libres au 3CX — désactivés, ou nommés « libre »" -Niveau Info
            if ($candidats.Count -gt 0 -and (Confirm-Choix -Question 'Réaffecter un poste libre à ce collaborateur ?' -DefautOui)) {
                $vue = @($candidats | Select-Object *, @{ n = 'Etat'; e = { if ($_.Enabled) { 'actif' } else { 'désactivé' } } })
                $dossier.Poste3CX = Read-Choix -Titre 'Quel poste 3CX réaffecter ?' -Elements $vue -Colonnes Number, DisplayName, EmailAddress, Etat
                $dossier.Numero3CX = "$($dossier.Poste3CX.Number)"
            }
        }

        if ($dossier.Numero3CX) {
            Add-Resume -Cle 'Poste' -Valeur $dossier.Numero3CX
            # --- Les files d'attente AVANT le modèle : elles désignent les bons collègues.
            if (Confirm-Choix -Question "Inscrire ce poste dans des files d'attente ?" -DefautOui) {
                $dossier.Files3CX = @(Read-Choix -Titre "Dans quelles files d'attente ?" -Elements $toutesFiles -Colonnes Number, Name -Multiple)
            }

            # --- La SDA : un numéro direct, choisi dans la liste du PBX.
            if (Confirm-Choix -Question 'Attribuer un numéro direct (SDA) à ce poste ?' -DefautOui) {
                $sda = @(Invoke-Attente -Titre 'Lecture des numéros directs du 3CX' -Action { @(Get-XapiSda -Pbx $pbx) })
                $libres = @($sda | Where-Object { $_.Libre })
                # On propose les numéros attribuables ; les autres restent à une
                # touche, pour le cas où l'on reprend celui d'un poste qui part.
                $choisie = $null
                $liste = $libres
                while (-not $choisie) {
                    $tousVisibles = ($liste.Count -eq $sda.Count)
                    if ($liste.Count -eq 0) { $liste = $sda; $tousVisibles = $true }
                    $bascule = [pscustomobject]@{
                        Numero = ''
                        Etat = $(if ($tousVisibles) { "← Ne montrer que les $($libres.Count) numéros libres" } else { "Voir aussi les $($sda.Count - $libres.Count) numéros déjà attribués" })
                        Nom = ''
                    }
                    $titre = if ($tousVisibles) { "Quel numéro direct ? ($($sda.Count) SDA, dont $($libres.Count) libres)" } else { "Quel numéro direct ? ($($libres.Count) libres sur $($sda.Count))" }
                    $rendu = Read-Choix -Titre $titre -Aide 'tapez le début du numéro pour filtrer, +4122 par exemple' `
                        -Elements (@($bascule) + @($liste | Select-Object Numero, Etat, Nom)) -Colonnes Numero, Etat, Nom
                    if ($rendu.Numero) { $choisie = $rendu } else { $liste = $(if ($tousVisibles) { $libres } else { $sda }) }
                }
                $dossier.Sda3CX = @($sda | Where-Object { $_.Numero -eq $choisie.Numero })[0]
                $combien = if ($dossier.Sda3CX.Regles.Count) { "$($dossier.Sda3CX.Regles.Count) règle(s) à réécrire" } else { "$(@($dossier.Sda3CX.Trunks).Count) règle(s) à créer" }
                Show-Constat -Titre "Numéro direct retenu — $combien" -Valeurs @($dossier.Sda3CX.Numero, "vers le poste $($dossier.Numero3CX)") -Niveau Info
                Add-Resume -Cle 'SDA' -Valeur $dossier.Sda3CX.Numero
            }

            # --- Copier la configuration d'un collègue : réglages, renvois, BLF, départements.
            if ($dossier.NouveauPoste -and (Confirm-Choix -Question "Copier la configuration 3CX d'un collègue sur ce poste ?" -DefautOui)) {
                # On ne cherche plus à l'aveugle : la liste des postes s'ouvre et
                # se filtre en tapant un numéro ou un nom. Quand des files sont
                # choisies, elle s'ouvre sur leurs agents — ce sont les bons
                # modèles — avec une bascule vers l'annuaire complet du central.
                $numerosFiles = @()
                foreach ($f in $dossier.Files3CX) { $numerosFiles += @(Get-NumerosAgents -File $f) }
                $numerosFiles = @($numerosFiles | Sort-Object -Unique)
                $annuaire = @($tousPostes | Where-Object { "$($_.Number)" -ne $dossier.Numero3CX } |
                    Sort-Object { [int]("$($_.Number)" -replace '\D', '0') } |
                    Select-Object Number, DisplayName, EmailAddress)
                $desFiles = @($annuaire | Where-Object { $numerosFiles -contains "$($_.Number)" })
                $modele = $null
                if ($annuaire.Count -eq 0) { Show-Note "Le central n'a rendu aucun poste : rien à prendre pour modèle." -Niveau Alerte }
                elseif ($dossier.Files3CX.Count -gt 0 -and $desFiles.Count -eq 0) { Show-Note "Aucun agent lisible dans les files choisies : l'annuaire complet est proposé." -Niveau Alerte }
                $liste = $(if ($desFiles.Count -gt 0) { $desFiles } else { $annuaire })
                while (-not $modele -and $annuaire.Count -gt 0) {
                    $tousVisibles = ($liste.Count -eq $annuaire.Count)
                    $elements = @($liste)
                    if ($desFiles.Count -gt 0 -and $desFiles.Count -lt $annuaire.Count) {
                        $texte = $(if ($tousVisibles) { "← Ne montrer que les $($desFiles.Count) postes des files choisies" } else { "Chercher parmi les $($annuaire.Count) postes du central" })
                        $elements = @([pscustomobject]@{ Number = ''; DisplayName = $texte; EmailAddress = '' }) + $elements
                    }
                    $titre = $(if ($tousVisibles) { "Sur le modèle de quel poste ? ($($annuaire.Count) postes au central)" } else { "Sur le modèle de quel poste ? ($($desFiles.Count) dans les files choisies)" })
                    $choix = Read-Choix -Titre $titre -Aide 'tapez un numéro ou un nom pour filtrer' `
                        -Elements $elements -Colonnes Number, DisplayName, EmailAddress
                    if ($choix.Number) { $modele = $choix } else { $liste = $(if ($tousVisibles) { $desFiles } else { $annuaire }) }
                }
                if ($modele) {
                    $dossier.Modele3CX = Invoke-Attente -Titre "Lecture du poste $($modele.Number)" -Action { Get-XapiPosteComplet -Pbx $pbx -Numero "$($modele.Number)" }
                    $sesDepartements = @(Get-XapiDepartementsDuPoste -Departements $departements -Numero "$($modele.Number)")
                    $nbBlf = ([regex]::Matches("$(Get-Prop -Objet $dossier.Modele3CX -Nom 'Blfs' -Defaut '')", '<BLF ')).Count
                    $nbRenvois = @(Get-Prop -Objet $dossier.Modele3CX -Nom 'ForwardingProfiles' -Defaut @()).Count
                    $quoi = @(
                        [pscustomobject]@{ Code = 'reglages';     Quoi = "Réglages généraux et $nbBlf touches BLF" },
                        [pscustomobject]@{ Code = 'renvois';      Quoi = "$nbRenvois profils de renvoi et leurs exceptions" },
                        [pscustomobject]@{ Code = 'departements'; Quoi = "$($sesDepartements.Count) départements et leurs droits" }
                    )
                    $retenus = @(Read-Choix -Titre "Que reprendre du poste $($modele.Number) ?" -Aide 'tout est coché — décochez ce qui ne doit pas suivre' `
                        -Elements $quoi -Colonnes Quoi -Multiple -IndicesCoches @(0..($quoi.Count - 1)))
                    $dossier.Copie3CX = @($retenus | ForEach-Object { $_.Code })
                    $dossier.Departements3CX = $(if ($dossier.Copie3CX -contains 'departements') { $sesDepartements } else { @() })
                    Show-Constat -Titre "Configuration reprise du poste $($modele.Number)" -Valeurs @($dossier.Modele3CX.DisplayName) -Niveau Info
                }
            }
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
    'Poste 3CX'       = $(if ($dossier.NouveauPoste) { "$($dossier.Numero3CX) — à CRÉER" } elseif ($dossier.Poste3CX) { "$($dossier.Numero3CX) réaffecté (ex « $($dossier.Poste3CX.DisplayName) »)" } elseif ($pbx) { 'aucun' } else { 'pas de PBX pour cette société' })
    'Files 3CX'       = $(if ($dossier.Files3CX.Count) { ($dossier.Files3CX | ForEach-Object { "$($_.Number) $($_.Name)" }) -join ' · ' } else { '—' })
    'Config 3CX'      = $(if ($dossier.Modele3CX) { "copiée du poste $($dossier.Modele3CX.Number) « $($dossier.Modele3CX.DisplayName) » : $($dossier.Copie3CX -join ', ')" } else { '—' })
    'Départements'    = $(if ($dossier.Departements3CX.Count) { ($dossier.Departements3CX | ForEach-Object { $_.Name }) -join '; ' } else { '—' })
    'Numéro direct'   = $(if ($dossier.Sda3CX) { "$($dossier.Sda3CX.Numero) — aujourd'hui : $($dossier.Sda3CX.Etat)" } else { '—' })
    'Mode'            = (Get-ModeEcriture)
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
            if (-not (Test-Simulation)) { Add-Journal -Message "Poste $($dossier.Numero3CX) à $($dossier.DisplayName), réactivé." -Categorie 3CX -Niveau Succes }
        }
    } | Out-Null
    if ($script:idPoste) { $idPoste = $script:idPoste }

    Invoke-Etape -Nom $(if ($dossier.Modele3CX) { "Configuration copiée du poste $($dossier.Modele3CX.Number)" } else { 'Configuration 3CX copiée' }) `
                 -Categorie 3CX -Ignorer:(-not $dossier.Modele3CX -or -not ($dossier.Copie3CX | Where-Object { $_ -ne 'departements' })) -Action {
        Copy-XapiConfigurationPoste -Pbx $pbx -Modele $dossier.Modele3CX -Id $idPoste -Numero $dossier.Numero3CX -Quoi $dossier.Copie3CX
    } | Out-Null

    Invoke-Etape -Nom 'Départements 3CX et droits' -Categorie 3CX -Ignorer:($dossier.Departements3CX.Count -eq 0) -Action {
        $principal = $null
        foreach ($dep in $dossier.Departements3CX) {
            $sien = @($dep.Members | Where-Object { "$($_.Number)" -eq "$($dossier.Modele3CX.Number)" })[0]
            Add-XapiPosteAuDepartement -Pbx $pbx -Departement $dep -Numero $dossier.Numero3CX -Droits (Get-Prop -Objet $sien -Nom 'Rights')
            if ($dep.Id -eq (Get-Prop -Objet $dossier.Modele3CX -Nom 'PrimaryGroupId')) { $principal = $dep }
        }
        if (-not (Test-Simulation)) { Add-Journal -Message "Rattaché à $($dossier.Departements3CX.Count) département(s) avec les droits du modèle." -Categorie 3CX -Niveau Succes }
        # Le département principal ne s'accepte QU'APRÈS le rattachement.
        if ($principal) { Set-XapiDepartementPrincipal -Pbx $pbx -Id $idPoste -DepartementId ([int]$principal.Id) -Nom $principal.Name }
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
