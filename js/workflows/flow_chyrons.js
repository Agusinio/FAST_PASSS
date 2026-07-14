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
    const callJSX = (s) => getUtils().callJSX(s);

    FASTPASS_UI.Workflows.Chyrons = {

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
            let bestClip = clips[0];
            let bestDist = Math.abs(clips[0].start - idealTimeSec);
            for (let i = 1; i < clips.length; i++) {
                const dist = Math.abs(clips[i].start - idealTimeSec);
                if (dist < bestDist) { bestDist = dist; bestClip = clips[i]; }
            }
            log(`   🎯 [_snap] ideal=${idealTimeSec.toFixed(2)}s → clip @ ${bestClip.start.toFixed(2)}s (Δ=${bestDist.toFixed(2)}s)`);
            return bestClip.start;
        },

        _freezeTemaTitol: async function (wottName, placeTime, stretchEnd, label) {
            const cfg = FASTPASS_UI.Config.get();
            const T_THEME = cfg.tracks.video.tematitol;
            const utils = getUtils();
            const escapedWott = utils.escape(wottName);
            const CUT_OFFSET = 8.0;
            log(`   🧊 [_freeze] wott="${wottName.substring(0, 50)}..." placeTime=${placeTime.toFixed(2)}s stretchEnd=${stretchEnd !== null ? stretchEnd.toFixed(2) : 'final'}`);
            const cutTime = placeTime + CUT_OFFSET;

            // 1. Inserir Wott complet
            await callJSX(`Clips.insert('${escapedWott}', ${T_THEME}, ${placeTime}, null, 'video')`);
            await utils.delay(500);

            // 2. Aïllar V5 (només el Tema‑Titol visible), després posicionar cabezal i fer snapshot
            await FASTPASS_UI.Logic.Tracks.isolate(T_THEME, 'video');
            await callJSX(`Timeline.set(${cutTime})`);
            await utils.delay(500);

            // Guardar PNG al directori del projecte (Snapshots)
            const folder = await callJSX("Context.folder()");
            const snapPath = `${folder}\\Snapshots\\freeze_${Date.now()}.png`;
            const snapResult = await callJSX(`Render.snapshot('${utils.escape(snapPath.replace(/\.png$/i, ''))}', ${cutTime})`);
            log(`   📸 [_freeze] Render.snapshot → ${snapResult} (path=${snapPath})`);

            // 3. Restaurar visibilitat de totes les pistes
            await FASTPASS_UI.Logic.Tracks.all('video', 'mute', false);

            // 4. Retallar clip animació (després del snapshot, per tenir el frame complet)
            await callJSX(`Clips.endAt(${T_THEME}, ${placeTime}, ${cutTime}, 'video')`);
            log(`   ✂️ [_freeze] Clip retallat a end=${cutTime.toFixed(2)}s`);

            if (!snapResult || snapResult.indexOf('OK') !== 0) {
                log(`   ❌ [_freeze] Snapshot fallit: ${snapResult}`, "ERROR");
                return { success: false, duration: 0 };
            }

            // 5. Importar PNG al bin CHY (Render.snapshot ja escriu directament a snapPath)
            const fileName = snapPath.split("\\").pop();
            const importPayload = JSON.stringify([snapPath]);
            await callJSX(`IO.importFiles('${utils.escape(importPayload)}', 'CHY')`);

            // 7. Determinar durada i inserir PNG estirat a V5 des de cutTime fins a stretchEnd
            let duration;
            if (stretchEnd !== null && stretchEnd !== undefined) {
                duration = Math.max(stretchEnd - cutTime, 0.5);
            } else {
                const timelineDur = parseFloat(await callJSX("Timeline.duration()") || "0");
                duration = Math.max(timelineDur - cutTime, 0.5);
            }
            await callJSX(`Clips.insert('${utils.escape(fileName)}', ${T_THEME}, ${cutTime}, ${cutTime + duration}, 'video')`);
            log(`   ✅ [_freeze] PNG "${fileName}" → CHY → V5 @ ${cutTime.toFixed(2)}s dur=${duration.toFixed(1)}s (fi=${stretchEnd !== null ? stretchEnd.toFixed(2) : 'final'})s`);
            return { success: true, duration };
        },

        _placeChyronsByType: async function (filterFn, trackResolver, label) {
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
                const STRUCTURAL_COMMENTS_RE = /^\d+[a-z]?\s*-\s*.+$/i;
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

                let placedCount = 0;
                for (const mk of markersFull) {
                    const entry = structureById[mk.fullId];
                    if (!entry || !entry.chyrons || entry.chyrons.length === 0) continue;
                    const matching = entry.chyrons.filter(c => filterFn(c));
                    if (matching.length === 0) continue;
                    matching.sort((a, b) => (a.tc || "").localeCompare(b.tc || ""));
                    log(`📌 [${label}] Marcador ${mk.fullId}: ${matching.length} chyron(s)`);
                    for (const chy of matching) {
                        const tcSeconds = getUtils().timeToSeconds(chy.tc || "000000");
                        const idealTime = mk.time + tcSeconds;
                        const placeTime = await this._snapToNearestCut(idealTime);
                        const track = trackResolver(chy, cfg);
                        const escapedName = getUtils().escape(chy.name);
                        await callJSX(`Clips.insert('${escapedName}', ${track}, ${placeTime}, null, 'video')`);
                        log(`   ✅ [${label}] ${chy.name} → V${track} @ ${placeTime.toFixed(2)}s`);
                        placedCount++;
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

        placeChyronTitol: async function () {
            if (!(await getUtils().validateActiveSequence())) return;
            const cfg = FASTPASS_UI.Config.get();
            const struct = FASTPASS_UI.State.structure;
            const T_THEME = cfg.tracks.video.tematitol;
            if (!struct || struct.length === 0) {
                log("⚠️ No hi ha estructura carregada. Executa un escaneig primer.", "WARN");
                return;
            }
            try {
                const markersRaw = await callJSX('Markers.get()');
                const allMarkers = markersRaw ? JSON.parse(markersRaw) : [];
                const STRUCTURAL_RE = /^\d+[a-z]?\s*-\s*.+$/i;
                const structuralMarkers = allMarkers.filter(m => STRUCTURAL_RE.test((m.comments || "").trim()));
                if (structuralMarkers.length === 0) {
                    log("⚠️ [Titol] No hi ha marcadors estructurals.", "WARN");
                    return;
                }
                structuralMarkers.sort((a, b) => a.time - b.time);
                const structureById = {};
                for (const entry of struct) { if (entry.id) structureById[entry.id] = entry; }

                // Buscar primer marcador per saber el clipStart del bloc
                const firstMarker = structuralMarkers[0];
                const clipV1 = await this._findClipAtTime(firstMarker.time);
                const clipStart = clipV1 ? clipV1.start : firstMarker.time;

                // Detectar si hi ha conductor a V6 dins del mateix clip V1
                let hayConductor = false;
                let conductPos = 0;
                const MIN_MARGEN_CASA = 0.40 + 6.24 + 4.40; // ~11.04s
                try {
                    const v6Count = parseInt(await callJSX(`Clips.count(${cfg.tracks.video.chyrons}, 'video')`) || '0');
                    if (v6Count > 0) {
                        const firstV6 = JSON.parse(await callJSX(`Clips.get(${cfg.tracks.video.chyrons}, 0, 'video')`));
                        if (firstV6 && firstV6.name && firstV6.name.toUpperCase().includes("CONDUCT")) {
                            hayConductor = true;
                            conductPos = firstV6.start;
                            log(`🔬 [Titol] Conductor detectat a V6 @ ${conductPos.toFixed(2)}s`);
                        }
                    }
                } catch (e) {}

                // Decidir posició: si hi ha conductor al mateix clip, calcular marge
                let placeTime = clipStart + 0.40; // per defecte 0:10
                if (hayConductor && clipV1 && Math.abs(conductPos - clipStart) < 0.5) {
                    allMarkers.sort((a, b) => a.time - b.time);
                    let nextMarkerTime = clipV1.end;
                    for (const m of allMarkers) {
                        if (m.time > firstMarker.time + 0.5) { nextMarkerTime = Math.min(nextMarkerTime, m.time); break; }
                    }
                    const margenDisponible = nextMarkerTime - clipStart;
                    if (margenDisponible >= MIN_MARGEN_CASA) {
                        placeTime = clipStart + 0.40; // Cas A: Tema‑Titol 1r
                        log(`📌 [Titol·CasA] Tema‑Titol 1r @ 0:10 = ${placeTime.toFixed(2)}s`);
                    } else {
                        placeTime = clipStart + 0.40 + 4.40; // Cas B: Tema‑Titol després a 4:20
                        log(`📌 [Titol·CasB] Tema‑Titol @ 0:10+4:10 = ${placeTime.toFixed(2)}s`);
                    }
                } else {
                    log(`📌 [Titol] Al principi @ 0:10 = ${placeTime.toFixed(2)}s`);
                }

                // Buscar el Tema‑Titol al primer element amb sufix (dp, i, f, lead) que en tingui
                const SUFFIX_PRIORITY = ['dp', 'i', 'lead', 'f'];
                let temaTitolChy = null;
                for (const mk of structuralMarkers) {
                    const rawId = (mk.comments || "").split("-")[0].trim();
                    const baseMatch = rawId.match(/^(\d+)/);
                    if (!baseMatch) continue;
                    const base = baseMatch[1];
                    let entry = structureById[rawId] || null;
                    if (!entry) {
                        for (const suf of SUFFIX_PRIORITY) {
                            if (structureById[base + suf]) { entry = structureById[base + suf]; break; }
                        }
                    }
                    if (!entry || !entry.chyrons) continue;
                    const tt = entry.chyrons.find(c =>
                        (c.rol || '').toUpperCase() === "TEMA-TITOL" || c.name.includes("Tema-Titol")
                    );
                    if (tt) { temaTitolChy = tt; break; }
                }
                if (!temaTitolChy) {
                    log("⚠️ [Titol] Cap Tema‑Titol trobat.", "WARN");
                    return;
                }

                // Calcular stretchEnd: següent Tema‑Titol o Out Point
                let nextTemaTitolTime = null;
                for (let i = 0; i < structuralMarkers.length; i++) {
                    const m = structuralMarkers[i];
                    if (m.time > firstMarker.time + 0.5) {
                        const rawId = (m.comments || "").split("-")[0].trim();
                        const baseMatch = rawId.match(/^(\d+)/);
                        if (baseMatch) {
                            let entry = structureById[rawId] || null;
                            if (!entry) {
                                for (const suf of SUFFIX_PRIORITY) {
                                    if (structureById[baseMatch[1] + suf]) { entry = structureById[baseMatch[1] + suf]; break; }
                                }
                            }
                            if (entry && entry.chyrons && entry.chyrons.some(c =>
                                (c.rol || '').toUpperCase() === "TEMA-TITOL" || c.name.includes("Tema-Titol")
                            )) {
                                nextTemaTitolTime = m.time; break;
                            }
                        }
                    }
                }
                let seqOutTime = null;
                try { seqOutTime = parseFloat(await callJSX("Timeline.getOut()") || "0"); } catch (e) {}
                const stretchEnd = nextTemaTitolTime || (seqOutTime > 0 ? seqOutTime : null);
                log(`📌 [Titol] stretchEnd=${stretchEnd !== null ? stretchEnd.toFixed(2) : 'final'}`);

                try {
                    const freezeResult = await this._freezeTemaTitol(temaTitolChy.name, placeTime, stretchEnd, temaTitolChy.name);
                    if (freezeResult && freezeResult.success) {
                        log(`   🖼️ [Titol] Tema‑Titol col·locat: ${freezeResult.duration.toFixed(1)}s`);
                        getUtils().status("Tema‑Titol col·locat", "exito");
                    }
                } catch (freezeErr) {
                    log(`   ❌ [Titol] Freeze fallit: ${freezeErr.message}`, "ERROR");
                }
            } catch (e) { getUtils().handleError(e, "Titol"); }
        },

        _findClipAtTime: async function(timeSec) {
            const clips = await getClipsLogic().getTrackClips(1, "video");
            for (const cl of clips) {
                if (cl.start <= timeSec && cl.end > timeSec) return cl;
            }
            return null;
        },

        placeChyronConductor: async function () {
            if (!(await getUtils().validateActiveSequence())) return;
            const cfg = FASTPASS_UI.Config.get();
            const T_CHY = cfg.tracks.video.chyrons;

            const conductorSelect = document.getElementById('conductor');
            const conductorFile = conductorSelect ? conductorSelect.value : null;
            if (!conductorFile) {
                log("⚠️ [Conductor] No hi ha conductor seleccionat al desplegable.", "WARN");
                getUtils().status("Selecciona un conductor", "warn");
                return;
            }
            log(`👤 [Conductor] Fitxer: ${conductorFile}`);

            // Constants (30 fps → correcte)
            const MARGEN_INICIO = 0.40;         // 0:10
            const DUR_CONDUCTOR = 4.40;         // 4:10
            const DUR_TEMA_TITOL = 6.24;        // 6:06
            const MIN_MARGEN_CASA = 0.40 + 6.24 + 4.40; // ~11.04s

            try {
                const markersRaw = await callJSX('Markers.get()');
                const allMarkers = markersRaw ? JSON.parse(markersRaw) : [];
                const STRUCTURAL_RE = /^\d+[a-z]?\s*-\s*.+$/i;
                const structuralMarkers = allMarkers.filter(m => STRUCTURAL_RE.test((m.comments || "").trim()));
                if (structuralMarkers.length === 0) {
                    log("⚠️ [Conductor] No hi ha marcadors estructurals.", "WARN");
                    return;
                }
                structuralMarkers.sort((a, b) => a.time - b.time);

                // Buscar PRIMER marcador que es pugui aparellar amb l'estructura (per ID directe o base numèrica)
                const SUFFIX_ORDER = ['dp', 'i', 'dir', 'lead', 'f', 'Chy', 'GF1', 'TE2'];
                let targetTime = null;
                let targetId = null;
                for (const m of structuralMarkers) {
                    const rawId = (m.comments || "").split("-")[0].trim();
                    const baseMatch = rawId.match(/^(\d+)/);
                    if (!baseMatch) continue;
                    const base = baseMatch[1];
                    // Provar coincidència directa primer
                    if (structureById[rawId]) { targetTime = m.time; targetId = rawId; break; }
                    // Provar per sufixos
                    for (const suf of SUFFIX_ORDER) {
                        if (structureById[base + suf]) { targetTime = m.time; targetId = base + suf; break; }
                    }
                    if (targetTime !== null) break;
                }
                if (targetTime === null) {
                    log("⚠️ [Conductor] Cap marcador aparellable amb l'estructura.", "WARN");
                    return;
                }
                log(`🔬 [Conductor] Marcador guia: ${targetId} @ ${targetTime.toFixed(2)}s`);

                // Clip V1 on cau aquest marcador
                const clips = await getClipsLogic().getTrackClips(1, "video");
                let clipV1 = null;
                for (const cl of clips) {
                    if (cl.start <= targetTime && cl.end > targetTime) {
                        clipV1 = cl;
                        break;
                    }
                }
                if (!clipV1) {
                    log("⚠️ [Conductor] Marcador no cau sobre cap clip V1.");
                    return;
                }
                const clipStart = clipV1.start;

                // Calcular margen fins al proper marcador (TOTS, ordenats per temps)
                allMarkers.sort((a, b) => a.time - b.time);
                let nextMarkerTime = clipV1.end;
                for (const m of allMarkers) {
                    if (m.time > targetTime + 0.5) {
                        nextMarkerTime = Math.min(nextMarkerTime, m.time);
                        break;
                    }
                }
                const margenDisponible = nextMarkerTime - clipStart;
                log(`🔬 [Conductor] Clip V1: ${clipStart.toFixed(2)}s, proper marcador @ ${nextMarkerTime.toFixed(2)}s, marge=${margenDisponible.toFixed(2)}s`);

                // Decidir posició del CONDUCTOR
                let conductTime;
                let isCasoA = false;
                if (margenDisponible >= MIN_MARGEN_CASA) {
                    // Cas A: TemaTitol 1r (0:10→6:16), Conductor després (0:10+6:06=6:16)
                    isCasoA = true;
                    conductTime = clipStart + MARGEN_INICIO + DUR_TEMA_TITOL;
                    log(`📌 [Conductor] Cas A (marge ≥ ${MIN_MARGEN_CASA.toFixed(2)}s): TemaTitol 1r, Conductor @ ${conductTime.toFixed(2)}s`);
                } else {
                    // Cas B: Conductor 1r (0:10), TemaTitol després (0:10+4:10=4:20)
                    conductTime = clipStart + MARGEN_INICIO;
                    log(`📌 [Conductor] Cas B (marge < ${MIN_MARGEN_CASA.toFixed(2)}s): Conductor @ ${conductTime.toFixed(2)}s, TemaTitol anirA 0:10+4:10=4:20`);
                }

                // Col·locar conductor
                const escapedName = getUtils().escape(conductorFile);
                await callJSX(`Clips.insert('${escapedName}', ${T_CHY}, ${conductTime}, null, 'video')`);
                log(`   ✅ [Conductor] "${conductorFile}" → V6 @ ${conductTime.toFixed(2)}s`);
                getUtils().status("Conductor col·locat", "exito");

            } catch (e) { getUtils().handleError(e, "Conductor"); }
        },

        placeChyronLloc: async function () {
            await this._placeChyronsByType(
                c => c.name.includes("Lloc") || c.name.includes("Data") || (c.rol || '').toUpperCase() === "LLOCDATA",
                (c, cfg) => cfg.tracks.video.llocdata,
                "Lloc"
            );
        },

        placeChyronNom: async function () {
            await this._placeChyronsByType(
                c => (c.rol || '').toUpperCase() === "NOMCARREC" || c.name.includes("Nom") || c.name.includes("Carrec"),
                (c, cfg) => cfg.tracks.video.chyrons,
                "Nom"
            );
        },

        placeChyronTraduccio: async function () {
            if (!(await getUtils().validateActiveSequence())) return;
            const cfg = FASTPASS_UI.Config.get();
            const struct = FASTPASS_UI.State.structure;
            const T_TRAD = cfg.tracks.video.graf;
            if (!struct || struct.length === 0) {
                log("⚠️ No hi ha estructura carregada. Executa un escaneig primer.", "WARN");
                return;
            }
            try {
                const markersRaw = await callJSX('Markers.get()');
                const allMarkers = markersRaw ? JSON.parse(markersRaw) : [];
                const STRUCTURAL_COMMENTS_RE = /^\d+[a-z]?\s*-\s*.+$/i;
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
                for (const mk of markersFull) {
                    const entry = structureById[mk.fullId];
                    if (!entry || !entry.chyrons || entry.chyrons.length === 0) continue;
                    const traduccions = entry.chyrons.filter(c =>
                        (c.rol || '').toUpperCase().includes("TRADUCCIO") || c.name.toUpperCase().includes("TRADUCCIO")
                    );
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
                        let clipEnd = clipStart + 10;
                        let foundStart = false;
                        for (let ci = 0; ci < clips.length; ci++) {
                            const cl = clips[ci];
                            if (Math.abs(cl.start - clipStart) < 0.05) {
                                clipEnd = cl.end; foundStart = true;
                                let nextIdx = ci + 1;
                                while (nextIdx < clips.length && (clips[nextIdx].end - clips[nextIdx].start) < 0.5) {
                                    log(`   ⚡ [Traducció] Flash a ${clips[nextIdx].start.toFixed(2)}s`);
                                    nextIdx++;
                                }
                                if (nextIdx > ci + 1) {
                                    if (nextIdx < clips.length) clipEnd = clips[nextIdx].start;
                                    else clipEnd = clips[nextIdx - 1].end + 1.0;
                                }
                                break;
                            }
                        }
                        const clipDur = clipEnd - clipStart;
                        const extractSeq = (c) => {
                            const match = (c.rol || '').match(/\[(\d+)-\d+\]/);
                            return match ? parseInt(match[1], 10) : 999;
                        };
                        group.sort((a, b) => extractSeq(a) - extractSeq(b));
                        const N = group.length;
                        log(`   📦 [Traducció] TC=${tc}: ${N} clips @ ${clipStart.toFixed(2)}s (dur=${clipDur.toFixed(2)}s)`);
                        for (let i = 0; i < N; i++) {
                            const slotDur = clipDur / N;
                            const placeTime = clipStart + slotDur * i;
                            const placeEnd = (i === N - 1) ? clipStart + clipDur : clipStart + slotDur * (i + 1);
                            const escapedName = getUtils().escape(group[i].name);
                            await callJSX(`Clips.insert('${escapedName}', ${T_TRAD}, ${placeTime}, ${placeEnd}, 'video')`);
                            log(`      ✅ [${i+1}/${N}] → V3 @ ${placeTime.toFixed(2)}s→${placeEnd.toFixed(2)}s`);
                            placedCount++;
                        }
                    }
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
            const isTitol = c => c.name.includes("Tema-Titol") || c.name.includes("TITOL");
            const isConductor = c => (c.rol || '').toUpperCase() === "CONDUCTOR";
            const isLloc = c => c.name.includes("Lloc") || c.name.includes("Data") || (c.rol || '').toUpperCase() === "LLOCDATA";
            const isNom = c => (c.rol || '').toUpperCase() === "NOMCARREC" || c.name.includes("Nom") || c.name.includes("Carrec");
            const isTraduccio = c => (c.rol || '').toUpperCase().includes("TRADUCCIO") || c.name.toUpperCase().includes("TRADUCCIO");
            await this._placeChyronsByType(
                c => !isTitol(c) && !isConductor(c) && !isLloc(c) && !isNom(c) && !isTraduccio(c),
                (c, cfg) => cfg.tracks.video.chyrons,
                "Resto"
            );
        },

        repartirChyronTraduccio: async function () {
            if (!(await getUtils().validateActiveSequence())) return;
            const cfg = FASTPASS_UI.Config.get();
            const T_V1 = cfg.tracks.video.mp4;
            const T_V3 = cfg.tracks.video.graf;
            const struct = FASTPASS_UI.State.structure || [];
            const rolByName = new Map();
            for (const entry of struct) {
                if (entry.chyrons) {
                    for (const chy of entry.chyrons) rolByName.set(chy.name, chy.rol || '');
                }
            }
            try {
                const v1Count = parseInt(await callJSX(`Clips.count(${T_V1}, 'video')`) || '0');
                const v3Count = parseInt(await callJSX(`Clips.count(${T_V3}, 'video')`) || '0');
                const selectedV1 = [];
                for (let i = 0; i < v1Count; i++) {
                    const raw = await callJSX(`Clips.get(${T_V1}, ${i}, 'video')`);
                    if (!raw || raw === 'null') continue;
                    const clip = JSON.parse(raw);
                    if (clip.selected) selectedV1.push(clip);
                }
                const selectedV3 = [];
                for (let i = 0; i < v3Count; i++) {
                    const raw = await callJSX(`Clips.get(${T_V3}, ${i}, 'video')`);
                    if (!raw || raw === 'null') continue;
                    const clip = JSON.parse(raw);
                    if (clip.selected) selectedV3.push(clip);
                }
                log(`🎯 [Repartir] V1: ${selectedV1.length}, V3: ${selectedV3.length}`);
                if (selectedV3.length === 0 || selectedV1.length === 0) {
                    log("⚠️ [Repartir] Selecciona V3 + V1 amb Ctrl+clic.", "WARN");
                    getUtils().status("Selecciona V3 + V1", "warn");
                    return;
                }
                selectedV3.sort((a, b) => a.start - b.start);
                selectedV1.sort((a, b) => a.start - b.start);

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
                await callJSX(`Clips.clearTrack(${T_V3}, 'video')`);
                log(`   🧹 [Repartir] V3 netejat`);

                const rangeStart = selectedV1[0].start;
                const rangeEnd = selectedV1[selectedV1.length - 1].end;
                const rangeDur = rangeEnd - rangeStart;

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
                    const slotDur = rangeDur / M;
                    log(`   📐 [Repartir] Tram ${gi+1}/${groups.length}: ${N}/${M} trad. slotDur=${slotDur.toFixed(2)}s`);

                    group.sort((a, b) => extractSeq(a) - extractSeq(b));
                    const seqToChy = new Map();
                    for (const chy of group) seqToChy.set(extractSeq(chy), chy);

                    for (let s = 0; s < M; s++) {
                        const seqNum = s + 1;
                        const chy = seqToChy.get(seqNum) || null;
                        if (chy) {
                            const newStart = rangeStart + slotDur * s;
                            const newEnd = (s === M - 1) ? rangeEnd : rangeStart + slotDur * (s + 1);
                            const escapedName = getUtils().escape(chy.name);
                            await callJSX(`Clips.insert('${escapedName}', ${T_V3}, ${newStart}, ${newEnd}, 'video')`);
                            log(`      ✅ [${seqNum}/${M}] → V3 @ ${newStart.toFixed(2)}s→${newEnd.toFixed(2)}s`);
                            placedCount++;
                        } else log(`      ⬜ [${seqNum}/${M}] buit`);
                        if (s % 3 === 2) await getUtils().delay(100);
                    }
                }
                getUtils().status(`Repartit: ${placedCount} trad.`, "exito");
                log(`🎬 [Repartir] ${placedCount} trad. repartides.`, "INFO");
            } catch (e) { getUtils().handleError(e, "Repartir"); }
        }

    };

    window.FASTPASS_UI.Workflows.Chyrons = FASTPASS_UI.Workflows.Chyrons;
})();