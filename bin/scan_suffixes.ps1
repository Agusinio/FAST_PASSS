param(
    [string]$FilePath,
    [string]$Agrupacio = 'v4'
)
$json = Get-Content $FilePath -Raw -Encoding UTF8 | ConvertFrom-Json
$lines = $json.escaleta.liniesEscaleta
$items = $lines | Where-Object { $_.agrupacio -eq $Agrupacio -and $_.flotant -ne $true }
Write-Host ("Items in agrupacio '" + $Agrupacio + "': " + $items.Count)
foreach ($item in $items) {
    $t = if ($item.titol.Length -gt 70) { $item.titol.Substring(0,70) } else { $item.titol }
    Write-Host ("Seq=" + $item.sequencia + " Num=" + $item.num + " Titol=" + $t + " Dur=" + $item.durada + " OnAir=" + $item.horaEntradaOnAir + " Vid=" + $item.teVideo + " InPrev=" + $item.horaEntradaPrevista + " OutPrev=" + $item.horaSortidaPrevista)
}