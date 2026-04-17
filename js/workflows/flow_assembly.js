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
    const formatTC = (seconds) => {
        const fps = 25;
        const totalFrames = Math.round(seconds * fps);
        const hh = Math.floor(totalFrames / (fps * 3600));
        const mm = Math.floor((totalFrames % (fps * 3600)) / (fps * 60));
        const ss = Math.floor((totalFrames % (fps * 60)) / fps);
        const ff = totalFrames % fps;
        return `${hh.toString().padStart(2, '0')}:${mm.toString().padStart(2, '0')}:${ss.toString().padStart(2, '0')}:${ff.toString().padStart(2, '0')}`;
    };

    FASTPASS_UI.Workflows.Assembly = {

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
                // Log detallat dels clips
                clips.forEach((clip, idx) => log(`   Clip ${idx}: start=${clip.start.toFixed(2)}, end=${clip.end.toFixed(2)}, duration=${(clip.end - clip.start).toFixed(2)}`));
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
                    log(`📊 Marcadors disponibles: ${Object.keys(markerMap).map(id => `${id}=${markerMap[id].toFixed(2)}s`).join(', ')}`);
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
         */
        _placeMagicChyrons: async function (block, clips, tracks, options = {}) {
            log(`   🔮 Aplicant Footprint Matching a ${block.id}...`);

            // Calcular decalatge mig (Footprint Matching) — delega a Assembly_Logic
            const avgDelta = getAssemblyLogic().calcFootprintDelta(block, clips);
            log(`      📐 Decalatge mig detectat per al bloc: ${avgDelta.toFixed(2)}s`);

            // Extraer índice de segmento para traduccions
            function extractSegmentIndex(name) {
                const match = name.match(/\[(\d+)-\d+\]/);
                return match ? parseInt(match[1]) : null;
            }

            // Classificar chyrons per tipus (delega a Assembly_Logic.classifyChyrons)
            const { temaTitols, traduccions, otros, hasNom, hasFirma } = getAssemblyLogic().classifyChyrons(block.chyrons);

            // Ordenar traduccions per segment (o per timecode com a fallback)
            traduccions.sort((a, b) => {
                const idxA = extractSegmentIndex(a.name);
                const idxB = extractSegmentIndex(b.name);
                if (idxA !== null && idxB !== null) return idxA - idxB;
                if (a.tc && b.tc) return a.tc.localeCompare(b.tc);
                return a.name.localeCompare(b.name);
            });

            // Col·locar Tema‑Titol primer (només el primer si n'hi ha més d'un)
            if (temaTitols.length > 0) {
                const c = temaTitols[0];
                const idealPos = clips[0].start + getUtils().timeToSeconds(c.tc);
                const adjustedTime = idealPos + avgDelta;
                let targetTrack = tracks.tematitol || tracks.chyrons;
                log(`      🎬 Tema‑Titol: ${c.name} -> ${adjustedTime.toFixed(2)}s (V${targetTrack})`);
                await callJSX(`Clips.insert('${getUtils().escape(c.name)}', ${targetTrack}, ${adjustedTime}, null, 'video')`);
            }

            // Col·locar traduccions dins del clip de video corresponent (distribució uniforme)
            if (traduccions.length > 0) {
                log(`      🗣️ Es col·locaran ${traduccions.length} traduccions`);
                // Usar la función findCandidateClip definida a nivel superior

                // Agrupar per timecode (tc)
                const grupos = {};
                for (const t of traduccions) {
                    if (!grupos[t.tc]) grupos[t.tc] = [];
                    grupos[t.tc].push(t);
                }

                // Processar cada grup
                for (const tc of Object.keys(grupos).sort((a, b) => a.localeCompare(b))) {
                    const grupo = grupos[tc];
                    // Ordenar dins del grup per segment index
                    grupo.sort((a, b) => {
                        const idxA = extractSegmentIndex(a.name);
                        const idxB = extractSegmentIndex(b.name);
                        if (idxA !== null && idxB !== null) return idxA - idxB;
                        return 0;
                    });

                    // Calcular posició ideal basada en el tc
                    const idealPos = clips[0].start + getUtils().timeToSeconds(tc);
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
                        log(`      🗣️ Traducció ${segmentIdx !== null ? `[${segmentIdx}]` : ''}: ${c.name} -> ${targetTime.toFixed(2)}s (V${targetTrack}) dins clip [${clipStart.toFixed(2)}  ${clipEnd.toFixed(2)}] (durada: ${safeDuration.toFixed(2)}s)`);
                        if (i === 0) {
                            log(`      🔍 Diagnóstic primera traducció: file='${c.name}', track=${targetTrack}, start=${targetTime.toFixed(2)}, duration=${safeDuration.toFixed(2)}, clipStart=${clipStart.toFixed(2)}, clipEnd=${clipEnd.toFixed(2)}`);
                        }
                        if (i === grupo.length - 1) {
                            log(`      🔍 Diagnóstic última traducció: remaining=${remaining.toFixed(2)}, duration=${duration.toFixed(2)}, safeDuration=${safeDuration.toFixed(2)}, clipEnd=${clipEnd.toFixed(2)}, targetTime=${targetTime.toFixed(2)}`);
                        }
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
                const idealPos = clips[0].start + getUtils().timeToSeconds(c.tc);
                const adjustedTime = idealPos + avgDelta;
                let candidateClip = getAssemblyLogic().findCandidateClip(clips, idealPos);
                // Forzar segundo clip para chyrons de lugar en bloques OFF
                if ((c.name.includes("Lloc") || c.name.includes("Data")) && isOffBlock && clips.length >= 2) {
                    candidateClip = clips[1];
                    log(`      🎯 Chyron de lloc forçat al segon clip (primer tall) del bloc OFF: [${candidateClip.start.toFixed(2)}-${candidateClip.end.toFixed(2)}]`);
                }

                // Evitar múltiples chyrons de lloc en el mateix clip (només rol Llocdata)
                if (c.rol === "Llocdata") {
                    const clipIdx = clips.indexOf(candidateClip);
                    log(`      📍 Llocdata clipIdx=${clipIdx}, used=${Array.from(usedLlocClips).join(',')}`);
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

                // Diagnóstico para chyrons de lugar
                if (c.name.includes("Lloc") || c.name.includes("Data")) {
                    log(`      🏞️ Chyron de lloc: ${c.name} tc=${c.tc} idealPos=${idealPos.toFixed(2)} candidateClip=[${candidateClip.start.toFixed(2)}-${candidateClip.end.toFixed(2)}]`);
                }

                // Snap només per a NOMCARREC i FIRMA
                let placementTime = adjustedTime;
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

        /**
         * Coloca marcadores en el timeline para cada bloque de la estructura carregada.
         */
        placeStructureMarkers: async function () {
            const state = FASTPASS_UI.State;
            if (!state.structure || state.structure.length === 0) {
                log("⚠️ No hi ha estructura carregada. No es poden col·locar marcadors.");
                return;
            }
            // Obtener clips de la pista principal (V1) para conocer los tiempos de inicio de cada bloque
            const clips = await getClipsLogic().getTrackClips(1, "video");
            if (clips.length === 0) {
                log("⚠️ No hi ha clips a la pista V1.");
                return;
            }
            // Log detallado de clips
            log(`📊 Clips en V1 (${clips.length}):`);
            clips.forEach((c, idx) => {
                log(`   ${idx}: start=${c.start.toFixed(2)}s, end=${c.end.toFixed(2)}s, dur=${(c.end - c.start).toFixed(2)}s`);
            });
            // Limpiar marcadores existentes
            await callJSX(`Markers.clear()`);
            // Para cada bloque, determinar su clip de inicio (asumiendo orden secuencial)
            let clipIndex = 0;
            const mergedStruct = getParse().mergeOffBlocks(state.structure);
            // Log detallado de estructura original
            log(`📊 Estructura cargada (${state.structure.length} bloques):`);
            state.structure.forEach((b, idx) => {
                log(`   ${idx}: id=${b.id}, suffix=${b.suffix}, theme=${b.theme}, chyrons=${b.chyrons.length}`);
            });
            // Log de merged structure
            log(`📊 Estructura fusionada (${mergedStruct.length} bloques):`);
            mergedStruct.forEach((b, idx) => {
                log(`   ${idx}: id=${b.id}, suffix=${b.suffix}, theme=${b.theme}, chyrons=${b.chyrons.length}`);
            });
            // Función auxiliar para convertir TC (MM.SS) a segundos
            function tcToSeconds(tc) {
                if (!tc) return 0;
                const parts = tc.split('.');
                if (parts.length !== 2) return 0;
                const minutes = parseInt(parts[0], 10);
                const seconds = parseInt(parts[1], 10);
                return minutes * 60 + seconds;
            }

            // Algoritmo de asignación de bloques a clips
            const assignedClips = new Array(mergedStruct.length).fill(-1);
            let clipCursor = 0;

            for (let i = 0; i < mergedStruct.length; i++) {
                const block = mergedStruct[i];
                const type = getParse().classify(block, 0); // la duración no influye en el tipo
                let clipIndex = -1;

                if (i === 0) {
                    // Intro: primer clip
                    clipIndex = 0;
                } else if (type === "VIDEO" && i === 1) {
                    // Bloque principal: siguiente clip después del intro
                    clipIndex = clipCursor;
                } else if (type === "INTRO" && block.suffix === "dp") {
                    // Donapas: buscar clip largo después del último chyron del bloque anterior
                    const prevBlock = mergedStruct[i-1];
                    let lastTc = 0;
                    for (const c of prevBlock.chyrons) {
                        const sec = tcToSeconds(c.tc);
                        if (sec > lastTc) lastTc = sec;
                    }
                    const minStart = lastTc + 4; // 4 segundos después
                    // encontrar primer clip con duración >8s y start >= minStart
                    for (let j = clipCursor; j < clips.length; j++) {
                        const c = clips[j];
                        if (c.start >= minStart && (c.end - c.start) > 8) {
                            clipIndex = j;
                            break;
                        }
                    }
                    if (clipIndex === -1) {
                        // fallback: siguiente clip largo después del cursor
                        for (let j = clipCursor; j < clips.length; j++) {
                            if ((clips[j].end - clips[j].start) > 8) {
                                clipIndex = j;
                                break;
                            }
                        }
                    }
                } else if (type === "CONNEXIO") {
                    // Conexión: siguiente clip largo después del donapas
                    // Suponemos que el bloque anterior es donapas
                    for (let j = clipCursor; j < clips.length; j++) {
                        if ((clips[j].end - clips[j].start) > 8) {
                            clipIndex = j;
                            break;
                        }
                    }
                } else {
                    // Por defecto: siguiente clip no asignado
                    clipIndex = clipCursor;
                }

                if (clipIndex === -1) clipIndex = clipCursor;
                if (clipIndex >= clips.length) break;

                assignedClips[i] = clipIndex;
                clipCursor = clipIndex + 1; // mover cursor después de este clip
            }

            // Colocar marcadores según la asignación
            for (let i = 0; i < mergedStruct.length; i++) {
                const clipIndex = assignedClips[i];
                if (clipIndex === -1) continue;
                const block = mergedStruct[i];
                const clip = clips[clipIndex];
                const startTime = clip.start;
                const type = getParse().classify(block, clip.end - clip.start);
                const comment = `${block.id} - ${type}`;
                log(`📍 Col·locant marcador a ${startTime.toFixed(2)}s: ${comment}`);
                await callJSX(`Markers.set(${startTime}, '${comment.replace(/'/g, "\\'")}')`);

                // Detectar Donapas y agregar marcador de CONNEXIÓ en el siguiente clip largo
                if (type === "INTRO" && block.suffix === "dp") {
                    // Buscar siguiente clip largo después de este
                    for (let j = clipIndex + 1; j < clips.length; j++) {
                        if ((clips[j].end - clips[j].start) > 8) {
                            const conexioComment = `${block.id}c - CONNEXIO`;
                            log(`📍 Col·locant marcador de CONNEXIÓ a ${clips[j].start.toFixed(2)}s: ${conexioComment}`);
                            await callJSX(`Markers.set(${clips[j].start}, '${conexioComment.replace(/'/g, "\\'")}')`);
                            break;
                        }
                    }
                }

                // Detectar chyrons con "CONNEXIÓ" (por si el bloque ya es una conexión)
                for (const c of block.chyrons) {
                    if (c.name && c.name.toUpperCase().includes("CONNEXIÓ")) {
                        const conexioComment = `${block.id} - CONNEXIO`;
                        log(`📍 Col·locant marcador de CONNEXIÓ (detectat) a ${startTime.toFixed(2)}s: ${conexioComment}`);
                        await callJSX(`Markers.set(${startTime}, '${conexioComment.replace(/'/g, "\\'")}')`);
                        break;
                    }
                }

                // Detectar chyrons con "+++" (IPD) y colocar marcadores individuales
                for (const c of block.chyrons) {
                    if (c.name && c.name.includes("+++")) {
                        const ipdComment = `${block.id} - IPD ${c.name}`;
                        log(`📍 Col·locant marcador de IPD a ${startTime.toFixed(2)}s: ${ipdComment}`);
                        await callJSX(`Markers.set(${startTime}, '${ipdComment.replace(/'/g, "\\'")}')`);
                    }
                }
            }
            log("✅ Marcadors col·locats.");
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
            for (let i = 0; i < markers.length; i++) {
                const m = markers[i];
                const comment = m.comment || '';
                // Extraer ID y tipo del comentario (formato "ID - TIPO")
                const parts = comment.split(' - ');
                const id = parts[0] || `M${i+1}`;
                const type = parts[1] || 'UNKNOWN';
                structure.push({
                    id: id,
                    type: type,
                    startTime: m.time,
                    chyrons: [] // sin chyrons, se inferirán más adelante
                });
            }
            log(`📊 Estructura generada a partir de ${structure.length} marcadors.`);
            return structure;
        }
    };

    window.FASTPASS_UI.Workflows.Assembly = FASTPASS_UI.Workflows.Assembly;
})();
