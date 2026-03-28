/**
 * ============================================================================
 * WORKFLOW: MAIN BUTTON (v16 - VARIABLES GLOBALS I TARGETING)
 * ============================================================================
 * Gestiona el cicle de vida del projecte (NOU, OBRIR, ANAR-HI, ACTUALITZAR)
 * Usant el mapa de pistes definit a Config.js.
 */

(function () {
    var FASTPASS_UI = window.FASTPASS_UI || {};
    FASTPASS_UI.Workflows = FASTPASS_UI.Workflows || {};

    const getUtils = () => window.FASTPASS_UI.Utils;
    const projectLogic = () => window.FASTPASS_UI.Logic.Project;
    const scanner = () => window.FASTPASS_UI.Logic.Scanner;

    const log = (...args) => FASTPASS_UI.Utils.log(...args);
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

        /**
         * FLOW: CREAR NOU TEMA
         */
        _runNew: async function () {
            const utils = getUtils(); // Aseguramos tener utils a mano
            log("🚀 [FLOW-NEW]");
            const ctx = await this._setupContext();
        
            // 1. Scanner de Tema
            const wottData = await scanner().findTemaData(ctx);
            const temaReal = (wottData && wottData.tema) ? wottData.tema : "PENDENT";
        
            const sanitizedTema = utils.sanitizeName(temaReal);
            
            // 3. Generar nombres
            const projectName = ctx.config.naming.getProjectName(ctx, sanitizedTema);
            const seqName     = ctx.config.naming.getSequenceName(ctx, sanitizedTema);
            
            const fileName    = `Pruebas_${projectName}.prproj`;
            const destPath    = ctx.config.rutas.destinoBase + ctx.progData.directorio + "\\" + ctx.dateDir + "\\" + fileName;
        
            utils.ensureFolders(destPath.substring(0, destPath.lastIndexOf("\\")));
        
            log(`🏗️ Creant projecte [${temaReal}]...`);
            const projectResult = await projectLogic().createFromTemplate(ctx.config.rutas.plantilla_net, destPath, seqName);
            
            if (projectResult === "OK" || projectResult.success) {
                await this._createLock(destPath);
        
                log("📁 Creant estructura de Bins obligatòria...");
                await utils.callJSX("FASTPASS.Project.createBin('CHYRON')");
        
                // 📍 MICRO-CIRURGIA: Guardem el resultat directament al CTX
                ctx.mediaAssets = await scanner().findMediaAssets(ctx);
                
                // Usem ctx.mediaAssets en la condició
                if ((wottData.list && wottData.list.length > 0) || (ctx.mediaAssets && ctx.mediaAssets.mp4)) {
                    log("🎞️ Iniciant sincronització de fitxers...");
                    // Passem ctx.mediaAssets a la sync
                    await this._performSync(ctx, wottData, ctx.mediaAssets);
                } else {
                    log("⚠️ No s'han trobat fitxers per importar.", "DEBUG");
                }
        
                // 📍 ARA SÍ: La condició es complirà
                if (ctx.mediaAssets && ctx.mediaAssets.mp4) {
                    const mp4Name = ctx.mediaAssets.mp4.name;
                    
                    // 📍 MICRO-CIRURGIA: Esperem 1 segon perquè Premiere "paeixi" la importació
                    await utils.delay(1000); 
                    
                    log(`🎬 Col·locant clip [${mp4Name}] al Timeline...`);
                
                    // Usem el nom del fitxer directament (Premiere identifica per nom al Bin)
                    const resTimeline = await utils.callJSX(`jsx_overwriteClip('${utils.escape(mp4Name)}', 1, 0, 'video')`);
                    
                    utils.log(`🧪 [JSX TIMELINE]: ${resTimeline}`, "DEBUG");
                    
                    if (resTimeline === "OK") {
                        log("✅ Clip inserit i visible al V1.");
                    }
                }
        
                log("✅ Procés de creació finalitzat.");
            }
        },
        
        _runUpdate: async function () {
            log("🚀 [FLOW-UPDATE]");
            const ctx = await this._setupContext();
            const wottData = await scanner().findTemaData(ctx);
            
            // Si sigue sin haber datos en el NAS, solo guardamos lo que el editor lleve hecho
            if (!wottData || !wottData.tema) {
                log("⚠️ Encara no hi ha rètols al NAS. Guardant progrés...");
                return await callJSX("app.project.save()");
            }
        
            // 📍 DETECCIÓN DE ZOMBI: ¿El proyecto actual se llama PENDENT?
            const currentPath = await callJSX("app.project.path");
            
            if (currentPath.indexOf("PENDENT") !== -1) {
                log("🧬 Projecte PENDENT detectat. Promocionant a Real...");
                
                const sanitizedTema = getUtils().sanitizeName(wottData.tema);
                const newProjectName = ctx.config.naming.getProjectName(ctx, sanitizedTema);
                const newPath = ctx.config.rutas.destinoBase + ctx.progData.directorio + "\\" + ctx.dateDir + "\\" + "Pruebas_" + newProjectName + ".prproj";
        
                // 1. Importar archivos (Ahora que ya existen)
                const media = await scanner().findMediaAssets(ctx);
                await this._performSync(ctx, wottData, media);
        
                // 2. PROMOCIÓN: SaveAs con el nombre definitivo
                log(`💾 Guardant com a: ${newPath}`);
                const saveRes = await callJSX(`jsx_saveProjectAs('${getUtils().escape(newPath)}')`);
        
                if (saveRes === "OK") {
                    // 3. LIMPIEZA: Borramos el cadáver del proyecto PENDENT
                    log(`🗑️ Eliminant rastre del projecte PENDENT...`);
                    getUtils().deleteFile(currentPath);
                    getUtils().deleteFile(currentPath + ".lock");
                    await this._createLock(newPath);
                    log("🟢 Projecte promocionat amb èxit!");
                }
            } else {
                // Update normal para proyectos que ya tenían nombre
                const media = await scanner().findMediaAssets(ctx);
                await this._performSync(ctx, wottData, media);
                await callJSX("app.project.save()");
                log("✅ Actualització completada.");
            }
        },
        
        /**
         * FLOW: ANAR AL PROJECTE (SI JA ESTÀ OBERT)
         */
        _runGo: async function (projName) {
            log(`🚀 [FLOW-GO] Canviant focus a: ${projName}...`);
            // El bridge reactivar el projecte a Premiere
            const res = await callJSX(`jsx_setWorkProject('${getUtils().escape(projName)}')`);
            if (res === "OK") {
                // Forçem actualització del botó
                if (FASTPASS_UI.Core && FASTPASS_UI.Core.Context) {
                    await FASTPASS_UI.Core.Context.checkContext();
                }
            }
        },

        /**
         * FLOW: OBRIR PROJECTE EXISTENT
         */
        _runLoad: async function () {
            log("🚀 [FLOW-LOAD]");
            const ctx = await this._setupContext();
            const cfg = ctx.config;
        
            const wottData = await scanner().findTemaData(ctx);
            const sanitizedTheme = getUtils().sanitizeName(wottData.tema || 'PENDENT');
            const projSlug = ctx.config.naming.getProjectName(ctx, sanitizedTheme);
            const destPath = cfg.rutas.destinoBase + ctx.progData.directorio + "\\" + ctx.dateDir + "\\" + `Pruebas_${projSlug}.prproj`;

            // 📍 BLOQUEIG: Creem el fitxer .lock
            await this._createLock(destPath);
            
            await callJSX(`app.openDocument('${destPath.replace(/\\/g, "\\\\")}')`);
            log("✅ Projecte obert.");
        },

        /**
         * @private
         * Crea el fitxer de bloqueig amb el nom de l'usuari.
         */
        _createLock: async function (projPath) {
            try {
                const lockPath = projPath + ".lock";
                const user = await callJSX("jsx_getUserName()");
                log(`🔒 Escrivint bloqueig per a ${user}...`);
                await callJSX(`jsx_writeTextFile('${lockPath.replace(/\\/g, "\\\\")}', '${user}')`);
            } catch(e) { console.error("Error creant .lock", e); }
        },

        /**
         * @private
         * Ingesta específica de la noticia (MP4, SRT i Rètols).
         */
        _performSync: async function (ctx, wottData, media) {
            const utils = getUtils();

            log("🎞️ [SYNC] Iniciant ingesta segmentada...");
        
            // 📍 A. INGESTA DE MEDIA (Vídeo + SRT) -> a 'root'
            let mediaPaths = [];
            if (media?.mp4?.path) mediaPaths.push(media.mp4.path);
            if (media?.srt?.path) mediaPaths.push(media.srt.path);
        
            if (mediaPaths.length > 0) {
                log(`📥 Ingestant media a root...`);
                await utils.importList(mediaPaths, "root");
            }
        
            // 📍 B. INGESTA DE RÈTOLS (Wotts) -> al Bin 'CHYRON'
            if (wottData.list && wottData.list.length > 0) {
                const wottPaths = wottData.list.map(w => w.path);
                log(`📥 Ingestant ${wottPaths.length} rètols al Bin CHYRON...`);
                
                // Cridem a importList passant "CHYRON" com a destí
                await utils.importList(wottPaths, "CHYRON");
            }
        },

        /**
         * @private
         * Sincronització de la llibreria de conductors (Incremental).
         */
        _syncConductors: async function(cfg) {
            const utils = getUtils();
            // 📍 Usa el nom EXACTE del Bin que ja tens a la plantilla
            // Si a la plantilla es diu "CHYRONS CONDUCTORS", posa-ho aquí:
            const NOM_BIN_PLANTILLA = "Conductors"; 
            
            log(`🎙️ Verificant llibreria a '${NOM_BIN_PLANTILLA}'...`);
            
            // 1. Llegim el que ja hi ha al projecte (Ara sí que funcionarà el bridge)
            const rawBin = await utils.callJSX(`jsx_getBinContent("${NOM_BIN_PLANTILLA}")`);
            let binFiles = [];
            try { binFiles = JSON.parse(rawBin); } catch(e) { binFiles = []; }
        
            // 2. Llegim el NAS
            const nasFiles = utils.readFolder(cfg.rutas.conductors);
            const validNasFiles = nasFiles.filter(name => 
                name.indexOf("Conduct_") === 0 && name.indexOf(".mov") !== -1
            );
        
            // 3. Comparem: Només importem el que NO estigui al Bin
            const missing = validNasFiles.filter(f => {
                // Mirem si el nom del fitxer del NAS ja existeix a la llista del Bin
                return !binFiles.includes(f);
            });
        
            if (missing.length > 0) {
                log(`📥 Important ${missing.length} conductors nous.`);
                const paths = missing.map(name => cfg.rutas.conductors + name);
                await utils.importList(paths, NOM_BIN_PLANTILLA);
            } else {
                log("✅ Llibreria de conductors al dia. No cal importar res.");
            }
        },

        /**
         * @private
         * Generació de l'objecte Context basat en la Config i la UI.
         */
        _setupContext: async function () {
            const config = FASTPASS_UI.Config.get();
            
            // 1. Demanem al Context que llegeixi la UI (programa, bloc, etc.)
            const currentStatus = FASTPASS_UI.Core.Context.checkContext();
            
            // 2. Extraiem les dades del programa triat
            const idProg = document.getElementById('programa').value;
            const progData = config.mapeoProgramas[idProg];
            
            // 3. Preparem la data (Neta de caràcters estranys)
            const dateStr = getUtils().getFormattedDate();
            const dateDir = dateStr.replace(/["\s]/g, "").trim();
        
            // 📍 CRÍTIC: Retornem 'programa' per a que el Scanner sàpiga on buscar
            return { 
                config, 
                progData, 
                programa: idProg, // Clau per al Scanner (ex: "TNCOMARQUES")
                bloque: document.getElementById('bloc').value, 
                dateDir 
            };
        }
    };

    window.FASTPASS_UI = FASTPASS_UI;
})();