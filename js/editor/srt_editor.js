/**
 * ============================================================================
 * SRT EDITOR: Pseudotimeline dins l'extensió
 * Renderitza: regle de temps + 2 tracks virtuals de captions
 * Permet: IN, OUT, AJUSTAR, drag & drop, ripple editing
 * Exporta: PROJEECTE_MOD.srt → import → createCaptionTrack
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
        _rulerHeight: 30,
        _playheadSec: 0,
        _pollInterval: null,
        _srtPath: "",
        _srtName: "",
        _canvas: null,
        _ctx: null,
        _isDirty: false,

        /**
         * Inicialitza l'editor: agafa referència al canvas i connecta events
         */
        init: function () {
            this._canvas = document.getElementById('srtCanvas');
            if (!this._canvas) return false;
            this._ctx = this._canvas.getContext('2d');
            var self = this;

            // Clic al canvas per moure playhead
            this._canvas.addEventListener('click', function (e) {
                var rect = self._canvas.getBoundingClientRect();
                var scaleX = self._canvas.width / rect.width;
                var canvasX = (e.clientX - rect.left) * scaleX;
                var sec = canvasX / self._pixelsPerSec;
                self.setPlayhead(sec);
            });

            return true;
        },

        /**
         * Carrega un .srt
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
         * Mostra el contenidor de l'editor
         */
        _showEditor: function () {
            var container = document.getElementById('srtEditorContainer');
            if (container) container.style.display = 'block';
        },

        /**
         * Inicia polling del CTI
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
                } catch(e) { /* ignore polling errors */ }
            }, 400);
        },

        /**
         * Atura polling
         */
        stop: function () {
            if (this._pollInterval) {
                clearInterval(this._pollInterval);
                this._pollInterval = null;
            }
        },

        /**
         * Renderitza tot
         */
        render: function () {
            if (!this._ctx || !this._canvas) return;
            var ctx = this._ctx;

            var canvasW = Math.max(1200, this._maxSec * this._pixelsPerSec + 100);
            var canvasH = this._rulerHeight + this._trackHeight * 2 + 10;
            this._canvas.width = canvasW;
            this._canvas.height = canvasH;

            // Fons
            ctx.fillStyle = '#1a1a1a';
            ctx.fillRect(0, 0, canvasW, canvasH);

            this._drawRuler(ctx);
            this._drawTrackBackgrounds(ctx);
            this._drawCaptionBlocks(ctx);
            this._drawPlayhead();
        },

        /**
         * Regle de temps
         */
        _drawRuler: function (ctx) {
            ctx.fillStyle = '#2a2a2a';
            ctx.fillRect(0, 0, this._canvas.width, this._rulerHeight);
            ctx.fillStyle = '#888';
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
         * Fons dels 2 tracks
         */
        _drawTrackBackgrounds: function (ctx) {
            var yA = this._rulerHeight;
            var yB = yA + this._trackHeight + 5;
            ctx.fillStyle = '#1e3a5f';
            ctx.fillRect(0, yA, this._canvas.width, this._trackHeight);
            ctx.fillStyle = '#2a1e4f';
            ctx.fillRect(0, yB, this._canvas.width, this._trackHeight);
            ctx.fillStyle = '#667';
            ctx.font = '10px sans-serif';
            ctx.fillText('Track A', 5, yA + 12);
            ctx.fillText('Track B', 5, yB + 12);
        },

        /**
         * Blocs de captions
         */
        _drawCaptionBlocks: function (ctx) {
            var yA = this._rulerHeight + 3;
            var yB = yA + this._trackHeight + 5;
            var blockH = this._trackHeight - 6;

            for (var i = 0; i < this._entries.length; i++) {
                var e = this._entries[i];
                var x = e.startSec * this._pixelsPerSec;
                var w = (e.endSec - e.startSec) * this._pixelsPerSec;
                if (w < 3) w = 3;

                var isTrackA = (i % 2 === 0);
                var y = isTrackA ? yA : yB;
                var color = isTrackA ? '#3a8fd4' : '#8f4ad4';

                // Ombra
                ctx.fillStyle = 'rgba(0,0,0,0.4)';
                ctx.fillRect(x + 2, y + 2, w, blockH);
                // Bloc
                ctx.fillStyle = color;
                ctx.fillRect(x, y, w, blockH);
                // Text
                if (w > 30) {
                    ctx.fillStyle = '#fff';
                    ctx.font = '9px sans-serif';
                    var label = e.texts[0] || '';
                    if (label.length > Math.floor(w / 7)) label = label.substring(0, Math.floor(w / 7)) + '...';
                    ctx.fillText(label, x + 3, y + blockH / 2 + 3);
                }
            }
        },

        /**
         * Playhead
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
         * Ressalta caption actual al panell preview
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
         * Mou el CTI a Premiere i actualitza playhead
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
         * Exporta a Premiere: escriu _MOD.srt i fa createCaptionTrack
         */
        exportToPremiere: async function () {
            if (this._entries.length === 0) {
                getUtils().status("No hi ha entrades per exportar", "warn");
                return;
            }

            // 1. Directori del projecte
            var projectFolder = await callJSX("Context.folder()");
            if (!projectFolder || projectFolder.indexOf('ERR') === 0) {
                projectFolder = "C:\\temp";
            }

            // 2. Nom del fitxer
            var projName = this._srtName || "subtitles";
            var modName = projName + "_MOD.srt";
            var modPath = projectFolder + "\\" + modName;
            log("📝 SRT_EDIT: Exportant a " + modPath);

            // 3. Generar SRT
            var srtContent = window.FASTPASS_UI.Logic.SrtParser.entriesToSrt(this._entries);
            if (!srtContent) {
                getUtils().status("Error generant SRT", "error");
                return;
            }

            // 4. Escriure .srt
            var escapedPath = modPath.replace(/\\/g, '\\\\');
            var escapedContent = srtContent
                .replace(/\\/g, '\\\\')
                .replace(/'/g, "\\'")
                .replace(/\n/g, '\\n')
                .replace(/\r/g, '');
            var writeResult = await callJSX("IO.writeTxt('" + escapedPath + "','" + escapedContent + "')");
            if (writeResult !== "OK") {
                // Fallback: cep.fs.writeFile
                try {
                    window.cep.fs.writeFile(modPath, srtContent);
                } catch(e) {
                    getUtils().status("Error escrivint _MOD.srt", "error");
                    return;
                }
            }

            // 5. Importar al projecte
            var importResult = await callJSX("(function(){try{app.project.importFiles(['" + modPath.replace(/\\/g, '/') + "'],true,app.project.rootItem,false);return'OK'}catch(e){return'ERR:'+e.message}})()");
            if (importResult !== "OK") {
                getUtils().status("Error important _MOD.srt", "error");
                return;
            }

            // 6. Buscar item al projecte
            var escapedModName = encodeURIComponent(modName);
            var findResult = await callJSX("FASTPASS.Project.find(decodeURIComponent('" + escapedModName + "'))");
            if (!findResult || findResult === 'null') {
                getUtils().status("No es troba _MOD.srt al projecte", "error");
                return;
            }

            // 7. createCaptionTrack
            var captionResult = await callJSX("(function(){var s=app.project.activeSequence;if(!s)return'ERR_NO_SEQ';var i=FASTPASS.Project.find(decodeURIComponent('" + encodeURIComponent(modName) + "'));if(!i)return'ERR_ITEM_NOT_FOUND';if(typeof s.createCaptionTrack!=='function')return'ERR_NO_CAPTION_API';return s.createCaptionTrack(i,0)?'OK':'ERR_FAILED'})()");
            if (captionResult === "OK") {
                getUtils().status("Exportat: " + this._entries.length + " entrades a Premiere", "exito");
                log("✅ SRT_EDIT: Export OK " + modName);
            } else {
                getUtils().status("Error createCaptionTrack: " + captionResult, "error");
            }
        },

        /**
         * Neteja tot
         */
        reset: function () {
            this.stop();
            this._entries = [];
            this._playheadSec = 0;
            this._isDirty = false;
            this._srtPath = "";
            this._srtName = "";
            if (this._ctx) {
                this._ctx.clearRect(0, 0, this._canvas.width, this._canvas.height);
            }
            document.getElementById('srtEditorContainer').style.display = 'none';
        }
    };

    window.FASTPASS_UI.Editor.SrtEditor = FASTPASS_UI.Editor.SrtEditor;
    window.SrtEditor = FASTPASS_UI.Editor.SrtEditor;
})();