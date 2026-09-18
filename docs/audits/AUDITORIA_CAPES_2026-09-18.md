# Auditoria de Capes i Estructura de Mòduls — FAST >>> PASS v2.9.5 «LIPO-PRO»

**Data**: 2026-09-18
**Abast**: 19 fitxers `js/core`, 3 `js/inspectors`, 15 `js/logic`, 13 `js/workflows`, `js/main.js`, `js/editor`, 13 mòduls JSX + `jsx/main.jsx` (≈ 1,4 MB de codi)
**Pregunta a respondre**: es compleix el model de 3 nivells (JSX atòmic ➜ capa JS genèrica de comandament ➜ capa superior orquestradora) i està ben optimitzada l'estructura (sense duplicats ni desordre)?

---

## 0. Metodologia (reproduïble)

Auditoria **estàtica** per inventari + anàlisi automatitzada (no lectura línia a línia de l'1,4 MB):

1. Inventari de fitxers i mides per capa.
2. Extracció de **tots** els wrappers exposats a `jsx/main.jsx` (blocs `$.global.X` + mètodes, incloses claus entrecomillades).
3. Extracció de **totes** les crides `callJSX('X.y'` / `callJSX(\`X.y\``) de `js/**` i creuament amb (2) → **contracte JS ➜ JSX**.
4. Detecció de fitxers no carregats (creuament amb `index.html` + `CSXS/manifest.xml`).
5. Detecció de namespaces `Logic.*` declarats més d'una vegada.
6. Recompte de crides directes a JSX per fitxer (per mesurar el respecte a les capes).

Les comandes exactes són a l'**Annex A**. Tota afirmació d'aquest document porta el fitxer i la línia.

---

## 1. Veredicte ràpid

| Premisa | Estat | Evidència |
|---|---|---|
| JSX = només funcions atòmiques | 🟡 **Parcial** | 13 mòduls, però `6_Clips.jsx` (72,7 KB / 36 mètodes) i `7_KF.jsx` (86,6 KB / 34) agrupen dominis diferents |
| Capa JS genèrica de comandament | 🟡 **Parcial** | `Logic.*` existeix i és genèric, però **~303 crides `callJSX` surten directament dels workflows** (la salten) i 2 mòduls de la capa són negoci pur |
| Capa superior única (orquestrador) | 🔴 **No hi ha una, n'hi ha tres** | `js/main.js` (61,5 KB, UI + dispatch), `flow_mainButton.js` (82,8 KB, pipelines) i `4_Context.js` (55,5 KB, polling/estat, dins de `core`) |
| Sense duplicats | 🔴 **No** | 3 namespaces `Logic.*` duplicats + `flow_retols.js` (50 KB) que ningú crida + 8 fitxers mai carregats (~60 KB) |
| Cada funció al mòdul que li toca | 🔴 **No** | 171 KB de lògica d'escaleta dins de `core/`; `4_Context.js` fent d'inspector + workflow |
| Contracte JS ➜ JSX verificat | 🟡 **1 fallada viva** | `IO.stat` a `15_FFmpeg_Logic.js:133` (i el seu propi comentari diu que no existeix) |

> [!NOTE]
> **No tot està malament**: el mapa de carpetes és correcte i coherent amb les 5 capes, JSX és atòmic en la seva majoria, el puente està centralitzat i `core/state|utils|config` és net. El que falla és el **repartiment del contingut**, la **nomenclatura** i els **desviaments de capa**.

---

## 2. Inventari per capes

### 2.1 `js/core/` — 19 fitxers (≈ 325 KB)

| Fitxer | Mida | Observació |
|---|---|---|
| `escaleta_bounds.js` | 60,9 KB | 🔴 **Lògica de negoci**, no core |
| `4_Context.js` | 55,5 KB | 🔴 Inspector + Workflow (polling, semàfors, estat) |
| `utils.js` | 43,5 KB | ✅ Cross-layer correcte (log, fs, escape, dates) |
| `escaleta_io.js` | 40,8 KB | 🔴 Negoci (lectura/escriptura escaleta) |
| `escaleta_fetch.js` | 22,6 KB | 🔴 Negoci (API digition) |
| `assembly_context.js` | 20,9 KB | 🟡 Negoci de muntatge |
| `escaleta_items.js` | 17,4 KB | 🔴 Negoci |
| `11_Configuracio.js` | 12,0 KB | ✅ Config (però **no llegeix `Profile.json`**, veure §7) |
| `escaleta_config.js` | 10,9 KB | 🔴 Negoci |
| `project_registry.js` | 7,0 KB | 🟡 Registre de projectes (podria ser inspector) |
| `session_manifest.js` | 6,3 KB | 🟡 Estat de sessió |
| `escaleta_fallback.js` | 4,8 KB | 🔴 Negoci |
| `escaleta_timecode.js` | 4,3 KB | 🟡 Utilitat de TC (ok a core) |
| `escaleta_onair.js` | 4,0 KB | ⚫ **Mai carregat** |
| `escaleta_overrides.js` | 3,8 KB | ⚫ **Mai carregat** |
| `nnews_parser.js` | 3,5 KB | ⚫ **Mai carregat** + crida `IO.readHex` inexistent |
| `escaleta_trim.js` | 4,7 KB | ⚫ **Mai carregat** |
| `state.js` | 2,1 KB | ✅ |
| `escaleta_reader.js` | 1,7 KB | 🔴 Negoci |

→ **~171 KB de lògica d'escaleta viuen a `core/`**, quan `core` és (per definició del projecte) estat/config/utilidades cross-layer.

### 2.2 `js/inspectors/` — 3 fitxers (≈ 5 KB)
`1_SourceAssets.js` (1,8 KB), `2_App.js` (1,6 KB), `3_Session.js` (1,5 KB) → ✅ **petits i ben col·locats**, però la capa està infrautilitzada (tot el que llegeix l'entorn viu a `4_Context.js`, a core).

### 2.3 `js/logic/` — 15 fitxers (≈ 207 KB)

| Fitxer | Mida | Observació |
|---|---|---|
| `3_Project_Logic.js` | 54,6 KB | 🟡 Negoci (create/ingest/assets) en la capa «comandaments genèrics» |
| `14_Assembly_Logic.js` | 33,9 KB | 🟡 Negoci (heurístiques de muntatge) |
| `Scanner.js` | 22,0 KB | 🟡 Sense número (inconsistent) |
| `10_Srt_Logic.js` | 21,6 KB | ⚠️ Declara **3 namespaces** (`SrtParser`, `WaveformGenerator`, `PrProjCleaner`) |
| `15_FFmpeg_Logic.js` | 20,5 KB | 🔴 Crida viva a `IO.stat` inexistent |
| `6_Clips_Logic.js` | 13,1 KB | ✅ |
| `13_Parse.js` | 12,4 KB | ✅ |
| `11_NNews_Logic.js` | 7,2 KB | ⚫ Mai carregat |
| `16_Analysis_Logic.js` | 5,6 KB | ✅ |
| `37_Muntatge.js` | 4,3 KB | ⚫ Mai carregat + `Arxiu.*` inexistent + duplica `Logic.Assembly` |
| `5_Tracks_Logic.js` | 3,0 KB | ✅ |
| `34_Exportacio.js` | 2,3 KB | ⚫ Mai carregat + duplica `Logic.Render` |
| `33_Animacio.js` | 2,1 KB | ⚫ Mai carregat + duplica `Logic.Anim` + usa `Eines` inexistent |
| `9_Render_Logic.js` | 2,2 KB | ✅ |
| `7_KF_Logic.js` | 2,1 KB | ✅ |

### 2.4 `js/workflows/` — 13 fitxers (≈ 519 KB)

| Fitxer | Mida | Crides `callJSX` | Observació |
|---|---|---|---|
| `flow_markers.js` | 101,5 KB | 19 | 🔴 F1-F5 + snap + persistència + helpers |
| `flow_chyrons.js` | 92,3 KB | 39 | 🔴 freeze + colocació per tipus + auto-placement |
| `flow_mainButton.js` | 82,8 KB | 14 | 🔴 4 pipelines (NEW/UPDATE/LOAD/GO) |
| `flow_graphics.js` | 71,0 KB | **92** | 🔴 Doble Pantalla + MAPA + Tòtem + IPD |
| `flow_retols.js` | 50,0 KB | 27 | ⚫ **Ningú el crida** (handlers comentats a `main.js:464-467`) |
| `flow_render.js` | 31,3 KB | 34 | 🟡 Render vídeo + Portada |
| `flow_mapa.js` | 24,1 KB | 11 | 🟡 Podria anar amb `flow_graphics` |
| `flow_srt.js` | 23,0 KB | 19 | 🟡 Conté un IIFE ExtendScript inline (L343-364) |
| `flow_mp4.js` | 15,5 KB | 4 | ✅ Viu (cridat per `flow_markers`/`flow_assembly`) |
| `flow_cut.js` | 14,9 KB | 33 | 🟡 El domini «clips» es diu «cut» |
| `flow_KF.js` | 6,3 KB | 11 | ✅ |
| `flow_assembly.js` | 5,2 KB | 0 | ✅ Façana de `Workflows.MP4` |
| `flow_config.js` | 1,5 KB | 0 | ✅ Finestra de configuració (veure §7) |

### 2.5 `jsx/modules/` + `jsx/main.jsx` (≈ 280 KB)

| Mòdul | Mida | Mètodes | Observació |
|---|---|---|---|
| `7_KF.jsx` | 86,6 KB | 34 | 🔴 Motion + slider + crops + keyframes + diagnòstic |
| `6_Clips.jsx` | 72,7 KB | 36 | 🔴 Clips + àudio + caption tracks + scenes |
| `3_Project.jsx` | 21,4 KB | — | 🟡 `cloneSequence` fa 2 coses |
| `2_IO.jsx` | 18,9 KB | — | ✅ |
| `8_Markers.jsx` | 12,6 KB | — | ✅ |
| `13_Timeline.jsx` | 8,5 KB | 12 | ✅ |
| `1_System.jsx` | 5,9 KB | 5 | ✅ |
| `11_Context.jsx` | 5,4 KB | 8 | ✅ |
| `9_Render.jsx` | 5,4 KB | 4 | ✅ |
| `5_Tracks.jsx` | 4,7 KB | 7 | ✅ |
| `14_FFmpeg.jsx` | 2,7 KB | — | ✅ |
| `12_Diagnostic.jsx` | 2,4 KB | — | 🟡 Només diagnòstic de KF |
| `main.jsx` | 32,8 KB | **110 wrappers** | 🟡 Puente mantingut a mà (deriva demostrada) |

*(`js/main.js` 61,5 KB i `js/editor/srt_editor.js` 125,9 KB — PROTECTED — completen l'inventari.)*

---

## 3. Avaluació del model de 3 nivells

### 3.1 Nivell 1 — JSX atòmic: 🟡 parcial
Els mòduls petits (`5_Tracks`, `9_Render`, `13_Timeline`, `2_IO`) **sí** compleixen el patró: una operació, retorn `string`/`JSON`, errors prefixats `ERR:`.

Els dos grans no:
- `6_Clips.jsx:275-390` `insert()` fa: buscar l'item al projecte → resoldre pista → `overwriteClip` → ajustar durada → verificar component d'àudio → **esborrar el clip d'àudio fantasma d'A1**. ≥4 responsabilitats en una «funció atòmica».
- `7_KF.jsx` barreja Motion, crops, slider (`x`, `limits`, `sliderApply`, `sliderLimits`), keyframes i diagnòstic (`probeRange`, `debugPos`, `debugKF`, `debugMotion`, `debugVideoEffects`).

> [!CAUTION]
> `Clips.insert` és el pitjor exemple perquè **arrossega efectes col·laterals no declarats** (borra clips d'A1). És exactament el bug d'àudio fantasma de la portada: el seu germà `insertClipFrom` **no** fa aquesta neteja.

### 3.2 Nivell 2 — capa JS genèrica de comandament: 🟡 parcial
`Logic.Clips` (13 KB), `Logic.Tracks` (3 KB), `Logic.Render` (2,2 KB), `Logic.Anim` (2,1 KB), `Logic.Scan` (22 KB) **són exactament el que demanes**: funcions genèriques que comanden JSX.

Però:
- **No hi ha `Logic.Timeline` / `Logic.Markers` / `Logic.IO`**: els workflows hi van directes.
- `3_Project_Logic.js` (54,6 KB) i `14_Assembly_Logic.js` (33,9 KB) són **negoci** (crear projecte, ingesta, heurístiques), no comandaments genèrics.
- `10_Srt_Logic.js` agrupa 3 dominis (parser + waveform + neteja de `.prproj`).

### 3.3 Nivell 3 — orquestrador superior: 🔴 no existeix com a tal
Hi ha **tres** «caps» repartint-se el comandament:

| Fitxer | Rol real | Problema |
|---|---|---|
| `js/main.js` (61,5 KB) | UI wiring + `callWorkflow()` + layout + PERF + polling de sagetes | No pertany a cap tier declarat; arrel de `js/` |
| `flow_mainButton.js` (82,8 KB) | Pipelines NEW / UPDATE / LOAD / GO | 4 fluxos en un fitxer |
| `js/core/4_Context.js` (55,5 KB) | Polling d'estat, semàfors, refresc de UI, lectura d'entorn | Dins de **core**, fent d'inspector + workflow |

Conseqüència: **no hi ha un punt únic** per llegir «què fa l'aplicació d'inici a fi»; cal llegir tres fitxers gegants.

---

## 4. Contracte JS ➜ JSX (verificació exhaustiva)

**Mètode**: 110 wrappers extrets de `jsx/main.jsx` (blocs `System` L63, `Context` 107, `IO` 139, `Project` 191, `Timeline` 366, `Tracks` 403, `Clips` 425, `Anim` 570, `Sequences` 656, `Render` 662, `Markers` 679, `FfmpegExt` 700) creuats amb les ~90 crides `Namespace.method` emeses des de `js/**`.

### 4.1 Crides a àtoms que NO existeixen

| Crida | Fitxer:línia | Carregat? | Gravitat |
|---|---|---|---|
| **`IO.stat(...)`** | `15_FFmpeg_Logic.js:133` | **SÍ** | 🔴 **Bug viu**; a més L83 i L120 diuen literalment «IO.stat no existeix a ExtendScript» |
| `FASTPASS.IO.*`, `FASTPASS.Project.*` | `3_Project_Logic.js` (~6 punts) | SÍ | 🟡 **Bypass** del puente (funciona, però se salta `$.global.X`) |
| `FASTPASS_UI.Sync.updateSliderFromPremiere()` | `flow_cut.js:247,248,270,271`, `flow_KF.js:102` | SÍ | 🟡 `Sync` **no està definit enlloc** → restes d'una funcionalitat retirada (guardades amb `if`, per això no peten) |
| `IO.findFiles`, `IO.readHex`, `Timeline.insertCleanClip` | `11_NNews_Logic.js:117,152`, `nnews_parser.js:28` | NO | ⚫ Irrellevant (no carregats) |
| `Arxiu.importFiles` | `37_Muntatge.js:75,96` | NO | ⚫ Irrellevant |
| `Exportacio.snapshot/queue` | `34_Exportacio.js` | NO | ⚫ Irrellevant |
| `Animacio.add/interp/remove/reframe/x` | `33_Animacio.js` (7 crides) | NO | ⚫ Irrellevant |

> [!IMPORTANT]
> **Resposta directa a «existeixen realment aquestes crides?»**: en codi **viu**, totes les crides `Clips.*`, `Anim.*`, `Timeline.*`, `IO.*` (llevat `stat`), `Project.*`, `Markers.*`, `Render.*`, `Tracks.*` i `Context.*` **existeixen**. El que no existeix està concentrat en fitxers **que ja no es carreguen** → no és un problema de contracte generalitzat sinó **brossa acumulada** + 1 fallada viva.

### 4.2 Àtoms públics de JSX **no exposats** al JS (inalcançables)

De `6_Clips.jsx` (36 mètodes) el puente n'exposa 31. Falten:
- **`Clips.getProp`** ← va fer fallar el centratge de la portada (2026-09-18): no es pot llegir una propietat des de JS
- `Clips.trimBounds`, `Clips.createCaptionFromProjectItem`, `Clips.placeSrtOnExistingSubtitleTrack` → funcionalitat morta o inaccessible

*(`_get` i `_limitarTargets` són privats: correcte que no s'exposin.)*

### 4.3 Deriva del puente
`main.jsx` manté **110 wrappers a mà** + el bootstrap `load("N_XXX.jsx")`. Cada àtom nou exigeix editar el puente **i reiniciar Premiere**. Prova de la deriva: `getProp`. És l'arrel dels errors «X.y is not a function» de la sessió de portada.

---

## 5. Qui comanda JSX directament (mesura del respecte a les capes)

La regla del projecte diu: *Workflow → crida Logic i Inspectors*. Recompte de `callJSX(` per fitxer:

| Capa | Fitxers i crides |
|---|---|
| **Workflows (haurien de delegar)** | `flow_graphics` **92**, `flow_chyrons` **39**, `flow_render` **34**, `flow_cut` **33**, `flow_retols` **27**, `flow_srt` 19, `flow_markers` 19, `flow_mainButton` 14, `flow_KF` 11, `flow_mapa` 11, `flow_mp4` 4 → **≈ 303 crides** |
| **Logic (hauria de ser l'únic camí)** | `3_Project_Logic` 44, `6_Clips_Logic` 19, `15_FFmpeg_Logic` 15, `5_Tracks_Logic` 8, `7_KF_Logic` 7, `11_NNews_Logic` 7, `14_Assembly_Logic` 5, `10_Srt_Logic` 5, `9_Render_Logic` 3, `16_Analysis_Logic` 3, `33_Animacio` 7, `34_Exportacio` 3, `37_Muntatge` 6 |
| **Core / Inspectors** | `utils.js` 4, `escaleta_io` 7, `escaleta_fetch` 4, `4_Context` 7, `3_Session` 5, `1_SourceAssets` 2, `2_App` 2, altres 1-2 |
| **Editor** | `srt_editor.js` 26 (PROTECTED) |

**Conclusió**: la capa intermèdia **existeix però no és la porta única**; en la pràctica, qui parla amb Premiere és majoritàriament el workflow. Nota honesta: el `runPortada` reescrit el 2026-09-18 també usa `callJSX` directe (mateix desviament).

**Violació greu d'exemple**: `flow_srt.js:343-364` (`exploreSubtitleTracks`) construeix un **IIFE d'ExtendScript de 20 línies dins d'un string** → lògica dins del puente, prohibit per les pròpies regles.

---

## 6. Duplicació i codi mort

### 6.1 Namespaces `Logic.*` declarats dues vegades

| Namespace | Viu | Duplicat mort |
|---|---|---|
| `Logic.Anim` | `7_KF_Logic.js:16` | `33_Animacio.js:16` (usa l'`Eines` inexistent; el seu bessó usa `Utils`) |
| `Logic.Render` | `9_Render_Logic.js:16` | `34_Exportacio.js:16` |
| `Logic.Assembly` | `14_Assembly_Logic.js:19` | `37_Muntatge.js:18` |

### 6.2 Fitxers que existeixen al disc i **mai es carreguen**
Comprovat contra `index.html` i `CSXS/manifest.xml` (`MainPath=./index.html`, `ScriptPath=./jsx/main.jsx`):

`js/logic/11_NNews_Logic.js` (7,2 KB) · `33_Animacio.js` (2,1 KB) · `34_Exportacio.js` (2,3 KB) · `37_Muntatge.js` (4,3 KB) · `js/core/nnews_parser.js` (3,5 KB) · `escaleta_onair.js` (4,0 KB) · `escaleta_trim.js` (4,7 KB) · `escaleta_overrides.js` (3,8 KB) → **≈ 32 KB**

> [!WARNING]
> Els tres `escaleta_onair/trim/overrides` **no tenen dependents** (cap fitxer carregat referencia els seus namespaces), però els noms «OnAir/Trim/Overrides» apareixen dins de `escaleta_bounds.js`/`escaleta_items.js` → **cal confirmar que la seva lògica està absorbida** abans d'esborrar-los.

### 6.3 Duplicat viu de 50 KB: `flow_retols.js`
És una còpia antiga de `flow_chyrons.js` (mateixes `_freezeTemaTitol`, `_snapToNearestCut`, `_placeChyronsByType`). `Workflows.Retols` **no el crida ningú**: a `main.js:464-467` els handlers estan **comentats**. Es carrega a `index.html:248` per no res.

### 6.4 Altres restes
- **`FASTPASS_UI.Sync`**: 5 usos, **0 definicions** → funcionalitat retirada amb restes.
- **Handlers comentats**: `main.js:464-481` (~10 línies) en lloc d'esborrats (viola «🗑️ No acumular»).
- **`IO.stat`**: comentaris que diuen que no existeix + una crida viva que l'usa.
- **`debugTracks(...).locked`**: `6_Clips.jsx:1286` el calcula amb `!!tr.isLocked`, i `isLocked` és una **funció** → **sempre `true`**. Consumit per `flow_graphics.js:525-526` (fals avís «pistes bloquejades») i causa de l'error «Totes les pistes estan bloquejades» de la portada (2026-09-18).

---

## 7. Cas pràctic: la finestra de configuració (`setup.html`)

> [!NOTE]
> **Correcció respecte a esborranys previs d'aquesta auditoria**: `setup.html` **NO és codi mort**. És una funcionalitat al ~80% que no s'ha posat en marxa mai.

### 7.1 Què ja existeix i funciona
| Peça | Ubicació | Estat |
|---|---|---|
| Botó ⚙️ | `index.html:67` `<button id="btnSetup">` | ✅ |
| Cablejat | `main.js:576` → `callWorkflow('Config','toggleSetup',true)` | ✅ |
| Obertura en overlay | `flow_config.js:16` `toggleSetup(show)` (iframe + reset) | ✅ |
| Overlay + iframe | `index.html:208-209` + `style.css:401-418` | ✅ |
| Dashboard | `setup.html` (322 línies): tabs General/Rutas/Programes/Tracks, botons *examinar*, alta/baja de programes | ✅ |
| Lectura del perfil | `setup.html` `init()` → `evalScript("IO.readTxt('<ext>/Profile.json')")` + `JSON.parse` + `drawConfig()` | ✅ |
| Desat | `setup.html` `salvarTodo()` → `IO.writeTxt(Profile.json)` + tanca l'overlay | ✅ |

### 7.2 Per què no funciona (forat a la capa Core)
1. 🔴 **La extensió mai llegeix `Profile.json`.** `js/core/11_Configuracio.js` només té `_activeConfig` = **objecte fallback hardcodejat** (L17-82). No existeix cap `readTxt`/`readFile`/`JSON.parse` de `Profile.json` a `js/**` (només comentaris). El header del fitxer promet *«init() usa Utils.callJSX»* però **`init()` no existeix** (resta d'un refactor).
   → **Efecte**: editar `Profile.json` (a mà o des del dashboard) **no canvia res**; la extensió sempre fa servir els valors incrustats.
2. 🔴 **No hi ha recàrrega en calent**: `setup.html:302` dispara l'esdeveniment CSXS `FASTPASS_CONFIG_UPDATED` i **ningú l'escolta** (0 coincidències a `js/**` + `index.html`); `_activeConfig` és privat i no té `reload()`.
3. 🟡 **Sense backup** de `Profile.json` abans de sobreescriure'l.
4. 🟡 **Sense validació** (pistes duplicades/0, IDs de programa repetits, rutes UNC buides).
5. 🟡 **Desviament de capes al propi dashboard**: `setup.html` parla **JSX directe** (`evalScript` + `IO.writeTxt`) i dispara esdeveniments CSXS, quan hauria de delegar al workflow (ja fa servir `window.parent.FASTPASS_UI...` per tancar-se → el context del panell ja el té).
6. 🟡 `setup.html` no passa pel checker de sintaxi.

### 7.3 Pla en 5 passos (respectant les 5 capes)
1. **Core** (`11_Configuracio.js`): `Config.load()` (llegir `Profile.json` amb `cep.fs.readFile`/Node i fer **merge sobre el fallback**), `Config.reload()`, `Config.save(profile)` (**backup `Profile.bak.json`** + UTF-8 sense BOM + validar + reload) i `Config.validate()`. Sense JSX nou.
2. **Workflow** (`flow_config.js`): `openSetup()` / `closeSetup()` / `applyAndClose(profile)` = validar → backup → desar → **reload** → refrescar UI → tancar amb estat.
3. **UI** (`setup.html`): treure `evalScript`/`IO.writeTxt`/`CSXSEvent`; només pintar, recollir i cridar `window.parent.FASTPASS_UI.Workflows.Config.applyAndClose(profile)`. Afegir validació en pantalla i afegir-lo al checker.
4. **Decisió de disseny**: `Profile.json` com a font de veritat amb fallback incrustat (recomanat) / obligatori / override parcial.
5. **Verificació**: obrir ⚙️ → canviar `guarda` i una ruta → GUARDAR → comprovar al log `Config cargada de Profile.json`, que `Config.get()` retorna els nous valors i que existeix `Profile.bak.json`.

---

## 8. Valoració de l'estructura de mòduls

**Veredicte: el mapa de carpetes és correcte; el repartiment del contingut i la nomenclatura no.**

### 8.1 Fitxers «god» (9 fitxers = >50% del codi)
| Fitxer | Mida | Responsabilitats barrejades | Divisió proposada |
|---|---|---|---|
| `flow_markers.js` | 101,5 KB | F1-F5, snap, visualització, persistència, TC | F1-F3 / F4-F6 / visualització+persistència |
| `flow_chyrons.js` | 92,3 KB | freeze, col·locació per tipus, auto-placement | freeze / place-by-type / auto |
| `flow_mainButton.js` | 82,8 KB | NEW / UPDATE / LOAD / GO | 1 fitxer per pipeline |
| `flow_graphics.js` | 71,0 KB | DP, MAPA, Tòtem, IPD | grafics_dp / grafics_mapa / grafics_totem / grafics_ipd |
| `7_KF.jsx` | 86,6 KB | Motion + slider + crops + KF + diagnòstic | motion.jsx / slider.jsx / kf.jsx (+ diagnostic) |
| `6_Clips.jsx` | 72,7 KB | clips + àudio + captions + scenes | clips.jsx / audio.jsx / captions.jsx |
| `js/main.js` | 61,5 KB | UI + dispatch + layout + PERF | `js/app/`: main / ui_wiring / dispatch / layout / perf |
| `4_Context.js` | 55,5 KB | inspector + workflow | inspectors/context (lectures) + workflows/flow_context (polling/semàfors) |
| `3_Project_Logic.js` | 54,6 KB | create + ingest + assets | project_create / project_ingest / project_assets |

### 8.2 Fitxers a la capa equivocada
| Fitxer | On és | On hauria de ser |
|---|---|---|
| `escaleta_bounds.js` (60,9 KB), `escaleta_io.js` (40,8), `escaleta_fetch.js` (22,6), `escaleta_items.js` (17,4), `escaleta_config.js` (10,9), `escaleta_fallback.js` (4,8), `escaleta_reader.js` (1,7) | `js/core/` | `js/logic/escaleta/` (és negoci, no cross-layer) |
| `4_Context.js` (55,5 KB) | `js/core/` | Inspector (lectures) + Workflow (polling) |
| `assembly_context.js` (20,9 KB) | `js/core/` | `js/logic/` |
| `project_registry.js`, `session_manifest.js` | `js/core/` | `js/inspectors/` (llegeixen/registren estat de l'entorn) |
| `js/main.js` | arrel de `js/` | `js/app/` (tier propi d'aplicació/UI) |
| `10_Srt_Logic.js` (3 namespaces) | `js/logic/` | 3 fitxers: `srt_parser` / `srt_waveform` / `prproj_cleaner` |

### 8.3 Nomenclatura
- ❌ **Prefixos numèrics com a ordre de càrrega**: innecessaris (l'ordre ja és explícit a `index.html` i `jsx/main.jsx`), amb forats (JSX no té 4 ni 10) i noms que no descriuen el domini (3, 5, 6, 7, 9, 10, 13, 14, 15, 16, 33, 34, 37).
- ❌ **Mateix domini, 3 noms diferents**: `6_Clips.jsx` ↔ `6_Clips_Logic.js` ↔ **`flow_cut.js`**; `flow_retols` vs `flow_chyrons`.
- ❌ **`Eines` vs `Utils`** per al mateix objecte (`33_Animacio.js` vs la resta).
- ❌ `Scanner.js` sense número mentre els germans en porten.
- ✅ Bona pràctica existent: `flow_*` per workflows i `Logic.<Domini>` pels serveis genèrics.

---

## 9. Pla d'optimització per lots

### Lote A · Neteja sense moure res (risc baix · 1 sessió)
1. Esborrar els 8 fitxers mai carregats (§6.2) **després de confirmar** que `escaleta_onair/trim/overrides` estan absorbits.
2. Treure de `index.html` el `<script>` de `flow_retols.js` i esborrar el fitxer (o decidir si es recupera el botó RETOLS).
3. Corregir el bug viu `IO.stat` (`15_FFmpeg_Logic.js:133`) amb `IO.exists` + lectura real.
4. Eliminar les 5 crides a `FASTPASS_UI.Sync` i els handlers comentats de `main.js:464-481`.
5. Eliminar el IIFE inline de `flow_srt.js:343-364`.
6. **Decidir** els 4 àtoms no exposats: exposar `Clips.getProp` (necessari) i eliminar `trimBounds`/`createCaptionFromProjectItem`/`placeSrtOnExistingSubtitleTrack` si ja no s'usen.
→ **−32 KB de fitxers + −1 bug viu**, sense tocar lògica ni JSX (no cal reiniciar Premiere).

### Lote B · Reubicar fitxers (risc baix-mitjà · canvis de `<script>` + un commit per bloc)
`core/escaleta_*` → `logic/escaleta/`; `4_Context.js` → dividir inspector/workflow; `main.js` → `js/app/`; `assembly_context` → logic; registres → inspectors.

### Lote C · Partir els god modules (risc mitjà · 1 commit per split + prova a Premiere)
Ordre recomanat: primers els JSX (`6_Clips`, `7_KF`) per agrupar els reinicis de Premiere, després `flow_markers`, `flow_mainButton`, `flow_graphics`, `3_Project_Logic`, `4_Context`.

### Lote D · Nomenclatura i contracte (transversal)
1. **Checker ampliat** (evita que tornin els desviaments):
   - Cap `callJSX` fora de `logic/`, `core/`, `inspectors/`, `editor/`.
   - Tot `X.y` cridat des de JS ha d'existir als wrappers de `main.jsx`.
   - Tot mètode de `jsx/modules/*` hauria d'estar exposat (o marcat com a privat amb `_`).
2. **Generar/validar el puente**: un script que llisti els mètodes dels mòduls i comprovi l'existència dels wrappers (fi de la deriva de 110 wrappers a mà).
3. **Renombrar per domini** (`clips.jsx` / `clips_logic.js` / `flow_clips.js`) i eliminar prefixos numèrics; l'ordre de càrrega viu només a `index.html`/`main.jsx`.
4. **Regenerar `docs/guides/ARCHITECTURE_MAP.md`**: domini → fitxer de cada capa → àtoms JSX que consumeix.

### Lote E · Posar en marxa la configuració (§7.3)
Pilot perfecte per validar la disciplina de capes en codi nou.

---

## 10. Mètriques objectiu (per mesurar el progrés)

| Mètrica | Avui | Objectiu |
|---|---|---|
| Fitxers JS > 50 KB | 9 | 0 |
| Mòduls JSX > 30 KB | 2 | 0 |
| `callJSX` als workflows | ≈ 303 | 0 (tot via `Logic.*`) |
| Fitxers al disc no carregats | 8 | 0 |
| Namespaces `Logic.*` duplicats | 3 | 0 |
| Àtoms públics no exposats al puente | 4 | 0 |
| Crides a àtoms inexistents (codi viu) | 1 (`IO.stat`) | 0 (garantit pel checker) |
| Mida màxima recomanada | — | ≤ 20 KB fitxer JS · ≤ 25 KB mòdul JSX (≈ 400 línies) |

---

## 11. Incerteses (què NO s'ha verificat)

1. `escaleta_onair/trim/overrides`: no tenen dependents, però **cal confirmar** que la seva lògica està dins de `escaleta_bounds/items` abans d'esborrar.
2. `Workflows.Retols`: només apareix en handlers comentats → confirmar que no es vol recuperar el botó abans d'esborrar `flow_retols.js`.
3. `Workflows.Config` (setup): funcionalment pendent de la decisió del §7.3 punt 4.
4. No s'ha auditat `srt_editor.js` (PROTECTED) més enllà de les seves 26 `callJSX`.
5. Els recomptes són estàtics (grep/inventari): poden existir duplicats interns addicionals (p. ex. `_freezeTemaTitol` replicat en altres workflows).
6. No s'ha comprovat en runtime quines rutes mortes s'executen de facto.

---

## 12. Relació amb altres documents

| Document | Relació |
|---|---|
| `docs/audits/Auditoria_Tecnica_v2.4.2.md` | Auditoria anterior (2026-03-28): ja detectava JSX multi-responsabilitat (`insertWithBounds`, `cloneSequence`) → **segueixen pendents** |
| `docs/archive/CODIGO_OBSOLETO.md` | Llista de codi obsolet: contrastar amb §6.2 d'aquest informe |
| `docs/guides/ARCHITECTURE_MAP.md` | Mapa de capes vigent → actualitzar amb §8 |
| `.roo/features.json` | Registre de features/bugs (RENDER i SUBTITLES actualitzats el 2026-09-18) |
| `.roo/progress/2026-09-18.md` | Handoff del dia (portada, fallback SRT, fixes) |

---

## Annex A · Comandes de verificació (per reproduir l'auditoria)

```powershell
# 1. Inventari per capes
Get-ChildItem 'js\core','js\inspectors','js\logic','js\workflows' -Filter '*.js' | Select-Object Name, Length | Sort-Object Name
Get-ChildItem 'jsx' -Recurse -Include '*.jsx' | Select-Object Name, Length

# 2. Wrappers exposats pel puente (blocs i mètodes)
Select-String -Path 'jsx\main.jsx' -Pattern 'global.[A-Za-z]+ = {'
Select-String -Path 'jsx\main.jsx' -Pattern '^    [A-Za-z_]+: function|^    \x22[A-Za-z_]+\x22: function'   # 110 mètodes

# 3. Crides JS ➜ JSX
Select-String -Path 'js\**\*.js' -Pattern 'callJSX\(' | Group-Object Filename
Select-String -Path 'js\**\*.js' -Pattern 'callJSX\([\x27\x60]([A-Za-z]+)\.([A-Za-z_]+)' -AllMatches |
  Select-Object -ExpandProperty Matches | Select-Object -ExpandProperty Value | Sort-Object -Unique

# 4. Fitxers carregats vs existents
Select-String -Path 'index.html' -Pattern 'src=' | Select-Object Line
Select-String -Path 'CSXS\manifest.xml' -Pattern 'MainPath|ScriptPath'

# 5. Namespaces Logic duplicats
Select-String -Path 'js\logic\*.js','js\workflows\*.js' -Pattern 'FASTPASS_UI.Logic.[A-Za-z]+ ='

# 6. Crides a àtoms inexistents / restes
Select-String -Path 'js\**\*.js' -Pattern 'IO\.findFiles|IO\.readHex|IO\.stat|Arxiu\.|Animacio\.|Timeline\.insertCleanClip'
Select-String -Path 'js\**\*.js' -Pattern 'FASTPASS_UI.Sync'
```

---

## Annex B · Canvis d'aquest informe

- **2026-09-18 (v1)**: creació.
- Correcció aplicada durant la redacció: `setup.html` i `flow_config.js` **no són codi mort** (són la finestra de configuració, al ~80%, pendent de `Config.load/reload`); s'han retirat de la llista de purga i s'han documentat a §7.
- Afegit el forat de `Profile.json` (mai llegit per l'extensió) com a troballa principal de configuració.

---

*Auditoria generada el 2026-09-18 · FAST >>> PASS v2.9.5 «LIPO-PRO» · Harness Engineering*






