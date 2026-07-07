$O_ACCENT = [char]0xD3
$BASE = "\\DSMEDIA07\portal324\PROJECTE 9x16 PREMIERE 2\AAA_PROJECTES PREMIERE VERTICALITZACI" + $O_ACCENT + "\PROVES\03_TN MIGDIA_PROJECTES"

$logs = Get-ChildItem -Path $BASE -Recurse -Filter "*.log" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1

foreach ($log in $logs) {
    Write-Host "=== $($log.Name) ==="
    Write-Host "Modified: $($log.LastWriteTime)"
    Write-Host "--- LAST 60 LINES ---"
    Get-Content $log.FullName -Tail 60
}