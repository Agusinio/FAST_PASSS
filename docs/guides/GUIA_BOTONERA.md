# 🕹️ Guia de Funcionalitats: Botonera FAST >>> PASS

Aquest document detalla la funció de cada element de la interfície del panel, ara que el sistema ha estat estabilitzat a la versió **9.0.0**.

---

## ⚙️ Secció: SETUP
Aquesta secció controla el context del projecte i la configuració base.

*   **Icona Engranatge (⚙️)**: Obre el modal de configuració global. Aquí es defineixen les rutes del NAS per a les plantilles, els rètols (Wott), els vídeos/SRT de la verticalització, els conductors i la carpeta on es desaran els nous projectes.
*   **PROG (Selector)**: Tria el programa (Ex: TN MIGDIA, MATINS). Això activa el filtratge automàtic de fitxers al NAS perquè l'importació només porti el material del programa corresponent.
*   **BLOC (Selector)**: Tria el bloc d'emissió (V1, V2, V3, V4). Ajuda a la nomenclatura de fitxers i a la organització de carpetes.
*   **COND (Selector)**: Permet triar el conductor/a manualment. Si no es tria res, el botó **OUT** n'escollirà un per defecte segons el programa (Ex: Toni Cruanyes per al TNV).
*   **Botó NOU**: 
    - Analitza el NAS buscant fitxers `.mov`, `.mp4` i `.srt` recents.
    - Crea un projecte nou a partir de la plantilla oficial.
    - Importa el material i munta automàticament el vídeo brut en V1, el màster de rètols en V2 i els subtítols inicials.

---

## 🎬 Secció: VÍDEO
Eines d'edició ràpida al Timeline.

*   **IN**: Tall ràpid (Ripple Trim). Retalla tot el clip des de l'inici fins on estigui el cabezal (CTI) i desplaça el resultat al segon zero de la seqüència.
*   **TROSEJA**: *Funció de tall per escenes o segments (en desenvolupament).*
*   **OUT**: Tanca la peça. 
    - Neteja les pistes V1, V2 i V6 a partir del punt de tall.
    - Ajusta els punts de sortida de la seqüència.
    - Col·loca el conductor automàticament en V4.
    - Desa el projecte.
*   **◀ / ▶**: Navegació ràpida entre el clip anterior i el següent de la pista activa.
*   **Slider (Posició X)**: Permet moure horitzontalment el vídeo de la pista V1 en temps real. Molt útil per re-enquadrar cares o accions en el format vertical 9:16. Fent **doble clic** es reseteja al centre (304px).
*   **KEY**: *Toggle de keyframes sobre el clip SELECCIONAT: sense key a l'instant del CTI → el crea (mode keyframe); amb key ja existent → l'elimina. En canviar de clip s'adopta el mode d'origen del clip (sense keyframes → slider; amb keyframes → keyframe).*

---

## 🎨 Secció: GRÀFICS
Automatització de la retolació.

*   **RÈTOLS**: El botó intel·ligent per excel·lència. Llegeix el contingut dels fitxers `.mov` importats a la carpeta "CHYRONS" i els col·loca al Timeline en la posició exacta segons el seu timestamp. Diferencia entre:
    - **V4**: Temes i Chyrons de nom.
    - **V6**: Llocs.
    - **V7**: Grafismes de suport.
*   **FONS 16:9**: Si el vídeo original és horitzontal, aquest botó l'escala al 47% per encabir-lo en l'ample del vertical i afegeix un fons decoratiu a la pista V1 per sota del clip.

---

## 📝 Secció: SUBTÍTOLS
Gestió de les pistes de text (SRT).

*   **PREPARAR**: Activa el mode de treball de subtítols. Bloqueja totes les pistes de Premiere excepte les de text per evitar moviments accidentals de vídeo mentre s'editen rètols.
*   **IN / OUT**: Ajusta els punts d'entrada i sortida del clip de subtítols seleccionat basant-se en la posició actual del cabezal.
*   **AJUSTAR (Acordió)**: Si tens un bloc de subtítols i no encaixen amb la durada de la veu, selecciones els clips i prem aquest botó; el sistema els estirarà o encollirà de forma proporcional perquè quadrin perfectament amb el temps marcat pel cabezal.

---

## 📤 Secció: RENDER
Sortida final de material.

*   **VÍDEO**: Envia la seqüència a Adobe Media Encoder amb el preset oficial H264 1080x1920 (Vertical). El fitxer es desarà a la carpeta de projectes amb el nom de la seqüència i l'hora actual.
*   **PORTADA**: Genera una imatge PNG del frame actual del cabezal i la desa a la carpeta de portades per fer-la servir a les xarxes socials.

---

© 2026 FAST >>> PASS Development Team
