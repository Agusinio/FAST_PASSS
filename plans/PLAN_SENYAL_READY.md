# PLA · Senyal «LLEST per treballar» + bloqueig mentre el context treballa

**Data creació**: 2026-09-18 (per executar el dia següent)
**Objectiu**: que l'usuari sàpiga **quan pot començar a treballar** i que **no toqui res** mentre el codi treballa per sota.
**Abast**: `js/core/4_Context.js`, `js/core/project_registry.js`, `js/core/utils.js`, `style.css`, `index.html` (cap JSX, cap reinici de Premiere)

---

## 1. Necessitat

En arrencar (o en canviar programa/bloc), l'extensió fa un **escaneig COMPLET del NAS** (escaleta + media + wotts + portades): pot trigar desenes de segons. Durant aquest temps el panell sembla «viu» però **no està a punt**: si l'usuari prem botons, els workflows treballen amb dades incompletes (és l'origen de molts «no troba el MP4/SRT» i d'estats intermedis estranys).

Cal, doncs, **dues coses**:
1. **Senyal de treball**: «estic analitzant, no toquis res» (àmbar, intermitent).
2. **Senyal de fi**: «ja pots treballar» (verd) — i, si l'anàlisi ha acabat però falta material (ingesta en curs), un estat intermedi «ESPERANT» en àmbar fix.

---

## 2. Què ja existeix (i per això és barat de fer)

| Peça | Ubicació | Estat |
|---|---|---|
| El Main **ja és propietat de `4_Context`** | `4_Context.js:639` `updateButton(state, data)`; comentari a `project_registry.js:157`: *«NUNCA tocamos el btnMainAction aquí, ya que su estado lo gestiona Core.Context»* | ✅ |
| Estats del Main ja definits | `updateButton()`: `NEW` («CREAR», `btn-new`), `LOAD`, `GO`, `UPDATE`, `DISABLED`, `WAITING` (`btn.disabled` amb DISABLED/WAITING) | ✅ ampliable amb 2 estats nous |
| **Bloqueig de botons de workflow** | `project_registry.js:138` `_setWorkflowEnabled(enabled)` (llista d'IDs + classe `registry-disabled`) | ✅ reutilitzable |
| Semàfors amb colors i **intermitència** | `style.css:362-375`: `.light.ready|pending|error|off` + **`.light.blink`** | ✅ |
| Hook de «busy» | `utils.js:791` `updateUIState(state)` → aplica `.busy` a `#main-content` | ⚠️ **`style.css` NO té cap regla `.busy`** → avui no fa res |
| Context ↔ UI | `4_Context.js:127` `checkContext()` (pinta semàfors i crida `updateButton`), `:541` helper `set(id, state, title)` | ✅ punt d'enganxament ideal |
| Cicle d'execució | `initContext()` (arrencada + `onchange` dels selectors) i `main.js:1024 setInterval(...)` → `checkContext()` periòdic | ⚠️ veure §4 precaució |

---

## 3. Disseny proposat

### 3.1 Estats nous (visual)
| Estat | Quan | Main (`btnMainAction`) | Semàfor «READY» | Botons de workflow |
|---|---|---|---|---|
| **WORKING** | mentre corre l'anàlisi forçada (arrencada o canvi de programa/bloc) | text `⏳ ANALITZANT…`, classe `btn-working`, `disabled` | `pending` + **blink** | **bloquejats** |
| **WAITING** (ja existeix) | anàlisi acabada però falta material (ingesta en curs, escaleta incompleta) | text d'estat en àmbar, `disabled` | `pending` fix + `title` amb el motiu | bloquejats |
| **READY** | anàlisi acabada i tot el material essencial disponible | text normal (`NOU`/`CREAR`/`GO`…), classe `btn-ready` (verd) | `ready` verd | **habilitats** |

`title` (tooltip) de cada estat ha d'explicar el motiu, perquè l'usuari no endevini.

### 3.2 Punt d'enganxament exacte
1. **`4_Context.checkContext()`** — envoltar:
   - **Inici**: `updateUIState('BUSY')` + `Registry._setWorkflowEnabled(false)` + `updateButton('WORKING')` + semàfor `READY` en `pending/blink`.
   - **Fi (`finally`)**: recalcular la conclusió i pintar `READY` o `WAITING`; `updateUIState('READY')`; re-habilitar botons **només** si la conclusió és READY.
2. **`4_Context.updateButton(state, data)`** — afegir els `case 'WORKING'` i `case 'READY'` (i assegurar el `title`).
3. **`project_registry._setWorkflowEnabled`** — ampliar la llista d'IDs: avui no inclou `btnGrafDoblePantalla`, `btnGrafMapa`, `btnGrafTotem`, `btnSrtLoad`, `btnSrtExport`, `btnSrtReset`, `btnMarksF1…F6`, `btnSetup`… → si no s'amplia, «no tocar res» serà fals.
4. **`style.css`** — regles noves: `.busy` (dim + `pointer-events: none`), `.btn-working`, `.btn-ready`, `.btn-waiting`, `.registry-disabled` (avui s'aplica la classe però no té estil).
5. **`index.html`** — opcional: un semàfor nou `sem-ready` (o un badge «LLEST») dins de la `semaforo-strip`, amb `title` descriptiu.

### 3.3 Regla de «conclusió» (a decidir)
Proposta per defecte (coherent amb els semàfors actuals):
```
READY  ⇔  esc.ready  ∧  mp4 == 'ready'  ∧  wot == 'ready'
WAITING⇔  l'anàlisi ha acabat però alguna condició anterior és falsa (motiu al tooltip)
SRT i portades NO bloquegen (opcionals, com avui)
```
Alternativa: exigir també `srt` (més estricte) o deixar-ho configurable a `Profile.json` (`general.readyRequires: ["esc","mp4","wot"]`).

---

## 4. Precaució crítica (no bloquejar el panell cada X segons)

`checkContext()` també s'executa **periòdicament** (`main.js:1024 setInterval` amb guarda `_ctxRefreshBusy`). Si es bloqueja la UI en **cada** cicle, el panell quedarà inutilitzable.

**Regla proposada**: bloquejar (WORKING + `_setWorkflowEnabled(false)`) **només** quan:
- és l'arrencada (`initContext`), o
- l'han forçat (`checkContext({force:true})` des de Ctrl+clic AHIR / canvi de selectors / FOTO), o
- l'anàlisi triga més d'un llindar (p. ex. `> 800 ms`).

Els polls de fons només actualitzen el **semàfor** (verd/àmbar); mai bloqueixen ni canvien el text del Main si l'usuari ja està treballant.

---

## 5. Passos d'implementació (ordre)

1. `style.css`: `.busy`, `.btn-working`, `.btn-ready`, `.registry-disabled` (visual primer, així es prova en calent).
2. `project_registry._setWorkflowEnabled`: ampliar la llista d'IDs (mantenint `btnMainAction` i els selectors sempre operatius).
3. `4_Context.updateButton`: `case 'WORKING'` / `case 'READY'` + tooltips.
4. `4_Context.checkContext`: `try/finally` amb el cicle WORKING ➜ conclusió; regla de §3.3 i llindar de §4.
5. `index.html`: semàfor `sem-ready` a la `semaforo-strip` (opcional però recomanat: és la senyal més visible).
6. Cache-busters: `4_Context.js?v=15`, `project_registry.js?v=6`, `style.css?v=56` (+ `utils.js` si es toca).
7. Checker de sintaxi: `4_Context.js` i `project_registry.js` **ja hi són** a `C:\temp\fp_syntax_check2.html` ✔ (afegir-hi només els fitxers nous que apareguin).

## 6. Criteris d'acceptació
- [ ] En obrir el panell amb un projecte: el Main mostra «ANALITZANT…» i **tots** els botons de workflow estan bloquejats fins que acaba l'anàlisi.
- [ ] En acabar amb material complet: semàfor verd + Main operatiu + botons habilitats.
- [ ] En acabar sense material: estat `WAITING` en àmbar i el tooltip diu **què** falta.
- [ ] Els polls de fons **no** bloquegen res ni canvien el text del Main mentre l'usuari treballa.
- [ ] Cap workflow pot arrencar amb dades a mig escanejar.
- [ ] La resta de fluxos (NOU/ACTUALITZAR/CARREGAR/GO) funcionen igual que abans.

## 7. Riscos
- **Bloquejar de més**: si `_setWorkflowEnabled` s'aplica als polls de fons, el panell queda mort → veure §4.
- **Botons no llistats**: l'usuari podria prémer un botó no bloquejat → ampliar la llista i, millor, autogenerar-la amb un atribut (`data-workflow-btn`) per no dependre d'una llista manual.
- **`btn.disabled` + `updateButton`**: ja hi ha un joc de prevalences Registry vs Context (comentari dins `updateButton`); respectar-lo i no reintroduir el bug «botó gris quan el context és vàlid».

## 8. Decisions pendents de l'usuari
1. Senyal principal: **només el botó Main** / **només un semàfor nou** / **els dos** (recomanat).
2. Regla de READY: `esc+mp4+wot` (recomanat) o també `srt`.
3. Bloqueig: només els botons de workflow (recomanat) o **tota** la UI (overlay tipus `#setup-overlay` amb «NO TOQUIS — ANALITZANT…»).
4. Llindar de bloqueig en polls de fons (§4): 800 ms / no bloquejar mai / un altre.

---

*Relacionat: `docs/audits/AUDITORIA_CAPES_2026-09-18.md` §5 i §8 (`4_Context.js` hauria de separar inspector i workflow) — aquesta feature és una bona oportunitat per fer aquesta separació.*

