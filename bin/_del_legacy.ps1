$file = 'js/workflows/flow_assembly.js'
$lines = Get-Content $file -Encoding UTF8
Write-Host "Total lines before: $($lines.Count)"

# Keep lines 0..1207 (0-indexed) = lines 1..1208 (1-indexed)
# Delete lines 1208..3915 (0-indexed) = lines 1209..3915 (1-indexed)
# Keep lines 3916..end (0-indexed)
$before = $lines[0..1207]
$after = $lines[3915..($lines.Count - 1)]
$newContent = $before + $after
$newContent | Set-Content $file -Encoding UTF8
Write-Host "Total lines after: $($newContent.Count)"
Write-Host "Done!"
