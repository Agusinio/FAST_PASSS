# Plan de Corrección: Posicionamiento de Marcadores por Bloques

## Problemas Identificados

Tras la corrección anterior (GRAFISMOS heredan clip vía `bloqueMap`), persisten **dos problemas**:

### Problema A: El vídeo `01` aparece a 45.04s en lugar de ~18s

**Síntoma:**
```
📍 Línia 01: 21:02:01 → timeline 45.04s (LARGO, ideal 18.00s, idxCorte 4)
```

**Causa raíz:** La función [`snapToCut`](../js/workflows/flow_assembly.js:1017) itera desde `ultimoCorteUsado + 1` con un filtro `minDur=15s` para categoría LARGO:

| Paso | Clip | Start | Duración | ¿Cumple minDur=15s? |
|------|------|-------|----------|---------------------|
| 1 | Clip 0 | 0.00s | 19.36s | ✅ (pero está en índice `ultimoCorteUsado=0`, se salta) |
| 2 | Clip 1 | 19.36s | 11.60s | ❌ < 15s |
| 3 | Clip 2 | 37.92s | 7.96s | ❌ < 15s |
| 4 | Clip 3 | 47.48s | 6.12s | ❌ < 15s |
| 5 | Clip 4 | **45.04s** | 22.28s | ✅ → **asignado** |

El algoritmo nunca considera el clip 0 porque `ultimoCorteUsado = 0` (usado por `01i`), y busca desde `i = 1`. Los clips 1-3 son demasiado cortos para LARGO. Clip 4 es el primero que cumple, pero está a 45s del inicio.

**Problema de diseño:** El algoritmo asume que cada ítem consume un clip diferente y avanza secuencialmente. Pero `01` e `01i` pertenecen al mismo bloque y sus marcadores deberían estar dentro del mismo clip (clip 0).

### Problema B: Los tres GRAFISMOS tienen el mismo timestamp (19.32s)

**Síntoma:**
```
📍 Línia 01chy: 21:02:05 → timeline 19.32s (GRAFISMO, ideal 22.00s)
📍 Línia 01gf:  21:02:05 → timeline 19.32s (GRAFISMO, ideal 26.00s)
📍 Línia 01te:  21:02:05 → timeline 19.32s (GRAFISMO, ideal 30.00s)
```

**Causa raíz:** En [`js/workflows/flow_assembly.js:1090`](../js/workflows/flow_assembly.js:1090):
```javascript
posicionFinal = Math.max(clip.start, Math.min(idealPos, clip.end - 0.04));
```
| GRAFISMO | idealPos | clip.start | clip.end-0.04 | Clamp | Resultado |
|----------|----------|------------|---------------|-------|-----------|
| 01chy | 22.00s | 0.00s | 19.32s | `min(22.00, 19.32)` | **19.32s** |
| 01gf | 26.00s | 0.00s | 19.32s | `min(26.00, 19.32)` | **19.32s** |
| 01te | 30.00s | 0.00s | 19.32s | `min(30.00, 19.32)` | **19.32s** |

Los tres idealPos superan el final del clip, por lo que todos se clampan al mismo valor `clip.end - 0.04`.

## Solución Propuesta: Algoritmo de Posicionamiento por Bloques

### Principio fundamental

Los ítems se agrupan por **prefijo de bloque** (el número inicial del campo `num`, ej. `01i`→`01`, `01chy`→`01`). **Un solo clip por bloque**: el primer ítem con `agrupacio != null` determina el clip para todos los ítems del bloque.

### Pseudocódigo del nuevo algoritmo

```
BUCLE PRINCIPAL (por cada línea ordernada por timecode):
  1. Extraer bloqueId = extractBlockId(line.num)
  2. Clasificar categoría
  3. Calcular idealPos desde timecode

  4. Si bloqueId NO está en bloqueMap:
     a. Buscar clip con snapToCut para este ítem
     b. Guardar idxCorte en bloqueMap[bloqueId]
     c. Actualizar ultimoCorteUsado = idxCorte
     d. posicionFinal = resultado.corte (clip start)
  
  5. Si bloqueId SÍ está en bloqueMap:
     a. Obtener idxCorte = bloqueMap[bloqueId]
     b. Si es GRAFISMO:
        - posicionFinal = idealPos clampado a [clip.start, clip.end - 0.04]
        - Si ya hay otro GRAFISMO en la misma posición, desplazar 4s atrás
     c. Si NO es GRAFISMO:
        - posicionFinal = idealPos clampado a [clip.start, clip.end]
        - (El marcador se coloca en su posición de timecode, no en el corte)
  
  6. Colocar marcador en posicionFinal
```

### Traza del algoritmo corregido

Con los datos del usuario (clips: 0=0.00-19.36, 1=19.36-30.96, 2=37.92-45.88, 3=47.48-53.60, 4=45.04-67.32):

| Ítem | Bloque | idealPos | ¿bloqueMap? | Clip | Posición | Notas |
|------|--------|----------|-------------|------|----------|-------|
| 01i | 01 | 0.00s | No → snapToCut(0,MEDIO) | 0 (0.00s) | **0.00s** | clip 0 cumple minDur=5 |
| 01 | 01 | 18.00s | **Sí** → idxCorte=0 | 0 (0.00-19.36) | **18.00s** | clamp: 18.00 en [0,19.36] ✅ |
| 01chy | 01 | 22.00s | **Sí** → idxCorte=0 | 0 (0.00-19.36) | **19.32s** | clamp: min(22, 19.32)=19.32 |
| 01gf | 01 | 26.00s | **Sí** → idxCorte=0 | 0 (0.00-19.36) | **15.32s** | 19.32 ocupado → 19.32-4=15.32 |
| 01te | 01 | 30.00s | **Sí** → idxCorte=0 | 0 (0.00-19.36) | **11.32s** | 15.32 ocupado → 15.32-4=11.32 |

Los GRAFISMOS se distribuyen hacia atrás desde el final del clip, preservando el espaciado de 4s y manteniendo el orden inverso al de su timecode (el último GRAFISMO en la lista se coloca más atrás).

**Resultado esperado en timeline:**
```
00.00s → 01i (INTRO)
11.32s → 01te (GRAFISMO)
15.32s → 01gf (GRAFISMO)
18.00s → 01 (ACORD PP VOX)
19.32s → 01chy (GRAFISMO)
```

### Alternativa: GRAFISMOS al final del clip en orden directo

Si se prefiere mantener el orden de los GRAFISMOS (primero 01chy, luego 01gf, luego 01te):

| Ítem | Posición |
|------|----------|
| 01chy | 19.32s |
| 01gf | 15.32s |
| 01te | 11.32s |

Esto preserva el espaciado de 4s pero invierte el orden (el primer GRAFISMO en la lista se coloca al final del clip). Es la opción más predecible y se recomienda.

## Cambios Específicos en el Código

### Archivo: [`js/workflows/flow_assembly.js`](../js/workflows/flow_assembly.js)

#### Cambio 1: Modificar el bloque de posicionamiento (≈ líneas 1087-1104)

**Código actual:**
```javascript
if (categoria === 'GRAFISMO' && bloqueId && bloqueMap[bloqueId] !== undefined) {
    idxCorte = bloqueMap[bloqueId];
    const clip = clips[idxCorte];
    posicionFinal = Math.max(clip.start, Math.min(idealPos, clip.end - 0.04));
} else {
    const resultado = snapToCut(idealPos, categoria, cortes, clips, ultimoCorteUsado);
    posicionFinal = resultado.corte;
    idxCorte = resultado.idx;
    if (idxCorte >= 0) {
        usedCorteIdx.add(idxCorte);
        ultimoCorteUsado = idxCorte;
        if (categoria !== 'GRAFISMO' && bloqueId && bloqueMap[bloqueId] === undefined) {
            bloqueMap[bloqueId] = idxCorte;
        }
    }
}
```

**Nuevo código:**
```javascript
// Determinar clip para este ítem según el bloque
if (bloqueId && bloqueMap[bloqueId] !== undefined) {
    // El bloque ya tiene un clip asignado → usar ese clip
    idxCorte = bloqueMap[bloqueId];
    const clip = clips[idxCorte];
    
    if (categoria === 'GRAFISMO') {
        // GRAFISMO: posicionar dentro del clip, clamp al final
        posicionFinal = Math.max(clip.start, Math.min(idealPos, clip.end - 0.04));
    } else {
        // No-GRAFISMO: posicionar en idealPos dentro del clip
        posicionFinal = Math.max(clip.start, Math.min(idealPos, clip.end));
    }
} else {
    // El bloque NO tiene clip asignado → buscar con snapToCut
    const resultado = snapToCut(idealPos, categoria, cortes, clips, ultimoCorteUsado);
    posicionFinal = resultado.corte;
    idxCorte = resultado.idx;
    if (idxCorte >= 0) {
        usedCorteIdx.add(idxCorte);
        ultimoCorteUsado = idxCorte;
        // Registrar clip para este bloque (solo primera vez)
        if (bloqueId && bloqueMap[bloqueId] === undefined) {
            bloqueMap[bloqueId] = idxCorte;
        }
    }
}
```

#### Cambio 2: Añadir deduplicación de posiciones para GRAFISMOS

Después de calcular `posicionFinal`, añadir lógica para evitar que dos GRAFISMOS ocupen la misma posición:

```javascript
// --- DEDUPLICACIÓN: evitar GRAFISMOS en la misma posición ---
if (categoria === 'GRAFISMO' && idxCorte >= 0) {
    const clip = clips[idxCorte];
    // Buscar si ya hay un marcador colocado en esta posición exacta (con 0.5s de tolerancia)
    let intentos = 0;
    while (intentos < 10 && placedMarkers.some(p => Math.abs(p - posicionFinal) < 0.5)) {
        // Desplazar 4s hacia atrás (separación estándar para GRAFISMOS)
        posicionFinal -= 4;
        // No permitir que quede antes del inicio del clip
        if (posicionFinal < clip.start) {
            // Si no hay espacio, comprimir al inicio
            posicionFinal = clip.start;
            break;
        }
        intentos++;
    }
    posicionFinal = Math.max(clip.start, posicionFinal);
}
```

Esta lógica se coloca **después** del cálculo de `posicionFinal` y **antes** de marcar como usado. Requiere que `placedMarkers` esté actualizado con las posiciones ya colocadas (se actualiza al final del bucle).

#### Cambio 3: Mantener seguimiento de posiciones ocupadas

La variable `placedMarkers` (línea 1056) ya acumula las posiciones de todos los marcadores colocados. Se usa directamente en la deduplicación.

### Ejemplo de aplicación del código corregido

```
Items del bloque "01" (ordenados por timecode):

Ítem 01i: bloqueMap["01"]=undefined → snapToCut(0, MEDIO) → clip 0, start=0.00s
  → bloqueMap["01"] = 0
  → placedMarkers = [0.00]

Ítem 01: bloqueMap["01"]=0 (existe) → idxCorte=0, clip.start=0.00, clip.end=19.36
  → posicionFinal = max(0, min(18.00, 19.36)) = 18.00s
  → No es GRAFISMO, no hay deduplicación
  → placedMarkers = [0.00, 18.00]

Ítem 01chy: bloqueMap["01"]=0 → idxCorte=0
  → posicionFinal = max(0, min(22.00, 19.36-0.04)) = 19.32s
  → ¿Algún marcador en 19.32±0.5? No (18.00 y 0.00)
  → placedMarkers = [0.00, 18.00, 19.32]

Ítem 01gf: bloqueMap["01"]=0 → idxCorte=0
  → posicionFinal = max(0, min(26.00, 19.32)) = 19.32s
  → ¿Algún marcador en 19.32±0.5? Sí (01chy en 19.32)
  → Desplazar: 19.32 - 4 = 15.32s
  → ¿Algún marcador en 15.32±0.5? No (18.00 y 19.32, 15.32 está libre)
  → placedMarkers = [0.00, 18.00, 19.32, 15.32]

Ítem 01te: bloqueMap["01"]=0 → idxCorte=0
  → posicionFinal = max(0, min(30.00, 19.32)) = 19.32s
  → Desplazar: 19.32 - 4 = 15.32s → ocupado por 01gf
  → Desplazar: 15.32 - 4 = 11.32s → libre
  → placedMarkers = [0.00, 18.00, 19.32, 15.32, 11.32]
```

## Orden de los Cambios

1. **Modificar la lógica de posicionamiento** (Cambio 1): Reemplazar el bloque `if/else` existente por la nueva lógica basada en `bloqueMap`.
2. **Añadir deduplicación** (Cambio 2): Insertar el bloque de deduplicación después del cálculo de `posicionFinal`.
3. **Verificar que `placedMarkers` se actualiza** correctamente (ya está en la línea 1130).

## Riesgos y Consideraciones

1. **GRAFISMOS que se solapan con ítems no-GRAFISMO**: Si un GRAFISMO se desplaza hacia atrás y ocupa la posición de un ítem no-GRAFISMO (ej. 01 en 18.00s), la deduplicación detectará la colisión y seguirá desplazando. En el ejemplo, 01gf se desplaza de 19.32→15.32, que no colisiona con 01 (18.00s).

2. **GRAFISMOS sin espacio suficiente**: Si hay muchos GRAFISMOS y poco espacio en el clip, la deduplicación llegará a `clip.start` y se detendrá. En ese punto, varios GRAFISMOS compartirían la misma posición (al inicio del clip). Esto es un caso límite aceptable dado que es mejor que todos al final.

3. **Bloques sin ítems con `agrupacio != null`**: Si un bloque solo contiene GRAFISMOS (sin intro ni video principal), `bloqueMap[bloqueId]` nunca se asigna y los GRAFISMOS se procesarían como antes (con snapToCut). Esto mantiene la compatibilidad hacia atrás.

4. **ultimoCorteUsado solo se actualiza cuando se asigna un nuevo clip**: Con la nueva lógica, `ultimoCorteUsado` solo se actualiza cuando `bloqueMap[bloqueId] === undefined` (es decir, cuando se asigna un clip nuevo a un bloque). Esto evita que los GRAFISMOS avancen el contador.

## Resultado Final Esperado

```
📋 MARCADORS A TIMELINE:
   Marcador 0: 21:01:43 | "01i - INTRO PP..." | color=AZUL
   Marcador 1: 21:02:01 | "01 - ACORD PP VOX..." | color=AZUL
   Marcador 2: 21:02:05 | "01chy - CHYRON..." | color=AMARILLO
   Marcador 3: 21:02:05 | "01gf - GF..." | color=AMARILLO
   Marcador 4: 21:02:05 | "01te - TE..." | color=AMARILLO
```

Posiciones en timeline:
| Marcador | Timecode | Posición timeline | Clip |
|----------|----------|-------------------|------|
| 01i | 21:01:43 | **0.00s** | Clip 0 (0.00-19.36) |
| 01 | 21:02:01 | **18.00s** | Clip 0 ← **corregido, antes 45.04s** |
| 01chy | 21:02:05 | **19.32s** | Clip 0 ← **corregido, antes 67.32s** |
| 01gf | 21:02:05 | **15.32s** | Clip 0 ← **corregido, antes 71.44s** |
| 01te | 21:02:05 | **11.32s** | Clip 0 ← **corregido, antes 73.96s** |

Todos los marcadores del bloque `01` están dentro del clip 0, ordenados por posición de timecode. Los GRAFISMOS se distribuyen desde el final del clip hacia atrás con espaciado de 4s.
