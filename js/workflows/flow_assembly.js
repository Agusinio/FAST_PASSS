/**
 * ============================================================================
 * WORKFLOW: ASSEMBLY (Montatge Automàtic i Orquestració) - v2.6.0 literal
 * ============================================================================
 */

(function () {
    var FASTPASS_UI = window.FASTPASS_UI || {};
    FASTPASS_UI.Workflows = FASTPASS_UI.Workflows || {};

    const getUtils = () => window.FASTPASS_UI.Utils;
    const getClipsLogic = () => window.FASTPASS_UI.Logic.Clips;
    const getParse = () => window.Parse;
    const getAssemblyLogic = () => window.FASTPASS_UI.Logic.Assembly;

    const log = (m) => getUtils().log(m, "DEBUG");
    const callJSX = (s) => getUtils().callJSX(s);

    // Función para formatear segundos a timecode (HH:MM:SS:FF) asumiendo 25 fps
    /*const formatTC = (seconds) => {
        const fps = 25;
        const totalFrames = Math.round(seconds * fps);
        const hh = Math.floor(totalFrames / (fps * 3600));
        const mm = Math.floor((totalFrames % (fps * 3600)) / (fps * 60));
        const ss = Math.floor((totalFrames % (fps * 60)) / fps);
        const ff = totalFrames % fps;
        return `${hh.toString().padStart(2, '0')}:${mm.toString().padStart(2, '0')}:${ss.toString().padStart(2, '0')}:${ff.toString().padStart(2, '0')}`;
    };*/

    const formatTC = (seconds) => {
        const fps = 25;
        // Una sola operación de punto flotante al inicio
        let totalFrames = Math.round(seconds * fps);

        // Extraemos unidades de derecha a izquierda (más eficiente)
        const ff = totalFrames % fps;
        const totalSeconds = (totalFrames / fps) | 0; // Bitwise OR para truncar (más rápido que Math.floor)

        const ss = totalSeconds % 60;
        const totalMinutes = (totalSeconds / 60) | 0;

        const mm = totalMinutes % 60;
        const hh = (totalMinutes / 60) | 0;

        // Retorno directo evitando funciones auxiliares para el padding
        return (hh < 10 ? '0' + hh : hh) + ":" +
            (mm < 10 ? '0' + mm : mm) + ":" +
            (ss < 10 ? '0' + ss : ss) + ":" +
            (ff < 10 ? '0' + ff : ff);
    };

    FASTPASS_UI.Workflows.Assembly = {

        // ── Estat intern: caché de diagnòstic de clips ──
        _clipsLogged: false,

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
            'td1', 'td2', 'td3', 'td4', 'td_01', 'td_02', 'td_at1',
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
                var raw = await callJSX('Markers.placeByPrefixes(\'' + JSON.stringify(placements) + '\')');
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
        // BUG #10: Autònom, sense dependre de parseDurada (local a _classifyItems).
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
        // SUB-FUNCIONS ATÒMIQUES per a setup estructural (Fase D0)
        //
        // Cada funció és independent: es pot cridar per separat segons
        // les necessitats de cada flux (F1-F6). Això evita executar
        // càlculs innecessaris (ex: F4 no necessita àncores temporals,
        // F6 no necessita DensityFootprint).
        //
        // Origen: descomposició de l'antic _setupEstructural() monolític.
        // ═══════════════════════════════════════════════════════════════

        /**
         * _loadAssemblyContext()
         * Carrega el manifest, reader, bloc actiu, línies d'escaleta,
         * clips V1 i referències. Primer pas obligatori per a qualsevol
         * flux que treballi amb el timeline.
         *
         * @returns {{ ctx, manifest, reader, targetBlock, lines,
         *            lineIndexByNum, clips, refFromManifest, refInPoint }}
         *          | null si falla la validació
         */
        _loadAssemblyContext: async function () {
            if (!(await getUtils().validateActiveSequence())) return null;
            log("📍 [_loadAssemblyContext] Carregant context...");

            // ── LOG DIAGNÒSTIC: Llista de clips en V1 (només el primer cop) ──
            if (!this._clipsLogged) {
                this._clipsLogged = true;
                try {
                    const v1Clips = await getClipsLogic().getTrackClips(1, "video");
                    log(`🎬 [DIAGNÒSTIC] Clips en V1: ${v1Clips.length} clips`);
                    v1Clips.forEach(function(c, i) {
                        log(`   V1[${i}] name="${c.name}" start=${c.start.toFixed(3)} end=${c.end.toFixed(3)} dur=${(c.end - c.start).toFixed(3)}`);
                    });
                } catch (clipErr) {
                    log(`⚠️ [DIAGNÒSTIC] No s'han pogut llegir els clips V1: ${clipErr.message}`);
                }
            }

            const ctx = FASTPASS_UI.State;
            if (!ctx.progData) {
                const config = FASTPASS_UI.Config.get();
                const progSelect = document.getElementById('programa');
                const blocSelect = document.getElementById('bloc');
                if (progSelect && progSelect.value && config.mapeoProgramas) {
                    ctx.progData = config.mapeoProgramas[progSelect.value];
                    ctx.bloque = blocSelect ? blocSelect.value : 'V1';
                    log("⚠️ [RECUPERAT] progData recuperat des del select.");
                } else {
                    log("⚠️ No es pot determinar el programa. Abortant.");
                    return null;
                }
            }

            if (!ctx.config) { ctx.config = FASTPASS_UI.Config.get(); }
            if (!ctx.dateDir) {
                log("⚠️ [_loadAssemblyContext] dateDir no disponible a State. Usant data del sistema com a fallback.");
                ctx.dateDir = getUtils().getFormattedDate().replace(/["\s]/g, "").trim();
            }

            const manifestPath = FASTPASS_UI.SessionManifest.getPath(ctx);
            log(`🔍 [_loadAssemblyContext] Cercant manifest a: ${manifestPath}`);
            const manifest = await FASTPASS_UI.SessionManifest.load(ctx);
            if (!manifest || !manifest.escaletaItems || manifest.escaletaItems.length === 0) {
                log("⚠️ No es troben items d'escaleta al manifest. Executa primer «Muntar».", "ERROR");
                return null;
            }

            const reader = window.EscaletaReader || window.FASTPASS_UI.EscaletaReader;
            const targetBlock = ctx.bloque.toLowerCase();

            let lines = manifest.escaletaItems.filter(l => {
                if (l.flotant === true) return false;
                const ag = l.agrupacio;
                return ag && ag.toString().toLowerCase() === targetBlock;
            });

            lines.sort((a, b) => {
                const horaA = a.horaEntradaOnAir || a.horaEntradaPrevista;
                const horaB = b.horaEntradaOnAir || b.horaEntradaPrevista;
                return reader.tcToSeconds(horaA) - reader.tcToSeconds(horaB);
            });

            const lineIndexByNum = {};
            for (let i = 0; i < lines.length; i++) {
                if (lines[i].num) lineIndexByNum[lines[i].num] = i;
            }

            log(`📋 Estructura des del manifest: ${lines.length} items per al bloc ${ctx.bloque}`);
            if (lines.length === 0) {
                log("⚠️ El bloc no té línies d'escaleta definides.", "WARN");
                return null;
            }

            const refFromManifest = manifest.ref;
            if (!refFromManifest || refFromManifest.mp4ExpandedInPoint === undefined || refFromManifest.mp4ExpandedInPoint === null) {
                log("⚠️ No es troba ref al manifest. Executa primer «Muntar».", "ERROR");
                return null;
            }
            const refInPoint = refFromManifest.mp4ExpandedInPoint;
            log(`📐 Ref del manifest: inPoint=${refInPoint.toFixed(2)}s (tier=${refFromManifest.InTier})`);

            const clips = await getClipsLogic().getTrackClips(1, "video");

            // â”€â”€ Detectar primer Ã­tem no agrupat (agrupacio:null) dins del rang del bloc â”€â”€
            var firstUngroupedItem = this._detectFirstUngroupedItem(manifest, reader, lines, targetBlock);
            if (firstUngroupedItem) {
                log(`ðŸ”´ [Ungrouped] Detectat primer Ã­tem no agrupat: ${firstUngroupedItem.num || '?'} - ${(firstUngroupedItem.titol || '').substring(0, 60)}`);
            }

            return { ctx, manifest, reader, targetBlock, lines, lineIndexByNum, clips, refFromManifest, refInPoint, firstUngroupedItem };
        },

        /**
         * _detectFirstUngroupedItem(manifest, reader, lines, targetBlock)
         * Escaneja manifest.escaletaItems per trobar el primer Ã­tem amb
         * agrupacio:null que caigui cronolÃ²gicament dins del rang del bloc.
         *
         * Cas d''Ãºs: blocs amb items intercalats no agrupats (ex: 02DP, 02Dir, 02
         * entre 555 i 03 del V2). Aquests items no es capturen amb el filtre
         * agrupacio===targetBlock perÃ² pertanyen al rang temporal del bloc.
         *
         * @param {Object} manifest - Manifest de sessiÃ³
         * @param {Object} reader - EscaletaReader
         * @param {Array} lines - LÃ­nies del bloc (filtrades per agrupacio)
         * @param {string} targetBlock - ID del bloc (ex: "v2")
         * @returns {Object|null} - Primer Ã­tem no agrupat o null
         */
        _detectFirstUngroupedItem: function (manifest, reader, lines, targetBlock) {
            if (!lines || lines.length === 0) return null;
            if (!manifest || !manifest.escaletaItems || manifest.escaletaItems.length === 0) return null;

            // â”€â”€ Rang temporal del bloc (segons la primera i Ãºltima lÃ­nia agrupada) â”€â”€
            var blockStartStr = lines[0].horaEntradaOnAir || lines[0].horaEntradaPrevista;
            var blockEndStr = lines[lines.length - 1].horaEntradaOnAir || lines[lines.length - 1].horaEntradaPrevista;
            if (!blockStartStr || !blockEndStr) return null;
            var blockStartSec = reader.tcToSeconds(blockStartStr);
            var blockEndSec = reader.tcToSeconds(blockEndStr);
            if (blockStartSec === null || blockEndSec === null) return null;

            // â”€â”€ Escanejar tots els items del manifest â”€â”€
            var allItems = manifest.escaletaItems;
            for (var i = 0; i < allItems.length; i++) {
                var item = allItems[i];
                if (item.flotant === true) continue;
                var ag = item.agrupacio;
                if (ag !== null && ag !== undefined) continue;  // TÃ© agrupacio â†’ no Ã©s orfe

                var itemTimeStr = item.horaEntradaOnAir || item.horaEntradaPrevista;
                if (!itemTimeStr) continue;
                var itemTimeSec = reader.tcToSeconds(itemTimeStr);
                if (itemTimeSec === null) continue;

                // Dins del rang del bloc?
                if (itemTimeSec >= blockStartSec && itemTimeSec <= blockEndSec) {
                    return item;  // Primer match
                }
            }
            return null;
        },

        /**
         * _calcDensityFootprint(clips)
         * Wrapper atòmic per a calcDensityFootprintV2.
         * Calcula zones de densitat, ruptures multi-senyal
         * i parells DP+DIR. Pur, sense efectes secundaris.
         *
         * @param {Array} clips - Clips V1 del timeline
         * @returns {Object} densityData { zones, breaks, dpDirPairs, totalDuration }
         */
        _calcDensityFootprint: function (clips) {
            return FASTPASS_UI.Logic.Assembly.calcDensityFootprintV2(clips);
        },

        /**
         * _classifyItems(lines)
         * Classifica les línies d'escaleta en 4 categories i retorna
         * els helpers de parsing necessaris per a la resta de fluxos.
         *
         * Categories:
         *   - structuralItems: ítems amb durada > 0 o agrupacio + OnAir
         *   - graphicItems:    sufixos gràfics (chy, gf, p2, td, ...)
         *   - farosItems:      structuralItems amb horaEntradaOnAir real
         *   - aproximadosItems: structuralItems sense OnAir (prevista/
         *                       deduïts o forçats per sufix)
         *
         * @param {Array} lines - Línies d'escaleta filtrades per bloc
         * @returns {{ structuralItems, graphicItems, farosItems,
         *            aproximadosItems, parseDurada,
         *            getEffectiveDuradaSec, getRawDuradaSec,
         *            isGraphicByNum, isForcedStructuralByNum }}
         */
        _classifyItems: function (lines) {
            // ─── HELPERS ───
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

            // ─── SUFFIXES (compartits via this._GRAPHIC_SUFFIXES / this._isGraphicByNum) ───
            // BUG #12: S'usa la font única de veritat per evitar duplicació
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

            // ─── CLASSIFICACIÓ D'ÍTEMS ───
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

            // ─── FAROS I APROXIMATS ───
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

        /**
         * _calcTemporalAnchors(manifest, reader, structuralItems, clips)
         * Calcula les 4 àncores temporals necessàries per projectar
         * TC d'emissió → temps de timeline.
         *
         * Tipus d'àncora:
         *   - anchorOnAirSec:  àncora absoluta del bloc (blockInSec)
         *   - anchorEfectiva:  millor àncora disponible (F2/F3)
         *   - refF1:           referència per al primer marcador OnAir
         *   - tlClipStartSec:  posició de F1 al timeline (via clip V1 real)
         *
         * BUG #3 FIX (2026-05-26): Llegeix clipStart i clipInPoint del clip
         * V1 real del timeline. Abans usava tlBlockInPointSec del manifest
         * (valor stale del moment de creació del projecte).
         *
         * @param {Object} manifest        - Manifest de sessió
         * @param {Object} reader          - EscaletaReader
         * @param {Array}  structuralItems - Ítems estructurals classificats
         * @param {Array}  [clips]         - Clips V1 del timeline (opcional, fallback a manifest)
         * @returns {{ tlClipStartSec, anchorOnAirSec, anchorSource,
         *            anchorEfectiva, anchorEfOrigen, refF1, refF1Origen,
         *            anchorEfTimelineSec, clipStart, clipInPoint }}
         *          | null si no hi ha àncora temporal
         */
        _calcTemporalAnchors: function (manifest, reader, structuralItems, clips) {
            // ─── DADES DEL CLIP V1 REAL (timeline) ───
            // BUG #3 FIX (2026-05-26): Llegim clipStart i clipInPoint del clip V1 real
            // en lloc de tlBlockInPointSec del manifest (valor stale del moment de creació).
            var clipStart = 0;
            var clipInPoint = manifest.ref.tlBlockInPointSec || 0; // fallback al manifest
            if (clips && clips.length > 0 && clips[0]) {
                clipStart = (typeof clips[0].start === 'number') ? clips[0].start : 0;
                if (clips[0].inPoint !== undefined && clips[0].inPoint !== null) {
                    clipInPoint = clips[0].inPoint;
                }
            }

            log('🔧 [BUG3·FIX] Clip V1 real: start=' + clipStart.toFixed(3) + 's, inPoint=' + clipInPoint.toFixed(3) + 's vs manifest tlBlockInPointSec=' + (manifest.ref.tlBlockInPointSec || 0).toFixed(3) + 's');

            // ─── DADES INVARIANTS DEL MANIFEST ───
            var worldSecMediaStart = manifest.ref.worldSecMediaStart || 0;

            // ─── ÀNCORA ONAIR (F1: cascada blockInSec → worldBlockAnchorSec → worldBlockStartSec) ───
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

            // ─── REFERÈNCIA F1 (primer ítem estructural amb OnAir) ───
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

            // ─── tlClipStartSec DINÀMIC per F1 ───
            // BUG #3 FIX (2026-05-26): Usem clipStart i clipInPoint reals del clip V1
            // en lloc de tlBlockInPointSec stale del manifest.
            // Fórmula: tlClipStartSec = clipStart + (refF1 - worldSecMediaStart) - clipInPoint
            // Així, F1: idealPosSec = tlClipStartSec + (itemOnAirSec - refF1)
            //      = clipStart + (itemOnAirSec - worldSecMediaStart) - clipInPoint  ✓
            var tlClipStartSec = clipStart + (refF1 - worldSecMediaStart) - clipInPoint;

            // ─── ÀNCORA EFECTIVA (compartida per F2 i F3) ───
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

            // ─── anchorEfTimelineSec DINÀMIC per F2/F3 ───
            // BUG #3 FIX (2026-05-26): Usem clipStart i clipInPoint reals.
            // Fórmula: anchorEfTimelineSec = clipStart + (anchorEfectiva - worldSecMediaStart) - clipInPoint
            // Així, F2: idealPosSec = anchorEfTimelineSec + (deduced - anchorEfectiva)
            //      = clipStart + (deduced - worldSecMediaStart) - clipInPoint  ✓
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
        // D1·CorrelationSnap: Algoritme de Δ consensuat
        //
        // Analitza múltiples marcadors OnAir/Deducido vs talls del
        // timeline. Si diversos marcadors comparteixen el mateix
        // desplaçament (Δ) respecte als talls, aquest Δ és el snap
        // correcte. Exclou el marcador a 00:00 del càlcul.
        //
        // Pesos: OnAir=1.0, Deducido=0.7, DensityBreak×1.5
        // Confiança mínima: 30%. Funció pura (sense efectes secundaris).
        // ═══════════════════════════════════════════════════════════════

        /**
         * _correlationSnap(markers, clips, densityData, manifestItems, reader)
         */
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
                var item = prefixToItem[prefix];
                var onAir = item.horaEntradaOnAir;
                if (onAir && onAir !== '00:00:00' && onAir.trim() !== '') return 'onAir';
                return 'deduced';
            };

            // ── Histograma de Δ ──
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

                // Buscar tall més proper (±SEARCH_WINDOW)
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

                // Bucket i pes
                var bucketIdx = Math.round(nearestDist / BUCKET_SIZE);
                var densityNear = _nearDensityBreak(markerTime);
                var w = baseWeight * (densityNear ? DENSITY_BONUS : 1.0);

                if (!histogram[bucketIdx]) histogram[bucketIdx] = { weight: 0, deltas: [] };
                histogram[bucketIdx].weight += w;
                histogram[bucketIdx].deltas.push(nearestDist);
                totalWeight += w;

                breakdown.push({ prefix: prefix, time: markerTime, type: markerType, delta: nearestDist, weight: w, densityNear: densityNear, used: true });
            }

            // ── Trobar el bucket amb més pes ──
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
                    // Mitjana dels Δ dins del bucket
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
        // _setupEstructural(): Convenience wrapper que crida les 4
        // sub-funcions atòmiques. Mantingut per compatibilitat amb codi
        // existent. Els nous fluxos (F1-F6) criden les sub-funcions
        // directament per evitar càlculs innecessaris.
        // ═══════════════════════════════════════════════════════════════
        _setupEstructural: async function () {
            log("📍 [_setupEstructural] Wrapper→ sub-funcions atòmiques...");

            const ctxData = await this._loadAssemblyContext();
            if (!ctxData) return null;
            const { ctx, manifest, reader, targetBlock, lines, lineIndexByNum, clips, refFromManifest, refInPoint } = ctxData;

            const densityData = this._calcDensityFootprint(clips);

            const classData = this._classifyItems(lines);
            const { structuralItems, graphicItems, farosItems, aproximadosItems, parseDurada, getEffectiveDuradaSec, getRawDuradaSec, isGraphicByNum, isForcedStructuralByNum } = classData;

            const anchors = this._calcTemporalAnchors(manifest, reader, structuralItems, clips);
            if (!anchors) return null;
            const { tlClipStartSec, anchorOnAirSec, anchorSource, anchorEfectiva, anchorEfOrigen, refF1, refF1Origen, anchorEfTimelineSec } = anchors;

            return {
                ctx, manifest, reader, targetBlock, lines, lineIndexByNum,
                clips, densityData, refFromManifest, refInPoint,
                structuralItems, graphicItems, farosItems, aproximadosItems,
                itemPositions: new Map(), placedMarkers: [],
                tlClipStartSec, anchorOnAirSec, anchorSource, anchorEfTimelineSec,
                anchorEfectiva, anchorEfOrigen, refF1, refF1Origen,
                parseDurada, getEffectiveDuradaSec, getRawDuradaSec,
                isGraphicByNum, isForcedStructuralByNum
            };
        },

        /**
         * 🟢 placeOnAirMarkers: Col·loca marcadors amb TC exacte d'emissió (OnAir).
         * Entry point per al botó F1 de la UI.
         * Usa sub-funcions atòmiques: _loadAssemblyContext, _classifyItems, _calcTemporalAnchors.
         * NO necessita _calcDensityFootprint.
         * Usa placeByPrefixes (upsert atòmic en JSX): mou existents, crea nous.
         */
        placeOnAirMarkers: async function () {
            log('🟢 [F1·OnAir] Iniciant col·locació independent...');

            // ── Pas 1: Carregar context ──
            const ctxData = await this._loadAssemblyContext();
            if (!ctxData) { log('⚠️ [F1·OnAir] _loadAssemblyContext ha fallat. Abortant.'); return; }
            const { manifest, reader, lines, clips, firstUngroupedItem } = ctxData;

            // ── Pas 2: Classificar ítems ──
            const classData = this._classifyItems(lines);
            const { structuralItems } = classData;

            // ── Pas 3: Calcular àncores (necessitem refF1 + tlClipStartSec) ──
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
                if (!hasOnAir) continue;

                var itemOnAirSec = reader.tcToSeconds(onAir);
                if (itemOnAirSec === null || itemOnAirSec === 0) continue;
                var idealPosSec = tlClipStartSec + (itemOnAirSec - refF1);
                if (idealPosSec < 0) idealPosSec = 0;

                var num = line.num || '?';
                var safeT = idealPosSec.toFixed(2);
                var titol = (line.titol || '').replace(/'/g, "\\'").substring(0, 60);
                var comment = (num ? num + ' - ' : '') + titol;
                comment = comment.trim();
                var colorIdx = this._getColorIdx(line);

                log('🔵 [F1·OnAir] ' + num + ': OnAir=' + itemOnAirSec.toFixed(1) + 's → timeline ' + safeT + 's  [Δ=' + (itemOnAirSec - refF1).toFixed(1) + 's]' + (idealPosSec === 0 && (itemOnAirSec - refF1) < 0 ? ' (→ 00:00)' : ''));

                placements.push({ prefix: num, timeSec: parseFloat(safeT), comment: comment, colorIdx: colorIdx });
                itemPositions.set(line.num, idealPosSec);
            }

            // ── BUG #4: Marcador per a ítem no agrupat (agrupacio:null) ──
            // BUG #12: Saltar ítems gràfics (ex: 18TE) — pertanyen a F6·Gràfics
            if (firstUngroupedItem && !this._isGraphicByNum(firstUngroupedItem.num)) {
                var ugOnAir = firstUngroupedItem.horaEntradaOnAir;
                var ugHasOnAir = ugOnAir && ugOnAir !== '00:00:00' && ugOnAir.trim() !== '';
                if (ugHasOnAir) {
                    var ugOnAirSec = reader.tcToSeconds(ugOnAir);
                    if (ugOnAirSec !== null && ugOnAirSec !== 0) {
                        var ugIdealPos = tlClipStartSec + (ugOnAirSec - refF1);
                        if (ugIdealPos < 0) ugIdealPos = 0;
                        var ugNum = firstUngroupedItem.num || '?';
                        var ugSafeT = ugIdealPos.toFixed(2);
                        var ugTitol = (firstUngroupedItem.titol || '').replace(/'/g, "\\'").substring(0, 60);
                        var ugComment = ugNum + ' - ' + ugTitol;
                        ugComment = ugComment.trim();
                        log('🔴 [F1·OnAir] UNGROUPED ' + ugNum + ': OnAir=' + ugOnAirSec.toFixed(1) + 's -> timeline ' + ugSafeT + 's');
                        placements.push({ prefix: ugNum, timeSec: parseFloat(ugSafeT), comment: ugComment, colorIdx: this._getColorIdx(firstUngroupedItem) });
                        itemPositions.set(firstUngroupedItem.num, ugIdealPos);
                    }
                }
            } else if (firstUngroupedItem && this._isGraphicByNum(firstUngroupedItem.num)) {
                log('🟢 [F1·OnAir] UNGROUPED ' + (firstUngroupedItem.num || '?') + ': ítem gràfic → F6·Gràfics (saltat)');
            }

            if (placements.length === 0) {
                log('🔵 [F1·OnAir] Cap marcador OnAir per col·locar. ✓ FINALITZAT.');
                return;
            }

            // UPSERT atòmic amb protecció d'errors (BUG #8)
            var result = await this._safePlaceByPrefixes(placements, 'F1·OnAir');
            log('🔵 [F1·OnAir] Moguts: ' + (result.moved || 0) + ' | Nous: ' + (result.created || 0) + ' | Total: ' + (result.placed || 0) + '. ✓ FINALITZAT.');
        },

        /**
         * 🟠 placeDeducedOnAirMarkers: Col·loca marcadors amb TC inferit (OnAirDeducido).
         * Entry point per al botó F2 de la UI.
         * Usa sub-funcions atòmiques: _loadAssemblyContext, _classifyItems, _calcTemporalAnchors.
         * NO necessita _calcDensityFootprint.
         * Usa placeByPrefixes (upsert atòmic en JSX): mou existents, crea nous.
         */
        placeDeducedOnAirMarkers: async function () {
            log('🟠 [F2·Deducido] Iniciant col·locació independent...');

            const ctxData = await this._loadAssemblyContext();
            if (!ctxData) { log('⚠️ [F2·Deducido] _loadAssemblyContext ha fallat. Abortant.'); return; }
            const { manifest, reader, lines, clips, firstUngroupedItem } = ctxData;

            const classData = this._classifyItems(lines);
            const { structuralItems } = classData;

            const anchors = this._calcTemporalAnchors(manifest, reader, structuralItems, clips);
            if (!anchors) { log('⚠️ [F2·Deducido] _calcTemporalAnchors ha fallat. Abortant.'); return; }
            // BUG #3 FIX (2026-05-26): anchorEfTimelineSec ja usa clipStart/clipInPoint reals
            const { anchorEfTimelineSec, anchorEfectiva } = anchors;

            var placements = [];
            var itemPositions = new Map();

            for (var si = 0; si < structuralItems.length; si++) {
                var line = structuralItems[si];
                var onAir = line.horaEntradaOnAir;
                var hasOnAir = onAir && onAir !== '00:00:00' && onAir.trim() !== '';
                if (hasOnAir) continue;

                var deduced = reader._deduceOnAirEntrada(line, manifest.escaletaItems, null);
                if (deduced === null) continue;

                // anchorEfTimelineSec = (anchorEfectiva - mediaStart) - tlBlockInPointSec
                // idealPosSec = anchorEfTimelineSec + (deduced - anchorEfectiva)
                //   = (deduced - mediaStart) - tlBlockInPointSec  ✓
                // BUG #15: Si aquest ítem és la font de l'àncora efectiva
                // (deduced ≈ anchorEfectiva), idealPosSec = anchorEfTimelineSec + 0.
                // Forcem 00:00 perquè l'inici del bloc és la posició esperada.
                var idealPosSec;
                if (Math.abs(deduced - anchorEfectiva) < 0.01) {
                    idealPosSec = 0;
                } else {
                    idealPosSec = anchorEfTimelineSec + (deduced - anchorEfectiva);
                    if (idealPosSec < 0) idealPosSec = 0;
                }

                var num = line.num || '?';
                var safeT = idealPosSec.toFixed(2);
                var titol = (line.titol || '').replace(/'/g, "\\'").substring(0, 60);
                var comment = (num ? num + ' - ' : '') + titol;
                comment = comment.trim();
                var colorIdx = this._getColorIdx(line);

                log('🟠 [F2·Deducido] ' + num + ': OnAirDeducido=' + deduced.toFixed(1) + 's → timeline ' + safeT + 's [rel]' + (idealPosSec === 0 && (deduced - anchorEfectiva) < 0 ? ' (TC negatiu → 00:00)' : ''));

                placements.push({ prefix: num, timeSec: parseFloat(safeT), comment: comment, colorIdx: colorIdx });
                itemPositions.set(line.num, idealPosSec);
            }

            // ── BUG #4: Marcador per a ítem no agrupat (agrupacio:null) ──
            // BUG #12: Saltar ítems gràfics (ex: 18TE) — pertanyen a F6·Gràfics
            if (firstUngroupedItem && !this._isGraphicByNum(firstUngroupedItem.num)) {
                var ugOnAir = firstUngroupedItem.horaEntradaOnAir;
                var ugHasOnAir = ugOnAir && ugOnAir !== '00:00:00' && ugOnAir.trim() !== '';
                if (!ugHasOnAir) {
                    var ugDeduced = reader._deduceOnAirEntrada(firstUngroupedItem, manifest.escaletaItems, null);
                    if (ugDeduced !== null) {
                        var ugIdealPos = anchorEfTimelineSec + (ugDeduced - anchorEfectiva);
                        if (ugIdealPos < 0) ugIdealPos = 0;
                        var ugNum = firstUngroupedItem.num || '?';
                        var ugSafeT = ugIdealPos.toFixed(2);
                        var ugTitol = (firstUngroupedItem.titol || '').replace(/'/g, "\\'").substring(0, 60);
                        var ugComment = ugNum + ' - ' + ugTitol;
                        ugComment = ugComment.trim();
                        log('🔴 [F2·Deducido] UNGROUPED ' + ugNum + ': OnAirDeducido=' + ugDeduced.toFixed(1) + 's -> timeline ' + ugSafeT + 's');
                        placements.push({ prefix: ugNum, timeSec: parseFloat(ugSafeT), comment: ugComment, colorIdx: this._getColorIdx(firstUngroupedItem) });
                        itemPositions.set(firstUngroupedItem.num, ugIdealPos);
                    }
                }
            } else if (firstUngroupedItem && this._isGraphicByNum(firstUngroupedItem.num)) {
                log('🟢 [F2·Deducido] UNGROUPED ' + (firstUngroupedItem.num || '?') + ': ítem gràfic → F6·Gràfics (saltat)');
            }

            if (placements.length === 0) {
                log('🟠 [F2·Deducido] Cap marcador per col·locar. ✓ FINALITZAT.');
                return;
            }

            var result = await this._safePlaceByPrefixes(placements, 'F2·Deducido');
            log('🟠 [F2·Deducido] Moguts: ' + (result.moved || 0) + ' | Nous: ' + (result.created || 0) + ' | Total: ' + (result.placed || 0) + '. ✓ FINALITZAT.');
        },

        /**
         * 🟡 placeScheduledMarkers: Col·loca marcadors amb horaPrevista com a fallback.
         * Entry point per al botó F3 de la UI.
         * Usa sub-funcions atòmiques: _loadAssemblyContext, _classifyItems, _calcTemporalAnchors.
         * NO necessita _calcDensityFootprint.
         * Usa placeByPrefixes (upsert atòmic en JSX): mou existents, crea nous.
         */
        placeScheduledMarkers: async function () {
            log('🟡 [F3·Prevista] Iniciant col·locació independent...');

            const ctxData = await this._loadAssemblyContext();
            if (!ctxData) { log('⚠️ [F3·Prevista] _loadAssemblyContext ha fallat. Abortant.'); return; }
            const { manifest, reader, lines, clips, firstUngroupedItem } = ctxData;

            const classData = this._classifyItems(lines);
            const { structuralItems } = classData;

            const anchors = this._calcTemporalAnchors(manifest, reader, structuralItems, clips);
            if (!anchors) { log('⚠️ [F3·Prevista] _calcTemporalAnchors ha fallat. Abortant.'); return; }
            // BUG #3 FIX (2026-05-26): anchorEfTimelineSec ja usa clipStart/clipInPoint reals
            const { anchorEfTimelineSec, anchorEfectiva } = anchors;

            var placements = [];
            var itemPositions = new Map();

            for (var si = 0; si < structuralItems.length; si++) {
                var line = structuralItems[si];
                var onAir = line.horaEntradaOnAir;
                var hasOnAir = onAir && onAir !== '00:00:00' && onAir.trim() !== '';
                if (hasOnAir) continue;

                var deduced = reader._deduceOnAirEntrada(line, manifest.escaletaItems, null);
                if (deduced !== null) continue;

                var prevista = line.horaEntradaPrevista;
                var hasPrevista = prevista && prevista !== '00:00:00';
                if (!hasPrevista) continue;

                var previstaSec = reader.tcToSeconds(prevista);
                if (previstaSec === null) continue;

                // anchorEfTimelineSec = (anchorEfectiva - mediaStart) - tlBlockInPointSec
                // idealPosSec = anchorEfTimelineSec + (previstaSec - anchorEfectiva)
                //   = (previstaSec - mediaStart) - tlBlockInPointSec  ✓
                var idealPosSec = anchorEfTimelineSec + (previstaSec - anchorEfectiva);
                if (idealPosSec < 0) idealPosSec = 0;

                var num = line.num || '?';
                var safeT = idealPosSec.toFixed(2);
                var titol = (line.titol || '').replace(/'/g, "\\'").substring(0, 60);
                var comment = (num ? num + ' - ' : '') + titol;
                comment = comment.trim();
                var colorIdx = this._getColorIdx(line);

                log('🟡 [F3·Prevista] ' + num + ': Prevista=' + previstaSec.toFixed(1) + 's → timeline ' + safeT + 's [rel]' + (idealPosSec === 0 && (previstaSec - anchorEfectiva) < 0 ? ' (TC negatiu → 00:00)' : ''));

                placements.push({ prefix: num, timeSec: parseFloat(safeT), comment: comment, colorIdx: colorIdx });
                itemPositions.set(line.num, idealPosSec);
            }

            // ── BUG #4: Marcador per a ítem no agrupat (agrupacio:null) ──
            // BUG #12: Saltar ítems gràfics (ex: 18TE) — pertanyen a F6·Gràfics
            if (firstUngroupedItem && !this._isGraphicByNum(firstUngroupedItem.num)) {
                var ugAlreadyPlaced = itemPositions.has(firstUngroupedItem.num);
                if (!ugAlreadyPlaced) {
                    var ugPrevista = firstUngroupedItem.horaEntradaPrevista;
                    var ugHasPrevista = ugPrevista && ugPrevista !== '00:00:00';
                    if (ugHasPrevista) {
                        var ugPrevistaSec = reader.tcToSeconds(ugPrevista);
                        if (ugPrevistaSec !== null) {
                            var ugIdealPos = anchorEfTimelineSec + (ugPrevistaSec - anchorEfectiva);
                            if (ugIdealPos < 0) ugIdealPos = 0;
                            var ugNum = firstUngroupedItem.num || '?';
                            var ugSafeT = ugIdealPos.toFixed(2);
                            var ugTitol = (firstUngroupedItem.titol || '').replace(/'/g, "\\'").substring(0, 60);
                            var ugComment = ugNum + ' - ' + ugTitol;
                            ugComment = ugComment.trim();
                            log('🔴 [F3·Prevista] UNGROUPED ' + ugNum + ': Prevista=' + ugPrevistaSec.toFixed(1) + 's -> timeline ' + ugSafeT + 's');
                            placements.push({ prefix: ugNum, timeSec: parseFloat(ugSafeT), comment: ugComment, colorIdx: this._getColorIdx(firstUngroupedItem) });
                            itemPositions.set(firstUngroupedItem.num, ugIdealPos);
                        }
                    }
                }
            } else if (firstUngroupedItem && this._isGraphicByNum(firstUngroupedItem.num)) {
                log('🟢 [F3·Prevista] UNGROUPED ' + (firstUngroupedItem.num || '?') + ': ítem gràfic → F6·Gràfics (saltat)');
            }

            if (placements.length === 0) {
                log('🟡 [F3·Prevista] Cap marcador per col·locar. ✓ FINALITZAT.');
                return;
            }

            var result = await this._safePlaceByPrefixes(placements, 'F3·Prevista');
            log('🟡 [F3·Prevista] Moguts: ' + (result.moved || 0) + ' | Nous: ' + (result.created || 0) + ' | Total: ' + (result.placed || 0) + '. ✓ FINALITZAT.');
        },

        // ═══════════════════════════════════════════════════════════════
        // D1·F3.5·CorrelationSnap: Δ de consens entre marcadors OnAir i
        // Deducidos contra talls del timeline.
        //
        // Només processa marcadors NO definitiws que siguin OnAir o
        // Deducido. Els Previstos NO es processen aquí (→ F4).
        //
        // Pipeline:
        //   1. _loadAssemblyContext        → clips, manifest, reader, lines
        //   2. _calcDensityFootprint(clips) → densityData (breaks)
        //   3. Markers.get                  → marcadors actuals
        //   4. Filtrar no-definitius + classificar OnAir/Deducido
        //   5. _correlationSnap(...)        → Δ consensuat
        //   6. Si confiança ≥ 30%: placeByPrefixes amb name:"definitiu"
        // ═══════════════════════════════════════════════════════════════

        /**
         * 🔵 correlationSnapMarkers: F3.5·CorrelationSnap
         * Entry point per al botó F3.5 de la UI.
         * Aplica Δ de consens NOMÉS a OnAir i Deducidos.
         * Usa _loadAssemblyContext, _calcDensityFootprint, _correlationSnap.
         * NO necessita _calcTemporalAnchors.
         */
        correlationSnapMarkers: async function () {
            log('🔷 [F3.5·CorrelationSnap] Iniciant snapeig per correlació (OnAir+Deducido)...');

            // ── Pas 1: Carregar context ──
            const ctxData = await this._loadAssemblyContext();
            if (!ctxData) { log('⚠️ [F3.5·CorrelationSnap] _loadAssemblyContext ha fallat. Abortant.'); return; }
            const { manifest, reader, lines, clips } = ctxData;

            // ── Pas 2: Calcular petjada de densitat ──
            const densityData = this._calcDensityFootprint(clips);
            log('   🔷 [F3.5·CorrelationSnap] DensityFootprint: ' + (densityData && densityData.breaks ? densityData.breaks.length : 0) + ' breaks.');

            // ── Pas 3: Obtenir marcadors actuals del timeline ──
            var markersRaw = await callJSX('Markers.get()');
            var allMarkers = [];
            try { allMarkers = JSON.parse(markersRaw); } catch (e) { allMarkers = []; }
            log('   🔷 [F3.5·CorrelationSnap] Marcadors al timeline: ' + allMarkers.length);

            // ── Pas 4: Filtrar només OnAir + Deducido (NO Previstos) ──
            // Construir prefix→item per classificar
            var manifestItems = manifest.escaletaItems || [];
            var prefixToItem = {};
            for (var ii = 0; ii < manifestItems.length; ii++) {
                var mItem = manifestItems[ii];
                if (mItem.num) prefixToItem[String(mItem.num)] = mItem;
            }

            var _extractPrefix35 = function (comment) {
                if (!comment) return '';
                var idx = comment.indexOf(' -');
                if (idx <= 0) return '';
                return comment.substring(0, idx).replace(/^\s+|\s+$/g, '');
            };

            var _isOnAirOrDeduced = function (prefix) {
                if (!prefix || !prefixToItem[prefix]) return false;
                var item = prefixToItem[prefix];
                var onAir = item.horaEntradaOnAir;
                if (onAir && onAir !== '00:00:00' && onAir.trim() !== '') return true; // OnAir
                var deduced = reader._deduceOnAirEntrada(item, manifestItems, null);
                if (deduced !== null) return true; // Deducido
                return false; // Previsto → NO processar
            };

            var candidateMarkers = [];
            var skippedPrevistos = 0;
            for (var i = 0; i < allMarkers.length; i++) {
                var mk = allMarkers[i];
                if (mk.name === 'definitiu') continue;
                var prefix = _extractPrefix35(mk.comments || '');
                if (_isOnAirOrDeduced(prefix)) {
                    candidateMarkers.push(mk);
                } else {
                    skippedPrevistos++;
                }
            }
            log('   🔷 [F3.5·CorrelationSnap] OnAir+Deducido: ' + candidateMarkers.length + ' | Previstos saltats: ' + skippedPrevistos + ' | Definitius ignorats: ' + (allMarkers.length - candidateMarkers.length - skippedPrevistos));

            if (candidateMarkers.length === 0) {
                log('🔷 [F3.5·CorrelationSnap] Cap marcador OnAir/Deducido no-definitiu. ✓ FINALITZAT.');
                return;
            }

            // ── Pas 5: CorrelationSnap → trobar Δ consensuat ──
            var snapResult = this._correlationSnap(candidateMarkers, clips, densityData, manifest.escaletaItems, reader);

            if (snapResult.delta === null) {
                log('🔷 [F3.5·CorrelationSnap] CorrelationSnap no ha trobat Δ fiable (confiança=' + (snapResult.confidence * 100).toFixed(0) + '%). ✓ FINALITZAT.');
                return;
            }

            // ── Pas 6: Aplicar Δ a cada marcador candidat ──
            var delta = snapResult.delta;
            log('   🔷 [F3.5·CorrelationSnap] Aplicant Δ=' + delta.toFixed(3) + 's a ' + candidateMarkers.length + ' marcadors...');

            var placements = [];
            for (var j = 0; j < candidateMarkers.length; j++) {
                var cmk = candidateMarkers[j];
                var cmkTime = (typeof cmk.time === 'number' ? cmk.time : parseFloat(cmk.time));
                // BUG #7: Preservar marcadors a ~0.00s sense aplicar Δ.
                // _correlationSnap els exclou del càlcul de l'histograma,
                // però correlationSnapMarkers aplicava Δ a tots els candidats.
                var correctedTime = (cmkTime < 0.01) ? 0 : (cmkTime + delta);
                if (correctedTime < 0) correctedTime = 0;

                var comment = cmk.comments || '';
                var prefix = _extractPrefix35(comment);

                if (!prefix) {
                    log('   ⚠️ [F3.5·CorrelationSnap] Marcador sense prefix detectable a ' + cmk.time + 's. Saltant.');
                    continue;
                }

                // BUG #14: Si el marcador existent no té color vàlid (pre-BUG #9),
                // derivar el color de l'ítem d'escaleta via _getColorIdx.
                var colorIdx = (typeof cmk.color === 'number' && cmk.color >= 0) ? cmk.color : null;
                if (colorIdx === null && prefixToItem[prefix]) {
                    colorIdx = this._getColorIdx(prefixToItem[prefix]);
                }
                placements.push({
                    prefix: prefix,
                    timeSec: correctedTime,
                    comment: comment,
                    name: 'definitiu',
                    colorIdx: colorIdx
                });

                log('   🔷 [F3.5·CorrelationSnap] ' + prefix + ': ' + cmk.time.toFixed(2) + 's → ' + correctedTime.toFixed(2) + 's [Δ=' + delta.toFixed(3) + 's]');
            }

            if (placements.length === 0) {
                log('🔷 [F3.5·CorrelationSnap] Cap placement construït. ✓ FINALITZAT.');
                return;
            }

            var result = await this._safePlaceByPrefixes(placements, 'F3.5·CorrelationSnap');
            log('🔷 [F3.5·CorrelationSnap] Moguts: ' + (result.moved || 0) + ' | Nous: ' + (result.created || 0) + ' | Total: ' + (result.placed || 0) + ' | Δ=' + delta.toFixed(3) + 's | confiança=' + (snapResult.confidence * 100).toFixed(0) + '%. ✓ FINALITZAT.');
        },

        // ═══════════════════════════════════════════════════════════════
        // D2·F4·DensitySnap v2: Matching seqüencial de marcadors
        // (Previstos + OnAir/Deducido orfes) contra punts d'inflexió
        // de densitat del timeline.
        //
        // ESTRATÈGIA (v2): El matching és per ORDRE, no per proximitat
        // temporal. El marcador N-èsim s'emparella amb el break N-èsim.
        // Si un marcador està a 30s del seu break, s'emparella igual.
        // Sense finestres de temps, sense llindars màgics.
        //
        // Per capes:
        //   - F3.5·CorrelationSnap: OnAir+Deducido → Δ consens (si falla → passen a F4)
        //   - F4·DensitySnap v2: Previstos + OnAir/Deducido orfes → matching seqüencial contra breaks
        //   - F5·OrphanSnap: marcadors sobrants (sense break) → ±2s cut snap
        //
        // Pipeline:
        //   1. _loadAssemblyContext        → clips, manifest, reader, lines
        //   2. _calcDensityFootprint(clips) → densityData (breaks ordenats)
        //   3. Markers.get                  → marcadors actuals
        //   4. Filtrar no-definitius: Previstos + OnAir/Deducido orfes
        //   5. Pool unificat ordenat per temps
        //   6. Matching seqüencial: candidate[j] → breaks[j].time
        //   7. Sobrants mantenen posició original (→ F5)
        //   8. placeByPrefixes amb name:"definitiu"
        // ═══════════════════════════════════════════════════════════════

        /**
         * 🔵 snapFaroMarkers: F4·DensitySnap v2
         * Entry point per al botó F4 de la UI.
         * Matching SEQÜENCIAL de marcadors (Previstos + OnAir/Deducido
         * orfes) contra punts d'inflexió de densitat del timeline.
         * El marcador N-èsim s'emparella amb el break N-èsim.
         * Sense finestres de temps ni type-matching.
         * Usa _loadAssemblyContext, _calcDensityFootprint.
         * NO necessita _calcTemporalAnchors ni _correlationSnap.
         */
        snapFaroMarkers: async function () {
            log('🔵 [F4·DensitySnap v2] Iniciant matching seqüencial (Previstos + OnAir/Deducido orfes)...');

            // ── Pas 1: Carregar context ──
            const ctxData = await this._loadAssemblyContext();
            if (!ctxData) { log('⚠️ [F4·DensitySnap v2] _loadAssemblyContext ha fallat. Abortant.'); return; }
            const { manifest, reader, lines, clips } = ctxData;

            // ── Pas 2: Calcular petjada de densitat ──
            const densityData = this._calcDensityFootprint(clips);
            const breaks = (densityData && densityData.breaks) ? densityData.breaks : [];
            log('   🔵 [F4·DensitySnap v2] DensityFootprint: ' + breaks.length + ' breaks.');

            // ── Pas 3: Obtenir marcadors actuals del timeline ──
            var markersRaw = await callJSX('Markers.get()');
            var allMarkers = [];
            try { allMarkers = JSON.parse(markersRaw); } catch (e) { allMarkers = []; }
            log('   🔵 [F4·DensitySnap v2] Marcadors al timeline: ' + allMarkers.length);

            // ── Pas 4: Filtrar no-definitius + classificar Previstos i OnAir/Deducido ──
            var manifestItems = manifest.escaletaItems || [];
            var prefixToItem = {};
            for (var ii = 0; ii < manifestItems.length; ii++) {
                var mItem = manifestItems[ii];
                if (mItem.num) prefixToItem[String(mItem.num)] = mItem;
            }

            var _extractPrefix = function (comment) {
                if (!comment) return '';
                var idx = comment.indexOf(' -');
                if (idx <= 0) return '';
                return comment.substring(0, idx).replace(/^\s+|\s+$/g, '');
            };

            var _isPrevisto = function (prefix) {
                if (!prefix || !prefixToItem[prefix]) return false;
                var item = prefixToItem[prefix];
                var onAir = item.horaEntradaOnAir;
                if (onAir && onAir !== '00:00:00' && onAir.trim() !== '') return false;
                var deduced = reader._deduceOnAirEntrada(item, manifestItems, null);
                if (deduced !== null) return false;
                var prevista = item.horaEntradaPrevista;
                return prevista && prevista !== '00:00:00';
            };

            // ── v2: També detectem OnAir/Deducido (orfes de F3.5) ──
            var _isOnAirOrDeduced = function (prefix) {
                if (!prefix || !prefixToItem[prefix]) return false;
                var item = prefixToItem[prefix];
                var onAir = item.horaEntradaOnAir;
                if (onAir && onAir !== '00:00:00' && onAir.trim() !== '') return true;
                var deduced = reader._deduceOnAirEntrada(item, manifestItems, null);
                if (deduced !== null) return true;
                return false;
            };

            // ── Classificar marcadors no-definitius en 3 categories ──
            var previstos = [];
            var orphanOnAirDeducido = [];
            var skippedOther = 0;
            var skippedDef = 0;
            for (var i = 0; i < allMarkers.length; i++) {
                var mk = allMarkers[i];
                if (mk.name === 'definitiu') { skippedDef++; continue; }
                var prefix = _extractPrefix(mk.comments || '');
                if (_isPrevisto(prefix)) {
                    previstos.push(mk);
                } else if (_isOnAirOrDeduced(prefix)) {
                    orphanOnAirDeducido.push(mk);
                } else {
                    skippedOther++;
                }
            }
            log('   🔵 [F4·DensitySnap v2] Previstos: ' + previstos.length + ' | OnAir/Deducido orfes: ' + orphanOnAirDeducido.length + ' | Altres: ' + skippedOther + ' | Definitius: ' + skippedDef);

            // ── Pool unificat: Previstos + OnAir/Deducido orfes, ordenats per temps ──
            var allCandidates = previstos.concat(orphanOnAirDeducido);
            allCandidates.sort(function (a, b) {
                var ta = (typeof a.time === 'number') ? a.time : parseFloat(a.time);
                var tb = (typeof b.time === 'number') ? b.time : parseFloat(b.time);
                return ta - tb;
            });
            log('   🔵 [F4·DensitySnap v2] Candidats totals (pool unificat): ' + allCandidates.length + ' | Breaks disponibles: ' + breaks.length);

            if (allCandidates.length === 0) {
                log('🔵 [F4·DensitySnap v2] Cap marcador candidat per processar. ✓ FINALITZAT.');
                return;
            }

            // ── Pas 5: Matching seqüencial candidate[j] → breaks[j].time ──
            var maxPairs = Math.min(allCandidates.length, breaks.length);
            var placements = [];
            var snappedCount = 0;
            var keptCount = 0;

            for (var j = 0; j < allCandidates.length; j++) {
                var mk = allCandidates[j];
                var mkTime = (typeof mk.time === 'number') ? mk.time : parseFloat(mk.time);
                var comment = mk.comments || '';
                var prefix = _extractPrefix(comment);

                if (!prefix) {
                    log('   ⚠️ [F4·DensitySnap v2] Marcador sense prefix a ' + mkTime.toFixed(2) + 's. Saltant.');
                    continue;
                }

                // Detectar font del marcador per al log
                var source = _isPrevisto(prefix) ? 'Previsto' : 'OnAir/Deducido';

                var targetTime;
                if (j < maxPairs) {
                    // Matching seqüencial: candidat[j] → break[j]
                    targetTime = breaks[j].time;
                    if (targetTime < 0) targetTime = 0;
                    snappedCount++;
                    log('   🔵 [F4·DensitySnap v2] ' + prefix + ' (' + source + '): ' + mkTime.toFixed(2) + 's → break[' + j + '] ' + targetTime.toFixed(2) + 's [matching=' + (j + 1) + '/' + maxPairs + ']');
                } else {
                    // Sense break disponible → manté posició original (F5 s'encarregarà)
                    targetTime = mkTime;
                    keptCount++;
                    log('   🔵 [F4·DensitySnap v2] ' + prefix + ' (' + source + '): ' + mkTime.toFixed(2) + 's → manté (sense break disponible, F5 pendent)');
                }

                // BUG #14: Si el marcador existent no té color vàlid (pre-BUG #9),
                // derivar el color de l'ítem d'escaleta via _getColorIdx.
                var colorIdxF4 = (typeof mk.color === 'number' && mk.color >= 0) ? mk.color : null;
                if (colorIdxF4 === null && prefixToItem[prefix]) {
                    colorIdxF4 = this._getColorIdx(prefixToItem[prefix]);
                }
                placements.push({
                    prefix: prefix,
                    timeSec: targetTime,
                    comment: comment,
                    name: 'definitiu',
                    colorIdx: colorIdxF4
                });
            }

            if (placements.length === 0) {
                log('🔵 [F4·DensitySnap v2] Cap placement construït. ✓ FINALITZAT.');
                return;
            }

            // UPSERT atòmic amb name:"definitiu" + protecció d'errors (BUG #8)
            var result = await this._safePlaceByPrefixes(placements, 'F4·DensitySnap v2');
            log('🔵 [F4·DensitySnap v2] Moguts: ' + (result.moved || 0) + ' | Nous: ' + (result.created || 0) + ' | Total: ' + (result.placed || 0) + ' | Snapejats: ' + snappedCount + ' | Mantinguts (→F5): ' + keptCount + '. ✓ FINALITZAT.');
        },

        // ═══════════════════════════════════════════════════════════════
        // D3·F5·OrphanSnap: Snapeig de marcadors no-definitius
        // (Previstos + huérfanos) contra talls del timeline.
        //
        // Flux no acumulatiu: només processa marcadors NO marcats com
        // "definitiu" (els que F4 no ha snapejat).
        //
        // Estratègia:
        //   - Previstos: snap a ruptura de densitat (±2s), fallback a tall
        //   - Huérfanos (resto): snap simple al tall més proper (±2s)
        //   - Sense tall dins la finestra: manté posició original
        //
        // Pipeline:
        //   1. _loadAssemblyContext        → clips, manifest, reader, lines
        //   2. _calcDensityFootprint(clips) → densityData (breaks)
        //   3. Markers.get                  → marcadors actuals
        //   4. Filtrar no-definitius (name !== "definitiu") en JS
        //   5. Classificar: Prevista vs orfe (via manifest.escaletaItems)
        //   6. Snap a break/cut segons tipus
        //   7. placeByPrefixes (sense name:"definitiu" — no bloqueja)
        // ═══════════════════════════════════════════════════════════════

        /**
         * 🟣 snapOrphanMarkers: F5·OrphanSnap
         * Entry point per al botó F5 de la UI.
         * Usa _loadAssemblyContext, _calcDensityFootprint.
         * NO necessita _calcTemporalAnchors ni _classifyItems complets.
         */
        snapOrphanMarkers: async function () {
            log('🟣 [F5·OrphanSnap] Iniciant snapeig de marcadors orfes...');

            // ── Pas 1: Carregar context ──
            const ctxData = await this._loadAssemblyContext();
            if (!ctxData) { log('⚠️ [F5·OrphanSnap] _loadAssemblyContext ha fallat. Abortant.'); return; }
            const { manifest, reader, lines, clips } = ctxData;

            // ── Pas 2: Density footprint (per ancorar Previstos a breaks) ──
            const densityData = this._calcDensityFootprint(clips);
            log('   🟣 [F5·OrphanSnap] DensityFootprint: ' + (densityData && densityData.breaks ? densityData.breaks.length : 0) + ' breaks.');

            // ── Pas 3: Obtenir marcadors del timeline ──
            var markersRaw = await callJSX('Markers.get()');
            var allMarkers = [];
            try { allMarkers = JSON.parse(markersRaw); } catch (e) { allMarkers = []; }
            log('   🟣 [F5·OrphanSnap] Marcadors al timeline: ' + allMarkers.length);

            // ── Pas 4: Filtrar NO definitius ──
            var nonDefinitive = [];
            for (var i = 0; i < allMarkers.length; i++) {
                if (allMarkers[i].name !== 'definitiu') {
                    nonDefinitive.push(allMarkers[i]);
                }
            }
            log('   🟣 [F5·OrphanSnap] No-definitius: ' + nonDefinitive.length + ' / ' + allMarkers.length);

            if (nonDefinitive.length === 0) {
                log('🟣 [F5·OrphanSnap] Cap marcador no-definitiu. ✓ FINALITZAT.');
                return;
            }

            // ── Pas 5: Build prefix→item per classificar Prevista vs orfe ──
            var manifestItems = manifest.escaletaItems || [];
            var prefixToItem = {};
            for (var ii = 0; ii < manifestItems.length; ii++) {
                var mItem = manifestItems[ii];
                if (mItem.num) prefixToItem[String(mItem.num)] = mItem;
            }

            var _extractPrefix = function (comment) {
                if (!comment) return '';
                var idx = comment.indexOf(' -');
                if (idx <= 0) return '';
                return comment.substring(0, idx).replace(/^\s+|\s+$/g, '');
            };

            var _isPrevista = function (prefix) {
                if (!prefix || !prefixToItem[prefix]) return false;
                var lineItem = prefixToItem[prefix];
                var onAir = lineItem.horaEntradaOnAir;
                var hasOnAir = onAir && onAir !== '00:00:00' && onAir.trim() !== '';
                if (hasOnAir) return false;
                var deduced = reader._deduceOnAirEntrada(lineItem, manifestItems, null);
                if (deduced !== null) return false;
                var prevista = lineItem.horaEntradaPrevista;
                return prevista && prevista !== '00:00:00';
            };

            // ── Helpers de snap ──
            var _findNearestCut = function (timeSec, windowSec) {
                var bestDist = windowSec + 999;
                for (var ci = 0; ci < clips.length; ci++) {
                    var dStart = clips[ci].start - timeSec;
                    var dEnd = clips[ci].end - timeSec;
                    if (Math.abs(dStart) < Math.abs(bestDist)) bestDist = dStart;
                    if (Math.abs(dEnd) < Math.abs(bestDist)) bestDist = dEnd;
                }
                if (Math.abs(bestDist) <= windowSec) return timeSec + bestDist;
                return timeSec;
            };

            var _findNearestBreak = function (timeSec, windowSec) {
                if (!densityData || !densityData.breaks || densityData.breaks.length === 0) return null;
                var bestDist = windowSec + 999;
                var bestBreakTime = null;
                for (var bi = 0; bi < densityData.breaks.length; bi++) {
                    var d = densityData.breaks[bi].time - timeSec;
                    if (Math.abs(d) < Math.abs(bestDist)) {
                        bestDist = d;
                        bestBreakTime = densityData.breaks[bi].time;
                    }
                }
                if (Math.abs(bestDist) <= windowSec) return timeSec + bestDist;
                return null;
            };

            // ── Pas 6: Snapejar cada marcador no-definitiu ──
            var SNAP_WINDOW = 2.0;
            var placements = [];
            var snappedCount = 0;
            var previstaCount = 0;
            var orfeCount = 0;

            for (var j = 0; j < nonDefinitive.length; j++) {
                var mk = nonDefinitive[j];
                var mkTime = (typeof mk.time === 'number') ? mk.time : parseFloat(mk.time);
                if (isNaN(mkTime)) continue;

                var comment = mk.comments || '';
                var prefix = _extractPrefix(comment);
                if (!prefix) {
                    log('   ⚠️ [F5·OrphanSnap] Sense prefix a ' + mkTime.toFixed(2) + 's. Saltant.');
                    continue;
                }

                var isPrev = _isPrevista(prefix);
                var newTime = mkTime;

                if (isPrev) {
                    previstaCount++;
                    // Estratègia Prevista: break → tall → original
                    var breakSnap = _findNearestBreak(mkTime, SNAP_WINDOW);
                    if (breakSnap !== null) {
                        newTime = breakSnap;
                        log('   🟣 [F5] ' + prefix + ' (Prevista): ' + mkTime.toFixed(2) + 's → break ' + newTime.toFixed(2) + 's');
                    } else {
                        newTime = _findNearestCut(mkTime, SNAP_WINDOW);
                        if (newTime !== mkTime) {
                            log('   🟣 [F5] ' + prefix + ' (Prevista): ' + mkTime.toFixed(2) + 's → tall ' + newTime.toFixed(2) + 's');
                        }
                    }
                } else {
                    orfeCount++;
                    newTime = _findNearestCut(mkTime, SNAP_WINDOW);
                    if (newTime !== mkTime) {
                        log('   🟣 [F5] ' + prefix + ' (orfè): ' + mkTime.toFixed(2) + 's → tall ' + newTime.toFixed(2) + 's');
                    }
                }

                if (newTime !== mkTime) snappedCount++;
                if (newTime < 0) newTime = 0;

                // BUG #14: Si el marcador existent no té color vàlid (pre-BUG #9),
                // derivar el color de l'ítem d'escaleta via _getColorIdx.
                var colorIdxF5 = (typeof mk.color === 'number' && mk.color >= 0) ? mk.color : null;
                if (colorIdxF5 === null && prefixToItem[prefix]) {
                    colorIdxF5 = this._getColorIdx(prefixToItem[prefix]);
                }
                placements.push({
                    prefix: prefix,
                    timeSec: newTime,
                    comment: comment,
                    colorIdx: colorIdxF5
                });
            }

            log('   🟣 [F5·OrphanSnap] Previstos: ' + previstaCount + ' | Orfes: ' + orfeCount + ' | Snapejats: ' + snappedCount + ' | Sense canvi: ' + (nonDefinitive.length - snappedCount));

            if (placements.length === 0) {
                log('🟣 [F5·OrphanSnap] Cap placement. ✓ FINALITZAT.');
                return;
            }

            var result = await this._safePlaceByPrefixes(placements, 'F5·OrphanSnap');
            log('🟣 [F5·OrphanSnap] Snapejats: ' + snappedCount + ' | Moguts: ' + (result.moved || 0) + ' | Total: ' + (result.placed || 0) + '. ✓ FINALITZAT.');
        },

        // ═══════════════════════════════════════════════════════════════
        // D4·F6·Gràfics: Col·locació de marcadors gràfics en gaps
        // entre marcadors estructurals existents, sense solapament.
        //
        // Flux no acumulatiu: col·loca els graphicItems amb color 4
        // (groc/verd). Calcula la posició ideal via TC (OnAir o Prevista)
        // i ajusta per evitar solapaments amb marcadors veïns (gap 0.5s).
        //
        // Pipeline:
        //   1. _loadAssemblyContext        → manifest, reader, lines
        //   2. _classifyItems(lines)       → graphicItems, structuralItems
        //   3. _calcTemporalAnchors        → tlClipStartSec, anchorEfectiva
        //   4. Markers.get                 → marcadors existents (per gaps)
        //   5. Calcular posició per cada graphicItem
        //   6. Ajustar per evitar solapaments (gap mínim 0.5s)
        //   7. placeByPrefixes amb colorIdx:4
        // ═══════════════════════════════════════════════════════════════

        /**
         * 🟢 placeGraphicMarkers: F6·Gràfics
         * Entry point per al botó F6 de la UI.
         * Usa _loadAssemblyContext, _classifyItems, _calcTemporalAnchors.
         * NO necessita _calcDensityFootprint.
         */
        placeGraphicMarkers: async function () {
            log('🟢 [F6·Gràfics] Iniciant col·locació de marcadors gràfics...');

            // ── Pas 1: Carregar context ──
            const ctxData = await this._loadAssemblyContext();
            if (!ctxData) { log('⚠️ [F6·Gràfics] _loadAssemblyContext ha fallat. Abortant.'); return; }
            const { manifest, reader, lines } = ctxData;

            // ── Pas 2: Classificar ítems ──
            const classData = this._classifyItems(lines);
            const { graphicItems, structuralItems } = classData;

            if (graphicItems.length === 0) {
                log('🟢 [F6·Gràfics] Cap ítem gràfic per col·locar. ✓ FINALITZAT.');
                return;
            }
            log('   🟢 [F6·Gràfics] Ítems gràfics: ' + graphicItems.length);

            // ── Pas 3: Calcular àncores temporals ──
            const anchors = this._calcTemporalAnchors(manifest, reader, structuralItems);
            if (!anchors) { log('⚠️ [F6·Gràfics] _calcTemporalAnchors ha fallat. Abortant.'); return; }
            const { anchorEfTimelineSec, anchorEfectiva } = anchors;

            // ── Pas 4: Obtenir marcadors existents (per detectar gaps) ──
            var markersRaw = await callJSX('Markers.get()');
            var existingMarkers = [];
            try { existingMarkers = JSON.parse(markersRaw); } catch (e) { existingMarkers = []; }
            log('   🟢 [F6·Gràfics] Marcadors existents: ' + existingMarkers.length);

            // ── Pas 5: Per cada ítem gràfic, calcular posició i evitar solapaments ──
            var MIN_GAP_SEC = 0.5;
            var placements = [];

            for (var gi = 0; gi < graphicItems.length; gi++) {
                var gItem = graphicItems[gi];
                var gNum = String(gItem.num || '');

                // Determinar TC de referència (OnAir → Prevista)
                var refSec = null;
                var onAir = gItem.horaEntradaOnAir;
                var hasOnAir = onAir && onAir !== '00:00:00' && onAir.trim() !== '';
                if (hasOnAir) {
                    refSec = reader.tcToSeconds(onAir);
                }
                if (refSec === null || refSec === undefined) {
                    var prevista = gItem.horaEntradaPrevista;
                    if (prevista && prevista !== '00:00:00') {
                        refSec = reader.tcToSeconds(prevista);
                    }
                }

                if (refSec === null || refSec === undefined) {
                    log('   ⚠️ [F6·Gràfics] ' + gNum + ': sense TC de referència. Saltant.');
                    continue;
                }

                // Projectar a temps de timeline
                var idealPosSec = anchorEfTimelineSec + (refSec - anchorEfectiva);
                if (idealPosSec < 0) idealPosSec = 0;

                // Ajustar per evitar solapament amb marcadors existents
                var adjustedTime = idealPosSec;
                for (var mi = 0; mi < existingMarkers.length; mi++) {
                    var mTime = (typeof existingMarkers[mi].time === 'number') ? existingMarkers[mi].time : parseFloat(existingMarkers[mi].time);
                    if (isNaN(mTime)) continue;
                    if (Math.abs(adjustedTime - mTime) < MIN_GAP_SEC) {
                        adjustedTime = mTime + MIN_GAP_SEC;
                    }
                }

                var safeT = adjustedTime.toFixed(2);
                var titol = (gItem.titol || '').substring(0, 60);
                var comment = (gNum ? gNum + ' - ' : '') + titol;
                comment = comment.trim();

                var gapInfo = (adjustedTime !== idealPosSec) ? ' (ajustat +' + (adjustedTime - idealPosSec).toFixed(2) + 's per gap)' : '';
                log('   🟢 [F6·Gràfics] ' + gNum + ': → ' + safeT + 's' + gapInfo);

                placements.push({
                    prefix: gNum,
                    timeSec: parseFloat(safeT),
                    comment: comment,
                    colorIdx: 4
                });
            }

            if (placements.length === 0) {
                log('🟢 [F6·Gràfics] Cap marcador gràfic per col·locar. ✓ FINALITZAT.');
                return;
            }

            var result = await this._safePlaceByPrefixes(placements, 'F6·Gràfics');
            log('🟢 [F6·Gràfics] Moguts: ' + (result.moved || 0) + ' | Nous: ' + (result.created || 0) + ' | Total: ' + (result.placed || 0) + '. ✓ FINALITZAT.');
        },

        /**
         * Realitza el posicionament automàtic de rètols després del scene Detection.
         */
        runAutoPlacement: async function (mainTrack = 1) {
            log("🎬 Iniciant Assemblatge Automàtic (THE MAGIC)...");
            const state = FASTPASS_UI.State;
            const cfg = FASTPASS_UI.Config.get();

            let structure = state.structure;
            if (!structure || structure.length === 0) {
                // Intentar cargar estructura desde marcadores
                structure = await this._getStructureFromMarkers();
                if (!structure || structure.length === 0) {
                    log("⚠️ No hi ha estructura carregada ni marcadors. Avortant muntatge.");
                    return;
                }
                log(`📊 Usant estructura derivada de ${structure.length} marcadors.`);
            }

            try {
                // 1. Obtenir clips de la línia de temps
                const clips = await getClipsLogic().getTrackClips(mainTrack, "video");
                // Netejar flash whites del timeline abans del processament de blocs
                await getClipsLogic().cleanFlashWhites(clips, mainTrack);
                log(`📊 Clips obtinguts: ${clips.length}`);
                // Log detallat dels clips (comentat per reduir ruido)
                // clips.forEach((clip, idx) => log(`   Clip ${idx}: start=${clip.start.toFixed(2)}, end=${clip.end.toFixed(2)}, duration=${(clip.end - clip.start).toFixed(2)}`));
                if (clips.length === 0) return;

                // Obtenir conductor seleccionat a la UI (si existeix)
                let conductorFile = null;
                try {
                    const conductorSelect = document.getElementById('conductor');
                    if (conductorSelect && conductorSelect.value) {
                        conductorFile = conductorSelect.value;
                        log(`👤 Conductor seleccionat: ${conductorFile}`);
                    }
                } catch (e) {
                    log(`⚠️ No s'ha pogut obtenir el conductor: ${e.message}`);
                }

                let lastConductorTime = null;
                let conductorPlaced = false;

                const struct = structure;
                // Fusionar bloques OFF (delega a Parse.mergeOffBlocks)
                const mergedStruct = getParse().mergeOffBlocks(struct);
                log(`📊 Estructura carregada: ${struct.length} blocs → fusionats a ${mergedStruct.length} blocs`);
                // Obtener marcadores para ajustar tiempos de bloque
                const markerStruct = await this._getStructureFromMarkers();
                const markerMap = {};
                if (markerStruct && markerStruct.length > 0) {
                    markerStruct.forEach(m => { markerMap[m.id] = m.startTime; });
                    log(`📊 Marcadors disponibles: ${Object.keys(markerMap).length} marcadors`);
                }
                // Log detallat de cada bloc i els seus chirons
                for (const blk of mergedStruct) {
                    // log(`   Bloc ${blk.id}: ${blk.chyrons?.length || 0} chirons`);
                    if (blk.chyrons) {
                        // blk.chyrons.forEach((c, idx) => log(`      ${idx}: rol="${c.rol}", nom="${c.name}", tc="${c.tc}"`));
                    }
                }
                // Función auxiliar para encontrar el índice del clip más cercano a un tiempo
                const findClipIndexAtTime = (time) => {
                    let bestIdx = 0;
                    let bestDiff = Math.abs(clips[0].start - time);
                    for (let i = 1; i < clips.length; i++) {
                        const diff = Math.abs(clips[i].start - time);
                        if (diff < bestDiff) {
                            bestDiff = diff;
                            bestIdx = i;
                        }
                    }
                    return bestIdx;
                };

                // Separar bloques con y sin marcador
                const blocksWithMarker = [];
                const blocksWithoutMarker = [];
                for (const block of mergedStruct) {
                    if (markerMap[block.id] !== undefined) {
                        blocksWithMarker.push({
                            block,
                            markerTime: markerMap[block.id]
                        });
                    } else {
                        blocksWithoutMarker.push(block);
                    }
                }
                // Ordenar bloques con marcador por tiempo
                blocksWithMarker.sort((a, b) => a.markerTime - b.markerTime);

                // Procesar bloques con marcador
                let lastUsedClipIdx = -1;
                for (let i = 0; i < blocksWithMarker.length; i++) {
                    const { block, markerTime } = blocksWithMarker[i];
                    const nextMarkerTime = (i + 1 < blocksWithMarker.length) ? blocksWithMarker[i + 1].markerTime : clips[clips.length - 1].end;

                    // Encontrar clip de inicio (el que contiene markerTime o el más cercano)
                    let startClipIdx = findClipIndexAtTime(markerTime);
                    // Asegurar que no sea un clip ya usado
                    if (startClipIdx <= lastUsedClipIdx) {
                        startClipIdx = lastUsedClipIdx + 1;
                        if (startClipIdx >= clips.length) break;
                    }
                    // Encontrar clip de fin (primer clip cuyo start >= nextMarkerTime)
                    let endClipIdx = startClipIdx;
                    while (endClipIdx < clips.length && clips[endClipIdx].start < nextMarkerTime) {
                        endClipIdx++;
                    }
                    // Si no hay clips, al menos uno
                    if (endClipIdx === startClipIdx) {
                        endClipIdx = startClipIdx + 1;
                        if (endClipIdx > clips.length) endClipIdx = clips.length;
                    }
                    const blockClips = clips.slice(startClipIdx, endClipIdx);
                    lastUsedClipIdx = endClipIdx - 1;

                    // Detectar sufijo (f, i, etc.)
                    const suffix = block.id.match(/[a-z]+$/)?.[0] || '';
                    const isOffF = suffix === 'f';

                    // Detectar si este bloque es un OFF_VIDEO (tiene un par "f" en la estructura)
                    const baseId = block.id.replace(/[a-z]+$/, '');
                    const offFId = baseId + 'f';
                    const hasOffF = mergedStruct.some(b => b.id === offFId);
                    const isOffVideo = hasOffF && block.id === baseId && !block.id.endsWith('f');

                    const headClip = blockClips[0];
                    const blockStartTime = headClip.start;
                    const blockDuration = headClip.end - headClip.start;
                    let type = getParse().classify(block, blockDuration);
                    if (isOffVideo) {
                        type = "OFF_VIDEO";
                        log(`   🔍 Bloc ${block.id} detectat com a OFF_VIDEO (té un bloc ${offFId} a l'estructura)`);
                    }

                    log(`📦 Bloc ${block.id} (${type}) -> Clips iniciant a ${blockStartTime.toFixed(2)}s (TC: ${formatTC(blockStartTime)})`);

                    if (type === "INTRO") {
                        await this._placeIntroGfx(block, headClip, cfg.tracks.video, (i === 0));
                        log(`   ✨ Aplicant Auto Reframe a la INTRO (V${mainTrack}:${headClip.index})`);
                        await callJSX(`Anim.reframe(${mainTrack}, ${headClip.index})`);
                    } else {
                        // Col·locació especial per a blocs OFF i OFF_VIDEO
                        let chyronsToPlace = block.chyrons;
                        if (isOffF) {
                            const conductorStart = await this._placeOffGfx(block, headClip, cfg.tracks.video, conductorFile);
                            if (conductorStart !== null) {
                                lastConductorTime = conductorStart;
                                conductorPlaced = true;
                            }
                            chyronsToPlace = chyronsToPlace.filter(c =>
                                !((c.rol || '').toUpperCase() === "CONDUCTOR") &&
                                !c.name.includes("Tema-Titol") &&
                                !c.name.includes("TITOL")
                            );
                        }
                        if (isOffVideo) {
                            await this._placeOffVideoGfx(block, headClip, cfg.tracks.video, lastConductorTime);
                            chyronsToPlace = chyronsToPlace.filter(c =>
                                !c.name.includes("Tema-Titol") &&
                                !c.name.includes("TITOL")
                            );
                        }

                        // ALQUÍMIA: Inferència màgica
                        const result = await this._placeMagicChyrons(
                            { ...block, chyrons: chyronsToPlace },
                            blockClips,
                            cfg.tracks.video,
                            { firstClipGlobal: clips[0] }
                        );

                        if (result.isInsert) {
                            log(`   ✨ Aplicant Auto Reframe a INSERTS de ${block.id}`);
                            for (const clip of blockClips) {
                                await callJSX(`Anim.reframe(${mainTrack}, ${clip.index})`);
                            }
                        }
                    }
                }

                // Procesar bloques sin marcador (colocarlos al final, en orden)
                if (blocksWithoutMarker.length > 0) {
                    log(`📦 ${blocksWithoutMarker.length} blocs sense marcador es col·locaran al final.`);
                    let startClipIdx = lastUsedClipIdx + 1;
                    if (startClipIdx >= clips.length) {
                        log(`⚠️ No queden clips per a blocs sense marcador. S'ometen.`);
                    } else {
                        // Asignar clips secuencialmente, repartiendo los clips restantes
                        const remainingClips = clips.slice(startClipIdx);
                        const clipsPerBlock = Math.max(1, Math.floor(remainingClips.length / blocksWithoutMarker.length));
                        let clipCursor = 0;
                        for (const block of blocksWithoutMarker) {
                            const sliceEnd = clipCursor + clipsPerBlock;
                            const blockClips = remainingClips.slice(clipCursor, sliceEnd);
                            if (blockClips.length === 0) break;
                            const headClip = blockClips[0];
                            const blockStartTime = headClip.start;
                            const blockDuration = headClip.end - headClip.start;
                            let type = getParse().classify(block, blockDuration);
                            log(`📦 Bloc ${block.id} (${type}) sense marcador -> Clips iniciant a ${blockStartTime.toFixed(2)}s`);

                            // Detectar sufijo (f, i, etc.)
                            const suffix = block.id.match(/[a-z]+$/)?.[0] || '';
                            const isOffF = suffix === 'f';
                            const baseId = block.id.replace(/[a-z]+$/, '');
                            const offFId = baseId + 'f';
                            const hasOffF = mergedStruct.some(b => b.id === offFId);
                            const isOffVideo = hasOffF && block.id === baseId && !block.id.endsWith('f');

                            let chyronsToPlace = block.chyrons;
                            if (isOffF) {
                                const conductorStart = await this._placeOffGfx(block, headClip, cfg.tracks.video, conductorFile);
                                if (conductorStart !== null) {
                                    lastConductorTime = conductorStart;
                                    conductorPlaced = true;
                                }
                                chyronsToPlace = chyronsToPlace.filter(c =>
                                    !((c.rol || '').toUpperCase() === "CONDUCTOR") &&
                                    !c.name.includes("Tema-Titol") &&
                                    !c.name.includes("TITOL")
                                );
                            }
                            if (isOffVideo) {
                                await this._placeOffVideoGfx(block, headClip, cfg.tracks.video, lastConductorTime);
                                chyronsToPlace = chyronsToPlace.filter(c =>
                                    !c.name.includes("Tema-Titol") &&
                                    !c.name.includes("TITOL")
                                );
                            }

                            const result = await this._placeMagicChyrons(
                                { ...block, chyrons: chyronsToPlace },
                                blockClips,
                                cfg.tracks.video,
                                { firstClipGlobal: clips[0] }
                            );

                            if (result.isInsert) {
                                log(`   ✨ Aplicant Auto Reframe a INSERTS de ${block.id}`);
                                for (const clip of blockClips) {
                                    await callJSX(`Anim.reframe(${mainTrack}, ${clip.index})`);
                                }
                            }
                            clipCursor += blockClips.length;
                        }
                    }
                }

                log("✅ Assemblatge Màgic completat.");

                // Inserir conductor seleccionat a la UI (només si no s'ha col·locat ja en un bloc OFF)
                if (!conductorPlaced) {
                    try {
                        const conductorSelect = document.getElementById('conductor');
                        if (conductorSelect && conductorSelect.value) {
                            const conductorFile = conductorSelect.value;
                            const targetTime = clips.length > 0 ? clips[0].start + 7.6 : 7.6;
                            await window.Assembly.conductor(conductorFile, targetTime);
                            log(`👤 Conductor inserit: ${conductorFile} a ${targetTime.toFixed(2)}s`);
                        }
                    } catch (e) {
                        log(`⚠️ No s'ha pogut inserir el conductor: ${e.message}`);
                    }
                }

            } catch (e) { getUtils().handleError(e, "Assembly_Magic"); }
        },

        /**
         * Regles d'Intro: Decalatges i seguretat de temporal.
         */
        _placeIntroGfx: async function (block, clip, tracks, isFirst) {
            const safety = 0.4;
            const start = isFirst ? Math.max(clip.start, safety) : clip.start;
            const duration = clip.end - clip.start;

            const tematitol = block.chyrons.find(c => c.name.includes("Tema-Titol") || c.name.includes("TITOL"));
            const conductor = block.chyrons.find(c => (c.rol || '').toUpperCase() === "CONDUCTOR");

            if (duration >= 10) {
                if (tematitol) await callJSX(`Clips.insert('${getUtils().escape(tematitol.name)}', ${tracks.tematitol}, ${start}, null, 'video')`);
                if (conductor) await callJSX(`Clips.insert('${getUtils().escape(conductor.name)}', ${tracks.chyrons}, ${start + 6.3}, null, 'video')`);
            } else {
                if (conductor) await callJSX(`Clips.insert('${getUtils().escape(conductor.name)}', ${tracks.chyrons}, ${start}, null, 'video')`);
                if (tematitol) await callJSX(`Clips.insert('${getUtils().escape(tematitol.name)}', ${tracks.tematitol}, ${clip.end - 2.0}, null, 'video')`);
            }
        },

        /**
         * Col·locació de gràfics per a blocs OFF (sufix "f").
         */
        _placeOffGfx: async function (block, clip, tracks, conductorFile) {
            const start = clip.start;
            // 10 frames després de l'inici (0.4 segons)
            const conductorStart = start + 0.4;
            const conductorTrack = tracks.chyrons || 5;
            log(`   🎬 OFF (${block.id}): inserint conductor a ${conductorStart.toFixed(2)}s`);
            // Cercar conductor a conductorFile o als chirons del bloc
            let conductorName = conductorFile;
            if (!conductorName) {
                const conductorChyron = block.chyrons.find(c => (c.rol || '').toUpperCase() === "CONDUCTOR");
                if (conductorChyron) conductorName = conductorChyron.name;
            }
            if (conductorName) {
                await callJSX(`Clips.insert('${getUtils().escape(conductorName)}', ${conductorTrack}, ${conductorStart}, null, 'video')`);
                // Cercar Tema‑Titol als chirons del bloc (preferir els que continguin "Off")
                let tematitol = block.chyrons.find(c =>
                    (c.name.includes("Tema-Titol") || c.name.includes("TITOL")) &&
                    c.name.toUpperCase().includes("OFF")
                );
                if (!tematitol) {
                    tematitol = block.chyrons.find(c => c.name.includes("Tema-Titol") || c.name.includes("TITOL"));
                }
                if (tematitol) {
                    const tematitolStart = conductorStart + 4.10; // marca del conductor a 4.10s
                    const tematitolTrack = tracks.tematitol || tracks.chyrons;
                    log(`   🎬 OFF (${block.id}): inserint Tema‑Titol "${tematitol.name}" a ${tematitolStart.toFixed(2)}s (marca del conductor)`);
                    await callJSX(`Clips.insert('${getUtils().escape(tematitol.name)}', ${tematitolTrack}, ${tematitolStart}, null, 'video')`);
                }
                return conductorStart; // retornar temps d'inici del conductor
            }
            return null;
        },

        /**
         * Col·locació de Tema‑Titol per a blocs OFF_VIDEO (bloc sense sufix que segueix un "f").
         */
        _placeOffVideoGfx: async function (block, clip, tracks, conductorStart) {
            const start = clip.start;
            // Cercar Tema‑Titol als chirons del bloc
            const tematitol = block.chyrons.find(c => c.name.includes("Tema-Titol") || c.name.includes("TITOL"));
            if (!tematitol) return;
            // Calcular posició relativa al conductor
            const tematitolStart = conductorStart ? conductorStart + 4.10 : start + 4.5; // marca del conductor a 4.10s
            const tematitolTrack = tracks.tematitol || tracks.chyrons;
            log(`   🎬 OFF_VIDEO (${block.id}): inserint Tema‑Titol a ${tematitolStart.toFixed(2)}s (marca del conductor)`);
            await callJSX(`Clips.insert('${getUtils().escape(tematitol.name)}', ${tematitolTrack}, ${tematitolStart}, null, 'video')`);
        },

        /**
         * Match de footprint i snap magnètic a talls.
         * Refactoritzat per usar ref si el manifest està disponible.
         */
        _placeMagicChyrons: async function (block, clips, tracks, options = {}) {
            log(`   🔮 Aplicant Precision Placement a ${block.id}...`);

            // 1. Carregar manifest per obtenir ref i item d'escaleta
            const ctx = await FASTPASS_UI.Workflows.MainButton._setupContext();
            const manifest = await FASTPASS_UI.SessionManifest.load(ctx);
            const ref = manifest.ref;
            const reader = window.EscaletaReader;

            let blockStartManual = clips[0].start;
            let avgDelta = 0;
            let usePrecision = false;
            let precisionBlockStart = 0;

            if (ref && ref.offsetSec !== null && reader) {
                // Intentar buscar l'ítem d'escaleta que correspon a aquest bloc de rètols
                // block.id pot ser "11", "11f", etc. block.numBase és "11".
                const item = manifest.escaletaItems.find(i => i.num === block.id || i.num === block.numBase);
                if (item && item.horaEntradaOnAir) {
                    const worldSecOnAir = reader.tcToSeconds(item.horaEntradaOnAir);
                    precisionBlockStart = (worldSecOnAir - ref.worldSecMediaStart) + ref.offsetSec;
                    usePrecision = true;
                    log(`      📐 Usant Precision Timing (OnAir): blockStart=${precisionBlockStart.toFixed(2)}s`);
                }
            }

            if (!usePrecision) {
                // Fallback a Footprint Matching tradicional basat en talls de V1
                avgDelta = getAssemblyLogic().calcFootprintDelta(block, clips);
                log(`      📐 Fallback: Decalatge mig detectat (Footprint): ${avgDelta.toFixed(2)}s`);
            }

            // Extraer índice de segmento para traduccions
            function extractSegmentIndex(name) {
                const match = name.match(/\[(\d+)-\d+\]/);
                return match ? parseInt(match[1]) : null;
            }

            // Classificar chyrons per tipus
            const { temaTitols, traduccions, otros, hasNom, hasFirma } = getAssemblyLogic().classifyChyrons(block.chyrons);

            // Col·locar Tema‑Titol primer
            if (temaTitols.length > 0) {
                const c = temaTitols[0];
                const relTc = getUtils().timeToSeconds(c.tc);
                const adjustedTime = usePrecision ? (precisionBlockStart + relTc) : (blockStartManual + relTc + avgDelta);

                let targetTrack = tracks.tematitol || tracks.chyrons;
                log(`      🎬 Tema‑Titol: ${c.name} -> ${adjustedTime.toFixed(2)}s (V${targetTrack})`);
                await callJSX(`Clips.insert('${getUtils().escape(c.name)}', ${targetTrack}, ${adjustedTime}, null, 'video')`);
            }

            // Col·locar traduccions dins del clip de video corresponent
            if (traduccions.length > 0) {
                log(`      🗣️ Es col·locaran ${traduccions.length} traduccions`);

                // Agrupar per timecode (tc)
                const grupos = {};
                for (const t of traduccions) {
                    if (!grupos[t.tc]) grupos[t.tc] = [];
                    grupos[t.tc].push(t);
                }

                // Processar cada grup
                for (const tc of Object.keys(grupos).sort((a, b) => a.localeCompare(b))) {
                    const grupo = grupos[tc];
                    grupo.sort((a, b) => {
                        const idxA = extractSegmentIndex(a.name);
                        const idxB = extractSegmentIndex(b.name);
                        return (idxA !== null && idxB !== null) ? idxA - idxB : 0;
                    });

                    // Càlcul de posició ideal (Precision vs Footprint)
                    const relTc = getUtils().timeToSeconds(tc);
                    const idealPos = usePrecision ? (precisionBlockStart + relTc) : (blockStartManual + relTc + avgDelta);

                    let candidateClip = getAssemblyLogic().findCandidateClip(clips, idealPos);
                    const clipStart = candidateClip.start;
                    const clipEnd = candidateClip.end;
                    const clipDuration = clipEnd - clipStart;
                    const numTraduccions = grupo.length;
                    log(`      📏 Grup tc=${tc}: idealPos=${idealPos.toFixed(2)}, clip seleccionat [${clipStart.toFixed(2)}  ${clipEnd.toFixed(2)}] durada=${clipDuration.toFixed(2)}s, numTraduccions=${numTraduccions}`);

                    // Distribuir uniformement dins del clip
                    const segmentDurationBase = clipDuration / numTraduccions;
                    for (let i = 0; i < grupo.length; i++) {
                        const c = grupo[i];
                        // Calcular temps proporcional
                        const targetTime = clipStart + (i * segmentDurationBase);
                        const segmentIdx = extractSegmentIndex(c.name);
                        let targetTrack = tracks.graf;
                        // Calcular duración ajustada para que no exceda clipEnd
                        const remaining = clipEnd - targetTime;
                        let duration = (i === grupo.length - 1) ? remaining : Math.min(segmentDurationBase, remaining);
                        // Garantizar duración positiva
                        if (duration < 0) duration = 0;
                        const safeDuration = Math.max(0.1, duration);
                        log(`      🗣️ Traducció ${segmentIdx !== null ? `[${segmentIdx}]` : ''}: ${c.name} -> ${targetTime.toFixed(2)}s (V${targetTrack}) (durada: ${safeDuration.toFixed(2)}s)`);
                        // Diagnòstics detallats comentats per reduir ruido
                        // if (i === 0) {
                        //     log(`      🔍 Diagnóstic primera traducció: file='${c.name}', track=${targetTrack}, start=${targetTime.toFixed(2)}, duration=${safeDuration.toFixed(2)}, clipStart=${clipStart.toFixed(2)}, clipEnd=${clipEnd.toFixed(2)}`);
                        // }
                        // if (i === grupo.length - 1) {
                        //     log(`      🔍 Diagnóstic última traducció: remaining=${remaining.toFixed(2)}, duration=${duration.toFixed(2)}, safeDuration=${safeDuration.toFixed(2)}, clipEnd=${clipEnd.toFixed(2)}, targetTime=${targetTime.toFixed(2)}`);
                        // }
                        try {
                            const endTime = targetTime + safeDuration;
                            await callJSX(`Clips.insert('${getUtils().escape(c.name)}', ${targetTrack}, ${targetTime}, ${endTime}, 'video')`);
                            log(`      ✅ Traducció inserida: ${c.name}`);
                        } catch (err) {
                            log(`      ❌ Error inserint traducció: ${err.message}`);
                        }
                    }
                }
            }

            // Detección de bloque OFF (combinado)
            const isOffBlock = block.id.endsWith('f') || (block.originalIds && block.originalIds.some(id => id.endsWith('f')));
            // Evitar múltiples chyrons de lloc en el mateix clip
            const usedLlocClips = new Set();
            // Col·locar la resta de chirons (inclosos NOMCARREC, FIRMA, etc.)
            for (const c of otros) {
                const relTc = getUtils().timeToSeconds(c.tc);
                const idealPos = usePrecision ? (precisionBlockStart + relTc) : (blockStartManual + relTc + avgDelta);

                let candidateClip = getAssemblyLogic().findCandidateClip(clips, idealPos);
                // Forzar segundo clip para chyrons de lugar en bloques OFF
                if ((c.name.includes("Lloc") || c.name.includes("Data")) && isOffBlock && clips.length >= 2) {
                    candidateClip = clips[1];
                    log(`      🎯 Chyron de lloc forçat al segon clip (primer tall) del bloc OFF: [${candidateClip.start.toFixed(2)}-${candidateClip.end.toFixed(2)}]`);
                }

                // Evitar múltiples chyrons de lloc en el mateix clip (només rol Llocdata)
                if (c.rol === "Llocdata") {
                    const clipIdx = clips.indexOf(candidateClip);
                    // Debug comentat per reduir ruido
                    // log(`      📍 Llocdata clipIdx=${clipIdx}, used=${Array.from(usedLlocClips).join(',')}`);
                    if (usedLlocClips.has(clipIdx)) {
                        // Cercar següent clip lliure
                        let nextIdx = clipIdx + 1;
                        while (nextIdx < clips.length && usedLlocClips.has(nextIdx)) {
                            nextIdx++;
                        }
                        if (nextIdx < clips.length) {
                            candidateClip = clips[nextIdx];
                            log(`      🔀 Chyron de lloc reubicat al següent clip (evita sobreposició): [${candidateClip.start.toFixed(2)}-${candidateClip.end.toFixed(2)}]`);
                        } else {
                            log(`      ⚠️ No hi ha més clips disponibles per a chyron de lloc, es manté el mateix clip`);
                        }
                    }
                    usedLlocClips.add(clips.indexOf(candidateClip));
                }

                // Diagnóstico para chyrons de lugar (comentat per reduir ruido, ja cobert per logs posteriors)
                // if (c.name.includes("Lloc") || c.name.includes("Data")) {
                //     log(`      🏞️ Chyron de lloc: ${c.name} tc=${c.tc} idealPos=${idealPos.toFixed(2)} candidateClip=[${candidateClip.start.toFixed(2)}-${candidateClip.end.toFixed(2)}]`);
                // }

                // Snap només per a NOMCARREC i FIRMA
                let placementTime = idealPos; // idealPos ja inclou el delta o és precision
                const isNomCarrec = (c.rol || '').toUpperCase() === "NOMCARREC";
                const isFirma = (c.rol || '').toUpperCase() === "FIRMA" || c.name.includes("Firma");
                // Colocación especial para Llocdata: al inicio del clip base, con margen de 10 frames si es el primer clip del proyecto
                if (c.rol === "Llocdata") {
                    const isFirstClip = options.firstClipGlobal && Math.abs(candidateClip.start - options.firstClipGlobal.start) < 0.01;
                    placementTime = candidateClip.start + (isFirstClip ? 0.4 : 0);
                    log(`      📍 Llocdata col·locat a ${placementTime.toFixed(2)}s (${isFirstClip ? 'primer clip +0.4s' : 'inici del clip'})`);
                }
                // Colocación especial para chyrons de lugar en bloques OFF
                else if ((c.name.includes("Lloc") || c.name.includes("Data")) && isOffBlock) {
                    placementTime = candidateClip.start + getUtils().timeToSeconds(c.tc);
                    log(`      🎯 Chyron de lloc col·locat a ${placementTime.toFixed(2)}s (clip start ${candidateClip.start.toFixed(2)} + tc ${c.tc})`);
                } else if (isNomCarrec) {
                    const isFirstClip = options.firstClipGlobal && Math.abs(candidateClip.start - options.firstClipGlobal.start) < 0.01;
                    placementTime = candidateClip.start + (isFirstClip ? 0.4 : 0);
                    log(`      📍 NOMCARREC col·locat a ${placementTime.toFixed(2)}s (${isFirstClip ? 'primer clip +0.4s' : 'inici del clip'})`);
                } else if (isFirma) {
                    const isFirstClip = options.firstClipGlobal && Math.abs(candidateClip.start - options.firstClipGlobal.start) < 0.01;
                    placementTime = candidateClip.start + (isFirstClip ? 0.4 : 0);
                    log(`      📍 FIRMA col·locat a ${placementTime.toFixed(2)}s (${isFirstClip ? 'primer clip +0.4s' : 'inici del clip'})`);
                }

                // Ajustar placementTime si queda fuera del clip candidato
                let maxDuration = candidateClip.end - placementTime;
                if (maxDuration <= 0) {
                    placementTime = candidateClip.start;
                    maxDuration = candidateClip.end - placementTime;
                    // log(`      ⚠️ Ajustat placementTime per a ${c.rol} dins del clip candidat`);
                }

                // Calcular duración limitada al final del clip candidato (nunca null)
                let duration = maxDuration > 0 ? maxDuration : 0.1;
                // Limitar duración de chyrons de lugar a 5 segundos para evitar estiramiento
                if ((c.name.includes("Lloc") || c.name.includes("Data")) && duration > 5) {
                    duration = 5;
                }
                // Duración mínima para FIRMA (evita clips demasiado cortos)
                if (isFirma && duration < 2.0) {
                    duration = 2.0;
                    // Asegurar que no exceda el final del clip
                    if (placementTime + duration > candidateClip.end) {
                        duration = candidateClip.end - placementTime;
                    }
                }
                let durationLog = duration.toFixed(2) + 's';
                let endTime = placementTime + duration;
                // Para NOMCARREC usamos duración nativa (null)
                if (isNomCarrec) {
                    endTime = null;
                    durationLog = "nativa";
                }

                let targetTrack = tracks.chyrons;
                if (c.name.includes("Lloc") || c.name.includes("Data")) targetTrack = tracks.lloc || tracks.chyrons;
                if (c.name.indexOf("   ") === 0) targetTrack = tracks.graf || tracks.chyrons;
                if (targetTrack === undefined) targetTrack = tracks.chyrons || 5;

                // Log de colocación solo para chyrons de lugar (diagnóstico)
                if (c.name.includes("Lloc") || c.name.includes("Data")) {
                    log(`      📍 ${c.rol}: ${c.name} -> ${placementTime.toFixed(2)}s (V${targetTrack}) (durada: ${durationLog})`);
                }
                // Log para NOMCARREC
                if (isNomCarrec) {
                    log(`      📍 NOMCARREC: ${c.name} -> ${placementTime.toFixed(2)}s (V${targetTrack}) (durada ${durationLog})`);
                }
                // Log para FIRMA (isFirma ya definida más arriba)
                if (isFirma) {
                    log(`      📍 FIRMA: ${c.name} -> ${placementTime.toFixed(2)}s (V${targetTrack}) (durada ${durationLog})`);
                }
                await callJSX(`Clips.insert('${getUtils().escape(c.name)}', ${targetTrack}, ${placementTime}, ${endTime}, 'video')`);
                log(`      ✅ ${c.rol || 'Chyron'} inserit: ${c.name}`);
            }

            return { isInsert: (hasNom && hasFirma) };
        },
        /* verifyTcRefFootprint: Compara els talls reals (V1) amb la previsió OnAir.
        * Si la vericidat és alta (>=75%), calcula el drift i permet corregir l'offset.
        */
        verifyTcRefFootprint: async function (videoItems, clips, ref, reader) {
            log("🦶 [Footprint] Verificant sincronia amb talls de V1...");
            if (!ref || !ref.worldSecMediaStart || ref.offsetSec === null) {
                log("⚠️ [Footprint] ref incomplet. No es pot verificar.");
                return { confidence: 0, correction: 0 };
            }

            let matches = 0;
            let drifts = [];
            const threshold = 0.5; // ±500ms de marge per considerar match

            // Ignorem el primer ítem si és el que defineix l'inici del bloc (sempre quadra per definició)
            const testItems = videoItems.slice(1);
            if (testItems.length === 0) return { confidence: 1, correction: 0 };

            for (const item of testItems) {
                const worldSecOnAir = reader.tcToSeconds(item.horaEntradaOnAir);
                const idealSeqPos = (worldSecOnAir - ref.worldSecMediaStart) + ref.offsetSec;

                // Busquem el tall més proper a V1
                let bestMatch = null;
                let minDiff = 999;

                for (const clip of clips) {
                    const diff = Math.abs(clip.start - idealSeqPos);
                    if (diff < minDiff) {
                        minDiff = diff;
                        bestMatch = clip;
                    }
                }

                if (minDiff <= threshold) {
                    matches++;
                    drifts.push(bestMatch.start - idealSeqPos);
                }
            }

            const confidence = testItems.length > 0 ? matches / testItems.length : 1;
            let avgCorrection = 0;
            if (drifts.length > 0) {
                avgCorrection = drifts.reduce((a, b) => a + b, 0) / drifts.length;
            }

            log(`📊 [Footprint] Veracitat: ${(confidence * 100).toFixed(0)}% | Correcció mitjana: ${avgCorrection.toFixed(3)}s`);

            return {
                confidence,
                correction: avgCorrection,
                autoCorrected: (confidence >= 0.75 && Math.abs(avgCorrection) > 0.001)
            };
        },

/**
 * Obtiene una estructura de bloques a partir de los marcadores presentes en la timeline.
 * Cada marcador debe tener un comentario con el formato "ID - TIPO" (p.ej. "11 - INTRO").
 * Retorna un array de bloques simulados con id, tipo y startTime.
 */
_getStructureFromMarkers: async function () {
    const markersRaw = await callJSX(`Markers.get()`);
    if (!markersRaw || markersRaw === "[]") return [];
    let markers;
    try {
        markers = JSON.parse(markersRaw);
    } catch (e) {
        log(`⚠️ No s'han pogut analitzar els marcadors: ${e.message}`);
        return [];
    }
    // Ordenar por tiempo
    markers.sort((a, b) => a.time - b.time);
    const structure = [];
    // Filtrar solo marcadores ESTRUCTURALES (color 1 o 6) para la
    // referencia de bloques. Los marcadores gráficos (color 4) e IPD
    // (color 7) NO representan bloques estructurales y deben ignorarse.
    const STRUCTURAL_COLORS = new Set([1, 6]);
    for (let i = 0; i < markers.length; i++) {
        const m = markers[i];
        const markerColor = m.color !== undefined ? m.color : -1;
        if (markerColor >= 0 && !STRUCTURAL_COLORS.has(markerColor)) {
            continue; // ignorar gráficos (4), IPDs (7), etc.
        }
        const comment = m.comments || '';
        // Extraer ID y tipo del comentario (formato "ID - TIPO")
        const parts = comment.split(' - ');
        const id = parts[0] || `M${i + 1}`;
        const type = parts[1] || 'UNKNOWN';
        structure.push({
            id: id,
            type: type,
            startTime: m.time,
            chyrons: [] // sin chyrons, se inferirán más adelante
        });
    }
    log(`📊 Estructura generada a partir de ${structure.length} marcadors estructurals (ignorats ${markers.length - structure.length} no estructurals).`);
    return structure;
},

/**
 * debugBlockItems: Imprime informació dels clips del timeline d'un bloc i dels items d'escaleta,
 * i col·loca marcadors al timeline.
 * @param {string} blockId - Identificador del bloc (per defecte "V1")
 */
debugBlockItems: async function (blockId = "V1") {
    log(`🔍 [DEBUG] Iniciant debug per al bloc ${blockId}`);
    const reader = window.EscaletaReader;
    const cfg = FASTPASS_UI.Config.get();
    const trackIdx = cfg.tracks.video.mp4; // pista on està el clip del bloc

    // 1. Obtenir dades de l'escaleta actual (carregar JSON més recent)
    const programArchivo = "TN_VESPRE"; // TODO: obtenir del context
    const latest = await reader.findLatest(programArchivo, blockId);
    if (!latest) {
        log(`⚠️ No s'ha trobat JSON d'escaleta per a ${programArchivo}/${blockId}`);
        return;
    }
    const data = await reader.load(latest.path);
    if (!data) {
        log(`⚠️ No s'ha pogut carregar JSON`);
        return;
    }

    // 2. Obtenir bloc
    const block = reader.getBlock(data, blockId);
    if (!block) {
        log(`⚠️ Bloc ${blockId} no trobat`);
        return;
    }
    log(`📋 Bloc ${blockId}: in=${block.in}, out=${block.out}, ready=${block.ready}`);

    // 3. Obtenir items del bloc (taula en memòria)
    const items = reader.getBlockItems(data, blockId);
    log(`📋 Total items del bloc: ${items.length}`);
    items.forEach((item, idx) => {
        log(`   ${idx + 1}. Seq ${item.sequencia} | Num ${item.num} | "${item.titol}" | Durada ${item.durada} | Entrada ${item.horaEntradaPrevista} | Offset ${item.offset.toFixed(2)}s`);
    });

    // 4. Obtenir clips del timeline a la pista mp4
    const clips = await getClipsLogic().getTrackClips(trackIdx, "video");
    log(`🎬 Clips al timeline (pista ${trackIdx}): ${clips.length}`);
    clips.forEach((clip, idx) => {
        log(`   Clip ${idx}: start=${clip.start.toFixed(2)}s, end=${clip.end.toFixed(2)}s, duration=${(clip.end - clip.start).toFixed(2)}s, inPoint=${clip.inPoint.toFixed(2)}s, outPoint=${clip.outPoint.toFixed(2)}s`);
    });

    // 5. Si hi ha clip, assumim que el primer clip correspon al bloc (simplificat)
    const targetClip = clips.length > 0 ? clips[0] : null;
    if (targetClip) {
        log(`🎬 Clip seleccionat per a marcadors: start=${targetClip.start.toFixed(2)}s`);
        // 6. Col·locar marcadors per a cada item
        for (const item of items) {
            const markerTime = targetClip.start + item.offset;
            const comment = `${item.num ? item.num + ' - ' : ''}${item.titol}`.trim();
            log(`   📍 Marcador a ${markerTime.toFixed(2)}s: ${comment}`);
            await callJSX(`Markers.set(${markerTime}, '${comment.replace(/'/g, "\\'")}', 'Línia Escaleta')`);
        }
        log(`✅ ${items.length} marcadors col·locats.`);
    } else {
        log(`⚠️ No hi ha clip al timeline per col·locar marcadors.`);
    }
},

/**
 * runGuidedAssembly: Dispara la lògica de posicionament de rètols basat en markers.
 */
runGuidedAssembly: async function () {
    if (!(await getUtils().validateActiveSequence())) return;
    try {
        const ctx = FASTPASS_UI.State;
        
        // Actualitzar manifest: marquem que l'anàlisi de clip està fet (ja que ESTRUCTURA ha tallat)
        await FASTPASS_UI.SessionManifest.save(ctx, { phases: { clipAnalysisDone: true } });

        // Executar ensamblatge de rètols original
        const res = await window.FASTPASS_UI.Logic.Assembly.runGuidedAssembly();
        if (res && res.indexOf("OK") !== -1) {
            getUtils().status("Rètols col·locats OK", "exito");
        }
    } catch (e) { getUtils().handleError(e, "runGuidedAssembly"); }
},

/**
 * _logLearning: Helper per guardar el log d'aprenentatge
 */
_logLearning: async function(ctx, aiIn, humanIn, aiOut, humanOut) {
    try {
        const config = FASTPASS_UI.Config.get();
        const logData = {
            timestamp: new Date().toISOString(),
            program: ctx.progData?.wott || "TNV",
            blockId: ctx.bloque || "V1",
            ai: { in: aiIn, out: aiOut },
            human: { in: humanIn, out: humanOut },
            delta: { in: humanIn - aiIn, out: humanOut - aiOut }
        };
        const extPath = await callJSX("System.getExtPath()");
        const logPath = extPath + "/FASTPASS_LEARNING_LOG.json";
        
        await callJSX(`
            var f = new File('${getUtils().escape(logPath)}');
            var list = [];
            if (f.exists) {
                f.open('r');
                var txt = f.read();
                f.close();
                try { list = JSON.parse(txt); } catch(e) {}
            }
            list.push(${JSON.stringify(logData)});
            f.open('w');
            f.encoding = 'UTF-8';
            f.write(JSON.stringify(list, null, 2));
            f.close();
        `);
    } catch(e) { console.log("Learning log error", e); }
},


/**
 * Solució C: Actualitza el punt d'entrada del bloc al cabezal actual (CTI).
 */
updateBlocInFromCTI: async function() {
    try {
        const cti = parseFloat(await callJSX("Timeline.get()"));
        log(`📍 In Seqüència → ${cti.toFixed(2)}s`);
        await callJSX(`Timeline.inPoint(${cti})`);
        getUtils().status("In fixat", "exito");
    } catch (e) { getUtils().handleError(e, "updateBlocIn"); }
},

/**
 * Solució C: Actualitza el punt de sortida del bloc al cabezal actual (CTI).
 */
updateBlocOutFromCTI: async function() {
    try {
        const cti = parseFloat(await callJSX("Timeline.get()"));
        log(`📍 Fixant BLOC_OUT a ${cti.toFixed(2)}s`);
        
        // 1. Actualitzar Out Point de seqüència
        await callJSX(`Timeline.outPoint(${cti})`);
        
        // 2. Actualitzar marcador BLOC_OUT
        await callJSX(`Markers.set(${cti}, 'BLOC_OUT', 'color=3')`);
        getUtils().status("Out Bloc fixat", "exito");
    } catch (e) { getUtils().handleError(e, "updateBlocOut"); }
},

// ====================================================================
// SISTEMA DE DEPURACIÓN Y ANÁLISIS DE MARCADORES (Fases 2-4: crudo, cocinado, usuario)
// ====================================================================

/**
 * FASE 2a: Crudo (inout) — Lee el WorkArea del timeline y lo guarda en fase 'crudo'.
 */
runInOutCrudo: async function() {
    if (!(await getUtils().validateActiveSequence())) return;
    log("📍 [INOUT Crudo] Capturant WorkArea del timeline...");
    try {
        const ctx = await FASTPASS_UI.Workflows.MainButton._setupContext();
        const waIn  = parseFloat(await callJSX("Timeline.getWorkAreaIn()"));
        const waOut = parseFloat(await callJSX("Timeline.getWorkAreaOut()"));
        await FASTPASS_UI.Logic.Analysis.appendPhase(ctx, 'crudo', {
            workAreaIn: waIn,
            workAreaOut: waOut,
            capturedAt: new Date().toISOString()
        });
        getUtils().status("INOUT Crudo capturat", "exito");
    } catch (e) { getUtils().handleError(e, "runInOutCrudo"); }
},

/**
 * FASE 2b: Crudo (marks) — Marcadores en posición ideal (sin snapToCut).
 * Cada marcador se coloca en posIdeal = posIdeal acumulada.
 *
 * CORRECCIÓN v2.9.6: Ahora carga el manifest para obtener offsetSec y worldSecMediaStart.
 * Si existe offsetSec, se usa como posición base del primer marcador en lugar de forzar 0.
 * Esto evita la discrepancia cuando el clip está desplazado en el timeline.
 * NO se aplica applyGlobalOffsetSec porque offsetSec ya refleja la posición real del clip.
 */
placeRawMarkers: async function() {
    if (!(await getUtils().validateActiveSequence())) return;
    log("📍 [MARKS Crudos] Col·locant marcadors en posició ideal...");
    try {
        const ctx = await FASTPASS_UI.Workflows.MainButton._setupContext();
        const reader = window.EscaletaReader || window.FASTPASS_UI.EscaletaReader;
        if (!reader) { log("⚠️ EscaletaReader no disponible."); return; }

        // Cargar escaleta
        const latest = await reader.findLatest(ctx.progData.archivo, ctx.bloque);
        if (!latest) { log("⚠️ No es troba l'escaleta."); return; }
        const data = await reader.load(latest.path);
        if (!data) { log("⚠️ No s'ha pogut carregar l'escaleta."); return; }

        var lines = reader.getLinesForBlock(data, ctx.bloque);
        if (!lines || lines.length === 0) { log("⚠️ El bloc no té línies."); return; }

        // Ordenar por hora
        lines.sort(function(a, b) {
            var ha = a.horaEntradaOnAir || a.horaEntradaPrevista || '00:00:00';
            var hb = b.horaEntradaOnAir || b.horaEntradaPrevista || '00:00:00';
            return reader.tcToSeconds(ha) - reader.tcToSeconds(hb);
        });

        // ── Carregar manifest per obtenir refs estructurals ──
        var manifest = null;
        try {
            manifest = await FASTPASS_UI.SessionManifest.load(ctx);
        } catch (e) {
            log(`⚠️ [MARKS Crudo] No s'ha pogut carregar manifest: ${e.message}`);
        }

        // ── Determinar blockInSec: TC del primer frame del clip al timeline ──
        // Cercar el clip del cleanFeed que coincideix amb ctx.bloque
        var blockInSec = null;
        var clipsInfo = data.cleanFeed && data.cleanFeed.clips ? data.cleanFeed.clips : [];
        for (var ci = 0; ci < clipsInfo.length; ci++) {
            if (clipsInfo[ci].id === ctx.bloque && clipsInfo[ci].in) {
                blockInSec = reader.tcToSeconds(clipsInfo[ci].in);
                log(`📍 [MARKS Crudo] Clip "${ctx.bloque}" trobat: block.in=${clipsInfo[ci].in} → ${blockInSec.toFixed(2)}s, block.out=${clipsInfo[ci].out}`);
                break;
            }
        }

        // ── FIX (2026-05-26·HOMOGENEÏTZACIÓ): tlClipStartSec DINÀMIC ──
        // Mateixa fórmula que _calcTemporalAnchors:
        //   tlClipStartSec = (blockInSec - mediaStart) - tlBlockInPointSec
        // on blockInSec prové de cleanFeed.clips[].in (l'àncora canònica).
        var worldSecMediaStart = (manifest && manifest.ref) ? (manifest.ref.worldSecMediaStart || 0) : 0;
        var tlBlockInPointSec = (manifest && manifest.ref) ? (manifest.ref.tlBlockInPointSec || 0) : 0;
        var tlClipStartSec = (blockInSec !== null)
            ? (blockInSec - worldSecMediaStart) - tlBlockInPointSec
            : 0;
        log(`📍 [MARKS Crudo] tlClipStartSec DINÀMIC: (${(blockInSec||0).toFixed(2)}s - ${worldSecMediaStart.toFixed(0)}s) - ${tlBlockInPointSec.toFixed(2)}s = ${tlClipStartSec.toFixed(3)}s`);

        // ── LOG DE CLIPS DEL TIMELINE (per a diagnòstic) ──
        try {
            const tlClips = await getClipsLogic().getTrackClips(1, 'video');
            log(`📍 [MARKS Crudo] ─── CLIPS EN V1 (${tlClips.length} clips) ───`);
            for (var tc = 0; tc < tlClips.length; tc++) {
                var c = tlClips[tc];
                log(`📍 [MARKS Crudo]   Clip #${tc}: [${c.start.toFixed(2)}s → ${c.end.toFixed(2)}s] dur=${(c.end - c.start).toFixed(2)}s "${c.name || ''}"`);
            }
            log(`📍 [MARKS Crudo] ─── FI CLIPS ───`);
        } catch (e2) {
            log(`⚠️ [MARKS Crudo] No s'han pogut llegir els clips del timeline: ${e2.message}`);
        }

        // Determinar l'àncora de referència per al càlcul de posicions
        // Prioritat: block.in del cleanFeed > primer OnAir de la llista > 0
        var anchorOnAirSec = blockInSec;
        if (anchorOnAirSec === null) {
            // Fallback: primer OnAir disponible a les línies del bloc
            for (var i = 0; i < lines.length; i++) {
                var h = lines[i].horaEntradaOnAir || lines[i].horaEntradaPrevista;
                if (h && h !== "00:00:00") {
                    anchorOnAirSec = reader.tcToSeconds(h);
                    break;
                }
            }
            if (anchorOnAirSec === null) anchorOnAirSec = 0;
            log(`📍 [MARKS Crudo] ⚠️ block.in no disponible. Usant primer OnAir del bloc com a àncora: ${anchorOnAirSec.toFixed(3)}s`);
        } else {
            log(`📍 [MARKS Crudo] Usant block.in del cleanFeed com a àncora: ${anchorOnAirSec.toFixed(3)}s`);
        }

        // Limpiar marcadores previos
        await callJSX("Markers.clear()");

        // Colocar marcadors en posició ideal (basada en OnAir, sense snap)
        // Per a cada item de l'escaleta (estructural, IPD o grafisme), es col·loca
        // un marcador si té una referència temporal (OnAir o Prevista).
        // Color per tipus: 6=blau estructural, 7=turquesa IPD, 4=groc grafisme
        var allLines = data.escaleta.liniesEscaleta || [];
        var markersData = [];
        for (var i = 0; i < lines.length; i++) {
            var line = lines[i];
            var itemOnAirSec = reader.getItemEntradaSec(line, allLines, data);
            if (itemOnAirSec === null) continue; // Sense referència temporal

            var dSec = reader.getItemDuradaSec(line);
            var esEstructural = reader.isItemEstructural(line);
            var esIPD = (!esEstructural && line.agrupacio && line.duradaOnAir);
            var color = esEstructural ? 6 : (esIPD ? 7 : 4);
            var categoria = esEstructural ? "ESTRUCTURAL" : (esIPD ? "IPD" : "GRAFISME");

            // Posició al timeline: tlClipStartSec + desplaçament respecte a l'àncora
            var posTimeline = tlClipStartSec + (itemOnAirSec - anchorOnAirSec);
            var safeT = posTimeline.toFixed(2);
            var num = line.num || '';
            var titol = (line.titol || '').replace(/'/g, "\\'").substring(0, 60);
            var comment = (num ? num + ' - ' : '') + titol;

            log("📍 [MARKS Crudo] " + num + ": → timeline " + safeT + "s (cat=" + categoria + ", tlClipStart=" + tlClipStartSec.toFixed(2) + "s, itemOnAir=" + itemOnAirSec.toFixed(2) + "s, anchorOnAir=" + anchorOnAirSec.toFixed(2) + "s)");

            if (comment) {
                await callJSX("Markers.set(" + safeT + ", '" + comment + "', 'color=" + color + "')");
            }

            markersData.push({
                num: num,
                titol: line.titol || '',
                additPosSec: posTimeline,
                posColocada: posTimeline,
                categoria: categoria,
                duradaSec: dSec,
                baseOffsetSec: tlClipStartSec
            });
        }

        // Guardar fase crudo (marks) — merge con inoutCrudo anterior
        await FASTPASS_UI.Logic.Analysis.appendPhase(ctx, 'crudo', {
            markers: markersData,
            baseOffsetSec: tlClipStartSec,
            anchorOnAirSec: anchorOnAirSec,
            capturedAt: new Date().toISOString()
        });

        getUtils().status(markersData.length + " MARKS Crudos (tlClipStart=" + tlClipStartSec.toFixed(2) + "s, anchorOnAir=" + anchorOnAirSec.toFixed(2) + "s)", "exito");
    } catch (e) { getUtils().handleError(e, "placeRawMarkers"); }
},

/**
 * Helper: snap al corte más cercano dentro de 2s de tolerancia.
 */
_snapSimple: function(pos, clipCuts) {
    var best = pos;
    var minD = Infinity;
    for (var i = 0; i < clipCuts.length; i++) {
        var d = Math.abs(clipCuts[i] - pos);
        if (d < minD && d <= 2.0) { minD = d; best = clipCuts[i]; }
    }
    return best;
},

/**
 * FASE 3a: Cocinado (inout) — WorkArea snapeado a corte real + sceneDetect.
 * Coloca marcadores de validación a ±1s (color naranja).
 */
runInOutCocinado: async function() {
    if (!(await getUtils().validateActiveSequence())) return;
    log("📍 [INOUT Cocinado] Calculant WorkArea snapejat...");
    try {
        const clips  = await getClipsLogic().getTrackClips(1, 'video');
        if (clips.length === 0) { log("⚠️ No hi ha clips a V1."); return; }
        const clipCuts = clips.map(function(c) { return c.start; });

        const ctx = await FASTPASS_UI.Workflows.MainButton._setupContext();
        const analysis = await FASTPASS_UI.Logic.Analysis._load(
            FASTPASS_UI.Logic.Analysis._getPath(ctx)
        );
        const waCrudo = analysis.crudo || {};

        const waInCrudo  = (waCrudo.workAreaIn !== undefined && waCrudo.workAreaIn !== null) ? waCrudo.workAreaIn : 0;
        const waOutCrudo = (waCrudo.workAreaOut !== undefined && waCrudo.workAreaOut !== null) ? waCrudo.workAreaOut : (clips[clips.length - 1] ? clips[clips.length - 1].end : 0);

        // Snap a corte más cercano
        const snapIn  = this._snapSimple(waInCrudo, clipCuts);
        const snapOut = this._snapSimple(waOutCrudo, clipCuts);

        // Aplicar WorkArea en Premiere
        await callJSX("Timeline.setWorkArea(" + snapIn + ", " + snapOut + ")");

        // Colocar marcadores de validación a ±1s (color naranja = 3)
        const validIn  = snapIn + 1.0;
        const validOut = snapOut - 1.0;
        await callJSX("Markers.set(" + validIn + ", 'VALID_IN', 'color=3')");
        await callJSX("Markers.set(" + validOut + ", 'VALID_OUT', 'color=3')");

        // Guardar sceneDetect + inout dins fase 'cocinado' (merge automàtic)
        await FASTPASS_UI.Logic.Analysis.appendPhase(ctx, 'cocinado', {
            clipCuts: clipCuts,
            totalClips: clips.length,
            workAreaIn: snapIn,
            workAreaOut: snapOut,
            snapDeltaIn:  snapIn - waInCrudo,
            snapDeltaOut: snapOut - waOutCrudo,
            validInMarker: validIn,
            validOutMarker: validOut,
            capturedAt: new Date().toISOString()
        });

        getUtils().status("INOUT Cocinado OK", "exito");
    } catch (e) { getUtils().handleError(e, "runInOutCocinado"); }
},

/**
 * FASE 3b: Cocinado (marks) — col·loca les 3 fases de marcadors + captura deltaCrudo.
 */
placeCookedMarkers: async function() {
    if (!(await getUtils().validateActiveSequence())) return;
    log("📍 [MARKS Cocinado] Col·locant marcadors amb snap a cortes...");
    try {
        // Col·locar les 3 fases de marcadors estructurals
        await this.placeOnAirMarkers();
        await this.placeDeducedOnAirMarkers();
        await this.placeScheduledMarkers();

        // Ahora leer los marcadores del timeline para guardarlos como marksCocinado
        const ctx = await FASTPASS_UI.Workflows.MainButton._setupContext();
        const analysis = await FASTPASS_UI.Logic.Analysis._load(
            FASTPASS_UI.Logic.Analysis._getPath(ctx)
        );
        const marksCrudo = analysis.crudo || { markers: [] };

        // Leer marcadores del timeline
        const markersRaw = await callJSX("Markers.get()");
        var timelineMarkers = [];
        if (markersRaw && markersRaw !== "[]") {
            try { timelineMarkers = JSON.parse(markersRaw); } catch (e) {}
        }

        // Mapear por num extraído del comentario
        var crudoMap = {};
        for (var i = 0; i < marksCrudo.markers.length; i++) {
            var m = marksCrudo.markers[i];
            crudoMap[m.num] = m;
        }

        var cookedMarkers = [];
        for (var j = 0; j < timelineMarkers.length; j++) {
            var tm = timelineMarkers[j];
            var comment = tm.comments || tm.comment || '';
            // Extraer num del comentario (formato "NN - TITOL")
            var numMatch = comment.match(/^(\d+)/);
            var num = numMatch ? numMatch[1] : '';
            var titol = comment.replace(/^\d+\s*-\s*/, '').trim();
            var crudoRef = crudoMap[num] || null;

            cookedMarkers.push({
                num: num,
                titol: titol,
                additPosSec: crudoRef ? crudoRef.additPosSec : tm.time,
                posColocada: tm.time,
                corteUsado: -1,
                deltaCrudo: crudoRef ? (tm.time - crudoRef.additPosSec) : 0,
                categoria: "ESTRUCTURAL",
                snapApplied: crudoRef ? (Math.abs(tm.time - crudoRef.additPosSec) > 0.04) : false
            });
        }

        // Guardar sceneDetect + marks dins fase 'cocinado' (merge automàtic)
        {
            const clips = await getClipsLogic().getTrackClips(1, 'video');
            const clipCuts = clips.map(function(c) { return c.start; });
            await FASTPASS_UI.Logic.Analysis.appendPhase(ctx, 'cocinado', {
                clipCuts: clipCuts,
                totalClips: clips.length,
                capturedAt: new Date().toISOString()
            });
        }

        await FASTPASS_UI.Logic.Analysis.appendPhase(ctx, 'cocinado', {
            markers: cookedMarkers,
            capturedAt: new Date().toISOString()
        });

        getUtils().status(cookedMarkers.length + " MARKS Cocinados", "exito");
    } catch (e) { getUtils().handleError(e, "placeCookedMarkers"); }
},

/**
 * FASE 4a: Usuario (inout) — Lee marcadores VALID_IN/VALID_OUT del timeline.
 */
capturaUsuarioInOut: async function() {
    if (!(await getUtils().validateActiveSequence())) return;
    log("📍 [CAPTURA IN/OUT] Llegint marcadors de validació...");
    try {
        const ctx = await FASTPASS_UI.Workflows.MainButton._setupContext();
        const analysis = await FASTPASS_UI.Logic.Analysis._load(
            FASTPASS_UI.Logic.Analysis._getPath(ctx)
        );
        const inoutCocinado = analysis.cocinado || {};

        // Leer todos los marcadores del timeline
        const markersRaw = await callJSX("Markers.get()");
        var markers = [];
        if (markersRaw && markersRaw !== "[]") {
            try { markers = JSON.parse(markersRaw); } catch (e) {}
        }

        var validInPos = null;
        var validOutPos = null;
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

        var deltaIn  = inoutCocinado.validInMarker !== undefined ? (validInPos - inoutCocinado.validInMarker) : 0;
        var deltaOut = inoutCocinado.validOutMarker !== undefined ? (validOutPos - inoutCocinado.validOutMarker) : 0;

        await FASTPASS_UI.Logic.Analysis.appendPhase(ctx, 'usuario', {
            validInMarker: validInPos,
            validOutMarker: validOutPos,
            deltaVsCocinado_in: deltaIn,
            deltaVsCocinado_out: deltaOut,
            capturedAt: new Date().toISOString()
        });

        getUtils().status("IN/OUT Usuari capturat", "exito");
    } catch (e) { getUtils().handleError(e, "capturaUsuarioInOut"); }
},

/**
 * FASE 4b: Usuario (marks) — Lee todos los marcadores del timeline.
 */
capturaUsuarioMarks: async function() {
    if (!(await getUtils().validateActiveSequence())) return;
    log("📍 [CAPTURA MARKS] Llegint marcadors del timeline...");
    try {
        const ctx = await FASTPASS_UI.Workflows.MainButton._setupContext();
        const analysis = await FASTPASS_UI.Logic.Analysis._load(
            FASTPASS_UI.Logic.Analysis._getPath(ctx)
        );
        const marksCrudo   = analysis.crudo   || { markers: [] };
        const marksCocinado = analysis.cocinado || { markers: [] };

        // Leer todos los marcadores del timeline
        const markersRaw = await callJSX("Markers.get()");
        var markers = [];
        if (markersRaw && markersRaw !== "[]") {
            try { markers = JSON.parse(markersRaw); } catch (e) {}
        }

        // Construir mapas de referencia
        var crudoMap = {};
        for (var i = 0; i < marksCrudo.markers.length; i++) {
            var m = marksCrudo.markers[i];
            crudoMap[m.num] = m;
        }
        var cocinadoMap = {};
        for (var j = 0; j < marksCocinado.markers.length; j++) {
            var m = marksCocinado.markers[j];
            cocinadoMap[m.num] = m;
        }

        var userMarkers = [];
        for (var k = 0; k < markers.length; k++) {
            var tm = markers[k];
            var comment = tm.comments || tm.comment || '';
            // Saltar marcadores de validación
            if (comment === 'VALID_IN' || comment === 'VALID_OUT') continue;
            // Extraer num del comentario
            var numMatch = comment.match(/^(\d+)/);
            var num = numMatch ? numMatch[1] : '';
            var titol = comment.replace(/^\d+\s*-\s*/, '').trim();

            var crudoRef = crudoMap[num] || null;
            var cocinadoRef = cocinadoMap[num] || null;

            userMarkers.push({
                num: num,
                titol: titol,
                posUsuario: tm.time,
                deltaVsCocinado: cocinadoRef ? (tm.time - cocinadoRef.posColocada) : 0,
                deltaVsCrudo: crudoRef ? (tm.time - crudoRef.additPosSec) : 0
            });
        }

        await FASTPASS_UI.Logic.Analysis.appendPhase(ctx, 'usuario', {
            markers: userMarkers,
            capturedAt: new Date().toISOString()
        });

        getUtils().status(userMarkers.length + " MARKS Usuari capturats", "exito");
    } catch (e) { getUtils().handleError(e, "capturaUsuarioMarks"); }
}
};

window.FASTPASS_UI.Workflows.Assembly = FASTPASS_UI.Workflows.Assembly;
}) ();
