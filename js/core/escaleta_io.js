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

            // Helper: extreu YYYYMMDD del nom (format nou: prefix; format antic: penúltim segment)
            function _extractDateFromName(name) {
                var parts = name.split('_');
                if (parts.length >= 1 && /^\d{8}$/.test(parts[0])) {
                    return parts[0]; // "20260618" (format nou)
                }
                // Format antic: TN_VESPRE_20260618_215504.json → data al penúltim segment
                if (parts.length >= 2 && /^\d{8}$/.test(parts[parts.length - 2]) && /^\d{6}$/.test(parts[parts.length - 1])) {
                    return parts[parts.length - 2];
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
            // FIX (2026-09-16) — ESCULL LA ESCALETA VALIDA:
            // Sempre el JSON MES RECENT del programa (s'ignora el blockId del nom), pero
            // SALTANT els fitxers d'ERROR que publica el motor
            // ({"missatge":"Error","debugInfo":...}, 200 bytes). Abans s'agafava el
            // primer per data i, si era un error (cas real: TNC V3 del 16/09), l'extensio
            // es quedava sense escaleta tot i tenir el V2 valid al mateix directori.
            var maxTry = Math.min(allProgFiles.length, 5);
            for (var fi = 0; fi < maxTry; fi++) {
                var cand = allProgFiles[fi];
                var candData = null;
                try { candData = await this.load(cand.path); } catch (eL) { candData = null; }
                if (candData && candData.cleanFeed && candData.escaleta) {
                    if (fi > 0) log('\u2139\uFE0F [ER:IO] El JSON mes recent no era una escaleta valida; s\'usa: ' + cand.name);
                    log('\u2705 [ER:IO] JSON mes recent valid (global): ' + cand.name);
                    return { path: cand.path, filename: cand.name };
                }
                log('\u26A0\uFE0F [ER:IO] JSON descartat (no es escaleta): ' + cand.name);
            }
            log('\u274C [ER:IO] Cap JSON valid del programa per a la data demanada');
            return null;

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

            // ── PRIORITAT (2026-09-16): la FOTO (escaleta_on_demand_*) mana SEMPRE sobre
            // les còpies del NAS: si l'usuari ha fet FOTO, aquesta és la font. Dins de
            // cada grup, la més recent. I es descarten els JSON invàlids (fitxers
            // d'error del motor: {"missatge":"Error",...}) així com els que no es poden
            // llegir.
            candidates.sort(function (a, b) { return (b.modified || 0) - (a.modified || 0); });
            var fotos = [], nasCopies = [];
            for (var ci2 = 0; ci2 < candidates.length; ci2++) {
                var nm2 = String(candidates[ci2].name || '');
                if (nm2.indexOf('escaleta_on_demand') === 0) fotos.push(candidates[ci2]);
                else nasCopies.push(candidates[ci2]);
            }
            var ordered = fotos.concat(nasCopies);
            var maxTryF = Math.min(ordered.length, 4);
            for (var fi2 = 0; fi2 < maxTryF; fi2++) {
                var best = ordered[fi2];
                var path = folderPath.replace(/[\\/]+$/, '') + '\\' + best.name;
                var localData = null;
                try { localData = await this.load(path, true); } catch (eLF) { localData = null; }
                if (!localData) {
                    log('\u26A0\uFE0F [ER:IO] Escaleta local descartada (no vàlida): ' + best.name);
                    continue;
                }
                log('\uD83D\uDCC1 [ER:IO] Escaleta local trobada: ' + best.name + (fi2 < fotos.length ? ' [FOTO]' : ''));
                return { path: path, filename: best.name };
            }
            log('\u274C [ER:IO] Cap escaleta local vàlida al directori del projecte');
            return null;
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
                // Format antic: data al penúltim segment (TN_VESPRE_20260618_215504.json)
                if (parts.length >= 2 && /^\d{8}$/.test(parts[parts.length - 2]) && /^\d{6}$/.test(parts[parts.length - 1])) return parts[parts.length - 2];
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
     * @param {string} [datePrefix] - Prefix YYYYMMDD per restringir al dia de treball.
     * @returns {Promise<{ found: boolean, ready: boolean, timestamp: string }>}
     */
    ER.getStatus = async function (programArchivo, blockId, datePrefix) {
        // FIX (2026-09-16): s'usa findLatestValid (validació "JSON >= fi del bloc" +
        // fallback al JSON anterior + espera estimada) per saber si l'escaleta és prou
        // RECENT per al bloc. Abans només s'usava findLatest (el més recent per data),
        // i una escaleta massa antiga o un fitxer d'error deixaven el semàfor en vermell
        // sense cap explicació ni estimació d'espera.
        var validRes = null;
        try {
            if (typeof this.findLatestValid === 'function') {
                validRes = await this.findLatestValid(programArchivo, blockId, datePrefix);
            }
        } catch (eVal) { validRes = null; }
        var waitSec = (validRes && validRes.estimatedWaitSec != null) ? validRes.estimatedWaitSec : null;

        var latest = null;
        if (validRes && validRes.valid && validRes.path) {
            latest = { path: validRes.path, filename: validRes.filename };
        } else {
            latest = await this.findLatest(programArchivo, blockId, datePrefix);
        }
        if (!latest) return { found: false, ready: false, waitSec: waitSec };

        var data = await this.load(latest.path);
        if (!data) return { found: true, ready: false, filename: latest.filename, waitSec: waitSec };

        var block = this.getBlock(data, blockId);
        var mediaScan = data && data.cleanFeed ? data.cleanFeed : {};

        var lines = this.getLinesForBlock(data, blockId);
        var wottsExpected = lines
            .filter(function (l) { return l.num && (l.teVideo || ['OFT', 'BVI'].indexOf(l.font) !== -1); })
            .map(function (l) { return l.num; });

        // Criteri d'arrancada: la escaleta és vàlida quan TOTS els ítems del bloc
        // ja s'han emès (hora OnAir + durada). Una escaleta del servidor amb el bloc
        // encara en emissió NO es considera ready.
        var complete = { ok: false, emitted: 0, total: 0, reason: 'n/d', pending: null };
        try {
            if (typeof this.isBlockFullyEmitted === 'function') {
                complete = this.isBlockFullyEmitted(data, blockId);
            }
        } catch (eCE) { }
        var isReady = !!complete.ok || !!(validRes && validRes.valid);

        return {
            found: true,
            ready: isReady,
            complete: complete,
            escaletaValid: !!(validRes && validRes.valid),
            waitSec: waitSec,
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
     * lookupLocalStatus: Comprova si al directori del projecte del dia hi ha una
     * escaleta local — còpia del NAS (YYYYMMDD_HHMMSS_*.json) o la "foto" generada
     * amb el botó FOTO (escaleta_on_demand_*.json) — i retorna el seu estat en el
     * mateix format que getStatus.
     *
     * S'usa a checkContext com a FONT ALTERNATIVA quan el servidor central encara
     * no té el JSON del dia (bloc acabat d'emetre): si la foto local existeix, la
     * extensió pot passar de "MASSA D'HORA" a "CREAR".
     *
     * @param {Object} ctx - Context (config, progData, dateDir, bloque)
     * @returns {Promise<{found, ready, local, filename, timestamp, mediaStop, blockOut, wottsExpected, totalExpected}>}
     */
    ER.lookupLocalStatus = async function (ctx) {
        if (!ctx || !ctx.config || !ctx.progData || !ctx.dateDir) {
            return { found: false, ready: false };
        }
        try {
            var folderPath = ctx.config.rutas.destinoBase + ctx.progData.directorio + '/' + ctx.dateDir;
            var raw = await callJSX("IO.listFolder('" + this._escapePath(folderPath) + "')");
            if (!raw || raw === '[]' || raw.indexOf('ERR') === 0) {
                return { found: false, ready: false };
            }
            var files;
            try { files = JSON.parse(raw); } catch (eP) { return { found: false, ready: false }; }
            if (!files || files.length === 0) return { found: false, ready: false };

            var progKey = (ctx.progData.archivo || '').toUpperCase();
            var candidates = files.filter(function (f) {
                var name = String(f.name || '');
                if (name.toLowerCase().indexOf('.json') !== name.length - 5) return false;
                var isNasCopy = /^\d{8}_\d{6}_/.test(name);
                var isOnDemand = name.indexOf('escaleta_on_demand') === 0;
                if (!isNasCopy && !isOnDemand) return false;
                // Les còpies del NAS han de contenir el programa; les on_demand no
                // porten programa al nom (es consideren del dia/projecte actiu).
                if (progKey) return name.toUpperCase().indexOf(progKey) !== -1 || isOnDemand;
                return true;
            });
            if (candidates.length === 0) return { found: false, ready: false };

            // ── PRIORITAT (2026-09-16): la FOTO (escaleta_on_demand_*) va PRIMER: si
            // l'usuari ha fet FOTO, aquesta és la font, encara que hi hagi una còpia del
            // NAS més recent. Dins de cada grup, la més recent.
            candidates.sort(function (a, b) { return (b.modified || 0) - (a.modified || 0); });
            var fotosL = [], nasL = [];
            for (var ciL = 0; ciL < candidates.length; ciL++) {
                if (String(candidates[ciL].name || '').indexOf('escaleta_on_demand') === 0) fotosL.push(candidates[ciL]);
                else nasL.push(candidates[ciL]);
            }
            candidates = fotosL.concat(nasL);

            // Iterar de més recent a més antic: el primer que contingui el bloc és la
            // foto/escaleta vàlida (igual que getStatus sobre el repositori central).
            for (var ci = 0; ci < candidates.length; ci++) {
                var cand = candidates[ci];
                var path = folderPath.replace(/[\\/]+$/, '\\') + cand.name;
                var data = await this.load(path);
                if (!data) continue;
                var block = this.getBlock(data, ctx.bloque);
                if (!block) continue;

                var mediaScan = data.cleanFeed ? data.cleanFeed : {};
                var lines = this.getLinesForBlock(data, ctx.bloque);
                var wottsExpected = lines
                    .filter(function (l) { return l.num && (l.teVideo || ['OFT', 'BVI'].indexOf(l.font) !== -1); })
                    .map(function (l) { return l.num; });

                // Criteri d'arrancada: la FOTO (o la còpia local) és vàlida si TOTS els
                // ítems del bloc ja s'han emès. Si el bloc encara s'està emetent, l'estat
                // queda en ESPERANT encara que la foto existeixi.
                var complete = { ok: false, emitted: 0, total: 0, reason: 'n/d', pending: null };
                try {
                    if (typeof this.isBlockFullyEmitted === 'function') {
                        complete = this.isBlockFullyEmitted(data, ctx.bloque);
                    }
                } catch (eCE) { }
                var isOnDemand = String(cand.name).indexOf('escaleta_on_demand') === 0;
                // FIX (2026-09-16): una FOTO sempre és utilitzable (l'usuari l'ha
                // demanada expressament), encara que el bloc no consti com a emès del tot.
                var isReady = isOnDemand || !!complete.ok;
                log('📷 [ER:IO] Escaleta local trobada per al bloc ' + ctx.bloque + ': ' + cand.name +
                    (isOnDemand ? ' [FOTO → té preferència]' : ' [còpia NAS]'));
                return {
                    found: true,
                    ready: isReady,
                    local: true,
                    isFoto: isOnDemand,
                    complete: complete,
                    filename: cand.name,
                    timestamp: isOnDemand ? 'FOTO' : String(cand.name).split('_').slice(-2).join('_').replace('.json', ''),
                    mediaStop: mediaScan.mediaStop || null,
                    blockOut: block.out || null,
                    wottsExpected: Array.from(new Set(wottsExpected)),
                    totalExpected: wottsExpected.length
                };
            }

            // Hi ha candidats locals però cap conté el bloc demanat.
            if (candidates.length > 0) {
                log('⚠️ [ER:IO] Escaleta local sense bloc ' + ctx.bloque + ': ' + candidates[0].name);
                return { found: true, ready: false, local: true, filename: candidates[0].name };
            }
            return { found: false, ready: false };
        } catch (e) {
            log('⚠️ [ER:IO] Error en lookupLocalStatus: ' + e.message);
            return { found: false, ready: false };
        }
    };

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
                if (data.missatge) log('\u26A0\uFE0F [ER:IO]   Motiu: ' + data.missatge + (data.debugInfo ? ' [' + String(data.debugInfo).substring(0, 160) + ']' : ''));
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
