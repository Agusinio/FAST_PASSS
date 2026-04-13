# Plan de ataque: Habilitar ensamblaje automático de chyrons y títulos (botón Troseja)

## Objetivo
Lograr que el botón **Troseja** ejecute correctamente la detección de escenas y el posicionamiento automático de chyrons y títulos según la estructura del proyecto.

## Estado actual (según auditoría)
- ✅ **Detección de escenas**: Implementada en `jsx/modules/6_Clips.jsx` (`FASTPASS.Clips.scenes`).
- ✅ **Workflow de ensamblaje**: Definido en `js/workflows/flow_assembly.js` (`runAutoPlacement`).
- ✅ **Lógica de parseo**: Disponible en `js/logic/13_Parse.js` (`classify`, `files`, `video`).
- ❌ **Falta función `getTrackClips`**: No existe en `js/logic/6_Clips_Logic.js` ni en ExtendScript.
- ⚠️ **Estructura no cargada**: `state.structure` permanece vacío porque no se asigna después de parsear los Wotts.
- ⚠️ **Binding del botón**: Según documentación, puede estar roto (aunque el código `runScene` existe).

## Pasos a ejecutar

### 1. Implementar `getTrackClips` en la capa de lógica
**Archivo**: `js/logic/6_Clips_Logic.js`  
**Descripción**: Crear una función asíncrona que devuelva un array de objetos clip (start, end, index) para una pista dada.  
**Implementación**:
- Llamar a `Clips.count(trackIdx, type)` para obtener el número de clips.
- Iterar de 0 a count-1 y llamar a `Clips.get(trackIdx, i, type)`.
- Parsear el JSON resultante y construir un array con `{ start, end, index, ... }`.
- Añadir la función al objeto `FASTPASS_UI.Logic.Clips`.

**Criterio de éxito**: La función está disponible y puede ser llamada desde `flow_assembly.js`.

### 2. Garantizar la carga de `state.structure`
**Archivo**: `js/workflows/flow_mainButton.js` (o donde se procesen los Wotts)  
**Descripción**: Después de detectar los archivos Wott y antes de ejecutar el ensamblaje, asignar `FASTPASS_UI.State.structure = Parse.files(fileList, program, block)`.  
**Pasos**:
- Identificar el punto donde se obtiene la lista de Wotts (posiblemente en `flow_mainButton.js`, función `scan`).
- Llamar a `Parse.files(fileList, program, block)` y asignar el resultado a `FASTPASS_UI.State.structure`.
- Asegurar que `state.pieceIndex` se inicialice a 0.

**Criterio de éxito**: `state.structure` contiene al menos un bloque cuando hay Wotts cargados.

### 3. Añadir logs de depuración en `flow_assembly`
**Archivo**: `js/workflows/flow_assembly.js`  
**Descripción**: Insertar logs detallados para verificar que cada paso recibe los datos esperados.  
**Pasos**:
- Loggear el número de clips obtenidos con `getTrackClips`.
- Loggear la longitud de `state.structure`.
- Loggear el tipo clasificado de cada bloque.
- Loggear los tiempos de colocación de cada chyron.

**Criterio de éxito**: Los logs aparecen en la consola al ejecutar el flujo (en entorno de desarrollo).

### 4. Validar dependencias ExtendScript
**Archivos**:
- `jsx/modules/7_KF.jsx` → `reframe` ya existe.
- `jsx/modules/6_Clips.jsx` → `scenes`, `count`, `get`, `insert` existen.
- `jsx/modules/5_Tracks.jsx` → `target`, `isolate`, `all` (si se usan).
- `jsx/modules/3_Project.jsx` → `find`, `biggestIn` (para chyrons).

**Acción**: Confirmar que las funciones llamadas desde `callJSX` están definidas. Si falta alguna, implementarla.

### 5. Probar el flujo completo (verificación estática)
**Descripción**: Ejecutar un análisis de sintaxis y revisar que no haya referencias a funciones inexistentes.  
**Pasos**:
- Usar `eslint` o similar (si está configurado) para detectar errores.
- Revisar manualmente las llamadas entre capas.
- Simular mentalmente el flujo con datos de ejemplo.

**Criterio de éxito**: No se detectan errores de referencia ni de sintaxis.

## Orden de ejecución
1. Crear este plan (✓).
2. Implementar `getTrackClips` (paso 1).
3. Corregir carga de `state.structure` (paso 2).
4. Añadir logs (paso 3).
5. Validar dependencias (paso 4).
6. Realizar verificación estática (paso 5).
7. Ejecutar prueba real en Premiere (fuera de alcance de este plan).

## Archivos críticos a modificar
- `js/logic/6_Clips_Logic.js`
- `js/workflows/flow_mainButton.js` (o `js/logic/3_Project_Logic.js`)
- `js/workflows/flow_assembly.js`
- Posiblemente `js/core/state.js` (solo definición, no modificación).

## Notas
- El entorno de ExtendScript no puede probarse directamente desde este workspace, por lo que la corrección se basa en garantizar que el código esté completo y siga los patrones existentes.
- Después de aplicar los cambios, se debe reiniciar el panel de Premiere para que las nuevas definiciones de JavaScript carguen.
- Si el botón sigue sin funcionar, habrá que depurar con las herramientas de desarrollador de CEP (Consola de ExtendScript y consola de navegador).

## Responsable
Roo (asistente de código) ejecutará los pasos dentro de las limitaciones del workspace.

---  
*Última actualización: 2026-04-13*