# 🔧 ESPECIFICACIONS TÈCNIQUES - FAST >>> PASS

Aquest document detalla el funcionament intern de mòduls crítics com el Parser de rètols i el motor de Keyframes.

---

## 🧐 1. LÒGICA DEL PARSER (EXTRACCIÓ DE METADADES)

El sistema d'ingesta de rètols (mòdul `13_Parse.js`) utilitza patrons intel·ligents per identificar el contingut dels fitxers `.mov` exportats des d'Escaleta.

### A. Estructura de Nom de Fitxer
Els fitxers arriben amb la següent estructura (Wotts):
`[PROGRAMA]_[DATA]_[BLOC]_[ID-REDACCIO]_[TIPUS]_[TEXT-RÈTOL].mov`

### B. Classificació de ROLS
- **NOMCARREC**: Identificat quan el text conté un càrrec o professió. Es col·loca a **V4**.
- **FIRMA**: Identificat pel nom del redactor. Es col·loca a **V4**.
- **LLOCDATA**: Identificat per patrons geogràfics. Es col·loca a **V6**.
- **TEMA-TITOL**: Identificat per ser text en majúscules a l'inici del bloc. Es col·loca a **V4**.

---

## 💎 2. MOTOR DE KEYFRAMES I INTERPOLACIÓ

El re-enquadrament automàtic i el slider horitzontal utilitzen el motor de keyframes de Premiere Pro (mòdul `7_KF.jsx`).

### A. Paràmetres de Posició
- **Ample de Seqüència**: 608px (Cetre: 304px).
- **Límits del Slider**: S'apliquen guardes per evitar que el clip surti de pantalla, normalment entre 0 i 608px segons l'escala.

### B. Tipus d'Interpolació
El sistema suporta tres tipus d'interpolació per al moviment de càmera:
1. **LINEAR**: Moviment constant entre punts.
2. **BEZIER**: Moviment suau amb corbes d'entrada i sortida.
3. **HOLD**: Salt instantani entre valors (ús per a talls bruscos de re-enquadrament).

### C. Auto-Reframe Intel·ligent
S'aplica una transformació matemàtica per "verticalitzar" el contingut 16:9 a 9:16:
- **Escala base**: 47%.
- **Offset vertical**: Centrat automàtic al punt d'interès (POC) si es detecta via metadades.

---

## 📁 3. GESTIÓ DE PROJECTES (STRUCTURE)
- **Bins**: El sistema genera i organitza el material en carpetes virtuals:
    - `_SOURCE`: Clips de vídeo originals.
    - `_CHYRONS`: Master de rètols de 250MB+.
    - `_AUDIO`: Pistes d'àudio i ràdio.

---
© 2026 FAST >>> PASS | Technical Specs v1.0
