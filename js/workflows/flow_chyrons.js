/**
 * ============================================================================
 * WORKFLOW: CHYRONS (Conductor, Tema-Titol, col·locació per tipus)
 * ============================================================================
 * Gestiona la inserció de chyrons tipificats (Titol, Conductor, Lloc, Nom,
 * Traducció, Resto) basada en marcadors de timeline.
 * Conté també l'assemblatge automàtic de rètols (runAutoPlacement).
 * ============================================================================
 */

(function () {
    var FASTPASS_UI = window.FASTPASS_UI || {};
    FASTPASS_UI.Workflows = FASTPASS_UI.Workflows || {};

    const getUtils = () => window.FASTPASS_UI.Utils;
    const getClipsLogic = () => window.FASTPASS_UI.Logic.Clips;
    const getParse = () => window.Parse;
    const getAssemblyLogic = () => window.FASTPASS_UI.Logic.Assembly;

    const log = (m, lvl) => getUtils().log(m, lvl || "DEBUG");
    const callJSX = (s, o) => getUtils().callJSX(s, o);

    // (2026-09-22) 1 frame a 25 fps. S'usa per alinear els titulillos (entrada i revers) a la
    // rejilla de frames del timeline i per als ajustos d'1 frame de la cobertura.
    const REV_FRAME = 0.04;

    // (2026-10-01 · #128) El rètol del CONDUCTOR arrossega ~15 frames (0,60 s) de cua BUIDA al
    // final: l'animació ja ha acabat però el clip encara dura. Tot el que s'ancorava al FINAL
    // del clip (Tema-Títol gran en CasB i, per tant, el revers i el congelat del titulillo)
    // entrava aquests 15 frames TARD → s'avancen amb aquest offset.
    const CONDUCTOR_TAIL = 15 * REV_FRAME;   // 0,60 s

    FASTPASS_UI.Workflows.Chyrons = {

        // (2026-10-13) Marca de sessió: l'índex del bin CHY ja s'ha recarregat amb
        // `getWottIndex(true)` dins del run actual (vegeu `_tradMediaDur`). Evita
        // re-escanejar el bin una vegada per traducció. Es reinicia a cada entrada
        // de TRAD (`placeChyronTraduccio`) i REPARTIR (`repartirChyronTraduccio`).
        _tradIdxReloaded: false,

        // ═══════════════════════════════════════════════════════════════
        // ASSEMBLATGE AUTOMÀTIC (THE MAGIC)
        // ═══════════════════════════════════════════════════════════════

        runAutoPlacement: async function (mainTrack = 1) {
            log("🎬 Iniciant Assemblatge Automàtic (THE MAGIC)...");
            const state = FASTPASS_UI.State;
            const cfg = FASTPASS_UI.Config.get();

            let structure = state.structure;
            if (!structure || structure.length === 0) {
                structure = await this._getStructureFromMarkers();
                if (!structure || structure.length === 0) {
                    log("⚠️ No hi ha estructura carregada ni marcadors. Avortant muntatge.");
                    return;
                }
                log(`📊 Usant estructura derivada de ${structure.length} marcadors.`);
            }

            try {
                const clips = await getClipsLogic().getTrackClips(mainTrack, "video");
                await getClipsLogic().cleanFlashWhites(clips, mainTrack);
                log(`📊 Clips obtinguts: ${clips.length}`);
                if (clips.length === 0) return;

                let conductorFile = null;
                try {
                    const conductorSelect = document.getElementById('conductor');
                    const domCond = conductorSelect ? conductorSelect.value : null;
                    if (domCond) {
                        log(`👤 Conductor seleccionat: ${domCond}`);
                        // (2026-09-28) El desplegable llista els .mov de la biblioteca del
                        // NAS, NO ítems del projecte → cal garantir l'ítem (i el nom REAL)
                        // abans d'inserir-lo. Mateix bug que #102 (botó Conduct).
                        conductorFile = await this._ensureConductorInProject(domCond);
                        if (!conductorFile) {
                            log("⚠️ [Conductor] Cap conductor insertable: s'omet.", 'WARN');
                        }
                    }
                } catch (e) {
                    log(`⚠️ No s'ha pogut obtenir el conductor: ${e.message}`);
                }

                let lastConductorTime = null;
                let conductorPlaced = false;

                const struct = structure;
                const mergedStruct = getParse().mergeOffBlocks(struct);
                log(`📊 Estructura carregada: ${struct.length} blocs → fusionats a ${mergedStruct.length} blocs`);
                const markerStruct = await this._getStructureFromMarkers();
                const markerMap = {};
                if (markerStruct && markerStruct.length > 0) {
                    markerStruct.forEach(m => { markerMap[m.id] = m.startTime; });
                    log(`📊 Marcadors disponibles: ${Object.keys(markerMap).length} marcadors`);
                }

                const findClipIndexAtTime = (time) => {
                    let bestIdx = 0;
                    let bestDiff = Math.abs(clips[0].start - time);
                    for (let i = 1; i < clips.length; i++) {
                        const diff = Math.abs(clips[i].start - time);
                        if (diff < bestDiff) { bestDiff = diff; bestIdx = i; }
                    }
                    return bestIdx;
                };

                const blocksWithMarker = [];
                const blocksWithoutMarker = [];
                for (const block of mergedStruct) {
                    if (markerMap[block.id] !== undefined) {
                        blocksWithMarker.push({ block: block, startTime: markerMap[block.id] });
                    } else {
                        blocksWithoutMarker.push(block);
                    }
                }

                for (const bwm of blocksWithMarker) {
                    const block = bwm.block;
                    const start = bwm.startTime;
                    const clipIdx = findClipIndexAtTime(start);
                    const headClip = clips[clipIdx];
                    if (!headClip) continue;

                    log(`🎬 Bloc ${block.id}: start=${start.toFixed(2)}s, clipIdx=${clipIdx}, clipDur=${(headClip.end - headClip.start).toFixed(2)}s`);
                    const cfgTracks = cfg.tracks.video;
                    const blockId = block.id.toLowerCase();
                    const isOffF = (blockId.length >= 2 && blockId[blockId.length - 1] === 'f');

                    if (isOffF) {
                        const conductorStart = await this._placeOffBlockChyrons(block, headClip, cfgTracks, conductorFile);
                        if (conductorStart !== null) { lastConductorTime = conductorStart; conductorPlaced = true; }
                        await this._placeMagicChyrons(block, headClip, cfgTracks, clips, markerMap, lastConductorTime);
                    } else {
                        await this._placeIntroBlockChyrons(block, headClip, cfgTracks);
                        await this._placeMagicChyrons(block, headClip, cfgTracks, clips, markerMap, lastConductorTime);
                    }
                }

                let blockIndex = 0;
                for (const block of blocksWithoutMarker) {
                    if (blockIndex >= clips.length) break;
                    const headClip = clips[blockIndex];
                    blockIndex++;
                    if (!headClip) continue;

                    const start = headClip.start;
                    log(`🎬 Bloc ${block.id} (sense marcador): start=${start.toFixed(2)}s, clipIdx=${blockIndex - 1}`);
                    const cfgTracks = cfg.tracks.video;
                    const blockId = block.id.toLowerCase();
                    const isOffF = (blockId.length >= 2 && blockId[blockId.length - 1] === 'f');

                    if (isOffF) {
                        const conductorStart = await this._placeOffBlockChyrons(block, headClip, cfgTracks, conductorFile);
                        if (conductorStart !== null) { lastConductorTime = conductorStart; conductorPlaced = true; }
                        await this._placeMagicChyrons(block, headClip, cfgTracks, clips, markerMap, lastConductorTime);
                    } else {
                        await this._placeIntroBlockChyrons(block, headClip, cfgTracks);
                        await this._placeMagicChyrons(block, headClip, cfgTracks, clips, markerMap, lastConductorTime);
                    }
                }

                if (!conductorPlaced && conductorFile) {
                    try {
                        const targetTime = clips.length > 0 ? clips[0].start + 7.6 : 7.6;
                        await window.Assembly.conductor(conductorFile, targetTime);
                        log(`👤 Conductor inserit: ${conductorFile} a ${targetTime.toFixed(2)}s`);
                    } catch (e) {
                        log(`⚠️ No s'ha pogut inserir el conductor: ${e.message}`);
                    }
                }
                log("✅ Assemblatge completat.");
            } catch (e) { log(`❌ Error en runAutoPlacement: ${e.message}`); }
        },

        _placeIntroBlockChyrons: async function (block, clip, tracks) {
            const start = clip.start;
            const tematitol = block.chyrons.find(c => c.name.includes("Tema-Titol") || c.name.includes("TITOL"));
            const conductor = block.chyrons.find(c => (c.rol || '').toUpperCase() === "CONDUCTOR");
            if (conductor) {
                if (tematitol) {
                    await callJSX(`Clips.insert('${getUtils().escape(conductor.name)}', ${tracks.chyrons}, ${start + 6.3}, null, 'video')`);
                    await callJSX(`Clips.insert('${getUtils().escape(tematitol.name)}', ${tracks.tematitol}, ${start}, null, 'video')`);
                } else {
                    await callJSX(`Clips.insert('${getUtils().escape(conductor.name)}', ${tracks.chyrons}, ${start}, null, 'video')`);
                }
            }
        },

        _placeOffBlockChyrons: async function (block, clip, tracks, conductorFile) {
            const start = clip.start;
            const conductorStart = start + 0.4;
            const conductorTrack = tracks.chyrons || 5;
            log(`   🎬 OFF (${block.id}): inserint conductor a ${conductorStart.toFixed(2)}s`);
            let conductorName = conductorFile;
            if (!conductorName) {
                const conductorChyron = block.chyrons.find(c => (c.rol || '').toUpperCase() === "CONDUCTOR");
                if (conductorChyron) conductorName = conductorChyron.name;
            }
            if (conductorName) {
                await callJSX(`Clips.insert('${getUtils().escape(conductorName)}', ${conductorTrack}, ${conductorStart}, null, 'video')`);
                const tematitol = block.chyrons.find(c => c.name.includes("Tema-Titol") || c.name.includes("TITOL"));
                if (tematitol) {
                    const tematitolStart = conductorStart + 4.10;
                    const tematitolTrack = tracks.tematitol || tracks.chyrons;
                    log(`   🎬 OFF (${block.id}): inserint Tema‑Titol a ${tematitolStart.toFixed(2)}s`);
                    await callJSX(`Clips.insert('${getUtils().escape(tematitol.name)}', ${tematitolTrack}, ${tematitolStart}, null, 'video')`);
                }
                return conductorStart;
            }
            return null;
        },

        _placeOffVideoChyrons: async function (block, clip, tracks, conductorStart) {
            const tematitol = block.chyrons.find(c => c.name.includes("Tema-Titol") || c.name.includes("TITOL"));
            if (!tematitol) return;
            const tematitolStart = conductorStart ? conductorStart + 4.10 : clip.start + 4.5;
            const tematitolTrack = tracks.tematitol || tracks.chyrons;
            log(`   🎬 OFF_VIDEO (${block.id}): inserint Tema‑Titol a ${tematitolStart.toFixed(2)}s`);
            await callJSX(`Clips.insert('${getUtils().escape(tematitol.name)}', ${tematitolTrack}, ${tematitolStart}, null, 'video')`);
        },

        _placeMagicChyrons: async function (block, headClip, tracks, allClips, markerMap, conductorTime) {
            if (!block.chyrons || block.chyrons.length === 0) return;
            const clipStart = headClip.start;
            const clipEnd = headClip.end;
            const clipDur = clipEnd - clipStart;
            const remaining = block.chyrons.filter(c => {
                const rol = (c.rol || '').toUpperCase();
                return rol !== "CONDUCTOR" && !c.name.includes("Tema-Titol") && !c.name.includes("TITOL");
            });
            if (remaining.length === 0) return;
            log(`   🔮 Magic chyrons (${block.id}): ${remaining.length} per col·locar a clip [${clipStart.toFixed(2)}s-${clipEnd.toFixed(2)}s]`);
            const numChyrons = remaining.length;
            const marginStart = clipStart + 1.0;
            const marginEnd = clipEnd - 1.0;
            const availableSpace = Math.max(1.0, marginEnd - marginStart);
            const spacing = availableSpace / (numChyrons + 1);
            for (let ci = 0; ci < remaining.length; ci++) {
                const chyron = remaining[ci];
                const targetTime = marginStart + spacing * (ci + 1);
                let targetTrack = tracks.chyrons;
                const rol = (chyron.rol || '').toUpperCase();
                if (rol === "NOMCARREC" || chyron.name.includes("NOMCARREC") || chyron.name.includes("NC_")) {
                    targetTrack = tracks.chyrons;
                } else if (rol === "FIRMA" || chyron.name.includes("FIRMA") || chyron.name.includes("FIR_")) {
                    targetTrack = tracks.chyrons;
                } else if (rol === "LLOC" || chyron.name.includes("LLOC") || chyron.name.includes("LL_")) {
                    targetTrack = tracks.lloc || 7;
                } else if (rol === "TEMA" || rol === "TEMATITOL") {
                    targetTrack = tracks.tematitol || tracks.chyrons;
                }
                const safeName = getUtils().escape(chyron.name);
                log(`   🎯 [${block.id}] Chyron ${ci+1}/${numChyrons}: a track ${targetTrack} @ ${targetTime.toFixed(2)}s`);
                await callJSX(`Clips.insert('${safeName}', ${targetTrack}, ${targetTime.toFixed(4)}, null, 'video')`);
            }
        },

        runGuidedAssembly: async function () {
            if (!(await getUtils().validateActiveSequence())) return;
            try {
                const ctx = FASTPASS_UI.State;
                await FASTPASS_UI.SessionManifest.save(ctx, { phases: { clipAnalysisDone: true } });
                const res = await window.FASTPASS_UI.Logic.Assembly.runGuidedAssembly();
                if (res && res.indexOf("OK") !== -1) getUtils().status("Rètols col·locats OK", "exito");
            } catch (e) { getUtils().handleError(e, "runGuidedAssembly"); }
        },

        _getStructureFromMarkers: async function () {
            const markersRaw = await callJSX("Markers.get()");
            var markers = [];
            if (markersRaw && markersRaw !== "[]") { try { markers = JSON.parse(markersRaw); } catch (e) {} }
            if (markers.length === 0) return [];
            var structure = [];
            for (var i = 0; i < markers.length; i++) {
                var m = markers[i];
                var comment = m.comments || '';
                var spaceDashIdx = comment.indexOf(' -');
                if (spaceDashIdx <= 0) continue;
                var prefix = comment.substring(0, spaceDashIdx).replace(/^\s+|\s+$/g, '');
                var numMatch = prefix.match(/^(\d+)/);
                if (!numMatch) continue;
                var num = numMatch[1];
                var suffix = prefix.substring(num.length).toLowerCase();
                var type = "video";
                if (suffix === "f" || suffix === "off") type = "off";
                else if (suffix === "i" || suffix === "intro") type = "intro";
                structure.push({ id: num + (suffix || ''), type: type, startTime: m.time, chyrons: [] });
            }
            log(`📊 Estructura de ${structure.length} marcadors.`);
            return structure;
        },

        verifyTcRefFootprint: async function (refTime, tolerance = 0.5) {
            const clips = await getClipsLogic().getTrackClips(1, 'video');
            if (!clips || clips.length === 0) return false;
            for (var i = 0; i < clips.length; i++) {
                if (Math.abs(clips[i].start - refTime) < tolerance) return true;
                if (Math.abs(clips[i].end - refTime) < tolerance) return true;
            }
            return false;
        },

        // ═══════════════════════════════════════════════════════════════
        // COL·LOCACIÓ PER TIPUS (Botons CHYRONS)
        // ═══════════════════════════════════════════════════════════════

        _snapToNearestCut: async function(idealTimeSec) {
            const clips = await getClipsLogic().getTrackClips(1, "video");
            if (!clips || clips.length === 0) return idealTimeSec;
            let bestStart = 0;
            let bestDist = 999;
            // Només mirar inicis de clip (talls), NO finals.
            // Si el tall més proper és anterior al marcador o massa lluny, usar el marcador.
            for (const cl of clips) {
                const d = Math.abs(cl.start - idealTimeSec);
                if (d < bestDist) { bestDist = d; bestStart = cl.start; }
            }
            // Si el millor tall és ABANS del marcador o massa lluny, usar marcador
            if (bestDist > 1.0 || bestStart < idealTimeSec) {
                log(`   🎯 [_snap] ideal=${idealTimeSec.toFixed(2)}s → cap tall proper (Δ=${bestDist.toFixed(2)}s, bestStart=${bestStart.toFixed(2)}s). Usant marcador directament.`);
                return idealTimeSec;
            }
            log(`   🎯 [_snap] ideal=${idealTimeSec.toFixed(2)}s → clip @ ${bestStart.toFixed(2)}s (Δ=${bestDist.toFixed(2)}s)`);
            return bestStart;
        },

        /**
         * _v6FreeTC: TC de la pista de Tema-Títol on `needSec` segons NO toquen cap clip.
         *
         * L'insert de Premiere és un `overwriteClip`: escriu el mèdia sencer i ESBORRA tot el
         * material que cobreix. Per això una zona "temporal" (snapshot del titulillo, PNG del
         * congelat) MAI pot caure damunt d'un clip de la pista: el PNG estirat del Tema-Títol
         * gran cobreix el bloc sencer, de manera que el TC clàssic (600 s) queia a sobre seu i
         * s'enduia clips de V6. Es proven els TCs clàssics i, si estan ocupats, s'usa un TC
         * DESPRÉS del darrer clip de la pista (zona morta garantida).
         *
         * @param {number} track - Pista de Tema-Títol (1-based, V6)
         * @param {number} needSec - Amplada mínima que necessita la inserció
         * @returns {Promise<number>} TC en segons
         */
        _v6FreeTC: async function (track, needSec) {
            const need = Math.max(0.5, Number(needSec) || 0);
            let clips = [];
            try { clips = (await getClipsLogic().getTrackClips(track, 'video')) || []; } catch (e) { clips = []; }
            const occupied = (tc) => clips.some(c => isFinite(c.start) && isFinite(c.end) &&
                tc < (c.end - 0.05) && (tc + need) > (c.start + 0.05));
            let maxEnd = 0;
            for (const c of clips) { if (isFinite(c.end) && c.end > maxEnd) maxEnd = c.end; }
            for (const tc of [600, 610, 620, 630]) {
                if (!occupied(tc)) return tc;
            }
            const tail = Math.ceil((maxEnd + 5) / REV_FRAME) * REV_FRAME;
            log(`   🧭 [Titol] Zona temporal 600-630s ocupada a V${track} → s'usa ${tail.toFixed(2)}s (darrere del darrer clip)`);
            return tail;
        },

        /**
         * _waitFile: Espera que `path` existeixi i tingui contingut (bytes > 0).
         * `cep.fs.stat` no sempre retorna `.size` en aquest equip → es comprova LLEGINT
         * el fitxer (mateix criteri que el congelat de la Portada, flow_render.js).
         * @param {string} path
         * @param {number} [tries] - Intents (100 ms cadascun)
         * @returns {Promise<number>} Bytes escrits, o 0 si no hi és
         */
        _waitFile: async function (path, tries) {
            const n = (typeof tries === 'number') ? tries : 20;
            for (let i = 0; i < n; i++) {
                try {
                    const rr = window.cep.fs.readFile(path);
                    if (rr && rr.err === 0 && rr.data) {
                        const b = (typeof rr.data.length === 'number') ? rr.data.length : (rr.data.byteLength || 0);
                        if (b > 0) return b;
                    }
                } catch (eR) { }
                await getUtils().delay(100);
            }
            return 0;
        },

        /**
         * _capturePng: Captura el frame del programa a `<pathNoExt>.png`.
         *
         * ⚙️ MECANISME dels congelats (corregit 2026-10-06). La via que funciona és la QE,
         * exposada al panell com `Render.snapshot` (`main.jsx:669` → `FASTPASS.Render.exportFrameQE`
         * → `qeSeq.exportFramePNG`). El 2026-10-05 es va donar per morta per error i es va passar
         * a `Render.frame`, que al DOM actual NO existeix → TOTS els congelats (Tema-Títol,
         * titulillo, mapa, portada) fallaven EN SILENCI.
         * (2026-10-06) MESURAT al motor real (log run del 06/10 09:00): `Render.frame`
         * (= `seq.exportFrame`) LLANÇA «ERR: seq.exportFrame is not a function» → TOTS els
         * congelats fallaven igualment (cap PNG escrit, `Snapshots/` buida, res col·locat).
         * La via BONA és la QE, exposada al panell com **`Render.snapshot`** (`main.jsx:669`
         * → `FASTPASS.Render.exportFrameQE` → `qeSeq.exportFramePNG`): és el mecanisme del
         * commit 6d6cb54 (2026-07-10 «fix:freeze-funciona-importa-CHY-estira-final») ⇒
         * s'intenta ELLA primer i `Render.frame` queda com a segona opció.
         *
         * ⚠️ La captura és del PROGRAMA COMPOST: si el TC cau damunt de vídeo, el PNG se
         * l'endú congelat a dins (invisible en un grafisme a pàgina completa, però NO en un
         * titulillo amb alpha). Per als grafismes amb transparència cal usar `_emptyProgramTC`.
         * Premiere no exporta un frame fora del rang de la seqüència → s'amplia temporalment
         * l'Out point si cal i SEMPRE es restaura.
         *
         * @param {string} pathNoExt - Ruta absoluta SENSE extensió (.png s'afegeix)
         * @param {number} tcSec - Instant a capturar
         * @returns {Promise<{ok:boolean, res:string, bytes:number, path:string, via:string}>} via = 'QE'|'API'
         */
        _capturePng: async function (pathNoExt, tcSec) {
            const utils = getUtils();
            const path = /\.png$/i.test(String(pathNoExt)) ? pathNoExt : (pathNoExt + '.png');
            const base = path.replace(/\.png$/i, '');
            const tc = Number(tcSec) || 0;
            let outRestore = null;
            try {
                const out0 = parseFloat(await callJSX('Timeline.getOut()') || '0');
                if (out0 > 0 && out0 < tc + 1) {
                    outRestore = out0;
                    await callJSX(`Timeline.out(${(tc + 2).toFixed(3)})`);
                    log(`   📐 [_capture] Out point ampliat ${out0.toFixed(2)}s → ${(tc + 2).toFixed(2)}s (per exportar el frame)`);
                }
            } catch (eOut) { }
            let res = '', via = '';
            // 🥇 1) `Render.snapshot` = via QE (`$.global.Render.snapshot` → main.jsx:669 →
            //     `FASTPASS.Render.exportFrameQE` → `qeSeq.exportFramePNG`). ÉS EL MÈTODE QUE
            //     FUNCIONA (commit 6d6cb54 «fix:freeze-funciona…», 2026-07-10): rep la ruta
            //     SENSE extensió (base), converteix segons → HH:MM:SS:FF (25 fps) i crea la
            //     carpeta destí. També va bé amb rutes UNC.
            try { res = await callJSX(`Render.snapshot('${utils.escape(base)}', ${tc.toFixed(4)})`, { rawError: true }); }
            catch (e) { res = 'ERR:' + e.message; }
            let bytes = await this._waitFile(path, 15);
            if (bytes === 0) bytes = await this._waitFile(base, 5);   // QE pot escriure sense .png
            if (bytes > 0) via = 'QE';
            // 🥈 2) API estàndard `Render.frame` (= `seq.exportFrame`): al DOM actual NO existeix
            //     («ERR: seq.exportFrame is not a function»), però es manté com a segona via.
            if (bytes === 0) {
                let res2 = '';
                try { res2 = await callJSX(`Render.frame('${utils.escape(path)}', ${tc.toFixed(4)})`, { rawError: true }); }
                catch (e2) { res2 = 'ERR:' + e2.message; }
                bytes = await this._waitFile(path, 15);
                if (bytes > 0) via = 'API';
                res = res + ' · API→ ' + res2;
            }
            if (outRestore !== null) {
                try { await callJSX(`Timeline.out(${outRestore.toFixed(3)})`); } catch (eR) { }
            }
            if (bytes > 0) {
                log(`   📸 [_capture] PNG a ${path} (${Math.round(bytes / 1024)} KB, t=${tc.toFixed(2)}s, via ${via}, ${res})`);
            } else {
                log(`   ❌ [_capture] Sense PNG a ${path} (QE+API → ${res})`, 'WARN');
            }
            return { ok: bytes > 0, res: res, bytes: bytes, path: path, via: via };
        },

        /**
         * _emptyProgramTC: TC on el PROGRAMA és buit (cap clip a CAP pista de vídeo).
         * (2026-10-05) `_v6FreeTC` només garanteix que la PISTA DESTÍ sigui lliure: a 600 s
         * el vídeo de V1 del bloc hi és, i el PNG d'un titulillo (amb transparència) se
         * l'enduria congelat a dins. Aquí es va DESPRÉS del darrer clip de totes les pistes.
         * @param {number} needSec - Amplada mínima que necessita la inserció temporal
         * @returns {Promise<number>} TC en segons
         */
        _emptyProgramTC: async function (needSec) {
            const need = Math.max(0.5, Number(needSec) || 0);
            let maxEnd = 0;
            let nTracks = 0;
            try { nTracks = parseInt(await callJSX("Tracks.count('video')") || '0', 10) || 0; } catch (eN) { nTracks = 0; }
            for (let t = 1; t <= nTracks; t++) {
                try {
                    const cl = (await getClipsLogic().getTrackClips(t, 'video')) || [];
                    for (const c of cl) { if (isFinite(c.end) && c.end > maxEnd) maxEnd = c.end; }
                } catch (eC) { }
            }
            const tc = (maxEnd > 0) ? (Math.ceil((maxEnd + 5) / REV_FRAME) * REV_FRAME) : 600;
            log(`   🧭 [_emptyProgramTC] programa buit a ${tc.toFixed(2)}s (darrer clip ${maxEnd > 0 ? maxEnd.toFixed(2) + 's' : '?'} · ${nTracks} pistes de vídeo · necessita ${need.toFixed(1)}s)`);
            return tc;
        },

        /**
         * _freezeTemaTitol: Col·loca un wott amb el seu congelat estirat:
         *   1. Insereix el wott en una zona temporal lliure i captura el seu ÚLTIM frame.
         *   2. Treu el clip temporal i insereix el wott d'animació a `placeTime` (`CUT_OFFSET`
         *      segons = 8 s al Tema-Títol; a la cadena TITOLET, la durada de la targeta).
         *   3. Importa el PNG al bin CHY i l'estira des de `cutTime` fins a `stretchEnd`.
         * @param {string} wottName
         * @param {number} placeTime - Inici del clip d'animació
         * @param {number|null} stretchEnd - Final del congelat (null = final de la seqüència)
         * @param {string} label
         * @param {Object} [opts] - {track, animSec, tempTC, freezeSec, frameMid}: pista destí,
         *   durada del clip d'animació (part viva), zona temporal lliure ja calculada i durada
         *   del congelat (ho usa la CADENA TITOLET). `freezeSec` = 0 → SENSE congelat (s'estalvia
         *   tot el procés del PNG). `frameMid` = captura el frame del congelat al 60 % del clip.
         * @returns {Promise<{success:boolean, duration:number}>}
         */
        _freezeTemaTitol: async function (wottName, placeTime, stretchEnd, label, opts) {
            const o = opts || {};
            const cfg = FASTPASS_UI.Config.get();
            const T_THEME = (parseInt(o.track, 10) > 0) ? parseInt(o.track, 10) : cfg.tracks.video.tematitol;
            const utils = getUtils();
            // (2026-10-08) `jsxName` → el JSX fa `decodeURIComponent` sobre el nom: un `%`
            // literal ha d'arribar com a `%25` o la inserció falla («Bad or invalid URI»).
            const escapedWott = utils.escape(utils.jsxName(wottName));
            const CUT_OFFSET = (Number(o.animSec) > 0.1) ? Number(o.animSec) : 8.0;
            // (2026-10-06, 5a passada) La cadena TITOLET passa `freezeSec` explícit: si és 0 no
            // hi ha congelat i no cal fer el viatge sencer del PNG (temporal + captura + import).
            const needFreeze = (o.freezeSec != null) ? (Number(o.freezeSec) > 0.05) : true;
            log(`   🧊 [_freeze] wott="${wottName.substring(0, 50)}..." placeTime=${placeTime.toFixed(2)}s stretchEnd=${stretchEnd !== null ? stretchEnd.toFixed(2) : 'final'} (V${T_THEME}, anim ${CUT_OFFSET.toFixed(2)}s, congelat ${needFreeze ? ((stretchEnd !== null) ? Math.max(stretchEnd - (placeTime + CUT_OFFSET), 0).toFixed(2) : 'fins al final') : 'NO'}s)`);
            // (2026-10-01 · #129) Zona temporal LLIURE: el PNG estirat del Tema-Títol anterior
            // pot cobrir el TC clàssic (600 s) i l'insert l'esborraria.
            // (2026-10-06) Si el cridador ja n'ha calculat una (`opts.tempTC`, cadena TITOLET →
            // `_emptyProgramTC`: TC lliure a TOTES les pistes), s'usa AQUELLA: el TITOLET és un
            // grafisme amb TRANSPARÈNCIA i amb un TC amb contingut al darrere el PNG sortiria
            // amb el vídeo incrustat (l'alfa es perd).
            const TEMP_TC = (Number(o.tempTC) > 0) ? Number(o.tempTC) : await this._v6FreeTC(T_THEME, 12);
            const cutTime = placeTime + CUT_OFFSET;
            // (2026-10-08) `Clips.insert` pot FALLAR i tornar «ERR: …»/«EXC: …» (p.ex. «Bad or
            // invalid URI» amb un `%` al nom): abans es cridava a cegues i el flux continuava
            // com si el clip hi fos.
            const isErrRes = (r) => /^\s*(ERR|EXC)/i.test(String(r || ''));

            // 0. SENSE congelat (5a passada): només el clip d'animació, sense tocar el PNG.
            if (!needFreeze) {
                const rOne = String(await callJSX(`Clips.insert('${escapedWott}', ${T_THEME}, ${placeTime}, null, 'video')`) || '');
                if (isErrRes(rOne)) {
                    log(`   ❌ [_freeze] Clip NO inserit a V${T_THEME} @ ${placeTime.toFixed(2)}s (${rOne}) → rètol NO col·locat`, "ERROR");
                    return { success: false, duration: 0 };
                }
                await callJSX(`Clips.endAt(${T_THEME}, ${placeTime}, ${cutTime}, 'video')`);
                log(`   🎞️ [_freeze] Clip animació inserit a V${T_THEME} @ ${placeTime.toFixed(2)}s→${cutTime.toFixed(2)}s (SENSE congelat)`);
                return { success: true, duration: 0 };
            }

            // 1. Inserir Wott TEMPORALMENT a la zona lliure (clip sol, sense cap altre clip)
            // (2026-10-08) ⚠️ ABANS es cridava a cegues i es capturava el frame igualment. Sense
            // clip temporal, el TC de captura cau damunt del PROGRAMA i el PNG surt amb el VÍDEO
            // DE V1 en lloc del grafisme (cas real TNM V3 08/10 13:39: PNG de 524 KB en lloc de
            // 35 KB + «ERR_CLIP_NOT_FOUND_AT_119.12» en voler esborrar el temporal). Ara es
            // VERIFICA que el clip hi sigui i, si no s'hi pot posar, es col·loca NOMÉS el clip
            // viu (sense congelat) en lloc d'un congelat FALS amb imatge del programa.
            let resTemp = String(await callJSX(`Clips.insert('${escapedWott}', ${T_THEME}, ${TEMP_TC}, null, 'video')`) || '');
            let tmpClip = null;
            for (let iIns = 0; iIns < 3; iIns++) {
                if (iIns > 0) {
                    await utils.delay(400);
                    resTemp = String(await callJSX(`Clips.insert('${escapedWott}', ${T_THEME}, ${TEMP_TC}, null, 'video')`) || '');
                }
                await utils.delay(300);
                try {
                    const clTmp = (await getClipsLogic().getTrackClips(T_THEME, 'video')) || [];
                    tmpClip = clTmp.filter(c => Math.abs(c.start - TEMP_TC) < 0.5)[0] || null;
                } catch (eVT) { tmpClip = null; }
                if (tmpClip) break;
            }
            if (!tmpClip) {
                log(`   ⚠️ [_freeze] Wott temporal NO inserit a V${T_THEME} @ ${TEMP_TC.toFixed(2)}s (${resTemp || 'sense resposta'}) → SENSE congelat: només clip viu`, "WARN");
                const rLive = String(await callJSX(`Clips.insert('${escapedWott}', ${T_THEME}, ${placeTime}, null, 'video')`) || '');
                if (isErrRes(rLive)) {
                    log(`   ❌ [_freeze] Ni el clip viu s'ha pogut inserir (${rLive}) → rètol NO col·locat`, "ERROR");
                    return { success: false, duration: 0 };
                }
                await callJSX(`Clips.endAt(${T_THEME}, ${placeTime}, ${cutTime}, 'video')`);
                log(`   🎞️ [_freeze] Clip animació inserit a V${T_THEME} @ ${placeTime.toFixed(2)}s→${cutTime.toFixed(2)}s (SENSE congelat)`);
                return { success: true, duration: 0 };
            }

            // 2. Capturar l'ÚLTIM frame del wott temporal. El TC es pren del final REAL del
            //    clip temporal (no de TEMP_TC + 8 s: si el mèdia és més curt, aquell instant
            //    cauria fora del clip i el PNG sortiria buit).
            let tmpDur = CUT_OFFSET;
            if (tmpClip && isFinite(tmpClip.end) && tmpClip.end > TEMP_TC + 0.05) {
                tmpDur = Math.min(CUT_OFFSET, tmpClip.end - TEMP_TC);
            }
            // Instant del frame congelat. (2026-10-06, 5a passada) Amb `opts.frameMid` es captura
            // al 60 % del clip: quan la part viva és el clip SENCER, el darrer frame cau a
            // l'animació de sortida (o al final del mèdia) i el PNG sortiria BUID → «congelat
            // invisible» (l'usuari ho veia com un congelat innecessari).
            // (2026-10-12) `opts.grabFrac` permet que cada flux tingui el SEU instant de
            // captura (TITOLET vs TRADUCCIÓ); si no arriba, mana la clau del TITOLET.
            const grabFrac = (Number(o.grabFrac) > 0) ? Number(o.grabFrac)
                : ((cfg && cfg.titolet && Number(cfg.titolet.freezeGrabFrac) > 0) ? Number(cfg.titolet.freezeGrabFrac) : 0);
            const grabOff = (o.frameMid === true && grabFrac > 0)
                ? Math.min(tmpDur - REV_FRAME, Math.max(REV_FRAME, tmpDur * grabFrac))
                : (tmpDur - REV_FRAME);
            const snapTC = Math.max(TEMP_TC, TEMP_TC + grabOff);
            await callJSX(`Timeline.set(${snapTC})`);
            await utils.delay(400);

            const folder = await callJSX("Context.folder()");
            const snapPath = `${folder}\\Snapshots\\freeze_${Date.now()}.png`;
            const cap = await this._capturePng(snapPath.replace(/\.png$/i, ''), snapTC);
            const snapResult = cap.res;
            
            // Tornar el cabezal a la posició original per restaurar la vista
            await callJSX(`Timeline.set(${cutTime})`);
            log(`   📍 [_freeze] Cabezal retornat a ${cutTime.toFixed(2)}s`);

            // 3. Eliminar el Wott temporal de la pista
            // Esborrar NOMÉS el clip temporal (és a TEMP_TC). Amb diversos Tema‑Titol
            // col·locats, l'índex 0 seria el primer clip legítim del bloc.
            try {
                const rmT = await callJSX(`Clips.removeAt(${T_THEME}, ${TEMP_TC}, 'video')`);
                log(`   🗑️ [_freeze] Wott temporal eliminat de V${T_THEME} @ ${TEMP_TC.toFixed(2)}s (${rmT})`);
            } catch (eRT) {
                log(`   ⚠️ [_freeze] No s'ha pogut eliminar el temporal: ${eRT.message}`, "WARN");
            }

            if (!cap.ok) {
                log(`   ❌ [_freeze] Congelat SENSE PNG a ${snapPath} (via ${cap.via || 'cap'} → ${snapResult}) → no es col·loca res`, "ERROR");
                return { success: false, duration: 0 };
            }

            // 4. Inserir ara el Wott d'animació a placeTime (0→CUT_OFFSET)
            // (2026-10-01 · #129) SENSE endSec: `Clips.insert(..., endSec)` retalla el DARRER clip
            // de la pista (clips[numItems-1].end). El final es fixa amb `Clips.endAt` (cerca pel
            // start → immunitzat a renumeracions de clips).
            const resAnim = String(await callJSX(`Clips.insert('${escapedWott}', ${T_THEME}, ${placeTime}, null, 'video')`) || '');
            if (isErrRes(resAnim)) {
                log(`   ❌ [_freeze] Clip d'animació NO inserit a V${T_THEME} @ ${placeTime.toFixed(2)}s (${resAnim}) → rètol NO col·locat`, "ERROR");
                return { success: false, duration: 0 };
            }
            await callJSX(`Clips.endAt(${T_THEME}, ${placeTime}, ${cutTime}, 'video')`);
            log(`   🎞️ [_freeze] Clip animació inserit a V${T_THEME} @ ${placeTime.toFixed(2)}s→${cutTime.toFixed(2)}s`);

            // 5. Importar PNG al bin CHY (el congelat ja és a snapPath: `_capturePng` prova
            //    `Render.snapshot` (via QE `exportFramePNG`) i deixa `Render.frame` de reserva;
            //    `cap.via` diu quina de les dues ha escrit el PNG)
            const fileName = snapPath.split("\\").pop();
            const importPayload = JSON.stringify([snapPath]);
            await callJSX(`IO.importFiles('${utils.escape(importPayload)}', 'CHY')`);

            // 6. Determinar durada i inserir PNG estirat a la pista des de cutTime fins a stretchEnd
            let duration;
            if (stretchEnd !== null && stretchEnd !== undefined) {
                duration = Math.max(stretchEnd - cutTime, 0.5);
            } else {
                const timelineDur = parseFloat(await callJSX("Timeline.duration()") || "0");
                duration = Math.max(timelineDur - cutTime, 0.5);
            }
            // (2026-10-01 · #129) Insert sense endSec + `endAt` (vegeu punt 4): el PNG estirat
            // no ha de retallar el darrer clip de la pista.
            await callJSX(`Clips.insert('${utils.escape(fileName)}', ${T_THEME}, ${cutTime}, null, 'video')`);
            await callJSX(`Clips.endAt(${T_THEME}, ${cutTime}, ${cutTime + duration}, 'video')`);
            log(`   ✅ [_freeze] PNG "${fileName}" → CHY → V${T_THEME} @ ${cutTime.toFixed(2)}s dur=${duration.toFixed(1)}s (fi=${stretchEnd !== null ? stretchEnd.toFixed(2) : 'final'})s`);
            
            return { success: true, duration };
        },

        /**
         * _isStillMedia: El mèdia d'aquest rètol és una IMATGE FIXA (PNG/JPG…)?
         * Un mèdia fix s'estira sense límit (Premiere el manté) → mai necessita congelat.
         * @param {string} name
         * @returns {boolean}
         */
        _isStillMedia: function (name) {
            return /\.(png|jpe?g|tiff?|psd|bmp|gif|eps|ai)$/i.test(String(name || ''));
        },

        /**
         * _tradMediaDur: Durada REAL (segons) del mèdia d'un rètol, 0 si no es pot resoldre.
         *
         * És la dada que decideix si cal CONGELAR la cua d'una traducció: si el mèdia és més
         * CURT que l'espai del seu slot, `Clips.insert` + `Clips.endAt(slotEnd)` l'estiraria
         * més enllà del mèdia i la cua quedaria BUIDA.
         *
         * Fonts, per ordre de confiança:
         *   1. Durada del DOM al bin CHY (`_resolveWottDur`, fonts 'bin'/'bin~norm'/'bin~id').
         *   2. Durada de l'ítem del projecte (`Logic.Project.getDuration` → JSX
         *      `Project.itemDuration`).
         *   3. (2026-10-13) Estimació per MIDA de fitxer (`src` 'mida*').
         * Un mèdia FIX (PNG) sempre retorna 0: s'estira sense problema.
         *
         * ⚠️ (2026-10-13) PER QUÈ L'ESTIMACIÓ JA S'ACCEPTA (abans es rebutjava per disseny):
         * el test d'usuari del TNM V3 (13/10 10:11, 5 trad. al tram [34.64→51.00]) va sortir
         * amb «durada del mèdia NO resolta → col·locat estirat» a TOTS els slots. Dues causes
         * reals, totes dues al log:
         *   · `⏱️ Bin CHY: 19 fitxers, 0 amb durada del DOM` → en aquest projecte
         *     `projectItem.duration` NO és numèric per a CAP ítem (el DOM no dóna durades).
         *   · l'índex del bin s'indexa ABANS d'importar les traduccions i es guarda per nom de
         *     projecte (`_wottIdxCache`): la fase Traducció corre DESPRÉS de Titol/Lloc/Nom →
         *     sense entrada al bin no hi ha NI durada NI mida per estimar-la.
         * Conseqüència: el congelat no s'activava mai i, amb un slot més llarg que el mèdia,
         * la cua quedava BUIDA (just el bug que el congelat del 12/10 havia d'evitar).
         * Mesurat amb ffprobe als fitxers reals (NAS VERTICALITZACIO): 6.000 s i 260,7 MB →
         * 43,5 MB/s CONSTANTS, i el default del codi (43.500.000 B/s) hi encaixa (±5 %), prou
         * per decidir el congelat (llindar `freezeMinSec` = 0,12 s). El risc d'error del 20 %
         * que va motivar rebutjar-la NO es compleix en aquesta família de ProRes.
         *
         * @param {Object} chy - chyron {name, rol, tc, path}
         * @param {Object} wottIdx - índex de `Logic.Project.getWottIndex()` (pot ser null)
         * @returns {Promise<number>} segons, o 0 si no es pot resoldre
         */
        _tradMediaDur: async function (chy, wottIdx) {
            const name = String((chy && chy.name) || '');
            if (!name || this._isStillMedia(name)) return 0;
            const PL = FASTPASS_UI.Logic.Project;
            const short = name.substring(0, 34);
            // 1) DOM del bin CHY (nom → norm → ID).
            let r = null;
            try { r = (PL && PL._resolveWottDur) ? PL._resolveWottDur(wottIdx, chy) : null; } catch (eD) { }
            if (r && r.dur > 0.1 && /^bin/.test(String(r.src || ''))) return r.dur;
            // 1b) (2026-10-13) XARXA: l'índex pot ser VELL (indexat abans d'importar les
            //     traduccions). Es recarrega UNA vegada per run i es reintenta.
            if (!this._tradIdxReloaded) {
                this._tradIdxReloaded = true;
                try {
                    const fresh = await PL.getWottIndex(true);
                    const r2 = PL._resolveWottDur(fresh, chy);
                    if (r2 && r2.dur > 0.1) {
                        if (/^bin/.test(String(r2.src || ''))) {
                            log(`   📏 [Traducció] «${short}…» durada del DOM resolta en recarregar l'índex del bin CHY: ${r2.dur.toFixed(2)}s`);
                            return r2.dur;
                        }
                        r = r2;      // estimació per mida → la decideix el pas 3
                    }
                } catch (eR) { log(`   ⚠️ [Traducció] no s'ha pogut recarregar l'índex del bin CHY: ${eR.message}`, "WARN"); }
            }
            // 2) Durada de l'ítem del projecte.
            try {
                const d = await PL.getDuration(name);
                if (d > 0.1) return d;
            } catch (eD2) { }
            // 3) ÚLTIM RECURS (2026-10-13): estimació per mida de fitxer.
            //    ⚠️ CORRECCIÓ MESURADA: el default de `_resolveWottDur` (43.500.000 B/s)
            //    agafa el bitrate com a MB/s decimals, però els ProRes 422 HQ verticals del
            //    canal són a 43,45 MiB/s = 45.560.000 B/s → sobreestima un 4,7 % (ffprobe als
            //    fitxers reals: 273.365.736 B = 6.000 s). Aquí es corregeix i, a més, se
            //    subestima un pèl a posta (`× 0,995`): el congelat comença 1-3 frames ABANS
            //    del final real del clip viu → se SOLAPA amb el mateix rètol (invisible) i
            //    MAI deixa forat. Sobreestimar deixaria 7 frames sense rètol en un clip de 6 s.
            if (r && r.dur > 0.1) {
                const est = r.dur * 0.9548 * 0.995;      // 43,5/45,56 MB/s · marge de solapament
                if (est > 0.1 && est < 600) {
                    log(`   📏 [Traducció] «${short}…» durada ESTIMADA per mida de fitxer: ${est.toFixed(2)}s ` +
                        `(brut ${r.dur.toFixed(2)}s, ${r.src}` + (r.size > 0 ? `, ${(r.size / 1048576).toFixed(1)} MB` : '') +
                        `) — el DOM no la dóna`, "WARN");
                    return est;
                }
            }
            return 0;
        },

        /**
         * _placeTradSlot: Col·loca UN rètol de traducció al seu slot [start, end] SENSE
         * estirar-lo més enllà del seu mèdia.
         *
         * 🧊 PROBLEMA (2026-10-12): l'espai assignat a una traducció pot ser més LLARG que la
         * durada del seu mèdia. Com que `Clips.insert` (overwrite) sempre col·loca la durada
         * COMPLETA del mèdia i tot seguit es fixava el final amb `Clips.endAt(slotEnd)`, el clip
         * quedava ESTIRAT més enllà del mèdia → cua BUIDA (clip al timeline, sense imatge).
         *
         * ✅ SOLUCIÓ: si `mediaDur < slot`, la part viva és el clip SENCER (durada del mèdia) i
         * la cua s'omple amb el CONGELAT del seu darrer frame, amb la MATEIXA mecànica del
         * Tema-Títol (`_freezeTemaTitol`: clip temporal a la zona lliure del final del timeline
         * + `_capturePng` + import al bin CHY + PNG estirat). Zero JSX nou.
         *
         * @param {Object} p - {chy, track, start, end, mediaDur, tempTC, label}
         *   · `mediaDur` = durada real del mèdia (0 = no resolta → comportament antic).
         *   · `tempTC` = TC de la zona LLIURE del final del timeline (el cridador el calcula amb
         *     `_emptyProgramTC`: el PROGRAMA ha de ser BUID perquè el PNG conservi l'ALPHA del
         *     rètol i no s'endugui cap frame de vídeo congelat a dins). Si no arriba, es calcula.
         * @returns {Promise<{ok:boolean, mode:'live'|'freeze', live:number, media:number, err?:string}>}
         */
        _placeTradSlot: async function (p) {
            const utils = getUtils();
            const cfg = FASTPASS_UI.Config.get();
            const TR = (cfg && cfg.traduccio) ? cfg.traduccio : {};
            const tag = p.label || 'Traducció';
            const name = String((p.chy && p.chy.name) || '');
            const track = parseInt(p.track, 10);
            const start = Number(p.start);
            const end = Number(p.end);
            const span = Math.max(0.2, end - start);
            const media = (Number(p.mediaDur) > 0.1) ? Number(p.mediaDur) : 0;
            const minFreeze = (Number(TR.freezeMinSec) > 0) ? Number(TR.freezeMinSec) : 0.12;
            const short = String(name).substring(0, 34);
            // (2026-10-08) `jsxName`: el JSX fa `decodeURIComponent` sobre el nom → un `%`
            // literal ha d'arribar com a `%25` o la inserció falla en silenci.
            const escapedName = utils.escape(utils.jsxName(name));
            const isErrRes = (r) => /^\s*(ERR|EXC)/i.test(String(r || ''));
            // Insert SENSE endSec (el JSX l'aplicaria al DARRER clip de la pista: quirk de
            // l'API) i final fixat amb `Clips.endAt`, que cerca el clip PER TEMPS.
            const insertLive = async () => {
                const rIns = String(await callJSX(`Clips.insert('${escapedName}', ${track}, ${start.toFixed(4)}, null, 'video')`) || '');
                if (isErrRes(rIns)) return rIns;
                return String(await callJSX(`Clips.endAt(${track}, ${start.toFixed(4)}, ${end.toFixed(4)}, 'video')`) || '');
            };
            // ── Sense congelat: el mèdia ja cobreix el slot (o no s'ha pogut resoldre) ──
            const wantFreeze = (TR.freezeTail !== false) && media > 0.1 && (span - media) >= minFreeze;
            if (!wantFreeze) {
                const rLive = await insertLive();
                if (isErrRes(rLive)) {
                    log(`      ❌ [${tag}] «${short}…» clip NO inserit a V${track} @ ${start.toFixed(2)}s (${rLive})`, "ERROR");
                    return { ok: false, mode: 'live', live: span, media: media, err: rLive };
                }
                if (!(media > 0.1) && !this._isStillMedia(name)) {
                    log(`      ⚠️ [${tag}] «${short}…» durada del mèdia NO resolta → col·locat estirat a ${span.toFixed(2)}s: si el slot és més llarg que el mèdia, la cua quedarà buida`, "WARN");
                }
                return { ok: true, mode: 'live', live: span, media: media, trim: rLive };
            }

            // ── Congelat de la cua: part viva = clip sencer · cua = PNG del frame congelat ──
            // El congelat cobreix TOTA la cua (`span − media`): és l'espai que s'ha de veure
            // amb el rètol, no pas buit.
            const freeze = Math.max(0, span - media);
            let tempTC = (Number(p.tempTC) > 0) ? Number(p.tempTC) : 0;
            if (!(tempTC > 0)) {
                // Xarxa: sense una zona de PROGRAMA BUID, el PNG s'enduria el vídeo de sota
                // (l'alpha es perd) → es calcula aquí mateix.
                tempTC = await this._emptyProgramTC(media + 2);
            }
            const fr = await this._freezeTemaTitol(name, start, end, tag, {
                track: track,
                animSec: media,
                tempTC: tempTC,
                freezeSec: freeze,
                frameMid: true,
                grabFrac: (Number(TR.freezeGrabFrac) > 0) ? Number(TR.freezeGrabFrac) : undefined
            });
            if (fr && fr.success) {
                log(`      🧊 [${tag}] «${short}…» → V${track} @ ${start.toFixed(2)}s→${end.toFixed(2)}s (viu ${media.toFixed(2)}s + congelat ${freeze.toFixed(2)}s)`);
                return { ok: true, mode: 'freeze', live: media, media: media, freeze: freeze, tempTC: tempTC };
            }

            // Xarxa: si el congelat falla, es col·loca el clip ESTIRAT (comportament antic) per
            // no deixar el slot sense rètol.
            log(`      ⚠️ [${tag}] «${short}…» congelat FALLIT → es col·loca estirat (${span.toFixed(2)}s)`, "WARN");
            const rBack = await insertLive();
            if (isErrRes(rBack)) {
                log(`      ❌ [${tag}] «${short}…» clip NO inserit a V${track} @ ${start.toFixed(2)}s (${rBack})`, "ERROR");
                return { ok: false, mode: 'live', live: span, media: media, err: rBack };
            }
            return { ok: true, mode: 'live', live: span, media: media, trim: rBack };
        },

        /**
         * _wfCtx: CONTEXT DE SESSIÓ (config, progData, bloque, dateDir) per als mòduls que
         * llegeixen el manifest.
         *
         * ⚠️ (2026-10-06) Dins de `_placeChyronsByType` hi ha una variable LOCAL
         * `ctx = { busy, placed }` (el ctx de COL·LOCACIÓ, el que alimenta `_addPlaced`).
         * NO serveix per al manifest: `SessionManifest.getPath` fa `ctx.progData.wott` →
         * «Cannot read properties of undefined (reading 'wott')». Aquest va ser el motiu
         * real que la detecció TITOLET no s'executés mai (log: `TITOLET detecció amb error
         * (Cannot read properties of undefined (reading 'wott')) → fallback`).
         *
         * Si State encara no porta `progData` (fluxos previs al Muntar), es recupera del
         * select del panell amb la mateixa regla que `Core.AssemblyContext.loadAssemblyContext`.
         * @returns {Object} FASTPASS_UI.State (usa'l COM A ctx)
         */
        _wfCtx: function () {
            const S = FASTPASS_UI.State || {};
            try {
                if (!S.progData) {
                    const cfg = FASTPASS_UI.Config.get();
                    const sel = document.getElementById('programa');
                    if (sel && sel.value && cfg.mapeoProgramas && cfg.mapeoProgramas[sel.value]) {
                        S.progData = cfg.mapeoProgramas[sel.value];
                        const bs = document.getElementById('bloc');
                        if (!S.bloque && bs && bs.value) S.bloque = bs.value;
                        log(`   ⚠️ [wfCtx] progData recuperat del select (${sel.value})`);
                    } else {
                        log(`   ⚠️ [wfCtx] sense progData (select de programa buit) → el manifest no es podrà resoldre`, 'WARN');
                    }
                }
                if (!S.config) S.config = FASTPASS_UI.Config.get();
            } catch (e) { }
            return S;
        },

        /**
         * _fileExists: existeix aquest fitxer? (CEP fs.stat — mateix criteri que
         * `flow_chyrons._capturePng` i `flow_render.waitFile`).
         * @param {string} path
         * @returns {boolean}
         */
        _fileExists: function (path) {
            try {
                const fs = window.cep && window.cep.fs;
                if (fs && fs.stat && path) return !!(fs.stat(path) && fs.stat(path).err === 0);
            } catch (e) { }
            return false;
        },

        /**
         * _titoletAnchor: Àncora un instant de la TIMELINE a un instant del FITXER de vídeo
         * que s'ha d'escanejar per detectar el TITOLET.
         *
         * ⚠️ (2026-10-06, 2a passada) La timeline NO conté el cleanFeed: conté el CLIP EXTRET
         * del bloc (`<WOTT>_<BLOC>_CLIP.mp4`, a la carpeta de treball). El seu `inPoint` és
         * temps DINS del fitxer del clip, i l'ancoratge bo és el MATEIX que fan servir els
         * marcadors (flow_markers FIX-B/D) i els keyframes (`tKey = inPoint + (t − start)`):
         *     fileSec = tlSec + (clip.inPoint − clip.start)
         *
         * Per què no n'hi ha prou amb el manifest: `ref.offsetSec` barreja coords d'ORIGEN i
         * de CLIP EXTRET. Cas real mesurat (TNM V1 2026-10-05): clip 0 = cleanFeed 904 s,
         * bloc = 924 s (cleanFeed) = clip 20 s; `offsetSec = −10` donava cleanFeed 10 s →
         * 0 intervals. Amb l'`inPoint` del clip: 20 s → el rètol hi és.
         *
         * Xarxa de seguretat: si el clip de V1 no és l'extret (o el fitxer no hi és), s'usa
         * el cleanFeed del manifest amb `ref.offsetSec` (fileSec = tlSec − offsetSec).
         *
         * @param {Object} p - {mk, clipsV1, label}
         * @param {Object} wctx - ctx de SESSIÓ (per resoldre la carpeta de treball)
         * @returns {Promise<{ok:boolean, mp4?:string, off?:number, how?:string, why?:string}>}
         *   `off` = desplaçament: fileSec = tlSec + off
         */
        _titoletAnchor: async function (p, wctx) {
            const utils = getUtils();
            // ── 1) CLIP EXTRET del bloc (el que hi ha realment a la timeline) ──
            try {
                const ci = this._clipAtInstant(p.clipsV1 || [], p.mk.time);
                const nm = ci ? String(ci.name || '') : '';
                const inPt = ci ? Number(ci.inPoint) : NaN;
                if (ci && isFinite(inPt) && /_CLIP/i.test(nm)) {
                    const folder = String(utils.workFolder(wctx) || '').replace(/\//g, '\\').replace(/\\+$/, '');
                    const prog = (wctx && wctx.progData && wctx.progData.wott) ? String(wctx.progData.wott) : '';
                    const bloc = (wctx && wctx.bloque) ? String(wctx.bloque) : '';
                    const cands = [folder + '\\' + nm];
                    if (prog && bloc) cands.push(folder + '\\' + prog + '_' + bloc + '_CLIP.mp4');
                    for (const c of cands) {
                        if (!folder || !this._fileExists(c)) continue;
                        const startCl = isFinite(Number(ci.start)) ? Number(ci.start) : 0;
                        return {
                            ok: true, mp4: c, off: inPt - startCl,
                            how: 'CLIP EXTRET «' + nm + '» (inPoint ' + inPt.toFixed(2) + 's − start ' + startCl.toFixed(2) + 's = ' + (inPt - startCl).toFixed(2) + 's)'
                        };
                    }
                    log(`   ⚠️ [${p.label}] ${p.tag || 'TITOLET'} ancoratge: clip extret «${nm}» no trobat a «${folder}» → es prova el cleanFeed`, 'WARN');
                }
            } catch (eC) {
                log(`   ⚠️ [${p.label}] ${p.tag || 'TITOLET'} ancoratge: clip de V1 il·legible (${eC.message})`, 'WARN');
            }
            // ── 2) Xarxa de seguretat: cleanFeed del manifest (ref.offsetSec) ──
            try {
                const man = await FASTPASS_UI.SessionManifest.load(wctx);
                const mp4 = (man && man.cleanFeed && man.cleanFeed.mediaPath) ? man.cleanFeed.mediaPath : null;
                const rOff = (man && man.ref && isFinite(man.ref.offsetSec)) ? Number(man.ref.offsetSec) : null;
                if (!mp4) return { ok: false, why: 'sense MP4 cleanFeed al manifest' };
                if (rOff === null) return { ok: false, why: 'manifest sense ref.offsetSec' };
                return { ok: true, mp4: mp4, off: -rOff, how: 'cleanFeed del manifest (offsetSec ' + rOff.toFixed(2) + 's)' };
            } catch (eM) {
                return { ok: false, why: 'manifest il·legible (' + eM.message + ')' };
            }
        },

        /**
         * _placeTitoletChain: COL·LOCACIÓ DELS GRAFISMES CREMATS al seu instant real
         * (2026-10-05 · reescrit 2026-10-06 · rols ampliats 2026-10-08: 27 tipus de grafisme).
         *
         * DISPARO (2026-10-08): aquesta cadena s'activa NOMÉS si l'ítem porta wotts amb una de
         * les 27 ETIQUETES literals de `titolet.detectRoles` (`_isBurnedGrafWott`): TITOLET ·
         * TITOLET GRAN · PREGUNTA · CARTELL · CIS_CEO · CIS_CEO_COMPARADA · CRONOLOGIA ·
         * CRONOLOGIA-TITOLS · DADA_COMPARADA · DADA-DIFERENCIAL · DADA-GRAN · DADA-GRAN-DIVISA ·
         * DADA-ITEM · DESTACAT · CLASSI-CHAMPIONS · CLASSIFICACIO · CLASSI-MUNDIAL ·
         * CLASSI-PRIMERA · CLASSI-SEGONA · GRAFICA-BARRES · GRAFICA_CIRCULAR · IMATGE-CAPTURA ·
         * LLISTA · LLISTA-DADES · NOTA · PROGRAMACIO · RANQUING (vegeu `TITOLET_DEFAULTS.detectRoles`).
         * La resta d'ítems NO rastregen res (el rastreig no es fa mai «per si de cas»).
         *
         * Un ítem pot portar N rètols d'aquesta família (grafismes de l'INSERT). El rastreig del
         * vídeo cremat (`Logic.TitoletDetect`) diu QUAN va entrar i QUANT va durar cadascun, així
         * que cada targeta va al SEU instant real a la timeline:
         *
         *     placeTime = mk.time + card.relIn     (relIn = segons dins de l'ítem de VÍDEO)
         *     span      = card.on si és 'short' · mèdia + congelat si no
         *
         *     [T1 anim][T1 congelat][1s][T2 anim][T2 congelat][1s]…[Tn]
         *
         *   - Entrada del 1r TITOLET: marcador de l'ítem + 10 frames (0,40 s), la mateixa regla
         *     que la resta de rètols.
         *   - ORDRE: cronològic pel `relIn` detectat (abans s'ordenava pel wottId intern, que és
         *     l'ordre de GENERACIÓ del grafisme i no té res a veure amb el de l'aire).
         *   - 'IMANT' cap ENDARRERE: si l'instant detectat cau a ≤ `snapTolSec` del TALL anterior
         *     de V1, la targeta entra a l'inici d'aquell clip + 10 frames (el taronja ja era a
         *     l'aire uns frames abans de la primera mostra ON).
         *   - SENSE detecció: la targeta s'encadena darrere de l'últim instant detectat.
         *   - PISTA: `_chooseSlot` ([V8 Lloc/Data, V7 rètols]) TARGETA A TARGETA; el rang de cada
         *     targeta es reserva a `ctx` en col·locar-la, així la resta de rètols de l'ítem el
         *     veuen i no hi van a parar (abans es reservava el rang SENCER de la cadena, cosa que
         *     amb la col·locació per instant bloquejaria tot l'ítem).
         *
         * @param {Object} p - {mk, itemEnd, titolets, wottIdx, cfg, ctx, wfCtx, clipsV1, label}
         *   ⚠️ `ctx` = ctx de COL·LOCACIÓ ({busy, placed}) · `wfCtx` = ctx de SESSIÓ (manifest).
         *      `clipsV1` = clips de V1 (per l'ancoratge del TITOLET: `inPoint`).
         * @returns {Promise<number>} Targetes col·locades
         */
        _placeTitoletChain: async function (p) {
            const utils = getUtils();
            const cfg = p.cfg || FASTPASS_UI.Config.get();
            const list = (p.titolets || []).slice();
            if (list.length === 0) return 0;
            // Etiqueta de la traça: el rol que HA DISPARAT la detecció (`p.tag`; p.ex. PREGUNTA).
            // Per defecte 'TITOLET' = comportament antic (logs idèntics als de sempre).
            const TAG = p.tag || 'TITOLET';
            // Clips de V1 (per l'«imant» al tall). ⚠️ (2026-10-06, FIX) El paràmetre és
            // `p.clipsV1`: llegir-lo com a `clipsV1` lliure llançava
            // `ReferenceError: clipsV1 is not defined` a la 1a targeta detectada i
            // AVORTAVA tota la passada Resto (cap TITOLET col·locat).
            const clipsV1 = p.clipsV1 || [];
            const PL = FASTPASS_UI.Logic.Project;
            const V_LLOC = cfg.tracks.video.lloc || cfg.tracks.video.llocdata || 8;
            const V_CHYRONS = cfg.tracks.video.chyrons || 7;
            const ANIM = 5.0;          // durada de la targeta TITOLET (si no es resol el mèdia)
            const FREEZE = 3.0;        // congelat preferit
            const FREEZE_MIN = 1.0;    // congelat quan la cadena no cap dins l'ítem
            const GAP = 1.0;           // marge entre targetes
            const OFF = 0.40;          // 10 frames: entrada del 1r TITOLET
            // Ordre INTERN de les targetes: wottId del nom (només per numerar-les i per a la
            // traça del log). ⚠️ L'ORDRE DE COL·LOCACIÓ ja NO surt d'aquí: ara mana el `relIn`
            // detectat al vídeo cremat (vegeu el PLA DE COL·LOCACIÓ més avall).
            list.sort((a, b) => (PL._wottIdNum(a.name) - PL._wottIdNum(b.name)));
            const start = p.mk.time + OFF;
            const itemEnd = (p.itemEnd && p.itemEnd > start + 0.5) ? p.itemEnd : null;
            const avail = (itemEnd !== null) ? (itemEnd - start) : null;
            // Durada real de cada targeta (ffprobe si el mèdia ja és al projecte)
            const durs = list.map(c => {
                const d = PL._resolveWottDur ? PL._resolveWottDur(p.wottIdx, c) : null;
                const dd = (d && d.dur > 0.1) ? d.dur : ANIM;
                if (!(d && d.dur > 0.1)) log(`   ⚠️ [${p.label}] ${TAG} «${String(c.name).substring(0, 40)}»: durada no resolta → s'assumeix ${ANIM.toFixed(2)}s`, 'WARN');
                return dd;
            });
            // ── DETECCIÓ TITOLET AL VÍDEO CREMAT (2026-10-06 · 2a passada) ──────
            // Mesura al vídeo QUAN entra i QUANT dura cada rètol (color + OCR) per
            // saber si la targeta conserva la cadència o s'ha de RETALLAR:
            //   · onAir > longOnSec (5 s = durada de la targeta) → cadència actual.
            //   · onAir <= longOnSec → la targeta es retalla a `on` (animSec = on − minTail).
            //   · sense detecció / detecció fallida → fallback: cadència actual.
            // Ancoratge: `_titoletAnchor` (2026-10-06, 2a passada). ⚠️ La timeline NO conté
            // el cleanFeed: conté el CLIP EXTRET del bloc (<WOTT>_<BLOC>_CLIP.mp4) → mana el
            // seu `inPoint` (mesurat: clip.inPoint=20s, clip 0 = cleanFeed 904s, bloc a 924s;
            // amb `ref.offsetSec` = −10 s queia a cleanFeed 10 s → 0 intervals detectats).
            // Amb `titolet.dryRun === true` NO es canvia res: només s'informa al log.
            const TT = cfg.titolet || {};
            let ttCards = null, ttPlan = null;
            // ── TC DEL NOM (2026-10-08, 7a passada) ────────────────────────────────
            // Abans de rastrejar res: el NOM del wott ja porta un camp `tc` (5è tros). En aquesta
            // família sol ser `00.00` (farciment) i per això la col·locació no en depèn, però quan
            // SÍ que porta un TC creïble és l'instant exacte d'emissió i estalvia el rastreig.
            // Vegeu `_titoletTcFromName` (criteris) i `_titoletCardsFromTc`.
            const tcSec = this._titoletTcFromName(list, cfg);
            const nTc = tcSec.filter(x => x !== null).length;
            if (nTc > 0) {
                log(`   ⏱️ [${p.label}] ${TAG} TC del nom: ${nTc}/${list.length} wott(s) amb TC creïble` +
                    (nTc === list.length ? ' → s\'estalvia el rastreig del vídeo' : ' (s\'usaran si la detecció no els veu)'));
            }
            try {
                const TD = FASTPASS_UI.Logic.TitoletDetect;
                if (!TD) {
                    log(`   ⚠️ [${p.label}] ${TAG} detecció: mòdul Logic.TitoletDetect no carregat → fallback`, 'WARN');
                } else if (TT.enabled === false) {
                    log(`   ⚠️ [${p.label}] ${TAG} detecció: desactivada (titolet.enabled = false) → fallback`, 'WARN');
                } else {
                    // ⏱️ Si TOTS els wotts porten un TC creïble al nom, no cal tocar el vídeo:
                    // les targetes surten del TC (mateixa forma que les detectades).
                    if (nTc === list.length) {
                        const bt = this._titoletCardsFromTc(list, tcSec);
                        ttCards = bt.cards;
                        ttPlan = { ok: true, cards: bt.cards, stats: bt.stats, cached: false, tc: true };
                        log(`   ⏱️ [${p.label}] ${TAG} detecció: NO es rastreja el vídeo (els ${nTc} wott(s) porten TC creïble al nom)`);
                    } else {
                    // ⚠️ (2026-10-06, FIX) El manifest NO es pot llegir amb `p.ctx`: això és el
                    // ctx de COL·LOCACIÓ ({busy, placed}) i `SessionManifest.getPath` fa
                    // `ctx.progData.wott` → TypeError. Es fa servir el ctx de SESSIÓ.
                    const wctx = p.wfCtx || this._wfCtx();
                    const anc = await this._titoletAnchor(p, wctx);
                    if (!anc.ok) {
                        log(`   ⚠️ [${p.label}] ${TAG} detecció: ${anc.why} → fallback`, 'WARN');
                    } else {
                        const pad = (TT.scanPadSec != null) ? TT.scanPadSec : 3;
                        // `anc.off`: fileSec = tlSec + off (temps DINS del fitxer a escanejar)
                        const tItemStart = p.mk.time + anc.off;
                        const itemSpan = (itemEnd !== null) ? (itemEnd - p.mk.time) : null;
                        const win = ((itemSpan !== null) ? itemSpan : (TT.scanMaxSec || 300)) + 2 * pad;
                        log(`   🧭 [${p.label}] ${TAG} ancoratge: ${anc.how} → ítem del vídeo @ ${tItemStart.toFixed(2)}s` +
                            (itemSpan !== null ? ` (finestra ${Math.min(TT.scanMaxSec || 300, win).toFixed(0)}s)` : " (sense final d'ítem)"));
                        ttPlan = await TD.planForItem({
                            mp4: anc.mp4, names: list.map(c => c.name), tItemStart: tItemStart,
                            // (2026-10-08, 7a passada) Etiqueta de rol de CADA wott (la del 4t camp
                            // del nom: `…_18_00.00_TEXT_630060_PREGUNTA_in_…`). El detector en té la
                            // RECEPTA de ROI (`titolet.roiPerRole`): amb etiquetes de naturalesa
                            // diferent (TITOLET a la banda baixa, PREGUNTA a mitja imatge) fa una
                            // passada de rastreig PER GRUP en comptes de buscar-ho tot a la ROI del
                            // TITOLET (que era el motiu de tenir 0 intervals amb 6 PREGUNTA).
                            roles: list.map(c => this._burnedGrafRole(c) || ''),
                            tScanStart: Math.max(0, tItemStart - pad),
                            tScanDur: Math.min(TT.scanMaxSec || 300, win),
                            cfg: TT, label: p.label
                        });
                        if (ttPlan && ttPlan.ok) ttCards = ttPlan.cards;
                        else log(`   ⚠️ [${p.label}] ${TAG} detecció fallida (${ttPlan ? ttPlan.error : '?'}) → fallback`, 'WARN');
                    }
                    }
                }
            } catch (eTT) {
                log(`   ⚠️ [${p.label}] ${TAG} detecció amb error (${eTT.message}) → fallback`, 'WARN');
            }
            // ── TC DEL NOM als BUITS de la detecció (2026-10-08, 7a passada) ──────────
            // Si la detecció NO ha vist un wott (`found=false`) però el seu nom porta un TC
            // creïble, la targeta es col·loca al TC. MAI se sobreescriu una detecció feta amb
            // OCR confirmat: el vídeo mana. Amb el rastreig apagat/fallit, el pla sencer surt
            // del TC (les targetes sense TC continuen anant encadenades, com sempre).
            if (nTc > 0) {
                const tcCards = this._titoletCardsFromTc(list, tcSec).cards;
                if (!ttCards) {
                    ttCards = tcCards;
                    log(`   ⏱️ [${p.label}] ${TAG} sense detecció: ${nTc}/${list.length} targeta(es) col·locada(es) pel TC del nom`);
                } else {
                    let nFill = 0;
                    for (let i = 0; i < list.length; i++) {
                        if (!tcCards[i].found) continue;
                        if (ttCards[i] && ttCards[i].found) continue;
                        ttCards[i] = tcCards[i]; nFill++;
                    }
                    if (nFill > 0) {
                        log(`   ⏱️ [${p.label}] ${TAG} TC del nom: ${nFill} targeta(es) que la detecció NO va veure → col·locades pel TC del nom`);
                    }
                }
                if (!ttPlan) {
                    const nf = ttCards.filter(c => c && c.found).length;
                    ttPlan = { ok: true, stats: { nMatched: nf, nWotts: list.length, nShort: 0, nLong: 0, nNone: list.length - nf }, tc: true };
                }
            }
            // Durada objectiu de cada targeta: la detectada (curta) o bé mèdia + congelat.
            // Activat (2026-10-06, 2a passada): la detecció ja s'executa de veritat. Es pot
            // forçar EN CALENT des de la consola del panell, sense tocar codi:
            //   FASTPASS_UI.State.titoletDryRun = true   → no aplicar (només informe al log)
            //   FASTPASS_UI.State.titoletDryRun = false  → aplicar (retallar les targetes curtes)
            const ttDry = (typeof FASTPASS_UI.State.titoletDryRun === 'boolean')
                ? FASTPASS_UI.State.titoletDryRun : (TT.dryRun === true);
            const ttApply = !ttDry;
            const ttOnOf = (i) => (ttApply && ttCards && ttCards[i] && ttCards[i].kind === 'short' && ttCards[i].on > 0) ? ttCards[i].on : null;
            const cardTotal = (fd, i) => { const on = ttOnOf(i); return (on !== null) ? on : (durs[i] + fd); };
            const totalFor = (fd, n) => {
                let t = 0;
                for (let i = 0; i < n; i++) t += cardTotal(fd, i) + GAP;
                return Math.max(0, t - GAP);
            };
            const countFit = (fd) => {
                if (avail === null) return list.length;
                let t = 0, k = 0;
                for (let i = 0; i < list.length; i++) {
                    if ((t + cardTotal(fd, i)) > avail + 1e-6) break;
                    t += cardTotal(fd, i) + GAP; k++;
                }
                return k;
            };
            // ── CONGELAT: 3 s si la cadena hi cap, 1 s si no ────────────────────────
            // Requisit d'usuari (2026-10-05): els TITOLET van SEMPRE en cadena i TOTS.
            // L'ítem NOMÉS decideix el congelat preferit (3 s → 1 s); MAI si la targeta es
            // col·loca. Abans, exigint que cada targeta (mèdia + congelat + marge) cabés
            // SENCERA dins de l'ítem, a l'ítem de prova (1,7 s per a 12 targetes) no se'n
            // col·locava CAP i el resultat era «no s'ha posicionat res al timeline».
            const freezeDur = (countFit(FREEZE) === list.length) ? FREEZE : FREEZE_MIN;
            const nPlace = list.length;
            if (freezeDur === FREEZE_MIN) {
                log(`   🧩 [${p.label}] Cadena ${TAG}: ${list.length} targetes amb congelat de ${FREEZE}s no caben a l'ítem (${avail !== null ? avail.toFixed(1) + 's' : 'sense límit'} disponibles) → congelat de ${FREEZE_MIN}s${(avail !== null && avail < totalFor(freezeDur, nPlace)) ? ' · la cadena sobresurt de l\'ítem' : ''}`);
            }
            const total = totalFor(freezeDur, nPlace);
            // ── Informe de la detecció (dry-run): cadència actual vs pla detectat ──
            if (ttCards) {
                let planTotal = 0;
                for (let i = 0; i < list.length; i++) {
                    const c = ttCards[i];
                    const on = (c && c.kind === 'short' && c.on > 0) ? c.on : null;
                    planTotal += ((on !== null) ? on : (durs[i] + freezeDur)) + GAP;
                }
                planTotal = Math.max(0, planTotal - GAP);
                const st = (ttPlan && ttPlan.stats) || {};
                log(`   🎯 [${p.label}] ${TAG} detecció${ttApply ? '' : ' (DRY-RUN: NO s\'aplica)'}: ${st.nMatched}/${st.nWotts} detectats · cadència actual ${total.toFixed(2)}s vs pla ${planTotal.toFixed(2)}s (Δ ${(planTotal - total).toFixed(2)}s) · ${st.nShort} curtes · ${st.nLong} llargues · ${st.nNone} sense detecció`);
                for (let i = 0; i < ttCards.length; i++) {
                    const c = ttCards[i];
                    if (!c || !c.found) { log(`      · ${i + 1}. «${String((c && c.wott) || list[i].name).substring(0, 38)}» SENSE detecció → fallback`); continue; }
                    // (2026-10-08) Les targetes del TC del nom no tenen `relOut` ni `on`
                    // (el vídeo no s'ha mirat): es mostren com a `?` en comptes d'error.
                    const fIn = isFinite(c.relIn) ? c.relIn.toFixed(2) : '?';
                    const fOut = (c.relOut != null && isFinite(c.relOut)) ? c.relOut.toFixed(2) : '?';
                    const fOn = (c.on != null && isFinite(c.on)) ? c.on.toFixed(2) : '?';
                    log(`      · ${i + 1}. «${String(c.wott).substring(0, 38)}» mp4 ${fIn}s→${fOut}s (${fOn}s, cov ${c.maxCov}%, ${c.kind.toUpperCase()}, score ${c.score}, via ${c.how})` +
                        (c.txt ? ` · text «${c.txt}»` : (c.how === 'tc-nom' ? ' · TC del nom (no s\'ha mirat el vídeo)' : ' · text NO llegit')));
                }
            }

            // ── PLA DE COL·LOCACIÓ (2026-10-06, 3a passada · viu/congelat: 5a passada) ──
            // 🔴 Canvi de fons (petició d'usuari): «els TITOLET van al seu lloc real, per això
            // fem la detecció». El rastreig diu QUAN va entrar cada rètol (`relIn`, en segons
            // dins de l'ítem del VÍDEO) → cada targeta va al SEU instant de la timeline
            // (mk.time + relIn) i l'ordre surt sol: cronològic.
            // (Abans: `list.sort(by _wottIdNum)` + cadena encadenada des del marcador. Al cas
            // real de l'ítem 16 del 05/10 això va deixar 9 de 12 targetes en un instant que no
            // era el seu i en l'ordre de GENERACIÓ del grafisme, no en el de l'aire.)
            // Els wotts SENSE detecció s'encadenen darrere de l'últim detectat (fallback).
            // Llargada de cada targeta (5a passada): viu = clip sencer (homogeni per a totes)
            // + congelat fins al final detectat (0 si el rètol cremat va durar menys que el
            // clip) i, si cal, retall de seguretat per no envair la targeta següent.
            const snapTol = (TT.snapTolSec != null) ? TT.snapTolSec : 1.0;
            const freezeMax = (TT.freezeMaxSec != null) ? TT.freezeMaxSec : 15;
            // (2026-10-06, 6a passada · petició d'usuari) `TRIM` = 5 frames (0,20 s): la
            // targeta TITOLET sortia 5 frames MÉS LARGA que el rètol cremat a l'aire. Es
            // retallen del FINAL —de la durada total I de la part viva— de manera que el
            // congelat entra AQUESTS 5 frames ABANS i l'enllaç vídeo viu → congelat queda
            // SENSE buit (la llargada del congelat no canvia). Vegeu `titolet.cardTrimFrames`.
            const TRIM = REV_FRAME * ((TT.cardTrimFrames != null) ? Number(TT.cardTrimFrames) : 5);
            const orderIdx = [];
            for (let i = 0; i < list.length; i++) {
                const c = ttCards ? ttCards[i] : null;
                orderIdx.push({
                    i: i, det: !!(ttApply && c && c.found && isFinite(c.relIn)),
                    rel: (c && c.found && isFinite(c.relIn)) ? c.relIn : null,
                    id: PL._wottIdNum(list[i].name)
                });
            }
            orderIdx.sort((a, b) => {
                if (a.det && b.det) return a.rel - b.rel;       // ordre de l'aire
                if (a.det !== b.det) return a.det ? -1 : 1;     // els detectats primer
                return a.id - b.id;                             // resta: wottId
            });
            const planned = [];
            let maxEndTl = start;
            for (const o of orderIdx) {
                const i = o.i, chy = list[i], cardDur = durs[i];
                const c = ttCards ? ttCards[i] : null;
                const shortName = String(chy.name).substring(0, 38);
                if (o.det) {
                    const ideal = p.mk.time + c.relIn;
                    let tStart = ideal, how = 'lloc real';
                    if (snapTol > 0 && clipsV1.length > 0) {
                        // 'imant' al tall: si l'instant detectat cau a ≤ snapTol de l'inici del
                        // clip de V1 que el conté, la targeta entra EXACTAMENT allà.
                        // 🔴 (2026-10-06, 5a passada · petició d'usuari «la col·locació no es fa
                        // amb imant i hi ha uns frames de retraso») ABANS s'hi sumava `OFF`
                        // (0,40 s = 10 frames): mesurat al log real de l'ítem 16, totes les
                        // targetes «imantades» entraven a `tall + 0,40 s` (31,00 en comptes de
                        // 30,60; 143,00 en comptes de 142,60…) → l'imant no es veia i anaven
                        // 10 frames tard.
                        const ciS = this._clipAtInstant(clipsV1, ideal);
                        if (ciS && (ideal - ciS.start) <= snapTol) {
                            tStart = Math.max(p.mk.time, ciS.start);
                            how = 'imant al tall ' + ciS.start.toFixed(2) + 's (Δ ' + (ideal - ciS.start).toFixed(2) + 's)';
                        }
                    }
                    // Quant va viure el rètol cremat (final detectat, en coords de timeline).
                    const detEnd = (c.relOut != null && isFinite(c.relOut) && c.relOut > c.relIn) ? (p.mk.time + c.relOut) : null;
                    // ── VIU + CONGELAT (2026-10-06, 5a passada · petició d'usuari) ────────
                    // «seria millor que la part de vídeo viva fos homogènia i afegir el
                    // congelat fins on es detecta el final». Per això:
                    //   · VIU = el clip SENCER de la targeta (mateixa plantilla → homogeni).
                    //   · CONGELAT = només si el rètol cremat va viure MÉS enllà del clip, i
                    //     dura EXACTAMENT fins al final detectat (`relOut`).
                    // Abans: span = on detectat i anim = on − 0,5 s → cada targeta amb una
                    // part viva diferent (mesurat: 0,5 s … 5,2 s), un congelat de 0,5 s forçat
                    // a totes i, a les «llargues», un congelat de 3 s que sobrepassava el
                    // final detectat (75,40→78,40 s quan el rètol cremat s'acabava a 76,50 s).
                    const liveWant = Math.max(0.5, cardDur - TRIM);
                    let want = (detEnd !== null) ? Math.max(liveWant, detEnd - tStart - TRIM) : (liveWant + freezeDur);
                    want = Math.min(want, liveWant + freezeMax);
                    planned.push({
                        chy: chy, name: shortName, start: tStart, want: want, liveWant: liveWant,
                        det: true, detEnd: detEnd, relIn: c.relIn, how: how
                    });
                    log(`   🧲 [${p.label}] ${TAG} ${i + 1}/${list.length} «${shortName}» relIn ${c.relIn}s ` +
                        `(cov ${c.maxCov}%) → ${tStart.toFixed(2)}s [${how}] viu ${liveWant.toFixed(2)}s ` +
                        `(= clip ${cardDur.toFixed(2)}s − ${(TRIM / REV_FRAME).toFixed(0)} frames)` +
                        ((detEnd !== null && want > liveWant + 0.05) ? ` + congelat ${(want - liveWant).toFixed(2)}s (final detectat ${detEnd.toFixed(2)}s − ${(TRIM / REV_FRAME).toFixed(0)} frames)` : ''));
                    if (tStart + want > maxEndTl) maxEndTl = tStart + want;
                } else {
                    const tStart = maxEndTl + GAP;
                    const liveW = Math.max(0.5, cardDur - TRIM);
                    const want = liveW + freezeDur;
                    planned.push({
                        chy: chy, name: shortName, start: tStart, want: want, liveWant: liveW,
                        det: false, detEnd: null, relIn: null, how: 'encadenat'
                    });
                    log(`   ⛓️ [${p.label}] ${TAG} ${i + 1}/${list.length} «${shortName}» SENSE detecció → ` +
                        `encadenat a ${tStart.toFixed(2)}s (viu ${liveW.toFixed(2)}s = clip ${cardDur.toFixed(2)}s − ${(TRIM / REV_FRAME).toFixed(0)} frames + congelat ${freezeDur.toFixed(2)}s)`);
                    maxEndTl = tStart + want;
                }
            }
            // ── Retall de SEGURETAT (2026-10-06, 5a passada): cap targeta pot envair la
            //    SEGÜENT ni el final de l'ítem. Amb la part viva = clip sencer, dues targetes
            //    properes (cas real: relIn 108,5 s i 111 s, 2,5 s de separació) s'encavalarien;
            //    aquí es retalla la part viva i NO s'hi afegeix congelat.
            for (let k = 0; k < planned.length; k++) {
                const pl = planned[k];
                const nextStart = (k + 1 < planned.length) ? planned[k + 1].start : null;
                let budget = Infinity;
                if (nextStart !== null) budget = Math.min(budget, nextStart - pl.start - GAP);
                if (itemEnd !== null) budget = Math.min(budget, itemEnd - pl.start);
                if (!isFinite(budget) || budget >= pl.want) {
                    pl.span = pl.want; pl.live = pl.liveWant;
                } else {
                    pl.span = Math.max(0.5, budget);
                    pl.live = Math.max(0.1, Math.min(pl.liveWant, pl.span));
                    log(`   ✂️ [${p.label}] ${TAG} «${pl.name}» retallada a ${pl.span.toFixed(2)}s ` +
                        `(viu ${pl.live.toFixed(2)}s, sense congelat): ${pl.want.toFixed(2)}s no hi caben` +
                        (nextStart !== null ? ` (següent targeta a ${nextStart.toFixed(2)}s)` : '') +
                        (itemEnd !== null ? ` (final d'ítem ${itemEnd.toFixed(2)}s)` : ''), 'WARN');
                }
                pl.freeze = Math.max(0, pl.span - pl.live);
            }
            // Zona temporal LLIURE per als congelats: `_emptyProgramTC` mira els clips que hi
            // ha ARA, però les targetes s'aniran col·locant → la zona ha de quedar DESPRÉS del
            // final de l'última. Si no, el clip temporal (overwrite) cauria damunt d'una
            // targeta ja col·locada i l'esborraria.
            // (El TITOLET és un grafisme amb TRANSPARÈNCIA: el congelat s'ha de capturar amb el
            // PROGRAMA BUID perquè el PNG conservi l'alpha i no s'endugui cap frame de vídeo.)
            const programFree = await this._emptyProgramTC(Math.max.apply(null, durs) + 2);
            const tailCeil = Math.ceil((maxEndTl + 5) / REV_FRAME) * REV_FRAME;
            const tempTC = Math.max(programFree, tailCeil);
            if (tempTC > programFree) {
                log(`   🧭 [${p.label}] Zona temporal dels congelats a ${tempTC.toFixed(2)}s (més enllà del final de la cadena ${maxEndTl.toFixed(2)}s)`);
            }
            // ── Col·locació: cada targeta al SEU instant. `_chooseSlot` decideix la pista (V8
            //    Lloc/Data preferent, V7 rètols alternativa) i només mou la targeta si la pista
            //    està ocupada en aquell rang; MAI abans de l'instant calculat. El rang de cada
            //    targeta es reserva a `p.ctx` just després de col·locar-la, de manera que la
            //    resta de rètols de l'ítem el veuen i no hi van a parar.
            let placed = 0, nOverlap = 0;
            for (const pl of planned) {
                const slot = await this._chooseSlot([V_LLOC, V_CHYRONS], pl.start, pl.span, p.ctx, itemEnd);
                if (!slot || slot.track === null) {
                    log(`   ⚠️ [${p.label}] ${TAG} «${pl.name}» NO col·locat (sense pista lliure)`, 'WARN');
                    continue;
                }
                if (slot.overlap) nOverlap++;

                let span = pl.span, live = pl.live;
                if (slot.shrunk && slot.maxDur != null) {
                    span = Math.max(0.5, Math.min(span, slot.maxDur));
                    live = Math.max(0.1, Math.min(live, span));
                }
                const freeze = Math.max(0, span - live);
                const movedMsg = slot.moved ? ` ⟵ desplaçat (pista ocupada; ideal ${pl.start.toFixed(2)}s)` : '';
                const fr = await this._freezeTemaTitol(pl.chy.name, slot.start, slot.start + span, p.label,
                    { track: slot.track, animSec: live, tempTC: tempTC, freezeSec: freeze, frameMid: true });
                if (fr && fr.success) {
                    placed++;
                    this._addPlaced(p.ctx, slot.track, slot.start, slot.start + span);
                    log(`   🧊 [${p.label}] ${TAG} «${pl.name}»${pl.det ? '' : ' [encadenat]'} → V${slot.track} @ ` +
                        `${slot.start.toFixed(2)}s (span ${span.toFixed(2)}s: viu ${live.toFixed(2)}s + congelat ` +
                        `${freeze.toFixed(2)}s)${movedMsg}`);
                } else {
                    log(`   ⚠️ [${p.label}] ${TAG} «${pl.name}» NO col·locat (congelat fallit)`, 'WARN');
                }
                await utils.delay(150);
            }
            if (nOverlap > 0) {
                log(`   ⚠️ [${p.label}] ${nOverlap} ${TAG} col·locat(s) DAMUNT de material existent: revisa el solapament`, 'WARN');
            }
            return placed;
        },

        /**
         * _isConexioWott: El rètol pertany a una CONNEXIÓ (directe/enviada/presencial)?
         * Aquests wotts porten el lineID del Donapas però s'han d'ancorar al punt
         * de connexió (marcador 01dir - CONNEXIÓ DIRECTE), no a l'inici del bloc.
         * @param {Object} chy - {name, rol}
         * @returns {boolean}
         */
        _isConexioWott: function (chy) {
            const n = String((chy && chy.name) || '').toUpperCase();
            const r = String((chy && chy.rol) || '').toUpperCase();
            const hay = (s) => (n.indexOf(s) !== -1 || r.indexOf(s) !== -1);
            return hay('DIRECTE') || hay('ENVIAT') || hay('PRESENCIAL') ||
                hay('CONNEXIO') || hay('CONEXIO');
        },

        /**
         * _isEnviatWott: El rètol és un ENVIAT (reporter connectat amb la seu)?
         * NOMÉS aquest tipus es reubica al seu ÍTEM DE CONNEXIÓ. Els altres tipus que també
         * porten "connexió" al nom o al rol ("Directe PRESENCIAL Berlín", Programes...) es
         * queden al seu ítem, com sempre (petició d'usuari 2026-09-21).
         * @param {Object} chy - {name, rol}
         * @returns {boolean}
         */
        _isEnviatWott: function (chy) {
            const n = String((chy && chy.name) || '').toUpperCase();
            const r = String((chy && chy.rol) || '').toUpperCase();
            return n.indexOf('ENVIAT') !== -1 || r.indexOf('ENVIAT') !== -1;
        },

        /**
         * _isConexioMarker: El marcador és el punt de connexió del directe?
         * Criteris: el comentari conté CONNEXIÓ/CONNEXIO/CONEXIO o el seu id
         * acaba en "dir" (ex: "01dir - CONNEXIÓ DIRECTE ILLA").
         * @param {Object} m - {comments, name, time}
         * @returns {boolean}
         */
        _isConexioMarker: function (m) {
            const lbl = String((m && (m.comments || m.name)) || '').toUpperCase();
            if (lbl.indexOf('CONNEXIÓ') !== -1 || lbl.indexOf('CONNEXIO') !== -1 || lbl.indexOf('CONEXIO') !== -1) return true;
            const id = (lbl.split('-')[0] || '').trim();
            return /DIR$/.test(id);
        },

        /**
         * _connexioMarkerTime: Instant del marcador de connexió més proper DESPRÉS
         * de fromTime (o l'últim si no n'hi ha cap després).
         * @param {Array} allMarkers
         * @param {number} fromTime
         * @returns {number|null}
         */
        _connexioMarkerTime: function (allMarkers, fromTime) {
            const cands = (allMarkers || []).filter(m => this._isConexioMarker(m))
                .slice().sort((a, b) => a.time - b.time);
            if (cands.length === 0) return null;
            const after = cands.filter(m => m.time >= fromTime - 0.001);
            if (after.length > 0) return after[0].time;
            return cands[cands.length - 1].time;
        },

        /**
         * _baseTimeForChyron: Temps base d'un rètol (abans de sumar-hi el tc).
         * Per defecte el marcador del seu ítem; si el rètol és de connexió
         * (Directe/Enviat/Presencial) s'ancora al punt de connexió.
         * @param {Object} chy
         * @param {Object} mk - {fullId, time}
         * @param {Array} allMarkers
         * @returns {number}
         */
        _baseTimeForChyron: function (chy, mk, allMarkers) {
            const fallback = (mk && isFinite(mk.time)) ? mk.time : 0;
            if (!this._isConexioWott(chy)) return fallback;
            const tConex = this._connexioMarkerTime(allMarkers, fallback);
            if (tConex === null) return fallback;
            if (Math.abs(tConex - fallback) > 0.01) {
                log(`   🔌 [Conexió] "${String(chy.name).substring(0, 55)}..." → punt de connexió @ ${tConex.toFixed(2)}s (no a ${fallback.toFixed(2)}s)`);
            }
            return tConex;
        },

        /**
         * _titoletTcFromName: TC d'EMISSIÓ que porta el NOM del wott, en segons.
         *
         * El nom té el format `Wott_<PROG>_<BLOQ>_<wottId>_<tc>_<TEXT>_<linia>_<ROL>_…_<fitxer>`:
         * el camp `tc` (5è tros, `parts[4]`) és el mateix que llegeix `13_Parse.meta` i el que
         * fa servir la resta de rètols (`chy.tc` → `timeToSeconds`). Aquesta família de
         * grafismes cremats el porta habitualment a `00.00` (MESURAT al nom real del 08/10:
         * `Wott_TNM_V3_18_00.00_COM QUEDA EL DECRET D'HABITATG_630060_PREGUNTA_in_…`), i per
         * això la col·locació NO en depèn: això només és un ATALL per quan SÍ que hi és.
         *
         * Criteris de CREDIBILITAT (conservadors — davant del dubte, es detecta com sempre):
         *   · el wott ha de portar `tc` i el TC ha de valer ≥ `titolet.tcMinSec` (0,5 s);
         *     `00.00` (el farciment d'aquesta família) queda descartat de seguida.
         *   · si TOTS els wotts de l'ítem porten el MATEIX TC (>1), no és un TC sinó un camp
         *     de farciment → s'ignoren TOTS (evita posar 6 targetes al mateix segon).
         * Es pot desactivar amb `titolet.tcFromName = false`.
         *
         * @param {Array<Object>} list - chróns amb `tc` ({name, tc, rol})
         * @param {Object} cfg - config completa (s'hi llegeix `titolet`)
         * @returns {Array<number|null>} segons per wott (null = sense TC creïble)
         */
        _titoletTcFromName: function (list, cfg) {
            const TT = ((cfg || FASTPASS_UI.Config.get()).titolet) || {};
            const n = (list || []).length;
            const out = [];
            for (let i = 0; i < n; i++) out.push(null);
            if (n === 0 || TT.tcFromName === false) return out;
            const min = (TT.tcMinSec != null) ? TT.tcMinSec : 0.5;
            const utils = getUtils();
            for (let i = 0; i < n; i++) {
                const tc = String(((list[i] || {}).tc) || '').trim();
                if (!tc) continue;
                const sec = utils.timeToSeconds(tc);
                if (!isFinite(sec) || sec + 1e-6 < min) continue;
                out[i] = Math.round(sec * 1000) / 1000;
            }
            const vals = out.filter(s => s !== null);
            if (vals.length === 0) return out;
            let same = true;
            for (const v of vals) { if (Math.abs(v - vals[0]) > 0.05) { same = false; break; } }
            if (same && vals.length > 1) {
                log(`   ⏱️ [titolet] TC del nom ${vals[0].toFixed(2)}s IDÈNTIC als ${vals.length} wott(s) → camp de farciment: s'ignora`);
                return out.map(() => null);
            }
            return out;
        },

        /**
         * _titoletCardsFromTc: Targetes de col·locació a partir del TC del nom (sense rastrejar
         * el vídeo). Mateixa forma que les de `Logic.TitoletDetect.composePlan` perquè tota la
         * cadena (`_placeTitoletChain`) les pugui consumir igual:
         *   · `relIn` = el TC (segons dins de l'ítem) · `relOut` = null (no se sap quan va
         *     acabar: el congelat el decideix la cadència, com als wotts sense detecció).
         *   · `on` = null i `kind` = 'long' → NO es retalla cap targeta per durada.
         *   · `how` = 'tc-nom' → es veu al log D'ON surt cada targeta.
         * @param {Array<Object>} list - chróns
         * @param {Array<number|null>} tcSec
         * @returns {Object} { cards, stats } (forma de `composePlan`)
         */
        _titoletCardsFromTc: function (list, tcSec) {
            const cards = [];
            let nFound = 0;
            for (let i = 0; i < list.length; i++) {
                const sec = tcSec[i];
                const found = (sec !== null && sec !== undefined);
                if (found) nFound++;
                cards.push({
                    wott: list[i].name, found: found,
                    on: null, relIn: found ? sec : null, relOut: null,
                    kind: 'long', score: 0, token: '', maxCov: 0, ocrAt: null,
                    how: found ? 'tc-nom' : 'none', txt: ''
                });
            }
            return {
                cards: cards,
                stats: {
                    nMatched: nFound, nWotts: list.length,
                    nShort: 0, nLong: 0, nNone: list.length - nFound
                }
            };
        },

        /**
         * _isTitolet: És un rètol TITOLET (grafisme de l'INSERT)?
         * OJO: el filtre antic de la fase Resto feia servir name.includes("TITOL")
         * i els TITOLET hi quedaven exclosos (no anaven ni a Titol ni a Resto).
         * @param {Object} chy
         * @returns {boolean}
         */
        _isTitolet: function (chy) {
            const n = String((chy && chy.name) || '').toUpperCase();
            const r = String((chy && chy.rol) || '').toUpperCase();
            return n.indexOf('TITOLET') !== -1 || r.indexOf('TITOLET') !== -1;
        },

        /**
         * _burnedGrafNorm: Normalitza un token de rol per poder-lo comparar: majúscules,
         * sense accents i sense separadors (`_ - .` ni espais). Així `CIS_CEO_COMPARADA`,
         * `CIS-CEO` i `CIS CEO` són el MATEIX: el sistema de ròtols no escriu sempre igual
         * el separador (`Tema-Titol`, `Nomcarrec`, `Enviat_Sí`…) i això no ha de decidir si
         * el grafisme es rastreja o no.
         * @param {string} s
         * @returns {string}
         */
        _burnedGrafNorm: function (s) {
            return String(s || '').toUpperCase()
                .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
                .replace(/[^A-Z0-9]/g, '');
        },

        /**
         * _burnedGrafTokens: On es busca el rol, JA normalitzat: el camp `chy.rol` i el
         * tros de ROL del nom (`name.split('_')`, índex 7 — el que llegeix `13_Parse.meta`).
         *
         * Com que hi ha etiquetes amb `_` A DINS (`CIS_CEO_COMPARADA`, `Enviat_Sí`,
         * `Directe_PRESENCIAL`), el nom les parteix en trossos: s'hi afegeixen les unions
         * dels 2 trossos següents per reconstruir-les (`CIS`+`CEO`+`COMPARADA`).
         * L'índex 5 és el TEXT del rètol i NO s'hi busca mai: un títol «LES DADES DEL PARO»
         * o «LA PREGUNTA DE…» dispararia les famílies DADA/PREGUNTA sense cap grafisme cremat.
         * @param {Object} chy - {name, rol}
         * @returns {Array<string>} tokens normalitzats (rol + unions del tros de rol)
         */
        _burnedGrafTokens: function (chy) {
            const out = [];
            const push = (s) => {
                const n = this._burnedGrafNorm(s);
                if (n && out.indexOf(n) === -1) out.push(n);
            };
            push(String((chy && chy.rol) || ''));
            const parts = String((chy && chy.name) || '').split('_');
            let acc = '';
            for (let i = 7; i < parts.length && i < 10; i++) {
                acc += parts[i];
                push(acc);
            }
            return out;
        },

        /**
         * _burnedGrafRoles: Etiquetes de rol que disparen la DETECCIÓ del grafisme cremat
         * (les 27 etiquetes literals del sistema de ròtols, 2026-10-08).
         * Surten de `Config.get().titolet.detectRoles`; si la clau no hi és, només TITOLET
         * (comportament antic, 2026-10-05/06). Es tornen TAL COM surten de Config.
         * @returns {Array<string>}
         */
        _burnedGrafRoles: function () {
            const TT = (FASTPASS_UI.Config.get() || {}).titolet || {};
            const r = (TT.detectRoles && TT.detectRoles.length) ? TT.detectRoles : ['TITOLET'];
            return r.map(s => String(s).trim()).filter(s => s.length > 0);
        },

        /**
         * _burnedGrafRole: Quina ETIQUETA de `detectRoles` és aquest wott? (`null` si cap).
         * El matx és d'IGUALTAT sobre el token normalitzat — mai prefix ni substring: `DADA`
         * a seques NO val, ha de ser l'etiqueta sencera (`DADA-GRAN`). Si n'hi encaixa més
         * d'una (p.ex. `LLISTA` i `LLISTA-DADES` quan el nom parteix l'etiqueta), mana la MÉS
         * LLARGA (la més específica). Es torna l'etiqueta tal com surt de Config, que és la
         * que fan servir els logs (`p.tag`) i el `_dedupeTitolet`.
         * @param {Object} chy - {name, rol}
         * @returns {string|null}
         */
        _burnedGrafRole: function (chy) {
            const toks = this._burnedGrafTokens(chy);
            if (toks.length === 0) return null;
            const roles = this._burnedGrafRoles();
            let best = null;
            let bestLen = 0;
            for (const t of toks) {
                for (const r of roles) {
                    const n = this._burnedGrafNorm(r);
                    if (n === t && n.length > bestLen) { best = r; bestLen = n.length; }
                }
            }
            return best;
        },

        /**
         * _isBurnedGrafWott: El wott és un GRAFISME CREMAT al vídeo?
         *
         * CONDICIÓ DE DISPARO del rastreig (color + OCR) i de la col·locació al SEU instant
         * real: l'ítem porta wotts amb alguna de les 27 ETIQUETES literals de
         * `titolet.detectRoles`. El rastreig NO es fa mai «per si de cas»: només quan n'hi ha.
         *   27 tipus de grafisme (TITOLET · TITOLET GRAN · PREGUNTA · CARTELL · CIS_CEO ·
         *   CIS_CEO_COMPARADA · CRONOLOGIA · CRONOLOGIA-TITOLS · DADA_COMPARADA ·
         *   DADA-DIFERENCIAL · DADA-GRAN · DADA-GRAN-DIVISA · DADA-ITEM · DESTACAT ·
         *   CLASSI-CHAMPIONS · CLASSIFICACIO · CLASSI-MUNDIAL · CLASSI-PRIMERA ·
         *   CLASSI-SEGONA · GRAFICA-BARRES · GRAFICA_CIRCULAR · IMATGE-CAPTURA · LLISTA ·
         *   LLISTA-DADES · NOTA · PROGRAMACIO · RANQUING) → les 27 etiquetes a Config
         *   (matx d'IGUALTAT: `DADA` a seques no val, cal `DADA-GRAN`).
         * @param {Object} chy - {name, rol}
         * @returns {boolean}
         */
        _isBurnedGrafWott: function (chy) {
            return this._burnedGrafRole(chy) !== null;
        },

        /**
         * _burnedGrafTag: Etiqueta per als logs de la cadena: etiquetes LITERALS detectades
         * (p.ex. `DADA-GRAN` o `DADA-GRAN+PREGUNTA`).
         * @param {Array} list
         * @returns {string}
         */
        _burnedGrafTag: function (list) {
            const tags = [];
            for (const c of (list || [])) {
                const t = this._burnedGrafRole(c);
                if (t && tags.indexOf(t) === -1) tags.push(t);
            }
            return tags.length ? tags.join('+') : 'GRAFISME CREMAT';
        },

        /**
         * _titoletKey: Clau d'agrupació d'un TITOLET: el text del rètol, sense el
         * sufix de posició/versió (BAIX/MIG/ALT/B...), l'extensió ni el sufix de
         * fitxer numèric del sistema de ròtols.
         * @param {string} name
         * @returns {string}
         */
        _titoletKey: function (name) {
            const parts = String(name || '').split('_');
            let key = (parts.length > 8) ? parts.slice(8).join('_') : (parts[parts.length - 1] || name);
            key = key.replace(/\.(mov|mp4|png)$/i, '')
                .replace(/\.\d{6,}$/, '')
                .replace(/_(BAIX|MIG|ALT|B|M|A)$/i, '')
                .replace(/[_\s]+/g, ' ')
                .trim().toLowerCase();
            // Els noms del sistema venen truncats a ~40 caràcters, així que el mateix
            // rètol pot arribar com "…món en plena" i "…món en pla": ens quedem amb
            // el prefix per agrupar-los.
            return key.slice(0, 30).replace(/[\s_]+$/, '');
        },

        /**
         * _regenSeq: Número de GENERACIÓ del fitxer (sufix `.NNNNNNN` abans de
         * l'extensió, ex: `...Cas Roger Español.00618565.mov` → 618565).
         *
         * El sistema de rètols REGENERA el mateix rètol (mateixa línia, tc, text,
         * wottId i rol) i deixa TOTES les versions al NAS. El wottId (part 6 del
         * nom) és IDÈNTIC entre versions, així que l'únic ordre fiable és aquest
         * número de generació.
         * @param {string} name
         * @returns {number} 0 si el nom no porta número de generació
         */
        _regenSeq: function (name) {
            const m = String(name || '').match(/\.(\d{6,})\.[^.]+$/);
            return m ? parseInt(m[1], 10) : 0;
        },

        /**
         * _regenKey: Identitat del rètol SENSE la versió de generació (fora el
         * sufix `.NNNNNNN` i l'extensió, en minúscules). Dues còpies amb la mateixa
         * clau són el MATEIX rètol re-generat.
         * @param {string} name
         * @returns {string}
         */
        _regenKey: function (name) {
            return String(name || '').replace(/\.\d{6,}\.[^.]+$/, '').toLowerCase();
        },

        /**
         * _dedupeRegenerations: Deixa NOMÉS l'última generació de cada rètol.
         * (2026-10-02 · #133) Cas real TNM V1 01/10: el mateix rètol era al NAS 3
         * cops (`…00618354` / `…00618394` / `…00618565`, mateix tc). Com que el tc
         * és el mateix, el motor els col·locava TOTS i els duplicats, en trobar la
         * pista ocupada, acabaven en una ALTRA capa (rètol duplicat a la timeline).
         * Mana la versió més NOVA (número de generació més alt).
         * @param {Array} list
         * @param {string} label
         * @returns {Array}
         */
        _dedupeRegenerations: function (list, label) {
            const byKey = {};
            const order = [];
            for (const c of (list || [])) {
                const key = this._regenKey(c.name);
                const seq = this._regenSeq(c.name);
                if (byKey[key] === undefined) {
                    byKey[key] = { c: c, seq: seq };
                    order.push(key);
                    continue;
                }
                if (seq > byKey[key].seq) byKey[key] = { c: c, seq: seq };
            }
            const out = order.map(k => byKey[k].c);
            const dropped = (list || []).length - out.length;
            if (dropped > 0) {
                log(`   ♻️ [${label}] ${dropped} còpia(es) de re-generació descartada(es) (mateix rètol i tc): es queda la versió més nova`);
            }
            return out;
        },

        /**
         * _sameChyronKey: Identitat d'un rètol per a la SEVA posició, ignorant la versió de
         * generació I el wottId. Dues còpies amb la mateixa clau són el MATEIX rètol
         * (mateix programa, bloc, ítem, tc, text i rol) encara que el generador n'hagi
         * canviat l'ID o l'accentuació del text.
         * (2026-10-08) Cas real TNM V3: la mateixa firma era al NAS dos cops amb dos wottId
         * diferents i només canviava la tilde («…630083_Firma_Ivan Gutiérrez» /
         * «…630175_Firma_Iván Gutiérrez»). `_regenKey` no les fusiona (wottId diferent) i el
         * motor les col·locava TOTES DUES: la segona, en trobar la pista ocupada, anava a una
         * ALTRA capa (V7 i V8, mateix tc) → firma duplicada a la timeline.
         * @param {string} name
         * @returns {string}
         */
        _sameChyronKey: function (name) {
            let base = this._regenKey(name);            // fora la versió de generació i l'extensió
            base = base.replace(/_(\d{6,})_/, '_');     // fora el wottId (part 6 del nom)
            return this._burnedGrafNorm(base);          // majúscules, sense accents ni separadors
        },

        /**
         * _dedupeSameChyron: Deixa NOMÉS un rètol per POSICIÓ (ítem + tc + text + rol) encara
         * que el generador l'hagi tornat a emetre amb un altre wottId o amb accents diferents.
         * S'aplica a TOTS els wotts de la passada (totes les fases) just després de
         * `_dedupeRegenerations`, que només veu les re-generacions del MATEIX wottId.
         * Mana la versió més NOVA (número de generació i, si empaten, wottId més alt).
         * @param {Array} list
         * @param {string} label
         * @returns {Array}
         */
        _dedupeSameChyron: function (list, label) {
            const byKey = {};
            const out = [];
            for (const c of (list || [])) {
                // La família de GRAFISME CREMAT (TITOLET, PREGUNTA, DADA…) NO es dedueix aquí: el
                // `tc` del seu nom no és la seva posició real (la CADENA els col·loca al SEU
                // instant detectat i pot necessitar diverses còpies del mateix nom). Els seus
                // duplicats els gestionen `_dedupeTitolet` i `_dedupeRegenerations`.
                if (this._isBurnedGrafWott(c)) { out.push(c); continue; }
                const key = this._sameChyronKey(c.name);
                // Sense clau (nom buit o no parsejable) NO es dedueix: mai fusionem el que no entenem.
                if (!key) { out.push(c); continue; }
                const seq = this._regenSeq(c.name);
                const id = FASTPASS_UI.Logic.Project._wottIdNum(c.name);
                const seen = byKey[key];
                if (seen === undefined) {
                    byKey[key] = { i: out.length, seq: seq, id: id };
                    out.push(c);
                    continue;
                }
                if (seq > seen.seq || (seq === seen.seq && id > seen.id)) {
                    out[seen.i] = c;
                    seen.seq = seq;
                    seen.id = id;
                }
            }
            const dropped = (list || []).length - out.length;
            if (dropped > 0) {
                log(`   🧬 [${label}] ${dropped} rètol(s) duplicat(s) descartat(s) (mateixa posició, tc i text amb un altre wottId o accent): es queda la versió més nova`);
            }
            return out;
        },

        /**
         * _dedupeTitolet: Deixa NOMÉS un grafisme cremat per TIPUS + text (la versió més
         * recent). El sistema genera variants de posició (BAIX/MIG) i versions successives
         * del mateix rètol: n'hi ha prou amb una.
         * (2026-10-02) L'ordre de "més recent" passa a ser el número de GENERACIÓ del
         * nom: el wottId de la part 6 és idèntic entre re-generacions, així que abans
         * es podia quedar la versió VELLA.
         * (2026-10-08) La clau inclou l'ETIQUETA del rol (`_burnedGrafRole`): `_titoletKey` es
         * menja la part del rol (índex 7), així que dos grafismes de TIPUS diferent amb el
         * mateix text (p.ex. DADA-GRAN i LLISTA) s'haurien fusionat i un no es col·locava.
         * Com que l'etiqueta és LITERAL (i no una família), DADA-GRAN i DADA-ITEM amb el
         * mateix text tampoc no es fusionen.
         * @param {Array} list
         * @returns {Array}
         */
        _dedupeTitolet: function (list) {
            const byKey = {};
            for (const c of (list || [])) {
                const key = (this._burnedGrafRole(c) || '') + '|' + this._titoletKey(c.name);
                const id = FASTPASS_UI.Logic.Project._wottIdNum(c.name);
                const seq = this._regenSeq(c.name);
                const cur = byKey[key];
                if (cur === undefined || seq > cur.seq || (seq === cur.seq && id > cur.id)) {
                    byKey[key] = { c: c, id: id, seq: seq };
                }
            }
            return Object.keys(byKey).map(k => byKey[k].c);
        },

        /**
         * _trackBusyRanges: Rangs (start,end) ocupats d'una pista de vídeo, amb la
         * caché de la crida i els rètols ja col·locats en aquesta mateixa passada.
         * @param {number} track
         * @param {Object} ctx - {busy:{}, placed:{}}
         * @returns {Promise<Array>}
         */
        _trackBusyRanges: async function (track, ctx) {
            const c = ctx || {};
            c.busy = c.busy || {};
            c.placed = c.placed || {};
            c.placed[track] = c.placed[track] || [];
            if (c.busy[track]) return c.busy[track].concat(c.placed[track]);
            let ranges = [];
            try {
                const clips = await getClipsLogic().getTrackClips(track, 'video');
                ranges = (clips || []).map(cl => ({ start: cl.start, end: cl.end }))
                    .filter(r => isFinite(r.start) && isFinite(r.end));
            } catch (e) { }
            c.busy[track] = ranges;
            return ranges.concat(c.placed[track]);
        },

        /**
         * _addPlaced: Anota un rètol col·locat (perquè la resta de la passada el
         * tingui en compte) i invalida la caché de la seva pista.
         */
        _addPlaced: function (ctx, track, start, end) {
            if (!ctx) return;
            ctx.placed = ctx.placed || {};
            ctx.placed[track] = ctx.placed[track] || [];
            ctx.placed[track].push({ start: start, end: end });
            if (ctx.busy) delete ctx.busy[track];
        },

        /**
         * _firstFreeStart: Primer instant ≥ start amb 'dur' segons lliures.
         * @param {Array} ranges
         * @param {number} start
         * @param {number} dur
         * @returns {number}
         */
        _firstFreeStart: function (ranges, start, dur) {
            let t = start;
            const sorted = (ranges || []).slice().sort((a, b) => a.start - b.start);
            for (let i = 0; i < sorted.length; i++) {
                const r = sorted[i];
                if (r.end <= t + 0.001) continue;         // ja ha passat
                if (r.start >= t + dur - 0.001) break;    // hi cap abans d'aquest clip
                t = r.end;                                 // xoca: saltem al seu final
            }
            return t;
        },

        /**
         * _chooseSlot: Tria pista i instant per no trepitjar cap rètol.
         * candidates: número o array de números (ordre de preferència, ex: [V6,V7]).
         * Si la primera candidata està lliure s'hi queda; si no, prova les altres
         * pistes (alternar V6/V7 és correcte: són el mateix tipus de wott i no han
         * de coincidir en imatge). NO retrocedeix mai abans de startSec ni se surt
         * de maxEnd: un wott no es pot colar a l'ítem anterior.
         * @param {number} [maxEnd] - límit superior (final del clip de referència o
         *                            següent marcador). null = sense límit.
         * @returns {Promise<{track:number, start:number, moved:boolean}>}
         */
        _chooseSlot: async function (candidates, startSec, durSec, ctx, maxEnd) {
            const list = (Array.isArray(candidates) ? candidates : [candidates]).filter(t => t);
            if (list.length === 0) return { track: null, start: startSec, moved: false };
            let dur = Math.max(durSec || 0, 0.5);
            // Si el límit no hi deixa ni el mínim (0.5s), encongim la durada perquè hi càpiga.
            if (maxEnd !== null && maxEnd !== undefined) {
                const room = maxEnd - startSec;
                if (room <= 0) return { track: list[0], start: startSec, moved: false };
                if (room < dur) dur = room;
            }
            let best = null;
            for (const tr of list) {
                const ranges = await this._trackBusyRanges(tr, ctx);
                const free = this._firstFreeStart(ranges, startSec, dur);
                if (free <= startSec + 0.01) return { track: tr, start: startSec, moved: false };
                if (maxEnd !== null && maxEnd !== undefined && (free + dur) > maxEnd + 0.01) continue;  // no cap dins del límit
                if (!best || free < best.start) best = { track: tr, start: free, moved: true };
            }
            if (best) return best;
            // (2026-09-21) No hi cap amb la durada completa dins del límit (l'ÍTEM) → es torna a
            // provar ENCONGINT la durada, perquè el rètol quedi SEMPRE dins del seu ítem
            // (regla de l'usuari: el marcador és definitiu i un rètol no en pot sortir).
            if (maxEnd !== null && maxEnd !== undefined && (maxEnd - startSec) > 0.55) {
                let bestShrunk = null;
                for (const tr of list) {
                    const ranges = await this._trackBusyRanges(tr, ctx);
                    const freeMin = this._firstFreeStart(ranges, startSec, 0.5);
                    if (freeMin + 0.5 > maxEnd + 0.01) continue;
                    if (!bestShrunk || freeMin < bestShrunk.start) bestShrunk = { track: tr, start: freeMin };
                }
                if (bestShrunk) {
                    return { track: bestShrunk.track, start: bestShrunk.start, moved: true, shrunk: true, maxDur: maxEnd - bestShrunk.start };
                }
            }
            // Últim recurs (no hauria de passar): la pista està ocupada → es col·loca a l'instant
            // ideal i es marca overlap perquè el log ho digui ben clar (mai sortint de l'ítem).
            return { track: list[0], start: startSec, moved: false, overlap: true };
        },

        /**
         * _clipAtInstant: Clip de V1 que CONTÉ l'instant donat (o el següent si cau
         * just sobre el tall). És el "clip de referència" d'un rètol.
         * ⚠️ Retorna el CLIP SENCER (name/start/end/inPoint/outPoint…) perquè
         * l'ancoratge del TITOLET necessita `inPoint` (tots els cridadors actuals
         * només en llegeixen `start`/`end`, així que el canvi és compatible).
         * @param {Array} clips - clips de V1 (getTrackClips)
         * @param {number} instant
         * @returns {{name:string,start:number,end:number,inPoint:number}|null}
         */
        _clipAtInstant: function (clips, instant) {
            const list = clips || [];
            for (let i = 0; i < list.length; i++) {
                if (list[i].start <= instant && list[i].end > instant) return list[i];
            }
            for (let j = 0; j < list.length; j++) {
                if (list[j].start >= instant - 0.05) return list[j];
            }
            return null;
        },

        /**
         * _itemEndTime: Final de l'ítem d'un marcador estructural: el següent
         * marcador (amb un petit marge), o el CORCHETE DE SELECCIÓ OUT de la
         * seqüència (`seq.outPoint`), o el darrer clip de totes les pistes.
         *
         * ⚠️ (2026-10-06) El corxet OUT mana (petició d'usuari). NO s'usa el final del clip
         * de V1 que CONTÉ el marcador: amb el marcador a 0 s (l'últim/únic ítem) agafava el
         * PRIMER clip de la pista (2,08 s al projecte de prova, amb 479 s de programa) com
         * si fos tot el projecte → «1,7 s disponibles» per a 12 targetes = CAP col·locada.
         * El respatller de totes les pistes només entra si el corxet OUT no està posat (0).
         * Serveix per repartir els TITOLET dins del seu ítem quan no tenen un
         * timecode fiable.
         * @param {Object} mk - {fullId, time}
         * @param {Array} markersFull - marcadors estructurals ordenats
         * @returns {Promise<number|null>}
         */
        _itemEndTime: async function (mk, markersFull) {
            const after = (markersFull || []).filter(m => m.time > mk.time + 0.01)
                .sort((a, b) => a.time - b.time);
            if (after.length > 0) return after[0].time - 0.5;      // marge abans del següent ítem
            // 1. CORXET OUT de la seqüència (`Timeline.getOut()` = `seq.outPoint`;
            //    `Timeline.duration()` retorna el mateix valor).
            try {
                const end = parseFloat(await callJSX("Timeline.getOut()") || "0");
                if (end > mk.time + 0.5) {
                    log(`   🧭 [itemEnd] marcador ${mk.fullId} @ ${mk.time.toFixed(2)}s sense marcador següent → corxet OUT ${end.toFixed(2)}s`);
                    return end;
                }
                log(`   🧭 [itemEnd] marcador ${mk.fullId}: corxet OUT a ${end.toFixed(2)}s (no serveix) → es busca el final real del programa`, 'WARN');
            } catch (e) { }
            try {
                const dur = parseFloat(await callJSX("Timeline.duration()") || "0");
                if (dur > mk.time + 0.5) return dur;
            } catch (e2) { }
            // 2. Respatller (només si el corxet OUT no està posat): darrer clip de TOTES les
            //    pistes de vídeo. El primer clip de V1 NO és el projecte.
            let last = 0;
            let nTracks = 0;
            try { nTracks = parseInt(await callJSX("Tracks.count('video')") || '0', 10) || 0; } catch (eN) { nTracks = 0; }
            if (nTracks <= 0) nTracks = 1;
            for (let t = 1; t <= nTracks; t++) {
                try {
                    const cl = (await getClipsLogic().getTrackClips(t, 'video')) || [];
                    for (const c of cl) { if (isFinite(c.end) && c.end > last) last = c.end; }
                } catch (eC) { }
            }
            if (last > mk.time + 0.5) {
                log(`   🧭 [itemEnd] marcador ${mk.fullId} → final del programa ${last.toFixed(2)}s (${nTracks} pistes)`);
                return last;
            }
            return null;
        },

        _placeChyronsByType: async function (filterFn, trackResolver, label, onPlaced, opts) {
            if (!(await getUtils().validateActiveSequence())) return;
            const cfg = FASTPASS_UI.Config.get();
            const struct = FASTPASS_UI.State.structure;
            if (!struct || struct.length === 0) {
                log("⚠️ No hi ha estructura carregada. Executa un escaneig primer.", "WARN");
                return;
            }
            try {
                const markersRaw = await callJSX('Markers.get()');
                const allMarkers = markersRaw ? JSON.parse(markersRaw) : [];
                const STRUCTURAL_COMMENTS_RE = /^\d+[a-z]{0,3}\s*-\s*.+$/i;
                const structuralMarkers = allMarkers.filter(m => {
                    const cmt = (m.comments || "").trim();
                    return STRUCTURAL_COMMENTS_RE.test(cmt);
                });
                if (structuralMarkers.length === 0) {
                    log(`⚠️ [${label}] No hi ha marcadors estructurals. Clica MARCADORS primer.`, "WARN");
                    return;
                }
                const markersFull = [];
                for (const m of structuralMarkers) {
                    const parts = (m.comments || "").split("-");
                    if (parts.length > 0) {
                        const rawId = parts[0].trim();
                        const numMatch = rawId.match(/^(\d+)/);
                        if (numMatch) {
                            markersFull.push({ fullId: rawId, blockNum: numMatch[1].padStart(2, "0"), time: m.time });
                        }
                    }
                }
                markersFull.sort((a, b) => a.time - b.time);
                log(`🔗 [${label}] ${markersFull.length} marcadors: ${markersFull.map(m => m.fullId + '@' + m.time.toFixed(1)).join(', ')}`);

                const structureById = {};
                for (const entry of struct) { if (entry.id) structureById[entry.id] = entry; }

                const wottIdx = await FASTPASS_UI.Logic.Project.getWottIndex();
                const ctx = { busy: {}, placed: {} };
                // ── REGLA DELS RÈTOLS (2026-09-16) ──────────────────────────────
                // Un rètol (NomCarrec, Lloc, Resto…) va a 10 FRAMES (0,40s) de l'inici
                // del SEU CLIP de referència — el clip de V1 que conté l'instant ideal —
                // i ACABA quan acaba aquest clip. No depèn de la durada del clip ni de
                // la durada del wott. (TITOLET i Traducció tenen regles pròpies.)
                // (2026-09-18) A MÉS del final del clip de V1, un wott no pot passar-se del
                // SEGÜENT marcador: hi ha efectes entre clips que no es detecten com a tall
                // però que sí tenen marcador → així cap wott es cola al 1r clip del següent ítem.
                const nextMarkerAfter = (tSec) => {
                    let best = null;
                    for (const m of markersFull) {
                        if (m.time > tSec + 0.01 && (best === null || m.time < best)) best = m.time;
                    }
                    return best;
                };

                const CHYRON_OFFSET_SEC = 0.40;   // 10 frames a 25 fps
                const CHYRON_OFFSET_FRAMES = 10;

                let allClipsV1 = [];
                try { allClipsV1 = await getClipsLogic().getTrackClips(1, 'video'); } catch (eCL) { log(`⚠️ [${label}] Sense clips de V1: ${eCL.message}`); }
                // (2026-09-21) ÍTEMS DE CONNEXIÓ: un rètol "Enviat/Directe/Presencial" pot venir
                // penjat a un ítem ANTERIOR (tipus donapas) perquè el sistema de ròtols el
                // genera amb el lineID del donapas. Mana el seu ÍTEM DE CONNEXIÓ: es busca el
                // marcador de connexió i el rètol es col·loca ALLÀ (amb la finestra d'aquell ítem).
                const markerLabelByTime = {};
                for (const m of structuralMarkers) { markerLabelByTime[(m.time || 0).toFixed(2)] = String(m.comments || ''); }
                const labelDe = (t) => markerLabelByTime[(t || 0).toFixed(2)] || '';
                const conexioDe = {};    // nom del rètol → time del marcador de connexió
                const conexioPer = {};   // time del marcador de connexió (2 decimals) → [chyrons]
                for (const mk0 of markersFull) {
                    const e0 = structureById[mk0.fullId];
                    if (!e0 || !e0.chyrons) continue;
                    for (const c0 of e0.chyrons) {
                        // NOMÉS el tipus ENVIAT es reubica al seu ítem de connexió (els rètols
                        // "Directe PRESENCIAL Berlín"/Programes es queden al seu ítem, com sempre).
                        if (!filterFn(c0) || !this._isEnviatWott(c0)) continue;
                        const tCx = this._connexioMarkerTime(allMarkers, mk0.time);
                        if (tCx === null || Math.abs(tCx - mk0.time) < 0.05) continue;   // ja és al seu ítem
                        conexioDe[c0.name] = tCx;
                        const k = tCx.toFixed(2);
                        (conexioPer[k] = conexioPer[k] || []).push(c0);
                        log(`   🔌 [${label}] CONNEXIÓ: "${String(c0.name).substring(0, 50)}…" ve penjat a l'ítem ${mk0.fullId} @ ${mk0.time.toFixed(2)}s → es col·locarà a l'ítem de connexió "${labelDe(tCx)}" @ ${tCx.toFixed(2)}s`);
                    }
                }
                let placedCount = 0;
                for (const mk of markersFull) {
                    const entry = structureById[mk.fullId];
                    let matching = (entry && entry.chyrons) ? entry.chyrons.filter(c => filterFn(c)) : [];
                    // Els rètols de connexió que pertanyen a un ALTRE ítem es treuen d'aquí...
                    if (matching.length > 0 && Object.keys(conexioDe).length > 0) {
                        matching = matching.filter(c => !(this._isEnviatWott(c) && conexioDe[c.name] !== undefined && Math.abs(conexioDe[c.name] - mk.time) > 0.05));
                    }
                    // ...i s'afegeixen a l'ítem de la SEVA connexió.
                    const vinguts = (conexioPer[mk.time.toFixed(2)] || []).filter(c => !matching.some(m => m.name === c.name));
                    if (vinguts.length > 0) {
                        matching = matching.concat(vinguts);
                        log(`   🔌 [${label}] Marcador ${mk.fullId} @ ${mk.time.toFixed(2)}s: +${vinguts.length} rètol(s) de connexió provinents d'un altre ítem`);
                    }
                    if (matching.length === 0) continue;
                    // TITOLET: el sistema genera variants de posició i versions del
                    // mateix rètol; es deixa només la més recent de cada text.
                    if (opts && opts.dedupeTitolet) {
                        const cremats = matching.filter(c => this._isBurnedGrafWott(c));
                        if (cremats.length > 1) {
                            const kept = this._dedupeTitolet(cremats);
                            log(`   🧩 [${label}] GRAFISME CREMAT al marcador ${mk.fullId}: ${cremats.length} fitxers → ${kept.length} rètol(s) únic(s)`);
                            matching = matching.filter(c => !this._isBurnedGrafWott(c)).concat(kept);
                        }
                    }
                    // RE-GENERACIONS (#133, 2026-10-02): el MATEIX rètol re-generat
                    // (mateixa línia, tc, text i rol) pot estar al NAS 2-3 cops. Com que
                    // el tc és idèntic, abans es col·locaven TOTS i els duplicats, en
                    // trobar la pista ocupada, anaven a una ALTRA capa. Mana la versió
                    // més nova del generador.
                    matching = this._dedupeRegenerations(matching, label);
                    // (2026-10-08) DUPLICATS per POSICIÓ: el generador pot tornar a emetre el
                    // mateix rètol amb un ALTRE wottId i accents diferents («Ivan»/«Iván») →
                    // `_dedupeRegenerations` no els veu com la mateixa generació i tots dos
                    // s'acaben col·locant (el segon, a una ALTRA capa). S'aplica a TOTES les
                    // fases perquè aquest bucle és comú a Conduct/Titol/Lloc/Nom/Resto.
                    matching = this._dedupeSameChyron(matching, label);
                    matching.sort((a, b) => (a.tc || "").localeCompare(b.tc || ""));
                    log(`📌 [${label}] Marcador ${mk.fullId}: ${matching.length} chyron(s)`);
                    // ── CADENA DE GRAFISME CREMAT (2026-10-05 · rols ampliats 2026-10-08) ──
                    // Els rètols d'aquesta família (TITOLET i, des del 2026-10-08, PREGUNTA —
                    // TNM V3) NO entren al bucle genèric: el tc del seu nom no és fiable (sempre
                    // 00.00) i han d'anar SEMPRE en CADENA — targeta + congelat, una darrere
                    // l'altra, al SEU instant detectat. `_placeTitoletChain` tria pista (V8
                    // preferent, V7 alternativa) i RESERVA el rang sencer a `ctx` ABANS que la
                    // resta de rètols de l'ítem busquin forat (així `_chooseSlot` els aparta sol);
                    // si xoca amb rètols ja col·locats, els aparta o baixa la cadena de pista.
                    // CONDICIÓ DE DISPARO: `_isBurnedGrafWott` (rols de `titolet.detectRoles`).
                    if (opts && opts.chainTitolet) {
                        const cremats = matching.filter(c => this._isBurnedGrafWott(c));
                        if (cremats.length > 0) {
                            const itemEndChain = await this._itemEndTime(mk, markersFull);
                            placedCount += await this._placeTitoletChain({
                                mk: mk, itemEnd: itemEndChain, titolets: cremats,
                                wottIdx: wottIdx, cfg: cfg, ctx: ctx, label: label,
                                wfCtx: this._wfCtx(), clipsV1: allClipsV1,
                                tag: this._burnedGrafTag(cremats)
                            });
                            matching = matching.filter(c => !this._isBurnedGrafWott(c));
                            if (matching.length === 0) continue;
                        }
                    }
                    for (const chy of matching) {
                        const idealTime = this._baseTimeForChyron(chy, mk, allMarkers) +
                            getUtils().timeToSeconds(chy.tc || "000000");
                        const snapped = await this._snapToNearestCut(idealTime);
                        const durInfo = FASTPASS_UI.Logic.Project._resolveWottDur(wottIdx, chy);

                        // Clip de referència = el clip de V1 que conté l'instant ideal. El rètol
                        // hi entra 10 frames després de l'inici del clip O del marcador de l'ítem
                        // (el que sigui més tard) i S'ACURTA si l'ítem s'acaba abans que el wott.
                        // MAI s'allarga: si el wott és més curt que el clip, conserva la seva
                        // durada pròpia (regla de l'usuari, 16/09 · marcador sagrat, 21/09).
                        let placeStart = snapped, placeEnd = null;
                        // (2026-09-21) EL MARCADOR DELIMITA L'ÍTEM: un rètol no pot entrar mai
                        // ABANS del seu marcador ni sortir-se'n (ni passar del SEGÜENT marcador).
                        // Els talls de Premiere NO són frontera fiable — entre dos INSERTS hi ha
                        // efectes que no es detecten com a tall — així que l'entrada és
                        // max(inici del clip de V1, marcador de l'ítem) + 10 frames.
                        let limSlot = null;
                        if (allClipsV1.length > 0) {
                            const ci = this._clipAtInstant(allClipsV1, snapped);
                            if (ci) {
                                const durOwn = (durInfo.dur > 0) ? durInfo.dur : null;   // si no es resol, mana el media
                                placeStart = Math.max(ci.start, mk.time) + CHYRON_OFFSET_SEC;
                                // Límit DUR: el SEGÜENT marcador (frontera de l'ítem). Si no n'hi ha
                                // cap, el final del clip de V1 de referència.
                                // (2026-09-21) ÍTEM EFECTIU = el que CONTÉ l'instant d'entrada: per als
                                // rètols de connexió (Enviat/Directe/Presencial) ancorats al PUNT DE
                                // CONNEXIÓ, la finestra és la de l'ÍTEM DE CONNEXIÓ, no la de l'ítem que
                                // porta el número al nom (donapas) — si no, quedarien fora i saltats.
                                let mkEff = mk;
                                for (const m of markersFull) {
                                    if (m.time <= placeStart + 0.01 && m.time >= mkEff.time) mkEff = m;
                                }
                                const nm = nextMarkerAfter(mkEff.time);
                                let lim, limWhy;
                                if (nm !== null && nm > mkEff.time + 0.1) {
                                    lim = nm;
                                    limWhy = 'marcador ' + nm.toFixed(2) + 's';
                                } else {
                                    lim = ci.end;
                                    limWhy = 'final del clip (sense marcador següent)';
                                }
                                limSlot = lim;
                                placeEnd = (durOwn === null) ? lim : Math.min(lim, placeStart + durOwn);
                                // Protecció: si el clip de referència és tan curt que no hi
                                // cap ni l'offset de 10 frames, no s'hi posa rètol (abans
                                // sortien durades negatives, p.ex. @135.92→135.76).
                                if (placeEnd <= placeStart + 0.05) {
                                    log(`   ⏭️ [${label}] ${String(chy.name).substring(0, 34)}… saltat: l'ítem no té espai ni per a l'offset de 10 frames (${(lim - placeStart).toFixed(2)}s disponibles)`, "WARN");
                                    continue;
                                }
                                const trimmed = (durOwn !== null && placeStart + durOwn > lim + 0.001);
                                log(`   📐 [${label}] ${String(chy.name).substring(0, 34)}… → clip [${ci.start.toFixed(2)}-${ci.end.toFixed(2)}] → entra a ${placeStart.toFixed(2)}s (+${CHYRON_OFFSET_FRAMES}f), surt a ${(placeEnd === null ? placeStart + Math.max(durInfo.dur, 0.5) : placeEnd).toFixed(2)}s` +
                                    (mkEff.fullId !== mk.fullId ? ` [ítem ${mkEff.fullId}]` : '') +
                                    (trimmed ? ' (acurtat per ' + limWhy + ')' : ' (durada pròpia del wott)'));
                            }
                        }
                        const chyronDur = (placeEnd !== null) ? Math.max(0.5, placeEnd - placeStart) : durInfo.dur;
                        // maxEnd = límit de l'ÍTEM (final del clip de referència o següent
                        // marcador) → _chooseSlot pot buscar un forat lliure en tot l'ítem però
                        // mai colar-se a l'ítem anterior ni al següent (2026-09-21).
                        const slot = await this._chooseSlot(trackResolver(chy, cfg), placeStart, chyronDur, ctx,
                            (limSlot !== null) ? limSlot : ((placeEnd !== null) ? placeEnd : null));
                        if (!slot.track) {
                            log(`   ⚠️ [${label}] Sense pista disponible per a ${chy.name}`, "WARN");
                            continue;
                        }
                        if (slot.shrunk) {
                            log(`   ⚠️ [${label}] ${String(chy.name).substring(0, 30)}… escurçat a ${(slot.maxDur || 0).toFixed(2)}s per encabir-se dins del seu ítem @ ${slot.start.toFixed(2)}s`, "WARN");
                        }
                        if (slot.overlap) {
                            log(`   ⚠️ [${label}] ${String(chy.name).substring(0, 30)}… SENSE ESPAI LLIURE a la pista: col·locat sobre un altre rètol @ ${slot.start.toFixed(2)}s`, "WARN");
                        }
                        if (placeEnd !== null && slot.moved) {
                            // El final mai pot passar del límit de l'ÍTEM (marcador següent) ni
                            // del forat disponible si el rètol s'ha hagut d'escurçar.
                            const ci2 = this._clipAtInstant(allClipsV1, slot.start);
                            let end2 = (durInfo.dur > 0) ? (slot.start + durInfo.dur) : (ci2 ? ci2.end : null);
                            if (ci2 && end2 !== null) end2 = Math.min(end2, ci2.end);
                            if (limSlot !== null && end2 !== null) end2 = Math.min(end2, limSlot);
                            if (slot.shrunk && slot.maxDur) {
                                const maxE = slot.start + slot.maxDur;
                                end2 = (end2 === null) ? maxE : Math.min(end2, maxE);
                            }
                            placeEnd = end2;
                        }
                        // (2026-10-08) `jsxName`: el JSX fa `decodeURIComponent` sobre el nom →
                        // un `%` literal l'ha de rebre com a `%25` o la crida falla en silenci.
                        const escapedName = getUtils().escape(getUtils().jsxName(chy.name));
                        // (2026-10-01 · #129) SENSE endSec: el JSX l'aplica al DARRER clip de la
                        // pista (vegeu nota de sota) → l'insert cru ja perjudica un altre clip
                        // (a V6, el PNG estirat del Tema-Títol). El final es fixa tot seguit amb
                        // `Clips.endAt`, que cerca el clip pel seu start.
                        await callJSX(`Clips.insert('${escapedName}', ${slot.track}, ${slot.start.toFixed(4)}, null, 'video')`);
                        // (2026-09-18) IMPORTANT: el JSX Clips.insert aplica l'endSec al DARRER
                        // clip de la pista, NO al que acaba d'inserir → cal fixar-lo pel clip
                        // que comença a slot.start. Sense això els wotts quedaven més llargs
                        // del compte, se solapaven i es colaven fora del seu ítem (i sortien
                        // durades negatives).
                        if (placeEnd !== null) {
                            const rEndAt = await callJSX(`Clips.endAt(${slot.track}, ${slot.start.toFixed(4)}, ${placeEnd.toFixed(4)}, 'video')`);
                            if (String(rEndAt).indexOf('OK') === -1) {
                                log(`   ⚠️ [${label}] endAt V${slot.track} @ ${slot.start.toFixed(2)}s → ${rEndAt}`, "WARN");
                            }
                        }
                        this._addPlaced(ctx, slot.track, slot.start, (placeEnd !== null) ? placeEnd : slot.start + Math.max(durInfo.dur, 0.5));
                        log(`   ✅ [${label}] ${chy.name} → V${slot.track} @ ${slot.start.toFixed(2)}s` +
                            ((placeEnd !== null) ? ` → ${placeEnd.toFixed(2)}s (dur ${(placeEnd - slot.start).toFixed(1)}s)` : ` (dur ${durInfo.dur.toFixed(1)}s)`) +
                            (slot.moved ? ` ⟵ desplaçat per no trepitjar (ideal ${snapped.toFixed(2)}s)` : '') +
                            (this._isTitolet(chy) ? ' [INSERT]' : ''));
                        placedCount++;
                        if (onPlaced) { await onPlaced(chy, slot.start); }
                    }
                }
                if (placedCount === 0) {
                    log(`⚠️ [${label}] Cap chyron per col·locar.`, "WARN");
                } else {
                    log(`🎬 [${label}] ${placedCount} chyron(s) col·locat(s).`, "INFO");
                    getUtils().status(`${label}: ${placedCount} col·locat(s)`, "exito");
                }
            } catch (e) { getUtils().handleError(e, label); }
        },

        /**
         * TITOL (Tema‑Titol): Col·loca els Tema‑Títols GRANS del bloc, cadascun
         * referenciat al seu ítem/marcador, amb freeze‑frame estès fins al següent
         * Tema‑Titol o fins al final del bloc.
         *
         * Regles (2026-09-14):
         *   1. Només clips amb durada > MIN_SEC (els "petits" ~1 s NO són pla B).
         *   2. Posició: marcador de l'ítem + tc (offset del nom). Si l'ítem no té
         *      marcador propi → es tracta com a únic i va a l'inici del bloc
         *      (amb el marge CasA/CasB si hi ha conductor).
         *   3. Cada Tema‑Titol s'estira amb freeze fins al següent o al final.
         */
        placeChyronTitol: async function () {
            if (!(await getUtils().validateActiveSequence())) return;
            const cfg = FASTPASS_UI.Config.get();
            const struct = FASTPASS_UI.State.structure;
            const T_THEME = cfg.tracks.video.tematitol;
            const MIN_SEC = (typeof cfg.temaTitolMinSec === 'number') ? cfg.temaTitolMinSec : 4.0;
            if (!struct || struct.length === 0) {
                log("⚠️ No hi ha estructura carregada. Executa un escaneig primer.", "WARN");
                return;
            }
            try {
                // ── 1. MARCADORS: id normalitzat → time ─────────────────────────
                const markersRaw = await callJSX('Markers.get()');
                const allMarkers = markersRaw ? JSON.parse(markersRaw) : [];
                // (2026-09-29) El sufix pot tenir MÉS de 3 lletres ("01lead"): amb
                // [a-z]{0,3} el marcador propi d'un ítem "01lead" quedava FORA dels
                // estructurals i el Tema-Títol anava a parar a markersByBase (el marcador
                // d'un ALTRE ítem de la mateixa base, p. ex. el "01chy" del GF).
                const STRUCTURAL_RE = /^\d+[a-z]{0,5}\s*-\s*.+$/i;
                const structuralMarkers = allMarkers.filter(m => STRUCTURAL_RE.test((m.comments || "").trim()));
                const markersById = {};
                const markersByBase = {};
                for (const m of structuralMarkers) {
                    const raw = String(m.comments || "").split("-")[0].trim();
                    const norm = FASTPASS_UI.Logic.Project.normItemId(raw);
                    if (!norm) continue;
                    if (markersById[norm] === undefined || m.time < markersById[norm]) markersById[norm] = m.time;
                    const baseM = norm.match(/^\d+/);
                    const base = baseM ? baseM[0] : norm;
                    if (markersByBase[base] === undefined || m.time < markersByBase[base]) markersByBase[base] = m.time;
                }
                log(`🔗 [Titol] ${structuralMarkers.length} marcadors estructurals; ids: [${Object.keys(markersById).join(', ')}]`);

                // ── 2. SELECCIÓ: només Tema‑Titol GRANS (> MIN_SEC) ─────────────
                const wottIdx = await FASTPASS_UI.Logic.Project.getWottIndex();
                const ttList = FASTPASS_UI.Logic.Project.pickTemaTitols(struct, wottIdx, MIN_SEC);
                if (ttList.length === 0) {
                    this._logTitolDiagnostic(struct, wottIdx, MIN_SEC);
                    log(`⚠️ [Titol] Cap Tema‑Titol gran (>${MIN_SEC}s) al bin CHY. No es col·loca res.`, "WARN");
                    getUtils().status(`Tema‑Titol: cap clip gran (>${MIN_SEC}s)`, "warn");
                    return;
                }
                log(`🎯 [Titol] ${ttList.length} Tema‑Titol(s) gran(s): ` +
                    ttList.map(t => t.item + '@' + t.tc + ' (' + t.dur.toFixed(1) + 's ' + t.durSrc + ', id=' + t.idNum + ')').join(' · '));

                // ── 3. REFERÈNCIA I FINAL DEL BLOC ──────────────────────────────
                const clips = await getClipsLogic().getTrackClips(1, "video");
                const clipStart = clips.length > 0 ? clips[0].start : 0;
                let seqEnd = null;
                try { seqEnd = parseFloat(await callJSX("Timeline.getOut()") || "0"); } catch (e) {}
                if (!seqEnd || seqEnd <= 0) {
                    try { seqEnd = parseFloat(await callJSX("Timeline.duration()") || "0"); } catch (e) {}
                }
                if (!seqEnd || seqEnd <= 0) {
                    const lastClip = clips[clips.length - 1];
                    seqEnd = lastClip ? lastClip.end : null;
                }
                const startOfBlock = await this._blockStartTime(clipStart, allMarkers);

                const markerTimeFor = (itemId) => {
                    const norm = FASTPASS_UI.Logic.Project.normItemId(itemId);
                    const baseM = norm.match(/^(\d+)(.*)$/);
                    const base = baseM ? baseM[1] : norm;
                    const baseSuf = baseM ? baseM[2] : '';
                    // (2026-09-29) El respatller per BASE (marcador sense sufix) només val si
                    // cap ALTRE ítem se n'ha quedat el marcador. Cas mesurat (TNV_V1
                    // "LEAD DIAGONAL TALLADA" 29/09): al timeline hi havia "01lead" (0.00, el
                    // seu comentari no passa el filtre estructural → no és a markersById) i
                    // "01chy"@12.68; el Tema-Títol del 01lead s'anclava al marcador del CHYRON
                    // ("marcador 1 (base)") i el titulillo d'entrada queia 11s abans del gran.
                    // Amb la guarda, l'ítem sense marcador propi va a l'inici del bloc.
                    const baseTakenByOther = Object.keys(markersById).some(k => {
                        const km = k.match(/^(\d+)(.*)$/);
                        return km && km[1] === base && km[2] !== '' && km[2] !== baseSuf;
                    });
                    // (2026-09-18) El marcador d'INICI (00:00) NO és una posició d'emissió
                    // real: el força el flux de marcadors perquè el bloc comença al segon 0.
                    // Si l'ítem només té aquest, val més l'inici del bloc (CasA/CasB, que ja
                    // respecta el rètol del conductor). Sense això el 1r Tema-Títol anava a
                    // "0 + tc" en lloc d'anar després del conductor.
                    const MIN_MARKER = 0.5;
                    if (markersById[norm] !== undefined) {
                        if (markersById[norm] < MIN_MARKER) return { time: null, ref: 'marcador ' + norm + ' a 0 → inici del bloc' };
                        return { time: markersById[norm], ref: 'marcador ' + norm };
                    }
                    if (markersByBase[base] !== undefined && !baseTakenByOther) {
                        if (markersByBase[base] < MIN_MARKER) return { time: null, ref: 'marcador ' + base + ' a 0 → inici del bloc' };
                        return { time: markersByBase[base], ref: 'marcador ' + base + ' (base)' };
                    }
                    if (baseTakenByOther) {
                        log(`   ⏭️ [Titol] L'ítem ${norm} no té marcador propi i la base ${base} és d'un altre ítem (${Object.keys(markersById).filter(k => k.indexOf(base) === 0).join(', ')}) → inici del bloc`);
                    }
                    return { time: null, ref: 'inici del bloc' };
                };

                // Ordenar per POSICIÓ REAL: el 1r Tema-Títol és el que obre el bloc i el seu
                // congelat s'estén fins al següent. Sense ordenar, el freeze anava cap enrere
                // (p.ex. placeTime=116.92s amb stretchEnd=1.00s).
                const baseOf = (itemId) => {
                    const n = FASTPASS_UI.Logic.Project.normItemId(itemId);
                    const bm = n.match(/^\d+/);
                    return { norm: n, base: bm ? bm[0] : n };
                };
                const ttPos = ttList.map(t => {
                    const refInfo = markerTimeFor(t.item);
                    // (2026-09-22) El Tema-Títol GRAN entra EXACTAMENT al TC del marcador de
                    // l'ítem. ABANS s'hi sumava el tc del nom del wott ("00.01" → +1,00 s =
                    // 25 frames @25fps) i entrava més tard del marcador (queixa de l'usuari).
                    // La referència és l'IN del clip: el wott s'insereix amb start = marcador i
                    // la seva animació arrenca al primer frame. El tc queda al log com a dada.
                    const tcSec = getUtils().timeToSeconds(t.tc || "000000");
                    const bi = baseOf(t.item);
                    return {
                        tt: t,
                        ref: refInfo.ref + ' · tc wott ' + String(t.tc || '000000') + (tcSec > 0.01 ? ' (' + tcSec.toFixed(2) + 's IGNORAT: el gran va al marcador)' : ''),
                        time: (refInfo.time !== null) ? refInfo.time : startOfBlock,
                        hasMarker: (markersById[bi.norm] !== undefined) || (markersByBase[bi.base] !== undefined)
                    };
                }).sort((a, b) => a.time - b.time);

                // (2026-09-22) BLINDATGE contra el doble Tema-Títol: dos Tema-Títols a la MATEIXA
                // posició (típicament dos ítems del bloc sense marcador propi → tots dos cauen a
                // l'inici del bloc) fan que el segon tapï el primer. En cas de col·lisió es
                // prefereix el de l'ítem que TÉ marcador a la seqüència; si cap en té, es queda el primer.
                const ttFinal = [];
                for (const p of ttPos) {
                    const dup = ttFinal.find(x => Math.abs(x.time - p.time) < 0.05);
                    if (!dup) { ttFinal.push(p); continue; }
                    const nameP = String(p.tt.name).substring(0, 45);
                    const nameD = String(dup.tt.name).substring(0, 45);
                    if (p.hasMarker && !dup.hasMarker) {
                        log(`   🔁 [Titol] A ${p.time.toFixed(2)}s el candidat "${nameD}" (ítem ${dup.tt.item}, sense marcador) es canvia per "${nameP}" (ítem ${p.tt.item}, amb marcador)`, 'WARN');
                        dup.tt = p.tt; dup.ref = p.ref; dup.hasMarker = true;
                    } else {
                        log(`   ⏭️ [Titol] "${nameP}" (ítem ${p.tt.item}) aniria també a ${p.time.toFixed(2)}s → se surt (taparia "${nameD}")`, 'WARN');
                    }
                }
                if (ttFinal.length < ttPos.length) {
                    log(`   🛡️ [Titol] ${ttPos.length - ttFinal.length} Tema-Títol(s) descartat(s) per col·lisió de posició`);
                }

                // (2026-10-07) ORDRE DE COL·LOCACIÓ: el titulillo (§6/§7) s'ha de calcular i
                // col·locar ABANS que el Tema-Títol gran (§5). `ttPlaced` es deriva ARA de la
                // planificació `ttFinal` (no cal el gran ja col·locat). Així el gran és l'ÚLTIMA
                // peça que entra a V6 → cap insert del titulillo (entrant/congelat/sortida) el
                // pot tapar; abans, el gran entrava primer i el titulillo el "machacava".
                const ttPlaced = ttFinal.map(x => ({ placeTime: x.time, item: x.tt.item, name: x.tt.name }));

                // ── 6. TRANSICIONS amb el TEMA-TÍTOL PETIT ("titulillo") ──────────────────
                // (2026-09-21) El titulillo (~1 s, amb animació) s'usa com a transició:
                // entrant a l'inici del bloc (si el gran va després del conductor) i sortint
                // (desaparició del gran) just abans de cada Tema-Títol gran.
                try {
                    await this._placeTemaTitolTransicions({
                        struct: struct,
                        wottIdx: wottIdx,
                        ttPlaced: ttPlaced,
                        clipStart: clipStart,
                        track: T_THEME,
                        minSec: MIN_SEC,
                        case: this._lastTitolCase || 'A'
                    });
                } catch (eTT) {
                    log(`   ⚠️ [Titol·Petit] Transicions fallides: ${eTT.message}`, "WARN");
                }

                // ── 7. COBERTURA: "sempre hi ha d'haver titulillo" (2026-09-22) ────────────
                // Si el Tema-Títol gran entra tard (el seu ítem és a mig bloc), V5 queda buida
                // des de l'inici: s'hi col·loca el titulillo (identitat del programa) + el
                // congelat estirat + el titulillo invertit per transicionar al gran.
                try {
                    await this._fillTitulilloGaps({
                        struct: struct,
                        wottIdx: wottIdx,
                        ttPlaced: ttPlaced,
                        clipStart: clipStart,
                        track: T_THEME,
                        minSec: MIN_SEC,
                        minGapSec: 2.5
                    });
                } catch (eFg) {
                    log(`   ⚠️ [Titol·Petit·cobertura] ${eFg.message}`, "WARN");
                }

                // ── 5. TEMA-TÍTOL GRAN (l'ÚLTIMA peça a V6) ───────────────────────────────
                let placed = 0;
                for (let i = 0; i < ttFinal.length; i++) {
                    const tt = ttFinal[i].tt;
                    const placeTime = ttFinal[i].time;
                    // Final del freeze: el següent Tema‑Titol gran, o el final del bloc
                    let stretchEnd = (i < ttFinal.length - 1) ? ttFinal[i + 1].time : null;
                    if (stretchEnd === null) stretchEnd = (seqEnd && seqEnd > 0) ? seqEnd : null;

                    log(`📌 [Titol] ${i + 1}/${ttFinal.length} "${String(tt.name).substring(0, 60)}" → ${placeTime.toFixed(2)}s (${ttFinal[i].ref}) · freeze fins ${stretchEnd !== null ? stretchEnd.toFixed(2) + 's' : 'final'}`);

                    try {
                        const freezeResult = await this._freezeTemaTitol(tt.name, placeTime, stretchEnd, tt.name);
                        if (freezeResult && freezeResult.success) {
                            placed++;
                            log(`   🖼️ [Titol] Tema‑Titol col·locat: ${freezeResult.duration.toFixed(1)}s`);
                        }
                    } catch (freezeErr) {
                        log(`   ❌ [Titol] Freeze fallit per ${tt.name}: ${freezeErr.message}`, "ERROR");
                    }
                    await getUtils().delay(200);
                }

                // ── 8. REFRESC nuclear de la UI (2026-10-07) ──────────────────────────────
                // Després de tantes insercions/moviments via script, Premiere NO redibuixa el
                // timeline ni el visor: allò que es veu pot NO coincidir amb el contingut real.
                // `Timeline.refresh()` mou el cabezal ±0.001 s per forçar el repintat del panell
                // (assegura que el que es mostra és exactament el que hi ha a la seqüència).
                try {
                    const rf = await callJSX('Timeline.refresh()');
                    log(`   🔄 [Titol] Timeline.refresh → ${rf}`);
                } catch (eRf) {
                    log(`   ⚠️ [Titol] Timeline.refresh ha fallat: ${eRf.message}`, "WARN");
                }

                if (placed === 0) {
                    log("⚠️ [Titol] Cap Tema‑Titol per col·locar.", "WARN");
                } else {
                    log(`🎬 [Titol] ${placed} Tema‑Titol(s) col·locat(s).`, "INFO");
                    getUtils().status(`Titol: ${placed} col·locat(s)`, "exito");
                }
            } catch (e) { getUtils().handleError(e, "Titol"); }
        },
        /**
         * _logTitolDiagnostic: Log de diagnòstic quan no hi ha cap Tema‑Titol gran.
         * Mostra quants n'hi ha a l'estructura, la durada resolta i la seva font,
         * i avisa del motiu més habitual (cap rol/nom Tema‑Titol o cap durada).
         * @param {Array} struct - State.structure
         * @param {Object} idx - getWottIndex()
         * @param {number} minSec
         */
        _logTitolDiagnostic: function (struct, idx, minSec) {
            try {
                const found = [];
                let totalChy = 0;
                for (const e of (struct || [])) {
                    for (const c of (e.chyrons || [])) {
                        totalChy++;
                        const rol = String(c.rol || '').toUpperCase();
                        if (rol === 'TEMA-TITOL' || String(c.name || '').toUpperCase().indexOf('TEMA-TITOL') !== -1) {
                            const res = FASTPASS_UI.Logic.Project._resolveWottDur(idx, c);
                            found.push(`${e.id}@${c.tc}→${res.dur.toFixed(2)}s(${res.src})`);
                        }
                    }
                }
                log(`🔬 [Titol·DIAG] Estructura: ${(struct || []).length} blocs, ${totalChy} chyrons; Tema‑Titol: ${found.length}` +
                    (found.length ? ' → ' + found.join(' | ') : ''), "INFO");
                const nBin = (idx && idx.items) ? idx.items.length : 0;
                if (found.length === 0) {
                    log(`🔬 [Titol·DIAG] Cap chyron amb rol/nom Tema‑Titol (bin CHY: ${nBin} fitxers). Revisa que l'escaneig hagi carregat l'estructura del bloc.`, "WARN");
                } else if (found.every(f => f.indexOf('(cap)') !== -1)) {
                    log(`🔬 [Titol·DIAG] Tema‑Titol trobats però sense durada ni mida al bin CHY (${nBin} fitxers).`, "WARN");
                } else {
                    log(`🔬 [Titol·DIAG] Tots els Tema‑Titol fan ≤ ${minSec}s: no es col·loca res (regla: només clips grans).`, "INFO");
                }
            } catch (e) {
                log(`🔬 [Titol·DIAG] Error al diagnòstic: ${e.message}`, "WARN");
            }
        },

        /**
         * _blockStartTime: Posició d'inici del bloc per als Tema‑Titol sense
         * marcador propi. Si hi ha conductor a la pista de chyrons dins del primer
         * clip, s'aplica el marge CasA/CasB (no trepitjar el rètol del conductor).
         * @param {number} clipStart
         * @param {Array} allMarkers
         * @returns {Promise<number>}
         */
        _blockStartTime: async function (clipStart, allMarkers) {
            const cfg = FASTPASS_UI.Config.get();
            const MIN_MARGEN_CASA = 0.40 + 6.24 + 4.40; // ~11.04s
            let placeTime = clipStart + 0.40;
            // (2026-09-21) Es guarda el CAS triat: el TEMA-TÍTOL PETIT (titulillo) fa la
            // transició d'entrada només en CasB (el gran va DESPRÉS del conductor).
            this._lastTitolCase = 'A';
            try {
                const v6Count = parseInt(await callJSX(`Clips.count(${cfg.tracks.video.chyrons}, 'video')`) || '0');
                if (v6Count > 0) {
                    const firstV6 = JSON.parse(await callJSX(`Clips.get(${cfg.tracks.video.chyrons}, 0, 'video')`));
                    const isConductor = firstV6 && firstV6.name && firstV6.name.toUpperCase().includes("CONDUCT");
                    if (isConductor && Math.abs(firstV6.start - clipStart) < 0.5) {
                        const sortedM = (allMarkers || []).slice().sort((a, b) => a.time - b.time);
                        let nextMarkerTime = clipStart + 30;
                        for (const m of sortedM) {
                            if (m.time > clipStart + 0.5) { nextMarkerTime = Math.min(nextMarkerTime, m.time); break; }
                        }
                        // (2026-09-21) La finestra disponible s'ha de mesurar com ho fa el
                        // CONDUCTOR (placeChyronConductor → marge del CLIP). El Titol només
                        // mirava el marcador següent, i amb un clip de 6.20s però el marcador
                        // lluny, triava CasA (0.40s) mentre el Conductor triava CasB (també
                        // 0.40s) → s'hi trepitjaven. Ara: marge = MÍNIM(marcador, clip).
                        let margenClip = null;
                        try {
                            const clipsV1 = await getClipsLogic().getTrackClips(cfg.tracks.video.mp4 || 1, 'video');
                            let bc = null;
                            for (const cl of clipsV1) { if (cl.start <= clipStart + 0.01 && cl.end > clipStart) { bc = cl; break; } }
                            if (!bc) { for (const cl of clipsV1) { if (cl.start >= clipStart - 0.05) { bc = cl; break; } } }
                            if (bc) margenClip = bc.end - clipStart;
                        } catch (eMC) { }
                        const margenMarker = nextMarkerTime - clipStart;
                        const margen = (margenClip !== null) ? Math.min(margenMarker, margenClip) : margenMarker;
                        // (2026-09-18) CasB: el Tema-Títol ha d'entrar quan ACABA el rètol
                        // del conductor (durada REAL del clip, p.ex. 0.40+3.79=4.19s), no
                        // amb la constant 4.40s (que donava 4.80s). La constant queda només
                        // com a últim recurs si no es pot llegir el final del conductor.
                        const condEnd = (firstV6 && isFinite(firstV6.end) && firstV6.end > 0) ? firstV6.end : null;
                        if (margen >= MIN_MARGEN_CASA) {
                            placeTime = clipStart + 0.40;                 // CasA: Tema-Títol primer
                        } else if (condEnd !== null) {
                            // (2026-10-01 · #128) El clip del conductor té ~15 frames BUIDES al final
                            // (l'animació ja ha acabat): el Tema-Títol gran hi ha d'entrar aquests
                            // 15 frames ABANS, i el revers + el congelat del titulillo el segueixen.
                            placeTime = condEnd - CONDUCTOR_TAIL;         // CasB: quan acaba l'animació
                        } else {
                            placeTime = clipStart + 0.40 + 4.40;          // CasB (fallback)
                        }
                        this._lastTitolCase = (margen >= MIN_MARGEN_CASA) ? 'A' : 'B';
                        log(`📌 [Titol·Cas${margen >= MIN_MARGEN_CASA ? 'A' : 'B'}] inici del bloc @ ` +
                            `${placeTime.toFixed(2)}s` +
                            (condEnd !== null ? ` (fi del rètol conductor @ ${condEnd.toFixed(2)}s − 15 frames)` : ' (constant 4.40s)') +
                            ` [marge=${margen.toFixed(2)}s: marcador=${margenMarker.toFixed(2)}s` +
                            (margenClip !== null ? `, clip=${margenClip.toFixed(2)}s` : '') + `]`);
                    }
                }
            } catch (e) { }
            return placeTime;
        },

        /**
         * _ensureReversedTitolPetit: Assegura la versió INVERTIDA (ffmpeg) del titulillo i
         * l'importa al bin CHY. Es genera un sol cop: si ja existeix (`FFmpeg.reverse` ho
         * comprova), es reutilitza.
         * (2026-09-22) Es crida de forma **PEREZOSA** (`getRev()` a
         * `_placeTemaTitolTransicions` / `_fillTitulilloGaps`): només s'envia a invertir quan
         * el revers s'ha de col·locar de veritat al timeline.
         * @param {{name:string, path:string, dur:number}} petit
         * @returns {Promise<{ok:boolean, name:string, path:string}>}
         */
        _ensureReversedTitolPetit: async function (petit) {
            const ff = (window.FASTPASS_UI && window.FASTPASS_UI.Logic) ? window.FASTPASS_UI.Logic.FFmpeg : null;
            if (!ff || typeof ff.reverse !== 'function') {
                log('   ⚠️ [Titol·Petit] Lògica FFmpeg no disponible: no es pot invertir el titulillo', 'WARN');
                return { ok: false, name: '', path: '' };
            }
            const src = (petit && petit.path) || '';
            if (!src) {
                log('   ⚠️ [Titol·Petit] El titulillo no té ruta al manifest → no es pot invertir', 'WARN');
                return { ok: false, name: '', path: '' };
            }
            const res = await ff.reverse(src, null, 'CHY');
            if (!res || !res.ok) {
                log(`   ⚠️ [Titol·Petit] Inversió fallida: ${res ? res.error : '?'}`, 'WARN');
                return { ok: false, name: '', path: '' };
            }
            log(`   🔄 [Titol·Petit] Versió invertida llesta: ${res.name}`);
            return { ok: true, name: res.name, path: res.path };
        },

        /**
         * _placeTemaTitolTransicions: Transicions amb el TEMA-TÍTOL PETIT ("titulillo") i la
         * peça de SORTIDA del gran.
         *
         * El titulillo és el Tema-Títol d'~1 s (qtrle amb alpha) que fa d'identitat/entrada.
         * La SORTIDA ja NO s'inverteix amb ffmpeg: (2026-10-07) s'usa la pròpia animació de
         * DESAPARICIÓ que el Wott del Tema-Títol gran porta al final del seu mèdia
         * (`cfg.temaTitolExit`, 10:00→10:06 = 6 frames) — vegeu `_insertTemaTitolExit`. El revers ffmpeg
         * del titulillo queda només com a xarxa de seguretat (`useReverseFallback`).
         * Col·locacions, a la pista de Tema-Títol:
         *   • CasB (el Tema-Títol gran va DESPRÉS del conductor): titulillo ENTRANT a l'inici
         *     del bloc + congelat + SORTIDA (desaparició) just abans del primer gran.
         *   • Amb més d'un Tema-Títol gran: SORTIDA (desaparició) just abans de cada següent
         *     (transició "entre temes").
         * @param {Object} p - {struct, wottIdx, ttPlaced:[{placeTime, item, name}], clipStart, track, minSec, case}
         * @returns {Promise<number>} Nombre de transicions col·locades
         */
        _placeTemaTitolTransicions: async function (p) {
            const petit = FASTPASS_UI.Logic.Project.pickTemaTitolPetit(p.struct, p.wottIdx, p.minSec);
            if (!petit) {
                log(`   ℹ️ [Titol·Petit] Cap titulillo petit (≤${p.minSec}s) al bin CHY: sense transicions.`);
                return 0;
            }
            log(`   🎬 [Titol·Petit] Titulillo triat: "${String(petit.name).substring(0, 60)}" (${petit.dur.toFixed(2)}s, id=${petit.idNum})`);
            // (2026-10-07) El revers ffmpeg del titulillo JA NO s'usa com a SORTINT: ara és la
            // peça de desaparició del propi gran (`_insertTemaTitolExit`). Es conserva AQUEST
            // `getRev` només com a xarxa de seguretat si la peça no es pot col·locar i
            // `cfg.temaTitolExit.useReverseFallback` està actiu.
            let _revCache = null;
            const getRev = async () => {
                if (_revCache === null) _revCache = await this._ensureReversedTitolPetit(petit);
                return _revCache;
            };
            const durP = petit.dur;
            // (2026-10-01 · #129) DUrada REAL (ffprobe) en lloc de l'estimació del manifest.
            // Amb la durada ESTIMADA (p. ex. 1,02 s = 25,5 frames; el .mov real són 25 frames =
            // 1,00 s) `target - durP` cau en un MIG frame, Premiere el snapeja i el revers
            // quedava 1 frame desplaçat. Pitjor: si l'estimació fos CURTA, l'overwrite de
            // l'insert del revers entraria dins del Tema-Títol gran (el "pisado").
            // `snapDur` alinea a la rejilla de frames amb ceil: el clip MAI no és més curt que
            // el seu mèdia → el seu overwrite no pot arribar més enllà del que diu el pla.
            const ffLogic = (window.FASTPASS_UI && window.FASTPASS_UI.Logic) ? window.FASTPASS_UI.Logic.FFmpeg : null;
            const snapDur = (sec) => Math.max(1, Math.ceil(sec / REV_FRAME - 1e-6)) * REV_FRAME;
            const realDurOf = async (path, estDur) => {
                try {
                    if (!path || !ffLogic || typeof ffLogic.getMediaDuration !== 'function') return estDur;
                    const r = await ffLogic.getMediaDuration(path);
                    if (r && r.ok && r.duration > 0.05) {
                        const d = snapDur(r.duration);
                        log(`   📏 [Titol·Petit] Durada REAL de ${String(path).split(/[\\/]/).pop()}: ${r.duration.toFixed(3)}s → ${d.toFixed(2)}s (estimada ${estDur.toFixed(2)}s)`);
                        return d;
                    }
                } catch (eD) { }
                return estDur;
            };
            // IN de la peça de SORTIDA alineat a la rejilla de frames (ceil → MAI més curt
            // del compte, així el seu `moveToRange` no pot arribar més enllà del pla).
            const revStartFor = (target, pieceDur) => Math.ceil((target - pieceDur) / REV_FRAME - 1e-6) * REV_FRAME;
            const insertTitol = async (name, start, label, endSec) => {
                if (!name || !(durP > 0.05) || start < p.clipStart) return false;
                const esc = getUtils().escape(name);
                const endTarget = (typeof endSec === 'number') ? endSec : (start + durP);
                const ins = await callJSX(`Clips.insert('${esc}', ${p.track}, ${start.toFixed(4)}, null, 'video')`);
                const end = await callJSX(`Clips.endAt(${p.track}, ${start.toFixed(4)}, ${endTarget.toFixed(4)}, 'video')`);
                log(`      ${label} → V${p.track} @ ${start.toFixed(2)}s→${endTarget.toFixed(2)}s (${(endTarget - start).toFixed(2)}s) [ins=${ins} · end=${end}]`);
                return true;
            };
            // ── FASE 0 · PREPARAR DUrades ────────────────────────────────────────────────
            // (2026-10-01 · #129) Fins ara aquí s'invertia el titulillo amb ffmpeg ABANS de
            // calcular el pla (per conèixer-ne la durada real). (2026-10-07) JA NO: la SORTINT
            // és una peça del PROPI Tema-Títol gran (cfg.temaTitolExit), així que la seva
            // durada és una constant de config i no cal tocar ffmpeg ni cap import.
            const exitCfg = this._temaTitolExitCfg();
            const exitDur = snapDur(exitCfg.durSec);
            const petitDur = (p.case === 'B') ? await realDurOf(petit.path, snapDur(durP)) : snapDur(durP);

            // ── FASE 1 · PLA: TOTES les posicions, calculades ABANS d'inserir res ─────────
            // (2026-10-01 · #129) Els inserts de Premiere (Clips.insert → overwriteClip) NO
            // són inofensius: esborren el material que cobreixen. Ordre antic (entrant →
            // congelat → revers) amb el gran JA a la pista: el congelat (still de ~5 s)
            // esborrava la part esquerra del TEMA-TÍTOL GRAN. Per això: 1) es calculen totes
            // les peces, 2) s'ordenen pel IN i 3) s'apliquen d'ESQUERRA A DRETA, de manera
            // que cada inserció només pot tocar zona buida (els clips de la dreta encara no hi són).
            const plan = [];
            if (p.case === 'B') {
                // (2026-10-01 · #128/#129) L'OUT de l'entrant = IN + durada REAL del titulillo
                // (mesurada per ffprobe i alineada a la rejilla de frames). Amb l'estimació del
                // manifest (1,02 s) l'interval quedava 1 frame més llarg del que toca.
                const entrantIn = p.clipStart + 0.40;
                // (2026-10-07) L'OUT va 1 frame ABANS del final teòric: `petitDur` ve de `ceil`
                // → el clip durava 1 frame MÉS que el mèdia i aquell darrer frame eixia buit.
                // El congelat (més avall) comença aquí i absorbeix aquell frame.
                const entrantOut = entrantIn + petitDur - REV_FRAME;
                plan.push({ kind: 'entrant', name: petit.name, start: entrantIn, end: entrantOut, label: '🟢 [Titol·Petit] ENTRANT' });
                // (2026-10-01 · #128) CONGELAT entre l'ENTRANT i el SORTINT: un frame congelat del
                // FINAL del titulillo, estirat fins on comença el revers. Sense això V5 quedava
                // buida entre l'entrada i la sortida del titulillo (l'usuari ho veia com un forat).
                // (_fillTitulilloGaps no ho pot cobrir: amb el revers ja col·locat, el seu buit
                //  calculat queda a 0.)
                const firstTT = (p.ttPlaced.length > 0) ? p.ttPlaced[0].placeTime : null;
                if (firstTT !== null) {
                    const exitStart = revStartFor(firstTT, exitDur);
                    if (exitStart > entrantOut + 0.20) {
                        plan.push({ kind: 'congelat', start: entrantOut, end: exitStart, label: '🧊 [Titol·Petit] CONGELAT' });
                    }
                }
            }
            // SORTINT (peça de DESAPARICIÓ del propi gran) just abans de cada Tema-Títol gran
            // (la del primer, només en CasB).
            for (let i = 0; i < p.ttPlaced.length; i++) {
                const target = p.ttPlaced[i].placeTime;
                const start = revStartFor(target, exitDur);
                if (start < p.clipStart + 0.10) continue;
                if (i === 0 && p.case !== 'B') continue;
                if (!p.ttPlaced[i].name) {
                    log(`   ⚠️ [Titol·Petit] Sense nom del Tema-Títol gran ${i + 1}: no es planifica la SORTINT @ ${start.toFixed(2)}s`, 'WARN');
                    continue;
                }
                plan.push({ kind: 'exit', name: p.ttPlaced[i].name, start: start, end: target, label: `🔴 [Titol·Petit] SORTINT (desaparició del gran ${i + 1}/${p.ttPlaced.length})` });
            }
            plan.sort((a, b) => a.start - b.start);
            if (plan.length > 0) {
                log(`   📋 [Titol·Petit] Pla: ${plan.length} peça(es) d'esquerra a dreta · ` +
                    `titulillo ${petitDur.toFixed(2)}s · sortida ${exitDur.toFixed(2)}s (desaparició del gran, mèdia ${exitCfg.atSec.toFixed(2)}s) → ` +
                    plan.map(x => `${x.kind}@${x.start.toFixed(2)}→${x.end.toFixed(2)}s`).join(' | '));
            }

            // ── FASE 2 · APLICAR d'ESQUERRA A DRETA ──────────────────────────────────────
            let n = 0;
            for (const it of plan) {
                if (it.kind === 'congelat') {
                    if (await this._freezeTitulilloStill(petit, p.track, it.start, it.end, it.label)) n++;
                    continue;
                }
                // (2026-10-07) La SORTINT és la peça de DESAPARICIÓ del propi Tema-Títol gran:
                // retall NO destructiu del seu mèdia (l'ítem JA és al projecte). Si no es pot
                // col·locar i la xarxa de seguretat està activa, es cau al revers ffmpeg antic.
                if (it.kind === 'exit') {
                    const okExit = exitCfg.enabled
                        ? await this._insertTemaTitolExit(it.name, p.track, it.start, it.end, exitCfg.atSec)
                        : false;
                    if (okExit) { n++; continue; }
                    if (!exitCfg.fallbackRev) continue;
                    const rv = await getRev();
                    if (rv.ok) {
                        if (await insertTitol(rv.name, it.start, it.label + ' · revers ffmpeg', it.end)) n++;
                    } else {
                        log(`   ⚠️ [Titol·Petit] Sense peça de desaparició ni versió invertida per a la SORTINT @ ${it.start.toFixed(2)}s`, 'WARN');
                    }
                    continue;
                }
                if (await insertTitol(it.name, it.start, it.label, it.end)) n++;
            }
            if (n > 0) log(`   ✨ [Titol·Petit] ${n} transició(ns) de titulillo col·locades`, 'INFO');
            return n;
        },

        /**
         * _temaTitolExitCfg: Paràmetres de la peça de DESAPARICIÓ del Tema-Títol.
         *
         * (2026-10-07) El Wott del Tema-Títol ja porta al FINAL del seu mèdia la seva pròpia
         * animació de sortida («desaparició del títol petit», 10:00→10:06 = 6 frames). És exactament el
         * que abans es fabricava invertint el titulillo amb ffmpeg (`_REV.mov`); ara
         * s'aprofita aquella peça del propi ítem. Vegeu `TEMATTOL_EXIT_DEFAULTS`.
         * @returns {{enabled:boolean, atSec:number, durSec:number, fallbackRev:boolean}}
         */
        _temaTitolExitCfg: function () {
            let t = {};
            try {
                const cfg = FASTPASS_UI.Config.get();
                t = (cfg && cfg.temaTitolExit) || {};
            } catch (eT) { t = {}; }
            const durSec = (Number(t.durSec) > 0.04) ? Number(t.durSec) : 0.24;
            const atSec = (t.atSec != null && Number(t.atSec) >= 0) ? Number(t.atSec) : 10.0;
            return {
                enabled: (t.enabled !== false),
                atSec: atSec,
                durSec: durSec,
                fallbackRev: (t.useReverseFallback !== false)
            };
        },

        /**
         * _insertTemaTitolExit: Col·loca la peça de DESAPARICIÓ d'un Tema-Títol gran al rang
         * [startSec, endSec], retallada del SEU PROPI mèdia a partir de `atSec`.
         *
         * Mateixa tècnica NO DESTRUCTIVA que el congelat del titulillo (`_freezeTitulilloStill`):
         * 1) `Clips.insert` a un TC lliure LLUNYÀ (col·loca el mèdia sencer i, amb la guarda per nom, neteja l'àudio-fantasma d'AQUEST mèdia, de pas,
         *    fixa inPoint/outPoint del clip), 2) localitzar-lo pel start, 3) `Clips.trimBounds` fixa el retall, 4) `moveToRange` al rang
         * exacte (reassigna start/end, NO fa overwriteClip → no trepitja cap clip veí).
         *
         * L'ítem JA és al projecte (és el Tema-Títol gran) → cap ffmpeg, cap import, cap `_REV.mov`.
         * @param {string} name - Nom del wott del Tema-Títol gran
         * @param {number} track - Pista de Tema-Títol (1-based)
         * @param {number} startSec - IN al timeline
         * @param {number} endSec - OUT al timeline (durada = endSec − startSec)
         * @param {number} atSec - IN del mèdia on arrenca la desaparició
         * @returns {Promise<boolean>}
         */
        _insertTemaTitolExit: async function (name, track, startSec, endSec, atSec) {
            const utils = getUtils();
            const dur = endSec - startSec;
            if (!name || !(dur > 0.05)) return false;
            const inSec = Math.max(0, Number(atSec) || 0);
            // Zona temporal LLIURE de la pista (l'insert d'un clip de mèdia gran faria un
            // overwriteClip de tota la seva durada → a un TC llunyà no toca res).
            const TEMP = await this._v6FreeTC(track, dur + 2);
            // (2026-10-07) Snapshot ABANS d'insertar. A Premiere la peça temporal NO sempre
            // queda EXACTAMENT a TEMP (snapping/deriva) i la cerca estricta per TC (±0,5 s)
            // fallava → l'exit mai no s'aplicava I `removeAt(TEMP)` no trobava la peça →
            // clip ORFE a V6 (vist: 596,64→597,04). Ara es localitza per DIFERÈNCIA (clip NOU).
            let before = [];
            try { before = (await getClipsLogic().getTrackClips(track, 'video')) || []; } catch (eB) { before = []; }
            const _key = (c) => (c.name || '') + '@' + (Number(c.start) || 0).toFixed(2);
            const beforeSet = {};
            for (const c of before) beforeSet[_key(c)] = true;
            // (2026-10-07) ATOM NO DESTRUCTIU. `insertWithBounds` és l'aliat del cleanFeed del
            // MP4: de passada BUIDA A2 sencera, TOT V2 i TOTS els clips d'A1 tret del primer
            // (amb ripple). Reutilitzar-lo per a la peça de Sortida esborrava el programa (A1
            // "quasi buit"). Es componen dos àtoms que només toquen el clip objectiu:
            //   1. `Clips.insert` → col·loca el mèdia sencer a un TC LLIURE (i, amb la seva
            //      guarda per nom, elimina només l'àudio-fantasma d'AQUEST mèdia).
            //   2. `Clips.trimBounds` → fixa inPoint/outPoint i força el `end` del clip.
            const ins = await callJSX(`Clips.insert('${utils.escape(name)}', ${track}, ${TEMP.toFixed(4)}, null, 'video')`);
            if (String(ins).indexOf('ERR') === 0) {
                log(`   ⚠️ [Titol·Sortida] insert temporal ha fallat (${ins})`, 'WARN');
                return false;
            }
            await utils.delay(80);
            // Retall atòmic al mèdia del gran: [inSec, inSec+dur] (p. ex. 10:00→10:06).
            const tb = await callJSX(`Clips.trimBounds(${TEMP.toFixed(4)}, ${inSec.toFixed(4)}, ${(inSec + dur).toFixed(4)}, ${track}, 'video')`);
            if (String(tb).indexOf('ERR') === 0) {
                log(`   ⚠️ [Titol·Sortida] trimBounds ha fallat (${tb})`, 'WARN');
            }
            let cl = [], idx = -1, tempStart = TEMP;
            try {
                cl = (await getClipsLogic().getTrackClips(track, 'video')) || [];
                // 1) Cerca estricta per TC
                for (let i = 0; i < cl.length; i++) {
                    if (Math.abs(cl[i].start - TEMP) < 0.5) { idx = cl[i].index; tempStart = cl[i].start; break; }
                }
                // 2) Cerca ROBUSTA per DIFERÈNCIA: clip NOU dins la zona temporal (TEMP ± 5 s)
                if (idx < 0) {
                    for (let i = 0; i < cl.length; i++) {
                        if (beforeSet[_key(cl[i])]) continue;
                        if (Math.abs(cl[i].start - TEMP) < 5.0) { idx = cl[i].index; tempStart = cl[i].start; break; }
                    }
                }
            } catch (eIdx) { idx = -1; }
            if (idx < 0) {
                try { log(`   🔎 [Titol·Sortida] V${track} clips: ` + cl.map(c => `${(Number(c.start) || 0).toFixed(2)}→${(Number(c.end) || 0).toFixed(2)}`).join(', '), 'WARN'); } catch (eL) { }
                log(`   ⚠️ [Titol·Sortida] peça temporal no trobada a ${TEMP.toFixed(2)}s → es descarta`, 'WARN');
                // Escombrar qualsevol clip NOU a la finestra temporal (evita orfes a V6).
                for (const c of cl) {
                    if (beforeSet[_key(c)]) continue;
                    if (Math.abs(c.start - TEMP) < 8.0) { try { await callJSX(`Clips.removeAt(${track}, ${(Number(c.start) || 0).toFixed(4)}, 'video')`); } catch (eS) { } }
                }
                return false;
            }
            // (2026-10-07) XARXA DE SEGURETAT d'àudio. `Clips.insert` JA elimina l'àudio-fantasma
            // del MATEIX mèdia (guarda per `projectItem.name`); aquests dos àtoms cobreixen el
            // cas residual. La peça de Sortida ha de ser NOMÉS vídeo. `removeLinkedAudio`
            // desenllaça i esborra l'àudio enllaçat del clip temporal (a un TC llunyà → no toca
            // el programa). `dedupeAudioAt` neteja duplicats NO enllaçats d'A2+ al mateix TC
            // (a A1 conserva el primer i mai no toca el programa, de nom diferent).
            try { await callJSX(`Clips.removeLinkedAudio(${track}, ${idx})`); } catch (eAud) { }
            try { await callJSX(`Clips.dedupeAudioAt(${tempStart.toFixed(4)})`); } catch (eAud2) { }
            const mv = await callJSX(`Clips.moveToRange(${track}, ${idx}, ${startSec.toFixed(4)}, ${endSec.toFixed(4)}, 'video')`);
            if (String(mv).indexOf('OK') !== 0) {
                log(`   ⚠️ [Titol·Sortida] moveToRange ha fallat (${mv}) → es treu la peça temporal`, 'WARN');
                try { await callJSX(`Clips.removeAt(${track}, ${tempStart.toFixed(4)}, 'video')`); } catch (eRm2) { }
                return false;
            }
            log(`      🔴 [Titol·Sortida] desaparició del gran → V${track} @ ${startSec.toFixed(2)}s→${endSec.toFixed(2)}s (mèdia ${inSec.toFixed(2)}→${(inSec + dur).toFixed(2)}s) [${mv}]`);
            // (2026-10-07) Verificació del retall: confirma que el clip mostra al timeline
            // EXACTAMENT el tram de mèdia [inSec, inSec+dur] (p. ex. 10:00→10:06).
            try {
                const chk = JSON.parse(await callJSX(`Clips.get(${track}, ${idx}, 'video')`));
                if (chk) log(`      🔎 [Titol·Sortida] verificació: start=${Number(chk.start).toFixed(2)} end=${Number(chk.end).toFixed(2)} inPoint=${Number(chk.inPoint).toFixed(2)} outPoint=${Number(chk.outPoint).toFixed(2)}`);
            } catch (eV) { }
            return true;
        },

        /**
         * _freezeTitulilloStill: Col·loca un CONGELAT (PNG estirat) del DARRER frame d'un
         * titulillo, de `startSec` a `endSec`, a la pista indicada.
         *
         * Tècnica (la mateixa que `_freezeTemaTitol`): s'insereix el titulillo en un TC
         * temporal llunyà (10:00), es captura un snapshot net amb el CTI a prop del seu FINAL,
         * es treu el clip temporal, s'importa el PNG al bin CHY i s'insereix ESTIRAT fins a
         * `endSec`. MAI llança: retorna `false` + WARN si el snapshot o la inserció fallen.
         *
         * (2026-10-01 · #128) Extret de `_fillTitulilloGaps` §2 per poder-lo reutilitzar en la
         * transició ENTRANT→SORTINT del CasB, que quedava sense congelat.
         * @param {{name:string, dur:number}} petit - Titulillo (wott) triat
         * @param {number} track - Pista de Tema-Títol
         * @param {number} startSec - IN del congelat (final de l'entrant)
         * @param {number} endSec - OUT del congelat (inici del revers / final de la zona)
         * @param {string} label - Etiqueta pel log
         * @returns {Promise<boolean>}
         */
        _freezeTitulilloStill: async function (petit, track, startSec, endSec, label) {
            const utils = getUtils();
            if (!petit || !petit.name || !(endSec > startSec + 0.02)) return false;
            // (2026-10-01 · #129) Zones temporals LLIURES de la pista: l'insert és un
            // overwriteClip i esborraria tot el material que cobrís (p. ex. el PNG estirat del
            // Tema-Títol gran, que ocupa el bloc sencer).
            const TEMP_TC = await this._v6FreeTC(track, Math.max(3, (petit.dur || 1) + 1));
            try {
                await callJSX(`Clips.insert('${utils.escape(petit.name)}', ${track}, ${TEMP_TC}, null, 'video')`);
                await utils.delay(300);
                const snapTC = TEMP_TC + Math.max(0.04, petit.dur - 0.05);
                await callJSX(`Timeline.set(${snapTC})`);
                await utils.delay(400);
                const folder = await callJSX("Context.folder()");
                // (2026-10-06) El congelat va per `_capturePng`: intenta `Render.snapshot` (via QE
                // `exportFramePNG`) i deixa `Render.frame` com a reserva, i VERIFICA que el PNG
                // s'hagi escrit (mida > 0). El 2026-10-05 es va donar la QE per morta per ERROR:
                // vegeu el bloc de `_capturePng` (línia ~376).
                const capBase = `${folder}\\Snapshots\\freeze_titulillo_${Date.now()}`;
                const cap = await this._capturePng(capBase, snapTC);
                const snapPath = cap.path;
                await callJSX(`Timeline.set(${startSec})`);
                // Treure el titulillo temporal (és a TEMP_TC)
                try { await callJSX(`Clips.removeAt(${track}, ${TEMP_TC}, 'video')`); } catch (eDel) { }
                if (cap.ok) {
                    const fName = snapPath.split("\\").pop();
                    await callJSX(`IO.importFiles('${utils.escape(JSON.stringify([snapPath]))}', 'CHY')`);
                    // (2026-10-01 · #129) COL·LOCACIÓ NO DESTRUCTIVA del congelat.
                    // El PNG és un STILL i el projecte li assigna la seva durada per defecte
                    // (~5 s). `Clips.insert` fa un overwriteClip de [start, start+5s):
                    // ESBORRAVA el TEMA-TÍTOL GRAN (que ja és a la pista, més a la dreta) i,
                    // a més, el seu `endSec` retallava l'ÚLTIM clip de la pista (el gran) →
                    // el gran quedava "tallat per l'inici". Mateixa tècnica que _repararClipsV7:
                    // inserir a un TC TEMPORAL llunyà i dur-lo al rang exacte amb
                    // `Clips.moveToRange` (reassigna start/end, NO fa overwriteClip → no
                    // trepitja cap clip veí).
                    // Zona temporal LLIURE per al PNG (l'insert d'un still ocupa ~5 s de projecte).
                    const TEMP_PNG = await this._v6FreeTC(track, 10);
                    await callJSX(`Clips.insert('${utils.escape(fName)}', ${track}, ${TEMP_PNG}, null, 'video')`);
                    await utils.delay(200);
                    let idxPng = -1;
                    try {
                        const clP = await getClipsLogic().getTrackClips(track, 'video');
                        for (let ci = 0; ci < clP.length; ci++) {
                            if (Math.abs(clP[ci].start - TEMP_PNG) < 0.5) { idxPng = ci; break; }
                        }
                    } catch (eIdx) { idxPng = -1; }
                    if (idxPng < 0) {
                        log(`   ⚠️ [Titol·Petit] Congelat: PNG temporal no trobat a ${TEMP_PNG.toFixed(2)}s → no es col·loca`, 'WARN');
                        return false;
                    }
                    const mv = await callJSX(`Clips.moveToRange(${track}, ${idxPng}, ${startSec.toFixed(4)}, ${endSec.toFixed(4)}, 'video')`);
                    if (String(mv).indexOf('OK') !== 0) {
                        log(`   ⚠️ [Titol·Petit] Congelat: moveToRange ha fallat (${mv}) → es treu el PNG temporal`, 'WARN');
                        try { await callJSX(`Clips.removeAt(${track}, ${TEMP_PNG}, 'video')`); } catch (eRm) { }
                        return false;
                    }
                    log(`      ${label} → V${track} @ ${startSec.toFixed(2)}s→${endSec.toFixed(2)}s (${(endSec - startSec).toFixed(2)}s) [${mv}]`);
                    return true;
                }
                log(`   ⚠️ [Titol·Petit] Snapshot del congelat fallit (${cap.res})`, 'WARN');
                return false;
            } catch (e) {
                log(`   ⚠️ [Titol·Petit] Congelat fallit: ${e.message}`, 'WARN');
                return false;
            }
        },

        /**
         * _fillTitulilloGaps (2026-09-22): "SEMPRE hi ha d'haver titulillo".
         *
         * Quan el Tema-Títol GRAN entra tard (el seu ítem és a mig bloc, cas TN_MIGDIA
         * 21/09: el gran anava a 107,88s), la pista de Tema-Títol (V5) queda BUIDA des de
         * l'inici del bloc fins a ell. Aquest mètode busca aquests buits i els omple amb la
         * identitat del programa:
         *
         *     [titulillo animat] → [congelat estirat] → [desaparició del gran] → [Tema-Títol gran]
         *
         *  - El titulillo és el Tema-Títol petit (~1s, qtrle amb alpha).
         *  - El congelat (PNG net del titulillo via `_capturePng`: `Render.snapshot` QE primer,
         *    `Render.frame` de reserva) permet ALLARGAR-LO fins al
         *    gran (mateixa mecànica que _freezeTemaTitol, amb el desplaçament = durada del
         *    titulillo en lloc de 8s).
         *  - (2026-10-07) La SORTIDA és la pròpia animació de DESAPARICIÓ del Wott del gran
         *    (`cfg.temaTitolExit`, 10:00→10:06 = 6 frames) — `_insertTemaTitolExit`. El revers ffmpeg del
         *    titulillo queda com a xarxa de seguretat.
         *  - (2026-09-22) El revers acaba al TC del MARCADOR de l'ítem (`Markers.get()` +
         *    prefix del nº), no a la posició calculada del gran.
         *
         * NOMÉS actua sobre ZONES BUIDES de V5: no trepitja cap clip existent.
         *
         * @param {Object} p - {struct, wottIdx, ttPlaced:[{placeTime}], clipStart, track, minSec, minGapSec}
         * @returns {Promise<number>} Nombre de buits omplerts
         */
        _fillTitulilloGaps: async function (p) {
            const utils = getUtils();
            const T = p.track;
            const MIN_FILL = (typeof p.minGapSec === 'number') ? p.minGapSec : 2.5;
            if (!p.ttPlaced || p.ttPlaced.length === 0) return 0;
            const petit = FASTPASS_UI.Logic.Project.pickTemaTitolPetit(p.struct, p.wottIdx, p.minSec);
            if (!petit || !(petit.dur > 0.05)) {
                log('   ℹ️ [Titol·Petit·cobertura] Cap titulillo petit al bin CHY: no es pot cobrir el buit.');
                return 0;
            }
            const durP = petit.dur;
            // (2026-10-07) Peça de SORTIDA = desaparició del PROPI Tema-Títol gran (vegeu
            // `_temaTitolExitCfg`). Substitueix el revers ffmpeg del titulillo.
            const exitCfg = this._temaTitolExitCfg();
            // (2026-09-22) 1 frame @25fps. El titulillo NO s'ha d'estirar més enllà de la seva
            // durada real (si s'estira, el darrer frame es veu buit i "desapareix" un moment) i
            // el congelat ha d'entrar EXACTAMENT on acaba el titulillo (1 frame abans de durP,
            // si no el buit s'allarga un frame més).
            const FRAME = 0.04;
            // (2026-09-22) INVERSIÓ PEREZOSA (vegeu _placeTemaTitolTransicions): el revers només
            // s'envia a invertir (ffmpeg) si el buit s'ha d'omplir de veritat.
            // (2026-10-01 · #129) I es fa a la PREPARACIÓ del buit: ABANS de col·locar la primera
            // peça (abans s'invertia entre el congelat i el revers, amb el muntatge a mig fer).
            let _revCache = null;
            const getRev = async () => {
                if (_revCache === null) _revCache = await this._ensureReversedTitolPetit(petit);
                return _revCache;
            };
            // (2026-10-01 · #129) Durada REAL (ffprobe) alineada a la rejilla de frames: `ceil`
            // garanteix que el clip MAI no sigui més curt que el seu mèdia → el seu overwrite no
            // pot anar més enllà del pla (ni pisar el Tema-Títol gran).
            const ffLogic = (window.FASTPASS_UI && window.FASTPASS_UI.Logic) ? window.FASTPASS_UI.Logic.FFmpeg : null;
            const snapDur = (sec) => Math.max(1, Math.ceil(sec / FRAME - 1e-6)) * FRAME;
            const realDurOf = async (path, estDur) => {
                try {
                    if (!path || !ffLogic || typeof ffLogic.getMediaDuration !== 'function') return estDur;
                    const r = await ffLogic.getMediaDuration(path);
                    if (r && r.ok && r.duration > 0.05) {
                        const d = snapDur(r.duration);
                        log(`   📏 [Titol·Petit·cobertura] Durada REAL de ${String(path).split(/[\\/]/).pop()}: ${r.duration.toFixed(3)}s → ${d.toFixed(2)}s (estimada ${estDur.toFixed(2)}s)`);
                        return d;
                    }
                } catch (eD) { }
                return estDur;
            };
            let _petitDurCache = null;
            const getPetitDur = async () => {
                if (_petitDurCache === null) _petitDurCache = await realDurOf(petit.path, snapDur(durP));
                return _petitDurCache;
            };

            let clipsV5 = [];
            try { clipsV5 = (await getClipsLogic().getTrackClips(T, 'video')) || []; } catch (eC) { clipsV5 = []; }
            clipsV5 = clipsV5.slice().sort((a, b) => a.start - b.start);

            // (2026-09-22) MARCADORS: el titulillo de SALIDA (revers) ha d'acabar al TC del
            // marcador de l'ítem (emparellat pel PREFIX del nº, mateixa normalització que
            // placeChyronTitol) i no a la posició calculada del Tema-Títol gran (que és
            // marcador + tc del wott). Així la sortida mor just al marcador i el gran hi entra.
            let markersById = {}, markersByBase = {};
            try {
                const mRaw = await callJSX('Markers.get()');
                const mAll = mRaw ? JSON.parse(mRaw) : [];
                // (2026-09-29) {0,5} per reconèixer sufíxs de 4-5 lletres ("01lead"), com a
                // placeChyronTitol: el marcador propi de l'ítem ha de manar sobre la base.
                const STRUCT_RE = /^\d+[a-z]{0,5}\s*-\s*.+$/i;
                for (const m of mAll) {
                    if (!STRUCT_RE.test((m.comments || '').trim())) continue;
                    const norm = FASTPASS_UI.Logic.Project.normItemId(String(m.comments || "").split('-')[0].trim());
                    if (!norm) continue;
                    if (markersById[norm] === undefined || m.time < markersById[norm]) markersById[norm] = m.time;
                    const bm = norm.match(/^\d+/);
                    const base = bm ? bm[0] : norm;
                    if (markersByBase[base] === undefined || m.time < markersByBase[base]) markersByBase[base] = m.time;
                }
            } catch (eMk) { }
            const markerTimeForItem = (itemId) => {
                const norm = FASTPASS_UI.Logic.Project.normItemId(itemId);
                const bm = norm.match(/^(\d+)(.*)$/);
                const base = bm ? bm[1] : norm;
                const baseSuf = bm ? bm[2] : '';
                // (2026-09-29) Mateixa guarda que placeChyronTitol::markerTimeFor: el
                // respatller per BASE no pot prendre el marcador d'un ALTRE ítem de la
                // mateixa base (01lead ↔ 01chy), o el revers del titulillo s'aniria a
                // tancar contra el marcador del chyron.
                const baseTakenByOther = Object.keys(markersById).some(k => {
                    const km = k.match(/^(\d+)(.*)$/);
                    return km && km[1] === base && km[2] !== '' && km[2] !== baseSuf;
                });
                // El marcador a 0 no és cap posició d'emissió real (vegeu placeChyronTitol).
                if (markersById[norm] !== undefined && markersById[norm] >= 0.5) return markersById[norm];
                if (markersByBase[base] !== undefined && !baseTakenByOther && markersByBase[base] >= 0.5) return markersByBase[base];
                return null;
            };

            // Insert + fixar el final (l'endSec de Clips.insert pot acabar al darrer clip de la pista)
            const insEnd = async (name, start, end, label) => {
                const ins = await callJSX(`Clips.insert('${utils.escape(name)}', ${T}, ${start.toFixed(4)}, null, 'video')`);
                const e2 = await callJSX(`Clips.endAt(${T}, ${start.toFixed(4)}, ${end.toFixed(4)}, 'video')`);
                log(`      ${label} → V${T} @ ${start.toFixed(2)}s→${end.toFixed(2)}s [ins=${ins} · end=${e2}]`);
            };

            let fets = 0;
            const ordenats = p.ttPlaced.slice().sort((a, b) => a.placeTime - b.placeTime);
            for (let i = 0; i < ordenats.length; i++) {
                const ttTime = ordenats[i].placeTime;
                // (2026-09-22) El revers (titulillo de SALIDA) acaba al TC del MARCADOR de
                // l'ítem; si l'ítem no té marcador propi es manté la posició del gran.
                const mkTime = markerTimeForItem(ordenats[i].item);
                const endZone = (mkTime !== null) ? mkTime : ttTime;
                const zoneEnd = Math.max(endZone, ttTime);   // el congelat mai deixa forat davant del gran
                // Inici del buit = final de l'últim clip de V5 que comença abans del gran
                let gapStart = p.clipStart + 0.40;
                for (let ci = 0; ci < clipsV5.length; ci++) {
                    const c = clipsV5[ci];
                    if (c.start < ttTime - 0.05 && c.end > gapStart) gapStart = c.end;
                }
                const gapDur = zoneEnd - gapStart;
                if (gapDur < MIN_FILL) {
                    log(`   ℹ️ [Titol·Petit·cobertura] Buit de ${gapDur.toFixed(2)}s abans del gran ${i + 1}: no s'omple (mínim ${MIN_FILL}s).`);
                    continue;
                }
                // (2026-10-01 · #129) PREPARAR EL BUIT ABANS DE COL·LOCAR RES: primer tot el que
                // depèn de ffmpeg (durada REAL del titulillo i, si el buit admet revers, la
                // inversió + la durada REAL del .mov invertit) i NOMÉS DESPRÉS el muntatge,
                // sempre d'esquerra a dreta. Amb l'estimació del manifest el revers quedava 1
                // frame desplaçat (i podia entrar dins del gran si l'estimació era curta).
                const petitDur = await getPetitDur();
                // (2026-10-07) SORTINT = peça de desaparició del propi Tema-Títol gran
                // (cfg.temaTitolExit). Ja no es prepara cap inversió ffmpeg aquí.
                const exitDur = snapDur(exitCfg.durSec);
                const reverseStart = Math.ceil((endZone - exitDur) / FRAME - 1e-6) * FRAME;
                const sortMax = (mkTime !== null) ? mkTime : ttTime;
                const sortPosOk = (sortMax - exitDur) > gapStart + 0.20;
                log(`   🕳️ [Titol·Petit·cobertura] Buit de ${gapDur.toFixed(2)}s a V${T} (${gapStart.toFixed(2)}s→${zoneEnd.toFixed(2)}s): titulillo + congelat + desaparició` +
                    ` · sortida fins a ${sortMax.toFixed(2)}s (${mkTime !== null ? 'marcador de l\'ítem ' + ordenats[i].item : 'el gran'})` +
                    (sortPosOk ? '' : ' [sense espai per a la sortida]') + '.');

                // 1) Titulillo ANIMAT a l'inici del buit. (2026-10-07) L'OUT va 1 frame ABANS
                // del final teòric: `petitDur` ve de `ceil` → el clip durava 1 frame MÉS que
                // el mèdia i aquell darrer frame eixia buit. El congelat comença EXACTAMENT
                // aquí i absorbeix aquell frame.
                const entrantOut = gapStart + petitDur - FRAME;
                await insEnd(petit.name, gapStart, entrantOut, '🟢 [cobertura] titulillo ENTRANT');
                const freezeStart = entrantOut;
                // SORTIDA (desaparició del gran): el seu IN (`reverseStart`, alineat a la rejilla
                // de frames a partir de la durada de config) i el final enganxat EXACTAMENT al
                // Tema-Títol gran (endZone).

                // 2) CONGELAT: frame congelat del FINAL del titulillo, estirat fins al final de la
                //    zona (el revers el retallarà pel davant).
                //    (2026-10-01 · #128) Mateixa mecànica que la transició ENTRANT→SORTINT del
                //    CasB → delegat a `_freezeTitulilloStill` per no duplicar lògica.
                if ((zoneEnd - freezeStart) > 0.40) {
                    await this._freezeTitulilloStill(petit, T, freezeStart, zoneEnd, '🧊 [cobertura] congelat estirat');
                }

                // 3) SORTINT (desaparició del gran) just abans del Tema-Títol gran (transició).
                //    (2026-09-22) Acaba a endZone = TC del MARCADOR de l'ítem.
                //    (2026-10-07) És un retall del PROPI gran (cfg.temaTitolExit); el revers
                //    ffmpeg queda només com a xarxa de seguretat (`useReverseFallback`).
                if (reverseStart > gapStart + 0.20) {
                    const bigName = ordenats[i].name;
                    const okExit = (exitCfg.enabled && bigName)
                        ? await this._insertTemaTitolExit(bigName, T, reverseStart, endZone, exitCfg.atSec)
                        : false;
                    if (!okExit && exitCfg.fallbackRev) {
                        const rv = await getRev();
                        if (rv.ok) await insEnd(rv.name, reverseStart, endZone, '🔴 [cobertura] titulillo SORTINT (revers ffmpeg)');
                        else log('   ⚠️ [Titol·Petit·cobertura] Sense peça de desaparició ni versió invertida per al gran', 'WARN');
                    }
                }
                fets++;
            }
            if (fets > 0) log(`   ✨ [Titol·Petit·cobertura] ${fets} buit(s) de V${T} omplert(s) amb titulillo`, 'INFO');
            return fets;
        },

        _findClipAtTime: async function(timeSec) {
            const clips = await getClipsLogic().getTrackClips(1, "video");
            for (const cl of clips) {
                if (cl.start <= timeSec && cl.end > timeSec) return cl;
            }
            return null;
        },

        /**
         * _extractMarkerTitle: Extrau el TÍTOL del comentari d'un marcador estructural.
         * Format del comentari: "num - títol" → retorna la part després de " - ".
         */
        _extractMarkerTitle: function (comment) {
            var c = String(comment || '').trim();
            var dash = c.indexOf(' - ');
            if (dash < 0) return c;
            return c.substring(dash + 3).trim();
        },

        /**
         * _isPresenterTitle: Determina si el títol del primer ítem del bloc correspon a
         * una peça de PLATÓ/presentació (hi ha presentador en càmera). Criteri: el títol
         * comença per tokens de presentació (OFF / OFD / DONA PAS / CONN / INTRO /
         * DIRECTE / BON DIA / SALUTACIÓ...). Els blocs de NOMÉS vídeo no els tenen i,
         * per tant, NO han de rebre chyron de presentador.
         */
        _isPresenterTitle: function (title) {
            if (!title) return false;
            var clean = String(title).toUpperCase()
                .replace(/[ÁÀ]/g, 'A').replace(/[ÉÈ]/g, 'E').replace(/[ÍÌ]/g, 'I')
                .replace(/[ÓÒ]/g, 'O').replace(/[ÚÙ]/g, 'U')
                .replace(/[^A-Z0-9]/g, '');
            var tokens = [
                'OFF', 'OFD', 'OFT', 'DONAPAS', 'DONA', 'CONNEXIO', 'CONN',
                'INTRO', 'DIRECTE', 'BONDIA', 'BONDIADIA', 'SALUTACIO'
            ];
            for (var i = 0; i < tokens.length; i++) {
                if (clean.indexOf(tokens[i]) === 0) return true;
            }
            return false;
        },

        /**
         * _isPresenterLine: Indica si una línia/ítem de l'escaleta correspon a una peça
         * de PLATÓ/presentació (la presentadora surt en càmera). Criteris:
         *  - num amb sufix de plató: i, dp, dir, f, off (els vídeos no en tenen)
         *  - o el títol comença per tokens de presentació (OFF/DONA PAS/CONN/INTRO...)
         *
         * (2026-09-29) REGLA (usuari): el sufix "lead" JA NO compta com a plató. Un ítem
         * "01lead" és l'entradilla/arrancada del bloc (locució sobre imatge amb el seu
         * Tema-Títol), NO una peça amb presentadora en càmera: no porta chyron de
         * conductor. Amb el bloc TNV_V1 "LEAD DIAGONAL TALLADA" (29/09) el "lead" feia que
         * el conductor s'inserís a 0.40s sobre un bloc que obre amb un chyron de grafisme.
         */
        _isPresenterLine: function (line) {
            if (!line) return false;
            var num = String(line.num || '').toLowerCase().trim();
            var m = num.match(/^\d+(.*)$/);
            if (m && m[1]) {
                var suf = m[1];
                if (suf === 'i' || suf === 'dp' || suf === 'dir' || suf === 'f' || suf === 'off') {
                    return true;
                }
            }
            return this._isPresenterTitle(line.titol) || this._isPresenterTitle(line.tipus || line.font);
        },

        /**
         * _ensureConductorInProject: Garanteix que el conductor TRIAT al desplegable
         * #conductor estigui al projecte i en retorna el NOM REAL de l'ítem (és el que
         * necessita `Clips.insert`).
         *
         * (2026-09-28) El desplegable llista els .mov de la biblioteca del NAS
         * (`cfg.rutas.conductors`), NO ítems del projecte: en un projecte nou el
         * conductor encara no s'ha importat mai → `Clips.insert` tornava
         * ERR_ITEM_NOT_FOUND i el rètol no es col·locava (casos TNV V3 28/09:
         * "Conduct_TNM_Raquel Sans Duran.mov" i "Conduct_Toni Cruanyes.mov").
         * SEGONA CAUSA (28/09, mesurada al log de les 11:19:20): la ruta de
         * `rutas.conductors` apuntava a una carpeta del NAS on aquell nom NO
         * existeix → Premiere ignora una ingesta amb ruta inexistent SENSE error
         * (importFiles no llança mai) i el fitxer no arriba al projecte.
         * Ordre de resolució (mana SEMPRE el valor del desplegable = l'operador):
         *   1. Ítem ja al projecte (nom exacte, sense extensió o equivalent).
         *   2. Si no, es resol el NOM REAL dins de cfg.rutas.conductors (el
         *      desplegable pot dur noms antics) i s'importa amb Utils.importList
         *      SONDEJANT el projecte fins que hi apareix: la ingesta de Premiere
         *      és ASÍNCRONA (un delay fix de 500 ms donava un ❌ fals sempre).
         *   3. Qualsevol "Conduct*" ja al projecte (WARN: pot no ser el triat).
         *   4. null → res insertable (l'operador ha de revisar el NAS).
         * @param {string|null} domValue - valor del desplegable #conductor
         * @returns {Promise<string|null>} nom real de l'ítem al projecte
         */
        _ensureConductorInProject: async function (domValue) {
            const utils = getUtils();
            const cfg = FASTPASS_UI.Config.get();
            const dir = String(cfg.rutas.conductors || '');

            // Clau de comparació de noms de conductor: treu el prefix "Conduct[_]",
            // el token de programa (TNC/TNCS/TNM/TNV/MAT/METEO/NOUS), accents,
            // extensió i espais/guions baixos → "Conduct_Toni Cruanyes.mov" i
            // "Conduct_TNV_Toni Cruanyes.mov" resulten la MATEIXA persona.
            // (2026-09-28) Imprescindible: Profile.json i la llista de programa fan
            // servir noms antics (sense token) i la carpeta del NAS pot tenir els
            // moderns (i a l'inrevés).
            const norm = (s) => String(s || '')
                .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
                .replace(/\.[a-z0-9]{1,5}$/i, '')
                .replace(/^conduct[_ ]?/i, '')
                .replace(/^(tncs|tnc|tnv|tnm|mat|meteo|nous)[_ ]/i, '')
                .replace(/[\s_]+/g, ' ')
                .trim()
                .toLowerCase();

            // Programa actiu: entre candidats equivalents es prefereix el del programa.
            let progToken = '';
            try {
                const elProg = document.getElementById('programa');
                const pd = elProg ? cfg.mapeoProgramas[elProg.value] : null;
                progToken = (pd && pd.wott) ? String(pd.wott).toLowerCase() : '';
            } catch (eP) { }

            const pick = (names, want) => {
                if (!want) return null;
                const wl = String(want).toLowerCase();
                const key = norm(want);
                const exact = names.find(n => n.toLowerCase() === wl);
                if (exact) return exact;
                const noExt = names.find(n =>
                    n.toLowerCase().replace(/\.[a-z0-9]{1,5}$/i, '') === wl.replace(/\.[a-z0-9]{1,5}$/i, ''));
                if (noExt) return noExt;
                const same = names.filter(n => norm(n) === key);
                if (same.length === 0) return null;
                const pref = progToken ? same.find(n => n.toLowerCase().indexOf('_' + progToken + '_') !== -1) : null;
                return pref || same[0];
            };

            const projectNames = async () => {
                try {
                    const raw = await callJSX("FASTPASS.Project.items('')");
                    return JSON.parse(raw || '[]').map(i => String(i.name || ''));
                } catch (eIt) {
                    log(`   ⚠️ [Conductor] no s'han pogut llegir els items del projecte: ${eIt.message}`, 'WARN');
                    return [];
                }
            };

            // ── 1. Ja és al projecte? ─────────────────────────────────────────────
            let names = await projectNames();
            const direct = pick(names, domValue);
            if (direct) return direct;

            // ── 2. Resoldre el nom REAL a la biblioteca del NAS ───────────────────
            // Una ruta inexistent fa que Premiere IGNORI la ingesta sense cap error
            // (importFiles no llança), per això aquí es valida abans d'importar.
            let fileName = String(domValue);
            let inNas = false;
            try {
                const res = window.cep.fs.readdir(dir);
                if (res && res.err === 0 && res.data) {
                    const movs = res.data.map(n => utils._decodeName(n))
                        .filter(n => n.toLowerCase().indexOf('.mov') !== -1);
                    const real = pick(movs, domValue);
                    if (real) { fileName = real; inNas = true; }
                    else log(`   ⚠️ [Conductor] "${domValue}" no és a ${dir} (${movs.length} .mov llistats).`, 'WARN');
                } else {
                    log(`   ⚠️ [Conductor] cep.fs.readdir err=${res ? res.err : 'null'} a ${dir}`, 'WARN');
                }
            } catch (eR) {
                log(`   ⚠️ [Conductor] No s'ha pogut llistar ${dir}: ${eR.message}`, 'WARN');
            }
            if (!inNas) {
                // Sense llistat fiable → comprovar l'existència del fitxer tal qual.
                try {
                    inNas = (window.cep.fs.stat(dir + fileName).err === 0)
                        || (window.cep.fs.stat((dir + fileName).replace(/\\/g, '/')).err === 0);
                } catch (eS) { inNas = false; }
            }

            if (!inNas) {
                log(`   ❌ [Conductor] El fitxer no existeix a la biblioteca: ${dir}${fileName}`, 'ERROR');
                log(`      (ruta = cfg.rutas.conductors · revisa el NAS o el valor del desplegable)`, 'ERROR');
            } else {
                if (fileName !== domValue) {
                    log(`   🔧 [Conductor] Desplegable "${domValue}" → fitxer real "${fileName}"`);
                }
                const nasPath = (dir + fileName).replace(/\\/g, '/');
                log(`   📥 [Conductor] "${fileName}" no és al projecte → important del NAS: ${nasPath}`);
                try {
                    await utils.importList([nasPath], 'root');
                } catch (eImp) {
                    log(`   ⚠️ [Conductor] Import fallit: ${eImp.message}`, 'WARN');
                }
                // (2026-09-28) La ingesta de Premiere és ASÍNCRONA: importFiles retorna
                // de seguida i un .mov de ~200 MB per xarxa triga molt. Un únic delay
                // de 500 ms donava un ❌ fals sempre → cal sondejar el projecte.
                const MAX_WAIT_MS = 20000;
                for (let waited = 500; waited <= MAX_WAIT_MS; waited += 500) {
                    await utils.delay(500);
                    names = await projectNames();
                    const imported = pick(names, fileName);
                    if (imported) {
                        log(`   ✅ [Conductor] Importat al projecte: "${imported}" (${(waited / 1000).toFixed(1)}s)`);
                        return imported;
                    }
                    if (waited % 5000 === 0) {
                        log(`   ⏳ [Conductor] Esperant la ingesta de "${fileName}"... (${(waited / 1000).toFixed(0)}s)`);
                    }
                }
                log(`   ⚠️ [Conductor] La ingesta de "${fileName}" no ha acabat en ${MAX_WAIT_MS / 1000}s.`, 'WARN');
            }

            // ── 3. Últim recurs: qualsevol conductor que JA sigui al projecte ────
            const anyConduct = names.find(n => n.indexOf('Conduct') === 0);
            if (anyConduct) {
                log(`   ⚠️ [Conductor] Usant "${anyConduct}" (present al projecte; pot NO ser el triat)`, 'WARN');
                return anyConduct;
            }
            log(`   ❌ [Conductor] Sense conductor insertable (ni al projecte ni a ${dir}${fileName})`, 'ERROR');
            return null;
        },

        placeChyronConductor: async function () {
            if (!(await getUtils().validateActiveSequence())) return;
            const cfg = FASTPASS_UI.Config.get();
            const T_CHY = cfg.tracks.video.chyrons;
            const stateStruct = FASTPASS_UI.State.structure;
            const struct = (stateStruct && stateStruct.length > 0)
                ? stateStruct
                : await this._getStructureFromMarkers();
            const structureById = {};
            for (const entry of struct || []) { if (entry.id) structureById[entry.id] = entry; }

            const conductorSelect = document.getElementById('conductor');
            const domConductor = conductorSelect ? conductorSelect.value : null;
            if (!domConductor) {
                log("⚠️ [Conductor] No hi ha conductor seleccionat al desplegable.", "WARN");
                getUtils().status("Selecciona un conductor", "warn");
                return;
            }
            // (2026-09-28) El desplegable llista els .mov del NAS (biblioteca de conductors),
            // NO ítems del projecte → aquí es garanteix que el conductor TRIAT hi sigui
            // (important-lo si cal) abans d'intentar inserir res.
            const conductorFile = await this._ensureConductorInProject(domConductor);
            if (!conductorFile) {
                log("⚠️ [Conductor] Sense fitxer de conductor insertable. Ometent.", "WARN");
                getUtils().status("⚠️ Conductor no disponible", "warn");
                return;
            }
            log(`👤 [Conductor] Fitxer: ${conductorFile}`);

            // Constants
            const MARGEN_INICIO = 0.40;         // 0:10
            const DUR_TEMA_TITOL = 6.24;        // 6:06

            try {
                const markersRaw = await callJSX('Markers.get()');
                const allMarkers = markersRaw ? JSON.parse(markersRaw) : [];
                const STRUCTURAL_RE = /^\d+[a-z]{0,3}\s*-\s*.+$/i;
                const structuralMarkers = allMarkers.filter(m => STRUCTURAL_RE.test((m.comments || "").trim()));
                structuralMarkers.sort((a, b) => a.time - b.time);

                // ── Trobar el MARCADOR de PLATÓ on col·locar el conductor ─────────
                // (2026-09-23) Regla actual: el primer MARCADOR del timeline que sigui d'un
                // ítem de plató (intro/donapas/off/directe/connexió…). L'escaleta del bloc
                // (AssemblyContext) es fa servir només per identificar quin ítem és de plató
                // i com a respatller quan el plató no té marcador propi.
                const assembly = window.FASTPASS_UI.Core && window.FASTPASS_UI.Core.AssemblyContext;
                let linesEsc = null;
                let clipsV1 = [];
                if (assembly && typeof assembly.loadAssemblyContext === 'function') {
                    try {
                        const ctxData = await assembly.loadAssemblyContext();
                        if (ctxData && ctxData.lines && ctxData.lines.length > 0) {
                            linesEsc = ctxData.lines;
                            try { clipsV1 = await getClipsLogic().getTrackClips(1, "video"); } catch (eC) { }
                        }
                    } catch (eCtx) {
                        log('⚠️ [Conductor] No s\'ha pogut carregar el context d\'assemblatge: ' + eCtx.message);
                    }
                }

                let itemPlato = null;
                let isFirstItem = false;
                let targetId = null;
                let targetTime = null;

                if (linesEsc && linesEsc.length > 0) {
                    // ── (2026-09-23) REGLA (indicada per l'usuari): el conductor va al PRIMER
                    // MARCADOR DEL TIMELINE que sigui d'un ítem de PLATÓ (intro / donapas / off /
                    // directe / connexió…). Es mira EL QUE HI HA AL TIMELINE (els marcadors, que
                    // són el resultat del processat F1-F7) i NO la posició de l'ítem a l'escaleta:
                    // els grafismes inicials (P2 foto / P2 MAPA / GF…) acaben generant marcador
                    // DINS de l'ítem intro, de manera que al timeline la intro ÉS el 1r ítem del
                    // bloc. Cobreix també el cas donapas i altres conductors de plató que no obren
                    // l'escaleta. (Abans s'exigia que el plató fos el 1r ítem de l'escaleta ✗.)
                    for (let li = 0; li < linesEsc.length; li++) {
                        if (this._isPresenterLine(linesEsc[li])) { itemPlato = linesEsc[li]; break; }
                    }
                    // Mapa num → línia de l'escaleta: per saber si l'ítem d'un marcador és de plató.
                    const lineByNum = {};
                    for (let li2 = 0; li2 < linesEsc.length; li2++) {
                        const ln = linesEsc[li2];
                        const k = String((ln && ln.num) || '').trim().toLowerCase();
                        if (k && !lineByNum[k]) lineByNum[k] = ln;
                    }
                    const esPlatoMarker = (mk) => {
                        const pre = String((mk.comments || '')).split('-')[0].trim();
                        if (!pre) return false;
                        const l = lineByNum[pre.toLowerCase()];
                        if (l && this._isPresenterLine(l)) return true;
                        // Guarda pel TÍTOL del marcador (intro / DONA PAS / OFF / DIRECTE / CONN…)
                        return this._isPresenterTitle(this._extractMarkerTitle(mk.comments || ''));
                    };
                    let mkPlato = null;
                    for (let mi = 0; mi < structuralMarkers.length; mi++) {
                        if (esPlatoMarker(structuralMarkers[mi])) { mkPlato = structuralMarkers[mi]; break; }
                    }
                    if (mkPlato) {
                        targetId = String((mkPlato.comments || '').split('-')[0]).trim();
                        targetTime = mkPlato.time;
                        // És l'ítem que OBRE el bloc si no hi ha cap marcador estructural anterior.
                        isFirstItem = !structuralMarkers.some(function (sm) { return sm.time < mkPlato.time - 0.05; });
                        log(`🎙️ [Conductor] 1r marcador de PLATÓ al timeline: ${targetId} @ ${targetTime.toFixed(2)}s` +
                            (isFirstItem ? ' (OBRE el bloc)' : '') +
                            (itemPlato ? ' · plató de l\'escaleta: ' + String(itemPlato.num || '?') : ' · cap plató a l\'escaleta'));
                    } else if (itemPlato) {
                        // (2026-09-29) REGLA (usuari): sense MARCADOR de l'ítem de plató al
                        // timeline NO es col·loca conductor. Abans hi havia un respatller que
                        // l'inseria a l'inici del bloc: amb el bloc TNV_V1 "LEAD DIAGONAL
                        // TALLADA" (un 01lead sense càmera + un marcador de chyron "01chy"
                        // del GF) el conductor queia a 0.40s sense cap marcador que el
                        // demanés (fals positiu). El Tema-Títol ja va a l'inici del bloc
                        // per _blockStartTime (CasA).
                        targetId = String(itemPlato.num || '').trim();
                        log(`⏭️ [Conductor] L'ítem de plató "${targetId}" no té marcador propi al timeline → conductor omès (cal marcador de l'ítem).`, 'WARN');
                        getUtils().status('Sense marcador de plató: conductor omès', 'warn');
                        return;
                    } else {
                        log('⏭️ [Conductor] Cap ítem de plató (intro/donapas/off/directe...) ni als marcadors ni a l\'escaleta. Ometent conductor.', 'WARN');
                        getUtils().status('Bloc sense presentador: conductor omès', 'warn');
                        return;
                    }
                } else {
                    // ── Fallback: només marcadors (guarda per títol) ──
                    if (structuralMarkers.length === 0) {
                        log("⚠️ [Conductor] No hi ha marcadors estructurals.", "WARN");
                        return;
                    }
                    const firstMarker = structuralMarkers[0];
                    targetId = (firstMarker.comments || "").split("-")[0].trim();
                    targetTime = firstMarker.time;
                    isFirstItem = true;
                    const firstTitle = this._extractMarkerTitle(firstMarker.comments || "");
                    if (!this._isPresenterTitle(firstTitle)) {
                        log(`⏭️ [Conductor] Primer ítem (${targetId}) NO és de plató: "${firstTitle || '(sense títol)'}". Ometent conductor.`, "WARN");
                        getUtils().status("Bloc sense presentador: conductor omès", "warn");
                        return;
                    }
                    log(`[Conductor] (fallback marcadors) ítem de plató: ${targetId} @ ${targetTime.toFixed(2)}s`);
                }

                // Calcular posició del conductor
                let conductTime;

                // ── Posició REAL del Tema-Titol de plató (2026-09-16) ───────────
                // (2026-09-22) placeChyronTitol col·loca ara el Tema-Titol a **marcador de
                // l'ítem + 0** (l'IN del clip va exactament al marcador; el tc del nom del
                // wott s'IGNORA), i el conductor ha d'anar JUST DESPRÉS d'ell.
                // Abans la regla era "marcador + tc del nom" (01i: 0.00 + 1.00 = 1.00s).
                // Si l'ítem de plató NO té marcador propi, el Tema-Títol va a l'inici del bloc
                // (0.40s) i el conductor entra a 6.64s (6:16), no a 7.24s (7:06).
                let ttPlaceTime = null;
                let ttHasRealMarker = false;
                try {
                    const idxTT = await FASTPASS_UI.Logic.Project.getWottIndex();
                    const minTT = (typeof cfg.temaTitolMinSec === 'number') ? cfg.temaTitolMinSec : 4.0;
                    const ttList = FASTPASS_UI.Logic.Project.pickTemaTitols(struct, idxTT, minTT);
                    const normTarget = FASTPASS_UI.Logic.Project.normItemId(targetId);
                    for (let tti = 0; tti < ttList.length; tti++) {
                        if (FASTPASS_UI.Logic.Project.normItemId(ttList[tti].item) !== normTarget) continue;
                        const tcSecTT = getUtils().timeToSeconds(ttList[tti].tc || "000000");
                        ttPlaceTime = targetTime;   // (2026-09-22) el gran va EXACTAMENT al marcador
                        // (2026-09-22) Amb marcador propi (>= 0.5s) el conductor va JUST DESPRES del
                        // Tema-Titol real. Sense marcador propi el Tema-Titol anira a l'INICI DEL BLOC
                        // (0.40s), aixi que el conductor ha d'anar a inicI del bloc + 6.24 = 6.64s (6:16)
                        // en lloc de 1.00 + 6.24 = 7.24s (7:06).
                        ttHasRealMarker = (targetTime >= 0.5);
                        if (!ttHasRealMarker) log("   [Conductor] L'item de plato no te marcador propi: el Tema-Titol va a l'inici del bloc i el conductor NO el seguira", 'WARN');
                        log(`🎯 [Conductor] Tema‑Titol de plató "${String(ttList[tti].name).substring(0, 40)}" @ ${ttPlaceTime.toFixed(2)}s (marcador ${targetTime.toFixed(2)} · tc del wott ${tcSecTT.toFixed(2)}s ignorat)`);
                        break;
                    }
                } catch (eTT) {
                    log(`⚠️ [Conductor] Sense Tema‑Titol de plató llegible: ${eTT.message}`);
                }

                if (isFirstItem) {
                    // Primer item: localitzar el segment del clip del bloc actiu a la
                    // pista MP4 (v_mp4=1, on hi ha el clip del bloc, ex: TNV_V2_CLIP.mp4)
                    // que conte targetTime. Abans s'usava clips[0] (primer segment del
                    // timeline complet, nomes valid quan el bloc esta aillat per TROSEJA).
                    const clips = await getClipsLogic().getTrackClips(1, "video");
                    let blockClip = null;
                    for (const cl of clips) {
                        if (cl.start <= targetTime && cl.end > targetTime) { blockClip = cl; break; }
                    }
                    if (!blockClip) {
                        for (const cl of clips) {
                            if (cl.start >= targetTime - 0.05) { blockClip = cl; break; }
                        }
                    }
                    if (!blockClip && clips.length > 0) blockClip = clips[clips.length - 1];
                    const clipStart = blockClip ? blockClip.start : (clips.length > 0 ? clips[0].start : 0);
                    const clipEnd = blockClip ? blockClip.end : (clips.length > 0 ? clips[0].end : targetTime + 10);
                    const margenDisponible = clipEnd - clipStart;
                    const MIN_MARGEN = MARGEN_INICIO + DUR_TEMA_TITOL + 4.40; // ~11.04s

                    if (ttPlaceTime !== null && ttHasRealMarker && (clipEnd - (ttPlaceTime + DUR_TEMA_TITOL)) >= 0.5) {
                        // Cas A: just després del Tema‑Titol REAL
                        conductTime = ttPlaceTime + DUR_TEMA_TITOL;
                        log(`📌 [Conductor·CasA] Després del Tema‑Titol real: ${ttPlaceTime.toFixed(2)} + ${DUR_TEMA_TITOL.toFixed(2)} → @ ${conductTime.toFixed(2)}s`);
                    } else if (margenDisponible >= MIN_MARGEN) {
                        conductTime = clipStart + MARGEN_INICIO + DUR_TEMA_TITOL;
                        log(`📌 [Conductor·CasA·clàssic] Marge suficient (${margenDisponible.toFixed(2)}s ≥ ${MIN_MARGEN.toFixed(2)}s): Conductor @ ${conductTime.toFixed(2)}s`);
                    } else {
                        conductTime = clipStart + MARGEN_INICIO;
                        log(`📌 [Conductor·CasB] Marge insuficient (${margenDisponible.toFixed(2)}s < ${MIN_MARGEN.toFixed(2)}s): Conductor @ ${conductTime.toFixed(2)}s`);
                    }
                } else if (ttPlaceTime !== null && ttHasRealMarker) {
                    conductTime = ttPlaceTime + DUR_TEMA_TITOL;
                    log(`📌 [Conductor] Després del Tema‑Titol real (no primer ítem): @ ${conductTime.toFixed(2)}s`);
                } else {
                    conductTime = targetTime + MARGEN_INICIO;
                    log(`📌 [Conductor] No és el primer: Conductor @ marcador+0:10 = ${conductTime.toFixed(2)}s`);
                }
                log(`📐 [Conductor] instant base per als chyrons següents: ${conductTime.toFixed(2)}s`);

                // Col·locar conductor
                const escapedName = getUtils().escape(conductorFile);
                const insertRes = await callJSX(`Clips.insert('${escapedName}', ${T_CHY}, ${conductTime}, null, 'video')`);
                log(`   [Conductor] Resultat insert: ${insertRes}`);
                if (String(insertRes).indexOf('ERR') === 0) {
                    // (2026-09-28) ABANS es reportava "✅ col·locat" igualment (fals positiu): el
                    // conductor no s'inseria i ningú no se n'adonava fins a revisar el timeline.
                    log(`   ❌ [Conductor] NO col·locat: ${insertRes} ("${conductorFile}" @ ${conductTime.toFixed(2)}s, V${T_CHY})`, 'ERROR');
                    getUtils().status(`⚠️ Conductor NO col·locat (${insertRes})`, "warn");
                } else {
                    log(`   ✅ [Conductor] "${conductorFile}" → V${T_CHY} @ ${conductTime.toFixed(2)}s`);
                    getUtils().status("Conductor col·locat", "exito");
                }

            } catch (e) { getUtils().handleError(e, "Conductor"); }
        },

        placeChyronLloc: async function () {
            await this._placeChyronsByType(
                c => c.name.includes("Lloc") || c.name.includes("Data") || (c.rol || '').toUpperCase() === "LLOCDATA",
                (c, cfg) => [cfg.tracks.video.llocdata, cfg.tracks.video.lloc, cfg.tracks.video.chyrons],
                "Lloc"
            );
        },

        placeChyronNom: async function () {
            // (2026-09-21) NOM-CARREC → SEMPRE V6. S'ha ELIMINAT la pista V7 com a
            // alternativa: el nom-càrrec no pot acabar mai a la pista de lloc/data.
            // Cas real TNV 2026-09-21: el rètol "Directe PRESENCIAL Berlín" queia a V7
            // perquè V6 estava ocupat.
            await this._placeChyronsByType(
                c => (c.rol || '').toUpperCase() === "NOMCARREC" || c.name.includes("Nom") || c.name.includes("Carrec"),
                (c, cfg) => [cfg.tracks.video.chyrons],
                "Nom"
                // ── Reencuadre automàtic DESACTIVAT de moment: el botó NOM només col·loca
                //    els chyrons. L'efecte Auto Reframe s'aplica manualment amb el botó REFRAME.
                // async (chy, placeTime) => {
                //     const res = await callJSX(`Anim.reframeAtTime(${placeTime})`);
                //     if (res === "OK_ADDED_REFRAME") {
                //         log(`   🎯 [Nom] Auto Reframe aplicat al clip de V1 sota ${chy.name} @ ${placeTime.toFixed(2)}s`);
                //     } else if (res === "INFO_ALREADY_HAS_REFRAME") {
                //         log(`   ⚠️ [Nom] El clip sota ${chy.name} ja té Auto Reframe.`);
                //     } else {
                //         log(`   ❌ [Nom] No s'ha pogut reencuadrar sota ${chy.name}: ${res}`, "WARN");
                //     }
                // }
            );
        },

        placeChyronTraduccio: async function () {
            if (!(await getUtils().validateActiveSequence())) return;
            const cfg = FASTPASS_UI.Config.get();
            const struct = FASTPASS_UI.State.structure;
            const T_TRAD = cfg.tracks.video.lloc || cfg.tracks.video.llocdata || 7;
            if (!struct || struct.length === 0) {
                log("⚠️ No hi ha estructura carregada. Executa un escaneig primer.", "WARN");
                return;
            }
            try {
                const markersRaw = await callJSX('Markers.get()');
                const allMarkers = markersRaw ? JSON.parse(markersRaw) : [];
                const STRUCTURAL_COMMENTS_RE = /^\d+[a-z]{0,3}\s*-\s*.+$/i;
                const structuralMarkers = allMarkers.filter(m => {
                    const cmt = (m.comments || "").trim();
                    return STRUCTURAL_COMMENTS_RE.test(cmt);
                });
                if (structuralMarkers.length === 0) {
                    log("⚠️ [Traducció] No hi ha marcadors estructurals.", "WARN");
                    return;
                }
                const markersFull = [];
                for (const m of structuralMarkers) {
                    const parts = (m.comments || "").split("-");
                    if (parts.length > 0) {
                        const rawId = parts[0].trim();
                        const numMatch = rawId.match(/^(\d+)/);
                        if (numMatch) {
                            markersFull.push({ fullId: rawId, blockNum: numMatch[1].padStart(2, "0"), time: m.time });
                        }
                    }
                }
                markersFull.sort((a, b) => a.time - b.time);
                const structureById = {};
                for (const entry of struct) { if (entry.id) structureById[entry.id] = entry; }

                let placedCount = 0;
                // (2026-10-12) CONGELAT DE LA CUA: la durada REAL del mèdia de cada traducció
                // decideix si el slot s'ha d'omplir amb un congelat (`_placeTradSlot`).
                // (2026-10-13) `_tradMediaDur` pot recarregar l'índex del bin si el nom no
                // hi és (índex indexat abans d'importar les traduccions): una recàrrega per
                // run, no una per traducció.
                this._tradIdxReloaded = false;
                const wottIdxTr = await FASTPASS_UI.Logic.Project.getWottIndex();
                // Xarxa de seguretat: l'insert del PNG estirat és un `overwriteClip` i pot tocar
                // clips veïns de la pista → instantània prèvia + reparació amb `_repararClipsV7`
                // (la mateixa xarxa que fa servir Repartir). Només s'actua si hi ha hagut
                // congelat: el camí sense congelat queda intacte.
                let snapTrad = [];
                try {
                    const clTrad = (await getClipsLogic().getTrackClips(T_TRAD, 'video')) || [];
                    snapTrad = clTrad.map(c => ({ name: c.name, start: c.start, end: c.end }));
                } catch (eSnapT) { log(`   ⚠️ [Traducció] no s'ha pogut llegir V${T_TRAD} per a la reparació: ${eSnapT.message}`, "WARN"); }
                const placedRanges = [];
                let frozeCount = 0;
                for (const mk of markersFull) {
                    const entry = structureById[mk.fullId];
                    if (!entry || !entry.chyrons || entry.chyrons.length === 0) continue;
                    const traduccionsRaw = entry.chyrons.filter(c =>
                        (c.rol || '').toUpperCase().includes("TRADUCCIO") || c.name.toUpperCase().includes("TRADUCCIO")
                    );
                    // RE-GENERACIONS (#136, 2026-10-02): el MATEIX rètol de traducció
                    // re-generat (mateixa línia, tc, text i índex [i-N]) pot estar al NAS
                    // 2 cops. Com que el tc és idèntic, abans es col·locaven TOTS i sortien
                    // el DOBLE de traduccions (cas TNM 02/10 bloc 36: 3 trad. × 2
                    // generacions `.00618503` / `.00618621` = 6). Mana la versió més NOVA
                    // del generador: mateix criteri que _placeChyronsByType (#133).
                    const traduccions = this._dedupeRegenerations(traduccionsRaw, "Traducció");
                    if (traduccions.length === 0) continue;

                    const groups = new Map();
                    for (const t of traduccions) {
                        const tc = t.tc || "00.00";
                        if (!groups.has(tc)) groups.set(tc, []);
                        groups.get(tc).push(t);
                    }
                    log(`📌 [Traducció] Marcador ${mk.fullId}: ${traduccions.length} trad. en ${groups.size} grup(s)`);

                    for (const [tc, group] of groups) {
                        const tcSeconds = getUtils().timeToSeconds(tc);
                        const idealTime = mk.time + tcSeconds;
                        const clipStart = await this._snapToNearestCut(idealTime);

                        const clips = await getClipsLogic().getTrackClips(1, "video");
                        // ═══ (2026-09-28) FIX: la REFERÈNCIA és el clip de V1 que CONTÉ clipStart,
                        // no el que hi comença EXACTAMENT. _snapToNearestCut rebutja els talls
                        // ANTERIORS per disseny (línia ~304: "si el tall més proper és anterior al
                        // marcador... usar el marcador") → quan l'ideal no és un tall (cas TNV V2:
                        // TC=01.10 → ideal 70.00s amb tall a 69.68s) NINGÚ coincidia amb el filtre
                        // |cl.start − clipStart| < 0.05 i s'aplicava el fallback clipEnd = clipStart
                        // + 10 ✗✗ → les 2 últimes traduccions sortien del seu clip: 2×5s = 70→80s
                        // quan el clip de referència és [69.68-77.48] (log: "dur=10.00s" = senyal
                        // que la referència no s'ha trobat).
                        let refClip = null, refIdx = -1;
                        for (let ci = 0; ci < clips.length; ci++) {
                            if (clips[ci].start <= clipStart + 0.05 && clips[ci].end > clipStart + 0.05) { refClip = clips[ci]; refIdx = ci; break; }
                        }
                        if (!refClip && clips.length > 0) {
                            // Cap clip conté el punt (forat a V1?): el més proper pel punt donat.
                            let bestD = 999;
                            for (let ci = 0; ci < clips.length; ci++) {
                                const d = Math.min(Math.abs(clips[ci].start - clipStart), Math.abs(clips[ci].end - clipStart));
                                if (d < bestD) { bestD = d; refClip = clips[ci]; refIdx = ci; }
                            }
                        }
                        // El repartiment comença a l'IN del clip de referència (69.68s, no 70.00s):
                        // així les N traduccions omplen EXACTAMENT el clip.
                        let refStart = (refClip ? refClip.start : clipStart);
                        let refEnd = null, refWhy = '';
                        if (refClip) {
                            refEnd = refClip.end;
                            refWhy = `clip V1 [${refClip.start.toFixed(2)}-${refClip.end.toFixed(2)}]s`;
                            let nextIdx = refIdx + 1;
                            while (nextIdx < clips.length && (clips[nextIdx].end - clips[nextIdx].start) < 0.5) {
                                log(`   ⚡ [Traducció] Flash a ${clips[nextIdx].start.toFixed(2)}s`);
                                nextIdx++;
                            }
                            if (nextIdx > refIdx + 1) {
                                if (nextIdx < clips.length) refEnd = clips[nextIdx].start;
                                else refEnd = clips[nextIdx - 1].end + 1.0;
                                refWhy += ` + flash saltat`;
                            }
                        } else {
                            refEnd = clipStart + 10;
                            refWhy = `SENSE clip de referència a V1 (fallback ${clipStart.toFixed(2)}+10s)`;
                            log(`   ⚠️ [Traducció] TC=${tc}: cap clip de V1 al punt ${clipStart.toFixed(2)}s → fallback 10s (revisa el tall)`, "WARN");
                        }
                        const clipDur = refEnd - refStart;
                        const extractSeq = (c) => {
                            const match = (c.rol || '').match(/\[(\d+)-\d+\]/);
                            return match ? parseInt(match[1], 10) : 999;
                        };
                        group.sort((a, b) => extractSeq(a) - extractSeq(b));
                        const N = group.length;
                        const slotDur = clipDur / N;
                        log(`   📦 [Traducció] TC=${tc}: ${N} clips @ ${refStart.toFixed(2)}s (dur=${clipDur.toFixed(2)}s, slot ${slotDur.toFixed(2)}s) ← ${refWhy}`);
                        // (2026-10-12) Durada REAL del mèdia de cada traducció del grup (font
                        // EXACTA: DOM del bin → ítem del projecte). Si el mèdia és més CURT que el
                        // slot, la cua s'ha d'omplir amb un CONGELAT: estirar el clip deixaria la
                        // cua BUIDA (clip al timeline sense imatge).
                        const trMedia = {};
                        for (const t of group) trMedia[t.name] = await this._tradMediaDur(t, wottIdxTr);
                        const minFz = (cfg.traduccio && Number(cfg.traduccio.freezeMinSec) > 0) ? Number(cfg.traduccio.freezeMinSec) : 0.12;
                        const maxMedia = Math.max.apply(null, group.map(t => trMedia[t.name] || 0).concat([0]));
                        const needFz = (N > 0) && group.some(t => (trMedia[t.name] || 0) > 0.1 && (slotDur - trMedia[t.name]) >= minFz);
                        let tempTC = 0;
                        if (needFz) {
                            // Zona temporal del final del timeline amb el PROGRAMA BUID (a TOTES
                            // les pistes de vídeo): el congelat d'un rètol amb ALPHA només el
                            // conserva si no hi ha vídeo a sota. Sempre més enllà del final del
                            // grup (els slots que col·loquem viuen dins del programa).
                            tempTC = Math.max(await this._emptyProgramTC(maxMedia + 2),
                                Math.ceil((refStart + clipDur + 5) / REV_FRAME) * REV_FRAME);
                            log(`   🧊 [Traducció] TC=${tc}: mèdia més curt que el slot → la cua s'omple amb el CONGELAT del frame · zona temporal ${tempTC.toFixed(2)}s`);
                        }
                        for (let i = 0; i < N; i++) {
                            const placeTime = refStart + slotDur * i;
                            const placeEnd = (i === N - 1) ? refStart + clipDur : refStart + slotDur * (i + 1);
                            // (2026-10-12) `_placeTradSlot`: clip SENCER (durada del mèdia) + cua
                            // congelada, en comptes d'estirar el clip més enllà del mèdia.
                            const rSlot = await this._placeTradSlot({
                                chy: group[i], track: T_TRAD, start: placeTime, end: placeEnd,
                                mediaDur: trMedia[group[i].name] || 0, tempTC: tempTC, label: 'Traducció'
                            });
                            if (!rSlot || !rSlot.ok) {
                                log(`      ⚠️ [${i+1}/${N}] NO col·locat (${rSlot ? rSlot.err : '?'})`, "WARN");
                                continue;
                            }
                            placedCount++;
                            placedRanges.push([placeTime, placeEnd]);
                            if (rSlot.mode === 'freeze') {
                                frozeCount++;
                            } else {
                                log(`      ✅ [${i+1}/${N}] → V${T_TRAD} @ ${placeTime.toFixed(2)}s→${placeEnd.toFixed(2)}s (${rSlot.trim})`);
                            }
                        }
                    }
                }
                // (2026-10-12) Reparació de veïns: només si algun slot ha necessitat el congelat
                // (l'insert del PNG estirat pot haver tocat clips de la pista).
                if (frozeCount > 0) {
                    log(`🧊 [Traducció] ${frozeCount} slot(s) amb la cua CONGELADA (clip sencer + PNG del frame).`);
                    await this._repararClipsV7(T_TRAD, snapTrad, placedRanges, 'Traducció');
                }
                if (placedCount === 0) {
                    log("⚠️ [Traducció] Cap traducció.", "WARN");
                } else {
                    log(`🎬 [Traducció] ${placedCount} trad. col·locades.`, "INFO");
                    getUtils().status(`Traducció: ${placedCount}`, "exito");
                }
            } catch (e) { getUtils().handleError(e, "Traducció"); }
        },

        placeChyronResto: async function () {
            // OJO: "TITOLET" conté "TITOL": si es filtra per includes("TITOL") els
            // TITOLET queden exclosos del Resto i no es col·loquen enlloc.
            const isTitol = c => (c.rol || '').toUpperCase() === "TEMA-TITOL" || c.name.includes("Tema-Titol");
            const isConductor = c => (c.rol || '').toUpperCase() === "CONDUCTOR";
            const isLloc = c => c.name.includes("Lloc") || c.name.includes("Data") || (c.rol || '').toUpperCase() === "LLOCDATA";
            const isNom = c => (c.rol || '').toUpperCase() === "NOMCARREC" || c.name.includes("Nom") || c.name.includes("Carrec");
            const isTraduccio = c => (c.rol || '').toUpperCase().includes("TRADUCCIO") || c.name.toUpperCase().includes("TRADUCCIO");
            await this._placeChyronsByType(
                c => !isTitol(c) && !isConductor(c) && !isLloc(c) && !isNom(c) && !isTraduccio(c),
                (c, cfg) => {
                    const rName = (c.name || '').toUpperCase();
                    const rRol = (c.rol || '').toUpperCase();
                    // ⚠️ Noms de pista correctes: V_CHYRONS = v_chyrons (V7) · V_LLOC = v_lloc (V8).
                    // (Abans es deien V6/V7 i els seus valors reals JA eren 7/8 → confusió.)
                    const V_CHYRONS = cfg.tracks.video.chyrons;
                    const V_LLOC = cfg.tracks.video.lloc || cfg.tracks.video.llocdata || 8;
                    // GRAFISMES CREMATS (des del 2026-10-08: qualsevol de les 27 etiquetes
                    // literals de `titolet.detectRoles` — TITOLET, PREGUNTA, CARTELL, DADA-GRAN,
                    // CLASSI-PRIMERA, GRAFICA-BARRES, LLISTA, NOTA…): NO passen per aquí —
                    // `_placeTitoletChain` els col·loca EN CADENA (targeta + congelat)
                    // reservant el rang sencer. Això és només la xarxa de seguretat si un
                    // rètol d'aquesta família arribés al bucle genèric.
                    if (this._isBurnedGrafWott(c)) return [V_LLOC];
                    // Rètols de LOCALITZACIÓ ("Directe PRESENCIAL <lloc>") i de PROGRAMES:
                    // V_LLOC preferent (deixa V_CHYRONS lliure per als noms) i V_CHYRONS de
                    // reserva — COM SEMPRE. ⚠️ (2026-09-21) Aquests NO són nom-càrrec: el canvi
                    // del tipus Enviat/connexió no els ha d'afectar (petició d'usuari:
                    // "Directe_PRESENCIAL, com estava; a V6 no, a V7 estaven perfectes").
                    if (/DIRECTE[_ ]+PRESENCIAL|DIRECTE[_ ]+PROGRAMES/.test(rName) ||
                        rRol === 'PRESENCIAL' || rRol === 'PROGRAMES' ||
                        rName.indexOf('PROGRAMES') !== -1) {
                        return [V_LLOC, V_CHYRONS];
                    }
                    // Rètols de connexió pròpiament dits (Enviat / Directe del connector) =
                    // nom-càrrec del connector: NOMÉS V_CHYRONS, sense V_LLOC de reserva (2026-09-21).
                    if (this._isConexioWott(c)) return [V_CHYRONS];
                    return [V_CHYRONS, V_LLOC];
                },
                "Resto",
                undefined,
                { dedupeTitolet: true, chainTitolet: true }
            );
        },

        /**
         * _repararClipsV7: Torna a la seva posició original qualsevol clip de la pista de
         * traduccions que un insert hagi retallat, desplaçat o esborrat.
         * Per què funciona: `Clips.insert` (overwrite) col·loca el clip amb la durada per
         * defecte del mèdia i pot tocar el veí; com que les traduccions són PNG (elàstics),
         * el clip afectat es pot tornar a estirar a la SEVA posició original sense moure res
         * més (idea d'usuari 2026-09-21: més barat que moure tota la pista i tornar-la).
         * @param {number} track  - Pista (1-based)
         * @param {Array}  snap   - [{name,start,end}] posició original dels clips NO nostres
         * @param {Array}  placed - [[start,end]] rangs que hem col·locat (no es reparen si hi cauen)
         * @param {string} [tag]  - Etiqueta dels logs (per defecte «Repartir»; 2026-10-12 el
         *   flux TRAD/COLOCAR també la fa servir amb el congelat de la cua).
         * @returns {number} Nombre de clips restaurats
         */
        _repararClipsV7: async function (track, snap, placed, tag) {
            const TAG = tag || 'Repartir';
            if (!snap || snap.length === 0) return 0;
            let total = 0;
            // 2 passades: restaurar un clip pot tornar a tocar el seu veí.
            for (let pass = 0; pass < 2; pass++) {
                const cur = [];
                try {
                    const n = parseInt(await callJSX(`Clips.count(${track}, 'video')`) || '0');
                    for (let i = 0; i < n; i++) {
                        const raw = await callJSX(`Clips.get(${track}, ${i}, 'video')`);
                        if (raw && raw !== 'null') cur.push(JSON.parse(raw));
                    }
                } catch (eR) {
                    log(`   ⚠️ [${TAG}] no s'ha pogut llegir la pista per reparar: ${eR.message}`, "WARN");
                    return total;
                }
                let fixed = 0;
                for (const s0 of snap) {
                    const dins = placed.some(p => (s0.start < p[1] - 0.05) && (s0.end > p[0] + 0.05));
                    if (dins) {
                        log(`   ⚠️ [${TAG}] "${s0.name}" (${s0.start.toFixed(2)}-${s0.end.toFixed(2)}s) no es repara: el seu lloc original l'ocupa un slot repartit`, "WARN");
                        continue;
                    }
                    let best = null, bestD = Infinity;
                    for (const c of cur) {
                        if (c.name !== s0.name) continue;
                        // No confondre una traducció NOSTRA (acabada de col·locar) amb el clip
                        // original si comparteixen nom.
                        if (placed.some(p => Math.abs(c.start - p[0]) < 0.05 && Math.abs(c.end - p[1]) < 0.05)) continue;
                        const d = Math.abs(c.start - s0.start);
                        if (d < bestD) { bestD = d; best = c; }
                    }
                    if (!best) {
                        // Esborrat del tot → tornar-lo a inserir a la seva posició original.
                        const esc = getUtils().escape(s0.name);
                        await callJSX(`Clips.insert('${esc}', ${track}, ${s0.start.toFixed(4)}, null, 'video')`);
                        const r2 = await callJSX(`Clips.endAt(${track}, ${s0.start.toFixed(4)}, ${s0.end.toFixed(4)}, 'video')`);
                        log(`   🩹 [${TAG}] "${s0.name}" havia estat esborrat per un insert → re-insertat @ ${s0.start.toFixed(2)}-${s0.end.toFixed(2)}s (${r2})`, "WARN");
                        fixed++; total++;
                        continue;
                    }
                    if (Math.abs(best.start - s0.start) > 0.05 || Math.abs(best.end - s0.end) > 0.05) {
                        const r = await callJSX(`Clips.moveToRange(${track}, ${best.index}, ${s0.start.toFixed(4)}, ${s0.end.toFixed(4)}, 'video')`);
                        log(`   🩹 [${TAG}] "${s0.name}" tocat per un insert [${best.start.toFixed(2)}-${best.end.toFixed(2)}] → restaurat a [${s0.start.toFixed(2)}-${s0.end.toFixed(2)}]s (${r})`, "WARN");
                        fixed++; total++;
                    }
                }
                if (fixed === 0) break;
            }
            if (total > 0) log(`🩹 [${TAG}] ${total} clip(s) d'altres blocs restaurats a la seva posició original.`);
            return total;
        },

        repartirChyronTraduccio: async function () {
            if (!(await getUtils().validateActiveSequence())) return;
            const cfg = FASTPASS_UI.Config.get();
            const T_V1 = cfg.tracks.video.mp4;
            const T_TRAD = cfg.tracks.video.lloc || cfg.tracks.video.llocdata || 7;
            const struct = FASTPASS_UI.State.structure || [];
            const rolByName = new Map();
            for (const entry of struct) {
                if (entry.chyrons) {
                    for (const chy of entry.chyrons) rolByName.set(chy.name, chy.rol || '');
                }
            }
            try {
                const v1Count = parseInt(await callJSX(`Clips.count(${T_V1}, 'video')`) || '0');
                const v3Count = parseInt(await callJSX(`Clips.count(${T_TRAD}, 'video')`) || '0');
                const selectedV1 = [];
                for (let i = 0; i < v1Count; i++) {
                    const raw = await callJSX(`Clips.get(${T_V1}, ${i}, 'video')`);
                    if (!raw || raw === 'null') continue;
                    const clip = JSON.parse(raw);
                    if (clip.selected) selectedV1.push(clip);
                }
                const allV3 = [];
                const selectedV3 = [];
                for (let i = 0; i < v3Count; i++) {
                    const raw = await callJSX(`Clips.get(${T_TRAD}, ${i}, 'video')`);
                    if (!raw || raw === 'null') continue;
                    const clip = JSON.parse(raw);
                    allV3.push(clip);
                    if (clip.selected) selectedV3.push(clip);
                }
                // (2026-10-13) El rètol deia «(V7)» fix, però `T_TRAD` surt de
                // `cfg.tracks.video.lloc` (= V8 al perfil dels TNs) → el log enganyava.
                log(`🎯 [Repartir] V1: ${selectedV1.length}, Trad (V${T_TRAD}): ${selectedV3.length}`);
                if (selectedV3.length === 0 || selectedV1.length === 0) {
                    log(`⚠️ [Repartir] Selecciona Trad (V${T_TRAD}) + V1 amb Ctrl+clic.`, "WARN");
                    getUtils().status(`Selecciona Trad (V${T_TRAD}) + V1`, "warn");
                    return;
                }
                selectedV3.sort((a, b) => a.start - b.start);
                selectedV1.sort((a, b) => a.start - b.start);
                // (2026-10-12) Índex de durades del bin CHY: decideix si la cua d'un slot
                // necessita CONGELAT (mèdia més curt que l'espai).
                // (2026-10-13) Una recàrrega d'índex per run com a màxim (vegeu `_tradMediaDur`).
                this._tradIdxReloaded = false;
                let wottIdxRep = null;
                try { wottIdxRep = await FASTPASS_UI.Logic.Project.getWottIndex(); } catch (eWI) { }

                const groups = [];
                let currentGroup = [selectedV3[0]];
                for (let i = 1; i < selectedV3.length; i++) {
                    const gap = selectedV3[i].start - currentGroup[currentGroup.length - 1].end;
                    if (gap < 3.0) currentGroup.push(selectedV3[i]);
                    else { groups.push(currentGroup); currentGroup = [selectedV3[i]]; }
                }
                groups.push(currentGroup);
                log(`📦 [Repartir] ${groups.length} tram(s)`);

                let placedCount = 0;

                // (2026-09-21) ABANS: `Clips.clearTrack(T_TRAD)` → esborrava TOT el que hi
                // havia a la pista de traduccions (també les d'altres ítems, que NO s'han
                // de tocar). Ara NOMÉS es retiren les traduccions SELECCIONADES; la resta de
                // la pista queda intacta i, si algun insert la toca, es REPARA (vegeu el final).
                let removed = 0;
                for (const cl of selectedV3) {
                    const r = await callJSX(`Clips.removeAt(${T_TRAD}, ${cl.start}, 'video')`);
                    if (String(r).indexOf('OK') === 0) removed++;
                }
                log(`   🧹 [Repartir] ${removed}/${selectedV3.length} traducció(ns) seleccionades retirades de V${T_TRAD} (la resta de la pista NO es toca)`);

                // Instantània dels clips NO seleccionats de V7: serveix per REPARAR qualsevol
                // clip que un insert hagi retallat, desplaçat o esborrat. Com que les
                // traduccions són PNG (elàstics), es pot tornar a estirar el clip a la seva
                // posició original en lloc de moure tota la pista (idea d'usuari 2026-09-21).
                const snapAltres = allV3.filter(c => !c.selected)
                    .map(c => ({ name: c.name, start: c.start, end: c.end }));

                // Marcadors: el límit de l'últim slot és el final del clip de referència (V1)
                // o el SEGÜENT MARCADOR, el que estigui més a prop.
                let markersT = [];
                try {
                    const mkRaw = await callJSX('Markers.get()');
                    const mks = JSON.parse(mkRaw) || [];
                    markersT = mks
                        .map(mk => (typeof mk.time === 'number') ? mk.time : parseFloat(mk.time))
                        .filter(t => isFinite(t))
                        .sort((a, b) => a - b);
                    log(`   📏 [Repartir] marcadors llegits: ${markersT.length}`);
                } catch (eMK) {
                    log(`   ⚠️ [Repartir] no s'han pogut llegir els marcadors (${eMK.message}): el límit serà el final del clip de V1`, "WARN");
                }
                const primeraDespres = (t) => {
                    for (const m of markersT) { if (m > t + 0.05) return m; }
                    return null;
                };

                // Rangs que hem col·locat nosaltres: un clip de la instantània que hi caigui
                // no es "repara" (ja no hi té lloc).
                const placedRanges = [];

                // ═══ (2026-09-25f) PROTECCIÓ DELS CLIPS VEÏNS DE LA PISTA ═════════════════════
                // `Clips.insert` = overwriteClip amb la durada COMPLETA del PNG: encara que el
                // slot final sigui curt, l'insert esborra tot el que troba a la seva DRETA
                // (queixa 2026-09-25: el rètol "…_Llocdata_…" adjacent va quedar destrossat).
                // Protocol:
                //   1. El límit del repartiment s'atura a l'entrada del proper clip de la pista
                //      → cap slot ocupa el lloc d'un altre clip.
                //   2. Els clips veïns de la zona de perill es MOUEN fora de la pista abans de
                //      col·locar (moveToRange: reassigna start/end, NO sobreescriu) i es TORNEN
                //      a la seva posició EXACTA al final.
                //   3. Xarxa de seguretat: si el retorn fallés, _repararClipsV7 encara ho repara.
                const victimsMoments = [];      // [{name, start, end, tmpStart}]
                const victimsMoved = new Set();
                const DANGER_SLACK = 30;        // s de marge per sobre del final de l'últim slot
                let tempZoneBase = 0;
                for (const c0 of allV3) tempZoneBase = Math.max(tempZoneBase, c0.end);
                for (const c0 of selectedV1) tempZoneBase = Math.max(tempZoneBase, c0.end);
                tempZoneBase = tempZoneBase + 120;   // ben passat tot el material (fora de perill)

                for (let gi = 0; gi < groups.length; gi++) {
                    const group = groups[gi];
                    const extractTotal = (c) => {
                        const rol = rolByName.get(c.name) || c.rol || '';
                        const match = rol.match(/\[(\d+)-(\d+)\]/);
                        return match ? parseInt(match[2], 10) : group.length;
                    };
                    const extractSeq = (c) => {
                        const rol = rolByName.get(c.name) || c.rol || '';
                        const match = rol.match(/\[(\d+)-(\d+)\]/);
                        return match ? parseInt(match[1], 10) : 999;
                    };
                    const M = Math.max(...group.map(c => extractTotal(c)), group.length);
                    const N = group.length;
                    group.sort((a, b) => extractSeq(a) - extractSeq(b));

                    // ═══ (2026-09-28) REFERÈNCIA PER TRAM = CLIPS V1 SELECCIONATS ═════════════════
                    // L'operador marca l'extensió del tram amb la SELECCIÓ (Ctrl+clic): si
                    // selecciona 2 clips a V1, el tram s'ha de repartir sobre TOTS DOS.
                    // · ABANS (25e) el tram es filtrava per INTERSECCIÓ amb el span de les
                    //   traduccions → si COLOCAR les ha deixat totes dins del 1r clip (fix del
                    //   28/09: el repartiment arrenca a l'IN del clip de referència), cap altre
                    //   clip "tocava" el tram → refN=1 i REPARTIR només omplia el primer clip.
                    //   Log 2026-09-28 11:35: "V1: 2, Trad (V8): 5" + "(1 clip(s): 28.44-34.84)".
                    // · Es manté l'esperit de 2026-09-21/25e (Cada tram dins del SEU material,
                    //   el bloc 2 no envaeix el bloc 1): la repartició es fa per POSICIÓ → cada
                    //   tram pren els clips seleccionats des del que CONTÉ el seu inici fins al
                    //   clip ANTERIOR al que conté l'inici del tram SEGÜENT.
                    // · Amb 2+ clips de referència el límit de l'últim slot és l'OUT de l'últim
                    //   clip (un marcador intern, p. ex. el tall entre els dos clips, NO ha de
                    //   truncar el repartiment).
                    // Span TEMPORAL del tram (el group està ordenat per seqüència [N-M], no per temps).
                    const gFirst = Math.min.apply(null, group.map(c => c.start));
                    const gNextFirst = (gi + 1 < groups.length && groups[gi + 1] && groups[gi + 1].length > 0)
                        ? Math.min.apply(null, groups[gi + 1].map(c => c.start))
                        : null;
                    const selOrd = selectedV1.slice().sort((a, b) => a.start - b.start);
                    // (2026-10-13) L'EXTENSIÓ DEL TRAM 1 la marca la SELECCIÓ des del SEU
                    // PRIMER clip, no des del clip que conté la 1a traducció. Motiu (test
                    // d'usuari TNM V3 13/10): selecció de 5 clips [24.12→51.00] amb les 5
                    // traduccions a 34.64 (on les va deixar COLOCAR) → el tram s'ancorava a
                    // 34.64 i sortia de 16.36s (slot 3.27s) en comptes de 26.88s (slot
                    // 5.38s): els 4 clips seleccionats d'abans s'ignoraven.
                    // Els trams SEGÜENTS mantenen l'ancoratge al clip que conté el SEU inici
                    // perquè el tram k no envaeixi el material del tram k−1 (`idx1` del tram
                    // anterior ja s'atura al clip previ al començament del següent).
                    let idx0 = (gi === 0) ? 0 : selOrd.findIndex(c => c.end > gFirst + 0.05);
                    if (idx0 < 0) idx0 = selOrd.length - 1;              // cap clip conté l'inici → el darrer
                    let idx1 = selOrd.length - 1;                        // …fins a l'últim clip seleccionat
                    if (gNextFirst !== null) {
                        let idxNext = selOrd.findIndex(c => c.end > gNextFirst + 0.05);
                        if (idxNext < 0) idxNext = selOrd.length - 1;
                        idx1 = Math.max(idx0, idxNext - 1);              // el tram veí comença al seu clip
                    }
                    const spanClips = selOrd.slice(idx0, idx1 + 1);
                    let bStart = null, bEnd = null, refN = 0, refWhy = '';
                    if (spanClips.length > 0) {
                        const ordSpan = spanClips.slice().sort((a, b) => a.start - b.start);
                        bStart = ordSpan[0].start;
                        bEnd   = ordSpan[ordSpan.length - 1].end;
                        refN   = spanClips.length;
                        refWhy = ordSpan.map(c => c.start.toFixed(2) + '-' + c.end.toFixed(2)).join(' + ');
                        for (let k = 1; k < ordSpan.length; k++) {
                            const gap = ordSpan[k].start - ordSpan[k - 1].end;
                            if (gap > 0.5) log(`   ⚠️ [Repartir] Tram ${gi+1}: forat de ${gap.toFixed(2)}s entre clips de referència (${ordSpan[k-1].end.toFixed(2)}s → ${ordSpan[k].start.toFixed(2)}s): algun slot pot caure en zona sense material.`, "WARN");
                        }
                    } else {
                        let ref = this._clipAtInstant(selectedV1, gFirst);
                        if (!ref) {
                            // Fallback: el clip de V1 seleccionat més proper (per centre).
                            ref = selectedV1.reduce((best, c) => {
                                const dc = Math.abs((c.start + c.end) / 2 - gFirst);
                                const db = (best === null) ? Infinity : Math.abs((best.start + best.end) / 2 - gFirst);
                                return (dc < db) ? c : best;
                            }, null);
                        }
                        if (ref) { bStart = ref.start; bEnd = ref.end; refN = 1; refWhy = ref.start.toFixed(2) + '-' + ref.end.toFixed(2); }
                    }
                    if (bStart === null || bEnd === null) {
                        log(`   ⚠️ [Repartir] Tram ${gi+1}: sense clip de referència a V1 → saltat`, "WARN");
                        continue;
                    }
                    const slotNominal = (bEnd - bStart) / M;
                    // Límit de l'últim slot: final del clip de referència (V1) o SEGÜENT
                    // MARCADOR, el que estigui més a prop. Un marcador INTERN (que no arriba a
                    // l'últim slot) s'ignora: no marca el final del bloc. Amb 2+ clips de
                    // referència NO s'aplica (mana la selecció de l'operador).
                    let limit = bEnd, limitWhy = (refN > 1)
                        ? `OUT de l'últim clip V1 seleccionat @ ${bEnd.toFixed(2)}s`
                        : `final del clip de referència (V1) @ ${bEnd.toFixed(2)}s`;
                    if (refN === 1) {
                        const mkLim = primeraDespres(bStart + slotNominal * (M - 1));
                        if (mkLim !== null && mkLim < bEnd - 0.05) {
                            limit = mkLim;
                            limitWhy = `marcador @ ${mkLim.toFixed(2)}s (abans del final de V1 @ ${bEnd.toFixed(2)}s)`;
                        }
                    }
                    // (2026-09-25f) 1) NO trepitjar el proper clip existent de la pista: si n'hi ha
                    // un dins el rang, el repartiment s'atura a la seva entrada (es conserva
                    // exactament allà on és; abans l'insert el destrossava).
                    let nextOther = null, nextOtherName = '';
                    for (const c0 of snapAltres) {
                        if (c0.start <= bStart + 0.05 || c0.start >= bEnd - 0.05) continue;
                        if (nextOther === null || c0.start < nextOther) { nextOther = c0.start; nextOtherName = c0.name; }
                    }
                    if (nextOther !== null && nextOther < limit - 0.05) {
                        limit = nextOther;
                        limitWhy += ` + entrada del clip veí "${String(nextOtherName).substring(0, 24)}…" @ ${nextOther.toFixed(2)}s`;
                    }
                    // Slots UNIFORMES fins al límit: tots (l'últim inclòs) duren el mateix.
                    const slotDur = (limit - bStart) / M;
                    if (!(slotDur > 0.2)) {
                        log(`   ⚠️ [Repartir] Tram ${gi+1}: espai insuficient (${(limit - bStart).toFixed(2)}s per a ${M} slots) → saltat`, "WARN");
                        continue;
                    }
                    log(`   📐 [Repartir] Tram ${gi+1}/${groups.length}: ${N}/${M} trad. | ref V1 [${bStart.toFixed(2)}-${bEnd.toFixed(2)}] (${refN} clip(s): ${refWhy}) | límit ${limit.toFixed(2)}s (${limitWhy}) | slotDur=${slotDur.toFixed(2)}s (tots iguals)`);

                    // (2026-09-25f) 2) Apartar els clips veïns de la zona de perill: l'insert
                    // escriu la durada COMPLETA del PNG (pot arribar més enllà del final del
                    // slot) → millor treure'ls de la pista i tornar-los al final.
                    const dangerEnd = limit + Math.max(DANGER_SLACK, slotDur);
                    for (const v0 of snapAltres) {
                        const vKey = v0.start.toFixed(3);
                        if (victimsMoved.has(vKey)) continue;
                        if (!(v0.start < dangerEnd && v0.end > bStart - 0.05)) continue;
                        let vIdx = null;
                        try {
                            const atRaw = await callJSX(`Clips.at(${T_TRAD}, ${(v0.start + 0.03).toFixed(4)}, 'video')`);
                            const o = (atRaw && atRaw !== 'null') ? JSON.parse(atRaw) : null;
                            if (o && o.index !== undefined && o.index !== null) vIdx = o.index;
                        } catch (eAt) { }
                        if (vIdx === null) {
                            log(`   ⚠️ [Repartir] no s'ha trobat el clip veí "${String(v0.name).substring(0, 30)}…" @ ${v0.start.toFixed(2)}s per apartar-lo (el repararà _repararClipsV7)`, "WARN");
                            continue;
                        }
                        const vDur = Math.max(0.5, v0.end - v0.start);
                        const tmpStart = tempZoneBase + victimsMoments.length * (vDur + 10);
                        const mv = await callJSX(`Clips.moveToRange(${T_TRAD}, ${vIdx}, ${tmpStart.toFixed(4)}, ${(tmpStart + vDur).toFixed(4)}, 'video')`);
                        const okMv = (String(mv).indexOf('OK') === 0);
                        log(`   🛡️ [Repartir] clip veí "${String(v0.name).substring(0, 30)}…" [${v0.start.toFixed(2)}-${v0.end.toFixed(2)}s] ` +
                            (okMv ? `apartat a ${tmpStart.toFixed(2)}s (torna al final)` : `NO apartat ⚠️ ${mv}`), okMv ? 'INFO' : 'WARN');
                        if (okMv) {
                            victimsMoments.push({ name: v0.name, start: v0.start, end: v0.end, tmpStart: tmpStart });
                            victimsMoved.add(vKey);
                        }
                    }

                    const seqToChy = new Map();
                    for (const chy of group) seqToChy.set(extractSeq(chy), chy);

                    // (2026-10-12) Durada REAL del mèdia de cada traducció del tram (font exacta:
                    // DOM del bin → ítem del projecte). Si el mèdia és més CURT que el slot, la
                    // cua s'omple amb un CONGELAT (`_placeTradSlot`): estirar el clip deixaria la
                    // cua BUIDA (clip al timeline sense imatge).
                    const trMedia = {};
                    for (const c of group) trMedia[c.name] = await this._tradMediaDur({ name: c.name }, wottIdxRep);
                    const minFz = (cfg.traduccio && Number(cfg.traduccio.freezeMinSec) > 0) ? Number(cfg.traduccio.freezeMinSec) : 0.12;
                    let tempTCRep = 0;   // zona temporal dels congelats (es calcula al 1r que calgui)

                    for (let s = 0; s < M; s++) {
                        const seqNum = s + 1;
                        const chy = seqToChy.get(seqNum) || null;
                        if (!chy) { log(`      ⬜ [${seqNum}/${M}] buit`); continue; }
                        const slotStart = bStart + slotDur * s;
                        const slotEnd = bStart + slotDur * (s + 1);   // l'últim acaba exactament al límit
                        const media = trMedia[chy.name] || 0;
                        if (!(tempTCRep > 0) && media > 0.1 && (slotDur - media) >= minFz) {
                            // Zona temporal del FINAL del timeline amb el PROGRAMA BUID (a TOTES
                            // les pistes): el congelat d'un rètol amb ALPHA només el conserva si
                            // no hi ha vídeo a sota. Es calcula ARA perquè els veïns apartats ja
                            // són a la pista i són el material més llunyà.
                            tempTCRep = Math.max(await this._emptyProgramTC(media + 2),
                                Math.ceil((limit + 5) / REV_FRAME) * REV_FRAME);
                            log(`   🧊 [Repartir] Tram ${gi+1}: mèdia (${media.toFixed(2)}s) més curt que el slot (${slotDur.toFixed(2)}s) → la cua s'omple amb el CONGELAT del frame · zona temporal ${tempTCRep.toFixed(2)}s`);
                        }
                        // (2026-10-12) `_placeTradSlot`: clip SENCER (durada del mèdia) + cua
                        // congelada, en comptes d'estirar el clip més enllà del mèdia.
                        const rSlot = await this._placeTradSlot({
                            chy: { name: chy.name }, track: T_TRAD, start: slotStart, end: slotEnd,
                            mediaDur: media, tempTC: tempTCRep, label: 'Repartir'
                        });
                        if (!rSlot || !rSlot.ok) {
                            log(`      ⚠️ [${seqNum}/${M}] NO col·locat (${rSlot ? rSlot.err : '?'})`, "WARN");
                            continue;
                        }
                        // Verificació de la durada real de la PART VIVA (el clip del mèdia).
                        const expected = (rSlot.mode === 'freeze') ? rSlot.live : slotDur;
                        let chkDur = null;
                        try {
                            const chkRaw = await callJSX(`Clips.at(${T_TRAD}, ${(slotStart + 0.02).toFixed(4)}, 'video')`);
                            const ck = (chkRaw && chkRaw !== 'null') ? JSON.parse(chkRaw) : null;
                            if (ck) chkDur = ck.end - ck.start;
                        } catch (eCk) { }
                        placedRanges.push([slotStart, slotEnd]);
                        placedCount++;
                        const detall = (rSlot.mode === 'freeze')
                            ? `viu ${rSlot.live.toFixed(2)}s + congelat ${rSlot.freeze.toFixed(2)}s`
                            : `retall: ${rSlot.trim}`;
                        log(`      ${rSlot.mode === 'freeze' ? '🧊' : '✅'} [${seqNum}/${M}] → V${T_TRAD} @ ${slotStart.toFixed(2)}→${slotEnd.toFixed(2)}s (${slotDur.toFixed(2)}s | ${detall})` +
                            ((chkDur !== null && Math.abs(chkDur - expected) > 0.15) ? ` ⚠️ durada real ${chkDur.toFixed(2)}s` : ''));
                        if (rSlot.mode !== 'freeze' && String(rSlot.trim).indexOf('OK') !== 0) {
                            log(`      ⚠️ [Repartir] no s'ha pogut fixar la durada de la traducció @ ${slotStart.toFixed(2)}s (${rSlot.trim})`, "WARN");
                        }
                        if (s % 3 === 2) await getUtils().delay(100);
                    }
                }

                // (2026-09-25f) 3) TORNAR els clips veïns apartats EXACTAMENT a la seva posició
                // original (moveToRange invers: reassigna start/end, NO fa overwriteClip → no
                // destrossa ni els slots que acabem de col·locar ni els altres veïns).
                for (const v of victimsMoments) {
                    let vIdx = null;
                    try {
                        const atRaw = await callJSX(`Clips.at(${T_TRAD}, ${(v.tmpStart + 0.03).toFixed(4)}, 'video')`);
                        const o = (atRaw && atRaw !== 'null') ? JSON.parse(atRaw) : null;
                        if (o && o.index !== undefined && o.index !== null) vIdx = o.index;
                    } catch (eAt) { }
                    if (vIdx === null) {
                        log(`   ⚠️ [Repartir] no s'ha pogut localitzar "${String(v.name).substring(0, 30)}…" a ${v.tmpStart.toFixed(2)}s per tornar-lo → el repara _repararClipsV7`, "WARN");
                        continue;
                    }
                    const back = await callJSX(`Clips.moveToRange(${T_TRAD}, ${vIdx}, ${v.start.toFixed(4)}, ${v.end.toFixed(4)}, 'video')`);
                    const okB = (String(back).indexOf('OK') === 0);
                    log(`   ↩️ [Repartir] clip veí "${String(v.name).substring(0, 30)}…" tornat a [${v.start.toFixed(2)}-${v.end.toFixed(2)}]s ${okB ? '✓' : '⚠️ ' + back}`, okB ? 'INFO' : 'WARN');
                }

                // (2026-09-21) REPARACIÓ: si algun insert ha retallat, desplaçat o esborrat un
                // clip que NO era nostre, es torna a la seva posició original (els PNG es
                // poden estirar → només cal tocar el clip afectat, no tota la pista).
                await this._repararClipsV7(T_TRAD, snapAltres, placedRanges);
                getUtils().status(`Repartit: ${placedCount} trad.`, "exito");
                // (2026-09-21) Tornar la auto-selecció a V1: targeting només V1/A1 + clip de V1.
                await getUtils().targetOnlyV1("Repartir");
                await getUtils().focusV1("Repartir");
                log(`🎬 [Repartir] ${placedCount} trad. repartides.`, "INFO");
            } catch (e) { getUtils().handleError(e, "Repartir"); }
        }

    };

    window.FASTPASS_UI.Workflows.Chyrons = FASTPASS_UI.Workflows.Chyrons;
})();
