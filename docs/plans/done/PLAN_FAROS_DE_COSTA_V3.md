# Plan: Faros de Costa V3 — Greedy Bidireccional L→R + R→L

## 1. Diagnóstico

### 1.1 Problema raíz

El **scoring topológico** ([`snapToCut()`](../../js/workflows/flow_assembly.js:903)) detecta **rupturas de densidad** = **finales** de bloques largos. DP y DIR necesitan el **INICIO** de sus bloques.

- `05dp` ideal≈ -15s → snap topológico a 55.12s (el FINAL del bloque DP, no el inicio)
- `05dir` ideal≈ 30s → REGLA CERO a 0.00s (porque 55.12s ya está ocupado)

**Solución**: DP+DIR deben usar [`snapToCutFaro()`](../../js/workflows/flow_assembly.js:1102) (snap simple, sin topología).

### 1.2 Principios

1. Faros primero (snap simple); son anclas inamovibles
2. Orden timeline = orden escaleta (realineación final)
3. Siempre en cortes reales, nunca TC 00:00, nunca mismo corte, ≥3s separación
4. DP+DIR par inseparable, DP antes que DIR, ≥3s gap

## 2. Estrategia V3: Greedy Bidireccional

### 2.1 Algoritmo

```
FASE 1a: COLOCAR FAROS (sin cambios)
  └─ snapToCutFaro → snap simple al corte más cercano

FASE 1b: ENCAJAR APROXIMADOS POR SEGMENTOS
  1. Agrupar aproximados en segmentos entre faros consecutivos
     Segmento 0: [inicioTimeline, faro[0] - 3s]
     Segmento i: [faro[i-1] + 3s, faro[i] - 3s]  
     Segmento N: [faro[N-1] + 3s, finTimeline]

  2. Para cada segmento:
     a. Detectar pares DP+DIR por numeración
     b. Greedy L→R:
        - Cada ítem: rangeMin = ítem_anterior + 3s, rangeMax = faro_derecho - 3s
        - DP+DIR → snapToCutFaro (snap simple, sin topología)
        - Otros → snapToCut (con scoring topológico)
        - Sin corte libre → expandir rango gradualmente (nunca TC 00:00)
     c. Greedy R→L (misma lógica en reversa)
     d. Comparar L→R vs R→L:
        - Si todos los ítems coinciden (Δ < 3s) → ✅ consistente, usar L→R
        - Si algún ítem diverge → ⚠️ log warning con detalle, usar L→R
        - Si divergencia > 10s → ❌ log error, preferir resultado con menor Δ total

  3. Realinear structuralItemPositions con orden de escaleta (sin cambios)
```

### 2.2 Por qué bidireccional

| Ventaja | Explicación |
|---------|-------------|
| Consistencia | Si L→R y R→L coinciden, el resultado es robusto |
| Diagnóstico | Si divergen, el log muestra exactamente qué ítems son problemáticos |
| No duplica marcadores | Solo se colocan una vez (se usa el resultado L→R) |
| Coste mínimo | 2 × O(N×C) ≈ O(N×C), insignificante para N≤10, C≤100 |

### 2.3 DP+DIR sin scoring topológico

DP y DIR usan [`snapToCutFaro()`](../../js/workflows/flow_assembly.js:1102) porque marcan el **inicio** del bloque, no la ruptura de densidad al final. El resto de aproximados siguen usando [`snapToCut()`](../../js/workflows/flow_assembly.js:903) con scoring topológico.

### 2.4 Expansión gradual de rango

Si un ítem no encuentra corte libre en [rangeMin, rangeMax]:
1. Expandir rangeMax en pasos de 10s (máx 60s)
2. Reducir rangeMin en pasos de 10s (máx hasta inicio del segmento)
3. REGLA CERO global (corte más cercano en todo el timeline)
4. **Nunca TC 00:00**

## 3. Cambios en código

### Archivo: [`js/workflows/flow_assembly.js`](../../js/workflows/flow_assembly.js)

**Reemplazar FASE 1b completa** (líneas 1231-1459).

Nuevas funciones helper dentro del scope:

- `agruparAproximadosEnSegmentos(aproximadosItems, farosSnapped, clipCuts)` → `[{ items, rangeMin, rangeMax }]`
- `greedySnapshot(items, clipCuts, clips, densityData, occupiedCutIndices, occupiedTimes, rangeMin, rangeMax, direccion)` → `[{ line, snappedPosSec, idx }]`
- `compararDirecciones(resultadoLR, resultadoRL)` → `{ consistente, divergencias }`

## 4. Verificación

| # | Principio | Garantía |
|---|-----------|----------|
| 1 | Orden timeline = orden escaleta | Realineación final |
| 2 | Siempre en cortes | snapToCut/snapToCutFaro + REGLA CERO + expansión |
| 3 | Nunca mismo corte | occupiedCutIndices + hasMinSeparation(≥3s) |
| 4 | Nunca TC 00:00 | Expansión gradual antes de fallback |
| 5 | DP+DIR inseparable | Detección por numeración + snapToCutFaro para ambos + constraints |
| 6 | Consistencia validada | Comparación L→R vs R→L |
