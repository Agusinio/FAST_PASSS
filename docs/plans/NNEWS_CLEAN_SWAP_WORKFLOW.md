# Plan: NNews "Clean-Swap" Workflow (Round-trip) - Opción A (Final)

## 1. Objetivo
Implementar un proceso automatizado de un solo clic para sustituir clips con gráficos quemados en Premiere por versiones limpias renderizadas en tiempo real desde el motor de Natural News (NNews), garantizando fidelidad visual absoluta (color/filtros) sin intervención manual.

## 2. Flujo de Trabajo Técnico Detallado

### Fase 1: Identificación y Mapeo
1.  **Extracción de Selección**: Mediante `app.project.activeSequence.getSelection()`, obtenemos un array de `trackItem`.
2.  **Búsqueda de ID**:
    *   Prioridad 1: Buscar en el `metadata` del clip (campo personalizado o descripción) el `assetId` de NNews.
    *   Prioridad 2: Regex sobre el nombre del clip en el Bin buscando patrones `50[0-9]{6}`.
3.  **Validación**: Si un clip seleccionado no tiene ID vinculado, se descarta del proceso con un aviso al usuario.

### Fase 2: Análisis de Estructura (Headless)
1.  **Extracción `data.xml`**: Usar `JSZip` para leer el archivo `data.xml` dentro del `.nzp` en red (Acceso Read-Only).
2.  **Mapeo de Timeline**:
    *   Localizar los nodos `<clip>` en el track de vídeo principal del XML.
    *   Calcular el offset entre el TC de inicio del clip en Premiere y el TC de inicio de la secuencia de NNews.
    *   Determinar los puntos de corte (In/Out) relativos a los archivos de media originales.

### Fase 3: Renderizado Limpio con FFmpeg
Para garantizar que el clip limpio sea idéntico al original de NNews pero sin gráficos:
1.  **Estrategia de Concatenación**:
    *   Si el clip de NNews es un solo bruto: Extracción directa de flujo de vídeo (`-ss` y `-t`).
    *   Si el clip de NNews es un montaje de varios brutos: Generar un archivo de texto para `ffmpeg concat demuxer`.
2.  **Comando Proyectado**:
    ```bash
    ffmpeg -f concat -safe 0 -i listado_brutos.txt -ss [IN] -t [DUR] -map 0:v -c:v prores_ks -profile:v 3 -vendor apl0 -pix_fmt yuv422p10le output_clean.mov
    ```
    *   `-map 0:v`: Extrae únicamente el vídeo, ignorando gráficos (que en NNews suelen estar en tracks superiores o capas de overlay).
    *   **Codec**: Apple ProRes 422 (HQ) para mantener transparencia y calidad de master.
3.  **Ubicación**: El render se guarda en la carpeta local de la sesión `_TEMP_RENDERS/` para máxima velocidad de importación posterior.

### Fase 4: Inyección y Sustitución (The Swap)
1.  **Importación**: `app.project.importFiles([path])` para traer el `output_clean.mov` al binario `CLEAN_RENDERS`.
2.  **Sustitución Atómica**:
    ```javascript
    // ExtendScript
    var newMasterItem = findInBin("output_clean.mov");
    selectedClip.replaceWith(newMasterItem, true); // true = mantiene efectos/transiciones
    ```
3.  **Verificación**: Cambiar el color de etiqueta del clip en el timeline (ej: a "Mango" o "Cian") para indicar visualmente que ya es una versión limpia.

---

## 3. Consideraciones de Seguridad y Rendimiento

### Fase 5: Acceso Respetuoso y Seguridad de Red
Para garantizar la integridad del entorno de trabajo compartido y no interferir con otros usuarios de NNews:
1.  **Solo Lectura (Read-Only)**: Todas las operaciones realizadas por la extensión (análisis de XML) y por herramientas externas (FFmpeg) deben abrir **estrictamente en modo solo lectura** tanto los archivos de proyecto (`.nzp`, `.xml`) como **cualquier archivo de media o bruto original** ubicado en los servidores de red.
2.  **Prevención de Bloqueos**: No se permitirá ninguna operación que tome el control exclusivo de un archivo. Si un archivo de media está siendo escrito por otro proceso (ej: una ingesta en curso), el sistema debe esperar o saltar el ítem en lugar de intentar forzar el acceso.
3.  **Aislamiento de Escritura**: Todos los archivos temporales y renders resultantes se escribirán exclusivamente en directorios locales de la estación de trabajo o en carpetas de "Renders" autorizadas, nunca sobreescribiendo material original.

*   **Gestión de Errores**:
    *   Si el `.nzp` está bloqueado por otro proceso: Reintentar con un pequeño delay.
    *   Si falta un bruto original en red: Notificar el path exacto faltante.
*   **Paralelismo**: Si el usuario selecciona 5 clips, se lanzarán 5 procesos de FFmpeg en paralelo (limitado por núcleos de CPU) para minimizar el tiempo de espera.

## 4. Próximos Pasos (Implementación)
1.  [ ] **Módulo `NNewsParser.js`**: Lógica JS para interpretar el XML de NNews.
2.  [ ] **Módulo `FFmpegEngine.js`**: Generador de comandos de renderizado.
3.  [ ] **UI Integration**: Botón "LIMPIAR CLIPS" en el panel FAST >>> PASS.
