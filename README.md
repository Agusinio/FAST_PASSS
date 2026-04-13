# FAST >>> PASS – Extensió per Adobe Premiere Pro

**Versió:** 2.9.5 (TACTICAL)  
**Estat:** Estable · Producció

---

## 📋 Descripció

FAST >>> PASS és una extensió d'Adobe Premiere Pro que automatitza el flux de treball d'edició per a programes de televisió, des de la ingesta de material fins a l'exportació final, passant per tall, grafismes i subtítols.

L'extensió implementa una arquitectura de **5 capes** que separa responsabilitats i garanteix robustesa, reutilització i mantenibilitat.

---

## 🗂️ Estructura del projecte (organització actual)

### **Arrel del projecte** – Informació essencial i punt d'entrada

| Fitxer/Directori | Propòsit |
|------------------|----------|
| `README.md` | Aquest fitxer. Guia d'inici i visió general. |
| `ARCHITECTURE_MAP.md` | Mapa d'arquitectura de 5 capes (v2.6.0). |
| `OPERATIVE_FLOW.md` | Flux operatiu detallat de totes les fases. |
| `index.html` | Interfície principal del panell (UI). |
| `setup.html` | Pàgina de configuració. |
| `style.css` | Estils CSS de la interfície. |
| `package.json` | Configuració del projecte (dependències). |
| `CSXS/` | Configuració de l'extensió CEP (manifest). |
| `js/` | **Codi JavaScript** (lògica d'orquestració). |
| `jsx/` | **Codi ExtendScript** (mòduls atòmics per a Premiere). |

### **Carpetes de documentació i desenvolupament** – Contingut tècnic i d'ajuda

| Carpeta | Contingut |
|---------|-----------|
| `docs/` | Documentació general del projecte. |
| `docs/audits/` | Auditories tècniques (versions anteriors). |
| `docs/INFO/` | Informació auxiliar, guies, workflows, etc. |
| `.dev/` | Fitxers de desenvolupament i configuració interna. |
| `.roo/` | Configuració de l'eina Roo (skill coder‑genius). |
| `.vscode/` | Configuració de Visual Studio Code. |

### **Codi font** – Organització per capes

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
- Extensió instal·lada i activada (veure `CSXS/manifest.xml`).
- Accés al NAS amb l'estructura esperada de fitxers.

### 2. **Execució**
1. Obre Premiere Pro.
2. Carrega el panell **FAST >>> PASS** des de Finestra → Extensions.
3. Selecciona Programa i Bloc.
4. El botó principal canviarà segons l'estat del projecte (**NOU**, **OBRIR**, **ANAR‑HI**, **ACTUALITZAR**).

### 3. **Documentació clau**
- [🗺️ Mapa d'arquitectura](ARCHITECTURE_MAP.md) – Visió de les 5 capes.
- [⚙️ Flux operatiu](OPERATIVE_FLOW.md) – Detall de cada fase.
- [📚 Documentació tècnica](docs/) – Auditories, informes, guies.

### 4. **Desenvolupament**
- Els fitxers de configuració i tasques pendents es troben a `.dev/`.
- La carpeta `docs/INFO/` conté guies específiques (GIT, botonera, inici ràpid).
- Utilitza `npm test` (si s'afegeixen tests) per validar canvis.

---

## 🔧 Manteniment i actualitzacions

- **Versió actual:** 2.9.5 (TACTICAL).
- **Roadmap:** Consulta `OPERATIVE_FLOW.md` per a les millores pendents.
- **Auditories tècniques:** Es guarden a `docs/audits/` per a referència històrica.
- **Tasques pendents:** Es gestionen a `.dev/PENDING_TASKS.md`.

---

## 📄 Llicència

Aquest projecte és d'ús intern.  
© 2026 FAST >>> PASS – Tots els drets reservats.

---

*Documentació generada el 2026‑04‑13.  
Per a qualsevol dubte, revisa la documentació tècnica a `docs/`.*