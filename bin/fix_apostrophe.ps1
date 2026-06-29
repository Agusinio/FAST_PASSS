$filePath = Join-Path $PSScriptRoot "..\js\workflows\flow_assembly.js"
$content = [System.IO.File]::ReadAllText($filePath)

# Replace: .replace(/'/g, "\'")  →  .replace(/'/g, "")
# Build the search string using character codes to avoid escaping hell
$sq = [char]39  # single quote '
$bs = [char]92  # backslash \
$dq = [char]34  # double quote "

$old = ".replace(/" + $sq + "/g, " + $dq + $bs + $sq + $dq + ")"
$new = ".replace(/" + $sq + "/g, " + $dq + $dq + ")"

$count = 0
$idx = 0
while (($idx = $content.IndexOf($old, $idx)) -ge 0) {
    $count++
    $idx++
}

$content = $content.Replace($old, $new)
[System.IO.File]::WriteAllText($filePath, $content, [System.Text.Encoding]::UTF8)
Write-Host "Replaced $count occurrences"