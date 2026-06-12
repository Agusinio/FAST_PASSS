$filePath = "js\workflows\flow_assembly.js"
$content = [System.IO.File]::ReadAllText($filePath, [System.Text.Encoding]::UTF8)

# Search pattern: the exact line with colorIdx = 6
$pattern = "var colorIdx = 6;  // Blau fix per OnAir (D10)"

# Split by pattern
$parts = $content -split ([regex]::Escape($pattern))

if ($parts.Count -lt 4) {
    Write-Host "ERROR: Expected 3 occurrences, found $($parts.Count - 1)"
    exit 1
}

# Rebuild: occurrence 1 = F1 => Verde(4), 2 = F2 => Azul(6), 3 = F3 => Amarillo(5)
$result = $parts[0]
$result += "var colorIdx = 4;  // Verd (OnAir F1)"
$result += $parts[1]
$result += "var colorIdx = 6;  // Blau (Deducido F2)"
$result += $parts[2]
$result += "var colorIdx = 5;  // Groc (Prevista F3)"
$result += $parts[3]

[System.IO.File]::WriteAllText($filePath, $result, [System.Text.Encoding]::UTF8)
Write-Host "OK: F1=4(Verd), F2=6(Blau), F3=5(Groc)"