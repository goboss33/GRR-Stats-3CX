#Requires -Version 5.1
<#
    Enregistre la clé XAPI d'un PBX dans le coffre local des scripts.

    Le secret est chiffré par Windows pour CETTE machine (DPAPI, portée
    LocalMachine) : il ne se lit que sur elle, et par quiconque y ouvre une
    session — sur un contrôleur de domaine, seuls les administrateurs. Il
    n'apparaît jamais dans config.json ni dans les logs.

    Usage :  .\Set-Secret.ps1              (PBX « gerofinance » par défaut)
             .\Set-Secret.ps1 -Pbx autre
#>
param([string] $Pbx = 'gerofinance')

Import-Module (Join-Path $PSScriptRoot 'Collaborateurs.psm1') -Force
$config = Get-Content (Join-Path $PSScriptRoot 'config.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$def = $config.pbx.$Pbx
if (-not $def) { throw "PBX « $Pbx » absent de config.json." }

$secure = Read-Host "Clé XAPI du PBX $Pbx ($($def.adresse), ID client « $($def.clientId) »)" -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try { $clair = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
if (-not $clair) { throw "Clé vide." }

$chemin = Join-Path $PSScriptRoot $def.fichierSecret
Protect-Secret -Valeur $clair -Chemin $chemin
Write-Host "Secret enregistré : $chemin" -ForegroundColor Green

# Preuve immédiate : un jeton, sans rien écrire sur le PBX.
try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    $rep = Invoke-RestMethod -Method Post -Uri "$($def.adresse)/connect/token" -ContentType 'application/x-www-form-urlencoded' `
        -Body @{ grant_type = 'client_credentials'; client_id = $def.clientId; client_secret = $clair } -TimeoutSec 20
    if ($rep.access_token) { Write-Host "Connexion au PBX vérifiée : jeton obtenu." -ForegroundColor Green }
    else { Write-Host "Le PBX n'a pas rendu de jeton — vérifiez l'ID client et la clé." -ForegroundColor Yellow }
} catch {
    Write-Host "Le PBX a refusé la clé : $($_.Exception.Message)" -ForegroundColor Red
}
