# Problema: Eliminación extra en limpieza de flash whites

## Descripción
Durante el ensamblaje automático, se detectan clips cortos (duración <0.2 s) que aparecen inmediatamente después de un clip normal (gap <0.2 s). Estos clips cortos, denominados “flash whites”, deben fusionarse físicamente: se elimina el clip corto (B) y el clip posterior (C), y se extiende el clip anterior (A) para cubrir el hueco resultante.

## Comportamiento esperado
- **Entrada**: timeline con clips ordenados por tiempo.
- **Detección**: triplete (clipA, clipB, clipC) donde clipB es corto y la separación entre A.end y B.start es <0.2 s.
- **Acción**:
  1. Eliminar clipC (posterior).
  2. Eliminar clipB (corto).
  3. Extender clipA hasta `clipD.start` (si existe un clip siguiente) o hasta `clipC.end`, restando un frame (0.04 s) para evitar solapamiento.
- **Resultado**: timeline con un clip menos, sin huecos ni clips superpuestos.

## Comportamiento actual (bug)
A pesar de que los índices pasados a las funciones ExtendScript (`Clips.end`, `Clips.remove`) coinciden con los clips esperados (según los logs de diagnóstico), **el clip anterior a clipA también se elimina**. Esto provoca que el timeline quede con clips superpuestos y se pierda contenido que no debería borrarse.

### Ejemplo del log
```
🎯 Detección flash white: clipB=6 (64.24‑64.36), clipA=5 (54.88‑59.60), clipC=7 (64.36‑74.32)
🔍 Clip A (índice 5) recuperado de Premiere: start=54.88, end=59.60
🔍 Clip B (índice 6) recuperado de Premiere: start=64.24, end=64.36
🔍 Clip C (índice 7) recuperado de Premiere: start=64.36, end=74.32
🛠️ Extendiendo clip 5 a 74.28
🗑️ Eliminando clip 7 (posterior)
🗑️ Eliminando clip 6 (corto)
```
Después de esta operación, el clip con índice 4 (anterior a clipA) desaparece del timeline.

## Intentos de solución aplicados
1. **Revertir cambios de filtrado paso alto** – Se abandonó la fusión virtual y se optó por edición física.
2. **Implementar detección de clips cortos y fusión física** – Algoritmo que recorre la lista de clips y detecta tripletes.
3. **Llamar a funciones ExtendScript para modificar timeline** – Uso de `Clips.end` y `Clips.remove`.
4. **Ajustar lógica: eliminar clip corto y posterior, extender anterior** – Orden de eliminación inicial: primero clipB, luego clipC.
5. **Corregir orden de eliminación para evitar borrado extra** – Se invirtió el orden (primero clipC, luego clipB) para evitar que el índice del clipC cambiara después de borrar clipB.
6. **Implementar algoritmo de fusión recursiva** – Bucle `while (changed)` que reinicia la detección después de cada fusión.
7. **Ajustar extensión para evitar solapamiento (menos 1 frame)** – Si clipD existe y empieza exactamente donde terminaría clipA, se resta un frame (0.04 s).
8. **Agregar logging de diagnóstico (clips después de limpieza)** – Se imprime la lista final de clips para verificar el resultado.
9. **Probar la corrección con botón GRAFIC y analizar logs** – Se ejecutó el ensamblaje y se revisaron los logs.
10. **Corregir selección de triplete (clipB corto, clipA anterior, clipC posterior)** – Se aseguró que clipA sea el clip inmediatamente anterior a clipB.

A pesar de estos ajustes, el bug de eliminación extra persiste.

## Hallazgos de diagnóstico
- Los índices (`trackIdx`, `idxA`, `idxB`, `idxC`) que se pasan a `Clips.get` coinciden con los clips esperados en el timeline (según la salida de `Clips.get`).
- Después de llamar a `Clips.remove` para clipC e clipB, el timeline muestra que el clip anterior a clipA ha desaparecido.
- La lista final de clips impresa después de la limpieza tiene 24 clips (inicialmente 28), lo que indica que se han eliminado 4 clips (2 tripletes × 2 clips cada uno). Sin embargo, deberían haberse eliminado solo 2 clips por triplete (B y C), es decir, 4 clips en total, lo cual coincide. La discrepancia está en **cuáles** clips se eliminan: en lugar de eliminar solo B y C, también se elimina el clip anterior a A.

## Posibles causas
1. **Indexado 0‑based vs 1‑based** – ¿Los índices de clip en ExtendScript son base‑0 o base‑1? Si `Clips.end` y `Clips.remove` esperan índices base‑1 y nosotros pasamos índices base‑0 (o viceversa), se estaría operando sobre el clip equivocado.
2. **Re‑numeración después de cada eliminación** – Aunque se elimina primero clipC, luego clipB, el array `clips` se actualiza con `splice` en el mismo orden, pero puede que el índice de clipA en el timeline de Premiere haya cambiado después de la primera eliminación.
3. **TrackIdx incorrecto** – La pista de video puede no ser la 1 (índice 0) si hay pistas ocultas o deshabilitadas.
4. **Error en la implementación de `Clips.remove`** – La función ExtendScript podría estar eliminando el clip en una posición relativa al clip seleccionado, no por índice absoluto.
5. **Presencia de clips ocultos o deshabilitados** – La lista de clips obtenida con `Clips.get` puede no incluir todos los clips visibles, lo que provocaría un desfase entre índices.

## Próximos pasos sugeridos
1. **Revisar `jsx/modules/6_Clips.jsx`** – Verificar la signatura de `Clips.end` y `Clips.remove`: ¿qué índices esperan (base‑0 o base‑1)? ¿El `trackIdx` es el índice de la pista en la colección `videoTracks`?
2. **Añadir logging extensivo** – Antes de cada llamada ExtendScript, imprimir el índice que se enviará y el clip que se espera afectar; después de la llamada, volver a obtener el clip en esa posición para comprobar qué cambió.
3. **Probar con eliminación individual** – Realizar una sola fusión en un timeline controlado y examinar paso a paso el estado del timeline.
4. **Considerar procesamiento en orden inverso** – Si el bug siempre afecta al clip anterior, procesar de atrás hacia adelante podría evitar que los índices de los clips aún no procesados se desplacen.
5. **Validar el array `clips`** – Asegurarse de que `clips` refleja exactamente el mismo orden que `Clips.get`. Quizás conviene refrescar la lista de clips después de cada eliminación llamando de nuevo a `Clips.get`.

## Archivos relevantes
- `js/workflows/flow_assembly.js` (líneas 331‑384) – bloque de limpieza física.
- `jsx/modules/6_Clips.jsx` – implementación ExtendScript de `Clips.end` y `Clips.remove`.

---

*Última actualización: 2026‑04‑16*  
*Estado: Pendiente de investigación*