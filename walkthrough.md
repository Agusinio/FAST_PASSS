# Walkthrough: Semáforo de Estado (v1.0)

Hemos completado la implementación del sistema de **Semáforo**, que permite al editor validar el estado de los materiales de un vistazo.

## 🚦 Funcionamiento del Semáforo

El semáforo se encuentra en la sección **SETUP** y consta de 4 indicadores inteligentes:

| Luz | Sigla | Descripción | Estados |
|---|---|---|---|
| **Escaleta** | `ESC` | Busca el JSON más reciente en el servidor. | 🔴 No encontrado / 🟡 Bloque no ready / 🟢 OK |
| **CleanFeed** | `MP4` | Verifica si hay vídeo en la pista V1. | 🔴 Vacío / 🟢 Clip detectado |
| **Wotts** | `WOT` | Verifica si el Bin `CHY` del proyecto tiene elementos. | 🟡 Bin vacío / 🟢 Con activos |
| **Subtítulos** | `SRT` | Verifica clips en la pista de subtítulos. | ⚫ Off (Vacio) / 🟢 Detectados |

> [!TIP]
> **Tooltips dinámicos:** Si pasas el ratón por encima de una luz (ej: ESC), verás detalles adicionales como el nombre del archivo JSON encontrado o por qué está en rojo.

---

## Cambios Realizados

### UI y Estilos
- **[index.html](file:///Volumes/PYTHON/FAST_PASSS_Desarrollo/index.html)**: Añadido el contenedor `.semaforo-strip`.
- **[style.css](file:///Volumes/PYTHON/FAST_PASSS_Desarrollo/style.css)**: Definidos estilos tácticos con glow efectos para los estados `ready`, `pending` y `error`.

### Lógica de Control
- **[js/core/escaleta_reader.js](file:///Volumes/PYTHON/FAST_PASSS_Desarrollo/js/core/escaleta_reader.js)**: Añadido método `getStatus()` para consulta rápida del JSON.
- **[js/core/4_Context.js](file:///Volumes/PYTHON/FAST_PASSS_Desarrollo/js/core/4_Context.js)**: Integrado el polling de estados dentro de `checkContext()`. Los assets solo se comprueban si el proyecto está abierto (`UPDATE` o `GO`) para ahorrar recursos.

### Bridge JSX
- **[jsx/main.jsx](file:///Volumes/PYTHON/FAST_PASSS_Desarrollo/jsx/main.jsx)**: Añadidos métodos de escaneo ligero (`Clips.hasClips` y `Project.hasItems`) para que la consulta desde JS sea instantánea y no bloquee la UI.

---

## Verificación realizada
- [x] Los colores cambian al seleccionar un programa con/sin JSON.
- [x] La luz MP4 se pone roja si borras el clip de la V1 (tras el sig. audit).
- [x] El tooltip de ESC muestra correctamente el timestamp del JSON más reciente.
