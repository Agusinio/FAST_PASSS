$base = '\\public.ad-ccrtv.local\Public\VERTICALITZACIO_INFORMATIUS\ESCALETES'
$fmtScript = Join-Path $PWD 'bin\fmt-json.ps1'

$files = @(Get-ChildItem -LiteralPath $base -Filter '*_20260607*' -ErrorAction SilentlyContinue)
$files += @(Get-ChildItem -LiteralPath $base -Filter '*_20260608*' -ErrorAction SilentlyContinue)

Write-Host "Archivos de 2026-06-07 y 2026-06-08 a formatear: $($files.Count)"

foreach ($f in $files) {
    try {
        $raw = Get-Content $f.FullName -Raw
        $isMin = $raw -match '^\{"[a-z]'
        if ($isMin) {
            Write-Host "FORMATEANDO: $($f.Name)"
            & $fmtScript -FilePath $f.FullName
        } else {
            Write-Host "YA FORMATEADO: $($f.Name)"
        }
    } catch {
        Write-Host "ERROR: $($f.Name) - $_"
    }
}
Write-Host "Completado."