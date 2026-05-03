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
            const res = await callJSX(`$.global.Project.open('${projectPath.replace(/\\/g, '/').replace(/'/g, "\\'")}')`);
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
            const jsxCommand = `FASTPASS.Project.open('${plantillaPath.replace(/\\/g, "/").replace(/'/g, "\\'")}')`;
            utils.log(`🔍 JSX command: ${jsxCommand}`);
            const openResult = await callJSX(jsxCommand);
            utils.log(`📤 Resultado de Project.open: ${openResult}`);
            
            // 2. INGESTA GENERAL (Wotts, Media i Portada)
            // Si tenemos cleanFeed, no ingerir el MP4 estándar
            let mediaToIngest = media;
            if (cleanFeedData && cleanFeedData.mediaPath && media && media.mp4) {
                mediaToIngest = JSON.parse(JSON.stringify(media));
                delete mediaToIngest.mp4;
            }
            await this.ingestAssets(ctx, wottData, mediaToIngest, portadaList);

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
                    // ─── MODE ESCALETA: importar el cleanFeed MP4 AMB MÀRGENS ──
                    // El clip s'insereix amb insertWithBounds (inPoint/outPoint amb handles)
                    // exactament com abans. A més, es col·loquen marcadors d'IN i OUT
                    // a la seqüència per indicar visualment els punts detectats per
                    // l'algoritme calcPrecisionTrimBounds (sistema de 4 tiers IN / 3 tiers OUT).
                    utils.log(`📡 Usant cleanFeed MP4 (amb marges): ${cleanFeedData.mediaPath}`);

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

                    // 4b. Moure el CTI a 00:00 abans d'inserir el clip (per a que el cabezal
                    //     no interfereixi amb la col·locació i el zoom posterior)
                    await callJSX("Timeline.set(0)");
                    utils.log(`🎯 CTI mogut a 00:00 abans d'inserir el clip`);

                    // 4c. Insertar el MP4 a V1 amb insertWithBounds (recortat amb marges)
                    const escapedCfName = encodeURIComponent(cfName);
                    const inPt  = cleanFeedData.inPoint;
                    const outPt = cleanFeedData.outPoint;
                    const clipDuration = outPt - inPt;
                    utils.log(`🎬 Col·locant cleanFeed a V1 amb bounds: IN=${inPt.toFixed(2)}s OUT=${outPt.toFixed(2)}s (start=0) | duradaEsperada=${clipDuration.toFixed(2)}s`);
                    utils.log(`🔍 [LOG] cleanFeedData.inPoint (relatiu MP4)=${inPt.toFixed(4)}s, cleanFeedData.outPoint=${outPt.toFixed(4)}s, msStart (mediaStart)=${(cleanFeedData.tcRef?.mediaStart ?? 'N/A')}`);
                    const insertRes = await callJSX(
                        `Clips.insertWithBounds('${escapedCfName}', 1, 0, ${inPt.toFixed(4)}, ${outPt.toFixed(4)}, 'video')`
                    );
                    if (insertRes && insertRes.indexOf('ERR') !== -1) {
                        utils.log(`⚠️ Error insertant cleanFeed: ${insertRes}`);
                    }

                    // 4d. Establir punts IN/OUT de la SEQÜÈNCIA (guia visual per debug)
                    // NOTA: inPt/outPt (cleanFeedData.inPoint/outPoint) són els límits
                    // calculats per calcPrecisionTrimBounds INCLOENT els handles (marges).
                    // Aquests valors amb handles són els que es passen a insertWithBounds
                    // per a insertar el clip amb marge.
                    //
                    // Per als delimitadors IN/OUT de la seqüència necessitem els valors
                    // del "punt dulce" (sense handles), que representen l'inici i final
                    // precisos del bloc dins del senyal net. Aquests valors estan a
                    // cleanFeedData.sweetInPoint / sweetOutPoint.
                    //
                    // IMPORTANT: sweetInPoint/sweetOutPoint estan en temps source (relatius al MP4).
                    // Com que el clip s'inserta a start=0 amb insertWithBounds(sourceIn=inPt, sourceOut=outPt),
                    // cal convertir a temps de seqüència: sweetSeq = sweetSource - inPt + clipStart.
                    // Com que clipStart=0: sweetSeq = sweetSource - inPt.
                    // D'aquesta manera els delimitadors cauen dins de la durada de la seqüència.
                    const sweetSourceIn  = (cleanFeedData.sweetInPoint !== undefined)  ? cleanFeedData.sweetInPoint  : inPt;
                    const sweetSourceOut = (cleanFeedData.sweetOutPoint !== undefined) ? cleanFeedData.sweetOutPoint : outPt;
                    const sweetSeqIn  = sweetSourceIn  - inPt;  // conversió source→seq (clip start=0)
                    const sweetSeqOut = sweetSourceOut - inPt;
                    utils.log(`📍 [DEBUG] IN/OUT de seqüència (punt dulce, sense handles): sourceIN=${sweetSourceIn.toFixed(2)}s sourceOUT=${sweetSourceOut.toFixed(2)}s → seqIN=${sweetSeqIn.toFixed(2)}s seqOUT=${sweetSeqOut.toFixed(2)}s`);
                    utils.log(`📍 [DEBUG] (Valors amb handles usats per insertWithBounds: IN=${inPt.toFixed(2)}s OUT=${outPt.toFixed(2)}s)`);
                    const rangeRes = await callJSX(`Timeline.range(${sweetSeqIn.toFixed(4)}, ${sweetSeqOut.toFixed(4)})`);
                    utils.log(`🔍 Timeline.range resultat=${rangeRes}`);

                    // 4e. Fer zoom a la selecció IN/OUT per a que ocupi l'ample de la finestra
                    const zoomRes = await callJSX("Timeline.zoomToSelection()");
                    utils.log(`🔍 Zoom a selecció IN/OUT: resultat=${zoomRes}`);

                    // 4f. Col·locar marcadors d'IN i OUT a la seqüència
                    // NOTA: Estos marcadores se eliminan porque placePrecisionMarkers() ya hace Markers.clear() antes de crear los suyos.
                    // Si se mantienen aquí, generan marcadores fantasma cuando no se ejecuta placePrecisionMarkers().
                    // await callJSX(`Markers.set(${inPt.toFixed(4)}, 'IN - Inici bloc (detectat)', 'color=3')`);
                    // await callJSX(`Markers.set(${outPt.toFixed(4)}, 'OUT - Fi bloc (detectat)', 'color=3')`);
                    utils.log(`📍 Marcadors IN/OUT col·locats a la seqüència (DESACTIVAT: es delega a placePrecisionMarkers)`);

                    // Verificar el resultat
                    const clipDataRaw = await callJSX(`Clips.get(1, 0, 'video')`);
                    let clipEnd = 0;
                    try {
                        const clipData = JSON.parse(clipDataRaw);
                        const clipActualDur = clipData.end - clipData.start;
                        clipEnd = clipData.end;
                        utils.log(`📐 Clip inserit: start=${clipData.start.toFixed(2)}s end=${clipData.end.toFixed(2)}s inPoint=${clipData.inPoint.toFixed(2)}s outPoint=${clipData.outPoint.toFixed(2)}s durActual=${clipActualDur.toFixed(2)}s (AMB MÀRGENS)`);
                        utils.log(`🔍 [LOG] Comparació: duradaEsperada=${clipDuration.toFixed(4)}s vs duradaReal=${clipActualDur.toFixed(4)}s | startClip=${clipData.start.toFixed(4)}s | INseq hauria de ser ~${clipData.start.toFixed(4)}s OUTseq hauria de ser ~${clipData.end.toFixed(4)}s`);
                    } catch(e) {
                        utils.log(`📐 Clip inserit: ${clipDataRaw}`);
                    }

                    // 4g. Retallar coles sobrants de TOTS els tracks al final físic del clip MP4
                    // Això farà que l'àrea de treball s'ajusti automàticament al final del clip,
                    // i donarà més opcions per a que el zoom funcioni correctament.
                    if (clipEnd > 0) {
                        utils.log(`✂️ [TRIM-TAILS] Retallant tots els tracks a end=${clipEnd.toFixed(2)}s (final físic del MP4)`);
                        const numVideoTracks = parseInt(await callJSX("Tracks.count('video')") || "0");
                        const numAudioTracks = parseInt(await callJSX("Tracks.count('audio')") || "0");
                        const videoTracks = [];
                        for (let vt = 1; vt <= numVideoTracks; vt++) videoTracks.push(vt);
                        const audioTracks = [];
                        for (let at = 1; at <= numAudioTracks; at++) audioTracks.push(at);
                        utils.log(`✂️ [TRIM-TAILS] Tracks a processar: video=${JSON.stringify(videoTracks)}, audio=${JSON.stringify(audioTracks)}`);
                        const trimResult = await FASTPASS_UI.Logic.Clips.rippleAllOut(clipEnd, videoTracks, audioTracks, false);
                        utils.log(`✂️ [TRIM-TAILS] Resultat: ${trimResult} clips retallats/eliminats`);

                        // 4h. Reintentar zoom després de retallar les coles
                        const zoomRes2 = await callJSX("Timeline.zoomToSelection()");
                        utils.log(`🔍 Zoom després de trim tails: resultat=${zoomRes2}`);
                    } else {
                        utils.log(`⚠️ [TRIM-TAILS] No s'ha pogut determinar el clipEnd, es salta el trim`);
                    }

                } else if (media && media.mp4 && !cleanFeedData) {
                    // ─── MODE ESTÀNDARD (fallback sense escaleta) ─────────────────────────
                    utils.log(`🎬 [FALLBACK] Col·locant MP4 estàndard a V1...`);
                    // Moure el CTI a 00:00 abans d'inserir el clip
                    await callJSX("Timeline.set(0)");
                    utils.log(`🎯 CTI mogut a 00:00 abans d'inserir el clip (fallback)`);
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

        /**
         * getDuration: Obté la durada en segons d'un element del projecte via JSX.
         * @param {string} itemName - Nom de l'element (amb extensió)
         * @returns {Promise<number>} Durada en segons, 0 si no es troba l'element
         */
        getDuration: async function(itemName) {
            const safeName = encodeURIComponent(itemName).replace(/'/g, "\\'");
            const raw = await callJSX(`FASTPASS.Project.itemDuration('${safeName}')`);
            const secs = parseFloat(raw);
            return isNaN(secs) ? 0 : secs;
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
