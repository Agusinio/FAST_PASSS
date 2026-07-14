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
            alert("Nivel 1: ¡Entrando en runCutIn!");
            log("🎬 runCutIn iniciado");
            try {
                // 1. Obtenim la seqüència activa i la guardem a l'estat per a validació
                const activeSeqName = await callJSX('Entorn.activeSeq()');

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
                const T_MAIN = config.tracks.video.main;
                if (!T_MAIN) {
                    Eines.log("❌ Error: T_MAIN no definido", "ERROR");
                    return; // Aquí se pararía sin avisar al JSX
                }
                const ctiRaw = await callJSX('Cronologia.get()');
                Eines.log("CTI obtenido: " + ctiRaw, "DEBUG");

                const val = parseFloat(ctiRaw || "0");
                Eines.log("Llamando a Segments.at con pista: " + T_MAIN, "DEBUG");

                const clip = await getClipsLogic().at(T_MP4, val, "video");

                if (clip && clip !== "null") {
                    const parsedClip = JSON.parse(clip);
                    Eines.log("Clip encontrado: " + parsedClip.name, "DEBUG");
                    await getClipsLogic().rippleIn(T_MAIN, parsedClip.index, val, parsedClip);
                } else {
                    Eines.log("⚠️ No se ha encontrado clip en el CTI", "WARN");
                }

            } catch (e) { 
                Eines.handleError(e, "runCutIn"); 
            }
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
            const T_MAIN = cfg.tracks.video.main;
            const T_THEME = cfg.tracks.video.tematitol;
            const T_CHYRONS = cfg.tracks.video.chyrons;

            try {
                const ctiRaw = await callJSX('Cronologia.get()');
                const val = parseFloat(ctiRaw || "0");

                // Netegem totes les cues a partir del CTI
                await getClipsLogic().rippleAllOut(val, [1, 2, 3, 4, 5, 6, 7, 8], [], true);

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
            const T_MAIN = cfg.tracks.video.main;
            log("🎬 Trossejant clip a V" + T_MAIN + "...");

            try {
                await callJSX(`Pistes.target(${T_MAIN}, true, 'video')`);
                await callJSX(`Segments.scenes(${T_MAIN})`);
                await FASTPASS_UI.Workflows.Assembly.runAutoPlacement(T_MAIN);
                getEines().status("Trossejat i Muntatge OK", "exito");
            } catch (e) { getEines().handleError(e, "Troseja"); }
        },

        runPrevClip: async function () {
            const activeSeqName = await callJSX('Entorn.activeSeq()');
            window.FASTPASS_UI.State.activeSequenceName = activeSeqName;
            if (!(await getEines().validateActiveSequence())) return;

            const cfg = FASTPASS_UI.Config.get();
            const T_MAIN = cfg.tracks.video.main;
            try {
                const ctiRaw = await callJSX('Cronologia.get()');
                const cti = parseFloat(ctiRaw || "0");
                const count = parseInt(await callJSX(`Segments.count(${T_MAIN}, 'video')`));
                for (let i = count - 1; i >= 0; i--) {
                    const raw = await callJSX(`Segments.get(${T_MAIN}, ${i}, 'video')`);
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
            const T_MAIN = cfg.tracks.video.main;
            try {
                const ctiRaw = await callJSX('Cronologia.get()');
                const cti = parseFloat(ctiRaw || "0");
                const count = parseInt(await callJSX(`Segments.count(${T_MAIN}, 'video')`));
                for (let i = 0; i < count; i++) {
                    const raw = await callJSX(`Segments.get(${T_MAIN}, ${i}, 'video')`);
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