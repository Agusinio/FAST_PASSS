/**
 * ============================================================================
 * WORKFLOW: MAIN BUTTON - v2.6.0 literal
 * ============================================================================
 */

(function () {
    var FASTPASS_UI = window.FASTPASS_UI || {};
    FASTPASS_UI.Workflows = FASTPASS_UI.Workflows || {};

    const getUtils = () => window.FASTPASS_UI.Utils;
    const log = (...args) => getUtils().log(...args);
    const callJSX = (s) => getUtils().callJSX(s);

    FASTPASS_UI.Workflows.MainButton = {

        runMainAction: async function (action, data) {
            log("⏯️ Iniciant workflow: [" + action + "]");
            getUtils().updateUIState('BUSY');

            try {
                switch (action) {
                    case 'NEW': await this._runNew(); break;
                    case 'UPDATE': await this._runUpdate(); break;
                    case 'LOAD': await this._runLoad(); break;
                    case 'GO': await this._runGo(data.name); break;
                }
                getUtils().status('Procés completat!', 'exito');
            } catch (e) {
                getUtils().handleError(e, "MainAction");
            } finally {
                getUtils().updateUIState('READY');
            }
        },

        _runNew: async function (data) {
            try {
                const utils = FASTPASS_UI.Utils;
                const config = FASTPASS_UI.Config.get();
                const ctx = await this._setupContext();
        
                // 1. ESCANEIG
                const assets = await this._fullScan(ctx);
                
                // 2. CÀLCUL DE RUTES
                const sanitizedTheme = utils.sanitizeName(assets.wotts.tema || 'PENDENT');
                const projSlug = config.naming.getProjectName(ctx, sanitizedTheme);
                const fileName = `Pruebas_${projSlug}.prproj`;
                const folderPath = config.rutas.destinoBase + ctx.progData.directorio + "/" + ctx.dateDir;
                const fullDestPath = folderPath + "/" + fileName;

                const paths = {
                    plantillaPath: config.rutas.plantilla_net,
                    fullDestPath: fullDestPath,
                    folderPath: folderPath,
                    sanitizedTheme: sanitizedTheme
                };

                // 3. EXECUCIÓ LÒGICA (LIPO)
                await FASTPASS_UI.Logic.Project.create(ctx, assets.wotts, assets.media, paths, assets.portada);

                // 4. FOCUS
                await callJSX("Tracks.target(1, true, 'video')");
                await callJSX("Tracks.target(1, true, 'audio')");

                utils.log("✅ Workflow NOU completat amb èxit.");
        
            } catch (e) {
                FASTPASS_UI.Utils.log("💥 Error crític a runNew: " + e.message, "ERROR");
            }
        },

        _runUpdate: async function () {
            log("🚀 [FLOW-UPDATE]");
            const ctx = await this._setupContext();
            
            // 1. ESCANEIG I SYNC
            const assets = await this._fullScan(ctx);

            if (!assets.wotts || !assets.wotts.tema) {
                log("⚠️ Encara no hi ha rètols al NAS. Guardant progrés...");
                return await callJSX("Project.save()");
            }

            const currentPath = await callJSX("Project.path()");

            if (currentPath.indexOf("PENDENT") !== -1) {
                log("🧬 Projecte PENDENT detectat. Promocionant...");

                const sanitizedTema = getUtils().sanitizeName(assets.wotts.tema);
                const newProjectName = ctx.config.naming.getProjectName(ctx, sanitizedTema);
                const newPath = ctx.config.rutas.destinoBase + ctx.progData.directorio + "\\" + ctx.dateDir + "\\" + "Pruebas_" + newProjectName + ".prproj";

                // INGESTA I SYNC
                await this._completeSyncUI(ctx, assets);

                log(`💾 Guardant com a: ${newPath}`);
                const saveRes = await callJSX(`Project.saveAs('${getUtils().escape(newPath)}')`);

                if (saveRes === "OK") {
                    log(`🗑️ Eliminant rastre PENDENT...`);
                    getUtils().deleteFile(currentPath);
                    getUtils().deleteFile(currentPath + ".lock");
                    await FASTPASS_UI.Logic.Project.lock(newPath);
                    log("🟢 Projecte promocionat amb èxit!");
                }
            } else {
                // INGESTA I SYNC ESTÀNDARD
                await this._completeSyncUI(ctx, assets);
                await callJSX("Project.save()");
                log("✅ Actualització completada.");
            }
        },

        _runGo: async function (projName) {
            log(`🚀 [FLOW-GO] Canviant focus a: ${projName}...`);
            const res = await callJSX(`Context.set('${getUtils().escape(projName)}')`);
            if (res === "OK") {
                const ctx = await this._setupContext();
                const assets = await this._fullScan(ctx);
                await this._completeSyncUI(ctx, assets);
                
                if (FASTPASS_UI.Core && FASTPASS_UI.Core.Context) {
                    await FASTPASS_UI.Core.Context.checkContext();
                }
            }
        },

        _runLoad: async function () {
            log("🚀 [FLOW-LOAD]");
            const ctx = await this._setupContext();
            const cfg = ctx.config;

            const assets = await this._fullScan(ctx);
            const sanitizedTheme = getUtils().sanitizeName(assets.wotts.tema || 'PENDENT');
            const projSlug = ctx.config.naming.getProjectName(ctx, sanitizedTheme);
            const destPath = cfg.rutas.destinoBase + ctx.progData.directorio + "/" + ctx.dateDir + "/" + `Pruebas_${projSlug}.prproj`;
            
            await FASTPASS_UI.Logic.Project.lock(destPath);
            await callJSX(`Project.open('${destPath.replace(/\\/g, "\\\\")}')`);
            
            // Sync después de abrir
            await this._completeSyncUI(ctx, assets);
            
            log("✅ Projecte obert.");
        },

        /**
         * _fullScan: Escaneja rètols, media i portada, i actualitza flags de Context.
         */
        _fullScan: async function(ctx) {
            const wotts = await window.Scan.wotts(ctx); 
            const media = await window.Scan.mediaAssets(ctx);
            const portada = await window.Scan.portada(ctx);

            FASTPASS_UI.Core.Context.missing.wotts = (!wotts.list || wotts.list.length === 0);
            FASTPASS_UI.Core.Context.missing.media = (!media || !media.mp4);
            FASTPASS_UI.Core.Context.missing.srt = (!media || !media.srt);
            FASTPASS_UI.Core.Context.missing.portada = (!portada);

            return { wotts, media, portada };
        },

        /**
         * _completeSyncUI: Ingesta assets, autocol·loca MP4 i activa targeting.
         */
        _completeSyncUI: async function(ctx, assets) {
            // 1. Ingesta
            await FASTPASS_UI.Logic.Project.ingestAssets(ctx, assets.wotts, assets.media, assets.portada);

            // 2. Auto-Insert MP4 si V1 es buida
            if (assets.media && assets.media.mp4) {
                const v1Count = await FASTPASS_UI.Logic.Clips.count(1, "video");
                if (parseInt(v1Count) === 0) {
                    getUtils().log("🎞️ V1 buida detectada. Autocol·locant MP4...");
                    const escapedMediaName = encodeURIComponent(assets.media.mp4.name);
                    await callJSX(`Clips.insert('${escapedMediaName}', 1, 0)`);
                }
            }

            // 3. Focas Track Targeting
            await callJSX("Tracks.target(1, true, 'video')");
            await callJSX("Tracks.target(1, true, 'audio')");
        },

        _setupContext: async function () {
            const config = FASTPASS_UI.Config.get();
            const elProg = document.getElementById('programa');
            const elBloc = document.getElementById('bloc');
            if (!elProg || !elBloc) return null;

            const idProg = elProg.value;
            const progData = config.mapeoProgramas[idProg];
            const dateStr = getUtils().getFormattedDate();
            const dateDir = dateStr.replace(/["\s]/g, "").trim();

            return {
                config,
                progData,
                programa: idProg,
                bloque: elBloc.value,
                dateDir
            };
        }
    };

    window.FASTPASS_UI.Workflows.MainButton = FASTPASS_UI.Workflows.MainButton;
})();