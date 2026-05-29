# 🤖 FAST >>> PASS — Harness Engineering

> **Centro de Control Multi-Agente** · v1.0.0 · 2026-05-29

---

## 🧭 PUNTO DE ENTRADA

Este documento es la raíz del sistema Harness Engineering para **FAST >>> PASS**.
Todo agente (Roo, Code, Debug, Architect) debe leer este archivo primero para entender:

1. **Quién es quién** — los agentes disponibles y sus roles
2. **Qué está pasando** — features.json con bugs y features activos
3. **Cómo va el día** — progress/ con el tracking de sesiones
4. **Dónde está todo** — el mapa de la documentación unificada

---

## 👥 ARQUITECTURA MULTI-AGENTE

```
┌─────────────────────────────────────────────────┐
│                 🎯 ORCHESTRATOR                   │
│  (Modo Orchestrator)                              │
│  Divide tareas complejas, coordina agentes,       │
│  mantiene el TODO global alineado                 │
└────────┬──────────────┬──────────────┬───────────┘
         │              │              │
         ▼              ▼              ▼
┌─────────────┐ ┌─────────────┐ ┌─────────────┐
│ 🏗️ ARCHITECT│ │  💻 CODER   │ │ 🪲 DEBUGGER  │
│ (Architect) │ │  (Code)     │ │  (Debug)     │
│ Planifica   │ │  Implementa │ │  Diagnostica │
│ Diseña      │ │  Refactoriza│ │  Investiga   │
│ Especifica  │ │  Corrige    │ │  Repara      │
└─────────────┘ └─────────────┘ └─────────────┘
         │              │              │
         └──────────────┼──────────────┘
                        │
                        ▼
              ┌─────────────────┐
              │  ✅ REVIEWER     │
              │  (Modo Ask)      │
              │  Verifica cambios│
              │  Revisa commits  │
              │  Valida docs     │
              └─────────────────┘
```

### 🎯 Orchestrator
- **Responsabilidad**: Dividir tareas grandes en subtareas, asignar al agente correcto, mantener coherencia global
- **Cuándo usar**: Tareas multi-paso, reestructuraciones, nuevas features complejas
- **Archivos clave**: [`features.json`](.roo/features.json), [`progress/`](.roo/progress/)

### 🏗️ Architect
- **Responsabilidad**: Planificar, diseñar, especificar antes de tocar código
- **Cuándo usar**: Antes de cualquier cambio no trivial
- **Archivos clave**: [`docs/specs/`](../docs/specs/), [`docs/plans/`](../docs/plans/)

### 💻 Coder
- **Responsabilidad**: Implementar código siguiendo las reglas de la skill [`coder-genius`](.roo/skills/coder-genius/SKILL.md)
- **Cuándo usar**: Implementación de fixes, features, refactors
- **Archivos clave**: [`js/`](../js/), [`jsx/`](../jsx/)

### 🪲 Debugger
- **Responsabilidad**: Diagnosticar problemas, investigar bugs, añadir logs estratégicos
- **Cuándo usar**: Cuando algo falla y no se sabe por qué
- **Archivos clave**: [`docs/debug/`](../docs/debug/)

### ✅ Reviewer
- **Responsabilidad**: Verificar cambios antes de commit, revisar documentación
- **Cuándo usar**: Después de cada implementación, antes de git commit
- **Archivos clave**: [`plans/HANDOFF_*.md`](../plans/)

---

## 🔄 FLUJO DE TRABAJO ESTÁNDAR

```
INIT ──► DISCOVERY ──► CONTEXT ──► IMPLEMENTATION ──► VERIFICATION
 │           │             │              │                 │
 │     init.ps1       leer docs     arquitecto         coder + debugger
 │     validar        analizar      planificar         implementar
 │     entorno        código        diseñar            fixear
 │                                                         │
 └─────────────────────────────────────────────────────────┘
                    REVIEWER: validar → commit
```

### 1. INIT — [`init.ps1`](.roo/init.ps1)
Valida que el entorno de desarrollo está listo:
- Git portable en `E:\PortableGit`
- Acceso a rutas de red (NAS)
- PowerShell ≥ 5.1
- Skills cargadas correctamente

### 2. DISCOVERY
El agente lee:
1. Este [`agents.md`](.roo/agents.md) — para entender la arquitectura
2. [`features.json`](.roo/features.json) — para saber qué está activo
3. [`progress/`](.roo/progress/) — para ver el historial reciente
4. [`docs/guides/ARCHITECTURE_MAP.md`](../docs/guides/ARCHITECTURE_MAP.md) — para entender el código

### 3. CONTEXT ANALYSIS
El agente analiza el problema/feature y produce:
- **Architect**: Plan detallado en [`docs/plans/`](../docs/plans/)
- **Debugger**: Diagnóstico en [`docs/debug/`](../docs/debug/)

### 4. IMPLEMENTATION
El Coder ejecuta siguiendo las reglas de:
- [`coder-genius`](.roo/skills/coder-genius/SKILL.md) — 5 Tiers, Brain vs Muscle, no new JSX
- [`powershell`](.roo/skills/powershell/SKILL.md) — PowerShell correcto en Windows

### 5. VERIFICATION
El Reviewer:
1. Revisa los cambios con `git diff`
2. Actualiza [`features.json`](.roo/features.json)
3. Actualiza [`progress/`](.roo/progress/) con el HANDOFF del día
4. Si todo OK → git commit

---

## 📋 REGISTROS VIVOS

| Archivo | Propósito | Actualización |
|---------|-----------|---------------|
| [`features.json`](.roo/features.json) | Bugs y features activos | Cada cambio de estado |
| [`progress/YYYY-MM-DD.md`](.roo/progress/) | Tracking diario de sesión | Cada día de trabajo |
| [`plans/HANDOFF_*.md`](../plans/) | Handoff entre sesiones | Al final de cada sesión |

---

## 🛠️ HERRAMIENTAS DIARIAS

### Arranque
```powershell
.\roo\init.ps1
```

### Formateo de escaletas (cada mañana)
```powershell
.\bin\check_and_fmt.ps1
```

### Git (portable)
```cmd
"E:\PortableGit\bin\git.exe" -C "c:\Users\gonz_agu\AppData\Roaming\Adobe\CEP\extensions\FAST_PASSS" status
```

---

## 🗺️ MAPA RÁPIDO DE DOCS

| Qué buscas | Dónde está |
|-----------|-----------|
| Arquitectura del código | [`docs/guides/ARCHITECTURE_MAP.md`](../docs/guides/ARCHITECTURE_MAP.md) |
| Guía de usuario | [`docs/guides/USER_GUIDE.md`](../docs/guides/USER_GUIDE.md) |
| Guía de botonera | [`docs/guides/GUIA_BOTONERA.md`](../docs/guides/GUIA_BOTONERA.md) |
| Desarrollo | [`docs/guides/DEVELOPMENT.md`](../docs/guides/DEVELOPMENT.md) |
| Git workflow | [`docs/guides/GIT_WORKFLOW.md`](../docs/guides/GIT_WORKFLOW.md) |
| Especificaciones técnicas | [`docs/specs/`](../docs/specs/) |
| Planes activos | [`docs/plans/`](../docs/plans/) |
| Debugging | [`docs/debug/`](../docs/debug/) |
| Auditorías | [`docs/audits/`](../docs/audits/) |
| Código obsoleto | [`docs/archive/CODIGO_OBSOLETO.md`](../docs/archive/CODIGO_OBSOLETO.md) |
| Handoffs diarios | [`plans/`](../plans/) |

---

## ⚠️ REGLAS DE ORO

1. **🧬 JSX está CERRADO** — No crear nuevos métodos JSX. Componer desde JavaScript.
2. **🧠 Brain vs Muscle** — Lógica en JS, átomos en JSX. Nunca al revés.
3. **📐 5 Tiers** — Respetar la jerarquía Workflow → Logic → Inspectors → Core → JSX.
4. **📝 No git sin verificar** — Nunca commitear sin que el usuario haya testeado en Premiere.
5. **🗑️ No acumular** — Si se elimina algo, que desaparezca del todo (no comentarlo, no archivarlo en `_OLD`).

---

*FAST >>> PASS — Harness Engineering v1.0.0 · 2026-05-29*
