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

            if (structuralItems.length > 0) {
                var firstItem = structuralItems[0];
                var firstNum = firstItem.num;
                if (firstNum) {
                    var markersRaw2 = await callJSX('Markers.get()');
                    var allMarkers2 = [];
                    try { allMarkers2 = JSON.parse(markersRaw2); } catch (e) {}
                    var hasFirstItemMarker = false;
                    for (var mi2 = 0; mi2 < allMarkers2.length; mi2++) {
                        var mk2 = allMarkers2[mi2];
                        if (typeof mk2.time === 'number' && Math.abs(mk2.time) < 0.02) {
                            var mkPrefix2 = '';
                            var mkComment2 = mk2.comments || '';
                            var spaceDashIdx2 = mkComment2.indexOf(' -');
                            if (spaceDashIdx2 > 0) mkPrefix2 = mkComment2.substring(0, spaceDashIdx2).trim();
                            if (mkPrefix2 === String(firstNum)) { hasFirstItemMarker = true; break; }
                        }
                    }
                    if (!hasFirstItemMarker) {
                        var firstTitol = (firstItem.titol || '').substring(0, 60);
                        var firstComment = firstNum + ' - ' + firstTitol;
                        placements.push({ prefix: firstNum, timeSec: 0, comment: firstComment.trim(), colorIdx: 6 });
                        itemPositions.set(firstNum, 0);
                        log('🟠 [F2·Deducido] Forçant marcador 1r ítem ' + firstNum + ' a 00:00 (no existia)');
                    }
                }
            }

            for (var si = 0; si < structuralItems.length; si++) {
                var line = structuralItems[si];
                var onAir = line.horaEntradaOnAir;
                var hasOnAir = onAir && onAir !== '00:00:00' && onAir.trim() !== '';

                if (hasOnAir) continue; // F1 ja l'ha col·locat

                var deduced = reader._deduceOnAirEntrada(line, manifest.escaletaItems, null);
                if (deduced === null) continue;

                var idealPosSec = anchorEfTimelineSec + (deduced - anchorEfectiva);
                if (idealPosSec < 0) idealPosSec = 0;

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

                var targetSec = null;
                if (hasOnAir) {
                    targetSec = reader.tcToSeconds(onAir);
                } else {
                    var deduced2 = reader._deduceOnAirEntrada(line, manifest.escaletaItems, null);
                    if (deduced2 !== null) targetSec = deduced2;
                    else {
                        var prevista = line.horaEntradaPrevista;
                        if (prevista && prevista !== '00:00:00') targetSec = reader.tcToSeconds(prevista);
                    }
                }

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

        // ═══════════════════════════════════════════════════════════════
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

            var movesJson = JSON.stringify(moves);
            var resultRaw = await callJSX('Markers.moveByPrefixes(\'' + movesJson + '\')');
            var result = { moved: 0 };
            try { result = JSON.parse(resultRaw); } catch (e) {}

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

            // Construir mapa de marcadors pare per baseNum (número sense sufix)
            var parentMarkerByPrefix = {};
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
                if (!parentMarkerByPrefix[bn] || mkTime < parentMarkerByPrefix[bn]) {
                    parentMarkerByPrefix[bn] = mkTime;
                }
            }

            // ── També afegir temps dels ítems estructurals del bloc ──
            for (var si = 0; si < structuralItems.length; si++) {
                var sItem = structuralItems[si];
                var sNum = String(sItem.num || '');
                var sBnMatch = sNum.match(/^(\d+)/);
                if (!sBnMatch) continue;
                var sBn = sBnMatch[1];
                var onAir = sItem.horaEntradaOnAir;
                if (!onAir || onAir === '00:00:00' || onAir.trim() === '') continue;
                var sSec = reader.tcToSeconds(onAir);
                if (sSec === null || sSec === undefined) continue;
                var sTime = anchorEfTimelineSec + (sSec - anchorEfectiva);
                if (!parentMarkerByPrefix[sBn] || sTime < parentMarkerByPrefix[sBn]) {
                    parentMarkerByPrefix[sBn] = sTime;
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
                    var parentEnd = parentTime + 10;
                    if (nextMarkerTime[gBaseNum] && nextMarkerTime[gBaseNum] > parentTime && nextMarkerTime[gBaseNum] < parentEnd) {
                        parentEnd = nextMarkerTime[gBaseNum];
                    }
                    var totalDur = parentEnd - parentTime;
                    var firstGap = totalDur / 3;
                    var remainingDur = totalDur - firstGap;
                    var gap = remainingDur / totalN;
                    idealPosSec = parentTime + firstGap + (gap * idx);
                    graphicCountByPrefix[gBaseNum] = idx + 1;
                    log('   🟢 [F6·Gràfics] ' + gNum + ': anclat al marcador pare "' + gBaseNum + '" (' + parentTime.toFixed(2) + 's) → següent marker a ' + parentEnd.toFixed(2) + 's, gap=' + gap.toFixed(2) + 's [' + (idx+1) + '/' + totalN + ']');
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
        }
    };

    window.FASTPASS_UI.Workflows.Markers = FASTPASS_UI.Workflows.Markers;
})();