# FLUX OPERATIU: FAST >>> PASS (Roadmap v2.3)

Aquest document detalla el funcionament de la extensió i les millores pendents.

---

## FASE 0: L'Arrencada (Bootstrap)
1.  UI (main.js): Crida jsx_BOOTSTRAP enviant la ruta de l'extensió.
2.  JSX (main.jsx): Carrega els mòduls atòmics.
3.  [PENDENT] Monitorització: Es recuperen els dades de l'última sessió de la memòria cache.

---

## FASE 1: Descobriment i Estat (Discovery)
Mentre l'usuari tria un programa o bloc:
1.  Inspectors: SourceAssets, App i Session generen els informes.
2.  [PENDENT] Bloqueig d'Usuari: Verificació de fitxer .lock en disc. Si existeix, mostra alerta amb el nom del propietari.
3.  Botó Principal (Main Action):
    *   Label: Canvia segons l'estat (NOU, OBRIR, ANAR-HI, ACTUALITZAR).
    *   [LOGICA A REVISAR] Feedback: Només canvia habilitat / inhabilitat (sense canvis de color).
4.  [PENDENT] Indicador de Context: Caixa amb 4 llums (CHYRONS, GRAFISMO, VIDEO, SRT) que indica disponibilitat (Gris / Ambre / Verd).

---

## FASE 2: Acció Principal (flow_mainButton.js)
L'usuari executa l'acció (ex: NOU):
1.  [LOGICA A REVISAR] Bins: Els fitxers Media i Srt van directament a ROOT (arrel). No es creen carpetes extra.
2.  Mapeig de Tracks (Definitiu):
    *   V1: Mp4 original.
    *   V2: NO ES TOCA (Plantilla).
    *   V3: FONDOS (Per a grafisme).
    *   V4: TEMATITOL.
    *   V5: CHYRONS (Nom-Carrec, Firma, Mapes i Gràfiques).
    *   V6: CHYRONS LLOC-DATA.
    *   V7: NO ES TOCA (Plantilla).
    *   SRTs: Pistes de subtítols S1 i S2.
3.  [PENDENT CRÍTIC] Taula d'Estructura: Generació automàtica llegint els noms dels Chyrons (Ordre, TC, Tipus).
4.  Finalització: Tracks V1 i V2 actius per a edició. Cabezal posicionat a 0.0.

---

## FASE 3: Edició i Tall (flow_cut.js)
1.  [PENDENT] CutIn: Ripple trim in des de cabezal fins a l'inici i desplaça a zero.
2.  [REFACTORITZACIÓ] CutOut: Elimina cues, posa cabezal a -1 frame i fa setSequenceOut. (S'eliminen les automatitzacions de Conductor i Snapshots).
3.  [PENDENT] Troseja: Executa detectScene sobre el clip de V1.
4.  [PENDENT] Navegació (< / >): Salt al frame central del clip anterior o posterior.

---

## FASE 4: Grafismes i Rètols (flow_retols.js)
1.  [INVESTIGACIÓ] Col·locació Intel·ligent: Mètode automàtic via Taula d'Estructura (Fase 2) vs mètode manual CTI.
2.  [PENDENT] Autocentrat: Efecte automàtic per a clips amb insert.
3.  [PENDENT] Botó Fons: Col·loca fons sota el clip a V3 sense tocar el clip original.
4.  [PENDENT] UI: Reubicació de botons <, >, Slider i Key sota la secció de Grafisme en una caixa apart.

---

## FASE 5: Subtítols (flow_srt.js)
1.  [LOGICA A REVISAR] Preparar: Crea el track de subtítols usant les caixes d'In i Out de la UI.
2.  Ajustar: Lògica d'acordió (Acabat).

---

## FASE 6: Sortida Final (flow_render.js)
1.  Vídeo: Exportació del tram de treball amb títol i destí definits. 
2.  [PENDENT] Portada (PNG): 
    *   Aïllament de tracks V1 i V3.
    *   Moviment del TemaTitol a posició de captura.
    *   Exportació PNG a destí.

---
© 2026 FAST >>> PASS | Documentació Operativa v2.3
