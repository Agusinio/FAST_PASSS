/**
 * ============================================================================
 * LOGIC: SUB (Subtítols) - v3.0.0
 * Funcions de parseig i processament SRT + WaveformGenerator
 * ============================================================================
 */

(function () {
    var FASTPASS_UI = window.FASTPASS_UI || {};
    FASTPASS_UI.Logic = FASTPASS_UI.Logic || {};

    FASTPASS_UI.Logic.SrtParser = {

        srtToEntries: function (srtContent) {
            if (!srtContent || typeof srtContent !== 'string') return [];
            var lines = srtContent.split('\n');
            var entries = [];
            var current = null;
            for (var li = 0; li < lines.length; li++) {
                var trimmed = lines[li].trim();
                if (!trimmed) { if (current) { entries.push(current); current = null; } continue; }
                var numMatch = trimmed.match(/^\d+$/);
                if (numMatch) {
                    if (current) entries.push(current);
                    current = { index: parseInt(trimmed, 10), timeStr: '', texts: [], startSec: 0, endSec: 0 };
                    continue;
                }
                var timeMatch = trimmed.match(/^(\d{2}:\d{2}:\d{2}[,\.]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[,\.]\d{3})/);
                if (timeMatch && current) { current.timeStr = trimmed; current.startSec = this.srtTimeToSec(timeMatch[1]); current.endSec = this.srtTimeToSec(timeMatch[2]); continue; }
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
            var hh = Math.floor(sec / 3600), mm = Math.floor((sec % 3600) / 60), ss = Math.floor(sec % 60), ms = Math.round((sec - Math.floor(sec)) * 1000);
            var pad2 = function (v) { return v < 10 ? '0' + v : String(v); };
            var pad3 = function (v) { return v < 100 ? (v < 10 ? '00' + v : '0' + v) : String(v); };
            return pad2(hh) + ':' + pad2(mm) + ':' + pad2(ss) + ',' + pad3(ms);
        },

        findTargetByTime: function (entries, ctiSec) {
            if (!entries || entries.length === 0) return -1;
            for (var i = 0; i < entries.length; i++) { if (ctiSec >= entries[i].startSec && ctiSec < entries[i].endSec) return i; }
            var best = -1, bestDist = Infinity;
            for (var j = 0; j < entries.length; j++) { var dist = ctiSec - entries[j].startSec; if (dist >= 0 && dist < bestDist) { bestDist = dist; best = j; } }
            return best;
        },

        applyTrimIn: function (entries, targetIdx, frame10Sec) {
            if (!entries || entries.length === 0) return [];
            if (targetIdx < 0 || targetIdx >= entries.length) return entries.slice();
            var result = entries.slice(targetIdx);
            if (result.length === 0) return [];
            var first = result[0], firstDur = first.endSec - first.startSec, originalStart = first.startSec;
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
            for (var i = 0; i < result.length; i++) result[i] = { index: i + 1, timeStr: '', texts: result[i].texts.slice(), startSec: result[i].startSec, endSec: result[i].endSec };
            return result;
        },

        applyTimeAdjust: function (entries, ctiSec, paddingSec) {
            if (!entries || entries.length === 0) return [];
            paddingSec = paddingSec || 0.04;
            var firstIn = entries[0].startSec, lastOut = entries[entries.length - 1].endSec, currentDur = lastOut - firstIn;
            if (currentDur <= 0) return entries.slice();
            var durIdeal = ctiSec - firstIn;
            if (durIdeal <= 0) return entries.slice();
            var ratio = durIdeal / currentDur, result = [];
            for (var i = 0; i < entries.length; i++) {
                var e = entries[i], oldDur = e.endSec - e.startSec, newStart = firstIn + (e.startSec - firstIn) * ratio;
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
     * WaveformGenerator: Genera forma d'ona via ffmpeg RAW + cep.fs.readFile
     */
    FASTPASS_UI.Logic.WaveformGenerator = {

        ffmpegPath: "E:\\ffmpeg\\bin\\ffmpeg.exe",

        getAudioPath: async function () {
            return await window.FASTPASS_UI.Utils.callJSX(
                "(function(){try{var s=app.project.activeSequence;if(!s)return'';var aud=s.audioTracks[0];if(!aud)return'';var clip=aud.clips[0];if(!clip)return'';var pi=clip.projectItem;if(!pi)return'';return pi.getMediaPath()}catch(e){return''}})()"
            );
        },

        /**
         * Genera peaks via ffmpeg RAW i els llegeix via cep.fs
         * @param {string} audioPath - Path al fitxer d'àudio
         * @param {number} totalSec - Durada total en segons
         * @param {number} targets - Nombre de punts de mostra desitjat (píxels d'amplada)
         * @returns {Promise<number[]|null>} Array de peaks 0..1, o null
         */
        generatePeaks: async function (audioPath, totalSec, targets) {
            if (!audioPath) return null;
            targets = targets || 1800;
            // Sample rate baixa per reduir dades: 1000 Hz
            var sampleRate = 1000;
            var rawPath = "C:\\temp\\waveform_raw_" + Date.now() + ".raw";

            // ffmpeg: extrau 1s segons a 1000 Hz, f32le, 1 canal
            var cmd = "\"" + this.ffmpegPath + "\" -i \"" + audioPath + "\" -ac 1 -ar " + sampleRate + " -f f32le -y \"" + rawPath + "\"";
            log("📝 WF: ffmpeg cmd: " + cmd.substring(0, 120) + "...");

            try {
                // Executar ffmpeg via child_process
                var execSync = require('child_process').execSync;
                execSync(cmd, { timeout: 30000 });
            } catch(e) {
                // Fallback: cep.process.createProcess (asíncron, esperar)
                try {
                    window.cep.process.createProcess(this.ffmpegPath, "-i \"" + audioPath + "\" -ac 1 -ar " + sampleRate + " -f f32le -y \"" + rawPath + "\"");
                    // Esperar 5s perquè ffmpeg acabi
                    await new Promise(function(resolve) { setTimeout(resolve, 5000); });
                } catch(e2) {
                    log("⚠️ WF: ffmpeg execution failed: " + e2.message);
                    return null;
                }
            }

            // Llegir el fitxer RAW via cep.fs
            try {
                var cepFs = window.cep.fs;
                if (!cepFs || !cepFs.readFile) {
                    log("⚠️ WF: cep.fs.readFile no disponible");
                    return null;
                }
                var result = cepFs.readFile(rawPath);
                if (result.err !== 0) {
                    log("⚠️ WF: cep.fs.readFile error: " + result.err);
                    return null;
                }
                var data = result.data;
                if (!data || data.length < 4) {
                    log("⚠️ WF: RAW file too small: " + (data ? data.length : 0));
                    return null;
                }

                // Parsejar floats (f32le, 4 bytes per mostra)
                var rawPeaks = [];
                var view = new DataView(new ArrayBuffer(data.length));
                for (var i = 0; i < data.length; i++) view.setUint8(i, data.charCodeAt(i) & 0xFF);
                for (var off = 0; off + 4 <= data.length; off += 4) {
                    var peak = Math.abs(view.getFloat32(off, true));
                    rawPeaks.push(peak);
                }

                if (rawPeaks.length === 0) {
                    log("⚠️ WF: No peaks parsed from RAW");
                    return null;
                }

                // Reduir als targets desitjats agafant el màxim de cada grup
                var step = Math.max(1, Math.floor(rawPeaks.length / targets));
                var peaks = [];
                for (var pi = 0; pi < targets && pi * step < rawPeaks.length; pi++) {
                    var maxVal = 0;
                    for (var si = 0; si < step && pi * step + si < rawPeaks.length; si++) {
                        if (rawPeaks[pi * step + si] > maxVal) maxVal = rawPeaks[pi * step + si];
                    }
                    peaks.push(Math.min(maxVal * 2, 1)); // Normalitzar
                }

                log("📝 WF: " + peaks.length + " peaks generats (" + rawPeaks.length + " raw, step=" + step + ")");
                return peaks;

            } catch(e) {
                log("⚠️ WF: Error parsing RAW: " + e.message);
                return null;
            }
        }
    };

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
                    var psArgs = "-ExecutionPolicy Bypass -File \"C:\\temp\\manage_prproj.ps1\" -prprojPath \"" + projPath + "\" -action remove_old_tracks";
                    cep.process.createProcess("powershell.exe", psArgs);
                    setTimeout(function() { resolve({ success: true, message: "PowerShell executat", removedTracks: -1 }); }, 10000);
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