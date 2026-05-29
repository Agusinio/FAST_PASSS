param(
    [Parameter(Mandatory=$true, Position=0, ValueFromRemainingArguments=$true)]
    [string[]]$Paths
)

Add-Type -AssemblyName System.Web.Extensions

$serializer = New-Object System.Web.Script.Serialization.JavaScriptSerializer
$serializer.MaxJsonLength = [Int32]::MaxValue

# ─── Funció per determinar si una data és cap de setmana ────────────────────
function Test-IsCapDeSetmana([string]$dataISO) {
    # data ve en format "2026-05-02T00:00:00+02:00"
    try {
        $dt = [DateTime]::Parse($dataISO)
        # 0 = diumenge, 6 = dissabte
        return ($dt.DayOfWeek -eq [DayOfWeek]::Saturday) -or ($dt.DayOfWeek -eq [DayOfWeek]::Sunday)
    } catch {
        return $false
    }
}

# ─── Configuració de durades per programa ───────────────────────────────────
# Cada entrada:
#   'clau'       = patró per identificar el programa a 'ruta' del JSON
#   'nom'        = nom descriptiu
#   'durades'    = hash table: titol_linia => nova_durada
#   'duradesCapDeSetmana' = (opcional) hash table per cap de setmana
$programes = @(
    @{
        clau = 'TN COMARQUES'
        nom  = 'TN Comarques'
        durades = @{
            'CARETA TNC 3CatInfo'       = '0:10'
            'TORNADA DE PUBLI 3CATINFO'  = '0:10'
            'MOLINET 01 TNC 3CATINFO'    = '0:10'
        }
    },
    @{
        clau = 'TNV'
        nom  = 'TN Vespre'
        durades = @{
            'CARETA TNV'        = '0:10'
            'MOLINET 1'         = '0:04'
            'MOLINET 2'         = '0:04'
            'CARETA ESPORTS'    = '0:06'
        }
        duradesCapDeSetmana = @{
            'CARETA TNV'            = '0:13'
            'MOLINET 1'             = '0:06'
            'MOLINET TORNADA PUBLI' = '0:05'
            'CARETA ESPORTS'        = '0:07'
        }
    },
    @{
        clau = 'TNM'
        nom  = 'TN Migdia'
        durades = @{
            'CARETA TNMigdia INICI'     = '0:10'
            'MOLINET 1'                 = '0:05'
            'MOLINET 2'                 = '0:05'
            'EF-CUC per anar a Marta'   = '0:02'
            'CARETA ESPORTS'            = '0:07'
        }
        duradesCapDeSetmana = @{
            'CARETA'                        = '0:13'
            'MOLINET 1'                     = '0:05'
            'CARETA ESPORTS'                = '0:07'
            'EFECTE CUC X ANAR A JORDI'     = '0:02'
        }
    }
)

# ─── Funció de formateig JSON ───────────────────────────────────────────────
function Format-Json([string]$json) {
    $indent = 0
    $sb = New-Object System.Text.StringBuilder
    $inString = $false
    $escape = $false

    for ($i = 0; $i -lt $json.Length; $i++) {
        $c = $json[$i]
        if ($escape) { [void]$sb.Append($c); $escape = $false; continue }
        if ($c -eq '\' -and $inString) { $escape = $true; [void]$sb.Append($c); continue }
        if ($c -eq '"') { $inString = !$inString; [void]$sb.Append($c); continue }
        if ($inString) { [void]$sb.Append($c); continue }
        if ($c -eq '{' -or $c -eq '[') { $indent++; [void]$sb.Append($c); [void]$sb.Append("`r`n"); [void]$sb.Append(("  " * $indent)); continue }
        if ($c -eq '}' -or $c -eq ']') { $indent--; [void]$sb.Append("`r`n"); [void]$sb.Append(("  " * $indent)); [void]$sb.Append($c); continue }
        if ($c -eq ',') { [void]$sb.Append(','); [void]$sb.Append("`r`n"); [void]$sb.Append(("  " * $indent)); continue }
        if ($c -eq ':') { [void]$sb.Append(': '); continue }
        if ($c -eq ' ' -or $c -eq "`t" -or $c -eq "`r" -or $c -eq "`n") { continue }
        [void]$sb.Append($c)
    }
    return $sb.ToString().TrimStart([char]0xFEFF)
}

# ─── Funció per detectar el programa ────────────────────────────────────────
function Get-ProgramaConfig([string]$ruta) {
    foreach ($prog in $programes) {
        if ($ruta -match $prog.clau) {
            return $prog
        }
    }
    return $null
}

# ─── Processar fitxers ──────────────────────────────────────────────────────
$files = @()
foreach ($path in $Paths) {
    if (Test-Path $path -PathType Container) {
        $files += Get-ChildItem -Path $path -Filter '*.json'
    } elseif (Test-Path $path -PathType Leaf) {
        $files += Get-Item $path
    } else {
        Write-Host "WARNING: Path not found: $path"
    }
}

if ($files.Count -eq 0) {
    Write-Host "No JSON files found."
    exit 0
}

foreach ($file in $files) {
    try {
        Write-Host "Processing: $($file.Name)" -NoNewline

        $raw = Get-Content $file.FullName -Raw -Encoding UTF8
        $obj = $serializer.DeserializeObject($raw)

        # Detectar programa
        $rutaPrograma = $obj['escaleta']['ruta']
        $config = Get-ProgramaConfig $rutaPrograma

        if (-not $config) {
            Write-Host " - SKIP (no config for this program)"
            continue
        }

        # Detectar si és cap de setmana
        $dataISO = $obj['escaleta']['data']
        $esCapDeSetmana = Test-IsCapDeSetmana $dataISO

        # Seleccionar taula de durades
        if ($esCapDeSetmana -and $config.ContainsKey('duradesCapDeSetmana')) {
            $durades = $config['duradesCapDeSetmana']
            $tipus = "CAP DE SETMANA"
        } else {
            $durades = $config['durades']
            $tipus = "DIARI"
        }

        Write-Host " [$($config.nom) - $tipus]" -NoNewline

        $linies = $obj['escaleta']['liniesEscaleta']
        $changes = 0

        foreach ($l in $linies) {
            $titolLinia = $l['titol']
            if ($durades.ContainsKey($titolLinia)) {
                $novaDurada = $durades[$titolLinia]
                if ($l['durada'] -ne $novaDurada) {
                    $l['durada'] = $novaDurada
                    $changes++
                    Write-Host "`n  -> $titolLinia : $novaDurada" -NoNewline
                }
            }
        }

        if ($changes -eq 0) {
            Write-Host " - no changes needed"
            continue
        }

        # Serialitzar i formatejar
        $flat = $serializer.Serialize($obj)
        $formatted = Format-Json $flat
        Set-Content -Path $file.FullName -Value $formatted -Encoding UTF8 -NoNewline

        Write-Host " - $changes change(s) applied"
    } catch {
        Write-Host " - ERROR: $($_.Exception.Message)"
    }
}

Write-Host "`nDone!"
