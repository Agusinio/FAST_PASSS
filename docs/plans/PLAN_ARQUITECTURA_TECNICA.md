# Plan: Arquitectura Técnica — Fixes Estructurales y Sesiones de Debugging

> **Versión:** 1.0  
> **Fecha:** 2026-05-15  
> **Archivos involucrados:** [`flow_assembly.js`](../../js/workflows/flow_assembly.js), [`flow_mainButton.js`](../../js/workflows/flow_mainButton.js), [`utils.js`](../../js/core/utils.js), [`4_Context.js`](../../js/core/4_Context.js)

---

## 1. Propósito

Este documento consolida el **contexto de cambios estructurales** (no algorítmicos) realizados durante el desarrollo de la extensión FAST PASS. Estos cambios incluyen:

- Correcciones de **Temporal Dead Zone (TDZ)** en JavaScript
- Correcciones de **fecha de directorio** (`dateDir`)
- Estructura de archivos y dependencias entre módulos
- Lecciones aprendidas en sesiones de debugging

Para el **algoritmo de colocación de marcadores**, consultar [`PLAN_FASES_MARCADORES.md`](PLAN_FASES_MARCADORES.md).

---

## 2. Mapa de Archivos

### 2.1 Arquitectura de 5 Capas

| Capa | Ubicación | Responsabilidad |
|------|-----------|-----------------|
| **1. WORKFLOW** | [`js/workflows/`](../../js/workflows/) | Orquestración de flujos (MainButton, Assembly, Cut, KF, Render, Retols, Srt) |
| **2. ACTION LOGIC** | [`js/logic/`](../../js/logic/) | Ejecución de operaciones (Assembly, Analysis, Clips, Tracks, FFmpeg, NNews) |
| **3. INSPECTORS** | [`js/inspectors/`](../../js/inspectors/) | Descubrimiento de datos (SourceAssets, App, Session) |
| **4. CORE** | [`js/core/`](../../js/core/) | Fundamentos: Context, State, Config, Utils, Logger, EscaletaReader, SessionManifest |
| **5. SYSTEM (JSX)** | [`jsx/`](../../jsx/) | Puente con Premiere Pro: System, IO, Project, Tracks, Clips, KF, Markers, Render, Timeline |

### 2.2 Archivos Clave Modificados

| Archivo | Línea(s) | Cambio | Fecha |
|---------|----------|--------|-------|
| [`flow_assembly.js`](../../js/workflows/flow_assembly.js) | 1208 | `structuralItemPositions` inicializado antes de Fase 0 | 2026-05-15 |
| [`flow_assembly.js`](../../js/workflows/flow_assembly.js) | 1467-1468 | `tlClipStartSec` y `anchorOnAirSec` movidos antes de Fase 0 | 2026-05-15 |
| [`flow_mainButton.js`](../../js/workflows/flow_mainButton.js) | 84-100 | Corrección `dateDir` con fecha de escaleta | 2026-05-15 |

---

## 3. Fix 1: Temporal Dead Zone (TDZ) en `structuralItemPositions`

### 3.1 Problema

```
ReferenceError: Cannot access 'structuralItemPositions' before initialization
```

La variable `const structuralItemPositions = []` se declaraba en la **línea 1696** de [`flow_assembly.js`](../../js/workflows/flow_assembly.js), pero se usaba en:

1. **Fase 0 (D15)**: `buildEscaletaFootprint()` → `fp.push({...})` en ~línea 1543
2. **Fase 1a** (faros): `structuralItemPositions.push(snappedPosSec)` en ~línea 1650

### 3.2 Causa

JavaScript `const` está sujeto a **Temporal Dead Zone (TDZ)**: no puede accederse antes de su línea de declaración, aunque esté en el mismo ámbito léxico.

### 3.3 Solución

Mover `const structuralItemPositions = []` a la **línea 1208**, justo después de `itemPositions` y **antes** de que comience la Fase 0 (D15) en la línea 1475.

```javascript
// línea 1207-1208
const itemPositions = new Map();          // clave: line.num, valor: snappedPosSec
const structuralItemPositions = [];       // paralelo a structuralItems
```

### 3.4 Lección Aprendida

Todas las variables `const` usadas por las Fases 0-3 deben declararse **antes** de que comience la Fase 0. El orden correcto es:

```
1. Declaración de funciones helpers (clasificarItem, snapToCut, etc.)
2. Clasificación de items (farosItems, aproximadosItems, graphicItems)
3. Inicialización de acumuladores (itemPositions, structuralItemPositions)
4. Constantes D15 (AFFINE_RANSAC_ITERATIONS, etc.)
5. Carga de anclas (tlClipStartSec, anchorOnAirSec)  ← también movido aquí
6. FASE 0: Footprint Matching (D15)
7. FASE 1a: Faros
8. FASE 1b: Aproximados por segmentos
9. D12: Inserts ROJOS
10. FASE 3: Gráficos
```

---

## 4. Fix 2: `dateDir` con fecha de escaleta (no del sistema)

### 4.1 Problema

Los proyectos se guardaban en un directorio con la **fecha actual del sistema** (`new Date()`), en lugar de la **fecha real de emisión de la escaleta**.

Ejemplo: Una escaleta de ayer (`TN_COMARQUES_20260513_142504.json`) generaba proyectos en `.../14_05_2026/` (hoy) en vez de `.../13_05_2026/` (fecha de la escaleta).

### 4.2 Causa

[`getFormattedDate()`](../../js/core/utils.js:238) en `utils.js` siempre retorna `new Date()`:

```javascript
getFormattedDate: function() {
    var d = new Date();
    var day = ("0" + d.getDate()).slice(-2);
    var month = ("0" + (d.getMonth() + 1)).slice(-2);
    var year = d.getFullYear();
    return day + "_" + month + "_" + year;
},
```

Esta función se llama en 3 lugares para construir `ctx.dateDir`:

| Archivo | Línea | Contexto |
|---------|-------|----------|
| [`4_Context.js`](../../js/core/4_Context.js:47) | 47 | Inicialización del contexto |
| [`flow_mainButton.js`](../../js/workflows/flow_mainButton.js) | ~645 | Construcción de paths |
| [`flow_assembly.js`](../../js/workflows/flow_assembly.js) | ~789 | Construcción de paths |

### 4.3 Solución

**No modificar `getFormattedDate()`** — otros callers legítimamente necesitan la fecha del sistema.

En su lugar, **sobrescribir `ctx.dateDir`** inmediatamente después de `findLatest()` en [`flow_mainButton.js`](../../js/workflows/flow_mainButton.js:84-100), extrayendo la fecha del nombre de archivo de la escaleta.

#### Algoritmo de extracción

Los archivos de escaleta siguen el formato: `PROGRAMA_YYYYMMDD_HHMMSS.json`

```
TN_COMARQUES_20260513_142504.json
              └──┬──┘
           penúltimo segmento (parts[parts.length - 2])
           → "20260513" → DD_MM_YYYY → "13_05_2026"
```

#### Código insertado (líneas 84-100)

```javascript
// ── CORRECCIÓ dateDir: usar data de l'escaleta, no del sistema ──
if (jsonMeta.filename) {
    const parts = jsonMeta.filename.replace('.json', '').split('_');
    if (parts.length >= 2) {
        const yyyymmdd = parts[parts.length - 2]; // "20260513"
        if (yyyymmdd && yyyymmdd.length === 8) {
            const dd = yyyymmdd.substring(6, 8);
            const mm = yyyymmdd.substring(4, 6);
            const yyyy = yyyymmdd.substring(0, 4);
            const escaletaDate = dd + '_' + mm + '_' + yyyy;
            ctx.dateDir = escaletaDate;
            if (window.FASTPASS_UI && window.FASTPASS_UI.State) {
                window.FASTPASS_UI.State.dateDir = escaletaDate;
            }
            log(`📅 [dateDir] Corregit amb data de l'escaleta: ${escaletaDate}`);
        }
    }
}
```

### 4.4 Impacto

La corrección afecta a todos los paths que dependen de `ctx.dateDir`:

- `session_manifest.js:getPath()` → directorio de manifiestos
- `flow_mainButton.js` → guardado de proyectos de bloque
- `flow_assembly.js` → guardado de análisis

### 4.5 Verificación de no-impacto en `getFormattedDate()`

Se confirmó que `getFormattedDate()` **no se modificó**. Sus otros usos (no relacionados con escaletas) siguen usando la fecha del sistema correctamente.

---

## 5. Dependencias entre Módulos

### 5.1 Cadena de inicialización

```
main.js
  └→ 4_Context.js::checkContext()
       ├→ Config → State → Utils
       ├→ EscaletaReader::findLatest()  ← fecha de escaleta extraída aquí
       └→ ctx.dateDir (sobrescrito con fecha de escaleta)
            └→ SessionManifest::save() → getPath() usa ctx.dateDir
```

### 5.2 Flujo principal de marcadores

```
flow_mainButton.js::MainButton()
  └→ flow_assembly.js::placeStructureMarkers()
       ├→ FASE 0: buildTimelineFootprint → buildEscaletaFootprint
       │         → affineRANSAC → matchFootprints → anchor correction
       ├→ FASE 1a: colocar faros (snapToCutFaro)
       ├→ FASE 1b: greedy bidireccional L→R + R→L
       ├→ D12: inserts ROJOS (agrupacio=null)
       └→ FASE 3: gráficos (chyrones, totems)
```

---

## 6. Sesiones de Debugging — Historial

| Fecha | Problema | Causa | Solución | Archivo |
|-------|----------|-------|----------|---------|
| 2026-05-15 | `Cannot access 'tlClipStartSec' before initialization` | TDZ: variable usada en Fase 0 antes de declararse | Mover `tlClipStartSec`/`anchorOnAirSec` a línea 1467 | [`flow_assembly.js`](../../js/workflows/flow_assembly.js) |
| 2026-05-15 | `Cannot access 'structuralItemPositions' before initialization` | TDZ: variable usada en Fase 0 antes de declararse | Mover declaración a línea 1208 | [`flow_assembly.js`](../../js/workflows/flow_assembly.js) |
| 2026-05-15 | Proyectos guardados en directorio con fecha incorrecta | `getFormattedDate()` usa `new Date()` (fecha del sistema) | Extraer fecha del filename de la escaleta y sobrescribir `ctx.dateDir` | [`flow_mainButton.js`](../../js/workflows/flow_mainButton.js) |

---

## 7. Buenas Prácticas Adoptadas

1. **Declaración anticipada**: Todas las variables de acumulación (`const`) se declaran antes de la Fase 0.
2. **No modificar utilidades compartidas**: `getFormattedDate()` se preserva intacto; la corrección se aplica en el punto de consumo.
3. **Sincronización State + ctx**: Cuando se modifica `ctx.dateDir`, también se actualiza `window.FASTPASS_UI.State.dateDir`.
4. **Log descriptivo**: Cada fix incluye un `log()` con emoji y valores antes/después para trazabilidad.

---

## 8. Referencias Cruzadas

| Tema | Plan de referencia |
|------|--------------------|
| Algoritmo de marcadores (Fases 0-3, D1-D15) | [`PLAN_FASES_MARCADORES.md`](PLAN_FASES_MARCADORES.md) |
| Mapa de arquitectura general | [`ARCHITECTURE_MAP.md`](../guides/ARCHITECTURE_MAP.md) |
| Guía de desarrollo | [`DEVELOPMENT.md`](../guides/DEVELOPMENT.md) |
| Especificación de escaleta JSON | [`ESCALETA_JSON_SPEC.md`](../specs/ESCALETA_JSON_SPEC.md) |
| Clasificación de ítems | [`ITEM_CLASSIFICATION.md`](../specs/ITEM_CLASSIFICATION.md) |
