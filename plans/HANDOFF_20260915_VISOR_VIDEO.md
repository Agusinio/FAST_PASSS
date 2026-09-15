# HANDOFF — 2026-09-15 · Visor de vídeo de la secció SUBTÍTOLS

**Estado**: sesión cerrada con commit+push. Queda **un problema residual** en el visor
(mejoró mucho, pero no es perfecto) — a revisar mañana con el usuario.

---

## 🟢 Lo que quedó arreglado hoy (validado por el usuario en Premiere)

1. **Servo de sincronia (el bug grande)**: `_pollTick` clasificaba el cabezal por el Δ
   **absoluto** del CTI (`Δ>0,5 s ⇒ salt`) ⇒ con polls lentos (0,6-3 s) marcaba "salt" ⇒
   `_timelineRunning=false` ⇒ `_syncVideo` hacía `v.pause()` ⇒ **imagen congelada**
   ("no es refresca"). Ahora `_ctiState(deltaSec, dtRealSec)` clasifica por **velocidad**
   (`<0,35× stop`, `>2,5× salt`, resto play) y `_syncVideo` usa
   `run = !!(this._isPlaying || this._timelineRunning)` (la pausa sólo la manda el usuario).
   Medido después: `vel=1.00x`, `driftV=0.00` sostenidos.
2. **Guard `_pollBusy`** en los 4 intervalos de `_pollTick` (evita solapar `Timeline.get()`).
3. **Franja negra inferior al mover el cabezal**: `main.js → sizeVideoToFit` anulaba el visor
   (`width:10px; height:0`) para medir y lo restauraba ⇒ reescalado de la textura del
   `<video>` ⇒ media imagen negra. Ahora mide con el visor **fuera del flujo**
   (`position:absolute` + restauración síncrona) **sin tocar su tamaño** y sólo reescribe
   si cambia el ancho calculado.
4. **Caché de CSS**: `style.css` se servía con `?v=46` desde hacía muchas sesiones ⇒ los
   cambios de CSS **no se aplicaban**. Ahora `?v=47` (y `main.js?v=34`).
5. **Origen del vídeo conmutable**: `_videoSource` (`unc` por defecto, `local`, `mem`,
   `auto`), **clic al HUD** para rotar y recargar el clip; se guarda en
   `localStorage['fastpass_video_source']`.
6. **HUD de diagnóstico** (`#srtVideoHud`): `[UNC] 🌐 XARXA (UNC, sense còpia) · 25 fps`
   con medidor real de fotogramas (`requestVideoFrameCallback`) y watchdog que baja a 0 fps.
7. Medición clave: la copia de 201,7 MB tarda **3 s** (≈66 MB/s) y el clip necesita
   **~1 MB/s** ⇒ **la red nunca fue el cuello**; el defecto era el servo.

## 🟡 PENDIENTE (mañana)

- **Problema residual del visor, sin identificar**: el usuario dice *"sigue con algún
  problema aunque ha mejorado"*. **Primero pedirle el síntoma exacto** (¿micro-tirones?
  ¿negro momentáneo? ¿se queda atrás al hacer scrub? ¿sólo con `[UNC]`?).
- Herramientas listas para diagnosticar:
  - HUD del visor (esquina sup. izq.) → modo + fps reales. Clic = cambia de origen.
  - Log: `\\DSMEDIA07\portal324\PROJECTE 9x16 PREMIERE 2\AAA_PROJECTES PREMIERE VERTICALITZACIO\PROVES\FASTPASS.log`
    (buscar `⏱ PLY ... vel= driftV=`, `🎯 PLY salt`, `🎞️ SRT_EDIT:`).
  - Caché local del vídeo: `C:\temp\fastpass_video\<clip>.mp4` (se reutiliza si la mida
    coincide). Con modo `[UNC]` **no** se usa ni se genera.
  - Tests headless (Edge `--dump-dom` + `--virtual-time-budget`):
    `C:\temp\fp_test_video_fit.html` (15), `fp_test_video_sync.html` (31),
    `fp_test_video_mem.html` (58) con sus runners `fp_run_*.ps1`; syntax check del panel
    (`fp_syntax_check2.html` → 21 OK, incluye `srt_editor.js`).
- **Ideas si el residuo es de composición/decodificación**: ya está en el `.debug`
  `--disable-accelerated-video-decode` (activo tras reiniciar Premiere). Alternativas a
  probar: quitar `object-fit: cover` (recorte a nivel de compositor), o forzar un
  repintado tras seek en pausa.

## ⚠️ Recordatorios

- `.debug` **está en `.gitignore`** (no se commitea): sus flags viven en esta máquina
  (`--allow-file-access-from-files`, `--disable-accelerated-video-decode`).
- Sin commit hasta que el usuario valide en Premiere (regla del proyecto).
- Decisiones abiertas de otras sesiones: `flow_retols.js` (borrar vs consolidar),
  criterio del semáforo (SRT presente pero fuera de la pista de subtítulos),
  `srtEmergencyTailSec` (60 s, configurable en `Profile.json`).

---

*FAST >>> PASS · handoff 2026-09-15*
