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

    /**
     * _listEscaletas: Llista la carpeta d'escaletes provant IP directa primer
     * i nom de domini com a fallback (alguns PCs no resolen public.ad-ccrtv.local).
     * @returns {Promise<{raw:string|null, path:string}>}
     */
    ER._listEscaletas = async function () {
        var candidates = [];
        if (this.ESCALETES_PATH) candidates.push(this.ESCALETES_PATH);
        if (this.ESCALETES_PATH_DOMAIN && this.ESCALETES_PATH_DOMAIN !== this.ESCALETES_PATH) {
            candidates.push(this.ESCALETES_PATH_DOMAIN);
        }
        for (var ci = 0; ci < candidates.length; ci++) {
            var p = candidates[ci];
            try {
                var raw = await callJSX("IO.listFolder('" + this._escapePath(p) + "')");
                if (raw && raw !== '[]' && raw.indexOf('ERR') !== 0) {
                    if (ci > 0) log('🔁 [ER:IO] Escaletes llistades via domini (fallback): ' + p);
                    return { raw: raw, path: p };
                }
                log('⚠️ [ER:IO] No s\'ha pogut llistar (' + p + '): ' + (raw || 'null'));
            } catch (e) {
                log('⚠️ [ER:IO] Excepció llistant (' + p + '): ' + e.message);
            }
        }
        return { raw: null, path: '' };
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
     * Nou format: YYYYMMDD_HHMMSS_PROGRAMA_BLOQUE_...json
     * @param {string} filename
     * @returns {string|null} BlockId (ex: "V1") o null si no es pot extreure
     */
    ER.extractBlockIdFromFilename = function (filename) {
        if (!filename) return null;
        var m = filename.match(/_(V\d+)_/i);
        return m ? m[1].toUpperCase() : null;
    };

    /**
     * findLatest: Llista la carpeta d'escaletes i troba el JSON més recent
     * per al programa indicat.
     *
     * NOU FORMAT (2026-06-12): YYYYMMDD_HHMMSS_PROGRAMA_BLOQUE_...json
     * La data és al principi del nom → filtrar per data és trivial.
     *
     * @param {string} programArchivo - e.g. "TN_MIGDIA", "TN_COMARQUES"
     * @param {string} [blockId] - Opcional. ID del bloc ("V1", "V2"...)
     * @returns {Promise<{path:string, filename:string}|null>}
     */
    /**
     * findLatest: Cerca el JSON d'escaleta més recent per a un programa i bloc.
     *
     * NOU FORMAT (2026-06-12): YYYYMMDD_HHMMSS_PROGRAMA_BLOQUE_...json
     *
     * @param {string} programArchivo - e.g. "TN_MIGDIA", "TN_COMARQUES"
     * @param {string} [blockId] - ID del bloc ("V1", "V2"...)
     * @param {string} [datePrefix] - Prefix de data YYYYMMDD per filtrar
     *        (ex: "20260618"). Si es proporciona, NOMÉS es consideren
     *        fitxers d'aquest dia. Sense datePrefix, comportament legacy.
     * @returns {Promise<{path:string, filename:string}|null>}
     */
    ER.findLatest = async function (programArchivo, blockId, datePrefix) {
        var searchLabel = programArchivo + (blockId ? '/' + blockId : '') + (datePrefix ? ' [' + datePrefix + ']' : '');
        log('\uD83D\uDCE1 [ER:IO] Cercant JSON per a: ' + searchLabel);
        try {
            var listRes = await this._listEscaletas();
            var raw = listRes.raw;
            if (!raw) {
                log('\u26A0\uFE0F [ER:IO] No s\'ha pogut llistar la carpeta d\'escaletes (IP ni domini)');
                return null;
            }

            var files;
            try {
                files = JSON.parse(raw);
            } catch (e) {
                log('\u26A0\uFE0F [ER:IO] Error parsejant llistat: ' + e.message);
                return null;
            }

            // Helper: extreu YYYYMMDD del prefix del nom (nou format)
            function _extractDateFromName(name) {
                var parts = name.split('_');
                if (parts.length >= 1 && /^\d{8}$/.test(parts[0])) {
                    return parts[0]; // "20260618"
                }
                return null;
            }

            // Helper: extreu data sortable (YYYYMMDDHHMMSS)
            function _extractSortDate(name) {
                var noExt = name.replace(/\.json$/i, '');
                var parts = noExt.split('_');
                if (parts.length >= 2 && /^\d{8}$/.test(parts[0]) && /^\d{6}$/.test(parts[1])) {
                    return parts[0] + parts[1];
                }
                // Fallback: format antic (data al final)
                if (parts.length >= 2) {
                    var datePart = parts[parts.length - 2];
                    var timePart = parts[parts.length - 1];
                    if (/^\d{8}$/.test(datePart) && /^\d{6}$/.test(timePart)) {
                        return datePart + timePart;
                    }
                }
                return '00000000000000';
            }

            // ── Filtrar per programa (sempre) ──
            var progToken = '_' + programArchivo.toUpperCase() + '_';
            var allProgFiles = files.filter(function (f) {
                return !f.isDir &&
                    f.name.toUpperCase().indexOf(progToken) !== -1 &&
                    f.name.toLowerCase().indexOf('.json') === f.name.length - 5;
            });

            if (allProgFiles.length === 0) {
                log('\u26A0\uFE0F [ER:IO] Cap JSON trobat per a ' + programArchivo);
                return null;
            }

            // ── Si tenim datePrefix, filtrar ESTRICTAMENT per data ──
            if (datePrefix) {
                allProgFiles = allProgFiles.filter(function (f) {
                    var d = _extractDateFromName(f.name);
                    return d === datePrefix;
                });
                if (allProgFiles.length === 0) {
                    log('\u26A0\uFE0F [ER:IO] Cap JSON del dia ' + datePrefix + ' per a ' + programArchivo);
                    return null;
                }
            }

            // ── Ordenar per timestamp descendent ──
            allProgFiles.sort(function (a, b) {
                return _extractSortDate(b.name).localeCompare(_extractSortDate(a.name));
            });

            // ── NOU COMPORTAMENT (2026-06-29): Sempre agafar el JSON MÉS RECENT
            // del programa, ignorant el blockId al nom del fitxer.
            var best = allProgFiles[0];
            log('\u2705 [ER:IO] JSON m\u00E9s recent (global): ' + best.name);
            return { path: best.path, filename: best.name };

        } catch (e) {
            log('\u274C [ER:IO] Error en findLatest: ' + e.message);
            return null;
        }
    };

    /**
     * findInFolder: Busca el JSON d'escaleta més recent al directori del projecte.
     * Reconeix tant les escaletes copiades del NAS (YYYYMMDD_HHMMSS_PROGRAMA_*.json)
     * com les generades pel botó Foto (escaleta_on_demand_*.json).
     *
     * @param {string} folderPath - Directori del projecte (on viu el .prproj)
     * @param {string} [programArchivo] - Filtre opcional pel nom del programa (ex: "TN_VESPRE")
     * @returns {Promise<{path:string, filename:string}|null>}
     */
    ER.findInFolder = async function (folderPath, programArchivo) {
        if (!folderPath) return null;
        try {
            var raw = await callJSX("IO.listFolder('" + this._escapePath(folderPath) + "')");
            if (!raw || raw === '[]' || raw.indexOf('ERR') === 0) return null;
            var files;
            try { files = JSON.parse(raw); } catch (e) { return null; }
            if (!files || files.length === 0) return null;

            var progKey = programArchivo ? programArchivo.toUpperCase() : null;
            var candidates = files.filter(function (f) {
                var name = (f.name || '');
                if (name.toLowerCase().indexOf('.json') !== name.length - 5) return false;
                var isNasCopy = /^\d{8}_\d{6}_/.test(name);
                var isOnDemand = name.indexOf('escaleta_on_demand') === 0;
                if (!isNasCopy && !isOnDemand) return false;
                if (progKey) {
                    // Escaletes del NAS copiades: han de contenir el programa.
                    // Les on_demand no porten programa al nom, es consideren del projecte actiu.
                    return name.toUpperCase().indexOf(progKey) !== -1 || isOnDemand;
                }
                return true;
            });
            if (candidates.length === 0) return null;

            candidates.sort(function (a, b) { return (b.modified || 0) - (a.modified || 0); });
            var best = candidates[0];
            var path = folderPath.replace(/[\\/]+$/, '') + '\\' + best.name;
            log('\uD83D\uDCC1 [ER:IO] Escaleta local trobada: ' + best.name);
            return { path: path, filename: best.name };
        } catch (e) {
            log('\u26A0\uFE0F [ER:IO] Error en findInFolder: ' + e.message);
            return null;
        }
    };

    /**
     * ensureLocalCopy: Garanteix que el directori del projecte té una còpia de l'escaleta.
     * 1. Busca localment (findInFolder). Si existeix, la retorna.
     * 2. Si no, busca al NAS (findLatest) i la copia al directori del projecte.
     *
     * @param {Object} ctx - Context del projecte (config, progData, dateDir, bloque)
     * @param {string} [datePrefix] - Prefix YYYYMMDD per filtrar al NAS
     * @returns {Promise<{path:string, filename:string}|null>} Còpia local
     */
    ER.ensureLocalCopy = async function (ctx, datePrefix) {
        if (!ctx || !ctx.config || !ctx.progData || !ctx.dateDir) return null;
        var folderPath = ctx.config.rutas.destinoBase + ctx.progData.directorio + '/' + ctx.dateDir;

        // 1. Intentar amb la còpia local
        var local = await this.findInFolder(folderPath, ctx.progData.archivo);
        if (local) return local;

        // 2. Buscar al NAS
        var remote = await this.findLatest(ctx.progData.archivo, ctx.bloque, datePrefix);
        if (!remote) {
            log('\u26A0\uFE0F [ER:IO] Cap escaleta al NAS per copiar al directori del projecte.');
            return null;
        }

        // 3. Copiar al directori del projecte
        await callJSX("IO.createFolder('" + this._escapePath(folderPath) + "')");
        var destPath = folderPath.replace(/[\\/]+$/, '\\') + remote.filename;
        var copyRes = await callJSX("IO.copyFile('" + this._escapePath(remote.path) + "', '" + this._escapePath(destPath) + "')");
        if (copyRes !== 'OK') {
            log('\u26A0\uFE0F [ER:IO] Error copiant escaleta al directori del projecte: ' + copyRes);
            return null;
        }
        log('\uD83D\uDCC1 [ER:IO] Escaleta copiada al directori del projecte: ' + remote.filename);
        return { path: destPath, filename: remote.filename };
    };

    /**
     * _filenameToUnixSec: Converteix el timestamp del nom d'un fitxer JSON
     * (YYYYMMDD_HHMMSS) a segons Unix (UTC).
     * @param {string} filename
     * @returns {number|null}
     */
    ER._filenameToUnixSec = function (filename) {
        if (!filename) return null;
        var sortDate = '';
        var noExt = filename.replace(/\.json$/i, '');
        var parts = noExt.split('_');
        if (parts.length >= 2 && /^\d{8}$/.test(parts[0]) && /^\d{6}$/.test(parts[1])) {
            sortDate = parts[0] + parts[1];
        } else if (parts.length >= 2 && /^\d{8}$/.test(parts[parts.length - 2]) && /^\d{6}$/.test(parts[parts.length - 1])) {
            sortDate = parts[parts.length - 2] + parts[parts.length - 1];
        }
        if (sortDate.length !== 14) return null;
        var y = parseInt(sortDate.substring(0, 4), 10);
        var m = parseInt(sortDate.substring(4, 6), 10);
        var d = parseInt(sortDate.substring(6, 8), 10);
        var hh = parseInt(sortDate.substring(8, 10), 10);
        var mm = parseInt(sortDate.substring(10, 12), 10);
        var ss = parseInt(sortDate.substring(12, 14), 10);
        return Date.UTC(y, m - 1, d, hh, mm, ss) / 1000;
    };

    /**
     * _getBlockLastItemEndSec: Retorna el timestamp d'emissió (segons del dia)
     * del final de l'últim ítem d'un bloc dins d'un JSON ja carregat.
     * @param {Object} data - JSON escaleta parsejat
     * @param {string} blockId
     * @returns {{ endSec: number, source: string }|null}
     */
    ER._getBlockLastItemEndSec = function (data, blockId) {
        var lines = this.getLinesForBlock(data, blockId);
        if (!lines || lines.length === 0) return null;

        // Ordenar per sequencia per trobar l'últim cronològicament
        var sorted = lines.slice().sort(function (a, b) {
            return (a.sequencia || 0) - (b.sequencia || 0);
        });
        var last = sorted[sorted.length - 1];

        // Prioritat 1: horaEntradaOnAir + duradaOnAir (fet real del playout)
        if (last.horaEntradaOnAir && last.duradaOnAir) {
            var entradaSec = this.tcToSeconds(last.horaEntradaOnAir);
            var duradaSec = this.parseDurada(last.duradaOnAir);
            if (duradaSec > 0) {
                return { endSec: entradaSec + duradaSec, source: 'OnAir', num: last.num };
            }
        }

        // Prioritat 2: horaSortidaPrevista
        if (last.horaSortidaPrevista && last.horaSortidaPrevista !== '00:00:00') {
            return { endSec: this.tcToSeconds(last.horaSortidaPrevista), source: 'Prevista', num: last.num };
        }

        // Prioritat 3: horaEntradaPrevista + durada
        if (last.horaEntradaPrevista && last.durada) {
            var eSec = this.tcToSeconds(last.horaEntradaPrevista);
            var dSec = this.parseDurada(last.durada);
            return { endSec: eSec + dSec, source: 'Prevista+durada', num: last.num };
        }

        return null;
    };

    /**
     * findLatestValid: Com findLatest, però valida que el JSON sigui
     * SUFICIENTMENT RECENT: el seu timestamp ha de ser >= al final
     * d'emissió de l'últim ítem del bloc.
     *
     * Si el JSON més recent no és vàlid, prova el següent (menys recent).
     * Si cap JSON és vàlid, retorna { valid: false, lastItemEndSec, estimatedWaitSec }.
     *
     * @param {string} programArchivo
     * @param {string} blockId
     * @param {string} [datePrefix]
     * @returns {Promise<Object>}
     *   { valid: true, path, filename, data }
     *   { valid: false, lastItemEndSec, estimatedWaitSec, blockId }
     */
    ER.findLatestValid = async function (programArchivo, blockId, datePrefix) {
        var searchLabel = programArchivo + '/' + blockId + (datePrefix ? ' [' + datePrefix + ']' : '');
        log('\uD83D\uDD0D [ER:IO] findLatestValid: ' + searchLabel);

        try {
            var listRes = await this._listEscaletas();
            var raw = listRes.raw;
            if (!raw) {
                log('\u26A0\uFE0F [ER:IO] No s\'ha pogut llistar la carpeta d\'escaletes (IP ni domini)');
                return { valid: false, lastItemEndSec: null, estimatedWaitSec: null, error: 'No s\'ha pogut llistar la carpeta d\'escaletes' };
            }

            var files;
            try { files = JSON.parse(raw); } catch (e) {
                return { valid: false, lastItemEndSec: null, estimatedWaitSec: null, error: 'Error parsejant llistat' };
            }

            var progToken = '_' + programArchivo.toUpperCase() + '_';
            var allProgFiles = files.filter(function (f) {
                return !f.isDir &&
                    f.name.toUpperCase().indexOf(progToken) !== -1 &&
                    f.name.toLowerCase().indexOf('.json') === f.name.length - 5;
            });

            if (allProgFiles.length === 0) {
                log('\u26A0\uFE0F [ER:IO] Cap JSON per a ' + programArchivo);
                return { valid: false, lastItemEndSec: null, estimatedWaitSec: null, error: 'Cap JSON trobat per a ' + programArchivo };
            }

            function _extractDateFromName(name) {
                var parts = name.split('_');
                if (parts.length >= 1 && /^\d{8}$/.test(parts[0])) return parts[0];
                return null;
            }

            function _extractSortDate(name) {
                var noExt = name.replace(/\.json$/i, '');
                var parts = noExt.split('_');
                if (parts.length >= 2 && /^\d{8}$/.test(parts[0]) && /^\d{6}$/.test(parts[1])) return parts[0] + parts[1];
                return '00000000000000';
            }

            if (datePrefix) {
                allProgFiles = allProgFiles.filter(function (f) {
                    return _extractDateFromName(f.name) === datePrefix;
                });
                if (allProgFiles.length === 0) {
                    return { valid: false, lastItemEndSec: null, estimatedWaitSec: null, error: 'Cap JSON del dia ' + datePrefix };
                }
            }

            allProgFiles.sort(function (a, b) {
                return _extractSortDate(b.name).localeCompare(_extractSortDate(a.name));
            });

            var lastItemEndSec = null;
            var bestInvalid = null;

            for (var i = 0; i < allProgFiles.length; i++) {
                var candidate = allProgFiles[i];
                var data = await this.load(candidate.path, true);
                if (!data) continue;

                var blockEnd = this._getBlockLastItemEndSec(data, blockId);
                if (!blockEnd) {
                    log('\uD83D\uDD04 [ER:IO] ' + candidate.name + ': bloc ' + blockId + ' sense ítems amb dades temporals. Saltant.');
                    continue;
                }

                if (lastItemEndSec === null) {
                    lastItemEndSec = blockEnd.endSec;
                }

                var jsonUnixSec = this._filenameToUnixSec(candidate.name);
                if (jsonUnixSec === null) {
                    log('\u26A0\uFE0F [ER:IO] ' + candidate.name + ': no s\'ha pogut extreure timestamp del nom');
                    continue;
                }

                // Convertir lastItemEndSec (segons del dia, ex: 53824 = 14:57:04) a Unix UTC
                // Necessitem la data base del datePrefix per reconstruir el timestamp absolut
                var dateBase = datePrefix || _extractDateFromName(candidate.name);
                if (dateBase) {
                    var y = parseInt(dateBase.substring(0, 4), 10);
                    var m = parseInt(dateBase.substring(4, 6), 10);
                    var d = parseInt(dateBase.substring(6, 8), 10);
                    var blockEndUnix = Date.UTC(y, m - 1, d, 0, 0, 0) / 1000 + blockEnd.endSec;

                    if (jsonUnixSec >= blockEndUnix) {
                        log('\u2705 [ER:IO] findLatestValid: ' + candidate.name + ' (JSON=' + jsonUnixSec + ') >= blockEnd(' + blockId + ':' + (blockEnd.num || '?') + ')=' + blockEndUnix + ' (' + blockEnd.source + '). VÀLID.');
                        return { valid: true, path: candidate.path, filename: candidate.name, data: data };
                    }

                    log('\u23F3 [ER:IO] ' + candidate.name + ' (JSON=' + jsonUnixSec + ') < blockEnd=' + blockEndUnix + '. JSON massa antic.');
                    if (!bestInvalid) {
                        bestInvalid = {
                            path: candidate.path,
                            filename: candidate.name,
                            lastItemEndSec: blockEnd.endSec,
                            blockEndUnix: blockEndUnix,
                            source: blockEnd.source,
                            num: blockEnd.num
                        };
                    }
                }
            }

            // ── Cap JSON vàlid (posterior al blockEnd) ──
            // Fallback: si hi ha un JSON anterior amb ítems del bloc, usar-lo.
            // Ex: TNC V3 06/07: V3 és error, V2 és anterior a V3 → usar V2.
            if (bestInvalid && bestInvalid.path) {
                var fallbackData = await this.load(bestInvalid.path, true);
                if (fallbackData) {
                    log('\u26A0\uFE0F [ER:IO] findLatestValid: Cap JSON posterior al bloc ' + blockId + '. Usant fallback anterior: ' + bestInvalid.filename + ' (JSON=' + bestInvalid.blockEndUnix + ' < blockEnd)');
                    return { valid: true, path: bestInvalid.path, filename: bestInvalid.filename, data: fallbackData, _fallback: true };
                }
            }

            var nowUnix = Date.now() / 1000;
            var estimatedWaitSec = null;
            var blockEndUnix = bestInvalid ? bestInvalid.blockEndUnix : null;

            if (blockEndUnix && blockEndUnix > nowUnix) {
                estimatedWaitSec = Math.ceil(blockEndUnix - nowUnix);
            }

            log('\u23F0 [ER:IO] findLatestValid: Cap JSON suficientment recent per a ' + blockId + '. Espera estimada: ' + (estimatedWaitSec !== null ? estimatedWaitSec + 's' : 'N/D'));

            return {
                valid: false,
                lastItemEndSec: bestInvalid ? bestInvalid.lastItemEndSec : null,
                blockEndUnix: blockEndUnix,
                estimatedWaitSec: estimatedWaitSec,
                blockId: blockId,
                bestFilename: bestInvalid ? bestInvalid.filename : null,
                source: bestInvalid ? bestInvalid.source : null,
                num: bestInvalid ? bestInvalid.num : null
            };

        } catch (e) {
            log('\u274C [ER:IO] Error en findLatestValid: ' + e.message);
            return { valid: false, lastItemEndSec: null, estimatedWaitSec: null, error: e.message };
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
            // ── Validar que el JSON és una escaleta real, no un error del servidor ──
            // Ex: JSON V3 de TNC 06/07: {"missatge":"Error","debugInfo":"No s'ha localitzat..."}
            if (data.missatge || !data.cleanFeed || !data.escaleta) {
                log('\u26A0\uFE0F [ER:IO] JSON descartat (error del servidor o estructura invàlida): ' + jsonPath);
                if (data.missatge) log('\u26A0\uFE0F [ER:IO]   Motiu: ' + data.missatge);
                return null;
            }
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
