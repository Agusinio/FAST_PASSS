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

                // Número d'índex
                var numMatch = trimmed.match(/^\d+$/);
                if (numMatch) {
                    if (current) entries.push(current);
                    current = { index: parseInt(trimmed, 10), timeStr: '', texts: [], startSec: 0, endSec: 0 };
                    continue;
                }

                // Timecode "00:00:10,000 --> 00:00:15,500"
                var timeMatch = trimmed.match(/^(\d{2}:\d{2}:\d{2}[,\.]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[,\.]\d{3})/);
                if (timeMatch && current) {
                    current.timeStr = trimmed;
                    current.startSec = this.srtTimeToSec(timeMatch[1]);
                    current.endSec = this.srtTimeToSec(timeMatch[2]);
                    continue;
                }

                // Text de la entrada
                if (current) current.texts.push(trimmed);
            }
            if (current) entries.push(current);

            return entries;
        },

        /**
         * entriesToSrt: Converteix array d'entrades a string SRT.
         * Re-enumera els índexs seqüencialment.
         */
        entriesToSrt: function (entries, paddingMs) {
            if (!entries || entries.length === 0) return '';
            paddingMs = paddingMs || 40; // 0.04s per defecte

            var lines = [];
            for (var i = 0; i < entries.length; i++) {
                var e = entries[i];
                // Re-enumerar índex
                lines.push(String(i + 1));
                // Timecode
                var startStr = this.secToSrtTime(e.startSec);
                var endStr = this.secToSrtTime(e.endSec);
                lines.push(startStr + ' --> ' + endStr);
                // Text (pot ser múltiples línies)
                for (var t = 0; t < e.texts.length; t++) {
                    lines.push(e.texts[t]);
                }
                // Línia en blanc entre entrades
                if (i < entries.length - 1) lines.push('');
            }
            return lines.join('\n');
        },

        /**
         * srtTimeToSec: Converteix "00:01:23,456" a 83.456 segons.
         * Accepta coma o punt com a separador decimal.
         */
        srtTimeToSec: function (timeStr) {
            if (!timeStr) return 0;
            // Normalitzar coma a punt
            var normalized = timeStr.replace(',', '.');
            var parts = normalized.split(':');
            if (parts.length === 3) {
                var hh = parseFloat(parts[0]) || 0;
                var mm = parseFloat(parts[1]) || 0;
                var ss = parseFloat(parts[2]) || 0;
                return hh * 3600 + mm * 60 + ss;
            }
            return 0;
        },

        /**
         * secToSrtTime: Converteix 83.456 segons a "00:01:23,456".
         */
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

        /**
         * findTargetByTime: Troba l'entrada SRT que conté el CTI.
         * Si no troba coincidència exacta, retorna la més propera abans del CTI.
         * @param {Array} entries - Array d'entrades SRT
         * @param {number} ctiSec - CTI en segons
         * @returns {number} Índex de l'entrada target (-1 si no troba)
         */
        findTargetByTime: function (entries, ctiSec) {
            if (!entries || entries.length === 0) return -1;

            // 1. Buscar coincidència exacta (CTI dins de [start, end))
            for (var i = 0; i < entries.length; i++) {
                if (ctiSec >= entries[i].startSec && ctiSec < entries[i].endSec) {
                    return i;
                }
            }

            // 2. Buscar l'entrada amb startSec més proper abans del CTI
            var best = -1;
            var bestDist = Infinity;
            for (var j = 0; j < entries.length; j++) {
                var dist = ctiSec - entries[j].startSec;
                if (dist >= 0 && dist < bestDist) {
                    bestDist = dist;
                    best = j;
                }
            }

            return best;
        },

        /**
         * applyTrimIn: Retorna noves entrades amb les ANTERIORS al target eliminades.
         * La nova primera entrada es mou al frame 10 (0.4s a 25fps).
         * @param {Array} entries - Entrades originals
         * @param {number} targetIdx - Índex de l'entrada target
         * @param {number} frame10Sec - Frame 10 en segons (0.4 per defecte)
         * @returns {Array} Noves entrades
         */
        applyTrimIn: function (entries, targetIdx, frame10Sec) {
            if (!entries || entries.length === 0) return [];
            if (targetIdx < 0 || targetIdx >= entries.length) return entries.slice();

            // Entrades a partir del target
            var result = entries.slice(targetIdx);
            if (result.length === 0) return [];

            // Moure la primera entrada al frame 10
            var first = result[0];
            var firstDur = first.endSec - first.startSec;
            var originalStart = first.startSec;

            result[0] = {
                index: 1, // Serà re-enumerat per entriesToSrt
                timeStr: '',
                texts: first.texts.slice(),
                startSec: frame10Sec,
                endSec: frame10Sec + firstDur
            };

            // Desplaçar les entrades posteriors proporcionalment
            var offset = frame10Sec - originalStart;
            for (var i = 1; i < result.length; i++) {
                var r = result[i];
                result[i] = {
                    index: i + 1,
                    timeStr: '',
                    texts: r.texts.slice(),
                    startSec: r.startSec + offset,
                    endSec: r.endSec + offset
                };
            }

            return result;
        },

        /**
         * applyTrimOut: Retorna noves entrades amb les POSTERIORS al target eliminades.
         * @param {Array} entries - Entrades originals
         * @param {number} targetIdx - Índex de l'entrada target
         * @returns {Array} Noves entrades
         */
        applyTrimOut: function (entries, targetIdx) {
            if (!entries || entries.length === 0) return [];
            if (targetIdx < 0 || targetIdx >= entries.length) return [];

            // Entrades fins al target (inclòs)
            var result = entries.slice(0, targetIdx + 1);

            // Mantenir timings originals, re-numerar índexs
            for (var i = 0; i < result.length; i++) {
                result[i] = {
                    index: i + 1,
                    timeStr: '',
                    texts: result[i].texts.slice(),
                    startSec: result[i].startSec,
                    endSec: result[i].endSec
                };
            }

            return result;
        },

        /**
         * applyTimeAdjust: Escala proporcionalment TOTES les entrades.
         * L'escalat es fa de manera que la durada total canviï per ajustar-se al CTI.
         * 
         * @param {Array} entries - Entrades originals (TOTES, no filtrades)
         * @param {number} ctiSec - On ha d'acabar l'última entrada (OUT ideal)
         * @param {number} paddingSec - Separació entre entrades (0.04 per defecte)
         * @returns {Array} Noves entrades escalades
         */
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
                var oldStart = e.startSec;
                var oldEnd = e.endSec;
                var oldDur = oldEnd - oldStart;

                var newStart = firstIn + (oldStart - firstIn) * ratio;
                var newEnd = newStart + oldDur * ratio;

                result.push({
                    index: i + 1,
                    timeStr: '',
                    texts: e.texts.slice(),
                    startSec: newStart,
                    endSec: newEnd
                });
            }

            return result;
        },

        /**
         * extractEntriesFromSrtFile: Helper que llegeix un .srt via IO.readTxt i retorna entries.
         * NO és pura (fa crida JSX) però és pràctica.
         * @param {string} srtPath - Path complet al .srt
         * @returns {Promise<Array>} Entrades parsejades
         */
        extractEntriesFromSrtFile: async function (srtPath) {
            var escapedPath = srtPath.replace(/\\/g, '\\\\');
            var srtContent = await window.FASTPASS_UI.Utils.callJSX("IO.readTxt('" + escapedPath + "')");
            if (!srtContent || srtContent.indexOf('ERR') === 0) return [];
            return this.srtToEntries(srtContent);
        }
    };

    // Mantenir retrocompatibilitat amb cleanIn/cleanOut existents
    FASTPASS_UI.Logic.Sub = {
        cleanIn: async function (ctiSec, searchText) {
            return "DEPRECATED: Use SrtParser instead";
        },
        cleanOut: async function (ctiSec, searchText) {
            return "DEPRECATED: Use SrtParser instead";
        }
    };

    window.FASTPASS_UI.Logic.SrtParser = FASTPASS_UI.Logic.SrtParser;
    window.SrtParser = FASTPASS_UI.Logic.SrtParser;
    window.FASTPASS_UI = FASTPASS_UI;
})();
