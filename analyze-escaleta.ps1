param(
    [string]$FilePath = "docs/SAMPLES/DATA/TN_VESPRE_20260429_213007.json"
)

$json = Get-Content $FilePath -Raw -Encoding UTF8
$obj = $json | ConvertFrom-Json

Write-Host "=== CLEANFEED CLIPS ===" -ForegroundColor Cyan
foreach ($clip in $obj.cleanFeed.clips) {
    Write-Host "  $($clip.id): in=$($clip.in) out=$($clip.out) ready=$($clip.ready) tooClose=$($clip.tooCloseToRealTime)"
}

Write-Host "`n=== LINEAS CON HORAENTRADAONAIR (ordenadas por sequencia) ===" -ForegroundColor Cyan
$linesWithOnAir = $obj.escaleta.liniesEscaleta | Where-Object { $_.horaEntradaOnAir -ne $null -and $_.horaEntradaOnAir -ne "" } | Sort-Object sequencia
foreach ($line in $linesWithOnAir) {
    Write-Host "  seq=$($line.sequencia) num='$($line.num)' titol='$($line.titol)' font=$($line.font) tipus=$($line.tipus) teVideo=$($line.teVideo) agrupacio='$($line.agrupacio)' horaOnAir=$($line.horaEntradaOnAir) duradaOnAir=$($line.duradaOnAir)"
}

Write-Host "`n=== TOTAL LINEAS EN ESCALETA: $($obj.escaleta.liniesEscaleta.Count) ===" -ForegroundColor Yellow
Write-Host "=== LINEAS CON HORAENTRADAONAIR: $(($linesWithOnAir | Measure-Object).Count) ===" -ForegroundColor Yellow

Write-Host "`n=== TIPOS DE FONT ENCONTRADOS ===" -ForegroundColor Cyan
$fonts = $obj.escaleta.liniesEscaleta | Where-Object { $_.font -ne $null -and $_.font -ne "" } | Group-Object font | Select-Object Name, Count
foreach ($f in $fonts) {
    Write-Host "  $($f.Name): $($f.Count)"
}

Write-Host "`n=== TIPOS DE tipus ENCONTRADOS ===" -ForegroundColor Cyan
$tipus = $obj.escaleta.liniesEscaleta | Group-Object tipus | Select-Object Name, Count
foreach ($t in $tipus) {
    Write-Host "  $($t.Name): $($t.Count)"
}
