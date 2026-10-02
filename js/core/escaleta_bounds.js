/**
 * ============================================================================
 * FASTPASS_UI.EscaletaReader: Sub-mòdul BOUNDS
 * ============================================================================
 * Càlcul de bounds de clips MP4: accessors de dades, clip bounds, OnAir bounds,
 * caretes interbloc, i el sistema de precisió de trim (3+1 tiers).
 *
 * Depèn de: escaleta_io.js (getLinesForBlock, getBlock)
 *           escaleta_items.js (isItemEstructural, getItemEntradaSec, getItemSortidaSec)
 *           escaleta_timecode.js (tcToSeconds, parseDurada, secondsToTC)
 *           escaleta_config.js (_getHandleSecs, _getCorrectedDuration)
 *
 * Mètodes:
 *   - getCleanFeed(data)
 *   - getBlock(data, blockId)
 *   - getLinesForBlock(data, blockId)
 *   - _hasOnAirEntrada(l)
 *   - _isEmitted(l)
 *   - isBlockFullyEmitted(data, blockId)
 *   - getBlockItems(data, blockId)
 *   - getProgramName(data)
 *   - getOnAirVideoItems(data, blockId)
 *   - getNeighbourOnAirTimes(data, blockId)
 *   - hasNonVideoItemsBefore(data, blockId)
 *   - calcClipBounds(worldTCMediaStart, worldTCBlockIn, worldTCBlockOut, handleSecs, worldTCMediaStop)
 *   - calcOnAirBounds(data, blockId, worldTCMediaStart, worldTCMediaStop, cfg)
 *   - _findCaretasBetween(allLines, fromIdx, toIdx, data)
 *   - _applyBaseColumnFloor(data, worldBlockStartSec, blockLines, maxGapSec)
 *   - _applyForeignVideoFloor(data, worldBlockStartSec, blockLines, maxGapSec)
 *   - calcPrecisionTrimBounds(data, blockId, mediaStart, mediaStop, config)
 * ============================================================================
 */

(function () {
    var FASTPASS_UI = window.FASTPASS_UI || {};
    var ER = FASTPASS_UI.EscaletaReader || {};

    var log = function (m, level) {
        (window.FASTPASS_UI.Utils && window.FASTPASS_UI.Utils.log)
            ? window.FASTPASS_UI.Utils.log(m, level || 'DEBUG')
            : (window.console && window.console.log(m));
    };

    // ----------------------------------------------------------------
    // 1. ACCESSORS DE DADES
    // ----------------------------------------------------------------

    /**
     * getCleanFeed: Retorna les dades del cleanFeed.
     */
    ER.getCleanFeed = function (data) {
        return (data && data.cleanFeed) ? data.cleanFeed : null;
    };

    /**
     * getBlock: Retorna el bloc VERTICAL per ID ("V1", "V2"...).
     */
    /**
     * getBlock: Retorna el bloc VERTICAL per ID ("V1", "V2"...).
     *
     * Nou format (JSON per bloc, clips[] buit): reconstrueix el bloc a partir
     * de mediaStart/mediaStop del cleanFeed i les línies d'escaleta.
     *
     * Format antic (JSON global, clips[] amb V1..V4): comportament original.
     *
     * @returns {Object|null} { id, tipus, in, out, titol, ready, creat }
     */
    ER.getBlock = function (data, blockId) {
        if (!data || !data.cleanFeed || !blockId) return null;

        var clips = data.cleanFeed.clips;
        if (clips && clips.length > 0) {
            // ─── Format antic: buscar dins de clips[] ───
            var block = null;
            for (var i = 0; i < clips.length; i++) {
                if (clips[i].id === blockId) { block = clips[i]; break; }
            }
            if (!block) {
                log('\u26A0\uFE0F [ER:Bounds] Bloc "' + blockId + '" no trobat al cleanFeed (format antic)');
                return null;
            }
            return block;
        }

        // ─── Nou format: JSON per bloc (clips[] buit) ───
        // El blockId es valida contra les línies d'escaleta (agrupacio)
        var lines = this.getLinesForBlock(data, blockId);
        if (lines.length === 0) {
            log('\u26A0\uFE0F [ER:Bounds] Bloc "' + blockId + '" sense línies a l\'escaleta (nou format)');
            return null;
        }

        // Derivar in/out de mediaStart/mediaStop
        var cf = data.cleanFeed;
        var mediaStart = cf.mediaStart || '00:00:00:00';
        var mediaStop  = cf.mediaStop  || mediaStart;

        // Buscar el primer i últim item amb horaEntradaOnAir per a l'interval real
        var firstOnAir = null;
        var lastOnAir  = null;
        for (var j = 0; j < lines.length; j++) {
            if (lines[j].horaEntradaOnAir) {
                if (!firstOnAir) firstOnAir = lines[j].horaEntradaOnAir;
                lastOnAir = lines[j].horaEntradaOnAir;
            }
        }

        // in: primer OnAir si existeix, sinó mediaStart
        // out: mediaStop (truncat al bloc en el nou format)
        var blockIn  = firstOnAir || mediaStart;
        var blockOut = mediaStop;

        log('\uD83D\uDCCB [ER:Bounds] Bloc "' + blockId + '" reconstruït (nou format): in=' + blockIn + ' out=' + blockOut + ' (' + lines.length + ' línies)');

        return {
            id: blockId,
            tipus: 'VERTICAL',
            in: blockIn,
            out: blockOut,
            titol: (data.parallelAntena && data.parallelAntena.nom) ? data.parallelAntena.nom + ' ' + blockId : blockId,
            ready: true,
            creat: false
        };
    };

    /**
     * getLinesForBlock: Retorna les línies d'escaleta que pertanyen a un bloc.
     * Filtra per agrupacio (case-insensitive) i descarta items flotants.
     */
    ER.getLinesForBlock = function (data, blockId) {
        var lines = data && data.escaleta && data.escaleta.liniesEscaleta ? data.escaleta.liniesEscaleta : null;
        if (!lines) return [];
        var target = blockId.toLowerCase();
        log('\uD83D\uDD0D [ER:Bounds] getLinesForBlock: target="' + target + '", total lines=' + lines.length);
        var filtered = [];
        for (var i = 0; i < lines.length; i++) {
            var l = lines[i];
            if (l.flotant === true) continue;
            var ag = l.agrupacio;
            if (ag && ag.toString().toLowerCase() === target) {
                filtered.push(l);
            }
        }
        log('\uD83D\uDD0D [ER:Bounds] Filtered count per bloc ' + blockId + ': ' + filtered.length);
        return filtered;
    };

    /**
     * _hasOnAirEntrada: Comprova si un ítem té hora d'entrada OnAir real (tally).
     * @param {Object} l - Línia d'escaleta
     * @returns {boolean}
     */
    ER._hasOnAirEntrada = function (l) {
        if (!l) return false;
        var h = l.horaEntradaOnAir ? String(l.horaEntradaOnAir).trim() : "";
        return !!h && h !== "00:00:00";
    };

    /**
     * _isEmitted: Comprova si un ítem ja s'ha emès.
     * Senyal principal: la marca 'emesa' (o 'emitido') de l'escaleta. Si el
     * playout ha donat tally, l'hora OnAir també ho confirma.
     * @param {Object} l - Línia d'escaleta
     * @returns {boolean}
     */
    ER._isEmitted = function (l) {
        if (!l) return false;
        return l.emesa === true || l.emitido === true || this._hasOnAirEntrada(l);
    };

    /**
     * isBlockFullyEmitted: Comprova si el bloc ja s'ha emès del tot. ÉS EL
     * CRITERI que fa vàlida una escaleta per començar a muntar (FOTO inclosa).
     *
     * CRITERI ÚNIC: l'ÚLTIM ítem del bloc (per 'sequencia') ja està emès
     * ('emesa' == true o hora OnAir real). Com que l'emissió és seqüencial, si
     * el darrer ítem ha entrat, tots els anteriors també s'han emès. Els ítems
     * intermedis sense OnAir (llibres, notes, ítems sense tally) NO bloquegen:
     * la seva posició es dedueix de l'anterior (_deduceOnAirEntrada).
     *
     * @param {Object} data - JSON d'escaleta (ja carregat)
     * @param {string} blockId - "V1", "V2"...
     * @returns {{ok:boolean, emitted:number, total:number, reason:string, pending:Object|null}}
     */
    ER.isBlockFullyEmitted = function (data, blockId) {
        var lines = this.getLinesForBlock(data, blockId);
        if (!lines || lines.length === 0) {
            return { ok: false, emitted: 0, total: 0, reason: "sense_linies", pending: null };
        }

        var last = null;
        var emitted = 0;
        var firstPending = null;
        for (var i = 0; i < lines.length; i++) {
            var l = lines[i];
            if (this._isEmitted(l)) {
                emitted++;
            } else if (!firstPending) {
                firstPending = { num: l.num || "?", titol: l.titol || "" };
            }
            if (!last || (l.sequencia || 0) > (last.sequencia || 0)) last = l;
        }

        var ok = this._isEmitted(last);

        if (!ok) {
            log("\u23F3 [ER:Bounds] Bloc " + blockId + ": " + emitted + "/" + lines.length +
                " ítems emesos. Darrer ítem pendent: " + (last.num || "?") + " (\"" + (last.titol || "") + "\")");
        } else {
            log("\u2705 [ER:Bounds] Bloc " + blockId + ": bloc complet (" + emitted + "/" + lines.length +
                " ítems emesos, darrer: " + (last.num || "?") + ")");
        }

        return {
            ok: ok,
            emitted: emitted,
            total: lines.length,
            reason: ok ? "ok" : "en_emissio",
            pending: firstPending,
        };
    };

    /**
     * getBlockItems: Retorna taula amb informació dels items d'un bloc.
     */
    ER.getBlockItems = function (data, blockId) {
        var block = this.getBlock(data, blockId);
        if (!block) {
            log('\u26A0\uFE0F [ER:Bounds] Bloc "' + blockId + '" no trobat');
            return [];
        }
        var lines = this.getLinesForBlock(data, blockId);
        var blockStartSec = this.tcToSeconds(block.in);
        var items = [];
        for (var i = 0; i < lines.length; i++) {
            var line = lines[i];
            var entrySec = this.tcToSeconds(line.horaEntradaPrevista);
            var offset = entrySec - blockStartSec;
            items.push({
                sequencia: line.sequencia,
                num: line.num || '',
                titol: line.titol || '',
                durada: line.durada || '',
                horaEntradaPrevista: line.horaEntradaPrevista || '',
                horaSortidaPrevista: line.horaSortidaPrevista || '',
                offset: offset >= 0 ? offset : 0
            });
        }
        items.sort(function (a, b) { return a.offset - b.offset; });
        return items;
    };

    /**
     * getProgramName: Retorna el nom del programa (de parallelAntena).
     */
    ER.getProgramName = function (data) {
        return (data && data.parallelAntena && data.parallelAntena.nom) ? data.parallelAntena.nom : '';
    };

    // ----------------------------------------------------------------
    // 2. ITEMS AMB OnAir
    // ----------------------------------------------------------------

    /**
     * getOnAirVideoItems: Retorna els items del bloc que tenen vídeo i OnAir.
     */
    ER.getOnAirVideoItems = function (data, blockId) {
        var lines = this.getLinesForBlock(data, blockId);
        var result = [];
        for (var i = 0; i < lines.length; i++) {
            if (lines[i].teVideo && lines[i].horaEntradaOnAir) {
                result.push(lines[i]);
            }
        }
        return result;
    };

    /**
     * getNeighbourOnAirTimes: Busca timestamps d'emissió dels blocs adjacents.
     */
    ER.getNeighbourOnAirTimes = function (data, blockId) {
        var clips = data && data.cleanFeed && data.cleanFeed.clips ? data.cleanFeed.clips : [];
        var idx = -1;
        for (var i = 0; i < clips.length; i++) {
            if (clips[i].id === blockId) { idx = i; break; }
        }
        if (idx === -1) return { prevEnd: null, nextStart: null };

        var prevBlock = idx > 0 ? clips[idx - 1] : null;
        var nextBlock = idx < clips.length - 1 ? clips[idx + 1] : null;

        var prevEnd = null;
        if (prevBlock) {
            var prevLines = this.getOnAirVideoItems(data, prevBlock.id);
            if (prevLines.length > 0) {
                var lastVid = prevLines[prevLines.length - 1];
                prevEnd = this.tcToSeconds(lastVid.horaEntradaOnAir) +
                          this.parseDurada(lastVid.duradaOnAir || lastVid.durada);
            }
        }

        var nextStart = null;
        if (nextBlock) {
            var nextLines = this.getOnAirVideoItems(data, nextBlock.id);
            if (nextLines.length > 0) {
                nextStart = this.tcToSeconds(nextLines[0].horaEntradaOnAir);
            }
        }

        return { prevEnd: prevEnd, nextStart: nextStart };
    };

    /**
     * hasNonVideoItemsBefore: Detecta si el bloc té items sense vídeo al principi o al final.
     */
    ER.hasNonVideoItemsBefore = function (data, blockId) {
        var lines = this.getLinesForBlock(data, blockId);
        if (lines.length === 0) return { before: false, after: false };

        lines.sort(function (a, b) { return (a.sequencia || 0) - (b.sequencia || 0); });

        var firstVideoIdx = -1;
        for (var i = 0; i < lines.length; i++) {
            if (lines[i].teVideo) { firstVideoIdx = i; break; }
        }

        var lastVideoIdx = -1;
        for (var j = lines.length - 1; j >= 0; j--) {
            if (lines[j].teVideo) { lastVideoIdx = j; break; }
        }

        return {
            before: firstVideoIdx > 0,
            after: lastVideoIdx !== -1 && lastVideoIdx < lines.length - 1
        };
    };

    // ----------------------------------------------------------------
    // 3. CLIP BOUNDS BÀSICS
    // ----------------------------------------------------------------

    /**
     * calcClipBounds: Calcula mp4ExpandedInPoint/OutPoint dins del MP4 cleanFeed.
     */
    ER.calcClipBounds = function (worldTCMediaStart, worldTCBlockIn, worldTCBlockOut, handleSecs, worldTCMediaStop) {
        var handles = this._getHandleSecs();
        var worldSecMediaStart = this.tcToSeconds(worldTCMediaStart);
        var worldSecBlockIn     = this.tcToSeconds(worldTCBlockIn);
        var worldSecBlockOut    = this.tcToSeconds(worldTCBlockOut);

        var mp4ExpandedInPoint  = Math.max(0, (worldSecBlockIn  - worldSecMediaStart) - handles);
        // Marge de sortida (2026-09-16): a més dels handles, s'hi afegeix
        // clipOutMarginSec perquè el clip tingui material per estirar a la timeline.
        var outMarginSec = (typeof this._getOutMarginSec === 'function') ? this._getOutMarginSec() : 30;
        var mp4ExpandedOutPoint = (worldSecBlockOut - worldSecMediaStart) + handles + outMarginSec;

        if (worldTCMediaStop) {
            var worldSecMediaStop = this.tcToSeconds(worldTCMediaStop);
            var maxDur = worldSecMediaStop - worldSecMediaStart;
            if (mp4ExpandedOutPoint > maxDur) mp4ExpandedOutPoint = maxDur;
        }

        var mp4Duration = mp4ExpandedOutPoint - mp4ExpandedInPoint;
        return { mp4ExpandedInPoint: mp4ExpandedInPoint, mp4ExpandedOutPoint: mp4ExpandedOutPoint, mp4Duration: mp4Duration };
    };

    // ----------------------------------------------------------------
    // 4. OnAir BOUNDS
    // ----------------------------------------------------------------

    /**
     * calcOnAirBounds: Calcula bounds basats en dades reals de playout.
     * Si no hi ha dades OnAir, fa fallback a calcClipBounds.
     */
    ER.calcOnAirBounds = function (data, blockId, worldTCMediaStart, worldTCMediaStop, cfg) {
        var videoItems = this.getOnAirVideoItems(data, blockId);
        var worldSecMediaStart = this.tcToSeconds(worldTCMediaStart);
        var handles = this._getHandleSecs();

        // ── (2026-09-17) DESCARTAR OnAir "MENTIDERS" ────────────────────────────
        // El realitzador llança ítems de prova i el seu timecode queda com OnAir,
        // sovint ABANS de l'inici del programa. Cas TNC 17/09: els "08 P2-1/P2-2"
        // tenien OnAir 13:48:08/13:48:42 quan el programa comença a les 13:50 →
        // el bloc s'inflava 8 min de buit (clip de 13 min en lloc de 3).
        // Criteri: OnAir anterior a (inici de programa − 90 s) = sospitós → no
        // compta per al càlcul del bloc. Mai no es descarten tots (salvaguarda).
        try {
            var progKey = (typeof this._detectProgramKey === 'function') ? this._detectProgramKey(data) : null;
            var cfgAll = window.FASTPASS_UI.Config && window.FASTPASS_UI.Config.get();
            var startH = (cfgAll && cfgAll.programStartHours && progKey) ? Number(cfgAll.programStartHours[progKey]) : null;
            if (progKey && startH != null && isFinite(startH)) {
                var minOnAirSec = Math.round(startH * 3600) - 90;
                var filtered = [];
                for (var fi = 0; fi < videoItems.length; fi++) {
                    var oaSec = this.tcToSeconds(videoItems[fi].horaEntradaOnAir);
                    if (oaSec != null && oaSec < minOnAirSec) {
                        log('🕵️ [ER:Bounds] OnAir SOSPITÓS (anterior a l\'inici de programa ' + this.secondsToTC(minOnAirSec) +
                            '): "' + (videoItems[fi].num || '?') + '" @ ' + videoItems[fi].horaEntradaOnAir + ' → fora del càlcul del bloc');
                        continue;
                    }
                    filtered.push(videoItems[fi]);
                }
                if (filtered.length > 0 && filtered.length < videoItems.length) {
                    log('🕵️ [ER:Bounds] Bloc ' + blockId + ': ' + (videoItems.length - filtered.length) +
                        ' ítem(s) amb OnAir no plausible(s) descartats (' + filtered.length + ' queden)');
                    videoItems = filtered;
                }
            }
        } catch (eSus) {
            log('⚠️ [ER:Bounds] No s\'han pogut filtrar OnAir sospitosos: ' + eSus.message, 'WARN');
        }

        if (videoItems.length === 0) {
            log('\u26A0\uFE0F [ER:Bounds] No hi ha items amb horaEntradaOnAir al bloc ' + blockId + '. Usant fallback calcClipBounds.');
            var block = this.getBlock(data, blockId);
            if (!block) return null;
            var b = this.calcClipBounds(worldTCMediaStart, block.in, block.out, handles, worldTCMediaStop);
            var blockInSec = this.tcToSeconds(block.in);
            return {
                mp4ExpandedInPoint: b.mp4ExpandedInPoint,
                mp4ExpandedOutPoint: b.mp4ExpandedOutPoint,
                mp4Duration: b.mp4Duration,
                ref: { worldSecMediaStart: worldSecMediaStart, mp4ExpandedInPoint: b.mp4ExpandedInPoint, tlClipStartSec: null, offsetSec: null, blockInSec: blockInSec }
            };
        }

        var lastVid = videoItems[videoItems.length - 1];
        var firstVideoOnAir = this.tcToSeconds(videoItems[0].horaEntradaOnAir);
        var lastVideoOnAirEnd = this.tcToSeconds(lastVid.horaEntradaOnAir) +
                                this.parseDurada(lastVid.duradaOnAir || lastVid.durada);

        var neighbours = this.getNeighbourOnAirTimes(data, blockId);
        var prevEnd = neighbours.prevEnd;
        var nextStart = neighbours.nextStart;
        var nonVideo = this.hasNonVideoItemsBefore(data, blockId);
        var hasNonVideoBefore = nonVideo.before;
        var hasNonVideoAfter = nonVideo.after;

        var blockOnAirStart;
        if (hasNonVideoBefore && prevEnd != null) {
            blockOnAirStart = prevEnd;
            log('\uD83D\uDCD0 [ER:Bounds] Bloc ' + blockId + ': items no-video al principi -> blockOnAirStart = prevEnd (' + prevEnd.toFixed(2) + 's)');
        } else {
            blockOnAirStart = firstVideoOnAir;
        }

        var blockOnAirEnd;
        if (hasNonVideoAfter && nextStart != null) {
            blockOnAirEnd = nextStart;
            log('\uD83D\uDCD0 [ER:Bounds] Bloc ' + blockId + ': items no-video al final -> blockOnAirEnd = nextStart (' + nextStart.toFixed(2) + 's)');
        } else {
            blockOnAirEnd = lastVideoOnAirEnd;
        }

        var mp4ExpandedInPoint  = Math.max(0, (blockOnAirStart - worldSecMediaStart) - handles);
        var mp4ExpandedOutPoint = (blockOnAirEnd - worldSecMediaStart) + handles;

        // FIX (2026-09-16): el tall de sortida deixava NOMÉS 0,04 s després de l'inici
        // del següent ítem (IPD) → el clip no el cobria i no es podia estirar. Ara es
        // conserva `clipOutMarginSec` (30 s per defecte) dins del següent ítem.
        var outMarginSec = (typeof this._getOutMarginSec === 'function') ? this._getOutMarginSec() : 30;
        var hardIn  = prevEnd   != null ? (prevEnd   - worldSecMediaStart) - 0.04 : null;
        var hardOut = nextStart != null ? (nextStart - worldSecMediaStart) + outMarginSec : null;
        if (hardIn  != null && mp4ExpandedInPoint  < hardIn)  mp4ExpandedInPoint  = hardIn;
        if (hardOut != null && mp4ExpandedOutPoint > hardOut) {
            log('\u2702\uFE0F [ER:Bounds] Bloc ' + blockId + ': sortida limitada a l\'inici del següent ítem + ' +
                outMarginSec.toFixed(1) + 's (' + hardOut.toFixed(2) + 's)');
            mp4ExpandedOutPoint = hardOut;
        }

        if (worldTCMediaStop) {
            var worldSecMediaStop  = this.tcToSeconds(worldTCMediaStop);
            var maxDur  = worldSecMediaStop - worldSecMediaStart;
            if (mp4ExpandedOutPoint > maxDur) mp4ExpandedOutPoint = maxDur;
        }

        var mp4Duration = mp4ExpandedOutPoint - mp4ExpandedInPoint;

        var blockInSec = null;
        var clips = data && data.cleanFeed && data.cleanFeed.clips ? data.cleanFeed.clips : [];
        for (var ci = 0; ci < clips.length; ci++) {
            if (clips[ci].id === blockId && clips[ci].in) {
                blockInSec = this.tcToSeconds(clips[ci].in);
                break;
            }
        }

        var ref = {
            worldSecMediaStart: worldSecMediaStart,
            mp4ExpandedInPoint: mp4ExpandedInPoint,
            tlClipStartSec:  null,
            offsetSec:     null,
            blockInSec: blockInSec
        };

        log('\uD83D\uDCD0 [ER:Bounds] ' + blockId + ': mp4ExpandedInPoint=' + mp4ExpandedInPoint.toFixed(2) + 's, mp4ExpandedOutPoint=' + mp4ExpandedOutPoint.toFixed(2) + 's, dur=' + mp4Duration.toFixed(2) + 's');
        return { mp4ExpandedInPoint: mp4ExpandedInPoint, mp4ExpandedOutPoint: mp4ExpandedOutPoint, mp4Duration: mp4Duration, ref: ref };
    };

    // ----------------------------------------------------------------
    // 5. CARETES ENTRE BLOCS
    // ----------------------------------------------------------------

    /**
     * _findCaretasBetween: Busca items amb títol de careta entre dos índexs
     * dins de allLines i retorna la suma de les seves duracions reals.
     */
    ER._findCaretasBetween = function (allLines, fromIdx, toIdx, data) {
        var totalDur = 0;
        var names = [];

        // Cas: índexs invertits (video previ apareix després en l'array)
        if (toIdx < fromIdx) {
            var fromItem = allLines[fromIdx];
            var toItem = allLines[toIdx];
            if (!fromItem || !toItem) return { totalDur: 0, names: [] };

            var fromEndSec = this.tcToSeconds(fromItem.horaEntradaOnAir) +
                this.parseDurada(fromItem.duradaOnAir || fromItem.durada);
            var toStartSec = this.tcToSeconds(toItem.horaEntradaPrevista);

            for (var i = 0; i < allLines.length; i++) {
                var item = allLines[i];
                if (!item || !item.titol) continue;
                if (item.flotant === true) continue;
                var title = item.titol.trim().toUpperCase();
                if (title.indexOf('CARETA') !== -1) {
                    var itemStart = this.tcToSeconds(item.horaEntradaPrevista);
                    if (itemStart >= fromEndSec && itemStart < toStartSec) {
                        var dur = data
                            ? this._getCorrectedDuration(item, data)
                            : this.parseDurada(item.duradaOnAir || item.durada);
                        totalDur += dur;
                        names.push(item.titol);
                    }
                }
            }
            return { totalDur: totalDur, names: names };
        }

        // Cas normal: búsqueda per rang d'índexs
        for (var j = fromIdx + 1; j < toIdx; j++) {
            var item2 = allLines[j];
            if (!item2 || !item2.titol) continue;
            if (item2.flotant === true) continue;
            var title2 = item2.titol.trim().toUpperCase();
            if (title2.indexOf('CARETA') !== -1) {
                var dur2 = data
                    ? this._getCorrectedDuration(item2, data)
                    : this.parseDurada(item2.duradaOnAir || item2.durada);
                totalDur += dur2;
                names.push(item2.titol);
            }
        }
        return { totalDur: totalDur, names: names };
    };

    // ----------------------------------------------------------------
    // 5.b SANEJAT D'OnAir "MENTIDERS" (2026-09-17)
    // ----------------------------------------------------------------

    /**
     * _sanitizeOnAirLies: Neutralitza els OnAir "mentiders": el realitzador llança
     * ítems per provar i el seu timecode queda com OnAir, sovint ABANS del programa.
     * Cas TNC 17/09: "08 P2-1/P2-2" amb OnAir 13:48:08/13:48:42 quan el programa
     * comença a 13:50 → el bloc s'inflava 8 min (clip de 13 min en lloc de 3).
     *
     * Regles:
     *  1) Coherència temporal: en ordre d'escaleta, si l'hora RETROCEDEIX > 60 s
     *     respecte a l'última hora fiable → l'OnAir és mentider.
     *  2) Hora de programa: OnAir anterior a (inici de programa − 90 s) → mentider.
     *  3) Encadenat: OnAir anterior al "high water" de l'última hora fiable → mentider.
     * L'OnAir original es conserva a `_onAirRaw` (diagnòstic); l'efectiu s'anul·la, de
     * manera que la resta del sistema (tiers, deduccions, marcadors) el tracta com un
     * ítem sense OnAir.
     * @returns {number} quants ítems s'han neutralitzat
     */
    ER._sanitizeOnAirLies = function (data, config) {
        var n = 0;
        try {
            var all = (data && data.escaleta && data.escaleta.liniesEscaleta) ? data.escaleta.liniesEscaleta : null;
            if (!all || all.length === 0) return 0;
            if (data._onAirSanitized) return 0;         // idempotent
            data._onAirSanitized = true;

            var progKey = (typeof this._detectProgramKey === 'function') ? this._detectProgramKey(data) : null;
            var startH = null;
            try {
                var cfg = window.FASTPASS_UI.Config && window.FASTPASS_UI.Config.get();
                if (cfg && cfg.programStartHours && progKey) startH = Number(cfg.programStartHours[progKey]);
            } catch (eC) { startH = null; }
            var programStartSec = (progKey && startH != null && isFinite(startH)) ? Math.round(startH * 3600) : null;
            var minOnAirSec = (programStartSec != null) ? programStartSec - 90 : null;
            if (minOnAirSec != null) {
                log('🕵️ [ER:Bounds] Sanejant OnAir: inici de programa ' + progKey + '=' + this.secondsToTC(programStartSec) +
                    ' · llindar ' + this.secondsToTC(minOnAirSec));
            }

            var prevFiableSec = null;
            var highWater = null;
            for (var i = 0; i < all.length; i++) {
                var it = all[i];
                if (!it || it.flotant === true) continue;
                var oaStr = it.horaEntradaOnAir;
                var hasOnAir = !!(oaStr && oaStr !== '00:00:00' && String(oaStr).trim() !== '');
                var sec = this.tcToSeconds(hasOnAir ? oaStr : it.horaEntradaPrevista);
                if (sec == null) continue;

                var mentider = false, motiu = '';
                if (hasOnAir) {
                    if (minOnAirSec != null && sec < minOnAirSec) {
                        mentider = true; motiu = 'anterior a l\'inici de programa';
                    } else if (prevFiableSec != null && sec < prevFiableSec - 60) {
                        mentider = true; motiu = 'retrocés de ' + Math.round(prevFiableSec - sec) + 's';
                    } else if (highWater != null && sec < highWater) {
                        mentider = true; motiu = 'encadenat a un OnAir mentider';
                    }
                }

                if (mentider) {
                    it._onAirRaw = oaStr;
                    it.horaEntradaOnAir = null;
                    n++;
                    log('🕵️ [ER:Bounds] OnAir MENTIDER neutralitzat: "' + (it.num || '?') + '" @ ' + oaStr +
                        ' (' + motiu + ', seq ' + (it.sequencia != null ? it.sequencia : i) + ')');
                } else if (hasOnAir) {
                    prevFiableSec = sec;
                    highWater = (highWater === null || sec > highWater) ? sec : highWater;
                }

                // (2026-09-17d) La PREVISTA és mentidera SEMPRE que l'OnAir ho era: el
                // realitzador llança l'ítem de prova i l'escaleta fixa la mateixa hora
                // a les dues (cas TNC "08 P2-1": OnAir i Prevista = 13:48:08). El
                // BUG #21 de _deduceOnAirEntrada fa servir la Prevista quan és anterior
                // al resultat deduït → per això cal anul·lar-la també.
                var pvStr = it.horaEntradaPrevista;
                var pvSec = (pvStr && pvStr !== '00:00:00' && String(pvStr).trim() !== '')
                    ? this.tcToSeconds(pvStr) : null;
                if (pvSec != null) {
                    var pvMentider = false, pvMotiu = '';
                    if (minOnAirSec != null && pvSec < minOnAirSec) {
                        pvMentider = true; pvMotiu = 'anterior a l\'inici de programa';
                    } else if (prevFiableSec != null && pvSec < prevFiableSec - 60) {
                        pvMentider = true; pvMotiu = 'retrocés de ' + Math.round(prevFiableSec - pvSec) + 's';
                    } else if (highWater != null && pvSec < highWater) {
                        pvMentider = true; pvMotiu = 'encadenat a una hora mentidera';
                    }
                    if (pvMentider) {
                        it._prevRaw = it.horaEntradaPrevista;
                        it.horaEntradaPrevista = null;
                        n++;
                        log('🕵️ [ER:Bounds] PREVISTA MENTIDERA neutralitzada: "' + (it.num || '?') + '" @ ' +
                            it._prevRaw + ' (' + pvMotiu + ', seq ' + (it.sequencia != null ? it.sequencia : i) + ')');
                    } else if (!hasOnAir || mentider) {
                        // Les previsions fiables també són referència (si no, en un
                        // programa amb els primers OnAir tardans no es detectaria res).
                        prevFiableSec = pvSec;
                        highWater = (highWater === null || pvSec > highWater) ? pvSec : highWater;
                    }
                }
            }
            if (n > 0) log('🕵️ [ER:Bounds] ' + n + ' OnAir mentider(s) neutralitzat(s) → es deduiran com a sense OnAir');
        } catch (e) {
            log('⚠️ [ER:Bounds] Error sanejat OnAir: ' + e.message, 'WARN');
        }
        return n;
    };

    /**
     * _applyBaseColumnFloor: PISO de l'inici del bloc quan el sanejat ha tocat el
     * bloc (hores mentideres anul·lades). El bloc (capa V1/V2) es queda sense
     * referència pròpia i la deducció pot retrocedir massa (fins a un faro llunyà).
     * La columna BASE de l'escaleta (agrupacio null) marca on és realment el tema:
     * l'últim ítem base ABANS del bloc (per ordre d'escaleta) acaba just on comença
     * el tema; el "forat" fins al primer ítem fiable del bloc és l'espai que ocupa.
     *
     * Cas TNC 17/09: base ... S6(13:56:22) · ''(13:56:36) · 08 P2(13:56:46) [forat 47s]
     * 08 P2-1/2/i (V1, hores mentideres) · reel 10 (V1, 13:57:59) → PISO = 13:56:46.
     */
    ER._applyBaseColumnFloor = function (data, worldBlockStartSec, blockLines, maxGapSec) {
        try {
            if (worldBlockStartSec == null || !blockLines || blockLines.length === 0) return worldBlockStartSec;

            // Només quan el sanejat ha tocat aquest bloc (evita regressions).
            var sanejat = false;
            for (var s = 0; s < blockLines.length; s++) {
                if (blockLines[s] && (blockLines[s]._onAirRaw || blockLines[s]._prevRaw)) { sanejat = true; break; }
            }
            if (!sanejat) return worldBlockStartSec;

            var all = (data && data.escaleta && data.escaleta.liniesEscaleta) ? data.escaleta.liniesEscaleta : [];
            if (!all.length) return worldBlockStartSec;
            var gapMax = (maxGapSec != null) ? maxGapSec : 180;

            // ⚠️ tcToSeconds(null) === 0 → cal comprovar el string abans de convertir
            var self = this;
            var tcOf = function (it2) {
                var h = it2.horaEntradaOnAir;
                if (h && h !== '00:00:00' && String(h).trim() !== '') return self.tcToSeconds(h);
                h = it2.horaEntradaPrevista;
                if (h && h !== '00:00:00' && String(h).trim() !== '') return self.tcToSeconds(h);
                return null;
            };

            // Primer ítem del bloc en ORDRE D'ESCALETA (l'ordre és la font de veritat)
            var firstIdx = -1;
            for (var i = 0; i < all.length; i++) {
                if (blockLines.indexOf(all[i]) !== -1) { firstIdx = i; break; }
            }
            if (firstIdx <= 0) return worldBlockStartSec;

            // Hora fiable més primerenca del bloc (per mesurar el forat)
            var firstReliable = null;
            for (var b = 0; b < blockLines.length; b++) {
                var sec = tcOf(blockLines[b]);
                if (sec != null && (firstReliable === null || sec < firstReliable)) firstReliable = sec;
            }
            if (firstReliable === null) return worldBlockStartSec;

            // Últim ítem de la columna BASE (agrupacio buida) ABANS del bloc, cap enrere
            var floorSec = null;
            var tries = 0;
            for (var k = firstIdx - 1; k >= 0 && tries < 6; k--, tries++) {
                var it = all[k];
                if (!it || it.flotant === true) continue;
                if (it.agrupacio && it.agrupacio.toString().trim() !== '') continue;
                var st = tcOf(it);
                if (st == null) continue;
                floorSec = st + this.getItemDuradaSec(it);
                break;
            }
            if (floorSec === null) return worldBlockStartSec;

            var gap = firstReliable - floorSec;
            if (gap < 0 || gap > gapMax) return worldBlockStartSec;

            if (floorSec > worldBlockStartSec) {
                log('🔒 [ER:Bounds] PISO columna base: IN ' + this.secondsToTC(worldBlockStartSec) + ' → ' +
                    this.secondsToTC(floorSec) + ' (el forat de la base és el tema, salt ' + Math.round(gap) + 's)');
                return floorSec;
            }
            return worldBlockStartSec;
        } catch (e) {
            log('⚠️ [ER:Bounds] Error PISO columna base: ' + e.message, 'WARN');
            return worldBlockStartSec;
        }
    };

    /**
     * _applyForeignVideoFloor: PISO de l'inici del bloc quan un VÍDEO ALIÈ encara
     * s'està emetent en el moment calculat d'inici. El clip no pot arrencar a mitges
     * d'un vídeo que no és del bloc: l'IN s'endarrereix fins al seu acabament (mínim
     * exigible; si l'ítem següent torna a solapar, s'itera).
     *
     * Només mira ítems de vídeo SENSE OnAir (BV/BVI d'una altra agrupació o sense
     * agrupació): els que SÍ tenen OnAir ja els cobreix l'IN·FLOOR de
     * calcPrecisionTrimBounds. L'hora d'entrada és la PREVISTA (no hi ha dada real
     * d'emissió) i el final = prevista + getItemDuradaSec (duradaOnAir si n'hi ha).
     *
     * Cas TNM V1 2026-09-28 (post-#104): el bloc V1 deduïa IN=14:32:16 (prevista del
     * donapas "03dp"), però el BV "01" (CRONOLOGIA DE L'ACAMPADA, 0:33, sense OnAir)
     * s'emetia 14:32:09→14:32:42 → el clip arrencava amb 26 s d'un tema aliè.
     */
    ER._applyForeignVideoFloor = function (data, worldBlockStartSec, blockLines, maxGapSec, refSecFallback) {
        try {
            if (worldBlockStartSec == null || !blockLines || blockLines.length === 0) return worldBlockStartSec;
            var all = (data && data.escaleta && data.escaleta.liniesEscaleta) ? data.escaleta.liniesEscaleta : [];
            if (!all.length) return worldBlockStartSec;
            var gapMax = (maxGapSec != null) ? maxGapSec : 600;

            // Ítems del bloc → no són "aliens" (el seu inici el defineix el propi bloc).
            var inBlock = {};
            for (var bi = 0; bi < blockLines.length; bi++) {
                var kbi = all.indexOf(blockLines[bi]);
                if (kbi >= 0) inBlock[kbi] = true;
            }

            // Referència: hora del PRIMER ítem del bloc (OnAir real; si no, prevista).
            var refSec = null;
            var fb0 = blockLines[0];
            if (fb0) {
                var hoa = fb0.horaEntradaOnAir;
                var hpv0 = fb0.horaEntradaPrevista;
                if (hoa && String(hoa).trim() !== '' && String(hoa) !== '00:00:00') refSec = this.tcToSeconds(hoa);
                else if (hpv0 && String(hpv0).trim() !== '' && String(hpv0) !== '00:00:00') refSec = this.tcToSeconds(hpv0);
            }
            // (2026-10-02 · #135) Mateix cas que a l'IN·FLOOR: si el bloc no té hores
            // pròpies (intro sense OnAir i prevista anul·lada), la referència per decidir
            // què és «posterior al bloc» és el IN deduït pels tiers.
            if (refSec === null && refSecFallback != null && isFinite(refSecFallback) && refSecFallback > 0) {
                refSec = refSecFallback;
            }

            var newStart = worldBlockStartSec;
            var guard = 0;
            while (guard++ < 20) {
                var floorSec = null, floorNum = '';
                for (var i = 0; i < all.length; i++) {
                    var it = all[i];
                    if (!it || it.flotant === true) continue;
                    if (inBlock[i] === true) continue;                       // ítem del bloc actual
                    if (it.teVideo !== true) continue;                       // només vídeo real
                    var oa = it.horaEntradaOnAir;
                    if (oa && String(oa).trim() !== '' && String(oa) !== '00:00:00') continue;  // amb OnAir → ja el cobreix IN·FLOOR
                    var hpv = it.horaEntradaPrevista;
                    if (!hpv || String(hpv).trim() === '' || String(hpv) === '00:00:00') continue;
                    var st = this.tcToSeconds(hpv);
                    if (st == null || !isFinite(st) || st <= 0) continue;
                    if (refSec !== null && isFinite(refSec) && st > refSec + 15) continue;      // posterior al bloc
                    var endSec = st + this.getItemDuradaSec(it);
                    if (!(endSec > newStart + 1.0)) continue;                // ja acaba abans de l'IN → no solapa
                    if (endSec - newStart > gapMax) continue;                // massa lluny → soroll
                    if (floorSec === null || endSec < floorSec) { floorSec = endSec; floorNum = String(it.num || '?'); }
                }
                if (floorSec === null || floorSec <= newStart + 0.5) break;
                log('🚧 [ER:Bounds] PISO vídeo aliè: el vídeo "' + floorNum + '" encara s\'emetia al ' + this.secondsToTC(newStart) +
                    ' → IN ' + this.secondsToTC(newStart) + ' → ' + this.secondsToTC(floorSec) + ' (no es talla a mitges)');
                newStart = floorSec;
            }
            return newStart;
        } catch (e) {
            log('⚠️ [ER:Bounds] Error PISO vídeo aliè: ' + e.message, 'WARN');
            return worldBlockStartSec;
        }
    };

    // ----------------------------------------------------------------
    // 6. PRECISION TRIM BOUNDS (Sistema 2+1 tiers)
    // ----------------------------------------------------------------

    /**
     * calcPrecisionTrimBounds: Sistema de 2+1 passos per calcular els bounds
     * de trim del MP4 usant els TCs reals dels items emesos.
     *
     * IN: Tier 0 (OnAir anterior + caretes) -> Tier 1 (primer estructural) -> Fallback (block.in)
     * OUT: Tier 1 (max sortida de tots els blockLines) -> Tier 2 (següent OnAir) -> Fallback (block.out)
     */
    ER.calcPrecisionTrimBounds = function (data, blockId, mediaStart, mediaStop, config) {
        // (2026-09-17) Sanejar OnAir mentiders ABANS de res: així els tiers, les
        // deduccions i els marcadors deixen de contaminar-se amb ítems de prova.
        try { this._sanitizeOnAirLies(data, config); } catch (eSan) { }
        var blockLines = this.getLinesForBlock(data, blockId);
        var allLines = data.escaleta && data.escaleta.liniesEscaleta ? data.escaleta.liniesEscaleta : [];
        var handles = config && config.handles != null ? config.handles : 60;
        var inHandlesSec  = handles;
        var outHandlesSec = handles;

        var worldSecMediaStart = this.tcToSeconds(mediaStart);
        var worldSecMediaStop  = this.tcToSeconds(mediaStop);

        if (!blockLines || blockLines.length === 0) {
            log('No es pot determinar el bloc ' + blockId + ': sense linies d\'escaleta', 'ERROR');
            return null;
        }

        var blockStartIdx = allLines.indexOf(blockLines[0]);
        var blockEndIdx   = allLines.indexOf(blockLines[blockLines.length - 1]);

        // ================================================================
        // IN: worldBlockStartSec
        // ================================================================
        var worldBlockStartSec = null;
        var InTier = 0;
        var worldBlockAnchorSec = null;

        // -- Tier 0 (IN): Video previ amb OnAir + caretes intermèdies --
        var allOnAirVideos = [];
        for (var i = 0; i < allLines.length; i++) {
            var l = allLines[i];
            if (l.flotant === true) continue;
            if (l.teVideo === true && l.horaEntradaOnAir) {
                var startSec = this.tcToSeconds(l.horaEntradaOnAir);
                var durSec = this.parseDurada(l.duradaOnAir || l.durada);
                allOnAirVideos.push({ item: l, idx: i, startSec: startSec, endSec: startSec + durSec });
            }
        }
        allOnAirVideos.sort(function (a, b) { return a.startSec - b.startSec; });

        var firstBlockItem = blockLines[0];
        var blockRefSec = firstBlockItem && firstBlockItem.horaEntradaPrevista
            ? this.tcToSeconds(firstBlockItem.horaEntradaPrevista)
            : null;

        // BUG #16-B2: Obtenir l'agrupacio del bloc per filtrar Tier0-IN.
        // Si el bloc té agrupacio, només considerar videos del MATEIX agrupacio
        // com a prevVideoData. Així evitem que videos d'altres agrupacions
        // (per ex. sumaris amb agrupacio:null) contaminin el càlcul.
        var blockAgrupacio_IN = blockLines.length > 0 ? blockLines[0].agrupacio : null;

        var prevVideoData = null;
        if (blockRefSec !== null) {
            for (var vi = 0; vi < allOnAirVideos.length; vi++) {
                var vid = allOnAirVideos[vi];
                // BUG #16-B2: Filtrar per agrupacio
                if (blockAgrupacio_IN && vid.item.agrupacio !== blockAgrupacio_IN) continue;
                if (vid.endSec < blockRefSec) {
                    if (!prevVideoData || vid.endSec > prevVideoData.endSec) {
                        prevVideoData = vid;
                    }
                }
            }
        }

        if (prevVideoData) {
            var gap = blockRefSec - prevVideoData.endSec;
            var hasNonVideoIntro = this.hasNonVideoItemsBefore(data, blockId).before;
            var maxGap = hasNonVideoIntro ? 120 : 15;

            if (gap <= maxGap) {
                worldBlockStartSec = prevVideoData.endSec;
                InTier = 10;
                log('   \u2705 Tier0-IN: item anterior "' + prevVideoData.item.num + '" (agrupacio:' + (prevVideoData.item.agrupacio || 'null') + ') acaba a ' + worldBlockStartSec.toFixed(2) + 's');

                var caretas = this._findCaretasBetween(allLines, prevVideoData.idx, blockStartIdx, data);
                if (caretas.totalDur > 0) {
                    worldBlockStartSec += caretas.totalDur;
                    log('   \uD83D\uDCFA Tier0-IN: +' + caretas.totalDur + 's per caretes (' + caretas.names.join(', ') + ') -> ' + worldBlockStartSec.toFixed(2) + 's');
                }
            } else {
                log('   \u23ED\uFE0F Tier0-IN: gap=' + gap.toFixed(0) + 's > maxGap=' + maxGap + 's. Usant Tier1.');
            }
        } else if (blockAgrupacio_IN) {
            // Tier0-IN cross-agrupacio: No hi ha video previ al mateix agrupacio.
            // Intentar deduir l'IN usant OnAir d'items anteriors (qualsevol agrupacio)
            // via _deduceOnAirEntrada amb ignoreAgrupacio=true.
            var crossDeducedIn = this._deduceOnAirEntrada(firstBlockItem, allLines, data, true);
            if (crossDeducedIn !== null) {
                worldBlockStartSec = crossDeducedIn;
                InTier = 10;
                log('   \uD83D\uDD17 Tier0-IN (cross-agrupacio): OnAir deduit des d\'item anterior (qualsevol agrupacio) -> ' + worldBlockStartSec.toFixed(2) + 's');
            } else {
                log('   \u2139\uFE0F Tier0-IN: Sense video previ amb agrupacio="' + blockAgrupacio_IN + '" ni OnAir anterior deduible. Es delega a Tier1.');
            }
        }

        // -- Tier 1 (IN): Primer item estructural del bloc --
        // BUG #16: Sempre calcular Tier1-IN per competir amb Tier0-IN.
        // El IN ha de ser el punt més aviat fiable → guanya el mínim.
        var structuralItemsInBlock = [];
        for (var si = 0; si < blockLines.length; si++) {
            if (!this.isItemEstructural(blockLines[si])) continue;
            // (2026-09-25) Un ítem amb durada 0:00 NO aporta temps al bloc → la seva hora no
            // pot definir l'IN. TNC V2 2026-09-25: "04 P2-2" (durada 0:00, hora basura 14:00:xx)
            // guanyava el candidat i arrossegava el bloc 103 s enrere, mentre la INTRO "04i"
            // (durada 0:20, hora prevista 14:02:31 ✓ = final del tema anterior 14:01:02+1:29 ✓)
            // quedava descartada.
            var _durItem = this.parseDurada(blockLines[si].durada || blockLines[si].duradaOnAir);
            var _teHora = (blockLines[si].horaEntradaOnAir && String(blockLines[si].horaEntradaOnAir).trim() !== '' && String(blockLines[si].horaEntradaOnAir) !== '00:00:00') ||
                          (blockLines[si].horaEntradaPrevista && String(blockLines[si].horaEntradaPrevista).trim() !== '');
            if (_durItem > 0.5 || !_teHora) {
                structuralItemsInBlock.push(blockLines[si]);
            } else {
                log('   \u2139\uFE0F Tier1-IN: s\'omet "' + blockLines[si].num + '" (durada ' + (_durItem || 0).toFixed(2) + 's, sense hora real) → no pot definir l\'inici del bloc');
            }
        }

        var tier1InCandidate = null;
        var tier1InLabel = '';

        if (structuralItemsInBlock.length > 0) {
            var firstItem = structuralItemsInBlock[0];
            // ═══ (2026-09-25) REGLA D'USUARI: el IN del bloc surt de l'OnAir del PRIMER ÍTEM
            // EMÈS (dada REAL d'emissió), no del primer estructural si aquest no té hora.
            // TNC V2 2026-09-25: el primer estructural era "04 P2-2" (intro, SENSE OnAir) → el
            // candidat sortia de la prevista/deducció = 14:00:48 i el clip s'extreia amb ~103s
            // del tema anterior a la capçalera (error primigeni). El primer EMÈS era "04"
            // (14:02:53) → IN real = 14:02:53 − handle.
            // (2026-09-25) REVERTIT: el candidat Tier1 torna a ser el PRIMER ÍTEM ESTRUCTURAL,
            // incloent-hi la INTRO (és part del bloc: el seu inici ha de quedar dins del clip i
            // coincidir amb el corchete). El que calia no era saltar-se la intro, sinó que el seu
            // inici no vingués d'una PREVISTA errònia → això ho garanteix el PISO del final de
            // l'ítem anterior (IN·FLOOR, amb el seu OnAir + duradaOnAir, mecanisme ja existent).
            var emittedItem = null;
            if (tier1InCandidate === null) {
                // Fallback (comportament històric): primer estructural → si no té hora, el darrer.
                tier1InCandidate = this.getItemEntradaSec(firstItem, allLines, data);
                if (tier1InCandidate !== null) {
                    tier1InLabel = 'primer estructural "' + firstItem.num + '" entrada';
                } else {
                    var lastResort = structuralItemsInBlock[structuralItemsInBlock.length - 1];
                    tier1InCandidate = this.getItemEntradaSec(lastResort, allLines, data);
                    if (tier1InCandidate !== null) {
                        tier1InLabel = 'last-resort "' + lastResort.num + '" entrada';
                    }
                }
            }
        }

        // COMPETÈNCIA Tier0 ↔ Tier1: guanya el mínim (IN més aviat)
        // (2026-09-25) EXCEPCIÓ CLAU: si el candidat Tier1 ve d'un OnAir REAL d'emissió
        // (`emittedItem`), MANA SEMPRE, encara que sigui MÉS TARD que Tier0. El criteri
        // "guanya el més aviat" premiava precisament les previstes/deduccions errònies:
        // TNC V2 2026-09-25 → prevista 14:00:48 vs OnAir real de "04" 14:02:53 = 103s de
        // tema anterior a la capçalera del clip (error primigeni).
        if (InTier === 0 && tier1InCandidate !== null) {
            // Sense Tier0 → Tier1 guanya per defecte
            worldBlockStartSec = tier1InCandidate;
            InTier = 1;
            worldBlockAnchorSec = tier1InCandidate;
            log('   \u2705 Tier1-IN: ' + tier1InLabel + ' -> ' + worldBlockStartSec.toFixed(2) + 's');
        } else if (tier1InCandidate !== null && worldBlockStartSec !== null) {
            if (tier1InCandidate !== null && worldBlockStartSec !== null && tier1InCandidate < worldBlockStartSec) {
                log('   \uD83D\uDFE1 Tier1-COMPETE: ' + tier1InLabel + '=' + tier1InCandidate.toFixed(2) + 's < Tier0-IN=' + worldBlockStartSec.toFixed(2) + 's. Guanya Tier1 (més aviat).');
                worldBlockStartSec = tier1InCandidate;
                InTier = 1;
                worldBlockAnchorSec = tier1InCandidate;
            } else {
                // BUG #16-B3 (2026-06-29): Tier1-ONAIR-PREVAL ELIMINAT.
                // Quan Tier1 >= Tier0, l'OnAir del primer estructural és MÉS TARD
                // que el Tier0 (cross-agrupacio o mateix agrupacio). Mantenir Tier0
                // perquè és més aviat i inclou la intro del bloc (ex: TNM V3 28/06).
                log('   \u2139\uFE0F Tier1-NOCOMPETE: ' + tier1InLabel + '=' + tier1InCandidate.toFixed(2) + 's \u2265 Tier0-IN=' + worldBlockStartSec.toFixed(2) + 's. Es manté Tier0.');
            }
        }

        // -- Fallback (IN): block.in --
        if (InTier === 0) {
            var blockIn = this.getBlock(data, blockId);
            if (blockIn && blockIn.in) {
                worldBlockStartSec = this.tcToSeconds(blockIn.in);
                InTier = -1;
                log('   \u26A0\uFE0F Fallback-IN: usant block.in="' + blockIn.in + '" -> ' + worldBlockStartSec.toFixed(2) + 's');
            } else {
                log('No es pot determinar l\'inici del bloc ' + blockId, 'ERROR');
                return null;
            }
        }

        // (2026-10-02 · #135) IN deduït pels TIERS: dada REAL del playout (OnAir +
        // duradaOnAir de l'ítem anterior). Els PISO només el poden ENDARRERIR; aquest
        // valor es conserva per a dues coses: (a) fer de referència quan el bloc no té
        // hores pròpies (intro sense OnAir I prevista anul·lada pel sanejador →
        // _refFloorSec = null i el sostre «posterior al bloc» quedava desactivat), i
        // (b) recuperar-lo si els PISO deixen un IN invàlid (IN >= OUT).
        var _tierInSec = worldBlockStartSec;

        // ═══ (2026-09-25) PISO DEL FINAL DE L'ÍTEM ANTERIOR (mecanisme duradaOnAir) ═══════════
        // L'inici del bloc NO pot ser ANTERIOR a l'acabament de l'ítem emès anterior
        // (horaEntradaOnAir + duradaOnAir, dada que ja existeix a l'escaleta). Abans, si la
        // prevista de la INTRO era vella, el bloc s'endarreria ~2 min i el clip s'extreia amb el
        // tema anterior a la capçalera (TNC V2 2026-09-25: prevista 14:00:48 vs final real del
        // tema previ 14:02:31 → 103 s). Aquest piso fa que la intro quedi DINS del clip i que el
        // corchete IN de la seqüència coincideixi amb el seu inici.
        try {
            var _prevEndSec = null, _prevEndNum = '';
            // (2026-09-25c) 🐞 FIX ARREL: el piso només pot mirar ítems FORA del bloc. Un ítem del
            // MATEIX bloc no és "l'ítem anterior": si s'inclou, el piso mou l'IN fins al SEU final
            // → bloc buit (IN >= OUT) → l'IN/OUT-GUARD el baixa a block.in − durada(intro) i el clip
            // s'extreu minuts enrere. Cas mesurat TNC V3 2026-09-25: ítem "05" (dins del bloc,
            // OnAir 14:00:02 + 1:50 = 50512) arrossegava l'IN de 50383 → 50512 → guard → 50303 ✗
            // (129 s de tema anterior a la capçalera del clip).
            var _blockIdxSet = {};
            for (var _bi = 0; _bi < blockLines.length; _bi++) {
                var _kbi = allLines.indexOf(blockLines[_bi]);
                if (_kbi >= 0) _blockIdxSet[_kbi] = true;
            }
            // (2026-09-25d) 🐞 SOSTRE DEL PISO: només poden comptar ítems que ACABIN ABANS que
            // comenci el bloc. Sense això un ítem POSTERIOR del mateix agrupacio (TNC V3 25/09:
            // "09" acaba a 50550, després de l'OUT 50512) actuava de "piso", l'IN pujava a 50550,
            // el bloc quedava invertit (IN>=OUT) i el guard el baixava a 50303 ✗ (80 s de tema
            // anterior a la capçalera). Referència = hora del PRIMER ítem del bloc (OnAir real;
            // si no, prevista) amb 15 s de tolerància per durades OnAir sobreestimades.
            var _refFloorSec = null;
            try {
                var _fb0 = blockLines[0];
                if (_fb0) {
                    var _oa0 = _fb0.horaEntradaOnAir;
                    var _pv0 = _fb0.horaEntradaPrevista;
                    if (_oa0 && String(_oa0).trim() !== '' && String(_oa0) !== '00:00:00') {
                        _refFloorSec = this.tcToSeconds(_oa0);
                    } else if (_pv0 && String(_pv0).trim() !== '' && String(_pv0) !== '00:00:00') {
                        _refFloorSec = this.tcToSeconds(_pv0);
                    }
                }
            } catch (eRefFloor) { /* noop */ }
            // (2026-10-02 · #135) Si el bloc NO té hores pròpies, la referència és el IN
            // deduït pels tiers. Sense això el sostre «posterior al bloc» queda desactivat
            // i un ítem POSTERIOR (p. ex. el «37» del bloc següent, que acaba a 54724)
            // actua de piso: l'IN puja més enllà de l'OUT i el GUARD l'ha de rescatar.
            if (_refFloorSec === null && _tierInSec != null && isFinite(_tierInSec) && _tierInSec > 0) {
                _refFloorSec = _tierInSec;
                log('   \uD83D\uDD27 [IN\u00B7FLOOR] El bloc no té hores pròpies → referència = IN dels tiers (' + _tierInSec.toFixed(2) + 's)');
            }
            for (var pv = 0; pv < allOnAirVideos.length; pv++) {
                var _pv = allOnAirVideos[pv];
                if (!_pv || !_pv.item) continue;
                if (_blockIdxSet[_pv.idx] === true) continue;               // ítem del bloc actual → no és "anterior"
                var _pvEnd = Number(_pv.endSec);
                if (!isFinite(_pvEnd)) continue;
                if (_refFloorSec !== null && isFinite(_refFloorSec) && _pvEnd > _refFloorSec + 15) continue;  // posterior al bloc → no és "anterior"
                if (!isFinite(_pvEnd)) continue;
                if (_pvEnd <= worldBlockStartSec + 0.5) continue;          // només els que acaben DESPRÉS de l'inici calculat
                if (_prevEndSec === null || _pvEnd < _prevEndSec) { _prevEndSec = _pvEnd; _prevEndNum = String(_pv.item.num || ''); }
            }
            if (_prevEndSec !== null && _prevEndSec > worldBlockStartSec + 1.0 && (_prevEndSec - worldBlockStartSec) < 600) {
                log('   \u26A0\uFE0F [IN\u00B7FLOOR] Inici calculat ' + worldBlockStartSec.toFixed(2) + 's és ANTERIOR al final de l\'ítem anterior "' + _prevEndNum + '" (' + _prevEndSec.toFixed(2) + 's = OnAir + duradaOnAir) → s\'ajusta a ' + _prevEndSec.toFixed(2) + 's (la intro queda dins del bloc)');
                worldBlockStartSec = _prevEndSec;
                worldBlockAnchorSec = _prevEndSec;
            }
        } catch (eFloor) { /* noop */ }

        // (2026-09-17c) PISO de columna base: si el sanejat ha anul·lat hores del bloc,
        // l'inici pot quedar massa enrere. El forat de la columna base marca el tema.
        var _inPrePiso = worldBlockStartSec;
        worldBlockStartSec = this._applyBaseColumnFloor(data, worldBlockStartSec, blockLines, 180);
        if (_inPrePiso != null && worldBlockStartSec !== _inPrePiso) {
            // El piso mou l'inici real del bloc → l'àncora l'ha de seguir
            // (flow_markers.js la fa servir per situar els marcadors sobre el clip).
            worldBlockAnchorSec = worldBlockStartSec;
            log('🔒 [ER:Bounds] Àncora actualitzada al piso: ' + this.secondsToTC(worldBlockAnchorSec));
        }

        // (2026-09-28) PISO DE VÍDEO ALIÈ: el bloc no pot arrencar a mitges d'un vídeo que
        // no és seu (BV/BVI d'una altra agrupació, o sense agrupació, encara en emissió).
        // Cas TNM V1 28/09: IN deduït 14:32:16 queia DINS del BV "01" (14:32:09→14:32:42)
        // → el clip arrencava amb 26 s del tema anterior a la capçalera.
        var _inPreForeign = worldBlockStartSec;
        worldBlockStartSec = this._applyForeignVideoFloor(data, worldBlockStartSec, blockLines, 600, _tierInSec);
        if (_inPreForeign != null && worldBlockStartSec !== _inPreForeign) {
            // El piso mou l'inici real del bloc → l'àncora l'ha de seguir.
            worldBlockAnchorSec = worldBlockStartSec;
            log('🔒 [ER:Bounds] Àncora actualitzada al piso de vídeo aliè: ' + this.secondsToTC(worldBlockAnchorSec));
        }

        // (2026-09-21) REFERÈNCIA NETA: ELIMINADA. El càlcul per tiers + PISO ja era correcte
        // (item 18 OnAir 14:45:25 + 1:36 = 14:47:01, + MOLINET 1 corregit 7s→5s = 14:47:06), i
        // la Prevista de 19p7 (14:47:08) és el PLA SENSE CORREGIR (2s de més) → adoptar-la
        // desplaçava el bloc 2s tard. La referència de 19p7 no és una "veritat" millor.

        // ================================================================
        // OUT: worldBlockEndSec
        // ================================================================
        // -- Tier 1 OUT (max): sortida més avançada de TOTS els items del bloc --
        // Itera sobre tots els blockLines perquè un IPD amb duradaOnAir>0
        // pot córrer en paral·lel al darrer item estructural.
        var maxSortidaSec = -1;
        var maxSortidaItem = null;
        for (var oi = 0; oi < blockLines.length; oi++) {
            var item = blockLines[oi];
            if (!item.horaEntradaOnAir && !this.isItemEstructural(item)) continue;
            var s = this.getItemSortidaSec(item, allLines, data);
            if (s !== null && s > maxSortidaSec) {
                maxSortidaSec = s;
                maxSortidaItem = item;
            }
        }
        if (maxSortidaItem) {
            worldBlockEndSec = maxSortidaSec;
            OutTier = 1;
            var refEntrada = maxSortidaItem.horaEntradaOnAir || maxSortidaItem.horaEntradaPrevista || '??';
            var refDurada  = maxSortidaItem.duradaOnAir || maxSortidaItem.durada || '?';
            log('   \u2705 Tier1-OUT (max): "' + maxSortidaItem.num + '" sortida=' + refEntrada + '+' + refDurada + ' -> ' + worldBlockEndSec.toFixed(2) + 's');
        }

        // -- Tier 2: Següent OnAir disponible (fet dur del playout) --
        // BUG #11: Sempre computar Tier 2. Si el següent OnAir és posterior
        // al Tier 1, guanya perquè horaEntradaOnAir és un fet dur.
        var tier2Candidate = null;
        var tier2Label = '';

        // Estratègia A: Item següent amb video i OnAir a allLines.
        // BUG #13: si el bloc té agrupacio, només considerar items del MATEIX
        // agrupacio. null !== "v1", per tant els items sense agrupacio (totems)
        // també es filtren quan el bloc pertany a un agrupacio concret.
        var blockAgrupacio = blockLines.length > 0 ? blockLines[0].agrupacio : null;

        if (blockEndIdx >= 0 && blockEndIdx < allLines.length - 1) {
            for (var ai = blockEndIdx + 1; ai < allLines.length; ai++) {
                var next = allLines[ai];
                if (next.flotant === true) continue;
                // BUG #13 fix: null !== "v1", filtrar també els totems
                if (blockAgrupacio && next.agrupacio !== blockAgrupacio) continue;
                if (next.teVideo === true && next.horaEntradaOnAir) {
                    tier2Candidate = this.tcToSeconds(next.horaEntradaOnAir);
                    tier2Label = 'item següent "' + next.num + '" comença a ' + tier2Candidate.toFixed(2) + 's (OnAir=' + next.horaEntradaOnAir + ')';
                    break;
                }
            }
        }
        // Estratègia B: Primer video del bloc següent (per agrupacio).
        // BUG #13: només per blocs sense agrupacio (totems). Els blocs amb
        // agrupacio tenen fronteres internes definides per Tier 1 OUT.
        if (tier2Candidate === null && !blockAgrupacio) {
            var clips = data && data.cleanFeed && data.cleanFeed.clips ? data.cleanFeed.clips : [];
            var idx = -1;
            for (var ci2 = 0; ci2 < clips.length; ci2++) {
                if (clips[ci2].id === blockId) { idx = ci2; break; }
            }
            if (idx >= 0 && idx < clips.length - 1) {
                var nextBlockId = clips[idx + 1].id;
                var nextBlockLines = this.getLinesForBlock(data, nextBlockId);
                var nextVideos = [];
                for (var nvi = 0; nvi < nextBlockLines.length; nvi++) {
                    if (nextBlockLines[nvi].teVideo === true && nextBlockLines[nvi].horaEntradaOnAir) {
                        nextVideos.push(nextBlockLines[nvi]);
                    }
                }
                if (nextVideos.length > 0) {
                    tier2Candidate = this.tcToSeconds(nextVideos[0].horaEntradaOnAir);
                    tier2Label = 'primer video del bloc següent ' + nextBlockId + ' comença a ' + tier2Candidate.toFixed(2) + 's (OnAir=' + nextVideos[0].horaEntradaOnAir + ')';
                }
            }
        }

        // BUG #11: Competència — si Tier2 > Tier1, guanya Tier2
        if (tier2Candidate !== null && (OutTier === 0 || tier2Candidate > worldBlockEndSec)) {
            if (OutTier === 1 && tier2Candidate > worldBlockEndSec) {
                log('   \uD83D\uDFE1 Tier2-COMPETE: ' + tier2Label);
                log('   \uD83D\uDFE1   Següent OnAir (' + tier2Candidate.toFixed(2) + 's) > Tier1 duradaOnAir (' + worldBlockEndSec.toFixed(2) + 's). Guanya següent OnAir (fet dur del playout).');
            } else {
                log('   \u2705 Tier2-OUT: ' + tier2Label);
            }
            worldBlockEndSec = tier2Candidate;
            OutTier = 2;
        }

        // -- Fallback: Estratègia C (últim item) --
        if (OutTier === 0 && blockLines.length > 0) {
            var last = blockLines[blockLines.length - 1];
            if (last.horaSortidaPrevista && last.horaSortidaPrevista !== "00:00:00") {
                worldBlockEndSec = this.tcToSeconds(last.horaSortidaPrevista);
                OutTier = 2;
                log('   \u2705 Tier2-OUT: últim item sortida prevista="' + last.horaSortidaPrevista + '" -> ' + worldBlockEndSec.toFixed(2) + 's');
            } else if (last.horaEntradaPrevista && last.horaEntradaPrevista !== "00:00:00") {
                var lastStart = this.tcToSeconds(last.horaEntradaPrevista);
                var lastDur   = this.parseDurada(last.durada);
                worldBlockEndSec = lastStart + lastDur;
                OutTier = 2;
                log('   \u26A0\uFE0F Tier2-OUT: últim item sense sortida, entrada+durada="' + last.horaEntradaPrevista + '"+' + last.durada + ' -> ' + worldBlockEndSec.toFixed(2) + 's');
            }
        }

        // -- Fallback absolut: block.out --
        if (OutTier === 0) {
            var blockOut = this.getBlock(data, blockId);
            if (blockOut && blockOut.out) {
                worldBlockEndSec = this.tcToSeconds(blockOut.out);
                OutTier = -1;
                log('   \u26A0\uFE0F Fallback-OUT: usant block.out="' + blockOut.out + '" -> ' + worldBlockEndSec.toFixed(2) + 's');
            } else {
                log('   \u274C No es pot determinar el final del bloc ' + blockId, 'ERROR');
                return null;
            }
        }

        // ── Guard de IN/OUT invertit ──
        // Si el IN acaba sent >= OUT, vol dir que el primer item estructural
        // té una referència temporal invàlida (Prevista no fiable en molinets
        // reutilitzats o intros amb TC desplaçat).
        // En aquest cas, deduir IN = block.in - durada del primer item.
        // Així la intro es manté al principi del clip amb la seva durada real.
        if (worldBlockStartSec !== null && worldBlockEndSec !== null &&
            worldBlockStartSec >= worldBlockEndSec) {
            var originalIN = worldBlockStartSec;
            var blockInFallback = this.getBlock(data, blockId);
            // (2026-10-02 · #135) ABANS de caure a `block.in − durada(intro)` (que arrossega
            // els handles del cleanFeed i pot quedar 80 s ABANS del bloc), recuperar el IN
            // que els TIERS ja havien deduït del playout: és dada real i ja és < OUT.
            var _tierRecovered = false;
            if (_tierInSec != null && isFinite(_tierInSec) && _tierInSec > 0 && _tierInSec < worldBlockEndSec) {
                worldBlockStartSec = _tierInSec;
                worldBlockAnchorSec = _tierInSec;
                _tierRecovered = true;
                log('   \uD83D\uDD04 [IN/OUT-GUARD] IN dels PISO invàlid (' + originalIN.toFixed(1) + 's >= OUT ' + worldBlockEndSec.toFixed(1) + 's) → es RECUPERA el IN deduït pels tiers: ' + _tierInSec.toFixed(1) + 's.');
            }
            if (!_tierRecovered && blockInFallback && blockInFallback.in) {
                var blockInSec = this.tcToSeconds(blockInFallback.in);
                // Restar la durada del primer item estructural (la intro/molinet)
                // perquè quedi dins del clip, abans del block.in
                var firstItem = structuralItemsInBlock[0];
                var firstItemDur = this.getItemDuradaSec(firstItem);
                var correctedIN = blockInSec - firstItemDur;
                if (correctedIN < worldBlockEndSec) {
                    worldBlockStartSec = correctedIN;
                    worldBlockAnchorSec = correctedIN;
                    InTier = 2;
                    log('   \uD83D\uDD04 [IN/OUT-GUARD] IN original (' + originalIN.toFixed(1) + 's) >= OUT (' + worldBlockEndSec.toFixed(1) + 's). Prevista no fiable. IN = block.in(' + blockInFallback.in + ') - durada(' + (firstItem.num || '?') + ':' + firstItemDur.toFixed(1) + 's) = ' + correctedIN.toFixed(1) + 's.');
                }
            }
        }

        // ================================================================
        // CONVERSIÓ A BOUNDS RELATIUS AL MP4
        // ================================================================
        var mp4ExpandedInPoint  = Math.max(0, (worldBlockStartSec - worldSecMediaStart) - inHandlesSec);
        var mp4ExpandedOutPoint = (worldBlockEndSec - worldSecMediaStart) + outHandlesSec;

        // ── MARGEN DE SALIDA (2026-09-16) ─────────────────────────────────────
        // L'OUT calculat pot quedar-se ABANS de l'ítem següent (p. ex. Tier 1 = fi de
        // l'últim ítem emès), i llavors el clip no cobria l'IPD i no es podia estirar.
        // El clip ha d'arribar com a mínim `clipOutMarginSec` MÉS ENLLÀ de l'inici del
        // següent ítem amb OnAir (configurable; per defecte 30 s).
        var outMarginSec = (typeof this._getOutMarginSec === 'function') ? this._getOutMarginSec() : 30;
        try {
            var nxt = this.getNeighbourOnAirTimes(data, blockId);
            var nextOnAirSec = (nxt && nxt.nextStart != null) ? nxt.nextStart : null;
            // (2026-09-17) ABANS: minOut = inici del SEGUENT item + marge. Si el següent item
            // era d'un ALTRE bloc (cas TNC: final del bloc 13:59:25, següent 07/v2 a 14:04:26)
            // el clip s'estirava fins alla -> OUT 1196 s en lloc de 885 -> clip de 17 min.
            // ARA: el marge s'aplica SOBRE EL FINAL DEL BLOC (mp4ExpandedOutPoint ja l'inclou).
            if (outMarginSec > 0) {
                var minOut = mp4ExpandedOutPoint + outMarginSec;
                if (!nextOnAirSec) nextOnAirSec = worldSecMediaStart + mp4ExpandedOutPoint;  // nomes per al log
                if (mp4ExpandedOutPoint < minOut) {
                    log('   \u2702\uFE0F [OUT-MARGIN] Clip ampliat fins al següent ítem + ' + outMarginSec.toFixed(1) + 's: ' +
                        mp4ExpandedOutPoint.toFixed(2) + 's \u2192 ' + minOut.toFixed(2) + 's (següent OnAir=' + this.secondsToTC(nextOnAirSec) + ')');
                    mp4ExpandedOutPoint = minOut;
                }
            }
        } catch (eMar) {
            log('   \u26A0\uFE0F [OUT-MARGIN] No s\'ha pogut aplicar el marge de sortida: ' + eMar.message, 'WARN');
        }

        // No passar mai del final del MP4 cleanFeed
        if (worldSecMediaStop) {
            var maxOutSec = worldSecMediaStop - worldSecMediaStart;
            if (mp4ExpandedOutPoint > maxOutSec) {
                log('   \u2702\uFE0F [OUT-MARGIN] Limitat pel final del cleanFeed: ' + mp4ExpandedOutPoint.toFixed(2) + 's \u2192 ' + maxOutSec.toFixed(2) + 's');
                mp4ExpandedOutPoint = maxOutSec;
            }
        }

        // Límit per block.out
        var blockLim = this.getBlock(data, blockId);
        if (blockLim && blockLim.out && OutTier <= 0) {
            var worldSecBlockOut = this.tcToSeconds(blockLim.out);
            var blockMaxDur = worldSecBlockOut - worldSecMediaStart;
            if (mp4ExpandedOutPoint > blockMaxDur) {
                log('   \uD83D\uDCD0 Limitant mp4ExpandedOutPoint per block.out="' + blockLim.out + '" -> ' + blockMaxDur.toFixed(2) + 's (era ' + mp4ExpandedOutPoint.toFixed(2) + 's)');
                mp4ExpandedOutPoint = blockMaxDur;
            }
        }

        if (mp4ExpandedInPoint >= mp4ExpandedOutPoint) {
            log('   \u26A0\uFE0F mp4ExpandedInPoint (' + mp4ExpandedInPoint.toFixed(2) + 's) >= mp4ExpandedOutPoint (' + mp4ExpandedOutPoint.toFixed(2) + 's). Ajustant...');
            mp4ExpandedOutPoint = mp4ExpandedInPoint + 1.0;
        }

        var mp4Duration = mp4ExpandedOutPoint - mp4ExpandedInPoint;

        if (worldBlockAnchorSec === null) {
            if (worldBlockStartSec !== null) {
                worldBlockAnchorSec = worldBlockStartSec;
                log('   \uD83C\uDFAF [ANCHOR-FALLBACK] Usant worldBlockStartSec=' + worldBlockAnchorSec.toFixed(2) + 's com a àncora');
            }
        }

        var blockInSec = null;
        var clipsRef = data && data.cleanFeed && data.cleanFeed.clips ? data.cleanFeed.clips : [];
        for (var cri = 0; cri < clipsRef.length; cri++) {
            if (clipsRef[cri].id === blockId && clipsRef[cri].in) {
                blockInSec = this.tcToSeconds(clipsRef[cri].in);
                break;
            }
        }

        var ref = {
            worldSecMediaStart: worldSecMediaStart,
            mp4ExpandedInPoint: mp4ExpandedInPoint,
            worldBlockStartSec: worldBlockStartSec,
            worldBlockAnchorSec: worldBlockAnchorSec,
            worldBlockEndSec:   worldBlockEndSec,
            InTier:             InTier,
            OutTier:            OutTier,
            tlClipStartSec:     null,
            offsetSec:          null,
            blockInSec:         blockInSec
        };

        log('\uD83D\uDCD0 [ER:Bounds] ' + blockId + ': IN-tier=' + InTier + ' OUT-tier=' + OutTier + ' | mp4ExpandedInPoint=' + mp4ExpandedInPoint.toFixed(2) + 's mp4ExpandedOutPoint=' + mp4ExpandedOutPoint.toFixed(2) + 's dur=' + mp4Duration.toFixed(2) + 's (inHandlesSec=' + inHandlesSec + 's outHandlesSec=' + outHandlesSec + 's)');
        log('\uD83D\uDCD0 [ER:Bounds] TCs reals: start=' + this.secondsToTC(worldBlockStartSec) + ' end=' + this.secondsToTC(worldBlockEndSec));

        if (InTier <= 0 || OutTier <= 0) {
            var blockForDiag = this.getBlock(data, blockId);
            var diagInSec = blockForDiag && blockForDiag.in ? this.tcToSeconds(blockForDiag.in) : null;
            var diagOutSec = blockForDiag && blockForDiag.out ? this.tcToSeconds(blockForDiag.out) : null;
            var diagInMp4 = diagInSec !== null ? diagInSec - worldSecMediaStart : null;
            var diagOutMp4 = diagOutSec !== null ? diagOutSec - worldSecMediaStart : null;
            log('\uD83D\uDD2C [ER:Bounds] FALLBACK DETECTAT: InTier=' + InTier + ', OutTier=' + OutTier + ' | block.in=' + (diagInMp4 !== null ? diagInMp4.toFixed(2) + 's' : 'N/D') + ' block.out=' + (diagOutMp4 !== null ? diagOutMp4.toFixed(2) + 's' : 'N/D') + ' | REAL: IN=' + mp4ExpandedInPoint.toFixed(2) + 's OUT=' + mp4ExpandedOutPoint.toFixed(2) + 's (handles=' + inHandlesSec + 's)');
        }

        return { mp4ExpandedInPoint: mp4ExpandedInPoint, mp4ExpandedOutPoint: mp4ExpandedOutPoint, mp4Duration: mp4Duration, InTier: InTier, OutTier: OutTier, ref: ref };
    };

    // ----------------------------------------------------------------
    // Registre al namespace
    // ----------------------------------------------------------------
    FASTPASS_UI.EscaletaReader = ER;
    window.FASTPASS_UI = FASTPASS_UI;

    log('[ER:Bounds] Sub-modul inicialitzat (12 metodes)');
})();