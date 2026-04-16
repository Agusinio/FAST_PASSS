# Auditoría de Modularización — `flow_assembly.js`

**Archivo analizado:** `js/workflows/flow_assembly.js` (662 líneas, 38.8 KB)  
**Fecha:** 2026-04-16  
**Objetivo:** Identificar código reutilizable, repetido o fuera de lugar que pueda migrar a `/logic`

---

## Resumen ejecutivo

`flow_assembly.js` actualmente mezcla tres niveles de responsabilidad en un solo archivo:

| Nivel | Descripción | Debería estar en |
|-------|-------------|-----------------|
| **Orquestación** | Decide qué bloques hay, qué tipo son y en qué orden se procesan | `flow_assembly.js` ✅ |
| **Lógica de negocio** | Cálculos de posición, selección de clips, clasificación de chyrons | `/logic/` ⚠️ |
| **Operaciones de timeline** | Extender clips, eliminar clips, insertar chyrons | `JSX` + `/logic/Clips` ⚠️ |

El archivo tiene **6 bloques candidatos a extracción**, de los cuales 3 son urgentes por ser funciones puras reutilizables que ya tienen un hogar natural en los módulos de lógica existentes.

---

## Mapa del archivo actual

```
flow_assembly.js (662 líneas)
│
├── [L1-27]    Helpers locales: log, callJSX, formatTC
├── [L29-239]  runAutoPlacement()           ← orquestador principal
│   ├── [L46]      getTrackClips()          → ya en Clips_Logic ✅
│   ├── [L68-99]   fusión de bloques OFF    → candidato a migrar
│   └── [L104-219] loop de bloques
│
├── [L244-259] _placeIntroGfx()             → candidato a migrar
├── [L264-295] _placeOffGfx()               → candidato a migrar
├── [L300-310] _placeOffVideoGfx()          → candidato a migrar
│
└── [L315-657] _placeMagicChyrons()         ← el corazón del problema
    ├── [L318-329] cálculo avgDelta         → candidato a migrar
    ├── [L331-386] limpieza flash whites    → candidato a migrar (urgente)
    ├── [L394-445] findCandidateClip()      → candidato a migrar (urgente)
    ├── [L450-475] clasificación chyrons    → candidato a migrar
    ├── [L496-556] colocación traducciones  → candidato a migrar
    └── [L560-654] colocación otros chyrons → candidato a migrar
```

---

## Hallazgos detallados

---

### 🔴 H1 — `findCandidateClip` es una función pura enterrada en `_placeMagicChyrons`

**Localización:** Líneas 401–445  
**Tamaño:** ~45 líneas  
**Naturaleza:** Función pura (entrada: `clips[], idealPos, tc` → salida: un clip). Sin efectos secundarios, sin llamadas JSX, sin estado.

**Problema:** Está definida como función interna con `function` dentro del scope de `_placeMagicChyrons`, lo que impide:
- Probarla de forma aislada
- Reutilizarla desde otros workflows (ej. `flow_retols.js` que también coloca chyrons)
- Parametrizar los márgenes sin tocar el flujo de colocación

**Duplicidad detectada:** La misma lógica de búsqueda de "clip contenedor" existe parcialmente en `13_Parse.js > classify()` y en `14_Assembly_Logic.js`. No es idéntica pero el patrón es el mismo: iterar sobre un array de clips y encontrar el más adecuado para una posición ideal.

**Destino propuesto:** `js/logic/14_Assembly_Logic.js` como método `Assembly.findCandidateClip(clips, idealPos, options)`

```javascript
// Propuesta de firma
findCandidateClip: function(clips, idealPos, options = {}) {
    const { minMarginBefore = 0.5, minMarginAfter = 3.0, tolerance = 0.1 } = options;
    // ... lógica migrada de flow_assembly.js L401-445
}
```

---

### 🔴 H2 — Limpieza de flash whites debe vivir en `Clips_Logic`

**Localización:** Líneas 331–386  
**Tamaño:** ~56 líneas  
**Naturaleza:** Operación sobre el timeline (eliminar clips, extender clips). Es la parte que tiene el bug documentado.

**Problema:** Está dentro de `_placeMagicChyrons`, que es el método de colocación de gráficos. La limpieza de flash whites es una **pre-condición del timeline** que debería ejecutarse antes de cualquier colocación y de forma independiente. Al estar embebida:
- No se puede invocar sola para depurar
- No se puede reutilizar si en el futuro se necesita limpiar el timeline desde otro workflow
- Mezcla la responsabilidad de "limpiar el timeline" con "colocar chyrons"

**Destino propuesto:** `js/logic/6_Clips_Logic.js` como método `Clips.cleanFlashWhites(clips, trackIdx, mainTrack)`

```javascript
// Propuesta de firma
cleanFlashWhites: async function(clips, trackIdx, mainTrack, options = {}) {
    const { maxGap = 0.2, minDuration = 0.2, frameDuration = 0.04 } = options;
    // ... lógica migrada usando Clips.endAt / Clips.removeAt (ver diagnóstico)
    // Devuelve el array clips actualizado
    return clips;
}
```

Y en `flow_assembly.js` quedaría:
```javascript
clips = await getClipsLogic().cleanFlashWhites(clips, trackIdx, mainTrack);
```

---

### 🟠 H3 — Cálculo de `avgDelta` (Footprint Matching) es lógica de análisis, no de colocación

**Localización:** Líneas 318–329  
**Tamaño:** ~12 líneas  
**Naturaleza:** Análisis estadístico: calcula el desplazamiento medio entre posición ideal y posición real de los NomCarrec para ajustar todos los demás chyrons.

**Problema:** Concepto correcto pero mezclado con la función de colocación. Si el cálculo falla o produce un delta erróneo, contamina todas las posiciones del bloque.

**Destino propuesto:** `js/logic/14_Assembly_Logic.js` como método `Assembly.calcFootprintDelta(block, clips)`

```javascript
calcFootprintDelta: function(block, clips) {
    const anchors = [];
    for (const c of block.chyrons) {
        if ((c.rol || '').toUpperCase() !== "NOMCARREC") continue;
        // ... lógica migrada
    }
    return anchors.length > 0
        ? anchors.reduce((s, a) => s + a.delta, 0) / anchors.length
        : 0;
}
```

---

### 🟠 H4 — Clasificación de chyrons por tipo está duplicada e inline

**Localización:** Líneas 450–475  
**Tamaño:** ~25 líneas  

El código classifica los chyrons del bloque en tres cubos: `temaTitols`, `traduccions`, `otros`. Esta lógica de clasificación:

1. Usa criterios (`c.name.includes("Tema-Titol")`, `c.rol.includes("TRADUCCIO")`) que ya aparecen en `13_Parse.js > meta()` donde se asigna el campo `rol`.
2. Se repite conceptualmente en `_placeOffGfx` (L284) donde también se busca `Tema-Titol` inline.
3. Se repite en `_placeOffVideoGfx` (L303) con el mismo `c.name.includes("Tema-Titol")`.

**La misma búsqueda `c.name.includes("Tema-Titol")` aparece en 5 lugares distintos del archivo.**

**Destino propuesto:** `js/logic/14_Assembly_Logic.js` como método `Assembly.classifyChyrons(chyrons)`

```javascript
classifyChyrons: function(chyrons) {
    return chyrons.reduce((acc, c) => {
        if (c.name.includes("Tema-Titol") || c.name.includes("TITOL")) {
            acc.temaTitols.push(c);
        } else if ((c.rol || '').toUpperCase().includes("TRADUCCIO") || c.name.toUpperCase().includes("TRADUCCIO")) {
            acc.traduccions.push(c);
        } else {
            acc.otros.push(c);
        }
        return acc;
    }, { temaTitols: [], traduccions: [], otros: [] });
}
```

---

### 🟡 H5 — Fusión de bloques OFF podría ir en `14_Assembly_Logic` o `13_Parse`

**Localización:** Líneas 68–99 (dentro de `runAutoPlacement`)  
**Tamaño:** ~32 líneas  

La fusión de bloques con sufijo `f` con su bloque base (combinar los chyrons de `11f` y `11` en un solo bloque fusionado) es lógica de **transformación de estructura**, no de orquestación temporal.

Actualmente `13_Parse.js > files()` crea la estructura pero no la fusiona. La fusión se hace en el orquestador. Si se necesitara la estructura fusionada desde otro workflow, habría que duplicar este código.

**Destino propuesto:** `js/logic/13_Parse.js` como método `Parse.mergeOffBlocks(structure)`

```javascript
mergeOffBlocks: function(structure) {
    const merged = [];
    for (let i = 0; i < structure.length; i++) {
        // ... lógica migrada de flow_assembly.js L68-99
    }
    return merged;
}
```

---

### 🟡 H6 — `formatTC` es un helper global que vive dentro del IIFE

**Localización:** Líneas 19–27  
**Tamaño:** 8 líneas  

`formatTC(seconds)` convierte segundos a timecode HH:MM:SS:FF a 25fps. Esta misma función (o una equivalente) probablemente existe o se necesita en otros flujos que trabajan con timecodes.

**Destino propuesto:** `js/lib/` o `js/core/utils.js` como `Utils.formatTC(seconds, fps = 25)`

---

### 🟢 H7 — `extractSegmentIndex` duplicada en el mismo archivo

**Localización:** Líneas 394–397 y 511–515  
La función:
```javascript
function extractSegmentIndex(name) {
    const match = name.match(/\[(\d+)-\d+\]/);
    return match ? parseInt(match[1]) : null;
}
```
Está definida una vez (L394) pero el patrón de ordenación por `idxA/idxB` se repite en el sort de traduccions (L467-474) y dentro del loop de grupos (L511-515). Ya que está en scope, no es duplicidad de código — pero sí de lógica de comparación.

**Acción:** Ninguna urgente, pero al migrar `traduccions` a su propio módulo, llevar esta helper con ella.

---

## Código repetido: ocurrencias de patrones

| Patrón | Ocurrencias | Acción |
|--------|-------------|--------|
| `c.name.includes("Tema-Titol") \|\| c.name.includes("TITOL")` | **5 veces** | Centralizar en `Assembly.classifyChyrons()` |
| `(c.rol \|\| '').toUpperCase() === "NOMCARREC"` | **4 veces** | Añadir helper `isNomCarrec(c)` |
| `getUtils().escape(c.name)` + `Clips.insert(...)` | **8+ veces** | Ya es una llamada simple; no extraer más |
| `clips[0].start + getUtils().timeToSeconds(c.tc)` | **3 veces** | Encapsular como `Assembly.calcIdealPos(block, c)` |
| `candidateClip.start + (isFirstClip ? 0.4 : 0)` | **2 veces** | Extraer como `Assembly.calcPlacementTime(clip, isFirst)` |

---

## Dependencias actuales de `flow_assembly.js`

```
flow_assembly.js
    ├── FASTPASS_UI.Logic.Clips     (getTrackClips)
    ├── FASTPASS_UI.Logic.Parse     (classify)
    ├── FASTPASS_UI.Utils           (log, callJSX, escape, timeToSeconds)
    ├── FASTPASS_UI.State           (state.structure)
    ├── FASTPASS_UI.Config          (cfg.tracks.*)
    └── window.Assembly             (conductor) ← self-reference a 14_Assembly_Logic!
```

> [!WARNING]
> `flow_assembly.js` llama a `window.Assembly.conductor()` en la línea 230, que está definido en `14_Assembly_Logic.js`. Es decir, un workflow llama a un módulo de lógica que debería ser su dependencia, no su par. Esta referencia cruzada sugiere que parte de `_placeOffGfx` debería simplemente llamar al mismo `Assembly.conductor()` en lugar de duplicar la lógica de inserción de conductor que ya existe allí.

---

## Estructura modular objetivo

```
js/
├── logic/
│   ├── 13_Parse.js
│   │   └── + Parse.mergeOffBlocks(structure)           [H5]
│   │
│   ├── 14_Assembly_Logic.js
│   │   ├── Assembly.setup()                            [existente]
│   │   ├── Assembly.freeze()                           [existente]
│   │   ├── Assembly.conductor()                        [existente]
│   │   ├── + Assembly.findCandidateClip(clips, pos)    [H1] 🔴
│   │   ├── + Assembly.calcFootprintDelta(block, clips) [H3] 🟠
│   │   ├── + Assembly.classifyChyrons(chyrons)         [H4] 🟠
│   │   └── + Assembly.calcIdealPos(block, c)           [H7] 🟡
│   │
│   └── 6_Clips_Logic.js
│       ├── Clips.getTrackClips()                       [existente]
│       ├── Clips.rippleOut()                           [existente]
│       └── + Clips.cleanFlashWhites(clips, trackIdx)  [H2] 🔴
│
└── workflows/
    └── flow_assembly.js                                [reducido a ~250 líneas]
        ├── runAutoPlacement()    ← solo estructura de bucle
        ├── _placeIntroGfx()      ← mantener (lógica específica de intro)
        ├── _placeOffGfx()        ← simplificar (delegar a Assembly.conductor)
        ├── _placeOffVideoGfx()   ← mantener (pequeña, específica)
        └── _placeMagicChyrons()  ← reducir a ~80 líneas de orquestación
```

---

## Estimación de reducción

| Métrica | Actual | Objetivo |
|---------|--------|----------|
| Líneas `flow_assembly.js` | **662** | ~260 |
| Funciones en `14_Assembly_Logic.js` | 3 | 7 |
| Funciones en `6_Clips_Logic.js` | 6 | 8 |
| Funciones testables de forma aislada | 0 | 5 |

---

## Orden de migración recomendado

> [!IMPORTANT]
> Antes de refactorizar, resolver el bug de flash whites (ver `DIAGNOSTICO_FLASH_CLEANUP.md`).
> La refactorización y la corrección del bug pueden hacerse en paralelo si se empieza por H2.

| # | Hallazgo | Urgencia | Esfuerzo | Impacto |
|---|----------|----------|----------|---------|
| 1 | **H2** Limpieza flash whites → `Clips_Logic` | 🔴 Alta | Medio | Resuelve el bug + modulariza |
| 2 | **H4** Clasificación chyrons → `Assembly_Logic` | 🟠 Media | Bajo | Elimina 5 duplicaciones |
| 3 | **H1** `findCandidateClip` → `Assembly_Logic` | 🟠 Media | Bajo | Testabilidad |
| 4 | **H3** `avgDelta` → `Assembly_Logic` | 🟠 Media | Bajo | Claridad |
| 5 | **H5** Fusión OFF → `Parse` | 🟡 Baja | Medio | Reutilización futura |
| 6 | **H6** `formatTC` → `Utils` | 🟡 Baja | Mínimo | Limpieza |

---

*Auditoría generada: 2026-04-16*  
*Archivos analizados: `flow_assembly.js`, `14_Assembly_Logic.js`, `6_Clips_Logic.js`, `13_Parse.js`*
