/**
 * ============================================================================
 * FASTPASS_UI.EscaletaReader: Sub-mòdul TIMECODE
 * ============================================================================
 * Funcions pures de conversió de timecode. Sense dependències internes.
 * S'afegeix al namespace FASTPASS_UI.EscaletaReader.
 *
 * Mètodes:
 *   - parseDurada(str)        → "M:SS"/"H:MM:SS" a segons
 *   - tcToSeconds(tc, fps)    → "HH:MM:SS"/"HH:MM:SS:FF" a segons
 *   - secondsToTC(sec)        → segons a "HH:MM:SS"
 *   - secondsToDuradaTC(sec)  → segons a "M:SS"
 * ============================================================================
 */

(function () {
    var FASTPASS_UI = window.FASTPASS_UI || {};
    var ER = FASTPASS_UI.EscaletaReader || {};

    const log = function (m) {
        (window.FASTPASS_UI.Utils && window.FASTPASS_UI.Utils.log)
            ? window.FASTPASS_UI.Utils.log(m, 'DEBUG')
            : (window.console && window.console.log(m));
    };

    // ----------------------------------------------------------------
    // 1. CONVERSIÓ DE DURADES
    // ----------------------------------------------------------------

    /**
     * parseDurada: Converteix "M:SS" o "H:MM:SS" (formats de playout) a segons.
     * Diferent del TC estàndard perquè pot no tenir hores o frames.
     * @param {string} str
     * @returns {number}
     */
    ER.parseDurada = function (str) {
        if (!str || str === "0:00") return 0;
        var parts = str.toString().split(':');
        if (parts.length === 2) {
            // M:SS
            return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
        } else if (parts.length === 3) {
            // H:MM:SS
            return parseInt(parts[0], 10) * 3600 + parseInt(parts[1], 10) * 60 + parseInt(parts[2], 10);
        }
        return 0;
    };

    /**
     * secondsToDuradaTC: Converteix segons a format de durada "M:SS" (estil playout).
     * @param {number} sec
     * @returns {string}
     */
    ER.secondsToDuradaTC = function (sec) {
        if (sec === null || sec === undefined || isNaN(sec) || sec <= 0) return "0:00";
        var mm = Math.floor(sec / 60);
        var ss = Math.floor(sec % 60);
        return mm + ':' + (ss < 10 ? '0' : '') + ss;
    };

    // ----------------------------------------------------------------
    // 2. CONVERSIÓ DE TIMECODES
    // ----------------------------------------------------------------

    /**
     * secondsToTC: Converteix segons a timecode "HH:MM:SS" (sense frames).
     * @param {number} sec
     * @returns {string}
     */
    ER.secondsToTC = function (sec) {
        if (sec === null || sec === undefined || isNaN(sec)) return "00:00:00";
        var hh = Math.floor(sec / 3600);
        var mm = Math.floor((sec % 3600) / 60);
        var ss = Math.floor(sec % 60);
        return (hh < 10 ? '0' : '') + hh + ':' +
               (mm < 10 ? '0' : '') + mm + ':' +
               (ss < 10 ? '0' : '') + ss;
    };

    /**
     * tcToSeconds: Converteix un timecode a segons.
     * Accepta formats: "HH:MM:SS", "HH:MM:SS:FF", "H:MM:SS"
     * @param {string} tc
     * @param {number} [fps=25]
     * @returns {number}
     */
    ER.tcToSeconds = function (tc, fps) {
        if (!tc) return 0;
        fps = fps || 25;
        var parts = tc.split(':');
        if (parts.length === 3) {
            // HH:MM:SS
            return parseInt(parts[0], 10) * 3600
                 + parseInt(parts[1], 10) * 60
                 + parseInt(parts[2], 10);
        } else if (parts.length === 4) {
            // HH:MM:SS:FF
            return parseInt(parts[0], 10) * 3600
                 + parseInt(parts[1], 10) * 60
                 + parseInt(parts[2], 10)
                 + parseInt(parts[3], 10) / fps;
        }
        return 0;
    };

    // ----------------------------------------------------------------
    // Registre al namespace
    // ----------------------------------------------------------------
    FASTPASS_UI.EscaletaReader = ER;
    window.FASTPASS_UI = FASTPASS_UI;

    log('[ER:Timecode] Sub-mòdul inicialitzat (parseDurada, secondsToDuradaTC, secondsToTC, tcToSeconds)');
})();
