/**
 * ============================================================================
 * WORKFLOW: SRT (SUBTÍTOLS) (v12 - VERSIÓ VARIABLES GLOBALS)
 * ============================================================================
 */

(function () {
    var FASTPASS_UI = window.FASTPASS_UI || {};
    FASTPASS_UI.Workflows = FASTPASS_UI.Workflows || {};

    const getUtils = () => window.FASTPASS_UI.Utils;
    const getSrtLogic = () => window.FASTPASS_UI.Logic.Srt;
    const getTracksLogic = () => window.FASTPASS_UI.Logic.Tracks;

    const log = (m) => getUtils().log(m, "DEBUG");
    const callJSX = (s) => getUtils().callJSX(s);

    FASTPASS_UI.Workflows.Srt = {

        /**
         * Activa/Desactiva el mode de treball de subtítols.
         */
        toggleSrtWork: async function (force) {
            log("📝 SRT: Canviant mode de treball.");
            const state = FASTPASS_UI.State;
            state.srtWorkMode = !state.srtWorkMode;

            const btn = document.getElementById('btnSrtWork');
            const btnIn = document.getElementById('btnSrtIn');
            const btnOut = document.getElementById('btnSrtOut');

            if (state.srtWorkMode) {
                if (btn) { btn.textContent = "TANCAR"; btn.classList.add('btn-active'); }
                if (btnIn) btnIn.disabled = false;
                if (btnOut) btnOut.disabled = false;
                // Bloqueig de seguretat de totes les pistes de vídeo (V1-V7)
                await getTracksLogic().setGlobalState("video", "lock", true);
            } else {
                if (btn) { btn.textContent = "PREPARAR"; btn.classList.remove('btn-active'); }
                if (btnIn) btnIn.disabled = true;
                if (btnOut) btnOut.disabled = true;
                await getTracksLogic().setGlobalState("video", "lock", false);
            }
        },

        runSrtIn: async function () {
            log("📝 SRT: Marcar IN");
            const cfg = FASTPASS_UI.Config.get();
            const T_S1 = cfg.tracks.subtitle.s1;

            try {
                const ctiRaw = await callJSX('jsx_getCTI()');
                const cti = parseFloat(ctiRaw || "0");

                // Protocol: Inici mínim a 0.4s si és el primer clip
                const clipCountRaw = await callJSX(`jsx_getClipCount(${T_S1}, "subtitle")`); 
                let finalCti = cti;
                if (parseInt(clipCountRaw || "0") === 0 && cti < 0.4) {
                    finalCti = 0.4;
                    log("📍 Inici de seqüència: Ajustant primer subtítol a 0.4s.");
                }

                await getSrtLogic().cleanIn(finalCti);
            } catch (e) { getUtils().handleError(e, "SrtIn"); }
        },

        runSrtOut: async function () {
            log("📝 SRT: Marcar OUT");
            try {
                const ctiRaw = await callJSX('jsx_getCTI()');
                await getSrtLogic().cleanOut(parseFloat(ctiRaw || "0"));
            } catch (e) { getUtils().handleError(e, "SrtOut"); }
        },

        /**
         * Re-ajust temporal (Acordió).
         */
        runTimeAdjust: async function () {
            log("⏳ Iniciant ajust proporcional de subtítols...");
            try {
                const jsonClips = await callJSX('jsx_getSelectedSubtitleClips()');
                const clips = JSON.parse(jsonClips || "[]");

                if (!clips || clips.length === 0) {
                    throw new Error("Selecciona els subtítols que vols ajustar.");
                }

                clips.sort((a, b) => a.start - b.start);

                const firstIn = clips[0].start;
                const lastOut = clips[clips.length - 1].end;
                const currentDur = lastOut - firstIn;
                const ctiRaw = await callJSX('jsx_getCTI()');
                const cti = parseFloat(ctiRaw || "0");
                
                if (cti <= firstIn) throw new Error("Col·loca el cabezal on vulguis que acabi el bloc.");

                const durIdeal = cti - firstIn;
                const ratio = durIdeal / currentDur;
                const padding = 0.04; 
                
                let cursor = firstIn;

                for (let i = 0; i < clips.length; i++) {
                    const c = clips[i];
                    const newDur = (c.end - c.start) * ratio;
                    const newStart = cursor;
                    const newEnd = newStart + newDur;

                    await callJSX(`jsx_setClipStart(${c.trackIndex + 1}, ${c.clipIndex}, ${newStart}, 'subtitle')`);
                    await callJSX(`jsx_setClipEnd(${c.trackIndex + 1}, ${c.clipIndex}, ${newEnd}, 'subtitle')`);
                    
                    cursor = newEnd + padding;
                }

                getUtils().status(`Ajustat ${clips.length} rètols.`, "exito");
            } catch (e) { getUtils().handleError(e, "SrtTimeAdjust"); }
        }
    };

    window.FASTPASS_UI = FASTPASS_UI;
})();