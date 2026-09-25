# PLAN · Marcadores por CAPAS (de más fiable a menos)

> 2026-09-24 · Acordado con el usuario. Objetivo: colocar los marcadores **por fiabilidad
> decreciente**, de modo que la capa menos fiable use las más fiables **como guía** y **nunca**
> pueda modificar las capas superiores.

## Principios
1. **Orden y separación (≥3 s) son invariantes** que se respetan en *cada* capa al insertar.
2. **Nadie modifica hacia arriba**: capa N no toca capa N-1 (ni el 00:00 ni los OnAir).
3. **Datos transversales** disponibles para todas las capas y para los bounds:
   - **Silencios** de audio (`.bin` a 480 peaks/s, 1 byte = 1 peak): ventana 100 ms, umbral ~12/255,
     mínimo 0,4 s. **Mandann sobre los cortes** (hay muchos menos y son más definitorios).
   - **Frecuencia de cortes (densidad, `_calcDensityFootprint`)**: **se CALCULA EN LA CAPA 1** y se
     usa en **TODAS** las capas para comparar con los datos duros, los silencios y los cortes.
   - **Cortes reales de V1** (clips del timeline, ya afinados por el usuario).
   - **Δ de correlación**: se **mide en la capa 1** (dónde cayó el marcador duro vs dónde quedó el
     definitivo) y **se aplica dentro** de cada capa siguiente. No es un paso suelto (F3.5 integrado).

## Capas
| Capa | Nombre | Datos | Puede tocar |
|---|---|---|---|
| **0** | Setup + 00:00 | `ensureExtractedRef` (solo lectura), `loadAssemblyContext`, `_classifyItems`, clasificación | solo coloca el **00:00** (inmutable) |
| **1** | **OnAir DURO** | OnAir + **silencio** + **corte cerca del silencio** | nada (define la referencia) |
| **1.4** | **CONGELADOS** | los marcadores de la capa 1 quedan **congelados** | solo el usuario (ajuste manual) |
| **1.5** | **OnAir DEDUCIDO de otros OnAir** | cadena OnAir vecino + duración, silencios, cortes, Δ | no puede tocar 0/1/1.4 |
| **2** | **DEDUCIDOS** (prevista+durada) | vecinos ya colocados, **silencios**, **densidad de cortes**, Δ | no puede tocar 0/1/1.4/1.5 |
| **3** | **SIN HORA + GRÁFICOS** | anclaje por duraciones (largos ≥12 s / medios 3-12 s) **+ silencios** + frecuencia de cortes + padre (prefijo exacto) | no puede tocar capas anteriores |
| **4** | **VERIFICACIÓN** | orden de escaleta + GAP | **no mueve nada**, solo comprueba y avisa |

## Consenso en la CAPA 1 (OnAir duro) — orden acordado
1. **Primero el silencio**: buscar el silencio más cercano al OnAir (±3 s).
2. **Luego un corte cerca de ese silencio** (±1,0 s): si existe → **frontera de contenido
   confirmada**: imantar al **corte** (frame exacto) y registrar `✅ consens: silenci+corte`.
3. Si hay silencio pero **no** corte cerca → imantar al **final del silencio** (donde arranca el
   contenido real).
4. Si **no** hay silencio ni corte → se queda en el **OnAir** (aviso `⚠️ sense silenci ni corte`).
5. **Δ de capa 1** = `posición_definitiva − posición_OnAir` (se publica para las capas siguientes).

## Congelados (Paso 1.4) y revisión manual
- **Dentro de la pasada**: tras la capa 1 sus marcadores quedan **congelados**: ninguna capa
  posterior (1.5, 2, 3, 4) los mueve (log `🔒 <num>: congelat → no es mou`).
- **Sin fichero de estado**: el proceso es **automático de principio a fin**; no se persisten
  ajustes entre pasadas (si se repite, se recalcula todo desde cero). *Descartado* el
  `fastpass_frozen_markers.json` que se había propuesto.
- **Revisión y ajuste MANUAL al final** del proceso (decisión de usuario): la automatización se
  encarga de todo y el operador revisa y corrige después. Para facilitar esa revisión:
  1. **Snapshot automático** de los marcadores al terminar (`dumpMarkersSnapshot` → ya existe en
     OUT&GO: `MARCADORS_<fecha>_<hora>.json/.txt` en la carpeta del bloque).
  2. **Log por capa** con la posición y el motivo de cada marcador (`[CAPA1] 01: OnAir 63.00 →
     62.16 ✅ silenci+corte`, `[CAPA1.5] 01dir: cadena OnAir → 29.40`, …) para poder revisar fase a
     fase si algo no cuadra.
  3. Los **botones TEST** del grupo MARCADORS permiten re-ejecutar una capa suelta cuando el
     operador detecta un error concreto.
- Por eso es crítico que el posicionado automático sea **lo más certero posible** (silencios +
  densidad de cortes + cortes reales + Δ medido en la capa 1).

## Clasificación (Paso 0) — categorías
`OnAir` · `OnAir deducido (cadena de OnAir anterior/posterior)` · `Deducido (prevista+durada)` ·
`Sin hora` · `Gráfico` (P2/GF/TE/ft…) · **`Estructural` = todo ítem con duración** (definición del
usuario; a refinar en un post aparte).

## Orden de implementación
1. Transversal `silences()` (mapa de silencios, solo lectura + log `🤫 [SILENCI] …`).
2. Capa 1 + 1.4 (congelados) + Δ de capa 1, con logs por marcador.
3. Capa 1.5.
4. Capa 2.
5. Capa 3 (ya existe PAS 2 + F5 + GF: añadir silencios y frecuencia de cortes como anclas).
6. Capa 4 (verificación: `enforceMarkerOrder` + GAP + integridad) — F4 deja de ser una capa con
   lógica propia y pasa a verificación.

## Notas de arquitectura
- **La capa de marcadores NO escribe el manifest** (ref/IN/OUT): eso es de BOUNDS/EXTRACT
  (ya corregido 2026-09-24; `ensureExtractedRef` es solo lectura).
- Pendiente: `flow_chyrons.js` aún escribe el manifest en 1 punto → eliminarlo para cerrar la
  separación de capas.
