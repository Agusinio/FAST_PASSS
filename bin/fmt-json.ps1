param(
    [string]$FilePath
)

function Format-Json4 {
    param([string]$json)
    $sb = New-Object System.Text.StringBuilder
    $indent = 0
    $inString = $false
    $escaped = $false
    for ($i = 0; $i -lt $json.Length; $i++) {
        $c = $json[$i]
        if ($escaped) { [void]$sb.Append($c); $escaped = $false; continue }
        if ($c -eq '\') { [void]$sb.Append($c); $escaped = $true; continue }
        if ($c -eq '"') { $inString = -not $inString; [void]$sb.Append($c); continue }
        if ($inString) { [void]$sb.Append($c); continue }
        if ($c -eq '{' -or $c -eq '[') {
            [void]$sb.Append($c)
            $indent++
            [void]$sb.Append("`n")
            [void]$sb.Append(' ' * (4 * $indent))
        }
        elseif ($c -eq '}' -or $c -eq ']') {
            $indent--
            [void]$sb.Append("`n")
            [void]$sb.Append(' ' * (4 * $indent))
            [void]$sb.Append($c)
        }
        elseif ($c -eq ',') {
            [void]$sb.Append($c)
            [void]$sb.Append("`n")
            [void]$sb.Append(' ' * (4 * $indent))
        }
        elseif ($c -eq ':') {
            [void]$sb.Append(': ')
        }
        elseif ($c -eq ' ' -or $c -eq "`n" -or $c -eq "`r" -or $c -eq "`t") {
            continue
        }
        else {
            [void]$sb.Append($c)
        }
    }
    return $sb.ToString()
}

Write-Host "Procesando: $FilePath"
$raw = Get-Content -Path $FilePath -Raw -Encoding UTF8

# Remove BOM if present
if ($raw[0] -eq [char]0xFEFF) { $raw = $raw.Substring(1) }

$obj = $raw | ConvertFrom-Json
$compact = ConvertTo-Json -InputObject $obj -Depth 100 -Compress
$pretty = Format-Json4 -json $compact
[System.IO.File]::WriteAllText($FilePath, $pretty, [System.Text.UTF8Encoding]::new($false))
Write-Host "OK: $FilePath"
