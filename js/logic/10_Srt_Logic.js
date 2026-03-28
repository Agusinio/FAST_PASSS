/**
 * ============================================================================
 * LOGIC: SUB (Subtítols orquestrats i Neteja) - v2.5.4 literal
 * ============================================================================
 */

(function () {
    var FASTPASS_UI = window.FASTPASS_UI || {};
    FASTPASS_UI.Logic = FASTPASS_UI.Logic || {};

    const TYPE = "subtitle";

    FASTPASS_UI.Logic.Sub = {

        /**
         * selected: Obté els clips de subtítols marcats en el timeline.
         */
        selected: async function () {
            const res = [];
            const trackCount = parseInt(await window.Tracks.count(TYPE) || 0);

            for (let t = 1; t <= trackCount; t++) {
                const clips = await window.Tracks.clips(t, TYPE);
                for (let c of clips) {
                    if (c.selected) {
                        res.push({
                            trackIndex: t,
                            clipIndex: c.index,
                            start: c.start,
                            end: c.end,
                            name: c.name
                        });
                    }
                }
            }
            return res;
        },

        /**
         * cleanIn: Purga clips antics i realinea el primer subtítol al 0.4s (In).
         */
        cleanIn: async function (ctiSec) {
            const cfg = FASTPASS_UI.Config.get();
            const T_S1 = cfg.tracks.subtitle.s1;

            const clips = await window.Tracks.clips(T_S1, TYPE);
            const toMove = [];

            // 1. Eliminar o Marcar per moure
            for (let c of clips) {
                if (c.end <= ctiSec) {
                    await window.Clips.remove(T_S1, c.index, TYPE);
                } else {
                    toMove.push(c);
                }
            }

            // 2. Aplicar Offset d'alineació (In al 0.4s de seguretat)
            if (toMove.length > 0) {
                toMove.sort((a, b) => a.start - b.start);
                const firstStart = toMove[0].start;
                const offset = 0.4 - firstStart;

                for (let item of toMove) {
                    const newStart = Math.max(0, item.start + offset);
                    await window.Clips.start(T_S1, item.index, newStart, TYPE);
                }
            }
            return "OK_SUB_CLEAN_IN";
        },

        /**
         * cleanOut: Purga massiva de cues de rètols (Out).
         */
        cleanOut: async function (ctiSec) {
            const cfg = FASTPASS_UI.Config.get();
            const T_S1 = cfg.tracks.subtitle.s1;
            return await window.Clips.rippleOut(T_S1, ctiSec, TYPE);
        }
    };

    // Alias global literal window.Sub
    window.Sub = FASTPASS_UI.Logic.Sub;

    window.FASTPASS_UI = FASTPASS_UI;
})();
