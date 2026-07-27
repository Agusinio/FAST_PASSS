# Pla d'implementació: Extracció de clip via ffmpeg

**Versió**: 1.0.0  
**Data**: 2026-07-27  
**Estat**: Planificat (pendent d'implementació en altra tasca)  
**Motivació**: Premiere no importa MP4s vius (en creixement). Es necessita un mecanisme per extreure el segment exacte del cleanFeed i generar un clip local autocontingut.

---

## 1. Objectiu

Extreure el segment exacte del cleanFeed (MP4 original) que correspon al bloc de l'escaleta, i generar un clip local autocontingut. Aquest clip servirà per:

1. **Importar al timeline de Premiere** (substituint la importació del MP4 complet)
2. **Generar la waveform** al pseudotimeline SRT (ràpid, només el segment necessari)

---

## 2. Ingesta en viu (live)

El cleanFeed creix durant l'emissió (~1h). El MP4 es pot llegir mentre creix perquè usa `-movflags +faststart` (moov al principi). 

**Si el bloc no està complet:**
- Avisar l'usuari amb un missatge "⏳ Esperant que el cleanFeed arribi al TC... "
- Polling cada 30s amb `setTimeout` per reintentar
- Quan el MP4 sigui prou llarg, extreure automàticament

---

## 3. Estructura d'implementació

### 📁 Nous fitxers

| Fitxer | Funció |
|--------|--------|
| `bin/extract_clip.ps1` | Script PowerShell que executa ffmpeg `-ss -t -c copy` |

### 📁 Fitxers a modificar

| Mòdul | Canvi |
|-------|-------|
| `js/logic/15_FFmpeg_Logic.js` | +`checkClipExists()`, `checkSourceDuration()`, `extractClip()` |
| `js/workflows/flow_mainButton.js` | +Extracció de clip a `_runNew()` |
| `js/logic/10_Srt_Logic.js` (WaveformGenerator) | Usar clip local enlloc de MP4 complet |
| `js/core/assembly_context.js` | Guardar path del clip retallat |
| `js/logic/3_Project_Logic.js` | Substituir referència mediaPath si clip existeix |

---

## 4. Fases d'implementació

### Fase 0: Script ffmpeg (`bin/extract_clip.ps1`)

```powershell
param(
    [string]$FfmpegPath,
    [string]$InputPath,
    [double]$StartSec,
    [double]$Duration,
    [string]$OutputPath
)

& $FfmpegPath -ss $StartSec -t $Duration -i $InputPath -c copy -avoid_negative_ts make_zero -y $OutputPath 2>&1

if (Test-Path $OutputPath) { Write-Host "OK" } else { Write-Host "ERR" }
```

Paràmetres:
- `-ss` abans de `-i` → fast seek al keyframe més proper
- `-c copy` → sense re-codificar (re-empaqueta GOPs)
- `-avoid_negative_ts make_zero` → PTS del clip comencen a 0

### Fase 1: `FFmpegLogic` a `15_FFmpeg_Logic.js`

```javascript
FASTPASS_UI.Logic.FFmpegLogic = {
    ffmpegPath: "E:\\ffmpeg\\bin\\ffmpeg.exe",

    checkClipExists: async function(clipPath) {
        // via IO.exists
    },

    checkSourceDuration: async function(sourcePath, requiredEndSec, handles) {
        // ffprobe per obtenir durada del MP4 original
        // Si durada < requiredEndSec + handles → { ok: false, wait: true }
    },

    extractClip: async function(sourcePath, startSec, duration, outputPath) {
        // Executa bin/extract_clip.ps1 via PowerShell
        // Verifica output
    }
};
```

### Fase 2: Integració a `flow_mainButton.js`

Dins de `_runNew()`, després d'obtenir bounds:

```javascript
var clipPath = projectDir + "\\" + programa + "_" + bloque + "_CLIP.mp4";

if (!await FFmpegLogic.checkClipExists(clipPath)) {
    var sourceCheck = await FFmpegLogic.checkSourceDuration(
        cleanFeedPath, bounds.ref.worldBlockEndSec, handles
    );
    
    if (!sourceCheck.ok) {
        status("⏳ CleanFeed no cobreix el bloc. Esperant...", "warn");
        // Polling: setTimeout 30s i reintentar
        return;
    }
    
    var extractResult = await FFmpegLogic.extractClip(
        cleanFeedPath,
        bounds.ref.worldBlockStartSec - handles,
        (bounds.ref.worldBlockEndSec - bounds.ref.worldBlockStartSec) + 2 * handles,
        clipPath
    );
}
```

### Fase 3: Waveform des del clip local

El `WaveformGenerator.getAudioPath()` (a `10_Srt_Logic.js`) buscarà primer el clip local. Si existeix, l'usa per generar la waveform (molt més ràpid perquè ja està retallat al segment exacte).

### Fase 4: Substituir referència al timeline

A `3_Project_Logic.js`, si `clipPath` existeix, importar el clip local enlloc del MP4 complet del NAS.

---

## 5. Fallbacks

| Cas | Comportament |
|-----|-------------|
| ffmpeg no disponible | Usar MP4 complet del NAS (comportament actual) |
| MP4 original no accessible | Error fatal: "No es pot accedir al cleanFeed" |
| MP4 insuficient (ingesta en viu) | "⏳ Esperant cleanFeed..." Polling 30s |
| Error d'extracció | Warning + fallback a MP4 complet |
| Clip ja existeix | Saltar extracció (comprovar per data) |
| Clip desactualitzat (MP4 modificat) | Re-extraure (comprovar timestamp) |

---

## 6. Convenció de noms

```
Projecte: \\SERVER\PROJECTES\2026_07_22\Pruebas_TNV_V1.prproj
Clip:     \\SERVER\PROJECTES\2026_07_22\TN_VESPRE_V1_CLIP.mp4
```

El nom del clip es compon de:
```
{programa}_{bloc}_CLIP.mp4
```
Es guarda al directori del projecte (`Context.folder()`).

---

## 7. Tests de verificació

1. Netejar clips anteriors
2. Obrir projecte amb cleanFeed estable
3. Verificar que es genera `{programa}_{bloc}_CLIP.mp4`
4. Verificar que s'importa al timeline
5. Repetir amb cleanFeed en creixement (espera + polling)
6. Repetir amb ffmpeg no disponible (fallback)
7. Verificar que la waveform SRT usa el clip local