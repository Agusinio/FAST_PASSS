param(
    [string]$Path = ".\js\workflows\flow_assembly.js"
)
$txt = [System.IO.File]::ReadAllText((Resolve-Path $Path))
$old = 'var firstColorIdx = 5;'
$new = 'var firstColorIdx = 6;'
if ($txt.Contains($old)) {
    $txt = $txt.Replace($old, $new)
    [System.IO.File]::WriteAllText((Resolve-Path $Path), $txt)
    Write-Host "Replaced: 5 → 6"
} else {
    Write-Host "Not found"
}