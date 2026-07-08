/**
 * ============================================================================
 * WORKFLOW: CHYRONS (Conductor, Tema-Titol, Ensamblatge Guiat)
 * ============================================================================
 * Extret de flow_assembly.js durant la modularització v2.9.5 "LIPO-PRO".
 * Gestiona la inserció de conductor, chyrons i l'assemblatge automàtic
 * de rètols basat en marcadors de timeline.
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
                            block: block,
                            startTime: markerMap[block.id]
                        });
                    } else {
                        blocksWithoutMarker.push(block);
                    }
                }

                // --- Procesar bloques CON marcador ---
                for (const bwm of blocksWithMarker) {
                    const block = bwm.block;
                    const start = bwm.startTime;
                    const clipIdx = findClipIndexAtTime(start);
                    const headClip = clips[clipIdx];
                    if (!headClip) continue;

                    log(`🎬 Bloc ${block.id}: start=${start.toFixed(2)}s, clipIdx=${clipIdx}, clipDur=${(headClip.end - headClip.start).toFixed(2)}s`);

                    const cfgTracks = cfg.tracks.video;

                    // Detectar si és OFF (id acaba en "f")
                    const blockId = block.id.toLowerCase();
                    const isOffF = (blockId.length >= 2 && blockId[blockId.length - 1] === 'f');

                    if (isOffF) {
                        const conductorStart = await this._placeOffGfx(block, headClip, cfgTracks, conductorFile);
                        if (conductorStart !== null) {
                            lastConductorTime = conductorStart;
                            conductorPlaced = true;
                        }
                        await this._placeMagicChyrons(block, headClip, cfgTracks, clips, markerMap, lastConductorTime);
                    } else {
                        // INTRO / estàndard
                        await this._placeIntroGfx(block, headClip, cfgTracks);
                        await this._placeMagicChyrons(block, headClip, cfgTracks, clips, markerMap, lastConductorTime);
                    }
                }

                // --- Procesar bloques SIN marcador (usar clips directamente) ---
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
                        const conductorStart = await this._placeOffGfx(block, headClip, cfgTracks, conductorFile);
                        if (conductorStart !== null) {
                            lastConductorTime = conductorStart;
                            conductorPlaced = true;
                        }
                        await this._placeMagicChyrons(block, headClip, cfgTracks, clips, markerMap, lastConductorTime);
                    } else {
                        await this._placeIntroGfx(block, headClip, cfgTracks);
                        await this._placeMagicChyrons(block, headClip, cfgTracks, clips, markerMap, lastConductorTime);
                    }
                }

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

                log("✅ Assemblatge completat.");
            } catch (e) {
                log(`❌ Error en runAutoPlacement: ${e.message}`);
            }
        },

        /**
         * _placeIntroGfx: Col·loca gràfics d'INTRO (conductor + tema-titol).
         */
        _placeIntroGfx: async function (block, clip, tracks) {
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

        /**
         * _placeOffGfx: Gràfics de OFF (conductor + Tema-Titol en blocs amb sufix "f").
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
                const tematitol = block.chyrons.find(c => c.name.includes("Tema-Titol") || c.name.includes("TITOL"));
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
         * _placeOffVideoGfx: Gràfics de OFF_VIDEO (Tema-Titol en blocs amb vídeo).
         */
        _placeOffVideoGfx: async function (block, clip, tracks, conductorStart) {
            const start = clip.start;
            const tematitol = block.chyrons.find(c => c.name.includes("Tema-Titol") || c.name.includes("TITOL"));
            if (!tematitol) return;
            // Calcular posició relativa al conductor
            const tematitolStart = conductorStart ? conductorStart + 4.10 : start + 4.5; // marca del conductor a 4.10s
            const tematitolTrack = tracks.tematitol || tracks.chyrons;
            log(`   🎬 OFF_VIDEO (${block.id}): inserint Tema‑Titol a ${tematitolStart.toFixed(2)}s (marca del conductor)`);
            await callJSX(`Clips.insert('${getUtils().escape(tematitol.name)}', ${tematitolTrack}, ${tematitolStart}, null, 'video')`);
        },

        /**
         * _placeMagicChyrons: Col·locació precisa de chyrons amb footprint, traduccions,
         * NOMCARREC, FIRMA, Llocdata als tracks configurats.
         */
        _placeMagicChyrons: async function (block, headClip, tracks, allClips, markerMap, conductorTime) {
            if (!block.chyrons || block.chyrons.length === 0) return;

            const clipStart = headClip.start;
            const clipEnd = headClip.end;
            const clipDur = clipEnd - clipStart;

            // Filtrar chirons que ja s'han col·locat (conductor, tema-titol)
            const remaining = block.chyrons.filter(c => {
                const rol = (c.rol || '').toUpperCase();
                return rol !== "CONDUCTOR" && !c.name.includes("Tema-Titol") && !c.name.includes("TITOL");
            });

            if (remaining.length === 0) return;

            log(`   🔮 Magic chyrons (${block.id}): ${remaining.length} per col·locar a clip [${clipStart.toFixed(2)}s-${clipEnd.toFixed(2)}s]`);

            // ── Distribució bàsica dins del clip ──
            const numChyrons = remaining.length;
            const marginStart = clipStart + 1.0;
            const marginEnd = clipEnd - 1.0;
            const availableSpace = Math.max(1.0, marginEnd - marginStart);
            const spacing = availableSpace / (numChyrons + 1);

            for (let ci = 0; ci < remaining.length; ci++) {
                const chyron = remaining[ci];
                const targetTime = marginStart + spacing * (ci + 1);
                let targetTrack = tracks.chyrons;

                // ── Rols especials ──
                const rol = (chyron.rol || '').toUpperCase();
                if (rol === "NOMCARREC" || chyron.name.includes("NOMCARREC") || chyron.name.includes("NC_")) {
                    targetTrack = tracks.chyrons; // Mateix track que chyrons per defecte
                } else if (rol === "FIRMA" || chyron.name.includes("FIRMA") || chyron.name.includes("FIR_")) {
                    targetTrack = tracks.chyrons;
                } else if (rol === "LLOC" || chyron.name.includes("LLOC") || chyron.name.includes("LL_")) {
                    targetTrack = tracks.lloc || 7;
                } else if (rol === "TEMA" || rol === "TEMATITOL") {
                    targetTrack = tracks.tematitol || tracks.chyrons;
                }

                const safeName = getUtils().escape(chyron.name);
                log(`   🎯 [${block.id}] Chyron ${ci+1}/${numChyrons}: "${chyron.name}" a track ${targetTrack} @ ${targetTime.toFixed(2)}s (rol=${rol})`);
                await callJSX(`Clips.insert('${safeName}', ${targetTrack}, ${targetTime.toFixed(4)}, null, 'video')`);
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
         * _getStructureFromMarkers: Deriva una estructura de blocs a partir dels marcadors del timeline.
         */
        _getStructureFromMarkers: async function () {
            const markersRaw = await callJSX("Markers.get()");
            var markers = [];
            if (markersRaw && markersRaw !== "[]") {
                try { markers = JSON.parse(markersRaw); } catch (e) {}
            }
            if (markers.length === 0) return [];

            var structure = [];
            // Filtrar marcadors estructurals (tenen " - " al comentari)
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

                // Determinar tipus de bloc segons sufix
                var type = "video";
                if (suffix === "f" || suffix === "off") type = "off";
                else if (suffix === "i" || suffix === "intro") type = "intro";

                structure.push({
                    id: num + (suffix || ''),
                    type: type,
                    startTime: m.time,
                    chyrons: [] // sin chyrons, se inferirán más adelante
                });
            }
            log(`📊 Estructura generada a partir de ${structure.length} marcadors estructurals (ignorats ${markers.length - structure.length} no estructurals).`);
            return structure;
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
         * verifyTcRefFootprint: Verifica que el footprint del TC de referència coincideixi amb els talls V1.
         */
        verifyTcRefFootprint: async function (refTime, tolerance = 0.5) {
            const clips = await getClipsLogic().getTrackClips(1, 'video');
            if (!clips || clips.length === 0) return false;

            for (var i = 0; i < clips.length; i++) {
                var gap = Math.abs(clips[i].start - refTime);
                if (gap < tolerance) return true;
                gap = Math.abs(clips[i].end - refTime);
                if (gap < tolerance) return true;
            }
            return false;
        }
    };

    window.FASTPASS_UI.Workflows.Chyrons = FASTPASS_UI.Workflows.Chyrons;
})();