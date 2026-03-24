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
            log("🚀 [FLOW-NEW]");
        
            // 1. SEGURETAT: Verificació (Això està perfecte)
            const logicScanner = scanner();
            const logicProject = projectLogic();
            if (!logicScanner || !logicProject) throw new Error("Mòduls de lògica no carregats");
        
            // 2. Setup Context (OJO: Forcem que llegeixi la UI actual)
            // Ens assegurem que el Context sap que hem triat "TN COMARQUES" ara mateix
            const ctx = await this._setupContext(); 
            const cfg = ctx.config;
        
            // 3. Descobriment (Amb el ctx ja refrescat)
            log(`🔍 Escanejant servidor per a ${ctx.programa}...`);
            const wottData = await logicScanner.findTemaData(ctx);
            const media = await logicScanner.findMediaAssets(ctx);
        
            if (!wottData || !wottData.list || wottData.list.length === 0) {
                throw new Error("No s'han trobat rètols (.wott) recents per a aquest programa.");
            }
        
            // 4. Definició de rutes
            const sanitizedTema = getUtils().sanitizeName(ctx.progData.tema || "TEMA_PENDENT");
            
            // 📞 DEMANAR NOMS DIFERENCIATS
            const projectName = cfg.naming.getProjectName(ctx, sanitizedTema);
            const seqName     = cfg.naming.getSequenceName(ctx, sanitizedTema);


            // Definició de ruta final (Projecte)
            const fileName = `Pruebas_${projectName}.prproj`;
            const destPath = cfg.rutas.destinoBase + ctx.progData.directorio + "\\" + fileName;

            // Pavimentar el camí al NAS (JS)
            const parentFolder = destPath.substring(0, destPath.lastIndexOf("\\"));
            log(`🛠️ Verificant ruta al NAS: ${parentFolder}`);
            getUtils().ensureFolders(parentFolder)

            // 5. Creació física
            log("🏗️ Creant projecte a partir de plantilla...");
            const projectResult = await logicProject.createFromTemplate(cfg.rutas.plantilla_net, destPath, seqName);

            if (projectResult !== "OK" && projectResult.success !== true) {
                // Si projectResult es un string de error, lo mostramos. Si no, ponemos un genérico.
                const msg = (typeof projectResult === "string") ? projectResult : "Fallo en saveAs (Check NAS Permissions)";
                getUtils().log("🔴 Workflow ATURAT: " + projectResult, "ERROR");
                getUtils().status("Error: " + msg, "error");
                return;
            }

            // Només arribem aquí si el projecte s'ha guardat bé al NAS
            await getUtils().delay(1000);
            await this._createLock(destPath);
            await this._performSync(ctx, wottData, media);
        
            // 8. Muntatge base (📍 AQUÍ CORREGIM L'ERROR DE RUTA)
            if (media.mp4 && media.mp4.name) {
                const T_MP4 = cfg.tracks.video.mp4; 
                // Usem el NOM de l'arxiu per buscar-lo al Bin, no el path de xarxa
                const mp4Name = media.mp4.name; 
                const mp4Escaped = getUtils().escape(mp4Name);
                
                log(`🎬 Col·locant clip a línia de temps: ${mp4Name}`);
                await callJSX(`jsx_overwriteClip('${mp4Escaped}', ${T_MP4}, 0.0, 'video')`);
            }
        
            // Finalització (Això està perfecte)
            await callJSX('jsx_setCTI_Safe(0)');
            log("✅ Projecte creat i llest.");
        },

        /**
         * FLOW: OBRIR PROJECTE EXISTENT
         */
        _runLoad: async function () {
            log("🚀 [FLOW-LOAD]");
            const ctx = await this._setupContext();
            const cfg = ctx.config;
        
            const wottData = await scanner().findTemaData(ctx);
            const destPath = cfg.rutas.destinoBase + ctx.progData.directorio + "\\" +
                `Pruebas_${ctx.progData.archivo}_${ctx.dateDir}_${ctx.bloque}_${getUtils().sanitizeName(wottData.tema)}.prproj`;

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
         * FLOW: ACTUALITZAR TEMA
         */
        _runUpdate: async function () {
            log("🚀 [FLOW-UPDATE]");
            const ctx = await this._setupContext();
            const cfg = ctx.config;
        
            const wottData = await scanner().findTemaData(ctx);
            const media = await scanner().findMediaAssets(ctx);
            const seqName = `${ctx.progData.archivo}_${wottData.tema}`;

            await this._performSync(ctx, wottData, media);

            if (media.mp4) {
                const T_MP4 = cfg.tracks.video.mp4;
                await callJSX(`jsx_openSequence('${seqName}')`);
                await callJSX(`jsx_overwriteClip('${getUtils().escape(media.mp4.name)}', ${T_MP4}, 0.0, 'video')`);
            }

            await callJSX("app.project.save()");
        },

        /**
         * @private
         * Ingesta específica de la noticia (MP4, SRT i Rètols).
         */
        _performSync: async function (ctx, wottData, media) {
            const utils = getUtils();
            log("🎞️ [SYNC] Iniciant ingesta a ROOT...");
        
            // 1. Recopilamos TODAS las rutas en una sola lista para una sola llamada (más rápido)
            let allPaths = [];
            
            // Añadimos Chyrons
            if (wottData.list && wottData.list.length > 0) {
                wottData.list.forEach(w => allPaths.push(utils.escape(w.path)));
            }
            
            // Añadimos Media
            if (media?.mp4?.path) allPaths.push(utils.escape(media.mp4.path));
            if (media?.srt?.path) allPaths.push(utils.escape(media.srt.path));
        
            if (allPaths.length > 0) {
                // IMPORTANTE: Importamos todo a "root"
                log(`📥 Ingestant ${allPaths.length} fitxers directament a root...`);
                await utils.importList(allPaths, "root");
                
                // 2. PAUSA DE SEGURIDAD (Para que Premiere registre los clips)
                await utils.delay(1000);
        
                // 3. ORGANIZACIÓN: Movemos los Chyrons a su Bin
                if (wottData.list && wottData.list.length > 0) {
                    log("📁 Organitzant Chyrons al seu Bin...");
                    // Aseguramos que el Bin existe primero
                    await utils.callJSX(`jsx_createBin('CHYRONS')`);
                    
                    // Movemos cada clip por su nombre
                    for (let w of wottData.list) {
                        // El nombre en Premiere suele ser el nombre del archivo sin ruta
                        await utils.callJSX(`FASTPASS.Project.moveItem('${w.name}', 'CHYRONS')`);
                    }
                    log("✅ Organització completada.");
                }
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