/**
 * ============================================================================
 * WORKFLOW: NOU / ACTUALITZAR / OBRIR (v12 - VERSIÓ ULTRA-LIPO)
 * ============================================================================
 */

(function() {
    var FASTPASS_UI = window.FASTPASS_UI || {};
    FASTPASS_UI.Workflows = FASTPASS_UI.Workflows || {};

    const utils = window.FASTPASS_UI.Utils;
    const projectLogic = window.FASTPASS_UI.Logic.Project;
    const scanner = window.FASTPASS_UI.Logic.Scanner;

    const log = (m) => utils.log(m, "DEBUG");

    FASTPASS_UI.Workflows.Nou = {
        
        /**
         * Dispatcher principal de l'acció.
         */
        runMainAction: async function(action, data) {
            log("⏯️ Iniciant workflow: [" + action + "]");
            utils.updateUIState('BUSY');
        
            try {
                switch(action) {
                    case 'NEW':    await this._runNew(); break;
                    case 'UPDATE': await this._runUpdate(); break;
                    case 'LOAD':   await this._runLoad(); break; 
                    case 'GO':     await this._runGo(data.name); break;
                    default:       console.warn("⚠️ Acció desconeguda:", action);
                }
                utils.status('Procés completat!', 'exito');
            } catch (e) {
                utils.handleError(e, "MainAction");
            } finally {
                utils.updateUIState('READY');
            }
        },

        /**
         * CREAR NOU TEMA
         */
        _runNew: async function() {
            log("🚀 [FLOW-NEW]");
            const ctx = await this._setupContext();
            const wottData = await scanner.findTemaData(ctx);
            const media = await scanner.findMediaAssets(ctx);
            
            const template = ctx.config.rutas.plantilla_net;
            const destPath = ctx.config.rutas.destinoBase + ctx.progData.directorio + "\\" + 
                             `Pruebas_${ctx.progData.archivo}_${ctx.dateDir}_${ctx.bloque}_${utils.sanitizeName(wottData.tema)}.prproj`;

            const seqName = `${ctx.progData.archivo}_${wottData.tema}`;
            await projectLogic.createFromTemplate(template, destPath, seqName);
            
            // Ingesta y Overwrite
            await this._performSync(ctx, wottData, media);
            if (media.mp4) {
                await utils.callJSX(`jsx_overwriteClip('${utils.escape(media.mp4.name)}', 1, 0.0, 'video')`);
            }
        },

        /**
         * ACTUALITZAR TEMA
         */
        _runUpdate: async function() {
            log("🚀 [FLOW-UPDATE]");
            const ctx = await this._setupContext();
            const wottData = await scanner.findTemaData(ctx);
            const media = await scanner.findMediaAssets(ctx);
            const seqName = `${ctx.progData.archivo}_${wottData.tema}`;

            // Ingesta y Sync
            await this._performSync(ctx, wottData, media);
            if (media.mp4) {
                await utils.callJSX(`jsx_openSequence('${seqName}')`);
                await utils.callJSX(`jsx_overwriteClip('${utils.escape(media.mp4.name)}', 1, 0.0, 'video')`);
            }
            
            await utils.callJSX("app.project.save()");
        },

        /**
         * OBRIR TEMA (LOAD)
         */
        _runLoad: async function() {
            log("🚀 [FLOW-LOAD] Obertura i Sync...");
            const ctx = await this._setupContext();
            const wottData = await scanner.findTemaData(ctx);
            const media = await scanner.findMediaAssets(ctx);
            
            const projName = `Pruebas_${ctx.progData.archivo}_${ctx.dateDir}_${ctx.bloque}_${utils.sanitizeName(wottData.tema)}.prproj`;
            const fullPath = ctx.config.rutas.destinoBase + ctx.progData.directorio + "\\" + projName;
            const seqName = `${ctx.progData.archivo}_${wottData.tema}`;

            // 1. Abrir sesión
            await projectLogic.activateProject(fullPath, seqName);
            
            // 2. Sincronía
            await this._performSync(ctx, wottData, media);
            if (media.mp4) {
                await utils.callJSX(`jsx_overwriteClip('${utils.escape(media.mp4.name)}', 1, 0.0, 'video')`);
            }
        },

        /**
         * ANAR-HI (GO)
         */
        _runGo: async function(projectName) {
            log(`🚀 [FLOW-GO] Focus a: ${projectName}`);
            const ctx = await this._setupContext();
            const wottData = await scanner.findTemaData(ctx);
            const seqPrefix = `${ctx.progData.archivo}_${wottData.tema}`;
            const currentProjPath = await utils.callJSX("app.project.path");
            await projectLogic.activateProject(currentProjPath, seqPrefix);
        },

        /**
         * @private
         * Mètode unificat de sincronització de materials (Ingesta).
         */
        _performSync: async function(ctx, wottData, media) {
            log("🎞️ Sincronitzant materials a la safata (Bins)...");
            
            // Importació Wotts
            if (wottData.list.length > 0) {
                const list = wottData.list.map(w => w.file.path);
                await utils.importList(list, "CHYRONS");
            }
            
            // Importació Media (MP4/SRT)
            const baseMedia = [];
            if (media.mp4) baseMedia.push(media.mp4.path);
            if (media.srt) baseMedia.push(media.srt.path);
            
            if (baseMedia.length > 0) {
                await utils.importList(baseMedia, "root");
            }
        },

        // --- AUXILIARES ---

        _setupContext: async function() {
            const config = FASTPASS_UI.Config.get();
            const idProg = document.getElementById('programa').value;
            const bloque = document.getElementById('bloc').value;
            const progData = config.mapeoProgramas[idProg];
            const dateStr = utils.getFormattedDate();
            const dateDir = dateStr.replace(/"/g, "").trim();
            return { config, progData, bloque, dateDir };
        }
    };

    window.FASTPASS_UI = FASTPASS_UI;
})();