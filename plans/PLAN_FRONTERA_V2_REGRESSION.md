# 🔧 PLAN: Corrección de regresión en V2 (Tier0-IN cronológico)

**Fecha:** 2026-05-19  
**Estado:** 🔴 Pendiente de implementación  
**Archivos afectados:** [`js/core/escaleta_reader.js`](js/core/escaleta_reader.js)

---

## 📋 Problema detectado

Tras implementar el fix de búsqueda cronológica para Tier0-IN (plan FRONTERA_V1_INTRO), TN_VESPRE V2 comenzó a usar el mismo video previo que V1 ("ACTE ILLA-JUNQUERAS", endSec=75757), resultando en un `mp4ExpandedInPoint` incorrecto de 208s (idéntico a V1).

El usuario reporta que antes de los cambios, V2 se cargaba correctamente.

---

## 🔬 Diagnóstico: Causa raíz

### El bug está en la condición `endSec < blockRefSec` (línea 804)

Para V2:
- `blockRefSec` = primera `horaEntradaPrevista` del bloque = `"21:04:03"` → **75843s**
- El último video de V1 (seq 35, "AGÈNCIA TRIBUTÀRIA") tiene:
  - `OnAir="21:03:41"` → startSec=75821
  - `duradaOnAir="0:22"` → durSec=22
  - **endSec = 75843**

| Video candidato | endSec | ¿endSec < 75843? | Resultado |
|---|---|---|---|
| seq 29 ("ACTE ILLA-JUNQUERAS") | 75757 | ✅ Sí | Candidato |
| seq 35 ("AGÈNCIA TRIBUTÀRIA") | **75843** | ❌ No (igualdad) | **Excluido** |

El algoritmo selecciona seq 29 con gap=86s. Como V2 tiene `hasNonVideoIntro=true` (gap<120), Tier0-IN se acepta incorrectamente → `worldBlockStartSec=75757` (mismo que V1).

### ¿Por qué funcionaba antes?

La búsqueda original por índice escaneaba desde `blockStartIdx-1` (índice 34):
- Índice 34: "Off" (teVideo=false) → skip
- Índice 33: "P2petita" (teVideo=true, OnAir=null) → skip  
- ...eventualmente índice 28: seq 29 → gap=86s > 15s → **rechazado**
- Caía a **Tier1-IN** → 75843s (correcto)

El gap fijo de 15s impedía que Tier0-IN aceptara un video tan lejano.

---

## 🎯 Solución propuesta

### Cambio único: `endSec < blockRefSec` → `endSec <= blockRefSec`

**Línea 804** de [`js/core/escaleta_reader.js`](js/core/escaleta_reader.js):

```diff
- if (vid.endSec < blockRefSec) {
+ if (vid.endSec <= blockRefSec) {
```

### Verificación de casos:

| Bloque | blockRefSec | Predecesor real | endSec | Condición `<=` | Gap | ¿Aceptado? | Resultado |
|---|---|---|---|---|---|---|---|
| **V1** | 75821 | seq 29 | 75757 | 75757 ≤ 75821 ✅ | 64s | Sí (<120) | ✅ 75757 |
| **V2** | 75843 | seq 35 (V1) | 75843 | 75843 ≤ 75843 ✅ | 0s | Sí (<120) | ✅ 75843 |
| **V2** (seq 29) | 75843 | — | 75757 | 75757 ≤ 75843 ✅ pero seq 35 tiene endSec mayor | — | — | ❌ Descartado por seq 35 |

### Análisis de seguridad: ¿Puede `<=` causar que un bloque encuentre su PROPIO video?

Un video del propio bloque solo sería candidato si su `endSec ≤ blockRefSec`. Como `blockRefSec` es la `horaEntradaPrevista` del **primer** ítem del bloque y los videos del bloque tienen OnAir ≥ esa hora, su `endSec` siempre será ≥ `blockRefSec`. El caso `endSec == blockRefSec` solo ocurriría si un video empieza y termina instantáneamente (duradaOnAir=0), lo cual no sucede en la práctica.

**Conclusión:** no hay riesgo de auto-match.

---

## 📋 Tareas

| # | Tarea | Archivo |
|---|-------|---------|
| 1 | Cambiar `endSec < blockRefSec` por `endSec <= blockRefSec` en Tier0-IN | [`js/core/escaleta_reader.js`](js/core/escaleta_reader.js):804 |

---

## 🧪 Plan de pruebas

- [ ] **TN_VESPRE V1**: `worldBlockStartSec = 75757s` (gap=64s con conductor intro)
- [ ] **TN_VESPRE V2**: `worldBlockStartSec = 75843s` (gap=0s, contiguous con V1)
- [ ] **TN_COMARQUES V1**: verificar que sigue funcionando igual
