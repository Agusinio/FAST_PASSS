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

    const log = (m, lvl) => getUtils().log(m, lvl || "DEBUG");
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
                let outputDir = await callJSX("Context.folder()");
                if (!outputDir) outputDir = config.rutas.destinoBase || "C:\\Temp";
                
                getUtils().status("Processant nom...", "procesando");

                const seqName = await callJSX('Context.activeSeq()');
                let fileName = "Export_TBD.mp4";
                
                if (seqName) {
                    // (2026-09-18) El nom de la seqüència pot ser PROG_BLOC_TEMA o
                    // PROG_TEMA. ABANS es feia sempre split("_") + slice(2) → amb
                    // "TNC_AFECTACIONS METRO..." (2 parts) no hi havia TEMA i sortia
                    // el literal "TEMA". Ara: 3+ parts → tema = tot menys PROG i BLOC;
                    // 2 parts → tema = la 2a. Fallback: títol del projecte/net.
                    const parts = seqName.split("_");
                    const prog = (parts[0] || "PROG").trim();
                    let tema = (parts.length >= 3 ? parts.slice(2).join("_") : (parts[1] || "")).trim();
                    if (!tema) {
                        try {
                            const projName = (window.FASTPASS_UI.State && window.FASTPASS_UI.State.lastOpenedProjectName) || "";
                            tema = projName.replace(/\.[^.]+$/, "")
                                .replace(/^Pruebas[_\s-]*/i, "")
                                .replace(/^[A-Z0-9]+[_\s-]+V\d[_\s-]*/i, "")
                                .trim();
                        } catch (eN) { }
                    }
                    if (!tema) tema = "TEMA";
                    const now = new Date();
                    const timeStr = ("0" + now.getHours()).slice(-2) + "_" + ("0" + now.getMinutes()).slice(-2);
                    fileName = `${prog}_${tema}_${timeStr}.mp4`;
                }

                // (2026-09-18) csInterface viu a FASTPASS_UI.Utils.csInterface (utils.js L7/12),
                // NO a FASTPASS_UI.csInterface → abans petava amb "Cannot read properties of
                // undefined (reading 'getSystemPath')".
                const csI = (getUtils() && getUtils().csInterface) || window.FASTPASS_UI.csInterface;
                const extRoot = csI.getSystemPath(SystemPath.EXTENSION);
                // (2026-09-18) Resolució FLEXIBLE del preset: qualsevol .epr de presets\ ,
                // amb prioritat a H264_2Pass_Vertical.epr. Així val tant el preset propi
                // (p.ex. "VERTIKAL XXX.epr") com el nom "oficial", i si es canvia el preset
                // no cal tocar codi (només deixar-lo a presets\).
                let presetNative = `${extRoot}/presets/VERTIKAL XXX.epr`;
                try {
                    const presetDirFwd = `${extRoot}/presets`;
                    const presetDirNative = presetDirFwd.replace(/\//g, '\\');
                    // OJO: `window.cep.fs.stat` NO és fiable aquí (no retorna .size → tot
                    // semblava de 0 bytes). Mesurem LLEGINT el fitxer.
                    const sizeOf = (nm) => {
                        try {
                            const r = window.cep.fs.readFile(presetDirNative + '\\' + nm);
                            if (!r || r.err !== 0 || !r.data) return -1;
                            return (typeof r.data.length === 'number') ? r.data.length
                                : (r.data.byteLength || 0);
                        } catch (eS) { return -1; }
                    };
                    const rd = window.cep.fs.readdir(presetDirFwd);
                    if (rd && rd.err === 0 && rd.data && rd.data.length) {
                        // Descartem porqueria ("._NOM.epr", ".DS_Store")
                        const eprs = rd.data.filter(f => /\.epr$/i.test(f) && f.charAt(0) !== '.');
                        // Preferència explícita → preset propi de l'usuari → qualsevol vàlid
                        const prefs = ['VERTIKAL XXX.epr', 'H264_2Pass_Vertical.epr'];
                        let chosen = null;
                        for (let iP = 0; iP < prefs.length && !chosen; iP++) {
                            const hit = eprs.find(f => f.toLowerCase() === prefs[iP].toLowerCase());
                            if (hit && sizeOf(hit) > 1024) chosen = hit;
                        }
                        if (!chosen) {
                            for (let iE = 0; iE < eprs.length; iE++) {
                                if (sizeOf(eprs[iE]) > 1024) { chosen = eprs[iE]; break; }
                            }
                        }
                        if (chosen) presetNative = presetDirNative + '\\' + chosen;
                        log('🎛️ [Render] Presets a presets\\: ' + eprs.join(', ') +
                            (chosen ? ' → ús: ' + chosen + ' (' + Math.round(sizeOf(chosen) / 1024) + ' KB)'
                                : ' → CAP de vàlid (>1KB)'));
                    }
                } catch (eL) { log('⚠️ [Render] No puc llistar presets/: ' + eL.message, 'WARN'); }
                // Normalització a ruta NATIVA (\): `cep.fs.stat` amb "/" retorna mida buida
                // (per això abans qualsevol preset semblava de 0 bytes). El JSX vol els "\" escapats.
                presetNative = presetNative.replace(/\//g, '\\');
                const presetPath = presetNative.replace(/\\/g, '\\\\');

                // (2026-09-18) Validació prèvia del preset: si no existeix o està BUIT, AME
                // falla amb un error críptic. Val més dir-ho clar (cas real: 0 bytes).
                try {
                    // Mesura per LECTURA: `cep.fs.stat` no retorna .size de forma fiable aquí
                    // (per això qualsevol preset semblava de 0 bytes).
                    const rP = window.cep.fs.readFile(presetNative);
                    const size = (rP && rP.err === 0 && rP.data)
                        ? ((typeof rP.data.length === 'number') ? rP.data.length : (rP.data.byteLength || 0))
                        : -1;
                    if (size === -1) {
                        getUtils().status('Falta el preset .epr a presets/', 'error');
                        log('❌ [Render] No puc llegir el preset: ' + presetNative, 'ERROR');
                        return;
                    }
                    if (size < 1024) {
                        getUtils().status("Preset .epr massa petit", 'error');
                        log('❌ [Render] El preset fa ' + size + ' bytes: ' + presetNative, 'ERROR');
                        return;
                    }
                    log('🎛️ [Render] Preset OK (' + Math.round(size / 1024) + ' KB): ' + presetNative);
                } catch (eP) {
                    log('⚠️ [Render] No puc validar el preset: ' + eP.message, 'WARN');
                }

                log(`📤 Destí: ${outputDir}\\${fileName}`);

                // (2026-09-18) Render DIRECTE des de Premiere amb el motor d'Adobe
                // (exportAsMediaDirect, tipus "Vulcan") → NO obra AME. És síncrona: Premiere
                // queda ocupat mentre exporta.
                // (2026-09-18) Render DIRECTE des de Premiere via `exportAsMediaDirect`
                // (motor d'Adobe, tipus "Vulcan"). NO hi ha fallback a AME: si falla,
                // s'informa i s'atura (per petició de l'usuari).
                getUtils().status('Renderitzant des de Premiere…', 'procesando');
                const rDir = await callJSX(`Render.renderDirect('${presetPath}', '${getUtils().escape(outputDir)}', '${getUtils().escape(fileName)}')`);
                log('🎬 [Render] directe → ' + rDir);

                if (rDir && String(rDir).indexOf('OK') === 0) {
                    getUtils().status(`OK: ${fileName}`, 'exito');
                    log('✅ [Render] Exportat directament des de Premiere (sense AME): ' + fileName, 'INFO');
                    FASTPASS_UI.State.lastRenderName = fileName.replace('.mp4', '');
                } else {
                    getUtils().status('Render directe fallit: ' + rDir, 'error');
                    throw new Error('Render directe fallit: ' + rDir);
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
                // 1. BUSCAR LA PORTADA RECENT (Logic.Scan)
                // La data de treball es passa explícitament perquè Scan.portades
                // filtri els PNG per la data del projecte actual (no només mtime).
                const stateDateDir = state.dateDir || getUtils().getFormattedDate().replace(/["\s]/g, "").trim();
                const ctx = { config, progData: state.progData, bloque: state.bloque, dateDir: stateDateDir };
                const portadas = await getScanner().portadas(ctx);
                const portada = (portadas && portadas.length > 0) ? portadas[0] : null;
                
                if (!portada) {
                    throw new Error("No s'ha trobat cap PNG de portada que coincideixi amb el Programa i el Bloc.");
                }

                log(`🔍 Portada trobada: ${portada.name}`);

                // 2. IMPORTAR PORTADA AL PROJECTE (Literal)
                const importPayload = JSON.stringify([portada.path.replace(/\\/g, '\\\\')]);
                await callJSX(`IO.importFiles('${importPayload}', 'root')`);

                // 3. AÏLLAMENT DE PISTES (Solo V1 + V10)
                log("🔒 Aïllant pistes per la captura...");
                await callJSX(`Tracks.setGlobalState('video', 'mute', true)`);
                await callJSX(`Tracks.mute(${T_MP4}, false, 'video')`); // Encenem V1
                await callJSX(`Tracks.mute(${T_PORTADA}, false, 'video')`); // Encenem V10

                // 4. INSERIR PORTADA AL TIMELINE (En el cabezal)
                const ctiRaw = await callJSX('Timeline.get()');
                const cti = parseFloat(ctiRaw || "0");
                
                log(`📌 Inserint ${portada.name} a V${T_PORTADA}`);
                await callJSX(`Clips.insert('${getUtils().escape(portada.name)}', ${T_PORTADA}, ${cti}, null, 'video')`);

                // 5. EXPORTACIÓ FRAME (Snapshot a carpeta destino Portades)
                const targetDir = config.rutas.portadas || config.rutas.destinoBase || "C:\\Temp";
                let nameBase = state.lastRenderName || (await callJSX('Context.activeSeq()')) || "Portada_TBD";
                const destPath = `${targetDir}\\${nameBase}.png`;

                log(`📸 Generant Snapshot a: ${destPath}`);
                const snapRes = await getRenderLogic().capture(destPath, cti);

                // 6. NETEJA I RESTAURACIÓ
                log("🧹 Netejant clip temporal i restaurant pistes...");
                
                // Borrar l'últim clip de V10 (el que acabem de posar)
                const clipsCount = await callJSX(`Clips.count(${T_PORTADA}, 'video')`);
                if (parseInt(clipsCount) > 0) {
                    await callJSX(`Clips.remove(${T_PORTADA}, ${parseInt(clipsCount) - 1}, 'video')`);
                }

                // Restaurar visibilitat totes pistes
                await callJSX(`Tracks.setGlobalState('video', 'mute', false)`);

                if (snapRes.success) {
                    getUtils().status("Portada OK", "exito");
                    log("✅ Portada generada amb èxit.");
                } else {
                    throw new Error("Error Snapshot: " + snapRes.log);
                }

            } catch (e) { getUtils().handleError(e, "RenderPortadaPro"); }
        },

        runClose: async function () {
            getUtils().log("🔘 Botó CLOSE clicat", "INFO");
            getUtils().log("🔍 isJsxReady: " + getUtils().isJsxReady, "DEBUG");
            if (!getUtils().isJsxReady) {
                getUtils().log("⚠️ JSX no preparat. Espera...", "INFO");
                return;
            }
            getUtils().log("🔒 Tancant projecte...", "INFO");
            try {
                await FASTPASS_UI.Logic.Project.close();
                getUtils().status("Projecte tancat i lock eliminat", "exito");
            } catch (e) {
                getUtils().handleError(e, "RenderClose");
            }
            // Netejar l'editor de subtítols (timeline + waveform) en tancar el projecte:
            // sense projecte obert no té sentit que es puguin seguir editant.
            try {
                if (window.SrtEditor && typeof window.SrtEditor.reset === 'function') {
                    window.SrtEditor.reset();
                }
            } catch (e2) {
                getUtils().log("⚠️ Error netejant editor SRT: " + e2.message, "WARN");
            }
        }
    };

    window.FASTPASS_UI.Workflows.Render = FASTPASS_UI.Workflows.Render;
})();