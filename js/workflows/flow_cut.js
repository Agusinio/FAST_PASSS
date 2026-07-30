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
         * Ripple Trim In usant el cabezal (CTI) com a referència de tall.
         * Després del ripple:
         *   - El clip (vídeo + àudio) es recorta a l'altura del CTI
         *   - Tot es desplaça cap a l'esquerra solidàriament (definidors inclosos)
         *   - SOLO el delimitador IN de seqüència es mou a 00:00
         *   - OUT es desplaça cap a l'esquerra: newOut = oldOut - cutTime
         *   - Els marcadors es recol·loquen via get/clear/set existents
         */
        runCutIn: async function () {
            try {
                const config = FASTPASS_UI.Config.get();
                const elProg = document.getElementById('programa').value;
                const elBloc = document.getElementById('bloc').value;

                const progData = config.mapeoProgramas[elProg];
                const shortToken = (progData && progData.wott) ? progData.wott : "TNV";

                log(`🔍 Buscant seqüència per tokens: [${shortToken}] + [${elBloc}]`);
                const foundName = await callJSX(`Context.findSequence('${shortToken}', '${elBloc}')`);

                if (!foundName || foundName.indexOf("ERR:") !== -1) {
                    getUtils().status("⚠️ No trobo la seqüència!", "error");
                    return;
                }

                window.FASTPASS_UI.State.activeSequenceName = foundName;
                if (!(await getUtils().validateActiveSequence())) return;

                const T_MP4 = config.tracks.video.mp4;

                // ── 1. Cabezal (CTI) com a referència de tall ──
                const cutTime = parseFloat(await callJSX('Timeline.get()') || "0");
                if (cutTime <= 0.04) {
                    getUtils().status("CTI ja a zero o quasi", "warn");
                    return;
                }
                log(`📐 [FLOW-CUT] Punt de tall (CTI): ${cutTime.toFixed(2)}s`);

                const clip = await getClipsLogic().at(T_MP4, cutTime, "video");
                if (!clip) {
                    getUtils().status("No hi ha clip al punt de tall", "error");
                    return;
                }

                // ── 2. Capturar marcadors ABANS del ripple ──
                var markersBefore = [];
                try {
                    const raw = await callJSX('Markers.get()');
                    markersBefore = JSON.parse(raw || "[]");
                } catch (e) { log(`⚠️ No s'han pogut llegir marcadors: ${e.message}`); }

                // ── 3. Ripple trim: retalla el clip (vídeo + àudio) al CTI i ho desplaça tot a zero ──
                log(`✂️ Aplicant Ripple Trim In a V${T_MP4} (CTI: ${cutTime.toFixed(2)}s)`);
                await getClipsLogic().rippleIn(T_MP4, clip.index, cutTime, clip);

                // ── 4. Llegir el final real del clip DESPRÉS del ripple ──
                //    (evita dependre de seq.outPoint, que pot ser undefined)
                const clipAfterRaw = await callJSX(`Clips.get(${T_MP4}, 0, 'video')`);
                var clipEndAfter = 0.04;
                try {
                    const cd = JSON.parse(clipAfterRaw);
                    clipEndAfter = cd.end || 0.04;
                } catch (e) { log(`⚠️ No s'ha pogut llegir clip end: ${e.message}`); }

                // ── 5. SOLO moure seq IN a 0. OUT = final real del clip ──
                await callJSX('Timeline.in(0)');
                await callJSX(`Timeline.out(${clipEndAfter})`);
                log(`📍 Seq: IN=0 OUT=${clipEndAfter.toFixed(2)}s (del clip V${T_MP4})`);

                // ── 6. Recol·locar marcadors desplaçats (sense nou JSX) ──
                if (markersBefore.length > 0) {
                    await callJSX('Markers.clear()');
                    var kept = 0;
                    for (var i = 0; i < markersBefore.length; i++) {
                        var mk = markersBefore[i];
                        var newTime = mk.time - cutTime;
                        if (newTime >= 0) {
                            var nameParam = "'Linia Escaleta'";
                            if (mk.name && mk.name !== "Línia Escaleta" && mk.name !== "Linia Escaleta") {
                                nameParam = "'" + mk.name.replace(/'/g, "\\'") + "'";
                            }
                            var comment = (mk.comments || "").replace(/'/g, "\\'");
                            await callJSX("Markers.set(" + newTime + ", '" + comment + "', " + nameParam + ")");
                            kept++;
                        }
                    }
                    log(`📍 Marcadors: ${kept}/${markersBefore.length} recol·locats (shift -${cutTime.toFixed(2)}s)`);
                }

                // ── 7. CTI a 0 ──
                await callJSX('Timeline.set(0)');
                getUtils().status(`IN: Tall OK (-${cutTime.toFixed(1)}s)`, "exito");
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
                log(`🔍 [FLOW-CUT] Scenes OK. Bolcant clips V1...`);

                // ═══ VOLCAT DIAGNÒSTIC DE CLIPS V1 POST-TROSEJA ═══
                const v1Clips = await getClipsLogic().getTrackClips(T_MP4, "video");
                log(`📊 [V1·POST-TROSEJA] ${v1Clips.length} clips a V1:`);
                v1Clips.forEach((c, idx) => {
                    const dur = c.end - c.start;
                    const flags = [];
                    if (dur < 0.5) flags.push("FLASH");
                    if (dur > 30) flags.push("LLARG");
                    if (dur >= 0.5 && dur <= 2.0) flags.push("TALL·CURT");
                    log(`  V1[${String(idx).padStart(2, '0')}] start=${c.start.toFixed(2).padStart(7)}s end=${c.end.toFixed(2).padStart(7)}s dur=${dur.toFixed(2).padStart(6)}s ${flags.length > 0 ? '[' + flags.join(', ') + ']' : ''}`);
                });
                log(`📊 [V1·POST-TROSEJA] Fi del bolcat.`);
                // ═══════════════════════════════════════════════

                await callJSX('FASTPASS.Project.save()');
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