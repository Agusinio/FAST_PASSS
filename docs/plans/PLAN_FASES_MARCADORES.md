# 🗺️ PLAN: SISTEMA MULTI-FASE + NETEJA + REFACTOR

> **Versió**: v3.1  
> **Data**: 2026-05-21  
> **Objectiu global**: Sistema de 5 fases progressives per a la col·locació de marcadors, neteja de codi mort, i separació de responsabilitats.

---

## 🔍 AUDITORIA DE FLOWS (Resultat Final)

### Arxius carregats per index.html (ACTIUS)
| Arxiu | Namespace | Responsabilitat |
|-------|-----------|-----------------|
| flow_mainButton.js | Workflows.MainButton | Botó "MUNTAR" |
| flow_cut.js | Workflows.Cut | Ripple Trim In/Out |
| flow_retols.js | Workflows.Retols | Chyrons marker-guided + Reset |
| flow_srt.js | Workflows.Srt | Subtítols |
| flow_render.js | Workflows.Render | Exportació MP4 + Portada |
| flow_KF.js | Workflows.KF | Keyframes + Auto Reframe |
| flow_config.js | Workflows.Config | Dashboard setup |
| flow_principal.js | Workflows.Principal | Flow principal (renombrat de flux_principal.js) |
| **flow_assembly.js** | **Workflows.Assembly** | **MEZCLA: Marcadors + Chyrons** |

### Arxius flux_* (ELIMINATS ✅)
6 arxius duplicats eliminats: flux_retols.js, flux_muntatge.js, flux_animacio.js, flux_subtitols.js, flux_exportacio.js, flux_tall.js

---

## 📋 FASES DEL SISTEMA DE MARCADORS (5 fases)

Cada clic al botó MARCADORS avança una fase (F1→F2→F3→F4→F5→F1...). El letrero muestra la fase actual.

| Fase | Nom | Descripció |
|------|-----|------------|
| **F1/5** | **Marcadores Raw** | Faros a `idealPosSec` exacte, **sense snap**. Basat purament en TC OnAir + **OnAirDeducido** (mecanisme de deducció de TCs per items sense `horaEntradaOnAir`). |
| **F2/5** | **SNAP** | F1 + `snapToCutFaro()` (±10s + REGLA CERO) |
| **F3/5** | **COINC** | F2 + D3-COINC (detecció de coincidències) + FARO-START/END |
| **F4/5** | **APROX** | F3 + greedySnapshot bidireccional (L→R i R→L) |
| **F5/5** | **COMPLET** | F4 + gràfics (Ronda 3) + validació D10/BIDIR |

---

## ✅ COMPLETAT

### FASE 1+2 — Sistema Multi-Fase (5 fases) + Neteja ✅
| # | Fitxer | Canvi | Estat |
|---|--------|-------|-------|
| 1 | `js/core/state.js:22-28` | `markerPhase: 1`, documentació 5 fases | ✅ |
| 2 | `index.html:99` | `<span id="phase-label">F1/5 Marcadores Raw</span>` | ✅ |
| 3 | `js/main.js:114-135` | PHASE_LABELS 5 fases, `advancePhase % 5` | ✅ |
| 4 | `js/workflows/flow_assembly.js:65` | `placeMarkers` default `hastaFase \|\| 5` | ✅ |
| 5 | `js/workflows/flow_assembly.js:765` | `placeStructureMarkers(hastaFase = 5)` | ✅ |
| 6 | `js/workflows/flow_assembly.js:1747-1751` | **F1 Marcadores Raw**: faros a `idealPosSec` exacte, sense snap + OnAirDeducido | ✅ |
| 7 | `js/workflows/flow_assembly.js:1786` | Guàrdia F2/5 (SNAP) | ✅ |
| 8 | `js/workflows/flow_assembly.js:2579` | Guàrdia F3/5 (COINC) | ✅ |
| 9 | `js/workflows/flow_assembly.js:2633` | Guàrdia F4/5 (APROX) | ✅ |
| 10 | `style.css:87-101` | CSS `.phase-indicator` | ✅ |
| 11 | 6 flux_* eliminats | Neteja duplicats | ✅ |
| 12 | `flux_principal.js` → `flow_principal.js` | Renombrat | ✅ |
| 13 | 9 `._*` Apple Double | Netejats de `js/workflows/` | ✅ |

### Fix OnAirDeducido — Mecanisme de deducció de TCs ✅
| # | Fitxer | Canvi | Estat |
|---|--------|-------|-------|
| 14 | [`js/core/escaleta_reader.js:1118`](js/core/escaleta_reader.js:1118) | 🆕 `_isCareta(titol)` — funció ultra-atòmica | ✅ |
| 15 | [`js/core/escaleta_reader.js:1143`](js/core/escaleta_reader.js:1143) | 🆕 `_deduceOnAirEntrada(item, allLines, data)` — algorisme de deducció | ✅ |
| 16 | [`js/core/escaleta_reader.js:1195`](js/core/escaleta_reader.js:1195) | `getItemEntradaSec(item, allLines, data)` — cadena ampliada: OnAir → OnAirDeducido → Prevista | ✅ |
| 17 | [`js/core/escaleta_reader.js:1234`](js/core/escaleta_reader.js:1234) | `getItemSortidaSec(item, allLines, data)` — propaga params a getItemEntradaSec | ✅ |
| 18 | [`js/core/escaleta_reader.js:848,861,901`](js/core/escaleta_reader.js:848) | 3 callers a calcPrecisionTrimBounds actualitzats | ✅ |
| 19 | [`js/workflows/flow_assembly.js:3321,3325`](js/workflows/flow_assembly.js:3321) | `placeMarksCrudo`: declara `allLines` i el passa a getItemEntradaSec | ✅ |

### Fixes Previs (D7-D12) ✅
| # | Fix | Estat |
|---|-----|-------|
| D7.1-D7.6 | Fixes dateDir i preservació de context | ✅ |
| D12a | Excloure ítems num="." o buit de insertLines | ✅ |
| Fix TemaTitol | structureByBlock usa entry.id | ✅ |
| Fix Tier0-IN | Cronològic en calcPrecisionTrimBounds | ✅ |
| Fix regressió V2 | `<` → `<=` en Tier0-IN | ✅ |
| Fix 1 | Separar worldBlockAnchorSec de worldBlockStartSec | ✅ |
| Fix 2 | Excloure ítems centinela de marcadors | ✅ |
| Fix D10d | Expandir segments col·lapsats | ✅ |
| Fix D10e | Guàrdia anti fals-positiu en D3-COINC | ✅ |

---

## 🔴 PENDENT

### FASE 3 — Separació flow_markers.js 🔴

Crear [`js/workflows/flow_markers.js`](js/workflows/flow_markers.js) extraient de `flow_assembly.js`:

| Funció | Línia ~ | Notes |
|--------|---------|-------|
| `placeMarkers` | 65 | Dispatcher |
| `placeStructureMarkers` | 765 | Funció sencera (~2300 línies) |
| `placeMarksCrudo` | ~3100 | Marcadors mode crudo |
| `snapToCutFaro` | ~1610 | Helper |
| `agruparEnSegmentos` | ~1815 | Helper |
| `greedySnapshot` | ~1999 | Helper |
| `snapToCut` | ~920 | Helper |
| `buildTimelineFootprint` | ~1241 | Helper |
| `buildEscaletaFootprint` | ~1284 | Helper |
| `affineRANSAC` | ~1327 | Helper |
| `matchFootprints` | ~1435 | Helper |

`_placeMagicChyrons` (l.427) es queda a `flow_assembly.js` o es mou a `flow_retols.js`.

### Altres Pendents
| # | Tasca | Estat |
|---|-------|-------|
| 12 | Implementar fix `_freezeTemaTitol` | 🔴 |
| 22 | Probar fix V1 i V2 en Premiere Pro | 🔴 |
| 27 | Probar fix D10d/D10e + multi-fase en Premiere Pro | 🔴 |

---

## 🟢 BUG RESOLT: Càlcul `idealPosSec` del faro "01" (2026-05-21)

### Descripció
El marcador del vídeo "01" es col·locava ~15s després de l'inici del clip V1 al timeline perquè `worldBlockAnchorSec` usava `horaEntradaPrevista` de "01i" (21:02:22 = 75742s) en lloc del TC OnAir real deduït (21:02:09 = 75729s).

### Dades reals (TN_VESPRE 2026-05-19, bloc V1)
| Ítem | num | durada | OnAir | dOnAir | Tipus |
|------|-----|--------|-------|--------|-------|
| SV66 MURAL | S7 | 0:13 | 21:01:39 | 0:20 | Àncora OnAir |
| CARETA TNV | . | 0:30 | — | — | Careta (10s corregits) |
| 01chy | 01chy | 0:00 | — | — | Gràfic (NO estructural) |
| 01gf1 | 01gf1 | 0:00 | — | — | Gràfic (NO estructural) |
| 01te2 | 01te2 | 0:00 | — | — | Gràfic (NO estructural) |
| Intro | 01i | 0:15 | — | — | Estructural (sense OnAir) |
| **Vídeo** | **01** | 1:46 | **21:02:37** | 1:47 | **Faro** |

### Mecanisme de resolució: OnAirDeducido (Fase "Marcadores Raw")

La nova cadena de resolució de `getItemEntradaSec()` és:
```
horaEntradaOnAir → OnAirDeducido → horaEntradaPrevista → null
```

**Algorisme [`_deduceOnAirEntrada(item, allLines, data)`](js/core/escaleta_reader.js:1143)**:
1. Cerca cap enrere en `allLines` des de l'ítem objectiu
2. Troba el primer ítem anterior amb `horaEntradaOnAir` vàlida (l'àncora)
3. Acumula duracions d'ítems intermedis **estructurals** (`durada>0`) i **caretes**
4. **Salta** ítems NO estructurals (`durada=0:00`, chyrons/gràfics) — no consumeixen temps d'emissió
5. Per caretes, usa [`_getCorrectedDuration()`](js/core/escaleta_reader.js:141) (ex: "CARETA TNV" = 10s per TNV diari)
6. `OnAirDeducido = OnAir(àncora) + Σ duracions acumulades`

**Verificació amb dades reals**:
```
OnAirDeducido("01i") = OnAir(S7 SV66 MURAL) + dOnAir(S7) + duradaCorregida(CARETA TNV)
                     = 21:01:39 + 0:20 + 0:10
                     = 21:02:09 (75729s) ✅
```

**Fórmula corregida**:
```
idealPosSec("01") = tlClipStartSec + (itemOnAirSec - anchorOnAirSec)
                  = tlClipStartSec + (75757 - 75729)
                  = tlClipStartSec + 28.00s  ✅
```

Abans: `anchorOnAirSec = 75742s` (Prevista de 01i) → offset de +15s ❌
Ara:    `anchorOnAirSec = 75729s` (OnAirDeducido de 01i) → offset de +28s ✅

---

## 🟢 BUG RESOLT: Àncora invariant `block.in` per a marcadors (2026-05-21)

### Descripció
Tots els marcadors del bloc V1 (TNVespre 2026-05-20) apareixien desplaçats ~46s cap a l'esquerra perquè l'àncora de referència usava `worldBlockAnchorSec` (21:01:38, basada en el primer ítem estructural) en lloc de `block.in` del clip cleanFeed (21:00:52).

### Invariant genèric
**`timeline pos 0 = block.in` del clip cleanFeed**. Això és cert per a QUALSEVOL bloc/programa, independentment de Tier0, caretes, o ítems previs al primer vídeo.

La fórmula corregida:
```
posTimeline = tlClipStartSec + (itemOnAirSec - blockInSec)
```

On `blockInSec` és el TC del primer frame del clip al timeline (extret de `data.cleanFeed.clips[].in`).

### Dades reals (TN_VESPRE 2026-05-20, bloc V1)
| Element | TC | Segons |
|---------|-----|--------|
| block.in (cleanFeed) | 21:00:52 | 75652s |
| worldBlockAnchorSec (S6+CARETA) | 21:01:38 | 75698s |
| Error d'àncora | — | **-46s** |

### Solució genèrica
1. **`calcOnAirBounds()` i `calcPrecisionTrimBounds()`** ([`escaleta_reader.js:619,1023`](js/core/escaleta_reader.js:619)): Cerquen `blockInSec` a `data.cleanFeed.clips` i l'emmagatzemen al `ref` del manifest.
2. **`session_manifest._empty()`** ([`session_manifest.js:96`](js/core/session_manifest.js:96)): Afegeix `blockInSec: null` al template `ref`.
3. **`placeMarksCrudo()`** ([`flow_assembly.js:3299`](js/workflows/flow_assembly.js:3299)): Usa `block.in` del cleanFeed com a àncora, amb fallback al primer OnAir → 0. Inclou logging de clips V1 per a diagnòstic.
4. **`placeStructureMarkers()`** ([`flow_assembly.js:1483`](js/workflows/flow_assembly.js:1483)): Prioritat `blockInSec > worldBlockAnchorSec > worldBlockStartSec`.

### Cadena de fallback (genèrica)
```
1. blockInSec (de data.cleanFeed.clips[id].in)  ← invariant universal
2. Primer OnAir de les línies del bloc           ← fallback si no hi ha cleanFeed
3. 0                                             ← últim recurs
```

### Fitxers modificats
| # | Fitxer | Canvi |
|---|--------|-------|
| 1 | [`js/core/escaleta_reader.js`](js/core/escaleta_reader.js) | `calcOnAirBounds()` (×2) i `calcPrecisionTrimBounds()`: afegeixen `blockInSec` al `ref` |
| 2 | [`js/core/session_manifest.js`](js/core/session_manifest.js) | Template `ref` inclou `blockInSec: null` |
| 3 | [`js/workflows/flow_assembly.js`](js/workflows/flow_assembly.js) | `placeMarksCrudo()`: cerca block.in + logging clips + àncora corregida |
| 4 | [`js/workflows/flow_assembly.js`](js/workflows/flow_assembly.js) | `placeStructureMarkers()`: prioritat blockInSec al anchor |

### Verificació amb dades reals (TNVespre V1, 2026-05-20)
```
Abans: posTimeline("01") = tlClipStartSec + (75757 - 75698) = tlClipStartSec + 59s  ❌ (46s desplaçat)
Ara:   posTimeline("01") = tlClipStartSec + (75757 - 75652) = tlClipStartSec + 105s ✅ (correcte)
```
