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

        _freezeTemaTitol: async function (wottName, placeTime, stretchEnd, label) {
            const cfg = FASTPASS_UI.Config.get();
            const T_THEME = cfg.tracks.video.tematitol;
            const utils = getUtils();
            const escapedWott = utils.escape(wottName);
            const CUT_OFFSET = 8.0;
            log(`   🧊 [_freeze] wott="${wottName.substring(0, 50)}..." placeTime=${placeTime.toFixed(2)}s stretchEnd=${stretchEnd !== null ? stretchEnd.toFixed(2) : 'final'}`);
            const TEMP_TC = 600; // 10:00:00
            const cutTime = placeTime + CUT_OFFSET;

            // 1. Inserir Wott TEMPORALMENT a TC 10:00 (clip sol, sense cap altre clip)
            await callJSX(`Clips.insert('${escapedWott}', ${T_THEME}, ${TEMP_TC}, null, 'video')`);
            await utils.delay(300);

            // 2. Snapshot a 10:08 (només el Wott, sense res al voltant)
            const snapTC = TEMP_TC + CUT_OFFSET;
            await callJSX(`Timeline.set(${snapTC})`);
            await utils.delay(500);

            const folder = await callJSX("Context.folder()");
            const snapPath = `${folder}\\Snapshots\\freeze_${Date.now()}.png`;
            const snapResult = await callJSX(`Render.snapshot('${utils.escape(snapPath.replace(/\.png$/i, ''))}', ${snapTC})`);
            log(`   📸 [_freeze] Render.snapshot → ${snapResult} (path=${snapPath})`);
            
            // Tornar el cabezal a la posició original per restaurar la vista
            await callJSX(`Timeline.set(${cutTime})`);
            log(`   📍 [_freeze] Cabezal retornat a ${cutTime.toFixed(2)}s`);

            // 3. Eliminar el Wott temporal de V5
            // Esborrar NOMÉS el clip temporal (és a TEMP_TC). Amb diversos Tema‑Titol
            // col·locats, l'índex 0 seria el primer clip legítim del bloc.
            try {
                const clipsT = await getClipsLogic().getTrackClips(T_THEME, 'video');
                let idxTemp = -1;
                for (let ci = 0; ci < clipsT.length; ci++) {
                    if (Math.abs(clipsT[ci].start - TEMP_TC) < 0.5) { idxTemp = ci; break; }
                }
                if (idxTemp < 0) idxTemp = 0;
                await callJSX(`Clips.remove(${T_THEME}, ${idxTemp}, 'video')`);
                log(`   🗑️ [_freeze] Wott temporal eliminat de V5 (índex ${idxTemp})`);
            } catch (eRT) {
                log(`   ⚠️ [_freeze] No s'ha pogut eliminar el temporal: ${eRT.message}`, "WARN");
            }

            if (!snapResult || snapResult.indexOf('OK') !== 0) {
                log(`   ❌ [_freeze] Snapshot fallit: ${snapResult}`, "ERROR");
                return { success: false, duration: 0 };
            }

            // 4. Inserir ara el Wott d'animació a placeTime (0→8s)
            await callJSX(`Clips.insert('${escapedWott}', ${T_THEME}, ${placeTime}, ${cutTime}, 'video')`);
            log(`   🎞️ [_freeze] Clip animació inserit a V5 @ ${placeTime.toFixed(2)}s→${cutTime.toFixed(2)}s`);

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
         * _dedupeTitolet: Deixa NOMÉS un TITOLET per text (la versió més recent,
         * id més alt). El sistema genera variants de posició (BAIX/MIG) i versions
         * successives del mateix rètol: n'hi ha prou amb una.
         * @param {Array} list
         * @returns {Array}
         */
        _dedupeTitolet: function (list) {
            const byKey = {};
            for (const c of (list || [])) {
                const key = this._titoletKey(c.name);
                const id = FASTPASS_UI.Logic.Project._wottIdNum(c.name);
                if (byKey[key] === undefined || id > byKey[key].id) byKey[key] = { c: c, id: id };
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
         * Si la primera candidata està lliure s'hi queda; si no, guanya la que
         * tingui el primer forat (desplaçant l'inici si cal).
         * @returns {Promise<{track:number, start:number, moved:boolean}>}
         */
        _chooseSlot: async function (candidates, startSec, durSec, ctx) {
            const list = (Array.isArray(candidates) ? candidates : [candidates]).filter(t => t);
            if (list.length === 0) return { track: null, start: startSec, moved: false };
            const dur = Math.max(durSec || 0, 0.5);
            let best = null;
            for (const tr of list) {
                const ranges = await this._trackBusyRanges(tr, ctx);
                const free = this._firstFreeStart(ranges, startSec, dur);
                if (free <= startSec + 0.01) return { track: tr, start: startSec, moved: false };
                if (!best || free < best.start) best = { track: tr, start: free, moved: true };
            }
            return best || { track: list[0], start: startSec, moved: false };
        },

        /**
         * _clipAtInstant: Clip de V1 que CONTÉ l'instant donat (o el següent si cau
         * just sobre el tall). És el "clip de referència" d'un rètol.
         * @param {Array} clips - clips de V1 (getTrackClips)
         * @param {number} instant
         * @returns {{start:number,end:number}|null}
         */
        _clipAtInstant: function (clips, instant) {
            const list = clips || [];
            for (let i = 0; i < list.length; i++) {
                if (list[i].start <= instant && list[i].end > instant) return { start: list[i].start, end: list[i].end };
            }
            for (let j = 0; j < list.length; j++) {
                if (list[j].start >= instant - 0.05) return { start: list[j].start, end: list[j].end };
            }
            return null;
        },

        /**
         * _itemEndTime: Final de l'ítem d'un marcador estructural: el següent
         * marcador (amb un petit marge), o el final del clip de V1 que el conté,
         * o el final de la seqüència.
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
            try {
                const clips = await getClipsLogic().getTrackClips(1, 'video');
                const cl = (clips || []).filter(c => c.start <= mk.time && c.end > mk.time)[0];
                if (cl && cl.end > mk.time) return cl.end;
            } catch (e) { }
            try {
                const end = parseFloat(await callJSX("Timeline.getOut()") || "0");
                if (end > mk.time) return end;
            } catch (e2) { }
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
                const CHYRON_OFFSET_SEC = 0.40;   // 10 frames a 25 fps
                const CHYRON_OFFSET_FRAMES = 10;
                let allClipsV1 = [];
                try { allClipsV1 = await getClipsLogic().getTrackClips(1, 'video'); } catch (eCL) { log(`⚠️ [${label}] Sense clips de V1: ${eCL.message}`); }
                let placedCount = 0;
                for (const mk of markersFull) {
                    const entry = structureById[mk.fullId];
                    if (!entry || !entry.chyrons || entry.chyrons.length === 0) continue;
                    let matching = entry.chyrons.filter(c => filterFn(c));
                    if (matching.length === 0) continue;
                    // TITOLET: el sistema genera variants de posició i versions del
                    // mateix rètol; es deixa només la més recent de cada text.
                    if (opts && opts.dedupeTitolet) {
                        const titolets = matching.filter(c => this._isTitolet(c));
                        if (titolets.length > 1) {
                            const kept = this._dedupeTitolet(titolets);
                            log(`   🧩 [${label}] TITOLET al marcador ${mk.fullId}: ${titolets.length} fitxers → ${kept.length} rètol(s) únic(s)`);
                            matching = matching.filter(c => !this._isTitolet(c)).concat(kept);
                        }
                    }
                    matching.sort((a, b) => (a.tc || "").localeCompare(b.tc || ""));
                    log(`📌 [${label}] Marcador ${mk.fullId}: ${matching.length} chyron(s)`);
                    // TITOLET: el tc del nom no és fiable (sempre 00.00/00.01) → es
                    // reparteixen dins del seu ítem, tots a la mateixa pista i sense pisar-se.
                    const titolGroup = matching.filter(c => this._isTitolet(c));
                    const itemEnd = (titolGroup.length > 0) ? await this._itemEndTime(mk, markersFull) : null;
                    for (const chy of matching) {
                        const isTit = this._isTitolet(chy);
                        let idealTime, doSnap = true;
                        if (isTit && itemEnd && itemEnd > mk.time) {
                            const n = titolGroup.length;
                            const i = titolGroup.indexOf(chy);
                            const slot = (itemEnd - mk.time) / n;
                            idealTime = mk.time + (i * slot);
                            doSnap = false;
                            log(`   🧩 [${label}] TITOLET ${i + 1}/${n} sense tc fiable → repartit dins l'ítem ${mk.fullId} ` +
                                `(${mk.time.toFixed(2)}s → ${itemEnd.toFixed(2)}s, pas ${slot.toFixed(1)}s)`);
                        } else {
                            const baseTime = this._baseTimeForChyron(chy, mk, allMarkers);
                            idealTime = baseTime + getUtils().timeToSeconds(chy.tc || "000000");
                        }
                        const snapped = doSnap ? await this._snapToNearestCut(idealTime) : idealTime;
                        const durInfo = FASTPASS_UI.Logic.Project._resolveWottDur(wottIdx, chy);

                        // Clip de referència = el clip de V1 que conté l'instant ideal.
                        // El rètol hi entra 10 frames després del seu inici i S'ACURTA
                        // si el clip s'acaba abans que el wott. MAI s'allarga: si el
                        // wott és més curt que el clip, conserva la seva durada pròpia
                        // (regla de l'usuari, 16/09).
                        let placeStart = snapped, placeEnd = null;
                        if (doSnap && allClipsV1.length > 0) {
                            const ci = this._clipAtInstant(allClipsV1, snapped);
                            if (ci) {
                                const durOwn = (durInfo.dur > 0) ? durInfo.dur : null;   // si no es resol, mana el media
                                placeStart = ci.start + CHYRON_OFFSET_SEC;
                                placeEnd = (durOwn === null) ? null : Math.min(ci.end, placeStart + durOwn);
                                const trimmed = (durOwn !== null && placeStart + durOwn > ci.end + 0.001);
                                log(`   📐 [${label}] ${String(chy.name).substring(0, 34)}… → clip [${ci.start.toFixed(2)}-${ci.end.toFixed(2)}] → entra a ${placeStart.toFixed(2)}s (+${CHYRON_OFFSET_FRAMES}f), surt a ${(placeEnd === null ? placeStart + Math.max(durInfo.dur, 0.5) : placeEnd).toFixed(2)}s` +
                                    (trimmed ? ' (acurtat: el clip s\'acaba abans)' : ' (durada pròpia del wott)'));
                            }
                        }
                        const chyronDur = (placeEnd !== null) ? Math.max(0.5, placeEnd - placeStart) : durInfo.dur;
                        const slot = await this._chooseSlot(trackResolver(chy, cfg), placeStart, chyronDur, ctx);
                        if (!slot.track) {
                            log(`   ⚠️ [${label}] Sense pista disponible per a ${chy.name}`, "WARN");
                            continue;
                        }
                        if (placeEnd !== null && slot.moved) {
                            const ci2 = this._clipAtInstant(allClipsV1, slot.start);
                            if (ci2) placeEnd = (durInfo.dur > 0) ? Math.min(ci2.end, slot.start + durInfo.dur) : null;
                        }
                        const escapedName = getUtils().escape(chy.name);
                        const endParam = (placeEnd !== null) ? placeEnd.toFixed(4) : 'null';
                        await callJSX(`Clips.insert('${escapedName}', ${slot.track}, ${slot.start.toFixed(4)}, ${endParam}, 'video')`);
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
                const STRUCTURAL_RE = /^\d+[a-z]{0,3}\s*-\s*.+$/i;
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
                    const baseM = norm.match(/^\d+/);
                    const base = baseM ? baseM[0] : norm;
                    if (markersById[norm] !== undefined) return { time: markersById[norm], ref: 'marcador ' + norm };
                    if (markersByBase[base] !== undefined) return { time: markersByBase[base], ref: 'marcador ' + base + ' (base)' };
                    return { time: null, ref: 'inici del bloc' };
                };

                let placed = 0;
                for (let i = 0; i < ttList.length; i++) {
                    const tt = ttList[i];
                    const tcSec = getUtils().timeToSeconds(tt.tc || "000000");
                    const refInfo = markerTimeFor(tt.item);
                    const placeTime = (refInfo.time !== null) ? (refInfo.time + tcSec) : startOfBlock;

                    // Final del freeze: el següent Tema‑Titol gran, o el final del bloc
                    let stretchEnd = null;
                    if (i < ttList.length - 1) {
                        const nextRef = markerTimeFor(ttList[i + 1].item);
                        if (nextRef.time !== null) {
                            stretchEnd = nextRef.time + getUtils().timeToSeconds(ttList[i + 1].tc || "000000");
                        }
                    }
                    if (stretchEnd === null) stretchEnd = (seqEnd && seqEnd > 0) ? seqEnd : null;

                    log(`📌 [Titol] ${i + 1}/${ttList.length} "${String(tt.name).substring(0, 60)}" → ${placeTime.toFixed(2)}s (${refInfo.ref}) · freeze fins ${stretchEnd !== null ? stretchEnd.toFixed(2) + 's' : 'final'}`);

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
                        const margen = nextMarkerTime - clipStart;
                        placeTime = (margen >= MIN_MARGEN_CASA) ? (clipStart + 0.40) : (clipStart + 0.40 + 4.40);
                        log(`📌 [Titol·Cas${margen >= MIN_MARGEN_CASA ? 'A' : 'B'}] inici del bloc @ ${placeTime.toFixed(2)}s`);
                    }
                }
            } catch (e) { }
            return placeTime;
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
         *  - num amb sufix de plató: i, dp, dir, lead, f, off (els vídeos no en tenen)
         *  - o el títol comença per tokens de presentació (OFF/DONA PAS/CONN/INTRO...)
         */
        _isPresenterLine: function (line) {
            if (!line) return false;
            var num = String(line.num || '').toLowerCase().trim();
            var m = num.match(/^\d+(.*)$/);
            if (m && m[1]) {
                var suf = m[1];
                if (suf === 'i' || suf === 'dp' || suf === 'dir' || suf === 'lead' || suf === 'f' || suf === 'off') {
                    return true;
                }
            }
            return this._isPresenterTitle(line.titol) || this._isPresenterTitle(line.tipus || line.font);
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
            const conductorFile = conductorSelect ? conductorSelect.value : null;
            if (!conductorFile) {
                log("⚠️ [Conductor] No hi ha conductor seleccionat al desplegable.", "WARN");
                getUtils().status("Selecciona un conductor", "warn");
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

                // ── Trobar l'ítem de PLATÓ on col·locar el conductor ─────────────
                // El conductor va sobre el PRIMER ítem de plató/presentació del bloc
                // (donapas/off/intro/directe...), que pot NO tenir marcador propi
                // (p. ex. el 05dp d'un donapas que obra el bloc). Per això es llegeix
                // l'escaleta del bloc (AssemblyContext), no només els marcadors.
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

                const findMarkerByPrefix = function (num) {
                    if (!num) return null;
                    const key = String(num).toLowerCase();
                    return structuralMarkers.find(function (mk) {
                        const pre = (mk.comments || "").split("-")[0].trim().toLowerCase();
                        return pre === key;
                    }) || null;
                };

                let itemPlato = null;
                let isFirstItem = false;
                let targetId = null;
                let targetTime = null;

                if (linesEsc && linesEsc.length > 0) {
                    // 1) Primer ítem de plató de l'escaleta del bloc.
                    for (let li = 0; li < linesEsc.length; li++) {
                        if (this._isPresenterLine(linesEsc[li])) {
                            itemPlato = linesEsc[li];
                            break;
                        }
                    }
                    if (!itemPlato) {
                        log('⏭️ [Conductor] Cap ítem de plató (donapas/off/intro/directe...) a l\'escaleta del bloc. Ometent conductor.', 'WARN');
                        getUtils().status('Bloc sense presentador: conductor omès', 'warn');
                        return;
                    }
                    targetId = String(itemPlato.num || '').trim();
                    const mkPlato = findMarkerByPrefix(targetId);
                    const primerMarcadorTime = (structuralMarkers.length > 0) ? structuralMarkers[0].time : null;
                    if (mkPlato) {
                        targetTime = mkPlato.time;
                        // És l'ítem que OBRE el bloc si no hi ha cap marcador estructural anterior.
                        isFirstItem = !structuralMarkers.some(function (sm) { return sm.time < mkPlato.time - 0.05; });
                        log(`[Conductor] ítem de plató: ${targetId} @ marcador ${targetTime.toFixed(2)}s${isFirstItem ? ' (OBRE el bloc)' : ''}`);
                    } else if (primerMarcadorTime === null || primerMarcadorTime >= 2.0) {
                        // Plató sense marcador propi i sense cap ítem marcat a l'inici
                        // (p. ex. el 05dp d'un donapas que OBRE el bloc) → va a l'inici
                        // del clip del bloc, on surt la presentadora.
                        isFirstItem = true;
                        targetTime = (clipsV1.length > 0) ? clipsV1[0].start : 0;
                        log(`🎙️ [Conductor] ítem de plató ${targetId} sense marcador propi i sense ítems previs marcats → OBRE el bloc (inici ${targetTime.toFixed(2)}s).`);
                    } else {
                        // Plató posterior sense marcador propi: cas poc habitual; base = primer marcador.
                        isFirstItem = false;
                        targetTime = primerMarcadorTime;
                        log('⚠️ [Conductor] ítem de plató posterior sense marcador propi; base ' + targetTime.toFixed(2) + 's. Verifica la posició.', 'WARN');
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
                // placeChyronTitol col·loca el Tema-Titol amb la regla
                //     marcador de l'ítem + tc del nom     (01i: 0.00 + 1.00 = 1.00s)
                // i el conductor ha d'anar JUST DESPRÉS d'ell. Abans es calculava amb
                // marges fixos (clipStart + 0:10 + 6:06 = 6.64s) i, com que el TT real
                // anava a 1.00s, el conductor entrava 0.60s abans d'hora (havia de ser
                // 7:06 = 7.24s). Com que els chyrons "màgics" es col·loquen a partir
                // d'aquest instant, l'error s'arrossegava a tota la resta.
                let ttPlaceTime = null;
                try {
                    const idxTT = await FASTPASS_UI.Logic.Project.getWottIndex();
                    const minTT = (typeof cfg.temaTitolMinSec === 'number') ? cfg.temaTitolMinSec : 4.0;
                    const ttList = FASTPASS_UI.Logic.Project.pickTemaTitols(struct, idxTT, minTT);
                    const normTarget = FASTPASS_UI.Logic.Project.normItemId(targetId);
                    for (let tti = 0; tti < ttList.length; tti++) {
                        if (FASTPASS_UI.Logic.Project.normItemId(ttList[tti].item) !== normTarget) continue;
                        const tcSecTT = getUtils().timeToSeconds(ttList[tti].tc || "000000");
                        ttPlaceTime = targetTime + tcSecTT;
                        log(`🎯 [Conductor] Tema‑Titol de plató "${String(ttList[tti].name).substring(0, 40)}" @ ${ttPlaceTime.toFixed(2)}s (marcador ${targetTime.toFixed(2)} + tc ${tcSecTT.toFixed(2)})`);
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

                    if (ttPlaceTime !== null && (clipEnd - (ttPlaceTime + DUR_TEMA_TITOL)) >= 0.5) {
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
                } else if (ttPlaceTime !== null) {
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
                log(`   ✅ [Conductor] "${conductorFile}" → V6 @ ${conductTime.toFixed(2)}s`);
                getUtils().status("Conductor col·locat", "exito");

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
            await this._placeChyronsByType(
                c => (c.rol || '').toUpperCase() === "NOMCARREC" || c.name.includes("Nom") || c.name.includes("Carrec"),
                (c, cfg) => [cfg.tracks.video.chyrons, cfg.tracks.video.lloc || cfg.tracks.video.llocdata],
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
                            log(`      ✅ [${i+1}/${N}] → V7 @ ${placeTime.toFixed(2)}s→${placeEnd.toFixed(2)}s`);
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
                    const V6 = cfg.tracks.video.chyrons;
                    const V7 = cfg.tracks.video.lloc || cfg.tracks.video.llocdata || 7;
                    // TITOLET (grafismes de l'INSERT): tots a V7, repartits dins del seu
                    // ítem (el tc del nom no és fiable i no s'han de repartir de pista).
                    if (this._isTitolet(c)) return [V7];
                    // Rètols de connexió (Directe/Enviat/Presencial): V6 preferent i V7 de
                    // reserva, perquè no es trepitgin (abans tots dos anaven a V7 i se
                    // solapaven a 00.00 i 00.01 del mateix directe).
                    if (this._isConexioWott(c)) return [V6, V7];
                    // Rètols de LOCALITZACIÓ (ex: "Directe PRESENCIAL Barcelona") i de
                    // PROGRAMES: V7 preferent (deixen V6 lliure per als noms), V6 de reserva.
                    if (rName.indexOf('DIRECTE') !== -1 || rRol === 'DIRECTE' ||
                        rName.indexOf('PROGRAMES') !== -1 || rRol.indexOf('PROGRAMES') !== -1) {
                        return [V7, V6];
                    }
                    return [V6, V7];
                },
                "Resto",
                undefined,
                { dedupeTitolet: true }
            );
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
                const selectedV3 = [];
                for (let i = 0; i < v3Count; i++) {
                    const raw = await callJSX(`Clips.get(${T_TRAD}, ${i}, 'video')`);
                    if (!raw || raw === 'null') continue;
                    const clip = JSON.parse(raw);
                    if (clip.selected) selectedV3.push(clip);
                }
                log(`🎯 [Repartir] V1: ${selectedV1.length}, Trad (V7): ${selectedV3.length}`);
                if (selectedV3.length === 0 || selectedV1.length === 0) {
                    log("⚠️ [Repartir] Selecciona Trad (V7) + V1 amb Ctrl+clic.", "WARN");
                    getUtils().status("Selecciona Trad (V7) + V1", "warn");
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
                await callJSX(`Clips.clearTrack(${T_TRAD}, 'video')`);
                log(`   🧹 [Repartir] V7 (trad) netejat`);

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
                            await callJSX(`Clips.insert('${escapedName}', ${T_TRAD}, ${newStart}, ${newEnd}, 'video')`);
                            log(`      ✅ [${seqNum}/${M}] → V7 @ ${newStart.toFixed(2)}s→${newEnd.toFixed(2)}s`);
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
