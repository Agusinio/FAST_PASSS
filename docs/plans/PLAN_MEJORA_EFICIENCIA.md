# Plan de Ataque: Mejora de Eficiencia en FAST >>> PASS

Este documento detalla la hoja de ruta para optimizar el rendimiento del sistema de ensamblaje automático, eliminando cuellos de botella y mejorando la gestión de datos.

## 1. Jerarquía de Datos y Persistencia (Tu Idea del Punto 6)

### El Concepto
En lugar de recalcular las relaciones entre ítems (quién es padre de quién, qué IPD pertenece a qué conexión) cada vez que se pulsa un botón, realizaremos una **resolución de jerarquía única**.

### Implementación
*   **Hash Table (Map):** Crearemos un objeto `FASTPASS_UI.State.hierarchy` que use el `lineID` como clave. Esto permite encontrar cualquier dato de un ítem de forma instantánea sin recorrer listas.
*   **Persistencia en Manifest:** Guardaremos esta estructura ya calculada en el archivo `.fastpass.json` (SessionManifest). 
*   **Beneficio:** El ensamblaje automático (`runAutoPlacement`) pasará de "deducir" a "consultar", eliminando toda la lógica de escaneo inverso.

---

## 2. Fase 1: Batching de Comandos JSX
**Objetivo:** Reducir la latencia de comunicación con Premiere Pro.

*   **Acción:** Crear un sistema de "Buffer" en `FASTPASS_UI.Utils`.
*   **Cambio:** Las funciones de marcadores y clips añadirán comandos a una cola en lugar de enviarlos individualmente.
*   **Resultado:** Operaciones que antes tardaban 5-10 segundos se completarán en menos de 1 segundo.

---

## 3. Fase 2: Algoritmos de Búsqueda (Binary Search)
**Objetivo:** Optimizar la localización de clips en proyectos grandes.

*   **Acción:** Implementar `Utils.binarySearchForTime(list, time)`.
*   **Cambio:** Sustituir los bucles `for` y `.find()` en `findCandidateClip` y `findClipIndexAtTime`.
*   **Resultado:** Velocidad constante de búsqueda sin importar si la línea de tiempo tiene 10 o 1000 clips.

---

## 4. Fase 3: Limpieza de Memoria y GC
**Objetivo:** Eliminar micro-lags y reducir el uso de RAM.

*   **Acción:** Refactorizar `Assembly_Logic.js`.
*   **Cambio:** 
    *   Pre-compilar todas las expresiones regulares fuera de los bucles.
    *   Sustituir `.filter().reduce()` por un solo paso de procesamiento para evitar copias innecesarias de arrays en memoria.
*   **Resultado:** Ejecución más fluida y menor riesgo de cuelgues en sesiones largas.

---

## 5. Próximos Pasos

| Tarea | Prioridad | Estado |
| :--- | :--- | :--- |
| Batching de Marcadores (JSX) | CRÍTICA | COMPLETADO |
| Generación de Estructura Jerárquica | ALTA | COMPLETADO |
| Implementación de Búsqueda Binaria | MEDIA | COMPLETADO |
| Optimización de RegExp y Memoria | BAJA | COMPLETADO |

> [!NOTE]
> La implementación de la **Estructura Jerárquica** en el Manifest es la pieza clave para que el sistema pase de ser un "asistente de montaje" a un "orquestador de datos" robusto.
