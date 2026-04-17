# PLAN DE ATAQUE: Integración de la Escaleta JSON en FAST >>> PASS
> Última actualización: 2026-04-18 | Estado: **IMPLEMENTADO ✅**

---

## Contexto y Objetivo

Los ficheros `TN_MIGDIA_XXXXXXXX_XXXXXX.json` (y equivalentes por programa) son **snapshots de la escaleta en tiempo real** exportados por el sistema de producción. Contienen toda la información necesaria para construir automáticamente los proyectos de Premiere Pro por bloque vertical (V1, V2, V3...).

**Fuente de datos confirmada:**
```
\\public.ad-ccrtv.local\Public\VERTICALITZACIO_INFORMATIUS\ESCALETES
```

El objetivo es:
1. **Listar y leer** el JSON más reciente del programa seleccionado desde esa ruta de red.
2. **Usar el MP4 del `cleanFeed`** (señal limpia completa del programa), aplicando un decalaje temporal para situar el clip en el punto de inicio del bloque.
3. **Añadir handles de 20s** (margen de seguridad antes y después del bloque) porque el TC de emisión no es exacto.
4. **Substituir el motor de extracción actual** (basado en nombres de directorios) por este nuevo motor basado en JSON.

---

## Estructura del JSON de Escaleta

### Nivel 1 — Raíz del documento

```json
{
  "cleanFeed": { ... },      // El MP4 del programa completo
  "parallelAntena": { ... }, // Metadatos del programa (EMI)
  "escaleta": { ... }        // La escaleta completa (iNews)
}
```

### Nivel 2 — `cleanFeed` (el MP4 que nos interesa)

```json
{
  "assetId": "PRO50691805",
  "titol": "TN MIGDIA [senyal net]",
  "mediaPath": "\\\\DSMEDIA13\\DSMEDIA13_BACT_A\\50691805_20260417143017_TN_MIGDIA_senyal_net.MP4",
  "mediaStart": "14:29:54:04",
  "mediaStop":  "15:29:44:04",
  "mediaDuration": "00:59:50:00",
  "clips": [
    {
      "id": "V1",
      "tipus": "VERTICAL",
      "in":  "14:31:14",
      "out": "14:35:18",
      "titol": "TN_MIGDIA_V1_LEAD_...",
      "ready": true,
      "tooCloseToRealTime": false,
      "creat": false
    },
    { "id": "V2", ... },
    { "id": "V3", ... },
    { "id": "V4", ... }
  ]
}
```

**Campos clave:**

| Campo | Descripción |
|---|---|
| `mediaPath` | Ruta UNC del MP4 en el servidor |
| `mediaStart` | TC de inicio del MP4 (`HH:MM:SS:FF`) — para calcular el offset |
| `mediaStop` | TC de fin del MP4 — para truncar el outPoint si es necesario |
| `clips[].id` | ID del bloque (`V1`, `V2`...) — coincide con el selector de la UI |
| `clips[].in` | Hora real de inicio del bloque emitido |
| `clips[].out` | Hora real de fin del bloque emitido |
| `clips[].ready` | `true` si el clip ya está procesado |
| `clips[].creat` | `true` si el proyecto Premiere ya existe |

### Nivel 3 — `escaleta.liniesEscaleta` (líneas de la escaleta iNews)

```json
{
  "titol": "LEAD FOTO FAMÍLIA CIMERA ESP-BRA",
  "num": "01",
  "tipus": "NORMAL",
  "font": "OFT",
  "teVideo": true,
  "emesa": true,
  "horaEntradaOnAir": "14:32:14",
  "duradaOnAir": "0:19",
  "horaEntradaPrevista": "14:32:14",
  "agrupacio": "V1"             // ← CLAVE: pertenece al bloque V1
}
```

> **El campo `agrupacio` es la clave de linkaje bloque ↔ líneas.**  
> Cuando `agrupacio === "V1"`, esa línea pertenece al bloque V1.

---

## Cálculo del Decalaje (inPoint / outPoint)

```
inPoint  = (hora_in_bloque  - mediaStart) - HANDLE_SECS   [mín. 0]
outPoint = (hora_out_bloque - mediaStart) + HANDLE_SECS   [máx. mediaDuration]
```

**Ejemplo real con V1 del TN Migdia:**
```
mediaStart  = "14:29:54:04"  →  52194.16 s
blockIn     = "14:31:14"     →  52274.00 s
blockOut    = "14:35:18"     →  52518.00 s
handles     = 20 s

inPoint  = (52274.00 - 52194.16) - 20  =  ~59.84 s dentro del MP4
outPoint = (52518.00 - 52194.16) + 20  = ~343.84 s dentro del MP4
```

Los handles garantizan margen para hacer IN y OUT precisos a mano después.

**Fórmula para marcadores de escaleta** (posición dentro del clip en el timeline):
```
t_marcador = (hora_entrada_linea - hora_in_bloque) + HANDLE_SECS
```

---

## Flujo Completo del Nuevo Proyecto (NOU)

```
1. Usuario selecciona PROG + BLOC → pulsa NOU
       ↓
2. EscaletaReader.findLatest("TN_MIGDIA")
   → Lista \\public.ad-ccrtv.local\...\ESCALETES
   → Filtra por prefijo "TN_MIGDIA_"
   → Ordena por nombre desc → coge el más reciente
       ↓
3. EscaletaReader.load(jsonPath)
   → Lee el JSON vía IO.readTxt (bridge JSX)
       ↓
4. getBlock(data, "V1")
   → { in: "14:31:14", out: "14:35:18", mediaPath: "\\DSMEDIA13\..." }
       ↓
5. calcClipBounds(mediaStart, blockIn, blockOut, 20s)
   → { inPoint: ~59.84s, outPoint: ~343.84s }
       ↓
6. create() en 3_Project_Logic.js:
   a. Abre plantilla .prproj
   b. Importa Wotts (CHY), SRT, Portadas (PORTADES)
   c. Clona y renombra secuencia
   d. Importa el cleanFeed MP4 al proyecto (si no está ya)
   e. Inserta en V1 con inPoint/outPoint
   f. Coloca marcadores de escaleta en el timeline
       ↓
7. Guarda el proyecto (SaveAs)
       ↓
8. Contexto queda en UPDATE (para re-sync de archivos)
       ↓
[FALLBACK]: Si no hay JSON → inserta MP4 estándar del directorio (comportamiento anterior)
```

---

## Archivos Implementados

| Archivo | Estado | Descripción |
|---|---|---|
| `js/core/escaleta_reader.js` | **NUEVO ✅** | Módulo central: findLatest, load, getBlock, calcClipBounds, tcToSeconds |
| `jsx/main.jsx` | **MODIFICADO ✅** | Añadido `IO.listFolder()` como alias de `scanDirectory` |
| `js/core/config.js` | **MODIFICADO ✅** | `handles: 20` en config, expuesto en `Config.get()` |
| `js/workflows/flow_mainButton.js` | **MODIFICADO ✅** | `_runNew` consulta JSON antes de crear el proyecto |
| `js/logic/3_Project_Logic.js` | **MODIFICADO ✅** | `create()` acepta `cleanFeedData`: importa cleanFeed, coloca marcadores |
| `index.html` | **MODIFICADO ✅** | `escaleta_reader.js` registrado tras `config.js` |

---

## API de EscaletaReader

```js
// Constantes configurables
EscaletaReader.ESCALETES_PATH  // ruta UNC de la carpeta de JSONs
EscaletaReader.HANDLE_SECS     // handles en segundos (default: 20)

// Métodos
EscaletaReader.findLatest(programArchivo)
// → Promise<{ path, filename }|null>
// Ejemplo: findLatest("TN_MIGDIA") → { path: "\\...\\TN_MIGDIA_20260418_...", filename: "..." }

EscaletaReader.load(jsonPath)
// → Promise<{ cleanFeed, parallelAntena, escaleta }|null>

EscaletaReader.getCleanFeed(data)
// → { mediaPath, mediaStart, mediaStop, mediaDuration, clips[] }

EscaletaReader.getBlock(data, blockId)
// → { id, titol, in, out, ready, creat }|null

EscaletaReader.getLinesForBlock(data, blockId)
// → liniesEscaleta[] donde agrupacio === blockId

EscaletaReader.calcClipBounds(mediaStart, blockIn, blockOut, handleSecs, mediaStop)
// → { inPoint: float, outPoint: float, duration: float }

EscaletaReader.tcToSeconds(tc, fps = 25)
// → float  (acepta "HH:MM:SS" y "HH:MM:SS:FF")
```

---

## Roadmap Futuro

### Semáforo de estado (próxima iteración)
- Indicador visual en la UI junto al selector de bloque:
  - `✅ Escaleta carregada` — JSON encontrado y bloque disponible
  - `⚠️ Sense escaleta` — No hay JSON o bloque no disponible
  - `🔴 Bloc no ready` — El bloque existe pero `ready: false`
  - `🟡 Projecte creat` — `creat: true` en el JSON (ya existe en el servidor)

### Assembly guiado por marcadores
- Los marcadores colocados en la fase NOU contienen toda la estructura del bloque
- El assembly futuro podrá leerlos para posicionar wotts con información fidedigna
- Formato del marcador: `{num} - {titol}` (ej: `01 - LEAD FOTO FAMÍLIA CIMERA ESP-BRA`)
