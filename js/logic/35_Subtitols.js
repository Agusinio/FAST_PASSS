/**
 * ============================================================================
 * 35_Subtitols.js (Gestió de Subtítols)
 * ============================================================================
 */

(function () {
    var FASTPASS_UI = window.FASTPASS_UI || {};
    FASTPASS_UI.Logic = FASTPASS_UI.Logic || {};  // BUG FIX #2: Namespace guard

    FASTPASS_UI.Logic.Sub = {

        /**
         * cleanIn: Purga clips ANTERIORS al target (per text o cabezal).
         */
        cleanIn: async function (ctiSec, searchText) {
            const cfg = FASTPASS_UI.Config.get();
            const T_S1 = cfg.tracks.subtitle.s1;

            // BUG FIX #4: Usar Logic.Tracks.clips() (JS module), no una crida JSX literal
            const clips = await window.FASTPASS_UI.Logic.Tracks.clips(T_S1, "subtitle");
            if (!clips || clips.length === 0) return "SENSE_CLIPS";

            let targetIndex = -1;

            if (searchText && searchText.trim() !== "") {
                // Cerca per text
                for (let c of clips) {
                    if (c.name && c.name.toLowerCase().includes(searchText.toLowerCase())) {
                        targetIndex = c.index;
                        break;
                    }
                }
            } else {
                // Cerca per cabezal
                for (let c of clips) {
                    if (c.start <= ctiSec && c.end > ctiSec) {
                        targetIndex = c.index;
                        break;
                    }
                }
            }

            if (targetIndex === -1) return "NO_TARGET_FOUND";

            // BUG FIX #3: Ordre INVERS per evitar desplaçament d'índexos al borrar
            const toDelete = clips.filter(c => c.index < targetIndex)
                                  .sort((a, b) => b.index - a.index);

            for (let c of toDelete) {
                await window.FASTPASS_UI.Eines.callJSX(`Segments.remove(${T_S1}, ${c.index}, 'subtitle')`);
            }

            return "OK_CLEAN_IN_" + toDelete.length;
        },

        /**
         * cleanOut: Purga clips POSTERIORS al target (per text o cabezal).
         */
        cleanOut: async function (ctiSec, searchText) {
            const cfg = FASTPASS_UI.Config.get();
            const T_S1 = cfg.tracks.subtitle.s1;

            // BUG FIX #4: Usar Logic.Tracks.clips() (JS module)
            const clips = await window.FASTPASS_UI.Logic.Tracks.clips(T_S1, "subtitle");
            if (!clips || clips.length === 0) return "SENSE_CLIPS";

            let targetIndex = -1;

            if (searchText && searchText.trim() !== "") {
                for (let c of clips) {
                    if (c.name && c.name.toLowerCase().includes(searchText.toLowerCase())) {
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

            // BUG FIX #3: Ordre INVERS per evitar desplaçament d'índexos
            const toDelete = clips.filter(c => c.index > targetIndex)
                                  .sort((a, b) => b.index - a.index);

            for (let c of toDelete) {
                await window.FASTPASS_UI.Eines.callJSX(`Segments.remove(${T_S1}, ${c.index}, 'subtitle')`);
            }

            return "OK_CLEAN_OUT_" + toDelete.length;
        }
    };

    window.Sub = FASTPASS_UI.Logic.Sub;
    window.FASTPASS_UI = FASTPASS_UI;
})();
