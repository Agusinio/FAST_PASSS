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
    // Tracks alineats amb Profile.json (v_mp4:1, v_fondos:2, v_graf:3, v_tema:5, v_chyrons:6, v_lloc:7)
    let _activeConfig = {
        general: { autor: "AGUS", guarda: 22, debug: false, handles: 9, tcOffset: 0 },
        rutas: {
            plantilla: "\\\\nas1.ad-ccrtv.local\\informatius\\001 RECURSOS\\XXX Recursos AGUS - NO TOCAR!!!!\\PROJECTE 3CatInfo_NET.prproj",
            conductors: "\\\\DSMEDIA07\\portal324\\CHYRONS CONDUCTORS 3CATINFO WOTT\\",
            vertical: "\\\\192.168.147.199\\public\\VERTICALITZACIO_INFORMATIUS\\",
            chyrons: "\\\\192.168.147.199\\public\\00_CHYRONS AUTOMATICS\\3CatInfo\\VERTICALITZACIO\\",
            destino_base: "\\\\DSMEDIA07\\portal324\\PROJECTE 9x16 PREMIERE 2\\AAA_PROJECTES PREMIERE VERTICALITZACIÓ\\PROVES\\",
            portadas: "\\\\DSMEDIA07\\portal324\\PROJECTE 9x16 PREMIERE 2\\AAA_PROJECTES PREMIERE VERTICALITZACIÓ\\PORTADES\\",
            render1: "\\\\192.168.147.199\\public\\VERTICALITZACIO_INFORMATIUS\\EXPORTS PROVISIONALS",
            render2: "\\\\svftpccma\\videos\\MP4_3CATINFO_VERTICAL\\CONVERTITS_1080-1920\\608-1080",
            nnews_root_1: "",
            nnews_root_2: ""
        },
        estructuras: {
            "TNs": {
                tracks: {
                    v_mp4:    1,
                    v_fondos: 2,
                    v_graf:   3,
                    v_tema:   5,
                    v_chyrons: 6,
                    v_lloc:   7,
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
                    v_mp4: 1, v_fondos: 2, v_graf: 3, v_tema: 5, v_chyrons: 6, v_lloc: 7,
                    s_s1: 1, s_s2: 2
                },
                programas: [
                    { id: "MATINS", archivo: "MATINS", wott: "MAT", dir: "01_MATINS_PROJECTES", conductor: "Conduct_Ariadna Oltra.mov" }
                ]
            },
            "Fotomató": {
                tracks: {
                    v_mp4: 1, v_fondos: 2, v_graf: 3, v_tema: 5, v_chyrons: 6, v_lloc: 7,
                    s_s1: 1, s_s2: 2
                },
                programas: []
            },
            "User Defined": {
                tracks: {
                    v_mp4: 1, v_fondos: 2, v_graf: 3, v_tema: 5, v_chyrons: 6, v_lloc: 7,
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
                fondos:    raw.v_fondos,
                graf:      raw.v_graf,
                graficos:  raw.v_graf,   // alias
                tema:      raw.v_tema,
                tematitol: raw.v_tema,   // alias
                chyrons:   raw.v_chyrons,
                lloc:      raw.v_lloc,
                llocdata:  raw.v_lloc    // alias
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
                tcOffset: cfg.general.tcOffset || 0
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
                        conductors:   { titular: p.conductor, substituts: [] }
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
