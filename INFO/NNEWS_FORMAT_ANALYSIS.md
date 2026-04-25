# Natural News Project Format — Análisis técnico y plan de renderizado limpio

> **Autor:** Antigravity AI  
> **Fecha:** 24/04/2026  
> **Contexto:** Extensión FAST_PASSS para Adobe Premiere Pro  
> **Objetivo:** Renderizar el video track de proyectos NNews SIN los gráficos quemados, para usarlo como MASTER limpio en Premiere.

---

## 1. Inventario de formatos de archivo

Cada proyecto de Natural News genera varios archivos con el mismo nombre base:

| Extensión | Tipo real | Magic bytes | Legible | Descripción |
|---|---|---|---|---|
| `.nnp` / `.NNP` | Binario propietario (`nnpj` chunks) | `6e 6e 70 6a` | Parcial | Archivo maestro del proyecto. Chunks binarios + thumbnails embebidos |
| `.nzp` | **ZIP estándar** | `50 4b 03 04` | ✅ Sí | **LA FUENTE MÁS ÚTIL.** ZIP con `data.xml` + thumbnails BMP |
| `.xml` | XMEML (FCP7 XML) | `3c 3f 78 6d` | ✅ Sí | Export estándar ~474KB, incluye efectos audio. Importable en Premiere/Resolve |
| `.edl` | EDL SMPTE estándar | `54 49 54 4c` | ✅ Sí | Lista de cortes con timecodes. Formato más simple |
| `.ppj` | Adobe Premiere 6.x | `5b 48 45 41` | ✅ Sí | Proyecto legacy Premiere (`[HEAD] signature=Rand`) |
| `.aaf` | AAF (OLE2 compound) | `d0 cf 11 e0` | Con lib | Formato inter-aplicación profesional |
| `.ASE` | Binario `nnpj` | `6e 6e 70 6a` | ❌ No | Variante NNP (AS Edit — sistema de playout) |
| `.np1` | Binario `nnpj` | `6e 6e 70 6a` | ❌ No | Variante NNP (numeración de versión del proyecto) |

> **Nota sobre el `.nnp`:** No es un ZIP estándar aunque en algunos entornos `unzip` pueda operar sobre él. Es un formato **chunk-based** propio (`nnpj`). El `.nzp` es el equivalente ZIP garantizado y siempre presente junto al `.nnp`.

---

## 2. Estructura del archivo `.nnp` (formato binario `nnpj`)

### 2.1 Header global

```
Offset   Size   Contenido
0x00     4      Magic: "nnpj"
0x04     4      Tamaño total del archivo (little-endian uint32)
0x08     4      Flags / versión
0x0C     N      Nombre del proyecto (null-terminated, Latin-1)
```

### 2.2 Sistema de chunks

El cuerpo del `.nnp` está formado por chunks con estructura:

```
[TAG 4 bytes][SIZE 4 bytes little-endian][PAYLOAD SIZE bytes]
```

**Mapa de chunks identificados en la muestra analizada:**

| Chunk | Offset | Size | Descripción |
|---|---|---|---|
| `nnpj` | 0 | ~4.4 MB | Wrapper raíz (contiene todo el fichero) |
| `edtf` | 60 | 61 | Edit flags / parámetros de formato de edición |
| `lpth` | 121 | 2538 | **Path configuration** — tabla clave=valor de rutas de red |
| `rndo` | 2659 | 104 | Render output config |
| `loci` | 2763 | — | Locución / texto del proyecto |
| `mpll` | 2775 | 373 | Media plugin list |
| `mplg` | 2787 | 361 | Media plugin (DigiNNews) |
| `cgal` | 3148 | ~4.4 MB | Clip gallery (lista de medios + thumbnails BMP embebidos) |
| `clst` | 3210 | 105630 | Clip list |
| `micl` | 3222 | 21093 | Media clip entry |
| `mult` | 3230 | 20751 | Multi-clip (AVI + WAV estéreo) |
| `clip` | 3238 | 20727 | Clip individual |
| `mire` | 24016 | 299 | **Media recovery** — rutas UNC a ficheros fuente |
| `band` | 311690 | — | Pista del timeline |
| `eclp` | 4389269 | — | Edit clip (corte en el timeline) |
| `edit` | 4389175 | — | Datos del timeline / secuencia de edición |
| `scal` | 770457 | 64 | Scale / frame rate info |

### 2.3 Chunk `lpth` — Configuración de paths de red

Este chunk contiene la tabla de resolución de variables de entorno del sistema NNews, en formato `KEY=VALUE\r\n`. Es la clave para resolver variables como `%VOICEOVER5%` en las rutas de los clips.

```ini
APP=C:\Program Files (x86)\Natural Tools\Natural Editor 3
WORK=D:\INGESTA_LOCAL
MATERIAL=D:\INGESTA_LOCAL
FINAL=\\Playout_emergencia_cpa_z\EMERGENCIA_CONTROL_Z
PROJECT=\\SEMERGENCIA1\PROJECTES_EMERGENCIA1
GRAPHIC=D:\INGESTA_LOCAL\GRAPHIC
VOICEOVER=\\SEMERGENCIA1\VEUS_EMERGENCIA1
TITLE=D:\INGESTA_LOCAL\GRAPHIC\00-USUARI
GRAPHIC1=\\PUBLIC\PUBLIC

VOICEOVER3=\\DSMEDIA01\VEUS_CEI_1
VOICEOVER4=\\DSMEDIA02\VEUS_CEI_2
VOICEOVER5=\\DSMEDIA03\VEUS_CEI_3     ← %VOICEOVER5% en paths → \\DSMEDIA03\...

PROJECT3=\\DSMEDIA01\projectes_cei_1
PROJECT4=\\DSMEDIA02\projectes_cei_2
PROJECT5=\\DSMEDIA03\projectes_cei_3
PROJECT6=\\DSMEDIA04\projectes_cei_4

MATERIAL28=\\SSPOCEI01\VSPOCEI01
MATERIAL29=\\SSPOCEI02\VSPOCEI02
MATERIAL30=\\SSPOCEI03\VSPOCEI03A     ← servidor del MASTER renderizado
```

### 2.4 Chunk `mire` — Media Recovery (referencias a ficheros fuente)

Los 6 chunks `mire` encontrados en la muestra contienen las rutas UNC de los clips utilizados:

```
mire[0] → \\DSMEDIA01\DSMEDIA01_AACT_A\50735376_..._ZONA_MIXTA.AVI
           \\DSMEDIA01\DSMEDIA01_AACT_A\50735376_..._ZONA_MIXTA.A1.WAV
           \\DSMEDIA01\DSMEDIA01_AACT_A\50735376_..._ZONA_MIXTA.A2.WAV
mire[1] → \\DSMEDIA04\DSMEDIA04_AACT_A\50737472_..._TV3.AVI
mire[2] → \\DSMEDIA10\DSMEDIA10_AACT_A\50734626_..._INGESTAR_RADIOS.AVI
mire[3] → \\DSMEDIA02\DSMEDIA02_AACT_A\50735383_..._YOUTUBE.AVI
mire[4] → \\DSMEDIA02\DSMEDIA02_AACT_C\50735384_..._RESUM_12_LL.AVI
mire[5] → %VOICEOVER5%\50738805_..._CRONICA.WAV
```

> **Importante:** Los mismos paths aparecen idénticamente en el `data.xml` del `.nzp`, por lo que no es necesario parsear el binario `.nnp` para obtenerlos.

---

## 3. Estructura del archivo `.nzp` (ZIP con data.xml)

### 3.1 Contenido del ZIP

```
data.xml         → Proyecto completo en XML propio de NNews (~3400 líneas)
icon/icon.bmp    → Thumbnail del clip 0
icon/icon1.bmp   → Thumbnail del clip 1
icon/iconN.bmp   → ... (214 BMPs en el ejemplo analizado)
```

### 3.2 Esquema del `data.xml`

```xml
<DOCUMENT>
  <PROJECT>
    <PATHS>
      <!-- Resolución de variables %VARx% → rutas de red -->
      <VOICEOVER5>\\DSMEDIA03\VEUS_CEI_3</VOICEOVER5>
    </PATHS>

    <RENDER index="2">
      <!-- Path y codec del MASTER exportado por NNews -->
      <BaseFile>\\SSPOCEI03\VSPOCEI03A\0_20260424130447_CR_NICA_ESPANYOL...</BaseFile>
      <Codec>842099041</Codec>  <!-- 0x3231564D = 'M1V2' = MPEG-2 -->
    </RENDER>

    <LOCUTION>
      <!-- Texto de la narración / locución del clip -->
    </LOCUTION>

    <MEDIAPLUGLIST>
      <!-- Plugin de base de datos: DigiNNews -->
      <MEDIAPLUG><NamePlug>DigiNNews</NamePlug></MEDIAPLUG>
    </MEDIAPLUGLIST>

    <GALLERY>
      <!-- Galería de clips disponibles en el proyecto -->
      <CLIPS>
        <MEDIACLIP index="0">
          <CLIP>
            <Name>ZONA MIXTA + ESDEVENIMENT RAYO - ESPANYOL</Name>
            <Id>1</Id>
            <AspectRatio>1.77777777777778</AspectRatio>  <!-- 16:9 -->
          </CLIP>
          <RECOVER>
            <!-- Rutas a los ficheros fuente y sus timecodes -->
            <InPoint>0</InPoint>
            <OutPoint>181486</OutPoint>  <!-- frames @25fps -->
            <BaseTC>1977692</BaseTC>     <!-- timecode base del clip fuente -->
            <FileName0>\\DSMEDIA01\DSMEDIA01_AACT_A\..._ZONA_MIXTA.AVI</FileName0>
            <FileName1>\\DSMEDIA01\DSMEDIA01_AACT_A\..._ZONA_MIXTA.A1.WAV</FileName1>
            <FileName2>\\DSMEDIA01\DSMEDIA01_AACT_A\..._ZONA_MIXTA.A2.WAV</FileName2>
          </RECOVER>
        </MEDIACLIP>
      </CLIPS>
    </GALLERY>

    <EDIT>
      <!-- *** TIMELINE DEL PROYECTO *** -->
      <BAND index="0"><Name>Video</Name>     <!-- 26 clips → incluir -->
      <BAND index="1"><Name>Audio A</Name>   <!-- 7 clips  → incluir -->
      <BAND index="2"><Name>Locution</Name>  <!-- 6 clips  → incluir -->
      <BAND index="3"><Name>Music</Name>     <!-- 4 clips  → incluir (opcional) -->
      <BAND index="4"><Name>Title</Name>     <!-- ← GRÁFICOS → IGNORAR -->
      <BAND index="5"><Name>Title1</Name>    <!-- ← GRÁFICOS → IGNORAR -->
    </EDIT>
  </PROJECT>
</DOCUMENT>
```

### 3.3 Bandas del timeline

| Band | Index | Clips (muestra) | Acción para renderizado limpio |
|---|---|---|---|
| `Video` | 0 | 26 | ✅ Incluir siempre |
| `Audio A` | 1 | 7 | ✅ Incluir siempre |
| `Locution` | 2 | 6 | ✅ Incluir (voz en off) |
| `Music` | 3 | 4 | ✅ Incluir (opcional según caso) |
| **`Title`** | **4** | **0\*** | **❌ IGNORAR — gráficos quemados** |
| **`Title1`** | **5** | **0\*** | **❌ IGNORAR — gráficos quemados** |

> \* En proyectos **con** gráficos, `Title`/`Title1` tendrán `ClipCount > 0`. Esta es la condición de filtrado.

### 3.4 Estructura de un EDITCLIP

```xml
<EDITCLIP index="0">
  <Id>19</Id>          <!-- ID del MEDIACLIP en la GALLERY -->
  <Position>0</Position>    <!-- Posición en timeline (frames @25fps) -->
  <IPos>196761</IPos>       <!-- In-point en clip fuente (frames @25fps) -->
  <FPos>196828</FPos>       <!-- Out-point en clip fuente (frames @25fps) -->
  <VideoFadeInFrames>0</VideoFadeInFrames>
  <VideoFadeOutFrames>0</VideoFadeOutFrames>
  <VideoMixFrames>0</VideoMixFrames>
  <MuteVideo>0</MuteVideo>
  <Timescale>1</Timescale>
</EDITCLIP>
```

**Conversión a timecode:**
```
Posición en timeline  = Position / 25.0  (segundos)
In-point en fuente    = IPos / 25.0      (segundos)
Out-point en fuente   = FPos / 25.0      (segundos)
Duración del segmento = (FPos - IPos) / 25.0  (segundos)
```

---

## 4. El MASTER renderizado — Localización

El `data.xml` contiene el path de salida del MASTER con gráficos (lo que Premiere importa actualmente):

```xml
<RENDER>
  <BaseFile>\\SSPOCEI03\VSPOCEI03A\0_20260424130447_CR_NICA_ESPANYOL...</BaseFile>
  <Codec>842099041</Codec>   <!-- MPEG-2 -->
</RENDER>
```

El servidor `\\SSPOCEI03\VSPOCEI03A\` es donde NNews deposita el MASTER final. Esta es la ruta que actualmente llega a Premiere con los gráficos quemados.

---

## 5. ⚠️ Restricción crítica: Archivos en ingesta activa

> **Comunicado por el ingeniero de sistemas:**  
> Los ficheros AVI en los servidores `\\DSMEDIAxx\` pueden estar siendo **escritos activamente** (proceso de ingesta en curso). Abrir un fichero con lock exclusivo durante una ingesta detendría el proceso de grabación.

### Regla obligatoria

**Todos los accesos a ficheros en `\\DSMEDIAxx\` deben ser en modo lectura no bloqueante.**

ffmpeg en Windows abre los ficheros con `GENERIC_READ | FILE_SHARE_READ | FILE_SHARE_WRITE`, lo que **no interrumpe la escritura concurrente**. Por ello es seguro.

### Detección de clips en ingesta activa

```javascript
/**
 * Comprueba si un fichero está siendo escrito activamente (ingesta en curso).
 * NO lanza error si el fichero está compartido en escritura — solo detecta crecimiento.
 */
function isFileGrowing(filePath, sampleMs = 500) {
  return new Promise((resolve) => {
    try {
      const stat1 = fs.statSync(filePath);
      setTimeout(() => {
        try {
          const stat2 = fs.statSync(filePath);
          resolve(stat2.size > stat1.size);  // true → en ingesta
        } catch { resolve(false); }
      }, sampleMs);
    } catch { resolve(false); }
  });
}
```

Si un clip está en ingesta:
1. **Registrar** el clip afectado y continuar con los demás
2. **Alertar** al usuario con la lista de clips en curso
3. **Opcionalmente reintentar** tras la ingesta (el MASTER de NNews se genera al completar)

---

## 6. Plan de implementación: Renderizado limpio

### 6.1 Estrategia principal: `.nzp` → `data.xml` → `ffmpeg`

**Flujo:**

```
[Premiere Extension]
       │
       ▼
  Localizar .nzp   →  Descomprimir en memoria  →  Parsear data.xml
       │
       ▼
  Construir mapa: MEDIACLIP.Id → { files[], inPoint, outPoint }
       │
       ▼
  Extraer EDITCLIP[] de BAND[Video]  (ignorar Title, Title1)
  Ordenar por Position (timeline order)
       │
       ▼
  Para cada EDITCLIP:
    ├─ Resolver path del fichero AVI (con variables %VARx%)
    ├─ Verificar no-ingesta activa
    └─ ffmpeg -ss IPos/25 -to FPos/25 -i source.avi [codec] segment_N.mxf
       │
       ▼
  ffmpeg -f concat -i list.txt -c copy MASTER_CLEAN.mxf
       │
       ▼
  JSX: app.project.importFiles([MASTER_CLEAN_PATH])
```

### 6.2 Alternativa rápida: `.xml` XMEML → DaVinci Resolve / Premiere

El `.xml` exportado es un **Final Cut Pro 7 XML** estándar (XMEML). Se puede:
1. Abrir en DaVinci Resolve (gratis) o Premiere Pro
2. Eliminar las pistas `Title` / `Title1` manualmente
3. Exportar el timeline

**Ventaja:** Sin programación.  
**Desventaja:** Manual por proyecto; también necesita acceso a los AVIs de red.

### 6.3 Alternativa complementaria: `.edl` + `ffmpeg`

El EDL es el formato más simple. Se puede parsear con herramientas estándar.  
**Limitación:** No contiene información de bandas (no se pueden filtrar gráficos).

---

## 7. Módulos JavaScript propuestos

### `js/nnews_parse.js`

```javascript
const AdmZip = require('adm-zip');
const { XMLParser } = require('fast-xml-parser');

const FPS = 25.0;

/**
 * Parsea un fichero .nzp y devuelve la estructura del timeline.
 * @param {string} nzpPath - Ruta al fichero .nzp
 * @returns {{ pathMap, gallery, bands, renderOutput }}
 */
function parseNZP(nzpPath) {
  const zip = new AdmZip(nzpPath);
  const xmlContent = zip.getEntry('data.xml').getData().toString('utf8');

  const parser = new XMLParser({ ignoreAttributes: false, parseAttributeValue: true });
  const doc = parser.parse(xmlContent).DOCUMENT.PROJECT;

  const pathMap = extractPathMap(doc.PATHS || {});
  const gallery = extractGallery(doc.GALLERY, pathMap);
  const bands   = extractBands(doc.EDIT);

  return { pathMap, gallery, bands, renderOutput: doc.RENDER };
}

function extractPathMap(pathsNode) {
  // Convierte el nodo PATHS en { VOICEOVER5: '\\\\DSMEDIA03\\...', ... }
  const map = {};
  for (const [key, val] of Object.entries(pathsNode)) {
    if (typeof val === 'string') map[key] = val;
  }
  return map;
}

function resolvePathVars(rawPath, pathMap) {
  // Reemplaza %VARx% por el valor real del pathMap
  return rawPath.replace(/%([^%]+)%/g, (_, key) => pathMap[key] || `%${key}%`);
}

function extractGallery(galleryNode, pathMap) {
  const gallery = {};
  const clips = [galleryNode?.CLIPS?.MEDIACLIP].flat().filter(Boolean);

  for (const mediaClip of clips) {
    const id = mediaClip.MULTI?.CLIP?.Id;
    const recover = mediaClip.RECOVER;
    if (!id || !recover) continue;

    const count = recover.Count || 1;
    const files = [];
    for (let i = 0; i < count; i++) {
      const raw = recover[`FileName${i}`];
      if (raw) files.push(resolvePathVars(raw, pathMap));
    }
    gallery[id] = {
      name:     mediaClip.MULTI?.CLIP?.Name,
      inPoint:  recover.InPoint  / FPS,  // segundos
      outPoint: recover.OutPoint / FPS,  // segundos
      baseTC:   recover.BaseTC,
      files
    };
  }
  return gallery;
}

function extractBands(editNode) {
  const bands = {};
  const bandList = [editNode?.BAND].flat().filter(Boolean);

  for (const band of bandList) {
    const name = band.Name;
    const clips = [band.EDITCLIP].flat().filter(Boolean).map(clip => ({
      id:        clip.Id,
      position:  clip.Position / FPS,    // segundos en timeline
      iPos:      clip.IPos    / FPS,     // in-point en fuente (seg)
      fPos:      clip.FPos    / FPS,     // out-point en fuente (seg)
      duration:  (clip.FPos - clip.IPos) / FPS,
      muteVideo: clip.MuteVideo === 1,
      fadeIn:    clip.VideoFadeInFrames  / FPS,
      fadeOut:   clip.VideoFadeOutFrames / FPS,
    }));
    bands[name] = clips;
  }
  return bands;
}

module.exports = { parseNZP };
```

### `js/nnews_render.js`

```javascript
const { execFileSync } = require('child_process');
const path = require('path');
const fs   = require('fs');
const os   = require('os');
const { parseNZP } = require('./nnews_parse');

// Bandas a IGNORAR (gráficos quemados)
const GRAPHIC_BANDS = new Set(['Title', 'Title1']);

/**
 * Renderiza el track de vídeo de un proyecto NNews SIN los gráficos.
 *
 * @param {string} nzpPath    - Ruta al .nzp
 * @param {string} outputPath - Ruta del fichero de salida (.mxf)
 * @param {object} options
 *   @param {string}   options.codec         - 'dnxhd' | 'prores' | 'xdcam' (default: 'dnxhd')
 *   @param {string[]} options.bandsToRender  - Bands a incluir (default: ['Video'])
 *   @param {string}   options.tempDir        - Directorio temporal
 *   @param {string}   options.ffmpegPath     - Ruta a ffmpeg.exe
 *   @param {Function} options.onProgress     - Callback(current, total)
 */
async function renderClean(nzpPath, outputPath, options = {}) {
  const {
    codec          = 'dnxhd',
    bandsToRender  = ['Video'],
    tempDir        = path.join(os.tmpdir(), 'nnews_render'),
    ffmpegPath     = 'ffmpeg',
    onProgress     = null
  } = options;

  fs.mkdirSync(tempDir, { recursive: true });

  const { gallery, bands } = parseNZP(nzpPath);

  // Recoger y ordenar todos los clips de las bandas elegidas
  let allClips = [];
  for (const bandName of bandsToRender) {
    if (GRAPHIC_BANDS.has(bandName)) continue;  // seguridad extra
    const clips = bands[bandName] || [];
    allClips = allClips.concat(clips.map(c => ({ ...c, band: bandName })));
  }
  allClips.sort((a, b) => a.position - b.position);

  const segments = [];
  const skipped  = [];

  for (let i = 0; i < allClips.length; i++) {
    const clip   = allClips[i];
    const media  = gallery[clip.id];
    if (!media) { skipped.push(clip); continue; }

    const sourceFile = media.files[0];  // AVI principal

    // Verificar ingesta activa (no bloqueante)
    const growing = await isFileGrowing(sourceFile, 400);
    if (growing) {
      console.warn(`[SKIP] Clip en ingesta activa: ${sourceFile}`);
      skipped.push({ ...clip, reason: 'ingesta_activa' });
      continue;
    }

    const segFile = path.join(tempDir, `seg_${String(i).padStart(5,'0')}.mxf`);

    execFileSync(ffmpegPath, [
      '-y',
      '-ss', clip.iPos.toFixed(6),
      '-i', sourceFile,
      '-t', clip.duration.toFixed(6),
      ...getCodecArgs(codec),
      segFile
    ], { stdio: 'pipe' });

    segments.push(segFile);
    if (onProgress) onProgress(i + 1, allClips.length);
  }

  if (segments.length === 0) throw new Error('Ningún segmento pudo procesarse.');

  // Concatenar segmentos
  const concatList = path.join(tempDir, 'concat.txt');
  fs.writeFileSync(concatList,
    segments.map(s => `file '${s.replace(/'/g, "'\\''")}'`).join('\n')
  );

  execFileSync(ffmpegPath, [
    '-y', '-f', 'concat', '-safe', '0',
    '-i', concatList,
    '-c', 'copy',
    outputPath
  ], { stdio: 'pipe' });

  // Limpieza
  for (const seg of segments) try { fs.unlinkSync(seg); } catch {}
  try { fs.unlinkSync(concatList); } catch {}

  return { output: outputPath, skipped };
}

function getCodecArgs(codec) {
  switch (codec) {
    case 'dnxhd':
      // DNxHD 185 Mbps @ 1080i25 — estándar Avid/Premiere broadcast
      return ['-vf', 'scale=1920:1080', '-c:v', 'dnxhd', '-b:v', '185M',
              '-pix_fmt', 'yuv422p', '-c:a', 'pcm_s16le', '-ar', '48000',
              '-f', 'mxf'];
    case 'dnxhd_36':
      // DNxHD 36 Mbps — proxies rápidos
      return ['-vf', 'scale=1920:1080', '-c:v', 'dnxhd', '-b:v', '36M',
              '-pix_fmt', 'yuv422p', '-c:a', 'pcm_s16le', '-ar', '48000',
              '-f', 'mxf'];
    case 'prores':
      // ProRes 422 HQ — máxima calidad, idóneo para Mac
      return ['-c:v', 'prores_ks', '-profile:v', '3', '-vendor', 'apl0',
              '-c:a', 'pcm_s16le', '-ar', '48000',
              '-f', 'mov'];
    case 'xdcam':
      // XDCAM HD 50 Mbps — formato broadcast TV
      return ['-c:v', 'mpeg2video', '-b:v', '50M', '-maxrate', '50M',
              '-minrate', '50M', '-bufsize', '17825792',
              '-vf', 'scale=1920:1080', '-r', '25',
              '-pix_fmt', 'yuv422p',
              '-c:a', 'pcm_s16le', '-ar', '48000',
              '-f', 'mxf'];
    default:
      throw new Error(`Codec desconocido: ${codec}`);
  }
}

async function isFileGrowing(filePath, waitMs = 400) {
  return new Promise((resolve) => {
    try {
      const s1 = fs.statSync(filePath);
      setTimeout(() => {
        try {
          const s2 = fs.statSync(filePath);
          resolve(s2.size > s1.size);
        } catch { resolve(false); }
      }, waitMs);
    } catch { resolve(false); }
  });
}

module.exports = { renderClean };
```

---

## 8. Opciones de codec broadcast

| Codec | Bitrate | Container | Calidad | Velocidad | Uso recomendado |
|---|---|---|---|---|---|
| **DNxHD 185** | 185 Mbps | `.mxf` | Alta | Rápido | **Principal** ⭐ Premiere/Avid Windows |
| **DNxHD 36** | 36 Mbps | `.mxf` | Proxy | Muy rápido | Revisión rápida / offline |
| **ProRes 422 HQ** | ~220 Mbps | `.mov` | Muy alta | Rápido | Mac / ecosistema Apple |
| **XDCAM HD 50** | 50 Mbps | `.mxf` | Alta | Medio | Broadcast puro / playout |
| **Stream copy** | Variable | `.mxf` | Sin pérdida | Ultrarrápido | Si todos los fuentes son MPEG-2 homogéneo |

### Nota sobre stream copy

Si los clips fuente en `\\DSMEDIAxx\` son MPEG-2 con el mismo perfil (según `Codec=842099041` en RENDER), se puede usar `-c copy` y evitar cualquier re-encoding:

```bash
ffmpeg -ss 00:21:57.64 -i "\\DSMEDIA01\...\clip.avi" -t 00:00:02.72 \
       -c:v copy -c:a copy -f mxf segment_001.mxf
```

---

## 9. Resolución de paths en Windows / Mac

```javascript
// Paths UNC nativos de Windows:
// "\\DSMEDIA01\DSMEDIA01_AACT_A\50735376_..._.AVI"

// Conversión a ruta Mac si está montado via SMB:
function winToMac(winPath) {
  return winPath
    .replace(/^\\\\([^\\]+)\\([^\\]+)/, '/Volumes/$1/$2')
    .replace(/\\/g, '/');
}

// Conversión de variables de entorno NNews:
function resolveNNewsVar(rawPath, pathMap) {
  return rawPath.replace(/%([^%]+)%/g, (_, key) => pathMap[key] || `%${key}%`);
}
```

---

## 10. Integración futura en la extensión FAST_PASSS

### Botón propuesto: "MASTER NET" o "IMPORT CLEAN"

El botón aparece en el panel principal de la extensión cuando el programa en curso tiene un proyecto NNews asociado.

**Flujo de usuario:**
1. Usuario abre un programa en el panel (ya está ligado a un proyecto NNews)
2. Pulsa **"MASTER NET"**
3. La extensión:
   - Localiza el `.nzp` (misma ruta base que el `.nnp`, extensión cambiada)
   - Ejecuta `renderClean()` en background con progreso visible
   - Al finalizar, importa el `.mxf` en Premiere vía JSX:
     ```jsx
     app.project.importFiles([outputMxfPath], true);
     ```
4. El MASTER limpio (sin gráficos) aparece en el bin del proyecto Premiere

### Localización del .nzp desde la extensión

```javascript
// El nombre del proyecto NNews viene del Profile.json o del item activo
const projectBaseName = currentItem.nNewsProjectName;
const nzpPath = path.join(nnewsProjectsBaseDir, `${projectBaseName}.nzp`);
```

---

## 11. Estado del análisis

| Aspecto | Estado |
|---|---|
| Formato `.nzp` parseado y documentado | ✅ Completo |
| Formato `.nnp` mapeado (chunks) | ✅ Completo (no necesario para el flujo principal) |
| Identificación de bandas Title/Title1 | ✅ Confirmado |
| Resolución de variables `%VARx%` | ✅ Documentado |
| Restricción de lectura no bloqueante | ✅ Documentado y mitigado |
| Módulos JS prototipados | ✅ `nnews_parse.js` + `nnews_render.js` |
| Integración en extensión Premiere | 🔜 Pendiente de decisión |
| Detección automática de proyecto NNews | 🔜 Pendiente (ligado al flujo del panel) |
| Corrección de color (clonar LUT) | 🔜 Fase futura |

---

*Documento generado tras análisis binario de los chunks del .nnp y del data.xml del .nzp de la muestra `50738558_20260424102845_CR_NICA_ESPANYOL_PERD_A_VALLECAS`.*  
*Actualizar si cambia la versión de Natural News o la estructura de los servidores DSMedia.*

---

## 12. Efectos de color — "Adjust levels" en los EDITCLIP

### 12.1 Estructura del bloque EFFECTS en data.xml

Cada `EDITCLIP` puede contener un bloque `EFFECTS` con uno o más efectos:

```xml
<EFFECTS index="0" id="effl">
  <EffectCount>2</EffectCount>

  <!-- Efecto 0: Ajuste de color -->
  <EFFECT index="0" id="ceff">
    <Id>1986358390</Id>
    <Type>1</Type>
    <Name>Adjust levels</Name>
    <Active>1</Active>
    <Start>0</Start>
    <Length>68</Length>      <!-- duración del efecto en frames -->
    <Num>6</Num>             <!-- número de parámetros -->
    <Val0>0</Val0>           <!-- Brightness  (0=neutral) -->
    <Val1>1.294</Val1>       <!-- Contrast    (1.0=neutral) -->
    <Val2>1</Val2>           <!-- R           (1.0=neutral) -->
    <Val3>1</Val3>           <!-- G           (1.0=neutral) -->
    <Val4>1</Val4>           <!-- B           (1.0=neutral) -->
    <Val5>1</Val5>           <!-- Saturation  (1.0=neutral) -->
    <ApplyAfterScaling>0</ApplyAfterScaling>
  </EFFECT>

  <!-- Efecto 1: Overlay gráfico (IGNORAR — es el gráfico quemado) -->
  <EFFECT index="1" id="ceff">
    <Id>1164798323</Id>
    <Type>1</Type>
    <Name>1 - Mosca LaLiga EA 23-24</Name>
    <Active>1</Active>
    <FileName>%GRAPHIC%\02-ESPORTS\05 - MOSQUES i LOGOS\1 - Mosca LaLiga EA 23-24.png</FileName>
  </EFFECT>
</EFFECTS>
```

### 12.2 Parámetros de "Adjust levels" (confirmados)

| Param | Nombre     | Neutral | Descripción |
|---|---|---|---|
| `Val0` | Brightness | `0`   | Brillo — offset aditivo |
| `Val1` | Contrast   | `1.0` | Contraste — multiplicador |
| `Val2` | R          | `1.0` | Canal Rojo — multiplicador |
| `Val3` | G          | `1.0` | Canal Verde — multiplicador |
| `Val4` | B          | `1.0` | Canal Azul — multiplicador |
| `Val5` | Saturation | `1.0` | Saturación — multiplicador |

> **Importante:** Los valores no tienen escala estándar (no es 0-255 ni -1/+1 convencional). Necesitan calibración empírica contra el output real de NNews.

### 12.3 Efectos reales encontrados en la muestra

```
ClipID=19 | tl=  0.00s | dur=  67f (2.68s) | Br=0    Co=1.294 → Contraste suave (+29.4%)
ClipID=23 | tl=  2.72s | dur=  36f (1.44s) | Br=0    Co=1.396 → Contraste suave (+39.6%)
ClipID=17 | tl=  4.20s | dur=  58f (2.32s) | Br=0    Co=1.258 → Contraste suave (+25.8%)
ClipID=31 | tl= 15.64s | dur=   1f (0.04s) | Br=255  Co=4     → ⚡ FLASH BLANCO (1 frame)
ClipID=36 | tl= 17.76s | dur=   2f (0.08s) | Br=255  Co=4     → ⚡ FLASH BLANCO (2 frames)
ClipID=8  | tl= 43.20s | dur=   1f (0.04s) | Br=255  Co=4     → ⚡ FLASH BLANCO (1 frame)
```

**Patrones identificados:**

1. **Ajuste de contraste normal** → `Br=0, Co=1.25-1.40, R=G=B=Sat=1` — son clips de zona mixta/TV3 que el editor ha contrastado ligeramente. Duración: 1-3 segundos.

2. **Flash blanco de transición** → `Br=255, Co=4, R=G=B=Sat=1` — clips de 1-2 frames colocados entre cortes para crear un flash visual. No es un ajuste de color real sino un efecto de transición.

### 12.4 Discriminación: ajuste de color vs. flash blanco

```javascript
function classifyEffect(brightness, contrast, r, g, b, saturation, durationFrames) {
  // Flash blanco: muy corto (≤3 frames) + brillo máximo + contraste extremo
  if (durationFrames <= 3 && brightness >= 200 && contrast >= 3.0) {
    return 'FLASH_WHITE';
  }
  // Todos neutrales: no hay efecto
  if (brightness === 0 && contrast === 1.0 && r === 1.0 && 
      g === 1.0 && b === 1.0 && saturation === 1.0) {
    return 'NEUTRAL';
  }
  // Ajuste de color real
  return 'COLOR_ADJUST';
}
```

### 12.5 Equivalencias con filtros ffmpeg

#### Ajuste de color (Val0 Brightness sigue hipótesis pendiente de calibración)

```bash
# Contraste suave (Co=1.294, Br=0, Sat=1 — el caso más común):
ffmpeg -i clip.avi -vf "eq=contrast=1.294:brightness=0:saturation=1" out.mxf

# Ajuste con canal R (hipotético: Val2=1.2, el resto neutral):
ffmpeg -i clip.avi -vf "eq=contrast=1.3,colorchannelmixer=rr=1.2:gg=1:bb=1" out.mxf

# Saturación aumentada (hipotético: Val5=1.5):
ffmpeg -i clip.avi -vf "eq=saturation=1.5" out.mxf
```

> **Hipótesis de mapping para Brightness:**  
> `Val0=0` → `ffmpeg brightness=0.0` (neutral en ambos)  
> `Val0=255` → posiblemente `ffmpeg brightness=1.0` (máximo)  
> Escala: `ffmpeg_brightness = Val0 / 255.0`  
> **⚠️ Necesita calibración visual contra el output NNews real.**

#### Flash blanco (Val0=255, Co=4, duración ≤3 frames)

```bash
# Generar un frame totalmente blanco de la duración exacta:
ffmpeg -f lavfi -i color=white:s=1920x1080:r=25 \
       -t 0.040 -c:v dnxhd -b:v 185M -pix_fmt yuv422p \
       flash_white_1frame.mxf

# Alternativa más fiel al efecto: boost extremo del clip fuente
ffmpeg -i clip.avi -ss IN -t 0.040 \
       -vf "eq=brightness=1.0:contrast=4.0" \
       flash_approx.mxf
```

> **Recomendación:** Para los flashes de 1-2 frames, generar un frame blanco puro es más predecible y visualmente equivalente que intentar replicar exactamente los valores extremos del efecto.

### 12.6 Efecto "Mosca" (overlay gráfico — ignorar)

El segundo efecto en el bloque EFFECTS es un overlay PNG (logotipo/watermark de LaLiga en este caso). Tiene `FileName` con ruta a un PNG en `%GRAPHIC%\...`.

**→ Este efecto hay que ignorarlo en el renderizado limpio.** Es precisamente el tipo de gráfico quemado que queremos evitar.

### 12.7 Implementación en `nnews_render.js`

```javascript
const FPS = 25.0;

/**
 * Convierte los efectos NNews de un EDITCLIP a filtros de vídeo ffmpeg.
 * @param {Array} effects - Array de objetos EFFECT del XML
 * @param {number} durationFrames - Duración del clip en frames
 * @returns {{ vfFilters: string, isFlash: boolean }}
 */
function resolveVideoFilters(effects, durationFrames) {
  const vfParts = [];
  let isFlash = false;

  for (const eff of effects) {
    // Ignorar efectos de tipo overlay/gráfico (tienen FileName, no vals)
    if (eff.fileName) continue;
    if (eff.name !== 'Adjust levels') continue;
    if (!eff.active) continue;

    const [br, co, r, g, b, sat] = eff.vals.map(Number);
    
    // Detectar flash blanco: corto + extremo
    if (durationFrames <= 3 && br >= 200 && co >= 3.0) {
      isFlash = true;
      continue;  // se maneja aparte generando color=white
    }

    // Mapping de parámetros a ffmpeg eq
    const ffBr  = br / 255.0;            // hipótesis de escala — calibrar
    const ffCo  = co;                    // directo (1.0=neutral en ambos)
    const ffSat = sat;                   // directo (1.0=neutral en ambos)

    // Ajuste R/G/B (1.0=neutral en NNews y en colorchannelmixer)
    const needsChannels = (r !== 1.0 || g !== 1.0 || b !== 1.0);
    const needsEq       = (br !== 0 || co !== 1.0 || sat !== 1.0);

    if (needsEq) {
      vfParts.push(`eq=brightness=${ffBr.toFixed(4)}:contrast=${ffCo.toFixed(4)}:saturation=${ffSat.toFixed(4)}`);
    }
    if (needsChannels) {
      vfParts.push(`colorchannelmixer=rr=${r}:gg=${g}:bb=${b}`);
    }
  }

  return {
    vfFilters: vfParts.join(',') || null,
    isFlash
  };
}
```

---

## 13. Mapa completo del segundo efecto — el gráfico "Mosca"

Los efectos de tipo overlay (sin `Num/Val`, solo `FileName`) corresponden a gráficos superpuestos:

```
%GRAPHIC%\02-ESPORTS\05 - MOSQUES i LOGOS\1 - Mosca LaLiga EA 23-24.png
```

- `%GRAPHIC%` se resuelve con el chunk `lpth`: `D:\INGESTA_LOCAL\GRAPHIC`
- Son los gráficos quemados que queremos **excluir** del renderizado limpio
- Están siempre en el bloque `EFFECTS` del `EDITCLIP`, **no en una banda `Title` separada** en este caso
- → La detección de gráficos debe hacerse también a nivel de efecto, no solo por nombre de banda

> **Conclusión actualizada:** Los gráficos de NNews pueden estar en:
> 1. **Bandas `Title`/`Title1`** → clips de grafismo como elementos independientes
> 2. **Efectos `FileName` dentro de `EDITCLIP`** → overlays directos sobre el clip de vídeo (moscas, logos)
> En ambos casos deben ignorarse para el renderizado limpio.

