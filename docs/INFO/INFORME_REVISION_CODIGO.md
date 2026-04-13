# Informe de Revisión de Código - Extensión Premiere Pro
## FAST >>> PASS - Verticalización de Vídeos

**Fecha:** 26 de Enero de 2026  
**Versión Analizada:** v7.0.1  
**Arquitectura:** Extensión CEP (Common Extensibility Platform) con ExtendScript (ES3) + JavaScript Moderno

---

## 📋 Resumen Ejecutivo

Esta extensión utiliza una arquitectura de **doble capa**:
- **Capa ExtendScript (ES3)**: Módulos `.jsx` que interactúan directamente con la API de Premiere Pro
- **Capa JavaScript Moderna**: Interfaz HTML/CSS/JS que se comunica con ExtendScript vía `CSInterface`

He identificado **47 problemas** clasificados en 4 categorías: Críticos, Altos, Medios y Bajos.

---

## 🔴 PROBLEMAS CRÍTICOS (Prioridad Máxima)

### 1. **Archivo Duplicado y Obsoleto: `auxiliary.js`**
**Ubicación:** `/auxiliary.js` (raíz del proyecto)  
**Problema:** Este archivo de 822 líneas contiene código ExtendScript (ES3) pero con extensión `.js`. Parece ser una versión antigua de los módulos que ahora están en `/modules/`.

**Evidencia:**
```javascript
// Línea 1-7 de auxiliary.js
/*
 * =================================================================================
 * main_v7.jsx - v6.13.2 (FIX SINTAXIS)
 * AQUEST ARXIU CONTÉ TOTES LES FUNCIONS JSX (ES3) NECESSÀRIES PER A FAST >>> PASS
 */
```

**Impacto:** 
- Confusión sobre qué archivo es la fuente de verdad
- Posible carga accidental del archivo incorrecto
- Mantenimiento duplicado

**Recomendación:** Eliminar `auxiliary.js` o renombrarlo a `.jsx.backup` si se quiere conservar como respaldo.

---

### 2. **Debugger Activo en Producción**
**Ubicación:** `jsx/main.jsx:87-88`

```javascript
function jsx_findOrCreateBin(binName) {
    $.level = 1; // Nivel de debug alto
    debugger;    // ⚠️ ESTO PAUSA LA EJECUCIÓN
```

**Impacto:** 
- Si el usuario tiene el debugger de ExtendScript abierto, la extensión se **congelará** en esta línea
- En producción, esto puede parecer un "crash" o "hang"

**Recomendación:** Eliminar ambas líneas antes de cualquier release.

---

### 3. **Manejo Inseguro de JSON en ExtendScript**
**Ubicación:** `modules/2_IO.jsx:26-69` (función `scanDirectory`)

**Problema:** El código construye JSON manualmente en lugar de usar `JSON.stringify()`, lo cual es propenso a errores de escape.

```javascript
// Líneas 55-65
var str = "[";
for (var j = 0; j < result.length; j++) {
    var item = result[j];
    str += '{"name":"' + item.name + '",';  // ⚠️ Si item.name contiene comillas, rompe el JSON
    str += '"path":"' + item.path + '",';
    // ...
}
```

**Escenario de Fallo:**
Si un archivo se llama `Video "Especial".mp4`, el JSON generado será:
```json
{"name":"Video "Especial".mp4",...}  // ❌ JSON inválido
```

**Recomendación:** Usar el polyfill de `JSON.stringify()` que ya existe en `4_Timeline.jsx:6-27`.

---

### 4. **Race Condition en Importación de Archivos**
**Ubicación:** `js/workflows/flow_nou.js:199-202`

```javascript
if (activeWotts.length > 0) await utils.importList(activeWotts, "CHYRONS");
if (activeMp4s.length > 0)  await utils.importList([activeMp4s[0]], "root");
if (activeSrts.length > 0)  await utils.importList([activeSrts[0]], "root");
```

**Problema:** Las importaciones son secuenciales, pero luego en la línea 213 se intenta montar la secuencia **sin verificar** que los archivos estén realmente importados.

**Evidencia del problema:**
```javascript
// Línea 100 de utils.js
await this.callJSX(`jsx_importFiles(${safeJsonPayload}, "${binName}")`);
await this.delay(500);  // ⚠️ Solo espera 500ms, puede no ser suficiente
```

**Recomendación:** Implementar un sistema de polling que verifique que los archivos existen en el proyecto antes de continuar:

```javascript
// Ejemplo de solución
async function waitForImport(fileNames, maxWait = 10000) {
    const start = Date.now();
    while (Date.now() - start < maxWait) {
        const count = await callJSX(`jsx_countProjectItems(${JSON.stringify(fileNames)})`);
        if (parseInt(count) === fileNames.length) return true;
        await delay(200);
    }
    throw new Error("Timeout esperando importación");
}
```

---

### 5. **Falta de Validación en Rutas de Red**
**Ubicación:** Múltiples archivos (config, IO, etc.)

**Problema:** Las rutas de red están hardcodeadas sin validación de existencia:

```javascript
// auxiliary.js:13-17
rutas: {
    plantilla_net: "\\\\nas1.ad-ccrtv.local\\informatius\\...",
    conductores: "\\\\DSMEDIA07\\portal324\\...",
    verticalitzacio: "\\\\192.168.147.199\\public\\...",
    // ...
}
```

**Impacto:**
- Si la red está caída o el usuario no tiene permisos, la extensión fallará sin mensaje claro
- No hay fallback ni manejo de errores

**Recomendación:** Añadir validación al inicio:

```javascript
function jsx_validateNetworkPaths() {
    var config = FASTPASS.System.getConfig();
    var failed = [];
    
    for (var key in config.rutas) {
        var folder = new Folder(config.rutas[key]);
        if (!folder.exists) failed.push(key);
    }
    
    return failed.length > 0 ? JSON.stringify(failed) : "OK";
}
```

---

## 🟠 PROBLEMAS ALTOS (Requieren Atención)

### 6. **Código Comentado sin Eliminar**
**Ubicación:** Múltiples archivos

Hay **más de 20 bloques** de código comentado que deberían eliminarse o documentarse:

**Ejemplos:**
- `main.js:118-121` - Función `handleSelectionChange` antigua
- `jsx/main.jsx:232-235` - Función `jsx_setTargetedTrack` duplicada
- `modules/4_Timeline.jsx:319-339` - Función `setCTI_Safe` antigua
- `modules/4_Timeline.jsx:470-487` - Función `isolateTrack` antigua

**Recomendación:** Usar Git para el historial, no comentarios en el código.

---

### 7. **Inconsistencia en Convenciones de Nombres**
**Problema:** Mezcla de idiomas y estilos de nomenclatura.

**Ejemplos:**
- Variables en catalán: `nomTemaDecodificado`, `conductoresParaColocar`
- Funciones en inglés: `runMainAction`, `checkContext`
- Mixto: `jsx_prepFlowData` (inglés + catalán interno)

**Impacto:** Dificulta la lectura y mantenimiento del código.

**Recomendación:** Estandarizar a un solo idioma (preferiblemente inglés para código, catalán para UI).

---

### 8. **Falta de Manejo de Errores en Callbacks**
**Ubicación:** `main.js:16-22`

```javascript
csInterface.evalScript('jsx_BOOTSTRAP("' + safeRoot + '")', function(result) {
    if(result === "OK") {
        console.log("✅ JSX Módulos cargados correctamente.");
    } else {
        console.error("❌ Fallo cargando JSX: " + result);
        // ⚠️ No hay acción de recuperación ni notificación al usuario
    }
});
```

**Problema:** Si falla el bootstrap, la extensión queda en estado inconsistente sin avisar al usuario visualmente.

**Recomendación:** Mostrar un alert o deshabilitar la UI:

```javascript
} else {
    alert("Error crítico: No se pudieron cargar los módulos de Premiere.\n\n" + result);
    document.body.innerHTML = '<div style="padding:20px; color:red;">ERROR DE INICIALIZACIÓN</div>';
}
```

---

### 9. **Uso de `eval()` Implícito en Parsing**
**Ubicación:** `js/workflows/flow_nou.js:63-94`

Aunque no usa `eval()` directamente, el código intenta "limpiar" JSON corrupto de forma manual, lo cual es peligroso:

```javascript
// Línea 70-79
if (s.indexOf("function") !== -1) {
    console.warn("🛡️ Escudo activado: Limpiando código infiltrado...");
    let parts = s.split(", function");
    if (parts.length > 1) {
        s = parts[0] + "]"; // ⚠️ Manipulación manual de strings
    }
}
```

**Problema:** Si el JSON está realmente corrupto, esto puede crear vulnerabilidades o fallos inesperados.

**Recomendación:** Mejor solución es arreglar el origen del problema (la función `scanDirectory` en ExtendScript).

---

### 10. **Falta de Validación de Secuencia Activa**
**Ubicación:** `modules/4_Timeline.jsx` - Múltiples funciones

Muchas funciones asumen que `app.project.activeSequence` existe:

```javascript
// Línea 44-47
getCTI: function() { 
    if(app.project.activeSequence) return app.project.activeSequence.getPlayerPosition().seconds; 
    return 0;
}
```

**Problema:** Algunas funciones sí validan, otras no. Inconsistencia.

**Funciones sin validación:**
- `setSequenceInOut` (línea 94)
- `placeClipAtTime` (línea 109) - Tiene fallback pero puede fallar
- `overwriteClipByName` (línea 172)

**Recomendación:** Crear una función helper:

```javascript
function _requireActiveSequence() {
    if (!app.project.activeSequence) {
        throw new Error("No hay secuencia activa");
    }
    return app.project.activeSequence;
}
```

---

### 11. **Hardcoded Magic Numbers**
**Ubicación:** Múltiples archivos

**Ejemplos:**
```javascript
// 4_Timeline.jsx:308
var valInvertido = 608.0 - parseFloat(xPixelValue);  // ¿Por qué 608?

// 4_Timeline.jsx:441
if(scale) scale.setValue(47, true);  // ¿Por qué 47%?

// 3_Project.jsx:362
if ((diskFile.length / 1048576) > 250) {  // ¿Por qué 250MB?
```

**Recomendación:** Definir constantes con nombres descriptivos:

```javascript
var MOTION_MAX_X_PIXELS = 608.0;
var SCALE_16_9_TO_9_16 = 47; // Porcentaje de escala para convertir 16:9 a 9:16
var MIN_MASTER_CHYRON_SIZE_MB = 250;
```

---

### 12. **Función `nuclearRefresh` Poco Confiable**
**Ubicación:** `modules/4_Timeline.jsx:567-586`

```javascript
nuclearRefresh: function() {
    try {
        var seq = app.project.activeSequence;
        if (!seq) return "REFRESH_NO_SEQ";

        // 1. Forzar redibujado de la interfaz
        seq.attachCustomMetadata("RE_DRAW", Math.random().toString());

        // 2. Meneo al cabezal usando segundos (1ms es suficiente para despertar a la UI)
        var pos = seq.getPlayerPosition();
        var nudge = new Time();
        nudge.seconds = pos.seconds + 0.001; 
        
        seq.setPlayerPosition(nudge.ticks);
        seq.setPlayerPosition(pos.ticks);
        
        app.setAppFocus(); 
        return "REFRESH_OK";
    } catch(e) { return "REFRESH_ERR: " + e.message; }
}
```

**Problema:** 
- `attachCustomMetadata` no está documentado en la API oficial de Premiere
- Mover el playhead 1ms puede no ser suficiente en secuencias largas
- `app.setAppFocus()` puede robar el foco del usuario

**Recomendación:** Documentar por qué es necesario este "hack" y considerar alternativas oficiales.

---

## 🟡 PROBLEMAS MEDIOS (Mejoras Recomendadas)

### 13. **Falta de Documentación de Funciones**
**Problema:** Solo hay comentarios esporádicos. Funciones complejas como `_findAndExtractTheme` (auxiliary.js:166) no tienen JSDoc.

**Recomendación:** Añadir JSDoc a todas las funciones públicas:

```javascript
/**
 * Busca el archivo Tema-Titol más reciente basándose en fecha efectiva y tamaño
 * @param {Array} foundFiles - Lista de archivos encontrados
 * @param {string} programa - ID del programa (ej: "MATINS")
 * @param {string} bloc - ID del bloque (ej: "V1")
 * @returns {Object|null} {nomTema: string, nombreArchivoGanador: string}
 */
function _findAndExtractTheme(foundFiles, programa, bloc) {
    // ...
}
```

---

### 14. **Uso Excesivo de `try-catch` Vacíos**
**Ubicación:** Múltiples archivos

**Ejemplos:**
```javascript
// auxiliary.js:118
try {
    var item = root.children[i];
    // ...
} catch(e) {}  // ⚠️ Error silenciado sin log

// 4_Timeline.jsx:516-520
try {
    if (seq.captionTracks) {
        for (i = 0; i < seq.captionTracks.numTracks; i++) 
            seq.captionTracks[i].setTargeted(false);
    }
} catch(e) {}  // ⚠️ No sabemos si falló
```

**Recomendación:** Al menos loguear el error:

```javascript
} catch(e) {
    $.writeln("[WARN] Error accediendo a captionTracks: " + e.message);
}
```

---

### 15. **Inconsistencia en Retorno de Valores**
**Problema:** Algunas funciones retornan `true/false`, otras `"OK"/"ERR"`, otras objetos.

**Ejemplos:**
```javascript
// 3_Project.jsx:37-42
save: function() {
    if (app.project.path) {
        app.project.save();
        return true;  // ⚠️ Booleano
    }
    return false;
}

// 4_Timeline.jsx:102
setSequenceInOut: function(inSec, outSec) {
    // ...
    return "OK";  // ⚠️ String
}

// 2_IO.jsx:26
scanDirectory: function(folderPath, searchPattern, hoursBack) {
    // ...
    return str;  // ⚠️ JSON string
}
```

**Recomendación:** Estandarizar a un patrón:
- Funciones de acción: `{success: boolean, message?: string, data?: any}`
- Funciones de consulta: Retornar el dato directamente o `null`

---

### 16. **Falta de Validación de Tipos en ExtendScript**
**Ubicación:** Funciones que reciben parámetros del puente JS

**Ejemplo:**
```javascript
// jsx/main.jsx:209-214
function jsx_rippleTrimClipStart(trackIndex, clipIndex, cutTime, type) { 
    return FASTPASS.Timeline.rippleTrimStart(trackIndex - 1, clipIndex, cutTime, type); 
}
```

**Problema:** Si `trackIndex` viene como string `"2"` en lugar de número `2`, la resta dará `"2" - 1 = 1` (funciona por coerción), pero es frágil.

**Recomendación:**
```javascript
function jsx_rippleTrimClipStart(trackIndex, clipIndex, cutTime, type) {
    return FASTPASS.Timeline.rippleTrimStart(
        Number(trackIndex) - 1, 
        Number(clipIndex), 
        parseFloat(cutTime), 
        type
    ); 
}
```

---

### 17. **Lógica de Negocio Hardcodeada en Múltiples Lugares**
**Problema:** La lógica de conductores está duplicada:

- `auxiliary.js:386-399` (función `jsx_prepFlowData`)
- `js/logic/logic_state.js:207-223` (función `getConductorActivo`)

**Impacto:** Si cambia un conductor, hay que actualizar 2 lugares.

**Recomendación:** Centralizar en un solo lugar (preferiblemente en `config.js`).

---

### 18. **Falta de Límite en Bucles de Búsqueda**
**Ubicación:** `modules/3_Project.jsx:312-327` (función `findItemInProject`)

```javascript
findItemInProject: function(name) {
    var root = app.project.rootItem;
    function search(folder, n) {
        for (var i = 0; i < folder.children.numItems; i++) {
            var child = folder.children[i];
            if (child.type === 1 && child.name === n) return child;
            if (child.type === 2) {
                var found = search(child, n);  // ⚠️ Recursión sin límite
                if (found) return found;
            }
        }
        return null;
    }
    return search(root, name);
}
```

**Problema:** Si hay una estructura de carpetas muy profunda (>100 niveles), puede causar stack overflow.

**Recomendación:** Añadir un parámetro de profundidad máxima:

```javascript
function search(folder, n, depth) {
    if (depth > 50) return null;  // Límite de seguridad
    // ...
    var found = search(child, n, depth + 1);
    // ...
}
```

---

### 19. **Uso de `setTimeout` sin Limpieza**
**Ubicación:** `main.js:93-98`

```javascript
setTimeout(() => {
    const p = document.getElementById('programa');
    if (p && p.value && FASTPASS_UI.Logic.updateConductorSelector) {
        FASTPASS_UI.Logic.updateConductorSelector(p.value);
    }
}, 500);
```

**Problema:** Si el usuario cierra el panel antes de 500ms, el timeout seguirá ejecutándose.

**Recomendación:** Guardar el ID del timeout y limpiarlo en un evento `beforeunload`:

```javascript
var initTimeout = setTimeout(() => {
    // ...
}, 500);

window.addEventListener('beforeunload', () => {
    clearTimeout(initTimeout);
});
```

---

### 20. **Falta de Versionado en Manifest**
**Ubicación:** `CSXS/manifest.xml:2`

```xml
<ExtensionManifest Version="6.0" ExtensionBundleId="com.test.debug" ExtensionBundleVersion="1.0" ...>
```

**Problema:** 
- El ID es `com.test.debug` (nombre genérico de desarrollo)
- La versión es `1.0` pero el HTML dice `v7.0.1`

**Recomendación:** Sincronizar versiones:

```xml
<ExtensionManifest Version="6.0" 
    ExtensionBundleId="com.ccrtv.fastpass" 
    ExtensionBundleVersion="7.0.1" 
    ExtensionBundleName="FAST_PASSS">
```

---

## 🔵 PROBLEMAS BAJOS (Optimizaciones)

### 21. **Polyfill de JSON Duplicado**
**Ubicación:** 
- `auxiliary.js:28-38` (Polyfill de `Object.keys`)
- `modules/4_Timeline.jsx:6-27` (Polyfill de `JSON.stringify`)

**Problema:** Cada módulo tiene su propio polyfill. Si se cargan varios, se sobrescriben.

**Recomendación:** Mover todos los polyfills a un archivo `0_Polyfills.jsx` que se cargue primero.

---

### 22. **Uso Ineficiente de Búsquedas**
**Ubicación:** `auxiliary.js:103-149` (función `_findItemInProject`)

**Problema:** Busca linealmente en 3 ubicaciones (root, CHYRONS, Conductors) cada vez.

**Recomendación:** Crear un caché de items al inicio:

```javascript
var _itemCache = {};

function _buildCache() {
    var root = app.project.rootItem;
    for (var i = 0; i < root.children.numItems; i++) {
        _itemCache[root.children[i].name] = root.children[i];
    }
}

function _findItemInProject(name) {
    if (!_itemCache[name]) _buildCache();
    return _itemCache[name] || null;
}
```

---

### 23. **Logs Excesivos en Producción**
**Ubicación:** Múltiples archivos

Hay más de **100 llamadas** a `console.log()`, `log()`, `$.writeln()`, etc.

**Ejemplos:**
```javascript
// flow_nou.js:21
console.log(`⏯️ Ejecutando MainAction: [${action}]`, data || 'no-data');

// logic_state.js:16
console.log("🧠 [LOGIC] --- INICIO ANÁLISIS DE CONTEXTO (WILDCARD) ---");
```

**Recomendación:** Implementar un sistema de niveles de log:

```javascript
var LOG_LEVEL = 0; // 0=NONE, 1=ERROR, 2=WARN, 3=INFO, 4=DEBUG

function log(message, level) {
    if (level <= LOG_LEVEL) {
        console.log(message);
    }
}
```

---

### 24. **Falta de Minificación**
**Problema:** Los archivos JavaScript no están minificados, ocupando más espacio del necesario.

**Recomendación:** Añadir un paso de build con herramientas como Terser o UglifyJS.

---

### 25. **Uso de `var` en Lugar de `let/const`**
**Ubicación:** Archivos JavaScript modernos (no ExtendScript)

**Ejemplo:**
```javascript
// flow_nou.js:8
var FASTPASS_UI = window.FASTPASS_UI || {};
```

**Recomendación:** Usar `const` para variables que no cambian:

```javascript
const FASTPASS_UI = window.FASTPASS_UI || {};
```

---

## 📊 PROBLEMAS DE ARQUITECTURA

### 26. **Acoplamiento Fuerte entre Módulos**
**Problema:** Los módulos ExtendScript se referencian directamente entre sí:

```javascript
// 4_Timeline.jsx:150
var item = FASTPASS.Project._lastFoundChyron;  // ⚠️ Acceso a variable privada de otro módulo
```

**Recomendación:** Usar un patrón de eventos o un mediador.

---

### 27. **Falta de Separación de Responsabilidades**
**Problema:** `flow_nou.js` tiene 366 líneas y hace demasiadas cosas:
- Gestión de estado
- Lógica de negocio
- Llamadas a la API
- Manipulación de DOM

**Recomendación:** Dividir en:
- `ProjectManager.js` - Gestión de proyectos
- `FileImporter.js` - Importación de archivos
- `SequenceMounter.js` - Montaje de secuencias

---

### 28. **Falta de Tests**
**Problema:** No hay ningún archivo de test (ni unitarios ni de integración).

**Recomendación:** Añadir tests al menos para:
- Parsing de nombres de archivo
- Lógica de selección de conductores
- Validación de rutas

---

### 29. **Falta de Manejo de Concurrencia**
**Problema:** Si el usuario hace clic en varios botones rápidamente, pueden ejecutarse múltiples workflows en paralelo.

**Ejemplo:**
```javascript
// main.js:40
if (btnIn) btnIn.addEventListener('click', () => callWorkflow('Cut', 'runCutIn'));
```

**Recomendación:** Implementar un sistema de "busy lock":

```javascript
var isBusy = false;

function callWorkflow(module, method) {
    if (isBusy) {
        console.warn("Operación en curso, espera...");
        return;
    }
    isBusy = true;
    
    try {
        FASTPASS_UI.Workflows[module][method]();
    } finally {
        isBusy = false;
    }
}
```

---

### 30. **Falta de Rollback en Operaciones Complejas**
**Problema:** Si falla el montaje de la secuencia a mitad (ej: se importa el MP4 pero falla el SRT), no hay forma de deshacer.

**Recomendación:** Implementar un patrón de transacción:

```javascript
async function mountSequenceWithRollback(seqName, files) {
    const actions = [];
    
    try {
        // Guardar estado inicial
        const initialState = await captureState();
        
        // Ejecutar acciones
        await importMP4(files.mp4);
        actions.push({undo: () => deleteItem(files.mp4.name)});
        
        await importSRT(files.srt);
        actions.push({undo: () => deleteItem(files.srt.name)});
        
        // ...
        
    } catch(e) {
        // Rollback
        for (let i = actions.length - 1; i >= 0; i--) {
            await actions[i].undo();
        }
        throw e;
    }
}
```

---

## 🔍 PROBLEMAS DE COMPATIBILIDAD

### 31. **Versión Mínima de Premiere No Clara**
**Ubicación:** `CSXS/manifest.xml:13`

```xml
<Host Name="PPRO" Version="[14.0,99.0]"/>
```

**Problema:** 
- Premiere 14.0 es de 2020
- Algunas APIs usadas (como `captionTracks`) son de versiones más recientes
- No hay validación de versión en el código

**Recomendación:** 
1. Documentar la versión mínima real (probablemente 22.0+)
2. Añadir validación al inicio:

```javascript
function jsx_checkPremiereVersion() {
    var version = parseFloat(app.version);
    if (version < 22.0) {
        return "ERROR: Se requiere Premiere Pro 2022 o superior";
    }
    return "OK";
}
```

---

### 32. **Uso de APIs No Documentadas**
**Ubicación:** Múltiples archivos

**Ejemplos:**
```javascript
// 4_Timeline.jsx:573
seq.attachCustomMetadata("RE_DRAW", Math.random().toString());  // ⚠️ No documentado

// 3_Project.jsx:184
p.openSequence(s.sequenceID);  // ⚠️ Método no oficial
```

**Recomendación:** Documentar qué versión de Premiere soporta cada API y tener fallbacks.

---

### 33. **Falta de Soporte para macOS**
**Ubicación:** `js/core/utils.js:157-164`

```javascript
triggerSceneShortcut: function() {
    try {
        var ps = "Add-Type -AssemblyName System.Windows.Forms; ...";
        if (window.cep && window.cep.process) {
             window.cep.process.createProcess("C:\\Windows\\System32\\WindowsPowerShell\\...");
        }
    } catch (e) {}
}
```

**Problema:** Esta función solo funciona en Windows. En macOS fallará silenciosamente.

**Recomendación:** Detectar el OS y usar AppleScript en macOS:

```javascript
triggerSceneShortcut: function() {
    const os = window.navigator.platform;
    
    if (os.indexOf('Win') !== -1) {
        // Código PowerShell actual
    } else if (os.indexOf('Mac') !== -1) {
        const script = 'tell application "System Events" to keystroke "s" using {command down, shift down, option down}';
        window.cep.process.createProcess('/usr/bin/osascript', ['-e', script]);
    }
}
```

---

### 34. **Rutas Hardcodeadas para Windows**
**Ubicación:** `auxiliary.js:11-18`, `js/core/config.js` (probablemente)

**Problema:** Todas las rutas usan backslashes (`\\`), lo cual no funciona en macOS.

**Recomendación:** Normalizar rutas usando la API de File:

```javascript
function normalizePath(path) {
    return path.replace(/\\/g, '/');
}
```

---

## 🛡️ PROBLEMAS DE SEGURIDAD

### 35. **Inyección de Código Potencial**
**Ubicación:** `js/core/utils.js:64-84` (función `callJSX`)

```javascript
callJSX: function(script) {
    return new Promise((resolve, reject) => {
        const full = "try { " + script + " } catch(e) { 'ERROR:' + e.message }";
        
        csInterface.evalScript(full, (res) => {
            // ...
        });
    });
}
```

**Problema:** Si `script` contiene input del usuario sin sanitizar, podría ejecutar código arbitrario.

**Ejemplo de ataque:**
```javascript
const userInput = '"; alert("HACKED"); "';
callJSX(`jsx_renameSequence("${userInput}", "nuevo")`);
// Ejecutaría: try { jsx_renameSequence(""; alert("HACKED"); "", "nuevo") } catch...
```

**Recomendación:** Escapar comillas en los parámetros:

```javascript
function escapeJSX(str) {
    return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

// Uso:
callJSX(`jsx_renameSequence("${escapeJSX(oldName)}", "${escapeJSX(newName)}")`);
```

---

### 36. **Falta de Validación de Permisos de Archivo**
**Ubicación:** `modules/2_IO.jsx:86`

```javascript
if (paths.length > 0) {
    app.project.importFiles(paths, true, targetBin, false); 
    return true;
}
```

**Problema:** No valida si los archivos son legibles antes de intentar importarlos.

**Recomendación:**
```javascript
for (var i = 0; i < paths.length; i++) {
    var f = new File(paths[i]);
    if (!f.open('r')) {
        throw new Error("No se puede leer el archivo: " + paths[i]);
    }
    f.close();
}
```

---

### 37. **Exposición de Rutas Internas en Logs**
**Ubicación:** Múltiples archivos

**Ejemplo:**
```javascript
// logic_state.js:72
console.log(`🕵️‍♂️ [STATE] Ruta Proyecto: ${baseFolder}`);
// Imprime: \\DSMEDIA07\portal324\...
```

**Problema:** Si los logs se comparten (ej: para debug), exponen la estructura interna de la red.

**Recomendación:** Ofuscar rutas en logs de producción:

```javascript
function sanitizePath(path) {
    return path.replace(/\\\\.+?\\/g, '\\\\[SERVER]\\');
}
```

---

## 📝 PROBLEMAS DE MANTENIBILIDAD

### 38. **Falta de Changelog**
**Problema:** No hay un archivo `CHANGELOG.md` que documente los cambios entre versiones.

**Recomendación:** Crear un changelog siguiendo el formato [Keep a Changelog](https://keepachangelog.com/).

---

### 39. **Falta de README Técnico**
**Problema:** No hay documentación sobre:
- Cómo instalar la extensión
- Estructura del proyecto
- Cómo hacer debugging
- Cómo hacer build

**Recomendación:** Crear un `README.md` con estas secciones.

---

### 40. **Nombres de Variables Poco Descriptivos**
**Ejemplos:**
```javascript
// flow_nou.js:155
let t = "PENDENT";  // ⚠️ ¿Qué es 't'?

// auxiliary.js:182
var progArchName = CONFIG.mapeoProgramas[programa].archivo_wott;  // Mejor: wottProgramPrefix
```

**Recomendación:** Usar nombres completos:

```javascript
let themeName = "PENDENT";
let wottProgramPrefix = CONFIG.mapeoProgramas[programa].archivo_wott;
```

---

### 41. **Funciones Demasiado Largas**
**Problema:** Varias funciones superan las 100 líneas:

- `jsx_prepFlowData` (auxiliary.js:372-446) - **74 líneas**
- `_runComplexIngest` (flow_nou.js:44-244) - **200 líneas** ⚠️
- `findAndPlaceLargeChyron` (4_Timeline.jsx:362-418) - **56 líneas**

**Recomendación:** Refactorizar en funciones más pequeñas (máximo 50 líneas por función).

---

### 42. **Falta de Constantes Globales**
**Problema:** Valores como nombres de bins, tracks, etc. están hardcodeados:

```javascript
// flow_nou.js:200
await utils.importList(activeWotts, "CHYRONS");  // ⚠️ String literal

// flow_nou.js:318
const resV1 = await callJSX(`jsx_overwriteClip(0, ...)`);  // ⚠️ Índice hardcodeado
```

**Recomendación:** Definir constantes:

```javascript
const BINS = {
    CHYRONS: "CHYRONS",
    CONDUCTORS: "Conductors",
    ROOT: "root"
};

const TRACKS = {
    VIDEO_1: 0,
    VIDEO_3: 2,
    VIDEO_5: 4
};

// Uso:
await utils.importList(activeWotts, BINS.CHYRONS);
const resV1 = await callJSX(`jsx_overwriteClip(${TRACKS.VIDEO_1}, ...)`);
```

---

## ⚠️ PROBLEMAS DE RENDIMIENTO

### 43. **Búsquedas Repetidas en Bucles**
**Ubicación:** `auxiliary.js:186-193`

```javascript
for (var i = 0; i < foundFiles.length; i++) {
    if (foundFiles[i] && foundFiles[i].name && foundFiles[i].name.match(themePattern)) {
        var fileObj = new File(foundFiles[i].fsName);  // ⚠️ Crea objeto File en cada iteración
        if (fileObj.exists) {
            candidates.push(fileObj); 
        }
    }
}
```

**Problema:** Crear objetos `File` es costoso. Si hay 100 archivos, crea 100 objetos innecesariamente.

**Recomendación:** Filtrar primero por nombre, luego crear objetos:

```javascript
var matchingNames = foundFiles.filter(f => f && f.name && f.name.match(themePattern));

for (var i = 0; i < matchingNames.length; i++) {
    var fileObj = new File(matchingNames[i].fsName);
    if (fileObj.exists) candidates.push(fileObj);
}
```

---

### 44. **Falta de Debouncing en Eventos**
**Ubicación:** `main.js:80-81`

```javascript
if (selectPrograma) selectPrograma.addEventListener('change', handleSelectionChange);
if (selectBloc) selectBloc.addEventListener('change', handleSelectionChange);
```

**Problema:** Si el usuario cambia rápidamente entre opciones, se ejecutan múltiples llamadas a `checkContext()`.

**Recomendación:** Implementar debouncing:

```javascript
function debounce(func, wait) {
    let timeout;
    return function(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}

const debouncedCheck = debounce(handleSelectionChange, 300);
if (selectPrograma) selectPrograma.addEventListener('change', debouncedCheck);
```

---

### 45. **Serialización JSON Ineficiente**
**Ubicación:** `js/core/utils.js:97`

```javascript
const safeJsonPayload = JSON.stringify(JSON.stringify(cleanList));
```

**Problema:** Doble serialización es costosa y difícil de leer.

**Recomendación:** Aunque el comentario dice "INTOCABLE", investigar si realmente es necesario. Probablemente se pueda solucionar escapando correctamente en ExtendScript.

---

## 🐛 BUGS POTENCIALES

### 46. **Condición de Carrera en Inicialización**
**Ubicación:** `main.js:88-98`

```javascript
const progInicial = document.getElementById('programa').value;
if (progInicial && FASTPASS_UI.Logic.updateConductorSelector) {
    FASTPASS_UI.Logic.updateConductorSelector(progInicial);
}

setTimeout(() => {
    const p = document.getElementById('programa');
    if (p && p.value && FASTPASS_UI.Logic.updateConductorSelector) {
        FASTPASS_UI.Logic.updateConductorSelector(p.value);
    }
}, 500);
```

**Problema:** Se llama a `updateConductorSelector` dos veces: una inmediatamente y otra tras 500ms. Esto puede causar:
- Doble llamada innecesaria
- Si el usuario cambia el selector en esos 500ms, se sobrescribe

**Recomendación:** Eliminar la primera llamada o el timeout (no ambos).

---

### 47. **Falta de Validación de Extensión de Archivo**
**Ubicación:** `modules/2_IO.jsx:33-48`

```javascript
var regex = new RegExp(searchPattern.replace(/\*/g, ".*").replace(/\?/g, "."), "i");
var allFiles = folder.getFiles();
// ...
for (var i = 0; i < allFiles.length; i++) {
    var f = allFiles[i];
    if (f instanceof File && regex.test(f.name) && f.modified.getTime() >= limit) {
        result.push({...});
    }
}
```

**Problema:** `folder.getFiles()` puede devolver carpetas también. Aunque se valida con `f instanceof File`, el regex podría matchear una carpeta llamada `"Video.mov"` (sin extensión real).

**Recomendación:** Validar que sea un archivo real:

```javascript
if (f instanceof File && !f.hidden && regex.test(f.name) && f.modified.getTime() >= limit) {
    // Validación extra: verificar que tenga extensión
    if (f.name.lastIndexOf('.') > 0) {
        result.push({...});
    }
}
```

---

## 📋 RESUMEN DE PROBLEMAS POR CATEGORÍA

| Categoría | Cantidad | Ejemplos Clave |
|-----------|----------|----------------|
| 🔴 **Críticos** | 5 | Debugger activo, Race conditions, JSON inseguro |
| 🟠 **Altos** | 7 | Código comentado, Falta de manejo de errores |
| 🟡 **Medios** | 10 | Falta de documentación, Hardcoded values |
| 🔵 **Bajos** | 5 | Logs excesivos, Uso de `var` |
| 📊 **Arquitectura** | 5 | Acoplamiento fuerte, Falta de tests |
| 🔍 **Compatibilidad** | 4 | Versión de Premiere, Soporte macOS |
| 🛡️ **Seguridad** | 3 | Inyección de código, Validación de permisos |
| 📝 **Mantenibilidad** | 5 | Falta de README, Nombres poco descriptivos |
| ⚠️ **Rendimiento** | 3 | Búsquedas repetidas, Falta de debouncing |
| 🐛 **Bugs** | 2 | Condición de carrera, Validación de archivos |

**TOTAL: 47 problemas identificados**

---

## 🎯 RECOMENDACIONES PRIORITARIAS

### Para Resolver ANTES de Producción:

1. **Eliminar el `debugger`** (Problema #2)
2. **Arreglar el manejo de JSON** (Problema #3)
3. **Implementar validación de importación** (Problema #4)
4. **Validar rutas de red al inicio** (Problema #5)
5. **Sanitizar inputs en `callJSX`** (Problema #35)

### Para Mejorar la Calidad del Código:

1. **Eliminar código comentado** (Problema #6)
2. **Estandarizar nomenclatura** (Problema #7)
3. **Añadir documentación JSDoc** (Problema #13)
4. **Implementar sistema de logs con niveles** (Problema #23)
5. **Crear README y CHANGELOG** (Problemas #38, #39)

### Para Mejorar la Arquitectura:

1. **Separar responsabilidades en módulos** (Problema #27)
2. **Añadir tests unitarios** (Problema #28)
3. **Implementar sistema de busy lock** (Problema #29)
4. **Centralizar constantes** (Problema #42)

---

## 💬 RESPUESTAS DEL EQUIPO

He consultado con el equipo de desarrollo y estas son las aclaraciones:

### 1. **Versión Mínima de Premiere Pro**
**Respuesta:** Premiere Pro 2022 (versión 22.x)

**Acción Requerida:** Actualizar el manifest.xml:
```xml
<Host Name="PPRO" Version="[22.0,99.0]"/>
```

---

### 2. **Archivo `auxiliary.js`**
**Respuesta:** No se usa activamente, es un backup.

**Acción Requerida:** Mover a la carpeta `/BackUp/` para evitar confusión.

---

### 3. **Doble Serialización JSON**
**Respuesta:** No está claro el motivo exacto.

**Recomendación:** Investigar si es realmente necesario o si se puede simplificar con un escape correcto de comillas.

---

### 4. **Soporte para macOS**
**Respuesta:** No se va a utilizar en ningún caso.

**Acción Requerida:** 
- Eliminar el problema #33 de la lista de prioridades
- Mantener las rutas con backslashes de Windows
- Documentar en el README que solo soporta Windows

---

### 5. **Valor `608.0` en Cálculo de Posición X**
**Respuesta:** Es el **ancho total de la secuencia 9:16** en píxeles.

**Acción Requerida:** Crear constante descriptiva:
```javascript
const SEQUENCE_WIDTH_9x16 = 608.0; // Ancho total de secuencia vertical en píxeles
var valInvertido = SEQUENCE_WIDTH_9x16 - parseFloat(xPixelValue);
```

**Recomendación Adicional:** Este valor debería estar en la ventana de setup junto con otras variables configurables.

---

### 6. **Función `nuclearRefresh`**
**Respuesta:** Es una manera ultra-asegurada de refrescar el timeline.

**Justificación:** La API oficial de Premiere no siempre refresca la UI correctamente, especialmente después de operaciones complejas. Este "hack" fuerza el redibujado.

**Acción Requerida:** Documentar en el código:
```javascript
/**
 * NUCLEAR REFRESH - Fuerza el redibujado completo del timeline
 * 
 * IMPORTANTE: Este método usa técnicas no oficiales porque la API estándar
 * de Premiere no siempre refresca la UI correctamente tras operaciones complejas.
 * 
 * Técnicas utilizadas:
 * 1. attachCustomMetadata con valor aleatorio para invalidar caché
 * 2. Mover el playhead 1ms y volver (wake up UI)
 * 3. Forzar foco en la aplicación
 * 
 * @returns {string} "REFRESH_OK" si tuvo éxito, "REFRESH_ERR: ..." si falló
 */
nuclearRefresh: function() {
    // ...
}
```

---

### 7. **Flujo de Trabajo Típico del Usuario**

**Descripción Completa:**

1. **Selección Inicial**
   - Usuario selecciona **Programa** y **Bloque** en los selectores

2. **Importación Automática**
   - Se importan: Video (.mp4), Subtítulos (.srt), Chyrons (.mov)
   - Se coloca el video en el timeline

3. **Recorte de Video**
   - Se recorta por el principio (IN) y final (OUT) para delimitar el video a emitir
   - Se recortan resto de clips y selección de secuencia referido al final del video

4. **Colocación de Elementos Principales**
   - Se coloca el **Conductor** (presentador)
   - Se coloca el archivo **Tema-Titol** (gráfico principal)

5. **Gestión de Chyrons**
   - Se colocan en el mejor orden posible (conocido) los chyrons
   - ⚠️ **Nota:** Este proceso es complejo y requiere lógica específica

6. **Edición de Video**
   - Se trocea el clip de video usando **Scene Detection**
   - Se ajusta lateralmente cada clip con el **slider**
   - Se pueden añadir **keyframes** para panorámicas laterales

7. **Subtítulos**
   - Se colocan los SRT en el timeline
   - Hay botones para edición rápida de subtítulos

8. **Gráficos Adicionales**
   - Se coloca algún tipo específico de grafismo (fondos 16:9, etc.)

9. **Exportación**
   - Se hace **render del video**
   - Se exporta la **portada** (frame específico)

10. **Modo UPDATE**
    - Si en el proceso falta algún archivo, clicando el botón principal en modo UPDATE
    - Se rastrea si ya está el archivo disponible en la red
    - Se importa automáticamente

**Acción Requerida:** Crear un diagrama de flujo en el README para documentar este proceso.

---

### 8. **Sistema de Telemetría**
**Respuesta:** No hay sistema de telemetría o logs de errores en producción.

**Recomendación:** Considerar implementar un sistema básico de logging a archivo para debug post-mortem:

```javascript
// Ejemplo de logger a archivo
function logToFile(message, level) {
    const logPath = Folder.userData.fsName + "/FASTPASS_logs.txt";
    const f = new File(logPath);
    f.open('a'); // Append mode
    f.writeln(`[${new Date().toISOString()}] [${level}] ${message}`);
    f.close();
}
```

---

## 📚 RECURSOS RECOMENDADOS

Para mejorar el código, recomiendo consultar:

1. **Documentación Oficial de Adobe:**
   - [Premiere Pro Scripting Guide](https://ppro-scripting.docsforadobe.dev/)
   - [CEP Cookbook](https://github.com/Adobe-CEP/CEP-Resources)

2. **Herramientas de Desarrollo:**
   - [ExtendScript Debugger](https://marketplace.visualstudio.com/items?itemName=Adobe.extendscript-debug)
   - [CEP Extension Debugger](https://github.com/Adobe-CEP/CEP-Resources/blob/master/CEP_9.x/Documentation/CEP%209.0%20HTML%20Extension%20Cookbook.md#debugging-unsigned-extensions)

3. **Buenas Prácticas:**
   - [Airbnb JavaScript Style Guide](https://github.com/airbnb/javascript)
   - [Clean Code JavaScript](https://github.com/ryanmcdermott/clean-code-javascript)

---

## ✅ CONCLUSIÓN

La extensión tiene una **arquitectura sólida** y demuestra un buen entendimiento de la API de Premiere Pro. Sin embargo, hay varios problemas que deben resolverse antes de considerarla lista para producción.

**Puntos Fuertes:**
- ✅ Separación clara entre ExtendScript y JavaScript moderno
- ✅ Uso de Promises para operaciones asíncronas
- ✅ Sistema de logging implementado
- ✅ Manejo de múltiples contextos (NEW, UPDATE, LOAD, GO)

**Puntos a Mejorar:**
- ❌ Falta de validación y manejo de errores robusto
- ❌ Código duplicado y comentado
- ❌ Falta de tests
- ❌ Documentación insuficiente

**Estimación de Esfuerzo para Resolver Problemas Críticos:**
- 🔴 Críticos (5): ~2-3 días
- 🟠 Altos (7): ~3-4 días
- 🟡 Medios (10): ~5-7 días

**Total estimado:** 10-14 días de trabajo para resolver todos los problemas críticos y altos.

---

**Fin del Informe**

*Si necesitas aclaraciones sobre algún punto específico o quieres que profundice en algún problema, no dudes en preguntar.*
