$filePath = "js\workflows\flow_assembly.js"
$txt = [System.IO.File]::ReadAllText($filePath, [System.Text.Encoding]::UTF8)

# ── F1 OnAir → Verde(4). Contexto: log('🔵 [F1·OnAir]'...
$txt = $txt -replace "(log\('🔵 \[F1·OnAir\] ' \+ num \+ ': OnAir=.*?\n\s*var colorIdx = )6", '${1}4'

# ── F2 Deducido → Azul(6). Contexto: log('🟠 [F2·Deducido]'...
$txt = $txt -replace "(log\('🟠 \[F2·Deducido\] ' \+ num \+ ': OnAirDeducido=.*?\n\s*var colorIdx = )6", '${1}6'

# ── F3 Prevista → Amarillo(5). Contexto: log('🟡 [F3·Prevista]'...
$txt = $txt -replace "(log\('🟡 \[F3·Prevista\] ' \+ num \+ ': Prevista=.*?\n\s*var colorIdx = )6", '${1}5'

# ── D10·F2 firstColorIdx → Azul(6)
$txt = $txt -replace "var firstColorIdx = 5;  // Cyan \(F2·Deducido\) \(D10\)", "var firstColorIdx = 6;  // Blau (D10·F2)"

[System.IO.File]::WriteAllText($filePath, $txt, [System.Text.Encoding]::UTF8)
Write-Host "Done. Colors: F1=4(Verd), F2=6(Blau), F3=5(Groc), D10=6(Blau)"