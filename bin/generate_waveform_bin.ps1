param(
    [string]$ffmpegExe,
    [string]$inputFile,
    [string]$outputBin,
    [int]$downsample = 8,
    [int]$sampleRate = 8000
)

# ============================================================================
# Genera un fitxer .bin compacte amb la forma d'ona de referència.
#
# Format de sortida (per cada byte):
#   Byte = [ V1(4bits) | V2(4bits) ]
#   on Vi = |sample_i| >> 4  => valor 0..15 (absoluta, sense bit de signe,
#          obviant els 4 bits menys significatius)
#
# Submostreig: es pren 1 mostra de cada $downsample.
# ============================================================================

try {
    # 1. Extreure PCM f32le via ffmpeg a fitxer temporal
    $tmpRaw = [System.IO.Path]::GetTempFileName() + ".raw"
    $args = @(
        "-i", $inputFile,
        "-ac", "1",
        "-ar", $sampleRate.ToString(),
        "-f", "f32le",
        "-y", $tmpRaw
    )
    
    # Executar ffmpeg i ignorar tota la sortida (baixa a stderr)
    $ffOut = & $ffmpegExe $args 2>&1
    $LASTEXITCODE = 0
    
    if (-not (Test-Path $tmpRaw)) {
        Write-Host "ERR_NO_RAW"
        exit 1
    }
    
    # 2. Llegir el PCM com floats (f32le, 4 bytes per mostra)
    $bytes = [System.IO.File]::ReadAllBytes($tmpRaw)
    $numSamples = [math]::Floor($bytes.Length / 4)
    Write-Host ("PCM samples: " + $numSamples + " (downsample " + $downsample + ")")
    
    # 2b. Calcular el val màxim absolut (per normalitzar)
    $maxAbs = 0.0
    $sampleBytes = 0
    for ($si = 0; $si -lt $numSamples; $si += 1) {
        $soff = $si * 4
        if ($soff + 4 -gt $bytes.Length) { break }
        $sv = [System.BitConverter]::ToSingle($bytes, $soff)
        $av = [math]::Abs($sv)
        if ($av -gt $maxAbs) { $maxAbs = $av }
        $sampleBytes = $si
    }
    if ($maxAbs -lt 0.0001) { $maxAbs = 0.0001 }  # Evitar divisió per zero
    Write-Host ("Max abs sample: " + $maxAbs.ToString("F6"))
    
    # 3. Processar: normalitzar per maxAbs, valor abs, * 15, empaquetar 2 per byte
    $outBytes = New-Object System.Collections.Generic.List[byte]
    $pending = -1
    
    for ($i = 0; $i -lt $numSamples; $i += $downsample) {
        $off = $i * 4
        if ($off + 4 -gt $bytes.Length) { break }
        
        $sample = [System.BitConverter]::ToSingle($bytes, $off)
        # Normalitzar: |sample| / maxAbs → 0..1
        $absVal = [math]::Abs($sample) / $maxAbs
        if ($absVal -gt 1) { $absVal = 1 }
        
        # Escalar a 0..15 (4 bits)
        $nibble = [int]($absVal * 15)
        if ($nibble -gt 15) { $nibble = 15 }
        if ($nibble -lt 0) { $nibble = 0 }
        
        if ($pending -lt 0) {
            # Guardar primer valor (nibble alt)
            $pending = ($nibble -shl 4)
        } else {
            # Segon valor (nibble baix), afegir byte
            $outBytes.Add([byte]($pending -bor $nibble))
            $pending = -1
        }
    }
    
    # Si queda un pendent, afegir amb 0 al nibble baix
    if ($pending -ge 0) {
        $outBytes.Add([byte]$pending)
    }
    
    # 4. Escriure .bin
    [System.IO.File]::WriteAllBytes($outputBin, $outBytes.ToArray())
    
    Write-Host ("OK " + $outBytes.Count + " bytes -> " + $outputBin)
    
    # Netejar temp
    if (Test-Path $tmpRaw) { Remove-Item $tmpRaw }
    
} catch {
    Write-Host "ERR_EXCEPTION: $($_.Exception.Message)"
    exit 1
}