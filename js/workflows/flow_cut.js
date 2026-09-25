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
         * Abans del ripple:
         *   - Es calcula quants frames es recorten al clip: diff = cutTime - clip.start
         *   - El corchete OUT es mou els mateixos frames cap a l'esquerra (ANTES de tallar,
         *     sino Premiere el col·loca al final del clip ja retallat)
         * Després del ripple:
         *   - El clip (vídeo + àudio) es recorta a l'altura del CTI i es desplaça a zero
         *   - SOLO el delimitador IN de seqüència es mou a 00:00
         *   - OUT es re-aplica: newOut = oldOut - diff
         *   - Els marcadors es recol·loquen via get/clear/set existents
         */
        runCutIn: async function (ev) {
            try {
                // (2026-09-25) Ctrl+clic = forçar (per si l'operador vol tallar molta capçalera a posta)
                const force = !!(ev && (ev.ctrlKey || ev.metaKey));
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
                const _tIN = Date.now();

                const clip = await getClipsLogic().at(T_MP4, cutTime, "video");
                if (!clip) {
                    getUtils().status("No hi ha clip al punt de tall", "error");
                    return;
                }

                // ═══ (2026-09-25) GUARDA ANTI-DESASTRE ═══════════════════════════════════
                // Aquest workflow retalla la CAPÇALERA del bloc fins al CTI. Si el cabezal no
                // és on l'operador creu, es menjava el bloc en SILENCI: TNC V2 2026-09-25 amb
                // CTI=113.52s → inPoint 10s→123.52s i el material de 254s→120.92s, deixant tots
                // els marcadors OnAir fora de lloc (04 a 125.00s amb material fins a 120.92s).
                // Ara: si el retall de capçalera és gran, S'AVISA i NO es retalla (Ctrl = forçar).
                const _inPtAbans = (clip && isFinite(Number(clip.inPoint))) ? Number(clip.inPoint) : null;
                const MAX_HEAD_TRIM_SEC = 30;
                const _headTrim = cutTime - (clip.start || 0);
                if (_headTrim > MAX_HEAD_TRIM_SEC) {
                    // (2026-09-25b) AVÍS, NO BLOCATGE: l'operador mana. Es registra ben fort
                    // quanta capçalera es retalla i es deixa fer (abans es cancel·lava i el botó
                    // IN semblava espatllat ✗).
                    log('⚠️ [IN·AVÍS] Es retallaran ' + _headTrim.toFixed(2) + 's de capçalera del bloc (inPoint ' + (_inPtAbans !== null ? _inPtAbans.toFixed(2) : '?') + 's). Comprova que el cabezal és on vols: si no, desfés (Ctrl+Z) i mou-lo.', 'WARN');
                    getUtils().status('⚠️ IN: retalla ' + _headTrim.toFixed(0) + 's de capçalera', 'warn');
                }
                log('✂️ [IN·CHECK] inPoint abans=' + (_inPtAbans !== null ? _inPtAbans.toFixed(2) : '?') + 's · es retallaran ' + _headTrim.toFixed(2) + 's de capçalera del bloc');

                // ── 2. Capturar marcadors ABANS del ripple ──
                var markersBefore = [];
                try {
                    const raw = await callJSX('Markers.get()');
                    markersBefore = JSON.parse(raw || "[]");
                } catch (e) { log(`⚠️ No s'han pogut llegir marcadors: ${e.message}`); }

                // ── 2b. Capturar l'OUT de seqüència ABANS del ripple ──
                var oldOut = 0;
                try {
                    const rawOut = await callJSX('Timeline.getOut()');
                    oldOut = parseFloat(rawOut) || 0;
                } catch (e) { log(`⚠️ No s'ha pogut llegir el OUT de seqüència: ${e.message}`); }
                // Frames recortats al clip = CTI - start del clip
                var diff = cutTime - (clip.start || 0);
                // Referència del final del contingut: OUT definit, o final del clip que es recorta
                var refOut = (oldOut > 0.04) ? oldOut : ((clip && clip.end) || 0);
                // El corchete es mou els mateixos frames recortats cap a l'esquerra (solidari)
                var newOut = Math.max(0.04, refOut - diff);
                log(`📍 [IN] oldOut=${oldOut.toFixed(3)}s diff=${diff.toFixed(3)}s refOut=${refOut.toFixed(3)}s → newOut=${newOut.toFixed(3)}s`);

                // ── 2c. Moure el corchete OUT (i IN) ANTES de tallar ──
                //    range(0,newOut) = setInPoint(0) + setOutPoint(newOut) en una sola crida
                var rPre = await callJSX(`Timeline.range(0, ${newOut.toFixed(3)})`);
                var preOut = await callJSX('Timeline.getOut()');
                log(`📍 [IN·PRE] range(0, ${newOut.toFixed(3)}) → ${rPre} | getOut()=${preOut}`);

                // ── 3. Ripple trim: retalla el clip (vídeo + àudio) al CTI i ho desplaça tot a zero ──
                log(`✂️ Aplicant Ripple Trim In a V${T_MP4} (CTI: ${cutTime.toFixed(2)}s)`);
                // (2026-09-25) CRONÒMETRES: el ripple fa 6 crides al pont (inPoint+start+end de
                // vídeo i d'àudio) i Premiere re-sincronitza el clip enllaçat → aquí es veurà
                // on es van els segons (queixa d'usuari: "per què triga tant a aplicar l'IN?").
                var _tRip = Date.now();
                var _tPre = _tRip - _tIN;
                await getClipsLogic().rippleIn(T_MP4, clip.index, cutTime, clip);
                log(`⏱️ [IN·TIME] context previ=${_tPre}ms · rippleIn=${(Date.now() - _tRip)}ms`);

                // ── 5. Re-aplicar OUT DESPRÉS del tall (Premiere pot re-anclar-lo al final del clip) ──
                var rPost = await callJSX(`Timeline.range(0, ${newOut.toFixed(3)})`);
                var postOut = await callJSX('Timeline.getOut()');
                log(`📍 [IN·POST] range(0, ${newOut.toFixed(3)}) → ${rPost} | getOut()=${postOut}`);
                if (Math.abs(parseFloat(postOut) - newOut) > 0.05) {
                    log(`⚠️ [IN] OUT real (${postOut}) ≠ newOut (${newOut.toFixed(3)}). Reintent directe...`);
                    await callJSX(`Timeline.out(${newOut.toFixed(3)})`);
                    postOut = await callJSX('Timeline.getOut()');
                    log(`📍 [IN·RETRY] Timeline.out(${newOut.toFixed(3)}) → getOut()=${postOut}`);
                }

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

                // Limpiar les pistes de GRÀFICS i CHYRONS (V6 en amunt) més enllà de l'OUT.
                // ── (2026-09-23) ABANS eren llistes FIXES [2..8] i [A1,A2]: amb la pista nova
                // V9 (Mosa) el que hi hagués més enllà de l'OUT no es retallava ✗. Ara es
                // calculen de les pistes reals de la seqüència (val per a qualsevol .prproj).
                const nVid = parseInt(await callJSX("Tracks.count('video')") || '0') || 0;
                const nAud = parseInt(await callJSX("Tracks.count('audio')") || '0') || 0;
                // (2026-09-23) La neteja va de V3 EN AMUNT i **preserva V1 i V2**: l'operador té
                // a V2 el material de composició (IPD+ / Doble Finestra). ABANS es netejava de
                // V2 en amunt i, amb les pistes desbloquejades, el contingut de V2 desapareixia
                // (queixa d'usuari 2026-09-23).
                // (2026-09-24) V2 TAMBÉ es retalla a l'OUT: el material de composició
                // (IPD+ / doble finestra) que sobrepassa el final de la peça ha de quedar
                // tallat, si no el render arrossega el que hi ha més enllà de l'OUT.
                // (Abans V2 es preservava sencer → queixa "OUT&GO no recorta el out de V2".)
                const PRIMERA_A_NETEJAR = 2;   // V2+ = composició, grafismes, tema-títol, chyrons
                const videoTracks = [];
                for (let t = PRIMERA_A_NETEJAR; t <= nVid; t++) videoTracks.push(t);
                const audioTracks = [];
                for (let a = 1; a <= nAud; a++) audioTracks.push(a);
                log(`🔍 [FLOW-CUT] Limpiando pistas secundarias: video ${JSON.stringify(videoTracks)} (de ${nVid}), audio ${JSON.stringify(audioTracks)} (de ${nAud})`);
                const cleanupResult = await getClipsLogic().rippleAllOut(val, videoTracks, audioTracks, false);
                log(`🔍 [FLOW-CUT] Resultado cleanup: ${cleanupResult}`);

                const outPoint = (val - 0.04).toFixed(2);
                await callJSX(`Timeline.range(0.0, ${outPoint})`);

                // ── Zoom al rang de treball (corchetes IN/OUT) ──
                const zoomRes = await callJSX('Timeline.zoomToSelection()');
                log(`🔍 [FLOW-CUT] Zoom a selecció IN/OUT: ${zoomRes}`);

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