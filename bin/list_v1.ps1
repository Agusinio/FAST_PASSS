param(
    [string]$Program = "TN_MIGDIA",
    [string]$Date = "20260628"
)

$jsonDir = "\\public.ad-ccrtv.local\Public\VERTICALITZACIO_INFORMATIUS\ESCALETES"
$pattern = "${Date}_*_${Program}_*.json"

Get-ChildItem -LiteralPath $jsonDir -Filter $pattern | Sort-Object Name | ForEach-Object {
    Write-Host ""
    Write-Host "=== $($_.Name) ==="
    $txt = [System.IO.File]::ReadAllText($_.FullName)
    $inItem = $false
    $currentNum = ""
    $currentTitol = ""
    $lines = $txt -split "`r`n"
    foreach ($line in $lines) {
        if ($line -match '"agrupacio":\s*"v1"') {
            $inItem = $true
            $currentNum = ""
            $currentTitol = ""
        }
        if ($inItem -and $line -match '"num":\s*"([^"]+)"') {
            $currentNum = $matches[1]
        }
        if ($inItem -and $line -match '"titol":\s*"([^"]+)"') {
            $currentTitol = $matches[1]
        }
        if ($inItem -and $line -match '^\s*\},') {
            if ($currentNum) {
                Write-Host "  $currentNum : $currentTitol"
            }
            $inItem = $false
        }
    }
}