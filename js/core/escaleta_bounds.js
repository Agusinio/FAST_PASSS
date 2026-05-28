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
 *   - getBlockItems(data, blockId)
 *   - getProgramName(data)
 *   - getOnAirVideoItems(data, blockId)
 *   - getNeighbourOnAirTimes(data, blockId)
 *   - hasNonVideoItemsBefore(data, blockId)
 *   - calcClipBounds(worldTCMediaStart, worldTCBlockIn, worldTCBlockOut, handleSecs, worldTCMediaStop)
 *   - calcOnAirBounds(data, blockId, worldTCMediaStart, worldTCMediaStop, cfg)
 *   - _findCaretasBetween(allLines, fromIdx, toIdx, data)
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
    ER.getBlock = function (data, blockId) {
        var clips = data && data.cleanFeed && data.cleanFeed.clips ? data.cleanFeed.clips : null;
        if (!clips) return null;
        var block = null;
        for (var i = 0; i < clips.length; i++) {
            if (clips[i].id === blockId) { block = clips[i]; break; }
        }
        if (!block) {
            log('\u26A0\uFE0F [ER:Bounds] Bloc "' + blockId + '" no trobat al cleanFeed');
            return null;
        }
        return block;
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
        var mp4ExpandedOutPoint = (worldSecBlockOut - worldSecMediaStart) + handles;

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

        var hardIn  = prevEnd   != null ? (prevEnd   - worldSecMediaStart) - 0.04 : null;
        var hardOut = nextStart != null ? (nextStart - worldSecMediaStart) + 0.04 : null;
        if (hardIn  != null && mp4ExpandedInPoint  < hardIn)  mp4ExpandedInPoint  = hardIn;
        if (hardOut != null && mp4ExpandedOutPoint > hardOut) mp4ExpandedOutPoint = hardOut;

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

        var prevVideoData = null;
        if (blockRefSec !== null) {
            for (var vi = 0; vi < allOnAirVideos.length; vi++) {
                var vid = allOnAirVideos[vi];
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
                log('   \u2705 Tier0-IN: item anterior "' + prevVideoData.item.num + '" acaba a ' + worldBlockStartSec.toFixed(2) + 's');

                var caretas = this._findCaretasBetween(allLines, prevVideoData.idx, blockStartIdx, data);
                if (caretas.totalDur > 0) {
                    worldBlockStartSec += caretas.totalDur;
                    log('   \uD83D\uDCFA Tier0-IN: +' + caretas.totalDur + 's per caretes (' + caretas.names.join(', ') + ') -> ' + worldBlockStartSec.toFixed(2) + 's');
                }
            } else {
                log('   \u23ED\uFE0F Tier0-IN: gap=' + gap.toFixed(0) + 's > maxGap=' + maxGap + 's. Usant Tier1.');
            }
        }

        // -- Tier 1 (IN): Primer item estructural del bloc --
        var structuralItemsInBlock = [];
        for (var si = 0; si < blockLines.length; si++) {
            if (this.isItemEstructural(blockLines[si])) {
                structuralItemsInBlock.push(blockLines[si]);
            }
        }

        if (InTier === 0 && structuralItemsInBlock.length > 0) {
            var firstItem = structuralItemsInBlock[0];
            var entradaSec = this.getItemEntradaSec(firstItem, allLines, data);
            if (entradaSec !== null) {
                worldBlockStartSec = entradaSec;
                InTier = 1;
                worldBlockAnchorSec = entradaSec;
                log('   \u2705 Tier1-IN: "' + firstItem.num + '" entrada -> ' + worldBlockStartSec.toFixed(2) + 's');
            } else if (structuralItemsInBlock.length > 0) {
                var lastResort = structuralItemsInBlock[structuralItemsInBlock.length - 1];
                var resortSec = this.getItemEntradaSec(lastResort, allLines, data);
                if (resortSec !== null) {
                    worldBlockStartSec = resortSec;
                    InTier = 1;
                    worldBlockAnchorSec = resortSec;
                    log('   \u2705 Tier1-IN (last resort): "' + lastResort.num + '" entrada -> ' + worldBlockStartSec.toFixed(2) + 's');
                }
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

        // ================================================================
        // OUT: worldBlockEndSec
        // ================================================================
        var worldBlockEndSec = null;
        var OutTier = 0;

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

        // Estratègia A: Item següent amb video i OnAir a allLines
        if (blockEndIdx >= 0 && blockEndIdx < allLines.length - 1) {
            for (var ai = blockEndIdx + 1; ai < allLines.length; ai++) {
                var next = allLines[ai];
                if (next.flotant === true) continue;
                if (next.teVideo === true && next.horaEntradaOnAir) {
                    tier2Candidate = this.tcToSeconds(next.horaEntradaOnAir);
                    tier2Label = 'item següent "' + next.num + '" comença a ' + tier2Candidate.toFixed(2) + 's (OnAir=' + next.horaEntradaOnAir + ')';
                    break;
                }
            }
        }
        // Estratègia B: Primer video del bloc següent (per agrupacio)
        if (tier2Candidate === null) {
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

        // ================================================================
        // CONVERSIÓ A BOUNDS RELATIUS AL MP4
        // ================================================================
        var mp4ExpandedInPoint  = Math.max(0, (worldBlockStartSec - worldSecMediaStart) - inHandlesSec);
        var mp4ExpandedOutPoint = (worldBlockEndSec - worldSecMediaStart) + outHandlesSec;

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
