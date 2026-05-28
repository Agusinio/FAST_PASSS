/**
 * ============================================================================
 * FASTPASS_UI.EscaletaReader: Sub-mòdul CONFIG
 * ============================================================================
 * Configuració de rutes, handles, overrides de durada i detecció de programa.
 *
 * Depèn de: escaleta_timecode.js (parseDurada, secondsToDuradaTC)
 *
 * Mètodes:
 *   - ESCALETES_PATH
 *   - _getHandleSecs()
 *   - ITEM_DURATION_OVERRIDES
 *   - _detectProgramKey(data)
 *   - _isWeekend(data)
 *   - _getCorrectedDuration(item, data)
 *   - applyDurationOverrides(data)
 * ============================================================================
 */

(function () {
    var FASTPASS_UI = window.FASTPASS_UI || {};
    var ER = FASTPASS_UI.EscaletaReader || {};

    var log = function (m) {
        (window.FASTPASS_UI.Utils && window.FASTPASS_UI.Utils.log)
            ? window.FASTPASS_UI.Utils.log(m, 'DEBUG')
            : (window.console && window.console.log(m));
    };

    // ----------------------------------------------------------------
    // 1. CONSTANTS DE CONFIGURACIÓ
    // ----------------------------------------------------------------

    /**
     * Ruta d'escaletes al servidor.
     */
    ER.ESCALETES_PATH = "\\\\public.ad-ccrtv.local\\Public\\VERTICALITZACIO_INFORMATIUS\\ESCALETES";

    /**
     * Handles en segons (marge de seguretat al voltant del TC d'emissió).
     * Llegeix de Config.get().handles. Si no disponible, usa 3s per defecte.
     * Font única de veritat: 11_Configuracio.js._activeConfig.general.handles
     */
    ER._getHandleSecs = function () {
        var cfg = window.FASTPASS_UI.Config && window.FASTPASS_UI.Config.get();
        return (cfg && cfg.handles != null) ? cfg.handles : 3;
    };

    // ----------------------------------------------------------------
    // 2. MAPA DE CORRECCIÓ DE DURADES
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
    //
    // L'ordre de les claus importa: les més específiques primer.

    ER.ITEM_DURATION_OVERRIDES = {
        // ── TN COMARQUES (TNC) ──
        TNC: {
            diari: {
                'CARETA': 10,
                'MOLINET 01': 10,
                'TORNADA DE PUBLI': 10
            }
        },
        // ── TN VESPRE (TNV) ──
        TNV: {
            diari: {
                'CARETA TNV': 10,
                'MOLINET 1': 4,
                'MOLINET 2': 4,
                'CARETA ESPORTS': 6,
                'EFECTE CUC': 2
            },
            capDeSetmana: {
                'CARETA TNV': 13,
                'MOLINET 1': 6,
                'MOLINET TORNADA PUBLI': 5,
                'CARETA ESPORTS': 7
            }
        },
        // ── TN MIGDIA (TNM) ──
        TNM: {
            diari: {
                'CARETA TNMigdia INICI': 10,
                'MOLINET 1': 5,
                'MOLINET 2': 5,
                'CARETA ESPORTS': 7,
                'EFECTE PLATÓ': 5,
                'EFECTE CUC': 2,
                'EF-CUC': 2
            },
            capDeSetmana: {
                'CARETA': 13,
                'MOLINET 1': 5,
                'CARETA ESPORTS': 7,
                'EFECTE CUC X ANAR A JORDI': 2,
                'EF-CUC': 2
            }
        }
    };

    // ----------------------------------------------------------------
    // 3. DETECCIÓ DE PROGRAMA I EDICIÓ
    // ----------------------------------------------------------------

    /**
     * _detectProgramKey: Detecta la clau de programa (TNC, TNV, TNM) a partir
     * de les dades de l'escaleta.
     * @param {Object} data - JSON parsejat de l'escaleta
     * @returns {string|null} "TNC", "TNV", "TNM" o null si no es detecta
     */
    ER._detectProgramKey = function (data) {
        var ruta = data && data.escaleta && data.escaleta.ruta ? data.escaleta.ruta : '';
        var origen = data && data.escaleta && data.escaleta.origen ? data.escaleta.origen : '';
        if (origen === 'TNV' || ruta.indexOf('TN-VESPRE') !== -1 || ruta.indexOf('TNVESPRE') !== -1) return 'TNV';
        if (origen === 'TNM' || ruta.indexOf('TN-MIGDIA') !== -1 || ruta.indexOf('TNMIGDIA') !== -1) return 'TNM';
        if (origen === 'COM' || ruta.indexOf('TN-COMARQUES') !== -1 || ruta.indexOf('TNCOMARQUES') !== -1) return 'TNC';
        return null;
    };

    /**
     * _isWeekend: Determina si la data de l'escaleta cau en cap de setmana.
     * @param {Object} data - JSON parsejat de l'escaleta
     * @returns {boolean}
     */
    ER._isWeekend = function (data) {
        var dataISO = data && data.escaleta && data.escaleta.data ? data.escaleta.data : null;
        if (!dataISO) return false;
        try {
            var d = new Date(dataISO);
            var dow = d.getDay(); // 0=Sun, 6=Sat
            return (dow === 0 || dow === 6);
        } catch (e) {
            return false;
        }
    };

    // ----------------------------------------------------------------
    // 4. CORRECCIÓ DE DURADES
    // ----------------------------------------------------------------

    /**
     * _getCorrectedDuration: Obté la durada corregida per a un item d'escaleta,
     * segons el programa i l'edició (laboral/cap de setmana).
     *
     * Busca per coincidència parcial de títol (indexOf). Si no troba overrides,
     * retorna la durada original de l'escaleta.
     *
     * @param {Object} item - Línia d'escaleta { titol, durada, duradaOnAir }
     * @param {Object} data - JSON complet de l'escaleta (per detectar programa/finde)
     * @returns {number} Durada en segons (corregida si aplica, original si no)
     */
    ER._getCorrectedDuration = function (item, data) {
        if (!item || !item.titol) return 0;
        var progKey = this._detectProgramKey(data);
        if (!progKey) {
            return this.parseDurada(item.duradaOnAir || item.durada);
        }
        var progOverrides = this.ITEM_DURATION_OVERRIDES[progKey];
        if (!progOverrides) {
            return this.parseDurada(item.duradaOnAir || item.durada);
        }
        var isWeekend = this._isWeekend(data);
        var table = isWeekend ? progOverrides.capDeSetmana : progOverrides.diari;
        if (!table) {
            return this.parseDurada(item.duradaOnAir || item.durada);
        }
        var title = item.titol.trim();
        // Buscar per coincidència parcial (la clau més específica primer)
        for (var key in table) {
            if (table.hasOwnProperty(key) && title.indexOf(key) !== -1) {
                return table[key];
            }
        }
        // No s'ha trobat override: retornar durada original
        return this.parseDurada(item.duradaOnAir || item.durada);
    };

    /**
     * applyDurationOverrides: Corregeix les durades de tots els items de l'escaleta
     * aplicant els overrides del mapa ITEM_DURATION_OVERRIDES.
     * Es crida automàticament des de load().
     *
     * @param {Object} data - JSON parsejat de l'escaleta (es modifica in-place)
     * @returns {number} Nombre d'items corregits
     */
    ER.applyDurationOverrides = function (data) {
        var lines = data && data.escaleta && data.escaleta.liniesEscaleta ? data.escaleta.liniesEscaleta : null;
        if (!lines || !Array.isArray(lines)) return 0;
        var progKey = this._detectProgramKey(data);
        var isWeekend = this._isWeekend(data);
        var corrected = 0;
        for (var i = 0; i < lines.length; i++) {
            var item = lines[i];
            if (!item || !item.titol) continue;
            var correctedDur = this._getCorrectedDuration(item, data);
            var originalDur = this.parseDurada(item.duradaOnAir || item.durada);
            if (Math.abs(correctedDur - originalDur) > 0.01) {
                var tcStr = this.secondsToDuradaTC(correctedDur);
                item.durada = tcStr;
                if (item.duradaOnAir) {
                    item.duradaOnAir = tcStr;
                }
                corrected++;
                log('  \uD83D\uDD27 [ER:Config] "' + item.titol + '": ' + originalDur + 's \u2192 ' + correctedDur + 's (' + progKey + (isWeekend ? ' CS' : '') + ')');
            }
        }
        if (corrected > 0) {
            log('\uD83D\uDCD0 [ER:Config] ' + corrected + ' items corregits a l\'escaleta');
        }
        return corrected;
    };

    // ----------------------------------------------------------------
    // Registre al namespace
    // ----------------------------------------------------------------
    FASTPASS_UI.EscaletaReader = ER;
    window.FASTPASS_UI = FASTPASS_UI;

    log('[ER:Config] Sub-mòdul inicialitzat (ESCALETES_PATH, _getHandleSecs, ITEM_DURATION_OVERRIDES, applyDurationOverrides)');
})();
