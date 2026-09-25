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
                // Separador DESPRÉS de cada bloc, també del darrer: sense la línia
                // buida final, Premiere (i altres parsers) descarten l'últim subtítol.
                lines.push('');
            }
            // Doble salt final (bloc + línia buida), com el SRT de referència.
            return lines.join('\n') + '\n';
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
            // Carry de redondeo: 0.9999s → 1000ms s'ha de convertir a +1s (evita "00,1000")
            if (ms >= 1000) { ms = 0; ss += 1; }
            if (ss >= 60) { ss = 0; mm += 1; }
            if (mm >= 60) { mm = 0; hh += 1; }
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

        /**
         * scaleSegmentWithGaps: Re-escala un segment de clips (contigus) mantenint
         * la separació base de 3 frames i escalant només durades + pauses.
         * @param {Array} clips - clips del segment en ordre (startSec/endSec originals)
         * @param {Array} boundaryGaps - gaps en ordre [lead, g1..g(n-1), trail] (longitud = clips.length+1)
         * @param {number} newStart - nou IN del primer clip
         * @param {number} newEnd   - nou límit dret (després del trail)
         * @returns {Array} clips re-posicionats (index re-numerat 1..n)
         */
        scaleSegmentWithGaps: function (clips, boundaryGaps, newStart, newEnd) {
            if (!clips || clips.length === 0) return [];
            if (!isFinite(newStart) || !isFinite(newEnd) || newEnd <= newStart) {
                // Rang degenerat: retornar els clips sense canvis (clonats) per no col·lapsar
                return clips.map(function (c) { return { index: c.index, timeStr: c.timeStr, texts: c.texts.slice(), startSec: c.startSec, endSec: c.endSec }; });
            }
            var FPS = 25;
            var GAP = 3 / FPS;      // 0.12s = 3 frames
            var EPS = 1 / FPS;      // 0.04s (umbral gap base vs pausa)
            var MIN_DUR = 1 / FPS;  // 0.04s (durada mínima d'un clip)
            var n = clips.length;

            var durs = [];
            for (var d0 = 0; d0 < n; d0++) durs.push(Math.max(0, clips[d0].endSec - clips[d0].startSec));

            // Classificar cada gap: contigu (0) / base (3 frames) / pausa (excés escalable)
            var base = [], excess = [];
            for (var j = 0; j < boundaryGaps.length; j++) {
                var g = boundaryGaps[j];
                if (g <= EPS) { base.push(0); excess.push(0); }
                else if (g <= GAP + EPS) { base.push(GAP); excess.push(0); }
                else { base.push(GAP); excess.push(g - GAP); }
            }

            var fixed = 0;
            for (var f0 = 0; f0 < base.length; f0++) fixed += base[f0];

            // Water-filling: les durades que caurien sota el mínim es fixen a MIN_DUR
            var frozen = [];
            for (var fr = 0; fr < n; fr++) frozen.push(false);
            var factor = 1;
            for (var iter = 0; iter <= n; iter++) {
                var scalable = 0;
                for (var s0 = 0; s0 < n; s0++) if (!frozen[s0]) scalable += durs[s0];
                for (var e0 = 0; e0 < excess.length; e0++) scalable += excess[e0];
                var fixedNow = fixed;
                for (var fz = 0; fz < n; fz++) if (frozen[fz]) fixedNow += MIN_DUR;
                var f = 1;
                if (scalable > 0) f = (newEnd - newStart - fixedNow) / scalable;
                var changed = false;
                for (var w = 0; w < n; w++) {
                    if (!frozen[w] && durs[w] * f < MIN_DUR) { frozen[w] = true; changed = true; }
                }
                factor = f;
                if (!changed) break;
            }

            // Durades i gaps finals
            var newDurs = [];
            for (var i0 = 0; i0 < n; i0++) newDurs.push(frozen[i0] ? MIN_DUR : Math.max(MIN_DUR, durs[i0] * factor));
            var newGaps = [];
            for (var j0 = 0; j0 < excess.length; j0++) newGaps.push(base[j0] + excess[j0] * factor);

            // Reensamblar: lead → clip → gap → clip → ... → trail
            var result = [];
            var t = newStart + newGaps[0];
            for (var i = 0; i < n; i++) {
                var s = t;
                var e = t + newDurs[i];
                result.push({ index: i + 1, timeStr: '', texts: clips[i].texts.slice(), startSec: s, endSec: e });
                t = e + newGaps[i + 1];
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
     * Format: WAV, 480Hz, 8-bit, mono (1 byte = 1 mostra = 1/480s exactes)
     */
    FASTPASS_UI.Logic.WaveformGenerator = {

        /**
         * Obté el path del fitxer .bin al directori del projecte
         * @param {string} projectFolder - Directori del projecte
         * @returns {string} Path complet al .bin o ''
         */
        getBinPath: async function (projectFolder) {
            // NORMA ESTRICTA: només el .bin del BLOC actual (<PROG>_<BLOC>_CLIP_AUDIO_REF.bin).
            // Sense cap fallback a altres .bin de la carpeta: millor cap WF que una WF equivocada.
            if (!projectFolder || projectFolder.indexOf('ERR') === 0) return '';

            var expected = '';
            try {
                var st = window.FASTPASS_UI.State;
                if (st && st.progData && st.progData.wott && st.bloque) {
                    expected = (st.progData.wott + '_' + st.bloque + '_CLIP_AUDIO_REF.bin').toUpperCase();
                }
            } catch(e0) {}
            if (!expected) return ''; // sense bloc conegut → no carreguem res

            try {
                // 1. Escaneig de directori: coincidència exacta de nom
                var scanResult = await window.FASTPASS_UI.Utils.callJSX("IO.scanDirectory('" + projectFolder.replace(/\\/g, '\\\\') + "')");
                if (scanResult && scanResult.indexOf('ERR') !== 0 && scanResult !== '[]') {
                    var files = JSON.parse(scanResult);
                    for (var i = 0; i < files.length; i++) {
                        var f = files[i];
                        if (f && f.name && f.name.toUpperCase() === expected && f.path) return f.path;
                    }
                }
            } catch(e) {}

            // 2. Comprovació directa per si l'escaneig falla (IO.exists és case-insensitive a Windows)
            try {
                var testPath = projectFolder + "\\" + expected;
                var exists = await window.FASTPASS_UI.Utils.callJSX("IO.exists('" + testPath.replace(/\\/g, '\\\\') + "')");
                if (exists === "true") return testPath;
            } catch(e2) {}

            return '';
        },

        /**
         * silences: (2026-09-24) Detecta els SILENCIS d'àudio del bloc a partir del .bin de
         * referència (<PROG>_<BLOC>_CLIP_AUDIO_REF.bin, 480Hz, 1 byte = 1 peak).
         * DAT TRANSVERSAL del pla de marcadors per capes: les fronteres de silenci són molt més
         * definitòries que els cortes (n'hi ha molts menys) i serveixen per:
         *   - CAPA 1 (OnAir): primer silenci, i després un corte a prop del silenci.
         *   - CAPES 1.5 / 2 / 3: ancla de posicionament.
         *   - BOUNDS: final real del contingut anterior (IN del bloc).
         * Els temps retornats són de MEDIA (la base del .bin = el clip del bloc).
         * @param {Object} [opts] { threshold=0.05, minDur=0.4, winSec=0.1, pps=240 }
         * @returns {Promise<Array<{start:number,end:number,dur:number}>>}
         */
        silences: async function (opts) {
            var U = window.FASTPASS_UI.Utils;
            var o = opts || {};
            var thr = (typeof o.threshold === 'number') ? o.threshold : 0.05;
            var minDur = (typeof o.minDur === 'number') ? o.minDur : 0.4;
            var winSec = (typeof o.winSec === 'number') ? o.winSec : 0.1;
            var ppsWanted = (typeof o.pps === 'number') ? o.pps : 240;

            var folder = '';
            try { folder = U.workFolder(window.FASTPASS_UI.State) || ''; } catch (e0) { folder = ''; }
            var bin = '';
            try { bin = await this.getBinPath(folder); } catch (eB) { bin = ''; }
            if (!bin) {
                U.log('🤫 [SILENCI] Sense .bin de referència del bloc → no es poden detectar silencis');
                return [];
            }
            var wf = await this.loadPeaksFromBin(bin, ppsWanted);
            if (!wf || !wf.peaks || wf.peaks.length === 0) {
                U.log('🤫 [SILENCI] .bin sense peaks llegibles: ' + bin);
                return [];
            }
            // (2026-09-25) DIAGNÒSTIC: el detector de l'app trobava 7 trams i un mini-detector
            // extern (mateixa lògica) en troba 153 → cal veure QUÈ carrega realment.
            U.log('🤫 [SILENCI·DBG] bin=' + bin + ' · peaks=' + wf.peaks.length + ' · pps=' + wf.peaksPerSec + ' · dur=' + (wf.durSec !== undefined ? Number(wf.durSec).toFixed(2) : '?') + 's · demanat pps=' + ppsWanted);
            var pps = wf.peaksPerSec || ppsWanted;
            var winN = Math.max(1, Math.round(pps * winSec));
            var out = [], curStart = null;
            for (var i = 0; i < wf.peaks.length; i += winN) {
                var mx = 0;
                for (var j = i; j < Math.min(wf.peaks.length, i + winN); j++) {
                    if (wf.peaks[j] > mx) mx = wf.peaks[j];
                }
                var t0 = i / pps;
                if (mx <= thr) {
                    if (curStart === null) curStart = t0;
                } else if (curStart !== null) {
                    var dur = t0 - curStart;
                    if (dur >= minDur) out.push({ start: curStart, end: t0, dur: dur });
                    curStart = null;
                }
            }
            if (curStart !== null) {
                var tEnd = wf.peaks.length / pps;
                if ((tEnd - curStart) >= minDur) out.push({ start: curStart, end: tEnd, dur: tEnd - curStart });
            }
            U.log('🤫 [SILENCI] ' + out.length + ' trams · umbral=' + thr + ' · min=' + minDur + 's · ' +
                (out.length ? out.map(function (s) { return s.start.toFixed(2) + '→' + s.end.toFixed(2) + '(' + s.dur.toFixed(2) + 's)'; }).join(', ') : '(cap)'));
            return out;
        },

        /**
         * Llegeix fitxer .bin (WAV PCM 8-bit unsigned, mono, 480Hz) i retorna peaks 0..1
         * Lectura robusta:
         *   1) Demana Base64 (cep.encoding.Base64) + atob → bytes exactes (evita corrupció UTF-8)
         *   2) Autodetecció: "UklGR" = Base64 de "RIFF" → atob; "RIFF" → bytes crus; sinó → crues
         *   3) Localitza el chunk "data" recorrent els chunks RIFF (fallback: offset 44)
         *   4) v = |byte-128|/maxAbs del bin (normalització fidel, sense saturació)
         *   5) Redueix a densitat fixa (peaksPerSec) amb màxim per grup → zoom solidari
         * @param {string} binPath - Path complet al .bin
         * @param {number} peaksPerSec - Densitat de peaks per segon (defecte 100)
         * @returns {Promise<{peaks:number[], peaksPerSec:number, durSec:number}|null>}
         */
        loadPeaksFromBin: async function (binPath, peaksPerSec) {
            if (!binPath) return null;
            peaksPerSec = peaksPerSec || 100;

            // Cache per path: evita rellegir el mateix .bin (NAS lent) en recàrregues
            var self = FASTPASS_UI.Logic.WaveformGenerator;
            if (!self._peaksCache) self._peaksCache = {};
            if (self._peaksCache[binPath]) return self._peaksCache[binPath];

            try {
                var cepFs = window.cep.fs;
                if (!cepFs || !cepFs.readFile) return null;

                // 1. Llegir demanant Base64 (bytes exactes, sense corrupció UTF-8)
                var enc = (window.cep.encoding && window.cep.encoding.Base64) ? window.cep.encoding.Base64 : "Base64";
                var result = cepFs.readFile(binPath, enc);
                if (result.err !== 0 || !result.data || result.data.length < 4) {
                    // Fallback: sense encoding
                    result = cepFs.readFile(binPath);
                    if (result.err !== 0 || !result.data || result.data.length < 4) return null;
                }

                var data = result.data;

                // 2. Autodetecció del format de dades → obtenir array de bytes
                var bytes = null;
                var i;
                if (data.substring(0, 5) === "UklGR") {
                    // Base64 d'un WAV (RIFF) → decodificar
                    var binStr = atob(data.replace(/\s/g, ''));
                    bytes = new Uint8Array(binStr.length);
                    for (i = 0; i < binStr.length; i++) bytes[i] = binStr.charCodeAt(i);
                } else if (data.substring(0, 4) === "RIFF") {
                    // String crua del WAV
                    bytes = new Uint8Array(data.length);
                    for (i = 0; i < data.length; i++) bytes[i] = data.charCodeAt(i) & 0xFF;
                } else {
                    // Provar Base64 genèric; si falla, tractar com a bytes crus
                    try {
                        var binStr2 = atob(data.replace(/\s/g, ''));
                        if (binStr2.length > 44) {
                            bytes = new Uint8Array(binStr2.length);
                            for (i = 0; i < binStr2.length; i++) bytes[i] = binStr2.charCodeAt(i);
                        }
                    } catch (eB) { /* no era Base64 */ }
                    if (!bytes) {
                        bytes = new Uint8Array(data.length);
                        for (i = 0; i < data.length; i++) bytes[i] = data.charCodeAt(i) & 0xFF;
                    }
                }

                if (!bytes || bytes.length < 4) return null;

                // 3. Localitzar el chunk "data" del WAV (+ sample rate del fmt)
                var dataOff = 0;
                var dataLen = bytes.length;
                var sampleRate = 480;
                if (bytes.length > 44 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) {
                    sampleRate = (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16) | (bytes[27] << 24)) >>> 0;
                    if (sampleRate < 100 || sampleRate > 192000) sampleRate = 480;
                    var pos = 12;
                    var found = false;
                    while (pos + 8 <= bytes.length) {
                        var id = String.fromCharCode(bytes[pos], bytes[pos + 1], bytes[pos + 2], bytes[pos + 3]);
                        var size = (bytes[pos + 4] | (bytes[pos + 5] << 8) | (bytes[pos + 6] << 16) | (bytes[pos + 7] << 24)) >>> 0;
                        if (id === "data") {
                            dataOff = pos + 8;
                            dataLen = Math.min(size, bytes.length - dataOff);
                            found = true;
                            break;
                        }
                        pos += 8 + size + (size % 2); // chunks alineats a 2
                    }
                    if (!found) { dataOff = 44; dataLen = bytes.length - 44; } // fallback WAV estàndard
                }
                if (dataLen <= 0) return null;

                // 4. Convertir mostres unsigned 8-bit → peaks
                // Normalització FIDEL al perfil real: v = |b-128| / maxAbs del bin.
                // Sense guany x3 ni saturació → el perfil (siluetes/pauses) coincideix
                // amb la forma de la WF del timeline de Premiere (que normalitza pel
                // seu propi màxim).
                var maxAbs = 0;
                for (var b0 = dataOff; b0 < dataOff + dataLen; b0++) {
                    var av0 = Math.abs(bytes[b0] - 128);
                    if (av0 > maxAbs) maxAbs = av0;
                }
                if (maxAbs < 1) maxAbs = 1;
                var rawPeaks = [];
                for (var b = dataOff; b < dataOff + dataLen; b++) {
                    var v = Math.abs(bytes[b] - 128) / maxAbs;
                    if (v > 1) v = 1;
                    rawPeaks.push(v);
                }

                // 5. Reduir a densitat fixa de peaks/segon (màxim de cada grup)
                var step = Math.max(1, Math.floor(sampleRate / peaksPerSec));
                var peaks = [];
                for (var pi = 0; pi * step < rawPeaks.length; pi++) {
                    var maxVal = 0;
                    for (var si = 0; si < step && pi * step + si < rawPeaks.length; si++) {
                        if (rawPeaks[pi * step + si] > maxVal) maxVal = rawPeaks[pi * step + si];
                    }
                    peaks.push(maxVal);
                }

                var out = {
                    peaks: peaks,
                    peaksPerSec: Math.round(sampleRate / step),
                    durSec: rawPeaks.length / sampleRate
                };
                self._peaksCache[binPath] = out;
                return out;

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