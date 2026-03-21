# 🗺️ MAPA D'ARQUITECTURA (FAST >>> PASS) - v2.0 "LIPO-PRO"

Aquest document detalla la nova jerarquia de 5 capes establerta després del **PLA LIPO FINAL** (Atomització Total i Era dels Inspectors).

---

## 🏗️ L'ESTRUCTURA DE 5 CAPES (TIERED ARCHITECTURE)

| Capa | Ubicació | Responsabilitat | Comentari |
| :--- | :--- | :--- | :--- |
| **1. WORKFLOW** | `js/workflows/` | **Orquestració**. (El Director) | Decideix els passos del negoci (Nou, Cut, Srt). |
| **2. ACTION LOGIC** | `js/logic/` | **Execució**. (Les Mans) | Calcula transformacions, ripple-trims i muntatges. |
| **3. INSPECTORS** | `js/inspectors/`| **Descobriment**. (Els Ulls) | Recullen dades pures sense judici (Fitxers, App, Projecte). |
| **4. CORE** | `js/core/` | **Fonaments**. (El Cervell) | `Context` (sintetitza l'estat), `State`, `Config` i `Utils`. |
| **5. SYSTEM (JSX)** | `jsx/` | **Atoms**. (El Múscul) | Ponts (`main.jsx`) i Modules (`*.jsx`) que toquen Premiere. |

---

## 👁️ ERA DELS INSPECTORS (Discovery Layer)

| Inspector | Responsabilitat | Dades que retorna (JSON) |
| :--- | :--- | :--- |
| **`1_SourceAssets`** | **Extern**. Mira el servidor/xarxa/discos. | Llista de Wotts, dates de modificació. |
| **`2_App`** | **App-Level**. Mira l'estat de Premiere Pro. | Projectes oberts, nom del projecte actiu. |
| **`3_Session`** | **Session-Level**. Mira dins del projecte actiu. | Clips a la línia, seqüències, contingut de Bins. |

---

## 🧠 SÍNTESI DE CONTEXT (The Core Brain)

El mòdul **`4_Context.js`** recull els informes dels 3 Inspectors i decideix l'estat global:
*   **NEW**: No hi ha res preparat.
*   **UPDATE**: El projecte està obert i actiu.
*   **GO**: El projecte està obert però no és l'actiu.
*   **LOAD**: El projecte existeix en disc però cal obrir-lo.

---

## 📦 DETALL DELS MÒDULS ATÒMICS (JSX)

| Mòdul | Àtom Principal | Funció a l'API de Premiere |
| :--- | :--- | :--- |
| **`1_System.jsx`** | `jsx_isReady` | Verificació de salut del motor. |
### A. FLUX: MAIN ACTION (`flow_mainButton.js`)
1. **Workflow**: `runMainAction(action, data)`
2. **Logic**: `Project_Logic.createFromTemplate(...)` o `Project_Logic.openProject(...)`
3. **Bridge**: `jsx_openProject(path)` ↔ `jsx_overwriteClip(name, track, time)`
| **`2_IO.jsx`** | `jsx_importFiles` | Ingesta massiva amb anclatge a Bin. |
| **`3_Project.jsx`** | `jsx_listSequences` | Recuperació d'indices de seqüència. |
| **`6_Clips.jsx`** | `jsx_getClipDataByTime`| Dades del clip sota el cabezal (CTI). |
| **`7_KF.jsx`** | `jsx_setClipXPosition`| Manipulació de la propietat Posi (Motion). |

---

## 🚦 FILOSOFIA DE COMUNICACIÓ (JS ↔ JSX)

1.  **Orquestració en JS**: Totes les decisions de "Si passa X fem Y" es prenen a la capa JS. El JSX mai pren decisions.
2.  **Índexs Corregits**: El JS parla en **1-based (V1, V2)**. El Bridge (`main.jsx`) resta 1 per parlar amb Premiere **(0-based)**.
3.  **JSON com a Lenguatge**: Les dades complexes viatgen sempre com a strings JSON per evitar pèrdues de tipus.
4.  **Async Bridge**: Totes les crides `callJSX` són asíncrones (Promises), evitant bloquejar la UI durant càlculs pesats.

---
*Document tancat i segellat post-Pla LIPO per Antigravity.*
