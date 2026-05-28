# Plan: Corrección de Marcadores Crudos (Referencia a TC de Secuencia vs TC de Clip)

## 1. Diagnóstico del Bug

### Contexto

Tras implementar el `programInPoint` (el clip empieza en la hora del programa, ej: 21:00 TNV), el cálculo de `tcRef.offset` ha cambiado semánticamente:

**Antes** (sin programInPoint):
- `inPoint` = `bounds.inPoint` (relativo al bloque, ej: 20:59:00 = 75540s)
- `offset = clipStart - inPoint` → ej: `0 - 75540 = -75540`
- Fórmula marcador: `(onAirSec - mediaStart) + offset`
- Ej: `(75930 - 72000) + (-75540) = 390s` ← **correcto** (posición en timeline)

**Ahora** (con programInPoint):
- `inPoint` = `programInPoint` (relativo al programa, ej: 21:00:00 = 75600s)
- `offset = clipStart - inPoint` → ej: `0 - 75600 = -75600`
- Fórmula marcador: `(onAirSec - mediaStart) + offset`
- Ej: `(75930 - 72000) + (-75600) = -71670s` ← **incorrecto** (negativo, marcador descartado)

### Causa Raíz

La fórmula `(onAirSec - mediaStart) + offset` asume que `offset = clipStart - inPoint_del_bloque`. Pero ahora `inPoint` es `programInPoint` (inicio del programa), no el inicio del bloque original. El `offset` se ha desplazado por la diferencia entre `programInPoint` y `bounds.inPoint`.

### Impacto

- **placeOnAirMarkers()** (flow_assembly.js:1690): Todos los marcadores crudos se colocan en posiciones incorrectas (negativas o muy desplazadas)
- **placeMagicChyrons()** (flow_assembly.js:420, 655, 760, 806): Mismo problema en los 4 puntos donde se usa `tcRef.offset` con la misma fórmula

## 2. Solución Propuesta

### Opción A (Recomendada): Almacenar `blockInPoint` original en el manifest

En lugar de cambiar la fórmula (que funciona correctamente para su semántica original), preservamos el `inPoint` original del bloque en el manifest para que la fórmula siga funcionando.

**Cambios necesarios:**

#### 2.1 `js/workflows/flow_mainButton.js` — Guardar `blockInPoint` original

En la sección donde se guarda `tcRef` por primera vez (línea 132-136), añadir `blockInPoint`:

```javascript
tcRef: {
    ...bounds.tcRef,
    blockInPoint: bounds.inPoint,  // ← NUEVO: inPoint original del bloque (sin programInPoint)
    clipStart: null,
    offset: null
}
```

#### 2.2 `js/workflows/flow_mainButton.js` — Calcular offset contra blockInPoint

En la sección post-inserción (línea 321-323), cambiar:

```javascript
// ANTES:
const inPoint = cleanFeedData.inPoint;
const offset = clipStart - inPoint;

// DESPUÉS:
const blockInPoint = manifest.tcRef?.blockInPoint ?? cleanFeedData.inPoint;
const offset = clipStart - blockInPoint;
```

#### 2.3 `js/workflows/flow_assembly.js` — placeOnAirMarkers y demás usos

No requieren cambios. La fórmula `(onAirSec - mediaStart) + offset` seguirá funcionando porque `offset` ahora se calcula correctamente contra `blockInPoint`.

### Opción B (Alternativa): Cambiar la fórmula en todos los puntos

Modificar los 5 puntos en `flow_assembly.js` para que usen `programInPoint` en la fórmula. Pero esto es más riesgoso porque:
- Hay 5 puntos que modificar (líneas 420, 655, 760, 806, 1690)
- La semántica de `offset` quedaría inconsistente
- Más propenso a errores futuros

**Se descarta en favor de la Opción A.**

## 3. Archivos a Modificar

| Archivo | Línea | Cambio |
|---------|-------|--------|
| `js/workflows/flow_mainButton.js` | ~136 | Añadir `blockInPoint: bounds.inPoint` al tcRef inicial |
| `js/workflows/flow_mainButton.js` | ~322 | Cambiar `cleanFeedData.inPoint` por `manifest.tcRef.blockInPoint` |

## 4. Verificación

Después del fix, con los mismos valores de ejemplo:

- `blockInPoint` = 75540s (bounds.inPoint original)
- `offset = 0 - 75540 = -75540`
- `markerPos = (75930 - 72000) + (-75540) = 390s` ← **correcto**

## 5. Orden de Implementación

1. Modificar `flow_mainButton.js` para guardar `blockInPoint` en el tcRef inicial
2. Modificar `flow_mainButton.js` para calcular offset contra `blockInPoint`
3. Probar con un caso real (TNV, bloque V1)
4. Verificar que los marcadores aparecen en posiciones correctas
