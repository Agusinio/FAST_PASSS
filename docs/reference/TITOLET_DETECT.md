# TITOLET — Detecció automàtica del rètol cremat

> v1.5.0 · 2026-10-08 (7a passada: **ROI per etiqueta** `roiPerRole`/`roiDefault` + **TC del nom** · 6a: `cardTrimFrames` · artefactes #147/#148) · `titolet.*` a `Config` (`11_Configuracio.js`) · `bin/ocr.ps1` · `js/logic/17_TitoletDetect_Logic.js` (`?v=2`) · `15_FFmpeg_Logic.js` · `flow_chyrons.js` (`?v=69`) · `js/core/utils.js` (`?v=25`)
>
> 📄 Estat complet, proves, pendents i **agenda de la sessió següent**: `plans/HANDOFF_2026-10-08_TITOLETS.md`

## Què fa

Mesura al MP4 `cleanFeed` (el senyal net amb els rètols cremats) **quan entra i quant dura** cada
TITOLET, i en llegeix el text per OCR per saber **quin wott** és. Amb això la cadena TITOLET deixa
d'endevinar el congelat: si el rètol va estar a l'aire menys que la targeta, la targeta es **retalla**.

## 🎯 Condició de disparo — quan es rastreja i quan NO (2026-10-08)

El rastreig **no es fa mai per sistema**. S'activa només quan l'ítem de l'escaleta porta wotts
amb alguna de les **27 etiquetes literals** del sistema de ròtols que hi ha a
**`titolet.detectRoles`** (a `11_Configuracio.js`). El matx és d'**igualtat** sobre el token
normalitzat —**mai prefix ni substring**: `DADA` a seques NO dispara res, cal l'etiqueta sencera
(`DADA-GRAN`)—. L'única tolerància és majúscules/minúscules i l'estil del separador (`_ - .` i
espai), perquè el sistema no l'escriu sempre igual (`Tema-Titol`, `Nomcarrec`, `Enviat_Sí`,
`Directe_PRESENCIAL`…).

| Etiquetes (`detectRoles`) | |
|---------------------------|---|
| `TITOLET` · `TITOLET GRAN` · `PREGUNTA` · `CARTELL` · `CIS_CEO` · `CIS_CEO_COMPARADA` | |
| `CRONOLOGIA` · `CRONOLOGIA-TITOLS` · `DADA_COMPARADA` · `DADA-DIFERENCIAL` · `DADA-GRAN` | |
| `DADA-GRAN-DIVISA` · `DADA-ITEM` · `DESTACAT` · `CLASSI-CHAMPIONS` · `CLASSIFICACIO` | |
| `CLASSI-MUNDIAL` · `CLASSI-PRIMERA` · `CLASSI-SEGONA` · `GRAFICA-BARRES` · `GRAFICA_CIRCULAR` | |
| `IMATGE-CAPTURA` · `LLISTA` · `LLISTA-DADES` · `NOTA` · `PROGRAMACIO` · `RANQUING` | |


**On es decideix** (única porta d'entrada, `flow_chyrons.js`):

1. Fase **Resto** (`placeChyronResto`) → `_placeChyronsByType(..., { dedupeTitolet: true, chainTitolet: true })`.
2. `_isBurnedGrafWott(chy)` → `_burnedGrafRole(chy)`: es normalitzen els tokens de
   `_burnedGrafTokens(chy)` —el camp `chy.rol` **i el tros de ROL del nom** (`name.split('_')`
   des de l'índex 7, la mateixa part que llegeix `13_Parse.meta`; com que hi ha etiquetes amb `_`
   a dins el nom les parteix, s'hi afegeixen les unions de fins a 3 trossos:
   `CIS`+`CEO`+`COMPARADA` → `CIS_CEO_COMPARADA`)— i es compara per **igualtat** amb cada
   etiqueta; si n'hi encaixa més d'una, mana la **més llarga** (`LLISTA-DADES` abans que
   `LLISTA`). **Mai** es mira la part del TEXT (índex 5): un rètol que digués «LES DADES DEL
   PARO» o «LA PREGUNTA DE…» dispararia les famílies `DADA`/`PREGUNTA` sense cap grafisme cremat
   a l'aire.
3. Si l'ítem en té ≥1 → `_placeTitoletChain` (detecció `Logic.TitoletDetect` + col·locació).
   Si no n'hi ha cap → **no es rastreja res** (l'ítem segueix pel bucle genèric de rètols).
4. Dins de la cadena encara hi ha 2 portes: `titolet.enabled !== false` i que l'**ancoratge**
   resolgui (`_titoletAnchor`: clip extret de V1 o cleanFeed del manifest amb `ref.offsetSec`) →
   si no, fallback (cadència actual) sense rastrejar.

**Afegir un tipus nou** = afegir-ne l'etiqueta LITERAL a `titolet.detectRoles` (només JS, cap JSX
nou). Els logs de la cadena surten etiquetats amb l'etiqueta que l'ha disparada (`p.tag`): amb un
grafisme DADA-GRAN es llegeix `[Resto] DADA-GRAN detecció: …` en comptes de `TITOLET`. El
`_dedupeTitolet` també agrupa per etiqueta + text, així dos tipus diferents amb el mateix text no
es fusionen (ni `DADA-GRAN` i `DADA-ITEM`, que abans compartien el patró `DADA`).

⚠️ **La receta és la mateixa per a tots els tipus**: color `#F25F13` ±25, ROI `[0.60, 0.85]`,
OCR a l'esquerra… (el taronja del rètol mosquit). Per als grafismes que **no siguin taronges** o
no visquin en aquesta zona, el rastreig no trobarà res → l'ítem cau al **fallback** (cadència
actual, sense error). Pendent de mesurar a Premiere: si cal, una 2a passada de rastreig amb altres
paràmetres (o paràmetres per tipus a `detectRoles`).

⚠️ **Cost**: cada ítem amb wotts d'algunes d'aquestes 27 etiquetes fa la SEVA detecció (ffmpeg +
OCR, ~10 s per 156 s d'ítem, amb caché de pla a `C:\temp\titolet_plan_<hash>.json`). Com que ara
hi entren tipus molt freqüents (`NOTA`, `DESTACAT`, `DADA-GRAN`, `LLISTA`…), la fase Resto
s'allargarà: per retallar-ho, treure etiquetes de `titolet.detectRoles` (o
`titolet.enabled = false`).

## Receta (validada a l'ítem 16: 12/12 wotts)

| Pas | Paràmetre (`titolet.*`) | Valor |
|-----|------------------------|-------|
| ROI de mesura | `roiY` · X = tot l'ample | `[0.60, 0.85]` de l'alçada |
| ROI de l'OCR | `ocrRoiX` | `[0, 0.45]` de l'amplada (el rètol viu a l'esquerra) |
| Escaneig | `roiW`×`roiH` @ `scanFps` · trams `scanChunkSec` | 160×45 @ **2 fps** · trams de 45 s |
| Màscara de color | `color` · `tol` | `#F25F13` ± 25 per canal |
| Cobertura | `minCov` · `maxCov` | ≥ 2 % i < 60 % del ROI |
| Vores | `edgeAxes` · `minEdgeFrac` | **`'y'`** (només dalt/baix) · 0,04 |
| Intervals | `minOn` · `minFrames` · `minOff` · `gapMergeSec` | 0,4 s · 2 mostres ON · **0,3 s** · **0,6 s** |
| OCR | `ocr` · `ocrLangs` · `ocrTries` · `ocrRetryStepSec` · `ocrFuzz` | `ocr.ps1 -Langs` (**1 procés**) · `es-ES`,`en-US` · 3 · 0,75 s · 0,55 |
| Decisió | `longOnSec` · `minTailSec` | 5,0 s · 0,5 s |
| Col·locació | `snapTolSec` | 1,0 s (l'«imant» cap al tall anterior de V1) |
| Caché | `cache` | `true` → `C:\temp\titolet_plan_<hash>.json` |
| Mode | `dryRun` | **`false`** (activat 2026-10-06; en calent: `FASTPASS_UI.State.titoletDryRun = true`) |

### 🔴 Regla de vores (mesurada, no teòrica)

El TITOLET és una **xinxeta ancorada a l'esquerra del frame**: en `roi_real.raw` (TN Migdia 2026-10-05)
el bbox de la taca és SEMPRE `x0 = 0`, `x1` 55-79 de 160, `y` 3-41 de 45. Descartar la taca que toca
*qualsevol* vora del ROI (`'xy'`) eliminava el 100 % dels rètols (**0 intervals**). El que sí que
delata un FONS de grafisme és que la taca ompli el ROI **de dalt a baix** → per això `edgeAxes:'y'`.
La guarda `maxCov:60` és la segona xarxa (ROI saturat = fons).

## Ancoratge (on és el rètol dins del fitxer) — 🔴 llegir abans de tocar res

La timeline **NO** conté el cleanFeed: conté el **CLIP EXTRET** del bloc
(`<WOTT>_<BLOC>_CLIP.mp4`, a la carpeta de treball del bloc). Per tant l'ancoratge s'ha de
fer amb el clip REAL que hi ha a V1, no amb la referència del manifest:

```
fileSec = tlSec + (clip.inPoint − clip.start)        // clip = Clips.get del clip de V1
```

És la mateixa regla que fan servir l'ancoratge de marcadors (`flow_markers` FIX-B/D) i els
keyframes (`7_KF.jsx`: `tKey = inPoint + (cti − start)`).

**Cas real mesurat (TNM V1 2026-10-05 · `TNM_V1_CLIP.mp4`, 257,21 s):**

| Dada | Valor |
|------|-------|
| clip 0 del fitxer = cleanFeed | **904 s** (comprovat per OCR: mateixa imatge «TERRA») |
| bloc (in-point dins del clip) | 20 s → **cleanFeed 924 s** |
| TITOLETs (cleanFeed) | 932→1074 s = **clip 28→170 s** |
| `ref.offsetSec` del manifest | −10 → buscava el rètol a **cleanFeed 10 s** → **0 intervals** |

Per això la 1a versió (ancoratge pel manifest) no podia trobar mai res: el manifest barreja
coords d'ORIGEN i de CLIP EXTRET (vegeu el guardià de l'invariant a `flow_markers.js:484-506`).

## Flux de dades

```
flow_chyrons._placeTitoletChain  (ítem d'un marcador TITOLET)
  ├─ _titoletAnchor(p, wctx)  → {mp4, off, how}   (fileSec = tlSec + off)
  │    1) CLIP EXTRET de V1: `_clipAtInstant(clipsV1, mk.time)` → name amb «_CLIP» +
  │       `inPoint` → fitxer <carpeta de treball>\<clip.name> (o <WOTT>_<BLOC>_CLIP.mp4)
  │    2) xarxa (si no hi ha clip extret): SessionManifest.load(wctx) → cleanFeed.mediaPath
  │       + ref.offsetSec  →  off = −offsetSec
  └─ Logic.TitoletDetect.planForItem({mp4, names, tItemStart: mk.time+off,
                                      tScanStart: tItemStart−pad, tScanDur, cfg})
       1. FFmpeg.extractRoiSeries()  → 1 .raw rgb24 (crop ROI + scale + fps=1)
       2. analyzeSeries()            → cobertura/bbox per mostra (JS, `cep.fs.readFile`)
       3. groupIntervals()           → intervals ON  (minCov/maxCov/edge/gap)
       4. ocrInterval()              → FFmpeg.extractFramePng (t_in+1, t_in+2, t_out−1) + bin\ocr.ps1
       5. buildPlan()                → cards[k] = {found, on, relIn, relOut, kind}
                                       kind: 'short' (≤5 s → RETALLAR) · 'long' (>5 s → cadència)
                                             · 'none' (sense detecció → fallback)
```

⚠️ `p.ctx` (dins de `_placeChyronsByType`) és el ctx de **COL·LOCACIÓ** (`{busy, placed}`), no
el de sessió: `SessionManifest.getPath` hi fa `ctx.progData.wott` → TypeError. La detecció
rep el ctx de sessió a `p.wfCtx` (`_wfCtx()` = `FASTPASS_UI.State`).

## Decisió de col·locació (`flow_chyrons.js`)

- `onAir > longOnSec (5 s)` → **cadència actual** (congelat 3 s / 1 s; la targeta té 5 s).
- `onAir ≤ longOnSec` → **retall**: `animSec = on − minTail` i `stretchEnd = cursor + on`
  (la cua no pot baixar de 0,5 s: és el terra que imposa `_freezeTemaTitol`).
- Sense detecció (o sense ancoratge viable: ni clip extret ni `mediaPath`/`offsetSec`) → **fallback**: cadència actual.
- `dryRun: false` (actiu) → s'aplica el retall. Per fer un dry-run sense tocar codi:
  `FASTPASS_UI.State.titoletDryRun = true` a la consola del panell (informa al log: `N/M detectats · cadència vs pla (Δ)`).

## Test

- Pures: `C:\temp\fp\fp_titolet_test.html` (25 asserts) → `msedge --headless=new --dump-dom`.
- Dades reals: `C:\temp\fp\fp_titolet_real.html` sobre `roi_real.raw` (XHR + `--allow-file-access-from-files`).
- **IO (3a passada): `C:\temp\fp\fp_titolet_fix.html`** + `C:\temp\fp\run_headless.ps1` → 19 asserts:
  bytes exactes (Base64 vs fallback cec), espera de l'OCR asíncron i pont complet `planForItem`
  sobre un `.raw` real. `check_js_v8.ps1` → `TOTAL 58 | OK 58 | FAIL 0`.
- En tots els arnesos cal `window.FASTPASS_UI = { Logic: {} }` al principi (a l'extensió el crea el primer mòdul)
  i el mòdul copiat al costat (`titolet_module.js`), perquè Chromium bloqueja `<script src="file://…">`.

### Ancoratge + màscara sobre el CLIP REAL (2a passada, 2026-10-06)

Vaixell de prova: `TNM_V1_CLIP.mp4` (TNM V1 2026-10-05) amb **la mateixa recepta** de
`extractRoiSeries` (`crop=iw:ih*0.25:0:ih*0.60,scale=160:45:flags=area,fps=1`, rgb24 cru,
`-ss` DESPRÉS de `-i`), finestra **[17,180] s** = la que calcula el codi (`tItemStart=20`,
`pad=3`, ítem 0,00→156,40 s):

- **12 intervals ON** (17-20 s és un FONS que descarta `edgeAxes:'y'`; 147-148 s, taca de vora):
  `28-29 · 45-47 · 53-56 · 63-65 · 76-79 · 92-97 · 108-111 · 116-120 · 130-134 · 143-145 · 161-163 · 165-169`
  amb `cov` 17-27 % i `bbox x0=0 · x1 55-79 · y 7-37` (de 45) → dins de `minCov 2` / `maxCov 60` ✓
- **OCR** (frame del clip, ROI nativa): `febrer 2024 / JOSÉ LUIS ABALOS` (46 s) ·
  `octubre 2024 / ÁLVARO GARCÍA ORTIZ` (93 s) · `jung 2025 / LEIRE DÍEZ` (131 s) ·
  `Setembre 2023 / CATALA, CALLEC I EUSKERA / -LO: 338 TELEMÁTICOS: 12` (29 s) ✓
- **Prova d'ancoratge**: el clip 0 i el cleanFeed 904 s donen la MATEIXA imatge («TERRA») →
  clip 0 = cleanFeed 904 s ✓ (i el bloc, a `inPoint` 20 s, = cleanFeed 924 s).

Scripts de prova (fora del repo, a `C:\temp\fp\`): `probe_anchor.ps1` (OCR comparatiu),
`probe_mask.ps1` (cobertura d'un frame), `probe_series.ps1` (sèrie 1 fps = intervals),
`probe_ocr_clip.ps1` (OCR dels intervals).

### 🔴 IO del `.raw` i OCR asíncron (3a passada, 2026-10-06)

Dos errors d'entrada/sortida feien que la detecció, tot i ser correcta, **no trobés mai intervals
ni text**. No eren lògica de negoci: eren el pont amb el disc i amb el shell.

**1) `cep.fs.readFile(path)` SENSE encoding corromp els bytes ≥ 0x80.**
La lectura crua passa el binari per un descodificador UTF-8 → seqüències multibyte substituïdes i
bytes perduts. **MESURAT** amb un `.raw` real de 160×45×3×12 B = 259 200 B: la lectura crua en
retornava **256 050 caràcters** (11 frames en comptes de 12) i la cobertura sortia
`7,97 / 10,69 / 4,25 / 14,08 %` on la veritat és `17,44 %` a 76-79 s → intervals i temps desplaçats.
**Fix** (`_readBinary`): demanar `window.cep.encoding.Base64` → `atob` → `Uint8Array`
(**mateix patró que `WaveformGenerator.loadPeaksFromBin` de `10_Srt_Logic.js`**). Si la via Base64
falla, es fa el fallback cru però **avisant al log** (`⚠️ … bytes POTser corromputs … la cobertura
no és fiable`) perquè no torni a passar en silenci.

**2) `IO.executeShell` és ASÍNCRON (fire-and-forget) → l'OCR llegia un fitxer que encara no existia.**
El pont llança el `.bat`/`.ps1` i **torna de seguida**; el codi llegia `outTxt` immediatament →
`''` SEMPRE. **MESURAT** (`probe_race.ps1`): `bin\ocr.ps1` triga **~1 920 ms** a escriure el `.txt`
(la lectura es feia a t ≈ 0 ms). Com que el primer idioma tornava buit, es provava el segon en va i
el resultat final era `''` → cap wott assignat. **Fix** (`ocrText`): esborrar la sortida antiga
(`IO.remove`), llançar el shell i **esperar** que aparegui el `.txt` amb `_waitForPath(path, 250, 45 000)`
(polling `cep.fs.stat`, amb `IO.exists` com a xarxa; no bloqueja el motor), honorar el prefix `ERR:`
que hi escriu `ocr.ps1` i esborrar el temporal.

**3) Decisió de seek: `-ss` DESPRÉS de `-i` (output-seek), i no canvia res més.** Amb re-encode
(sense `-c copy`, que és el nostre cas) l'input-seek i l'output-seek donen **el mateix frame**:
mesurat, `md5` idèntics per a t = 74/75/76 s. Es manté `-ss` després de `-i` perquè és exacte i
perquè el frame d'OCR comparteix la **mateixa base absoluta** que la sèrie (`analyzeSeries` hi suma
`tStart`) → l'**alineació índex ↔ temps està garantida** i no cal un pipeline `filter_complex` amb
`split` (seria refactor sense benefici mesurat).

**4) L'OCR necessita la ROI a mida NATIVA (no 160×45).** `extractFramePng` només fa `crop`
(`1920×270`), sense `scale`: mesurat que el mateix frame escalat a 160×45 dona **OCR buit** i a
mida nativa llegeix el text. La sèrie de mesura va escalada (per comptar color), però el frame que
va a l'OCR no.

**Validació (3a passada)**: `C:\temp\fp\fp_titolet_fix.html` + `run_headless.ps1` (Edge headless,
carrega el mòdul **real** i un `.raw` **real** de 12 frames 160×45, `tStart = 74 s`, `IO.executeShell`
retardat 1 200 ms) → **TOTAL 19 | OK 19 | FAIL 0**:
`cov = 0 0 17.44 17.44 17.43 17.43 0 0 0 0 0.07 0.04` → **1 interval `[76, 80]`** (el codi antic
donava `2.65 / 2.68 / 1.94 / 4.24`), `ocrText` → `setembre 2024 / PABLO LLARENA` (espera real
1 251 ms), `planForItem` → wott assignat pel token `pablo` (score 1), `relIn/relOut = 2/6`,
`kind 'short'` (4 s ≤ `longOnSec`).

## 🔴 4a passada (2026-10-06) — rendiment, precisió i col·locació

Referència: ítem 16 de `TNM_V1` del **2026-10-05** (12 TITOLET, `TNM_V1_CLIP.mp4`,
257,21 s, 1080p25). Amb la 3a passada `[CHY] Resto` va trigar **350,7 s** i 9 de les
12 targetes van anar a un instant que no era el seu (i en un altre ordre).

### 1) Temps: `-ss` ABANS de `-i` (seek d'ENTRADA)

| t | `-i src -ss t` (3a passada) | `-ss t -i src` (ara) | mateix frame |
|---|---|---|---|
| 27,76 s | 2,66 s | **0,33 s** | sí (md5) |
| 142,76 s | 11,84 s | **0,26 s** | sí (md5) |
| 160,76 s | 12,93 s | **0,25 s** | sí (md5) |

Amb el seek a la sortida ffmpeg **descodifica des de 0** fins a l'instant demanat i el
cost creix amb `t`: per això les 33 captures (11 intervals × 3) costaven **311 s**
(4-5 s les primeres, 12-14 s les últimes). La 3a passada va mantenir el seek de sortida
perquè «dona el mateix frame» — cert, però no es va mirar el COST: és 8-52× més lent.

### 2) Escaneig ENDAVANT per trams i parada

`planForItem` ja no escaneja tota la finestra d'un cop (`scanChunkSec` = 45 s):

1. El cursor **només avança**: mai es torna a rastrejar el que ja ha passat.
2. Un cop processat un interval, la cerca continua **des d'allà**.
3. Quan tots els wott estan assignats, **s'atura** (no escaneja la resta de l'ítem).

### 3) UNA captura per interval (+ reintents cap ENDAVANT)

- L'interval porta `bestT` = la mostra de **més cobertura** (el frame amb el rètol més
  format) → és la 1a captura que va a l'OCR. Abans eren **3 captures fixes** (t_in+1,
  t_in+2, t_out−1) amb els textos **concatenats**: quan l'interval fusionava dos rètols
  (Ceuta + Maricarmen) el text sortia híbrid i s'assignava malament.
- Si l'OCR no dona text **o** no casa amb cap wott PENDENT, es reintenta cap endavant
  (`ocrRetryStepSec` 0,75 s) fins a `ocrTries` = 3 cops, sempre dins de l'interval.

### 4) OCR: tots els idiomes en UN procés

`bin/ocr.ps1 -Langs "es-ES,en-US"` els prova dins del mateix PowerShell (abans cada idioma
era un procés: ~1,5 s d'arrencada + ~1,9 s fins al `.txt`). El PNG es descodifica un cop i
mana el primer idioma que llegeix alguna cosa.

### 5) La ROI de l'OCR s'ha estret

`ocrRoiX = [0, 0.45]` (abans tot l'ample). Mesurat al frame 28,76 s del clip (zona del
rètol: R247 G138 B83; la mostra prèvia, grisa R58 G58 B58): el rètol viu a l'ESQUERRA
(x 0-0,29) i l'OCR de tota la banda llegia a més el panell de votacions del fons
(«… -LO: 338 TELEMÁTICOS: 12»), text aliè que contamina el match.

### 6) Intervals: no fusionar dos rètols seguits

`minOff` 1,0 → **0,3 s** i `gapMergeSec` 2,0 → **0,6 s**: amb 3 s de finestra, els dos
últims rètols reals van quedar en **un sol interval de 9 s** → un wott perdut i l'altre
amb la durada del veí. `scanFps` 1 → **2** (la durada tenia ±1 s d'error) i `minFrames` = 2
(una sola mostra ON és soroll, no un rètol).

⚠️ **Bug trobat per l'arnés nou** (corregit): la finestra de fusió ha de ser MÉS GRAN que el
període de mostreig — `gapSplit = max(minOff + gapMergeSec, 1,01/fps)`. Amb `scanFps = 1` i
0,9 s de finestra, dues mostres ON consecutives es donaven per separades → cada mostra era
un interval d'1 sola mostra → `minFrames` = 2 els descartava **tots** (0 intervals).



### 7) Col·locació: cada TITOLET al SEU lloc (no en cadena pel wottId)

Al log real l'ordre de col·locació era **l'ordre de GENERACIÓ del grafisme** (wottId), que
no té cap relació amb el de l'aire:

| Col·locat | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| wott | Pablo | Carlos | Álvaro | David | Zapatero | Ceuta | Maricarmen | Català | Abalos | Leire | Begoña | Cerdán |
| **A l'aire** | Català | Abalos | Cerdán | Begoña | Pablo | Álvaro | Carlos | David | Leire | Zapatero | Ceuta | Maricarmen |

`_placeTitoletChain` (**5a passada**, 2026-10-06):

```
placeTime = mk.time + card.relIn      (relIn = segons dins de l'ítem del VÍDEO)
viu       = clip SENCER de la targeta (homogeni per a totes)
congelat  = relOut − (placeTime + viu)  només si el rètol cremat va viure MÉS enllà
span      = viu + congelat   ← topall: la targeta SEGÜENT i el final de l'ítem (✂️)
```

- **ORDRE**: cronològic pel `relIn` detectat (els intervals ja venen en ordre).
- **IMANT AL TALL** (`snapTolSec` = 1,0 s): si l'instant detectat cau a ≤ 1 s del **tall
  anterior** de V1, la targeta entra **EXACTAMENT** a l'inici d'aquell clip. ⚠️ A la 4a
  passada s'hi sumaven 10 frames (OFF = 0,40 s): al log real de l'ítem 16 TOTES les targetes
  «imantades» entraven a `tall + 0,40 s` (31,00 en comptes de 30,60; 143,00 en comptes de
  142,60) → l'imant no es veia i anaven 10 frames tard.
- **VIU + CONGELAT** (5a passada · petició d'usuari): la part viva és SEMPRE el clip sencer
  (abans es retallava a `on − minTailSec` → parts vives de 0,5 s a 5,2 s segons la targeta,
  que es veien desiguals) i el **congelat només hi és si el rètol cremat va durar més**, i
  dura exactament fins al **final detectat** (`relOut`). Abans el congelat era de 0,5 s forçat
  a totes i de 3 s a la «llarga» — i aquell 3 s sobrepassava el final detectat (75,40→78,40 s
  quan el rètol s'acabava a 76,50 s). El frame que es congela es captura al 60 % del clip
  (`freezeGrabFrac`): el darrer frame és l'animació de SORTIDA i el PNG sortiria buit. Sense
  congelat no es captura ni s'importa cap PNG (`_freezeTemaTitol` amb `freezeSec: 0`).
- **SENSE detecció**: la targeta s'encadena darrere de l'últim instant detectat (fallback)
  amb `viu + freezeDur` (3 s; 1 s si la cadena no cap a l'ítem).
- **PISTA TARGETA A TARGETA**: `_chooseSlot([V8 Lloc/Data, V7 rètols])` i el rang de cada
  targeta es reserva a `ctx` en col·locar-la. Abans es reservava el rang SENCER de la cadena
  (0,40 → 68,88 s al cas real): amb la col·locació per instant això bloquejaria tot l'ítem.

### 8) Caché del pla

`cache: true` → `C:\temp\titolet_plan_<hash>.json` (hash de clip + tItemStart + finestra +
noms + paràmetres de detecció). Repetir la col·locació d'un mateix ítem **no torna a
rastrejar**. En calent: `FASTPASS_UI.State.titoletNoCache = true`.

### 9) FIX post-prova a Premiere (2026-10-06): `clipsV1 is not defined`

La 1a prova real (TNM V1 · ítem 16 · 12 TITOLET) va **detectar 12/12** però **no va
col·locar cap targeta**. Al log de la carpeta PROVES (`FASTPASS.log`):

```
🔎 [titolet] Resto: 12/12 wotts · 14 intervals · 4 tram(s) · 325 mostres (160x45) · ATURAT (tots assignats)
🎯 [Resto] TITOLET detecció: 12/12 detectats · 11 curtes · 1 llargues · 0 sense detecció
💥 [Resto] Error: clipsV1 is not defined
```

`_placeTitoletChain` llegia `clipsV1` com a variable LLIURE (el paràmetre és `p.clipsV1`)
→ `ReferenceError` a la 1a targeta DETECTADA (l'«imant» al tall). Com que l'excepció puja
per `_placeChyronsByType`, **avorta tota la passada Resto**: no es col·loca CAP targeta
(de la cadena ni del fallback) ni cap altre rètol del mateix ítem.

Arreglat amb `const clipsV1 = p.clipsV1 || [];` a l'inici de la funció. Lliçó: els errors
dins del bucle de col·locació no es veuen com a `⚠️ NO col·locat` (són fatals), així que
tot canvi a `_placeTitoletChain` s'ha de cobrir amb l'arnés de col·locació.

### Validació (4a passada)

| Prova | Resultat |
|---|---|
| `C:\temp\fp\fp_titolet_forward.html` (arnés NOU, mòdul real + sèrie sintètica) | **32/32 OK** |
| `C:\temp\fp\fp_titolet_fix.html` (arnés de la 3a passada, `.raw` real) | **19/19 OK** |
| `C:\temp\fp\fp_titolet_place.html` (arnés NOU: `_placeTitoletChain` REAL del workflow) | **16/16 OK** |
| `bin\check_js_v8.ps1` | 58/58 OK (exit 0) |
| `bin\check_dead.ps1` | 0 orfes (exit 0) |

L'arnés nou cobreix: `attemptInstants` (creixents i dins de l'interval), 2 trams amb 1
captura per interval i el 2n tram començant EXACTAMENT al límit del 1r (mai enrere),
parada en assolir tots els wott, 3 reintents cap endavant quan l'OCR falla, i que la 2a
crida surti de la caché sense cap escaneig ni captura nova.

`fp_titolet_place.html` (carrega el `flow_chyrons.js` REAL amb `Config`/`Clips`/`Utils`
simulats i les **12 targetes reals del log**) comprova: cap `ReferenceError`, 12/12
col·locades, cada targeta a `mk.time + relIn`, ordre cronològic (no per wottId), 3 «imants»
cap endarrere amb `Δ ≤ snapTolSec`, spans (`on` / `5+congelat`), `anim` = `span − minTailSec`,
`tempTC` compartit, 0 «NO col·locat», encadenat del fallback (`⛓️`) i baixada a V7 quan la
pista preferent està ocupada.

### 10) Assignació interval ↔ wott (5a passada): el cas ZAPATERO

La 2a prova real (13:54) va col·locar **12/12 targetes**, però amb errors de col·locació:

| Símptoma | Causa (llegida al pla real de la caché) | Arregl |
|---|---|---|
| El TITOLET del ZAPATERO entrava 10,5 s **abans** del seu lloc | L'interval `i10` (relIn 111 s) portava el text **«jung 2025 LEIRE DÍEZ»** (que és del wott 12, score 1,0) i el wott orfe «maig 2026 José Luis» — el ZAPATERO — s'hi va emparellar amb **score 0,556** (només «mes + any» s'assemblen per Levenshtein). El seu interval real (`i11`, tIn 143,26 s = **relIn 121,5 s**, la referència «2:00:21» de l'usuari) era l'únic que s'havia quedat **sense wott perquè l'OCR no en va treure text** (tot i tenir la cobertura MÉS alta, 27,36 %) | `assignIntervals`: un match FEBLE (score < `ocrWeak` = 0,7) amb un text que ja és (millor) d'un altre wott es **REBUTJA** |
| …i el wott quedava orfe | El fallback l'hauria encadenat al final de l'ítem (⛓️) | `resolveOrphans` (nova): els wott orfes s'emparellen **per ordre** amb l'interval orfe que cau dins de la **banda** dels seus veïns (l'interval del wott anterior assignat i el del posterior). Es descarten els **trossos** contigus (`tIn == tOut`, com `i4` amb `i3`) i les **re-emissions** (text idèntic al d'un interval ja assignat, com `i10` amb `i9`) |
| «octubre 2024 ÁLVARO» i «octubre 2024 CARLOS» intercanviats | El desempat era «el més proper a la diagonal» (`|i−w|`), que assumeix que l'ordre dels wott és el de l'aire. En aquest muntatge l'ordre de l'aire és una **ROTACIÓ** de l'ordre dels wott | El desempat passa a ser **wott més antic i, després, interval més antic** (mateix criteri que `pickWott`, que agafa el primer índex amb la millor puntuació) |

⚠️ Les dues targetes «octubre 2024» només es podien distingir pel NOM (ÁLVARO/CARLOS) i el
token del nom està contaminat amb l'ID del mèdia (`alvaro 00625920`), així que el match és
1,0 per a totes dues (token «octubre 2024»): el desempat és el que decideix.

Resultat amb les dades REALS (validat a `fp_titolet_assign.html`, 17/17): els 11
emparellaments bons es mantenen, el ZAPATERO va a `i11` (**relIn 121,5 s**) i `i10`/`i4`
queden sense wott (re-emissió i tros).

### 11) Refinament de l'entrada (5a passada)

L'escaneig general va a `scanFps` = 2 (pas 0,5 s = **12 frames**) i el primer mostreig ON
sempre cau DESPRÉS de l'entrada real → la targeta hi anava «uns frames tard» (fins a 12).
Per cada interval USAT es fa un **escaneig FI** (`refineEntry`, `refineFps` = 8 → pas
0,125 s) en una finestra petita al voltant de `tIn`, i l'entrada queda a ±3 frames
(mesurat a l'arnés `fp_titolet_forward.html`: entrada real 190,4 s → general 191 s,
refinada **190,44 s**). Un cop refinat, l'«imant al tall» decideix amb dades bones.

### 12) Caché del pla: recàlcul sense re-rastreig (5a passada)

El JSON desat porta els **intervals + el text OCR de cada interval** i la versió
d'algorisme (`algo`). Si el pla és d'una versió anterior, `planForItem` el **RECALCULA**
amb les dades crues (assignació + orfes + refinament) → un canvi d'algorisme o de llindars
(`ocrWeak`, `refineFps`) s'aplica sense tornar a escanejar (350 s → 25 s).

### Validació (5a passada)

| Prova | Resultat |
|---|---|
| `C:\temp\fp\fp_titolet_place.html` (workflow REAL + 12 targetes reals) | **27/27 OK** |
| `C:\temp\fp\fp_titolet_assign.html` (NOU: mòdul real + dades REALS del pla desat) | **17/17 OK** |
| `C:\temp\fp\fp_titolet_forward.html` (escaneig endavant + refinament, secció F) | **39/39 OK** |
| `C:\temp\fp\fp_titolet_fix.html` (`.raw` real, Base64 + `_waitForPath`) | **19/19 OK** |
| `C:\temp\fp\fp_titolet_test.html` (lògica pura: màscara, grups, OCR, pla) | **25/25 OK** |
| `bin\check_js_v8.ps1` | 58/58 OK (exit 0) |
| `bin\check_dead.ps1` | 0 orfes (exit 0) |

⚠️ Els arneses antics carreguen una CÒPIA del mòdul (`C:\temp\fp\titolet_module.js`): quan es
toca `js/logic/17_TitoletDetect_Logic.js` cal tornar-la a copiar o l'arnés prova codi VELL.

### ⚠️ Pendent de provar a Premiere (5a passada)

Repetir COL·LOCAR → Resto a l'ítem 16 de TNM V1 i comprovar al log:

1. `♻️ [titolet] Resto: pla de la CACHÉ RECALCULAT amb l'algorisme v2 …` (no ha de tornar a
   rastrejar) i les línies `🔬 … entrada REFINADA a X s`.
2. Les 12 línies `🧲 … → X s [imant al tall …|lloc real] viu Y s [+ congelat Z s]` amb els
   instants **≈ 5,9 · 22,4·imant · 30,6·imant · 41 · 53,4·imant · 69,8·imant · 87 · 93,9·imant
   · 108 · 121,2 (ZAPATERO) · 138,8·imant · 142,6·imant** (els que tenen imant van EXACTAMENT
   al tall; el refinament pot moure'ls uns frames).
3. `🧊 … (span X s: viu Y s + congelat Z s)` amb la **part viva sempre igual** (el clip sencer)
   i congelat només a les 2 que ho necessiten.

> ✅ Aquest pendent de la 5a passada queda **superat** per les passades 6a i 7a (vegeu més avall): el
> comportament «part viva = clip sencer» es va mantenir i validar, i la 6a hi va afegir el retall de 5 frames.
> El pendent VIU avui és el de **#147/#148** (§ «Artefactes en viu») i el test de la 7a passada.

---

## 6a passada (2026-10-06/07) · BUG #143: la targeta durava 5 frames de més

Petició d'usuari: «es col·loquen amb 5 frames més del que dura realment; treu-los i entra el congelat
5 frames abans perquè no hi hagi un buit». `_placeTitoletChain` retalla `TRIM = cardTrimFrames / fps`
(**5 frames = 0,2 s**) del final de la durada TOTAL **i** de la part VIVA → el congelat entra aquests
5 frames abans i la seva llargada no canvia (l'enllaç queda sense buit). Clau nova
`titolet.cardTrimFrames = 5` (0 = comportament antic). ✅ **VALIDAT a Premiere** per l'usuari (2026-10-07),
commit `7f5e0d3`. Detall a `.roo/progress/2026-10-06.md` §6.

## 7a passada (2026-10-08) · ROI PER ETIQUETA + TC DEL NOM

**Problema mesurat** (TNM V3, passada real de les 13:39): els **6 PREGUNTA** d'un ítem → **0 intervals**.
El rètol d'aquella família **no viu a la banda mesurada del TITOLET** (`roiY 0,60-0,85`) i el detector
només tenia **UNA** zona de rastreig per a totes les etiquetes.
Solució (JS pur, zero JSX nou):

### a) `titolet.roiPerRole` + `titolet.roiDefault`

- `roiPerRole[ETIQUETA]` = recepta pròpia de cada etiqueta **mesurada**. Avui només `'TITOLET'`:
  `{ roiX: null, roiY: [0.60, 0.85], edgeAxes: 'y' }` (mesurat el 2026-10-06 amb `roi_real.raw`: xinxeta
  taronja a la banda baixa de l'esquerra ancorada a `x=0` → la vora X no pot desqualificar).
- `roiDefault` = **comodí** de les etiquetes encara no mesurades (26 de 27):
  `roiX [0, 0.5]` · `roiY [0.10, 0.98]` · `edgeAxes 'none'` · `minCov 1.2` · `maxCov 90` · graella **96×96**.
  És la meitat esquerra del frame (on apunta ja la finestra d'OCR) i **engloba** la banda del TITOLET.
  ⚠️ Si s'eixampla la zona, la mateixa xinxeta **baixa de cobertura** (l'àrea creix) i la vora perd valor de
  filtre → per això el comodí porta els seus propis llindars (una xinxeta del 17-27 % de la banda aquí fa
  ~9-14 %) i la graella de mostreig s'adapta (`roiW`/`roiH`: amb 160×45 el `crop`+`scale` l'aixafaria 21× i
  el color es desdibuixaria amb el fons).
- `_recipeOf(cfg, rol)` → `roiPerRole[rol]` → `roiDefault` → valors base, i informa de la font
  (`recepta <rol>` / `comodí` / `base`) per al log. Claus vàlides (`ROI_KEYS`): `roiX roiY edgeAxes color
  tol minCov maxCov minEdgeFrac ocrRoiX roiW roiH` (les absents manen del nivell base).

### b) Un rastreig PER GRUP de receptes

`recipeForRoles(cfg, roles)` deduplica les receptes per signatura; `roleGroups(cfg, roles)` agrupa els wotts
de cada recepta; `planForItem` fa **una passada d'escaneig per recepta** i `ivGroups` restringeix
l'assignació (**cap parella interval↔wott pot creuar grups**). Un ítem **només TITOLET** fa 1 sola passada
(= comportament idèntic a sempre). El comodí ampli **també veu** els intervals del grup TITOLET.
`_groupAllow` / `_sameGroup` són les guardes de l'assignació.

### c) TC DEL NOM (`tcFromName`)

ABANS de rastrejar el MP4, `_titoletTcFromName(list, cfg)` mira si el nom del wott ja porta l'instant
d'emissió (`13_Parse.meta` → `parts[4]`, `MM.SS`/`HH.MM`). És **conservador**: només l'accepta si ≥
`tcMinSec` (0,5 s), cau dins de l'ítem i **no és el mateix valor a tots els wott** (als rètols d'aquesta
família el camp sol ser `00.00`, inservible). Si cap wott no en té, es detecta com sempre. Els buits de la
detecció (`found=false`) s'omplen amb el TC del nom (`_titoletCardsFromTc`) i **mai** se sobreescriu una
detecció d'OCR confirmat: **el vídeo mana**. Logs: `⏱️ … sense detecció: N/M targeta(es) col·locada(es) pel
TC del nom` i `⏱️ … TC del nom: N targeta(es) que la detecció NO va veure → col·locades pel TC del nom`.
Es pot desactivar amb `titolet.tcFromName = false`.

### d) Validació (7a passada)

| Prova | Resultat |
|---|---|
| `C:\temp\fp\test_role_roi.ps1` (fetch del mòdul REAL + config REAL; pipeline amb vídeo FALS) | **ALL OK** |
| `T10b` — amb la recepta del TITOLET (la d'abans), els 6 PREGUNTA → | **0/6** (aquesta era la fallada) |
| `T11` — ítem MIXT: 2 receptes, 4/4 wotts, cap parella interval↔wott creua grups | OK |
| `T12` — ítem només TITOLET: 1 sola recepta, recepta INTACTA (`x null · 160×45 · vores y`) | OK |
| `T13` — rol desconegut → comodí que engoleix la banda del TITOLET; rol buit ≠ TITOLET (2 grups) | OK |

⚠️ **Pendent de test a Premiere** (cache-bust **`17_TitoletDetect_Logic.js?v=2`** — fins avui era `?v=1` tot i
haver canviat +313 línies!): mirar `🔎 [titolet] … N intervals · M tram(s)`, `🧲 … [recepta X | comodí]` i
`🎯 … detecció: X/Y detectats`.

---

## Artefactes en viu (2026-10-08) · #147 i #148

### #147 · El congelat portava el **vídeo de V1** (PNG de 524 KB en lloc de ~35 KB)

- **Causa arrel**: `_freezeTemaTitol` (a `flow_chyrons.js`) insereix el wott en una zona temporal LLIURE
  (`TEMP_TC`) i captura allà. Aquell `Clips.insert` **podia fallar i tornar `ERR: …` i el codi continuava
  igualment**: (1) el nom real del cas portava un `%` literal («…Crèdits al **0%** d'int…») i el JSX fa
  `decodeURIComponent(itemName)` (`jsx/modules/6_Clips.jsx`) → **«Bad or invalid URI»** → inserció fallida
  i ignorada; (2) sense clip temporal, el TC de captura `TEMP_TC + (tmpDur − REV_FRAME)` cau damunt del
  **PROGRAMA (V1)** → el PNG surt amb el vídeo de V1 i l'esborrat posterior peta
  (`ERR_CLIP_NOT_FOUND_AT_119.12`).
- **Fix (JS pur, zero JSX nou)**: `js/core/utils.js` → helper **`jsxName(name)`** que escapa el `%` literal
  a `%25` abans de creuar el pont (usat al freeze i a la col·locació: `escapedWott` / `escapedName`).
  `_freezeTemaTitol`: guarda `isErrRes` a cada `Clips.insert`; la inserció temporal es **reintenta 3×** i es
  **VERIFICA** amb `getClipsLogic().getTrackClips()` (cal un clip dins de ±0,5 s de `TEMP_TC` → `tmpClip`);
  **sense clip temporal verificat NO es captura res** (es col·loca només el clip viu, mai un congelat FALS);
  `tmpDur` derivat del final REAL del clip verificat (`tmpClip.end`, limitat a `CUT_OFFSET`); la inserció
  final d'animació també comprova `ERR` (retorna `{success:false}`).

### #148 · La mateixa firma col·locada a V7 **i** V8 al mateix tc

- **Causa arrel**: dues instàncies del mateix rètol amb **dos wottId** i només una tilde de diferència
  (`…_630083_Firma_Ivan Gutiérrez.00630153.mov` / `…_630175_Firma_Iván Gutiérrez.00630176.mov`).
  `_regenKey`/`_regenSeq` només reconeixen re-generacions del **mateix** wottId → no es fusionaven; en trobar
  la pista ocupada, la segona anava a una ALTRA capa.
- **Fix (JS pur)**: `_sameChyronKey` (identitat d'un rètol per a la SEVA posició: `_regenKey` **sense** el
  wottId + `_burnedGrafNorm` → ignora generació, wottId, accents, caixa i separadors) i `_dedupeSameChyron`
  (deixa **un rètol per posició**; mana la versió més NOVA i, si empaten, el wottId més alt). Cablejat al
  **bucle comú de fases** just després de `_dedupeRegenerations` (val per a Conduct/Titol/Lloc/Nom/Resto).
  La família **de grafisme cremat es SALTA** (el `tc` del seu nom no és la seva posició: la CADENA en
  col·loca còpies a l'instant detectat) i els noms **buits o no parsejables NO es dedueixen**.

### Validació headless (#147/#148)

`C:/temp/fp/test_dedupe.html` + `run_test_dedupe.ps1` (fetch dels fitxers REALS del repo, funcions extretes
amb regex i executades al motor V8 del CEP): **9/9 OK** — `jsxName` (`0%` → `0%25` i `decodeURIComponent`
torna el nom original byte a byte) · els dos noms reals de la firma donen la mateixa clau i guanya la 630175
(l'ordre invers dona el mateix) · rètols diferents que comparteixen posició NO es fusionen · PREGUNTA
intacta · noms buits intactes · regeneracions → 1 amb la generació nova.

⚠️ **Pendent**: passada real a Premiere (panell recarregat amb `utils v25` + `flow_chyrons v69`) → PNG del
congelat **~35 KB**, cap firma duplicada a V7/V8 i cap sobre-deduplicació de rètols legítims.

---

## 🔜 Sessió següent (agenda acordada 2026-10-08)

1. **Millorar la detecció dels CARTELLS** i de la resta d'etiquetes no mesurades: avui 26 de 27 etiquetes
   comparteixen el comodí `roiDefault` i la **màscara de color única** `#F25F13 ±25`. Camí: mesurar amb
   material real per etiqueta → omplir `roiPerRole` (color/tol/ROI/graella/llindars), i si cal suportar
   **diverses mostres de color** o detecció sense color (canvi de contingut) per als rètols d'imatge.
2. **Col·locar els NO detectats amb més criteri**: `clip complet + un congelat` per poder-lo deixar llarg,
   tots **al final** de l'ítem com ara (branca `else` de `_placeTitoletChain`), decidint amb el log al davant
   el TRIM, el `GAP` i si el congelat pot desbordar el final de l'ítem.

Plan detallat, fitxers implicats, decisions obertes i proves disponibles:
**`plans/HANDOFF_2026-10-08_TITOLETS.md`** §7.

---

## 8a passada (2026-10-09) · MULTI-COLOR per etiqueta (`facets`)

### a) El gris clar de referència: **#DCDCDC** (mesurat al vídeo)

Petició d'usuari: «en el clip del V2 (TNM MIGDIA 2026-10-07), a 1 min 7 s, tens un gris a la dreta que és
el gris clar de referència; obre el clip i mesura'l per fer servir el valor a la detecció del gris clar».

Mesura sobre `…\2026_10_07\V2\TNM_V2_CLIP.mp4` (1920×1080 · 25 fps · 236,76 s), frame a **t = 67,0 s**
(`C:\temp\fp\frames\v2_67,0.png`, informes `C:\temp\fp\v2_gray.txt` / `v2_gray2.txt` / `v2_gray3.txt`):

| Zona mesurada | Resultat |
|---|---|
| `x[1420..1900) y[60..1020)` (460.800 px) | **#DCDCDC al 100,00 %** · `unics=1` (placa plana) |
| `x[1600..1880) y[200..880)` (190.400 px) | **#DCDCDC al 100 %** |
| Estabilitat t = 66,5 / 67 / 67,5 / 68 | **#DCDCDC** sempre (53,7–54,8 % del frame) |
| Paper del document (contrast) | #FFFFFF (33,2 %) |
| Franja d'identitat de l'esquerra `x[0..109] y[0..1079]` | #FF6C12 (5,7 %) |

- Coincideix amb el PNG de grafismes (**#DBDADA**) → **Δ ≤ 2 per canal: `tol ±25` cobreix els dos**.
- En aquest clip **no hi ha cap grafisme** (és un pla de document), i això el fa ideal com a mesura de
  **terra de fons**: el gris de referència hi surt a **5,1 %** (capsa LLISTA), **8,6 %** (RANQUING),
  **5,3 %** (DADA-ITEM) i **13,5 %** (ROI comodí) — aquests són els llindars a superar per no fer falsos positius.
- ⚠️ La franja taronja #FF6C12 **entra dins de** `#F35E13 ±25` (ΔR 12 · ΔG 14 · ΔB 1) però, com que
  omple la ROI de dalt a baix (`y1 = 1,000`), **la guarda `edgeAxes:'y'` la descarta**.

### b) Mecanisme: `facets` (un color + una zona + uns llindars per faceta)

Una recepta de `titolet.roiPerRole` pot declarar `facets` (llista). Claus d'una faceta:
`color` · `tol` (si falta, els de la recepta) · **`roiX`/`roiY` propis** (fracció de frame; si falten, la
zona de la recepta) · `minCov` · `maxCov` · `edgeAxes` · `minEdgeFrac`.

- **Un frame és ON si ALGUNA faceta hi passa**, a la SEVA zona i amb els SEUS llindars (`_frameSummary`).
- **Una sola passada d'ffmpeg**: s'extreu el rectangle que ENGLOBA totes les zones (hull, ho calcula
  `_recipeOf`) i cada color només compta dins la seva (`_facetRect` → cel·les de la graella).
- La cobertura de cada faceta es mesura **sobre l'àrea de la SEVA zona** → els llindars es llegeixen igual
  que en una recepta d'un sol color (les xifres mesurades dels PNG segueixen servint).
- `ROI_KEYS` incorpora `facets` → entra a la **clau de grup** de rastreig i a la **clau de caché del pla**
  (canviar facetes invalida el pla) + `ALGO = 4`.
- **Sense `facets` tot queda EXACTAMENT com abans** (color únic + llindars de la recepta).

### c) 🎨 Què buscar a cada tipus (colors + zona)

| Tipus | Zona (fracció de frame) | Colors a buscar | Estat |
|---|---|---|---|
| TITOLET | `x 0–0,48` · `y 0,61–0,83` (BAIX) | taronja #F35E13 | ✅ mesurat (recepta actual) |
| TITOLET GRAN | `x 0–0,72` · `y 0,21–0,43` (DALT) / `0,37–0,59` (MIG) | taronja | ⏳ pendent (avui cau al comodí) |
| PREGUNTA (I / D) | `x 0–0,443` / `0,555–1` · `y 0,402–0,61` | taronja (barra) | ⏳ pendent |
| CARTELL | `x 0,038–0,286` · `y 0,213–0,884` | taronja (placa sencera) → `roiY [0.15,0.95]` | ⏳ pendent |
| LLISTA / LLISTA-DADES | `x 0–0,41` · `y 0,24–0,78` | **taronja** (fila activa, `minCov 2,5`) **+ gris clar #DCDCDC** (placa, `minCov 30` · `maxCov 97` · vores `none`) | ✅ **implementat** (llindars del gris provisionals) |
| RANQUING | `x 0–0,47` · `y 0,31–0,70` | taronja + gris clar #DCDCDC (idèntic criteri) | ✅ implementat |
| DADA-ITEM | `x 0–0,35` · `y 0,36–0,74` | taronja + gris clar #DCDCDC | ✅ implementat |
| DADA_COMPARADA | `x 0–0,546` · `y 0,332–0,728` | taronja (3,89 % frame) + gris clar (placa) | ⏳ pendent |
| DADA-GRAN / -DIVISA | `x 0–0,260` · `y 0,337–0,669` | taronja (0,84 %) + gris clar | ⏳ pendent |
| DADA-DIFERENCIAL (I/E/base) | `x 0–0,523` / `0,454–1` / `0–0,247` · `y 0,316–0,773` | taronja (1,5 / 1,8 / **0,50 %**) | ⏳ pendent (el base és molt fluix) |
| DESTACAT (I/E) | `x 0–0,304` / `0,686–1` · `y 0,258–0,681` | taronja | ⏳ pendent |
| GRAFICA-BARRES | `x 0–0,354` · `y 0,170–0,879` | taronja (barres, 6,64 %) | ⏳ pendent |
| CRONOLOGIA / -TITOLS | `x 0,046–0,143` / `–0,252` · `y 0,355–0,682` | taronja (1,2 %) | ⏳ pendent |
| NOTA (I/D) | `x 0–0,331` / `0,664–0,957` · `y 0,634–0,831` | taronja (barra de 12 px, 0,33 %) | ⏳ pendent (banda pròpia) |
| CLASSI-* / CLASSIFICACIO / PROGRAMACIO | — | — | ⏳ sense mesurar |
| CIS_CEO / CIS_CEO_COMPARADA | `x 0–0,298` · `y 0,231–0,508` | **sense taronja**: #F1C800 · #00D4B6 · #450001 = **logos de partit (varien)** | 🛑 sense firma de color |
| IMATGE-CAPTURA | `x 0,038–0,353` · `y 0,191–0,884` | **sense taronja** (fotografia) | 🛑 sense firma de color |

Pendents per tancar la taula: **gris fosc #393939** (cos de files) a les taules, la zona interior exacta de
cada placa, i els tipus sense mesurar (CLASSI-*, PROGRAMACIO). Cal **una mostra amb LLISTA/RANQUING/DADA-ITEM**
per fixar el `minCov` del gris (avui provisional, marge ≥3,5× sobre el terra de fons mesurat).

### d) Validació (8a passada)

| Prova | Resultat |
|---|---|
| `bin/check_js_v8.ps1` (motor V8) | **57 fitxers · OK 57 · FAIL 0** (exit 0) |
| `bin/check_dead.ps1` | **0 orfes** (exit 0) |
| `C:\temp\fp\facet_test.html` + `run_facet_test.ps1` (motor REAL, frames sintètics rgb24) | **11/11 OK** |

Els 11 casos: color únic intacte (`on` undefined, cov 8,73 %) · la faceta taronja fa ON el frame · **placa
grisa al 91 % amb ZERO taronja → ON** (aquest és el cas nou) · gris **pla al 100 % → descartat** per
`maxCov 97` (guarda de fons) · **zona pròpia de la faceta**: gris fora de la seva zona = 0 % i no dispara ·
`_facetRect` [0,0.5] → cel·les 0..50 · la ROI de la recepta **engloba** les zones de les facetes (hull) ·
facetes diferents → **2 grups** de rastreig · `groupIntervals` fa cas del veredicte `on` · les facetes
**canvien la clau de caché** · `_facetLog` informa color, zona i llindars.

⚠️ **Pendent de test a Premiere** (panell RECARREGAT: **`11_Configuracio.js?v=31`** ·
**`17_TitoletDetect_Logic.js?v=3`**): en un ítem amb LLISTA/RANQUING/DADA-ITEM, mirar al log
`🎨 [titolet] … colors N: #F35E13@x… (2.5-45%, vores y) + #DCDCDC@x… (30-97%, vores none)` i que els
intervals surtin **sense falsos positius** en plans de fons gris (document, plató).
