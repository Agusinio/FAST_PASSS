# CODE OWNERSHIP — FAST·PASS v2.9.5

> **⚠️ DOCUMENT DE SEGURETAT ARQUITECTÒNICA**
>
> Aquest document defineix les zones de modificació PROHIBIDES, les zones d'ÚS COMPARTIT
> i les zones SEGURES del codi. Qualsevol modificació a una zona 🔴 requereix coordinar-se
> amb **TOTES** les operatives del panell (`js/workflows/*`) i els seus tests en Premiere.

## 🔴 Funcions PROHIBIDES de modificar sense coordinar TOTES les operatives

| Funció | Ubicació | Raó | Consumidors |
|--------|----------|-----|-------------|
| `loadAssemblyContext()` | `js/core/assembly_context.js` | Carrega manifest, reader, clips V1, línies. Primer pas obligatori de TOTES les fases. | Markers (F1-F6), MP4, Chyrons, Graphics |
| `captureTimelineSnapshot()` | `js/core/assembly_context.js` | Snapshot inmutable del timeline (S2). Base de càlcul per a totes les posicions. | Tots els workflows |
| `_classifyItems()` | `js/workflows/flow_markers.js` | Defineix quins ítems són estructurals vs gràfics. Canviar-ho desplaça marcadors. | F1-F6, _setupEstructural |
| `_calcTemporalAnchors()` | `js/workflows/flow_markers.js` | Calcula les 4 àncores temporals. Les seves fórmules són la base de TOTES les posicions. | F1-F6, _setupEstructural |
| `_correlationSnap()` | `js/workflows/flow_markers.js` | Algoritme D1 de Δ consensuat. Canviar paràmetres (BUCKET_SIZE, MIN_CONFIDENCE) afecta F3+. | F3, F5 |
| `_safePlaceByPrefixes()` | `js/workflows/flow_markers.js` | UPSERT atòmic de marcadors. Únic punt d'entrada a `Markers.placeByPrefixes` JSX. | F1-F6 |
| `_GRAPHIC_SUFFIXES` | `js/workflows/flow_markers.js` | Set de sufixos gràfics. Canviar-lo reclassifica ítems entre estructurals i gràfics. | F1-F6 |
| `_getColorIdx()` | `js/workflows/flow_markers.js` | Mapa de colors de marcador. Canviar-lo desordena la codificació visual. | F1-F6 |
| `formatTC()` | `flow_mp4.js`, `flow_markers.js` | Conversió segons → timecode. Duplicada en 2 mòduls. Canviar en un requereix canviar en l'altre. | MP4, Markers |
| `rippleAllOut()` | `js/logic/6_Clips_Logic.js` | Modifica TOTS els tracks del timeline. Invalida clips cacheados. | Project.create, flow_cut |
| `rippleOut()` | `js/logic/6_Clips_Logic.js` | Modifica un track del timeline. Invalida clips cacheados. | Project.create, flow_cut |
| `cleanFlashWhites()` | `js/logic/6_Clips_Logic.js` | Modifica V1, canvia índexs i durades de clips. | runAutoPlacement (Chyrons) |

## 🟡 Mòduls de USO COMÚN (modificar amb precaució)

| Mòdul | Usat per | Precaució |
|--------|-----------|-----------|
| **`js/core/utils.js`** | TOTS els workflows i logic | `callJSX()` és el pont únic a ExtendScript. `log()` és el sistema de logging. `ensureFolders()` crea directoris al NAS. `Batch` sistema de batching JSX. Qualsevol canvi aquí és GLOBAL. |
| **`js/core/state.js`** | TOTS | `markerPhase` controla el bucle F1→F5. `bloque` i `progData` defineixen el context actiu. `structure` alimenta runAutoPlacement. |
| **`js/core/11_Configuracio.js`** | TOTS | `get()` retorna `tracks.video.mp4` (V1 = 1). Canviar el valor de V1 desplaça TOTES les operacions. `handles` i `tcOffset` afecten els càlculs de trim. |
| **`js/core/session_manifest.js`** | MainButton, Markers, MP4 | `save()` i `load()` persisteixen i recuperen el manifest. Canvis d'estructura del manifest trenquen compatibilitat. |
| **`js/core/escaleta_reader.js`** | MainButton, Markers | `findLatest()`, `findLatestValid()`, `calcPrecisionTrimBounds()`, `tcToSeconds()`, `_deduceOnAirEntrada()`. Canviar la lògica de deducció de TC afecta TOTES les projeccions. |
| **`js/logic/14_Assembly_Logic.js`** | Chyrons, flow_retols | `runGuidedAssembly()`, `calcDensityFootprintV2()`, `conductor()`. Cridat des de `flow_chyrons.js` i `flow_retols.js`. |
| **`js/core/4_Context.js`** | TOTS | `checkContext()` verifica que s'està a la seqüència i projecte correctes. `init()` configura el panel. |
| **`js/logic/3_Project_Logic.js`** | MainButton | `create()` insereix el MP4 a V1 amb `insertWithBounds`. Canvis en la inserció afecten el punt de partida de TOTS els marcadors. |

## 🟢 Zones SEGURES (canvis aïllats)

| Zona | Operativa | Segur perquè |
|------|-----------|---------------|
| `js/workflows/flow_graphics.js` | Graphics (CTI, debug, captura) | Només interactua amb Timeline i Markers via JSX. No modifica V1. |
| `js/workflows/flow_chyrons.js` | Chyrons (conductor, ensamblatge) | Usa `Clips.insert()` a V3-V7. No toca V1 directament (excepte `cleanFlashWhites`). |
| `js/workflows/flow_mp4.js` | MP4 (densitat, debug) | Anàlisi de V1 (read-only) excepte `placeRawMarkers` i `debugBlockItems`. |
| `js/workflows/flow_cut.js` | Cut (IN, OUT, TROSEJA) | Operacions atòmiques de timeline. Només usa `rippleOut` que és compartit — 🟡 precaució. |
| `js/workflows/flow_render.js` | Render | Només usa `Render.queue` JSX. Sense dependències de timeline. |
| `js/workflows/flow_retols.js` | Rètols (chyrons) | Delega a `14_Assembly_Logic.runGuidedAssembly()`. |
| `js/workflows/flow_KF.js` | Keyframes | Només usa `Anim.*` JSX. Sense dependències de timeline V1. |
| `js/workflows/flow_srt.js` | Subtítols | Només usa `Clips.getSubtitles()` i `10_Srt_Logic`. |
| `jsx/modules/8_Markers.jsx` | Marcadors JSX | Funció pura: llegeix/escriu marcadors. No toca clips ni tracks. |
| `jsx/modules/7_KF.jsx` | Keyframes JSX | Funció pura: keyframes d'animació. No toca clips ni tracks. |
| `jsx/modules/9_Render.jsx` | Render JSX | Funció pura: exportar frames. No toca clips ni tracks. |
| `jsx/modules/5_Tracks.jsx` | Tracks JSX | Funció pura: mute/lock/target de tracks. No modifica contingut. |

## 📐 Regles de modificació segura

### Checklist pre-commit

1. **Si modifiques `loadAssemblyContext()` o `captureTimelineSnapshot()`**:
   - Testejar TOTES les fases F1→F6 en Premiere real
   - Verificar que `_setupEstructural()` segueixi funcionant

2. **Si modifiques `_calcTemporalAnchors()` o `_classifyItems()`**:
   - Testejar F1, F2, F3, F6
   - Verificar que els marcadors es col·loquin a les posicions correctes

3. **Si modifiques `_safePlaceByPrefixes()`**:
   - Testejar TOTES les fases F1→F6
   - Verificar que no hi hagi errors de JSON.parse als marcadors

4. **Si modifiques `Config.get().tracks.video.mp4` (V1 = 1)**:
   - **NO FER-HO** sense una raó de pes. V1 és el track de referència universal.

5. **Si modifiques `rippleOut()` o `rippleAllOut()`**:
   - Testejar `Project.create()` (inserció MP4 + trim tails)
   - Testejar `flow_cut.js` (IN, OUT, TROSEJA)

6. **Si modifiques `insertWithBounds` o `trimBounds` a `6_Clips.jsx`**:
   - Testejar `Project.create()` amb un cleanFeed MP4 real
   - Verificar que el clip es col·loqui correctament a V1 amb els bounds correctes

7. **Abans de qualsevol commit**:
   - Executar el flux complet: NOU → MUNTAR → MARCADORS (F1→F6) en Premiere real
   - Verificar que no hi hagi regressions

### Flux de test mínim

```
1. Obrir panel FAST_PASSS
2. Seleccionar PROG + BLOC
3. Clicar NOU → esperar que es creï el projecte i s'insereixi el MP4
4. Clicar MUNTAR (si existeix el botó)
5. Clicar F1·OnAir → verificar marcadors blaus i vermells
6. Clicar F2·Deducido → verificar marcadors grocs
7. Clicar F3·Prevista → verificar marcadors taronja
8. Clicar F5·OrphanSnap → verificar que no hi hagi errors
9. Clicar F6·Gràfics → verificar marcadors grocs de gràfics
```

## 🗺️ Arquitectura de dependències post-modularització

```
┌──────────────────────────────────────────────────────────────┐
│  js/main.js  → callWorkflow(module, method)                  │
│                                                              │
│  callWorkflow('MP4',      'debugBlockItems')                 │
│  callWorkflow('Markers',  'placeOnAirMarkers')               │
│  callWorkflow('Markers',  'placeGraphicMarkers')             │
│  callWorkflow('Chyrons',  'runGuidedAssembly')               │
│  callWorkflow('Graphics',  'updateBlocInFromCTI')            │
│  callWorkflow('Assembly', ...) → aliases retrocompatibles    │
└──────────┬──────────┬──────────┬──────────┬─────────────────┘
           │          │          │          │
    ┌──────▼──┐ ┌─────▼───┐ ┌───▼────┐ ┌──▼────────┐
    │ flow_   │ │ flow_   │ │ flow_  │ │ flow_     │
    │ mp4.js  │ │ markers │ │ chyrons│ │ graphics  │
    │ V1+dens │ │ F1→F6   │ │ cond+  │ │ CTI+debug │
    │         │ │         │ │ ensamb │ │ +captura  │
    └────┬────┘ └────┬────┘ └───┬────┘ └───┬───────┘
         │           │          │          │
         └───────────┴──────────┴──────────┘
                     │
           ┌─────────▼──────────┐
           │ assembly_context   │  (Core)
           │ .loadCtx()         │
           │ .captureSnapshot() │
           │ .getSnapshot()     │
           └─────────┬──────────┘
                     │
           ┌─────────▼──────────┐
           │ Capes inferiors    │
           │ State, Config,     │
           │ Utils, SessionMan, │
           │ EscaletaReader,    │
           │ Logic (Clips,      │
           │ Assembly, Parse)   │
           └─────────┬──────────┘
                     │
           ┌─────────▼──────────┐
           │ JSX Bridge         │
           │ Clips, Markers,    │
           │ Timeline, Project, │
           │ Tracks, Anim,      │
           │ Render, IO         │
           └────────────────────┘
```

---

*FAST·PASS v2.9.5 "LIPO-PRO" · CODE OWNERSHIP · 2026-07-08*