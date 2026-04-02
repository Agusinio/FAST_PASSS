/**
 * ============================================================================
 * flux_tall.js (Workflow de Tall i Ripple Editing)
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
                const elProg = document.getElementById('programa').value;
                const elBloc = document.getElementById('bloc').value;
                const progData = config.mapeoProgramas[elProg];
                const shortToken = (progData && progData.wott) ? progData.wott : null;

                // 1. Obtenim la seqüència activa al Timeline de Premiere
                const activeSeqName = await callJSX('Entorn.activeSeq()');

                if (!activeSeqName || activeSeqName.indexOf("ERR") !== -1 || activeSeqName.indexOf("ERROR") !== -1) {
                    getUtils().status("⚠️ No hi ha seqüència oberta al Timeline!", "error");
                    return;
                }

                // 2. Validem que la seqüència activa correspon al context COMPLET dels selectors
                //    Ara que el nom inclou bloc (ex: TNV_V1_ESPORTS) podem validar els dos.
                if (shortToken && activeSeqName.indexOf(shortToken) === -1) {
                    getUtils().status(`⚠️ Seqüència [${activeSeqName}] ≠ programa [${elProg}]`, "error");
                    log(`❌ Context mismatch: seqüència="${activeSeqName}" | token esperat="${shortToken}"`);
                    return;
                }
                if (elBloc && elBloc !== "---" && activeSeqName.indexOf(elBloc) === -1) {
                    getUtils().status(`⚠️ Seqüència [${activeSeqName}] ≠ bloc [${elBloc}]`, "error");
                    log(`❌ Context mismatch: seqüència="${activeSeqName}" | bloc esperat="${elBloc}"`);
                    return;
                }

                // 3. Context validat → procedem amb el Ripple Trim In
                log(`✅ Context OK: [${activeSeqName}] | Tall IN...`);
                window.FASTPASS_UI.State.activeSequenceName = activeSeqName;
                if (!(await getUtils().validateActiveSequence())) return;

                const T_MP4 = config.tracks.video.mp4;
                const ctiRaw = await callJSX('Cronologia.get()');
                const val = parseFloat(ctiRaw || "0");

                const clip = await getClipsLogic().at(T_MP4, val, "video");

                if (clip) {
                    log(`✂️ Aplicant Ripple Trim In a V${T_MP4} (Time: ${val}s)`);
                    await getClipsLogic().rippleIn(T_MP4, clip.index, val, clip);
                    await callJSX('Cronologia.set(0)');
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
                const ctiRaw = await callJSX('Cronologia.get()');
                const val = parseFloat(ctiRaw || "0");

                // Netegem totes les cues a partir del CTI
                await getClipsLogic().rippleAllOut(val, [1, 2, 3, 4, 5, 6], [], true);

                const outPoint = (val - 0.04).toFixed(2);
                await callJSX(`Cronologia.range(0.0, ${outPoint})`);

                if (state.masterTheme) {
                    await callJSX(`Segments.insert('${getUtils().escape(state.masterTheme.name)}', ${T_THEME}, 0.0, null, 'video')`);
                }
                const elCond = document.getElementById('conductor');
                if (elCond && elCond.value) {
                    await callJSX(`Segments.insert('${getUtils().escape(elCond.value)}', ${T_CHYRONS}, 0.0, null, 'video')`);
                }

                await callJSX('Cronologia.set(0)');
                await callJSX('Projecte.save()');
                getUtils().status("Peça Tancada OK", "exito");
            } catch (e) { getUtils().handleError(e, "CutOut"); }
        },

        runScene: async function () {
            const cfg = FASTPASS_UI.Config.get();
            const T_MP4 = cfg.tracks.video.mp4;
            log("🎬 Trossejant clip a V" + T_MP4 + "...");

            try {
                await callJSX(`Pistes.target(${T_MP4}, true, 'video')`);
                await callJSX(`Segments.scenes(${T_MP4})`);
                await FASTPASS_UI.Workflows.Assembly.runAutoPlacement(T_MP4);
                getUtils().status("Trossejat i Muntatge OK", "exito");
            } catch (e) { getUtils().handleError(e, "Troseja"); }
        },

        runPrevClip: async function () {
            const cfg = FASTPASS_UI.Config.get();
            const T_MP4 = cfg.tracks.video.mp4;
            try {
                const ctiRaw = await callJSX('Cronologia.get()');
                const cti = parseFloat(ctiRaw || "0");
                const count = parseInt(await callJSX(`Segments.count(${T_MP4}, 'video')`));
                for (let i = count - 1; i >= 0; i--) {
                    const raw = await callJSX(`Segments.get(${T_MP4}, ${i}, 'video')`);
                    const clip = JSON.parse(raw || "{}");
                    if (clip.end <= cti - 0.05) {
                        const mid = (clip.start + clip.end) / 2;
                        await callJSX(`Cronologia.set(${mid})`);
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
                const ctiRaw = await callJSX('Cronologia.get()');
                const cti = parseFloat(ctiRaw || "0");
                const count = parseInt(await callJSX(`Segments.count(${T_MP4}, 'video')`));
                for (let i = 0; i < count; i++) {
                    const raw = await callJSX(`Segments.get(${T_MP4}, ${i}, 'video')`);
                    const clip = JSON.parse(raw || "{}");
                    if (clip.start >= cti + 0.05) {
                        const mid = (clip.start + clip.end) / 2;
                        await callJSX(`Cronologia.set(${mid})`);
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