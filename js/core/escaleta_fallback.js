/**
 * ============================================================================
 * FASTPASS_UI.EscaletaReader: Sub-mòdul FALLBACK
 * ============================================================================
 * Detecció de fora de rang del cleanFeed MP4 i recàlcul de bounds per
 * al M4V individual del bloc quan el cleanFeed no cobreix el rang temporal.
 *
 * Depèn de: escaleta_timecode.js (tcToSeconds)
 *
 * Prefix de log: [ER:Fallback]
 * ============================================================================
 */

(function () {
    var FASTPASS_UI = window.FASTPASS_UI || {};
    var ER = FASTPASS_UI.EscaletaReader || {};
    var log = function (m) { FASTPASS_UI.Utils && FASTPASS_UI.Utils.log && FASTPASS_UI.Utils.log('[ER:Fallback] ' + m); };

    // ----------------------------------------------------------------
    // 8. DETECCIÓ DE FALLBACK (Bounds fora del rang del cleanFeed MP4)
    // ----------------------------------------------------------------

    /**
     * isBoundsOutOfCleanFeedRange: Determina si els bounds calculats
     * excedeixen la duració real del MP4 cleanFeed.
     *
     * Quan un bloc s'emet fora de l'horari habitual (ex: TNM V2 a les
     * 15:44 quan el cleanFeed acaba a les 15:29), els bounds relatius
     * al MP4 excedeixen la seva duració i cal usar el MP4 individual
     * del bloc com a font alternativa.
     *
     * @param {Object} bounds      - Resultat de calcPrecisionTrimBounds()
     * @param {string} mediaStart  - TC d'inici del cleanFeed ("14:27:00:00")
     * @param {string} mediaStop   - TC de fi del cleanFeed ("15:29:40:00")
     * @returns {{ outOfRange: boolean, mp4MaxDuration: number, reason: string|null }}
     */
    ER.isBoundsOutOfCleanFeedRange = function (bounds, mediaStart, mediaStop) {
        if (!bounds || !mediaStart || !mediaStop) {
            return { outOfRange: false, mp4MaxDuration: 0, reason: null };
        }

        var worldSecMediaStart = this.tcToSeconds(mediaStart);
        var worldSecMediaStop  = this.tcToSeconds(mediaStop);
        var mp4MaxDuration = worldSecMediaStop - worldSecMediaStart;

        if (mp4MaxDuration <= 0) {
            return { outOfRange: false, mp4MaxDuration: 0, reason: null };
        }

        var inPoint  = bounds.mp4ExpandedInPoint  || 0;
        var outPoint = bounds.mp4ExpandedOutPoint || 0;

        // Detectar si l'inPoint o l'outPoint excedeixen la duració del MP4
        if (inPoint >= mp4MaxDuration) {
            return {
                outOfRange: true,
                mp4MaxDuration: mp4MaxDuration,
                reason: 'mp4ExpandedInPoint (' + inPoint.toFixed(1) + 's) >= duració cleanFeed (' + mp4MaxDuration.toFixed(1) + 's)'
            };
        }

        if (outPoint > mp4MaxDuration) {
            return {
                outOfRange: true,
                mp4MaxDuration: mp4MaxDuration,
                reason: 'mp4ExpandedOutPoint (' + outPoint.toFixed(1) + 's) > duració cleanFeed (' + mp4MaxDuration.toFixed(1) + 's)'
            };
        }

        return { outOfRange: false, mp4MaxDuration: mp4MaxDuration, reason: null };
    };

    // ----------------------------------------------------------------
    // 9. FALLBACK: Càlcul de bounds per a MP4 individual del bloc
    // ----------------------------------------------------------------

    /**
     * calcFallbackBoundsForBlockMedia: Recalcula els bounds per al
     * MP4 individual del bloc (font alternativa quan el cleanFeed
     * no cobreix el rang temporal del bloc).
     *
     * El MP4 del bloc comença al seu propi TC (block.in), per tant
     * mp4ExpandedInPoint=0 (inici del fitxer). La duració del
     * contingut (bounds.mp4Duration) es preserva.
     *
     * Els valors absoluts (worldBlockStartSec, worldBlockEndSec) es
     * mantenen intactes perquè els marcadors depenen d'ells.
     *
     * @param {Object} bounds - Resultat original de calcPrecisionTrimBounds()
     * @returns {{ mp4ExpandedInPoint: number, mp4ExpandedOutPoint: number, mp4Duration: number }}
     */
    ER.calcFallbackBoundsForBlockMedia = function (bounds) {
        if (!bounds) return null;

        // El MP4 individual del bloc comença al seu propi TC intern.
        // mp4ExpandedInPoint=0 perquè el clip comença a l'inici del fitxer.
        // La duració del contingut es manté idèntica.
        return {
            mp4ExpandedInPoint:  0,
            mp4ExpandedOutPoint: bounds.mp4Duration || 0,
            mp4Duration:         bounds.mp4Duration || 0
        };
    };

    // Persistir al namespace
    FASTPASS_UI.EscaletaReader = ER;
    window.FASTPASS_UI = FASTPASS_UI;

    log('Sub-modul inicialitzat (2 metodes)');
})();
