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

    const utils = window.FASTPASS_UI.Utils;
    const projectLogic = window.FASTPASS_UI.Logic.Project;
    const scanner = window.FASTPASS_UI.Logic.Scanner;

    const log = (m) => utils.log(m, "DEBUG");
    const callJSX = (s) => utils.callJSX(s);

    FASTPASS_UI.Workflows.MainButton = {

        /**
         * runMainAction: Acció principal orquestrada pel Context.
         */
        runMainAction: async function (action, data) {
            log("⏯️ Iniciant workflow: [" + action + "]");
            utils.updateUIState('BUSY');

            try {
                switch (action) {
                    case 'NEW': await this._runNew(); break;
                    case 'UPDATE': await this._runUpdate(); break;
                    case 'LOAD': await this._runLoad(); break;
                    case 'GO': await this._runGo(data.name); break;
                }
                utils.status('Procés completat!', 'exito');
            } catch (e) {
                utils.handleError(e, "MainAction");
            } finally {
                utils.updateUIState('READY');
            }
        },

        /**
         * FLOW: CREAR NOU TEMA
         */
        _runNew: async function () {
            log("🚀 [FLOW-NEW]");
            const ctx = await this._setupContext();
            const cfg = ctx.config;

            // 1. Descobriment automàtic
            const wottData = await scanner.findTemaData(ctx);
            const media = await scanner.findMediaAssets(ctx);

            // 2. Definició de rutes i noms
            const template = cfg.rutas.plantilla_net;
            const destPath = cfg.rutas.destinoBase + ctx.progData.directorio + "\\" +
                `Pruebas_${ctx.progData.archivo}_${ctx.dateDir}_${ctx.bloque}_${utils.sanitizeName(wottData.tema)}.prproj`;
            const seqName = `${ctx.progData.archivo}_${wottData.tema}`;

            // 3. Creació física (Project_Logic)
            await projectLogic.createFromTemplate(template, destPath, seqName);
            
            // 📍 BLOQUEIG: Creem el fitxer .lock
            await this._createLock(destPath);

            // 4. Ingesta i Sincronització
            await this._performSync(ctx, wottData, media);

            // 5. Muntatge base i configuració de l'espai de treball
            const T_MP4 = cfg.tracks.video.mp4; // V1
            const T_TEMP = cfg.tracks.video.template_1; // V2

            if (media.mp4) {
                await callJSX(`jsx_overwriteClip('${utils.escape(media.mp4.name)}', ${T_MP4}, 0.0, 'video')`);
            }

            // Configuració de finalització: Cabezal a 0 i targeting de pistes principals
            await callJSX('jsx_setCTI_Safe(0)');
            await callJSX(`jsx_setTrackTarget(${T_MP4}, true, 'video')`);
            await callJSX(`jsx_setTrackTarget(${T_TEMP}, true, 'video')`);
            
            log("✅ Projecte creat i llest a V" + T_MP4);
        },

        /**
         * FLOW: OBRIR PROJECTE EXISTENT
         */
        _runLoad: async function () {
            log("🚀 [FLOW-LOAD]");
            const ctx = await this._setupContext();
            const cfg = ctx.config;
            
            const wottData = await scanner.findTemaData(ctx);
            const destPath = cfg.rutas.destinoBase + ctx.progData.directorio + "\\" +
                `Pruebas_${ctx.progData.archivo}_${ctx.dateDir}_${ctx.bloque}_${utils.sanitizeName(wottData.tema)}.prproj`;

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

            const wottData = await scanner.findTemaData(ctx);
            const media = await scanner.findMediaAssets(ctx);
            const seqName = `${ctx.progData.archivo}_${wottData.tema}`;

            await this._performSync(ctx, wottData, media);

            if (media.mp4) {
                const T_MP4 = cfg.tracks.video.mp4;
                await callJSX(`jsx_openSequence('${seqName}')`);
                await callJSX(`jsx_overwriteClip('${utils.escape(media.mp4.name)}', ${T_MP4}, 0.0, 'video')`);
            }

            await callJSX("app.project.save()");
        },

        /**
         * @private
         * Mètode de sincronització de materials als Bins.
         */
        _performSync: async function (ctx, wottData, media) {
            log("🎞️ Sincronitzant materials...");

            // Ingesta de Rètols a la carpeta CHYRONS (VUI 5/6)
            if (wottData.list.length > 0) {
                const list = wottData.list.map(w => w.file.path);
                await utils.importList(list, "CHYRONS");
            }

            // Ingesta a l'arrel (Root) per a MP4 i SRT
            const baseMedia = [];
            if (media.mp4) baseMedia.push(media.mp4.path);
            if (media.srt) baseMedia.push(media.srt.path);

            if (baseMedia.length > 0) {
                await utils.importList(baseMedia, "root");
            }
        },

        /**
         * @private
         * Generació de l'objecte Context basat en la Config i la UI.
         */
        _setupContext: async function () {
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