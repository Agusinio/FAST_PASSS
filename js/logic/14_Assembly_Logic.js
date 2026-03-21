/**
 * ============================================================================
 * LOGIC: ASSEMBLY (Montaje y Acabados de Secuencia)
 * ============================================================================
 */

(function() {
    var FASTPASS_UI = window.FASTPASS_UI || {};
    FASTPASS_UI.Logic = FASTPASS_UI.Logic || {};

    const utils = {
        callJSX: (s) => window.FASTPASS_UI.Utils.callJSX(s),
        log: (m) => window.FASTPASS_UI.Utils.log(m, "DEBUG"),
        delay: (ms) => new Promise(r => setTimeout(r, ms))
    };

    FASTPASS_UI.Logic.Assembly = {
        
        /**
         * Realiza el montaje decorativo (Tema, SRT, Chyron).
         */
        applyDecorativeSetup: async function(state) {
            utils.log("🏗️ Aplicant muntatge decoratiu (V3, V4, V5)...");
            
            // 1. TEMA-TITOL en V3 (Índice 2)
            if (state.masterTheme && state.masterTheme.name) {
                await utils.callJSX(`jsx_overwriteClip('${utils.escape(state.masterTheme.name)}', 3, 0.0, 'video')`);
            }

            // 2. SRT en V5 (Índice 4)
            if (state.srt && state.srt.name) {
                await utils.callJSX(`jsx_overwriteClip('${utils.escape(state.srt.name)}', 5, 0.0, 'video')`);
            }

            // 3. AISLAMIENTO PARA CHYRON (V3)
            // Usamos Tracks_Logic para aislar la pista 3
            await FASTPASS_UI.Logic.Tracks.isolateTrack(3, "video");
            
            // 4. DETECCIÓN Y COLOCACIÓN DE CHYRON (Si el motor lo reporta)
            const scanReport = await utils.callJSX('FASTPASS.Project.findLargeChyronVerbose()');
            if (scanReport.indexOf("✅") !== -1) {
                // Colocamos el Chyron almacenado en V3, de 0.4s a 6.6s
                await utils.callJSX('jsx_findAndPlaceChyron_Stored(3, 0.4, 6.6)');
            }

            return "OK_DECORATIVE";
        },

        /**
         * Crea el Freeze Frame final mediante un Snapshot orquestado.
         */
        createFreezeFrame: async function(targetTime = 6.6) {
            utils.log(`📸 Iniciant Snapshot per a Freeze Frame a ${targetTime}s...`);
            
            // 1. Preparación de pista (Solo visible V3)
            await utils.callJSX('jsx_setTrackMute(-1, true, "video")'); // Mute All
            await utils.callJSX('jsx_setTrackMute(3, false, "video")'); // Solo V3 visible
            await utils.callJSX(`jsx_setCTI_Safe(${targetTime})`);
            await utils.delay(800);

            // 2. Exportación via Render_Logic
            const projPath = await utils.callJSX('app.project.path');
            const folder = projPath.substring(0, projPath.lastIndexOf("\\"));
            const snapshotPath = `${folder}\\Snapshots\\freeze_${Date.now()}.png`;
            
            const snapRes = await FASTPASS_UI.Logic.Render.exportSnapshot(snapshotPath);
            
            // 3. Restauración de visibilidad
            await utils.callJSX('jsx_setTrackMute(-1, false, "video")'); // Unmute All

            // 4. Importación y Colocación
            if (snapRes.success) {
                // Importamos el PNG
                await utils.callJSX(`jsx_importFile('${snapshotPath.replace(/\\/g, "\\\\")}')`);
                const filename = snapshotPath.split("\\").pop();
                
                // Obtenemos el final de la secuencia para extender el PNG
                const outPoint = await utils.callJSX('app.project.activeSequence.outPoint.seconds');
                
                // Colocamos el PNG en V3 desde 6.6 al final
                await utils.callJSX(`jsx_overwriteClip('${utils.escape(filename)}', 3, ${targetTime}, 'video')`);
                // TODO: Habría que estirar el clip si overwrite no lo hace por defecto para cubrir hasta outPoint
                return "OK_FREEZE";
            }
            return "ERR_SNAPSHOT";
        },

        /**
         * Inserta el conductor correspondiente al programa.
         */
        insertConductor: async function(conductorFile, targetTime = 7.6) {
            if (!conductorFile) return "NO_CONDUCTOR";
            
            const config = FASTPASS_UI.Config.get();
            const pathCompleto = config.rutas.conductors + conductorFile;
            
            utils.log(`👤 Inserint conductor: ${conductorFile} en V4`);
            await utils.callJSX(`jsx_importFile('${pathCompleto.replace(/\\/g, "\\\\")}')`);
            await utils.callJSX(`jsx_overwriteClip('${utils.escape(conductorFile)}', 4, ${targetTime}, 'video')`);
            
            return "OK_CONDUCTOR";
        }
    };

    window.FASTPASS_UI = FASTPASS_UI;
})();
