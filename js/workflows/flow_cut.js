/**
 * ============================================================================
 * WORKFLOW: CUT (VERSIÓ ULTRA-LIPO REINTERPRETADA)
 * ============================================================================
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

        runCutIn: async function () {
            log("🎬 CUT IN...");
            const cti = await callJSX('jsx_getCTI()');
            if (!cti || parseFloat(cti) <= 0) return;
            const val = parseFloat(cti);

            const clip = await clipsLogic.findAtTime(1, val, "video");
            if (clip) {
                await clipsLogic.rippleTrimStart(1, clip.index, val, clip);
                await callJSX('jsx_setCTI_Safe(0)');
            }
        },

        runCutOut: async function () {
            log("🎬 Iniciant CUT OUT (Lògica Atòmica Reinterpretada)...");
            try {
                const cti = await callJSX('jsx_getCTI()');
                if (!cti || parseFloat(cti) <= 0) return;
                const val = parseFloat(cti);
                const state = FASTPASS_UI.State;
                const config = FASTPASS_UI.Config.get();

                // 1. NETEJA MULTI-PISTA (Lògica de Bucle en JS sobre ponts atòmics)
                await clipsLogic.clearMultipleTracksAfter(val, [1, 2, 3, 4, 5, 6], [1]);

                // 2. MUNTATGE DE TEMA (V3 @ 0s)
                if (state.masterTheme) {
                    await callJSX(`jsx_overwriteClip('${utils.escape(state.masterTheme.name)}', 3, 0.0, 'video')`);
                }

                // 3. MUNTATGE DE SRT (V5 @ 0s)
                if (state.srt) {
                    await callJSX(`jsx_overwriteClip('${utils.escape(state.srt.name)}', 5, 0.0, 'video')`);
                }

                // 4. AISLAMENT I CHYRON (V3)
                await callJSX('jsx_setTrackMute(-1, true, "video")'); // Tot mute
                await callJSX('jsx_setTrackMute(3, false, "video")'); // V3 On

                // Cerca del Chyron principal des de JS (Lògica de decisió en JS)
                const chyronsRaw = await callJSX("jsx_listItems('CHYRONS')");
                const chyronsList = JSON.parse(chyronsRaw);
                const largeChyron = chyronsList
                    .filter(i => i.type === 1)
                    .sort((a, b) => (b.sizeMB || 0) - (a.sizeMB || 0))[0];

                if (largeChyron) {
                    log(`💎 Chyron detectat des de JS: ${largeChyron.name}`);
                    await callJSX(`jsx_overwriteClip('${utils.escape(largeChyron.name)}', 3, 0.4, 'video')`);
                    // Ajustem final a 6.6
                    await callJSX(`jsx_setClipEnd(3, 0, 6.6, 'video')`);
                }

                // 5. FREEZE FRAME (V3 @ 6.6s)
                await callJSX('jsx_setCTI_Safe(6.6)');
                await utils.delay(500);

                const projPath = await callJSX('app.project.path');
                const projectFolder = projPath.substring(0, projPath.lastIndexOf("\\"));
                const snapPath = `${projectFolder}\\Snapshots\\freeze_${Date.now()}.png`;

                const snap = await renderLogic.exportSnapshot(snapPath);
                if (snap.success) {
                    await callJSX(`jsx_importFile('${snapPath.replace(/\\/g, "\\\\")}')`);
                    const pngName = snapPath.split("\\").pop();
                    await callJSX(`jsx_overwriteClip('${utils.escape(pngName)}', 3, 6.6, 'video')`);
                }

                // 6. CONDUCTOR (V4 @ 7.6s)
                const sel = document.getElementById('conductor');
                let condFile = sel ? sel.value : "";
                if (!condFile) {
                    const prog = config.mapeoProgramas[document.getElementById('programa').value];
                    condFile = Array.isArray(prog.conductors.titular) ? prog.conductors.titular[0] : prog.conductors.titular;
                }

                if (condFile) {
                    const fullCondPath = config.rutas.conductors + condFile;
                    await callJSX(`jsx_importFile('${fullCondPath.replace(/\\/g, "\\\\")}')`);
                    await callJSX(`jsx_overwriteClip('${utils.escape(condFile)}', 4, 7.6, 'video')`);
                }

                // 7. FINALITZACIÓ
                const outPoint = (val - 0.04).toFixed(2);
                await callJSX(`jsx_setSequenceInOut(0.0, ${outPoint})`);
                await callJSX('jsx_setTrackMute(-1, false, "video")'); // Restaura visibilitat
                await callJSX('jsx_setCTI_Safe(0.10)');
                await callJSX("app.project.save()");

                log("🏁 CUT OUT Finalitzat.");
            } catch (e) { utils.handleError(e, "CutOut"); }
        },

        //runScene: async function() { await callJSX("jsx_detectScenes(1)"); },

        //runKey: async function() { await callJSX("jsx_addKeyframe()"); },

        init: function () {
            const slider = document.getElementById('slider-move');
            if (slider) {
                slider.oninput = function () { callJSX(`FASTPASS.Timeline.setClipXPosition(0, ${this.value})`); };
                slider.onchange = function () { callJSX('FASTPASS.Timeline.nuclearRefresh()'); };
            }
        }
    };

    FASTPASS_UI.Workflows.Cut.init();
    window.FASTPASS_UI = FASTPASS_UI;
})();