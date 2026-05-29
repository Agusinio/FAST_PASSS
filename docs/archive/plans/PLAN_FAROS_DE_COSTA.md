# Plan "Faros de Costa" — Rediseño del Algoritmo de Colocación de Marcadores

## Resumen Ejecutivo

El algoritmo actual `placeStructureMarkers` falla porque `snapToCut` es **estocástico** — cada llamada es independiente y no sabe qué cortes ya han sido ocupados por otros marcadores. Esto produce múltiples marcadores en la misma posición (55.12s) y coloca items con OnAir válido (INSERTs) en posiciones incorrectas.

**Solución**: Algoritmo de 4 fases ordenadas por precedencia. Los items con `horaEntradaOnAir` actúan como **faros** (anclas inamovibles de alta precisión). Los items sin OnAir se **aproximan** entre los faros usando topología. Separación mínima de **3 segundos** entre cualquier par de marcadores.

## Arquitectura del Algoritmo

```
┌──────────────────────────────────────────────────────────────┐
│                 placeStructureMarkers()                       │
├──────────────────────────────────────────────────────────────┤
│  1. Clasificar items estructurales:                          │
│     ├── FAROS:     horaEntradaOnAir ≠ null, ≠ "00:00:00"    │
│     └── APROXIMADOS: horaEntradaOnAir = null o "00:00:00"   │
│                                                              │
│  2. FASE 1 — COLOCAR FAROS (snap simple, sin topología)     │
│     ▸ Para cada faro, por orden cronológico:                 │
│       - Calcular idealPosSec con fórmula OnAir              │
│       - Buscar el corte más cercano (±10s) NO ocupado       │
│       - Si ninguno, REGLA CERO: corte más cercano global    │
│       - Marcar corte como OCUPADO, registrar tiempo         │
│                                                              │
│  3. FASE 2 — COLOCAR APROXIMADOS (topología entre faros)    │
│     ▸ Para cada aproximado, por orden cronológico:           │
│       - Calcular idealPosSec con horaEntradaPrevista        │
│       - Limitar búsqueda entre faros anterior y siguiente   │
│       - Topological scoring SOLO dentro de ese rango        │
│       - Excluir cortes ocupados y a <3s de marcadores       │
│       - Si no hay candidato, REGLA CERO dentro del rango    │
│                                                              │
│  4. FASE 3 — COLOCAR IPDs (dentro del padre, cortes libres) │
│     ▸ Respetar ≥3s de cualquier marcador                    │
│                                                              │
│  5. FASE 4 — COLOCAR GRÁFICOS (dentro del padre)            │
│     ▸ Respetar ≥3s de cualquier marcador                    │
│                                                              │
│  6. VERIFICACIÓN BIDIRECCIONAL (diagnóstico)                │
└──────────────────────────────────────────────────────────────┘
```

---

## Cambios por Archivo

### ARCHIVO 1: `js/logic/14_Assembly_Logic.js`

#### Fix 30: DP+DIR detector — Sandwich bilateral obligatorio

**Archivo**: `js/logic/14_Assembly_Logic.js`
**Líneas**: 436-453 (función `calcDensityFootprintV2`, bloque SENYAL D)

**Problema**: La condición actual permite `prevIsShort || nextIsShort`, lo que da falsos positivos cuando el clip #0 (apertura del bloque) es largo y el clip #1 también lo es — `i===0` fuerza `prevIsShort=true`.

**Cambio**: Cambiar `||` por `&&` en la línea 445:
```javascript
// ANTES (línea 445):
if (prevIsShort || nextIsShort) {

// DESPUÉS:
if (prevIsShort && nextIsShort) {
```

Esto exige que AMBOS lados del par de clips largos estén rodeados por clips cortos, eliminando el falso positivo en la apertura del bloque.

---

### ARCHIVO 2: `js/workflows/flow_assembly.js`

Este archivo contiene TODOS los demás cambios. Se describen por orden de implementación.

---

#### Fix 25: Añadir estructuras de tracking de cortes ocupados

**Ubicación**: Reemplazar el bloque en líneas 995-1009 (preparación de clipCuts y variables de tracking)

**Contexto actual**:
```javascript
const clipCuts = clips.map(c => c.start);
let lastUsedClipCut = -1;

const extractBlockId = (num) => { ... };

// Acumular posiciones de marcadores colocados
const placedMarkers = [];
// Arrays separados para tracking de cada tipo de marcador
const placedGraphicMarkers = [];
const placedIpdMarkers = [];
```

**Cambio**: Añadir `occupiedCutIndices` (Set) y `occupiedTimes` (Array):
```javascript
const clipCuts = clips.map(c => c.start);

// ─── TRACKING DE CORTES OCUPADOS (Fix 25) ───
// occupiedCutIndices: índices de clip YA OCUPADOS por un marcador colocado
// occupiedTimes: tiempos exactos de todos los marcadores (para check de 3s)
const occupiedCutIndices = new Set();
const occupiedTimes = [];

const extractBlockId = (num) => { ... };

// Acumular posiciones de marcadores colocados
const placedMarkers = [];
const placedGraphicMarkers = [];
const placedIpdMarkers = [];
```

---

#### Fix 26: Helper de verificación de separación mínima (3s)

**Ubicación**: Nueva función auxiliar, insertar después del bloque de tracking (después de línea 1009)

**Código nuevo**:
```javascript
// ─── HELPER: Verificar separación mínima de 3s (Fix 26) ───
const MIN_MARKER_SEPARATION_SEC = 3.0;

/**
 * Verifica si una posición candidate cumple la separación mínima
 * de MIN_MARKER_SEPARATION_SEC respecto a TODOS los marcadores ya colocados.
 * @param {number} candidateSec - Posición candidata en segundos
 * @param {number[]} occupiedTimes - Array de tiempos ya ocupados
 * @returns {boolean} true si hay al menos MIN_MARKER_SEPARATION_SEC de separación
 */
const hasMinSeparation = (candidateSec, occupiedTimes) => {
    for (let i = 0; i < occupiedTimes.length; i++) {
        if (Math.abs(candidateSec - occupiedTimes[i]) < MIN_MARKER_SEPARATION_SEC) {
            return false;
        }
    }
    return true;
};
```

---

#### Fix 27: Clasificar items estructurales en Faros y Aproximados

**Ubicación**: Modificar el bloque de clasificación en líneas 1011-1034, después de la clasificación en `structuralItems`/`ipdItems`/`graphicItems`

**Contexto actual** (líneas 1019-1034):
```javascript
const structuralItems = [];
const ipdItems = [];
const graphicItems = [];
for (const line of lines) {
    const horaRef = line.horaEntradaOnAir || line.horaEntradaPrevista;
    if (!horaRef || horaRef === "00:00:00") continue;
    const dSec = getRawDuradaSec(line);
    if (dSec > 0) {
        structuralItems.push(line);
    } else if (line.agrupacio && line.duradaOnAir) {
        ipdItems.push(line);
    } else {
        graphicItems.push(line);
    }
}
log(`📋 Items: ${structuralItems.length} estructurals, ...`);
```

**Cambio**: Después de la clasificación existente, añadir la sub-clasificación de `structuralItems` en faros y aproximados:
```javascript
// ─── CLASSIFICACIÓ EN FAROS I APROXIMATS (Fix 27) ───
// FAROS: items amb horaEntradaOnAir vàlida (INSERTs, INTRO, etc.)
//        Són "fars de costa" perquè el seu TC d'emissió és pràcticament exacte.
// APROXIMATS: items SENSE horaEntradaOnAir (DP, DIR, etc.)
//        La seva horaEntradaPrevista és una estimació; es col·loquen entre faros.
const farosItems = [];
const aproximadosItems = [];
for (const item of structuralItems) {
    const onAir = item.horaEntradaOnAir;
    if (onAir && onAir !== '00:00:00' && onAir.trim() !== '') {
        farosItems.push(item);
    } else {
        aproximadosItems.push(item);
    }
}
log(`📍 Faros: ${farosItems.length} (${farosItems.map(l => l.num).join(', ')})`);
log(`📍 Aproximats: ${aproximadosItems.length} (${aproximadosItems.map(l => l.num).join(', ')})`);

// Mapa de posiciones colocadas: num del item → posición en timeline
const itemPositions = new Map(); // clave: line.num, valor: snappedPosSec
```

---

#### Fix 28: Nueva función snapToCutFaro — Snap simple para faros

**Ubicación**: Insertar después del helper `hasMinSeparation` (Fix 26), antes del bucle de faros

**Código nuevo**:
```javascript
// ─── SNAP SIMPLE PER A FAROS (Fix 28) ───
// Els faros tenen horaEntradaOnAir exacta, no necessiten scoring topològic.
// Simplement busquem el tall més proper dins de ±10s que:
//   1. No estigui ocupat (occupiedCutIndices)
//   2. Tingui ≥3s de separació de qualsevol marcador existent
//   3. Pertanyi a un clip de durada >= minClipDur
const snapToCutFaro = (idealPosSec, categoria, clipCuts, clips, occupiedCutIndices, occupiedTimes) => {
    const minClipDurs = { LARGO: 0, MEDIO: 5, CORTO: 0, GRAFISMO: 0, NO_VERTICALIZABLE: 0 };
    const minClipDur = minClipDurs[categoria] || 0;
    
    // FASE 1: Buscar el corte más cercano en ±10s que cumpla restricciones
    let mejorCorte = null;
    let mejorIdx = -1;
    let menorDistancia = 10.0;
    
    for (let i = 0; i < clipCuts.length; i++) {
        // Saltar cortes ya ocupados
        if (occupiedCutIndices.has(i)) continue;
        
        const dur = clips[i].end - clips[i].start;
        if (dur < 1.0 && categoria !== 'GRAFISMO' && categoria !== 'CORTO') continue;
        if (dur < minClipDur) continue;
        
        // Verificar separación mínima de 3s
        if (!hasMinSeparation(clipCuts[i], occupiedTimes)) continue;
        
        const dist = Math.abs(clipCuts[i] - idealPosSec);
        if (dist < menorDistancia) {
            menorDistancia = dist;
            mejorCorte = clipCuts[i];
            mejorIdx = i;
        }
    }
    
    if (mejorIdx >= 0) {
        return { corte: mejorCorte, idx: mejorIdx };
    }
    
    // FASE 2: REGLA CERO — Si no hay corte en ±10s que cumpla restricciones,
    // buscar el corte NO OCUPADO más cercano globalmente (sin límite de distancia)
    let corteGlobal = null;
    let idxGlobal = -1;
    let minGlobal = Infinity;
    for (let i = 0; i < clipCuts.length; i++) {
        if (occupiedCutIndices.has(i)) continue;
        const dur = clips[i].end - clips[i].start;
        if (dur < 1.0 && categoria !== 'GRAFISMO' && categoria !== 'CORTO') continue;
        if (dur < minClipDur) continue;
        if (!hasMinSeparation(clipCuts[i], occupiedTimes)) continue;
        const dist = Math.abs(clipCuts[i] - idealPosSec);
        if (dist < minGlobal) {
            minGlobal = dist;
            corteGlobal = clipCuts[i];
            idxGlobal = i;
        }
    }
    
    if (idxGlobal >= 0) {
        log(`   ⚠️ [FARO-CERO] Sense tall a ±10s de ${idealPosSec.toFixed(2)}s → ` +
            `tall més proper: ${corteGlobal.toFixed(2)}s (Δ=${minGlobal.toFixed(2)}s)`);
        return { corte: corteGlobal, idx: idxGlobal };
    }
    
    // Si absolutamente ningún corte cumple (extremo raro), REGLA CERO pura
    log(`   ⚠️ [FARO-CERO-FALLBACK] Sense cap tall disponible → tornant ideal ${idealPosSec.toFixed(2)}s`);
    return { corte: idealPosSec, idx: -1 };
};
```

---

#### Fix 29: Fase 2 — snapToCut para Aproximados con rango limitado por faros

**Ubicación**: Modificar la función `snapToCut` existente (líneas 903-993) para añadir parámetros `occupiedCutIndices`, `occupiedTimes`, y opcionalmente `rangeMin`/`rangeMax`

**Cambio en la firma** (línea 903):
```javascript
// ANTES:
const snapToCut = (additPosSec, categoria, clipCuts, clips, lastUsedClipCut, densityData) => {

// DESPUÉS:
const snapToCut = (additPosSec, categoria, clipCuts, clips, densityData, occupiedCutIndices, occupiedTimes, rangeMin, rangeMax) => {
```

**Cambio en Fase 1 (scoring topológico)**: Añadir filtros de ocupación y rango
```javascript
// Dentro del bucle for (const brk of densityData.breaks) — línea 917:
for (const brk of densityData.breaks) {
    // ─── FILTROS DE OCUPACIÓN Y RANGO (Fix 29) ───
    // Saltar cortes ya ocupados por otros marcadores
    if (occupiedCutIndices && occupiedCutIndices.has(brk.clipIdx)) continue;
    // Saltar cortes fuera del rango entre faros
    if (rangeMin !== undefined && brk.time < rangeMin) continue;
    if (rangeMax !== undefined && brk.time > rangeMax) continue;
    // Verificar separación mínima de 3s
    if (occupiedTimes && !hasMinSeparation(brk.time, occupiedTimes)) continue;
    
    const dist = Math.abs(brk.time - additPosSec);
    // ... (resto del scoring igual)
```

**Cambio en Fase 2 (búsqueda bilateral)**: Añadir los mismos filtros
```javascript
// Dentro del bucle for (let i = 0; i < clipCuts.length; i++) — línea 955:
for (let i = 0; i < clipCuts.length; i++) {
    // ─── FILTROS DE OCUPACIÓN Y RANGO (Fix 29) ───
    if (occupiedCutIndices && occupiedCutIndices.has(i)) continue;
    if (rangeMin !== undefined && clipCuts[i] < rangeMin) continue;
    if (rangeMax !== undefined && clipCuts[i] > rangeMax) continue;
    if (occupiedTimes && !hasMinSeparation(clipCuts[i], occupiedTimes)) continue;
    
    const dur = clips[i].end - clips[i].start;
    // ... (resto igual)
```

**Cambio en Fase 3 (REGLA CERO)**: Añadir los mismos filtros
```javascript
// Dentro del bucle for (let i = 0; i < clipCuts.length; i++) — línea 979:
for (let i = 0; i < clipCuts.length; i++) {
    // ─── FILTROS DE OCUPACIÓN Y RANGO (Fix 29) ───
    if (occupiedCutIndices && occupiedCutIndices.has(i)) continue;
    if (rangeMin !== undefined && clipCuts[i] < rangeMin) continue;
    if (rangeMax !== undefined && clipCuts[i] > rangeMax) continue;
    if (occupiedTimes && !hasMinSeparation(clipCuts[i], occupiedTimes)) continue;
    
    const dur = clips[i].end - clips[i].start;
    // ... (resto igual)
```

---

#### Reescritura del bucle principal de colocación (líneas 1056-1098)

**Cambio**: Reemplazar completamente el bucle `for (const line of structuralItems)` con dos bucles separados:

**NUEVO BLOQUE — FASE 1: COLOCAR FAROS** (reemplaza líneas 1056-1098):
```javascript
// ============================================================
// FASE 1: COLOCAR FAROS (Items con horaEntradaOnAir exacta)
// ============================================================
// Los faros son anclas inamovibles. Se colocan PRIMERO porque
// su horaEntradaOnAir es prácticamente exacta (viene del reloj
// de emisión real). Snap simple al corte más cercano.
// ============================================================
log(`📍 [FAROS] Col·locant ${farosItems.length} faros...`);

for (const line of farosItems) {
    const categoria = clasificarItem(line);
    
    const itemOnAirSec = reader.tcToSeconds(line.horaEntradaOnAir);
    if (itemOnAirSec === null || itemOnAirSec === 0) {
        log(`⚠️ [FARO] ${line.num || '?'}: sense hora d'entrada vàlida → saltat`);
        continue;
    }
    const idealPosSec = tlClipStartSec + (itemOnAirSec - anchorOnAirSec);
    
    // Snap simple (sin scoring topológico, el OnAir es exacto)
    const resultado = snapToCutFaro(idealPosSec, categoria, clipCuts, clips, occupiedCutIndices, occupiedTimes);
    const snappedPosSec = resultado.corte;
    const deltaSnap = snappedPosSec - idealPosSec;
    
    // Registrar corte como OCUPADO
    if (resultado.idx >= 0) {
        occupiedCutIndices.add(resultado.idx);
    }
    occupiedTimes.push(snappedPosSec);
    
    const safeT = snappedPosSec.toFixed(2);
    const num = line.num || '';
    const titol = (line.titol || '').replace(/'/g, "\\'").substring(0, 60);
    const comment = `${num ? num + ' - ' : ''}${titol}`.trim();
    
    log(`🔵 [FARO] ${num}: OnAir=${line.horaEntradaOnAir} → ideal=${idealPosSec.toFixed(2)}s → timeline ${safeT}s (Δ=${deltaSnap.toFixed(2)}s, ${categoria})`);
    
    if (comment) {
        const colorIdx = line.agrupacio ? 6 : 1;
        const script = `Markers.set(${safeT}, '${comment}', 'color=${colorIdx}')`;
        await callJSX(script);
        placedMarkers.push(parseFloat(safeT));
    }
    
    // Guardar posición para acceso por IPDs y gráficos
    itemPositions.set(line.num, snappedPosSec);
}

log(`✅ [FAROS] ${farosItems.length} faros col·locats. Ocupats: ${occupiedCutIndices.size} talls.`);
```

**NUEVO BLOQUE — FASE 2: COLOCAR APROXIMADOS** (a continuación):
```javascript
// ============================================================
// FASE 2: COLOCAR APROXIMADOS (DP, DIR — sin OnAir exacto)
// ============================================================
// Los aproximados no tienen horaEntradaOnAir fiable; usan
// horaEntradaPrevista como estimación. Se colocan ENTRE los
// faros ya posicionados, usando topología para encontrar la
// ruptura de densidad más probable dentro de ese rango.
// ============================================================
log(`📍 [APROXIMATS] Col·locant ${aproximadosItems.length} aproximats entre faros...`);

// Construir lista ordenada de faros con sus posiciones para
// determinar los rangos de búsqueda de cada aproximado
const farosOrdenados = farosItems.map(line => ({
    num: line.num,
    itemOnAirSec: reader.tcToSeconds(line.horaEntradaOnAir),
    idealPosSec: tlClipStartSec + (reader.tcToSeconds(line.horaEntradaOnAir) - anchorOnAirSec),
    snappedPosSec: itemPositions.get(line.num)
})).sort((a, b) => a.idealPosSec - b.idealPosSec);

for (const line of aproximadosItems) {
    const categoria = clasificarItem(line);
    
    const itemPrevistaSec = reader.tcToSeconds(line.horaEntradaPrevista);
    if (itemPrevistaSec === null || itemPrevistaSec === 0) {
        log(`⚠️ [APROX] ${line.num || '?'}: sense hora prevista vàlida → saltat`);
        continue;
    }
    const idealPosSec = tlClipStartSec + (itemPrevistaSec - anchorOnAirSec);
    
    // ── Determinar rango entre faros ──
    // Buscar el faro anterior y siguiente más cercanos
    let rangeMin = -Infinity;
    let rangeMax = Infinity;
    
    for (const faro of farosOrdenados) {
        if (faro.snappedPosSec < idealPosSec) {
            rangeMin = Math.max(rangeMin, faro.snappedPosSec);
        }
        if (faro.snappedPosSec > idealPosSec) {
            rangeMax = Math.min(rangeMax, faro.snappedPosSec);
            break;
        }
    }
    
    // Si no hay faro anterior, rangeMin = inicio del timeline (primer clip)
    if (rangeMin === -Infinity) {
        rangeMin = clipCuts.length > 0 ? clipCuts[0] : 0;
    }
    // Si no hay faro posterior, rangeMax = final del timeline (último clip)
    if (rangeMax === Infinity) {
        rangeMax = clipCuts.length > 0 ? clipCuts[clipCuts.length - 1] : 0;
    }
    
    log(`   📐 [APROX] ${line.num}: rang entre faros [${rangeMin.toFixed(2)}s, ${rangeMax.toFixed(2)}s]`);
    
    // Aplicar snapToCut topológico DENTRO del rango entre faros
    const resultado = snapToCut(
        idealPosSec, categoria, clipCuts, clips, densityData,
        occupiedCutIndices, occupiedTimes,
        rangeMin, rangeMax
    );
    const snappedPosSec = resultado.corte;
    const deltaSnap = snappedPosSec - idealPosSec;
    
    // Registrar corte como OCUPADO
    if (resultado.idx >= 0) {
        occupiedCutIndices.add(resultado.idx);
    }
    occupiedTimes.push(snappedPosSec);
    
    const safeT = snappedPosSec.toFixed(2);
    const num = line.num || '';
    const titol = (line.titol || '').replace(/'/g, "\\'").substring(0, 60);
    const comment = `${num ? num + ' - ' : ''}${titol}`.trim();
    
    log(`🟡 [APROX] ${num}: Prev=${line.horaEntradaPrevista || '—'} → ideal=${idealPosSec.toFixed(2)}s → timeline ${safeT}s (Δ=${deltaSnap.toFixed(2)}s, ${categoria})`);
    
    if (comment) {
        const colorIdx = line.agrupacio ? 6 : 1;
        const script = `Markers.set(${safeT}, '${comment}', 'color=${colorIdx}')`;
        await callJSX(script);
        placedMarkers.push(parseFloat(safeT));
    }
    
    // Guardar posición
    itemPositions.set(line.num, snappedPosSec);
}

log(`✅ [APROXIMATS] ${aproximadosItems.length} aproximats col·locats. Ocupats: ${occupiedCutIndices.size} talls.`);
```

---

#### Fix 31: IPDs y Gráficos con respeto a cortes ocupados

**Ubicación — IPDs**: Modificar el bucle de IPDs (líneas 1128-1169)

En la llamada a `snapToCut` (línea 1148), añadir `occupiedCutIndices` y `occupiedTimes`:
```javascript
// ANTES (línea 1148):
const resultado = snapToCut(parentPos, 'CORTO', clipCuts, clips, parentCorteIdx, densityData);

// DESPUÉS:
const resultado = snapToCut(parentPos, 'CORTO', clipCuts, clips, densityData, occupiedCutIndices, occupiedTimes);
```

Y después de obtener `snappedPosSec`, registrar el corte como ocupado:
```javascript
// Después de línea 1154 (snappedPosSec = Math.max(snappedPosSec, parentPos)):
// ─── Registrar ocupación (Fix 31) ───
if (resultado.idx >= 0) {
    occupiedCutIndices.add(resultado.idx);
}
occupiedTimes.push(snappedPosSec);
```

**Ubicación — Gráficos**: Añadir verificación de separación mínima en el bucle de gráficos (líneas 1258-1272)

Después de calcular `snappedPosSec` (línea 1260), añadir:
```javascript
// ─── Verificar separación mínima para gráficos (Fix 31) ───
// Los gráficos no van sobre cortes (van en posiciones calculadas),
// pero deben respetar ≥3s de cualquier marcador existente.
if (!hasMinSeparation(snappedPosSec, occupiedTimes)) {
    // Intentar desplazar ligeramente dentro del rango disponible
    let adjustedPos = snappedPosSec;
    // Buscar hacia adelante
    for (let offset = 0.5; offset <= 5.0; offset += 0.5) {
        const fwd = snappedPosSec + offset;
        if (fwd < limit && hasMinSeparation(fwd, occupiedTimes)) {
            adjustedPos = fwd;
            break;
        }
        const bwd = snappedPosSec - offset;
        if (bwd > marginStart && hasMinSeparation(bwd, occupiedTimes)) {
            adjustedPos = bwd;
            break;
        }
    }
    if (adjustedPos !== snappedPosSec) {
        log(`   ⚠️ [GRÀFIC] ${num}: ajustat de ${snappedPosSec.toFixed(2)}s a ${adjustedPos.toFixed(2)}s per separació ≥3s`);
    }
    snappedPosSec = adjustedPos;
}

// Registrar en occupiedTimes (los gráficos no ocupan clipCuts, pero sí tiempos)
occupiedTimes.push(snappedPosSec);
```

---

#### Fix 32: BIDIR correctivo

**Ubicación**: Modificar el bloque BIDIR (líneas 1281-1363)

**Cambio**: Añadir preferencia por la dirección L→R cuando hay divergencia >3s (porque los faros se colocaron L→R primero):
```javascript
// ANTES (líneas 1351-1352):
if (deltaBidir > 3.0) {
    log(`⚠️ [BIDIR] Divergència ${cNum}: L→R=${lrPos.toFixed(2)}s R→L=${rlPos.toFixed(2)}s (Δ=${deltaBidir.toFixed(2)}s)`, "WARN");

// DESPUÉS:
if (deltaBidir > 3.0) {
    // Fix 32: Con el algoritmo Faros de Costa, la dirección L→R es más fiable
    // porque los faros se colocaron primero en ese orden. Si hay divergencia,
    // preferimos L→R y lo marcamos para revisión manual.
    log(`⚠️ [BIDIR] Divergència ${cNum}: L→R=${lrPos.toFixed(2)}s R→L=${rlPos.toFixed(2)}s (Δ=${deltaBidir.toFixed(2)}s) → Es prefereix L→R (faros)`, "WARN");
```

---

### Resumen de la Reescritura del Bucle Principal

El bloque de líneas 1056-1098 actualmente es:
```
for (const line of structuralItems) {
    // Calcular idealPosSec con OnAir/Prevista
    // snapToCut(idealPosSec, ...)
    // Colocar marcador
}
```

Se reemplaza completamente por:
```
1. CLASIFICACIÓN: structuralItems → farosItems + aproximadosItems
2. BUCLE FAROS:     for (line of farosItems)      { snapToCutFaro(...) }
3. BUCLE APROXIMADOS: for (line of aproximadosItems) { snapToCut(..., rangeMin, rangeMax) }
```

---

## Mapa de Cambios por Archivo (Resumen)

| Fix | Archivo | Tipo | Descripción |
|-----|---------|------|-------------|
| 25 | `flow_assembly.js:995-1009` | AÑADIR | `occupiedCutIndices` (Set) + `occupiedTimes` (Array) |
| 26 | `flow_assembly.js:después de 1009` | AÑADIR | `hasMinSeparation()` helper (3s) |
| 27 | `flow_assembly.js:1034+` | AÑADIR | Clasificación farosItems vs aproximadosItems |
| 28 | `flow_assembly.js:antes del bucle faros` | AÑADIR | `snapToCutFaro()` — snap simple sin topología |
| 29 | `flow_assembly.js:903-993` | MODIFICAR | `snapToCut()` — añadir filtros de ocupación + rango |
| 30 | `14_Assembly_Logic.js:445` | MODIFICAR | `\|\|` → `&&` en DP+DIR detector |
| 31a | `flow_assembly.js:1148` | MODIFICAR | IPDs: pasar occupied params a snapToCut |
| 31b | `flow_assembly.js:1260+` | AÑADIR | Gráficos: verificación separación 3s |
| 32 | `flow_assembly.js:1351` | MODIFICAR | BIDIR: preferencia L→R sobre R→L |
| — | `flow_assembly.js:1056-1098` | REEMPLAZAR | Bucle principal → Faros + Aproximados |

---

## Orden de Implementación

1. **Fix 30** (`14_Assembly_Logic.js`) — El más simple y aislado
2. **Fix 25** (`flow_assembly.js`) — Estructuras de tracking
3. **Fix 26** (`flow_assembly.js`) — Helper `hasMinSeparation`
4. **Fix 28** (`flow_assembly.js`) — `snapToCutFaro`
5. **Fix 29** (`flow_assembly.js`) — Modificar `snapToCut` existente
6. **Fix 27** + **Reescritura del bucle** (`flow_assembly.js`) — Clasificación faros/aproximados + bucles
7. **Fix 31a** + **Fix 31b** (`flow_assembly.js`) — IPDs y Gráficos
8. **Fix 32** (`flow_assembly.js`) — BIDIR

---

## Verificación Post-Implementación

### Check manual tras ejecutar `placeStructureMarkers`:

1. **Cada marcador en un corte único**: `occupiedCutIndices.size` debe ser igual al número de marcadores estructurales (si hay suficientes cortes). Ningún par de marcadores debe compartir el mismo clipIdx.

2. **Separación ≥3s**: Para cada par de marcadores `(i, j)` con `i ≠ j`, `Math.abs(markers[i].time - markers[j].time) >= 3.0`.

3. **Faros primero**: Los faros (items con OnAir) deben aparecer en el log ANTES que los aproximados.

4. **Aproximados entre faros**: Cada aproximado debe tener `rangeMin <= snappedPosSec <= rangeMax`.

5. **Sin falsos positivos DP+DIR**: El clip #0 (primer clip del timeline) NUNCA debe ser detectado como parte de un par DP+DIR.
