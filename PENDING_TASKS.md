# MODIFICACIONS PENDENTS: FAST >>> PASS
Ordenades de menor a major dificultat. Actualitzat: 22/03/2026.

---

## 🟢 FÀCILS (1 arxiu, canvi quirúrgic)

| # | Què | On |
|---|-----|----|
| 1 | Afegir `13_Parser.js` al `index.html` | `index.html` (1 línia) |
| 2 | Eliminar classes de color del botó principal | `4_Context.js` → `updateButton()` + `style.css` |
| 3 | Guardar `activeSequenceName` al `State` | `4_Context.js` → `checkContext()` + `state.js` |
| 4 | Afegir ruta de portades al Config | `config.js` → objecte `rutas` |

---

## 🟡 MITGES (2-3 arxius, lògica nova)

| # | Què | On |
|---|-----|----|
| 5 | Auto-verificació de seqüència activa | `utils.js` (helper) + `flow_cut.js`, `flow_render.js` |
| 6 | Portada PNG Pro (aïllament de pistes) | `flow_render.js` + `5_Tracks_Logic.js` |
| 7 | CutOut Pro (col·loca Tema + Conductor) | `flow_cut.js` → `runCutOut()` |
| 8 | Indicador de Context (4 llums) | `index.html` + `4_Context.js` |
| 9 | Botó Fons (col·locar clip a V3) | `flow_retols.js` + `main.js` + `index.html` |
| 10 | Autocentrat automàtic (KF centrat) | `7_KF.jsx` (àtom) + `7_KF_Logic.js` |

---

## 🔴 DIFÍCILS (investigació + múltiples arxius)

| # | Què | On |
|---|-----|----|
| 11 | Bloqueig d'usuari (.lock) | `1_SourceAssets.js` + `4_Context.js` |
| 12 | Taula d'Estructura (orquestrar el Parser) | `flow_mainButton.js` + `13_Parser.js` + `state.js` |
| 13 | Col·locació Intel·ligent anti-col·lisió | NOU `8_Graphics_Logic.js` + `flow_retols.js` |
| 14 | Reubicació de botons a la UI | `index.html` + `style.css` (redisseny UI) |

---

> Consell: Ataca primer els verds (1-4). Són canvis de minuts i consoliden la base per als següents.

© 2026 FAST >>> PASS | Llista de Pendents v1.0
