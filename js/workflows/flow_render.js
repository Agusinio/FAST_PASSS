/**
 * ============================================================================
 * WORKFLOW: RENDER (EXPORTACIÓ) - v2.6.0 literal
 * ============================================================================
 */

(function () {
    var FASTPASS_UI = window.FASTPASS_UI || {};
    FASTPASS_UI.Workflows = FASTPASS_UI.Workflows || {};

    const getUtils = () => window.FASTPASS_UI.Utils;
    const getRenderLogic = () => window.FASTPASS_UI.Logic.Render;

    const log = (m) => getUtils().log(m, "DEBUG");
    const callJSX = (s) => getUtils().callJSX(s);

    FASTPASS_UI.Workflows.Render = {

        /**
         * Envia la seqüència activa a AME.
         */
        runVideo: async function () {
            if (!(await getUtils().validateActiveSequence())) return;
            log("🚀 Preparant enviament a AME...");
            const config = FASTPASS_UI.Config.get();

            try {
                // Literal: Context.folder()
                let outputDir = await callJSX("Context.folder()");
                if (!outputDir) outputDir = config.rutas.destinoBase || "C:\\Temp";
                
                getUtils().status("Processant nom...", "procesando");

                // Literal: Context.activeSeq()
                const seqName = await callJSX('Context.activeSeq()');
                let fileName = "Export_TBD.mp4";
                
                if (seqName) {
                    const parts = seqName.split("_");
                    const prog = parts[0] || "PROG";
                    const tema = parts.slice(2).join("_") || "TEMA";
                    const now = new Date();
                    const timeStr = ("0" + now.getHours()).slice(-2) + "_" + ("0" + now.getMinutes()).slice(-2);
                    fileName = `${prog}_${tema}_${timeStr}.mp4`;
                }

                const extRoot = window.FASTPASS_UI.csInterface.getSystemPath(SystemPath.EXTENSION);
                const presetPath = `${extRoot}/presets/H264_2Pass_Vertical.epr`.replace(/\\/g, '\\\\');

                log(`📤 Destí: ${outputDir}\\${fileName}`);

                // Delegació a lògica
                const res = await getRenderLogic().queueRender(presetPath, outputDir, fileName);

                if (res && res.indexOf("OK") === 0) {
                    getUtils().status(`Render OK: ${fileName}`, "exito");
                    log("✅ Enviat a Media Encoder correctament.", "INFO");
                    FASTPASS_UI.State.lastRenderName = fileName.replace(".mp4", "");
                } else {
                    throw new Error("Error en el pont AME: " + res);
                }

            } catch (e) { getUtils().handleError(e, "RenderVideo"); }
        },

        /**
         * Exporta un PNG del frame actual (Portada).
         */
        runPortada: async function () {
            if (!(await getUtils().validateActiveSequence())) return;
            log("📸 Generant Portada (Mode Aïllat)...");
            const tracksLogic = window.FASTPASS_UI.Logic.Tracks;
            
            try {
                const config = FASTPASS_UI.Config.get();
                const targetDir = config.rutas.portadas || config.rutas.destinoBase || "C:\\Temp";
                const T_MP4 = config.tracks.video.mp4;
                const T_THEME = config.tracks.video.tematitol;

                // 🛡️ AÏLLAMENT DE PISTES
                await tracksLogic.setGlobalState("video", "mute", true);
                
                // Literals: Tracks.mute()
                await callJSX(`Tracks.mute(${T_MP4}, false, 'video')`);
                await callJSX(`Tracks.mute(${T_THEME}, false, 'video')`);

                // 📸 SNAPSHOT
                let nameBase = FASTPASS_UI.State.lastRenderName;
                if (!nameBase) {
                    const seqName = await callJSX('Context.activeSeq()');
                    nameBase = seqName ? seqName : "Portada_TBD";
                }

                const fullPath = `${targetDir}\\${nameBase}.png`;
                log(`📍 Destí Portada: ${fullPath}`);

                const res = await getRenderLogic().exportSnapshot(fullPath);

                // 🔄 RESTAURACIÓ (Unmute All)
                await tracksLogic.unmuteAll("video");

                if (res.success) {
                    log("✅ Portada exportada amb èxit.", "INFO");
                    getUtils().status("Portada OK", "exito");
                } else {
                    throw new Error(res.log || "Error capturant snapshot.");
                }
            } catch (e) { 
                if (window.FASTPASS_UI.Logic.Tracks) window.FASTPASS_UI.Logic.Tracks.unmuteAll("video");
                getUtils().handleError(e, "RenderPortada"); 
            }
        }
    };

    window.FASTPASS_UI.Workflows.Render = FASTPASS_UI.Workflows.Render;
})();