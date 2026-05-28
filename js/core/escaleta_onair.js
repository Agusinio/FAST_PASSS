/**
 * ============================================================================
 * FASTPASS_UI.EscaletaReader - Sub-mòdul: Resolució OnAir + Clip Bounds
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
    // CALCUL DE BOUNDS DEL CLIP (MP4)
    // ----------------------------------------------------------------

    /**
     * calcClipBounds: Calcula el mp4ExpandedInPoint i mp4ExpandedOutPoint dins del MP4 del cleanFeed,
     * aplicant els handles de seguretat indicats.
     *
     * Fórmula:
     *   mp4ExpandedInPoint  = (worldTCBlockIn  - worldTCMediaStart) - handleSecs   [màx 0]
     *   mp4ExpandedOutPoint = (worldTCBlockOut - worldTCMediaStart) + handleSecs   [màx mediaDuration]
     *
     * @param {string} worldTCMediaStart - TC inici del MP4 "HH:MM:SS:FF" o "HH:MM:SS"
     * @param {string} worldTCBlockIn    - Hora d'inici del bloc "HH:MM:SS"
     * @param {string} worldTCBlockOut   - Hora de fi del bloc "HH:MM:SS"
     * @param {number} [handleSecs] - Handles en segons (actualment forçats a 0)
     * @param {string} [worldTCMediaStop]  - TC de fi del MP4 per truncar outPoint si cal
     * @returns {{ mp4ExpandedInPoint: number, mp4ExpandedOutPoint: number, mp4Duration: number }}
     */
    ER.calcClipBounds = function (worldTCMediaStart, worldTCBlockIn, worldTCBlockOut, handleSecs, worldTCMediaStop) {
        const handles = this._getHandleSecs();
        const worldSecMediaStart = this.tcToSeconds(worldTCMediaStart);
        const worldSecBlockIn     = this.tcToSeconds(worldTCBlockIn);
        const worldSecBlockOut    = this.tcToSeconds(worldTCBlockOut);

        let mp4ExpandedInPoint  = Math.max(0, (worldSecBlockIn  - worldSecMediaStart) - handles);
        let mp4ExpandedOutPoint = (worldSecBlockOut - worldSecMediaStart) + handles;

        // Truncar outPoint a la durada del MP4 si tenim mediaStop
        if (worldTCMediaStop) {
            const worldSecMediaStop = this.tcToSeconds(worldTCMediaStop);
            const maxDur = worldSecMediaStop - worldSecMediaStart;
            if (mp4ExpandedOutPoint > maxDur) mp4ExpandedOutPoint = maxDur;
        }

        const mp4Duration = mp4ExpandedOutPoint - mp4ExpandedInPoint;

        return { mp4ExpandedInPoint, mp4ExpandedOutPoint, mp4Duration };
    };

    /**
     * getOnAirVideoItems: Retorna els ítems del bloc que tenen vídeo i hora d'emissió real.
     */
    ER.getOnAirVideoItems = function (data, blockId) {
        const lines = this.getLinesForBlock(data, blockId);
        return lines.filter(function (l) { return l.teVideo && l.horaEntradaOnAir; });
    };

    /**
     * getNeighbourOnAirTimes: Busca els timestamps d'emissió dels blocs adjacents.
     * Útil per tancar fronteres quan el bloc actual comença o acaba sense vídeo.
     */
    ER.getNeighbourOnAirTimes = function (data, blockId) {
        const clips = data && data.cleanFeed && data.cleanFeed.clips ? data.cleanFeed.clips : [];
        const idx = clips.findIndex(function (c) { return c.id === blockId; });
        if (idx === -1) return