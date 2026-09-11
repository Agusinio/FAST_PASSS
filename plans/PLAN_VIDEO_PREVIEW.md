## Actualització (2026-09-09): PLAY LOCAL desacoblat + caché de vídeo

**Decisió**: el botó **▶ del editor SRT reprodueix el clip a 1× de forma autònoma**, sense
tocar Premiere (ni `qe.play()` ni `Timeline.set()` durant la reproducció).

Motiu: els subtítols viuen en **temps de MEDIA del mateix clip** que mostra el `<video>`,
per tant el moviment natiu del vídeo **ja és** la sincronia correcta. Anclar el visor al
CTI de Premiere obligava a seeks i interpolacions a cada poll → micro-tirons constants.

- Al ▶: `_playheadLocal = true`; el tick de 100 ms fa `_playheadSec = v.currentTime` i
  pinta canvas + overlay. **Zero seeks, zero polls del CTI** (`_pollTick` fa return).
- Límit de parada: una mica després de l'últim subtítol i mai més enllà de `v.duration`.
- Al ⏸ (o en clicar al canvas): s'atura el vídeo i es fa **una sola** `Timeline.set()` per
  alinear el cabezal de Premiere; a partir d'aquí torna el mode seguidor (scrub).
- El mode seguidor (pausa/scrub) es manté: seeks al media que correspon al CTI.

**Caché de vídeo**: `_ensureLocalVideo` manté una còpia local reutilitzable per peça a
`C:/temp/fastpass_video_<tag>.mp4` (+ sidecar `.json` amb `size`/`mtime` de l'origen).
Es re-copia només si l'origen canvia. Reproduir en local fa els seeks/scrub instantanis
(sobre la UNC, cada seek re-llegeix de xarxa).


# PLAN: Visor de vídeo + subtítols a l'editor SRT (opció A, sense ffmpeg)

## Objectiu
Mostrar, dins el panell (secció SUBTÍTOLS), el **clip original en moviment** amb els
subtítols superposats, **sincronitzat amb la posició del cabezal** del timeline de
Premiere. Sense botó: en fer **CARREGAR** ja es mostra el vídeo al fotograma del
cabezal actual, i segueix el cabezal en play/pausa/scrubbing.

## Decisió d'arquitectura
- Usar l'element natiu **`<video>`** de Chromium (CEP) com a **visor de fotograma**,
  controlat per `currentTime`. **No** fem `video.play()` propi: el "moviment" ve del
  cabezal (que ja segueix el montatge amb els seus talls i velocitats r>1).
  - En cada tick (`requestAnimationFrame` o l'interval de 66 ms ja existent) fem
    `video.currentTime = mediaPh` (el temps de MEDIA del clip corresponent al CTI).
  - Així el fotograma mostrat sempre és el que toca, independentment de si el montatge
    va accelerat. És el que dóna sincronia real amb el timeline sense re-renderitzar.
- **Sense ffmpeg**: es reprodueix el clip original mp4 que ja hi ha al directori del
  projecte (H.264/AAC, suportat per Chromium).

## On s'obté el path del clip (ja disponible al codi)
- A `loadSrt` ja tenim:
  - `projFolder = await callJSX("Context.folder()")` (carpeta del projecte).
  - `binPath` → `_waveformMediaTag` (ex: `TNV_V2_CLIP`), derivat del `AUDIO_REF.bin`.
- El MP4 es: `projFolder + "\\" + this._waveformMediaTag + ".mp4"`.
- Conversió a URL per al `<video>`:
  - `file://` + ruta UNC: `"file:////" + path.replace(/\\/g, "/")` (4 barres inicials).
  - Si el `<video>` no pot carregar (CORS/codec), **fallback**: copiar el MP4 a
    `C:\temp\fastpass_media.mp4` amb `cep.fs` i usar `file:///C:/temp/...`.

## Layout proposat (index.html, secció SUBTÍTOLS)
- Convertir el contenidor actual en un **flex de 2 columnes**:
  - **Columna esquerra**: botons (CARREGAR/IN/OUT/AJUSTAR/MODE/EXPORTAR/PLAY/zoom) +
    el timeline (`#srtEditorContainer` amb el `canvas`), com ara.
  - **Columna dreta (amplada ~40%)**: zona de vídeo vertical (proporció 9:16):
    ```html
    <div id="srtVideoWrap" style="position:relative; height:100%; background:#000;">
        <video id="srtVideo" playsinline muted style="height:100%; width:100%; object-fit:contain;"></video>
        <div id="srtVideoSubs" style="position:absolute; left:0; right:0; bottom:8%; text-align:center;
             font:bold clamp(14px,3vw,26px)/1.3 sans-serif; color:#fff; text-shadow:0 1px 3px #000;
             padding:0 6%; pointer-events:none;"></div>
    </div>
    ```
- `muted` per evitar restar l'àudio de Premiere (el so el dona el timeline). `playsinline`
  per evitar fullscreen en Chromium.

## Sincronització (reutilitzar el que ja funciona)
1. A `loadSrt`, després de carregar el bin/segments:
   - Resoldre `mediaPath` del clip i posar-lo al `<video>`.
   - `video.currentTime = this._playheadSec` (posició MEDIA del cabezal actual).
2. Reutilitzar el **seguiment continu del cabezal** (interval de 66 ms ja existent a
   `_startPolling`): a cada tick, a més d'actualitzar el playhead del canvas, fer:
   ```js
   var v = document.getElementById('srtVideo');
   if (v && v.readyState >= 2) {
       var d = Math.abs(v.currentTime - self._playheadSec);
       if (d > 0.12) { v.currentTime = self._playheadSec; } // correcció puntual (evita seek constant)
   }
   ```
   - Llindar `0.12 s` per no fer `seek` a cada frame (el seek d'MP4 és car) i deixar que
     el vídeo "corri" sol entre correccions.
3. **Pausa** (CTI parat): deixar de corregir; el fotograma queda fix.
4. **Scrubbing**: com que `currentTime` es corregeix al llindar, segueix l'arrossegament.

## Overlay de subtítols
- Reutilitzar `_updatePreview(sec)`: a més d'escriure a `#srtPreview`, escriure el mateix
  text a `#srtVideoSubs` (el caption actiu en MEDIA).
- El text s'actualitza amb el mateix ritme que el playhead.

## Fases d'implementació (quan toqui)
1. **HTML/CSS**: afegir la columna dreta amb `<video>` + overlay a la secció SUBTÍTOLS;
   reestructurar el contenidor a flex. (index.html, style.css)
2. **Càrrega**: a `loadSrt`, resoldre `mediaPath` del clip (del bin/tag), construir
   `file://` URL, assignar-la al `<video>`, i fer el primer seek al cabezal. (srt_editor.js)
3. **Sincronització contínua**: afegir la correcció de `currentTime` al tick del playhead.
   (srt_editor.js)
4. **Overlay**: escriure el caption actiu a `#srtVideoSubs`. (srt_editor.js)
5. **Fallback de ruta**: si `video.error` (codec/xarxa), copiar el MP4 a `C:\temp` i
   recarregar. (srt_editor.js)
6. **Prova**: CARREGAR → vídeo al cabezal; play/espai → segueix; pausa → es queda; IN/OUT/
   marcadors no trenquen la sincronia.

## Riscos i mitigacions
| Risc | Mitigació |
|---|---|
| `file://` a UNC no carrega (seguretat CEP) | Copiar MP4 a `C:\temp` amb `cep.fs` i servir-lo local |
| Codec no suportat (algun MP4 `-c copy` amb àudio AAC rar) | Recodificar només si cal (posteriorment, amb ffmpeg) |
| `seek` freqüent lent (MP4 GOP llarg) | Rate sempre 1x (cadència nativa sense micro-tirons); re-anclatge només amb drift >0,6 s i histèresi de 250 ms. En reproducció estable el rellotge mostrat és el del propi `<video>` (es fa servir `v.currentTime`), no un servo de seeks/rate |
| Velocitat del montatge (r>1) no coincideix amb reproducció nativa | Es resol per disseny: el vídeo és un "visor" conduït pel cabezal (seek), no es reprodueix a 1× |
| Àudio doble (vídeo + Premiere) | `<video muted>` |
| Layout estret del panell | Columna dreta ~40%, object-fit:contain |

## Acceptació (Definition of Done)
- En CARREGAR, el vídeo mostra el fotograma del cabezal actual amb el subtítol actiu a sobre.
- En play (espai o botó), el vídeo avança sincronitzat amb el cabezal i el so de Premiere.
- En pausa es queda quiet; en scrubbing segueix.
- Sense ffmpeg implicat.
