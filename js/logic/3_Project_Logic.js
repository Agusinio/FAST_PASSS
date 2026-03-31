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
            const res = await callJSX(`Project.open('${projectPath.replace(/\\/g, '\\\\')}')`);
            if (res !== "OK") return { success: false, error: res };
            
            await utils.delay(1200);

            // 2. Cerca literal d'items
            const itemsRaw = await callJSX(`Project.items('')`);
            const items = JSON.parse(itemsRaw || "[]");
            
            const targetSeq = items.find(i => i.type === 3 && i.name.indexOf(sequenceWildcard) !== -1);
            
            if (targetSeq) {
                utils.log(`🎯 Seqüència trobada: ${targetSeq.name}. Obrint...`);
                await callJSX(`Project.openSeq('${targetSeq.name}')`);
                return { success: true, sequence: targetSeq.name };
            } else {
                utils.log(`⚠️ Seqüència no trobada amb prefix: ${sequenceWildcard}`, "WARN");
                return { success: false, error: "SEQUENCE_NOT_FOUND" };
            }
        },

        /**
        * create: Crea un nou tema a partir d'una plantilla (Lògica verificada v2.6.0)
        */
        create: async function(ctx, wottData, media, paths, portada) { // Agregamos portada aquí
            const { plantillaPath, fullDestPath, folderPath, sanitizedTheme } = paths;
            const config = ctx.config;

            // 1. ABRIR PLANTILLA
            utils.log(`📂 Obrint plantilla: ${plantillaPath}`);
            await callJSX(`Project.open('${plantillaPath.replace(/\\/g, "/")}')`);
            
            // 2. INGESTA GENERAL (Wotts, Media y Portada)
            await this.ingestAssets(ctx, wottData, media, portada);

            // 3. CLONAR Y RENOMBRAR SEQÜÈNCIA
            if (media && media.mp4) {
                const plantillaSeq = "OTT VERTICAL"; 
                utils.log(`👥 Buscant i clonant: ${plantillaSeq}`);
                const resClone = await callJSX(`Project.cloneSeq('${encodeURIComponent(plantillaSeq)}')`);
                
                if (resClone && resClone.indexOf("ERR") === -1) {
                    const finalSeqName = config.naming.getSequenceName(ctx, sanitizedTheme);
                    await callJSX(`Project.rename('${encodeURIComponent(resClone)}', '${encodeURIComponent(finalSeqName)}')`);
                    
                    // 4. INSERTAR MP4 (Solo en creación inicial)
                    utils.log(`🎬 Estampant vídeo a la V1...`);
                    const escapedMediaName = encodeURIComponent(media.mp4.name);
                    await callJSX(`Clips.insert('${escapedMediaName}', 1, 0)`);
                }
            }

            // 5. ASEGURAR CARPETAS Y GUARDADO FINAL (SAVE AS)
            await utils.ensureFolders(folderPath);
            const escapedPath = fullDestPath.replace(/\\/g, "/").replace(/'/g, "\\'");

            utils.log(`🏗️ Guardant projecte final: ${escapedPath}`);
            let saveRes = await callJSX(`Project.saveAs('${escapedPath}')`);
            
            if (saveRes && saveRes.indexOf("ERR") !== -1) {
                await utils.delay(2000);
                saveRes = await callJSX(`Project.saveAs('${escapedPath}')`);
            }

            if (saveRes && saveRes.indexOf("ERR") !== -1) throw new Error("Premiere no ha permès guardar: " + saveRes);

            // 6. BLOQUEIG (LOCK)
            await this.lock(fullDestPath);
            
            return { success: true, path: fullDestPath };
        },

        /**
         * ingestAssets: Centralitza l'escaneig i ingesta de materials (Wotts, MP4, SRT, Portada).
         */
        ingestAssets: async function(ctx, wottData, media, portada) {
            utils.log("🎞️ [SYNC] Iniciant ingesta segmentada...");

            // A. RÈTOLS (Wotts) -> Bin CHY
            if (wottData && wottData.list && wottData.list.length > 0) {
                utils.log(`📥 Ingestant ${wottData.list.length} rètols...`);
                await callJSX("Project.bin('CHY')");
                
                const safeWotts = wottData.list.map(f => f.path.replace(/\\/g, "/"));
                await utils.importList(safeWotts, "root"); 
                
                await callJSX("Project.bin('CHY')");
                for (const wott of wottData.list) {
                    const escapedName = wott.name.replace(/'/g, "\\'");
                    await callJSX(`Project.move('${escapedName}', 'CHY')`);
                }
            }

            // B. MEDIA ASSETS (MP4 / SRT / PNG Portada) -> Root
            const mediaList = [];
            if (media?.mp4?.path) mediaList.push(media.mp4.path);
            if (media?.srt?.path) mediaList.push(media.srt.path);
            if (portada?.path) mediaList.push(portada.path); // 📍 PNG Logo/Portada

            if (mediaList.length > 0) {
                utils.log(`📥 Ingestant assets media al BIN ROOT...`);
                await utils.importList(mediaList, "root");
            }
        },

        /**
         * lock: Crea el fitxer .lock per marcar la propietat del projecte.
         */
        lock: async function (projPath) {
            try {
                const lockPath = projPath + ".lock";
                const user = await callJSX("IO.getUser()");
                const safeLockPath = lockPath.replace(/\\/g, "/"); 
                utils.log(`🔒 Escrivint bloqueig per a ${user}...`);
                await callJSX(`IO.writeTxt('${safeLockPath}', '${user}')`);
            } catch (e) { 
                utils.log("Error creant .lock: " + e.message, "WARN"); 
            }
        }
    };

    // Alias global literal
    window.Project = FASTPASS_UI.Logic.Project;

    window.FASTPASS_UI = FASTPASS_UI;
})();
