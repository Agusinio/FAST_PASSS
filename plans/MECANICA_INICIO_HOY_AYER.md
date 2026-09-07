# Mecánica de inicio de trabajo: HOY por defecto, AYER con Ctrl+clic

> **Fecha:** 2026-09-04
> **Estado:** PROPUESTA cerrada en diseño · Pendiente de implementar en la próxima sesión
> **Alcance:** Cambio del mecanismo de arranque de la extensión (botón MAIN) para eliminar la deducción automática de la fecha de trabajo.
> **Archivo relacionado previo:** `plans/PLAN_RESOLVE_CONTEXT.md` (su paradigma "buscar hoy → si no, ayer" queda **sustituido** por el de este documento).
> **Revisión 2 (2026-09-04):** definidos los **4 estados del botón MAIN** — MASSA D'HORA (nada accesible), ESPERANT (material en curso, ingesta sin llegar al TC de emisión), CREAR (material útil) y ACTUALITZAR (recarga de datos/media faltante) → ver §6.
> **IMPLEMENTADO (2026-09-04):** integrada la mecánica en código (ver §13). Falta validación en runtime con Premiere y los escenarios T1-T9.

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

1. **Cuatro estados de producción** para el botón principal (en vez de NEW/UPDATE/GO/OBRIR/LOAD/WAITING): **MASSA D'HORA**, **ESPERANT**, **CREAR** y **ACTUALITZAR** (definidos en §6). LOCKED se conserva solo como excepción (lock de otro autor).
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
| Rol | **Es el "dato" del día.** Sin escaleta de la fecha objetivo ⇒ estado **MASSA D'HORA** o **ESPERANT** según haya o no otros artefactos de D en curso (§6) |
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
| Rol | Determina el estado del botón: si existe ⇒ **ACTUALITZAR**; si no ⇒ **CREAR** (si hay material útil) o **MASSA D'HORA**/**ESPERANT** (§6) |

### 5.7 Artefactos internos de la carpeta del día (NO son condiciones)
- Copia local de escaleta (`findInFolder`/`ensureLocalCopy`): `YYYYMMDD_HHMMSS_PROGRAMA_*.json`.
- JSON de análisis (`Analysis_Logic`, `analisis_estructura/...`).
- `SessionManifest` (guarda el contexto de la sesión) y logs (`_setLogPath`).
- Lock del proyecto (`.lock`) → estado LOCKED si lo tiene otro autor (se mantiene como hoy).

### 5.8 Resumen ejecutivo
> **El día "tiene datos"** ⇔ existe **escaleta JSON** de la fecha objetivo para el programa (+ bloque, con fallback V1→V5 del mismo día).
> **El día "tiene media"** ⇔ existen **MP4 y wotts** de la fecha objetivo (SRT/portadas se rellenan después).
> **No mezclar nunca**: todos los artefactos que se importen deben datarse con la fecha objetivo; si no hay de esa fecha, se devuelve vacío (no se cae al otro día).

La combinación de estas presencias define los **4 estados del botón MAIN** (§6): **MASSA D'HORA** (nada accesible), **ESPERANT** (material en curso, aún no útil), **CREAR** (material útil y sin proyecto) y **ACTUALITZAR** (proyecto del día ya existe).

---

## 6. Estados del botón MAIN (MASSA D'HORA · ESPERANT · CREAR · ACTUALITZAR)

Los estados se calculan contra la **fecha objetivo D** (hoy por defecto; ayer con Ctrl+clic) evaluando solo los artefactos accesibles de D. Reemplazan a los estados públicos actuales (NEW/UPDATE/GO/OBRIR/LOAD/WAITING).

### 6.1 Definición de los estados

| Estado | Texto del botón | Cuándo aparece | Qué significa |
|---|---|---|---|
| **MASSA D'HORA** | `MASSA D'HORA` | No hay **nada accesible** de D: ni escaleta JSON de D, ni MP4/SRT, ni wotts, ni portada. La producción de D todavía no ha empezado o aún no está publicada | Demasiado pronto: no hay nada con lo que trabajar. El botón está deshabilitado (clic normal y Ctrl+clic no hacen nada) |
| **ESPERANT** | `ESPERANT…` | Hay **archivos de D** pero **aún no son útiles**: la ingesta (MP4 cleanFeed) está en curso y **no ha llegado al TC de emisión** final del bloque, y/o el JSON del día no está cerrado (bloque aún emitiéndose, `findLatestValid` no válido) | La producción de D está en marcha; el material aún no sirve para montar. El botón está deshabilitado (clic normal); Ctrl+clic sí puede servir si lo que se busca es el día anterior |
| **CREAR** | `CREAR` | Hay **material útil de D** (escaleta JSON de D "válida" para el bloque — cerrada —, haya o no aún toda la media) y **NO existe** `.prproj` de D | Hay material para empezar a trabajar: el clic crea el proyecto del día D. Lo que falte (media/wotts/SRT/portada) se marca en el semáforo y se completa luego con ACTUALITZAR |
| **ACTUALITZAR** | `ACTUALITZAR` | **Existe** el `.prproj` de D (abierto o cerrado) | El clic abre el proyecto si hace falta y **recarga** los datos o la media faltante de D (nunca de otro día). LOCKED si otro autor tiene el lock |

### 6.2 Cascada de decisión (por fecha objetivo D)

```
[1] ¿Existe .prproj de D en disco?
        │ sí (¿lock de otro autor? → LOCKED)
        ▼
    ACTUALITZAR  (abre si hace falta y recarga datos/media de D)
        │ no
        ▼
[2] ¿Existe escaleta JSON de D "válida" para el bloque?   (findLatestValid de D)
        │ sí                                                     │ no
        ▼                                                         ▼
    CREAR                                     ¿Existe algún artefacto de D?
    (material útil: escaleta cerrada,               (JSON de D en curso, MP4/SRT de D
     con media presente o a completar)               en ingesta, wotts de D…)
                                                          │ sí            │ no
                                                          ▼                ▼
                                                      ESPERANT       MASSA D'HORA
```

### 6.3 Detectores concretos (código existente que ya informa de estos estados)

| Detector | Código | Sirve para |
|---|---|---|
| JSON no válido / espera estimada | `findLatestValid(archivo, bloque, datePrefix)` → `{ valid:false, estimatedWaitSec }` (`escaleta_io.js`) | Distinguir **ESPERANT** (bloque aún emitiéndose) |
| Ingesta sin llegar al TC de emisión | Semáforo `sem-mp4`: `mediaStop < blockOut` → `'pending'` (`4_Context.js` updateLights, L444-448) | Detectar **ESPERANT** por MP4 en curso |
| Nada accesible | `findLatest` de D = `null` **y** `mediaAssets(D)` = vacío **y** `wotts(D)` = vacío | Decidir **MASSA D'HORA** |
| Material útil | `findLatestValid` de D = `valid:true` (bloque cerrado) | Decidir **CREAR** (si no hay `.prproj`) |
| Proyecto del día | `Scan.selectedProject` en `destinoBase/…/D/` | Decidir **ACTUALITZAR** vs **CREAR** |

### 6.4 Comportamiento del clic

- **Clic normal** → D = hoy (fecha del sistema en ese instante). Acción según el estado de HOY.
- **Ctrl+clic** (Cmd+clic en Mac) → D = ayer. El estado y la acción se recalculan **para ayer** (si ayer existe proyecto → ACTUALITZAR/abrir; si no existe pero hay material de ayer → CREAR; si ayer tampoco tiene nada → MASSA D'HORA/aviso).
- El texto del botón **no muestra la fecha** (decisión 4). El modo corrección se refleja en log/status.
- La fecha se resuelve **en el momento del clic**, no cuando se cambió el selector (evita arrastrar un `dateDir` obsoleto si el panel lleva abierto desde ayer).
- Estados **MASSA D'HORA** y **ESPERANT**: clic normal deshabilitado (no hay nada que ejecutar). El editor debe esperar o, si buscaba el día anterior, hacer Ctrl+clic.

---

## 7. Implicaciones por módulo (qué cambia)

| Módulo / archivo | Cambio |
|---|---|
| `js/core/state.js` | `State.dateDir` pasa a significar **fecha de trabajo explícita** (hoy o ayer). Se resetea a hoy al cambiar programa/bloque. Campo real: `State.workTarget: 'today' \| 'yesterday'` |
| `js/core/4_Context.js` | ① Eliminado `_getValidDateDir()`/`PROGRAM_START_HOURS`/`PRE_EMISSION_GUARD_HOURS` y el "ESPERANT EMISSIÓ" → sustituido por `_targetDateDir()` (hoy = fecha del sistema; ayer = día natural anterior si `State.workTarget==='yesterday'`). ② `checkContext()`: eliminados TimeGuard, FIX A1, FIX A2, FIX A3 y la corrección de `dateDir`; escanea SOLO la fecha objetivo. ③ Produce los **4 estados de §6** (cascada 6.2 con los detectores de 6.3). ④ `updateButton()`: textos `MASSA D'HORA`/`ESPERANT…`/`CREAR`/`ACTUALITZAR` (LOCKED como excepción); MASSA/ESPERANT **no deshabilitan** el botón (clic normal = aviso; **Ctrl+clic = evaluar AHIR**); `onclick` centralizado en `Context._onMainClick(ev, action, data)`. ⑤ R6: en el clic se recalcula si `data.dateDir` no coincide con la fecha objetivo actual |
| `js/workflows/flow_mainButton.js` | ① `runMainAction(action, data)`: `data.dateDir` llega decidido (hoy|ayer). ② `_runNew()`: **eliminar** el bloque D7.1 de deducción/fallback a ayer (L44-88) y usar `ctx.dateDir` recibido. ③ `_runUpdate()/_runLoad()/_runGo()/_setupContext()`: usar `ctx.dateDir` explícito; no re-deducir. ④ Revisar que `_runUpdate` (ACTUALITZAR) importe solo lo faltante de la misma fecha |
| `js/logic/Scanner.js` | ① **Eliminar** el fallback "Intentant sense filtre de data" de `mediaAssets` (L91-94). ② Revisar/eliminar `_discardOld` (mtime+22h) en `wotts`, `portadas` y media: sustituir por filtro de fecha del proyecto. ③ Extraer helper común `_filterByWorkDate(files, ctx)` = data del nombre → `created` → descartar, y aplicarlo a media/wotts/portadas. ④ Mantener el filtro estricto de wotts/portadas por fecha (2026-09-02) |
| `js/core/escaleta_io.js` | ① `findLatest`/`findLatestValid`: **siempre** llamarlas con `datePrefix` = fecha objetivo; nunca sin prefijo en el flujo de arranque. ② Unificar la extracción de fecha de ambos formatos de nombre (usar `utils.extractDateFromEscaletaFilename` también en `_extractDateFromName`). ③ Eliminar cualquier reintento a otro día |
| `js/core/utils.js` | `isDateDirInTemporalWindow` deja de ser necesaria en el flujo de arranque (marcar para revisión/eliminación). `getFormattedDate()` = hoy; añadir `getYesterdayDate()` o equivalente |
| `js/core/11_Configuracio.js` / mapping | **Unificar token** de proyecto: el nombre creado (`_runNew`) y la búsqueda (`Scan.selectedProject`) deben usar el mismo token (recomendado `wott`, ej. `TNV`), para que el proyecto del día se detecte de forma fiable |
| `index.html` / bindings | El listener del botón principal ya lo gestiona `updateButton`; comprobar que el clic con Ctrl no se pierde (botón `<button>` con `onclick(ev)`). Textos del botón: los 4 estados (§6.1) sin mostrar fecha |
| Consumidores de `ctx.dateDir` | `Project_Logic.create`, `Analysis.saveEscaleta`, `SessionManifest`, `_setLogPath`, `naming.getProjectName`, SRT loader, markers: ya reciben `ctx`; **verificar que ninguno re-resuelve fecha por su cuenta** |

## 8. Reglas anti-contaminación (nuevas)

1. **R1 — Fecha siempre explícita**: toda búsqueda de artefacto se hace con la fecha objetivo (hoy o ayer). Ningún módulo "deduce" ni "corrige" el día.
2. **R2 — Datar por nombre primero**: la fecha de un archivo se extrae del nombre (`YYYYMMDD`); si no la lleva, de `created`; **nunca de `mtime`**.
3. **R3 — Vacío si no hay de la fecha**: si no existen artefactos de la fecha objetivo se devuelve `null`/`[]` y el estado lo refleja (MASSA D'HORA si no hay nada, ESPERANT si solo hay material en curso). Prohibido reintentar "sin filtro de fecha" o con otra fecha.
4. **R4 — Modo corrección simétrico**: Ctrl+clic aplica las mismas reglas con la fecha de ayer.
5. **R5 — Nunca mezclar días**: no se importa MP4/SRT/wotts/portada de una fecha distinta a la del proyecto.
6. **R6 — La fecha se fija al pulsar**: se resuelve en el momento del clic en MAIN (no al cambiar el selector, no al abrir el panel). Cambiar programa/bloque ⇒ volver a hoy.
7. **R7 — Fallback de bloques solo dentro del día**: V1→V5 del mismo día; nunca buscar el JSON de otro día para "completar" un bloque.

---

## 9. Plan de implementación (orden sugerido para la próxima sesión)

> Objetivo: dejar la mecánica nueva funcionando sin romper el resto de flujos (marcadores, DF, SRT…). Cada paso debe poder probarse por separado.

- **P1 · Estado y fecha**: en `state.js`/`utils.js`, helper de fecha (`hoy`, `ayer natural`, formatos `YYYY_MM_DD` / `YYYYMMDD`). Reset a hoy al cambiar programa/bloque.
- **P2 · Context sin deducción**: `4_Context.js` — eliminar TimeGuard/A1/A2/A3; `checkContext()` escanea únicamente la fecha objetivo y produce los **4 estados de §6** (cascada 6.2: `.prproj` → ACTUALITZAR; escaleta válida → CREAR; artefactos en curso → ESPERANT; nada → MASSA D'HORA).
- **P3 · Clic con Ctrl**: `4_Context.js updateButton()` + `flow_mainButton.runMainAction()` — capturar `ctrlKey/metaKey` y resolver la fecha en el momento del clic; pasar `data.dateDir` (hoy|ayer) a todas las acciones; deshabilitar el botón en estados MASSA D'HORA/ESPERANT; recalcular el estado para ayer cuando hay Ctrl.
- **P4 · `_runNew` sin fallback**: eliminar la deducción D7.1 y el fallback a ayer; usar `ctx.dateDir` recibido para carpeta, nombre, manifest y assets.
- **P5 · Scanner con filtro de fecha duro**: eliminar el reintento sin fecha de `mediaAssets`, retirar `_discardOld` del camino crítico y aplicar `_filterByWorkDate` (nombre → `created`) en media, wotts y portadas.
- **P6 · Escaleta**: `findLatest*` siempre con `datePrefix` de la fecha objetivo; soportar ambos formatos de nombre de JSON al extraer la fecha; revisar llamadas (no pasar `null`).
- **P7 · Unificar token de proyecto**: crear y buscar con el mismo token (`wott`) para que la detección del proyecto del día sea fiable.
- **P8 · Revisión de consumidores**: comprobar que `Project_Logic`, `Analysis`, `SessionManifest`, SRT y markers usan `ctx.dateDir` sin recalcular.
- **P9 · Tests manuales** (escenarios de §10) y limpieza de funciones muertas (`isDateDirInTemporalWindow`, constantes horarias, etc.).

## 10. Escenarios de prueba

| # | Escenario | Resultado esperado |
|---|---|---|
| T1 | Hoy 09:00, TNV V1. No hay nada accesible de hoy (ni JSON `20260905` ni media); sí hay todo de ayer `20260904` | Estado **MASSA D'HORA** (botón deshabilitado). Ctrl+clic → estado recalculado para `20260904` → **ACTUALITZAR** (o **CREAR** si no existe) con media/wotts de ayer |
| T2 | Hoy 12:00, TNV V1. El JSON de hoy existe pero el bloque aún no está cerrado (aún emitiéndose) o el MP4 de hoy está en ingesta sin llegar al TC de emisión final | Estado **ESPERANT** (botón deshabilitado). Cuando la ingesta llegue al TC final / el JSON cierre, el estado pasa solo a **CREAR** o **ACTUALITZAR** |
| T3 | Hoy, JSON de `20260905` ya cerrado y MP4/wotts de hoy disponibles; no existe proyecto de hoy | Estado **CREAR**. El clic crea el proyecto del día con escaleta+media; el semáforo informa de lo que aún falte |
| T4 | Existe el proyecto de hoy (abierto o cerrado) y faltan datos/media | Estado **ACTUALITZAR**. El clic abre el proyecto si hace falta y recarga solo lo de HOY; nunca cambia a ayer |
| T5 | Con proyecto de hoy abierto, Ctrl+clic | Recalcula el estado para ayer → **ACTUALITZAR**/abrir el proyecto de `20260904`, sin mezclar estados ni materiales |
| T6 | Cambiar TNV V1 → TNV V2 (o TNM) tras haber usado modo ayer | `dateDir` vuelve a HOY (no arrastra ayer) |
| T7 | En `verticalitzacio`/`chyrons` hay MP4/wotts de `20260904` y `20260905`; proyecto de hoy abierto | Solo se listan/importan los de `20260905`; los de `20260904` se ignoran (log con descartados) |
| T8 | A medianoche, panel abierto desde ayer | La fecha se resuelve al pulsar MAIN (hoy real), no la guardada en el selector |
| T9 | Lock de otro autor sobre el `.prproj` de hoy | Estado **LOCKED** (excepción sobre ACTUALITZAR/CREAR), como hoy |

## 11. Preguntas abiertas (para cerrar al implementar)

1. **Token de proyecto**: ¿confirmamos `wott` (TNV/TNM/TNC) como token único de creación **y** búsqueda del `.prproj` (afecta a proyectos ya existentes con nombre `Pruebas_TN_VESPRE_...` si los hubiera)?
2. **Filtro duro en wotts/portadas**: cuando un archivo no se puede datar ni por nombre ni por `created`, ¿se descarta (filtro duro) o se conserva como hoy?
3. **Causa de "nada accesible"**: MASSA D'HORA asume "el día aún no está publicado". Si la causa es red/permisos (no se pudo ni listar el NAS), ¿mostramos el mismo estado o un estado de ERROR de acceso distinto?

## 12. Referencias

- `plans/PLAN_RESOLVE_CONTEXT.md` (precedente; sustituido por la mecánica de este documento en lo relativo a elegir día).
- `js/core/4_Context.js` (`_getValidDateDir`, `checkContext`, `updateButton`, semáforos).
- `js/workflows/flow_mainButton.js` (`runMainAction`, `_runNew`, `_setupContext`, `_runUpdate/_runLoad/_runGo`, `_fullScan`).
- `js/logic/Scanner.js` (`mediaAssets`, `_filterMediaByDate`, `wotts`, `portadas`, `_discardOld`).
- `js/core/escaleta_io.js` (`findLatest`, `findLatestValid`, `findInFolder`, `ensureLocalCopy`).
- `js/core/utils.js` (`getFormattedDate`, `isDateDirInTemporalWindow`, `extractDateFromEscaletaFilename`).


---

## 13. Implementación (2026-09-04) — cambios aplicados

| Archivo | Cambio aplicado |
|---|---|
| `js/core/state.js` | Añadido `workTarget: 'today'` (+ reset en `reset()`). |
| `js/core/4_Context.js` | `_targetDateDir()` (hoy / ayer natural según `workTarget`); `_onMainClick(ev, action, data)` (clic normal ejecuta; Ctrl+clic evalúa AHIR y ejecuta, luego restaura HOY); `checkContext()` sin TimeGuard/FIX A1/A2/A3, con estados **MASSA D'HORA / ESPERANT / CREAR / ACTUALITZAR**; semáforo reutiliza el `getStatus` del día; `updateButton` con los 4 textos y onclick central; debounce con `{force:true}` para los recálculos de clic |
| `js/core/escaleta_io.js` | `getStatus(programArchivo, blockId, datePrefix)` filtra por día; `_extractDateFromName` reconoce formato nuevo (fecha al inicio) y antiguo (fecha al final) en `findLatest` y `findLatestValid` |
| `js/logic/Scanner.js` | `mediaAssets` **sin** reintento "sin filtro de fecha"; `wotts` y `portadas` **sin** `_discardOld` (guarda mtime 22h) — el filtro por fecha del proyecto es el único criterio |
| `js/workflows/flow_mainButton.js` | `_runNew` **sin** deducción D7.1 ni fallback a ayer: `ctx.dateDir` llega fijado desde checkContext (hoy o ayer) |
| `js/main.js` | Botón FOTO de escaleta usa `Context._targetDateDir()` (fecha de trabajo explícita) en vez del TimeGuard |

**Pendiente — validación en runtime (Premiere):**
- Escenarios **T1-T9** de §10 (especialmente MASSA D'HORA ↔ Ctrl+clic = AHIR, y ESPERANT durante la ingesta).
- Comprobar que el botón ACTUALITZAR (estado LOAD) abre el proyecto cerrado y recarga solo datos/media de su fecha.
- Verificar semáforo (ESC/MP4/WOT/SRT) tras crear/abrir proyecto.
- Confirmar token de proyecto (`wott`) como único (pregunta abierta §11).
- `isDateDirInTemporalWindow` queda sin uso en el flujo de arranque (se mantiene por compatibilidad; candidata a eliminación en P9).


---

## 14. Incidente 2026-09-07 — wotts de otro día en el proyecto de ayer (fijado)

**Síntoma:** el proyecto `Pruebas_TNV_V1_INTRO` (día 2026_09_06) importó al bin CHY los rótulos `Wott_TNV_v1_01_...PORT DE CEUTA...` cuyo `creationTime` es del **05/09** (los del tema UCRANIA del 06 son las piezas 11-13).

**Causa raíz (código):** los `.mov` automáticos (`Wott_TNV_vX_...`) **no llevan la fecha en el nombre** (solo un código `.0057xxxx`). Tras eliminar `_discardOld` (guarda mtime 22h) en la integración de la mecánica HOY/AYER, la datación dependía solo de `created`; cuando `readFolder` no puede datar el archivo, el criterio anterior **"no datable → se conserva"** dejaba pasar rótulos de otros días (el NAS guarda juntos del 31/08 al 06/09).

**Fix aplicado (Scanner.wotts / Scanner.portadas):** datación por nombre → `created` → `mtime`; y si **no se puede datar, se DESCARTÁ** (con log `NO datables descartats`) en lugar de conservarse. Nunca se importa un rótulo de día incierto.

**Causa raíz definitiva (2026-09-07, v3) — mtime desplazado por proceso nocturno:**
- Todos los `.mov` del NAS tienen `LastWriteTime` (mtime) = **02:31 del día siguiente** a su creación (los del 05 → 06-02:31; los del 06 → 07-02:31). Algún proceso nocturno toca los ficheros.
- `Utils.readFolder` usaba `created = creationTime || mtime`; como CEP no expone `creationTime`, databa por **mtime desplazado +1 día** → al pedir el día 06 entraban los del 05 (mtime=06) y se descartaban los del 06 (mtime=07).
- **Fix**: el filtrado usa **solo la fecha/hora de CREACIÓN real** (`File.created` en ExtendScript / `creationTime` en CEP). `Utils.readFolder` en rutas UNC lee siempre vía JSX (`scanDirectory` → `File.created`); `File.created` nunca cae a `modified`; `Scan._fileDateYYYYMMDD` ya no usa `mtime` como fuente.
**Unificación del mecanismo (v2):**

- **Filtro único**: nuevo `Scan.filterByWorkDate(files, dateDir)` (mecanismo único de datación y filtrado) usado por `Scan.wotts`, `Scan.portadas` y la ingesta final.
- **Ingesta única**: `Project.ingestAssets` (punto único por el que pasan NEW y UPDATE/GO/LOAD) aplica ahora un **filtro final de seguridad**: re-data cada rètol/portada contra `ctx.dateDir` justo antes de importar y descarta los que no sean del día (log `[INGEST] Filtre final wotts/portades per data ...`).
- **Robustez UNC**: `Utils.readFolder` completa con el listado JSX los `stat` que CEP no puede datar en rutas remotas (evita listas sin fecha → sin descartes por ignorancia).

**Fix FOTO (escaleta_fetch.js + main.js):**
- **Ctrl+FOTO** → genera la escaleta de **AHIER** (`utils.getYesterdayDateDir()`) en el directorio del día anterior (para comparar/corregir el proyecto de ayer).
- `fetchNewEscaleta` **valida la respuesta**: si la API devuelve `[]`, `{}` o un JSON de error (`missatge`) → **no guarda** ningún `escaleta_on_demand_*` y avisa.
- La hora de la consulta se toma del JSON **del mismo día** pedido (antes, del más reciente de cualquier día).

**Pendiente de validar en Premiere:** re-crear/actualizar el proyecto del 06 con el nuevo filtro y comprobar que el bin CHY solo contiene los `Wott_TNV_v1_*` con `created = 2026-09-06` (los del 05 deben quedar descartados en el log).

---

## 15. Nombres de proyecto/seqüència en fallback «INTRO» (2026-09-07, fijado)

**Síntoma:** el proyecto `Pruebas_TNV_V1_INTRO` y la secuencia `TNV_INTRO` usan el nombre del fallback aunque la escaleta esté accesible.

**Causa:** el bloque V1 de la escaleta del 06 tiene sus items estructurales con títulos que empiezan por **tokens reservados** (`GF FOTO…`, `intro`, `DIFERIT…`, `IPD…`, `INSERT…`) → el extractor de tema del JSON no encontraba ningún título "limpio" y caía al fallback; y el fallback del Scanner (posición 5 del nombre del `.mov`: `Wott_TNV_v1_11i_00.01_intro_…`) devolvía `intro` → `INTRO`.

**Fix (`flow_mainButton.js _runNew`):** si todos los items estructurales del bloque están reservados, se toma el **primer estructural** y se le **quita el prefijo reservado** (`DIFERIT CRISTINA SOLIAS CONVERSES UCRAÏNA…` → `CRISTINA SOLIAS CONVERSES UCRAÏNA I RÚSSIA`) → nombre real del tema. Log: `[Theme] Tema reconstruït des del 1r estructural`.

**Nota log:** los mensajes `[Theme]` no aparecían en `FASTPASS.log` porque `_setLogPath` (más abajo en `_runNew`) resetea el archivo después de la extracción del tema.

**Errores JSX `ERR:MOVE_FAILED`:** son el intento 1 (mover por nombre al bin CHY) que falla por la indexación del root recién importado; el intento 2 (`moveByID`) funciona y deja los rótulos en CHY. Se ha limpiado el log: ahora solo avisa si fallan ambos.

