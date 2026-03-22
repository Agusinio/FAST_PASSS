/**
 * ============================================================================
 * WORKFLOW: RENDER (EXPORTACIÓ) (v11 - VERSIÓ ULTRA-LIPO)
 * ============================================================================
 */

(function () {
    var FASTPASS_UI = window.FASTPASS_UI || {};
    FASTPASS_UI.Workflows = FASTPASS_UI.Workflows || {};

    const utils = window.FASTPASS_UI.Utils;
    const renderLogic = window.FASTPASS_UI.Logic.Render;
    const log = (m) => utils.log(m, "DEBUG");
    const callJSX = (s) => utils.callJSX(s);

    FASTPASS_UI.Workflows.Render = {

        /**
         * Envia la seqüència activa a AME.
         */
        runVideo: async function () {
            if (!(await utils.validateActiveSequence())) return;
            log("🚀 Preparant enviament a AME...");
            const config = FASTPASS_UI.Config.get();

            try {
                // 1. Obtenir ruta del projecte o rutes per defecte
                let outputDir = await callJSX("jsx_getProjectFolder()");
                if (!outputDir) outputDir = config.rutas.destinoBase || "C:\\Temp";
                
                utils.status("Processant nom...", "procesando");

                // 2. Càlcul del nom de sortida basat en la seqüència
                const seqName = await callJSX('jsx_getActiveSequenceName()');
                let fileName = "Export_TBD.mp4";
                
                if (seqName) {
                    const parts = seqName.split("_");
                    const prog = parts[0] || "PROG";
                    const tema = parts.slice(2).join("_") || "TEMA";
                    const now = new Date();
                    const timeStr = ("0" + now.getHours()).slice(-2) + "_" + ("0" + now.getMinutes()).slice(-2);
                    fileName = `${prog}_${tema}_${timeStr}.mp4`;
                }

                // 3. Ruta del Preset (.epr)
                const extRoot = window.FASTPASS_UI.csInterface.getSystemPath(SystemPath.EXTENSION);
                const presetPath = `${extRoot}/presets/H264_2Pass_Vertical.epr`.replace(/\\/g, '\\\\');

                log(`📤 Destí: ${outputDir}\\${fileName}`);

                // 4. Execució delegada a la Lògica
                const res = await renderLogic.queueRender(presetPath, outputDir, fileName);

                if (res && res.indexOf("OK") === 0) {
                    utils.status(`Render OK: ${fileName}`, "exito");
                    log("✅ Enviat a Media Encoder correctament.", "INFO");
                    // Guardem la referència per a la portada
                    FASTPASS_UI.State.lastRenderName = fileName.replace(".mp4", "");
                } else {
                    throw new Error("Error en el pont AME: " + res);
                }

            } catch (e) { utils.handleError(e, "RenderVideo"); }
        },

        /**
         * Exporta un PNG del frame actual (Portada).
         */
        runPortada: async function () {
            log("📸 Generant Portada (Mode Aïllat)...");
            const tracksLogic = window.FASTPASS_UI.Logic.Tracks;
            
            try {
                const config = FASTPASS_UI.Config.get();
                const targetDir = config.rutas.portadas || config.rutas.destinoBase || "C:\\Temp";
                const T_MP4 = config.tracks.video.mp4;
                const T_THEME = config.tracks.video.tematitol;

                // 🛡️ AÏLLAMENT DE PISTES (Per a que no surtin chyrons bruts o fons)
                // 1. Muteja-ho TOT (Video)
                await tracksLogic.setGlobalState("video", "mute", true);
                // 2. Unmute només el que volem (MP4 i Tema)
                await callJSX(`jsx_setTrackMute(${T_MP4}, false, 'video')`);
                await callJSX(`jsx_setTrackMute(${T_THEME}, false, 'video')`);

                // 📸 SNAPSHOT
                let nameBase = FASTPASS_UI.State.lastRenderName;
                if (!nameBase) {
                    const seqName = await callJSX('jsx_getActiveSequenceName()');
                    nameBase = seqName ? seqName : "Portada_TBD";
                }

                const fullPath = `${targetDir}\\${nameBase}.png`;
                log(`📍 Destí Portada: ${fullPath}`);

                const res = await renderLogic.exportSnapshot(fullPath);

                // 🔄 RESTAURACIÓ (Unmute All)
                await tracksLogic.unmuteAll("video");

                if (res.success) {
                    log("✅ Portada exportada amb èxit.", "INFO");
                    utils.status("Portada OK", "exito");
                } else {
                    throw new Error(res.log || "Error capturant snapshot.");
                }
            } catch (e) { 
                // Fail-safe: Assegurar-nos que les pistes tornen a estar visibles
                if (window.FASTPASS_UI.Logic.Tracks) window.FASTPASS_UI.Logic.Tracks.unmuteAll("video");
                utils.handleError(e, "RenderPortada"); 
            }
        }
    };

    window.FASTPASS_UI = FASTPASS_UI;
})();