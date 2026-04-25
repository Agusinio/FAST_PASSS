# Último Arreglo: Búsqueda de marcador CONEXIÓ + Eliminación de audio fantasma en A1

## Resumen

Dos problemas fueron corregidos en el mecanismo de colocación de wotts (`runGuidedAssembly` → [`_findMarkerForLineID`](js/logic/14_Assembly_Logic.js:261) + [`insert()`](jsx/modules/6_Clips.jsx:114)).

---

## Fix 1: Búsqueda del marcador CONEXIÓ por distancia absoluta

### Síntoma

Los wotts de tipo `ENVIAT`/`PRESENCIAL` pertenecientes a un **Donapas** (`01dp`) debían anclarse al marcador estructural **CONEXIÓ** en lugar de al marcador de sección `01dp`. Sin embargo, el log mostraba:

```
⚠️ DP+Enviat/PRESENCIAL: sense CONNEXIÓ després del DP, usant el de secció
```

Esto significaba que el código **no encontraba** ningún marcador de CONEXIÓ, y como fallback usaba el marcador de sección `01dp`.

### Causa raíz

El algoritmo de búsqueda utilizaba dos filtros incorrectos:

1. **`!/^\d/.test(label)`** — buscaba marcadores cuyo `name` o `comments` NO empezaran con un dígito, asumiendo que los marcadores estructurales (CONEXIÓ) no tendrían prefijo numérico. **Error:** Todos los marcadores del timeline empiezan con un número (ej: `"01 - CONEXIÓ"`, `"01c - CONNEXIO"`). Este filtro **excluía todos los marcadores**, incluido CONEXIÓ.

2. **`m.time >= dpMarker.time`** — asumía que CONEXIÓ siempre estaría **después** del DP en la línea de tiempo. **Error:** En este caso, CONEXIÓ estaba en el segundo `0`, antes del DP (segundo `64.16`).

### Solución aplicada (2 cambios)

**Cambio 1 — Búsqueda por contenido textual** (reemplaza `!/^\d/`):

```javascript
// ANTES (no funcionaba):
.filter(m => {
    var label = (m.comments || m.name || "").toUpperCase();
    return !/^\d/.test(label);
})

// DESPUÉS (funciona):
.filter(m => {
    var label = (m.comments || m.name || "").toUpperCase();
    return label.includes("CONEXIÓ") || label.includes("CONNEXIO");
})
```

**Cambio 2 — Distancia absoluta** (reemplaza `m.time >= dpMarker.time`):

```javascript
// ANTES (no encontraba CONEXIÓ antes del DP):
.filter(m => m.time >= dpMarker.time)

// DESPUÉS (encuentra el más cercano, sin importar dirección):
.sort((a, b) => {
    var distA = Math.abs(a.time - dpTime);
    var distB = Math.abs(b.time - dpTime);
    return distA - distB;
})
// Toma el primero del array ordenado (el más cercano): conexioMarkers[0]
```

### Código final

Ver [`_findMarkerForLineID`](js/logic/14_Assembly_Logic.js:261), bloque `if (isDpEnviatPresencial)`:

```javascript
if (isDpEnviatPresencial) {
    var dpMarker = markers.find(function(m) {
        var label = (m.comments || m.name || "").toUpperCase().trim();
        return label === upperLine || label.startsWith(upperLine + " ") || label.startsWith(upperLine + "\t");
    });
    if (dpMarker) {
        var dpTime = dpMarker.time;
        var conexioMarkers = markers
            .filter(function(m) {
                var label = (m.comments || m.name || "").toUpperCase();
                return label.includes("CONEXIÓ") || label.includes("CONNEXIO");
            })
            .sort(function(a, b) {
                var distA = Math.abs(a.time - dpTime);
                var distB = Math.abs(b.time - dpTime);
                return distA - distB;
            });
        if (conexioMarkers.length > 0) {
            var best = conexioMarkers[0];
            return best; // CONEXIÓ más cercano en distancia absoluta
        }
        return dpMarker; // fallback: marcador de sección
    }
}
```

---

## Fix 2: Eliminación selectiva del audio fantasma en A1

### Síntoma

Al hacer clic en **GRAFIC** para colocar wotts, **todo el audio de la pista A1 fue eliminado**, incluyendo el audio original del programa.

### Causa raíz

La función [`insert()`](jsx/modules/6_Clips.jsx:114) en ExtendScript, tras insertar un clip de vídeo `.mov` (que contiene pista de audio), usaba este código destructivo:

```javascript
// ANTES (eliminaba TODO el audio de A1):
for (var i = audioTrackA1.clips.numItems - 1; i >= 0; i--) {
    var aClip = audioTrackA1.clips[i];
    if (Math.abs(aClip.start.seconds - insertedClip.start.seconds) > 0.1) {
        aClip.remove(true, true); // <-- eliminaba clips QUE NO coincidían!
    }
}
```

Este código **eliminaba todos los clips de A1 cuya posición NO coincidiera** con el vídeo insertado. Es decir, **eliminaba el audio original del programa** y solo dejaba el clip fantasma.

### Solución aplicada

Se invirtió la lógica: ahora solo se elimina el clip que SÍ coincide con la posición del vídeo insertado (el fantasma), y solo se elimina **uno** (el primero que coincide):

```javascript
// DESPUÉS (solo elimina el fantasma):
if (audioTrackA1) {
    for (var i = audioTrackA1.clips.numItems - 1; i >= 0; i--) {
        var aClip = audioTrackA1.clips[i];
        if (Math.abs(aClip.start.seconds - insertedClip.start.seconds) < 0.1) {
            try {
                aClip.remove(true, true);
                // ✅ Solo se elimina el clip fantasma en la posición exacta
            } catch (e2) { }
            break; // solo hay uno, salimos del bucle
        }
    }
}
```

Además, toda la eliminación de audio está condicionada a que el clip insertado **tenga componente de audio** (`audioComp`), evitando ejecutar este código cuando no es necesario.

---

## Archivos modificados

| Archivo | Línea(s) | Cambio |
|---------|----------|--------|
| [`js/logic/14_Assembly_Logic.js`](js/logic/14_Assembly_Logic.js:261) | 261–333 | Búsqueda de CONEXIÓ por texto + distancia absoluta |
| [`jsx/modules/6_Clips.jsx`](jsx/modules/6_Clips.jsx:114) | 190–216 | Eliminación selectiva del audio fantasma en A1 |

---

## Cómo probar

1. Recarga la extensión CEP (reinicia Premiere o recarga el panel)
2. Abre un programa que contenga:
   - Un Donapas (`01dp`) con wotts `ENVIAT` o `PRESENCIAL`
   - Un marcador estructural de CONEXIÓ (en cualquier posición)
3. Haz clic en **GRAFIC**
4. Verifica en el log:
   - `📌 DP+Enviat/PRESENCIAL → marker CONNEXIÓ: "01 - CONEXIÓ..." (a 0.00s, distància XXs del DP)` — debe aparecer
   - `✅ [JSX] Àudio fantasma eliminat de A1 (wott sense so).` — debe aparecer para cada wott con audio
5. Verifica en el timeline:
   - Los wotts ENVIAT/PRESENCIAL del Donapas deben aparecer **alineados con CONEXIÓ**, no con `01dp`
   - **A1 debe conservar su audio original intacto**
