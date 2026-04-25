# Problema: GRAFISMOS colocados fuera de la intro

## Observación

En el log de ejecución:

```
📍 Línia 01i: 21:01:43 → timeline 0.00s   (MEDIO, ideal 0.00s)   → clip 0
📍 Línia 01:  21:02:01 → timeline 45.04s  (LARGO, ideal 18.00s)  → clip 4
📍 Línia 01chy: 21:02:05 → timeline 67.32s (GRAFISMO, ideal 22.00s) → clip 5
📍 Línia 01gf: 21:02:05 → timeline 71.44s (GRAFISMO, ideal 26.00s) → clip 6
📍 Línia 01te: 21:02:05 → timeline 73.96s (GRAFISMO, ideal 30.00s) → clip 7
```

Los ítems `01chy`, `01gf`, `01te` son **GRAFISMOS** (`agrupacio=null`, `duracion=0`). Deberían colocarse dentro del clip de la intro (bloque `01i`, clip 0), pero aparecen en clips muy posteriores (5, 6, 7).

## Causa raíz

La lógica actual está en [`js/workflows/flow_assembly.js:1017-1040`](../js/workflows/flow_assembly.js:1017) (función `snapToCut`) y el bucle principal alrededor de la línea 1051.

El algoritmo:

1. **Clasifica** cada línea según `agrupacio` y `duracion` (línea 1003: `clasificarItem`).
2. **Calcula** un `idealPos` basado en el timecode relativo al inicio del bloque.
3. **Busca un clip** mediante `snapToCut`, que itera desde `ultimoCorteUsado + 1` hasta encontrar un clip que cumpla la tolerancia de posición y la duración mínima.
4. **Actualiza** `ultimoCorteUsado = idxCorte` después de cada ítem.

El problema es que **los GRAFISMOS se tratan como ítems independientes que consumen un clip**. La función `snapToCut`:

- Empieza desde `ultimoCorteUsado + 1`, por lo que nunca puede reutilizar el clip del ítem anterior.
- Tiene `tolerancia=1.0` y `minDur=0` para GRAFISMO, lo que permite asignarlos a cualquier clip, pero siempre al siguiente no usado.

### Secuencia del error

| Ítem | ultimoCorteUsado | Busca desde | Clip asignado | Start clip |
|------|-----------------|-------------|---------------|------------|
| 01i  | -1              | 0           | 0             | 0.00s      |
| 01   | 0               | 1           | 4 (saltó 1-3 por duración <15s) | 45.04s |
| 01chy| 4               | 5           | 5             | 67.32s     |
| 01gf | 5               | 6           | 6             | 71.44s     |
| 01te | 6               | 7           | 7             | 73.96s     |

Los GRAFISMOS `01chy`, `01gf`, `01te` (que pertenecen al bloque 01 = intro) se colocan en clips 5, 6, 7 porque el algoritmo los trata como líneas independientes que deben ocupar su propio clip.

## Naturaleza de los GRAFISMOS

Según la nomenclatura de las líneas:

- `01i` = bloque 01, intro
- `01` = bloque 01, video principal
- `01chy` = bloque 01, chyron (superposición gráfica)
- `01gf` = bloque 01, GF (superposición gráfica)
- `01te` = bloque 01, TE (superposición gráfica)

Los ítems con `agrupacio=null` y `duracion=0` son **superposiciones gráficas** que deben colocarse **dentro del clip del bloque al que pertenecen**, no como clips independientes. En este caso, `01chy`, `01gf` y `01te` deben ir dentro del clip de la intro (clip 0), no en clips separados.

## Solución propuesta

### Enfoque 1: No consumir clip para GRAFISMOS (mínimo cambio)

Modificar el bucle principal para que los ítems GRAFISMO **no actualicen `ultimoCorteUsado`** y **hereden el `idxCorte` del último ítem con `agrupacio != null`** que comparta el mismo prefijo de bloque.

**Cambios necesarios:**

1. En [`js/workflows/flow_assembly.js:1076-1079`](../js/workflows/flow_assembly.js:1076), condicionar la actualización de `ultimoCorteUsado`:

```javascript
// Solo actualizar ultimoCorteUsado si NO es GRAFISMO
if (categoria !== 'GRAFISMO' && idxCorte >= 0) {
    usedCorteIdx.add(idxCorte);
    ultimoCorteUsado = idxCorte;
}
```

2. En [`snapToCut`](../js/workflows/flow_assembly.js:1017), modificar para que los GRAFISMOS puedan reutilizar el índice actual:

```javascript
const snapToCut = (idealPos, categoria, cortes, clips, ultimoCorteUsado) => {
    const tolerancias = { LARGO: 2.0, MEDIO: 2.0, CORTO: 1.0, GRAFISMO: 1.0, NO_VERTICALIZABLE: 2.0 };
    const minDurs = { LARGO: 15, MEDIO: 5, CORTO: 0, GRAFISMO: 0, NO_VERTICALIZABLE: 0 };
    const tolerancia = tolerancias[categoria] || 2.0;
    const minDur = minDurs[categoria] || 0;

    // Para GRAFISMO, permitir usar el mismo índice que ultimoCorteUsado
    const startIdx = (categoria === 'GRAFISMO') ? ultimoCorteUsado : ultimoCorteUsado + 1;

    for (let i = startIdx; i < cortes.length; i++) {
        // ... mismo código que antes ...
    }
    // ... fallback ...
};
```

**Problema con este enfoque:** Los GRAFISMOS `01chy` (idealPos=22.00s) se colocarían en el clip de `01` (clip 4, start=45.04s) porque `ultimoCorteUsado=4` y el GRAFISMO hereda ese índice. Pero lo correcto sería que heredaran el clip de la intro (clip 0). Esto no se resuelve solo con heredar `ultimoCorteUsado`, porque entre la intro y los GRAFISMOS hay un ítem `01` (LARGO) que avanza el contador.

### Enfoque 2: Agrupar por bloque (cambio más profundo)

Agrupar las líneas por su **prefijo de bloque** (el número inicial del ID: `01`, `02`, etc.) antes de procesarlas. Para cada bloque:

1. Encontrar el clip que corresponde al bloque usando el primer ítem con `agrupacio != null`.
2. Todos los ítems del bloque (incluyendo GRAFISMOS) se colocan en ese mismo clip.
3. Los GRAFISMOS se posicionan con offset basado en su timecode relativo dentro del bloque.

**Cambios necesarios:**

1. Extraer el prefijo de bloque de cada línea (ej. de `01chy` extraer `01`, de `02dp` extraer `02`).
2. Agrupar líneas por bloque.
3. Para cada grupo:
   - Encontrar el clip para el bloque usando `snapToCut` con el primer ítem que tenga `agrupacio != null`.
   - Para los GRAFISMOS del grupo, usar el mismo `idxCorte` y calcular la posición dentro del clip como `clipStart + (lineSec - minLineSec)`.

### Enfoque 3: Asociar GRAFISMOS al bloque correcto (recomendado)

Este enfoque combina simplicidad y corrección:

1. **Identificar el bloque de cada línea** usando el prefijo numérico del ID (ej. `01i` → bloque `01`, `01chy` → bloque `01`).
2. **Mantener un mapa** de `{idBloque: idxCorte}` que se actualiza cuando se asigna un clip a un ítem con `agrupacio != null`.
3. **Para los GRAFISMOS**: en lugar de llamar a `snapToCut`, usar el `idxCorte` del mapa para su bloque. Si no existe, usar `snapToCut` (comportamiento actual).
4. **Para los no-GRAFISMOS**: comportamiento actual, pero además actualizar el mapa con `mapaBloques[bloqueId] = idxCorte`.

**Implementación:**

```javascript
// Antes del bucle
const bloqueMap = {};

// Dentro del bucle
const bloqueId = (line.num || '').replace(/[a-zA-Z].*$/, ''); // "01chy" → "01"
const categoria = clasificarItem(line);

let idxCorte;
let posicionFinal;

if (categoria === 'GRAFISMO' && bloqueMap[bloqueId] !== undefined) {
    // Heredar el clip del bloque
    idxCorte = bloqueMap[bloqueId];
    posicionFinal = clips[idxCorte].start;
} else {
    const resultado = snapToCut(idealPos, categoria, cortes, clips, ultimoCorteUsado);
    posicionFinal = resultado.corte;
    idxCorte = resultado.idx;
    if (idxCorte >= 0) {
        usedCorteIdx.add(idxCorte);
        ultimoCorteUsado = idxCorte;
        // Registrar el clip asignado a este bloque
        if (categoria !== 'GRAFISMO' && bloqueId) {
            bloqueMap[bloqueId] = idxCorte;
        }
    }
}
```

**Resultado esperado:**

| Ítem | Bloque | idxCorte | Start clip | Posición marcador |
|------|--------|----------|------------|-------------------|
| 01i  | 01     | 0        | 0.00s      | 0.00s             |
| 01   | 01     | 4        | 45.04s     | 45.04s            |
| 01chy| 01     | 0 (heredado) | 0.00s  | 0.00s (ideal 22s, pero se fuerza al clip del bloque) |
| 01gf | 01     | 0 (heredado) | 0.00s  | 0.00s (ideal 26s, pero se fuerza al clip del bloque) |
| 01te | 01     | 0 (heredado) | 0.00s  | 0.00s (ideal 30s, pero se fuerza al clip del bloque) |
| 02dp | 02     | ?        | ?         | ?                  |

Esto coloca los GRAFISMOS en el clip correcto (clip 0 = intro), pero la posición del marcador dentro del clip sería `clipStart` (0.00s) para todos, lo que no es ideal porque los GRAFISMOS deberían tener posiciones distintas dentro del mismo clip.

Para mejorar, se podría calcular la posición real del GRAFISMO dentro del clip:

```javascript
if (categoria === 'GRAFISMO' && bloqueMap[bloqueId] !== undefined) {
    idxCorte = bloqueMap[bloqueId];
    // Calcular posición offset dentro del clip
    const clipStartTime = clips[idxCorte].start;
    const offsetEnClip = idealPos; // el idealPos ya es relativo al clipStart=0
    posicionFinal = clipStartTime + Math.min(offsetEnClip, clips[idxCorte].end - clips[idxCorte].start - 0.04);
}
```

Esto colocaría `01chy` en `0.00 + 22.00 = 22.00s`, que está dentro del clip 0 (0.00-19.36s)? No, 22.00s está fuera del clip 0. El clip 0 termina en 19.36s. Esto significa que el timecode de los GRAFISMOS (21:02:05) está más allá de la duración del clip de la intro. Posiblemente los GRAFISMOS deberían colocarse al final del clip de la intro (19.36s - margin) o en una posición específica determinada por otros criterios.

## Pregunta para el usuario

¿Dónde exactamente deberían colocarse los marcadores de GRAFISMO dentro del clip de la intro? ¿Al final del clip, al principio, o en la posición que resulte de aplicar el offset de timecode (aunque esté fuera del rango)?

## Resumen del error

| Elemento | Descripción |
|----------|-------------|
| **Síntoma** | Los GRAFISMOS (`01chy`, `01gf`, `01te`) aparecen en clips 5, 6, 7 en lugar de dentro del clip de la intro (clip 0) |
| **Causa** | `snapToCut` siempre busca desde `ultimoCorteUsado + 1`, y los GRAFISMOS se tratan como ítems independientes que consumen un clip |
| **Solución propuesta** | Asociar cada línea a su bloque (por prefijo numérico del ID). Los GRAFISMOS heredan el clip asignado a su bloque y se posicionan con offset dentro de ese clip |
| **Código afectado** | [`js/workflows/flow_assembly.js:1017-1113`](../js/workflows/flow_assembly.js:1017) (función `snapToCut` y bucle principal de `placeStructureMarkers`) |
