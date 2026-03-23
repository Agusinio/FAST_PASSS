/**
 * ============================================================================
 * WORKFLOW: RETOLS I GRÀFICS (v12 - VERSIÓ VARIABLES GLOBALS)
 * ============================================================================
 * Ara utilitza el mapa de pistes definit a Config.js per a l'orquestració.
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
                // Col·locació inicial a la pista de temes (V4)
                await callJSX(`jsx_overwriteClip('${getUtils().escape(themeClipName)}', ${T_THEME}, 0.0, 'video')`);

                await callJSX(`jsx_setCTI_Safe(7.0)`);
                await callJSX("jsx_ClearCache()");
                await getUtils().delay(800);

                let cleanName = themeClipName.split("Tema-Titol_")[1] || themeClipName;
                cleanName = cleanName.replace(/\.\d+\.mov$/i, "").substring(0, 30);
                const fileName = `${programPrefix}_${cleanName}_Freeze.png`;
                const fullPath = `${folderPath}\\${fileName}`;

                await callJSX(`jsx_exportFrameQE('${fullPath.replace(/\\/g, "\\\\")}', 7.0)`);

                const payload = JSON.stringify([fullPath.replace(/\\/g, "\\\\")]);
                await callJSX(`jsx_importFiles('${payload}', 'root')`);
                
                // Sobreescriure el tema original amb el PNG generat
                await callJSX(`jsx_overwriteClip('${getUtils().escape(fileName)}', ${T_THEME}, 7.0, 'video')`);
                
                log("✅ Freeze Frame col·locat a V" + T_THEME, "INFO");

            } catch (e) { getUtils().handleError(e, "ThemeFreeze"); }
        },

        /**
         * Workflow principal de col·locació automàtica de rètols de peça.
         */
        runPlaceChyrons: async function () {
            if (!(await getUtils().validateActiveSequence())) return;
            log("🎬 Aplicant rètols segons el nou mapa de pistes...");
            const cfg = FASTPASS_UI.Config.get();
            const state = FASTPASS_UI.State;
            const idx = state.pieceIndex;
            const struct = state.structure;

            // Variables de pistes des del Config
            const T_THEME = cfg.tracks.video.tematitol;
            const T_CHYRONS = cfg.tracks.video.chyrons; // V5: NomCarrec, Firma, Mapes
            const T_LLOC = cfg.tracks.video.llocdata;   // V6: Lloc-Data

            if (!struct || !struct[idx]) {
                log("⚠️ No es troba l'estructura del lloc al State.", "WARN");
                return;
            }

            try {
                const piece = struct[idx];
                const ctiRaw = await callJSX('jsx_getCTI()');
                const cti = parseFloat(ctiRaw || "0");

                // 1. TEMA-TITOL (V4)
                if (piece.themeTitle) {
                    await callJSX(`jsx_overwriteClip('${getUtils().escape(piece.themeTitle.name)}', ${T_THEME}, ${cti}, 'video')`);
                }

                // 2. GRAFISMES I MAPES (V5 ara, ja no V7)
                if (piece.graphics) {
                    for (const g of piece.graphics) {
                        await callJSX(`jsx_overwriteClip('${getUtils().escape(g.cleanName)}', ${T_CHYRONS}, ${cti}, 'video')`);
                    }
                }

                // 3. CHYRONS INDIVIDUALS
                if (piece.chyrons && piece.chyrons.length > 0) {
                    let firstTs = piece.chyrons[0].timestamp || 0;
                    for (let i = 0; i < piece.chyrons.length; i++) {
                        const c = piece.chyrons[i];
                        const diff = (c.timestamp > 0) ? (c.timestamp - firstTs) / 1000 : i * 4.0;
                        
                        // Determinació de pista segons contingut
                        let track = T_CHYRONS; // Per defecte V5
                        if (c.name.indexOf("Lloc") !== -1 || c.name.indexOf("Data") !== -1) {
                            track = T_LLOC; // V6
                        }
                        
                        await callJSX(`jsx_overwriteClip('${getUtils().escape(c.name)}', ${track}, ${cti + diff}, 'video')`);
                    }
                }

                state.pieceIndex++;
                getUtils().status(`Peça ${piece.id} processada.`, "exito");
            } catch (e) { getUtils().handleError(e, "PlaceChyrons"); }
        },

        /**
         * Aplica fons i preset sobre el clip seleccionat.
         */
        runPlaceGraph169: async function () {
            log("🎬 Aplicant format 16:9 amb fondos...");
            const cfg = FASTPASS_UI.Config.get();
            const T_MP4 = cfg.tracks.video.mp4;     // V1
            const T_FONS = cfg.tracks.video.fondos;  // V3

            try {
                const info = await getClipsLogic().findAtTime(T_MP4, -1, "video");
                if (!info) throw new Error("No s'ha trobat clip a la pista mp4 (V" + T_MP4 + ")");

                // Transformació del clip original a V1
                await getClipsLogic().apply169Preset(T_MP4, info.index);

                // Col·locació del fons a la pista dedicada (V3)
                const bgName = "Fons_16_9_GENERIC.png";
                await callJSX(`jsx_overwriteClip('${getUtils().escape(bgName)}', ${T_FONS}, ${info.start}, 'video')`);
                
            } catch (e) { getUtils().handleError(e, "Graph169"); }
        },

        /**
         * Col·locació directa del fons vertical a la pista V3.
         */
        runPlaceBackground: async function () {
            if (!(await getUtils().validateActiveSequence())) return;
            log("🎬 Col·locant fons a V3 a partir del cabezal...");
            const cfg = FASTPASS_UI.Config.get();
            const T_FONS = cfg.tracks.video.fondos;  // V3 (Fons)

            try {
                // Obtenim la posició actual del cabezal
                const ctiRaw = await callJSX('jsx_getCTI()');
                const cti = parseFloat(ctiRaw || "0");

                const bgName = "Fons_Vertical_Generic.png";
                
                log(`📌 Inserint ${bgName} a V${T_FONS} (Time: ${cti})`);
                await callJSX(`jsx_overwriteClip('${getUtils().escape(bgName)}', ${T_FONS}, ${cti}, 'video')`);
                
                getUtils().status("Fons col·locat al cabezal", "exito");

            } catch (e) { getUtils().handleError(e, "PlaceBackground"); }
        }
    };

    window.FASTPASS_UI = FASTPASS_UI;
})();