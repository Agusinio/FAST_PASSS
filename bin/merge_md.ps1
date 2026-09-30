<#
    merge_md.ps1 — Fusiona N fitxers Markdown en un de sol (arxiu), amb secció per fitxer.
    Lectura i escriptura en UTF-8 SENSE BOM (PS 5.1 amb Get-Content trenca els accents).

    Ús:
      powershell -NoProfile -ExecutionPolicy Bypass -File ".\bin\merge_md.ps1" `
          -Title "ARXIU · SESSIONS" -Out "docs\archive\SESSIONS.md" `
          -Src ".roo\progress\2026-09-15.md",".roo\progress\2026-09-16.md"

    Paràmetres:
      -Out    fitxer destí (relatiu a l'arrel del repo o absolut)
      -Src    llista de fitxers origen (relatius o absoluts)
      -Title  títol H1 de l'arxiu (opcional)

    IMPORTANT: NO esborra els originals. Esborrar-los després de verificar el resultat.
#>
param(
    [Parameter(Mandatory = $true)][string]$Out,
    [Parameter(Mandatory = $true)][string[]]$Src,
    [string]$Title = ''
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$utf8 = New-Object System.Text.UTF8Encoding($false)   # sense BOM
$outPath = if ([System.IO.Path]::IsPathRooted($Out)) { $Out } else { Join-Path $root $Out }
$dir = Split-Path -Parent $outPath
if (!(Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }

$buf = New-Object System.Text.StringBuilder
if ($Title) {
    [void]$buf.AppendLine('# ' + $Title)
    [void]$buf.AppendLine('')
    [void]$buf.AppendLine('> Documentació tancada · fusionada el ' + (Get-Date -Format 'yyyy-MM-dd') + ' · els originals són a l''historial de git.')
}

$ok = 0
$total = 0
foreach ($s in $Src) {
    $p = if ([System.IO.Path]::IsPathRooted($s)) { $s } else { Join-Path $root $s }
    if (!(Test-Path -LiteralPath $p)) { Write-Host ('⚠️ no trobat: ' + $s); continue }
    $txt = [System.IO.File]::ReadAllText($p, [System.Text.Encoding]::UTF8)
    $n = @($txt -split "`n").Count
    [void]$buf.AppendLine('')
    [void]$buf.AppendLine('---')
    [void]$buf.AppendLine('')
    [void]$buf.AppendLine('## ' + (Split-Path $p -Leaf))
    [void]$buf.AppendLine('')
    [void]$buf.Append($txt)
    if ($txt -notmatch "`n$") { [void]$buf.AppendLine('') }
    $ok++
    $total += $n
    Write-Host ('  + {0} ({1} linies)' -f (Split-Path $p -Leaf), $n)
}

[System.IO.File]::WriteAllText($outPath, $buf.ToString(), $utf8)
$outLines = @([System.IO.File]::ReadAllText($outPath, [System.Text.Encoding]::UTF8) -split "`n").Count
Write-Host ('Fusionats {0} fitxers ({1} linies origen) -> {2} ({3} linies)' -f $ok, $total, $outPath, $outLines)
