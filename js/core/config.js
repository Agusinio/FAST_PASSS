/**
 * ============================================================================
 * FASTPASS_UI.Config
 * Mòdul de configuració global, rutes de xarxa i mapatge de programes.
 * ============================================================================
 */

(function () {
    var FASTPASS_UI = window.FASTPASS_UI || {};

    FASTPASS_UI.Config = {

        /**
         * Retorna l'objecte de configuració centralitzat.
         * @returns {Object} Objecte amb rutes, mapeig de programes i exportació.
         */
        get: function () {
            return {
                // Definicions de pistes (VUI 1-based) per a orquestració
                tracks: {
                    video: {
                        mp4: 1,
                        //template_1: 2, // NO TOCAR
                        fondos: 2,
                        graficos: 3, //Mapes, Gràfiques
                        //mascara subtitulos: 4 // NO TOCAR
                        tematitol: 5,
                        chyrons: 6,    // NomCarrec, Firma, 
                        llocdata: 7,
                        //mosca: 8  // NO TOCAR
                    },
                    subtitle: {
                        s1: 1,
                        s2: 2
                    }
                },

                // Hores de tall per a l'escaneig de dates
                guarda: 22,

                // Rutes de Xarxa normalitzades per a Windows/Premiere
                rutas: {
                    plantilla_net: "\\\\nas1.ad-ccrtv.local\\informatius\\001 RECURSOS\\XXX Recursos AGUS - NO TOCAR!!!!\\PROJECTE 3CatInfo_NET.prproj",
                    conductors: "\\\\DSMEDIA07\\portal324\\PROJECTE 9x16 PREMIERE 2\\CHYRONS CONDUCTORS\\",
                    verticalitzacio: "\\\\192.168.147.199\\public\\VERTICALITZACIO_INFORMATIUS\\",
                    chyrons: "\\\\192.168.147.199\\public\\00_CHYRONS AUTOMATICS\\3CatInfo\\VERTICALITZACIO\\",
                    destinoBase: "\\\\DSMEDIA07\\portal324\\PROJECTE 9x16 PREMIERE 2\\AAA_PROJECTES PREMIERE VERTICALITZACIÓ\\PROVES\\",
                    portadas: "\\\\DSMEDIA07\\portal324\\PROJECTE 9x16 PREMIERE 2\\AAA_PROJECTES PREMIERE VERTICALITZACIÓ\\PORTADES\\"
                },

                // Configuració específica per programa
                mapeoProgramas: {
                    "MATINS": {
                        archivo: "MATINS",
                        directorio: "01_MATINS_PROJECTES",
                        archivo_wott: "MAT",
                        conductors: {
                            titular: "Conduct_Ariadna Oltra.mov",
                            substituts: ["Conduct_Pere Bosch.mov", "Conduct_Marta Carreras.mov"]
                        }
                    },
                    "TNCOMARQUES": {
                        archivo: "TN_COMARQUES",
                        directorio: "02_COMARQUES_PROJECTES",
                        archivo_wott: "TNC",
                        conductors: {
                            titular: "Conduct_Nuria Sole Perez.mov",
                            substituts: ["Conduct_Pere Bosch.mov"]
                        }
                    },
                    "TNM": {
                        archivo: "TN_MIGDIA",
                        directorio: "03_TN MIGDIA_PROJECTES",
                        archivo_wott: "TNM",
                        conductors: {
                            titular: ["Conduct_Anna Garnatxe Masmitja.mov", "Conduct_Xavi Coral Trullas.mov"],
                            capsDesetmana: ["Conduct_Julia Lopez Romero.mov", "Conduct_Joan Raventos.mov"]
                        }
                    },
                    "TNV": {
                        archivo: "TN_VESPRE",
                        directorio: "04_TN VESPRE_PROJECTES",
                        archivo_wott: "TNV",
                        conductors: {
                            titular: "Conduct_Toni Cruanyes.mov",
                            substituts: ["Conduct_Raquel Sans Duran.mov"]
                        }
                    }
                },

                // Rutes d'exportació persistents (localStorage)
                export: {
                    video1: localStorage.getItem('fp_cfg_path_render_1') || "",
                    video2: localStorage.getItem('fp_cfg_path_render_2') || "",
                    portada: localStorage.getItem('fp_cfg_path_portada') || ""
                },

                naming: {
                    // [Prog]_[Bloq]_[Autor]_[MMDD]_[Tema]
                    getProjectName: function (ctx, sanitizedTema) {
                        const prog = ctx.progData.archivo;
                        const bloq = ctx.bloque;
                        const autor = ctx.userName || "USER";

                        // Extraer MMDD de 24_03_2026 -> 0324
                        const d = ctx.dateDir.split('_');
                        const mmdd = d[1] + d[0];

                        return `${prog}_${bloq}_${autor}_${mmdd}_${sanitizedTema}`;
                    },
                    getSequenceName: function (ctx, sanitizedTema) {
                        const prog = ctx.progData.archivo;
                        return `${prog}_${sanitizedTema}`;
                    }
                }
            };
        },

        /**
         * Persisteix la selecció del selector (Programa o Bloc) al localStorage.
         * @param {HTMLElement} el - L'element select que ha canviat.
         */
        saveSelection: function (el) {
            if (el && el.id) {
                localStorage.setItem('fastpass_v1_' + el.id, el.value);
            }
        },

        /**
         * Recupera la darrera selecció de l'usuari i la aplica als selectors del DOM.
         */
        loadSelection: function () {
            try {
                var p = document.getElementById('programa');
                var b = document.getElementById('bloc');
                if (p) p.value = localStorage.getItem('fastpass_v1_programa') || "";
                if (b) b.value = localStorage.getItem('fastpass_v1_bloc') || "";
            } catch (e) {
                console.error("❌ [CONFIG] Error carregant selecció:", e);
            }
        }
    };

    window.FASTPASS_UI = FASTPASS_UI;
})();