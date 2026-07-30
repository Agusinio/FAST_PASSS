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
        var horaEscaped = hora.replace(/:/g, '%3A');
        return API_BASE + escaletaId + '/_clips?data=' + data +
            '&hora=' + horaEscaped +
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
        if (!escaletaId) {
            log('\u26A0\uFE0F [ER:Fetch] No es pot determinar escaletaId per a ' + programArchivo, 'ERROR');
            return null;
        }

        var dataStr = dateDir.replace(/_/g, '-'); // "2026_07_30" -> "2026-07-30"

        // Hora: usar mediaStart del cleanFeed del JSON mes recent, o default
        var horaStr = "14:00:00";
        try {
            var reader = window.FASTPASS_UI.EscaletaReader;
            if (reader && reader.findLatest && reader.load) {
                var meta = await reader.findLatest(programArchivo, blockId);
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

        var url = this._buildFetchUrl(escaletaId, dataStr, horaStr);
        log('\uD83D\uDCE1 [ER:Fetch] Cridant API: ' + url);

        try {
            // La crida es fa via JSX (curl no esta disponible des del navegador)
            // Utilitzem un helper custom a JSX per executar la request HTTP
            var timestamp = Date.now();
            var rawResult = await window.FASTPASS_UI.Utils.callJSX(
                "FASTPASS.IO.curl('" + url.replace(/'/g, "\\'") + "', '" + API_AUTH.replace(/'/g, "\\'") + "')"
            );

            if (!rawResult || rawResult === '' || rawResult.indexOf('ERR') === 0) {
                log('\u274C [ER:Fetch] Error a la crida API: ' + rawResult);
                return null;
            }

            // Guardar el resultat JSON al directori del projecte
            var filename = 'escaleta_on_demand_' + timestamp + '.json';
            var safeFolderPath = (folderPath + '/' + filename).replace(/\\/g, '/').replace(/'/g, "\\'");

            await window.FASTPASS_UI.Utils.callJSX(
                "IO.writeTxt('" + safeFolderPath + "', '" + rawResult.replace(/'/g, "\\'") + "')"
            );

            log('\u2705 [ER:Fetch] JSON guardat: ' + safeFolderPath);
            return { path: safeFolderPath, filename: filename };

        } catch (e) {
            log('\u274C [ER:Fetch] Error: ' + e.message);
            return null;
        }
    };

    // ----------------------------------------------------------------
    // Registre al namespace
    // ----------------------------------------------------------------
    FASTPASS_UI.EscaletaReader = ER;
    window.FASTPASS_UI = FASTPASS_UI;

    log('[ER:Fetch] Sub-modul inicialitzat (fetchNewEscaleta)');
})();