param([string]$BaseDir)

# D13: Verificar parejas inseparables: qué sigue a intro (i), Off (f), dp, dir
$files = Get-ChildItem -LiteralPath $BaseDir -Filter 'TN_*_202605*.json' -ErrorAction SilentlyContinue | Sort-Object Name

function Get-Followers($suffixPattern) {
    $followers = @{}
    foreach ($f in $files) {
        $json = Get-Content $f.FullName -Raw | ConvertFrom-Json
        $lines = $json.escaleta.liniesEscaleta
        for ($i = 0; $i -lt $lines.Count - 1; $i++) {
            $num = $lines[$i].num
            if (-not $num) { continue }
            $clean = $num.ToString().ToLower().Trim()
            if ($clean -match $suffixPattern) {
                $nextNum = $lines[$i+1].num
                if ($nextNum) {
                    $nClean = $nextNum.ToString().ToLower().Trim()
                    if ($nClean -match '^\d+(.*)$') {
                        $nextSuffix = $Matches[1]
                        if ($nextSuffix -eq '') { $nextSuffix = '(sin sufijo)' }
                        if (-not $followers.ContainsKey($nextSuffix)) { 
                            $followers[$nextSuffix] = @{ count = 0; examples = @() } 
                        }
                        $followers[$nextSuffix].count++
                        if ($followers[$nextSuffix].examples.Count -lt 5) {
                            $t = if ($lines[$i+1].titol) { $lines[$i+1].titol.Substring(0, [Math]::Min(40, $lines[$i+1].titol.Length)) } else { '?' }
                            $followers[$nextSuffix].examples += "$nextNum = $t"
                        }
                    }
                }
            }
        }
    }
    return $followers
}

Write-Host "=== Qué sigue a intro (sufijo 'i') ==="
$introF = Get-Followers '^\d+i$'
$introF.GetEnumerator() | Sort-Object { $_.Value.count } -Descending | ForEach-Object {
    $s = $_.Key; $d = $_.Value
    Write-Host "  $s : $($d.count) veces"
    foreach ($ex in $d.examples) { Write-Host "    EJ: $ex" }
}

Write-Host ""
Write-Host "=== Qué sigue a Off (sufijo 'f') ==="
$offF = Get-Followers '^\d+f$'
$offF.GetEnumerator() | Sort-Object { $_.Value.count } -Descending | ForEach-Object {
    $s = $_.Key; $d = $_.Value
    Write-Host "  $s : $($d.count) veces"
    foreach ($ex in $d.examples) { Write-Host "    EJ: $ex" }
}

Write-Host ""
Write-Host "=== Qué sigue a dp (dona pas) ==="
$dpF = Get-Followers '^\d+dp$'
$dpF.GetEnumerator() | Sort-Object { $_.Value.count } -Descending | ForEach-Object {
    $s = $_.Key; $d = $_.Value
    Write-Host "  $s : $($d.count) veces"
    foreach ($ex in $d.examples) { Write-Host "    EJ: $ex" }
}

Write-Host ""
Write-Host "=== Qué sigue a dir (conexion/directe) ==="
$dirF = Get-Followers '^\d+dir$'
$dirF.GetEnumerator() | Sort-Object { $_.Value.count } -Descending | ForEach-Object {
    $s = $_.Key; $d = $_.Value
    Write-Host "  $s : $($d.count) veces"
    foreach ($ex in $d.examples) { Write-Host "    EJ: $ex" }
}
