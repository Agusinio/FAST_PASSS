<#
    sizes.ps1 — Informe de mida del repo (exclou .git, .cline, bin\ffmpeg, node_modules)
    Serveix per vigilar que no tornem a acumular basura ni fitxers grossos.

    Ús:
      powershell -NoProfile -ExecutionPolicy Bypass -File ".\bin\sizes.ps1"

    Sortida: C:\temp\fp\sizes.txt (i un resum de 5 línies per consola)
#>
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$outDir = 'C:\temp\fp'
if (!(Test-Path -LiteralPath $outDir)) { New-Item -ItemType Directory -Path $outDir -Force | Out-Null }
$out = Join-Path $outDir 'sizes.txt'
$skip = '\\.git\\|\\.cline\\|\\bin\\ffmpeg\\|node_modules'

$files = @(Get-ChildItem -LiteralPath $root -Recurse -File -Force -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -notmatch $skip })

$lines = @()
$lines += 'REPO: ' + $root
$lines += ('FITXERS: {0}   TOTAL: {1} MB' -f $files.Count, [math]::Round((($files | Measure-Object Length -Sum).Sum / 1MB), 2))
$lines += ('JUNK ._* : {0}' -f @($files | Where-Object { $_.Name -like '._*' }).Count)
$lines += ''
$lines += 'TOP 20 FITXERS (MB):'
$files | Sort-Object Length -Descending | Select-Object -First 20 | ForEach-Object {
    $lines += ('{0,8:N2}  {1}' -f ($_.Length / 1MB), $_.FullName.Substring($root.Length + 1))
}
$lines += ''
$lines += 'PER CARPETA TOP-LEVEL (MB):'
$top = @()
foreach ($d in (Get-ChildItem -LiteralPath $root -Force -Directory -ErrorAction SilentlyContinue)) {
    if ($d.Name -in '.git', '.cline') { continue }
    $s = (Get-ChildItem -LiteralPath $d.FullName -Recurse -File -Force -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -notmatch $skip } | Measure-Object Length -Sum).Sum
    $top += [pscustomobject]@{ Name = $d.Name; MB = [math]::Round($s / 1MB, 2) }
}
foreach ($t in ($top | Sort-Object MB -Descending)) { $lines += ('{0,8:N2}  {1}' -f $t.MB, $t.Name) }

[System.IO.File]::WriteAllLines($out, $lines)
Write-Host ("Informe complet -> {0}" -f $out)
$lines | Select-Object -First 5 | ForEach-Object { Write-Host $_ }
