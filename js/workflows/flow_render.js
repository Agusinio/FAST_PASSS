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

    // ── PORTADA (2026-09-18) ─────────────────────────────────────────────────
    // Durada (s) dels clips temporals que es fan servir a la zona neta.
    const PORTADA_DUR = 2;
    // Marge (s) més enllà del final del projecte on es fa tota la composició.
    const CLEAN_MARGIN = 30;
    // Escala forçada de la portada en % (null = mantenir la que aplica Premiere).
    const PORTADA_SCALE = null;

    /**
     * buildRenderName: Nom del fitxer de render (amb extensió) a partir del nom de la
     * seqüència activa. FONT ÚNICA del nom: el MP4 (runVideo) i el PNG de la portada
     * (runPortada) surten amb el MATEIX nom i la MATEIXA hora.
     * @param {string} seqName - Nom de la seqüència activa (ex: "TNC_V1_TEMA").
     * @returns {string} ex: "TNC_TEMA_13_15.mp4"
     */
    function buildRenderName(seqName) {
        if (!seqName) return "Export_TBD.mp4";
        // El nom de la seqüència pot ser PROG_BLOC_TEMA o PROG_TEMA. ABANS es feia
        // sempre split("_") + slice(2) → amb "TNC_AFECTACIONS METRO..." (2 parts) no
        // hi havia TEMA i sortia el literal "TEMA". Ara: 3+ parts → tema = tot menys
        // PROG i BLOC; 2 parts → tema = la 2a. Fallback: títol del projecte/net.
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
        return `${prog}_${tema}_${timeStr}.mp4`;
    }

    /**
     * clipIndexAt: Índex del clip d'una pista que conté un temps determinat.
     * @returns {number} índex (0-based) o -1
     */
    async function clipIndexAt(trackIdx, atSec) {
        try {
            const raw = await callJSX(`Clips.at(${trackIdx}, ${atSec}, 'video')`);
            if (!raw || raw === "null") return -1;
            const o = JSON.parse(raw);
            return (o && typeof o.index === 'number') ? o.index : -1;
        } catch (e) { return -1; }
    }

    /**
     * pickCopyTrack: Pista on copiar el clip del cabezal. Ha de ser desbloquejada,
     * diferent de la de la portada, i NO pot tenir cap clip a partir de `fromSec`:
     * Clips.duplicate fa overwriteClip del MEDIA SENCER (fromSec → fromSec + durada
     * del media) i machacaria tot el que trobés en aquell tram.
     * @returns {number} pista (1-based) o 0 si no n'hi ha cap de segura.
     */
    function pickCopyTrack(info, fromSec, portadaTrack) {
        for (let i = info.tracks.length - 1; i >= 0; i--) {
            const t = info.tracks[i];
            if ((i + 1) === portadaTrack || t.locked) continue;
            let maxEnd = 0;
            (t.clips || []).forEach(function (c) { if (c.end > maxEnd) maxEnd = c.end; });
            if (maxEnd <= fromSec + 0.05) return i + 1;
        }
        return 0;
    }

    /**
     * pngSize: Mides (px) d'un PNG llegint la capçalera IHDR amb el `fs` de Node.
     * Només s'usa per al log de diagnòstic de la portada.
     * @returns {{w:number,h:number}|null}
     */
    function pngSize(path) {
        try {
            const fs = getUtils()._nodeFs();
            if (!fs || !fs.readFileSync) return null;
            const buf = fs.readFileSync(String(path).replace(/\//g, "\\"));
            if (!buf || buf.length < 24) return null;
            if (buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4E || buf[3] !== 0x47) return null;
            const w = buf.readUInt32BE(16);
            const h = buf.readUInt32BE(20);
            return (w > 0 && h > 0) ? { w: w, h: h } : null;
        } catch (e) { return null; }
    }

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
                // Font ÚNICA del nom (buildRenderName): el PNG de la portada (runPortada)
                // surt amb el mateix nom i la mateixa hora que aquest MP4.
                const fileName = buildRenderName(seqName);

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
         * runPortada: Exporta el PNG de la PORTADA (PNG TEMA-TITOL) compost amb el
         * frame del clip de V1 que hi ha sota el cabezal.
         *
         * MECÀNICA (opció 2, 2026-09-18) — TOT passa en una ZONA NETA situada més
         * enllà del final del projecte, per no tocar MAI el muntatge real:
         *   1. CTI = Timeline.get() → clip de V1 que el conté (frame = mediaIn).
         *   2. Còpia d'aquest clip a la zona neta (Clips.duplicate; si no hi ha cap
         *      pista segura, Clips.insertClipFrom) amb l'inPoint alineat al cabezal.
         *   3. La PRIMERA portada del tema (Scan.portadas) DAMUNT de la còpia, centrada.
         *   4. Cabezal a la zona neta i captura amb Render.snapshot (exportFrameQE:
         *      el mateix mecanisme del freeze que ja funciona).
         *   5. Neteja: s'esborren NOMÉS la còpia i la portada (per TEMPS) i el cabezal
         *      torna on era. No es toca cap mute/lock de cap pista.
         *   6. El PNG va a la MATEIXA carpeta que el MP4 i amb EXACTAMENT el mateix nom
         *      (inclosa l'hora): PROG_TEMA_13_15.mp4 → PROG_TEMA_13_15.png
         */
        runPortada: async function () {
            if (!(await getUtils().validateActiveSequence())) return;
            log("📸 [Portada] Inici (còpia a zona neta + captura de frame)...");

            const utils = getUtils();
            const T_V1 = 1;
            let cti = 0;
            let tempTC = 0;
            let tCopy = 0;
            let tPort = 0;
            
            try {
                const config = FASTPASS_UI.Config.get();
                const state = FASTPASS_UI.State;

                // ── 1. CTI → clip de V1 que el conté ─────────────────────────────
                cti = parseFloat((await callJSX('Timeline.get()')) || "0");
                const srcRaw = await callJSX(`Clips.at(${T_V1}, ${cti}, 'video')`);
                if (!srcRaw || srcRaw === "null") {
                    throw new Error(`No hi ha cap clip a V${T_V1} sota el cabezal (${cti.toFixed(2)}s).`);
                }
                const src = JSON.parse(srcRaw);
                // Frame EXACTE que es veu sota el cabezal = inPoint + desplaçament.
                const mediaIn = parseFloat(src.inPoint) + (cti - parseFloat(src.start));
                log(`🎯 [Portada] CTI=${cti.toFixed(2)}s → V1[${src.index}] "${src.name}" (${parseFloat(src.start).toFixed(2)}→${parseFloat(src.end).toFixed(2)}s) | frame del cabezal = media ${mediaIn.toFixed(2)}s`);

                // ── 2. PORTADA: la PRIMERA del tema ──────────────────────────────
                // La data de treball es passa explícitament perquè Scan.portades
                // filtri els PNG per la data del projecte actual (no només mtime).
                const stateDateDir = state.dateDir || utils.getFormattedDate().replace(/["\s]/g, "").trim();
                const ctx = { config, progData: state.progData, bloque: state.bloque, dateDir: stateDateDir };
                const portadas = await getScanner().portadas(ctx);
                const portada = (portadas && portadas.length > 0) ? portadas[0] : null;
                
                if (!portada) {
                    throw new Error("No s'ha trobat cap PNG de portada que coincideixi amb el Programa i el Bloc.");
                }
                const sz = pngSize(portada.path);
                log(`🖼️ [Portada] Portada del tema: ${portada.name}${sz ? ' (' + sz.w + 'x' + sz.h + ' px)' : ''}`);

                // ── 3. ZONA NETA: més enllà del final de TOT el projecte ─────────
                const vRaw = await callJSX(`Clips.debugTracks('video')`);
                let info = null;
                try { info = JSON.parse(vRaw); } catch (eV) { }
                if (!info || !info.tracks || !info.tracks.length) {
                    throw new Error("No puc llegir les pistes de vídeo (" + vRaw + ").");
                }
                const nVT = info.tracks.length;
                if (nVT < 2) throw new Error("Calen com a mínim 2 pistes de vídeo (còpia + portada).");

                let maxEnd = parseFloat((await callJSX('Timeline.duration()')) || "0");
                info.tracks.forEach(function (t) {
                    (t.clips || []).forEach(function (c) { if (c.end > maxEnd) maxEnd = c.end; });
                });
                tempTC = Math.ceil(maxEnd) + CLEAN_MARGIN;

                // La portada, sempre a la pista de MÉS AMUNT (per sobre de la còpia).
                for (let i = nVT - 1; i >= 0; i--) {
                    if (!info.tracks[i].locked) { tPort = i + 1; break; }
                }
                if (!tPort) throw new Error("Totes les pistes de vídeo estan bloquejades.");

                const safe = pickCopyTrack(info, parseFloat(src.start), tPort);
                tCopy = safe || (tPort > 1 ? tPort - 1 : 0);
                if (!tCopy) throw new Error("No hi ha cap pista lliure per la còpia del clip.");
                log(`🧹 [Portada] Zona neta @ ${tempTC}s (final projecte=${maxEnd.toFixed(2)}s) | portada=V${tPort} | còpia=V${tCopy}${safe ? '' : ' (sense pista segura → insertClipFrom)'}`);

                // ── 4. CÒPIA del clip de V1 a la zona neta ───────────────────────
                let idxCopy = -1;
                if (safe) {
                    // Clips.duplicate fa overwriteClip del MEDIA SENCER a la pista destí:
                    // només és segur perquè pickCopyTrack garanteix que aquella pista no
                    // té cap clip des de l'inici del clip font cap endavant.
                    const dup = await callJSX(`Clips.duplicate(${T_V1}, ${src.index}, ${tCopy}, 'video', 0)`);
                    log(`🧬 [Portada] Clips.duplicate V1[${src.index}] → V${tCopy} → ${dup}`);
                    await utils.delay(300);
                    if (String(dup).indexOf('OK') === 0) idxCopy = parseInt(String(dup).split(':')[1]);
                    if (isNaN(idxCopy) || idxCopy < 0) throw new Error("La còpia del clip ha fallat: " + dup);
                    // Blindatge: l'índex es re-resol pel TEMPS (immune a reindexacions).
                    const idxT = await clipIndexAt(tCopy, parseFloat(src.start));
                    if (idxT >= 0) idxCopy = idxT;
                } else {
                    // Ripple insert: més enllà del final del projecte no desplaça res.
                    const ins = await callJSX(`Clips.insertClipFrom(${T_V1}, ${src.index}, ${tCopy}, ${tempTC}, 'video')`);
                    log(`🧬 [Portada] Clips.insertClipFrom V1[${src.index}] → V${tCopy} @ ${tempTC}s → ${ins}`);
                    await utils.delay(300);
                    if (String(ins).indexOf('OK') !== 0) throw new Error("La còpia del clip ha fallat: " + ins);
                    idxCopy = await clipIndexAt(tCopy, tempTC);
                    if (idxCopy < 0) throw new Error(`No trobo la còpia a V${tCopy} @ ${tempTC}s.`);
                }

                // inPoint ABANS de tancar la durada: Premiere ignora el setter d'inPoint
                // en el MATEIX evalScript que la inserció → cal una crida pròpia.
                await callJSX(`Clips.inPoint(${tCopy}, ${idxCopy}, ${mediaIn}, 'video')`);
                const mv = await callJSX(`Clips.moveToRange(${tCopy}, ${idxCopy}, ${tempTC}, ${tempTC + PORTADA_DUR}, 'video')`);
                log(`📐 [Portada] Còpia a la zona neta: ${mv}`);
                log(`   · còpia V${tCopy}[${idxCopy}] → ${await callJSX(`Clips.get(${tCopy}, ${idxCopy}, 'video')`)}`);

                // ── 5. PORTADA DAMUNT de la còpia, CENTRADA ──────────────────────
                const look = await callJSX(`IO.lookFor('${utils.escape(JSON.stringify([portada.name]))}')`);
                if (String(look) !== "true") {
                    const payload = JSON.stringify([portada.path.replace(/\\/g, '/')]);
                    log(`📥 [Portada] Import al projecte → ${await callJSX(`IO.importFiles('${utils.escape(payload)}', 'root')`)}`);
                }
                const insP = await callJSX(`Clips.insert('${utils.escape(portada.name)}', ${tPort}, ${tempTC}, ${tempTC + PORTADA_DUR}, 'video')`);
                if (String(insP).indexOf('OK') !== 0) throw new Error("No s'ha pogut inserir la portada: " + insP);
                // El JSX aplica l'endSec al DARRER clip de la pista → reforcem per TEMPS.
                await callJSX(`Clips.endAt(${tPort}, ${tempTC}, ${tempTC + PORTADA_DUR}, 'video')`);
                const idxPort = await clipIndexAt(tPort, tempTC);
                if (idxPort < 0) throw new Error(`No trobo la portada a V${tPort} @ ${tempTC}s.`);

                // Centrat: Posició (0,0) = centre exacte del frame; l'escala es manté (la
                // que aplica Premiere en importar la imatge) tret que PORTADA_SCALE estigui
                // fixada a dalt del fitxer.
                let sc = PORTADA_SCALE;
                if (sc == null) {
                    const cur = await callJSX(`Anim.getMotionValues(${tPort}, ${idxPort})`);
                    try {
                        const o = JSON.parse(cur);
                        if (o && typeof o.scale === 'number' && o.scale > 0) sc = o.scale;
                    } catch (eS) { log("⚠️ [Portada] Escala il·legible (" + cur + ")", "WARN"); }
                }
                if (sc == null) sc = 100;
                const mvJson = JSON.stringify({ position: [0, 0], scale: sc }).replace(/'/g, "\\'");
                log(`🎯 [Portada] Centrat V${tPort}[${idxPort}]: Posició (0,0) + Scale ${sc}% → ${await callJSX(`Anim.setMotionValues(${tPort}, ${idxPort}, '${mvJson}')`)}`);

                // ── 6. CABEZAL + CAPTURA (mateix mecanisme que el freeze) ────────
                // La captura ha de caure EXACTAMENT a tempTC: és l'únic instant en què
                // la còpia mostra el frame del cabezal (mediaIn).
                await callJSX(`Timeline.set(${tempTC})`);
                await utils.delay(500);

                // Destí: la MATEIXA carpeta que el MP4 i amb EXACTAMENT el mateix nom.
                let outDir = await callJSX("Context.folder()");
                if (!outDir) outDir = config.rutas.destinoBase || "C:\\Temp";
                if (!state.lastRenderName) {
                    log("⚠️ [Portada] Encara no s'ha exportat el vídeo: el PNG es nomenarà amb l'hora actual.", "WARN");
                }
                const nameBase = state.lastRenderName || buildRenderName(await callJSX('Context.activeSeq()')).replace(/\.mp4$/i, "");
                const destPath = `${outDir}\\${nameBase}.png`;
                utils.ensureFolders(outDir);
                log(`📸 [Portada] Captura a ${destPath} (t=${tempTC}s)`);

                const snapRes = await getRenderLogic().capture(destPath, tempTC);
                if (!snapRes.success) throw new Error("Error Snapshot: " + snapRes.log);
                utils.status(`Portada OK: ${nameBase}.png`, "exito");
                log(`✅ [Portada] PNG generat: ${destPath}`);

            } catch (e) {
                getUtils().handleError(e, "RenderPortada");
            } finally {
                // ── NETEJA: només el que hem inserit (per TEMPS, immune a reindexar) ──
                try {
                    if (tempTC > 0 && tCopy > 0 && tPort > 0) {
                        const rC = await callJSX(`Clips.removeAt(${tCopy}, ${tempTC}, 'video')`);
                        const rP = await callJSX(`Clips.removeAt(${tPort}, ${tempTC}, 'video')`);
                        log(`🧹 [Portada] Neteja de la zona neta: còpia V${tCopy} → ${rC} | portada V${tPort} → ${rP}`);
                    }
                    await callJSX(`Timeline.set(${cti})`);
                } catch (eC) {
                    log("⚠️ [Portada] Neteja: " + eC.message, "WARN");
                }
            }
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