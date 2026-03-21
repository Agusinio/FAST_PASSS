/**
 * ============================================================================
 * WORKFLOW: SRT (SUBTÍTOLS) (v11 - VERSIÓ ULTRA-LIPO)
 * ============================================================================
 */

(function () {
    var FASTPASS_UI = window.FASTPASS_UI || {};
    FASTPASS_UI.Workflows = FASTPASS_UI.Workflows || {};

    const utils = window.FASTPASS_UI.Utils;
    const srtLogic = window.FASTPASS_UI.Logic.Srt;
    const tracksLogic = window.FASTPASS_UI.Logic.Tracks;
    const log = (m) => utils.log(m, "DEBUG");
    const callJSX = (s) => utils.callJSX(s);

    FASTPASS_UI.Workflows.Srt = {

        /**
         * Activa/Desactiva el mode de treball de subtítols (bloqueja pistes de vídeo).
         */
        toggleSrtWork: async function (force) {
            log("📝 SRT: Canviant mode de treball.");
            
            const state = FASTPASS_UI.State;
            state.srtWorkMode = !state.srtWorkMode;

            const btn = document.getElementById('btnSrtWork'); // Corregit ID segons index.html
            const btnIn = document.getElementById('btnSrtIn');
            const btnOut = document.getElementById('btnSrtOut');

            if (state.srtWorkMode) {
                if (btn) { btn.textContent = "TANCAR"; btn.classList.add('btn-active'); }
                if (btnIn) btnIn.disabled = false;
                if (btnOut) btnOut.disabled = false;
                // Bloqueig de seguretat de totes les pistes de vídeo (V1-V7)
                await tracksLogic.setGlobalState("video", "lock", true);
            } else {
                if (btn) { btn.textContent = "PREPARAR"; btn.classList.remove('btn-active'); }
                if (btnIn) btnIn.disabled = true;
                if (btnOut) btnOut.disabled = true;
                // Desbloqueig de vídeo per tornar a l'edició normal
                await tracksLogic.setGlobalState("video", "lock", false);
            }
        },

        runSrtIn: async function () {
            log("📝 SRT: Marcar IN");
            try {
                const ctiRaw = await callJSX('jsx_getCTI()');
                const cti = parseFloat(ctiRaw || "0");

                // Regla de negoci: El primer subtítol mai pot començar abans dels 0.4s (Frame 10)
                const clipCountRaw = await callJSX('jsx_getClipCount(1, "subtitle")'); 
                let finalCti = cti;
                if (parseInt(clipCountRaw || "0") === 0 && cti < 0.4) {
                    finalCti = 0.4;
                    log("📍 Inici de seqüència: Ajustant primer subtítol a 0.4s per protocol.");
                }

                // Deleguem la neteja i trimm a la lògica especialitzada
                await srtLogic.cleanIn(finalCti);
            } catch (e) { utils.handleError(e, "SrtIn"); }
        },

        runSrtOut: async function () {
            log("📝 SRT: Marcar OUT");
            try {
                const ctiRaw = await callJSX('jsx_getCTI()');
                await srtLogic.cleanOut(parseFloat(ctiRaw || "0"));
            } catch (e) { utils.handleError(e, "SrtOut"); }
        },

        /**
         * Re-ajust temporal de tot el bloc de subtítols seleccionat (Acordió).
         */
        runTimeAdjust: async function () {
            log("⏳ Iniciant ajust proporcional de subtítols...");
            try {
                // Obtenim les dades dels subtítols seleccionats des de JS via bridge atòmic
                const jsonClips = await callJSX('jsx_getSelectedSubtitleClips()');
                const clips = JSON.parse(jsonClips || "[]");

                if (!clips || clips.length === 0) {
                    throw new Error("Selecciona els subtítols (clips) que vols ajustar al timeline.");
                }

                // Ordenem per temps d'inici per garantir la linealitat
                clips.sort((a, b) => a.start - b.start);

                const firstIn = clips[0].start;
                const lastOut = clips[clips.length - 1].end;
                const currentDur = lastOut - firstIn;

                // Determinació del límit (CTI o següent clip)
                const ctiRaw = await callJSX('jsx_getCTI()');
                const cti = parseFloat(ctiRaw || "0");
                
                if (cti <= firstIn) throw new Error("Col·loca el cabezal on vulguis que acabi el bloc.");

                const durIdeal = cti - firstIn;
                const ratio = durIdeal / currentDur;
                const padding = 0.04; // 1 frame de separació entre rètols
                
                let cursor = firstIn;

                log(`📏 Aplicant ratio de compressió: ${ratio.toFixed(3)}`);
                
                // Orquestració de moviments atòmics des de JS
                for (let i = 0; i < clips.length; i++) {
                    const c = clips[i];
                    const newDur = (c.end - c.start) * ratio;
                    const newStart = cursor;
                    const newEnd = newStart + newDur;

                    await callJSX(`jsx_setClipStart(${c.trackIndex}, ${c.clipIndex}, ${newStart}, 'subtitle')`);
                    await callJSX(`jsx_setClipEnd(${c.trackIndex}, ${c.clipIndex}, ${newEnd}, 'subtitle')`);
                    
                    cursor = newEnd + padding;
                }

                utils.status(`Ajustat ${clips.length} rètols.`, "exito");

            } catch (e) { utils.handleError(e, "SrtTimeAdjust"); }
        }
    };

    window.FASTPASS_UI = FASTPASS_UI;
})();