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

    // Path real de ffmpeg. NO està al directori bin/ de l'extensió!
    // S'ha trobat via `where ffmpeg` a C:\Program Files (x86)\OpenVideoDownloader\open-video-downloader\
    // ffmpeg a Dalet (canvi d'ordinador 29/07)
    const FFMPEG_BIN = "C:\\Program Files\\Dalet\\DaletPlus.409526\\bin\\ffmpeg.exe";
    const FFPROBE_BIN = "C:\\Program Files\\Dalet\\DaletPlus.409526\\bin\\ffprobe.exe";

    FASTPASS_UI.Logic.FFmpeg = {

        /**
         * waitForFile: Fa polling fins que el fitxer de sortida existeix al disc.
         * Retorna una Promise que es resol quan l'arxiu existeix, o rebutja si s'exhaureix el temps.
         * NOTA: No comprovem mida perquè IO.stat no existeix a ExtendScript. IO.exists pot donar
         * falsos positius en UNC, però l'ús principal és esperar fitxers locals (temp, clips extrets).
         *
         * @param {string} filePath     - Ruta del fitxer a esperar
         * @param {number} intervalMs   - Freqüència de comprovació en ms (default: 1000)
         * @param {number} timeoutMs    - Temps màxim d'espera en ms (default: 180000 = 3 min)
         */
        waitForFile: function(filePath, intervalMs, timeoutMs) {
            intervalMs = intervalMs || 1000;
            timeoutMs  = timeoutMs  || 180000;

            return new Promise((resolve, reject) => {
                const startTime = Date.now();
                utils.log(`⏳ Esperant fitxer: ${filePath} (timeout=${timeoutMs/1000}s)`);

                const checkInterval = setInterval(async () => {
                    // ⚠️ NO fem IO.exists (dona falsos positius).
                    // IO.readTxt retorna "OK" si el fitxer existeix i conté "OK",
                    // o una string d'error (ERR:...) si no existeix.
                    const safeFile = JSON.stringify(filePath);
                    const content = await utils.callJSX(`IO.readTxt(${safeFile})`);

                    if (content && content.trim() === "OK") {
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
         * checkClipExists: Verifica si un clip ja existeix al disc.
         * Usa IO.stat en lloc d'IO.exists perquè IO.exists pot donar
         * falsos positius en paths UNC (xarxa). IO.stat retorna les
         * metadades reals del fitxer o un error si no existeix.
         *
         * @param {string} clipPath - Ruta del clip a comprovar
         * @returns {Promise<boolean>} true si existeix i té mida > 0, false si no
         */
        checkClipExists: async function(clipPath) {
            if (!clipPath) {
                utils.log("⚠️ [checkClipExists] clipPath buit. Retornant false.");
                return false;
            }
            const safeFile = JSON.stringify(clipPath);
            const statResult = await utils.callJSX(`IO.stat(${safeFile})`);
            
            // IO.stat retorna JSON amb {size, modified, created} si existeix,
            // o una string d'error si no (ex: "ERR: File not found")
            try {
                const stat = JSON.parse(statResult);
                // Validar que és un objecte amb size > 0 (fitxer real, no buit)
                const exists = stat && typeof stat === 'object' && typeof stat.size === 'number' && stat.size > 0;
                utils.log(`🔍 [checkClipExists] clipPath=${clipPath} → ${exists ? "EXISTEIX (size=" + stat.size + " bytes)" : "NO EXISTEIX (stat=" + statResult + ")"}`);
                return exists;
            } catch (e) {
                // stat ha retornat error (fitxer no trobat)
                utils.log(`🔍 [checkClipExists] clipPath=${clipPath} → NO EXISTEIX (stat error: ${statResult.substring(0, 100)})`);
                return false;
            }
        },

        /**
         * checkSourceDuration: Comprova si el MP4 original té durada suficient
         * per cobrir el segment requerit (requiredEndSec + handles).
         * Usa ffprobe per obtenir la durada total del MP4.
         *
         * @param {string} sourcePath     - Ruta del MP4 original (cleanFeed)
         * @param {number} requiredEndSec - Segon final requerit (worldBlockEndSec)
         * @param {number} handles        - Marge en segons (default: 60)
         * @returns {Promise<{ok: boolean, wait: boolean, duration: number, error?: string}>}
         */
        checkSourceDuration: async function(sourcePath, requiredEndSec, handles) {
            if (!sourcePath) {
                utils.log("⚠️ [checkSourceDuration] sourcePath buit. Retornant {ok:false, wait:false}");
                return { ok: false, wait: false, duration: 0, error: "sourcePath buit" };
            }

            const ffprobeBin = FFPROBE_BIN;

            utils.log(`🔍 [checkSourceDuration] ffprobeBin=${ffprobeBin}, sourcePath=${sourcePath}, requiredEndSec=${requiredEndSec}s, handles=${handles}s`);

            // Comprovar que ffprobe existeix
            const ffprobeExists = await utils.callJSX(`IO.exists('${ffprobeBin.replace(/\\/g, '\\\\')}')`);
            if (ffprobeExists !== "true") {
                utils.log(`⚠️ [checkSourceDuration] ffprobe no trobat a ${ffprobeBin}. Retornant fallback.`);
                // Si no tenim ffprobe, assumim que el MP4 és suficient (fallback)
                return { ok: true, wait: false, duration: requiredEndSec + handles + 10, error: null };
            }

            // Executar ffprobe per obtenir durada: -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1
            const tempOut = `C:\\temp\\ffprobe_dur_${Date.now()}.txt`;
            const cmd = `"${ffprobeBin}" -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${sourcePath}" > "${tempOut}" 2>&1`;
            const safeCmd = JSON.stringify(cmd);
            utils.log(`🎬 [checkSourceDuration] Executant ffprobe: ${cmd}`);

            try {
                await utils.callJSX(`IO.executeShell(${safeCmd})`);
                // ffprobe és molt ràpid, esperar màxim 5s
                await this.waitForFile(tempOut, 200, 5000);
            } catch (e) {
                utils.log(`⚠️ [checkSourceDuration] Timeout esperant ffprobe: ${e.message}`);
                return { ok: false, wait: false, duration: 0, error: `ffprobe timeout: ${e.message}` };
            }

            // Llegir el resultat
            const safeTempOut = tempOut.replace(/\\/g, '\\\\');
            const durStr = await utils.callJSX(`IO.readTxt('${safeTempOut}')`);
            utils.log(`🔍 [checkSourceDuration] ffprobe output raw: "${durStr}"`);

            const duration = parseFloat(durStr.trim());
            if (isNaN(duration) || duration <= 0) {
                utils.log(`⚠️ [checkSourceDuration] No s'ha pogut parsejar durada: "${durStr}". Retornant fallback.`);
                return { ok: true, wait: false, duration: requiredEndSec + handles + 10, error: `ffprobe parse error: ${durStr}` };
            }

            const requiredMinDur = requiredEndSec + (handles || 60);
            const ok = duration >= requiredMinDur;
            const wait = !ok;

            utils.log(`📐 [checkSourceDuration] Durada MP4=${duration.toFixed(2)}s, requerit=${requiredMinDur.toFixed(2)}s → ${ok ? "OK" : "INSUFICIENT (wait=" + wait + ")"}`);

            // Netejar fitxer temporal
            try {
                await utils.callJSX(`IO.remove('${safeTempOut}')`);
            } catch(e) {
                // Ignorar errors de neteja
            }

            return { ok: ok, wait: wait, duration: duration, error: null };
        },

        /**
         * extractClip: Extreu un segment del MP4 original usant ffmpeg -c copy.
         * Executa bin/extract_clip.ps1 via PowerShell i espera que el fitxer es generi.
         *
         * @param {string} sourcePath  - Ruta del MP4 original (cleanFeed)
         * @param {number} startSec    - Segon d'inici de l'extracció (amb handles)
         * @param {number} duration    - Durada del segment a extreure
         * @param {string} outputPath  - Ruta on es guardarà el clip retallat
         * @returns {Promise<{ok: boolean, path: string, error?: string}>}
         */
        extractClip: async function(sourcePath, startSec, duration, outputPath) {
            if (!sourcePath || !outputPath) {
                const errMsg = "sourcePath o outputPath buit";
                utils.log(`⚠️ [extractClip] ${errMsg}`);
                return { ok: false, path: outputPath, error: errMsg };
            }

            const ffmpegBin = FFMPEG_BIN;
            utils.log(`🎬 [extractClip] INICI: ffmpeg=${ffmpegBin}, input=${sourcePath}, start=${startSec.toFixed(2)}s, dur=${duration.toFixed(2)}s, output=${outputPath}`);

            try {
                // ─── POWERSHELL INLINE: ffmpeg directe al UNC ─────────────────
                // TESTS AL TERMINAL (11:28 29/07/2026):
                //   TEST 1 ✅ PowerShell .ps1
                //   TEST 2 ✅ PowerShell inline
                //   TEST 3 ✅ ffmpeg directe al UNC via PowerShell (OK DIRECTE)
                // PowerShell gestiona Unicode (Ó) correctament, a diferència de .bat
                // =================================================================
                const timestamp = Date.now();
                const psFile = `C:\\temp\\extract_${timestamp}.ps1`;
                const doneFile = `C:\\temp\\extract_${timestamp}_done.txt`;

                // Paths: audio ref binari (bytes crus en hex, 2 hex per mostra)
                // Format: binari pur, JS pot llegir amb cep.fs.readFile
                const outputBaseName = outputPath.replace(/\.mp4$/i, '');
                const audioRefPath = `${outputBaseName}_AUDIO_REF.bin`;
                const rawTemp = `C:\\temp\\audio_ref_raw_${timestamp}.raw`;

                // .ps1: 
                // 1. ffmpeg mp4 al UNC — OUTPUT SEEKING (precis, sense keyframe alignment)
                //    -i PRIMER, després -ss. Això obliga ffmpeg a decodificar des del keyframe
                //    anterior però només ESCRIURE frames des de startSec. L'speed es redueix
                //    però la precisió del tall és exacta (±0 frames). Per 188s a 30x ≈ 6s extra.
                // 2. ffmpeg audio mono 480Hz wav (pcm_u8) DES DEL CLIP JA EXTRET (no del source!)
                //    → sincronia 1:1 amb el mp4 del timeline per construcció. Abans es generava
                //    del source amb -ss i quedava desfasat (~0,9s) pels keyframes del -c copy.
                //    480 Hz: 1 byte = 1 mostra = 1/480s exactes → waveform lleugera i directa.
                // 3. .done
                let psContent = `& "${ffmpegBin}" -ss ${startSec} -t ${duration} -i "${sourcePath}" -c copy -avoid_negative_ts make_zero -y "${outputPath}"\r\n`;
                psContent += `& "${ffmpegBin}" -i "${outputPath}" -ac 1 -ar 480 -c:a pcm_u8 -f wav "${audioRefPath}" -y\r\n`;
                psContent += `if (Test-Path "${outputPath}") { Write-Output "OK" > "${doneFile}" }\r\n`;
                
                const cepFs = window.cep.fs;
                if (!cepFs || !cepFs.writeFile) {
                    const errMsg = "cep.fs.writeFile no disponible";
                    utils.log(`❌ [extractClip] ${errMsg}`);
                    return { ok: false, path: outputPath, error: errMsg };
                }
                cepFs.writeFile(psFile, psContent);
                utils.log(`✅ [extractClip] .ps1 creat: ${psFile}`);

                // Executar .ps1 via PowerShell
                const psCmd = `powershell -NoProfile -ExecutionPolicy Bypass -File "${psFile}"`;
                const safeCmd = JSON.stringify(psCmd);
                utils.log(`🎬 [extractClip] Executant: ${psCmd}`);
                await utils.callJSX(`IO.executeShell(${safeCmd})`);
                utils.log(`⏳ [extractClip] PowerShell llançat. Polling .done: ${doneFile}`);

                // Polling .done amb IO.readTxt (FIABLE)
                try {
                    await this.waitForFile(doneFile, 2000, 300000);
                    await utils.callJSX(`IO.remove(${JSON.stringify(doneFile)})`).catch(() => {});
                    await utils.callJSX(`IO.remove(${JSON.stringify(psFile)})`).catch(() => {});
                    utils.log(`✅ [extractClip] Clip extret correctament: ${outputPath}`);
                    return { ok: true, path: outputPath, error: null };
                } catch(e) {
                    utils.log(`❌ [extractClip] Timeout .done: ${doneFile}`);
                    return { ok: false, path: outputPath, error: `Timeout extracció` };
                }
            } catch (e) {
                const errMsg = `Error en extracció: ${e.message}`;
                utils.log(`❌ [extractClip] ${errMsg}`);
                return { ok: false, path: outputPath, error: errMsg };
            }
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
