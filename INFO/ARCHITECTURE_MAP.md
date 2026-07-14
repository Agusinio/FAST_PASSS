# 🗺️ MAPA D'ARQUITECTURA (FAST >>> PASS) - v2.6.0 "LIPO-PRO"

Aquest document detalla la nova jerarquia de 5 capes establerta després del **PLA LIPO FINAL** (Atomització Total i Era dels Inspectors).

---

## 🏗️ L'ESTRUCTURA DE 5 CAPES (TIERED ARCHITECTURE)

| Capa | Ubicació | Responsabilitat | Comentari |
| :--- | :--- | :--- | :--- |
| **1. WORKFLOW** | `js/workflows/` | **Orquestració**. (El Director) | Decideix els passos del negoci (Nou, Cut, Srt). |
| **2. ACTION LOGIC** | `js/logic/` | **Execució**. (Les Mans) | Calcula transformacions, ingestes massives, ripple-trims. |
| **3. INSPECTORS** | `js/inspectors/`| **Descobriment**. (Els Ulls) | Recullen dades pures (Fitxers, App, Projecte). |
| **4. CORE** | `js/core/` | **Fonaments**. (El Cervell) | `Context` (Estat Global), `State`, `Config` i `Utils`. |
| **5. SYSTEM (JSX)** | `jsx/` | **Atoms**. (El Múscul) | Ponts (`main.jsx`) i Modules (`*.jsx`) per a Premiere Pro. |

---

## 👁️ ERA DELS INSPECTORS (Discovery Layer)

| Mòdul | Responsabilitat | Dades que retorna (JSON) |
| :--- | :--- | :--- |
| **`Scanner.js`** | **Logic-Inspector**. Escaneja el NAS (Chyrons/Media). | Wotts (.mov), Vídeos (.mp4), Subtítols (.srt), Portada (.png). |
| **`1_SourceAssets`** | **Extern**. Analitza fitxers i dates del NAS. | Llistat brut de fitxers i mtimes. |
| **`2_App`** | **App-Level**. Estat global de Premiere Pro. | Projectes oberts, enfocament actual. |
| **`3_Session`** | **Session-Level**. Interior del projecte actiu. | Clips en línia de temps, seqüències, contingut de Bins. |

---

## 🧠 SÍNTESI DE CONTEXT (The Core Brain)

El mòdul **`4_Context.js`** sintetitza els informes i decideix l'estat i missatges a la UI:
*   **NEW**: Projecte inexistent. Activa creació de plantilla.
*   **UPDATE**: Projecte actiu. Activa sincronització incremental.
*   **GO**: Projecte obert però inactiu. Activa canvi de focus i sync.
*   **LOAD**: Projecte tancat en disc. Activa obertura i sync.
*   **Report de Assets**: Reporta a `missing` (Wotts, Media, Srt, Portada).

---

## 📦 DETALL DELS MÒDULS DE LÒGICA I JSX (LIPO)

| Mòdul | Component Clau | Descripció de l'edició |
| :--- | :--- | :--- |
| **`Project_Logic.js`** | `create()` / `ingestAssets()` | Centralitza la ingesta unificada segons context. |
| **`3_Project.jsx`** | `cloneSeq()` / `rename()` | Operacions atòmiques sobre projecte d'Adobe Premiere. |
| **`13_Timeline.jsx`**| `Timeline.get()` / `set()` | Control de navegació i CTI. |
| **`6_Clips.jsx`** | `Clips.insert()` | Inserció Overwrite a tracks específics. |
| **`5_Tracks.jsx`** | `Tracks.target()` | Control de focus de pistes (V1/A1). |

---

## 🚦 FILOSOFIA DE COMUNICACIÓ (LITERAL & DRY)

1.  **Orquestració en JS**: Totes les decisions de flux es prenen a JS. El JSX només executa ordres atòmiques ("Atoms").
2.  **Unificació de Sync**: Tant el `LOAD` com el `GO` com l'`UPDATE` disparen el mateix mecanisme d'ingesta incremental.
3.  **Robustesa JSX**: Totes les cerques i canvis de nom en JSX usen `decodeURIComponent` per evitar errors amb caràcters especials.
4.  **Auto-Edició**: El sistema auto-prepara el timeline si està buit, inserint el clip principal i activant els tracks actius.

---
© 2026 FAST >>> PASS | Mapa d'Arquitectura v2.6.0 (Stabilized)
