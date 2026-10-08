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
    // Candidats provats en ordre: Dalet (equips d'edició), E:\ffmpeg (equips de
    // desenvolupament), OpenVideoDownloader. La primera que existeixi s'usa.
    const FFMPEG_CANDIDATES = [
        "C:\\Program Files\\Dalet\\DaletPlus.409526\\bin\\ffmpeg.exe",
        "E:\\ffmpeg\\bin\\ffmpeg.exe",
        "C:\\Program Files (x86)\\OpenVideoDownloader\\open-video-downloader\\ffmpeg.exe"
    ];
    const FFPROBE_CANDIDATES = [
        "C:\\Program Files\\Dalet\\DaletPlus.409526\\bin\\ffprobe.exe",
        "E:\\ffmpeg\\bin\\ffprobe.exe",
        "C:\\Program Files (x86)\\OpenVideoDownloader\\open-video-downloader\\ffprobe.exe"
    ];

    /**
     * _firstExisting: retorna el primer candidat que existeixi al disc
     * (via cep.fs.stat). Si cap existeix, retorna el primer candidat.
     */
    function _firstExisting(candidates) {
        try {
            var fs = window.cep && window.cep.fs;
            if (fs && fs.stat) {
                for (var i = 0; i < candidates.length; i++) {
                    var st = fs.stat(candidates[i]);
                    if (st && st.err === 0) return candidates[i];
                }
            }
        } catch(e) {}
        return candidates[0] || "";
    }

    /**
     * _parseKeyframePts: extreu el PTS del darrer keyframe de VÍDEO <= sec d'una sortida
     * ffprobe en format csv (`pts_time,flags`, p.ex. "782.240000,K__"). Retorna null si
     * no n'hi ha cap.
     */
    function _parseKeyframePts(raw, sec) {
        var limit = Number(sec) + 0.02;
        var best = null;
        var lines = String(raw || '').split(/\r?\n/);
        for (var i = 0; i < lines.length; i++) {
            var parts = lines[i].split(',');
            if (parts.length < 2) continue;
            if (parts[1].indexOf('K') === -1) continue;
            var t = parseFloat(parts[0]);
            if (!isFinite(t)) continue;
            if (t <= limit && (best === null || t > best)) best = t;
        }
        return best;
    }
    /**
     * getFfmpeg / getFfprobe: resolen el binari preferentment des de la carpeta
     * de l'extensió (bin\ffmpeg\bin\... → no es pusheja, ve amb la instal·lació)
     * i, si no hi és, proven rutes absolutes conegudes per màquina.
     */
    async function getFfmpeg() {
        var candidates = [];
        try {
            var extRoot = await utils.getExtPath();
            if (extRoot) {
                var rootWin = extRoot.replace(/\//g, "\\");
                candidates.push(rootWin + "\\bin\\ffmpeg\\bin\\ffmpeg.exe");
                candidates.push(rootWin + "\\bin\\ffmpeg\\ffmpeg.exe");
            }
        } catch(e) {}
        return _firstExisting(candidates.concat(FFMPEG_CANDIDATES));
    }
    async function getFfprobe() {
        var candidates = [];
        try {
            var extRoot = await utils.getExtPath();
            if (extRoot) {
                var rootWin = extRoot.replace(/\//g, "\\");
                candidates.push(rootWin + "\\bin\\ffmpeg\\bin\\ffprobe.exe");
                candidates.push(rootWin + "\\bin\\ffmpeg\\ffprobe.exe");
            }
        } catch(e) {}
        return _firstExisting(candidates.concat(FFPROBE_CANDIDATES));
    }

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
                    } else if (content && content.trim().indexOf("FAIL") === 0) {
                        // (2026-09-22) Els .ps1 generats escriuen FAIL(...) quan la comanda falla:
                        // no cal esperar el timeout de 3 min (abans el flux semblava "penjat").
                        clearInterval(checkInterval);
                        const msg = `ERR_CMD: ${content.trim()} → ${filePath}`;
                        utils.log(`❌ ${msg}`);
                        reject(new Error(msg));
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
            // (2026-09-22) ABANS s'usava `IO.stat`, que NO està exposat pel bridge JSX:
            // cada crida llançava "ERR:IO.stat is not a function" i responia SEMPRE
            // "no existeix" → els fitxers ja generats no es reutilitzaven mai.
            // Ara s'usa l'àtom existent `IO.listFolder` (scanDirectory → [{name,path,size}])
            // i es comprova nom + mida > 0.
            const win = String(clipPath).replace(/\//g, '\\');
            const cut = win.lastIndexOf('\\');
            if (cut <= 0) return false;
            const dir = win.substring(0, cut);
            const wantName = win.substring(cut + 1).toLowerCase();

            let listRaw = '';
            try { listRaw = await utils.callJSX(`IO.listFolder(${JSON.stringify(dir)})`); } catch (eL) { listRaw = ''; }
            try {
                const list = JSON.parse(listRaw) || [];
                for (const f of list) {
                    if (String(f.name || '').toLowerCase() === wantName) {
                        const size = (typeof f.size === 'number') ? f.size : parseInt(f.size || '0', 10) || 0;
                        const exists = size > 0;
                        utils.log(`🔍 [checkClipExists] ${wantName} → ${exists ? "EXISTEIX (size=" + size + " bytes)" : "EXISTEIX però buit (0 bytes)"}`);
                        return exists;
                    }
                }
                utils.log(`🔍 [checkClipExists] ${wantName} → NO EXISTEIX a ${dir}`);
                return false;
            } catch (e) {
                utils.log(`🔍 [checkClipExists] ${wantName} → NO EXISTEIX (listFolder: ${String(listRaw).substring(0, 80)})`);
                return false;
            }
        },

        /**
         * getMediaDuration: Durada REAL d'un fitxer de vídeo (ffprobe), en segons.
         *
         * ⚠️ (2026-09-30) PER QUÈ CAL: `cleanFeed.mediaStop` / `mediaDuration` del JSON
         * d'escaleta és un SNAPSHOT del moment de publicació — diu fins on havia arribat la
         * ingesta ALEES, no la durada del fitxer. Si el projecte es crea més tard (o en
         * diferit), el MP4 ja conté molt més material i el snapshot queda curt → falsa
         * guarda "CleanFeed en ingesta" i fals fallback al MP4 del bloc.
         * Cas real (TNM V4, 29/09/2026): el JSON deia 33:40 (15:00:40) i el fitxer durava
         * 68:00 (fins 15:35:21) → el bloc (offset 2123 s) hi era de ple, però el sistema el
         * va donar per "no ingerit" i va importar un MP4 de verticalització PREMATUR
         * (escrit 15:00:51) amb material d'un altre bloc.
         *
         * Mecanisme: mateix patró que keyframeAtOrBefore (IO.executeShell + redirect a fitxer
         * temporal + polling del CONTINGUT fins estabilitzar-se). NO s'usa waitForFile perquè
         * espera que IO.readTxt retorni literalment "OK" i l'eixida de ffprobe és un número.
         *
         * @param {string} sourcePath - Ruta del MP4 (UNC o local)
         * @returns {Promise<{ok:boolean, duration:number, error:string|null}>}
         */
        getMediaDuration: async function(sourcePath) {
            if (!sourcePath) return { ok: false, duration: 0, error: 'sourcePath buit' };
            try {
                const ffprobeBin = await getFfprobe();
                const tempOut = `C:\\temp\\ffprobe_dur_${Date.now()}.txt`;
                const safeTemp = tempOut.replace(/\\/g, '\\\\');
                const cmd = `"${ffprobeBin}" -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${sourcePath}" > "${tempOut}" 2>&1`;
                utils.log(`📏 [duration] ffprobe: ${String(sourcePath).split(/[\\/]/).pop()}`);
                await utils.callJSX(`IO.executeShell(${JSON.stringify(cmd)})`);

                // Polling del CONTINGUT (el redirect crea el fitxer buit de seguida).
                // Només s'accepta una línia que sigui EXACTAMENT un número: si ffprobe ha
                // fallat (p.ex. "No such file"), el nom del fitxer conté dígits i un regex
                // laxo tornaria una "durada" absurda.
                let raw = '';
                let dur = 0;
                let _prevLen = -1;
                let _stable = 0;
                for (let i = 0; i < 25; i++) {
                    await new Promise(r => setTimeout(r, 400));
                    let chunk = '';
                    try { chunk = await utils.callJSX(`IO.readTxt('${safeTemp}')`); } catch (eR) { chunk = ''; }
                    if (chunk && chunk.length > raw.length) raw = chunk;
                    const lines = String(raw).split(/\r?\n/);
                    for (let j = 0; j < lines.length; j++) {
                        const s = lines[j].trim();
                        if (/^\d+(\.\d+)?$/.test(s)) {
                            const v = parseFloat(s);
                            if (isFinite(v) && v > 0 && v < 43200) dur = v;   // < 12 h (sanity)
                        }
                    }
                    if (dur > 0) {
                        if (raw.length === _prevLen) { _stable++; } else { _stable = 0; }
                        _prevLen = raw.length;
                        if (_stable >= 2) break;
                    }
                }
                try { await utils.callJSX(`IO.remove('${safeTemp}')`); } catch (eRm) { }

                if (!(dur > 0)) {
                    utils.log(`⚠️ [duration] Sense durada a "${String(raw).substring(0, 120)}" → ${String(sourcePath).split(/[\\/]/).pop()}`);
                    return { ok: false, duration: 0, error: `ffprobe sense durada: "${String(raw).substring(0, 120)}"` };
                }
                utils.log(`📏 [duration] ${String(sourcePath).split(/[\\/]/).pop()} → ${dur.toFixed(2)}s`);
                return { ok: true, duration: dur, error: null };
            } catch (e) {
                utils.log(`⚠️ [duration] ffprobe ha fallat: ${e.message}`);
                return { ok: false, duration: 0, error: e.message };
            }
        },

        /**
         * checkSourceDuration: Comprova si el MP4 original té durada suficient
         * per cobrir el segment requerit (requiredEndSec + handles).
         *
         * ⚠️ (2026-09-30) NO usar per MESURAR durades: fa servir `waitForFile`, que espera
         * que IO.readTxt retorni literalment "OK" — i l'eixida de ffprobe és un número
         * ("4080.02") → cada crida acabava en ERR_TIMEOUT de 5 s i retornava sempre el
         * "fallback suficient" cec (això és el que es va documentar com a "poc fiable").
         * Per a durades reals, usar getMediaDuration().
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

            const ffprobeBin = await getFfprobe();

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
         * keyframeAtOrBefore: Retorna el PTS del darrer keyframe de VÍDEO <= sec del fitxer
         * FONT, mesurat amb ffprobe. Fa EXPLÍCITA la conversió source→fitxer de l'extracció:
         *
         *   `ffmpeg -ss X -i src -c copy` NO pot tallar fora de keyframe: arrenca al keyframe
         *   ANTERIOR i, com que amb -c copy no es descarta el pre-roll, el 0 del fitxer extret
         *   ≠ X. MESURAT a TNC V3 (2026-09-25, cleanfeed Dalet, GOP 1 s):
         *     -ss 783  →  el fitxer arrenca a 782.187 s del source (keyframe 782.24)
         *     → 0,81 s d'error sistemàtic a TOTS els marcadors (el manifest creia 50283 i la
         *       base real era 50282.19).
         *
         * Per això l'extracció usa AQUEST valor com a -ss: llavors sí que "0 del fitxer == -ss"
         * i el pre-roll (X − kf) es compta explícitament (fileIn = handle + preRoll).
         *
         * @param {string} sourcePath  - Ruta del MP4 font
         * @param {number} sec         - Posició desitjada (segons)
         * @param {number} [fallbackSec] - Valor a retornar si ffprobe falla (per defecte: sec)
         * @returns {Promise<{kf:number, requested:number, preRoll:number, ok:boolean}>}
         */
        keyframeAtOrBefore: async function(sourcePath, sec, fallbackSec) {
            const requested = Number(sec);
            const fb = (fallbackSec !== undefined && fallbackSec !== null && isFinite(Number(fallbackSec)))
                ? Number(fallbackSec) : requested;
            const fail = { kf: fb, requested: requested, preRoll: 0, ok: false };
            if (!sourcePath || !isFinite(requested) || requested <= 0.5) return fail;

            try {
                const ffprobeBin = await getFfprobe();
                const from = Math.max(0, requested - 6);
                const tempOut = `C:\\temp\\ffprobe_kf_${Date.now()}.txt`;
                const safeTemp = tempOut.replace(/\\/g, '\\\\');
                // Només 12 s de paquets al voltant de la posició → lectura ràpida fins i tot en UNC.
                const cmd = `"${ffprobeBin}" -v error -select_streams v:0 -show_entries packet=pts_time,flags -of csv=p=0 -read_intervals "${from}%+12" "${sourcePath}" > "${tempOut}" 2>&1`;
                utils.log(`🔑 [keyframe] ffprobe: ${from.toFixed(2)}s..${(from + 12).toFixed(2)}s de ${String(sourcePath).split(/[\\/]/).pop()}`);
                await utils.callJSX(`IO.executeShell(${JSON.stringify(cmd)})`);

                // ⚠️ (2026-09-25d) El redirect crea el fitxer BUID de seguida: esperar IO.exists i
                // llegir 400 ms després donava contingut incomplet → "Sense keyframe <= 783s" i
                // extracció SENSE snap (log TNC V3 15:42:21 ✗). Ara es fa polling del CONTINGUT
                // fins que apareix una línia de keyframe (o ~12 s), quedant-se sempre amb la
                // lectura MÉS LLARGA. Un keyframe més antic del demanat també és vàlid (el
                // pre-roll augmenta i la geometria continua exacta).
                let raw = '';
                let kf = null;
                let _stable = 0;
                let _prevLen = -1;
                for (let i = 0; i < 30; i++) {
                    await new Promise(r => setTimeout(r, 400));
                    let chunk = '';
                    try { chunk = await utils.callJSX(`IO.readTxt('${safeTemp}')`); } catch (eR) { chunk = ''; }
                    if (chunk && chunk.length > raw.length) raw = chunk;
                    kf = _parseKeyframePts(raw, requested);
                    // Sortida: (a) keyframe prou a prop del demanat (≤2 s abans), o (b) l'eixida
                    // ha deixat de créixer (ffprobe ha acabat) i ja tenim algun keyframe.
                    if (kf !== null && (requested - kf) <= 2.0) break;
                    if (raw.length === _prevLen) { _stable++; } else { _stable = 0; }
                    _prevLen = raw.length;
                    if (kf !== null && _stable >= 2) break;
                }
                try { await utils.callJSX(`IO.remove('${safeTemp}')`); } catch (eRm) { }
                if (kf === null) {
                    utils.log(`⚠️ [keyframe] Sense keyframe <= ${requested.toFixed(3)}s a la finestra → es manté -ss=${fb.toFixed(3)}s`);
                    return fail;
                }
                const preRoll = Math.max(0, requested - kf);
                utils.log(`🔑 [keyframe] -ss demanat=${requested.toFixed(3)}s → keyframe=${kf.toFixed(3)}s (pre-roll=${preRoll.toFixed(3)}s) OK`);
                return { kf: kf, requested: requested, preRoll: preRoll, ok: true };
            } catch (e) {
                utils.log(`⚠️ [keyframe] ffprobe ha fallat (${e.message}) → es manté -ss=${fb.toFixed(3)}s (sense snap)`);
                return fail;
            }
        },

        /**
         * extractRoiSeries: extreu la sèrie de mostres del ROI del rètol TITOLET en
         * rgb24 cru (un sol .raw = frames encadenats) per comptar-hi la cobertura de
         * color des de JS (17_TitoletDetect_Logic.js). ZERO lògica aquí: només ffmpeg.
         *
         * -ss ABANS de -i = seek d'ENTRADA. 🔴 (2026-10-06, 3a passada) MESURAT amb el
         * clip real (TNM_V1_CLIP.mp4 251,8 MB, 1080p25, 257 s): amb `-ss` DESPRÉS de `-i`
         * ffmpeg DECODIFICA des de 0 fins a l'instant demanat i el cost creix amb t
         * (2,66 s a t=27,76 · 11,84 s a 142,76 · 12,93 s a 160,76) → 33 captures = 5 min.
         * Amb `-ss` ABANS de `-i` el mateix frame costa 0,25-0,33 s (🟰 45× més ràpid) i
         * el PNG resultant és BYTE A BYTE IDÈNTIC (md5 igual a t = 74/75/76 i 27/142/160).
         *
         * @param {string} sourcePath - MP4 (cleanFeed)
         * @param {Object} o - { tStart, tDur, roiY:[a,b], roiX:[a,b], w, h, fps, outPath }
         * @returns {Promise<{ok:boolean, path:string, w:number, h:number, fps:number, error?:string}>}
         */
        extractRoiSeries: async function (sourcePath, o) {
            const opts = o || {};
            const outPath = opts.outPath || ('C:\\temp\\titolet_roi_' + Date.now() + '.raw');
            const w = opts.w || 160, h = opts.h || 45;
            const fps = opts.fps || 1;
            const rY = opts.roiY || [0.60, 0.85];
            const y0 = rY[0], yH = Math.max(0.01, rY[1] - rY[0]);
            // (2026-10-08, 7a passada) `opts.roiX` = [x0, x1] en fracció de l'amplada (null =
            // tot l'ample) amb la MATEIXA normalització que `extractFramePng`: cada ETIQUETA de
            // grafisme cremat (TITOLET · PREGUNTA · CARTELL…) té la seva zona i l'ítem es
            // rastreja amb la de les seves etiquetes. Amb [0, 1] la retallada és IDÈNTICA a la
            // d'abans (mateix .raw: mateixa àrea, mateixa escala).
            const rX = opts.roiX || null;
            let x0 = 0, xW = 1;
            if (rX && rX.length === 2) {
                x0 = Math.max(0, Math.min(0.98, Number(rX[0]) || 0));
                xW = Math.max(0.05, Math.min(1 - x0, (Number(rX[1]) || 1) - x0));
            }
            try {
                if (!sourcePath) return { ok: false, path: outPath, error: 'sourcePath buit' };
                const ffmpegBin = await getFfmpeg();
                const timestamp = Date.now();
                const psFile = 'C:\\temp\\titolet_scan_' + timestamp + '.ps1';
                const doneFile = 'C:\\temp\\titolet_scan_' + timestamp + '_done.txt';
                const vf = 'crop=iw*' + xW.toFixed(4) + ':ih*' + yH.toFixed(4) +
                    ':iw*' + x0.toFixed(4) + ':ih*' + y0.toFixed(4) +
                    ',scale=' + w + ':' + h + ':flags=area,fps=' + fps;
                let psContent = '& "' + ffmpegBin + '" -ss ' + (opts.tStart || 0) +
                    ' -t ' + opts.tDur + ' -i "' + sourcePath + '" -vf "' + vf +
                    '" -pix_fmt rgb24 -f rawvideo -an -y "' + outPath + '"\r\n';
                psContent += 'if (Test-Path "' + outPath + '") { Write-Output "OK" > "' + doneFile +
                    '" } else { Write-Output "FAIL:exit=$LASTEXITCODE" > "' + doneFile + '" }\r\n';

                const cepFs = window.cep.fs;
                if (!cepFs || !cepFs.writeFile) return { ok: false, path: outPath, error: 'cep.fs.writeFile no disponible' };
                cepFs.writeFile(psFile, '\uFEFF' + psContent);
                utils.log('🎯 [titolet] Escanejant ROI del cleanFeed (' + fps + ' fps, ' + w + 'x' + h +
                    ', x ' + x0 + '-' + (x0 + xW) + ', y ' + y0 + '-' + rY[1] + ') des de ' + (opts.tStart || 0) + 's…');
                const psCmd = 'powershell -NoProfile -ExecutionPolicy Bypass -File "' + psFile + '"';
                await utils.callJSX('IO.executeShell(' + JSON.stringify(psCmd) + ')');
                await this.waitForFile(doneFile, 1000, 900000);
                await utils.callJSX('IO.remove(' + JSON.stringify(doneFile) + ')').catch(() => { });
                await utils.callJSX('IO.remove(' + JSON.stringify(psFile) + ')').catch(() => { });
                return { ok: true, path: outPath, w: w, h: h, fps: fps, error: null };
            } catch (e) {
                utils.log('❌ [titolet] extractRoiSeries: ' + e.message);
                return { ok: false, path: outPath, w: w, h: h, fps: fps, error: e.message };
            }
        },

        /**
         * extractFramePng: captura UN frame del MP4 retallat a la ROI del rètol (PNG
         * a mida nativa) per passar-lo a l'OCR (`bin\ocr.ps1`).
         *
         * 🔴 (2026-10-06, 3a passada) `-ss` ABANS de `-i`: amb el seek a la sortida
         * cada captura decodificava el MP4 des de 0 (2,7 s a t=28 · 12,9 s a t=161 i
         * creixent) i 33 captures es menjaven 5 minuts. Amb el seek a l'entrada:
         * 0,25-0,33 s i el MATEIX frame (md5 idèntic, mesurat).
         * `opts.roiX` = [x0, x1] en fracció de l'amplada (null = tot l'ample) per no
         * llegir text aliè que hi hagi al costat del rètol.
         * @param {string} sourcePath - MP4 (cleanFeed)
         * @param {number} tSec - Segon del MP4 a capturar
         * @param {string} outPath - PNG de sortida
         * @param {Object} [o] - { roiY:[a,b], roiX:[a,b] }
         */
        extractFramePng: async function (sourcePath, tSec, outPath, o) {
            const opts = o || {};
            const rY = opts.roiY || [0.60, 0.85];
            const y0 = rY[0], yH = Math.max(0.01, rY[1] - rY[0]);
            const rX = opts.roiX || null;
            let x0 = 0, xW = 1;
            if (rX && rX.length === 2) {
                x0 = Math.max(0, Math.min(0.98, Number(rX[0]) || 0));
                xW = Math.max(0.05, Math.min(1 - x0, (Number(rX[1]) || 1) - x0));
            }
            try {
                if (!sourcePath || !outPath) return { ok: false, path: outPath, error: 'ruta buida' };
                const ffmpegBin = await getFfmpeg();
                const timestamp = Date.now();
                const psFile = 'C:\\temp\\titolet_png_' + timestamp + '.ps1';
                const doneFile = 'C:\\temp\\titolet_png_' + timestamp + '_done.txt';
                const vf = 'crop=iw*' + xW.toFixed(4) + ':ih*' + yH.toFixed(4) +
                    ':iw*' + x0.toFixed(4) + ':ih*' + y0.toFixed(4);
                let psContent = '& "' + ffmpegBin + '" -ss ' + Number(tSec).toFixed(3) +
                    ' -i "' + sourcePath + '" -frames:v 1 -vf "' + vf + '" -y "' + outPath + '"\r\n';
                psContent += 'if (Test-Path "' + outPath + '") { Write-Output "OK" > "' + doneFile +
                    '" } else { Write-Output "FAIL:exit=$LASTEXITCODE" > "' + doneFile + '" }\r\n';

                const cepFs = window.cep.fs;
                if (!cepFs || !cepFs.writeFile) return { ok: false, path: outPath, error: 'cep.fs.writeFile no disponible' };
                cepFs.writeFile(psFile, '\uFEFF' + psContent);
                const psCmd = 'powershell -NoProfile -ExecutionPolicy Bypass -File "' + psFile + '"';
                await utils.callJSX('IO.executeShell(' + JSON.stringify(psCmd) + ')');
                await this.waitForFile(doneFile, 500, 120000);
                await utils.callJSX('IO.remove(' + JSON.stringify(doneFile) + ')').catch(() => { });
                await utils.callJSX('IO.remove(' + JSON.stringify(psFile) + ')').catch(() => { });
                return { ok: true, path: outPath, error: null };
            } catch (e) {
                utils.log('❌ [titolet] extractFramePng: ' + e.message);
                return { ok: false, path: outPath, error: e.message };
            }
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

            const ffmpegBin = await getFfmpeg();
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
            const ffmpegBin = await getFfmpeg();

            const fullCommand = `"${ffmpegBin}" ${args}`;
            utils.log(`🎬 Executant FFmpeg: ${fullCommand}`);

            // JSON.stringify per a un escapat segur de cometes i barres
            const safeCommand = JSON.stringify(fullCommand);
            return await utils.callJSX(`IO.executeShell(${safeCommand})`);
        },

        /**
         * reverse: Inverteix un clip (marxa enrere) i l'importa al projecte.
         *
         * ⚠️ (2026-09-21) REESCRIT per al TEMA-TÍTOL PETIT ("titulillo"):
         *   - L'original llançava ffmpeg amb runCommand + waitForFile, però `waitForFile` espera
         *     que IO.readTxt retorni exactament "OK" (només funciona amb fitxers de TEXT) → amb
         *     un .mov no acabava mai. Ara s'usa el patró fiable d'extractClip: .ps1 + .done.
         *   - PRESERVA L'ALPHA: els wotts de Tema-Títol són qtrle/argb (QuickTime amb canal
         *     alfa); amb .mp4/h264 la transparència es perd. Sortida: .mov qtrle argb.
         *   - Si la sortida ja existeix, es REUTILITZA (no es torna a renderitzar).
         *
         * @param {string} inputPath    - Clip original (preferentment .mov amb alpha)
         * @param {string} [outputPath] - Sortida (per defecte: carpeta del projecte + "_REV.mov")
         * @param {string} [binName]    - Bin d'importació (per defecte "CHY")
         * @returns {Promise<{ok:boolean, path:string, name:string, error:(string|null)}>}
         */
        reverse: async function(inputPath, outputPath, binName) {
            const bin = binName || 'CHY';
            if (!inputPath) return { ok: false, path: '', name: '', error: 'ERR_NO_INPUT' };
            try {
                const fileName = inputPath.split(/[\\\/]/).pop();
                const dot = fileName.lastIndexOf('.');
                const baseName = (dot > 0) ? fileName.substring(0, dot) : fileName;
                if (!outputPath) {
                    const projectFolder = await utils.getProjectPath();
                    outputPath = `${projectFolder}\\${baseName}_REV.mov`;
                }
                const outName = outputPath.split(/[\\\/]/).pop();

                // 1) Ja existeix? → reutilitzar (re-runs instantanis, sense tornar a esperar ffmpeg)
                let already = false;
                try { already = await this.checkClipExists(outputPath); } catch (eChk) { }
                if (already) {
                    utils.log(`♻️ [reverse] Ja existeix, es reutilitza: ${outName}`);
                } else {
                    const ffmpegBin = await getFfmpeg();
                    const timestamp = Date.now();
                    const psFile = `C:\\temp\\reverse_${timestamp}.ps1`;
                    const doneFile = `C:\\temp\\reverse_${timestamp}_done.txt`;

                    // -vf reverse (marxa enrere) · qtrle/argb (conserva alpha) · -an (els wotts no porten so)
                    // (2026-09-22) El .ps1 s'ha d'escriure amb BOM UTF-8: PowerShell 5.1 llegeix
                    // els .ps1 sense BOM com a ANSI i corromp els accents (p.ex. "colònies" →
                    // "colÃ²nies") → ffmpeg no troba el fitxer, no genera la sortida i el flux
                    // s'esperava els 180 s del timeout (semblava "penjat"). El BOM (\uFEFF) fa
                    // que PS detecti UTF-8.
                    let psContent = `& "${ffmpegBin}" -i "${inputPath}" -vf "reverse" -c:v qtrle -pix_fmt argb -an -y "${outputPath}"\r\n`;
                    // El .done s'escriu SEMPRE (OK o FAIL): així qui espera pot abortar de seguida.
                    psContent += `if (Test-Path "${outputPath}") { Write-Output "OK" > "${doneFile}" } else { Write-Output "FAIL:exit=$LASTEXITCODE" > "${doneFile}" }\r\n`;

                    const cepFs = window.cep.fs;
                    if (!cepFs || !cepFs.writeFile) {
                        return { ok: false, path: outputPath, name: outName, error: 'cep.fs.writeFile no disponible' };
                    }
                    cepFs.writeFile(psFile, '\uFEFF' + psContent);
                    utils.log(`🔄 [reverse] Invertint clip: ${fileName} → ${outName}`);

                    const psCmd = `powershell -NoProfile -ExecutionPolicy Bypass -File "${psFile}"`;
                    await utils.callJSX(`IO.executeShell(${JSON.stringify(psCmd)})`);
                    utils.log(`⏳ [reverse] Polling .done: ${doneFile}`);
                    await this.waitForFile(doneFile, 1000, 180000);
                    await utils.callJSX(`IO.remove(${JSON.stringify(doneFile)})`).catch(() => {});
                    await utils.callJSX(`IO.remove(${JSON.stringify(psFile)})`).catch(() => {});
                    utils.log(`✅ [reverse] Clip invertit: ${outputPath}`);
                }

                // 2) Importar al projecte (bin CHY: així queda a l'abast de Clips.insert per nom)
                await this._importResult(outputPath, bin);
                return { ok: true, path: outputPath, name: outName, error: null };
            } catch (e) {
                utils.log(`❌ [reverse] ${e.message}`);
                return { ok: false, path: outputPath || '', name: '', error: e.message };
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
            // (2026-10-07 · BUG) Aquí hi havia `Project.bin(...)` SENSE el prefix `FASTPASS.`:
            // el panell llançava «ERR:Project.bin is not a function», el bin CHY no es creava i
            // l'import anava a parar al bin ARREL — tot i que la línia següent deia «Importació
            // completada». L'API real exposada al panell és `FASTPASS.Project.bin`.
            const safeBin = JSON.stringify(binName);
            const binRes = await utils.callJSX(`FASTPASS.Project.bin(${safeBin})`, { rawError: true });
            if (binRes && String(binRes).indexOf('ERR') === 0) {
                utils.log(`⚠️ [import] No s'ha pogut assegurar el bin "${binName}": ${binRes}`);
            }

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
