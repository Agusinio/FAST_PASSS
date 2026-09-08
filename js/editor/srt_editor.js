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
        _loadedEntries: [],
        _originalEntries: [],
        _pixelsPerSec: 20,
        _maxSec: 120,
        _rulerHeight: 18,
        // Disposició compacta superposada: la WF és el FONS de la zona de treball i
        // els clips de subtítols hi queden superposats (semitransparents). Així es
        // suprimeix la franja separada de clips → timeline més baix.
        _workZoneH: 40,          // alçada de la zona única WF+clips (per sota la regla)
        _waveformGain: 2.8,   // amplifica visualment la WF (àudio ~-9dB)
        _playheadSec: 0,
        _pollInterval: null,
        _srtPath: "",
        _srtName: "",
        _canvas: null,
        _ctx: null,
        _isDirty: false,
        _waveformPeaks: null,
        _waveformPPS: 480,
        _wfCacheKey: "",
        _wfPixelHeights: null,
        _waveformSegments: [],
        _waveformMediaTag: "",
        _wfMediaStart: 0,
        _wfMediaEnd: 0,
        _axisOrigin: 0,     // media on comença el timeline (IN del primer clip) → eix del editor
        _pollCount: 0,
        _localPlayInterval: null,
        _ctiSec: 0,
        _ctiAt: 0,
        _timelineRunning: false,
        _pendingSeek: null,   // seek pendent (clic al canvas) — el CTI encara ha d'arribar
        _lastCtiSec: -1,
        _lastLocalT: -1,
        _lastLocalPx: -1,
        _isPlaying: false,
        _playheadLocal: false,  // playhead més enllà de l'OUT (desacoblat de Premiere)
        _zoomBarDragging: false,  // s'està arrossegant la barra de zoom (no auto-scroll)
        _markers: [],
        _originalMarkers: [],
        _dragIdx: -1,
        _didDrag: false,
        _suppressClick: false,
        _MARKER_TOL_PX: 12,
        // Tolerància MÍNIMA de captura de marcadors en SEGONS (per cada costat).
        // Amb zooms amples (p. ex. mode emergència SRT / blocs de 15 min) la tol en
        // píxels (12/pps) es queda en pocs segons i és difícil agafar el marcador
        // sense "pillar-se els dits". 2026-09-04: mínim de 20s (ajustable).
        _MARKER_TOL_MIN_SEC: 20,
        _lastSegLog: -1,

        init: function () {
            this._canvas = document.getElementById('srtCanvas');
            if (!this._canvas) return false;
            this._ctx = this._canvas.getContext('2d');
            var self = this;

            this._canvas.addEventListener('click', function (e) {
                if (self._suppressClick) { self._suppressClick = false; return; }
                var sec = self._canvasXToSec(e);
                log("🖱 CLIC canvas → media=" + sec.toFixed(2) + "s");
                self.setPlayhead(sec);
            });

            // Click dret (zona de treball): crear marcador (o esborrar-lo si ja n'hi ha un a sota).
            this._canvas.addEventListener('contextmenu', function (e) {
                e.preventDefault();
                // La regla no és zona de marcadors (només cabezal).
                if (self._inRulerZone(e)) return;
                var rawSec = self._canvasXToSec(e);

                // 1) Borrar si el clic cau sobre un marcador existent (mateixa tol que el drag).
                var idx = self._markerAtSec(rawSec);
                if (idx >= 0) {
                    var delSec = self._markers[idx];
                    self._markers.splice(idx, 1);
                    if (idx < self._originalMarkers.length) self._originalMarkers.splice(idx, 1);
                    log("📝 SRT_EDIT: Marcador esborrat a " + delSec.toFixed(2) + "s");
                } else {
                    // 2) Crear marcador snap al límit del clip que ES VEU (taula actual),
                    //    i mapejar-lo a l'espai ORIGINAL per a _originalMarkers.
                    var snapActual = self._snapToSubtitleBoundary(rawSec, self._entries);
                    var snapOriginal = self._actualToOriginal(snapActual);
                    self._markers.push(snapActual);
                    self._markers.sort(function (a, b) { return a - b; });
                    self._originalMarkers.push(snapOriginal);
                    self._originalMarkers.sort(function (a, b) { return a - b; });
                    log("📝 SRT_EDIT: Marcador creat a " + snapActual.toFixed(2) + "s (orig " + snapOriginal.toFixed(2) + "s, clic " + rawSec.toFixed(2) + "s)");
                }
                self._isDirty = true;
                self._applyAllMarkers();
                self.render();
                self._persistMarkers();
            });

            // Botó esquerre (disseny compacte):
            //  - REGLA → SOLS el cabezal (playhead), mai drag.
            //  - Zona de treball (WF de fons + clips superposats) → arrossegar els marcadors.
            // Un click simple sobre un marcador (sense moviment) posiciona el playhead.
            this._canvas.addEventListener('mousedown', function (e) {
                if (e.button !== 0) return;
                var sec = self._canvasXToSec(e);
                if (self._inRulerZone(e)) {
                    log("🖱 MOUSEDOWN canvas (regla) → media=" + sec.toFixed(2) + "s");
                    self.setPlayhead(sec);
                    self._suppressClick = true; // el clic següent no ha de repetir el seek
                    return;
                }
                // Tol ampliada per capturar el marcador per ARROSSEGAR-lo (wideTol=true).
                var idx = self._markerAtSec(sec, true);
                if (idx < 0) {
                    // Cap marcador a sota: posicionar el playhead immediatament.
                    log("🖱 MOUSEDOWN canvas → media=" + sec.toFixed(2) + "s");
                    self.setPlayhead(sec);
                    self._suppressClick = true; // el clic següent no ha de repetir el seek
                    return;
                }
                self._dragIdx = idx;
                self._didDrag = false;
                e.preventDefault();
            });

            // El drag es segueix a nivell de document (com a la barra de zoom): si el
            // cursor surt del canvas a mig arrossegament, el marcador NO es deixa anar.
            var dragMove = function (e) {
                if (self._dragIdx >= 0) {
                    self._didDrag = true;
                    self._applyMarkerDrag(self._canvasXToSec(e));
                    self.render();
                }
            };
            var endDrag = function () {
                if (self._dragIdx >= 0) {
                    if (self._didDrag) {
                        self._suppressClick = true; // el click del mouseup no ha de moure el playhead
                        self._isDirty = true;
                        self._persistMarkers();
                    }
                    self._dragIdx = -1;
                    self._didDrag = false;
                }
            };
            document.addEventListener('mousemove', dragMove);
            document.addEventListener('mouseup', endDrag);
            this._canvas.addEventListener('mousemove', dragMove);
            this._canvas.addEventListener('mouseup', endDrag);

            this._scrollWrap = this._canvas.parentElement;
            this._initZoomBar();
            return true;
        },

        // --- BARRA DE ZOOM (estil Premiere) ---
        _initZoomBar: function () {
            var self = this;
            var bar = document.getElementById('srtZoomBar');
            if (!bar) return;
            var dragMode = null;
            var dragStartX = 0;
            var dragStartView = null;
            var dragBarPxPerTl = 1;
            var dragMinWidth = 0;
            var MIN_PPS = 5, MAX_PPS = 150;

            var totalTl = function () {
                return Math.max(0.001, self._maxSec - (self._axisOrigin || 0));
            };

            var getView = function () {
                var pps = self._pixelsPerSec || 1;
                var clientW = self._scrollWrap ? self._scrollWrap.clientWidth : bar.clientWidth;
                var scrollPx = self._scrollWrap ? self._scrollWrap.scrollLeft : 0;
                return { start: scrollPx / pps, end: (scrollPx + clientW) / pps, clientW: clientW, pps: pps };
            };

            var applyView = function (start, end) {
                var clientW = getView().clientW;
                var total = totalTl();
                var minWidth = clientW / MAX_PPS;   // zoom màxim
                if (start < 0) { end -= start; start = 0; }
                if (end > total) { start -= (end - total); end = total; }
                if (start < 0) start = 0;
                if (end > total) end = total;
                if (end - start < minWidth) end = Math.min(total, start + minWidth);
                var pps = clientW / Math.max(0.001, (end - start));
                if (pps < MIN_PPS) pps = MIN_PPS;
                if (pps > MAX_PPS) pps = MAX_PPS;
                self._pixelsPerSec = pps;
                if (self._scrollWrap) self._scrollWrap.scrollLeft = start * pps;
                self.render();
                self._updateZoomBar();
            };

            bar.addEventListener('mousedown', function (e) {
                if (e.button !== 0) return;
                var id = e.target.id;
                if (id === 'srtZoomHandleL') dragMode = 'L';
                else if (id === 'srtZoomHandleR') dragMode = 'R';
                else if (id === 'srtZoomFill') dragMode = 'pan';
                else return;
                // Captura l'offset inicial: el handle es mou SOLIDARI amb el rató
                // (sense saltar a la posició del cursor).
                dragStartX = e.clientX;
                dragStartView = getView();
                dragBarPxPerTl = bar.clientWidth / totalTl();
                dragMinWidth = dragStartView.clientW / MAX_PPS;
                self._zoomBarDragging = true;
                e.preventDefault();
            });

            document.addEventListener('mousemove', function (e) {
                if (!dragMode) return;
                var deltaTl = (e.clientX - dragStartX) / dragBarPxPerTl;
                var v = dragStartView;
                if (dragMode === 'L') {
                    var newStart = v.start + deltaTl;
                    if (newStart > v.end - dragMinWidth) newStart = v.end - dragMinWidth;
                    if (newStart < 0) newStart = 0;
                    applyView(newStart, v.end);
                } else if (dragMode === 'R') {
                    var newEnd = v.end + deltaTl;
                    if (newEnd < v.start + dragMinWidth) newEnd = v.start + dragMinWidth;
                    var total = totalTl();
                    if (newEnd > total) newEnd = total;
                    applyView(v.start, newEnd);
                } else {
                    // Pan natural (com a Premiere): arrossegar cap a la dreta desplaça
                    // la vista cap a la dreta (scrollLeft augmenta).
                    applyView(v.start + deltaTl, v.end + deltaTl);
                }
            });

            document.addEventListener('mouseup', function () {
                dragMode = null;
                self._zoomBarDragging = false;
            });
        },

        _updateZoomBar: function () {
            var bar = document.getElementById('srtZoomBar');
            var fill = document.getElementById('srtZoomFill');
            var hL = document.getElementById('srtZoomHandleL');
            var hR = document.getElementById('srtZoomHandleR');
            if (!bar || !fill || !hL || !hR) return;
            var barW = bar.clientWidth;
            if (barW <= 0) return;
            var totalTl = Math.max(0.001, this._maxSec - (this._axisOrigin || 0));
            var pps = this._pixelsPerSec || 1;
            var clientW = this._scrollWrap ? this._scrollWrap.clientWidth : barW;
            var scrollPx = this._scrollWrap ? this._scrollWrap.scrollLeft : 0;
            var startTl = Math.max(0, scrollPx / pps);
            var endTl = Math.min(totalTl, startTl + clientW / pps);
            var leftPct = (startTl / totalTl) * 100;
            var rightPct = (endTl / totalTl) * 100;
            if (rightPct - leftPct < 1) rightPct = Math.min(100, leftPct + 1);
            fill.style.left = leftPct + '%';
            fill.style.width = (rightPct - leftPct) + '%';
            hL.style.left = 'calc(' + leftPct + '% - 4px)';
            hR.style.left = 'calc(' + rightPct + '% - 4px)';
        },

        _ensurePlayheadVisible: function () {
            if (!this._scrollWrap || this._zoomBarDragging) return;
            // Auto-scroll NOMÉS amb el cabezal en PLAY (Premiere o play local).
            // Si el timeline està parat (clic, pan o zoom manuals), NO recol·locar la vista.
            if (!this._timelineRunning && !(this._playheadLocal && this._isPlaying)) return;
            var pps = this._pixelsPerSec || 1;
            var x = this._secToX(this._playheadSec);
            var cw = this._scrollWrap.clientWidth;
            var sl = this._scrollWrap.scrollLeft;
            var margin = 40;
            var maxScroll = Math.max(0, this._scrollWrap.scrollWidth - cw);
            if (x < sl + margin) {
                this._scrollWrap.scrollLeft = Math.max(0, x - margin);
            } else if (x > sl + cw - margin) {
                this._scrollWrap.scrollLeft = Math.min(maxScroll, x - cw + margin);
            }
            this._updateZoomBar();
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
            // Taula carregada immutable: estat inicial per al botó RESET (mai no s'actualitza)
            this._loadedEntries = this._entries.map(function (e) { return { index: e.index, timeStr: e.timeStr, texts: e.texts.slice(), startSec: e.startSec, endSec: e.endSec }; });
            // Taula original: base de TOTES les edicions de marcadors (evita degradació acumulada)
            this._originalEntries = this._entries.map(function (e) { return { index: e.index, timeStr: e.timeStr, texts: e.texts.slice(), startSec: e.startSec, endSec: e.endSec }; });
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
            this._originalMarkers = [];
            await this._restoreMarkers();
            // _restoreMarkers ja restaura tant _markers (posicions actuals) com
            // _originalMarkers (posicions originals); no cal sincronitzar-los aquí.

            // Carregar waveform des del fitxer .bin (WAV 8-bit 480Hz, 1 byte = 1 peak)
            try {
                var wg = window.FASTPASS_UI.Logic.WaveformGenerator;
                var projFolder = await callJSX("Context.folder()");
                if (projFolder && String(projFolder).indexOf('ERR') !== 0) this._projectKey = projFolder;
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

            // Carregar el vídeo del clip al visor vertical (PLAN_VIDEO_PREVIEW)
            try {
                var videoTag = this._waveformMediaTag;
                var projFolder2 = await callJSX("Context.folder()");
                if (videoTag && projFolder2) {
                    await this._loadVideo(projFolder2 + '\\' + videoTag + '.mp4');
                } else {
                    log("⚠️ SRT_EDIT: Sense dades per localitzar el MP4 del clip");
                }
            } catch(e3) {
                log("⚠️ SRT_EDIT: Error carregant vídeo: " + e3.message);
            }
            
            // Aplicar els marcadors restaurats a la taula de clips (warp).
            this._applyAllMarkers();
            this.render();
            getUtils().status("SRT carregat: " + this._entries.length + " entrades", "exito");
            return true;
        },

        /**
         * EMERGÈNCIA SRT (Control+click a CARREGAR): si el .srt per defecte està mal
         * tallat, carrega el troç del bloc des del directori de blocs de 15 min:
         *   \\public.ad-ccrtv.local\Public\VERTICALITZACIO_INFORMATIUS\SRT_MP4_PER_TEMPS_15MINUTS
         * Nom: {YYYY-MM-DD}_Telenot_cies_{migdia|vespre|comarques}_{HH_MM_SS}_{HH_MM_SS}.srt
         */
        loadEmergencySrt: async function () {
            const u = getUtils();
            try {
                log("🚨 SRT_EMERGENCIA: iniciant càrrega des de blocs de 15 min...");

                // 1. Context (mateixes fonts que _setupContext del MainButton)
                const config = FASTPASS_UI.Config.get();
                const idProg = (document.getElementById('programa') || {}).value;
                const progData = config.mapeoProgramas && config.mapeoProgramas[idProg];
                if (!progData) { u.status("Selecciona un programa", "warn"); return; }
                const bloque = (document.getElementById('bloc') || {}).value;
                const stateDateDir = (FASTPASS_UI.State && FASTPASS_UI.State.dateDir);
                const dateDir = stateDateDir || u.getFormattedDate().replace(/["\s]/g, "").trim();
                const ctx = { config: config, progData: progData, programa: idProg, bloque: bloque, dateDir: dateDir };

                // 2. Rang real del bloc (hora del dia, en segons) des del manifest
                const manifest = await FASTPASS_UI.SessionManifest.load(ctx);
                const worldStart = manifest.ref && manifest.ref.worldBlockStartSec;
                const worldEnd = manifest.ref && manifest.ref.worldBlockEndSec;
                if (worldStart == null || worldEnd == null || worldEnd <= worldStart) {
                    u.status("El manifest no té el rang del bloc (executa NOU primer)", "warn");
                    return;
                }
                // Margen de captura GARANTITZAT per banda en la càrrega per blocs de 15 min.
                // Preferim que sobri una mica de temps (subtítols limítrofs de la peça veïna)
                // a perdre text del bloc: recuperar subtítols perduts és complex.
                const handles = (config.handles != null) ? config.handles : 20;
                const srtAir = 20; // segons mínims garantits a cada banda del bloc
                const marginSecs = Math.max(handles, srtAir);
                const winStart = worldStart - marginSecs;
                const winEnd = worldEnd + marginSecs;
                log("🚨 SRT_EMERGENCIA: bloc world [" + worldStart.toFixed(1) + "s → " + worldEnd.toFixed(1) + "s], finestra ±" + marginSecs + "s (garantida)");

                // 3. Programa → carpeta dels blocs de 15 min
                const progMap = { TNM: 'migdia', TNV: 'vespre', TNC: 'comarques' };
                const programa = progMap[(progData.wott || '').toUpperCase()];
                if (!programa) { u.status("Programa no suportat per emergència", "warn"); return; }
                const fecha = (dateDir || '').replace(/_/g, '-');
                const prefix = fecha + '_Telenot_cies_' + programa + '_';
                const dir = '\\\\public.ad-ccrtv.local\\Public\\VERTICALITZACIO_INFORMATIUS\\SRT_MP4_PER_TEMPS_15MINUTS';

                // 4. Llistar i seleccionar els arxius que solapen la finestra del bloc
                const files = await u.readFolder(dir);
                if (!files || files.length === 0) { u.status("No es pot llegir el directori de SRTs de 15 min", "warn"); return; }
                const candidates = [];
                for (let i = 0; i < files.length; i++) {
                    const name = files[i].name || '';
                    if (!name.toUpperCase().endsWith('.SRT')) continue;
                    if (name.indexOf(prefix) !== 0) continue;
                    const t = this._parseSrt15Times(name);
                    if (!t) continue;
                    if (t.startSec <= winEnd && t.endSec >= winStart) {
                        candidates.push({ name: name, path: dir + '\\' + name, startSec: t.startSec, endSec: t.endSec });
                    }
                }
                candidates.sort(function (a, b) { return a.startSec - b.startSec; });
                // Assegurar el fitxer de 15 min SEGÜENT si el darrer seleccionat pot
                // tenir frases que creuen el tall (la part final aniria a l'arxiu següent
                // i la darrera frase del bloc es perdria sense ell).
                if (candidates.length > 0) {
                    const lastCand = candidates[candidates.length - 1];
                    for (let i = 0; i < files.length; i++) {
                        const name2 = files[i].name || '';
                        if (!name2.toUpperCase().endsWith('.SRT')) continue;
                        if (name2.indexOf(prefix) !== 0) continue;
                        const t2 = this._parseSrt15Times(name2);
                        if (!t2) continue;
                        if (t2.startSec >= lastCand.endSec - 0.5 && t2.startSec < lastCand.endSec + 60 * 16) {
                            if (!candidates.some(function (c) { return c.startSec === t2.startSec; })) {
                                candidates.push({ name: name2, path: dir + '\\' + name2, startSec: t2.startSec, endSec: t2.endSec });
                            }
                        }
                    }
                    candidates.sort(function (a, b) { return a.startSec - b.startSec; });
                }
                log("🚨 SRT_EMERGENCIA: " + candidates.length + " arxius de 15 min seleccionats");
                if (candidates.length === 0) { u.status("No s'ha trobat cap SRT de 15 min per al bloc", "warn"); return; }

                // 5. Llegir, extreure i re-temporitzar el troç (concatena si cau entre arxius)
                const all = [];
                for (let c = 0; c < candidates.length; c++) {
                    const cand = candidates[c];
                    const content = await callJSX(`IO.readTxt('${u.escape(cand.path)}')`);
                    if (!content || content.indexOf('ERR') === 0) continue;
                    const entries = FASTPASS_UI.Logic.SrtParser.srtToEntries(content);
                    for (let e = 0; e < entries.length; e++) {
                        const ent = entries[e];
                        const realStart = cand.startSec + ent.startSec;
                        // Recórrer el final de la frase al límit de la finestra (bloc+marge):
                        // el SRT no ha d'estirar-se a la peça veïna més enllà del handle.
                        const realEnd = Math.min(cand.startSec + ent.endSec, winEnd);
                        if (realEnd <= winStart || realStart >= winEnd) continue;
                        const ns = realStart - worldStart;
                        const ne = realEnd - worldStart;
                        if (ne <= 0) continue;
                        all.push({ startSec: (ns < 0 ? 0 : ns), endSec: ne, texts: ent.texts.slice(), index: 0, timeStr: '' });
                    }
                }
                if (all.length === 0) { u.status("No s'han trobat subtítols dins del bloc", "warn"); return; }
                all.sort(function (a, b) { return a.startSec - b.startSec; });
                for (let n = 0; n < all.length; n++) all[n].index = n + 1;
                const srtContent = FASTPASS_UI.Logic.SrtParser.entriesToSrt(all);
                log("🚨 SRT_EMERGENCIA: " + all.length + " entrades extretes");

                // 6. Escriure temporal i carregar amb loadSrt (reutilitza WF/vídeo/marcadors)
                const projFolder = await callJSX("Context.folder()");
                const base = this._srtName || 'emergencia';
                const tempName = base + '_EMERGENCIA.srt';
                const tempPath = ((projFolder && projFolder.indexOf('ERR') !== 0) ? projFolder : 'C:\\temp').replace(/[\\/]+$/, '') + '\\' + tempName;
                const escPath = tempPath.replace(/\\/g, '\\\\');
                const escContent = srtContent.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '');
                const writeRes = await callJSX(`IO.writeTxt('${escPath}','${escContent}')`);
                if (writeRes !== "OK") {
                    try { window.cep.fs.writeFile(tempPath, srtContent); } catch (e2) { }
                }
                await this.loadSrt(tempPath);
            } catch (e) {
                log("💥 SRT_EMERGENCIA: " + e.message);
                u.status("Error emergència SRT: " + e.message, "error");
            }
        },

        /**
         * _parseSrt15Times: Extreu {startSec, endSec} (segons del dia) del nom d'un
         * arxiu de 15 min. Format final del nom: ..._HH_MM_SS_HH_MM_SS.srt
         */
        _parseSrt15Times: function (name) {
            if (!name) return null;
            const m = name.match(/(\d{2})_(\d{2})_(\d{2})_(\d{2})_(\d{2})_(\d{2})\.srt$/i);
            if (!m) return null;
            const h1 = parseInt(m[1], 10), mi1 = parseInt(m[2], 10), s1 = parseInt(m[3], 10);
            const h2 = parseInt(m[4], 10), mi2 = parseInt(m[5], 10), s2 = parseInt(m[6], 10);
            const startSec = h1 * 3600 + mi1 * 60 + s1;
            const endSec = h2 * 3600 + mi2 * 60 + s2;
            if (endSec <= startSec) return null;
            return { startSec: startSec, endSec: endSec };
        },

        _showEditor: function () {
            var container = document.getElementById('srtEditorContainer');
            if (container) container.style.display = 'block';
        },

        _hideEditor: function () {
            var container = document.getElementById('srtEditorContainer');
            if (container) container.style.display = 'none';
            // Aturar i buidar el visor de vídeo (PLAN_VIDEO_PREVIEW)
            try {
                var v = document.getElementById('srtVideo');
                if (v) { v.pause(); v.removeAttribute('src'); v.load(); }
                var subs = document.getElementById('srtVideoSubs');
                if (subs) subs.innerHTML = '';
            } catch (e) { }
            this._pendingSeek = null;
            this.stop();
        },

        /**
         * VISOR DE VÍDEO (PLAN_VIDEO_PREVIEW)
         * Càrrega el MP4 del clip al visor vertical 9:16. Primer intent amb file://
         * directa (UNC, 4 barres). Si la seguretat CEP/CORS ho bloqueja → fallback:
         * copia local a C:\temp\fastpass_media.mp4 i file:///C:/temp/...
         */
        _loadVideo: async function (mediaPath) {
            var v = document.getElementById('srtVideo');
            if (!v) return false;
            var url = "file:////" + mediaPath.replace(/\\/g, "/");
            log("📝 SRT_EDIT: Vídeo → " + url);
            v.preload = "auto";
            v.src = url;
            v.load();
            var ok = await this._waitVideoReady(v, 8000);
            if (ok) {
                log("✅ SRT_EDIT: Vídeo carregat (file:// directa)");
                await this._seekVideoToPlayhead();
                return true;
            }
            log("⚠️ SRT_EDIT: file:// directa bloquejada → copiant a C:\\temp...");
            return await this._loadVideoFallback(mediaPath);
        },

        _loadVideoFallback: async function (mediaPath) {
            var v = document.getElementById('srtVideo');
            if (!v) return false;
            try {
                try { window.cep.fs.makedir("C:/temp"); } catch (e1) { }
                // File.copy d'ExtendScript: fiable amb binari i rutes UNC
                var src = mediaPath.replace(/\\/g, "/").replace(/'/g, "");
                var copyResult = await callJSX(
                    "(function(){try{var f=new File('" + src + "');var d=new File('C:/temp/fastpass_media.mp4');"
                    + "if(d.exists)d.remove();var ok=f.copy(d);return ok?'OK':'ERR:copy=false'}catch(e){return 'ERR:'+e.message}})()"
                );
                if (copyResult !== "OK") {
                    log("⚠️ SRT_EDIT: copia del MP4 fallida → " + copyResult);
                    return false;
                }
                v.preload = "auto";
                v.src = "file:///C:/temp/fastpass_media.mp4";
                v.load();
                var ok = await this._waitVideoReady(v, 8000);
                if (ok) {
                    log("✅ SRT_EDIT: Vídeo carregat des de C:\\temp");
                    await this._seekVideoToPlayhead();
                    return true;
                }
                log("⚠️ SRT_EDIT: el MP4 local tampoc carrega (codec?)");
                return false;
            } catch (e) {
                log("⚠️ SRT_EDIT: Error fallback vídeo: " + e.message);
                return false;
            }
        },

        _waitVideoReady: function (v, timeoutMs) {
            return new Promise(function (resolve) {
                if (!v) return resolve(false);
                if (v.readyState >= 2) return resolve(true);
                var done = false, timer = null;
                var onOk = function () { finish(true); };
                var onErr = function () { finish(false); };
                var finish = function (ok) {
                    if (done) return; done = true;
                    v.removeEventListener('loadeddata', onOk);
                    v.removeEventListener('canplay', onOk);
                    v.removeEventListener('error', onErr);
                    if (timer) clearTimeout(timer);
                    resolve(ok);
                };
                v.addEventListener('loadeddata', onOk);
                v.addEventListener('canplay', onOk);
                v.addEventListener('error', onErr);
                timer = setTimeout(function () { finish(false); }, timeoutMs || 8000);
            });
        },

        _seekVideoToPlayhead: async function () {
            var v = document.getElementById('srtVideo');
            if (!v || v.readyState < 2) return;
            var ph = this._playheadSec;
            try {
                var cti = parseFloat(await callJSX("Timeline.get()"));
                if (!isNaN(cti)) {
                    var mPh = this._mediaAtSec(cti);
                    ph = (mPh < 0) ? cti : mPh;
                }
            } catch (e) { }
            v.currentTime = ph;
        },

        _syncVideo: function (mediaSec) {
            var v = document.getElementById('srtVideo');
            if (!v || !v.src) return;
            if (v.readyState < 2) return;
            var run = !!this._isPlaying;   // reproducció activa (botó PLAY)
            // Mantenir el <video> reproduint/pausat segons l'estat.
            try {
                if (run && v.paused) { var pr = v.play(); if (pr && pr.catch) pr.catch(function () { }); }
                else if (!run && !v.paused) v.pause();
            } catch (eP) { }
            var d = v.currentTime - mediaSec;
            var ad = Math.abs(d);
            if (run) {
                // Reproducció real: correcció SUAU amb playbackRate. Es fa un seek
                // només si el desfàs és gran (salt/pèrdua de sincronia) → evita els
                // talls i frames negres que causava el servo de seeks cada 0.12s.
                if (ad > 1.0) {
                    try { v.currentTime = mediaSec; } catch (eS) { }
                    if (Math.abs(v.playbackRate - 1) > 0.005) { try { v.playbackRate = 1; } catch (eR) { } }
                } else if (ad > 0.12) {
                    // d>0 → el vídeo va per davant → frenar; d<0 → va endarrerit → accelerar.
                    var rate = (d > 0)
                        ? Math.max(0.90, 1 - ad * 0.4)
                        : Math.min(1.12, 1 + ad * 0.4);
                    if (Math.abs(v.playbackRate - rate) > 0.005) {
                        try { v.playbackRate = rate; } catch (eR2) { }
                    }
                } else if (Math.abs(v.playbackRate - 1) > 0.005) {
                    try { v.playbackRate = 1; } catch (eR3) { }
                }
            } else {
                // Parat: posició exacta (seek només si el desfàs és perceptible).
                try { if (Math.abs(v.playbackRate - 1) > 0.005) v.playbackRate = 1; } catch (eR4) { }
                if (ad > 0.15) { try { v.currentTime = mediaSec; } catch (eS2) { } }
            }
        },

        _setVideoRunning: function (run) {
            var v = document.getElementById('srtVideo');
            if (!v || !v.src) return;
            try {
                if (run) { if (v.paused) { var pr = v.play(); if (pr && pr.catch) pr.catch(function () { }); } }
                else { if (!v.paused) v.pause(); }
            } catch (e) { }
        },

        _startPolling: function () {
            if (this._pollInterval) clearInterval(this._pollInterval);
            var self = this;
            this._pollInterval = setInterval(function () { self._pollTick(); }, 400);
            // Seguiment CONTINU del cabezal. Només s'extrapola a 1× quan el timeline està
            // en PLAY (_timelineRunning=true); parat o amb salt, el CTI es considera fix
            // fins al proper poll per evitar deriva. El suavitzat evita salts.
            if (this._localPlayInterval) clearInterval(this._localPlayInterval);
            this._localPlayInterval = setInterval(function () {
                var now = (window.performance && performance.now) ? performance.now() : Date.now();
                var estTl;
                if (self._pendingSeek !== null && self._pendingSeek !== undefined) {
                    // Seek pendent (clic al canvas): usar el target per no derivar
                    estTl = self._pendingSeek;
                } else if (self._timelineRunning) {
                    // En PLAY: el temps de timeline avança a 1× entre polls
                    estTl = self._ctiSec + (now - self._ctiAt) / 1000;
                } else {
                    // Parat (o salt/scrub): el CTI és fix fins al proper poll → sense deriva
                    estTl = self._ctiSec;
                }
                if (estTl < 0) estTl = 0;
                var mPh = self._mediaAtSec(estTl);
                var ph = (mPh < 0) ? estTl : mPh;
                self._playheadSec += (ph - self._playheadSec) * 0.6;
                if (Math.abs(self._playheadSec - self._lastLocalT) < 0.02) return;
                self._lastLocalT = self._playheadSec;
                self.render();
                self._updatePreview(self._playheadSec);
                self._syncVideo(self._playheadSec);
            }, 100);
        },

        _pollTick: async function () {
            try {
                var now0 = (window.performance && performance.now) ? performance.now() : Date.now();
                var cti = await callJSX("Timeline.get()");
                var now1 = (window.performance && performance.now) ? performance.now() : Date.now();
                if (cti && cti !== "null" && cti !== "") {
                    var sec = parseFloat(cti);
                    if (!isNaN(sec)) {
                        // Si el playhead és LOCAL (més enllà de l'OUT), NO tocar _ctiSec
                        // amb el CTI real (que es queda a l'OUT): el _localPlayInterval
                        // faria revertir el playhead cap a l'OUT.
                        if (this._playheadLocal) {
                            this._lastCtiSec = sec;
                            this._updatePreview(this._playheadSec);
                            this._syncVideo(this._playheadSec);
                            this._pollCount = (this._pollCount || 0) + 1;
                            this.render();
                            return;
                        }
                        this._ctiSec = sec; // CTI real de Premiere (temps de timeline)
                        // El CTI llegat correspon a ~mig vol del evalScript (compensa latència)
                        this._ctiAt = now0 + (now1 - now0) / 2;
                        // Posició real en MEDIA
                        var mediaPh = this._mediaAtSec(sec);
                        var realPh = (mediaPh < 0) ? sec : mediaPh;
                        // Seek pendent (clic al canvas): no revertir el playhead fins que
                        // el CTI real arribi al target (evita "el clic no fa cas").
                        if (this._pendingSeek !== null && this._pendingSeek !== undefined) {
                            if (Math.abs(sec - this._pendingSeek) < 0.05) {
                                this._pendingSeek = null; // seek completat
                            } else if (Math.abs(sec - this._pendingSeek) > 1.0) {
                                // El CTI s'ha allunyat del target (moviment manual o PLAY):
                                // cancel·lar el seek pendent i seguir la lògica normal.
                                this._pendingSeek = null;
                            } else {
                                // El CTI encara no ha arribat al target: mantenir el
                                // playhead on el va deixar setPlayhead (punt del clic).
                                this._lastCtiSec = sec;
                                this._updatePreview(this._playheadSec);
                                this._syncVideo(this._playheadSec);
                                this._pollCount = (this._pollCount || 0) + 1;
                                this.render();
                                return;
                            }
                        }
                        // Detecció d'estat del cabezal:
                        //  - Δ < 0.1s  → parat (o jitter): posició exacta, sense extrapolar
                        //  - Δ > 0.5s  → salt (clic/scrub): posicionar directe, no extrapolar
                        //  - entremig  → avanç progressiu (PLAY): extrapolar a 1× entre polls
                        var ctiDelta = Math.abs(sec - this._lastCtiSec);
                        if (ctiDelta < 0.1) {
                            this._timelineRunning = false;
                            this._playheadSec = realPh;
                        } else if (ctiDelta > 0.5) {
                            this._timelineRunning = false;
                            this._playheadSec = realPh;
                            log("🎯 PLY salt tl=" + sec.toFixed(2) + " real=" + realPh.toFixed(2) + " (Δ=" + ctiDelta.toFixed(2) + ")");
                        } else {
                            this._timelineRunning = true;
                            log("⏱ PLY tl=" + sec.toFixed(2) + " real=" + realPh.toFixed(2) + " show=" + this._playheadSec.toFixed(2) + " rtt=" + Math.round(now1 - now0) + "ms");
                        }
                        this._lastCtiSec = sec;
                        this._updatePreview(this._playheadSec);
                        this._syncVideo(this._playheadSec);
                    }
                }
                this._pollCount = (this._pollCount || 0) + 1;
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
                    if (!isFinite(o.s) || !isFinite(o.e) || !isFinite(o.m)) continue;
                    // IMPORTANT: en aquests projectes els clips del timeline van SEMPRE al 100%
                    // (mai s'acceleren). L'outPoint del TrackItem NO és fiable com a fi de MEDIA:
                    // retorna valors que donaven velocitats absurdes (ex: r=1.86, r=10.6).
                    // Per tant, la durada en MEDIA = durada al timeline (velocitat 1x).
                    // Salvaguarda: si outPoint donés una velocitat "normal" (0.9-1.1x), es respecta.
                    var durTl = o.e - o.s;
                    var r = 1;
                    if (durTl > 0 && isFinite(o.m2) && o.m2 > o.m) {
                        var rCand = (o.m2 - o.m) / durTl;
                        if (rCand > 0.9 && rCand < 1.1) { r = rCand; }
                    }
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
                this._axisOrigin = this._wfMediaStart;   // eix del timeline: x=0 = IN del primer clip
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
            this._pendingSeek = null; // si hi ha un seek pendent, cancel·lar-lo
            var btn = document.getElementById('btnSrtPlay');
            var self = this;
            // Reproduir/pausar el <video> del visor segons l'estat (no "servo" de seeks).
            this._setVideoRunning(this._isPlaying);
            if (this._isPlaying) {
                if (this._playheadLocal) {
                    // PLAY LOCAL (més enllà de l'OUT): avançar el playhead a 1x en MEDIA
                    // sense dependre del CTI de Premiere (que es queda al final físic).
                    log("▶▶ PLAY LOCAL (més enllà de l'OUT): media=" + this._playheadSec.toFixed(2));
                    this._timelineRunning = true;
                    this._ctiAt = (window.performance && performance.now) ? performance.now() : Date.now();
                    if (btn) btn.innerHTML = '⏸ PAUSA';
                    if (this._pollInterval) clearInterval(this._pollInterval);
                    this._pollInterval = setInterval(function () { self._pollTick(); }, 400);
                    return;
                }
                log("▶▶ PLAY inici: media=" + this._playheadSec.toFixed(2) + " tl=" + this._ctiSec.toFixed(2));
                callJSX("(function(){try{app.enableQE();qe.project.getActiveSequence().play();return'OK'}catch(e){return'ERR:'+e.message}})()").then(function(result){
                    log("📝 SRT: PLAY result: " + result);
                });
                if (btn) btn.innerHTML = '⏸ PAUSA';
                if (this._pollInterval) clearInterval(this._pollInterval);
                this._pollInterval = setInterval(function () { self._pollTick(); }, 250);
                // (l'interpolació local del cabezal ja corre contínuament des de _startPolling)
            } else {
                if (this._playheadLocal) {
                    this._timelineRunning = false;
                    // Fixar la base al playhead actual perquè el _localPlayInterval no torni enrere.
                    this._ctiSec = this._tlAtMedia(this._playheadSec);
                    this._ctiAt = (window.performance && performance.now) ? performance.now() : Date.now();
                    log("⏸⏸ PAUSA LOCAL: media=" + this._playheadSec.toFixed(2));
                } else {
                    callJSX("(function(){try{app.enableQE();qe.project.getActiveSequence().stop();return'OK'}catch(e){return'ERR:'+e.message}})()").then(function(result){
                        log("📝 SRT: STOP result: " + result);
                    });
                }
                if (btn) btn.innerHTML = '▶ PLAY';
                log("⏸⏸ PAUSA: media=" + this._playheadSec.toFixed(2) + " tl=" + this._ctiSec.toFixed(2));
                if (this._pollInterval) clearInterval(this._pollInterval);
                this._pollInterval = setInterval(function () { self._pollTick(); }, 400);
                this._pollTick(); // re-sincronitzar el playhead amb el CTI real de seguida
            }
        },

        // Layout únic compacte: regla a dalt + UNA zona de treball on la WF fa de
        // fons i els clips de subtítols hi queden superposats (semitransparents).
        _getLayout: function () {
            var zoneTop = this._rulerHeight + 1;   // la zona comença just sota la regla
            var zoneH = this._workZoneH || 40;
            var canvasH = zoneTop + zoneH + 1;
            return { rulerHeight: this._rulerHeight, zoneTop: zoneTop, zoneH: zoneH, canvasH: canvasH };
        },

        // Coordenada Y del cursor en l'espai del canvas (compensa l'escalat CSS).
        _eventY: function (e) {
            var rect = this._canvas.getBoundingClientRect();
            var scaleY = (rect.height > 0) ? (this._canvas.height / rect.height) : 1;
            return (e.clientY - rect.top) * scaleY;
        },

        // La REGLA és l'única zona del cabezal: tot el que queda per sota
        // (zona de treball WF+clips) és zona de marcadors.
        _inRulerZone: function (e) {
            return this._eventY(e) < this._getLayout().rulerHeight;
        },

        render: function () {
            if (!this._ctx || !this._canvas) return;
            var ctx = this._ctx;
            var origin = this._axisOrigin || 0;
            var canvasW = Math.max(1800, (this._maxSec - origin) * this._pixelsPerSec + 100);
            if (!isFinite(canvasW) || canvasW > 60000) canvasW = 60000; // guard de seguretat (evita cuelgues)
            var L = this._getLayout();
            this._canvas.width = canvasW;
            this._canvas.height = L.canvasH;
            
            ctx.fillStyle = '#1a1a1a';
            ctx.fillRect(0, 0, canvasW, L.canvasH);
            
            this._drawRuler(ctx);
            // Capes superposades a la zona de treball: primer la WF (fons) i per
            // sobre els clips de subtítols semitransparents → es veuen les pauses
            // d'àudio a través dels clips per encaixar els subtítols.
            this._drawWaveform(ctx, L.zoneTop, L.zoneH);
            this._drawTrack(ctx, L.zoneTop, L.zoneH);
            // El playhead es dibuixa ABAIX dels marcadors perquè no els tapi
            // (els marcadors sempre visibles durant el drag).
            this._drawPlayhead();
            this._drawMarkers(ctx);

            // Actualitzar la barra de zoom (estil Premiere) i mantenir el cabezal visible
            this._updateZoomBar();
            this._ensurePlayheadVisible();
        },

        // Eix del timeline: x=0 correspon al media de l'IN del primer clip (_axisOrigin).
        // Així el que es veu a l'extensió coincideix amb el que es veu al timeline de Premiere
        // (regla, subtítols i waveform es mostren en temps de TIMELINE, no de media).
        _secToX: function (sec) {
            return (sec - (this._axisOrigin || 0)) * this._pixelsPerSec;
        },

        _xToSec: function (px) {
            return px / this._pixelsPerSec + (this._axisOrigin || 0);
        },

        _drawRuler: function (ctx) {
            ctx.fillStyle = '#2a2a2a';
            ctx.fillRect(0, 0, this._canvas.width, this._rulerHeight);
            ctx.fillStyle = '#888';
            ctx.font = '9px monospace';
            ctx.strokeStyle = '#555';
            var secInterval = Math.max(1, Math.floor(40 / this._pixelsPerSec));
            var origin = this._axisOrigin || 0;
            for (var s = origin; s <= this._maxSec; s += secInterval) {
                var x = this._secToX(s);
                ctx.beginPath();
                ctx.moveTo(x, this._rulerHeight - 6);
                ctx.lineTo(x, this._rulerHeight);
                ctx.stroke();
                var showSec = s - origin;   // temps de TIMELINE (0 = IN del clip)
                var mm = Math.floor(showSec / 60);
                var ss = Math.floor(showSec % 60);
                ctx.fillText((mm < 10 ? '0' : '') + mm + ':' + (ss < 10 ? '0' : '') + ss, x + 2, this._rulerHeight - 2);
            }
        },

        // Clips de subtítols SEMITRANSPARENTS superposats a la WF (fons): el fill
        // translúcid deixa veure les pauses d'àudio per sota i encaixar els
        // subtítols sense necessitar una franja pròpia per als clips.
        _drawTrack: function (ctx, y, h) {
            var bh = h - 3;               // alçada del bloc del clip (marge vertical)
            var by = y + 1;
            for (var i = 0; i < this._entries.length; i++) {
                var e = this._entries[i];
                var x = this._secToX(e.startSec);
                var w = (e.endSec - e.startSec) * this._pixelsPerSec;
                if (w < 2) w = 2;
                ctx.fillStyle = 'rgba(143,74,212,0.45)';   // lila translúcid
                ctx.fillRect(x, by, w, bh);
                if (w >= 4) {
                    ctx.strokeStyle = 'rgba(210,175,255,0.9)';
                    ctx.lineWidth = 1;
                    ctx.strokeRect(x + 0.5, by, w - 1, bh);
                }
            }
        },

        // WF com a FONS de tota la zona de treball, sense atenuar (cal veure bé les
        // pauses d'àudio per encaixar els subtítols). h = alçada de la zona.
        _drawWaveform: function (ctx, y, h) {
            ctx.fillStyle = '#0d2818';
            ctx.fillRect(0, y, this._canvas.width, h);
            if (this._waveformPeaks && this._waveformPeaks.length > 0) {
                // Espai de MEDIA del clip (identitat): la WF coincideix amb els
                // subtítols del SRT (que viuen en temps de media). El cabezal
                // converteix tl↔media (vegeu _mediaAtSec/_tlAtMedia).
                // ⚡ Pre-càlcul: les altures per píxel només es recalculen quan
                // canvia zoom/peaks/rangs (no a cada render → evita cuelgues al clicar).
                var key = this._canvas.width + '|' + this._pixelsPerSec + '|' + this._waveformPeaks.length + '|' + this._axisOrigin + '|' + this._wfMediaStart + '|' + this._wfMediaEnd;
                if (key !== this._wfCacheKey || !this._wfPixelHeights || this._wfPixelHeights.length !== this._canvas.width) {
                    this._wfCacheKey = key;
                    this._computeWaveformPixels();
                }
                var H = this._wfPixelHeights || [];
                ctx.fillStyle = '#22cc66';
                for (var px = 0; px < H.length; px++) {
                    var g = Math.min(1, H[px] * (this._waveformGain || 1));
                    var hcol = g * (h - 2);
                    if (hcol < 1) hcol = 1;
                    ctx.fillRect(px, y + h - hcol, 1, hcol);
                }
            }
            // Sense dades la zona queda amb el fons verd fosc de la WF.
        },

        /**
         * _computeWaveformPixels: Pre-calcula les altures de la waveform per píxel
         * (una sola vegada per zoom/càrrega). El render només fa fillRect, sense
         * el bucle anidat sobre peaks → evita que el clic/arrossegament es pengi.
         */
        _computeWaveformPixels: function () {
            var W = this._canvas.width;
            this._wfPixelHeights = new Array(W);
            if (!this._waveformPeaks || this._waveformPeaks.length === 0) {
                for (var z = 0; z < W; z++) this._wfPixelHeights[z] = 0;
                return;
            }
            var pps = this._waveformPPS || 480;
            var nPeaks = this._waveformPeaks.length;
            var wfStart = this._wfMediaStart || 0;
            var wfEnd = this._wfMediaEnd || 0;
            var hasRange = (wfEnd > wfStart);
            for (var px = 0; px < W; px++) {
                var sec = this._xToSec(px);
                var secEnd = this._xToSec(px + 1);
                if (hasRange && (sec < wfStart || sec >= wfEnd)) { this._wfPixelHeights[px] = 0; continue; }
                var idxStart = Math.floor(sec * pps);
                var idxEnd = Math.max(idxStart + 1, Math.floor(secEnd * pps));
                if (idxStart < 0 || idxStart >= nPeaks) { this._wfPixelHeights[px] = 0; continue; }
                if (idxEnd > nPeaks) idxEnd = nPeaks;
                var maxV = 0;
                for (var k = idxStart; k < idxEnd; k++) {
                    if (this._waveformPeaks[k] > maxV) maxV = this._waveformPeaks[k];
                }
                this._wfPixelHeights[px] = maxV;
            }
        },

        _drawPlayhead: function () {
            if (!this._ctx) return;
            var x = this._secToX(this._playheadSec);
            var ctx = this._ctx;
            ctx.strokeStyle = 'rgba(255, 60, 60, 0.55)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, this._canvas.height);
            ctx.stroke();
            ctx.fillStyle = '#ff3333';
            ctx.beginPath();
            ctx.moveTo(x - 4, 0); ctx.lineTo(x + 4, 0); ctx.lineTo(x, 6);
            ctx.closePath();
            ctx.fill();
        },

        _updatePreview: function (ctiSec) {
            var entry = null;
            for (var i = 0; i < this._entries.length; i++) {
                if (ctiSec >= this._entries[i].startSec && ctiSec < this._entries[i].endSec) { entry = this._entries[i]; break; }
            }
            var text = entry ? entry.texts.join('<br>') : '';
            // Overlay de subtítols sobre el vídeo (PLAN_VIDEO_PREVIEW)
            var subs = document.getElementById('srtVideoSubs');
            if (subs) subs.innerHTML = text;
        },

        _drawMarkers: function (ctx) {
            if (!this._markers || this._markers.length === 0) return;
            for (var i = 0; i < this._markers.length; i++) {
                var x = this._secToX(this._markers[i]);
                var inDrag = (i === this._dragIdx);
                // Línia més gruixuda per facilitar l'apuntat i el drag
                ctx.strokeStyle = inDrag ? '#ffd24d' : '#ffaa00';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(x, 0);
                ctx.lineTo(x, this._canvas.height);
                ctx.stroke();
                // Indicador superior ben visible
                ctx.fillStyle = inDrag ? '#ffd24d' : '#ffaa00';
                ctx.beginPath();
                ctx.moveTo(x - 7, 0); ctx.lineTo(x + 7, 0); ctx.lineTo(x, 10);
                ctx.closePath();
                ctx.fill();
                ctx.strokeStyle = '#000';
                ctx.lineWidth = 1;
                ctx.stroke();
            }
        },

        _canvasXToSec: function (e) {
            var rect = this._canvas.getBoundingClientRect();
            var scaleX = this._canvas.width / rect.width;
            var canvasX = (e.clientX - rect.left) * scaleX;
            return this._xToSec(canvasX);
        },

        _markerAtSec: function (sec, wideTol) {
            // Tolerància de captura. Amb wideTol=true (arrossegament) s'usa el més gran
            // entre la tol en píxels (12/pps) i un mínim en segons (20s per defecte) per
            // no "pillar-se els dits" en zooms amples. Amb wideTol=false (crear/esborrar
            // marcadors amb clic dret / drag normal) es manté la tol estricta en píxels.
            var tolPx = this._MARKER_TOL_PX / this._pixelsPerSec;
            var tol = (wideTol) ? Math.max(tolPx, this._MARKER_TOL_MIN_SEC || 0) : tolPx;
            // Sempre es captura el marcador MÉS PROPER dins de la tol (no el primer que
            // la compleixi): evita agafar un marcador llunyà si n'hi ha un de més a prop.
            var best = -1, bestD = Infinity;
            for (var i = 0; i < this._markers.length; i++) {
                var d = Math.abs(this._markers[i] - sec);
                if (d <= tol && d < bestD) { bestD = d; best = i; }
            }
            return best;
        },

        /**
         * _snapToSubtitleBoundary: retorna el startSec/endSec més proper de les
         * entrades (subtítols) a 'sec'. Si no hi ha entrades, retorna 'sec' tal qual.
         * @param {number} sec - Posició (en temps de media)
         * @param {Array} [entriesRef] - Entrades de referència (per defecte: this._entries)
         */
        _snapToSubtitleBoundary: function (sec, entriesRef) {
            var refs = entriesRef || this._entries;
            if (!refs || refs.length === 0) return sec;
            var best = sec, bestDist = Infinity;
            for (var i = 0; i < refs.length; i++) {
                var cands = [refs[i].startSec, refs[i].endSec];
                for (var c = 0; c < cands.length; c++) {
                    var d = Math.abs(cands[c] - sec);
                    if (d < bestDist) { bestDist = d; best = cands[c]; }
                }
            }
            return best;
        },

        /**
         * _actualToOriginal: Mapeja un punt de l'espai ACTUAL (el que es veu,
         * _entries deformada pel warp) a l'espai ORIGINAL (_originalEntries).
         * Per a límits de clip (IN/OUT) fa un mapatge precís clip-a-clip; per a
         * punts interiors fa servir la inversa lineal del warp com a fallback.
         */
        _actualToOriginal: function (sec) {
            var orig = this._originalEntries || [];
            var cur = this._entries || [];
            if (orig.length === 0) return sec;

            // 1) Mapatge precís per límits de clip (IN/OUT). _entries i _originalEntries
            //    comparteixen ordre i nombre, així que el mateix índex = el mateix clip.
            for (var i = 0; i < cur.length; i++) {
                if (i >= orig.length) break;
                if (Math.abs(cur[i].startSec - sec) < 0.001) return orig[i].startSec;
                if (Math.abs(cur[i].endSec - sec) < 0.001) return orig[i].endSec;
            }

            // 2) Fallback: inversa lineal del warp (per a punts que no són límits exactes).
            var O = (this._originalMarkers || []).slice().sort(function (a, b) { return a - b; });
            var C = (this._markers || []).slice().sort(function (a, b) { return a - b; });
            var k = Math.min(O.length, C.length);
            var firstIn = orig[0].startSec;
            var lastOut = orig[orig.length - 1].endSec;

            // La cua posterior a l'últim marcador es desplaça per delta (MOVE), igual que a
            // _applyAllMarkers, així que el darrer límit actual és lastOut + delta (no lastOut).
            var cLast = lastOut;
            if (k > 0) cLast = lastOut + (C[k - 1] - O[k - 1]);

            var oBounds = [firstIn].concat(O.slice(0, k)).concat([lastOut]);
            var cBounds = [firstIn].concat(C.slice(0, k)).concat([cLast]);

            for (var s = 0; s < cBounds.length - 1; s++) {
                var ca = cBounds[s], cb = cBounds[s + 1];
                if (sec >= ca && sec <= cb) {
                    var oa = oBounds[s], ob = oBounds[s + 1];
                    if (cb - ca < 0.0001) return oa;
                    return oa + (sec - ca) * (ob - oa) / (cb - ca);
                }
            }
            return sec;
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
            // Fora dels clips: estendre linealment el mapa per poder editar
            // més enllà de l'OUT (i abans de l'IN) sense que el playhead salti.
            var first = segs[0];
            if (sec < first.s) return first.m + (sec - first.s) * first.r;
            var last = segs[segs.length - 1];
            var lastMEnd = last.m + (last.e - last.s) * last.r;
            return lastMEnd + (sec - last.e) * last.r;
        },

        /**
         * _tlAtMedia: retorna el temps de timeline on sona el temps de media 'media'.
         * (invers de _mediaAtSec). Fora de cap segment → retorna 'media' (identitat).
         */
        _tlAtMedia: function (media) {
            var segs = this._waveformSegments || [];
            if (segs.length === 0) return media - (this._axisOrigin || 0);
            for (var g = 0; g < segs.length; g++) {
                var sg = segs[g];
                var mEnd = sg.m + (sg.e - sg.s) * sg.r;
                if (media >= sg.m && media < mEnd) {
                    return sg.s + (media - sg.m) / sg.r;
                }
            }
            // Fora dels clips: estendre linealment el mapa (no retornar 'media' tal qual,
            // que inflava el temps de timeline i feia saltar/retornar el playhead).
            var first = segs[0];
            if (media < first.m) return first.s + (media - first.m) / first.r;
            var last = segs[segs.length - 1];
            var lastMEnd = last.m + (last.e - last.s) * last.r;
            return last.e + (media - lastMEnd) / last.r;
        },

        /**
         * _getTlMaxSec: final físic del timeline (final del darrer clip de vídeo).
         * Més enllà d'aquest punt el CTI de Premiere no hi pot anar.
         */
        _getTlMaxSec: function () {
            var segs = this._waveformSegments || [];
            var maxE = -Infinity;
            for (var g = 0; g < segs.length; g++) {
                if (segs[g].e > maxE) maxE = segs[g].e;
            }
            return isFinite(maxE) ? maxE : null;
        },

        /**
         * _applyAllMarkers: Recalcula TOTA la taula de clips des de la taula ORIGINAL
         * (_originalEntries) segons les posicions dels marcadors. Cada segment entre
         * marcadors consecutius es re-escala amb scaleSegmentWithGaps (acordió: separació
         * base 3 frames + pauses escalables); la cua posterior a l'últim marcador es
         * desplaça sòlidament (MOVE). Així l'edició és pura i no es degrada amb
         * iteracions (sempre es recalcula des de l'original).
         */
        _applyAllMarkers: function () {
            var P = window.FASTPASS_UI.Logic.SrtParser;
            var orig = this._originalEntries || [];
            if (orig.length === 0) { this._entries = []; return; }

            var O = (this._originalMarkers || []).slice().sort(function (a, b) { return a - b; });
            var C = (this._markers || []).slice().sort(function (a, b) { return a - b; });
            var k = Math.min(O.length, C.length);

            var firstIn = orig[0].startSec;
            var result = [];

            // Escala un segment [oa, ob] → [ca, cb] (acordió amb gaps de 3 frames).
            var scaleRange = function (oa, ob, ca, cb) {
                var segClips = [];
                for (var i = 0; i < orig.length; i++) {
                    if (orig[i].startSec >= oa && orig[i].startSec < ob) segClips.push(orig[i]);
                }
                if (segClips.length === 0) return;
                var gaps = [segClips[0].startSec - oa]; // lead
                for (var j = 0; j < segClips.length - 1; j++) gaps.push(segClips[j + 1].startSec - segClips[j].endSec);
                gaps.push(ob - segClips[segClips.length - 1].endSec); // trail
                var scaled = P.scaleSegmentWithGaps(segClips, gaps, ca, cb);
                result = result.concat(scaled);
            };

            // Segmentos ACORDIÓ: [firstIn, o0], [o0, o1], ..., [o_{k-2}, o_{k-1}]
            for (var s = 0; s < k; s++) {
                var oa = (s === 0) ? firstIn : O[s - 1];
                var ob = O[s];
                var ca = (s === 0) ? firstIn : C[s - 1];
                var cb = C[s];
                scaleRange(oa, ob, ca, cb);
            }

            // Cua final (després de l'últim marcador): MOVE (desplaçament sòlid, sense escalar)
            if (k > 0) {
                var delta = C[k - 1] - O[k - 1];
                for (var t = 0; t < orig.length; t++) {
                    var e = orig[t];
                    if (e.startSec >= O[k - 1]) {
                        result.push({ index: e.index, timeStr: e.timeStr, texts: e.texts.slice(), startSec: e.startSec + delta, endSec: e.endSec + delta });
                    }
                }
            } else {
                // Sense marcadors: copiar la taula original tal qual
                for (var c0 = 0; c0 < orig.length; c0++) {
                    var e0 = orig[c0];
                    result.push({ index: e0.index, timeStr: e0.timeStr, texts: e0.texts.slice(), startSec: e0.startSec, endSec: e0.endSec });
                }
            }

            for (var r = 0; r < result.length; r++) result[r].index = r + 1;
            this._entries = result;
        },

        /**
         * _applyMarkerDrag: Mou el marcador _dragIdx a P1 i recalcula la taula completa.
         * El clamp impedeix creuar els marcadors veïns (l'ordre original es manté).
         */
        _applyMarkerDrag: function (P1) {
            if (typeof P1 !== 'number' || !isFinite(P1)) return; // protecció contra NaN/Infinity
            var i = this._dragIdx;
            if (i < 0 || i >= this._markers.length) return;
            var C = (this._markers || []).slice();
            var firstIn = (this._originalEntries && this._originalEntries.length) ? this._originalEntries[0].startSec : 0;
            // Els límits es prenen de les posicions ACTUALS dels marcadors veïns
            // (no de les originals), per no crear barreres artificials al drag.
            var A = i > 0 ? C[i - 1] : firstIn;
            var N = i < C.length - 1 ? C[i + 1] : null;
            if (P1 < A + 0.1) P1 = A + 0.1;
            if (N !== null && P1 > N - 0.1) P1 = N - 0.1;
            this._markers[i] = P1;
            this._applyAllMarkers();
        },

        _getManifestCtx: function () {
            var ctx = window.FASTPASS_UI.State;
            if (!ctx || !ctx.progData || !ctx.config || !ctx.dateDir || !ctx.bloque) return null;
            if (!ctx.config.rutas || !ctx.config.rutas.destinoBase) return null;
            return ctx;
        },

        /**
         * _markersFilePath: ruta d'un fitxer LOCAL petit per als marcadors.
         * Evita reescriure el manifest de 224 ítems (53KB) al NAS en cada operació,
         * que era la causa dels cuelgues (IO.writeTxt bloquejava ExtendScript ~25s).
         */
        _markersFilePath: function () {
            var safe = (this._srtName || 'srt').replace(/[^a-zA-Z0-9_-]/g, '_');
            return "C:/temp/fastpass_srt_markers_" + safe + ".json";
        },

        _persistMarkers: function () {
            try {
                try { window.cep.fs.makedir("C:/temp"); } catch (e1) { }
                var data = JSON.stringify({
                    srtName: this._srtName,
                    projectKey: this._projectKey || '',
                    markers: this._markers.slice(),
                    originalMarkers: (this._originalMarkers || []).slice(),
                    updatedAt: new Date().toISOString()
                });
                window.cep.fs.writeFile(this._markersFilePath(), data);
            } catch (e) { }
        },

        _restoreMarkers: async function () {
            try {
                var res = window.cep.fs.readFile(this._markersFilePath());
                if (res && res.err === 0 && res.data) {
                    var parsed = JSON.parse(res.data);
                    // Només es restaura si és del MATEIX projecte/sessió: la persistència
                    // local és per recuperar la sessió en curs, no per portar marques de
                    // projectes o sessions anteriors al carregar un SRT nou.
                    var keyActual = this._projectKey || '';
                    if (!keyActual) {
                        try {
                            var pf = await callJSX("Context.folder()");
                            keyActual = (pf && String(pf).indexOf('ERR') !== 0) ? String(pf) : '';
                            this._projectKey = keyActual;
                        } catch (eK) { }
                    }
                    var sameProject = !!(keyActual && parsed && parsed.projectKey && parsed.projectKey === keyActual);
                    if (parsed && parsed.srtName === this._srtName && Array.isArray(parsed.markers) && sameProject) {
                        this._markers = parsed.markers.filter(function (m) { return typeof m === 'number' && isFinite(m); });
                        this._markers.sort(function (a, b) { return a - b; });
                        var om = Array.isArray(parsed.originalMarkers) ? parsed.originalMarkers : parsed.markers;
                        this._originalMarkers = om.filter(function (m) { return typeof m === 'number' && isFinite(m); });
                        this._originalMarkers.sort(function (a, b) { return a - b; });
                        if (this._markers.length > 0) log("📝 SRT_EDIT: " + this._markers.length + " marcadors restaurats (local, mateixa sessió)");
                    } else if (parsed && parsed.srtName === this._srtName && parsed.projectKey && keyActual && !sameProject) {
                        // Restes d'un altre projecte: netejar per no contaminar sessions futures.
                        log("📝 SRT_EDIT: Marcadors locals d'un altre projecte descartats (neteja).", "WARN");
                        try { window.cep.fs.writeFile(this._markersFilePath(), ''); } catch (eCl) { }
                    }
                }
            } catch (e) { }
        },

        setPlayhead: function (sec) {
            if (sec < 0) sec = 0;
            // sec és temps de MEDIA (espai dels subtítols i la WF) → convertir a TL per Premiere
            this._playheadSec = sec;
            var tl = this._tlAtMedia(sec);
            // Abans de l'IN del clip (media < origen) no hi ha contingut al timeline → tl=0
            if (tl < 0 || sec < (this._axisOrigin || 0)) tl = 0;
            // Actualitzar la base d'interpolació per no derivar cap al CTI anterior
            this._ctiSec = tl;
            this._ctiAt = (window.performance && performance.now) ? performance.now() : Date.now();
            this._timelineRunning = false;
            // El cabezal de Premiere SÍ pot anar més enllà del final del darrer clip
            // (manualment funciona): enviem el tl REAL, sense clampar a cap OUT/zona de treball.
            this._playheadLocal = false;
            this._pendingSeek = tl;
            getUtils().status("Cabezal → tl " + tl.toFixed(2) + "s (media " + sec.toFixed(2) + "s)", "exito");
            callJSX("Timeline.set(" + tl.toFixed(3) + ")").then(function (r) {
                log("🖱 Timeline.set(" + tl.toFixed(3) + ") → " + r);
            });
            this.render();
            this._updatePreview(sec);
            this._syncVideo(sec);
        },

        applyIn: function () {
            var cti = this._playheadSec;
            var targetIdx = window.FASTPASS_UI.Logic.SrtParser.findTargetByTime(this._entries, cti);
            log("📝 SRT_EDIT: IN cti=" + cti.toFixed(2) + "s → targetIdx=" + targetIdx + "/" + this._entries.length
                + (targetIdx >= 0 ? " (entry start=" + this._entries[targetIdx].startSec.toFixed(2) + "s)" : ""));
            if (targetIdx < 0) { getUtils().status("CTI no sobre cap caption", "warn"); return; }
            var originalStart = this._entries[targetIdx].startSec;
            // Padding inicial: 10 frames = 0.4s a 25fps. El primer subtítol NO pot
            // començar a 00:00; ha de començar a 00:00:00:10 (10 frames).
            // En temps de MEDIA cal sumar l'origen (IN del clip) perquè l'editor ho
            // mostri al punt correcte; la conversió media→timeline es fa a l'exportar.
            var PAD_START_SEC = 0.4;
            var newStart = (this._axisOrigin || 0) + PAD_START_SEC;
            log("📝 SRT_EDIT: IN → primer clip a media " + newStart.toFixed(2) + "s (padding " + PAD_START_SEC.toFixed(2) + "s)");
            this._entries = window.FASTPASS_UI.Logic.SrtParser.applyTrimIn(this._entries, targetIdx, newStart);
            // Marcadors: mateix offset que les entrades + àncora al primer clip
            var offset = newStart - originalStart;
            this._markers = this._markers.map(function (m) { return m + offset; }).filter(function (m) { return m >= 0.39; });
            if (this._entries.length > 0) {
                var first = this._entries[0].startSec;
                var exists = this._markers.some(function (m) { return Math.abs(m - first) < 0.05; });
                if (!exists) this._markers.push(first);
                this._markers.sort(function (a, b) { return a - b; });
            }
            this._originalEntries = this._entries.map(function (e) { return { index: e.index, timeStr: e.timeStr, texts: e.texts.slice(), startSec: e.startSec, endSec: e.endSec }; });
            this._originalMarkers = this._markers.slice();
            this._isDirty = true; this.render();
            this._persistMarkers();
            getUtils().status("IN: " + this._entries.length + " entrades", "exito");
        },

        applyOut: function () {
            var cti = this._playheadSec;
            var targetIdx = window.FASTPASS_UI.Logic.SrtParser.findTargetByTime(this._entries, cti);
            if (targetIdx < 0) { getUtils().status("CTI no sobre cap caption", "warn"); return; }
            this._entries = window.FASTPASS_UI.Logic.SrtParser.applyTrimOut(this._entries, targetIdx);
            // Marcador al final del darrer clip: deixa ben definit el final dels
            // subtítols encara que s'editen marcadors intermedis.
            if (this._entries.length > 0) {
                var finalSec = this._entries[this._entries.length - 1].endSec;
                var exists = this._markers.some(function (m) { return Math.abs(m - finalSec) < 0.05; });
                if (!exists) {
                    this._markers.push(finalSec);
                    this._markers.sort(function (a, b) { return a - b; });
                    log("📝 SRT_EDIT: OUT → marcador final afegit a " + finalSec.toFixed(2) + "s");
                }
            }
            this._originalEntries = this._entries.map(function (e) { return { index: e.index, timeStr: e.timeStr, texts: e.texts.slice(), startSec: e.startSec, endSec: e.endSec }; });
            this._originalMarkers = this._markers.slice();
            this._isDirty = true; this.render();
            this._persistMarkers();
            getUtils().status("OUT: " + this._entries.length + " entrades", "exito");
        },

        applyAdjust: function () {
            var P = window.FASTPASS_UI.Logic.SrtParser;
            var orig = this._originalEntries;
            if (!orig || orig.length === 0) { getUtils().status("No hi ha entrades", "warn"); return; }
            var cti = this._playheadSec;
            var firstIn = orig[0].startSec;
            var lastOut = orig[orig.length - 1].endSec;
            if (cti <= firstIn + 0.05) { getUtils().status("CTI massa a l'inici", "warn"); return; }

            // Escalar TOT el segment [firstIn, lastOut] → [firstIn, cti] respectant gaps de 3 frames
            var gaps = [0];
            for (var j = 0; j < orig.length - 1; j++) gaps.push(orig[j + 1].startSec - orig[j].endSec);
            gaps.push(0);
            this._entries = P.scaleSegmentWithGaps(orig, gaps, firstIn, cti);

            // Escalar marcadors (posicions actuals i originals) amb el mateix factor
            var curDur = lastOut - firstIn, newDur = cti - firstIn;
            if (curDur > 0 && newDur > 0) {
                var ratio = newDur / curDur;
                this._markers = this._markers.map(function (m) { return firstIn + (m - firstIn) * ratio; });
                this._originalMarkers = this._originalMarkers.map(function (m) { return firstIn + (m - firstIn) * ratio; });
            }

            this._originalEntries = this._entries.map(function (e) { return { index: e.index, timeStr: e.timeStr, texts: e.texts.slice(), startSec: e.startSec, endSec: e.endSec }; });
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
            // Nom ÚNIC per exportació: l'API d'ExtendScript no permet esborrar ProjectItems
            // de forma fiable (no hi ha ProjectItem.delete), així que evitem col·lisions de nom.
            // Si reutilitzéssim "_MOD.srt", importFiles crearia "_MOD 1.srt" i Project.find
            // retornaria el contingut ANTIC (la "última versió" no s'aplicaria).
            var modName = projName + "_MOD_" + (new Date().getTime()) + ".srt";
            var modPath = projectFolder + "\\" + modName;
            log("📝 SRT_EDIT: Exportant a " + modPath);
            // Convertir els temps de MEDIA a TIMELINE per al .srt de sortida:
            // createCaptionTrack interpreta els temps del .srt com a temps de timeline.
            // (els subtítols del SRT original viuen en MEDIA; el timeline comença a l'IN del clip)
            // Conversió MEDIA → TIMELINE: resta de l'origen (el clip està trocejat però
            // contigu a velocitat 1x, així que media - origin = timeline exacte).
            // (NO fem servir _tlAtMedia aquí perquè retorna el valor sense convertir
            //  quan el temps cau fora del darrer segment, inflant la durada del darrer clip.)
            var origin = this._axisOrigin || 0;
            var exportEntries = this._entries
                .map(function (e) {
                    var s = e.startSec - origin;
                    var en = e.endSec - origin;
                    return { index: e.index, timeStr: e.timeStr, texts: e.texts.slice(),
                             startSec: (s < 0) ? 0 : s, endSec: en };
                })
                .filter(function (e) { return e.endSec > 0; });
            if (exportEntries.length > 0) {
                log("📝 SRT_EDIT: Exportant " + exportEntries.length + " entrades (de " + this._entries.length + "), timeline [" + exportEntries[0].startSec.toFixed(2) + "s → " + exportEntries[exportEntries.length - 1].endSec.toFixed(2) + "s]");
            }
            var srtContent = window.FASTPASS_UI.Logic.SrtParser.entriesToSrt(exportEntries);
            if (!srtContent) { getUtils().status("Error generant SRT", "error"); return; }
            var escapedPath = modPath.replace(/\\/g, '\\\\');
            var escapedContent = srtContent.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '');
            var writeResult = await callJSX("IO.writeTxt('" + escapedPath + "','" + escapedContent + "')");
            if (writeResult !== "OK") {
                try { window.cep.fs.writeFile(modPath, srtContent); } catch(e) { getUtils().status("Error escrivint _MOD.srt", "error"); return; }
            }
            // 1) Eliminar els clips de subtítols dels caption tracks antics PRIMER (allibera
            //    les referències per poder esborrar els items del projecte sense conflictes).
            try {
                var cleanJsx = "(function(){try{var s=app.project.activeSequence;if(!s)return'ERR_NO_SEQ';"
                    + "var removed=0;if(s.subtitleTracks){var n=s.subtitleTracks.numTracks||s.subtitleTracks.numItems;"
                    + "for(var t=0;t<n;t++){var tr=s.subtitleTracks[t];"
                    + "for(var i=tr.clips.numItems-1;i>=0;i--){try{tr.clips[i].remove();removed++}catch(e2){}}}}"
                    + "return'OK_removed_'+removed}catch(e){return'ERR:'+e.message}})()";
                var cleanResult = await callJSX(cleanJsx);
                log("📝 SRT_EDIT: Nets subtítols antics: " + cleanResult);
            } catch(e) {
                log("⚠️ SRT_EDIT: Error netejant subtítols antics: " + e.message);
            }

            // 2) Eliminar els items _MOD.srt anteriors del projecte (recursiu). Si no es fa,
            //    importFiles crea un duplicat (_MOD 1.srt) i Project.find retorna el contingut
            //    ANTIC: la versió editada a l'extensió no s'aplicaria al timeline.
            var cleanItems = await callJSX("(function(){try{var root=app.project.rootItem;var removed=0;function scan(bin){if(!bin||!bin.children)return;for(var i=bin.children.numItems-1;i>=0;i--){var c=bin.children[i];if(c&&c.name&&c.name.toUpperCase().indexOf('_MOD.SRT')>=0){try{c.delete();removed++}catch(e){}}else if(c&&c.type===2){scan(c)}}}scan(root);return'OK_removed_'+removed}catch(e){return'ERR:'+e.message}})()");
            log("📝 SRT_EDIT: Items _MOD.srt anteriors eliminats: " + cleanItems);
            var importResult = await callJSX("(function(){try{app.project.importFiles(['" + modPath.replace(/\\/g, '/') + "'],true,app.project.rootItem,false);return'OK'}catch(e){return'ERR:'+e.message}})()");
            if (importResult !== "OK") { getUtils().status("Error important _MOD.srt", "error"); return; }
            var escapedModName = encodeURIComponent(modName);
            var findResult = await callJSX("FASTPASS.Project.find(decodeURIComponent('" + escapedModName + "'))");
            if (!findResult || findResult === 'null') { getUtils().status("No es troba _MOD.srt al projecte", "error"); return; }

            var encModName = encodeURIComponent(modName);
            // 1) Intentar col·locar el SRT a una pista de subtítols EXISTENT (conserva l'estil)
            var captionResult = await callJSX("FASTPASS.Clips.placeSrtOnExistingSubtitleTrack('" + encModName + "', 0)");
            log("📝 SRT_EDIT: placeSrtOnExistingSubtitleTrack → " + captionResult);
            // 2) Fallback: crear una pista nova (sense estil) si no n'hi havia cap
            if (captionResult !== "OK") {
                captionResult = await callJSX("(function(){var s=app.project.activeSequence;if(!s)return'ERR_NO_SEQ';var i=FASTPASS.Project.find(decodeURIComponent('" + encModName + "'));if(!i)return'ERR_ITEM_NOT_FOUND';if(typeof s.createCaptionTrack!=='function')return'ERR_NO_CAPTION_API';return s.createCaptionTrack(i,0)?'OK':'ERR_FAILED'})()");
                log("📝 SRT_EDIT: createCaptionTrack (fallback) → " + captionResult);
            }
            if (captionResult === "OK") {
                getUtils().status("Exportat: " + this._entries.length + " entrades", "exito");
                log("✅ SRT_EDIT: Export OK " + modName);
            } else { getUtils().status("Error col·locant subtítols: " + captionResult, "error"); }
        },

        /**
         * resetToOriginal: Torna a la situació inicial: restaura la taula del SRT
         * carregat (sense edicions) i esborra tots els marcadors.
         */
        resetToOriginal: async function () {
            if (!this._loadedEntries || this._loadedEntries.length === 0) {
                getUtils().status("No hi ha SRT carregat per reiniciar", "warn");
                return;
            }
            var base = this._loadedEntries.map(function (e) {
                return { index: e.index, timeStr: e.timeStr, texts: e.texts.slice(), startSec: e.startSec, endSec: e.endSec };
            });
            this._entries = base;
            this._originalEntries = base.map(function (e) {
                return { index: e.index, timeStr: e.timeStr, texts: e.texts.slice(), startSec: e.startSec, endSec: e.endSec };
            });
            this._markers = [];
            this._originalMarkers = [];
            this._dragIdx = -1;
            this._isDirty = false;
            // Esborrar també els clips de subtítols (pistes caption) de la seqüència
            await this._clearSubtitleTracks();
            this.render();
            this._persistMarkers();
            getUtils().status("SRT reiniciat i subtítols de la seqüència esborrats", "exito");
        },

        /**
         * _exploreCaptionApi: introspecciona la API de caption/subtitle tracks en
         * runtime (no documentada) per descobrir si hi ha mètodes de borrat de PISTES
         * (no només clips). El resultat es mostra al log per decidir la via correcta.
         */
        _exploreCaptionApi: async function () {
            try {
                var jsx = "(function(){try{var out=[];"
                    + "var w=($.global.FASTPASS&&FASTPASS.Context)?FASTPASS.Context.getWorkSequence():app.project.activeSequence;"
                    + "if(!w)return'ERR_NO_SEQ';"
                    + "out.push('name='+w.name);"
                    + "if(w.videoTracks){out.push('vt='+w.videoTracks.numTracks);"
                    + "for(var i=0;i<w.videoTracks.numTracks;i++){var t=w.videoTracks[i];var tn='';try{tn=t.name}catch(e){}"
                    + "var pr=[];for(var k in t){pr.push(k)}"
                    + "out.push('V'+i+':'+tn+':'+pr.join(','));}}"
                    + "return out.join('|')}catch(e){return'ERR:'+e.message}})()";
                var result = await callJSX(jsx);
                log("🔍 SRT_EDIT: videoTracks → " + result);
                return result;
            } catch (e) {
                log("⚠️ SRT_EDIT: Error explorant API: " + e.message);
                return null;
            }
        },

        /**
         * _clearSubtitleTracks: elimina els clips de subtítols de TOTES les pistes
         * caption de la seqüència activa. (L'API no permet esborrar les pistes buides.)
         */
        _clearSubtitleTracks: async function () {
            try {
                // Diagnòstic previ: descobrir què exposa la API per a les PISTES
                await this._exploreCaptionApi();
            } catch (e) { }
            try {
                var cleanJsx = "(function(){try{var s=($.global.FASTPASS&&FASTPASS.Context)?FASTPASS.Context.getWorkSequence():app.project.activeSequence;if(!s)return'ERR_NO_SEQ';"
                    + "var removed=0;if(s.subtitleTracks){var n=s.subtitleTracks.numTracks||s.subtitleTracks.numItems;"
                    + "for(var t=0;t<n;t++){var tr=s.subtitleTracks[t];"
                    + "for(var i=tr.clips.numItems-1;i>=0;i--){try{tr.clips[i].remove();removed++}catch(e2){}}}}"
                    + "return'OK_removed_'+removed}catch(e){return'ERR:'+e.message}})()";
                var cleanResult = await callJSX(cleanJsx);
                log("📝 SRT_EDIT: Nets subtítols de la seqüència: " + cleanResult);
                return cleanResult;
            } catch (e) {
                log("⚠️ SRT_EDIT: Error netejant subtítols: " + e.message);
                return null;
            }
        },

        reset: function () {
            this.stop();
            this._entries = []; this._loadedEntries = []; this._originalEntries = []; this._playheadSec = 0; this._isDirty = false; this._srtPath = ""; this._srtName = "";
            this._waveformPeaks = null; this._waveformPPS = 480; this._wfCacheKey = ""; this._wfPixelHeights = null; this._isPlaying = false;
            this._waveformSegments = []; this._waveformMediaTag = ""; this._pollCount = 0;
            this._wfMediaStart = 0; this._wfMediaEnd = 0;
            this._markers = []; this._originalMarkers = []; this._dragIdx = -1;
            this._lastCtiSec = -1; this._lastLocalT = -1; this._lastLocalPx = -1;
            this._pendingSeek = null;
            if (this._ctx) this._ctx.clearRect(0, 0, this._canvas.width, this._canvas.height);
            this._hideEditor();
        }
    };

    window.FASTPASS_UI.Editor.SrtEditor = FASTPASS_UI.Editor.SrtEditor;
    window.SrtEditor = FASTPASS_UI.Editor.SrtEditor;
})();