# Clasificación de Items de Escaleta

> Documento de referencia genérico para la clasificación de items en el algoritmo de 3 rondas de `placeStructureMarkers()`.
> Aplicable a cualquier proyecto/programa. Última actualización: 2026-04-24 (fix clasificación IPD + actualización Ronda 3).

---

## 1. Campos relevantes del JSON

Cada item (`liniesEscaleta[]`) contiene estos campos utilizados para la clasificación:

| Campo | Tipo | Descripción | Uso en clasificación |
|-------|------|-------------|---------------------|
| `durada` | `string` ("M:SS") | Duración planificada del item | **Principal**: `> 0` → estructural; `= 0` → IPD o grafismo |
| `duradaOnAir` | `string` ("M:SS") o `null` | Duración real emitida (cuando difiere de `durada`) | **IPD**: si `≠ null` y `durada = 0`, es IPD (imagen de relleno) |
| `agrupacio` | `string` (ej: "v1") o `null` | Grupo al que pertenece el item | Determina color (azul si tiene, rojo si no) y si es IPD |
| `num` | `string` | Número identificativo (ej: "01lead", "02") | Detección de LEAD para clasificación CORTO |
| `especial` | `boolean` | Marca si es una conexión en directo | Identifica items de tipo "conexión" |
| `horaEntradaOnAir` | `string` ("HH:MM:SS") o `null` | Hora real de entrada | Filtro inicial: items sin hora se saltan |
| `horaEntradaPrevista` | `string` ("HH:MM:SS") | Hora prevista de entrada | Fallback si `horaEntradaOnAir` es null |

---

## 2. Tabla comparativa por tipo

| # | Tipo | `durada` | `duradaOnAir` | `agrupacio` | Color marcador | Ronda | ¿Snap? | Lógica de colocación |
|---|------|----------|---------------|-------------|----------------|-------|--------|----------------------|
| 1 | **ESTRUCTURAL** | `> "0:00"` | irrelevante | cualquiera | 🔵 AZUL(6) si `agrupacio≠null`<br>🔴 ROJO(1) si `agrupacio=null` | 1 | ✅ Sí | Posición aditiva: `posiciónAnterior + duraciónAnterior`. La posición base es la **real** (tras snap), no la ideal. |
| 2 | **IPD** (Imatge Per Dins) | `= "0:00"` | `≠ null` | `≠ null` | 🔷 TURQUESA(7) | 2 | ✅ Sí | Imagen que "tapa" una conexión. Se coloca en el siguiente corte desde la posición del item padre estructural. |
| 3 | **GRAFISMO** (con grupo) | `= "0:00"` | `= null` | `≠ null` | 🟡 AMARILLO(4) | 3 | ❌ No | Elemento superpuesto (línea, chyrón, texto, GF) dentro de un grupo pero sin duración en antena. Colocado hacia el final del rango del padre. Sin snap. |
| 4 | **GRAFISMO** (sin grupo) | `= "0:00"` | `= null` | `= null` | 🟡 AMARILLO(4) | 3 | ❌ No | Elemento independiente (QR, etc.). Misma lógica que grafismo con grupo. Sin snap. |

---

## 3. Árbol de decisión para clasificación

```
Para cada item de la escaleta (con horaEntrada válida):

1. ¿durada > "0:00" (usando getRawDuradaSec)?
   ├── SÍ → ESTRUCTURAL → Ronda 1
   │
   └── NO (durada = "0:00") →
       ├── ¿agrupacio ≠ null Y duradaOnAir ≠ null?
       │   └── SÍ → IPD → Ronda 2
       │
       └── → GRAFISMO → Ronda 3
            (agrupacio = null  O  duradaOnAir = null)
```

> **Regla clave**: `duradaOnAir` es el discriminante entre IPD y GRAFISMO cuando `durada = 0` y `agrupacio ≠ null`:
> - `duradaOnAir ≠ null` → **IPD**: imagen que se emite durante un tiempo (relleno de conexión)
> - `duradaOnAir = null` → **GRAFISMO**: elemento superpuesto sin duración propia

---

## 4. Categorías de duración (para snapToCut)

Usa `getEffectiveDuradaSec()` que toma `duradaOnAir` como fallback si `durada = "0:00"`.

| Categoría | Condición | minDur | Tolerancia snap | Uso |
|-----------|-----------|--------|-----------------|-----|
| `CORTO` | `num` contiene "lead" (case-insensitive) | 0s | 1.0s | LEAD siempre CORTO para que pueda colocarse en 00:00 |
| `LARGO` | `dSec ≥ 30` | 15s | 2.0s | Items con duración ≥ 30s |
| `MEDIO` | `5 ≤ dSec < 30` | 5s | 2.0s | Items con duración entre 5s y 29s |
| `CORTO` | `dSec < 5` | 0s | 1.0s | Items con duración < 5s (fallback) |
| `GRAFISMO` | `agrupacio = null` y `dSec = 0` | 0s | 1.0s | Items sin grupo ni duración |
| `NO_VERTICALIZABLE` | `agrupacio = null` y `dSec > 0` | 0s | 2.0s | Items sin grupo pero con duración |

**Orden de evaluación** (en código):
1. GRAFISMO / NO_VERTICALIZABLE (por agrupacio)
2. LEAD → CORTO
3. dSec ≥ 30 → LARGO
4. dSec ≥ 5 → MEDIO
5. resto → CORTO

---

## 5. Colores de marcadores

| Índice | Nombre | Uso |
|--------|--------|-----|
| 1 | 🔴 ROJO | Estructurales **sin** `agrupacio` |
| 4 | 🟡 AMARILLO | Grafismos (Ronda 3) |
| 6 | 🔵 AZUL | Estructurales **con** `agrupacio` |
| 7 | 🔷 TURQUESA | IPDs (Ronda 2) |

---

## 6. Las 3 rondas del algoritmo

### Ronda 1 — ESTRUCTURALES

```
Posición del primer estructural → 00:00 (forzado)
Posición del siguiente estructural → currentStructuralPos
currentStructuralPos = posicionFinal + duraciónItemActual
                              ↑
                    (posición REAL tras snap, no la ideal)
```

- Se aplica `snapToCut()` para alinear al inicio de un clip en el timeline
- `currentStructuralPos` se actualiza con la posición **real** (tras snap), no con la ideal previa
- Esto asegura que la distancia entre marcadores refleje la duración real del item en el timeline

### Ronda 2 — IPDs

```
Padre estructural = item estructural que precede al IPD en la escaleta
Posición ideal = inicio del padre (parentPos)
Resultado = snapToCut(posiciónIdeal, 'CORTO', ...)
Posición final = clamp(resultado, parentPos, limit - 0.04)
```

- `limit` = inicio del siguiente estructural (si existe) o `parentPos + max(duraciónPadre, 4s)`
- Usa `snapToCut` con categoría `'CORTO'` (minDur=0) porque los IPD producen cortes detectables
- No altera `currentStructuralPos` (no afecta a la posición de los siguientes estructurales)

### Ronda 3 — GRAFISMOS

```
1. Agrupar todos los grafismos por item padre estructural
2. Para cada grupo:
   ┌─ marginStart = parentPos + (limit - parentPos) / 3
   │   (sin grafismos en el primer tercio del rango)
   ├─ lastPos = limit - 4.0
   │   (último grafismo siempre a 4s del límite)
   ├─ spacing = 4.0 si hay espacio, comprimido si no
   └─ k=0 (1er item escaleta): lastPos - spacing × (count-1)
      ...
      k=count-1 (último item): lastPos
```

- NO se aplica `snapToCut` (los grafismos no producen cortes en V1)
- `marginStart` protege el primer tercio del rango del padre (sin grafismos solapados al inicio)
- `lastPos` asegura que ningún grafismo quede a menos de 4s del siguiente marcador estructural
- El orden de la escaleta se respeta: el primer item en la escaleta se coloca más cerca de `marginStart`
- Si no hay espacio para `spacing = 4.0`, se comprime equitativamente (mínimo 0.04s)
- `placedGraphicMarkers` (array separado) para tracking exclusivo de grafismos

---

## 7. Casos especiales

### 7.1 LEAD
- Detectado por `num` conteniendo "lead" (case-insensitive)
- Siempre clasificado como `CORTO` (minDur=0)
- **Motivo**: Aunque tenga duración ≥ 30s, LEAD debe poder colocarse en 00:00 sin que `snapToCut` lo desplace por falta de clips largos al inicio del timeline

### 7.2 CONEXIÓN (`especial: true`)
- Items marcados con `especial: true` (conexiones en directo)
- Son estructurales si tienen `durada > 0`
- Su duración se usa para el cálculo aditivo del siguiente estructural
- Los IPD que aparecen **después** de una conexión son imágenes para tapar la transición

### 7.3 IPD vs GRAFISMO
| Característica | IPD | GRAFISMO |
|---------------|-----|----------|
| `durada` | `"0:00"` | `"0:00"` |
| `duradaOnAir` | `≠ null` (ej: "0:33") | `= null` |
| `agrupacio` | `≠ null` | cualquiera |
| Produce corte en timeline | ✅ Sí | ❌ No |
| Snap | ✅ Sí | ❌ No |
| Color | 🔷 Turquesa(7) | 🟡 Amarillo(4) |
| Función | Imagen de relleno tras conexión | Elemento superpuesto (línea, chyrón, GF, texto) |

### 7.4 getRawDuradaSec vs getEffectiveDuradaSec

```javascript
// Para CLASIFICACIÓN (separar estructurales de IPDs/grafismos):
const getRawDuradaSec = (line) => parseDurada(line.durada || '0:00');
// Usa SOLO el campo literal "durada". Si durada = "0:00" → 0s

// Para CÁLCULO ADITIVO (duración efectiva del item en el timeline):
const getEffectiveDuradaSec = (line) => {
    const d = parseDurada(line.durada || '0:00');
    if (d > 0) return d;
    // Si durada es 0 pero hay duradaOnAir, usar ese valor
    if (line.duradaOnAir) return parseDurada(line.duradaOnAir);
    return 0;
};
```

### 7.5 Cálculo aditivo correcto

```javascript
// INCORRECTO: acumula sobre posición ideal
currentStructuralPos += dSec;
// → Si 01dp ideal=40 pero se coloca en 64.16, el siguiente usa 40+19=59

// CORRECTO: usa posición real tras snap
currentStructuralPos = posicionFinal + dSec;
// → Si 01dp se coloca en 64.16, el siguiente usa 64.16+19=83.16
```

### 7.6 Fallback de snapToCut

```javascript
// INCORRECTO: devuelve siguiente corte sin verificar distancia ni minDur
for (let i = ultimoCorteUsado + 1; i < cortes.length; i++) {
    return { corte: cortes[i], idx: i };
}

// CORRECTO: busca el más cercano a idealPos (≤10s) que cumpla minDur
const mejorCorte = buscarCorteMasCercano(idealPos, cortes, clips, minDur);
if (mejorCorte >= 0) return { corte: mejorCorte, idx: mejorIdx };
return { corte: idealPos, idx: -1 }; // Respeta el tiempo aditivo
```

---

## 8. Arrays de tracking

| Array | Tipo de marcador | Ronda | Propósito |
|-------|-----------------|-------|-----------|
| `placedMarkers` | Todos | 1,2,3 | Lista completa para resumen final |
| `structuralItemPositions` | Estructurales | 1 | Paralelo a `structuralItems`. Usado por IPDs y grafismos para conocer el rango del padre. |
| `placedGraphicMarkers` | Grafismos | 3 | Separado de `placedMarkers` para tracking exclusivo de grafismos. |
| `placedIpdMarkers` | IPDs | 2 | Separado para posible uso futuro. |

---

## 9. Referencias en el código

| Concepto | Fichero | Línea |
|----------|---------|-------|
| `getRawDuradaSec()` | `flow_assembly.js` | ~1081 |
| Clasificación 3 grupos | `flow_assembly.js` | ~1086-1097 |
| Ronda 1 (Estructurales) | `flow_assembly.js` | ~1108-1144 |
| `currentStructuralPos = posicionFinal + dSec` | `flow_assembly.js` | ~1127 |
| Ronda 2 (IPDs) | `flow_assembly.js` | ~1174-1215 |
| `findParentStructural()` | `flow_assembly.js` | ~1154-1172 |
| Ronda 3 (Grafismos) | `flow_assembly.js` | ~1218-1319 |
| `snapToCut()` | `flow_assembly.js` | ~1019-1057 |
| `clasificarItem()` | `flow_assembly.js` | ~1002-1016 |
| `getEffectiveDuradaSec()` | `flow_assembly.js` | ~989-996 |
| Colores de marcadores | `INFO/MARKER_COLORS.md` | — |
