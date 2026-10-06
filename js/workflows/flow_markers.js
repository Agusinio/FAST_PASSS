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
    // Motor de densitat de talls (zones/ruptures): passada estàndard i passada FINA
    // per als IPD (molts plans curts) → calcDensityFootprintV2(clips, windowSec, talls/min).
    const getAssemblyLogic = () => window.FASTPASS_UI.Logic.Assembly;

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

    /**
     * isIpdLine (2026-10-05 · BUG #139): l'ítem és un IPD (interrupció
     * publicitària) dins el bloc?
     *
     * PER QUÈ: el cas real DONAPAS + DIRECTE (IPDs disparats a sobre del
     * directe) és `agrupacio == null` + `durada > 0` → queia al VERMELL (1) i el
     * filtre de vermells de _safePlaceByPrefixes el descartava com si no fos del
     * bloc. La regla "IPD = turquesa (7)" JA existia, però NOMÉS a F5·Inferits i
     * al detector de runAplicarIpdDesdeMarkers → aquí passa a ser l'ÚNICA font
     * de veritat per a TOTES les fases.
     *
     * És una funció de MÒDUL (no un mètode amb `this`) perquè la regla no pot
     * dependre del receptor: `_getColorIdx` rep crides de 12 punts i el color no
     * ha de canviar segons com s'invoqui.
     *
     * @param {Object} line - ítem d'escaleta (num/titol)
     * @returns {boolean}
     */
    function isIpdLine(line) {
        if (!line) return false;
        var num = (line.num !== null && line.num !== undefined) ? String(line.num) : '';
        var titol = (line.titol !== null && line.titol !== undefined) ? String(line.titol) : '';
        return /IPD/i.test(num + ' ' + titol);
    }

    FASTPASS_UI.Workflows.Markers = {

        // ═══════════════════════════════════════════════════════════════
        // SUFFIXOS GRÀFICS (compartits per _classifyItems i UNGROUPED)
        // BUG #12: Evita que ítems gràfics amb agrupacio:null (ex: 18TE)
        // es col·loquin com a marcadors estructurals a F1/F2/F3.
        // Aquests ítems pertanyen exclusivament a F6·Gràfics.
        // ═══════════════════════════════════════════════════════════════
        _GRAPHIC_SUFFIXES: new Set([
            'chy', 'chy1', 'chy2',
            // (2026-09-30 · BUG #125) La família GF és OVERTA (GF-1…GF-N). L'escaleta del
            // TNV_V1 29/09 porta GF-3 i aquí només hi havia gf/gf1/gf2 → GF-3 queia com a
            // ESTRUCTURAL (F2/F3.5/F4 la tractaven com a ítem del bloc) i sortia BLAVA.
            // El guard genèric /^gf\d+$/ de _isGraphicByNum cobreix GF-4…GF-N.
            'gf', 'gf1', 'gf2', 'gf3', 'gf4', 'gf5', 'gf_01', 'gf_02', 'gf_011',
            'te', 'te1', 'te2', 'te3',
            'p2', 'p21', 'p22', 'p23', 'p24', 'p3', 'p4', 'p40', 'p41', 'p42',
            'p5', 'p51', 'p52',
            'p5_01', 'p5_02', 'p7', 'p7_01', 'p7_02', 'p7_03', 'p7_0',
            'p71', 'p72', 'p73', 'p',
            'td', 'td1', 'td2', 'td3', 'td4', 'td_01', 'td_02', 'td_at1',
            'qr', 'rq',
            'at1', 'at2', 'at3', '_at1', '_at2', '_at3', 'ae', 't', 'teloc',
            '**********'
        ]),

        // (2026-09-30) BUG #122 · NORMALITZACIÓ DEL SUFIX (un sol punt de veritat).
        // L'escaleta del TNV escriu els números amb ESPAI i GUIONET ("01 GF", "01 GF-1",
        // "02 GF-2", "25 P2-1") però _GRAPHIC_SUFFIXES conté el sufix "net" ('gf', 'gf1',
        // 'p21'…). Sense normalitzar, " gf" no casava MAI → els GF del TNV es tractaven com a
        // ESTRUCTURALS i això encadenava TRES símptomes alhora (TNV V1 29/09):
        //   1) F2·Deduced els apilava a l'inici del bloc (1,32s → 0,00s) en comptes de
        //      deixar-los a F6·Gràfics (D13: dins de la intro, +10/+15/+20/+25s).
        //   2) Contaminaven el Δ de correlació (F3.5 movia el marcador OnAir "01" 1,32s
        //      ABANS del seu corte real).
        //   3) La fase Vermells (no agrupats) els pintava de color 1 (VERMELL) en comptes
        //      de GROC (4), perquè ni _detectUngroupedItems (assembly_context) ni
        //      _getColorIdx els reconeixien com a gràfics.
        // Normalitzar aquí arregla els tres camins alhora (tots criden _isGraphicByNum).
        _normSuffix: function (num) {
            if (num === null || num === undefined) return null;
            var clean = String(num).toLowerCase().replace(/[\s_\-]/g, '');
            var m = clean.match(/^\d+(.*)$/);
            if (!m) return null;
            return m[1];
        },

        _graphicSuffixesNorm: function () {
            if (!this._GRAPHIC_SUFFIXES_NORM) {
                var n = new Set();
                this._GRAPHIC_SUFFIXES.forEach(function (s) {
                    n.add(String(s).toLowerCase().replace(/[\s_\-]/g, ''));
                });
                this._GRAPHIC_SUFFIXES_NORM = n;
            }
            return this._GRAPHIC_SUFFIXES_NORM;
        },

        _isGraphicByNum: function (num) {
            var suf = this._normSuffix(num);
            if (suf === null || suf === '') return false;
            // (2026-09-30 · BUG #125) La família GF és OVERTA a l'escaleta (GF-1…GF-N): amb
            // el whitelist tancat, un 'GF-3' o 'GF-4' queia com a ESTRUCTURAL → F2/F3.5/F4
            // el movien pel bloc i, com que porta agrupacio, _getColorIdx el pintava BLAU
            // (TNV_V1 29/09: '01 GF-3' acabat a 58,52s, dins del vídeo). Qualsevol dígit
            // darrere de 'gf' és gràfic, igual que les entrades explícites de la resta.
            if (/^gf\d+$/.test(suf)) return true;
            return this._graphicSuffixesNorm().has(suf);
        },

        // ═══════════════════════════════════════════════════════════════
        // HELPER: UPSERT atòmic de marcadors amb protecció d'errors
        // BUG #8: Evita que un JSON.parse falli si callJSX retorna
        // un valor no-JSON (ex: "ERR:..." o buit).
        // ═══════════════════════════════════════════════════════════════
        _safePlaceByPrefixes: async function (placements, label) {
            try {
                var safePlacements = JSON.parse(JSON.stringify(placements));
                // (2026-09-25) CAPES: un marcador CONGELAT per una capa anterior no es toca mai
                // (ni es mou ni es reescriu). Les capes posteriors l'han de fer servir de guia.
                try {
                    if (this._frozen && Object.keys(this._frozen).length) {
                        var restants = [];
                        for (var fz = 0; fz < safePlacements.length; fz++) {
                            var keyFz = String(safePlacements[fz].prefix || '').toLowerCase();
                            if (this._frozen[keyFz] === true) {
                                log('   🔒 ' + safePlacements[fz].prefix + ': congelat per una capa anterior → no es mou');
                            } else { restants.push(safePlacements[fz]); }
                        }
                        if (restants.length !== safePlacements.length) {
                            log('   🔒 [' + label + '] ' + (safePlacements.length - restants.length) + ' marcador(s) congelat(s) omesos');
                        }
                        safePlacements = restants;
                    }
                } catch (eFz) { }
                for (var sp = 0; sp < safePlacements.length; sp++) {
                    if (safePlacements[sp].comment) {
                        safePlacements[sp].comment = safePlacements[sp].comment.replace(/'/g, '');
                    }
                }
                // (2026-09-29) BUG #108 · XARXA DE SEGURETAT DE COLOR:
                // placeByPrefixes fa DELETE+CREATE i només aplica color si el placement porta
                // colorIdx; si no, mira d'heretar `savedColor` (existing.color), però
                // Markers.get() retorna sempre -1 → el marcador recreat quedava amb el color
                // PER DEFECTE de Premiere (VERD). Amb això, cap placement pot sortir sense color.
                var senseColor = 0;
                for (var scc = 0; scc < safePlacements.length; scc++) {
                    var ciSc = Number(safePlacements[scc].colorIdx);
                    if (!isFinite(ciSc) || ciSc < 0) {
                        senseColor++;
                        log('   🎨 [' + label + '] ' + safePlacements[scc].prefix + ': placement sense colorIdx → s\'aplica 6 (BLAU) per no quedar verd per defecte', 'WARN');
                        safePlacements[scc].colorIdx = 6;
                    }
                }
                if (senseColor > 0) {
                    log('   🎨 [' + label + '] ' + senseColor + ' placement(s) sense color → recolorejats a 6 (revisa els callers)', 'WARN');
                }
                // (2026-09-24) REGLA D'USUARI: un marcador VERMELL (ítem no agrupat, color 1)
                // només s'ha de col·locar si queda ENTRE dos marcadors d'un altre color (blaus,
                // etc.). Abans només ho filtrava F7 i els vermells seguien apareixent de F1/F2/F5
                // (queixa d'usuari 2026-09-24). Aquí és el punt comú de TOTES les fases.
                try {
                    var mkRaw = await callJSX('Markers.get()');
                    var mkExist = [];
                    try { mkExist = mkRaw ? JSON.parse(mkRaw) : []; } catch (eP) { mkExist = []; }
                    var tVermells = [];
                    for (var vi = 0; vi < safePlacements.length; vi++) tVermells.push(Number(safePlacements[vi].colorIdx));
                    if (tVermells.indexOf(1) !== -1) {
                        var mantinguts = [], descartats = 0;
                        for (var xi = 0; xi < safePlacements.length; xi++) {
                            var px = safePlacements[xi];
                            if (Number(px.colorIdx) !== 1) { mantinguts.push(px); continue; }
                            var tx = Number(px.timeSec);
                            var abans = false, despres = false;
                            for (var xj = 0; xj < safePlacements.length; xj++) {
                                if (xj === xi || Number(safePlacements[xj].colorIdx) === 1) continue;
                                var tjx = Number(safePlacements[xj].timeSec);
                                if (tjx < tx) abans = true;
                                if (tjx > tx) despres = true;
                            }
                            for (var xk = 0; xk < mkExist.length; xk++) {
                                var tkx = Number(mkExist[xk].time);
                                if (!isFinite(tkx)) continue;
                                if (tkx < tx) abans = true;
                                if (tkx > tx) despres = true;
                            }
                            if (abans && despres) { mantinguts.push(px); }
                            else {
                                descartats++;
                                log('   ⛔ [' + label + '] ' + px.prefix + ': marcador VERMELL (no agrupat) fora d\'un interval entre marcadors → no es col·loca (' + tx.toFixed(2) + 's)');
                            }
                        }
                        if (mantinguts.length === 0 && safePlacements.length > 0) {
                            log('   ⚠️ [' + label + '] El filtre de vermells deixaria el bloc sense marcadors → es manté tota la llista.', 'WARN');
                        } else if (descartats > 0) {
                            safePlacements = mantinguts;
                        }
                    }
                } catch (eFv) {
                    log('⚠️ [filtrarVermells] ' + eFv.message, 'WARN');
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
        // num/titol amb "IPD" → 7 (Turquesa, IPD DINS el bloc)
        // ═══════════════════════════════════════════════════════════════

        _getColorIdx: function (line) {
            // (2026-10-05 · BUG #139) IPD DINS EL BLOC → TURQUESA (7), i va PRIMER:
            // un IPD no és mai un gràfic ni un ítem "no verticalitzable de fora del
            // bloc" — és un ítem EMÈS dins el bloc (tapa el directe). Sense això,
            // l'IPD no agrupat sortia VERMELL → F6 l'excloïa de la guarda d'ordre
            // (:2619) i el filtre de vermells (:170-199) el podia descartar.
            if (isIpdLine(line)) return 7;
            // (2026-09-30) BUG #122 · ORDRE DELS CHECKS: el GRÀFIC mana SEMPRE, també quan
            // porta agrupació (escaleta TNV: '01 GF' amb agrupacio=v1). ABANS el check
            // d'agrupació anava primer → un gràfic agrupat sortia BLAU (6) i la fase Vermells
            // el podia pintar de color 1 (no agrupat).
            // (2026-09-24) ELS ÍTEMS GRÀFICS (P2, GF, TE, ft…) SÓN SEMPRE GROCS (4): són gràfics
            // de l'escaleta, no "no agrupats". ABANS, si portaven durada > 0 queien al color 1
            // (VERMELL) i podien ser descartats pel filtre de vermells (queixa d'usuari
            // 2026-09-24: "Google hauria de ser marker groc (gràfic)").
            if (line.num && this._isGraphicByNum(line.num)) return 4;
            if (line.agrupacio) return 6;
            var dStr = line.durada || line.duradaOnAir || '0:00';
            var parts = dStr.split(':').map(Number);
            var dSec = 0;
            if (parts.length === 2) dSec = parts[0] * 60 + parts[1];
            else if (parts.length === 3) dSec = parts[0] * 3600 + parts[1] * 60 + parts[2];
            else dSec = (typeof parts[0] === 'number') ? parts[0] : 0;
            return dSec === 0 ? 4 : 1;
        },

        /**
         * _colorByNumFromManifest (2026-09-29 · BUG #108): mapa `num → colorIdx` recalculat
         * des de l'escaleta del manifest.
         *
         * PER QUÈ: `Markers.get()` NO retorna el color (sempre -1 en PPro 23) i
         * `Markers.placeByPrefixes` fa DELETE+CREATE de cada marcador: si el placement no
         * porta `colorIdx`, el JSX intenta heretar `savedColor` (= existing.color = -1) i
         * acaba deixant el marcador amb el color PER DEFECTE de Premiere = VERD.
         * Per tant, tot placement que mogui un marcador existent ha de portar `colorIdx`.
         *
         * @param {Object} manifest - Manifest de sessió (usa escaletaItems)
         * @returns {Object} { num: colorIdx }
         */
        _colorByNumFromManifest: function (manifest) {
            var out = {};
            var all = (manifest && manifest.escaletaItems) ? manifest.escaletaItems : [];
            for (var i = 0; i < all.length; i++) {
                var it = all[i];
                if (!it || !it.num) continue;
                var k = String(it.num);
                if (out[k] === undefined) out[k] = this._getColorIdx(it);
            }
            return out;
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
            // (2026-09-21) Ítems d'ESCALETA del bloc que no tenen cap hora (ni OnAir ni
            // Prevista): ABANS es descartaven en SILENCI amb el `continue` de sota i el
            // bloc es quedava sense el seu marcador (cas real TNV 2026-09-20: ítem "13"
            // "++++IPD VOTACIONS..." amb OnAir I Prevista anul·lats pel sanejat d'hores
            // mentideres de escaleta_bounds). Ara es conserven per deduir-ne la posició
            // entre els seus veïns d'escaleta amb el motor de densitat (F5·Inferits).
            const unplacedItems = [];
            for (const line of lines) {
                const rawNum = (line.num || '').toString().trim();
                if (rawNum === '' || rawNum === '.') {
                    log(`   ⏭️ [SKIP] Ítem sense num vàlid: "${line.titol || '?'}" → ignorat`);
                    continue;
                }
                const horaRef = line.horaEntradaOnAir || line.horaEntradaPrevista;
                if (!horaRef || horaRef === "00:00:00") {
                    if (line.agrupacio && line.flotant !== true) {
                        unplacedItems.push(line);
                        log(`   🔎 [SENSE-HORA] ${line.num}: sense OnAir ni Prevista → es deduirà la posició (agrupació ${line.agrupacio})`);
                    } else {
                        log(`   ⏭️ [SKIP] ${line.num}: sense hora i fora del bloc (sense agrupació) → ignorat`);
                    }
                    continue;
                }
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
            log(`📋 Items: ${structuralItems.length} estructurals, ${graphicItems.length} gràfics` + (unplacedItems.length ? `, ${unplacedItems.length} sense hora (a deduir a F5)` : ''));

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
                structuralItems, graphicItems, farosItems, aproximadosItems, unplacedItems,
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
            var _wsmsAdjust = 0;   // (2026-09-25) FIX C: declarat ABANS de la branca que l'assigna
                                   // (si es declara després, l'inicialitzador reseteja el valor ✗)
            // (2026-09-24) FIX A: offset que fan servir les fórmules d'ancoratge. Pot ser el
            // inPoint del clip real de V1 O la referència del bloc (si el clip és l'extret).
            var offsetAnchor = clipInPoint;
            var offsetAnchorFont = 'manifest.ref.tlBlockInPointSec (inicial)';
            // (2026-09-24) ANCORATGE — s'agafa el clip MÉS ANTIC de V1, no `clips[0]`.
            // `clips[0].start` s'assumia com l'inici del material, però si l'ordre del
            // retorn de Clips.get no és temporal (o hi ha un clip d'una altra seqüència
            // barrejat) l'ancoratge podia ser 1682,96s (=28:02) mentre el material
            // començava a 0,00s → tots els marcadors anaven ~28 min a la dreta
            // (queixa d'usuari 2026-09-24: "hay un marker a 28").
            if (clips && clips.length > 0) {
                var firstClip = clips[0];
                for (var ci = 1; ci < clips.length; ci++) {
                    var cs = Number(clips[ci] && clips[ci].start);
                    var fs = Number(firstClip && firstClip.start);
                    if (isFinite(cs) && (!isFinite(fs) || cs < fs)) firstClip = clips[ci];
                }
                if (firstClip) {
                    clipStart = (typeof firstClip.start === 'number') ? firstClip.start : 0;
                    if (firstClip.inPoint !== undefined && firstClip.inPoint !== null) {
                        clipInPoint = firstClip.inPoint;
                    }
                    // (2026-09-24) FIX A — DETECCIÓ DEL CLIP EXTRET: si el clip de V1 és el clip
                    // extret del bloc (<PROG>_<BLOC>_CLIP.mp4), el seu `inPoint` és temps DEL
                    // FITXER extret i no es pot restar a `worldSecMediaStart` → l'ancoratge
                    // sortia desviat (TNC 2026-09-24: inPoint=22,04s vs ref del bloc=20,00s →
                    // TOTS els marcadors 2,04s abans del tall). En aquest cas mana la
                    // referència del bloc (`manifest.ref.tlBlockInPointSec`).
                    var _clipNameAnc = (firstClip.name !== undefined && firstClip.name !== null) ? String(firstClip.name) : '';
                    var _isExtractedAnc = _clipNameAnc.toUpperCase().indexOf('_CLIP') !== -1;
                    var _manifestInPointAnc = (manifest.ref && manifest.ref.tlBlockInPointSec !== undefined && manifest.ref.tlBlockInPointSec !== null) ? Number(manifest.ref.tlBlockInPointSec) : null;
                    if (_isExtractedAnc && isFinite(_manifestInPointAnc) && _manifestInPointAnc > 0) {
                        // (2026-09-25) FIX B — IN REAL vs IN ESPERAT. FIX A (2026-09-24) assumia que
                        // si el clip de V1 és l'extret, el seu inPoint és soroll (±2s) i mana el
                        // manifest. Però si l'insert NO ha respectat el bounds (TNC V2 2026-09-25:
                        // inPoint real=123.52s vs refBloc=20.00s → Δ=103.52s), el material del
                        // timeline és un altre i TOTS els marcadors OnAir cauen 103s a la dreta
                        // (04 → 125.00s amb material fins a 120.92s). Regla: si la diferència és
                        // gran, MANA EL CLIP REAL i s'avisa fort.
                        var _tolInAnc = 1.0;
                        if (isFinite(clipInPoint) && Math.abs(clipInPoint - _manifestInPointAnc) > _tolInAnc) {
                            offsetAnchor = clipInPoint;
                            // (2026-09-25c) FIX D — l'offset de l'ancoratge és SEMPRE el inPoint REAL
                            // del clip. L'ajust de base (_wsmsAdjust) s'ha mogut a la GUARDA
                            // d'invariant de sota: només s'aplica si el manifest està en coords
                            // d'ORIGEN (si no, afegir-lo desplaçava l'ancoratge 20 s ✓→✗).
                            offsetAnchorFont = 'inPoint REAL del clip (' + Number(clipInPoint).toFixed(3) + 's) ≠ refBloc ' + Number(_manifestInPointAnc).toFixed(3) + 's';
                            log('ℹ️ [ANCORATGE·FIX-D] Recorte REAL del clip (' + Number(clipInPoint).toFixed(3) + 's) ≠ refBloc del manifest (' + Number(_manifestInPointAnc).toFixed(3) + 's, Δ=' + (clipInPoint - _manifestInPointAnc).toFixed(2) + 's) → mana el CLIP (timelinePos = mediaSec − (wsms + clip.inPoint)). El ref del manifest només serveix per detectar manifests vells.');
                        } else {
                            // (2026-09-25c) FIX D: el recorte real del clip ÉS la conversió
                            // fitxer→timeline. Usar el ref del manifest com a offset introduïa un
                            // biaix exactament igual a la diferència pla↔recorte (clipInOffset /
                            // zonaInOffset = 10 s a TNC → tots els marcadors 10 s tard).
                            offsetAnchor = clipInPoint;
                            offsetAnchorFont = 'inPoint REAL del clip ("' + _clipNameAnc + '")';
                        }
                    } else {
                        offsetAnchor = clipInPoint;
                        offsetAnchorFont = 'inPoint del clip' + (_clipNameAnc ? ' ("' + _clipNameAnc + '")' : '');
                    }
                    log('⚓ [ANCORATGE·FIX-A] Offset emprat: ' + Number(offsetAnchor).toFixed(3) + 's ← ' + offsetAnchorFont + ' | clipInPoint=' + Number(clipInPoint).toFixed(3) + 's · refBloc=' + (_manifestInPointAnc !== null ? Number(_manifestInPointAnc).toFixed(3) + 's' : 'n/a') + ' · start=' + Number(clipStart).toFixed(3) + 's');
                    log('⚓ [ANCORATGE] Clip V1 més antic: index=' + clips.indexOf(firstClip) + ' start=' + Number(clipStart).toFixed(3) + 's inPoint=' + Number(clipInPoint).toFixed(3) + 's (de ' + clips.length + ' clips)');
                }
                // (2026-09-24) GUARDA DE BASE: el ref del manifest ha d'estar expressat en la
                // base del CLIP EXTRET. Invariant: worldSecMediaStart == worldBlockAnchorSec −
                // tlBlockInPointSec (TNC: 51185 == 51205 − 20 ✓). Si no es compleix, el manifest
                // encara és el del cleanfeed sencer → l'ancoratge no pot quadrar i els marcadors
                // cauen fora del material (queixa "hi ha un marker a 28"). Cal prémer ACTUALITZAR.
                try {
                    var _wms = Number(manifest.ref.worldSecMediaStart);
                    var _wba = (manifest.ref.worldBlockAnchorSec !== undefined && manifest.ref.worldBlockAnchorSec !== null) ? Number(manifest.ref.worldBlockAnchorSec) : null;
                    var _tbp = Number(manifest.ref.tlBlockInPointSec);
                    if (isFinite(_wms) && _wba !== null && isFinite(_wba) && isFinite(_tbp) && Math.abs(_wms - (_wba - _tbp)) > 1.0) {
                        // (2026-09-25c) FIX C (mogut aquí, fora de la branca FIX-B): un manifest en
                        // coords d'ORIGEN (wsms = inici del cleanfeed, tlBlockInPointSec = in-point al
                        // SOURCE) no compleix l'invariant del clip extret. La base REAL del fitxer és
                        // wsms + tlBlockInPointSec (TNC: 49500 + 953 = 50453 ✓). NOMÉS en aquest cas:
                        // si el manifest ja és en base del fitxer, afegir-ho desplaçava l'ancoratge.
                        if (_tbp > 1.0) {
                            _wsmsAdjust = _tbp;
                            log('⚓ [ANCORATGE·FIX-C] Manifest en coords d\'ORIGEN (wsms=' + _wms.toFixed(2) + 's ≠ àncora−refBloc=' + (_wba - _tbp).toFixed(2) + 's) → base REAL del fitxer extret = wsms + refBloc = ' + (_wms + _tbp).toFixed(2) + 's. Prem ACTUALITZAR perquè el manifest quedi en base del clip.');
                        } else {
                            log('⚠️ [ANCORATGE] Manifest sense base fiable (worldSecMediaStart=' + _wms.toFixed(2) + 's, tlBlockInPointSec=' + _tbp + ') → els marcadors poden caure FORA del material. Prem ACTUALITZAR (botó principal).', 'ERROR');
                        }
                    }
                } catch (eGuard) { /* noop */ }
            }

            log('🔧 [BUG3·FIX] Clip V1 real: start=' + clipStart.toFixed(3) + 's, inPoint=' + clipInPoint.toFixed(3) + 's vs manifest tlBlockInPointSec=' + (manifest.ref.tlBlockInPointSec || 0).toFixed(3) + 's');

            // (2026-09-25) FIX C (l'assignació es fa a la branca FIX-B, més amunt): si el manifest
            // està en coords d'ORIGEN (refBloc=953), la base del fitxer extret és wsms+refBloc.
            var worldSecMediaStart = manifest.ref.worldSecMediaStart || 0;
            if (_wsmsAdjust) {
                var _wsmsOrig = worldSecMediaStart;
                worldSecMediaStart = worldSecMediaStart + _wsmsAdjust;
                log('⚓ [ANCORATGE·FIX-C] Manifest en coords d\'ORIGEN: base del clip extret ' + _wsmsOrig.toFixed(2) + 's + refBloc ' + Number(_wsmsAdjust).toFixed(2) + 's → ' + worldSecMediaStart.toFixed(2) + 's');
            }

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
                // (2026-09-25) REFERÈNCIA = primer ítem amb OnAir REAL. Un ítem sense OnAir i amb
                // hora deduïda/prevista enverinada (04 P2-2: durada 0:00 → 14:00:48) arrossegava
                // TOT l'ancoratge (~103 s) i deixava els marcadors fora del material.
                var refLine = null;
                for (var _ri = 0; _ri < structuralItems.length; _ri++) {
                    var _oaR = structuralItems[_ri].horaEntradaOnAir;
                    if (_oaR && String(_oaR).trim() !== '' && String(_oaR) !== '00:00:00') { refLine = structuralItems[_ri]; break; }
                }
                if (refLine) {
                    refF1 = reader.tcToSeconds(refLine.horaEntradaOnAir);
                    refF1Origen = 'OnAir (1r EMÈS: ' + (refLine.num || '?') + ')';
                } else {
                    refLine = structuralItems[0];
                    var rfDeduced = reader._deduceOnAirEntrada(refLine, manifest.escaletaItems, null);
                    if (rfDeduced !== null) {
                        refF1 = rfDeduced;
                        refF1Origen = 'OnAirDeducido (1r: ' + (refLine.num || '?') + ')';
                    }
                }
            }

            var tlClipStartSec = clipStart + (refF1 - worldSecMediaStart) - offsetAnchor;

            var anchorEfectiva = anchorOnAirSec;
            var anchorEfOrigen = 'blockInSec (fallback)';
            if (structuralItems.length > 0) {
                // (2026-09-25) Igual que refF1: l'àncora EFECTIVA també ha de sortir del primer
                // ítem amb OnAir REAL (no d'un ítem amb hora deduïda enverinada).
                var firstLine = structuralItems[0];
                for (var _ai = 0; _ai < structuralItems.length; _ai++) {
                    var _oaA = structuralItems[_ai].horaEntradaOnAir;
                    if (_oaA && String(_oaA).trim() !== '' && String(_oaA) !== '00:00:00') { firstLine = structuralItems[_ai]; break; }
                }
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

            var anchorEfTimelineSec = clipStart + (anchorEfectiva - worldSecMediaStart) - offsetAnchor;

            // (2026-09-24) DIAGNÒSTIC D'ANCORATGE (bug "marker a 28"): es calculen les DUES
            // variants per poder comparar al log d'una sola ullada:
            //   · amb `clipInPoint` (inPoint del clip REAL de V1; pot ser el del fitxer
            //     extret — 22,04s a TNC — i llavors el càlcul queda esbiaixat)
            //   · amb `manifest.ref.tlBlockInPointSec` (referència del material del bloc)
            // En TREBALL/OUT&GO el resultat bo és el segon; en TEST el primer donava 1682,96s.
            var manifestInPoint = (manifest.ref && manifest.ref.tlBlockInPointSec) ? manifest.ref.tlBlockInPointSec : 0;
            var tlClipStartManifest = clipStart + (refF1 - worldSecMediaStart) - manifestInPoint;
            var anchorEfTLManifest = clipStart + (anchorEfectiva - worldSecMediaStart) - manifestInPoint;
            log('📍 [ANCORATGE·DUAL] clipStart=' + clipStart.toFixed(3) + 's · clipInPoint=' + clipInPoint.toFixed(3) + 's · manifest.tlBlockInPointSec=' + manifestInPoint.toFixed(3) + 's');
            log('📍 [ANCORATGE·DUAL] amb clip.inPoint → tlClipStart=' + tlClipStartSec.toFixed(3) + 's anchorEfTL=' + anchorEfTimelineSec.toFixed(3) + 's  ||  amb manifest → tlClipStart=' + tlClipStartManifest.toFixed(3) + 's anchorEfTL=' + anchorEfTLManifest.toFixed(3) + 's');
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
                // (2026-09-30) BUG #122: els marcadors GRÀFICS (grocs) NO voten el Δ: la seva
                // posició ve del seu PARE (D13, F6·Gràfics), no de l'emissió. Si voten, el Δ
                // s'omple de l'offset d'ancoratge (TNV V1 29/09: 4 GF apilats a 1,32s feien
                // Δ=-1,32s i arrossegaven el marcador OnAir "01" 1,32s ABANS dels seu corte).
                if (this._isGraphicByNum(prefix)) {
                    log('   🔬 [CorrelationSnap] Excloent gràfic ' + prefix + ' (' + markerTime.toFixed(2) + 's) → no vota el Δ');
                    continue;
                }
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
        /**
         * ensureExtractedRef: PREPARACIÓ D'ANCORATGE (2026-09-24) — s'invoca al PRINCIPI de
         * F1·OnAir perquè prémer les fases en ordre equivalgui a OUT&GO.
         *
         * Fa la part "de preparació de sessió" que a TREBALL fa el botó principal
         * (CREAR/ACTUALITZAR → EXTRACT): assegurar que `manifest.ref` estigui expressat en la
         * base del CLIP EXTRET del bloc. Si el manifest ve del cleanfeed sencer
         * (worldSecMediaStart=49500, tlBlockInPointSec=1685) mentre el timeline ja té el clip
         * extret, l'ancoratge queda 28 min fora i els marcadors cauen FORA del material.
         *
         * NO extreu res amb ffmpeg: només recalcula el ref si el clip del bloc ja existeix a la
         * carpeta de treball. Si no hi és, avisa clarament que cal CREAR/ACTUALITZAR.
         */
        ensureExtractedRef: async function (ctx) {
            try {
                if (!ctx || !ctx.config || !ctx.progData || !ctx.dateDir || !ctx.bloque) {
                    log('⚠️ [PREP-ANCORATGE] Sense context complet: no es pot verificar la base del manifest.', 'WARN');
                    return false;
                }
                const MF = window.FASTPASS_UI.SessionManifest;
                if (!MF || !MF.load) return false;
                const manifest = await MF.load(ctx);
                if (!manifest || !manifest.ref) return false;
                const ref = manifest.ref;

                const wms = Number(ref.worldSecMediaStart);
                const anchorRef = (ref.worldBlockAnchorSec !== undefined && ref.worldBlockAnchorSec !== null)
                    ? Number(ref.worldBlockAnchorSec) : Number(ref.worldBlockStartSec);
                const tbp = Number(ref.tlBlockInPointSec);

                // Invariant del manifest bo: worldSecMediaStart == worldBlockAnchorSec − tlBlockInPointSec
                if (isFinite(wms) && isFinite(anchorRef) && isFinite(tbp) && Math.abs(wms - (anchorRef - tbp)) <= 1.0) {
                    log('🧭 [PREP-ANCORATGE] Manifest ja en base del CLIP EXTRET (worldSecMediaStart=' + wms.toFixed(2) + 's) ✓');
                    return true;
                }

                // Cal el clip extret del bloc a la carpeta de treball: <WOTT>_<BLOC>_CLIP.mp4
                const expectedPrefix = (String(ctx.progData.wott || '') + '_' + String(ctx.bloque) + '_CLIP').toUpperCase();
                const folder = getUtils().workFolder(ctx);
                let files = [];
                try { files = await getUtils().readFolder(folder); } catch (eR) { files = []; }
                const names = (files || []).map(function (f) { return String((f && f.name) ? f.name : f).toUpperCase(); });
                var foundClip = null;
                for (var fi = 0; fi < names.length; fi++) {
                    if (names[fi].indexOf(expectedPrefix) === 0 && names[fi].indexOf('.MP4') !== -1) { foundClip = names[fi]; break; }
                }
                // (2026-09-24d) SEPARACIÓ DE CAPES (petició d'usuari): la capa de MARCADORS no
                // ha d'ESCRIURE mai el manifest (ref/IN/OUT) — això és territori dels BOUNDS i del
                // flux de creació (EXTRACT). ABANS aquesta funció reescrivia ref.worldSecMediaStart
                // / tlBlockInPointSec / mp4ExpandedInPoint / mp4Duration i, de retruc, desvirtuava
                // el recorte i l'extracció del clip. ARA només LLEGEIX i AVISA.
                if (!foundClip) {
                    log('⚠️ [PREP-ANCORATGE] El manifest NO està en base del clip extret i no trobo el clip del bloc (' + expectedPrefix + '*.mp4) a ' + folder + ' → prem CREAR/ACTUALITZAR (fase EXTRACT) abans de col·locar marcadors.', 'ERROR');
                    return false;
                }
                log('⚠️ [PREP-ANCORATGE] El manifest no està en base del clip extret (worldSecMediaStart=' + wms.toFixed(2) + 's vs refBloc=' + tbp.toFixed(2) + 's) i el clip del bloc ja existeix (' + foundClip + '). Els MARCADORS no el modifiquen: passa per CREAR/ACTUALITZAR (EXTRACT) perquè els BOUNDS el refacin. Continuant amb l\'ancoratge que hi hagi.', 'WARN');
                return false;
            } catch (ePrep) {
                log('⚠️ [PREP-ANCORATGE] ' + ePrep.message, 'WARN');
                return false;
            }
        },

        placeOnAirMarkers: async function () {
            log('🟢 [F1·OnAir] Iniciant col·locació independent...');

            // (2026-09-24) PREPARACIÓ D'ANCORATGE al principi de F1: amb això, prémer les fases
            // en ordre (F1 → F2 → …) té la MATEIXA funcionalitat que OUT&GO a la finestra de
            // treball, sense haver de prémer abans el botó principal (CREAR/ACTUALITZAR).
            try { await this.ensureExtractedRef(window.FASTPASS_UI.State); } catch (ePrepCall) { /* noop */ }

            const ctxData = await getAssemblyContext().loadAssemblyContext();
            if (!ctxData) { log('⚠️ [F1·OnAir] loadAssemblyContext ha fallat. Abortant.'); return; }
            const { manifest, reader, lines, clips, firstUngroupedItem, ungroupedItems } = ctxData;

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

                // (2026-09-17) ABANS: colorIdx fix 6 (blau), aixi que un item del bloc que
                // NO es del projecte (agrupacio==null) sortia blau i no es distingia.
                // Ara s'aplica MARKER_COLORS.md: 1=VERMELL (no verticalitzable),
                // 4=GROC (grafic), 6=BLAU (del projecte).
                var colorIdx = this._getColorIdx(line);

                log('   🟢 [F1·OnAir] ' + (line.num || '?') + ': → ' + safeT.toFixed(2) + 's');
                itemPositions.set(line.num, safeT);

                placements.push({
                    prefix: line.num,
                    timeSec: safeT,
                    comment: comment,
                    colorIdx: colorIdx,
                    // (2026-09-17) name='color=N': el color NO és llegible des de
                    // Markers.get() (retorna -1) i placeByPrefixes fa delete+create, així
                    // que el codi de color viatja al name (convenció ja usada a Markers.set).
                    name: 'color=' + colorIdx
                });
            }

            // ── Afegir ítems no agrupats intercalats (D12) ──
            // ── (2026-09-17) TOTS els ítems NO agrupats del bloc ──────────────
            // Cas: bloc en calent amb ítems que no són del projecte (sense V1).
            // ABANS només se'n marcava UN (firstUngroupedItem); ara es marquen TOTS.
            // (2026-10-05 · BUG #139) El color NO es força aquí: va SEMPRE per
            // `_getColorIdx`. Un IPD no agrupat és una interrupció EMESA dins el bloc
            // (turquesa, 7), no material aliè; amb `colorIdx: 1` fix el pintava VERMELL
            // i, a més, el filtre de vermells de `_safePlaceByPrefixes` el podia DESCARTAR.
            var _ugList = (ungroupedItems && ungroupedItems.length) ? ungroupedItems
                : (firstUngroupedItem ? [firstUngroupedItem] : []);
            for (var _ugi = 0; _ugi < _ugList.length; _ugi++) {
                var _ug = _ugList[_ugi];
                var _ugOnAir = _ug.horaEntradaOnAir;
                var _ugHasOnAir = _ugOnAir && _ugOnAir !== '00:00:00' && String(_ugOnAir).trim() !== '';
                if (!_ugHasOnAir) continue;
                var _ugOnAirSec = reader.tcToSeconds(_ugOnAir);
                if (_ugOnAirSec === null || _ugOnAirSec === undefined) continue;
                var _ugPosSec = tlClipStartSec + (_ugOnAirSec - refF1);
                if (!(_ugPosSec >= 0)) continue;
                var _ugComment = ((_ug.num ? _ug.num + ' - ' : '') + (_ug.titol || '').substring(0, 60)).trim();
                var _ugColor = this._getColorIdx(_ug);
                placements.push({
                    prefix: _ug.num,
                    timeSec: _ugPosSec,
                    comment: _ugComment,
                    colorIdx: _ugColor,
                    name: 'color=' + _ugColor
                });
                log('   ' + (_ugColor === 1 ? '🔴' : '🔷') + ' [F1·Ungrouped] ' + (_ug.num || '?') + ': → ' + _ugPosSec.toFixed(2) + 's [color ' + _ugColor + (_ugColor === 1 ? ': no es del bloc' : ': IPD dins el bloc') + ']');
            }
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
                            var ugColor = this._getColorIdx(firstUngroupedItem);
                            placements.push({
                                prefix: firstUngroupedItem.num,
                                timeSec: ugPosSec,
                                comment: ugComment,
                                colorIdx: ugColor,
                                name: 'color=' + ugColor
                            });
                            log('   ' + (ugColor === 1 ? '🔴' : '🔷') + ' [F1·Ungrouped] ' + (firstUngroupedItem.num || '?') + ': → ' + ugPosSec.toFixed(2) + 's [color ' + ugColor + ']');
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

        /**
         * placeUngroupedMarkers (2026-09-29 · BUG #110): col·loca els marcadors dels ítems
         * que NO són del bloc (`agrupacio:null`, `ungroupedItems`). El color surt SEMPRE de
         * `_getColorIdx` → 1 (VERMELL) per al material aliè i 7 (TURQUESA) per als IPD,
         * que són interrupcions EMESES dins el bloc (2026-10-05 · BUG #139).
         *
         * PER QUÈ UN MÈTODE PROPI: els vermells només es creaven dins de `placeOnAirMarkers`
         * (F1), i això tenia dos forats:
         *   1. `placeOnAirMarkers` NO forma part del pipeline automàtic (js/main.js
         *      `runFullPipelineOut`), tot i que el seu docstring diu que sí → en el flux
         *      OUT&GO no es col·locava MAI cap vermell.
         *   2. El bucle de no agrupats exigia `horaEntradaOnAir` (`if (!_ugHasOnAir) continue;`)
         *      → qualsevol ítem no agrupat sense OnAir (cas real 28/09 TNV_V2: `02dir`
         *      "LIN DIRECTE PUERTA DEL SOL", agrupacio:null, prevista 21:05:34) es quedava
         *      sense marcador vermell.
         * Aquí s'usa OnAir i, si no n'hi ha, `horaEntradaPrevista`.
         *
         * SEGURETAT: només AFEGEIX/MOU els seus propis prefixes (placeByPrefixes fa upsert
         * per prefix). No esborra ni toca cap altre marcador.
         */
        placeUngroupedMarkers: async function () {
            log('🔴 [Ungrouped] Col·locant marcadors dels ítems no agrupats (VERMELL; els IPD → TURQUESA)...');
            try { await this.ensureExtractedRef(window.FASTPASS_UI.State); } catch (ePrepUg) { /* noop */ }

            const ctxData = await getAssemblyContext().loadAssemblyContext();
            if (!ctxData) { log('⚠️ [Ungrouped] loadAssemblyContext ha fallat. Abortant.'); return; }
            const { manifest, reader, lines, clips, ungroupedItems } = ctxData;

            const list = (ungroupedItems && ungroupedItems.length) ? ungroupedItems : [];
            if (list.length === 0) { log('🔴 [Ungrouped] Cap ítem no agrupat dins del bloc. ✓ FINALITZAT.'); return; }

            const structuralItems = this._classifyItems(lines).structuralItems;
            const anchors = this._calcTemporalAnchors(manifest, reader, structuralItems, clips);
            if (!anchors) { log('⚠️ [Ungrouped] _calcTemporalAnchors ha fallat. Abortant.'); return; }
            const { tlClipStartSec, refF1 } = anchors;
            if (refF1 === null) { log('⚠️ [Ungrouped] Sense referència F1. Abortant.'); return; }

            var placements = [];
            for (var i = 0; i < list.length; i++) {
                var ug = list[i];
                var tc = ug.horaEntradaOnAir;
                var tcOnAir = tc && tc !== '00:00:00' && String(tc).trim() !== '';
                if (!tcOnAir) tc = ug.horaEntradaPrevista;   // (BUG #110) fallback a la prevista
                if (!tc || tc === '00:00:00' || String(tc).trim() === '') {
                    log('   ⏭️ [Ungrouped] ' + (ug.num || '?') + ': sense OnAir ni prevista. Saltant.');
                    continue;
                }
                var tSec = reader.tcToSeconds(tc);
                if (tSec === null || tSec === undefined) continue;
                var pos = tlClipStartSec + (tSec - refF1);
                if (!(pos >= 0)) {
                    log('   ⏭️ [Ungrouped] ' + (ug.num || '?') + ': cau fora del clip (' + pos.toFixed(2) + 's). Saltant.');
                    continue;
                }
                // (2026-10-05 · BUG #140) AJUST AL CORTE MÉS PROPER: aquesta fase és l'ÚLTIMA
                // del pipeline OUT&GO (js/main.js runFullPipelineOut), o sigui que corre
                // DESPRÉS de F4·Faro. Sense imantar, l'upsert per prefix de placeByPrefixes
                // tornava a deixar el marcador a la posició IDEAL (OnAir/prevista crua) i
                // DESFEIA el snap que F4 ja havia fet → els IPD no quedaven clavats al tall
                // (queixa d'usuari 2026-10-05). S'usa el MATEIX motor que F4 (_chooseSnapTarget)
                // i la mateixa finestra: OnAir → snapWindowFaroSec; només prevista → snapWindowDeducedSec.
                pos = this._imantAlCorte(pos, clips, tcOnAir, 'Ungrouped ' + (ug.num || '?'));
                var comment = ((ug.num ? ug.num + ' - ' : '') + (ug.titol || '').substring(0, 60)).trim();
                // (2026-10-05 · BUG #139) El color NO es força a 1: aquesta fase és l'ÚLTIMA
                // del pipeline OUT&GO (js/main.js runFullPipelineOut), de manera que un
                // `colorIdx: 1` fix tornava a pintar de VERMELL l'IPD que F2/F3/F5 ja havien
                // col·locat bé (el marcador s'upserta per prefix). Un IPD → 7 (turquesa);
                // la resta d'aliens al bloc → 1 (vermell).
                var ugColor = this._getColorIdx(ug);
                placements.push({ prefix: ug.num, timeSec: pos, comment: comment, colorIdx: ugColor, name: 'color=' + ugColor });
                log('   ' + (ugColor === 1 ? '🔴' : '🔷') + ' [Ungrouped] ' + (ug.num || '?') + ': → ' + pos.toFixed(2) + 's [color ' + ugColor + (ugColor === 1 ? ': no és del bloc' : ': IPD dins el bloc') + ' · ref ' + tc + (tcOnAir ? ' OnAir' : ' prevista') + ']');
            }

            if (placements.length === 0) { log('🔴 [Ungrouped] Cap marcador per col·locar. ✓ FINALITZAT.'); return; }
            var result = await this._safePlaceByPrefixes(placements, 'Ungrouped');
            log('🔴 [Ungrouped] Moguts: ' + (result.moved || 0) + ' | Nous: ' + (result.created || 0) + ' | Total: ' + (result.placed || 0) + '. ✓ FINALITZAT.');
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

            // (2026-09-17) El marcador d'inici (00:00) és el del PRIMER ÍTEM ESTRUCTURAL del
            // bloc recorregut en ORDRE D'ESCALETA (`lines`, que ve de manifest.escaletaItems
            // filtrat pel bloc) — MAI en ordre de TC: ordenar per TC és el que fa entrar els
            // OnAir mentiders (el realitzador llança ítems abans del programa). Cas TNC: el
            // 1r estructural és "08i" (va abans del "10" a l'escaleta). L'usuari confirma
            // manualment on comença l'ítem clicant IN, per tant aquest marcador viu a 0 i
            // porta el seu número i nom.
            var startItem = null;
            for (var ls0 = 0; ls0 < lines.length; ls0++) {
                var cand0 = lines[ls0];
                if (!cand0 || !cand0.num) continue;
                if (reader.isItemEstructural(cand0)) { startItem = cand0; break; }
            }
            var placedByStart = {};
            if (startItem && startItem.num) {
                var startNum = String(startItem.num);
                var hasStartMarker = false;
                for (var mi2 = 0; mi2 < allMarkersF2.length; mi2++) {
                    var mk2 = allMarkersF2[mi2];
                    if (typeof mk2.time === 'number' && Math.abs(mk2.time) < 0.02) {
                        if (_extractPrefixF2(mk2.comments || '') === startNum) { hasStartMarker = true; break; }
                    }
                }
                if (!hasStartMarker) {
                    var startTitol = (startItem.titol || '').substring(0, 60).trim();
                    var startComment = startTitol ? (startNum + ' - ' + startTitol) : startNum;
                    placements.push({ prefix: startNum, timeSec: 0, comment: startComment, colorIdx: 6, name: 'color=6' });
                    itemPositions.set(startNum, 0);
                    placedByStart[startNum] = true;
                    log('🟠 [F2·Deduced] Marcador d\'inici: "' + startComment + '" a 00:00 (1r ítem del bloc)');
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

                if (hasOnAir || faroPositions[lineNum] !== undefined) continue; // F1 ja l'ha col·locat

                // Saltar l'ítem d'inici: ja té el seu marcador a 00:00 (vegeu més amunt)
                if (lineNum && placedByStart[lineNum]) {
                    log('   ⏭️ [F2·Deduced] ' + lineNum + ': ja col·locat a 00:00. Saltant.');
                    continue;
                }

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
            var snapDeltaReal = (snapResult && snapResult.delta !== null) ? snapResult.delta : 0;
            // (2026-09-24) FIX · DOBLE APLICACIÓ DEL Δ: la fase dedicada al Δ de correlació és
            // F3.5·CorrelationSnap (té la seva pròpia confiança/log i s'executa a continuació).
            // ABANS F3 també l'aplicava → el mateix Δ s'aplicava DUES vegades
            // (F3 −1,16s + F3.5 −1,16s = −2,32s) i el marcador quedava ~1,8s ABANS del seu corte
            // (queixa d'usuari 2026-09-24: "el marcador del vídeo … se mueve a unos frames antes").
            // Ara F3 només l'INFORMA; qui l'aplica és F3.5.
            var snapDelta = 0;
            log('   🟢 [F3·Coinc] Δ snap (informatiu: l\'aplica F3.5·CorrelationSnap) = ' + snapDeltaReal.toFixed(3) + 's (confiança=' + (snapResult.confidence * 100).toFixed(0) + '%)');

            var placements = [];

            for (var si = 0; si < structuralItems.length; si++) {
                var line = structuralItems[si];
                var onAir = line.horaEntradaOnAir;
                var hasOnAir = onAir && onAir !== '00:00:00' && onAir.trim() !== '';

                // F3·Coinc: només afina faros (OnAir real). Saltar deduïts i previstos.
                if (!hasOnAir) continue;

                // (2026-09-24) NO TOCAR EL MARCADOR D'INICI DEL BLOC: F2 col·loca el marcador del
                // 1r ítem del bloc a 00:00 ("Marcador d'inici"). F3 no el pot tornar a la seva
                // OnAir, si no el 00:00 desapareix (queixa d'usuari 2026-09-24: "per què no
                // apareix el marker de 00:00?"). Es detecta pel prefix del comentari.
                var _mkActualF3 = null;
                for (var mf3 = 0; mf3 < existingMarkers.length; mf3++) {
                    var _pf3 = this._extractPrefixFromComment(existingMarkers[mf3].comments || '');
                    if (_pf3 && String(_pf3).toLowerCase() === String(line.num || '').toLowerCase()) {
                        _mkActualF3 = Number(existingMarkers[mf3].time);
                        break;
                    }
                }
                if (_mkActualF3 !== null && isFinite(_mkActualF3) && _mkActualF3 <= 0.15) {
                    log('   ⏭️ [F3·Coinc] ' + (line.num || '?') + ': marcador d\'inici a 00:00 → no es mou (el protegeix F2)');
                    continue;
                }

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
         * correlationSnapMarkers: F3.5·CorrelationSnap — Entry point del botó F3.5 i de la
         * fase 6 del pipeline OUT&GO.
         * Aplica el Δ de consens NOMÉS a OnAir i Deducits (no toca Previstos ni 'definitiu').
         *
         * (2026-09-24) AQUESTA FASE S'HAVIA PERDUT: el refactor que va dividir flow_assembly en
         * 4 dominis (commit 2542aa8) no la va portar a flow_markers, i tant el botó F3.5 (TEST)
         * com el pipeline OUT&GO cridaven `Assembly.correlationSnapMarkers`, que no existia →
         * callWorkflow fallava EN SILENCI (console.error "no existe"). Restaurada des de git
         * (2542aa8^:js/workflows/flow_assembly.js) amb els noms actuals.
         */
        correlationSnapMarkers: async function () {
            log('🟠 [F3.5·CorrelationSnap] Iniciant snapeig per correlació (OnAir+Deducit)...');

            // ── Pas 1: Context ──
            const ctxData = await getAssemblyContext().loadAssemblyContext();
            if (!ctxData) { log('⚠️ [F3.5·CorrelationSnap] loadAssemblyContext ha fallat. Abortant.'); return; }
            const { manifest, reader, clips } = ctxData;

            // ── Pas 2: Petjada de densitat ──
            const densityData = this._calcDensityFootprint(clips);
            log('   🔸 [F3.5] DensityFootprint: ' + (densityData && densityData.breaks ? densityData.breaks.length : 0) + ' breaks.');

            // ── Pas 3: Marcadors actuals del timeline ──
            var markersRaw = await callJSX('Markers.get()');
            var allMarkers = [];
            try { allMarkers = JSON.parse(markersRaw); } catch (e) { allMarkers = []; }
            log('   🔸 [F3.5] Marcadors al timeline: ' + allMarkers.length);

            // ── Pas 4: Només OnAir + Deducits (els Previstos els tracta F4) ──
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
                if (onAir && onAir !== '00:00:00' && String(onAir).trim() !== '') return true;
                var deduced = reader._deduceOnAirEntrada(item, manifestItems, null);
                return deduced !== null;
            };
            var candidateMarkers = [];
            var skippedPrevistos = 0;
            var skippedGraphics35 = 0;
            for (var i = 0; i < allMarkers.length; i++) {
                var mk = allMarkers[i];
                if (mk.name === 'definitiu') continue;
                var prefix = _extractPrefix35(mk.comments || '');
                // (2026-09-30) BUG #122: els GRÀFICS (grocs) queden FORA del Δ — la seva
                // posició la mana F6·Gràfics (ancorats al pare, D13), no l'emissió.
                if (this._isGraphicByNum(prefix)) { skippedGraphics35++; continue; }
                if (_isOnAirOrDeduced(prefix)) candidateMarkers.push(mk);
                else skippedPrevistos++;
            }
            log('   🔸 [F3.5] OnAir+Deducit: ' + candidateMarkers.length + ' | Previstos saltats: ' + skippedPrevistos + ' | Gràfics saltats: ' + skippedGraphics35);
            if (candidateMarkers.length === 0) {
                log('🟠 [F3.5·CorrelationSnap] Cap marcador OnAir/Deducit no-definitiu. ✓ FINALITZAT.');
                return;
            }

            // ── Pas 5: Δ consensuat ──
            var snapResult = this._correlationSnap(candidateMarkers, clips, densityData, manifest.escaletaItems, reader);
            if (!snapResult || snapResult.delta === null) {
                log('🟠 [F3.5·CorrelationSnap] Sense Δ fiable (confiança=' + (((snapResult && snapResult.confidence) || 0) * 100).toFixed(0) + '%). ✓ FINALITZAT.');
                return;
            }

            // ── Pas 6: Aplicar el Δ als candidats ──
            var delta = snapResult.delta;
            log('   🔸 [F3.5] Aplicant Δ=' + delta.toFixed(3) + 's a ' + candidateMarkers.length + ' marcadors...');

            var placements = [];
            for (var j = 0; j < candidateMarkers.length; j++) {
                var cmk = candidateMarkers[j];
                var cmkTime = (typeof cmk.time === 'number' ? cmk.time : parseFloat(cmk.time));
                // El marcador a ~0.00s NO rep Δ (l'histograma de _correlationSnap ja l'exclou).
                var correctedTime = (cmkTime < 0.01) ? 0 : (cmkTime + delta);
                if (correctedTime < 0) correctedTime = 0;

                var comment = cmk.comments || '';
                var pfx35 = _extractPrefix35(comment);
                if (!pfx35) {
                    log('   ⚠️ [F3.5] Marcador sense prefix detectable a ' + cmk.time + 's. Saltant.');
                    continue;
                }

                // Si el marcador existent no té color vàlid, derivar-lo de l'ítem d'escaleta.
                var colorIdx = (typeof cmk.color === 'number' && cmk.color >= 0) ? cmk.color : null;
                if (colorIdx === null && prefixToItem[pfx35]) colorIdx = this._getColorIdx(prefixToItem[pfx35]);

                placements.push({
                    prefix: pfx35,
                    timeSec: correctedTime,
                    comment: comment,
                    name: 'definitiu',
                    colorIdx: colorIdx
                });

                log('   🔸 [F3.5] ' + pfx35 + ': ' + cmkTime.toFixed(2) + 's → ' + correctedTime.toFixed(2) + 's [Δ=' + delta.toFixed(3) + 's]');
            }

            if (placements.length === 0) {
                log('🟠 [F3.5·CorrelationSnap] Cap placement construït. ✓ FINALITZAT.');
                return;
            }

            var result = await this._safePlaceByPrefixes(placements, 'F3.5·CorrelationSnap');
            log('🟠 [F3.5·CorrelationSnap] Moguts: ' + (result.moved || 0) + ' | Nous: ' + (result.created || 0) + ' | Total: ' + (result.placed || 0) + ' | Δ=' + delta.toFixed(3) + 's | confiança=' + (snapResult.confidence * 100).toFixed(0) + '%. ✓ FINALITZAT.');
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
            // 2026-09-24 (FIX B): pujat de 1,5 -> 2,5 s. Amb el clip extret, l'error
            // residual d'ancoratge pot arribar a ~2 s (TNC: el marcador de l'ítem 11
            // quedava a 12,96s i el tall que obre la seva peça és a 15,12s → Δ=2,16s >
            // 1,5s → F4 no el tocava i deia "Cap marcador per ajustar"). Amb 2,5 s el
            // faro salta al TALL D'OBERTURA (inici real de la seva peça), que és el punt
            // correcte. Configurable a Profile.json → general.snapWindowFaroSec.
            return (isFinite(w) && w > 0) ? w : 2.5;
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
        /**
         * _isOnCut: Retorna el temps del tall (start o end d'un clip de V1) si `tSec` coincideix
         * amb un tall (±0,15s), o null si no.
         * (2026-09-24) S'usa a F6·Ordre per NO moure un marcador que ja està clavat al seu corte:
         * els clamps de ±0,5s el tornaven a desviar uns frames (queixa d'usuari 2026-09-24).
         */
        _isOnCut: function (tSec, clips) {
            var arr = clips || [];
            for (var i = 0; i < arr.length; i++) {
                var cs = Number(arr[i] && arr[i].start), ce = Number(arr[i] && arr[i].end);
                if (isFinite(cs) && Math.abs(cs - tSec) <= 0.15) return cs;
                if (isFinite(ce) && Math.abs(ce - tSec) <= 0.15) return ce;
            }
            return null;
        },

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
         * _ordenarISeparar: (2026-09-24) PAS 1 del nou ordre de treball (a petició d'usuari):
         * ABANS de calcular els breaks de densitat, els marcadors queden ORDENATS i SEPARATS al
         * timeline segons l'ordre d'escaleta (`sequencia`). Sense això, els clamps de ±0,5s de
         * F2/F6 deixaven marcadors superposats (conexió + IPD al mateix segon) i F4 intentava
         * imantar sobre un timeline desordenat.
         * - Recorre els marcadors en ordre d'escaleta.
         * - Si l'actual cau a menys de GAP del predecessor: si NO està protegit (inici de bloc
         *   ≤0,15s o clavat en un corte real) s'empeny a `anterior + GAP`; si està protegit,
         *   s'aparta el PREDECESSOR a `actual − GAP` (respectant sempre el corte del protegit).
         * - Mai s'avança un marcador per davant del seu predecessor.
         * @returns {Object} { revisats, moguts, gap }
         */
        _ordenarISeparar: async function (manifest, clips, gap) {
            // (2026-09-24) GAP per defecte 3,0s (a petició d'usuari: "el gap ha de ser de al
            // menys 3 segons entre marcadors"). Els marcadors del bloc (conexió, IPD, donapas)
            // necessiten aire: amb 0,5s F2/F6 els deixaven massa junts o superposats.
            var GAP = (isFinite(Number(gap)) && Number(gap) > 0) ? Number(gap) : 3.0;
            var raw = null;
            try { raw = await callJSX('Markers.get()'); } catch (eG) { raw = null; }
            var mks = [];
            try { mks = raw ? JSON.parse(raw) : []; } catch (eP) { mks = []; }
            if (!mks || mks.length < 2) return { revisats: (mks ? mks.length : 0), moguts: 0, gap: GAP };

            var seqByNum = {}, onAirByNum = {};
            var all = (manifest && manifest.escaletaItems) ? manifest.escaletaItems : [];
            for (var i = 0; i < all.length; i++) {
                var it = all[i];
                if (!it || !it.num) continue;
                var nk = String(it.num);
                if (seqByNum[nk] == null) seqByNum[nk] = (it.sequencia != null && isFinite(Number(it.sequencia))) ? Number(it.sequencia) : i;
                var oa = it.horaEntradaOnAir;
                onAirByNum[nk] = !!onAirByNum[nk] || !!(oa && oa !== '00:00:00' && String(oa).trim() !== '');
            }
            var list = [];
            for (var m = 0; m < mks.length; m++) {
                var pfx = this._extractPrefixFromComment(mks[m].comments || '');
                var t = Number(mks[m].time);
                if (!pfx || !isFinite(t)) continue;
                list.push({ prefix: pfx, time: t, comment: mks[m].comments || '', seq: (seqByNum[pfx] != null ? seqByNum[pfx] : 9999) });
            }
            if (list.length < 2) return { revisats: list.length, moguts: 0, gap: GAP };
            list.sort(function (a, b) { return a.seq - b.seq; });

            // (2026-09-29) BUG #108: aquesta fase movia marcadors amb placements SENSE
            // colorIdx → delete+create → color per defecte (VERD). El color es recalcula
            // des de l'escaleta del manifest (Markers.get() no el retorna).
            var colorByNumSep = this._colorByNumFromManifest(manifest);

            var placements = [], moguts = 0, anterior = null;
            for (var k = 0; k < list.length; k++) {
                var cur = list[k];
                // (2026-09-24) PROTECCIÓ CONDICIONAL (correcció del cas "markers apilotonats"):
                // un marcador sobre un corte NOMÉS està protegit si NO comparteix el punt amb un
                // altre marcador. Si dos ítems cauen al MATEIX corte (o a <0,20s), el corte està
                // ocupat per dos ítems → NO es protegeix cap i cal separar-los: el primer es queda
                // al seu corte (p.ex. la CONEXIÓ al corte que tanca el donapas = 29,20s) i els
                // següents (IPD) passen als cortes següents amb GAP≥3s.
                // (2026-09-24b) PRIORITAT OnAir (petició d'usuari): un ítem AMB OnAir (el vídeo)
                // NO es mou MAI per la separació: el seu imant al corte és sagrat (encertar el
                // frame des del TC és impossible). Si xoca amb un altre, es mou l'ALTRE.
                var esOnAir = onAirByNum[cur.prefix] === true;
                var comparteix = (anterior !== null) && (Math.abs(cur.time - anterior.time) <= 0.20);
                // (2026-09-25) FIX 00:00: el marcador d'inici de bloc és IMMUTABLE SEMPRE, també
                // quan comparteix punt amb un altre (cas 04 P2-2 + 04i: la passa de separació movia
                // el d'inici ✗). També són intocables els marcadors CONGELATS per una capa anterior.
                var esInici = (cur.time <= 0.15) || (cur.prefix === this._iniciPrefix) ||
                    (this._frozen && this._frozen[String(cur.prefix).toLowerCase()] === true);
                var protegit = esOnAir || esInici || (!comparteix && (this._isOnCut(cur.time, clips) !== null));
                if (anterior !== null && cur.time < anterior.time + GAP) {
                    if (!protegit) {
                        var minT = anterior.time + GAP;
                        var nou = minT;
                        // (2026-09-24) ANTI-ACUMULACIÓ (petició d'usuari): en lloc d'empènyer
                        // sempre +GAP (que amb diversos marcadors junts arrossega l'error), es
                        // prefereix el SEGÜENT CORT REAL ≥ anterior+GAP (dins de GAP+6s) que NO
                        // estigui ja ocupat per un altre marcador.
                        var ocupatPer = function (t2) {
                            for (var mk2 = 0; mk2 < list.length; mk2++) {
                                if (list[mk2] === cur) continue;
                                if (Math.abs(Number(list[mk2].time) - t2) <= 0.25) return true;
                            }
                            return false;
                        };
                        var cutTrobat = null;
                        for (var ci2 = 0; ci2 < (clips || []).length; ci2++) {
                            var cs2 = Number(clips[ci2] && clips[ci2].start);
                            var ce2 = Number(clips[ci2] && clips[ci2].end);
                            if (isFinite(cs2) && cs2 >= minT - 0.05 && cs2 <= minT + 8.0 && !ocupatPer(cs2) && (cutTrobat === null || cs2 < cutTrobat)) cutTrobat = cs2;
                            if (isFinite(ce2) && ce2 >= minT - 0.05 && ce2 <= minT + 8.0 && !ocupatPer(ce2) && (cutTrobat === null || ce2 < cutTrobat)) cutTrobat = ce2;
                        }
                        if (cutTrobat !== null) nou = cutTrobat;
                        log('   🔧 [SEP] ' + cur.prefix + ': ' + cur.time.toFixed(2) + 's → ' + nou.toFixed(2) + 's (GAP ' + GAP + 's després de ' + anterior.prefix + (cutTrobat !== null ? ', corte ' + cutTrobat.toFixed(2) + 's' : ', sense corte lliure a prop') + (comparteix ? ' [corte compartit]' : '') + ') [Δ ' + (nou - cur.time).toFixed(2) + 's]');
                        placements.push({ prefix: cur.prefix, timeSec: parseFloat(nou.toFixed(2)), comment: cur.comment, colorIdx: (colorByNumSep[cur.prefix] != null ? colorByNumSep[cur.prefix] : 6) });
                        cur.time = nou;
                        moguts++;
                    } else {
                        var antProtegit = (anterior.time <= 0.15) || (onAirByNum[anterior.prefix] === true) || (this._isOnCut(anterior.time, clips) !== null);
                        if (!antProtegit) {
                            // (2026-09-24) No es pot apartar el predecessor si xocaria amb l'inici
                            // de bloc (00:00): es deixa i s'avisa (PAS 2 el re-ancorarà).
                            var nouAnt = cur.time - GAP;
                            if (nouAnt < 0.5) {
                                log('   ⚠️ [SEP] ' + anterior.prefix + ' no es pot apartar sense xocar amb l\'inici de bloc → es deixa (ho resol PAS 2)');
                            } else {
                                log('   🔧 [SEP] ' + anterior.prefix + ': ' + anterior.time.toFixed(2) + 's → ' + nouAnt.toFixed(2) + 's (' + cur.prefix + ' està protegit a ' + cur.time.toFixed(2) + 's)');
                                placements.push({ prefix: anterior.prefix, timeSec: parseFloat(nouAnt.toFixed(2)), comment: anterior.comment, colorIdx: (colorByNumSep[anterior.prefix] != null ? colorByNumSep[anterior.prefix] : 6) });
                                anterior.time = nouAnt;
                                moguts++;
                            }
                        } else {
                            log('   ⚠️ [SEP] ' + anterior.prefix + ' i ' + cur.prefix + ' estan a ' + (cur.time - anterior.time).toFixed(2) + 's però tots dos estan protegits → no es mou cap');
                        }
                    }
                }
                anterior = cur;
            }
            if (placements.length > 0) {
                var res = await this._safePlaceByPrefixes(placements, 'SEP·Ordre-GAP');
                log('   🔧 [SEP·Ordre-GAP] aplicat → ' + JSON.stringify(res));
            }
            log('🔧 [SEP·Ordre-GAP] Revisats ' + list.length + ' marcadors · ajustats ' + moguts + ' (GAP=' + GAP + 's)');
            return { revisats: list.length, moguts: moguts, gap: GAP };
        },

        /**
         * _asignarAnclasPorDuracion: (2026-09-24) PAS 2 (petició d'usuari): els ítems SENSE OnAir
         * (conexió, IPD…) no es poden situar per prevista+durada (dóna posicions errònies i
         * apilades: 01dir a 60.28s i IPD Zelensky a 60.32s). S'ancoren als CORTES que tanquen els
         * clips LLARGS (els breaks de densitat, que hi coincideixen 1:1) i, si se n'acaben, als
         * cortes dels plans MEDIOS (3–12s), sempre en ORDRE d'escaleta i amb GAP≥gap entre
         * marcadors. Els ítems amb OnAir (el vídeo) NO es toquen i els CORTS (<3s) no anclen.
         * @returns {Object} { assignats, ancles, gap }
         */
        _asignarAnclasPorDuracion: async function (manifest, clips, gap) {
            var GAP = (isFinite(Number(gap)) && Number(gap) > 0) ? Number(gap) : 3.0;
            var raw = null, mks = [];
            try { raw = await callJSX('Markers.get()'); } catch (e0) { raw = null; }
            try { mks = raw ? JSON.parse(raw) : []; } catch (e1) { mks = []; }
            if (!mks || mks.length === 0) return { assignats: 0, ancles: 0, gap: GAP };

            var seqByNum = {}, onAirByNum = {};
            var all = (manifest && manifest.escaletaItems) ? manifest.escaletaItems : [];
            for (var i = 0; i < all.length; i++) {
                var it = all[i];
                if (!it || !it.num) continue;
                var nk = String(it.num);
                if (seqByNum[nk] == null) seqByNum[nk] = (it.sequencia != null && isFinite(Number(it.sequencia))) ? Number(it.sequencia) : i;
                var oa = it.horaEntradaOnAir;
                onAirByNum[nk] = !!onAirByNum[nk] || !!(oa && oa !== '00:00:00' && String(oa).trim() !== '');
            }

            // Ancles: breaks de densitat (= cortes de clips LLARGS) + cortes de plans MEDIOS
            var ancles = [], seen = {};
            var dens = null;
            try { dens = this._calcDensityFootprint(clips); } catch (eD) { dens = null; }
            if (dens && dens.breaks) {
                for (var b = 0; b < dens.breaks.length; b++) {
                    var tb = Number(dens.breaks[b].time);
                    if (isFinite(tb) && !seen[tb.toFixed(2)]) { seen[tb.toFixed(2)] = true; ancles.push({ t: tb, tipus: 'break·clip-llarg' }); }
                }
            }
            for (var c2 = 0; c2 < (clips || []).length; c2++) {
                var cs = Number(clips[c2] && clips[c2].start), ce = Number(clips[c2] && clips[c2].end);
                var dur = (isFinite(cs) && isFinite(ce)) ? (ce - cs) : 0;
                if (!(dur >= 3.0 && dur <= 12.0)) continue;   // MEDIOS 3-12s (CORTS <3s no anclen)
                if (isFinite(cs) && !seen[cs.toFixed(2)]) { seen[cs.toFixed(2)] = true; ancles.push({ t: cs, tipus: 'corte·medi' }); }
            }
            ancles.sort(function (a, b2) { return a.t - b2.t; });
            if (ancles.length === 0) return { assignats: 0, ancles: 0, gap: GAP };

            var ocup = {};
            for (var m = 0; m < mks.length; m++) { var t2 = Number(mks[m].time); if (isFinite(t2)) ocup[t2.toFixed(2)] = true; }

            // Objectiu: ítems sense OnAir (els que depenen de l'estructura del vídeo)
            var objectiu = [];
            for (var k = 0; k < mks.length; k++) {
                var pfx = this._extractPrefixFromComment(mks[k].comments || '');
                if (!pfx) continue;
                if (onAirByNum[pfx]) continue;                 // el vídeo mana, no es toca
                var tk = Number(mks[k].time);
                if (!isFinite(tk)) continue;
                // (2026-09-24c) NO RE-ANCORAR ELS DONAPAS: el seu lloc NO és una deducció dèbil —
                // ve de la CADENA DURA (OnAir de l'ítem anterior + durada, "Tier0-IN
                // cross-agrupació") i és correcte. PAS 2 els movia a un break qualsevol i quedaven
                // lluny del seu lloc real (queixa d'usuari 2026-09-24). Es detecta pel sufix del
                // num ("dp" → 01dp) i pel títol ("donapas"/"dona pas").
                var numLow = String(pfx).toLowerCase();
                var titolLow = String(mks[k].comments || '').toLowerCase();
                if (numLow.indexOf('dp') === numLow.length - 2 || titolLow.indexOf('donapas') !== -1 || titolLow.indexOf('dona pas') !== -1) {
                    log('   ⏭️ [ASIG] ' + pfx + ': DONAPAS (cadena dura amb l\'OnAir anterior) → no es re-ancora');
                    continue;
                }
                // (2026-09-24) EL MARCADOR D'INICI (00:00) ÉS IMMUTABLE — "el FARO DE LOS FAROS":
                // l'usuari ja ha col·locat el corte d'IN a mà i TOTES les posicions es calculen
                // respecte a ell. Cap fase (ni aquesta) no el pot moure: si entrava a la llista
                // d'objectius, PAS 2 el re-ancorava (p.ex. a 27,32s) i arrossegava la resta
                // (conexió, IPD, grafismes) fora de lloc.
                if (tk <= 0.15) {
                    log('   ⏭️ [ASIG] ' + pfx + ': marcador d\'inici a 00:00 → IMMUTABLE (faro de faros)');
                    continue;
                }
                objectiu.push({ prefix: pfx, time: tk, comment: mks[k].comments || '', seq: (seqByNum[pfx] != null ? seqByNum[pfx] : 9999) });
            }
            objectiu.sort(function (a, b3) { return a.seq - b3.seq; });

            // (2026-09-29) BUG #108: aquesta fase (F4·ASIG) re-ancorava marcadors amb
            // placements SENSE colorIdx → delete+create → VERD per defecte. Cas real
            // 28/09 TNV_V2: `01dir` va quedar verd (audit log 10:59:07, placeByPrefixes
            // sense colorIdx). El color es recalcula des de l'escaleta del manifest.
            var colorByNumAsig = this._colorByNumFromManifest(manifest);

            var placements = [], anterior = 0, assignats = 0, idxA = 0;
            for (var o = 0; o < objectiu.length; o++) {
                var cur = objectiu[o];
                // (2026-09-30 · BUG #123) ABANS: es triava la PRIMERA ancla lliure en ordre
                // d'escaleta, encara que quedés molt lluny de l'ítem (cas TNV_V2 30/09:
                // `16dir` a 41,60s → ancla 18,00s, Δ=-23,60s, i això arrossegava `16dp`
                // a 15,00s via SEP). ARA: s'escull l'ancla MÉS PROPERA a la posició actual
                // de l'ítem, amb penalització per a les ancles 'corte·medi' (es prefereix
                // una ruptura de clip llarg), amb xarxa de seguretat MAX_NEAR.
                var MAX_NEAR = 15.0, PENALITZACIO_MEDI = 2.0;
                var triat = null, bestIdx = -1, bestCost = Infinity, primer = null, primerIdx = -1;
                for (var a2 = idxA; a2 < ancles.length; a2++) {
                    var ta = ancles[a2].t;
                    if (ta < anterior + GAP) continue;
                    if (ocup[ta.toFixed(2)] && Math.abs(ta - cur.time) > 0.25) continue;
                    if (primer === null) { primer = ancles[a2]; primerIdx = a2; }
                    var costA = Math.abs(ta - cur.time) + ((ancles[a2].tipus === 'corte·medi') ? PENALITZACIO_MEDI : 0);
                    if (costA < bestCost - 0.001) { bestCost = costA; triat = ancles[a2]; bestIdx = a2; }
                }
                if (triat && Math.abs(triat.t - cur.time) > MAX_NEAR) {
                    log('   ⚠️ [ASIG] ' + cur.prefix + ': l\'ancla més propera (' + triat.t.toFixed(2) + 's) queda a més de ' + MAX_NEAR.toFixed(0) + 's → es manté la primera en ordre (' + (primer ? primer.t.toFixed(2) + 's' : '-') + ')');
                    triat = primer; bestIdx = primerIdx;
                }
                if (!triat) continue;
                idxA = bestIdx + 1;
                if (Math.abs(triat.t - cur.time) <= 0.25) { anterior = Math.max(anterior, triat.t); continue; }
                placements.push({ prefix: cur.prefix, timeSec: parseFloat(triat.t.toFixed(2)), comment: cur.comment, colorIdx: (colorByNumAsig[cur.prefix] != null ? colorByNumAsig[cur.prefix] : 6) });
                log('   🔧 [ASIG] ' + cur.prefix + ': ' + cur.time.toFixed(2) + 's → ' + triat.t.toFixed(2) + 's (' + triat.tipus + ', Δ=' + (triat.t - cur.time).toFixed(2) + 's)');
                ocup[cur.time.toFixed(2)] = false;
                ocup[triat.t.toFixed(2)] = true;
                anterior = triat.t;
                assignats++;
            }
            if (placements.length > 0) {
                var res = await this._safePlaceByPrefixes(placements, 'ASIG·Ancles');
                log('   🔧 [ASIG·Ancles] aplicat → ' + JSON.stringify(res));
            }
            log('🔧 [ASIG·Ancles] Ítems sense OnAir: ' + objectiu.length + ' · assignats ' + assignats + ' · ancles=' + ancles.length + ' (GAP=' + GAP + 's)');
            return { assignats: assignats, ancles: ancles.length, gap: GAP };
        },

        /**
         * capa1_onAir: CAPA 1 — OnAir DURO.
         * - Calcula la DENSITAT de cortes (aquí, una vegada per passada → transversal).
         * - Calcula el mapa de SILENCIS (transversal).
         * - Per a cada ítem amb OnAir REAL: clau = OnAir → consens SILENCI → CORTE a prop del silenci.
         * - Valida contra el material real de V1 (avisa si cau fora).
         * - Publica el Δ de la capa 1 (definitiva − OnAir) i CONGELA els seus marcadors.
         */
        capa1_onAir: async function () {
            log('🟩 [CAPA1] OnAir DURO (silenci → corte → OnAir)');
            this._frozen = {};   // (re)execució neta de la capa 1
            const ctxData = await getAssemblyContext().loadAssemblyContext();
            if (!ctxData) { log('⚠️ [CAPA1] loadAssemblyContext ha fallat.', 'ERROR'); return; }
            const { manifest, reader, lines, clips } = ctxData;
            const classData = this._classifyItems(lines);
            const structural = classData.structuralItems || [];

            // 1) DENSITAT (transversal)
            try {
                this._densityCache = this._calcDensityFootprint(clips);
                const br = (this._densityCache && this._densityCache.breaks) ? this._densityCache.breaks : [];
                log('🟩 [CAPA1] Densitat: ' + br.length + ' ruptures' + (br.length ? ' → ' + br.map(function (b) { return b.time.toFixed(2) + 's'; }).join(', ') : ''));
            } catch (eD) { log('⚠️ [CAPA1] densitat: ' + eD.message, 'WARN'); }

            // 2) SILENCIS (transversal)
            let sil = [];
            try {
                const wg = window.FASTPASS_UI.Logic.WaveformGenerator;
                if (wg && wg.silences) sil = (await wg.silences()) || [];
            } catch (eS) { log('⚠️ [CAPA1] silencis: ' + eS.message, 'WARN'); }
            // ═══ (2026-09-25) CONVERSIÓ A TIMELINE (crític) ═════════════════════════════════
            // Els temps del .bin són del FITXER EXTRET (comença a 0). El clip a la timeline
            // comença a clip.inPoint (TNC V2: 99.72s) → sense restar-ho, el consens comparava
            // 20.28s (timeline) amb 121s (fitxer) i mai enganxava el corte ✗.
            const _clipIn0 = (clips && clips.length && isFinite(Number(clips[0].inPoint))) ? Number(clips[0].inPoint) : 0;
            if (sil.length && Math.abs(_clipIn0) > 0.01) {
                sil = sil.map(function (s) { return { start: s.start - _clipIn0, end: s.end - _clipIn0, dur: s.dur }; })
                         .filter(function (s) { return s.end > 0; });
                log('🤫 [CAPA1] Silencis → timeline (inPoint del clip ' + _clipIn0.toFixed(2) + 's restat): ' + sil.length + ' trams vàlids');
            }

            // 3) ANCORATGE + consens
            const anchors = this._calcTemporalAnchors(manifest, reader, structural, clips);
            if (!anchors) { log('⚠️ [CAPA1] ancoratge ha fallat.', 'ERROR'); return; }
            const matStart = (clips && clips.length) ? Number(clips[0].start) : 0;
            const matEnd = (clips && clips.length) ? Number(clips[clips.length - 1].end) : 0;
            const placements = [];
            this._deltaCapa1 = 0; this._deltaN = 0;
            for (let i = 0; i < structural.length; i++) {
                const line = structural[i];
                const oa = line.horaEntradaOnAir;
                if (!oa || oa === '00:00:00' || String(oa).trim() === '') continue;   // només OnAir DUR
                const tc = reader.tcToSeconds(oa);
                if (tc === null || tc === undefined) continue;
                const nail = anchors.anchorEfTimelineSec + (tc - anchors.anchorEfectiva);
                let pos = nail, motiu = 'OnAir';
                // ═══ JERARQUIA DE FONTS (regla d'usuari 2026-09-25) ═══════════════════════════
                // 1r OnAir (emissió real) — el silenci NOMÉS CONFIRMA. Consens = silenci + CORTE
                // real a prop: el corte és la dada dura → es pren (confirmat pel silenci ✓).
                // Si no hi ha corte a prop → NO es mou el marcador al silenci ✗ (el silenci no
                // decideix mai sol). I sense silenci a prop → es queda l'OnAir.
                const silCerca = this._silencioMasCercano(sil, pos, 3.0);
                if (silCerca) {
                    const corte = this._corteCercaDe(clips, silCerca.end, 1.0);
                    if (corte !== null) { pos = corte; motiu = 'silenci+corte'; }
                    else { motiu = 'OnAir (silenci a prop sense corte → el silenci només confirma)'; }
                } else {
                    motiu = 'OnAir (sense silenci a prop)';
                }
                // ═══ (2026-09-25) IMANT AL CORTE REAL ═══════════════════════════════════════
                // L'OnAir marca la ZONA, el CORTE la CONCRETA. Sense això el marcador queda a mig
                // pla (TNC V2: posició 20.28s amb el corte real a 22.44s → "fora del corte" ✗).
                // Només si NO està ja sobre un corte, i dins la finestra configurada (2,5 s).
                let _snapWinIn = 2.5;
                try {
                    const _cfgIn = window.FASTPASS_UI.Config && FASTPASS_UI.Config.get ? FASTPASS_UI.Config.get() : null;
                    if (_cfgIn && _cfgIn.general && isFinite(Number(_cfgIn.general.snapWindowFaroSec))) _snapWinIn = Number(_cfgIn.general.snapWindowFaroSec);
                } catch (eCfgIn) { }
                try {
                    if (this._isOnCut(pos, clips) === null) {
                        const _cutSnap = this._corteCercaDe(clips, pos, _snapWinIn);
                        if (_cutSnap !== null) { pos = _cutSnap; motiu += ' + imant corte (finestra ' + _snapWinIn + 's)'; }
                        else { motiu += ' (cap corte dins ' + _snapWinIn + 's)'; }
                    }
                } catch (eCutIn) { }
                if (matEnd > 0 && (pos < matStart - 0.05 || pos > matEnd + 0.05)) {
                    log('⚠️ [CAPA1] ' + (line.num || '?') + ': ' + pos.toFixed(2) + 's FORA del material (' + matStart.toFixed(2) + '→' + matEnd.toFixed(2) + 's) → NO es col·loca. El manifest/anchor sembla d\'una altra base: prem ACTUALITZAR o munta el bloc i torna-ho a provar.', 'WARN');
                    continue;
                }
                const d = pos - nail;
                this._deltaCapa1 = (this._deltaCapa1 * this._deltaN + d) / (this._deltaN + 1); this._deltaN++;
                log('🟩 [CAPA1] ' + (line.num || '?') + ': OnAir=' + nail.toFixed(2) + 's → ' + pos.toFixed(2) + 's (' + motiu + ')');
                placements.push({
                    prefix: String(line.num || '').trim(), timeSec: parseFloat(pos.toFixed(2)),
                    comment: (line.num ? line.num + ' - ' : '') + String(line.titol || '').substring(0, 60),
                    colorIdx: this._getColorIdx(line)
                });
            }
            if (placements.length) {
                const res = await this._safePlaceByPrefixes(placements, 'CAPA1·OnAir');
                log('🟩 [CAPA1] aplicat → ' + JSON.stringify(res));
            }
            this._frozen = {};
            for (let f = 0; f < placements.length; f++) this._frozen[placements[f].prefix.toLowerCase()] = true;
            if (this._iniciPrefix) this._frozen[String(this._iniciPrefix).toLowerCase()] = true;
            log('🟩 [CAPA1] Δ capa1 = ' + this._deltaCapa1.toFixed(3) + 's (' + this._deltaN + ' marcadors) · 🔒 congelats: ' + Object.keys(this._frozen).join(', '));
        },

        /**
         * _silencioMasCercano: silenci més proper a `t` (segons de timeline) dins `maxDist`.
         * @returns {Object|null} {start,end,dur} o null
         */
        _silencioMasCercano: function (sil, t, maxDist) {
            var arr = sil || [], best = null, bd = 1e9;
            for (var i = 0; i < arr.length; i++) {
                var s = arr[i];
                if (!s || !isFinite(s.start) || !isFinite(s.end)) continue;
                var d = Math.min(Math.abs(s.start - t), Math.abs(s.end - t));
                if (d <= maxDist && d < bd) { bd = d; best = s; }
            }
            return best;
        },

        /**
         * _corteCercaDe: corte real (start/end d'un clip de V1) més proper a `t` dins `maxDist`.
         * @returns {number|null} segons de timeline
         */
        _corteCercaDe: function (clips, t, maxDist) {
            var arr = clips || [], best = null, bd = 1e9;
            for (var i = 0; i < arr.length; i++) {
                var cs = Number(arr[i] && arr[i].start), ce = Number(arr[i] && arr[i].end);
                if (isFinite(cs) && Math.abs(cs - t) <= maxDist && Math.abs(cs - t) < bd) { bd = Math.abs(cs - t); best = cs; }
                if (isFinite(ce) && Math.abs(ce - t) <= maxDist && Math.abs(ce - t) < bd) { bd = Math.abs(ce - t); best = ce; }
            }
            return best;
        },

        /**
         * _imantAlCorte: (2026-10-05 · BUG #140) «Ajust al corte más cercano» per a un
         * marcador que NO passa per F4·Faro.
         *
         * PER QUÈ: F4·Faro és l'única fase que imanta els marcadors al tall real, i
         * `placeUngroupedMarkers` (ítems no agrupats: vermells + IPD turquesa) és la
         * ÚLTIMA fase del pipeline OUT&GO → el seu upsert per prefix deixava el marcador
         * a la posició IDEAL (OnAir/prevista crua) i desfeia el snap. Amb això la fase
         * aplica el mateix criteri que F4 (passada per `_chooseSnapTarget`: ruptura de
         * densitat > tall d'obertura > tall real) i la mateixa finestra.
         *
         * SEMÀNTICA (regla d'usuari 2026-09-25): l'OnAir/prevista marca la ZONA, el CORTE
         * la CONCRETA. Si ja està clavat a un tall (±0,15 s) no es mou (idempotent).
         *
         * @param {number} pos - posició ideal (s de timeline)
         * @param {Array} clips - clips de V1 [{start,end}]
         * @param {boolean} hasOnAir - true = faro (finestra curta) · false = deduït (llarga)
         * @param {string} label - etiqueta pel log
         * @returns {number} posició imantada (o la mateixa si no hi ha tall a la finestra)
         */
        _imantAlCorte: function (pos, clips, hasOnAir, label) {
            try {
                if (!clips || clips.length === 0) return pos;
                if (this._isOnCut(pos, clips) !== null) {
                    log('   🧲 [' + label + '] ' + pos.toFixed(2) + 's ja és a un tall → no es mou');
                    return pos;
                }
                var win = hasOnAir ? this._snapWindowFaro() : this._snapWindowDeduced();
                var breaks = [];
                try {
                    var df = this._calcDensityFootprint(clips);
                    breaks = (df && df.breaks) ? df.breaks : [];
                } catch (eB) { breaks = []; }
                var pick = this._chooseSnapTarget(pos, win, !hasOnAir, breaks, clips);
                if (pick && pick.target !== null && isFinite(pick.target)) {
                    log('   🧲 [' + label + '] ' + pos.toFixed(2) + 's → ' + Number(pick.target).toFixed(2) +
                        's (' + pick.why + ', finestra ±' + win.toFixed(1) + 's)');
                    return pick.target;
                }
                log('   🧲 [' + label + '] ' + pos.toFixed(2) + 's: cap corte dins ±' + win.toFixed(1) + 's → es manté la posició ideal');
                return pos;
            } catch (e) {
                log('⚠️ [imantAlCorte] ' + e.message, 'WARN');
                return pos;
            }
        },

        /**
         * sil_dump: Botó TEST «SIL». Només bolca el mapa de SILENCIS del bloc al log
         * (no col·loca res). Serveix per ajustar llindar/durada mínima amb dades reals.
         */
        sil_dump: async function () {
            var wg = window.FASTPASS_UI.Logic.WaveformGenerator;
            if (!wg || !wg.silences) { log('⚠️ [SIL] WaveformGenerator.silences no disponible', 'WARN'); return; }
            var list = await wg.silences();
            log('🤫 [SIL] ' + (list ? list.length : 0) + ' trams de silenci (base media del clip del bloc)');
            // (2026-09-25) DIAGNÒSTIC 2: escala real dels pics i valors al voltant del tall
            // (118-126s), on l'oïda diu que hi ha un silenci de ~2-4s que el detector no veu.
            try {
                var _folder2 = window.FASTPASS_UI.Utils.workFolder(window.FASTPASS_UI.State) || '';
                var _bin2 = await wg.getBinPath(_folder2);
                var _wf2 = await wg.loadPeaksFromBin(_bin2, 480);
                if (_wf2 && _wf2.peaks && _wf2.peaks.length) {
                    var _mx2 = -1e9, _mn2 = 1e9;
                    for (var _i = 0; _i < _wf2.peaks.length; _i++) { if (_wf2.peaks[_i] > _mx2) _mx2 = _wf2.peaks[_i]; if (_wf2.peaks[_i] < _mn2) _mn2 = _wf2.peaks[_i]; }
                    log('🤫 [SILENCI·DBG2] escala: min=' + Number(_mn2).toFixed(4) + ' max=' + Number(_mx2).toFixed(4) + ' · n=' + _wf2.peaks.length + ' · pps=' + _wf2.peaksPerSec);
                    var _pps2 = _wf2.peaksPerSec || 480, _lin = [];
                    for (var _t = 118; _t <= 126; _t += 1) {
                        var _s2 = Math.round(_t * _pps2), _e2 = Math.min(_wf2.peaks.length, _s2 + Math.round(_pps2)), _mxw = 0;
                        for (var _k = _s2; _k < _e2; _k++) { if (_wf2.peaks[_k] > _mxw) _mxw = _wf2.peaks[_k]; }
                        _lin.push(_t + 's:' + Number(_mxw).toFixed(4));
                    }
                    log('🤫 [SILENCI·DBG2] max per segon 118→126s: ' + _lin.join(' | '));
                }
            } catch (eDbg2) { }
        },

        /**
         * capa0_prep: CAPA 0 del pla de marcadors per capes.
         * Setup (ensureExtractedRef —només lectura— + loadAssemblyContext + _classifyItems) i
         * col·locació del MARCADOR D'INICI (00:00) IMMUTABLE («faro de faros»).
         */
        capa0_prep: async function () {
            log('🟦 [CAPA0] Setup + classificació + marcador d\'inici (00:00)');
            try { await this.ensureExtractedRef(window.FASTPASS_UI.State); } catch (e0) { }
            const ctxData = await getAssemblyContext().loadAssemblyContext();
            if (!ctxData) { log('⚠️ [CAPA0] loadAssemblyContext ha fallat.', 'ERROR'); return null; }
            const { lines } = ctxData;
            const classData = this._classifyItems(lines);
            log('🟦 [CAPA0] Items: ' + ((classData.structuralItems || []).length) + ' estructurals · ' +
                ((classData.graphicItems || []).length) + ' gràfics · ' + ((classData.farosItems || []).length) + ' amb OnAir');
            // (2026-09-25) El marcador d'INICI NO pot ser un ítem GRÀFIC (P2/GF/MAPA/TE…):
            // als gràfics els toca la seva pròpia capa (al final). TNC V2: "04 P2-2" sortia com
            // a estructural i s'enduia el 🔒 d'inici ✗ (queixa d'usuari 2026-09-25).
            const _grafNums = {};
            (classData.graphicItems || []).forEach(function (g) { _grafNums[String(g.num || '').trim().toLowerCase()] = true; });
            let first = null;
            for (let _fi = 0; _fi < (classData.structuralItems || []).length; _fi++) {
                const _cand = classData.structuralItems[_fi];
                const _candNum = String(_cand.num || '').trim();
                if (_grafNums[_candNum.toLowerCase()] === true || _candNum.toUpperCase().indexOf('P2') !== -1) {
                    log('🟦 [CAPA0] S\'omet "' + _candNum + '": és GRÀFIC → anirà a la capa de gràfics (al final)');
                    continue;
                }
                first = _cand;
                break;
            }
            if (first) {
                const pfx = String(first.num || '').trim();
                const comment = (first.num ? first.num + ' - ' : '') + String(first.titol || '').substring(0, 60);
                await this._safePlaceByPrefixes([{ prefix: pfx, timeSec: 0, comment: comment, colorIdx: this._getColorIdx(first) }], 'CAPA0·inici');
                this._iniciPrefix = pfx;
                log('🟦 [CAPA0] 🔒 Marcador d\'inici: ' + pfx + ' a 00:00 (IMMUTABLE)');
            } else {
                log('⚠️ [CAPA0] Sense ítem estructural per fer de marcador d\'inici', 'WARN');
            }
            return ctxData;
        },

        /**
         * chooseSnapTarget: Tria a quin punt s'ha d'ancorar un marcador.
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

        /**
         * _preAssignDeducedToBreaks: (2026-09-30 · BUG #123) Assignació 1:1 entre les
         * RUPTURES DE DENSITAT LLIURES i els ítems DEDUÏTS (sense OnAir) del mateix
         * tram, entès com l'espai entre dos faros consecutius.
         *
         * Cas real TNV_V2 30/09 (audit log + FASTPASS.log 12:52): `16dp` quedava a 16,36s
         * i `16dir` a 18,00s quan les ruptures reals del bloc eren a 23,36s (00:00:23:09)
         * i 48,80s (00:00:48:20). El snap genèric de F4 no hi arriba perquè la finestra
         * dels deduïts és ±2,5s i ASIG/SEP ja havien arrossegat els marcadors abans.
         *
         * Regla: si en un tram hi ha EXACTAMENT tantes ruptures lliures com ítems
         * deduïts, s'assignen 1:1 en ordre d'escaleta (la 1a ruptura al 1r ítem).
         * Si la cardinalitat no quadra, no es toca res (conservador). Els GRÀFICS
         * queden fora (els mana F6·Gràfics) i el marcador d'inici també.
         *
         * @param {Array} markers - marcadors existents [{time, comments}]
         * @param {Object} hasOnAirByNum - { num: true|false } (de _buildOnAirMap)
         * @param {Array} breaks - ruptures de densitat [{time, dpDirPair, ...}]
         * @param {Object} lineByNum - { num: línia d'escaleta } (per l'ordre `sequencia`)
         * @returns {Object} { prefix: timeSec } només els que tenen assignació 1:1
         *
         * MESURAT (test Edge headless, mateix V8 del CEP) amb l'estat real de F4·Faro al
         * run TNV_V2: {15@0, 16 GF-1@9,96, 16 GF-2@13,16, 16dp@15,00, 16dir@18,00,
         * 16@61,60} + ruptures [23,36 · 48,80 · 61,60] → {"16dp":23.36,"16dir":48.8}.
         * Amb 3 deduïts al mateix tram (cardinalitat 2≠3) → {} (no toca res).
         */
        _preAssignDeducedToBreaks: function (markers, hasOnAirByNum, breaks, lineByNum) {
            var out = {}, TOL = 0.25, MIN_GAP = 0.5;
            var faros = [], ded = [], i, t, pfx;

            // 1) Separar faros (OnAir) de deduïts (sense OnAir). Gràfics fora.
            for (i = 0; i < (markers || []).length; i++) {
                t = Number(markers[i] && markers[i].time);
                if (!isFinite(t)) continue;
                pfx = this._extractPrefixFromComment(markers[i].comments || '');
                if (!pfx || this._isGraphicByNum(pfx)) continue;
                // El 🔒 marcador d'inici (00:00) NO es mou mai, però SÍ que és una
                // frontera vàlida del primer tram (0 → primer faro del bloc).
                if (t <= 0.15) { faros.push(0); continue; }
                if (hasOnAirByNum[pfx] === false) {
                    var ln = lineByNum[pfx];
                    ded.push({ prefix: pfx, time: t, seq: (ln && ln.sequencia != null) ? Number(ln.sequencia) : 9999 });
                } else {
                    faros.push(t);
                }
            }
            if (ded.length === 0 || !breaks || breaks.length === 0) return out;

            // 2) Ruptures LLIURES = les que no estan ocupades per un faro
            var lliures = [];
            for (var b = 0; b < breaks.length; b++) {
                var tb = Number(breaks[b] && breaks[b].time);
                if (!isFinite(tb)) continue;
                var ocupada = false;
                for (var f = 0; f < faros.length; f++) { if (Math.abs(faros[f] - tb) <= TOL) { ocupada = true; break; } }
                if (!ocupada) lliures.push(tb);
            }
            if (lliures.length === 0) return out;

            // 3) Per cada tram (faro anterior, faro següent): només si quadra 1:1
            faros.sort(function (a, b2) { return a - b2; });
            lliures.sort(function (a, b2) { return a - b2; });
            for (var s = 0; s < faros.length - 1; s++) {
                var lo = faros[s], hi = faros[s + 1];
                var br = lliures.filter(function (x) { return x > lo + MIN_GAP && x < hi - MIN_GAP; });
                var dd = ded.filter(function (d) { return d.time > lo && d.time < hi; })
                            .sort(function (a, b3) { return a.seq - b3.seq; });
                if (dd.length === 0 || br.length !== dd.length) continue;
                for (var k = 0; k < dd.length; k++) out[dd[k].prefix] = br[k];
            }
            return out;
        },

        // ═══════════════════════════════════════════════════════════════
        // 🟠 F4: snapFaroMarkers — Snap dels marcadors al TALL REAL més
        // proper (o a la ruptura de densitat DP+DIR), finestra ±0,6 s
        // ═══════════════════════════════════════════════════════════════
        snapFaroMarkers: async function () {
            log('🟠 [F4·Faro] Iniciant snap dels marcadors al tall real més proper...');

            const clips = await getClipsLogic().getTrackClips(1, 'video');

            // (2026-09-24) PAS 1 (ordre de treball acordat amb l'usuari): ABANS de calcular els
            // breaks de densitat, els marcadors queden ORDENATS i SEPARATS segons l'ordre
            // d'escaleta. Amb el timeline ordenat, el matching amb els breaks (PAS 2) és intuïtiu
            // i no hi ha superposicions (conexió + IPD al mateix segon).
            // (2026-09-24) ORDRE CORRECTE: PRIMER ancorar (PAS 2: els ítems sense OnAir al seu
            // corte, p.ex. la CONEXIÓ al break del clip llarg) i DESPRÉS separar (PAS 1). ABANS
            // anaven al revés i PAS 1 separava sobre les posicions VELLES (01dir encara a 62.36s)
            // → movia el vídeo 01 a 65.56s per no res i tot quedava desplaçat (queixa 2026-09-24).
            try {
                const ctxAsig = await getAssemblyContext().loadAssemblyContext();
                await this._asignarAnclasPorDuracion(ctxAsig ? ctxAsig.manifest : null, clips, 3.0);
            } catch (eAsig) {
                log('⚠️ [ASIG·Ancles] ' + eAsig.message, 'WARN');
            }

            try {
                const ctxOrd = await getAssemblyContext().loadAssemblyContext();
                await this._ordenarISeparar(ctxOrd ? ctxOrd.manifest : null, clips, 3.0);
            } catch (eOrd) {
                log('⚠️ [SEP·Ordre-GAP] ' + eOrd.message, 'WARN');
            }
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
            log('   🟠 [F4·Faro] Finestra de snap: faros ±' + SEARCH_WINDOW.toFixed(1) + 's · deduïts ±' + this._snapWindowDeduced().toFixed(1) + 's (Profile.json → general.snapWindowFaroSec / snapWindowDeducedSec)');
            var MIN_MOVE = 0.02;

            // ── Tipus de marcador: FARO (ítem amb OnAir real) o DEDUÏT (sense OnAir) ──
            // Els deduïts (F2) arrosseguen l'error de les durades d'escaleta (1-3 s) i
            // necessiten una finestra de snap més ampla. Els faros es queden amb la
            // curta per no moure'ls de la seva hora real d'emissió.
            // Només es considera "deduït" si consta a l'escaleta que l'ítem NO té OnAir
            // (si el mapa no es pot llegir, tots es tracten com a faro → conservador).
            var hasOnAirByNum = {};
            var lineByNum = {};   // (2026-09-17) num → línia, per recalcular el color
            try {
                var ctxF4 = await getAssemblyContext().loadAssemblyContext();
                var linesF4 = (ctxF4 && ctxF4.lines) ? ctxF4.lines : [];
                hasOnAirByNum = this._buildOnAirMap(linesF4);
                for (var lb = 0; lb < linesF4.length; lb++) {
                    if (linesF4[lb] && linesF4[lb].num) lineByNum[String(linesF4[lb].num)] = linesF4[lb];
                }
                var nFaro = 0, nDed = 0;
                for (var kx in hasOnAirByNum) { if (hasOnAirByNum[kx]) nFaro++; else nDed++; }
                log('   🟠 [F4·Faro] Finestra deduïts = ±' + this._snapWindowDeduced().toFixed(1) + 's · nums amb OnAir: ' + nFaro + ' · sense OnAir (deduïts): ' + nDed);
            } catch (eT) {
                log('⚠️ [F4·Faro] Sense mapa OnAir (' + eT.message + ') → tots els marcadors com a faro');
            }

            // (2026-09-30 · BUG #123) Assignació 1:1 ruptures lliures ↔ ítems deduïts
            // (parells DP+DIR). Es calcula ABANS del bucle i té prioritat sobre el snap
            // genèric (que amb ±2,5s no arriba quan ASIG/SEP han mogut el marcador).
            var preAssigned = {};
            try {
                preAssigned = this._preAssignDeducedToBreaks(existingMarkers, hasOnAirByNum, breaks, lineByNum);
            } catch (ePA) {
                preAssigned = {};
                log('⚠️ [F4·Faro] Pair ruptures↔deduïts: ' + ePA.message, 'WARN');
            }
            log('   🟠 [F4·Faro] Pair ruptures↔deduïts (1:1): ' + (Object.keys(preAssigned).length ? JSON.stringify(preAssigned) : 'cap'));

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

                // (2026-09-30) BUG #122: els GRÀFICS no s'imanten a un corte. La seva posició
                // ve del seu PARE (D13, F6·Gràfics) i F4 corre ABANS que F6 → si els toqués
                // els trauria del pare (TNV V1: 4 GF apilats a 0,00s).
                if (this._isGraphicByNum(prefix)) { alreadyOk++; continue; }

                // DEDUÏT només si consta que l'ítem no té OnAir (si no, faro).
                var isDeduced = (hasOnAirByNum[prefix] === false);
                var win = isDeduced ? this._snapWindowDeduced() : SEARCH_WINDOW;

                // (2026-09-30 · BUG #123) Si l'ítem deduït té assignació 1:1 (parell
                // ruptures↔deduïts) mana aquesta; si no, snap genèric dins de la finestra.
                var pick = (isDeduced && preAssigned[prefix] != null)
                    ? { target: preAssigned[prefix], why: 'parell ruptures↔deduïts (1:1)' }
                    : this._chooseSnapTarget(markerTime, win, isDeduced, breaks, clips);
                var target = pick.target, why = pick.why;

                if (target === null || Math.abs(target - markerTime) < MIN_MOVE) { alreadyOk++; continue; }

                // (2026-09-17) El color NO és llegible: Markers.get() retorna -1 perquè
                // .color és una propietat del wrapper JSX i no persisteix. El codi de color
                // viatja al NAME ('color=N', convenció de Markers.set); si no hi és, es
                // recalcula des de l'escaleta (MARKER_COLORS.md). Sense això, el
                // delete+create de placeByPrefixes deixava tots els marcadors en blau (6).
                var mkColor = 6;
                var nm = (mk.name !== undefined && mk.name !== null) ? String(mk.name) : '';
                if (nm.indexOf('color=') === 0) {
                    var nmC = parseInt(nm.substring(6), 10);
                    if (!isNaN(nmC) && nmC >= 0) mkColor = nmC;
                } else if (lineByNum[String(prefix)]) {
                    mkColor = this._getColorIdx(lineByNum[String(prefix)]);
                }
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
        // 🔎 F5·Inferits: placeInferredItems — Marcadors dels ítems d'escaleta que
        // NO tenen cap hora (ni OnAir ni Prevista) i que per tant no han pogut
        // entrar a F1/F2/F3.
        //
        // La posició es dedueix SEMPRE DINS de la finestra que formen els seus veïns
        // d'escaleta (ítem anterior i ítem següent JA col·locats), amb el motor de
        // densitat de talls (14_Assembly_Logic.calcDensityFootprintV2):
        //   A) Ruptura LOW→HIGH dins la finestra → inici de la peça editada (IPD:
        //      molts plans curts després d'un pla llarg). Passada estàndard + FINA
        //      (6s / 8 talls·min) per tenir sensibilitat als IPD.
        //   B) Si no hi ha ruptura: el clip de la finestra clarament més llarg que els
        //      seus veïns (≥2× mediana) → el seu INICI és l'inici de la peça.
        //   C) Últim recurs: punt mig de la finestra (amb avís al log).
        // MAI es col·loca a menys de 0,5 s d'un marcador veí (no xoca amb F1-F4).
        // ═══════════════════════════════════════════════════════════════
        placeInferredItems: async function () {
            log('🔎 [F5·Inferits] Iniciant deducció d\'ítems d\'escaleta sense hora...');

            const ctxData = await getAssemblyContext().loadAssemblyContext();
            if (!ctxData) { log('⚠️ [F5·Inferits] loadAssemblyContext ha fallat. Abortant.'); return 0; }
            const { lines, clips } = ctxData;
            if (!clips || clips.length === 0) { log('⚠️ [F5·Inferits] Sense clips a V1.'); return 0; }

            const classData = this._classifyItems(lines);
            const unplacedItems = classData.unplacedItems || [];
            if (unplacedItems.length === 0) {
                log('🔎 [F5·Inferits] Cap ítem sense hora. ✓ FINALITZAT.');
                return 0;
            }

            // ── Marcadors ja col·locats (F1-F4): prefix → temps ──
            var markersRaw = await callJSX('Markers.get()');
            var mk = [];
            try { mk = JSON.parse(markersRaw); } catch (eMK) { }
            var posByPrefix = {};
            for (var m = 0; m < mk.length; m++) {
                var mc = mk[m].comments || '';
                var sp = mc.indexOf(' -');
                var pf = (sp > 0) ? mc.substring(0, sp).trim() : '';
                if (!pf) continue;
                var tt = (typeof mk[m].time === 'number') ? mk[m].time : parseFloat(mk[m].time);
                if (!isNaN(tt)) posByPrefix[pf] = tt;
            }

            // ── Ordre d'ESCALETA (camp `sequencia`), MAI pel TC ──
            // `lines` ve d'AssemblyContext ORDENAT PER HORA (assembly_context.js:125), i els
            // ítems SENSE hora (com el 13 IPD) queden al PRINCIPI: si es recorre tal qual, el
            // veí "següent" acaba sent el 12dp. Aquí mana l'escaleta (regla del projecte).
            var ordered = lines.slice().sort(function (a, b) {
                var sa = (a && a.sequencia != null && isFinite(Number(a.sequencia))) ? Number(a.sequencia) : Number.MAX_SAFE_INTEGER;
                var sb = (b && b.sequencia != null && isFinite(Number(b.sequencia))) ? Number(b.sequencia) : Number.MAX_SAFE_INTEGER;
                return (sa === sb) ? 0 : (sa - sb);
            });
            var orderIdx = {};
            for (var li = 0; li < ordered.length; li++) {
                if (ordered[li] && ordered[li].num) orderIdx[String(ordered[li].num)] = li;
            }

            // ── Densitat de talls: passada estàndard + passada FINA (IPD) ──
            var dens = this._calcDensityFootprint(clips);
            var densFine = null;
            try { densFine = getAssemblyLogic().calcDensityFootprintV2(clips, 6, 8); }
            catch (eDF) { log('⚠️ [F5·Inferits] Passada fina de densitat fallida: ' + eDF.message, 'WARN'); }

            var placements = [];
            var inferits = 0;

            for (var u = 0; u < unplacedItems.length; u++) {
                var line = unplacedItems[u];
                var num = String(line.num || '');
                if (!num) continue;
                var idx = (orderIdx[num] !== undefined) ? orderIdx[num] : -1;
                if (idx < 0) { log('⚠️ [F5·Inferits] ' + num + ': no consta a l\'escaleta del bloc. Saltant.', 'WARN'); continue; }

                // Veïns per ESCALETA amb marcador ja col·locat
                var prevTime = null, prevNum = null, nextTime = null, nextNum = null;
                for (var b = idx - 1; b >= 0; b--) {
                    var nb = (ordered[b] && ordered[b].num) ? String(ordered[b].num) : '';
                    if (nb && posByPrefix[nb] !== undefined) { prevTime = posByPrefix[nb]; prevNum = nb; break; }
                }
                for (var f = idx + 1; f < ordered.length; f++) {
                    var nf = (ordered[f] && ordered[f].num) ? String(ordered[f].num) : '';
                    if (nf && posByPrefix[nf] !== undefined) { nextTime = posByPrefix[nf]; nextNum = nf; break; }
                }
                var lo = (prevTime !== null) ? prevTime : ((typeof clips[0].start === 'number') ? clips[0].start : 0);
                var hi = (nextTime !== null) ? nextTime : clips[clips.length - 1].end;
                log('   🔎 [F5·Inferits] ' + num + ': finestra [' + (prevNum || '—') + '@' + lo.toFixed(2) + 's → ' + (nextNum || '—') + '@' + hi.toFixed(2) + 's]');
                if (hi - lo < 1.0) {
                    log('   ⚠️ [F5·Inferits] ' + num + ': finestra massa estreta → saltant.', 'WARN');
                    continue;
                }
                // Zona útil: 0,5 s de marge respecte dels marcadors veïns
                var uLo = lo + ((prevNum !== null) ? 0.5 : 0);
                var uHi = hi - ((nextNum !== null) ? 0.5 : 0);
                if (uHi < uLo) uHi = uLo;

                // Criteri A: ruptura de densitat (inici de peça editada)
                var candA = this._pickInferredByDensity(dens, densFine, uLo, uHi, hi);
                var tCand = null, why = '';
                if (candA) { tCand = candA.time; why = candA.why; }

                // Criteri B: peça única / clip amb durada outlier dins la finestra
                // (s'hi passa la finestra SENCERA: la peça pot començar just al límit
                //  del marcador anterior; el marge de 0,5 s s'aplica després)
                if (tCand === null) {
                    var candB = this._pickInferredByDuration(clips, lo, hi);
                    if (candB) { tCand = candB.time; why = candB.why; }
                }

                // Criteri C: punt mig (últim recurs)
                if (tCand === null) { tCand = (uLo + uHi) / 2; why = 'punt mig de la finestra (sense senyal de densitat)'; }

                var tFinal = Math.min(uHi, Math.max(uLo, tCand));
                if (tFinal < 0) tFinal = 0;

                var titol = (line.titol || '').substring(0, 60).trim();
                var comment = ((num + ' - ') + titol).trim();
                // (2026-10-05 · BUG #139) La regla "IPD → turquesa (7)" viu ara a
                // _getColorIdx (vegeu isIpdLine) perquè TOTES les fases la respectin;
                // aquí només es conserva el flag per etiquetar el log.
                var isIpd = isIpdLine(line);
                var colorIdx = this._getColorIdx(line);

                log('   📍 [F5·Inferits] ' + num + (isIpd ? ' [IPD]' : '') + ': → ' + tFinal.toFixed(2) + 's · ' + why + ' · color=' + colorIdx +
                    (Math.abs(tFinal - tCand) > 0.05 ? ' (ajustat de ' + tCand.toFixed(2) + 's per no xocar amb el veí)' : ''));

                placements.push({
                    prefix: line.num,
                    timeSec: parseFloat(tFinal.toFixed(2)),
                    comment: comment,
                    colorIdx: colorIdx,
                    name: 'color=' + colorIdx
                });
                inferits++;
            }

            if (placements.length === 0) { log('🔎 [F5·Inferits] Cap posició deduïble. ✓ FINALITZAT.'); return 0; }

            var result = await this._safePlaceByPrefixes(placements, 'F5·Inferits');
            log('🔎 [F5·Inferits] Moguts: ' + (result.moved || 0) + ' | Nous: ' + (result.created || 0) + ' | Total: ' + (result.placed || 0) + '. ✓ FINALITZAT.');
            return inferits;
        },

        /**
         * _pickInferredByDensity: Cerca dins [lo, hi] una ruptura de densitat que marqui
         * l'INICI d'una peça editada (LOW→HIGH: pla llarg → molts plans curts = IPD).
         * Les ruptures que toquen el marcador SEGÜENT (rightEdge - 0,5s) es descarten:
         * són l'inici de la peça del veí de la dreta, no d'aquest ítem.
         * Prioritat: parell DP+DIR > confiança > passada fina.
         * @returns {{time:number, why:string}|null}
         */
        _pickInferredByDensity: function (dens, densFine, lo, hi, rightEdge) {
            var packs = [];
            if (dens && dens.breaks) packs.push({ list: dens.breaks, tag: 'estàndard' });
            if (densFine && densFine.breaks) packs.push({ list: densFine.breaks, tag: 'fina' });
            // Direcció del canvi: la V2 NO porta fromType/toType, així que s'usa la ZONA
            // que comença a la ruptura: si és HIGH → inici de peça editada (LOW→HIGH).
            var zoneTypeAt = function (time) {
                if (!dens || !dens.zones) return null;
                for (var z = 0; z < dens.zones.length; z++) {
                    var zo = dens.zones[z];
                    if (time >= zo.start - 0.35 && time <= zo.end) return zo.type;
                }
                return null;
            };
            var best = null;
            for (var p = 0; p < packs.length; p++) {
                var list = packs[p].list;
                for (var i = 0; i < list.length; i++) {
                    var br = list[i];
                    var t = (typeof br.time === 'number') ? br.time : parseFloat(br.time);
                    if (isNaN(t) || t < lo || t > hi) continue;
                    if (br.toType && br.toType !== 'HIGH') continue;              // (V1) només inici de peça
                    if (rightEdge !== undefined && t > rightEdge - 0.5) continue; // és del veí de la dreta
                    var zt = zoneTypeAt(t);                                        // (V2) direcció per zona
                    if (zt && zt !== 'HIGH') continue;
                    var score = (br.confidence || 0) + (br.dpDirPair ? 0.5 : 0) + (packs[p].tag === 'fina' ? 0.1 : 0);
                    if (!best || score > best.score) {
                        best = {
                            score: score, time: t,
                            why: 'ruptura de densitat ' + (br.fromType ? (br.fromType + '→' + br.toType) : (zt ? ('LOW→' + zt) : 'canvi de patró')) +
                                ' (conf ' + (br.confidence || 0).toFixed(2) + (br.dpDirPair ? ', DP+DIR' : '') + ', ' + packs[p].tag + ')'
                        };
                    }
                }
            }
            return best ? { time: best.time, why: best.why } : null;
        },

        /**
         * _pickInferredByDuration: Si dins [lo, hi] hi ha un clip clarament més llarg que
         * els seus veïns (≥2× la mediana i ≥5 s), és la "peça" inserida → el seu INICI és
         * la posició de l'ítem. Cobreix el cas en què el TROSSEJA no ha partit la peça en
         * plans (cas real: IPD de 21,3 s en un sol clip entre clips de 3-5 s).
         * @returns {{time:number, why:string}|null}
         */
        _pickInferredByDuration: function (clips, lo, hi) {
            // El clip del veí de la DRETA (start ≈ hi) queda FORA: és una altra peça.
            var inside = [];
            var rightLimit = hi - 0.5;
            for (var i = 0; i < clips.length; i++) {
                var c = clips[i];
                if (!c) continue;
                if (c.start >= lo - 0.05 && c.start <= rightLimit) inside.push(c);
            }
            if (inside.length === 0) return null;
            // Cas net: UNA sola peça dins de la finestra → l'ítem és aquella peça sencera
            // (cas real: IPD de 21,3 s en un sol clip entre els veïns 12dir i 14).
            if (inside.length === 1) {
                var d1 = inside[0].end - inside[0].start;
                return {
                    time: inside[0].start,
                    why: 'peça única dins la finestra (' + d1.toFixed(1) + 's) → inici de la peça'
                };
            }
            // Diverses peces: la clarament més llarga (≥2× la mediana i ≥5 s) és la peça inserida
            var durs = inside.map(function (x) { return x.end - x.start; }).sort(function (a, b) { return a - b; });
            var med = durs[Math.floor(durs.length / 2)] || 0;
            var best = null;
            for (var j = 0; j < inside.length; j++) {
                var d = inside[j].end - inside[j].start;
                if (med > 0 && d >= med * 2 && d >= 5) {
                    if (!best || d > best.d) {
                        best = {
                            d: d, time: inside[j].start,
                            why: 'peça de ' + d.toFixed(1) + 's (≥2× mediana ' + med.toFixed(1) + 's) → inici de la peça'
                        };
                    }
                }
            }
            return best ? { time: best.time, why: best.why } : null;
        },

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
            // (2026-09-17) num → línia, per recalcular el color en lloc de confiar en
            // mk.color (Markers.get() retorna -1: el color no és llegible).
            var lineByNumF6 = {};
            for (var l6 = 0; l6 < lines.length; l6++) {
                if (lines[l6] && lines[l6].num) lineByNumF6[String(lines[l6].num)] = lines[l6];
            }

            // Ordre d'escaleta: num → sequencia (font: manifest.escaletaItems)
            var allEs = (manifest && manifest.escaletaItems) ? manifest.escaletaItems : [];
            var seqByNum = {};
            for (var i = 0; i < allEs.length; i++) {
                var it = allEs[i];
                if (!it || !it.num) continue;
                var nk = String(it.num);
                if (seqByNum[nk] == null) seqByNum[nk] = (it.sequencia != null && isFinite(Number(it.sequencia))) ? Number(it.sequencia) : i;
            }

            // (2026-09-17) Els ítems NO agrupats (sense V1, marcats en VERMELL) no
            // participen a la guarda d'ordre: són fites per delimitar el bloc.
            var ungroupedSet = {};
            for (var iu = 0; iu < allEs.length; iu++) {
                var itu = allEs[iu];
                if (itu && itu.num && (itu.agrupacio === null || itu.agrupacio === undefined)) ungroupedSet[String(itu.num)] = true;
            }
            var list = [];
            for (var mi = 0; mi < markers.length; mi++) {
                var mk = markers[mi];
                var t = (typeof mk.time === 'number') ? mk.time : parseFloat(mk.time);
                if (!isFinite(t)) continue;
                var pfx = this._extractPrefixFromComment(mk.comments);
                if (!pfx) continue;
                // Marcadors estructurals amb num conegut (gràfics/tótems exempts)
                if (this._isGraphicByNum(pfx)) continue;
                if (ungroupedSet[pfx]) continue;      // vermells (no agrupats): delimiten el bloc, no s'ordenen
                if (seqByNum[pfx] == null) continue;
                var mkColor = 6;
                var nm6 = (mk.name !== undefined && mk.name !== null) ? String(mk.name) : '';
                if (nm6.indexOf('color=') === 0) {
                    var nmC6 = parseInt(nm6.substring(6), 10);
                    if (!isNaN(nmC6) && nmC6 >= 0) mkColor = nmC6;
                } else if (lineByNumF6[pfx]) {
                    mkColor = this._getColorIdx(lineByNumF6[pfx]);
                }
                list.push({
                    num: pfx, time: t, comment: mk.comments,
                    hasOnAir: hasOnAirByNum[pfx] === true,
                    color: mkColor
                });
            }
            if (list.length < 2) { log('🟢 [F6·Ordre] Pocs marcadors estructurals per verificar. ✓ FINALITZAT.'); return; }
            list.sort(function (a, b) { return seqByNum[a.num] - seqByNum[b.num]; });

            var placements = [];
            var prev = null;
            for (var li = 0; li < list.length; li++) {
                var cur = list[li];
                if (prev && cur.time < prev.time - 0.02) {
                    // (2026-09-24) GUARDA D'USUARI: si el marcador que s'hauria de moure JA està
                    // clavat en un tall real de V1 (±0,15s), NO es mou. Els clamps de ±0,5s el
                    // tornaven a desviar uns frames del seu corte (queixa d'usuari 2026-09-24:
                    // "el marcador del vídeo … luego se mueve a unos frames antes de su corte").
                    var prevOnCut = this._isOnCut(prev.time, clips);
                    var curOnCut = this._isOnCut(cur.time, clips);
                    if (cur.hasOnAir && !prev.hasOnAir) {
                        if (prevOnCut !== null) {
                            log('   ⏭️ [F6·Ordre] ' + prev.num + ' ja està en un tall (' + prevOnCut.toFixed(2) + 's) → NO es mou (inversió amb ' + cur.num + ')');
                        } else {
                            // El faro mana: el deduït previ s'ha d'avançar (tall anterior).
                            var novaPrev = Math.min(this._prevCutBefore(cur.time, clips), cur.time - 0.5);
                            if (novaPrev < 0) novaPrev = 0;
                            log('   🔧 [F6·Ordre] Inversio: ' + prev.num + ' (' + prev.time.toFixed(2) + 's) va DESPRES de ' + cur.num +
                                ' (' + cur.time.toFixed(2) + 's) a la llista, pero l\'escaleta el situa ABANS. El faro ' + cur.num +
                                ' no es toca -> ' + prev.num + ' al tall anterior: ' + novaPrev.toFixed(2) + 's');
                            prev.time = novaPrev;
                            placements.push({ prefix: prev.num, timeSec: novaPrev, comment: prev.comment, colorIdx: prev.color });
                        }
                    } else if (!cur.hasOnAir && prev.hasOnAir) {
                        if (curOnCut !== null) {
                            log('   ⏭️ [F6·Ordre] ' + cur.num + ' ja està en un tall (' + curOnCut.toFixed(2) + 's) → NO es mou');
                        } else {
                            var novaCur = Math.max(prev.time + 0.5, this._prevCutBefore(cur.time, clips));
                            if (novaCur >= cur.time) novaCur = cur.time;
                            log('   🔧 [F6·Ordre] Inversio: ' + cur.num + ' (' + cur.time.toFixed(2) + 's) va ABANS de ' + prev.num +
                                ' (' + prev.time.toFixed(2) + 's), pero l\'escaleta el situa DESPRES -> ' + novaCur.toFixed(2) + 's');
                            cur.time = novaCur;
                            placements.push({ prefix: cur.num, timeSec: novaCur, comment: cur.comment, colorIdx: cur.color });
                        }
                    } else if (!cur.hasOnAir && !prev.hasOnAir) {
                        if (curOnCut !== null) {
                            log('   ⏭️ [F6·Ordre] ' + cur.num + ' ja està en un tall (' + curOnCut.toFixed(2) + 's) → NO es mou (inversió entre deduïts)');
                        } else {
                            var novaCur2 = prev.time + 0.5;
                            log('   🔧 [F6·Ordre] Inversio entre deduits: ' + cur.num + ' passa a ' + novaCur2.toFixed(2) + 's (ordre relatiu)');
                            cur.time = novaCur2;
                            placements.push({ prefix: cur.num, timeSec: novaCur2, comment: cur.comment, colorIdx: cur.color });
                        }
                    } else {
                        log('   ⚠️ [F6·Ordre] Inversio entre DOS faros (' + prev.num + ' / ' + cur.num + '): no es toca res (OnAir = veritat).');
                    }
                }
                prev = cur;
            }

            if (placements.length === 0) {
                log('🟢 [F6·Ordre] Ordre correcte. ✓ FINALITZAT.');
                // (2026-09-22) ATENCIÓ: aquest `return` és el camí NORMAL (ordre ja correcte).
                // La cobertura F7 s'ha de cridar ALSO aquí, si no no s'executava mai quan
                // tot l'ordre ja era bo (era el cas del TN_MIGDIA: 02dp/02dir sense marcador).
                await this.ensureMarkerCoverage();
                return;
            }

            var result = await this._safePlaceByPrefixes(placements, 'F6·Ordre');
            log('🟢 [F6·Ordre] Corregits: ' + (result.placed || 0) + ' marcadors. ✓ FINALITZAT.');

            // ── (2026-09-22) F7·COBERTURA ─────────────────────────────────────────
            // Després d'ordenar, garantim que TOTS els ítems estructurals del bloc tenen
            // marcador: si en falta algun (cas real TN_MIGDIA 21/09: ítems "02dp" DONA PAS
            // i "02dir"/CONNEXIÓ), tots els seus rètols (Enviat, Directe, portades,
            // Tema-Títol…) es quedaven sense àncora i no es col·locaven.
            await this.ensureMarkerCoverage();
        },

        /**
         * ensureMarkerCoverage (2026-09-22 · F7): Garanteix que cada ítem estructural de
         * l'escaleta del bloc tingui marcador a la seqüència, perquè els chyrons puguin
         * ancorar-s'hi (donapas "dp", connexions "dir/CONNEXIÓ", etc.).
         *
         * SEGURETAT: només AFEGEIX marcadors d'ítems que NO en tenen. Mai mou, renombra ni
         * esborra cap marcador existent. La posició dels que falta s'interpola linealment
         * entre els seus veïns d'escaleta que SÍ tenen marcador (per ordre d'escaleta);
         * si només hi ha un veí, es col·loca a 0,5 s seu.
         */
        ensureMarkerCoverage: async function () {
            try {
                const ctxData = await getAssemblyContext().loadAssemblyContext();
                if (!ctxData || !ctxData.lines || ctxData.lines.length === 0) return;

                const lines = ctxData.lines;
                const classData = this._classifyItems(lines);
                // Ítems que haurien de tenir marcador: estructurals + els que es deduïen (sense hora)
                const items = []
                    .concat(classData.structuralItems || [])
                    .concat(classData.unplacedItems || []);

                // Prefixos que ja tenen marcador a la seqüència
                const markersRaw = await callJSX('Markers.get()');
                let markers = [];
                try { markers = markersRaw ? JSON.parse(markersRaw) : []; } catch (eM) { markers = []; }
                const jaTe = {};
                for (let mi = 0; mi < markers.length; mi++) {
                    const pref = this._extractPrefixFromComment(markers[mi].comments || '');
                    if (pref) jaTe[String(pref).toLowerCase()] = markers[mi].time;
                }

                // Ordre d'escaleta i posició coneguda de cada ítem
                const idx = [];
                for (let li = 0; li < lines.length; li++) {
                    const num = String(lines[li].num || '').trim();
                    if (!num) continue;
                    idx.push({ num: num, i: li, time: (jaTe[num.toLowerCase()] !== undefined) ? jaTe[num.toLowerCase()] : null });
                }

                const placements = [];
                const saltats = [];
                for (let k = 0; k < idx.length; k++) {
                    const it = idx[k];
                    // Només ítems que haurien de portar marcador
                    if (!items.some(function (x) { return String(x.num || '').trim() === it.num; })) continue;
                    if (it.time !== null) continue;   // ja en té

                    // Veïns amb marcador (per ordre d'escaleta)
                    let prev = null, next = null;
                    for (let a = k - 1; a >= 0; a--) { if (idx[a].time !== null) { prev = idx[a]; break; } }
                    for (let b = k + 1; b < idx.length; b++) { if (idx[b].time !== null) { next = idx[b]; break; } }

                    let t = null;
                    if (prev && next) {
                        const span = next.time - prev.time;
                        const ratio = (k - prev.i) / Math.max(1, (next.i - prev.i));
                        t = prev.time + span * ratio;
                    } else if (prev) {
                        t = prev.time + 0.5;
                    } else if (next) {
                        t = Math.max(0, next.time - 0.5);
                    }
                    if (t === null || isNaN(t)) { saltats.push(it.num); continue; }
                    if (t < 0) t = 0;

                    const line = lines[it.i] || {};
                    // (2026-09-24) REGLA D'USUARI: un marcador VERMELL (ítem NO agrupat, color 1)
                    // només s'ha de crear si queda ENTRE dos marcadors existents, i que almenys
                    // un dels veïns no sigui vermell. ABANS F7 en creava també al FINAL del bloc
                    // (t = prev.time + 0.5) i a l'inici (next.time − 0.5) → "es col·loquen
                    // marcadors vermells al final" (queixa d'usuari 2026-09-24).
                    const colorIdxCov = this._getColorIdx(line);
                    if (colorIdxCov === 1) {
                        const prevColor = prev ? this._getColorIdx(lines[prev.i] || {}) : null;
                        const nextColor = next ? this._getColorIdx(lines[next.i] || {}) : null;
                        const veiNoVermell = ((prevColor !== null && prevColor !== 1) || (nextColor !== null && nextColor !== 1));
                        if (!prev || !next || !veiNoVermell) {
                            log('   ⛔ [F7·Cobertura] ' + it.num + ': ítem VERMELL (no agrupat) fora d\'un interval entre marcadors (prev=' + (prev ? prev.num : '-') + ', next=' + (next ? next.num : '-') + ') → NO es crea.');
                            saltats.push(it.num);
                            continue;
                        }
                    }
                    placements.push({
                        prefix: it.num,
                        timeSec: parseFloat(t.toFixed(2)),
                        comment: it.num + ' - ' + String(line.titol || '').substring(0, 60),
                        colorIdx: colorIdxCov
                    });
                }

                if (placements.length === 0) {
                    log('🛡️ [F7·Cobertura] Tots els ítems estructurals del bloc ja tenen marcador. ✓');
                    return;
                }
                log('🛡️ [F7·Cobertura] Ítems SENSE marcador: ' + placements.map(function (p) { return p.prefix + '@' + p.timeSec + 's'; }).join(', '));
                const res = await this._safePlaceByPrefixes(placements, 'F7·Cobertura');
                log('🛡️ [F7·Cobertura] Afegits ' + (res.placed || 0) + ' marcador(s)' +
                    (saltats.length ? ' · sense veïns per situar: ' + saltats.join(', ') : '') + '. ✓ FINALITZAT.');
            } catch (e) {
                log('⚠️ [F7·Cobertura] ' + e.message, 'WARN');
            }
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

            // (2026-09-30 · BUG #123) El color NO és llegible des de Markers.get()
            // (`color:-1` sempre en PPro 23, veure #108) → ABANS aquesta fase forçava 6
            // (BLAU) i pintava de blau tot el que movia (pendent registrat a
            // docs/archive/SESSIONS.md:5175). El color es recalcula des de l'escaleta
            // del manifest (mateixa solució que #108/#122) i els GRÀFICS se salten
            // (la seva posició la mana F6·Gràfics, igual que a F4·Faro).
            var lineByNumF5 = {};
            try {
                var ctxF5 = await getAssemblyContext().loadAssemblyContext();
                var linesF5 = (ctxF5 && ctxF5.lines) ? ctxF5.lines : [];
                for (var lb5 = 0; lb5 < linesF5.length; lb5++) {
                    if (linesF5[lb5] && linesF5[lb5].num) lineByNumF5[String(linesF5[lb5].num)] = linesF5[lb5];
                }
            } catch (eF5) {
                log('⚠️ [F5·Orphans] Sense escaleta (' + eF5.message + ') → color per defecte', 'WARN');
            }

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

                if (this._isGraphicByNum(prefix)) {
                    log('   ⏭️ [F5·Orphans] ' + prefix + ': és GRÀFIC → no es toca (el mana F6·Gràfics)');
                    continue;
                }

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
                // (2026-09-30 · BUG #123) Color des de l'escaleta (mai 6 per defecte si
                // l'ítem hi consta); `foundMk.color` no és fiable (sempre -1, veure #108).
                var mkColor = lineByNumF5[mvPrefix] ? this._getColorIdx(lineByNumF5[mvPrefix]) : 6;
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
                        // (2026-09-24) PRIORITAT AL MARCADOR DEL VÍDEO (prefix EXACTE = baseNum):
                        // ABANS s'agafava el més aviat dels "estructurals" i amb `01dp`@0.00 +
                        // `01`@63.00 els gràfics s'ancoraven al 0.00 (dins del donapas) → 10s/15s/20s
                        // fora de lloc (queixa d'usuari 2026-09-24: "los grafismos estan fuera de lugar").
                        var exacte = markersByExactPrefix[bn];
                        parentMarkerByPrefix[bn] = (exacte !== undefined && exacte !== null && exacte > 0) ? exacte : structuralTimes[0];
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
                    // (2026-09-30) BUG #122: gràfic SENSE pare dins el bloc que cau a la CUA
                    // (la seva previsió és l'OUT del bloc = escaleta del bloc SEGÜENT, p.ex.
                    // '02 GF-1'/'02 GF-2' amb previsió 21:04:43 = final del V1 del TNV). ABANS
                    // el FALLBACK el col·locava igualment i quedava un marcador sol al final del
                    // timeline ("se ha vuelto a colocar un marker rojo al final"). Es descarta.
                    var _blockEndTl6 = null;
                    try {
                        if (manifest && manifest.ref && isFinite(Number(manifest.ref.worldBlockEndSec))) {
                            _blockEndTl6 = anchorEfTimelineSec + (Number(manifest.ref.worldBlockEndSec) - anchorEfectiva);
                        }
                    } catch (eB6) { _blockEndTl6 = null; }
                    if (_blockEndTl6 !== null && idealPosSec >= _blockEndTl6 - 0.05) {
                        log('   ⏭️ [F6·Gràfics] ' + gNum + ': sense pare al bloc i previsió a la CUA (' + idealPosSec.toFixed(2) + 's ≥ ' + _blockEndTl6.toFixed(2) + 's) → és del bloc següent → no es col·loca', 'WARN');
                        continue;
                    }
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