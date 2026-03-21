/*
 * =================================================================================
 * PROJECTE: FAST >>> PASS
 * ARXIU: flow_render.js (WORKFLOW: EXPORTACIÓ)
 * =================================================================================
 */

(function () {
    window.FASTPASS_UI = window.FASTPASS_UI || {};
    const FASTPASS_UI = window.FASTPASS_UI || {};
    FASTPASS_UI.Workflows = FASTPASS_UI.Workflows || {};
    const utils = FASTPASS_UI.Utils;

    FASTPASS_UI.Workflows.Render = {

        /**
         * Envia la seqüència activa a Adobe Media Encoder per renderitzar el vídeo.
         */
        runVideo: async function () {
            utils.log("Botó 'RENDER VIDEO' clicat.", "DEBUG");
            const config = FASTPASS_UI.Config.get();

            try {
                // 1. Validar Ruta de sortida
                let outputDir = FASTPASS_UI.State.projectFolderPath;
                if (!outputDir) {
                    outputDir = await utils.callJSX("jsx_getProjectFolder()");
                    if (!outputDir) outputDir = config.export.video1 || "C:\\Users\\Public";
                }

                utils.status("Enviant a AME...", "procesando");

                // 2. Generar Nom del Fitxer
                const seqName = await utils.callJSX('jsx_getActiveSequenceName()');
                // Format seqName: Prog_Bloque_Tema -> Render: Prog_Tema_HH_MM
                const parts = seqName.split("_");
                const prog = parts[0] || "PROG";
                const tema = parts.slice(2).join("_") || "TEMA";

                const now = new Date();
                const hh_mm = ("0" + now.getHours()).slice(-2) + "_" + ("0" + now.getMinutes()).slice(-2);
                const fileName = `${prog}_${tema}_${hh_mm}.mp4`;

                // 3. Preset (.epr)
                const extPath = FASTPASS_UI.csInterface.getSystemPath(SystemPath.EXTENSION);
                const presetPath = extPath + "/presets/H264_2Pass_Vertical.epr";
                const presetSafe = presetPath.replace(/\\/g, '\\\\');

                utils.log(`🚀 Renderitzant: ${fileName}`, "INFO");

                // 4. Execució del Render via Logic
                const res = await FASTPASS_UI.Logic.Render.queueRender(presetSafe, outputDir, fileName);

                if (res.indexOf("OK") === 0) {
                    utils.status(`Render: ${fileName}`, "exito");
                    utils.log("✅ Enviat correctament a Adobe Media Encoder.", "INFO");
                    // Guardem l'últim nom per a la portada
                    FASTPASS_UI.State.lastRenderName = fileName.replace(".mp4", "");
                } else {
                    throw new Error("No s'ha pogut iniciar AME: " + res);
                }

            } catch (e) {
                utils.handleError(e, "RenderVideo");
            } finally {
                utils.setBusy(false);
            }
        },

        /**
         * Exporta un snapshot (PNG) del frame actual com a portada.
         */
        runPortada: async function () {
            utils.log("Botó 'PORTADA' clicat.", "DEBUG");
            try {
                const config = FASTPASS_UI.Config.get();
                if (!config.export.portada) {
                    utils.status("Configura ruta portada!", "error");
                    utils.setBusy(false);
                    return;
                }

                let nameBase = FASTPASS_UI.State.lastRenderName;
                if (!nameBase) {
                    const seqName = await utils.callJSX('jsx_getActiveSequenceName()');
                    const parts = seqName.split("_");
                    const prog = parts[0] || "PROG";
                    const tema = parts.slice(2).join("_") || "TEMA";
                    const now = new Date();
                    const hh_mm = ("0" + now.getHours()).slice(-2) + "_" + ("0" + now.getMinutes()).slice(-2);
                    nameBase = `${prog}_${tema}_${hh_mm}`;
                }

                const name = `${nameBase}.png`;
                const fullPath = `${config.export.portada}\\${name}`;

                utils.log(`📸 Exportant portada orquestrada a: ${fullPath}`, "INFO");
                const res = await FASTPASS_UI.Logic.Render.exportSnapshot(fullPath);

                if (res.success) {
                    utils.log("✅ Portada generada amb èxit via JS Logic.", "INFO");
                    utils.status("Portada OK", "exito");
                } else {
                    throw new Error(res.log || "Error desconegut en la captura de portada.");
                }
            } catch (e) {
                utils.handleError(e, "RenderPortada");
            } finally {
                utils.setBusy(false);
            }
        }
    };

    window.FASTPASS_UI = FASTPASS_UI;
})();