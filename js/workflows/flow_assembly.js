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
         * Refactoritzat per usar tcRef si el manifest està disponible.
         */
        _placeMagicChyrons: async function (block, clips, tracks, options = {}) {
            log(`   🔮 Aplicant Precision Placement a ${block.id}...`);

            // 1. Carregar manifest per obtenir tcRef i item d'escaleta
            const ctx = await FASTPASS_UI.Workflows.MainButton._setupContext();
            const manifest = await FASTPASS_UI.SessionManifest.load(ctx);
            const tcRef = manifest.tcRef;
            const reader = window.EscaletaReader;

            let blockStartManual = clips[0].start;
            let avgDelta = 0;
            let usePrecision = false;
            let precisionBlockStart = 0;

            if (tcRef && tcRef.offset !== null && reader) {
                // Intentar buscar l'ítem d'escaleta que correspon a aquest bloc de rètols
                // block.id pot ser "11", "11f", etc. block.numBase és "11".
                const item = manifest.escaletaItems.find(i => i.num === block.id || i.num === block.numBase);
                if (item && item.horaEntradaOnAir) {
                    const onAirSec = reader.tcToSeconds(item.horaEntradaOnAir);
                    precisionBlockStart = (onAirSec - tcRef.mediaStart) + tcRef.offset;
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
        verifyTcRefFootprint: async function (videoItems, clips, tcRef, reader) {
            log("🦶 [Footprint] Verificant sincronia amb talls de V1...");
            if (!tcRef || !tcRef.mediaStart || tcRef.offset === null) {
                log("⚠️ [Footprint] tcRef incomplet. No es pot verificar.");
                return { confidence: 0, correction: 0 };
            }

            let matches = 0;
            let drifts = [];
            const threshold = 0.5; // ±500ms de marge per considerar match

            // Ignorem el primer ítem si és el que defineix l'inici del bloc (sempre quadra per definició)
            const testItems = videoItems.slice(1);
            if (testItems.length === 0) return { confidence: 1, correction: 0 };

            for (const item of testItems) {
                const onAirSec = reader.tcToSeconds(item.horaEntradaOnAir);
                const idealSeqPos = (onAirSec - tcRef.mediaStart) + tcRef.offset;

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
         * placePrecisionMarkers: Col·loca marcadors al timeline amb precisió OnAir.
         * Utilitza el Manifest de Sessió com a font de veritat.
         */
        placePrecisionMarkers: async function () {
            log("📍 [MARKERS] Iniciant col·locació de marcadors d'estructura...");
            const reader = window.EscaletaReader;

            // 1. Carregar context i manifest
            const mainButton = FASTPASS_UI.Workflows.MainButton;
            const ctx = await mainButton._setupContext();
            const manifest = await FASTPASS_UI.SessionManifest.load(ctx);

            if (!manifest.phases.boundsCalculated || !manifest.tcRef.mediaStart) {
                log("⚠️ [MARKERS] Manifest sense dades OnAir. No es pot procedir amb precisió.");
                return;
            }

            const tcRef = manifest.tcRef;
            const videoItems = manifest.escaletaItems.filter(l => l.teVideo && l.horaEntradaOnAir);
            const clips = await getClipsLogic().getTrackClips(1, "video");

            if (clips.length === 0) {
                log("❌ [MARKERS] No hi ha clips a V1. Avortant.");
                return;
            }

            // 2. Verificació de Footprint (Auto-ajust de tcRef.offset si hi ha un trossejat real)
            const footprint = await this.verifyTcRefFootprint(videoItems, clips, tcRef, reader);
            if (footprint.autoCorrected) {
                log(`✨ [Footprint] Aplicant auto-correcció d'offset: ${footprint.correction.toFixed(3)}s`);
                tcRef.offset += footprint.correction;
                await FASTPASS_UI.SessionManifest.save(ctx, {
                    tcRef: tcRef,
                    footprintVerification: footprint
                });
            }

            // 3. Netejar marcadors i col·locar els nous basats en OnAir
            await callJSX(`Markers.clear()`);

            let count = 0;
            for (const item of manifest.escaletaItems) {
                if (!item.horaEntradaOnAir) continue;

                const onAirSec = reader.tcToSeconds(item.horaEntradaOnAir);
                const markerPos = (onAirSec - tcRef.mediaStart) + tcRef.offset;

                if (markerPos < -0.1) continue; // Fora de seqüència (handles)

                const label = `${item.num ? item.num + ' - ' : ''}${item.titol}`;
                await callJSX(`Markers.set(${markerPos}, '${getUtils().escape(label)}')`);
                count++;
            }

            // 4. Marcadors estructurals especials (IPD, tag +++)
            for (const item of manifest.escaletaItems) {
                if (item.titol && item.titol.includes("+++")) {
                    const onAirSec = reader.tcToSeconds(item.horaEntradaOnAir);
                    const markerPos = (onAirSec - tcRef.mediaStart) + tcRef.offset;
                    if (markerPos < 0) continue;
                    await callJSX(`Markers.set(${markerPos}, 'IPD - ${getUtils().escape(item.titol)}')`);
                }
            }

            await FASTPASS_UI.SessionManifest.save(ctx, { phases: { markersPlaced: true } });
            log(`✅ [MARKERS] ${count} marcadors col·locats amb precisió OnAir.`);
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
        const id = parts[0] || `M${i + 1}`;
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
},

/**
 * placeStructureMarkers: Col·loca els marcadors d'escaleta al timeline basant-se en el JSON literal.
 * Útil si el projecte ja existia o si l'usuari ha reajustat el vídeo i vol realinear les marques.
 */
placeStructureMarkers: async function () {
    if (!(await getUtils().validateActiveSequence())) return;
    log("📍 Col·locant marcadors d'escaleta (Mode Guiat)...");

    try {
        const ctx = FASTPASS_UI.State;
        // Si ctx.progData no existe, intentar obtenerlo de los selects
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
                return;
            }
        }

        const reader = window.EscaletaReader || window.FASTPASS_UI.EscaletaReader;

        // Buscar el JSON más reciente para el programa
        const latest = await reader.findLatest(ctx.progData.archivo);
        if (!latest) {
            log("⚠️ No es troba la dades de la escaleta.", "ERROR");
            return;
        }

        const data = await reader.load(latest.path);
        if (!data) {
            log("⚠️ No s'ha pogut carregar l'escaleta.", "ERROR");
            return;
        }
        // Log de estructura JSON extraída
        log(`📋 Estructura JSON: cleanFeed=${data.cleanFeed ? '✓' : '✗'}, linies=${data.escaleta?.liniesEscaleta?.length || 0}, bloc=${ctx.bloque}`);

        let lines = reader.getLinesForBlock(data, ctx.bloque);
        const block = reader.getBlock(data, ctx.bloque);

        // Determinar el rango temporal basado en las líneas V1 (agrupacio coincidente)
        if (lines.length > 0) {
            const allLines = data.escaleta?.liniesEscaleta || [];
            // Ordenar líneas V1 por hora
            const sortedV1 = lines.slice().sort((a, b) => {
                const horaA = a.horaEntradaOnAir || a.horaEntradaPrevista;
                const horaB = b.horaEntradaOnAir || b.horaEntradaPrevista;
                return reader.tcToSeconds(horaA) - reader.tcToSeconds(horaB);
            });
            const firstStartSec = reader.tcToSeconds(sortedV1[0].horaEntradaPrevista);
            const lastEndSec = reader.tcToSeconds(sortedV1[sortedV1.length - 1].horaSortidaPrevista);

            // Filtrar todas las líneas que estén dentro de ese rango, excluyendo líneas de otros bloques y las que empiezan justo en el límite superior
            const blockLines = allLines.filter(line => {
                const horaEntrada = line.horaEntradaOnAir || line.horaEntradaPrevista;
                if (!horaEntrada || horaEntrada === "00:00:00") return false;
                const entrySec = reader.tcToSeconds(horaEntrada);
                // Excluir líneas que empiezan justo en el límite superior (pertenecen al siguiente bloque)
                if (entrySec >= lastEndSec) {

                    return false;
                }
                // Si la línea tiene agrupacio definido y no coincide con el bloque, excluir (es de otro bloque)
                const ag = line.agrupacio;
                if (ag !== null && ag !== undefined && ag.toString().trim() !== '') {
                    // Comparar case-insensitive con el bloque
                    if (ag.toString().toLowerCase() !== ctx.bloque.toLowerCase()) {

                        return false;
                    }
                }
                // Incluir solo líneas que estén dentro del rango (firstStartSec <= entrySec < lastEndSec)
                if (entrySec >= firstStartSec) {

                    return true;
                } else {

                    return false;
                }
            });

            // Reemplazar lines con el bloque completo (ya incluye las líneas V1)
            lines = blockLines;
        }

        // Ordenar línies per hora d'entrada
        lines.sort((a, b) => {
            const horaA = a.horaEntradaOnAir || a.horaEntradaPrevista;
            const horaB = b.horaEntradaOnAir || b.horaEntradaPrevista;
            return reader.tcToSeconds(horaA) - reader.tcToSeconds(horaB);
        });
        // Log de línies extretes (comentat per reduir ruido)
        // log(`🔍 [DEBUG] Línies d'escaleta extretes (${lines.length}):`);
        // lines.slice(0, 5).forEach((line, idx) => {
        //     log(`   ${idx}: num=${line.num || ''} titol=${line.titol || ''} hora=${line.horaEntradaOnAir || line.horaEntradaPrevista || ''}`);
        // });
        // if (lines.length > 5) {
        //     log(`   ... i ${lines.length - 5} més`);
        // }
        if (!block) {
            log("⚠️ El bloc no es troba al JSON.", "ERROR");
            return;
        }

        if (lines.length === 0) {
            log("⚠️ El bloc no té línies d'escaleta definides.", "WARN");
            return;
        }

        // Netejar marcadors previs
        await callJSX("Markers.clear()");

        // Obtenir dades del cleanFeed per calcular l'offset real del clip al timeline
        const cleanFeed = reader.getCleanFeed(data);
        const handles = ctx.config.handles || reader.HANDLE_SECS || 20;
        const bounds = reader.calcClipBounds(cleanFeed.mediaStart, block.in, block.out, handles, cleanFeed.mediaStop);
        const inPoint = bounds.inPoint;
        const mediaStartSec = reader.tcToSeconds(cleanFeed.mediaStart);
        const blockInSec = reader.tcToSeconds(block.in);

        // Logs de càlcul temporal (comentats per reduir ruido)
        // log(`🔍 [DEBUG] cleanFeed.mediaStart = ${cleanFeed.mediaStart} (${mediaStartSec}s)`);
        // log(`🔍 [DEBUG] block.in = ${block.in} (${blockInSec}s)`);
        // log(`🔍 [DEBUG] handles = ${handles}s`);
        // log(`🔍 [DEBUG] inPoint calculat = ${inPoint}s`);
        // log(`🔍 [DEBUG] Offset total al timeline: mediaStart + inPoint = ${mediaStartSec + inPoint}s`);
        log(`📋 Línies d'escaleta trobades: ${lines.length}`);

        // Encontrar el clip que coincide con el bloque (usando inPoint, outPoint, duración)
        const clips = await getClipsLogic().getTrackClips(1, "video");
        // Log de primers clips (comentat per reduir ruido)
        // log(`🔍 [DEBUG] Se encontraron ${clips.length} clips en pista 1. Primeros 5:`);
        // clips.slice(0, 5).forEach((clip, idx) => {
        //     log(`   Clip ${idx}: start=${clip.start.toFixed(2)}s, inPoint=${clip.inPoint.toFixed(2)}s, outPoint=${clip.outPoint.toFixed(2)}s, duration=${(clip.outPoint - clip.inPoint).toFixed(2)}s`);
        // });

        let matchedClip = null;
        if (clips.length > 0) {
            // 1. Búsqueda por inPoint (tolerancia 5 segundos)
            let minDiff = Infinity;
            for (const clip of clips) {
                const diff = Math.abs(clip.inPoint - bounds.inPoint);
                if (diff < minDiff && diff < 5) {
                    minDiff = diff;
                    matchedClip = clip;
                }
            }
            // 2. Si no, búsqueda por outPoint
            if (!matchedClip) {
                minDiff = Infinity;
                for (const clip of clips) {
                    const diff = Math.abs(clip.outPoint - bounds.outPoint);
                    if (diff < minDiff && diff < 5) {
                        minDiff = diff;
                        matchedClip = clip;
                    }
                }
            }
            // 3. Si no, búsqueda por duración (tolerancia 10 segundos)
            if (!matchedClip) {
                minDiff = Infinity;
                for (const clip of clips) {
                    const clipDuration = clip.outPoint - clip.inPoint;
                    const diff = Math.abs(clipDuration - bounds.duration);
                    if (diff < minDiff && diff < 10) {
                        minDiff = diff;
                        matchedClip = clip;
                    }
                }
            }
            // 4. Si aún no, tomar el clip con start más grande (supuestamente el último insertado)
            if (!matchedClip) {
                matchedClip = clips.reduce((latest, clip) => (clip.start > latest.start ? clip : latest), clips[0]);
                log(`⚠️ No se encontró clip por coincidencia exacta, se usará el clip con start más grande (${matchedClip.start.toFixed(2)}s).`);
            } else {
                log(`📋 Clip del bloque encontrado: start=${matchedClip.start.toFixed(2)}s`);
            }
        }
        // Función auxiliar para convertir durada (formato "0:34" o "1:00" o "0:34:00") a segundos
        const parseDurada = (str) => {
            if (!str || str === "0:00") return 0;
            const parts = str.split(':').map(Number);
            if (parts.length === 2) { // minutos:segundos
                return parts[0] * 60 + parts[1];
            } else if (parts.length === 3) { // minutos:segundos:frames (asumir 25 fps)
                return parts[0] * 60 + parts[1] + parts[2] / 25;
            } else if (parts.length === 4) { // HH:MM:SS:FF
                return parts[0] * 3600 + parts[1] * 60 + parts[2] + parts[3] / 25;
            }
            return 0;
        };

        // ============================================================
        // Función auxiliar: obtener duración efectiva en segundos
        // Prioriza duradaOnAir cuando durada es "0:00" o está vacío
        // (porque algunos items tienen durada=0 pero duradaOnAir>0,
        // como el item "01" que tiene durada "0:00" y duradaOnAir "0:33")
        // ============================================================
        const getEffectiveDuradaSec = (line) => {
            const dStr = line.durada || '';
            if (dStr === '' || dStr === '0:00') {
                const onAir = line.duradaOnAir || '0:00';
                return parseDurada(onAir);
            }
            return parseDurada(dStr);
        };

        // --- ALGORITMO DE SNAP A CORTES ---
        // Clasificación de ítem según duración y agrupacio.
        // Usa getEffectiveDuradaSec para consistencia con la separación
        // en dos fases (estructurales vs gráficos).
        const clasificarItem = (line) => {
            const dSec = getEffectiveDuradaSec(line);
            const num = (line.num || '').toLowerCase();
            // Grafismo: agrupacio=null y duración 0
            if (!line.agrupacio && dSec === 0) return 'GRAFISMO';
            // No verticalizable: agrupacio=null y duración > 0 (ROJO)
            if (!line.agrupacio && dSec > 0) return 'NO_VERTICALIZABLE';
            // LEAD: puede ser de cualquier duración, clasificar como CORTO (minDur=0)
            // para que snapToCut no exija una duración mínima de clip.
            if (num.indexOf('lead') !== -1) return 'CORTO';
            // Verticalizable: determinar categoría por duración
            if (dSec >= 30) return 'LARGO';       // ≥30s: INTRO, DIFERIT
            if (dSec >= 5) return 'MEDIO';        // ≥5s y <30s: INSERT, CONNEXIO, DONAPAS
            return 'CORTO';                       // <5s: VIDEO, IPD
        };

        // Snap a corte según categoría
        const snapToCut = (idealPos, categoria, cortes, clips, ultimoCorteUsado) => {
            const tolerancias = { LARGO: 2.0, MEDIO: 2.0, CORTO: 1.0, GRAFISMO: 1.0, NO_VERTICALIZABLE: 2.0 };
            const minDurs = { LARGO: 15, MEDIO: 5, CORTO: 0, GRAFISMO: 0, NO_VERTICALIZABLE: 0 };
            const tolerancia = tolerancias[categoria] || 2.0;
            const minDur = minDurs[categoria] || 0;

            for (let i = ultimoCorteUsado + 1; i < cortes.length; i++) {
                const corte = cortes[i];
                if (corte >= idealPos - tolerancia) {
                    const dur = clips[i].end - clips[i].start;
                    // Si es clip muy corto (<1s) y no es GRAFISMO/CORTO, saltarlo
                    if (dur < 1.0 && categoria !== 'GRAFISMO' && categoria !== 'CORTO') continue;
                    if (dur >= minDur) {
                        return { corte, idx: i };
                    }
                }
            }
            // Fallback: buscar el corte más cercano a idealPos que cumpla minDur
            let mejorCorte = idealPos;
            let mejorIdx = -1;
            let menorDistancia = Infinity;
            for (let i = ultimoCorteUsado + 1; i < cortes.length; i++) {
                const dur = clips[i].end - clips[i].start;
                // Saltar clips muy cortos (<1s) si no son GRAFISMO/CORTO
                if (dur < 1.0 && categoria !== 'GRAFISMO' && categoria !== 'CORTO') continue;
                if (dur < minDur) continue;
                const dist = Math.abs(cortes[i] - idealPos);
                if (dist < menorDistancia && dist <= 10.0) {
                    menorDistancia = dist;
                    mejorCorte = cortes[i];
                    mejorIdx = i;
                }
            }
            if (mejorIdx >= 0) {
                return { corte: mejorCorte, idx: mejorIdx };
            }
            // No hay ningún corte válido cercano: respetar la posición ideal
            return { corte: idealPos, idx: -1 };
        };

        // Preparar cortes (inicios de clip)
        const cortes = clips.map(c => c.start);
        let ultimoCorteUsado = -1;

        const extractBlockId = (num) => {
            if (!num) return '';
            const match = num.match(/^(\d+)/);
            return match ? match[1] : '';
        };

        // Acumular posiciones de marcadores colocados
        const placedMarkers = [];
        // Arrays separados para tracking de cada tipo de marcador
        const placedGraphicMarkers = [];
        const placedIpdMarkers = [];

        // ============================================================
        // Clasificar items en 3 grupos:
        // - ESTRUCTURALES: durada > 0 (usando durada literal, NO duradaOnAir)
        // - IPD: durada = 0 Y agrupacio != null (imágenes dentro de conexiones)
        // - GRAFISMOS: durada = 0 Y agrupacio = null (elementos superpuestos)
        // ============================================================
        const getRawDuradaSec = (line) => parseDurada(line.durada || '0:00');

        const structuralItems = [];
        const ipdItems = [];
        const graphicItems = [];
        for (const line of lines) {
            const horaRef = line.horaEntradaOnAir || line.horaEntradaPrevista;
            if (!horaRef || horaRef === "00:00:00") continue;
            const dSec = getRawDuradaSec(line);
            if (dSec > 0) {
                structuralItems.push(line);
            } else if (line.agrupacio && line.duradaOnAir) {
                ipdItems.push(line);
            } else {
                graphicItems.push(line);
            }
        }
        log(`📋 Items: ${structuralItems.length} estructurals, ${ipdItems.length} IPDs, ${graphicItems.length} gràfics`);

        // ============================================================
        // FASE 1: Marcadores Estructurales (duración > 0)
        // ============================================================
        // Primer marcador forzado a 00:00 sin aplicar ninguna lógica.
        // Siguientes: posición = posición_marker_anterior + duración_item_anterior
        // A cada posición se le aplica snapToCut para encontrar el frame
        // exacto de transición entre clips del timeline.
        // ============================================================
        let currentStructuralPos = 0; // acumulador aditivo para estructurales
        const structuralItemPositions = []; // paralelo a structuralItems

        for (const line of structuralItems) {
            const dSec = getEffectiveDuradaSec(line);
            const categoria = clasificarItem(line);

            // Primer marcador: forzar 00:00
            const posIdeal = (placedMarkers.length === 0) ? 0 : currentStructuralPos;

            // Aplicar snap a cortes (SOLO para estructurales)
            const resultado = snapToCut(posIdeal, categoria, cortes, clips, ultimoCorteUsado);
            const posicionFinal = resultado.corte;
            ultimoCorteUsado = resultado.idx;

            const safeT = posicionFinal.toFixed(2);
            const num = line.num || '';
            const titol = (line.titol || '').replace(/'/g, "\\'").substring(0, 60);
            const comment = `${num ? num + ' - ' : ''}${titol}`.trim();

            log(`📍 [ESTRUCTURAL] ${num}: → timeline ${safeT}s (${categoria}, ideal ${posIdeal.toFixed(2)}s)`);

            if (comment) {
                // Color: AZUL (6) si tiene agrupacio, ROJO (1) si no tiene
                const colorIdx = line.agrupacio ? 6 : 1;
                const script = `Markers.set(${safeT}, '${comment}', 'color=${colorIdx}')`;
                await callJSX(script);
                placedMarkers.push(parseFloat(safeT));
            }

            // Guardar posición para que los gráficos puedan referenciarla
            structuralItemPositions.push(posicionFinal);

            // Avanzar posición acumulada para el siguiente estructural
            // Usar la posición REAL (posicionFinal) como base, no la ideal acumulada
            currentStructuralPos = posicionFinal + dSec;
        }

        // ============================================================
        // RONDA 2: IPDs (items con duración 0 pero con agrupacio)
        // Se colocan dentro del rango de su padre estructural (conexión).
        // CON snapToCut porque producen cortes detectables en el timeline.
        // NO alteran la posición aditiva de los estructurales.
        // Color: TURQUESA (7)
        // ============================================================

        const findParentStructural = (line, allLines, structuralItems, structuralItemPositions) => {
            const lineIdx = allLines.indexOf(line);
            for (let i = lineIdx - 1; i >= 0; i--) {
                const prevLine = allLines[i];
                const prevIdx = structuralItems.indexOf(prevLine);
                if (prevIdx >= 0) {
                    const parentPos = structuralItemPositions[prevIdx];
                    let limit;
                    if (prevIdx + 1 < structuralItemPositions.length) {
                        limit = structuralItemPositions[prevIdx + 1];
                    } else {
                        const parentDur = getEffectiveDuradaSec(structuralItems[prevIdx]);
                        limit = parentPos + Math.max(parentDur, 4);
                    }
                    return { parentPos, limit, parentIdx: prevIdx };
                }
            }
            return null;
        };

        for (const line of ipdItems) {
            const parentInfo = findParentStructural(line, lines, structuralItems, structuralItemPositions);
            if (!parentInfo) continue;

            const { parentPos, limit } = parentInfo;

            // Encontrar el índice del clip del padre para buscar el SIGUIENTE corte
            // No usar ultimoCorteUsado global porque apunta al último estructural
            // (que puede estar muy lejos), no al clip donde está el padre.
            let parentCorteIdx = -1;
            for (let i = 0; i < cortes.length; i++) {
                if (cortes[i] >= parentPos) {
                    parentCorteIdx = i;
                    break;
                }
            }
            if (parentCorteIdx < 0) parentCorteIdx = ultimoCorteUsado;

            // Aplicar snapToCut desde el clip del padre
            // snapToCut busca desde parentCorteIdx + 1, que es el SIGUIENTE clip
            const resultado = snapToCut(parentPos, 'CORTO', cortes, clips, parentCorteIdx);
            let posicionFinal = resultado.corte;
            ultimoCorteUsado = resultado.idx;

            // Limitar al rango del padre
            posicionFinal = Math.min(posicionFinal, limit - 0.04);
            posicionFinal = Math.max(posicionFinal, parentPos);

            const safeT = posicionFinal.toFixed(2);
            const num = line.num || '';
            const titol = (line.titol || '').replace(/'/g, "\\'").substring(0, 60);
            const comment = `${num ? num + ' - ' : ''}${titol}`.trim();

            log(`📍 [IPD] ${num}: → timeline ${safeT}s (dins de item ${structuralItems[parentInfo.parentIdx].num})`);

            if (comment) {
                const script = `Markers.set(${safeT}, '${comment}', 'color=7')`; // TURQUESA
                await callJSX(script);
                placedMarkers.push(parseFloat(safeT));
                placedIpdMarkers.push(parseFloat(safeT));
            }
        }


        // ============================================================
        // RONDA 3: GRAFISMOS (duración === 0)
        // ============================================================
        // Se colocan DENTRO de su item padre estructural, posicionados
        // hacia el FINAL del rango del padre:
        //   - Último grafismo a 4s del límite (inicio del siguiente estructural)
        //   - Separados 4s entre sí (si el espacio lo permite)
        //   - Margen de 1/3 al inicio del padre (sin grafismos en el primer tercio)
        //   - Si no hay espacio suficiente, se comprime el spacing
        // NO se aplica snapToCut.
        // Color: AMARILLO (4)
        // ============================================================

        // 1. Agrupar grafismos por padre estructural
        const grafismosByParent = new Map(); // parentStructuralIdx → [{line, comment}]

        for (const line of graphicItems) {
            const num = line.num || '';
            const titol = (line.titol || '').replace(/'/g, "\\'").substring(0, 60);
            const comment = `${num ? num + ' - ' : ''}${titol}`.trim();
            if (!comment) continue;

            // Encontrar el item padre estructural
            const lineIdx = lines.indexOf(line);
            let parentStructuralIdx = -1;
            for (let i = lineIdx - 1; i >= 0; i--) {
                const prevLine = lines[i];
                const prevIdx = structuralItems.indexOf(prevLine);
                if (prevIdx >= 0) {
                    parentStructuralIdx = prevIdx;
                    break;
                }
            }

            // Si no hay padre, usar el primer estructural como fallback
            if (parentStructuralIdx < 0 && structuralItemPositions.length > 0) {
                parentStructuralIdx = 0;
            }

            if (parentStructuralIdx < 0) continue;

            if (!grafismosByParent.has(parentStructuralIdx)) {
                grafismosByParent.set(parentStructuralIdx, []);
            }
            grafismosByParent.get(parentStructuralIdx).push({ line, comment });
        }

        // 2. Para cada grupo de grafismos, calcular posiciones desde el final del rango
        for (const [parentIdx, grafismos] of grafismosByParent) {
            const parentPos = structuralItemPositions[parentIdx];
            const count = grafismos.length;

            // Calcular límite del rango
            let limit;
            if (parentIdx + 1 < structuralItemPositions.length) {
                limit = structuralItemPositions[parentIdx + 1];
            } else {
                const parentDur = getEffectiveDuradaSec(structuralItems[parentIdx]);
                limit = parentPos + Math.max(parentDur, 4);
            }

            const rangeTotal = limit - parentPos;

            // Margen de 1/3 al inicio del padre (sin grafismos en este margen)
            const marginStart = parentPos + rangeTotal / 3;

            // Último grafismo a 4s del límite
            const lastPos = limit - 4.0;

            // Calcular spacing entre grafismos
            const spanNeeded = 4.0 * Math.max(count - 1, 0);
            const spanAvailable = lastPos - marginStart;

            let spacing;
            if (count <= 1) {
                spacing = 0;
            } else if (spanAvailable >= spanNeeded) {
                spacing = 4.0; // Hay espacio suficiente
            } else {
                // No hay suficiente espacio: comprimir spacing
                spacing = Math.max(spanAvailable / (count - 1), 0.04);
            }

            // Colocar cada grafismo respetando el orden original de la escaleta
            // (k=0 → primer item de la escaleta → posición más cercana a marginStart)
            // (k=count-1 → último item → posición más cercana a limit)
            for (let k = 0; k < count; k++) {
                const posDesdeFinal = lastPos - spacing * (count - 1 - k);
                const posicionFinal = Math.max(marginStart + 0.04, posDesdeFinal);

                const { line, comment } = grafismos[k];
                const num = line.num || '';
                const safeT = posicionFinal.toFixed(2);

                log(`📍 [GRÀFIC] ${num}: → timeline ${safeT}s (dins de item ${structuralItems[parentIdx].num})`);

                const script = `Markers.set(${safeT}, '${comment}', 'color=4')`;
                await callJSX(script);
                placedMarkers.push(parseFloat(safeT));
                placedGraphicMarkers.push(parseFloat(safeT));
            }
        }

        // Resumen de aplicación en timeline
        if (placedMarkers.length > 0) {
            placedMarkers.sort((a, b) => a - b);
            const firstPos = placedMarkers[0];
            const lastPos = placedMarkers[placedMarkers.length - 1];
            log(`📍 Marcadors colocats: ${placedMarkers.length} (${formatTC(firstPos)} → ${formatTC(lastPos)})`);
            const expectedFirst = 0;
            const diff = Math.abs(firstPos - expectedFirst);
            if (diff > 1.0) {
                log(`   ⚠️ Desviación del primer marcador: ${diff.toFixed(2)}s (puede indicar offset incorrecto)`);
            }
        }

        log("✅ Marcadors d'escaleta col·locats correctament.");

        // --- LISTADO DETALLADO DE MARCADORES ---
        const markersRaw = await callJSX(`Markers.get()`);
        if (markersRaw && markersRaw !== "[]") {
            try {
                const markersList = JSON.parse(markersRaw);
                if (markersList.length > 0) {
                    markersList.sort((a, b) => a.time - b.time);
                    log(`📋 MARCADORS A TIMELINE (${markersList.length}):`);
                    markersList.forEach((m, idx) => {
                        const tc = formatTC(m.time);
                        const name = m.name || '';
                        const comment = m.comments || '';
                        log(`   Marcador ${idx}: ${tc} | "${comment}" | nom="${name}"`);
                    });
                }
            } catch (e) {
                log(`   ⚠️ Error al parsear marcadors: ${e.message}`);
            }
        }

        // Dump de tots els clips en V1 després de col·locar els marcadors
        log(`📋 CLIPS EN V1 (${clips.length}):`);
        clips.forEach((clip, idx) => {
            log(`   Clip ${idx}: start=${clip.start.toFixed(2)}s | end=${clip.end.toFixed(2)}s | dur=${(clip.end - clip.start).toFixed(2)}s | inPoint=${clip.inPoint.toFixed(2)}s | outPoint=${clip.outPoint.toFixed(2)}s`);
        });

        getUtils().status("Marcadors OK", "exito");

    } catch (e) { getUtils().handleError(e, "placeStructureMarkers"); }
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
    const latest = await reader.findLatest(programArchivo);
    if (!latest) {
        log(`⚠️ No s'ha trobat JSON d'escaleta per a ${programArchivo}`);
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
        const res = await window.FASTPASS_UI.Logic.Assembly.runGuidedAssembly();
        if (res.indexOf("OK") !== -1) {
            getUtils().status("Rètols col·locats", "exito");
        }
    } catch (e) { getUtils().handleError(e, "runGuidedAssembly"); }
}
    };

window.FASTPASS_UI.Workflows.Assembly = FASTPASS_UI.Workflows.Assembly;
}) ();

