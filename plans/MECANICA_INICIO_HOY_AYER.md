# Mecánica de inicio de trabajo: HOY por defecto, AYER con Ctrl+clic

> **Fecha:** 2026-09-04
> **Estado:** PROPUESTA cerrada en diseño · Pendiente de implementar en la próxima sesión
> **Alcance:** Cambio del mecanismo de arranque de la extensión (botón MAIN) para eliminar la deducción automática de la fecha de trabajo.
> **Archivo relacionado previo:** `plans/PLAN_RESOLVE_CONTEXT.md` (su paradigma "buscar hoy → si no, ayer" queda **sustituido** por el de este documento).

---

## 1. Problema

Hoy la extensión **deduce** con qué día trabajar mirando la hora del sistema y lo que "mandan" los repositorios. Esa deducción está repartida en varias capas que se corrigen entre sí:

| # | Mecanismo | Ubicación | Qué hace |
|---|-----------|-----------|----------|
| 1 | **TimeGuard** | `js/core/4_Context.js` → `_getValidDateDir()` (L36-72) | Según `PROGRAM_START_HOURS` (TNV 21:00, TNM 14:30, TNC 13:50) y `PRE_EMISSION_GUARD_HOURS = 2h`, decide `today` / `yesterday` / `block` (esperando emisión) |
| 2 | **FIX A1** | `4_Context.js` `checkContext()` (L178-218) | Si no hay proyecto en `dateDir`, escanea **directorios hermanos** con fecha y corrige `dateDir` al que tenga proyecto |
| 3 | **FIX A2** | `4_Context.js` (L223-256) | Corrige `dateDir` desde la **fecha del JSON de escaleta** encontrado |
| 4 | **FIX A3 (guarda 22h)** | `4_Context.js` (L258-328) | Si hoy no hay JSON "válido", reintenta con **ayer** y corrige `dateDir` a ayer; si tampoco, botón WAITING |
| 5 | **Fallback interno** | `js/workflows/flow_mainButton.js` `_runNew()` (L44-88) | Re-deduce `dateDir` desde la escaleta y, si hoy no hay JSON, hace **fallback explícito a ayer** (finestra 22h) |
| 6 | **Guarda por mtime** | `js/logic/Scanner.js` `_discardOld()` (L17-25) | Descarta ficheros por `f.mtime` en ventana de 22h. **No fiable** (auto-save de Premiere modifica mtimes) y permite colar artefactos del otro día |
| 7 | **Fallback sin fecha** | `Scanner.js` `mediaAssets()` (L91-94) | Si no encuentra MP4/SRT de la fecha pedida, **reintenta sin filtro de fecha** → puede tomar el del día anterior |

**Consecuencias (lo que queremos evitar):**
- Se abre un proyecto de *ayer* creyendo que es el de *hoy* (y viceversa).
- Se cargan **wotts/media/SRT de ayer dentro de un proyecto de hoy** (contaminación de días).
- El estado del botón depende de la hora del sistema y de mtimes, no de una decisión explícita del editor.

---

## 2. Decisiones cerradas

1. **WAITING**: si al seleccionar programa+bloque **no hay datos del día objetivo**, el botón pasa a **WAITING**. (Ver §5 y §6 para la definición exacta de "datos".)
2. **"Ayer" = el día natural anterior**, siempre. Todos los días hay producción (no hay fines de semana ni festivos especiales).
3. **Se elimina el bloqueo horario** (`PRE_EMISSION_GUARD_HOURS` y el "ESPERANT EMISSIÓ ... ~X min" derivado de `PROGRAM_START_HOURS`). El día NO se elige nunca por la hora del sistema.
4. **El botón no muestra la fecha** en su texto. El modo corrección se indica solo en el log/status ("modo correcció: ahir").

---

## 3. Nueva mecánica (resumen)

1. Al seleccionar **PROGRAMA + BLOQUE**, el botón **MAIN apunta siempre a HOY** (fecha del sistema).
2. La fecha de trabajo **nunca se deduce** de lo que haya en los repos. Es explícita: **hoy** por defecto, o **ayer** si el editor la pide.
3. **MAIN (clic normal)** = trabajo del día de **hoy**: recopila toda la información/media posible de HOY (escaleta, MP4, SRT, wotts, portadas) y crea/abre el proyecto del directorio de HOY.
4. **MAIN (Ctrl+clic)** = modo **corrección**: crea/abre el proyecto de **ayer** con todos los materiales de ayer.
5. Si en un proyecto de hoy abierto faltan datos o media → **ACTUALITZAR** rastrea y rellena lo que falte **sin salir de la fecha de trabajo** (nunca se busca en el otro día).
6. Regla transversal: **ningún módulo deduce ni corrige la fecha de trabajo**; todos reciben `ctx.dateDir` ya decidido (hoy|ayer).

---

---

## 4. Fecha de trabajo: definición

- **Hoy** (`dateDir_hoy`): `YYYY_MM_DD` del sistema en el instante del clic.
- **Ayer** (`dateDir_ayer`): día natural anterior a hoy (`hoy − 1 día`). Sin excepciones de fin de semana.
- **Formato interno**: `YYYY_MM_DD` (p. ej. `2026_09_04`).
- **Formato prefijo de búsqueda** (fecha en nombres de archivo): `YYYYMMDD` (sin guiones).
- **Cuándo se fija**: en el momento del clic sobre MAIN (hoy; ayer si `ctrlKey`/`metaKey`). Al cambiar de programa o bloque, `State.dateDir` se **resetea a hoy**.

---

## 5. INVENTARIO: archivos que hay que rastrear (núcleo del diseño)

Para decidir si "el día tiene datos / media" hay que rastrear, **siempre contra la fecha de trabajo**, los siguientes artefactos:

### 5.1 Escaleta JSON (DATOS — condición de arranque)
| Campo | Valor |
|---|---|
| Repo / ruta | `EscaletaReader.ESCALETES_PATH` (UNC; con `ESCALETES_PATH_DOMAIN` como fallback de resolución) |
| Contenido | Guion/estructura del programa (`liniesEscaleta`), por bloque (`agrupacio`) |
| Patrón de nombre | **Nuevo**: `YYYYMMDD_HHMMSS_PROGRAMA_BLOQUE_....json` → fecha = 1er segmento. **Antiguo**: `TN_VESPRE_20260904_215504.json` → fecha = penúltimo segmento |
| Función de búsqueda | `EscaletaReader.findLatest(archivo, bloque, datePrefix)` / `findLatestValid(...)` en `js/core/escaleta_io.js`. Con `datePrefix` ya filtra estrictamente (L178-188) |
| Cómo se data | Por el nombre (`YYYYMMDD`). **Nota**: `_extractDateFromName` de `escaleta_io.js` solo reconoce el formato nuevo; el antiguo lo extrae `utils.extractDateFromEscaletaFilename()`. Hay que unificar (ver §7) |
| Rol | **Es el "dato" del día.** Sin escaleta de la fecha objetivo ⇒ botón **WAITING** (§6) |
| Fallback permitido | Bloques V1→V5 **del mismo día** si el JSON del bloque no tiene líneas propias. **Nunca** caer a otro día |

### 5.2 MP4 cleanFeed (MEDIA)
| Campo | Valor |
|---|---|
| Repo / ruta | `config.rutas.verticalitzacio` (UNC `\\192.168.147.199\public\VERTICALITZACIO_INFORMATIUS\`) |
| Patrón de nombre | Contiene `{archivo}_{bloque}_` (p. ej. `TN_VESPRE_V1_...`) y termina en `.MP4`. La fecha puede estar en cualquier segmento `YYYYMMDD` u `YYYYMMDDHHMMSS` (`Scanner._extractDateFromFileName`) |
| Cómo se data | Por nombre; si no tiene fecha, por `created` (nunca `mtime`) |
| Función | `Scanner.mediaAssets(ctx, temaHint)` → `_filterMediaByDate` (`js/logic/Scanner.js` L81-162) |
| Problema actual | L91-94: si no hay de la fecha, **reintenta sin filtro** → hay que eliminar ese fallback |
| Rol | Media principal del bloque (V1). Si falta ⇒ semáforo `sem-mp4` en rojo/pendiente y **ACTUALITZAR** lo busca cuando llegue |

### 5.3 SRT (MEDIA auxiliar)
| Campo | Valor |
|---|---|
| Repo / ruta | Mismo `verticalitzacio` |
| Patrón | Contiene `{archivo}_{bloque}_` y termina en `.SRT`; suele llevar fecha en el nombre; si no, se data por `created` |
| Detalle | Dentro de un bloque puede haber varios `.srt` (uno por noticia); se prefiere el que coincide con el **tema** del proyecto (`_normalize`) |
| Rol | Si falta ⇒ semáforo `sem-srt`; se rellena con ACTUALITZAR / CARREGAR SRT |

### 5.4 Wotts / rótulos `.MOV` (MEDIA de grafismo)
| Campo | Valor |
|---|---|
| Repo / ruta | `config.rutas.chyrons` (`\\192.168.147.199\public\00_CHYRONS AUTOMATICS\3CatInfo\VERTICALITZACIO\`) |
| Patrón de nombre | `{wott}_{bloque}_...` + fecha (segmento `YYYYMMDD`) + `.MOV`. Ej: `TNV_V1_20260904_..._Tema-Titol....mov` |
| Cómo se data | Por nombre (`YYYYMMDD`); si no, por `created`; **si no se puede datar, hoy se conserva** (formatos antiguos) — decisión a revisar si queremos filtro duro |
| Función | `Scanner.wotts(ctx)` (L164-262). Ya aplica filtro por fecha del proyecto (2026-09-02), pero **antes** pasa por `_discardOld(mtime, 22h)` (L178) → revisar |
| Rol | Rótulos del bloque. Si faltan ⇒ semáforo `sem-wot` (n/esperados). **Es el caso típico de contaminación a evitar** (wotts de ayer en proyecto de hoy) |
### 5.5 Portadas `.PNG` (MEDIA complementaria)
| Campo | Valor |
|---|---|
| Repo / ruta | `config.rutas.chyrons` (misma carpeta que los wotts) |
| Patrón | `{wott}_{bloque}_...TEMA-TITOL....PNG` |
| Función | `Scanner.portadas(ctx)` (L264-310). Ya filtra por fecha del proyecto (2026-09-02); también pasa por `_discardOld` |
| Rol | Portada del tema; complementaria (no condiciona el arranque) |

### 5.6 Proyecto `.prproj` del día
| Campo | Valor |
|---|---|
| Repo / ruta | `config.rutas.destinoBase + progData.directorio + /` + `dateDir(YYYY_MM_DD)` + `/` |
| Patrón | `Pruebas_{token}_{bloque}_{tema}.prproj` (creado en `_runNew` con token = `wott`, p. ej. `Pruebas_TNV_V1_...`) |
| Función | `Scan.selectedProject(files, progKey, bloque)` |
| Problema actual | En `checkContext` se busca con `progKey = archivo_wott || archivo` (p. ej. `TN_VESPRE`), pero `_runNew` **crea** con `wott` (`TNV`) → posible desajuste en la detección del proyecto del mismo día. **Unificar token** (ver §7) |
| Rol | Determina la conclusión del botón: si existe ⇒ OBRIR/ACTUALITZAR/GO; si no ⇒ NOU |

### 5.7 Artefactos internos de la carpeta del día (NO son condiciones)
- Copia local de escaleta (`findInFolder`/`ensureLocalCopy`): `YYYYMMDD_HHMMSS_PROGRAMA_*.json`.
- JSON de análisis (`Analysis_Logic`, `analisis_estructura/...`).
- `SessionManifest` (guarda el contexto de la sesión) y logs (`_setLogPath`).
- Lock del proyecto (`.lock`) → estado LOCKED si lo tiene otro autor (se mantiene como hoy).

### 5.8 Resumen ejecutivo
> **El día "tiene datos"** ⇔ existe **escaleta JSON** de la fecha objetivo para el programa (+ bloque, con fallback V1→V5 del mismo día).
> **El día "tiene media"** ⇔ existen **MP4 y wotts** de la fecha objetivo (SRT/portadas se rellenan después).
> **No mezclar nunca**: todos los artefactos que se importen deben datarse con la fecha objetivo; si no hay de esa fecha, se devuelve vacío (no se cae al otro día).

---

## 6. Matriz de decisión del botón MAIN (por fecha objetivo D = hoy | ayer)

| ¿Proyecto `.prproj` en `destinoBase/…/D`? | ¿Escaleta JSON de D? | Estado botón | Acción |
|---|---|---|---|
| Sí, abierto y activo en Premiere | (da igual) | **ACTUALITZAR** | `UPDATE` |
| Sí, abierto pero inactivo | (da igual) | **ANAR AL PROJECTE** | `GO` |
| Sí, cerrado en disco | (da igual) | **OBRIR** | `LOAD` |
| No | **Sí** (hay datos de D) | **NOU PROJECTE** | `NEW` (el semáforo informa de lo que falte: media/wotts/SRT/portada; se completa con ACTUALITZAR) |
| No | **No** (sin datos de D) | **WAITING** | No se crea nada. El editor decide: si quería trabajar, Ctrl+clic para el día anterior |

**Comportamiento del clic:**
- **Clic normal** → D = hoy (fecha del sistema en ese instante).
- **Ctrl+clic** (o Cmd+clic en Mac) → D = ayer.
- El texto del botón **no muestra la fecha** (decisión 4). El modo corrección se refleja en log/status y en el título del semáforo si es necesario.
- La fecha se resuelve **en el momento del clic**, no cuando se cambió el selector (evita arrastrar un `dateDir` obsoleto si el panel lleva abierto desde ayer).

---

## 7. Implicaciones por módulo (qué cambia)

| Módulo / archivo | Cambio |
|---|---|
| `js/core/state.js` | `State.dateDir` pasa a significar **fecha de trabajo explícita** (hoy o ayer). Se resetea a hoy al cambiar programa/bloque. Valor opcional: `State.workMode: 'today' \| 'yesterday'` para trazabilidad en logs |
| `js/core/4_Context.js` | ① Eliminar `_getValidDateDir()`/`PROGRAM_START_HOURS`/`PRE_EMISSION_GUARD_HOURS` y el "ESPERANT EMISSIÓ" → sustituir por helper simple `_targetDate(useYesterday)` (hoy = `getFormattedDate()`, ayer = hoy−1 día). ② `checkContext()`: quitar TimeGuard, FIX A1, FIX A2, FIX A3 y la corrección de `dateDir`; escanear SOLO la fecha objetivo (proyecto + escaleta de D). ③ Conclusión del botón según §6. ④ `updateButton()`: los `onclick` deben capturar el evento y pasar `ctrlKey/metaKey` (D=ayer) al action |
| `js/workflows/flow_mainButton.js` | ① `runMainAction(action, data)`: `data.dateDir` llega decidido (hoy|ayer). ② `_runNew()`: **eliminar** el bloque D7.1 de deducción/fallback a ayer (L44-88) y usar `ctx.dateDir` recibido. ③ `_runUpdate()/_runLoad()/_runGo()/_setupContext()`: usar `ctx.dateDir` explícito; no re-deducir. ④ Revisar que `_runUpdate` (ACTUALITZAR) importe solo lo faltante de la misma fecha |
| `js/logic/Scanner.js` | ① **Eliminar** el fallback "Intentant sense filtre de data" de `mediaAssets` (L91-94). ② Revisar/eliminar `_discardOld` (mtime+22h) en `wotts`, `portadas` y media: sustituir por filtro de fecha del proyecto. ③ Extraer helper común `_filterByWorkDate(files, ctx)` = data del nombre → `created` → descartar, y aplicarlo a media/wotts/portadas. ④ Mantener el filtro estricto de wotts/portadas por fecha (2026-09-02) |
| `js/core/escaleta_io.js` | ① `findLatest`/`findLatestValid`: **siempre** llamarlas con `datePrefix` = fecha objetivo; nunca sin prefijo en el flujo de arranque. ② Unificar la extracción de fecha de ambos formatos de nombre (usar `utils.extractDateFromEscaletaFilename` también en `_extractDateFromName`). ③ Eliminar cualquier reintento a otro día |
| `js/core/utils.js` | `isDateDirInTemporalWindow` deja de ser necesaria en el flujo de arranque (marcar para revisión/eliminación). `getFormattedDate()` = hoy; añadir `getYesterdayDate()` o equivalente |
| `js/core/11_Configuracio.js` / mapping | **Unificar token** de proyecto: el nombre creado (`_runNew`) y la búsqueda (`Scan.selectedProject`) deben usar el mismo token (recomendado `wott`, ej. `TNV`), para que el proyecto del día se detecte de forma fiable |
| `index.html` / bindings | El listener del botón principal ya lo gestiona `updateButton`; comprobar que el clic con Ctrl no se pierde (botón `<button>` con `onclick(ev)`). Sin cambios visuales de texto |
| Consumidores de `ctx.dateDir` | `Project_Logic.create`, `Analysis.saveEscaleta`, `SessionManifest`, `_setLogPath`, `naming.getProjectName`, SRT loader, markers: ya reciben `ctx`; **verificar que ninguno re-resuelve fecha por su cuenta** |

## 8. Reglas anti-contaminación (nuevas)

1. **R1 — Fecha siempre explícita**: toda búsqueda de artefacto se hace con la fecha objetivo (hoy o ayer). Ningún módulo "deduce" ni "corrige" el día.
2. **R2 — Datar por nombre primero**: la fecha de un archivo se extrae del nombre (`YYYYMMDD`); si no la lleva, de `created`; **nunca de `mtime`**.
3. **R3 — Vacío si no hay de la fecha**: si no existen artefactos de la fecha objetivo se devuelve `null`/`[]` y el estado (semáforo/WAITING) lo refleja. Prohibido reintentar "sin filtro de fecha" o con otra fecha.
4. **R4 — Modo corrección simétrico**: Ctrl+clic aplica las mismas reglas con la fecha de ayer.
5. **R5 — Nunca mezclar días**: no se importa MP4/SRT/wotts/portada de una fecha distinta a la del proyecto.
6. **R6 — La fecha se fija al pulsar**: se resuelve en el momento del clic en MAIN (no al cambiar el selector, no al abrir el panel). Cambiar programa/bloque ⇒ volver a hoy.
7. **R7 — Fallback de bloques solo dentro del día**: V1→V5 del mismo día; nunca buscar el JSON de otro día para "completar" un bloque.

---

## 9. Plan de implementación (orden sugerido para la próxima sesión)

> Objetivo: dejar la mecánica nueva funcionando sin romper el resto de flujos (marcadores, DF, SRT…). Cada paso debe poder probarse por separado.

- **P1 · Estado y fecha**: en `state.js`/`utils.js`, helper de fecha (`hoy`, `ayer natural`, formatos `YYYY_MM_DD` / `YYYYMMDD`). Reset a hoy al cambiar programa/bloque.
- **P2 · Context sin deducción**: `4_Context.js` — eliminar TimeGuard/A1/A2/A3; `checkContext()` escanea únicamente la fecha objetivo y produce la conclusión de §6 (incluye el caso WAITING sin escaleta del día).
- **P3 · Clic con Ctrl**: `4_Context.js updateButton()` + `flow_mainButton.runMainAction()` — capturar `ctrlKey/metaKey` y resolver la fecha en el momento del clic; pasar `data.dateDir` (hoy|ayer) a todas las acciones.
- **P4 · `_runNew` sin fallback**: eliminar la deducción D7.1 y el fallback a ayer; usar `ctx.dateDir` recibido para carpeta, nombre, manifest y assets.
- **P5 · Scanner con filtro de fecha duro**: eliminar el reintento sin fecha de `mediaAssets`, retirar `_discardOld` del camino crítico y aplicar `_filterByWorkDate` (nombre → `created`) en media, wotts y portadas.
- **P6 · Escaleta**: `findLatest*` siempre con `datePrefix` de la fecha objetivo; soportar ambos formatos de nombre de JSON al extraer la fecha; revisar llamadas (no pasar `null`).
- **P7 · Unificar token de proyecto**: crear y buscar con el mismo token (`wott`) para que la detección del proyecto del día sea fiable.
- **P8 · Revisión de consumidores**: comprobar que `Project_Logic`, `Analysis`, `SessionManifest`, SRT y markers usan `ctx.dateDir` sin recalcular.
- **P9 · Tests manuales** (escenarios de §10) y limpieza de funciones muertas (`isDateDirInTemporalWindow`, constantes horarias, etc.).

## 10. Escenarios de prueba

| # | Escenario | Resultado esperado |
|---|---|---|
| T1 | Hoy 09:00, TNV V1. No hay nada de hoy (ni JSON `20260905` ni media); sí hay todo de ayer `20260904` | Botón **WAITING**. Ctrl+clic → OBRIR (o NOU si no existe) el proyecto de `20260904` con media/wotts de `20260904` |
| T2 | Hoy 12:00, TNV V1. JSON `20260905` existe; MP4 de `20260905` aún no | Botón **NOU PROJECTE**. Crea proyecto del día `20260905` con escaleta; semáforo de media en rojo. Después de la emisión: **ACTUALITZAR** importa MP4/SRT/wotts de `20260905` sin tocar `20260904` |
| T3 | Proyecto de hoy abierto y activo | Botón **ACTUALITZAR**. ACTUALITZAR rellena lo faltante de HOY y nunca cambia a ayer |
| T4 | Con proyecto de hoy abierto, Ctrl+clic | Abre/cambia al proyecto de AYER (GO/LOAD), sin mezclar estados |
| T5 | Cambiar TNV V1 → TNV V2 (o TNM) tras haber usado modo ayer | `dateDir` vuelve a HOY (no arrastra ayer) |
| T6 | En `verticalitzacio`/`chyrons` hay MP4/wotts de `20260904` y `20260905`; proyecto de hoy abierto | Solo se listan/importan los de `20260905`; los de `20260904` se ignoran (log con descartados) |
| T7 | Carpeta del día sin proyecto pero JSON del día incompleto (bloque aún emitiéndose) | Decisión abierta (§11): se crea el proyecto y ACTUALITZAR completa, o WAITING hasta fin de bloque |
| T8 | A medianoche, panel abierto desde ayer | La fecha se resuelve al pulsar MAIN (hoy real), no la guardada en el selector |

## 11. Preguntas abiertas (para cerrar al implementar)

1. **Bloque del día "en emisión"**: si el JSON del día existe pero el bloque aún no ha terminado de emitirse (JSON incompleto), ¿NOU + ACTUALITZAR más tarde (recomendado) o WAITING hasta fin de bloque? Hoy lo gestiona `findLatestValid`.
2. **Token de proyecto**: ¿confirmamos `wott` (TNV/TNM/TNC) como token único de creación **y** búsqueda del `.prproj` (afecta a proyectos ya existentes con nombre `Pruebas_TN_VESPRE_...` si los hubiera)?
3. **Filtro duro en wotts/portadas**: cuando un archivo no se puede datar ni por nombre ni por `created`, ¿se descarta (filtro duro) o se conserva como hoy?

## 12. Referencias

- `plans/PLAN_RESOLVE_CONTEXT.md` (precedente; sustituido por la mecánica de este documento en lo relativo a elegir día).
- `js/core/4_Context.js` (`_getValidDateDir`, `checkContext`, `updateButton`, semáforos).
- `js/workflows/flow_mainButton.js` (`runMainAction`, `_runNew`, `_setupContext`, `_runUpdate/_runLoad/_runGo`, `_fullScan`).
- `js/logic/Scanner.js` (`mediaAssets`, `_filterMediaByDate`, `wotts`, `portadas`, `_discardOld`).
- `js/core/escaleta_io.js` (`findLatest`, `findLatestValid`, `findInFolder`, `ensureLocalCopy`).
- `js/core/utils.js` (`getFormattedDate`, `isDateDirInTemporalWindow`, `extractDateFromEscaletaFilename`).

