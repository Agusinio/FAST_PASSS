# Tareas pendientes - FASTPASS Assembly

Fecha: 2026-04-16 (última revisión)
Log analizado: log de ejecución del ensamblaje automático (THE MAGIC)

## Problemas identificados

### 1. OutPoints de clips de chyron y traducción no coinciden con el clip candidato
- **Situación**: Los clips de traducción se insertan con una duración calculada que termina exactamente en `clipEnd` (gracias al ajuste aplicado), pero los chyrons (NOMCARREC, FIRMA, Llocdata) se insertan con `duration = null` (duración completa del archivo), lo que puede hacer que se extiendan más allá del clip candidato.
- **Evidencia en el log**:
  - Traducciones: duración ajustada (ej. 3.70s) y último outpoint coincide con clipEnd.
  - NOMCARREC “Lleó XIV” colocado a 25.84s dentro del clip [24.76‑32.16] pero su outpoint desconocido.
  - NOMCARREC “Donald Trump” colocado a 83.84s dentro del clip [82.60‑86.40] pero su outpoint desconocido.
- **Acción requerida**: Ajustar la duración de los chyrons para que su final no exceda el `clipEnd` del clip candidato (o, alternativamente, que terminen cuando termine el clip candidato). Podría usarse la misma lógica que para las traducciones: si el chyron pertenece a un bloque con clip candidato, asignarle una duración que vaya desde su `placementTime` hasta `clipEnd`.

### 2. Snap de NOMCARREC no se está aplicando
- **Situación**: Aunque se implementó una lógica de snap que alinea el chyron con el inicio del clip candidato, el log no muestra el mensaje `🔍 Snap NOMCARREC al clip contenedor:`. Esto indica que la condición `c.rol === "NOMCARREC"` no se cumple (posiblemente porque el rol está en minúsculas o con acentos en los datos).
- **Evidencia en el log**: Los chyrons aparecen como `Nomcarrec` (con ‘N’ mayúscula pero resto minúsculas). En el código se compara con la cadena `"NOMCARREC"` en mayúsculas estrictas.
- **Acción requerida**: Normalizar la comparación de roles (usar `c.rol.toUpperCase() === "NOMCARREC"` o una expresión regular que ignore mayúsculas/minúsculas). También conviene añadir un log de depuración para verificar qué valor tiene `c.rol` en tiempo de ejecución.

### 3. Tema‑Titol ya se coloca pero quizás no en la posición correcta
- **Situación**: El log muestra que el Tema‑Titol se colocó en el track V4 a las 18.84s. El usuario indica que “nos queda colocar el Tema‑Titol”, lo que sugiere que o bien falta colocarlo en otros bloques, o bien la posición/track no es la deseada.
- **Evidencia en el log**: `🎬 Tema‑Titol: … -> 18.84s (V4)`.
- **Acción requerida**: Verificar si el Tema‑Titol debe colocarse en todos los bloques (no solo en el primero) y si el track V4 es el correcto según la configuración de pistas. Revisar la lógica en `_placeIntroGfx` y `_placeMagicChyrons`.

### 4. Conductor no aparece en el log
- **Situación**: El conductor no se inserta porque probablemente no hay ningún conductor seleccionado en la UI (`conductorSelect.value` vacío) o hay un fallo en la obtención del elemento.
- **Evidencia en el log**: No hay ninguna línea referente al conductor después de “✅ Assemblatge Màgic completat.”.
- **Acción requerida**: Comprobar que el elemento `conductor` existe y tiene un valor válido. Si no hay conductor seleccionado, podríamos omitir la inserción (comportamiento actual), pero el usuario espera que se coloque un conductor por defecto o que se gestione de otra forma.

### 5. Primera traducción – seguimiento de visibilidad
- **Situación**: En el log la primera traducción aparece con el diagnóstico detallado, lo que indica que los cálculos son correctos. Sin embargo, el usuario había reportado que no se veía en el timeline. Hace falta confirmar si con los cambios realizados ahora sí es visible.
- **Acción requerida**: Pedir al usuario que verifique manualmente si la primera traducción (la de tc 00.08) se visualiza en la pista V3 del timeline. Si sigue sin aparecer, podría deberse a que el archivo de video no existe en la ruta esperada, a un error silencioso en `Clips.insert`, o a que el track V3 no está visible/monitorizado.

### 6. Distribución de traducciones dentro del clip candidato
- **Situación**: Las traducciones se distribuyen uniformemente dentro del clip candidato, pero en el log se observa que para los grupos con dos traducciones (tc 00.08 y tc 00.14) ambas comparten el mismo clip candidato [24.76‑32.16] y se solapan en el tiempo (primera del grupo 00.08 a 24.76s, primera del grupo 00.14 también a 24.76s). Esto puede ser intencional si los timecodes son diferentes pero el clip candidato es el mismo; sin embargo, el usuario originalmente quería evitar solapamientos. Habría que aclarar si es aceptable que traducciones de distintos timecodes ocupen la misma ventana temporal.
- **Acción requerida**: Revisar si la agrupación por `tc` es suficiente o si hay que considerar una agrupación más amplia (por ejemplo, por clip candidato) para evitar solapamientos entre grupos distintos.

### 7. Detección de estructura y colocación de conductor y Tema‑Titol en OFFs e intros (EN IMPLEMENTACIÓN)
- **Situación**: Los bloques con sufijo "f" (ej. 11f) corresponden a la aparición del conductor en pantalla, seguidos por un bloque sin sufijo (ej. 11) que es un OFF con imágenes. Actualmente, el bloque 11f se clasifica como OFF (correcto), pero el bloque 11 se clasifica como VIDEO_LONG (incorrecto). Además, el conductor no se coloca en el bloque 11f porque no hay chyron de conductor en ese bloque; el conductor se seleccionado desde la UI y se inserta al final del ensamblaje, pero debería colocarse en el bloque 11f con una marca temporal específica (4:10). El Tema‑Titol debe colocarse en relación con el conductor (según reglas: en OFFs primero el conductor, luego el Tema‑Titol; en intros primero el Tema‑Titol, luego el conductor). Las marcas temporales proporcionadas son: Conductor dura 5:00, marca a 4:10; Tema‑Titol dura 8:00, marcas a 6:06 y 6:12 (se congela en 6:12).
- **Evidencia en el log**: Bloque 11f solo contiene un Tema‑Titol, no conductor. Bloque 11 no contiene conductor. Bloque 13i (INTRO) solo contiene Tema‑Titol. No hay inserción de conductor en esos bloques.
- **Acción realizada**:
  1. Se ha añadido detección de bloques OFF_VIDEO (bloques sin sufijo que tienen un bloque "f" correspondiente) en `runAutoPlacement`, sobrescribiendo su tipo a "OFF_VIDEO".
  2. Se han creado las funciones `_placeOffGfx` y `_placeOffVideoGfx` para colocar conductor y Tema‑Titol según las marcas temporales.
  3. Se ha modificado `runAutoPlacement` para que en bloques OFF (sufijo "f") se inserte el conductor (desde UI o chyron) a `start + 0.4s` y se guarde su tiempo para el siguiente bloque OFF_VIDEO.
  4. En bloques OFF_VIDEO se inserta el Tema‑Titol (si existe) en la marca del conductor (`conductorStart + 4.10s`).
  5. Se ha añadido filtrado de chyrons ya colocados para evitar duplicados en `_placeMagicChyrons`.
  6. Se ha condicionado la inserción final del conductor solo si no se ha colocado previamente.
- **Pendiente de prueba**: Ejecutar el ensamblaje automático y verificar en el log que el conductor se coloca en el bloque 11f y el Tema‑Titol en el bloque 11 con las marcas correctas. También verificar que los demás chyrons (NOMCARREC, FIRMA, etc.) se coloquen correctamente.

### 8. Traducciones ya se recortan correctamente (resuelto)
- **Situación**: Gracias a los cambios realizados (cálculo de duración limitada al clip candidato y uso de `endTime` absoluto), las traducciones ya no se extienden más allá del clip base. El log muestra que la última traducción del bloque 12 termina exactamente en `clipEnd` (43.44s).
- **Acción requerida**: Ninguna, se considera resuelto. Mantener la lógica actual.

### 9. Flash white cleanup extra deletion bug
- **Situación**: Durante la limpieza física de clips flash whites (cortos), el algoritmo detecta correctamente el triplete (clipA anterior, clipB corto, clipC posterior) y llama a `Clips.end` y `Clips.remove` con los índices apropiados. Sin embargo, después de la operación, **el clip anterior a clipA también se elimina**, provocando solapamientos en el timeline.
- **Evidencia en el log**:
  - Detección: `🎯 Detección flash white: clipB=6 (64.24‑64.36), clipA=5 (54.88‑59.60), clipC=7 (64.36‑74.32)`.
  - Diagnóstico: los índices 5,6,7 corresponden a los clips esperados (confirmado con `Clips.get`).
  - Después de extender clip 5 y eliminar clips 7 y 6, el clip con índice 4 desaparece.
- **Acción requerida**: Investigar la causa del desplazamiento de índices. Posibles causas: indexado 0‑based vs 1‑based en ExtendScript, re‑numeración incorrecta después de cada eliminación, trackIdx erróneo. Consultar el documento detallado [`docs/FLASH_WHITE_CLEANUP_PROBLEM.md`](docs/FLASH_WHITE_CLEANUP_PROBLEM.md) para el análisis completo y los próximos pasos.

## Progreso realizado hoy (2026‑04‑16)
Se ha trabajado en la implementación de la limpieza física de flash whites. Las siguientes tareas se han completado:

1. **Revertir cambios de filtrado paso alto** – Se abandonó la fusión virtual y se optó por edición física.
2. **Implementar detección de clips cortos y fusión física** – Algoritmo que recorre la lista de clips y detecta tripletes.
3. **Llamar a funciones ExtendScript para modificar timeline** – Uso de `Clips.end` y `Clips.remove`.
4. **Ajustar lógica: eliminar clip corto y posterior, extender anterior** – Orden de eliminación inicial.
5. **Corregir orden de eliminación para evitar borrado extra** – Se invirtió el orden (primero clipC, luego clipB).
6. **Implementar algoritmo de fusión recursiva** – Bucle `while (changed)` que reinicia la detección después de cada fusión.
7. **Ajustar extensión para evitar solapamiento (menos 1 frame)** – Si clipD existe y empieza exactamente donde terminaría clipA, se resta un frame (0.04 s).
8. **Agregar logging de diagnóstico (clips después de limpieza)** – Se imprime la lista final de clips para verificar el resultado.
9. **Probar la corrección con botón GRAFIC y analizar logs** – Se ejecutó el ensamblaje y se revisaron los logs.
10. **Corregir selección de triplete (clipB corto, clipA anterior, clipC posterior)** – Se aseguró que clipA sea el clip inmediatamente anterior a clipB.

**Estado**: Las tareas de implementación están completas, pero persiste el bug de eliminación extra (problema 9). Se requiere investigación adicional.

## Próximos pasos sugeridos

1. **Ajustar outpoints de chyrons**: Modificar la inserción de NOMCARREC, FIRMA y Llocdata para que su duración se recorte al final del clip candidato (o al menos no lo exceda).
2. **Corregir comparación de roles**: Cambiar `c.rol === "NOMCARREC"` por una comparación insensible a mayúsculas/minúsculas.
3. **Verificar colocación de Tema‑Titol**: Confirmar que el Tema‑Titol se coloca en todos los bloques donde sea necesario y en el track correcto.
4. **Implementar colocación del Conductor**: Revisar la lógica de selección del conductor y asegurar que se inserte cuando corresponda.
5. **Validar visibilidad de la primera traducción**: Solicitar confirmación al usuario.
6. **Revisar solapamiento entre grupos de traducciones**: Decidir si es necesario evitar que traducciones de distintos timecodes ocupen el mismo espacio temporal.
7. **Investigar bug de eliminación extra en flash whites**: Revisar `jsx/modules/6_Clips.jsx` para entender el índice esperado (base‑0 vs base‑1), añadir logging extensivo y considerar procesar en orden inverso.

Este archivo servirá como referencia para la siguiente sesión de desarrollo. Los cambios deben realizarse en `js/workflows/flow_assembly.js` y, si es necesario, en `js/core/config.js` o `js/logic/13_Parse.js`.