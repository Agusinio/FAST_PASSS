/**
 * ============================================================================
 * WORKFLOW: CUT (v15 - VERSIÓ VARIABLES GLOBALS) - flow_cut.js
 * ============================================================================
 * Totes les operacions d'edició (In/Out) ara usen el mapa de pistes global.
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

                // 1. Cercar token del programa
                const progData = config.mapeoProgramas[elProg];
                const progToken = progData ? progData.archivo : elProg;

                log(`🔍 Sincronitzant per tokens: [${progToken}] + [${elBloc}]`);

                // 2. Sincronitzem la seqüència
                const foundName = await callJSX(`jsx_findSequenceByTokens('${progToken}', '${elBloc}')`);
                if (!foundName || foundName.indexOf("ERR:") !== -1 || foundName === "null") {
                    getUtils().status("⚠️ No trobo la seqüència!", "error");
                    return;
                }

                window.FASTPASS_UI.State.activeSequenceName = foundName;
                if (!(await getUtils().validateActiveSequence())) return;

                // 3. Tallar el clip Mp4 (V1, A1)
                const T_MP4 = config.tracks.video.mp4;
                const ctiRaw = await callJSX('jsx_getCTI()');
                const val = parseFloat(ctiRaw || "0");

                const clip = await getClipsLogic().findAtTime(T_MP4, val, "video");

                if (clip) {
                    log(`✂️ Aplicant Ripple Trim In a V${T_MP4} (Time: ${val}s)`);
                    await getClipsLogic().rippleTrimStart(T_MP4, clip.index, val, clip);

                    // Ens tornem a posar al 0 per seguretat
                    await callJSX('jsx_setCTI_Safe(0)');
                    getUtils().status("IN: Tall OK", "exito");
                } else {
                    log("⚠️ No s'ha trobat clip mp4 al cabezal.", "WARN");
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

            const T_MP4 = cfg.tracks.video.mp4;         // V1
            const T_THEME = cfg.tracks.video.tematitol; // V4
            const T_CHYRONS = cfg.tracks.video.chyrons; // V5

            try {
                const ctiRaw = await callJSX('jsx_getCTI()');
                const val = parseFloat(ctiRaw || "0");

                // 1. TALLAR I NETEJAR CUES (V1-V6 i A1) - Amb extensió si són curts
                await getClipsLogic().clearMultipleTracksAfter(val, [1, 2, 3, 4, 5, 6], [T_MP4], true);

                // 2. TANCAMENT DE SEQÜÈNCIA (Out point en val - 1 frame)
                const outPoint = (val - 0.04).toFixed(2);
                await callJSX(`jsx_setSequenceInOut(0.0, ${outPoint})`);

                // 3. COL·LOCACIÓ ELEMENTOS FIXOS (Tema i Conductor)
                if (state.masterTheme) {
                    await callJSX(`jsx_overwriteClip('${getUtils().escape(state.masterTheme.name)}', ${T_THEME}, 0.0, 'video')`);
                }
                const elCond = document.getElementById('conductor');
                if (elCond && elCond.value) {
                    await callJSX(`jsx_overwriteClip('${getUtils().escape(elCond.value)}', ${T_CHYRONS}, 0.0, 'video')`);
                }

                // 4. POSICIONAMENT INICIAL
                await callJSX('jsx_setCTI_Safe(0)');

                await callJSX('jsx_saveProject()');
                getUtils().status("Peça Tancada OK", "exito");
                log("🏁 Tancament completat i tornada a l'inici.", "INFO");

            } catch (e) { getUtils().handleError(e, "CutOut"); }
        },

        runScene: async function () {
            const cfg = FASTPASS_UI.Config.get();
            const T_MP4 = cfg.tracks.video.mp4;
            log("🎬 Trossejant clip a V" + T_MP4 + "...");

            try {
                // Assegurem que la pista estigui activa/targeted (Base 1)
                await callJSX(`jsx_setTrackTarget(${T_MP4}, true, 'video')`);

                // Executem la detecció d'escenes
                await callJSX(`jsx_detectScenes(${T_MP4})`);

                // 🚀 NOVA FASE: Análisis de estructura i col·locació de rètols automàtica
                log("🧠 Analitzant estructura i col·locant rètols...");
                await FASTPASS_UI.Workflows.Assembly.runAutoPlacement(T_MP4);

                getUtils().status("Trossejat i Muntatge OK", "exito");
            } catch (e) { getUtils().handleError(e, "Troseja"); }
        },

        /**
         * Navegació ràpida al clip ANTERIOR de la pista Mp4.
         */
        runPrevClip: async function () {
            const cfg = FASTPASS_UI.Config.get();
            const T_MP4 = cfg.tracks.video.mp4;
            log("⏮ Nav: Clip anterior a V" + T_MP4);
            try {
                const ctiRaw = await callJSX('jsx_getCTI()');
                const cti = parseFloat(ctiRaw || "0");
                const count = parseInt(await callJSX(`jsx_getClipCount(${T_MP4}, 'video')`));
                for (let i = count - 1; i >= 0; i--) {
                    const raw = await callJSX(`jsx_getClipDataByIndex(${T_MP4}, ${i}, 'video')`);
                    const clip = JSON.parse(raw || "{}");
                    if (clip.end <= cti - 0.05) {
                        const mid = (clip.start + clip.end) / 2;
                        log(`   🎯 Saltant al clip anterior ${i}: ${mid.toFixed(2)}s`);
                        await callJSX(`jsx_setCTI_Safe(${mid})`);

                        if (window.FASTPASS_UI.Sync && window.FASTPASS_UI.Sync.updateSliderFromPremiere) {
                            setTimeout(() => window.FASTPASS_UI.Sync.updateSliderFromPremiere(), 100);
                        }
                        return;
                    }
                }
            } catch (e) { getUtils().handleError(e, "NavPrev"); }
        },

        /**
         * Navegació ràpida al clip SEGÜENT de la pista Mp4.
         */
        runNextClip: async function () {
            const cfg = FASTPASS_UI.Config.get();
            const T_MP4 = cfg.tracks.video.mp4;
            log("⏭ Nav: Clip següent a V" + T_MP4);
            try {
                const ctiRaw = await callJSX('jsx_getCTI()');
                const cti = parseFloat(ctiRaw || "0");
                const count = parseInt(await callJSX(`jsx_getClipCount(${T_MP4}, 'video')`));
                for (let i = 0; i < count; i++) {
                    const raw = await callJSX(`jsx_getClipDataByIndex(${T_MP4}, ${i}, 'video')`);
                    const clip = JSON.parse(raw || "{}");
                    if (clip.start >= cti + 0.05) {
                        const mid = (clip.start + clip.end) / 2;
                        log(`   🎯 Saltant al clip ${i}: ${mid.toFixed(2)}s`);
                        await callJSX(`jsx_setCTI_Safe(${mid})`);

                        // Forcem l'actualització del slider perquè l'usuari pugui ajustar al moment
                        if (window.FASTPASS_UI.Sync && window.FASTPASS_UI.Sync.updateSliderFromPremiere) {
                            setTimeout(() => window.FASTPASS_UI.Sync.updateSliderFromPremiere(), 100);
                        }
                        return;
                    }
                }
            } catch (e) { getUtils().handleError(e, "NavNext"); }
        },

        init: function () {
            log("🔧 Workflow Cut lligat a tracks dinàmics.");
        }

    };

    window.FASTPASS_UI = FASTPASS_UI;
})(); const raw = await callJSX(`jsx_getClipDataByIndex(${T_MP4}, ${i}, 'video')`);
const clip = JSON.parse(raw || "{}");
if (clip.start >= cti + 0.05) {
    const mid = (clip.start + clip.end) / 2;
    log(`   🎯 Saltant al clip ${i}: ${mid.toFixed(2)}s`);
    await callJSX(`jsx_setCTI_Safe(${mid})`);

    // Forcem l'actualització del slider perquè l'usuari pugui ajustar al moment
    if (window.FASTPASS_UI.Sync && window.FASTPASS_UI.Sync.updateSliderFromPremiere) {
        setTimeout(() => window.FASTPASS_UI.Sync.updateSliderFromPremiere(), 100);
    }
    return;
}
                }
            } catch (e) { getUtils().handleError(e, "NavNext"); }
        },

init: function () {
    log("🔧 Workflow Cut lligat a tracks dinàmics.");
}

    };

window.FASTPASS_UI = FASTPASS_UI;
}) ();