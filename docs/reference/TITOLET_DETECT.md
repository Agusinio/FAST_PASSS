# TITOLET — Detecció automàtica del rètol cremat

> v1.1.0 · 2026-10-06 (4a passada) · `titolet.*` a `Config` · `bin/ocr.ps1` · `js/logic/17_TitoletDetect_Logic.js` · `15_FFmpeg_Logic.js` · `flow_chyrons.js`

## Què fa

Mesura al MP4 `cleanFeed` (el senyal net amb els rètols cremats) **quan entra i quant dura** cada
TITOLET, i en llegeix el text per OCR per saber **quin wott** és. Amb això la cadena TITOLET deixa
d'endevinar el congelat: si el rètol va estar a l'aire menys que la targeta, la targeta es **retalla**.

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
