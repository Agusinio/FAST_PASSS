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
                console.log("DEBUG: progData:", progData);

                // Si progData es undefined, el token será "TNV" por defecto para que no rompa el JSX
                const shortToken = (progData && progData.wott) ? progData.wott : "TNV";
                console.log("DEBUG: shortToken:", shortToken);

                log(`🔍 Buscant seqüència per tokens: [${shortToken}] + [${elBloc}]`);
                // LLAMADA DIRECTA AL NUEVO BRIDGE
                const foundName = await callJSX(`Context.findSequence('${shortToken}', '${elBloc}')`);
                log(`🔍 [FLOW-CUT] foundName = "${foundName}"`);
                
                if (!foundName || foundName.indexOf("ERR:") !== -1) {
                    getUtils().status("⚠️ No trobo la seqüència!", "error");
                    return;
                }

                // Si la encuentra, actualizamos el estado y seguimos con el Ripple Trim
                window.FASTPASS_UI.State.activeSequenceName = foundName;
                log(`🔍 [FLOW-CUT] activeSequenceName asignado.`);
                // Validar que la secuencia activa coincide con la encontrada (y con los selectores)
                if (!(await getUtils().validateActiveSequence())) {
                    log(`⚠️ [FLOW-CUT] Validación de secuencia activa falló.`);
                    return;
                }

                const T_MP4 = config.tracks.video.mp4;
                log(`🔍 [FLOW-CUT] T_MP4: ${T_MP4}`);
                const ctiRaw = await callJSX('Timeline.get()');
                const val = parseFloat(ctiRaw || "0");

                const clip = await getClipsLogic().at(T_MP4, val, "video");
                log(`🔍 [FLOW-CUT] clip: ${clip ? JSON.stringify(clip) : 'null'}`);

                if (clip) {
                    log(`✂️ Aplicant Ripple Trim In a V${T_MP4} (Time: ${val}s)`);
                    await getClipsLogic().rippleIn(T_MP4, clip.index, val, clip);
                    await callJSX('Timeline.set(0)');
                    getUtils().status("IN: Tall OK", "exito");
                } else {
                    log(`⚠️ [FLOW-CUT] No hi ha clip al cabezal (track ${T_MP4}, time ${val})`);
                    getUtils().status("No hi ha clip al cabezal", "error");
                }
            } catch (e) { console.error('Error en runCutIn:', e); getUtils().handleError(e, "CutIn"); }
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
            const T_THEME = cfg.tracks.video.tema;
            const T_CHYRONS = cfg.tracks.video.chyrons;

            try {
                const ctiRaw = await callJSX('Timeline.get()');
                console.log('DEBUG ctiRaw:', ctiRaw);
                log(`🔍 [FLOW-CUT] ctiRaw: ${ctiRaw}`);
                const val = parseFloat(ctiRaw || "0");
                console.log('DEBUG val:', val);
                log(`🔍 [FLOW-CUT] val: ${val}`);

                // Recortar clip principal en V1 (track MP4)
                log(`🔍 [FLOW-CUT] Llamando rippleOut para track ${T_MP4} en tiempo ${val}`);
                const rippleResult = await getClipsLogic().rippleOut(T_MP4, val, 'video', false);
                log(`🔍 [FLOW-CUT] Resultado rippleOut: ${rippleResult}`);

                // Limpiar pistas de video secundarias (2-8) y audio (1-2)
                const videoTracks = [2, 3, 4, 5, 6, 7, 8];
                const audioTracks = [1, 2];
                log(`🔍 [FLOW-CUT] Limpiando pistas secundarias: video ${videoTracks}, audio ${audioTracks}`);
                const cleanupResult = await getClipsLogic().rippleAllOut(val, videoTracks, audioTracks, false);
                log(`🔍 [FLOW-CUT] Resultado cleanup: ${cleanupResult}`);

                const outPoint = (val - 0.04).toFixed(2);
                await callJSX(`Timeline.range(0.0, ${outPoint})`);

                /*if (state.masterTheme) {
                    await callJSX(`Clips.insert('${getUtils().escape(state.masterTheme.name)}', ${T_THEME}, 0.0, null, 'video')`);
                }
                const elCond = document.getElementById('conductor');
                if (elCond && elCond.value) {
                    await callJSX(`Clips.insert('${getUtils().escape(elCond.value)}', ${T_CHYRONS}, 0.0, null, 'video')`);
                }*/

                await callJSX('Timeline.set(0)');
                // await callJSX('Project.save()'); // Temporarily disabled due to JSX error
                getUtils().status("Peça Tancada OK", "exito");
            } catch (e) { getUtils().handleError(e, "CutOut"); }
        },

        runScene: async function () {
            const cfg = FASTPASS_UI.Config.get();
            const T_MP4 = cfg.tracks.video.mp4;
            log("🎬 Trossejant clip a V" + T_MP4 + "...");
            console.log('DEBUG runScene: called');

            if (!(await getUtils().validateActiveSequence())) return;
            log(`🔍 [FLOW-CUT] Validación de secuencia activa OK. Track V${T_MP4}`);

            log(`🔍 [FLOW-CUT] Llamando Clips.count para track V${T_MP4}`);
            const countStr = await callJSX(`Clips.count(${T_MP4})`);
            log(`🔍 [FLOW-CUT] Count result: ${countStr}`);
            const count = parseInt(countStr || 0);
            if (count === 0) {
                getUtils().status("⚠️ El track V" + T_MP4 + " está vacío", "error");
                return;
            }

            try {
                log(`🔍 [FLOW-CUT] Target track V${T_MP4}`);
                await callJSX(`Tracks.target(${T_MP4}, true, 'video')`);
                log(`🔍 [FLOW-CUT] Target OK. Llamando scenes...`);
                await callJSX(`Clips.scenes(${T_MP4})`);
                log(`🔍 [FLOW-CUT] Scenes OK. Guardant projecte...`);
                await callJSX('Project.save()');
                getUtils().status("Trossejat i Projecte guardat", "exito");
            } catch (e) { getUtils().handleError(e, "Troseja"); }
        },

        runPrevClip: async function () {
            const cfg = FASTPASS_UI.Config.get();
            const T_MP4 = cfg.tracks.video.mp4;
            console.log('DEBUG runPrevClip: called');
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
            console.log('DEBUG runNextClip: called');
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