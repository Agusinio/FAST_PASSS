/**
 * ============================================================================
 * WORKFLOW: CUT (v15 - VERSIÓ VARIABLES GLOBALS)
 * ============================================================================
 * Totes les operacions d'edició (In/Out) ara usen el mapa de pistes global.
 */

(function () {
    var FASTPASS_UI = window.FASTPASS_UI || {};
    FASTPASS_UI.Workflows = FASTPASS_UI.Workflows || {};

    const utils = window.FASTPASS_UI.Utils;
    const clipsLogic = window.FASTPASS_UI.Logic.Clips;
    const renderLogic = window.FASTPASS_UI.Logic.Render;
    const log = (m) => utils.log(m, "DEBUG");
    const callJSX = (s) => utils.callJSX(s);

    FASTPASS_UI.Workflows.Cut = {

        /**
         * Realitza un Ripple Trim In al clip principal de Mp4.
         */
        runCutIn: async function () {
            if (!(await utils.validateActiveSequence())) return;
            log("🎬 Realitzant CUT IN...");
            const cfg = FASTPASS_UI.Config.get();
            const T_MP4 = cfg.tracks.video.mp4; // V1

            try {
                const ctiRaw = await callJSX('jsx_getCTI()');
                const val = parseFloat(ctiRaw || "0");

                // Troba el clip a la pista mp4 (V1)
                const clip = await clipsLogic.findAtTime(T_MP4, val, "video");
                if (clip) {
                    // Ajusta entrada i desplaça tot (Ripple Trim)
                    await clipsLogic.rippleTrimStart(T_MP4, clip.index, val, clip);
                    // Retorn del cabezal a l'inici per poliment
                    await callJSX('jsx_setCTI_Safe(0)');
                } else {
                    log("⚠️ No es troba clip a V" + T_MP4 + " per fer el tall.", "WARN");
                }
            } catch (e) { utils.handleError(e, "CutIn"); }
        },

        /**
         * Workflow de tancament (CUT OUT).
         */
        runCutOut: async function () {
            if (!(await utils.validateActiveSequence())) return;
            log("🎬 Executant tancament PRO (CUT OUT)...");
            
            const cfg = FASTPASS_UI.Config.get();
            const state = FASTPASS_UI.State;
            
            const T_MP4 = cfg.tracks.video.mp4;         // V1
            const T_THEME = cfg.tracks.video.tematitol; // V4
            const T_CHYRONS = cfg.tracks.video.chyrons; // V5

            try {
                const ctiRaw = await callJSX('jsx_getCTI()');
                const val = parseFloat(ctiRaw || "0");
                
                // 1. NETEJA DE CUES: Esborrem tot el que sobresurti
                // Netegem pistes 1 a 6 (Video)
                await clipsLogic.clearMultipleTracksAfter(val, [1, 2, 3, 4, 5, 6], [T_MP4]);

                // 2. COL·LOCACIÓ TEMA MESTRE (V4)
                if (state.masterTheme) {
                    log(`📌 Col·locant Tema: ${state.masterTheme.name}`);
                    await callJSX(`jsx_overwriteClip('${utils.escape(state.masterTheme.name)}', ${T_THEME}, 0.0, 'video')`);
                }

                // 3. COL·LOCACIÓ CONDUCTOR (V5)
                const elCond = document.getElementById('conductor');
                if (elCond && elCond.value) {
                    log(`📌 Col·locant Conductor: ${elCond.value}`);
                    // El conductor sol anar al frame 0 o amb un petit offset si calgués
                    await callJSX(`jsx_overwriteClip('${utils.escape(elCond.value)}', ${T_CHYRONS}, 0.0, 'video')`);
                }

                // 4. TANCAMENT DE SEQÜÈNCIA
                const outPoint = (val - 0.04).toFixed(2);
                await callJSX(`jsx_setSequenceInOut(0.0, ${outPoint})`);
                
                // 📍 Posicionament final del cabezal per a revisió (1 frame abans del final)
                await callJSX(`jsx_setCTI_Safe(${outPoint})`);
                
                await callJSX('app.project.save()');
                utils.status("Peça Tancada OK", "exito");
                log("🏁 Tancament de seqüència completat amb èxit.", "INFO");

            } catch (e) { utils.handleError(e, "CutOut"); }
        },

        /**
         * Detectar talls automàticament en el clip principal.
         */
        runScene: async function() { 
            const cfg = FASTPASS_UI.Config.get();
            const T_MP4 = cfg.tracks.video.mp4;
            log("🎬 Detectant escenes a V" + T_MP4 + "...");
            await callJSX(`jsx_detectScenes(${T_MP4})`); 
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
                    if (clip.end <= cti - 0.04) {
                        const mid = (clip.start + clip.end) / 2;
                        await callJSX(`jsx_setCTI_Safe(${mid})`);
                        return;
                    }
                }
            } catch (e) { utils.handleError(e, "NavPrev"); }
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
                    if (clip.start >= cti + 0.04) {
                        const mid = (clip.start + clip.end) / 2;
                        await callJSX(`jsx_setCTI_Safe(${mid})`);
                        return;
                    }
                }
            } catch (e) { utils.handleError(e, "NavNext"); }
        },

        init: function () {
            log("🔧 Workflow Cut lligat a tracks dinàmics.");
        }

    };

    window.FASTPASS_UI = FASTPASS_UI;
})();