# PLA D'EXECUCIÓ TÈCNICA: FAST >>> PASS (Blueprint v2.0)

> Context-aware: revisa l'estat real del codi abans de proposar canvis.

---

## FASE 1: Descobriment i Seguretat (Discovery Layer)

### 1.1 Project Awareness (Dinamisme)
Estat actual: PARCIALMENT IMPLEMENTAT
- `4_Context.js`: `checkContext()` ja existeix amb polling a 5000ms via `setInterval`.
- El polling ja crida els tres Inspectors i sintetitza l'estat.
- Falta guardar el nom de la seqüència activa al `State` per a validacions posteriors.

Canvis necessaris:
- `js/core/state.js`: Afegir propietat `activeSequenceName: ""`.
- `js/core/4_Context.js`: Funció `checkContext()`. Guardar `FASTPASS_UI.State.activeSequenceName` amb el resultat de `appInfo().getActiveProjectName()`.
- `js/inspectors/3_Session.js`: Verificar que `getActiveSequenceInfo()` retorna el nom de la seqüència (no el projecte).

### 1.2 Auto-verificació de Seguretat
Estat actual: NO IMPLEMENTAT

Canvis necessaris:
- `js/core/utils.js`: Nova funció `validateActiveSequence()`. Compara `State.activeSequenceName` amb el nom esperat.
- `js/workflows/flow_cut.js`: Afegir `await utils.validateActiveSequence()` al principi de `runCutIn()` i `runCutOut()`.
- `js/workflows/flow_render.js`: Afegir la validació al principi de `runVideo()`.
- NOTA: flow_mainButton.js NO necessita validació (ell és qui obre el projecte).

### 1.4 Bloqueig d'Usuari (.lock)
Estat actual: NO IMPLEMENTAT

Canvis necessaris:
- `js/inspectors/1_SourceAssets.js`: Funció `scan()`. Afegir lectura de l'arxiu `.lock` (mateix nom que `.prproj`) usant `window.cep.fs.stat`. Retornar `{ locked: true, owner: "..." }`.
- `js/core/4_Context.js`: Funció `checkContext()`. Si l'inspector retorna `locked: true` en cas de LOAD, cridar `utils.alert()` i no permetre obrir.

### 1.5 Botó Principal (ELIMINAR COLORS, MANTENIR ETIQUETES)
Estat actual: El codi actual canvia la classe CSS del botó per cada estat (btn-update, btn-go...), cosa que el fa canviar de color.
Decisió CONFIRMADA: El botó MANTÉ les etiquetes (NOU / OBRIR / ANAR-HI / ACTUALITZAR) però NO canvia de color. Un sol estil neutre per a tots els estats.

Canvis necessaris:
- `js/core/4_Context.js`: Funció `updateButton()`. Eliminar `btn.classList.remove(...)` i `btn.className = "square-large btn-*"`. Substituir per `btn.className = "square-large"` (classe única neutre).
- `style.css`: Eliminar les regles `.btn-update`, `.btn-go`, `.btn-load`, `.btn-new`.

### 1.6 Indicador de Context (4 llums)
Estat actual: NO IMPLEMENTAT. La lògica dels inspectors ja retorna dades, però no hi ha UI.

Canvis necessaris:
- `index.html`: Afegir 4 indicadors visuals (ex: 4 `<span>` o `<div>`) entre Setup i Vídeo amb IDs `indChyrons`, `indGrafismo`, `indVideo`, `indSrt`.
- `js/core/4_Context.js`: Funció `checkContext()`. Llegir els informes dels inspectors i actualitzar el color de cada indicador (gray/amber/green).

---

## FASE 2: Acció Principal (Management Layer)

### 2.1 Bins al Root
Estat actual: PARCIALMENT IMPLEMENTAT. El codi de `_performSync` en `flow_mainButton.js` ja usa `"root"` per al MP4 i SRT.

Canvis necessaris:
- `js/workflows/flow_mainButton.js`: Funció `_performSync()`. Confirmar que `importList(baseMedia, "root")` funciona correctament sense crear carpetes.

### 2.3 Taula d'Estructura (Estructura de la peça)
Estat actual: PARCIALMENT IMPLEMENTAT.
- `js/logic/13_Parser.js` ja té `BlockParser` amb `parse()`, `parseWottMetadata()` i `assignChyrons()`.
- Falta la crida a l'arrencada i el guardat a `State`.

Canvis necessaris:
- `js/core/state.js`: Confirmar l'existència de `structure: []`. (Ja existeix).
- `js/workflows/flow_mainButton.js`: Funció `_performSync()` o `_runNew()`. Afegir crida a `new FASTPASS_UI.Logic.BlockParser().parse(mp4name, prog, bloc)` i guardar a `FASTPASS_UI.State.structure`.

### 2.4 Finalització d'Estat (targeting + cabezal)
Estat actual: PARCIALMENT IMPLEMENTAT. El codi actual crida `jsx_setCTI_Safe(0)` i `jsx_setTrackTarget` però usant números fixos.

Canvis necessaris:
- `js/workflows/flow_mainButton.js`: Funció `_runNew()`. Substituir els índexs fixos per `cfg.tracks.*` (ja refactoritzat).

---

## FASE 3: Edició i Tall (Logic Layer)

### 3.1 CutIn (Ripple Trim)
Estat actual: LA BASE JA EXISTEIX.
- `js/logic/6_Clips_Logic.js`: `rippleTrimStart(trackIdx, clipIdx, cutSec, clipData)` ja existeix.
- `js/workflows/flow_cut.js`: `runCutIn()` ja crida `clipsLogic.findAtTime()` i `rippleTrimStart()`.

Canvis necessaris:
- Verificar que funciona correctament amb les noves variables del Config (`cfg.tracks.video.mp4`). Ja refactoritzat.

### 3.2 CutOut (Refactorització amb Tema + Conductor)
Estat actual: INCOMPLET.
- El tancament elimina cues però no col·loca TemaTitol ni Conductor.

Canvis necessaris:
- `js/workflows/flow_cut.js`: Funció `runCutOut()`. Afegir blocs de col·locació:
  1. `jsx_overwriteClip(State.masterTheme.name, cfg.tracks.video.tematitol, 0.0)` per al Tema.
  2. Llegir el conductor del selector de la UI i fer `jsx_overwriteClip(conductorName, cfg.tracks.video.tematitol+1, offset)` . (La lògica del conductor existia a la versió anterior, cal recuperar-la).
  3. Cabezal a `val - 1frame`.
  4. `jsx_setSequenceInOut(0.0, outPoint)`.

### 3.3 Troseja (detectScene)
Estat actual: LA FUNCIÓ EXISTEIX però el binding al botó pot estar trencat.
- `js/workflows/flow_cut.js`: `runScene()` ja crida `jsx_detectScenes(T_MP4)`.
- `js/main.js`: `btnScene` ja vinculat a `callWorkflow('Cut', 'runScene')`.

Canvis necessaris: Cap. Verificar que el botó funciona.

### 3.4 Navegació (< / >)
Estat actual: LLIGAM JA EXISTENT PERÒ FUNCIONS INEXISTENTS.
- `js/main.js`: `btnPrevClip` i `btnNextClip` ja estan vinculats a `callWorkflow('Cut', 'runPrevClip')` i `runNextClip`.
- Però `flow_cut.js` NO té aquestes funcions.

Canvis necessaris:
- `js/workflows/flow_cut.js`: Crear funcions `runPrevClip()` i `runNextClip()`. Han de cridar un bridge que busqui el clip anterior/posterior a V1 i mogui el CTI al seu centre.
- `jsx/main.jsx`: Verificar que existeix `jsx_getAdjacentClip(track, direction)` o similar. Si no, crear-lo.

---

## FASE 4: Grafismes (Graphics Layer)

### 4.1 Col·locació Intel·ligent (Anti-Colisió)
Estat actual: NO IMPLEMENTAT.

Canvis necessaris:
- `js/logic/8_Graphics_Logic.js` (CREAR): Nova funció `checkCollisionAndOffset(temaStart, conductorStart, graphicList)`. Analitza si algun grafisme de la llista solapa amb l'intro i calcula un `offset` de desplaçament.
- `js/workflows/flow_retols.js`: Funció `runPlaceChyrons()`. Després de col·locar cada chyron de la intro, cridar `checkCollisionAndOffset()` i ajustar les posicions de Tema i Conductor si cal.

### 4.2 Autocentrat
Estat actual: NO IMPLEMENTAT.

Canvis necessaris:
- `jsx/modules/7_KF.jsx`: Nova funció `FASTPASS.KF.applyAutoCentering(trackIdx, clipIdx)`. Aplica un valor fix de X=0 (centre) com a keyframe al clip.
- `js/logic/7_KF_Logic.js`: Nova funció bridge `autoCenterClip(track, clip)`.

### 4.3 Botó Fons
Estat actual: NO IMPLEMENTAT.

Canvis necessaris:
- `js/workflows/flow_retols.js`: Nova funció `runPlaceFons()`. Ha de llegir el clip seleccionat al timeline, detectar la seva pista i posició, i sobreescriure la pista `cfg.tracks.video.fondos` (V3).
- `js/main.js`: Afegir binding del botó `btnFons`.
- `index.html`: Verificar que el botó amb id `btnFons` existeix.

### 4.4 Reubicació de Botons UI
Estat actual: NO IMPLEMENTAT. Els botons <, >, Slider i KEY estan a la secció de Vídeo.

Canvis necessaris:
- `index.html`: Moure el bloc dels botons de navegació i el slider a una nova seccio "Grafisme" sous de la secció existent.

---

## FASE 5: Subtítols (SRT Layer)

### 5.1 Preparar (LOGICA A REVISAR)
Estat actual: La funció `toggleSrtWork()` bloqueja/desbloqueja pistes. La revisió és sobre on s'insereix el SRT al timeline.

Canvis necessaris:
- `js/workflows/flow_srt.js`: Funció `runSrtIn()`. Verificar que `srtLogic.cleanIn()` usa les pistes correctes via `cfg.tracks.subtitle.s1`.
- `js/logic/10_Srt_Logic.js`: Ja refactoritzat. Confirmar que els índexs de pista no estan hardcodejats.

---

## FASE 6: Sortida Final (Output Layer)

### 6.2 Portada PNG Pro
Estat actual: PARCIALMENT IMPLEMENTAT. `runPortada()` ja exporta un PNG. Falta l'aïllament de pistes.

Canvis necessaris:
- `js/workflows/flow_render.js`: Funció `runPortada()`. Afegir:
  1. Silenciar totes les pistes excepte V1 (`cfg.tracks.video.mp4`) i V4 (`cfg.tracks.video.tematitol`).
  2. Moure el TemaTitol a la posició del cabezal si no hi és.
  3. Exportar la captura (ja implementat).
  4. Restaurar l'estat muteig de les pistes.
- `jsx/modules/5_Tracks.jsx`: Confirmar que `setMute(trackIdx, muted, type)` existeix per a pistes de vídeo.

---
© 2026 FAST >>> PASS | Blueprint d'Implementació v2.0 (Context-Aware)
