# AUDIT DE CRASHES: FAST >>> PASS (22/03/2026)

Registre exacte de cada canvi aplicat i el seu estat.

---

## FIX 1 — `js/workflows/flow_KF.js` ✅ APLICAT

### Problema
`callJSX` i `log` s'usaven com a variables globals que no existien en el scope de l'IIFE. Hauria donat `ReferenceError` en cada clic del botó KEY i en cada moviment del Slider.

### Canvi (línies 1-11)
```diff
- (function() {
+ (function () {
+     const utils = window.FASTPASS_UI.Utils;
+     const callJSX = (s) => utils.callJSX(s);
+     const log = (m) => utils.log(m, "DEBUG");
```

### Estat: CORREGIT i guardat.

---

## FIX 2 — `js/workflows/flow_render.js` ✅ APLICAT

### Problema
`config.rutas.portadas` no existeix a `Config.js`. Donava `TypeError: Cannot read properties of undefined` en cada clic del botó PORTADA.

### Canvi (línia 73)
```diff
- const targetDir = config.rutas.portadas || "C:\\Temp";
+ const targetDir = config.rutas.portadas || config.rutas.destinoBase || "C:\\Temp";
```

### Estat: CORREGIT i guardat.

> NOTA: Si en el futur es vol una ruta específica per a portades, cal afegir `portades: "\\\\ruta\\..."` a l'objecte `rutas` de `js/core/config.js`.

---

## FIX 3 — `js/workflows/flow_cut.js` ✅ APLICAT

### Problema
`main.js` tenia els botons ◀ i ▶ lligats a `callWorkflow('Cut', 'runPrevClip')` i `callWorkflow('Cut', 'runNextClip')`, però cap d'aquestes funcions existia a `flow_cut.js`. Donaria `TypeError` en cada clic.

### Canvi (afegit a partir de la línia 97)
Implementades les dues funcions noves:
- `runPrevClip()`: Busca el clip anterior al CTI a la pista V1 (mp4) i mou el capçal al seu punt central.
- `runNextClip()`: Busca el clip posterior al CTI a la pista V1 (mp4) i mou el capçal al seu punt central.

Ambdues funcions usen `cfg.tracks.video.mp4` (variable dinàmica de `Config.js`).

### Estat: CORREGIT i guardat.

---

## PENDENTS (No fan crash, acció futura)

### P1 — `js/logic/13_Parser.js` no carregat a `index.html`
El `BlockParser` existeix però no es carrega mai. No fa crash ara, però cal afegir-lo quan s'implementi la Fase 2.3 (Taula d'Estructura).

Acció: Afegir a `index.html` (abans del bloc de workflows):
```html
<script src="js/logic/13_Parser.js"></script>
```

### P2 — `flow_cut.js` `clearMultipleTracksAfter` amb args confusos
La crida actual passa `[T_MP4]` com a pistes d'àudio en lloc de pistes de vídeo a excloure. Cal revisar-ho quan s'implementi el CutOut definitiu (Fase 3.2).

---
© 2026 FAST >>> PASS | Audit de Crashes v1.0
