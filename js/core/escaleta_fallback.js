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
     * mp4ExpandedInPoint=0 (inici del fitxer).
     *
     * ⚠️ (2026-09-21) ABANS es reutilitzava `bounds.mp4Duration`, que pot estar CORRUPTE: quan
     * el bloc s'emet després del final del cleanFeed, `mp4ExpandedOutPoint` queda limitat al
     * final del cleanFeed i el pedaç «Ajustant…» d'escaleta_bounds deixa `mp4Duration = 1.0s`
     * → el clip del bloc sortia d'1 segon (cas real TNM V2 21/09: clip de 61s al timeline per a
     * un bloc de 2:21; l'escaleta i el timeline no coincidien). Ara la durada es RECALCULA amb
     * els temps ABSOLUTS del bloc (worldBlockEndSec − worldBlockStartSec) + els handles.
     *
     * Els valors absoluts (worldBlockStartSec, worldBlockEndSec) es
     * mantenen intactes perquè els marcadors depenen d'ells.
     *
     * @param {Object} bounds  - Resultat original de calcPrecisionTrimBounds()
     * @param {number} [handles=0] - Handles (marges) en segons, perquè el clip tingui cua
     * @returns {{ mp4ExpandedInPoint: number, mp4ExpandedOutPoint: number, mp4Duration: number }}
     */
    ER.calcFallbackBoundsForBlockMedia = function (bounds, handles) {
        if (!bounds) return null;

        var h = (typeof handles === 'number' && isFinite(handles)) ? handles : 0;
        var ref = bounds.ref || {};
        var dur = null;
        var src = '';

        if (ref.worldBlockStartSec != null && ref.worldBlockEndSec != null &&
            (ref.worldBlockEndSec - ref.worldBlockStartSec) > 1) {
            var cont = ref.worldBlockEndSec - ref.worldBlockStartSec;
            dur = cont + h;
            src = 'bloc ' + cont.toFixed(1) + 's + handle ' + h.toFixed(1) + 's';
        } else if (bounds.mp4Duration > 1) {
            dur = bounds.mp4Duration;
            src = 'mp4Duration original (sense worldBlock*Sec)';
        }

        if (dur === null) {
            log('⚠️ No es pot recalcular la durada del bloc (falten worldBlockStartSec/EndSec) → es manté ' +
                (bounds.mp4Duration || 0).toFixed(1) + 's');
            dur = bounds.mp4Duration || 0;
        } else {
            log('📐 Durada del bloc recalculada: ' + dur.toFixed(1) + 's (' + src + ')');
        }

        return {
            mp4ExpandedInPoint:  0,
            mp4ExpandedOutPoint: dur,
            mp4Duration:         dur
        };
    };

    // Persistir al namespace
    FASTPASS_UI.EscaletaReader = ER;
    window.FASTPASS_UI = FASTPASS_UI;

    log('Sub-modul inicialitzat (2 metodes)');
})();
