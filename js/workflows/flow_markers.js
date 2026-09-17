/**
 * ============================================================================
 * WORKFLOW: MARKERS (F1→F6: OnAir, Deducidos, Coincidencias, Aproximados,
 *          Huérfanos, Gráficos)
 * ============================================================================
 * Extret de flow_assembly.js durant la modularització v2.9.5 "LIPO-PRO".
 * Totes les fases de col·locació de marcadors estructurals i gràfics,
 * incloent classificació d'ítems, àncores temporals i correlation snap.
 * ============================================================================
 */

(function () {
    var FASTPASS_UI = window.FASTPASS_UI || {};
    FASTPASS_UI.Workflows = FASTPASS_UI.Workflows || {};

    const getUtils = () => window.FASTPASS_UI.Utils;
    const getClipsLogic = () => window.FASTPASS_UI.Logic.Clips;
    const getAssemblyContext = () => window.FASTPASS_UI.Core.AssemblyContext;
    const getMP4 = () => window.FASTPASS_UI.Workflows.MP4;

    const log = (m, lvl) => getUtils().log(m, lvl || "DEBUG");
    const callJSX = (s) => getUtils().callJSX(s);

    // Función para formatear segundos a timecode (HH:MM:SS:FF) asumiendo 25 fps
    const formatTC = (seconds) => {
        const fps = 25;
        let totalFrames = Math.round(seconds * fps);
        const ff = totalFrames % fps;
        const totalSeconds = (totalFrames / fps) | 0;
        const ss = totalSeconds % 60;
        const totalMinutes = (totalSeconds / 60) | 0;
        const mm = totalMinutes % 60;
        const hh = (totalMinutes / 60) | 0;
        return (hh < 10 ? '0' + hh : hh) + ":" +
            (mm < 10 ? '0' + mm : mm) + ":" +
            (ss < 10 ? '0' + ss : ss) + ":" +
            (ff < 10 ? '0' + ff : ff);
    };

    FASTPASS_UI.Workflows.Markers = {

        // ═══════════════════════════════════════════════════════════════
        // SUFFIXOS GRÀFICS (compartits per _classifyItems i UNGROUPED)
        // BUG #12: Evita que ítems gràfics amb agrupacio:null (ex: 18TE)
        // es col·loquin com a marcadors estructurals a F1/F2/F3.
        // Aquests ítems pertanyen exclusivament a F6·Gràfics.
        // ═══════════════════════════════════════════════════════════════
        _GRAPHIC_SUFFIXES: new Set([
            'chy', 'chy1', 'chy2',
            'gf', 'gf1', 'gf2', 'gf_01', 'gf_02', 'gf_011',
            'te', 'te1', 'te2', 'te3',
            'p2', 'p21', 'p22', 'p23', 'p24', 'p3', 'p4', 'p5', 'p51', 'p52',
            'p5_01', 'p5_02', 'p7', 'p7_01', 'p7_02', 'p7_03', 'p7_0',
            'p71', 'p72', 'p73', 'p',
            'td', 'td1', 'td2', 'td3', 'td4', 'td_01', 'td_02', 'td_at1',
            'qr', 'rq',
            'at1', 'at2', 'at3', '_at1', '_at2', '_at3', 'ae', 't', 'teloc',
            '**********'
        ]),

        _isGraphicByNum: function (num) {
            if (!num) return false;
            var clean = num.toString().toLowerCase().trim();
            var match = clean.match(/^\d+(.*)$/);
            if (!match || match[1] === '') return false;
            return this._GRAPHIC_SUFFIXES.has(match[1]);
        },

        // ═══════════════════════════════════════════════════════════════
        // HELPER: UPSERT atòmic de marcadors amb protecció d'errors
        // BUG #8: Evita que un JSON.parse falli si callJSX retorna
        // un valor no-JSON (ex: "ERR:..." o buit).
        // ═══════════════════════════════════════════════════════════════
        _safePlaceByPrefixes: async function (placements, label) {
            try {
                var safePlacements = JSON.parse(JSON.stringify(placements));
                for (var sp = 0; sp < safePlacements.length; sp++) {
                    if (safePlacements[sp].comment) {
                        safePlacements[sp].comment = safePlacements[sp].comment.replace(/'/g, '');
                    }
                }
                var raw = await callJSX('Markers.placeByPrefixes(\'' + JSON.stringify(safePlacements) + '\')');
                if (!raw || raw === '[]' || raw === '{}') {
                    return { placed: 0, moved: 0, created: 0 };
                }
                var result = JSON.parse(raw);
                if (result.error) {
                    log('🔴 [' + label + '] ERROR JSX: ' + result.error, 'ERROR');
                }
                return result;
            } catch (e) {
                log('💥 [' + label + '] Crash protegint placeByPrefixes: ' + e.message, 'ERROR');
                return { placed: 0, moved: 0, created: 0, error: e.message };
            }
        },

        // ═══════════════════════════════════════════════════════════════
        // HELPER: Color de marcador segons especificació MARKER_COLORS.md
        // agrupacio != null → 6 (Blau)
        // agrupacio == null + durada == 0 → 4 (Groc, gràfics)
        // agrupacio == null + durada > 0 → 1 (Vermell)
        // ═══════════════════════════════════════════════════════════════
        _getColorIdx: function (line) {
            if (line.agrupacio) return 6;
            var dStr = line.durada || line.duradaOnAir || '0:00';
            var parts = dStr.split(':').map(Number);
            var dSec = 0;
            if (parts.length === 2) dSec = parts[0] * 60 + parts[1];
            else if (parts.length === 3) dSec = parts[0] * 3600 + parts[1] * 60 + parts[2];
            else dSec = (typeof parts[0] === 'number') ? parts[0] : 0;
            return dSec === 0 ? 4 : 1;
        },

        // ═══════════════════════════════════════════════════════════════
        // _classifyItems(lines)
        // Classifica les línies d'escaleta en 4 categories.
        // ═══════════════════════════════════════════════════════════════
        _classifyItems: function (lines) {
            const parseDurada = (str) => {
                if (!str || str === "0:00") return 0;
                const parts = str.split(':').map(Number);
                if (parts.length === 2) return parts[0] * 60 + parts[1];
                else if (parts.length === 3) return parts[0] * 60 + parts[1] + parts[2] / 25;
                else if (parts.length === 4) return parts[0] * 3600 + parts[1] * 60 + parts[2] + parts[3] / 25;
                return 0;
            };

            const getEffectiveDuradaSec = (line) => {
                const dStr = line.durada || '';
                if (dStr === '' || dStr === '0:00') {
                    const onAir = line.duradaOnAir || '0:00';
                    return parseDurada(onAir);
                }
                return parseDurada(dStr);
            };

            const getRawDuradaSec = (line) => parseDurada(line.durada || '0:00');

            const FORCED_STRUCTURAL_SUFFIXES = new Set(['lead', 'i', 'dp', 'dir', 'f']);

            var self = this;
            const isGraphicByNum = function (num) { return self._isGraphicByNum(num); };

            const isForcedStructuralByNum = (num) => {
                if (!num) return false;
                const clean = num.toString().toLowerCase().trim();
                const match = clean.match(/^\d+(.*)$/);
                if (!match || match[1] === '') return true;
                return FORCED_STRUCTURAL_SUFFIXES.has(match[1]);
            };

            const structuralItems = [];
            const graphicItems = [];
            for (const line of lines) {
                const rawNum = (line.num || '').toString().trim();
                if (rawNum === '' || rawNum === '.') {
                    log(`   ⏭️ [SKIP] Ítem sense num vàlid: "${line.titol || '?'}" → ignorat`);
                    continue;
                }
                const horaRef = line.horaEntradaOnAir || line.horaEntradaPrevista;
                if (!horaRef || horaRef === "00:00:00") continue;
                const dSec = getRawDuradaSec(line);
                const hasOnAir = line.horaEntradaOnAir
                    && line.horaEntradaOnAir !== '00:00:00'
                    && line.horaEntradaOnAir.trim() !== '';

                if (isGraphicByNum(line.num)) {
                    graphicItems.push(line);
                    log(`   📌 [D9b·GRAFIC] ${line.num}: sufix gràfic → Fase 3`);
                } else if (dSec > 0) {
                    structuralItems.push(line);
                } else if (line.agrupacio && hasOnAir) {
                    structuralItems.push(line);
                } else if (line.agrupacio) {
                    structuralItems.push(line);
                } else {
                    graphicItems.push(line);
                }
            }
            log(`📋 Items: ${structuralItems.length} estructurals, ${graphicItems.length} gràfics`);

            const farosItems = [];
            const aproximadosItems = [];
            for (const item of structuralItems) {
                const onAir = item.horaEntradaOnAir;
                if (onAir && onAir !== '00:00:00' && onAir.trim() !== '') {
                    farosItems.push(item);
                } else if (item.agrupacio || isForcedStructuralByNum(item.num)) {
                    aproximadosItems.push(item);
                    if (!item.agrupacio && isForcedStructuralByNum(item.num)) {
                        log(`   📌 [D9c·FORCED] ${item.num}: sufix estructural forçat → Fase 2`);
                    }
                } else {
                    graphicItems.push(item);
                }
            }
            log(`📍 Faros: ${farosItems.length} (${farosItems.map(l => l.num).join(', ')})`);
            log(`📍 Aproximats: ${aproximadosItems.length} (${aproximadosItems.map(l => l.num).join(', ')})`);
            log(`📋 Gràfics (total acumulat): ${graphicItems.length}`);

            return {
                structuralItems, graphicItems, farosItems, aproximadosItems,
                parseDurada, getEffectiveDuradaSec, getRawDuradaSec,
                isGraphicByNum, isForcedStructuralByNum
            };
        },

        // ═══════════════════════════════════════════════════════════════
        // _calcTemporalAnchors(manifest, reader, structuralItems, clips)
        // Calcula les 4 àncores temporals (BUG #3 FIX inclòs).
        // ═══════════════════════════════════════════════════════════════
        _calcTemporalAnchors: function (manifest, reader, structuralItems, clips) {
            var clipStart = 0;
            var clipInPoint = manifest.ref.tlBlockInPointSec || 0;
            if (clips && clips.length > 0 && clips[0]) {
                clipStart = (typeof clips[0].start === 'number') ? clips[0].start : 0;
                if (clips[0].inPoint !== undefined && clips[0].inPoint !== null) {
                    clipInPoint = clips[0].inPoint;
                }
            }

            log('🔧 [BUG3·FIX] Clip V1 real: start=' + clipStart.toFixed(3) + 's, inPoint=' + clipInPoint.toFixed(3) + 's vs manifest tlBlockInPointSec=' + (manifest.ref.tlBlockInPointSec || 0).toFixed(3) + 's');

            var worldSecMediaStart = manifest.ref.worldSecMediaStart || 0;

            var anchorOnAirSec = null;
            var anchorSource = '';
            if (manifest.ref.blockInSec !== null && manifest.ref.blockInSec !== undefined) {
                anchorOnAirSec = manifest.ref.blockInSec;
                anchorSource = 'blockInSec';
            } else if (manifest.ref.worldBlockAnchorSec !== null && manifest.ref.worldBlockAnchorSec !== undefined) {
                anchorOnAirSec = manifest.ref.worldBlockAnchorSec;
                anchorSource = 'worldBlockAnchorSec';
            } else if (manifest.ref.worldBlockStartSec !== null && manifest.ref.worldBlockStartSec !== undefined) {
                anchorOnAirSec = manifest.ref.worldBlockStartSec;
                anchorSource = 'worldBlockStartSec';
            }
            if (anchorOnAirSec === null || anchorOnAirSec === undefined) {
                log("⚠️ No hi ha àncora temporal al manifest. Cal reintentar «Muntar».", "ERROR");
                return null;
            }

            var refF1 = anchorOnAirSec;
            var refF1Origen = 'blockInSec (fallback)';
            if (structuralItems.length > 0) {
                var refLine = structuralItems[0];
                var rfOnAir = refLine.horaEntradaOnAir;
                var rfHasOnAir = rfOnAir && rfOnAir !== '00:00:00' && rfOnAir.trim() !== '';
                if (rfHasOnAir) {
                    refF1 = reader.tcToSeconds(rfOnAir);
                    refF1Origen = 'OnAir (1r: ' + (refLine.num || '?') + ')';
                } else {
                    var rfDeduced = reader._deduceOnAirEntrada(refLine, manifest.escaletaItems, null);
                    if (rfDeduced !== null) {
                        refF1 = rfDeduced;
                        refF1Origen = 'OnAirDeducido (1r: ' + (refLine.num || '?') + ')';
                    }
                }
            }

            var tlClipStartSec = clipStart + (refF1 - worldSecMediaStart) - clipInPoint;

            var anchorEfectiva = anchorOnAirSec;
            var anchorEfOrigen = 'blockInSec (fallback)';
            if (structuralItems.length > 0) {
                var firstLine = structuralItems[0];
                var fOnAir = firstLine.horaEntradaOnAir;
                var fPrevista = firstLine.horaEntradaPrevista;
                var fHasOnAir = fOnAir && fOnAir !== '00:00:00' && fOnAir.trim() !== '';
                var fHasPrevista = fPrevista && fPrevista !== '00:00:00';

                if (fHasOnAir) {
                    anchorEfectiva = reader.tcToSeconds(fOnAir);
                    anchorEfOrigen = 'OnAir (1r: ' + (firstLine.num || '?') + ')';
                } else {
                    var fDeduced = reader._deduceOnAirEntrada(firstLine, manifest.escaletaItems, null);
                    if (fDeduced !== null) {
                        anchorEfectiva = fDeduced;
                        anchorEfOrigen = 'OnAirDeducido (1r: ' + (firstLine.num || '?') + ')';
                    } else if (fHasPrevista) {
                        anchorEfectiva = reader.tcToSeconds(fPrevista);
                        anchorEfOrigen = 'Prevista (1r: ' + (firstLine.num || '?') + ')';
                    }
                }
            }

            var anchorEfTimelineSec = clipStart + (anchorEfectiva - worldSecMediaStart) - clipInPoint;

            log('📍 [ESTRUCTURAL] Àncora OnAir: ' + anchorOnAirSec.toFixed(3) + 's (font: ' + anchorSource + '), tlClipStart: ' + tlClipStartSec.toFixed(3) + 's, anchorEfTL: ' + anchorEfTimelineSec.toFixed(3) + 's');
            log('📍 [F1·PURA] Referència F1: ' + (refF1 !== null ? refF1.toFixed(1) + 's (' + refF1Origen + ')' : 'CAP') + '  |  efectiva (1r): ' + anchorEfectiva.toFixed(1) + 's (' + anchorEfOrigen + ')');

            return {
                tlClipStartSec, anchorOnAirSec, anchorSource,
                anchorEfectiva, anchorEfOrigen, refF1, refF1Origen,
                anchorEfTimelineSec: anchorEfTimelineSec,
                clipStart: clipStart,
                clipInPoint: clipInPoint
            };
        },

        // ═══════════════════════════════════════════════════════════════
        // _correlationSnap(markers, clips, densityData, manifestItems, reader)
        // D1·CorrelationSnap: Algoritme de Δ consensuat.
        // ═══════════════════════════════════════════════════════════════
        _calcDensityFootprint: function (clips) {
            return FASTPASS_UI.Logic.Assembly.calcDensityFootprintV2(clips);
        },

        _correlationSnap: function (markers, clips, densityData, manifestItems, reader) {
            var BUCKET_SIZE = 0.04;
            var SEARCH_WINDOW = 2.0;
            var MIN_CONFIDENCE = 0.30;
            var ON_AIR_WEIGHT = 1.0;
            var DEDUCED_WEIGHT = 0.7;
            var DENSITY_BONUS = 1.5;
            var DENSITY_PROXIMITY = 0.5;
            var EXCLUDE_ZERO_THRESHOLD = 0.01;

            if (!markers || markers.length === 0 || !clips || clips.length === 0) {
                log('   🔬 [CorrelationSnap] Sense marcadors o clips per analitzar.');
                return { delta: null, confidence: 0, votes: 0, totalWeight: 0, onAirCount: 0, deducedCount: 0, breakdown: [] };
            }

            var prefixToItem = {};
            for (var i = 0; i < manifestItems.length; i++) {
                var item = manifestItems[i];
                if (item.num) prefixToItem[String(item.num)] = item;
            }

            var _extractPrefix = function (comment) {
                if (!comment) return '';
                var spaceDashIdx = comment.indexOf(' -');
                if (spaceDashIdx <= 0) return '';
                return comment.substring(0, spaceDashIdx).replace(/^\s+|\s+$/g, '');
            };

            var _nearDensityBreak = function (timeSec) {
                if (!densityData || !densityData.breaks) return false;
                var breaks = densityData.breaks;
                for (var b = 0; b < breaks.length; b++) {
                    if (Math.abs(breaks[b].time - timeSec) < DENSITY_PROXIMITY) return true;
                }
                return false;
            };

            var _classifyMarker = function (prefix) {
                if (!prefix || !prefixToItem[prefix]) return 'unknown';
                var item2 = prefixToItem[prefix];
                var onAir2 = item2.horaEntradaOnAir;
                if (onAir2 && onAir2 !== '00:00:00' && onAir2.trim() !== '') return 'onAir';
                return 'deduced';
            };

            var histogram = {};
            var totalWeight = 0;
            var onAirCount = 0;
            var deducedCount = 0;
            var breakdown = [];

            for (var mi = 0; mi < markers.length; mi++) {
                var mk = markers[mi];
                var markerTime = (typeof mk.time === 'number') ? mk.time : parseFloat(mk.time);
                if (isNaN(markerTime)) continue;

                if (markerTime < EXCLUDE_ZERO_THRESHOLD) {
                    log('   🔬 [CorrelationSnap] Excloent marcador a ' + markerTime.toFixed(3) + 's (00:00)');
                    continue;
                }

                var comment = mk.comments || '';
                var prefix = _extractPrefix(comment);
                var markerType = _classifyMarker(prefix);
                var baseWeight = (markerType === 'onAir') ? ON_AIR_WEIGHT : ((markerType === 'deduced') ? DEDUCED_WEIGHT : 0.3);
                if (markerType === 'onAir') onAirCount++;
                else if (markerType === 'deduced') deducedCount++;

                var nearestDist = SEARCH_WINDOW + 999;
                var nearestCut = null;
                for (var ci = 0; ci < clips.length; ci++) {
                    var dStart = clips[ci].start - markerTime;
                    var dEnd = clips[ci].end - markerTime;
                    if (Math.abs(dStart) < Math.abs(nearestDist)) { nearestDist = dStart; nearestCut = clips[ci].start; }
                    if (Math.abs(dEnd) < Math.abs(nearestDist)) { nearestDist = dEnd; nearestCut = clips[ci].end; }
                }

                if (Math.abs(nearestDist) > SEARCH_WINDOW) {
                    breakdown.push({ prefix: prefix, time: markerTime, type: markerType, delta: nearestDist, used: false, reason: 'fora de finestra' });
                    continue;
                }

                var bucketIdx = Math.round(nearestDist / BUCKET_SIZE);
                var densityNear = _nearDensityBreak(markerTime);
                var w = baseWeight * (densityNear ? DENSITY_BONUS : 1.0);

                if (!histogram[bucketIdx]) histogram[bucketIdx] = { weight: 0, deltas: [] };
                histogram[bucketIdx].weight += w;
                histogram[bucketIdx].deltas.push(nearestDist);
                totalWeight += w;

                breakdown.push({ prefix: prefix, time: markerTime, type: markerType, delta: nearestDist, weight: w, densityNear: densityNear, used: true });
            }

            var bestBucket = null;
            var bestWeight = 0;
            var bestVotes = 0;
            var avgDeltaInBucket = 0;
            var bucketKeys = Object.keys(histogram);
            for (var bk = 0; bk < bucketKeys.length; bk++) {
                var key = bucketKeys[bk];
                var entry = histogram[key];
                if (entry.weight > bestWeight) {
                    bestWeight = entry.weight;
                    bestBucket = parseInt(key, 10);
                    bestVotes = entry.deltas.length;
                    var sumD = 0;
                    for (var dd = 0; dd < entry.deltas.length; dd++) sumD += entry.deltas[dd];
                    avgDeltaInBucket = entry.deltas.length > 0 ? (sumD / entry.deltas.length) : (bestBucket * BUCKET_SIZE);
                }
            }

            var confidence = totalWeight > 0 ? (bestWeight / totalWeight) : 0;

            if (confidence < MIN_CONFIDENCE || bestBucket === null) {
                log('   🔬 [CorrelationSnap] Confiança insuficient: ' + (confidence * 100).toFixed(0) + '% < ' + (MIN_CONFIDENCE * 100).toFixed(0) + '% | millor bucket=' + bestBucket + ' (' + bestWeight.toFixed(2) + '/' + totalWeight.toFixed(2) + ')');
                return { delta: null, confidence: confidence, votes: bestVotes, totalWeight: totalWeight, onAirCount: onAirCount, deducedCount: deducedCount, breakdown: breakdown };
            }

            log('   🔬 [CorrelationSnap] Δ consensuat: ' + avgDeltaInBucket.toFixed(3) + 's (bucket=' + bestBucket + ', confiança=' + (confidence * 100).toFixed(0) + '%, vots=' + bestVotes + ', OnAir=' + onAirCount + ', Deducido=' + deducedCount + ')');

            return {
                delta: avgDeltaInBucket,
                confidence: confidence,
                votes: bestVotes,
                totalWeight: totalWeight,
                onAirCount: onAirCount,
                deducedCount: deducedCount,
                breakdown: breakdown
            };
        },

        // ═══════════════════════════════════════════════════════════════
        // _setupEstructural(): Convenience wrapper (mantingut per compatibilitat)
        // DELEGA a Core.AssemblyContext en lloc d'usar _loadAssemblyContext intern.
        // ═══════════════════════════════════════════════════════════════
        _setupEstructural: async function () {
            log("📍 [_setupEstructural] Wrapper→ sub-funcions atòmiques...");

            const ctxData = await getAssemblyContext().loadAssemblyContext();
            if (!ctxData) return null;
            const { ctx, manifest, reader, targetBlock, lines, lineIndexByNum, clips, refFromManifest, refInPoint } = ctxData;

            const densityData = getMP4()._calcDensityFootprint(clips);

            const classData = this._classifyItems(lines);
            const { structuralItems, graphicItems, farosItems, aproximadosItems, parseDurada, getEffectiveDuradaSec, getRawDuradaSec, isGraphicByNum, isForcedStructuralByNum } = classData;

            const anchors = this._calcTemporalAnchors(manifest, reader, structuralItems, clips);
            if (!anchors) return null;

            return {
                ctx, manifest, reader, targetBlock, lines, lineIndexByNum,
                clips, densityData, refFromManifest, refInPoint,
                structuralItems, graphicItems, farosItems, aproximadosItems,
                itemPositions: new Map(), placedMarkers: [],
                tlClipStartSec: anchors.tlClipStartSec,
                anchorOnAirSec: anchors.anchorOnAirSec,
                anchorSource: anchors.anchorSource,
                anchorEfTimelineSec: anchors.anchorEfTimelineSec,
                anchorEfectiva: anchors.anchorEfectiva,
                anchorEfOrigen: anchors.anchorEfOrigen,
                refF1: anchors.refF1,
                refF1Origen: anchors.refF1Origen,
                parseDurada, getEffectiveDuradaSec, getRawDuradaSec,
                isGraphicByNum, isForcedStructuralByNum
            };
        },

        // ═══════════════════════════════════════════════════════════════
        // 🟢 F1: placeOnAirMarkers — Marcadors amb TC exacte d'emissió (OnAir)
        // ═══════════════════════════════════════════════════════════════
        placeOnAirMarkers: async function () {
            log('🟢 [F1·OnAir] Iniciant col·locació independent...');

            const ctxData = await getAssemblyContext().loadAssemblyContext();
            if (!ctxData) { log('⚠️ [F1·OnAir] loadAssemblyContext ha fallat. Abortant.'); return; }
            const { manifest, reader, lines, clips, firstUngroupedItem } = ctxData;

            const classData = this._classifyItems(lines);
            const { structuralItems } = classData;

            const anchors = this._calcTemporalAnchors(manifest, reader, structuralItems, clips);
            if (!anchors) { log('⚠️ [F1·OnAir] _calcTemporalAnchors ha fallat. Abortant.'); return; }
            const { tlClipStartSec, refF1 } = anchors;

            if (refF1 === null) {
                log('⚠️ [F1·OnAir] Sense referència F1 (cap ítem amb OnAir al bloc). Saltant F1.');
                return;
            }

            var placements = [];
            var itemPositions = new Map();

            for (var si = 0; si < structuralItems.length; si++) {
                var line = structuralItems[si];
                var onAir = line.horaEntradaOnAir;
                var hasOnAir = onAir && onAir !== '00:00:00' && onAir.trim() !== '';

                var idealPosSec = null;
                if (hasOnAir) {
                    var onAirSec = reader.tcToSeconds(onAir);
                    if (onAirSec !== null && onAirSec !== undefined) {
                        idealPosSec = tlClipStartSec + (onAirSec - refF1);
                    }
                }

                if (idealPosSec === null) {
                    log('   ⏭️ [F1·OnAir] ' + (line.num || '?') + ': sense OnAir. Saltant.');
                    continue;
                }
                if (idealPosSec < 0) idealPosSec = 0;

                var safeT = idealPosSec;
                var titol = (line.titol || '').substring(0, 60);
                var comment = (line.num ? line.num + ' - ' : '') + titol;
                comment = comment.trim();

                var colorIdx = 6;

                log('   🟢 [F1·OnAir] ' + (line.num || '?') + ': → ' + safeT.toFixed(2) + 's');
                itemPositions.set(line.num, safeT);

                placements.push({
                    prefix: line.num,
                    timeSec: safeT,
                    comment: comment,
                    colorIdx: colorIdx
                });
            }

            // ── Afegir ítems no agrupats intercalats (D12) ──
            if (firstUngroupedItem) {
                var ugOnAir = firstUngroupedItem.horaEntradaOnAir;
                var ugHasOnAir = ugOnAir && ugOnAir !== '00:00:00' && ugOnAir.trim() !== '';
                if (ugHasOnAir) {
                    var ugOnAirSec = reader.tcToSeconds(ugOnAir);
                    if (ugOnAirSec !== null && ugOnAirSec !== undefined) {
                        var ugPosSec = tlClipStartSec + (ugOnAirSec - refF1);
                        if (ugPosSec >= 0) {
                            var ugComment = (firstUngroupedItem.num ? firstUngroupedItem.num + ' - ' : '') + (firstUngroupedItem.titol || '').substring(0, 60);
                            ugComment = ugComment.trim();
                            placements.push({
                                prefix: firstUngroupedItem.num,
                                timeSec: ugPosSec,
                                comment: ugComment,
                                colorIdx: 1
                            });
                            log('   🔴 [F1·Ungrouped] ' + (firstUngroupedItem.num || '?') + ': → ' + ugPosSec.toFixed(2) + 's');
                        }
                    }
                }
            }

            if (placements.length === 0) {
                log('🟢 [F1·OnAir] Cap marcador per col·locar. ✓ FINALITZAT.');
                return;
            }

            var result = await this._safePlaceByPrefixes(placements, 'F1·OnAir');
            log('🟢 [F1·OnAir] Moguts: ' + (result.moved || 0) + ' | Nous: ' + (result.created || 0) + ' | Total: ' + (result.placed || 0) + '. ✓ FINALITZAT.');
        },

        // ═══════════════════════════════════════════════════════════════
        // 🟢 F2: placeDeducedOnAirMarkers — Marcadors deduïts (OnAir indirecte)
        // ═══════════════════════════════════════════════════════════════
        placeDeducedOnAirMarkers: async function () {
            log('🟢 [F2·Deduced] Iniciant col·locació...');

            const ctxData = await getAssemblyContext().loadAssemblyContext();
            if (!ctxData) { log('⚠️ [F2·Deduced] loadAssemblyContext ha fallat.'); return; }
            const { manifest, reader, lines, clips } = ctxData;

            const classData = this._classifyItems(lines);
            const { structuralItems } = classData;

            const anchors = this._calcTemporalAnchors(manifest, reader, structuralItems, clips);
            if (!anchors) { log('⚠️ [F2·Deduced] _calcTemporalAnchors ha fallat.'); return; }
            const { anchorEfTimelineSec, anchorEfectiva } = anchors;

            var placements = [];
            var itemPositions = new Map();
            var placedByD10 = {}; // Evita duplicar el mateix ítem per D10 + bucle

            // ── Carregar marcadors existents (faros de F1) per anclar deduïts ──
            var markersRaw2 = await callJSX('Markers.get()');
            var allMarkersF2 = [];
            try { allMarkersF2 = JSON.parse(markersRaw2); } catch (e) {}
            // Indexar faros per prefix
            var faroPositions = {};  // "01" → timelineSec, "03" → ...
            var _extractPrefixF2 = function(c) {
                if (!c) return '';
                var idx = c.indexOf(' -');
                return idx > 0 ? c.substring(0, idx).trim() : '';
            };
            for (var fi = 0; fi < allMarkersF2.length; fi++) {
                var pfx = _extractPrefixF2(allMarkersF2[fi].comments || '');
                if (pfx) faroPositions[pfx] = (typeof allMarkersF2[fi].time === 'number') ? allMarkersF2[fi].time : parseFloat(allMarkersF2[fi].time);
            }

            if (structuralItems.length > 0) {
                var firstItem = structuralItems[0];
                var firstNum = firstItem.num;
                if (firstNum) {
                    var hasFirstItemMarker = false;
                    for (var mi2 = 0; mi2 < allMarkersF2.length; mi2++) {
                        var mk2 = allMarkersF2[mi2];
                        if (typeof mk2.time === 'number' && Math.abs(mk2.time) < 0.02) {
                            var mkPrefix2 = _extractPrefixF2(mk2.comments || '');
                            if (mkPrefix2 === String(firstNum)) { hasFirstItemMarker = true; break; }
                        }
                    }
                    if (!hasFirstItemMarker) {
                        var firstTitol = (firstItem.titol || '').substring(0, 60);
                        var firstComment = firstNum + ' - ' + firstTitol;
                        placements.push({ prefix: firstNum, timeSec: 0, comment: firstComment.trim(), colorIdx: 6 });
                        itemPositions.set(firstNum, 0);
                        placedByD10[firstNum] = true;
                        log('🟠 [F2·Deducido] Forçant marcador 1r ítem ' + firstNum + ' a 00:00 (no existia)');
                    }
                }
            }

            // ── Construir mapa auxiliar: per a cada ítem deduït, trobar límits faro ──
            // Usar l'ordre de la escaleta (lines), NO l'ordre per TC (structuralItems),
            // per preservar la seqüència lògica (ex: 01dir va abans que 01 a l'escaleta).
            var faroLimitMap = {};  // num → {leftFaroTime, rightFaroTime, leftNum}
            var prevFaroNum = null;
            var prevFaroTime = 0;
            var structuralItemsSet = {};
            for (var si = 0; si < structuralItems.length; si++) {
                if (structuralItems[si].num) structuralItemsSet[String(structuralItems[si].num)] = true;
            }
            var seqOrderU = this._seqOrderForItems(manifest, lines, structuralItemsSet);
            var linesOrdered = [];
            for (var q1 = 0; q1 < seqOrderU.length; q1++) {
                for (var q2 = 0; q2 < lines.length; q2++) {
                    if (lines[q2].num && String(lines[q2].num) === seqOrderU[q1]) { linesOrdered.push(lines[q2]); break; }
                }
            }
            for (var li = 0; li < linesOrdered.length; li++) {
                var lineSi = linesOrdered[li];
                var numSi = lineSi.num;
                if (!numSi || !structuralItemsSet[numSi]) continue;  // només items estructurals
                var hasFaro = (faroPositions[numSi] !== undefined);
                if (hasFaro) {
                    // Assignar faro com a right limit als items pendents entre prevFaro i aquest
                    var ultimPendent = null;
                    for (var li2 in faroLimitMap) {
                        if (faroLimitMap[li2].rightFaroTime === null) {
                            faroLimitMap[li2].rightFaroTime = faroPositions[numSi];
                            faroLimitMap[li2].rightNum = numSi;
                            ultimPendent = li2;
                        }
                    }
                    // El DARRER item sense OnAir abans d'aquest faro es pega al seu TALL
                    // ANTERIOR (2026-09-17): el faro mana i empeny el deduit a la seva
                    // esquerra. Cas real: 01dir -> tall anterior a l'IPD 01.
                    if (ultimPendent !== null) faroLimitMap[ultimPendent].esUltimAbansFaro = true;
                    prevFaroNum = numSi;
                    prevFaroTime = faroPositions[numSi];
                } else {
                    // Item sense faro (deduït): assignar left limit
                    if (!faroLimitMap[numSi]) {
                        faroLimitMap[numSi] = { leftFaroTime: prevFaroTime, leftNum: prevFaroNum, rightFaroTime: null, rightNum: null, esUltimAbansFaro: false };
                    }
                }
            }

            for (var si = 0; si < structuralItems.length; si++) {
                var line = structuralItems[si];
                var lineNum = line.num;
                var onAir = line.horaEntradaOnAir;
                var hasOnAir = onAir && onAir !== '00:00:00' && onAir.trim() !== '';

                // Saltar ítems ja col·locats per D10 (evita duplicat)
                if (lineNum && placedByD10[lineNum]) {
                    log('   ⏭️ [F2·Deduced] ' + lineNum + ': ja col·locat per D10 a 00:00. Saltant.');
                    continue;
                }

                if (hasOnAir || faroPositions[lineNum] !== undefined) continue; // F1 ja l'ha col·locat

                var deduced = reader._deduceOnAirEntrada(line, manifest.escaletaItems, null);
                if (deduced === null) continue;

                var idealPosSec = anchorEfTimelineSec + (deduced - anchorEfectiva);
                if (idealPosSec < 0) idealPosSec = 0;

                // Anclar entre faros adyacents per preservar l'ordre de l'escaleta
                // 2026-09-17 (ORDRE): el faro (item amb OnAir) es la FONT DE VERITAT i no
                // es mou mai. Si aquest item sense OnAir cau a la DRETA d'un faro que
                // l'escaleta situa DESPRES, es col·loca al TALL ANTERIOR d'aquest faro.
                var limits0 = faroLimitMap[lineNum];
                if (limits0 && limits0.rightFaroTime !== null &&
                    (limits0.esUltimAbansFaro === true || idealPosSec >= limits0.rightFaroTime - 0.05)) {
                    var cutAbans = this._prevCutBefore(limits0.rightFaroTime, clips);
                    idealPosSec = Math.min(cutAbans, limits0.rightFaroTime - 0.5);
                    if (idealPosSec < 0) idealPosSec = 0;
                    log('   [F2-ORDRE] ' + lineNum + ': ' + deduced.toFixed(1) + 's -> ' + idealPosSec.toFixed(2) + 's (tall anterior al faro ' + limits0.rightNum + '@' + limits0.rightFaroTime.toFixed(2) + 's)');
                }
                var limits = faroLimitMap[lineNum];
                if (limits) {
                    if (limits.rightFaroTime !== null && idealPosSec >= limits.rightFaroTime) {
                        idealPosSec = limits.rightFaroTime - 0.5;  // 0.5s abans del faro
                        log('   ⏪ [F2·Clamp] ' + lineNum + ': deduced=' + deduced.toFixed(1) + 's → clampat a ' + idealPosSec.toFixed(2) + 's (límit dret: ' + limits.rightNum + '@' + limits.rightFaroTime.toFixed(2) + 's)');
                    }
                    if (limits.leftFaroTime > 0 && idealPosSec < limits.leftFaroTime + 0.5) {
                        idealPosSec = limits.leftFaroTime + 0.5;  // 0.5s després del faro anterior
                        log('   ⏩ [F2·Clamp] ' + lineNum + ': clampat a ' + idealPosSec.toFixed(2) + 's (límit esquerre: ' + limits.leftNum + '@' + limits.leftFaroTime.toFixed(2) + 's)');
                    }
                }

                var safeT = idealPosSec;
                var titol = (line.titol || '').substring(0, 60);
                var comment = (line.num ? line.num + ' - ' : '') + titol;
                comment = comment.trim();

                var colorIdx = this._getColorIdx(line);

                log('   🟡 [F2·Deduced] ' + (line.num || '?') + ': deduced=' + deduced.toFixed(1) + 's → timeline=' + safeT.toFixed(2) + 's');

                placements.push({
                    prefix: line.num,
                    timeSec: safeT,
                    comment: comment,
                    colorIdx: colorIdx
                });
            }

            if (placements.length === 0) {
                log('🟢 [F2·Deduced] Cap marcador addicional. ✓ FINALITZAT.');
                return;
            }

            var result = await this._safePlaceByPrefixes(placements, 'F2·Deduced');
            log('🟢 [F2·Deduced] Moguts: ' + (result.moved || 0) + ' | Nous: ' + (result.created || 0) + ' | Total: ' + (result.placed || 0) + '. ✓ FINALITZAT.');
        },

        // ═══════════════════════════════════════════════════════════════
        // 🟢 F3: placeScheduledMarkers — Marcadors programats (Prevista + coincidència)
        // ═══════════════════════════════════════════════════════════════
        placeScheduledMarkers: async function () {
            log('🟢 [F3·Coinc] Iniciant col·locació de coincidències...');

            const ctxData = await getAssemblyContext().loadAssemblyContext();
            if (!ctxData) { log('⚠️ [F3·Coinc] loadAssemblyContext ha fallat.'); return; }
            const { manifest, reader, lines, clips } = ctxData;

            const classData = this._classifyItems(lines);
            const { structuralItems } = classData;

            const anchors = this._calcTemporalAnchors(manifest, reader, structuralItems, clips);
            if (!anchors) { log('⚠️ [F3·Coinc] _calcTemporalAnchors ha fallat.'); return; }
            const { anchorEfTimelineSec, anchorEfectiva } = anchors;

            // ── Obtenir marcadors existents per a correlation snap ──
            var markersRaw = await callJSX('Markers.get()');
            var existingMarkers = [];
            if (markersRaw && markersRaw !== '[]') {
                try { existingMarkers = JSON.parse(markersRaw); } catch (e) {}
            }
            log('   🟢 [F3·Coinc] Marcadors existents al timeline: ' + existingMarkers.length);

            var densityData = this._calcDensityFootprint(clips);
            var snapResult = this._correlationSnap(existingMarkers, clips, densityData, manifest.escaletaItems, reader);
            var snapDelta = (snapResult && snapResult.delta !== null) ? snapResult.delta : 0;
            log('   🟢 [F3·Coinc] Δ snap: ' + snapDelta.toFixed(3) + 's (confiança=' + (snapResult.confidence * 100).toFixed(0) + '%)');

            var placements = [];

            for (var si = 0; si < structuralItems.length; si++) {
                var line = structuralItems[si];
                var onAir = line.horaEntradaOnAir;
                var hasOnAir = onAir && onAir !== '00:00:00' && onAir.trim() !== '';

                // F3·Coinc: només afina faros (OnAir real). Saltar deduïts i previstos.
                if (!hasOnAir) continue;

                var targetSec = reader.tcToSeconds(onAir);
                if (targetSec === null || targetSec === undefined) continue;

                var idealPosSec = anchorEfTimelineSec + (targetSec - anchorEfectiva) + snapDelta;
                if (idealPosSec < 0) idealPosSec = 0;

                var safeT = idealPosSec;
                var titol = (line.titol || '').substring(0, 60);
                var comment = (line.num ? line.num + ' - ' : '') + titol;
                comment = comment.trim();

                var colorIdx = this._getColorIdx(line);

                log('   🟠 [F3·Coinc] ' + (line.num || '?') + ': → ' + safeT.toFixed(2) + 's (Δ=' + snapDelta.toFixed(3) + 's)');

                placements.push({
                    prefix: line.num,
                    timeSec: safeT,
                    comment: comment,
                    colorIdx: colorIdx
                });
            }

            if (placements.length === 0) {
                log('🟢 [F3·Coinc] Cap marcador addicional. ✓ FINALITZAT.');
                return;
            }

            var result = await this._safePlaceByPrefixes(placements, 'F3·Coinc');
            log('🟢 [F3·Coinc] Moguts: ' + (result.moved || 0) + ' | Nous: ' + (result.created || 0) + ' | Total: ' + (result.placed || 0) + '. ✓ FINALITZAT.');
        },

        /**
         * _buildOnAirMap: Mapa num → true si ALGUNA línia d'escaleta amb aquell num té
         * OnAir real. Ha de ser un OR: a l'escaleta hi ha nums repetits (01, 02…) en
         * agrupacions diferents i, si ens quedéssim amb l'última línia llegida, un faro
         * bo (p.ex. "01 - INVERSIONS", amb OnAir) es classificaria com a deduït i F4 el
         * mouriria fins a 2,5 s, trencant-lo.
         */
        _buildOnAirMap: function (lines) {
            var m = {};
            var arr = lines || [];
            for (var i = 0; i < arr.length; i++) {
                var num = arr[i].num;
                if (!num) continue;
                var oa = arr[i].horaEntradaOnAir;
                var has = !!(oa && oa !== '00:00:00' && String(oa).trim() !== '');
                var key = String(num);
                m[key] = !!m[key] || has;
            }
            return m;
        },

        /**
         * _snapWindowFaro: Finestra de snap per a marcadors FARO (ítems amb OnAir real).
         * Ha de ser prou àmplia per absorbir l'error del delta de correlació de F3
         * (el Δ consensuat pot passar-se ~0,7 s: cas real 2026-09-16 → 01 quedava a
         * 0,72 s del seu tall i amb ±0,6 s F4 no el corregia), però prou curta per no
         * saltar a talls irrellevants.
         * Configurable a Profile.json → general.snapWindowFaroSec (per defecte 1,0 s).
         */
        _snapWindowFaro: function () {
            var w = null;
            try {
                var c = FASTPASS_UI.Config.get();
                if (c && c.snapWindowFaroSec != null) w = Number(c.snapWindowFaroSec);
            } catch (e) { }
            // 2026-09-17: pujat de 1,0 -> 1,5 s. La deriva entre l'hora d'emissio i el
            // tall real dels faros era 1,04-1,28 s, aixi que amb 1,0 s no s'ajustaven mai
            // i quedaven FORA del tall.
            return (isFinite(w) && w > 0) ? w : 1.5;
        },

        /**
         * _snapWindowDeduced: Finestra de snap per a marcadors DEDUÏTS (ítems sense
         * OnAir, col·locats per F2). Arrosseguen l'error de les durades d'escaleta
         * (típicament 1-3 s), així que necessiten més marge que els faros.
         * Configurable a Profile.json → general.snapWindowDeducedSec (per defecte 2,5 s).
         */
        _snapWindowDeduced: function () {
            var w = null;
            try {
                var c = FASTPASS_UI.Config.get();
                if (c && c.snapWindowDeducedSec != null) w = Number(c.snapWindowDeducedSec);
            } catch (e) { }
            return (isFinite(w) && w > 0) ? w : 2.5;
        },

        /**
         * _extractPrefixFromComment: Extreu el prefix (num d'ítem) del comentari
         * d'un marcador. Format: "01dir - CONNEXIÓ WASHINGTON" → "01dir".
         */
        _extractPrefixFromComment: function (comment) {
            if (!comment) return '';
            var idx = comment.indexOf(' -');
            if (idx <= 0) return '';
            return comment.substring(0, idx).replace(/^\s+|\s+$/g, '');
        },

        /**
         * _prevCutBefore: Retorna el tall de V1 immediatament ANTERIOR a tSec.
         * S'usa com a límit dret ("corte anterior") per als ítems sense OnAir que
         * l'escaleta situa ABANS d'un faro: el faro (OnAir) és la font de veritat
         * i l'ítem sense OnAir ha de quedar-se a la seva esquerra (2026-09-17).
         * @param {number} tSec - temps del faro (s de timeline)
         * @param {Array} clips - clips de V1 [{start,end}]
         * @returns {number} temps del tall anterior (< tSec)
         */
        _prevCutBefore: function (tSec, clips) {
            var arr = clips || [];
            var best = null;
            for (var i = 0; i < arr.length; i++) {
                var cs = arr[i].start, ce = arr[i].end;
                if (isFinite(cs) && cs < tSec - 0.05 && (best === null || cs > best)) best = cs;
                if (isFinite(ce) && ce < tSec - 0.05 && (best === null || ce > best)) best = ce;
            }
            if (best === null) best = Math.max(0, tSec - 2.0);
            return best;
        },

        /**
         * _seqOrderForItems: Retorna els nums dels ítems indicats en ORDRE
         * D'ESCALETA (camp `sequencia` del manifest), mai en ordre TC.
         * És la base per garantir que un ítem sense OnAir no quedi a la dreta
         * d'un faro que l'escaleta situa després (2026-09-17).
         * @param {object} manifest
         * @param {Array} lines - línies del bloc (poden venir en ordre TC)
         * @param {object} numSet - { num: true } dels ítems a considerar
         * @returns {Array<string>} nums ordenats i sense duplicats
         */
        _seqOrderForItems: function (manifest, lines, numSet) {
            var tmp = [];
            var all = (manifest && manifest.escaletaItems) ? manifest.escaletaItems : [];
            for (var i = 0; i < all.length; i++) {
                var it = all[i];
                if (!it || !it.num) continue;
                var nk = String(it.num);
                if (numSet && !numSet[nk]) continue;
                tmp.push({ num: nk, seq: (it.sequencia != null && isFinite(Number(it.sequencia))) ? Number(it.sequencia) : i });
            }
            if (tmp.length === 0) {
                // Fallback: ordre rebut (pitjor, però mai pitjor que abans)
                var arr = lines || [];
                for (var j = 0; j < arr.length; j++) {
                    if (arr[j].num && (!numSet || numSet[String(arr[j].num)])) tmp.push({ num: String(arr[j].num), seq: j });
                }
            }
            tmp.sort(function (a, b) { return a.seq - b.seq; });
            var out = [];
            var seen = {};
            for (var k = 0; k < tmp.length; k++) {
                if (seen[tmp[k].num]) continue;
                seen[tmp[k].num] = true;
                out.push(tmp[k].num);
            }
            return out;
        },

        /**
         * _chooseSnapTarget: Tria a quin punt s'ha d'ancorar un marcador.
         *  - FARO (ítem amb OnAir real): ruptura de densitat (prioritària) o tall real
         *    més proper, dins de la finestra curta (±0,6 s).
         *  - DEDUÏT (ítem sense OnAir → F2): s'ancora al TALL QUE OBRE el seu ítem
         *    (el que es veu com "entrada per tall"), i si no n'hi ha, a la ruptura de
         *    densitat o al tall més proper, dins de la finestra ampla (±2,5 s).
         * @param {number} markerTime - posició actual del marcador (s de timeline)
         * @param {number} win - finestra de cerca en segons
         * @param {boolean} isDeduced
         * @param {Array} breaks - ruptures de densitat [{time}]
         * @param {Array} clips - clips de V1 [{start,end}]
         * @returns {{target:number|null, why:string}}
         */
        _chooseSnapTarget: function (markerTime, win, isDeduced, breaks, clips) {
            var bl = breaks || [], cl = clips || [];
            var bestBreak = null;
            for (var bi = 0; bi < bl.length; bi++) {
                if (!isFinite(bl[bi].time)) continue;
                var dB = Math.abs(bl[bi].time - markerTime);
                if (dB <= win && (bestBreak === null || dB < Math.abs(bestBreak - markerTime))) bestBreak = bl[bi].time;
            }
            var nearest = null, nearestDist = null;      // tall real més proper (start o end)
            var openCut = null, openDist = null;         // tall que OBRIRIA l'ítem (start >= marcador)
            for (var ci = 0; ci < cl.length; ci++) {
                var cs = cl[ci].start, ce = cl[ci].end;
                if (isFinite(cs)) {
                    var ds = Math.abs(cs - markerTime);
                    if (ds <= win && (nearest === null || ds < nearestDist)) { nearest = cs; nearestDist = ds; }
                    if (cs >= markerTime - 0.05 && ds <= win && (openCut === null || ds < openDist)) { openCut = cs; openDist = ds; }
                }
                if (isFinite(ce)) {
                    var de = Math.abs(ce - markerTime);
                    if (de <= win && (nearest === null || de < nearestDist)) { nearest = ce; nearestDist = de; }
                }
            }
            if (isDeduced) {
                if (openCut !== null) return { target: openCut, why: "tall d'obertura" };
                if (bestBreak !== null && (nearest === null || Math.abs(bestBreak - markerTime) <= nearestDist)) {
                    return { target: bestBreak, why: 'ruptura de densitat' };
                }
                if (nearest !== null) return { target: nearest, why: 'tall real' };
                return { target: null, why: '' };
            }
            if (bestBreak !== null && (nearest === null || Math.abs(bestBreak - markerTime) <= nearestDist)) {
                return { target: bestBreak, why: 'ruptura de densitat' };
            }
            // FARO: el tall que OBRE la peca es el punt cert (2026-09-17).
            // La deriva entre l'hora d'emissio i el tall real es ~1,0-1,3 s, i amb la
            // finestra curta (±1,0 s) els faros quedaven FORA del tall (01: 36,64 vs
            // 37,72; 02: 112,64 vs 113,92; 03: 138,64 vs 139,68). Amb el tall
            // d'obertura el marcador cau a l'inici real de la seva peca.
            if (openCut !== null) return { target: openCut, why: "tall d'obertura" };
            if (nearest !== null) return { target: nearest, why: 'tall real' };
            return { target: null, why: '' };
        },

        // ═══════════════════════════════════════════════════════════════
        // 🟠 F4: snapFaroMarkers — Snap dels marcadors al TALL REAL més
        // proper (o a la ruptura de densitat DP+DIR), finestra ±0,6 s
        // ═══════════════════════════════════════════════════════════════
        snapFaroMarkers: async function () {
            log('🟠 [F4·Faro] Iniciant snap dels marcadors al tall real més proper...');

            const clips = await getClipsLogic().getTrackClips(1, 'video');
            if (!clips || clips.length === 0) {
                log('⚠️ [F4·Faro] No hi ha clips a V1.');
                return;
            }

            // Ruptures de densitat (multi-senyal); les de parell DP+DIR són prioritàries
            const densityData = this._calcDensityFootprint(clips);
            const breaks = (densityData && densityData.breaks) ? densityData.breaks : [];
            log('   🟠 [F4·Faro] Ruptures de densitat: ' + breaks.length +
                (breaks.length ? ' → ' + breaks.map(function (b) { return b.time.toFixed(2) + 's' + (b.dpDirPair ? '[DP+DIR]' : ''); }).join(', ') : ''));

            var markersRaw = await callJSX('Markers.get()');
            var existingMarkers = [];
            if (markersRaw && markersRaw !== '[]') {
                try { existingMarkers = JSON.parse(markersRaw); } catch (e) { }
            }
            log('   🟠 [F4·Faro] Marcadors existents: ' + existingMarkers.length);

            // Finestra per a faros: configurable (per defecte 1,0 s) per absorbir
            // l'error del Δ de correlació de F3 (cas real: 01 a 0,72 s del seu tall).
            var SEARCH_WINDOW = this._snapWindowFaro();
            var MIN_MOVE = 0.02;

            // ── Tipus de marcador: FARO (ítem amb OnAir real) o DEDUÏT (sense OnAir) ──
            // Els deduïts (F2) arrosseguen l'error de les durades d'escaleta (1-3 s) i
            // necessiten una finestra de snap més ampla. Els faros es queden amb la
            // curta per no moure'ls de la seva hora real d'emissió.
            // Només es considera "deduït" si consta a l'escaleta que l'ítem NO té OnAir
            // (si el mapa no es pot llegir, tots es tracten com a faro → conservador).
            var hasOnAirByNum = {};
            try {
                var ctxF4 = await getAssemblyContext().loadAssemblyContext();
                var linesF4 = (ctxF4 && ctxF4.lines) ? ctxF4.lines : [];
                hasOnAirByNum = this._buildOnAirMap(linesF4);
                var nFaro = 0, nDed = 0;
                for (var kx in hasOnAirByNum) { if (hasOnAirByNum[kx]) nFaro++; else nDed++; }
                log('   🟠 [F4·Faro] Finestra deduïts = ±' + this._snapWindowDeduced().toFixed(1) + 's · nums amb OnAir: ' + nFaro + ' · sense OnAir (deduïts): ' + nDed);
            } catch (eT) {
                log('⚠️ [F4·Faro] Sense mapa OnAir (' + eT.message + ') → tots els marcadors com a faro');
            }

            var _extractPrefix = function (comment) {
                if (!comment) return '';
                var spaceDashIdx = comment.indexOf(' -');
                if (spaceDashIdx <= 0) return '';
                return comment.substring(0, spaceDashIdx).replace(/^\s+|\s+$/g, '');
            };

            var placements = [];
            var alreadyOk = 0;

            for (var mi = 0; mi < existingMarkers.length; mi++) {
                var mk = existingMarkers[mi];
                var markerTime = (typeof mk.time === 'number') ? mk.time : parseFloat(mk.time);
                if (isNaN(markerTime)) continue;
                if (markerTime < 0.01) continue;   // el marcador d'inici no es toca

                var comment = mk.comments || '';
                var prefix = _extractPrefix(comment);
                if (!prefix) continue;

                // DEDUÏT només si consta que l'ítem no té OnAir (si no, faro).
                var isDeduced = (hasOnAirByNum[prefix] === false);
                var win = isDeduced ? this._snapWindowDeduced() : SEARCH_WINDOW;

                var pick = this._chooseSnapTarget(markerTime, win, isDeduced, breaks, clips);
                var target = pick.target, why = pick.why;

                if (target === null || Math.abs(target - markerTime) < MIN_MOVE) { alreadyOk++; continue; }

                var mkColor = (typeof mk.color === 'number' && mk.color >= 0) ? mk.color : 6;
                placements.push({ prefix: prefix, timeSec: target, comment: comment, colorIdx: mkColor });
                log('   🟠 [F4·Faro] ' + prefix + (isDeduced ? ' (deduït, win ±' + win.toFixed(1) + 's)' : ' (faro)') + ': ' +
                    markerTime.toFixed(2) + 's → ' + target.toFixed(2) + 's (' + why + ', Δ=' + (target - markerTime).toFixed(3) + 's)');
            }

            if (placements.length === 0) {
                log('🟠 [F4·Faro] Cap marcador per ajustar (' + alreadyOk + ' ja correctes). ✓ FINALITZAT.');
                return;
            }

            var result = await this._safePlaceByPrefixes(placements, 'F4·Faro');
            log('🟠 [F4·Faro] Moguts: ' + (result.moved || 0) + ' | Ja correctes: ' + alreadyOk + '. ✓ FINALITZAT.');
        },

        // ═══════════════════════════════════════════════════════════════
        // ═══════════════════════════════════════════════════════════════
        // 🟢 F6: enforceMarkerOrder — L'ORDRE DE L'ESCALETA ÉS SAGRAT
        // ═══════════════════════════════════════════════════════════════
        /**
         * enforceMarkerOrder: Garanteix que els marcadors dels ítems ESTRUCTURALS
         * mantenen l'ordre de l'escaleta (camp `sequencia` del manifest).
         * Cap fase (F1-F5) pot deixar dos ítems estructurals creuats.
         *
         * Cas real 2026-09-17: el directe 01dir (sense OnAir) quedava DARRERE de
         * l'IPD 01, que a l'escaleta va DESPRÉS (seq 34 vs 35).
         *
         * Regles (acordades amb l'usuari):
         *  - El faro (ítem amb OnAir) és la font de veritat: NO es mou mai.
         *  - L'ítem sense OnAir que queda a la dreta d'un faro que l'escaleta
         *    situa després, es col·loca al TALL ANTERIOR d'aquest faro.
         *  - Gràfics i tótems queden exempts (es reparteixen com fins ara).
         *  - Entre dos ítems sense OnAir es manté l'ordre relatiu.
         *  - Si la inversió és entre dos faros, s'avisa i no es toca res.
         */
        enforceMarkerOrder: async function () {
            log('🟢 [F6·Ordre] Verificant l\'ordre dels marcadors estructurals (escaleta = sagrat)...');

            const ctxData = await getAssemblyContext().loadAssemblyContext();
            if (!ctxData) { log('⚠️ [F6·Ordre] loadAssemblyContext ha fallat.'); return; }
            const { manifest, lines, clips } = ctxData;

            var markersRaw = await callJSX('Markers.get()');
            var markers = [];
            try { markers = JSON.parse(markersRaw); } catch (e) { }
            if (!markers || markers.length === 0) { log('⚠️ [F6·Ordre] Cap marcador a la seqüència.'); return; }

            var hasOnAirByNum = this._buildOnAirMap(lines);

            // Ordre d'escaleta: num → sequencia (font: manifest.escaletaItems)
            var allEs = (manifest && manifest.escaletaItems) ? manifest.escaletaItems : [];
            var seqByNum = {};
            for (var i = 0; i < allEs.length; i++) {
                var it = allEs[i];
                if (!it || !it.num) continue;
                var nk = String(it.num);
                if (seqByNum[nk] == null) seqByNum[nk] = (it.sequencia != null && isFinite(Number(it.sequencia))) ? Number(it.sequencia) : i;
            }

            // Marcadors estructurals amb num conegut (gràfics/tótems exempts)
            var list = [];
            for (var mi = 0; mi < markers.length; mi++) {
                var mk = markers[mi];
                var t = (typeof mk.time === 'number') ? mk.time : parseFloat(mk.time);
                if (!isFinite(t)) continue;
                var pfx = this._extractPrefixFromComment(mk.comments);
                if (!pfx) continue;
                if (this._isGraphicByNum(pfx)) continue;
                if (seqByNum[pfx] == null) continue;
                list.push({
                    num: pfx, time: t, comment: mk.comments,
                    hasOnAir: hasOnAirByNum[pfx] === true,
                    color: (typeof mk.color === 'number' && mk.color >= 0) ? mk.color : 6
                });
            }
            if (list.length < 2) { log('🟢 [F6·Ordre] Pocs marcadors estructurals per verificar. ✓ FINALITZAT.'); return; }
            list.sort(function (a, b) { return seqByNum[a.num] - seqByNum[b.num]; });

            var placements = [];
            var prev = null;
            for (var li = 0; li < list.length; li++) {
                var cur = list[li];
                if (prev && cur.time < prev.time - 0.02) {
                    if (cur.hasOnAir && !prev.hasOnAir) {
                        // El faro mana: el deduït previ s'ha d'avançar (tall anterior).
                        var novaPrev = Math.min(this._prevCutBefore(cur.time, clips), cur.time - 0.5);
                        if (novaPrev < 0) novaPrev = 0;
                        log('   🔧 [F6·Ordre] Inversio: ' + prev.num + ' (' + prev.time.toFixed(2) + 's) va DESPRES de ' + cur.num +
                            ' (' + cur.time.toFixed(2) + 's) a la llista, pero l\'escaleta el situa ABANS. El faro ' + cur.num +
                            ' no es toca -> ' + prev.num + ' al tall anterior: ' + novaPrev.toFixed(2) + 's');
                        prev.time = novaPrev;
                        placements.push({ prefix: prev.num, timeSec: novaPrev, comment: prev.comment, colorIdx: prev.color });
                    } else if (!cur.hasOnAir && prev.hasOnAir) {
                        var novaCur = Math.max(prev.time + 0.5, this._prevCutBefore(cur.time, clips));
                        if (novaCur >= cur.time) novaCur = cur.time;
                        log('   🔧 [F6·Ordre] Inversio: ' + cur.num + ' (' + cur.time.toFixed(2) + 's) va ABANS de ' + prev.num +
                            ' (' + prev.time.toFixed(2) + 's), pero l\'escaleta el situa DESPRES -> ' + novaCur.toFixed(2) + 's');
                        cur.time = novaCur;
                        placements.push({ prefix: cur.num, timeSec: novaCur, comment: cur.comment, colorIdx: cur.color });
                    } else if (!cur.hasOnAir && !prev.hasOnAir) {
                        var novaCur2 = prev.time + 0.5;
                        log('   🔧 [F6·Ordre] Inversio entre deduits: ' + cur.num + ' passa a ' + novaCur2.toFixed(2) + 's (ordre relatiu)');
                        cur.time = novaCur2;
                        placements.push({ prefix: cur.num, timeSec: novaCur2, comment: cur.comment, colorIdx: cur.color });
                    } else {
                        log('   ⚠️ [F6·Ordre] Inversio entre DOS faros (' + prev.num + ' / ' + cur.num + '): no es toca res (OnAir = veritat).');
                    }
                }
                prev = cur;
            }

            if (placements.length === 0) { log('🟢 [F6·Ordre] Ordre correcte. ✓ FINALITZAT.'); return; }

            var result = await this._safePlaceByPrefixes(placements, 'F6·Ordre');
            log('🟢 [F6·Ordre] Corregits: ' + (result.placed || 0) + ' marcadors. ✓ FINALITZAT.');
        },


        // 🟢 F5: snapOrphanMarkers — Snap d'huérfans als talls més propers
        // ═══════════════════════════════════════════════════════════════
        snapOrphanMarkers: async function () {
            log('🟢 [F5·Orphans] Iniciant snap de marcadors huérfans...');

            const clips = await getClipsLogic().getTrackClips(1, 'video');
            if (!clips || clips.length === 0) {
                log('⚠️ [F5·Orphans] No hi ha clips a V1.');
                return;
            }

            var markersRaw = await callJSX('Markers.get()');
            var existingMarkers = [];
            if (markersRaw && markersRaw !== '[]') {
                try { existingMarkers = JSON.parse(markersRaw); } catch (e) {}
            }
            log('   🟢 [F5·Orphans] Marcadors existents: ' + existingMarkers.length);

            var moves = [];
            var SEARCH_WINDOW = 2.0;

            var _extractPrefix = function (comment) {
                if (!comment) return '';
                var spaceDashIdx = comment.indexOf(' -');
                if (spaceDashIdx <= 0) return '';
                return comment.substring(0, spaceDashIdx).replace(/^\s+|\s+$/g, '');
            };

            for (var mi = 0; mi < existingMarkers.length; mi++) {
                var mk = existingMarkers[mi];
                var markerTime = (typeof mk.time === 'number') ? mk.time : parseFloat(mk.time);
                if (isNaN(markerTime)) continue;

                var comment = mk.comments || '';
                var prefix = _extractPrefix(comment);
                if (!prefix) continue;

                var nearestDist = SEARCH_WINDOW + 999;
                var nearestCut = null;
                for (var ci = 0; ci < clips.length; ci++) {
                    var dStart = clips[ci].start - markerTime;
                    var dEnd = clips[ci].end - markerTime;
                    if (Math.abs(dStart) < Math.abs(nearestDist)) { nearestDist = dStart; nearestCut = clips[ci].start; }
                    if (Math.abs(dEnd) < Math.abs(nearestDist)) { nearestDist = dEnd; nearestCut = clips[ci].end; }
                }

                if (Math.abs(nearestDist) <= SEARCH_WINDOW && Math.abs(nearestDist) > 0.01) {
                    moves.push({ prefix: prefix, newTimeSec: nearestCut });
                    log('   🟢 [F5·Orphans] ' + prefix + ': ' + markerTime.toFixed(2) + 's → ' + nearestCut.toFixed(2) + 's (Δ=' + nearestDist.toFixed(3) + 's)');
                }
            }

            if (moves.length === 0) {
                log('🟢 [F5·Orphans] Cap marcador per moure. ✓ FINALITZAT.');
                return;
            }

            // BUG#F5: moveByPrefixes usa start.seconds = que NO refresca visualment.
            // Usar _safePlaceByPrefixes (delete+create) en lloc de moveByPrefixes.
            var placements = [];
            for (var mv = 0; mv < moves.length; mv++) {
                var mvPrefix = moves[mv].prefix;
                var foundMk = null;
                for (var fi = 0; fi < existingMarkers.length; fi++) {
                    if (_extractPrefix(existingMarkers[fi].comments || '') === mvPrefix) {
                        foundMk = existingMarkers[fi];
                        break;
                    }
                }
                var mkColor = (foundMk && typeof foundMk.color === 'number' && foundMk.color >= 0) ? foundMk.color : 6;
                placements.push({
                    prefix: mvPrefix,
                    timeSec: moves[mv].newTimeSec,
                    comment: foundMk ? (foundMk.comments || '') : '',
                    colorIdx: mkColor
                });
            }
            var result = await this._safePlaceByPrefixes(placements, 'F5·Orphans');
            log('🟢 [F5·Orphans] Moguts: ' + (result.moved || 0) + '. ✓ FINALITZAT.');
        },

        // ═══════════════════════════════════════════════════════════════
        // 🟢 F6: placeGraphicMarkers — Marcadors de gràfics
        // ═══════════════════════════════════════════════════════════════
        placeGraphicMarkers: async function () {
            log('🟢 [F6·Gràfics] Iniciant col·locació de marcadors gràfics...');

            const ctxData = await getAssemblyContext().loadAssemblyContext();
            if (!ctxData) { log('⚠️ [F6·Gràfics] loadAssemblyContext ha fallat.'); return; }
            const { manifest, reader, lines, clips } = ctxData;

            const classData = this._classifyItems(lines);
            const { structuralItems, graphicItems } = classData;

            if (graphicItems.length === 0) {
                log('🟢 [F6·Gràfics] Cap ítem gràfic al bloc. ✓ FINALITZAT.');
                return;
            }

            const anchors = this._calcTemporalAnchors(manifest, reader, structuralItems, clips);
            if (!anchors) { log('⚠️ [F6·Gràfics] _calcTemporalAnchors ha fallat.'); return; }
            const { anchorEfTimelineSec, anchorEfectiva } = anchors;

            // ── Llegir marcadors existents per trobar marcadors "pare" ──
            var markersRaw = await callJSX('Markers.get()');
            var existingMarkers = [];
            if (markersRaw && markersRaw !== '[]') {
                try { existingMarkers = JSON.parse(markersRaw); } catch (e) {}
            }

            // Construir mapa de marcadors pare per baseNum
            // Estrategia D11v2: prioriza sufixos estructurals (i > dp > dir)
            // Sols items de plato (intro/donapas/directe) son pares validos
            // Items de video (faros, sin sufixo) NUNCA son pares
            var PRIORITY_SUFFIXES = ['i', 'dp', 'dir'];
            var markersByExactPrefix = {};
            var markersByBaseNum = {};
            for (var mi = 0; mi < existingMarkers.length; mi++) {
                var mk = existingMarkers[mi];
                var comment = mk.comments || '';
                var spaceDashIdx = comment.indexOf(' -');
                if (spaceDashIdx <= 0) continue;
                var prefix = comment.substring(0, spaceDashIdx).replace(/^\s+|\s+$/g, '');
                var bnMatch = prefix.match(/^(\d+)/);
                if (!bnMatch) continue;
                var bn = bnMatch[1];
                var mkTime = (typeof mk.time === 'number') ? mk.time : parseFloat(mk.time);
                if (isNaN(mkTime)) continue;
                if (!markersByExactPrefix[prefix] || mkTime < markersByExactPrefix[prefix]) {
                    markersByExactPrefix[prefix] = mkTime;
                }
                if (!markersByBaseNum[bn]) markersByBaseNum[bn] = [];
                markersByBaseNum[bn].push(mkTime);
            }
            var parentMarkerByPrefix = {};
            for (var bn in markersByBaseNum) {
                if (!markersByBaseNum.hasOwnProperty(bn)) continue;
                var found = false;
                for (var pi = 0; pi < PRIORITY_SUFFIXES.length; pi++) {
                    var candidateKey = bn + PRIORITY_SUFFIXES[pi];
                    if (candidateKey in markersByExactPrefix) {
                        parentMarkerByPrefix[bn] = markersByExactPrefix[candidateKey];
                        found = true;
                        break;
                    }
                }
                if (!found && bn in markersByExactPrefix) {
                    parentMarkerByPrefix[bn] = markersByExactPrefix[bn];
                    found = true;
                }
                if (!found && markersByBaseNum[bn].length > 0) {
                    var structuralTimes = [];
                    for (var bi = 0; bi < markersByBaseNum[bn].length; bi++) {
                        for (var sk in markersByExactPrefix) {
                            if (markersByExactPrefix.hasOwnProperty(sk) && markersByExactPrefix[sk] === markersByBaseNum[bn][bi]) {
                                var suff = sk.replace(/^\d+/, '').toLowerCase();
                                if (PRIORITY_SUFFIXES.indexOf(suff) >= 0 || suff === '') {
                                    structuralTimes.push(markersByBaseNum[bn][bi]);
                                }
                                break;
                            }
                        }
                    }
                    if (structuralTimes.length > 0) {
                        structuralTimes.sort(function(a,b) { return a - b; });
                        parentMarkerByPrefix[bn] = structuralTimes[0];
                    }
                }
            }

            log('   🟢 [F6·Gràfics] Marcadors pare disponibles: ' + Object.keys(parentMarkerByPrefix).length + ' (' + Object.keys(parentMarkerByPrefix).join(', ') + ')');

            // ── Precalcular quants gràfics hi ha per cada baseNum ──
            var totalGraphicCount = {};
            for (var gi = 0; gi < graphicItems.length; gi++) {
                var gNumPre = String(graphicItems[gi].num || '');
                var gMatch = gNumPre.match(/^(\d+)/);
                var gBn = gMatch ? gMatch[1] : null;
                if (gBn) totalGraphicCount[gBn] = (totalGraphicCount[gBn] || 0) + 1;
            }

            // Construir mapa del següent marcador després del pare
            var allMarkerTimes = [];
            for (var mi2 = 0; mi2 < existingMarkers.length; mi2++) {
                var mt = (typeof existingMarkers[mi2].time === 'number') ? existingMarkers[mi2].time : parseFloat(existingMarkers[mi2].time);
                if (!isNaN(mt)) allMarkerTimes.push(mt);
            }
            allMarkerTimes.sort(function(a,b) { return a - b; });
            var nextMarkerTime = {};
            for (var bn2 in parentMarkerByPrefix) {
                if (!parentMarkerByPrefix.hasOwnProperty(bn2)) continue;
                var pt = parentMarkerByPrefix[bn2];
                for (var nti = 0; nti < allMarkerTimes.length; nti++) {
                    if (allMarkerTimes[nti] > pt + 0.5) {
                        nextMarkerTime[bn2] = allMarkerTimes[nti];
                        break;
                    }
                }
            }

            var graphicCountByPrefix = {};
            var placements = [];

            for (var gi2 = 0; gi2 < graphicItems.length; gi2++) {
                var gItem = graphicItems[gi2];
                var gNum = String(gItem.num || '');
                var gNumMatch2 = gNum.match(/^(\d+)/);
                var gBaseNum = gNumMatch2 ? gNumMatch2[1] : null;
                var idealPosSec = null;

                if (gBaseNum && gBaseNum in parentMarkerByPrefix) {
                    var parentTime = parentMarkerByPrefix[gBaseNum];
                    var totalN = totalGraphicCount[gBaseNum] || 1;
                    var idx = graphicCountByPrefix[gBaseNum] || 0;
                    var parentEnd = nextMarkerTime[gBaseNum];
                    if (typeof parentEnd !== 'number' || parentEnd <= parentTime) {
                        parentEnd = parentTime + 10;
                    }
                    var totalDur = parentEnd - parentTime;
                    // D13: N+2 segments. Marker i at parentTime + (i+2) × segmentDur.
                    // Minimum: 10s first gap, 5s between markers if space permits.
                    var MIN_FIRST_GAP = 10;
                    var MIN_MARKER_GAP = 5;
                    var needed = MIN_FIRST_GAP + totalN * MIN_MARKER_GAP;
                    var firstGap, markerGap;
                    if (totalDur >= needed) {
                        firstGap = MIN_FIRST_GAP;
                        markerGap = MIN_MARKER_GAP;
                    } else {
                        var segmentDur = totalDur / (totalN + 2);
                        firstGap = 2 * segmentDur;
                        markerGap = segmentDur;
                    }
                    idealPosSec = parentTime + firstGap + (markerGap * idx);
                    graphicCountByPrefix[gBaseNum] = idx + 1;
                    log('   🟢 [F6·Gràfics] ' + gNum + ': anclat al pare ' + gBaseNum + ' (' + parentTime.toFixed(2) + 's) → end=' + parentEnd.toFixed(2) + 's, gap=' + markerGap.toFixed(2) + 's [' + (idx+1) + '/' + totalN + ']');
                } else {
                    var refSec = null;
                    var onAir3 = gItem.horaEntradaOnAir;
                    var hasOnAir3 = onAir3 && onAir3 !== '00:00:00' && onAir3.trim() !== '';
                    if (hasOnAir3) { refSec = reader.tcToSeconds(onAir3); }
                    if (refSec === null || refSec === undefined) {
                        var prevista2 = gItem.horaEntradaPrevista;
                        if (prevista2 && prevista2 !== '00:00:00') { refSec = reader.tcToSeconds(prevista2); }
                    }
                    if (refSec === null || refSec === undefined) {
                        log('   ⚠️ [F6·Gràfics] ' + gNum + ': sense TC de referència ni marcador pare. Saltant.');
                        continue;
                    }
                    idealPosSec = anchorEfTimelineSec + (refSec - anchorEfectiva);
                    log('   🟢 [F6·Gràfics] ' + gNum + ': FALLBACK escaleta → ' + idealPosSec.toFixed(2) + 's');
                }

                if (idealPosSec < 0) idealPosSec = 0;
                var safeT = idealPosSec;
                var titol = (gItem.titol || '').substring(0, 60);
                var comment2 = (gNum ? gNum + ' - ' : '') + titol;
                comment2 = comment2.trim();

                log('   🟢 [F6·Gràfics] ' + gNum + ': → ' + safeT.toFixed(2) + 's');
                placements.push({ prefix: gNum, timeSec: parseFloat(safeT.toFixed(2)), comment: comment2, colorIdx: 4 });
            }

            if (placements.length === 0) {
                log('🟢 [F6·Gràfics] Cap marcador gràfic per col·locar. ✓ FINALITZAT.');
                return;
            }

            var result = await this._safePlaceByPrefixes(placements, 'F6·Gràfics');
            log('🟢 [F6·Gràfics] Moguts: ' + (result.moved || 0) + ' | Nous: ' + (result.created || 0) + ' | Total: ' + (result.placed || 0) + '. ✓ FINALITZAT.');
        },

        // ═══════════════════════════════════════════════════════════════
        // ANÀLISI DE MARCADORS (migrats des de flow_graphics.js)
        // ═══════════════════════════════════════════════════════════════

        /**
         * dumpMarkersSnapshot: Desa un SNAPSHOT dels marcadors que hi ha ARA a la
         * seqüència (posició, comentari, color) a la carpeta del projecte:
         *   MARCADORS_<yyyy-mm-dd_hhmm>.txt   (llegible, per revisar a mà)
         *   MARCADORS_<yyyy-mm-dd_hhmm>.json  (cru, per comparar/diff)
         * Serveix per tenir constància de COM s'han col·locat abans de moure'ls a mà.
         * @returns {Promise<number>} nombre de marcadors desats, -1 si ha fallat
         */
        dumpMarkersSnapshot: async function () {
            try {
                var raw = await callJSX('Markers.get()');
                var list = [];
                if (raw && raw !== '[]') { try { list = JSON.parse(raw); } catch (e) { } }

                var folder = await callJSX('Context.folder()');
                if (!folder || String(folder).indexOf('ERR') === 0) {
                    log('⚠️ [SNAP] Sense carpeta de projecte: ' + folder);
                    return -1;
                }

                var d = new Date();
                var p2 = function (n) { return (n < 10 ? '0' : '') + n; };
                var stamp = d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) +
                    '_' + p2(d.getHours()) + p2(d.getMinutes());
                var base = String(folder).replace(/\\/g, '/') + '/MARCADORS_' + stamp;

                var tc = function (sec) {
                    var s = Math.max(0, sec || 0);
                    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
                    var ss = Math.floor(s % 60), ms = Math.round((s - Math.floor(s)) * 1000);
                    var pad = function (n, w) { var t = String(n); while (t.length < w) t = '0' + t; return t; };
                    return pad(h, 2) + ':' + pad(m, 2) + ':' + pad(ss, 2) + '.' + pad(ms, 3);
                };

                var txt = 'SNAPSHOT MARCADORS · ' + d.toISOString() + '\n' +
                    'Marcadors a la seqüència: ' + list.length + '\n' +
                    '------------------------------------------------------------\n' +
                    '#    segons      TC                color  comentari\n';
                for (var i = 0; i < list.length; i++) {
                    var m = list[i];
                    var t = (typeof m.time === 'number') ? m.time : parseFloat(m.time);
                    if (isNaN(t)) t = 0;
                    var col = (m.color !== undefined && m.color !== null) ? m.color : '-';
                    var cmt = (m.comments || m.comment || '').replace(/\r?\n/g, ' ');
                    txt += (i + 1) + '.\t' + t.toFixed(3) + '\t' + tc(t) + '\t' + col + '\t' + cmt + '\n';
                }

                var r1 = await callJSX("IO.writeTxt('" + base.replace(/'/g, "") + ".txt', '" + txt.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\r?\n/g, "\\n") + "')");
                var json = JSON.stringify({ capturedAt: d.toISOString(), count: list.length, markers: list }, null, 2);
                // Els salts de línia i les cometes simples han d'anar escapats: la crida
                // JSX és una línia de codi ExtendScript amb el contingut entre cometes.
                var jsonEsc = json.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\r?\n/g, "\\n");
                var r2 = await callJSX("IO.writeTxt('" + base.replace(/'/g, "") + ".json', '" + jsonEsc + "')");

                if (r1 === 'OK' || r2 === 'OK') {
                    log('💾 [SNAP] Snapshot desat: ' + list.length + ' marcadors → ' + base + '.txt/.json');
                    return list.length;
                }
                log('⚠️ [SNAP] No s\'ha pogut escriure el snapshot (' + r1 + ' / ' + r2 + ')');
                return -1;
            } catch (e) {
                log('⚠️ [SNAP] Error desant el snapshot: ' + e.message);
                return -1;
            }
        },

        placeCookedMarkers: async function() {
            if (!(await getUtils().validateActiveSequence())) return;
            log("📍 [MARKS Cocinado] Col·locant marcadors amb snap a cortes...");
            try {
                await FASTPASS_UI.Workflows.Markers.placeOnAirMarkers();
                await FASTPASS_UI.Workflows.Markers.placeDeducedOnAirMarkers();
                await FASTPASS_UI.Workflows.Markers.placeScheduledMarkers();

                const ctx = await FASTPASS_UI.Workflows.MainButton._setupContext();
                const analysis = await FASTPASS_UI.Logic.Analysis._load(
                    FASTPASS_UI.Logic.Analysis._getPath(ctx)
                );
                const marksCrudo = analysis.crudo || { markers: [] };

                const markersRaw = await callJSX("Markers.get()");
                var timelineMarkers = [];
                if (markersRaw && markersRaw !== "[]") {
                    try { timelineMarkers = JSON.parse(markersRaw); } catch (e) {}
                }

                var crudoMap = {};
                for (var i = 0; i < marksCrudo.markers.length; i++) {
                    var m = marksCrudo.markers[i];
                    crudoMap[m.num] = m;
                }

                var cookedMarkers = [];
                for (var j = 0; j < timelineMarkers.length; j++) {
                    var tm = timelineMarkers[j];
                    var comment = tm.comments || tm.comment || '';
                    if (comment === 'VALID_IN' || comment === 'VALID_OUT') continue;
                    var numMatch = comment.match(/^(\d+)/);
                    var num = numMatch ? numMatch[1] : '';
                    var titol = comment.replace(/^\d+\s*-\s*/, '').trim();
                    var crudoRef = crudoMap[num] || null;
                    cookedMarkers.push({
                        num: num, titol: titol,
                        posCocinado: tm.time,
                        deltaVsCrudo: crudoRef ? (tm.time - crudoRef.additPosSec) : 0
                    });
                }

                await FASTPASS_UI.Logic.Analysis.appendPhase(ctx, 'cocinado', {
                    markers: cookedMarkers, capturedAt: new Date().toISOString()
                });
                getUtils().status(cookedMarkers.length + " MARKS Cocinats", "exito");
            } catch (e) { getUtils().handleError(e, "placeCookedMarkers"); }
        },

        capturaUsuarioInOut: async function() {
            if (!(await getUtils().validateActiveSequence())) return;
            log("📍 [CAPTURA INOUT] Llegint VALID_IN/VALID_OUT del timeline...");
            try {
                const ctx = await FASTPASS_UI.Workflows.MainButton._setupContext();
                const analysis = await FASTPASS_UI.Logic.Analysis._load(
                    FASTPASS_UI.Logic.Analysis._getPath(ctx)
                );
                const inoutCocinado = analysis.cocinado || {};
                const markersRaw = await callJSX("Markers.get()");
                var markers = [];
                if (markersRaw && markersRaw !== "[]") {
                    try { markers = JSON.parse(markersRaw); } catch (e) {}
                }
                var validInPos = null, validOutPos = null;
                for (var i = 0; i < markers.length; i++) {
                    var m = markers[i];
                    var comment = (m.comments || m.comment || '').trim();
                    if (comment === 'VALID_IN') validInPos = m.time;
                    if (comment === 'VALID_OUT') validOutPos = m.time;
                }
                if (validInPos === null || validOutPos === null) {
                    log("⚠️ No s'han trobat els marcadors VALID_IN/VALID_OUT al timeline.");
                    getUtils().status("No hi ha marcadors de validació", "error");
                    return;
                }
                var deltaIn = inoutCocinado.validInMarker !== undefined ? (validInPos - inoutCocinado.validInMarker) : 0;
                var deltaOut = inoutCocinado.validOutMarker !== undefined ? (validOutPos - inoutCocinado.validOutMarker) : 0;
                await FASTPASS_UI.Logic.Analysis.appendPhase(ctx, 'usuario', {
                    validInMarker: validInPos, validOutMarker: validOutPos,
                    deltaVsCocinado_in: deltaIn, deltaVsCocinado_out: deltaOut,
                    capturedAt: new Date().toISOString()
                });
                getUtils().status("IN/OUT Usuari capturat", "exito");
            } catch (e) { getUtils().handleError(e, "capturaUsuarioInOut"); }
        },

        capturaUsuarioMarks: async function() {
            if (!(await getUtils().validateActiveSequence())) return;
            log("📍 [CAPTURA MARKS] Llegint marcadors del timeline...");
            try {
                const ctx = await FASTPASS_UI.Workflows.MainButton._setupContext();
                const analysis = await FASTPASS_UI.Logic.Analysis._load(
                    FASTPASS_UI.Logic.Analysis._getPath(ctx)
                );
                const marksCrudo = analysis.crudo || { markers: [] };
                const marksCocinado = analysis.cocinado || { markers: [] };

                const markersRaw = await callJSX("Markers.get()");
                var markers = [];
                if (markersRaw && markersRaw !== "[]") {
                    try { markers = JSON.parse(markersRaw); } catch (e) {}
                }

                var crudoMap = {};
                for (var i = 0; i < marksCrudo.markers.length; i++) {
                    var m = marksCrudo.markers[i]; crudoMap[m.num] = m;
                }
                var cocinadoMap = {};
                for (var j = 0; j < marksCocinado.markers.length; j++) {
                    var m = marksCocinado.markers[j]; cocinadoMap[m.num] = m;
                }

                var userMarkers = [];
                for (var k = 0; k < markers.length; k++) {
                    var tm = markers[k];
                    var comment = tm.comments || tm.comment || '';
                    if (comment === 'VALID_IN' || comment === 'VALID_OUT') continue;
                    var numMatch = comment.match(/^(\d+)/);
                    var num = numMatch ? numMatch[1] : '';
                    var titol = comment.replace(/^\d+\s*-\s*/, '').trim();
                    var crudoRef = crudoMap[num] || null;
                    var cocinadoRef = cocinadoMap[num] || null;
                    userMarkers.push({
                        num: num, titol: titol, posUsuario: tm.time,
                        deltaVsCocinado: cocinadoRef ? (tm.time - cocinadoRef.posColocada) : 0,
                        deltaVsCrudo: crudoRef ? (tm.time - crudoRef.additPosSec) : 0
                    });
                }
                await FASTPASS_UI.Logic.Analysis.appendPhase(ctx, 'usuario', {
                    markers: userMarkers, capturedAt: new Date().toISOString()
                });
                getUtils().status(userMarkers.length + " MARKS Usuari capturats", "exito");
            } catch (e) { getUtils().handleError(e, "capturaUsuarioMarks"); }
        },

        /**
         * runAplicarIpdDesdeMarkers: Revisa els markers de la seqüència i aplica la
         * configuració IPD (escala 144% + pos -94.5,562 + etiqueta) als clips de la
         * pista MP4 que comencen a cada marker IPD, sempre que el clip estigui ABANS
         * del següent marker d'estructura (color 1 o 6).
         * Un marker és "IPD" si és turquesa (color 7) o si el seu comentari/títol
         * conté "IPD" (els ítems IPD porten "IPD" al títol de l'escaleta).
         * Pensat per a l'automatització de COLOCAR (no cal seleccionar clip a clip).
         * @returns {number} Nombre de clips modificats
         */
        runAplicarIpdDesdeMarkers: async function () {
            if (!(await getUtils().validateActiveSequence())) return 0;
            try {
                const cfg = FASTPASS_UI.Config.get();
                const T_MP4 = cfg.tracks.video.mp4 || 1;

                // 1. Llegir markers (color: 7=IPD turquesa, 6=estructura blava, 1=estructura vermella)
                const markersRaw = await callJSX('Markers.get()');
                let markers = [];
                try { markers = JSON.parse(markersRaw || "[]"); } catch (eM) {}
                markers.sort(function (a, b) { return (a.time || 0) - (b.time || 0); });
                // IPD = marcador turquesa (color 7) o qualsevol marcador que tingui
                // "IPD" al comentari/títol (el pipeline ja comenta "num - títol" i els
                // ítems IPD porten "IPD" al títol). Així no depèn del color.
                const ipdMarkers = markers.filter(function (m) {
                    const comment = String(m.comments || m.title || '').toUpperCase();
                    return m.color === 7 || comment.indexOf('IPD') !== -1;
                });
                log(`📍 [IPD-MARKERS] ${markers.length} markers totals, ${ipdMarkers.length} IPD (turquesa o amb 'IPD' al títol)`);
                if (ipdMarkers.length === 0) {
                    getUtils().status("No hi ha markers IPD a la seqüència (turquesa o títol amb IPD)", "warn");
                    return 0;
                }

                // 2. Llegir clips de la pista MP4
                const dtRaw = await callJSX(`Clips.debugTracks('video')`);
                let vclips = [];
                try {
                    const dt = JSON.parse(dtRaw);
                    const tr = (dt.tracks || [])[T_MP4 - 1];
                    if (tr && tr.clips) vclips = tr.clips;
                } catch (eD) {}

                // 3. Per a cada marker IPD: clip amb start≈time, abans del següent marker d'estructura
                let modificats = 0;
                // Estats previs guardats perquè el botó IPD (toggle manual) pugui revertir
                // exacte un clip que hagi col·locat aquesta automatització.
                const states = (window.FASTPASS_UI._ipdStates = window.FASTPASS_UI._ipdStates || {});
                for (const m of ipdMarkers) {
                    const t = m.time || 0;
                    // El següent marcador ESTRUCTURAL és el primer marcador per davant que
                    // tingui comentari de ítem ("num - títol") o color blau (6): un cop
                    // aplicats els marcadors, els estructurales queden validats per l'usuari
                    // i no hem de dependre del color exacte (l'IPD pot ser ell mateix un
                    // marcador estructural blau amb "IPD" al títol).
                    const nextStruct = markers.find(function (x) {
                        if ((x.time || 0) <= t + 0.05) return false;
                        const cm = String(x.comments || x.title || '').trim();
                        return x.color === 6 || /^\d+[a-z]?\s*-\s*.+$/i.test(cm);
                    });
                    const lim = nextStruct ? (nextStruct.time || 0) : Infinity;
                    // TOTS els clips del TRAM: des del marcador IPD fins al següent marker
                    // d'estructura/bloc (l'ítem IPD pot estar trocejat en diversos clips).
                    const clipsTramo = vclips.filter(function (c) {
                        return c.start >= t - 1.0 && c.start < lim - 0.05;
                    });
                    if (clipsTramo.length === 0) {
                        log(`⚠️ [IPD-MARKERS] Marker IPD a ${t.toFixed(2)}s: cap clip al tram abans del següent marker d'estructura (${lim === Infinity ? 'fi' : lim.toFixed(2) + 's'})`, "WARN");
                        continue;
                    }
                    log(`🎯 [IPD-MARKERS] Marker IPD a ${t.toFixed(2)}s: ${clipsTramo.length} clip(s) al tram → ${lim === Infinity ? 'fi' : 'fins ' + lim.toFixed(2) + 's'}`);
                    for (const clip of clipsTramo) {
                        const stateKey = T_MP4 + ':' + clip.start.toFixed(3);
                        if (states[stateKey] === undefined) {
                            const curRaw = await callJSX(`Anim.getMotionValues(${T_MP4}, ${clip.index})`);
                            if (curRaw && String(curRaw).indexOf('ERR') !== 0) {
                                try {
                                    const c = JSON.parse(curRaw);
                                    states[stateKey] = {
                                        scale: c.scale, position: c.position, scaleWidth: c.scaleWidth,
                                        cropLeft: c.cropLeft, cropTop: c.cropTop, cropRight: c.cropRight, cropBottom: c.cropBottom
                                    };
                                } catch (eS) { }
                            }
                        }
                        const valsJson = JSON.stringify({ scale: 144, position: [-94.5, 562] });
                        const resM = await callJSX(`Anim.setMotionValues(${T_MP4}, ${clip.index}, '${valsJson}')`);
                        log(`🎬 [IPD-MARKERS] V${T_MP4}[${clip.index}] a ${clip.start.toFixed(2)}s (marker IPD ${t.toFixed(2)}s) → Motion ${resM}`);
                        modificats++;
                    }
                }
                getUtils().status(`IPD aplicat a ${modificats} clips des de markers`, modificats ? "exito" : "warn");
                return modificats;
            } catch (e) { getUtils().handleError(e, "runAplicarIpdDesdeMarkers"); return 0; }
        }
    };

    window.FASTPASS_UI.Workflows.Markers = FASTPASS_UI.Workflows.Markers;
})();