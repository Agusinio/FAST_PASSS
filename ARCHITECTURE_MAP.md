# 🗺️ MAPA D'ARQUITECTURA (FAST >>> PASS)

Aquest document detalla la relació entre les diferents capes del projecte seguint el **PLA LIPO** (Atomització i Separació de Responsabilitats).

---

## 🏗️ L'ESTRUCTURA EN 4 CAPES

| Capa | Ubicació | Responsabilitat | Comentari |
| :--- | :--- | :--- | :--- |
| **1. WORKFLOW** | `js/workflows/` | Orquestració d'alt nivell (Què fa el botó?) | Decideix els passos del procés. |
| **2. LOGIC** | `js/logic/` | Intel·ligència de domini i decisions. | No executa, només "pensa" i ordena. |
| **3. BRIDGE** | `jsx/main.jsx` | Passarel·la de comunicació JS ↔ JSX. | Punt d'entrada únic al motor. |
| **4. ATOM** | `jsx/modules/` | Execució física mínima i pura. | Només sap fer UNA cosa a la vegada. |

---

## 🔄 TRAÇABILITAT DE FLUXOS (Exemples)

### A. FLUX: NOU TEMA (`flow_nou.js`)
1. **Workflow**: `_runNew()`
2. **Logic**: `Scanner.findTemaData(ctx)` + `Project_Logic.createFromTemplate(...)`
3. **Bridge**: `jsx_openProject(path)` ↔ `jsx_overwriteClip(name, track, time)`
4. **Atom**: `FASTPASS.Project.openProject` ↔ `FASTPASS.Clips.overwrite`
5. **Premiere API**: `app.openDocument(path)` ↔ `track.overwriteClip(item, time)`

### B. FLUX: NETEJA I ACABATS (`flow_cut.js`)
1. **Workflow**: `runCutOut()`
2. **Logic**: `Clips_Logic.clearMultipleTracksAfter(val, tracks)`
3. **Bridge**: `jsx_getClipCount(track)` ↔ `jsx_removeClip(track, index)`
4. **Atom**: `FASTPASS.Clips.getCount` ↔ `FASTPASS.Clips.remove`
5. **Premiere API**: `track.clips.numItems` ↔ `clip.remove(true, true)`

---

## 📦 DETALL DELS MÒDULS ATÒMICS (JSX)

| Mòdul | Àtom Principal | Funció a l'API de Premiere |
| :--- | :--- | :--- |
| **`3_Project.jsx`** | `findItem` | Cerca recursiva en `rootItem.children` |
| | `openSequence` | `app.project.openSequence(id)` |
| **`5_Tracks.jsx`** | `setMute` | `track.setMute(boolean)` |
| | `getTrackCount` | `videoTracks.numTracks` / `audioTracks.numTracks` |
| **`6_Clips.jsx`** | `overwrite` | `track.overwriteClip(item, time)` |
| | `setProperty` | `clip.components[n].properties[m].setValue(val)` |
| | `detectScenes` | `sequence.performSceneEditDetectionOnSelection()` |
| **`11_Context.jsx`** | `getActiveName` | `app.project.name` |
| **`13_Timeline.jsx`**| `setCTI` | `app.project.activeSequence.setPlayerPosition(time)` |

---

## 🧠 LÒGICA CENTRALITZADA (JS)

| Lògica | Decisions Clau |
| :--- | :--- |
| **`Scanner.js`** | Filtre de fitxers per **Data de Modificació** i **Prefix de Programa**. |
| **`Project_Logic.js`** | Selecció de la **Seqüència correcta** d'una línia mitjançant Regex en el JSON rebut del JSX. |
| **`Clips_Logic.js`** | Cerca de quin clip hi ha sota el cabezal via bucle sobre `jsx_getClipDataByIndex`. |
| **`Parser.js`** | Extracció de metadades dels noms de fitxer (Títol, Línia, TC). |
| **`Render_Logic.js`** | Control del **Polling del sistema d'arxius** (window.cep.fs) durant l'exportació de Snapshots. |

---

## 🚦 FILOSOFIA DE TRADUCCIÓ DE DADES

*   **Índexs**: El JS treballa sempre amb índexs **humans/VUI (1-based)**. El Bridge (`main.jsx`) resta 1 per parlar amb l'atomisme de Premiere **(0-based)**.
*   **Decisions**: Mai posem un `if` de negoci al JSX. El JSX executa el que se li diu sense preguntar ("Posa A en B").
*   **Estats**: El JS manté el `FASTPASS_UI.State` (què estem fent). El JSX no recorda res ("Stateless").

---
*Generat automàticament per Antigravity seguint el Pla LIPO.*
