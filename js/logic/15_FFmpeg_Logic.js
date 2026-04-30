/**
 * ============================================================================
 * LOGIC: FFmpeg (Motor de renderizado de apoyo) - v1.0.0
 * ============================================================================
 */

(function() {
    var FASTPASS_UI = window.FASTPASS_UI || {};
    FASTPASS_UI.Logic = FASTPASS_UI.Logic || {};

    const utils = {
        callJSX: (s) => window.FASTPASS_UI.Utils.callJSX(s),
        log: (m) => window.FASTPASS_UI.Utils.log(m, "INFO"),
        getExtPath: async () => await window.FASTPASS_UI.Utils.callJSX("System.getExtPath()"),
        getProjectPath: async () => await window.FASTPASS_UI.Utils.callJSX("Context.folder()")
    };

    FASTPASS_UI.Logic.FFmpeg = {
        
        /**
         * runCommand: Ejecuta un comando genérico de FFmpeg.
         * @param {string} args - Los argumentos del comando (ej: "-i in.mp4 -vf reverse out.mp4")
         */
        runCommand: async function(args) {
            const extRoot = await utils.getExtPath();
            const ffmpegBin = `${extRoot}/bin/ffmpeg.exe`.replace(/\//g, "\\");
            
            const fullCommand = `"${ffmpegBin}" ${args}`;
            utils.log(`🎬 Ejecutando FFmpeg: ${fullCommand}`);
            
            return await utils.callJSX(`IO.executeShell('${fullCommand.replace(/'/g, "\\'")}')`);
        },

        /**
         * reverse: Crea una versión invertida de un clip.
         * @param {string} inputPath - Ruta completa del clip original
         * @param {string} [customOutput] - Ruta de salida opcional
         */
        reverse: async function(inputPath, customOutput) {
            if (!inputPath) return "ERR_NO_INPUT";
            
            let outputPath = customOutput;
            if (!outputPath) {
                const projectFolder = await utils.getProjectPath();
                const fileName = inputPath.split(/[\\/]/).pop();
                const baseName = fileName.substring(0, fileName.lastIndexOf('.'));
                outputPath = `${projectFolder}\\${baseName}_REV.mp4`;
            }

            utils.log(`🔄 Iniciando inversión de clip: ${inputPath}`);
            const args = `-i "${inputPath}" -vf "reverse" -af "areverse" -y "${outputPath}"`;
            
            const res = await this.runCommand(args);
            if (res.indexOf("OK") !== -1) {
                utils.log(`✅ Clip invertido guardado en: ${outputPath}`);
                return outputPath;
            }
            return res;
        },

        /**
         * proxy: Genera un proxy ligero (ProRes Proxy o H264 low-bitrate).
         */
        createProxy: async function(inputPath) {
            const projectFolder = await utils.getProjectPath();
            const fileName = inputPath.split(/[\\/]/).pop();
            const outputPath = `${projectFolder}\\PROXY_${fileName}`;
            
            const args = `-i "${inputPath}" -c:v libx264 -preset ultrafast -crf 28 -vf scale=1280:-1 -c:a copy -y "${outputPath}"`;
            return await this.runCommand(args);
        }
    };

    // Alias global
    window.FFmpeg = FASTPASS_UI.Logic.FFmpeg;
    window.FASTPASS_UI = FASTPASS_UI;
})();
