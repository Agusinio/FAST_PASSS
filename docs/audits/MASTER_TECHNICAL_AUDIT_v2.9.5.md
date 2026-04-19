# 📊 MASTER TECHNICAL AUDIT - FAST >>> PASS (v2.9.5+)

Aquest document consolida la història arquitectònica, decisions de disseny i estat actual del sistema després dels refactors de les versions 2.4.x, 2.5.0 i l'Overhaul Tàctic 2.9.5.

---

## 🏗️ 1. ARQUITECTURA DE 5 CAPES (TIERED MODEL)

El sistema s'ha estabilitzat en un model de responsabilitats delegades on **JavaScript és el cervell** i **ExtendScript (JSX) és el múscul**.

| Capa | Ubicació | Responsabilitat | Comentari |
| :--- | :--- | :--- | :--- |
| **1. WORKFLOW** | `js/workflows/` | **Orquestració**. | Decideix els passos del negoci (Nou, Cut, Srt, Render). |
| **2. ACTION LOGIC** | `js/logic/` | **Execució Logic**. | Calcula transformacions, ingestes, i regles de negoci pures. |
| **3. INSPECTORS** | `js/inspectors/`| **Descobriment**. | Recullen dades de l'entorn (NAS, App, Projecte actiu). |
| **4. CORE** | `js/core/` | **Fonaments**. | Gestió d'estat (Context), Configuració i Utilitats globals. |
| **5. SYSTEM (JSX)** | `jsx/modules/` | **Atoms**. | Operacions atòmiques sobre Premiere Pro via namespace `FASTPASS`. |

---

## 🏷️ 2. ESTÀNDARDS DE NOMENCLATURA I PROTOCOLS

S'ha centralitzat la lògica de noms al `config.js` per garantir la traçabilitat en entorns de xarxa (NAS).

### A. Estructura de Noms
- **Projecte (.prproj)**: `Pruebas_[Prog]_[Bloq]_[Autor]_[MMDD]_[Tema].prproj`
- **Seqüència**: `[Prog]_[Tema]`
- **Sanitització**: Totes les cadenes passen per `utils.sanitizeName()` (Límits de 60 caràcters, eliminació de caràcters prohibits de Windows).

### B. Protocol de Camins (Path Handling)
1. **JS-FS**: Abans de qualsevol guardat, la capa JS usa `window.cep.fs` (Node.js) per verificar i crear l'arbre de directoris (`ensureFolders`). Això evita bloquejos de xarxa en rutes UNC.
2. **JSX Atomic**: El JSX rep la ruta ja validada i executa un `saveAs` amb un objecte `File` de Premiere per garantir la compatibilitat nativa.

---

## 🔌 3. ESTAT DEL BRIDGE I ATOMISME

S'ha completat la migració de ponts directes a un sistema de **Namespaces Literals** en JSX.

- **Namespaces Actius**:
  - `FASTPASS.Clips`: CRUD de clips, detecció d'escenes, gestió de tracks.
  - `FASTPASS.Timeline`: Control de CTI, In/Out i rangs.
  - `FASTPASS.Tracks`: Mute, Lock i Targeting (Focus V1/A1).
  - `FASTPASS.Project`: Clonat, rename, imports i guardat ancorat.
- **Bridge Safety**: Totes les crides via `callJSX` inclouen `decodeURIComponent` per protegir el sistema contra caràcters especials en noms de projecte o rutes.

---

## 🚥 4. ESTATUS DE WORKFLOWS PRINCIPALS

### 🎬 Assemblatje Màgic (The Magic)
- **Lògica**: Sincronització basada en "Footprint" (deriva temporal).
- **Auto-Reframe**: Aplicació automàtica a clips d'Intro i Inserts > 2.5s.
- **Snap**: Imanació automàtica de rètols al tall de càmera més proper.

### ✂️ Edició Tàctica (Cut)
- **Anchoring**: Totes les operacions es validen contra el projecte ancorat pel panell, evitant errors si l'editor canvia de pestanya.
- **Safe Out**: `CutOut` posiciona automàticament el CTI a -1 frame per evitar frames negres al tancament de peça.

### 🖼️ Portada Pro
- **Aïllament**: El sistema commuta la visibilitat de pistes (Ojos) de forma automàtica durant el snapshot per aillar tracks V1 i V3.

---

## ⚠️ 5. DEUDA TÈCNICA I PROBLEMES CONEGUTS

1. **Bug Flash White Cleanup**: En determinades condicions, la neteja de flash whites (clips < 0.2s) elimina erròniament el clip anterior al clip seleccionat. Veure `FLASH_WHITE_CLEANUP_PROBLEM.md` per a diagnòstic detallat.
2. **Comparació de Roles**: La comparació de tipus de rètols (NOMCARREC, etc.) és sensible a majúscules/minúscules en algunes rutes de codi legacy. S'ha de normalitzar a `.toUpperCase()`.
3. **Multi-Theme**: Actualment el sistema està optimitzat per a un sol `Tema-Titol` principal; s'ha de millorar el suport per a temes múltiples o transicions de tema.

---

## 📜 6. MILIARIS HISTÒRICS (v2.4 - v2.5)
- **v2.4.2**: Eliminació de duplicitat crítica a `Scanner.js`. Correcció del bridge `getActiveProjectName`. Implementació de l'anclatge multi-projecte reactiu.
- **v2.5.0**: Migració massiva a nomenclatura literal (`FASTPASS.Clips.count` vs `getClipCount`). Consolidació de `Sequences` en `Timeline`.

---
© 2026 FAST >>> PASS | Master Technical Audit v1.0
