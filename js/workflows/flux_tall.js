/**
 * ============================================================================
 * flux_tall.js (Workflow de Tall i Ripple Editing)
 * ============================================================================
 */

(function () {
    var FASTPASS_UI = window.FASTPASS_UI || {};
    FASTPASS_UI.Workflows = FASTPASS_UI.Workflows || {};

    const getEines = () => window.FASTPASS_UI.Eines;
    const getClipsLogic = () => window.FASTPASS_UI.Logic.Segments;

    const log = (m) => getEines().log(m, "DEBUG");
    const callJSX = (s) => getEines().callJSX(s);

    FASTPASS_UI.Workflows.Cut = {

        /**
         * Realitza un Ripple Trim In al clip principal de Mp4.
         */
        runCutIn: async function () {
            log("🎬 runCutIn iniciado");
            try {
                // 1. Obtenim la seqüència activa i la guardem a l'estat per a validació
                let activeSeqName = await callJSX('Entorn.activeSeq()');

                if (!activeSeqName || activeSeqName.indexOf("ERR") !== -1) {
                    log("⚠️ Seqüència no detectada, reintentant en 300ms...");
                    await new Promise(r => setTimeout(r, 300));
                    activeSeqName = await callJSX('Entorn.activeSeq()');
                }

                window.FASTPASS_UI.State.activeSequenceName = activeSeqName;
                
                // 2. Validació Global de Context
                if (!(await getEines().validateActiveSequence())) {
                    log("❌ Fallada en la validació de context.");
                    return;
                }
                
                log(`✅ Validación Exitosa para: [${activeSeqName}] | Tall IN...`);

                // 3. Procedem amb el Ripple Trim In
                const config = FASTPASS_UI.Config.get();
                const T_MP4 = config.tracks.video.mp4;
                const ctiRaw = await callJSX('Cronologia.get()');
                const val = parseFloat(ctiRaw || "0");

                const clip = await getClipsLogic().at(T_MP4, val, "video");

                if (clip) {
                    log(`✂️ Aplicant Ripple Trim In a V${T_MP4} (Time: ${val}s)`);
                    await getClipsLogic().rippleIn(T_MP4, clip.index, val, clip);
                    await callJSX('Cronologia.set(0)');
                    getEines().status("IN: Tall OK", "exito");
                } else {
                    getEines().status("No hi ha clip al cabezal", "error");
                }
            } catch (e) { getEines().handleError(e, "CutIn"); }
        },

        /**
         * Workflow de tancament (CUT OUT).
         */
        runCutOut: async function () {
            const activeSeqName = await callJSX('Entorn.activeSeq()');
            window.FASTPASS_UI.State.activeSequenceName = activeSeqName;
            
            if (!(await getEines().validateActiveSequence())) return;
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
                    await callJSX(`Segments.insert('${getEines().escape(state.masterTheme.name)}', ${T_THEME}, 0.0, null, 'video')`);
                }
                const elCond = document.getElementById('conductor');
                if (elCond && elCond.value) {
                    await callJSX(`Segments.insert('${getEines().escape(elCond.value)}', ${T_CHYRONS}, 0.0, null, 'video')`);
                }

                await callJSX('Cronologia.set(0)');
                await callJSX('Projecte.save()');
                getEines().status("Peça Tancada OK", "exito");
            } catch (e) { getEines().handleError(e, "CutOut"); }
        },

        runScene: async function () {
            const activeSeqName = await callJSX('Entorn.activeSeq()');
            window.FASTPASS_UI.State.activeSequenceName = activeSeqName;
            if (!(await getEines().validateActiveSequence())) return;

            const cfg = FASTPASS_UI.Config.get();
            const T_MP4 = cfg.tracks.video.mp4;
            log("🎬 Trossejant clip a V" + T_MP4 + "...");

            try {
                await callJSX(`Pistes.target(${T_MP4}, true, 'video')`);
                await callJSX(`Segments.scenes(${T_MP4})`);
                await FASTPASS_UI.Workflows.Assembly.runAutoPlacement(T_MP4);
                getEines().status("Trossejat i Muntatge OK", "exito");
            } catch (e) { getEines().handleError(e, "Troseja"); }
        },

        runPrevClip: async function () {
            const activeSeqName = await callJSX('Entorn.activeSeq()');
            window.FASTPASS_UI.State.activeSequenceName = activeSeqName;
            if (!(await getEines().validateActiveSequence())) return;

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
            } catch (e) { getEines().handleError(e, "NavPrev"); }
        },

        runNextClip: async function () {
            const activeSeqName = await callJSX('Entorn.activeSeq()');
            window.FASTPASS_UI.State.activeSequenceName = activeSeqName;
            if (!(await getEines().validateActiveSequence())) return;

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
            } catch (e) { getEines().handleError(e, "NavNext"); }
        }
    };

    window.FASTPASS_UI.Workflows.Cut = FASTPASS_UI.Workflows.Cut;
})();