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

    // (2026-09-22) 1 frame a 25 fps. S'usa per alinear els titulillos (entrada i revers) a la
    // rejilla de frames del timeline i per als ajustos d'1 frame de la cobertura.
    const REV_FRAME = 0.04;

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

                // (2026-09-18) Els TITOLET/INSERT no fan snap i quedaven SENSE límit
                // (doSnap=false → placeEnd=null). També s'han de limitar: final del clip
                // de V1 que conté l'instant i el SEGÜENT marcador (el que arribi abans).
                const limitNoSnap = (instant, refTime) => {
                    const ciT = this._clipAtInstant(allClipsV1, instant);
                    const nmT = nextMarkerAfter(refTime);
                    let limT = ciT ? ciT.end : null;
                    if (nmT !== null && nmT > instant + 0.1 && (limT === null || nmT < limT)) limT = nmT;
                    return (limT !== null && limT > instant) ? limT : null;
                };
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
                        if (doSnap && allClipsV1.length > 0) {
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
                        } else if (!doSnap) {
                            // TITOLET/INSERT (sense snap): abans quedaven sense cap límit.
                            const limT = limitNoSnap(placeStart, mk.time);
                            if (limT !== null) {
                                placeEnd = limT;
                                log(`   📐 [${label}] (INSERT) ${String(chy.name).substring(0, 30)}… @ ${placeStart.toFixed(2)}s → límit ${limT.toFixed(2)}s`);
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
                        const escapedName = getUtils().escape(chy.name);
                        const endParam = (placeEnd !== null) ? placeEnd.toFixed(4) : 'null';
                        await callJSX(`Clips.insert('${escapedName}', ${slot.track}, ${slot.start.toFixed(4)}, ${endParam}, 'video')`);
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
                    if (markersByBase[base] !== undefined) {
                        if (markersByBase[base] < MIN_MARKER) return { time: null, ref: 'marcador ' + base + ' a 0 → inici del bloc' };
                        return { time: markersByBase[base], ref: 'marcador ' + base + ' (base)' };
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

                let placed = 0;
                const ttPlaced = [];
                for (let i = 0; i < ttFinal.length; i++) {
                    const tt = ttFinal[i].tt;
                    const placeTime = ttFinal[i].time;
                    ttPlaced.push({ placeTime: placeTime, item: tt.item });

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

                // ── 6. TRANSICIONS amb el TEMA-TÍTOL PETIT ("titulillo") ──────────────────
                // (2026-09-21) El titulillo (~1 s, amb animació) s'usa com a transició:
                // entrant a l'inici del bloc (si el gran va després del conductor) i sortint
                // (versió invertida per ffmpeg) just abans de cada Tema-Títol gran.
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
                            placeTime = condEnd;                          // CasB: just quan acaba
                        } else {
                            placeTime = clipStart + 0.40 + 4.40;          // CasB (fallback)
                        }
                        this._lastTitolCase = (margen >= MIN_MARGEN_CASA) ? 'A' : 'B';
                        log(`📌 [Titol·Cas${margen >= MIN_MARGEN_CASA ? 'A' : 'B'}] inici del bloc @ ` +
                            `${placeTime.toFixed(2)}s` +
                            (condEnd !== null ? ` (fi del rètol conductor @ ${condEnd.toFixed(2)}s)` : ' (constant 4.40s)') +
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
         * _placeTemaTitolTransicions: Transicions amb el TEMA-TÍTOL PETIT ("titulillo").
         *
         * El titulillo és el Tema-Títol d'~1 s (qtrle amb alpha) amb animació d'entrada que
         * fins ara es descartava. La seva versió INVERTIDA (ffmpeg) fa d'animació de SORTIDA.
         * Col·locacions, a la pista de Tema-Títol:
         *   • CasB (el Tema-Títol gran va DESPRÉS del conductor): titulillo ENTRANT a l'inici
         *     del bloc + titulillo SORTINT just abans del primer gran.
         *   • Amb més d'un Tema-Títol gran: titulillo SORTINT just abans de cada següent
         *     (transició "entre temes").
         * @param {Object} p - {struct, wottIdx, ttPlaced:[{placeTime}], clipStart, track, minSec, case}
         * @returns {Promise<number>} Nombre de transicions col·locades
         */
        _placeTemaTitolTransicions: async function (p) {
            const petit = FASTPASS_UI.Logic.Project.pickTemaTitolPetit(p.struct, p.wottIdx, p.minSec);
            if (!petit) {
                log(`   ℹ️ [Titol·Petit] Cap titulillo petit (≤${p.minSec}s) al bin CHY: sense transicions.`);
                return 0;
            }
            log(`   🎬 [Titol·Petit] Titulillo triat: "${String(petit.name).substring(0, 60)}" (${petit.dur.toFixed(2)}s, id=${petit.idNum})`);
            // (2026-09-22) INVERSIÓ PEREZOSA: el titulillo NOMÉS s'envia a invertir (ffmpeg) la
            // primera vegada que realment s'ha de col·locar un revers al timeline. Si el bloc no
            // necessita cap sortida (p. ex. cas A amb un sol Tema-Títol gran), no es toca ffmpeg.
            // Abans es generava SEMPRE, encara que després no s'usés enlloc.
            let _revCache = null;
            const getRev = async () => {
                if (_revCache === null) _revCache = await this._ensureReversedTitolPetit(petit);
                return _revCache;
            };
            const durP = petit.dur;
            const insertTitol = async (name, start, label, endSec) => {
                if (!name || !(durP > 0.05) || start < p.clipStart) return false;
                const esc = getUtils().escape(name);
                const endTarget = (typeof endSec === 'number') ? endSec : (start + durP);
                const ins = await callJSX(`Clips.insert('${esc}', ${p.track}, ${start.toFixed(4)}, null, 'video')`);
                const end = await callJSX(`Clips.endAt(${p.track}, ${start.toFixed(4)}, ${endTarget.toFixed(4)}, 'video')`);
                log(`      ${label} → V${p.track} @ ${start.toFixed(2)}s→${endTarget.toFixed(2)}s (${(endTarget - start).toFixed(2)}s) [ins=${ins} · end=${end}]`);
                return true;
            };
            let n = 0;
            // a) ENTRANT (direcció normal) a l'inici del bloc — només si el gran va després del conductor
            if (p.case === 'B') {
                if (await insertTitol(petit.name, p.clipStart + 0.40, '🟢 [Titol·Petit] ENTRANT')) n++;
            }
            // b) SORTINT (versió invertida) just abans de cada Tema-Títol gran (el primer, només en CasB)
            for (let i = 0; i < p.ttPlaced.length; i++) {
                const target = p.ttPlaced[i].placeTime;
                // (2026-09-22) IN del revers ALINEAT a la rejilla de frames: amb la durada
                // estimada del wott (p. ex. 1,02 s = 25,5 frames) `target - durP` cau en un MIG
                // frame, Premiere el snapea cap enrere i el revers quedava 1 frame a l'esquerra
                // del Tema-Títol. Amb ceil() encaixa exactament contra el gran.
                const start = Math.ceil((target - durP) / REV_FRAME - 1e-6) * REV_FRAME;
                if (start < p.clipStart + 0.10) continue;
                if (i === 0 && p.case !== 'B') continue;
                // (2026-09-22) Ara sí: només invertim quan el revers ha d'anar al timeline.
                const rev = await getRev();
                if (!rev.ok) {
                    log(`   ⚠️ [Titol·Petit] Sense versió invertida: no es col·loca la sortida @ ${start.toFixed(2)}s`, 'WARN');
                    continue;
                }
                if (await insertTitol(rev.name, start, `🔴 [Titol·Petit] SORTINT (abans del gran ${i + 1}/${p.ttPlaced.length})`, target)) n++;
            }
            if (n > 0) log(`   ✨ [Titol·Petit] ${n} transició(ns) de titulillo col·locades`, 'INFO');
            return n;
        },

        /**
         * _fillTitulilloGaps (2026-09-22): "SEMPRE hi ha d'haver titulillo".
         *
         * Quan el Tema-Títol GRAN entra tard (el seu ítem és a mig bloc, cas TN_MIGDIA
         * 21/09: el gran anava a 107,88s), la pista de Tema-Títol (V5) queda BUIDA des de
         * l'inici del bloc fins a ell. Aquest mètode busca aquests buits i els omple amb la
         * identitat del programa:
         *
         *     [titulillo animat] → [congelat estirat] → [titulillo invertit] → [Tema-Títol gran]
         *
         *  - El titulillo és el Tema-Títol petit (~1s, qtrle amb alpha).
         *  - El congelat (PNG net del titulillo via Render.snapshot) permet ALLARGAR-LO fins al
         *    gran (mateixa mecànica que _freezeTemaTitol, amb el desplaçament = durada del
         *    titulillo en lloc de 8s).
         *  - El titulillo INVERTIT (ffmpeg) fa la transició d'entrada al Tema-Títol gran.
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
            // (2026-09-22) 1 frame @25fps. El titulillo NO s'ha d'estirar més enllà de la seva
            // durada real (si s'estira, el darrer frame es veu buit i "desapareix" un moment) i
            // el congelat ha d'entrar EXACTAMENT on acaba el titulillo (1 frame abans de durP,
            // si no el buit s'allarga un frame més).
            const FRAME = 0.04;
            const escapedPetit = utils.escape(petit.name);
            // (2026-09-22) INVERSIÓ PEREZOSA (vegeu _placeTemaTitolTransicions): el revers només
            // s'envia a invertir (ffmpeg) si el buit s'ha d'omplir de veritat (secció 3 del bucle).
            let _revCache = null;
            const getRev = async () => {
                if (_revCache === null) _revCache = await this._ensureReversedTitolPetit(petit);
                return _revCache;
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
                const STRUCT_RE = /^\d+[a-z]{0,3}\s*-\s*.+$/i;
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
                const bm = norm.match(/^\d+/);
                const base = bm ? bm[0] : norm;
                // El marcador a 0 no és cap posició d'emissió real (vegeu placeChyronTitol).
                if (markersById[norm] !== undefined && markersById[norm] >= 0.5) return markersById[norm];
                if (markersByBase[base] !== undefined && markersByBase[base] >= 0.5) return markersByBase[base];
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
                const sortMax = (mkTime !== null) ? mkTime : ttTime;
                const sortPosOk = (sortMax - durP) > gapStart + 0.20;
                log(`   🕳️ [Titol·Petit·cobertura] Buit de ${gapDur.toFixed(2)}s a V${T} (${gapStart.toFixed(2)}s→${zoneEnd.toFixed(2)}s): titulillo + congelat + revers` +
                    ` · sortida fins a ${sortMax.toFixed(2)}s (${mkTime !== null ? 'marcador de l\'ítem ' + ordenats[i].item : 'el gran'})` +
                    (sortPosOk ? '' : ' [sense espai per al revers]') + '.');

                // 1) Titulillo ANIMAT a l'inici del buit (acaba 1 frame abans de la seva durada real)
                await insEnd(petit.name, gapStart, gapStart + durP - FRAME, '🟢 [cobertura] titulillo ENTRANT');
                const freezeStart = gapStart + durP - FRAME;
                // REVERS (titulillo de SALIDA): el seu IN s'ALINEA a la rejilla de frames i el
                // final queda enganxat EXACTAMENT al Tema-Títol gran (endZone).
                // Amb la durada ESTIMADA del wott (p. ex. 1,02 s = 25,5 frames; el _REV.mov real
                // fa 25 frames = 1,00 s) el càlcul `endZone - durP` cau en un MIG frame (80,66 s
                // = frame 2016,5), Premiere el snapeja cap enrere i el revers quedava 1 frame a
                // l'esquerra del gran → queixa de l'usuari. Amb ceil() encaixa exacte (80,68 s).
                const reverseStart = Math.ceil((endZone - durP) / FRAME - 1e-6) * FRAME;

                // 2) CONGELAT: snapshot net del titulillo i PNG estirat fins al final de la zona
                //    (el revers el retallarà pel davant)
                if ((zoneEnd - freezeStart) > 0.40) {
                    const TEMP_TC = 600;   // 10:00:00 (mateixa tècnica que _freezeTemaTitol)
                    await callJSX(`Clips.insert('${escapedPetit}', ${T}, ${TEMP_TC}, null, 'video')`);
                    await utils.delay(300);
                    const snapTC = TEMP_TC + Math.max(0.04, durP - 0.05);
                    await callJSX(`Timeline.set(${snapTC})`);
                    await utils.delay(400);
                    const folder = await callJSX("Context.folder()");
                    const snapPath = `${folder}\\Snapshots\\freeze_titulillo_${Date.now()}.png`;
                    const snapRes = await callJSX(`Render.snapshot('${utils.escape(snapPath.replace(/\.png$/i, ''))}', ${snapTC})`);
                    await callJSX(`Timeline.set(${gapStart})`);
                    // Treure el titulillo temporal (és a TEMP_TC)
                    try {
                        const clT = await getClipsLogic().getTrackClips(T, 'video');
                        let idxT = -1;
                        for (let ci = 0; ci < clT.length; ci++) { if (Math.abs(clT[ci].start - TEMP_TC) < 0.5) { idxT = ci; break; } }
                        if (idxT >= 0) await callJSX(`Clips.remove(${T}, ${idxT}, 'video')`);
                    } catch (eDel) { }
                    if (snapRes && String(snapRes).indexOf('OK') === 0) {
                        const fName = snapPath.split("\\").pop();
                        await callJSX(`IO.importFiles('${utils.escape(JSON.stringify([snapPath]))}', 'CHY')`);
                        await insEnd(fName, freezeStart, zoneEnd, '🧊 [cobertura] congelat estirat');
                    } else {
                        log(`   ⚠️ [Titol·Petit·cobertura] Snapshot fallit (${snapRes}): buit sense congelat`, 'WARN');
                    }
                }

                // 3) Titulillo INVERTIT just abans del Tema-Títol gran (transició).
                //    (2026-09-22) Acaba a endZone = TC del MARCADOR de l'ítem.
                //    (2026-09-22) NOMÉS ARA, quan el revers va de veritat al timeline, s'envia
                //    a invertir (ffmpeg): si no hi ha buit a cobrir, no es genera res.
                if (reverseStart > gapStart + 0.20) {
                    const rev = await getRev();
                    if (rev.ok) {
                        await insEnd(rev.name, reverseStart, endZone, '🔴 [cobertura] titulillo SORTINT (acaba al marcador del gran)');
                    } else {
                        log('   ⚠️ [Titol·Petit·cobertura] Sense versió invertida: no es fa la transició al gran', 'WARN');
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
                        // Cap marcador de plató al timeline → respatller: ítem de plató de l'escaleta
                        // sense marcador propi (p. ex. el 05dp d'un donapas que OBRE el bloc).
                        targetId = String(itemPlato.num || '').trim();
                        const primerMarcadorTime = (structuralMarkers.length > 0) ? structuralMarkers[0].time : null;
                        if (primerMarcadorTime === null || primerMarcadorTime >= 2.0) {
                            isFirstItem = true;
                            targetTime = (clipsV1.length > 0) ? clipsV1[0].start : 0;
                            log(`🎙️ [Conductor] Cap marcador de plató; l'ítem ${targetId} no en té i no hi ha res marcat abans → OBRE el bloc (inici ${targetTime.toFixed(2)}s).`);
                        } else {
                            isFirstItem = false;
                            targetTime = primerMarcadorTime;
                            log('⚠️ [Conductor] Cap marcador de plató; base = primer marcador ' + targetTime.toFixed(2) + 's. Verifica la posició.', 'WARN');
                        }
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
                    // Rètols de LOCALITZACIÓ ("Directe PRESENCIAL <lloc>") i de PROGRAMES:
                    // V7 preferent (deixen V6 lliure per als noms) i V6 de reserva — COM SEMPRE.
                    // ⚠️ (2026-09-21) Aquests NO són nom-càrrec: el canvi del tipus Enviat/
                    // connexió no els ha d'afectar (petició d'usuari: "Directe_PRESENCIAL,
                    // com estava; a V6 no, a V7 estaven perfectes").
                    if (/DIRECTE[_ ]+PRESENCIAL|DIRECTE[_ ]+PROGRAMES/.test(rName) ||
                        rRol === 'PRESENCIAL' || rRol === 'PROGRAMES' ||
                        rName.indexOf('PROGRAMES') !== -1) {
                        return [V7, V6];
                    }
                    // Rètols de connexió pròpiament dits (Enviat / Directe del connector) =
                    // nom-càrrec del connector: NOMÉS V6, sense V7 de reserva (2026-09-21).
                    if (this._isConexioWott(c)) return [V6];
                    return [V6, V7];
                },
                "Resto",
                undefined,
                { dedupeTitolet: true }
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
         * @returns {number} Nombre de clips restaurats
         */
        _repararClipsV7: async function (track, snap, placed) {
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
                    log(`   ⚠️ [Repartir] no s'ha pogut llegir la pista per reparar: ${eR.message}`, "WARN");
                    return total;
                }
                let fixed = 0;
                for (const s0 of snap) {
                    const dins = placed.some(p => (s0.start < p[1] - 0.05) && (s0.end > p[0] + 0.05));
                    if (dins) {
                        log(`   ⚠️ [Repartir] "${s0.name}" (${s0.start.toFixed(2)}-${s0.end.toFixed(2)}s) no es repara: el seu lloc original l'ocupa un slot repartit`, "WARN");
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
                        log(`   🩹 [Repartir] "${s0.name}" havia estat esborrat per un insert → re-insertat @ ${s0.start.toFixed(2)}-${s0.end.toFixed(2)}s (${r2})`, "WARN");
                        fixed++; total++;
                        continue;
                    }
                    if (Math.abs(best.start - s0.start) > 0.05 || Math.abs(best.end - s0.end) > 0.05) {
                        const r = await callJSX(`Clips.moveToRange(${track}, ${best.index}, ${s0.start.toFixed(4)}, ${s0.end.toFixed(4)}, 'video')`);
                        log(`   🩹 [Repartir] "${s0.name}" tocat per un insert [${best.start.toFixed(2)}-${best.end.toFixed(2)}] → restaurat a [${s0.start.toFixed(2)}-${s0.end.toFixed(2)}]s (${r})`, "WARN");
                        fixed++; total++;
                    }
                }
                if (fixed === 0) break;
            }
            if (total > 0) log(`🩹 [Repartir] ${total} clip(s) d'altres blocs restaurats a la seva posició original.`);
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

                    // (2026-09-21) REFERÈNCIA PER TRAM: cada bloc es reparteix dins del SEU clip
                    // de V1. ABANS s'usava un únic rang global (inici del 1r clip seleccionat →
                    // final de l'últim) per a TOTS els trams → el bloc 2 es calculava amb
                    // l'inici del bloc 1 i acabava envaint el bloc veí.
                    let ref = this._clipAtInstant(selectedV1, group[0].start);
                    if (!ref) {
                        // Fallback: el clip de V1 seleccionat més proper (per centre).
                        ref = selectedV1.reduce((best, c) => {
                            const dc = Math.abs((c.start + c.end) / 2 - group[0].start);
                            const db = (best === null) ? Infinity : Math.abs((best.start + best.end) / 2 - group[0].start);
                            return (dc < db) ? c : best;
                        }, null);
                    }
                    if (!ref) {
                        log(`   ⚠️ [Repartir] Tram ${gi+1}: sense clip de referència a V1 → saltat`, "WARN");
                        continue;
                    }
                    const bStart = ref.start, bEnd = ref.end;
                    const slotNominal = (bEnd - bStart) / M;
                    // Límit de l'últim slot: final del clip de referència (V1) o SEGÜENT
                    // MARCADOR, el que estigui més a prop. Un marcador INTERN (que no arriba a
                    // l'últim slot) s'ignora: no marca el final del bloc.
                    let limit = bEnd, limitWhy = `final del clip de referència (V1) @ ${bEnd.toFixed(2)}s`;
                    const mkLim = primeraDespres(bStart + slotNominal * (M - 1));
                    if (mkLim !== null && mkLim < bEnd - 0.05) {
                        limit = mkLim;
                        limitWhy = `marcador @ ${mkLim.toFixed(2)}s (abans del final de V1 @ ${bEnd.toFixed(2)}s)`;
                    }
                    // Slots UNIFORMES fins al límit: tots (l'últim inclòs) duren el mateix.
                    const slotDur = (limit - bStart) / M;
                    if (!(slotDur > 0.2)) {
                        log(`   ⚠️ [Repartir] Tram ${gi+1}: espai insuficient (${(limit - bStart).toFixed(2)}s per a ${M} slots) → saltat`, "WARN");
                        continue;
                    }
                    log(`   📐 [Repartir] Tram ${gi+1}/${groups.length}: ${N}/${M} trad. | ref V1 [${bStart.toFixed(2)}-${bEnd.toFixed(2)}] | límit ${limit.toFixed(2)}s (${limitWhy}) | slotDur=${slotDur.toFixed(2)}s (tots iguals)`);

                    const seqToChy = new Map();
                    for (const chy of group) seqToChy.set(extractSeq(chy), chy);

                    for (let s = 0; s < M; s++) {
                        const seqNum = s + 1;
                        const chy = seqToChy.get(seqNum) || null;
                        if (!chy) { log(`      ⬜ [${seqNum}/${M}] buit`); continue; }
                        const slotStart = bStart + slotDur * s;
                        const slotEnd = bStart + slotDur * (s + 1);   // l'últim acaba exactament al límit
                        const escapedName = getUtils().escape(chy.name);
                        // Insert SENSE endSec: el JSX l'aplicaria al DARRER clip de la pista
                        // (quirk de l'API) i podria retallar traduccions d'altres blocs.
                        await callJSX(`Clips.insert('${escapedName}', ${T_TRAD}, ${slotStart.toFixed(4)}, null, 'video')`);
                        // Durada exacta del slot, per temps (immunitzat a renumeració de clips).
                        const trimRes = await callJSX(`Clips.endAt(${T_TRAD}, ${slotStart.toFixed(4)}, ${slotEnd.toFixed(4)}, 'video')`);
                        // Verificació de la durada real del clip col·locat.
                        let chkDur = null;
                        try {
                            const chkRaw = await callJSX(`Clips.at(${T_TRAD}, ${(slotStart + 0.02).toFixed(4)}, 'video')`);
                            const ck = (chkRaw && chkRaw !== 'null') ? JSON.parse(chkRaw) : null;
                            if (ck) chkDur = ck.end - ck.start;
                        } catch (eCk) { }
                        placedRanges.push([slotStart, slotEnd]);
                        placedCount++;
                        log(`      ✅ [${seqNum}/${M}] → V${T_TRAD} @ ${slotStart.toFixed(2)}→${slotEnd.toFixed(2)}s (${slotDur.toFixed(2)}s) | retall: ${trimRes}` +
                            ((chkDur !== null && Math.abs(chkDur - slotDur) > 0.15) ? ` ⚠️ durada real ${chkDur.toFixed(2)}s` : ''));
                        if (String(trimRes).indexOf('OK') !== 0) {
                            log(`      ⚠️ [Repartir] no s'ha pogut fixar la durada de la traducció @ ${slotStart.toFixed(2)}s (${trimRes})`, "WARN");
                        }
                        if (s % 3 === 2) await getUtils().delay(100);
                    }
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
