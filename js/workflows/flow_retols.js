/**
 * ============================================================================
 * WORKFLOW: RETOLS I GRÀFICS (v11 - VERSIÓ ULTRA-LIPO)
 * ============================================================================
 */

(function () {
    var FASTPASS_UI = window.FASTPASS_UI || {};
    FASTPASS_UI.Workflows = FASTPASS_UI.Workflows || {};

    const utils = window.FASTPASS_UI.Utils;
    const tracksLogic = window.FASTPASS_UI.Logic.Tracks;
    const clipsLogic = window.FASTPASS_UI.Logic.Clips;
    const log = (m) => utils.log(m, "DEBUG");
    const callJSX = (s) => utils.callJSX(s);

    FASTPASS_UI.Workflows.Retols = {

        /**
         * Genera un Freeze Frame d'un clip de tema i el col·loca al timeline.
         */
        processThemeFreeze: async function (themeClipName, cti, folderPath, programPrefix) {
            log("📸 Generant Freeze Frame: " + themeClipName);
            try {
                // 1. Col·locació inicial del clip de tema a V4 (pista 4)
                await callJSX(`jsx_overwriteClip('${utils.escape(themeClipName)}', 4, 0.0, 'video')`);

                // 2. Posicionament per a captura (Frame 07:00)
                await callJSX(`jsx_setCTI_Safe(7.0)`);
                await callJSX("jsx_ClearCache()");
                await utils.delay(800);

                // 3. Preparació de ruta de destí
                let cleanName = themeClipName.split("Tema-Titol_")[1] || themeClipName;
                cleanName = cleanName.replace(/\.\d+\.mov$/i, "").substring(0, 30);
                const fileName = `${programPrefix}_${cleanName}_Freeze.png`;
                const fullPath = `${folderPath}\\${fileName}`;

                // 4. Captura del Frame (Snapshot)
                // Usem el pont genèric d'exportació
                await callJSX(`jsx_exportFrameQE('${fullPath.replace(/\\/g, "\\\\")}', 7.0)`);

                // 5. Ingesta i col·locació del Freeze Frame resultat
                const payload = JSON.stringify([fullPath.replace(/\\/g, "\\\\")]);
                await callJSX(`jsx_importFiles('${payload}', 'root')`);
                
                // Col·loquem el PNG a V4 a sobre del anterior (overwrite)
                await callJSX(`jsx_overwriteClip('${utils.escape(fileName)}', 4, 7.0, 'video')`);
                
                log("✅ Freeze Frame col·locat correctament.", "INFO");

            } catch (e) { utils.handleError(e, "ThemeFreeze"); }
        },

        /**
         * Workflow principal de col·locació de rètols (Chyrons).
         */
        runPlaceChyrons: async function () {
            log("🎬 Aplicant rètols de peça...");
            const state = FASTPASS_UI.State;
            const idx = state.pieceIndex;
            const struct = state.structure;

            if (!struct || !struct[idx]) {
                log("⚠️ No hi ha estructura de peça definida al State.", "WARN");
                return;
            }

            try {
                const piece = struct[idx];
                const ctiRaw = await callJSX('jsx_getCTI()');
                const cti = parseFloat(ctiRaw || "0");

                // --- 1. TEMA-TITOL (V4) ---
                if (piece.themeTitle) {
                    await callJSX(`jsx_overwriteClip('${utils.escape(piece.themeTitle.name)}', 4, ${cti}, 'video')`);
                }

                // --- 2. GRAFISMES (V7 o V2) ---
                if (piece.graphics) {
                    for (const g of piece.graphics) {
                        const track = (g.type === "GRAFISME") ? 7 : 2;
                        await callJSX(`jsx_overwriteClip('${utils.escape(g.cleanName)}', ${track}, ${cti}, 'video')`);
                    }
                }

                // --- 3. CHYRONS INDIVIDUALS ---
                if (piece.chyrons && piece.chyrons.length > 0) {
                    let firstTs = piece.chyrons[0].timestamp || 0;
                    for (let i = 0; i < piece.chyrons.length; i++) {
                        const c = piece.chyrons[i];
                        const diff = (c.timestamp > 0) ? (c.timestamp - firstTs) / 1000 : i * 4.0;
                        // Regla de negoci: Els clips amb "Lloc" van a V6, la resta a V4
                        const track = (c.name.indexOf("Lloc") !== -1) ? 6 : 4;
                        await callJSX(`jsx_overwriteClip('${utils.escape(c.name)}', ${track}, ${cti + diff}, 'video')`);
                    }
                }

                state.pieceIndex++;
                utils.status(`Peça ${piece.id} processada.`, "exito");
            } catch (e) { utils.handleError(e, "PlaceChyrons"); }
        },

        /**
         * Aplica el preset de Fons 16:9 i posiciona el clip estructural.
         */
        runPlaceGraph169: async function () {
            log("🎬 Aplicant format 16:9...");
            try {
                // Busquem el clip base a V2 (pista 2)
                const info = await clipsLogic.findAtTime(2, -1, "video");
                if (!info) throw new Error("No s'ha trobat clip a V2 per aplicar el 16:9");

                // Apliquem transformació KF des de Lògica
                await clipsLogic.apply169Preset(2, info.index);

                // Col·loquem el Fons estàndard a V1 (pista 1)
                const bgName = "Fons_16_9_GENERIC.png";
                await callJSX(`jsx_overwriteClip('${utils.escape(bgName)}', 1, ${info.start}, 'video')`);
                
            } catch (e) { utils.handleError(e, "Graph169"); }
        }
    };

    window.FASTPASS_UI = FASTPASS_UI;
})();