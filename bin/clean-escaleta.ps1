param(
    [string]$FilePath = "docs/SAMPLES/DATA/TN_VESPRE_20260429_213007.json",
    [switch]$DryRun = $false,
    [switch]$FilterFields = $true
)

Add-Type -AssemblyName System.Web.Extensions

$serializer = New-Object System.Web.Script.Serialization.JavaScriptSerializer
$serializer.MaxJsonLength = [Int32]::MaxValue

# ============================================================
# FUNCIÓN: Formatear JSON con indentación de 2 espacios
# ============================================================
function Format-Json([string]$json) {
    $indent = 0
    $sb = New-Object System.Text.StringBuilder
    $inString = $false
    $escape = $false
    
    for ($i = 0; $i -lt $json.Length; $i++) {
        $c = $json[$i]
        
        if ($escape) { [void]$sb.Append($c); $escape = $false; continue }
        if ($c -eq '\' -and $inString) { $escape = $true; [void]$sb.Append($c); continue }
        if ($c -eq '"') { $inString = !$inString; [void]$sb.Append($c); continue }
        if ($inString) { [void]$sb.Append($c); continue }
        
        if ($c -eq '{' -or $c -eq '[') {
            $indent++; [void]$sb.Append($c); [void]$sb.Append("`r`n"); [void]$sb.Append(("  " * $indent))
            continue
        }
        if ($c -eq '}' -or $c -eq ']') {
            $indent--; [void]$sb.Append("`r`n"); [void]$sb.Append(("  " * $indent)); [void]$sb.Append($c)
            continue
        }
        if ($c -eq ',') {
            [void]$sb.Append(','); [void]$sb.Append("`r`n"); [void]$sb.Append(("  " * $indent))
            continue
        }
        if ($c -eq ':') { [void]$sb.Append(': '); continue }
        if ($c -eq ' ' -or $c -eq "`t" -or $c -eq "`r" -or $c -eq "`n") { continue }
        
        [void]$sb.Append($c)
    }
    
    return $sb.ToString().TrimStart([char]0xFEFF)
}

# ============================================================
# FUNCIÓN: Determinar si un item es un "ancla temporal" válida
# Un ancla temporal tiene teVideo=true Y:
#   - horaEntradaOnAir definido (emisión real), O
#   - horaEntradaPrevista Y horaSortidaPrevista definidos (planificación)
# ============================================================
function IsTemporalAnchor($item) {
    if ($item["teVideo"] -ne $true) { return $false }
    
    # Opción 1: OnAir real
    $onAir = $item["horaEntradaOnAir"]
    if ($null -ne $onAir -and $onAir -ne "") { return $true }
    
    # Opción 2: Previstos (planificación)
    $entrada = $item["horaEntradaPrevista"]
    $sortida = $item["horaSortidaPrevista"]
    if ($null -ne $entrada -and $entrada -ne "" -and $entrada -ne "00:00:00" -and
        $null -ne $sortida -and $sortida -ne "" -and $sortida -ne "00:00:00") {
        return $true
    }
    
    return $false
}

# ============================================================
# FUNCIÓN: Campos permitidos para el filtrado de items de escaleta
# Orden de serialización deseado
# ============================================================
$ALLOWED_FIELDS = @(
    "sequencia",
    "num",
    "titol",
    "agrupacio",
    "horaEntradaOnAir",
    "duradaOnAir",
    "horaEntradaPrevista",
    "horaSortidaPrevista",
    "durada",
    "font",
    "idNumeric",
    "origen",
    "teVideo",
    "assetId",
    "flotant"
)

# Mapa para O(1) lookup de campos permitidos
$ALLOWED_FIELDS_MAP = @{}
foreach ($f in $ALLOWED_FIELDS) { $ALLOWED_FIELDS_MAP[$f] = $true }

# ============================================================
# FUNCIÓN: Clonar un item extrayendo solo los campos permitidos
# Necesario para evitar referencias circulares al serializar
# ============================================================
function CloneItem($item) {
    $result = @{}
    if ($script:FilterFields) {
        foreach ($key in $item.Keys) {
            if ($script:ALLOWED_FIELDS_MAP.ContainsKey($key)) {
                $result[$key] = $item[$key]
            }
        }
    } else {
        foreach ($key in $item.Keys) {
            $result[$key] = $item[$key]
        }
    }
    return $result
}

# ============================================================
# FUNCIÓN: Serializar un valor al formato JSON
# ============================================================
function SerializeValue($val) {
    if ($null -eq $val) { return "null" }
    $type = $val.GetType().Name
    if ($type -eq "String") { return $serializer.Serialize($val) }
    if ($type -eq "Boolean") { if ($val) { return "true" } else { return "false" } }
    if ($type -eq "Int32" -or $type -eq "Int64" -or $type -eq "Double" -or $type -eq "Decimal") { return $val.ToString() }
    return $serializer.Serialize($val)
}

# ============================================================
# FUNCIÓN: Serializar un item de escaleta con orden de campos controlado
# ============================================================
function SerializeItem($item) {
    $sb = New-Object System.Text.StringBuilder
    [void]$sb.Append('{')
    $first = $true
    foreach ($key in $script:ALLOWED_FIELDS) {
        if ($item.ContainsKey($key)) {
            if (-not $first) { [void]$sb.Append(',') }
            $first = $false
            [void]$sb.Append('"'); [void]$sb.Append($key); [void]$sb.Append('":')
            [void]$sb.Append((SerializeValue $item[$key]))
        }
    }
    [void]$sb.Append('}')
    return $sb.ToString()
}

# ============================================================
# FUNCIÓN: Construir JSON manualmente para evitar referencias circulares
# ============================================================
function BuildJsonOutput($cleanData) {
    $sb = New-Object System.Text.StringBuilder
    
    # cleanFeed
    $cfJson = $serializer.Serialize($cleanData["cleanFeed"])
    [void]$sb.Append('{"cleanFeed":')
    [void]$sb.Append($cfJson)
    
    # parallelAntena
    $paJson = $serializer.Serialize($cleanData["parallelAntena"])
    [void]$sb.Append(',"parallelAntena":')
    [void]$sb.Append($paJson)
    
    # escaleta
    $esc = $cleanData["escaleta"]
    [void]$sb.Append(',"escaleta":{')
    [void]$sb.Append('"id":'); [void]$sb.Append($serializer.Serialize($esc["id"]))
    [void]$sb.Append(',"tipus":'); [void]$sb.Append($serializer.Serialize($esc["tipus"]))
    [void]$sb.Append(',"data":'); [void]$sb.Append($serializer.Serialize($esc["data"]))
    [void]$sb.Append(',"activa":'); [void]$sb.Append($serializer.Serialize($esc["activa"]))
    [void]$sb.Append(',"origen":'); [void]$sb.Append($serializer.Serialize($esc["origen"]))
    [void]$sb.Append(',"ruta":'); [void]$sb.Append($serializer.Serialize($esc["ruta"]))
    [void]$sb.Append(',"sanId":'); [void]$sb.Append($serializer.Serialize($esc["sanId"]))
    
    # liniesEscaleta - serializar cada item con orden controlado
    [void]$sb.Append(',"liniesEscaleta":[')
    $lines = $esc["liniesEscaleta"]
    for ($i = 0; $i -lt $lines.Count; $i++) {
        if ($i -gt 0) { [void]$sb.Append(',') }
        [void]$sb.Append((SerializeItem $lines[$i]))
    }
    [void]$sb.Append(']}')
    
    [void]$sb.Append('}')
    
    return $sb.ToString()
}

# ============================================================
# FUNCIÓN: Obtener los índices de los items de un bloque en allLines
# Respeta la regla de no-anidamiento: el bloque termina en el último item
# con su agrupacio antes del primer item del siguiente bloque.
# Items con misma agrupacio después del siguiente bloque son "movidos al final"
# y se consideran irrelevantes.
# ============================================================
function GetBlockIndices($allLines, $blockId, $nextBlockId) {
    $target = $blockId.ToLower()
    $nextTarget = if ($nextBlockId) { $nextBlockId.ToLower() } else { $null }
    $indices = New-Object System.Collections.ArrayList
    
    for ($i = 0; $i -lt $allLines.Count; $i++) {
        $ag = $allLines[$i]["agrupacio"]
        if ($null -eq $ag) { continue }
        $agStr = $ag.ToString().ToLower()
        
        if ($agStr -eq $target) {
            [void]$indices.Add($i)
        } elseif ($nextTarget -and $agStr -eq $nextTarget) {
            # Hemos encontrado el primer item del siguiente bloque
            # Los items de este bloque después de aquí son "movidos al final"
            break
        }
    }
    
    if ($indices.Count -eq 0) { return $null }
    
    return @{
        "firstIdx" = $indices[0]
        "lastIdx" = $indices[$indices.Count - 1]
        "count" = $indices.Count
    }
}

# ============================================================
# FUNCIÓN: Buscar hacia atrás desde un índice hasta encontrar un ancla temporal
# Devuelve el índice del ancla encontrada, o -1 si no se encuentra
# ============================================================
function FindAnchorBackward($allLines, $fromIdx) {
    for ($i = $fromIdx - 1; $i -ge 0; $i--) {
        $item = $allLines[$i]
        if ($item["flotant"] -eq $true) { continue }
        if (IsTemporalAnchor $item) { return $i }
    }
    return -1
}

# ============================================================
# FUNCIÓN: Buscar hacia adelante desde un índice hasta encontrar un ancla temporal
# Devuelve el índice del ancla encontrada, o -1 si no se encuentra
# ============================================================
function FindAnchorForward($allLines, $fromIdx) {
    for ($i = $fromIdx + 1; $i -lt $allLines.Count; $i++) {
        $item = $allLines[$i]
        if ($item["flotant"] -eq $true) { continue }
        if (IsTemporalAnchor $item) { return $i }
    }
    return -1
}

# ============================================================
# PROCESAR ARCHIVO
# ============================================================
Write-Host "Procesando: $FilePath" -ForegroundColor Cyan

try {
    $raw = Get-Content $FilePath -Raw -Encoding UTF8
    $data = $serializer.DeserializeObject($raw)
    
    # Extraer estructura general
    $cleanFeed = $data["cleanFeed"]
    $parallelAntena = $data["parallelAntena"]
    $escaleta = $data["escaleta"]
    
    # Extraer metadatos básicos de escaleta
    $escaletaMeta = @{}
    $escaletaMeta["id"] = if ($null -ne $escaleta["id"]) { $escaleta["id"] } else { "" }
    $escaletaMeta["tipus"] = if ($null -ne $escaleta["tipus"]) { $escaleta["tipus"] } else { "" }
    $escaletaMeta["data"] = if ($null -ne $escaleta["data"]) { $escaleta["data"] } else { $null }
    $escaletaMeta["activa"] = if ($null -ne $escaleta["activa"]) { $escaleta["activa"] } else { $false }
    $escaletaMeta["origen"] = if ($null -ne $escaleta["origen"]) { $escaleta["origen"] } else { "" }
    $escaletaMeta["ruta"] = if ($null -ne $escaleta["ruta"]) { $escaleta["ruta"] } else { "" }
    $escaletaMeta["sanId"] = if ($null -ne $escaleta["sanId"]) { $escaleta["sanId"] } else { "" }
    
    # Obtener todas las líneas de escaleta
    $allLines = $escaleta["liniesEscaleta"]
    
    # Obtener los clips (bloques) del cleanFeed
    $clips = $cleanFeed["clips"]
    
    Write-Host "  Bloques en cleanFeed: $($clips.Count)" -ForegroundColor Cyan
    foreach ($clip in $clips) {
        Write-Host "    $($clip['id']): in=$($clip['in']) out=$($clip['out'])" -ForegroundColor Gray
    }
    
    # Conjunto de índices a conservar (usamos hashtable para O(1))
    $keepIndices = @{}
    
    # Para cada bloque, determinar el rango de items a conservar
    for ($c = 0; $c -lt $clips.Count; $c++) {
        $clip = $clips[$c]
        $blockId = $clip["id"]
        $nextBlockId = if ($c -lt $clips.Count - 1) { $clips[$c + 1]["id"] } else { $null }
        
        Write-Host "  Procesando bloque $blockId..." -ForegroundColor Yellow
        
        $blockInfo = GetBlockIndices $allLines $blockId $nextBlockId
        
        if ($null -eq $blockInfo) {
            Write-Host "    ⚠️  No se encontraron items con agrupacio '$blockId'" -ForegroundColor DarkYellow
            continue
        }
        
        $firstIdx = $blockInfo["firstIdx"]
        $lastIdx = $blockInfo["lastIdx"]
        
        $firstItem = $allLines[$firstIdx]
        $lastItem = $allLines[$lastIdx]
        Write-Host "    Items con agrupacio '$blockId': $($blockInfo['count']) items (seq $($firstItem['sequencia'])-$($lastItem['sequencia']))" -ForegroundColor Gray
        
        # 1. Conservar todos los items del bloque (con agrupacio) e intermedios
        for ($i = $firstIdx; $i -le $lastIdx; $i++) {
            $keepIndices[$i] = $true
        }
        
        # 2. Buscar ancla temporal hacia atrás (saltando flotant=true)
        $anchorBack = FindAnchorBackward $allLines $firstIdx
        if ($anchorBack -ge 0) {
            $anchorItem = $allLines[$anchorBack]
            Write-Host "    ← Ancla atrás: num='$($anchorItem['num'])' titol='$($anchorItem['titol'])' (seq=$($anchorItem['sequencia']))" -ForegroundColor Green
            for ($i = $anchorBack; $i -lt $firstIdx; $i++) {
                $keepIndices[$i] = $true
            }
        } else {
            Write-Host "    ← ⚠️  No se encontró ancla temporal hacia atrás" -ForegroundColor DarkYellow
        }
        
        # 3. Buscar ancla temporal hacia adelante (saltando flotant=true)
        $anchorFwd = FindAnchorForward $allLines $lastIdx
        if ($anchorFwd -ge 0) {
            $anchorItem = $allLines[$anchorFwd]
            Write-Host "    → Ancla adelante: num='$($anchorItem['num'])' titol='$($anchorItem['titol'])' (seq=$($anchorItem['sequencia']))" -ForegroundColor Green
            for ($i = $lastIdx + 1; $i -le $anchorFwd; $i++) {
                $keepIndices[$i] = $true
            }
        } else {
            Write-Host "    → ⚠️  No se encontró ancla temporal hacia adelante" -ForegroundColor DarkYellow
        }
    }
    
    # Construir lista final de items conservados, ordenados por sequencia
    $keptLines = New-Object System.Collections.ArrayList
    $removedCount = 0
    
    for ($i = 0; $i -lt $allLines.Count; $i++) {
        if ($keepIndices.ContainsKey($i)) {
            [void]$keptLines.Add((CloneItem $allLines[$i]))
        } else {
            $removedCount++
        }
    }
    
    # Eliminar items flotant=true (directamente borrables)
    $finalLines = New-Object System.Collections.ArrayList
    $flotantRemoved = 0
    
    for ($i = 0; $i -lt $keptLines.Count; $i++) {
        if ($keptLines[$i]["flotant"] -eq $true) {
            $flotantRemoved++
        } else {
            [void]$finalLines.Add($keptLines[$i])
        }
    }
    
    if ($flotantRemoved -gt 0) {
        Write-Host "  Items flotant eliminados: $flotantRemoved" -ForegroundColor DarkYellow
    }
    
    Write-Host "  Lineas originales: $($allLines.Count)" -ForegroundColor Yellow
    Write-Host "  Lineas conservadas (sin flotant): $($finalLines.Count)" -ForegroundColor Green
    Write-Host "  Lineas eliminadas total: $($removedCount + $flotantRemoved)" -ForegroundColor Red
    
    # Mostrar resumen por bloque
    Write-Host "  Resumen por bloque:" -ForegroundColor Cyan
    foreach ($clip in $clips) {
        $blockId = $clip["id"]
        $blockInfo = GetBlockIndices $allLines $blockId
        if ($null -eq $blockInfo) { continue }
        
        $firstIdx = $blockInfo["firstIdx"]
        $lastIdx = $blockInfo["lastIdx"]
        $firstItem = $allLines[$firstIdx]
        $lastItem = $allLines[$lastIdx]
        
        # Encontrar anclas
        $ab = FindAnchorBackward $allLines $firstIdx
        $af = FindAnchorForward $allLines $lastIdx
        
        $desde = if ($ab -ge 0) { $allLines[$ab]["sequencia"] } else { $firstItem["sequencia"] }
        $hasta = if ($af -ge 0) { $allLines[$af]["sequencia"] } else { $lastItem["sequencia"] }
        
        Write-Host "    $blockId : seq $desde -> $hasta (bloque: seq $($($firstItem['sequencia']))-$($($lastItem['sequencia'])))" -ForegroundColor Gray
    }
    
    # Construir estructura limpia
    $cleanData = @{}
    $cleanData["cleanFeed"] = $cleanFeed
    $cleanData["parallelAntena"] = $parallelAntena
    
    $escaletaClean = @{}
    $escaletaClean["id"] = $escaletaMeta["id"]
    $escaletaClean["tipus"] = $escaletaMeta["tipus"]
    $escaletaClean["data"] = $escaletaMeta["data"]
    $escaletaClean["activa"] = $escaletaMeta["activa"]
    $escaletaClean["origen"] = $escaletaMeta["origen"]
    $escaletaClean["ruta"] = $escaletaMeta["ruta"]
    $escaletaClean["sanId"] = $escaletaMeta["sanId"]
    $escaletaClean["liniesEscaleta"] = $finalLines
    
    $cleanData["escaleta"] = $escaletaClean
    
    # Serializar
    $flatJson = BuildJsonOutput $cleanData
    $formatted = Format-Json $flatJson
    
    if (-not $DryRun) {
        Set-Content -Path $FilePath -Value $formatted -Encoding UTF8 -NoNewline
        Write-Host "  Archivo actualizado: $FilePath" -ForegroundColor Green
    } else {
        $outPath = [System.IO.Path]::ChangeExtension($FilePath, ".clean.json")
        Set-Content -Path $outPath -Value $formatted -Encoding UTF8 -NoNewline
        Write-Host "  DryRun: Resultado en $outPath" -ForegroundColor Cyan
    }
    
} catch {
    Write-Host "  ERROR: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "  Detalle: $($_.Exception.StackTrace)" -ForegroundColor DarkRed
}
