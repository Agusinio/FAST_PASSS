param(
    [Parameter(Mandatory=$false, Position=0, ValueFromRemainingArguments=$true)]
    [string[]]$Paths,
    [Parameter(Mandatory=$false)]
    [string]$Pattern = "*.json",
    [Parameter(Mandatory=$false)]
    [string]$Directory = "docs/SAMPLES/DATA"
)

Add-Type -AssemblyName System.Web.Extensions

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

# Determine which files to process
$files = @()

if ($Paths.Count -gt 0) {
    # Use paths passed as arguments
    foreach ($path in $Paths) {
        if (Test-Path $path -PathType Container) {
            # It's a directory, get JSON files from it
            $files += Get-ChildItem -Path $path -Filter $Pattern
        } elseif (Test-Path $path -PathType Leaf) {
            # It's a file
            $files += Get-Item $path
        } else {
            Write-Host "WARNING: Path not found: $path"
        }
    }
} else {
    # Default: process all JSON files in the default directory
    if (Test-Path $Directory) {
        $files = Get-ChildItem -Path $Directory -Filter $Pattern
    } else {
        Write-Host "ERROR: Default directory '$Directory' not found."
        Write-Host "Usage: .\format-json.ps1 <file1.json> [file2.json ...]"
        exit 1
    }
}

if ($files.Count -eq 0) {
    Write-Host "No JSON files found to process."
    exit 0
}

foreach ($file in $files) {
    try {
        Write-Host "Processing: $($file.FullName)" -NoNewline
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
