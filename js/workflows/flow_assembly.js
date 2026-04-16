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

            if (!state.structure || state.structure.length === 0) {
                log("⚠️ No hi ha estructura carregada. Avortant muntatge.");
                return;
            }

            try {
                // 1. Obtenir clips de la línia de temps
                const clips = await getClipsLogic().getTrackClips(mainTrack, "video");
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

                const struct = state.structure;
                // Fusionar bloques OFF: si hay un bloque con suffix 'f' y el siguiente tiene el mismo número base, combinarlos
                const mergedStruct = [];
                for (let i = 0; i < struct.length; i++) {
                    const block = struct[i];
                    const suffix = block.id.match(/[a-z]+$/)?.[0] || '';
                    const baseId = block.id.replace(/[a-z]+$/, '');
                    if (suffix === 'f' && i + 1 < struct.length) {
                        const nextBlock = struct[i + 1];
                        const nextBaseId = nextBlock.id.replace(/[a-z]+$/, '');
                        if (nextBaseId === baseId) {
                            // Combinar chyrons
                            const combinedChyrons = [...block.chyrons, ...nextBlock.chyrons];
                            const mergedBlock = {
                                ...block,
                                chyrons: combinedChyrons,
                                originalIds: [block.id, nextBlock.id]
                            };
                            mergedStruct.push(mergedBlock);
                            i++; // saltar el siguiente bloque
                            continue;
                        }
                    }
                    mergedStruct.push(block);
                }
                log(`📊 Estructura carregada: ${struct.length} blocs → fusionats a ${mergedStruct.length} blocs`);
                // Log detallat de cada bloc i els seus chirons
                for (const blk of mergedStruct) {
                    // log(`   Bloc ${blk.id}: ${blk.chyrons?.length || 0} chirons`);
                    if (blk.chyrons) {
                        // blk.chyrons.forEach((c, idx) => log(`      ${idx}: rol="${c.rol}", nom="${c.name}", tc="${c.tc}"`));
                    }
                }
                let clipIndex = 0;
                const clipsPerBlock = Math.max(1, Math.floor(clips.length / mergedStruct.length));
                // log(`   📐 Clips per bloc (aproximat): ${clipsPerBlock}`);

                for (let bIndex = 0; bIndex < mergedStruct.length; bIndex++) {
                    const block = mergedStruct[bIndex];

                    // Detectar sufijo (f, i, etc.)
                    const suffix = block.id.match(/[a-z]+$/)?.[0] || '';
                    const isOffF = suffix === 'f';

                    // Detectar si este bloque es un OFF_VIDEO (tiene un par "f" en la estructura)
                    const baseId = block.id.replace(/[a-z]+$/, '');
                    const offFId = baseId + 'f';
                    const hasOffF = mergedStruct.some(b => b.id === offFId);
                    const isOffVideo = hasOffF && block.id === baseId && !block.id.endsWith('f');
                    // Si el bloque es un OFF_VIDEO, forzaremos su tipo a "OFF_VIDEO" más adelante

                    // Cercar el primer clip d'aquest bloc
                    let headClip = clips[clipIndex];
                    if (!headClip) break;

                    const blockStartTime = headClip.start;
                    const blockDuration = headClip.end - headClip.start;
                    let type = getParse().classify(block, blockDuration);
                    // Sobrescribir tipo si es OFF_VIDEO
                    if (isOffVideo) {
                        type = "OFF_VIDEO";
                        log(`   🔍 Bloc ${block.id} detectat com a OFF_VIDEO (té un bloc ${offFId} a l'estructura)`);
                    }

                    log(`📦 Bloc ${block.id} (${type}) -> Clips iniciant a ${blockStartTime.toFixed(2)}s (TC: ${formatTC(blockStartTime)})`);

                    if (type === "INTRO") {
                        await this._placeIntroGfx(block, headClip, cfg.tracks.video, (bIndex === 0));
                        // Aplicar REFRAME a la Intro literalment
                        log(`   ✨ Aplicant Auto Reframe a la INTRO (V${mainTrack}:${headClip.index})`);
                        await callJSX(`Anim.reframe(${mainTrack}, ${headClip.index})`);
                        clipIndex++;
                    } else {
                        // Agrupem tots els clips que pertanyen a aquest bloc (distribució equitativa)
                        const isLastBlock = bIndex === mergedStruct.length - 1;
                        let sliceEnd;
                        if (type === "INSERT" || type === "INTRO" || type === "OFF") {
                            // Estimación de duración según tipo
                            const targetDuration = type === "INSERT" ? 11 : type === "INTRO" ? 17 : 31; // segundos
                            let accumulated = 0;
                            let i = clipIndex;
                            while (i < clips.length && accumulated < targetDuration) {
                                accumulated += clips[i].end - clips[i].start;
                                i++;
                            }
                            sliceEnd = i;
                            // Asegurar al menos un clip
                            if (sliceEnd === clipIndex) sliceEnd = clipIndex + 1;
                            log(`   🕐 Bloc ${block.id} (${type}) durada acumulada: ${accumulated.toFixed(2)}s / target ${targetDuration}s`);
                        } else {
                            sliceEnd = isLastBlock ? clips.length : clipIndex + clipsPerBlock;
                        }
                        let blockClips = clips.slice(clipIndex, sliceEnd);
                        // Si no hi ha clips, agafem l'últim clip com a fallback (no hauria de passar)
                        if (blockClips.length === 0) {
                            blockClips = [headClip];
                        }
                        let nextI = clipIndex + blockClips.length;
                        log(`   📏 Bloc ${block.id} agrupa ${blockClips.length} clips (inici ${blockClips[0].start.toFixed(2)}s, fi ${blockClips[blockClips.length-1].end.toFixed(2)}s)`);

                        // Recalcular duración total del bloque
                        const totalStart = blockClips[0].start;
                        const totalEnd = blockClips[blockClips.length-1].end;
                        const totalDuration = totalEnd - totalStart;
                        // Reclasificar con duración total (opcional)
                        const finalType = getParse().classify(block, totalDuration);
                        if (finalType !== type) {
                            log(`   🔄 Tipus revisat: ${type} -> ${finalType}`);
                        }

                        // Col·locació especial per a blocs OFF i OFF_VIDEO
                        let chyronsToPlace = block.chyrons;
                        if (isOffF) {
                            const conductorStart = await this._placeOffGfx(block, headClip, cfg.tracks.video, conductorFile);
                            if (conductorStart !== null) {
                                lastConductorTime = conductorStart;
                                conductorPlaced = true;
                            }
                            // Eliminar conductor i Tema‑Titol dels chyrons per evitar duplicació
                            chyronsToPlace = chyronsToPlace.filter(c =>
                                !((c.rol || '').toUpperCase() === "CONDUCTOR") &&
                                !c.name.includes("Tema-Titol") &&
                                !c.name.includes("TITOL")
                            );
                        }
                        if (isOffVideo) {
                            await this._placeOffVideoGfx(block, headClip, cfg.tracks.video, lastConductorTime);
                            // Eliminar Tema‑Titol dels chyrons per evitar duplicació
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

                        // Si el bloc és un INSERT (té NomCarrec i Firma) -> Reframe a tots els seus clips
                        if (result.isInsert) {
                            log(`   ✨ Aplicant Auto Reframe a INSERTS de ${block.id}`);
                            for (const clip of blockClips) {
                                await callJSX(`Anim.reframe(${mainTrack}, ${clip.index})`);
                            }
                        }

                        clipIndex = nextI;
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

            let anchors = [];
            for (const c of block.chyrons) {
                if ((c.rol || '').toUpperCase() !== "NOMCARREC") continue;
                const idealPos = clips[0].start + getUtils().timeToSeconds(c.tc);
                const candidate = clips.find(clip => clip.start <= (idealPos + 2) && clip.start >= (idealPos - 2) && (clip.end - clip.start) > 2.5);
                if (candidate) {
                    anchors.push({ delta: candidate.start - idealPos });
                }
            }

            const avgDelta = anchors.length > 0 ? (anchors.reduce((s, a) => s + a.delta, 0) / anchors.length) : 0;
            log(`      📐 Decalatge mig detectat per al bloc: ${avgDelta.toFixed(2)}s`);

            // Limpieza física de clips cortos (flash blanco) con gap <5 frames
            const maxGap = 0.2; // 5 frames a 25 fps
            const minDuration = 0.2; // clips más cortos que esto se consideran artefactos
            const frameDuration = 0.04; // 1 frame a 25 fps
            let changed = true;
            while (changed) {
                changed = false;
                for (let i = 1; i < clips.length - 1; i++) {
                    const clipB = clips[i];
                    const clipA = clips[i - 1];
                    const clipC = clips[i + 1];
                    const gapAB = clipB.start - clipA.end;
                    const durationB = clipB.end - clipB.start;
                    // Condición: gap pequeño y clipB corto (flash blanco)
                    if (gapAB < maxGap && durationB < minDuration) {
                        // Determinar hasta dónde extender clipA (final del hueco)
                        const clipD = i + 2 < clips.length ? clips[i + 2] : null;
                        let newEnd = clipD ? clipD.start : clipC.end;
                        // Si clipD existe y no hay gap significativo (clipC.end ≈ clipD.start), restar un frame para evitar solapamiento
                        if (clipD && Math.abs(clipC.end - clipD.start) < 0.001) {
                            newEnd -= frameDuration;
                        }
                        const trackIdx = tracks.video || 1;
                        const idxA = i - 1;
                        const idxB = i;
                        const idxC = i + 1;
                        log(`      🔧 Detectat flash blanco: clip ${idxB} (${clipB.start.toFixed(2)}‑${clipB.end.toFixed(2)}) amb gap ${gapAB.toFixed(2)}s. Eliminant clip ${idxB} i ${idxC}, estenent clip ${idxA} fins a ${newEnd.toFixed(2)}s`);
                        log(`      🎯 trackIdx=${trackIdx}, idxA=${idxA}, idxB=${idxB}, idxC=${idxC}`);
                        // Verificar clips en los índices antes de operar
                        const clipInfoA = await callJSX(`Clips.get(${trackIdx}, ${idxA}, 'video')`);
                        const clipInfoB = await callJSX(`Clips.get(${trackIdx}, ${idxB}, 'video')`);
                        const clipInfoC = await callJSX(`Clips.get(${trackIdx}, ${idxC}, 'video')`);
                        log(`      🔍 Clip A: ${clipInfoA}`);
                        log(`      🔍 Clip B: ${clipInfoB}`);
                        log(`      🔍 Clip C: ${clipInfoC}`);
                        try {
                            // Extender clipA
                            await callJSX(`Clips.end(${trackIdx}, ${idxA}, ${newEnd})`);
                            // Eliminar clipC (posterior) primero para mantener índices
                            await callJSX(`Clips.remove(${trackIdx}, ${idxC}, 'video')`);
                            // Eliminar clipB (flash blanco) después
                            await callJSX(`Clips.remove(${trackIdx}, ${idxB}, 'video')`);
                            // Actualizar el array en memoria
                            clipA.end = newEnd;
                            // Eliminar clipB y clipC del array (primero C, luego B para mantener índices)
                            clips.splice(i + 1, 1); // elimina clipC (posición i+1)
                            clips.splice(i, 1); // elimina clipB (ahora posición i)
                            log(`      ✅ Clip eliminat i anterior estès fins a ${newEnd.toFixed(2)}s`);
                            changed = true;
                            break; // salir del for y reiniciar while
                        } catch (err) {
                            log(`      ❌ Error en la fusió física: ${err.message}`);
                        }
                    }
                }
            }

            log(`      📋 Clips després de la neteja física: ${clips.length} clips`);
            clips.forEach((clip, idx) => {
                log(`         Clip ${idx}: start=${clip.start.toFixed(2)}, end=${clip.end.toFixed(2)}, duration=${(clip.end - clip.start).toFixed(2)}`);
            });

            // Extraer índice de segmento para traduccions
            function extractSegmentIndex(name) {
                const match = name.match(/\[(\d+)-\d+\]/);
                return match ? parseInt(match[1]) : null;
            }


            // Función auxiliar para encontrar clip contenedor (similar a NOMCARREC)
            function findCandidateClip(idealPos, tc) {
                // log(`      🔍 findCandidateClip: tc=${tc}, idealPos=${idealPos.toFixed(2)}, clips disponibles: ${clips.length}`);
                // Márgenes mínimos (segundos)
                const minMarginBefore = 0.5;   // margen respecto al inicio del clip
                const minMarginAfter = 3.0;    // margen respecto al final del clip
                // 1. Buscar clips que contengan idealPos (con pequeña tolerancia) y tengan margen suficiente
                let containerClips = clips.filter(clip =>
                    clip.start <= idealPos + 0.1 &&
                    clip.end >= idealPos - 0.1 &&
                    (clip.end - clip.start) > 2.5 &&
                    (idealPos - clip.start) >= minMarginBefore &&
                    (clip.end - idealPos) >= minMarginAfter
                );
                // log(`      🔍 containerClips trobats: ${containerClips.length}`);
                if (containerClips.length > 0) {
                    // Elegir el clip que termina antes (más corto) para evitar sobrepasar el clip base V1
                    let chosenClip = containerClips.reduce((prev, curr) => prev.end < curr.end ? prev : curr);
                    // log(`      🔍 Clip contenedor trobat per a tc ${tc}: [${chosenClip.start.toFixed(2)}-${chosenClip.end.toFixed(2)}] (seleccionat el més curt)`);
                    return chosenClip;
                }
                // 2. Si no hay clips con margen suficiente, buscar clips contenedores sin restricción de margen (fallback)
                let containerClipsFallback = clips.filter(clip =>
                    clip.start <= idealPos + 0.1 &&
                    clip.end >= idealPos - 0.1 &&
                    (clip.end - clip.start) > 2.5
                );
                if (containerClipsFallback.length > 0) {
                    let chosenClip = containerClipsFallback.reduce((prev, curr) => prev.end < curr.end ? prev : curr);
                    // log(`      ⚠️ Clip contenedor sense margè suficient, seleccionat: [${chosenClip.start.toFixed(2)}-${chosenClip.end.toFixed(2)}]`);
                    return chosenClip;
                }
                // 3. Fallback: clip cuyo inicio esté dentro de ±2 segundos
                let nearbyClip = clips.find(clip =>
                    clip.start <= (idealPos + 2) &&
                    clip.start >= (idealPos - 2) &&
                    (clip.end - clip.start) > 2.5
                );
                if (nearbyClip) {
                    // log(`      ⚠️ Clip contenedor no trobat, es fa servir clip proper: [${nearbyClip.start.toFixed(2)}-${nearbyClip.end.toFixed(2)}]`);
                    return nearbyClip;
                }
                // 4. Ultimo fallback: primer clip del bloc
                // log(`      ⚠️ No s'ha trobat clip candidat per a tc ${tc}, es fa servir el primer clip del bloc`);
                return clips[0];
            }

            // Separar chirons por tipus
            // log(`      📋 Chirons del bloc ${block.id}: ${block.chyrons.length}`);
            // block.chyrons.forEach((c, i) => log(`        ${i}: rol="${c.rol}", nom="${c.name}"`));
            const temaTitols = [];
            const traduccions = [];
            const otros = [];
            for (const c of block.chyrons) {
                if (c.name.includes("Tema-Titol") || c.name.includes("TITOL")) {
                    temaTitols.push(c);
                } else if ((c.rol || '').toUpperCase().includes("TRADUCCIO") || c.name.toUpperCase().includes("TRADUCCIO")) {
                    traduccions.push(c);
                } else {
                    otros.push(c);
                }
            }

            // Log de classificació per a depuració
            // log(`      📊 Chirons classificats: ${temaTitols.length} tema‑titols, ${traduccions.length} traduccions, ${otros.length} altres`);

            // Ordenar traduccions per segment (o per timecode com a fallback)
            traduccions.sort((a, b) => {
                const idxA = extractSegmentIndex(a.name);
                const idxB = extractSegmentIndex(b.name);
                if (idxA !== null && idxB !== null) return idxA - idxB;
                // Fallback: ordenar per timecode
                if (a.tc && b.tc) return a.tc.localeCompare(b.tc);
                // Finalment per nom
                return a.name.localeCompare(b.name);
            });

            // Determinar si el bloc és un INSERT (NomCarrec + Firma)
            let hasNom = false;
            let hasFirma = false;
            for (const c of block.chyrons) {
                if ((c.rol || '').toUpperCase() === "NOMCARREC") hasNom = true;
                if (c.name.includes("Firma")) hasFirma = true;
            }

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
                    let candidateClip = findCandidateClip(idealPos, tc);

                    const clipStart = candidateClip.start;
                    const clipEnd = candidateClip.end;
                    const clipDuration = clipEnd - clipStart;
                    const numTraduccions = grupo.length;
                    // log(`      📏 Grup tc=${tc}: idealPos=${idealPos.toFixed(2)}, clip seleccionat [${clipStart.toFixed(2)}-${clipEnd.toFixed(2)}] durada=${clipDuration.toFixed(2)}s, numTraduccions=${numTraduccions}`);

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
                        // log(`      🗣️ Traducció ${segmentIdx !== null ? `[${segmentIdx}]` : ''}: ${c.name} -> ${targetTime.toFixed(2)}s (V${targetTrack}) dins clip [${clipStart.toFixed(2)}-${clipEnd.toFixed(2)}] (durada: ${safeDuration.toFixed(2)}s)`);
                        if (i === 0) {
                            // log(`      🔍 Diagnóstic primera traducció: file='${c.name}', track=${targetTrack}, start=${targetTime.toFixed(2)}, duration=${safeDuration.toFixed(2)}, clipStart=${clipStart.toFixed(2)}, clipEnd=${clipEnd.toFixed(2)}`);
                        }
                        if (i === grupo.length - 1) {
                            // log(`      🔍 Diagnóstic última traducció: remaining=${remaining.toFixed(2)}, duration=${duration.toFixed(2)}, safeDuration=${safeDuration.toFixed(2)}, clipEnd=${clipEnd.toFixed(2)}, targetTime=${targetTime.toFixed(2)}`);
                        }
                        try {
                            const endTime = targetTime + safeDuration;
                            await callJSX(`Clips.insert('${getUtils().escape(c.name)}', ${targetTrack}, ${targetTime}, ${endTime}, 'video')`);
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
                let candidateClip = findCandidateClip(idealPos, c.tc);
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

                // Snap només per a NOMCARREC
                let placementTime = adjustedTime;
                const isNomCarrec = (c.rol || '').toUpperCase() === "NOMCARREC";
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
                } else if ((c.rol || '').toUpperCase() === "NOMCARREC") {
                    const isFirstClip = options.firstClipGlobal && Math.abs(candidateClip.start - options.firstClipGlobal.start) < 0.01;
                    placementTime = candidateClip.start + (isFirstClip ? 0.4 : 0);
                    log(`      📍 NOMCARREC col·locat a ${placementTime.toFixed(2)}s (${isFirstClip ? 'primer clip +0.4s' : 'inici del clip'})`);
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
                await callJSX(`Clips.insert('${getUtils().escape(c.name)}', ${targetTrack}, ${placementTime}, ${endTime}, 'video')`);
            }

            return { isInsert: (hasNom && hasFirma) };
        }
    };

    window.FASTPASS_UI.Workflows.Assembly = FASTPASS_UI.Workflows.Assembly;
})();
