/**
 * ============================================================================
 * LOGIC: PROJECT (Orquestació de Sesió)
 * ============================================================================
 */

(function() {
    var FASTPASS_UI = window.FASTPASS_UI || {};
    FASTPASS_UI.Logic = FASTPASS_UI.Logic || {};

    const utils = window.FASTPASS_UI.Utils;
    const callJSX = (s) => utils.callJSX(s);

    FASTPASS_UI.Logic.Project = {
        
        /**
         * activate: Orquestra l'activació d'un tema (Projecte + Seqüència).
         */
        activate: async function(projectPath, sequenceWildcard) {
            utils.log(`📁 Activant tema: ${projectPath}`);
            
            // 1. Obertura física literal
            const res = await callJSX(`$.global.Project.open('${projectPath.replace(/\\/g, '/')}')`);
            if (res !== "OK") return { success: false, error: res };
            
            await utils.delay(1200);

            // 2. Cerca literal d'items
            const itemsRaw = await callJSX(`$.global.Project.items('')`);
            const items = JSON.parse(itemsRaw || "[]");
            
            const targetSeq = items.find(i => i.type === 3 && i.name.indexOf(sequenceWildcard) !== -1);
            
            if (targetSeq) {
                utils.log(`🎯 Seqüència trobada: ${targetSeq.name}. Obrint...`);
                await callJSX(`$.global.Project.openSeq('${targetSeq.name}')`);
                return { success: true, sequence: targetSeq.name };
            } else {
                utils.log(`⚠️ Seqüència no trobada amb prefix: ${sequenceWildcard}`, "WARN");
                return { success: false, error: "SEQUENCE_NOT_FOUND" };
            }
        },

        /**
        * create: Crea un nou tema a partir d'una plantilla (Lògica verificada v2.6.0)
        * @param {Object}      ctx
        * @param {Object}      wottData
        * @param {Object}      media
        * @param {Object}      paths
        * @param {Array}       portadaList
        * @param {string}      shortProg
        * @param {Object|null} cleanFeedData  - { mediaPath, inPoint, outPoint, escaletaLines[] } | null
        */
        create: async function(ctx, wottData, media, paths, portadaList, shortProg, cleanFeedData) {
            const { plantillaPath, fullDestPath, folderPath, sanitizedTheme } = paths;
            const config = ctx.config;

            // 1. ABRIR PLANTILLA
            utils.log(`📂 Obrint plantilla: ${plantillaPath}`);
            const jsxCommand = `FASTPASS.Project.open('${plantillaPath.replace(/\\/g, "/")}')`;
            utils.log(`🔍 JSX command: ${jsxCommand}`);
            const openResult = await callJSX(jsxCommand);
            utils.log(`📤 Resultado de Project.open: ${openResult}`);
            
            // 2. INGESTA GENERAL (Wotts, Media i Portada)
            await this.ingestAssets(ctx, wottData, media, portadaList);

            // 3. CLONAR I RENOMBRAR SEQÜÈNCIA
            const plantillaSeq = "OTT VERTICAL"; 
            utils.log(`👥 Buscant i clonant: ${plantillaSeq}`);
            const resClone = await callJSX(`FASTPASS.Project.cloneSeq('${encodeURIComponent(plantillaSeq)}')`);
            
            if (resClone && resClone.indexOf("ERR") === -1) {
                const temaNet = wottData.tema.toUpperCase();
                const finalSeqName = `${shortProg}_${ctx.bloque}_${temaNet}`;
                
                utils.log(`📝 Seqüència clonada [${resClone}]. Renombrant a: ${finalSeqName}`);
                const safeResClone = encodeURIComponent(resClone).replace(/'/g, "\\'");
                const safeFinalSeqName = encodeURIComponent(finalSeqName).replace(/'/g, "\\'");
                await callJSX(`FASTPASS.Project.rename('${safeResClone}', '${safeFinalSeqName}')`);
            
                // 4. INSERTAR VÍDEO AL TIMELINE
                if (cleanFeedData && cleanFeedData.mediaPath) {
                    // ─── MODE ESCALETA: importar el cleanFeed MP4 i col·locar-lo amb offset ──
                    utils.log(`📡 [NOU] Usant cleanFeed MP4: ${cleanFeedData.mediaPath}`);

                    // 4a. Importar el cleanFeed (si no està ja importat)
                    const cfPathForward = cleanFeedData.mediaPath.replace(/\\/g, "/");
                    const cfName = cfPathForward.split('/').pop();
                    const existingItems = await callJSX("FASTPASS.Project.items('')");
                    let items = [];
                    try { items = JSON.parse(existingItems || "[]"); } catch(e) { items = []; }
                    const alreadyImported = items.some(i => i.name === cfName);

                    if (!alreadyImported) {
                        utils.log(`📥 Important cleanFeed: ${cfName}`);
                        await utils.importList([cfPathForward], "root");
                        await utils.delay(500);
                    } else {
                        utils.log(`✅ cleanFeed ja importat: ${cfName}`);
                    }

                    // 4b. Insertar al timeline amb inPoint / outPoint via insertWithBounds
                    const escapedCfName = encodeURIComponent(cfName);
                    const inPt  = cleanFeedData.inPoint.toFixed(4);
                    const outPt = cleanFeedData.outPoint.toFixed(4);
                    utils.log(`🎬 Col·locant cleanFeed a V1: inPoint=${inPt}s outPoint=${outPt}s`);
                    const insertRes = await callJSX(
                        `Clips.insertWithBounds('${escapedCfName}', 1, 0, ${inPt}, ${outPt}, 'video')`
                    );
                    if (insertRes && insertRes.indexOf('ERR') !== -1) {
                        utils.log(`⚠️ Error insertant cleanFeed: ${insertRes}. Intent fallback amb insert estàndard.`);
                        await callJSX(`FASTPASS.Clips.insert('${escapedCfName}', 1, 0)`);
                    }


                     if (cleanFeedData.escaletaLines && cleanFeedData.escaletaLines.length > 0) {
                        utils.log(`📍 Col·locant ${cleanFeedData.escaletaLines.length} marcadors d'escaleta...`);
                        const reader = window.EscaletaReader || window.FASTPASS_UI.EscaletaReader;
                        const tcToSec = reader ? (tc) => reader.tcToSeconds(tc) : (tc) => { const p = tc.split(':'); return parseInt(p[0])*3600+parseInt(p[1])*60+parseInt(p[2]||0); };
                        const handleSecs = reader ? reader.HANDLE_SECS : 20;
                        // Hora real d'inici del bloc (per calcular temps relatius)
                        const blockInSec = tcToSec(cleanFeedData.blockIn);

                        for (const line of cleanFeedData.escaletaLines) {
                            const horaRef = line.horaEntradaOnAir || line.horaEntradaPrevista;
                            if (!horaRef || horaRef === "00:00:00") continue;

                            const lineSec = tcToSec(horaRef);

                            // Posició del marcador dins del clip (Sense handles per petició de l'usuari)
                            const tLine = (lineSec - blockInSec);
                            const safeT = Math.max(0, tLine).toFixed(2);

                            const num   = line.num  || '';
                            const titol = (line.titol || '').replace(/'/g, "\\'").substring(0, 60);
                            const comment = `${num ? num + ' - ' : ''}${titol}`.trim();
                            if (comment) {
                                await callJSX(`Markers.set(${safeT}, '${comment}')`);
                            }
                        }
                        utils.log(`✅ Marcadors d'escaleta col·locats.`);
                    }

                } else if (media && media.mp4) {
                    // ─── MODE ESTÀNDARD (fallback sense escaleta) ─────────────────────────
                    utils.log(`🎬 [FALLBACK] Col·locant MP4 estàndard a V1...`);
                    const escapedMediaName = encodeURIComponent(media.mp4.name);
                    await callJSX(`FASTPASS.Clips.insert('${escapedMediaName}', 1, 0)`);
                }
            }

            // 5. ASEGURAR CARPETES I GUARDAR (SAVE AS)
            await utils.ensureFolders(folderPath);
            const escapedPath = fullDestPath.replace(/\\/g, "/").replace(/'/g, "\\'");

            utils.log(`🏗️ Guardant projecte final: ${escapedPath}`);
            let saveRes = await callJSX(`FASTPASS.Project.saveAs('${escapedPath}')`);
            
            if (saveRes && saveRes.indexOf("ERR") !== -1) {
                await utils.delay(2000);
                saveRes = await callJSX(`FASTPASS.Project.saveAs('${escapedPath}')`);
            }

            if (saveRes && saveRes.indexOf("ERR") !== -1) throw new Error("Premiere no ha permès guardar: " + saveRes);

            // 6. BLOQUEIG (LOCK)
            await this.lock(fullDestPath);
            
            return { success: true, path: fullDestPath };
        },


        /**
         * ingestAssets: Centralitza l'escaneig i ingesta de materials (Wotts, MP4, SRT, Portada).
         */
        ingestAssets: async function(ctx, wottData, media, portadas) { // <--- Nombre unificado
            utils.log("🎞️ [SYNC] Iniciant ingesta segmentada...");

            // Obtener archivos ya presentes en el proyecto
            const existing = await this._getExistingAssets();
            utils.log(`🔍 Assets existentes: ${existing.wotts.length} wotts, ${existing.media.length} media, ${existing.portadas.length} portadas`);

            // A. RÈTOLS (Wotts) -> Bin CHY
            if (wottData && wottData.list && wottData.list.length > 0) {
                // Filtrar wotts que aún no están en el proyecto
                const newWotts = wottData.list.filter(w => !existing.wotts.includes(w.name));
                if (newWotts.length === 0) {
                    utils.log("✅ Todos los wotts ya están en el proyecto. Se omite importación.");
                } else {
                    utils.log(`📥 Ingestant ${newWotts.length} rètols nuevos de ${wottData.list.length} detectados...`);

                    // 1. Primer creem el Bin (Això assegura que el destí existeix)
                    await callJSX(`FASTPASS.Project.bin('${encodeURIComponent('CHY')}')`);
                    
                    // 2. Importem la llista al Root
                    const safeWotts = newWotts.map(f => f.path.replace(/\\/g, "/"));
                    await utils.importList(safeWotts, "root");
                    
                    // 3. Parem un segon per donar temps a Premiere a indexar (Opcional però segur)
                    await utils.delay(200);
                
                    // 4. Movem TOTS els fitxers de la llista del Scanner
                    for (const wott of newWotts) {
                        const escapedName = encodeURIComponent(wott.name);
                        const safeName = escapedName.replace(/'/g, "\\'");
                        
                        // Intento 1: Por nombre exacto
                        let moveRes = await callJSX(`FASTPASS.Project.move('${safeName}', 'CHY')`);
                        
                        // Intento 2: Si falla, extraemos el ID (ej: 336346) y movemos por ID
                        if (moveRes !== "OK") {
                            const idMatch = wott.name.match(/[0-9]{6}/);
                            if (idMatch) {
                                const wottID = idMatch[0];
                                await callJSX(`FASTPASS.Project.moveByID('${wottID}', 'CHY')`);
                            }
                        }
                    }
                }
            }
        
            // B. MEDIA ASSETS (MP4 / SRT) -> Root
            const mediaList = [];
            if (media?.mp4?.path && !existing.media.includes(media.mp4.name)) {
                mediaList.push(media.mp4.path.replace(/\\/g, "/"));
            }
            if (media?.srt?.path && !existing.media.includes(media.srt.name)) {
                mediaList.push(media.srt.path.replace(/\\/g, "/"));
            }
        
            if (mediaList.length > 0) {
                utils.log(`📥 Ingestant assets media al ROOT...`);
                await utils.importList(mediaList, "root");
            } else if (media?.mp4 || media?.srt) {
                utils.log("✅ Los assets de media ya están en el proyecto. Se omite importación.");
            }
        
            // C. PORTADES (Múltiples PNGs) -> Bin PORTADES
            if (portadas && portadas.length > 0) {
                // Filtrar portadas que no están en el proyecto
                const newPortadas = portadas.filter(p => !existing.portadas.includes(p.name));
                if (newPortadas.length === 0) {
                    utils.log("✅ Todas las portadas ya están en el proyecto. Se omite importación.");
                } else {
                    utils.log(`🖼️ Ingestant ${newPortadas.length} portades nuevas de ${portadas.length} detectades...`);
                    
                    // 1. Crear el Bin PORTADES
                    await callJSX(`FASTPASS.Project.bin('${encodeURIComponent('PORTADES')}')`);
            
                    // 2. Importar todas al Root primero
                    const safePortadas = newPortadas.map(p => p.path.replace(/\\/g, "/"));
                    await utils.importList(safePortadas, "root");
            
                    // 3. Moverlas una a una al Bin PORTADES
                    for (const p of newPortadas) {
                        const escapedName = encodeURIComponent(p.name);
                        const safeName = escapedName.replace(/'/g, "\\'");
                        const safeBinName = encodeURIComponent('PORTADES').replace(/'/g, "\\'");
                        await callJSX(`FASTPASS.Project.move('${safeName}', '${safeBinName}')`);
                    }
                }
            }
        },

        /**
         * _getExistingAssets: Obtiene los nombres de archivos ya presentes en los bins del proyecto.
         * Retorna un objeto { wotts: [...], media: [...], portadas: [...] }.
         */
        _getExistingAssets: async function() {
            try {
                // Obtener items del bin CHY
                const chyItemsRaw = await callJSX("FASTPASS.Project.items('CHY')");
                const chyItems = JSON.parse(chyItemsRaw || "[]");
                const wotts = chyItems.map(item => item.name);

                // Obtener items del bin PORTADES
                const portadasItemsRaw = await callJSX("FASTPASS.Project.items('PORTADES')");
                const portadasItems = JSON.parse(portadasItemsRaw || "[]");
                const portadas = portadasItems.map(item => item.name);

                // Media (MP4/SRT) están en root; obtener todos los items del root
                const rootItemsRaw = await callJSX("FASTPASS.Project.items('')");
                const rootItems = JSON.parse(rootItemsRaw || "[]");
                const media = rootItems.map(item => item.name);

                return { wotts, media, portadas };
            } catch (e) {
                utils.log("⚠️ Error obteniendo assets existentes: " + e.message, "WARN");
                return { wotts: [], media: [], portadas: [] };
            }
        },

        /**
         * lock: Crea el fitxer .lock per marcar la propietat del projecte.
         */
        lock: async function (projPath) {
            try {
                const lockPath = projPath + ".lock";
                const user = window.FASTPASS_UI.Config.get().autor;
                const safeLockPath = lockPath.replace(/\\/g, "/").replace(/'/g, "\\'");
                const safeUser = String(user).replace(/'/g, "\\'");
                utils.log(`🔒 Escrivint bloqueig per a ${user}...`);
                const lockScript = `IO.writeTxt('${safeLockPath}', '${safeUser}')`;
                utils.log(`🔍 JSX lock script: ${lockScript}`);
                await callJSX(lockScript);
                utils.log("✅ Lock escrit correctament.");
            } catch (e) {
                utils.log("Error creant .lock: " + e.message, "WARN");
            }
        },

        close: async function () {
            try {
                utils.log("🔒 Tancant projecte i eliminant lock...", "INFO");
                // 1. Obtener ruta del proyecto activo
                const projectPath = await callJSX("FASTPASS.Project.path()");
                if (!projectPath) {
                    utils.log("⚠️ No hi ha projecte obert.", "WARN");
                    return;
                }
                utils.log(`🔍 Ruta del projecte: ${projectPath}`, "INFO");
                
                // 2. Borrar archivo .lock si existe
                const lockPath = projectPath + ".lock";
                const safeLockPath = lockPath.replace(/\\/g, "/").replace(/'/g, "\\'");
                const deleteScript = `IO.remove('${safeLockPath}')`;
                utils.log(`🗑️ Eliminant lock: ${deleteScript}`, "INFO");
                const deleteResult = await callJSX(deleteScript);
                if (deleteResult !== "OK") {
                    utils.log("⚠️ No s'ha pogut eliminar el lock (potser no existeix). Resultat: " + deleteResult, "INFO");
                } else {
                    utils.log("✅ Lock eliminat.", "INFO");
                }
                
                // 3. Guardar y cerrar proyecto via JSX
                const closeResult = await callJSX("FASTPASS.Project.close()");
                utils.log(`🔍 Resultat de tancament: ${closeResult}`, "INFO");
                
                if (closeResult !== "OK") {
                    throw new Error("Error al tancar el projecte: " + closeResult);
                }
                
                utils.log("✅ Projecte tancat correctament.", "INFO");
                // Limpiar último proyecto abierto
                if (window.FASTPASS_UI && window.FASTPASS_UI.State) {
                    window.FASTPASS_UI.State.lastOpenedProjectName = "";
                }
                // 4. Actualizar contexto
                if (FASTPASS_UI.Core && FASTPASS_UI.Core.Context) {
                    await FASTPASS_UI.Core.Context.checkContext();
                }
            } catch (e) {
                utils.log("💥 Error en tancar projecte: " + e.message, "ERROR");
            }
        }
    };

    // Alias global literal
    window.Project = FASTPASS_UI.Logic.Project;

    window.FASTPASS_UI = FASTPASS_UI;
})();
