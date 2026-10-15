# install_hooks.ps1 - Instal.la els hooks de git del repo (veure BUG #155).
# ============================================================================
# Copia bin/hooks/* a .git/hooks/ (git portable: E:\PortableGit).
# El hook pre-commit executa bin/check_dead.ps1 i BLOQUEJA el commit si hi ha
# codi mort a js/ o jsx/, o si ha tornat la carpeta INFO/ de l'arbre antic.
#
# Us:  powershell -NoProfile -ExecutionPolicy Bypass -File .\bin\install_hooks.ps1
#
# NOTA: .git/hooks/ NO es versiona; per aixo el hook viu a bin/hooks/ i s'ha de
# reinstal.lar si es torna a clonar el repo o es regenera .git/.
# ============================================================================

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot          # bin/ -> arrel del repo
$srcDir   = Join-Path $PSScriptRoot 'hooks'
$dstDir   = Join-Path $repoRoot '.git\hooks'

if (-not (Test-Path -LiteralPath $srcDir)) { throw "No existeix la carpeta d'origen: $srcDir" }
if (-not (Test-Path -LiteralPath $dstDir)) { throw "No existeix $dstDir (aixo no sembla un repo git)" }

$n = 0
Get-ChildItem -LiteralPath $srcDir -File | ForEach-Object {
    $target = Join-Path $dstDir $_.Name
    Copy-Item -LiteralPath $_.FullName -Destination $target -Force
    Write-Host ("INSTAL.LAT: .git/hooks/" + $_.Name)
    $n++
}

if ($n -eq 0) { Write-Host "CAP HOOK a instal.lar (carpeta bin/hooks buida)" }
else { Write-Host ("FET: " + $n + " hook(s) instal.lat(s)") }
