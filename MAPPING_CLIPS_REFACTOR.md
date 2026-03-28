# Mapeig Detallat de Refactorització: CLIPS

Aquest document detalla cada canvi necessari al mòdul de **Clips** (tant en JSX com en JS Logic) per passar a la nova arquitectura de nomenclatura literal.

## 1. Mòdul JSX: `6_Clips.jsx`
Namespace Intern: `FASTPASS.Clips`

| Funció Antiga | Funció Nova | Canvis en la Signatura |
| :--- | :--- | :--- |
| `_getTrack` | `_get` | Cap (es manté private) |
| `getCount` | `count` | Cap |
| `getDataByIndex` | `get` | (trackIdx, index, type) |
| `getDataByTime` | `at` | (trackIdx, time, type) |
| `remove` | `remove` | Cap |
| `overwrite` | `insert` | (nom, trackIdx, temps, type) |
| `setStart` | `setStart` | Cap |
| `setEnd` | `setEnd` | Cap |
| `setInPoint` | `setInPoint`| Cap |
| `getProperty` | `getProp` | Cap |
| `setProperty` | `setProp` | Cap |
| `detectScenes` | `scenes` | Cap |
| `getSelectedSubtitleClips` | `getSubtitles` | Cap |

---

## 2. Ponts JSX (Bridges) en `main.jsx`
Creació de l'objecte global `Clips` al motor ExtendScript.

| Crida Actual (Bridge) | Crida Nova (Literal) | Mapeig Intern |
| :--- | :--- | :--- |
| `jsx_getClipCount` | `Clips.count()` | `FASTPASS.Clips.count()` |
| `jsx_getClipDataByIndex` | `Clips.get()` | `FASTPASS.Clips.get()` |
| `jsx_getClipDataByTime` | `Clips.at()` | `FASTPASS.Clips.at()` |
| `jsx_removeClip` | `Clips.remove()`| `FASTPASS.Clips.remove()` |
| `jsx_overwriteClip` | `Clips.insert()`| `FASTPASS.Clips.insert()` |
| `jsx_setClipProperty` | `Clips.set()` | `FASTPASS.Clips.setProp()` |
| `jsx_getClipProperty` | `Clips.getProp()` | `FASTPASS.Clips.getProp()` |
| `jsx_detectScenes` | `Clips.scenes()`| `FASTPASS.Clips.scenes()` |

---

## 3. Lògica JS: `6_Clips_Logic.js`
Namespace: `FASTPASS_UI.Logic.Clips` (Alias `window.Clips`)

| Funció Antiga | Funció Nova | Impacte en Caller |
| :--- | :--- | :--- |
| `findAtTime` | `at` | `Clips.at(track, time, "video")` |
| `rippleTrimStart` | `trimStart` | `Clips.trimStart(...)` |
| `clearMultipleTracksAfter` | `clearAfterMultiple`| `Clips.clearAfterMultiple(...)` |
| `clearTrackAfter` | `clearAfter` | `Clips.clearAfter(...)` |
| `getTrackClips` | `list` | `Clips.list(...)` |

---

## 4. Workflows Afectats (Callers)
Callers que hauran d'actualitzar la seva sintaxi per no trencar-se:

- `flow_cut.js` (L36, L47, L50, L54, L86, L94, L98, L139, L141, L143, L167, L169, L171)
- `flow_assembly.js` (L48, L52, L90)
- `flow_mainButton.js` (L88, L117)
- `flow_retols.js` (L45, L62)
- `flow_srt.js` (L88)

---

## Estratègia de "No Trencar"
Mentre durem a terme la migració, els ponts antics `jsx_...` seguiran existint apunant a les noves funcions. Això ens permet refactoritzar els fitxers d'un en un sense aturar el funcionament global del panell.
