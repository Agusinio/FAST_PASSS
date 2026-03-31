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

        /**
         * runMainAction: Acció principal orquestrada pel Context.
         */
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
                const elProg = document.getElementById('programa');
                const elBloc = document.getElementById('bloc');
                const ctx = { 
                    config, 
                    progData: config.mapeoProgramas[elProg.value], 
                    bloque: elBloc.value, 
                    dateDir: utils.getFormattedDate().replace(/"/g, "").trim() 
                };
        
                const wottData = await window.Scan.wotts(ctx); 
                const sanitizedTheme = utils.sanitizeName(wottData.tema || 'PENDENT');
                const projSlug = config.naming.getProjectName(ctx, sanitizedTheme);
                const fileName = `Pruebas_${projSlug}.prproj`;
                const folderPath = config.rutas.destinoBase + ctx.progData.directorio + "/" + ctx.dateDir;
                const fullDestPath = folderPath + "/" + fileName;
                // A. Forzamos barras inclinadas
                const safePath = fullDestPath.replace(/\\/g, "/");
        
                // 1. ABRIR PLANTILLA
                const plantillaPath = config.rutas.plantilla_net.replace(/\\/g, "/");
                utils.log(`📂 Obrint plantilla: ${plantillaPath}`);
                await utils.callJSX(`Project.open('${plantillaPath}')`);
                
                //await utils.delay(800); // Pausa para que Premiere registre el proyecto abierto
        
                // 2. PREPARAR EL BIN "CHY"
                utils.log(`📂 Preparant carpeta CHY al projecte...`);
                // Creamos el bin y capturamos el nombre confirmado (debería ser "CHY")
                const binTarget = await utils.callJSX("Project.bin('CHY')");

                // 3. INGESTA DE RÈTOLS (Wotts)
                if (wottData.list && wottData.list.length > 0) {
                    utils.log(`📥 Ingestant ${wottData.list.length} rètols al ROOT...`);
                    
                    // 📍 SOLO normalizamos barras, SIN escapar comillas aquí
                    const safeWotts = wottData.list.map(f => f.path.replace(/\\/g, "/"));
                    
                    // El importList usará JSON.stringify internamente, que ya es seguro
                    await utils.importList(safeWotts, "root"); 
                
                    // B. MOVER A BIN (Aquí sí escapamos para la llamada directa)
                    utils.log(`📂 Organitzant rètols a la carpeta CHY...`);
                    await utils.callJSX("Project.bin('CHY')");
                
                    for (const wott of wottData.list) {
                        // Escapamos solo para el comando Project.move
                        const escapedName = wott.name.replace(/'/g, "\\'");
                        await utils.callJSX(`Project.move('${escapedName}', 'CHY')`);
                    }
                }
        
                const media = await window.Scan.mediaAssets(ctx);
                if (media && media.mp4) {
                    const plantillaSeq = "OTT VERTICAL"; 
                    utils.log(`👥 Buscant i clonant: ${plantillaSeq}`);
                    
                    // 1. CLONAR (Enviamos codificado por seguridad)
                    const newSeqName = await utils.callJSX(`Project.clone('${encodeURIComponent(plantillaSeq)}')`);
                    
                    if (newSeqName && newSeqName !== "" && newSeqName.indexOf("ERR") === -1) {
                        const finalSeqName = config.naming.getSequenceName(ctx, sanitizedTheme);
                        await utils.callJSX(`Project.rename('${encodeURIComponent(newSeqName)}', '${encodeURIComponent(finalSeqName)}')`);
                        
                        // Usamos Project.rename del Bridge
                        await utils.callJSX(`Project.rename('${encodeURIComponent(newSeqName)}', '${encodeURIComponent(finalSeqName)}')`);
                
                        // 3. INSERTAR MP4
                        utils.log(`🎬 Estampant vídeo a la V1...`);
                        const escapedMediaName = encodeURIComponent(media.mp4.name);
                        await utils.callJSX(`Clips.insert('${escapedMediaName}', 1, 0)`);
                        
                    } else {
                        utils.log(`❌ No s'ha trobat la seqüència en cap carpeta del projecte.`, "ERROR");
                    }
                }
        
                // 5. ASEGURAR CARPETAS
                await utils.ensureFolders(folderPath);
        
                // 6. GUARDADO FINAL (SAVE AS)
                // A. Forzamos barras inclinadas
                //const safePath = fullDestPath.replace(/\\/g, "/");

                // B. ESCAPADO CRÍTICO: Escapamos las comillas simples (') para que no rompan el callJSX
                // Esto convertirá "L'ESCOLA" en "L\'ESCOLA" para que el bridge lo acepte
                const escapedPath = safePath.replace(/'/g, "\\'");

                utils.log(`🏗️ Enviant ordre de SaveAs per a: ${escapedPath}`);

                // C. Llamada con la ruta protegida
                let saveRes = await utils.callJSX(`Project.saveAs('${escapedPath}')`);
                
                // 🔄 RE-INTENTO: Si falla o Premiere no responde, esperamos y reintentamos una vez más
                if (saveRes && saveRes.indexOf("ERR") !== -1) {
                    utils.log("⚠️ Primer intent fallit, reintentant en 1/2 segon...", "WARN");
                    await utils.delay(2000);
                    saveRes = await utils.callJSX(`Project.saveAs('${safePath}')`);
                }
        
                if (saveRes && saveRes.indexOf("ERR") !== -1) throw new Error("Premiere no ha permès guardar: " + saveRes);
        
                // 7. LOCK
                await this._createLock(fullDestPath);
        
                utils.log("✅ Workflow NOU completat amb èxit.");
        
            } catch (e) {
                FASTPASS_UI.Utils.log("💥 Error crític a runNew: " + e.message, "ERROR");
            }
        },

        _runUpdate: async function () {
            log("🚀 [FLOW-UPDATE]");
            const ctx = await this._setupContext();
            const wottData = await window.Scan.wotts(ctx);

            if (!wottData || !wottData.tema) {
                log("⚠️ Encara no hi ha rètols al NAS. Guardant progrés...");
                return await callJSX("Project.save()");
            }

            // Literal: Project.path()
            const currentPath = await callJSX("Project.path()");

            if (currentPath.indexOf("PENDENT") !== -1) {
                log("🧬 Projecte PENDENT detectat. Promocionant...");

                const sanitizedTema = getUtils().sanitizeName(wottData.tema);
                const newProjectName = ctx.config.naming.getProjectName(ctx, sanitizedTema);
                const newPath = ctx.config.rutas.destinoBase + ctx.progData.directorio + "\\" + ctx.dateDir + "\\" + "Pruebas_" + newProjectName + ".prproj";

                const media = await window.Scan.mediaAssets(ctx);
                await this._performSync(ctx, wottData, media);

                log(`💾 Guardant com a: ${newPath}`);
                // Literal: Project.saveAs()
                const saveRes = await callJSX(`Project.saveAs('${getUtils().escape(newPath)}')`);

                if (saveRes === "OK") {
                    log(`🗑️ Eliminant rastre PENDENT...`);
                    getUtils().deleteFile(currentPath);
                    getUtils().deleteFile(currentPath + ".lock");
                    await this._createLock(newPath);
                    log("🟢 Projecte promocionat amb èxit!");
                }
            } else {
                const media = await window.Scan.mediaAssets(ctx);
                await this._performSync(ctx, wottData, media);
                await callJSX("Project.save()");
                log("✅ Actualització completada.");
            }
        },

        _runGo: async function (projName) {
            log(`🚀 [FLOW-GO] Canviant focus a: ${projName}...`);
            // Literal: Context.set()
            const res = await callJSX(`Context.set('${getUtils().escape(projName)}')`);
            if (res === "OK") {
                if (FASTPASS_UI.Core && FASTPASS_UI.Core.Context) {
                    await FASTPASS_UI.Core.Context.checkContext();
                }
            }
        },

        _runLoad: async function () {
            log("🚀 [FLOW-LOAD]");
            const ctx = await this._setupContext();
            const cfg = ctx.config;

            const wottData = await window.Scan.wotts(ctx);
            const sanitizedTheme = getUtils().sanitizeName(wottData.tema || 'PENDENT');
            const projSlug = ctx.config.naming.getProjectName(ctx, sanitizedTheme);
            //const destPath = cfg.rutas.destinoBase + ctx.progData.directorio + "\\" + ctx.dateDir + "\\" + `Pruebas_${projSlug}.prproj`;
            const destPath = cfg.rutas.destinoBase + ctx.progData.directorio + "/" + ctx.dateDir + "/" + `Pruebas_${projSlug}.prproj`;
            await callJSX(`IO.writeTxt('${folderPath}/.keep', 'temp')`); // Truco para forzar creación de carpeta
            
            await this._createLock(destPath);
            // Literal: Project.open()
            await callJSX(`Project.open('${destPath.replace(/\\/g, "\\\\")}')`);
            log("✅ Projecte obert.");
        },

        _createLock: async function (projPath) {
            try {
                const lockPath = projPath + ".lock";
                const user = await callJSX("IO.getUser()");
                
                // 📍 BLINDAJE 1: Pasamos la ruta con barras / para que no haya líos de escape
                const safeLockPath = lockPath.replace(/\\/g, "/"); 
                
                log(`🔒 Escrivint bloqueig per a ${user}...`);
                
                // Enviamos el comando con la ruta ya normalizada
                await callJSX(`IO.writeTxt('${safeLockPath}', '${user}')`);
                
            } catch (e) { console.error("Error creant .lock", e); }
        },

        _performSync: async function (ctx, wottData, media) {
            const utils = getUtils();
            log("🎞️ [SYNC] Iniciant ingesta segmentada...");

            let mediaPaths = [];
            if (media?.mp4?.path) mediaPaths.push(media.mp4.path);
            if (media?.srt?.path) mediaPaths.push(media.srt.path);

            if (mediaPaths.length > 0) {
                log(`📥 Ingestant media a root...`);
                await utils.importList(mediaPaths, "root");
            }

            if (wottData.list && wottData.list.length > 0) {
                const wottPaths = wottData.list.map(w => w.path);
                log(`📥 Ingestant ${wottPaths.length} rètols al Bin CHYRON...`);
                await utils.importList(wottPaths, "CHYRON");
            }
        },

        _setupContext: async function () {
            const config = FASTPASS_UI.Config.get();
            const idProg = document.getElementById('programa').value;
            const progData = config.mapeoProgramas[idProg];
            const dateStr = getUtils().getFormattedDate();
            const dateDir = dateStr.replace(/["\s]/g, "").trim();

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