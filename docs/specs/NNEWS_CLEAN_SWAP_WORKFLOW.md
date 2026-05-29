# Plan: NNews "Clean-Swap" Workflow (Round-trip) - Opción A (Final)
> Estado: **INVESTIGACIÓN DE FORMATO NATIVO (.nnp) EN CURSO**

## 1. Objetivo
Implementar un proceso automatizado de un solo clic para sustituir clips con gráficos quemados en Premiere por versiones limpias renderizadas en tiempo real desde el motor de Natural News (NNews), garantizando fidelidad visual absoluta (color/filtros) sin intervención manual.

## 2. Flujo de Trabajo Técnico Detallado

### Fase 1: Identificación y Mapeo
1.  **Extracción de Selección**: Mediante `app.project.activeSequence.getSelection()`, obtenemos un array de `trackItem`.
2.  **Búsqueda de ID**:
    *   Prioridad 1: Buscar en el `metadata` del clip el `assetId` de NNews.
    *   Prioridad 2: Regex sobre el nombre del clip en el Bin (`50[0-9]{6}`).
3.  **Localización del Proyecto**: Buscar el archivo `.nnp` (nativo) en las rutas de red. 

### Fase 2: Análisis del Proyecto (Nativo vs. Respaldo)
Para eliminar el "factor humano" de exportar manualmente un `.nzp`:
1.  **Parsing Directo de `.nnp`**: Investigar la estructura binaria del archivo maestro. 
    *   *Hallazgo preliminar*: El cabecero contiene metadatos en texto claro (`PROJECTNAME`, `SAVEFOLDERID`) y rutas UNC. Los tiempos (In/Out/Duración) se almacenan en bloques binarios (ej: `07 8f` para una duración de 1935 frames).
2.  **Cotejo de Datos (Piedra Rosetta)**: Usar archivos `.xml` existentes para mapear la estructura binaria del `.nnp` y crear un parser robusto que extraiga:
    *   Listado de brutos utilizados.
    *   Puntos de entrada/salida de cada clip en la secuencia original.
3.  **Fallback**: Si el parseo del `.nnp` falla, solicitar al usuario el archivo `.nzp` de respaldo.

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

### Fase 4: El "Gold Standard" (Procesamiento por Bloques)
Para maximizar la eficiencia en el verticalizado:
1.  **Copia de Seguridad Local**: Antes de procesar, la extensión copiará el archivo `.nnp` original de la red al directorio local del proyecto Premiere (`NNews_Cache/`). Esto asegura velocidad y evita bloqueos en red.
2.  **Verificación de "Footprints"**: Durante el parseo, se comparará la duración y la posición de los talls (cortes) entre la selección de Premiere y el proyecto de NNews. Si no coinciden, se avisará al usuario de una posible discrepancia de montaje.
3.  **FFmpeg Batch**: Generación de una lista de concatenación única para todos los clips contiguos.
4.  **Colocación en V3 (Verificación)**: En lugar de sustituir directamente, los clips renderizados se colocarán inicialmente en la pista **V3** (sobre los originales) para que el usuario pueda validar visualmente que el render es correcto antes de consolidar el montaje.

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
