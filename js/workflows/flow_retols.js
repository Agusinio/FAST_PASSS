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
         * FREEZE-TEMA-TITOL: Captura un frame de la pista V5, l'importa com a PNG
         * i l'estira fins a stretchEnd (o fins al final del timeline si és null).
         * Delega en Assembly.Logic.freeze() per a la captura, però controlem
         * explícitament el punt d'estirament.
         *
         * @param {number} captureTime - Temps on capturar el frame
         * @param {number|null} stretchEnd - Temps final d'estirament (null = final timeline)
         * @param {string} label - Nom del Tema‑Titol per a logging
         * @returns {object} { success, duration }
         */
        _freezeTemaTitol: async function (captureTime, stretchEnd, label) {
            const cfg = FASTPASS_UI.Config.get();
            const T_THEME = cfg.tracks.video.tematitol;
            const utils = getUtils();

            // 1. Aïllar V5 (mute a totes les altres pistes de video)
            await FASTPASS_UI.Logic.Tracks.isolate(T_THEME, 'video');

            // 2. Posicionar el cabezal al punt de captura
            await callJSX(`Timeline.set(${captureTime})`);

            // 3. Capturar frame PNG
            const folder = await callJSX("Context.folder()");
            const snapPath = `${folder}\\Snapshots\\freeze_${Date.now()}.png`;
            const res = await FASTPASS_UI.Logic.Render.capture(snapPath, captureTime);

            // 4. Restaurar totes les pistes (unmute global)
            await FASTPASS_UI.Logic.Tracks.all('video', 'mute', false);

            if (!res || !res.success) {
                throw new Error(`Captura fallida: ${res ? res.log : "desconegut"}`);
            }

            // 5. Importar el PNG capturat al projecte
            const fileName = snapPath.split("\\").pop();
            const importPayload = JSON.stringify([snapPath]);
            await callJSX(`IO.importFiles('${utils.escape(importPayload)}', 'root')`);

            // 6. Determinar durada de l'estirament
            let duration;
            if (stretchEnd !== null && stretchEnd !== undefined) {
                duration = Math.max(stretchEnd - captureTime, 0.5);
            } else {
                const timelineDur = parseFloat(await callJSX("Timeline.duration()") || "0");
                duration = Math.max(timelineDur - captureTime, 0.5);
            }

            // 7. Inserir el freeze-frame a V5 amb la durada calculada
            await callJSX(`Clips.insert('${utils.escape(fileName)}', ${T_THEME}, ${captureTime}, ${captureTime + duration}, 'video')`);

            return { success: true, duration };
        },

        updateUIChunk: function() {
            const state = FASTPASS_UI.State;
            const input = document.getElementById('txt-retol-part');
            if (!input) return;

            if (state.structure && state.structure[state.pieceIndex]) {
                const p = state.structure[state.pieceIndex];
                input.value = p.id + " (" + (p.theme || "???") + ")";
            } else {
                input.value = "FINALITZAT";
            }
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