# Auditoría General del Codi — FAST >>> PASS v2.4.2

**Data**: 28/03/2026  
**Abast**: 14 mòduls JSX, 9 fitxers lògica JS, 7 workflows, 3 inspectors, 6 core  
**Filosofia de referència**: ExtendScript super-atòmic + JS orquestrador

---

## Estructura del Projecte

```
jsx/
├── main.jsx              ← Router i bridges (151 línies)
└── modules/
    ├── 1_System.jsx       ← Polyfill JSON + namespace
    ├── 2_IO.jsx           ← Lectura/escriptura disc + importació
    ├── 3_Project.jsx      ← Gestió projecte (bins, seqüències)
    ├── 4_Sequences.jsx    ← CTI, In/Out
    ├── 5_Tracks.jsx       ← Mute/Lock/Target
    ├── 6_Clips.jsx        ← Operacions CRUD sobre clips
    ├── 7_KF.jsx           ← Keyframes, posició, Auto Reframe
    ├── 8_Graphics.jsx     ← Exportació frame, chyrons
    ├── 9_Render.jsx       ← AME queue, PNG export
    ├── 10_Subtitles.jsx   ← BUIT (obsolet)
    ├── 11_Context.jsx     ← Anchoring multi-projecte
    ├── 12_Diagnostic.jsx  ← Informe tècnic KF
    └── 13_Timeline.jsx    ← Helper compartit (getClipAtTime)

js/
├── core/                  ← Utils, Config, Context, Registry, State, Logger
├── inspectors/            ← SourceAssets, App, Session
├── logic/                 ← Scanner, Parser, Clips, KF, Tracks, Render, Srt, Assembly
└── workflows/             ← MainButton, Cut, Assembly, Retols, KF, Srt, Render
```

---

## 🔴 BUGS ACTIUS

### 1. Funció `findTemaData` duplicada a Scanner.js

[Scanner.js](file:///Volumes/PYTHON/FAST_PASSS_Desarrollo/js/logic/Scanner.js) defineix `findTemaData` **dues vegades** (línies 19 i 129). JavaScript sobreescriu la primera amb la segona silenciosament. La primera versió (L19–63) **no aplica la guarda temporal** ni busca `Tema-Titol`. La segona (L129–188) sí.

> [!CAUTION]
> **Efecte**: No hi ha cap error visible perquè la **segona** definició és la correcta. Però si algú reorganitza el fitxer, la primera podria prendre precedència i trencar el filtrat per data.

**Fix**: Eliminar la primera definició (línies 19–63).

---

### 2. Bridge `jsx_getActiveProjectName` no existeix

[2_App.js](file:///Volumes/PYTHON/FAST_PASSS_Desarrollo/js/inspectors/2_App.js) crida `jsx_getActiveProjectName()` (L24), però **cap bridge JSX** defineix aquesta funció a `main.jsx`.

> [!WARNING]
> **Efecte**: `getActiveProjectName()` sempre retorna `""` (el `callJSX` wrapper retorna `"[]"` en cas d'error). Això significa que el `checkContext()` mai detecta correctament el projecte actiu per nom.

**Fix**: Afegir a `main.jsx`:
```js
function jsx_getActiveProjectName() {
    try { return app.project.name; } catch(e) { return ""; }
}
```

---

### 3. `9_Render.jsx` usa `app.project.activeSequence` nu

```js
addToAME: function(presetPath, outputFolder, outputFileName) {
    var seq = app.project.activeSequence; // ← NO ANCORAT
```

**Fix**: Reemplaçar per `FASTPASS.Context.getWorkSequence()`.

---

### 4. `12_Diagnostic.jsx` usa `app.project.activeSequence` nu

```js
var seq = app.project.activeSequence; // L12 — NO ANCORAT
```

**Fix**: Reemplaçar per `FASTPASS.Context.getWorkSequence()`.

---

### 5. `3_Project.jsx` — `cloneSequence` i `findSequenceByName` usen `app.project` nu

```js
cloneSequence: function(sourceName) {
    var proj = app.project;  // L132 — NO ANCORAT

findSequenceByName: function(name) {
    var proj = app.project;  // L180 — NO ANCORAT
```

**Fix**: Usar `getTargetProject()` (ja definit al mateix fitxer).

---

### 6. `flow_cut.js` — `app.project.save()` al CutOut (L104)

```js
await callJSX('app.project.save()');
```

Això guarda el projecte actiu de Premiere, **no necessàriament el projecte ancorat**. Si l'usuari ha canviat de pestanya entre CutIn i CutOut, pot guardar el projecte equivocat.

**Fix**: Canalitzar el save via `FASTPASS.Project.saveAs()` o un bridge dedicat `jsx_saveWorkProject()`.

---

## 🟠 DEAD CODE / REDUNDÀNCIES

| Fitxer | Problema |
|--------|----------|
| `10_Subtitles.jsx` | Mòdul **completament buit**. Es carrega al bootstrap sense fer res. |
| `main.jsx` L86 | `jsx_getActiveSequenceName` definida **dues vegades** (L86 i L132). La segona sobreescriu la primera. |
| `main.jsx` L56 | `var FASTPASS_WorkProject = null` — Variable local que **ombreja** `$.global.FASTPASS_WorkProject`. No s'utilitza mai. |
| `main.jsx` L85 | `jsx_getProjectFolder` usa `app.project.path` nu sense ancorar. |
| `1_System.jsx` L98 | Bridge `jsx_isReady` duplicat (ja existeix a `main.jsx` L40). |
| `2_IO.jsx` L113 | Bridge `jsx_scanDirectory` duplicat (ja existeix a `main.jsx` L59). |

---

## 🟡 MILLORES ESTRUCTURALS

### A. Principi d'Atomisme: Consistència

L'objectiu declarat és que JSX sigui **super-atòmic** (sense lògica de negoci). Però hi ha violacions:

| Mòdul | Violació |
|-------|----------|
| `8_Graphics.jsx` `placeStoredChyron` | Busca el chyron + el col·loca + ajusta la durada dins la mateixa crida. Hauria de ser 3 crides separades. |
| `3_Project.jsx` `cloneSequence` | Clona + retorna el nom del clon. La lògica de "què fer amb el clon" hauria de ser a JS. |

---

### B. Inspector `Session.js` — `escape` no existeix

```js
const raw = await utils.callJSX(`jsx_listItems('${utils.escape(binName)}')`);
```

L'objecte `utils` local de Session.js (L10–13) NO defineix `escape`. Això provoca un error silenciós.

**Fix**: Afegir `escape` al utils local o importar-lo de `FASTPASS_UI.Utils`.

---

### C. Gestió d'Errors massa permissiva

Gairebé tots els `catch` en JSX retornen strings genèrics (`"ERR: " + e.message`). No hi ha diferenciació entre:
- Error de permisos (NAS desconnectat)
- Error d'API (Premiere no respon)
- Error de lògica (clip no trobat)

**Suggeriment**: Codificar els errors amb prefixos (`ERR:PERM`, `ERR:API`, `ERR:LOGIC`) perquè JS pugui reaccionar diferentment.

---

### D. `callJSX` converteix TOTS els errors a `"[]"`

```js
} else if (res.indexOf("ERR:") === 0) {
    resolve("[]"); // ← Silencia l'error
}
```

Qualsevol operació que esperi un `"OK"` o un string simple rebrà `"[]"` en cas d'error. Això amaga bugs.

**Suggeriment**: Retornar `res` directament i deixar que cada caller gestioni l'error.

---

## ✅ PUNTS FORTS

| Àrea | Valoració |
|------|-----------|
| **Arquitectura JS/JSX** | Clara separació de responsabilitats. JS orquestra, JSX executa. |
| **Multi-Project Awareness** | Sistema reactiu de polling + anclatge ben implementat. |
| **Nomenclatura** | Funcions i variables coherents (`getWorkSequence`, `getWorkProject`). |
| **Modularitat** | Cada domini té el seu fitxer (Clips, Tracks, KF, Render). |
| **Navegació de Clips** | Salt + sincronització de slider molt ben resolt. |
| **Guards de Context** | `validateActiveSequence()` evita operacions en seqüències incorrectes. |

---

## Resum de Prioritats

| Prioritat | Acció | Fitxers |
|-----------|-------|---------|
| 🔴 P0 | Crear bridge `jsx_getActiveProjectName` | `main.jsx` |
| 🔴 P0 | Eliminar `findTemaData` duplicat | `Scanner.js` |
| 🔴 P1 | Ancorar `9_Render.jsx`, `12_Diagnostic.jsx` | JSX |
| 🔴 P1 | Ancorar `cloneSequence` i `findSequenceByName` | `3_Project.jsx` |
| 🟠 P2 | Netejar dead code (10_Subtitles, bridges duplicats) | Diversos |
| 🟠 P2 | Fix `Session.js` `escape` | `3_Session.js` |
| 🟡 P3 | Millorar gestió d'errors (`callJSX`, codis d'error) | `utils.js`, JSX |
| 🟡 P3 | Atomitzar `placeStoredChyron` | `8_Graphics.jsx` |
