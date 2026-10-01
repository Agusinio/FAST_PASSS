/**
 * ============================================================================
 * LOGIC: SCAN (Motor de cerca de materials) - v2.6.0 literal-premium
 * ============================================================================
 */
(function () {
    var FASTPASS_UI = window.FASTPASS_UI || {};
    FASTPASS_UI.Logic = FASTPASS_UI.Logic || {};

    const utils = {
        log: (m, type) => (FASTPASS_UI.Utils) ? FASTPASS_UI.Utils.log(m, type || "DEBUG") : console.log(m),
        readFolder: (p) => (FASTPASS_UI.Utils) ? FASTPASS_UI.Utils.readFolder(p) : []
    };

    FASTPASS_UI.Logic.Scan = {

        _discardOld: function (files, guardaHours) {
            var now = Date.now();
            var cutoff = now - (guardaHours * 60 * 60 * 1000);
            return files.filter(function (f) {
                if (!f.mtime) return true;
                var fileTime = new Date(f.mtime).getTime();
                return isNaN(fileTime) ? true : (fileTime >= cutoff);
            });
        },

        /**
         * Extreu YYYYMMDD del nom d'un fitxer de media (MP4/SRT).
         * @param {string} name - Nom del fitxer
         * @returns {string|null} "20260618" o null
         */
        _extractDateFromFileName: function (name) {
            if (!name) return null;
            var parts = name.split('_');
            for (var i = 0; i < parts.length; i++) {
                if (/^\d{8}$/.test(parts[i])) return parts[i];
                if (/^\d{14}$/.test(parts[i])) return parts[i].substring(0, 8);
            }
            return null;
        },

        /**
         * _fileDateYYYYMMDD: Data d'un fitxer (YYYYMMDD) per datar-lo.
         * FILTRAT PER DATA DE CREACIÓ (2026-09-07): es fa servir NOMÉS la data de
         * creació real (el mtime del NAS pot estar desplaçat per processos nocturns).
         * Ordre: nom del fitxer → created. Si no es pot datar → null.
         * @param {Object} f - { name, created }
         */
        _fileDateYYYYMMDD: function (f) {
            if (!f) return null;
            var d = this._extractDateFromFileName(f.name);
            if (d) return d;
            if (f.created) {
                var cd = new Date(f.created);
                if (!isNaN(cd.getTime())) {
                    return '' + cd.getFullYear() +
                        ('0' + (cd.getMonth() + 1)).slice(-2) +
                        ('0' + cd.getDate()).slice(-2);
                }
            }
            return null;
        },

        /**
         * filterByWorkDate: MECANISME ÚNIC de filtrat per la data de treball.
         * Regla anti-contaminació: si un fitxer no es pot datar, es descarta.
         * @param {Array} files - Llista { name, created, mtime }
         * @param {string} dateDir - Data de treball (YYYY_MM_DD) o null (sense filtre)
         * @returns {{keep:Array, dropped:Array, noDate:Array}}
         */
        filterByWorkDate: function (files, dateDir) {
            var dateTarget = dateDir ? String(dateDir).replace(/_/g, '') : null;
            if (!dateTarget) return { keep: files || [], dropped: [], noDate: [] };
            if (!files) return { keep: [], dropped: [], noDate: [] };
            var keep = [], dropped = [], noDate = [];
            for (var i = 0; i < files.length; i++) {
                var fileDate = this._fileDateYYYYMMDD(files[i]);
                if (!fileDate) noDate.push(files[i]);
                else if (fileDate !== dateTarget) dropped.push(files[i]);
                else keep.push(files[i]);
            }
            return { keep: keep, dropped: dropped, noDate: noDate };
        },

        /**
         * _normalize: Redueix una cadena a minúscules sense accents ni símbols.
         * Serveix per comparar el "tema" del projecte amb els noms dels .srt
         * (ex: "DONAPAS BARCELONA" == "Donapas_Barcelona" == "donapasbarcelona").
         */
        _normalize: function (s) {
            if (!s) return '';
            var str = String(s).toLowerCase();
            var map = {
                'à':'a','á':'a','â':'a','ã':'a','ä':'a','å':'a',
                'ç':'c',
                'è':'e','é':'e','ê':'e','ë':'e',
                'ì':'i','í':'i','î':'i','ï':'i',
                'ñ':'n',
                'ò':'o','ó':'o','ô':'o','õ':'o','ö':'o',
                'ù':'u','ú':'u','û':'u','ü':'u',
                'ý':'y','ÿ':'y'
            };
            str = str.replace(/[àáâãäåçèéêëìíîïñòóôõöùúûüýÿ]/g, function (ch) { return map[ch] || ch; });
            return str.replace(/[^a-z0-9]+/g, '');
        },

        selectedProject: function(fileList, progKey, blocKey) {
            if (!fileList || fileList.length === 0) return null;
            
            // El patrón de identidad: Pruebas_TNV_V1_ (con guión bajo final)
            // para evitar falsos positivos como V10 cuando buscamos V1
            const pattern = `Pruebas_${progKey}_${blocKey}_`.toLowerCase();
            
            const match = fileList.find(f => {
                const name = f.name.toLowerCase();
                // Verifiquem que comenci per la cadena i sigui un projecte de Premiere
                const matches = name.indexOf(pattern) === 0 && name.endsWith(".prproj");
                return matches;
            });
            
            return match ? match.name : null;
        },

        mediaAssets: async function (ctx, temaHint) {
            try {
                const pathNAS = ctx.config.rutas.verticalitzacio;
                const allFiles = await utils.readFolder(pathNAS);
                // ── F1 (2026-10-01) · lectura FALLIDA ≠ carpeta buida ─────────────
                // Sense això, un error/timeout del pont feia creure que el bloc no
                // té MP4/SRT (i el flux decidia com si no hi hagués material).
                if (!allFiles) {
                    utils.log('❌ [SCAN:media] Lectura FALLIDA de la carpeta de verticalització (' + pathNAS + ').', 'ERROR');
                    return { mp4: null, srt: null, failed: true };
                }
                if (allFiles.length === 0) return { mp4: null, srt: null };

                var datePrefix = ctx.dateDir ? ctx.dateDir.replace(/_/g, '') : null;
                var prefix = ctx.progData.archivo + '_' + ctx.bloque + '_';

                var validFiles = this._filterMediaByDate(allFiles, datePrefix, prefix);
                if (validFiles.length === 0) {
                    // MECÀNICA D'INICI (2026-09-04): NO es reintenta sense filtre de data.
                    // Si no hi ha MP4/SRT de la data de treball, es retorna buit (mai d'altre dia).
                    utils.log('⚠️ [SCAN:media] Cap MP4/SRT amb data ' + datePrefix + '. Retornant buit (no es busca en altres dies).', 'DEBUG');
                }

                if (validFiles.length === 0) return { mp4: null, srt: null };

                validFiles.sort(function (a, b) {
                    var da = this._extractDateFromFileName(a.name);
                    var db = this._extractDateFromFileName(b.name);
                    return (db || '').localeCompare(da || '');
                }.bind(this));

                var getAsset = function (ext) {
                    var upperExt = ext.toUpperCase();
                    for (var i = 0; i < validFiles.length; i++) {
                        if (validFiles[i].name.toUpperCase().endsWith(upperExt)) {
                            return { name: validFiles[i].name, path: pathNAS + validFiles[i].name };
                        }
                    }
                    return null;
                };

                var mp4 = getAsset('.MP4');
                var srt = getAsset('.SRT');

                // ─── AFINAR LA LOCALITZACIÓ DEL SRT ─────────────────────────────
                // Dins d'un mateix bloc hi pot haver diversos .srt (una per notícia).
                // Preferim el que coincideix amb el tema del projecte (si es coneix).
                if (srt && temaHint && String(temaHint).trim().length > 1) {
                    var normalizedTema = this._normalize(temaHint);
                    for (var j = 0; j < validFiles.length; j++) {
                        var candidate = validFiles[j].name;
                        if (!candidate.toUpperCase().endsWith('.SRT')) continue;
                        if (normalizedTema && this._normalize(candidate).indexOf(normalizedTema) !== -1) {
                            srt = { name: candidate, path: pathNAS + candidate };
                            utils.log('🎯 [SCAN:media] SRT coincident amb el tema "' + temaHint + '": ' + candidate, 'DEBUG');
                            break;
                        }
                    }
                }

                return { mp4: mp4, srt: srt };
            } catch (e) { return { mp4: null, srt: null }; }
        },

        _filterMediaByDate: function (files, datePrefix, nameFilter) {
            if (!files || files.length === 0) return [];
            var prefix = nameFilter.toUpperCase();
            var dateTarget = datePrefix;
            var self = this;
            return files.filter(function (f) {
                var name = f.name.toUpperCase();
                if (name.indexOf(prefix) === -1) return false;
                if (!name.endsWith('.MP4') && !name.endsWith('.SRT')) return false;
                if (dateTarget) {
                    var fileDate = self._extractDateFromFileName(f.name);
                    if (!fileDate) {
                        // Fallback: usar data de creació del fitxer (f.created)
                        // per a fitxers que no tenen data al nom (ex: .SRT)
                        if (f.created) {
                            var d = new Date(f.created);
                            var dd = ('0' + d.getDate()).slice(-2);
                            var mm = ('0' + (d.getMonth() + 1)).slice(-2);
                            fileDate = '' + d.getFullYear() + mm + dd;
                        }
                    }
                    if (!fileDate || fileDate !== dateTarget) return false;
                }
                return true;
            });
        },

        wotts: async function (ctx) {
            try {
                const pathNAS = ctx.config.rutas.chyrons;
                // CACHÉ (2026-09-16): llegir aquesta carpeta pel NAS és CAR (75+ .mov de
                // presentadors) i es feia a CADA checkContext (auto-refresh cada 15 s +
                // polls), cosa que bloquejava la UI del panell i endarreria la llista de
                // presentadors. Amb 30 s de TTL n'hi ha prou: la ingesta no canvia en
                // mig minut i el botó CREAR/ACTUALITZAR treballa amb el mateix marge.
                // (2026-10-01 · F2) La caché NOMÉS guarda llistes NO buides: una
                // lectura fallida o buida no s'hi pot quedar 30 s enverinant el panell.
                var _now = Date.now();
                if (!this._readCache) this._readCache = {};
                var _key = 'wotts:' + pathNAS;
                var _c = this._readCache[_key];
                var allFiles;
                // ── F2 (2026-10-01) · NOMÉS es reutilitza una llista NO buida ──────
                // Abans una lectura buida o FALLIDA quedava cachetada 30 s i el
                // panell treballava amb 0 rètols tot i tenir-los al NAS.
                if (_c && (_now - _c.at) < 30000 && _c.list && _c.list.length > 0) {
                    allFiles = _c.list;
                } else {
                    allFiles = await utils.readFolder(pathNAS);
                    if (allFiles && allFiles.length > 0) {
                        this._readCache[_key] = { at: _now, list: allFiles };
                    } else {
                        delete this._readCache[_key];   // mai cachejar buit/fallada
                    }
                }
                // ── F1/F3: null = la lectura ha FALLAT (no és "no hi ha rètols") ──
                if (!allFiles) {
                    utils.log('❌ [SCAN:wotts] Lectura de la carpeta de rètols FALLIDA (' + pathNAS +
                        '). NO es pot saber si hi ha wotts del bloc → es conserva l\'estat anterior.', 'ERROR');
                    return { tema: 'ERROR', list: [], failed: true };
                }
                if (allFiles.length === 0) return { tema: "PENDENT", list: [] };
    
                var fProg = (ctx.progData && ctx.progData.wott) ? ctx.progData.wott.toUpperCase() : 'TNV';
                var fBloc = ctx.bloque ? '_' + ctx.bloque + '_' : '_V1_';
                var prefix = (fProg + fBloc).toUpperCase();
    
                let filtered = allFiles.filter(function (f) {
                    var name = f.name.toUpperCase();
                    return name.indexOf(prefix) !== -1 && name.endsWith('.MOV');
                });
                // MECÀNICA D'INICI (2026-09-04): eliminada la guarda per mtime (22h).
                // El filtre per data del projecte (a continuació) és l'únic criteri vàlid.

                // ---- FILTRE PER DATA DEL PROJECTE (2026-09-02) ----
                // La guarda per mtime (22h) NO es suficient: un chyron d'ahir
                // generat fa menys de 22h encara hi cap dins la guarda, de manera
                // que s'importarien retols que NO pertanyen al projecte actual.
                // Exigim que la data del fitxer (extreta del nom si el porta, o de
                // la data de creacio/mtime com a fallback) coincideixi amb la data
                // de treball del projecte (ctx.dateDir). Si no es pot datar, es
                // DESCARTÀ (anti-contaminació: mai importar rètols d'un dia incert).
                // MECANISME ÚNIC de filtrat per data (Scan.filterByWorkDate).
                var dateTarget = ctx.dateDir ? String(ctx.dateDir).replace(/_/g, '') : null;
                if (dateTarget) {
                    var resF = this.filterByWorkDate(filtered, ctx.dateDir);
                    utils.log('[SCAN:wotts] Filtre per data projecte ' + dateTarget + ': ' + filtered.length + ' -> ' + resF.keep.length +
                        (resF.dropped.length ? ' (descartats ' + resF.dropped.length + " d'altres dies: " + resF.dropped.slice(0, 3).map(function(x){ return x.name; }).join(', ') + '...)' : '') +
                        (resF.noDate.length ? ' (NO datables descartats: ' + resF.noDate.slice(0, 3).map(function(x){ return x.name; }).join(', ') + '...)' : ''), 'INFO');
                    filtered = resF.keep;
                    if (filtered.length === 0) {
                        utils.log('[SCAN:wotts] Cap chyron de la data del projecte (' + dateTarget + "). No s'importara cap retol.", 'WARN');
                        return { tema: 'PENDENT', list: [] };
                    }
                }
    
                // 2. EXTRACCIÓ INTEL·LIGENT DEL TEMA
                const nameSource = filtered.find(f => f.name.includes("Tema-Titol")) || filtered[0];
                let tema = "PENDENT"; 

                const parts = nameSource.name.split('__');

                const reserved = ["INTR", "LÍNIA", "CHYRON", "GF", "PG", "TD", "TE", "P2", "P5", "P7", "LEAD", "BD", "BON DIA", "CHYRONS", "GUIO", "COL.LECCIO", "OFF", "CURT"];

                for (let i = 1; i < parts.length; i++) {
                    let currentBlock = parts[i];
                    let titleCandidate = "";
                    
                    const idMatch = currentBlock.match(/_[0-9]{5,}_/);
                    if (idMatch) {
                        tema = currentBlock.substring(0, idMatch.index).trim();
                    }

                    const upperCandidate = titleCandidate.toUpperCase();
                    const isReserved = reserved.some(r => upperCandidate.indexOf(r) !== -1);
                    
                    if (!isReserved && titleCandidate.length > 2) {
                        tema = titleCandidate;
                        break; 
                    }
                }

                if (tema === "PENDENT") {
                    const fallback = nameSource.name.split('_');
                    tema = fallback[5] ? fallback[5].replace(/\..+$/, "") : "TEMA";
                }

                utils.log(`🏷️ Tema detectat (Smart Filter): [${tema}]`, "INFO");

                return { 
                    tema: tema, 
                    list: filtered.map(f => ({
                        name: f.name, 
                        path: (pathNAS + f.name).replace(/\\/g, "/")
                    }))
                };
            } catch (e) {
                utils.log("💥 Error Scan.wotts: " + e.message, "ERROR");
                return { tema: "ERROR", list: [] };
            }
        },

        portadas: async function (ctx) {
            try {
                const pathNAS = ctx.config.rutas.chyrons;
                const allFiles = await utils.readFolder(pathNAS);
                if (!allFiles || allFiles.length === 0) return [];

                var fProg = (ctx.progData && ctx.progData.wott) ? ctx.progData.wott.toUpperCase() : 'TNV';
                var fBloc = ctx.bloque ? '_' + ctx.bloque + '_' : '_V1_';
                var prefix = (fProg + fBloc).toUpperCase();
    
                let filtered = allFiles.filter(function (f) {
                    var name = f.name.toUpperCase();
                    return name.indexOf(prefix) !== -1 && name.endsWith('.PNG') && name.indexOf('TEMA-TITOL') !== -1;
                });
    
                // MECÀNICA D'INICI (2026-09-04): eliminada la guarda per mtime (22h);
                // el filtre per data (a continuació) ja restringeix al dia de treball.
                let freshFiles = filtered;

                // ---- FILTRE PER DATA DEL PROJECTE (2026-09-02) ----
                // Mateix criteri que Scan.wotts: nomes portades de la data de
                // treball del projecte (ctx.dateDir). Data del nom (YYYYMMDD),
                // o created/mtime com a fallback; si no es pot datar, es descarta.
                // MECANISME ÚNIC de filtrat per data (Scan.filterByWorkDate).
                var dateTarget = ctx.dateDir ? String(ctx.dateDir).replace(/_/g, '') : null;
                if (dateTarget) {
                    var resF = this.filterByWorkDate(freshFiles, ctx.dateDir);
                    utils.log('[SCAN:portades] Filtre per data projecte ' + dateTarget + ': ' + freshFiles.length + ' -> ' + resF.keep.length +
                        (resF.dropped.length ? ' (descartats ' + resF.dropped.length + " d'altres dies: " + resF.dropped.slice(0, 3).map(function(x){ return x.name; }).join(', ') + '...)' : '') +
                        (resF.noDate.length ? ' (NO datables descartats: ' + resF.noDate.slice(0, 3).map(function(x){ return x.name; }).join(', ') + '...)' : ''), 'INFO');
                    freshFiles = resF.keep;
                }

                return freshFiles.map(function (f) { return { name: f.name, path: pathNAS + f.name }; });
            } catch (e) { return []; }
        },

        /**
         * srtFallback: Cerca un .SRT de RECANVI a la carpeta de verticalització (la MATEIXA
         * on viuen els MP4 del bloc) SENSE els filtres estrictes de Scan.mediaAssets.
         *
         * (2026-09-22) **SEMPRE dins de la DATA DE TREBALL.** Abans hi havia dos nivells sense
         * filtre de data — «prefix (qualsevol data)» i «qualsevol .SRT de la carpeta» — que
         * podien carregar subtítols D'UN ALTRE DIA: cas real, el TNC V1 del 22/09 va carregar
         * el .SRT del 21/09 «EMPRESES DE LLEURE… LA CERDANYA» ✗. Ara, si no hi ha cap .SRT de
         * la data de treball, NO es carrega res (es diu el motiu al log i al panell).
         *
         * Nivells (s'atura al primer amb candidats), tots filtrats per la data de treball:
         *   N1: {archivo}_{bloque}_ + DATA de treball
         *   N2: qualsevol .SRT de la DATA de treball
         * Dins de cada nivell es tria el MÉS RECENT (data del nom/creació desc).
         *
         * @param {Object} ctx - { config, progData, bloque, dateDir }
         * @returns {{name:string, path:string, level:number, reason:string, candidates:number}|null}
         */
        srtFallback: async function (ctx) {
            try {
                if (!ctx || !ctx.config || !ctx.config.rutas || !ctx.progData) return null;
                var dir = String(ctx.config.rutas.verticalitzacio || '');
                if (!dir) return null;
                var last = dir.charAt(dir.length - 1);
                if (last !== '\\' && last !== '/') dir += '\\';

                var allFiles = await utils.readFolder(dir);
                if (!allFiles || allFiles.length === 0) {
                    utils.log('[SCAN:srtFallback] Carpeta inaccessible o buida: ' + dir, 'WARN');
                    return null;
                }
                var srts = allFiles.filter(function (f) { return /\.srt$/i.test(f.name || ''); });
                if (srts.length === 0) {
                    utils.log('[SCAN:srtFallback] Cap .SRT a ' + dir, 'WARN');
                    return null;
                }

                var self = this;
                // Més recent primer: data del nom/creació (YYYYMMDD) desc, després created.
                srts.sort(function (a, b) {
                    var da = self._fileDateYYYYMMDD(a) || '';
                    var db = self._fileDateYYYYMMDD(b) || '';
                    if (da !== db) return db.localeCompare(da);
                    return (b.created || 0) - (a.created || 0);
                });

                var dateTarget = ctx.dateDir ? String(ctx.dateDir).replace(/_/g, '') : null;
                if (!dateTarget) {
                    utils.log('[SCAN:srtFallback] Sense data de treball (dateDir) → NO es carrega cap .SRT (per seguretat).', 'WARN');
                    return null;
                }
                var progUp = String(ctx.progData.archivo || '').toUpperCase();
                var bloqueUp = String(ctx.bloque || '').toUpperCase();
                var prefix = progUp + '_' + bloqueUp + '_';
                var hasPrefix = function (f) { return progUp && (f.name || '').toUpperCase().indexOf(prefix) !== -1; };
                var ofDate = function (f) { return self._fileDateYYYYMMDD(f) === dateTarget; };

                // (2026-09-22) FILTRE ESTRICTE DE DATA: només .SRT del dia de treball.
                var delDia = srts.filter(ofDate);
                if (delDia.length === 0) {
                    utils.log('[SCAN:srtFallback] Cap .SRT de la data ' + dateTarget + ' a ' + dir +
                        ' (' + srts.length + ' .SRT d\'altres dies descartats). NO es carrega cap subtítol.', 'WARN');
                    return null;
                }

                // (2026-09-23) NOMÉS N1: el .SRT ha de ser DEL PROGRAMA I DEL BLOC actuals i del dia
                // de treball. L'antic N2 ("qualsevol .SRT del dia") s'ha ELIMINAT de soca-rel:
                // si no hi ha el .SRT del bloc, NO es carrega res — s'avisa i prou (queixa de
                // l'usuari: s'hi carregava un SRT de MATINS_V5 en un projecte TNC).
                var levels = [
                    { level: 1, reason: 'prefix programa_bloc + data de treball', list: delDia.filter(hasPrefix) }
                ];
                for (var i = 0; i < levels.length; i++) {
                    var L = levels[i];
                    if (L.list.length === 0) continue;
                    var pickF = L.list[0];
                    utils.log('[SCAN:srtFallback] N' + L.level + ' (' + L.reason + '): ' + L.list.length +
                        ' candidat(s) · triat "' + pickF.name + '" (' + (self._fileDateYYYYMMDD(pickF) || 'sense data') + ')', 'INFO');
                    return {
                        name: pickF.name,
                        path: dir + pickF.name,
                        level: L.level,
                        reason: L.reason,
                        candidates: L.list.length
                    };
                }
                return null;
            } catch (e) {
                utils.log('💥 [SCAN:srtFallback] ' + e.message, 'ERROR');
                return null;
            }
        }
    };

    window.Scan = FASTPASS_UI.Logic.Scan;
})();
