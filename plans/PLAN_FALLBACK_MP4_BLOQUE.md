# PLAN: Mecanismo de Fallback — MP4 Individual del Bloque

**Versión**: 1.0.0  
**Fecha**: 2026-05-18  
**Motivación**: [`TN_MIGDIA_20260517_153006.json` V2](p:/VERTICALITZACIO_INFORMATIUS/ESCALETES/TN_MIGDIA_20260517_153006.json)

---

## 1. Problema

Cuando un bloque se emite fuera del horario programado del TN, sus TCs (`in`/`out`) caen fuera del rango del MP4 cleanFeed.  
Ejemplo concreto — **TNM 17 Mayo V2**:

| Campo | Valor | Segundos |
|-------|-------|----------|
| `cleanFeed.mediaStart` | `14:27:00:00` | 52 020 s |
| `cleanFeed.mediaStop` | `15:29:40:00` | 55 780 s |
| `cleanFeed.mediaDuration` | `01:02:40:00` | **3 760 s** |
| `V2.in` | `15:44:29` | **56 669 s** |

`calcPrecisionTrimBounds()` calcula:

```
mp4ExpandedInPoint = (56669 − 52020) − 3s handle = 4646 s
```

→ **4646 s > 3760 s** → `Clips.insertWithBounds()` crash en Premiere.

---

## 2. Solución

**Detección + Conmutación**: Si los bounds calculados exceden la duración del cleanFeed MP4, se importa el **MP4 individual del bloque** desde [`rutas.verticalitzacio`](js/core/11_Configuracio.js:113) en lugar del cleanFeed.

### 2.1 Transparencia para marcadores

Los marcadores usan **tiempos absolutos** (`worldBlockStartSec`/`worldBlockEndSec`), que son **idénticos** en ambos modos:

```
Fórmula de marcadores:
  timelinePos = (worldSecOnAir − worldSecMediaStart) + offsetSec
  offsetSec = tlClipStartSec − tlBlockInPointSec
```

Al ajustar `ref.worldSecMediaStart` = `worldBlockStartSec − handles` en modo fallback, la fórmula produce los **mismos valores de timeline** para cualquier ítem, independientemente de cuál MP4 se use.

---

## 3. Implementación

### 3.1 [`escaleta_reader.js`](js/core/escaleta_reader.js) — Dos nuevos métodos

| Método | Función |
|--------|---------|
| [`isBoundsOutOfCleanFeedRange()`](js/core/escaleta_reader.js:1094) | Detecta si `mp4ExpandedInPoint` ≥ `mp4MaxDuration` O `mp4ExpandedOutPoint` > `mp4MaxDuration` |
| [`calcFallbackBoundsForBlockMedia()`](js/core/escaleta_reader.js:1136) | Recalcula bounds: `mp4ExpandedInPoint=0`, `mp4ExpandedOutPoint=mp4Duration`, preservando `mp4Duration` |

### 3.2 [`flow_mainButton.js`](js/workflows/flow_mainButton.js) — Detección y conmutación

En el bloque `if (bounds)` después de [`calcPrecisionTrimBounds()`](js/workflows/flow_mainButton.js:110):

1. **Detección**: `reader.isBoundsOutOfCleanFeedRange(bounds, mediaStart, mediaStop)`
2. **Búsqueda**: `Scanner.mediaAssets(ctx)` → busca `{progArchivo}_{bloque}_*.MP4` en verticalització
3. **Recálculo**: `reader.calcFallbackBoundsForBlockMedia(bounds)` → IN=0
4. **Ajuste de ref**: `bounds.ref.worldSecMediaStart = worldBlockStartSec − handles`
5. **Conmutación**: `cleanFeedData.mediaPath = blockMediaPath` + flag `_isFallbackBlockMedia: true`

### 3.3 [`3_Project_Logic.js`](js/logic/3_Project_Logic.js) — Inserción condicional

Detecta el flag [`_isFallbackBlockMedia`](js/logic/3_Project_Logic.js:88):

| Modo | Inserción | Source IN |
|------|-----------|-----------|
| **Normal** | `Clips.insertWithBounds(name, 1, 0, in, out, 'video')` | `mp4ExpandedInPoint + tcOffset` |
| **Fallback** | `Clips.insert(name, 1, 0, 'video')` (clip completo) | 0 (inicio del archivo) |

Los sweet points (`handleSecs` y `clipDuration − handleSecs`) se calculan con la duración real post-inserción.

---

## 4. Flujo completo (caso TNM V2)

```
1. calcPrecisionTrimBounds() → InTier=1, worldBlockStartSec=56669, worldBlockEndSec=56958
2. isBoundsOutOfCleanFeedRange() → outOfRange=true (4646s > 3760s)
3. Scanner.mediaAssets() → "TN_MIGDIA_V2_TD_AT3_BATEJOS__TD_TORT_DADES_DE_BATEJOS...MP4"
4. calcFallbackBoundsForBlockMedia() → IN=0, OUT=289s (mp4Duration preservat)
5. ref.worldSecMediaStart = 56669 − 9 = 56660s (worldBlockStartSec − handles)
6. cleanFeedData.mediaPath = "\\\\192.168.147.199\\public\\VERTICALITZACIO_INFORMATIUS\\TN_MIGDIA_V2_...MP4"
7. 3_Project_Logic: Clips.insert() → clip complet inserit a start=0
8. clipDuration ← duració real del clip
9. Sweet points: seqIN=9s, seqOUT=clipDuration−9s
10. offsetSec = 0 − 0 = 0 (tlClipStartSec=0, tlBlockInPointSec=0)
11. Marcadors: (worldSecOnAir − 56660) + 0 → mateixos valors que en mode normal ✓
```

---

## 5. Archivos Modificados

| Archivo | Cambio |
|---------|--------|
| [`js/core/escaleta_reader.js`](js/core/escaleta_reader.js) | +`isBoundsOutOfCleanFeedRange()`, +`calcFallbackBoundsForBlockMedia()` |
| [`js/workflows/flow_mainButton.js`](js/workflows/flow_mainButton.js) | +Detección out-of-range, +búsqueda MP4 bloque, +ajuste ref, +conmutación mediaPath |
| [`js/logic/3_Project_Logic.js`](js/logic/3_Project_Logic.js) | +Flag `_isFallbackBlockMedia`, inserción condicional `Clips.insert()` vs `insertWithBounds()` |

---

## 6. Casos de prueba

| Caso | Programa | Bloque | Esperado |
|------|----------|--------|----------|
| TNM V2 (17 mayo) | TNM | V2 | **Fallback activado**: MP4 del bloque, IN=0 |
| TNM V1 (17 mayo) | TNM | V1 | **Normal**: cleanFeed, bounds válidos (in=15:26:47 dentro de 14:27-15:29) |
| TNM V3 (17 mayo) | TNM | V3 | **Normal**: cleanFeed, bounds válidos (in=15:23:51 dentro del rango) |
| TNV V1 (cualquier día) | TNV | V1 | **Normal**: cleanFeed |
| TNC V1 (cualquier día) | TNC | V1 | **Normal**: cleanFeed |

---

## 7. Notas

- El **SRT** del bloque NO se ve afectado. El SRT del cleanFeed se puede proyectar igual porque los TCs absolutos no cambian.
- Si el MP4 del bloque no existe en la ruta de verticalització, se emite warning y se continúa con el cleanFeed (el crash ocurrirá, pero al menos hay diagnóstico).
- El flag `_isFallbackBlockMedia` se propaga al manifest para trazabilidad.
