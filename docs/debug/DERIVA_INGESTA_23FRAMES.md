# 🐛 Hallazgo: Deriva Sistemática de 23 Frames en la Ingesta MP4

## Fecha del hallazgo
2026-05-04

## Contexto
Durante la verificación del sistema de inserción MP4 con hora fija de programa
(`PROGRAM_START_HOURS`: TNV→21:00, TNM→14:30, TNC→13:50), se detectó que el
clip insertado en el timeline no coincide exactamente con el TC esperado.

## Síntoma
El clip MP4 insertado aparece desplazado **23 frames (~0.92s a 25fps)** a la
**izquierda** (o derecha, según la referencia) respecto al TC que debería tener
según la escaleta.

## Causa Raíz
La deriva es **sistemática y constante**: ocurre siempre en el mismo sentido y
con la misma magnitud (~23 frames). Esto indica que no es un error de redondeo
ni un problema de precisión de `tcToSeconds()`, sino un **desplazamiento fijo
introducido en el proceso de ingesta/codificación del MP4** desde el sistema de
emisión (N-News / playout).

Posibles orígenes:
1. **Offset de codificación**: El encoder que genera el MP4 desde el servidor
   de emisión añade un pre-roll o delay sistemático.
2. **Timecode de referencia**: El TC grabado en el MP4 no coincide con el TC
   real de emisión por un desfase fijo en el punto de captura.
3. **Latencia de infraestructura**: La cadena de ingesta (servidor → códec →
   archivo) introduce una latencia constante.

## Impacto
Todo el sistema de posicionamiento basado en TC se ve afectado:
- `cleanFeedData.inPoint` → el clip se inserta desplazado
- `tcRef.offset` → la relación source↔timeline está contaminada
- `placePrecisionMarkers()` → los marcadores OnAir se colocan en posición
  incorrecta
- `_placeMagicChyrons()` → los rótulos se desalinean
- `verifyTcRefFootprint()` → el footprint detection arrastra el error
- Todos los cálculos en `flow_assembly.js` que usan `tcRef.offset`

## Magnitud
| Unidad | Valor |
|--------|-------|
| Frames | 23 |
| FPS | 25 |
| Segundos | 0.92 |
| Frames a 29.97fps | ~27.6 |

## Solución Propuesta

### Enfoque: `TC_OFFSET` global y configurable

En lugar de hardcodear la corrección en cada punto de cálculo, se introduce un
**parámetro de configuración global** `tcOffset` (en segundos) que se aplica
en todos los puntos donde se convierte TC a posición en el timeline.

### Puntos de aplicación

| Archivo | Línea(s) | Expresión actual | Expresión corregida |
|---------|----------|-----------------|---------------------|
| `flow_mainButton.js` | 108 | `programInPoint = targetStartSec - msStartSec` | `programInPoint = (targetStartSec - msStartSec) + tcOffset` |
| `flow_mainButton.js` | 210 | `fbProgramInPoint = targetStartSec - fbMsStart` | `fbProgramInPoint = (targetStartSec - fbMsStart) + tcOffset` |
| `flow_assembly.js` | 420 | `(onAirSec - tcRef.mediaStart) + tcRef.offset` | `(onAirSec - tcRef.mediaStart) + tcRef.offset + tcOffset` |
| `flow_assembly.js` | 655 | `(onAirSec - tcRef.mediaStart) + tcRef.offset` | `(onAirSec - tcRef.mediaStart) + tcRef.offset + tcOffset` |
| `flow_assembly.js` | 760 | `(onAirSec - tcRef.mediaStart) + tcRef.offset` | `(onAirSec - tcRef.mediaStart) + tcRef.offset + tcOffset` |
| `flow_assembly.js` | 806 | `(onAirSec - tcRef.mediaStart) + tcRef.offset` | `(onAirSec - tcRef.mediaStart) + tcRef.offset + tcOffset` |
| `flow_assembly.js` | 1689 | `(onAirSec - tcRef.mediaStart) + tcRef.offset` | `(onAirSec - tcRef.mediaStart) + tcRef.offset + tcOffset` |

### Implementación

1. **Añadir `tcOffset` a `Profile.json`** (sección `general`):
   ```json
   {
       "general": {
           "autor": "AGUS",
           "guarda": 22,
           "debug": false,
           "tcOffset": 0.92
       }
   }
   ```

2. **Exponer `tcOffset` en `Config.get()`**:
   ```javascript
   // En config.js, dentro del return de get():
   tcOffset: cfg.general.tcOffset || 0
   ```

3. **Crear helper central `applyTcOffset(seconds)`** en `utils.js`:
   ```javascript
   applyTcOffset: function(seconds) {
       const cfg = FASTPASS_UI.Config.get();
       return seconds + (cfg.tcOffset || 0);
   }
   ```

4. **Aplicar en todos los puntos de cálculo** listados arriba.

### Ventajas
- **Configurable**: Se puede ajustar sin tocar código (solo `Profile.json`)
- **Centralizado**: Un solo punto de verdad para la corrección
- **Reversible**: Si la deriva cambia (ej: nuevo encoder), se actualiza el valor
- **No invasivo**: No rompe la lógica existente, solo la desplaza

### Nota sobre `tcToSeconds()`
No se modifica `tcToSeconds()` porque esa función es pura (TC→segundos) y
correcta. El offset debe aplicarse en la **capa de aplicación** (dónde se
convierte TC a posición en el timeline), no en la capa de conversión.
