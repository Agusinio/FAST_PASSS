param(
    [string]$BaseDir,
    [string]$DatePrefix  # Opcional: YYYYMM (ej: 202606). Si no se pasa, usa el mes/año actual.
)
$fmtScript = Join-Path $PSScriptRoot "fmt-json.ps1"
$programs = @("TN_COMARQUES", "TN_MIGDIA", "TN_VESPRE")

# Auto-detectar prefijo de fecha si no se especifica
if (-not $DatePrefix) {
    $DatePrefix = (Get-Date).ToString("yyyyMM")
    Write-Host "📅 Prefijo de fecha auto-detectado: $DatePrefix"
}

$allFiles = @()
foreach ($prog in $programs) {
    $pattern = "${prog}_${DatePrefix}*.json"
    $found = Get-ChildItem -LiteralPath $BaseDir -Filter $pattern -ErrorAction SilentlyContinue
    if ($found) { $allFiles += $found }
}

if ($allFiles.Count -eq 0) {
    Write-Host "⚠️ No se encontraron archivos con patron ${programs[0]}_${DatePrefix}*.json en $BaseDir"
    exit 0
}

Write-Host "📂 $( $allFiles.Count ) archivos encontrados. Procesando..."
$formatted = 0
$skipped = 0
foreach ($f in ($allFiles | Sort-Object Name)) {
    $raw = Get-Content $f.FullName -Raw
    # Minified if it starts with {"key": (no spaces after colon)
    $isMin = $raw -match '^\{"[a-z]'
    Write-Host ("{0}: minified={1}" -f $f.Name, $isMin)
    if ($isMin) {
        Write-Host "  Formatting..."
        & $fmtScript -FilePath $f.FullName
        $formatted++
    } else {
        Write-Host "  Already formatted, skipping."
        $skipped++
    }
}
Write-Host "Done. Formateados: $formatted | Omitidos: $skipped | Total: $( $allFiles.Count )"
