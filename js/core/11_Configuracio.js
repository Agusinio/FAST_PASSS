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
    let _activeConfig = {
        general: { autor: "AGUS", guarda: 22, debug: false, handles: 20, tcOffset: 0, clipInOffset: 10, zonaInOffset: 10, srtEmergencyTailSec: 120, snapWindowDeducedSec: 2.5, snapWindowFaroSec: 2.5, clipOutMarginSec: 0, clipExtraTailSec: 60 },
        // Hora d'inici d'emissió de cada programa (font ÚNICA per a tota l'extensió:
        // guardes de temps, peticions a l'API d'escaletes i OFFSET del MP4).
        programStartHours: { TNV: 21.0, TNM: 14.5, TNC: 13.8333, MAT: 7.9167 },
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
                snapWindowFaroSec: (cfg.general.snapWindowFaroSec != null) ? cfg.general.snapWindowFaroSec : 2.5
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
