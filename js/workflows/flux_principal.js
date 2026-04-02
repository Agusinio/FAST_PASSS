/**
 * ============================================================================
 * flux_principal.js (Workflow de Botó Principal)
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

        _runNew: async function () {
            try {
                const ctx = await this._setupContext();
                const assets = await this._fullScan(ctx);
                
                const sanitizedTheme = getUtils().sanitizeName(assets.wotts.tema).toUpperCase();
                const shortProg = ctx.progData.wott || "TNV"; 
                const projSlug = `${shortProg}_${ctx.bloque}_${sanitizedTheme}`;
                
                const fileName = `Pruebas_${projSlug}.prproj`;
                const folderPath = ctx.config.rutas.destinoBase + ctx.progData.directorio + "/" + ctx.dateDir;
                const fullDestPath = (folderPath + "/" + fileName).replace(/\\/g, "/");

                const paths = {
                    plantillaPath: ctx.config.rutas.plantilla_net,
                    fullDestPath: fullDestPath,
                    folderPath: folderPath,
                    sanitizedTheme: sanitizedTheme
                };

                log(`🏗️ Generant projecte: ${fileName}`);

                // 1. CREACIÓ FÍSICA (AQUÍ YA SE INGESTAN LOS ARCHIVOS)
                await FASTPASS_UI.Logic.Project.create(ctx, assets.wotts, assets.media, paths, assets.portada, shortProg);

                log("✅ Workflow NOU completat amb èxit.");
        
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
                return await callJSX("Projecte.save()");
            }

            const currentPath = await callJSX("Projecte.path()");

            if (currentPath.indexOf("PENDENT") !== -1) {
                log("🧬 Projecte PENDENT detectat. Promocionant...");

                const sanitizedTema = getUtils().sanitizeName(assets.wotts.tema);
                const newProjectName = ctx.config.naming.getProjectName(ctx, sanitizedTema);
                const newPath = ctx.config.rutas.destinoBase + ctx.progData.directorio + "\\" + ctx.dateDir + "\\" + "Pruebas_" + newProjectName + ".prproj";

                // INGESTA I SYNC
                await this._completeSyncUI(ctx, assets);

                log(`💾 Guardant com a: ${newPath}`);
                const saveRes = await callJSX(`Projecte.saveAs('${getUtils().escape(newPath)}')`);

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
                await callJSX("Projecte.save()");
                log("✅ Actualització completada.");
            }
        },

        _runGo: async function (projName) {
            log(`🚀 [FLOW-GO] Canviant focus a: ${projName}...`);
            const res = await callJSX(`Entorn.set('${getUtils().escape(projName)}')`);
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
            await callJSX(`Projecte.open('${destPath.replace(/\\/g, "\\\\")}')`);
            
            // Sync después de abrir
            await this._completeSyncUI(ctx, assets);
            
            log("✅ Projecte obert.");
        },

        /**
         * _fullScan: Escaneja rètols, media i portada, i actualitza flags de Context.
         */
        _fullScan: async function (ctx) {
            log("🔍 [SCAN] Analitzant context i materials...");
            
            // 1. Busquem materials al NAS
            const wotts = await window.Scan.wotts(ctx);
            const media = await window.Scan.mediaAssets(ctx);
            const portada = await window.Scan.portadas(ctx);
            
            // 2. Actualitzem State global
            window.FASTPASS_UI.State.detectedTheme = wotts.tema;
            window.FASTPASS_UI.State.hasMedia = !!media.mp4;
            
            // 3. Verificació de projecte existent al destí
            const folderDest = ctx.config.rutas.destinoBase + ctx.progData.directorio + "/" + ctx.dateDir;
            const projectFiles = await getUtils().readFolder(folderDest);
            const existingProj = window.Scan.selectedProject(projectFiles, ctx.progData.wott, ctx.bloque);
            
            window.FASTPASS_UI.State.activeProjectName = existingProj;
            window.FASTPASS_UI.State.buttonState = existingProj ? "OPEN" : "NEW";

            // Retornem el paquet d'assets per a ús immediat
            return { wotts, media, portada };
        },

        /**
         * _completeSyncUI: Ingesta assets, autocol·loca MP4 i activa targeting.
         */
        _completeSyncUI: async function(ctx, assets) {
            log("🎞️ [SYNC] Ingestant assets i fixant focus...");
            
            // 1. Ingesta (Rètols, Media)
            await FASTPASS_UI.Logic.Project.ingestAssets(ctx, assets.wotts, assets.media, assets.portada);

            // 2. Auto-Insert MP4 si V1 està buida
            if (assets.media && assets.media.mp4) {
                const v1Count = await callJSX("Segments.count(1, 'video')");
                if (parseInt(v1Count) === 0) {
                    log("🎞️ V1 buida. Autocol·locant vídeo...");
                    const escapedMediaName = encodeURIComponent(assets.media.mp4.name);
                    await callJSX(`Segments.insert('${escapedMediaName}', 1, 0)`);
                }
            }

            // 3. Focus i Targeting
            await callJSX("Pistes.target(1, true, 'video')");
            await callJSX("Pistes.target(1, true, 'audio')");
        },

        _setupContext: async function () {
            const config = FASTPASS_UI.Config.get();
            const idProg = document.getElementById('programa').value;
            const progData = config.mapeoProgramas[idProg];
            const dateDir = getUtils().getFormattedDate().replace(/["\s]/g, "").trim();

            return {
                config,
                progData,
                programa: idProg,
                bloque: document.getElementById('bloc').value,
                dateDir
            };
        }
    };

    window.FASTPASS_UI.Workflows.MainButton = FASTPASS_UI.Workflows.MainButton;
})();