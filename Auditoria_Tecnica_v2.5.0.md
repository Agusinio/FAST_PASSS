# Auditoría General del Codi — FAST >>> PASS v2.5.0
**REFRESCO LITERAL & DRY - FASE 1 COMPLETADA**

**Data**: 28/03/2026  
**Abast**: 13 mòduls JSX (Fusión Sequences + Timeline), Clips Refactor Completo.
**Filosofia**: Nomenclatura Literal (Namespaces) + Ponts Atòmics Directes.

---

## 🏗️ Nova Estructura de Namespaces (Refactoritzada)

Amb l'inici de la migració a nomenclatura literal, s'han consolidat els següents dominis:

### A. CLIPS (Refactor complet)
*   **Espai**: `FASTPASS.Clips` (JSX) / `window.Clips` (JS).
*   **Mètodes literals**: `count`, `get`, `at`, `insert`, `start`, `end`, `inPoint`, `remove`, `scenes`, `subtitles`.
*   **Canvi**: S'ha eliminat la redundància (ex: `Clips.getClipCount` → `Clips.count`).
*   **Bridge**: `jsx_...` es mantenen com a alias per a retrocompatibilitat però apunten al nou objecte `Clips`.

### B. TIMELINE (Fusión Sequences + Utilities)
*   **Espai**: `FASTPASS.Timeline` (JSX) / `window.Timeline` (JS).
*   **Fitxer**: `13_Timeline.jsx`.
*   **Mètodes literals**: `get`, `set`, `range`, `refresh`.

### C. TRACKS (Refactor complet)
*   **Espai**: `FASTPASS.Tracks` (JSX) / `window.Tracks` (JS).
*   **Fitxer**: `5_Tracks.jsx`.
*   **Mètodes literals**: `count`, `mute`, `lock`, `target`.

### D. PROJECT (Refactor complet)
*   **Espai**: `FASTPASS.Project` (JSX) / `window.Project` (JS).
*   **Fitxer**: `3_Project.jsx`.
*   **Mètodes literals**: `save`, `saveAs`, `open`, `items`, `rename`, `move`, `clone`, `openSeq`, `list`, `bin`, `find`.
*   **Cap Logica**: `Project.activate(path, seq)`, `Project.create(tpl, dest, seq)`.

---

## ✅ BUGS FIXATS (P0/P1)

1.  **Scanner.js** 🔴: Eliminada la duplicació de `findTemaData`. Ara només existeix la versió amb guarda de 22h i extracció de tema intel·ligent.
2.  **Missing Bridge** 🔴: Afegit `jsx_getActiveProjectName` a `main.jsx`. La detecció de projecte ja no falla.
3.  **App & Session IDs**: S'ha sanejat el codi de `Session.js` per cridar correctament als nous ponts atòmics.
4.  **Sequences Merge**: S'ha eliminat el mòdul `4_Sequences.jsx` consolidant tot en `13_Timeline.jsx` amb noms literals.

---

## 🟠 PENDENT (Proper Refactor Literal)

| Domini | Estat | Tasca |
|--------|-------|-------|
| **PARSE** | Legacy | Adoptar `Parse.files`, `Parse.wotts` (reemplaçant Parser.js). |

---

## 🟡 MILLORES ESTRUCTURALS RECOMANADES

1.  **Atomisme en Graphics**: Encara tenim `placeStoredChyron` que fa massa coses (buscar, col·locar i estendre). Hauria de ser dividit.
2.  **Gestió d'Errors**: Implementar codis d'error (ERR:API, ERR:LOGIC) per a que la capa JS pugui reaccionar millor que amb un simple string.

---

## ✅ PUNTS FORTS DE LA NOVA ARQUITECTURA

*   **Llegibilitat**: `Timeline.get()` és incommensurablement més clar que `FASTPASS.Sequences.getCPT()`.
*   **Consistència**: Els noms de mètodes es mantenen idèntics entre JSX i JS (via aliasing o pont directre).
*   **Atòmic**: El bridge ara només és un router cap als objectes literals de cada mòdul.
