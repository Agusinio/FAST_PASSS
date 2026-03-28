# FLUX OPERATIU: FAST >>> PASS (Roadmap v2.4)

Aquest document detalla el funcionament de l'extensió i les millores pendents.

---

## FASE 0: L'Arrencada (Bootstrap)
1.  UI (main.js): Crida jsx_BOOTSTRAP enviant la ruta de l'extensió.
2.  JSX (main.jsx): Carrega els mòduls atòmics.
3.  [IMPLEMENTAT] Boot & Re-scan: La extensió escaneja el NAS i Premiere a cada arrencada per garantir la sincronia del material. Els selectors de Programa i Bloc es recuperen de la cache per a major comoditat de l'usuari.

---

## FASE 1: Descobriment i Estat (Discovery)
Mentre l'usuari tria un programa o bloc:
1.  [IMPLEMENTAT] **Multi-Project Awareness**: 
    *   **Detecció Reactiva**: El panell detecta automàticament quan l'usuari canvia de pestanya de projecte a Premiere (via polling de 500ms).
    *   **Filtrat de Compatibilitat**: Analitza si el projecte enfocat és un projecte de FAST>>>PASS basat en els tokens de configuració.
    *   **UI Dinàmica**: Si el projecte no és compatible, el panell es desactiva ("Inactiu") per evitar errors.
2.  [IMPLEMENTAT] **Contextual Safety (Anchoring)**: 
    *   Totes les funcions JSX usen un helper central `getWorkSequence()` que garanteix que l'operació s'executa en el projecte ancorat pel panell, independentment de quin projecte tingui el focus visual en aquell moment.
3.  Inspectors: SourceAssets, App i Session generen els informes.
4.  [PENDENT] Bloqueig d'Usuari: Verificació de fitxer .lock en disc. Si existeix, mostra alerta amb el nom del propietari.
5.  Botó Principal (Main Action):
    *   Label: Canvia segons l'estat (NOU, OBRIR, ANAR-HI, ACTUALITZAR).
    *   [LOGICA A REVISAR] Feedback: Només canvia habilitat / inhabilitat (sense canvis de color).
6.  [PENDENT] Indicador de Context: Caixa amb 4 llums (CHYRONS, GRAFISMO, VIDEO, SRT) que indica disponibilitat (Gris / Ambre / Verd).

---

## FASE 2: Acció Principal (flow_mainButton.js)
L'usuari executa l'acció (ex: NOU):
1.  [LOGICA A REVISAR] Bins: Els fitxers Media i Srt van directament a ROOT (arrel). No es creen carpetes extra.
2.  Mapeig Jeràrquic i Estructura:
    *   **Identificació de Blocs (LINEA)**: Basat en el prefix del Wott (p.ex: `04lead` -> `04i` -> `04`).
    *   **Heurística de Classificació**:
        *   **Intro/Lead**: Clips > 10s + Chyron de Conductor + TemaTitol.
        *   **Video**: Clips < 10s (sèrie de talls curts).
        *   **Prioritat d'Ordre**: El sistema ordena automàticament: Lead (0) -> Intro (1) -> Base (2).
3.  [IMPLEMENTAT] Taula d'Estructura: Generació intel·ligent llegint els sufixos i TCs dels Wotts.
4.  Finalització: Tracks V1 i V2 actius per a edició. Cabezal posicionat a 0.0.

---

## FASE 3: Edició i Tall (flow_cut.js)
1.  [IMPLEMENTAT] **CutIn**: Ripple trim in des de cabezal fins a l'inici.
2.  [IMPLEMENTAT] **CutOut**: 
    *   Elimina cues de material a partir del CTI.
    *   **Tancament de Seqüència**: Posiciona cabezal a -1 frame i fa setSequenceOut per evitar frames negres.
3.  [IMPLEMENTAT] **Trosseja (The Magic)**: 
    *   **Scene Detection**: Troseja el clip de V1.
    *   **Assemblatge Màgic**: Alinea automàticament els rètols dels Wotts amb els talls reals del timeline usant inferència de "Footprint" (deriva temporal).
    *   **Snap Magnètic**: Els rètols s'imanen al tall de càmera més proper per a una sincronia perfecta.
4.  [IMPLEMENTAT] **Navegació (< / >)**: Salt entre clips del timeline.

---

## FASE 4: Grafismes i Rètols (flow_retols.js)
1.  [IMPLEMENTAT] **Col·locació d'Intro**: 
    *   Regla de 10 frames de seguretat al començament.
    *   Decalatge de 6.3s per al conductor en intros llargues (>10s).
2.  [IMPLEMENTAT] **Auto Reframe Intel·ligent**: 
    *   Aplicació automàtica de l'efecte "Auto Reframe" en clips de **Intro** i **Inserts** (clips amb NomCarrec o Firma).
    *   Filtre de seguretat de **2,5 segons** de durada mínima per evitar errors de processament.
3.  [IMPLEMENTAT] **Control de Posició (Slider)**: 
    *   Slider horizontal amb **Límits Físics Dinàmics**: El moviment es bloqueja automàticament abans de mostrar fons negre, calculant el marge segons l'escala del clip.
4.  [PENDENT] **Botó Fons**: Col·loca fons sota el clip a V3 sense tocar el clip original.
5.  [PENDENT] UI: Reubicació de botons <, >, Slider i Key sota la secció de Grafisme en una caixa apart.

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
© 2026 FAST >>> PASS | Documentació Operativa v2.4
