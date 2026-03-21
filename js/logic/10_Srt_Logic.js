/**
 * ============================================================================
 * LOGIC: SRT (Subtítulos orquestados)
 * ============================================================================
 * Centraliza la lógica de manipulación de pistas de subtítulos usando puentes atómicos.
 */

(function() {
    var FASTPASS_UI = window.FASTPASS_UI || {};
    FASTPASS_UI.Logic = FASTPASS_UI.Logic || {};

    const TYPE = "subtitle";

    FASTPASS_UI.Logic.Srt = {
        
        /**
         * Obtiene todos los clips seleccionados en las pistas de subtítulos.
         */
        getSelectedClips: async function() {
            const utils = window.FASTPASS_UI.Utils;
            const res = [];
            const trackCount = parseInt(await utils.callJSX(`jsx_getTrackCount('${TYPE}')`));

            for (let t = 1; t <= trackCount; t++) {
                const clipCount = parseInt(await utils.callJSX(`jsx_getClipCount(${t}, '${TYPE}')`));
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
         * Limpieza SRT IN: Elimina clips previos y ajusta el offset del primero.
         */
        cleanIn: async function(ctiSec) {
            const clipsLogic = FASTPASS_UI.Logic.Clips;
            const utils = window.FASTPASS_UI.Utils;
            
            // 1. Limpiamos clips que terminan antes del CTI (Orquestado)
            await clipsLogic.clearTrackAfter(1, ctiSec, TYPE); // En este caso sería "clearBefore" si existiera
            // Re-utilizamos clearTrackAfter pero con lógica inversa si fuera necesario. 
            // PERO vamos a hacerlo manual aquí para seguir el flow específico:
            
            const count = parseInt(await utils.callJSX(`jsx_getClipCount(1, '${TYPE}')`));
            const toMove = [];
            
            for (let i = count - 1; i >= 0; i--) {
                const raw = await utils.callJSX(`jsx_getClipDataByIndex(1, i, '${TYPE}')`);
                const clip = JSON.parse(raw);
                if (clip.end <= ctiSec) {
                    await utils.callJSX(`jsx_removeClip(1, i, '${TYPE}')`);
                } else {
                    toMove.push({ index: i, start: clip.start });
                }
            }

            // 2. Aplicamos Offset al resto
            if (toMove.length > 0) {
                toMove.sort((a, b) => a.start - b.start);
                const firstStart = toMove[0].start;
                const offset = 0.4 - firstStart;

                for (let item of toMove) {
                    const newStart = Math.max(0, item.start + offset);
                    await utils.callJSX(`jsx_setClipStart(1, ${item.index}, ${newStart}, '${TYPE}')`);
                }
            }
            return "OK_SRT_CLEAN_IN";
        },

        /**
         * Limpieza SRT OUT: Elimina clips a partir del CTI.
         */
        cleanOut: async function(ctiSec) {
            return await FASTPASS_UI.Logic.Clips.clearTrackAfter(1, ctiSec, TYPE);
        }
    };

    window.FASTPASS_UI = FASTPASS_UI;
})();
