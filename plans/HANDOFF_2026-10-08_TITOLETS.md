# HANDOFF 2026-10-08 · TITOLETS / GRAFISMES CREMATS (estat complet + agenda)

> Continua des de `.roo/progress/2026-10-08.md` (§2-§5) · Doc de referència viu: `docs/reference/TITOLET_DETECT.md` (v1.5.0)
> Objectiu d'aquesta nota: que una sessió futura pugui **revisar tot el pipeline** de detecció i col·locació
> dels grafismes cremats sense reconstruir-lo, i arrencar l'agenda de §7.
> **Cap commit fet** (regla del projecte: no commit fins que l'usuari validi a Premiere).

## 0. Resum executiu

- El pipeline porta **7 passades** de refinament (2026-10-05 → 2026-10-08). Queden 2 fixes **sense validar
  a Premiere**: **#147** (el congelat portava el vídeo de V1 en lloc del grafisme) i **#148** (la mateixa firma
  col·locada a V7 i V8 alhora).
- Detecció: `js/logic/17_TitoletDetect_Logic.js` (1.341 línies, **+313 línies no commitejades** del 2026-10-08)
  + config `TITOLET_DEFAULTS` a `js/core/11_Configuracio.js` + àtoms ffmpeg a `js/logic/15_FFmpeg_Logic.js`
  + OCR a `bin/ocr.ps1` (Windows.Media.Ocr).
- Col·locació: `js/workflows/flow_chyrons.js::_placeTitoletChain` (cridada des de la fase **Resto**).
- La detecció **no es fa mai per sistema**: només si l'ítem porta wotts amb alguna de les **27 etiquetes
  literals** de `titolet.detectRoles`.
- 🔴 **Risc detectat i corregit en aquesta sessió**: `index.html` carregava el mòdul amb
  `17_TitoletDetect_Logic.js?v=1` des del primer dia tot i haver canviat +313 línies → **pujat a `?v=2`**.
  Sense això, Premiere podria servir el mòdul VELL en cacau en el proper test.
- Agenda de la propera sessió (§7): **(A)** millorar la detecció dels **CARTELLS** (avui 26 de 27 etiquetes
  comparteixen la ROI comodí i la màscara taronja única); **(B)** col·locar els **no detectats** amb més
  criteri (clip complet + un congelat per poder-lo deixar llarg, agrupats AL FINAL com ara).

## 1. Pipeline (mapa de crida real, en ordre)

```
placeChyronResto  →  _placeChyronsByType(..., { dedupeTitolet: true, chainTitolet: true })
  ├─ _burnedGrafWott(chy) → _burnedGrafRole(chy)      [27 etiquetes literals; NOMÉS el ROL]
  ├─ _dedupeTitolet(cremats)                          [1 per ETIQUETA + text]
  └─ _placeTitoletChain({ mk, itemEnd, titolets, wottIdx, cfg, ctx, wfCtx, clipsV1, label, tag })
       1. list.sort per wottId ...................... només per numerar i traçar
       2. durs[i] = PL._resolveWottDur(wottIdx, chy)   ffprobe si al projecte; si no ANIM 5,0 s (WARN)
       3. _titoletTcFromName(list, cfg) → _titoletCardsFromTc   🔵 TC DEL NOM (7a passada)
       4. si TOTS els wott tenen TC → ni s'ancora ni s'escaneja (s'omple el pla amb el TC)
       5. _titoletAnchor(p, wctx) → { mp4, off }      1r clip extret de V1 (<WOTT>_<BLOC>_CLIP.mp4 por inPoint)
                                                      2n cleanFeed del manifest + ref.offsetSec
       6. Logic.TitoletDetect.planForItem({ mp4, names, roles, tItemStart, tScanStart, tScanDur, cfg })
             ├─ recipeForRoles(cfg, roles) → 1 RECEPTA per GRUP de rol (roiPerRole → roiDefault)
             ├─ FFmpeg.extractRoiSeries()  1 .raw rgb24 per recepta (crop+scale+fps, -ss ABANS de -i)
             ├─ analyzeSeries()            1 passada per recepta → cobertura/bbox per mostra (JS)
             ├─ groupIntervals()           intervals ON (minCov/maxCov/edge/gap) per grup
             ├─ refineEntry                escaneig FI (±3 frames) de l'entrada de cada interval USAT
             ├─ ocrInterval → FFmpeg.extractFramePng (ROI NATIVA, sense scale) + bin\ocr.ps1 -Langs
             └─ assignIntervals / resolveOrphans / composePlan → cards[k] = { found, on, relIn, relOut, kind }
       7. els buits de la detecció s'omplen amb el TC del nom (log ⏱️ «TC del nom: N targeta(es)…»)
       8. freezeDur = 3 s si countFit(3) === list.length, si no 1 s  (mai decideix SI es col·loca)
       9. per targeta DETECTADA:  tStart = mk.time + relIn (+ «imant al tall» si Δ ≤ snapTolSec 1,0 s)
                                  TRIM = cardTrimFrames/fps = 0,2 s
                                  liveWant = max(0,5; cardDur − TRIM)
                                  want = max(liveWant; detEnd − tStart − TRIM)  ··· o liveWant + freezeDur
                                  topall: liveWant + freezeMaxSec (15 s)
      10. per targeta SENSE detecció: tStart = maxEndTl + GAP (1,0 s) → ENCADENADA
                                  want = liveW + freezeDur            [⛓️ log «SENSE detecció → encadenat»]
      11. retall de seguretat: cap targeta envaeix la SEGÜENT ni el final de l'ítem
      12. pista: _chooseSlot([V8 lloc/data, V7 chyrons]) — el rang es reserva targeta a targeta
```

**Ancoratge (regla d'or, no tocar-la sense mesurar)**: la timeline NO conté el cleanFeed, conté el
**CLIP EXTRET** del bloc → `fileSec = tlSec + (clip.inPoint − clip.start)` amb el clip REAL de V1.
El manifest barreja coords d'origen i de clip extret; la 1a passada `ref.offsetSec` va donar **0 intervals**.

**Mòdul `17_TitoletDetect_Logic.js`** (funcions reals, per ordre): `_recipeOf` · `roiOnly` · `_hull2` ·
`_maxGrid` · `_isect2` · `recipeForRoles` · `_hexToRgb` · `_byteAt` · `_analyzeFrame` · `analyzeFrameAt` ·
`analyzeSeries` · `groupIntervals` · `_normText` · `_levRatio` · `_wottTokens` · `_scoreText` · `roleGroups` ·
`_groupAllow` · `_sameGroup` · `pickWott` · `assignIntervals` · `resolveOrphans` · `buildPlan` · `_readBinary` ·
`ocrText` · `_attemptInstants` · `_refineFromSeries` · `_hash32` · `_planCachePath` · `_cacheLoad` · `_t0FromCache` ·
`_cacheSave` · `composePlan` · `planFromRaw` (pipeline) · `planForItem` (API pública).

**API exportada** (`FASTPASS_UI.Logic.TitoletDetect`, 25 claus): `analyzeFrameAt` · `analyzeSeries` ·
`groupIntervals` · `pickWott` · `assignIntervals` · `resolveOrphans` · `buildPlan` · `composePlan` ·
`refineFromSeries` · `attemptInstants` · `planCachePath` · `normText` · `levRatio` · `wottTokens` · `hexToRgb` ·
`recipeOf` · `recipeForRoles` · `roleGroups` · `roiOnly` · `groupAllow` · `sameGroup` · `roiKeys` · `ocrText` ·
`scanMp4` · `planForItem`.

## 2. Config viva (`TITOLET_DEFAULTS`, `js/core/11_Configuracio.js`)

| Paràmetre | Valor | Nota |
|---|---|---|
| `enabled` · `dryRun` | `true` · `false` | en calent: `FASTPASS_UI.State.titoletDryRun = true` |
| `detectRoles` | **27 etiquetes literals** | `TITOLET` · `TITOLET GRAN` · `PREGUNTA` · `CARTELL` · `CIS_CEO` · `CIS_CEO_COMPARADA` · `CRONOLOGIA` · `CRONOLOGIA-TITOLS` · `DADA_COMPARADA` · `DADA-DIFERENCIAL` · `DADA-GRAN` · `DADA-GRAN-DIVISA` · `DADA-ITEM` · `DESTACAT` · `CLASSI-CHAMPIONS` · `CLASSIFICACIO` · `CLASSI-MUNDIAL` · `CLASSI-PRIMERA` · `CLASSI-SEGONA` · `GRAFICA-BARRES` · `GRAFICA_CIRCULAR` · `IMATGE-CAPTURA` · `LLISTA` · `LLISTA-DADES` · `NOTA` · `PROGRAMACIO` · `RANQUING` |
| `roiY` · `roiX` | `[0.60,0.85]` · tot l'ample | ROI base (la del TITOLET) |
| `roiPerRole` | només `'TITOLET'` mesurat | `{ roiX: null, roiY: [0.60,0.85], edgeAxes: 'y' }` |
| `roiDefault` | comodí (26 de 27 etiquetes) | `roiX [0,0.5]` · `roiY [0.10,0.98]` · `edgeAxes 'none'` · `minCov 1.2` · `maxCov 90` · graella **96×96** |
| claus de recepta (`ROI_KEYS`) | `roiX roiY edgeAxes color tol minCov maxCov minEdgeFrac ocrRoiX roiW roiH` | les absents manen del nivell base |
| `ocrRoiX` | `[0, 0.45]` | ROI de la CAPTURA d'OCR (no de la mesura) |
| `color` · `tol` | `#F25F13` · 25 | **màscara ÚNICA** (totes les receptes) |
| `minCov` · `maxCov` | 2,0 · 60 | 1,2 · 90 al comodí |
| `edgeAxes` · `minEdgeFrac` | `'y'` · 0,04 | `'xy'` eliminava el 100 % dels rètols |
| `scanFps` · `minOn` · `minFrames` · `minOff` · `gapMergeSec` | 2 · 0,4 · 2 · 0,3 · 0,6 | `gapSplit = max(minOff+gapMerge, 1,01/fps)` |
| `scanChunkSec` | 45 | trams ENDAVANT (el cursor només avança) |
| `refineEntry` · `refineFps` | `true` · 8 | entrada a ±3 frames |
| `ocr` · `ocrLangs` · `ocrTries` · `ocrRetryStepSec` · `ocrFuzz` · `ocrWeak` | `true` · `['es-ES','en-US']` · 3 · 0,75 · 0,55 · 0,7 | 1 procés d'OCR; reintents cap ENDAVANT |
| `longOnSec` · `minTailSec` (LEGACY) · `cardTrimFrames` · `freezeGrabFrac` · `freezeMaxSec` | 5,0 · 0,5 · **5** · 0,6 · 15 | `cardTrimFrames` = #143; `freezeGrabFrac` = frame del congelat al 60 % del clip |
| `snapTolSec` · `cache` | 1,0 · `true` | «imant al tall» · caché a `C:\temp\titolet_plan_<hash>.json` (recàlcul si canvia `algo`) |
| `tcFromName` · `tcMinSec` | `true` · 0,5 | 🔵 TC del nom: només si ≥0,5 s, dins de l'ítem i NO idèntic a tots els wott |

⚠️ **Forat detectat**: `flow_chyrons.js` llegeix `TT.scanMaxSec` (:874, :876, :887) però **la clau no existeix**
a `TITOLET_DEFAULTS` → sempre val 300 s pel `|| 300`. Si es vol limitar la finestra d'escaneig, cal afegir-la.

## 3. Historial de passades (què va fallar → què s'hi va fer)

| Passada | Data | Problema mesurat | Arregl |
|---|---|---|---|
| **1a** | 2026-10-05 | Ancoratge pel **manifest** (`ref.offsetSec` −10) → **0 intervals** sempre (el manifest barreja coords d'origen i de clip extret) | Ancoratge pel **clip REAL de V1** (`inPoint`) |
| **2a** | 2026-10-06 | Màscara i intervals mai contrastats amb el clip real | Recepta validada sobre `TNM_V1_CLIP.mp4` (**12 intervals**; 17-20 s = fons, descartat per `edgeAxes:'y'`) |
| **3a** | 2026-10-06 | (a) `cep.fs.readFile` sense encoding **corrompia els bytes ≥0x80** (11 frames en comptes de 12); (b) `IO.executeShell` és **asíncron** → l'OCR llegia un `.txt` inexistent (mesurat ~1 920 ms) | (a) `_readBinary` via **Base64**; (b) `_waitForPath(path,250,45 000)` + esborrar la sortida antiga + honorar `ERR:` |
| **4a** | 2026-10-06 | `-ss` DESPRÉS de `-i` (8-52× més lent: 311 s en 33 captures) · 3 captures concatenades per interval (**text híbrid**) · 2 idiomes = 2 processos · OCR de tota la banda llegia text aliè | `-ss` **ABANS** de `-i`; escaneig ENDAVANT per trams + parada quan tots assignats; **1 captura** (mostra de més cobertura) + 3 reintents cap endavant; `-Langs` en 1 procés; `ocrRoiX [0,0.45]`; `minOff` 1,0→0,3 i `gapMerge` 2,0→0,6; `scanFps` 1→2; col·locació per **instant detectat** (no per wottId) |
| **4a-fix** | 2026-10-06 | `ReferenceError: clipsV1 is not defined` → avortava tota la fase Resto (12/12 detectats, **0 col·locats**) | `const clipsV1 = p.clipsV1 || []` + arnés de col·locació |
| **5a** | 2026-10-06 | Cas **ZAPATERO**: interval emparellat amb score 0,556 (només s'assemblaven «mes + any») → 10,5 s abans del seu lloc; error d'ordre per wottId; entrada «uns frames tard» | `ocrWeak` 0,7 (rebutja match feble d'un text ja assignat) + **`resolveOrphans`** (banda dels veïns; descarta trossos i re-emissions) + desempat **wott més antic, després interval més antic** + **`refineEntry`** (8 fps) + caché amb `algo` (recalcula sense re-rastrejar) + **viu = clip SENCER** i congelat fins al final detectat |
| **6a** | 2026-10-06/07 | **#143**: la targeta durava **5 frames MÉS** que el rètol cremat | `cardTrimFrames = 5` (retall al final, total i part viva) → el congelat entra 5 frames abans. ✅ validat a Premiere 07/10 (`flow_chyrons v63`, commit `7f5e0d3`) |
| **7a** | 2026-10-08 | Els **6 PREGUNTA** de TNM V3 → **0 intervals** (el rètol no viu a la banda del TITOLET). A més, el disparo per **prefix** feia salts de família | **27 etiquetes literals** (v1.4.0) · **`roiPerRole` + `roiDefault`** + `recipeForRoles`/`roleGroups`/`ivGroups` (una passada ffmpeg PER GRUP; cap parella interval↔wott creua grups) · **TC del nom** (`tcFromName`) abans de rastrejar. Headless `test_role_roi.ps1` → **RESULT ALL OK** (T10b: amb la recepta vella els 6 PREGUNTA donaven **0/6**) |

> ⚠️ La 7a passada **no estava documentada** a `docs/reference/TITOLET_DETECT.md` (que s'havia quedat a la 5a
> + la taula de les 27 etiquetes): s'hi ha afegit en aquesta sessió.

## 4. Els 2 artefactes del 2026-10-08 (implementats, pendents de test a Premiere)

### #147 · El congelat portava el VÍDEO DE V1 (PNG de 524 KB en lloc de ~35 KB)

- **Causa arrel**: `_freezeTemaTitol` inserta el wott en un TC temporal lliure i captura allà. Aquell
  `Clips.insert` **podia fallar i tornar `ERR: …` i el codi continuava igualment**: (1) el `%` del nom real
  («…Crèdits al 0% d'int…») arriba al JSX, que fa `decodeURIComponent` → **«Bad or invalid URI»** →
  inserció fallida i ignorada; (2) sense clip temporal, `TEMP_TC + (tmpDur − REV_FRAME)` cau damunt del
  **PROGRAMA (V1)** → el PNG surt amb el vídeo de V1 i l'esborrat posterior peta
  (`ERR_CLIP_NOT_FOUND_AT_119.12`).
- **Fix (JS pur)**: `js/core/utils.js` → **`jsxName()`** (escapa `%` → `%25` abans del pont; usat al freeze
  i a la col·locació amb `escapedWott`/`escapedName`). `_freezeTemaTitol` → guarda `isErrRes` a cada
  `Clips.insert`; inserció temporal **3× reintents + VERIFICACIÓ** amb `getClipsLogic().getTrackClips()`
  (cal un clip dins de ±0,5 s de `TEMP_TC`); **sense clip verificat NO es captura res** (es col·loca només
  el clip viu, mai un congelat fals); `tmpDur` derivat de `tmpClip.end`; la inserció final d'animació també
  comprova `ERR`.
- **Test headless** (`C:/temp/fp/test_dedupe.html` + `run_test_dedupe.ps1`, fetch dels fitxers REALS):
  **9/9 OK**.

### #148 · La mateixa firma a V7 I V8 al mateix tc

- **Causa arrel**: al NAS hi havia el mateix rètol **dues vegades amb dos wottId** i només una tilde de
  diferència (`…_630083_Firma_Ivan Gutiérrez.00630153.mov` / `…_630175_Firma_Iván Gutiérrez.00630176.mov`).
  `_regenKey`/`_regenSeq` només reconeixen re-generacions del **mateix** wottId → no les fusionaven; en
  trobar la pista ocupada, la segona anava a una ALTRA capa (V7 ↔ V8).
- **Fix (JS pur)**: nous `_sameChyronKey` (identitat per POSICIÓ: `_regenKey` **sense** el wottId +
  `_burnedGrafNorm` → ignora generació, wottId, accents, caixa i separadors) i `_dedupeSameChyron`
  (deixa **un rètol per posició**; mana la versió més NOVA i, si empaten, el wottId més alt). Cablejat al
  **bucle comú de fases** just després de `_dedupeRegenerations` → val per a Conduct/Titol/Lloc/Nom/Resto.
  Es **SALTA** la família de grafisme cremat (el `tc` del seu nom no és la seva posició) i **no** deduplica
  noms buits o no parsejables.
- **Test headless**: **9/9 OK** (T1-T3 els dos noms reals de la firma → 1, guanya 630175; T4 rètols
  diferents que comparteixen posició → 2; T7 PREGUNTA intacta; T8/T9 noms buits i regeneracions).

## 5. Proves disponibles (on i com)

| Què | Comanda / ruta | Cobreix |
|---|---|---|
| Sintaxi V8 de tot el `js/` | `bin\check_js_v8.ps1` (**57 OK / 0 FAIL**) | tot |
| Codi mort | `bin\check_dead.ps1` (**0 orfes**) | tot |
| Lògica pura del detector | `C:\temp\fp\fp_titolet_test.html` | màscara, grups, OCR, pla (25 asserts) |
| `.raw` REAL + IO | `C:\temp\fp\fp_titolet_fix.html` + `run_headless.ps1` | Base64 + `_waitForPath` (19) |
| Escaneig endavant + refinament | `C:\temp\fp\fp_titolet_forward.html` | trams, parada, reintents, caché (39) |
| Col·locació REAL del workflow | `C:\temp\fp\fp_titolet_place.html` | `_placeTitoletChain` amb les 12 targetes reals (27) |
| Assignació interval↔wott | `C:\temp\fp\fp_titolet_assign.html` | cas ZAPATERO amb dades reals del pla (17) |
| **ROI per etiqueta (7a)** | `C:\temp\fp\test_role_roi.ps1` → `role_roi_test.txt` | `_recipeOf`/`recipeForRoles`/`roleGroups` + pipeline amb **vídeo fals** (T10b = 0/6 amb la recepta vella) |
| 27 etiquetes | `C:\temp\fp\test_roles.ps1` | disparo literal + estricteza + noms reals del NAS |
| #147/#148 | `C:\temp\fp\test_dedupe.html` + `run_test_dedupe.ps1` | `jsxName`, `_sameChyronKey`, `_dedupeSameChyron` |
| Mesura de camp (fora del repo) | `probe_mask.ps1` · `probe_series.ps1` · `probe_ocr_clip.ps1` · `probe_anchor.ps1` · `probe_race.ps1` | cobertura d'un frame, sèrie 1 fps, OCR dels intervals, ancoratge, latència de l'OCR |

⚠️ Els arnesos de les passades 1-5 carreguen una **CÒPIA** del mòdul (`C:\temp\fp\titolet_module.js`): si es
toca `17_TitoletDetect_Logic.js` cal **recopiar-la** o l'arnés prova codi VELL. Els de la 7a
(`test_role_roi.ps1`) fan `fetch` del fitxer REAL → no cal copiar res.
📦 El pla desat del cas de referència és `C:\temp\titolet_plan_7ea27e12.json` (TNM V1 ítem 16, 12 TITOLET).

## 6. Pendent immediat: test a Premiere de #147 + #148

Panell **RECARREGAT** amb els cache-bust d'avui (`utils.js v25` · `flow_chyrons.js v69` ·
**`17_TitoletDetect_Logic.js v2`** · `11_Configuracio.js v29`). Passada real (Resto) i comprovar al log:

1. **#147** — el PNG del congelat ha de fer **~35 KB** (grafisme pla), NO 524 KB; cap `ERR_CLIP_NOT_FOUND`
   en esborrar el temporal; si el wott temporal no s'hi pot posar, el log ha de dir que es col·loca
   **SENSE congelat** (mai un congelat fals amb la imatge de V1).
2. **#148** — cap firma duplicada a V7/V8; log `🧬 [fase] N rètol(s) duplicat(s) descartat(s)`; i **cap
   sobre-deduplicació**: dos rètols amb text diferent que comparteixin posició s'han de col·locar tots dos.
3. **7a passada** — mesurar al log `🔎 [titolet] … N intervals · M tram(s)` i `🎯 … detecció: X/Y detectats`
   + la **durada de la fase Resto** (cada recepta = 1 passada ffmpeg per ítem; ara hi entren 27 etiquetes).
   Objectiu del test: veure si els **PREGUNTA** ja surten (la recepta del comodí) i si la resta de tipus
   cauen al fallback (⇒ agenda §7A).

Només si el test surt bé: `#147`/`#148` → `resolt` + `validation_user` a `.roo/features.json` i **commit**.

## 7. 🔜 Agenda de la propera sessió

### 7.A · Millorar la detecció dels CARTELLS (i de la resta d'etiquetes no mesurades)

**Estat de partida (mesurat)**: de les 27 etiquetes, **només `TITOLET` té recepta pròpia**; les altres 26
hereten el **comodí** `roiDefault` (meitat esquerra del frame, `edgeAxes:'none'`, `minCov 1.2`, `maxCov 90`,
graella 96×96) i **totes** comparteixen la **mateixa màscara de color** `#F25F13 ±25`. Un `CARTELL`
(imatge/retol a pantalla completa), un `DADA-GRAN`, un `NOTA` o una `LLISTA` no tenen per què ser taronges
ni viure a l'esquerra → **no es troben i cauen al fallback**.

**📏 MESURA REAL (2026-10-08, 15:31) — `TNM_V3_CLIP.mp4`, 8 mostres** · mètode: `C:\temp\fp\measure_cartell.ps1`
(ffmpeg 384×216, mimica exacta del `crop`+`scale` del pipeline amb graella per cel·la; taronja `#F25F13 ±25`, gris `#383838 ±16`).

Geometria del cartell (IDÈNTICA a t=98,2 · 100 · 130):
- **barra taronja**: bbox y 87..110 de 216 = **0,403..0,514** (y360px 145..185) · **x 0..169 = 44,3% de l'ample, ancorada a x=0** · 16 files ≥25% d'ample.
- **cos gris `#383838`**: files 112..140 (t=100) i 112..156 (t=130) = **0,519..0,653 / 0,519..0,727**, pic 44,3-62,0% d'ample.
- A **t=98,0** la barra JA hi és però encara és GRISA (`TAG naranja: AUSENT`) → l'animació va de gris a taronja.

| instant | contingut | comodí `y[.10,.98] x[0,.5]` 96×96 | cartell `y[.32,.78]` 96×48 | cartellT `y[.35,.70]` 96×48 | titolet `y[.60,.85]` 160×45 |
|---|---|---|---|---|---|
| 96,0 | decorat dia | 0,00 | 0,00 | 0,00 | 0,00 |
| 98,0 | tall (barra encara grisa) | 0,00 | 0,00 | 0,00 | 0,00 |
| **98,2** | **cartell** | **7,93** | **15,86** | **21,22** | 0,00 |
| **100,0** | **cartell** | **7,93** | **15,86** | **21,22** | 0,00 |
| 111,0 | plató | 0,00 | 0,00 | 0,00 | 0,00 |
| **130,0** | **cartell** | **7,95** | **15,86** | **21,44** | 0,00 |
| 140,0 | plató | 0,00 | 0,00 | 0,00 | 0,00 |
| 155,0 | decorat fosc | 0,00 | 0,00 | 0,00 | 0,00 |

(màscara TARONJA, % de la ROI. Els mateixos instants amb la màscara GRISA: 96,0 → 1,41/2,32/3,23/2,31 · 111,0 → 0,46/0,56/0,91/1,01 · **155,0 → 13,55/12,85/9,94/16,79**)

**Conclusions (amb dades, no amb intuïció):**
1. **El cartell d'aquesta família SÍ que és taronja**: la barra `#F25F13` (y 0,40-0,51) hi és a TOTS els frames de cartell ⇒ la màscara
   actual ja el veu; el que fallava era la **zona** (banda del TITOLET y 0,60-0,85 → **0,00% sempre**, l'origen dels 6 PREGUNTA a 0 intervals).
2. **El comodí de la 7a passada ja el caça**: 7,93-7,95% amb `minCov 1.2` (marge **6,6×**) i **0,00% als 4 negatius** ⇒ aquest cas ja està cobert;
   només falta el test a Premiere (apartat 6).
3. **El GRIS NO pot entrar a la màscara** (descartat per dades): amb `#383838 ±16` el decorat fosc sense cap rètol (t=155) dóna **13,55%**
   i el cartell real **17,07%** al mateix ROI ⇒ **sense marge** (a la banda cartell: 12,85% vs 26,30%, marge 2×). El cos gris només valdria
   com a SEGON senyal (co-presència amb la barra), mai sol.
4. **Banda pròpia `y[0.32,0.78] x[0,0.5]` (roiW 96 · roiH 48)**: apuja el senyal del cartell a **15,86%** (21,2-21,4% amb `y[0.35,0.70]`)
   i manté **0,00%** als quatre negatius ⇒ permet pujar `minCov` a ~4-5 (llindar absolut ≈19k px contra ≈11k del comodí = ~1,7× més estricte).
5. **Cost**: una recepta amb valors DIFERENTS crea un grup d'ffmpeg propi (`roleGroups` dedueix per signatura d'`ROI_KEYS`) ⇒ +1 passada
   per ítem que barregi aquesta etiqueta amb les del comodí. Una recepta amb la MATEIXA signatura no canvia res (mateix grup).

**Decisió pendent (usuari)**: (a) deixar el comodí tal com està i validar a Premiere · (b) recepta pròpia de `PREGUNTA`/`CARTELL` amb banda
estreta + `minCov` alt · (c) si hi ha cartells **sense barra taronja** (imatge pura), cal mesurar-ne un altre i entrar a §7A.3 (detecció
sense color / diferència de frames).

**Camí previst (JS pur; JSX tancat)**:

1. **Mesurar amb material real abans de tocar res** (mètode de les passades 2a/7a): triar un ítem del NAS
   amb wotts de l'etiqueta que es vol mesurar, i amb `probe_*.ps1` (o `Logic.FFmpeg.extractFramePng` des de
   la consola del panell) extreure 1-2 frames a l'instant del rètol → anotar **color real**, **bbox** i
   **si és text o imatge**. Amb això s'omple `roiPerRole['CARTELL'] = {…}` (o l'etiqueta que sigui).
2. **Suport de VÀRIES mostres de color per recepta** (avui `color` és un hex únic): afegir a la recepta
   `colors: ['#F25F13', …]` i fer OR de les màscares a `_hexToRgb`/`_analyzeFrame` — canvi petit i contingut
   al mòdul, ja previst per `ROI_KEYS` (només cal ampliar la llista de claus i la resolució).
3. **Detecció sense color** (només si la mesura ho justifica): un `CARTELL` pot ser una IMATGE; en aquest cas
   la màscara de color no serveix i caldria detectar **canvi de contingut** respecte a la mostra prèvia de la
   sèrie (diferència de frames). És més car → decidir amb temps de la fase Resto al davant.
4. **2a passada per etiquetes que no han trobat res**: avui `planForItem` fa **una passada per grup**; si un
   grup no troba cap interval, l'ítem s'encadena. Es pot afegir un *retry* amb la recepta ampla
   (`roiDefault`) o amb `scanFps` més fi abans de donar-lo per perdut.
5. **Cost a vigilar**: cada recepta = 1 passada d'ffmpeg per ítem. Si la fase Resto s'allarga massa:
   treure etiquetes de `detectRoles`, apujar `scanChunkSec`, o afegir `scanMaxSec` (avui **no existeix** a la
   config i per això el `|| 300` de `flow_chyrons` sempre mana).

**Fronteres que NO s'han de trencar**: `roles` (una entrada per wott, `''` si no es reconeix) i `ivGroups`
(cap parella interval↔wott pot creuar grups); `_recipeOf` ha de seguir tornant `recepta <rol>` / `comodí` /
`base` per al log.

### 7.B · Col·locar els NO detectats amb més criteri (clip complet + 1 congelat, al final com ara)

**Avui** (`_placeTitoletChain`, branca `else`): `tStart = maxEndTl + GAP` (1,0 s **després de l'últim instant
ja col·locat**, sigui d'una detectada o d'un encadenat) amb `want = liveW + freezeDur`, on
`liveW = max(0,5; cardDur − TRIM)` i `freezeDur` = **3 s** (o **1 s** si la cadena sencera no cap a l'ítem).
Ordre dels encadenats = **wottId ascendent**. Log `⛓️ [ítem] TAG n/N «nom» SENSE detecció → encadenat a Xs`.

**Petició d'usuari (2026-10-08)**: «el clip completo y un congelado por si hay que dejarlo largo, todo ello
al final como ahora». Llegit com a 3 punts concrets:

| # | Què | On es toca |
|---|---|---|
| **B1** | Part viva = **clip SENCER** (sense el retall de 5 frames `cardTrimFrames` que sí volen les detectades, perquè allà l'enllaç amb el congelat ha de quedar sense buit) | factor `TRIM` dins la branca `else` (avui global) |
| **B2** | Congelat **llarg** perquè l'operador el pugui estirar després (ara 3 s, topall `freezeMaxSec` = 15 s) | `freezeDur` de la branca `else` (o una clau nova, p. ex. `freezeUndetectedSec`) |
| **B3** | Tots **al FINAL** de l'ítem, agrupats, després de les detectades (ordre intern: avui wottId ascendent) | branca `else` (ja ho fa) |

**Decisions a prendre amb el log al davant (no inventar)**:
- Si el `GAP` d'1,0 s s'ha de mantenir entre encadenats o anar més junts.
- Si el congelat llarg pot **sobrepassar el final de l'ítem**: ara el retall de seguretat limita cada targeta a
  la següent i al final de l'ítem → decidir si es vol que **desbordi** (deixar llarg) o que es retalli.
- Si cal una clau pròpia per al TRIM dels no detectats o reutilitzar `cardTrimFrames = 0` a la branca `else`.
- Recordatori: el congelat s'obté amb `_freezeTemaTitol` (frame al 60 % del clip, `freezeGrabFrac`) — **no
  allargar-lo sense clip temporal verificat** (#147).

**Cap canvi JSX**: tot és span (`want`) + el freeze existent; el nombre de peces per targeta no canvia.

## 8. Regles i estat de treball

- **JSX està TANCAT** (zero JSX nou; tot el d'avui és JS pur orquestrant àtoms existents).
- Abans de tancar qualsevol canvi: `bin\check_js_v8.ps1` (57 OK / 0 FAIL) + `bin\check_dead.ps1` (0 orfes) i
  **cache-bust a `index.html`** de cada `.js` tocat.
- **No commit sense test a Premiere** (regla del projecte).
- Working tree d'avui (2026-10-08) **sense commit**: `js/core/utils.js` · `js/workflows/flow_chyrons.js` ·
  `js/logic/17_TitoletDetect_Logic.js` · `js/logic/15_FFmpeg_Logic.js` · `js/core/11_Configuracio.js` ·
  `index.html` · `.roo/features.json` · `.roo/progress/2026-10-08.md` · `docs/reference/TITOLET_DETECT.md` ·
  aquest handoff. Fora de l'abast a propòsit: `bin/build_graph.ps1` + `docs/graph/` (eina, sense trackejar).
- HEAD actual: `a56d4e8 feat: RESET GENERAL del bloc (boto RESET A INICI) [validat a Premiere]`.
- Ítems vius relacionats: **#147** i **#148** (`implementat_pendent_test`) · #143/#144/#145 `resolt` (07/10).


