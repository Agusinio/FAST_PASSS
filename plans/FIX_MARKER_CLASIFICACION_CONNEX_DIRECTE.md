# Plan: Corregir la clasificación de ítems CONNEX DIRECTE en el marcador estructural

## 1. Resumen del problema

Cuando [`placeStructureMarkers`](js/workflows/flow_assembly.js:800) coloca marcadores de escaleta en el timeline, los ítems estructurales se clasifican por duración. Los ítems con `dSec >= 30` se clasifican como `LARGO`, lo que exige un clip de al menos 15s de duración para el snap.

El ítem [`02dir`](TN_VESPRE_20260426_213005.json:1093) ("CONNEX DIRECTE LÍDIA HEREDIA 1") tiene `durada="0:50"` (50s), pero los clips que componen la conexión en el timeline son cortos (6-14s). Como ninguno cumple `minDur=15`, [`snapToCut`](js/workflows/flow_assembly.js:1029) salta 41s adelante hasta el clip 18, y el error se propaga a todos los marcadores siguientes.

### Síntomas

| Marcador | Ideal | Real | Error |
|----------|-------|------|-------|
| 02dir | 01:01:10 | **01:42:12** | +41s |
| IPD 02 | ~01:01 | **01:57:14** | +56s |
| 03 | ~02:32 | **02:32:12** | (arrastrado) |

## 2. Causa raíz

En la función [`clasificarItem`](js/workflows/flow_assembly.js:1012) :

```javascript
const clasificarItem = (line) => {
    const dSec = getEffectiveDuradaSec(line);
    const num = (line.num || '').toLowerCase();
    if (!line.agrupacio && dSec === 0) return 'GRAFISMO';
    if (!line.agrupacio && dSec > 0) return 'NO_VERTICALIZABLE';
    if (num.indexOf('lead') !== -1) return 'CORTO';
    if (dSec >= 30) return 'LARGO';       // ← 02dir (50s) cae aquí
    if (dSec >= 5) return 'MEDIO';        // CONNEXIO debería ir aquí
    return 'CORTO';
};
```

El problema es que `dSec >= 30` es la primera condición numérica y captura todos los ítems largos, incluidos los que deberían ser `MEDIO` por su naturaleza (conexiones, donapas, etc.). Los comentarios en el código ya indican que `MEDIO` es para `INSERT, CONNEXIO, DONAPAS`, pero la lógica no refleja esa intención.

## 3. Solución propuesta

### Opción A (Recomendada): Clasificar por tipo de ítem, no solo por duración

Añadir una detección específica para ítems de tipo conexión directa mediante el `num` del ítem. Los ítems con `num` que contenga `"dir"` (connex directe) se clasifican como `MEDIO` independientemente de su duración.

**Ventajas:**
- Respeta la intención original del código (`MEDIO` para CONNEXIO)
- No rompe otros casos LARGO legítimos (BV, reportajes)
- Especificidad alta: solo afecta a conexiones directas

### Opción B: Relajar minDur de LARGO

Reducir `minDur` de LARGO de 15s a 8s.

**Ventajas:** Simple.
**Desventajas:** Podría provocar snaps incorrectos en piezas LARGO legítimas que tengan un clip de 8s cerca (menos preciso).

## 4. Cambios específicos en el código

### Archivo: [`js/workflows/flow_assembly.js`](js/workflows/flow_assembly.js)

#### 4.1 Modificar `clasificarItem` (línea ~1012-1026)

```javascript
const clasificarItem = (line) => {
    const dSec = getEffectiveDuradaSec(line);
    const num = (line.num || '').toLowerCase();
    // Grafismo: agrupacio=null y duración 0
    if (!line.agrupacio && dSec === 0) return 'GRAFISMO';
    // No verticalizable: agrupacio=null y duración > 0 (ROJO)
    if (!line.agrupacio && dSec > 0) return 'NO_VERTICALIZABLE';
    // LEAD: puede ser de cualquier duración, clasificar como CORTO (minDur=0)
    if (num.indexOf('lead') !== -1) return 'CORTO';
    // CONNEX DIRECTE: siempre MEDIO, aunque dure >=30s
    // Los clips de una conexión son cortos (6-14s) y no deben requerir minDur=15
    if (num.indexOf('dir') !== -1) return 'MEDIO';
    // DONAPAS: también MEDIO (transiciones cortas)
    if (num.indexOf('dp') !== -1) return 'MEDIO';
    // Verticalizable: determinar categoría por duración
    if (dSec >= 30) return 'LARGO';       // ≥30s: INTRO, DIFERIT, BV, reportajes
    if (dSec >= 5) return 'MEDIO';        // ≥5s y <30s: INSERT, CONNEXIO, DONAPAS
    return 'CORTO';                       // <5s: VIDEO, IPD
};
```

#### 4.2 Verificar `snapToCut` (línea ~1029-1067)

No requiere cambios. Con la nueva clasificación, `02dir` será `MEDIO` con `minDur=5` y `tolerancia=2.0`, lo que permitirá que encaje en el clip adecuado.

**Simulación del nuevo comportamiento para 02dir:**

| Clip | start | dur | ¿Cumple minDur=5? |
|------|-------|-----|:---:|
| 13 | 60.40 | **6.80** | ✅ Primer clip que cumple |
| → | **60.40s** | = **00:01:00:10** | ¡Coincide con el ideal! |

Con `idealPos=61.40s` y `tolerancia=2.0`, el primer clip que cumple `corte >= 61.40-2.0 = 59.40` Y `dur >= 5` es el **clip 13** (start=60.40s, dur=6.80s). Esto sitúa el marcador en **00:01:00:10**, muy cerca del ideal **00:01:01:10**.

#### 4.3 Considerar también `num.indexOf('connex')` como alternativa

Si en el futuro los ítems de conexión usan otra nomenclatura, se podría añadir también:

```javascript
const titol = (line.titol || '').toLowerCase();
if (titol.indexOf('connex') !== -1 || titol.indexOf('directe') !== -1) return 'MEDIO';
```

Pero la detección por `num` es más fiable y específica.

## 5. Árbol de decisión final (tras el cambio)

```
                           ┌─ GRAFISMO (agrupacio=null, dSec=0)
                           ├─ NO_VERTICALIZABLE (agrupacio=null, dSec>0)
          ┌─ Por campo ────├─ CORTO (num contiene "lead")
          │                ├─ MEDIO (num contiene "dir")
          │                └─ MEDIO (num contiene "dp")
Ítem ─────┤
          │                ┌─ dSec >= 30 → LARGO (minDur=15, tolerancia=2.0)
          └─ Por duración ─├─ dSec >= 5  → MEDIO (minDur=5, tolerancia=2.0)
                           └─ dSec < 5   → CORTO (minDur=0, tolerancia=1.0)
```

## 6. Casos de prueba

| Ítem | num | durada | Clasif. actual | Clasif. nueva | minDur | Comportamiento |
|------|-----|--------|:---:|:---:|:---:|---------------|
| LEAD ATAC TRUMP | 01lead | 0:28 | CORTO | **CORTO** | 0 | Snap a cualquier clip (sin cambio) |
| Dona pas WASHINGTON | 02dp | 0:32 | LARGO | **MEDIO** | **5** | Snap incluso a clips cortos ✅ |
| CONNEX DIRECTE LÍDIA HEREDIA 1 | 02dir | 0:50 | LARGO | **MEDIO** | **5** | Snap al clip 13 (60.40s) ✅ |
| INVESTIGACIÓ I PERFIL SUPOSAT AUTOR | 03 | 1:45 | LARGO | **LARGO** | 15 | Sin cambio (es un BV real) |
| +++IPD INVESTIGACIÓ++++ | 02 | 0:00 | IPD | **IPD** | - | Sin cambio (se coloca en ronda 2) |

## 7. Riesgos y mitigaciones

| Riesgo | Mitigación |
|--------|------------|
| Que un ítem con "dir" en el num no sea una conexión (falso positivo) | En la escaleta, los ítems con num que contiene "dir" son siempre conexiones directas. Bajo riesgo. |
| Que un donapas (dp) muy largo necesite realmente LARGO | Los donapas son siempre transiciones cortas en el timeline; su duración en escaleta incluye el tiempo de la pieza que presentan. |
| Que la condición `num.indexOf('dp')` no cubra todos los casos | Por ahora, todos los donapas usan sufijo "dp". Si aparecen nuevos formatos, se añadirían. |

## 8. Resumen de tareas para implementación

1. Localizar la función `clasificarItem` en [`js/workflows/flow_assembly.js`](js/workflows/flow_assembly.js) (~línea 1012)
2. Añadir las dos condiciones `num.indexOf('dir')` y `num.indexOf('dp')` **antes** de la condición `dSec >= 30`
3. Probar con la escaleta actual (`TN_VESPRE_20260426_213005.json`) y verificar que 02dir aparece en ~60.40s
4. Probar con otras escaletas que tengan conexiones directas para verificar que no se rompe nada
