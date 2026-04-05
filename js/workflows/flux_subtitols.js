/**
 * ============================================================================
 * flux_subtitols.js (Workflow de Subtítols SRT)
 * ============================================================================
 */

(function () {
    var FASTPASS_UI = window.FASTPASS_UI || {};
    FASTPASS_UI.Workflows = FASTPASS_UI.Workflows || {};

    const getEines = () => window.FASTPASS_UI.Eines;
    const getSrtLogic = () => window.FASTPASS_UI.Logic.Sub;
    const getTracksLogic = () => window.FASTPASS_UI.Logic.Pistes;

    const log = (m) => getEines().log(m, "DEBUG");
    const callJSX = (s) => getEines().callJSX(s);

    FASTPASS_UI.Workflows.Srt = {

        /**
         * toggleSrtWork: Protecció de pistes, Importació a S1 i Selecció Automàtica
         */
        toggleSrtWork: async function (force) {
            log("📝 SRT: Preparant entorn de treball táctique...");
            const state = FASTPASS_UI.State;
            state.srtWorkMode = !state.srtWorkMode;

            const btn = document.getElementById('btnSrtWork');
            const btnIn = document.getElementById('btnSrtIn');
            const btnOut = document.getElementById('btnSrtOut');

            if (state.srtWorkMode) {
                if (btn) { btn.textContent = "TANCAR"; btn.classList.add('btn-active'); }
                if (btnIn) btnIn.disabled = false;
                if (btnOut) btnOut.disabled = false;
                
                // BLOQUEIG DE TOTS ELS TRACKS (Video + Audio)
                log("🔒 Bloquejant pistes de seguretat...");
                await callJSX(`Pistes.setGlobalState('video', 'lock', true)`);
                await callJSX(`Pistes.setGlobalState('audio', 'lock', true)`);

                // SELECCIONAR ARREMPERAT (Herramienta V)
                log("🖱️ Canviant a eina de SELECCIÓ (V)...");
                await callJSX(`Sistema.tool('Selection')`);

                getEines().status("SRT MODE ON", "exito");
            } else {
                if (btn) { btn.textContent = "PREPARAR"; btn.classList.remove('btn-active'); }
                if (btnIn) btnIn.disabled = true;
                if (btnOut) btnOut.disabled = true;
                
                // DESBLOQUEIG TOTAL
                await callJSX(`Pistes.setGlobalState('video', 'lock', false)`);
                await callJSX(`Pistes.setGlobalState('audio', 'lock', false)`);
                
                getEines().status("SRT MODE OFF", "warn");
            }
        },

        /**
         * runSrtIn: Neteja d'inici (Text + Cabezal)
         */
        runSrtIn: async function () {
            log("📝 SRT: Marcar IN (Neteja intel·ligent)");
            try {
                const ctiRaw = await callJSX('Cronologia.get()');
                const textIn = document.getElementById('txt-srt-in').value || "";

                const res = await getSrtLogic().cleanIn(parseFloat(ctiRaw || "0"), textIn);
                
                if (res.indexOf("OK") !== -1) {
                    getEines().status("Inici NETEJAT", "exito");
                }
            } catch (e) { getEines().handleError(e, "SrtIn"); }
        },

        /**
         * runSrtOut: Neteja de cua (Text + Cabezal)
         */
        runSrtOut: async function () {
            log("📝 SRT: Marcar OUT (Neteja intel·ligent)");
            try {
                const ctiRaw = await callJSX('Cronologia.get()');
                const textOut = document.getElementById('txt-srt-out').value || "";

                const res = await getSrtLogic().cleanOut(parseFloat(ctiRaw || "0"), textOut);
                
                if (res.indexOf("OK") !== -1) {
                    getEines().status("Cua NETEJADA", "exito");
                }
            } catch (e) { getEines().handleError(e, "SrtOut"); }
        },

        /**
         * runTimeAdjust: Acordió proporcional d'ajust
         */
        runTimeAdjust: async function () {
            log("⏳ Iniciant ajust proporcional de subtítols...");
            try {
                // Seleccionats literalment
                const jsonClips = await callJSX('Segments.getSubtitles()');
                const clips = JSON.parse(jsonClips || "[]");

                if (!clips || clips.length === 0) {
                    throw new Error("Selecciona els subtítols que vols ajustar al Timeline.");
                }

                clips.sort((a, b) => a.start - b.start);
                const firstIn = clips[0].start;
                const lastOut = clips[clips.length - 1].end;
                const currentDur = lastOut - firstIn;
                const ctiRaw = await callJSX('Cronologia.get()');
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

                    await callJSX(`Segments.start(${c.trackIndex + 1}, ${c.clipIndex}, ${newStart}, 'subtitle')`);
                    await callJSX(`Segments.end(${c.trackIndex + 1}, ${c.clipIndex}, ${newEnd}, 'subtitle')`);
                    cursor = newEnd + padding;
                }

                getEines().status(`Ajustat ${clips.length} rètols.`, "exito");
            } catch (e) { getEines().handleError(e, "SrtTimeAdjust"); }
        }
    };

    window.FASTPASS_UI.Workflows.Srt = FASTPASS_UI.Workflows.Srt;
})();