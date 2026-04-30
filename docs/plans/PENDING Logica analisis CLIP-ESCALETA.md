# Workflow Detallado: Sincronización Inteligente Escaleta-Timeline

Este documento describe el flujo lógico para la interpretación de JSONs de escaleta imprecisos y su ajuste mediante análisis de densidad de imagen en Adobe Premiere Pro.

---

## FASE 1: Ingesta y Posicionamiento Bruto (Raw Ingest)
*   **Acción:** Importación del clip maestro y colocación en el Timeline.
*   **Lógica de Datos:** Se utiliza el JSON para calcular el punto de inserción inicial.
*   **Estado del Clip:** El clip se inserta con su duración original o una estimación larga. **No se realiza trimado manual en este paso**.
*   **Objetivo:** Establecer la presencia del material en la secuencia para permitir el análisis posterior.

---

## FASE 2: Extracción de Estructura Física (SceneDetect)
*   **Acción:** Ejecución del proceso de detección de cortes (Scene Edit Detection).
*   **Flexibilidad:** El sistema debe ser capaz de leer cortes ya existentes en un proyecto guardado o disparar el proceso mediante un botón dedicado.
*   **Resultado:** Un "Catálogo de Cortes" (Array de Timecodes) que representa cada cambio de cámara o transición real del video.

---

## FASE 3: Análisis de Señal y Marcado de Control (Heurística)
Este es el núcleo inteligente del proceso. En lugar de editar el clip, se "mapea" la intención de la escaleta sobre el video.

### A. Generación del "Footprint" de Densidad
1.  **Cálculo de Frecuencia:** El sistema analiza el Catálogo de Cortes buscando la tasa de cambio de planos por minuto.
2.  **Filtros de Frecuencia:**
    *   **Zonas de Alta Frecuencia:** Identifica bloques de ritmo rápido (típicamente VTRs o piezas editadas).
    *   **Zonas de Baja Frecuencia:** Identifica bloques de ritmo lento (típicamente directos en plató o entrevistas).
3.  **Identificación de Rupturas:** Se buscan los puntos exactos donde el patrón cambia (ej: de baja a alta frecuencia), ya que suelen indicar el inicio de un nuevo ítem de escaleta.

### B. Algoritmo de Encaje Elástico y Marcado de Control
*   **Cruce de Datos:** Se proyectan las líneas del JSON sobre el clip.
*   **Marcadores de Control (In/Out):** El sistema coloca dos marcadores de **COLOR CHILLÓN** (ej: Rojo Neón / Verde Eléctrico) en los puntos que la IA determina como el inicio y fin real del bloque completo.
*   **Marcadores de Ítem:** Se colocan marcadores de secuencia para cada línea de la escaleta, ajustando su posición al corte más cercano que coincida con una variación notable de la densidad de cortes.
*   **Ajuste de Offset:** Se calcula el desfase real comparando el TC del marcador de control con el TC `OnAir` del JSON.

---

## FASE 4: Validación Humana y Calibración (The Correction Loop)
El usuario actúa como supervisor del trabajo realizado por la IA en la Fase 3.

1.  **Revisión Visual:** El usuario observa los marcadores de "Color Chillón" y los marcadores de ítem.
2.  **Ajuste Manual:** El usuario mueve los marcadores a su posición exacta si la detección heurística ha fallado.
3.  **Cierre de Bloque (Trigger de Aprendizaje):** Al pulsar el botón de "Validar Bloque":
    *   Se realiza el trimado efectivo del clip basado en la posición final de los marcadores.
    *   **Dataset Builder:** Se registra el "Estado Máquina" (donde puso la IA los marcadores) vs el "Estado Humano" (donde los dejó el usuario).
    *   Este archivo de log es **acumulativo y único**, diseñado para que, tras decenas de programas, se puedan extraer los valores óptimos de los filtros de paso (paso alto/bajo).

---

## FASE 5: Consolidación y Metadatos
*   **Acción:** Una vez los marcadores son definitivos, se procede al etiquetado final de los ítems de escaleta.
*   **Resultado:** Timeline perfectamente segmentado, con metadatos fiables extraídos de una fuente (JSON) que originalmente no lo era.

---

### Matices de Implementación Técnica
*   **Ventana de Probabilidad:** El algoritmo de encaje elástico usará un radio de búsqueda mayor para ítems "Previstos" y menor para ítems "OnAir".
*   **Prioridad de Corte:** Ante dos cortes cercanos, la IA elegirá aquel que suponga un cambio de estado en la densidad de frecuencia (de estático a dinámico o viceversa).