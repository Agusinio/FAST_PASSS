/**
 * ============================================================================
 * SRT EDITOR: Pseudotimeline dins l'extensió
 * Renderitza: regle de temps + 1 track (captions) + waveform (baix)
 * Permet: IN, OUT, AJUSTAR, zoom, PLAY/PAUSA, preview text net
 * Exporta: PROJECTE_MOD.srt → import → createCaptionTrack
 * ============================================================================
 */

(function () {
    var FASTPASS_UI = window.FASTPASS_UI || {};
    FASTPASS_UI.Editor = FASTPASS_UI.Editor || {};

    const getUtils = () => window.FASTPASS_UI.Utils;
    const log = (m) => getUtils().log(m, "DEBUG");
    const callJSX = (s) => getUtils().callJSX(s);

    FASTPASS_UI.Editor.SrtEditor = {

        _entries: [],
        _pixelsPerSec: 20,
        _maxSec: 120,
        _trackHeight: 30,
        _waveformHeight: 40,
        _rulerHeight: 24,
        _playheadSec: 0,
        _pollInterval: null,
        _srtPath: "",
        _srtName: "",
        _canvas: null,
        _ctx: null,
        _isDirty: false,
        _waveformPeaks: null,
        _isPlaying: false,

        init: function () {
            this._canvas = document.getElementById('srtCanvas');
            if (!this._canvas) return false;
            this._ctx = this._canvas.getContext('2d');
            var self = this;

            this._canvas.addEventListener('click', function (e) {
                var rect = self._canvas.getBoundingClientRect();
                var scaleX = self._canvas.width / rect.width;
                var canvasX = (e.clientX - rect.left) * scaleX;
                var sec = canvasX / self._pixelsPerSec;
                self.setPlayhead(sec);
            });

            var btnIn = document.getElementById('btnZoomIn');
            var btnOut = document.getElementById('btnZoomOut');
            if (btnIn) {
                btnIn.addEventListener('click', function () {
                    self._pixelsPerSec = Math.min(150, self._pixelsPerSec + 10);
                    var label = document.getElementById('zoomLabel');
                    if (label) label.textContent = self._pixelsPerSec + 'px/s';
                    self.render();
                });
            }
            if (btnOut) {
                btnOut.addEventListener('click', function () {
                    self._pixelsPerSec = Math.max(5, self._pixelsPerSec - 10);
                    var label = document.getElementById('zoomLabel');
                    if (label) label.textContent = self._pixelsPerSec + 'px/s';
                    self.render();
                });
            }
            return true;
        },

        loadSrt: async function (srtPath) {
            log("📝 SRT_EDIT: Carregant " + srtPath);
            var escapedPath = srtPath.replace(/\\/g, '\\\\');
            var srtContent = await callJSX("IO.readTxt('" + escapedPath + "')");
            if (!srtContent || srtContent.indexOf('ERR') === 0) {
                getUtils().status("Error llegint .srt", "error");
                return false;
            }
            this._entries = window.FASTPASS_UI.Logic.SrtParser.srtToEntries(srtContent);
            this._srtPath = srtPath;
            this._srtName = srtPath.split('\\').pop().replace(/\.srt$/i, '');
            if (this._entries.length > 0) {
                this._maxSec = this._entries[this._entries.length - 1].endSec + 10;
            }
            log("📝 SRT_EDIT: " + this._entries.length + " entrades");
            this._isDirty = false;
            this._showEditor();
            this._startPolling();
            this._waveformPeaks = null;
            
            // Generar peaks de waveform via ffmpeg RAW + cep.fs
            try {
                var wg = window.FASTPASS_UI.Logic.WaveformGenerator;
                if (wg) {
                    var audioPath = await wg.getAudioPath();
                    if (audioPath) {
                        log("📝 SRT_EDIT: Audio path = " + audioPath);
                        var canvasW = Math.max(1800, this._maxSec * this._pixelsPerSec + 100);
                        var peaks = await wg.generatePeaks(audioPath, this._maxSec, canvasW);
                        if (peaks && peaks.length > 0) {
                            this._waveformPeaks = peaks;
                            log("📝 SRT_EDIT: " + peaks.length + " peaks carregats");
                        } else {
                            log("⚠️ SRT_EDIT: No s'han pogut generar peaks");
                        }
                    } else {
                        log("⚠️ SRT_EDIT: No s'ha pogut obtenir path d'audio");
                    }
                }
            } catch(e) {
                log("⚠️ SRT_EDIT: Error generant waveform: " + e.message);
            }
            
            // Carregar waveform des del fitxer .bin (WAV 8-bit 8000Hz)
            try {
                var wg = window.FASTPASS_UI.Logic.WaveformGenerator;
                var projFolder = await callJSX("Context.folder()");
                if (wg && projFolder) {
                    var binPath = await wg.getBinPath(projFolder);
                    if (binPath) {
                        log("📝 SRT_EDIT: Bin trovato: " + binPath);
                        var canvasW = Math.max(1800, this._maxSec * this._pixelsPerSec + 100);
                        var peaks = await wg.loadPeaksFromBin(binPath, canvasW);
                        if (peaks && peaks.length > 0) {
                            this._waveformPeaks = peaks;
                            log("📝 SRT_EDIT: " + peaks.length + " peaks carregats del .bin");
                        } else {
                            log("⚠️ SRT_EDIT: No s'han pogut carregar peaks del .bin");
                        }
                    } else {
                        log("⚠️ SRT_EDIT: No s'ha trobat fitxer .bin al directori del projecte");
                    }
                }
            } catch(e) {
                log("⚠️ SRT_EDIT: Error carregant .bin: " + e.message);
            }
            
            this.render();
            getUtils().status("SRT carregat: " + this._entries.length + " entrades", "exito");
            return true;
        },

        _showEditor: function () {
            var container = document.getElementById('srtEditorContainer');
            if (container) container.style.display = 'block';
            var preview = document.getElementById('srtPreview');
            if (preview) preview.style.display = 'block';
        },

        _hideEditor: function () {
            var container = document.getElementById('srtEditorContainer');
            if (container) container.style.display = 'none';
            var preview = document.getElementById('srtPreview');
            if (preview) preview.style.display = 'none';
            this.stop();
        },

        _startPolling: function () {
            if (this._pollInterval) clearInterval(this._pollInterval);
            var self = this;
            this._pollInterval = setInterval(async function () {
                try {
                    var cti = await callJSX("Timeline.get()");
                    if (cti && cti !== "null" && cti !== "") {
                        var sec = parseFloat(cti);
                        if (!isNaN(sec)) {
                            self._playheadSec = sec;
                            self.render();
                            self._updatePreview(sec);
                        }
                    }
                } catch(e) { }
            }, 400);
        },

        stop: function () {
            if (this._pollInterval) {
                clearInterval(this._pollInterval);
                this._pollInterval = null;
            }
        },

        togglePlay: function () {
            this._isPlaying = !this._isPlaying;
            var btn = document.getElementById('btnSrtPlay');
            var self = this;
            if (this._isPlaying) {
                callJSX("(function(){try{app.enableQE();qe.project.getActiveSequence().play();return'OK'}catch(e){return'ERR:'+e.message}})()").then(function(result){
                    log("📝 SRT: PLAY result: " + result);
                });
                if (btn) btn.innerHTML = '⏸ PAUSA';
                if (this._pollInterval) clearInterval(this._pollInterval);
                this._pollInterval = setInterval(async function () {
                    try {
                        var cti = await callJSX("Timeline.get()");
                        if (cti && cti !== "null" && cti !== "") {
                            var sec = parseFloat(cti);
                            if (!isNaN(sec)) {
                                self._playheadSec = sec; self.render(); self._updatePreview(sec);
                            }
                        }
                    } catch(e) { }
                }, 200);
            } else {
                callJSX("(function(){try{app.enableQE();qe.project.getActiveSequence().stop();return'OK'}catch(e){return'ERR:'+e.message}})()").then(function(result){
                    log("📝 SRT: STOP result: " + result);
                });
                if (btn) btn.innerHTML = '▶ PLAY';
                if (this._pollInterval) clearInterval(this._pollInterval);
                this._pollInterval = setInterval(async function () {
                    try {
                        var cti = await callJSX("Timeline.get()");
                        if (cti && cti !== "null" && cti !== "") {
                            var sec = parseFloat(cti);
                            if (!isNaN(sec)) { self._playheadSec = sec; self.render(); self._updatePreview(sec); }
                        }
                    } catch(e) { }
                }, 400);
            }
        },

        render: function () {
            if (!this._ctx || !this._canvas) return;
            var ctx = this._ctx;
            var canvasW = Math.max(1800, this._maxSec * this._pixelsPerSec + 100);
            // Orde: regle (24) + gap(4) + track(30) + gap(4) + waveform(40) + gap(4)
            var trackY = this._rulerHeight + 4;
            var waveformY = trackY + this._trackHeight + 4;
            var canvasH = waveformY + this._waveformHeight + 4;
            this._canvas.width = canvasW;
            this._canvas.height = canvasH;
            
            ctx.fillStyle = '#1a1a1a';
            ctx.fillRect(0, 0, canvasW, canvasH);
            
            this._drawRuler(ctx);
            this._drawTrack(ctx, trackY);
            this._drawWaveform(ctx, waveformY);
            this._drawPlayhead();
        },

        _drawRuler: function (ctx) {
            ctx.fillStyle = '#2a2a2a';
            ctx.fillRect(0, 0, this._canvas.width, this._rulerHeight);
            ctx.fillStyle = '#888';
            ctx.font = '9px monospace';
            ctx.strokeStyle = '#555';
            var secInterval = Math.max(1, Math.floor(40 / this._pixelsPerSec));
            for (var s = 0; s <= this._maxSec; s += secInterval) {
                var x = s * this._pixelsPerSec;
                ctx.beginPath();
                ctx.moveTo(x, this._rulerHeight - 6);
                ctx.lineTo(x, this._rulerHeight);
                ctx.stroke();
                var mm = Math.floor(s / 60);
                var ss = Math.floor(s % 60);
                ctx.fillText((mm < 10 ? '0' : '') + mm + ':' + (ss < 10 ? '0' : '') + ss, x + 2, this._rulerHeight - 2);
            }
        },

        _drawTrack: function (ctx, y) {
            var blockH = this._trackHeight - 4;
            ctx.fillStyle = '#2a1e4f';
            ctx.fillRect(0, y, this._canvas.width, this._trackHeight);
            ctx.fillStyle = '#8877aa';
            ctx.font = '9px sans-serif';
            ctx.fillText('Captions', 3, y + 10);
            for (var i = 0; i < this._entries.length; i++) {
                var e = this._entries[i];
                var x = e.startSec * this._pixelsPerSec;
                var w = (e.endSec - e.startSec) * this._pixelsPerSec;
                if (w < 2) w = 2;
                ctx.fillStyle = 'rgba(0,0,0,0.3)';
                ctx.fillRect(x + 1, y + 2 + 1, w, blockH);
                ctx.fillStyle = '#8f4ad4';
                ctx.fillRect(x, y + 2, w, blockH);
            }
        },

        _drawWaveform: function (ctx, y) {
            var wh = this._waveformHeight;
            ctx.fillStyle = '#0d2818';
            ctx.fillRect(0, y, this._canvas.width, wh);
            if (this._waveformPeaks && this._waveformPeaks.length > 0) {
                var midY = y + wh / 2;
                var step = Math.max(1, Math.floor(this._waveformPeaks.length / this._canvas.width));
                ctx.strokeStyle = '#22cc66';
                ctx.lineWidth = 1;
                for (var px = 0; px < this._canvas.width; px++) {
                    var idx = Math.floor(px * step);
                    if (idx >= this._waveformPeaks.length) break;
                    var h = Math.min(Math.abs(this._waveformPeaks[idx]) * (wh / 2), wh / 2);
                    ctx.beginPath();
                    ctx.moveTo(px, midY - h);
                    ctx.lineTo(px, midY + h);
                    ctx.stroke();
                }
            } else {
                // Sense dades: fons verd fosc buit
                ctx.fillStyle = '#0a1a0a';
                ctx.fillRect(0, y + 2, this._canvas.width, wh - 4);
            }
        },

        _drawPlayhead: function () {
            if (!this._ctx) return;
            var x = this._playheadSec * this._pixelsPerSec;
            var ctx = this._ctx;
            ctx.strokeStyle = '#ff3333';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, this._canvas.height);
            ctx.stroke();
            ctx.fillStyle = '#ff3333';
            ctx.beginPath();
            ctx.moveTo(x - 5, 0); ctx.lineTo(x + 5, 0); ctx.lineTo(x, 7);
            ctx.closePath();
            ctx.fill();
        },

        _updatePreview: function (ctiSec) {
            var entry = null;
            for (var i = 0; i < this._entries.length; i++) {
                if (ctiSec >= this._entries[i].startSec && ctiSec < this._entries[i].endSec) { entry = this._entries[i]; break; }
            }
            var div = document.getElementById('srtPreview');
            if (!div) return;
            if (entry) { div.innerHTML = entry.texts.join('<br>'); } else { div.innerHTML = ''; }
        },

        setPlayhead: function (sec) {
            if (sec < 0) sec = 0;
            this._playheadSec = sec;
            callJSX("Timeline.set(" + sec.toFixed(3) + ")");
            this.render();
            this._updatePreview(sec);
        },

        applyIn: function () {
            var cti = this._playheadSec;
            var targetIdx = window.FASTPASS_UI.Logic.SrtParser.findTargetByTime(this._entries, cti);
            if (targetIdx < 0) { getUtils().status("CTI no sobre cap caption", "warn"); return; }
            this._entries = window.FASTPASS_UI.Logic.SrtParser.applyTrimIn(this._entries, targetIdx, 0.4);
            this._isDirty = true; this.render();
            getUtils().status("IN: " + this._entries.length + " entrades", "exito");
        },

        applyOut: function () {
            var cti = this._playheadSec;
            var targetIdx = window.FASTPASS_UI.Logic.SrtParser.findTargetByTime(this._entries, cti);
            if (targetIdx < 0) { getUtils().status("CTI no sobre cap caption", "warn"); return; }
            this._entries = window.FASTPASS_UI.Logic.SrtParser.applyTrimOut(this._entries, targetIdx);
            this._isDirty = true; this.render();
            getUtils().status("OUT: " + this._entries.length + " entrades", "exito");
        },

        applyAdjust: function () {
            var cti = this._playheadSec;
            this._entries = window.FASTPASS_UI.Logic.SrtParser.applyTimeAdjust(this._entries, cti, 0.04);
            this._isDirty = true; this.render();
            getUtils().status("AJUSTAT: " + this._entries.length + " entrades", "exito");
        },

        exportToPremiere: async function () {
            if (this._entries.length === 0) { getUtils().status("No hi ha entrades per exportar", "warn"); return; }
            this._hideEditor();
            var projectFolder = await callJSX("Context.folder()");
            if (!projectFolder || projectFolder.indexOf('ERR') === 0) projectFolder = "C:\\temp";
            var projName = this._srtName || "subtitles";
            var modName = projName + "_MOD.srt";
            var modPath = projectFolder + "\\" + modName;
            log("📝 SRT_EDIT: Exportant a " + modPath);
            var srtContent = window.FASTPASS_UI.Logic.SrtParser.entriesToSrt(this._entries);
            if (!srtContent) { getUtils().status("Error generant SRT", "error"); return; }
            var escapedPath = modPath.replace(/\\/g, '\\\\');
            var escapedContent = srtContent.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '');
            var writeResult = await callJSX("IO.writeTxt('" + escapedPath + "','" + escapedContent + "')");
            if (writeResult !== "OK") {
                try { window.cep.fs.writeFile(modPath, srtContent); } catch(e) { getUtils().status("Error escrivint _MOD.srt", "error"); return; }
            }
            var importResult = await callJSX("(function(){try{app.project.importFiles(['" + modPath.replace(/\\/g, '/') + "'],true,app.project.rootItem,false);return'OK'}catch(e){return'ERR:'+e.message}})()");
            if (importResult !== "OK") { getUtils().status("Error important _MOD.srt", "error"); return; }
            var escapedModName = encodeURIComponent(modName);
            var findResult = await callJSX("FASTPASS.Project.find(decodeURIComponent('" + escapedModName + "'))");
            if (!findResult || findResult === 'null') { getUtils().status("No es troba _MOD.srt al projecte", "error"); return; }
            var captionResult = await callJSX("(function(){var s=app.project.activeSequence;if(!s)return'ERR_NO_SEQ';var i=FASTPASS.Project.find(decodeURIComponent('" + encodeURIComponent(modName) + "'));if(!i)return'ERR_ITEM_NOT_FOUND';if(typeof s.createCaptionTrack!=='function')return'ERR_NO_CAPTION_API';return s.createCaptionTrack(i,0)?'OK':'ERR_FAILED'})()");
            if (captionResult === "OK") {
                getUtils().status("Exportat: " + this._entries.length + " entrades", "exito");
                log("✅ SRT_EDIT: Export OK " + modName);
            } else { getUtils().status("Error createCaptionTrack: " + captionResult, "error"); }
        },

        reset: function () {
            this.stop();
            this._entries = []; this._playheadSec = 0; this._isDirty = false; this._srtPath = ""; this._srtName = "";
            this._waveformPeaks = null; this._isPlaying = false;
            if (this._ctx) this._ctx.clearRect(0, 0, this._canvas.width, this._canvas.height);
            this._hideEditor();
        }
    };

    window.FASTPASS_UI.Editor.SrtEditor = FASTPASS_UI.Editor.SrtEditor;
    window.SrtEditor = FASTPASS_UI.Editor.SrtEditor;
})();