# SNAPSHOT DE MARCADORS — com s'han col·locat (16/09/2026)

> Referència per repassar després. Quan moguis els marcadors "al seu lloc real",
> aquí tens com els va deixar la extensió i amb quin criteri.

---

## 1. COM es col·loquen (mecanisme real del codi)

Pipeline del botó **OUT** en mode TREBALL (`main.js → runFullPipelineOut`), en aquest ordre:

| # | Fase | Funció | Criteri | Color |
|---|---|---|---|---|
| 0 | OUT · recorte i neteja | `Cut.runCutOut` | retalla la seqüència al bloc | — |
| 0b | TROSSEJA | `Cut.runScene` | divideix el clip als talls de contingut | — |
| 1 | **OnAir (F1)** | `Markers.placeOnAirMarkers` | `pos = tlClipStartSec + (OnAir_item − refF1)`; només ítems amb `horaEntradaOnAir` real (≠ `00:00:00`) | 6; ítem no agrupat: 1 |
| 2 | **Deduc (F2)** | `Markers.placeDeducedOnAirMarkers` | dedueix posicions per durades quan no hi ha OnAir (p.ex. força el 1r ítem `01i` a `00:00` si no existeix) | segons línia |
| 3 | **Prev (F3)** | `Markers.placeScheduledMarkers` | `pos = anchorEfTimelineSec + (OnAir − anchorEfectiva) + Δsnap`; només "faros" (OnAir real) | `_getColorIdx(line)` |
| 3.5 | **Correl (F3.5)** | `Assembly.correlationSnapMarkers` → `_correlationSnap` | alinea l'escala amb la densitat del vídeo; **exclou** el marcador a `0.000s` | — |
| 4 | **Density (F4)** | `Markers.snapFaroMarkers` | snap a **ruptura de densitat (DP+DIR)** si és dins de ±0,6 s, si no al **tall real** de V1 més proper; no mou si `Δ < MIN_MOVE`; no toca el marcador d'inici (`< 0,01 s`) | conserva el color |

- **UPSERT atòmic** (`8_Markers.jsx → placeByPrefixes`): si ja existeix un marcador amb el
  mateix prefix al comentari el **mou**, si no el **crea**. El prefix s'extreu del comentari
  (`"01 - TÍTOL"` → `01`).
- Per moure'ls fa **delete + create** (modificar `start.seconds` no refresca el timeline).
- El comentari sempre és `"<num> - <títol (màx. 60 caràcters)>"`.
- Els marcadors `VALID_IN` / `VALID_OUT` queden exclosos del "cocinat".

## 2. QUÈ hi havia a la seqüència (log de hui 08:55-08:57)

```
08:55:03 📍 Marcadors IN/OUT col·locats (DESACTIVAT: es delega a placeMarkers('estructura'))
08:55:24 🚀 [PIPE] Marcadors post-OUT: OUT → TROSSEJA → OnAir (F1) → Deduc (F2) → Prev (F3) → Correl (F3.5) → Density (F4)
08:57:01 🟠 [F2·Deducido] Forçant marcador 1r ítem 01i a 00:00 (no existia)
08:57:01    🟢 [F3·Coinc] Marcadors existents al timeline: 4
08:57:01    🔬 [CorrelationSnap] Excloent marcador a 0.000s (00:00)
08:57:03    🟠 [F4·Faro] Marcadors existents: 4
08:57:03 🟠 [F4·Faro] Cap marcador per ajustar (3 ja correctes). ✓ FINALITZAT.
08:57:03 🏁 [PIPE] Marcadors col·locats.
```

Resum: **4 marcadors** al timeline; 1 a `0.000s` (forçat per F2, exclòs del snap) i **3 que
ja estaven al seu lloc** (F4 no va moure res). Per tant, les posicions finals són les que
havien posat F1/F2/F3 abans del snap.

## 3. Referència de posicions: ítems del bloc amb OnAir real

Font: escaleta del projecte (`02_COMARQUES_PROJECTES\2026_09_15\...TN_COMARQUES_V2...json`,
`escaleta.ruta = FINESTRES.TN-COMARQUES.TNCOMARQUES-TREBALL`). **19 ítems amb OnAir** de 133
línies — aquests són els que generen faros F1/F3:

| NUM | OnAir | durOnAir | Títol |
|---|---|---|---|
| 01 | 13:57:22 | 0:36 | AMPLIACIÓ DE L'AEROPORT |
| 02 | 13:58:28 | 0:39 | IPD AEROPORT DEL PRAT |
| 03 | 13:59:08 | 0:48 | INSERTS PANEQUE I ALCALDE EL PRAT |
| 04 | 14:00:49 | 1:36 | NOVA ESTRATÈGIA FERROVIÀRIA |
| 05 | 14:02:39 | 1:18 | DIFERIT JUDICI CAS CARRETERES |
| 06 | 14:02:53 | 1:05 | IPD JUDICI CAS CARRETERES |
| 07 | 14:03:58 | 1:27 | QUÈ ÉS EL "CAS CARRETERES" — ADJUDICACIONS IRREGULARS OBRA PÚBLICA |
| 08 | 14:05:51 | 1:38 | SENTÈNCIA OBLIGA MONT-ROIG A RETIRAR PASSEIG JARDINS EL PARADÍS A MIAMI |
| 09 | 14:07:37 | 0:28 | DETENCIÓ PROFESSOR A BADALONA |
| — | 14:08:06 | 0:11 | ANADA A PUBLI 3CATINFO |
| — | 14:11:58 | 0:06 | TORNADA DE PUBLI 3CATINFO |
| 11 | 14:12:21 | 1:35 | POLÈMICA UNITAT ESCOLARITZACIÓ COMPARTIDA — NO COMENCEN EL CURS |
| 12 | 14:14:12 | 0:15 | ON POTS MIRAR SI LA TEVA ESCOLA ES CLIMATITZARÀ |
| 13 | 14:14:47 | 1:39 | ESTAT DEL CATALÀ A MANRESA |
| 14 | 14:16:36 | 0:17 | COMISSIÓ LLEIDA SOBRE PROHIBICIÓ BURKA EN UNA NOVA ORDENANÇA |
| 15 | 14:17:16 | 1:40 | PALAMÓS ESTUDIA ESPONGES A FAVOR DE LA BIODIVERSITAT |
| — | 14:18:56 | 0:06 | MOLINET 02 TNC 3CATINFO |
| 17 | 14:19:13 | 2:01 | ACOCOLLONAT FESTIVAL DE TERROR |
| 18 | 14:21:29 | 2:14 | PEPET I MARIETA HO DEIXEN |

(còpia en text pla: `C:\temp\fastpass_markers\items_onair_20260916.txt`)

La posició al **timeline** de cada faro = `ancla_timeline + (OnAir − OnAir_referència)`; el
`OnAir` de la taula és la referència per validar si el marcador ha quedat massa a prop o
massa lluny del punt d'emissió.

## 4. NOU: snapshot automàtic dels marcadors reals

`flow_markers.js → dumpMarkersSnapshot()` (cridat al final del PIPE de `main.js`) desa, **a
la carpeta del projecte**, el que hi ha realment a la seqüència:

- `MARCADORS_<yyyy-mm-dd_hhmm>.txt` — taula llegible: `#`, segons, `TC hh:mm:ss.mmm`, color, comentari
- `MARCADORS_<yyyy-mm-dd_hhmm>.json` — cru (`{capturedAt, count, markers:[...]}`), per a diffs

Serveix justament per a això: tenir constància de com han quedat **abans** de moure'ls a mà
i poder comparar després. Validat amb `C:\temp\fp_test_marks_snapshot.html` → 21 PASS / 0 FAIL.

## 5. 🔴 Hallazgo pendiente de repaso (relevante)

`js/logic/16_Analysis_Logic.js → _getPath()` devuelve una ruta **relativa**
(`analisis_estructura/[DD_MM]_[PROG]_[BLOQUE].json`) y `IO.readTxt/writeTxt` (ExtendScript)
la resuelve contra el **CWD de Premiere**, no contra la carpeta del proyecto. La carpeta
`analisis_estructura` **no existe en ningún sitio** (ni en el proyecto, ni en `PROVES`, ni en
el NAS de escaletas, ni en `C:\temp` ni en el perfil) ⇒ **la fase `cocinado` — que ya guardaba
num/titol/posCocinado/deltaVsCrudo — nunca se ha escrito**. Lo mismo aplica a las fases
`escaleta`, `crudo` y `usuario`. Por eso `placeCookedMarkers` da "N MARKS Cocinats" pero no
queda registro en disco.

→ Candidato claro para mañana: hacer `_getPath` absoluta (p. ej. con `Context.folder()`),
o dejar `Analysis` solo para lo que funcione y fiarse del nuevo `MARCADORS_*.txt`.

---

*FAST >>> PASS · snapshot 16/09/2026*

