$basePath = '\\public.ad-ccrtv.local\Public\VERTICALITZACIO_INFORMATIUS\ESCALETES'
$suffixes = @{}

$files = Get-ChildItem -Path $basePath -Filter 'TN_*.json' | Sort-Object Name

foreach ($file in $files) {
    $prog = if ($file.Name -match 'TN_VESPRE') { 'TNV' }
            elseif ($file.Name -match 'TN_MIGDIA') { 'TNM' }
            else { 'TNC' }
    Write-Host "Procesando: $($file.Name) ($prog)"
    try {
        $json = Get-Content $file.FullName -Raw | ConvertFrom-Json
        $lines = $json.escaleta.liniesEscaleta
        foreach ($line in $lines) {
            $n = $line.num
            $d = $line.durada
            if ($n -and $n -ne '') {
                if ($n -match '^(\d+)(.*)$') {
                    $prefix = $Matches[1]
                    $suffix = if ($Matches[2]) { $Matches[2].ToLower() } else { '(sin_sufijo)' }
                } else {
                    $prefix = ''
                    $suffix = $n.ToLower()
                }
                $key = "$prog|$suffix"
                if (-not $suffixes.ContainsKey($key)) {
                    $suffixes[$key] = @{
                        prog = $prog
                        sufijo = $suffix
                        duradas = @{}
                        archivos = @()
                        ejemplos = @()
                    }
                }
                $suffixes[$key].duradas[$d] = $true
                if ($suffixes[$key].archivos -notcontains $file.Name) {
                    $suffixes[$key].archivos += $file.Name
                }
                if ($suffixes[$key].ejemplos.Count -lt 5) {
                    $suffixes[$key].ejemplos += "$($line.num) -> durada=$d"
                }
            }
        }
    } catch {
        Write-Host "  ERROR: $_"
    }
}

Write-Host ""
Write-Host "========== CATÁLOGO DE SUFIJOS =========="
Write-Host ""

$suffixes.Values | Sort-Object prog, sufijo | ForEach-Object {
    $duradasList = ($_.duradas.Keys | Sort-Object) -join ', '
    $archivosList = ($_.archivos | Sort-Object) -join ', '
    $ejemplosList = ($_.ejemplos -join ' | ')
    Write-Host "$($_.prog)`t$($_.sufijo)`tDURADAS=[$duradasList]`tARCHIVOS=$($_.archivos.Count)`tEJ: $ejemplosList"
}

Write-Host ""
Write-Host "========== RESUMEN POR SUFIJO (consolidado) =========="

$consolidated = @{}
foreach ($s in $suffixes.Values) {
    $suf = $s.sufijo
    if (-not $consolidated.ContainsKey($suf)) {
        $consolidated[$suf] = @{
            sufijo = $suf
            programas = @{}
            todasDuradas = @{}
            totalArchivos = 0
        }
    }
    $consolidated[$suf].programas[$s.prog] = $true
    foreach ($dk in $s.duradas.Keys) {
        $consolidated[$suf].todasDuradas[$dk] = $true
    }
    $consolidated[$suf].totalArchivos += $s.archivos.Count
}

$consolidated.Values | Sort-Object sufijo | ForEach-Object {
    $progs = ($_.programas.Keys | Sort-Object) -join ','
    $duradas = ($_.todasDuradas.Keys | Sort-Object) -join ','
    $todasCero = ($_.todasDuradas.Count -eq 1 -and $_.todasDuradas.ContainsKey('0:00'))
    $esGrafico = if ($todasCero) { 'GRAFICO' } else { 'ESTRUCTURAL/MIXTO' }
    Write-Host "SUFIJO: $($_.sufijo) | PROGS: [$progs] | DURADAS: [$duradas] | CLASIF: $esGrafico | ARCHIVOS: $($_.totalArchivos)"
}
