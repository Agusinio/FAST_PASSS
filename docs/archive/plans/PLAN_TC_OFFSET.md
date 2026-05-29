# Plan: Sistema de Corrección Global de TC (TC_OFFSET)

## 1. Problema
Deriva sistemática de **23 frames (~0.92s a 25fps)** en la ingesta del MP4.
El clip insertado no coincide con el TC esperado de la escaleta.

## 2. Estrategia
No parchear cada punto individualmente. Crear un **parámetro de configuración
global** `tcOffset` que se aplica centralizadamente en todos los cálculos de
TC→timeline.

## 3. Archivos a modificar

### 3.1 `Profile.json` — Añadir `tcOffset`
```json
"general": {
    "autor": "AGUS",
    "guarda": 22,
    "debug": false,
    "tcOffset": 0.92
}
```

### 3.2 `js/core/config.js` — Exponer `tcOffset`
En `Config.get()`, añadir dentro del return:
```javascript
tcOffset: cfg.general.tcOffset || 0
```

### 3.3 `js/core/utils.js` — Helper central
Añadir método:
```javascript
applyTcOffset: function(seconds) {
    const cfg = FASTPASS_UI.Config.get();
    return seconds + (cfg.tcOffset || 0);
}
```

### 3.4 `js/workflows/flow_mainButton.js` — 2 puntos
1. Línea 108: `programInPoint = (targetStartSec - msStartSec) + tcOffset`
2. Línea 210: `fbProgramInPoint = (targetStartSec - fbMsStart) + tcOffset`

### 3.5 `js/workflows/flow_assembly.js` — 5 puntos
1. Línea 420: `precisionBlockStart = (onAirSec - tcRef.mediaStart) + tcRef.offset + tcOffset`
2. Línea 655: `idealSeqPos = (onAirSec - tcRef.mediaStart) + tcRef.offset + tcOffset`
3. Línea 760: `markerPos = (onAirSec - tcRef.mediaStart) + tcRef.offset + tcOffset`
4. Línea 806: `markerPos = (onAirSec - tcRef.mediaStart) + tcRef.offset + tcOffset`
5. Línea 1689: `markerPos = (onAirSec - tcRef.mediaStart) + tcRef.offset + tcOffset`

## 4. Orden de implementación
1. `Profile.json` — añadir campo
2. `config.js` — exponer `tcOffset`
3. `utils.js` — helper `applyTcOffset()`
4. `flow_mainButton.js` — aplicar en 2 puntos
5. `flow_assembly.js` — aplicar en 5 puntos
