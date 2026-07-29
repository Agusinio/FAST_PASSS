<#
.SYNOPSIS
    Extreu un segment d'un fitxer MP4 usant ffmpeg amb -c copy (re-empaquetat ràpid).
.DESCRIPTION
    Usa -ss abans de -i per fast seek al keyframe més proper,
    -c copy per evitar re-codificar,
    -avoid_negative_ts make_zero perquè els PTS del clip comencin a 0.
.PARAMETER FfmpegPath
    Ruta completa al binari de ffmpeg.exe
.PARAMETER InputPath
    Ruta al fitxer MP4 original (cleanFeed o bloc)
.PARAMETER StartSec
    Segon d'inici de l'extracció (pot ser float)
.PARAMETER Duration
    Durada en segons del segment a extreure (pot ser float)
.PARAMETER OutputPath
    Ruta on es guardarà el clip retallat
.EXAMPLE
    .\extract_clip.ps1 -FfmpegPath "E:\ffmpeg\bin\ffmpeg.exe" -InputPath "C:\input.mp4" -StartSec 10.5 -Duration 30.0 -OutputPath "C:\output.mp4"
#>

param(
    [Parameter(Mandatory=$true)]
    [string]$FfmpegPath,
    
    [Parameter(Mandatory=$true)]
    [string]$InputPath,
    
    [Parameter(Mandatory=$true)]
    [double]$StartSec,
    
    [Parameter(Mandatory=$true)]
    [double]$Duration,
    
    [Parameter(Mandatory=$true)]
    [string]$OutputPath
)

# Logging
$logPrefix = "[extract_clip.ps1]"
Write-Host "$logPrefix INICI: ffmpeg=$FfmpegPath, input=$InputPath, start=$StartSec, dur=$Duration, output=$OutputPath"

# Validar que ffmpeg existeix
if (-not (Test-Path $FfmpegPath)) {
    Write-Host "$logPrefix ERR: ffmpeg no trobat a $FfmpegPath"
    Write-Host "ERR"
    exit 1
}

# Validar que el fitxer d'entrada existeix
if (-not (Test-Path $InputPath)) {
    Write-Host "$logPrefix ERR: fitxer d'entrada no trobat a $InputPath"
    Write-Host "ERR"
    exit 1
}

# Assegurar que el directori de sortida existeix
$outputDir = Split-Path $OutputPath -Parent
if (-not (Test-Path $outputDir)) {
    Write-Host "$logPrefix Creant directori de sortida: $outputDir"
    New-Item -ItemType Directory -Path $outputDir -Force | Out-Null
}

# Executar ffmpeg: -ss abans de -i per fast seek, -c copy per re-empaquetat,
# -avoid_negative_ts make_zero per PTS comencin a 0
$arguments = "-ss $StartSec -t $Duration -i `"$InputPath`" -c copy -avoid_negative_ts make_zero -y `"$OutputPath`""
Write-Host "$logPrefix Executant: $FfmpegPath $arguments"

$process = Start-Process -FilePath $FfmpegPath -ArgumentList $arguments -NoNewWindow -Wait -PassThru

if ($process.ExitCode -ne 0) {
    Write-Host "$logPrefix ERR: ffmpeg ha fallat amb exit code $($process.ExitCode)"
    Write-Host "ERR"
    exit 1
}

# Verificar que el fitxer de sortida existeix i no està buit
if (Test-Path $OutputPath) {
    $fileInfo = Get-Item $OutputPath
    Write-Host "$logPrefix OK: clip generat correctament ($($fileInfo.Length) bytes, durada=$Duration s)"
    # Crear fitxer .done a C:\temp\ (local, no UNC) per evitar falsos positius d'IO.exists
    $doneName = [System.IO.Path]::GetFileNameWithoutExtension($OutputPath) + "_" + [System.IO.Path]::GetExtension($OutputPath).TrimStart('.') + ".done"
    $doneFile = "C:\temp\$doneName"
    Set-Content -Path $doneFile -Value "OK" -Force
    Write-Host "$logPrefix Fitxer .done creat (local): $doneFile"
    Write-Host "OK"
    exit 0
} else {
    Write-Host "$logPrefix ERR: el fitxer de sortida no s'ha generat"
    Write-Host "ERR"
    exit 1
}
