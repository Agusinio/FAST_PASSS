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
            log("🎬 Executant fase de tancament (CUT OUT)...");
            const cfg = FASTPASS_UI.Config.get();
            const T_MP4 = cfg.tracks.video.mp4;     // V1 (Brut)
            const T_THEME = cfg.tracks.video.tematitol; // V4 (Tema)
            const T_FONS = cfg.tracks.video.fondos;     // V3 (Fons)

            try {
                const ctiRaw = await callJSX('jsx_getCTI()');
                const val = parseFloat(ctiRaw || "0");
                
                // 1. Neteja de cues (Talls finals)
                // Esborrem tot el que sobresurti el CTI a partir d'ara
                // Tracks 1 a 6 (VUI 1-based)
                await clipsLogic.clearMultipleTracksAfter(val, [1, 2, 3, 4, 5, 6], [T_MP4]);

                // 2. TEMA MESTRE: Col·locació en V4 (Pista de Temes)
                const state = FASTPASS_UI.State;
                if (state.masterTheme) {
                    await callJSX(`jsx_overwriteClip('${utils.escape(state.masterTheme.name)}', ${T_THEME}, 0.0, 'video')`);
                }

                // 3. SUBTÍTOLS: Col·locació en pista S1 (S1)
                const T_S1 = cfg.tracks.subtitle.s1; // S1
                if (state.srt) {
                    await callJSX(`jsx_overwriteClip('${utils.escape(state.srt.name)}', ${T_S1}, 0.0, 'subtitle')`);
                }

                // 4. TANCAMENT I SALVATGE
                // Marcar punt de sortida 1 frame abans del tall definitiu
                const outPoint = (val - 0.04).toFixed(2);
                await callJSX(`jsx_setSequenceInOut(0.0, ${outPoint})`);
                
                await callJSX('app.project.save()');
                log("🏁 Tancament de seqüència completat.", "INFO");

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
         * Inicialització del workflow (si cal binding local).
         */
        init: function () {
            log("🔧 Workflow Cut lligat a tracks dinàmics.");
        }
    };

    window.FASTPASS_UI = FASTPASS_UI;
})();