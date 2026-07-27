/**
 * ============================================================================
 * LOGIC: SUB (Subtítols) - v3.0.0
 * Funcions de parseig i processament SRT (pures, sense crides JSX)
 * ============================================================================
 * 
 * Aquest mòdul conté funcions pures per treballar amb fitxers SRT:
 * - srtToEntries: Parseja contingut SRT a array d'entrades
 * - entriesToSrt: Converteix array d'entrades a string SRT
 * - srtTimeToSec / secToSrtTime: Conversió de timings
 * - applyTrimIn / applyTrimOut / applyTimeAdjust: Processament
 * 
 * Les funcions NO fan crides JSX, només treballen amb dades.
 */

(function () {
    var FASTPASS_UI = window.FASTPASS_UI || {};
    FASTPASS_UI.Logic = FASTPASS_UI.Logic || {};

    /**
     * SrtParser: Funcions de parseig i processament SRT
     */
    FASTPASS_UI.Logic.SrtParser = {

        /**
         * srtToEntries: Converteix contingut SRT en array d'entrades.
         * Cada entrada: { index, timeStr, texts:[], startSec, endSec }
         */
        srtToEntries: function (srtContent) {
            if (!srtContent || typeof srtContent !== 'string') return [];
            var lines = srtContent.split('\n');
            var entries = [];
            var current = null;

            for (var li = 0; li < lines.length; li++) {
                var trimmed = lines[li].trim();
                if (!trimmed) {
                    if (current) { entries.push(current); current = null; }
                    continue;
                }

                var numMatch = trimmed.match(/^\d+$/);
                if (numMatch) {
                    if (current) entries.push(current);
                    current = { index: parseInt(trimmed, 10), timeStr: '', texts: [], startSec: 0, endSec: 0 };
                    continue;
                }

                var timeMatch = trimmed.match(/^(\d{2}:\d{2}:\d{2}[,\.]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[,\.]\d{3})/);
                if (timeMatch && current) {
                    current.timeStr = trimmed;
                    current.startSec = this.srtTimeToSec(timeMatch[1]);
                    current.endSec = this.srtTimeToSec(timeMatch[2]);
                    continue;
                }

                if (current) current.texts.push(trimmed);
            }
            if (current) entries.push(current);
            return entries;
        },

        entriesToSrt: function (entries) {
            if (!entries || entries.length === 0) return '';
            var lines = [];
            for (var i = 0; i < entries.length; i++) {
                var e = entries[i];
                lines.push(String(i + 1));
                lines.push(this.secToSrtTime(e.startSec) + ' --> ' + this.secToSrtTime(e.endSec));
                for (var t = 0; t < e.texts.length; t++) lines.push(e.texts[t]);
                if (i < entries.length - 1) lines.push('');
            }
            return lines.join('\n');
        },

        srtTimeToSec: function (timeStr) {
            if (!timeStr) return 0;
            var normalized = timeStr.replace(',', '.');
            var parts = normalized.split(':');
            if (parts.length === 3) return parseFloat(parts[0]) * 3600 + parseFloat(parts[1]) * 60 + parseFloat(parts[2]);
            return 0;
        },

        secToSrtTime: function (sec) {
            if (typeof sec !== 'number' || isNaN(sec)) sec = 0;
            if (sec < 0) sec = 0;
            var hh = Math.floor(sec / 3600);
            var mm = Math.floor((sec % 3600) / 60);
            var ss = Math.floor(sec % 60);
            var ms = Math.round((sec - Math.floor(sec)) * 1000);
            var pad2 = function (v) { return v < 10 ? '0' + v : String(v); };
            var pad3 = function (v) { return v < 100 ? (v < 10 ? '00' + v : '0' + v) : String(v); };
            return pad2(hh) + ':' + pad2(mm) + ':' + pad2(ss) + ',' + pad3(ms);
        },

        findTargetByTime: function (entries, ctiSec) {
            if (!entries || entries.length === 0) return -1;
            for (var i = 0; i < entries.length; i++) {
                if (ctiSec >= entries[i].startSec && ctiSec < entries[i].endSec) return i;
            }
            var best = -1, bestDist = Infinity;
            for (var j = 0; j < entries.length; j++) {
                var dist = ctiSec - entries[j].startSec;
                if (dist >= 0 && dist < bestDist) { bestDist = dist; best = j; }
            }
            return best;
        },

        applyTrimIn: function (entries, targetIdx, frame10Sec) {
            if (!entries || entries.length === 0) return [];
            if (targetIdx < 0 || targetIdx >= entries.length) return entries.slice();
            var result = entries.slice(targetIdx);
            if (result.length === 0) return [];
            var first = result[0];
            var firstDur = first.endSec - first.startSec;
            var originalStart = first.startSec;
            result[0] = { index: 1, timeStr: '', texts: first.texts.slice(), startSec: frame10Sec, endSec: frame10Sec + firstDur };
            var offset = frame10Sec - originalStart;
            for (var i = 1; i < result.length; i++) {
                var r = result[i];
                result[i] = { index: i + 1, timeStr: '', texts: r.texts.slice(), startSec: r.startSec + offset, endSec: r.endSec + offset };
            }
            return result;
        },

        applyTrimOut: function (entries, targetIdx) {
            if (!entries || entries.length === 0) return [];
            if (targetIdx < 0 || targetIdx >= entries.length) return [];
            var result = entries.slice(0, targetIdx + 1);
            for (var i = 0; i < result.length; i++) {
                result[i] = { index: i + 1, timeStr: '', texts: result[i].texts.slice(), startSec: result[i].startSec, endSec: result[i].endSec };
            }
            return result;
        },

        applyTimeAdjust: function (entries, ctiSec, paddingSec) {
            if (!entries || entries.length === 0) return [];
            paddingSec = paddingSec || 0.04;
            var firstIn = entries[0].startSec;
            var lastOut = entries[entries.length - 1].endSec;
            var currentDur = lastOut - firstIn;
            if (currentDur <= 0) return entries.slice();
            var durIdeal = ctiSec - firstIn;
            if (durIdeal <= 0) return entries.slice();
            var ratio = durIdeal / currentDur;
            var result = [];
            for (var i = 0; i < entries.length; i++) {
                var e = entries[i];
                var oldDur = e.endSec - e.startSec;
                var newStart = firstIn + (e.startSec - firstIn) * ratio;
                result.push({ index: i + 1, timeStr: '', texts: e.texts.slice(), startSec: newStart, endSec: newStart + oldDur * ratio });
            }
            return result;
        },

        extractEntriesFromSrtFile: async function (srtPath) {
            var escapedPath = srtPath.replace(/\\/g, '\\\\');
            var srtContent = await window.FASTPASS_UI.Utils.callJSX("IO.readTxt('" + escapedPath + "')");
            if (!srtContent || srtContent.indexOf('ERR') === 0) return [];
            return this.srtToEntries(srtContent);
        }
    };

    /**
     * WaveformGenerator: Genera forma d'ona via ffmpeg
     */
    FASTPASS_UI.Logic.WaveformGenerator = {

        ffmpegPath: "E:\\AAA_Python Projects\\OTTO_Matic\\ffmpeg_local_win\\bin\\ffmpeg.exe",

        /**
         * Obtenir el path del clip d'àudio del track 1 del timeline
         */
        getAudioPath: async function () {
            var result = await window.FASTPASS_UI.Utils.callJSX(
                "(function(){try{var s=app.project.activeSequence;if(!s)return'';var aud=s.audioTracks[0];if(!aud)return'';var clip=aud.clips[0];if(!clip)return'';var pi=clip.projectItem;if(!pi)return'';return pi.getMediaPath()}catch(e){return''}})()"
            );
            return result;
        },

        /**
         * Genera waveform PNG a C:\temp\waveform_{hash}.png
         * @param {string} audioPath - Path complet al fitxer d'àudio
         * @param {number} durationSec - Durada total en segons
         * @param {number} widthPx - Amplada desitjada del PNG
         * @param {number} heightPx - Alçada desitjada
         * @returns {Promise<string>} Path del PNG generat, o '' si error
         */
        generateWaveform: async function (audioPath, durationSec, widthPx, heightPx) {
            if (!audioPath) return '';
            widthPx = widthPx || 1800;
            heightPx = heightPx || 60;

            var outPath = "C:\\temp\\waveform_" + Date.now() + ".png";
            // Esborrar si existeix
            try { window.cep.fs.writeFile(outPath, ""); } catch(e) {}

            // Comanda ffmpeg per generar waveform PNG:
            // ffmpeg -i audio -filter_complex "showwavespic=s=WxH:colors=#22cc66|#22cc66:scale=lin" -frames:v 1 out.png
            var cmd = "\"" + this.ffmpegPath + "\" -i \"" + audioPath + "\" -filter_complex \"showwavespic=s=" + widthPx + "x" + heightPx + ":colors=#000000|#22cc66:scale=lin\" -frames:v 1 -y \"" + outPath + "\"";

            try {
                var execSync = require('child_process').execSync;
                execSync(cmd, { timeout: 30000 });
                return outPath;
            } catch(e) {
                // Fallback: cep.process
                try {
                    window.cep.process.createProcess(this.ffmpegPath, 
                        " -i \"" + audioPath + "\" -filter_complex \"showwavespic=s=" + widthPx + "x" + heightPx + ":colors=#000000|#22cc66:scale=lin\" -frames:v 1 -y \"" + outPath + "\"");
                    return outPath;
                } catch(e2) {
                    return '';
                }
            }
        },

        /**
         * Carrega un PNG de waveform i el converteix a peaks (valors 0-1)
         * @param {string} pngPath - Path al PNG generat
         * @returns {Promise<number[]|null>} Array de peaks (0-1)
         */
        loadWaveformPeaks: async function (pngPath) {
            // Intentar llegir el PNG via cep.fs.readFile (binari)
            try {
                var cepFs = window.cep.fs;
                if (cepFs && cepFs.readFile) {
                    var result = cepFs.readFile(pngPath);
                    // Si funciona, extreiem dades - però és complex
                    // Millor carregar com a Image al canvas
                }
            } catch(e) {}
            return null;
        }
    };

    /**
     * PrProjCleaner: Neteja de caption tracks antics del .prproj
     */
    FASTPASS_UI.Logic.PrProjCleaner = {
        getProjectPath: async function () {
            return await window.FASTPASS_UI.Utils.callJSX("(function(){try{return app.project.path}catch(e){return''}})()");
        },
        saveProject: async function () {
            var result = await window.FASTPASS_UI.Utils.callJSX("(function(){try{app.project.save();return'OK'}catch(e){return'ERR:'+e.message}})()");
            return result === "OK";
        },
        removeOldCaptionTracks: async function () {
            var saved = await this.saveProject();
            if (!saved) return { success: false, message: "No s'ha pogut desar el projecte", removedTracks: 0 };
            var projPath = await this.getProjectPath();
            if (!projPath || projPath.indexOf('ERR') === 0 || projPath === "") return { success: false, message: "No s'ha pogut obtenir el path del projecte", removedTracks: 0 };
            return new Promise(function(resolve) {
                try {
                    var cep = window.cep || window.__adobe_cep__;
                    if (!cep || !cep.process) { resolve({ success: false, message: "cep.process no disponible", removedTracks: 0 }); return; }
                    var scriptPath = "C:\\temp\\manage_prproj.ps1";
                    var psArgs = "-ExecutionPolicy Bypass -File \"" + scriptPath + "\" -prprojPath \"" + projPath + "\" -action remove_old_tracks";
                    var processObj = cep.process.createProcess("powershell.exe", psArgs);
                    if (processObj) {
                        setTimeout(function() { resolve({ success: true, message: "PowerShell executat", removedTracks: -1 }); }, 10000);
                    } else { resolve({ success: false, message: "Error creant procés PowerShell", removedTracks: 0 }); }
                } catch(e) { resolve({ success: false, message: "Excepció: " + e.message, removedTracks: 0 }); }
            });
        }
    };

    window.FASTPASS_UI.Logic.SrtParser = FASTPASS_UI.Logic.SrtParser;
    window.SrtParser = FASTPASS_UI.Logic.SrtParser;
    window.FASTPASS_UI.Logic.PrProjCleaner = FASTPASS_UI.Logic.PrProjCleaner;
    window.PrProjCleaner = FASTPASS_UI.Logic.PrProjCleaner;
    window.FASTPASS_UI.Logic.WaveformGenerator = FASTPASS_UI.Logic.WaveformGenerator;
    window.WaveformGenerator = FASTPASS_UI.Logic.WaveformGenerator;
    window.FASTPASS_UI = FASTPASS_UI;
})();