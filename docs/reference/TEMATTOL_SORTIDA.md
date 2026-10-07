# TEMA-TÍTOL · PEÇA DE SORTIDA (desaparició)

> Referència del mecanisme de SORTIDA/transicions del Tema-Títol · 2026-10-07 · feature #144

## Idea

El Wott del **Tema-Títol** porta al FINAL del seu mèdia la seva pròpia animació de sortida
(«desaparició del títol petit»), al voltant de **10:00→10:10** (10,00 s → 10,40 s a 25 fps).
És exactament el que abans es fabricava **invertint el titulillo petit amb ffmpeg**
(`ffmpeg -vf reverse` → `_REV.mov`). Aquella inversió era fràgil (ffmpeg + import al bin CHY +
ffprobe de la durada) i **redundant**.

Ara la SORTINT és un **retall del propi Tema-Títol gran** (l'ítem JA és al projecte): no cal
ffmpeg, no cal importar res i no depèn del bin CHY.

## Config (`js/core/11_Configuracio.js`)

```js
const TEMATTOL_EXIT_DEFAULTS = {
    enabled: true,           // false → comportament antic (revers ffmpeg del titulillo)
    atSec: 10.0,             // IN del mèdia on arrenca la desaparició (10:00)
    durSec: 0.40,            // durada de la peça (10:10 − 10:00 = 10 frames @25fps)
    useReverseFallback: true // xarxa: si la peça no es pot col·locar → revers ffmpeg
};
```

Accessible en calent: `FASTPASS_UI.Config.get().temaTitolExit` (o `Config.get().temaTitolExit.atSec = 10.4`).

## Com es col·loca (`flow_chyrons.js`)

`Chyrons._insertTemaTitolExit(name, track, startSec, endSec, atSec)`:

1. `Clips.insertWithBounds(name, track, TEMP, atSec, atSec+dur)` en un **TC lliure llunyà**
   (`_v6FreeTC`: 600/610/620/630 o la cua) → l'`overwriteClip` intern hi és inofensiu, i de pas
   fixa `inPoint`/`outPoint` del clip.
2. Localitzar el clip temporal pel seu `start` (`getTrackClips`).
3. `Clips.moveToRange(track, idx, startSec, endSec)` → reassigna start/end **sense**
   `overwriteClip` → **no trepitja cap clip veí** (ni el Tema-Títol gran).

És la mateixa tècnica NO destructiva que el congelat del titulillo (`_freezeTitulilloStill`).

## On s'usa

- `_placeTemaTitolTransicions` — CasB: `[titulillo ENTRANT] + [congelat] + [desaparició]` just
  abans del primer Tema-Títol gran; amb **més d'un** gran, una desaparició abans de cadascun.
- `_fillTitulilloGaps` — cobertura d'un buit: mateixa seqüència fins al gran.

La durada de la peça és `snapDur(durSec)` (alineada a la rejilla de frames) i la seva posició
`ceil((target − durSec)/frame)·frame → target` (acaba EXACTAMENT on entra el gran).

## Log esperat

```
📋 [Titol·Petit] Pla: 3 peça(es) … sortida 0.40s (desaparició del gran, mèdia 10.00s) →
   entrant@0.40→1.44s | congelat@1.44→4.40s | exit@4.40→4.80s
   🔴 [Titol·Sortida] desaparició del gran → V6 @ 4.40s→4.80s (mèdia 10.00→10.40s) [OK:start=…,end=…]
```

Si surt `⚠️ [Titol·Sortida] insertWithBounds ha fallat (…)` o `moveToRange ha fallat`,
s'activa la xarxa (`useReverseFallback`) i es veu `… · revers ffmpeg` a la línia de col·locació.

## Pendent relacionat

- La peça depèn que el Wott del gran estigui **al projecte** (ho està: `placeChyronTitol` el
  col·loca). Si l'ítem no es trobés per nom, `insertWithBounds` retorna `ERR_ITEM_NOT_FOUND`.
- Les **durades dels Wott** segueixen sent per ESTIMACIÓ (`size / 43,5 MB/s`) quan el DOM no en
  dóna i no hi ha bitrate calibrat → afecta quin Tema-Títol es tria com a "gran" vs "titulillo".
