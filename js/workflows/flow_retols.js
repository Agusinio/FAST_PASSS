/*
 * =================================================================================
 * PROJECTE: FAST >>> PASS
 * ARXIU: flow_retols.js (WORKFLOW: RÈTOLS I GRÀFICS - v10 LIPO COMPLETA)
 * =================================================================================
 */

(function () {
    window.FASTPASS_UI = window.FASTPASS_UI || {};
    const FASTPASS_UI = window.FASTPASS_UI || {};
    FASTPASS_UI.Workflows = FASTPASS_UI.Workflows || {};

    const utils = FASTPASS_UI.Utils;
    const tracksLogic = FASTPASS_UI.Logic.Tracks;

    FASTPASS_UI.Workflows.Retols = {

        /**
         * Genera un Freeze Frame d'un clip de tema i el col·loca al timeline.
         */
        processThemeFreeze: async function (themeClipName, cti, folderPath, programPrefix) {
            utils.log("📸 Generant Freeze Frame: " + themeClipName, "INFO");

            try {
                // 1. Ingesta atòmica
                await utils.callJSX(`jsx_overwriteClip("${utils.escape(themeClipName)}", 4, 0.0)`);

                // 2. Setup de captura (07:00)
                await utils.callJSX(`jsx_setCTI_Safe(7.0)`);
                await utils.callJSX("jsx_nuclearRefresh()");
                await utils.delay(1000);

                // 3. Destí
                let cleanName = themeClipName.split("Tema-Titol_")[1] || themeClipName;
                cleanName = cleanName.replace(/\.\d+\.mov$/i, "").substring(0, 30);
                const fileName = `${programPrefix}_${cleanName}_Freeze.png`;
                const fullPath = `${folderPath}\\${fileName}`.replace(/\\/g, '\\\\');

                // 4. Exportació
                const resString = await utils.callJSX(`jsx_exportSnapshot_CurrentTime("${utils.escape(fullPath)}")`);
                const res = JSON.parse(resString);

                // 📍 REFACTOR: Lògica de restauració en JS des de Tracks_Logic
                await tracksLogic.unmuteAll("video");

                if (res.success) {
                    await utils.importList([{ path: fullPath.replace(/\\\\/g, "\\") }], "root", true);
                    await utils.callJSX(`jsx_overwriteClip(4, "${utils.escape(fileName)}", 7.0)`);
                    // TODO: Mantenir l'ajust de stretch si escau (via bridge)
                    await utils.callJSX(`jsx_nuclearRefresh()`);
                    utils.log("✅ Freeze Frame col·locat.", "INFO");
                } else {
                    utils.log("❌ Error exportació: " + res.log, "ERROR");
                }

            } catch (e) {
                utils.handleError(e, "ThemeFreeze");
            }
        },

        /**
         * Workflow principal de col·locació de rètols.
         */
        runPlaceChyrons: async function () {
            utils.log("🎬 Iniciant col·locació de RÈTOLS...", "DEBUG");
            const struct = FASTPASS_UI.State.structure;
            const idx = FASTPASS_UI.State.pieceIndex;

            if (!struct || struct.length === 0 || idx >= struct.length) {
                utils.setBusy(false);
                return;
            }

            try {
                const piece = struct[idx];
                const cti = parseFloat(await utils.callJSX('jsx_getCTI()'));

                // 1. Tema-Titol (V4=4)
                if (piece.themeTitle) {
                    await utils.callJSX(`jsx_overwriteClip(4, "${utils.escape(piece.themeTitle.name)}", ${cti})`);
                }

                // 2. Grafismes Addicionals (V7=7 o V2=2)
                if (piece.graphics) {
                    for (const g of piece.graphics) {
                        const track = (g.type === "GRAFISME") ? 7 : 2;
                        await utils.callJSX(`jsx_overwriteClip(${track}, "${utils.escape(g.cleanName)}", ${cti})`);
                    }
                }

                // 3. Chyrons
                if (piece.chyrons && piece.chyrons.length > 0) {
                    let firstTs = piece.chyrons[0].timestamp || 0;
                    for (let i = 0; i < piece.chyrons.length; i++) {
                        const c = piece.chyrons[i];
                        const diff = (c.timestamp > 0) ? (c.timestamp - firstTs) / 1000 : i * 4.0;
                        const track = (c.name.indexOf("Lloc") !== -1) ? 6 : 4;
                        await utils.callJSX(`jsx_overwriteClip(${track}, "${utils.escape(c.name)}", ${cti + diff})`);
                    }
                }

                FASTPASS_UI.State.pieceIndex++;
                utils.status(`Peça ${piece.id} col·locada.`, "exito");
            } catch (e) {
                utils.handleError(e, "PlaceChyrons");
            } finally {
                utils.setBusy(false);
            }
        },

        /**
         * Aplica fons i transformació 16:9.
         */
        runPlaceGraph169: async function () {
            utils.log("🎬 Aplicant preset 16:9...", "DEBUG");
            try {
                const infoRaw = await utils.callJSX('jsx_getClipDataByIndex(1, 0)'); // V2=1, primer clip
                const info = JSON.parse(infoRaw);

                if (!info) throw new Error("No s'ha detectat clip estructural en V2.");

                // Aplicació de preset atòmic des de Lògica
                await FASTPASS_UI.Logic.Clips.apply169Preset(1, info.index);

                // Col·locar Fons en V1
                const bgName = "Fons_16_9_TBD.png";
                await utils.callJSX(`jsx_overwriteClip(1, "${utils.escape(bgName)}", ${info.start})`);
                
            } catch (e) {
                utils.handleError(e, "Graph169");
            } finally {
                utils.setBusy(false);
            }
        }
    };

    window.FASTPASS_UI = FASTPASS_UI;
})();