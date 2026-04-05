/**
 * ============================================================================
 * 11_Configuracio.js (Motor de Configuració Dinàmica)
 * ============================================================================
 */

(function () {
    var FASTPASS_UI = window.FASTPASS_UI || {};

    // Per defecte, si no hi ha Profile.json, usem aquests fallbacks
    let _activeConfig = {
        general: { autor: "AGUS", guarda: 22, debug: false },
        rutas: {
            plantilla: "\\\\nas1.ad-ccrtv.local\\informatius\\001 RECURSOS\\XXX Recursos AGUS - NO TOCAR!!!!\\PROJECTE 3CatInfo_NET.prproj",
            conductors: "\\\\DSMEDIA07\\portal324\\CHYRONS CONDUCTORS 3CATINFO WOTT\\",
            vertical: "\\\\192.168.147.199\\public\\VERTICALITZACIO_INFORMATIUS\\",
            chyrons: "\\\\192.168.147.199\\public\\00_CHYRONS AUTOMATICS\\3CatInfo\\VERTICALITZACIO\\",
            destino_base: "\\\\DSMEDIA07\\portal324\\PROJECTE 9x16 PREMIERE 2\\AAA_PROJECTES PREMIERE VERTICALITZACIÓ\\PROVES\\",
            portadas: "\\\\DSMEDIA07\\portal324\\PROJECTE 9x16 PREMIERE 2\\AAA_PROJECTES PREMIERE VERTICALITZACIÓ\\PORTADES\\",
            render1: "\\\\192.168.147.199\\public\\VERTICALITZACIO_INFORMATIUS\\EXPORTS PROVISIONALS",
            render2: "\\\\svftpccma\\videos\\MP4_3CATINFO_VERTICAL\\CONVERTITS_1080-1920\\608-1080"
        },
        estructuras: {
            "TNs": {
                tracks: { 
                    v_mp4: 1, 
                    v_fondos: 2, 
                    v_graf: 3, 
                    v_tema: 4, 
                    v_chyrons: 5, 
                    v_lloc: 6, 
                    s_s1: 1, 
                    s_s2: 2 
                },
                programas: [
                    { id: "TNCOMARQUES", archivo: "TN_COMARQUES", wott: "TNC", dir: "02_COMARQUES_PROJECTES", conductor: "Conduct_Nuria Sole Perez.mov" },
                    { id: "TNM", archivo: "TN_MIGDIA", wott: "TNM", dir: "03_TN MIGDIA_PROJECTES", conductor: "Conduct_Xavi Coral Trullas.mov" },
                    { id: "TNV", archivo: "TN_VESPRE", wott: "TNV", dir: "04_TN VESPRE_PROJECTES", conductor: "Conduct_Toni Cruanyes.mov" }
                ]
            }
        }
    };

    FASTPASS_UI.Config = {

        /**
         * get: Retorna la configuració activa (Carregada o Fallback).
         */
        get: function () {
            // Re-mapegat a l'estructura antiga per mantenir compatibilitat amb la resta del JS
            const cfg = _activeConfig;
            const rawTracks = cfg.estructuras["TNs"].tracks;
            
            // 📍 REMAPEIG DE CLAUS (v_mp4 -> mp4, etc.)
            const vTracks = {
                mp4:       rawTracks.v_mp4,
                fondos:    rawTracks.v_fondos,
                graficos:  rawTracks.v_graf,
                tematitol: rawTracks.v_tema,
                chyrons:   rawTracks.v_chyrons,
                llocdata:  rawTracks.v_lloc
            };

            if (cfg.general.debug) {
                console.log("🛠️ [CONFIG] Video Tracks:", vTracks);
                console.log("🛠️ [CONFIG] Verify MP4 Track:", vTracks.mp4);
            }

            return {
                tracks: {
                    video: vTracks,
                    subtitle: { s1: rawTracks.s_s1, s2: rawTracks.s_s2 }
                },
                guarda: cfg.general.guarda,
                rutas: {
                    plantilla_net: cfg.rutas.plantilla,
                    conductors: cfg.rutas.conductors,
                    verticalitzacio: cfg.rutas.vertical,
                    chyrons: cfg.rutas.chyrons,
                    destinoBase: cfg.rutas.destino_base,
                    portadas: cfg.rutas.portadas,
                    render1: cfg.rutas.render1,
                    render2: cfg.rutas.render2
                },
                mapeoProgramas: this._getLegacyMapping(cfg),
                export: {
                    video1: cfg.rutas.render1,
                    video2: cfg.rutas.render2,
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
                        // 📍 CANVI: Usar wott (TNV) en comptes d'archivo (TN_VESPRE)
                        const shortToken = ctx.progData.wott || "TBD";
                        return `${shortToken}_${sanitizedTema}`;
                    }
                },
                debug: cfg.general.debug
            };
        },

        _getLegacyMapping: function(cfg) {
            const map = {};
            // Unim tots els programes de totes les estructures
            for (let k in cfg.estructuras) {
                const est = cfg.estructuras[k];
                est.programas.forEach(p => {
                    map[p.id] = {
                        archivo: p.archivo,
                        directorio: p.dir,
                        wott: p.wott,
                        conductors: { titular: p.conductor, substituts: [] }
                    };
                });
            }
            return map;
        },

        /**
         * init: Carrega el Profile.json físic usant el bridge literal de IO.
         */
        init: async function () {
            try {
                const Eines = window.FASTPASS_UI.Eines;
                const csInterface = new CSInterface();
                const extensionRoot = csInterface.getSystemPath(SystemPath.EXTENSION);
                const profilePath = extensionRoot + "/Profile.json";
                
                const exists = await Eines.callJSX(`Arxiu.exists('${profilePath.replace(/\\/g, '\\\\')}')`);
                if (exists === "true") {
                    const raw = await Eines.callJSX(`Arxiu.readTxt('${profilePath.replace(/\\/g, '\\\\')}')`);
                    if (raw && raw !== "ERR") {
                        const parsed = JSON.parse(raw);
                        _activeConfig = parsed;
                        Eines.log("🧬 [CONFIG] Profile.json carregat amb èxit.");
                    }
                } else {
                    Eines.log("⚠️ [CONFIG] Profile.json no trobat. Usant memòria interna.");
                }
            } catch (e) {
                console.error("❌ [CONFIG] Error en init:", e);
            }
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