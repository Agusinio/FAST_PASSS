# Marcadores de Estructura — Referencia de Colores

## Mapa `setColorByIndex` de Premiere Pro (verificado visualmente)

| Índice | Color visual | Uso en FAST_PASS |
|--------|-------------|------------------|
| 0 | Verde Caqui | — |
| **1** | 🔴 **Rojo** | Items no verticalizables (`agrupacio==null` y `durada>"0:00"`) |
| 2 | Malva (Rosa) | — |
| 3 | Naranja | — |
| **4** | 🟡 **Amarillo** | Grafismos / títulos superpuestos (`agrupacio==null` y `durada=="0:00"`) |
| 5 | Blanco | — |
| **6** | 🔵 **Azul** | Items generales / verticalizados (`agrupacio!=null`) |
| 7 | Turquesa | — |

## Lógica de asignación (flow_assembly.js)

```javascript
if (line.agrupacio) {
    colorIdx = 6; // AZUL
} else {
    const dStr = line.durada || line.duradaOnAir || "0:00";
    const dSec = parseDurada(dStr);
    colorIdx = dSec === 0 ? 4 : 1; // 4=AMARILLO, 1=ROJO
}
```

## Notas

- La función `setColorByIndex(index)` acepta valores 0–7.
- Valores fuera de rango se clampan: `Math.max(0, Math.min(7, index))`.
- El mapa del enum `MarkerColor` (RED=1, GREEN=0, etc.) **NO coincide** con los índices de `setColorByIndex`. Usar siempre `setColorByIndex` con los índices de esta tabla.
- Verificado en Premiere Pro 23.0 (Abril 2026).
