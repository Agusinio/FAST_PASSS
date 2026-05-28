# FLUX OPERATIU: FAST >>> PASS (Roadmap v2.6.0 - Stabilized)

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
    -   **Detecció Reactiva**: El panell detecta automàticament quan l'usuari canvia de pestanya de projecte a Premiere (via polling de 500ms).
    -   **Filtrat de Compatibilitat**: Analitza si el projecte enfocat és un projecte de FAST>>>PASS basat en els tokens de configuració.
    -   **UI Dinàmica**: Si el projecte no és compatible, el panell es desactiva ("Inactiu") per evitar errors.
2.  [IMPLEMENTAT] **Contextual Safety (Anchoring)**: 
    -   Totes les funcions JSX usen un helper central `getWorkSequence()` que garanteix que l'operació s'executa en el projecte ancorat pel panell, independentment de quin projecte tingui el focus visual en aquell moment.
3.  [IMPLEMENTAT] **Escaneig Unificat**: A través de `Scanner.js` (wotts, media, portada). Es reporta a `Context.missing` per a feedback a la UI.
4.  [IMPLEMENTAT] Bloqueig d'Usuari: Verificació de fitxer .lock en disc. Centralitzat a `Project_Logic.lock`. 
5.  Botó Principal (Main Action):
    -   Label: Canvia segons l'estat (NOU, OBRIR, ANAR-HI, ACTUALITZAR).
    -   Feedback: Indicador de Context (caixa amb 4 llums) basat en `Context.missing`.

---

## FASE 2: Acció Principal (flow_mainButton.js)
L'usuari executa l'acció (ex: NOU):
1.  **Orquestració Lògica**: Delegada a `Project_Logic.create` i `ingestAssets`.
2.  **Ingesta de Portada (TEMA-TITOL)**: [IMPLEMENTAT] Importació automàtica del PNG de portada a l'arrel del projecte.
3.  **Auto-Insert**: [IMPLEMENTAT] Si la línia de temps està buida (V1 count 0), es col·loca el MP4 al segon 0. Actiu per a UPD, LOAD y GO.
4.  **Edit Focus**: [IMPLEMENTAT] Després de qualsevol acció, les pistes V1 i A1 queden activades (targeting) per a l'edició immediata.

---

## FASE 3: Edició i Tall (flow_cut.js)
1.  [IMPLEMENTAT] **CutIn**: Ripple trim in des de cabezal fins a l'inici.
2.  [IMPLEMENTAT] **CutOut**: 
    -   Elimina cues de material a partir del CTI.
    -   **Tancament de Seqüència**: Posiciona cabezal a -1 frame i fa setSequenceOut per evitar frames negres.
3.  [IMPLEMENTAT] **Trosseja (The Magic)**: 
    -   **Scene Detection**: Troseja el clip de V1.
    -   **Assemblatge Màgic**: Alinea automàticament els rètols dels Wotts amb els talls reals del timeline usant inferència de "Footprint" (deriva temporal).
    -   **Snap Magnètic**: Els rètols s'imanen al tall de càmera més proper per a una sincronia perfecta.
4.  [IMPLEMENTAT] **Navegació (< / >)**: Salt entre clips del timeline.

---

## FASE 4: Grafismes i Rètols (flow_retols.js)
1.  [IMPLEMENTAT] **Col·locació d'Intro**: 
    -   Regla de 10 frames de seguretat al començament.
    -   Decalatge de 6.3s per al conductor en intros llargues (>10s).
2.  [IMPLEMENTAT] **Auto Reframe Intel·ligent**: 
    -   Aplicació automàtica de l'efecte "Auto Reframe" en clips de **Intro** i **Inserts** (clips amb NomCarrec o Firma).
    -   Filtre de seguretat de **2,5 segons** de durada mínima per evitar errors de processament.
3.  [IMPLEMENTAT] **Control de Posició (Slider)**: 
    -   Slider horizontal amb **Límits Físics Dinàmics**: El moviment es bloqueja automàticament abans de mostrar fons negre, calculant el marge segons l'escala del clip.
4.  [PENDENT] **Botó Fons**: Col·loca fons sota el clip a V3 sense tocar el clip original.

---

## FASE 5: Subtítols (flow_srt.js)
1.  [LOGICA A REVISAR] Preparar: Crea el track de subtítols usant les caixes d'In i Out de la UI.
2.  Ajustar: Lògica d'acordió (Acabat).

---

## FASE 6: Sortida Final (flow_render.js)
1.  Vídeo: Exportació del tram de treball amb títol i destí definits. 
2.  Portada (PNG): 
    -   [IMPLEMENTAT] Ingesta inicial del PNG "Tema-Titol".
    -   [PENDENT] Exportació del PNG final a destí aïllant tracks V1 i V3.

---
© 2026 FAST >>> PASS | Documentació Operativa v2.6.0 (Stabilized)
