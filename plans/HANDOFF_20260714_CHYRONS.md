# HANDOFF: CHYRONS — 14/07/2026

## ✅ Estat actual

### Subgrup CHYRONS (7 botons a `index.html`)

| Botó | Funció | Track | Mecanisme | Estat |
|------|--------|-------|-----------|-------|
| **Titol** | `placeChyronTitol` | V5 | Freeze-frame: inserta Wott → aïlla V5 → snapshot QE directament a `Projecte/Snapshots/` → PNG a CHY → animació 8s + estirat fins al següent Tema‑Titol o Out Point. **Detecta conductor a V6**: si existeix al mateix clip, calcula marge → Cas A (0:10) o Cas B (4:20). Cerca el Tema‑Titol per base numèrica (01 → 01dp). | ✅ |
| **Conductor** | `placeChyronConductor` | V6 | Llegeix del desplegable SETUP. Cerca primer marcador aparellable per base numèrica (01 → 01dp, 01i...). Calcula marge amb **tots** els marcadors ordenats. Cas A (marge ≥ 11.04s): conductor a 6:16. Cas B: conductor a 0:10. | ✅ |
| **Lloc** | `placeChyronLloc` | V7 | `_placeChyronsByType`: snap al tall V1 + TC, filtre per rol LLOCDATA. | ✅ |
| **Nom** | `placeChyronNom` | V6 | `_placeChyronsByType`: snap al tall V1 + TC, filtre per NOMCARREC. | ✅ |
| **Traducció** | `placeChyronTraduccio` | V3 | Agrupa per TC, distribueix uniformement sobre clip V1 saltant flashes. | ✅ |
| **Resto** | `placeChyronResto` | V6 | Captura residual (tot el no capturat pels altres 5). | ✅ |
| **Repartir** | `repartirChyronTraduccio` | V3 | Redistribueix traduccions seleccionades sobre V1 seleccionats. | ✅ |

### Constants (25fps)
- Marge inici: **0:10** (0.40s)
- Animació Tema‑Titol: **6:06** (6.24s)
- Animació Conductor: **4:10** (4.40s)
- Marge mínim Cas A: **11:01** (11.04s)

### Comportament Conductor + Tema‑Titol
```
1. Tema‑Titol SEMPRE al principi del bloc (clipStart + 0:10) PER DEFECTE
2. Conductor només si hi ha un element intro/dp/off/lead (NO dir) al bloc
3. Conductor es col·loca al PRIMER element d'aquest tipus
4. Si el conductor està al mateix clip V1 que el Tema‑Titol:
   - Cas A (marge ≥ 11.04s): Tema‑Titol 0:10, Conductor 6:16
   - Cas B (marge < 11.04s): Conductor 0:10, Tema‑Titol 4:20
5. Font del conductor: desplegable SETUP (Conduct_XXX.mov)
```

### Últims commits a `origin/main`
| Commit | Descripció |
|--------|------------|
| `c6d5931` | Titol detecta conductor altra vegada (Cas A/B) |
| `4ac3631` | Titol sempre al principi + cerca per base numèrica |
| `68cb9f2` | Titol cerca per base numèrica quan no té entry directe |
| `28bc22b` | Conductor cerca per base numèrica (01 → 01dp) |
| `bab2d29` | stretchEnd simplificat (sense clipV1) |
| `79c495f` | snapshot directe a Snapshots/ del projecte (sense C:\temp\) |
| `fc82bbb` | allMarkers ordenats a Conductor + Titol |

### Organització del codi
- `js/workflows/flow_chyrons.js`: Tot chyrons (7 botons + helpers)
- `js/workflows/flow_graphics.js`: Gràfics genèrics
- `js/workflows/flow_markers.js`: F1‑F6 marcadors + anàlisi
- `js/workflows/flow_retols.js`: Obsolet
- `jsx/modules/9_Render.jsx`: Fix `var FASTPASS = $.global.FASTPASS` + timecode per snapshot + crea carpeta Snapshots/

## 🟡 Pendent per a la propera sessió
- Comprovar que els botons Conductor, Titol, Lloc, Nom, Traducció, Resto, Repartir funcionen en:
  - TNV V1 (01dp sense conductor → Titol a 0:10)
  - TNV V4 OFF (34f amb conductor → Conductor a 0:10, Titol a 4:20)
  - TNM V2 (08i amb conductor, marge suficient → Cas A)
  - TNV V4 (intro amb conductor) 
- `flow_retols.js` esborrar (tot el codi s'ha mogut a flow_chyrons.js)
- `main.jsx` conté `exportFramePNG` que ja no s'usa (ara es fa via `Render.snapshot`)