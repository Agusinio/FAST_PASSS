# Mecanismo de Colocación de Wotts (Marker-Guided Placement)

> Documento vivo — se refinará conforme evolucione el mecanismo.
> Última actualización: 2026-04-24 (v4 — fix algoritmo DP+Enviat: busca marker CONNEXIÓ per text, no per absència de dígit)

## Índice

1. [Arquitectura general](#1-arquitectura-general)
2. [Disparador: botón GRAFIC](#2-disparador-botón-grafic)
3. [Algoritmo: runGuidedAssembly](#3-algoritmo-runguidedassembly)
4. [Formato de nombre de wott](#4-formato-de-nombre-de-wott)
5. [Formato de marcadores de timeline](#5-formato-de-marcadores-de-timeline)
6. [Lógica de matching lineID ↔ marcador](#6-lógica-de-matching-lineid--marcador)
7. [Cálculo de posición target](#7-cálculo-de-posición-target)
8. [Bridge de inserción (JS → JSX)](#8-bridge-de-inserción-js--jsx)
9. [Ejemplo completo](#9-ejemplo-completo)
10. [Puntos de refinamiento futuro](#10-puntos-de-refinamiento-futuro)

---

## 1. Arquitectura general

El sistema sigue la arquitectura de 5 capas del proyecto **FAST >>> PASS**:

```
  🖥️ UI (index.html)        → Botón GRAFIC (btnPlaceGrafic)
  🔗 Wiring (main.js)        → callWorkflow('Retols', 'runPlaceGraphic')
  🎬 Workflow (flow_retols.js) → runPlaceGraphic()
  🧠 Logic (14_Assembly_Logic.js) → runGuidedAssembly()
  💪 JSX (6_Clips.jsx)       → Clips.insert() (Premiere DOM)
```

### Flujo de llamadas completo

```
GRAFIC click
  → main.js:122 btnPlaceGrafic.addEventListener
    → callWorkflow('Retols', 'runPlaceGraphic')
      → flow_retols.js:118 runPlaceGraphic()
        → Assembly.runGuidedAssembly()
          ├─ Markers.get()            (JSX → 8_Markers.jsx)
          ├─ FASTPASS.Project.items('CHY') (JSX → 3_Project.jsx)
          ├─ [match logic en JS]
          └─ window.Clips.insert()    (JS → 6_Clips_Logic.js)
              └─ callJSX → Clips.insert()  (JSX → 6_Clips.jsx)
                  └─ targetTrack.overwriteClip(item, tStart)  (Premiere API)
```

---

## 2. Disparador: botón GRAFIC

| Elemento | Archivo | Línea |
|----------|---------|-------|
| Botón HTML | [`index.html`](../index.html) | `id="btnPlaceGrafic"` |
| Binding | [`main.js`](../js/main.js) | 122 |
| Workflow | [`flow_retols.js`](../js/workflows/flow_retols.js) | 118-126 |
| Lógica | [`14_Assembly_Logic.js`](../js/logic/14_Assembly_Logic.js) | 221-297 |

El botón **GRAFIC** llama a `Retols.runPlaceGraphic()`, que a su vez invoca `FASTPASS_UI.Logic.Assembly.runGuidedAssembly()`.

> **Nota:** El botón **RETOLS** (`btnPlaceChyrons`) también llama a `runGuidedAssembly` directamente (main.js:121). Ambos botones ejecutan el mismo algoritmo.

---

## 3. Algoritmo: runGuidedAssembly

Definido en [`14_Assembly_Logic.js`](../js/logic/14_Assembly_Logic.js).

```
1. Validar secuencia activa
2. Obtener marcadores del timeline  → Markers.get()
3. Obtener wotts del bin CHY        → FASTPASS.Project.items('CHY') (incluye duración)
4. Para CADA wott:
   a. Extraer lineID y TC offset del nombre (regex)
   b. Si es Tema-Titol y duración < 1s → descartar (skippedCount++)
   c. Buscar marcador según _findMarkerForLineID(lineID, markers, wottName):
      - DP + ENVIAT/PRESENCIAL: busca marker de sección "01DP", luego el
        siguiente marker cuyo comments contenga "CONEXIÓ"/"CONNEXIO"
        (porque TODOS los markers del sistema empiezan con dígito)
      - Si no → marker de sección por lineID completo (ej: "01LEAD" → "01lead - LEAD...")
      - Fallback: marker por prefijo numérico (ej: "02" → "02 - AUTORS DEL DIA")
   d. Determinar pista target según rol (_resolveTrackForWott):
      - Tema-Titol / _TITOL     → tematitol (V5 en Profile.json actiu)
      - SENYAL / ENVIAT / EN DIRECTO → llocdata (V7 en Profile.json actiu)
      - Altres (Nomcarrec, Conductor, Firma, Directe presencial) → chyrons (V6)
   e. targetTime = marker.time + offset
   f. window.Clips.insert(name, targetTrack, targetTime)
   g. count++
5. Log final: "S'han col·locat X rètols (Y Tema-Titol curts descartats)"
```

> **Nota sobre las pistas:** Los valores concretos (`V5`, `V6`, `V7`) provienen del [`Profile.json`](../Profile.json) activo, no del fallback de `config.js`. El `Profile.json` actual mapea:
> - `v_tema=5` → tematitol
> - `v_chyrons=6` → chyrons
> - `v_lloc=7` → llocdata
>
> Consulte §10.4 para la lógica completa de routing.

### Pseudocódigo

```
function runGuidedAssembly():
    markers = JSON.parse(Markers.get())
    wotts   = JSON.parse(Project.items('CHY'))    # incluye duration
    
    for each wott in wotts:
        match = wott.name.match(/_([A-Z0-9]+)_(\d{2})[.-](\d{2})(?:[.-](\d{2}))?/i)
        
        if not match:
            continue                              # formato no reconocido
        
        lineID = match[1].toUpperCase()
        
        if match[4] existe:                       # 3 pares: HH-MM-SS
            offset = HH*3600 + MM*60 + SS
        else:                                     # 2 pares: MM.SS
            offset = MM*60 + SS
        
        # FILTRO: Tema-Titol < 1s → descartar
        if es Tema-Titol AND wott.duration > 0 AND wott.duration < 1.0:
            skip; continue
        
        # BUSCAR MARCADOR
        marker = _findMarkerForLineID(lineID, markers, wott.name)
        
        if not marker:
            continue                              # sin marcador para este wott
        
        targetTrack = _resolveTrackForWott(name, cfg)
        targetTime  = marker.time + offset
        Clips.insert(wott.name, targetTrack, targetTime)


function _findMarkerForLineID(lineID, markers, wottName):
    # NOTA: TODOS los markers del sistema empiezan con dígito (ej: "01 - CONEXIÓ",
    #       "01c - CONNEXIO", "01dp - Donapas..."). Por tanto NO se puede buscar
    #       markers "sin dígito inicial". En su lugar:
    #
    #   - Para DP+Enviat: se busca el marker de sección "01DP" y luego el
    #     siguiente marker cuyo comments CONTENGA "CONEXIÓ" o "CONNEXIO".
    #   - Para el resto: busca marker de sección por lineID completo.
    
    # CASO ESPECIAL: DP + ENVIAT/PRESENCIAL → anclar al siguiente marker CONNEXIÓ
    if lineID contiene "DP" AND (wottName contiene "ENVIAT" OR "PRESENCIAL"):
        dpMarker = markers.find donde comments/name empiece por lineID (ej: "01DP")
        if dpMarker:
            # Buscar el SEGÜENT marker que contenga "CONEXIÓ" o "CONNEXIO"
            conexioMarkers = markers.filter:
                comments/name contiene "CONEXIÓ" OR "CONNEXIO"
                AND time >= dpMarker.time
            ordenar por time ascendente
            if conexioMarkers.length > 0:
                return conexioMarkers[0]  # el más cercano después del DP
    
    # CASO GENERAL: marker de sección por lineID completo
    marker = markers.find donde comments/name empiece por lineID
    if marker:
        return marker
    
    # FALLBACK: marker por prefijo numérico (para lineIDs como "02")
    marker = markers.find donde comments/name empiece por número del bloque
    
    return marker
```

---

## 4. Formato de nombre de wott

Los wotts en el bin **CHY** siguen este patrón general:

```
Wott_PROGRAMA_V1_BLOCKID_MM.SS_TEMA_ID_ROL_NOMBRE_EXTRAID.mov
```

### Ejemplos reales

```
Wott_TNV_v1_01lead_00.15_LEAD BONIQUISME DEL DIA_370215_Tema-Titol_Sant Jordi 2026.00370803.mov
Wott_TNV_v1_01dp_00.01_Donapas directe Passeig Gràcia_370691_Tema-Titol_Sant Jordi 2026_Jo.00370863.mov
Wott_TNV_v1_01chy_00.00_CHYRON TONI - esquerra_24202_Conductor_Toni Cruanyes.00370857.mov
Wott_TNV_v1_02_01.44_AUTORS DEL DIA_370693_Nomcarrec_Biel Mesquida_Premi d'Honor.00370871.mov
Wott_TNV_v1_01lin_00.00_GRUA PASSEIG DE GRÀCIA EN DIRE_370744_Directe_SENYAL.00370804.mov
```

### Segmentos del nombre

| Segmento | Ejemplo | Descripción |
|----------|---------|-------------|
| Prefijo | `Wott_` | Identificador de tipo wott |
| Programa | `TNV_v1_` | Código de programa y versión |
| BlockID | `01lead_` | Identificador de bloque + descriptor (ver §4.1) |
| TC offset | `00.15_` | Timecode de offset en formato MM.SS (minutos.segundos) |
| Tema | `LEAD BONIQUISME DEL DIA_` | Tema o descripción |
| ID interno | `370215_` | ID numérico interno |
| Rol | `Tema-Titol_` | Rol del wott (Tema-Titol, Nomcarrec, Conductor, etc.) |
| Nombre | `Sant Jordi 2026_` | Nombre descriptivo |
| Extra ID | `.00370803` | ID adicional de sistema |
| Extensión | `.mov` | Formato de archivo |

### 4.1 BlockID y descriptores de bloque

El BlockID puede ser simple o compuesto:

| BlockID | Significado |
|---------|-------------|
| `01` | Bloque 1 (genérico) |
| `01lead` | Bloque 1, sección LEAD |
| `01dp` | Bloque 1, sección Donapas (directe) |
| `01chy` | Bloque 1, sección Chyron |
| `01lin` | Bloque 1, sección en línea |
| `02` | Bloque 2 (genérico) |

### 4.2 Formato del TC offset

El TC offset puede aparecer en dos formatos:

| Formato | Ejemplo | Separador | Pares | Interpretación |
|---------|---------|-----------|-------|----------------|
| Actual | `00.15` | Punto `.` | 2 (MM.SS) | 0 minutos, 15 segundos |
| Actual | `01.44` | Punto `.` | 2 (MM.SS) | 1 minuto, 44 segundos |
| Antiguo | `00-02-15` | Guión `-` | 3 (HH-MM-SS) | 0 horas, 2 minutos, 15 segundos |

### 4.3 Regex de extracción

```javascript
const match = name.match(/_([A-Z0-9]+)_(\d{2})[.-](\d{2})(?:[.-](\d{2}))?/i);
```

| Grupo | Contenido | Ejemplo |
|-------|-----------|---------|
| `match[1]` | lineID (case-insensitive) | `01lead`, `02`, `S1` |
| `match[2]` | Primer par de dígitos | `00` (minutos) o `00` (horas) |
| `match[3]` | Segundo par de dígitos | `15` (segundos) o `02` (minutos) |
| `match[4]` | Tercer par (opcional) | `undefined` o `15` (segundos) |

Si `match[4]` existe → formato 3 pares: `offset = HH*3600 + MM*60 + SS`
Si `match[4]` no existe → formato 2 pares: `offset = MM*60 + SS`

---

## 5. Formato de marcadores de timeline

Los marcadores se obtienen via [`Markers.get()`](../jsx/modules/8_Markers.jsx) que devuelve un array JSON con:

```json
[
    {
        "time": 2.5,
        "name": "01lead",
        "comments": "01lead - LEAD BONIQUISME DEL DIA"
    },
    {
        "time": 134.28,
        "name": "02",
        "comments": "02 - AUTORS DEL DIA"
    }
]
```

### Campos clave

| Campo | Descripción |
|-------|-------------|
| `time` | Posición del marcador en segundos en la timeline |
| `name` | Nombre corto del marcador |
| `comments` | Texto completo del marcador (formato: `"LINEID - DESCRIPCIÓN"`) |

### Convención de nombres

Los marcadores de estructura siguen el patrón:
```
[LINEID] - [DESCRIPCIÓN]
```

Ejemplos:
- `01lead - LEAD BONIQUISME DEL DIA`
- `01dp - Donapas directe Passeig Gràcia`
- `01chy - CHYRON TONI - esquerra`
- `01lin - GRUA PASSEIG DE GRÀCIA EN DIRECTO`
- `02 - AUTORS DEL DIA`

---

## 6. Lógica de matching lineID ↔ marcador

La función [`_findMarkerForLineID()`](../js/logic/14_Assembly_Logic.js:261) implementa la búsqueda del marcador.

### Reglas de matching (en orden de prioridad)

1. **EXCEPCIÓN DP+Enviat/PRESENCIAL**: Si `lineID` contiene `"DP"` y `wottName` contiene `"ENVIAT"` o `"PRESENCIAL"`:
   - Busca primero el marker de sección del DP (ej: `"01dp - Donapas..."`)
   - Localiza el siguiente marker cuyo `comments` CONTENGA `"CONEXIÓ"` o `"CONNEXIO"` y esté DESPUÉS del marker del DP
   - Usa ese marker de CONNEXIÓ como ancla

2. **CASO GENERAL**: Busca un marker cuyo `comments` (fallback `name`) empiece por el `lineID` completo en mayúsculas (case-insensitive)

3. **FALLBACK**: Si no hay match exacto, busca por prefijo numérico del bloque (ej: `"02"` → marker cuyo comments empiece por `"02 "`)

### ⚠️ Nota importante sobre markers

TODOS los markers del sistema tienen labels que **comienzan con dígito**:
- `"01 - CONEXIÓ"` (estructural)
- `"01c - CONNEXIO"` (conexión, formato antiguo)
- `"01dp - Donapas directe Passeig Gràcia"` (sección)
- `"01lead - LEAD BONIQUISME DEL DIA"` (sección)

Por tanto, **no es posible usar "label sin dígito inicial"** como criterio para identificar markers estructurales. En su lugar, se busca por contenido textual (`"CONEXIÓ"`/`"CONNEXIO"`).

### Ejemplos de matching

| lineID extraído | wottName contiene | comments del marcador | ¿Match? |
|-----------------|-------------------|----------------------|---------|
| `01LEAD` | (cualquiera) | `"01lead - LEAD BONIQUISME DEL DIA"` | ✅ General: empieza por `"01LEAD "` |
| `01DP` | `"ENVIAT"` | `"01 - CONEXIÓ"` | ✅ Excepción DP+Enviat: busca CONNEXIÓ después del DP |
| `01DP` | `"PRESENCIAL"` | `"01c - CONNEXIO"` | ✅ Excepción DP+PRESENCIAL: busca CONNEXIÓ después del DP |
| `01DP` | `"Tema-Titol"` (sin ENVIAT/PRESENCIAL) | `"01dp - Donapas directe..."` | ✅ General (no entra en excepción): empieza por `"01DP "` |
| `02` | (cualquiera) | `"02 - AUTORS DEL DIA"` | ✅ General: empieza por `"02 "` |

---

## 7. Cálculo de posición target

```
targetTime = marker.time + offset
```

Donde:
- `marker.time`: posición del marcador en la timeline (segundos)
- `offset`: TC extraído del nombre del wott, convertido a segundos

### Ejemplos

| Wott | marker.time | offset (MM.SS) | offset (s) | targetTime |
|------|-------------|----------------|------------|------------|
| `_01lead_00.15_LEAD...` | 2.50s | 00.15 → 15s | 15s | 17.50s |
| `_01dp_00.01_Donapas...` | 2.50s | 00.01 → 1s | 1s | 3.50s |
| `_01chy_00.00_CHYRON...` | 2.50s | 00.00 → 0s | 0s | 2.50s |
| `_02_01.44_AUTORS...` | 134.28s | 01.44 → 104s | 104s | 238.28s |
| `_02_00.39_AUTORS...` | 134.28s | 00.39 → 39s | 39s | 173.28s |

---

## 8. Bridge de inserción (JS → JSX)

### Capa JavaScript (Brain)

Archivo: [`6_Clips_Logic.js:240-253`](../js/logic/6_Clips_Logic.js)

```javascript
insert: async function (itemName, trackIdx, startSec, endSec, type) {
    const safeName = (itemName || '').replace(/'/g, "\\'");
    const endParam = (endSec !== null && endSec !== undefined) ? `, ${endSec}` : ', null';
    const typeParam = type || 'video';
    return await utils.callJSX(`Clips.insert('${safeName}', ${trackIdx}, ${startSec}${endParam}, '${typeParam}')`);
}
```

### Capa ExtendScript (Muscle)

Archivo: [`6_Clips.jsx:114`](../jsx/modules/6_Clips.jsx)

```javascript
insert: function(itemName, trackIdx, startSec, endSec, type) {
    // Busca item en proyecto
    // Localiza pista (video/audio)
    // Crea Time a partir de startSec
    // targetTrack.overwriteClip(item, tStart)
    // Si endSec especificado, ajusta end del clip
}
```

### Parámetros

| Parámetro | Tipo | Default | Descripción |
|-----------|------|---------|-------------|
| `itemName` | string | — | Nombre del item de proyecto a insertar |
| `trackIdx` | number | — | Índice de pista (1-based) |
| `startSec` | number | — | Tiempo de inicio en segundos |
| `endSec` | number\|null | `null` | Tiempo final opcional (si se especifica, recorta duración) |
| `type` | string | `'video'` | Tipo de pista: `'video'` o `'audio'` |

---

## 9. Ejemplo completo

### Setup inicial

**Marcadores en timeline:**
```
Posición 2.50s   → "01lead - LEAD BONIQUISME DEL DIA"
Posición 2.50s   → "01dp - Donapas directe Passeig Gràcia"
Posición 134.28s  → "02 - AUTORS DEL DIA"
```

**Wotts en bin CHY (40 archivos):**
```
Wott_TNV_v1_01lead_00.15_LEAD BONIQUISME DEL DIA_370215_...mov
Wott_TNV_v1_01dp_00.01_Donapas directe Passeig Gràcia_370691_...mov
Wott_TNV_v1_02_01.44_AUTORS DEL DIA_370693_Nomcarrec_Biel Mesquida_...mov
Wott_TNV_v1_02_01.35_AUTORS DEL DIA_370475_Nomcarrec_Núria Cadenes_...mov
Wott_TNV_v1_02_00.01_AUTORS DEL DIA_369031_Tema-Titol_Sant Jordi 2026_...mov
...
```

### Procesamiento

| # | Wott name | lineID | offset | marker match? | targetTime |
|---|-----------|--------|--------|---------------|------------|
| 1 | `...01lead_00.15_LEAD...` | `01LEAD` | 15s | ✅ marker "01lead - LEAD..." @ 2.50s | 17.50s |
| 2 | `...01dp_00.01_Donapas...` | `01DP` | 1s | ✅ marker "01dp - Donapas..." @ 2.50s | 3.50s |
| 3 | `...02_01.44_AUTORS...` | `02` | 104s | ✅ marker "02 - AUTORS..." @ 134.28s | 238.28s |
| 4 | `...02_01.35_AUTORS...` | `02` | 95s | ✅ marker "02 - AUTORS..." @ 134.28s | 229.28s |
| 5 | `...02_00.01_AUTORS...` | `02` | 1s | ✅ marker "02 - AUTORS..." @ 134.28s | 135.28s |
| ... | ... | ... | ... | ... | ... |

### Resultado

Los wotts se colocan en la pista de chyrons (`T_CHY`) en las posiciones calculadas, distribuyéndose a lo largo del bloque según su offset individual.

---

## 10. Puntos de refinamiento futuro

### 10.1 Desduplicación de wotts

Actualmente NO se filtra si un wott ya está colocado en el timeline. Cada ejecución del GRAFIC button inserta de nuevo todos los wotts que hacen match.

Posibles estrategias:
- **Por nombre de archivo**: Antes de insertar, comprobar si ya existe un clip con el mismo nombre en la pista target dentro de un margen de tiempo.
- **Por lineID + offset**: Si ya hay un clip en `targetTime ± ε`, saltar.

### 10.2 Múltiples wotts con el mismo lineID

Varios wotts pueden compartir el mismo `lineID` (ej: `02`) pero con diferentes offsets. Esto es correcto: todos se colocan respecto al mismo marcador base pero en posiciones diferentes.

Sin embargo, actualmente el `marker.find()` devuelve el primer marcador que coincide. Si hay múltiples marcadores con el mismo prefijo (ej: `02a`, `02b`), solo se usará el primero.

### 10.3 Gestión de solapamientos

Si dos wotts tienen offsets muy cercanos, sus clips podrían solaparse en la timeline. Considerar:
- Lógica de spacing mínimo (ej: gap de 0.5s entre clips del mismo lineID)
- Detección de colisiones antes de insertar

### 10.4 Routing por rol (implementado)

Los wotts se enrutan a diferentes pistas de video según su rol, mediante [`_resolveTrackForWott()`](../js/logic/14_Assembly_Logic.js:223-252).

#### Lógica de routing

```javascript
_resolveTrackForWott: function(name, cfg) {
    const upper = name.toUpperCase();
    // Tema-Titol / _TITOL → tematitol
    if (upper.includes("TEMA-TITOL") || upper.includes("_TITOL")) {
        return cfg.tracks.video.tematitol;   // V5 segons Profile.json
    }
    // Senyal remota / enviada / en directo → llocdata
    if (upper.includes("_SENYAL_") || upper.includes("_ENVIAT_") || upper.includes("EN DIRECTO")) {
        return cfg.tracks.video.llocdata;    // V7 segons Profile.json
    }
    // Default: Nomcarrec, Conductor, Firma, Directe presencial → chyrons
    return cfg.tracks.video.chyrons;          // V6 segons Profile.json
}
```

#### Reglas

| Rol en filename | Pista target | Clave config | Valor Profile.json |
|-----------------|-------------|--------------|-------------------|
| `Tema-Titol` o `_TITOL` | tematitol | `tracks.video.tematitol` | 5 (V5) |
| `_SENYAL_`, `_ENVIAT_`, `EN DIRECTO` | llocdata | `tracks.video.llocdata` | 7 (V7) |
| Cualquier otro (Nomcarrec, Conductor, Firma, Directe presencial, etc.) | chyrons | `tracks.video.chyrons` | 6 (V6) |

#### ⚠️ Detalle importante: falso positivo con "DIRECTE"

La comprobación `upper.includes("DIRECTE")` **no se usa** porque genera falsos positivos.

**Caso problemático:**
```
Wott_TNV_v1_01dp_00.00_Donapas directe Passeig Gràcia_370267_Directe_PRESENCIAL_...
```
Aunque contiene "directe" (en la descripción "Donapas directe") y también aparece como rol `_Directe_`, se trata de un invitado **presencial**, no de una señal remota. Debe ir a chyrons (V6), no a llocdata (V7).

**Solución:** Solo se consideran señales remotas si contienen los tokens específicos `_SENYAL_`, `_ENVIAT_` o `EN DIRECTO`, que son mucho más selectivos.

#### Mapa de tracks real (Profile.json)

```json
"v_tema": 5,      // V5 = tematitol
"v_chyrons": 6,   // V6 = chyrons
"v_lloc": 7       // V7 = llocdata
```

> **Nota:** Estos valores difieren del fallback en `config.js` (que tiene `v_tema=4, v_chyrons=5, v_lloc=6`). El [`Profile.json`](../Profile.json) es la fuente de verdad en tiempo de ejecución.

#### Tabla de ejemplos

| Wott | Rol detectado | Pista | ¿Correcto? |
|------|--------------|-------|------------|
| `...01lead_Tema-Titol_...` | TEMA-TITOL | V5 (tematitol) | ✅ |
| `...01dp_Donapas directe..._Directe_PRESENCIAL_...` | — (no match llocdata) | V6 (chyrons) | ✅ Invitado presencial |
| `...01lin_...EN DIRECTO_..._SENYAL_...` | EN DIRECTO + SENYAL | V7 (llocdata) | ✅ Señal remota |
| `...01chy_..._Conductor_...` | — (default) | V6 (chyrons) | ✅ |
| `...02_..._Nomcarrec_...` | — (default) | V6 (chyrons) | ✅ |
| `...02_..._Tema-Titol_...` | TEMA-TITOL | V5 (tematitol) | ✅ |

### 10.5 Cacheo de marcadores

Si los marcadores no cambian entre ejecuciones, se podría cachear el array para evitar llamadas JSX redundantes.

### 10.6 Feedback visual durante la ejecución

Añadir una barra de progreso o contador en la UI durante el procesamiento de 40+ wotts.

### 10.7 Validación de formato de nombre

Si un wott no tiene el formato esperado, se loguea como `📦` pero se omite silenciosamente. Podría añadirse:
- Acumulador de errores con lista de archivos no procesados
- Log de advertencia al final si hay archivos sin match

### 10.8 Paso de pista target como parámetro

Actualmente la pista está hardcodeada como `cfg.tracks.video.chyrons`. Se podría parametrizar para permitir:
- Colocar en diferentes pistas según el rol del wott
- Especificar pista desde el workflow caller

---

## Referencias de código

| Archivo | Propósito |
|---------|-----------|
| [`index.html`](../index.html) | UI: botón GRAFIC |
| [`main.js`](../js/main.js) | Wiring de botones a workflows |
| [`flow_retols.js`](../js/workflows/flow_retols.js) | Workflow de retols/gráficos |
| [`14_Assembly_Logic.js`](../js/logic/14_Assembly_Logic.js) | Lógica principal: `runGuidedAssembly()` |
| [`6_Clips_Logic.js`](../js/logic/6_Clips_Logic.js) | Bridge JS: `window.Clips.insert()` |
| [`6_Clips.jsx`](../jsx/modules/6_Clips.jsx) | ExtendScript: `Clips.insert()` |
| [`8_Markers.jsx`](../jsx/modules/8_Markers.jsx) | ExtendScript: `Markers.get()` |
| [`3_Project.jsx`](../jsx/modules/3_Project.jsx) | ExtendScript: `Project.items()` |
