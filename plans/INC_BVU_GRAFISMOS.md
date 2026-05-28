# INC: Grafismos en clips BVU (Explainers pregrabados)

**Tipo**: Incidencia conceptual / organizativa  
**Estado**: Pendiente de definición con producción  
**Fecha registro**: 2026-05-18  
**Severidad**: Media (no bloquea el montaje, pero impide automatización completa)

---

## Descripción del problema

En determinados bloques, hay clips de video de tipo **BVU** (explainers pregrabados) que contienen
**grafismos incrustados** (rótulos, infografías, overlays). Actualmente:

1. La escaleta JSON indica que el ítem tiene video (`teVideo: true`) pero **no especifica**
   en qué momento del clip aparecen los grafismos ni cuántos son.
2. No hay una pista/archivo auxiliar que indique las posiciones de los grafismos dentro del BVU.
3. El sistema FAST >>> PASS no puede automatizar la colocación de marcadores de grafismo
   para estos clips porque carece de la información necesaria.

## Impacto

- Los marcadores de grafismo en BVUs deben colocarse **manualmente** por el editor.
- No se puede verificar automáticamente que todos los grafismos del BVU estén presentes
  en el timeline.
- El semáforo de Wotts (Bin CHY) no refleja correctamente el estado para estos ítems.

## Posibles vías de solución

### Opción A — Metadatos en la escaleta (preferida)
Que el JSON de escaleta incluya un array `grafismos` por ítem BVU con los TCs relativos
al clip donde aparecen:

```json
{
  "num": "BVU3",
  "titol": "L'explainer econòmic",
  "teVideo": true,
  "grafismos": [
    { "tc": "00:00:02:00", "durada": "00:00:05:00", "tipus": "retol" },
    { "tc": "00:00:15:00", "durada": "00:00:08:00", "tipus": "infografia" }
  ]
}
```

### Opción B — Archivo auxiliar por BVU
Un archivo sidecar (JSON o XML) con el mismo nombre base que el BVU que describa
la timeline de grafismos. Ej: `BVU3_explainer_economic_grafismos.json`.

### Opción C — Convención de nomenclatura en Wotts
Que los archivos de rótulo (Wotts) destinados a BVUs sigan un patrón de nombre que
permita asociarlos automáticamente al ítem correcto. Ej: `Tema-Titol_BVU3_00-00-02-00_retol.mov`.

## Responsables

- **Producción/Redacción**: Definir el formato en que se proporcionará la información
  de grafismos para BVUs.
- **Desarrollo** (tras definición): Implementar el parser y la integración en
  [`escaleta_reader.js`](js/core/escaleta_reader.js) y [`flow_assembly.js`](js/workflows/flow_assembly.js).

## Notas

- Este problema **no es de código** — el sistema funciona correctamente con la información
  disponible. Es una **carencia de datos de entrada** que debe resolverse aguas arriba.
- Mientras no se resuelva, los editores deben colocar manualmente los marcadores de
  grafismo en clips BVU.
