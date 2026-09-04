# ============================================================================
# filtro_logs.ps1 - Comenta els logs aliens al tema actual per estalviar tokens
# ============================================================================
# ÚS:
#   powershell -File filtro_logs.ps1 -Action apply   -Keywords "DoblePantalla"
#   powershell -File filtro_logs.ps1 -Action revert
#
# - apply  : prefija '// [LOGFILT] ' a les línies de log que NO continguin cap keyword.
#   Només toca línies COMPLETES (log( ... ) a la mateixa línia) per no trencar template literals.
#   Es guarda una còpia .bak de cada fitxer modificat.
# - revert : elimina els prefijs '// [LOGFILT] ' (marca pròpia del script). Els .bak queden
#   com a còpia de seguretat manual extra.
#
# NOTA RECOMANADA: la manera més segura i reversible és el filtre en temps real de
# utils.js (FASTPASS_UI.Utils.setLogFilter('DoblePantalla')), que ja està actiu per defecte.
# Aquest script és per als casos on vulguis silenciar el codi del tot.
# ============================================================================

param(
    [string]$Action = "apply",
    [string]$Keywords = "DoblePantalla",
    [string]$Root = "$PSScriptRoot\.."
)

$ErrorActionPreference = "Stop"
$keywords = $Keywords.Split(',') | ForEach-Object { $_.Trim().ToLower() } | Where-Object { $_ }

Write-Host "=== FILTRE DE LOGS ==="
Write-Host "Acció: $Action | Keywords: $($keywords -join ', ') | Arrel: $Root"

$files = Get-ChildItem -Path $Root -Recurse -File -Include *.js, *.jsx |
    Where-Object { $_.FullName -notmatch '\\docs\\|\\node_modules\\|\\plans\\|\\INFO\\|\\debug\\' }

$totalMod = 0

foreach ($f in $files) {
    $lines = Get-Content -LiteralPath $f.FullName -Encoding UTF8
    $changed = $false
    $out = New-Object System.Collections.Generic.List[string]

    foreach ($line in $lines) {
        # --- REVERT: treure la marca pròpia ---
        if ($Action -eq "revert") {
            if ($line -match '^\s*// \[LOGFILT\] (.*)$') {
                $out.Add($Matches[1])
                $changed = $true
                continue
            }
            $out.Add($line)
            continue
        }

        # --- APPLY ---
        # Si ja està marcat, deixar-ho
        if ($line -match '^\s*// \[LOGFILT\]') { $out.Add($line); continue }

        $trimmed = $line.TrimStart()
        if ($trimmed.StartsWith('//') -or $trimmed.StartsWith('/*') -or $trimmed.StartsWith('*')) {
            $out.Add($line); continue
        }

        $hasLog = $line -match '(^|[^A-Za-z0-9_])(log|console\.log|\.writeln)\s*\('
        $hasKeyword = $false
        foreach ($kw in $keywords) {
            if ($line.ToLower().Contains($kw)) { $hasKeyword = $true; break }
        }

        if ($hasLog -and -not $hasKeyword) {
            $open  = ($line.ToCharArray() | Where-Object { $_ -eq '(' }).Count
            $close = ($line.ToCharArray() | Where-Object { $_ -eq ')' }).Count
            # Només línies completes (mateix nombre d'obert/tancat) per no trencar res
            if ($open -eq $close -and $open -gt 0) {
                $out.Add('// [LOGFILT] ' + $line)
                $changed = $true
                continue
            }
        }
        $out.Add($line)
    }

    if ($changed) {
        Copy-Item -LiteralPath $f.FullName -Destination ($f.FullName + '.bak') -Force
        # Escriure UTF-8 sense BOM per no corrompre la codificació dels .js/.jsx
        [System.IO.File]::WriteAllLines($f.FullName, $out)
        $totalMod++
        Write-Host ("  - {0}" -f $f.FullName.Replace($Root, '.'))
    }
}

Write-Host "=== FET: $totalMod fitxers $Action (backups .bak a cada carpeta) ==="
