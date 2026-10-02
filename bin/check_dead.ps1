<#
    check_dead.ps1 — Detecta CODI MUERT (fitxers que no carrega ningú).
    ============================================================================
    Per qué existeix: el 23/07/2026 es van esborrar les famílies de nomenclatura
    vella (flux_*.js, 10_Eines.js, logger.js, 10_Sistema.jsx…) però van TORNAR
    el 29/09 en restaurar/copiar un arbre antic del pendrive a la carpeta de
    l'extensió + `git add -A` (commit c757b1e). El 02/10 es van esborrar una
    altra vegada (#115). Aquesta guarda és l'alarma per no repetir-ho: diu si
    ha aparegut a `js/` o `jsx/` cap fitxer que no carregui la seva autoritat.

    Autoritats de càrrega (no n'hi ha cap altra, no hi ha carregador dinàmic):
      - js/  -> index.html, llista <script src="js/...">
      - jsx/ -> jsx/main.jsx, crides load("X.jsx")

    Ús:
        powershell -NoProfile -ExecutionPolicy Bypass -File ".\bin\check_dead.ps1"
        ... -File ".\bin\check_dead.ps1" -ListAll      # llista també el que SÍ es carrega

    Sortida: resum per consola + informe complet a C:\temp\fp\dead_code.txt
    Exit code: 0 = net · 1 = hi ha codi mort · 2 = error d'entorn.
#>
param(
    [string]$BaseDir = (Split-Path -Parent $PSScriptRoot),
    [switch]$ListAll
)

$ErrorActionPreference = 'Stop'
$jsDir   = Join-Path $BaseDir 'js'
$jsxDir  = Join-Path $BaseDir 'jsx'
$htmlPath = Join-Path $BaseDir 'index.html'
$mainJsx  = Join-Path $jsxDir 'main.jsx'
foreach ($p in @($jsDir, $jsxDir, $htmlPath, $mainJsx)) {
    if (!(Test-Path -LiteralPath $p)) { Write-Host ("FALTA: " + $p); exit 2 }
}

$outDir = 'C:\temp\fp'
if (!(Test-Path -LiteralPath $outDir)) { New-Item -ItemType Directory -Path $outDir -Force | Out-Null }
$outPath = Join-Path $outDir 'dead_code.txt'

# --- Autoritat JS: index.html ---
$loadedJs = @()
foreach ($m in (Select-String -Path $htmlPath -Pattern 'src="(js/[^"?]+)' -AllMatches).Matches) {
    $loadedJs += $m.Groups[1].Value
}

# --- Autoritat JSX: jsx/main.jsx ---
$loadedJsx = @()
foreach ($m in (Select-String -Path $mainJsx -Pattern 'load\("([^"]+)"\)' -AllMatches).Matches) {
    $loadedJsx += $m.Groups[1].Value
}

# --- Inventari de disc ---
$diskJs = @(Get-ChildItem -LiteralPath $jsDir -Recurse -File -Filter '*.js' |
    ForEach-Object { $_.FullName.Substring($BaseDir.Length + 1) -replace '\\', '/' })
$diskJsx = @(Get-ChildItem -LiteralPath $jsxDir -Recurse -File -Filter '*.jsx' |
    ForEach-Object { $_.FullName.Substring($BaseDir.Length + 1) -replace '\\', '/' })

$orphanJs  = @($diskJs  | Where-Object { $loadedJs  -notcontains $_ })
# jsx: main.jsx és el carregador (punt d'entrada), no el carrega ningú; i les crides
# load("X.jsx") donen NOM, no ruta → es compara pel nom del fitxer.
$orphanJsx = @($diskJsx |
    Where-Object { $_ -ne 'jsx/main.jsx' } |
    Where-Object { $loadedJsx -notcontains (Split-Path -Leaf $_) })

# --- Nomenclatura vella: la família morta del #115 (llista tancada, no heurística:
#     els noms numerats SEGUEIXEN sent vàlids a js/, així que no es pot generalitzar) ---
$legacyNames = @(
    'flux_animacio.js', 'flux_exportacio.js', 'flux_muntatge.js', 'flux_principal.js',
    'flux_retols.js', 'flux_subtitols.js', 'flux_tall.js', 'flux_principal.js',
    '10_Eines.js', '12_Estat.js', '13_Registre.js', '14_Sintesi.js', 'logger.js',
    '20_Sessio.js', '21_Aplicacio.js', '22_Escaneig.js', '23_Analisi.js',
    '31_Pistes.js', '32_Segments.js', '35_Subtitols.js', '36_Projecte.js',
    '10_Sistema.jsx', '11_Entorn.jsx', '12_Arxiu.jsx', '19_Diagnosi.jsx'
)
$legacy = @($diskJs + $diskJsx | Where-Object {
        $legacyNames -contains (Split-Path -Leaf $_)
    })

$lines = @()
$lines += 'AUTORITAT JS  (index.html):  ' + $loadedJs.Count + ' fitxers'
$lines += 'AUTORITAT JSX (main.jsx):    ' + $loadedJsx.Count + ' fitxers'
$lines += 'DISC js/**/*.js:             ' + $diskJs.Count
$lines += 'DISC jsx/**/*.jsx:           ' + $diskJsx.Count
$lines += ''
$lines += '--- CODI MUERT: a disc i cap autoritat el carrega (' + ($orphanJs.Count + $orphanJsx.Count) + ') ---'
if ($orphanJs.Count)  { $lines += ($orphanJs  | ForEach-Object { 'ORFEN  js   ' + $_ }) }
if ($orphanJsx.Count) { $lines += ($orphanJsx | ForEach-Object { 'ORFEN  jsx  ' + $_ }) }
$lines += ''
$lines += '--- NOMENCLATURA VELLA (' + $legacy.Count + ') ---'
if ($legacy.Count) { $lines += ($legacy | ForEach-Object { 'VELL   ' + $_ }) }
if ($ListAll) {
    $lines += ''
    $lines += '--- CARREGATS (informatiu) ---'
    $lines += ($loadedJs  | ForEach-Object { 'OK     js   ' + $_ })
    $lines += ($loadedJsx | ForEach-Object { 'OK     jsx  ' + $_ })
}
[System.IO.File]::WriteAllLines($outPath, $lines)

$dead = $orphanJs.Count + $orphanJsx.Count
if ($dead -gt 0 -or $legacy.Count -gt 0) {
    $lines | Where-Object { $_ -like 'ORFEN*' -or $_ -like 'VELL*' } | ForEach-Object { Write-Host $_ }
}
Write-Host ('CODI MUERT: ' + $dead + ' orfes | nomenclatura vella: ' + $legacy.Count + ' | informe: ' + $outPath)
if ($dead -gt 0 -or $legacy.Count -gt 0) {
    Write-Host '⚠️ Algú pot haver restaurat un arbre antic (pendrive) dins la extensio: revisar abans de commitear.'
    exit 1
}
Write-Host 'OK: cap fitxer de js/ o jsx/ sense carregador.'
exit 0
