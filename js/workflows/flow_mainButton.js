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

        _runNew: async function () {
            const utils = getUtils();
            log("🚀 [FLOW-NEW]");
            const ctx = await this._setupContext();

            // 1. Scanner (Hauria de ser literal via window.Scan)
            const wottData = await window.Scan.wotts(ctx);
            const temaReal = (wottData && wottData.tema) ? wottData.tema : "PENDENT";
            const sanitizedTema = utils.sanitizeName(temaReal);

            // 2. Generar nombres
            const projectName = ctx.config.naming.getProjectName(ctx, sanitizedTema);
            const seqName = ctx.config.naming.getSequenceName(ctx, sanitizedTema);

            const fileName = `Pruebas_${projectName}.prproj`;
            const destPath = ctx.config.rutas.destinoBase + ctx.progData.directorio + "\\" + ctx.dateDir + "\\" + fileName;

            utils.ensureFolders(destPath.substring(0, destPath.lastIndexOf("\\")));

            log(`🏗️ Creant projecte [${temaReal}]...`);
            const projectResult = await window.Project.create(ctx.config.rutas.plantilla_net, destPath, seqName);

            if (projectResult === "OK" || projectResult.success) {
                await this._createLock(destPath);

                log("📁 Creant estructura de Bins...");
                await callJSX("Project.bin('CHYRON')");

                ctx.mediaAssets = await window.Scan.mediaAssets(ctx);

                if ((wottData.list && wottData.list.length > 0) || (ctx.mediaAssets && ctx.mediaAssets.mp4)) {
                    log("🎞️ Iniciant sincronització de fitxers...");
                    await this._performSync(ctx, wottData, ctx.mediaAssets);
                }

                if (ctx.mediaAssets && ctx.mediaAssets.mp4) {
                    const mp4Name = ctx.mediaAssets.mp4.name;
                    await utils.delay(1000);

                    log(`🎬 Col·locant clip [${mp4Name}] al Timeline...`);
                    // Literal: Clips.insert(nom, pista, segons, duració, tipus)
                    const resTimeline = await callJSX(`Clips.insert('${utils.escape(mp4Name)}', 1, 0, null, 'video')`);

                    if (resTimeline === "OK") {
                        log("✅ Clip inserit i visible al V1.");
                    }
                }

                log("✅ Procés de creació finalitzat.");
            }
        },

        _runUpdate: async function () {
            log("🚀 [FLOW-UPDATE]");
            const ctx = await this._setupContext();
            const wottData = await window.Scan.wotts(ctx);

            if (!wottData || !wottData.tema) {
                log("⚠️ Encara no hi ha rètols al NAS. Guardant progrés...");
                return await callJSX("Project.save()");
            }

            // Literal: Project.path()
            const currentPath = await callJSX("Project.path()");

            if (currentPath.indexOf("PENDENT") !== -1) {
                log("🧬 Projecte PENDENT detectat. Promocionant...");

                const sanitizedTema = getUtils().sanitizeName(wottData.tema);
                const newProjectName = ctx.config.naming.getProjectName(ctx, sanitizedTema);
                const newPath = ctx.config.rutas.destinoBase + ctx.progData.directorio + "\\" + ctx.dateDir + "\\" + "Pruebas_" + newProjectName + ".prproj";

                const media = await window.Scan.mediaAssets(ctx);
                await this._performSync(ctx, wottData, media);

                log(`💾 Guardant com a: ${newPath}`);
                // Literal: Project.saveAs()
                const saveRes = await callJSX(`Project.saveAs('${getUtils().escape(newPath)}')`);

                if (saveRes === "OK") {
                    log(`🗑️ Eliminant rastre PENDENT...`);
                    getUtils().deleteFile(currentPath);
                    getUtils().deleteFile(currentPath + ".lock");
                    await this._createLock(newPath);
                    log("🟢 Projecte promocionat amb èxit!");
                }
            } else {
                const media = await window.Scan.mediaAssets(ctx);
                await this._performSync(ctx, wottData, media);
                await callJSX("Project.save()");
                log("✅ Actualització completada.");
            }
        },

        _runGo: async function (projName) {
            log(`🚀 [FLOW-GO] Canviant focus a: ${projName}...`);
            // Literal: Context.set()
            const res = await callJSX(`Context.set('${getUtils().escape(projName)}')`);
            if (res === "OK") {
                if (FASTPASS_UI.Core && FASTPASS_UI.Core.Context) {
                    await FASTPASS_UI.Core.Context.checkContext();
                }
            }
        },

        _runLoad: async function () {
            log("🚀 [FLOW-LOAD]");
            const ctx = await this._setupContext();
            const cfg = ctx.config;

            const wottData = await window.Scan.wotts(ctx);
            const sanitizedTheme = getUtils().sanitizeName(wottData.tema || 'PENDENT');
            const projSlug = ctx.config.naming.getProjectName(ctx, sanitizedTheme);
            const destPath = cfg.rutas.destinoBase + ctx.progData.directorio + "\\" + ctx.dateDir + "\\" + `Pruebas_${projSlug}.prproj`;

            await this._createLock(destPath);
            // Literal: Project.open()
            await callJSX(`Project.open('${destPath.replace(/\\/g, "\\\\")}')`);
            log("✅ Projecte obert.");
        },

        _createLock: async function (projPath) {
            try {
                const lockPath = projPath + ".lock";
                // Literal: IO.getUser() i IO.writeTxt()
                const user = await callJSX("IO.getUser()");
                log(`🔒 Escrivint bloqueig per a ${user}...`);
                await callJSX(`IO.writeTxt('${lockPath.replace(/\\/g, "\\\\")}', '${user}')`);
            } catch (e) { console.error("Error creant .lock", e); }
        },

        _performSync: async function (ctx, wottData, media) {
            const utils = getUtils();
            log("🎞️ [SYNC] Iniciant ingesta segmentada...");

            let mediaPaths = [];
            if (media?.mp4?.path) mediaPaths.push(media.mp4.path);
            if (media?.srt?.path) mediaPaths.push(media.srt.path);

            if (mediaPaths.length > 0) {
                log(`📥 Ingestant media a root...`);
                await utils.importList(mediaPaths, "root");
            }

            if (wottData.list && wottData.list.length > 0) {
                const wottPaths = wottData.list.map(w => w.path);
                log(`📥 Ingestant ${wottPaths.length} rètols al Bin CHYRON...`);
                await utils.importList(wottPaths, "CHYRON");
            }
        },

        _setupContext: async function () {
            const config = FASTPASS_UI.Config.get();
            const idProg = document.getElementById('programa').value;
            const progData = config.mapeoProgramas[idProg];
            const dateStr = getUtils().getFormattedDate();
            const dateDir = dateStr.replace(/["\s]/g, "").trim();

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