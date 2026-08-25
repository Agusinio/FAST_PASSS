$baseDir = "\\DSMEDIA07\portal324\PROJECTE 9x16 PREMIERE 2\AAA_PROJECTES PREMIERE VERTICALITZACIO\PROVES"
$logs = Get-ChildItem -Path $baseDir -Recurse -Filter "*.log" | Sort-Object LastWriteTime -Descending | Select-Object -First 3
foreach ($log in $logs) {
    Write-Host "=== $($log.FullName) ==="
    Write-Host "Size: $($log.Length) bytes | Modified: $($log.LastWriteTime)"
    Write-Host "---"
    Get-Content $log.FullName -Tail 15
    Write-Host ""
}