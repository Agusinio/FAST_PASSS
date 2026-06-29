$logPath = "\\DSMEDIA07\portal324\PROJECTE 9x16 PREMIERE 2\AAA_PROJECTES PREMIERE VERTICALITZACIÓ\PROVES\03_TN MIGDIA_PROJECTES\2026_06_25\Pruebas_TNM_V1_DIR LIN CARACAS.prproj.log"
if (Test-Path $logPath) {
    Get-Content $logPath
} else {
    Write-Host "FILE NOT FOUND: $logPath"
}