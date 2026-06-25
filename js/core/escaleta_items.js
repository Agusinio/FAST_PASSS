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
 *   - _deduceOnAirSortida(item, allLines, allowCrossAgrupacio)
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
    ER._deduceOnAirEntrada = function (item, allLines, data, ignoreAgrupacio) {
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
            // ignoreAgrupacio=true permet creuar fronteres d'agrupacio
            // (útil per a Tier0-IN quan no hi ha video previ al mateix agrupacio).
            if (!ignoreAgrupacio && item.agrupacio && prevItem.agrupacio !== item.agrupacio) continue;

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
     * Two-phase strategy controlled by allowCrossAgrupacio:
     *   Phase 1 (always): same agrupacio (BUG #13). Can compete with primaryResult.
     *   Phase 2 (allowCrossAgrupacio=true): cross-agrupacio fallback.
     *     Only used as last resort when primaryResult AND Phase 1 both fail.
     *     Must NOT compete with a valid primaryResult (BUG #19).
     *
     * @param {object} item
     * @param {Array} allLines
     * @param {boolean} [allowCrossAgrupacio] - Default false. True enables Phase 2.
     * @returns {number|null}
     */
    ER._deduceOnAirSortida = function (item, allLines, allowCrossAgrupacio) {
        if (!item || !allLines || allLines.length === 0) return null;

        var itemIdx = allLines.indexOf(item);
        if (itemIdx < 0 || itemIdx >= allLines.length - 1) return null;

        // ── Phase 1: same agrupacio (BUG #13) ──
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

        // ── Phase 2 (BUG #19): cross-agrupacio fallback ──
        // Només s'activa quan allowCrossAgrupacio=true (cridat des de
        // getItemSortidaSec com a últim recurs). NO ha de competir
        // amb primaryResult — només és fallback absolut.
        // Només per items amb agrupacio (blocs), no per a totems (null).
        if (allowCrossAgrupacio && item.agrupacio) {
            for (var j = itemIdx + 1; j < allLines.length; j++) {
                var nextItem2 = allLines[j];
                if (!nextItem2) continue;
                if (nextItem2.flotant === true) continue;
                var nextOnAir2 = nextItem2.horaEntradaOnAir;
                if (nextOnAir2 && nextOnAir2 !== "00:00:00") {
                    log('   \uD83D\uDD17 [deduceOnAirSortida] "' + item.num + '" (agrupacio:' + item.agrupacio + '): cross-agrupacio fallback \u2192 "' + nextItem2.num + '" (agrupacio:' + (nextItem2.agrupacio || 'null') + ') OnAir=' + nextOnAir2);
                    return this.tcToSeconds(nextOnAir2);
                }
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
        if (h && h !== "00:00:00") {
            var onAirSec = this.tcToSeconds(h);
            // MOLINET: items repetibles (reapareixen en blocs posteriors).
            // El seu horaEntradaOnAir pot ser de l'última aparició, no de la primera.
            // Si OnAir és >120s posterior a Prevista, es descarta i s'usa Prevista.
            var titol = (item.titol || '').toUpperCase();
            if (titol.indexOf('MOLINET') !== -1 && item.horaEntradaPrevista && item.horaEntradaPrevista !== '00:00:00') {
                var prevSec = this.tcToSeconds(item.horaEntradaPrevista);
                if (onAirSec - prevSec > 120) {
                    log('   \uD83D\uDD04 [MOLINET] ' + (item.num || '?') + ': OnAir=' + onAirSec.toFixed(1) + 's > Prevista=' + prevSec.toFixed(1) + 's (+' + (onAirSec - prevSec).toFixed(0) + 's). OnAir descartat (molinet reutilitzat).');
                    return prevSec;
                }
            }
            return onAirSec;
        }
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
     *   1. horaEntradaOnAir + durada (si l'item té OnAir propi)
     *   2. OnAirDeducido entrada + durada
     *   3. SalidaOnAirDeducida — Phase 1: mateix agrupacio (pot competir)
     *   4. SalidaOnAirDeducida — Phase 2: cross-agrupacio (només fallback)
     *   5. horaEntradaPrevista + durada
     *
     * BUG #19: Phase 2 cross-agrupacio NO competeix amb primaryResult.
     * Només s'usa quan primaryResult i Phase 1 fallen (últim recurs).
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
            var onAirSec = this.tcToSeconds(h);
            var duradaSec = this.getItemDuradaSec(item);
            primaryResult = onAirSec + duradaSec;
            log('   🔍 [getItemSortidaSec] "' + (item.num || '?') + '": OnAir=' + onAirSec.toFixed(2) + 's + durada=' + duradaSec.toFixed(2) + 's = ' + primaryResult.toFixed(2) + 's');
        }

        if (primaryResult === null && allLines && allLines.length > 0) {
            var deducedEntrada = this._deduceOnAirEntrada(item, allLines, data);
            if (deducedEntrada !== null) {
                primaryResult = deducedEntrada + this.getItemDuradaSec(item);
            }
        }

        // --- Competidor Phase 1: same agrupacio (fet dur del playout) ---
        // BUG #11: duradaOnAir pot ser inconsistent. El següent OnAir del
        // MATEIX agrupacio és un fet dur del playout i SÍ competeix.
        var nextOnAirSameAgrupacio = null;
        if (allLines && allLines.length > 0) {
            nextOnAirSameAgrupacio = this._deduceOnAirSortida(item, allLines, false);
        }

        if (primaryResult !== null && nextOnAirSameAgrupacio !== null && nextOnAirSameAgrupacio > primaryResult) {
            log('   🟡 [getItemSortidaSec] "' + item.num + '": Phase1 same-agrup OnAir=' + nextOnAirSameAgrupacio.toFixed(2) + 's > primaryResult=' + primaryResult.toFixed(2) + 's. Guanya Phase1 (fet dur del playout).');
            return nextOnAirSameAgrupacio;
        }
        if (primaryResult !== null) return primaryResult;
        if (nextOnAirSameAgrupacio !== null) return nextOnAirSameAgrupacio;

        // --- Phase 2 cross-agrupacio (BUG #19): només fallback absolut ---
        // Si primaryResult i Phase 1 fallen, és l'últim recurs.
        // No ha de competir, no és aquí.
        if (allLines && allLines.length > 0) {
            var nextOnAirCross = this._deduceOnAirSortida(item, allLines, true);
            if (nextOnAirCross !== null) {
                log('   🔗 [getItemSortidaSec] "' + item.num + '": Phase2 cross-agrup OnAir=' + nextOnAirCross.toFixed(2) + 's (últim recurs).');
                return nextOnAirCross;
            }
        }

        // --- Últim fallback: Prevista ---
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