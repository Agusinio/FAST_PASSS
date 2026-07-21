# PLAN: Extracción ffmpeg post-emisión — Importación en caliente

**Versión**: 1.0.0  
**Fecha**: 2026-07-21  
**Estado**: Planificado (pendiente de implementación)  
**Motivación**: Premiere no importa MP4s vivos (en crecimiento). Se necesita un mecanismo para extraer el bloque del cleanFeed inmediatamente tras la emisión.

---

## 1. Problema

- La ingesta del cleanFeed dura ~1h, y el archivo MP4 crece durante ese tiempo.
- El MP4 usa `-movflags +faststart` (moov al inicio), así que ffmpeg puede leerlo en caliente.
- **Premiere rechaza archivos en escritura activa**: su parser necesita EOF limpio.
- Los compañeros de ingeniería ya trocean con ffmpeg para procesar con Premiere.
- **QuickTime Reference Movies** se descartó: tecnología obsoleta, solo `.mov`, retirada en 2016.

---

## 2. Solución elegida: Opción A — ffmpeg `-c copy` extract post-emisión

ffmpeg se ejecuta desde FASTPASS (vía PowerShell/Node.js) para extraer solo el segmento del bloque como MP4 autocontenido y cerrado.

### 2.1 Modelo de TCs para el clip extraído

```
cleanFeed:  |──────────[ 9s handle ][  BLOQUE V1  ][ 9s handle ]──────────|
                          ↑                                     ↑
            worldBlockStartSec                         worldBlockEndSec
                          ←──────  ffmpeg -c copy  ──────→

clip extraído:  [ 9s handle ][  BLOQUE V1  ][ 9s handle ]
                ↑                                        ↑
            source IN = 0s                    source OUT = durTotal
                                     ↑                          ↑
                            sweet IN = 9s              sweet OUT = durTotal - 9s
```

| Variable | Valor para clip extraído | Fórmula |
|----------|--------------------------|---------|
| `worldSecMediaStart` | `worldBlockStartSec − handles` | El clip empieza handles antes |
| `mp4ExpandedInPoint` | `0` | Inicio del archivo extraído |
| `mp4ExpandedOutPoint` | `duración del clip` | Fin del archivo |
| `tlBlockInPointSec` | `handles` (9s por defecto) | Donde empieza el contenido real |
| `offsetSec` | `0 − handles = −handles` | `tlClipStartSec − tlBlockInPointSec` |

**Verificación de marcadores:**
```
timelinePos = (worldSecOnAir − worldSecMediaStart) + offsetSec
            = (worldSecOnAir − (worldBlockStartSec − handles)) + (−handles)
            = worldSecOnAir − worldBlockStartSec  ✓
```
→ La misma fórmula de marcadores de `flow_assembly.js` funciona sin cambios.

---

## 3. Archivos a modificar/crear

| # | Archivo | Acción | Descripción |
|---|---------|--------|-------------|
| 1 | `js/core/11_Configuracio.js` | ✏️ Modificar | Añadir `rutas.ffmpeg_exe` (ruta al ffmpeg en USB) |
| 2 | `bin/extract_block.ps1` | ✨ Nuevo | Script PowerShell: ejecuta ffmpeg para extraer bloque del cleanFeed |
| 3 | `js/workflows/flow_mainButton.js` | ✏️ Modificar | Añadir paso de detección + extracción en `_runNew()` |
| 4 | `js/logic/3_Project_Logic.js` | ✏️ Modificar | Añadir modo `_isExtractedBlock` (similar al fallback existente) |

---

## 4. Detalle de implementación

### 4.1 `js/core/11_Configuracio.js` — Nueva ruta ffmpeg

En `_activeConfig.rutas`, añadir:
```js
ffmpeg_exe: "E:\\ffmpeg\\bin\\ffmpeg.exe",  // USB, ajustar letra en Profile.json
```

En el objeto retornado por `get()`, incluir en `rutas`:
```js
ffmpeg_exe: cfg.rutas.ffmpeg_exe
```

---

### 4.2 `bin/extract_block.ps1` — Script de extracción (NUEVO)

```powershell
param(
    [string]$FfmpegPath,      # Ruta al ffmpeg.exe
    [string]$CleanFeedPath,   # UNC del cleanFeed creciendo
    [double]$StartSec,        # worldBlockStartSec - worldSecMediaStart - handles
    [double]$Duration,        # (worldBlockEndSec - worldBlockStartSec) + 2*handles
    [string]$OutputPath       # MP4 temporal de salida
)

Write-Host "🔪 [extract_block] Iniciant extracció del cleanFeed viu..."
Write-Host "   CleanFeed: $CleanFeedPath"
Write-Host "   StartSec: $StartSec"
Write-Host "   Duration: $Duration"
Write-Host "   Output: $OutputPath"

# Crear directorio de salida si no existe
$outDir = Split-Path -Parent $OutputPath
if (!(Test-Path $outDir)) {
    New-Item -ItemType Directory -Force -Path $outDir | Out-Null
}

# Ejecutar ffmpeg: -ss antes de -i para fast seek
& $FfmpegPath -ss $StartSec -t $Duration -i $CleanFeedPath `
    -c copy -avoid_negative_ts make_zero -y $OutputPath 2>&1

if ($LASTEXITCODE -eq 0 -and (Test-Path $OutputPath)) {
    $size = (Get-Item $OutputPath).Length
    Write-Host "✅ [extract_block] Extracció completada: $OutputPath ($size bytes)"
    exit 0
} else {
    Write-Host "❌ [extract_block] Error en l'extracció (exit code: $LASTEXITCODE)"
    exit 1
}
```

Parámetros:
- `-ss` antes de `-i` → fast seek al keyframe más cercano
- `-c copy` → sin re-codificar (instantáneo, solo re-empaqueta GOPs)
- `-avoid_negative_ts make_zero` → fuerza PTS del clip extraído a empezar en 0

---

### 4.3 `flow_mainButton.js` — Bloque de extracción en `_runNew()`

**Ubicación:** Después de obtener `bounds` de `calcPrecisionTrimBounds()`, antes de `Project.create()`.

**Pseudocódigo:**
```js
// ─── DETECCIÓN DE CLEANFEED VIVO + EXTRACCIÓN ───
var ffmpegPath = ctx.config.rutas.ffmpeg_exe;
var extractedMediaPath = null;
var isExtractedBlock = false;

// Solo intentar si: tenemos cleanFeedData, ffmpeg accesible, y no es fallback
if (cleanFeedData && ffmpegPath && !cleanFeedData._isFallbackBlockMedia) {
    try {
        // Verificar si el cleanFeed está creciendo (vivo)
        var cfPath = jsonData.cleanFeed.mediaPath.replace(/\\/g, '/');
        var size1 = parseInt(await callJSX(`IO.fileSize('${cfPath}')`)) || 0;
        await utils.delay(3000);
        var size2 = parseInt(await callJSX(`IO.fileSize('${cfPath}')`)) || 0;

        if (size1 > 0 && size2 > size1) {
            log(`🔍 [HOT] CleanFeed creixent (${size1} → ${size2} bytes). Extraient bloc...`);

            var handles = ctx.config.handles;
            var worldSecMediaStart = bounds.ref.worldSecMediaStart;

            // Calcular segmento: [worldBlockStart - handles, worldBlockEnd + handles]
            var extractStart = (bounds.ref.worldBlockStartSec - worldSecMediaStart) - handles;
            var extractDur = (bounds.ref.worldBlockEndSec - bounds.ref.worldBlockStartSec) + (2 * handles);

            if (extractStart < 0) extractStart = 0;

            var tempDir = (ctx.config.rutas.destinoBase + "TEMP\\").replace(/\\/g, '/');
            var tempName = ctx.progData.archivo + "_" + ctx.bloque + "_EXTRACT.mp4";
            var tempPath = tempDir + tempName;

            // Ejecutar PowerShell script
            var psCmd = 'powershell -ExecutionPolicy Bypass -File "' +
                __dirname + '/bin/extract_block.ps1" ' +
                '-FfmpegPath "' + ffmpegPath + '" ' +
                '-CleanFeedPath "' + cfPath + '" ' +
                '-StartSec ' + extractStart.toFixed(2) + ' ' +
                '-Duration ' + extractDur.toFixed(2) + ' ' +
                '-OutputPath "' + tempPath + '"';

            log(`🔪 [HOT] Executant: ${psCmd}`);
            
            // NOTA: Requiere mecanismo de exec. Ver sección 4.5.
            var execResult = await execExternal(psCmd);

            // Verificar que el archivo se creó
            var existsCheck = await callJSX(`IO.exists('${tempPath}')`);
            if (existsCheck === "true") {
                extractedMediaPath = tempPath;
                isExtractedBlock = true;
                
                // Ajustar cleanFeedData para el clip extraído
                cleanFeedData.mediaPath = tempPath;
                cleanFeedData._isExtractedBlock = true;
                cleanFeedData.mp4ExpandedInPoint = 0;
                cleanFeedData.mp4ExpandedOutPoint = extractDur;
                cleanFeedData.mp4Duration = extractDur;
                cleanFeedData.mp4SweetInPointRaw = handles;
                cleanFeedData._extractedWorldSecMediaStart = bounds.ref.worldBlockStartSec - handles;
                
                // Recalcular mp4SweetInPoint (sweet point en source del clip extraído)
                cleanFeedData.mp4SweetInPoint = handles + (ctx.config.tcOffset || 0);
                cleanFeedData.mp4SweetOutPoint = extractDur - handles + (ctx.config.tcOffset || 0);
                
                log(`✅ [HOT] Clip extret: ${tempName} (dur=${extractDur.toFixed(1)}s, sweetIN=${handles}s)`);
            } else {
                log(`⚠️ [HOT] L'extracció no ha generat el fitxer esperat. Continuant amb cleanFeed.`);
            }
        } else {
            log(`✅ CleanFeed estable (${size2} bytes). Importació normal.`);
        }
    } catch (eHot) {
        log(`⚠️ [HOT] Error en detecció/extracció: ${eHot.message}. Continuant amb cleanFeed.`);
    }
}
```

**Ajuste del manifiesto:** Cuando `_isExtractedBlock = true`, guardar `_extractedWorldSecMediaStart` en `ref.worldSecMediaStart` del manifiesto.

---

### 4.4 `3_Project_Logic.js` — Inserción condicional

Añadir un tercer modo junto al normal y al fallback, **antes** del `if (isFallbackBlockMedia)`:

```js
// ─── MODE EXTRACCIÓ: MP4 extret en calent ───────────────────
if (cleanFeedData._isExtractedBlock) {
    utils.log(`🎬 [EXTRACT] Col·locant MP4 extret a V1 (complet, ja té handles)`);
    const insertRes = await callJSX(
        `Clips.insert('${escapedCfName}', 1, 0, 'video')`
    );
    if (insertRes && insertRes.indexOf('ERR') !== -1) {
        utils.log(`⚠️ Error insertant MP4 extret: ${insertRes}`);
    }

    // Llegir la duració real del clip inserit
    const clipDataRaw = await callJSX(`Clips.get(1, 0, 'video')`);
    try {
        const clipData = JSON.parse(clipDataRaw);
        clipDuration = clipData.end - clipData.start;
        utils.log(`📐 [EXTRACT] Clip inserit: durActual=${clipDuration.toFixed(2)}s`);
    } catch(e) {
        clipDuration = cleanFeedData.mp4Duration || 60;
        utils.log(`⚠️ [EXTRACT] No s'ha pogut llegir duració real. Estimació: ${clipDuration.toFixed(2)}s`);
    }
}
```

La inserción es idéntica al modo fallback porque el clip ya está recortado exactamente al rango con handles.

---

### 4.5 Mecanismo de ejecución externa ⚠️ PENDIENTE

**Problema:** CEP no permite `app.system()` ni `cep.process` estándar. Hay que determinar qué vía usar:

| Opción | Viabilidad | Notas |
|--------|-----------|-------|
| **Node.js `child_process.execSync()`** | ✅ | CEP en modo debug permite Node.js. `require('child_process').execSync(cmd)` |
| **PowerShell via `$.evalFile()`** | ⚠️ | Solo ejecuta JSX, no comandos externos |
| **`.bat` temporal + `app.openURL()`** | ✅ | Generar .bat, abrir con `file:///`, pero es bloqueante y feo |
| **Servicio auxiliar (helper exe)** | ✅ | Proceso externo que escucha comandos vía pipe/puerto |

> **🔴 PENDIENTE:** Confirmar con el usuario qué mecanismo de ejecución externa está disponible en su CEP.

---

### 4.6 Limpieza de archivos temporales

Añadir en `_runNew()` una limpieza de extracciones > 24h:

```js
// Neteja de fitxers *_EXTRACT.mp4 més antics de 24h
try {
    var tempDir = (ctx.config.rutas.destinoBase + "TEMP\\").replace(/\\/g, '/');
    var files = await callJSX(`IO.listDir('${tempDir}')`);
    // Filtrar *_EXTRACT.mp4 y eliminar si mtime > 24h
    // (implementación depende de IO.listDir disponible)
} catch(e) { /* ignorar errores de limpieza */ }
```

---

## 5. Flujo completo

```
_runNew()
  │
  ├─1. Leer JSON escaleta → datos del bloque
  ├─2. calcPrecisionTrimBounds() → bounds
  ├─3. Verificar tamaño cleanFeed (3s polling)
  │     │
  │     ├── [ESTABLE] → Modo normal (importación directa)
  │     │
  │     └── [CRECIENDO] → VIVO
  │           ├─ ffmpeg -c copy extrae segmento → MP4 cerrado en TEMP/
  │           ├─ _isExtractedBlock = true
  │           ├─ worldSecMediaStart = worldBlockStartSec - handles
  │           ├─ mp4ExpandedInPoint = 0
  │           └─ Sweet IN = handles
  │
  ├─4. Project.create()
  │     ├─ importList(MP4 local extraído)
  │     └─ Clips.insert() (completo, sin bounds, igual que fallback)
  │
  ├─5. Establecer WorkArea (sweet IN/OUT)
  ├─6. Guardar manifest con ref.worldSecMediaStart corregido
  └─7. Marcadores (flow_assembly) → mismas fórmulas ✓
```

---

## 6. Verificación de TCs

Para cualquier ítem del bloque:
```
timelinePos = (worldSecOnAir − worldSecMediaStart) + offsetSec
            = (worldSecOnAir − (worldBlockStartSec − handles)) + (−handles)
            = worldSecOnAir − worldBlockStartSec  ✓
```

**Conclusión:** El offsetSec de `−handles` cancela exactamente el desplazamiento de `worldSecMediaStart`. Los marcadores se colocan en las mismas posiciones que en modo normal.

---

## 7. Casos de prueba

| Caso | CleanFeed | Esperado |
|------|-----------|----------|
| TNV V1, cleanFeed estable | No crece | Modo normal (sin extracción) |
| TNV V1, cleanFeed creciendo | Crece | Extracción → MP4 local → inserción |
| TNM V2 (fallback bounds) | — | Modo fallback (no aplica extracción) |
| TNC V3, cleanFeed creciendo, ffmpeg error | Crece pero falla extracción | Warning → continuar con cleanFeed (probable crash) |

---

## 8. Notas

- **ffmpeg en USB:** La letra de unidad puede variar. Idealmente configurar en `Profile.json` o detectar automáticamente.
- **`-c copy` es instantáneo:** No re-codifica. Para un bloque de ~5 min, tarda < 1 segundo.
- **El archivo extraído se guarda en `destinoBase/TEMP/`.** No interfiere con el cleanFeed original.
- **El SRT del bloque no se ve afectado.** Los TCs absolutos no cambian.
- **Si falla la extracción, se continúa con el cleanFeed original** (con warning en log).
- **Pendiente:** Determinar mecanismo de `exec` en CEP (sección 4.5).

---

## 9. Archivos modificados

| Archivo | Cambio |
|---------|--------|
| `js/core/11_Configuracio.js` | +`rutas.ffmpeg_exe` en config y `get()` |
| `bin/extract_block.ps1` | **Nuevo**: script PowerShell de extracción ffmpeg |
| `js/workflows/flow_mainButton.js` | +Detección de cleanFeed vivo + ejecución extracción + ajuste cleanFeedData |
| `js/logic/3_Project_Logic.js` | +Modo `_isExtractedBlock` (inserción completa, similar a fallback) |

---

## 10. Próximos pasos

1. **[ ] Confirmar mecanismo de `exec` en CEP** (Node.js `child_process`, PowerShell, `.bat` + `openURL`, helper exe)
2. **[ ] Confirmar ruta de ffmpeg** (letra USB, o si se puede copiar a una ruta fija en `C:\`)
3. **[ ] Implementar cambios en ACT MODE**
4. **[ ] Probar con cleanFeed real creciendo**