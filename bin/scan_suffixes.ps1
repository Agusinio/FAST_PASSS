param([string]$BaseDir)

# D13v2: Catalogar sufijos estructurales en todos los JSON
# Extrae todos los sufijos de `num`, los agrupa, y muestra estadísticas
# v2: Usa concatenación simple para evitar errores de formato con caracteres catalanes

$programs = @("TN_COMARQUES", "TN_MIGDIA", "TN_VESPRE")
$allFiles = @()
foreach ($prog in $programs) {
    $found = Get-ChildItem -LiteralPath $BaseDir -Filter "${prog}_202605*.json" -ErrorAction SilentlyContinue
    if ($found) { $allFiles += $found }
}

# Función helper: pad derecho
function PadR($str, $len) {
    $s = [string]$str
    if ($s.Length -ge $len) { return $s.Substring(0, $len) }
    return $s.PadRight($len)
}
function PadL($str, $len) {
    $s = [string]$str
    if ($s.Length -ge $len) { return $s.Substring(0, $len) }
    return $s.PadLeft($len)
}

$suffixData = @{}  # suffix -> { count, examples, durada0, hasAgrupacio, hasOnAir, hasPrevista, titols, programs }

foreach ($f in ($allFiles | Sort-Object Name)) {
    $json = Get-Content $f.FullName -Raw | ConvertFrom-Json
    $lines = $json.escaleta.liniesEscaleta
    for ($i = 0; $i -lt $lines.Count; $i++) {
        $line = $lines[$i]
        $num = $line.num
        if (-not $num) { continue }
        $clean = $num.ToString().ToLower().Trim()
        if ($clean -match '^(\d+)(.*)$') {
            $suffix = $Matches[2]
            if (-not $suffixData.ContainsKey($suffix)) {
                $suffixData[$suffix] = @{
                    count = 0
                    examples = @()
                    durada0 = 0
                    hasAgrupacio = 0
                    hasOnAir = 0
                    hasPrevista = 0
                    titols = @()
                    nextTitols = @()
                    programs = @{}
                }
            }
            $sd = $suffixData[$suffix]
            $sd.count++
            if ($sd.examples.Count -lt 5) { $sd.examples += $num }
            if ($sd.titols.Count -lt 3 -and $line.titol) {
                $sd.titols += $line.titol.Substring(0, [Math]::Min(55, $line.titol.Length))
            }
            # Capturar el titol del item siguiente (para detectar parejas Off→OFF, intro→BVU, etc.)
            if ($sd.nextTitols.Count -lt 3 -and ($i + 1) -lt $lines.Count) {
                $nextLine = $lines[$i + 1]
                if ($nextLine.titol) {
                    $sd.nextTitols += $nextLine.titol.Substring(0, [Math]::Min(40, $nextLine.titol.Length))
                }
            }
            # Detectar programa
            if ($f.Name -match '^TN_(\w+)_') {
                $prog = $Matches[1]
                if (-not $sd.programs.ContainsKey($prog)) { $sd.programs[$prog] = 0 }
                $sd.programs[$prog]++
            }
            if ($line.durada -and $line.durada -ne '00:00' -and $line.durada -ne '00:00:00') { } else { $sd.durada0++ }
            if ($line.agrupacio) { $sd.hasAgrupacio++ }
            if ($line.horaEntradaOnAir -and $line.horaEntradaOnAir -ne '00:00:00') { $sd.hasOnAir++ }
            if ($line.horaEntradaPrevista -and $line.horaEntradaPrevista -ne '00:00:00') { $sd.hasPrevista++ }
        }
    }
}

# Cabecera
$hdr = (PadR "SUFFIX" 14) + (PadL "COUNT" 6) + "  " + (PadL "DUR=0" 5) + "  " + (PadL "AGRUP" 5) + "  " + (PadL "OnAir" 5) + "  " + (PadL "PREV" 5) + "  " + "PROGRAMAS" + "  " + "NEXT-TITOLS (parejas)"
Write-Host $hdr
Write-Host ("-" * 140)

# Sort: empty first, then by count desc
$sorted = $suffixData.GetEnumerator() | Sort-Object {
    if ($_.Key -eq '') { return ' 0' }
    elseif ($_.Key -match '^[a-z]') { return ' 1_' + $_.Key }
    else { return ' 2_' + $_.Key }
}

foreach ($entry in $sorted) {
    $s = $entry.Key
    $sd = $entry.Value
    $suffixDisplay = if ($s -eq '') { '(sin sufijo)' } else { $s }
    
    # Programas donde aparece
    $progStr = ($sd.programs.Keys | Sort-Object | ForEach-Object { "$_=$($sd.programs[$_])" }) -join ' '
    
    # Línea de estadísticas
    $statLine = (PadR $suffixDisplay 14) + (PadL $sd.count 6) + "  " + (PadL $sd.durada0 5) + "  " + (PadL $sd.hasAgrupacio 5) + "  " + (PadL $sd.hasOnAir 5) + "  " + (PadL $sd.hasPrevista 5) + "  " + $progStr
    Write-Host $statLine
    
    # Ejemplos
    if ($sd.examples.Count -gt 0) {
        Write-Host ("  EJ: " + ($sd.examples -join ', '))
    }
    # Títulos
    if ($sd.titols.Count -gt 0) {
        Write-Host ("  TI: " + ($sd.titols -join ' | '))
    }
    # Siguientes (parejas)
    if ($sd.nextTitols.Count -gt 0) {
        Write-Host ("  >> " + ($sd.nextTitols -join ' | '))
    }
    Write-Host ""
}

Write-Host "=== RESUMEN: Total unique suffixes = $($suffixData.Count) ==="
