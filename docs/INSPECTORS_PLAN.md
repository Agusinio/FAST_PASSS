# 📋 PLA DE REESTRUCTURACIÓ: L'ERA DELS "INSPECTORS"

Aquest pla detalla la migració del model actual (atomitzat però barrejat) a un model **estandaritzat per àmbits de coneixement**.

---

## 🏗️ 1. NOUS MÒDULS DE DESCOBRIMENT (INSPECTORS)

L'objectiu és que cada inspector només doni la **"fotografia"** del seu àmbit. No prenen decisions.

### 🔍 `SourceAssetsInspector` (Antic `Scanner.js`)
*   **Àmbit**: Sistema d'arxius (Extern: Discos, Servidors, Rutes de xarxa).
*   **Funcions**: `getFilesRaw`, `getLatestDayMap`.
*   **Retorn**: JSON pur amb rutes, noms i dates.
*   **LIPO**: Traiem d'aquí la cerca de temes o regex de blocs.

### 🔍 `AppInspector` (Antic `Context_Logic.js`)
*   **Àmbit**: Estat de l'aplicació Premiere (Intern).
*   **Funcions**: `getOpenedProjects`, `getActiveName`, `isLocked(path)`.
*   **Retorn**: Llista de noms i rutes de projectes ja carregats.
*   **LIPO**: Traiem d'aquí la comparativa amb el disc.

### 🔍 `SessionInspector` (Part de `Project_Logic.js`)
*   **Àmbit**: Contingut del projecte actiu (Treball).
*   **Funcions**: `listSequences`, `getBinItems('CHYRONS')`, `getActiveSequenceMetadata`.
*   **Retorn**: Metadades del que hi ha dins del timeline i la safata.
*   **LIPO**: Traiem d'aquí les accions d'obrir o clonar.

---

## 🧠 2. LA CAPA DE SÍNTESI: `Logic.Context`

Crearem un nou controlador intel·ligent (o refactoritzarem `Context_Logic`) que serà el que **"reuneix els informes"**.

*   **Funció `captureReality()`**: Crida als 3 inspectors en paral·lel.
*   **Funció `analyzeState()`**: Compara els 3 informes.
    *   Si el disc té arxius però Premiere no té el projecte → **Resultat: LOAD**.
    *   Si no hi ha res enlloc → **Resultat: NEW**.
    *   Si tot coincideix però la seqüència no és l'activa → **Resultat: GO**.
*   **Funció `findTheme()`**: Aquí migrarem la **Lògica de Negoci** (Regex dels Wotts, càlculs de noms de tema).

---

## ⏯️ 3. IMPACTE EN ELS WORKFLOWS

Els flujos com **`flow_nou.js`** ja no faran 10 crides a Logic. En faran una:

```javascript
// El futur de flow_nou.js
const audit = await Logic.Context.performAudit();
log("📍 Estat detectat: " + audit.conclusion); // NEW, UPDATE, LOAD, GO...

switch(audit.conclusion) {
    case 'NEW':  await this._initNew(audit.data); break;
    // ...
}
```

---

## 📅 FASES DE TREBALL

1.  **Fase A (Inspectors)**: Refactoritzar `Scanner.js` i `Context_Logic.js` per a que només retornin dades pures.
2.  **Fase B (Síntesi)**: Crear el `Logic.Context` que aglutini la intel·ligència.
3.  **Fase C (Workflow)**: Netejar `flow_nou.js` per usar l'auditoria única.
4.  **Fase D (Documentació)**: Actualitzar l' `ARCHITECTURE_MAP.md`.

---
*Aprovat per Antigravity. Iniciem quan diguis.*
