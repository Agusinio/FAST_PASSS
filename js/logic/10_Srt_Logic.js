/**
 * ============================================================================
 * LOGIC: SUB (Subtítols) - v3.1.0
 * SrtParser + WaveformGenerator (WAV .bin) + PrProjCleaner
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
     * WaveformGenerator: Llegeix fitxer WAV (.bin) amb mostra d'àudio de referència
     * Format: WAV, 8000Hz, 8-bit, mono
     */
    FASTPASS_UI.Logic.WaveformGenerator = {

        /**
         * Obté el path del fitxer .bin al directori del projecte
         * @param {string} projectFolder - Directori del projecte
         * @returns {string} Path complet al .bin o ''
         */
        getBinPath: async function (projectFolder) {
            // Busca un fitxer .bin al directori del projecte
            if (!projectFolder || projectFolder.indexOf('ERR') === 0) return '';
            
            try {
                // Escanejar directori i buscar qualsevol .bin
                var scanResult = await window.FASTPASS_UI.Utils.callJSX("IO.scanDirectory('" + projectFolder.replace(/\\/g, '\\\\') + "')");
                if (scanResult && scanResult.indexOf('ERR') !== 0 && scanResult !== '[]') {
                    var files = JSON.parse(scanResult);
                    // Prioritat: fitxers amb "_AUDIO_REF.bin" o "WAVEFORM" al nom
                    var bestMatch = null;
                    for (var i = 0; i < files.length; i++) {
                        var f = files[i];
                        if (!f || !f.name) continue;
                        var upper = f.name.toUpperCase();
                        if (upper.indexOf('.BIN') === -1) continue;
                        if (upper.indexOf('AUDIO_REF') >= 0 || upper.indexOf('WAVEFORM') >= 0) {
                            if (upper.indexOf('AUDIO_REF') >= 0) { bestMatch = f; break; }
                            if (!bestMatch) bestMatch = f;
                        }
                        if (!bestMatch) bestMatch = f;
                    }
                    if (bestMatch && bestMatch.path) return bestMatch.path;
                }
            } catch(e) {}
            
            // Fallback: intentar noms coneguts
            var possibleNames = [
                "TNV_V1_CLIP_AUDIO_REF.bin",
                "TNV_V2_CLIP_AUDIO_REF.bin",
                "TNV_V3_CLIP_AUDIO_REF.bin",
                "TNC_V1_CLIP_AUDIO_REF.bin",
                "TNC_V2_CLIP_AUDIO_REF.bin",
                "CLIP_AUDIO_REF.bin"
            ];
            for (var i = 0; i < possibleNames.length; i++) {
                var testPath = projectFolder + "\\" + possibleNames[i];
                var exists = await window.FASTPASS_UI.Utils.callJSX("IO.exists('" + testPath.replace(/\\/g, '\\\\') + "')");
                if (exists === "true") return testPath;
            }
            
            return '';
        },

        /**
         * Llegeix fitxer .bin compacte i retorna peaks normalitzats (0..15 → 0..1)
         * Format: cada byte empaqueta 2 valors de 4 bits: [ V1(4bits) | V2(4bits) ]
         * Cada Vi = valor absolut de la senyal (0..15)
         * @param {string} binPath - Path complet al .bin
         * @param {number} widthPx - Amplada en píxels per reduir
         * @returns {Promise<number[]|null>} Array de peaks (0..1)
         */
        loadPeaksFromBin: async function (binPath, widthPx) {
            if (!binPath) return null;
            widthPx = widthPx || 1800;
            
            try {
                var cepFs = window.cep.fs;
                if (!cepFs || !cepFs.readFile) return null;
                
                var result = cepFs.readFile(binPath);
                if (result.err !== 0 || !result.data || result.data.length < 4) return null;
                
                var data = result.data;
                var rawPeaks = [];
                
                // Format compacte: cada byte = [V1(4bits)|V2(4bits)]
                // Desempaquetar: V1 = byte >> 4, V2 = byte & 0x0F
                // Amplificar valors baixos (x3) per fer visible la variació
                for (var b = 0; b < data.length; b++) {
                    var code = data.charCodeAt(b) & 0xFF;
                    var val1 = ((code >> 4) & 0x0F) / 15 * 3;  // amplify 3x
                    var val2 = (code & 0x0F) / 15 * 3;
                    if (val1 > 1) val1 = 1;
                    if (val2 > 1) val2 = 1;
                    rawPeaks.push(val1);
                    rawPeaks.push(val2);
                }
                
                if (rawPeaks.length === 0) return null;
                
                // Reduir als píxels desitjats (agafar el màxim de cada grup)
                var step = Math.max(1, Math.floor(rawPeaks.length / widthPx));
                var peaks = [];
                for (var pi = 0; pi < widthPx && pi * step < rawPeaks.length; pi++) {
                    var maxVal = 0;
                    for (var si = 0; si < step && pi * step + si < rawPeaks.length; si++) {
                        if (rawPeaks[pi * step + si] > maxVal) maxVal = rawPeaks[pi * step + si];
                    }
                    peaks.push(maxVal);
                }
                
                return peaks;
                
            } catch(e) {
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