#Requires -Version 5.1
<#
    SONDE DE L'ANNUAIRE — lecture seule, aucune interface, aucune écriture.

    Quand la recherche d'un compte ou la lecture de ses groupes ne donne pas
    ce qu'on attend, ce script montre exactement ce que l'Active Directory
    répond, sans passer par les écrans : le compte brut, l'état, les groupes
    par les deux chemins que le module utilise.

        .\Test-Annuaire.ps1 parsa
        .\Test-Annuaire.ps1 pfirouzabadi -Societe GEROFINANCE

    Collez la sortie telle quelle : elle suffit à trancher.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)] [string] $Recherche,
    [string] $Societe = 'GEROFINANCE'
)

Import-Module (Join-Path $PSScriptRoot 'Collaborateurs.psm1') -Force
Initialize-Collaborateurs -Reglages @{ ModeTest = $true; DestinataireTest = ''; Simulation = $true; EnvoyerMail = $false; DossierLogs = (Join-Path $env:TEMP 'collaborateurs-sonde') } `
    -Dossier $PSScriptRoot -Operation 'entree' -Etapes @() -Interactif $false | Out-Null

$soc = Get-Societe -Id $Societe
$ad = Connect-Domaine -Societe $soc
Write-Host ''
Write-Host "Société $($soc.id) · contrôleur $($soc.dc) · identifiants $(if ($ad.ContainsKey('Credential')) { $ad.Credential.UserName } else { 'session courante' })" -ForegroundColor Cyan
Write-Host ''

# 1. Ce que la recherche du module rend
Write-Host "1. Find-AdUtilisateur « $Recherche »" -ForegroundColor Yellow
$trouves = @(Find-AdUtilisateur -Recherche $Recherche -Ad $ad)
Write-Host "   $($trouves.Count) résultat(s)"
$trouves | Select-Object Name, SamAccountName, @{ n = 'Enabled'; e = { if ($null -eq $_.Enabled) { '(absent)' } else { $_.Enabled } } }, Title, Department |
    Format-Table -AutoSize | Out-String -Width 200 | Write-Host
if ($trouves.Count -eq 0) { Write-Host '   Rien trouvé : arrêt de la sonde.' -ForegroundColor Red; exit }

$cible = $trouves[0]
Write-Host "2. Le compte brut, tel que Get-ADUser le rend : $($cible.SamAccountName)" -ForegroundColor Yellow
$brut = Get-ADUser -Identity $cible.SamAccountName -Properties Enabled, MemberOf, PrimaryGroup, mail, Title, Department @ad
Write-Host "   Enabled            : $(if ($null -eq $brut.Enabled) { '(propriété absente)' } else { $brut.Enabled })  [type $(if ($null -eq $brut.Enabled) { 'néant' } else { $brut.Enabled.GetType().Name })]"
Write-Host "   UserAccountControl : $((Get-ADUser -Identity $cible.SamAccountName -Properties userAccountControl @ad).userAccountControl)  (2 = désactivé)"
Write-Host "   MemberOf           : $(@($brut.MemberOf).Count) entrée(s)"
Write-Host "   PrimaryGroup       : $(Get-Prop -Objet $brut -Nom 'PrimaryGroup' -Defaut '(absent)')"
Write-Host ''

Write-Host '3. Les deux chemins de lecture des groupes' -ForegroundColor Yellow
$viaMemberOf = @($brut.MemberOf)
Write-Host "   a) attribut MemberOf                 : $($viaMemberOf.Count)"
foreach ($dn in $viaMemberOf) { Write-Host "        $dn" }
$viaPrincipal = @()
try { $viaPrincipal = @(Get-ADPrincipalGroupMembership -Identity $cible.SamAccountName @ad | Select-Object -ExpandProperty DistinguishedName) }
catch { Write-Host "   b) Get-ADPrincipalGroupMembership     : ÉCHEC — $(Get-MessageErreur $_)" -ForegroundColor Red }
if ($viaPrincipal.Count -gt 0 -or $viaMemberOf.Count -eq 0) {
    Write-Host "   b) Get-ADPrincipalGroupMembership     : $($viaPrincipal.Count)"
    foreach ($dn in $viaPrincipal) { Write-Host "        $dn" }
}
Write-Host ''

Write-Host '4. Ce que le module en tire (Get-AdGroupesDe)' -ForegroundColor Yellow
$groupes = @(Get-AdGroupesDe -Sam $cible.SamAccountName -Ad $ad)
Write-Host "   $($groupes.Count) groupe(s)"
foreach ($g in $groupes) { Write-Host "     $($g.Nom)" }
Write-Host ''

Write-Host "5. Groupes donnés d'office à tout nouveau compte de $($soc.id) (config.json → groupesAuto)" -ForegroundColor Yellow
Write-Host "   $(if ($soc.groupesAuto) { $soc.groupesAuto -join ' ; ' } else { '(aucun)' })"
$reste = @($groupes | Where-Object { $soc.groupesAuto -notcontains $_.Nom })
Write-Host "   Reprenables après exclusion : $($reste.Count)"
Write-Host ''
try { Stop-Transcript | Out-Null } catch { }
