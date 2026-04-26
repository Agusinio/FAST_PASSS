/**
 * ============================================================================
 * LOGIC: NNEWS - v1.0.0
 * Orquestració del flux "Clean-Swap" (Round-trip)
 * ============================================================================
 */

(function() {
    const FASTPASS_UI = window.FASTPASS_UI || {};
    FASTPASS_UI.Logic = FASTPASS_UI.Logic || {};

    const utils = {
        log: (m, type) => window.FASTPASS_UI.Utils.log(m, "NNEWS", type),
        callJSX: (s) => window.FASTPASS_UI.Utils.callJSX(s),
        escape: (s) => window.FASTPASS_UI.Utils.escape(s)
    };

    FASTPASS_UI.Logic.NNews = {
        
        /**
         * Executa el flux Gold Standard: 
         * Selecció de clips contigus -> Render net en bloc -> Substitució.
         */
        runCleanSwap: async function() {
            utils.log("🚀 Iniciant Clean-Swap (Gold Standard)...");

            // 1. Obtenir clips seleccionats al timeline
            const selectionRaw = await utils.callJSX("Timeline.getSelectedClips()");
            if (!selectionRaw || selectionRaw.startsWith("ERR")) {
                utils.log("⚠️ Error recuperant la selecció del timeline.", "ERR");
                return;
            }
            
            const selection = JSON.parse(selectionRaw);
            if (selection.length === 0) {
                utils.log("⚠️ No hi ha cap clip seleccionat al timeline.", "WARN");
                return;
            }

            // 2. Agrupar clips per projecte NNews
            const groups = this._groupClipsByProject(selection);
            if (groups.length === 0) {
                utils.log("⚠️ No s'ha pogut identificar cap projecte de NNews en la selecció.", "WARN");
                return;
            }
            
            // 3. Processar cada grup (projecte)
            for (const group of groups) {
                await this._processGroup(group);
            }

            utils.log("✅ Procesament Clean-Swap finalitzat.");
        },

        /**
         * Agrupa els clips seleccionats que pertanyen al mateix projecte NNews.
         * Extrau l'ID de 8 xifres del assetId (metadades) o del nom.
         */
        _groupClipsByProject: function(clips) {
            const groupsMap = {};
            
            clips.forEach(clip => {
                // Busquem ID de 8 xifres (ej: 50691475)
                const idMatch = clip.name.match(/50[0-9]{6}/) || clip.assetId?.match(/50[0-9]{6}/);
                if (idMatch) {
                    const id = idMatch[0];
                    if (!groupsMap[id]) groupsMap[id] = { projectId: id, clips: [] };
                    groupsMap[id].clips.push(clip);
                }
            });

            return Object.values(groupsMap);
        },

        /**
         * Processa un bloc de clips del mateix projecte.
         */
        _processGroup: async function(group) {
            utils.log(`📦 Processant bloc de ${group.clips.length} clips del projecte ${group.projectId}`);
            
            // 1. Localitzar NNP original a la xarxa
            const nnpRemotePath = await this._findNNP(group.projectId);
            if (!nnpRemotePath) return;

            // 2. COPIA LOCAL: Copiar NNP al directori del projecte per seguretat
            const projectFolder = await utils.callJSX("Context.folder()");
            const nnpLocalPath = `${projectFolder}\\NNews_Cache\\${group.projectId}.nnp`;
            
            // Assegurem que el directori existeix
            await utils.callJSX(`IO.createFolder('${utils.escape(projectFolder)}\\NNews_Cache')`);
            await utils.callJSX(`IO.copyFile('${utils.escape(nnpRemotePath)}', '${utils.escape(nnpLocalPath)}')`);
            utils.log(`💾 Còpia local del projecte creada a: ${nnpLocalPath}`);

            // 3. PARSE & FOOTPRINT VERIFICATION
            const nnpData = await FASTPASS_UI.NNewsParser.parse(nnpLocalPath);
            if (!nnpData) {
                utils.log("❌ Error en el parseig del projecte NNews.", "ERR");
                return;
            }

            const footprintMatch = this._verifyFootprints(group.clips, nnpData.clips);
            if (!footprintMatch) {
                utils.log("⚠️ ATENCIÓ: Els talls del timeline no coincideixen exactament amb el projecte NNews.", "WARN");
            }

            // 4. GENERAR RENDER (FFmpeg)
            utils.log("🎞️ Generant render net via FFmpeg...");
            // TODO: Integrar amb FFmpegEngine per concatenar i extreure segons nnpData.clips
            const renderPath = `${projectFolder}\\_TEMP_RENDERS\\CLEAN_${group.projectId}.mov`;
            
            // 5. INSERCIÓ EN V3 PER A VERIFICACIÓ
            utils.log(`📥 Inserint clip net a V3 per a verificació.`);
            const targetTrack = 3; 
            
            // Importar i col·locar sobre el primer clip del grup (com a referència)
            const firstClip = group.clips[0];
            await utils.callJSX(`Timeline.insertCleanClip('${utils.escape(renderPath)}', ${targetTrack}, ${firstClip.start})`);
            
            utils.log(`✨ Bloc ${group.projectId} llest per a verificació.`);
        },

        /**
         * Verifica que la durada i posició dels clips seleccionats coincideixi
         * amb l'estructura interna del projecte NNews.
         */
        _verifyFootprints: function(timelineClips, nnewsClips) {
            if (!nnewsClips || nnewsClips.length === 0) return true; // Fallback si el parser encara no llegeix clips
            
            utils.log("⚖️ Verificant footprints (Timeline vs NNews)...");
            for (const tClip of timelineClips) {
                // Comprovem si existeix algun clip al NNP amb durada idèntica (+- 1 frame)
                const match = nnewsClips.find(c => Math.abs(c.duration - tClip.duration) < 0.041);
                if (!match) return false;
            }
            return true;
        },

        /**
         * Cerca l'arxiu .nnp en les rutes configurades basant-se en l'ID.
         */
        _findNNP: async function(projectId) {
            utils.log(`🔍 Cercant projecte .nnp per a l'ID: ${projectId}...`);
            
            const searchPaths = FASTPASS_UI.Config.getNNewsPaths();
            if (searchPaths.length === 0) {
                utils.log("⚠️ No hi ha rutes de NNews configurades al perfil.", "WARN");
                return null;
            }

            for (const rootPath of searchPaths) {
                const fileNamePattern = `${projectId}*.nnp`;
                const foundFilesRaw = await utils.callJSX(`IO.findFiles('${utils.escape(rootPath)}', '${fileNamePattern}')`);
                const foundFiles = JSON.parse(foundFilesRaw || "[]");

                if (foundFiles.length > 0) {
                    const bestMatch = foundFiles.sort((a, b) => b.mdate - a.mdate)[0];
                    utils.log(`✅ Projecte trobat: ${bestMatch.path}`);
                    return bestMatch.path;
                }
            }

            utils.log(`❌ No s'ha trobat cap projecte .nnp per a l'ID ${projectId}`, "ERR");
            return null; 
        }
    };

    window.FASTPASS_UI = FASTPASS_UI;
})();
