# ARXIU - SESSIONS DE TREBALL

> DocumentaciÃ³ tancada Â· fusionada el 2026-09-30 Â· els originals sÃ³n a l'historial de git.

---

## 2026-06-08.md

# Sesión 2026-06-08 — Bug: dateDir contaminado entre programas

**Estado**: Diagnosticado, fixes pendientes de implementar

---

## 🔴 Síntoma

El MP4 cleanFeed no se importaba al generar un proyecto TN_VESPRE. El sistema usaba un JSON del 03/06 en vez del 07/06, y el MP4 correspondiente ya no existía en el NAS.

## 🐛 Causa raíz: 2 bugs encadenados

### Bug 1: `State.dateDir` no se resetea al cambiar de programa

**Archivo**: `js/core/4_Context.js`, línea 45

```javascript
const existingDateDir = (FASTPASS_UI.State && FASTPASS_UI.State.dateDir);
```

Al cambiar de TNCOMARQUES a TN_VESPRE, `State.dateDir` sigue valiendo la fecha del programa anterior. Debería resetearse a la fecha actual.

**Fix propuesto**: Detectar cambio de programa y resetear `dateDir` a null para forzar fecha actual.

### Bug 2: `FIX A2` no valida la ventana temporal

**Archivo**: `js/core/4_Context.js`, líneas 129-133

`findLatest` encuentra el JSON más reciente pero SOBRESCRIBE `dateDir` sin validar `isDateDirInTemporalWindow()`. Si el JSON más reciente es de hace 5 días, `dateDir` se corrige a una fecha donde el MP4 ya no existe.

**Fix propuesto**: Añadir `isDateDirInTemporalWindow()` en FIX A2.

---

## 📋 Plan de implementación (pendiente)

- [ ] **Bug 1** — `4_Context.js` línea 45: Detección de cambio de programa y reset de `State.dateDir`
- [ ] **Bug 2** — `4_Context.js` línea 131: `isDateDirInTemporalWindow()` en FIX A2
- [ ] **Test**: Cambiar de TNCOMARQUES → TN_VESPRE y verificar `dateDir` del día actual
- [ ] **Test**: Verificar que FIX A2 no sobrescribe dateDir con fechas fuera de ventana temporal

---

## 📁 Archivos relevantes

- `js/core/4_Context.js` — `checkContext()`, bugs en líneas 45 y 131
- `js/core/utils.js` — `isDateDirInTemporalWindow()`, `extractDateFromEscaletaFilename()`
- `js/core/escaleta_io.js` — `findLatest()`
- `js/workflows/flow_mainButton.js` — `_runNew()`
- `js/logic/3_Project_Logic.js` — `create()` → `importList()` del cleanFeed

---

*FAST >>> PASS · Sesión 2026-06-08*

---

## 2026-09-15.md

# Sesión 2026-09-15 — Visor de vídeo a MEMÒRIA (opció C) + fixes pendents de commit

**Estado**: Implementado y verificado con harness headless; pendiente de test en Premiere

---

## 🎯 Objetivo de la sesión (decidido por el usuario)

Eliminar tirones y fotogramas negros en el visor de vídeo de la sección SUBTÍTOLS.
El MP4 se reproducía vía `file:////DSMEDIA07/...` (SMB): cada demux/seek golpeaba la
red. **Decisión**: opción **C** = llevar el fichero completo a local; el usuario descartó
explícitamente el anti-negro (canvas fantasma) y el proxy ffmpeg: *"el archivo es pequeño,
si lo tenemos en local no es necesario ningún B"*.

## 🛠️ Implementación (`js/editor/srt_editor.js` → `_loadVideo`, orden de intentos)

1. **`_loadVideoFromMemory()`** — XHR `responseType='blob'` → `URL.createObjectURL(blob)`.
   El `<video>` lee del buffer de memoria ⇒ **cero acceso a disco/red durante la reproducción**.
   Requiere `--allow-file-access-from-files` (añadido a `.debug`, `CEFCommandLineParameters`).
2. **`_ensureLocalVideoCopy()`** — copia a `C:\temp\fastpass_video\<clip>.mp4` vía JSX
   (`File.copy`), cacheada por tamaño (`CACHED;<len>`), un solo `callJSX`.
3. **`file:////` UNC directo** — comportamiento antiguo (último recurso).
4. **`_loadVideoFallback()`** — fallback histórico (`C:\temp\fastpass_media.mp4`).

- `_revokeVideoBlob()`: libera el objectURL anterior (otro clip) y en `_hideEditor()`.
- ⚠️ El paso 1 requiere **reiniciar Premiere** una vez (CEF lee el flag al arrancar).
- ✅ Verificado: `C:\temp\fp_test_video_mem.html` → **34 PASS / 0 FAIL**; syntax check del
  panel (`fp_syntax_check2.html`, ahora con `srt_editor.js` y 9 ficheros más) → **21 OK / 0 FAIL**.

## 🔎 DIAGNÓSTICO REAL (log `FASTPASS.log`, 15:34) — la causa NO era la red

```
15:34:22 🎞️ còpia local del vídeo feta (201.7 MB) → reproducció local   ← 200 MB en 3 s: xarxa OK
15:34:23 ✅ Vídeo carregat des de la còpia local
15:34:31 🎯 PLY salt tl=0.84 real=20.84 (Δ=0.84)    ← servo: "salt" ⇒ _timelineRunning=false ⇒ v.pause()
15:34:32 🎯 PLY salt tl=4.04 real=24.04 (Δ=3.20)    ← polls solapats (rtt real 1-3 s)
15:34:34 ⏱ PLY ... rtt=17ms vel=? driftV=-0.10
```

**Causa raíz**: `_pollTick` clasificaba el estado del cabezal por el **Δ absoluto** del CTI
(`Δ > 0,5 s ⇒ salt`). Si un poll tardaba 0,6-3 s (panel ocupado, `Timeline.get()` + render),
el Δ cruzaba el umbral ⇒ se marcaba "salt" ⇒ `_timelineRunning = false` ⇒ `_syncVideo`
hacía `v.pause()` ⇒ **imagen congelada / "no es refresca"** (y el siguiente poll, igual de
lento, volvía a marcarlo). Además, los polls se solapaban (setInterval de 250 ms con polls
de 1-3 s), agravando el retraso.

**Fixes aplicados** (`js/editor/srt_editor.js`):
1. `_ctiState(deltaSec, dtRealSec)` — clasificación por **VELOCIDAD** (Δ CTI / Δ tiempo real):
   `vel < 0,35× ⇒ stop`, `vel > 2,5× ⇒ salt`, resto ⇒ **play** (aunque el poll haya tardado).
2. `_syncVideo`: `run = !!(this._isPlaying || this._timelineRunning)` — si el usuario pidió
   PLAY (botón/spai), el `<video>` nunca se queda pausado por decisión del servo.
3. Guard de reentrada `_pollBusy` en los 4 `setInterval(... _pollTick ...)`.
4. `style.css`: capa de composición propia en `#srtVideoWrap`/`#srtVideo` (`translateZ(0)`,
   `will-change: transform`) — en CEF un `<video>` dentro de `overflow:hidden` puede no
   repintar fotogramas.
5. **HUD de diagnóstico** (`#srtVideoHud`, arriba a la izquierda del visor):
   `🧠 MEMÒRIA 202MB · 25 fps` / `💾 LOCAL (còpia a C:\temp) · 25 fps` /
   `🌐 XARXA (UNC, sense còpia) · 25 fps` + watchdog que baja a **0 fps** si el `<video>`
   deja de entregar fotogramas (`requestVideoFrameCallback`).
6. `index.html` → `srt_editor.js?v=68`.

### Modo de origen conmutable (decisión del usuario: medir UNC con el HUD)

Medido: la copia de 201,7 MB tarda **3 s** (≈66 MB/s) y el clip necesita **~1 MB/s** para
reproducirse ⇒ el defecto nunca fue la red, sino el servo. Por eso `_videoSource` es
configurable y el origen se puede **medir con el mismo HUD**:

| Modo | Camino | Para qué |
|---|---|---|
| `unc` | solo `file:////` UNC | **por defecto ahora** — medir si la red aguanta el scrub |
| `local` | copia a `C:\temp\fastpass_video` (sin memoria) | si la red no aguanta |
| `mem` | XHR → Blob → objectURL | probar memoria (requiere el flag del `.debug`) |
| `auto` | memoria → copia local → UNC | comodidad / máxima probabilidad de éxito |

**Clic al HUD** (esquina del visor) rota `auto → unc → local → mem`, lo guarda en
`localStorage['fastpass_video_source']`, lo registra en `FASTPASS.log` y recarga el clip
actual. El HUD muestra el modo: `[UNC] 🌐 XARXA (UNC, sense còpia) · 25 fps`.

---

## 🔴 BUG 3 — Franja negra inferior al mover el cabezal (post-scrub)

**Síntoma**: tras un rato reproduciendo perfectamente, al tocar el timeline para mover el
cabezal, el visor mostraba sólo la parte superior del frame y el resto en negro.

**Causa raíz** (`js/main.js` → `sizeVideoToFit`, llamada cada 500 ms):
para medir la columna de controles **anulaba el visor** con
`wrap.style.width = '10px'; wrap.style.height = '0'` y luego restauraba `'auto'`. Ese
cambio de caja reescala la textura del `<video>` a 0 px y, al volver, el compositor de CEF
la deja a medio pintar (franja negra). El guard que evitaba la medición sólo miraba
`_isPlaying || _timelineRunning`, así que **durante el scrub (sin PLAY) sí se ejecutaba** —
y cualquier cambio de altura de la columna (etiquetas/marcadores al mover el cabezal)
provocaba el reajuste.

**Fixes**:
1. `main.js` — `sizeVideoToFit` mide ahora con el visor **fuera del flujo**
   (`position: absolute` + restauración síncrona, sin paint intermedio) **sin tocar su
   tamaño**; el guard pasa a ser el ancho final calculado (`wrap._fitW`), así no se
   reescriben `width/height` si no cambia nada.
2. `style.css` — revertidas las capas de composición GPU que añadí (`translateZ(0)`,
   `will-change: transform`): eran una suposición no confirmada y en CEF pueden producir
   justo este tipo de artefacto. La mejora real venía del servo (BUG 2).
3. `index.html` — `style.css?v=47` (estaba en `v=46` desde hacía muchas sesiones: mis
   cambios de CSS anteriores **no se estaban aplicando**) y `main.js?v=34`.
4. `.debug` — añadido `--disable-accelerated-video-decode` (red de seguridad contra
   fotogramas negros/parciales del decodificador GPU; requiere reiniciar Premiere).
   El `.debug` se reescribió limpio: antes había **dos** bloques
   `<CEFCommandLineParameters>` duplicados (el script idempotente no unificaba).

**Validación**: `fp_test_video_fit.html` → **15 PASS / 0 FAIL** (extrae `sizeVideoToFit`
real y comprueba que ya no mutila la caja del visor, que mide con `position:absolute`, que
restaura la posición y que no reescribe estilos si el ancho no cambia).

---

## 🔴 BUG 4 — Parpadeo negro de la part inferior (també EN PAUSA)

**Síntoma**: la franja de abajo del visor parpadeaba en negro incluso con el vídeo pausado.
"Unes iteracions abans anava molt millor si només feies PLAY".

**Por qué empeoró**: el `style.css` se servía con **`?v=46`** desde hacía muchas sesiones
⇒ el CSS nuevo (layout 2 columnas, HUD superpuesto sobre el vídeo, mediciones más agresivas)
**no se aplicaba** y el visor usaba la versión antigua que funcionaba mejor. Al subir a
`?v=47` (BUG 3) se aplicó todo de golpe y salió el artefacto.

**Causas (dos, ambas introducidas al aplicar el CSS/cambios nuevos)**:
1. `main.js → sizeVideoToFit` seguía **remidiendo cada 500 ms**, y medir obliga a sacar el
   visor del flujo (`position:absolute`) o anular su caja → **cualquier cambio de layout con
   un `<video>` cargado deja la textura a medio pintar**. Ahora la altura de la columna se
   mide **una sola vez** (sin vídeo) y sólo se re-mide en `resize` (`force=true`): en
   funcionamiento normal **cero mutaciones de DOM** (test: 3 polls seguidos no tocan nada).
2. El `<video>` había perdido su **capa de composición** (le quité `translateZ(0)` en el BUG 3,
   suposición equivocada) y además estaba dentro de un marco con **`overflow:hidden`** con el
   **HUD superpuesto** encima: las tres cosas fuerzan repintado por software en CEF.

**Fixes**:
- `style.css` → `#srtVideo { transform: translateZ(0); backface-visibility: hidden; }` (cada
  fotograma se compone entero); `#srtVideoWrap` sin `overflow:hidden`; `#srtVideoHud` **fuera
  del marco del vídeo** (ahora debajo, `align-self: flex-start`, sigue siendo clicable para
  cambiar el origen).
- `main.js` → `sizeVideoToFit(force)` con altura cacheada (`_fitAh`) y ancho guardado
  (`_fitW`); sólo mide la primera vez y en `resize`.
- `index.html` → `style.css?v=48`, `main.js?v=36`.

**Validación**: `fp_test_video_fit.html` → **16 PASS / 0 FAIL**; `fp_test_video_sync.html` →
**35 PASS / 0 FAIL** (incluye capa GPU presente, ausencia de `overflow:hidden`/`contain:paint`
y que el HUD ya no está dentro del marco del vídeo); syntax check → **21 OK / 0 FAIL**.

---

## 🟠 BUG 5 — Afinat del pintat: "algun frame en mig negre" (residual)

Després del BUG 4 va millorar, però quedaven frames a mig pintar. Tres palanques més
(la primera és la que més explica que passi **mentre es treballa a Premiere**):

**1. Flags de CEF (`.debug`, cal REINICIAR Premiere un cop)**
```
--allow-file-access-from-files
--disable-accelerated-video-decode      ← decodificació H.264 per SW
--disable-gpu-compositing               ← composició per SW (nou)
--disable-backgrounding-occluded-windows ← nou
--disable-renderer-backgrounding         ← nou
--disable-background-timer-throttling    ← nou
```
Els tres últims eviten que Chromium **rebaixi el pintat del panell quan no té el focus**
(és a dir, quasi sempre: l'usuari està a Premiere). Abans d'això, `--disable-accelerated-
video-decode` ja hi era però **sense reiniciar Premiere** no s'havia aplicat mai.

**2. Mides enteres en px** (`main.js → sizeVideoToFit`): amb `aspect-ratio` l'alçada sortia
amb decimals i el compositor rasteritzava el `<video>` a mig píxel → franges. Ara assigna
`width: Wpx` i `height: Math.round(W*16/9)px`.

**3. Capa pròpia per als subtítols** (`#srtVideoSubs { transform: translateZ(0) }`) i
**sense `box-shadow`** al marc: si els subtítols comparteixen capa amb el vídeo, cada canvi
de text obliga a repintar la imatge. Amb capa pròpia el vídeo no es toca.

`index.html` → `style.css?v=49`, `main.js?v=37`.

**Palanca següent si encara es veu**: `--disable-gpu` al `.debug` (tot el panell per SW,
la més contundent) o provar un MP4 reduït (540×960) per eliminar l'escalat de 1080p.

**Validación**: `fp_test_video_fit.html` → **17 PASS / 0 FAIL**; `fp_test_video_sync.html` →
**40 PASS / 0 FAIL**; syntax check → **21 OK / 0 FAIL**.

---

## 🔴 BUG 6 — El botó MAIN "no fa cas al clic" (amb Ctrl) + panell molt lent

**Context**: després de reiniciar, el botó MAIN no responia. Va passar **clicant Ctrl** (mode
correcció AHIR). I de fons: *"hi ha alguna cosa que ralentitza moltíssim la càrrega i el
refresc dels estats; concretament la llista de presentadors"*.

**Causa 1 — flags CEF massa agressius**: els que vaig afegir per al pintat
(`--disable-gpu-compositing`, `--disable-backgrounding-occluded-windows`,
`--disable-renderer-backgrounding`, `--disable-background-timer-throttling`) deixen el panell
pintat però **degraden l'entrada** (el clic no arriba als botons). **Revertits**: el `.debug`
torna a només `--allow-file-access-from-files` i `--disable-accelerated-video-decode`.

**Causa 2 — Ctrl+clic = DOS escanejos complets del NAS** (`4_Context.js → _onMainClick`):
el mode correcció fa `checkContext({force:true})` a l'inici **i** un altre al final per
restaurar l'estat d'avui. Amb `force` no hi ha debounce ⇒ **dos escaneigs seguits**
(escaleta + media + 75 wotts + chyrons) amb crides JSX síncrones que **bloquegen la UI** 10-30 s
⇒ el clic "no fa cas" i el següent clic es perd.

**Causa 3 — auto-refresh cada 15 s + escaneig de presentadors**: el log el mostra literalment
(`09:35:55 → 09:36:10 → 09:36:25 → 09:36:40`) i `Scanner.wotts` fa un `utils.readFolder()` del
NAS (75+ `.mov` de conductors) **a cada cicle**, i amb el filtre per data del projecte (anclatge
d'ahir) **els descarta tots 75** cada vegada. D'aquí la lentitud que "abans no passava".

**Fixes**:
- `main.js` → auto-refresh **15 s → 60 s** + guard `_ctxRefreshBusy` (no se solapen escaneigs).
- `Scanner.js → wotts` → **caché de 30 s** del `readFolder()` de chyrons (mateixa llista, sense
  tocar el NAS a cada check). `index.html` → `main.js?v=38`, `Scanner.js?v=6`.
- `fp_syntax_check2.html` → ara inclou `Scanner.js` i `project_registry.js` (**23 OK**).

**Pendent si el botó encara no respon**: `updateButton` no assigna cap `onclick` en l'estat
`WAITING` ni en el `default` (només canvia el text) ⇒ el botó queda mut sense cap missatge.
Cal demanar a l'usuari el text exacte que mostra per confirmar-ho.

**Validación**: `fp_test_video_fit.html` → **19 PASS / 0 FAIL** (inclou guard d'escaneig i
60 s); syntax check → **23 OK / 0 FAIL**.

---

## 🔴 BUG 7 — El flotge CREAR/ACTUALITZAR no importava el MP4 (TDZ)

**Síntoma**: *"ahora no ha cargado el mp4"*. El log ho deixa clar:

```
[10:21:20] 🔵 [FLOW-LOAD] Resultado de Project.open: OK
[10:21:26] 🔵 Assets existentes: 11 wotts, 11 media, 2 portadas
[10:21:26] 🔴 💥 [MainAction] Error: Cannot access 'mp4Exists' before initialization
```

**Causa**: a `js/logic/3_Project_Logic.js` hi havia un
`if (media?.mp4?.path && !mp4Exists && !(skipMedia && capaVideoPresent))` **abans** de
`let mp4Exists = false;` ⇒ **TDZ** (`let`/`const` no es pot llegir abans de declarar-se).
L'excepció abortava el flux **just abans d'importar el MP4 a la timeline**. Era un **resto
duplicat** que es va colar en afegir la condició `skipMedia && capaVideoPresent` (flux
"CREAR amb FOTO local sense media").

**Fix**: la comprovació viu ara **una sola vegada i després de calcular `mp4Exists`**,
conservant la condició original (`!(skipMedia && capaVideoPresent)`). `index.html` →
`3_Project_Logic.js?v=11`.

**Validación**: syntax check → **23 OK / 0 FAIL** (`3_Project_Logic.js` 54.585 chars).

⚠️ Aquest bug estava **commitejat** (commit `640409`/`b640409`), així que cal commitejar
l'esmena un cop validada a Premiere.

---

## 🟠 BUG 8 — L'editor SRT dibuixava els clips desplaçats (buit gran al principi)

**Síntoma**: a la finestra de SUBTÍTOLS els clips apareixien "molt endavant" deixant un espai
buit gran al començament.

**Causa**: l'eix del timeline de l'editor és **MEDIA** i s'ancora al `inPoint` més petit dels
segments (`_axisOrigin = _wfMediaStart`, `srt_editor.js:1216`). El JSX que llegeix els clips
(`_refreshWaveformSegments`) filtra per **tag** derivat del `.bin` (`TNC_V2_CLIP`);
si cap clip del projecte el conté, el **fallback** era `segs = all`
⇒ agafava **TOTES les pistes** (V1..V8). Els clips de grafismes/rètols/fons tenen `inPoint`
proper a 0 ⇒ `_axisOrigin ≈ 0` ⇒ el clip del MP4 (media ≈20 s = handle) es pintava ~20 s
endavant, amb el buit al davant. Es va notar més després del `rippleIn` del botó IN (INICI),
que canvia la relació timeline↔media.

**Fix**: el fallback prioriza **la pista del MP4 (v=0 → V1)** i només si no hi ha res cau a
`all`. El JSX retorna `mode` i el JS el registra:
`📝 SRT_EDIT: Mapa de clips mode=tag|v1|all tag="…" → _axisOrigin=20.00s (N segs)`,
amb avís si el nom del clip al projecte no conté el tag. `index.html` → `srt_editor.js?v=69`.

**Validación**: `fp_test_video_sync.html` → **42 PASS / 0 FAIL**; syntax check → **23 OK / 0 FAIL**.

### ✅ Correcció del diagnòstic (mesurat al log, 10:33)

El log va desmentir la hipòtesi del fallback:

```
📝 SRT_EDIT: Mapa de clips mode=tag tag="TNV_V1_CLIP" → _axisOrigin=27.92s (28 segs)
📝 SRT_EDIT:   seg[0] v0 tl=0.00-23.68s ← media=27.92->51.60s r=1.000
📝 SRT_EDIT: 109968 peaks (480/s, 229.1s)     ← el .bin = el clip (dur=229.00s)
```

`mode=tag` ⇒ el mapa timeline↔media és correcte (el fallback a V1/totes les pistes no s'usava).
El culpable real era **`_computeWaveformPixels`**: indexava els peaks com `sec * pps` (des de
**media 0**), però el `.bin` es genera **des de l'`inPoint` del clip** (aquí 27.92 s = handle).
Resultat: la waveform es pintava desplaçada exactament aquest offset i deixava el buit gran al
davant. Abans no es notava perquè l'`inPoint` era petit (≈0). **Fix**:
`idxStart = Math.floor((sec - binStart) * pps)` amb `binStart = _wfMediaStart`.
`index.html` → `srt_editor.js?v=70`.

**Validación**: test unitari de `_computeWaveformPixels` (pico a media 29.92 amb origen 27.92
ha de caure al píxel correcte; i el cas sense handle) → `fp_test_video_sync.html`
**47 PASS / 0 FAIL**; syntax **23 OK / 0 FAIL**.

### ✅✅ Causa REAL del buit (mesurada amb el manifest i el SRT, 10:38)

El fix de la waveform **no era el problema** (l'usuari: "sigue apareciendo muy tarde"). Dades:

| Font | Valor |
|---|---|
| `TNV_V1.fastpass.json` → `ref.worldSecMediaStart` | **75540 s** (20:59:00 = inici del **cleanFeed**) |
| Manifest → `blockBounds.mp4ExpandedInPoint` | **124 s** |
| Manifest → `ref.worldBlockStartSec` | 75684 s |
| `emergencia_EMERGENCIA.srt` → 1r subtítol | **00:02:23,400 = 143,4 s** |
| Editor → `_axisOrigin` (inPoint del clip a la seqüència) | **27,92 s** |

El MP4 del projecte (`TNV_V1_CLIP.mp4`) **no és el cleanFeed sencer**: és un extracte que
comença a `mp4ExpandedInPoint` = 124 s del cleanFeed. Però `loadEmergencySrt` ancorava els
temps a `ref.worldSecMediaStart` ⇒ el bloc quedava a `75684−75540 = 144 s` en lloc de
`75684−(75540+124) = 20 s` ⇒ **les entrades sortien 115,5 s tard** a l'editor (buit enorme al
davant) i l'EXPORTAR a Premiere les desplaçava igual.

**Fix**: `refStartSec = worldSecMediaStart + mp4ExpandedInPoint` (amb fallback a
`blockBounds.mp4ExpandedInPoint` i, si no hi és, al comportament antic) + log de la base:
`🚨 SRT_EMERGENCIA: base de temps = cleanFeed 75540.0s + inPoint 124s = 75664.0s → bloc a 20.00s dins del MP4 del clip`.
`index.html` → `srt_editor.js?v=71`.

**Residu conegut (~8 s)**: `_axisOrigin` = 27,92 s vs inPoint del MP4 = 20 s ⇒ el clip va ser
retallat pel davant (CUT IN) i els subtítols d'aquells ~8 s no tenen imatge a la seqüència
(queden a x<0 de l'editor). És coherent, no un error d'eix.

**Validación**: `fp_test_video_sync.html` → **51 PASS / 0 FAIL**; syntax **23 OK / 0 FAIL**.

---

## 🟠 BUG 9 — Marcador de intro (`02i`) a mitges d'un clip

**Síntoma**: el marcador `02i - Intro` no quedava al seu lloc. L'usuari aporta la clau: els
marcadors queden a mitges d'un clip quan el vídeo entra amb **cortinilla** (Premiere no ho veu
com a tall), però aquesta intro **entra per tall**.

**Dades mesurades**:
| Font | Valor |
|---|---|
| Escaleta (manifest) | `01`: OnAir 21:01:55, dur 1:40 · `02i`: **sense OnAir**, dur 0:13 · `02`: OnAir 21:03:47, dur 0:46 |
| F2 calcula `02i` | fin de `01` = 75715 + 100 s → media ≈151 → **tl ≈122,08 s** |
| Talls reals de V1 (detecció d'escenes del MP4, umbral 0,1) | media 147,14 (**tl 119,22**) i media 152,38 (**tl 124,46**) |
| Finestra de snap de F4 | **±0,6 s** (`SEARCH_WINDOW`) |

⇒ El punt deduït queda a **1,38 s** del tall que obre la intro ⇒ fora de la finestra ⇒ F4 **no
el mou** ⇒ marcador a mitges del darrer pla del tema 01. Els 1,38 s són l'error de la durada
d'escaleta: `01` va durar **101,38 s** de vídeo i l'escaleta en diu 100.

**Fix (ventana adaptativa, decisió de l'usuari)**:
- `flow_markers.js`: nous mètodes `_snapWindowDeduced()` (2,5 s per defecte, configurable) i
  **`_chooseSnapTarget(markerTime, win, isDeduced, breaks, clips)`** (funció pura):
  - **FARO** (ítem amb OnAir): comportament d'abans (ruptura de densitat prioritària, si no
    tall real més proper) dins de ±0,6 s.
  - **DEDUÏT** (ítem sense OnAir): s'ancora al **tall que OBRIA l'ítem** (start de clip ≥
    marcador, el que es veu com "entrada per tall"); si no n'hi ha, ruptura de densitat o tall
    més proper, dins de **±2,5 s**.
  - El tipus es dedueix del mapa `num → té OnAir?` de l'escaleta (si el mapa no es pot llegir,
    tots es tracten com a faro → conservador). NO es canvia el nom dels marcadors a Premiere.
- `11_Configuracio.js`: `Config.get()` ara exposa `snapWindowDeducedSec` i
  `srtEmergencyTailSec` (abans no arribaven mai: la clau era al Profile però no al retorn).
- `Profile.json`: `general.snapWindowDeducedSec: 2.5`. `index.html` → `flow_markers.js?v=12`,
  `11_Configuracio.js?v=6`.

**Validación**: `fp_test_marks_snapshot.html` → **33 PASS / 0 FAIL**, amb el **cas real**:
marcador a 122,08 s + talls 119,22/124,46 ⇒ deduït tria **124,46 ("tall d'obertura")** i faro
amb finestra curta **no es mou** (null). Syntax → **23 OK / 0 FAIL** (`11_Configuracio.js`
afegit al check).

### 🔴 Regressió detectada i corregida (mateixa sessió): el faro `01` es movia

Després del canvi, l'usuari va veure que **`01 - INVERSIONS`** (que té OnAir i quedava perfecte)
s'havia mogut. Causa: el mapa `num → té OnAir?` es construïa **sobreescrivint** cada línia;
a l'escaleta hi ha **nums repetits** (`01Chy`, `01GF1`, `01i`, `01`, … i el mateix `01` pot
aparèixer en més d'una agrupació) ⇒ si l'última línia llegida amb `01` no tenia OnAir, el mapa
deia `01 → false` ⇒ el faro es tractava com a **deduït** ⇒ finestra ±2,5 s ⇒ F4 el movia fins a
2,5 s, trencant-lo.

**Fix**: nou mètode pur **`_buildOnAirMap(lines)`** amb **OR** (basta que UNA línia amb aquell
num tingui OnAir perquè sigui faro), i el log ara informa: `nums amb OnAir: N · sense OnAir
(deduïts): M`. `index.html` → `flow_markers.js?v=12` (mateixa versió).

**Regla final**: faro (amb OnAir) ⇒ snap només dins de **±0,6 s** (si no, es queda a la seva
hora d'emissió intacte); deduït (sense OnAir) ⇒ **±2,5 s** ancorant al tall que obre l'ítem.

**Validación**: `fp_test_marks_snapshot.html` → **41 PASS / 0 FAIL** (T11: `01` amb OnAir en
una sola línia → `true` amb qualsevol ordre; `00:00:00` no compta; i amb el mapa bé el `01` no
es mou si els talls són llunyans). Syntax → **24 OK / 0 FAIL**.

### 🎯 Causa definitiva del `01` desplaçat (dades del PIPE del 16/09 11:25)

Snapshot final (`MARCADORS_2026-09-16_1125.txt`) i corts reals post-TROSSEJA del log:

| Marcador | Posició | Tall real més proper | Δ |
|---|---|---|---|
| `01i - Intro` | 0,000 | 0,000 (V1[00]) | 0 ✅ |
| **`01 - INVERSIONS`** | **24,280** | **23,560** (V1[00]→V1[01]) | **0,72** ❌ |
| `02i - Intro` | 124,280 | 124,280 (V1[23]→V1[24]) | 0 ✅ |
| `02 - INSERTS` | 136,280 | 136,280 (V1[24]→V1[25]) | 0 ✅ |

`F3·Correl` va aplicar **Δ = +1,320 s** (confiança 63 %) als tres faros: encertat per a `02i` i
`02`, però per al `01` es va passar 0,72 s (el delta que li tocava era **+0,60**: F1 el deixava
a 22,96 i el seu tall és a 23,56). Com que la finestra de faro era **±0,6 s fixa**, F4 no el
podia corregir (0,72 > 0,6) → quedava dins del clip.

**Fix**: finestra de faro **configurable** → `_snapWindowFaro()` (Profile.json →
`general.snapWindowFaroSec`, **per defecte 1,0 s**). Amb 1,0 s el `01` cau al seu tall (23,56).
Els deduïts continuen amb ±2,5 s. `Config.get()` exposa `snapWindowFaroSec`; `index.html` →
`flow_markers.js?v=13`, `11_Configuracio.js?v=7`.

**Pendent de fons (per a una altra sessió)**: el Δ global de `_correlationSnap` arrossega fins a
~0,7 s d'error. El snap de F4 ara ho absorbeix, però l'ideal seria calcular el delta **per
marcador** (creuant faro ↔ tall més proper) en lloc d'un de global.

**Validación**: `fp_test_marks_snapshot.html` → **49 PASS / 0 FAIL** (T12 amb el cas real:
`24,28 → 23,56` amb win 1,0; `null` amb l'antiga 0,6; i els que ja són al tall no es mouen).
Syntax → **24 OK / 0 FAIL**.

---

## 🎛️ UI — Reorganització del panell en mode usuari (16/09)

**Petició**: treure TROSSEJA i REFRAME, deixar IN · OUT & GO · KEYFRAME en una fila, estrenyir
el panell aprofitant l'espai sobrant i engrandir COLOCAR/REPART.

| Canvi | Detall |
|---|---|
| **Botons fora** | `#btnScene` (TROSSEJA) i `#btnCenter` (REFRAME) eliminats del HTML **i** dels bindings de `main.js`. El trocejat segueix dins del pipeline d'OUT & GO (`Cut.runScene`) i `KF.runAutoReframe` queda com a funció interna (l'efecte de reencuadre no es pot col·locar). |
| **Fila VÍDEO** | Dalt: `IN · OUT & GO · KEYFRAME` (`grid: 27px 1fr auto`). Baix: `◀ · slider · ▶` (`grid: 27px 1fr 27px`). OUT passa a dir-se **OUT & GO** (fa tot el pipeline). |
| **Més estret** | `.main-upper` min-width **640 → 520 px**; `.upper-left` **340 → 280 px**; desplegables `.setup-inputs` màx **180 px**; columnes de grups `.gfx-col` **150 → 128 px**. |
| **COLOCAR / REPART** | Abans 2 columnes fixes de 30 px (i en TREBALL els botons TEST estan ocults → quedaven 2 columnes buides = el "botó d'espai" que sobrava). Ara `repeat(2, 1fr)` + `button { width: 100% }` ⇒ ocupen tot l'ample (~60 px cada un). |

### Afinaments posteriors (mateixa sessió)

- **OUT & GO** ja no s'estira i **KEYFRAME queda just a la seva dreta amb el mateix ample**:
  `.video-row-top` passa a `display: flex`; `#btnOut` i `#btnKey` comparteixen
  `flex: 0 0 64px; width: 64px; box-sizing: border-box`, i **`#btnKey { margin-left: auto }` el
  deixa enganxat al marge DRET**, alineat amb el `▶` de la fila de baix. `.btn-wide-flex` ja no
  porta `flex-grow`.
- **Marca de fps oculta**: `#srtVideoHud { display: none; }` — el codi del visor
  (`srt_editor.js`) **queda intacte** i ja tolerava que l'element no es vegi. Per recuperar-la,
  treure aquella línia.
- **Sense barres de desplaçament**: `#main-content { scrollbar-width: none }` +
  `#main-content::-webkit-scrollbar { width: 0; height: 0 }`. Es pot continuar desplaçant amb
  roda/trackpad si algun dia el contingut no hi cap.

`index.html` → `style.css?v=51`.

### Icones als botons (16/09)

Substitució del text per emojis (decisió de l'usuari; CAR/EXP amb icones diferents, RES/VÍDEO
amb l'alternativa, Doble Pantalla amb dues icones, PORT amb el marc d'imatge):

| Botó | Icona | | Botó | Icona |
|---|---|---|---|---|
| COLOCAR | 🎯 | | GRAF | 🎨 |
| REPART | ↔️ | | DP | 🪟🪟 |
| CAR (SRT) | ⬇️ | | MAPA | 🗺️ |
| EXP (SRT) | 💾 | | TOTEM | 🗿 |
| RES (SRT) | ♻️ | | VID | 📹 |
| | | | PORT | 🖼️ |
| | | | TANC | 🏁 |

- **`index.html`**: `class="secondary icon-only"` als 12 botons (DP a més a més `doble`).
  Els `title` (tooltips) es conserven — són l'única explicació al no haver-hi text.
  `IPD` i els `IN`/`OUT` de SUBTÍTOLS segueixen amb text.
- **`style.css`**: `button.icon-only { font-size: 22px }` (ajustat: omple els 30×30 px amb
  marge; l'emoji de Windows fa ≈1,17× l'amplada del font-size). El cas `doble` (dues icones)
  va a 11 px amb `letter-spacing: -0.5px`.
- **Mides de text apujades** (petició de l'usuari): base `button` 10 → **11 px**; `.btn-big-sq`
  (botó principal) 10 → **11 px**; `📷 FOTO` 9 → **10 px**; `OUT & GO`/`KEYFRAME` 8 → **10 px**;
  `.graphics-strip button` (IPD, IN/OUT SRT, COND/TITOL/LLOC/NOM/RESTO/TRAD, F1-F5…) 8 → **10 px**;
  `.reset-text` 8 → **10 px**; `.btn-debug` 9 → **10 px**.
- **Tancar → ✅** (l'alternativa, en lloc de 🏁).
- `index.html` → `style.css?v=55`.

**Validación**: `C:\temp\fp_layout_check.ps1` → **41 PASS / 0 FAIL** (12 botons amb
`icon-only`, textos antics fora, tooltips conservats, mides 22/11 px, mides de text 10/11 px
i la resta de comprovacions de layout).

---

## 🟠 BUG 10 — Wotts mal col·locats: conductor 0,6 s abans d'hora + deriva de la resta

**Síntoma** (usuari): el conductor havia d'entrar a **7:06** i entrava a 6,64 s; la resta de
rètols s'allunyaven del seu clip de referència "cada cop més".

**Mecanisme real dels rètols** (`flow_chyrons.js`): posició = **marcador de l'ítem + tc del nom**
(`placeTime = refInfo.time + tcSec`, línia 785). El `tc` del nom (`Wott_TNV_v1_01_00.34_…`) és
l'offset DINS de l'ítem — verificat amb el log: `01_00.34 → 57.64s` (23,56 + 34),
`02_00.13 → 149.28s` (136,3 + 13). Per tant **aquesta part és correcta** i no acumula error.

**Causa 1 — conductor amb marges FIXOS (arreglat)**: `placeChyronConductor` calculava
`clipStart + MARGEN_INICIO(0,40) + DUR_TEMA_TITOL(6,24) = 6,64 s`, però el Tema‑Titol real es
col·loca amb la regla general a **1,00 s** (marcador 0,00 + tc 1,00) ⇒ el conductor havia d'anar
a `1,00 + 6,24 = **7,24 s** = 7:06` ⇒ **0,60 s d'abans** (els 0,60 que perseguíem).
Fix: es llegeix el Tema‑Titol de plató (`getWottIndex` + `pickTemaTitols`) i el conductor va
**just després** d'ell (`ttPlaceTime + DUR_TEMA_TITOL`), amb fallback als marges clàssics si no
es pot determinar. Log nou: `📌 [Conductor·CasA] Després del Tema‑Titol real: 1.00 + 6.24 → @ 7.24s`
i `📐 [Conductor] instant base per als chyrons següents: 7.24s`. `flow_chyrons.js?v=14`.

**Causa 2 — chyrons "màgics" repartits uniformement (per confirmar amb l'usuari)**:
`_placeMagicChyrons` (línia 203) col·loca la resta repartint-los **uniformement** pel clip
(`marginStart = clipStart+1` → `marginEnd = clipEnd-1`, `spacing = espai/(n+1)`) ⇒ **sense
relació amb el clip de cada rètol** ⇒ com més llarg el clip, més lluny cauen ("deriva").
Es crida des de 4 punts (línies 109/112/132/135) — cal saber si el flux que fa servir l'usuari
hi passa.

**Causa 3 — els rètols del flux nou cauen ~0,5-1 s després d'un tall**: amb els corts reals
(V1[11] 55.36→57.64, V1[15] 79.08→88.04, V1[18] 94.08→105.92, V1[24] 124.28→136.28) els rètols
queden a 57.64, 79.56, 94.56, 137.28 ⇒ el `tc` del nom sembla **arrodonit al segon** i no cau
exactament al tall. Proposta: aplicar als rètols el mateix **snap al tall real** que ja tenim per
als marcadors (`_chooseSnapTarget`).

**Validación**: syntax check → **24 OK / 0 FAIL** (`flow_chyrons.js` 80.659 chars).

### ✅ Regla dels rètols aplicada (16/09, indicada per l'usuari)

> "Els wotts, en general, han d'estar a **10 frames de l'inici del seu clip de referència**.
> No depèn de lo llarg que sigui el clip. Cal tenir en compte **quan acaba** el clip de
> referència, donat que **el wott ha d'acabar en aquest punt**." (NomCarrec i Lloc sempre així;
> Traducció i algun altre són casos apart.)

**Implementat a `_placeChyronsByType`** (el nucli comú de Nom, Lloc i Resto):
1. Nou `_clipAtInstant(clipsV1, instant)` → el clip de V1 que **conté** l'instant ideal és el
   "clip de referència" (mateix criteri que ja feia servir `_itemEndTime`).
2. `placeStart = clip.start + 0.40 s` (**10 frames** a 25 fps).
3. `placeEnd = min(clip.end, placeStart + durada_pròpia_del_wott)` → el wott **s'acurta** si el
   clip s'acaba abans, però **MAI s'allarga**: si el wott és més curt que el clip conserva la
   seva durada (una versió prèvia estirava fins a `clip.end` amb `Clips.insert(..., end)` i
   Premiere hauria reproduït el wott a càmera lenta — corregit).
4. Els solapaments (`_chooseSlot`) es calculen amb aquesta durada real; si el rètol s'ha de
   desplaçar, es recalcula el final (`min` del clip nou).
5. `_addPlaced` amb el final real, i log nou:
   `📐 [Nom] Wott_… → clip [57.64-68.04] → entra a 58.04s (+10f), surt a 63.24s (durada pròpia del wott)`

**Efecte amb les dades reals** (corts del log d'11:25, wott de 5,2 s):

| Wott | Abans | Ara |
|---|---|---|
| `01_00.34` | 57,64 → 62,84 (5,2s) | **58,04 → 63,24** |
| `01_00.56` | 79,56 → 84,76 | **79,48 → 84,68** |
| `01_01.11` | 94,56 → 99,66 | **94,48 → 99,68** |
| `02_00.01` | 137,28 → 142,48 | **136,68 → 141,88** |
| `02_00.13` | 149,28 → 154,48 | **148,84 → 154,04** |
| `02_00.30` | 166,28 → 171,48 | **166,08 → 171,28** |

**No tocat** (casos apart que l'usuari va indicar): TITOLET (`doSnap=false`, es reparteix dins
de l'ítem) i Traducció (`placeChyronTraduccio`, fa el seu propi repartiment per franges).
El **conductor** segueix la seva regla: just després del Tema‑Titol real (7,24 s = 7:06).

`index.html` → `flow_chyrons.js?v=15`.

**Validación**: syntax check → **24 OK / 0 FAIL** (`flow_chyrons.js` 83.834 chars).

`index.html` → `style.css?v=50`, `main.js?v=39`.

**Validación**: `C:\temp\fp_test_layout_user.ps1` → **24 PASS / 0 FAIL** (bots fora, OUT & GO,
KEYFRAME a dalt, amplades noves, strips i cache-busters). Syntax → **24 OK / 0 FAIL**.



⚠️ **Hay que recargar el panel** (cerrar/abrir la extensión en Premiere o reiniciar) para
que se apliquen `index.html`/`style.css`/`srt_editor.js` nuevos.

**Validación**: `fp_test_video_sync.html` → **29 PASS / 0 FAIL** (clasificación con los Δ
reales del log, `v.play()` con PLAY del panel, HUD, medidor de fps, watchdog, guard);
`fp_test_video_mem.html` → **43 PASS / 0 FAIL**; syntax check del panel → **21 OK / 0 FAIL**.



- [ ] CARREGAR: aparecen los logs `🎞️ Vídeo A MEMÒRIA: … MB` o `còpia local del vídeo …`
- [ ] PLAY: sin tirones ni fotogramas negros, sincronía con el cabezal
- [ ] Canvi de clip (CARREGAR dos veces): no crece la memoria del panel (revoke OK)
- [ ] OUT en TREBALL dispara el pipeline completo · FOTO no se queda colgado
- [ ] SRT de emergencia cubre 0→164 s (offset 20 s, asimétrico)
- [ ] Etiquetes de connexió @26.76 s en V6/V7 · TITOLET distribuido en V7

## 📦 Cambios acumulados SIN commitear (pendientes de validación en Premiere)

`index.html` (?v=66), `style.css` (2 columnas CHY→GRF / SUB→REN), `js/editor/srt_editor.js`,
`js/core/4_Context.js`, `js/logic/10_Srt_Logic.js`, `js/logic/3_Project_Logic.js`,
`js/main.js`, `js/workflows/flow_assembly.js`, `js/workflows/flow_chyrons.js`,
`js/workflows/flow_markers.js`, `jsx/modules/2_IO.jsx`, `jsx/modules/3_Project.jsx`,
`plans/PLAN_VIDEO_PREVIEW.md`.

## 📁 Archivos modificados hoy
- `js/editor/srt_editor.js` — `_loadVideo` (3 niveles), `_loadVideoFromMemory`,
  `_ensureLocalVideoCopy`, `_revokeVideoBlob`, estado `_videoBlobUrl`, `_hideEditor` con revoke
- `.debug` (ignorado por git) — `CEFCommandLineParameters` con `--allow-file-access-from-files`
- `index.html` — cache-buster `srt_editor.js?v=66`
- `plans/PLAN_VIDEO_PREVIEW.md` — sección "ACTUALITZACIÓ — Qualitat de reproducció"

## 🗒️ Notas para el siguiente handoff
- No commitear hasta que el usuario valide en Premiere (regla del proyecto).
- Decisiones abiertas: `flow_retols.js` (borrar vs consolidar), criterio del semáforo de
  estado (SRT presente pero fuera de la pista de subtítulos), `srtEmergencyTailSec` (60 s).

---

*FAST >>> PASS · Sesión 2026-09-15*

---

## 2026-09-16.md

# 📅 2026-09-16 — FAST >>> PASS · Sessió

## 🎚️ SLIDER DE REENCUADRE — FASE 0: instrumentació (mesurar abans d'optimitzar)

**Problema (reportat per l'usuari)**: el slider de reencuadre (`#slider-move`) respon amb
"peresa" als canvis.

### Diagnòstic inicial (estàtic, per lectura de codi)
| # | Troballa | On |
|---|---|---|
| 1 | **Sense coalescing ni back-pressure**: cada esdeveniment `input` (fins a ~60/s) llança un `evalScript` independent. ExtendScript és mono-fil i no cancel·la → els valors intermedis obsolets s'executen igual i la cua creix. En soltar (`onchange`) el COMMIT `isFinal=true` queda al final de la cua. | `js/main.js:353-389` |
| 2 | **Cada crida reescriu el log SENCER a disc, de forma síncrona, en xarxa (UNC)**: `log()` i `forceLog()` reescriuen `_logBuffer.join()` sencer; `callJSX()` reescriu `_auditBuffer` sencer. `window.cep.fs.writeFile` és síncron → bloqueja el fil de la UI. | `js/core/utils.js:197,223,253` |
| 3 | **Competidors dins la mateixa cua d'ExtendScript**: `syncKfMode()` (`Anim.modeInfo`) cada 500 ms NO respecta `isUserDraggingSlider`; `Registry.poll()` també hi entra. | `js/main.js:847,982` |
| 4 | **Treball redundant per crida (JSX)**: `sliderApply` resol target/componentes i per a V1 delega a `x()`, que els torna a resoldre; a més fa lectura de verificació (`getValue`) i format de string per moviment. | `jsx/modules/7_KF.jsx:694, 376-386` |

### Implementat (només mesura, ZERO canvi de comportament)
- `js/core/utils.js`
  - `_perfOn`, `_ioStats`, `_jsxStats` + `_perfReset()`, `_timedWrite()`, `_jsxLabel()`, `_jsxCount()`.
  - Les 3 escriptures del camí calent (`log`, `forceLog`, `callJSX`-auditoria) passen per `_timedWrite()` → ms i bytes de cada escriptura.
  - `callJSX()` compta cada crida real amb etiqueta (`Anim.sliderApply`, `Anim.modeInfo`, `Registry.poll`…).
- `js/main.js`
  - Bloc de mètriques `_perf` + `_perfNow/_perfBeginBarrido/_perfSendStart/_perfRecv/_perfReport`.
  - `slider.oninput` / `slider.onchange`: compten inputs, enviaments, round-trip (min/avg/max), màxim de crides en vola i el drenatge del COMMIT.
  - `updateSliderFromPremiere` → `pollSkip`; `syncKfMode` → `ticksKf`; tick de 500 ms → `ticks`.
- `index.html`: cache-busters `utils.js?v=6`, `main.js?v=40`.

### Informe (una línia al log en soltar el slider)
```
📊 [PERF·SLIDER #1] barrido=1.80s · inputs=96 · enviats=96 · max_en_vola=7 ·
   rt_avg=42.3ms (min 31 / max 88) · espera_total=4.06s · drenatge_final=310ms ·
   IO=118 escr 1240ms (max 96, log 118 / audit 118) 12.40MB reescrits ·
   JSX=118 [Anim.sliderApply=96 · Anim.modeInfo=4 · Registry=6 · altres=12] ·
   ticks500=3 (syncKfMode=3, poll_saltat=3)
```
Apareix a `FASTPASS.log` del projecte; sense projecte obert, al fallback
`_keyframe_trace.log` (arrel de l'extensió). També surt per `console.log` del panell.

### Criteri de decisió (quin coll és)
| Senyal | Conclusió |
|---|---|
| `IO` amb molts ms acumulats dins la finestra | L'I/O síncron a UNC domina → **Fase 2** |
| `max_en_vola` alt i `espera_total` ≫ `barrido` | El backlog domina → **Fase 1** |
| `syncKfMode`/`Registry` amb comptes alts | **Fase 3** aporta de veritat |
| I/O baix i `rt_avg` ~50 ms | El cost és al JSX → **Fase 4 (A–E)** |

## 📈 MEDICIÓ REAL (2026-09-16 13:09) — abans de les fases 1-3

```
📊 [PERF·SLIDER #4] barrido=4.46s · inputs=105 · enviats=106 · max_en_vola=25 ·
   rt_avg=592.5ms (min 86 / max 1194) · espera_total=62.81s · drenatge_final=729ms ·
   IO=206 escr 2411ms (max 31, log 59 / audit 147) 35.07MB reescrits ·
   JSX=147 [Anim.sliderApply=113 · Timeline.get=15 · Anim.modeInfo=15 · Context.list=4] ·
   ticks500=8 (syncKfMode=8, poll_saltat=8)
```
| Senyal | Valor | Lectura |
|---|---|---|
| `inputs` vs `enviats` | 105 vs 106 | 1 evalScript per esdeveniment: **sense coalescing** |
| `max_en_vola` | **25** | 25 crides apilades a la cua d'ExtendScript |
| `rt_avg` | **592 ms** (min 86) | resposta ~0,6-1,2 s per darrere del ratolí |
| `espera_total` | **62,81 s** | **14× la durada del barrido** (4,46 s) = la "peresa" |
| `IO` | 206 escr · **2.411 ms** · 35,07 MB | **54% del barrido bloquejant el fil amb I/O síncron a UNC** |
| `JSX` competidors | 15 `Anim.modeInfo` + 15 `Timeline.get` + 4 `Context.list` | **23% de la cua és soroll** |
| `drenatge_final` | 729 ms | el COMMIT tarda 0,73 s a aplicar-se |

**Veredicte**: les tres causes eren reals i grans. El cost mínim per crida (amb cua buida) és
`rt_min = 86 ms` → cost del JSX + escriptures.

---

## 🚀 FASES 1+2+3 APLICADES (2026-09-16)

### Fase 1 — Coalescing "últim-gana" (`js/main.js`, bloc del slider)
- `slPending` / `slInFlight` / `slRaf`: com a màxim **1 crida en vola**; el `input` només
  actualitza el valor pendent i agenda l'enviament amb `requestAnimationFrame`.
- Els valors intermedis obsolets es **descarten** (comptador `descartats` al informe).
- `onchange`: cancel·la el rAF, marca el job com a `final` i crida `slFlush()` → el **COMMIT
  s'envia sempre com a última operació** (si hi ha una crida en vola, s'encua en acabar).
- Logs: només s'escriu una línia per enviament real (no per esdeveniment).

### Fase 2 — I/O fora del camí calent (`js/core/utils.js`)
- `_logPending` / `_auditPending` + `_ioSchedule()` (flush com a molt 1 cop cada
  `_ioFlushMs = 400 ms`) i `_ioFlushNow()` per a diagnòstic (`forceLog`).
- Escriptura amb **Node `fs.appendFile` ASÍNCRON** (`_nodeFs()` detecta `require`; el manifest
  ja té `NodeJSEnabled=true`) → **no bloqueja el fil de la UI** i només escriu el delta
  (abans: 35 MB reescrits per barrido).
- Fallback sense Node: escriptura clàssica del buffer sencer, però 1 cop per flush.
- `_setLogPath` / `clearLogFile`: flush previ i reinici dels pendents.
- El comptador del informe ara separa `sync` / `async` i acumula `BLOC` (ms bloquejant).

### Fase 3 — Competidors fora de la cua (`js/main.js`)
- `syncKfMode()` retorna mentre `isUserDraggingSlider` (eren 15 `Anim.modeInfo` per barrido).
- `Registry.poll()` no s'executa mentre s'arrossega (eren `Timeline.get` / `Context.list`).

## ✅ MEDICIÓ #5 (2026-09-16 13:35) — després de les fases 1+2+3

```
📊 [PERF·SLIDER #5] barrido=0.73s · inputs=21 · enviats=12 · descartats=10 · max_en_vola=1 ·
   rt_avg=52.8ms (min 32 / max 71) · espera_total=0.63s · drenatge_final=54ms ·
   IO=8 escr 96ms (max 16, BLOC 96ms, sync 8 / async 0) 1.27MB ·
   JSX=19 [Anim.sliderApply=15 · Anim.modeInfo=3 · Context.list=1] · ticks500=2
```
| Mètrica | #4 (abans) | #5 (ara) | Millora |
|---|---|---|---|
| `max_en_vola` | 25 | **1** | cua eliminada |
| `rt_avg` | 592,5 ms | **52,8 ms** | **11×** |
| `espera_total` | 62,81 s (barrido 4,46 s) | **0,63 s** (barrido 0,73 s) | 100× |
| `drenatge_final` | 729 ms | **54 ms** | **13×** |
| `IO` | 206 escr · 2411 ms · 35 MB | **8 escr · 96 ms · 1,27 MB** | 25× |
| Competidors | 34 crides | 4 | ✔️ |

### 🔧 AJUSTOS 2 (residus detectats a #5)
1. **`FS=cep.fs(sync)`**: `require` no és al context de la pàgina → s'escrivia pel camí
   síncron (BLOC 96 ms i reescriptura de l'1,27 MB sencer cada flush, cost que **creix** amb
   el log). Solució implementada: cascada `window.cep_node.require` (API oficial CEP 10+, no
   requereix `--mixed-context`) → `require` → `window.cep.node.require` → `cep.fs` síncron.
   El informe ara mostra **`FS=`** per saber quina via s'ha detectat.
2. **Fallback síncron adaptatiu**: sense Node, l'interval de flush puja amb la mida del log
   (`400 + min(3000, línies*2)` ms) → el temps bloquejant per segon es manté petit.
3. **`ERROR` s'escriu immediatament** (no pot quedar-se a la cua diferida).

## 🏁 CIERRE (2026-09-16) — validat per l'usuari a Premiere

> "A nivel de usuario va realmente suave. No hay que tocar nada más. Solo tocar si hay algún bug."

**Decisió**: es dona per tancat el tema del slider. **No s'aplica res més** (ni manifest ni Fase 4 JSX).

### Estat final
- Coalescing (1 crida en vola, intermedis descartats, COMMIT garantit com a última operació).
- Log/auditoria amb flush diferit; `ERROR` i `forceLog` immediats.
- Competidors (`syncKfMode`, `Registry.poll`) fora de la cua mentre s'arrossega.
- **`FS=cep.fs(sync)`**: Node no és al context del panell → l'escriptura continua sent
  síncrona, però amb l'interval adaptatiu (`400 + min(3000, línies*2) ms`) el bloqueig
  residual és petit i **no creix** amb la mida del log. Suficient en ús real.
- La instrumentació PERF **queda activa** (1 línia de log per barrido; cost negligible).
  Per aturar-la: `FASTPASS_UI.Sync._perf.on = false` i `FASTPASS_UI.Utils._perfOn = false`.

### Mesures (barridos reals a Premiere)
| | #4 abans | #5 després (1-3) | #6 |
|---|---|---|---|
| `max_en_vola` | 25 | **1** | 1 |
| `rt_avg` | 592,5 ms | **52,8 ms** | 67,3 ms (barrido de 0,14 s) |
| `espera_total` vs barrido | 62,81 s / 4,46 s | **0,63 s / 0,73 s** | 0,27 s / 0,14 s |
| `drenatge_final` | 729 ms | **54 ms** | 130 ms |
| `IO` | 206 escr · 2411 ms · 35 MB | 8 escr · 96 ms · 1,27 MB | 3 escr · 44 ms |

### Opcions NO aplicades (documentades per si algun dia cal)
1. **Habilitar Node al panell** (per tenir I/O realment asíncron amb `fs.appendFile`):
   - `CEFCommandLine` va dins de `<Resources>` (confirmat al manifest oficial
     `docs\SAMPLES\CODE\SDK_OFFICIAL\PProPanel\CSXS\manifest.xml`, línies 23-31).
   - Afegir-hi `<Parameter>--enable-nodejs</Parameter>` i deixar que la cascada de
     `Utils._nodeFs()` trobi `window.cep_node.require` (l'informe passaria a `FS=cep_node`).
   - **Requereix reiniciar Premiere** (el manifest es llegeix a l'arrencada).
2. **Fase 4 JSX** (cost per crida: `rt_min` ≈ 32-36 ms). Canvis de cost, no de comportament:
   - A) Passar `seq`/`clip`/`mp` ja resolts de `sliderApply` a `x()` (`7_KF.jsx:694` → `:249`)
     per no repetir `getWorkSequence` + `Clips.at(1,cti)` + `_getMotionProps`.
   - B) Verificació post-escriptura (`getValue()` + string, `:376-386`) només amb `isFinal`.
   - C) No crear objectes de temps ni `getValueAtTime` quan la property no és time-varying.
   - D) Cache (1 entrada) de `_getMotionProps` (`:149`) i `isTimeVarying` per clip.
   - E) No repetir el scan de `_getReframeComponent` si `modeInfo` ja ha dit que no n'hi ha.

---

## 📷 FIX ARRANQUE EN CALIENTE (FOTO) — 2026-09-16 (act mode)

**Reportado**: "Cuando estoy en ESPERANT, si hago FOTO, el semáforo debería pasar a ESC en verde y el
botón a CREAR, y así podría clicar y empezar a trabajar."

### Causa raíz
`4_Context.js → checkContext`: la escaleta local (la FOTO `escaleta_on_demand_*.json`) **només es
consultava si el NAS no tenia cap escaleta** (`if (!esc.found)`). Si el NAS ja tenia el JSON del dia
però el bloc encara s'estava emetent (`found=true, ready=false`), fer FOTO no canviava res:
l'estat quedava a `ESPERANT` i `sem-esc` no passava mai a verd.

### Canvis aplicats
1. **`js/core/4_Context.js` — FOTO local com a font sempre**
   - `lookupLocalStatus(ctx)` es consulta **sempre** (no només quan `!esc.found`).
   - La FOTO passa a ser `semaforoData.esc` quan aporta capacitat d'arrancar (NAS sense escaleta,
     bloc no emès del tot, o ingesta en curs). Si el NAS ja té el bloc complet, es conserva aquesta
     informació (la foto pot ser més antiga).
   - `ingestaEnCurs` es calcula sobre l'escaleta més fiable disponible (NAS o local).
   - Amb `esc.local` → `esFotoLocal` → **no** s'aplica `ESPERANT` → conclusió `NEW` → botó **CREAR**.
2. **`js/core/4_Context.js` — `updateLights`: `sem-esc` en VERD amb FOTO local**
   - Tooltip: `Escaleta OK (FOTO local: <fitxer>)` si el bloc és complet, o
     `FOTO local (bloc en emissió: 2/4 ítems) — pots CREAR i fer ACTUALITZAR després` si és provisional.
   - Sense local i bloc a mitges es manté `pending` (com abans).
3. **`js/workflows/flow_mainButton.js` — `_runNew` permet crear amb FOTO local**
   - Si `isBlockFullyEmitted` és fals però existeix `escaleta_on_demand_*.json` per al bloc →
     es crea el projecte **PROVISIONAL** (log `📷 [NOU] FOTO local…` + status), i es completa amb
     ACTUALITZAR. Sense FOTO es manté el bloqueig (evita projectes genèrics `*_INTRO`).
4. **PROTECCIÓ cleanFeed en ingesta (necessària perquè el punt 3 no trenqui el montatge)**
   - Si `mediaStop < out` del bloc (ingesta en curs): `skipVideoIngesta = true` →
     no s'importa el MP4 del bloc, **no es fa l'extracció ffmpeg** del clip i es crida
     `Project.create(..., cleanFeedData = null)` → projecte **sense vídeo**, amb avís
     `⏳ [NOU] CleanFeed en ingesta… Fes ACTUALITZAR quan acabi`.
   - Motiu: importar-lo truncat a V1 és **irreparable** després, perquè ACTUALITZAR no reimporta
     si ja hi ha capa de vídeo (`3_Project_Logic.js:453` + `hasClips(1,'video')`).

### Seqüència d'ús en caliente
`📷 FOTO` → MAIN (**CREAR**, semàfor ESC verd) → treballar → `ACTUALITZAR` (quan arribin media/rètols;
promociona el `PENDENT` al tema real) → `FOTO` + **OUT & GO** quan tanqui l'emissió.

---

## 🔴 FOTO FALLIDA — CAUSA REAL (2026-09-16 14:1x)

**Síntoma**: el usuario hace FOTO estando en ESPERANT → ESC segueix en **rojo** y botó **ESPERANT**.

**Log del intento**:
```
13:59:47 📷 [Fetch] Sol·licitant foto actualitzada de l'escaleta... (TN_COMARQUES/V1, 2026_09_16)
13:59:48 📡 [ER:Fetch] Cridant API: .../escaletes/PRO1439/_clips?data=2026-09-16&hora=14:00:00...
14:00:15 ❌ [ER:Fetch] Resposta buida o no valida per a 2026-09-16 (hora 14:00:00). No es guarda cap on_demand.
14:00:15 ❌ [Fetch] No s'ha pogut obtenir la foto de l'escaleta
```
→ Sense `escaleta_on_demand_*.json`, el roig/ESPERANT eren **correctes** (no hi havia cap escaleta).

**Comprovació empírica de l'API (curl des de fora, amb el token del codi)**:
| Petició | Resultat |
|---|---|
| `GET` `_clips` | **405** `{"missatge":"Request method 'GET' not supported"}` |
| `POST hora=14:00:00` | **200 · 83.432 B · 1,85 s** ✅ (cleanFeed + clips V1) |
| `POST hora=13:00:00` / `14:30:00` | `{"missatge":"Error","debugInfo":"No s'ha localitzat cap clean feed amb títol [TN COMARQUES [senyal net]] per la data/hora especificada..."}` |

**Diagnòstic**: el codi ja fa POST (correcte) i la hora per defecte `14:00:00` és vàlida. El que va
passar és que **a les 13:59:47 l'API encara no havia localitzat el cleanFeed del dia** (el programa
començava a les 13:45) → va retornar un JSON amb `missatge`, que el codi descartava amb un genèric
"Resposta buida o no valida". **Minuts després (14:01) la mateixa crida retorna 200 + 83 KB.**
El timeout de `curl` a JSX (`--max-time 20`) també va poder tallar la resposta lenta del primer intent.

### Fix aplicat (`js/core/escaleta_fetch.js`)
1. **Reintents**: `API_RETRIES = 2`, `API_RETRY_MS = 6000` (una resposta vàlida en qualsevol intent
   guarda la foto i retorna de seguida).
2. **Motiu REAL de l'API al log i a la UI**: es mostra `missatge` + `debugInfo` (140 chars) o el
   fragment de resposta si no és JSON; abans tota aquesta informació es perdia.
3. `Utils.status('FOTO: l'API no té dades del dia (mira el log)')` i `main.js` (handler FOTO) ja no
   sobreescriu amb el genèric "Error obtenint foto escaleta".

### Conseqüència per al flux en caliento
L'arrancada en calent depèn que l'API publiqui el cleanFeed del dia (uns minuts després de l'inici).
Amb els reintents i el motiu visible l'usuari sap si ha d'esperar o reintentar. Un cop hi ha la foto:
ESC verd + botó CREAR (fix anterior) → CREAR → ACTUALITZAR quan arribin media/rètols.

---

## 🐞 BUG CRÍTICO DE LA FOTO (RESUELTO) — 2026-09-16 14:2x

**Reproducció i causa**: el helper `FASTPASS.IO.curl` (JSX) escriu un `.bat` i l'executa amb
`cmd.exe`. La URL conté `%3A` (hora escapada: `hora=14%3A00%3A00`) i **cmd.exe expandeix els `%`**:
`%3` és l'argument 3 del batch → buit → la URL arribava a l'API com a **`hora=14A00A00`**.
L'API responia error (`{"missatge":"Error","debugInfo":"Format d'hora incorrecte: 14A00A00"}` o `[]`)
→ `escaleta_fetch` la descartava → **la FOTO no guardava mai res**.

**Proves (curl amb el token del codi)**:
| Escenari | Resultat |
|---|---|
| `curl` directe (PowerShell), URL amb `%3A` | **200 · 83.481 B · 1,6 s** ✅ |
| `.bat` idèntic al de l'extensió (URL amb `%3A`) | `{"missatge":"Error","debugInfo":"Format d'hora incorrecte: 14A00A00"}` ❌ |
| `.bat` amb `%` escapat (`%%3A`) | **200 · 83.486 B**, exit code 0 ✅ |
| Log real de l'usuari | `resposta no JSON: []` (mateix símptoma) |

### Fix aplicat
1. **`jsx/modules/2_IO.jsx` → `curl`**: `batUrl = url.replace(/%/g,'%%')` i ídem per al header
   (al batch, `%` literal s'ha d'escriure `%%`). Timeouts ampliats: `--connect-timeout 15
   --max-time 60` i `maxWait = 65000` (la primera crida del dia pot trigar ~30 s).
2. **`js/main.js`**: `FOTO_TIMEOUT_MS` 45 s → **150 s** (2 intents del fetch).
3. El motor JSX **es recarrega sol** en obrir el panell si detecta `.jsx` més nous
   (`main.js:221-231` → `System.jsxDiskStamp()` vs `bootInfo()` → `System.reloadModules()`).

### Extra arreglat en aquesta ronda
- **`js/core/utils.js`**: `log()` ara escriu SEMPRE a fitxer. Sense projecte assignat (fase FOTO /
  checkContext) els missatges només anaven a la consola → el log del NAS quedava congelat i
  "semblava antic". Ara van a `_keyframe_trace.log` (arrel de l'extensió), **netejat a l'inici de
  cada sessió**. `_ensureExtLogPath()` unifica el fallback amb `forceLog`.
- **`js/core/escaleta_fetch.js`**: reintents (2 × 6 s) + **motiu real de l'API** (`missatge` +
  `debugInfo`) al log i a la UI (abans: genèric "Resposta buida o no valida").

---

## 🎤 NO CARREGAVA LA LLISTA DE CONDUCTORS (RESOLT) — 2026-09-16 14:3x

**Símptoma**: en obrir el panell, el selector COND queda **buit**.

**Causa** (`4_Context.js → syncConductorUI`): el selector es pintava **DESPRÉS** d'esperar el
llistat del NAS:
```js
const nasNames = await this._listConductorNames(config.rutas.conductors);  // readdir UNC / fallback JSX
select.innerHTML = "";   // ← si això triga o es penja, el selector no s'omple MAI
```
I `_listConductorNames` tenia un **fallback a `readFolder` (JSX)** que obre CADA .mov per xarxa
(decenes de segons). Com que el motor ExtendScript és **MONO-FIL**, aquesta crida bloquejava tota la
resta del panell → encadenava també el bloqueig de la FOTO (l'intent de 14:25:48 es va quedar
**abans** de cridar l'API: al log no hi ha cap `Cridant API`, i el `findLatest` previ va trigar 36 s).

**Fixes aplicats** (`js/core/4_Context.js`):
1. **Pintat immediat**: els conductors del programa (`Profile.json`: titular + substituts) es pinten
   a l'instant → **el selector ja no queda mai buit**.
2. **Llistat del NAS amb límit de 8 s** (`_withTimeout` nou) → mai no bloqueja el panell; el grup
   `🌐 ALTRES (NAS)` s'afegeix quan arriba.
3. **Fallback JSX només si el programa no aporta cap conductor** (`allowJsxFallback`) → deixa de
   saturar el motor en el cas habitual.
4. Logs clars: `⚠️ [COND] Llistat del NAS no disponible…`, `🎤 [COND] Llista conductores: N en X ms`.

**A més** (`jsx/modules/2_IO.jsx` + `js/main.js`): timeouts del curl continguts
(`--connect-timeout 10 --max-time 30`, espera 35 s) i `FOTO_TIMEOUT_MS` 90 s — perquè una crida
llarga no torni a bloquejar el motor mono-fil.

---

## 🧨 BUG DEFINITIU DE LA FOTO: `Folder.temp` → `~/AppData/...` (2026-09-16 14:3x)

**Evidència irrefutable**: el helper `IO.curl` deixa un `.bat` per intent a `%TEMP%` (un per cada
intent des del **30/07/2026**). Tots contenien les redireccions amb la forma URI:
```bat
curl ... > "~/AppData/Local/Temp/fp_curl_1789561658071.json" 2> "...err"
```
`Folder.temp` convertit a string per ExtendScript dóna **`~/AppData/Local/Temp`**, i **cmd.exe no
expandeix el `~`** → el fitxer de sortida **no es podia crear mai** → el bucle d'espera esgotava el
temps → `ERR:CURL_EMPTY` → `callJSX` el converteix en `"[]"` → `escaleta_fetch` el descartava.
**Conclusió: el botó FOTO no havia funcionat MAI** (ni el 09/09, ni el 30/07...).

### Fix (`jsx/modules/2_IO.jsx`)
1. **`Folder.temp.fsName`** (ruta nativa `C:\Users\...\Temp`) als **4 usos**: `fp_curl_*.json`,
   `fp_curl_*.err`, `fp_curl_*.bat` i `fp_exec_*.bat` (`executeShell`, que tenia el mateix defecte).
2. **Ruta absoluta de curl** (`C:\Windows\System32\curl.exe`, fallback al PATH).
3. **`%` → `%%`** a la URL/header del batch (cmd expandeix `%3A` → `A`).
4. **Traça de diagnòstic** al `.err`: `START <data hora>` (demostra que el .bat s'executa) i
   `EXIT=<codi>`.
5. Timeouts continguts: `--connect-timeout 8 --max-time 20`, `maxWait = 24000` i **1 intent**
   (`API_RETRIES = 1`) → mai més bloquejos de 76 s del motor mono-fil.

### Verificació (end-to-end, fora de Premiere)
`.bat` replicat exactament com el genera ara el JSX:
```
ms=3349 · jsonBytes=83480 · ERR: START 16/09/2026 14:34:03,19
JSON: {"cleanFeed":{"assetId":"PRO52150913","titol":"TN COMARQUES [senyal net]",...
```
- Sintaxi del JSX validada amb JScript (`C:\temp\fp_jsx_syntax.js`): **OK**.
- Syntax harness JS: **24 OK / 0 FAIL**.

---

## ✂️ MARGEN DE SALIDA DEL CLIP (30 s) — 2026-09-16 14:4x

**Reportado**: "El corte del clip CleanFeed ha sido demasiado estricto a la salida. Debería haber
dejado más margen, al menos hasta más allá del OnAir del siguiente ítem (IPD) → el clip importado no
me sirve. Dale más margen: en el corte al menos 30 s, aunque luego en el timeline se muestre menos;
la idea es poder estirar si hace falta."

**Causa (dos sitios con la frontera del ítem siguiente como límite duro)**:
1. `calcPrecisionTrimBounds` (`escaleta_bounds.js:825-826`): el clip = `worldBlockEndSec + handles`.
   Si el OUT cae por **Tier 1** (fin del último ítem emès) y el ítem siguiente (IPD) empieza más
   tarde, el clip **no llegaba** a su OnAir.
2. `calcOnAirBounds` (`:420-423`): `hardOut = nextStart + 0.04` → **0,04 s** de margen después del
   inicio del siguiente ítem ✗ (y anulaba los handles).

**Fix**: nuevo parámetro configurable **`clipOutMarginSec = 30`** (`11_Configuracio.js.general`),
expuesto como `Config.get().clipOutMarginSec` y leído con `ER._getOutMarginSec()` (`escaleta_config.js`).
Aplicado en los 3 puntos de cálculo:
- `calcPrecisionTrimBounds`: si hay siguiente ítem con OnAir, `mp4ExpandedOutPoint` se amplía hasta
  `nextOnAir + clipOutMarginSec` (log `✂️ [OUT-MARGIN] Clip ampliat…`) y se limita al final del
  cleanFeed.
- `calcOnAirBounds`: `hardOut = nextStart + clipOutMarginSec` (abans `+0.04`).
- `calcClipBounds`: `+ handles + clipOutMarginSec`.

**Importante**: **el OUT del bloque/secuencia NO cambia** (`worldBlockEndSec` intacte) → en la
timeline se muestra lo mismo que antes; el margen es **material del clip**, para poder estirarlo.

**Para regenerar el clip del proyecto ya creado**: el clip solo se extrae/inserta en CREAR (`_runNew`),
y ACTUALIZAR no lo reimporta si V1 ya tiene vídeo. Vía limpia: renombrar/mover el `.prproj` del día
→ MAIN ofrecerá **CREAR** (la FOTO ya lo permite) → se regenera el clip con el margen nuevo.

---

## 📋 ESTAT ESCALETA DE SISTEMA + FOTO (2026-09-16 14:45-15:0x)

**Lo que el motor ha publicado hoy (NAS ESCALETES, verificado)**:
| Fichero | Bytes | Válido |
|---|---|---|
| `20260916_083614_MATINS_V2_…` | 191.860 | ✅ escaleta |
| `20260916_081029_MATINS_V1_…` | 182.911 | ✅ escaleta |
| `20260916_144529_TN_MIGDIA_V1_…` | 131.039 | ✅ escaleta |
| **`20260916_143043_TN_COMARQUES_V2_FIGUERES_A_FIGUERES_…`** | **82.833** | ✅ **escaleta** |
| `20260916_144046_TN_COMARQUES_V3_…` | **209** | ❌ **fichero de ERROR del motor** |

Contenido del "V3" (209 B): `{"missatge":"Error","debugInfo":"No s'ha localitzat cap clean feed amb
títol [TN COMARQUES [senyal net]] per la data/hora especificada [2026-09-16 14:40:46]…"}`.
⇒ La extensió fa bé de descartar-lo (`escaleta_io.js:693-696`). **De TN_COMARQUES no hi ha V1 publicat
avui**, per això amb el bloc **V1** el semàfor queda vermell. **Amb V2 es pot treballar ja.**

**Millora aplicada**: el motiu del descart ara inclou el `debugInfo` del servidor
(`⚠️ [ER:IO] Motiu: Error [No s'ha localitzat cap clean feed amb títol …]`) → el log explica el vermell.

**FOTO (estat)**: el `.bat` **sí s'executa** (la traça `START 16/09/2026 14:45:31,48` hi és ✓) però el
`curl` **no acaba** dins dels 24 s (ni `EXIT=` ni cap error a l'.err) → el cmd queda obert i el panell
abandona. Des de fora, la mateixa crida triga 1,6-3,3 s. Per al proper intent:
- `curl -sv` (verbose a l'`.err`) per veure on es queda (DNS/connexió/TLS/resposta).
- **No s'esborren** `.bat`/`.err` a `%TEMP%\fp_curl_<stamp>.*` (abans es netejaven) i el missatge
  d'error inclou la ruta dels fitxers.

---

## 🧭 ESCULL LA ESCALETA VÀLIDA I PERMET ARRENCAR (2026-09-16 15:1x)

**Reportado**: "No puedo cambiar el bloque a V2 porque me abriría el proyecto de V2. Necesito que el
código escoja la escaleta para poder trabajar. Pero aun escogiendo V2 sigue en ámbar."

**Causa**: `findLatest` (`escaleta_io.js`) ja ignorava el bloc i agafava **el JSON més recent del
programa**… i el més recent de TN COMARQUES era el **fitxer d'ERROR** del motor
(`20260916_144046_…V3…json`, 209 B: `{"missatge":"Error","debugInfo":"No s'ha localitzat cap clean
feed…"}`) → `load()` el descartava i l'extensió es quedava **sense escaleta**, tot i tenir el
**V2 vàlid (82 KB)** al mateix directori. Per això el semàfor era ambre/vermell amb V1 **i** amb V2.

**Fixes aplicats**:
1. **`escaleta_io.js → findLatest`**: recorre els 5 JSON més recents del programa i **retorna el
   primer VÀLID** (`cleanFeed` + `escaleta`), saltant els fitxers d'error. Logs:
   `⚠️ JSON descartat (no es escaleta): …` / `ℹ️ El JSON més recent no era vàlid; s'usa: …` /
   `✅ JSON més recent vàlid (global): …`.
2. **`4_Context.js → checkContext`**: es permet **CREAR** sempre que hi hagi una escaleta
   localitzada (FOTO local **o escaleta del sistema**) encara que el bloc no estigui emès del tot o
   la ingesta estigui en curs; `ESPERANT` queda reservat a **no haver-hi cap escaleta**. Log:
   `📡 [checkContext] Escaleta del sistema amb bloc en emissió (1/7 ítems emesos) → es permet CREAR…`.
3. **`flow_mainButton.js → _runNew`**: la guarda de bloc complet s'obre també amb **l'escaleta del
   sistema** (`escSistemaOk`), no només amb FOTO; es crea el projecte **PROVISIONAL** i es completa
   amb ACTUALITZAR. Log: `📡 [NOU] Escaleta del sistema amb el bloc en emissió (…): es crea el
   projecte PROVISIONAL…`.

**Resultat**: amb el bloc **V1** seleccionat (sense canviar res a la UI) l'extensió fa servir
l'últim JSON **vàlid** del dia (V2) — que conté les línies del bloc V1 — i deixa crear el projecte.

---

## 🛠️ PLAN DE ARRANQUE (FASES 0-5) IMPLEMENTADO — 2026-09-16 15:3x

**Decisión del usuario**: se hace **todo el plan**; y **"si se hace la FOTO, tiene preferencia"** sobre la
escaleta de sistema.

### Fase 0+1 — Transporte de la API sin `.bat` (`jsx/modules/2_IO.jsx → IO.curl`)
- **VIA 1 (preferida)**: `system.callSystem(cmd)` → ejecuta curl directo, **espera el proceso** y
  devuelve stdout. Evita: ventana de CMD, `~` sin expandir, `%` expandido y el bucle `$.sleep` que
  bloqueaba el motor mono-fil.
- **VIA 2 (fallback)**: el `.bat` actual (ya corregido: `Folder.temp.fsName`, `%`→`%%`, ruta absoluta
  de curl, traza `START`/`EXIT`, ficheros no borrados a `%TEMP%`).
- Log de la vía usada: `[FASTPASS.IO.curl] OK via callSystem (N ms, M chars)` o el motivo del fallback.

### Fase 2 — Hora correcta y sin `%`
- **`_buildFetchUrl`**: la hora va con `:` directo (no `%3A`) → desaparece el problema de cmd.
  **Verificado**: `hora=14:00:00` sin escapar → **HTTP 200 · 83.480 B · 1,67 s** ✓
- **Hora de la petició**: (1) `cleanFeed.mediaStart` del JSON del día, (2) **hora de inicio del
  programa** desde `Config.programStartHours` (TNC 13:50 / TNM 14:30 / TNV 21:00), (3) hora actual.
  Mai una hora fixa.
- **Fuente única**: `programStartHours` a `11_Configuracio.js` y `_runNew` la consume (`flow_mainButton`).

### Fase 3 — Escaleta: mecanismo bueno conectado + FOTO con preferencia
- **`getStatus`** usa **`findLatestValid`** (existía pero no la llamaba nadie): `ready = bloc complet ||
  escaletaValid`, y propaga **`waitSec`** (tooltip `— espera ~X min`) y `escaletaValid`.
- **`findInFolder`** (còpia local): salta JSON invàlids i **prioritza `escaleta_on_demand_*` (FOTO)**.
- **`lookupLocalStatus`**: igual prioritat + `isFoto` y **una FOTO sempre és `ready`** (l'usuari l'ha
  demanada expressament).
- **`checkContext`**: si hi ha FOTO → **mana SEMPRE** sobre la del sistema (log
  `📷 FOTO local amb PREFERÈNCIA (fitxer)`), amb el bloc complet conservat si el NAS el té.

### Fase 4 — Diagnòstic net
- **`callJSX(script, {rawError:true})`**: els ERR de transport ja no es converteixen en `"[]"` (els
  fa servir `escaleta_fetch`), així el log diu `ERR:CURL_EMPTY…` en comptes de `resposta no JSON: []`.

### Fase 5 — Validació
- Fet: harness JS **24 OK / 0 FAIL** · sintaxi JSX **OK** (JScript) · API amb la URL nova **200/83 KB**.
- Pendent: prova a Premiere (FOTO → ESC verd + CREAR).

---

## 🎬 COLA DEL CLIP (60 s) + MARGE FINAL DEL SRT (120 s) — 2026-09-16 16:0x

**Petición (imperativa)**: el clip extraído del cleanFeed ha de tenir **molta més cua** (~1 minut) per
poder **estirar-lo a la timeline** si una connexió o un directe s'allarga; i els subtítols que es
carreguen a l'editor han de tenir també **més marge final** ("retallar el que sobra no costa res; no
tenir-ne, és una pèrdua de temps inassumible").

### 1. Cola extra del clip extret (ffmpeg)
- **Abans**: `extractClip(cleanFeed, bounds.mp4ExpandedInPoint, mp4Duration, clipPath)` → el fitxer
  acaba just al final del bloc → **no es podia estirar gens**.
- **Ara** (`flow_mainButton.js`): `dur = mp4Duration + clipExtraTailSec` (60 s per defecte), log
  `🎬 [EXTRACT] … dur=X (bloc Y + cola extra 60)`.
- **El clip inserit NO canvia**: `clipExpandedOutPoint = mp4Duration` → a la timeline es munta igual
  que fins ara; el material extra queda al fitxer per poder estirar.
- Configurable: `Profile.json → general.clipExtraTailSec` (i `Config.get().clipExtraTailSec`).
- Nota: si el cleanFeed s'acaba abans, `ffmpeg -t` retalla sol (sense error).

### 2. Marge final dels subtítols (editor SRT)
- **Ja era configurable**: `srt_editor.js:450` → `tailSec = config.srtEmergencyTailSec`, i
  `winEnd = worldEnd + max(handles, tailSec)` (finestra asimètrica: sense marge pel davant, amb marge
  pel darrere). **No cal tocar l'editor** (protegit).
- **Canvi**: `srtEmergencyTailSec` **60 → 120 s** (`11_Configuracio.js`). Així el material del clip
  estirat (bloc + 20 s de handles + 60 s) queda cobert pels subtítols (bloc + 120 s).
- Límit real: el marge és **relatiu al `worldBlockEndSec` del manifest** i només pot recuperar text
  que existeixi als SRT de 15 min del dia (no s'inventa res).

### Validació
- Syntax harness: **24 OK / 0 FAIL**. Cache-busters: `11_Configuracio?v=11`, `flow_mainButton?v=11`.
- **Prueba real con ffmpeg** (fuente de 100 s generada con `testsrc`):
  - `-ss 10 -t 40` (com abans) → **40,2 s**
  - `-ss 10 -t 100` (bloc 40 + cola 60) → **90 s** (= tot el que queda de cleanFeed)
  → +50 s de material al fitxer, sense error quan la font s'acaba.
  - Amb una font de només 3 s: `-t 5` i `-t 65` donen 3,04 s → retalla sol ✔.
- Perquè el projecte actual ho agafi cal **regenerar el clip** (renombrar el `.prproj` → MAIN → CREAR).

### ⚠️ Detectat: Profile.json NO s'aplica en runtime
`_activeConfig` (11_Configuracio.js:17) **no es reasigna mai** parsejant `Profile.json` → `setup.html`
desa el JSON però ningú el carrega. Els valors efectius són els defaults del codi
(`11_Configuracio.js`). Pendent/oferta: implementar el merge runtime del Profile.json.


### Validació
- Syntax harness: **24 OK / 0 FAIL** (`main.js` 59.382 chars, `utils.js` 41.468 chars).
- Micro-test de `_jsxLabel()` amb cscript JScript: **8 OK / 0 FAIL** (`C:\temp\fp_perf_label_test.js`).
- Cache-busters: `main.js?v=42`, `utils.js?v=8`.


---

## 2026-09-17.md

# Progress · 2026-09-17

## 🎬 Cola del clip (60 s) + margen final del SRT (120 s)
- `flow_mainButton.js`: `extractDuration = mp4Duration + clipExtraTailSec` (60 s).
  El clip insertado NO cambia (`clipExpandedOutPoint = mp4Duration`); el material extra
  queda al fitxer per poder ESTIRAR el clip a la timeline.
- `11_Configuracio.js`: `clipExtraTailSec: 60` + `srtEmergencyTailSec: 60 → 120`
  (el marge del SRT ja era configurable; no cal tocar l'editor, que és protegit).
- Verificat amb ffmpeg real: font de 100 s → `-t 40` = 40,2 s; `-t 100` = 90 s.
- ⚠️ Detectat: `Profile.json` NO s'aplica en runtime (`_activeConfig` mai es reassigna).

## 🚨 ORDRE DELS MARCADORS (línia vermella) — arreglat
**Símptoma (snapshot del projecte TNV_V1 del 2026-09-17 10:48)**
```
3.  36.640  01 - +++ IPD FED +++            <- IPD
4.  37.720  01dir - CONNEXIÓ WASHINGTON     <- directe (a l'escaleta va ABANS: seq 34 vs 35)
```
**Causa arrel (3 defectes encadenats)**
1. `flow_mainButton.js:77-82` ordena `lines` PER TC, però `flow_markers.js` (F2) creia
   que era ordre d'escaleta → el mapa de límits donava a `01dir` el faro `01` com a
   "left" (a l'escaleta és POSTERIOR).
2. El clamp de F2 (`flow_markers.js:692-694`) empenyia el deduït a la DRETA del faro:
   `deduced=75738 → 37.14s` (limits.left = 01@36.64).
3. F4 el rematava: `37.14 → 37.72`. Cap fase verificava l'ordre → inversió final.

**Solució implementada**
- `flow_markers.js` nous helpers: `_extractPrefixFromComment`, `_prevCutBefore`
  (tall de V1 immediatament anterior) i `_seqOrderForItems` (ordre per `sequencia`).
- F2: mapa de límits construït en ORDRE D'ESCALETA (`linesOrdered`); el darrer ítem
  sense OnAir abans d'un faro (`esUltimAbansFaro`) es col·loca al SEU TALL ANTERIOR.
  El faro (OnAir) no es mou mai.
- **Nova fase F6 `enforceMarkerOrder`** (al final del pipeline): recorre els marcadors
  en ordre d'escaleta i garanteix monotonia. Gràfics/tótems exempts. Si la inversió és
  entre dos faros, avisa i no toca res.
- `main.js`: fase `['Ordre (F6)', ...]` + si la V1 ja està trocejada (≥2 clips) les
  fases OUT i TROSSEJA queden inertes → **només marcadors** (petició de l'usuari).
- `index.html`: `flow_markers?v=14`, `main?v=46`.

**Validació**
- Simulació JScript amb dades reals (`C:\temp\fp_order_sim.js`):
```
  1.  0.00s  01GF3
  2.  0.00s  01dp
  3. 26.48s  01dir   <- TALL ANTERIOR a l'IPD (26:12 que deia l'usuari)
  4. 36.64s  01  (FARO/OnAir)
  5. 112.64s 02  (FARO/OnAir)
  6. 138.64s 03  (FARO/OnAir)
  OK: ordre d'escaleta respectat
```
- Harness de sintaxi: **24 OK / 0 FAIL**.

**Pendent**: proves reals a Premiere (botó OUT amb la V1 ja trocejada). NO s'ha fet
commit (regla: no commitejar sense verificar a Premiere).

## 🎯 DERIVA DELS FAROS (01/02/03) — ajust al tall
**Símptoma (usuari)**: els marcadors 01, 02 i 03 quedaven FORA del tall (deriva ~1 s).

**Diagnosi (dades reals 11:46)**:
| marcador | posició | tall real | distància | finestra F4 | ajust? |
|---|---|---|---|---|---|
| 01dir | 26,48 | 26,48 | 0 | ±2,5 s (deduït) | ✅ |
| 01 | 36,64 | 37,72 | **1,08 s** | ±**1,0 s** (faro) | ❌ |
| 02 | 112,64 | 113,92 | **1,28 s** | ±**1,0 s** (faro) | ❌ |
| 03 | 138,64 | 139,68 | **1,04 s** | ±**1,0 s** (faro) | ❌ |

`[F4·Faro] Cap marcador per ajustar (4 ja correctes)` → F4 es quedava a 0,04-0,28 s.
No s'havia eliminat cap ajust: el snap dels DEDUÏTS (±2,5 s) sempre els ha cobert,
però als FAROS els faltaven dues coses:
1. La finestra era ±1,0 s (massa curta per a una deriva d'1,0-1,3 s).
2. Per als faros F4 només provava "ruptura de densitat" o "tall més proper";
   **mai el tall que OBRE la peça** (`openCut`), que és el punt semànticament cert.

**Canvis**
- `flow_markers.js` `_chooseSnapTarget`: els FAROS ara també s'ancoren al
  **tall d'obertura** (el primer tall ≥ posició del marcador) abans del tall més proper.
- `flow_markers.js` `_snapWindowFaro`: fallback 1,0 → **1,5 s**.
- `11_Configuracio.js`: `snapWindowFaroSec: 1,0 → 1,5` (les dues ocurrències).
- `index.html`: `flow_markers?v=15`, `11_Configuracio?v=12`.

**Validació (simulació amb dades reals, `C:\temp\fp_f4_sim.js`)**
```
01dir (deduït, ±2.5s): 26.48 -> 26.48  (tall d'obertura, d=0.00)
01    (faro,   ±1.5s): 36.64 -> 37.72  (tall d'obertura, d=1.08)
02    (faro,   ±1.5s): 112.64 -> 113.92 (tall d'obertura, d=1.28)
03    (faro,   ±1.5s): 138.64 -> 139.68 (tall d'obertura, d=1.04)
```
Ordre preservat (26,48 < 37,72 < 113,92 < 139,68). F6 queda de xarxa de seguretat.
Harness de sintaxi: **24 OK / 0 FAIL**.

**Nota**: OUT i TROSSEJA sí es van executar (la V1 tenia 1 clip → no es va activar el
mode "només marcadors"); el missatge `saltant OUT i TROSSEJA` no apareix perquè
`Clips.count` va retornar 1.

## 🎯 ESCALETA DE MATINS: serie de escaletaId (2026-09-17)

**Símptoma**: no es pot carregar l'escaleta de Matins. Els 5 JSON del dia (V1-V5)
son ficheros d'ERROR del motor (81 B):
`{"missatge":"L'escaleta no existeix","debugInfo":"/v2/escaletas/PRO1278/_clips"}`

**Diagnosi**:
- El motor del canal publica un rundown per dia feiner (MATINS-DILLUNS, -DIMARTS, ...).
- IDs dels dies amb escaleta VALIDA al NAS: **lun 14/09 → PRO1374 · mar 15/09 → PRO1376
  · mie 16/09 → PRO1377**. Avui (jue) el motor demana **PRO1278**, que NO existeix.
- **MATINS era l'unic programa sense `escaletaId`** a la config (els TN tenen
  PRO1439/PRO1440/PRO1442) → el botó FOTO no podia demanar-la a l'API: sense pla B.

**Solució implementada** (`js/core/escaleta_fetch.js` + `11_Configuracio.js`):
1. `_estimateEscaletaIdFromHistory(programArchivo, dateDir)`: llegeix els IDs dels
   **2-3 dies anteriors** amb escaleta vàlida al NAS, calcula els dies feiners
   transcorreguts (caps de setmana exclosos) i estima el d'avui amb **+1 per dia feiner**.
   El "pas real" es calcula nomes per al log (pot ser >1 per festius/rundowns extra).
2. `_escaletaIdCandidates(baseId, 3)`: veins ±1, ±2, ±3.
3. `_resolveEscaletaId(...)`: prova **contra l'API** (1 crida per candidat, màx 5,
   parada al primer èxit): base de config → estimat → veins. Desa el JSON bo i
   **retorna directament** (estalvia una segona crida).
4. `fetchNewEscaleta`: crida `_resolveEscaletaId` abans del flux normal; si obté
   escaleta vàlida, la guarda com `escaleta_on_demand_<ts>.json` i retorna.
5. Config MATINS: `escaletaId: "PRO1378"` (darrer conegut, jue 17/09).
6. `index.html`: `escaleta_fetch?v=8`, `11_Configuracio?v=13`.

**Validació** (simulació JScript `C:\temp\fp_matins_sim.js` amb les dades reals):
```
CAS REAL (avui 20260917, base PRO1378): dies feiners des del darrer=1
  ESTIMAT: PRO1378
  candidats: PRO1378, PRO1379, PRO1377, PRO1380, PRO1376  -> cobreix 1376-1380
AMB FESTIU: estimat PRO1002 · candidats 1001,1002,1000,1003,999
DILLUNS (cap de setmana pel mig): estimat PRO1501 · candidats 1501,1502,1500,1503,1499
```
Harness de sintaxi: **24 OK / 0 FAIL**.

**Pendent**: provar a Premiere (Matins + botó 📷 FOTO) i confirmar a l'API quin ID
respon avui (1378/1379/1380). NO commit encara.

## 🔬 INTENT REAL DE FOTO MATINS (12:31-12:40) — 2 bugs propis trobats

**Log real**: `_keyframe_trace.log` (12:39-12:40) + `FASTPASS.log` (12:31-12:32).
Resultat: el projecte es queda en `NEW` i el semafor queda **ESPERANT** (no hi ha cap
escaleta valida del dia). Dues causes externes + DOS BUGS NOSTRES:

| línia del log | què vol dir |
|---|---|
| `L'escaleta no existeix [/v2/escaletes/PRO1278/_clips]` | el motor publica errors per als 5 blocs de MATINS d'avui |
| `💥 [JSX ERROR]: ERR:CURL_EMPTY: ... Trying 10.32.2.110:443...` (25 s) | la FOTO **no va poder connectar** amb digition des de Premiere |
| `⏭️ PRO1378/PRO1379/PRO1377/PRO1380 → Error / resposta no valida` | els 5 candidats van caure per la xarxa (no per l'ID) |
| `⚠️ Estimacio de serie fallida: step is not defined` | **BUG NOSTRE**: la estimacio no retornava valor |
| `⏰ Hora de la petició: 00:00:00 (inici de programa MAT)` | **BUG NOSTRE**: `isFinite(null) === true` -> hora 0 |

**FIX 1** `escaleta_fetch.js`: `return { estimate: estimateStr, step: realStep, seen: seen }`
(abans `step: step`, que ja no existia → llençava excepcio i l'estimacio es perdia).

**FIX 2** `escaleta_fetch.js`: `if (startH != null && isFinite(startH))`.
`isFinite(null)` es TRUE a JavaScript (null→0), aixi que els programes sense hora
d'inici (MAT) demanaven l'escaleta amb `hora=00:00:00`.

**FIX 3** `programStartHours` ara inclou **`MAT: 8.0`** (`11_Configuracio.js:21` i `:161`).
Afecta la FOTO **i** el calcul de l'ancla dels marcadors: `flow_mainButton.js:233`
(`PROGRAM_START_HOURS[shortProg] || 0`) → per a Matins valia **0**.

**Estat**: sintaxi 24 OK / 0 FAIL · `index.html` → `escaleta_fetch?v=9`, `11_Configuracio?v=14`.

## 📢 MOTIU AL SEMÀFOR (2026-09-17)

Abans, quan el motor publicava un error, l'usuari veia "ESPERANT" i el motiu només
surtia al log. Ara es mostra a la UI:

**`escaleta_io.js`**
- `ER.load`: quan descarta un JSON d'error del motor desa
  `ER._lastReject = { filename, reason }` amb `missatge` + `debugInfo` (120 chars).
- `ER.getStatus`: reinicia `_lastReject` a cada consulta i l'exposa com `reason` en els
  retorns `!latest` i `!data`.

**`4_Context.js`**
- `updateLights`: `escMotiu` → tooltip del `sem-esc` en els casos `!found` i `!ready`.
- `_onMainClick`: si hi ha `reason`, el status diu
  *"ESPERANT: no hi ha cap escaleta valida del dia. Motiu: ..."* en comptes del genèric.

**Text verificat amb el JSON real d'avui**:
```
Semafor:  No s'ha trobat cap escaleta (servidor ni FOTO local) | Motiu: L'escaleta no existeix [/v2/escaletes/PRO1278/_clips]
Status:   ESPERANT: no hi ha cap escaleta valida del dia. Motiu: L'escaleta no existeix [/v2/escaletes/PRO1278/_clips]
```
Sintaxi 24 OK / 0 FAIL · `index.html` → `escaleta_io?v=9`, `4_Context?v=12`.

## 🔥 CAUSA RAÍZ DE LA FOTO (12:55-12:58) — ¡PRO1378 ES CORRECTO!

**Evidencia en `%TEMP%\fp_curl_1789642667558.json` (206 KB, HTTP 200)**:
```
escaleta.id = PRO1378 | ruta = FINESTRES.MATINS.MATINS-DIJOUS
mediaStart  = 07:55:00 | 342 ítems
```
→ **PRO1378 es el ID bueno** y la descarga FUNCIONA. La serie estimada era correcta.

**Qué fallaba (tiempos demasiado cortos)**:
1. `2_IO.jsx`: `--max-time 20` en curl, pero el handshake TLS con digition tarda
   **~26 s** en esta red → curl se cortaba y devolvía `ERR:CURL_EMPTY`
   (el JSON diana llegaba al Temp unos segundos DESPUÉS).
2. `2_IO.jsx`: `system.callSystem` devolvía **SIEMPRE vacío** → caía al `.bat`
   → **de ahí la ventana de CMD** en cada intento.
3. `2_IO.jsx`: el bucle de espera era de **24 s** (`maxWait`).
4. `main.js`: guard global `FOTO_TIMEOUT_MS = 45000` → abortaba a los 45 s,
   con 5 candidatos × ~26 s = 130 s.

**FIXES**
| Fichero | Antes | Ahora |
|---|---|---|
| `jsx/modules/2_IO.jsx` (callSystem) | captura stdout, `8/20` s | **redirige a fichero** y lo lee, `15/60` s |
| `jsx/modules/2_IO.jsx` (.bat fallback) | `8/20` s | `15/60` s |
| `jsx/modules/2_IO.jsx` (`maxWait`) | 24 s | **70 s** |
| `js/main.js` | `FOTO_TIMEOUT_MS = 45000` | **180000** |
| `js/core/escaleta_fetch.js` | 5 candidatos | **3** |
| `js/core/11_Configuracio.js` | `MAT: 8.0` | **`MAT: 7.9167`** (mediaStart real 07:55) |

*Nota: en `2_IO.jsx` no se ha añadido funcionalidad nueva — es la MISMA función `IO.curl`
corrigiendo su transporte (regla "JSX cerrado": aquí se arregla un bug, no se amplía API).*

**Esperado ahora**: FOTO → 1 llamada (~26 s) → `✅ escaletaId resolt: PRO1378 (base)` →
`✅ FOTO guardada amb escaletaId PRO1378` → **sin ventana de CMD**.
Sintaxi 24 OK / 0 FAIL · `index.html` → `main?v=47`, `11_Configuracio?v=15`, `escaleta_fetch?v=10`.

## ✅ DESBLOQUEO MATINS + BUG DEL BUCLE D'ESPERA (13:05-13:06)

**Log**: la hora já és correcta (`Hora de la petició: 07:55:00 (inici de programa MAT)`)
i **la escaleta ES DESCARREGA**: `fp_curl_1789643119628.json` = **206397 B (PRO1378)**
escrit a les **13:05:22**, només **3 s** després d'arrencar el `.bat` (13:05:19).

**I tot i així**: el bucle va esperar fins a **13:06:36** (77 s ≈ `maxWait 70000`) i va
acabar amb `ERR:CURL_EMPTY` — **el fitxer hi era al disc**.

**BUG**: `2_IO.jsx` esperava amb un **únic objecte `File`** (`outFileObj.exists/length`),
que quedava obsolet → no veia el fitxer. **FIX**:
- objecte `File` NOU a cada volta del bucle,
- si l'`.err` ja conté `EXIT=` (el `.bat` ha acabat) s'atura l'espera,
- es recrea el `File` abans de llegir el resultat.
→ La FOTO ha de tornar en **~3-5 s**, no 70 s.

**DESBLOQUEO IMMEDIAT (fet)**: el JSON bo s'ha copiat com a FOTO local a
```
\\DSMEDIA07\...\PROVES\01_MATINS_PROJECTES\2026_09_17\escaleta_on_demand_1789643282686.json
(206397 B, escaleta.id=PRO1378, 342 ítems)
```
`escaleta_io.lookupLocalStatus` fa `isReady = isOnDemand || complete.ok` → **una FOTO
sempre és utilitzable** (encara que el bloc no consti com a emès) → semàfor verd + CREAR.

## 🔴 MARCADORS VERMELLS (ítems que no són del bloc) — 2026-09-17

**Spec** (`docs/specs/MARKER_COLORS.md`): color 1 = **VERMELL** = "ítems no
verticalitzables" (`agrupacio == null` + durada > 0). 4 = groc (gràfics), 6 = blau (del projecte).

**Problemes trobats i arreglats**:
1. `flow_markers.js` F1: `var colorIdx = 6;` **fix** → un ítem del bloc que no era del
   projecte sortia BLAU. Ara aplica `_getColorIdx(line)` (la spec).
2. `assembly_context.js`: `_detectFirstUngroupedItem` només retornava **UN** ítem →
   nova funció **`_detectUngroupedItems`** que en retorna **TOTS** i s'exposa al ctx
   (`ungroupedItems`). `firstUngroupedItem` = el primer (compatibilitat).
3. `flow_markers.js` F1: ara els col·loca **tots** amb `colorIdx: 1` (VERMELL) i log
   `🔴 [F1·Ungrouped] <num>: → <t>s [VERMELL: no es del bloc]`.
4. `flow_markers.js` F6: els vermells **queden exempts** de la guarda d'ordre (són fites
   per delimitar el bloc, no s'han de moure).

**Criteri (corregit per l'usuari)**: NOMÉS compten els ítems **sense agrupació**
(`agrupacio == null`). Els ítems d'ALTRES blocs (v2, v3...) **NO** es marquen: ens
centrem en el bloc actual. (Es va provar d'incloure'ls i es va revertir.)

`index.html` → `assembly_context?v=7`, `flow_markers?v=16`. Sintaxi 24 OK / 0 FAIL.

## ✂️ CLIP DE 17 MIN AL TIMELINE (TNC V1) — OUT mal aplicat

**Símptoma**: en V1 se insertó un clip de **1018 s (17 min)** en lugar del recorte del bloque.

**Diagnòstic (manifest `TNC_V1.fastpass.json`)**:
```
bloque V1 real : 13:48:08 → 13:59:25  (ítems 27, 28, 29, 32)   = 677 s
worldSecMediaStart = 49500 (13:45:00) | handles 20 | margen 30
OUT correcte = (50365-49500)+20+30 = 915 s
OUT calculat = 1196 s  ← 14:04:56 = inici del 07i/07 del bloc **v2** + 30 s
```
**Causa**: en `escaleta_bounds._calcBoundsNewFormat` el marge s'aplicava com
`minOut = (nextOnAirSec - worldSecMediaStart) + outMarginSec`, és a dir **fins a l'inici del
SEGÜENT ítem (encara que fos d'un altre bloc) + 30 s**. El `07` del v2 (14:04:26) arrossegava
el clip 5 minuts més enllà.

**FIX** (`js/core/escaleta_bounds.js`): el marge s'aplica **SOBRE EL FINAL DEL BLOC**
(`minOut = mp4ExpandedOutPoint + outMarginSec`) i la condició ja no exigeix que hi hagi
ítem següent. Resultat esperat: OUT 915 s (12:27 + handles), no 1196 s.

**Nota**: el clip del timeline apunta a `TNC_V1_CLIP.mp4`, que es **regenera** (ffmpeg -y) a
cada CREAR/ACTUALITZAR → Premiere pot perdre l'enllaç (media offline). Cal re-insertar o
reconnectar el clip després de regenerar-lo.

`index.html` → `escaleta_bounds?v=7`. Sintaxi 24 OK / 0 FAIL.

## 🧭 REFERÈNCIES DEL CLIP DESPLAÇADES 148 s — `tlBlockInPointSec` (17/09)

**Símptoma (usuari)**: el clip del timeline "ha perdut les referències"; el clip pareix
col·locar-se quasi des del principi i el final també està malament; dura 12 min.

**Causa**: al recalcular el `ref` per al CLIP EXTRET, `flow_mainButton.js` actualitzava
`worldSecMediaStart`, `mp4ExpandedInPoint/OutPoint` i `mp4Duration`… **però NO
`tlBlockInPointSec`**, que quedava amb el valor del CLEANFEED:
```
clip extret: bloc a 20 s (handles)   |  tlBlockInPointSec = 168  → desfase 148 s
flow_markers.js:214  clipInPoint = ref.tlBlockInPointSec  → anchorEfTL = 20-168 = -148
```
Afectava marcadors, chyrons i SRT (tots llegeixen aquest camp).

**FIX** (`flow_mainButton.js`): en recalcular el clip extret, actualitzar també
`tlBlockInPointSec` i `mp4SweetInPointRaw` = `clipExpandedInPoint` (20 s), tant a
`manifest.ref` (memòria) com al `SessionManifest.save`.

**Verificació que NO és d'avui**: el manifest de TNV V1 del **16/09** (que funcionava) té
exactament el mateix patró: `mp4ExpandedInPoint=20` vs `tlBlockInPointSec=159`
(`offsetSec=-159`). El desfasament existia des d'abans; amb el clip antic (que arribava al
final del fitxer) quedava "tapat", i amb el clip ja retallat es fa visible.

**Pausa de 2 min abans de tallar**: al log hi ha **DUES** extraccions simultànies
(`extract_1789648139569_done.txt` i `extract_1789648148623_done.txt`) → es va prémer CREAR
dos cops; el segon espera que acabi el primer. Cada clic relança l'extracció sencera.

`index.html` → `flow_mainButton?v=12`. Sintaxi 24 OK / 0 FAIL.

## 🔎 OnAir "MENTIDERS" (ítems de prova del realitzador) + OUT ajustat (17/09)

**Context (usuari)**: el realitzador llança ítems per provar i el seu timecode queda com
OnAir. Cas TNC 17/09: `08 P2-1` (13:48:08) i `08 P2-2` (13:48:42) són de prova; el tema
real (`10 - OLIVELLA...` + els seus P2 del sumari) va de **13:56:46 a 13:59:43 ≈ 3 min**.
El bloc calculat era 13:48:08→13:59:25 (11,28 min) → clip de 12:17 i fitxer de 13:27.

### 1) OUT del clip ja no és generós
`clipOutMarginSec: 30 → 0` (`11_Configuracio.js` + fallbacks a `escaleta_config.js`).
El clip acaba ara al **final del bloc + handles** (com abans), i el material per estirar
el dona la **cua de 60 s del fitxer** (`clipExtraTailSec`).

### 2) Primera barrera: OnAir impossibles
`escaleta_bounds.calcOnAirBounds`: es descarten del càlcul del bloc els ítems amb OnAir
**anterior a (inici de programa − 90 s)** (`programStartHours[prog]` via
`_detectProgramKey`). Salvaguarda: mai no es descarten tots.
**Límit d'aquesta barrera** (mesurat amb les dades reals): a TNC l'inici és 13:50:00 →
llindar 13:48:30 → **descartaria el `08 P2-1` (13:48:08) però NO el `08 P2-2` (13:48:42)**,
que només és 78 s abans. Cal un criteri més fi.

### 3) Opcions òptimes proposades (pendent de decisió)
- **(A) Pel TEMA del projecte** ⭐ recomanada: el tema (que ja extraiem per al nom) defineix
  el bloc → el rang és el **tram contigu que conté l'ítem del tema**. Determinista.
- **(B) Pel SUMARI** (proposta de l'usuari): ancla = últim ítem fiable anterior (sumari) i
  descartar OnAir incoherents amb la cadena. Bona salvaguarda, però cal definir "sumari".
- **(C) Per CONTIGÜITAT**: tallar en buits > 60-120 s i quedar-se amb el tram que conté el tema.
  Complementa (A). Amb les dades d'avui: [13:56:46 → 13:59:43] ≈ 3 min ✔.

`index.html` → `escaleta_bounds?v=8`, `11_Configuracio?v=16`, `escaleta_config?v=7`.

### ✅ IMPLEMENTAT — 17/09 (2a part: la regla clau era la PV, no l'OnAir)
`js/core/escaleta_bounds.js`:
- **`_sanitizeOnAirLies(data, config)`**: recorre `liniesEscaleta` i anul·la les hores
  **mentideres** dels ítems de prova (`_onAirRaw` / `_prevRaw`). Regles: (1) retrocés > 60 s
  respecte a l'última hora fiable; (2) anterior a (inici de programa − 90 s);
  (3) encadenat (per sota del "high water"). **S'aplica a OnAir I a Prevista** i tant
  OnAir com previsions fiables alimenten la referència. Idempotent.
  S'executa a l'inici de `calcPrecisionTrimBounds` → tiers, deduccions i marcadors.
- **`_applyBaseColumnFloor(data, start, blockLines, 180)`** → PISO d'inici: quan el
  sanejat ha tocat el bloc, l'IN no pot quedar abans d'on acaba l'últim ítem de la
  **columna BASE** (agrupació buida) situat ABANS del bloc per ORDRE d'escaleta.
  El "forat" de la base és exactament l'espai que ocupa el tema.
- Busters: `escaleta_bounds?v=10`.

**Descartat**: `_expandBlockStartToContiguous` (contigüitat genèrica). Amb dades reals
es menjava tot el programa (S1..S6 van pegats, sense buits) → se substituí pel PISO.

**Causa arrel real (TNC 17/09)**: el bloc V1 = [27 `08 P2-1`, 28 `08 P2-2`, 29 `08i`,
32 `10`]. El `firstBlockItem` (27) té **PV = 13:48:08, igual de mentidera que l'OnAir**
→ `blockRefSec` = 13:48:08 → bloc de 11:57. Sanejar només l'OnAir no movia l'IN.

**Validació (simulació fidel amb l'escaleta real)**:
```
SANEJATS: seq27(08 P2-1), seq28(08 P2-2), seq29(08i), seq59(14 P2-1), seq60(14i)
Tier0=50203  Tier1=50203  INcalculat=50203  firstReliable=50279  PISO=50206
=> IN FINAL = 50206 = 13:56:46   |   mp4In=686  mp4Out=885  dur=199s (3:19)
```
### 🔧 3a iteració — 17/09 (el bug real: `if (!hasOnAir)`)
El 2n intent (15:11) seguia donant IN=13:48:08. El log ho va deixar clar:
```
🕵️ OnAir MENTIDER neutralitzat: "08 P2-1" @ 13:48:08 (anterior a l'inici de programa, seq 27)
📋 [deduceOnAirEntrada] "08 P2-1": Prevista=49688.0s < deduced=50205.0s. Guanya Prevista
🔗 Tier0-IN (cross-agrupacio) -> 49688.00s
🎯 [ANCHOR-FALLBACK] Usant worldBlockStartSec=49688.00s com a àncora
📐 V1: IN-tier=10 | mp4ExpandedInPoint=168.00s dur=717.00s
```
**Causa**: la branca que sanejava la Prevista era dins de `if (!hasOnAir)`, i l'ítem 27
SI tenia OnAir (mentider) → la seva **Prevista 13:48:08 quedava intacta** i el **BUG #21**
de `_deduceOnAirEntrada` la preferia al resultat deduït (50205).
**Fix**: la Prevista s'avalua SEMPRE (mateixes 3 regles) + guarda per `00:00:00`;
quan el piso mou el IN també actualitza `worldBlockAnchorSec` (els marcadors el fan servir).

**Validació** (simulació sobre l'escaleta real): bloc V1 = 27/28/29/32 → 27/28/29 sense
cap hora → firstReliable=50279 · PISO=50206 · **IN=50206 (13:56:46)** · mp4In=686
mp4Out=885 **dur=199 s (3:19)** · fitxer 199+60=259 s.
### 🔧 4a iteració — 17/09 (el piso no s'aplicava: `tcToSeconds(null) === 0`)
L'intent de les 15:19 ja sanejava bé (10 hores neutralitzades, PV incloses) però seguia
donant **IN=50153 (13:55:53)** — els ~53 s que l'usuari veia com a "1 minut de més" al
començament del clip. Motiu: `tcToSeconds()` fa **`if (!tc) return 0`**, no `null`.
Al piso, els ítems 27/28/29 (ja sense cap hora) donaven `sec = 0` → `firstReliable = 0`
→ `gap = 0 − 50206 < 0` → sortida neta sense tocar res.
**Fix**: helper local `tcOf(item)` que valida el STRING (`''`/`00:00:00`/null → null)
abans de convertir, usat tant per `firstReliable` com per `floorSec`.
Buster: `escaleta_bounds?v=12`.

### 🔴 Marcadors — 17/09 (marcador 00:00 + color IPD)
Log del pipeline (15:26-15:28) com a evidència:
```
F1 → 10 → 70.64s | 08 → 44.64s [VERMELL] | 09 → 56.64s [VERMELL]   (l'IPD SÍ sortia vermell)
F2 → "Forçant marcador 1r ítem 10 a 00:00" ✓
F3 → "Excloent marcador a 0.000s" ✓ … però tot seguit "10: → 71.56s"  ✗ se l'emporta
F4 → mueve 08/09/10 y aplica mkColor = (mk.color >= 0) ? mk.color : 6 → -1 → TODOS AZUL
```
**Causa 1 (marcador 00:00)**: `placeScheduledMarkers` (F3) tornava a col·locar el mateix
prefix a la seva hora calculada, desfent el forçat de F2.
**Causa 2 (IPD no vermell)**: `Markers.get()` retorna `color: -1` (`.color` és una
propietat del wrapper JSX i no persisteix) → `snapFaroMarkers` (F4) llegia -1 i
re-aplicava **6 (blau)** a tots els marcadors que movia (delete+create → el color es perd).
**Fixes** (`flow_markers.js`, buster v17):
- F3: `pinnedZero` → els prefixes que viuen a 0 (`< 0.01s`) no es mouen mai.
- F4: `mkColor` es **recalcula des de l'escaleta** amb `_getColorIdx` (1/4/6) via `lineByNum`.
### 🔧 Marcadors — 2a iteració (15:39 → decisió: IN independent)
El pin de F3 no era la solució: fijaba el marcador del **ítem 10** a 00:00 y su sitio real
(~1:12) quedaba vacío. Además el color seguía saliendo azul porque `lineByNum` se construía
con `lines` (solo ítems del bloc V1) → el `08`/`09` (columna base) no estaban al mapa.
**Solució acordada amb l'usuari**: el 10 torna al seu lloc + marcador d'inici propi.
- **F2** (`placeDeducedOnAirMarkers`): el marcador d'inici (00:00) és el del **primer ítem
  ESTRUCTURAL del bloc recorregut en ORDRE D'ESCALETA** (`lines` = `manifest.escaletaItems`
  filtrat pel bloc) → cas TNC: `08i` (va abans del `10` a l'escaleta). S'usa
  `reader.isItemEstructural()`. **MAI ordre per TC**: amb TC, els OnAir mentiders del
  realitzador (ítems llançats abans del programa) farien entrar el `10` abans que el `08i`.
  El marcador viu a 0 (l'usuari confirma l'inici de l'ítem clicant IN) i porta el seu número
  i nom (`"08i - …"`, color 6). `placedByStart` evita que el bucle de deduïts el recol·loqui.
  Eliminats `placedByD10` (mort) i el text genèric `IN - Inici bloc`.

**Auditoria d'ordre** (`flow_markers.js`): no hi ha cap `sort` per TC. Els dos únics `sort`
d'ordre són per `sequencia` (`_seqOrderForItems` i F6·Ordre), la resta són per temps
(posicions). `_classifyItems` no reordena: manté l'ordre de `lines`.

### 🗺️ PENDIENT — Botó "Gràfica" (`btnMarksF6`) → importador MAPA/GOOGLE (18/09)
**Encàrrec de l'usuari** (botó 🎨 "Gràfica" del grup GRF, `index.html` ~L122; avui crida
`Graphics → placeGraphicMarkers`/`F6·Gràfics`).

Comportament demanat: amb el **cabezal (CTI)** col·locat on s'ha d'insertar, el botó
ofereix **3 opcions**: 1) importar el(s) fitxer(s) de la carpeta del dia que **coincideixin
amb el nom de l'ítem d'escaleta** on és el cabezal; 2) obrir un **navegador de fitxers**;
3) importar el coincident i, **si no n'hi ha cap**, obrir el navegador.

**Dades verificades:**
- Carpeta: `\\public.ad-ccrtv.local\Public\VERTICALITZACIO_INFORMATIUS\ZZZ_GRAFISME\<DD MES>`
  (subcarpetes `12 SETEMBRE` … `17 SETEMBRE`) → cal traduir `ctx.dateDir` (`2026_09_17`) →
  `17 SETEMBRE` (dia + mes català, MAJÚSCULES).
- Material 17 SETEMBRE: `EXPLAINER US DE PANTALLES MENORS_vertical.mov`, `GOOGLE MORT RIBES.mov`.
- Ítem de referència: **el del marcador anterior o a la posició del CTI** (marcadors
  estructurals de `Markers.get()`, major `time` ≤ CTI; nom = comentari sense el número).
- API: `FASTPASS.Project.importFiles(jsonPaths, bin)` (JSX `2_IO.jsx`),
  `Clips.insert(itemName, track, startSec, endSec, type)` (JSX `6_Clips.jsx`; l'`endSec`
  ja permet el retall), `window.cep.fs.showOpenDialog(multi, dir, títol, ruta, filtres)`
  (patró a `setup.html:311`).
- Col·locació: **V6**, des del CTI, en ordre d'escaleta; si no hi cap tot, **retallar tots
  per igual** fins a ocupar l'espai hàbil.
- Els busters/cablejat viuen a `js/main.js` (L501-514, grup GRF).

**Pendent de confirmar:** criteri del retall ("per igual" = mateix factor % o mateixa durada) · què és
"el final del clip" (final del clip de V1 sota el CTI o final de la seqüència) · si el botó 🎨
**substitueix** `F6·Gràfics` o aquest es conserva.

**CONFIRMAT per l'usuari (18/09):**
- **Bin de destí: crear un BIN anomenat `GRAF`** (si no existeix) i importar-hi el material.
- El botó a modificar és **`btnMarksF6`** (🎨 "Gràfica", grup GRF); `btnGrafMapa` (Mapa Zoom)
  i `runMapa` es **deixen exactament com estan**.
### ✅ IMPLEMENTAT — Botó 🎨 "Gráfica" (`btnMarksF6`) → importador MAPA (18/09)
**Fitxers:** `js/workflows/flow_mapa.js` (NOU, ~380 línies) · `js/main.js` (L452-454) ·
`index.html` (L254, `<script src="js/workflows/flow_mapa.js?v=1">`).

- El botó **ja existia i estava cablejat** a `Markers.placeGraphicMarkers` (F6·Gràfics);
  ara s'ha redirigit a `callWorkflow('Mapa','run')`. (F6·Gràfics queda sense botó; es pot
  reubicar si cal.)
- **Menú eliminat** (18/09, decisió de l'usuari): el botó executa **directament l'OPCIÓ 3**
  — automàtic per coincidència de nom i, **si no n'hi ha cap, obre el navegador de fitxers**
  — sense cap finestra prèvia. `_menu` eliminat i `_flow()` sense paràmetre.
  Buster: `flow_mapa.js?v=2`.
- **Carpeta del dia**: `_folderForDate('2026_09_17')` → `…\ZZZ_GRAFISME\17 SETEMBRE`
  (`MESOS` en català; si no encaixa, avisa i atura).
- **Ítem de referència**: `_itemAtCti(cti)` → marcadors `NN - Nom` de `Markers.get()`,
  el de major `time` ≤ CTI (l'anterior o el de la posició del cabezal).
- **Coincidència** (`_match`): noms normalitzats (sense accents/extensió, MAJÚSCULES,
  separadors → espai) per contenció en tots dos sentits o per tots els tokens de l'ítem.
- **Importació** (`_import`): `Project.bin('GRAF')` (crea el bin) + `importFiles(...)` +
  `Project.move(...)` perquè `importFiles` importa a l'ARREL (ignora el `binName`).
  Rutes amb `/` perquè el payload dins del literal JSX sigui segur.
- **Col·locació** (`_placeV6`): `Clips.insert(name, 6, t, end, 'video')` des del CTI,
  encadenant en ordre. Durades via `Project.items('GRAF')`. **Retall proporcional** (mateix
  %) si la suma no cap a l'espai hàbil = `end` del clip de V1 que conté el CTI. Si falta
  una durada, atura en comptes de solapar.
- **FIX (18/09 09:29): `callJSX is not defined`.** `callJSX`, `log` i `getClipsLogic` NO són
  globals al panell; cal resoldre'ls via `FASTPASS_UI.Utils` (patró de `flow_chyrons.js`
  L15-21). Ara `flow_mapa.js` defineix `U()`, `L()`, `callJSX()` i `getClipsLogic()`
  locals. Verificat que `Utils` té `log/callJSX/readFolder/escape/handleError/status/
  validateActiveSequence`. Buster `flow_mapa.js?v=3`.
  *(Bon senyal: el mateix log mostra el fix del tall funcionant: `🔒 Àncora actualitzada
  al piso: 13:56:46` i `mp4ExpandedInPoint=686 dur=199s`.)*

- **FIX 2 (18/09 09:33): no importava ni col·locava.** El log va delatar:
  `💥 [JSX ERROR]: ERR:FASTPASS.Project.importFiles is not a function` → el namespace
  correcte és **`FASTPASS.IO.importFiles`** (2_IO.jsx L10 `FASTPASS.IO = ...`), i a més el
  projecte ja té el helper **`utils.importList(paths, bin)`** (utils.js L605: escapa el
  payload i crida el JSX correcte). Ara `_import` fa servir `U().importList(paths,'GRAF')`
  i després `Project.move()` (perquè `importFiles` importa a l'ARREL).
  Les durades ara surten de **`Project.itemDuration(name)`** (3_Project.jsx L315), no de
  deduir-les de `Project.items`. Eliminats `esc()` i `self` (codi mort). Buster `?v=4`.
- **FIX 3 (18/09 09:37): "cal clicar 2 cops" + no movia al bin ni insería.** El log:
  `1r clic ⚠️ No puc resoldre la carpeta (data projecte: "")` → `2n clic ✓` · i després
  `💥 ERR:MOVE_FAILED` + `⚠️ Sense durada → aturo`.
  - **Doble clic**: `State.projectDateDir` és BUIT just després d'obrir el projecte (el poll
    d'estat l'omple uns segons més tard). Nova `_resolveDateDir()` amb fallbacks:
    State → **path del manifest** (`SessionManifest._cache`) → `workTarget==='yesterday'` → avui.
  - **Move/durada**: Premiere conserva l'EXTENSIÓ al nom de l'ítem importat, així que el
    `move` amb el nom sense extensió fallava. Ara, després d'importar, es llegeix la RAÍL
    (`Project.items('')`) i s'emparella pel **nom normalitzat** per obtenir el nom REAL i la
    seva `duration`. `_import` retorna `[{name, dur}]` i `_placeV6` els consumeix.
  Buster `?v=5`.
- **FIX 4 (18/09 10:23): no insertava a V6.** El move ja anava bé (`→ bin GRAF · OK`) però
  `dur=0.00s` → Premiere NO reporta la durada del media mentre ingesta (log: `[SYNC] Iniciant
  ingesta segmentada`) i el flux "aturava". Solució: **no dependre de la durada**.
  "Es retallen de manera igual" s'interpreta LITERALMENT: es reparteix l'espai hàbil a
  **parts iguals** (`perItem = space / nº clips`) i s'insereix
  `Clips.insert(name, 6, t, t+perItem, 'video')`. Si el media és més curt, Premiere inserta
  la seva durada real (queda un petit buit). Si no hi ha espai conegut (`endLimit` null),
  s'insereix sencer i s'encadena llegint el clip ja inserit a V6.
  Buster `?v=6`. (Nota: es va detectar i eliminar un bloc de codi vell que va quedar
  duplicat en reescriure `_placeV6`; la sintaxi valida 25 OK / 0 FAIL.)
- **CANVI DE DISSENY (18/09, petició de l'usuari): el gràfic va a V5 i el congelat a V6.**
  A V5 hi ha el **congelat del tema-títol (un PNG/frame)** que s'ha de conservar a la vista.
  - `TRACK_GRAF = 5` (abans V6) · `TRACK_FREEZE = 6`.
  - `_freezeUnderCti(cti)`: ABANS de tocar V5, llegeix el clip de V5 que conté el cabezal i
    n'obté el nom del media (el congelat). Si no n'hi ha, avisa i V6 no es toca.
  - `_placeClips(items, cti, freezeName)`: col·loca el(s) gràfic(s) a **V5** (repartint
    l'espai hàbil a parts iguals) i després replica el congelat a **V6** des del CTI fins al
    final de l'últim gràfic inserit.
  - Buster `flow_mapa.js?v=8` · sintaxi 25 OK / 0 FAIL.
- **FIX 5 (18/09): el PNG no s'estirava fins al final del gràfic de V5.** Causa: el JSX
  `Clips.insert` aplica l'`endSec` al **DARRER clip de la pista** (`clips[numItems-1]`), no
  al que acaba d'inserir → si V6 ja té clips a la dreta, estira un altre i el PNG es queda
  amb la durada per defecte dels stills. Solució: després de cada insert, fixar el final amb
  **`Clips.endAt(track, startSec, newEndSec, 'video')`** (JSX 6_Clips L765: cerca per temps,
  immune a la renumeració de clips). S'aplica al **PNG de V6** (cti → final del gràfic) i
  també al gràfic de V5, amb avís al log si no retorna OK. Buster `?v=9`.
- **FIX 6 (18/09): el PNG arribava fins al final del clip de V1.** El final correcte és el
  del **clip de V5 que hi ha SOTA el PNG** (el congelat que conté el cabezal). `_freezeUnderCti`
  ara retorna `{ name, start, end }` (es llegeix ABANS d'insertar el gràfic a V5, que és quan
  encara hi ha el congelat) i el PNG de V6 s'estira de `cti` fins a **`freeze.end`**, amb
  `Clips.endAt` perquè no quedi amb la durada per defecte dels stills. Buster `?v=10`.
- **FIX 7 (18/09, clau): "el timeline mostra 2 estats alhora".** El problema REAL era doble:
  1) **Restes de cada execució**: cada clic del MAPA hi deixava un joc nou de clips sense
     esborrar els anteriors → el gràfic es veia "mig amagat" fins a 45.05s i el congelat fins
     a 1:12 (clips vells). Solució: **`_cleanupTrack(trackIdx, nombres)`** amb
     `Clips.removeAt` (per temps, enrere per no renumerar) → s'esborren de **V5** els clips
     del gràfic i de **V6** els del congelat ABANS de tornar a inserir.
  2) **Estirava més enllà de la durada real**: forçava un `endSec` calculat (espai hàbil /
     `freeze.end`) i el GOOGLE (≈20s) quedava falsament a 45.28s. Solució: inserir a
     **durada natural** (`Clips.insert(..., null, ...)`), **mesurar el clip real**
     (`_clipEndAt`) i només retallar amb `endAt` si no cap a l'espai hàbil.
  El **PNG de V6** va ara de `cti` fins al **final del gràfic REAL mesurat** (`grafEnd`).
  Buster `flow_mapa.js?v=11`.
- **PENDENT DE PROVAR A PREMIERE** (no commitejat): V6 existent a la seqüència, que
  `Project.items` retorni `duration`, i que el nom de l'ítem importat sigui el del fitxer
  sense extensió (si no, `move`/`insert` fallaran i ho dirà el log).
- **F3**: eliminat `pinnedZero` (ja no cal, `IN` no xoca amb cap ítem).
- **Color**: viatja al `name` del marcador (`name='color=N'`, convenció de `Markers.set`).
  F1/F2/F3 l'escriuen; F4/F6 el llegeixen (amb `_getColorIdx` com a xarxa de seguretat).
  `placeByPrefixes` conserva el `name` al fer delete+create → el color ja no es perd.
- Buster: `flow_markers.js?v=19`. Sintaxi 24 OK / 0 FAIL.
- **Esperat**: 0s `IN - Inici bloc` (blau) · ~45s `08` (vermell) · ~57s `09 IPD` (vermell)
  · ~72s `10` (blau).

⚠️ **PROTECTED**: `js/editor/srt_editor.js` intacte.

⚠️ **PROTECTED**: `js/editor/srt_editor.js` intacte.
**Pendent**: (a) que el motor publiqui l'escaleta de Matins i (b) que la maquina arribi a
digition: mentre les dues fallin, ESPERANT es el comportament correcte. Proposta: mostrar
el motiu real al semafor (ara nomes surt al log).

⚠️ **PROTECTED**: `js/editor/srt_editor.js` intacte.

⚠️ **PROTECTED**: `js/editor/srt_editor.js` intacte.


### 🖱️ Feedback "AHIR" al botó MAIN (18/09)
Petició: quan s'inicia projecte i es vol obrir el d'AHIR es fa **Ctrl+clic al MAIN**; que
mentre es manté **CONTROL** amb el cursor **sobre el botó**, aquest mostri **"AHIR"**.
- `js/core/4_Context.js`: nova **`initMainHoverHint()`** (idempotent, cridada des de
  `updateButton`). Guarda el text d'estat actual, posa "AHIR" i el restaura en deixar anar
  Ctrl o sortir del botó.
- Funciona amb **`mousemove`** (detecta `ctrlKey` encara que el focus no sigui al panell CEP),
  a més de `keydown`/`keyup` de Control i `blur` de la finestra (per no quedar-se amb "AHIR").
- Sense tocar CSS (només el text). Buster `js/core/4_Context.js?v=14` · sintaxi 25 OK / 0 FAIL.


### 🎬 FIX Tema-Títol (18/09 11:14) — el 1r anava a 0+tc i l'ordre estava invertit
Log del problema:
```
🎯 [Conductor] Tema‑Titol de plató "…07i…" @ 1.00s (marcador 0.00 + tc 1.00)
📌 [Titol·CasB] inici del bloc @ 4.80s            ← el lloc correcte (fi del rètol conductor)
📌 [Titol] 1/2 "…001 LA TEMPESTA…" → 116.92s (marcador 1) · freeze fins 1.00s   ✗ freeze cap enrere
📌 [Titol] 2/2 "…07i…"             →   1.00s (marcador 7I) · freeze fins 268.92s  ✗ havia d'anar a 4.80s
```
**Causa**: `markerTimeFor()` usava el marcador de l'ítem sempre que existís, però el 07i
només té el **marcador d'INICI (00:00)** que va crear el flux de marcadors → `0.00 + tc` =

### 📏 Wotts limitats also pel SEGÜENT marcador (18/09)
Petició: a més del clip de V1, cap wott no es pot estirar més enllà del **següent marcador**
(hi ha efectes entre clips que no es detecten com a tall però que sí tenen marcador → així
cap wott es cola al 1r clip del següent ítem).
- **`_placeChyronsByType`** (Lloc/Nom/Resto): `nextMarkerAfter(refTime)` i
  `lim = min(ci.end, següent marcador)`; `placeEnd = min(lim, placeStart+dur)`. El "següent"
  es compta des del **marcador de l'ítem** (`mk.time`), no des de `placeStart`, perquè si el
  clip de V1 comença abans el límit seria el propi marcador.
- **TITOLET/INSERT** (`doSnap = false`): abans NO entraven al bloc de límits i quedaven amb
  `placeEnd = null` → **sense cap límit**. Nova `limitNoSnap(instant, refTime)` que els
  aplica el mateix mínim (clip de V1 + següent marcador). Van a **V7**.
- **`placeChyronTraduccio`: NO tocada** (indicació de l'usuari: funciona perfecte). Ja limita
  amb el clip de V1 i salta els *flashes*; va a V7.
- ⚠️ V6 és on el MAPA escriu el PNG del congelat → millor no afegir-hi més coses.

### 🔒 `_chooseSlot` no pot sortir de l'ítem (18/09) — wotts "Info_complementaria"
Aquests wotts (`Wott_*_Info_complementaria_*`) es col·loquen per la fase **`[Resto]`**, o sia
que **sí** passen per `_placeChyronsByType` (llistats al log amb etiqueta `[Resto]`). El que
passava:
- No tenien límit per **marcador** (només pel clip de V1) → se n'anaven fora de l'ítem.
- **`_chooseSlot` RETROCEDIA** per "no trepitjar": cas del log
  `→ V6 @ 172.24s … ⟵ desplaçat per no trepitjar (ideal 181.24s)` = 9s enrere, dins de l'ítem
  anterior.
**Fix**: `_chooseSlot(candidates, startSec, durSec, ctx, maxEnd)` — nou paràmetre **`maxEnd`**
(el límit del wott: final del clip de referència o següent marcador):
- No accepta forats que s'acabin més enllà de `maxEnd` (`free + dur > maxEnd` → es descarta).
- Si el límit no deixa ni el mínim (0.5s), encongeix la durada.
- Si cap pista candidata dona forat dins del límit, es col·loca igualment a `startSec` de la
  primera pista — **mai a l'ítem anterior**.
Es manté l'alternança **V6/V7** (correcta: mateix tipus de wott, no han de coincidir en imatge).
Buster `flow_chyrons.js?v=20` · sintaxi 25 OK / 0 FAIL.

- Buster `flow_chyrons.js?v=19` · sintaxi 25 OK / 0 FAIL.

1.00s, en comptes de l'inici del bloc (CasA/CasB, que ja respecta el rètol del conductor).
A més, `ttList` no estava ordenada per posició, així que el freeze del 1r anava cap enrere.
**Fix** (`flow_chyrons.js`, buster `?v=17`):

### 🔧 Wotts solapats a 1:58-2:22 — el `endSec` del JSX (18/09)
El log demostrava que els límits es calculaven BÉ:
```
🔗 [Resto] 4 marcadors: 07i@0.0, 07@6.6, 001@116.0, 12@180.3   (cap marcador entre 116 i 180)
📐 …00.03… → clip [118.36-121.12] → entra a 118.76s, surt a 121.12s (acurtat per final del clip)
✅ …00.03… → V6 @ 118.76s → 121.12s
```
…i que les xifres de l'usuari hi coincideixen exactament (**2:01:03 = 121.12s**, **2:05:15 = 125.60s**).
**Causa**: el JSX **`Clips.insert` aplica l'`endSec` al DARRER clip de la pista**, no al que
acaba d'inserir (mateix bug que patíem amb el PNG del MAPA) → els wotts es quedaven amb la
seva durada natural (5.1s), se solapaven i es colaven fora del ítem.
**Fix** (`flow_chyrons.js`, buster `?v=21`):
- Després de cada `Clips.insert`, **`Clips.endAt(track, slot.start, placeEnd, 'video')`**.
- Protecció: si el clip de referència és tan curt que no hi cap ni l'offset de 10 frames
  (`placeEnd <= placeStart + 0.05`), el rètol es **salta** amb avís (abans sortien durades
  negatives, cas `@135.92→135.76` = 2:15.92).

- Un marcador **< 0.5s** es tracta com a "no fiable" → s'usa l'**inici del bloc** (CasA/CasB).
- **`ttList.sort()` per posició real** → el 1r Tema-Títol és el que obre el bloc i el seu
  congelat s'estén fins al següent.
- Esperat: `1/2 "…07i…" → 4.80s · freeze fins 116.92s` i `2/2 "…001…" → 116.92s · freeze fins final`.

### ✅ MAPA validat per l'usuari (18/09)

### 📹 Exportació de vídeo (botó 📹 `btnRenderVideo`) — estat 18/09
**Ja estava implementat**: botó (`main.js` L564) → `Render.runVideo` → `Logic.Render.queue`
(actiu: `js/logic/9_Render_Logic.js`, carregat a index.html L235) → JSX `Render.queue`:
```
app.encoder.launchEncoder();
app.encoder.encodeSequence(seq, fullOutputPath, f.fsName, 0, 1);
app.encoder.startBatch();
```
Destí: `Context.folder()` (directori del projecte, amb fallback a `rutas.destinoBase`).
Nom: `PROG_TEMA_HH_MM.mp4` (de `Context.activeSeq()`). Preset: `presets/H264_2Pass_Vertical.epr`.

**Bloqueig**: `presets/H264_2Pass_Vertical.epr` = **0 bytes** (placeholder). AME no pot
codificar amb un preset buit. A més, a l'equip **no existeix** la carpeta de presets d'usuari
de l'AME (`Documents\Adobe\...`), o sigui que mai s'ha guardat cap preset.
- On trobar-lo: **usuari** → `C:\Users\gonz_agu\Documents\Adobe\Adobe Media Encoder\<ver>\Presets\`
  (es crea al guardar un preset des d'AME/Premiere); **fàbrica** →
  `C:\Program Files\Adobe\Adobe Premiere Pro 2025\Settings\EncoderPresets\` (26 `.epr`, cap
  d'H.264: els d'H.264 van embeguts a l'aplicació).
- **Implementat**: validació prèvia del preset a `flow_render.js` (`window.cep.fs.stat`): si no
  hi és o fa <1KB → avís clar a l'estat i al log, i no s'envia a AME. Buster `flow_render.js?v=7`.
  També s'ha fet que `log()` accepti nivell (`log(m, lvl)`).
- **Pendent**: el `.epr` real (l'ha de generar l'usuari des d'AME/Premiere). Dubte oberta:
  eliminar el `Logic.Render` duplicat de `js/logic/34_Exportacio.js` (codi mort; apunta a un
  namespace `Exportacio` que ja no existeix).

"Ahora si que va perfecto!" → el flux del botó 🎨 (V5 gràfic + V6 congelat) queda validat.


### ✅ Preset d'exportació trobat i instal·lat (18/09)
L'usuari va crear **`VERTIKAL XXX.epr`** (45.8 KB). Estava a la carpeta de presets d'usuari de
l'AME, que en aquest equip està **redirigida a la xarxa**:
`\\dades_c.ad-ccrtv.local\DADES_c\Usuaris\gonz_agu\carpetesWin7\documents\Adobe\Adobe Media Encoder\25.0\Presets\`
(per això no apareixia a `C:\Users\gonz_agu\Documents\Adobe`; la carpeta efectiva és
`[Environment]::GetFolderPath('MyDocuments')` = la UNC de dades_c).
- Copiat a l'extensió com **`presets\VERTIKAL XXX.epr`** i com **`presets\H264_2Pass_Vertical.epr`**
  (tots dos 45.8 KB).
- `flow_render.js` (buster `?v=8`): **resolució flexible del preset** — llegeix `presets\` amb
  `window.cep.fs.readdir` i agafa `H264_2Pass_Vertical.epr` si hi és, si no **qualsevol `.epr`**
  (així val el preset propi de l'usuari i no cal tocar codi en canviar-lo). Després valida que
  existeixi i faci >1KB (`cep.fs.stat`) amb avís clar.
- Pendent de provar: 📹 → `app.encoder.launchEncoder()` + `encodeSequence` + `startBatch`
  (AME obre la cua i codifica). Destí: directori del projecte; nom `PROG_TEMA_HH_MM.mp4`.
- **FIX (12:22)**: `💥 [RenderVideo] Error: Cannot read properties of undefined (reading
  'getSystemPath')` → `csInterface` NO és a `FASTPASS_UI` sinó a **`FASTPASS_UI.Utils.csInterface`**
  (`utils.js` L7 `new CSInterface()` + L12 l'exposa). Fix:
  `const csI = getUtils().csInterface || window.FASTPASS_UI.csInterface;`. Verificat que no hi
  ha cap altre punt del projecte que faci servir `FASTPASS_UI.csInterface` (només el comentari
  i el fallback). Buster `flow_render.js?v=9`.
- **FIX 2 (12:36)**: `❌ El preset fa 0 bytes (buit): …/presets/._H264_2Pass_Vertical.epr`.
  Hi havia un fitxer **porqueria `._H264_2Pass_Vertical.epr`** (metadades, 4096 B) que TAMBÉ
  acaba en `H264_2Pass_Vertical.epr` → el `find` per SUFIX el triava abans que el bo i la
  validació de mida l'aturava. Fix a `flow_render.js` (buster `?v=10`):
  1) descartar fitxers que comencen per `.` (`._*`, `.DS_Store`); 2) prioritzar el **nom
  exacte** `h264_2pass_vertical.epr`; 3) si no, el **primer `.epr` amb >1KB**.
  I **esborrat** el `._H264_2Pass_Vertical.epr` de `presets\` (queden els dos bons, 45.8 KB:
  `H264_2Pass_Vertical.epr` i `VERTIKAL XXX.epr`).
- **FIX 3 (12:39)**: seguia dient "0 bytes" ara amb `H264_2Pass_Vertical.epr` → **el bug era
  meu**: `cep.fs.stat` amb la ruta en **`/`** retorna mida buida, així que **qualsevol** preset
  semblava de 0 bytes. Fix: normalitzar sempre a ruta **nativa (`\`)** abans del `stat` (i al
  `presetPath` per al JSX). A més, l'elecció passa a ser **el `.epr` VÀLID (>1KB) MÉS RECENT**
  (així mana el preset que l'usuari acaba de crear a l'AME, p.ex. `VERTIKAL XXX.epr`) i es
  registra al log quins presets hi ha i quin s'usa. Buster `flow_render.js?v=11`.
- **FIX 4 (12:55)**: el log deia "Presets disponibles: H264_2Pass_Vertical.epr, VERTIKAL XXX.epr"
  però **sense "→ ús:"** → cap va passar la validació: **`window.cep.fs.stat` no retorna
  `.size`** en aquest equip (per això TOT semblava de 0 bytes). Fix (`flow_render.js?v=12`):
  - Mesurar **llegint el fitxer** (`window.cep.fs.readFile` → `.length`), tant a la tria com
    a la validació.
  - **Preferència explícita**: 1) `VERTIKAL XXX.epr` (el de l'usuari, acordat), 2)
    `H264_2Pass_Vertical.epr`, 3) qualsevol `.epr` >1KB.
  - El log diu quins presets hi ha i **quin s'usa amb la seva mida**.



### ⚡ Exportació SENSE AME: `exportAsMediaDirect` ("Vulcan") — 18/09
Petició de l'usuari: alternativa a Media Encoder (té un plugin Digition que renderitza des de
Premiere). **Sí: Premiere pot exportar amb el seu propi motor** (el que AME fa servir per dins)
sense obrir AME:
```js
seq.exportAsMediaDirect(rutaSortida, rutaPresetEpr, 0);   // 0 = seqüència sencera
```
(confirmat al SDK del projecte: `docs\SAMPLES\CODE\SNIPPETS\Rendering (PR).jsx`).
**Implementat:**
- **JSX** `jsx/modules/9_Render.jsx`: nou **`Render.renderDirect(preset, carpeta, nom)`** que crea
  la carpeta si cal, crida `exportAsMediaDirect` i comprova que el fitxer s'hagi creat
  (`OK_DIRECT` / `ERR_NO_OUTPUT` / `ERR_PRESET_NOT_FOUND` / `EXC: …`).
- **JS** `flow_render.js` (buster `?v=13`): **PRIMER el render directe** (estat
  "Renderitzant des de Premiere…") i, **si falla, fallback a la cua d'AME**.
- És **síncrona**: Premiere queda ocupat mentre exporta (no obre cap finestra).
- ⚠️ El JSX es carrega a l'arrencada de l'extensió → **cal reiniciar Premiere** perquè
  `Render.renderDirect` existeixi; si no, sortirà "is not a function" i caurà a l'AME.

### 🔧 Render directe — FIX definitiu (18/09 13:15)
`💥 ERR:Render.renderDirect is not a function` → **el manifest carrega `./jsx/main.jsx`, que és un
BUNDLE**: fa `load("9_Render.jsx")` (per tant el mètode EXISTEIX a `FASTPASS.Render`) i després
defineix un **wrapper `$.global.Render`** (L662) que només exposava `frame`, `snapshot` i `queue`.
El panell crida `Render.<mètode>` → calia exposar-hi `renderDirect`.
- **Fix**: afegit `renderDirect: function(pr,o,n){ return FASTPASS.Render.renderDirect(pr,o,n); }`
  al wrapper de `jsx/main.jsx` (a més del mètode a `jsx/modules/9_Render.jsx`).
- **Fallback AME ELIMINAT** per petició de l'usuari: `flow_render.js` (buster `?v=14`) ara fa
  **només** el render directe; si falla, informa i s'atura (no envia res a AME).
- ⚠️ El JSX es carrega a l'arrencada → **cal reiniciar Premiere** perquè el wrapper nou existeixi.
- `exportAsMediaDirect` és **síncrona**: Premiere queda ocupat mentre exporta.


### 📝 Nom del fitxer exportat (18/09)
Sortia `TNC_TEMA_13_15.mp4` perquè el codi feia `seqName.split("_")` + **`slice(2)`** assumint
`PROG_BLOC_TEMA`; amb `TNC_AFECTACIONS METRO BARCELONA I RENFE` (2 parts) no hi havia tema i
queia al literal "TEMA". Fix (`flow_render.js`, buster `?v=15`):
- 3+ parts (`PROG_BLOC_TEMA`) → tema = parts[2..] (com abans).
- 2 parts (`PROG_TEMA`) → **tema = parts[1]** ← el cas de TNC.
- Sense tema → es dedueix del nom del projecte (treta `Pruebas_` i `PROG_V1_`); últim recurs "TEMA".
- Resultat: `TNC_AFECTACIONS METRO BARCELONA I RENFE_13_15.mp4`.

- Pendent: si el plugin **Digition** exposa un mètode de render propi, caldria invocar-lo des
  d'un jsx (cal conèixer la seva API).

### 🖼️ Exportació de la PORTADA (encàrrec 18/09) — PENDENT D'IMPLEMENTAR
**Objectiu**: amb el cabezal (CTI) col·locat, fer una **captura (PNG)** que contingui **només el
clip de V1** d'aquell TC **amb la PORTADA al damunt** (la **primera** portada d'aquell tema:
n'hi pot haver diverses).

**Mètode acordat (opció 2, per comoditat)**:
1. Agafar el CTI (`Timeline.get()`).
2. **Copiar** el clip de V1 que conté el CTI **més enllà del final del projecte** (zona buida,
   sense res a sota ni a sobre) — p.ex. `clips.duplicate(track, idx, tempsLliure)` o
   `Clips.duplicate(1, idx, ...)`; el JSX ja té `Clips.duplicate` i `Clips.move`.
3. **Col·locar la portada (PNG) damunt** d'aquesta còpia, al mateix instant.
4. **Moure el cabezal** al frame corresponent de la còpia (`Timeline.set(t)`).
5. **Captura** amb el mecanisme del freeze (`FASTPASS.Render.snapshot` /
   `Render.exportFrameQE`, que ja funciona per al Tema-Títol).
6. **Neteja**: eliminar la còpia del clip i la portada inserides (i restaurar el CTI).
- El PNG resultant va **a la mateixa carpeta del projecte** que el vídeo i amb **EXACTAMENT el
  mateix nom que el vídeo** (inclosa l'hora): `…_13_15.png` si el vídeo és `…_13_15.mp4`.
- La portada s'obté amb `Scan.portadas(ctx)` (ja usat a `runPortada`); cal quedar-se amb la
  **primera del tema**.

**Pendent de decidir**: si es substitueix el `runPortada` actual (que fa l'opció 1: aïllar
pistes) o es deixa com a alternativa; i què fer si la portada i el clip tenen mides/formats
diferents (l'escala de la portada la gestiona el projecte o cal aplicar-hi un motion?).

**RESPOSTES de l'usuari (18/09 13:51)** — el botó 🖼️ actual FALLA:
`💥 ERR:Tracks.setGlobalState is not a function` i `💥 T_MP4 is not defined` (runPortada antic).
- **Fer de ZERO l'opció 2** (substituir `runPortada`).
- **La portada s'ha de CENTRAR a la seqüència** (position/scale centrats) i prou.
- **Sí**: la còpia va més enllà del final i, en acabar, **s'elimina només el que s'ha inserit**
  (còpia del clip + portada), restaurant el cabezal.
- El PNG de portada, **a la mateixa carpeta i amb el mateix nom que el vídeo** (amb hora):
  `TNC_TEMA_13_15.png` al costat de `TNC_TEMA_13_15.mp4`.
- Els `.epr` reals (46 KB) ja són al repo (`presets/VERTIKAL XXX.epr` preferit).



---

## 2026-09-18.md

# Handoff 2026-09-18 — FAST_PASSS (estat i següent tasca)

## ✅ FET I PUJAT A `origin/main` (commits d'avui)
- `c708455` **Marcadors/wotts**: límit = min(final del clip de V1, **SEGÜENT marcador**) comptant
  des del marcador de l'ítem; també per a TITOLET/INSERT (abans sense cap límit).
  `_chooseSlot` **no retrocedeix** ni surt de `maxEnd` (abans es colava a l'ítem anterior).
  **`Clips.endAt(track, start, end)` després de cada `Clips.insert`** (el `endSec` del JSX va al
  DARRER clip de la pista → solapaments i durades negatives). **Tema-Títol**: marcador <0.5s
  (l'inici a 00:00) no és posició d'emissió → usa **inici del bloc CasA/CasB = 4.19s** (fi del
  rètol conductor) i `ttList` ordenat per posició real.
- `07b04a3` **Exportació DIRECTA del vídeo** (`exportAsMediaDirect`, sense AME, sense fallback):
  nou mètode a `jsx/modules/9_Render.jsx` + exposat al **wrapper de `jsx/main.jsx`**. Preset real
  `presets/VERTIKAL XXX.epr` (46KB, preferit) i validació per LECTURA del fitxer. Nom
  `PROG_TEMA_HH_MM.mp4` amb el tema real (de `Context.activeSeq()`).
- Anteriors d'avui: `ae95606` (OnAir/previstes mentideres + piso columna base), `c87f7b6`
  (marcador 00:00 = 1r ítem estructural per ESCALETA + color via `name`), `f474e5d` (importador
  MAPA: ZZZ_GRAFISME → bin GRAF → V5 + congelat a V6), `9ae7a7f` (feedback AHIR al MAIN amb Ctrl).

## 🎯 SEGÜENT TASCA: exportació de la PORTADA (opció 2, de zero)
Substituir `runPortada` (`js/workflows/flow_render.js`), que FALLA:
`ERR:Tracks.setGlobalState is not a function` i `T_MP4 is not defined`.
Fer-la **de zero amb l'opció 2**:
1. CTI = `Timeline.get()`.
2. **Duplicar el clip de V1** que conté el CTI **més enllà del final del projecte** (JSX:
   `Clips.duplicate(track, clipIdx, targetTrack, type, stripAudio)`).
3. **Portada** = **PRIMERA** del tema (`Scan.portadas(ctx)`), col·locada **damunt de la còpia**,
   **CENTRADA a la seqüència** (position/scale centrats).
4. Moure el cabezal al frame corresponent i **captura** amb el mecanisme del freeze que ja
   funciona (`Render.snapshot` → `Render.exportFrameQE` de `9_Render.jsx`).
5. **Neteja**: eliminar NOMÉS el que s'ha inserit (còpia + portada) i restaurar el cabezal.
6. El PNG, **a la mateixa carpeta del projecte i amb EXACTAMENT el mateix nom que el vídeo**
   (amb hora): `PROG_TEMA_13_15.png` al costat de `PROG_TEMA_13_15.mp4`.

## ⚠️ TRAMPES apreses avui (no repetir)
- **El JSX que es carrega és el BUNDLE `jsx/main.jsx`** (`CSXS/manifest.xml`,
  `<ScriptPath>./jsx/main.jsx</ScriptPath>`), que fa `load("N_XXX.jsx")` i defineix wrappers
  `$.global.X` → **qualsevol mètode nou s'ha d'exposar-hi** (els wrappers només tenien
  frame/snapshot/queue). Si apareix "X.y is not a function" → mirar el wrapper. **Reiniciar
  Premiere** després de tocar JSX.
- **`Clips.insert` aplica l'`endSec` al DARRER clip de la pista** → sempre `Clips.endAt` després.
- **`cep.fs.stat` no retorna `.size`** en aquest equip → mesurar **llegint** (`cep.fs.readFile`).
- **`tcToSeconds(null) === 0`** (no null) → validar el string abans.
- **`csInterface` viu a `FASTPASS_UI.Utils.csInterface`** (no `FASTPASS_UI.csInterface`).
- **`callJSX`/`log`/`getClipsLogic` NO són globals** als workflows → alias locals via
  `getUtils()` (patró de `flow_chyrons.js` L15-21).
- **L'ORDRE SEMPRE PER ESCALETA** (`sequencia`), mai per TC (OnAir mentiders del realitzador).
- `fastpass.log` del projecte: `\\DSMEDIA07\portal324\...\PROVES\FASTPASS.log` (útil per depurar).
- Syntax checker: `C:\temp\fp_run_syntax.ps1` (lista fixa a `C:\temp\fp_syntax_check2.html`;
  afegir-hi fitxers nous). Esperat **25 OK / 0 FAIL**.

## 🆕 POSTERIOR (mateixa sessió 2026-09-18) — PORTADA reescrita de zero (opció 2)
`runPortada` (`js/workflows/flow_render.js`) ja NO fa servir `Tracks.setGlobalState` ni `T_MP4`/
`T_PORTADA` (eren els dos errors). Mecànica nova, tot en una **zona neta**:
1. `CTI = Timeline.get()` → clip de V1 que el conté (`Clips.at`) → `mediaIn` (frame del cabezal).
2. **Zona neta** `tempTC = ceil(max end de TOTES les pistes)+30` (via `Clips.debugTracks`).
   Portada a la pista de MÉS AMUNT desbloquejada; còpia a la pista més amunt **lliure des de
   l'inici del clip font** (obligatori: `Clips.duplicate` fa overwrite del MEDIA SENCER).
   Si no hi ha cap pista segura → `Clips.insertClipFrom` (ripple: més enllà del final no mou res).
3. Còpia: `Clips.inPoint(mediaIn)` (crida pròpia: Premiere ignora l'inPoint al mateix evalScript
   que la inserció) + `Clips.moveToRange(tempTC, tempTC+2)`.
4. Primera portada del tema (`Scan.portadas`) **damunt** de la còpia: `IO.lookFor` + `IO.importFiles`
   + `Clips.insert` + `Clips.endAt` + `Anim.setMotionValues` (Posició 0,0 centrada, Scale llegida
   de la imatge; `PORTADA_SCALE` a dalt del fitxer permet forçar-la).
5. `Timeline.set(tempTC)` + `Logic.Render.capture(destPath, tempTC)` (→ `Render.snapshot` /
   `exportFrameQE`). **La captura ha de ser EXACTAMENT a `tempTC`** (és l'instant en què la còpia
   mostra el frame del cabezal).
6. `finally`: `Clips.removeAt` de còpia i portada (per TEMPS) + `Timeline.set(cti)`. No es toca cap
   mute/lock. El PNG va a la carpeta de `Context.folder()` amb el nom del MP4
   (`buildRenderName` = font única del nom, compartida amb `runVideo`).
   ⚠️ Pendent: **provar-ho a Premiere** (el JSX no s'ha tocat: segueix `jsx/main.jsx` amb els
   wrappers actuals; cal reiniciar el panell per agafar el `?v=16` de `index.html`).


## 🆘 POSTERIOR (mateixa sessió) — FALLBACK de SRT al botó ⬇️
Quan el mecanisme principal (blocs de 15 min a `SRT_MP4_PER_TEMPS_15MINUTS`) no carrega res, es
busca un `.SRT` a **`rutas.vertical`** (`\\192.168.147.199\public\VERTICALITZACIO_INFORMATIUS\`, la
carpeta dels MP4 del bloc) i es carrega a l'editor amb `SrtEditor.loadSrt` (NO importa res al
projecte; per això hi ha EXPORTAR 💾).
- `js/logic/Scanner.js` → **`Scan.srtFallback(ctx)`**: relaxació N1 (prefix+data) → N2 (prefix) →
  N3 (data) → N4 (qualsevol .SRT), triant el MÉS RECENT (data del nom → `created`).
- `js/workflows/flow_srt.js` → `_srtCtx()`, `runSrtFallback()`, **`runSrtLoad(forceFallback)`**
  (entrada del botó: 1r blocs de 15 min — èxit detectat comparant `SrtEditor._srtPath` abans/després —
  i si no, fallback).
- `js/main.js` (btnSrtLoad) → `callWorkflow('Srt','runSrtLoad', ctrl)`; **Ctrl+clic = fallback directe**.
- ⚠️ El SRT del fallback NO es re-temporitza (s'assumeix eix del MP4 del bloc = clip V1); el
  d'emergència (15 min) sí que es re-temporitza amb el manifest.
- `index.html`: `Scanner.js?v=7`, `flow_srt.js?v=6`, `main.js?v=48` + tooltip del botó.
- `C:\temp\fp_syntax_check2.html`: afegits `flow_render.js` i `flow_srt.js` → **27 OK / 0 FAIL**.
- **Pendent de PROVAR a Premiere** (no commitejat).

## 🔧 FIX 2 (15:30) — Portada: PNG no exportat + àudio fantasma
1. **Àudio fantasma (A1/A2)**: el `Clips.insertClipFrom` (ripple) de la còpia arrossega l'àudio del
   clip font a A1/A2 i la neteja només esborrava vídeo. Ara el `finally` fa `Clips.removeAt(a, tempTC, 'audio')`
   per a TOTES les pistes d'àudio (`Tracks.count('audio')`) + log `🧹 [Portada] Neteja d'àudio fantasma`.
2. **El PNG no s'escrivia**: `C:\temp` NO tenia cap `fast_snap_*.png` → `Logic.Render.capture`
   (C:\temp + `cep.fs.rename` a UNC) no arribava a escriure res. Ara:
   - S'escriu **directament al destí final** amb `Render.snapshot` (QE), com fa el freeze dels chyrons.
   - **Out point**: si està fixat i queda ABANS de la zona neta, `exportFramePNG` no treu res →
     s'amplia temporalment amb `Timeline.out(tempTC+2)` (`Timeline.getOut()` per llegir-lo) i es
     **restaura al `finally`**.
   - **2a via**: si QE no escriu el fitxer, es prova `Render.frame` (API `seq.exportFrame`).
   - Verificació real: `waitFile(destPath)` (stat) + LLEGIR el PNG per la mida (stat no dóna `.size`).
   - Logs: `📐 Out point = …`, `📸 Captura a <destí> | carpeta projecte=…`, `📸 Render.snapshot → …`,
     `📸 Render.frame → …`, `✅ PNG generat via QE|API (N KB)`.
3. `flow_render.js` → **`?v=19`**. Eliminat `getRenderLogic` (ja no s'usa).
   ⚠️ Pendent: esborrar a mà l'àudio fantasma que va quedar al timeline (~tempTC d'A1) de la prova anterior.

## 🔧 FIX 3 (16:00) — Portada: centrat 0.5/0.5 + nom del vídeo existent
1. **Centrat**: `Motion → Position` és **NORMALITZADA (0..1)** amb **0.5 = centre**; jo hi
   escrivia `[0,0]` via `Anim.setMotionValues`, que a més espera **PÍXELS** (els divideix per la mida
   del frame) → el grafisme quedava a la cantonada. Ara s'escriu el centre **en cru**:
   `Clips.setProp(tPort, idxPort, 'AE.ADBE Motion', 'ADBE Video Position', [0.5, 0.5], 'video')`
   (l'àtom `setProp` ja preveu aquest cas i fa `setValue(val)` sense parsejar). L'escala va apart, amb
   `Anim.setMotionValues({scale})` (que força Uniform Scale + Scale Width).
   ⚠️ `Clips.getProp` NO està exposat al wrapper de `jsx/main.jsx` (només `setProp`).
2. **Nom del PNG = el del vídeo que ja és a la carpeta** (amb la seva hora):
   `pickVideoBase(files, refPrefix)` sobre `utils.readFolder(Context.folder())` → .mp4 amb prefix
   `PROG_TEMA_` més recent (nom desc, desempat per `created`); si no n'hi ha cap, `State.lastRenderName`;
   si tampoc, l'hora actual (amb avís). Log: `🎬 [Portada] Vídeo de referència a la carpeta: X.mp4`.
3. `flow_render.js` → **`?v=20`**. Syntax: **27 OK / 0 FAIL**.

## 📌 PENDENTS MENORS


- **F6·Gràfics** (`Markers.placeGraphicMarkers`) es va quedar **sense botó** en redirigir 🎨 al MAPA.
- Possibles falsos positius del sanejat d'hores (seq 42 / 59-60 de TNC).
- **Digition**: si el seu plugin exposa un mètode de render, es podria afegir com a tercera via.
- `js/logic/34_Exportacio.js` és **codi mort** (`Logic.Render` duplicat; el viu és
  `9_Render_Logic.js`) → es pot eliminar.
- ⚠️ **PROTECTED**: `js/editor/srt_editor.js` — no modificar mai.

## 🔧 FIX (14:40) — Portada: "Totes les pistes de vídeo estan bloquejades"
**Causa**: `Clips.debugTracks` (6_Clips.jsx) retorna `locked` calculat amb `!!tr.isLocked`, i a
l'API de Premiere `isLocked` és una **FUNCIÓ** → **sempre `true`**. `runPortada` l'usava per triar
pista → cap pista "desbloquejada" → error immediat.
**Fix** (`flow_render.js`, `?v=18`) — disseny SIMPLE: còpia a la mateixa **V1**, portada a **V2**:
- **Còpia**: `Clips.insertClipFrom(1, srcIdx, 1, tempTC, 'video')` → ripple **a la MATEIXA V1**, més
  enllà del final del projecte (no desplaça res) + `Clips.inPoint(mediaIn)` + `Clips.moveToRange`.
  ⚠️ `Clips.duplicate` **no serveix** per a això: fa `overwriteClip` al START del clip font (media
  sencer) i machacaria la V1 real.
- **Portada**: `Clips.insert(portada, T_PORT = V2 (config `fondos`), tempTC, +2s)`; si V2 fallés, es
  prova la de sobre (`T_PORT…nVT`). `ERR_ITEM_NOT_FOUND` atura el bucle.
- **Neteja**: `removeAt(V1, tempTC)` + `removeAt(tPort, tempTC)` + `Timeline.set(cti)`.
- ⚠️ **Lliçó per a tot el projecte**: `debugTracks(...).locked` **NO és fiable** (a 6_Clips.jsx es
  calcula amb `!!tr.isLocked` i `isLocked` és una FUNCIÓ → sempre `true`). Ningú l'ha d'usar per
  decidir res: fer l'operació i reaccionar a l'error. (`flow_graphics.js` L525-526 l'usa només per a
  un avís de diagnòstic → fals positiu.)


---

## 2026-09-21.md

# Progrés 2026-09-21 — IPD sense marcador (deducció per densitat)

## 🔴 Bug detectat al projecte TNV V1 (2026_09_20)
El marcador de l'ítem **`13`** («++++IPD VOTACIONS O CELEBRACIONS ALEMANYA», seq 33, agrupació `v1`)
**no es generava**. El bloc tenia 5 ítems i només se n'han col·locat 4 (12dp, 12dir, 14, 15).

### Cadena de causes
1. `escaleta_bounds.js::_sanitizeOnAirLies()` va anul·lar **les dues** hores de l'ítem 13:
   - L613-620 `sec < highWater` → `horaEntradaOnAir = null`
   - L629-648 (regla «la Prevista és mentidera si l'OnAir ho era») → `horaEntradaPrevista = null`
   → El 21:03:06 era **15 s abans** de la Prevista del seu veí anterior (12dir, 21:03:21): **fals positiu**
   del criteri «encadenat» (la Prevista d'un ítem sense OnAir alimenta el `highWater`, L652-656).
2. `flow_markers.js::_classifyItems()` el descartava **en silenci**: `if (!horaRef || horaRef === "00:00:00") continue;`
   (cap log → el log deia «5 items per al bloc» i tot seguit «4 estructurals, 0 gràfics»).
3. Sense marcador: `Markers.runAplicarIpdDesdeMarkers` no aplicava la configuració IPD
   (escala 144% + posició) i l'ítem es quedava sense chyrons.

## ✅ Implementat (sense JSX nou → no cal reiniciar Premiere)
- `flow_markers.js::_classifyItems`: en comptes de descartar, els ítems **sense hora amb `agrupació`**
  (i no flotants) van a la llista nova `unplacedItems` + log `🔎 [SENSE-HORA] …`. Els ítems sense hora
  i sense agrupació es loguen i s'ignoren (com abans).
- **Fase nova `placeInferredItems` (F5·Inferits)**: per a cada ítem sense hora, finestra = marcadors
  dels veïns **per escaleta** (`sequencia`) i elecció dins la finestra amb el motor de densitat:
  - **A** `_pickInferredByDensity`: ruptura **LOW→HIGH** (inici de peça editada = IPD). Passada
    estàndard + **fina** (`calcDensityFootprintV2(clips, 6, 8)`). Com que la V2 no porta `toType`,
    la direcció s'infereix amb la `zone` que comença a la ruptura (HIGH = inici de peça). Es descarten
    les ruptures que toquen el marcador del veí de la dreta.
  - **B** `_pickInferredByDuration`: si dins la finestra hi ha **una sola peça** → l'ítem és aquella peça
    sencera (cas real: IPD de 21,3 s = clip #16 entre 12dir i 14); si n'hi ha diverses, la clarament més
    llarga (≥2× mediana i ≥5 s).
  - **C** punt mig de la finestra (últim recurs, amb avís).
  - Mai a menys de **0,5 s** d'un marcador veí (no xoca amb F1-F4); color **7 (turquesa)** si el
    títol/num conté IPD.
- Pipeline (`main.js`): fase **`['Inferits (F5)']`** entre `Density (F4)` i `Ordre (F6)`.
- `flow_assembly.js`: delegat `placeInferredItems` (retrocompatibilitat).
- Cache-busters: `flow_markers.js?v=22`, `flow_assembly.js?v=7`, `main.js?v=49`.

### Resultat previst per al cas real (dry-run)
`🔎 [F5·Inferits] 13: finestra [12dir@85.92s → 14@107.24s]` →
`📍 [F5·Inferits] 13 [IPD]: → 86.42s · peça única dins la finestra (21.3s) → inici de la peça · color=7 (ajustat de 85.92s per no xocar amb el veí)`

## FIX 2 (10:35) — la finestra dels veïns sortia malament
El primer intent va córrer (log 10:20): `🔎 [SENSE-HORA] 13` ✔, `📋 Items: 4 estructurals, 0 gràfics,
1 sense hora (a deduir a F5)` ✔, fase F5 executada ✔, passada fina de densitat OK (24 zones/5 ruptures)
— però:
```
🔎 [F5·Inferits] 13: finestra [—@0.00s → 12dp@0.00s]
⚠️ [F5·Inferits] 13: finestra massa estreta → saltant
```
**Causa**: `assembly_context.js:125` ordena `lines` **per hora**
(`horaEntradaOnAir || horaEntradaPrevista`), i l'ítem 13 no en té → queda **el primer** de l'array.
La meva fase confiava en l'ordre d'entrada → el "següent" era el 12dp. (És exactament la trampa que
la regla del projecte avisa: l'ordre sempre per `sequencia`, mai per TC.)
**Fix**: `placeInferredItems` ara construeix una còpia ordenada per **`sequencia`** (`ordered`) i hi fa
la cerca de veïns. `lines` no es toca (F1/F2/F3 en depenen de l'ordre per hora).
Cache-buster: `flow_markers.js?v=23`. Syntax: **27 OK / 0 FAIL**.

## FIX 3 (11:05) — 3 problemes de chyrons (TNV V1, 2026-09-21)
### A) Nom-Carrec col·locat a V7 (incorrecte)
Evidència del log: `[Resto] Wott_TNV_v1_12dp_..._Dona pas DIRECTE ALEMANYA_600257_Directe_PRESENCIAL_Berlín...mov → V7 @ 14.48s`
(els dos NOMCARREC reals sí que anaven a V6).
**Mecanisme**: els resolvers de pista tenien **V7 com a alternativa**:
- `placeChyronNom` → `[V6, V7]` (L1317)
- `placeChyronResto`, branca `_isConexioWott` (Directe/Enviat/Presencial) → `[V6, V7]` (L1460)
Si V6 estava ocupat, el selector de forat queia a V7.
**Fix**: tots dos passen a **`[V6]`** (només V6). Es manté TITOLET → V7 i Lloc/Data → V7 (no són nom-càrrec).

### B) Botó REPARTIR afectava tota la V7
Evidència: `🧹 [Repartir] V7 (trad) netejat` (feia `Clips.clearTrack(T_TRAD)`).
**Fix**: ara només s'esborren les traduccions **SELECCIONADES** (`Clips.removeAt` per temps) i la resta de la
pista queda intacta; a més s'avisa si algun clip NO seleccionat cau dins del rang de repartiment (quedaria tapat).

### C) Tema-Titol no entrava després del Conductor
Evidència: `[Conductor·CasB] Marge insuficient (6.20s < 11.04s): Conductor @ 0.40s` però
`[Titol·CasA] inici del bloc @ 0.40s (fi del rètol conductor @ 5.40s)` → tots dos a 0.40s.
**Causa**: el Conductor mesura el marge com la **llargada del clip** (6.20s) i el Titol com la **distància al
marcador següent** (gran) → decisions oposades (CasB vs CasA).
**Fix** (`_blockStartTime`): `marge = min(marcador, clip)` → amb 6.20 < 11.04 tria **CasB** i el Tema-Titol
arrenca a `condEnd` (5.40s = fi del rètol del conductor).

Cache-buster: `flow_chyrons.js?v=22`. Syntax: **27 OK / 0 FAIL**.

## FIX 4 (12:20) — Repartir no retallava + focus V1 després de DoblePantalla
### A) Repartir: l'últim clip pisava els següents
Causa: `Clips.insert(name, T, start, end)` aplica l'`endSec` al clip que Premiere considera
**últim de la pista**, NO al que s'acaba d'inserir (quirk conegut de l'API) → la traducció
quedava amb la **durada sencera del mèdia** i envaïa el que venia després.
**Fix**: després de cada `insert` → `Clips.endAt(T_TRAD, newStart, newEnd)` (retall per temps,
immunitzat a renumeració). A més, el DARRER slot es retalla a `min(final del clip de referència
a V1, següent marcador)` (petició d'usuari); si el límit deixaria durada ≤ 0.1s, s'usa el final
del rang.
Utilitat llegida: `Markers.get()` → `[{time, name, comments, color}]`.

### B) Foco d'autoselecció perdut després de DoblePantalla
Causa: `Anim.setMotionValues` acaba amb un **toggle de selecció intern** (refresc NewWorld).
PAS4 crida setMotionValues sobre V2 i V3 → l'últim clip SELECCIONAT és de V2/V3, i el
"clip objectiu" del panell (`Anim.sliderApply` / `Anim.modeInfo` → `_sliderTarget` →
`Clips.getSelectedVideo`, que recorre pistes d'abaix cap amunt) ja no apuntava a V1.
**Fix** (sense JSX nou): `_dpFocusV1(v1Start)` al final del PAS4 → re-aplica al clip de V1 els
SEUS MATEIXOS valors de Motion (`Anim.getMotionValues(1, idx)` → `Anim.setMotionValues(1, idx, …)`),
cosa que executa el mateix toggle de selecció **sense cap canvi visual** i deixa V1 seleccionat.
Log: `FOCUS → V1[i] "nom" | clip objectiu: <abans> → <després>` + crops de V3 després (diagnòstic).

Cache-busters: `flow_chyrons.js?v=23`, `flow_graphics.js?v=6`.
Harness de sintaxi ampliat (flow_graphics, flow_retols, flow_mp4, flow_cut, flow_config,
11_NNews_Logic) → **33 OK / 0 FAIL**.

## FIX 5 (13:05) — Repartir: referència per tram, slots uniformes i reparació dels veïns
Peticions d'usuari: (1) cada tram amb la SEVA referència; (2) tots els clips han de durar el mateix;
(3) el clip del bloc següent no s'ha de tocar (o s'ha de tornar a la seva posició).
### Errors corregits
- **Rang GLOBAL per a tots els trams**: `rangeStart/rangeEnd` es calculaven un cop (inici del 1r clip
  V1 seleccionat → final de l'últim) i s'usaven per a tots els trams → el bloc 2 es calculava amb
  l'inici del bloc 1 i envaïa el bloc veí. Ara cada tram busca el SEU clip de V1 (`_clipAtInstant`)
  i el seu límit = `min(final d'aquell clip, primer marcador que toqui el darrer slot)`.
- **Últim clip més curt**: `slotDur` es recalcula com `(límit - iniciRef) / M` → tots els slots
  (l'últim inclòs) duren el mateix i l'últim acaba exactament al límit.
- **Pisava el bloc següent**: `Clips.insert(name, track, start, endSec)` aplica l'`endSec` al DARRER
  clip de la pista (quirk de l'API) i l'overwrite destrossa el que hi ha sota la durada per defecte
  del mèdia. Ara: insert SENSE endSec + `Clips.endAt` (slot exacte) + verificació de la durada real.
- **Reparació** (`_repararClipsV7`): instantània prèvia dels clips NO seleccionats; després de
  repartir, qualsevol clip tocat (retallat/desplaçat/esborrat) es torna a la seva posició original
  (`moveToRange`, o `insert`+`endAt` si havia estat esborrat). Com que les traduccions són PNG
  (elàstics), només cal tocar el clip afectat — idea d'usuari, més barata que moure tota la pista.
  2 passades; no repara clips que caiguin dins d'un slot repartit; no confon traduccions nostres.

Cache-buster: `flow_chyrons.js?v=24`. Syntax: **33 OK / 0 FAIL**.
Comprovat: `_clipAtInstant` retorna `{start,end}` (no el clip sencer) → usat així.

## FIX 6 (13:40) — Auto-selecció a V1 al final de DoblePantalla, Repartir, MAPA, Gràfica i Tòtem
Petició d'usuari: després de qualsevol d'aquests 5 fluxos, el "clip objectiu" del panell ha de
tornar a ser el clip de V1 (com es va fer primer a DoblePantalla).
**Implementació DRY** (abans era un mètode privat `_dpFocusV1` a flow_graphics.js):
- Nou `getUtils().focusV1(tag, refSec)` a `js/core/utils.js` (Core, compartit per tots els workflows):
  busca el clip de V1 (`Clips.at(1, refSec+0.1)` o, si no, el de sota el CTI), llegeix els seus
  valors de Motion (`Anim.getMotionValues`) i els torna a escriure (`Anim.setMotionValues`) → mateix
  estat visual, però V1 torna a quedar SELECCIONAT. Log: `🎯 [tag] focus → V1[i] "nom" | clip objectiu: abans → després`.
- `_dpFocusV1` eliminat de flow_graphics.js (sense duplicar codi).
**Punts d'invocació afegits:**
| Flux | Fitxer | Punt |
|------|--------|------|
| DoblePantalla | flow_graphics.js `_dpPaso4` | `focusV1("DoblePantalla", dp.data.v1Start)` |
| MAPA zoom (🗺️) | flow_graphics.js `runMapa` | `focusV1("MAPA", sel.start)` |
| Tòtem (🗿) | flow_graphics.js `runTotem` | `focusV1("TOTEM", sel.start)` |
| Gràfica (🎨) | flow_mapa.js `_flow` | `focusV1('MAPA-GRAF')` |
| Repartir (↔️) | flow_chyrons.js `repartirChyronTraduccio` | `focusV1("Repartir")` |

Cache-busters: `utils.js?v=11`, `flow_chyrons.js?v=25`, `flow_graphics.js?v=7`, `flow_mapa.js?v=12`.
Syntax: **33 OK / 0 FAIL**.
Nota: IPD NO s'ha tocat (opera sobre el clip seleccionat a propòsit).

## FIX 7 (14:10) — Chyrons: solape Merz/Elif + autofoco i targeting V1 després de COL·LOCAR
### A) Verificació del solape (confirmat pel codi)
Regla vigent: `placeStart = ci.start + 0.40` (10 frames després de l'inici del clip de V1
que conté l'instant ideal). Si els marcadors de DOS ítems cauen dins del MATEIX clip de V1,
els dos rètols reben el mateix `placeStart` → volen la mateixa posició.
A la run de les 10:37 NO es solapaven perquè V1 tenia tall a 125.40 (`[108.48-125.40]` i
`[125.40-143.52]`). Amb els marcadors nous (14@108.04, 15@123.56) tots dos cauen al mateix clip.
`_chooseSlot` hauria d'haver-ho evitat, però la seva finestra era `placeEnd = placeStart+durada`
→ el forat posterior al 1r rètol quedava fora de finestra → fallback:
`return { track: list[0], start: startSec, moved:false }` = EXACTAMENT sobre el primer, i SENSE cap
avís al log (per això era silenciós).
**Arreglat** (flow_chyrons.js):
- La finestra per buscar forat ara és tot l'ÍTEM (`limSlot` = final del clip de V1 o següent marcador).
- Si no hi ha forat dins de l'ítem → es busca el primer forat endavant i es marca `overLimit` (WARN).
- Últim recurs → `overlap: true` i WARN ben visible (`SENSE ESPAI LLIURE… col·locat sobre un altre rètol`).
### B) Autofoco i targeting després de COL·LOCAR
Causa del "totes les pistes enfocades": algunes passes fan `Tracks.target(1, true)` sense apagar
les altres (i els inserts amb ripple / `_limitarTargets` poden deixar-les totes actives).
- Nou `getUtils().targetOnlyV1(tag)` (utils.js): deixa el targeting NOMÉS a V1 (vídeo) i A1 (àudio).
- `runPlaceAllChyrons` (main.js) acaba amb `targetOnlyV1('Col·locar')` + `focusV1('Col·locar')`.
Cache-busters: `utils.js?v=12`, `flow_chyrons.js?v=26`, `main.js?v=50`. Syntax: **33 OK / 0 FAIL**.
### C) Observació pendent de decisió (TC "00.01" dels wotts)
`getUtils().timeToSeconds("00.01")` = **1 segon** (parteix per "." i fa minuts*60+segons). Com que
el camp TC d'aquests wotts és sempre "00.01", l'instant ideal de cada rètol va **+1s** respecte al
seu marcador. Normalment no es nota (després s'ancora al clip de V1), però si el marcador cau a
l'últim segon d'un clip, l'ideal entra al clip SEGÜENT → rètol mal ancorat. Cal decidir si "00.01"
vol dir 1 frame/0.01s.

## FIX 8 (15:00) — Model d'ÍTEMS: el marcador és sagrat + "Enviat" → ítem de connexió
Aclariment d'usuari (defineix el model): els marcadors són l'ESTRUCTURA del bloc. Cada rètol va
al SEU ítem: **mai abans del seu marcador ni després del següent**. Els talls de Premiere NO són
frontera fiable (entre dos INSERTS hi ha efectes que no es detecten com a tall).
### Corregit a `_placeChyronsByType` (flow_chyrons.js)
1. **Ancoratge:** `placeStart = max(inici del clip de V1, marcador de l'ítem) + 10 frames`.
   Abans era només `inici del clip + 10f`: si un clip de V1 contenia dos ítems (cas MERZ + Elif,
   clip 108.48→143.52), tots dos entraven a 108.88 → el segon tapava el primer. Ara Elif entra a
   123.96s (marcador 123.56 + 10f).
2. **Límit dur = SEGÜENT marcador** (abans era el final del clip, que tallava malament).
   Només si no hi ha marcador següent s'usa el final del clip.
3. **Mai sortir de l'ítem:** eliminat l'escapament `overLimit` que havia afegit al FIX 7 (era
   contrari al model). Ara, si no hi cap amb la durada completa, el rètol **s'escurça** al forat
   disponible dins de l'ítem (`slot.shrunk` + WARN amb la durada màxima).
4. **Conexió (Enviat/Directe/Presencial):** si el wott ve penjat a un ítem ANTERIOR (donapas, cas
   real: `_12dp_..._Enviat_Sí Jordi Regàs`), es detecta el seu **marcador de connexió**
   (`_isConexioMarker`/`_connexioMarkerTime`) i es col·loca a l'ÍTEM DE CONNEXIÓ, amb la finestra
   d'aquell ítem. Aplica a Nom i Resto (mateix motor). Log: `🔌 CONNEXIÓ: "…" ve penjat a l'ítem X
   → es col·locarà a l'ítem de connexió "12dir - …" @ Ys`.
Cache-buster: `flow_chyrons.js?v=27`. Syntax: **33 OK / 0 FAIL**.
Pendent de decisió: TC "00.01" dels wotts (= +1s a l'instant ideal, vegeu FIX 7-C).

## FIX 9 (15:40) — DoblePantalla: targeting a V1 + etiqueta del botó original
### A) El focus/targeting no tornava a V1
`focusV1` (que vaig afegir al FIX 6) només SELECCIONA el clip de V1; no toca el **targeting de
pistes**, que és el que es veu com "focus" a la capçalera de pista. La DF deixa V2/V3 com a pistes
tocades (i `_limitarTargets` pot acabar activant-les totes si `getTargeted()` falla).
**Fix:** al final del PAS4 → `getUtils().targetOnlyV1("DoblePantalla")` + `focusV1(...)`.
També afegit `targetOnlyV1` a MAPA, TÒTEM, GRÀFICA (flow_mapa) i REPARTIR (només tenien focusV1).
### B) El text del botó quedava canviat ('DblPant ✓')
`runDoblePantalla` escrivia 'DblPant…' al començar i 'DblPant ✓'/'DblPant' al final, i no tornava mai
a l'etiqueta original de l'HTML ('🪟🪟').
**Fix:** helpers `_dpBtn` / `_dpBtnSet` / `_dpBtnReset` (flow_graphics.js): capturen l'etiqueta
original la primera vegada (`data-orig-label`) i la restauren a TOTS els camins de sortida
(èxit, error de pas, excepció i Ctrl+clic = reset).
Cache-busters: `flow_graphics.js?v=8`, `flow_chyrons.js?v=28`, `flow_mapa.js?v=13`.
Syntax: **33 OK / 0 FAIL**.

## FIX 10 (16:10) — Revertit l'abast del canvi: "Directe_PRESENCIAL" torna a V7
Queixa d'usuari: el canvi fet per al tipus Enviat no havia d'afectar altres tipus.
`Directe_PRESENCIAL_Berlín` és un rètol de LOCALITZACIÓ (no nom-càrrec) i ha d'anar a **V7** com
sempre; el FIX 1 li havia tret V7 (l'havia enviat a V6).
### Corregit (flow_chyrons.js)
1. **Resolutor de pista** (`placeChyronResto`): la branca de LOCALITZACIÓ/PROGRAMES ara va ABANS
   de la de connexió i reconeix `DIRECTE[_ ]PRESENCIAL`, `DIRECTE[_ ]PROGRAMES`, `PROGRAMES`,
   `rRol` PRESENCIAL/PROGRAMES → `[V7, V6]` (com sempre). La branca de connexió (Enviat/Directe del
   connector) continua sent `[V6]` (nom-càrrec, sense V7).
2. **Redistribució al ítem de connexió** (FIX 8): restringida al tipus **ENVIAT** amb el nou
   helper `_isEnviatWott()` (abans `_isConexioWott`, que incloïa Directe/Presencial) → els rètols
   "Directe PRESENCIAL"/Programes es queden al seu ítem.
3. **Ítem efectiu**: la finestra (entrada/límit) es calcula amb el marcador que CONTÉ l'instant
   d'entrada (`mkEff`), no amb el número del fitxer: així un rètol ancorat al PUNT DE CONNEXIÓ
   (Directe_PRESENCIAL al 12dir, p.ex.) té la finestra de l'ítem de connexió i no es salta.
   Log: `[ítem 12dir]` quan l'ítem efectiu difereix del nominal.
Resultat esperat pel cas real: `..._Directe_PRESENCIAL_Berlín...` → **V7 @ 14.48s** (com al log del
matí) i `..._Enviat_Sí Jordi Regàs...` → V6, col·locat a l'ítem de la seva connexió.
Cache-buster: `flow_chyrons.js?v=29`. Syntax: **33 OK / 0 FAIL**.

## FIX 11 (16:40) — FALLBACK del MP4 del bloc: clip d'1s (TNM V2, 21/09)
Símptoma: el clip del timeline (61.04s) no coincidia amb l'escaleta (bloc de 2:21).
### Cadena de fets (log `PROVES\FASTPASS.log`, 13:09)
1. Els OnAir d'aquest bloc eren majoritàriament mentiders (49 neutralitzats; p.ex. `"20i" @
   14:27:34` abans de l'inici de programa 14:30:00) → l'IN es va deduir per tiers:
   Tier0 cross-agrupació = 53226s i Tier1 `"20i"` = 53221s → regla «PISO columna base» →
   àncora **14:47:06**; OUT Tier1 `"20"` (+2:09) → **14:49:27** → **bloc = 141s** ✔ (l'escaleta).
2. El bloc s'emet DESPRÉS del final del cleanFeed: `OUT-MARGIN` va limitar l'OUT al final del
   cleanFeed (1367s → 1120s) i el pedaç de seguretat `IN (1186) >= OUT (1120) → OUT = IN + 1`
   va deixar **`mp4Duration = 1.0s`** (corrupte).
3. `isBoundsOutOfCleanFeedRange()` va detectar-ho bé (IN 1186 ≥ cleanFeed 1120) i va trobar el
   MP4 individual del bloc ✔, PERÒ `calcFallbackBoundsForBlockMedia()` **reutilitzava
   `bounds.mp4Duration` (1.0s)** → `IN=0, OUT=1.0s`.
4. Extracció: `dur=61s (bloc 1.00s + cola extra 60s)` → **clip de 61.04s al timeline** ✗.
### Fix
- `escaleta_fallback.js::calcFallbackBoundsForBlockMedia(bounds, handles)`: la durada es
  **recalcula amb els temps absoluts del bloc** (`worldBlockEndSec − worldBlockStartSec`) **+
  handles** (161s en aquest cas) i només cau a `mp4Duration` si falten els worldBlock*Sec.
- `flow_mainButton.js`: es passen els handles (`ctx.config.handles`).
- Log nou: `📐 Durada del bloc recalculada: 161.0s (bloc 141.0s + handle 20.0s)`.
- Afegit `escaleta_fallback.js` al harness de sintaxi (no hi era) → **34 OK / 0 FAIL**.
Cache-busters: `escaleta_fallback.js?v=6`, `flow_mainButton.js?v=13`.
Pendent: si NO es troba el MP4 del bloc, el clip d'1s encara podria sortir (cas sense fallback).

## FIX 12 (17:10) — Ancla del bloque: usar un TC REAL no mentiroso (TNM V2, 21/09)
Queixa d'usuari: «es dona per bo el TC en què es va disparar el 20p7, quan és el TC mentider;
caldria mirar si hi ha algun altre TC que almenys no sigui mentider».
### Dades del bloc V2 (escaleta 20260920_144603_…JSON, seq 56-59)
| ítem | OnAir | Prevista | durada |
|------|-------|----------|--------|
| 19p7 (P7 FOTOS LA PALMA 2 LLIB) | — | **14:47:08 ✅ (net)** | 0:00 |
| 20p7 (P7 GOOGLE LA PALMA PUERTO NAOS) | 14:27:34 ⚠️ mentider | 14:27:34 ⚠️ | **0:-1 (corrupta)** |
| 20i (Intro 20) | — | 14:27:51 ⚠️ | 0:17 |
| 20 (LA PALMA GASOS…) | — | — | 2:09 |
Run 13:18: `Tier0-IN → 14:47:06`, `Tier1 (20i deduït) → 14:47:01`, `PISO → 14:47:06` → l'IN venia
de **deduccions que passen pels ítems mentiders** (20p7 amb durada `0:-1` inclosa) i del piso,
tot i que el bloc TÉ una referència real (19p7 @ 14:47:08) que no s'usava.
### Fix (escaleta_bounds.js)
- Nou `ER._firstCleanBlockEntry(blockLines)`: primer ítem del bloc amb `horaEntradaOnAir` o
  `horaEntradaPrevista` plena (= TC propi que el sanejament NO ha anul·lat → referència real).
- A `calcPrecisionTrimBounds`, després del PISO: **si el bloc ha estat sanejat** i hi ha un TC net
  dins de ±300s → s'adopta com a IN i com a àncora (log `🎯 Reference NETA del bloc: "19p7"
  Prevista @ 14:47:08 → s'adopta com a IN (abans 14:47:06, 2s)`). Si és a més de 300s → WARN i es
  manté el càlcul.
- Efecte en aquest cas: IN 14:47:06 → **14:47:08** (bloc 139s + handles).
Harness de sintaxi ampliat amb tota la família escaleta_* + session_manifest + assembly_context
(no hi eren): **41 OK / 0 FAIL**.
Cache-buster: `escaleta_bounds.js?v=13`.
Observació pendent: `20p7` té `duradaOnAir = "0:-1"` i s'usa a la cadena de deducció
(`accumulatedDur`) → es podria ignorar quan és ≤ 0.

## FIX 13 (18:00) — Re-diagnòstic TNM V2: la "referència neta" era un error; 2 bugs reals
Usuari: «La intro no és mentirosa. Vuelve a pensarlo. 0:-1 és clarament corrupte».
### Re-diagnòstic (amb els veïns d'escaleta, seq 52-62)
| seq | num | onAir | prev | durada | notes |
|-----|-----|-------|------|--------|-------|
| 53 | 17 | 14:45:00 | 14:45:00 | 0:00/0:25 | IPD |
| 54 | 18 | **14:45:25** | 14:45:25 | 1:36 | ALEMANYA PERFIL ELIF ERALP (faro real) |
| 55 | . (TALL) | — | 14:47:01 | 0:07→**5s** (corregit) | MOLINET 1 |
| 56 | 19p7 (V2) | — | 14:47:08 | 0:00 | P7 FOTOS LA PALMA (pla SENSE corregir, +2s) |
| 57 | 20p7 (V2) | 14:27:34 ⚠️ (disparo) | 14:27:34 | durOnAir **0:-1 corrupta** | P7 GOOGLE LA PALMA |
| 58 | 20i (V2) | — | 14:27:34 (no és mentida: és el pla del programa original) | 0:17 | Intro 20 |
| 59 | 20 (V2) | — | 14:27:51 (ídem) | 2:09 | LA PALMA GASOS… |
**Conclusió**: l'IN del bloc (14:47:06) JA era correcte = faro 18 (14:45:25) + 1:36 = 14:47:01
+ MOLINET corregit (5s) = **14:47:06** ✔. La Prevista de 19p7 (14:47:08) és el pla sense corregir
→ el meu FIX 12 (adoptar-la) era ERRONI: **revertit** (helper `_firstCleanBlockEntry` eliminat).
### Bugs reals trobats i corregits
1. **El sanejament no era global** (escaleta_io.js): `_sanitizeOnAirLies` només s'executava dins
   de `calcPrecisionTrimBounds`; el JSON es TORNA a parsejar per als marcadors/anàlisi → el
   manifest i els marcadors seguien donant per bo el TC mentider del 20p7 (14:27:34) i la seva
   durada corrupta. Ara es saneja a `ER.load()` (a la càrrega, abans de qualsevol consumidor) →
   log `🕵️ [ER:IO] N hores mentideres neutralitzades a la càrrega`.
2. **La durada corrupta sí que es colava** (escaleta_items.js `_deduceOnAirEntrada`): acumulava
   `parseDurada("0:-1")` = **-1s** (2 llocs). Ara fa servir `getItemDuradaSec()` (ignora ≤0 i cau
   a `durada`, que ja tenia el guard).
Cache-busters: `escaleta_io.js?v=10`, `escaleta_items.js?v=6`, `escaleta_bounds.js?v=14`.
Syntax: **41 OK / 0 FAIL**.

## FEATURE (19:00) — TEMA-TÍTOL PETIT ("titulillo") com a transició d'entrada/sortida
Petició d'usuari: donar utilitat al Tema-Títol petit que fins ara es descartava. Té animació
d'entrada; cal la versió invertida (ffmpeg) per fer-la servir de SORTIDA. Col·locació:
(a) si el Tema-Títol gran va DESPRÉS del conductor → titulillo ENTRANT a l'inici del bloc i
titulillo SORTINT just abans del gran; (b) amb més d'un Títol gran → titulillo SORTINT abans de
cada següent ("entre temes"). El que s'ha d'invertir és **el darrer generat**.
### Descobertes
- El "titulillo" = Tema-Títol de **1,0 s** qtrle/argb 1920x1080 25fps (els grans són 10,4 s).
  Ex. bloc 12dp: `..._600279_Tema-Titol_..._00600388.mov` (1s) + dos de 10,4s + portades PNG.
- `pickTemaTitols` els descartava pel filtre `dur > minSec` (4s) ✔ (el motiu d'aquesta feature).
- `FFmpeg.reverse()` existia però **no s'usava mai i estava trencat**: (1) esperava `waitForFile`
  sobre el .mov, que només funciona amb fitxers de TEXT (IO.readTxt → "OK"); (2) generava .mp4 →
  **perdia l'alpha** dels wotts.
### Implementat
1. `3_Project_Logic::pickTemaTitolPetit(structure, idx, maxSec)` → el titulillo amb `0 < dur ≤ maxSec`
   (portades excloses) i, si n'hi ha diverses versions, **l'ID més alt (el darrer generat)**.
2. `15_FFmpeg_Logic::reverse()` **reescrit**: patró fiable `.ps1` + fitxer `.done` (com extractClip),
   `-vf reverse -c:v qtrle -pix_fmt argb` (conserva alpha) → `<carpeta projecte>\<base>_REV.mov`,
   import al bin CHY, i si la sortida ja existeix es reutilitza (re-runs instantanis).
3. `flow_chyrons`:
   - `_blockStartTime` desa el CAS (`this._lastTitolCase` = 'A'/'B').
   - `placeChyronTitol` recull les posicions dels grans (`ttPlaced`) i crida
     `_placeTemaTitolTransicions({struct, wottIdx, ttPlaced, clipStart, track, minSec, case})`.
   - `_placeTemaTitolTransicions` + `_ensureReversedTitolPetit`: col·loquen a la pista de
     Tema-Títol (insert + endAt, durada pròpia ~1s):
     · ENTRANT (normal) @ clipStart+0.40 — només CasB (el gran va després del conductor).
     · SORTINT (invertit) acabant EXACTAMENT a l'inici de cada gran (`placeTime - durP`) —
       el primer només en CasB; la resta sempre ("entre temes").
### Logs per verificar
`🎬 [Titol·Petit] Titulillo triat: … (1.00s, id=…)`, `🔄 [Titol·Petit] Versió invertida llesta: …_REV.mov`,
`🟢 [Titol·Petit] ENTRANT → V… @ 0.40s→1.40s`, `🔴 [Titol·Petit] SORTINT (abans del gran 1/N) → V… @ X→Y`.
Cache-busters: `flow_chyrons.js?v=30`, `3_Project_Logic.js?v=12`, `15_FFmpeg_Logic.js?v=6`.
Syntax: **41 OK / 0 FAIL**.
Decisions preses (ajustables): l'ENTRANT va a `clipStart+0.40` amb la durada pròpia del titulillo
(sense estirar); en CasA (gran a l'inici) no hi cap l'ENTRANT i només es fan les transicions "entre temes".

## FIX 14 (20:00) — RENDER: ha de respectar els marcadors de la seqüència (TNC en directe)
Símptoma: després de fer IN/OUT (i modificar l'àrea de treball), el render de vídeo sortia amb la
DURADA ORIGINAL.
### Causa
- `flow_render.js::runVideo` → `Render.renderDirect` → `seq.exportAsMediaDirect(path, preset, 0)`:
  **aquesta API NO accepta cap paràmetre de rang** → exporta la SEQÜÈNCIA SENCERA.
- `9_Render.jsx::addToAME` → `app.encoder.encodeSequence(seq, path, preset, 0, 1)`:
  **workAreaType = 0 = ENCODE_ENTIRE_SEQUENCE** → també ignorava IN/OUT i l'àrea de treball.
### Fix (enfocament FINAL decidit per l'usuari: "exportar el que queda")
Al clicar Render:
1. **Llegir el rang**: `Render.exportRange()` (nou àtom, retorna `{mode,inSec,outSec,src}`: 1 = IN→OUT,
   2 = àrea de treball — és l'únic que llegeix l'ÀREA DE TREBALL; `Timeline.getOut()` només el punt OUT).
   Fallback: `Timeline.getOut()`.
2. **Retallar el timeline a l'OUT** (`flow_render::_trimTailAtOut`, composició d'àtoms
   `Tracks.count`/`Clips.count/get/remove/endAt` — zero JSX nou): a cada pista de **VÍDEO i ÀUDIO**,
   els clips que comencen després de l'OUT s'ELIMINEN i els que el creuen es RETALLEN amb `endAt`.
   ⚠️ La pista de SUBTÍTOLS no es toca: ja ve cortada d'origen (indicació d'usuari).
3. **Exportar** la seqüència resultant amb el motor directe de Premiere (`Render.renderDirect`) —
   sense AME ✔.
Log: `✂️ [Render] Retall a Xs (IN→OUT)` + una línia per clip + `✅ [Render] Exportat (retallat a Xs)`.
Si no hi ha OUT ni àrea de treball: avís i s'exporta el timeline tal com està.
(`9_Render.addToAME` queda arreglat —workAreaType 1/2— però el flux de render ja no l'usa.)
Cache-buster: `flow_render.js?v=22` (el JSX es carrega amb `$.evalFile` des de `jsx/main.jsx`).

## ⚠️ Pendent

- **Provar-ho a Premiere** (recarregar el panell i tornar a passar el pipeline de marcadors: si V1 ja
  està trocejada, el pipeline salta OUT i TROSSEJA i només re-col·loca marcadors).
- **Decisió de l'usuari**: el 12dir té el marcador a 85.92 s, que és exactament l'inici de la peça de
  l'IPD. Cal confirmar si el 12dir hauria d'anar a l'inici de la SEVA peça (0 s) o si comparteixen frontera.
- `escaleta_bounds.js`: evitar el fals positiu «encadenat» amb les Previstes (punt 1 de la cadena).
- Segueix pendent (d'altres sessions): senyal «LLEST per treballar» (`plans/PLAN_SENYAL_READY.md`),
  setup/`Profile.json` (`Config.load`), Lot A de neteja de l'auditoria de capes.

---

## 2026-09-22.md

# Progrés · 2026-09-22

## 🔴 FIX 1 — El flux "s'ha penjat" al TEMA-TÍTOL PETIT (reverse ffmpeg)

**Símptoma (TNC V1, 09:11:22):** la pipeline es va quedar parada 3 min al final de `Titol`
i després, "tot sol", va continuar i va col·locar Nom (4), Resto (1) i Traducció (0) bé.

**Causa arrel (2 bugs):**
1. `FFmpeg.reverse` escrivia el `.ps1` amb `cep.fs.writeFile` → **UTF-8 SENSE BOM**.
   PowerShell 5.1 llegeix els `.ps1` sense BOM com **ANSI** → `colònies` es converteix en
   `colÃ²nies` → ffmpeg: `Error opening input: No such file or directory` → no es genera el
   `_REV.mov` → no s'escriu el `.done` → `waitForFile` espera els **180 s** de timeout
   (això és el que semblava "penjat": 09:11:22 → 09:14:22 i continua).
   Repro verificada: `reverse_1790061082872.ps1` donava `col├â┬▓nies` ✗.
2. El `.ps1` només escrivia el `.done` SI existia la sortida → qualsevol error de ffmpeg
   bloquejava 3 min.

**Fix:**
- `.ps1` amb **BOM** (`'\uFEFF' + psContent`) ✔.
- `.done` s'escriu SEMPRE: `OK` o `FAIL:exit=<codi>` ✔.
- `waitForFile`: si el contingut comença per `FAIL` → rebutja **de seguida** (no espera el timeout) ✔.
- Validat a mà: amb BOM, ffmpeg troba `…colònies…`, genera `_REV.mov` (5,4 MB, 25 frames, 1,00s)
  i escriu `OK` al `.done` ✔.

## 🔴 FIX 2 — `checkClipExists` sempre deia "no existeix" (+ ERROR vermell)

`15_FFmpeg_Logic.checkClipExists` cridava `IO.stat`, que **no està exposat pel bridge JSX**
(`💥 [JSX ERROR]: ERR:IO.stat is not a function` a cada crida) → sempre retornava `false` →
els fitxers ja generats (`_REV.mov`, etc.) **no es reutilitzaven mai** i es tornava a llançar ffmpeg.

**Fix:** s'usa l'àtom existent `IO.listFolder` (→ `scanDirectory` amb `[{name,path,size}]`) i es
comprova nom + `size > 0` ✔. Sense JSX nou i sense falsos positius com `IO.exists` en UNC ✔.

## 🔴 FIX 3 — TEMA-TÍTOL GRAN col·locat DUES VEGADES

**Confirmat al log:** `🎯 [Titol] 2 Tema‑Titol(s) gran(s): 01@00.01 (id=601135) · 02i@00.01 (id=601130)`
i tots dos **al mateix lloc**: `1/2 … → 0.40s (inici del bloc)` i `2/2 … → 0.40s (marcador 2I a 0 →
inici del bloc)` → el segon tapava el primer ✗.

**Causa:** els dos ítems del bloc (`02`, `02i`) no tenen marcador propi utilitzable (l'únic és a 0)
→ `markerTimeFor()` retorna `null` per als dos → tots dos cauen a `startOfBlock` (0,40 s) ✗.
A més, un dels candidats era d'un altre ítem (`01`, wott d'una escaleta anterior) ✗.

**Fix (`placeChyronTitol`):** es precalcula la posició real de cada candidat i, si dos cauen a la
mateixa posició (±0,05 s):
- es prefereix el de l'ítem que **TÉ marcador** a la seqüència (descarta el wott forà) 🔁;
- si cap en té, es queda el primer i es descarta el segon ⏭️ (amb WARN al log) 🛡️.
El càlcul del `freeze` ara surt directament de la llista filtrada (més simple i sense recalcular marcadors).

**Cache-busters:** `flow_chyrons.js?v=31` · `15_FFmpeg_Logic.js?v=7` · `flow_render.js?v=22`.

**Harness:** `=== SYNTAX: 42 OK / 0 FAIL ===`

**Pendent:** validar en directe a Premiere (COL·LOCAR → ha de sortir 1 sol Tema-Títol gran, i el
titulillo invertit sense esperes de 3 min).

## 🟡 Nota oberta (per a una altra sessió)

El manifest del bloc TNC V1 (`TNC_V1.fastpass.json`) apunta a
`escaletaFile = 20260921_142541_TN_COMARQUES_V2_P2_foto_RAIM__intro__ELS_ELABORADORS_DE_CAVA_ES_DEFENSEN.json`
mentre el bloc és `EMPRESES DE LLEURE I ALTRES PREOCUPATS A LA CERDANYA` → **cal revisar** si el
manifest s'omple amb l'escaleta equivocada (afecta la llista de chyrons del bloc i el wott `01` forà).

## 🟢 FIX 4 — Punt d'entrada del CONDUCTOR: 7:06 → **6:16**

**Petició:** el conductor ha d'entrar a 6:16 (6,64 s) i no a 7:06 (7,24 s).

**Causa:** `placeChyronConductor` calculava el conductor com `ttPlaceTime + DUR_TEMA_TITOL`
(6,24 s = 6:06) on `ttPlaceTime = marcador + tc del nom`. Però quan l'ítem de plató **no té
marcador propi** (marcador a 0), `placeChyronTitol` col·loca el Tema-Títol a **l'inici del bloc**
(0,40 s) i NO a "marcador + tc" (1,00 s) → el conductor sortia 0,60 s tard:
`1.00 + 6.24 = 7.24s` ✗ en lloc de `0.40 + 6.24 = 6.64s` ✔.

**Fix (`placeChyronConductor`):** nova variable `ttHasRealMarker = (targetTime >= 0.5)`.
- Amb marcador propi (≥ 0,5 s) → es manté "just després del Tema-Títol real" (`ttPlaceTime + 6.24`) ✔.
- Sense marcador propi → s'ignora el `ttPlaceTime` inventat i s'usa la branca clàssica
  `clipStart + MARGEN_INICIO + DUR_TEMA_TITOL` = 0 + 0,40 + 6,24 = **6,64 s (6:16)** ✔.
Log nou: `[Conductor] L'item de plato no te marcador propi: … el conductor NO el seguira`.

⚠️ Efecte col·lateral buscat: `📐 [Conductor] instant base per als chyrons següents` passa de
7,24 s a **6,64 s**, així que els chyrons "màgics" que es pengen d'aquest instant també van 0,60 s abans.

**Cache-buster:** `flow_chyrons.js?v=32` · **Harness:** 42 OK / 0 FAIL.


## 🟢 FEATURE 6 (CORREGIT) — **ORDRE OFICIAL** de resolució de l'escaleta

> ⚠️ 2026-09-22 (correcció de l'usuari): l'ordre NO és "FOTO primer". Ordre oficial:
> **1)** escaleta del NOSTRE bloc → **2)** escaleta d'un bloc **POSTERIOR** del mateix dia i programa
> (que ja conté el nostre bloc: se n'extreuen els ítems amb `getLinesForBlock`) → **3)** **FOTO** via
> API de digition (`escaleta_on_demand_*`) → **4)** avortament amb el motiu real.
> **MAI** una escaleta d'un bloc ANTERIOR (no té els nostres ítems: el tema s'inventava i acabava
> en paraula reservada INTRO → avortament silenciós).
>
> Implementació:
> - `_escaletaFromLaterBlock(ctx, datePrefix)` (nou): llista el NAS amb `_listEscaletas`, filtra
>   mateix dia + mateix programa + bloc `> nostre` (via `extractBlockIdFromFilename`), agafa la MÉS
>   RECENT i la copia al directori del projecte.
> - `_runNew`: `escaletaOk` = (és de la FOTO) o (del nostre bloc o d'un de posterior, del dia).
>   Si no → pas 2 → si no → `_photoEscaleta` (pas 3) → si falla, avortament amb motiu.
> - `4_Context._onMainClick` (estat ESPERANT sense escaleta): primer intenta el bloc posterior i,
>   només si no n'hi ha, fa la FOTO; després recalcula i executa si ja és accionable.
> - Cache-busters: `flow_mainButton.js?v=15` · `4_Context.js?v=16`. Harness 42 OK / 0 FAIL.

## 🟢 FEATURE 6 (v1, superat per la correcció de dalt) — FALLBACK FOTO automàtica

**Petició (usuari):** si no hi ha escaleta del bloc escollit, la extensió ha de fer ella mateixa
una FOTO (el mateix que el botó FOTO) i fer-la servir. Carregar escaletes d'un altre bloc o d'un
altre dia NO serveix i empitjora les coses → fora.

**Implementació:**
1. `flow_mainButton._photoEscaleta(ctx)` (nou helper): crida `EscaletaReader.fetchNewEscaleta(
   escaletaId, dateDir, progData.archivo, bloque, folderDest)` — exactament el mateix que el botó
   FOTO — amb guarda de 180 s. Retorna `{ok, filename, error}`.
2. `_runNew`: **guarda de bloc/dia** just després de carregar l'escaleta:
   - `escEsDelBloc`: el nom ha de contenir `_<BLOC>_` (o ser `escaleta_on_demand_*`, que per disseny
     és del bloc actiu).
   - `escEsDelDia`: el nom ha de contenir el prefix de la data de treball (o ser on_demand).
   - Si no es compleix (o el JSON no carrega) → **FOTO automàtica** i es torna a carregar;
     si la FOTO falla → avortament amb el **motiu real de digition** al log i al panell.
3. `4_Context._onMainClick`: si el botó està en estat **ESPERANT** precisament perquè no hi ha
   escaleta vàlida (`semaforo.esc.complete === false`), el clic fa la **FOTO automàtica**, recalcula
   l'estat i, si ja és accionable (NEW/UPDATE/GO/LOAD), executa el flux directament. Abans el clic
   només mostrava un missatge.

**Cache-busters:** `flow_mainButton.js?v=14` · `4_Context.js?v=15` · Harness: 42 OK / 0 FAIL.

## 🟢 FEATURE 7 — Estat BUSY del botó MAIN + instrumentació de l'arrencada

**Petició:** el panell triga a estar operatiu quan s'arrenca de zero. (1) El botó MAIN ha de
mostrar un estat d'espera tipus BUSY fins que hi hagi un estat vàlid; (2) revisar/optimitzar
l'arrencada.

**Implementat:**
1. `Context.setMainBusy(text, title)` (nou): posa `#btnMainAction` a `⏳ ARRENCANT...`, `disabled=true`
   i tooltip explicatiu. `updateButton()` l'apaga sol (`_mainBusy = false`) quan pinta el primer
   estat real (NEW/UPDATE/ESPERANT/…).
   S'aplica a l'inici del bootstrap de `main.js` i, si el motor JSX no carrega, es queda en
   `❌ SENSE MOTOR` amb el motiu.
2. **Instrumentació** (per saber on es va el temps): `⏱️ [BOOT]` amb les fases —
   motor JSX · comprovació de frescor · `Context.init` (config + 1r checkContext) · total.
   Al final es mostra `⏱️ Panell a punt (X s)` a la barra d'estat.

**Anàlisi prèvia (sense números encara):**
- La llista de **conductors** ja està optimitzada (2026-09-16): `cep.fs.readdir` + caule 10 min +
  timeout 8 s, amb el fallback JSX (que obria CADA .mov per xarxa) només si no hi ha cap
  conductor del programa. NO és el coll d'ampolla.
- Els sospitosos: (a) `$.evalFile` de ~45 mòduls JSX; (b) el **primer `checkContext`** amb
  escanejos al NAS (escaletes/media/wotts/portades) — del log d'avui: ~5 s;
  (c) lectures de NAS via JSX (mono-fil): Profile.json, llistats, etc.
- **Propostes** (pendents de confirmar amb els ⏱️): passar les lectures de NAS a `window.cep.fs`
  (Brain) en lloc de JSX; pintar l'estat del botó amb una fase ràpida i deixar la resta de
  l'escaneig en segon pla; cachejar el llistat de la carpeta ESCALETES per sessió.

**Cache-busters:** `main.js?v=51` · `4_Context.js?v=17` · Harness 42 OK / 0 FAIL.

## 🟢 VERIFICACIÓ — La FOTO d'escaleta del bloc V3 (21/09) **FUNCIONA**

Al provar "AHIR + TNC V3" l'usuari va veure que *"el semàfor canvia però no sembla que es generi
la nova escaleta"*. Verificat: **sí que es genera**, i a més és la bona.

- Fitxer: `...\PROVES\02_COMARQUES_PROJECTES\2026_09_21\escaleta_on_demand_1790065796928.json`
  (72.887 bytes, 22/09/2026 10:29:56).
- Contingut comprovat:
  - `cleanFeed.titol` = **"TN COMARQUES [senyal net]"**;
  - `cleanFeed.clips` = **V1, V2 i V3** — el V3 amb
    `in 14:20:46 → out 14:25:15`, `titol: TN_COMARQUES_V3_TE_santa_TECLA__intro__PREGONERS_TECLA_I_10_ANYS_DE_GENUINE`,
    `ready: true`. És exactament el que el NAS no tenia (allà el V3 era el JSON d'error de 209 bytes).
  - `escaleta.liniesEscaleta` = les línies de l'escaleta.
- **On mirar**: NO al NAS (`...\VERTICALITZACIO_INFORMATIUS\ESCALETES\` segueix amb el JSON d'error),
  sinó al **directori del projecte**. `EscaletaReader.findInFolder` **prioritza `escaleta_on_demand_*`**
  per sobre de les còpies del NAS (verificat al codi) → el flux la farà servir.

**Millores perquè no torni a semblar que "no passa res":**
- `_photoEscaleta` ara mostra status verd `📷 Escaleta nova guardada: <fitxer>` i logueja la ruta local.
- Després de la FOTO es comprova que la nova escaleta **contingui el bloc demanat** (llegeix
  `cleanFeed.clips`) i ho canta: `✅ [FOTO·auto] Conté el bloc V3: … (14:20:46 → 14:25:15)` o avisa.
- `flow_mainButton.js?v=16`.

**Nota:** el log no va mostrar les línies de la FOTO perquè es va llançar com a primera acció
després de recarregar el panell (abans que existeixi el fitxer de log) → les línies queden al
buffer. Amb el status verd a pantalla ja no cal endevinar-ho.

## 🔴 FIX 8 — Per què NO es creava el projecte del V3 (tema "INTRO")

**Diagnòstic (del log VIU de la sessió, `_keyframe_trace.log` a la carpeta de l'extensió — el de
`PROVES\FASTPASS.log` només s'escriu quan hi ha projecte assignat, per això quedava congelat):**

```
10:39:36 [dateDir] Data de treball: 2026_09_21 (fixada a checkContext)     ← AHIR ✔
         📖 [ER:IO] Llegint JSON: …\2026_09_21\escaleta_on_demand_1790065796928.json
         ✅ [ER:IO] JSON parsejat. Blocs cleanFeed: 3
         📁 [ER:IO] Escaleta local trobada: escaleta_on_demand_…json [FOTO]  ← s'usa, amb prioritat
         🔍 [ER:Bounds] getLinesForBlock: target="v3", total lines=121
         🔍 [ER:Bounds] Filtered count per bloc V3: 3
         ✅ [ER:Bounds] Bloc V3: bloc complet (3/3 ítems emesos, darrer: 17)  ← bloc OK
         🏷️ [Theme] Tema extret dels chyrons (fallback): "INTRO"
         ⛔ [NOU] No es crea el projecte: tema no vàlid (INTRO).              ← AQUÍ S'ATURA
```

→ **L'escaleta de la FOTO funciona perfectament** (es fa servir, porta el bloc V3 i el bloc surt
complet). El que falla és **l'extracció del TEMA**: per al V3 retorna `INTRO` (paraula reservada)
perquè no troba cap ítem estructural amb títol vàlid i cau al fallback dels chyrons → la guarda
anti-projectes-genèrics avorta (per disseny). El semàfor torna a vermell perquè, en avortar,
es recalcula l'estat del dia (HOY).

**Fix:**
1. **Fallback del tema des de l'escaleta**: si el tema és buit o reservat, es recupera del
   **títol del bloc** a `cleanFeed.clips[]` seguint la convenció
   `…_<BLOC>_…__intro__<TEMA>` → `PREGONERS TECLA I 10 ANYS DE GENUINE` (mateix criteri que
   V1/V2, que sí que funcionaven).
2. Corregit el meu diagnòstic anterior, que deia "l'escaleta és d'un altre bloc" per a les
   `escaleta_on_demand_*` (fals: són del bloc actiu per disseny).

**Cache-buster:** `flow_mainButton.js?v=17`.

## 🔵 AUDITORIA — Text "raro" al botó IPD

**Queixa:** *"el botón IPD sigue mostrando un texto raro justo después de pulsarlo"*.

**Revisat:** `index.html`, `style.css` i tots els JS (`main.js`, `flow_graphics.js`, `flow_markers.js`).

**Conclusió:** cap codi escriu l'etiqueta del botó IPD. És estàtic:
`<button id="btnGrafIpd" class="secondary" title="…">IPD</button>`. Tampoc hi ha CSS (`::after`,
`::before`, `content:`) que hi afegeixi text. L'únic botó amb mecanisme d'intercanvi d'etiqueta és
**Doble Pantalla** (`_dpBtnSet`/`_dpBtnReset`, arreglat el 21/09).

**L'únic text "estrany" associat al botó IPD era el seu `title` (tooltip), llarg i amb
`Ctrl+clic … (marcador IPD → següent estructural)`** — apareix just després de clicar (el cursor
es queda a sobre).

**Canvis:**
- Tooltips de la tira GRÀFICS escurçats i homogenis (IPD, Gràfica, Doble Pantalla, Mapa, Tòtem).
- `_dpBtnReset`: el fallback de l'etiqueta passa de `'🪟🪟'` (emoji que pot sortir com a quadre) a `'DP'`.
- `flow_graphics.js?v=9`.

## 🔴 FIX 9 — Les línies ⏱️ [BOOT] no apareixien enlloc (es descartaven)

**Queixa:** *"No he encontrado ninguna línea de BOOT para optimizar el inicio."*

**Causa:** `utils.log` només escriu si hi ha ruta de log:
```js
var _logPath = this._debugLogPath || this._ensureExtLogPath();
if (_logPath) { … }        // si no hi ha ruta → el missatge es DESCARTA (ni tan sols es bufferitza)
```
I `_ensureExtLogPath()` només resolia la ruta amb `window.location.href` → **durant l'ARRENCADA del
panell encara no està resolta** → ruta null → **totes les línies `⏱️ [BOOT]` (i la resta de logs
previs al flux) es perdien** ✗. Verificat: a `_keyframe_trace.log` no n'hi havia cap, i el fitxer
començava directament amb el flux (10:55:34).

**Fix:** `_ensureExtLogPath` ara prova **primer la ruta nativa de l'extensió**
(`csInterface.getSystemPath(SystemPath.EXTENSION)`, el mateix mètode que fa servir `main.js`) i deixa
`window.location.href` com a fallback.

**On mirar ara:** `C:\Users\gonz_agu\AppData\Roaming\Adobe\CEP\extensions\FAST_PASSS\_keyframe_trace.log`
(les 6 primeres línies), i a partir de CREAR/ACTUALITZAR continua a `PROVES\FASTPASS.log`.
El panell també mostra `⏱️ Panell a punt (X s)` a la barra d'estat.

**Cache-buster:** `utils.js?v=13`.

### Addendum (2026-09-22, tras "sigue sin aparecer ningún BOOT")

Se deja de depender de `utils.log` para el timing de arranque: `main.js` escribe **directamente**
con `window.cep.fs.writeFile` un fichero propio, en DOS destinos:

1. `<carpeta de l'extensió>\_boot_timing.log` → `…\Adobe\CEP\extensions\FAST_PASSS\_boot_timing.log`
2. `C:\temp\_boot_timing.log` (còpia, per si la ruta nativa fallés)

Se reescribe en cada arrencada (no s'acumula), amb una línia per fase:
`main.js: arrencada` · `ruta de l'extensió resolta` · `motor JSX a punt` ·
`comprovació de frescor JSX (N ms)` · `Context.init (config + 1r checkContext) (N ms)` ·
`ARRENCADA COMPLETA` (+ els errors, si n'hi ha).

Comprovat que cap dels dos fitxers existeix encara → el codi nou no s'ha executat (cal **recarregar
el panell**: tancar i reobrir, o Ctrl+R amb el focus al panell).

**Cache-buster:** `main.js?v=53`.

## 🟢 OPTIMITZACIÓ 10 — Arrencada: 6,2 s → (esperat) ~1,3 s

**Mesurat** (`_boot_timing.log`, 11:05:44):

```
+23 ms     main.js: arrencada
+39 ms     ruta de l'extensió resolta
+196 ms    motor JSX a punt (jsx_BOOTSTRAP)          ← 157 ms, molt ràpid
+306 ms    comprovació de frescor JSX (106 ms)
+6181 ms   Context.init (config + 1r checkContext) (5863 ms)   ← 94% del total
+6185 ms   ARRENCADA COMPLETA
```

I dins de `Context.init` (timestamps de `_keyframe_trace.log`):
- `[SCAN:media]` ≈1 s (11:05:39→11:05:40)
- **`[SCAN:wotts]` ≈4 s** (11:05:40→11:05:44) amb 69 wotts ← el coll d'ampolla
- `[COND] Llista conductores: 22 fitxers en 3 ms` ← ja optimitzat
- El **poll de cada minut** paga ≈9 s (11:06:38→11:06:47) ✗

**Causa:** `Utils.readFolder` enviava **SEMPRE** les rutes UNC per JSX
(`IO.scanDirectory` → obre CADA fitxer per xarxa per llegir `File.created`) — està documentat al
propi codi (fix del 2026-09-07, filtrat per data de creació).

**Fix (REVERTIT 2026-09-22 11:15 — va trencar la col·locació de wotts):** es va aplicar la via ràpida
(`cep.fs.readdir` + `cep.fs.stat`) també a UNC, però en aquesta màquina **`cep.fs.stat` sobre UNC no
dóna `creationTime`** → `created` quedava buit → `filterByWorkDate` descartava TOTS els fitxers:

```
[SCAN:wotts]    Filtre per data projecte 20260921: 69 -> 0  (NO datables descartats: …)
[SCAN:portades] Filtre per data projecte 20260921:  9 -> 0  (NO datables descartats: …)
```

→ cap rètol importat/col·locat (les 6 fases de chyrons acabaven en 0,4 s sense res a fer).

**Revertit** a la via JSX (correcta, lenta) ✔ + nota al codi: abans de reintentar-ho cal **verificar
que `cep.fs.stat` sobre una ruta UNC retorna `creationTime`**.

**Cache-buster:** `utils.js?v=15`.

## 🟢 FEATURE 11 — F7·Cobertura de marcadors (donapas `dp` i connexions `dir`)

**Problema real (TN_MIGDIA V1, 21/09):** el bloc té 8 wotts ✔ (Tema-Títol, **Firma**, **donapas
`02dp` Directe**, **`02dp` Enviat**, portades, Nomcarrec…) però a la seqüència només hi havia els
marcadors **`[1, 2, 223]`** → l'ítem **`02dp` (DONA PAS MADRID)** no en tenia → els seus rètols
(Enviat, Directe, portades, Tema-Títol) quedaven sense àncora i no es col·locaven; i el Tema-Títol
del `02dp` queia al marcador base `2` → **107,88 s** (posició equivocada).

**Fix — nova fase F7·Cobertura** (`flow_markers.js`, cridada al final de `enforceMarkerOrder`/F6):
- Llegeix l'escaleta del bloc (`loadAssemblyContext` → `_classifyItems`) i els marcadors actuals.
- Per a cada ítem que **hauria** de tenir marcador (estructurals + els "sense hora" que es dedueixen)
  i **no en té**, calcula la posició **interpolada** entre els veïns d'escaleta que sí en tenen
  (si només hi ha un veí: ±0,5 s) i el crea amb `Markers.placeByPrefixes` (àtom existent).
- **Només AFEGEIX**: no mou, no renombra i no esborra cap marcador existent → no pot trencar res.

Log: `🛡️ [F7·Cobertura] Ítems SENSE marcador: 02dp@…s, 02dir@…s` +
`🛡️ [F7·Cobertura] Afegits N marcador(s). ✓ FINALITZAT.`

**Cache-buster:** `flow_markers.js?v=25` (v24 → F7 no s'executava mai: vegeu baix).

### 🐞 Bug de la v1 de F7 (corregit)
`enforceMarkerOrder` (F6) tenia un **`return` anticipat** quan l'ordre ja era correcte:
```js
if (placements.length === 0) { log('🟢 [F6·Ordre] Ordre correcte. ✓ FINALITZAT.'); return; }
```
i la crida `await this.ensureMarkerCoverage()` havia quedat **després** d'aquest `return` → com que
"ordre correcte" és el camí NORMAL, **F7 no s'executava mai** (confirmat al log de l'11:27:19: F6
acaba amb "Ordre correcte" i cap línia `🛡️ [F7·Cobertura]`).

**Fix:** cridar F7 **també** en el camí del `return` (i mantenir-la al final del camí amb correccions).

### Dada del mateix log (11:24:46)
El flux va fer servir l'escaleta del **bloc posterior** `20260921_150100_TN_MIGDIA_V4_LEAD_GENESI…`
per al bloc V1 demanat → el fallback nou (pas 2: blocs posteriors) funciona ✔.

## 🟢 FEATURE 12 — Textos curts al botó MAIN (no deformar el botó)

Petició: que el botó MAIN mantingui forma i mida en arrencar, i un "ACTUALITZAR" més pulit.

- Estat d'espera: `⏳ ARRENCANT...` → **`ESPERA`** (el tooltip explica què passa).
- Motor JSX fallit: `❌ SENSE MOTOR` → **`ERROR`**.
- `ACTUALITZAR` → **`ACTUAL.`** (el botó és quadrat: els textos llargs l'embrutaven).

**Cache-busters:** `4_Context.js?v=18` · `main.js?v=54`.

## 🟢 FEATURE 13 — "Sempre hi ha d'haver titulillo": omplir els buits de V5

**Petició:** quan el Tema-Títol gran entra tard (el seu ítem és a mig bloc), la pista de Tema-Títol
(V5) queda buida al principi. Cal que hi hagi SEMPRE la identitat del programa: **buscar zones
buides de V5** i, si n'hi ha una abans d'un Tema-Títol, col·locar-hi el titulillo des de 00:10 fins
al gran, amb el **congelat** per allargar-lo i el **vídeo en revers** per fer la transició.

**Implementat** (`flow_chyrons.js`, fase 7 de `placeChyronTitol` → `_fillTitulilloGaps`):
- Per a cada Tema-Títol gran col·locat, calcula l'inici del buit (final de l'últim clip de V5 que
  comença abans del gran; si no n'hi ha, inici del bloc + 0.40s).
- Si el buit fa **≥ 2,5 s**, el reomple amb la seqüència:
  `[titulillo animat] → [congelat estirat] → [titulillo invertit] → [Tema-Títol gran]`.
  - Titulillo animat a l'inici del buit (`Clips.insert` + `Clips.endAt`).
  - Congelat: `Render.snapshot` net del titulillo (inserit temporalment a TC 10:00) + PNG importat a
    CHY i estirat fins al revers (mateixa tècnica que `_freezeTemaTitol`, però amb desplaçament =
    durada del titulillo, no 8 s).
  - Titulillo INVERTIT (`_ensureReversedTitolPetit`, ffmpeg) just abans del gran = transició.
- **Només actua sobre zones buides de V5**: no trepitja cap clip existent.
- Si falta la versió invertida o l'snapshot falla, ho diu al log i continua (mai avorta la col·locació).

**Cache-buster:** `flow_chyrons.js?v=34`.

**Per validar:** recarregar panell → COL·LOCAR al projecte del TN_MIGDIA (on el gran entrava a
107,88s) → a V5: titulillo a 0,40s + congelat estirat + revers just abans del gran.

### Ajustos de 1 frame (2026-09-22, post-prova d'usuari)
- El titulillo **no s'estira** més enllà de la seva durada real → acaba `gapStart + durP - FRAME`
  (abans s'estirava i el darrer frame es veia buit → "desapareixia" un moment).
- El **congelat** entra 1 frame abans (`freezeStart = gapStart + durP - FRAME`) → arrenca exactament
  on acaba el titulillo (abans quedava un forat d'1 frame).
- `FRAME = 0.04` (1 frame @25fps). Cache-buster: `flow_chyrons.js?v=35`.

## 🟢 FEATURE 14 — REMAPATGE DE PISTES (evitar col·lisions gràfics ↔ títols)

**Motiu:** en col·locar els grafismes xocaven a V6 amb els chyrons. Nou mapa (acordat amb l'usuari):

| Funció | Abans | Ara |
|---|---|---|
| MP4 | V1 | **V1** |
| (intocable) | V4 | **V2** |
| fondos | V2 | **V3** |
| graf | V3 | **V4** |
| **grafismes** | V3 (i xocaven a V6) | **V5** |
| tema + tematitol | V5 | **V6** |
| chyrons | V6 | **V7** |
| lloc + llocdata | V7 | **V8** |
| trad | V9 (TNs) / V8 (altres) | **V10 / V9** |

**Tot és configuració** (verificat: el codi només té el `1` del MP4 fix, que no canvia):
- `Profile.json` (dins l'extensió): 4 blocs `estructuras.*.tracks` amb els nous números i la clau
  nova **`v_graficos`** (V5).
- `11_Configuracio.js`: `graficos: (raw.v_graficos !== undefined) ? raw.v_graficos : raw.v_graf`
  → els grafismes tenen pista pròpia i ja no poden xocar amb els chyrons; fallbacks del fitxer
  alineats amb el nou mapa.
- JSON validat (`ConvertFrom-Json` → OK, TNs: mp4=1 fondos=3 graf=4 GRAFICOS=5 tema=6 chyrons=7
  lloc=8 trad=10).

⚠️ El .prproj base ha de tenir la pista nova (9 de vídeo) amb el mateix ordre: si no, l'extensió
apuntaria a pistes desplaçades. Fer els dos canvis alhora.

### CORRECCIÓ del mapa (2026-09-22, indicada per l'usuari)
Mapa FINAL acordat:
```
V1: Vídeo (mp4)
V2: Màscara (PROTEGIT)
V3: Grafismes + Fondos  ← "Graf i grafismes són el mateix"
V4: Vídeo 1 (Doble Finestra / Mapa)
V5: Vídeo 2 (Doble Finestra)
V6: Tema-Títol + Titulillo
V7: Nom-Càrrec…
V8: Lloc-Data, Enviat…
V9: Mosa (PROTEGIT)
```
Aplicat a `Profile.json` (4 blocs) i `11_Configuracio.js`: **v_graf = v_graficos = v_fondos = 3**,
tema/tematitol = 6, chyrons = 7, lloc/llocdata = 8. JSON validat:
`TNs: mp4=1 fondos=3 graf=3 graficos=3 tema=6 chyrons=7 lloc=8 trad=10`.

**PENDENT (proper pas):** el flux de **Doble Finestra / Mapa** encara aprofita **V1** per al fons →
ha de passar a **`fondos` (V3)**, i les dues còpies de vídeo han d'anar a **V4 i V5** (caldrà afegir
`v_video1: 4` i `v_video2: 5` a Profile.json + els àlies `video1`/`video2` a `Config.get()`).

**PREGUNTA OBERTA:** V9 és Mosa (protegit) → on han d'anar les **traduccions** (`v_trad`)? Ara està a
10 (TNs) / 9 (altres) i podria xocar amb la Mosa.

**Cache-busters:** `flow_chyrons.js?v=35` · `11_Configuracio.js?v=18`.

### Config FINAL aplicada i validada (2026-09-22, 2a correcció d'usuari)
```
V1: Vídeo (mp4)        v_mp4: 1
V2: Màscara (PROTEGIT) (sense clau)
V3: Fondos + Graf/grafismes   v_fondos = v_graf = v_graficos: 3
V4: Vídeo 1 (Doble Finestra/Mapa) + TRADUCCIONS   v_video1: 4 · v_trad: 4
V5: Vídeo 2 (Doble Finestra)   v_video2: 5
V6: Tema-Títol + Titulillo    v_tema: 6
V7: Nom-Càrrec…        v_chyrons: 7
V8: Lloc-Data, Enviat… v_lloc: 8
V9: Mosa (PROTEGIT)    (sense clau)
```
Validat: `TNs: mp4=1 fondos=3 graf/graficos=3/3 video1=4 video2=5 tema=6 chyrons=7 lloc=8 trad=4` ✔
(igual a Sumari Matins i User Defined). Àlies nous a `Config.get()`: `video1`, `video2`;
`graficos` llegit de la clau pròpia. Fallbacks d'`11_Configuracio.js` alineats. Sintaxi 42 OK / 0 FAIL.

**PENDENT (codi, proper pas)** — `flow_graphics.js` encara té números de pista fixos:
- Línia 517: `const T_V1 = 1;` (diagnòstic/CTI)
- Línia 562: `const T_V1 = 1, T_V2 = 2;` (PAS1: mou el MP4 V1→V2)
- Línia 705: `const T_V1 = 1;` (PAS3: **el fons va a V1** ← queixa de l'usuari)
- Línia 937: `_colocarFonsMapa(T_V1, sel, BG)` (el fons del MAPA també a V1)
→ Han de passar a la config: **fons = `fondos` (V3)**, i les dues còpies de vídeo a **`video1` (V4)**
i **`video2` (V5)**. Les línies 106/128 ja fan servir `cfg.tracks.video.fondos` (format 16:9).
És un redisseny del flux (mou/duplica clips i col·loca el fons), per fer amb el codi al davant.







**Per validar:** recarregar panell → regenerar marcadors (perquè F7 s'executi) → COL·LOCAR:
l'Enviat, el Directe i les portades del `02dp` han de col·locar-se, i el seu Tema-Títol ja no ha
d'anar a 107,88 s.









**Pendent de validar a Premiere:** AHIR → bloc V3 del 21/09 (el cas que fallava): ha de veure's
`📷 [FOTO·auto] Petició a l'API d'escaletes…` i, si digition dona escaleta, crear el projecte.
Si digition no la dona (com en el JSON d'error de 209 bytes), el motiu ha de sortir clar al panell.


## 🔵 DIAGNÒSTIC 5 — "Pulso AHIR i no passa res" (TN_COMARQUES V3 del 21/09)

**Resposta curta:** el mode AHIR **sí funciona** ✔ (el log diu `[dateDir] Data de treball:
2026_09_21 (fixada a checkContext)`), però el flux **avorta** perquè el bloc V3 no té escaleta
pròpia al NAS:

```
10:12:37 📡 [ER:IO] Cercant JSON per a: TN_COMARQUES/V3 [20260921]
10:12:37 ⚠️ [ER:IO] JSON descartat (no es escaleta): 20260921_144046_TN_COMARQUES_V3_TE_santa_TECLA__…
10:12:37 ℹ️ El JSON més recent no era una escaleta valida; s'usa: …V2_P2_foto_RAIM…   ← UN ALTRE BLOC
10:12:42 🏷️ [Theme] Tema extret dels chyrons (fallback): "INTRO"
10:12:42 ⛔ [NOU] No es crea el projecte: tema no vàlid (INTRO).
10:12:42 [dateDir] Data de treball: 2026_09_22 (HOY)
```

**Causa dels fets:**
1. El "V3" del 21/09 que hi ha al NAS **no és una escaleta**: és un **error de digition de 209 bytes**
   → `{"missatge":"Error","debugInfo":"No s'ha localitzat cap clean feed amb títol
   [TN COMARQUES [senyal net]] per la data/hora especificada [2026-09-21 14:40:46] …"}`.
   (Els fitxers bons d'aquell dia fan 72.512 - 132.600 bytes.) El codi el descarta correctament ✔.
2. Sense escaleta del V3, es fa servir la del **V2** (un altre sub-bloc) → `getLinesForBlock('V3')`
   no troba res → el tema cau al fallback dels chyrons = `"INTRO"` → i `INTRO` és a `RESERVED_THEMES`
   → la guarda anti-projectes-genèrics (`flow_mainButton.js:199`) fa `return` ✔.
3. Com que l'avortament no deia el motiu real, semblava que "no passava res".

**Millora aplicada (només diagnòstic, sense canviar el comportament):** en aquest avortament,
si l'escaleta usada **no és del bloc demanat**, el log i l'estat del panell ho diuen explícitament:
`Bloc V3: no hi ha escaleta propia al NAS (nomes d'altres blocs). Demana-la o treballa un altre bloc.`

**Acció per a l'usuari:** demanar/regenerar l'escaleta del V3 (TE santa TECLA) a digition ✔ — els
wotts del V3 (7 de 21/09) i el SRT V3 sí que existeixen ✔; només falta l'escaleta.

**Anomalia menor detectada** (pendent d'investigar): el log mostra
`📖 [ER:IO] Llegint JSON: …PROVES\02_COMARQUES_PROJECTES/2026_09_2120260921_142541_TN_COMARQUES_V2…json`
→ la ruta es compon sense separador entre `2026_09_21` i el nom del fitxer i amb `/` barrejat ✗.

**Harness:** 42 OK / 0 FAIL.

---

# SESSIÓ 2 · 2026-09-22 (segona tanda) — PENDENTS del handoff

Ordre seguit: (1) grafismes sense àudio → (2) titulillo de SALIDA fins al marcador →
(3) Doble Finestra/MAPA a la configuració general. **Harness: 44 OK / 0 FAIL**
(s'han afegit `js/logic/6_Clips_Logic.js` i `jsx/modules/7_KF.jsx` a la llista del harness).

## 🔇 FIX 15 — Els grafismes NO han de col·locar el seu àudio

**Problema:** en inserir un clip de vídeo amb pista d'àudio (grafismes `.mov`/`.mp4`, wotts),
Premiere el deixa **enllaçat**. `Clips.insert` (JSX) ja intentava esborrar l'àudio fantasma,
però **només mirava A1**: si l'àudio queia a A2/A3 (segons el *targeting* de l'operador) quedava
sonant damunt del programa.

**Solució (sense JSX nou)** — `Logic.Clips.insertNoAudio(itemName, track, start, end)`:
1. `Clips.insert` (átom existent).
2. `Clips.at` → índex del clip inserit.
3. `Clips.removeLinkedAudio` (átom existent que JA hi era i **no s'usava enlloc**): desenllaça el
   clip i elimina l'àudio enllaçat **a qualsevol pista** d'àudio.
4. Xarxa de seguretat: si encara queda un clip d'àudio amb el **MATEIX NOM** al mateix start,
   `Clips.remove(..., 'audio')` per índex. **Mai** es toca l'àudio del programa (noms diferents).

Usat a: `flow_mapa.js::_placeClips` (grafismes ZZZ_GRAFISME), `flow_retols.js`
(`_placeChyronsByType`, traduccions de `placeChyronTraduccio` i `placeChyronRepartir`).

⚠️ **Pendent de valorar:** `14_Assembly_Logic.js:717` (`runGuidedAssembly`) i `37_Muntatge.js`
insereixen wotts amb `Logic.Clips.insert` (sense neteja d'àudio) perquè allà hi ha *batching*
(`Utils.Batch`). Si l'usuari veu que encara sona algun wott, és el següent lloc a tocar.

## 🕳️ FIX 16 — Titulillo de SALIDA fins al TC del marcador

`_fillTitulilloGaps` (`flow_chyrons.js`) posava el revers a `[ttTime-durP, ttTime]`, on
`ttTime` = posició calculada del Tema-Títol gran = **marcador + tc del wott** (tc ≈ 1 s). Ara:
- `markerTimeForItem(item)` llegeix `Markers.get()` i emparella pel **prefix** del nº d'ítem
  (mateixa normalització que `placeChyronTitol`; s'ignora el marcador a 0).
- `endZone` = TC del marcador (o `ttTime` si l'ítem no en té) → **el revers acaba al marcador**.
- `zoneEnd = max(endZone, ttTime)` → el **congelat** s'estira fins al gran (no es deixa cap forat
  de `tc` segons abans del Tema-Títol). El revers el retalla pel davant (overwrite a V6).
- Log nou: `… revers · sortida fins al marcador de l'ítem 02dp @ 12.34s`.

## 🗺️ FIX 17 — Doble Finestra / MAPA amb les pistes de la CONFIG

`flow_graphics.js` tenia `T_V1 = 1` / `T_V2 = 2` / `T_V3 = 3` fixos. Ara tot surt de
`Config.get().tracks.video`:

| Punt | Abans | Ara |
|------|-------|-----|
| `_dpPaso0` (diagnòstic/CTI) | V1 | `mp4` (V1) |
| `_dpPaso1` (1a còpia) | V1 → V2 | `mp4` (V1) → **`video1` (V4)** |
| `_dpPaso2` (2a còpia) | V2 → V3 | `video1` (V4) → **`video2` (V5)** |
| `_dpPaso3` (fons PNG) | V1 | **`fondos` (V3)** |
| `_dpPaso4` (Motion) | V2/V3 | `video1` (V4) / `video2` (V5) |
| `runMapa` (MAPA ZOOM) | V1 → V2 + fons a V1 | clip → **`video1` (V4)** · fons → **`fondos` (V3)** |
| `_dpUnlockTracks` | V1-V4 | V1..**V5** (màx. de la config) |
| Preset DF | claus `v2`/`v3` | claus **`v`+nº de pista** (`v4`/`v5`) |
| `7_KF.jsx` sliderApply | re-aplica crops a `track 2 o 3` | re-aplica crops a **`track 4 o 5`** (fallback capa superior = V5) |
| `flow_mapa.js` | `TRACK_GRAF = 5` · `TRACK_FREEZE = 6` | `graficos` (**V3**) · `tematitol` (V6) — resolts de la config a `_flow()` |

⚠️ El `.prproj` base ha de tenir V4 i V5 lliures per a les 2 finestres (mapa final acordat).

**Cache-busters:** `6_Clips_Logic.js?v=6` · `flow_chyrons.js?v=36` · `flow_graphics.js?v=10` ·
`flow_retols.js?v=6` · `flow_mapa.js?v=14` (JSX `7_KF.jsx` es recarrega amb el panell).

## ✅ PER VALIDAR (a Premiere, després de RECARREGAR el panell)

1. **Grafismes:** 🎨 Gràfica (ZZZ_GRAFISME) → el clip entra a V3 **sense àudio** (cap clip nou
   a A1/A2). Log: `🔇 [Clips] insert sense àudio → V3@…`.
2. **Titulillo:** COL·LOCAR en un bloc amb el Tema-Títol gran tardà → el revers acaba al TC del
   marcador de l'ítem (i el congelat tapa fins al gran).
3. **Doble Finestra:** 🪟🪟 sobre un clip 16:9 → V4 + V5 amb les 2 finestres, fons a V3, audio del
   programa intacte a A1. MAPA 🗺️ → clip a V4 + fons a V3 (scale 48 / Y447).


---

# SESSIÓ 3 · 2026-09-22 (ajustos de la prova d'usuari)

**Harness: 44 OK / 0 FAIL.** Cache-busters: `flow_chyrons.js?v=37` · `flow_mapa.js?v=15`.

## 🎯 FIX 18 — El Tema-Títol GRAN entra EXACTAMENT al TC del marcador

**Símptoma (usuari):** «el TemaTitol no entra justo en el marker si no unos 10 frames más allá».

**Causa:** a `placeChyronTitol` la posició del gran era `marcador + tc del nom del wott`.
Els wotts reals del NAS porten `tc = "00.01"` (`Wott_MAT_v5_350_00.01_dona pas BCN
Cris_602444_Tema-Titol_….mov`) i `Utils.timeToSeconds("00.01")` = **1,00 s (25 frames @25fps)**
→ el gran entrava 1 s després del marcador.

**Fix:**
- `ttPos.time` = **TC del marcador** (l'IN del clip al marcador); el tc del wott ja **no se suma**
  (queda al log com a dada: `· tc wott 00.01 (1.00s IGNORAT: el gran va al marcador)`).
- `placeChyronConductor`: `ttPlaceTime = targetTime` (sense tc) → el conductor entra a
  `marcador + 6.24` just després del gran. Log: `· tc del wott 1.00s ignorat`.
- Efecte buscat: `_fillTitulilloGaps` i `_placeTemaTitolTransicions` pengen de `placeTime`, així
  que ara **el revers acaba exactament on arrenca el gran** (sense forat).

## 🎨 FIX 19 — El GRAF pren com a referència el CLIP a SUBSTITUIR (no el cabezal)

**Símptoma (usuari):** «el grafismo toma como referencia el cabezal, esto es erróneo: debe tomar
como referencia el clip seleccionado, que es el que está en V1 en la posición del CTI».

**Fix (`flow_mapa.js`):**
- Nou `_resolveRefClip(cti)` amb aquest ordre:
  1. clip de **V1 SELECCIONAT** (pista `tracks.video.mp4`);
  2. clip de **V1 que CONTÉ el cabezal** (si la selecció s'ha perdut);
  3. qualsevol altra selecció de vídeo.
  Retorna `{track, index, name, start, end, src}` i el log diu l'origen.
- `_flow`: `refSec = ref.start` → el material s'insereix **a l'IN del clip**, no a la posició del
  CTI. Sense clip de referència: avís al panell i s'atura (abans col·locava a la posició del CTI).
- `_placeClips(items, refSec, freeze, ref)`: **espai hàbil = el rang del clip de referència**
  `[start, end]` (abans: del CTI fins al final del clip de V1). El congelat també s'alinea a l'IN.
- `_itemAtCti`/`_freezeUnderCti` reben la posició de referència (ítem d'escaleta i congelat de
  sota el clip). Logs i comentaris actualitzats (ja no parlen de "cabezal").
- (2026-09-22, sessió 2) `TRACK_GRAF` = `tracks.video.graficos` (V3) i `TRACK_FREEZE` =
  `tracks.video.tematitol` (V6), resolts de la config a `_flow`.

**Per validar:** seleccionar el clip de V1 → 🎨 Gràfica → el grafisme ha de començar a l'IN del
clip i acabar (retallat) al seu OUT; el congelat de V6 ha de cobrir el mateix rang.


## 🎬 FIX 20 — El revers del titulillo, 1 frame a l'esquerra (alineació a la rejilla de frames)

**Queixa (usuari):** «el título con velocidad invertida que ponemos justo delante del TemaTítol de
1:21:17 debe estar 1 frame más a la derecha para quedar perfecto».

**Diagnòstic (amb dades reals del log + ffprobe):**

```
📌 [Titol] 02dp → 81,68s (marcador)          ← Tema-Títol gran (1:21:17)
🟢 titulillo ENTRANT → V6 @ 0,40s→1,38s
🧊 congelat estirat  → V6 @ 1,38s→81,68s
🔴 titulillo SORTINT → V6 @ 80,66s→81,68s    ← el revers
```

- El `_REV.mov` real fa **25 frames = 1,000 s** (mesurat amb `ffprobe`: 25 fps, 25 frames).
- El codi fa servir `durP = 1,02 s` (durada **estimada** per mida de fitxer: el DOM de Premiere
  no dóna `projectItem.duration` → `⏱️ 0 amb durada del DOM`).
- `endZone - durP` = `81,68 − 1,02` = **80,66 s = frame 2016,5** → **mig frame**! Premiere el
  snapeja cap enrere (2016 = 80,64 s) → el revers quedava 1 frame a l'esquerra del Tema-Títol ✗.

**Fix:** el IN del revers s'**alinea a la rejilla de frames** amb `Math.ceil()` y el final es manté
enganxat al gran:

```js
const reverseStart = Math.ceil((endZone - durP) / FRAME - 1e-6) * FRAME;   // 80,66 → 80,68
```

- `_fillTitulilloGaps` (cobertura, el cas que ell veu): el revers ara ocupa **80,68 → 81,68**
  = 25 frames exactes ✔ (coincideix amb la durada real del `_REV.mov`).
- `_placeTemaTitolTransicions` (fase 6, transicions): mateixa alineació i, a més, `insertTitol()`
  accepta ara un `endSec` → el revers s'ancora al Tema-Títol gran en lloc de `start + durP`
  (abans podia quedar 1 frame dins o fora del gran segons l'error de `durP`).
- Nova constant `REV_FRAME = 0.04` (1 frame a 25 fps) al capdamunt de `flow_chyrons.js`.

**Observació (no tocat):** el titulillo ENTRANT també calcula `gapStart + durP - FRAME` = 1,38 s
(mig frame). Amb el mateix `ceil()` quedaria 1,40 s = 25 frames exactes. Si en algun moment es veu
el mateix desajust a l'entrada, és la mateixa línia.

**Cache-buster:** `flow_chyrons.js?v=38` · **Harness:** 44 OK / 0 FAIL.


## 🔲 FIX 21 — El botó MAIN, SEMPRE el mateix quadrat 60×60

**Queixa (usuari):** «que el botón Main siempre tenga la misma forma cuadrada; es un poco feo que
al cargar la extensión aparezca con otra forma ajustada al texto».

**Causa (2 errors sumats, tots dos al JS):**

1. `4_Context.js` assignava la classe **`square-large`… que NO existeix al `style.css`**:
   `btn.className = 'square-large'` (setMainBusy i estats MASSA/ESPERANT) i
   `btn.className = 'square-large btn-new'` (NEW/UPDATE/GO/LOAD) → el botó **perdia la classe
   base `btn-big-sq`** (60×60) i, com que el contenidor `.setup-actions` és un flex column amb
   `align-items:center`, s'ajustava al text. Passava a l'arrencada (`ESPERA`) i en cada canvi
   d'estat ✗.
2. `updateButton()` hi posava estils **inline** `btn.style.width = "100%"` i
   `btn.style.minHeight = "60px"` → l'inline guanya sobre el CSS i el botó s'estirava al ample
   del contenidor ✗.

**Fix:**
- **`style.css`**: nova regla per al botó MAIN amb `width/height/min/max` + `!important`,
  `flex: 0 0 auto`, `box-sizing: border-box` i el text ajustat DINS
  (`padding:2px; font-size:10px; line-height:1.05; overflow-wrap:anywhere; overflow:hidden`).
  Així la forma la fixa NOMÉS el CSS i ni el JS ni el contingut la poden canviar.
- **`4_Context.js`**: eliminades les 5 assignacions de `className` (=`square-large`/`btn-new`) i
  els 2 estils inline de mida. `setMainBusy` ja no toca cap classe. Extres de neteja: el
  borde/color vermell de l'estat `LOCKED` es netegen quan es passa a un altre estat.
- Textos actuals que ara conviuen amb el quadrat: `NOU`, `CREAR`, `ACTUAL.`, `ESPERA`,
  `ERROR`, `AHIR`, `MASSA D'HORA`, `ESPERANT...`, `ESPERANT`, `BLOQUEJAT: <usuari>` (els llargs
  fan 2 línies).

**Validat (test headless amb Edge + el `style.css` real, `C:\temp\fp_btn_main.html`):**

```
"NOU"=60x60 · "CREAR"=60x60 · "ACTUAL."=60x60 · "ESPERA"=60x60 · "ERROR"=60x60 · "AHIR"=60x60
"MASSA D'HORA"=60x60 · "ESPERANT..."=60x60 · "ESPERANT"=60x60 · "BLOQUEJAT: AGUSINIO"=60x60
"ACTUALITZAR"=60x60 · AMB width:100% inline=60x60 · SENSE btn-big-sq=60x60 · LOCKED=60x60
```

**Cache-busters:** `style.css?v=56` · `4_Context.js?v=19` · **Harness JS:** 44 OK / 0 FAIL ·
**CSS:** 103 `{` / 103 `}` (balancejat).


## 🔍 DIAGNÒSTIC 22 — «Per què en el projecte actual falten marcadors?» (TNV V1, 21/09)

**Resposta curta:** no fallen els marcadors (F1–F6 fan la seva feina): **el bloc V1 del rundown
només té 1 ítem**. La resta del tema (donapas, diferit, IPD, peça) està a l'escaleta **sense
`agrupacio`** → `getLinesForBlock('v1')` no els veu → sense ítem no hi ha marcador.

**Proves:**

| Font | Evidència |
|---|---|
| Escaleta del 21/09 (189 línies) | agrupacions: **178 sense**, `\|\|`=1, `V`=1, **`v1`=1**, `v2`=2, `v3`=2, `v4`=4 |
| Línia `v1` única | `[04] 21:04:58 · EXPLICATIU BEGOÑA GÓMEZ - ROGER ROVIRA + Zapatero (2:29)` |
| Contrast V4 | `19dp · Donapas directe Nova York` **sí** porta `agrupacio: v4` |
| Log (13:52) | `getLinesForBlock: target="v1", total lines=189` → `Filtered count per bloc V1: 1` → `Bloc "V1" reconstruït: in=21:04:58 out=21:07:28 (1 línies)` → `Items: 1 estructurals, 0 gràfics` → `F1·OnAir 04: → 0.00s` |
| Snapshot | `MARCADORS_2026-09-22_1352.json` → `"count": 1` |
| MP4 del bloc | `mp4ExpandedInPoint=338 → 528` = 2:30 de bloc + 20 s de handles = 190 s (només l'explicatiu) |
| Contraprova | existeixen `Wott_TNV_v1_01Chy_…`, `Wott_TNV_v1_01dp_…` (×2) i la PORTADA → el motor de rótuls considera el `01Chy`/`01dp` **del bloc v1**, però l'escaleta no els agrupa |

**Nota secundària:** `escaleta_io.findLatest` (2026-06-29) **ignora el `blockId`** i agafa el JSON
més recent del programa → va carregar l'escaleta del V4 (`212528`) en lloc de la pròpia del V1
(`211523`). En aquest cas el resultat és el mateix (les dues tenen `v1`=1), però és un risc latent.

**Pendent de decisió de l'usuari:** (a) demanar a digition que la `agrupacio v1` inclogui els ítems
del bloc, (b) estendre el bloc amb els ítems de plató/diferit contigus o (c) usar els rótuls del bin
CHY (`Wott_[PROG]_vN_[id]…`) com a font de veritat. ⚠️ (b)/(c) canvien també el **rang del MP4 del
bloc** (2:30 → ~5:12 en aquest cas).

## 🆘 FIX 23 — Prohibit carregar subtítols d'un altre dia (SRT_FALLBACK)

**Queixa (usuari):** «¿Por qué en el proyecto actual me ha cargado unos subtítulos de ayer? Esto es
totalmente erróneo. Hay que eliminar esa posibilidad.»

**Causa:** `Scanner.srtFallback` tenia 4 nivells de relaxació i **dos sense filtre de data**:
- **N2** `prefix (qualsevol data)` ← el que va actuar
- **N4** `qualsevol .SRT de la carpeta`
Log real (TNC V1 del 22/09):
```
⚠️ [SCAN:media] Cap MP4/SRT amb data 20260922. Retornant buit (no es busca en altres dies) ✔
🚨 SRT_EMERGENCIA: 0 arxius de 15 min seleccionats
🆘 SRT_FALLBACK: N2 (prefix (qualsevol data)): 4 candidat(s) · triat
   "TN_COMARQUES_V1_intro__EMPRESES_DE_LLEURE_I_ALTRES_PREOCUPATS_A_LA_CERDANYA.srt" (20260921) ✗
```

**Fix (`Scanner.js`):**
- **Tots** els nivells exigeixen ara la **data de treball**: `delDia = srts.filter(ofDate)`.
  - N1: `{archivo}_{bloque}_` + data ✔ (com abans)
  - N2: qualsevol .SRT **de la data de treball** (era el N3)
  - **Fora**: «prefix (qualsevol data)» i «qualsevol .SRT de la carpeta» ✗
- Sense `dateDir` → **no es carrega res** (abans `ofDate` retornava `true` per a tot).
- Si no hi ha cap .SRT del dia: log explícit (`… N .SRT d'altres dies descartats. NO es carrega cap
  subtítol.`) i `flow_srt.js` ho diu al panell: `SRT: no hi ha cap .SRT del dia 2026-09-22 — no es
  carrega res`.
- El mecanisme principal (blocs de 15 min) **ja filtrava per data** (prefix
  `YYYY-MM-DD_Telenot_cies_[programa]_`) → no s'ha tocat.

**Cache-busters:** `Scanner.js?v=8` · `flow_srt.js?v=7` · **Harness:** 44 OK / 0 FAIL.


## ✅ DIAGNÒSTIC 22 — **DESCARTAT per l'usuari**: «era correcte»

L'usuari confirma que el bloc V1 del TNV del 21/09 (1 sol ítem amb `agrupacio: v1`) **és correcte**
→ 1 marcador era el resultat esperat. S'elimina la entrada `BLOC_V1_NOMES_1_ITEM` de
`.roo/features.json` i **no es canvia res de codi** (ni `escaleta_bounds.js` ni `escaleta_io.js`).
Es manté només com a nota històrica el DIAGNÒSTIC 22 d'aquest fitxer.

## ♻️ FIX 24 — El RESET de subtítols torna a BUSCAR els .SRT del tema

**Petició (usuari):** «el botón de reset de los subtítulos debería volver a hacer la búsqueda de los
srts del tema».

**Abans:** el botó central ♻️ (`btnSrtReset`) cridava directament `SrtEditor.resetToOriginal()` →
només restaurava la taula del SRT **que ja hi havia carregat** (i esborrava marcadors i clips de
subtítols de la seqüència). Si s'havia carregat un subtítol equivocat (p. ex. el d'AHIR), el reset
no el podia refrescar ✗.

**Ara** — nou `Workflow.Srt.runSrtReset()` (`flow_srt.js`):
1. `SrtEditor.resetToOriginal()` → taula sense edicions, sense marcadors i neteja dels clips de
   subtítols de la seqüència (com abans).
2. **Torna a buscar el .SRT del tema** amb el mateix mecanisme que el SCAN principal:
   - `Scan.mediaAssets(ctx, State.detectedTheme)` → carpeta de verticalització, prefix
     `{archivo}_{bloque}_` + **data de treball**, afinat pel tema detectat;
   - si no en troba: `Scan.srtFallback(ctx)` (ara **només del dia**, vegeu FIX 23);
   - → `SrtEditor.loadSrt(path)`.
   - Si no hi ha res del dia: `SRT reset · cap .SRT del tema amb data YYYY-MM-DD — no es carrega res`
     (mai subtítols d'un altre dia).
3. `main.js`: el botó passa a `callWorkflow('Srt', 'runSrtReset')`; tooltip del ♻️ actualitzat.

Logs nous: `♻️ SRT_RESET: reiniciant subtítols i tornant a buscar els .SRT del tema...`,
`🔎 SRT_RESET: buscant .SRT del tema ("…") · bloc V1 · data 2026_09_22`,
`♻️ SRT_RESET: <via> → <path>` i `✅ SRT_RESET: carregat a l'editor: <nom>`.

**Cache-busters:** `flow_srt.js?v=8` · `main.js?v=55` · **Harness:** 44 OK / 0 FAIL.


## ⚡ FIX 25 — Inversió PEREZOSA del titulillo (ffmpeg només si el revers s'usa)

**Petició (usuari):** «no hace falta enviar a invertir el vídeo del titulillo si no se va a
utilizar. Haz que se envíe a ffmpeg el titulillo solo cuando se necesite para colocarlo en el
timeline».

**Problema:** les dues fases que treballen amb el titulillo cridaven
`_ensureReversedTitolPetit(petit)` **al principi**, sempre:

- `_placeTemaTitolTransicions` (fase 6): invertia el titulillo encara que després no es col·loqués
  cap sortida (cas A amb **un sol** Tema-Títol gran → el bucle `b)` no fa cap volta útil) ✗
- `_fillTitulilloGaps` (fase 7): invertia encara que **no hi hagués cap buit** a cobrir (el gran ja
  entra a l'inici del bloc) ✗

I `FFmpeg.reverse` no és gratis: escriu un `.ps1`, llança `ffmpeg` i espera el `.done`
(~1-3 s + procés).

**Fix:** inversió **perezosa** amb cache per fase:

```js
let _revCache = null;
const getRev = async () => {
    if (_revCache === null) _revCache = await this._ensureReversedTitolPetit(petit);
    return _revCache;
};
```

- **Fase 6**: `getRev()` es crida dins del bucle `b)`, just abans de col·locar el revers
  (i només si `start >= clipStart + 0.10` i, pel primer gran, només en cas B). Si no hi ha cap
  revers a col·locar → **no es toca ffmpeg**.
- **Fase 7**: `getRev()` es crida a la secció 3, dins del bloc
  `if (reverseStart > gapStart + 0.20)`. El log de decisió (🕳️) ja no llegeix `rev.ok` (no es pot
  saber sense invertir): ara informa `[sense espai per al revers]` quan la geometria no hi deixa
  lloc.
- El **congelat** (snapshot PNG) no depèn del revers → segueix igual.
- Si el REV ja existeix de dies anteriors, `FFmpeg.reverse` el reutilitza (FIX 2) → ni tan sols
  llavors es llança ffmpeg.

**Efecte:** en blocs on el Tema-Títol gran entra a l'inici (sense buit) o en casos A d'un sol gran,
desapareix la inversió innecessària; quan cal, es genera **una sola vegada** (cacheada per fase).

**Cache-buster:** `flow_chyrons.js?v=39` · **Harness:** 44 OK / 0 FAIL.


## ⌨️ FIX 26 — La BARRA ESPACIADORA saltava al clip següent (focus enganxat als botons)

**Queixa (usuari):** «cuando he activado el slider de video, si clico espacio, solo sirva para
hacer PLAY/PAUSA. Debe haber un problema de foco que hace que al clicar, salta al siguiente clip
(quizás es el botón >)».

**Causa:** el navegador **"pulsa" l'element que té el FOCUS** quan es prem ESPAI (i ENTER). Al
panell no hi havia **cap** `blur()` ni `activeElement` (verificat amb grep: zero ocurrències al
projecte), així que el focus **quedava enganxat al darrer botó clicat**: el ▶ de la fila del
slider (`btnNextClip` → `callWorkflow('Cut','runNextClip')`, exactament "salta al següent clip")
i, per tant, cada ESPAI tornava a executar aquell botó ✗✗.

**Fix (`main.js`, secció 7 — handler global `keydown` en fase de CAPTURA):**
1. `ESPAI`/`ENTER` sobre `BUTTON`, `A` o `<input type=button/submit/reset>` →
   `preventDefault()` + `stopPropagation()` + **`blur()`** → no hi ha clic fantasma i el focus no
   s'hi queda.
2. `ESPAI` (fora de camps de text) amb **vídeo carregat al visor** → `SrtEditor.togglePlay()`
   = **PLAY/PAUSA** ✔ (inclou el cas del focus al `<input type="range">` del slider, que abans no
   feia res: ara fa play/pausa i no provoca scroll).
3. **No es toca** res dins de camps de text (`INPUT` de text, `TEXTAREA`, `SELECT`,
   `contenteditable`): allà l'espai és contingut i Enter confirma.

**Validat amb test headless** (`C:\temp\fp_space_test.html` + `fp_run_space.ps1`, handler idèntic):

```
1) ESPAI amb focus a ▶ btnNextClip   → prevented=true · focus→BODY · clicks ▶=0   ✔
2) ESPAI amb focus al slider (s/vídeo) → prevented=true · focus es manté · plays=0 ✔
3) ESPAI amb focus al slider (amb vídeo) → prevented=true · plays=1              ✔
4) ESPAI dins d'un camp de text      → prevented=false (l'espai és contingut)     ✔
5) ENTER amb focus a ▶ btnNextClip   → prevented=true · focus→BODY · clicks=0     ✔
```

**Cache-busters:** `main.js?v=56` · **Harness:** 44 OK / 0 FAIL.



## ⌨️ FIX 27 — Amb el slider actiu, l'ESPAI queda inhàbil (ara torna a fer PLAY/PAUSA)

**Queixa (usuari):** «ahora ocurre que cuando tengo el slider activo, la barra espaciadora está
inhàbil. Yo lo que querría es que se pueda seguir utilizando para hacer Play/Pausa».

**Causa:** al arreglar el clic fantasma (FIX 26) vaig exigir, per fer el play/pausa,
`document.getElementById('srtVideo').src && readyState >= 1`: si el **visor no té vídeo carregat**,
l'ESPAI quedava **interceptat però sense fer res** ✗ (inhàbil). I el visor no sempre té vídeo
(el flux del reencuadre no el carrega).

**Descoberta clau:** `SrtEditor.togglePlay()` **ja fa el Play/Stop REAL de Premiere** amb el QE DOM
(`js/editor/srt_editor.js`):
```js
callJSX("(function(){try{app.enableQE();qe.project.getActiveSequence().play();return'OK'}…)")   // PLAY
callJSX("(function(){try{app.enableQE();qe.project.getActiveSequence().stop();return'OK'}…)")   // PAUSA
```
→ no depèn del vídeo del visor: si el visor en té, a més l'alinea; si no, fa el play/stop de
Premiere i prou.

**Fix (`main.js`, secció 7):** la branca de l'ESPAI ja no mira el vídeo —
`e.preventDefault()` + `SrtEditor.togglePlay()` sempre (amb log `⌨️ [TECLAT] ESPAI → play/pausa`).
Es manté que als camps de text no s'hi toca res i que ENTER no fa play.

**Validat amb test headless** (`C:\temp\fp_space_test.html`, handler idèntic):

```
1) ESPAI amb focus a ▶ btnNextClip → prevented=true · focus→BODY · clicks ▶=0 · plays=1 ✔
2) ESPAI amb focus al slider (sense vídeo al visor) → prevented=true · plays=2 ✔ (abans: inhàbil ✗)
3) ESPAI sense cap control enfocat → prevented=true · plays=3 ✔
4) ESPAI dins d'un camp de text → prevented=false · plays=3 (no s'hi toca) ✔
5) ENTER amb focus a ▶ btnNextClip → prevented=true · focus→BODY · clicks=0 · plays=3 ✔
```

**Cache-buster:** `main.js?v=57` · **Harness:** 44 OK / 0 FAIL.

## ⌨️ FIX 29 — TROBAT el detall original: `app.setAppFocus()` al soltar el slider

**Pregunta de l'usuari:** «és rar perquè al principi funcionava bastant bé però hi havia vegades que
perdia foco. Pots revisar el codi del principi i veure si hi ha algun detall que fes perdre el foco?»

**Sí, hi era. Recerca a git (pickaxe `-S`) + `INFO/INFORME_REVISION_CODIGO.md`:**

| On | Què |
|---|---|
| `docs/debug/INFORME_REVISION_CODIGO.md:318` | El mètode **`nuclearRefresh()`** documentat feia: `seq.attachCustomMetadata("RE_DRAW", …)` + meneo del cabezal (`setPlayerPosition` ±0,001 s) + **`app.setAppFocus()`** |
| Línia 327 (mateix informe) | «`app.setAppFocus()` **puede robar el foco del usuario**» ← risc assenyalat a la revisió |
| `git show c0f303f:js/workflows/flow_cut.js:120` | **`slider.onchange = function () { callJSX('FASTPASS.Timeline.nuclearRefresh()'); };`** ← el slider el cridava **en deixar anar** |
| `git show c0f303f:jsx/modules/4_Sequences.jsx` | En aquest repo `nuclearRefresh()` es va portar **sense** `app.setAppFocus()` (només el meneo) i després va **desaparèixer** del tot (liposucció) |

→ **Causa del «al principi funcionava»:** en deixar anar el slider es tornava el focus del teclat a
Premiere amb `app.setAppFocus()`, i l'ESPAI (Play/Pausa natiu) arribava a Premiere ✔. Al portar-ho
aquí es va ometre la línia (per l'avís de l'informe) i el refactor va eliminar la funció → el panell
es quedava el focus **de manera permanent** i l'ESPAI es va quedar mort ✗.

**Fix (recuperat):**
- `devolverFocoHost()` (main.js 7.c) ara usa **`app.setAppFocus()`** com a via principal i
  `app.bringToFront()` com a xarxa de seguretat (i ho deixa al log:
  `🖱 [FOCUS] focus del teclat → Premiere (slider) → setAppFocus=OK · bringToFront=OK`).
- Es crida **exactament on ho feia el codi original**: al `slider.onchange` (en deixar anar el
  slider) ✔ + `mouseup` global (qualsevol interacció) + al mateix ESPAI si el panell té el focus.
- El debounce (`clearTimeout` + 60 ms) fa que només s'enviï **una** crida encara que coincideixin
  `mouseup` i `onchange`.
- `comprobarApisPlay()` ara també informa de `setAppFocus=SI/NO`.

**Cache-buster:** `main.js?v=59` · **Harness:** 44 OK / 0 FAIL.

## ⌨️ FIX 28 — Causa RAÍL del play del panell: `qe.project.getActiveSequence().play` NO EXISTEIX

**Què deia l'usuari:** «No ha funcionat. He clicat espacio amb el slider seleccionat i no fa play».

**Dades del log (14:54) — clau:**
```
⌨️ [TECLAT] ESPAI → play/pausa
▶▶ PLAY inici: media=0.00 tl=0.00
💥 [JSX ERROR]: ERR:qe.project.getActiveSequence().play is not a function    ✗✗
⏸⏸ PAUSA: media=95.40 tl=95.40
💥 [JSX ERROR]: ERR:qe.project.getActiveSequence().stop is not a function
```
→ El handler **sí** s'executava, però el **QE DOM d'aquesta versió de Premiere no té `play()` ni
`stop()`**: el play del panell **mai no ha funcionat** (no és cap regressió). Quan l'ESPAI "anava bé"
era perquè el focus del teclat era a Premiere i ho gestionava Premiere natiu.

**Solució (sense dependre d'APIs que no existeixen):** el panell **NO s'ha de quedar el focus del
teclat**. `main.js` secció 7.b/7.c:
1. `comprobarApisPlay()` (una sola vegada, ~1,5 s després d'arrencar): comprova i **diu al log** què
   hi ha disponible →
   `🔎 [PLAY] APIs → qe.seq.play=NO · qe.seq.stop=NO · app.seq.play=NO · bringToFront=SI → via: focus retornat a Premiere (Play/Pausa natiu)`
   (si en una altra versió el QE sí té `play()`, la via passa a ser `SrtEditor.togglePlay()`).
2. `devolverFocoHost(motiu)`: `blur()` del control + `window.blur()` + **`app.bringToFront()`**
   (el panell va acoblat dins la finestra de Premiere → no canvia res visualment). El focus del
   teclat torna a Premiere.
3. Es crida **després de cada interacció** amb el panell (`mouseup` global, amb capture) → així,
   quan l'operador prem ESPAI, el focus ja és a Premiere i el **Play/Pausa és el natiu** ✔.
   **No** es fa si el focus és en un camp de text (l'usuari està escrivint).
4. I també al mateix ESPAI si el panell encara té el focus (aquella pulsació retorna el focus; la
   següent ja va a Premiere).

**Validat amb test headless** (`C:\temp\fp_space_test.html`, handler idèntic, amb i sense QE):

```
1) ESPAI amb focus a ▶ btnNextClip → prevented=true · focus→BODY · clicks ▶=0 · focoRetornat=["espai"] ✔
2) ESPAI amb focus al slider → prevented=true · focoRetornat=["espai","espai"] ✔
3) ESPAI sense control enfocat → prevented=true · focoRetornat=[…,"espai"] ✔
4) ESPAI dins d'un camp de text → prevented=false · sense canvis ✔
5) ENTER amb focus a ▶ btnNextClip → prevented=true · focus→BODY · clicks=0 ✔
6) ESPAI amb QE disponible (_qePlayOk=true) → plays=1 i NO es retorna el focus ✔
```

**Cache-buster:** `main.js?v=58` · **Harness:** 44 OK / 0 FAIL.


## ⌨️ FIX 30 — Cap API de play/focus en aquesta versió: s'envia la TECLA ESPAI des del panell

**Log del 15:51 (demolidor):**
```
🖱 [FOCUS] focus del teclat → Premiere (mouseup) → setAppFocus=ERR:app.setAppFocus is not a function · bringToFront=ERR:app.bringToFront is not a function
⌨️ [TECLAT] ESPAI → focus retornat a Premiere (Play/Pausa natiu)
```
→ En aquesta versió de Premiere **no existeixen** ni `app.setAppFocus()` ni `app.bringToFront()` (les del
`nuclearRefresh` original) i el QE no té `play()` (FIX 28). És a dir: **no hi ha cap API per fer
Play/Pausa ni per tornar el focus**. I amb el panell enfocat, l'ESPAI mai arriba a Premiere.

**Solució (única via possible): enviar la pròpia tecla des del sistema.**
- Nou **`bin/send_space.vbs`**: busca el PID de `Adobe Premiere Pro.exe` (WMI), fa
  `AppActivate(pid)` i `SendKeys " "`. **Sense accents a propòsit** (ANSI-safe).
- Es llança des del panell amb **`File.execute()`** via `callJSX` → s'obre amb **`wscript.exe`**:
  **sense consola ni parpadeig** (NO s'usa `IO.executeShell`, que crea un `.bat` i faria parpadejar
  una finestra negra a cada pulsació).
- Ruta de l'extensió resolta amb el patró de `utils.js`: `CSInterface.getSystemPath(SystemPath.EXTENSION)`
  i, si falla, `window.location.href` menys `/index.html`.
- **Només s'envia si el panell té el focus** (`document.hasFocus()`) i **no és un eco** del nostre
  propi enviament (anti-bucle: 1,5 s) → sense risc de ping-pong de tecles.
- Si algun dia Premiere té `setAppFocus`/`bringToFront` (o el QE `play()`), el diagnòstic ho detecta i
  s'usa aquella via en lloc del VBS.

**Extres:**
- `devolverFocoHost()` ja **no repeteix** les crides d'APIs que el diagnòstic ha confirmat que no
  existeixen (abans cada clic escrivia 2 `ERR:… is not a function` al log ✗).
- El log ara inclou `hasFocus del panell: true → false` per veure si el `blur()` té efecte.
- El diagnòstic informa de la via triada: `🔎 [PLAY] APIs → … → via: tecla ESPAI via bin/send_space.vbs`.

**Validat al sistema:**
- `cscript //Nologo` sobre un test de la WMI → `OK: trobat Adobe Premiere Pro.exe#15928` ✔
- Copia del `.vbs` amb `AppActivate`/`SendKeys` desactivats → `SKIP AppActivate15928` + `SKIP SendKeys`:
  el script és sintàcticament vàlid i troba Premiere ✔
- `bin/send_space.vbs`: 1461 bytes, **sense BOM** i **0 bytes > 127** (ASCII pur: wscript llegeix els
  `.vbs` com ANSI i accents/guions llargs trencarien el contingut) ✔

**Cache-busters:** `main.js?v=61` · **Harness:** 44 OK / 0 FAIL.

**Per validar (usuari):** recarregar el panell → al cap d'uns segons ha d'aparèixer
`🔎 [PLAY] APIs → … → via: tecla ESPAI …`; després, amb el focus al panell (p. ex. tocant el slider),
prémer ESPAI ha de fer Play/Pausa a Premiere i escriure
`⌨️ [TECLAT] ESPAI → enviant la tecla a Premiere (focus al panell)` + `… → OK`.


## 🎚️ FIX 31 — L'ESPAI desactivava el reencuadre i el slider saltava de posició

**Queixa (usuari):** «el play funciona millor, però cada vegada que el clico el slider (només el
slider) es col·loca al centre. Caldria que es quedi en la posició en què està».

**Seqüència exacta al log (15:58) — la causa és una CADENA de 3 coses:**
```
⌨️ [TECLAT] ESPAI → enviant la tecla a Premiere (focus al panell)
⌨️ [TECLAT] tecla ESPAI enviada a Premiere (espai) → OK      ← el play funciona ✔
🛑 Reencuadre manual desactivat                              ← ✗ l'AppActivate del VBS fa perdre el
                                                               focus un instant i el tick (500 ms)
                                                               apaga el reencuadre (`!hasFocus()`)
🎛️ Reencuadre manual ACTIVAT (l'usuari hi torna a clicar)    ← i en reactivar-lo…
🎚️ Slider límits(px): -352..960 cur=333 seqW=608            ← ✗ el slider salta a la X del clip
                                                               objectiu (333) i no als 712 px que
                                                               l'usuari havia posat
```

**Fix (3 canvis, tots a `main.js`):**
1. **El tick necessita 2 ticks seguits (~1 s) sense focus** per apagar el reencuadre
   (`_reframeNoFocusTicks`) → una pèrdua momentània de focus (el `AppActivate` del VBS) ja no
   l'apaga. Si l'usuari se'n va de veritat a Premiere, s'apaga igual que abans ✔.
2. **`_applySliderRange` ja no reposiciona el thumb** amb la X del clip objectiu: només s'aplica el
   rang nou i es recorregeix si el valor queda FORA. La sincronització amb el clip la segueix fent el
   poll (`updateSliderFromPremiere`). El log ara mostra tots dos valors:
   `🎚️ Slider límits(px): -352..960 cur=712 (clip=333) seqW=608` ✔.
3. **En enviar la tecla ja no es fa `devolverFocoHost('espai')`**: el VBS ja porta el focus a
   Premiere i el `blur()` del panell només afegia una pèrdua de focus extra (que és el que
   disparava el punt 1) ✗.

**Efecte esperat:** prémer ESPAI ja no ha de provocar `🛑 Reencuadre manual desactivat` i el slider
es queda exactament on era ✔.

**Cache-buster:** `main.js?v=62` · **Harness:** 44 OK / 0 FAIL.


---

# SESSIÓ 2026-09-23 (matí)

## ✂️ FIX 32 — OUT&GO: el recorte no llegaba a V9 (llista de pistes FIXA)

**Queixa (usuari):** «al hacer OUT&GO se debería recortar todo lo que hay en el timeline a la altura
del OUT; como hay un nuevo clip en V9, no se ha previsto que se recorte hasta ese track».

**Causa (`flow_cut.js::runCutOut`):** les pistes a netejar eren **llistes fixes**:
```js
const videoTracks = [2, 3, 4, 5, 6, 7, 8];   // ✗ V9 (Mosa) quedava fora
const audioTracks = [1, 2];                  // ✗ A3+ quedaven fora
```
`Clips.rippleOut` (JS) **ja fa les dues coses bé**: elimina els clips que comencen després del temps
i **retalla** el clip que el conté (`Clips.end(track, idx, target)`) ✔ — el problema era només que a
V9 no se li demanava res ✗.

**Fix:** les llistes es calculen de les pistes reals de la seqüència:
```js
const nVid = parseInt(await callJSX("Tracks.count('video')") || '0') || 0;
const nAud = parseInt(await callJSX("Tracks.count('audio')") || '0') || 0;
for (let t = 2; t <= nVid; t++) videoTracks.push(t);   // V1 = clip MP4 (ja es retalla abans amb rippleOut)
for (let a = 1; a <= nAud; a++) audioTracks.push(a);
```
→ val per a qualsevol `.prproj` (9, 10… pistes) i el log diu el rang real:
`🔍 [FLOW-CUT] Limpiando pistas secundarias: video [2,…,9] (de 9), audio [1,2] (de 2)`.

**Cache-buster:** `flow_cut.js?v=12` · **Harness:** 44 OK / 0 FAIL.

## 🎤 FIX 33 — Conductor omès perquè el bloc OBRIA amb grafismes

**Queixa (usuari):** «en el proyecto actual, ¿por qué no se ha colocado el chyron de conductor?».

**Log:** `⏭️ [Conductor] El bloc NO obre amb plató (1r ítem: "P2 foto CENTRE DE DADES"; plató
detectat: 01i). Ometent conductor.`

**Causa:** la regla del 2026-09-22 exigia que l'ítem de plató fos **el PRIMER ítem real** ✗. Però el
bloc V1 del TNC (22/09) **obre amb GRAFISMES** i el plató ve just després — agrupació `v1` real:

| Pos | ítem | títol |
|---|---|---|
| 1 | `01p21` | P2 foto CENTRE DE DADES |
| 2 | `01p22` | P2 MAPA CENTRES DE DADES |
| **3** | **`01i`** | **intro** ← plató detectat (presentadora) |
| 4 | `01` | CAMPANYA CONTRA MEGA CENTRES DE DADES |

→ el `01i` és el 3r ítem, no el 1r → el conductor s'ometia ✗ (quan hauria d'anar a l'inici del bloc ✔).

**Fix (`flow_chyrons.js`, `placeChyronConductor`):** en lloc d'exigir que el plató sigui el 1r ítem,
s'accepta si està dins dels **PRIMERS 3 ítems reals** del bloc (`PRIMERS_N = 3`; els grafismes
inicials no compten com a contingut). El cas que va motivar la regla (un `02dp` a mig bloc) continua
quedant fora ✔.
- Log nou quan s'accepta: `ℹ️ [Conductor] El bloc obre amb grafismes: el plató 01i és a la posició 3 → s'accepta.`
- Log quan es descarta: `⏭️ [Conductor] El bloc no obre amb plató: el plató (XX) és a la posició K de N ítems (finestra: 3 primers…)`.

**Cache-buster:** `flow_chyrons.js?v=40` · **Harness:** 44 OK / 0 FAIL.


## 🎤 FIX 34 — Conductor: la regla passa a mirar el TIMELINE (primer marcador de plató)

**Puntualitzacions de l'usuari:**
1. Encara que `intro` no sigui el 1r ítem de l'escaleta del bloc, **al final del processat SÍ que és el
   1r ítem del TIMELINE**, perquè els grafismes acaben generant un marcador **dins de l'ítem intro**.
   Pot passar igualment amb **donapas** i amb altres casos amb conductor de plató.
2. Per tant la regla ha de ser més simple: **el conductor va al PRIMER MARCADOR de plató del
   timeline** (intro/donapas/…) → cal mirar directament el que hi ha al timeline.

**Implementat (`flow_chyrons.js::placeChyronConductor`)** — s'ha eliminat el criteri d'escaleta
(«el plató ha de ser el 1r ítem real» i la finestra de 3 ítems del FIX 33) i ara:
1. Es llegeixen els **marcadors estructurals** del timeline (ja es feien) ordenats per temps.
2. Per a cada marcador es decideix si el seu ítem és de **plató**:
   - pel **prefix** del marcador → ítem de l'escaleta del bloc → `_isPresenterLine()` (num amb sufix
     `i/dp/dir/lead/f/off` o títol amb OFF/DONA PAS/CONN/INTRO/DIRECTE…);
   - si no hi és, **guarda pel títol** del marcador amb `_isPresenterTitle()`.
3. El **primer** marcador de plató és la posició del conductor (`targetTime` = el seu TC) ✔.
   `isFirstItem` = no hi ha cap marcador estructural abans (això manté el CasA/CasB del Tema-Títol).
4. **Respatller** (només si cap marcador és de plató): l'ítem de plató de l'escaleta sense marcador
   propi → inici del bloc o primer marcador (com abans).

Log nou: `🎙️ [Conductor] 1r marcador de PLATÓ al timeline: 01i @ 12.34s (OBRE el bloc) · plató de l'escaleta: 01i`
o, si no n'hi ha cap: `⏭️ [Conductor] Cap ítem de plató (intro/donapas/off/directe...) ni als marcadors ni a l'escaleta. Ometent conductor.`

**Repercussió en el titulillo/Tema-Títol?** SÍ, **indirecta i coherent amb el disseny**:
`_blockStartTime()` (que decideix el CasA/CasB del Tema-Títol) llegeix el **primer clip de la pista
de chyrons (V7)**; si és el conductor i està a ±0,5 s de `clipStart`, calcula el cas:
- **CasA** (marge ≥ ~11,04 s): el Tema-Títol va a `clipStart + 0.40` i el titulillo **no** fa entrant.
- **CasB** (marge menor): el Tema-Títol entra quan **acaba el rètol del conductor** i el titulillo
  **sí** col·loca l'entrant a `clipStart + 0.40` ✔.
Abans, com que el conductor s'ometia, sempre era CasA ✗; ara pot passar a CasB ✔. Tema-Títol i
titulillo van a **V6** i el conductor a **V7** → no es trepitgen ✔.

**Cache-buster:** `flow_chyrons.js?v=41` · **Harness:** 44 OK / 0 FAIL.

---

## 🎨 FIX 35 — Els marcadors GRÀFICS (grocs) no es generaven: F6·Gràfics estava desconnectat

**Símptoma (usuari):** al bloc V1 del TNC (22/09) s'esperaven els marcadors **grocs** dels ítems
gràfics `01p21` (P2 foto) i `01p22` (P2 MAPA) i no apareixien.

**Diagnòstic (verificat amb l'escaleta real `20260922_141036_TN_COMARQUES_V1_…json`):**
1. Els grocs (color 4) els crea **només** `Workflows.Markers.placeGraphicMarkers()` (F6·Gràfics):
   `flow_markers.js:1892` és l'**únic** `colorIdx: 4` de tot el projecte (`js/` + `jsx/`).
2. Els ítems estaven ben preparats: `01p21`/`01p22` tenen `horaEntradaPrevista=13:56:28`,
   `agrupacio=v1`, `durada=0:00` → passen el filtre d'hora de `_classifyItems` i
   `_isGraphicByNum('01p21')` troba el sufix `p21` dins de `_GRAPHIC_SUFFIXES` → entren a
   `graphicItems` ✔. El codi els col·locaria; només faltava executar la fase.
3. **F6·Gràfics no s'invocava des de cap lloc:**
   - El botó 🎨 (`btnMarksF6`, secció GRÀFICS) va ser reassignat el **2026-09-18** a `Mapa.run`
     (importador ZZZ_GRAFISME → bin GRAF → V6), i el `title` va quedar antiquat.
   - El grup MARCADORS (TEST) arribava només fins a **F5** (OnAir, Dedu, Prev, Correl, Dens, Orphan).
   - El pipeline `runFullPipelineOut` (botó **OUT&GO**) incloïa F1→F5 + **Ordre (F6)** però **no** Gràfics.
   - `flow_assembly.js` només té l'alias (`Assembly.placeGraphicMarkers`) → també orfe.
4. **Efecte col·lateral detectat:** la fase/botó **Correl (F3.5)** crida
   `Assembly.correlationSnapMarkers`, mètode que **no existeix** → no fa res (només un
   `console.error` aïllat) i és redundant perquè `placeScheduledMarkers` (F3) ja executa
   `_correlationSnap` internament (`flow_markers.js:835`). **No s'ha tocat** (pendent de decisió).

**Canvis (2026-09-23):**
- `js/main.js::runFullPipelineOut` → **10a fase** `['Gràfics (F6·GF)', …placeGraphicMarkers()]`
  **després** d'`Ordre (F6)` (així els marcadors pare ja estan a la posició definitiva) i abans del snapshot.
- `index.html` → botó nou **`btnMarksF6GF` "GF"** al grup MARCADORS (TEST, `test-only`).
- `js/main.js` → binding `btnMarksF6GF` → `Markers.placeGraphicMarkers` (TEST; en TREBALL ja ho fa el pipeline).
- `title` del 🎨 corregit (deia «Gràfica: marcadors GF de l'escaleta» i en realitat fa el MAPA). La seva
  funció **no** s'ha tocat (visible a totes dues vistes).

**On cauen els grocs:** F6 els ancora al marcador pare (`01i`, prioritats `i > dp > dir`) amb el
criteri D13 (N+2 segments, mínims +10 s i +5 s) → `01p21` a +10 s i `01p22` a +15 s de l'inici de la intro.

**Cache-buster:** `main.js?v=63` · **Harness:** 44 OK / 0 FAIL.

---

## 🎨 FIX 36 — Grafismes associats als marcadors GROCS (MAPA) + congelat final

**Peticions d'usuari (2026-09-23):**
1. El botó 🎨 (MAPA) usava el **clip seleccionat** com a referència → ara la referència és el
   **MARCADOR**: el seu TC és el PUNT D'ENTRADA del grafisme.
2. Afegir un **CONGELAT al final del clip** de grafisme perquè l'usuari el pugui estirar còmodament
   (creat com el congelat del Tema-Títol) → **durada: 3 s, o menys si el clip de V1 acaba abans**.
3. Al final del botó **COLOCAR**: repassar els **marcadors GROCS (color 4)**, triar els que porten
   grafisme associat per **paraula clau** (`MAPA`…), intentar seleccionar el fitxer automàticament i,
   si no és possible, obrir el navegador de fitxers.

**Implementat (`flow_mapa.js`, `main.js`, `index.html`):**
- `_flow`: `mkRef = _itemAtCti(CTI)` → `refSec = mkRef.time` (TC del marcador) + `_refClipAt(refSec)`
  per a l'espai hàbil; l'ítem de matching és el del marcador. Sense marcadors → fallback al clip
  seleccionat (comportament antic, amb WARN).
- `_refClipAt(sec)`: clip de V1 que conté la posició (límit de l'espai hàbil i del congelat).
- `_applyTrackConfig()`: centralitza la lectura de pistes de la CONFIG (GRAF=V3 · congelat=V6).
- `_freezeGrafEnd(gName, grafEnd, endLimit)`: congelat amb la mecànica de `_freezeTemaTitol`:
  grafisme temporal a TC 10:00 → `Render.snapshot` de l'**últim frame** → treure el temporal →
  `IO.importFiles(png, 'GRAF')` (emparellant el nom real a la raïl del bin) → `Clips.insert` +
  `Clips.endAt` a V3 des de `grafEnd`, amb **dur = min(3 s, endLimit − grafEnd)**.
  S'executa sempre al final de `_placeClips` → també en el flux manual 🎨.
- `GRAF_KEYWORDS: ['MAPA']` + `_keywordOf()` (normalitzat, sense accents) → **ampliable**.
- `_grafCandidates()`: marcadors `color === 4` amb paraula clau al títol (amb log dels descartats).
- `runFromMarkers()` + `_runCandidates()`: per cada candidat → `_match(nombre, files)` →
  `_askFiles(folder)` si no hi ha coincidència → `_import` → `_refClipAt` + `_freezeUnderCti` →
  `_placeClips(items, marcador.time, freeze, ref)`.
- `main.js::runPlaceAllChyrons`: **nova fase final** `Mapa.runFromMarkers()` (després dels chyrons i
  de l'IPD, abans del focus a V1).
- `index.html`: tooltip del 🎨 actualitzat (entrada pel marcador + congelat 3 s).

**Cache-busters:** `flow_mapa.js?v=16`, `main.js?v=64` · **Harness:** 44 OK / 0 FAIL.

---

## 🎨 FIX 37 — El filtre del color impedia col·locar cap grafisme (`color = -1`)

**Símptoma:** després del FIX 36, al COLOCAR no es col·locava cap grafisme i **no s'obria el navegador**.

**Diagnòstic (log del projecte `PROVES\FASTPASS.log` + snapshot `MARCADORS_*.json`):**
```
⏭️ [MAPA·MARKS] "01p22 - P2 MAPA  CENTRES DE DADES": clau MAPA però color=-1 (no GROC) → saltat
➖ [MAPA·MARKS] Cap marcador GROC (color 4) amb paraula clau (MAPA) → res a fer
```
**`Markers.get()` retorna `color = -1` a TOTS els marcadors** en aquesta versió de Premiere
(`8_Markers.jsx` fa `try { colorIdx = current.color } catch {}` → l'API no exposa el color i queda -1),
tot i que F6 els crea amb `color=4`. El filtre `m.color !== 4` descartava el candidat abans del
matching → ni col·locació ni finestra de selecció.

**Fix (`flow_mapa.js::_grafCandidates`):** el filtre REAL passa a ser la **paraula clau**; el color
només s'informa:
- s'accepta si `color === 4` **o** el color no està disponible (`-1`, `undefined`, `null`);
- es descarta només si el color és CONEGUT i no és el groc;
- log informatiu: `ℹ️ [MAPA·MARKS] "...": color no disponible (-1) → es fa servir la paraula clau MAPA`.

**Comprovat amb dades reals** (bloc V1 TNC, snapshot de marcadors):
`01i@0.00s`, `01p21@10.00s`, **`01p22@15.00s`** (l'objectiu) i `01@44.92s`. El fitxer
`APP P2 MAPA CENTRES DE DADES.mov` és a `ZZZ_GRAFISME\22 SETEMBRE` i `_match()` el troba pels tokens
del títol → **no** caldrà la finestra → el grafisme anirà a **15.00 s** amb el congelat de 3 s
(el clip de V1 acaba a 44.92 s).

**Cache-buster:** `flow_mapa.js?v=17` · **Harness:** 44 OK / 0 FAIL.

---

## 🔧 FIX 38 — Error d'escapada a la ingesta: les barres invertides es perdien (`ERR:MOVE_FAILED`)

**Símptoma (usuari):** al COLOCAR el grafisme no es col·locava i sortia un error amb la **direcció del
fitxer sense les `\`**.

**Diagnòstic (auditoria de crides JSX, `PROVES\FASTPASS_audit.log` + `FASTPASS.log`):**
```
JSX> FASTPASS.IO.importFiles('["\\public.ad-ccrtv.local\Public\...\APP P2 MAPA CENTRES DE DADES.mov"]', 'GRAF')
🔴 [JSX ERROR]: ERR:MOVE_FAILED
🟢 [MAPA] "APP P2 MAPA CENTRES DE DADES" → bin GRAF · [] · dur=0.00s
🟢 [Clips] insert sense àudio → V3@15.32s "APP P2 MAPA CENTRES DE DADES" ins=ERR_ITEM_NOT_FOUND
```
Comparant amb la crida que SÍ que funciona (congelat del Tema-Títol, que fa doble escapada):
```
IO.importFiles('["\\\\DSMEDIA07\\...freeze_xxx.png"]', 'CHY')   ← barres blindades ✔
```

**Causa:** `utils.importList()` només escapava les cometes simples
(`JSON.stringify(...).replace(/'/g, "\\'")`). Com que el payload viatja dins d'un **literal
ExtendScript** (`'...'`), les barres invertides s'interpretaven com a seqüències d'escapada i es
perdien (`\P`, `\Z`, `\S` → `P`, `Z`, `S`) → ruta trencada → `importFiles` fallava → `Project.move`
→ `ERR:MOVE_FAILED` → l'ítem no existia → `Clips.insert` → `ERR_ITEM_NOT_FOUND`.
No es veia al flux de **Project** perquè allà les rutes es passen amb `/`
(`f.path.replace(/\\/g, "/")`) i `escape()` no toca les barres normals.

**Fix (`js/core/utils.js::importList`):** `const payload = this.escape(JSON.stringify(rawPaths))` →
**doble escapada** (JSON + escape), la mateixa tècnica que `_freezeTemaTitol` (flow_chyrons.js) i que
`_freezeGrafEnd` (flow_mapa.js). Compatible amb rutes amb `/` i amb `\`.

**Cache-buster:** `utils.js?v=16` · **Harness:** 44 OK / 0 FAIL.

---

## 🎯 FIX 39 — El cabezal torna a la seua posició després del congelat del grafisme

**Petició d'usuari:** després de crear el congelat, el cabezal ha de tornar a la posició original.
El snapshot (`Render.snapshot`) obliga a moure'l al TC temporal del grafisme (10:00) → la vista es
quedava allà.

**Fix (`flow_mapa.js::_freezeGrafEnd`):**
- Abans de res es desa el cabezal: `ctiOriginal = parseFloat(await callJSX('Timeline.get()'))`.
- En un bloc **`finally`** (s'executa també si el congelat falla o fa `return` per qualsevol motiu)
  es fa `Timeline.set(ctiOriginal)` i es loga `📍 [MAPA·freeze] Cabezal retornat a Xs`.

**Cache-buster:** `flow_mapa.js?v=18` · **Harness:** 44 OK / 0 FAIL.

---

## 🆕 FIX 40 — Botó IPD+ (doble finestra VERTICAL) + reorganització del grup GRÀFICS

> ⚠️ **SUPERAT pel FIX 41**: l'usuari va redefinir el concepte (toggle per interval, sense fons PNG,
> atributs propis i pista de treball V2 → V3). El que queda vàlid del FIX 40 és la **reorganització
> del grup GRÀFICS** (2 files de 3) i el **botó IPD+** amb el seu binding.

**Petició d'usuari:** crear un botó nou (IPD+) i reorganitzar GRÀFICS en mode TREBALL:
fila de dalt = **IPD · IPD+ · Doble Finestra**; fila de baix = **Grafic (🎨) · Mapa (🗺️) · Tòtem (🗿)**.
L'IPD+ ha de posar una part de la imatge a dalt i una altra a baix, amb un **fons** a sota. Idea de
l'usuari: *és una doble finestra VERTICAL* → aprofitar el codi de la Doble Finestra i afinar les
propietats dels clips.

**Implementació (`index.html`, `main.js`, `flow_graphics.js`):**
- **`index.html`**: reordenats els 6 botons del `graphics-strip cols-3` (la reixa de 3 columnes deixa
  les files exactament com demanava) i afegit `btnGrafIpdPlus` ("IPD+") amb el seu `title`.
- **`main.js`**: binding → `callWorkflow('Graphics', 'runIpdPlus', e)` (Ctrl+clic = reset del flux).
- **`flow_graphics.js`**:
  - **`_dfPerfils`**: el Motion de les 2 finestres surt ara d'un **PERFIL** → `classic` (🪟🪟:
    finestres lado a lado, amb els valors d'abans) i `ipdplus` (VERTICAL: una finestra a dalt i una
    a baix). `_dpPaso4` només llegeix el perfil actiu → **cap canvi de comportament a la DF**.
  - **`runIpdPlus`**: fixa `_dfPerfil = 'ipdplus'` i executa el MATEIX flux `runDoblePantalla`
    (PAS0→PAS4: duplicar el clip de V1 (`mp4`) a `video1` (V4) i `video2` (V5), fons PNG a
    `fondos` (V3) i Motion) → i al final restaura el perfil.
  - **Valors de l'IPD+ PROVISIONALS** (pendents dels que passi l'usuari): es canvien NOMÉS a
    `_dfPerfils.ipdplus` (`position` en px del canvas 608×1080 · `cropTop/cropBottom/cropLeft/
    cropRight` en % · `scale` en %). Actual: `infVals {position:[304,810], cropTop:50}` (V4 =
    finestra de **baix**) i `supVals {position:[304,270], cropBottom:50}` (V5 = finestra de **dalt**).

**Cache-busters:** `flow_graphics.js?v=11`, `main.js?v=65` · **Harness:** 44 OK / 0 FAIL.

---

## 🆕 FIX 41 — IPD+ v2: TOGGLE per INTERVAL (sense fons, 2 capes, V2 → V3)

**Especificació d'usuari (substitueix el FIX 40):**
1. **No** es posa cap fons PNG.
2. Atributs **sense recortes**: capa superior `position [161, 812]`, `scale 50%`; capa inferior
   `position [1058, 812]`, `scale 110%`.
3. **APLICAR**: es talla el clip de **V2** a l'interval seleccionat i es mou a **V3**; es duplica el
   que hi ha a **V1** cap a **V2**; a V1 se li apliquen els atributs **inferior** i a V2 els **superior**.
4. Treballa per **INTERVAL** (un o més clips seleccionats), no per clip.
5. Per estalviar procés, el clip de V2 es retalla d'inici a fi de l'interval perquè **només es mogui
   1 clip** cap a V3.
6. **REVERTIR (toggle)**: si es torna a clicar amb un interval que ja té IPD+, s'esborra V2, es mou
   V3 → V2 i es treuen els atributs de V1.

**Implementació (`flow_graphics.js` + `index.html` + `main.js` + `jsx`):**
- **`IPDPLUS`** (config única): `SRC: 2` (pista del clip transformat) · `PARK: 3` (on s'aparca
  l'original → fa de fons de la composició) · `BASE: 1` (material que es duplica a SRC i rep INFERIOR)
  · `INFERIOR {position:[1058,812], scale:110}` · `SUPERIOR {position:[161,812], scale:50}`.
- **`runIpdPlus`** = toggle: si hi ha clips a `PARK` dins l'interval → **`_ipdPlusRevertir`**; si no →
  **`_ipdPlusAplicar`**. Al final, focus/targeting a V1.
- **`_ipdPlusRango`**: interval = unió dels clips **seleccionats de la pista SRC**; si no n'hi ha,
  fallback al clip de SRC sota el cabezal.
- **`_ipdPlusAplicar`**: 1) retalla el primer clip de SRC a l'interval (`moveToRange`) i esborra la
  resta de clips de SRC dins l'interval (`removeAt`) → **1 sol clip**; 2) `move` a PARK + fixar el rang;
  3) `duplicate` de BASE → SRC clip a clip dins l'interval (+ `moveToRange` de cada duplicat);
  4) Motion: BASE = INFERIOR · SRC = SUPERIOR.
- **`_ipdPlusRevertir`**: 1) esborra SRC dins l'interval; 2) `move` PARK → SRC + fixar el rang;
  3) BASE → estat previ desat (o estat normal 100%/centrat si no n'hi ha).
- **`_ipdPlusMotion`**: aplica atributs a tots els clips del rang i desa l'estat previ
  (`_ipdPlusStates['pista:start']`) per poder revertir exacte.
- **NOTA JSX**: s'ha afegit l'àtom **`Clips.getSelection()`** (`6_Clips.jsx` + alias a `main.jsx`)
  perquè cap àtom existent retornava la SELECCIÓ MÚLTIPLE (`getSelectedVideo` només retorna el primer).
  Justificació recollida al comentari del mètode (regla "JSX tancat").
- **La Doble Finestra 🪟🪟 queda EXACTAMENT com estava** (s'ha revertit la parametrització de perfils
  del FIX 40).

**⚠️ A validar per l'usuari:** `position` es passa en **px del frame de la seqüència** (el JSX la
normalitza dividint per `frameSizeHorizontal/Vertical`); si els valors [161,812] / [1058,812] venen
d'un frame 1920×1080 i la seqüència és 608×1080, caldrà escalar-los.

**Cache-busters:** `flow_graphics.js?v=12`, `main.js?v=66` · **Harness:** 44 OK / 0 FAIL.

---

## 🔧 FIX 42 — IPD+: interval equivocat (200 s) i `Clips.duplicate` que fallava

**Símptoma (usuari):** "se han colocado muchos más clips de los necesarios con IPD+".

**Diagnòstic (log del projecte):**
```
[IPD+] sense selecció a V2 → ús el clip sota el cabezal (0.00s→200.28s)   ← interval de 200 s!
[IPD+] V1: 28 clip(s) a l'interval → duplicant a V2
duplicat V1[0] → V2 → ERR_CLIP_NOT_FOUND_AFTER_DUP: TNM_V1_CLIP.mp4        ← duplicate falla
… (28 cops) …
[IPD+] V1[0..27] INFERIOR {position:[1058,812],scale:110} → OK:scale=110   ← 28 clips tocats
```
1. **Interval erroni**: `_ipdPlusRango` filtrava la selecció per la pista SRC (V2) i, si no n'hi
   havia, agafava el clip de **V2** sota el cabezal — que en aquest projecte dura **tota la peça**
   (200,28 s) → 28 clips afectats sense voler.
2. **`Clips.duplicate` no funciona** en aquest projecte: retorna
   `ERR_CLIP_NOT_FOUND_AFTER_DUP: <media>` → cap còpia a V2.

**Fix:**
- `_ipdPlusRango`: la **SELECCIÓ es pren de QUALSEVOL pista** (el panell sol deixar seleccionat el
  clip de V1) i es loga `selecció: N clip(s) [V1,V2…]`. **Sense selecció** → clip de **BASE (V1)**
  sota el cabezal (peça trocejada curta), mai el de SRC.
- `_ipdPlusAplicar`: la còpia V1 → V2 passa a fer servir **`Clips.insertClipFrom`** (el mateix àtom
  que la Doble Finestra i el MAPA) + `moveToRange` per fixar el rang, en lloc de `Clips.duplicate`.

**Cache-buster:** `flow_graphics.js?v=13` · **Harness:** 44 OK / 0 FAIL.

**Precisió de l'usuari (2026-09-23):** *la selecció serà SEMPRE de V1 i el tall de V2 es fa respecte
al que hi ha seleccionat a V1*. Per tant `_ipdPlusRango` filtra la selecció per la pista **BASE (V1)**
(la resta de pistes s'ignoren, amb log) i el retall de V2 (`SRC`) es fa exactament a
`[inici, fi]` d'aquest interval seleccionat. `flow_graphics.js?v=14`.

---

## 🔧 FIX 43 — IPD+: àtoms equivocats (`moveToRange`/`insertClipFrom`) → contingut desfasat i àudio brut

**Símptomes (usuari):** el tall de V2 no respectava l'interval · no es movia res a V3 · apareixien
clips amb corts coincidents però **contingut diferent** dels originals de V1 · amb **àudio associat** ·
l'últim clip no es retallava al final de l'interval.

**Diagnòstic (log + lectura dels àtoms JSX):**
```
[IPD+]   V2[0] → V3 → OK:0
[IPD+]   V3 fixat a l'interval → OK:start=65.560,end=117.880
[IPD+] V1: 8 clip(s) a l'interval → copiant a V2
[IPD+]   copiat V1[3]@65.56s → V2 → OK          ← només el 1r rebia "fixat"; la resta, no
```
1. **`Clips.moveToRange` NO retoca inPoint/outPoint** (només assigna `clip.start`/`clip.end`) →
   el clip no quedava retallat de veritat: **el contingut quedava desplaçat**.
2. **`Clips.insertClipFrom`** (i `Clips.duplicate`) insereixen el **PROJECT ITEM SENCER** (el MP4
   complet, amb els seus in/out a 0) i amb **àudio vinculat** → còpies amb corts correctes però
   contingut equivocat, i clips d'àudio bruts. `duplicate` a més fallava.

**Fix (`_ipdPlusAplicar` reescrit):**
- **V2 → V3**: `Clips.retrim(SRC, idx, inPt, outPt, rng.end)` amb
  `inPt = ip0 + (rng.start − c.start)`, `outPt = ip0 + (rng.end − c.start)` → retall REAL alhora
  que conserva el contingut; després `Clips.move(SRC, idx, PARK)` + `retrim` a PARK per fixar-ho.
- **V1 → V2**: per cada clip de l'interval,
  `Logic.Clips.insertNoAudio(c.name, SRC, c.start, null)` (insereix per nom **i elimina l'àudio
  enllaçat**) + `Clips.retrim(SRC, idx, c.inPoint, c.outPoint, c.end)` amb els in/out **reals** del
  clip font → la còpia mostra exactament el mateix fragment (i el darrer queda retallat al fi).
- `_ipdPlusMotion` (INFERIOR a V1 · SUPERIOR a V2) es manté.

**Cache-buster:** `flow_graphics.js?v=15` · **Harness:** 44 OK / 0 FAIL.

---

## 🔧 FIX 44 — IPD+: V2 puja a V3 sense tallar-se pel davant · recort inferior de la capa superior · log de control de la posició

**Símptomes (usuari):** *"el clip en V2 no se corta de inicio antes de subirlo"* · *"la posición vertical no se
está calculando correctamente"* · i nova especificació: *la capa superior porta un **recorte inferior del 15,1%***.

**Causes i fixos:**
1. **V2 → V3 no es tallava pel davant**: es feia `Clips.retrim` **sobre el clip ja existent** de V2 i
   Premiere no sempre accepta el nou `inPoint` en un clip existent (només aplicava el final). Ara es fa
   **igual que la còpia que SÍ funciona**: `Logic.Clips.insertNoAudio(nombre, PARK, rng.start)` +
   `Clips.retrim(PARK, idx, inPt, outPt, rng.end)` amb `inPt = inPoint + (iniciInterval − clip.start)`
   → el fragment puja a V3 tallat pels dos costats i **sense àudio**.
2. **Alliberar V2**: es treuen **tots** els clips de V2 dins l'interval (abans es deixava el primer).
3. **Revertir (toggle)**: ara esborra V2 i V3 dins l'interval i **re-insereix el clip original de V2**
   amb els seus in/out i rang d'abans (desats a `_ipdPlusStates['src']` en aplicar) — abans V2 quedava
   només amb el fragment.
4. **Atributs**: `SUPERIOR` passa a `{ position: [161, 812], scale: 50, cropBottom: 15.1 }` (la capa
   inferior V1 es manté `{ position: [1058, 812], scale: 110 }`).
5. **Posició vertical**: el JSX normalitza la `position` dividint per `frameSize` (**X per l'amplada**,
   **Y per l'alçada**), però el motor NewWorld pot esperar la **Y amb la mateixa escala que la X**
   (fracció de l'amplada) — és el mateix patró que fa servir `Anim.debugPos`, que normalitza la X amb
   `px / seqW`. S'ha afegit un **log de lectura de control** després d'aplicar el Motion
   (`… llegit → {position:[…]}`) per veure què queda realment i, amb el **tamany de frame de la
   seqüència**, ajustar l'escala de la Y.

**Cache-buster:** `flow_graphics.js?v=17` · **Harness:** 44 OK / 0 FAIL.

---

## 🔧 FIX 45 — IPD+: el clip de V2 (i la resta del seu material) ja no desapareix

**Símptoma (usuari):** *"el resto del clip original que debería quedar en V2, en algún momento se borra y
desaparece; hay que regenerarlo o conseguir que no se elimine. Es un PNG, no debería ser problema"*.

**Causa:** al alliberar V2 per posar-hi les còpies de V1, `_ipdPlusAplicar` feia `Clips.removeAt` de
**tots** els clips de V2 que solapaven l'interval → si el clip de V2 era llarg (un PNG de fons de tot el
bloc) **desapareixia sencer**, no només el tros de l'interval.

**Fix:** per cada clip de V2 de l'interval es fa `removeAt` i tot seguit **es reposen els trossos que
queden FORA de l'interval** (abans i després) amb `insertNoAudio` + `Clips.retrim`, amb els in/out
calculats respecte del seu propi `inPoint`:
```
🎬 [IPD+]   alliberat V2@65.56s (interval) → OK
🎬 [IPD+]   V2 MANTINGUT tros anterior 63.00s→65.56s → OK:in=…,out=…,end=65.560
🎬 [IPD+]   V2 MANTINGUT tros posterior 117.88s→200.28s → OK:in=…,out=…,end=200.280
```

**Pista bloquejada:** `IPD+` ja crida `_dpUnlockTracks()` a l'inici (desbloqueja **V1–V5 i A1–A2**, log
`🔓 [DoblePantalla] Pistes desbloquejades (V1-V5, A1-A2)`) → hauria de funcionar encara que la tinguis
bloquejada a mà. Si el log no mostra aquesta línia, caldrà afinar-ho.

**Pendent (usuari):** la **posició vertical del clip superior** — el log confirma que el valor s'aplica i
es llegeix igual (`{"position":[161,812],...,"cropBottom":15.1}`), així que el desajust és
d'interpretació d'eixos/frame o de la compensació del retall inferior.

**Cache-buster:** `flow_graphics.js?v=18` · **Harness:** 44 OK / 0 FAIL.

---

## 🔧 FIX 46 — IPD+: Y del clip superior, desbloqueig de V2, tros posterior i àudio del programa

**Dades de l'usuari:** la **Y del clip superior és 197** (abans havia passat 812 per error) · *"el track V2
nunca se desbloquea; tengo que desbloquearlo manualmente"* · *"el clip original de V2 queda antes del
intervalo pero después se ha borrado"* · *"al insertar las copias en V2 se colocan sus audios y al
eliminarlos se eliminan también los audios originales"*.

**Fixos:**
1. `SUPERIOR: { position: [161, 197], scale: 50, cropBottom: 15.1 }` — **Y = 197**.
2. **Desbloqueig explícit** a `runIpdPlus`: a més de `_dpUnlockTracks()` (V1–V5 + A1–A2), es
   desbloquegen **TOTES** les pistes de vídeo i àudio de la seqüència amb log per pista:
   `🔓 [IPD+] Desbloqueig de pistes (9V+2A) → V1=OK V2=OK …`.
3. **El tros posterior de V2 es reposa AL FINAL** del mètode: `Clips.insert` fa **overwrite des del
   start**, així que inserir-lo abans feia que les còpies de V1 se l'enduguessin. Com que és l'últim
   material de la pista, al final no destrueix res.
4. **Àudio del programa**: s'ha deixat d'usar `Logic.Clips.insertNoAudio` a IPD+ (la seua xarxa de
   seguretat esborra àudio **per nom** i el material d'IPD+ és el **mateix MP4 del programa** → s'enduia
   l'àudio original). Nou helper **`_ipdPlusPoner`**: `Clips.insert` + **`Clips.removeLinkedAudio`**
   (només l'àudio d'aquell clip) + `Clips.retrim` → cap efecte sobre l'àudio original.
   (`flow_mapa.js` segueix amb `insertNoAudio`: allí els grafismes tenen noms diferents.)

**Cache-buster:** `flow_graphics.js?v=20` · **Harness:** 44 OK / 0 FAIL.

---

## 🔧 FIX 47 — IPD+: sense desbloqueig de pistes · neteja final de l'àudio d'A2+

**Peticions d'usuari:** *"elimina esa parte [el desbloqueig], dejaré el track desbloqueado en el proyecto
plantilla"* · *"al final de todo el proceso, el codigo no elimina los audios en A2. Añádelo"*.

**Fixos (`flow_graphics.js`):**
- `runIpdPlus`: **fora** el bloc de desbloqueig explícit **i** la crida a `_dpUnlockTracks()`.
  (`_dpUnlockTracks` es manté per a la Doble Finestra i el MAPA, que sí que el fan servir.)
- Nou **`_ipdPlusLimpiarAudio(rng)`**: al final del procés (després d'aplicar **o** revertir) esborra
  els clips d'àudio que les insercions hagin deixat a **A2 i següents** dins l'interval —
  **A1 no es toca mai** (és l'àudio del programa). Log:
  `🎬 [IPD+]   àudio netejat A2 "…" @Xs → OK` · `🎬 [IPD+]   cap àudio a A2+ per netejar`.

**Cache-buster:** `flow_graphics.js?v=21` · **Harness:** 44 OK / 0 FAIL.

---

## 🔧 FIX 48 — IPD+ v3: insercions amb INSERT+RIPPLE (ja no es mengen els altres IPD+)

**Símptoma (usuari):** en tornar a clicar IPD+ *"insertó los clips pero se cargó todos los clips de otros
IPD+ que cliqué antes"* (també amb el clip de V2). Proposta seva: *"crear el bloque de clips más allá del
OUT y moverlo a su lugar definitivo para no machacar nada"*.

**Causa:** `Clips.insert` fa **overwrite des del start durant la durada SENCERA del media** (TNM_V1_CLIP
= 200 s) → en tornar a treballar dins un interval ja tractat es menjava tot el que hi havia més enllà
(els altres talls d'IPD+).

**Fix (v3), `flow_graphics.js`:**
- Les insercions passen a **`Clips.insertClipFrom`** (= `Track.insertClip`, **INSERT + RIPPLE** →
  **NO pisa**: desplaça els clips posteriors de la pista destí). La cola desplaçada es torna al seu lloc
  amb els helpers de la Doble Finestra: `_dpColaPosterior` / `_dpMesurarDelta` / `_dpDevolverCola`.
  - fragment V2 → V3: `insertClipFrom(SRC, first.index, PARK, rng.start)` + `retrim` + `removeLinkedAudio`;
  - còpies V1 → V2: `insertClipFrom(BASE, c.index, SRC, c.start)` + `retrim` + `removeLinkedAudio`.
- El clip **original de V2 es RETALLA** al tros anterior a l'interval (`retrim` amb `end = rng.start`)
  en lloc de suprimir-lo i reposar-lo; si no té tros anterior, s'elimina.
- El tros **posterior** de V2 es reposa **al final** del mètode (`Clips.insert`: l'únic overwrite que
  queda, i només va cap endavant, on ja no hi ha res).
- El **revertir** re-insereix l'original amb `Clips.insert` + `removeLinkedAudio` + `retrim` (aleshores
  V2 està buit a l'interval → inocu).

**Cache-buster:** `flow_graphics.js?v=22` · **Harness:** 44 OK / 0 FAIL.

---

## 🔧 FIX 49 — Esborrat del contingut de V2: target del MP4 i neteja de l'OUT massa àmplia

**Símptoma (usuari):** *"ahora que he desbloqueado el track V2, veo que el proceso de carga del proyecto
acaba borrando el contenido del track V2. Parece algo que ocurre cerca del momento en que se inserta el
clip mp4 en el timeline"*.

**Causes (2):**
1. `js/logic/3_Project_Logic.js`: el MP4 s'insereix a V1 amb `Clips.insert` / `Clips.insertWithBounds`
   (= `overwriteClip`). Si **qualsevol altra pista té el TARGET actiu**, Premiere hi escriu **també** →
   amb V2 desbloquejada, el seu contingut desapareixia.
2. `js/workflows/flow_cut.js::runCutOut` (OUT&GO): la neteja de pistes secundàries recorria **V2..V9**
   (`rippleAllOut`) → esborrava el material de composició de V2 (i de V3/V4/V5 si n'hi hagués).
   ABANS no es notava perquè V2 estava **bloquejada** i Premiere no toca pistes bloquejades.

**Fixos:**
- `3_Project_Logic.js`: abans d'inserir el MP4 es crida **`utils.targetOnlyV1('MP4→V1')`** (target només a
  V1/A1) → l'overwrite ja no pot escriure a V2 ni a la resta.
- `flow_cut.js::runCutOut`: la neteja comença a **V3** (indicació d'usuari: *"la limpieza que sea de V3
  hacia arriba"*) i **preserva V1 i V2** — V2 és on viu el material de composició (IPD+ / Doble Finestra).

**Cache-busters:** `3_Project_Logic.js?v=14`, `flow_cut.js?v=14` · **Harness:** 44 OK / 0 FAIL.

**Diagnòstic ampliat (2026-09-23, sessió UPDATE TN MIGDIA V1):** a l'auditoria de crides JSX de la càrrega
**no hi ha cap operació que toqui la pista 2** (`Tracks.target(2,false)`, `Clips.count(2)` de lectura i
l'únic insert és `Clips.insertWithBounds('TNM_V1_CLIP.mp4', 1, 0, 10, 246, 'video')` **a V1**, amb target
només a V1/A1). `insertWithBounds` = `insert` + `trimBounds` + `trimAudioA2`, i aquest últim esborra clips
d'**A2** (àudio), no de V2. Per acabar-ho de fixar s'ha instrumentat la càrrega amb `_logPistas(tag)`:
```
📊 [PISTES·ABANS-INSERT]   V1=1 V2=3 V9=1
📊 [PISTES·DESPRES-INSERT] V1=1 V2=3 V9=1
```
Si a `DESPRES-INSERT` V2 apareix buida, el culpable és el propi `overwriteClip`; si no, cal buscar-ho més
enllà (sweet points / footprint / re-extracció del MP4).

**CONFIRMAT pel log de l'usuari (2026-09-23 14:01):**
```
📊 [PISTES·ABANS-INSERT]   V2=1 V9=1
📊 [PISTES·DESPRES-INSERT] V1=1 V9=1     ← V2 passa de 1 clip a 0
```
**Causa:** `Clips.insertWithBounds` fa servir **`overwriteClip`** → en re-insertar el `TNM_V1_CLIP.mp4`
acabat de re-extraure, Premiere s'enduia el clip que hi havia a **V2**.

**Fix definitiu:** a `3_Project_Logic.create` (mode normal) es substitueix `insertWithBounds` per
**INSERT + RIPPLE** + trims explícits:
```js
Clips.insertClipItem('<mp4>', 1, 0, 'video')                       // ripple: NO pisa cap pista
Clips.trimBounds(0, mp4InPt, mp4OutPt, 1, 'video')                 // (startSec, inPt, outPt, track, type)
Clips.trimAudioA2()
```

**Cache-buster:** `3_Project_Logic.js?v=15` · **Harness:** 44 OK / 0 FAIL.

---

## 🔧 FIX 50 — El fallback d'SRT carregava subtítols d'un altre programa

**Símptoma (usuari):** *"¿por qué en el proyecto actual se ha cargado unos subtítulos que no son del
propio proyecto?"*.

**Diagnòstic (log del projecte, 2026-09-23 14:13):**
```
🚨 SRT_EMERGENCIA: 0 arxius de 15 min seleccionats
⚠️ SRT_LOAD: els blocs de 15 min no han carregat res → FALLBACK
🆘 SRT_FALLBACK: N2 (data de treball, 5 candidat(s)) → \\...\MATINS_V5_dona_pas__...srt   ← un projecte TNC!
```
A `Scanner.srtFallback`, el **nivell 2** era `delDia` **sense cap filtre de programa**: si el N1 (prefix
`PROGRAMA_BLOC_`) no trobava res, agafava **el primer .SRT del dia** fos del programa que fos → en un
projecte TNC hi entrava un SRT de **MATINS_V5**.

**Fix (`Scanner.js::srtFallback`):** el N2 passa a exigir que el nom contingui **el programa** del
projecte (`progData.archivo`, p. ex. `TNC`). Si no hi ha cap .SRT d'aquest programa i del dia, el
fallback **no carrega res** (avisa i prou) — mai un subtítol d'un altre programa.

**Precisió de l'usuari (2026-09-23):** *"N2 hay que eliminarlo de raíz. Si no hay SRT del bloque actual,
no se carga nada. Se avisa y listo"* → **N2 ELIMINAT**: `levels` només té el **N1** (`prefix
PROGRAMA_BLOC_` + data de treball). `Scanner.js?v=10`.

**Com funciona el mecanisme principal (resposta a la seva pregunta):** `SrtEditor.loadEmergencySrt` llegeix
el directori `\\public.ad-ccrtv.local\Public\VERTICALITZACIO_INFORMATIUS\SRT_MP4_PER_TEMPS_15MINUTS`,
on els SRT estan **partits per franges de 15 minuts**; filtra pel **prefix** (programa+bloc) i per
**solapament de la finestra temporal** del bloc, agafa també el **fitxer següent** (per frases que creuen
el tall) i **re-temporitza** el troç a l'eix del projecte. NO va "buscant cada 15 minuts": tria i concatena
les franges que cobreixen el bloc.

**Cache-busters:** `Scanner.js?v=10` · **Harness:** 44 OK / 0 FAIL.

---

## 🛡️ FIX 51 — Clic fantasma del editor de subtítols activava el botó IN (ripple a V1 + movia l'OUT)

**Símptoma (usuari):** *"mientras movía clips en el editor de subtítulos, se han movido el primer clip de V1
y el Out de la secuencia"*.

**Diagnòstic (log del projecte, 2026-09-23 14:21-14:22):**
```
🖱 MOUSEDOWN canvas (regla) → media=22.44s
🖱 Timeline.set(0.600) → OK
🖱 [FOCUS] (mouseup) … (es fa servir el VBS de la tecla)
📐 [FLOW-CUT] Punt de tall (CTI): 0.60s
📍 [IN] oldOut=89.280s diff=0.600s → newOut=88.680s
✂️ Aplicant Ripple Trim In a V1 (CTI: 0.60s)          ← mou el 1r clip de V1
📍 Marcadors: 4/5 recol·locats (shift -0.60s)
```
Al deixar anar el ratolí a la REGLA de l'editor, el navegador del panell va entregar el `click` al **primer
botó de la botonera de tall (IN)** → `runCutIn` → **ripple trim in a V1** + `Timeline.range(0, 88.68)`
(OUT mogut). Descartat: no hi ha cap atall de teclat lligat a IN i `devolverFocoHost` ja fa `blur()`.

**Fix (doble, com va demanar l'usuari):** nou filtre global en **fase de CAPTURA** a `main.js` per als
botons amb la classe **`.btn-destructivo`** (afegida a `btnIn`, `btnOut` i `btnKey` a `index.html`):
- **(B)** cap clic en aquests botons dins dels **350 ms** següents a un `mouseup` fet **FORA** d'ells
  (p. ex. a la regla de l'editor) → elimina l'origen del cas real;
- **(A)** cal un `mouseup` **dins** del propi botó fa menys de 2,5 s i `event.isTrusted !== false` →
  xarxa de seguretat per a qualsevol altre origen de clics/tecles sintètiques.
El filtre fa `stopPropagation()` abans que els listeners dels botons i ho deixa al log:
`🛡️ [BLINDATGE] Click ignorat a "btnIn" (fantasma: mouseup de fora)`. Els clics reals no es veuen afectats.

**Cache-buster:** `main.js?v=67` · **Harness:** 44 OK / 0 FAIL.

---

## 🔧 FIX 52 — El nom del projecte perdia els caràcters catalans (à, è, ç, · …)

**Símptoma (usuari):** *"tengo un problema con el nombre del proyecto. Arregla el código para poder utilizar
caracteres de Cataluña"*.

**Causa:** `js/core/utils.js::sanitizeName()` passava el text a **NFD** i esborrava **tots els diacrítics**
(`normalize("NFD").replace(/[\u0300-\u036f]/g,"")`) → `Victòria` → `Victoria`, `Alçada` → `Alcada`,
`Montsià·Sud` → `MontsiaSud`. Com que aquesta funció s'aplica al **tema** (que forma part del nom del
`.prproj`, de la carpeta, del manifest i de la seqüència: `flow_mainButton.js` línies 291/323/338/401/1091),
el nom del projecte quedava malmès.

**Fix (`utils.js`):** `sanitizeName` ara fa **NFC** i **conserva** els caràcters catalans (à è é í ï ò ó ú ü
ç · L·L, apòstrof, guió, parèntesis); només elimina els **prohibits a Windows** (`< > : " / \ | ? *`) i els
de control (`\x00-\x1f`), col·lapsa espais i manté el límit de 60 caràcters.

**Verificat que no hi ha cap altre punt que els perdi:** `Project.saveAs` (JSX) rep la ruta amb
`getUtils().escape()` (duplica `\` i escapa l'apòstrof) i **no** fa `decodeURIComponent` ni cap
normalització; `flow_mapa.js::_norm()` sí que treu accents, però és **només per comparar noms** (matching),
no per generar noms de fitxer → es manté a propòsit.

**Cache-buster:** `utils.js?v=17` · **Harness:** 44 OK / 0 FAIL.

**Pregunta de l'usuari:** *"Si usas UTF-8 no funcionaria todo con normalidad?"* → **No és un problema
d'encoding dels fitxers** (el panell és Chromium i ja treballa en UTF-8). El text es fa malbé en creuar el
**pont cap a ExtendScript**:
- **Panell → motor (`evalScript`)**: els caràcters no-ASCII no viatgen segurs dins del literal →
  `utils.escape()` ara els converteix a **`\uXXXX`** (p. ex. `Alçada` → `Al\u00e7ada`), i el literal del JSX
  els reconstrueix. **Aquesta era la causa que el nom del projecte i de la seqüència perdessin els
  caràcters catalans.**
- **Motor → panell**: ExtendScript pot retornar noms **URL-encoded** (`Pruebas_TNC_V1_CAP%20POLICIA.prproj`);
  això ja es desfà amb `utils._decodeName()` (aplicat a `readFolder`, línies 510 i 572).

**Cache-buster:** `utils.js?v=18` · **Harness:** 44 OK / 0 FAIL.

---

## 🔧 FIX 54 — Nom de la SEQÜÈNCIA corrupte (mojibake: `TNC_COMENÃ‡A LA TARDOR…`)

**Símptoma (usuari):** la seqüència quedava com `TNC_COMENÃƑÂ€¡A LA TARDOR SENSE BOLETS`.

**Causa (trobada a `3_Project_Logic.js` l.114-116):** el nom de la seqüència s'enviava amb
**`encodeURIComponent`** i el JSX el desfeia amb **`decodeURIComponent`**... però **ExtendScript
decodifica l'URL-encoding com a LATIN-1, no UTF-8** → `%C3%87` (Ç en UTF-8) acabava com `Ã‡` (i amb
passades addicionals, `ÃƑÂ€¡`).

**Fix (els dos costats + compatible):**
- `3_Project_Logic.js`: `utils.escape(resClone)` i `utils.escape(finalSeqName)` (no-ASCII → `\uXXXX`,
  ASCII pur; el literal del JSX els resol als caràcters reals).
- `jsx/modules/3_Project.jsx`: nova funció de MÒDUL **`_decNombre(s)`** (fora de l'objecte!):
  si el text porta `%` → `decodeURIComponent` (compatibilitat amb cridadors antics) i, si no, es retorna
  tal qual (els caràcters ja són reals). `rename()` l'usa per als dos noms.

**Cache-buster:** `3_Project_Logic.js?v=16` · **Harness:** 44 OK / 0 FAIL.

**⚠️ FIX 54b (el de debò):** el mojibake **no naixia** al `rename`, sinó molt abans: **`escaleta_io.js:764` llegia
el JSON de l'escaleta amb ExtendScript** (`IO.readTxt`), que interpreta el fitxer com **ANSI/Latin-1** → el
`Ç` UTF-8 (`C3 87`) arribava ja com `Ã‡` i d'aquí passava al **tema**, al nom del `.prproj` i al de la
seqüència. Ara es llegeix amb **`window.cep.fs.readFile()`** (costat JS, UTF-8 natiu) i `IO.readTxt` queda
només com a respatller (amb avís al log). `escaleta_io.js?v=11`.

**DUBTES RESOLTS (2026-09-23):**
1. **Botó ♻️ (RESET) sí que re-escaneja**: `flow_srt.js::runSrtReset` fa `SrtEditor.resetToOriginal()`
   (taula + marcadors + clips de subtítols de la seqüència) i tot seguit **torna a buscar** el .SRT del
   tema/bloc: `Scan.mediaAssets(ctx, tema)` (amb el tema detectat i el prefix `{archivo}_{bloque}_`) i, si
   no en troba, `Scan.srtFallback(ctx)` — que ara només té el **N1** (programa+bloc+dia). Si no hi ha res,
   avisa i **no carrega res**.
2. **Si falta el .SRT de 15 min SEGÜENT, el mecanisme segueix**: el fitxer següent només s'afegeix **si
   existeix** al directori (no hi ha cap espera ni reintent; amb 0 candidats avisa i retorna). Les frases
   es retallen a `winEnd` (`realEnd = Math.min(cand.startSec + ent.endSec, winEnd)`), així que la frase que
   creuava el tall queda **truncada al límit del bloc** (no s'estira ni bloqueja el procés).










---

## 2026-09-24.md

# 2026-09-24 · Ruta de treball per BLOC (subcarpeta dins la data)

## 🎯 Objectiu
Els projectes de blocs diferents (V1, V2…) es barrejaven a la carpeta del dia i no es podia
saber a quin bloc pertanyia cada fitxer. Nova ruta de treball:

```
<destinoBase><prog>_PROJECTES/<YYYY_MM_DD>/<V*>     ← tot el bloc viu aquí dins
```

## ✅ Canvis
1. **`utils.js`** — nou helper **`getUtils().workFolder(ctx)`** = base + `progData.directorio`
   + `dateDir` + bloc (`sanitizeName` → només ASCII). Punt únic de veritat per a la ruta.
2. Substituïts els **composicions manuals** de la carpeta (eren 9 fitxers / 17 línies):
   - `4_Context.js:249` — ruta de recerca de projecte existent (ara mira dins el bloc).
   - `escaleta_io.js:307/655` — escaleta local (`escaleta_on_demand_*.json`).
   - `session_manifest.js:23/99` — manifest i `projectFolder`.
   - `3_Project_Logic.js:514` — còpia del SRT al costat del `.prproj`.
   - `flow_mainButton.js:87/119/462/701/1093/1131/1161/1264` — projecte, MP4 del bloc,
     renombrat i comprovacions.
   - `main.js:746` — `folderDest` de la FOTO.
   - `flow_render.js:140/474` — fallback de render/portada (ara no cau a l'arrel).
   - `16_Analysis_Logic.js` — anàlisi.
3. **`16_Analysis_Logic.js`** — el JSON d'anàlisi passa de ruta **relativa**
   (`analisis_estructura/...`, impredictible) a **absoluta** dins la carpeta del bloc, i crea
   la subcarpeta amb `ensureFolders` abans d'escriure.
4. **`assembly_context.js`** — en obrir un projecte ja realineava `dateDir` des del `Project.path()`;
   ara també realinea **`ctx.bloque`** llegint el segment següent a la data (`<data>/<V*>/x.prproj`).
5. **`3_Project_Logic.js:319`** ja feia `ensureFolders(folderPath)` → la carpeta `V*` es crea
   sola abans del `saveAs`.
6. Cache-busters: `utils 21`, `4_Context 20`, `escaleta_io 12`, `session_manifest 7`,
   `3_Project_Logic 18`, `assembly_context 8`, `flow_mainButton 18`, `flow_render 23`,
   `main 68`, `16_Analysis_Logic 6`.

## 🔎 Verificació
- Harness de sintaxi: **44 OK / 0 FAIL**.
- `Context.folder()` (JSX) retorna la carpeta del `.prproj` → els renders AME i la portada
  cauen **automàticament** dins la carpeta del bloc.
- `Scanner.js`, `flow_mapa.js`, `flow_srt.js`, `flow_mp4.js`, `escaleta_fetch.js` només fan
  servir `dateDir` per a APIs/filtres de data → no necessiten canvis.
- `flow_mapa.js::_folderForDate` és la **biblioteca de grafismes** (`ZZZ_GRAFISME\<dia> MES`),
  no la carpeta de treball → es deixa igual.

## ⚠️ Pendent de testeig (usuari)
- Crear V1 i V2 el mateix dia → han d'aparèixer `<data>/V1` i `<data>/V2` separats.
- Comprovar dins la carpeta del bloc: `.prproj`, `*_CLIP.mp4`, escaleta local, `.fastpass.json`,
  SRT, portada + MP4 de render i `analisis_estructura/`.
- Segueix pendent (tema anterior): `TNC_COMENAA` (la `Ç` de l'origen arriba com a `‡` i
  s'elimina → doble `A`) i l'avís `FFmpegLogic.extractClip no disponible. Usant MP4 complet`.

---

## 🔧 Segona tanda (mateixa data)

### OUT&GO: V2 ja es retalla a l'OUT
- **Queixa**: "en el OUT&GO seguimos sin recortar el out de V2".
- **Causa**: a `flow_cut.js::runCutOut` la constant era `PRIMERA_A_NETEJAR = 3` → V3+ en amunt
  es netejava, **V1 es retallava** amb `rippleOut` i **V2 quedava intacte** (protecció afegida el
  2026-09-23 perquè el material de composició no desaparegués).
- **Fix**: `PRIMERA_A_NETEJAR = 2` → el material de composició (IPD+/doble finestra) que
  sobrepassa l'OUT també es retalla/neteja. Cache-buster: `flow_cut.js?v=15`.
- **A tenir en compte**: `rippleOut` (6_Clips_Logic) elimina els clips que COMENCEN després de
  l'OUT i retalla els que el creuen. Si tornés a desaparèixer material de V2, la variant segura
  és un mode "només retallar" (saltar-se el pas 1) per a V2.

### Marcadors: qui els mou després de l'OUT
- L'OUT&GO **no talla per cap marcador**: `runCutOut` agafa el TC del CTI (`Timeline.get()`).
- Els que SÍ mouen marcadors són les fases F del pipeline:
  `F3.5 correlationSnapMarkers`, `F4 snapFaroMarkers`, **`F6 enforceMarkerOrder`** (recol·loca un
  ítem estructural invers al tall anterior del faro) i `F5 placeInferredItems` (reubica orfes).
  → Un marcador que "no està al tall" després de l'OUT pot haver estat recol·locat per aquestes.

### Carpeta del bloc: escaleta
- L'usuari confirma que el JSON d'escaleta es deixa **fora** del `V*` (a la carpeta del dia),
  perquè altres blocs la puguin veure. Correcte tal com està.

---

## 🔧 Tercera tanda · Botons MARCADORS (TEST) vs pipeline OUT&GO

### Auditoria del cablejat (2026-09-24)
| Botó TEST | Métode cridat | Fase pipeline OUT&GO | Estat |
|---|---|---|---|
| F1 OnAir | `Markers.placeOnAirMarkers` | idem | ✔ |
| F2 Dedu | `Markers.placeDeducedOnAirMarkers` | idem | ✔ |
| F3 Prev | `Markers.placeScheduledMarkers` | idem | ✔ |
| F3.5 Correl | `Assembly.correlationSnapMarkers` | idem | ❌ **métode inexistent** |
| F4 Dens | `Assembly.snapFaroMarkers` | idem | ✔ |
| F5 Orphan | `Markers.snapOrphanMarkers` | `Markers.placeInferredItems` | ❌ fase diferent |
| F6 | *(no existia al grup)* | `Markers.enforceMarkerOrder` | ❌ sense botó |
| GF | `Markers.placeGraphicMarkers` | idem | ✔ |

### Causes
1. **`correlationSnapMarkers` es va perdre** al refactor que va dividir `flow_assembly` en 4
   dominis (commit `2542aa8`): la implementació existia a `2542aa8^:js/workflows/flow_assembly.js`
   i ningú la va portar a `flow_markers.js`. Com que `callWorkflow()` **falla en silenci**
   (`console.error` només), ni el botó F3.5 ni la fase 6 del pipeline feien res.
2. El botó amb id `btnMarksF6` vivia al grup **GRÀFICS** i feia `Mapa.run` (importador 🎨):
   l'id xocava amb la fase F6·Ordre, que per tant no tenia botó de test.

### Fix
- **Restaurada** `Markers.correlationSnapMarkers` (portada de git amb els noms actuals:
  `getAssemblyContext().loadAssemblyContext()`); `Flow_Assembly` té l'alias
  `Assembly.correlationSnapMarkers`.
- Alias nou també per a `Assembly.enforceMarkerOrder`.
- **F5** → `Markers.placeInferredItems` (la fase real del pipeline). Ctrl+clic = antic
  `snapOrphanMarkers`.
- **Botó F6 «Ordre»** afegit al grup MARCADORS → `Markers.enforceMarkerOrder`.
- El 🎨 del grup GRÀFICS passa a id `btnMapaImport` (mateixa funció `Mapa.run`).
- Cache-busters: `flow_markers 26`, `flow_assembly 8`, `main 69`. Harness: 44 OK / 0 FAIL.

### TROSSEJA recuperat al grup VÍDEO (TEST)
- El botó s'havia eliminat el 2026-09-16 (commit `ab4abf9`) argumentant que TROSSEJA ja es fa
  dins del pipeline OUT&GO (fase 2 → `Cut.runScene`).
- **Recuperat com a botó TEST-ONLY** per poder testejar la fase per separat:
  - `index.html`: `<button id="btnScene" class="secondary btn-wide-flex btn-destructivo test-only">TROSSEJA</button>`
    entre IN i OUT & GO.
  - `style.css`: `#btnScene` s'afegeix a la regla d'amplada fixa de `.video-row-top`
    (via `style.css?v=57`).
  - `js/main.js`: binding `callWorkflow('Cut', 'runScene')` (via `main.js?v=70`).
  - És `test-only` → en TREBALL desapareix i el pipeline segueix sent l'únic camí.
  - És `btn-destructivo` → passa pel filtre anti-click fantasma, com IN/OUT·GO/KEYFRAME.

---

## 🔧 Quarta tanda · "Hi ha un marker a 28" (ancoratge de marcadors)

### Símptoma i evidència
Log del 2026-09-24 (TEST, clics manuals a les 8 fases):
```
📍 [ESTRUCTURAL] Àncora OnAir: 51147.000s (font: blockInSec), tlClipStart: 1682.960s, anchorEfTL: 1682.960s
🟢 [F1·OnAir] 11: → 1697.96s
```
`1682,96 s = 28:02,96` → el marcador de l'ítem `11` va quedar a **28:17**, ~28 min a la dreta del
material (el volcat de TROSSEJA del mateix dia mostrava V1 de 0,00 s a 122,52 s). Les 8 fases van
executar-se correctament (F7·Cobertura va confirmar cobertura total): el problema no era cap botó
sinó **l'ancoratge**.

### Causa
Les fases F1-F7 no busquen el vídeo: ancoraren a `clips[0].start` de la **seqüència ACTIVA**.
Si Premiere té oberta una altra seqüència (la del cleanfeed sencer, amb el bloc a 28:02), tots els
marcadors cauen desplaçats. En TREBALL no es veia perquè el botó principal ja deixava oberta la
seqüència del bloc abans de l'OUT&GO.

### Fix (js/core/assembly_context.js, punt comú de TOTES les fases)
Abans de llegir els clips d'ancoratge:
1. Resol la seqüència **del bloc** amb el mateix àtom que fa servir IN
   (`Context.findSequence(wott, bloque)` = `findSequenceByTokens`).
2. Si no és l'activa → l'obre amb `Project.openSeq` i espera 500 ms.
3. Log de l'ancoratge: `⚓ [AssemblyContext·ANCORATGE] N clips a V1 · inici=… · final=…`.
Cache-buster: `assembly_context.js?v=9`. Harness: 44 OK / 0 FAIL.

---

## 🔧 Cinquena tanda · Ancoratge (FIX A) + imant F4 (FIX B)

### Comparativa dels dos logs (la clau de tot)
| | TEST (09:2x) | OUT&GO (10:3x) |
|---|---|---|
| `manifest.ref` | `worldSecMediaStart=49500` · `tlBlockInPointSec=1685` (**vell**) | `51185` · `20.00` (**actualitzat per EXTRACT**) |
| Clip V1 | 16 clips 0→122.52s · `inPoint=22.04` · `TNC_V2_CLIP.mp4` | 16 clips 0→122.88s · `inPoint=22.04` |
| Ancoratge emprat | **1682.96s** ✗ | **−2.04s** ✗ (variant manifest: 0.00s ✓) |
| Marcador ítem `11` | 1697.96s (28:17) ✗ | 12.96s ✗ (tall real del seu inici: **15.12s**) |

### FIX A · `flow_markers.js::_calcTemporalAnchors`
Si el clip de V1 és el **CLIP EXTRET** del bloc (nom amb `_CLIP`, p. ex. `TNC_V2_CLIP.mp4`),
el seu `inPoint` és temps **del fitxer extret** i no es pot restar a `worldSecMediaStart`
(2,04s de desviament). En aquest cas mana **`manifest.ref.tlBlockInPointSec`** (ref del bloc).
Logs nous: `⚓ [ANCORATGE·FIX-A] Offset emprat: … ← …` i el `DUAL` ja existent.

### FIX B · finestra d'imant dels faros (F4)
`_snapWindowFaro()` i el valor efectiu de `11_Configuracio.js` pugen **d'1,5 → 2,5 s**: el faro
salta al **TALL D'OBERTURA** de la seva peça (el punt correcte). Amb A el marcador queda a
15,00s i F4 el clava a **15,12s** ✓. Log nou a F4 amb les dues finestres.

### Què falta a la finestra de TEST respecte OUT&GO
La **fase de preparació**: `EXTRACT` del MP4 del bloc + actualització del `manifest.ref`
(`worldSecMediaStart` / `tlBlockInPointSec`), que viu al flux de creació
(`flow_mainButton.js:796-825`), no al pipeline. A TEST cal prémer **abans** el botó principal
(NOU/ACTUALITZAR) — igual que a TREBALL — perquè el ref sigui el del clip extret. La resta
(OUT, TROSSEJA, F1…F6·GF) ja té botó. L'únic altre extra del pipeline és el snapshot final de
marcadors (`dumpMarkersSnapshot`), irrellevant per al test.

Cache-busters: `flow_markers 29`, `11_Configuracio 19`. Harness: 44 OK / 0 FAIL.

### Extra · PREPARACIÓ D'ANCORATGE a F1 (a petició d'usuari)
`Markers.ensureExtractedRef(ctx)` s'invoca **al principi de `placeOnAirMarkers` (F1)** i fa la
part de preparació de sessió que a TREBALL fa el botó principal (EXTRACT): si el `manifest.ref`
NO està en la base del clip extret (invariant
`worldSecMediaStart == worldBlockAnchorSec − tlBlockInPointSec`), i el clip del bloc
`<WOTT>_<BLOC>_CLIP.mp4` ja existeix a la carpeta de treball, **recalcula i desa el ref**
(worldSecMediaStart = anchor − handle, tlBlockInPointSec = handle, mp4SweetInPointRaw,
mp4ExpandedOutPoint/mp4Duration = span + 2·handle). NO extreu res amb ffmpeg. Si el clip no hi
és, avisa: «prem CREAR/ACTUALITZAR (EXTRACT)».
→ Amb això, prémer les fases en ordre (F1 → F7) té la mateixa funcionalitat que OUT&GO sense
prémer abans el botó principal. Logs: `🧭 [PREP-ANCORATGE] …`.
Cache-buster: `flow_markers.js?v=31`. Harness: 44 OK / 0 FAIL.







---

## 2026-09-25.md

# 2026-09-25 — Auditoria IN/OUT de punta a punta (ffmpeg → bounds → clip V1 → corchete → ancoratge)

> Objectiu: que el punt d'entrada REAL del clip (corchete IN) coincideixi amb el lloc on ha d'estar.
> Regla respectada: **les capes de marcadors C1.5→C4 NO s'han tocat** (només el servei d'ancoratge).

## 1. Primer entregable: dump `🔎 [DOMAINS]` (fase [EXTRACT])

`flow_mainButton.js → _domainsDump(cleanFeedData)`, cridat just després de llegir el clip de V1.
Una sola línia amb **tots** els dominis + 4 invariants amb OK/MISMATCH:

```
🔎 [DOMAINS] fase=EXTRACT domini=fitxer-extret
  | wsms(cleanfeed)=49500.00 base-fitxer=50282.24
  | bloc(media)=50303.00→50512.00 | handles=20.00
  | in/out(source)=783.00/1032.00
  | ffmpeg -ss 782.24 -t 309.76 (demanat 783.00, pre-roll 0.76, keyframe=OK)
  | in/out(fitxer·pla)=10.76/249.76 dur=239.00
  | clip V1 in/out(real)=10.76/249.76 start=0.00
  | seq IN/OUT=10.00/219.00
  | 0-fitxer==-ss OK · contingut==fileIn OK · clip.inPoint==pla OK · corchete-on-contingut OK
```

Invariants: (1) `0-fitxer == -ss`, (2) `(inici bloc − base) == fileIn`, (3) `clip.inPoint == pla`,
(4) `(inici bloc − base) − clip.inPoint == seqIN`.

## 2. Diagnòstic amb DADES REALS (no sospites)

### 2.1 El tall d'ffmpeg no és on es demana  ← **mesurat**
`ffmpeg -ss X -i src -c copy` arrenca al **keyframe anterior** i, amb `-c copy`, **conserva el pre-roll**.
- Font TNC V3 09/25: `-ss 783`, keyframes `782.24` i `783.24` (GOP 1 s).
- Verificació creuant juntes de silenci idèntiques font↔clip: **el fitxer arrenca a 782.187 s** →
  **0,81 s d'error sistemàtic** (el manifest creia base=50283 i la real era 50282.19).

### 2.2 Crash a mig pipeline
Log `FASTPASS.log` (NAS, 15:20:35): `💥 Error crític a runNew: zonaInOffset is not defined` — just
després del trim ⇒ **corchetes de seqüència mai fixats** i ref del manifest sense finalitzar.
Causa: `3_Project_Logic.js:375` usava el bare `zonaInOffset` (declarat només dins MODE NORMAL).

### 2.3 El manifest acabava en coords d'ORIGEN
`TNC_V1.fastpass.json` (09/25): `ref.wsms=49500`, `ref.tlBlockInPointSec=1978` (source) mentre
`extractedClip.extractedWorldSecMediaStart=50760` → escrit per `_rebuildManifestFromLocal` (3r escriptor).

### 2.4 IN·FLOOR contaminat pel mateix bloc
`TNC_V3` 09/25: l'ítem `05` (OnAir 14:00:02 + 1:50 = 50512, **dins del bloc**) arrossegava l'IN
50383 → 50512 → bloc buit → `[IN/OUT-GUARD]` → 50303 ✗ (129 s del tema anterior a la capçalera).

## 3. Fixos aplicats (cache-busters desplegats)

| # | Fitxer | Canvi |
|---|--------|-------|
| #93 | `15_FFmpeg_Logic.js` + `flow_mainButton.js` | `keyframeAtOrBefore()` (ffprobe, finestra 12 s) → `-ss` = keyframe, `-t` += preRoll, base-fitxer = wsms + `-ss`, `clipExpandedInPoint = handle + preRoll` |
| #94 | `3_Project_Logic.js` | `zonaInAdj` (fix del ReferenceError) + `_deltaIn` eliminat + `_plan`/`_clipReal` per al dump |
| #95 | `escaleta_bounds.js` | IN·FLOOR descarta els ítems del bloc actual (`_blockIdxSet`) |
| #96 | `flow_markers.js` | FIX D: `offsetAnchor` = **clip.inPoint REAL** sempre; FIX-C només si el manifest és en coords d'ORIGEN (a la guarda d'invariant) |
| #97 | `flow_mainButton.js` | `_rebuildManifestFromLocal` conserva la ref del clip extret |
| #98 | `3_Project_Logic.js` | eliminada la crida morta `Clips.trimAudioA2()` (no exposat al bridge) |

Cache-busters: `escaleta_bounds v18`, `3_Project_Logic v27`, `15_FFmpeg_Logic v8`, `flow_markers v60`, `flow_mainButton v25`.

## 4. Verificació

- `C:\temp\fp_run_syntax.ps1` → **SYNTAX: 44 OK / 0 FAIL** ✓
- `.roo/features.json` → JSON vàlid ✓ (#93-#98 afegits)
- Pendent de test a Premiere (NO s'ha commitejat res: regla «no git sense test»).

## 6. Ronda 2 (2026-09-25d) — el primer intent no va funcionar

Log real de la 2a execució (TNC V3 15:42): dos errors, un de MEU i un del helper.

| Símptoma al log | Causa | Fix |
|---|---|---|
| `💥 Error crític a runNew: mp4InPt is not defined` (just abans del corchete) | `_plan` el vaig declarar FORA del bloc MODE NORMAL, on viuen `mp4InPt/mp4OutPt/endPlanned` (mateixa classe d'error que `zonaInOffset`) | `_plan` (domini FITXER) es declara DINS MODE NORMAL (i a FALLBACK: `fileIn=0`); a fora només s'hi afegeix la geometria del corchete |
| `⚠️ [keyframe] Sense keyframe <= 783.000s → es manté -ss=783` (extracció sense snap) | El redirect crea el fitxer BUID de cop: `IO.exists` deia true i la lectura 400 ms després era incompleta/buida | Polling del CONTINGUT (30×400 ms) amb `_parseKeyframePts(raw, sec)`; sortida quan el kf és a ≤2 s del demanat o quan l'eixida s'estabilitza. **Mesurat**: 782.24 en ~800 ms (l'1a lectura parcial donava 779.24 → snap vàlid però amb 3,8 s de pre-roll) |
| `[IN·FLOOR] ... ítem anterior "09" (50550)` → `[IN/OUT-GUARD] → 50303` | El piso agafava un ítem POSTERIOR del mateix agrupacio (acaba després de l'OUT 50512) | Sostre del piso: només compten ítems que acabin abans de l'hora del PRIMER ítem del bloc (OnAir real, si no prevista) + 15 s de tolerància |

Cache-busters ronda 2: `escaleta_bounds v19`, `3_Project_Logic v28`, `15_FFmpeg_Logic v9`.
Verificació: `SYNTAX: 44 OK / 0 FAIL`. Aritmètica dels 3 dominis validada amb els números reals
de V3 (base-fitxer 50362.24, contingut 20.76, clip.inPoint 10.76, corchete 10.00 → l'inici del
bloc cau SOBRE el corchete ✓).


## 7. REPARTIR de traduccions (chyrons) — 2026-09-25e

Queixa: amb 2 clips seleccionats a V1 (+ A1), REPARTIR només omplia el **primer** clip.

Causa (`flow_chyrons.js → repartirChyronTraduccio`): la referència del tram era **un sol clip**
(el de sota la primera traducció, `_clipAtInstant`) → tots els slots hi cabien; i el límit de
l'últim slot podia ser un **marcador intern** (el tall entre els 2 clips), que encara ho truncava més.

Fix: referència del tram = **unió dels clips V1 seleccionats que INTERSECTEN el span temporal del
tram** (de l'IN del primer a l'OUT de l'últim). Amb 2+ clips no s'aplica el límit per marcador (la
selecció de l'operador defineix l'extensió); amb 1 clip es manté el comportament anterior. Slots
uniformes (`slotDur = (limit − bStart)/M`) → **durades iguals** ✓. Log nou amb `refN clip(s)` i avís
si hi ha forat > 0,5 s entre clips.

Cache-buster: `flow_chyrons v42`. Harness: 44 OK / 0 FAIL.

Pendent de limpieza: `flow_retols.js → placeChyronRepartir` és un **duplicat legacy sense botó**
(lògica antiga de rang global) → eliminar quan es toqui aquest fitxer.

### 7b. Protecció dels clips veïns de la pista (#100)

Queixa: REPARTIR va destrossar el clip veí de la dreta (un rètol `…_Llocdata_…`).

Causa: `Clips.insert` = **`overwriteClip` amb la durada COMPLETA del PNG** (no el slot) → esborra el
material del veí de la dreta; el `Clips.endAt` posterior retalla el NOSTRE clip però el veí ja està
tocat ✗.

**Evidència mesurada** (log TNV V2, 28/09 09:06): el repartiment va anar bé i el rètol Llocdata era
**just a la dreta** del límit, no dins cap slot:
```
📐 [Repartir] Tram 1/1: 5/5 trad. | ref V1 [28.64-47.44] (2 clip(s): 28.64-35.04 + 35.04-47.44) | límit 47.44s | slotDur=3.76s
   ✅ [Lloc] …_Llocdata_…_avui.00611285.mov → V8 @ 47.84s → 52.94s (dur 5.1s)
🩹 [Repartir] "…Llocdata…" tocat per un insert [49.68-52.94] → restaurat a [47.84-52.94]s (OK)
```
Així doncs el danys no era "l'insert el va esborrar i ningú el va tornar" sinó que el retorn es feia
amb `Clips.insert` → **crea una INSTÀNCIA NOVA del clip** → es perden els efectes/paràmetres/animació
aplicats per l'operador (el clip queda "estropat" tot i que start/end siguin correctes).

Fix (3 passos a `repartirChyronTraduccio`):
1. **Límit**: el repartiment s'atura a l'entrada del proper clip existent de la pista (en aquest cas
   47.44 < 47.84 → el repartiment NO canvia respecte del que l'operador va veure i li va agradar).
2. **Apartar**: els veïns dins la zona de perill (`[bStart, limit + max(30 s, slotDur)]`) es mouen
   fora de la pista amb `Clips.moveToRange` → reassigna start/end, **no** sobreescriu i **no re-crea
   el clip** → efectes i animacions intactes.
3. **Tornar**: al final es tornen EXACTAMENT a la seva posició original (mateix àtom, invers).

Logs: `🛡️ [Repartir] clip veí … apartat a …` i `↩️ [Repartir] clip veí … tornat a […]`.
`_repararClipsV7` queda com a xarxa de seguretat.

Cache-buster: `flow_chyrons v43`. Harness: 44 OK / 0 FAIL.


## 5. Pendent (ordre suggerit)

1. Test a Premiere (TNC/TNM) i llegir la línia `🔎 [DOMAINS]`: les 4 invariants han de donar OK.
2. Unificar els 3 escriptors del manifest en coords de FITXER (670/1002/1428 ja alineats a mitges).
3. Classificador de gràfics (diu «0 gràfics» amb un P2 dins).
4. Treure els logs `[SILENCI·DBG]`/`[DBG2]` i `[ANCORATGE·DUAL]` quan la geometria estigui validada.
5. Capes C1.5 (OnAir deduït) → C2 → C3 → C4.

---

## 2026-09-28.md

# 2026-09-28 — REPARTIR (traduccions/chyrons): rango de la selección, protección de vecinos y referencia de V1

Continuación del trabajo de geometría IN/OUT (ver `.roo/progress/2026-09-25.md`). Hoy, todo sobre el
botón ↔️ **REPARTIR** de CHYRONS (`flow_chyrons.js → repartirChyronTraduccio`) y el placement inicial
de traducciones (`placeChyronTraduccio`).

## #99 — El reparto sólo cubría el PRIMER clip de V1
La referencia del tramo era UN solo clip (el de debajo de la 1ª traducción) y además un marcador
interno truncaba el último slot. **Fix**: referencia = **unión de los clips V1 seleccionados que
intersectan el span del tramo** (IN del primero → OUT del último); con 2+ clips no se aplica el
límite por marcador. Verificado en el log: `ref V1 [28.64-47.44] (2 clip(s): 28.64-35.04 + 35.04-47.44)`
y 5 slots de 3.76 s uniformes ✓.

## #100 — REPARTIR estropeaba el clip vecino de la derecha (rètol Llocdata)
Medido: el vecino estaba **justo a la derecha** (V8 @ [47.84-52.94], el límite era 47.44) → no caía
dentro de ningún slot: lo rompió el `Clips.insert` (**overwriteClip con la duración COMPLETA del PNG**)
y `_repararClipsV7` lo devolvía **re-creando el clip** (`Clips.insert`) → se perdían efectos/animación.
**Fix** (3 pasos): (1) límite del reparto = entrada del siguiente clip existente; (2) los vecinos de la
zona de peligro se **mueven** fuera con `Clips.moveToRange` (no sobreescribe, **no re-crea**) y (3) se
devuelven exactamente a su posición. Logs `🛡️` / `↩️`. En el log real: 6 vecinos apartados y devueltos ✓.

## #101 — Las 2 últimas traducciones salían fuera de su clip de referencia (TC=01.10)
Medido: `_snapToNearestCut` **rechaza los cortes ANTERIORES** por diseño → TC=01.10 (ideal 70.00 s con
corte real en 69.68 s) devolvía 70.00 s (que no es un corte) → la búsqueda de la referencia exigía
coincidencia EXACTA (`|cl.start − clipStart| < 0.05`) → no la encontraba → fallback `clipEnd = clipStart + 10`
(10 s fijos) → 2 slots de 5 s = 70→80 s, cruzando el corte de 77.48 s.
**Fix**: la referencia es el clip de V1 que **CONTIENE** el punto ideal (si no hay, el más próximo) y el
reparto empieza en **su IN** → las N traducciones llenan exactamente el clip ([69.68-77.48] → 2×3.90 s).
El fallback de 10 s queda sólo si V1 no tiene clips (con WARN). Extra: el insert inicial ya no pasa
`endSec` (quirk: la API lo aplicaba al ÚLTIMO clip de la pista y lo recortaba) → `Clips.endAt` por tiempo,
y el log dice la pista real (V8) en lugar de "V7".

## #102 — El rètol del CONDUCTOR no es col·locava mai (amb un ✅ fals)
Medido (logs 28/09 09:32 i 10:54, TNV V3): el conductor **no és mai al projecte**. El desplegable
`#conductor` llista els `.mov` de la biblioteca del NAS (`cfg.rutas.conductors` via
`Context.syncConductorUI`), **no ítems del projecte** → `Clips.insert('Conduct_*.mov')` tornava sempre
`ERR_ITEM_NOT_FOUND` (el log 10:54:43 ho deia: «Cap fitxer Conduct_*.mov al projecte») i, com que
`placeChyronConductor` no mirava el resultat de l'insert, registrava `✅ col·locat` (fals positiu).
**Fix (2 fases)**: (1) `_ensureConductorInProject(domValue)` (substitueix `_resolveConductorFile`): ítem ja al
projecte (nom exacte/sense extensió/equivalent) → usa el nom REAL; si no, importa del NAS amb la pauta
canònica (`Utils.importList(..., 'root')`) i **sondeja** el projecte; últim recurs: qualsevol `Conduct*` del
projecte (WARN); si no, ERROR i s'omet. El valor del desplegable mana **sempre** i `insertRes` es comprova
(`ERR` → ❌ + status warn). (2) **Segona causa mesurada al log de les 11:19** (secció pròpia més avall): la
ruta `rutas.conductors` apuntava a una carpeta on aquell nom no existeix → la ingesta no es podia completar
mai.

## Verificación (2026-09-28, tancament de sessió)
- **Nou harness REAL** `bin/check_js_v8.ps1`: compila els 66 `.js`/`.jsx` amb V8 (Chromium headless, el
  mateix motor que el CEF del panell) via `new Function(src)` → detecta SyntaxError de debò sense executar
  res. Resultat: **66 fitxers · 65 OK · 1 FAIL** (`flow_chyrons.js` → OK ✓).
- L'únic FAIL és `js/core/escaleta_trim.js`: fitxer **truncat** (acaba dins d'un JSDoc a L94), **no el
  carrega `index.html`** i duplica funcions que ja viuen a `escaleta_bounds.js` (`_findCaretasBetween` L506,
  `calcPrecisionTrimBounds` L758 — aquest sí que es carrega) → codi mort.
- ⚠️ `bin/check_js_balance.ps1` dóna **fals positiu** a `flow_chyrons.js` (L353): no entén els template
  literals, així que l'apòstrof de `s'ha` dins d'un `` ` `` li desequilibra el comptatge. No fer-lo servir
  com a única prova de sintaxi.
- Contractes verificats a mà per a #102: `Utils.importList(pathList, binName)` (utils.js L629) ·
  `Utils.delay` (L714) · `FASTPASS.Project.items('')` → fills del root (3_Project.jsx L303; mateix patró que
  3_Project_Logic.js L151) · `cfg.rutas.conductors` **acaba en `\`** (11_Configuracio.js L25) i el valor del
  desplegable és el nom complet amb `.mov` (4_Context.js L1000) → la concatenació és correcta · botó
  `btnChyronConductor` → `placeChyronConductor` (main.js L644) + drecera «Conduct» (L975).
- Cache-buster: `flow_chyrons.js?v=46` a `index.html` · `.roo/features.json` #102 reescrit.

## Pendiente
1. **Test en Premiere** de #99/#100/#101/#102/#103 (recarregar el panell perquè agafi **v48**) → commit conjunt
   (sense commit encara: regla «no git sense test». ⚠️ El USB de Git sí que hi és avui, però **a `F:`**:
   `F:\PortableGit\bin\git.exe` v2.49.0, proxy OK i branca `main` amb 5 fitxers modificats a l'stage pendent.)
2. `flow_retols.js → placeChyronRepartir`: duplicat legacy sense botó → eliminar.
3. `js/core/escaleta_trim.js`: fitxer truncat i duplicat, sense carregar → eliminar (decidir amb l'usuari).
4. Protecció de veïns també al placement inicial (`placeChyronTraduccio` inserta traduccions amb
   overwriteClip; avui només REPARTIR les protegeix).
5. ✅ FET (28/09): `runAutoPlacement` ja resol el conductor amb `_ensureConductorInProject` (les dues
   lectures del desplegable) — segueix sense botó enllaçat.
6. (Opcional) Auto-sync del desplegable programa/bloc amb el projecte obert.


## #102 — SEGONA CAUSA (log de les 11:19, projecte `04_TN VESPRE_PROJECTES/2026_09_27/V1`)
```
[11:19:20] 📥 [Conductor] "Conduct_Toni Cruanyes.mov" no és al projecte →
           important del NAS: //DSMEDIA07/portal324/CHYRONS CONDUCTORS 3CATINFO WOTT/Conduct_Toni Cruanyes.mov
[11:19:28] ⚠️ [Conductor] La importació no ha creat cap ítem per a "Conduct_Toni Cruanyes.mov".
[11:19:28] ❌ [Conductor] Sense conductor insertable (…)
```
- **Cap `🔴 Error Ingesta`** al log i **0 aparicions de `Conduct_`** al `.prproj` guardat → la ingesta no va
  arribar a passar. `2_IO.jsx` crida `proj.importFiles(paths, true, rootItem, false)`, que és **asíncron i no
  llança** amb una ruta inexistent → `Utils.importList` sempre torna sense error i el `delay(500)` era una
  comprovació inútil (un nom inexistent no apareix mai).
- El nom del desplegable (`Conduct_Toni Cruanyes.mov`) **no existeix** a `CHYRONS CONDUCTORS 3CATINFO WOTT\`
  (allà són `Conduct_TNV_Toni Cruanyes.mov`, amb token de programa). Sí que existeix a
  `…\PROJECTE 9x16 PREMIERE 2\CHYRONS CONDUCTORS\`, que és **exactament la carpeta de `Profile.json`**
  (`rutas.conductors`). El runtime, però, usava el *fallback* de `11_Configuracio.js` L25.
- `Profile.json` (arrel de l'extensió, 4,3 KB) **no el carrega ningú**: a `js/` només se'l menciona en
  comentaris → la config viva és sempre el fallback (pendent de decisió: carregar-lo o eliminar-lo).
**Fix**: (a) `11_Configuracio.js` L25 → `\\DSMEDIA07\portal324\PROJECTE 9x16 PREMIERE 2\CHYRONS CONDUCTORS\`
(alineat amb `Profile.json`; conté TOTS els noms que ofereix el desplegable); (b) `_ensureConductorInProject`
resol el **nom real** dins de `cfg.rutas.conductors` abans d'importar (clau normalitzada: sense `Conduct[_]`,
sense token de programa, sense accents ni extensió → lliga noms antics i moderns en les dues direccions i
prefereix el del programa actiu), valida amb `readdir`/`stat` i diu `❌ El fitxer no existeix a la
biblioteca: <ruta>` en lloc de fallar en silenci, i **sondeja** el projecte cada 500 ms fins a 20 s (`⏳`
cada 5 s) perquè la ingesta és asíncrona; (c) `runAutoPlacement` ja no passa el valor cru del desplegable.
- Cache-busters: `flow_chyrons.js?v=47` · `11_Configuracio.js?v=21`.

## Validació automàtica de #102 — 17/17 PASS (unit test amb la funció REAL)
`C:\temp\fp_cond_test.html`, executat amb Edge headless (`C:\temp\fp_run_cond_test.ps1`): **extreu la funció
`_ensureConductorInProject` del fitxer de producció** i li injecta un NAS i un projecte simulats (amb ingesta
asíncrona simulada). Asserts OK: cas real 28/09 (nom antic → `Conduct_TNV_Toni Cruanyes.mov`, importa la ruta
real, sondeja, `✅`), ítem ja al projecte (no importa), fitxer inexistent (`null` + error explícit, **cap ✅
fals**), fallback `Conduct*` (WARN), direcció inversa modern→antic, timeout de 20 s (`null` + WARN) i
`readdir` caigut amb `stat` OK.

## #103 — REPARTIR només tenia en compte el PRIMER clip seleccionat de V1 (28/09, 11:35)

**Símptoma (usuari)**: «al repartir subtítols només té en compte el primer clip seleccionat a V1;
fa una estona funcionava bé».

**Evidència MESURADA** (`…\PROVES\FASTPASS.log`, projecte `Pruebas_TNV_V2_ITALIA…`, 2 intents):
```
[11:34:49] 📦 [Traducció] TC=00.29: 5 clips @ 28.44s (dur=6.40s) ← clip V1 [28.44-34.84]s   ← COLOCAR (#101)
[11:35:08] 🎯 [Repartir] V1: 2, Trad (V8): 5                                                 ← 2 clips V1 seleccionats
[11:35:08] 📐 [Repartir] Tram 1/1: 5/5 trad. | ref V1 [28.44-34.84] (1 clip(s): 28.44-34.84) ← només 1 ✗
           … 5 slots de 1.28s (6.40s en total) → el 2n clip seleccionat queda BUIT
```

**Causa**: interacció entre dos canvis NOSTRES (cap d'ells commitejat):
1. **#101 (COLOCAR, mateix dia)**: la referència és el clip que CONTÉ el punt i el repartiment arrenca al
   SEU IN (`refStart = refClip.start`) → les 5 traduccions queden **encerrades dins** de `[28.44-34.84]`.
2. **#99 (REPARTIR, 25e)**: la referència del tram es filtrava per **intersecció temporal** amb el span de
   les traduccions (`spanClips = selectedV1.filter(c => c.end > gFirst && c.start < gLast)`) → si les
   traduccions no toquen el 2n clip, el filtre el descarta → `refN=1`.

Abans «funcionava» **per accident**: el fallback vell de COLOCAR (`clipEnd = clipStart + 10`) desbordava les
traduccions fora del clip i el span arribava al clip veí. No és cap funció compartida (`getTrackClips`,
`Clips.get`/`Clips.count` estan intactes a HEAD): el defecte era que REPARTIR deduïa l'extensió del span de
les traduccions en lloc de la **selecció de l'operador**.

**Fix** (`repartirChyronTraduccio`): la referència del tram es calcula **per posició dins la selecció de V1**:
`selOrd = selectedV1.sort(start)` · `idx0` = primer clip amb `end > gFirst` (o el darrer) · `idx1` = el clip
ANTERIOR al que conté l'inici del tram SEGÜENT (`gNextFirst`) o el darrer clip seleccionat → es conserva
l'esperit de #99 (cada tram dins del SEU material, el bloc 2 no envaeix el bloc 1) i amb **1 sol clip** el
comportament és idèntic a l'anterior.

**Validació**: `bin/check_js_v8.ps1` → `flow_chyrons.js` OK (65/66; l'únic FAIL és el codi mort
`core/escaleta_trim.js`). Test funcional REAL `C:\temp\fp_rep_test.html` (+ `fp_rep_test.ps1`) que extreu el
bloc del fitxer de producció i l'executa amb clips/grups simulats: **13/13 PASS** — cas real (2 clips → rango
`28.44→41.24`, `refN=2`), 1 clip intacte, 2 trams amb 3 i 4 clips (no invasió), tram en clip intermig i tram
anterior a tot el material. Cache-buster: `flow_chyrons.js?v=48`.

## #104 — L'IN del bloc arrencava DINS del sumari anterior (TNM V1 27/09, 14:20)

**Símptoma (usuari)**: «el punto en que entra el directo està en 2:36:00 (aprox) en el timeline, quan hauria d'estar a 00:10:00»;
el corchete IN havia de caure en un punt sense OnAir (el DIRECTE) i el punt calculat era molt anterior a l'OUT del sumari.

**Evidència MESURADA** (projecte `PROVES/03_TN MIGDIA_PROJECTES/2026_09_27/V1/Pruebas_TNM_V1_DONAPAS ALBA GIL 1.prproj`,
log `...\PROVES\FASTPASS.log` 13:54:38 + `TNM_V1.fastpass.json`):
```
🟡 Tier1-COMPETE: primer estructural "03dp" entrada=52252.00s < Tier0-IN=52336.00s. Guanya Tier1 (més aviat).
📐 [ER:Bounds] V1: IN-tier=1 OUT-tier=1 | mp4ExpandedInPoint=212.00s mp4ExpandedOutPoint=558.00s dur=346.00s
   → worldBlockStartSec=52252 (14:30:52) · OUT=52558 (14:35:58) · blockInSec=52276 (14:31:16)
```
Escaleta real del bloc `v1`: `03dp` donapas 14:32:16 (31 s, sense OnAir) · `03dir` **DIRECTE PUERTA DEL SOL** 14:32:47
(1:00, sense OnAir) · `03` +++IPD ACAMPADA+++ OnAir 14:33:47 (0:31) · `04` crònica OnAir 14:34:19 (1:39).
Sumari previ: `SM1..SM7` 14:30:00-14:31:38 + `CARETA` 14:31:38-14:32:08 + `01` 14:32:09-14:32:42.

**Causa (reproduïda en headless)**: `getItemEntradaSec('03dp')` → `_deduceOnAirEntrada` **sense** `ignoreAgrupacio`
recorre la llista cap enrere i, quan l'ítem anterior és d'una ALTRA agrupació (`SM4..SM7`, `CARETA`, `01`, `02`:
`agrupacio=null`, sense OnAir), feia `continue` **sense acumular la seva durada** → l'àncora quedava clavada a
`SM3` (OnAir 14:30:37 + 0:15 = **14:30:52**) i s'ignoraven 91 s del sumari. La ruta `ignoreAgrupacio=true`
(SÍ acumula) donava 52343 i la Prevista del 03dp (52336) guanyava pel darrer recurs BUG #21 → **Tier0-IN correcte = 52336**,
però la COMPETÈNCIA «guanya el més aviat» va fer guanyar el Tier1 erroni (52252) → IN = 14:30:52, 84 s dins del sumari.

**Fix** (`js/core/escaleta_items.js`, `_deduceOnAirEntrada`): el `continue` de frontera d'agrupació ara acumula la
durada de l'ítem saltat (`isItemEstructural` + `_getCorrectedDuration` per a caretes) → les dues rutes coincideixen.

**Validació**: repro headless amb el JSON real (`C:\temp\fp_in_test.html` + `fp_in_test.ps1`, stubs d'Utils/Config):
`_deduceOnAirEntrada('03dp')` 52252 → **52336** (14:32:16) · `calcPrecisionTrimBounds V1` **mp4In 212 s → 296 s**,
`mp4Out=558 s` intacte, `InTier=10` · `03dir` (directe) entra a 51 s del clip amb handles=20 (abans 135 s).
`bin/check_js_v8.ps1`: 65/66 OK (l'únic FAIL segueix essent el codi mort `core/escaleta_trim.js`).

**No-regressió (4/4 OK)** — `C:\temp\fp_reg_test.html` + `fp_reg_test.ps1`: el mateix motor (escaleta_timecode/config/items/bounds
reals + el JSON d'escaleta real de cada bloc) recalcula els bounds de 4 blocs i es compara amb els manifests de producció:
| bloc | mp4In/mp4Out calculat | manifest (pre-fix) | resultat |
|------|----------------------|--------------------|----------|
| TNM V1 27/09 (DIRECTE PUERTA DEL SOL) | **296,00 / 558,00** | 212,00 / 558,00 | corregit (84 s de sumari fora) |
| TNV V1 27/09 (CRÒNICA POLÍTICA) | 264,00 / 410,00 | 264,00 / 410,00 | idèntic |
| TNV V2 27/09 (ITALIA ALUMNES) | 901,00 / 1026,00 | 901,00 / 1026,00 | idèntic |
| TNV V3 27/09 (REUS CAMPANYA) | 1270,00 / 1412,00 | 1270,00 / 1412,00 | idèntic |

És a dir: el fix només mou el bloc afectat pel defecte i **no altera cap dels blocs TNV ja validats a Premiere**.

**Pendent de decidir** (dada disponible i NO utilitzada per a l'IN): el **IPD `03` té OnAir (14:33:47)** i serveix
d'àncora dura cap enrere → inici del directe = `OnAir(03) − durada(03dir)` = **14:32:47**. Si el corchete ha d'anar
al primer ítem del bloc (`03dp`, 14:32:16) o al DIRECTE (`03dir`, 14:32:47) — i amb quin handle (avui 20 s) — està
pendent de confirmació de l'usuari.

## #105 — L'IN arrencava DINS d'un VÍDEO ALIÈ encara en emissió (BV de 33 s, TNM V1 28/09)

**Símptoma (usuari)**: després del fix #104 el clip de V1 ja no arrenca dins del sumari, però a la capçalera hi ha
**un vídeo BV de 33 s** que no és del bloc; el directe entra massa tard dins del clip.

**Evidència MESURADA** (escaleta real TNM 28/09, `C:\temp\fp_tnm_items2.txt` + repro headless): el bloc `v1` =
`03dp` (donapas, 14:32:16, sense OnAir) · `03dir` (DIRECTE, 14:32:47) · `03` (IPD, OnAir 14:33:47) · `04` (crònica, 14:34:19).
Just abans, **fora del bloc**: `01 | CRONOLOGIA DE L'ACAMPADA PER L'HABITATGE | teVideo=true · font=BV · durada 0:33 ·
prevista 14:32:09 → 14:32:42 · SENSE OnAir` → el corchete IN (14:32:16 = Prevista del `03dp`) queia **26 s DINS** del BV.

**Causa**: l'IN·FLOOR de `calcPrecisionTrimBounds` només recorre `allOnAirVideos` (ítems `teVideo && horaEntradaOnAir`)
→ un vídeo **sense OnAir** (BV/BVI d'una altra agrupació o sense agrupació) és invisible i no pot fer de piso. El SOSTRE
del piso (només ítems que acabin abans del bloc, `end ≤ ref + 15 s`) també l'hauria exclòs (acaba 26 s després de l'inici).

**Fix** (`js/core/escaleta_bounds.js`): nou piso `_applyForeignVideoFloor(data, worldBlockStartSec, blockLines, 600)`,
invocat just després de `_applyBaseColumnFloor` (última paraula sobre l'IN). Per a cada ítem **fora del bloc** amb
`teVideo === true`, **sense OnAir** i amb Prevista: `end = prevista + getItemDuradaSec`; si `end > IN` (salt < 600 s) i
l'ítem no és posterior al bloc (`start ≤ ref + 15 s`), l'IN passa a `end`; s'itera fins a punt fix (vídeos aliens
encadenats). `worldBlockAnchorSec` segueix el piso. Log `🚧 [ER:Bounds] PISO vídeo aliè`.

**Validació headless** (mateix JSON real): `worldStart` 52336 → **52362 (14:32:42 = final exacte del BV `01`)** ·
`mp4In` 296 → **322 s** · `dur` 262 → **236 s** · `mp4Out` 558 s intacte · `InTier=10`; el directe entra a **25 s** del clip
(handles 20 s) i el BV només queda al marge de handle.

**No-regressió (4/4 OK)** — `C:\temp\fp_reg_test.ps1`:
| bloc | mp4In/mp4Out | resultat |
|------|--------------|----------|
| TNM V1 28/09 (DIRECTE PUERTA DEL SOL) | **322,00 / 558,00** | cas corregit (#104 → 296, #105 → 322; manifest original 212) |
| TNV V1 27/09 (CRÒNICA POLÍTICA) | 264,00 / 410,00 | idèntic |
| TNV V2 27/09 (ITALIA ALUMNES) | 901,00 / 1026,00 | idèntic |
| TNV V3 27/09 (REUS CAMPANYA) | 1270,00 / 1412,00 | idèntic |

**Pendent de confirmar amb l'usuari**: si el corchete ha d'anar al **final del vídeo aliè** (avui: 14:32:42) o al **inici
del DIRECTE** (`OnAir(03) − durada(03dir)` = 14:32:47). L'usuari diu que «en realitat és més tard» → el piso actual n'és
el **mínim exigible**; si vol ancoratge al directe, la dada ja hi és (OnAir del IPD `03`).


---

## 2026-09-29.md

# 2026-09-29 · Diagnòstic d'arrencada lenta (timing granular)

## Context
El panell trigava molt a estar llest en obrir-lo per primera vegada (el log anterior
mostrava `Context.init: 108.535 ms`, amb `Context.list()` a 15,4 s). El `_boot_timing.log`
existia però tenia poques fites: no permetia saber QUINA fase es menjava el temps.

## Fet
1. **`js/main.js` — infraestructura de timing**
   - `_bootMark` ara escriu `+<ms> ms (Δ<ms>)  etiqueta` (abans no hi havia delta).
   - Capçalera del log amb hora d'inici i llegenda.
   - API pública `window.FASTPASS_UI.Boot`:
     `mark(label[, 'force'])`, `text()`, `logPath()`, `openLog()`, `autoOpenMs()`, `setAutoOpen(ms)`.
   - **Auto-obertura del log** si l'arrencada supera 15 s (una vegada per sessió;
     `setAutoOpen(0)` ho desactiva, es guarda a `localStorage['fp_bootAutoOpenMs']`).
   - `_bootClosed`: a partir d'`ARRENCADA COMPLETA` les marques de fons (auto-refresc 60 s)
     no s'escriuen al fitxer.

2. **`js/core/4_Context.js` — fites granulars** (helper local `_bmark` + `_bsec`)
   - `init`: selectors, checkContext, syncConductorUI, TOTAL.
   - `checkContext`: `readFolder NAS`, `escaleta getStatus`, `escaleta local/FOTO`,
     `scan media+wotts`, `projecte obert+lock (JSX)`, `semàfor assets (4 crides)`,
     `semàfor NEW`, `TOTAL` (incl. sortida anticipada i catch d'error).
   - `syncConductorUI`: inici + NAS conductors (+ branca de timeout).

3. **`index.html`** — cachebusters `main.js?v=74`, `4_Context.js?v=22`.

4. **Docs** — secció "Diagnòstic d'arrencada lenta" a `docs/guides/DEVELOPMENT.md`.

## Validació
- `bin/check_js_v8.ps1` → 95/96 OK (l'únic FAIL és l'huérfano conegut `core/escaleta_trim.js`).
- Test de humo `C:\temp\fp_boot_test.ps1` (Edge headless, bloc real de main.js amb stubs
  de `cep.fs`/CSInterface/localStorage) → **22 asserts, FAIL 0**.
- Integritat: CRLF mantingut, UTF-8 sense BOM, `Δ` = U+0394.

## Mesura prèvia (orientativa)
Latència de `readdir` al NAS des d'aquest equip: `CHYRONS CONDUCTORS` 7 ms ·
`ESCALETES` 0 ms · `PROVES` 2 ms → el NAS no sembla el coll d'ampolla; els sospitosos
passen a ser les primeres crides JSX/DOM de Premiere Pro.

## Pendent
- [ ] Test a Premiere: obrir el panell i revisar `_boot_timing.log` (quina Δ és la gran).
- [ ] Commit (pendent de la prova del usuari en Premiere).

---

# Chyrons del bloc TNV_V1 «LEAD DIAGONAL TALLADA» (2 bugs · #106 #107)

## Report de l'usuari
Projecte `Pruebas_TNV_V1_DIAGONAL TALLADA.prproj` (TNV V1, escaleta única "LEAD
DIAGONAL TALLADA" + chyron + 2 GF). El conjunt de chyrons sortia desordenat:
(1) s'havia col·locat el chyron del CONDUCTOR, quan el conductor només va en ítems
de presentació (intro/donapas/off...); (2) el Tema-Títol anava «al marcador d'un
chyron» i això deixava el titullet ABANS del Tema-Títol gran.

## Evidència mesurada (no especulada)
- Log real: `\\DSMEDIA07\...\AAA_PROJECTES PREMIERE VERTICALITZACIO\PROVES\FASTPASS.log`
  (còpia a `C:\temp\FASTPASS_2909.log`, 340 línies, 09:36:23→09:40:26).
- `MARCADORS_2026-09-29_0939.txt` del bloc: `01lead@0.00`, `01 GF-@5.40`,
  `01chy@12.68`, `01 GF-1@18.52`.
- `TNV_V1.fastpass.json`: ítem `01lead` (OnAir 21:01:59 + 20 s) amb el Wott
  `Wott_TNV_v1_01lead_00.01_LEAD DIAGONAL TALLADA_612840_Tema-Titol` (10,8 s).

Log del conductor (09:40:19): `Cap marcador de plató; l'ítem 01lead no en té i no hi
ha res marcat abans → OBRE el bloc (inici 0.00s)` → `CasB Marge insuficient (3.08s
< 11.04s): Conductor @ 0.40s` → `[Conductor] Resultat insert: OK` (`→ V7 @ 0.40s`).
Log del Tema-Títol (09:40:20): `1 marcadors estructurals; ids: [1CHY]` →
`→ 12.68s (marcador 1 (base) · tc wott 00.01 IGNORAT)`; titulillo `ENTRANT → V6 @
0.40s→1.42s` i `SORTINT → 11.68s→12.68s` (11 s de forat davant del gran).

## Causes (3)
1. `_isPresenterLine` comptava el sufix **`lead`** com a ítem de plató → l'ítem
   `01lead` (entradilla amb el seu Tema-Títol, sense presentadora en càmera) passava
   per plató.
2. `placeChyronConductor` tenia un **respatller**: si l'ítem de plató de l'escaleta
   no té marcador propi al timeline, l'inseria igualment a l'inici del bloc.
3. El filtre de **marcadors estructurals** de `placeChyronTitol`/
   `_fillTitulilloGaps` era `/^\d+[a-z]{0,3}\s*-\s*.+$/i` → el sufíx `lead` (4
   lletres) quedava EXCLÒS, de manera que `markerTimeFor('01lead')` queia al
   respatller `markersByBase['1']` = **12.68 s (el marcador del `01chy` del GF)**.

## Fixos (`js/workflows/flow_chyrons.js`)
- `_isPresenterLine`: fora el sufix `lead` (queden i, dp, dir, f, off + tokens de títol).
- `placeChyronConductor`: eliminat el respatller → sense marcador de l'ítem de plató:
  ⏭️ log + `status` warn + `return`.
- `placeChyronTitol` / `_fillTitulilloGaps`: `STRUCTURAL_RE`/`STRUCT_RE` a
  `[a-z]{0,5}` (reconeix `01lead`) i **guarda `baseTakenByOther`**: el respatller per
  BASE no s'usa si un ALTRE ítem de la mateixa base té marcador amb sufíx.
- `index.html`: cachebuster `flow_chyrons.js?v=49`.

## Resultat esperat al mateix bloc
Sense conductor i el Tema-Títol gran a **0.40 s** (inici del bloc, **CasA**), sense
titulillo (CasA no en col·loca) → desapareix el "titullet abans del gran".

## Validació
- Test que EXECUTA el codi real del fichero amb stubs de Premiere:
  `C:\temp\fp_chy_test.html` + `C:\temp\fp_chy_test.ps1` (Edge headless) →
  **TOTAL 10 | PASS 10 | FAIL 0**. Cobreix: classificació de plató (lead/i/dp/f/
  títol de chyron), escenari real (0 insercions de conductor + Tema-Títol a 0.40 s +
  CasA) i 2 regressions (ítem amb marcador propi → 30.00 s; base lliure → 40.00 s).
- `bin/check_js_v8.ps1` → `TOTAL 96 | OK 95 | FAIL 1` (només l'huérfano conegut
  `core/escaleta_trim.js`).
- Integritat: sense BOM, 2576 línies totes CRLF, 0 caràcters U+FFFD.

## Pendent (d'aquesta part)
- [ ] Test a Premiere (recarregar el panell pel cachebuster): el bloc ha de quedar
      amb el Tema-Títol a l'inici i SENSE conductor.
- [ ] Decidir si convé ampliar `[a-z]{0,3}`→`{0,5}` també a `_placeChyronsByType`
      (Lloc/Nom/Resto/Traducció) i a `placeChyronConductor`: avui no reconeixen
      marcadors d'ítem amb sufíx de 4-5 lletres (p. ex. `01lead`).
- [ ] **`runAutoPlacement` (ensamblatge «THE MAGIC») té el MATEIX patró del bug #106**:
      el respatller final insereix el conductor a `clips[0].start + 7.6` sense cap
      condició d'ítem de plató, i `_placeOffBlockChyrons` el posa a cada bloc `*f`.
      Caldrà alinear-lo amb la regla nova (només amb marcador d'ítem de plató) — NO
      s'ha tocat en aquesta sessió perquè el bloc del report no el fa servir.


---

# Marcadors del bloc TNV_V2 «NEGOCIACIONS HABITATGE» (TN_VESPRE 28/09)

## Report de l'usuari (3 símptomes)
1. Alguns marcadors queden **VERDS** (color per defecte) tot i que haurien de ser
   blaus/grocs/vermells.
2. **2 marcadors desapareguts** (es creia que durant la col·locació de subtítols o
   la creació dels IPD+).
3. Un ítem **no del bloc** que hauria de portar el marcador **VERMELL** no el té.

## Evidència mesurada (no especulada)
- `PROVES\FASTPASS.log` (916 línies) + `PROVES\FASTPASS_audit.log` (crides JSX reals)
  + `...\2026_09_28\V2\MARCADORS_2026-09-29_1059.json` (snapshot: 6 marcadors)
  + `...\V2\TNV_V2.fastpass.json` (manifest).
- Pipeline OUT&GO 10:56:03→10:59:08 (9 fases), snapshot 6 marcadors:
  `01dp@0.00 · 01 GF-5@0.00 · 01dir@75.68 · 01@116.24 · 02@145.44 · 04@199.52`.
- **NO hi ha cap `Markers.clear()`** en aquesta sessió (l'única del codi és
  `flow_cut.js:138`, i el CUT IN del 10:55:58 no va registrar cap `📍 Marcadors:
  N/M recol·locats` → `markersBefore` era buit). `runAplicarIpdDesdeMarkers` (IPD+)
  i l'editor SRT només LLIGEN marcadors de seqüència (els seus `Marcador creat a Xs`
  són del seu propi JSON intern) → **cap codi va esborrar res**.

## Causes (3)
1. **#108 · VERD**: `Markers.placeByPrefixes` fa DELETE+CREATE. El JSX només aplica
   color si el placement porta `colorIdx`; si no, intenta heretar `existing.color`,
   però `Markers.get()` retorna **sempre -1** → el marcador recreat surt amb el color
   per defecte = **VERD**. Audit log 10:59:07 (F4·ASIG):
   `Markers.placeByPrefixes('[{"prefix":"01dir","timeSec":75.68,...}]')` **sense
   colorIdx** → `01dir` verd. També hi havia placements sense color a
   `_ordenarISeparar` (SEP) i `snapOrphanMarkers` (aquest forçava 6).
2. **#109 + #110 · els 2 marcadors "desapareguts"**: no es van esborrar mai, **no es
   van crear mai**. Són `02dir` i `03`:
   - `02dir` ("LIN DIRECTE PUERTA DEL SOL"): `agrupacio:null` → `getLinesForBlock`
     només accepta `agrupacio === bloc`; i `_detectUngroupedItems` l'excloïa com a
     "cua trimeada" perquè era l'ÚLTIM candidat sense OnAir (21:05:34). A més els
     vermells només es creaven dins F1·OnAir, que **no és** a `runFullPipelineOut`
     (el docstring deia que sí) i que exigeix OnAir als no agrupats → 3 forats.
   - `03` ("+++ IPD MEDIACIÓ MARICARMEN +++"): `agrupacio:v2` però **`flotant:true`**
     → `getLinesForBlock` fa `if (l.flotant === true) continue;` → fora de `lines`
     (i per tant fora de F2/F4/F5/F6/F7 i del zoom IPD+).
3. **#108 (2a part)**: el docstring de `runFullPipelineOut` llistava "OnAir (F1)" però
   l'array `phases` no el contenia → cap vermell en tot el flux automàtic.

## Fixos aplicats (només JS · JSX intacte)
- `js/workflows/flow_markers.js`:
  - nou `_colorByNumFromManifest(manifest)` (num→colorIdx des de l'escaleta);
  - `_ordenarISeparar` i `_asignarAnclasPorDuracion` afegeixen `colorIdx` a tots els
    seus placements (**#108**);
  - **xarxa de seguretat** a `_safePlaceByPrefixes`: `colorIdx` absent/negatiu → 6
    (BLAU) amb WARN, de manera que cap marcador pot tornar a quedar verd per accident;
  - nou `placeUngroupedMarkers()`: col·loca tots els `ungroupedItems` en color 1
    (VERMELL) usant OnAir i, si no n'hi ha, **`horaEntradaPrevista`** (**#110**).
- `js/core/assembly_context.js`: `_detectUngroupedItems` només exclou l'últim
  candidat si cau **després** de l'última línia orgànica del bloc (**#109**).
- `js/main.js`: nova fase `Vermells (no agrupats)` al final de `runFullPipelineOut`
  (+ docstring corregit).
- `js/workflows/flow_assembly.js`: alias `Assembly.placeUngroupedMarkers`.
- `index.html`: cachebusters `flow_markers.js v60→v61`, `assembly_context.js v9→v10`,
  `main.js v74→v75`.

## Validació
- Test que EXECUTA el codi real amb stubs de Premiere i les **dades reals** del
  manifest V2 del 28/09: `C:\temp\fp_markers_test.html` + `C:\temp\fp_markers_test.ps1`
  (Edge headless) → **TOTAL 18 | PASS 18 | FAIL 0**. Cobreix: `_getColorIdx`,
  `_colorByNumFromManifest`, `_ordenarISeparar`/`_asignarAnclasPorDuracion` amb
  colorIdx, xarxa de seguretat, `_detectUngroupedItems` amb `02dir` (+ regressió de la
  cua trimeada) i `placeUngroupedMarkers` (`02dir` → 193.12s VERMELL).
- `bin/check_js_v8.ps1` → `TOTAL 96 | OK 95 | FAIL 1` (només l'huérfano conegut
  `core/escaleta_trim.js`, no referenciat a `index.html`).

## Pendent
- [ ] Test a Premiere (recarregar el panell): el bloc V2 ha de quedar amb `01dir` i la
      resta de colors correctes, el marcador VERMELL de `02dir` (~193s) i cap pèrdua.
- [ ] **Regla d'usuari 29/09 (CONFIRMADA, PENDENT d'implementar): ítem `flotant:true` →
      marcador VERMELL**, encara que estigui inclòs al bloc («cualquier item flotante es
      como si no existiera, por lo tanto tiene un marker rojo, aunque esté incluido en el
      bloque. El editor incluye los temas que crea conveniente, pero si al final falta un
      item, lo flota»). **Afecta a les DUES sortides: directe i verticalització.**
      Avui `getLinesForBlock` els descarta TOTS (als 4 blocs) → cap marcador: és el cas
      real `03` «+++ IPD MEDIACIÓ MARICARMEN +++» del V2 (sense OnAir ni Prevista → caldria
      interpolar entre veïns d'escaleta, com fa F7·Cobertura). Vegeu BUG #111.
      ⚠️ Dubte a aclarir: l'usuari també va dir que un flotant «dura 0, perquè no s'emet» →
      concretar si el marcador vermell hi ha de ser igualment (regla principal) o només
      quan l'ítem acaba emetent-se.
- [ ] `snapOrphanMarkers` (F5, només Ctrl+clic) segueix forçant 6 quan `foundMk.color`
      no és llegible: no genera verd, però perd el color original (groc/vermell).



---

## SESSION_SUMMARY_2026_03_31.md

# Resum de la Sessió: 31 de Març de 2026

## 🚀 Refactorització "LIPO" i Estabilització del Workflow de Projectes

Aquesta sessió ha estat centrada en la consolidació de la lògica de creació i actualització de projectes (`NEW`, `UPDATE`, `LOAD`, `GO`), movent el "múscul" cap a capes de lògica modulars i simplificant els workflows.

### 1. Canvis Arquitectònics (Capes)

-   **Workflow (`flow_mainButton.js`)**: S'ha "aprimat" dràsticament. Ara actua com un orquestrador pur que:
    -   Fa servir un ajudant `_fullScan` per obtenir rètols, media i portades d'un sol cop.
    -   Actualitza els indicadors de "missing" al Context per a reportar a la UI externa.
    -   Delega la ingesta i el muntatge inicial a la capa de Lògica.
-   **Action Logic (`Project_Logic.js`)**: S'ha convertit en el motor central d'infraestructura.
    -   Nova funció `ingestAssets`: Unifica la ingesta de materials des del NAS (Wotts, MP4, SRT i PNG Portada).
    -   Lògica "Safe" de Bins: Els rètols es mouen al bin `CHY` un a uno per evitar duplicats i mantenir l'ordre.
-   **System/JSX (`3_Project.jsx`)**: S'ha fet més robust afegint `decodeURIComponent` a totes les crides de cerca i reanomenat de projectes/secuències, evitant errors amb caràcters especials.

### 2. Millores en el Flux Operatiu

-   **Suport de Portada (PNG)**: S'ha integrat l'escaneig d'un fitxer PNG que contingui "TEMA-TITOL" en el seu nom. Aquest fitxer s'importa automàticament a l'arrel del projecte.
-   **Auto-Insert en UPDATE/LOAD/GO**: 
    -   Si el sistema detecta que la pista **V1** està buida al fer un `UPDATE`, `LOAD` o `GO`, col·loca automàticament el vídeo MP4 a l'inici.
-   **Fix de Focus (Edit Mode)**: En finalitzar qualsevol acció del botó principal, el sistema activa automàticament el **targeting (foco)** de les pistes **V1** i **A1**, deixant-les llestes per a l'edició immediata.
-   **Gestió del Bloqueig (.lock)**: S'ha centralitzat la creació i manteniment del fitxer de bloqueig dins de `Project_Logic`, assegurant que qualsevol via d'entrada al projecte (creació o càrrega) protegeixi l'edició per a l'usuari actual.

### 3. Estat de l'Arquitectura (LITERAL & DRY)

-   S'han eliminat funcions redundants com `_createLock` del workflow.
-   S'ha corregit el problema de `cloneSeq` que fallava en versions anteriors en no trobar el mètode `getSequence`.
-   S'ha normalitzat l'ús de rutes amb barres `/` per a la comunicació entre JS i JSX, eliminant conflictes de caràcters d'escapament.

---
*Aquest document ha estat generat per Antigravity per a documentar l'estabilització del workflow de projectes.*
