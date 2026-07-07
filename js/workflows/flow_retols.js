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
        _freezeTemaTitol: async function (wottName, placeTime, stretchEnd, label) {
            const cfg = FASTPASS_UI.Config.get();
            const T_THEME = cfg.tracks.video.tematitol;
            const utils = getUtils();
            const escapedWott = utils.escape(wottName);
            const CUT_OFFSET = 6.15; // Segons d'animació d'entrada a conservar

            log(`   🧊 [_freeze] wott="${wottName.substring(0, 50)}..." placeTime=${placeTime.toFixed(2)}s stretchEnd=${stretchEnd !== null ? stretchEnd.toFixed(2) : 'final'}`);

            // 1. Inserir el Wott llarg a V5 (durada completa, per tenir l'animació d'entrada)
            await callJSX(`Clips.insert('${escapedWott}', ${T_THEME}, ${placeTime}, null, 'video')`);
            await utils.delay(500);

            // 2. Retallar el clip a placeTime + CUT_OFFSET (conserva animació d'entrada)
            const cutTime = placeTime + CUT_OFFSET;
            await callJSX(`Clips.endAt(${T_THEME}, ${placeTime}, ${cutTime}, 'video')`);
            log(`   ✂️ [_freeze] Clip retallat a end=${cutTime.toFixed(2)}s`);

            // 3. Aïllar V5 per capturar només el frame a congelar
            await FASTPASS_UI.Logic.Tracks.isolate(T_THEME, 'video');

            // 4. Posicionar cabezal al punt de tall i capturar snapshot
            //    Render.frame() crea la carpeta automàticament i accepta path complet
            await callJSX(`Timeline.set(${cutTime})`);
            const folder = await callJSX("Context.folder()");
            const snapPath = `${folder}\\Snapshots\\freeze_${Date.now()}.png`;
            const snapResult = await callJSX(`Render.frame('${utils.escape(snapPath)}', ${cutTime})`);

            // 5. Restaurar visibilitat de totes les pistes
            await FASTPASS_UI.Logic.Tracks.all('video', 'mute', false);

            if (!snapResult || snapResult.indexOf('ERR') === 0) {
                log(`   ❌ [_freeze] Snapshot fallit: ${snapResult}`, "ERROR");
                throw new Error(`Snapshot fallit: ${snapResult}`);
            }

            // 6. Importar el PNG al projecte
            const fileName = snapPath.split("\\").pop();
            const importPayload = JSON.stringify([snapPath]);
            await callJSX(`IO.importFiles('${utils.escape(importPayload)}', 'root')`);

            // 7. Determinar durada de l'estirament del PNG
            let duration;
            if (stretchEnd !== null && stretchEnd !== undefined) {
                duration = Math.max(stretchEnd - cutTime, 0.5);
            } else {
                const timelineDur = parseFloat(await callJSX("Timeline.duration()") || "0");
                duration = Math.max(timelineDur - cutTime, 0.5);
            }

            // 8. Inserir el PNG estirat DESPRÉS del segment d'animació
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

                // 3. Mapejar blockId → marker.time (primer marcador de cada bloc)
                const blockTimeMap = {};
                for (const m of structuralMarkers) {
                    const parts = (m.comments || "").split("-");
                    if (parts.length > 0) {
                        const rawId = parts[0].trim();
                        const numMatch = rawId.match(/^(\d+)/);
                        if (numMatch) {
                            const blockId = numMatch[1].padStart(2, "0");
                            if (!(blockId in blockTimeMap) || m.time < blockTimeMap[blockId]) {
                                blockTimeMap[blockId] = m.time;
                            }
                        }
                    }
                }
                log(`🔗 [${label}] ${Object.keys(blockTimeMap).length} blocs amb marcador estructural.`);

                // 4. Indexar state.structure per blockId normalitzat
                const structureByBlock = {};
                for (const entry of struct) {
                    const rawId = entry.id;
                    if (rawId) {
                        const normId = rawId.toString().replace(/[a-z]/gi, "").padStart(2, "0");
                        structureByBlock[normId] = entry;
                    }
                }

                let placedCount = 0;

                // 5. Per cada bloc, filtrar chyrons i col·locar
                for (const [blockId, markerTime] of Object.entries(blockTimeMap)) {
                    const entry = structureByBlock[blockId];
                    if (!entry || !entry.chyrons || entry.chyrons.length === 0) continue;

                    const matching = entry.chyrons.filter(c => filterFn(c));
                    if (matching.length === 0) continue;

                    matching.sort((a, b) => (a.tc || "").localeCompare(b.tc || ""));

                    log(`📌 [${label}] Bloc ${blockId}: ${matching.length} chyron(s)`);

                    for (const chy of matching) {
                        const tcSeconds = getUtils().timeToSeconds(chy.tc || "000000");
                        const placeTime = markerTime + tcSeconds;
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

                    // FILTRE PER MIDA D'ARXIU REAL (via utils.readFolder + ruta chyrons del NAS)
                    const MIN_SIZE = 200000; // 200 KB
                    const longTemaTitols = [];
                    const shortTemaTitols = [];
                    temaTitols.sort((a, b) => (a.tc || "").localeCompare(b.tc || ""));

                    // Obtenir mides reals des de la carpeta de chyrons al NAS
                    const chyronFiles = await getUtils().readFolder(cfg.rutas.chyrons);
                    const sizeByName = new Map();
                    for (const f of chyronFiles) {
                        sizeByName.set(f.name, f.size || 0);
                    }
                    log(`🔬 [Titol·DIAG] Carpeta chyrons: ${chyronFiles.length} fitxers, ${sizeByName.size} amb mida`);

                    for (const c of temaTitols) {
                        const fileSize = sizeByName.get(c.name) || 0;
                        log(`   📏 [Titol·DIAG] "${c.name.substring(0, 50)}..." → ${fileSize} bytes (${(fileSize/1024).toFixed(0)} KB)`);
                        if (fileSize >= MIN_SIZE) {
                            longTemaTitols.push(c);
                        } else {
                            shortTemaTitols.push(c);
                        }
                    }
                    if (longTemaTitols.length === 0) {
                        log(`⚠️ [Titol] Marcador ${fullId}: cap Tema‑Titol amb mida >= ${(MIN_SIZE/1024).toFixed(0)}KB (${shortTemaTitols.length} descartats). S'esperarà al botó NOU.`);
                        continue;
                    }
                    log(`🎯 [Titol·DIAG] ${longTemaTitols.length} Tema‑Titol(s) a col·locar (${shortTemaTitols.length} descartats per mida)`);

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
            await this._placeChyronsByType(
                c => (c.rol || '').toUpperCase().includes("TRADUCCIO") || c.name.toUpperCase().includes("TRADUCCIO"),
                (c, cfg) => cfg.tracks.video.chyrons,
                "Traducció"
            );
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