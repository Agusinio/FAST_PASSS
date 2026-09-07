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
                if (!allFiles || allFiles.length === 0) return { mp4: null, srt: null };

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
                const allFiles = await utils.readFolder(pathNAS);
                if (!allFiles || allFiles.length === 0) return { tema: "PENDENT", list: [] };
    
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
                // la data de creacio com a fallback) coincideixi amb la data de
                // treball del projecte (ctx.dateDir). Si no es pot datar el fitxer,
                // es conserva per no trencar formats antics sense data al nom.
                var dateTarget = ctx.dateDir ? String(ctx.dateDir).replace(/_/g, '') : null;
                if (dateTarget) {
                    var beforeCount = filtered.length;
                    var keep = [];
                    var droppedDate = [];
                    for (var wI = 0; wI < filtered.length; wI++) {
                        var fileDate = this._extractDateFromFileName(filtered[wI].name);
                        if (!fileDate && filtered[wI].created) {
                            var cd = new Date(filtered[wI].created);
                            if (!isNaN(cd.getTime())) {
                                fileDate = '' + cd.getFullYear() +
                                    ('0' + (cd.getMonth() + 1)).slice(-2) +
                                    ('0' + cd.getDate()).slice(-2);
                            }
                        }
                        if (fileDate && fileDate !== dateTarget) { droppedDate.push(filtered[wI].name); }
                        else { keep.push(filtered[wI]); }
                    }
                    utils.log('[SCAN:wotts] Filtre per data projecte ' + dateTarget + ': ' + beforeCount + ' -> ' + keep.length +
                        (droppedDate.length ? ' (descartats ' + droppedDate.length + " d'altres dies: " + droppedDate.slice(0, 3).join(', ') + '...)' : ''), 'INFO');
                    filtered = keep;
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
                // treball del projecte (ctx.dateDir). Data del nom (YYYYMMDD) o
                // de la creacio com a fallback; si no es pot datar, es conserva.
                var dateTarget = ctx.dateDir ? String(ctx.dateDir).replace(/_/g, '') : null;
                if (dateTarget) {
                    var beforeCount = freshFiles.length;
                    var keep = [];
                    var droppedDate = [];
                    for (var pI = 0; pI < freshFiles.length; pI++) {
                        var fileDate = this._extractDateFromFileName(freshFiles[pI].name);
                        if (!fileDate && freshFiles[pI].created) {
                            var cd = new Date(freshFiles[pI].created);
                            if (!isNaN(cd.getTime())) {
                                fileDate = '' + cd.getFullYear() +
                                    ('0' + (cd.getMonth() + 1)).slice(-2) +
                                    ('0' + cd.getDate()).slice(-2);
                            }
                        }
                        if (fileDate && fileDate !== dateTarget) { droppedDate.push(freshFiles[pI].name); }
                        else { keep.push(freshFiles[pI]); }
                    }
                    utils.log('[SCAN:portades] Filtre per data projecte ' + dateTarget + ': ' + beforeCount + ' -> ' + keep.length +
                        (droppedDate.length ? ' (descartats ' + droppedDate.length + " d'altres dies: " + droppedDate.slice(0, 3).join(', ') + '...)' : ''), 'INFO');
                    freshFiles = keep;
                }

                return freshFiles.map(function (f) { return { name: f.name, path: pathNAS + f.name }; });
            } catch (e) { return []; }
        }
    };

    window.Scan = FASTPASS_UI.Logic.Scan;
})();
