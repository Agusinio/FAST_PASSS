/**
 * ============================================================================
 * 11_Configuracio.js — Motor de Configuració Dinàmica (CONSOLIDAT v3.0.0)
 * ============================================================================
 * Fusió de config.js + 11_Configuracio.js.
 * Tracks per defecte alineats amb Profile.json.
 * IDs de programa corregits (TNCOMARQUES, TNM, TNV).
 * init() usa Utils.callJSX (disponible abans de carregar Eines).
 * ============================================================================
 */

(function () {
    var FASTPASS_UI = window.FASTPASS_UI || {};

    // Per defecte, si no hi ha Profile.json, usem aquests fallbacks
    // Tracks alineats amb Profile.json (2026-09-22, remapatge per evitar col·lisions):
    //   v_mp4:1 · v_mascara:2 (MÀSCARA · PROTEGIDA · #126) · v_fondos:3 · v_graf:4
    //   · v_graficos:5 · v_tema:6 · v_chyrons:7 · v_lloc:8
    // 🎯 TITOLET (2026-10-06 · 3a passada) — detecció del grafisme cremat (rètol mosquit)
    // al MP4 cleanFeed. Receta: màscara de color #F25F13 ±25 sobre una ROI a la part
    // baixa del frame, cobertura mínima, agrupació d'intervals per gap, ESCANEIG
    // ENDAVANT per trams i OCR (bin\ocr.ps1 → Windows.Media.Ocr, tots els idiomes en
    // una execució) per saber QUIN wott és a cada interval, amb match difús contra el
    // nom del wott. NO és cap traça de Profile.json (Profile.json no es llegeix enlloc):
    // `Config.get()` ho exposa amb aquests valors.
    //
    // 🔴 Valors RE-MESURATS al log real (TNM V1 2026-10-05, ítem 16, 12 TITOLET):
    //   · seek d'entrada a ffmpeg: 2,66→0,33 s (t=27,76) i 12,93→0,25 s (t=160,76) amb
    //     el MATEIX frame (md5 idèntic) → 33 captures: 311 s → ~10 s.
    //   · 1 captura per interval (al frame de més cobertura) + reintents ≤3 cap endavant.
    //   · minOff/gapMergeSec baixats: amb 1,0 + 2,0 dos rètols CONSECUTIUS es fusionaven
    //     (Ceuta + Maricarmen en un interval de 9 s → un wott sense detecció).
    const TITOLET_DEFAULTS = {
        enabled: true,
        dryRun: false,         // ✅ APLICAR (2026-10-06, 2a passada). Per posar-lo en dry-run
                               //    sense tocar codi: FASTPASS_UI.State.titoletDryRun = true
                               //    a la consola del panell.
        // 🎯 CONDICIÓ DE DISPARO del rastreig (2026-10-08 · TNM V3 + TOTS els grafismes cremats)
        // Rols de wott que fan saltar la DETECCIÓ del grafisme cremat (màscara de color +
        // OCR) i la col·locació al SEU instant real. El rastreig NO es fa mai «per si de cas»:
        // només quan l'ítem porta wotts d'algun d'aquests rols.
        //
        // 🔴 27 ETIQUETES del sistema de ròtols, LITERALS (el sistema les genera
        //    automàticament al nom: `..._<wottId>_<ETIQUETA>_...`). El matx és d'IGUALTAT,
        //    no de prefix: `DADA` a seques NO dispara res, cal l'etiqueta sencera
        //    (`DADA-GRAN`). Única tolerància: majúscules/minúscules i l'estil del separador
        //    (`DADA-GRAN` ≡ `Dada_Gran` ≡ `DADA GRAN`), perquè el sistema no l'escriu sempre
        //    igual (`Tema-Titol`, `Nomcarrec`, `Enviat_Sí`, `Directe_PRESENCIAL`…).
        //      TITOLET · TITOLET GRAN · PREGUNTA · CARTELL · CIS_CEO · CIS_CEO_COMPARADA ·
        //      CRONOLOGIA · CRONOLOGIA-TITOLS · DADA_COMPARADA · DADA-DIFERENCIAL · DADA-GRAN ·
        //      DADA-GRAN-DIVISA · DADA-ITEM · DESTACAT · CLASSI-CHAMPIONS · CLASSIFICACIO ·
        //      CLASSI-MUNDIAL · CLASSI-PRIMERA · CLASSI-SEGONA · GRAFICA-BARRES ·
        //      GRAFICA_CIRCULAR · IMATGE-CAPTURA · LLISTA · LLISTA-DADES · NOTA · PROGRAMACIO ·
        //      RANQUING
        //    Afegir un tipus nou = afegir-ne l'etiqueta aquí (1 línia, cap JSX nou).
        //
        // ⚠️ El matx es fa NOMÉS contra el ROL: `chy.rol` i els trossos de ROL del nom
        //    (`name.split('_')` des de l'índex 7, la part que llegeix `13_Parse.meta`; MAI la
        //    part del TEXT, índex 5) — si no, un rètol que digués «LES DADES DEL PARO»
        //    dispararia la família DADA. Com que hi ha etiquetes amb `_` a dins, el nom les
        //    parteix en trossos i `_burnedGrafTokens` en reuneix fins a 3 per reconstruir-les.
        //    Noms reals: Wott_TNM_V1_16_00.00_SÁNCHEZ ELS NOMS D'UNA LEGISL_625359_TITOLET_in_setembre 2024_Pablo.00625919.mov
        //                Wott_MAT_v5_513_00.01_dona pas Barcelona_631037_Nomcarrec_Elisabet Viladomiu_directora Fun.00631331.mov
        detectRoles: [
            'TITOLET', 'TITOLET GRAN', 'PREGUNTA', 'CARTELL',
            'CIS_CEO', 'CIS_CEO_COMPARADA', 'CRONOLOGIA', 'CRONOLOGIA-TITOLS',
            'DADA_COMPARADA', 'DADA-DIFERENCIAL', 'DADA-GRAN', 'DADA-GRAN-DIVISA', 'DADA-ITEM',
            'DESTACAT', 'CLASSI-CHAMPIONS', 'CLASSIFICACIO', 'CLASSI-MUNDIAL',
            'CLASSI-PRIMERA', 'CLASSI-SEGONA', 'GRAFICA-BARRES', 'GRAFICA_CIRCULAR',
            'IMATGE-CAPTURA', 'LLISTA', 'LLISTA-DADES', 'NOTA', 'PROGRAMACIO', 'RANQUING'
        ],
        roiY: [0.60, 0.85],    // ROI vertical (fracció de l'alçada); X = tot l'ample
        ocrRoiX: [0, 0.45],    // ROI X només per a la CAPTURA d'OCR: el rètol viu a l'esquerra
                               //    i a la dreta hi ha grafisme aliè (MESURAT: l'OCR llegia
                               //    «338 TELEMÁTICOS: 12» del panell de votacions del fons)
        color: '#F25F13',      // taronja del rètol TITOLET
        tol: 25,               // tolerància per canal RGB (0-255)
        minCov: 2.0,           // cobertura mínima del ROI (%) per dir «rètol visible»
        maxCov: 60,            // cobertura (%) a partir de la qual el ROI és FONS, no text
        edgeAxes: 'y',         // quines vores desqualifiquen: 'y' (dalt/baix) · 'xy' · 'none'
        minEdgeFrac: 0.04,     // marge (fracció del ROI) per dir «toca la vora»
        // 🎯 ROI PER ETIQUETA (2026-10-08, 7a passada) — el cas: els 6 PREGUNTA de TNM V3 no
        // es van detectar (0 intervals: el rètol no viu a la banda mesurada del TITOLET).
        // `roiPerRole` dóna a CADA etiqueta la SEVA zona de rastreig; `roiDefault` és el
        // comodí de les que encara no s'han mesurat (avui 26 de 27).
        //   · Un ítem es rastreja amb la recepta de les seves etiquetes. Si en porta de
        //     receptes DIFERENTS, es fa UNA passada d'ffmpeg per recepta i cada interval
        //     només pot assignar-se els wotts del SEU grup (`roleGroups` + `ivGroups`).
        //   · Claus vàlides per recepta: roiX · roiY · edgeAxes · color · tol · minCov ·
        //     maxCov · minEdgeFrac · ocrRoiX · roiW · roiH (les que no hi siguin manen del
        //     nivell base; `roiW`/`roiH` són la graella de mostreig del ROI — 160×45 per
        //     defecte, pensada per a la banda del TITOLET: una ROI gairebé quadrada amb
        //     aquesta graella s'aixafaria i el color es desdibuixaria amb el fons).
        //   · `roiX: null` = tot l'ample (com abans). `roiY`/`roiX` en fracció de la imatge.
        //   · ⚠️ `edgeAxes` i els llindars de cobertura es refereixen a la ROI: si s'eixampla
        //     la zona, la MATEIXA xinxeta baixa de cobertura (l'àrea creix) i la vora perd
        //     valor de filtre → cada recepta ampla porta els seus llindars.
        roiPerRole: {
            // TITOLET: MESURAT (2026-10-06, roi_real.raw): xinxeta taronja a la banda baixa
            // de l'esquerra, ancorada a x=0 → la vora X no pot desqualificar (només la Y).
            'TITOLET': { roiX: null, roiY: [0.60, 0.85], edgeAxes: 'y' }
        },
        // Comodí per a les etiquetes sense mesurar: MITJA IMATGE ESQUERRA, que és on apunta
        // ja la finestra d'OCR (`ocrRoiX`) i on viuen els rètols d'aquest sistema. La franja
        // de dalt (mosquit de cadena/sumari) queda FORA; la vora no filtra res (en una ROI
        // gran tota taca toca la vora) i els llindars s'ajusten a l'àrea nova: una xinxeta
        // que omplia el 17-27% de la banda del TITOLET aquí baixa a ~9-14% (l'àrea es
        // multiplica per ~1,8), així que `minCov` baixa per no perdre res i `maxCov` puja
        // perquè un cartell a pantalla completa no es prengui per fons.
        roiDefault: {
            roiX: [0, 0.5], roiY: [0.10, 0.98], edgeAxes: 'none', minCov: 1.2, maxCov: 90,
            // Graella de mostreig adaptada a la ROI: és gairebé quadrada (0,5 × 0,88 de la
            // imatge ≈ 960×950 px a 1080p). Amb la graella del TITOLET (160×45) el `crop`+
            // `scale` (flags=area) l'aixafaria 21× en vertical i el color de la xinxeta es
            // desdibuixaria amb el fons → fora de tolerància. 96×96 ≈ 10×10 px per cel·la.
            roiW: 96, roiH: 96
        },
        // TC DEL NOM (2026-10-08): ABANS d'escanejar el MP4, mira si el nom del wott ja porta
        // l'instant d'emissió (`13_Parse.meta` → `parts[4]`, format MM.SS o HH.MM).
        // ⚠️ Als rètols d'aquesta família el camp sol ser `00.00` (inservible: mesurat al nom
        // real `Wott_TNM_V3_18_00.00_COM QUEDA EL DECRET D'HABITATG_630060_PREGUNTA_in_…`),
        // així que el pre-chequeig és CONSERVADOR: només l'accepta si ≥ `tcMinSec`, cau dins
        // de l'ítem i no és el MATEIX valor a tots els wott. Si no, es detecta com sempre.
        // Vegeu `flow_chyrons._titoletTcFromName`.
        tcFromName: true,
        tcMinSec: 0.5,         // segon mínim creïble d'un TC del nom (0.00 → descartat)
        scanFps: 2,            // 🔴 2 mostres/s (abans 1): a 1 fps la durada tenia ±1 s d'error
        fps: 25,               // fps del material (frames ↔ segons)
        minOn: 0.4,            // durada mínima d'un interval (s)
        minFrames: 2,          // mostres ON mínimes per acceptar un interval (1 = soroll)
        minOff: 0.3,           // 🔴 buit mínim per separar intervals (abans 1,0)
        gapMergeSec: 0.6,      // 🔴 fusiona buits < això (abans 2,0: fusionava rètols seguits)
        scanChunkSec: 45,      // 🔴 trams de l'escaneig endavant (el cursor només avança)
        longOnSec: 5.0,        // onAir > 5 s (= durada de la targeta) → cadència actual
        minTailSec: 0.5,       // (LEGACY · 2026-10-06 5a passada) JA NO s'usa a la cadena
                               //    TITOLET: la part viva és el clip SENCER i el congelat
                               //    només cobreix fins al final detectat. Es conserva la clau
                               //    per no invalidar configs desades.
        ocr: true,             // WHICH per OCR (els accents poden fallar: match difús)
        ocrLangs: ['es-ES', 'en-US'],   // tots en UNA execució de bin\ocr.ps1 (-Langs)
        ocrTries: 3,           // intents d'OCR per interval (1r = frame de més cobertura)
        ocrRetryStepSec: 0.75, // pas cap ENDAVANT entre intents (mai enrere)
        ocrFuzz: 0.55,         // similitud mínima text OCR ↔ nom del wott (0-1)
        cache: true,           // desa el pla a C:\temp\titolet_plan_<hash>.json
        snapTolSec: 1.0,       // col·locació: si l'instant detectat cau a ≤ això del TALL
                               //    anterior de V1, el TITOLET entra EXACTAMENT a l'inici
                               //    d'aquell clip (l'«imant»). 🔴 (5a passada, 2026-10-06)
                               //    Abans s'hi sumaven 10 frames (OFF = 0,40 s) → la targeta
                               //    entrava 0,4 s tard i l'«imant» no s'hi veia.
        ocrWeak: 0.7,          // match FEBLE: per sota d'això, si el text de l'interval ja és
                               //    (millor) d'un ALTRE wott, la parella es REBUTJA. Cas real
                               //    (TNM V1 ítem 16, 06/10): l'interval de relIn 111 s deia
                               //    «jung 2025 LEIRE DÍEZ» (d'un altre wott, score 0,889) i el
                               //    wott orfe «maig 2026 José Luis» (ZAPATERO) s'hi va
                               //    emparellar amb 0,556 → col·locat 10,5 s abans del seu lloc.
        refineEntry: true,     // refina l'ENTRADA de cada interval USAT amb un escaneig FI al
                               //    voltant de `tIn` → ±3 frames en comptes de fins a 12
                               //    (l'escaneig general va a 2 mostres/s = pas 0,5 s, i el 1r
                               //    mostreig ON sempre va tard: «uns frames de retraso»)
        refineFps: 8,          // mostres/s de l'escaneig fi de l'entrada (pas 0,125 s)
        freezeGrabFrac: 0.6,   // instant del frame congelat = 60 % del clip quan la part viva
                               //    és el clip SENCER: al final hi ha l'animació de sortida i
                               //    el PNG quedaria buit (congelat invisible)
        cardTrimFrames: 5,     // 🔴 (2026-10-06, 6a passada · MESURAT per l'usuari) La targeta
                               //    TITOLET deia 5 frames MÉS que el rètol cremat a l'aire: aquests
                               //    5 frames es retallen del FINAL (total i part viva) i el
                               //    congelat hi entra 5 frames ABANS → l'enllaç vídeo viu →
                               //    congelat queda SENSE buit. 0 = comportament antic.
        freezeMaxSec: 15,      // topall del congelat (seguretat): mai més de 15 s de frame
                               //    congelat, encara que la detecció digui que va durar més
    };

    // 🎬 TEMA-TÍTOL · SORTIDA i TRANSICIONS (2026-10-07)
    // El Wott del Tema-Títol ja porta al FINAL del seu mèdia la seva pròpia animació de
    // sortida («desaparició del títol petit»), MESURADA per l'usuari: 10:00→10:06 (6 frames
    // @25fps). És exactament el que abans es fabricava invertint el titulillo amb ffmpeg
    // (`_REV.mov`). Ara s'aprofita AQUELLA peça: es retalla el mateix ítem (JA al projecte) i es
    // col·loca on toca → zero ffmpeg, zero import, zero _REV.mov.
    const TEMATTOL_EXIT_DEFAULTS = {
        enabled: true,          // false → comportament antic (revers ffmpeg del titulillo)
        atSec: 10.0,            // IN del mèdia on arrenca la desaparició (10:00)
        durSec: 0.24,           // durada de la peça (10:06 − 10:00 = 6 frames @25fps)
        useReverseFallback: true // si la peça no es pot col·locar → revers ffmpeg (xarxa)
    };

    let _activeConfig = {
        general: { autor: "AGUS", guarda: 22, debug: false, handles: 20, tcOffset: 0, clipInOffset: 10, zonaInOffset: 10, srtEmergencyTailSec: 120, snapWindowDeducedSec: 2.5, snapWindowFaroSec: 2.5, clipOutMarginSec: 0, clipExtraTailSec: 60 },
        // Hora d'inici d'emissió de cada programa (font ÚNICA per a tota l'extensió:
        // guardes de temps, peticions a l'API d'escaletes i OFFSET del MP4).
        programStartHours: { TNV: 21.0, TNM: 14.5, TNC: 13.8333, MAT: 7.9167 },
        // 🎯 TITOLET: paràmetres de detecció del grafisme cremat (vegeu TITOLET_DEFAULTS).
        titolet: TITOLET_DEFAULTS,
        // 🎬 TEMA-TÍTOL: peça de desaparició del propi Wott (vegeu TEMATTOL_EXIT_DEFAULTS).
        temaTitolExit: TEMATTOL_EXIT_DEFAULTS,
        rutas: {
            plantilla: "\\\\nas1.ad-ccrtv.local\\informatius\\001 RECURSOS\\XXX Recursos AGUS - NO TOCAR!!!!\\PROJECTE 3CatInfo_NET.prproj",
            conductors: "\\\\DSMEDIA07\\portal324\\PROJECTE 9x16 PREMIERE 2\\CHYRONS CONDUCTORS\\",
            vertical: "\\\\192.168.147.199\\public\\VERTICALITZACIO_INFORMATIUS\\",
            chyrons: "\\\\192.168.147.199\\public\\00_CHYRONS AUTOMATICS\\3CatInfo\\VERTICALITZACIO\\",
            destino_base: "\\\\DSMEDIA07\\portal324\\PROJECTE 9x16 PREMIERE 2\\AAA_PROJECTES PREMIERE VERTICALITZACIO\\PROVES\\",
            portadas: "\\\\DSMEDIA07\\portal324\\PROJECTE 9x16 PREMIERE 2\\AAA_PROJECTES PREMIERE VERTICALITZACIO\\PORTADES\\",
            render1: "\\\\192.168.147.199\\public\\VERTICALITZACIO_INFORMATIUS\\EXPORTS PROVISIONALS",
            render2: "\\\\svftpccma\\videos\\MP4_3CATINFO_VERTICAL\\CONVERTITS_1080-1920\\608-1080",
            nnews_root_1: "",
            nnews_root_2: ""
        },
        estructuras: {
            "TNs": {
                tracks: {
                    v_mp4:    1,
                    v_mascara: 2,    // (2026-10-01 · #126) V2 = MÀSCARA (zona PROTEGIDA)
                    v_fondos: 3,
                    v_graf:   3,
                    v_graficos: 3,
                    v_tema:   6,
                    v_chyrons: 7,
                    v_lloc:   8,
                    v_trad:   4,
                    v_video1: 4,
                    v_video2: 5,
                    s_s1: 1,
                    s_s2: 2
                },
                programas: [
                    { id: "TNCOMARQUES", archivo: "TN_COMARQUES", wott: "TNC", dir: "02_COMARQUES_PROJECTES", conductor: "Conduct_Nuria Sole Perez.mov" },
                    { id: "TNM",          archivo: "TN_MIGDIA",    wott: "TNM", dir: "03_TN MIGDIA_PROJECTES",  conductor: "Conduct_Xavi Coral Trullas.mov" },
                    { id: "TNV",          archivo: "TN_VESPRE",    wott: "TNV", dir: "04_TN VESPRE_PROJECTES",   conductor: "Conduct_Toni Cruanyes.mov" }
                ]
            },
            "Sumari Matins": {
                tracks: {
                    v_mp4: 1, v_mascara: 2, v_fondos: 3, v_graf: 3, v_graficos: 3, v_tema: 6, v_chyrons: 7, v_lloc: 8, v_video1: 4, v_video2: 5, v_trad: 4,
                    s_s1: 1, s_s2: 2
                },
                programas: [
                    { id: "MATINS", archivo: "MATINS", wott: "MAT", dir: "01_MATINS_PROJECTES", conductor: "Conduct_Ariadna Oltra.mov",
                      // digition crea un rundown per dia feiner: l'ID puja +1/dia
                      // (lun PRO1374 · mar PRO1376 · mie PRO1377). Darrer conegut:
                      // jue 2026-09-17 -> PRO1378. Si l'API diu "no existeix", la
                      // FOTO prova l'estimat i els veins (+1/-1/+2...) automaticament.
                      escaletaId: "PRO1378" }
                ]
            },
            "Fotomató": {
                tracks: {
                    v_mp4: 1, v_mascara: 2, v_fondos: 3, v_graf: 3, v_graficos: 3, v_tema: 6, v_chyrons: 7, v_lloc: 8, v_video1: 4, v_video2: 5, v_trad: 4,
                    s_s1: 1, s_s2: 2
                },
                programas: []
            },
            "User Defined": {
                tracks: {
                    v_mp4: 1, v_mascara: 2, v_fondos: 3, v_graf: 3, v_graficos: 3, v_tema: 6, v_chyrons: 7, v_lloc: 8, v_video1: 4, v_video2: 5, v_trad: 4,
                    s_s1: 1, s_s2: 2
                },
                programas: []
            }
        }
    };

    FASTPASS_UI.Config = {

        /**
         * get: Retorna la configuració activa (Carregada o Fallback).
         */
        get: function () {
            const cfg = _activeConfig;

            // Tracks de vídeo amb aliases per compatibilitat
            const raw = cfg.estructuras["TNs"].tracks;
            const vTracks = {
                mp4:       raw.v_mp4,
                main:      raw.v_mp4,    // alias per flow_cut.js i flow_assembly.js
                // (2026-10-01 · #126) MÀSCARA DE PISTA: V2 = «Màscara (PROTEGIT)». Decisió de
                // l'usuari: la màscara viu aquí i «V4 ja NO és zona de màscara» → els fluxos
                // que escriuen en aquesta pista (IPD+ SRC:2) hi fan VIGILÀNCIA amb avís
                // (flow_graphics.js → `_avisMascara`).
                mascara:   (raw.v_mascara !== undefined) ? raw.v_mascara : 2,
                fondos:    raw.v_fondos,
                graf:      raw.v_graf,
                // (2026-09-22) GRAFISMOS: clau pròpia (v_graficos) perquè vagin a la seva pista
                // (V5 al nou Profile.json) i no col·lideixin amb els chyrons (V7). Si no hi és,
                // es manté el comportament antic (v_graf).
                graficos:  (raw.v_graficos !== undefined) ? raw.v_graficos : raw.v_graf,
                tema:      raw.v_tema,
                tematitol: raw.v_tema,   // alias
                chyrons:   raw.v_chyrons,
                lloc:      raw.v_lloc,
                llocdata:  raw.v_lloc,   // alias
                // (2026-09-22) Doble Finestra / Mapa: dues copies de video a les seves pistes.
                video1:    (raw.v_video1 !== undefined) ? raw.v_video1 : raw.v_fondos,
                video2:    (raw.v_video2 !== undefined) ? raw.v_video2 : raw.v_chyrons,
                trad:      raw.v_trad    // V10 als TNs (no solapar amb els chyrons V7)
            };

            if (cfg.general.debug) {
                console.log("🛠️ [CONFIG] Video Tracks:", vTracks);
            }

            return {
                tracks: {
                    video: vTracks,
                    subtitle: { s1: raw.s_s1, s2: raw.s_s2 }
                },
                guarda: cfg.general.guarda,
                autor:  cfg.general.autor,
                rutas: {
                    plantilla_net:   cfg.rutas.plantilla,
                    conductors:      cfg.rutas.conductors,
                    verticalitzacio: cfg.rutas.vertical,
                    chyrons:         cfg.rutas.chyrons,
                    destinoBase:     cfg.rutas.destino_base,
                    portadas:        cfg.rutas.portadas,
                    render1:         cfg.rutas.render1,
                    render2:         cfg.rutas.render2
                },
                mapeoProgramas: this._getLegacyMapping(cfg),
                export: {
                    video1:  cfg.rutas.render1,
                    video2:  cfg.rutas.render2,
                    portada: cfg.rutas.portadas
                },
                naming: {
                    getProjectName: (ctx, sanitizedTema) => {
                        const prog = ctx.progData.archivo;
                        const bloq = ctx.bloque;
                        const d = ctx.dateDir.split('_');
                        const mmdd = d[1] + d[0];
                        const user = cfg.general.autor || "USER";
                        return `${prog}_${bloq}_${user}_${mmdd}_${sanitizedTema}`;
                    },
                    getSequenceName: (ctx, sanitizedTema) => {
                        const shortToken = (ctx.progData && ctx.progData.wott) ? ctx.progData.wott : "TMP";
                        return shortToken + "_" + sanitizedTema;
                    }
                },
                debug:    cfg.general.debug,
                handles:  cfg.general.handles  || 0,
                // clipOutMarginSec: marge de SORTIDA del clip (segons) que ha de quedar
                // DESPRÉS de l'inici del següent item amb OnAir (i per sobre dels
                // handles), per poder estirar el clip a la timeline si cal.
                // Cas real 2026-09-16: el clip acabava massa aviat i no cobria l'IPD.
                clipOutMarginSec: (cfg.general.clipOutMarginSec != null) ? cfg.general.clipOutMarginSec : 0,
                // clipExtraTailSec: COLA EXTRA (segons) del clip extret amb ffmpeg. El
                // clip del timeline es munta igual, però el fitxer té aquest material de
                // més al final per poder estirar-lo (connexions/directes que s'allarguen).
                clipExtraTailSec: (cfg.general.clipExtraTailSec != null) ? cfg.general.clipExtraTailSec : 60,
                // Hores d'inici d'emissió per programa (TNC 13:50, TNM 14:30, TNV 21:00).
                programStartHours: cfg.general.programStartHours || { TNV: 21.0, TNM: 14.5, TNC: 13.8333, MAT: 7.9167 },
                tcOffset: cfg.general.tcOffset || 0,
                // 🎛️ [IN-OFFSET 2026-09-04] Ajustos del flujo NOU/Main (create):
                // - clipInOffset: segons a RESTAR a l'IN (media origen) del clip inserit
                //   (el punt real del bloc està ~8-10s abans del calculat → més marge).
                // - zonaInOffset: segons a RESTAR al sweetSeqIn (corchete IN de la zona)
                //   perquè quedi més a prop de l'inici real del bloc.
                // Només s'apliquen a create() MODE NORMAL (3_Project_Logic.js).
                clipInOffset: cfg.general.clipInOffset || 0,
                zonaInOffset: cfg.general.zonaInOffset || 0,
                // 🌊 Ajustos de l'editor SRT / marcadors (Profile.json → general):
                // - srtEmergencyTailSec: segons de cua més enllà del final del bloc al
                //   SRT d'emergència (per defecte 120 s: cobreix el clip estirat amb
                //   clipExtraTailSec).
                // - snapWindowDeducedSec: finestra de snap (F4) per als marcadors DEDUÏTS
                //   (ítems sense OnAir, tipus "02i - Intro") — per defecte 2,5 s.
                // - snapWindowFaroSec (2026-09-24, FIX B): finestra de snap per als marcadors
                //   FARO (ítems amb OnAir real). Pujada d'1,5 → 2,5 s: amb el clip extret
                //   l'error residual d'ancoratge pot arribar a ~2 s i amb 1,5 s el faro no
                //   saltava mai al tall d'obertura de la seva peça (TNC: 12,96s vs tall 15,12s).
                srtEmergencyTailSec: (cfg.general.srtEmergencyTailSec != null) ? cfg.general.srtEmergencyTailSec : 120,
                snapWindowDeducedSec: (cfg.general.snapWindowDeducedSec != null) ? cfg.general.snapWindowDeducedSec : 2.5,
                snapWindowFaroSec: (cfg.general.snapWindowFaroSec != null) ? cfg.general.snapWindowFaroSec : 2.5,
                // 🎯 TITOLET (2026-10-06): paràmetres de detecció del grafisme cremat.
                // Còpia fresca (defaults + override) perquè ningú els pugui mutar de retruc.
                titolet: Object.assign({}, TITOLET_DEFAULTS, cfg.titolet || {}),
                // 🎬 TEMA-TÍTOL (2026-10-07): peça de desaparició del propi Wott (sortida/
                // transicions). Còpia fresca (defaults + override) com el titolet.
                temaTitolExit: Object.assign({}, TEMATTOL_EXIT_DEFAULTS, cfg.temaTitolExit || {})
            };
        },

        /**
         * _getLegacyMapping: Mapa de programas per compatibilitat amb codi existent.
         */
        _getLegacyMapping: function(cfg) {
            const map = {};
            for (let k in cfg.estructuras) {
                const est = cfg.estructuras[k];
                est.programas.forEach(p => {
                    map[p.id] = {
                        archivo:      p.archivo,
                        directorio:   p.dir,
                        wott:         p.wott,
                        archivo_wott: p.wott,
                        conductors:   { titular: p.conductor, substituts: [] },
                        escaletaId:   p.escaletaId || null
                    };
                });
            }
            return map;
        },

        /**
         * getNNewsPaths: Rutes de cerca de projectes NNews.
         */
        getNNewsPaths: function() {
            const cfg = _activeConfig.rutas;
            const paths = [];
            if (cfg.nnews_root_1) paths.push(cfg.nnews_root_1);
            if (cfg.nnews_root_2) paths.push(cfg.nnews_root_2);
            return paths;
        },

        saveSelection: function (el) {
            if (el && el.id) {
                localStorage.setItem('fastpass_v1_' + el.id, el.value);
            }
        },

        loadSelection: function () {
            try {
                var p = document.getElementById('programa');
                var b = document.getElementById('bloc');
                if (p) p.value = localStorage.getItem('fastpass_v1_programa') || "";
                if (b) b.value = localStorage.getItem('fastpass_v1_bloc') || "";
            } catch (e) { console.error("❌ Error carregant selecció:", e); }
        }
    };

    window.FASTPASS_UI = FASTPASS_UI;
})();
