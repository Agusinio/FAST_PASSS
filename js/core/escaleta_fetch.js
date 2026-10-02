/**
 * ============================================================================
 * FASTPASS_UI.EscaletaReader: Sub-mòdul FETCH
 * ============================================================================
 * Genera una "foto" actualizada de la escaleta via API de digition.
 * No modifica nada en produccio (genera=false, force=false).
 *
 * Depen de: escaleta_config.js (ESCALETES_PATH)
 *           escaleta_io.js (load)
 *           Utils.callJSX
 *
 * Metodes:
 *   - fetchNewEscaleta(programArchivo, escaletaId, dateStr, timeStr, folderPath)
 * ============================================================================
 */

(function () {
    var FASTPASS_UI = window.FASTPASS_UI || {};
    var ER = FASTPASS_UI.EscaletaReader || {};

    var log = function (m) {
        (window.FASTPASS_UI.Utils && window.FASTPASS_UI.Utils.log)
            ? window.FASTPASS_UI.Utils.log(m, 'DEBUG')
            : (window.console && window.console.log(m));
    };

    // ----------------------------------------------------------------
    // CONFIGURACIO DE L'API
    // ----------------------------------------------------------------
    var API_BASE = "https://digition.3cat.cat/digition-api/v2/escaletes/";
    var API_AUTH = "Authorization:eyJhbGciOiJIUzUxMiJ9.eyJkaWciOiJQUk9EVUNDSU8iLCJzdWIiOiJhZ2VudF9vcmNoZXN0ciIsInVpZCI6MTAyMTQsImdpZCI6MTAwMSwiaWF0IjoxNzA2MjYzNTI5LCJleHAiOjQ4NTk4NjM1Mjl9.vIrnCXrQf3CiVAsMeMMcDIkiivKLJ9fz6g2YvsHHvYNlcuR58hZNskYH0xJxQCH0sChzSluaPo3W42vYH0LB_w";

    // Mapa d'escaletaId per programa (fallback si Config no te escaletaId)
    var DEFAULT_ESCALETA_IDS = {
        TN_COMARQUES: "PRO1439",
        TN_MIGDIA:    "PRO1440",
        TN_VESPRE:    "PRO1442",
        // MATINS: digition crea un rundown per dia feiner (DILLUNS..DIVENDRES),
        // aixi que l'ID puja ~1 per dia. Aquest es el darrer conegut (jueves
        // 2026-09-17); si l'API diu "no existeix" es proven els veins (+1/-1/+2)
        // i tambe l'estimat a partir dels 2-3 dies anteriors.
        MATINS:       "PRO1378"
    };

    /**
     * _buildCurlUrl: Construeix la URL del curl.
     * @param {string} escaletaId - Ex: "PRO1440"
     * @param {string} data - data en format YYYY-MM-DD
     * @param {string} hora - hora en format HH:MM:SS
     * @returns {string} URL completa
     */
    ER._buildFetchUrl = function (escaletaId, data, hora) {
        // ⚠️ BUGFIX (2026-09-16): NO s'escapa ':' com a '%3A'. L'URL s'executa dins d'un
        // .bat / cmd.exe, que EXPANDEIX els '%' ('%3A' → 'A' → l'API responia
        // "Format d'hora incorrecte"). Els ':' són vàlids en una query string (RFC 3986).
        return API_BASE + escaletaId + '/_clips?data=' + data +
            '&hora=' + hora +
            '&genera=false&force=false' +
            '&ajustaHoresSegonsEmissionsPlayout=true' +
            '&mostraEscaleta=true';
    };

    // ----------------------------------------------------------------
    // TRANSPORT DE LA PETICIO (2026-10-02)
    // ----------------------------------------------------------------
    // PER QUE: fins ara la resposta viatjava SEMPRE pel pont ExtendScript
    // (FASTPASS.IO.curl), que llegeix la sortida de curl com a ANSI (CP1252).
    // Com que l'API retorna UTF-8, cada accent esdevenia DOS caracters
    // ("O" accentuada -> "A"+cometes, "C" trencada -> "A"+doble daguer) i, en
    // desar-ho, el JSON quedava DOBLEMENT codificat (TNC V1 02/10/2026:
    // "titol":"CRONICA VICTOR..." -> tema "CRANICA VACTOR" al nom del projecte).
    // SOLUCIO: demanar l'escaleta amb child_process de Node + curl.exe i
    // decodificar la sortida com a BYTES -> UTF-8 de debo. El pont ExtendScript
    // queda nomes com a respatller (amb reparacio de mojibake).
    // No s'usa .bat: sense cmd.exe pel mig, els '%' de l'URL no s'expansionen.

    /** _curlExe: ruta de curl.exe (System32) o "curl" del PATH si no hi es. */
    ER._curlExe = function () {
        var abs = 'C:\\Windows\\System32\\curl.exe';
        try {
            var fs = window.FASTPASS_UI.Utils._nodeFs();
            if (fs && fs.existsSync && !fs.existsSync(abs)) return 'curl';
        } catch (e) { }
        return abs;
    };

    /**
     * _execFileBuffer: executa curl amb child_process de Node i retorna la SEVA
     * SORTIDA COM A BYTES (Buffer) des dels quals es deriva el text UTF-8.
     * @param {string} exe
     * @param {Array<string>} args
     * @param {number} timeoutMs
     * @returns {Promise<{ok:boolean, raw?:string, err?:string, ms?:number}>}
     */
    ER._execFileBuffer = function (exe, args, timeoutMs) {
        return new Promise(function (resolve) {
            var cp = window.FASTPASS_UI.Utils._nodeReq('child_process');
            if (!cp || !cp.execFile) { resolve({ ok: false, err: 'Node/child_process no disponible' }); return; }
            var t0 = Date.now(), done = false;
            var finish = function (r) { if (done) return; done = true; r.ms = Date.now() - t0; resolve(r); };
            var timer = setTimeout(function () {
                finish({ ok: false, err: 'temps d\'espera exhaurit (' + Math.round(timeoutMs / 1000) + ' s)' });
            }, timeoutMs + 2000);
            try {
                cp.execFile(exe, args, { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024, windowsHide: true, timeout: timeoutMs },
                    function (err, stdout, stderr) {
                        clearTimeout(timer);
                        var txt = stdout ? stdout.toString('utf8') : '';   // bytes reals -> UTF-8
                        if (txt && txt.length > 2) { finish({ ok: true, raw: txt }); return; }
                        var why = stderr ? stderr.toString('utf8').substring(0, 200) : (err ? String(err.message) : 'resposta buida');
                        finish({ ok: false, err: why });
                    });
            } catch (e) { clearTimeout(timer); finish({ ok: false, err: e.message }); }
        });
    };

    /**
     * _fetchRaw: demana l'escaleta a l'API. 1a via Node+curl (UTF-8 exacte),
     * 2a via FASTPASS.IO.curl (ExtendScript) amb reparacio de mojibake.
     * @param {string} url
     * @param {string} [tag] - escaletaId per al log
     * @returns {Promise<string|null>} text del JSON o null si no hi ha resposta
     */
    ER._fetchRaw = async function (url, tag) {
        var U = window.FASTPASS_UI.Utils;
        var args = ['-s', '--connect-timeout', '15', '--max-time', '60',
            '-X', 'POST', url, '-H', 'accept: application/json', '-H', API_AUTH];
        var res = await this._execFileBuffer(this._curlExe(), args, 65000);
        if (res.ok) {
            log('🛰️ [ER:Fetch] API via Node/curl' + (tag ? ' (' + tag + ')' : '') +
                ': ' + res.ms + ' ms · ' + res.raw.length + ' chars en UTF-8 exacte');
            return res.raw;
        }
        log('⚠️ [ER:Fetch] Via Node/curl no disponible (' + res.err + ') → respatller ExtendScript');
        var rawJsx = null;
        try {
            rawJsx = await U.callJSX(
                "FASTPASS.IO.curl('" + String(url).replace(/'/g, "\\'") + "', '" + API_AUTH.replace(/'/g, "\\'") + "')",
                { rawError: true }
            );
        } catch (eC) { rawJsx = null; }
        var txt = String(rawJsx == null ? '' : rawJsx);
        if (!txt || txt.indexOf('ERR') === 0) {
            log('❌ [ER:Fetch] Respatller ExtendScript sense resposta: ' + (txt || 'buit'), 'ERROR');
            return null;
        }
        return U._fromMojibake(txt, 'API' + (tag ? ' ' + tag : ''));
    };

    /**
     * _writeEscaleta: desa el JSON de l'escaleta SEMPRE des del costat JS
     * (window.cep.fs.writeFile, UTF-8: mateix modul que EscaletaReader.load fa
     * servir per llegir-lo). Passar el text pel pont JSX era el que el malmetia.
     * @param {string} folderPath
     * @param {string} filename
     * @param {string} raw - JSON ja en UTF-8 correcte
     * @returns {string|null} ruta (separadors '/') o null si no s'ha pogut escriure
     */
    ER._writeEscaleta = function (folderPath, filename, raw) {
        var path = String(folderPath || '').replace(/[\/\\]+$/, '') + '/' + filename;
        try {
            var w = window.cep.fs.writeFile(path, raw);
            if (w && w.err === 0) return path;
            log('⚠️ [ER:Fetch] cep.fs.writeFile err=' + (w && w.err));
        } catch (e1) { log('⚠️ [ER:Fetch] cep.fs.writeFile ha fallat: ' + e1.message); }
        var fs = window.FASTPASS_UI.Utils._nodeFs();
        if (fs && fs.writeFileSync) {
            try { fs.writeFileSync(path.replace(/\//g, '\\'), raw, 'utf8'); return path; }
            catch (e2) { log('⚠️ [ER:Fetch] Node fs.writeFileSync ha fallat: ' + e2.message); }
        }
        log('❌ [ER:Fetch] No s\'ha pogut desar ' + filename + ' al projecte', 'ERROR');
        return null;
    };

    /**
     * fetchNewEscaleta: Fa una crida a l'API de digition per obtenir
     * la foto mes recent de l'escaleta i la guarda al directori del projecte.
     *
     * @param {string} escaletaId - Ex: "PRO1440"
     * @param {string} dateDir - Ex: "2026_07_30"
     * @param {string} programArchivo - Ex: "TN_MIGDIA"
     * @param {string} blockId - Ex: "V1"
     * @param {string} folderPath - Ruta on guardar el JSON
     * @returns {Promise<{path: string, filename: string}|null>}
     */
    // ── SERIE D'ESCALETA IDS (2026-09-17) ──────────────────────────────
    // Els rundowns de digition no son fixos: MATINS en crea un per dia feiner
    // (DILLUNS..DIVENDRES), aixi que l'ID puja ~1 per dia i els festius el
    // desplacen. El 17/09/2026 el motor demanava PRO1278 (inexistent) -> el
    // motor publicava {"missatge":"L'escaleta no existeix"}. Solucio: estimar
    // l'ID amb els 2-3 dies anteriors i, si falla, provar veins (+1/-1/+2...).

    /**
     * _escaletaIdParts: Separa prefix i numero d'un escaletaId ("PRO1378").
     */
    ER._escaletaIdParts = function (id) {
        var m = String(id || '').match(/^([A-Za-z]*)(\d+)$/);
        if (!m) return null;
        return { prefix: m[1], num: parseInt(m[2], 10) };
    };

    /**
     * _escaletaIdCandidates: Candidats al voltant d'un ID base (+1/-1/+2/-2...).
     * @param {string} baseId
     * @param {number} [maxPad=3] número de salts per banda
     * @returns {Array<string>}
     */
    ER._escaletaIdCandidates = function (baseId, maxPad) {
        var p = this._escaletaIdParts(baseId);
        if (!p) return [];
        var pad = (maxPad != null) ? maxPad : 3;
        var out = [];
        for (var d = 1; d <= pad; d++) {
            out.push(p.prefix + (p.num + d));
            out.push(p.prefix + (p.num - d));
        }
        return out;
    };

    /**
     * _ymdToDate: "20260917" -> Date local.
     */
    ER._ymdToDate = function (ymd) {
        var s = String(ymd || '');
        if (!/^\d{8}$/.test(s)) return null;
        return new Date(parseInt(s.substring(0, 4), 10), parseInt(s.substring(4, 6), 10) - 1, parseInt(s.substring(6, 8), 10));
    };

    /**
     * _weekdaysBetween: Dies FEINERS entre dues dates YYYYMMDD (cap de setmana fora).
     */
    ER._weekdaysBetween = function (fromYmd, toYmd) {
        var f = this._ymdToDate(fromYmd), t = this._ymdToDate(toYmd);
        if (!f || !t || t <= f) return 0;
        var n = 0, d = new Date(f.getTime());
        while (d < t) {
            d.setDate(d.getDate() + 1);
            var dow = d.getDay();
            if (dow !== 0 && dow !== 6) n++;
        }
        return n;
    };

    /**
     * _estimateEscaletaIdFromHistory: Mira els IDs dels 2-3 dies anteriors
     * (JSON VALIDS del programa al NAS) i estima el d'avui amb el pas per dia
     * feiner. Els festius fan que el pas no sigui exacte, aixi que l'estimacio
     * es nomes el PRIMER candidat: despres es proven els veins.
     * @returns {Promise<{estimate:string, step:number, seen:Array}|null>}
     */
    ER._estimateEscaletaIdFromHistory = async function (programArchivo, dateDir) {
        try {
            if (!this._listEscaletas || !this.load) return null;
            var datePrefix = String(dateDir || '').replace(/_/g, '');   // per excloure avui
            var listRes = await this._listEscaletas();
            if (!listRes || !listRes.raw) return null;
            var files = JSON.parse(listRes.raw);
            var dir = listRes.path || this.ESCALETES_PATH || this.ESCALETES_PATH_DOMAIN || '';
            var token = '_' + String(programArchivo).toUpperCase() + '_';
            var cands = [];
            for (var i = 0; i < files.length; i++) {
                var f = files[i];
                if (!f || f.isDir) continue;
                var nm = String(f.name || '');
                if (nm.toUpperCase().indexOf(token) === -1) continue;
                var d8 = nm.substring(0, 8);
                if (!/^\d{8}$/.test(d8)) continue;
                if (datePrefix && d8 === datePrefix) continue;         // avui no compta
                cands.push({ name: nm, path: dir.replace(/[\/\\]+$/, '') + '\\' + nm, date: d8 });
            }
            if (cands.length === 0) return null;
            cands.sort(function (a, b) { return a.name < b.name ? 1 : (a.name > b.name ? -1 : 0); });  // mes nou primer
            var seen = [];
            for (var c = 0; c < cands.length && seen.length < 3; c++) {
                var data = null;
                try { data = await this.load(cands[c].path); } catch (eL) { data = null; }
                if (!data || !data.escaleta || !data.escaleta.id) continue;   // error del motor o buit
                var pr = this._escaletaIdParts(data.escaleta.id);
                if (!pr) continue;
                seen.push({ date: cands[c].date, id: data.escaleta.id, num: pr.num, prefix: pr.prefix });
            }
            if (seen.length < 2) return null;
            var newest = seen[0], oldest = seen[seen.length - 1];
            var days = this._weekdaysBetween(oldest.date, newest.date);
            var realStep = (days > 0) ? ((newest.num - oldest.num) / days) : 1;
            // Pas de referencia: +1 per dia FEINER (MATINS crea un rundown diari).
            // El pas REAL pot ser mes gran (festius, rundowns extra) -> l'estimacio
            // es nomes UN candidat mes i els veins (+1/-1/+2...) el cobreixen.
            var dToday = this._weekdaysBetween(newest.date, datePrefix);
            if (!(dToday > 0)) dToday = 1;
            var estimateStr = newest.prefix + (newest.num + dToday);
            log('🎯 [ER:Fetch] Serie ' + programArchivo + ': ' +
                seen.map(function (s) { return s.date.substring(4) + '=' + s.id; }).join(' · ') +
                ' | dies feiners des del darrer=' + dToday + ' | pas real≈' + realStep.toFixed(2) +
                ' → estimat avui: ' + estimateStr);
            return { estimate: estimateStr, step: realStep, seen: seen };
        } catch (e) {
            log('⚠️ [ER:Fetch] Estimacio de serie fallida: ' + e.message);
            return null;
        }
    };

    /**
     * _resolveEscaletaId: Troba l'escaletaId correcte per avui PROVANT-LO contra
     * l'API (1 crida per candidat). Ordre: estimat per serie → base de config →
     * veins (+1/-1/+2/-2/+3/-3). Es para al primer candidat que retorna una
     * escaleta valida i en desa el JSON per no haver de repetir la crida.
     * @returns {Promise<{id:string, raw:string}|null>}
     */
    ER._resolveEscaletaId = async function (programArchivo, baseId, dataStr, horaStr) {
        var est = null;
        try { est = await this._estimateEscaletaIdFromHistory(programArchivo, baseId); } catch (e0) { est = null; }
        var list = [];
        var add = function (id) { if (id && list.indexOf(id) === -1) list.push(id); };
        add(baseId);
        if (est && est.estimate) add(est.estimate);
        var cands = this._escaletaIdCandidates(baseId, 3);
        for (var i = 0; i < cands.length; i++) add(cands[i]);
        var maxTry = Math.min(list.length, 3);   // (2026-09-17) 3 en comptes de 5: cada crida pot tardar ~30 s
        log('🔎 [ER:Fetch] Resolent escaletaId (' + programArchivo + ') · candidats: ' + list.slice(0, maxTry).join(', '));
        for (var c = 0; c < maxTry; c++) {
            var id = list[c];
            var url = this._buildFetchUrl(id, dataStr, horaStr);
            var raw = null;
            // (2026-10-02) Node/curl (bytes → UTF-8) amb respatller ExtendScript reparat
            try { raw = await this._fetchRaw(url, id); } catch (eC) { raw = null; }
            var js = null, ok = false;
            try {
                js = JSON.parse(String(raw || '').trim());
                ok = !!(js && !js.missatge && js.escaleta && js.cleanFeed);
            } catch (eP) { ok = false; }
            if (ok) {
                log('✅ [ER:Fetch] escaletaId resolt: ' + id + (c > 0 ? ' (candidat ' + (c + 1) + '/' + maxTry + ')' : ' (base)'));
                return { id: id, raw: String(raw) };
            }
            log('   ⏭️ [ER:Fetch] ' + id + ' → ' + ((js && js.missatge) ? js.missatge : 'resposta no valida'));
        }
        log('❌ [ER:Fetch] Cap escaletaId valid (' + maxTry + ' provats) per a ' + programArchivo);
        return null;
    };

    ER.fetchNewEscaleta = async function (escaletaId, dateDir, programArchivo, blockId, folderPath) {
        if (!escaletaId) {
            escaletaId = DEFAULT_ESCALETA_IDS[programArchivo] || null;
        }
        // Fallback per nom de programa si escaletaId no arriba des de config
        if (!escaletaId) {
            if (programArchivo.indexOf('TN_COMARQUES') !== -1) escaletaId = 'PRO1439';
            else if (programArchivo.indexOf('TN_MIGDIA') !== -1) escaletaId = 'PRO1440';
            else if (programArchivo.indexOf('TN_VESPRE') !== -1) escaletaId = 'PRO1442';
        }
        if (!escaletaId) {
            log('\u26A0\uFE0F [ER:Fetch] No es pot determinar escaletaId per a ' + programArchivo, 'ERROR');
            return null;
        }

        var dataStr = dateDir.replace(/_/g, '-'); // "2026_07_30" -> "2026-07-30"

        // Hora: (1) mediaStart del cleanFeed del JSON més recent del dia,
        // (2) hora d'inici del programa, (3) hora actual. MAI una hora fixa.
        var horaStr = null;
        try {
            var reader = window.FASTPASS_UI.EscaletaReader;
            if (reader && reader.findLatest && reader.load) {
                var datePrefixHora = dateDir ? dateDir.replace(/_/g, '') : null; // mateix dia que la foto
                var meta = await reader.findLatest(programArchivo, blockId, datePrefixHora);
                if (meta) {
                    var jsonData = await reader.load(meta.path);
                    if (jsonData && jsonData.cleanFeed && jsonData.cleanFeed.mediaStart) {
                        // mediaStart te format HH:MM:SS:FF -> extreure HH:MM:SS
                        var parts = jsonData.cleanFeed.mediaStart.split(':');
                        if (parts.length >= 3) {
                            horaStr = parts[0] + ':' + parts[1] + ':' + parts[2];
                        }
                    }
                }
            }
        } catch (e) {
            log('\u26A0\uFE0F [ER:Fetch] Error determinant hora: ' + e.message);
        }

        // ── Hora de la petició (2026-09-16) ─────────────────────────────────────
        // Si no hi ha JSON local del dia, s'usa l'hora d'inici del PROGRAMA
        // (Config.programStartHours: TNC 13:50, TNM 14:30, TNV 21:00, MAT 08:00) i, si no es pot
        // resoldre, l'hora actual. Abans s'enviava "14:00:00" fix, que només servia
        // per a TN COMARQUES i feia fallar la FOTO per a la resta de programes.
        if (!horaStr) {
            var cfgH = null;
            try { cfgH = window.FASTPASS_UI.Config && window.FASTPASS_UI.Config.get(); } catch (eCfgH) { cfgH = null; }
            var wottH = null;
            try {
                if (cfgH && cfgH.mapeoProgramas) {
                    for (var kH in cfgH.mapeoProgramas) {
                        if (cfgH.mapeoProgramas[kH].archivo === programArchivo) { wottH = cfgH.mapeoProgramas[kH].wott; break; }
                    }
                }
            } catch (eWott) { wottH = null; }
            var startH = (cfgH && cfgH.programStartHours && wottH && cfgH.programStartHours[wottH] != null)
                ? Number(cfgH.programStartHours[wottH]) : null;
            // ⚠️ BUGFIX (2026-09-17): `isFinite(null)` es TRUE a JavaScript (null -> 0),
            // aixi que si el programa no te hora d'inici (MAT no era a la llista) es
            // demanava l'escaleta amb hora "00:00:00" i l'API responia buit. Cal
            // comprovar `startH != null` ABANS d'isFinite.
            if (startH != null && isFinite(startH)) {
                var hhH = Math.floor(startH);
                var mmH = Math.round((startH - hhH) * 60);
                horaStr = (hhH < 10 ? '0' : '') + hhH + ':' + (mmH < 10 ? '0' : '') + mmH + ':00';
                log('\u23F0 [ER:Fetch] Hora de la petició: ' + horaStr + ' (inici de programa ' + wottH + ')');
            } else {
                var nowH = new Date();
                horaStr = (nowH.getHours() < 10 ? '0' : '') + nowH.getHours() + ':' +
                    (nowH.getMinutes() < 10 ? '0' : '') + nowH.getMinutes() + ':00';
                log('\u23F0 [ER:Fetch] Hora de la petició: ' + horaStr + ' (hora actual)');
            }
        }

        // ── RESOLUCIO DE L'ESCALETA ID (2026-09-17) ──────────────────────────
        // Els rundowns de digition canvien (MATINS: un per dia feiner). Si el
        // JSON del dia diu "L'escaleta no existeix", es proven candidats de la
        // serie (+1/-1/+2...) fins trobar el bo, i es guarda la SEVA escaleta.
        var probe = null;
        try { probe = await this._resolveEscaletaId(programArchivo, escaletaId, dataStr, horaStr); } catch (ePr) { probe = null; }
        if (probe && probe.raw) {
            try {
                var tsP = Date.now();
                var fnP = 'escaleta_on_demand_' + tsP + '.json';
                // (2026-10-02) Escriptura des de JS (UTF-8), mai pel pont JSX
                var savedP = this._writeEscaleta(folderPath, fnP, probe.raw);
                if (savedP) {
                    log('✅ [ER:Fetch] FOTO guardada amb escaletaId ' + probe.id + ': ' + savedP);
                    return { path: savedP, filename: fnP };
                }
                log('⚠️ [ER:Fetch] No s\'ha pogut guardar la foto resolta (' + probe.id + ')');
            } catch (eWP) {
                log('⚠️ [ER:Fetch] No s\'ha pogut guardar la foto resolta: ' + eWP.message);
            }
        }
        if (probe && probe.id) escaletaId = probe.id;

        var url = this._buildFetchUrl(escaletaId, dataStr, horaStr);

        // ── REINTENTS + MOTIU REAL DE L'API (2026-09-16) ────────────────────
        // L'API de digition triga uns minuts a "localitzar" el cleanFeed del dia:
        // mentre no el té, retorna {"missatge":"Error","debugInfo":"No s'ha
        // localitzat cap clean feed..."}. Abans es feia UN sol intent i, si la API
        // encara no tenia el cleanFeed, la foto fallava en silenci amb un genèric
        // "Resposta buida o no valida": no se sabia per què ni es reintentava.
        // Ara: fins a API_RETRIES intents separats API_RETRY_MS i el missatge REAL
        // de l'API al log i a la UI.
        // Un sol intent: cada intent pot bloquejar el motor JSX fins a ~24 s (el motor
        // és mono-fil) i encadenar-ne dos deixava el panell penjat més d'un minut.
        // Si falla, el motiu queda al log i l'usuari pot tornar a prémer FOTO.
        var API_RETRIES = 1;
        var API_RETRY_MS = 6000;
        var lastReason = 'sense resposta de l\'API';

        for (var att = 1; att <= API_RETRIES; att++) {
            var timestamp = Date.now();
            log('\uD83D\uDCE1 [ER:Fetch] Cridant API (intent ' + att + '/' + API_RETRIES + '): ' + url);

            var rawResult = null;
            // (2026-10-02) Via Node/curl: bytes → UTF-8 exacte (respatller ExtendScript reparat)
            try {
                rawResult = await this._fetchRaw(url);
            } catch (eCurl) {
                rawResult = null;
                lastReason = 'curl: ' + eCurl.message;
            }

            if (!rawResult || rawResult === '' || String(rawResult).indexOf('ERR') === 0) {
                if (!lastReason || lastReason.indexOf('curl:') !== 0) {
                    lastReason = String(rawResult || 'sense resposta de curl');
                }
                log('\u274C [ER:Fetch] Error a la crida API: ' + lastReason, 'ERROR');
            } else {
                // ── Validació de resposta (2026-09-07) ─────────────────────────
                // Si l'API no té emissió per a la data/hora demanada retorna [] o un
                // JSON d'error { missatge }. En aquests casos NO es guarda cap
                // escaleta_on_demand buida que pugui contaminar el directori.
                var trimmedRaw = String(rawResult || '').trim();
                var parsedRaw = null;
                var respuestaValida = false;
                if (trimmedRaw && trimmedRaw !== '[]' && trimmedRaw !== '{}') {
                    try {
                        parsedRaw = JSON.parse(trimmedRaw);
                        respuestaValida = !!(parsedRaw && typeof parsedRaw === 'object' && !Array.isArray(parsedRaw)
                            && !parsedRaw.missatge && parsedRaw.escaleta && parsedRaw.cleanFeed);
                    } catch (ePars) { respuestaValida = false; }
                }

                if (respuestaValida) {
                    // Guardar el resultat JSON al directori del projecte
                    var filename = 'escaleta_on_demand_' + timestamp + '.json';
                    // (2026-10-02) Escriptura des de JS (UTF-8), mai pel pont JSX
                    var savedPath = this._writeEscaleta(folderPath, filename, rawResult);
                    if (savedPath) {
                        log('\u2705 [ER:Fetch] JSON guardat: ' + savedPath);
                        return { path: savedPath, filename: filename };
                    }
                    lastReason = 'no s\'ha pogut desar el JSON al directori del projecte';
                }

                // Motiu REAL de l'API (abans aquesta informació es perdia)
                if (parsedRaw) {
                    lastReason = 'API: ' + (parsedRaw.missatge || 'resposta sense escaleta/cleanFeed') +
                        (parsedRaw.debugInfo ? ' — ' + String(parsedRaw.debugInfo).substring(0, 140) : '');
                } else {
                    lastReason = 'resposta no JSON: ' + trimmedRaw.substring(0, 140);
                }
                log('\u274C [ER:Fetch] Resposta no valida (' + dataStr + ' ' + horaStr + ') intent ' + att + ': ' + lastReason, 'ERROR');
            }

            if (att < API_RETRIES) {
                log('\u23F3 [ER:Fetch] Reintentant en ' + (API_RETRY_MS / 1000) + 's (l\'API tarda uns minuts a localitzar el cleanFeed)...');
                await new Promise(function (r) { setTimeout(r, API_RETRY_MS); });
            }
        }

        // Tots els intents fallits: motiu per a la UI (el log té el detall complet)
        try {
            window.FASTPASS_UI.Utils.status('FOTO: l\'API no té dades del dia (mira el log)', 'error');
        } catch (eSt) { }
        log('\u274C [ER:Fetch] FOTO fallida després de ' + API_RETRIES + ' intents. Motiu: ' + lastReason, 'ERROR');
        return null;
    };

    // ----------------------------------------------------------------
    // Registre al namespace
    // ----------------------------------------------------------------
    FASTPASS_UI.EscaletaReader = ER;
    window.FASTPASS_UI = FASTPASS_UI;

    log('[ER:Fetch] Sub-modul inicialitzat (fetchNewEscaleta)');
})();