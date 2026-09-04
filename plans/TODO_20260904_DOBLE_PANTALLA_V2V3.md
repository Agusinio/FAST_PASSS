# TODO 04/09/2026: Doble Pantalla machaca V2/V3 y el clip posterior al fondo

**Creat**: 2026-09-03 (sessió MAPA ZOOM)
**Per revisar**: 2026-09-04
**Estat**: ✅ IMPLEMENTAT (03/09/2026) — **pendent de validació al timeline**

---

## ✅ Implementat (2026-09-03) — mateix mecanisme que MAPA

Aplicat a `js/workflows/flow_graphics.js`:

- **`_dpPaso1` (V1→V2)**: `Clips.duplicate` → **`Clips.insertClipFrom`** (insert amb ripple; la cola de V2 es desplaça sola) + retrim + **`_dpDevolverCola`** (retorna la cola de V2 al seu lloc).
- **`_dpPaso2` (V2→V3)**: idem amb **V3**.
- **`_dpPaso3` (fons a V1)**: si hi ha cola posterior a V1 usa **`Clips.insertClipItem`** (ripple) + `Clips.end` + devolució de la cola; si no n'hi ha, overwrite directe com abans.

Nous helpers al workflow: `_dpColaPosterior`, `_dpMesurarDelta`, `_dpDevolverCola`.

Al JSX (`6_Clips.jsx`): `insertClipItem` i `insertClipFrom` ara desactiven les **targets del tipus contrari** durant l'insert (anti-machacado simètric, igual que move/duplicate) perquè un MP4 amb àudio no insereixi/desplaci l'àudio a A1/A2.

## 🧪 Pendent de validació

- Executar Doble Pantalla **quan V2/V3 ja tenen contingut** (p. ex. després d'un MAPA) i comprovar que no es carrega res.
- Executar Doble Pantalla quan hi ha un clip **posterior al rang del fons en V1** i comprovar que queda intacte.
- Repassar la traça JSX: ha de mostrar `insertClipFrom`/`insertClipItem` (ripple) + `retrim`/`end` + `moveToRange` de retorn de la cola.
- Comprovar l'àudio (A1/A2): amb el nou anti-machacado ja no s'haurien de crear duplicats d'àudio en els inserts, però cal confirmar que la restauració d'àudio de `_dpProtegerAudio` segueix funcionant.

---

## 🔴 Context original del problema

1. **PAS1** puja clips a **V2 i V3** i **es carrega el que ja hi ha en V2** (i probablement V3).
2. **PAS3** col·loca el fons a **V1** i **es carrega el clip posterior al fons**.

Causa: el mateix mecanisme defectuós que tenia MAPA ZOOM:
- `Clips.duplicate` / `overwriteClip` re-insereix el **MP4 sencer** (projectItem) a la pista de destí → pisa tot el que hi hagi a partir del punt d'inserció.
- El fons (PNG) s'insereix amb `Clips.insert` (overwrite) amb la durada natural que decideix Premiere → si supera l'espai fins al següent clip de V1, el pisa.

## 📎 Funcions noves al JSX

- `Clips.insertClipItem(nom, pista, temps)` → insereix un item del bin amb ripple.
- `Clips.insertClipFrom(pistaOrigen, clipOrigen, pistaDestí, temps)` → insereix el projectItem d'un clip amb ripple.
- `Clips.moveToRange(pista, idx, start, end)` → recol·loca un clip (per retornar la cola).
- Nota tècnica: el trim del Out amb `Clips.end` és un trim NORMAL (no mou la cola); la devolució s'ha de fer mesurant el desplaçament real.

