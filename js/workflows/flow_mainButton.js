/**
 * ============================================================================
 * WORKFLOW: MAIN BUTTON (v15 - SESSIÓ I CICLE DE VIDA)
 * ============================================================================
 * Aquest workflow orquestra la creació, actualització i obertura de temes.
 * Totes les decisions de cerca i importació s'han delegat a LOGIC (Scanner i Project_Logic).
 */

(function () {
    var FASTPASS_UI = window.FASTPASS_UI || {};
    FASTPASS_UI.Workflows = FASTPASS_UI.Workflows || {};

    const utils = window.FASTPASS_UI.Utils;
    const projectLogic = window.FASTPASS_UI.Logic.Project;
    const scanner = window.FASTPASS_UI.Logic.Scanner;

    const log = (m) => utils.log(m, "DEBUG");

    FASTPASS_UI.Workflows.MainButton = {

        /**
         * runMainAction: Acció principal que orquestra la sesión segons l'estat del Context.
         */
        runMainAction: async function (action, data) {
            log("⏯️ Iniciant workflow: [" + action + "]");
            utils.updateUIState('BUSY'); // Bloqueig de UI per evitar clics duplicats

            try {
                switch (action) {
                    case 'NEW': await this._runNew(); break;    // FLOW per a temes inexistents
                    case 'UPDATE': await this._runUpdate(); break; // FLOW per a temes ja oberts o en disc
                    case 'LOAD': await this._runLoad(); break;   // FLOW per a carregar projecte extern
                    case 'GO': await this._runGo(data.name); break; // FLOW per canviar de projecte actiu
                    default: console.warn("⚠️ Acció desconeguda:", action);
                }
                utils.status('Procés completat!', 'exito');
            } catch (e) {
                utils.handleError(e, "MainAction");
            } finally {
                utils.updateUIState('READY'); // Alliberament de la UI
            }
        },

        /**
         * FLOW: CREAR NOU TEMA (A partir de plantilla)
         */
        _runNew: async function () {
            log("🚀 [FLOW-NEW]");
            // 1. Identificació del context (Programa, Bloc, Data)
            const ctx = await this._setupContext();

            // 2. Descobriment automàtic de materials en disc (Logic: Scanner)
            const wottData = await scanner.findTemaData(ctx);
            const media = await scanner.findMediaAssets(ctx);

            // 3. Generació de rutes de destí basades en el tema detectat
            const template = ctx.config.rutas.plantilla_net;
            const destPath = ctx.config.rutas.destinoBase + ctx.progData.directorio + "\\" +
                `Pruebas_${ctx.progData.archivo}_${ctx.dateDir}_${ctx.bloque}_${utils.sanitizeName(wottData.tema)}.prproj`;
            const seqName = `${ctx.progData.archivo}_${wottData.tema}`;

            // 4. Creació física del projecte (Logic: Project_Logic)
            // Inclou obertura de plantilla, clonació de seqüència, canvi de nom i SaveAs.
            await projectLogic.createFromTemplate(template, destPath, seqName);

            // 5. Ingesta i Sincronització de materials als Bins de Premiere
            await this._performSync(ctx, wottData, media);

            // 6. Muntatger base (Overwrite) del clip principal (MP4) a V1
            if (media.mp4) {
                await utils.callJSX(`jsx_overwriteClip('${utils.escape(media.mp4.name)}', 1, 0.0, 'video')`);
            }
        },

        /**
         * FLOW: ACTUALITZAR TEMA (Sincronia sense canvi de projecte)
         */
        _runUpdate: async function () {
            log("🚀 [FLOW-UPDATE]");
            const ctx = await this._setupContext();

            // 1. Re-escaneig de materials per trobar nous rètols o versions de video
            const wottData = await scanner.findTemaData(ctx);
            const media = await scanner.findMediaAssets(ctx);
            const seqName = `${ctx.progData.archivo}_${wottData.tema}`;

            // 2. Importació de nous materials trobats al projecte actual
            await this._performSync(ctx, wottData, media);

            // 3. Actualització del Timeline (Overwrite a V1 al temps 0.0)
            if (media.mp4) {
                await utils.callJSX(`jsx_openSequence('${seqName}')`);
                await utils.callJSX(`jsx_overwriteClip('${utils.escape(media.mp4.name)}', 1, 0.0, 'video')`);
            }

            // 4. Salvetat forçada de seguretat
            await utils.callJSX("app.project.save()");
        },

        /**
         * FLOW: OBRIR TEMA (LOAD - Projecte en disc no actiu)
         */
        _runLoad: async function () {
            log("🚀 [FLOW-LOAD]");
            const ctx = await this._setupContext();
            const wottData = await scanner.findTemaData(ctx);
            const media = await scanner.findMediaAssets(ctx);

            const projName = `Pruebas_${ctx.progData.archivo}_${ctx.dateDir}_${ctx.bloque}_${utils.sanitizeName(wottData.tema)}.prproj`;
            const fullPath = ctx.config.rutas.destinoBase + ctx.progData.directorio + "\\" + projName;
            const seqName = `${ctx.progData.archivo}_${wottData.tema}`;

            // 1. Activació de la sessió de treball (Logic: Project_Logic)
            // Obre el document i garanteix que la seqüència correcte estigui en focus.
            await projectLogic.activateProject(fullPath, seqName);

            // 2. Sincronia de nous materials des de l'obertura anterior
            await this._performSync(ctx, wottData, media);

            // 3. Muntatge del clip principal
            if (media.mp4) {
                await utils.callJSX(`jsx_overwriteClip('${utils.escape(media.mp4.name)}', 1, 0.0, 'video')`);
            }
        },

        /**
         * FLOW: ANAR-HI (Canvi de focus en projectes ja oberts en Premiere)
         */
        _runGo: async function (projectName) {
            log(`🚀 [FLOW-GO] Canviant focus a: ${projectName}`);
            const ctx = await this._setupContext();
            const wottData = await scanner.findTemaData(ctx);
            const seqPrefix = `${ctx.progData.archivo}_${wottData.tema}`;

            // Determinem la ruta actual si cal, i activem la seqüència orquestradament
            const currentProjPath = await utils.callJSX("app.project.path");
            await projectLogic.activateProject(currentProjPath, seqPrefix);
        },

        /**
         * @private
         * Mètode unificat de sincronització de materials (Ingesta als Bins).
         */
        _performSync: async function (ctx, wottData, media) {
            log("🎞️ Sincronitzant materials als Bins...");

            // 1. Ingesta de Rètols (Wotts) a la carpeta "CHYRONS" definida al Project.jsx
            if (wottData.list.length > 0) {
                const list = wottData.list.map(w => w.file.path);
                await utils.importList(list, "CHYRONS");
            }

            // 2. Ingesta de vídeo (MP4) i subtítols (SRT) a l'arrel (root) del projecte
            const baseMedia = [];
            if (media.mp4) baseMedia.push(media.mp4.path);
            if (media.srt) baseMedia.push(media.srt.path);

            if (baseMedia.length > 0) {
                await utils.importList(baseMedia, "root");
            }
        },

        /**
         * @private
         * Generació de l'objecte Context basat en l'estat actual de la UI i la Config.
         */
        _setupContext: async function () {
            const config = FASTPASS_UI.Config.get();
            const idProg = document.getElementById('programa').value;
            const bloque = document.getElementById('bloc').value;
            const progData = config.mapeoProgramas[idProg];
            const dateStr = utils.getFormattedDate();
            // Neteja de caràcters per a noms de projecte compatibles
            const dateDir = dateStr.replace(/"/g, "").trim();
            return { config, progData, bloque, dateDir };
        }
    };

    window.FASTPASS_UI = FASTPASS_UI;
})();