#Requires -Version 5.1
<#
    SONDE DE L'ANNUAIRE — lecture seule, aucune interface, aucune écriture.

    Quand la recherche d'un compte ou la lecture de ses groupes ne donne pas
    ce qu'on attend, ce script montre exactement ce que l'Active Directory
    répond, sans passer par les écrans : le compte trouvé et son emplacement,
    les propriétés réellement rendues, et les trois chemins de lecture des
    groupes.

        .\Test-Annuaire.ps1 gbossens
        .\Test-Annuaire.ps1 parsa -Societe GEROFINANCE

    Collez la sortie telle quelle : elle suffit à trancher.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)] [string] $Recherche,
    [string] $Societe = 'GEROFINANCE'
)

Import-Module (Join-Path $PSScriptRoot 'Collaborateurs.psm1') -Force
Initialize-Collaborateurs -Reglages @{ ModeTest = $true; DestinataireTest = ''; Simulation = $true; EnvoyerMail = $false; DossierLogs = (Join-Path $env:TEMP 'collaborateurs-sonde') } `
    -Dossier $PSScriptRoot -Operation 'entree' -Etapes @('Sonde') -Interactif $false | Out-Null

$soc = Get-Societe -Id $Societe
$ad = Connect-Domaine -Societe $soc
Write-Host ''
Write-Host "Société $($soc.id) · contrôleur $($soc.dc) · compte $(if ($ad.ContainsKey('Credential')) { $ad.Credential.UserName } else { "$env:USERDOMAIN\$env:USERNAME (session courante)" })" -ForegroundColor Cyan
Write-Host ''

# ------------------------------------------------------------------ 1
Write-Host "1. Find-AdUtilisateur « $Recherche »" -ForegroundColor Yellow
$trouves = @(Find-AdUtilisateur -Recherche $Recherche -Ad $ad)
Write-Host "   $($trouves.Count) résultat(s)"
foreach ($u in $trouves) {
    Write-Host "     $($u.Name)  ·  $($u.SamAccountName)  ·  Enabled=$(if ($null -eq $u.Enabled) { '(absent)' } else { $u.Enabled })"
    Write-Host "        $($u.DistinguishedName)" -ForegroundColor DarkGray
}
if ($trouves.Count -eq 0) { Write-Host '   Rien trouvé : arrêt de la sonde.' -ForegroundColor Red; exit }
$sam = $trouves[0].SamAccountName
Write-Host ''

# ------------------------------------------------------------------ 2
Write-Host "2. Get-ADUser -Identity $sam : ce que l'annuaire rend VRAIMENT" -ForegroundColor Yellow
$brut = Get-ADUser -Identity $sam -Properties * @ad
Write-Host "   Emplacement        : $($brut.DistinguishedName)"
Write-Host "   Propriétés rendues : $(@($brut.PSObject.Properties).Count)"
foreach ($nom in @('Enabled', 'userAccountControl', 'MemberOf', 'PrimaryGroup', 'primaryGroupID', 'whenChanged', 'Modified')) {
    $prop = $brut.PSObject.Properties[$nom]
    if (-not $prop) { Write-Host "   $($nom.PadRight(18)) : PROPRIÉTÉ ABSENTE de la réponse" -ForegroundColor Red; continue }
    $v = $prop.Value
    $affichage = if ($null -eq $v) { '(nulle)' } elseif ($v -is [array] -or $v.GetType().Name -like '*Collection*') { "$(@($v).Count) entrée(s)" } else { "$v" }
    Write-Host "   $($nom.PadRight(18)) : $affichage"
}
Write-Host ''

# ------------------------------------------------------------------ 3
Write-Host '3. Les trois chemins de lecture des groupes' -ForegroundColor Yellow
$a = @(); $b = @(); $c = @()
try { $a = @((Get-ADUser -Identity $sam -Properties MemberOf @ad).MemberOf) } catch { Write-Host "   a) ÉCHEC : $(Get-MessageErreur $_)" -ForegroundColor Red }
Write-Host "   a) attribut MemberOf du compte        : $($a.Count)"
try { $b = @(Get-ADPrincipalGroupMembership -Identity $sam @ad | Select-Object -ExpandProperty DistinguishedName) } catch { Write-Host "   b) ÉCHEC : $(Get-MessageErreur $_)" -ForegroundColor Red }
Write-Host "   b) Get-ADPrincipalGroupMembership     : $($b.Count)"
try {
    $dnFiltre = "$($brut.DistinguishedName)" -replace '\\', '\5c' -replace '\(', '\28' -replace '\)', '\29' -replace '\*', '\2a'
    $c = @(Get-ADGroup -LDAPFilter "(member=$dnFiltre)" @ad | Select-Object -ExpandProperty DistinguishedName)
} catch { Write-Host "   c) ÉCHEC : $(Get-MessageErreur $_)" -ForegroundColor Red }
Write-Host "   c) groupes citant ce compte (member=) : $($c.Count)   <-- lit le lien à l'endroit"
$toutes = @($a + $b + $c | Where-Object { $_ } | Sort-Object -Unique)
Write-Host "   union des trois : $($toutes.Count)"
foreach ($dn in $toutes) { Write-Host "     $dn" -ForegroundColor DarkGray }
Write-Host ''

# ------------------------------------------------------------------ 4
Write-Host '4. Ce que le module en tire (Get-AdGroupesDe)' -ForegroundColor Yellow
$groupes = @(Get-AdGroupesDe -Sam $sam -Ad $ad)
Write-Host "   $($groupes.Count) groupe(s)"
foreach ($g in $groupes) { Write-Host "     $($g.Nom)" }
Write-Host ''

# ------------------------------------------------------------------ 5
Write-Host "5. Groupes donnés d'office à tout nouveau compte de $($soc.id) (config.json → groupesAuto)" -ForegroundColor Yellow
Write-Host "   $(if ($soc.groupesAuto) { $soc.groupesAuto -join ' ; ' } else { '(aucun)' })"
Write-Host "   Reprenables après exclusion : $(@($groupes | Where-Object { $soc.groupesAuto -notcontains $_.Nom }).Count)"
Write-Host ''
try { Stop-Transcript | Out-Null } catch { }
