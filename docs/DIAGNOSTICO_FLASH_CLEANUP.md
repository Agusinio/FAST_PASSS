# Diagnóstico: Bug de eliminación extra en limpieza de Flash Whites

**Archivo:** `js/workflows/flow_assembly.js` (líneas 331–386)  
**Módulo JSX afectado:** `jsx/modules/6_Clips.jsx`  
**Fecha del análisis:** 2026-04-16  
**Estado:** ⚠️ Bug activo — se elimina el clip anterior a clipA además de B y C

---

## 1. Descripción del mecanismo esperado

El botón **Grafic** desencadena `_placeMagicChyrons`, que antes de colocar gráficos ejecuta una limpieza física del timeline: detecta *flash whites* (clips extremadamente cortos, < 0,2 s, con gap < 0,2 s respecto al clip anterior) y elimina el triplete:

```
... [A] [B_flash] [C] [D] ...
         ↓ (operación deseada)
... [A────────────────] [D] ...
```

1. Extiende **clipA** hasta donde comenzaba **clipD**.
2. Elimina **clipC** (posterior al flash).
3. Elimina **clipB** (el flash).

---

## 2. Evidencia del log

### 2.1 Estado del timeline al inicio (clips 0-10, pista V1 con 29 clips)

```
Clip 5:  start=54.88, end=59.60,  duration=4.72   ← clipA (caso 1)
Clip 6:  start=59.60, end=64.24,  duration=4.64   ← clipB: FLASH (0.12s? → ver §3)
Clip 7:  start=64.24, end=64.36,  duration=0.12   ← clipC: clip verdadero flash
Clip 8:  start=64.36, end=74.32,  duration=9.96   ← clipD
```

> [!IMPORTANT]
> El log de detección dice: **"Detectat flash blanco: clip 6 (64.24‑64.36)"**, pero los valores
> `start=64.24, end=64.36` corresponden al **clip 7** en la lista inicial del timeline,
> no al clip 6. Esta discrepancia es la primera señal del desfase de índices.

### 2.2 Lo que el código reporta como "Clip A, B, C"

```
🎯 trackIdx=1, idxA=5, idxB=6, idxC=7

🔍 Clip A (según Clips.get(1, 5, 'video')):
   → start=54.88, end=59.60    ✅ correcto (es clip 5 del log inicial)

🔍 Clip B (según Clips.get(1, 6, 'video')):
   → start=59.60, end=64.24    ⚠️ clip B tiene 4.64s de duración, NO es un flash

🔍 Clip C (según Clips.get(1, 7, 'video')):
   → start=64.24, end=64.36    ✅ ESTE es el flash real (0.12s)
```

El array `clips[]` en JavaScript tiene índice 0 en el clip 0 (el wideshot de 40.40s).
Pero ese clip vive antes del bloque, y el código trabaja con `blockClips = clips.slice(clipIndex, sliceEnd)` que empieza en `clipIndex = 1` (segundo clip del array global). El loop interno itera sobre `clips` completo con `i = 1`, por lo que sus índices `i-1, i, i+1` son **relativos al array JS**, no al timeline de Premiere.

---

## 3. Tres causas raíz identificadas

### 🔴 Causa 1 — Desfase de índice entre JS y JSX (`_get` hace `idx - 1` pero `clips[]` hace `clipIdx` directo)

**En `6_Clips.jsx`** existen dos mecanismos de indexado en conflicto:

```jsx
// _get: convierte trackIdx a base-0
_get: function(idx, type) {
    var i = parseInt(idx) - 1;   // ← trackIdx=1 → accede a tracks[0] ✅
    ...
    return tracks[i];
},

// get / remove / end: usan clipIdx directamente SIN conversión
get: function(trackIdx, clipIdx, type) {
    var track = this._get(trackIdx, type);     // trackIdx ya convertido
    var clip  = track.clips[clipIdx];          // clipIdx en base-0 directo ✅
    ...
},
```

El `trackIdx` **sí se corrige** (se resta 1). El `clipIdx` **no se corrige** — se pasa tal cual. Hasta aquí el diseño es consistente: JS pasa base-0 para clips.

**El problema** es que el array `clips[]` en JavaScript proviene de `getTrackClips(1, "video")`, y **el clip 0 de ese array es el wideshot/intro** (`start=0.00, end=40.40`). Cuando el código entra en `_placeMagicChyrons` recibe `blockClips` (que empieza en `clips[1]` del array global), pero el loop opera sobre `clips` (el array completo), con `clips[i]` referenciando posiciones absolutas del array JS.

Por tanto cuando el loop encuentra `i=6` (el flash en el array JS), ese es el **clip 7 del timeline** de Premiere (porque el clip 0 del array JS es el clip 0 del timeline). Pero el código pasa `idxA=5, idxB=6, idxC=7` a `Clips.get/remove/end`, que trabajan con esos índices **directamente sobre `track.clips[]`** del timeline.

**Resultado:** JS itera y detecta `i=6` como flash. Pasa `idxA=5` a `Clips.end` → extiende el clip del timeline en posición 5 (`start=54.88`). Luego pasa `idxC=7` a `Clips.remove` → elimina el clip del timeline en posición 7 (`start=64.36`, el flash). Luego pasa `idxB=6` a `Clips.remove` → elimina el clip en posición 6 (`start=59.60`). **Este clip 6 no es un flash** (dura 4.64s), es el clip real que debería ser clipA.

### 🔴 Causa 2 — `trackIdx` recibe el número de pista V1 (valor = 1) pero `_get` lo convierte a `tracks[0]`

```javascript
// flow_assembly.js línea 353
const trackIdx = tracks.video || 1;
```

`tracks.video` es el número de pista tal como lo ve el usuario en Premiere (la pista V1 = "1"). Se pasa a `Clips.end(trackIdx=1, idxA=5, ...)`. En JSX, `_get(1, 'video')` → `i = 1 - 1 = 0` → `tracks[0]` = V1. **Esto es correcto.**

Sin embargo, cuando el código hace `await callJSX(`Clips.remove(${trackIdx}, ${idxC}, 'video')`)` y `trackIdx=1`, JSX accede a `tracks[0]` correctamente, pero el clip eliminado **no es el que JS cree que es** por el desfase de índices de la Causa 1.

### 🔴 Causa 3 — Operaciones sobre el timeline vivo con índices stale y orden incorrecto

El código hace tres operaciones en secuencia sobre el timeline **sin refrescar** la lista de clips entre ellas:

```javascript
// Operación 1: Extender clipA (índice 5)
await callJSX(`Clips.end(${trackIdx}, ${idxA}, ${newEnd})`);

// Operación 2: Eliminar clipC (índice 7) — aún válido porque no se ha borrado nada
await callJSX(`Clips.remove(${trackIdx}, ${idxC}, 'video')`);

// Operación 3: Eliminar clipB (índice 6) — ⚠️ AHORA los índices han cambiado
await callJSX(`Clips.remove(${trackIdx}, ${idxB}, 'video')`);
```

Después de la Operación 2 (`Clips.remove` del índice 7), Premiere **renumera instantáneamente** los clips. El antiguo clip 8 pasa a ser clip 7, el antiguo clip 6 sigue siendo clip 6. **Eso no cambia nada para idxB=6.** Pero la Causa 1 ya ha hecho que `idxB` apunte al clip equivocado desde el principio.

---

## 4. Traza completa del bug (primer flash, caso real del log)

| Paso | Lo que hace el código | Lo que realmente ocurre |
|------|----------------------|------------------------|
| Detección | Loop: `i=6`, `clips[6].duration = 4.64s`. Detecta `gapAB < 0.2` y `durationB < 0.2`? **NO** — 4.64s no es < 0.2s. | ⚠️ La detección es incorrecta en este primer flash. El flash real está en `clips[7]` (0.12s). |
| (Corrección) | El log dice "clip 6 (64.24-64.36)" — posición `start=64.24` corresponde a `clips[7]` del array JS. | El código detecta el flash en `i=7` (mirando `clips[7].duration=0.12`), **no en i=6**. El mensaje del log usa `idxB = i` que es 7. |
| `idxA = i-1 = 6` | `Clips.end(1, 6, 74.28)` → extiende el clip del timeline en posición 6. | Timeline posición 6 = `start=59.60, end=64.24` (duración 4.64s). Lo extiende a 74.28s. ✅ Parece correcto. |
| `idxC = i+1 = 8` | `Clips.remove(1, 8, 'video')` → elimina posición 8 del timeline. | Timeline pos 8 = `start=64.36, end=74.32` (el clip posterior al flash). ✅ Correcto. |
| `idxB = i = 7` | `Clips.remove(1, 7, 'video')` → elimina posición 7 del timeline. | Después de borrar pos 8, el antiguo pos 7 sigue siendo el flash (`start=64.24, end=64.36`). ✅ Se borra correctamente. |
| **RESULTADO NETO** | Se extiende clip 6, se borran clips 7 y 8. | El clip en pos 5 del array JS (`start=54.88`) **no se borra directamente**, pero... |
| Segundo flash | Mismo proceso con `i=10` en el loop relanzado: detecta el flash en posición 10 del array JS (`start=103.28, end=103.40`). `idxA=9, idxB=10, idxC=11`. | Después de borrar B y C del primer flash, los índices del array JS se han actualizado con `splice`, pero los índices del timeline de Premiere también se han desplazado. Hay una **desalineación acumulativa**. |

> [!WARNING]
> El resultado del log post-limpieza muestra un **gap de 0.04s** entre clip 5 y clip 6:
> ```
> Clip 5: start=59.60, end=74.28   ← extendido correctamente
> Clip 6: start=74.32, end=87.64   ← hay un HUECO de 0.04s (un frame)
> ```
> Esto indica que `newEnd` se calculó correctamente como `clipD.start - frameDuration = 74.36 - 0.04 = 74.32`... **pero el log dice 74.28**. Hay una inconsistencia de 0.04s en el cálculo de `newEnd`.

---

## 5. El problema real del "clip anterior a clipA desaparece"

Combinando la Causa 1 con el estado real del array en el segundo flash:

Después del primer splice, el array JS tiene un clip en posición 5 (index en Premiere aún es 6, no 5). Cuando el segundo flash se procesa, el código pasa `idxA = i - 1` donde `i` es el índice en el **array JS post-splice**, pero lo envía a `Clips.remove` como si fuera el índice del **timeline real de Premiere**, que ya no coincide porque el splice de JS y el borrado real de Premiere producen offsets diferentes.

**En resumen:** Cada vez que se hace un `splice` en JS y un `remove` en Premiere, ambos sistemas divergen en 1 posición. Al procesar el segundo flash, JS cree que `idxA=7` pero en Premiere ese índice ya apunta al clip anterior al correcto clipA, causando que se borre un clip que no debería.

---

## 6. Solución propuesta

> [!IMPORTANT]
> La solución más robusta y limpia es **no usar índices como referencia absoluta** después de borrar clips. En su lugar, identificar los clips por su tiempo de inicio en el timeline.

### 6.1 Solución inmediata: Usar `Clips.get` por tiempo, no por índice

En lugar de almacenar `idxA, idxB, idxC` y usarlos en llamadas JSX posteriores (donde los índices ya pueden haber cambiado), **identificar los clips por su tiempo de inicio en el timeline** y operar siempre sobre el clip que empieza en ese tiempo:

```javascript
// En lugar de:
await callJSX(`Clips.end(${trackIdx}, ${idxA}, ${newEnd})`);
await callJSX(`Clips.remove(${trackIdx}, ${idxC}, 'video')`);
await callJSX(`Clips.remove(${trackIdx}, ${idxB}, 'video')`);

// Usar funciones que buscan por tiempo (más robustas):
await callJSX(`Clips.endAt(${trackIdx}, ${clipA.start}, ${newEnd})`);
await callJSX(`Clips.removeAt(${trackIdx}, ${clipC.start}, 'video')`);
await callJSX(`Clips.removeAt(${trackIdx}, ${clipB.start}, 'video')`);
```

Y en `6_Clips.jsx` añadir las variantes `endAt` y `removeAt` que localizan el clip por su `start.seconds` en lugar de por índice posicional:

```jsx
// 6_Clips.jsx — nuevas funciones por tiempo absoluto
endAt: function(trackIdx, startSec, newEndSec, type) {
    var track = this._get(trackIdx, type || "video");
    var target = parseFloat(startSec);
    for (var i = 0; i < track.clips.numItems; i++) {
        if (Math.abs(track.clips[i].start.seconds - target) < 0.05) {
            var t = new Time(); t.seconds = parseFloat(newEndSec);
            track.clips[i].end = t;
            return "OK";
        }
    }
    return "ERR_CLIP_NOT_FOUND_AT_" + startSec;
},

removeAt: function(trackIdx, startSec, type) {
    var track = this._get(trackIdx, type || "video");
    var target = parseFloat(startSec);
    for (var i = 0; i < track.clips.numItems; i++) {
        if (Math.abs(track.clips[i].start.seconds - target) < 0.05) {
            track.clips[i].remove(true, true);
            return "OK";
        }
    }
    return "ERR_CLIP_NOT_FOUND_AT_" + startSec;
},
```

### 6.2 Corrección del cálculo de `newEnd`

El log muestra `74.28s` pero el siguiente clip empieza en `74.32s` (gap de 1 frame = 0.04s). El clip D empieza en `74.32s`. Revisando el código:

```javascript
// flow_assembly.js línea 348
let newEnd = clipD ? clipD.start : clipC.end;
// Línea 350-352: resta un frame si clipC.end ≈ clipD.start
if (clipD && Math.abs(clipC.end - clipD.start) < 0.001) {
    newEnd -= frameDuration;  // 74.32 - 0.04 = 74.28
}
```

La condición `clipC.end - clipD.start < 0.001` se evalúa con los valores del **array JS**, donde `clipC.end = 64.36` y `clipD.start = 74.32`. La diferencia es **9.96s**, no < 0.001. La condición es **falsa**, así que `newEnd = clipD.start = 74.32`. Pero el log dice `74.28`. Esto sugiere que `clipD` en el momento de la evaluación **no es el clip que creemos** (de nuevo el desfase de índices).

**Corrección:** calcular `newEnd` a partir del `start` real del clip siguiente usando `clipC.end` (ya que clipC se borrará y su espacio quedará vacío), o refrescando los valores desde el timeline.

### 6.3 Refrescar el array JS después de cada operación

Si no se quieren añadir nuevas funciones JSX, la alternativa es refrescar el array JS desde Premiere después de cada ciclo de eliminación:

```javascript
// Al final del try, antes de changed = true:
clips.splice(i + 1, 1);
clips.splice(i, 1);
clipA.end = newEnd;

// ⚠️ Re-obtener la lista de clips desde Premiere para realinear índices:
const refreshed = await getClipsLogic().getTrackClips(mainTrack, "video");
clips.length = 0;
refreshed.forEach(c => clips.push(c));
```

Esto garantiza que en la siguiente iteración del `while`, los índices JS y los índices del timeline de Premiere estén perfectamente sincronizados.

---

## 7. Orden de implementación recomendado

| Prioridad | Acción |
|-----------|--------|
| 🔴 1 | Añadir `Clips.endAt` / `Clips.removeAt` en `6_Clips.jsx` (operación por tiempo, inmune a renumeración) |
| 🔴 2 | Cambiar las 3 llamadas JSX en `flow_assembly.js` para usar `endAt`/`removeAt` con `clip.start` como llave |
| 🟡 3 | Corregir el cálculo de `newEnd` usando `clipC.end` en lugar de `clipD.start` para evitar el gap de 1 frame |
| 🟢 4 | Añadir un log POST-operación con `Clips.get` para confirmar que el clip extendido tiene el `end` correcto |

---

## 8. Archivos afectados

| Archivo | Líneas | Cambio necesario |
|---------|--------|-----------------|
| `js/workflows/flow_assembly.js` | 360–372 | Cambiar llamadas a `Clips.end`/`Clips.remove` por `Clips.endAt`/`Clips.removeAt` |
| `js/workflows/flow_assembly.js` | 347–352 | Corregir cálculo de `newEnd` |
| `jsx/modules/6_Clips.jsx` | ~185 | Añadir funciones `endAt` y `removeAt` |

---

*Documento generado: 2026-04-16 — Basado en `ULTIMO LOG.txt`, `FLASH_WHITE_CLEANUP_PROBLEM.md`, `PENDING_TASKS.md` y lectura directa del código fuente.*
