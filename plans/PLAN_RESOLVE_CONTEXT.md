# PLAN: Método Maestro `resolveContext()`

> **Objetivo**: Unificar la decisión de "qué día/proyecto/media/escaleta" usar en un solo método, eliminando las inconsistencias detectadas.

---

## 🔍 Diagnóstico de inconsistencias actuales

| # | Síntoma | Causa raíz | Ubicación |
|---|---------|-----------|-----------|
| 1 | Proyecto de hace 3 días se carga como "hoy" | `isDateDirInTemporalWindow` usaba mtime del directorio (no fiable) → **ya corregido** | `utils.js` |
| 2 | `checkContext()` dice NEW cuando el proyecto existe | `dateDir` no se reseteaba al cambiar de bloque → **ya corregido** | `4_Context.js` |
| 3 | JSON de V4 se usa como fallback para V1 (sin cleanFeed) | `_isWithin22h` en `findLatest()` descarta V2/V3 por timestamp → **pendiente** | `escaleta_io.js` |
| 4 | Media de ayer se mezcla con proyecto de hoy | `Scanner._discardOld` usa `f.mtime` (fecha de modificación) en vez de fecha de creación | `Scanner.js` |
| 5 | Chyrons de días diferentes se cargan juntos | Mismo problema de mtime | `Scanner.js` |
| 6 | IN del clip desplazado ~34s | Tier0 cross-agrupacio ganaba sobre OnAir real → **ya corregido** | `escaleta_bounds.js` |
| 7 | Marcador rojo de IPD de otro bloque al final del timeline | `_detectFirstUngroupedItem` usaba rango del cleanFeed → **ya corregido** | `flow_assembly.js` |

---

## 📐 Principios de diseño

### Regla de oro: Ventana de 22h con fecha de creación

```
Para cada artefacto (proyecto, media, escaleta):
  - Buscar primero en el directorio de HOY
  - Si no existe, buscar en el directorio de AYER
  - Si no existe en AYER, NO buscar más atrás
  - NUNCA mezclar artefactos de días diferentes
```

### Fecha de creación vs modificación

| Atributo | Uso | Fiabilidad |
|----------|-----|-----------|
| `f.mtime` (LastWriteTime) | ❌ NO usar | Premiere auto-save modifica archivos → falsos positivos |
| `f.creationTime` (CreationTime) | ✅ Usar | Solo cambia al crear el archivo → fiable |
| Nombre de directorio (`DD_MM_YYYY`) | ✅ Usar | Fecha de emisión del programa → fuente de verdad |
| Timestamp en nombre de archivo (`YYYYMMDD_HHMMSS`) | ✅ Usar | Fecha de creación del JSON → fiable |

---

## 🏗️ Método `resolveContext(programa, bloque)`

### Firma

```js
FASTPASS_UI.Core.Context.resolveContext(programa, bloque) → {
    dateDir: "DD_MM_YYYY",        // Fecha decidida (hoy o ayer)
    conclusion: "NEW|LOAD|UPDATE|GO",
    projectFile: "Pruebas_...prproj" | null,
    escaletaMeta: { path, filename } | null,
    media: { mp4: { name, path, creationTime }, srt: { name, path, creationTime } },
    wotts: { tema, list },
    portada: { name, path }
}
```

### Algoritmo

```
1. IDENTIFICAR FECHA (dateDir)
   a. Extraer dateDir de la escaleta JSON más reciente para este programa+bloque
      (fuente única de verdad: el nombre del archivo contiene YYYYMMDD)
   b. Si no hay escaleta, usar getFormattedDate() (fecha del sistema)
   c. Validar que dateDir esté en la ventana temporal (hoy o ayer)
      → Si la escaleta es de hace 2+ días, forzar dateDir = hoy (nuevo proyecto)

2. BUSCAR PROYECTO
   a. Escanear folderPath = destinoBase + progData.directorio + "/" + dateDir + "/"
   b. Buscar archivo con patrón: Pruebas_{wott}_{bloque}_*.prproj
   c. Si no existe en dateDir:
      - Intentar el otro día de la ventana (si dateDir=hoy → probar ayer, y viceversa)
      - Si se encuentra, actualizar dateDir
      - Si no se encuentra en ningún día: conclusion = NEW

3. BUSCAR ESCALETA JSON
   a. findLatest(programArchivo, bloque) → buscar JSON del bloque
   b. Si no hay JSON del bloque, fallback secuencial V1→V2→V3→V4→V5
      (sin filtro _isWithin22h — usar solo el prefijo del programa y la fecha en el nombre)
   c. Validar que el JSON sea del mismo dateDir (extraer fecha del filename)

4. BUSCAR MEDIA (MP4, SRT)
   a. Escanear rutas.verticalitzacio
   b. Filtrar por prefijo: {archivo}_{bloque}_
   c. Filtrar por fecha de CREACIÓN (no modificación):
      - Convertir creationTime a DD_MM_YYYY
      - Solo aceptar archivos cuyo creationTime coincida con dateDir (hoy o ayer)
   d. Ordenar por creationTime descendente → el más reciente gana
   e. NUNCA mezclar MP4 de hoy con SRT de ayer (o viceversa)

5. BUSCAR WOTTS (Chyrons .MOV)
   a. Escanear rutas.chyrons
   b. Filtrar por: {wott}_{bloque}_ + .MOV
   c. Mismo filtro de creationTime que la media

6. DECIDIR CONCLUSIÓN
   - Si NO hay proyecto → NEW
   - Si hay proyecto Y está abierto en Premiere (activo) → UPDATE
   - Si hay proyecto Y está abierto (no activo) → GO
   - Si hay proyecto Y NO está abierto → LOAD
```

---

## 📁 Archivos a modificar

| Archivo | Cambio | Prioridad |
|---------|--------|-----------|
| **NUEVO**: `js/core/context_resolver.js` | Método `resolveContext()` | 🔴 Crítico |
| `js/core/utils.js` | `isDateDirInTemporalWindow` → añadir soporte para creación de directorios con `creationTime` | 🟡 Medio |
| `js/logic/Scanner.js` | `_discardOld` → usar `creationTime` en vez de `mtime` | 🔴 Crítico |
| `js/logic/Scanner.js` | `mediaAssets` y `wotts` → filtrar por creationDate = dateDir | 🔴 Crítico |
| `js/core/escaleta_io.js` | `findLatest` → eliminar `_isWithin22h`, usar solo prefijo y fecha | 🔴 Crítico |
| `js/core/4_Context.js` | `checkContext()` → delegar a `resolveContext()` | 🟡 Medio |
| `js/workflows/flow_mainButton.js` | `_fullScan()` → delegar a `resolveContext()` | 🟡 Medio |
| `js/workflows/flow_mainButton.js` | `_runNew()` → usar contexto resuelto | 🟡 Medio |
| `js/workflows/flow_mainButton.js` | `_runLoad()` → usar contexto resuelto | 🟡 Medio |

---

## 🧪 Verificación

Después de implementar, verificar estos escenarios:

| # | Escenario | Resultado esperado |
|---|-----------|-------------------|
| 1 | Hoy 11/06 12:00, abrir TNC V1. Escaleta 10/06, proyecto en 10/06, media en 10/06 | Carga proyecto de ayer (10/06) con media de ayer |
| 2 | Hoy 11/06 21:30, abrir TNV V1. Escaleta 11/06, proyecto en 11/06 | Carga/crea proyecto de hoy con media de hoy |
| 3 | Hoy 11/06 10:00, abrir TNM V1. No hay escaleta, no hay proyecto, no hay media | NEW → crea proyecto PENDENT con lo que haya |
| 4 | V1 sin JSON propio. V2 tiene JSON del mismo día | Usa JSON de V2 (fallback secuencial V1→V2) |
| 5 | Media MP4 de ayer (creationTime=10/06) y SRT de hoy (creationTime=11/06) en misma carpeta | Solo carga los de la fecha decidida por resolveContext |