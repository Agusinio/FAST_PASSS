/**
 * ============================================================================
 * LOGIC: FFmpeg (Motor de renderizado de apoyo) - v1.1.0
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
         * waitForFile: Fa polling fins que el fitxer de sortida existeix al disc.
         * Retorna una Promise que es resol quan l'arxiu existeix, o rebutja si s'exhaureix el temps.
         *
         * @param {string} filePath    - Ruta del fitxer a esperar
         * @param {number} intervalMs  - Freqüència de comprovació en ms (default: 1000)
         * @param {number} timeoutMs   - Temps màxim d'espera en ms (default: 180000 = 3 min)
         */
        waitForFile: function(filePath, intervalMs, timeoutMs) {
            intervalMs = intervalMs || 1000;
            timeoutMs  = timeoutMs  || 180000;

            return new Promise((resolve, reject) => {
                const startTime = Date.now();
                utils.log(`⏳ Esperant fitxer: ${filePath}`);

                const checkInterval = setInterval(async () => {
                    // Comprovació via pont JSX (IO.exists és síncron al motor ExtendScript)
                    const safeFile = JSON.stringify(filePath);
                    const exists = await utils.callJSX(`IO.exists(${safeFile})`);

                    if (exists === "true") {
                        clearInterval(checkInterval);
                        utils.log(`✅ Fitxer detectat: ${filePath}`);
                        resolve(filePath);
                    } else if (Date.now() - startTime >= timeoutMs) {
                        clearInterval(checkInterval);
                        const msg = `ERR_TIMEOUT: El fitxer no s'ha generat en ${timeoutMs / 1000}s → ${filePath}`;
                        utils.log(`❌ ${msg}`);
                        reject(new Error(msg));
                    }
                }, intervalMs);
            });
        },

        /**
         * runCommand: Executa un comando genèric de FFmpeg.
         * Retorna "OK_EXECUTING" un cop el procés ha estat llançat (no espera finalització).
         *
         * @param {string} args - Arguments del comando FFmpeg
         */
        runCommand: async function(args) {
            const extRoot = await utils.getExtPath();
            const ffmpegBin = `${extRoot}/bin/ffmpeg.exe`.replace(/\//g, "\\");

            const fullCommand = `"${ffmpegBin}" ${args}`;
            utils.log(`🎬 Executant FFmpeg: ${fullCommand}`);

            // JSON.stringify per a un escapat segur de cometes i barres
            const safeCommand = JSON.stringify(fullCommand);
            return await utils.callJSX(`IO.executeShell(${safeCommand})`);
        },

        /**
         * reverse: Inverteix un clip i l'importa al projecte un cop generat.
         *
         * @param {string} inputPath    - Ruta del clip original
         * @param {string} [outputPath] - Ruta de sortida opcional (default: mateixa carpeta del projecte)
         * @param {string} [binName]    - Nom del bin on importar (default: "FFmpeg")
         */
        reverse: async function(inputPath, outputPath, binName) {
            if (!inputPath) return "ERR_NO_INPUT";

            if (!outputPath) {
                const projectFolder = await utils.getProjectPath();
                const fileName = inputPath.split(/[\\\/]/).pop();
                const baseName = fileName.substring(0, fileName.lastIndexOf('.'));
                outputPath = `${projectFolder}\\${baseName}_REV.mp4`;
            }

            utils.log(`🔄 Iniciant inversió: ${inputPath}`);
            const args = `-i "${inputPath}" -vf "reverse" -af "areverse" -y "${outputPath}"`;

            const launchResult = await this.runCommand(args);
            if (launchResult.indexOf("ERR") !== -1) return launchResult;

            // Esperar que FFmpeg acabi i importar el resultat
            try {
                await this.waitForFile(outputPath);
                return await this._importResult(outputPath, binName || "FFmpeg");
            } catch (e) {
                return e.message;
            }
        },

        /**
         * createProxy: Genera un proxy H264 a 720p i l'importa al projecte.
         *
         * @param {string} inputPath - Ruta del clip original
         * @param {string} [binName] - Nom del bin on importar (default: "PROXIES")
         */
        createProxy: async function(inputPath, binName) {
            const projectFolder = await utils.getProjectPath();
            const fileName = inputPath.split(/[\\\/]/).pop();
            const outputPath = `${projectFolder}\\PROXY_${fileName}`;

            utils.log(`📦 Generant proxy: ${inputPath}`);
            const args = `-i "${inputPath}" -c:v libx264 -preset ultrafast -crf 28 -vf scale=1280:-1 -c:a copy -y "${outputPath}"`;

            const launchResult = await this.runCommand(args);
            if (launchResult.indexOf("ERR") !== -1) return launchResult;

            try {
                await this.waitForFile(outputPath);
                return await this._importResult(outputPath, binName || "PROXIES");
            } catch (e) {
                return e.message;
            }
        },

        /**
         * _importResult: Importa un fitxer al projecte de Premiere dins un bin específic.
         * Mètode intern usat per reverse i createProxy.
         *
         * @param {string} filePath - Ruta del fitxer a importar
         * @param {string} binName  - Nom del bin de destinació
         */
        _importResult: async function(filePath, binName) {
            utils.log(`📥 Important a Premiere (bin: ${binName}): ${filePath}`);

            // 1. Assegurar que el bin existeix
            const safeBin = JSON.stringify(binName);
            await utils.callJSX(`Project.bin(${safeBin})`);

            // 2. Importar el fitxer (importFiles espera un JSON array de rutes)
            const safePathsArr = JSON.stringify(JSON.stringify([filePath]));
            const importResult = await utils.callJSX(`IO.importFiles(${safePathsArr}, ${safeBin})`);

            if (importResult === "OK") {
                utils.log(`✅ Importació completada a bin "${binName}"`);
            } else {
                utils.log(`⚠️ Resultat importació: ${importResult}`);
            }
            return importResult;
        }
    };

    // Àlies global
    window.FFmpeg = FASTPASS_UI.Logic.FFmpeg;
    window.FASTPASS_UI = FASTPASS_UI;
})();
