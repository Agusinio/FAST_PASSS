/**
 * ============================================================================
 * WORKFLOW: RENDER (EXPORTACIÓ) - v2.9.5 Tactical
 * ============================================================================
 */

(function () {
    var FASTPASS_UI = window.FASTPASS_UI || {};
    FASTPASS_UI.Workflows = FASTPASS_UI.Workflows || {};

    const getUtils = () => window.FASTPASS_UI.Utils;
    const getRenderLogic = () => window.FASTPASS_UI.Logic.Render;
    const getScanner = () => window.FASTPASS_UI.Logic.Scan;

    const log = (m) => getUtils().log(m, "DEBUG");
    const callJSX = (s) => getUtils().callJSX(s);

    FASTPASS_UI.Workflows.Render = {

        /**
         * MP4: Envia la seqüència activa a AME amb nom intel·ligent.
         */
        runVideo: async function () {
            if (!(await getUtils().validateActiveSequence())) return;
            log("🚀 Preparant enviament a AME...");
            const config = FASTPASS_UI.Config.get();

            try {
                let outputDir = await callJSX("Entorn.folder()");
                if (!outputDir) outputDir = config.rutas.destinoBase || "C:\\Temp";
                
                getUtils().status("Processant nom...", "procesando");

                const seqName = await callJSX('Entorn.activeSeq()');
                let fileName = "Export_TBD.mp4";
                
                if (seqName) {
                    const parts = seqName.split("_");
                    const prog = parts[0] || "PROG";
                    const tema = parts.slice(2).join("_") || "TEMA";
                    const now = new Date();
                    const timeStr = ("0" + now.getHours()).slice(-2) + "_" + ("0" + now.getMinutes()).slice(-2);
                    fileName = `${prog}_${tema}_${timeStr}.mp4`;
                }

                const extRoot = window.FASTPASS_UI.csInterface.getSystemPath(SystemPath.EXTENSION);
                const presetPath = `${extRoot}/presets/H264_2Pass_Vertical.epr`.replace(/\\/g, '\\\\');

                log(`📤 Destí: ${outputDir}\\${fileName}`);

                const res = await getRenderLogic().queue(presetPath, outputDir, fileName);

                if (res && res.indexOf("OK") === 0) {
                    getUtils().status(`AME: ${fileName}`, "exito");
                    log("✅ Enviat a Media Encoder.", "INFO");
                    FASTPASS_UI.State.lastRenderName = fileName.replace(".mp4", "");
                } else {
                    throw new Error("Error Media Encoder: " + res);
                }

            } catch (e) { getUtils().handleError(e, "RenderVideo"); }
        },

        /**
         * PORTADA PRO: Importació, Aïllament i Snapshot automàtic del darrer PNG.
         */
        runPortada: async function () {
            if (!(await getUtils().validateActiveSequence())) return;
            log("📸 Iniciant Portada Pro (Modo Aïllat)...");
            
            try {
                const config = FASTPASS_UI.Config.get();
                const state = FASTPASS_UI.State;
                const T_MP4 = config.tracks.video.mp4 || 1;
                const T_PORTADA = 10; // Pista de seguretat V10 per la cara

                // 1. BUSCAR LA PORTADA RECENT (Logic.Scan)
                const ctx = { config, progData: state.progData, bloque: state.bloque };
                const portada = await getScanner().portada(ctx);
                
                if (!portada) {
                    throw new Error("No s'ha trobat cap PNG de portada que coincideixi amb el Programa i el Bloc.");
                }

                log(`🔍 Portada trobada: ${portada.name}`);

                // 2. IMPORTAR PORTADA AL PROJECTE (Literal)
                const importPayload = JSON.stringify([portada.path.replace(/\\/g, '\\\\')]);
                await callJSX(`Arxiu.importFiles('${importPayload}', 'root')`);

                // 3. AÏLLAMENT DE PISTES (Solo V1 + V10)
                log("🔒 Aïllant pistes per la captura...");
                await callJSX(`Pistes.setGlobalState('video', 'mute', true)`);
                await callJSX(`Pistes.mute(${T_MP4}, false, 'video')`); // Encenem V1
                await callJSX(`Pistes.mute(${T_PORTADA}, false, 'video')`); // Encenem V10

                // 4. INSERIR PORTADA AL TIMELINE (En el cabezal)
                const ctiRaw = await callJSX('Cronologia.get()');
                const cti = parseFloat(ctiRaw || "0");
                
                log(`📌 Inserint ${portada.name} a V${T_PORTADA}`);
                await callJSX(`Segments.insert('${getUtils().escape(portada.name)}', ${T_PORTADA}, ${cti}, null, 'video')`);

                // 5. EXPORTACIÓ FRAME (Snapshot a carpeta destino Portades)
                const targetDir = config.rutas.portadas || config.rutas.destinoBase || "C:\\Temp";
                let nameBase = state.lastRenderName || (await callJSX('Entorn.activeSeq()')) || "Portada_TBD";
                const destPath = `${targetDir}\\${nameBase}.png`;

                log(`📸 Generant Snapshot a: ${destPath}`);
                const snapRes = await getRenderLogic().capture(destPath, cti);

                // 6. NETEJA I RESTAURACIÓ
                log("🧹 Netejant clip temporal i restaurant pistes...");
                
                // Borrar l'últim clip de V10 (el que acabem de posar)
                const clipsCount = await callJSX(`Segments.count(${T_PORTADA}, 'video')`);
                if (parseInt(clipsCount) > 0) {
                    await callJSX(`Segments.remove(${T_PORTADA}, ${parseInt(clipsCount) - 1}, 'video')`);
                }

                // Restaurar visibilitat totes pistes
                await callJSX(`Pistes.setGlobalState('video', 'mute', false)`);

                if (snapRes.success) {
                    getUtils().status("Portada OK", "exito");
                    log("✅ Portada generada amb èxit.");
                } else {
                    throw new Error("Error Snapshot: " + snapRes.log);
                }

            } catch (e) { getUtils().handleError(e, "RenderPortadaPro"); }
        }
    };

    window.FASTPASS_UI.Workflows.Render = FASTPASS_UI.Workflows.Render;
})();