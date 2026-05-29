# 🎬 Guía de Keyframes — Premiere Pro 2025+ (ExtendScript)

Referencia unificada de manipulación de keyframes vía ExtendScript para la extensión FAST >>> PASS.

---

## 1. Protocolo de Inserción Segura

Para evitar que el reloj se quede gris o los valores se reseteen a `[0,0]`, seguir este orden quirúrgico:

| Paso | Acción Técnica | Por qué es vital en Premiere 2025 |
|------|---------------|-----------------------------------|
| 1. Captura | `getValueAtTime()` | Evita que al crear el keyframe los valores salten a `0,0` o defaults |
| 2. Activación | `setTimeVarying(true)` + `setValue()` | Sin el `setValue` posterior, el icono del reloj se queda gris |
| 3. Tiempo | `seq.getPlayerPosition()` | Premiere 25.0 usa tiempo absoluto del Timeline para Motion |
| 4. Escritura | `setValueAtKey(index, val)` | `setValueAtTime` lanza `ReferenceError` en el motor NewWorld |
| 5. Refresco | `setSelected(false/true)` | Sin esto, el diamante no aparece en el panel hasta mover el ratón |

### Código de inserción estándar:

```javascript
function baseInsertKeyframe(propertyIndex) {
    try {
        var seq = app.project.activeSequence;
        var sel = seq.getSelection();
        var clip = (sel && sel.length > 0) ? sel[0] : seq.videoTracks[0].clips[1];
        if (!clip) return "Error: No hay clip";

        // 1. Acceso a la propiedad (0: Position, 1: Scale, 2: Anchor Point)
        var prop = clip.components[1].properties[propertyIndex];
        var currentTime = seq.getPlayerPosition();

        // 2. CAPTURA: Guardar valor actual antes de animar
        var val = prop.getValueAtTime(currentTime);

        // 3. DESPERTAR MOTOR: Forzar cronómetro azul
        prop.setTimeVarying(true);
        prop.setValue(val, true);

        // 4. INSERCIÓN: Crear el diamante
        prop.addKey(currentTime);

        // 5. SINCRONIZACIÓN: Buscar índice para evitar reset a 0,0
        var keys = prop.getKeys();
        for (var k = 0; k < keys.length; k++) {
            if (Math.abs(keys[k].seconds - currentTime.seconds) < 0.005) {
                prop.setValueAtKey(k, val, true);
                break;
            }
        }

        // 6. REFRESCO: Obligatorio para ver cambios en Control de Efectos
        clip.setSelected(false, false);
        clip.setSelected(true, true);

        return "✅ Keyframe base insertado correctamente";
    } catch (e) {
        return "Error en Base: " + e.toString();
    }
}
```

---

## 2. Tipos de Interpolación (Cheat Sheet)

Usar con `setInterpolationTypeAtKey(index, type)`:

| Valor | Nombre | Comportamiento |
|-------|--------|---------------|
| `0` | **Linear** | Velocidad constante. Movimiento robótico |
| `1` | **Bezier** | Permite curvas. Suaviza entrada/salida manualmente |
| `2` | **Continuous Bezier** | Suavizado automático con continuidad |
| `3` | **Auto Bezier** | Premiere calcula la curva óptima |
| `4` | **Hold (Mantenido)** | Valor congelado hasta el siguiente keyframe (corte directo) |

---

## 3. Arquitectura CEP para Keyframes

En el modelo FAST >>> PASS, la extensión tiene dos capas:

1. **Panel (JavaScript/HTML)**: Interfaz de usuario donde se hace clic.
2. **Motor (ExtendScript `.jsx`)**: Archivos con lógica real de Premiere.

El panel envía órdenes al motor:

```javascript
// Desde JS del panel
var csInterface = new CSInterface();
csInterface.evalScript('cambiarInterpolacion()');
```

---

## 4. Ejemplo: Cambiar Interpolación

```javascript
function cambiarInterpolacion() {
    var project = app.project;
    if (!project.activeSequence) return;
    var sequence = project.activeSequence;
    var track = sequence.videoTracks[0];
    if (track.clips.numItems === 0) return;
    var clip = track.clips[0];

    // Buscar Motion por nombre
    var components = clip.components;
    var motionComponent;
    for (var i = 0; i < components.numItems; i++) {
        if (components[i].displayName === "Motion" || components[i].displayName === "Movimiento") {
            motionComponent = components[i];
            break;
        }
    }
    if (!motionComponent) return;

    var positionParam = motionComponent.properties[0]; // Posición

    if (!positionParam.isTimeVarying()) {
        positionParam.setTimeVarying(true);
    }

    var t1 = clip.inPoint.seconds + 0.5;
    var t2 = clip.inPoint.seconds + 2.0;

    positionParam.addKey(t1);
    positionParam.addKey(t2);

    // Asignar valores (posición = Array [x, y])
    positionParam.setValueAtKey(t1, [0.5, 0.5], true);
    positionParam.setValueAtKey(t2, [0.8, 0.5], true);

    // Cambiar interpolación: Bezier para KF1, Hold para KF2
    positionParam.setInterpolationTypeAtKey(0, 1, true);  // Bezier
    positionParam.setInterpolationTypeAtKey(1, 4, true);  // Hold
}
```

---

## 5. Estrategia para Encontrar Keyframes

El gran desafío de ExtendScript: no existe un método nativo "dame el índice del KF en el segundo X". Estrategias:

1. **Limpiar todo**: Borrar todos los keyframes antes de empezar → índice 0 es el primero.
2. **Contador manual**: Llevar cuenta de cuántos keyframes se han insertado.
3. **Búsqueda por tiempo**: Iterar `prop.getKeys()` comparando `Math.abs(keys[k].seconds - tiempo) < 0.005`.

---

> **Nota**: UXP todavía arroja errores "Illegal Parameter Type" y carece de documentación sobre interpolación. Para control profesional en Premiere 25.0+, mantener `.jsx` (ExtendScript) para tareas pesadas de keyframes.
