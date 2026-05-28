# Plan: Mejora de Precisión en Colocación de Marcadores

## Resumen del Problema

Tras refinar `calcPrecisionTrimBounds` (sistema de Tiers) para calcular el `inPoint`/`outPoint` del clip MP4, se han identificado **4 problemas** que afectan la precisión de los marcadores de items en el timeline.

---

## Problema 1: `placePrecisionMarkers` excluye items sin `horaEntradaOnAir`

**Archivo:** [`js/workflows/flow_assembly.js`](js/workflows/flow_assembly.js)
**Línea:** 733

**Código actual:**
```javascript
for (const item of manifest.escaletaItems) {
    if (!item.horaEntradaOnAir) continue;  // ← Salta items sin OnAir
    const onAirSec = reader.tcToSeconds(item.horaEntradaOnAir);
    const markerPos = (onAirSec - tcRef.mediaStart) + tcRef.offset;
    // ...
}
```

**Problema:** Los items sin `horaEntradaOnAir` (como los de V4, que son planificados pero no se emitieron con TC real) **no reciben marcadores**. Esto deja al bloque V4 sin ninguna marca de referencia.

**Solución propuesta:** Añadir un **fallback** para items sin OnAir: usar `horaEntradaPrevista` y calcular la posición relativa usando `tcRef.realStart` como ancla.

```javascript
for (const item of manifest.escaletaItems) {
    let markerPos;
    if (item.horaEntradaOnAir) {
        // Modo preciso: TC OnAir real
        const onAirSec = reader.tcToSeconds(item.horaEntradaOnAir);
        markerPos = (onAirSec - tcRef.mediaStart) + tcRef.offset;
    } else if (item.horaEntradaPrevista) {
        // Modo fallback: hora prevista, relativa a realStart
        const previstSec = reader.tcToSeconds(item.horaEntradaPrevista);
        const realStartSec = tcRef.realStart; // segundos absolutos del inicio real del bloque
        const mediaStartSec = tcRef.mediaStart;
        // La posición en el timeline = (previstSec - realStartSec) + clipStart
        markerPos = (previstSec - realStartSec) + tcRef.clipStart;
    } else {
        continue; // No hay ninguna referencia temporal
    }
    // ...
}
```

**Cálculo del offset para fallback:**
- `tcRef.clipStart` = posición del clip en el timeline (post-inserción)
- `tcRef.realStart` = `realStartSec` (segundo absoluto del inicio real del bloque, calculado por los Tiers)
- Para un item previsto a las 21:31:53 con `realStartSec = 75726` (21:31:06) y `clipStart = 176.0s`:
  - `previstSec = 21:31:53 = 77513s`
  - `markerPos = (77513 - 75726) + 176.0 = 1787.0 + 176.0 = 1963.0s`

---

## Problema 2: `placeStructureMarkers` usa `calcClipBounds` en lugar de `calcPrecisionTrimBounds`

**Archivo:** [`js/workflows/flow_assembly.js`](js/workflows/flow_assembly.js)
**Línea:** 916

**Código actual:**
```javascript
const bounds = reader.calcClipBounds(cleanFeed.mediaStart, block.in, block.out, handles, cleanFeed.mediaStop);
```

**Problema:** `calcClipBounds` es el método **antiguo** que simplemente calcula:
```
inPoint = (block.in - mediaStart) - handles
outPoint = (block.out - mediaStart) + handles
```
Esto **no usa** el sistema de Tiers (Tier 0, Tier 1b, etc.) que implementamos. Como resultado, `placeStructureMarkers` no se beneficia de las mejoras de precisión.

**Solución propuesta:** Reemplazar `calcClipBounds` por `calcPrecisionTrimBounds` en `placeStructureMarkers`. Pero con una diferencia importante: en lugar de devolver bounds absolutos del MP4, debe devolver la posición relativa al timeline.

```javascript
// En lugar de:
const bounds = reader.calcClipBounds(cleanFeed.mediaStart, block.in, block.out, handles, cleanFeed.mediaStop);

// Usar:
const precisionBounds = reader.calcPrecisionTrimBounds(
    data,
    ctx.bloque,
    cleanFeed.mediaStart,
    cleanFeed.mediaStop,
    ctx.config
);
if (precisionBounds) {
    const tcRef = precisionBounds.tcRef;
    // El clip en el timeline ya está insertado, necesitamos encontrar su posición real
    // Usamos tcRef para calcular posiciones relativas
}
```

**Importante:** `placeStructureMarkers` se ejecuta **después** de que el clip ya está en el timeline. Por tanto, no necesita calcular `inPoint`/`outPoint` para insertar el clip, sino para **posicionar marcadores** sobre el clip ya existente. El enfoque debe ser:

1. Obtener `tcRef` del manifest (ya calculado durante la creación)
2. Usar `tcRef.clipStart` y `tcRef.offset` para convertir tiempos absolutos a posiciones en el timeline
3. Para items con OnAir: `markerPos = (onAirSec - mediaStart) + offset`
4. Para items sin OnAir: usar el fallback del Problema 1

---

## Problema 3: Offset desfasado si el usuario trima el clip

**Archivo:** [`js/workflows/flow_mainButton.js`](js/workflows/flow_mainButton.js)
**Línea:** 182

**Código actual:**
```javascript
const clipStartRaw = await callJSX(`Clips.getInPoint(1, 0)`);
const clipStart = parseFloat(clipStartRaw);
const offset = clipStart - inPoint;
```

**Problema:** El `offset` se calcula **una sola vez** durante la creación del proyecto. Si el usuario:
1. Crea el proyecto (se calcula `offset = clipStart - inPoint`)
2. Trima el clip manualmente (cambia `clipStart` en Premiere)
3. Pulsa "Estructura" para colocar marcadores

...el `offset` original ya no es válido porque `clipStart` ha cambiado.

**Solución propuesta:** En `placeStructureMarkers`, **recalcular el offset** leyendo la posición actual del clip desde Premiere:

```javascript
// Al inicio de placeStructureMarkers, después de encontrar matchedClip:
if (matchedClip) {
    // Recalcular offset basado en la posición actual del clip
    const currentClipStart = matchedClip.start;
    const manifest = await FASTPASS_UI.SessionManifest.load(ctx);
    if (manifest && manifest.tcRef) {
        const tcRef = manifest.tcRef;
        // El inPoint original no cambia (es relativo al MP4)
        // Pero el clipStart puede haber cambiado por trim del usuario
        const newOffset = currentClipStart - tcRef.inPoint;
        if (Math.abs(newOffset - tcRef.offset) > 0.1) {
            log(`📐 Offset recalculat: ${tcRef.offset.toFixed(3)}s → ${newOffset.toFixed(3)}s (trim detectat)`);
            tcRef.offset = newOffset;
            tcRef.clipStart = currentClipStart;
            await FASTPASS_UI.SessionManifest.save(ctx, { tcRef });
        }
    }
}
```

---

## Problema 4: SceneDetect no implementado

**Estado actual:** No hay integración de SceneDetect en el código. El snippet [`docs/SAMPLES/CODE/SNIPPETS/Scene Detection Script.jsx`](docs/SAMPLES/CODE/SNIPPETS/Scene%20Detection%20Script.jsx) es de After Effects, no de Premiere.

**Solución propuesta (futura):** Implementar un sistema de detección de cortes en Premiere Pro usando `ProjectItem.getMarkers()` o analizando los clips en V1. Sin embargo, esto queda **fuera del alcance** de este plan. Por ahora, el `snapToCut` existente en `placeStructureMarkers` ya usa los cortes naturales entre clips del timeline como aproximación.

---

## Plan de Implementación

### Paso 1: Fallback para items sin OnAir en `placePrecisionMarkers`

**Archivo:** [`js/workflows/flow_assembly.js`](js/workflows/flow_assembly.js)
**Líneas:** 732-743

Modificar el bucle de colocación de marcadores para que los items sin `horaEntradaOnAir` usen `horaEntradaPrevista` con un cálculo relativo a `tcRef.realStart`.

**Criterio de éxito:** Items del bloque V4 (sin OnAir) reciben marcadores en posiciones aproximadas pero razonables.

### Paso 2: Recalcular offset en `placeStructureMarkers` si hay trim

**Archivo:** [`js/workflows/flow_assembly.js`](js/workflows/flow_assembly.js)
**Línea:** ~937 (después de encontrar `matchedClip`)

Añadir lógica para leer el `clipStart` actual del clip en el timeline y recalcular `tcRef.offset` si ha cambiado.

**Criterio de éxito:** Si el usuario trima el clip y luego pulsa "Estructura", los marcadores se recolocan correctamente respecto a la nueva posición.

### Paso 3: Unificar `placeStructureMarkers` para usar `tcRef` del manifest

**Archivo:** [`js/workflows/flow_assembly.js`](js/workflows/flow_assembly.js)
**Línea:** 916

En lugar de llamar a `calcClipBounds`, cargar el `tcRef` del manifest y usarlo para calcular posiciones de marcadores. Esto asegura que `placeStructureMarkers` use los mismos Tiers que `calcPrecisionTrimBounds`.

**Criterio de éxito:** `placeStructureMarkers` produce marcadores en las mismas posiciones que `placePrecisionMarkers` para items con OnAir.

### Paso 4: Sincronizar `calcPrecisionTrimBounds` con `placeStructureMarkers`

**Archivo:** [`js/core/escaleta_reader.js`](js/core/escaleta_reader.js) y [`js/workflows/flow_assembly.js`](js/workflows/flow_assembly.js)

Asegurar que ambos sistemas compartan la misma lógica de cálculo de posiciones. Esto puede implicar extraer la lógica de conversión `(onAirSec - mediaStart) + offset` a una función común.

**Criterio de éxito:** No hay duplicación de lógica de posicionamiento entre los dos sistemas.

---

## Diagrama de Flujo del Nuevo Sistema

```mermaid
flowchart TD
    A[Usuario crea proyecto] --> B[calcPrecisionTrimBounds<br/>Calcula inPoint/outPoint con Tiers]
    B --> C[Guarda tcRef en manifest<br/>{mediaStart, inPoint, realStart,<br/>realEnd, clipStart, offset}]
    C --> D[Inserta clip MP4 en timeline]
    D --> E[Calcula offset = clipStart - inPoint]
    E --> F[Usuario puede trimar el clip]

    F --> G[Usuario pulsa Estructura]
    G --> H[placeStructureMarkers]
    H --> I[Cargar manifest + tcRef]
    I --> J[Leer clipStart actual del clip en V1]
    J --> K{¿clipStart cambiado?}
    K -->|Sí| L[Recalcular offset]
    K -->|No| M[Usar offset existente]
    L --> M
    M --> N[Para cada item de escaleta]
    N --> O{¿tiene horaEntradaOnAir?}
    O -->|Sí| P[markerPos = onAirSec - mediaStart + offset]
    O -->|No| Q[markerPos = previstSec - realStart + clipStart]
    P --> R[Colocar marcador en timeline]
    Q --> R
    R --> S[ snapToCut para ajustar a cortes reales]
    S --> T[Marcadores colocados con precisión]
```

---

## Riesgos y Consideraciones

1. **Items sin OnAir en bloques con OnAir:** Un bloque V1 puede tener algunos items con OnAir y otros sin OnAir. El fallback debe aplicarse solo a los que no tienen OnAir, no a todo el bloque.

2. **Precisión del fallback:** Los items sin OnAir usarán `horaEntradaPrevista`, que puede tener desviaciones respecto a la emisión real. Es importante documentar que estos marcadores son aproximados.

3. **Rendimiento:** `placeStructureMarkers` ya lee los clips de V1 y hace snapToCut. Añadir la lectura del manifest no debería impactar el rendimiento significativamente.

4. **Compatibilidad hacia atrás:** Los proyectos existentes (con manifest antiguo sin `tcRef`) deben seguir funcionando. Si no hay `tcRef` en el manifest, usar el comportamiento actual como fallback.
