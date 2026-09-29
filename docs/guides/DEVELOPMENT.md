# 🛠️ GUIA DE DESENVOLUPAMENT - FAST >>> PASS

Aquest document detalla el flux de treball, els estàndards de codificació i el sistema de versionat per al projecte FAST >>> PASS.

---

## 🚀 FLUX DE TREBALL (GIT WORKFLOW)

El projecte segueix un model de **Feature Branches** per garantir l'estabilitat de la rama `main`.

### 1. Sistema de Rama
- **Rama Principal**: `main`. Sempre ha de contenir codi estable i llest per a producció.
- **Rames de Fix/Feature**: `fix/[NUMERO]-[descripcio]` o `feat/[NUMERO]-[descripcio]`.

### 2. Procés de Commit
S'ha de seguir una estructura de missatges clara:
```text
Fix #[NUMERO]: [Títol del problema]

[Descripció detallada del canvi]

Canvis:
- [Canvi 1]
- [Canvi 2]

Arxius modificats:
- [fitxer1.js]
```

### 3. Comandes Freqüents
```bash
# Crear nova rama de treball
git checkout -b fix/047-descripcio-del-bug

# Guardar canvis
git add .
git commit -m "Fix #047: Títol descriptiu"

# Integrar a main
git checkout main
git merge fix/047-descripcio-del-bug
```

---

## 📏 ESTÀNDARDS DE CODIFICACIÓ

### 1. Nomenclatura (Naming Conventions)
- **Idiomes**: 
    - **Codi (JS/JSX)**: Anglès per a funcions i variables globals (`getWorkSequence`, `createFolder`).
    - **UI/Metadades**: Català per a etiquetes, logs de consola i valors de negoci (`nomTema`, `conductor`).
- **Estil**: `camelCase` per a funcions i variables. `UPPER_CASE` per a constants.

### 2. Arquitectura de Control d'Errors
- Totes les crides de bridge (JS -> JSX) han de retornar un prefix `ERR:` en cas de fallada.
- La funció `FASTPASS_UI.Utils.callJSX` gestiona automàticament aquests prefixos per llançar excepcions controlades.

### 3. Gestió de Rutes UNC (NAS)
- **Capa JS**: Responsable de la sanitització de noms i creació recursiva de carpetes (`ensureFolders`).
- **Capa JSX**: Responsable de l'execució atòmica (`saveAs`, `import`) utilitzant objectes `File` natis de Premiere.

---

## ⏱️ DIAGNÒSTIC D'ARRENCADA LENTA (2026-09-29)

La càrrega inicial del panell (`Context.init` → `checkContext`) pot trigar molt. Per
saber **on** es va el temps hi ha un log de fites: `_boot_timing.log`.

| Què | Com |
|-----|-----|
| Fitxer (carpeta de l'extensió) | `<extensió>\_boot_timing.log` |
| Còpia de seguretat | `C:\temp\_boot_timing.log` |
| Ruta des de JS | `FASTPASS_UI.Boot.logPath()` |
| Obrir el log | `FASTPASS_UI.Boot.openLog()` (ShellExecute; fallback Notepad via `IO.executeShell`) |
| Marcar una fita nova | `FASTPASS_UI.Boot.mark('[ElMeuModul] fase X')` |

**Format**: `+<ms des de l'inici> ms  (Δ<ms des de la marca anterior>)  <etiqueta>`.
`Δ` gran = la fase anterior és la culpable.

**Auto-obertura**: si l'arrencada supera el llindar (per defecte 15 s) el log s'obre
tot sol en acabar (una sola vegada per sessió). Es canvia amb:

```js
FASTPASS_UI.Boot.setAutoOpen(0)      // desactivat
FASTPASS_UI.Boot.setAutoOpen(30000)  // només si passa de 30 s (es guarda a localStorage)
```

**Fites ja instrumentades** (`4_Context.js`): `init · selectors`, `readFolder NAS`,
`escaleta getStatus`, `escaleta local/FOTO`, `scan media+wotts`, `projecte obert+lock (JSX)`,
`semàfor assets (4 crides)`, `semàfor NEW`, `TOTAL`, `syncConductorUI · NAS conductors`.

> Un cop escrit `ARRENCADA COMPLETA`, les marques posteriors (auto-refresc de 60 s) ja no
> s'escriuen al fitxer per no embrutar-lo; només a consola.

**Test de humo** (V8/Edge headless, executa el bloc real amb stubs):
```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File C:\temp\fp_boot_test.ps1
```

---

## 📊 BASELINE I VERSIONS
- **V7.0.1 (Jan 2026)**: Establiment del baseline de seguretat (Fixes crítics de debugger, JSON i rutes).
- **V9.0.0 (Jan 2026)**: Estabilització de la base de producció.
- **V2.9.5 (Current)**: Edició Tàctica (Tactical Overhaul) amb interfície optimitzada i "The Magic" Assembly.

---
© 2026 FAST >>> PASS | Development Guide v1.0
