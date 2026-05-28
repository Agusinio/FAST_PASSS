param([string]$BaseDir)
$fmtScript = Join-Path $PSScriptRoot "fmt-json.ps1"
$programs = @("TN_COMARQUES", "TN_MIGDIA", "TN_VESPRE")
$allFiles = @()
foreach ($prog in $programs) {
    $pattern = "${prog}_202605*.json"
    $found = Get-ChildItem -LiteralPath $BaseDir -Filter $pattern -ErrorAction SilentlyContinue
    if ($found) { $allFiles += $found }
}
foreach ($f in ($allFiles | Sort-Object Name)) {
    $raw = Get-Content $f.FullName -Raw
    # Minified if it starts with {"key": (no spaces after colon)
    $isMin = $raw -match '^\{"[a-z]'
    Write-Host ("{0}: minified={1}" -f $f.Name, $isMin)
    if ($isMin) {
        Write-Host "  Formatting..."
        & $fmtScript -FilePath $f.FullName
    }
}
Write-Host "Done."
