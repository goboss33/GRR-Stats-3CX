#Requires -Version 5.1
<#
    SONDE DU CENTRAL 3CX — lecture seule, aucune interface, aucune écriture.

    Quand le script d'entrée ou de sortie bute sur un refus du 3CX (401, 403,
    404…), ce script montre ce que le PBX répond au principal de config.json,
    requête par requête : le jeton d'abord, puis les lectures que les scripts
    font, puis — si on les donne — l'adresse, le poste et la SDA en cause.

        .\Test-Pbx.ps1
        .\Test-Pbx.ps1 -Email test.3cx@grrsa.ch -Numero 128 -Sda +41213213071

    UN SEUL ESSAI D'ÉCRITURE, explicite et réversible, demande confirmation :

        .\Test-Pbx.ps1 -EssaiDepartement -Modele 163

    crée un poste jetable au premier numéro libre, le rattache au département
    principal du modèle EN ÉCRIVANT SUR LE POSTE (PATCH Users(Id).Groups),
    relit le département, pose le département principal, puis SUPPRIME le
    poste et prouve que le département est revenu à l'identique. C'est le
    chemin que le script d'entrée emploiera une fois
    config.json → pbx.<clé>.rattacherDepartements passé à true.

    ATTENTION : le 3CX ne garde qu'UN jeton par identifiant client. Lancer la
    sonde pendant qu'un script tourne lui ferait perdre le sien.
    Collez la sortie telle quelle : elle suffit à trancher.
#>
[CmdletBinding()]
param(
    [string] $Societe = 'GEROFINANCE',
    [string] $Email = '',
    [string] $Numero = '',
    [string] $Sda = '',
    [switch] $EssaiDepartement,
    [string] $Modele = ''
)

Import-Module (Join-Path $PSScriptRoot 'Collaborateurs.psm1') -Force
Initialize-Collaborateurs -Reglages @{ ModeTest = $true; DestinataireTest = ''; Simulation = $true; EnvoyerMail = $false; DossierLogs = (Join-Path $env:TEMP 'collaborateurs-sonde') } `
    -Dossier $PSScriptRoot -Operation 'entree' -Etapes @('Sonde') -Interactif $false | Out-Null

$soc = Get-Societe -Id $Societe
$pbx = Get-Pbx -Societe $soc
if (-not $pbx) { Write-Host "La société $Societe n'a pas de PBX dans config.json." -ForegroundColor Red; exit 1 }
Write-Host ''
Write-Host "PBX $($pbx.adresse) · principal $($pbx.clientId) · secret $($pbx.fichierSecret) · PowerShell $($PSVersionTable.PSVersion)" -ForegroundColor Cyan
Write-Host ''

function Sonde {
    <# Une lecture : le chemin, puis OK et un résumé, ou KO et ce que le PBX a répondu. Rend la réponse. #>
    param([Parameter(Mandatory)] [string] $Titre, [Parameter(Mandatory)] [string] $Chemin, [scriptblock] $Resume)
    Write-Host $Titre -ForegroundColor Yellow
    Write-Host "   GET $([uri]::UnescapeDataString($Chemin))" -ForegroundColor DarkGray
    try {
        $r = Invoke-Xapi -Pbx $pbx -Chemin $Chemin
        $texte = if ($Resume) { "$(& $Resume $r)" } else { "$($r | ConvertTo-Json -Depth 3 -Compress)" }
        if ($texte.Length -gt 300) { $texte = $texte.Substring(0, 300) + '…' }
        Write-Host "   OK  $texte" -ForegroundColor Green
        Write-Host ''
        return $r
    } catch {
        Write-Host "   KO  $(Get-MessageErreur $_)" -ForegroundColor Red
        Write-Host ''
        return $null
    }
}

# ------------------------------------------------------------------ 1
Write-Host '1. Le jeton (POST connect/token)' -ForegroundColor Yellow
try {
    $jeton = Connect-Xapi -Pbx $pbx
    Write-Host "   OK  jeton de $("$jeton".Length) caractères" -ForegroundColor Green
} catch {
    Write-Host "   KO  $(Get-MessageErreur $_)" -ForegroundColor Red
    Write-Host ''
    Write-Host "Sans jeton, rien d'autre à sonder. Vérifiez le principal « $($pbx.clientId) » dans la console 3CX (Intégrations › API) et le secret posé par Set-Secret.ps1." -ForegroundColor Red
    exit 1
}
Write-Host ''

# ------------------------------------------------------------------ 2 : ce que lisent les scripts
$r = Sonde -Titre '2. Un utilisateur, sans filtre' -Chemin 'Users?%24top=1&%24select=Id,Number,DisplayName' `
    -Resume { param($r) $u = @($r.value)[0]; "$(@($r.value).Count) rendu : $(Get-Prop -Objet $u -Nom 'Number') $(Get-Prop -Objet $u -Nom 'DisplayName')" }

if ($Email) {
    $e = [uri]::EscapeDataString($Email.Replace("'", "''"))
    $r = Sonde -Titre "3. L'utilisateur qui porte l'adresse $Email" -Chemin "Users?%24filter=EmailAddress%20eq%20'$e'&%24select=Id,Number,DisplayName,EmailAddress" `
        -Resume { param($r) "$(@($r.value).Count) trouvé(s) : $((@($r.value) | ForEach-Object { "$($_.Number) $($_.DisplayName)" }) -join ' ; ')" }
}

$poste = $null
if ($Numero) {
    $r = Sonde -Titre "4. Le poste $Numero, avec ses profils de renvoi" -Chemin "Users?%24filter=Number%20eq%20'$Numero'&%24expand=ForwardingProfiles" `
        -Resume { param($r) $u = @($r.value)[0]; if ($u) { "Id $($u.Id) · $(Get-Prop -Objet $u -Nom 'DisplayName') · $(@(Get-Prop -Objet $u -Nom 'ForwardingProfiles' -Defaut @()).Count) profils · département principal $(Get-Prop -Objet $u -Nom 'PrimaryGroupId' -Defaut '(aucun)')" } else { 'aucun poste de ce numéro' } }
    if ($r) { $poste = @($r.value)[0] }
    if ($poste) {
        $r = Sonde -Titre "   Ce même poste, lu par son identifiant" -Chemin "Users($($poste.Id))?%24select=Id,Number,DisplayName" `
            -Resume { param($r) "$(Get-Prop -Objet $r -Nom 'Number') $(Get-Prop -Objet $r -Nom 'DisplayName')" }
    }
}

$r = Sonde -Titre '5. Le premier numéro de poste libre' -Chemin 'Users/Pbx.GetFirstAvailableExtensionNumber()' `
    -Resume { param($r) "$(Get-Prop -Objet $r -Nom 'Number' -Defaut '?')" }

$r = Sonde -Titre '6. Un département, ses membres et leurs droits' -Chemin 'Groups?%24top=1&%24expand=Members(%24expand%3DRights)' `
    -Resume { param($r) $g = @($r.value)[0]; $m = @(Get-Prop -Objet $g -Nom 'Members' -Defaut @()); "Id $($g.Id) « $(Get-Prop -Objet $g -Nom 'Name') » · $($m.Count) membres · rôle du 1er : $(Get-Prop -Objet (Get-Prop -Objet $m[0] -Nom 'Rights') -Nom 'RoleName' -Defaut '(aucun)')" }
if ($r) {
    $g = @($r.value)[0]
    $r = Sonde -Titre '   Ce même département, lu par son identifiant' -Chemin "Groups($($g.Id))?%24expand=Members(%24expand%3DRights)" `
        -Resume { param($r) "« $(Get-Prop -Objet $r -Nom 'Name') » · $(@(Get-Prop -Objet $r -Nom 'Members' -Defaut @()).Count) membres" }
}
if ($poste -and (Get-Prop -Objet $poste -Nom 'PrimaryGroupId')) {
    $r = Sonde -Titre "   Le département principal du poste $Numero, lu par son identifiant" -Chemin "Groups($(Get-Prop -Objet $poste -Nom 'PrimaryGroupId'))?%24expand=Members(%24expand%3DRights)" `
        -Resume { param($r) "« $(Get-Prop -Objet $r -Nom 'Name') » · $(@(Get-Prop -Objet $r -Nom 'Members' -Defaut @()).Count) membres · le poste y est : $(@(Get-Prop -Objet $r -Nom 'Members' -Defaut @() | Where-Object { "$(Get-Prop -Objet $_ -Nom 'Number')" -eq $Numero }).Count -gt 0)" }
}

$r = Sonde -Titre '7. Une file et ses agents' -Chemin 'Queues?%24top=1&%24expand=Agents' `
    -Resume { param($r) $q = @($r.value)[0]; $a = @(Get-Prop -Objet $q -Nom 'Agents' -Defaut @()); "Id $($q.Id) · $(Get-Prop -Objet $q -Nom 'Number') « $(Get-Prop -Objet $q -Nom 'Name') » · $($a.Count) agents · le 1er se lit : $(Get-NumeroAgent -Agent $a[0]) · forme : $((@($a[0].PSObject.Properties | ForEach-Object { $_.Name })) -join ',')" }

$r = Sonde -Titre '8. Une règle entrante' -Chemin 'InboundRules?%24top=1' `
    -Resume { param($r) $x = @($r.value)[0]; "Id $($x.Id) · « $(Get-Prop -Objet $x -Nom 'RuleName') » · Data $(Get-Prop -Objet $x -Nom 'Data') · $(Get-Prop -Objet $x -Nom 'Condition')" }
if ($r) {
    $x = @($r.value)[0]
    $r = Sonde -Titre '   Cette même règle, lue par son identifiant' -Chemin "InboundRules($($x.Id))" `
        -Resume { param($r) "« $(Get-Prop -Objet $r -Nom 'RuleName') » · Data $(Get-Prop -Objet $r -Nom 'Data')" }
}

if ($Sda) {
    $s = [uri]::EscapeDataString($Sda.Replace("'", "''"))
    $r = Sonde -Titre "9. Les règles de la SDA $Sda" -Chemin "InboundRules?%24filter=Data%20eq%20'$s'" `
        -Resume { param($r) "$(@($r.value).Count) règle(s) : $((@($r.value) | ForEach-Object { $o = Get-Prop -Objet $_ -Nom 'OfficeHoursDestination'; "Id $($_.Id) « $(Get-Prop -Objet $_ -Nom 'RuleName') » vers $(Get-Prop -Objet $o -Nom 'To' -Defaut '(rien)') $(Get-Prop -Objet $o -Nom 'Number' -Defaut '')" }) -join ' ; ')" }
    if ($r) {
        foreach ($regle in @($r.value)) {
            $r2 = Sonde -Titre "   La règle $($regle.Id), lue par son identifiant" -Chemin "InboundRules($($regle.Id))" `
                -Resume { param($r) "« $(Get-Prop -Objet $r -Nom 'RuleName') » · trunk $(Get-Prop -Objet (Get-Prop -Objet $r -Nom 'TrunkDN') -Nom 'Id' -Defaut '?')" }
        }
    }
    $r = Sonde -Titre "   La SDA $Sda dans la liste des numéros directs" -Chemin "DidNumbers?%24filter=Number%20eq%20'$s'" `
        -Resume { param($r) "$(@($r.value).Count) entrée(s) : $((@($r.value) | ForEach-Object { "trunk $(Get-Prop -Objet $_ -Nom 'TrunkId')" }) -join ' ; ')" }
}

$r = Sonde -Titre "10. Un poste qui n'existe pas — pour voir la forme d'un refus" -Chemin 'Users(0)?%24select=Id'

# ------------------------------------------------------------------ 11 : l'essai d'écriture, sur demande
if ($EssaiDepartement) {
    Write-Host "11. ESSAI D'ÉCRITURE — rattacher un poste jetable à un département en écrivant sur le poste" -ForegroundColor Yellow
    if (-not $Modele) { Write-Host '   Donnez -Modele <numéro du poste dont on prend le département principal>.' -ForegroundColor Red; exit 1 }
    $m = Get-XapiPosteComplet -Pbx $pbx -Numero $Modele
    if (-not $m) { Write-Host "   Poste modèle $Modele introuvable." -ForegroundColor Red; exit 1 }
    $departements = @(Get-XapiDepartements -Pbx $pbx)
    $siens = @(Get-XapiDepartementsDuPoste -Departements $departements -Numero $Modele)
    $cible = @($siens | Where-Object { $_.Id -eq (Get-Prop -Objet $m -Nom 'PrimaryGroupId') })[0]
    if (-not $cible) { $cible = $siens[0] }
    if (-not $cible) { Write-Host "   Le poste $Modele n'est dans aucun département : rien à essayer." -ForegroundColor Red; exit 1 }
    $sien = @(Get-Prop -Objet $cible -Nom 'Members' -Defaut @() | Where-Object { "$(Get-Prop -Objet $_ -Nom 'Number' -Defaut '')" -eq $Modele })[0]
    $droits = Get-Prop -Objet $sien -Nom 'Rights'
    $libre = Get-XapiNumeroLibre -Pbx $pbx
    $membresAvant = @(Get-Prop -Objet $cible -Nom 'Members' -Defaut @())
    Write-Host "   Département cible : « $($cible.Name) » (Id $($cible.Id)) · $($membresAvant.Count) membres · rôle du modèle $Modele : $(Get-Prop -Objet $droits -Nom 'RoleName' -Defaut '(aucun)')"
    Write-Host "   Types de membres présents : $((@($membresAvant | ForEach-Object { "$(Get-Prop -Objet $_ -Nom 'Type' -Defaut '?')" }) | Group-Object | ForEach-Object { "$($_.Name) ×$($_.Count)" }) -join ', ')"
    Write-Host "   Le script va : créer le poste $libre « ZZ ESSAI SCRIPT », l'y rattacher par PATCH Users($libre).Groups, relire le département,"
    Write-Host "   poser le département principal, puis SUPPRIMER le poste. Le département lui-même ne sera pas réécrit."
    $ok = Read-Host '   Tapez OUI pour continuer'
    if ($ok -ne 'OUI') { Write-Host '   Abandon.'; exit 0 }
    Write-Host ''
    (Get-Reglages)['Simulation3CX'] = $false      # écriture réelle sur le 3CX, pour cet essai seulement
    $empreinteAvant = Get-EmpreinteMembres -Departement (Get-XapiDepartement -Pbx $pbx -Id ([int]$cible.Id))
    $cree = $null
    try {
        $cree = New-XapiPoste -Pbx $pbx -Numero "$libre" -Prenom 'ZZ ESSAI' -Nom 'SCRIPT'
        Write-Host "   poste créé : Id $($cree.Id), numéro $($cree.Number)" -ForegroundColor Green
        Set-XapiDepartementsDuPoste -Pbx $pbx -Id ([int]$cree.Id) -Numero "$libre" -Voulus @(@{ Departement = $cible; Droits = $droits })
        $u = Invoke-Xapi -Pbx $pbx -Chemin "Users($($cree.Id))?%24select=Id,Number,PrimaryGroupId&%24expand=Groups(%24expand%3DRights)"
        $appartenances = @(Get-Prop -Objet $u -Nom 'Groups' -Defaut @() | ForEach-Object { "$(Get-Prop -Objet $_ -Nom 'GroupId') « $(Get-Prop -Objet $_ -Nom 'Name') » ($(Get-Prop -Objet (Get-Prop -Objet $_ -Nom 'Rights') -Nom 'RoleName' -Defaut '?'))" })
        Write-Host "   appartenances relues sur le poste : $($appartenances -join ' ; ')" -ForegroundColor Green
        Set-XapiDepartementPrincipal -Pbx $pbx -Id ([int]$cree.Id) -DepartementId ([int]$cible.Id) -Nom $cible.Name
        $u2 = Invoke-Xapi -Pbx $pbx -Chemin "Users($($cree.Id))?%24select=PrimaryGroupId"
        Write-Host "   département principal relu : $(Get-Prop -Objet $u2 -Nom 'PrimaryGroupId')" -ForegroundColor Green
    } catch {
        Write-Host "   KO  $(Get-MessageErreur $_)" -ForegroundColor Red
    } finally {
        if ($cree) {
            try {
                Invoke-Xapi -Pbx $pbx -Methode DELETE -Chemin "Users($($cree.Id))" -Libelle "Supprimer le poste d'essai $libre" | Out-Null
                Write-Host "   poste d'essai $libre supprimé." -ForegroundColor Green
            } catch { Write-Host "   SUPPRESSION ÉCHOUÉE, à faire à la main : poste $libre (Id $($cree.Id)) — $(Get-MessageErreur $_)" -ForegroundColor Red }
        }
        $ecarts = @(Compare-EmpreinteMembres -Avant $empreinteAvant -Apres (Get-EmpreinteMembres -Departement (Get-XapiDepartement -Pbx $pbx -Id ([int]$cible.Id))) -Sauf "$libre")
        if ($ecarts.Count) { Write-Host "   ATTENTION : le département n'est pas revenu à l'identique — $($ecarts -join ' ; ')" -ForegroundColor Red }
        else { Write-Host "   Le département « $($cible.Name) » est revenu à l'identique : $($empreinteAvant.Count) membres, mêmes droits." -ForegroundColor Green }
    }
    Write-Host ''
}

Write-Host 'Fin de la sonde.' -ForegroundColor Cyan
