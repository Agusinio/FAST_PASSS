# Pla d'implementació: IN, OUT i AJUSTAR per a subtítols (SRT)

## Context
Els tres botons de subtítols (IN, OUT, AJUSTAR) utilitzen `createCaptionTrack(item, startTime)` per inserir el fitxer `.srt` a una caption track. Com que **l'API ExtendScript no exposa `subtitleTracks`** (ni lectura ni escriptura directa), la mecànica per modificar subtítols requereix:

1. **Exportar FCP XML** (ja funciona)
2. **Llegir el .srt original** (ja funciona)
3. **Processar les dades** (parsejar XML i SRT, correlacionar, modificar)
4. **Crear un fitxer `_MOD.srt`** al directori del projecte
5. **Importar el `_MOD.srt` al projecte** (via `IO.importFiles` o `Project.bin` + `importFiles`)
6. **Reinsertar amb `createCaptionTrack`** (ja funciona)

## Pre-requisits ja funcionals

### PREPARAR
- `flow_srt.js` → `runPreparar()`:
  - Cerca el `.srt` al projecte (root)
  - Desa **`state.srt.mediaPath`** (path complet al NAS/ex. `\\192.168.147.199\public\...\file.srt`)
  - Desa **`state.srt.name`** (nom del fitxer)
  - Crida `seq.createCaptionTrack(item, 0)` (OK)
  - Habilita botons IN/OUT

### IN (esquelet)
- `flow_srt.js` → `runSrtIn()`:
  - Obté `CTI` (cabezal) ✅
  - Exporta `FCP XML` al directori del projecte ✅
  - Llegeix `.srt` original via `IO.readTxt(escapedPath)` ✅
  - Parseja SRT a `entries[{index, timeStr, texts[]}]` ✅
  - Pendent: lògica de filtrat i reimportació

### Funcions inline JSX disponibles
| Crida | Funció |
|-------|--------|
| `Timeline.get()` | Obté CTI |
| `Context.folder()` | Directori del projecte |
| `IO.readTxt(path)` | Llegeix fitxer text |
| `IO.writeTxt(path, content)` | Escriu fitxer text |
| `IO.importFiles(paths, binName)` | Importa fitxers |
| `FASTPASS.Project.find(name)` | Cerca item al projecte |
| `seq.createCaptionTrack(item, start)` | Insereix SRT a caption track |
| `seq.exportAsFinalCutProXML(path, 1)` | Exporta FCP XML |

## Lògica IN (per implementar)

### Flux complet

```
1. CTI = Timeline.get()                    ← ja fet
2. Exportar XML = seq.exportAsFinalCutProXML  ← ja fet
3. Llegir .srt = IO.readTxt(path)            ← ja fet
4. Parsejar SRT → entries[]                  ← ja fet

5. Llegir XML via JSX o JS pur:
   - El XML és un string FCP XML estàndard
   - Conté <caption> elements dins de <media> <track>
   - Cal extreure: {start, end, text} de cada caption

6. WAIT! Simplificació sense XML:
   JA tenim la posició del cabezal (CTI) en segons
   IJA tenim el path del .srt (state.srt.mediaPath)
   IEls captions SRT tenen timings absoluts (hora del programa ex: 01:23:45,678)
   => Podem usar el CTI directament per saber quina part del SRT eliminar?

   Problema: els timings SRT són absoluts (hora real), el CTI és relatiu al timeline.
   Però si tenim l'FCP XML, podem obtenir el temps real (world time) dels captions.
   
   Solució simplificada:
   a) Llegir XML
   b) Extreure primer caption i el seu start en segons (startSec)
   c) Comparar amb CTI per determinar si estem a l'inici del primer caption, 
      entremig, o al final
   d) + info: XML conté <duration> de la seqüència i captions

7. Processar entries[]:
   - Ordenar per index
   - Trobar l'entrada SRT que correspon a la posició del CTI
   - Marcar entrada target
   - Entrades ANTERIORS al target → eliminar
   - Entrades POSTERIORS → preservar
   - Nova primera entrada → moure start a frame 10 (0.4s)

8. Crear _MOD.srt:
   IO.writeTxt(path_MOD, srtContent_MOD)

9. Importar _MOD.srt al projecte:
   IO.importFiles([path_MOD], "ROOT")

10. Obtenir nom del _MOD.srt importat:
    FASTPASS.Project.find("..._MOD.srt")

11. Reinsertar amb createCaptionTrack:
    seq.createCaptionTrack(item_MOD, 0)

12. (Opcional) Esborrar caption track anterior
```

## Lògica OUT (per implementar)

```
Flux idèntic a IN, però:
- Entrades ANTERIORS al target → preservar
- Entrades POSTERIORS al target → eliminar
- NO moure la primera entrada al frame 10
```

## Lògica AJUSTAR (per implementar)

```
1. L'usuari SELECCIONA captions al timeline
2. Exportar FCP XML
3. Des del XML, identificar captions seleccionats (però el XML no sap què està seleccionat!)
   Alternativa: que l'usuari especifiqui un text o número d'entrades

Segons el teu disseny original:
- L'usuari col·loca el cabezal on vol que acabi el bloc
- La lògica calcula:
  - firstIn: primer caption seleccionat
  - lastOut: darrer caption seleccionat
  - currentDur = lastOut - firstIn
  - durIdeal = CTI - firstIn
  - ratio = durIdeal / currentDur
  - Cada caption es reescala proporcionalment
  - padding = 0.04s entre captions

- S'escriu _MOD.srt amb els nous timings
- Es reimporta i reinsereix
```

## Variables d'State

```javascript
state.srt = {
  name: "file.srt",           // Nom del fitxer
  mediaPath: "\\nas\...",     // Path complet al NAS
}
```

Es necessitarà afegir:
```javascript
state.srt.modName = "file_MOD.srt"   // Nom del fitxer modificat
state.srt.modPath = "..."             // Path del _MOD.srt
```

## Parsing SRT (ja implementat)

```javascript
const entries = []; // { index: 1, timeStr: "00:00:10,000 --> 00:00:15,000", texts: ["Línia 1", "Línia 2"] }
```

## Parsing FCP XML (per implementar)

El XML té estructura:
```xml
<xmeml version="4">
  <sequence>
    <media>
      <video>
        <track>
          <clipitem>
            <name>...</name>
            <start>3600</start>     <!-- ticks? segons? -->
            <end>7200</end>
            <in>0</in>
            <out>3600</out>
          </clipitem>
        </track>
      </video>
    </media>
  </sequence>
</xmeml>
```

Cal explorar si hi ha `<caption>` tags dins de `<subtitle>` tracks. Si no, potser cal extreure del tag `<story>` o del nom dels clips.

## Temps i riscos

| Risc | Impacte | Mitigació |
|------|---------|-----------|
| FCP XML no inclou captions | Alt | Provar amb un XML real; si no, alternativa: parsejar directament el .srt |
| Correlació timings complexa | Mig | Simplificar: usar ordre seqüencial d'entrades |
| IO.readTxt falla en paths UNC | Mig | Escapar correctament (ja es fa) |
| IO.writeTxt sobre xarxa | Mig | Usar directori temporal local si falla |

## Resum de fitxers a modificar

| Fitxer | Funció | Canvis |
|--------|--------|--------|
| `js/workflows/flow_srt.js` | `runSrtIn()` | Implementar la lògica completa |
| `js/workflows/flow_srt.js` | `runSrtOut()` | Implementar (similar a IN) |
| `js/workflows/flow_srt.js` | `runTimeAdjust()` | Implementar (escalat proporcional) |
| `js/logic/10_Srt_Logic.js` | `srtToEntries()`, `entriesToSrt()`, `applyTrimIn()`, `applyAdjust()` | Funcions de processament |

## Tests de verificació

1. Fer PREPARAR amb un projecte que tingui .srt
2. Posar cabezal sobre un caption concret
3. Clicar IN
4. Verificar que al timeline desapareixen els captions anteriors
5. Verificar que el primer caption restant comença al frame 10
6. Repetir amb OUT
7. Repetir amb AJUSTAR