<#
    find.ps1 — Cerca compacta a les capes de CODI (mai .git / .cline / bin\ffmpeg / docs)
    Deixa TOTA la sortida en un fitxer de C:\temp\fp i només imprimeix un resum:
    així la consola no es contamina ni es trunca la resposta.

    Ús:
      powershell -NoProfile -ExecutionPolicy Bypass -File ".\bin\find.ps1" -Patro "checkContext"
      powershell -NoProfile -ExecutionPolicy Bypass -File ".\bin\find.ps1" -Patro "readFolder" -Scope js,jsx,html
      powershell -NoProfile -ExecutionPolicy Bypass -File ".\bin\find.ps1" -Patro "wotts" -All

    Paràmetres:
      -Patro  expressió regular a buscar (obligatori)
      -Scope  carpetes a escanejar (per defecte js,jsx). Valors: js, jsx, html (arrel), bin, css
      -All    escaneja tot el repo excepte .git, .cline, bin\ffmpeg, node_modules
      -Max    llindar d'avís per sortida gran (per defecte 200 línies)

    Sortida: C:\temp\fp\find_<patro>.txt
#>
param(
    [Parameter(Mandatory = $true)][string]$Patro,
    [string[]]$Scope = @('js', 'jsx'),
    [switch]$All,
    [int]$Max = 200
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$outDir = 'C:\temp\fp'
if (!(Test-Path -LiteralPath $outDir)) { New-Item -ItemType Directory -Path $outDir -Force | Out-Null }
$out = Join-Path $outDir ('find_' + ($Patro -replace '[^a-zA-Z0-9_]', '_') + '.txt')

$skip = '\\.git\\|\\.cline\\|\\bin\\ffmpeg\\|node_modules'
$targets = @()

if ($All) {
    $targets = @(Get-ChildItem -LiteralPath $root -Recurse -File -Force -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -notmatch $skip -and $_.Extension -in '.js', '.jsx', '.html', '.css', '.json', '.ps1' })
}
else {
    foreach ($s in $Scope) {
        $p = Join-Path $root $s
        if (!(Test-Path -LiteralPath $p)) { continue }
        if ((Get-Item -LiteralPath $p).PSIsContainer) {
            $targets += @(Get-ChildItem -LiteralPath $p -Recurse -File -ErrorAction SilentlyContinue |
                Where-Object { $_.Extension -in '.js', '.jsx', '.html', '.css', '.json', '.ps1' })
        }
        else {
            $targets += @(Get-Item -LiteralPath $p)
        }
    }
}

if ($targets.Count -eq 0) { Write-Host "Sense fitxers a escanejar (Scope: $($Scope -join ', '))"; exit 1 }

$hits = @($targets | Select-String -Pattern $Patro -ErrorAction SilentlyContinue)
$lines = @()
foreach ($h in $hits) { $lines += ('{0}:{1}: {2}' -f $h.Path.Substring($root.Length + 1), $h.LineNumber, $h.Line.Trim()) }
[System.IO.File]::WriteAllLines($out, $lines)

$nFiles = @($hits | Select-Object -ExpandProperty Path -Unique).Count
Write-Host ("{0} coincidencies a {1} fitxers ({2} fitxers escanejats) -> {3}" -f $hits.Count, $nFiles, $targets.Count, $out)
if ($lines.Count -gt $Max) { Write-Host "⚠️ Sortida gran: llegeix el fitxer a trossos (start_line/end_line)" }
