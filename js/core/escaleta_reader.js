/**
 * ============================================================================
 * FASTPASS_UI.EscaletaReader: PONT d'importació
 * ============================================================================
 * Aquest fitxer actua com a pont de compatibilitat. Els mètodes reals es
 * troben als sub-mòduls carregats prèviament:
 *   escaleta_timecode.js  → parseDurada, tcToSeconds, secondsToTC, secondsToDuradaTC
 *   escaleta_config.js    → ESCALETES_PATH, ITEM_DURATION_OVERRIDES, applyDurationOverrides, ...
 *   escaleta_io.js        → findLatest, getStatus, load
 *   escaleta_items.js     → isItemEstructural, getItemEntradaSec, getItemSortidaSec, ...
 *   escaleta_bounds.js    → calcPrecisionTrimBounds, calcClipBounds, calcOnAirBounds, ...
 *   escaleta_fallback.js  → isBoundsOutOfCleanFeedRange, calcFallbackBoundsForBlockMedia
 *
 * Tots els sub-mòduls extenen FASTPASS_UI.EscaletaReader.
 * L'alias global window.EscaletaReader es manté per compatibilitat.
 * ============================================================================
 */

(function () {
    var FASTPASS_UI = window.FASTPASS_UI || {};

    // Assegurar que l'objecte existeix (els sub-mòduls l'han creat)
    if (!FASTPASS_UI.EscaletaReader) {
        FASTPASS_UI.EscaletaReader = {};
    }

    window.FASTPASS_UI = FASTPASS_UI;

    // Alias global per accés directe (compatibilitat amb 4 consumidors existents)
    window.EscaletaReader = FASTPASS_UI.EscaletaReader;

    if (FASTPASS_UI.Utils && FASTPASS_UI.Utils.log) {
        FASTPASS_UI.Utils.log('[ER:Bridge] Pont inicialitzat — ' +
            Object.keys(FASTPASS_UI.EscaletaReader).length + ' metodes disponibles');
    }
})();
