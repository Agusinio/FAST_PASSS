Add-Type -AssemblyName System.Web.Extensions

$files = Get-ChildItem -Path "docs/SAMPLES/DATA" -Filter "*.json"
$serializer = New-Object System.Web.Script.Serialization.JavaScriptSerializer
$serializer.MaxJsonLength = [Int32]::MaxValue

function Format-Json([string]$json) {
    $indent = 0
    $sb = New-Object System.Text.StringBuilder
    $inString = $false
    $escape = $false
    
    for ($i = 0; $i -lt $json.Length; $i++) {
        $c = $json[$i]
        
        if ($escape) {
            [void]$sb.Append($c)
            $escape = $false
            continue
        }
        
        if ($c -eq '\' -and $inString) {
            $escape = $true
            [void]$sb.Append($c)
            continue
        }
        
        if ($c -eq '"') {
            $inString = !$inString
            [void]$sb.Append($c)
            continue
        }
        
        if ($inString) {
            [void]$sb.Append($c)
            continue
        }
        
        if ($c -eq '{' -or $c -eq '[') {
            $indent++
            [void]$sb.Append($c)
            [void]$sb.Append("`r`n")
            [void]$sb.Append(("  " * $indent))
            continue
        }
        
        if ($c -eq '}' -or $c -eq ']') {
            $indent--
            [void]$sb.Append("`r`n")
            [void]$sb.Append(("  " * $indent))
            [void]$sb.Append($c)
            continue
        }
        
        if ($c -eq ',') {
            [void]$sb.Append(',')
            [void]$sb.Append("`r`n")
            [void]$sb.Append(("  " * $indent))
            continue
        }
        
        if ($c -eq ':') {
            [void]$sb.Append(': ')
            continue
        }
        
        # Skip whitespace in non-string context
        if ($c -eq ' ' -or $c -eq "`t" -or $c -eq "`r" -or $c -eq "`n") {
            continue
        }
        
        [void]$sb.Append($c)
    }
    
    return $sb.ToString().TrimStart([char]0xFEFF)
}

foreach ($file in $files) {
    try {
        Write-Host "Processing: $($file.Name)" -NoNewline
        $raw = Get-Content $file.FullName -Raw -Encoding UTF8
        $obj = $serializer.DeserializeObject($raw)
        $flat = $serializer.Serialize($obj)
        $formatted = Format-Json $flat
        Set-Content -Path $file.FullName -Value $formatted -Encoding UTF8 -NoNewline
        Write-Host " - OK"
    } catch {
        Write-Host " - ERROR: $($_.Exception.Message)"
    }
}

Write-Host "`nDone!"
