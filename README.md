# FAST >>> PASS – Extensió per Adobe Premiere Pro

**Versió:** 2.9.5 (TACTICAL)  
**Estat:** Estable · Producció

---

## 📋 Descripció

FAST >>> PASS és una extensió d'Adobe Premiere Pro que automatitza el flux de treball d'edició per a programes de televisió, des de la ingesta de material fins a l'exportació final, passant per tall, grafismes i subtítols.

L'extensió implementa una arquitectura de **5 capes** que separa responsabilitats i garanteix robustesa, reutilització i mantenibilitat.

---

## 🗂️ Estructura del projecte

### **Arrel del projecte** – Informació essencial i punt d'entrada

| Fitxer/Directori | Propòsit |
|------------------|----------|
| `README.md` | Aquest fitxer. Guia d'inici i visió general. |
| `index.html` | Interfície principal del panell (UI). |
| `Profile.json` | Configuració de perfils (programes, tracks, rutas). |
| `package.json` | Configuració del projecte (dependències CEP). |
| `CSXS/` | Configuració de l'extensió CEP (`manifest.xml`). |
| `js/` | **Codi JavaScript** — cervell de l'extensió. |
| `jsx/` | **Codi ExtendScript** — múscul atòmic per Premiere. |
| `bin/` | Scripts PowerShell d'automatització i anàlisi. |
| `presets/` | Presets d'exportació (`.epr`). |

### **Documentació** — `docs/`

| Carpeta | Contingut |
|---------|-----------|
| `docs/guides/` | Guies: arquitectura, propietat del codi, usuari, botonera, desenvolupament, Git. |
| `docs/specs/` | Especificacions tècniques: escaleta JSON, markers, NNEWS, classificació. |
| `docs/reference/` | Material de referència: keyframes, interpolació, estructura del parser, temps onAir. |
| `docs/plans/` | Pla actiu en curs. |
| `docs/archive/` | Només consulta: codi obsolet i l'arxiu històric fusionat. |

> 🧹 **Neteja 2026-09-30:** les auditories, informes de debug, plans tancats i sessions diàries
> s'han fusionat en 4 fitxers d'arxiu (`docs/archive/AUDITORIAS.md`, `DEBUG.md`, `PLANS_CLOSED.md`
> i `SESSIONS.md`) i s'han eliminat 65 originals. Les mostres del SDK d'Adobe (19 MB) han sortit
> del repo a `C:\temp\fp\docs_SAMPLES` — veure [`docs/reference/SAMPLES_ADOBE.md`](docs/reference/SAMPLES_ADOBE.md).

### **Centre de control** — `.roo/`

| Fitxer | Propòsit |
|--------|----------|
| `.roo/features.json` | Catàleg de features i bugs (registre viu). |
| `.roo/progress/` | Tracking de sessions de treball (només `README.md` i el dia en curs; la resta a `docs/archive/SESSIONS.md`). |

### **Codi font** – Organització per capes (5 Tiers)

| Capa | Directori | Responsabilitat |
|------|-----------|-----------------|
| **1. WORKFLOW** | `js/workflows/` | Orquestració dels fluxos de negoci (Nou, Cut, Srt…). |
| **2. ACTION LOGIC** | `js/logic/` | Execució de transformacions, ingestes, càlculs. |
| **3. INSPECTORS** | `js/inspectors/` | Descobriment de dades (fitxers, app, sessió). |
| **4. CORE** | `js/core/` | Fonaments: `Context`, `State`, `Config`, `Utils`. |
| **5. SYSTEM (JSX)** | `jsx/` | Mòduls atòmics ExtendScript per a Premiere Pro. |

---

## 🚀 Començar

### 1. **Requisits**
- Adobe Premiere Pro (versió compatible amb CEP).
- Extensió instal·lada i activada (veure [`CSXS/manifest.xml`](CSXS/manifest.xml)).
- Accés al NAS amb l'estructura esperada de fitxers.
- Git portable a `E:\PortableGit` (per desenvolupament; la lletra d'unitat del USB pot ser `E:` o `F:` — comprova-ho amb `Test-Path`).

### 2. **Execució**
1. Obre Premiere Pro.
2. Carrega el panell **FAST >>> PASS** des de Finestra → Extensions.
3. Selecciona Programa i Bloc.
4. El botó principal canviarà segons l'estat del projecte (**NOU**, **OBRIR**, **ANAR‑HI**, **ACTUALITZAR**).

### 3. **Documentació clau**
- [🗺️ Mapa d'arquitectura](docs/guides/ARCHITECTURE_MAP.md) — Visió de les 5 capes.
- [🧭 Propietat del codi](docs/guides/CODE_OWNERSHIP.md) — Qui fa què a cada mòdul.
- [📖 Guia d'usuari](docs/guides/USER_GUIDE.md) — Manual d'ús del panell.
- [🕹️ Guia de botonera](docs/guides/GUIA_BOTONERA.md) — Funcionalitats de cada botó.
- [🛠️ Guia de desenvolupament](docs/guides/DEVELOPMENT.md) — Convencions i flux de treball.
- [📚 Especificacions](docs/specs/) — Escaleta JSON, markers, NNEWS, classificació.
- [⚙️ Flux operatiu](docs/archive/PLANS_CLOSED.md) — Detall de cada fase (arxivat 2026-09-30).

### 4. **Desenvolupament**
- El registre viu de bugs i features és a [`.roo/features.json`](.roo/features.json).
- El tracking diari és a [`.roo/progress/`](.roo/progress/) i els handoffs a [`plans/`](plans/).
- Scripts d'automatització a [`bin/`](bin/); els informes llargs es deixen a `C:\temp\fp\` (vegeu [`bin/rep.ps1`](bin/rep.ps1)).
- Valida la sintaxi del panell amb el motor V8: `powershell -NoProfile -ExecutionPolicy Bypass -File ".\bin\check_js_v8.ps1"`

---

## 🔧 Manteniment i actualitzacions

- **Versió actual:** 2.9.5 (TACTICAL).
- **Pla actiu:** [`docs/plans/PLAN_MARKERS_CAPAS.md`](docs/plans/PLAN_MARKERS_CAPAS.md).
- **Historial tècnic:** [`docs/archive/`](docs/archive/) — auditories, debug, plans tancats i sessions fusionats.
- **Bugs i features:** Registre viu a [`.roo/features.json`](.roo/features.json).
- **Tracking de sessions:** [`plans/HANDOFF_*.md`](plans/) i [`.roo/progress/`](.roo/progress/).

---

## 📄 Llicència

Aquest projecte és d'ús intern.
© 2026 FAST >>> PASS – Tots els drets reservats.

---

*Documentació actualitzada el 2026-09-30 (neteja i consolidació: 87 → 22 fitxers `.md`, SAMPLES fora del repo, `bin/` de 38 → 24 scripts).
Per a qualsevol dubte, revisa la documentació tècnica a [`docs/`](docs/).*