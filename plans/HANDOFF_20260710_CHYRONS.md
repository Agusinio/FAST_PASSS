# HANDOFF: CHYRONS — 10/07/2026

## 🟢 Estado actual

### Botones CHYRONS funcionales (7 botones en grupo CHYRONS)

| Botón | Función | Estado |
|-------|---------|--------|
| **Titol** | Congela frame del Tema‑Titol en V5 con snapshot PNG → importa a CHY → estira hasta siguiente marcador | ✅ **Funciona** (con timecode QE) |
| **Conductor** | Coloca chyrons CONDUCTOR en V6 | ✅ Funciona |
| **Lloc** | Coloca chyrons Lloc/Data en V7 | ✅ Funciona |
| **Nom** | Coloca chyrons NomCarrec en V6 | ✅ Funciona |
| **Traducció** | Coloca traducciones en V3 con distribución uniforme | ✅ Funciona |
| **Resto** | Coloca el resto de chyrons en V6 | ✅ Funciona |
| **Repartir** | Redistribuye traducciones seleccionadas en V3 sobre V1 | ✅ Funciona |

### Flujo `_freezeTemaTitol` (Titol)
1. Inserta Wott Tema‑Titol completo en V5
2. Aísla solo V5 (`Tracks.isolate`)
3. Snapshot via `Render.snapshot` → `9_Render.exportFrameQE` (timecode HH:MM:SS:FF)
4. Restaura visibilidad de pistas
5. Recorta clip animación a 8s desde inicio
6. Mueve PNG desde `C:\temp\` al directorio `Snapshots/` del proyecto
7. Importa PNG al bin **CHY**
8. Inserta PNG estirado desde `cutTime` hasta `stretchEnd` (siguiente marcador)

### Reorganización de workflows
- **`flow_chyrons.js`**: Botones CHYRONS + helpers `_snapToNearestCut`, `_freezeTemaTitol`, `_placeChyronsByType`, `_placeIntroBlockChyrons`, `_placeOffBlockChyrons`
- **`flow_graphics.js`**: Gráficos genéricos (reset, 16:9, fondo, WorkArea)
- **`flow_markers.js`**: F1‑F6 marcadores + análisis (placeCookedMarkers, capturaUsuarioInOut, capturaUsuarioMarks)
- **`flow_retols.js`**: Obsoleto (mantenido por compatibilidad)

### Fix de módulos JSX
- `var FASTPASS = FASTPASS || {};` → `var FASTPASS = $.global.FASTPASS;` en: `9_Render.jsx`, `12_Diagnostic.jsx`, `19_Diagnosi.jsx`, `34_Exportacio.jsx`
- `9_Render.exportFrameQE` ahora convierte segundos a timecode `HH:MM:SS:FF` (25 fps) antes de llamar a `qeSeq.exportFramePNG()`

## 🟡 Pendiente / En progreso

### Botón Titol — Pendiente de ajuste fino
- [ ] El snapshot PNG incluye solo V5 (ya aislado) pero verificar que no capture otros tracks
- [ ] El PNG debería guardarse directamente en el directorio `Snapshots/` del proyecto (sin pasar por `C:\temp\`)
- [ ] La duración del clip congelado debe alargarse hasta el siguiente Tema‑Titol o hasta el final del clip MP4 (no solo hasta el siguiente marcador)

### Limpieza de código sobrante
- [ ] Eliminar `flow_retols.js` (todo movido a `flow_chyrons.js`, `flow_graphics.js`, `flow_markers.js`)
- [ ] `main.jsx` contiene `exportFramePNG` duplicada (la función global ya no se usa — ahora se usa `Render.snapshot`)

### Volcado V1 post-TROSEJA
- [ ] Confirmar que el volcado en `flow_cut.js` es suficiente para diagnosticar
- [ ] Verificar que `_snapToNearestCut` funciona correctamente con el nuevo V1

## 🔵 Próximos pasos sugeridos

1. **Probar botón Titol** con el snapshot ya funcional — verificar que el PNG se genera correctamente, se importa a CHY y se estira hasta el final correcto
2. **Limpiar `flow_retols.js`** y código duplicado en `main.jsx`
3. **Hacer pull de la rama main** tras este push para cargar los nuevos JSX
4. **Verificar los botones** Conductor, Lloc, Nom, Traducció, Resto, Repartir en TNVespre V3

## 📁 Archivos modificados en esta sesión

| Archivo | Cambio |
|---------|--------|
| `index.html` | Botón Repartir en grupo CHYRONS |
| `js/main.js` | Wiring: Retols → Chyrons, placeChyronRepartir → repartirChyronTraduccio |
| `js/workflows/flow_chyrons.js` | Reescrito completo: autoPlacement + 7 botones + helpers |
| `js/workflows/flow_graphics.js` | Movidas funciones de gráficos desde retols + placeCookedMarkers → markers |
| `js/workflows/flow_markers.js` | Movidas funciones de análisis (placeCookedMarkers, capturaUsuario*) |
| `js/workflows/flow_cut.js` | Volcado V1 post-TROSEJA |
| `jsx/main.jsx` | Función global exportFramePNG (fallback) + freezeFrame → QE |
| `jsx/modules/9_Render.jsx` | Fix var FASTPASS + timecode HH:MM:SS:FF para exportFramePNG |
| `jsx/modules/12_Diagnostic.jsx` | Fix var FASTPASS |
| `jsx/modules/19_Diagnosi.jsx` | Fix var FASTPASS |
| `jsx/modules/34_Exportacio.jsx` | Fix var FASTPASS |
| `js/core/11_Configuracio.js` | Track v_trad añadido |
| `Profile.json` | Track v_trad añadido |