param(
    [string]$DateStr  # YYYYMMDD, e.g. 20260611. Default: yesterday
)
if (-not $DateStr) {
    $DateStr = (Get-Date).AddDays(-1).ToString("yyyyMMdd")
}
$base = '\\public.ad-ccrtv.local\Public\VERTICALITZACIO_INFORMATIUS\ESCALETES'
$pattern = $DateStr + "_*_TN_*.json"
$files = @(Get-ChildItem -LiteralPath $base -Filter $pattern -ErrorAction SilentlyContinue | Where-Object { $_.Name -match '^[0-9]{8}_[0-9]{6}_TN_(COMARQUES|MIGDIA|VESPRE)_' } | ForEach-Object { $_.FullName })
if ($files.Count -gt 0) {
    Write-Host ("Encontrados " + $files.Count + " archivos del " + $DateStr + ":")
    foreach ($f in $files) { Write-Host $f }
    $codeCmd = "E:\AAA_VSCode_4_WIN\bin\code.cmd"
    & cmd.exe /c "$codeCmd $files"
} else {
    Write-Host ("No files found for " + $DateStr)
}