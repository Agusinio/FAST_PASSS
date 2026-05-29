# 📋 FAST >>> PASS — Descripción del Proyecto

**Versión de Lógica**: 6.11.0 (Especificación Funcional - Layout Vertical Compacte)

---

## 1. Arquitectura Técnica Clave

### 1.1. Entorno de ejecución

El panel se ejecuta en un contexto de scripting ES3 (JavaScript de 1999) de Premiere Pro. Todas las funciones de `main.jsx` deben ser compatibles con ES3.

### 1.2. Separación de Lógica (Arquitectura CEP/JSX)

- **CEP (`index.html`)**: Actúa como el "cerebro". Gestiona TODA la lógica compleja, flujos de trabajo, estado de la UI, gestión de eventos, conexiones a BBDD (futuras), parsing de archivos (SRT) y orquestación. Utiliza JavaScript moderno (ES5/ES6).
- **JSX (`main.jsx`)**: Actúa como los "brazos". Contiene SOLO funciones atómicas llamadas por CEP. No contiene lógica de flujo (if/else complejos, bucles, etc.).

### 1.3. Obtención de Metadatos

Es imposible leer de manera fiable `item.mediaDuration` o metadatos XMP de un `ProjectItem` en ES3.

**Solución "Insertar y Medir"**:
1. CEP llama `jsx_clearTrack(7)`
2. CEP llama `jsx_insertClip(7, "nombre_clip", 0.0)`
3. CEP sondea (`pollForClipCount(7, 1)`) hasta que el clip aparece
4. CEP llama `jsx_getClipDurationOnTimeline(7, 0)` para obtener la duración real
5. CEP llama `jsx_clearTrack(7)`
6. CEP recibe la duración y continúa su lógica

---

## 2. Disposición del Layout (v6.11.0)

Panel único vertical con scroll y diseño compacto.

- **SECCIÓN 1: SET UP** — `PROG`, `BLOC`, `NOU`
- **SECCIÓN 2: VIDEO** — `IN`, `SCENE`, `OUT`, `◀`, `MOVE`, `▶`, `KEY`
- **SECCIÓN 3: CHYRONS** — `PLACE CHYRONS`
- **SECCIÓN 4: GRAPH** — `PLACE 16:9`
- **SECCIÓN 5: SRT** — `WORK`, `INICI`, `CUA`, `TIME ADJUST`
- **SECCIÓN 6: RENDER** — `VIDEO`, `PORTADA`

---

## 3. Flujos de Trabajo Principales

### A. Inicialización

1. `initPanel()` se ejecuta al cargar
2. `updateUIState('INIT')` → controles desactivados excepto `PROG`, `BLOC`
3. `loadSelection()` recupera últimas selecciones de `localStorage`
4. `runContextCheck()` verifica proyecto abierto coincidente

### B. Botón `NOU` (Crear)
1. Abrir plantilla `PROJECTE 3CatInfo_NET.prproj`
2. Importar archivos (`.mov`, `.srt`, `.mp4`)
3. Clonar secuencia "OTT VERTICAL"
4. Colocar vídeo V2, título V4
5. Guardar proyecto

### C. Botón `IN`
1. Obtener CTI
2. Ripple trim clip start (V2, A1, A2)
3. Mover clips al tiempo 0.0

### D. Botón `OUT`
1. Obtener CTI
2. Trim clip end (V2, A1, A2)
3. Ajustar In/Out de secuencia
4. Bloquear audio, estirar título V4
5. Activar "Follow Playhead"

### E. Chyrons (`PLACE CHYRONS`)
1. Obtener CTI
2. Si `CTI > 0.1`: insertar conductor en V5
3. Bucle de chyrons: insertar en V5/V6 según tipo

### F. SRT (`WORK`)
1. Bloquear pistas de vídeo
2. Crear pista de subtítulos
3. Parsear y filtrar SRT
4. Crear subtítulos en timeline

### G. Render (`VIDEO`)
1. Ejecutar comando AME Queue (ID 3804)

---

> **Nota**: Este documento describe la arquitectura original del panel. La versión actual (2.9.5+) ha evolucionado significativamente con la arquitectura de 5 tiers documentada en [`ARCHITECTURE_MAP.md`](../guides/ARCHITECTURE_MAP.md).
