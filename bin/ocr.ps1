# ============================================================================
# ocr.ps1 - OCR de una imagen (PNG) con el motor de Windows (Windows.Media.Ocr)
# ----------------------------------------------------------------------------
# Uso normal:
#   powershell -NoProfile -ExecutionPolicy Bypass -File "bin\ocr.ps1" ^
#       -In "C:\temp\fp\roi.png" -Out "C:\temp\fp\roi.txt" -Lang "es-ES"
#
# Varios idiomas en UNA SOLA ejecucion (recomendado: evita un arranque de
# PowerShell de ~1.500 ms por idioma; se prueba el siguiente SOLO si el
# anterior no lee nada):
#   powershell -NoProfile -ExecutionPolicy Bypass -File "bin\ocr.ps1" ^
#       -In "C:\temp\fp\roi.png" -Out "C:\temp\fp\roi.txt" -Langs "es-ES,en-US"
#
# Diagnostico (lista los idiomas OCR instalados en el equipo):
#   powershell -NoProfile -ExecutionPolicy Bypass -File "bin\ocr.ps1" -List
#
# CONTRATO con el llamador (js/logic/17_TitoletDetect_Logic.js):
#   - SIEMPRE escribe el fichero -Out (UTF-8 sin BOM): el texto reconocido
#     (una linea por linea de OCR) o bien "ERR: <motivo>" si algo ha fallado.
#   - Exit codes: 0 OK · 1 excepcion · 2 fichero inexistente · 3 sin motor OCR
#     · 4 idioma no instalado.
#
# NOTA (2026-10-06): el motor de Windows SOLO tiene los idiomas INSTALADOS en el
# equipo (aqui: en-US y es-ES). NO hay motor ca-ES: la cedilla/acentos catalanes
# pueden salir mal y el llamador lo compensa con match difuso (ocrFuzz).
# Fichero ASCII-only a proposito: PowerShell 5.1 lee los .ps1 sin BOM como ANSI
# y corromperia cualquier literal acentuado.
# ============================================================================
param(
    [string]$In,
    [string]$Out,
    [string]$Lang = 'es-ES',
    [string]$Langs = '',
    [switch]$List
)

$ErrorActionPreference = 'Stop'

function Write-Result([string]$text) {
    if ($Out) {
        [System.IO.File]::WriteAllText($Out, $text, (New-Object System.Text.UTF8Encoding($false)))
    }
}

function Load-WinRt {
    Add-Type -AssemblyName System.Runtime.WindowsRuntime | Out-Null
    [Windows.Media.Ocr.OcrEngine, Windows.Foundation.UniversalApiContract, ContentType = WindowsRuntime] | Out-Null
    [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType = WindowsRuntime] | Out-Null
    [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime] | Out-Null
    [Windows.Globalization.Language, Windows.Globalization, ContentType = WindowsRuntime] | Out-Null
}

# Await de una IAsyncOperation<T> de WinRT desde PowerShell 5.1
function Await($op, $resultType) {
    $asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
            $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
            $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
        })[0]
    $task = $asTaskGeneric.MakeGenericMethod($resultType).Invoke($null, @($op))
    $task.Wait(-1) | Out-Null
    $task.Result
}

function Get-OcrEngineFor([string]$tag) {
    if ($tag) {
        try {
            $language = New-Object Windows.Globalization.Language($tag)
            $eng = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($language)
            if ($eng) { return $eng }
        } catch { }
    }
    return $null
}

try {
    Load-WinRt

    if ($List) {
        $tags = @()
        foreach ($l in [Windows.Media.Ocr.OcrEngine]::AvailableRecognizerLanguages) { $tags += $l.LanguageTag }
        Write-Output ('OCR langs: ' + ($tags -join ', '))
        exit 0
    }

    if (-not $In) { Write-Result 'ERR: falta -In'; exit 2 }
    if (-not $Out) { Write-Result 'ERR: falta -Out'; exit 2 }
    if (-not (Test-Path -LiteralPath $In)) { Write-Result ('ERR: no existe el fichero ' + $In); exit 2 }

    # Lista de idiomas a probar EN ESTE MISMO PROCESO (el orden importa: gana el
    # primero que lea algo). -Langs "es-ES,en-US" tiene prioridad sobre -Lang.
    $langList = @()
    if ($Langs) { $langList = @($Langs -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne '' }) }
    if ($langList.Count -eq 0) { $langList = @($Lang) }

    # El fichero se decodifica UNA vez: los idiomas comparten el mismo bitmap.
    $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($In)) ([Windows.Storage.StorageFile])
    $stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
    $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])

    $text = ''
    $errs = @()
    $nErr = 0
    foreach ($tag in $langList) {
        $engine = Get-OcrEngineFor $tag
        if (-not $engine) { $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages() }
        if (-not $engine) { $nErr++; $errs += ('sin motor OCR para ' + $tag); continue }
        $result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
        $t = (($result.Lines | ForEach-Object { $_.Text }) -join "`n")
        if ($t -and $t.Trim().Length -gt 0) { Write-Result $t; exit 0 }
        if ($text -eq '') { $text = $t }
    }

    # Ningun idioma ha leido nada: si TODOS han fallado por falta de motor, es un
    # error real (el llamador lo distingue de 'texto vacio' por el prefijo ERR:).
    if ($text -eq '' -and $nErr -eq $langList.Count) {
        Write-Result ('ERR: ' + ($errs -join ' | ')); exit 4
    }
    Write-Result $text
    exit 0
} catch {
    Write-Result ('ERR: ' + $_.Exception.Message)
    exit 1
}
