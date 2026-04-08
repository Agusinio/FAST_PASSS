/** flow_cut.js
 * ============================================================================
 * WORKFLOW: CUT - v2.6.0 literal
 * ============================================================================
 */

(function () {
    var FASTPASS_UI = window.FASTPASS_UI || {};
    FASTPASS_UI.Workflows = FASTPASS_UI.Workflows || {};

    const getUtils = () => window.FASTPASS_UI.Utils;
    const getClipsLogic = () => window.FASTPASS_UI.Logic.Clips;

    const log = (m) => getUtils().log(m, "DEBUG");
    const callJSX = (s) => getUtils().callJSX(s);

    FASTPASS_UI.Workflows.Cut = {

        /**
         * Realitza un Ripple Trim In al clip principal de Mp4.
         */
        runCutIn: async function () {
            try {
                const config = FASTPASS_UI.Config.get();
                const elProg = document.getElementById('programa').value; // Ej: "04_TN VESPRE"
                const elBloc = document.getElementById('bloc').value;

                // 📍 LOG DE CONTROL: Mira qué vale elProg en la consola
                console.log("DEBUG: Valor del select programa:", elProg);

                // Buscamos en el mapeo. Si no existe, usamos el State o un fallback.
                const progData = config.mapeoProgramas[elProg];

                // Si progData es undefined, el token será "TNV" por defecto para que no rompa el JSX
                const shortToken = (progData && progData.wott) ? progData.wott : "TNV"; 

                log(`🔍 Buscant seqüència per tokens: [${shortToken}] + [${elBloc}]`);
                // LLAMADA DIRECTA AL NUEVO BRIDGE
                const foundName = await callJSX(`Context.findSequence('${shortToken}', '${elBloc}')`);
                
                if (!foundName || foundName.indexOf("ERR:") !== -1) {
                    getUtils().status("⚠️ No trobo la seqüència!", "error");
                    return;
                }

                // Si la encuentra, actualizamos el estado y seguimos con el Ripple Trim
                window.FASTPASS_UI.State.activeSequenceName = foundName;
                if (!(await getUtils().validateActiveSequence())) return;

                const T_MP4 = config.tracks.video.mp4;
                const ctiRaw = await callJSX('Timeline.get()');
                const val = parseFloat(ctiRaw || "0");

                const clip = await getClipsLogic().findAtTime(T_MP4, val, "video");

                if (clip) {
                    log(`✂️ Aplicant Ripple Trim In a V${T_MP4} (Time: ${val}s)`);
                    await getClipsLogic().rippleTrimStart(T_MP4, clip.index, val, clip);
                    await callJSX('Timeline.set(0)');
                    getUtils().status("IN: Tall OK", "exito");
                } else {
                    getUtils().status("No hi ha clip al cabezal", "error");
                }
            } catch (e) { getUtils().handleError(e, "CutIn"); }
        },

        /**
         * Workflow de tancament (CUT OUT).
         */
        runCutOut: async function () {
            if (!(await getUtils().validateActiveSequence())) return;
            log("🎬 Tancament (CUT OUT) - Neteja de cues i tancament...");

            const cfg = FASTPASS_UI.Config.get();
            const state = FASTPASS_UI.State;
            const T_MP4 = cfg.tracks.video.mp4;
            const T_THEME = cfg.tracks.video.tematitol;
            const T_CHYRONS = cfg.tracks.video.chyrons;

            try {
                const ctiRaw = await callJSX('Timeline.get()');
                const val = parseFloat(ctiRaw || "0");

                await getClipsLogic().clearMultipleTracksAfter(val, [1, 2, 3, 4, 5, 6], [T_MP4], true);

                const outPoint = (val - 0.04).toFixed(2);
                await callJSX(`Timeline.range(0.0, ${outPoint})`);

                if (state.masterTheme) {
                    await callJSX(`Clips.insert('${getUtils().escape(state.masterTheme.name)}', ${T_THEME}, 0.0, null, 'video')`);
                }
                const elCond = document.getElementById('conductor');
                if (elCond && elCond.value) {
                    await callJSX(`Clips.insert('${getUtils().escape(elCond.value)}', ${T_CHYRONS}, 0.0, null, 'video')`);
                }

                await callJSX('Timeline.set(0)');
                await callJSX('Project.save()');
                getUtils().status("Peça Tancada OK", "exito");
            } catch (e) { getUtils().handleError(e, "CutOut"); }
        },

        runScene: async function () {
            const cfg = FASTPASS_UI.Config.get();
            const T_MP4 = cfg.tracks.video.mp4;
            log("🎬 Trossejant clip a V" + T_MP4 + "...");

            try {
                await callJSX(`Tracks.target(${T_MP4}, true, 'video')`);
                await callJSX(`Clips.scenes(${T_MP4})`);
                await FASTPASS_UI.Workflows.Assembly.runAutoPlacement(T_MP4);
                getUtils().status("Trossejat i Muntatge OK", "exito");
            } catch (e) { getUtils().handleError(e, "Troseja"); }
        },

        runPrevClip: async function () {
            const cfg = FASTPASS_UI.Config.get();
            const T_MP4 = cfg.tracks.video.mp4;
            try {
                const ctiRaw = await callJSX('Timeline.get()');
                const cti = parseFloat(ctiRaw || "0");
                const count = parseInt(await callJSX(`Clips.count(${T_MP4}, 'video')`));
                for (let i = count - 1; i >= 0; i--) {
                    const raw = await callJSX(`Clips.get(${T_MP4}, ${i}, 'video')`);
                    const clip = JSON.parse(raw || "{}");
                    if (clip.end <= cti - 0.05) {
                        const mid = (clip.start + clip.end) / 2;
                        await callJSX(`Timeline.set(${mid})`);
                        if (window.FASTPASS_UI.Sync && window.FASTPASS_UI.Sync.updateSliderFromPremiere) {
                            setTimeout(() => window.FASTPASS_UI.Sync.updateSliderFromPremiere(), 100);
                        }
                        return;
                    }
                }
            } catch (e) { getUtils().handleError(e, "NavPrev"); }
        },

        runNextClip: async function () {
            const cfg = FASTPASS_UI.Config.get();
            const T_MP4 = cfg.tracks.video.mp4;
            try {
                const ctiRaw = await callJSX('Timeline.get()');
                const cti = parseFloat(ctiRaw || "0");
                const count = parseInt(await callJSX(`Clips.count(${T_MP4}, 'video')`));
                for (let i = 0; i < count; i++) {
                    const raw = await callJSX(`Clips.get(${T_MP4}, ${i}, 'video')`);
                    const clip = JSON.parse(raw || "{}");
                    if (clip.start >= cti + 0.05) {
                        const mid = (clip.start + clip.end) / 2;
                        await callJSX(`Timeline.set(${mid})`);
                        if (window.FASTPASS_UI.Sync && window.FASTPASS_UI.Sync.updateSliderFromPremiere) {
                            setTimeout(() => window.FASTPASS_UI.Sync.updateSliderFromPremiere(), 100);
                        }
                        return;
                    }
                }
            } catch (e) { getUtils().handleError(e, "NavNext"); }
        }
    };

    window.FASTPASS_UI.Workflows.Cut = FASTPASS_UI.Workflows.Cut;
})();