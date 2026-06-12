param(
    [string]$BaseDir = '\\public.ad-ccrtv.local\Public\VERTICALITZACIO_INFORMATIUS\ESCALETES'
)
$fmtScript = Join-Path $PSScriptRoot "fmt-json.ps1"
$programs = @("TN_COMARQUES", "TN_MIGDIA", "TN_VESPRE")
$DatePrefix = (Get-Date).ToString("yyyyMM")
Write-Host ("DatePrefix: " + $DatePrefix)

$allFiles = @()
foreach ($prog in $programs) {
    $pattern = $prog + "_*" + $DatePrefix + "*.json"
    $found = Get-ChildItem -LiteralPath $BaseDir -Filter $pattern -ErrorAction SilentlyContinue
    if ($found) { $allFiles += $found }
}

if ($allFiles.Count -eq 0) {
    Write-Host ("No files found with pattern *_" + $DatePrefix + "*.json in " + $BaseDir)
    exit 0
}

Write-Host ($allFiles.Count.ToString() + " files found. Processing...")
$formatted = 0
$skipped = 0
foreach ($f in ($allFiles | Sort-Object Name)) {
    $raw = Get-Content $f.FullName -Raw
    $isMin = $raw -match '^\{"[a-z]'
    Write-Host ($f.Name + ": minified=" + $isMin.ToString())
    if ($isMin) {
        Write-Host "  Formatting..."
        & $fmtScript -FilePath $f.FullName
        $formatted++
    } else {
        Write-Host "  Already formatted, skipping."
        $skipped++
    }
}
Write-Host ("Done. Formatted: " + $formatted + " | Skipped: " + $skipped + " | Total: " + $allFiles.Count)