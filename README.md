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
| `docs/guides/` | Guies: arquitectura, usuari, botonera, desenvolupament, Git. |
| `docs/specs/` | Especificacions tècniques: escaleta JSON, markers, NNEWS, classificació. |
| `docs/audits/` | Auditories tècniques històriques (v2.4.2 → v2.9.5). |
| `docs/plans/` | Plans d'implementació actius i completats (`done/`). |
| `docs/debug/` | Informes de debugging i diagnòstic. |
| `docs/reference/` | Material de referència: keyframes, temps onAir. |
| `docs/archive/` | Codi obsolet, estructures històriques. |
| `docs/SAMPLES/` | Mostres de codi SDK oficial, snippets, fitxers NNEWS. |

### **Centre de control** — `.roo/`

| Fitxer | Propòsit |
|--------|----------|
| `.roo/agents.md` | Arquitectura multi-agent i punt d'entrada. |
| `.roo/features.json` | Catàleg de features i bugs (registre viu). |
| `.roo/init.ps1` | Script de validació d'entorn de desenvolupament. |
| `.roo/progress/` | Tracking de sessions de treball. |
| `.roo/skills/` | Skills especialitzades (coder-genius, fmt-escaletes, powershell, debug, git). |

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
- Git portable a `F:\PortableGit` (per desenvolupament; la lletra d'unitat del USB pot variar).

### 2. **Execució**
1. Obre Premiere Pro.
2. Carrega el panell **FAST >>> PASS** des de Finestra → Extensions.
3. Selecciona Programa i Bloc.
4. El botó principal canviarà segons l'estat del projecte (**NOU**, **OBRIR**, **ANAR‑HI**, **ACTUALITZAR**).

### 3. **Documentació clau**
- [🗺️ Mapa d'arquitectura](docs/guides/ARCHITECTURE_MAP.md) — Visió de les 5 capes.
- [⚙️ Flux operatiu](docs/guides/OPERATIVE_FLOW.md) — Detall de cada fase.
- [📖 Guia d'usuari](docs/guides/USER_GUIDE.md) — Manual d'ús del panell.
- [🕹️ Guia de botonera](docs/guides/GUIA_BOTONERA.md) — Funcionalitats de cada botó.
- [🛠️ Guia de desenvolupament](docs/guides/DEVELOPMENT.md) — Convencions i flux de treball.
- [ Documentació tècnica](docs/) — Auditories, especificacions, plans.

### 4. **Desenvolupament**
- El centre de control multi-agent és a [`.roo/`](.roo/) — consulta [`agents.md`](.roo/agents.md).
- Les skills especialitzades són a [`.roo/skills/`](.roo/skills/).
- Scripts d'automatització a [`bin/`](bin/).
- Valida l'entorn amb: `powershell -NoProfile -ExecutionPolicy Bypass -File ".\.roo\init.ps1"`

---

## 🔧 Manteniment i actualitzacions

- **Versió actual:** 2.9.5 (TACTICAL).
- **Roadmap:** Consulta [`docs/guides/OPERATIVE_FLOW.md`](docs/guides/OPERATIVE_FLOW.md) per a les millores pendents.
- **Auditories tècniques:** Es guarden a [`docs/audits/`](docs/audits/) per a referència històrica.
- **Bugs i features:** Registre viu a [`.roo/features.json`](.roo/features.json).
- **Tracking de sessions:** [`plans/HANDOFF_*.md`](plans/) i [`.roo/progress/`](.roo/progress/).

---

## 📄 Llicència

Aquest projecte és d'ús intern.
© 2026 FAST >>> PASS – Tots els drets reservats.

---

*Documentació actualitzada el 2026-05-29 (reestructuració Harness Engineering).
Per a qualsevol dubte, revisa la documentació tècnica a [`docs/`](docs/).*