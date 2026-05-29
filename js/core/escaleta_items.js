/**
 * ============================================================================
 * FASTPASS_UI.EscaletaReader: Sub-mòdul ITEMS
 * ============================================================================
 * Helpers de resolució temporal per item: entrada, durada, sortida, deducció OnAir.
 *
 * Depèn de: escaleta_config.js (_getCorrectedDuration)
 *           escaleta_timecode.js (parseDurada, tcToSeconds)
 *
 * Mètodes:
 *   - _isCareta(titol)
 *   - isItemEstructural(item)
 *   - getItemDuradaSec(item)
 *   - _deduceOnAirEntrada(item, allLines, data)
 *   - _deduceOnAirSortida(item, allLines)
 *   - getItemEntradaSec(item, allLines, data)
 *   - getItemSortidaSec(item, allLines, data)
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
    // 1. CLASSIFICACIÓ D'ITEMS
    // ----------------------------------------------------------------

    /**
     * _isCareta: Determina si un títol correspon a una careta.
     * @param {string} titol - Títol de l'item
     * @returns {boolean}
     */
    ER._isCareta = function (titol) {
        if (!titol) return false;
        return titol.toUpperCase().trim().indexOf('CARETA') !== -1;
    };

    /**
     * isItemEstructural: Determina si un item és estructural (té durada pròpia > 0).
     * Usa durada literal (RAW), NO duradaOnAir.
     * @param {object} item - Línia de l'escaleta
     * @returns {boolean}
     */
    ER.isItemEstructural = function (item) {
        if (!item) return false;
        return this.parseDurada(item.durada || '0:00') > 0;
    };

    // ----------------------------------------------------------------
    // 2. DURADA D'UN ITEM
    // ----------------------------------------------------------------

    /**
     * getItemDuradaSec: Retorna la millor durada disponible per a un item.
     * Cadena: duradaOnAir -> durada -> 0
     * @param {object} item
     * @returns {number}
     */
    ER.getItemDuradaSec = function (item) {
        if (!item) return 0;
        var d = item.duradaOnAir;
        if (d) {
            var sec = this.parseDurada(d);
            if (sec > 0) return sec;
        }
        return this.parseDurada(item.durada || '0:00');
    };

    // ----------------------------------------------------------------
    // 3. DEDUCCIÓ OnAir D'ENTRADA
    // ----------------------------------------------------------------

    /**
     * _deduceOnAirEntrada: Dedueix l'OnAir d'entrada a partir d'items
     * anteriors amb horaEntradaOnAir coneguda, acumulant duracions.
     *
     * @param {object} item - Línia objectiu
     * @param {Array} allLines - Totes les liniesEscaleta
     * @param {object} [data] - JSON complet (per overrides de durada)
     * @returns {number|null}
     */
    ER._deduceOnAirEntrada = function (item, allLines, data) {
        if (!item || !allLines || allLines.length === 0) return null;

        var itemIdx = allLines.indexOf(item);
        if (itemIdx <= 0) return null;

        var accumulatedDur = 0;

        for (var i = itemIdx - 1; i >= 0; i--) {
            var prevItem = allLines[i];
            if (!prevItem) continue;
            if (prevItem.flotant === true) continue;
            // BUG #16-B1: Filtrar per agrupacio. Si l'item té agrupacio,
            // només considerar items del MATEIX agrupacio. null !== "v1",
            // per tant els items null (totems) no contaminen la deducció
            // d'items que pertanyen a un bloc.
            if (item.agrupacio && prevItem.agrupacio !== item.agrupacio) continue;

            var prevOnAir = prevItem.horaEntradaOnAir;
            if (prevOnAir && prevOnAir !== "00:00:00") {
                var anchorSec = this.tcToSeconds(prevOnAir);
                var anchorDur = this.parseDurada(prevItem.duradaOnAir || prevItem.durada);
                return anchorSec + anchorDur + accumulatedDur;
            }

            if (this.isItemEstructural(prevItem)) {
                if (data && prevItem.titol && this._isCareta(prevItem.titol)) {
                    accumulatedDur += this._getCorrectedDuration(prevItem, data);
                } else {
                    accumulatedDur += this.parseDurada(prevItem.duradaOnAir || prevItem.durada);
                }
            }
        }

        return null;
    };

    // ----------------------------------------------------------------
    // 4. DEDUCCIÓ OnAir DE SORTIDA
    // ----------------------------------------------------------------

    /**
     * _deduceOnAirSortida: Dedueix l'OnAir de sortida usant el primer
     * item posterior amb horaEntradaOnAir vàlida.
     *
     * @param {object} item
     * @param {Array} allLines
     * @returns {number|null}
     */
    ER._deduceOnAirSortida = function (item, allLines) {
        if (!item || !allLines || allLines.length === 0) return null;

        var itemIdx = allLines.indexOf(item);
        if (itemIdx < 0 || itemIdx >= allLines.length - 1) return null;

        for (var i = itemIdx + 1; i < allLines.length; i++) {
            var nextItem = allLines[i];
            if (!nextItem) continue;
            if (nextItem.flotant === true) continue;
            // BUG #13: no competir amb el següent OnAir si pertany a un altre agrupacio.
            // Si l'item té agrupacio, només competeix amb items del MATEIX agrupacio.
            // null !== "v1", per tant els items null (totems) també es filtren
            // quan l'item actual pertany a un bloc. Els totems només competeixen
            // entre ells (quan item.agrupacio també és null).
            if (item.agrupacio && nextItem.agrupacio !== item.agrupacio) continue;

            var nextOnAir = nextItem.horaEntradaOnAir;
            if (nextOnAir && nextOnAir !== "00:00:00") {
                return this.tcToSeconds(nextOnAir);
            }
        }

        return null;
    };

    // ----------------------------------------------------------------
    // 5. ENTRADA D'UN ITEM (cadena de resolució)
    // ----------------------------------------------------------------

    /**
     * getItemEntradaSec: horaEntradaOnAir -> OnAirDeducido -> horaEntradaPrevista -> null
     * @param {object} item
     * @param {Array} [allLines]
     * @param {object} [data]
     * @returns {number|null}
     */
    ER.getItemEntradaSec = function (item, allLines, data) {
        if (!item) return null;
        var h = item.horaEntradaOnAir;
        if (h && h !== "00:00:00") return this.tcToSeconds(h);
        if (allLines && allLines.length > 0) {
            var deduced = this._deduceOnAirEntrada(item, allLines, data);
            if (deduced !== null) return deduced;
        }
        h = item.horaEntradaPrevista;
        if (h && h !== "00:00:00") return this.tcToSeconds(h);
        return null;
    };

    // ----------------------------------------------------------------
    // 6. SORTIDA D'UN ITEM (cadena de resolució)
    // ----------------------------------------------------------------

    /**
     * getItemSortidaSec: 4 nivells de resolució per a la sortida.
     *   1. horaEntradaOnAir + durada
     *   2. OnAirDeducido entrada + durada
     *   3. SalidaOnAirDeducida (primer OnAir posterior)
     *   4. horaEntradaPrevista + durada
     *
     * @param {object} item
     * @param {Array} [allLines]
     * @param {object} [data]
     * @returns {number|null}
     */
    ER.getItemSortidaSec = function (item, allLines, data) {
        if (!item) return null;

        // --- Cadena primària de resolució ---
        var primaryResult = null;

        var h = item.horaEntradaOnAir;
        if (h && h !== "00:00:00") {
            primaryResult = this.tcToSeconds(h) + this.getItemDuradaSec(item);
        }

        if (primaryResult === null && allLines && allLines.length > 0) {
            var deducedEntrada = this._deduceOnAirEntrada(item, allLines, data);
            if (deducedEntrada !== null) {
                primaryResult = deducedEntrada + this.getItemDuradaSec(item);
            }
        }

        // --- Competidor: següent horaEntradaOnAir (fet dur del playout) ---
        var nextOnAirSec = null;
        if (allLines && allLines.length > 0) {
            nextOnAirSec = this._deduceOnAirSortida(item, allLines);
        }

        // BUG #11: duradaOnAir pot ser inconsistent. El següent OnAir
        // és un fet dur del playout i ha de competir, no ser només fallback.
        if (primaryResult !== null && nextOnAirSec !== null && nextOnAirSec > primaryResult) {
            log('   🟡 [getItemSortidaSec] "' + item.num + '": següent OnAir=' + nextOnAirSec.toFixed(2) + 's > duradaOnAir=' + primaryResult.toFixed(2) + 's. Guanya següent OnAir.');
            return nextOnAirSec;
        }
        if (primaryResult !== null) return primaryResult;

        // --- Fallback ---
        if (nextOnAirSec !== null) return nextOnAirSec;

        h = item.horaEntradaPrevista;
        if (h && h !== "00:00:00") {
            return this.tcToSeconds(h) + this.getItemDuradaSec(item);
        }

        return null;
    };

    // ----------------------------------------------------------------
    // Registre al namespace
    // ----------------------------------------------------------------
    FASTPASS_UI.EscaletaReader = ER;
    window.FASTPASS_UI = FASTPASS_UI;

    log('[ER:Items] Sub-modul inicialitzat');
})();
