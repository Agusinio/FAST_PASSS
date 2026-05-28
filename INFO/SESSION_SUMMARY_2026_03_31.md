# Resum de la Sessió: 31 de Març de 2026

## 🚀 Refactorització "LIPO" i Estabilització del Workflow de Projectes

Aquesta sessió ha estat centrada en la consolidació de la lògica de creació i actualització de projectes (`NEW`, `UPDATE`, `LOAD`, `GO`), movent el "múscul" cap a capes de lògica modulars i simplificant els workflows.

### 1. Canvis Arquitectònics (Capes)

-   **Workflow (`flow_mainButton.js`)**: S'ha "aprimat" dràsticament. Ara actua com un orquestrador pur que:
    -   Fa servir un ajudant `_fullScan` per obtenir rètols, media i portades d'un sol cop.
    -   Actualitza els indicadors de "missing" al Context per a reportar a la UI externa.
    -   Delega la ingesta i el muntatge inicial a la capa de Lògica.
-   **Action Logic (`Project_Logic.js`)**: S'ha convertit en el motor central d'infraestructura.
    -   Nova funció `ingestAssets`: Unifica la ingesta de materials des del NAS (Wotts, MP4, SRT i PNG Portada).
    -   Lògica "Safe" de Bins: Els rètols es mouen al bin `CHY` un a uno per evitar duplicats i mantenir l'ordre.
-   **System/JSX (`3_Project.jsx`)**: S'ha fet més robust afegint `decodeURIComponent` a totes les crides de cerca i reanomenat de projectes/secuències, evitant errors amb caràcters especials.

### 2. Millores en el Flux Operatiu

-   **Suport de Portada (PNG)**: S'ha integrat l'escaneig d'un fitxer PNG que contingui "TEMA-TITOL" en el seu nom. Aquest fitxer s'importa automàticament a l'arrel del projecte.
-   **Auto-Insert en UPDATE/LOAD/GO**: 
    -   Si el sistema detecta que la pista **V1** està buida al fer un `UPDATE`, `LOAD` o `GO`, col·loca automàticament el vídeo MP4 a l'inici.
-   **Fix de Focus (Edit Mode)**: En finalitzar qualsevol acció del botó principal, el sistema activa automàticament el **targeting (foco)** de les pistes **V1** i **A1**, deixant-les llestes per a l'edició immediata.
-   **Gestió del Bloqueig (.lock)**: S'ha centralitzat la creació i manteniment del fitxer de bloqueig dins de `Project_Logic`, assegurant que qualsevol via d'entrada al projecte (creació o càrrega) protegeixi l'edició per a l'usuari actual.

### 3. Estat de l'Arquitectura (LITERAL & DRY)

-   S'han eliminat funcions redundants com `_createLock` del workflow.
-   S'ha corregit el problema de `cloneSeq` que fallava en versions anteriors en no trobar el mètode `getSequence`.
-   S'ha normalitzat l'ús de rutes amb barres `/` per a la comunicació entre JS i JSX, eliminant conflictes de caràcters d'escapament.

---
*Aquest document ha estat generat per Antigravity per a documentar l'estabilització del workflow de projectes.*
