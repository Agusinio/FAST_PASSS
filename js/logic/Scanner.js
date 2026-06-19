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

        /**
         * Extreu YYYYMMDD del nom d'un fitxer de media (MP4/SRT/MOV/PNG).
         * Format esperat: ..._YYYYMMDDHHMMSS_... o ..._YYYYMMDD_...
         * @param {string} name - Nom del fitxer
         * @returns {string|null} "20260618" o null
         */
        _extractDateFromFileName: function (name) {
            if (!name) return null;
            var parts = name.split('_');
            // Cercar un segment de 8 dígits (YYYYMMDD) en qualsevol posició
            for (var i = 0; i < parts.length; i++) {
                if (/^\d{8}$/.test(parts[i])) {
                    return parts[i];
                }
            }
            // També buscar dins d'un segment de 14 dígits (YYYYMMDDHHMMSS)
            for (var j = 0; j < parts.length; j++) {
                if (/^\d{14}$/.test(parts[j])) {
                    return parts[j].substring(0, 8);
                }
            }
            return null;
        },

        /**
         * Filtra fitxers per data extreta del nom (NO per mtime).
         * @param {Array} files - Llista de fitxers [{name, mtime}]
         * @param {string} datePrefix - Data en format YYYYMMDD (ex: "20260618")
         * @param {string} nameFilter - Substring a buscar al nom (ex: "TNV_V1_")
         * @param {string} extension - Extensió del fitxer (ex: ".MP4", ".MOV")
         * @returns {Array} Fitxers filtrats
         */
        _filterByDateInName: function (files, datePrefix, nameFilter, extension) {
            if (!files || files.length === 0) return [];
            var prefix = nameFilter.toUpperCase();
            var ext = extension.toUpperCase();
            var dateTarget = datePrefix; // "20260618"
            return files.filter(function (f) {
                var name = f.name.toUpperCase();
                if (name.indexOf(prefix) === -1) return false;
                if (ext && !name.endsWith(ext)) return false;
                // Filtrar per data en el nom
                if (dateTarget) {
                    var fileDate = this._extractDateFromFileName(f.name);
                    if (!fileDate || fileDate !== dateTarget) return false;
                }
                return true;
            }.bind(this));
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

        mediaAssets: async function (ctx) {
            try {
                const pathNAS = ctx.config.rutas.verticalitzacio;
                const allFiles = await utils.readFolder(pathNAS);
                if (!allFiles || allFiles.length === 0) return { mp4: null, srt: null };

                // Convertir dateDir (YYYY_MM_DD) a datePrefix (YYYYMMDD) per filtrar per data en el nom
                var datePrefix = ctx.dateDir ? ctx.dateDir.replace(/_/g, '') : null;
                var prefix = ctx.progData.archivo + '_' + ctx.bloque + '_';

                var validFiles = this._filterByDateInName(allFiles, datePrefix, prefix, null);
                // Si no trobem res amb filtre de data, intentem sense data (fallback legacy)
                if (validFiles.length === 0) {
                    utils.log('⚠️ [SCAN:media] Cap MP4/SRT amb data ' + datePrefix + '. Intentant sense filtre de data...', 'DEBUG');
                    validFiles = this._filterByDateInName(allFiles, null, prefix, null);
                }

                if (validFiles.length === 0) return { mp4: null, srt: null };

                // Ordenar per data en el nom (més recent primer)
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

                return { mp4: getAsset('.MP4'), srt: getAsset('.SRT') };
            } catch (e) { return { mp4: null, srt: null }; }
        },

        wotts: async function (ctx) {
            try {
                const pathNAS = ctx.config.rutas.chyrons;
                const allFiles = await utils.readFolder(pathNAS);
                if (!allFiles || allFiles.length === 0) return { tema: "PENDENT", list: [] };

                var datePrefix = ctx.dateDir ? ctx.dateDir.replace(/_/g, '') : null;
                var fProg = (ctx.progData && ctx.progData.wott) ? ctx.progData.wott.toUpperCase() : 'TNV';
                var fBloc = ctx.bloque ? '_' + ctx.bloque + '_' : '_V1_';
                var nameFilter = fProg + fBloc;

                var filtered = this._filterByDateInName(allFiles, datePrefix, nameFilter, '.MOV');
                if (filtered.length === 0) {
                    utils.log('⚠️ [SCAN:wotts] Cap .MOV amb data ' + datePrefix + '. Intentant sense filtre de data...', 'DEBUG');
                    filtered = this._filterByDateInName(allFiles, null, nameFilter, '.MOV');
                }

                if (filtered.length === 0) return { tema: 'PENDENT', list: [] };

                // Ordenar per data en el nom
                filtered.sort(function (a, b) {
                    var da = this._extractDateFromFileName(a.name);
                    var db = this._extractDateFromFileName(b.name);
                    return (db || '').localeCompare(da || '');
                }.bind(this));

                // 2. EXTRACCIÓ INTEL·LIGENT DEL TEMA
                // 1. Buscamos el archivo fuente (preferiblemente el que dice Tema-Titol)
                const nameSource = filtered.find(f => f.name.includes("Tema-Titol")) || filtered[0];
                let tema = "PENDENT"; 

                // 2. Dividimos por el doble subrayado __
                const parts = nameSource.name.split('__');

                // 3. Lista de palabras prohibidas (Realización)
                const reserved = ["INTR", "LÍNIA", "CHYRON", "GF", "PG", "TD", "TE", "P2", "P5", "P7", "LEAD", "BD", "BON DIA", "CHYRONS", "GUIO", "COL.LECCIO", "OFF", "CURT"];

                // 4. Recorremos los bloques después del prefijo técnico (empezamos en i=1)
                for (let i = 1; i < parts.length; i++) {
                    let currentBlock = parts[i];
                    
                    // De este bloque, el título es lo que hay antes del ID de 6 cifras
                    // Buscamos el patrón _336346_ o similar
                    let titleCandidate = "";
                    
                    const idMatch = currentBlock.match(/_[0-9]{5,}_/);
                    if (idMatch) {
                        // Cortamos el nombre DESDE el inicio HASTA la posición del ID
                        tema = currentBlock.substring(0, idMatch.index).trim();
                    }

                    const upperCandidate = titleCandidate.toUpperCase();
                    
                    // VALIDACIÓN: ¿Es una palabra reservada o es demasiado corto?
                    const isReserved = reserved.some(r => upperCandidate.indexOf(r) !== -1);
                    
                    if (!isReserved && titleCandidate.length > 2) {
                        tema = titleCandidate; // ¡Encontrado!
                        break; 
                    }
                }

                // 5. Fallback por si todo ha fallado
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

                var datePrefix = ctx.dateDir ? ctx.dateDir.replace(/_/g, '') : null;
                var fProg = (ctx.progData && ctx.progData.wott) ? ctx.progData.wott.toUpperCase() : 'TNV';
                var fBloc = ctx.bloque ? '_' + ctx.bloque + '_' : '_V1_';
                var nameFilter = fProg + fBloc;

                // Portades: filtrar per TEMA-TITOL i .PNG
                var allFiltered = this._filterByDateInName(allFiles, datePrefix, nameFilter, '.PNG');
                var filtered = allFiltered.filter(function (f) {
                    return f.name.toUpperCase().indexOf('TEMA-TITOL') !== -1;
                });

                if (filtered.length === 0) {
                    utils.log('⚠️ [SCAN:portadas] Cap .PNG amb data ' + datePrefix + '. Intentant sense filtre de data...', 'DEBUG');
                    var allLegacy = this._filterByDateInName(allFiles, null, nameFilter, '.PNG');
                    filtered = allLegacy.filter(function (f) {
                        return f.name.toUpperCase().indexOf('TEMA-TITOL') !== -1;
                    });
                }

                // Ordenar per data en el nom
                filtered.sort(function (a, b) {
                    var da = this._extractDateFromFileName(a.name);
                    var db = this._extractDateFromFileName(b.name);
                    return (db || '').localeCompare(da || '');
                }.bind(this));

                return filtered.map(function (f) { return { name: f.name, path: pathNAS + f.name }; });
            } catch (e) { return []; }
        }
    };

    window.Scan = FASTPASS_UI.Logic.Scan;
})();