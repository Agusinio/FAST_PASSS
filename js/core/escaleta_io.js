/**
 * ============================================================================
 * FASTPASS_UI.EscaletaReader: Sub-mòdul IO
 * ============================================================================
 * Entrada/sortida: descobrir JSONs, llegir des del servidor UNC, cache.
 *
 * Depèn de: escaleta_config.js (ESCALETES_PATH, applyDurationOverrides)
 *           escaleta_timecode.js (tcToSeconds)
 *
 * Mètodes:
 *   - _escapePath(p)
 *   - findLatest(programArchivo)
 *   - getStatus(programArchivo, blockId)
 *   - load(jsonPath, forceReload)
 * ============================================================================
 */

(function () {
    var FASTPASS_UI = window.FASTPASS_UI || {};
    var ER = FASTPASS_UI.EscaletaReader || {};

    var callJSX = function (s) {
        return window.FASTPASS_UI.Utils && window.FASTPASS_UI.Utils.callJSX
            ? window.FASTPASS_UI.Utils.callJSX(s)
            : '';
    };

    var log = function (m) {
        (window.FASTPASS_UI.Utils && window.FASTPASS_UI.Utils.log)
            ? window.FASTPASS_UI.Utils.log(m, 'DEBUG')
            : (window.console && window.console.log(m));
    };

    // ----------------------------------------------------------------
    // 1. HELPER D'ESCAPAMENT DE RUTA
    // ----------------------------------------------------------------

    /**
     * _escapePath: Escapa les barres invertides per a l'ús en callJSX.
     * @param {string} p
     * @returns {string}
     */
    ER._escapePath = function (p) {
        return p.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    };

    // ----------------------------------------------------------------
    // 2. DESCOBRIR EL JSON MÉS RECENT PER PROGRAMA
    // ----------------------------------------------------------------

    /**
     * findLatest: Llista la carpeta d'escaletes i troba el JSON més recent
     * per al programa indicat.
     * @param {string} programArchivo - e.g. "TN_MIGDIA", "TN_COMARQUES"
     * @returns {Promise<{path:string, filename:string}|null>}
     */
    /**
     * extractBlockIdFromFilename: Extreu el blockId (V1, V2, V3, V4) del nom d'un fitxer JSON.
     * Format esperat: PROGRAMA_BLOCKID_... (ex: TN_VESPRE_V1_GF_FOTOS_...)
     * També detecta MATINS_V1, TN_MIGDIA_V2, etc.
     * @param {string} filename
     * @returns {string|null} BlockId (ex: "V1") o null si no es pot extreure
     */
    ER.extractBlockIdFromFilename = function (filename) {
        if (!filename) return null;
        // Patró: després del prefix de programa, V seguit de dígits
        var m = filename.match(/_(V\d+)_/i);
        return m ? m[1].toUpperCase() : null;
    };

    /**
     * findLatest: Llista la carpeta d'escaletes i troba el JSON més recent
     * per al programa indicat.
     * @param {string} programArchivo - e.g. "TN_MIGDIA", "TN_COMARQUES"
     * @param {string} [blockId] - Opcional. ID del bloc ("V1", "V2"...). Si es proporciona,
     *        filtra per {PROGRAMA}_{BLOCK}_* per trobar el JSON específic del bloc.
     * @returns {Promise<{path:string, filename:string}|null>}
     */
    ER.findLatest = async function (programArchivo, blockId) {
        var searchLabel = programArchivo + (blockId ? '/' + blockId : '');
        log('\uD83D\uDCE1 [ER:IO] Cercant JSON per a: ' + searchLabel);
        try {
            var raw = await callJSX("IO.listFolder('" + this._escapePath(this.ESCALETES_PATH) + "')");
            if (!raw || raw === '[]' || raw.indexOf('ERR') === 0) {
                log('\u26A0\uFE0F [ER:IO] No s\'ha pogut llistar: ' + this.ESCALETES_PATH);
                return null;
            }

            var files;
            try {
                files = JSON.parse(raw);
            } catch (e) {
                log('\u26A0\uFE0F [ER:IO] Error parsejant llistat: ' + e.message);
                return null;
            }

            // Construir prefix: si hi ha blockId, busquem {PROG}_{BLOCK}_
            // sinó, busquem {PROG}_ (comportament legacy)
            var prefix = programArchivo.toUpperCase() + '_';
            if (blockId) {
                prefix += blockId.toUpperCase() + '_';
            }
            var candidates = files.filter(function (f) {
                return !f.isDir &&
                    f.name.toUpperCase().indexOf(prefix) === 0 &&
                    f.name.toLowerCase().indexOf('.json') === f.name.length - 5;
            });

            // Si no trobem amb blockId, intentem sense (fallback legacy)
            if (candidates.length === 0 && blockId) {
                log('\u26A0\uFE0F [ER:IO] Cap JSON amb prefix ' + prefix + '. Intentant sense blockId...');
                var legacyPrefix = programArchivo.toUpperCase() + '_';
                candidates = files.filter(function (f) {
                    return !f.isDir &&
                        f.name.toUpperCase().indexOf(legacyPrefix) === 0 &&
                        f.name.toLowerCase().indexOf('.json') === f.name.length - 5;
                });
            }

            if (candidates.length === 0) {
                log('\u26A0\uFE0F [ER:IO] Cap JSON trobat per a ' + searchLabel);
                return null;
            }

            candidates.sort(function (a, b) { return b.name.localeCompare(a.name); });
            var best = candidates[0];
            log('\u2705 [ER:IO] JSON m\u00E9s recent: ' + best.name);
            return { path: best.path, filename: best.name };

        } catch (e) {
            log('\u274C [ER:IO] Error en findLatest: ' + e.message);
            return null;
        }
    };

    /**
     * getStatus: Obté un estat resumit per al semàfor.
     * @param {string} programArchivo
     * @param {string} blockId
     * @returns {Promise<{ found: boolean, ready: boolean, timestamp: string }>}
     */
    ER.getStatus = async function (programArchivo, blockId) {
        var latest = await this.findLatest(programArchivo, blockId);
        if (!latest) return { found: false, ready: false };

        var data = await this.load(latest.path);
        if (!data) return { found: true, ready: false, filename: latest.filename };

        var block = this.getBlock(data, blockId);
        var mediaScan = data && data.cleanFeed ? data.cleanFeed : {};

        var lines = this.getLinesForBlock(data, blockId);
        var wottsExpected = lines
            .filter(function (l) { return l.num && (l.teVideo || ['OFT', 'BVI'].indexOf(l.font) !== -1); })
            .map(function (l) { return l.num; });

        // En el nou format (clips[] buit), block sempre es reconstrueix → ready=true
        var isReady = !!(block && (block.ready || true));

        return {
            found: true,
            ready: isReady,
            filename: latest.filename,
            timestamp: latest.filename.split('_').slice(-2).join('_').replace('.json', ''),
            mediaStop: mediaScan.mediaStop || null,
            blockOut: block ? block.out : null,
            wottsExpected: Array.from(new Set(wottsExpected)),
            totalExpected: wottsExpected.length
        };
    };

    // ----------------------------------------------------------------
    // 3. LLEGIR I PARSEJAR EL JSON
    // ----------------------------------------------------------------

    /**
     * load: Llegeix el JSON des de la ruta UNC via bridge JSX i el parseja.
     * Cacheja el resultat a window.FASTPASS_UI.State._escaletaCache
     * per evitar parsejar el mateix JSON de 7000+ línies fins a 5 cops per workflow.
     * @param {string} jsonPath - ruta UNC completa al fitxer
     * @param {boolean} [forceReload=false] - Si true, ignora la cache i rellegeix
     * @returns {Promise<Object|null>} - { cleanFeed, parallelAntena, escaleta }
     */
    ER.load = async function (jsonPath, forceReload) {
        var state = window.FASTPASS_UI.State;
        if (!forceReload && state._escaletaCache && state._escaletaCache.path === jsonPath) {
            log('\uD83D\uDCE6 [ER:IO] JSON retornat de cache: ' + jsonPath);
            return state._escaletaCache.data;
        }

        log('\uD83D\uDCD6 [ER:IO] Llegint JSON: ' + jsonPath);
        try {
            var raw = await callJSX("IO.readTxt('" + this._escapePath(jsonPath) + "')");
            if (!raw || raw === '' || raw.indexOf('ERR') === 0) {
                log('\u26A0\uFE0F [ER:IO] No s\'ha pogut llegir: ' + jsonPath);
                return null;
            }
            var data = JSON.parse(raw);
            var clipCount = data && data.cleanFeed && data.cleanFeed.clips ? data.cleanFeed.clips.length : 0;
            log('\u2705 [ER:IO] JSON parsejat. Blocs cleanFeed: ' + clipCount);
            var corrected = this.applyDurationOverrides(data);
            if (corrected > 0) {
                log('\uD83D\uDCD0 [ER:IO] ' + corrected + ' duracions corregides a l\'escaleta');
            }
            state._escaletaCache = { path: jsonPath, data: data };
            return data;
        } catch (e) {
            log('\u274C [ER:IO] Error en load: ' + e.message);
            return null;
        }
    };

    // ----------------------------------------------------------------
    // Registre al namespace
    // ----------------------------------------------------------------
    FASTPASS_UI.EscaletaReader = ER;
    window.FASTPASS_UI = FASTPASS_UI;

    log('[ER:IO] Sub-mòdul inicialitzat (_escapePath, findLatest, getStatus, load)');
})();
