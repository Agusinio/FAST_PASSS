# Plan de Implementación: Corrección del Botón IN y Sincronización de Contexto

Este plan detalla las acciones necesarias para corregir el fallo en el botón IN (`runCutIn`) e integrar un mecanismo de validación global.

## Cambios Propuestos

### 1. Núcleo de Configuración
#### [MODIFY] [11_Configuracio.js](file:///Volumes/PYTHON/FAST_PASSS_Desarrollo/js/core/11_Configuracio.js)
*   **Remapeo de Tracks**: Traducir las claves del `Profile.json` (ej: `v_mp4`) a nombres usados en el código (ej: `mp4`).
*   **Convención de Nombres de Secuencia**: Cambiar de `archivo` a `wott` (ej: `TNV`), siguiendo el formato `[WOTT]_[Tema]`.

### 2. Validación y Utilidades
#### [MODIFY] [10_Eines.js](file:///Volumes/PYTHON/FAST_PASSS_Desarrollo/js/core/10_Eines.js)
*   **Actualizar `validateActiveSequence`**: Validar basándose en el token `wott` (ej: `TNV`) y el bloque.

### 3. Workflow de Edición y Otros
#### [MODIFY] [flux_tall.js](file:///Volumes/PYTHON/FAST_PASSS_Desarrollo/js/workflows/flux_tall.js)
*   **Fix `const`**: Cambiar a `let` la declaración de `activeSeqName`.
*   **Validación Global**: Añadir `validateActiveSequence()` en todos los botones del timeline.

#### [MODIFY] [flux_retols.js](file:///Volumes/PYTHON/FAST_PASSS_Desarrollo/js/workflows/flux_retols.js) / [flux_exportacio.js](file:///Volumes/PYTHON/FAST_PASSS_Desarrollo/js/workflows/flux_exportacio.js)
*   Integrar validación en todas las funciones que afectan al timeline.

### 4. Motor JSX (Premiere)
#### [MODIFY] [32_Segments.jsx](file:///Volumes/PYTHON/FAST_PASSS_Desarrollo/jsx/modules/32_Segments.jsx) / [30_Cronologia.jsx](file:///Volumes/PYTHON/FAST_PASSS_Desarrollo/jsx/modules/30_Cronologia.jsx) / [31_Pistes.jsx](file:///Volumes/PYTHON/FAST_PASSS_Desarrollo/jsx/modules/31_Pistes.jsx)
*   **Unificación de Secuencia**: Usar `FASTPASS.Entorn.getWorkSequence()` en lugar de `app.project.activeSequence`.

---

## Plan de Verificación

### Pruebas de Sistema (Logs)
1.  Log en `Configuracio.get()`: `DEBUG: config.tracks.video.mp4 -> [valor]`
2.  Log en `runCutIn`: `DEBUG: runCutIn iniciado` y `DEBUG: Validación Exitosa para: [nombre]`

### Verificación Manual
*   Probar botón IN y navegación.
*   Verificar bloqueo de acciones en secuencias incorrectas.
*   Operación con múltiples proyectos abiertos.
