/**
 * ============================================================================
 * LOGIC: SUB (Subtítols orquestrats i Neteja) - v2.9.5 Tactical
 * ============================================================================
 */

(function () {
    var FASTPASS_UI = window.FASTPASS_UI || {};
    FASTPASS_UI.Logic.Sub = {

        /**
         * cleanIn: Purga clips segons text (si n'hi ha) o cabezal.
         */
        cleanIn: async function (ctiSec, searchText) {
            const cfg = FASTPASS_UI.Config.get();
            const T_S1 = cfg.tracks.subtitle.s1;
            const TYPE = "subtitle";

            const rawClips = await window.FASTPASS_UI.Utils.callJSX(`Tracks.clips(${T_S1}, '${TYPE}')`);
            const clips = JSON.parse(rawClips || "[]");
            if (clips.length === 0) return "SENSE_CLIPS";

            let targetIndex = -1;

            if (searchText) {
                // Busquem clip per text
                for (let c of clips) {
                    if (c.name.toLowerCase().includes(searchText.toLowerCase())) {
                        targetIndex = c.index;
                        break;
                    }
                }
            } else {
                // Busquem clip sota cabezal
                for (let c of clips) {
                    if (c.start <= ctiSec && c.end > ctiSec) {
                        targetIndex = c.index;
                        break;
                    }
                }
            }

            if (targetIndex === -1) return "NO_TARGET_FOUND";

            // Eliminar tot el que estigui ABANS del target
            let eliminated = 0;
            for (let c of clips) {
                if (c.index < targetIndex) {
                    await window.FASTPASS_UI.Utils.callJSX(`Clips.remove(${T_S1}, ${c.index}, '${TYPE}')`);
                    eliminated++;
                }
            }

            return "OK_CLEAN_IN_" + eliminated;
        },

        /**
         * cleanOut: Purga clips posteriors al target (per text o cabezal).
         */
        cleanOut: async function (ctiSec, searchText) {
            const cfg = FASTPASS_UI.Config.get();
            const T_S1 = cfg.tracks.subtitle.s1;
            const TYPE = "subtitle";

            const rawClips = await window.FASTPASS_UI.Utils.callJSX(`Tracks.clips(${T_S1}, '${TYPE}')`);
            const clips = JSON.parse(rawClips || "[]");
            if (clips.length === 0) return "SENSE_CLIPS";

            let targetIndex = -1;

            if (searchText) {
                for (let c of clips) {
                    if (c.name.toLowerCase().includes(searchText.toLowerCase())) {
                        targetIndex = c.index;
                        break;
                    }
                }
            } else {
                for (let c of clips) {
                    if (c.start <= ctiSec && c.end > ctiSec) {
                        targetIndex = c.index;
                        break;
                    }
                }
            }

            if (targetIndex === -1) return "NO_TARGET_FOUND";

            // Eliminar tot el que estigui DESPRÉS del target (ELIMINACIÓ SEGURA)
            let eliminated = 0;
            for (let c of clips) {
                if (c.index > targetIndex) {
                    await window.FASTPASS_UI.Utils.callJSX(`Clips.remove(${T_S1}, ${c.index}, '${TYPE}')`);
                    eliminated++;
                }
            }

            return "OK_CLEAN_OUT_" + eliminated;
        }
    };

    window.Sub = FASTPASS_UI.Logic.Sub;
})();
