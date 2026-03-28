/**
 * ============================================================================
 * WORKFLOW: RETOLS I GRÀFICS - v2.6.0 literal
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
         * Genera un Freeze Frame d'un clip de tema i el col·loca al timeline.
         */
        processThemeFreeze: async function (themeClipName, cti, folderPath, programPrefix) {
            log("📸 Generant Freeze Frame...");
            const cfg = FASTPASS_UI.Config.get();
            const T_THEME = cfg.tracks.video.tematitol;

            try {
                // Inserir literalment: Clips.insert(nom, pista, segons, duració, tipus)
                await callJSX(`Clips.insert('${getUtils().escape(themeClipName)}', ${T_THEME}, 0.0, null, 'video')`);

                await callJSX(`Timeline.set(7.0)`);
                await callJSX("System.clear()");
                await getUtils().delay(800);

                let cleanName = themeClipName.split("Tema-Titol_")[1] || themeClipName;
                cleanName = cleanName.replace(/\.\d+\.mov$/i, "").substring(0, 30);
                const fileName = `${programPrefix}_${cleanName}_Freeze.png`;
                const fullPath = `${folderPath}\\${fileName}`;

                // Literal: Render.snapshot()
                await callJSX(`Render.snapshot('${fullPath.replace(/\\/g, "\\\\")}', 7.0)`);

                // Literal: IO.importFiles()
                const payload = JSON.stringify([fullPath.replace(/\\/g, "\\\\")]);
                await callJSX(`IO.importFiles('${payload}', 'root')`);
                
                await callJSX(`Clips.insert('${getUtils().escape(fileName)}', ${T_THEME}, 7.0, null, 'video')`);
                
                log("✅ Freeze Frame col·locat a V" + T_THEME, "INFO");

            } catch (e) { getUtils().handleError(e, "ThemeFreeze"); }
        },

        runPlaceChyrons: async function () {
            if (!(await getUtils().validateActiveSequence())) return;
            log("🎬 Aplicant rètols segons el nou mapa de pistes...");
            const cfg = FASTPASS_UI.Config.get();
            const state = FASTPASS_UI.State;
            const idx = state.pieceIndex;
            const struct = state.structure;

            const T_THEME = cfg.tracks.video.tematitol; 
            const T_GRAFICOS = cfg.tracks.video.graficos; 
            const T_CHYRONS = cfg.tracks.video.chyrons; 
            const T_LLOC = cfg.tracks.video.llocdata;   

            if (!struct || !struct[idx]) {
                log("⚠️ No es troba l'estructura del lloc al State.", "WARN");
                return;
            }

            try {
                const piece = struct[idx];
                const ctiRaw = await callJSX('Timeline.get()');
                const cti = parseFloat(ctiRaw || "0");

                if (piece.themeTitle) {
                    await callJSX(`Clips.insert('${getUtils().escape(piece.themeTitle.name)}', ${T_THEME}, ${cti}, null, 'video')`);
                }

                if (piece.graphics) {
                    for (const g of piece.graphics) {
                        await callJSX(`Clips.insert('${getUtils().escape(g.cleanName)}', ${T_GRAFICOS}, ${cti}, null, 'video')`);
                    }
                }

                if (piece.chyrons && piece.chyrons.length > 0) {
                    let firstTs = piece.chyrons[0].timestamp || 0;
                    for (let i = 0; i < piece.chyrons.length; i++) {
                        const c = piece.chyrons[i];
                        const diff = (c.timestamp > 0) ? (c.timestamp - firstTs) / 1000 : i * 4.0;
                        
                        let track = T_CHYRONS;
                        if (c.name.indexOf("Lloc") !== -1 || c.name.indexOf("Data") !== -1) {
                            track = T_LLOC;
                        }
                        
                        await callJSX(`Clips.insert('${getUtils().escape(c.name)}', ${track}, ${cti + diff}, null, 'video')`);
                    }
                }

                state.pieceIndex++;
                getUtils().status(`Peça ${piece.id} processada.`, "exito");
            } catch (e) { getUtils().handleError(e, "PlaceChyrons"); }
        },

        runPlaceGraph169: async function () {
            log("🎬 Aplicant format 16:9 amb fondos...");
            const cfg = FASTPASS_UI.Config.get();
            const T_MP4 = cfg.tracks.video.mp4;     
            const T_FONS = cfg.tracks.video.fondos;  

            try {
                const info = await getClipsLogic().findAtTime(T_MP4, -1, "video");
                if (!info) throw new Error("No s'ha trobat clip a la pista mp4 (V" + T_MP4 + ")");

                await getClipsLogic().apply169Preset(T_MP4, info.index);

                const bgName = "Fons_16_9_GENERIC.png";
                await callJSX(`Clips.insert('${getUtils().escape(bgName)}', ${T_FONS}, ${info.start}, null, 'video')`);
                
            } catch (e) { getUtils().handleError(e, "Graph169"); }
        },

        runPlaceBackground: async function () {
            if (!(await getUtils().validateActiveSequence())) return;
            log("🎬 Col·locant fons a V3 a partir del cabezal...");
            const cfg = FASTPASS_UI.Config.get();
            const T_FONS = cfg.tracks.video.fondos;  

            try {
                const ctiRaw = await callJSX('Timeline.get()');
                const cti = parseFloat(ctiRaw || "0");

                const bgName = "Fons_Vertical_Generic.png";
                
                log(`📌 Inserint ${bgName} a V${T_FONS} (Time: ${cti})`);
                await callJSX(`Clips.insert('${getUtils().escape(bgName)}', ${T_FONS}, ${cti}, null, 'video')`);
                
                getUtils().status("Fons col·locat al cabezal", "exito");

            } catch (e) { getUtils().handleError(e, "PlaceBackground"); }
        }
    };

    window.FASTPASS_UI.Workflows.Retols = FASTPASS_UI.Workflows.Retols;
})();