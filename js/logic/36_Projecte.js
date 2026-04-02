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
            const res = await callJSX(`Projecte.open('${projectPath.replace(/\\/g, '\\\\')}')`);
            if (res !== "OK") return { success: false, error: res };
            
            await utils.delay(1200);

            // 2. Cerca literal d'items
            const itemsRaw = await callJSX(`Projecte.items('')`);
            const items = JSON.parse(itemsRaw || "[]");
            
            const targetSeq = items.find(i => i.type === 3 && i.name.indexOf(sequenceWildcard) !== -1);
            
            if (targetSeq) {
                utils.log(`🎯 Seqüència trobada: ${targetSeq.name}. Obrint...`);
                await callJSX(`Projecte.openSeq('${targetSeq.name}')`);
                return { success: true, sequence: targetSeq.name };
            } else {
                utils.log(`⚠️ Seqüència no trobada amb prefix: ${sequenceWildcard}`, "WARN");
                return { success: false, error: "SEQUENCE_NOT_FOUND" };
            }
        },

        /**
        * create: Crea un nou tema a partir d'una plantilla (Lògica verificada v2.6.0)
        */
        create: async function(ctx, wottData, media, paths, portadaList) { // Agregamos portada aquí
            const { plantillaPath, fullDestPath, folderPath, sanitizedTheme } = paths;
            const config = ctx.config;

            // 1. ABRIR PLANTILLA
            utils.log(`📂 Obrint plantilla: ${plantillaPath}`);
            await callJSX(`Projecte.open('${plantillaPath.replace(/\\/g, "/")}')`);
            
            // 2. INGESTA GENERAL (Wotts, Media y Portada)
            await this.ingestAssets(ctx, wottData, media, portadaList);

            // 3. CLONAR Y RENOMBRAR SEQÜÈNCIA
            if (media && media.mp4) {
                const plantillaSeq = "OTT VERTICAL"; 
                utils.log(`👥 Buscant i clonant: ${plantillaSeq}`);
                const resClone = await callJSX(`Projecte.cloneSeq('${encodeURIComponent(plantillaSeq)}')`);
                
                if (resClone && resClone.indexOf("ERR") === -1) {
                    // 📍 FIX: Recuperem el programa de ctx i el tema del wottData
                    const shortProg = (ctx.progData && ctx.progData.wott) ? ctx.progData.wott : "TNV";
                    const temaNet = wottData.tema.toUpperCase();
                    
                    const finalSeqName = `${shortProg}_${ctx.bloque}_${temaNet}`; // ex: TNV_V1_ESPORTS
                    
                    utils.log(`📝 Seqüència clonada [${resClone}]. Renombrant a: ${finalSeqName}`);
                    await callJSX(`Projecte.rename('${encodeURIComponent(resClone)}', '${encodeURIComponent(finalSeqName)}')`);
                
                    // 4. Insertar MP4
                    utils.log(`🎬 Estampant vídeo a la V1...`);
                    const escapedMediaName = encodeURIComponent(media.mp4.name);
                    await callJSX(`Segments.insert('${escapedMediaName}', 1, 0)`);
                }
            }

            // 5. ASEGURAR CARPETAS Y GUARDADO FINAL (SAVE AS)
            await utils.ensureFolders(folderPath);
            const escapedPath = fullDestPath.replace(/\\/g, "/").replace(/'/g, "\\'");

            utils.log(`🏗️ Guardant projecte final: ${escapedPath}`);
            let saveRes = await callJSX(`Projecte.saveAs('${escapedPath}')`);
            
            if (saveRes && saveRes.indexOf("ERR") !== -1) {
                await utils.delay(2000);
                saveRes = await callJSX(`Projecte.saveAs('${escapedPath}')`);
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
        
            // A. RÈTOLS (Wotts) -> Bin CHY
            if (wottData && wottData.list && wottData.list.length > 0) {
                utils.log(`📥 Ingestant ${wottData.list.length} rètols...`);
                
                // 1. Primer creem el Bin (Això assegura que el destí existeix)
                await callJSX(`Projecte.bin('${encodeURIComponent('CHY')}')`);
                
                // 2. Importem la llista al Root
                const safeWotts = wottData.list.map(f => f.path.replace(/\\/g, "/"));
                await utils.importList(safeWotts, "root"); 
                
                // 3. Esperem que Premiere indexi els nous items
                await utils.delay(500);
            
                // 4. Movem cada wott al Bin CHY
                // Estratègia de 3 nivells per garantir que ç i accents no siguin un problema:
                for (const wott of wottData.list) {
                    utils.log(`📦 Movent a CHY: ${wott.name}`);
                    
                    // NIVELL 1: moveByPath — robust davant encoding (ç, accents, etc.)
                    // Usa getMediaPath() per trobar l'item, no el nom d'item.
                    const safePath = encodeURIComponent(wott.path.replace(/\\/g, '/'));
                    let moveRes = await callJSX(`Projecte.moveByPath('${safePath}', 'CHY')`);
                    
                    if (moveRes && moveRes.indexOf("ERR") !== -1) {
                        // NIVELL 2: move per nom (amb _normWin al JSX millorada)
                        utils.log(`⚠️ moveByPath fallat. Intentant per nom: ${wott.name}`);
                        moveRes = await callJSX(`Projecte.move('${encodeURIComponent(wott.name)}', 'CHY')`);
                    }
                    
                    if (moveRes && moveRes.indexOf("ERR") !== -1) {
                        // NIVELL 3: moveByID (darrer recurs, bassat en ID numèric de 6 dígits)
                        const idMatch = wott.name.match(/[0-9]{6}/);
                        if (idMatch) {
                            utils.log(`⚠️ Nom fallat. Intentant per ID: ${idMatch[0]}`);
                            moveRes = await callJSX(`Projecte.moveByID('${idMatch[0]}', 'CHY')`);
                        } else {
                            utils.log(`❌ No s'ha pogut moure: ${wott.name} (sense ID de 6 dígits)`, "WARN");
                        }
                    }
                    
                    utils.log(`📊 Resultat move [${wott.name}]: ${moveRes}`);
                }
            }
        
            // B. MEDIA ASSETS (MP4 / SRT) -> Root
            const mediaList = [];
            if (media?.mp4?.path) mediaList.push(media.mp4.path.replace(/\\/g, "/"));
            if (media?.srt?.path) mediaList.push(media.srt.path.replace(/\\/g, "/"));
        
            if (mediaList.length > 0) {
                utils.log(`📥 Ingestant assets media al ROOT...`);
                await utils.importList(mediaList, "root");
            }
        
            // C. PORTADES (Múltiples PNGs) -> Bin PORTADES
            if (portadas && portadas.length > 0) {
                utils.log(`🖼️ Ingestant ${portadas.length} portades al bin PORTADES...`);
                
                // 1. Crear el Bin PORTADES
                await callJSX(`Projecte.bin('${encodeURIComponent('PORTADES')}')`);
        
                // 2. Importar todas al Root primero
                const safePortadas = portadas.map(p => p.path.replace(/\\/g, "/"));
                await utils.importList(safePortadas, "root");
        
                // 3. Moverlas usando moveByPath (robust per a noms amb accents)
                for (const p of portadas) {
                    const safePath = encodeURIComponent(p.path.replace(/\\/g, '/'));
                    let moveRes = await callJSX(`Projecte.moveByPath('${safePath}', '${encodeURIComponent('PORTADES')}')`);
                    if (moveRes && moveRes.indexOf("ERR") !== -1) {
                        // Fallback per nom
                        await callJSX(`Projecte.move('${encodeURIComponent(p.name)}', '${encodeURIComponent('PORTADES')}')`);
                    }
                }
            }
        },

        /**
         * lock: Crea el fitxer .lock per marcar la propietat del projecte.
         */
        lock: async function (projPath) {
            try {
                const lockPath = projPath + ".lock";
                const user = await callJSX("Arxiu.getUser()");
                const safeLockPath = lockPath.replace(/\\/g, "/"); 
                utils.log(`🔒 Escrivint bloqueig per a ${user}...`);
                await callJSX(`Arxiu.writeTxt('${safeLockPath}', '${user}')`);
            } catch (e) { 
                utils.log("Error creant .lock: " + e.message, "WARN"); 
            }
        }
    };

    // Alias global literal
    window.Project = FASTPASS_UI.Logic.Project;

    window.FASTPASS_UI = FASTPASS_UI;
})();
