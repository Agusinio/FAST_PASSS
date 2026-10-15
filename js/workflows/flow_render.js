/**
 * ============================================================================
 * WORKFLOW: RENDER (EXPORTACIÓ) - v2.9.5 Tactical
 * ============================================================================
 * 📤 PUBLICACIÓ (2026-10-09): el vídeo es renderitza UNA sola vegada I DIRECTAMENT a la
 *    carpeta de publicació EXPORTS PROVISIONALS (public.ad-ccrtv.local = `rutas.render1`);
 *    després es COPIA a 608-1080 (svftpccma = `rutas.render2`). El PNG de portada s'escriu
 *    a AAA_PORTADES (`rutas.portadas`: …\VERTICALITZACIO_INFORMATIUS\AAA_PORTADES) amb el nom
 *    EXACTE del render de la sessió (`State.lastRenderName`, el desa `runVideo` en
 *    exportar). (2026-10-15 · BUG #163: es reverteix el canvi del 14/10 · BUG #160, que
 *    l'escrivia a la carpeta del projecte.) Vegeu `_publishVideo` i `runPortada`.
 * ============================================================================
 */

(function () {
    var FASTPASS_UI = window.FASTPASS_UI || {};
    FASTPASS_UI.Workflows = FASTPASS_UI.Workflows || {};

    const getUtils = () => window.FASTPASS_UI.Utils;
    const getScanner = () => window.FASTPASS_UI.Logic.Scan;

    const log = (m, lvl) => getUtils().log(m, lvl || "DEBUG");
    const callJSX = (s, o) => getUtils().callJSX(s, o);

    // ── PORTADA (2026-09-18) ─────────────────────────────────────────────────
    // Durada (s) dels clips temporals que es fan servir a la zona neta.
    const PORTADA_DUR = 2;
    // 🛡️ (2026-10-14 · BUG #160) PRE-ROLL (s) de la finestra de captura: la còpia
    // comença ABANS del frame del cabezal, perquè la captura no caigui mai al PRIMER
    // frame del clip (el borde és ambigu: el redondeig de Premiere pot deixar la
    // captura fora del clip → NEGRE). 0.08 s = 2 frames a 25 fps.
    const PORTADA_GUARD = 0.08;
    // Tolerància d'un frame a 25 fps (verificacions de marge).
    const FRAME_TOL = 0.04;
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
     * waitFile: Espera que un fitxer existeixi (cep.fs.stat). `stat` NO retorna `.size`
     * en aquest equip, així que aquí només es comprova l'existència; la mida es valida
     * llegint el fitxer.
     * @returns {Promise<boolean>}
     */
    async function waitFile(path, tries) {
        for (let i = 0; i < (tries || 20); i++) {
            const st = window.cep.fs.stat(path);
            if (st && st.err === 0) return true;
            await getUtils().delay(100);
        }
        return false;
    }

    /**
     * pickVideoBase: Nom base (sense extensió) del VÍDEO de referència de la CARPETA DE
     * PUBLICACIÓ (2026-10-09: abans era la del projecte), perquè el PNG surti amb la
     * MATEIXA hora que el vídeo ja exportat.
     * Prioritat: noms amb el prefix PROG_TEMA_ → el MÉS RECENT (el nom acaba en _HH_MM
     * i ordenat desc dóna la darrera hora del dia).
     * @param {Array} files - Llista de la carpeta ({name, created, mtime})
     * @param {string} prefix - "PROG_TEMA_" del nom que tocaria ara
     * @returns {string|null} nom sense extensió o null
     */
    function pickVideoBase(files, prefix) {
        if (!files || !files.length) return null;
        const mp4s = files.filter(function (f) { return /\.mp4$/i.test(f.name || ''); });
        if (!mp4s.length) return null;
        const same = prefix
            ? mp4s.filter(function (f) { return (f.name || '').toUpperCase().indexOf(prefix) === 0; })
            : [];
        const list = same.length ? same : mp4s;
        list.sort(function (a, b) {
            const na = String(a.name || '').toUpperCase();
            const nb = String(b.name || '').toUpperCase();
            if (na !== nb) return nb.localeCompare(na);
            return (b.created || 0) - (a.created || 0);
        });
        return String(list[0].name).replace(/\.mp4$/i, '');
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
         * MP4: Renderitza la seqüència activa amb el preset vertical (render DIRECTE de
         * Premiere, sense AME) DIRECTAMENT a la carpeta de publicació (2026-10-09,
         * `rutas.render1` = EXPORTS PROVISIONALS) i tot seguit en COPIA una a
         * `rutas.render2` (608-1080). Un sol render; la resta són còpies de fitxer.
         */
        runVideo: async function () {
            if (!(await getUtils().validateActiveSequence())) return;
            log("🚀 Preparant enviament a AME...");
            const config = FASTPASS_UI.Config.get();

            try {
                // ── DESTÍ DEL RENDER (2026-10-09) ────────────────────────────────
                // El MP4 s'exporta DIRECTAMENT a la carpeta de publicació
                // (`rutas.render1` = EXPORTS PROVISIONALS del NAS public.ad-ccrtv.local).
                // Ordre: 1) rutas.render1 · 2) carpeta del projecte · 3) workFolder.
                // (Abans l'exportació es feia a la carpeta del projecte i després es
                // copiava; ara ja no cal el viatge d'anada.)
                let outputDir = String((config.rutas && config.rutas.render1) || '').trim();
                if (outputDir) {
                    log('📤 [Render] Destí del render = carpeta de publicació (rutas.render1): ' + outputDir);
                } else {
                    outputDir = await callJSX("Context.folder()");
                    if (!outputDir) outputDir = getUtils().workFolder(window.FASTPASS_UI.State) || config.rutas.destinoBase || "C:\\Temp";
                    log('⚠️ [Render] Sense rutas.render1 a la config → es renderitza a: ' + outputDir, 'WARN');
                }
                // Ruta NATIVA (\\) i ARBRE DE CARPETES creat ABANS d'exportar (UNC Path
                // Safety: Premiere és fràgil amb rutes de xarxa que no existeixen).
                outputDir = String(outputDir).replace(/\//g, '\\').replace(/\\+$/, '');
                try { getUtils().ensureFolders(outputDir); } catch (eF) {
                    log('⚠️ [Render] ensureFolders(' + outputDir + '): ' + eF.message, 'WARN');
                }
                
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

                // ── (2026-09-21) EXPORTACIÓ = "EL QUE QUEDA" (decisió d'usuari en directe) ──
                // L'exportació directa de Premiere NO accepta cap rang (ignora IN/OUT) i no es
                // vol fer servir AME. Per tant, ABANS d'exportar es RETALLA el timeline a l'OUT
                // de la seqüència: s'ajusten (endAt) o s'eliminen tots els clips que hi ha més
                // enllà de l'OUT, a totes les pistes, i s'exporta el que queda.
                let outSec = 0, rngSrc = '';
                try {
                    const rngRaw = await callJSX('Render.exportRange()');
                    const rng = (rngRaw && String(rngRaw).indexOf('{') === 0) ? JSON.parse(rngRaw) : null;
                    if (rng && rng.outSec > 0.1) { outSec = rng.outSec; rngSrc = rng.src + (rng.mode === 2 ? ' (àrea de treball)' : ''); }
                } catch (eRng) { }
                if (!(outSec > 0.1)) {
                    // Fallback: el punt OUT de la seqüència (Timeline.getOut)
                    try { outSec = parseFloat(await callJSX('Timeline.getOut()') || '0') || 0; rngSrc = 'OUT de la seqüència'; } catch (eO) { }
                }
                if (outSec > 0.1) {
                    log(`✂️ [Render] Retall a ${outSec.toFixed(2)}s (${rngSrc})`);
                    getUtils().status('Retallant el timeline a l\'OUT…', 'procesando');
                    const tr = await this._trimTailAtOut(outSec);
                    log(`✂️ [Render] Timeline retallat a l'OUT (${outSec.toFixed(2)}s): ${tr.trimmed} clip(s) ajustat(s), ${tr.removed} eliminat(s) · ${tr.tracks} pista/es tocades`);
                } else {
                    log('⚠️ [Render] La seqüència no té OUT ni àrea de treball: s\'exporta el timeline tal com està', 'WARN');
                }

                getUtils().status('Renderitzant des de Premiere…', 'procesando');
                const rDir = await callJSX(`Render.renderDirect('${presetPath}', '${getUtils().escape(outputDir)}', '${getUtils().escape(fileName)}')`);
                log('🎬 [Render] directe → ' + rDir);

                if (rDir && String(rDir).indexOf('OK') === 0) {
                    getUtils().status(`OK: ${fileName}`, 'exito');
                    log(`✅ [Render] Exportat${outSec > 0.1 ? ' (retallat a ' + outSec.toFixed(2) + 's)' : ''}: ${fileName}`, 'INFO');
                    // ── NOM DEL RENDER: FONT ÚNICA I GARANTIDA (2026-10-09) ──────────
                    // runPortada (PNG de portada) NO pot deduir el nom de la carpeta del
                    // projecte perquè el render ja no hi viu: aquí es desa el nom EXACTE
                    // (amb la seva hora) i la ruta del MP4 publicat, i el PNG s'hi agafa.
                    FASTPASS_UI.State.lastRenderName = String(fileName).replace(/\.mp4$/i, '');
                    FASTPASS_UI.State.lastRenderMp4 = outputDir + '\\' + fileName;
                    // ── PUBLICACIÓ (2026-10-09): 1 render + CÒPIES ───────────────────
                    // El MP4 S'HA renderitzat directament a EXPORTS PROVISIONALS; aquí
                    // només es COPIA als altres destins (608-1080). `_publishVideo` omet
                    // el destí que coincideix amb la carpeta d'origen → mai re-copia ni
                    // re-renderitza, i tots els destins queden amb el MATEIX fitxer.
                    // Una còpia que falli NO tomba el render.
                    const pub = await this._publishVideo(outputDir, fileName, config);
                    if (pub.ok > 0) {
                        getUtils().status(`${fileName} → ${pub.ok} destí/ns publicat(s)${pub.copied ? ' · ' + pub.copied + ' còpia/es' : ''}`, 'exito');
                    }
                } else {
                    getUtils().status('Render fallit: ' + rDir, 'error');
                    throw new Error('Render fallit: ' + rDir);
                }

            } catch (e) { getUtils().handleError(e, "RenderVideo"); }
        },

        /**
         * _copyFile: Copia un fitxer (src → dest) amb el millor mecanisme disponible.
         *
         * (2026-10-09) Els MP4 de sortida fan centenars de MB: Node `fs.copyFileSync`
         * (capa Brain, mateix criteri que `utils.deleteFolder`) és l'única via que no
         * travessa el pont ExtendScript ni carrega el fitxer a la memòria ES3. Si Node
         * no està disponible, es recorre a l'àtom JSX existent `IO.copyFile` (File.copy).
         *
         * @param {string} src - Ruta completa d'origen
         * @param {string} dest - Ruta completa de destí (amb nom de fitxer)
         * @returns {Promise<string>} "OK" o "ERR:..."
         */
        _copyFile: async function (src, dest) {
            const fs = getUtils()._nodeFs();
            if (fs && typeof fs.copyFileSync === 'function') {
                try {
                    fs.copyFileSync(String(src).replace(/\//g, '\\'), String(dest).replace(/\//g, '\\'));
                    return 'OK';
                } catch (eN) {
                    log(`⚠️ [Render] Node copyFileSync ha fallat (${eN.message}) → provo via JSX`, 'WARN');
                }
            }
            try {
                return await callJSX(`IO.copyFile('${getUtils().escape(src)}', '${getUtils().escape(dest)}')`);
            } catch (eJ) { return 'ERR: ' + eJ.message; }
        },

        /**
         * _publishVideo: PUBLICA el MP4 ja renderitzat a les carpetes de PUBLICACIÓ.
         *
         * (2026-10-09 · revisat) El vídeo es renderitza UNA sola vegada I DIRECTAMENT a
         * `config.rutas.render1` (EXPORTS PROVISIONALS del NAS public.ad-ccrtv.local), que
         * per tant és la carpeta D'ORIGEN: aquest mètode la reconeix i NO la torna a
         * copiar (el fitxer ja hi és). Els altres destins — `config.rutas.render2`
         * (608-1080 del svftpccma) — es fan PER CÒPIA. MAI es torna a renderitzar.
         * Àtoms: `utils.ensureFolders` (crea l'arbre UNC abans de copiar) + `_copyFile`.
         *
         * @param {string} srcDir - Carpeta on s'ha renderitzat el MP4 (= rutas.render1)
         * @param {string} fileName - Nom del MP4 (amb extensió)
         * @param {Object} config - Config.get()
         * @returns {Promise<{ok:number, copied:number, inPlace:number, fail:number, details:string[]}>}
         */
        _publishVideo: async function (srcDir, fileName, config) {
            const res = { ok: 0, copied: 0, inPlace: 0, fail: 0, details: [] };
            const rutas = (config && config.rutas) ? config.rutas : {};
            const dests = [
                { label: 'PUB1 · EXPORTS PROVISIONALS', dir: rutas.render1 },
                { label: 'PUB2 · 608-1080',             dir: rutas.render2 }
            ];
            const norm = (p) => String(p || '').replace(/\//g, '\\').replace(/\\+$/, '');
            const srcFolder = norm(srcDir);
            const src = srcFolder + '\\' + fileName;
            for (let i = 0; i < dests.length; i++) {
                const d = dests[i];
                if (!d.dir) {
                    log(`⚠️ [Render] ${d.label}: sense ruta a la config → s'omet`, 'WARN');
                    continue;
                }
                const dir = norm(d.dir);
                // El render JA ha sortit en aquesta carpeta (és el destí de l'exportació):
                // no hi ha res a copiar. Es compta com a destí OK (publicat de fet).
                if (dir.toUpperCase() === srcFolder.toUpperCase()) {
                    res.inPlace++; res.ok++;
                    res.details.push(d.label + ' (origen del render)');
                    log(`📤 [Render] ${d.label} · ja hi és (carpeta d'origen del render, sense còpia): ${src}`);
                    continue;
                }
                const dest = dir + '\\' + fileName;
                // La carpeta del NAS ha d'existir ABANS de copiar: Premiere és fràgil amb UNC.
                try { getUtils().ensureFolders(dir); } catch (eF) { }
                const r = await this._copyFile(src, dest);
                if (r === 'OK') {
                    res.ok++; res.copied++; res.details.push(d.label + ' OK');
                    log(`📤 [Render] ${d.label} · copiat: ${dest}`);
                } else {
                    res.fail++; res.details.push(d.label + ' ' + r);
                    log(`❌ [Render] ${d.label} · NO copiat (${r}): ${dest}`, 'ERROR');
                }
            }
            if (res.ok === 0) {
                log(`⚠️ [Render] El MP4 NO s'ha publicat a cap destí (${res.details.join(' | ')})`, 'WARN');
            }
            return res;
        },

        /**
         * _resolvePortadaName: Decideix el NOM BASE (sense extensió) del PNG de portada.
         *
         * (2026-10-09) El render va DIRECTAMENT a la carpeta de publicació, així que el nom
         * del PNG NO es pot deduir de la carpeta del projecte (hi hauria 0 MP4). Ordre:
         *   1) `lastRenderName` (State, el nom EXACTE del render d'aquesta sessió) si el seu
         *      prefix coincideix amb la seqüència activa.
         *   2) MP4 més recent de la carpeta de publicació amb el mateix prefix
         *      (`pickVideoBase`; cas de panell recarregat, que buida State).
         *   3) `refBase` (buildRenderName amb l'hora actual) — última xarxa.
         * ⚠️ La carpeta de publicació és COMPARTIDA (tots els programes i temes): només
         * s'accepta un MP4 amb el MATEIX prefix PROG_TEMA_ i, si n'hi ha d'avui, només els
         * d'avui. Un MP4 d'un altre tema o d'un altre dia donaria al PNG un nom que no
         * correspon al vídeo que s'acaba d'exportar.
         * Mètode PUR (sense I/O ni JSX) per poder-se testejar fora de Premiere.
         *
         * @param {string} lastRenderName - State.lastRenderName ('' si no n'hi ha)
         * @param {string} refPrefix - "PROG_TEMA_" de la seqüència activa (majúscules)
         * @param {string} refBase - Nom amb l'hora actual (sense extensió)
         * @param {Array|null} files - Llistat de la carpeta de publicació (o null)
         * @returns {{name:string, src:'sessio'|'publicacio'|'hora'}}
         */
        _resolvePortadaName: function (lastRenderName, refPrefix, refBase, files) {
            const lastBase = String(lastRenderName || "");
            if (lastBase && (!refPrefix || lastBase.toUpperCase().indexOf(refPrefix) === 0)) {
                return { name: lastBase, src: 'sessio' };
            }
            const now = new Date();
            const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
            const all = (files || []).filter(function (f) {
                return refPrefix ? (f.name || '').toUpperCase().indexOf(refPrefix) === 0 : true;
            });
            const today = all.filter(function (f) { return (f.created || f.mtime || 0) >= midnight; });
            const fromFolder = pickVideoBase(today.length ? today : all, null);
            if (fromFolder) return { name: fromFolder, src: 'publicacio' };
            return { name: refBase, src: 'hora' };
        },

        /**
         * _snapAudio: FOTO dels clips d'àudio de la seqüència activa, en clau
         * "pista1based|nom|start" (start amb 2 decimals, com el retorna el JSX).
         * Serveix per detectar, a la neteja del flux Portada, els clips d'àudio que
         * APAREIXEN durant el flux: l'insert amb ripple de la còpia deixa un clip orfe en
         * un TC que decideix Premiere (no el demanat) → comparar per temps no serveix.
         * Composició d'àtoms JSX existents (`Clips.debugTracks`; l'índex de pista és 0-based).
         * @returns {Promise<Set<string>|null>} null si no s'ha pogut llegir (aleshores la
         *          neteja només aplica la regla d'orfes per nom + posició).
         */
        _snapAudio: async function () {
            try {
                const info = JSON.parse(await callJSX(`Clips.debugTracks('audio')`));
                const set = new Set();
                ((info && info.tracks) || []).forEach(function (t) {
                    const a = (parseInt(t.index, 10) || 0) + 1;
                    (t.clips || []).forEach(function (c) {
                        set.add(a + '|' + String(c.name || '') + '|' + (Number(c.start) || 0).toFixed(2));
                    });
                });
                return set;
            } catch (e) {
                log("⚠️ [Portada] No puc fotografiar l'àudio: " + e.message, "WARN");
                return null;
            }
        },

        /**
         * _trimTailAtOut: Retalla el timeline a l'OUT de la seqüència.
         *
         * Elimina (o ajusta amb endAt) TOTS els clips de TOTES les pistes (vídeo, àudio i
         * subtítols) que passen de l'OUT. Així l'exportació directa de Premiere —que no
         * accepta cap rang— exporta exactament "el que queda" ✔.
         *
         * Composició d'àtoms JSX existents (Tracks.count, Clips.count/get/remove/endAt):
         * zero JSX nou.
         *
         * @param {number} outSec - OUT de la seqüència en segons
         * @returns {Promise<{trimmed:number, removed:number, tracks:number}>}
         */
        _trimTailAtOut: async function (outSec) {
            const res = { trimmed: 0, removed: 0, tracks: 0 };
            // (2026-09-21) NOMÉS vídeo i àudio. La pista de SUBTÍTOLS ja ve cortada d'origen
            // (no s'ha de tocar).
            const kinds = ['video', 'audio'];
            for (const kind of kinds) {
                let nTracks = 0;
                try { nTracks = parseInt(await callJSX(`Tracks.count('${kind}')`) || '0', 10) || 0; } catch (eT) { continue; }
                for (let t = 1; t <= nTracks; t++) {
                    let n = 0;
                    try { n = parseInt(await callJSX(`Clips.count(${t}, '${kind}')`) || '0', 10) || 0; } catch (eC) { continue; }
                    if (n === 0) continue;
                    let did = false;
                    // De dalt a baix: en eliminar clips, els índexs es renumeren.
                    for (let i = n - 1; i >= 0; i--) {
                        let clip = null;
                        try {
                            const raw = await callJSX(`Clips.get(${t}, ${i}, '${kind}')`);
                            if (raw && raw !== 'null') clip = JSON.parse(raw);
                        } catch (eG) { continue; }
                        if (!clip) continue;
                        const label = `${kind.toUpperCase()}${t}[${i}] "${String(clip.name || '').substring(0, 40)}"`;
                        if (clip.start >= outSec - 0.02) {
                            const r = await callJSX(`Clips.remove(${t}, ${i}, '${kind}')`);
                            res.removed++; did = true;
                            log(`      ✂️ ${label} (${clip.start.toFixed(2)}→${clip.end.toFixed(2)}s) ELIMINAT (tot ell després de l'OUT) [${r}]`);
                        } else if (clip.end > outSec + 0.02) {
                            const r = await callJSX(`Clips.endAt(${t}, ${clip.start.toFixed(4)}, ${outSec.toFixed(4)}, '${kind}')`);
                            res.trimmed++; did = true;
                            log(`      ✂️ ${label} (${clip.start.toFixed(2)}→${clip.end.toFixed(2)}s) RETALLAT a ${outSec.toFixed(2)}s [${r}]`);
                        }
                    }
                    if (did) res.tracks++;
                }
            }
            return res;
        },

        /**
         * runPortada: Exporta el PNG de la PORTADA (PNG TEMA-TITOL) compost amb el
         * frame del clip de V1 que hi ha sota el cabezal.
         *
         * MECÀNICA (opció 2, 2026-09-18) — TOT passa en una ZONA NETA situada més
         * enllà del final del projecte, per no tocar MAI el muntatge real:
         *   1. CTI = Timeline.get() → clip de V1 que el conté (frame = mediaIn).
         *   2. Còpia d'aquest clip a la ZONA NETA de la MATEIXA V1 amb
         *      Clips.insertClipFrom (ripple: més enllà del final del projecte no desplaça
         *      res; NO s'usa Clips.duplicate perquè fa overwriteClip al START del clip
         *      font i machacaria la V1 real) i l'inPoint alineat al cabezal.
         *   2b. MOTION de l'original copiat a la còpia (posició, escala i retalls) amb
         *      Anim.get/setMotionValues: insertClip crea una INSTÀNCIA NOVA des de
         *      l'ítem i el Motion del clip de pista NO s'hereta. Sense això la captura
         *      NO és el frame que es veu a la timeline (IPD 144% + pos offsets, DF
         *      amb retalls…) i el PNG queda sobre una foto diferent.
         *   3. La PRIMERA portada del tema (Scan.portadas) a V2, damunt de la còpia i
         *      centrada.
         *   4. Cabezal a la zona neta i captura amb `Render.snapshot` (QE `exportFramePNG`,
         *      el mecanisme que funciona · 2026-10-06) i `Render.frame` com a reserva.
         *      🛡️ (2026-10-14 · BUG #160) La captura NO es fa mai al PRIMER frame del clip
         *      (el borde és ambigu: si el redondeig de Premiere mou el clip mig frame, el
         *      frame capturat pot quedar FORA → NEGRE). Es monta amb un PRE-ROLL de GUARD
         *      segons, i el TC de captura es CALCULA amb els valors REALS del clip llegits
         *      després de `moveToRange` (`start` + (`mediaIn` − `inPoint`)) i es verifica
         *      que cau DINS del clip amb marge; si no, es fa servir el 1r frame vàlid.
         *   5. Neteja: s'esborren NOMÉS la còpia i la portada (per TEMPS, amb els starts
         *      REALS llegits) i el cabezal torna on era. No es toca cap mute/lock.
         *   6. El PNG va a AAA_PORTADES (`rutas.portadas`:
         *      \\public.ad-ccrtv.local\Public\VERTICALITZACIO_INFORMATIUS\AAA_PORTADES) amb
         *      EXACTAMENT el mateix nom que el MP4 (inclosa l'hora):
         *      PROG_TEMA_13_15.mp4 → PROG_TEMA_13_15.png.
         *      (2026-10-15 · BUG #163: revertit el canvi del 14/10 · BUG #160, que l'escrivia
         *      a la carpeta del projecte.)
         *      ⚠️ El nom JA NO es dedueix del MP4 de la carpeta del projecte (allà no hi ha
         *      res: el render va DIRECTE a la carpeta de publicació). Es pren de
         *      `State.lastRenderName`, que `runVideo` hi deixa en exportar; si el panell
         *      s'ha recarregat, es busca el MP4 més recent de la carpeta de publicació; i
         *      com a última xarxa, l'hora actual.
         */
        runPortada: async function () {
            if (!(await getUtils().validateActiveSequence())) return;
            log("📸 [Portada] Inici (còpia a zona neta + captura de frame)...");

            const utils = getUtils();
            const T_V1 = 1;
            let cti = 0;
            let tempTC = 0;
            let tPort = 0;
            // 🛡️ (2026-10-14) TC REAL on es captura el frame (mai el primer del clip) i
            // starts REALS dels clips temporals (per a la neteja per TEMPS).
            let tcCap = 0;
            let copyStart = null;
            let portStart = null;
            // Out point original de la seqüència, si l'hem hagut d'ampliar per capturar.
            let outRestore = null;
            // 🛡️ (2026-10-15 · BUG #162) Nom del clip font, final del projecte i FOTO de
            // l'àudio ABANS d'inserir res: l'insert amb ripple de la còpia (insertClipFrom)
            // deixa un clip d'àudio ORFE (sense link, amb el MEDIA SENCER) en un TC que
            // decideix Premiere (vist: 2 s ABANS del punt d'inserció) → la neteja per temps
            // (cleanTC/tempTC) el falla i l'orfà queda a la seqüència. Amb la foto prèvia, a
            // la neteja s'esborra tot clip d'àudio (pista+nom+start) que NO hi era.
            let srcName = "";
            let maxEnd = 0;
            let audioBefore = null;
            
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
                srcName = String(src.name || "");
                const srcStartSec = parseFloat(src.start);
                const srcEndSec   = parseFloat(src.end);
                const srcInSec    = parseFloat(src.inPoint);
                if (!isFinite(srcInSec) || !isFinite(srcStartSec)) {
                    throw new Error(`No puc llegir el clip de V${T_V1} (inPoint=${src.inPoint}, start=${src.start}).`);
                }
                // Frame EXACTE que es veu sota el cabezal = inPoint + desplaçament.
                // ⚠️ Mai pot ser NaN: un NaN arribaria a Clips.inPoint → clip buit → NEGRE.
                let mediaIn = srcInSec + (cti - srcStartSec);
                // 🛡️ (2026-10-14) Si el cabezal és a menys de PORTADA_DUR del FINAL del media
                // font, la còpia no tindria prou material (Premiere la clamparia → NEGRE).
                // Es retrocedeix dins del clip font per garantir-hi contingut.
                if (isFinite(srcEndSec)) {
                    const mediaEnd = srcInSec + (srcEndSec - srcStartSec);
                    const need = PORTADA_DUR + PORTADA_GUARD;
                    if (mediaIn > mediaEnd - need) {
                        const safeIn = Math.max(srcInSec, mediaEnd - need);
                        log(`⚠️ [Portada] Cabezal a ${(mediaEnd - mediaIn).toFixed(2)}s del final del media (calen ${need.toFixed(2)}s) → capturo a media ${safeIn.toFixed(2)}s enlloc de ${mediaIn.toFixed(2)}s`, "WARN");
                        mediaIn = safeIn;
                    }
                }
                log(`🎯 [Portada] CTI=${cti.toFixed(2)}s → V1[${src.index}] "${src.name}" (${srcStartSec.toFixed(2)}→${srcEndSec.toFixed(2)}s) | frame del cabezal = media ${mediaIn.toFixed(2)}s`);

                // ── 1b. MOTION DE L'ORIGINAL (es llegeix ABANS de tocar res) ──────
                // `Clips.insertClipFrom` fa targetTrack.insertClip(projectItem) → crea una
                // INSTÀNCIA NOVA des de l'ÍTEM DEL PROJECTE, i Premiere li aplica el Motion
                // PER DEFECTE (centrat, escala 100, sense retalls): el Motion viu a la
                // instància de PISTA, no a l'ítem, i per tant NO s'hereta. Sense això la
                // captura sortia amb un frame diferent del que es veu a la timeline
                // (IPD 144% + pos [-94.5, 562] px, retalls de la DF…).
                // Es llegeix ARA perquè el CTI encara és al cabezal → valor del frame exacte
                // que es vol capturar; s'aplica a la còpia a 4b. Els àtoms get/set treballen
                // en les mateixes unitats (get torna PÍXELS i set els normalitza ell mateix).
                let srcMotion = null;
                try {
                    const mvSrc = await callJSX(`Anim.getMotionValues(${T_V1}, ${src.index})`);
                    if (mvSrc && String(mvSrc).indexOf('ERR') !== 0) {
                        srcMotion = JSON.parse(mvSrc);
                        log(`🎯 [Portada] Motion de l'ORIGINAL V${T_V1}[${src.index}]: ${mvSrc}`);
                    } else {
                        log(`⚠️ [Portada] Motion de l'original no llegible (${mvSrc}) → la còpia quedarà amb el Motion per defecte`, "WARN");
                    }
                } catch (eMv) {
                    log(`⚠️ [Portada] Llegint el Motion de l'original: ${eMv.message}`, "WARN");
                }

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

                maxEnd = parseFloat((await callJSX('Timeline.duration()')) || "0");
                info.tracks.forEach(function (t) {
                    (t.clips || []).forEach(function (c) { if (c.end > maxEnd) maxEnd = c.end; });
                });
                tempTC = Math.ceil(maxEnd) + CLEAN_MARGIN;
                // 🛡️ (2026-10-14) Finestra de captura amb PRE-ROLL: el clip comença
                // PORTADA_GUARD s ABANS de tempTC → el frame del cabezal (mediaIn) NO és
                // mai el PRIMER frame del clip (el borde és ambigu i pot sortir NEGRE).
                const tStart = tempTC - PORTADA_GUARD;
                const tEnd   = tStart + PORTADA_DUR;

                // La còpia va a la MATEIXA V1 (zona neta) i la portada a V2, damunt seu.
                const T_PORT = (config.tracks && config.tracks.video && config.tracks.video.fondos) || 2;
                log(`🧹 [Portada] Zona neta @ ${tempTC}s (final projecte=${maxEnd.toFixed(2)}s) | finestra ${tStart.toFixed(2)}→${tEnd.toFixed(2)}s | còpia a V${T_V1} | portada a V${T_PORT} (${nVT} pistes de vídeo)`);

                // 🛡️ (2026-10-15 · BUG #162) FOTO de l'àudio ABANS d'inserir la còpia: el
                // ripple insert deixa un clip d'àudio orfe en un TC impredictible, així que
                // la neteja es fa per DIFERÈNCIA contra aquesta foto (no per temps).
                audioBefore = await this._snapAudio();
                log(`🧾 [Portada] Àudio abans d'inserir: ${audioBefore ? audioBefore.size + ' clips' : 'NO llegible (només regla d\'orfes)'}`);

                // ── 4. CÒPIA del clip de V1 a la zona neta (a la MATEIXA V1) ─────
                // S'usa insertClipFrom (ripple): com que tempTC és més enllà del final de
                // TOT el projecte, el ripple NO desplaça cap clip. NO s'usa Clips.duplicate
                // perquè fa overwriteClip al START del clip font (media sencer) i
                // machacaria la V1 real.
                const ins = await callJSX(`Clips.insertClipFrom(${T_V1}, ${src.index}, ${T_V1}, ${tempTC}, 'video')`);
                log(`🧬 [Portada] Clips.insertClipFrom V1[${src.index}] → V1 @ ${tempTC}s → ${ins}`);
                if (String(ins).indexOf('OK') !== 0) throw new Error("La còpia del clip a V1 ha fallat: " + ins);
                await utils.delay(300);
                const idxCopy = await clipIndexAt(T_V1, tempTC);
                if (idxCopy < 0) throw new Error(`No trobo la còpia a V${T_V1} @ ${tempTC}s.`);

                // inPoint ABANS de tancar la durada: Premiere ignora el setter d'inPoint
                // en el MATEIX evalScript que la inserció → cal una crida pròpia.
                // 🛡️ (2026-10-14) PRE-ROLL: l'inPoint va PORTADA_GUARD s ABANS del frame
                // del cabezal, perquè aquest no caigui al primer frame del clip.
                const copyIn = Math.max(0, mediaIn - PORTADA_GUARD);
                await callJSX(`Clips.inPoint(${T_V1}, ${idxCopy}, ${copyIn}, 'video')`);
                const mv = await callJSX(`Clips.moveToRange(${T_V1}, ${idxCopy}, ${tStart}, ${tEnd}, 'video')`);
                log(`📐 [Portada] Còpia a la zona neta (${tStart.toFixed(2)}→${tEnd.toFixed(2)}s · inPoint ${copyIn.toFixed(2)}s): ${mv}`);
                if (String(mv).indexOf('OK') !== 0) {
                    log(`⚠️ [Portada] El moveToRange de la còpia no ha quadrat (${mv}) · es fan servir els temps REALS del clip`, "WARN");
                }

                // ── 4a. VERIFICACIÓ + TC DE CAPTURA AMB ELS VALORS REALS (2026-10-14) ──
                // Premiere redondeja start/end a frame: els valors reals poden diferir dels
                // demanats. El frame del cabezal (mediaIn) és a la timeline a:
                //     start_real + (mediaIn − inPoint_real)
                // Es verifica que aquest TC cau DINS del clip amb ≥1 frame de marge a cada
                // banda; si no, es captura el primer frame vàlid (mai un frame buit → NEGRE).
                let copyData = null;
                try { copyData = JSON.parse(await callJSX(`Clips.get(${T_V1}, ${idxCopy}, 'video')`)); } catch (eCpy) { }
                if (!copyData) throw new Error(`No puc llegir la còpia de V${T_V1} (índex ${idxCopy}) → captura insegura.`);
                copyStart = parseFloat(copyData.start);
                const copyEndSec = parseFloat(copyData.end);
                const copyInReal = isFinite(parseFloat(copyData.inPoint)) ? parseFloat(copyData.inPoint) : copyIn;
                log(`   · còpia V${T_V1}[${idxCopy}] start=${copyStart}s end=${copyEndSec}s in=${copyInReal}s out=${copyData.outPoint}s`);
                if (!isFinite(copyStart) || !isFinite(copyEndSec) || (copyEndSec - copyStart) <= FRAME_TOL) {
                    throw new Error(`La còpia de V${T_V1} ha quedat buida (${copyStart}s→${copyEndSec}s) · capturar-hi donaria NEGRE.`);
                }
                tcCap = copyStart + (mediaIn - copyInReal);
                if (!isFinite(tcCap) || tcCap <= copyStart + FRAME_TOL - 1e-6 || tcCap >= copyEndSec - FRAME_TOL + 1e-6) {
                    const safeCap = Math.min(copyStart + FRAME_TOL, copyEndSec - FRAME_TOL);
                    log(`⚠️ [Portada] El frame del cabezal (${isFinite(tcCap) ? tcCap.toFixed(2) : tcCap}s) no cau DINS de la còpia (${copyStart.toFixed(2)}→${copyEndSec.toFixed(2)}s) → capturo el 1r frame vàlid ${safeCap.toFixed(2)}s`, "WARN");
                    tcCap = safeCap;
                }
                log(`🎯 [Portada] Captura a ${tcCap.toFixed(2)}s (còpia ${copyStart.toFixed(2)}→${copyEndSec.toFixed(2)}s · inPoint real ${copyInReal.toFixed(2)}s · frame cabezal = media ${mediaIn.toFixed(2)}s)`);

                // ── 4b. HERETAR EL MOTION: posició + escala (+ retalls) = ORIGINAL ──
                // La còpia s'ha de veure EXACTAMENT com el clip original; si no, el PNG es
                // compon sobre un frame que no és el de la timeline. Només s'envien les
                // claus que el JSX ha pogut llegir (les null s'ometen i no es toquen).
                if (srcMotion) {
                    const vals = {};
                    ['position', 'scale', 'scaleWidth', 'cropLeft', 'cropTop', 'cropRight', 'cropBottom']
                        .forEach(function (k) {
                            if (srcMotion[k] !== null && srcMotion[k] !== undefined) vals[k] = srcMotion[k];
                        });
                    try {
                        const mvRes = await callJSX(`Anim.setMotionValues(${T_V1}, ${idxCopy}, '${utils.escape(JSON.stringify(vals))}')`);
                        log(`🎯 [Portada] Motion heretat → còpia V${T_V1}[${idxCopy}]: ${JSON.stringify(vals)} → ${mvRes}`);
                        log(`   · comprovació còpia V${T_V1}[${idxCopy}] → ${await callJSX(`Anim.getMotionValues(${T_V1}, ${idxCopy})`)}`);
                        if (String(mvRes).indexOf('OK') !== 0) {
                            log(`⚠️ [Portada] La còpia NO ha pogut heretar el Motion (${mvRes}) → el frame capturat pot no coincidir amb la timeline`, "WARN");
                        }
                    } catch (eSm) {
                        log(`⚠️ [Portada] Aplicant el Motion a la còpia: ${eSm.message}`, "WARN");
                    }
                } else {
                    log("⚠️ [Portada] Sense Motion de l'original → còpia amb el Motion per defecte", "WARN");
                }

                // ── 5. PORTADA DAMUNT de la còpia, CENTRADA ──────────────────────
                const look = await callJSX(`IO.lookFor('${utils.escape(JSON.stringify([portada.name]))}')`);
                if (String(look) !== "true") {
                    const payload = JSON.stringify([portada.path.replace(/\\/g, '/')]);
                    log(`📥 [Portada] Import al projecte → ${await callJSX(`IO.importFiles('${utils.escape(payload)}', 'root')`)}`);
                }
                // Pista de la portada: V2, damunt de la còpia. Si V2 estigués bloquejada de
                // veritat, es prova la de sobre (la zona neta és buida a totes les pistes).
                let insP = "";
                let insErr = "";
                for (let t = T_PORT; t <= nVT; t++) {
                    insP = await callJSX(`Clips.insert('${utils.escape(portada.name)}', ${t}, ${tStart}, ${tEnd}, 'video')`);
                    if (String(insP).indexOf('OK') === 0) { tPort = t; break; }
                    insErr = insP;
                    // Si l'item no és al projecte, cap pista servirà: no cal seguir provant.
                    if (String(insP).indexOf('ERR_ITEM_NOT_FOUND') === 0) break;
                    log(`⚠️ [Portada] insert a V${t} → ${insP} · es prova la pista de sobre...`, "WARN");
                }
                if (!tPort) throw new Error("No s'ha pogut inserir la portada (1a opció V" + T_PORT + "): " + insErr);
                const idxPort = await clipIndexAt(tPort, tempTC);
                if (idxPort < 0) throw new Error(`No trobo la portada a V${tPort} @ ${tempTC}s.`);
                // 🛡️ (2026-10-14) La portada s'ALINEA al rang REAL de la còpia (mateixos
                // start/end) perquè cobreixi EXACTAMENT el frame que es captura (tcCap).
                const mvP = await callJSX(`Clips.moveToRange(${tPort}, ${idxPort}, ${copyStart}, ${copyEndSec}, 'video')`);
                portStart = copyStart;
                log(`🖼️ [Portada] Alineada a la còpia (${copyStart.toFixed(2)}→${copyEndSec.toFixed(2)}s): ${mvP}`);
                if (String(mvP).indexOf('OK') !== 0) {
                    log(`⚠️ [Portada] El moveToRange de la portada no ha quadrat (${mvP}) · pot no cobrir el frame capturat`, "WARN");
                }

                // Escala de la portada: es conserva la que aplica Premiere en importar la
                // imatge (o PORTADA_SCALE si està fixada) i `Anim.setMotionValues` força
                // a més "Uniform Scale" + "Scale Width".
                const cur = await callJSX(`Anim.getMotionValues(${tPort}, ${idxPort})`);
                let sc = PORTADA_SCALE;
                try {
                    const o = JSON.parse(cur);
                    if (sc == null && o && typeof o.scale === 'number' && o.scale > 0) sc = o.scale;
                } catch (eS) { log("⚠️ [Portada] Motion il·legible (" + cur + ")", "WARN"); }
                if (sc == null) sc = 100;
                const scVia = (PORTADA_SCALE == null) ? 'llegida de la imatge' : 'forçada per PORTADA_SCALE';
                log(`🎯 [Portada] Escala V${tPort}[${idxPort}] = ${sc}% (${scVia}) → ${await callJSX(`Anim.setMotionValues(${tPort}, ${idxPort}, '${JSON.stringify({ scale: sc }).replace(/'/g, "\\'")}')`)}`);

                // ── CENTRAT: Posició crua [0.5, 0.5] ─────────────────────────────
                // ⚠️ Motion → Position és NORMALITZADA (0..1) i 0.5 = CENTRE del frame;
                // (0,0) seria la cantonada superior esquerra (per això sortia descentrat).
                // `Anim.setMotionValues` NO serveix per això: espera PÍXELS i els divideix
                // per la mida del frame, que la capa JS no pot consultar → s'escriu el
                // valor normalitzat EN CRU amb Clips.setProp (l'àtom ja ho preveu per a
                // "ADBE Video Position"). El valor actual es mostra en PÍXELS per poder-lo
                // comparar amb la UI (el centre és frameSize/2).
                const cRes = await callJSX(`Clips.setProp(${tPort}, ${idxPort}, 'AE.ADBE Motion', 'ADBE Video Position', [0.5, 0.5], 'video')`);
                log(`🎯 [Portada] Posició centrada [0.5, 0.5] → ${cRes} | motion=${await callJSX(`Anim.getMotionValues(${tPort}, ${idxPort})`)}`);

                // ── 6. CABEZAL + CAPTURA (mateix mecanisme que el freeze) ────────
                // 🛡️ (2026-10-14) La captura es fa a `tcCap` = TC REAL calculat
                // (start_real + (mediaIn − inPoint_real)), SEMPRE amb ≥1 frame de marge a
                // dins del clip: és l'instant en què la còpia mostra el frame del cabezal
                // sense el risc del borde (que és el que produïa el PNG NEGRE).
                await callJSX(`Timeline.set(${tcCap})`);
                await utils.delay(500);

                // ── 6b. DESTÍ del PNG: AAA_PORTADES (`config.rutas.portadas`) ──
                // 🛡️ (2026-10-15 · BUG #163) El PNG va a la carpeta de PORTADES PUBLICADES
                // (`\\public.ad-ccrtv.local\Public\VERTICALITZACIO_INFORMATIUS\AAA_PORTADES`),
                // com abans del 09/10-2026 — es REVERTEIX el canvi del 14/10 (BUG #160), que
                // l'escrivia a la carpeta del projecte. Ordre de resolució:
                //   1) config.rutas.portadas → AAA_PORTADES (destí normal; es crea si cal).
                //   2) Context.folder() → carpeta del .prproj (NOMÉS si no hi ha config).
                //   3) workFolder(State) → destinoBase → C:\Temp (últim recurs).
                const norm = (p) => String(p || "").replace(/\//g, "\\").replace(/\\+$/, "");
                const projFolder = await callJSX("Context.folder()");
                let outDir = norm((projFolder && String(projFolder).indexOf('ERR') !== 0) ? projFolder : '');
                if (!outDir) {
                    outDir = norm(utils.workFolder(window.FASTPASS_UI.State) || config.rutas.destinoBase || "C:\\Temp");
                    log(`⚠️ [Portada] Context.folder() no vàlid ("${projFolder}") → recurs alternatiu: ${outDir}`, "WARN");
                }
                // 🛡️ DESTÍ = carpeta de portades publicades (AAA_PORTADES).
                const portadesDir = norm(config.rutas && config.rutas.portadas);
                const pngDir = portadesDir || outDir;
                if (!portadesDir) {
                    log(`⚠️ [Portada] Sense "rutas.portadas" a la config → el PNG anirà a la carpeta del projecte (${outDir})`, "WARN");
                }

                // ── 6c. NOM del PNG: FONT GARANTIDA (2026-10-09) ─────────────────
                // ⚠️ El nom NO es pot deduir de la carpeta del projecte: `runVideo` exporta
                // el MP4 DIRECTAMENT a la carpeta de publicació (rutas.render1), o sigui que
                // el nom del PNG s'ASSEGURA així, per ordre de confiança:
                //   1) State.lastRenderName ← nom EXACTE del render d'aquesta sessió (el desa
                //      runVideo en exportar; prefix verificat contra la seqüència activa).
                //   2) MP4 més recent de la CARPETA DE PUBLICACIÓ amb el prefix PROG_TEMA_
                //      (cobreix el cas d'haver recarregat el panell, que buida State).
                //   3) buildRenderName() amb l'hora actual (última xarxa; avisa amb WARN).
                const refBase = buildRenderName(await callJSX('Context.activeSeq()')).replace(/\.mp4$/i, "");
                const refPrefix = refBase.replace(/_\d{2}_\d{2}$/, '_').toUpperCase();
                const lastBase = String(state.lastRenderName || "");
                const lastOk = !!(lastBase && (!refPrefix || lastBase.toUpperCase().indexOf(refPrefix) === 0));
                // Carpeta de publicació = on runVideo hi ha deixat el MP4 (rutas.render1).
                // Només s'hi llegeix si State no porta el nom (cap llistat NAS innecessari).
                const pubDir = norm(config.rutas && config.rutas.render1) || outDir;
                let files = null;
                if (!lastOk) {
                    try { files = await utils.readFolder(pubDir); } catch (eL) { log("⚠️ [Portada] No puc llistar la carpeta: " + eL.message, "WARN"); }
                    if (files === null) log(`⚠️ [Portada] Lectura FALLIDA de ${pubDir} (null ≠ carpeta buida)`, "WARN");
                }
                const pick = this._resolvePortadaName(lastOk ? lastBase : "", refPrefix, refBase, files);
                const nameBase = pick.name;
                if (pick.src === 'sessio') {
                    log(`🎬 [Portada] Nom del PNG: ${nameBase}.png ← render d'aquesta sessió` +
                        (state.lastRenderMp4 ? ` (${state.lastRenderMp4})` : ""));
                } else if (pick.src === 'publicacio') {
                    log(`🎬 [Portada] Nom del PNG: ${nameBase}.png ← MP4 de la carpeta de publicació (${pubDir})`);
                } else {
                    log(`⚠️ [Portada] Cap MP4 de referència a ${pubDir}: el PNG es nomenarà amb l'hora actual (${nameBase})`, "WARN");
                }
                const destPath = `${pngDir}\\${nameBase}.png`;
                utils.ensureFolders(pngDir);
                log(`📸 [Portada] Captura a ${destPath} (t=${tcCap.toFixed(2)}s) | carpeta de portades (AAA_PORTADES) | publicació=${norm(config.rutas && config.rutas.render1)}`);

                // S'escriu DIRECTAMENT al destí final amb QE (com el freeze dels chyrons):
                // exportFrameQE ja crea la carpeta si cal i funciona amb rutes UNC. Evitem
                // el pas per C:\temp + cep.fs.rename (era on es perdia el PNG).
                //
                // El fotograma s'exporta amb un timecode DINS del rang de la seqüència: si
                // l'Out point està fixat i queda ABANS de la zona neta, QE no escriu res.
                // S'amplia temporalment i es restaura al finally.
                const out0 = parseFloat(await callJSX('Timeline.getOut()') || "0");
                // 🛡️ (2026-10-14) L'Out ha de cobrir la FINESTRA SENCERA (tStart→tEnd) amb
                // marge: si l'Out queda abans, QE `exportFramePNG` no escriu res (NEGRE).
                // Després es VERIFICA el valor REAL i s'avisa si no s'ha ampliat.
                const needOut = tEnd + 1;
                if (out0 > 0 && out0 < needOut) {
                    outRestore = out0;
                    const rOut = await callJSX(`Timeline.out(${needOut})`);
                    const realOut = parseFloat(await callJSX('Timeline.getOut()') || "0");
                    log(`📐 [Portada] Out point ampliat temporalment ${out0.toFixed(2)}s → ${needOut}s (${rOut}) · real=${realOut.toFixed(2)}s`);
                    if (!isFinite(realOut) || realOut < needOut - 0.02) {
                        log(`⚠️ [Portada] L'Out point NO s'ha ampliat de veritat (real=${realOut}s < ${needOut}s) · la captura podria sortir NEGRA!`, "WARN");
                    }
                } else {
                    log(`📐 [Portada] Out point = ${out0.toFixed(2)}s · captura a ${tcCap.toFixed(2)}s (finestra ${tStart.toFixed(2)}→${tEnd.toFixed(2)}s)`);
                }

                // (2026-10-06) El mètode que FUNCIONA és `Render.snapshot` = QE exportFramePNG
                // (main.jsx:669 → FASTPASS.Render.exportFrameQE; commit 4327704 «captura de frame
                // (Render.snapshot)»). Rep la ruta SENSE extensió. `Render.frame`
                // (= `seq.exportFrame`) LLANÇA «ERR: seq.exportFrame is not a function» → queda
                // com a segona opció per si algun dia l'API estàndard existeix al DOM.
                // 🛡️ (2026-10-14) VERIFICACIÓ del frame que es captura: hi ha d'haver la
                // còpia a V1 i la portada a la seva pista EXACTAMENT a tcCap (si no, NEGRE).
                const chkCopy = await callJSX(`Clips.at(${T_V1}, ${tcCap}, 'video')`);
                const chkPort = await callJSX(`Clips.at(${tPort}, ${tcCap}, 'video')`);
                log(`🔎 [Portada] Frame ${tcCap.toFixed(2)}s → V${T_V1}: ${chkCopy} | V${tPort}: ${chkPort}`);
                if (!chkCopy || String(chkCopy) === "null") {
                    log(`⚠️ [Portada] NO hi ha còpia a V${T_V1} @ ${tcCap.toFixed(2)}s · el PNG sortirà NEGRE`, "WARN");
                }

                let snapRes = await callJSX(`Render.snapshot('${utils.escape(destPath.replace(/\.png$/i, ''))}', ${tcCap})`, { rawError: true });
                let pngOk = await waitFile(destPath, 20);
                let via = 'QE';
                if (!pngOk) {
                    snapRes = await callJSX(`Render.frame('${utils.escape(destPath)}', ${tcCap})`, { rawError: true });
                    pngOk = await waitFile(destPath, 20);
                    via = 'API';
                }
                log(`📸 [Portada] ${via} → ${snapRes}`);

                // Verificació: el fitxer hi és i no és buit (`cep.fs.stat` no retorna .size
                // en aquest equip → la mida es comprova LLEGINT).
                if (!pngOk) throw new Error(`El PNG no s'ha escrit a ${destPath} (via ${via} → ${snapRes})`);
                const rr = window.cep.fs.readFile(destPath);
                const pngBytes = (rr && rr.err === 0 && rr.data)
                    ? ((typeof rr.data.length === 'number') ? rr.data.length : (rr.data.byteLength || 0))
                    : -1;
                if (pngBytes <= 0) throw new Error("El PNG existeix però no es pot llegir (" + destPath + ", err=" + (rr && rr.err) + ")");
                utils.status(`Portada OK: ${nameBase}.png (${Math.round(pngBytes / 1024)} KB)`, "exito");
                log(`✅ [Portada] PNG generat via ${via}: ${destPath} (${Math.round(pngBytes / 1024)} KB)`);

            } catch (e) {
                getUtils().handleError(e, "RenderPortada");
            } finally {
                // ── NETEJA: només el que hem inserit (vídeo per TEMPS, immune a reindexar;
                // àudio per DIFERÈNCIA + regla d'orfes, vegeu més avall) ──
                try {
                    if (tempTC > 0) {
                        // 🛡️ (2026-10-14) S'esborra amb el START REAL de la còpia: els clips
                        // temporals comencen a `tStart` (pre-roll), NO a tempTC → buscar-los
                        // per tempTC fallaria (removeAt tolera només 0.05 s).
                        const cleanTC = (copyStart !== null && isFinite(copyStart)) ? copyStart : tempTC;
                        const cleanPort = (portStart !== null && isFinite(portStart)) ? portStart : cleanTC;
                        const rC = await callJSX(`Clips.removeAt(${T_V1}, ${cleanTC}, 'video')`);
                        const rP = (tPort > 0) ? await callJSX(`Clips.removeAt(${tPort}, ${cleanPort}, 'video')`) : '—';
                        log(`🧹 [Portada] Neteja de la zona neta (V${T_V1} @ ${cleanTC}s / V${tPort} @ ${cleanPort}s): còpia → ${rC} | portada → ${rP}`);
                        if (String(rC).indexOf('OK') !== 0 || (tPort > 0 && String(rP).indexOf('OK') !== 0)) {
                            log(`⚠️ [Portada] Neteja INCOMPLETA a la zona neta (${cleanTC}s): comprova la seqüència!`, "WARN");
                        }
                        // ÀUDIO ORFE (2026-10-15 · BUG #162): l'insert amb ripple de la còpia
                        // deixa un clip d'àudio ORFE (sense Link) amb el MEDIA SENCER del clip
                        // font, en un TC que decideix Premiere — NO a cleanTC ni a tempTC (vist:
                        // 151.00s per un insert a 153.00s, 2 s ABANS) → el `removeAt` per temps
                        // fallava i l'orfà quedava a A1. Regles (totes idempotents):
                        //   1) DIFERÈNCIA: tot clip d'àudio (pista+nom+start) que NO hi era a la
                        //      foto prèvia a la inserció.
                        //   2) ORFE: clip d'àudio amb el MATEIX nom que el clip font situat MÉS
                        //      ENLLÀ del final del projecte (zona neta) — mata també els orfes que
                        //      hagin quedat de sessions anteriors.
                        // ⚠️ L'àudio del PROGRAMA no es toca mai: els seus clips (mateix nom)
                        // viuen tots DINS del projecte (< maxEnd).
                        try {
                            const rA = [];
                            if (!audioBefore) {
                                // Xarxa sense foto: es proven els DOS temps de sempre.
                                const nAud = parseInt(await callJSX("Tracks.count('audio')") || "0");
                                for (let a = 1; a <= nAud; a++) {
                                    let ra = await callJSX(`Clips.removeAt(${a}, ${cleanTC}, 'audio')`);
                                    if (String(ra).indexOf('OK') !== 0 && Math.abs(cleanTC - tempTC) > 0.01) {
                                        ra += ' / ' + await callJSX(`Clips.removeAt(${a}, ${tempTC}, 'audio')`);
                                    }
                                    if (String(ra).indexOf('OK') === 0) rA.push(`A${a}@${cleanTC}(temps)→${ra}`);
                                }
                            }
                            const after = JSON.parse(await callJSX(`Clips.debugTracks('audio')`));
                            const refName = String(srcName || "").toUpperCase();
                            const deadFrom = maxEnd - FRAME_TOL;
                            for (const t of ((after && after.tracks) || [])) {
                                const a = (parseInt(t.index, 10) || 0) + 1;
                                for (const c of (t.clips || [])) {
                                    const st = Number(c.start) || 0;
                                    const key = a + '|' + String(c.name || '') + '|' + st.toFixed(2);
                                    const nou = audioBefore ? !audioBefore.has(key) : false;
                                    const orfe = (maxEnd > 0) && !!refName &&
                                        (String(c.name || '').toUpperCase() === refName) && (st >= deadFrom);
                                    if (!nou && !orfe) continue;
                                    const rr = await callJSX(`Clips.removeAt(${a}, ${st.toFixed(4)}, 'audio')`);
                                    rA.push(`A${a}@${st.toFixed(2)}(${nou ? 'nou' : 'orfe'})→${rr}`);
                                }
                            }
                            log(`🧹 [Portada] Neteja d'àudio orfe: ${rA.length ? rA.join(' | ') : 'cap'}` +
                                (audioBefore ? '' : " · ⚠️ sense foto prèvia (només regla d'orfes)"));
                            if (rA.some(function (x) { return x.indexOf('OK') < 0; })) {
                                log("⚠️ [Portada] Alguna neteja d'àudio NO ha quallat: comprova la seqüència!", "WARN");
                            }
                        } catch (eAud) {
                            log("⚠️ [Portada] Neteja d'àudio: " + eAud.message, "WARN");
                        }
                    }
                    if (outRestore !== null) {
                        const rb = await callJSX(`Timeline.out(${outRestore})`);
                        log(`📐 [Portada] Out point restaurat a ${outRestore}s → ${rb}`);
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