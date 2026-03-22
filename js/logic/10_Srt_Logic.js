/**
 * ============================================================================
 * LOGIC: SRT (Subtítols orquestrats) (v12 - VARIABLES GLOBALS)
 * ============================================================================
 * Centralitza la lògica de manipulació de pistes de subtítols.
 */

(function() {
    var FASTPASS_UI = window.FASTPASS_UI || {};
    FASTPASS_UI.Logic = FASTPASS_UI.Logic || {};

    const TYPE = "subtitle";

    FASTPASS_UI.Logic.Srt = {
        
        /**
         * Obté tots els clips seleccionats a les pistes de subtítols de forma dinàmica.
         */
        getSelectedClips: async function() {
            const utils = window.FASTPASS_UI.Utils;
            const res = [];
            
            // Obtenim quantes pistes de subtítols hi ha realment al timeline
            const trackCountRaw = await utils.callJSX(`jsx_getTrackCount('${TYPE}')`);
            const trackCount = parseInt(trackCountRaw || "0");

            for (let t = 1; t <= trackCount; t++) {
                const clipCountRaw = await utils.callJSX(`jsx_getClipCount(${t}, '${TYPE}')`);
                const clipCount = parseInt(clipCountRaw || "0");
                
                for (let c = 0; c < clipCount; c++) {
                    const dataRaw = await utils.callJSX(`jsx_getClipDataByIndex(${t}, ${c}, '${TYPE}')`);
                    if (dataRaw) {
                        const clip = JSON.parse(dataRaw);
                        if (clip.selected) {
                            res.push({
                                trackIndex: t,
                                clipIndex: c,
                                start: clip.start,
                                end: clip.end,
                                name: clip.name
                            });
                        }
                    }
                }
            }
            return res;
        },

        /**
         * Neteja SRT IN: Elimina clips previs i aplica offset per alineeació.
         */
        cleanIn: async function(ctiSec) {
            const cfg = window.FASTPASS_UI.Config.get();
            const utils = window.FASTPASS_UI.Utils;
            const T_S1 = cfg.tracks.subtitle.s1; // Pista 1 de SRT segons mapa
            
            const countRaw = await utils.callJSX(`jsx_getClipCount(${T_S1}, '${TYPE}')`);
            const count = parseInt(countRaw || "0");
            const toMove = [];
            
            for (let i = count - 1; i >= 0; i--) {
                const raw = await utils.callJSX(`jsx_getClipDataByIndex(${T_S1}, ${i}, '${TYPE}')`);
                const clip = JSON.parse(raw || "{}");
                
                if (clip.end <= ctiSec) {
                    await utils.callJSX(`jsx_removeClip(${T_S1}, ${i}, '${TYPE}')`);
                } else {
                    toMove.push({ index: i, start: clip.start });
                }
            }

            // Aplicació d'offset proporcional si n'han quedat
            if (toMove.length > 0) {
                toMove.sort((a, b) => a.start - b.start);
                const firstStart = toMove[0].start;
                const offset = 0.4 - firstStart;

                for (let item of toMove) {
                    const newStart = Math.max(0, item.start + offset);
                    await utils.callJSX(`jsx_setClipStart(${T_S1}, ${item.index}, ${newStart}, '${TYPE}')`);
                }
            }
            return "OK_SRT_CLEAN_IN";
        },

        /**
         * Neteja SRT OUT: Elimina clips a partir del CTI a la pista principal.
         */
        cleanOut: async function(ctiSec) {
            const cfg = window.FASTPASS_UI.Config.get();
            const T_S1 = cfg.tracks.subtitle.s1;
            return await FASTPASS_UI.Logic.Clips.clearTrackAfter(T_S1, ctiSec, TYPE);
        }
    };

    window.FASTPASS_UI = FASTPASS_UI;
})();
