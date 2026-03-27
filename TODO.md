# FAST PASS - TODO & PENDING REVIEWS

## 🎬 Logic & Parsing
- [ ] **TemaTitol Selection**: Review the "Uppercase-only" logic for selecting the main title.
- [x] **LINEA Identification (v12)**: El parser ara diferencia entre `lead`, `i`, `base` i aplica l'ordre jeràrquic.
- [x] **Heurística de Classificació (v13)**: Clips >10s = Intro/Lead. Clips < 10s = Video. [FET]
- [ ] **Multi-Theme Support**: A single piece can have multiple Tema-Titols. 

## ✂️ Assembly & Scene Detection
- [x] **Block Classification (Heuristics)**: Implementat en el workflow d'assemblatge amb regles de durada.
- [x] **The Magic (Footprint Matching)**: Sincronització automàtica de rètols amb els talls reals de V1.
- [x] **Track Targeting**: V1 seleccionat abans del Scene Detection.
- [x] **Auto Reframe**: Aplicació automàtica a intros i inserts (>2.5s).
- [x] **Slider Limits**: Límits físics per evitar negres.
- [ ] **Boundary Detection**: Use the TC of the last chyron for better estimate of block end.

## 📁 NAS & File System
- [ ] **NC Files / Sync**: Review how "wotts" and "mp4" are synchronized when names have slight differences.

© 2026 FAST >>> PASS
