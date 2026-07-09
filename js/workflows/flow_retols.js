/**
 * ============================================================================
 * WORKFLOW: RETOLS I GRÀFICS - v2.9.5 Tactical
 * ============================================================================
 */

(function () {
    var FASTPASS_UI = window.FASTPASS_UI || {};
    FASTPASS_UI.Workflows = FASTPASS_UI.Workflows || {};

    const getUtils = () => window.FASTPASS_UI.Utils;
    const getClipsLogic = () => window.FASTPASS_UI.Logic.Clips;

    const log = (m) => getUtils().log(m, "DEBUG");
    const callJSX = (s) => getUtils().callJSX(s);

    FASTPASS_UI.Workflows.Retols = {

        /**
         * RESET GRAPHICS: Neteja total de les pistes de gràfics (Pànic button)
         */
        runResetGraphics: async function () {
            if (!(await getUtils().validateActiveSequence())) return;
            if (!confirm("Segur que vols ELIMINAR TOTS els gràfics de la línia de temps?")) return;

            log("🧹 Netejant graella de gràfics...");
            const cfg = FASTPASS_UI.Config.get();
            const tracksToClear = [
                cfg.tracks.video.tematitol, 
                cfg.tracks.video.chyrons, 
                cfg.tracks.video.llocdata,
                cfg.tracks.video.graficos
            ];

            try {
                for(let t of tracksToClear) {
                    await callJSX(`Clips.clearTrack(${t}, 'video')`);
                }
                log("✅ Gràfics eliminats correctament.", "INFO");
                getUtils().status("Gràfics Reiniciats", "exito");
            } catch (e) { getUtils().handleError(e, "ResetGraphics"); }
        },

        /**
         * CHYRONS (Marker‑guided): Col·loca els Tema‑Títols usant els marcadors de
         * timeline com a àncores. Fusiona els dos mecanismes existents:
         *   1. Lectura de marcadors estructurals via Markers.get()
         *   2. Aparellament amb state.structure[].chyrons via rawLinea
         *   3. Freeze‑frame (captura PNG → importa → estira) heretat de _placeMagicChyrons
         *
         * Operativa per Tema‑Titol:
         *   - Es col·loca a marker.time + 0.4s (frame 10) en V5
         *   - Es captura un freeze‑frame PNG que s'importa i s'estira
         *   - S'estira fins al marcador següent o fins al següent Tema‑Titol del bloc
         *
         * Els dos run_ originals es preserven íntegrament; aquest els invoca internament.
         */
        runPlaceChyrons: async function () {
            if (!(await getUtils().validateActiveSequence())) return;
            const cfg = FASTPASS_UI.Config.get();
            const struct = FASTPASS_UI.State.structure;
            const T_THEME = cfg.tracks.video.tematitol;

            if (!struct || struct.length === 0) {
                log("⚠️ No hi ha estructura carregada. Executa un escaneig primer.", "WARN");
                return;
            }

            try {
                // ── 1. LLEGIR MARCADORS DEL TIMELINE ──────────────────────────
                const markersRaw = await callJSX('Markers.get()');
                const allMarkers = markersRaw ? JSON.parse(markersRaw) : [];
                log(`📋 ${allMarkers.length} marcadors llegits del timeline.`);

                // Filtrar marcadors estructurals pel patró del camp "comments":
                // Format: "XX - TIPO" o "XXf - TIPO" (ex: "02 - OFF", "11f - INTRO")
                // Nota: NO filtrem per color perquè els marcadors D15-Fase0
                //       es creen sense índex de color explícit (color=-1)
                const STRUCTURAL_COMMENTS_RE = /^\d+[a-z]?\s*-\s*.+$/i;
                const structuralMarkers = allMarkers.filter(m => {
                    const cmt = (m.comments || "").trim();
                    return STRUCTURAL_COMMENTS_RE.test(cmt);
                });

                log(`🔍 ${structuralMarkers.length} marcadors estructurals detectats (de ${allMarkers.length} totals).`);

                if (structuralMarkers.length === 0) {
                    log("⚠️ No hi ha marcadors estructurals. Clica MARCADORS primer.", "WARN");
                    return;
                }

                // ── 2. MAPEJAR BLOCK_ID → MARKER.TIME ─────────────────────────
                // Format del comentari: "ID - TIPO"  (ex: "03 - OFF", "11 - INTRO")
                const blockTimeMap = {}; // { "03": timeSec }
                for (const m of structuralMarkers) {
                    const parts = (m.comments || "").split("-");
                    if (parts.length > 0) {
                        const rawId = parts[0].trim();
                        // Normalitzar: "3" → "03", "11f" → "11"
                        const numMatch = rawId.match(/^(\d+)/);
                        if (numMatch) {
                            const blockId = numMatch[1].padStart(2, "0");
                            // Només el primer marcador de cada bloc (el més primerenc)
                            if (!(blockId in blockTimeMap) || m.time < blockTimeMap[blockId]) {
                                blockTimeMap[blockId] = m.time;
                            }
                        }
                    }
                }
                log(`🔗 ${Object.keys(blockTimeMap).length} blocs amb marcador estructural.`);

                // ── 3. CONSTRUIR ÍNDEX state.structure PER entry.id ──────────
                // entry.id ja és el número de bloc normalitzat (Parse.files() l'extreu del nom Wott).
                // Parse.meta() espera un nom de fitxer complet (ex: "16lead_TT_010000.wott"),
                // no un ID ja parsejat → retorna null per a IDs sense format Wott.
                const structureByBlock = {}; // { "16": structEntry }
                for (const entry of struct) {
                    const rawId = entry.id;
                    if (rawId) {
                        const normId = rawId.toString().replace(/[a-z]/gi, "").padStart(2, "0");
                        structureByBlock[normId] = entry;
                    }
                }

                // 🔬 DIAGNÒSTIC: mostrar claus dels dos mapes per depurar el desajust
                log(`🔬 [DIAG] blockTimeMap keys: [${Object.keys(blockTimeMap).sort().join(", ")}]`, "DEBUG");
                log(`🔬 [DIAG] structureByBlock keys: [${Object.keys(structureByBlock).sort().join(", ")}]`, "DEBUG");
                const structChyronCounts = Object.entries(structureByBlock).map(([k, e]) =>
                    `${k}:${(e.chyrons || []).length}ch`
                ).join(", ");
                log(`🔬 [DIAG] structureByBlock chyron counts: {${structChyronCounts}}`, "DEBUG");
                // Mostrar també les entrades de struct sense rawLinea
                const noRawLinea = struct.filter(e => {
                    const meta = FASTPASS_UI.Logic.Parse ? FASTPASS_UI.Logic.Parse.meta(e.id) : null;
                    return !meta || !meta.rawLinea;
                });
                if (noRawLinea.length > 0) {
                    log(`🔬 [DIAG] ${noRawLinea.length} entrades struct sense rawLinea: [${noRawLinea.map(e => e.id).join(", ")}]`, "DEBUG");
                }
                // Mostrar primer struct entry per inspeccionar estructura
                if (struct.length > 0) {
                    const first = struct[0];
                    const firstMeta = FASTPASS_UI.Logic.Parse ? FASTPASS_UI.Logic.Parse.meta(first.id) : null;
                    log(`🔬 [DIAG] struct[0].id="${first.id}" meta=${JSON.stringify(firstMeta)} chyrons.length=${(first.chyrons||[]).length}`, "DEBUG");
                }

                let placedCount = 0;

                // ── 4. PER CADA BLOC, COL·LOCAR TEMA-TÍTOLS ─────────────────
                for (const [blockId, markerTime] of Object.entries(blockTimeMap)) {
                    const entry = structureByBlock[blockId];
                    if (!entry) {
                        log(`🔬 [DIAG] Bloc ${blockId}: NO hi ha entry a structureByBlock`, "DEBUG");
                        continue;
                    }
                    if (!entry.chyrons || entry.chyrons.length === 0) {
                        log(`🔬 [DIAG] Bloc ${blockId}: entry present (id=${entry.id}) però 0 chyrons`, "DEBUG");
                        continue;
                    }

                    // Mostrar tots els noms de chyrons per diagnosticar
                    const chyNames = entry.chyrons.map(c => c.name).join(" | ");
                    log(`🔬 [DIAG] Bloc ${blockId}: ${entry.chyrons.length} chyrons → [${chyNames}]`, "DEBUG");

                    // Filtrar Tema-Títols: nom = conté "tema" o "titol" (case-insensitive)
                    const temaTitols = entry.chyrons.filter(c => {
                        const n = c.name.toLowerCase();
                        return n.includes("tema") || n.includes("titol");
                    });

                    if (temaTitols.length === 0) {
                        log(`🔬 [DIAG] Bloc ${blockId}: cap chyron conté 'tema'/'titol' al nom`, "DEBUG");
                        continue;
                    }

                    // Ordenar per TC per col·locar-los en ordre temporal
                    temaTitols.sort((a, b) => (a.tc || "").localeCompare(b.tc || ""));

                    log(`📌 Bloc ${blockId}: ${temaTitols.length} Tema‑Títol(s) → marcador a ${markerTime.toFixed(2)}s`);

                    for (let i = 0; i < temaTitols.length; i++) {
                        const tt = temaTitols[i];
                        const placeTime = markerTime + 0.4; // Frame 10 aproximat

                        // 4a. Inserir Tema‑Titol original a V5
                        const escapedName = getUtils().escape(tt.name);
                        await callJSX(`Clips.insert('${escapedName}', ${T_THEME}, ${placeTime}, null, 'video')`);
                        log(`   ✅ Inserit: ${tt.name} @ ${placeTime.toFixed(2)}s`);

                        // 4b. Determinar fins on estirar:
                        //     - Si és l'últim TemaTitol del bloc → fins al marcador següent
                        //     - Si n'hi ha un altre després → fins a la posició del següent TemaTitol
                        let stretchEnd = null;

                        if (i < temaTitols.length - 1) {
                            // Següent Tema‑Titol al mateix bloc
                            stretchEnd = markerTime + 0.4 + (i + 1) * 0.04; // petit offset per separar-los
                        } else {
                            // Últim Tema‑Titol del bloc: buscar marcador del bloc següent
                            const sortedBlockIds = Object.keys(blockTimeMap).sort();
                            const myIdx = sortedBlockIds.indexOf(blockId);
                            if (myIdx >= 0 && myIdx < sortedBlockIds.length - 1) {
                                const nextBlockId = sortedBlockIds[myIdx + 1];
                                stretchEnd = blockTimeMap[nextBlockId];
                            }
                            // Si no hi ha bloc següent, stretchEnd es queda null → s'estira al final
                        }

                        // 4c. Freeze‑frame: capturar PNG i estirar
                        try {
                            const freezeResult = await this._freezeTemaTitol(placeTime, stretchEnd, tt.name);
                            if (freezeResult && freezeResult.success) {
                                log(`   🖼️ Freeze aplicat: ${tt.name} → ${freezeResult.duration}s`);
                            }
                        } catch (freezeErr) {
                            log(`   ⚠️ Freeze fallit per ${tt.name}: ${freezeErr.message}`, "WARN");
                        }

                        placedCount++;
                    }
                }

                if (placedCount === 0) {
                    log("⚠️ No s'ha trobat cap Tema‑Titol per col·locar.", "WARN");
                } else {
                    log(`🎬 ${placedCount} Tema‑Títol(s) col·locat(s) correctament.`, "INFO");
                    getUtils().status(`${placedCount} Tema‑Títol(s) col·locat(s)`, "exito");
                }

            } catch (e) { getUtils().handleError(e, "PlaceChyronsMarkerGuided"); }
        },

        /**
         * FREEZE-TEMA-TITOL: Importa el Wott, l'insereix temporalment a V5,
         * captura un frame PNG, elimina el Wott de V5, i insereix el PNG estirat.
         *
         * @param {string} wottName   - Nom del fitxer Wott a importar i capturar
         * @param {number} placeTime  - Temps on col·locar i capturar
         * @param {number|null} stretchEnd - Temps final d'estirament (null = final timeline)
         * @param {string} label      - Etiqueta per a logging
         * @returns {object} { success, duration }
         */
        _snapToNearestCut: async function(idealTimeSec) {
            const clips = await getClipsLogic().getTrackClips(1, "video");
            if (!clips || clips.length === 0) return idealTimeSec;
            let bestClip = clips[0];
            let bestDist = Math.abs(clips[0].start - idealTimeSec);
            for (let i = 1; i < clips.length; i++) {
                const dist = Math.abs(clips[i].start - idealTimeSec);
                if (dist < bestDist) {
                    bestDist = dist;
                    bestClip = clips[i];
                }
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

            // 2. Snapshot a C:\temp (mateix que window.Render.capture, evita UNC amb Ó)
            const tempPath = `C:\\temp\\freeze_${Date.now()}.png`;
            await callJSX(`Timeline.set(${cutTime})`);
            await utils.delay(500);
            await FASTPASS_UI.Logic.Tracks.isolate(T_THEME, 'video');
            
            const snapResult = await callJSX(`freezeFrame('${utils.escape(tempPath)}', ${cutTime})`);
            log(`   📸 [_freeze] freezeFrame → ${snapResult}`);
            
            await FASTPASS_UI.Logic.Tracks.all('video', 'mute', false);

            // 3. Recortar clip
            await callJSX(`Clips.endAt(${T_THEME}, ${placeTime}, ${cutTime}, 'video')`);
            log(`   ✂️ [_freeze] Clip retallat a end=${cutTime.toFixed(2)}s`);

            if (!snapResult || snapResult.indexOf('OK') !== 0) {
                log(`   ❌ [_freeze] Snapshot fallit: ${snapResult}`, "ERROR");
                return { success: false, duration: 0 };
            }

            // 4. Importar PNG desde C:\temp
            const fileName = tempPath.split("\\").pop();
            const importPayload = JSON.stringify([tempPath]);
            await callJSX(`IO.importFiles('${utils.escape(importPayload)}', 'root')`);

            // 5. Determinar durada
            let duration;
            if (stretchEnd !== null && stretchEnd !== undefined) {
                duration = Math.max(stretchEnd - cutTime, 0.5);
            } else {
                const timelineDur = parseFloat(await callJSX("Timeline.duration()") || "0");
                duration = Math.max(timelineDur - cutTime, 0.5);
            }

            // 6. Insertar PNG estirat
            await callJSX(`Clips.insert('${utils.escape(fileName)}', ${T_THEME}, ${cutTime}, ${cutTime + duration}, 'video')`);
            log(`   ✅ [_freeze] PNG "${fileName}" → V5 @ ${cutTime.toFixed(2)}s dur=${duration.toFixed(1)}s`);

            return { success: true, duration };
        },

        /**
         * _placeChyronsByType: Helper compartit per col·locar chyrons d'un tipus
         * concret usant els marcadors de timeline com a àncores.
         *
         * @param {Function} filterFn     - (chyron) => boolean
         * @param {Function} trackResolver - (chyron, cfg) => trackNumber
         * @param {string}   label         - Etiqueta per a logging
         */
        _placeChyronsByType: async function (filterFn, trackResolver, label) {
            if (!(await getUtils().validateActiveSequence())) return;
            const cfg = FASTPASS_UI.Config.get();
            const struct = FASTPASS_UI.State.structure;

            if (!struct || struct.length === 0) {
                log("⚠️ No hi ha estructura carregada. Executa un escaneig primer.", "WARN");
                return;
            }

            try {
                // 1. Llegir marcadors del timeline
                const markersRaw = await callJSX('Markers.get()');
                const allMarkers = markersRaw ? JSON.parse(markersRaw) : [];
                log(`📋 [${label}] ${allMarkers.length} marcadors llegits.`);

                // 2. Filtrar marcadors estructurals (patró "XX - TIPO")
                const STRUCTURAL_COMMENTS_RE = /^\d+[a-z]?\s*-\s*.+$/i;
                const structuralMarkers = allMarkers.filter(m => {
                    const cmt = (m.comments || "").trim();
                    return STRUCTURAL_COMMENTS_RE.test(cmt);
                });

                if (structuralMarkers.length === 0) {
                    log(`⚠️ [${label}] No hi ha marcadors estructurals. Clica MARCADORS primer.`, "WARN");
                    return;
                }

                // 3. Mapejar marcador (ID complet amb sufix) → marker.time
                //    Ex: "21i - INTRO" → fullId="21i", time=...
                //    EX: "21 - OFF"    → fullId="21",  time=...
                const markersFull = [];
                for (const m of structuralMarkers) {
                    const parts = (m.comments || "").split("-");
                    if (parts.length > 0) {
                        const rawId = parts[0].trim();
                        const numMatch = rawId.match(/^(\d+)/);
                        if (numMatch) {
                            markersFull.push({
                                fullId: rawId,
                                blockNum: numMatch[1].padStart(2, "0"),
                                time: m.time
                            });
                        }
                    }
                }
                markersFull.sort((a, b) => a.time - b.time);
                log(`🔗 [${label}] ${markersFull.length} marcadors estructurals: ${markersFull.map(m => m.fullId + '@' + m.time.toFixed(1)).join(', ')}`);

                // 4. Indexar state.structure per id COMPLET (preservant sufix: "21i", "21")
                const structureById = {};
                for (const entry of struct) {
                    const rawId = entry.id;
                    if (rawId) {
                        structureById[rawId] = entry;
                    }
                }
                log(`🔬 [${label}] structureById keys: [${Object.keys(structureById).sort().join(', ')}]`);

                let placedCount = 0;

                // 5. Per cada marcador, buscar chyrons del seu entry per ID complet
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

        /**
         * TITOL (Tema‑Titol): Col·loca Tema‑Títols a V5 amb freeze‑frame + estirament.
         * Flux complet:
         *   1. Inserir el clip original a V5 a marker.time + 0.4s
         *   2. Capturar freeze‑frame PNG del frame insertat
         *   3. Estirar el PNG fins al marcador del bloc següent (o final del timeline)
         */
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
                // 1. Llegir marcadors del timeline
                const markersRaw = await callJSX('Markers.get()');
                const allMarkers = markersRaw ? JSON.parse(markersRaw) : [];

                const STRUCTURAL_COMMENTS_RE = /^\d+[a-z]?\s*-\s*.+$/i;
                const structuralMarkers = allMarkers.filter(m => {
                    const cmt = (m.comments || "").trim();
                    return STRUCTURAL_COMMENTS_RE.test(cmt);
                });

                if (structuralMarkers.length === 0) {
                    log("⚠️ [Titol] No hi ha marcadors estructurals. Clica MARCADORS primer.", "WARN");
                    return;
                }

                // 2. Mapejar marcador (ID complet amb sufix) → marker.time
                //    Ex: "11i - INTRO" → { fullId: "11i", time: ... }
                const markersFull = []; // [{fullId, time, blockNum}]
                for (const m of structuralMarkers) {
                    const parts = (m.comments || "").split("-");
                    if (parts.length > 0) {
                        const rawId = parts[0].trim();
                        const numMatch = rawId.match(/^(\d+)/);
                        if (numMatch) {
                            markersFull.push({
                                fullId: rawId,
                                blockNum: numMatch[1].padStart(2, "0"),
                                time: m.time
                            });
                        }
                    }
                }
                // Ordenar per temps
                markersFull.sort((a, b) => a.time - b.time);

                // 3. Indexar state.structure per id COMPLET (preservant sufix)
                const structureById = {}; // key = id complet ("11", "11i", "11f"...)
                for (const entry of struct) {
                    const rawId = entry.id;
                    if (rawId) {
                        structureById[rawId] = entry;
                    }
                }
                // Debug: mostrar IDs disponibles
                log(`🔬 [Titol·DIAG] structureById keys: [${Object.keys(structureById).sort().join(", ")}]`);
                log(`🔬 [Titol·DIAG] markersFull: ${markersFull.map(m => m.fullId + '@' + m.time.toFixed(1)).join(', ')}`);

                let placedCount = 0;

                // 4. Per cada marcador, buscar el seu structure entry per ID complet
                for (let mi = 0; mi < markersFull.length; mi++) {
                    const mk = markersFull[mi];
                    const fullId = mk.fullId;
                    const markerTime = mk.time;

                    // Buscar entry per ID complet (SENSE fallback a blockNum — 11i ≠ 11)
                    const entry = structureById[fullId];
                    if (!entry || !entry.chyrons || entry.chyrons.length === 0) {
                        log(`🔬 [Titol·DIAG] Marcador ${fullId}@${markerTime.toFixed(1)}s: sense entry a structureById.`);
                        continue;
                    }

                    // 🔬 LOG: Mostrar TOTS els chyrons del bloc amb els seus rols
                    log(`🔬 [Titol·DIAG] Marcador ${fullId} (entry.id=${entry.id}): ${entry.chyrons.length} chyrons totals:`);
                    entry.chyrons.forEach((c, idx) => {
                        log(`   [${idx}] name="${c.name}" rol="${c.rol || '?'}" tc="${c.tc || '?'}"`);
                    });

                    const temaTitols = entry.chyrons.filter(c =>
                        c.name.includes("Tema-Titol") || c.name.includes("TITOL")
                    );
                    if (temaTitols.length === 0) {
                        log(`🔬 [Titol·DIAG] Marcador ${fullId}: cap Tema-Titol/TITOL trobat.`);
                        continue;
                    }

                    log(`🔬 [Titol·DIAG] Marcador ${fullId}: ${temaTitols.length} candidats Tema-Titol:`);
                    temaTitols.forEach((c, idx) => {
                        log(`   [${idx}] name="${c.name}" rol="${c.rol || '?'}" tc="${c.tc || '?'}"`);
                    });

                    // FILTRE PER SUFIX DEL MARCADOR: només processar marcadors amb sufix (ex: 19i, 14dp)
                    // Els Tema‑Titol llargs pertanyen als items amb sufix (intro, dp...)
                    if (!/[a-z]/i.test(fullId)) {
                        log(`🔬 [Titol·DIAG] Marcador ${fullId}: sense sufix → ignorat.`);
                        continue;
                    }
                    
                    const longTemaTitols = temaTitols.filter(c => (c.rol || '') === 'Tema-Titol');
                    if (longTemaTitols.length === 0) {
                        log(`⚠️ [Titol] Marcador ${fullId}: cap Tema‑Titol amb rol='Tema-Titol' (${temaTitols.length} descartats). S'esperarà al botó NOU.`);
                        continue;
                    }
                    longTemaTitols.sort((a, b) => (a.tc || "").localeCompare(b.tc || ""));
                    log(`🎯 [Titol·DIAG] ${longTemaTitols.length} Tema‑Titol(s) a col·locar`);

                    for (let ti = 0; ti < longTemaTitols.length; ti++) {
                        const tt = longTemaTitols[ti];
                        const tcSeconds = getUtils().timeToSeconds(tt.tc || "000000");
                        const placeTime = markerTime + tcSeconds;

                        // Determinar stretchEnd:
                        //   - Si hi ha un altre Tema‑Titol llarg després → el seu placeTime
                        //   - Sinó → marcador següent (o final del timeline)
                        let stretchEnd = null;
                        if (ti < longTemaTitols.length - 1) {
                            const nextTc = getUtils().timeToSeconds(longTemaTitols[ti + 1].tc || "000000");
                            stretchEnd = markerTime + nextTc;
                        } else if (mi < markersFull.length - 1) {
                            stretchEnd = markersFull[mi + 1].time;
                        }

                        log(`📌 [Titol] Marcador ${fullId} #${ti+1}/${longTemaTitols.length}: "${tt.name}" → V5 @ ${placeTime.toFixed(2)}s (tc=${tt.tc}, stretchEnd=${stretchEnd !== null ? stretchEnd.toFixed(2) : 'final'})`);

                        // Freeze‑frame + estirament
                        try {
                            const freezeResult = await this._freezeTemaTitol(tt.name, placeTime, stretchEnd, tt.name);
                            if (freezeResult && freezeResult.success) {
                                log(`   🖼️ [Titol] Freeze aplicat: ${tt.name} → ${freezeResult.duration.toFixed(1)}s`);
                            }
                        } catch (freezeErr) {
                            log(`   ⚠️ [Titol] Freeze fallit per ${tt.name}: ${freezeErr.message}`, "WARN");
                        }

                        placedCount++;
                    }
                }

                if (placedCount === 0) {
                    log("⚠️ [Titol] Cap Tema‑Titol per col·locar.", "WARN");
                } else {
                    log(`🎬 [Titol] ${placedCount} Tema‑Títol(s) col·locat(s) amb freeze‑frame.`, "INFO");
                    getUtils().status(`Titol: ${placedCount} col·locat(s)`, "exito");
                }

            } catch (e) { getUtils().handleError(e, "Titol"); }
        },

        /**
         * CONDUCTOR: Col·loca chyrons de conductor a V6 (chyrons).
         */
        placeChyronConductor: async function () {
            await this._placeChyronsByType(
                c => (c.rol || '').toUpperCase() === "CONDUCTOR",
                (c, cfg) => cfg.tracks.video.chyrons,
                "Conductor"
            );
        },

        /**
         * LLOC: Col·loca chyrons de lloc/data/senyal a V7 (llocdata).
         */
        placeChyronLloc: async function () {
            await this._placeChyronsByType(
                c => c.name.includes("Lloc") || c.name.includes("Data") || (c.rol || '').toUpperCase() === "LLOCDATA",
                (c, cfg) => cfg.tracks.video.llocdata,
                "Lloc"
            );
        },

        /**
         * NOM: Col·loca chyrons NomCarrec a V6 (chyrons).
         */
        placeChyronNom: async function () {
            await this._placeChyronsByType(
                c => (c.rol || '').toUpperCase() === "NOMCARREC" || c.name.includes("Nom") || c.name.includes("Carrec"),
                (c, cfg) => cfg.tracks.video.chyrons,
                "Nom"
            );
        },

        /**
         * TRADUCCIÓ: Col·loca chyrons de traducció a V6 (chyrons, overlay).
         */
        placeChyronTraduccio: async function () {
            if (!(await getUtils().validateActiveSequence())) return;
            const cfg = FASTPASS_UI.Config.get();
            const struct = FASTPASS_UI.State.structure;
            const T_TRAD = cfg.tracks.video.graf; // V3

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
                            markersFull.push({
                                fullId: rawId,
                                blockNum: numMatch[1].padStart(2, "0"),
                                time: m.time
                            });
                        }
                    }
                }
                markersFull.sort((a, b) => a.time - b.time);

                const structureById = {};
                for (const entry of struct) {
                    if (entry.id) structureById[entry.id] = entry;
                }

                let placedCount = 0;

                for (const mk of markersFull) {
                    const entry = structureById[mk.fullId];
                    if (!entry || !entry.chyrons || entry.chyrons.length === 0) continue;

                    const traduccions = entry.chyrons.filter(c =>
                        (c.rol || '').toUpperCase().includes("TRADUCCIO") || c.name.toUpperCase().includes("TRADUCCIO")
                    );
                    if (traduccions.length === 0) continue;

                    // Agrupar per TC (blocs de traducció simultània)
                    const groups = new Map();
                    for (const t of traduccions) {
                        const tc = t.tc || "00.00";
                        if (!groups.has(tc)) groups.set(tc, []);
                        groups.get(tc).push(t);
                    }

                    log(`📌 [Traducció] Marcador ${mk.fullId}: ${traduccions.length} traduccions en ${groups.size} bloc(s)`);

                    for (const [tc, group] of groups) {
                        const tcSeconds = getUtils().timeToSeconds(tc);
                        const idealTime = mk.time + tcSeconds;
                        const clipStart = await this._snapToNearestCut(idealTime);

                        // Obtenir clips V1 i estendre el "clip efectiu" saltant flash frames
                        const clips = await getClipsLogic().getTrackClips(1, "video");
                        let clipEnd = clipStart + 10; // fallback 10s
                        let foundStart = false;
                        for (let ci = 0; ci < clips.length; ci++) {
                            const cl = clips[ci];
                            if (Math.abs(cl.start - clipStart) < 0.05) {
                                clipEnd = cl.end;
                                foundStart = true;
                                // Avançar recursivament mentre el següent clip sigui un flash (< 0.5s)
                                let nextIdx = ci + 1;
                                while (nextIdx < clips.length && (clips[nextIdx].end - clips[nextIdx].start) < 0.5) {
                                    log(`   ⚡ [Traducció] Flash detectat a ${clips[nextIdx].start.toFixed(2)}s (dur=${(clips[nextIdx].end - clips[nextIdx].start).toFixed(2)}s) → estenent clip efectiu`);
                                    nextIdx++;
                                }
                                if (nextIdx > ci + 1) {
                                    // Hi havia flashes: el final real és l'inici del següent clip no-flash
                                    if (nextIdx < clips.length) {
                                        clipEnd = clips[nextIdx].start;
                                    } else {
                                        clipEnd = clips[nextIdx - 1].end + 1.0; // marge d'1s després de l'últim flash
                                    }
                                }
                                // Sense flashes: clipEnd = cl.end (ja assignat)
                                break;
                            }
                        }
                        const clipDur = clipEnd - clipStart;

                        // Ordenar pel número de seqüència al rol: "TRADUCCIO [3-12]" → 3
                        const extractSeq = (c) => {
                            const match = (c.rol || '').match(/\[(\d+)-\d+\]/);
                            return match ? parseInt(match[1], 10) : 999;
                        };
                        group.sort((a, b) => extractSeq(a) - extractSeq(b));
                        const N = group.length;
                        log(`   📦 [Traducció] Bloc TC=${tc}: ${N} clips → V1 clip @ ${clipStart.toFixed(2)}s (dur=${clipDur.toFixed(2)}s)`);

                        for (let i = 0; i < N; i++) {
                            const slotDur = clipDur / N;
                            const placeTime = clipStart + slotDur * i;
                            const placeEnd = (i === N - 1) ? clipStart + clipDur : clipStart + slotDur * (i + 1);
                            const escapedName = getUtils().escape(group[i].name);
                            await callJSX(`Clips.insert('${escapedName}', ${T_TRAD}, ${placeTime}, ${placeEnd}, 'video')`);
                            log(`      ✅ [${i+1}/${N}] ${group[i].name.substring(0, 40)}... → V3 @ ${placeTime.toFixed(2)}s→${placeEnd.toFixed(2)}s (dur=${(placeEnd - placeTime).toFixed(2)}s)`);
                            placedCount++;
                        }
                    }
                }

                if (placedCount === 0) {
                    log("⚠️ [Traducció] Cap traducció per col·locar.", "WARN");
                } else {
                    log(`🎬 [Traducció] ${placedCount} traduccions col·locades.`, "INFO");
                    getUtils().status(`Traducció: ${placedCount} col·locades`, "exito");
                }

            } catch (e) { getUtils().handleError(e, "Traducció"); }
        },

        /**
         * RESTO: Col·loca la resta de chyrons no capturats pels altres 5 botons.
         */
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

        /**
         * GRAFIC (Marker‑guided placement): Col·loca rètols (wotts) del bin CHY usant els
         * marcadors de timeline com a anclas + offset TC extret del nom del fitxer.
         * Substituït el magic‑flow per markers‑based assembly (runGuidedAssembly).
         */
        runPlaceGraphic: async function () {
            if (!(await getUtils().validateActiveSequence())) return;
            log("🎬 Executant placement guiat per marcadors (wotts CHY → markers)...");

            try {
                await FASTPASS_UI.Logic.Assembly.runGuidedAssembly();
                getUtils().status("Placement guiat completat", "exito");
            } catch (e) { getUtils().handleError(e, "PlaceGraphic"); }
        },

        runPlaceGraph169: async function () {
            log("🎬 Aplicant format 16:9 amb fondos...");
            const cfg = FASTPASS_UI.Config.get();
            const T_MP4 = cfg.tracks.video.mp4;     
            const T_FONS = cfg.tracks.video.fondos;  

            try {
                const infoStr = await callJSX(`Clips.at(${T_MP4}, -1, 'video')`);
                if (!infoStr || infoStr === "null") throw new Error("Posa el cabezal sobre el clip.");
                const info = JSON.parse(infoStr);

                // Apliquem preset 16:9 (via callJSX directament per simplificar)
                await callJSX(`Clips.setProp(${T_MP4}, ${info.index}, 'ADBE Motion', 'ADBE Video Scale', 140, 'video')`);

                const bgName = "Fons_16_9_GENERIC.png";
                await callJSX(`Clips.insert('${getUtils().escape(bgName)}', ${T_FONS}, ${info.start}, ${info.end}, 'video')`);
                
            } catch (e) { getUtils().handleError(e, "Graph169"); }
        },

        /**
         * REPARTIR TRADUCCIONS: Redistribueix les traduccions seleccionades a V3
         * uniformement sobre els clips V1 seleccionats, ignorant flashes.
         * 
         * Flux:
         *   1. Llegeix clips V3 (graf) i V1 (mp4) seleccionats
         *   2. Agrupa traduccions per proximitat temporal (< 3s gap = mateix tram)
         *   3. Per cada tram, fusiona clips V1 contigus (saltant flashes < 0.5s)
         *   4. Reparteix N traduccions uniformement sobre el rang combinat V1
         *   5. Retalla l'última traducció perquè coincideixi amb el final del tram
         */
        placeChyronRepartir: async function () {
            if (!(await getUtils().validateActiveSequence())) return;
            const cfg = FASTPASS_UI.Config.get();
            const T_V1 = cfg.tracks.video.mp4;
            const T_V3 = cfg.tracks.video.graf;

            // Indexar state.structure per obtenir rol des del nom del clip
            const struct = FASTPASS_UI.State.structure || [];
            const rolByName = new Map();
            for (const entry of struct) {
                if (entry.chyrons) {
                    for (const chy of entry.chyrons) {
                        rolByName.set(chy.name, chy.rol || '');
                    }
                }
            }

            try {
                // 1. Llegir clips seleccionats a V1 i V3
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

                log(`🎯 [Repartir] V1 seleccionats: ${selectedV1.length}, V3 seleccionats: ${selectedV3.length}`);

                if (selectedV3.length === 0) {
                            log("⚠️ [Repartir] No hi ha traduccions seleccionades a V3. Selecciona les traduccions (V3) + clips V1 amb Ctrl+clic.", "WARN");
                    getUtils().status("⚠️ Selecciona traduccions a V3", "warn");
                    return;
                }
                if (selectedV1.length === 0) {
                    log("⚠️ [Repartir] No hi ha clips V1 seleccionats. Selecciona els clips de video on repartir.", "WARN");
                    getUtils().status("⚠️ Selecciona clips V1", "warn");
                    return;
                }

                // 2. Ordenar per start
                selectedV3.sort((a, b) => a.start - b.start);
                selectedV1.sort((a, b) => a.start - b.start);

                // 3. Agrupar traduccions per proximitat
                const groups = [];
                let currentGroup = [selectedV3[0]];
                for (let i = 1; i < selectedV3.length; i++) {
                    const gap = selectedV3[i].start - currentGroup[currentGroup.length - 1].end;
                    if (gap < 3.0) {
                        currentGroup.push(selectedV3[i]);
                    } else {
                        groups.push(currentGroup);
                        currentGroup = [selectedV3[i]];
                    }
                }
                groups.push(currentGroup);
                log(`📦 [Repartir] ${groups.length} tram(s) de traducció detectats`);

                let placedCount = 0;

                // 4. Eliminar V3 complet abans de reinsertar res
                await callJSX(`Clips.clearTrack(${T_V3}, 'video')`);
                log(`   🧹 [Repartir] Tot el track V3 netejat`);

                // Rang complet de TOTS els clips V1 seleccionats
                const rangeStart = selectedV1[0].start;
                const rangeEnd = selectedV1[selectedV1.length - 1].end;
                const rangeDur = rangeEnd - rangeStart;

                // 5. Per cada tram, calcular M i reinsertar traduccions als nous slots
                for (let gi = 0; gi < groups.length; gi++) {
                    const group = groups[gi];
                    
                    // Detectar total de slots (M de [N-M]) usant rolByName
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
                    
                    log(`   📐 [Repartir] Tram ${gi+1}/${groups.length}: ${N}/${M} traduccions (${M - N} buits), slotDur=${slotDur.toFixed(2)}s`);
                    
                    group.sort((a, b) => extractSeq(a) - extractSeq(b));
                    const seqToChy = new Map();
                    for (const chy of group) {
                        seqToChy.set(extractSeq(chy), chy);
                    }
                    
                    for (let s = 0; s < M; s++) {
                        const seqNum = s + 1;
                        const chy = seqToChy.get(seqNum) || null;
                        
                        if (chy) {
                            const newStart = rangeStart + slotDur * s;
                            const newEnd = (s === M - 1) ? rangeEnd : rangeStart + slotDur * (s + 1);
                            const escapedName = getUtils().escape(chy.name);
                            
                            await callJSX(`Clips.insert('${escapedName}', ${T_V3}, ${newStart}, ${newEnd}, 'video')`);
                            log(`      ✅ [${seqNum}/${M}] "${chy.name.substring(0, 30)}..." → V3 @ ${newStart.toFixed(2)}s→${newEnd.toFixed(2)}s (dur=${(newEnd - newStart).toFixed(2)}s)`);
                            placedCount++;
                        } else {
                            log(`      ⬜ [${seqNum}/${M}] buit (traducció absent)`);
                        }
                        
                        if (s % 3 === 2) await getUtils().delay(100);
                    }
                }

                getUtils().status(`Repartit: ${placedCount} traduccions`, "exito");
                log(`🎬 [Repartir] ${placedCount} traduccions repartides en ${groups.length} trams.`, "INFO");

            } catch (e) { getUtils().handleError(e, "Repartir"); }
        },

        runPlaceBackground: async function () {
            if (!(await getUtils().validateActiveSequence())) return;
            log("🎬 Col·locant fons vertical...");
            const cfg = FASTPASS_UI.Config.get();
            const T_FONS = cfg.tracks.video.fondos;  
            try {
                const cti = parseFloat(await callJSX('Timeline.get()') || "0");
                const bgName = "Fons_Vertical_Generic.png";
                await callJSX(`Clips.insert('${getUtils().escape(bgName)}', ${T_FONS}, ${cti}, null, 'video')`);
                getUtils().status("Fons colocat", "exito");
            } catch (e) { getUtils().handleError(e, "PlaceBackground"); }
        }
    };

    window.FASTPASS_UI.Workflows.Retols = FASTPASS_UI.Workflows.Retols;
})();