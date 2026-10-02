# PLAN · MECANISME DE SEGURETAT: TREBALLAR AMB EL CLIP DE L'USUARI A V1

> Registre: **#127** (`.roo/features.json`) · Estat: **PLA ESCRIT, pendent d'implementar**
> Origen: petició de l'usuari del 2026-09-30 (vespre).
> Handoff de la sessió: `plans/HANDOFF_2026-10-01.md`.
> Regla de projecte que aplica: **JSX està CERRADO** → tot es compon amb els àtoms existents.
> ⚠️ **Actualització 2026-10-02** (neteja de codi mort, #115 · `progress/2026-10-02.md` §10): les
> referències d'aquest pla a `js/core/13_Registre.js` (:107-120 i §P4 :186, :205) i a
> `js/core/escaleta_onair.js` (:56) queden **OBSOLETES** — cap dels dos fitxers no el carregava
> `index.html` i s'han esborrat. L'equivalent VIU és `js/core/project_registry.js` (`Registry`) per al
> registre de workflows i `js/core/escaleta_bounds.js` / `escaleta_config.js` per a OnAir/bounds i els
> overrides de durada (els «9 usos» d'`escaleta_onair.js` no compten a l'inventari viu).

---

## 0. Requisit (literal de l'usuari)

> *«Mecanisme de seguretat: si l'extensió no és capaç d'importar un MP4 vàlid, cal aconseguir que
> l'extensió funcioni igual amb un clip que hagi col·locat l'usuari. Com que l'usuari sap el que es
> fa, si hi ha un clip a V1, els botons s'han de manejar amb aquest clip. L'IN el retalla d'inici
> igual, l'OUT&GO el retalla i el trosseja, i es tenen en compte els seus clips per col·locar els
> chyrons. Tota la lògica ha de funcionar igual.»*

Es tradueix en 4 requisits verificables:

| # | Requisit | Criteri d'acceptació |
|---|---|---|
| R1 | Si l'import del MP4 falla **i** hi ha un clip a V1, el panell NO deixa el projecte «SENSE vídeo» ni bloqueja botons | cap `⛔ … SENSE VÍDEO`; botons de workflow habilitats |
| R2 | IN / TROSSEJA / OUT&GO operen amb el clip de l'usuari | `Cut.runCutIn` retalla per la seva capçalera; `Cut.runScene` el trosseja pels talls; OUT&GO completa F1→F6 |
| R3 | Els chyrons/grafismes compten els clips de l'usuari com a material del bloc | col·locació de conductor/tema/lloc/nom als seus marcadors |
| R4 | El clip de l'usuari és **sagrat**: la extensió no el substitueix ni el re-trimea fora d'IN/OUT&GO | cap `Clips.insert`/`Clips.retrim` a V1 si l'ancla és `USER`, excepte els que fan per disseny IN/TROSSEJA/OUT&GO |

---

## 1. Inventari: què ja funciona i què no (mesurat el 30/09)

### 1.1 Ja és agnòstic al nom del clip ✅

Tots els workflows agafen el material de V1 **per pista** i després per posició/índex:

| Workflow | On | Com |
|---|---|---|
| IN (ripple trim) | `js/workflows/flow_cut.js:53-68` | `config.tracks.video.mp4` + `Clips.at(track, cti, 'video')` |
| TROSSEJA | `js/workflows/flow_cut.js:171-310` | `Clips.get(T_MP4, i, 'video')` |
| Marcadors F1…F6 | `js/workflows/flow_markers.js:3349` | `Clips.debugTracks('video')` → `tracks[T_MP4-1]` |
| Chyrons | `js/workflows/flow_chyrons.js:2262-2284` | `Clips.get(T_V1, i, 'video')` |
| Doble Finestra / IPD+ | `js/workflows/flow_graphics.js:869` · `:657` | `Clips.at(...)` |
| Mapa | `js/workflows/flow_mapa.js:384-431` | clip seleccionat de la pista MP4 |

⇒ **Cap d'aquests necessita saber qui ha col·locat el clip.** El que els falta són les *metadades del mitjà*.

### 1.2 El que NO és agnòstic ❌ (metadades del mitjà)

Els offsets/bounds surten del manifest de la sessió (`cleanFeed.mediaStart/mediaStop`,
`mp4ExpandedInPoint/OutPoint`, `mp4ProgramInPoint`, `mp4SweetInPoint/OutPoint`). Usos per fitxer:

| Fitxer | Usos |
|---|---|
| `js/workflows/flow_mainButton.js` | 86 |
| `js/core/escaleta_bounds.js` | 41 |
| `js/core/escaleta_fallback.js` | 9 |
| `js/core/escaleta_onair.js` | 9 |
| `js/editor/srt_editor.js` | 6 |
| `js/logic/3_Project_Logic.js` | 6 |
| `js/core/assembly_context.js` · `escaleta_fetch.js` | 2 i 2 |
| `flow_markers.js` · `session_manifest.js` · `15_FFmpeg_Logic.js` | 1 cadascun |

### 1.3 Les guardes que avui deixen el projecte sense vídeo

| Guarda | Línia | Efecte |
|---|---|---|
| Ingesta en curs (bloc no cobert pel fitxer) | `flow_mainButton.js:469-530` (#120) | `skipVideoIngesta = true` → projecte sense clip |
| MP4 de bloc descartat (material aliè) | `flow_mainButton.js:600-640` (#121) | `⛔ [FALLBACK] MP4 del bloc DESCARTAT` |
| Restauració de l'MP4 del bloc | `flow_mainButton.js:664-680` (#120) | aixeca la guarda si el fitxer cobreix el bloc |
| Sense MP4 ni cleanFeed | `flow_mainButton.js:1053-1058` | `⛔ … projecte sense vídeo (ACTUALITZAR després)` |
| Flags de vídeo | `:1295` (`phases.mp4Imported`) · `:1612` (`State.hasMedia`) | semàfors i UI |
| `_guardBlockMedia` | `flow_mainButton.js:1572-1597` (#121) | valida el MP4 de `rutas.verticalitzacio` |

⇒ Avui, quan el MP4 no és vàlid, **el projecte es crea sense V1 i el pipeline queda mut**. Aquest és
el forat que demana tapar l'usuari: si el clip ja hi és (posat per ell), no cal cap MP4 propi.

### 1.4 Com col·loca el clip la extensió avui (per saber que no s'ha de repetir)

`js/logic/3_Project_Logic.js:150-320` — `Project.create()`:

1. `utils.importList([path])` del cleanFeed o de l'MP4 del bloc (`:158`).
2. `Timeline.set(0)` + `utils.targetOnlyV1('MP4→V1')` (`:166-177`).
3. Inserció **pel NOM de l'ítem importat**: `Clips.insert(escapedCfName, 1, 0, 'video')` (fallback, `:193`)
   o `Clips.insertClipItem(...)` + `Clips.retrim(1, 0, in, out, end, 'video')` (normal, `:275-293`),
   amb `[TRIM-CHECK]` de control (`:295-320`).

⇒ Amb un clip `USER` aquests 3 passos **no s'han d'executar** (el clip ja hi és): només cal saltar-los
i seguir amb la resta del muntatge (portada, rètols, targeting).

---

## 2. Contracte del resolvedor d'ancla (peça central)

Nova funció **JS pur** (tier Core/Logic, zero JSX nou):

```js
// js/core/assembly_context.js  (o js/logic/6_Clips_Logic.js)
AssemblyContext.resolveV1Anchor = async function (ctx, opts) { … }
```

**Entrada**: `ctx` (bloque, dateDir, config) i `opts = { blockIn, blockOut, expectedName }`.

**Sortida**:

```js
{
  source: 'EXT' | 'USER' | null,   // null = V1 buida (aquí sí que cal avisar)
  clips: [ { index, name, start, end, inPoint, outPoint, duration } ],
  bounds: { inSec, outSec },       // rang del bloc a la TIMELINE
  mediaOffsetSec,                  // offset del material respecte l'inici del bloc
  reason                           // text per al log
}
```

**Regles**:

1. Llegir V1 de veritat: `Clips.debugTracks('video')` (1 sola crida) → `tracks[mp4-1]`.
2. Elegir els clips que **solapen** `[blockIn, blockOut]`; si no hi ha hores d'escaleta, el primer.
3. `source`:
   - `'EXT'` si el nom del clip té ítem al projecte (`FASTPASS.Project.items('')`) **o** si
     `phases.mp4Imported` i el nom coincideix amb l'esperat.
   - `'USER'` si **cap** ítem del projecte coincideix amb el nom del clip de V1 (material afegit a mà).
4. `mediaOffsetSec`:
   - `'EXT'` → com avui (`mp4ExpandedInPoint` + offset global de TC, `3_Project_Logic.js:220-269`).
   - `'USER'` → `clip.inPoint` (s'assumeix que el clip comença on comença el bloc). El desfasament fi
     el resol la correlació de marcadors (F3/F4) igual que avui amb `clipInDelta`.
5. Log invariant (sempre, una línia):
   `🔎 [ANCLA] source=USER clip="X" V1 start=… end=… in=… out=… (sense MP4 propi: bounds derivats del clip)`

---

## 3. Disseny per capes (5 tiers)

### Tier 2 · Action Logic — `cleanFeedData` sintètic

`js/logic/3_Project_Logic.js` ja consumeix un objecte:

```js
cleanFeedData = { mediaPath, mp4ProgramInPoint, mp4ExpandedInPoint, mp4ExpandedOutPoint,
                  mp4SweetInPoint, mp4SweetOutPoint, mp4Duration, escaletaLines }
```

Quan `source === 'USER'` es construeix **el mateix objecte a partir del clip real**:

```js
{
  mediaPath: null,                       // no hi ha fitxer propi
  _isUserClip: true,
  mp4ExpandedInPoint: clip.inPoint,
  mp4ExpandedOutPoint: clip.outPoint,
  mp4ProgramInPoint: 0,
  mp4SweetInPoint: clip.inPoint,
  mp4SweetOutPoint: clip.outPoint,
  mp4Duration: clip.duration,
  escaletaLines: items         // de l'escaleta, igual que avui
}
```

⇒ **Tots els consumidors de `mp4*` (86 + 41 + 9 + 9 + …) segueixen funcionant sense tocar-los**, perquè
el que els arriba són números coherents amb el clip. Això és el 80% de la feina, feta per construcció.

### Tier 2 · `escaleta_bounds.js`

`calcPrecisionTrimBounds(jsonData, bloque, mediaStart, mediaStop, config)` (`:373-420`) ja té el
fallback `calcClipBounds` quan no hi ha OnAir. Afegir un paràmetre `boundsOverride` (o `anchor`) que,
si ve informat des de l'ancla `USER`, torni directament:

```
IN  = clip.start        (o blockIn si el clip comença abans)
OUT = clip.end
```

i marqui la línia de log `📏 [ANCLA·USER] bounds del clip: IN=… OUT=…`.

### Tier 1 · Workflow — `flow_mainButton.js`

- `_runNew`: si `resolveV1Anchor()` diu `USER` →
  - no importar MP4 ni inserir res (saltar `3_Project_Logic.js:150-320`),
  - **no** crear el projecte «sense vídeo»: posar `phases.v1Anchor` i continuar el muntatge.
- Guardes `:469-530`, `:600-640`, `:1053-1058`: afegir la sortida «però V1 ja té clip → continuar».
- `_fullScan`/`_completeSyncUI` (`:1602-1655`): `State.hasVideo = !!anchor`; el targeting a V1 es manté.

### Tier 4 · Core — estat i UI

- `State.hasVideo` (nou) i `phases.v1Anchor = { source, name, start, inPoint, outPoint, at }`,
  mantenint `phases.mp4Imported` per compatibilitat.
- `js/core/13_Registre.js:107-120` (`_setWorkflowEnabled`): no deshabilitar per «sense MP4», només
  per «sense seqüència/projecte compatible» o «V1 buida **i** res a ancorar».
- Semàfor de vídeo (`4_Context.js`, cf. **#117**): verd si `hasVideo`.

### Tier 1 · Workflows que NO s'han de tocar

`flow_cut.js` (IN/TROSSEJA/OUT&GO), `flow_markers.js` (F1…F6), `flow_chyrons.js`, `flow_graphics.js`,
`flow_retols.js`, `flow_render.js` → tots ja treballen per pista i amb l'escaleta. Només cal que
**no trobin cap guarda que els aturi** (Tier 1 `flow_mainButton.js`).

---

## 4. Pla d'implementació (per passos, demà)

| Pas | Què | Fitxers | Temps | Test |
|---|---|---|---|---|
| **P1** | `resolveV1Anchor()` + `cleanFeedData` sintètic + logs `[ANCLA]` | `js/core/assembly_context.js`, `js/logic/3_Project_Logic.js` | 45 min | harness V8 (35 casos: EXT/USER/vacía/buit) |
| **P2** | `Project.create()`: si `USER` → saltar import+inserció+retrim i continuar el muntatge | `js/logic/3_Project_Logic.js:88-320` | 30 min | `check_js_v8.ps1` + harness |
| **P3** | Guardes de `flow_mainButton` que avui deixen «SENSE VÍDEO» → sortida `USER` | `js/workflows/flow_mainButton.js:469-530, 600-640, 1053-1058, 1295, 1612` | 45 min | harness + lectura de log |
| **P4** | Estat: `State.hasVideo` + `phases.v1Anchor`; UI (`_setWorkflowEnabled`) | `js/main.js`, `js/core/13_Registre.js`, `js/core/project_registry.js` | 30 min | manual (botons ON/OFF) |
| **P5** | Bump de cache-bust a `index.html` + test end-to-end a Premiere | `index.html` | 15 min | **prova real** (abaix) |

### Test end-to-end de P5 (guia per a l'usuari)

1. Obrir un bloc **sense MP4 propi** (o fer que `_guardBlockMedia` el descarti: MP4 d'un altre bloc).
2. Col·locar **a mà** un clip qualsevol de V1 (arrossegar el MP4 d'aquell bloc o un altre material).
3. Premar **NOU**. Al log s'ha de veure:
   - `🔎 [ANCLA] source=USER clip="…" V1 start=0.00 end=… in=… out=…` (i **cap** `⛔ … SENSE VÍDEO`),
   - `📏 [ANCLA·USER] bounds del clip: IN=… OUT=…`,
   - cap `Clips.insert` ni `Clips.retrim` sobre V1.
4. **IN** amb el CTI a la capçalera → retalla i desplaça a 0 (com amb un MP4 propi).
5. **TROSSEJA** → talls de contingut al clip de l'usuari.
6. **OUT & GO** (mode TREBALL) → marcadors F1…F6 + chyrons.
7. Comprovacions: els marcadors GROCS/BLAUS/Vermells als mateixos llocs que amb un MP4 propi;
   `🎯 [Chyrons]` amb conductor/tema/lloc/nom col·locats; cap error `ERR:` de JSX al log.

> Criteri de rebuig: si amb el clip de l'usuari els marcadors surten desplaçats un valor **constant**,
> cal ajustar `mediaOffsetSec` (és l'única incògnita del disseny, vegeu §5).

---

## 5. Riscos i decisions obertes (cal resposta de l'usuari)

| # | Pregunta | Proposta per defecte |
|---|---|---|
| 1 | Com distingim el clip de l'usuari d'un MP4 del bloc importat amb un altre nom? | Comparar `clip.name` amb els ítems del projecte (`FASTPASS.Project.items('')`): si no hi és → `USER` |
| 2 | Quin offset de material assumim si l'operador ha pegat el clip començant enmig del MP4? | `mediaOffsetSec = clip.inPoint` + avís al log; els OnAir s'anclen per correlació de talls (F3/F4) com avui |
| 3 | Ha de ser automàtic o amb confirmació? | **Automàtic** (petició literal: «si hi ha un clip a V1, els botons s'han de manejar amb aquest clip») + línia de log molt visible |
| 4 | I si a V1 hi ha **diversos** clips (ja trocejats per l'operador)? | Anar amb tots (`clips[]`, com fan els workflows que ja iteraven la pista) |
| 5 | Cal avisar quan l'MP4 propi existeix **i** l'usuari ja havia posat un clip? | Sí: `⚠️ [ANCLA] V1 ja tenia clip propi; s'usa el del panell (EXT)` i es re-importa/re-insereix com avui |

---

## 6. Validació sense Premiere (obligatòria abans de P5)

1. `powershell -NoProfile -ExecutionPolicy Bypass -File ".\bin\check_js_v8.ps1"` → **0 FAIL nous**
   (l'únic FAIL conegut és `core/escaleta_trim.js`, preexistent i aliè).
2. **Harness V8 real** (mateix patró que el de #125: `C:\temp\fp\fp_gf3_test.html` + `run_gf3_test.ps1`):
   carregar `utils.js`, `assembly_context.js` i un `Clips.debugTracks` **mockejat** amb 3 escenaris:
   - `EXT` (nom present a `Project.items`), `USER` (nom absent), `V1 buida`;
   - comprovar `source`, `bounds`, `mediaOffsetSec` i el `cleanFeedData` sintètic.
3. Cap toc a JSX: `git diff --stat` no ha de mostrar res sota `jsx/`.



