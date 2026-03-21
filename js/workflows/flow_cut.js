/**
 * ============================================================================
 * WORKFLOW: CUT (v14 - VERSIÓ ULTRA-LIPO REESTRUCTURADA)
 * ============================================================================
 * Orquestra les operacions d'edició del tall definitiu (CutIn / CutOut).
 * Totes les importacions ara usen el sistema plural 'jsx_importFiles'.
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
         * Retalla el clip actiu a V1 des de l'inici fins al CTI.
         */
        runCutIn: async function () {
            log("🎬 Realitzant CUT IN...");
            const cti = await callJSX('jsx_getCTI()');
            if (!cti) return;
            const val = parseFloat(cti);

            // Troba quin clip hi ha a V1 (pista 1) en aquest instant
            const clip = await clipsLogic.findAtTime(1, val, "video");
            if (clip) {
                // Ripple Trim (ajusta entrada i desplaça tot el timeline)
                await clipsLogic.rippleTrimStart(1, clip.index, val, clip);
                await callJSX('jsx_setCTI_Safe(0)');
            }
        },

        /**
         * Workflow complex de poliment final ("The Out Phase").
         */
        runCutOut: async function () {
            log("🎬 Iniciant fase de poliment (CUT OUT)...");
            try {
                const cti = await callJSX('jsx_getCTI()');
                if (!cti) return;
                const val = parseFloat(cti);
                
                const state = FASTPASS_UI.State;
                const config = FASTPASS_UI.Config.get();

                // 1. NETEJA POSTERIOR: Esborra tot el que sobri a partir del CTI
                // Tracks 1 a 6, excepte V1 que es conserva com a referència
                await clipsLogic.clearMultipleTracksAfter(val, [1, 2, 3, 4, 5, 6], [1]);

                // 2. TEMA MESTRE: Col·locació a V3 inici
                if (state.masterTheme) {
                    await callJSX(`jsx_overwriteClip('${utils.escape(state.masterTheme.name)}', 3, 0.0, 'video')`);
                }

                // 3. SUBTÍTOLS: Col·locació a V5 inici
                if (state.srt) {
                    await callJSX(`jsx_overwriteClip('${utils.escape(state.srt.name)}', 5, 0.0, 'video')`);
                }

                // 4. MUNTATGE DE RÈTOLS (CHYRONS)
                // Busquem el rètol més pesat (el principal) directament des de JS
                const chyronsRaw = await callJSX("jsx_listItems('CHYRONS')");
                const chyronsList = JSON.parse(chyronsRaw || "[]");
                const largeChyron = chyronsList
                    .filter(i => i.type === 1) // 1 = Media (no bins)
                    .sort((a, b) => (b.sizeMB || 0) - (a.sizeMB || 0))[0];

                if (largeChyron) {
                    log(`💎 Chyron detectat des de JS: ${largeChyron.name}`);
                    await callJSX(`jsx_overwriteClip('${utils.escape(largeChyron.name)}', 3, 0.4, 'video')`);
                    // El rètol de final sol acabar als 6.6s segons el manual de marca
                    await callJSX(`jsx_setClipEnd(3, 0, 6.6, 'video')`);
                }

                // 5. FREEZE FRAME (Snapshot)
                // Exportem un frame a la posició 6.6 i el tornem a importar a V3
                await callJSX('jsx_setCTI_Safe(6.6)');
                await utils.delay(500);

                const projPath = await callJSX('app.project.path');
                const projectFolder = projPath.substring(0, projPath.lastIndexOf("\\"));
                const snapPath = `${projectFolder}\\Snapshots\\freeze_${Date.now()}.png`;

                const snap = await renderLogic.exportSnapshot(snapPath);
                if (snap.success) {
                    // Ús de la nova pluralitat de ponts de importació
                    const payload = JSON.stringify([snapPath.replace(/\\/g, "\\\\")]);
                    await callJSX(`jsx_importFiles('${payload}', 'root')`);
                    
                    const pngName = snapPath.split("\\").pop();
                    await callJSX(`jsx_overwriteClip('${utils.escape(pngName)}', 3, 6.6, 'video')`);
                }

                // 6. CONDUCTOR: Col·locació automàtica a V4
                const sel = document.getElementById('conductor');
                let condFile = sel ? sel.value : "";
                if (!condFile) {
                    // Fallback al titular si no hi ha selecció
                    const progKey = document.getElementById('programa').value;
                    const prog = config.mapeoProgramas[progKey];
                    condFile = Array.isArray(prog.conductors.titular) ? prog.conductors.titular[0] : prog.conductors.titular;
                }

                if (condFile) {
                    const fullCondPath = config.rutas.conductors + condFile;
                    const condPayload = JSON.stringify([fullCondPath.replace(/\\/g, "\\\\")]);
                    await callJSX(`jsx_importFiles('${condPayload}', 'root')`);
                    await callJSX(`jsx_overwriteClip('${utils.escape(condFile)}', 4, 7.6, 'video')`);
                }

                // 7. TANCAMENT I SALVATGE
                const outPoint = (val - 0.04).toFixed(2);
                await callJSX(`jsx_setSequenceInOut(0.0, ${outPoint})`);
                await callJSX('jsx_setCTI_Safe(0.10)');
                await callJSX("app.project.save()");

                log("🏁 Poliment (CUT OUT) completat amb èxit.");
            } catch (e) { utils.handleError(e, "CutOut"); }
        },

        runScene: async function() { await callJSX("jsx_detectScenes(1)"); },

        /**
         * Inicialització del workflow (si cal binding local).
         */
        init: function () {
            // El slider el gestiona main.js per evitar conflictes de múltiples listeners
            log("🔧 Workflow Cut inicialitzat.");
        }
    };

    window.FASTPASS_UI = FASTPASS_UI;
})();