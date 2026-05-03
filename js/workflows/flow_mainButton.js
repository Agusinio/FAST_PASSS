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
                    case 'LOAD': await this._runLoad(data); break;
                    case 'GO': await this._runGo(data); break;
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

                // ─── NOU: Inicialitzar Manifest de Sessió ──────────────────────────
                // Registrem l'inici del procés per tenir una font de veritat persistent
                const manifest = await FASTPASS_UI.SessionManifest.save(ctx, {
                    program: {
                        projectFile: fileName,
                        projectFolder: folderPath
                    }
                });

                // ─── NOU: Intentar carregar dades de l'escaleta JSON ──────────────────────
                // Usa el sistema de 3 tiers (calcPrecisionTrimBounds) per obtenir
                // els TCs reals basats en items emesos, no en blocs amb handles.
                let cleanFeedData = null;
                try {
                    const reader = window.EscaletaReader || window.FASTPASS_UI.EscaletaReader;
                    if (reader) {
                        // Sincronitzar handles des de config
                        reader.HANDLE_SECS = ctx.config.handles || 20;

                        const jsonMeta = await reader.findLatest(ctx.progData.archivo);
                        if (jsonMeta) {
                            const jsonData = await reader.load(jsonMeta.path);
                            if (jsonData) {
                                // ─── SISTEMA DE 3 TIERS: Precisió de trim ─────────────────
                                const bounds = reader.calcPrecisionTrimBounds(
                                    jsonData,
                                    ctx.bloque,
                                    jsonData.cleanFeed.mediaStart,
                                    jsonData.cleanFeed.mediaStop,
                                    ctx.config
                                );

                                if (bounds) {
                                    const lines = reader.getLinesForBlock(jsonData, ctx.bloque);
                                    // Calcular el "punt dulce" (sense handles): temps OnAir real relatiu al MP4
                                    // bounds.inPoint/outPoint inclouen handles (inHandles=1s, outHandles=3s).
                                    // bounds.tcRef.realStart/realEnd són els temps OnAir absoluts.
                                    // Restem msStart per obtindre valors relatius al MP4.
                                    const msStartSec = bounds.tcRef.mediaStart;
                                    const sweetIn  = (bounds.tcRef.realStart != null) ? bounds.tcRef.realStart - msStartSec : bounds.inPoint;
                                    const sweetOut = (bounds.tcRef.realEnd   != null) ? bounds.tcRef.realEnd   - msStartSec : bounds.outPoint;
                                    cleanFeedData = {
                                        mediaPath: jsonData.cleanFeed.mediaPath,
                                        inPoint: bounds.inPoint,
                                        outPoint: bounds.outPoint,
                                        sweetInPoint: sweetIn,
                                        sweetOutPoint: sweetOut,
                                        duration: bounds.duration,
                                        escaletaLines: lines,
                                        precisionTiers: {
                                            in: bounds.tierIn,
                                            out: bounds.tierOut
                                        }
                                    };

                                    // Desar tota la info base al manifest
                                    await FASTPASS_UI.SessionManifest.save(ctx, {
                                        program: { escaletaFile: jsonMeta.filename },
                                        cleanFeed: jsonData.cleanFeed,
                                        blockBounds: bounds,  // inclou inPoint, outPoint, tiers...
                                        tcRef: bounds.tcRef,  // { mediaStart, inPoint, realStart, realEnd, tierIn, tierOut, clipStart:null, offset:null }
                                        escaletaItems: lines.map(l => ({
                                            sequencia: l.sequencia,
                                            num: l.num,
                                            titol: l.titol,
                                            teVideo: l.teVideo,
                                            horaEntradaOnAir: l.horaEntradaOnAir,
                                            duradaOnAir: l.duradaOnAir,
                                            durada: l.durada
                                        })),
                                        phases: { boundsCalculated: true }
                                    });

                                    log(`📡 [PrecisionTrim] cleanFeed: in=${bounds.inPoint.toFixed(1)}s out=${bounds.outPoint.toFixed(1)}s (tierIn=${bounds.tierIn}, tierOut=${bounds.tierOut})`);
                                } else {
                                    // Fallback al sistema anterior si el nou no funciona
                                    log(`⚠️ calcPrecisionTrimBounds ha retornat null. Usant calcOnAirBounds com a fallback.`);
                                    const fallbackBounds = reader.calcOnAirBounds(
                                        jsonData,
                                        ctx.bloque,
                                        jsonData.cleanFeed.mediaStart,
                                        jsonData.cleanFeed.mediaStop,
                                        ctx.config
                                    );
                                    if (fallbackBounds) {
                                        const lines = reader.getLinesForBlock(jsonData, ctx.bloque);
                                        cleanFeedData = {
                                            mediaPath: jsonData.cleanFeed.mediaPath,
                                            inPoint: fallbackBounds.inPoint,
                                            outPoint: fallbackBounds.outPoint,
                                            duration: fallbackBounds.duration,
                                            escaletaLines: lines
                                        };
                                        await FASTPASS_UI.SessionManifest.save(ctx, {
                                            program: { escaletaFile: jsonMeta.filename },
                                            cleanFeed: jsonData.cleanFeed,
                                            blockBounds: fallbackBounds,
                                            tcRef: fallbackBounds.tcRef,
                                            escaletaItems: lines.map(l => ({
                                                sequencia: l.sequencia,
                                                num: l.num,
                                                titol: l.titol,
                                                teVideo: l.teVideo,
                                                horaEntradaOnAir: l.horaEntradaOnAir,
                                                duradaOnAir: l.duradaOnAir,
                                                durada: l.durada
                                            })),
                                            phases: { boundsCalculated: true }
                                        });
                                        log(`📡 [Fallback] cleanFeed: in=${fallbackBounds.inPoint.toFixed(1)}s out=${fallbackBounds.outPoint.toFixed(1)}s`);
                                    }
                                }
                            }
                        } else {
                            log(`⚠️ Cap JSON d'escaleta per a ${ctx.progData.archivo}. Usant mp4 estàndard.`);
                        }
                    }
                } catch (eReader) {
                    log(`⚠️ EscaletaReader: ${eReader.message}. Continuant sense dades OnAir.`);
                }
                // ─────────────────────────────────────────────────────────────────────────

                log(`🏗️ Generant projecte: ${fileName}`);

                // 1. CREACIÓ FÍSICA (Crea seqüencia i inserta MP4 amb els bounds calculats)
                await FASTPASS_UI.Logic.Project.create(ctx, assets.wotts, assets.media, paths, assets.portada, shortProg, cleanFeedData);

                // 2. FINALITZAR tcRef (Obtenir clipStart real post-inserció)
                if (cleanFeedData) {
                    log("📐 Finalitzant tcRef post-inserció...");
                    
                    // Llegir la posició real del clip al timeline via Clips.get()
                    // Usem start.seconds (posició al timeline), NO inPoint.seconds (relatiu al source)
                    const clipDataRaw = await callJSX(`Clips.get(1, 0, 'video')`);
                    let clipStart = NaN;
                    try {
                        const clipData = JSON.parse(clipDataRaw);
                        clipStart = clipData.start;
                        log(`🔍 [LOG] Clips.get(1,0): start=${clipData.start}, inPoint=${clipData.inPoint}, end=${clipData.end}`);
                    } catch(e) {
                        log(`⚠️ Error parsejant clipData: ${clipDataRaw}`);
                    }
                    
                    if (!isNaN(clipStart)) {
                        const inPoint = cleanFeedData.inPoint;
                        const offset = clipStart - inPoint;
                        
                        log(`🔍 [LOG] CÀLCUL tcRef: clipStart(start al timeline)=${clipStart.toFixed(4)}s - inPoint(source MP4)=${inPoint.toFixed(4)}s = offset=${offset.toFixed(4)}s`);
                        
                        // Actualitzar manifest amb la posició real
                        await FASTPASS_UI.SessionManifest.save(ctx, {
                            tcRef: {
                                clipStart: clipStart,
                                offset: offset
                            },
                            phases: {
                                mp4Imported: true,
                                tcRefEstablished: true
                            }
                        });
                        log(`📐 tcRef establert: offset=${offset.toFixed(3)}s (clipStart=${clipStart.toFixed(3)}s)`);
                    } else {
                        log("⚠️ No es pot llegir clipStart de V1. tcRef quedarà incomplet.");
                    }
                }

                // Registrar como último proyecto abierto
                if (window.FASTPASS_UI && window.FASTPASS_UI.State) {
                    window.FASTPASS_UI.State.lastOpenedProjectName = fileName;
                }

                log("✅ Workflow NOU completat amb èxit.");
                // Actualizar contexto
                if (FASTPASS_UI.Core && FASTPASS_UI.Core.Context) {
                    await FASTPASS_UI.Core.Context.checkContext();
                }
        
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
                    // Actualizar contexto para que el botón refleje el estado actual
                    if (FASTPASS_UI.Core && FASTPASS_UI.Core.Context) {
                        await FASTPASS_UI.Core.Context.checkContext();
                    }
                }
            } else {
                // INGESTA I SYNC ESTÀNDARD
                await this._completeSyncUI(ctx, assets);
                await callJSX("Project.save()");
                log("✅ Actualització completada.");
                // Actualizar contexto para que el botón refleje el estado actual
                if (FASTPASS_UI.Core && FASTPASS_UI.Core.Context) {
                    await FASTPASS_UI.Core.Context.checkContext();
                }
            }
        },

        _runGo: async function (data) {
            const projName = data.name;
            log(`🚀 Canviant focus a: ${projName}...`);
            // Intentar cambiar el foco via Context.set
            let setResult = await callJSX(`Context.set('${getUtils().escape(projName)}')`);
            
            // Construir ruta completa del proyecto
            const folderPath = data.config.rutas.destinoBase + data.progData.directorio + "/" + data.dateDir;
            const fullPath = (folderPath + "/" + projName).replace(/\\/g, "/");
            
            // Si Context.set falla, intentar con Project.open
            if (setResult !== "OK") {
                log(`⚠️ Context.set falló, intentando Project.open...`);
                const openResult = await callJSX(`FASTPASS.Project.open('${getUtils().escape(fullPath)}')`);
                if (openResult !== "OK") {
                    log(`❌ No se pudo cambiar el foco al proyecto.`);
                    return;
                }
            } else {
                // Aunque Context.set tuvo éxito, forzar apertura para asegurar foco visual
                const openResult = await callJSX(`FASTPASS.Project.open('${getUtils().escape(fullPath)}')`);
            }
            
            // Sincronizar assets (igual que antes)
            const ctx = await this._setupContext();
            const assets = await this._fullScan(ctx);
            await this._completeSyncUI(ctx, assets);
            
            if (FASTPASS_UI.Core && FASTPASS_UI.Core.Context) {
                await FASTPASS_UI.Core.Context.checkContext();
            }
        },

        _runLoad: async function (data) {
            log("🚀 [FLOW-LOAD]");
            // Usar el proyecto existente pasado en data
            const projName = data.name; // Nombre completo del archivo .prproj
            const folderPath = data.config.rutas.destinoBase + data.progData.directorio + "/" + data.dateDir;
            const destPath = (folderPath + "/" + projName).replace(/\\/g, "/");
            log(`📂 Abriendo proyecto existente: ${destPath}`);

            const forceOverride = data.forceOverride || false;
            
            // Verificar lock solo si no estamos forzando
            if (!forceOverride) {
                const lockPath = destPath + ".lock";
                // Lock debug comentado para reducir ruido
                // log(`🔍 [FLOW-LOAD] Verificando lock: ${lockPath}`);
                const lockExists = await callJSX(`IO.exists('${getUtils().escape(lockPath)}')`);
                // log(`🔍 [FLOW-LOAD] lockExists = ${lockExists}`);
                let lockOwner = null;
                if (lockExists === "true") {
                    lockOwner = await callJSX(`IO.readTxt('${getUtils().escape(lockPath)}')`);
                    lockOwner = lockOwner.trim();
                    // log(`🔍 [FLOW-LOAD] lockOwner = "${lockOwner}"`);
                }
                const currentUser = data.config.autor;
                // log(`🔍 [FLOW-LOAD] currentUser = "${currentUser}"`);
                if (lockOwner && lockOwner !== currentUser) {
                    log(`⚠️ [FLOW-LOAD] Lock pertenece a otro usuario. Mostrando alerta.`);
                    // Mostrar alerta
                    alert(`${lockOwner} ya está editando ${data.progData.archivo} ${data.bloque}.`);
                    // Cambiar botón a LOCKED
                    if (FASTPASS_UI.Core && FASTPASS_UI.Core.Context) {
                        // Lock debug comentado para reducir ruido
                        // log(`🔍 [FLOW-LOAD] Actualizando botón a LOCKED.`);
                        FASTPASS_UI.Core.Context.updateButton('LOCKED', { ...data, lockOwner });
                    }
                    return;
                } else {
                    // Lock debug comentado para reducir ruido
                    // log(`🔍 [FLOW-LOAD] Lock propio o inexistente, continuando.`);
                }
            }
            
            // Bloquear el proyecto (lock) - sobrescribirá si forceOverride es true
            await FASTPASS_UI.Logic.Project.lock(destPath);
            
            // Abrir proyecto
            const openResult = await callJSX(`FASTPASS.Project.open('${getUtils().escape(destPath)}')`);
            log(`🔍 [FLOW-LOAD] Resultado de Project.open: ${openResult}`);
            
            if (openResult !== "OK") {
                log(`❌ [FLOW-LOAD] No se pudo abrir el proyecto.`);
                return;
            }
            
            // Sincronizar assets (importar solo los faltantes)
            const ctx = await this._setupContext();
            const assets = await this._fullScan(ctx);
            await this._completeSyncUI(ctx, assets);
            
            // Registrar como último proyecto abierto
            if (window.FASTPASS_UI && window.FASTPASS_UI.State) {
                window.FASTPASS_UI.State.lastOpenedProjectName = projName;
            }
            
            log("✅ Projecte obert.");
            // Actualizar contexto para que el botón cambie a UPDATE si el proyecto está abierto
            if (FASTPASS_UI.Core && FASTPASS_UI.Core.Context) {
                await FASTPASS_UI.Core.Context.checkContext();
            }
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
            // Generar estructura de bloques a partir de los Wotts
            if (wotts.list && wotts.list.length > 0) {
                window.FASTPASS_UI.State.structure = window.Parse.files(wotts.list, ctx.progData.wott, ctx.bloque);
                window.FASTPASS_UI.State.pieceIndex = 0;
                log(`🏗️ Estructura generada: ${window.FASTPASS_UI.State.structure.length} blocs`);
            } else {
                window.FASTPASS_UI.State.structure = [];
                window.FASTPASS_UI.State.pieceIndex = 0;
                log("⚠️ No hi ha Wotts per generar estructura");
            }
            
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
            // NOTA: Si _runNew ja ha col·locat el cleanFeed MP4, V1 no estarà buida
            // i aquest bloc NO s'executarà → protegit contra doble inserció.
            if (assets.media && assets.media.mp4) {
                const v1Count = await callJSX("Clips.count(1, 'video')");
                if (parseInt(v1Count) === 0) {
                    log("🎞️ V1 buida. Autocol·locant vídeo estàndard...");
                    const escapedMediaName = encodeURIComponent(assets.media.mp4.name);
                    await callJSX(`Clips.insert('${escapedMediaName}', 1, 0)`);
                } else {
                    log("✅ V1 ja té contingut. No s'autocol·loca MP4.");
                }
            }


            // 3. Focus i Targeting
            await callJSX("Tracks.target(1, true, 'video')");
            await callJSX("Tracks.target(1, true, 'audio')");
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