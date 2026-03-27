/**
 * ============================================================================
 * LOGIC: CLIPS (Orquestación de acciones atómicas y Búsqueda) - Clips_Logic.js
 * ============================================================================
 */

(function() {
    var FASTPASS_UI = window.FASTPASS_UI || {};
    FASTPASS_UI.Logic = FASTPASS_UI.Logic || {};

    const utils = {
        callJSX: (s) => window.FASTPASS_UI.Utils.callJSX(s),
        log: (m) => window.FASTPASS_UI.Utils.log(m, "DEBUG")
    };

    FASTPASS_UI.Logic.Clips = {
        
        /**
         * Troba el clip en una pista a un temps determinat.
         * Orquestra la cerca via bridges atòmics (count + indexData).
         */
        findAtTime: async function(trackIdx, timeSec, type) {
            const count = parseInt(await utils.callJSX(`jsx_getClipCount(${trackIdx}, '${type}')`));
            if (count === 0) return null;

            for (let i = 0; i < count; i++) {
                const dataRaw = await utils.callJSX(`jsx_getClipDataByIndex(${trackIdx}, ${i}, '${type}')`);
                if (!dataRaw || dataRaw === "null") continue;
                
                const clip = JSON.parse(dataRaw);
                if (parseFloat(timeSec) >= clip.start && parseFloat(timeSec) <= clip.end) {
                    clip.index = i;
                    return clip;
                }
            }
            return null;
        },

        /**
         * Realiza un Ripple Trim del inicio de un clip.
         */
        rippleTrimStart: async function(trackIdx, clipIdx, cutSec, clipData) {
            const diff = cutSec - clipData.start;
            if (diff <= 0) return "NO_DIFF";

            const newInPoint = clipData.inPoint + diff;
            const type = "video";

            // 1. Ajustar el offset interno del clip
            await utils.callJSX(`FASTPASS.Clips.setInPoint(${trackIdx}, ${clipIdx}, ${newInPoint}, '${type}')`);
            
            // 2. Mover el clip al inicio de la línea de tiempo (segundo 0)
            await utils.callJSX(`FASTPASS.Clips.setStart(${trackIdx}, ${clipIdx}, 0, '${type}')`);

            return "OK_RIPPLE_TRIM_START";
        },

        /**
         * Neteja clips posteriors a un temps en múltiples pistes.
         */
        clearMultipleTracksAfter: async function(timeSec, videoTracks = [1], audioTracks = []) {
            let total = 0;
            for (let vt of videoTracks) {
                const res = await this.clearTrackAfter(vt, timeSec, "video");
                total += parseInt(res.replace("OK_REMOVED_", "") || 0);
            }
            for (let at of audioTracks) {
                const res = await this.clearTrackAfter(at, timeSec, "audio");
                total += parseInt(res.replace("OK_REMOVED_", "") || 0);
            }
            return total;
        },

        /**
         * Neteja clips posteriors a un temps donat en una pista específica.
         */
        clearTrackAfter: async function(trackIdx, timeSec, type) {
            const count = parseInt(await utils.callJSX(`jsx_getClipCount(${trackIdx}, '${type}')`));
            if (count === 0) return "EMPTY_TRACK";

            let removedCount = 0;
            for (let i = count - 1; i >= 0; i--) {
                const dataRaw = await utils.callJSX(`jsx_getClipDataByIndex(${trackIdx}, ${i}, '${type}')`);
                if (!dataRaw || dataRaw === "null") continue;
                
                const clip = JSON.parse(dataRaw);
                // Tolerància de 0.01 per a floats
                if (clip.start >= parseFloat(timeSec) - 0.01) {
                    await utils.callJSX(`jsx_removeClip(${trackIdx}, ${i}, '${type}')`);
                    removedCount++;
                }
            }
            return "OK_REMOVED_" + removedCount;
        }
    };

    window.FASTPASS_UI = FASTPASS_UI;
})();
