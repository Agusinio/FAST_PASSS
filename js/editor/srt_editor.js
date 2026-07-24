/**
 * ============================================================================
 * SRT EDITOR: Pseudotimeline dins l'extensió
 * Renderitza: regle de temps + waveform + Track B amb captions
 * Permet: IN, OUT, AJUSTAR, zoom, drag & drop, ripple editing
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
        _trackHeight: 50,
        _waveformHeight: 60,
        _rulerHeight: 30,
        _playheadSec: 0,
        _pollInterval: null,
        _srtPath: "",
        _srtName: "",
        _canvas: null,
        _ctx: null,
        _isDirty: false,
        _waveformPeaks: null,

        /**
         * Inicialitza
         */
        init: function () {
            this._canvas = document.getElementById('srtCanvas');
            if (!this._canvas) return false;
            this._ctx = this._canvas.getContext('2d');
            var self = this;

            // Click al canvas per moure playhead
            this._canvas.addEventListener('click', function (e) {
                var rect = self._canvas.getBoundingClientRect();
                var scaleX = self._canvas.width / rect.width;
                var canvasX = (e.clientX - rect.left) * scaleX;
                var sec = canvasX / self._pixelsPerSec;
                self.setPlayhead(sec);
            });

            // Connectar slider zoom
            var zoomSlider = document.getElementById('srtZoom');
            if (zoomSlider) {
                zoomSlider.addEventListener('input', function () {
                    self._pixelsPerSec = parseInt(this.value);
                    var label = document.getElementById('zoomLabel');
                    if (label) label.textContent = this.value + 'px/s';
                    self.render();
                });
            }

            return true;
        },

        /**
         * Carrega un .srt i el .pek associat
         */
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
            this.render();
            this._startPolling();

            document.getElementById('srtEditorStatus').textContent = "Carregat: " + this._srtName;
            document.getElementById('srtEntryCount').textContent = this._entries.length + " entrades";
            getUtils().status("SRT carregat: " + this._entries.length + " entrades", "exito");
            return true;
        },

        /**
         * Mostra el contenidor
         */
        _showEditor: function () {
            var container = document.getElementById('srtEditorContainer');
            if (container) container.style.display = 'block';
        },

        /**
         * Polling del CTI
         */
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
                            self._drawPlayhead();
                            self._highlightCurrentCaption(sec);
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

        /**
         * Renderitza: regle + waveform (placeholder) + Track B
         */
        render: function () {
            if (!this._ctx || !this._canvas) return;
            var ctx = this._ctx;

            var canvasW = Math.max(1800, this._maxSec * this._pixelsPerSec + 100);
            var canvasH = this._rulerHeight + this._waveformHeight + 5 + this._trackHeight + 10;
            this._canvas.width = canvasW;
            this._canvas.height = canvasH;

            // Fons
            ctx.fillStyle = '#1a1a1a';
            ctx.fillRect(0, 0, canvasW, canvasH);

            this._drawRuler(ctx);
            this._drawWaveform(ctx);
            this._drawTrackB(ctx);
            this._drawPlayhead();
        },

        /**
         * Regle de temps
         */
        _drawRuler: function (ctx) {
            var y = 0;
            ctx.fillStyle = '#2a2a2a';
            ctx.fillRect(0, y, this._canvas.width, this._rulerHeight);
            ctx.fillStyle = '#aaa';
            ctx.font = '10px monospace';
            ctx.strokeStyle = '#555';

            var secInterval = Math.max(1, Math.floor(50 / this._pixelsPerSec));
            for (var s = 0; s <= this._maxSec; s += secInterval) {
                var x = s * this._pixelsPerSec;
                ctx.beginPath();
                ctx.moveTo(x, this._rulerHeight - 8);
                ctx.lineTo(x, this._rulerHeight);
                ctx.stroke();
                var hh = Math.floor(s / 3600);
                var mm = Math.floor((s % 3600) / 60);
                var ss = Math.floor(s % 60);
                var t = (hh > 0 ? hh + ':' : '') + (mm < 10 ? '0' : '') + mm + ':' + (ss < 10 ? '0' : '') + ss;
                ctx.fillText(t, x + 3, this._rulerHeight - 2);
            }
        },

        /**
         * Waveform (placeholder amb .pek si es carrega, o barres de mostra)
         */
        _drawWaveform: function (ctx) {
            var y = this._rulerHeight + 2;
            var wh = this._waveformHeight;
            var ww = this._canvas.width;

            ctx.fillStyle = '#0d2818';
            ctx.fillRect(0, y, ww, wh);

            if (this._waveformPeaks && this._waveformPeaks.length > 0) {
                // Dibuixar peaks reals
                var peaks = this._waveformPeaks;
                var step = Math.max(1, Math.floor(peaks.length / ww));
                var midY = y + wh / 2;
                ctx.strokeStyle = '#22cc66';
                ctx.lineWidth = 1;

                for (var px = 0; px < ww; px++) {
                    var idx = Math.floor(px * step);
                    if (idx >= peaks.length) break;
                    var peak = peaks[idx] * 0.5;
                    var h = Math.min(peak * (wh / 2), wh / 2);
                    ctx.beginPath();
                    ctx.moveTo(px, midY - h);
                    ctx.lineTo(px, midY + h);
                    ctx.stroke();
                }
            } else {
                // Placeholder: mostrar zones amb captions
                ctx.fillStyle = '#1a4a2a';
                for (var i = 0; i < this._entries.length; i++) {
                    var e = this._entries[i];
                    var x = e.startSec * this._pixelsPerSec;
                    var w = (e.endSec - e.startSec) * this._pixelsPerSec;
                    if (w < 4) w = 4;
                    ctx.fillRect(x, y + 4, w, wh - 8);
                }
                ctx.fillStyle = '#228844';
                ctx.font = '10px sans-serif';
                ctx.fillText('Waveform (sense dades)', 5, y + wh / 2 + 3);
            }
        },

        /**
         * Track B: TOTS els captions
         */
        _drawTrackB: function (ctx) {
            var y = this._rulerHeight + this._waveformHeight + 8;
            var blockH = this._trackHeight - 6;

            // Fons del track
            ctx.fillStyle = '#2a1e4f';
            ctx.fillRect(0, y, this._canvas.width, this._trackHeight);
            ctx.fillStyle = '#8877aa';
            ctx.font = '10px sans-serif';
            ctx.fillText('Captions', 5, y + 12);

            // Totes les entrades a Track B
            for (var i = 0; i < this._entries.length; i++) {
                var e = this._entries[i];
                var x = e.startSec * this._pixelsPerSec;
                var w = (e.endSec - e.startSec) * this._pixelsPerSec;
                if (w < 3) w = 3;

                var color = '#8f4ad4';

                // Ombra
                ctx.fillStyle = 'rgba(0,0,0,0.4)';
                ctx.fillRect(x + 2, y + 3 + 2, w, blockH);
                // Bloc
                ctx.fillStyle = color;
                ctx.fillRect(x, y + 3, w, blockH);
                // Text (primer text o num index)
                if (w > 30) {
                    ctx.fillStyle = '#fff';
                    ctx.font = '9px sans-serif';
                    var label = e.texts[0] || '';
                    if (label.length > Math.floor(w / 7)) label = label.substring(0, Math.floor(w / 7)) + '...';
                    ctx.fillText(label, x + 3, y + 3 + blockH / 2 + 3);
                }
            }
        },

        /**
         * Playhead vermell
         */
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
            ctx.moveTo(x - 5, 0);
            ctx.lineTo(x + 5, 0);
            ctx.lineTo(x, 7);
            ctx.closePath();
            ctx.fill();
        },

        /**
         * Preview del caption al CTI
         */
        _highlightCurrentCaption: function (ctiSec) {
            var entry = null;
            for (var i = 0; i < this._entries.length; i++) {
                if (ctiSec >= this._entries[i].startSec && ctiSec < this._entries[i].endSec) {
                    entry = this._entries[i];
                    break;
                }
            }
            var div = document.getElementById('srtPreview');
            if (!div) return;
            if (entry) {
                div.innerHTML = '<span style="color:#ff8844;">#' + entry.index + '</span> ' +
                    entry.texts.join('<br>') +
                    '<span style="color:#888;margin-left:8px;">[' +
                    window.FASTPASS_UI.Logic.SrtParser.secToSrtTime(entry.startSec) + ' → ' +
                    window.FASTPASS_UI.Logic.SrtParser.secToSrtTime(entry.endSec) + ']</span>';
            } else {
                div.innerHTML = '<em style="color:#666;">Sense subtítol en aquesta posició</em>';
            }
        },

        /**
         * Mou el CTI a Premiere
         */
        setPlayhead: function (sec) {
            if (sec < 0) sec = 0;
            this._playheadSec = sec;
            callJSX("Timeline.set(" + sec.toFixed(3) + ")");
            this._drawPlayhead();
            this._highlightCurrentCaption(sec);
        },

        /**
         * IN
         */
        applyIn: function () {
            var cti = this._playheadSec;
            var targetIdx = window.FASTPASS_UI.Logic.SrtParser.findTargetByTime(this._entries, cti);
            if (targetIdx < 0) {
                getUtils().status("CTI no sobre cap caption", "warn");
                return;
            }
            this._entries = window.FASTPASS_UI.Logic.SrtParser.applyTrimIn(this._entries, targetIdx, 0.4);
            this._isDirty = true;
            this.render();
            document.getElementById('srtEntryCount').textContent = this._entries.length + " entrades";
            getUtils().status("IN: " + this._entries.length + " entrades", "exito");
        },

        /**
         * OUT
         */
        applyOut: function () {
            var cti = this._playheadSec;
            var targetIdx = window.FASTPASS_UI.Logic.SrtParser.findTargetByTime(this._entries, cti);
            if (targetIdx < 0) {
                getUtils().status("CTI no sobre cap caption", "warn");
                return;
            }
            this._entries = window.FASTPASS_UI.Logic.SrtParser.applyTrimOut(this._entries, targetIdx);
            this._isDirty = true;
            this.render();
            document.getElementById('srtEntryCount').textContent = this._entries.length + " entrades";
            getUtils().status("OUT: " + this._entries.length + " entrades", "exito");
        },

        /**
         * AJUSTAR
         */
        applyAdjust: function () {
            var cti = this._playheadSec;
            this._entries = window.FASTPASS_UI.Logic.SrtParser.applyTimeAdjust(this._entries, cti, 0.04);
            this._isDirty = true;
            this.render();
            document.getElementById('srtEntryCount').textContent = this._entries.length + " entrades";
            getUtils().status("AJUSTAT: " + this._entries.length + " entrades", "exito");
        },

        /**
         * Exporta
         */
        exportToPremiere: async function () {
            if (this._entries.length === 0) {
                getUtils().status("No hi ha entrades per exportar", "warn");
                return;
            }

            var projectFolder = await callJSX("Context.folder()");
            if (!projectFolder || projectFolder.indexOf('ERR') === 0) {
                projectFolder = "C:\\temp";
            }

            var projName = this._srtName || "subtitles";
            var modName = projName + "_MOD.srt";
            var modPath = projectFolder + "\\" + modName;
            log("📝 SRT_EDIT: Exportant a " + modPath);

            var srtContent = window.FASTPASS_UI.Logic.SrtParser.entriesToSrt(this._entries);
            if (!srtContent) {
                getUtils().status("Error generant SRT", "error");
                return;
            }

            var escapedPath = modPath.replace(/\\/g, '\\\\');
            var escapedContent = srtContent
                .replace(/\\/g, '\\\\')
                .replace(/'/g, "\\'")
                .replace(/\n/g, '\\n')
                .replace(/\r/g, '');
            var writeResult = await callJSX("IO.writeTxt('" + escapedPath + "','" + escapedContent + "')");
            if (writeResult !== "OK") {
                try { window.cep.fs.writeFile(modPath, srtContent); } catch(e) {
                    getUtils().status("Error escrivint _MOD.srt", "error");
                    return;
                }
            }

            var importResult = await callJSX("(function(){try{app.project.importFiles(['" + modPath.replace(/\\/g, '/') + "'],true,app.project.rootItem,false);return'OK'}catch(e){return'ERR:'+e.message}})()");
            if (importResult !== "OK") {
                getUtils().status("Error important _MOD.srt", "error");
                return;
            }

            var escapedModName = encodeURIComponent(modName);
            var findResult = await callJSX("FASTPASS.Project.find(decodeURIComponent('" + escapedModName + "'))");
            if (!findResult || findResult === 'null') {
                getUtils().status("No es troba _MOD.srt al projecte", "error");
                return;
            }

            var captionResult = await callJSX("(function(){var s=app.project.activeSequence;if(!s)return'ERR_NO_SEQ';var i=FASTPASS.Project.find(decodeURIComponent('" + encodeURIComponent(modName) + "'));if(!i)return'ERR_ITEM_NOT_FOUND';if(typeof s.createCaptionTrack!=='function')return'ERR_NO_CAPTION_API';return s.createCaptionTrack(i,0)?'OK':'ERR_FAILED'})()");
            if (captionResult === "OK") {
                getUtils().status("Exportat: " + this._entries.length + " entrades a Premiere", "exito");
                log("✅ SRT_EDIT: Export OK " + modName);
            } else {
                getUtils().status("Error createCaptionTrack: " + captionResult, "error");
            }
        },

        reset: function () {
            this.stop();
            this._entries = [];
            this._playheadSec = 0;
            this._isDirty = false;
            this._srtPath = "";
            this._srtName = "";
            this._waveformPeaks = null;
            if (this._ctx) {
                this._ctx.clearRect(0, 0, this._canvas.width, this._canvas.height);
            }
            document.getElementById('srtEditorContainer').style.display = 'none';
        }
    };

    window.FASTPASS_UI.Editor.SrtEditor = FASTPASS_UI.Editor.SrtEditor;
    window.SrtEditor = FASTPASS_UI.Editor.SrtEditor;
})();