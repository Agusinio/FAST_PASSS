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
        TN_VESPRE:    "PRO1442"
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
        // (Config.programStartHours: TNC 13:50, TNM 14:30, TNV 21:00) i, si no es pot
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
            if (isFinite(startH)) {
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
            try {
                // La crida es fa via JSX (curl no esta disponible des del navegador)
                // Utilitzem un helper custom a JSX per executar la request HTTP
                rawResult = await window.FASTPASS_UI.Utils.callJSX(
                    "FASTPASS.IO.curl('" + url.replace(/'/g, "\\'") + "', '" + API_AUTH.replace(/'/g, "\\'") + "')",
                    { rawError: true }
                );
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
                    var safeFolderPath = (folderPath + '/' + filename).replace(/\\/g, '/').replace(/'/g, "\\'");

                    await window.FASTPASS_UI.Utils.callJSX(
                        "IO.writeTxt('" + safeFolderPath + "', '" + rawResult.replace(/'/g, "\\'") + "')"
                    );

                    log('\u2705 [ER:Fetch] JSON guardat: ' + safeFolderPath);
                    return { path: safeFolderPath, filename: filename };
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