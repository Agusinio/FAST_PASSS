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
        _waveformPPS: 480,
        _waveformSegments: [],
        _waveformMediaTag: "",
        _wfMediaStart: 0,
        _wfMediaEnd: 0,
        _pollCount: 0,
        _localPlayInterval: null,
        _ctiSec: 0,
        _ctiAt: 0,
        _lastCtiSec: -1,
        _lastLocalT: -1,
        _lastLocalPx: -1,
        _isPlaying: false,
        _markers: [],
        _editMode: "move",
        _dragIdx: -1,
        _dragSnapshot: null,
        _didDrag: false,
        _suppressClick: false,
        _MARKER_TOL_PX: 7,
        _lastSegLog: -1,

        init: function () {
            this._canvas = document.getElementById('srtCanvas');
            if (!this._canvas) return false;
            this._ctx = this._canvas.getContext('2d');
            var self = this;

            this._canvas.addEventListener('click', function (e) {
                if (self._suppressClick) { self._suppressClick = false; return; }
                self.setPlayhead(self._canvasXToSec(e));
            });

            // Click dret: crear marcador (o esborrar-lo si ja n'hi ha un a sota)
            this._canvas.addEventListener('contextmenu', function (e) {
                e.preventDefault();
                var sec = self._canvasXToSec(e);
                var idx = self._markerAtSec(sec);
                if (idx >= 0) {
                    self._markers.splice(idx, 1);
                    log("📝 SRT_EDIT: Marcador esborrat a " + sec.toFixed(2) + "s");
                } else {
                    self._markers.push(sec);
                    self._markers.sort(function (a, b) { return a - b; });
                    log("📝 SRT_EDIT: Marcador creat a " + sec.toFixed(2) + "s");
                }
                self._isDirty = true;
                self.render();
                self._persistMarkers();
            });

            // Botó esquerre sobre un marcador: possible arrossegament.
            // El click NOMÉS se suprimeix si hi ha hagut moviment real (_didDrag);
            // un click simple sobre un marcador posiciona el playhead normalment.
            this._canvas.addEventListener('mousedown', function (e) {
                if (e.button !== 0) return;
                var idx = self._markerAtSec(self._canvasXToSec(e));
                if (idx < 0) return;
                self._dragIdx = idx;
                self._didDrag = false;
                self._dragSnapshot = {
                    entries: self._entries.map(function (en) { return { index: en.index, timeStr: en.timeStr, texts: en.texts.slice(), startSec: en.startSec, endSec: en.endSec }; }),
                    markers: self._markers.slice()
                };
                e.preventDefault();
            });
            this._canvas.addEventListener('mousemove', function (e) {
                if (self._dragIdx >= 0) {
                    self._didDrag = true;
                    self._applyMarkerDrag(self._canvasXToSec(e));
                    self.render();
                }
            });
            var endDrag = function () {
                if (self._dragIdx >= 0) {
                    self._dragIdx = -1;
                    self._dragSnapshot = null;
                    if (self._didDrag) {
                        self._suppressClick = true; // el click del mouseup no ha de moure el playhead
                        self._isDirty = true;
                        self._persistMarkers();
                    }
                    self._didDrag = false;
                }
            };
            this._canvas.addEventListener('mouseup', endDrag);
            this._canvas.addEventListener('mouseleave', endDrag);

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
            var btnMode = document.getElementById('btnSrtMode');
            if (btnMode) {
                btnMode.addEventListener('click', function () {
                    self._editMode = (self._editMode === 'move') ? 'scaleBoth' : 'move';
                    btnMode.textContent = (self._editMode === 'move') ? '⇒ MOURE' : '⇄ AMBDÓS';
                    btnMode.style.background = (self._editMode === 'move') ? '' : '#5a4a2a';
                    getUtils().status('Mode marcadors: ' + (self._editMode === 'move' ? 'MOURE (dreta solidària)' : 'ESCALA AMBDÓS COSTATS'), 'exito');
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
            this._markers = [];
            await this._restoreMarkers();

            // Carregar waveform des del fitxer .bin (WAV 8-bit 480Hz, 1 byte = 1 peak)
            try {
                var wg = window.FASTPASS_UI.Logic.WaveformGenerator;
                var projFolder = await callJSX("Context.folder()");
                if (wg && projFolder) {
                    var binPath = await wg.getBinPath(projFolder);
                    if (binPath) {
                        log("📝 SRT_EDIT: Bin trovato: " + binPath);
                        var wfResult = await wg.loadPeaksFromBin(binPath, 480);
                        if (wfResult && wfResult.peaks && wfResult.peaks.length > 0) {
                            this._waveformPeaks = wfResult.peaks;
                            this._waveformPPS = wfResult.peaksPerSec || 480;
                            this._waveformMediaTag = binPath.split(/[\\/]/).pop().toUpperCase().replace(/_AUDIO_REF\.BIN$/i, '').replace(/\.BIN$/i, '');
                            log("📝 SRT_EDIT: " + wfResult.peaks.length + " peaks (" + this._waveformPPS + "/s, " + wfResult.durSec.toFixed(1) + "s)");
                            await this._refreshWaveformSegments();
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
            this._pollInterval = setInterval(function () { self._pollTick(); }, 400);
            // Seguiment CONTINU del cabezal (funciona amb PLAY de Premiere —espai/barra—,
            // amb el botó ▶ de l'extensió i amb scrubbing): s'estima el CTI a 1× (el
            // temps de timeline sempre avança a 1×) i es converteix a media. El poll
            // (400ms) corregeix la base. El suavitzat evita salts.
            if (this._localPlayInterval) clearInterval(this._localPlayInterval);
            this._localPlayInterval = setInterval(function () {
                var now = (window.performance && performance.now) ? performance.now() : Date.now();
                var estTl = self._ctiSec + (now - self._ctiAt) / 1000; // tl avança a 1×
                if (estTl < 0) estTl = 0;
                var mPh = self._mediaAtSec(estTl);
                var ph = (mPh < 0) ? estTl : mPh;
                self._playheadSec += (ph - self._playheadSec) * 0.6;
                if (Math.abs(self._playheadSec - self._lastLocalT) < 0.02) return;
                self._lastLocalT = self._playheadSec;
                self.render();
                self._updatePreview(self._playheadSec);
            }, 66);
        },

        _pollTick: async function () {
            try {
                var now0 = (window.performance && performance.now) ? performance.now() : Date.now();
                var cti = await callJSX("Timeline.get()");
                var now1 = (window.performance && performance.now) ? performance.now() : Date.now();
                if (cti && cti !== "null" && cti !== "") {
                    var sec = parseFloat(cti);
                    if (!isNaN(sec)) {
                        this._ctiSec = sec; // CTI real de Premiere (temps de timeline)
                        // El CTI llegat correspon a ~mig vol del evalScript (compensa latència)
                        this._ctiAt = now0 + (now1 - now0) / 2;
                        // Posició real en MEDIA
                        var mediaPh = this._mediaAtSec(sec);
                        var realPh = (mediaPh < 0) ? sec : mediaPh;
                        // Si el CTI no avança (pausa) → posicionar exacte; si avança → log diagnòstic
                        if (Math.abs(sec - this._lastCtiSec) < 0.01) {
                            this._playheadSec = realPh;
                        } else {
                            log("⏱ PLY tl=" + sec.toFixed(2) + " real=" + realPh.toFixed(2) + " show=" + this._playheadSec.toFixed(2) + " rtt=" + Math.round(now1 - now0) + "ms");
                        }
                        this._lastCtiSec = sec;
                        this._updatePreview(this._playheadSec);
                    }
                }
                this._pollCount = (this._pollCount || 0) + 1;
                if (this._pollCount % 5 === 1) { await this._refreshWaveformSegments(); }
                this.render();
            } catch(e) { }
        },

        /**
         * Llegeix els clips de vídeo de la seqüència i construeix el mapa
         * temps_timeline → temps_media, perquè la waveform correspongui
         * a l'àudio que realment sona al timeline (IN/OUT/talls inclosos).
         */
        _refreshWaveformSegments: async function () {
            try {
                var tag = (this._waveformMediaTag || "").replace(/'/g, "");
                // Mateixa seqüència que el cabezal (getWorkSequence = projecte ancorat)
                var jsx = "(function(){try{var seq=($.global.FASTPASS&&FASTPASS.Context)?FASTPASS.Context.getWorkSequence():app.project.activeSequence;if(!seq)return'[]';var segs=[];var all=[];"
                    + "for(var v=0;v<seq.videoTracks.numTracks;v++){var clips=seq.videoTracks[v].clips;"
                    + "for(var i=0;i<clips.numItems;i++){var c=clips[i];var nm='';try{nm=c.projectItem?c.projectItem.name:''}catch(e2){}"
                    + "var o={v:v,s:c.start.seconds,e:c.end.seconds,m:c.inPoint.seconds,m2:c.outPoint.seconds,n:nm};all.push(o);"
                    + "if('" + tag + "'===''||nm.toUpperCase().indexOf('" + tag + "')>=0)segs.push(o)}}"
                    + "if(segs.length===0)segs=all;return JSON.stringify({seqName:String(seq.name),segs:segs})}catch(e){return'ERR:'+e.message}})()";
                var raw = await callJSX(jsx);
                if (!raw || raw.indexOf('ERR') === 0) return;
                var parsed = JSON.parse(raw);
                var arr = parsed.segs || (Array.isArray(parsed) ? parsed : []);
                var segs = [];
                for (var i = 0; i < arr.length; i++) {
                    var o = arr[i];
                    if (!isFinite(o.s) || !isFinite(o.e) || !isFinite(o.m) || !isFinite(o.m2)) continue;
                    var r = 1;
                    if (o.e > o.s && o.m2 > o.m) r = (o.m2 - o.m) / (o.e - o.s);
                    segs.push({ v: o.v, s: o.s, e: o.e, m: o.m, r: r, n: o.n || "" });
                }
                segs.sort(function (a, b) { return a.v - b.v || a.s - b.s; });
                this._waveformSegments = segs;
                // Rang de media cobert pel timeline (recurs de la WF al trimeo real)
                var wfStart = Infinity, wfEnd = -Infinity;
                for (var wi = 0; wi < segs.length; wi++) {
                    var mIn = segs[wi].m;
                    var mOut = segs[wi].m + (segs[wi].e - segs[wi].s) * segs[wi].r;
                    if (mIn < wfStart) wfStart = mIn;
                    if (mOut > wfEnd) wfEnd = mOut;
                }
                this._wfMediaStart = isFinite(wfStart) ? wfStart : 0;
                this._wfMediaEnd = isFinite(wfEnd) ? wfEnd : 0;
                // Log diagnòstic quan canvia el mapa (o primer cop): resum de medias + primers segments
                if (this._lastSegLog !== segs.length) {
                    this._lastSegLog = segs.length;
                    log("📝 SRT_EDIT: WF segments=" + segs.length + " seq=\"" + (parsed.seqName || "?") + "\"");
                    var counts = {};
                    for (var c = 0; c < segs.length; c++) { var key = segs[c].n || "?"; counts[key] = (counts[key] || 0) + 1; }
                    for (var kname in counts) { log("📝 SRT_EDIT:   media " + counts[kname] + "x \"" + kname + "\""); }
                    var N = Math.min(8, segs.length);
                    for (var d = 0; d < N; d++) {
                        var sg = segs[d];
                        // media_out = m + (e - s) * r  (últim segon de media del segment)
                        var mOut = sg.m + (sg.e - sg.s) * sg.r;
                        log("📝 SRT_EDIT:   seg[" + d + "] v" + sg.v + " tl=" + sg.s.toFixed(2) + "-" + sg.e.toFixed(2) + "s (dur=" + (sg.e - sg.s).toFixed(2) + ") ← media=" + sg.m.toFixed(2) + "->" + mOut.toFixed(2) + "s r=" + sg.r.toFixed(3) + " \"" + (sg.n || "?") + "\"");
                    }
                }
            } catch(e) { }
        },

        stop: function () {
            if (this._pollInterval) {
                clearInterval(this._pollInterval);
                this._pollInterval = null;
            }
            if (this._localPlayInterval) {
                clearInterval(this._localPlayInterval);
                this._localPlayInterval = null;
            }
        },

        togglePlay: function () {
            this._isPlaying = !this._isPlaying;
            var btn = document.getElementById('btnSrtPlay');
            var self = this;
            if (this._isPlaying) {
                log("▶▶ PLAY inici: media=" + this._playheadSec.toFixed(2) + " tl=" + this._ctiSec.toFixed(2));
                callJSX("(function(){try{app.enableQE();qe.project.getActiveSequence().play();return'OK'}catch(e){return'ERR:'+e.message}})()").then(function(result){
                    log("📝 SRT: PLAY result: " + result);
                });
                if (btn) btn.innerHTML = '⏸ PAUSA';
                if (this._pollInterval) clearInterval(this._pollInterval);
                this._pollInterval = setInterval(function () { self._pollTick(); }, 250);
                // (l'interpolació local del cabezal ja corre contínuament des de _startPolling)
            } else {
                callJSX("(function(){try{app.enableQE();qe.project.getActiveSequence().stop();return'OK'}catch(e){return'ERR:'+e.message}})()").then(function(result){
                    log("📝 SRT: STOP result: " + result);
                });
                if (btn) btn.innerHTML = '▶ PLAY';
                log("⏸⏸ PAUSA: media=" + this._playheadSec.toFixed(2) + " tl=" + this._ctiSec.toFixed(2));
                if (this._pollInterval) clearInterval(this._pollInterval);
                this._pollInterval = setInterval(function () { self._pollTick(); }, 400);
                this._pollTick(); // re-sincronitzar el playhead amb el CTI real de seguida
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
            this._drawMarkers(ctx);
            this._drawPlayhead();

            // Diagnòstic: media del cabezal (espai dels subtítols) i tl de Premiere
            // (per verificar la correspondència WF↔timeline en la mateixa escala)
            var med = this._playheadSec;
            var tl = this._tlAtMedia(med);
            ctx.fillStyle = 'rgba(0,0,0,0.6)';
            ctx.fillRect(2, 0, 280, 15);
            ctx.fillStyle = '#ffcc55';
            ctx.font = '10px monospace';
            ctx.fillText('media=' + med.toFixed(2) + 's | tl=' + tl.toFixed(2) + 's', 6, 11);
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
                // Espai de MEDIA del clip (identitat): la WF coincideix amb els
                // subtítols del SRT (que viuen en temps de media). El cabezal
                // converteix tl↔media (vegeu _mediaAtSec/_tlAtMedia).
                var pps = this._waveformPPS || 480;
                var nPeaks = this._waveformPeaks.length;
                var wfStart = this._wfMediaStart || 0;
                var wfEnd = this._wfMediaEnd || 0;
                var hasRange = (wfEnd > wfStart);
                ctx.fillStyle = '#22cc66';
                for (var px = 0; px < this._canvas.width; px++) {
                    var sec = px / this._pixelsPerSec;
                    var secEnd = (px + 1) / this._pixelsPerSec;
                    // Recurs al trimeo real del timeline: només dibuixar el rang de media cobert
                    if (hasRange && (sec < wfStart || sec >= wfEnd)) continue;
                    var mediaSec = sec, mediaSecEnd = secEnd;
                    var idxStart = Math.floor(mediaSec * pps);
                    var idxEnd = Math.max(idxStart + 1, Math.floor(mediaSecEnd * pps));
                    if (idxStart < 0) continue;
                    if (idxStart >= nPeaks) continue;
                    if (idxEnd > nPeaks) idxEnd = nPeaks;
                    var maxV = 0;
                    for (var k = idxStart; k < idxEnd; k++) {
                        if (this._waveformPeaks[k] > maxV) maxV = this._waveformPeaks[k];
                    }
                    // Només part positiva: barra des de la base cap amunt
                    var h = maxV * (wh - 2);
                    if (h < 1) h = 1;
                    ctx.fillRect(px, y + wh - h, 1, h);
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

        _drawMarkers: function (ctx) {
            if (!this._markers || this._markers.length === 0) return;
            for (var i = 0; i < this._markers.length; i++) {
                var x = this._markers[i] * this._pixelsPerSec;
                var inDrag = (i === this._dragIdx);
                ctx.strokeStyle = inDrag ? '#ffd24d' : '#ffaa00';
                ctx.lineWidth = inDrag ? 2 : 1;
                ctx.beginPath();
                ctx.moveTo(x, 0);
                ctx.lineTo(x, this._canvas.height);
                ctx.stroke();
                ctx.fillStyle = inDrag ? '#ffd24d' : '#ffaa00';
                ctx.beginPath();
                ctx.moveTo(x - 5, 0); ctx.lineTo(x + 5, 0); ctx.lineTo(x, 8);
                ctx.closePath();
                ctx.fill();
            }
        },

        _canvasXToSec: function (e) {
            var rect = this._canvas.getBoundingClientRect();
            var scaleX = this._canvas.width / rect.width;
            var canvasX = (e.clientX - rect.left) * scaleX;
            return canvasX / this._pixelsPerSec;
        },

        _markerAtSec: function (sec) {
            var tol = this._MARKER_TOL_PX / this._pixelsPerSec;
            for (var i = 0; i < this._markers.length; i++) {
                if (Math.abs(this._markers[i] - sec) <= tol) return i;
            }
            return -1;
        },

        /**
         * _mediaAtSec: retorna el temps de media que correspon a un instant de
         * timeline 'sec' (invers del mapeig dels segments). -1 si fora de clip.
         */
        _mediaAtSec: function (sec) {
            var segs = this._waveformSegments || [];
            if (segs.length === 0) return sec;
            for (var g = 0; g < segs.length; g++) {
                var sg = segs[g];
                if (sec >= sg.s && sec < sg.e) return sg.m + (sec - sg.s) * sg.r;
            }
            return -1;
        },

        /**
         * _tlAtMedia: retorna el temps de timeline on sona el temps de media 'media'.
         * (invers de _mediaAtSec). Fora de cap segment → retorna 'media' (identitat).
         */
        _tlAtMedia: function (media) {
            var segs = this._waveformSegments || [];
            if (segs.length === 0) return media;
            for (var g = 0; g < segs.length; g++) {
                var sg = segs[g];
                var mEnd = sg.m + (sg.e - sg.s) * sg.r;
                if (media >= sg.m && media < mEnd) {
                    return sg.s + (media - sg.m) / sg.r;
                }
            }
            return media;
        },

        /**
         * Aplica l'efecte d'arrossegar el marcador _dragIdx a la nova posició P1.
         * Mode "move": dreta solidària (+delta), tram [anterior, marcador] escalat.
         * Mode "scaleBoth": escala els dos trams veins (no afecta altres punts);
         *                   si és l'últim marcador, la dreta es mou sense escalar.
         * Recalcula des del snapshot inicial del drag → sense error acumulat.
         */
        _applyMarkerDrag: function (P1) {
            var snap = this._dragSnapshot;
            if (!snap || this._dragIdx < 0) return;
            var i = this._dragIdx;
            var P0 = snap.markers[i];
            var A = i > 0 ? snap.markers[i - 1] : 0;
            var N = i < snap.markers.length - 1 ? snap.markers[i + 1] : null;
            if (P1 < A + 0.1) P1 = A + 0.1;
            if (N !== null && P1 > N - 0.1) P1 = N - 0.1;
            var delta = P1 - P0;
            var spanL = P0 - A;
            var spanR = (N !== null) ? (N - P0) : 0;
            var self = this;

            this._entries = snap.entries.map(function (e) {
                var s = e.startSec, en = e.endSec;
                if (self._editMode === 'move') {
                    if (s >= P0) { s += delta; en += delta; }
                    else if (s >= A && spanL > 0.05) {
                        var f = (P1 - A) / spanL;
                        s = A + (s - A) * f; en = A + (en - A) * f;
                    }
                } else {
                    if (s >= P0) {
                        if (N !== null && s < N && spanR > 0.05) {
                            var fR = (N - P1) / spanR;
                            s = P1 + (s - P0) * fR; en = P1 + (en - P0) * fR;
                        } else if (N === null) { s += delta; en += delta; }
                    } else if (s >= A && spanL > 0.05) {
                        var fL = (P1 - A) / spanL;
                        s = A + (s - A) * fL; en = A + (en - A) * fL;
                    }
                }
                if (en < s + 0.04) en = s + 0.04;
                return { index: e.index, timeStr: e.timeStr, texts: e.texts.slice(), startSec: s, endSec: en };
            });

            var ms = snap.markers.slice();
            ms[i] = P1;
            if (this._editMode === 'move') {
                for (var j = i + 1; j < ms.length; j++) ms[j] = snap.markers[j] + delta;
            }
            this._markers = ms;
        },

        _getManifestCtx: function () {
            var ctx = window.FASTPASS_UI.State;
            if (!ctx || !ctx.progData || !ctx.config || !ctx.dateDir || !ctx.bloque) return null;
            if (!ctx.config.rutas || !ctx.config.rutas.destinoBase) return null;
            return ctx;
        },

        _persistMarkers: async function () {
            try {
                var ctx = this._getManifestCtx();
                if (!ctx || !window.FASTPASS_UI.SessionManifest) return;
                await window.FASTPASS_UI.SessionManifest.save(ctx, {
                    srtEditor: { srtName: this._srtName, markers: this._markers.slice(), updatedAt: new Date().toISOString() }
                });
            } catch (e) { }
        },

        _restoreMarkers: async function () {
            try {
                var ctx = this._getManifestCtx();
                if (!ctx || !window.FASTPASS_UI.SessionManifest) return;
                var manifest = await window.FASTPASS_UI.SessionManifest.load(ctx);
                if (manifest && manifest.srtEditor && manifest.srtEditor.srtName === this._srtName && Array.isArray(manifest.srtEditor.markers)) {
                    this._markers = manifest.srtEditor.markers.filter(function (m) { return typeof m === 'number' && isFinite(m); });
                    this._markers.sort(function (a, b) { return a - b; });
                    if (this._markers.length > 0) log("📝 SRT_EDIT: " + this._markers.length + " marcadors restaurats del manifest");
                }
            } catch (e) { }
        },

        setPlayhead: function (sec) {
            if (sec < 0) sec = 0;
            // sec és temps de MEDIA (espai dels subtítols i la WF) → convertir a TL per Premiere
            this._playheadSec = sec;
            var tl = this._tlAtMedia(sec);
            callJSX("Timeline.set(" + tl.toFixed(3) + ")");
            this.render();
            this._updatePreview(sec);
        },

        applyIn: function () {
            var cti = this._playheadSec;
            var targetIdx = window.FASTPASS_UI.Logic.SrtParser.findTargetByTime(this._entries, cti);
            log("📝 SRT_EDIT: IN cti=" + cti.toFixed(2) + "s → targetIdx=" + targetIdx + "/" + this._entries.length
                + (targetIdx >= 0 ? " (entry start=" + this._entries[targetIdx].startSec.toFixed(2) + "s)" : ""));
            if (targetIdx < 0) { getUtils().status("CTI no sobre cap caption", "warn"); return; }
            var originalStart = this._entries[targetIdx].startSec;
            this._entries = window.FASTPASS_UI.Logic.SrtParser.applyTrimIn(this._entries, targetIdx, 0.4);
            // Marcadors: mateix offset que les entrades + àncora al primer clip
            var offset = 0.4 - originalStart;
            this._markers = this._markers.map(function (m) { return m + offset; }).filter(function (m) { return m >= 0.39; });
            if (this._entries.length > 0) {
                var first = this._entries[0].startSec;
                var exists = this._markers.some(function (m) { return Math.abs(m - first) < 0.05; });
                if (!exists) this._markers.push(first);
                this._markers.sort(function (a, b) { return a - b; });
            }
            this._isDirty = true; this.render();
            this._persistMarkers();
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
            var firstIn = this._entries.length > 0 ? this._entries[0].startSec : 0;
            var lastOut = this._entries.length > 0 ? this._entries[this._entries.length - 1].endSec : 0;
            this._entries = window.FASTPASS_UI.Logic.SrtParser.applyTimeAdjust(this._entries, cti, 0.04);
            // Escalar marcadors amb el mateix ratio que les entrades
            var curDur = lastOut - firstIn, newDur = cti - firstIn;
            if (curDur > 0 && newDur > 0 && this._markers.length > 0) {
                var ratio = newDur / curDur;
                this._markers = this._markers.map(function (m) { return firstIn + (m - firstIn) * ratio; });
            }
            this._isDirty = true; this.render();
            this._persistMarkers();
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
            this._waveformPeaks = null; this._waveformPPS = 480; this._isPlaying = false;
            this._waveformSegments = []; this._waveformMediaTag = ""; this._pollCount = 0;
            this._wfMediaStart = 0; this._wfMediaEnd = 0;
            this._markers = []; this._editMode = "move"; this._dragIdx = -1; this._dragSnapshot = null;
            this._lastCtiSec = -1; this._lastLocalT = -1; this._lastLocalPx = -1;
            var btnMode = document.getElementById('btnSrtMode');
            if (btnMode) { btnMode.textContent = '⇒ MOURE'; btnMode.style.background = ''; }
            if (this._ctx) this._ctx.clearRect(0, 0, this._canvas.width, this._canvas.height);
            this._hideEditor();
        }
    };

    window.FASTPASS_UI.Editor.SrtEditor = FASTPASS_UI.Editor.SrtEditor;
    window.SrtEditor = FASTPASS_UI.Editor.SrtEditor;
})();