/**
 * ============================================================================
 * FASTPASS_UI.EscaletaReader - Sub-mòdul: Overrides de Durada
 * Extiende el objeto base creado en escaleta_reader.js
 * ============================================================================
 */

(function () {
    var ER = window.FASTPASS_UI && window.FASTPASS_UI.EscaletaReader;
    if (!ER) return;

    const utils = function () { return window.FASTPASS_UI.Utils; };
    const callJSX = function (s) { return window.FASTPASS_UI.Utils.callJSX(s); };
    const log = function (m) { window.FASTPASS_UI.Utils.log(m, 'DEBUG'); };

    // ----------------------------------------------------------------
    // SISTEMA DE CORRECCIÓ DE DURADES D'ESCLETA
    // ----------------------------------------------------------------
    //
    // Els JSONs d'escaleta contenen durades incorrectes per a certs items
    // (caretes, molinets, efectes...). Aquest mapa conté els valors correctes
    // segons el programa i l'edició (laboral vs cap de setmana).
    //
    // Font: docs/info_escaleta/Temps OnAir elements escaleta.csv
    //
    // Estructura:
    //   clau programa (origen) -> {
    //       diari: { titolItem: duradaEnSegons, ... },
    //       capDeSetmana: { titolItem: duradaEnSegons, ... }
    //   }
    //
    // Nota: Els títols es comparen amb 'indexOf' (contenen), no exacte.
    // Per exemple "CARETA" matxa "CARETA TNV", "CARETA TNMigdia INICI", etc.

    ER.ITEM_DURATION_OVERRIDES = {
        TNC: {
            diari: {
                "CARETA": 5,
                "RACO": 12,
                "SUMARI": 22,
                "MOLINET": 5
            },
            capDeSetmana: {
                "CARETA": 5,
                "SUMARI": 20,
                "MOLINET": 5
            }
        },
        TNV: {
            diari: {
                "CARETA INICI": 20,
                "CARETA SORTIDA": 8,
                "SUMARI": 45,
                "MOLINET": 5,
                "RACO": 17
            },
            capDeSetmana: {
                "CARETA INICI": 20,
                "CARETA SORTIDA": 8,
                "SUMARI": 45,
                "MOLINET": 5,
                "RACO": 17
            }
        },
        TNM: {
            diari: {
                "CARETA INICI": 17,
                "CARETA SORTIDA": 5,
                "CARETA": 5,
                "SUMARI": 23,
                "MOLINET": 5,
                "RACO": 13,
                "EFECTE": 3,
                "BOLA DEL MON": 10
            },
            capDeSetmana: {
                "CARETA INICI": 17,
                "CARETA SORTIDA": 5,
                "CARETA": 5,
                "SUMARI": 23,
                "MOLINET": 5,
                "RACO": 13,
                "EFECTE": 3,
                "BOLA DEL MON": 10
            }
        },
        MAT: {
            diari: {
                "CARETA": 15,
                "SUMARI": 30,
                "MOLINET": 5
            },
            capDeSetmana: {
                "CARETA": 15,
                "SUMARI": 30,
                "MOLINET": 5
            }
        }
    };

    /**
     * getOverridenDuration: Retorna la durada override per un item, o null si no n'hi ha.
     */
    ER.getOverridenDuration = function (program, titol, isWeekend) {
        const progOverrides = this.ITEM_DURATION_OVERRIDES[program];
        if (!progOverrides) return null;
        const mode = isWeekend ? 'capDeSetmana' : 'diari';
        const modeOverrides = progOverrides[mode];
        if (!modeOverrides) return null;
        const upper = titol.toUpperCase().trim();
        for (var key in modeOverrides) {
            if (upper.indexOf(key) !== -1) {
                return modeOverrides[key];
            }
        }
        return null;
    };
})();