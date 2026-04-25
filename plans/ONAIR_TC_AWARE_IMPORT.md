# ONAIR_TC_AWARE_IMPORT — Importació i Trimado de MP4 i Marcadors basats en Timecode Real d'Emissió

> **Versió:** 0.4 · **Data:** 2026-04-25  
> **Afectats:** `escaleta_reader.js` · `flow_mainButton.js` · `flow_assembly.js` · `session_manifest.js` [NOU]
>
> **v0.2:** Correcció crítica a Capa 1 — detecció d'ítems no-video als extrems del bloc
> (intro, donapas) i ús de `prevEnd`/`nextStart` com a límit real del bloc.
>
> **v0.3:** Nova secció §5.4 — funció de verificació `verifyTcRefFootprint` (debug/confiança).
>
> **v0.4:** Nova secció §4 — Manifest de Sessió (`.fastpass.json`): font de veritat persistent per a tots els processos.

---

## 1. Context i problema actual

### 1.1 Com s'importa l'MP4 avui

El flux actual (`flow_mainButton.js → _runNew`) fa:

```
bounds = reader.calcClipBounds(cf.mediaStart, block.in, block.out, handles, cf.mediaStop)
```

on `block.in` i `block.out` provenen de `cleanFeed.clips[*].in/out`, que **no** són timestamps
de playout exactes, sinó estimacions manuals. S'afegeix un `HANDLE_SECS` (20 s per defecte) com a
marge generós per compensar la imprecisió.

### 1.2 Problema real

* El trimado del clip MP4 a V1 queda desplaçat perquè les hores `block.in / block.out` del
  `cleanFeed.clips` **no corresponen als TCR d'emissió real**.
* La col·locació de marcadors (`placeStructureMarkers`) calcula la posició de cada ítem de
  l'escaleta usant una posició relativa acumulada que s'origina en aquest trimado imprecís.
* En conseqüència, l'algoritme de snap a talls (`snapToCut`) pot quedar fora de rang o
  assignar clips equivocats.

### 1.3 Novetat: dades de playout disponibles a l'escaleta

Cada ítem emès a la L'escaleta (`liniesEscaleta`) pot contenir:

| Camp | Exemple | Descripció |
|---|---|---|
| `horaEntradaOnAir` | `"21:05:59"` | TC exacte de inici d'emissió (playout) |
| `duradaOnAir` | `"0:18"` | Durada real emesa (mm:ss) |

Els ítems amb `teVideo: true` (vídeos verticalitzables) la porten **sempre** si s'han emès
(`estat: "VALIDAT"`).  
Els ítems sense vídeo (gràfics, off, donapas...) **no** la porten, però es poden inferir
a partir dels ítems amb vídeo del bloc anterior i posterior.

---

## 2. Objectiu general

Substituir el mecanisme basat en suposicions (`block.in / block.out + handles`) per un de
**tres capes de precisió creixent** per al trimado del MP4 i per al posicionament dels marcadors.

---

## 3. Tres capes de millora

### Capa 1 — Posicionament Aproximat (OnAir block boundary)

**Utilitza:** `horaEntradaOnAir` i `duradaOnAir` de tots els ítems `teVideo:true`
del bloc per estimar la **finestra temporal real** del bloc al programa.

```
blockOnAirStart = min(horaEntradaOnAir dels items teVideo del bloc)
blockOnAirEnd   = max(horaEntradaOnAir + duradaOnAir dels items teVideo del bloc)
```

> [!WARNING]
> **Problema crític:** el bloc pot tenir ítems sense vídeo (intro, presentació de conductora,
> donapas...) **al principi o al final**. Aquests ítems no tenen `horaEntradaOnAir`, per la
> qual cosa `blockOnAirStart` calculat sols a partir dels ítems de vídeo quedaria desplaçat
> **cap endavant**, deixant fora del trim els frames previs al primer vídeo del bloc.
>
> **Solució (fusió Capa 1 + Capa 2):** quan el primer vídeo del bloc **no és el primer ítem**
> del bloc (hi ha ítems no-video al davant), o quan el darrer vídeo del bloc **no és el darrer
> ítem** del bloc, s'usa `prevEnd` / `nextStart` del veí com a límit real del bloc, en lloc
> del primer/últim `horaEntradaOnAir` de vídeo.

**Lògica corregida:**
```
// Si hi ha items NO-video ABANS del primer video del bloc:
blockOnAirStart = prevEnd  (fi del darrer video del bloc anterior)

// Si NO hi ha items no-video al davant:
blockOnAirStart = horaEntradaOnAir del primer item teVideo del bloc

// Ídem per al final del bloc (items no-video al darrere → usar nextStart)
blockOnAirEnd = (cas simple)  horaEntradaOnAir + duradaOnAir del darrer item teVideo
blockOnAirEnd = (items al darrere) nextStart (inici del primer video del bloc següent)
```

Amb handles molt reduïts (2-5 s) perquè ara el punt de referència és exacte.

**Resultat:** el clip MP4 a V1 queda amb un trimado molt millor que l'actual des de la
primera etapa, incloent els ítems no-video de principi i final del bloc.

---

### Capa 2 — Acotament per veïnatge (elements anterior i posterior al bloc)

**Implementada conjuntament amb Capa 1** dins de `calcOnAirBounds`.

`getNeighbourOnAirTimes` analitza TOTES les `liniesEscaleta` per obtenir:
- `prevEnd`: fi del darrer ítem `teVideo` emès **abans** del bloc
- `nextStart`: inici del primer ítem `teVideo` emès **després** del bloc

Aquests valors serveixen per a dues coses:
1. **Correccions de frontera** (Capa 1 corregida): quan el bloc té ítems no-video al principi
   o al final, `prevEnd` / `nextStart` es uses com a límit real del bloc.
2. **Hard limits** per evitar que el trim invadi el bloc adjacent:
   ```
   // inPoint mai pot ser < prevEnd - mediaStart (entradíem al bloc anterior)
   // outPoint mai pot ser > nextStart - mediaStart (entraríem al bloc següent)
   ```

---

### Capa 3 — Refinament post-trossejat (TC inferit)

Un cop el clip MP4 està importat i el `TROSSEJA` ha generat els subclips a V1:

1. Per a cada subclip (`clip.inPoint`, `clip.outPoint` referit al MP4 original), es coneix
   el seu TC real: `mediaStart + clip.inPoint`.
2. L'ítem `teVideo` de l'escaleta que tingui `horaEntradaOnAir` més propera a aquest TC
   és el seu **àncora exacta**.
3. Es deriva un **offset TC** definitiu:
   ```
   offset_tc = clip.start_in_sequence - (horaEntradaOnAir_item - mediaStart)
   ```
4. Amb `offset_tc` es pot:
   * **Reajustar** el trim del clip MP4 si hi ha deriva.
   * **Posicionar marcadors exactes** per als ítems `teVideo`.
   * **Inferir posicions** per als ítems sense `horaEntradaOnAir` usant
     `horaEntradaPrevista` corregida per `offset_tc`.

---

## 4. Manifest de Sessió — `.fastpass.json`

### 4.1 Concept

En lloc de guardar l'estat de la sessió úcnicament a memòria (`FASTPASS_UI.State`),
cada projecte genera un fitxer **`{slug}.fastpass.json`** al mateix directori on es guarda
el `.prproj`. Aquest fitxer és l'**única font de veritat** per a tots els processos
que afecten el timeline:

| Problema antic | Solució amb Manifest |
|---|---|
| `tcRef` es perd en recarregar el panel | Sempre recuperable del `.fastpass.json` |
| Cada funció recompta des de zero | Llegir el manifest i continuar des d'on es va deixar |
| Impossible analitzar resultats passats | El manifest és un registre persistent i llegible |
| Depèndència d'ordre d'execució | El manifest indica quines fases s'han completat |

---

### 4.2 Nom i ubicació del fitxer

```
{carpetaProjecte}\{progId}_{blockId}.fastpass.json
```

Exemples:
```
\\server\VERTICALITZACIO\TNV\20260423\Pruebas_TNV_V1_BONIQUISME.prproj
\\server\VERTICALITZACIO\TNV\20260423\TNV_V1.fastpass.json
```

> El nom incorpora `progId` + `blockId` per permetre múltiples blocs d'un mateix
> programa a la mateixa carpeta dia (V1, V2, V3...).

---

### 4.3 Esquema JSON complet

```json
{
  "_version": "1.0",
  "_generated": "2026-04-25T10:21:00+02:00",
  "_lastUpdated": "2026-04-25T10:35:00+02:00",

  "program": {
    "progId": "TNV",
    "blockId": "V1",
    "projectFile": "Pruebas_TNV_V1_BONIQUISME.prproj",
    "projectFolder": "\\\\server\\VERTICALITZACIO\\TNV\\20260423",
    "escaletaFile": "TN_VESPRE_20260423_213005.json"
  },

  "cleanFeed": {
    "mediaPath": "\\\\DSMEDIA13\\DSMEDIA13_BACT_C\\50735073_..._TN_VESPRE_senyal_net.MP4",
    "mediaStart": "20:59:00:00",
    "mediaStop":  "21:29:40:00",
    "mediaDuration": "00:30:40:00"
  },

  "blockBounds": {
    "onAirStart": "21:00:00",
    "onAirEnd":   "21:08:39",
    "hasNonVideoBefore": false,
    "hasNonVideoAfter":  true,
    "prevEnd": 75600.0,
    "nextStart": 76119.0,
    "inPoint":  60.0,
    "outPoint": 585.0,
    "duration": 525.0
  },

  "tcRef": {
    "mediaStart":  75540.0,
    "inPoint":     60.0,
    "clipStart":   0.0,
    "offset":      -60.72,
    "correctedByFootprint": true,
    "footprintConfidence":  78
  },

  "clips": [
    {
      "index": 0,
      "sequenceStart": 0.0,
      "sequenceEnd":   35.04,
      "inPoint":  60.0,
      "outPoint": 95.04,
      "tcIn":  "21:00:00",
      "tcOut": "21:00:35",
      "duration": 35.04,
      "sceneDetected": true
    }
  ],

  "escaletaItems": [
    {
      "sequencia": 18,
      "num": "S1",
      "titol": "SV1 SANT JORDI BARCELONA I ALTRES",
      "tipus": "NORMAL",
      "teVideo": true,
      "horaEntradaOnAir": "21:00:00",
      "duradaOnAir": null,
      "durada": "0:10",
      "resolved": {
        "method": "ONAIR_EXACT",
        "sequencePos": 0.0,
        "markerPlaced": true,
        "markerColor": 6,
        "footprintDelta": 0.0,
        "footprintQuality": "EXACT"
      },
      "chyrons": [
        {
          "name": "TNV_S1_Conductor_Anna.mxf",
          "rol": "CONDUCTOR",
          "track": 5,
          "sequencePos": 0.4,
          "method": "CLIP_START_OFFSET"
        }
      ]
    },
    {
      "sequencia": 40,
      "num": "03",
      "titol": "MOMENT DELS MÉS VENUTS",
      "teVideo": true,
      "horaEntradaOnAir": "21:05:59",
      "duradaOnAir": "0:18",
      "durada": "0:30",
      "resolved": {
        "method": "ONAIR_EXACT",
        "sequencePos": 358.28,
        "markerPlaced": true,
        "markerColor": 6,
        "footprintDelta": 2.48,
        "footprintQuality": "APPROX"
      },
      "chyrons": []
    },
    {
      "sequencia": 41,
      "num": "04dp",
      "titol": "Donapas DADES DELS MÉS VENUTS",
      "teVideo": false,
      "horaEntradaOnAir": null,
      "durada": "0:07",
      "resolved": {
        "method": "ACCUMULATED_SNAP",
        "sequencePos": 376.0,
        "snapDelta": 0.08,
        "markerPlaced": true,
        "markerColor": 6
      },
      "chyrons": []
    }
  ],

  "footprintVerification": {
    "timestamp": "2026-04-25T10:25:00+02:00",
    "offsetBefore": -60.0,
    "offsetAfter":  -60.72,
    "meanDelta":    0.72,
    "stdDev":       1.10,
    "maxDev":       2.48,
    "confidence":   78,
    "autocorrected": true,
    "matches": [
      { "num": "S1", "expectedPos": 0.0,    "bestCutPos": 0.0,    "delta": 0.0,  "quality": "EXACT"  },
      { "num": "03", "expectedPos": 358.28, "bestCutPos": 360.76, "delta": 2.48, "quality": "APPROX" }
    ]
  },

  "phases": {
    "boundsCalculated": true,
    "mp4Imported":      true,
    "tcRefEstablished": true,
    "trossejaDone":     true,
    "clipsLogged":      true,
    "footprintVerified": true,
    "markersPlaced":    true,
    "chyronsPlaced":    false
  }
}
```

---

### 4.4 Cicle de vida del Manifest

El fitxer s'actualitza de forma **incremental** en cada etapa del workflow. Cada escriptura
és un **merge** (`Object.assign` o equivalent), no una sobreescriptura completa,
perquè cada etapa només afegeix la seva part.

```
┌───────────────────────────────────────────────────────────────┐
│ ETAPA                           │ ESCRIU                        │ LLEGEIX         │
├─────────────────────────────────┐───────────────────────────────┬─────────────────┤
│ _runNew (calcOnAirBounds)        │ program, cleanFeed,           │ —              │
│                                  │ blockBounds, tcRef (parcial), │                 │
│                                  │ escaletaItems (sense resolve) │                 │
├─────────────────────────────────┤───────────────────────────────┼─────────────────┤
│ Clips.insert + getInPoint        │ tcRef.clipStart, tcRef.offset │ blockBounds     │
├─────────────────────────────────┤───────────────────────────────┼─────────────────┤
│ TROSSEJA (subclips detectats)    │ clips[]                       │ tcRef           │
├─────────────────────────────────┤───────────────────────────────┼─────────────────┤
│ verifyTcRefFootprint             │ footprintVerification,        │ clips[],        │
│                                  │ tcRef.offset (corregit)       │ escaletaItems,  │
│                                  │                               │ tcRef           │
├─────────────────────────────────┤───────────────────────────────┼─────────────────┤
│ placeStructureMarkers            │ escaletaItems[].resolved      │ tcRef (corr.),  │
│                                  │ (sequencePos, method, color)  │ clips[],        │
│                                  │ phases.markersPlaced = true   │ escaletaItems   │
├─────────────────────────────────┤───────────────────────────────┼─────────────────┤
│ runAutoPlacement (chyrons)       │ escaletaItems[].chyrons[]     │ escaletaItems   │
│                                  │ phases.chyronsPlaced = true   │ (sequencePos)   │
└─────────────────────────────────┘───────────────────────────────┴─────────────────┘
```

---

### 4.5 Mòdul `js/core/session_manifest.js` [NOU]

Mòdul dedicat a crear, llegir i actualitzar el manifest. Totes les altres funcions
utilitzen aquest mòdul — **mai** escriuen el fitxer directament.

```js
FASTPASS_UI.SessionManifest = {

    /**
     * Retorna la ruta del fitxer manifest per al context actual.
     * Exemple: ...\\TNV\\20260423\\TNV_V1.fastpass.json
     */
    getPath: function(ctx) {
        const folder = ctx.config.rutas.destinoBase
                     + ctx.progData.directorio + '\\' + ctx.dateDir;
        return folder + '\\' + (ctx.progData.wott || 'PROG') + '_' + ctx.bloque + '.fastpass.json';
    },

    /**
     * Llegeix el manifest existent o retorna un objecte buit si no existeix.
     */
    load: async function(ctx) {
        const path = this.getPath(ctx);
        const utils = window.FASTPASS_UI.Utils;
        try {
            const raw = await utils.callJSX(`IO.readTxt('${utils.escape(path)}')`);
            if (raw && !raw.startsWith('ERR')) return JSON.parse(raw);
        } catch (e) { /* Manifest no existeix encara */ }
        return this._empty(ctx);
    },

    /**
     * Desa el manifest (merge amb les dades existents).
     * @param {Object} ctx  - Context actual (programa, bloc, dates)
     * @param {Object} patch - Objecte parcial amb les noves dades a fusiónar
     */
    save: async function(ctx, patch) {
        const existing  = await this.load(ctx);
        const updated   = this._deepMerge(existing, patch);
        updated._lastUpdated = new Date().toISOString();
        const path = this.getPath(ctx);
        const json = JSON.stringify(updated, null, 2);
        const utils = window.FASTPASS_UI.Utils;
        await utils.callJSX(`IO.writeTxt('${utils.escape(path)}', '${utils.escape(json)}')`);
        // Sincronitzar tcRef a State per ús immediat
        if (updated.tcRef) window.FASTPASS_UI.State.tcRef = updated.tcRef;
        return updated;
    },

    /** Objecte buit inicial */
    _empty: function(ctx) {
        return {
            _version:    '1.0',
            _generated:  new Date().toISOString(),
            _lastUpdated: new Date().toISOString(),
            program: {
                progId:  ctx.progData?.wott || '',
                blockId: ctx.bloque || '',
                projectFile:   '',
                projectFolder: '',
                escaletaFile:  ''
            },
            cleanFeed: {}, blockBounds: {}, tcRef: {},
            clips: [], escaletaItems: [],
            footprintVerification: null,
            phases: {
                boundsCalculated:   false,
                mp4Imported:        false,
                tcRefEstablished:   false,
                trossejaDone:       false,
                clipsLogged:        false,
                footprintVerified:  false,
                markersPlaced:      false,
                chyronsPlaced:      false
            }
        };
    },

    /** Merge profund de dos objectes (non-destructiu) */
    _deepMerge: function(base, patch) {
        const result = Object.assign({}, base);
        for (const key of Object.keys(patch)) {
            if (Array.isArray(patch[key])) {
                result[key] = patch[key]; // Els arrays es substitueixen
            } else if (patch[key] && typeof patch[key] === 'object') {
                result[key] = this._deepMerge(base[key] || {}, patch[key]);
            } else {
                result[key] = patch[key];
            }
        }
        return result;
    }
};
```

---

### 4.6 Recuperació de `tcRef` en recarregar el panel

Amb el manifest, `FASTPASS_UI.State.tcRef` no és imprescindible perquè sempre
es pot reconstruir:

```js
// A l'inici de qualsevol workflow que necessiti tcRef:
let tcRef = FASTPASS_UI.State.tcRef;
if (!tcRef) {
    log('⚠️ [tcRef] No disponible a State. Intentant recuperar del manifest...');
    const manifest = await FASTPASS_UI.SessionManifest.load(ctx);
    if (manifest?.tcRef?.offset !== null) {
        tcRef = manifest.tcRef;
        FASTPASS_UI.State.tcRef = tcRef;
        log(`✅ [tcRef] Recuperat del manifest: offset=${tcRef.offset?.toFixed(3)}s`);
    }
}
```

---

## 5. Control de TC referenciat (`tcRef`)

### 4.1 Concepte

`tcRef` és l'estructura en memòria que manté la relació entre:

| Camp | Contingut |
|---|---|
| `mediaStart` | TC de l'inici del fitxer MP4 ("20:59:00:00") |
| `clipStart` | Offset en la seqüència Premiere on comença el clip MP4 (en segons des de t=0) |
| `inPoint` | Punt de tall inicial del clip MP4 (en segons des de `mediaStart`) |
| `offset` | `clipStart - inPoint` — vector que converteix qualsevol TC de playout a posició de seqüència |

### 4.2 Fórmula fonamental

```
sequencePos(horaOnAir) = (tcToSec(horaOnAir) - tcToSec(mediaStart)) - inPoint + clipStart
                       = tcToSec(horaOnAir) - tcToSec(mediaStart) + offset
```

### 4.3 On es calcula i emmagatzema

`tcRef` es crea a `EscaletaReader.calcOnAirBounds()` (nou mètode, veure §5) i
s'emmagatzema a `FASTPASS_UI.State.tcRef` perquè sigui accessible des de
`flow_assembly.js → placeStructureMarkers`.

---

## 5. Canvis als mòduls existents

### 5.1 `js/core/escaleta_reader.js` — Nous mètodes

#### `getOnAirVideoItems(data, blockId)` [NOU]

Retorna tots els ítems `teVideo:true` i `horaEntradaOnAir != null` del bloc indicat,
ordenats cronològicament.

```js
getOnAirVideoItems: function(data, blockId) {
    const lines = data?.escaleta?.liniesEscaleta || [];
    return lines.filter(l =>
        l.agrupacio?.toLowerCase() === blockId.toLowerCase() &&
        l.teVideo === true &&
        l.horaEntradaOnAir != null
    ).sort((a, b) => this.tcToSeconds(a.horaEntradaOnAir) - this.tcToSeconds(b.horaEntradaOnAir));
}
```

#### `getNeighbourOnAirTimes(data, blockId)` [NOU]

Analitza TOTES les `liniesEscaleta` per obtenir el TC del darrer video emès **abans**
del bloc i el primer **després**. Funciona fins i tot si `blockId` no té cap ítem de vídeo
(en tal cas, `blockStart` i `blockEnd` s'obtenen de la posició del bloc al JSON via `sequencia`).

```js
getNeighbourOnAirTimes: function(data, blockId) {
    const allLines = data?.escaleta?.liniesEscaleta || [];
    const allWithVideo = allLines
        .filter(l => l.teVideo && l.horaEntradaOnAir)
        .sort((a, b) => this.tcToSeconds(a.horaEntradaOnAir) - this.tcToSeconds(b.horaEntradaOnAir));

    const blockItems = this.getOnAirVideoItems(data, blockId);

    // Si no hi ha items de vídeo al bloc, usar la posició seqüencial per delimitar
    let blockStart, blockEnd;
    if (blockItems.length > 0) {
        const lastItem = blockItems[blockItems.length - 1];
        blockStart = this.tcToSeconds(blockItems[0].horaEntradaOnAir);
        blockEnd   = this.tcToSeconds(lastItem.horaEntradaOnAir)
                   + this.parseDurada(lastItem.duradaOnAir || lastItem.durada);
    } else {
        // Fallback: usar sequencia del bloc per trobar la seva posició relativa
        // Buscar l'ítem amb agrupacio=blockId i obtenir horaEntradaPrevista
        const blockLine = allLines.find(l =>
            l.agrupacio?.toLowerCase() === blockId.toLowerCase()
        );
        if (!blockLine) return { prevEnd: null, nextStart: null };
        blockStart = this.tcToSeconds(blockLine.horaEntradaPrevista);
        blockEnd   = blockStart; // bloc sense vídeo → rang puntual
    }

    let prevEnd   = null;
    let nextStart = null;

    for (const item of allWithVideo) {
        const t    = this.tcToSeconds(item.horaEntradaOnAir);
        const tEnd = t + this.parseDurada(item.duradaOnAir || item.durada);
        if (tEnd <= blockStart) prevEnd = tEnd;           // anterior al bloc
        else if (t >= blockEnd && nextStart === null) nextStart = t; // posterior al bloc
    }
    return { prevEnd, nextStart, blockStart, blockEnd };
}
```

#### `hasNonVideoItemsBefore(data, blockId)` [NOU — auxiliar]

Detecta si el bloc conté ítems **sense vídeo** que precediexen cronològicament el primer
ítem de vídeo (intro, presentació, donapas sense vídeo propi, etc.).

```js
hasNonVideoItemsBefore: function(data, blockId) {
    const allLines = data?.escaleta?.liniesEscaleta || [];
    const blockLines = allLines.filter(l =>
        l.agrupacio?.toLowerCase() === blockId.toLowerCase()
    ).sort((a, b) => a.sequencia - b.sequencia);

    // Hi ha items no-teVideo ABANS del primer teVideo del bloc?
    const firstVideoIdx = blockLines.findIndex(l => l.teVideo);
    if (firstVideoIdx === -1) return { before: false, after: false };

    const before = firstVideoIdx > 0;
    const after  = blockLines.findLastIndex(l => l.teVideo) < blockLines.length - 1;
    return { before, after };
},

hasNonVideoItemsAfter: function(data, blockId) {
    return this.hasNonVideoItemsBefore(data, blockId).after;
}
```

#### `calcOnAirBounds(data, blockId, mediaStart, mediaStop, cfg)` [NOU]

Implementa Capes 1+2 de forma integrada. La clau: quan hi ha ítems no-video al principi
o al final del bloc, usa `prevEnd` / `nextStart` del veí com a límit real del bloc en
comptes del primer/darrer `horaEntradaOnAir` de vídeo.

```js
calcOnAirBounds: function(data, blockId, mediaStart, mediaStop, cfg) {
    const videoItems = this.getOnAirVideoItems(data, blockId);
    const handles    = cfg?.handles ?? 5;  // 5 s (molt menys que els 20 s actuals)

    if (videoItems.length === 0) {
        // Fallback: comportament antic amb handles grans
        const block = this.getBlock(data, blockId);
        if (!block) return null;
        return this.calcClipBounds(mediaStart, block.in, block.out, cfg?.handles ?? 20, mediaStop);
    }

    const msStart  = this.tcToSeconds(mediaStart);
    const lastVid  = videoItems[videoItems.length - 1];

    // Primer/darrer TC de vídeo del bloc
    const firstVideoOnAir = this.tcToSeconds(videoItems[0].horaEntradaOnAir);
    const lastVideoOnAirEnd = this.tcToSeconds(lastVid.horaEntradaOnAir)
                            + this.parseDurada(lastVid.duradaOnAir || lastVid.durada);

    // Obtenir informació de veïns (inclou blockStart/End calculats)
    const { prevEnd, nextStart } = this.getNeighbourOnAirTimes(data, blockId);

    // Detectar si hi ha ítems no-video al principi o al final del bloc
    const { before: hasNonVideoBefore, after: hasNonVideoAfter } =
        this.hasNonVideoItemsBefore(data, blockId);

    // ─── CÀLCUL DE blockOnAirStart ─────────────────────────────────────────
    // Si hi ha items NO-video ABANS del primer vídeo del bloc:
    // → usem prevEnd (fi del bloc anterior) com a límit esquerre real
    //   perquè el primer item del bloc NO té horaEntradaOnAir
    // Si NO n'hi ha (primer item = primer vídeo):
    // → usem horaEntradaOnAir del primer vídeo directament
    let blockOnAirStart;
    if (hasNonVideoBefore && prevEnd != null) {
        blockOnAirStart = prevEnd;  // TC on acaba el bloc anterior = inici real d'aquest bloc
        log(`📐 [calcOnAirBounds] Bloc ${blockId}: items no-video al principi → blockOnAirStart = prevEnd (${prevEnd.toFixed(2)}s)`);
    } else {
        blockOnAirStart = firstVideoOnAir;
    }

    // ─── CÀLCUL DE blockOnAirEnd ───────────────────────────────────────────
    // Si hi ha items NO-video DESPRÉS del darrer vídeo del bloc:
    // → usem nextStart (inici del primer vídeo del bloc següent) com a límit dret real
    // Si NO n'hi ha:
    // → usem fi del darrer vídeo del bloc
    let blockOnAirEnd;
    if (hasNonVideoAfter && nextStart != null) {
        blockOnAirEnd = nextStart;  // TC on comença el bloc següent = fi real d'aquest bloc
        log(`📐 [calcOnAirBounds] Bloc ${blockId}: items no-video al final → blockOnAirEnd = nextStart (${nextStart.toFixed(2)}s)`);
    } else {
        blockOnAirEnd = lastVideoOnAirEnd;
    }

    // ─── inPoint / outPoint ────────────────────────────────────────────────
    let inPoint  = Math.max(0, (blockOnAirStart - msStart) - handles);
    let outPoint = (blockOnAirEnd - msStart) + handles;

    // Hard limits addicionals: mai podem envair el bloc veí
    // (defensa extra, especialment quan no hi ha ítems no-video als extrems)
    const hardIn  = prevEnd   != null ? (prevEnd   - msStart) - 0.04 : null;
    const hardOut = nextStart != null ? (nextStart - msStart) + 0.04 : null;
    if (hardIn  != null && inPoint  < hardIn)  inPoint  = hardIn;
    if (hardOut != null && outPoint > hardOut) outPoint = hardOut;

    // Truncar a la durada del MP4
    if (mediaStop) {
        const msStop  = this.tcToSeconds(mediaStop);
        const maxDur  = msStop - msStart;
        if (outPoint > maxDur) outPoint = maxDur;
    }

    const duration = outPoint - inPoint;
    const tcRef = {
        mediaStart: msStart,
        inPoint,
        clipStart:  null,  // s'omple un cop el clip és inserit a Premiere
        offset:     null   // = clipStart - inPoint
    };

    log(`📐 [calcOnAirBounds] ${blockId}: inPoint=${inPoint.toFixed(2)}s, outPoint=${outPoint.toFixed(2)}s, dur=${duration.toFixed(2)}s`);
    return { inPoint, outPoint, duration, tcRef };
}
```

#### `parseDurada(str)` [NOU — extret de flow_assembly.js per reutilitzar]

Converteix `"0:18"`, `"1:05"`, `"0:34:00"` a segons. Igual que la funció inline
existent a `flow_assembly.js`, però centralitzada al reader.

---

### 5.4 `js/workflows/flow_assembly.js` — Verificació Footprint OnAir vs SceneDetect [DEBUG]

#### Motivació

Un cop el clip MP4 ha estat importat (amb `tcRef` calculat) i el `TROSSEJA` ha generat
els subclips a V1, disposem de **dos sistemes d'informació temporal independents**:

| Font | Dades |
|---|---|
| Escaleta JSON | `horaEntradaOnAir` de cada ítem `teVideo` → posició esperada via `tcRef` |
| SceneDetect (TROSSEJA) | Inicis de cada subclip a V1 → posició real detectada |

Comparant-les, podem calcular un **índex de confiança** del `tcRef`i detectar si hi
ha deriva, desalineació o un error en el càlcul del trim.

---

#### `verifyTcRefFootprint(videoItems, clips, tcRef, reader)` [NOU — funció de debug]

**Ubicació:** `flow_assembly.js` (accessible des de `placeStructureMarkers` i des d'un
botó de debug a la UI si es desitja).

**Entrades:**
- `videoItems`: array d'ítems de l'escaleta amb `horaEntradaOnAir` (resultat de `getOnAirVideoItems`)
- `clips`: array de subclips V1 del timeline (resultat de `getTrackClips(1, 'video')`)
- `tcRef`: objecte `{ mediaStart, inPoint, clipStart, offset }` calculat prèviament
- `reader`: referència a `EscaletaReader` per usar `tcToSeconds` i `parseDurada`

**Lògica:**

```js
verifyTcRefFootprint: function(videoItems, clips, tcRef, reader) {
    const log = (m) => getUtils().log(m, 'DEBUG');

    if (!tcRef || !tcRef.offset === null) {
        log('⚠️ [Footprint] tcRef no disponible. Abortant verificació.');
        return null;
    }
    if (videoItems.length === 0 || clips.length === 0) {
        log('⚠️ [Footprint] Sense items OnAir o sense clips. Abortant verificació.');
        return null;
    }

    // Precomputar inicis de clips com a Set per cerca ràpida
    const cutStarts = clips.map(c => c.start);  // posicions reals de cada tall

    const matches = [];

    for (const item of videoItems) {
        // Posició esperada a la seqüència per a aquest ítem (via tcRef)
        const onAirSec  = reader.tcToSeconds(item.horaEntradaOnAir);
        const expectedPos = (onAirSec - tcRef.mediaStart) + tcRef.offset;

        // Trobar el tall detectat més proper a expectedPos
        let bestDelta = Infinity;
        let bestCutPos = null;
        for (const cut of cutStarts) {
            const delta = cut - expectedPos;  // positiu = el tall és més tard de l'esperat
            if (Math.abs(delta) < Math.abs(bestDelta)) {
                bestDelta  = delta;
                bestCutPos = cut;
            }
        }

        const duradaSec = reader.parseDurada(item.duradaOnAir || item.durada);
        const match = {
            num:         item.num || '?',
            titol:       (item.titol || '').substring(0, 40),
            onAirTC:     item.horaEntradaOnAir,
            expectedPos: parseFloat(expectedPos.toFixed(3)),
            bestCutPos:  bestCutPos !== null ? parseFloat(bestCutPos.toFixed(3)) : null,
            delta:       bestCutPos !== null ? parseFloat(bestDelta.toFixed(3)) : null,
            duradaOnAir: duradaSec,
            // Qualitat de la coincidència:
            // EXACT   → |delta| < 1 frame (0.04 s)
            // GOOD    → |delta| < 1 s
            // APPROX  → |delta| < 5 s
            // FAIL    → |delta| >= 5 s o sense tall trobat
            quality: bestCutPos === null ? 'NO_CUT'
                   : Math.abs(bestDelta) < 0.04 ? 'EXACT'
                   : Math.abs(bestDelta) < 1.0  ? 'GOOD'
                   : Math.abs(bestDelta) < 5.0  ? 'APPROX'
                   : 'FAIL'
        };
        matches.push(match);
    }

    // ─── Estadístiques globals ────────────────────────────────────────────
    const validDeltas = matches
        .filter(m => m.delta !== null && m.quality !== 'FAIL')
        .map(m => m.delta);

    const meanDelta = validDeltas.length > 0
        ? validDeltas.reduce((s, d) => s + d, 0) / validDeltas.length
        : null;

    const stdDev = (validDeltas.length > 1 && meanDelta !== null)
        ? Math.sqrt(validDeltas.map(d => (d - meanDelta) ** 2)
                               .reduce((s, v) => s + v, 0) / validDeltas.length)
        : null;

    const maxDev = validDeltas.length > 0
        ? Math.max(...validDeltas.map(Math.abs))
        : null;

    // Score 0-100: 100 = tot coincideix exactament
    const exactCount  = matches.filter(m => m.quality === 'EXACT').length;
    const goodCount   = matches.filter(m => m.quality === 'GOOD').length;
    const approxCount = matches.filter(m => m.quality === 'APPROX').length;
    const failCount   = matches.filter(m => m.quality === 'FAIL' || m.quality === 'NO_CUT').length;
    const total       = matches.length;
    const confidence  = total > 0
        ? Math.round((exactCount * 100 + goodCount * 75 + approxCount * 40) / total)
        : 0;

    // ─── Report de debug ──────────────────────────────────────────────────
    log('═══════════════════════════════════════════════════════');
    log(`🔬 [Footprint Verify] tcRef.offset = ${tcRef.offset.toFixed(3)}s`);
    log(`📊 Resultats (${total} ítems OnAir vs ${clips.length} talls detectats):`);
    for (const m of matches) {
        const icon = { EXACT: '🟢', GOOD: '🟡', APPROX: '🟠', FAIL: '🔴', NO_CUT: '⚫' }[m.quality];
        const deltaStr = m.delta !== null ? `Δ=${m.delta > 0 ? '+' : ''}${m.delta.toFixed(3)}s` : 'sense tall';
        log(`  ${icon} [${m.num}] "${m.titol}" | OnAir=${m.onAirTC} | esperat=${m.expectedPos.toFixed(2)}s | real=${m.bestCutPos?.toFixed(2) ?? '—'}s | ${deltaStr} | ${m.quality}`);
    }
    log('───────────────────────────────────────────────────────');
    log(`📐 meanDelta=${meanDelta?.toFixed(3) ?? '—'}s | stdDev=${stdDev?.toFixed(3) ?? '—'}s | maxDev=${maxDev?.toFixed(3) ?? '—'}s`);
    log(`🏆 Confidence: ${confidence}/100 (EXACT:${exactCount} GOOD:${goodCount} APPROX:${approxCount} FAIL:${failCount})`);
    log('═══════════════════════════════════════════════════════');

    // ─── Auto-correcció de tcRef.offset si la confiança és alta ──────────
    // Si confidence >= 75 i hi ha almenys 2 coincidències vàlides,
    // actualitzar tcRef.offset per eliminar la deriva sistemàtica.
    if (confidence >= 75 && validDeltas.length >= 2 && meanDelta !== null) {
        const correctedOffset = tcRef.offset - meanDelta;
        log(`🔧 [Footprint] Auto-corregint tcRef.offset: ${tcRef.offset.toFixed(3)}s → ${correctedOffset.toFixed(3)}s (deriva=${meanDelta.toFixed(3)}s)`);
        tcRef.offset = correctedOffset;
        window.FASTPASS_UI.State.tcRef = tcRef;
    } else if (confidence < 50) {
        log(`⚠️ [Footprint] Confiança baixa (${confidence}/100). tcRef.offset NO es corregeix automàticament.`);
    }

    return {
        matches,
        meanDelta,
        stdDev,
        maxDev,
        confidence,
        counts: { exactCount, goodCount, approxCount, failCount, total }
    };
},
```

#### Quan s'executa

Aquesta funció s'ha de cridar **desprès del TROSSEJA** (quan els clips de V1 ja estan
generats) i **abans de `placeStructureMarkers`**. El lloc natural és al principi de
`placeStructureMarkers`, just después de reconstruir/confirmar `tcRef`:

```js
// Verificació footprint (debug + possible auto-correcció d'offset)
const videoItems = reader.getOnAirVideoItems(data, ctx.bloque);
if (videoItems.length > 0 && tcRef) {
    const footprintResult = this.verifyTcRefFootprint(videoItems, clips, tcRef, reader);
    // footprintResult.confidence disponible per a una futura UI de semàfor
}
```

#### Output exemple (log)

```
═══════════════════════════════════════════════════════
🔬 [Footprint Verify] tcRef.offset = -1.240s
📊 Resultats (4 ítems OnAir vs 47 talls detectats):
  🟢 [01] "SANT JORDI BARCELONA" | OnAir=21:00:00 | esperat=0.00s  | real=0.00s  | Δ=+0.000s | EXACT
  🟡 [02] "MES VENUTS"          | OnAir=21:04:02 | esperat=242.72s | real=243.08s | Δ=+0.360s | GOOD
  🟠 [03] "MOMENT DELS MES..."  | OnAir=21:05:59 | esperat=358.72s | real=361.20s | Δ=+2.480s | APPROX
  🟢 [04] "MARIANO RAJOY"       | OnAir=21:00:35 | esperat=35.00s  | real=35.04s  | Δ=+0.040s | EXACT
───────────────────────────────────────────────────────
📐 meanDelta=+0.720s | stdDev=1.102s | maxDev=2.480s
🏆 Confidence: 78/100 (EXACT:2 GOOD:1 APPROX:1 FAIL:0)
🔧 [Footprint] Auto-corregint tcRef.offset: -1.240s → -1.960s (deriva=+0.720s)
═══════════════════════════════════════════════════════
```

---

### 5.2 `js/workflows/flow_mainButton.js` — Modificació de `_runNew`

Substituir la crida a `reader.calcClipBounds(...)` per `reader.calcOnAirBounds(...)`:

```js
// ABANS:
const bounds = reader.calcClipBounds(cf.mediaStart, block.in, block.out, reader.HANDLE_SECS, cf.mediaStop);

// DESPRÉS:
const bounds = reader.calcOnAirBounds(jsonData, ctx.bloque, cf.mediaStart, cf.mediaStop, ctx.config);
```

A més, un cop el clip és inserit a Premiere (`Clips.insert` via JSX), cal obtenir
la posició real del clip i completar `tcRef`:

```js
// Obtenir posició real del clip inserit
const clipStartRaw = await callJSX(`Clips.getInPoint(1, 0)`); // track V1, índex 0
const clipStart = parseFloat(clipStartRaw);

const tcRef = {
    ...bounds.tcRef,
    clipStart: clipStart,
    offset: clipStart - bounds.inPoint
};
window.FASTPASS_UI.State.tcRef = tcRef;
log(`📐 tcRef calculat: mediaStart=${tcRef.mediaStart}s, inPoint=${tcRef.inPoint.toFixed(2)}s, clipStart=${tcRef.clipStart.toFixed(2)}s, offset=${tcRef.offset.toFixed(2)}s`);
```

**Nota:** cal implementar `Clips.getInPoint(trackIdx, clipIdx)` al costat JSX si no
existeix (retorna `clip.start` del clip en la seqüència).

---

### 5.3 `js/workflows/flow_assembly.js` — `placeStructureMarkers` (Capa 3)

#### Pas A — Calcul de `tcRef` si no existeix

A l'inici de `placeStructureMarkers`, comprovar si `FASTPASS_UI.State.tcRef` existeix.
Si no (p.ex. el projecte s'ha obert sense passar per `_runNew`), recalcular-lo a
partir del clip existent a V1:

```js
let tcRef = FASTPASS_UI.State.tcRef;
if (!tcRef && matchedClip) {
    // Reconstruir tcRef des del clip del timeline (Capa 3 - refinament)
    const msStart = reader.tcToSeconds(cleanFeed.mediaStart);
    tcRef = {
        mediaStart: msStart,
        inPoint:    matchedClip.inPoint,
        clipStart:  matchedClip.start,
        offset:     matchedClip.start - matchedClip.inPoint
    };
    window.FASTPASS_UI.State.tcRef = tcRef;
    log(`📐 tcRef reconstruït des del clip: offset=${tcRef.offset.toFixed(2)}s`);
}
```

#### Pas B — Posicionament exacte de marcadors per a ítems `teVideo`

Per als ítems amb `horaEntradaOnAir`, calcular la posició de seqüència directament:

```js
const getSeqPos = (horaOnAir) =>
    tcRef
        ? (reader.tcToSeconds(horaOnAir) - tcRef.mediaStart) + tcRef.offset
        : null;
```

A la fase 1 (ESTRUCTURALS), per a cada `line` amb `horaEntradaOnAir`:

```js
const exactPos = line.horaEntradaOnAir ? getSeqPos(line.horaEntradaOnAir) : null;
const posIdeal = exactPos !== null ? exactPos : currentStructuralPos;
```

Si `exactPos` existeix, el marcador s'hi posa **directament** (sense `snapToCut`, o
com a `idealPos` molt precís per al snap). Això és especialment valuós per als
ítems `teVideo: false` als quals no tenim `horaEntradaOnAir` però el seu `posIdeal`
s'ancoraria als veïns exactes.

#### Pas C — Actualització de `currentStructuralPos` basada en TC real

Quan el marcador s'ha col·locat amb `exactPos`, usar `horaEntradaOnAir + duradaOnAir`
com a posicionador de la posició acumulada, en lloc de la durada de l'escaleta:

```js
if (exactPos !== null && line.duradaOnAir) {
    const onAirDurSec = reader.parseDurada(line.duradaOnAir);
    currentStructuralPos = exactPos + onAirDurSec;
} else {
    currentStructuralPos = posicionFinal + dSec;
}
```

---

## 6. Flux de dades complet (diagrama)

```
JSON Escaleta
  └── cleanFeed.mediaStart / mediaStop / mediaPath
  └── liniesEscaleta[*]  (tots els ítems del bloc)
      ├── teVideo:true  → horaEntradaOnAir + duradaOnAir (exactes)
      └── teVideo:false → sense horaEntradaOnAir (intro, donapas, gràfics...)
         │
         ▼
EscaletaReader.calcOnAirBounds()   ← Capes 1+2 integrades
  ├── getOnAirVideoItems()          → ítems de vídeo del bloc amb TC exacte
  ├── getNeighbourOnAirTimes()      → prevEnd / nextStart (TC dels blocs veïns)
  ├── hasNonVideoItemsBefore()      → detectar ítems no-video al principi/final
  ├── Si hasNonVideoBefore → blockOnAirStart = prevEnd  (inici real del bloc)
  ├── Si hasNonVideoAfter  → blockOnAirEnd   = nextStart (fi real del bloc)
  └── → { inPoint, outPoint, tcRef{mediaStart, inPoint} }
         │
         ▼
flow_mainButton._runNew()
  ├── Clips.insert(mp4, V1, inPoint, outPoint)
  ├── Clips.getInPoint(V1, 0)  → clipStart
  └── State.tcRef = { ..., clipStart, offset = clipStart - inPoint }
         │
         ▼
[Usuari executa TROSSEJA]  → subclips V1 generats
         │
         ▼
flow_assembly.verifyTcRefFootprint()   ← DEBUG + auto-correcció
  ├── Per cada ítem teVideo: expectedPos = onAirTC via tcRef
  ├── Cerca el tall detectat (clip.start) més proper a expectedPos
  ├── Calcula Δ (delta), qualitat (EXACT/GOOD/APPROX/FAIL) i confidence 0-100
  ├── Si confidence ≥ 75 → auto-corregir tcRef.offset (eliminar deriva)
  └── Log detallat amb taula de coincidències
         │
         ▼
flow_assembly.placeStructureMarkers()
  ├── Capa 3: reconstruir tcRef si cal (matchedClip.inPoint + matchedClip.start)
  ├── items teVideo → getSeqPos(horaEntradaOnAir) → posició exacta (tcRef corregit)
  ├── items sense OnAir → posIdeal acumulat + snapToCut (base exacta gràcies al tcRef)
  └── Marcadors col·locats correctament (intro/donapas inclosos)
```

---

## 7. Gestió del cas sense `horaEntradaOnAir`

Quan el programa no s'ha emès encara (cap ítem amb `estat: "VALIDAT"`), tots els
`horaEntradaOnAir` son `null`. En aquest cas:

1. **Fallback automàtic** via `calcClipBounds` original (comportament actual, handles = 20 s).
2. Un cop s'ha emès (escaleta actualitzada), `calcOnAirBounds` agafa el control.
3. El botó `UPDATE` (que rellegeix el JSON) beneficia automàticament de les dades
   disponibles en cada moment.

---

## 9. Fitxers a crear / modificar

| Fitxer | Acció | Detall |
|---|---|---|
| `js/core/escaleta_reader.js` | MODIFY | Nous mètodes: `getOnAirVideoItems`, `getNeighbourOnAirTimes`, `hasNonVideoItemsBefore`, `calcOnAirBounds`, `parseDurada` |
| `js/core/session_manifest.js` | **NEW** | Mòdul `SessionManifest`: `getPath`, `load`, `save`, `_empty`, `_deepMerge` |
| `js/workflows/flow_mainButton.js` | MODIFY | Substituir `calcClipBounds` → `calcOnAirBounds`; escriure manifest en cada etapa |
| `js/workflows/flow_assembly.js` | MODIFY | `verifyTcRefFootprint` + `placeStructureMarkers` amb tcRef i escriptura al manifest |
| `jsx/clips.jsx` *(o equivalent)* | MODIFY/CHECK | Verificar / afegir `Clips.getInPoint(trackIdx, clipIdx)` |
| `jsx/io.jsx` *(o equivalent)* | MODIFY/CHECK | Verificar / afegir `IO.writeTxt(path, content)` per escriptura del manifest |
| `index.html` | MODIFY | Afegir `<script src="js/core/session_manifest.js">` |

---

## 10. Pla d'implementació per fases

### Fase A — Fonaments (`escaleta_reader.js`)
- [ ] Afegir `parseDurada(str)` com a mètode del reader
- [ ] Afegir `getOnAirVideoItems(data, blockId)`
- [ ] Afegir `getNeighbourOnAirTimes(data, blockId)` — retorna `{ prevEnd, nextStart, blockStart, blockEnd }`
- [ ] Afegir `hasNonVideoItemsBefore(data, blockId)` — retorna `{ before, after }`
- [ ] Afegir `calcOnAirBounds(data, blockId, mediaStart, mediaStop, cfg)` integrant Capes 1+2 amb detecció de frontera

### Fase B — Manifest de Sessió (`session_manifest.js`) [NOU]
- [ ] Crear `js/core/session_manifest.js` amb `SessionManifest` (`getPath`, `load`, `save`, `_empty`, `_deepMerge`)
- [ ] Afegir `<script>` a `index.html`
- [ ] Verificar / afegir `IO.writeTxt(path, content)` al costat JSX
- [ ] Test: crear manifest buit, llegir-lo i desar-lo

### Fase C — Import MP4 (`flow_mainButton.js`)
- [ ] Substituir `calcClipBounds` → `calcOnAirBounds` a `_runNew`
- [ ] Post-insert: llegir `clipStart` i emmagatzemar `tcRef` a `State` **i al manifest**
- [ ] Desar al manifest: `program`, `cleanFeed`, `blockBounds`, `tcRef` (parcial), `escaletaItems` (sense `resolved`)
- [ ] Marcar `phases.boundsCalculated`, `phases.mp4Imported`, `phases.tcRefEstablished` al manifest

### Fase D — Marcadors i Footprint (`flow_assembly.js`)
- [ ] `verifyTcRefFootprint`: desar resultat a `manifest.footprintVerification` + marcar `phases.footprintVerified`
- [ ] `placeStructureMarkers`:
  - [ ] Implementar `getSeqPos(horaOnAir)` usant `tcRef` (corregit per footprint)
  - [ ] Reconstruir `tcRef` des del manifest si no existeix a `State`
  - [ ] Aplicar `exactPos` per a ítems amb `horaEntradaOnAir` (mètode `ONAIR_EXACT`)
  - [ ] Aplicar `ACCUMULATED_SNAP` per a ítems sense `horaEntradaOnAir`
  - [ ] Desar `resolved` (sequencePos, method, color, footprintDelta, quality) per a cada ítem al manifest
  - [ ] Marcar `phases.markersPlaced = true` al manifest
- [ ] Desar `clips[]` al manifest després de llegir els subclips de V1

### Fase E — Auto-placement de Chyrons (`flow_assembly.js`)
- [ ] `runAutoPlacement`: desar `chyrons[]` per a cada ítem al manifest
- [ ] Marcar `phases.chyronsPlaced = true` al manifest

### Fase F — JSX bridge
- [ ] Verificar existència de `Clips.getInPoint` al costat JSX
- [ ] Afegir-lo si cal (retornar `clip.start` del clip `clipIdx` a la pista `trackIdx`)
- [ ] Verificar / afegir `IO.writeTxt(path, content)`

### Fase G — Proves i validació
- [ ] Provar amb el JSON `TN_VESPRE_20260423_213005.json` (dades reals)
- [ ] Verificar que el manifest es crea i actualitza en cada etapa
- [ ] Verificar que en recarregar el panel, `tcRef` es recupera del manifest
- [ ] Verificar `footprintVerification` al manifest amb dades reals
- [ ] Verificar marcadors: ítems `teVideo` col·locats exactament, method = `ONAIR_EXACT`
- [ ] Verificar ítems sense OnAir: method = `ACCUMULATED_SNAP` amb `snapDelta` correcte
- [ ] Verificar `chyrons[]` per ítem al manifest després de `runAutoPlacement`

---

## 10. Notes tècniques

### Format `duradaOnAir`

El format és `"M:SS"` (no `"HH:MM:SS"`):
- `"0:18"` → 18 s
- `"1:59"` → 119 s

`parseDurada` ha de distingir-ho de `durada` (que pot ser `"0:00"`) i del TC `"HH:MM:SS:FF"`.

### Format `horaEntradaOnAir`

`"HH:MM:SS"` sense frames. El mètode existent `tcToSeconds` ja el suporta.

### Precisió del mediaStart

`mediaStart` al `cleanFeed` té format `"HH:MM:SS:FF"` (amb frames).  
`tcToSeconds` ja suporta 4 parts → precisió a nivell de frame (1/25 s).

### Robustesa

Si un ítem té `horaEntradaOnAir` però `duradaOnAir` és `null`, usar `durada` de l'escaleta
com a fallback per calcular `blockOnAirEnd`.

---

*Fi del pla v0.4 · Pròxima acció: aprovació → Fase A*
