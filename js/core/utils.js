/** 
 * =================================================================================
 * Utils.js - VERSIÓ ULTRA-ATÒMICA (Pla LIPO)
 * =================================================================================
 */
(function() {
    var csInterface = new CSInterface();
    window.FASTPASS_UI = window.FASTPASS_UI || {};
    
    window.FASTPASS_UI.Utils = {
        isJsxReady: false,
        csInterface: csInterface,

        _logBuffer: [],
        _debugLogPath: null,
        // Auditoria de crides JSX: registra cada script enviat a Premiere per poder
        // comparar les accions REALS amb les que el codi pretén executar.
        _auditBuffer: [],
        _auditPath: null,
        // Filtre de logs per tema: string amb keywords separades per coma o null (desactivat).
        // Quan està actiu, log() NOMÉS escriu els missatges que continguin alguna keyword.
        // ⚠️ TEMPORAL (2026-09-04): DESACTIVAT per poder veure els logs del botó Main
        // (diagnòstic deriva IN del MP4). Per reactivar el filtre: setLogFilter('DoblePantalla')
        // o setLogFilter('Main, ProgramStart, sweet') des de la consola del panell.
        _logFilter: null,

        /**
         * Activa el filtre de logs per tema. Ex: setLogFilter('DoblePantalla') o
         * setLogFilter('Chyrons, PAS') o setLogFilter('') per desactivar.
         */
        setLogFilter: function(keywords) {
            this._logFilter = (keywords && String(keywords).trim()) ? String(keywords).split(',').map(function(k) { return k.trim().toLowerCase(); }).filter(Boolean) : null;
            this.log("🎛️ Filtre de logs: " + (this._logFilter ? this._logFilter.join(', ') : 'DESACTIVAT'), "DEBUG");
        },

        clearLogFilter: function() {
            this.setLogFilter("");
        },

        /**
         * Inicialitza (o reinicia) el fitxer de log per al projecte actiu.
         * Es crida des de _runNew() i _runLoad() per tenir un log per projecte.
         * @param {string} folderPath - Ruta absoluta a la carpeta del projecte (ex: \\...\\09_06_2026\)
         * @param {string} projectName - Nom del fitxer .prproj (ex: Pruebas_TNV_V1_TEMA.prproj)
         */
        _setLogPath: function(folderPath, projectName) {
            var normalized = folderPath.replace(/\\/g, '\\').replace(/\/$/, '');
            // Log comú a la carpeta PROVES (per seguir qualsevol projecte des d'un únic fitxer obert a l'editor)
            var provIdx = normalized.toUpperCase().indexOf('\\PROVES\\');
            if (provIdx > 0) {
                normalized = normalized.substring(0, provIdx) + '\\PROVES';
            }
            this._debugLogPath = normalized + '\\FASTPASS.log';
            this._logBuffer = [];
            try {
                window.cep.fs.writeFile(this._debugLogPath, '');
            } catch(e) {}
            // Fitxer d'auditoria de crides JSX (sense filtre de tema)
            this._auditPath = normalized + '\\FASTPASS_audit.log';
            this._auditBuffer = [];
            try {
                window.cep.fs.writeFile(this._auditPath, '');
            } catch(e) {}
            this.log("📄 Log iniciat per a: " + projectName, "DEBUG");
        },

        /**
         * Retorna timestamp ISO local: [YYYY-MM-DD HH:MM:SS]
         */
        _timestamp: function() {
            var d = new Date();
            var pad = function(n) { return (n < 10 ? '0' : '') + n; };
            return '[' + d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
                   ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()) + ']';
        },

        log: function(msg, level) { 
            // Filtre de logs per tema (estalvia tokens/ruido al chat).
            // Els missatges de nivell ERROR sempre es mostren.
            if (this._logFilter && level !== "ERROR") {
                var filter = this._logFilter;
                if (typeof filter === "string") filter = [String(filter).toLowerCase()];
                var _m = String(msg).toLowerCase();
                var _match = false;
                for (var _i = 0; _i < filter.length; _i++) {
                    if (_m.indexOf(String(filter[_i]).toLowerCase()) !== -1) { _match = true; break; }
                }
                if (!_match) return;
            }
            const colors = { "INFO": "🔵", "DEBUG": "🟢", "ERROR": "🔴", "WARN": "🟡" };
            var ts = this._timestamp();
            var formatted = ts + ' ' + (colors[level || "INFO"] || '🔵') + ' [FASTPASS]: ' + msg;
            console.log(formatted);
            // Escriure al fitxer de debug del projecte perquè el Cline pugui llegir-lo
            if (this._debugLogPath) {
                this._logBuffer.push(formatted);
                try {
                    window.cep.fs.writeFile(this._debugLogPath, this._logBuffer.join('\n') + '\n');
                } catch(e) {}
            }
        },

        clearLogFile: function() {
            this._logBuffer = [];
            if (this._debugLogPath) {
                try {
                    window.cep.fs.writeFile(this._debugLogPath, '');
                    this.log("🧹 Log file reiniciat", "DEBUG");
                } catch(e) {}
            }
        },

        /**
         * forceLog: Escriu SEMPRE al console i al fitxer FASTPASS.log, saltant-se
         * el filtre de tema (_logFilter). Útil per a traçes de diagnòstic.
         */
        forceLog: function(msg) {
            try {
                var ts = this._timestamp();
                var formatted = ts + ' 🟢 [FASTPASS]: ' + msg;
                console.log(formatted);
                if (this._debugLogPath) {
                    this._logBuffer.push(formatted);
                    window.cep.fs.writeFile(this._debugLogPath, this._logBuffer.join('\n') + '\n');
                } else {
                    // Fallback: arrel de la mateixa extensió (sempre accessible)
                    if (!this._extLogPath) {
                        var href = window.location.href;
                        var qi = href.indexOf('/index.html');
                        if (qi > 0) {
                            var p = decodeURIComponent(href.substring(0, qi));
                            if (p.indexOf('file:///') === 0) p = p.substring(8);
                            this._extLogPath = p.replace(/\//g, '\\') + '\\_keyframe_trace.log';
                        }
                    }
                    if (this._extLogPath) {
                        var prev = '';
                        try { prev = window.cep.fs.readFile(this._extLogPath) || ''; } catch(e) {}
                        window.cep.fs.writeFile(this._extLogPath, prev + formatted + '\n');
                    }
                }
            } catch(e) {}
        },

        /**
         * Pont asíncron cap al motor ExtendScript (JSX).
         */
        callJSX: function(script) {
            // Auditoria: registra cada script enviat a Premiere (per poder comparar
            // les accions reals amb el que el codi pretén executar)
            if (this._auditPath) {
                try {
                    this._auditBuffer.push(this._timestamp() + " JSX> " + script);
                    window.cep.fs.writeFile(this._auditPath, this._auditBuffer.join('\n') + '\n');
                } catch(e) {}
            }
            // Si estem en mode batching i NO és una crida de consulta crítica (com Anim.x), encolar
            if (this.Batch._isBatching && !script.includes("Anim.x") && !script.includes(".get") && !script.includes(".active")) {
                this.Batch._queue.push(script);
                return Promise.resolve("QUEUED");
            }

            return new Promise(function(resolve) {
                var isAnimX = script.indexOf("Anim.x") !== -1;
                var safeScript = "try{" + script + "}catch(e){'ERR:'+e.message}";
                csInterface.evalScript(safeScript, function(res) {
                    if (!res || res === "undefined") {
                        resolve("");
                    } else if (res.indexOf("ERR:") === 0) {
                        window.FASTPASS_UI.Utils.log("💥 [JSX ERROR]: " + res, "ERROR");
                        resolve("[]");
                    } else {
                        resolve(res);
                    }
                });
            });
        },

        /**
         * Sistema de Batching per a comandes JSX (Fase 1 Mejora Eficiencia)
         */
        Batch: {
            _queue: [],
            _isBatching: false,
            begin: function() { 
                this._isBatching = true; 
                this._queue = [];
                window.FASTPASS_UI.Utils.log("📥 Batching JSX iniciat...", "DEBUG");
            },
            flush: async function() {
                if (this._queue.length === 0) {
                    this._isBatching = false;
                    return "EMPTY";
                }
                const fullScript = this._queue.join(";\n");
                const count = this._queue.length;
                this._queue = [];
                this._isBatching = false;
                
                window.FASTPASS_UI.Utils.log(`📤 Enviant batch de ${count} comandes...`, "DEBUG");
                return await window.FASTPASS_UI.Utils.callJSX(fullScript);
            }
        },

        /**
         * Algoritme de cerca binària per a llistes ordenades per temps (Fase 2)
         */
        binarySearchForTime: function(list, time, timeKey = 'start') {
            let low = 0;
            let high = list.length - 1;
            while (low <= high) {
                const mid = Math.floor((low + high) / 2);
                const midTime = list[mid][timeKey];
                if (midTime === time) return mid;
                if (midTime < time) low = mid + 1;
                else high = mid - 1;
            }
            return high; // Retorna l'índex immediatament anterior o coincident
        },

        readFolder: async function(path) {
            // 1. Intentar con CEP (más rápido para rutas locales)
            var result = window.cep.fs.readdir(path);
            
            if (result.err === 0) {
                var filenames = result.data;
                var filesWithStats = [];
                var statFails = [];
        
                var folderPath = path.replace(/[\\/]*$/, "\\");
        
                for (var i = 0; i < filenames.length; i++) {
                    var name = filenames[i];
                    var fullPath = folderPath + name;
        
                    var stat = window.cep.fs.stat(fullPath);
                    
                    if (stat.err === 0) {
                        filesWithStats.push({
                            name: name,
                            mtime: stat.data.mtime,
                            created: stat.data.creationTime || stat.data.mtime
                        });
                    } else {
                        filesWithStats.push({ name: name, mtime: 0, created: 0 });
                        statFails.push(name);
                    }
                }

                // ── Robustesa UNC (2026-09-07) ──────────────────────────────────
                // Si alguns stat han fallat (comú en rutes remotes), completem les
                // dates via JSX (scanDirectory retorna modified) per no perdre la
                // datació dels fitxers. Sense datació, el filtre per dia descartaria
                // fitxers legítims o (abans del filtre dur) en colaria d'altres dies.
                if (statFails.length > 0) {
                    try {
                        var jsonResult = await this.callJSX(`IO.scanDirectory('${this.escape(path)}')`);
                        if (jsonResult && jsonResult !== "[]" && jsonResult.indexOf('ERR') !== 0) {
                            var items = JSON.parse(jsonResult);
                            var byName = {};
                            for (var ii = 0; ii < items.length; ii++) byName[items[ii].name] = items[ii];
                            for (var jj = 0; jj < filesWithStats.length; jj++) {
                                if ((filesWithStats[jj].mtime === 0 || filesWithStats[jj].created === 0)
                                    && byName[filesWithStats[jj].name]) {
                                    var it = byName[filesWithStats[jj].name];
                                    filesWithStats[jj].mtime = it.modified || 0;
                                    filesWithStats[jj].created = it.created || it.modified || 0;
                                }
                            }
                        }
                    } catch (eJsx) { /* el fallback per fitxers no és crític */ }
                }
                return filesWithStats;
            } else {
                // 2. Si CEP falla (error 3: acceso denegado o ruta UNC), usar ExtendScript
                this.log(`⚠️ CEP error ${result.err} leyendo carpeta, intentando via JSX: ${path}`, "DEBUG");
                try {
                    var jsonResult = await this.callJSX(`IO.scanDirectory('${this.escape(path)}')`);
                    if (jsonResult && jsonResult !== "[]") {
                        var items = JSON.parse(jsonResult);
                        // Convertir al formato esperado: { name, mtime }
                        var converted = items.map(function(item) {
                            return {
                                name: item.name,
                                mtime: item.modified || 0,
                                created: item.created || item.modified || 0,
                                size: item.size || 0
                            };
                        });
                        return converted;
                    }
                    return [];
                } catch (e) {
                    this.log(`💥 Error en scanDirectory JSX: ${e.message}`, "ERROR");
                    return [];
                }
            }
        },

        /**
         * Crea directoris de forma recursiva al NAS/Local des de JS
         */
        ensureFolders: function(path) {
            const fs = window.cep.fs;
            let normalizedPath = path.replace(/\//g, '\\');
            let parts = normalizedPath.split('\\');
            let currentPath = "";
        
            // Gestió de ruta UNC (\\DSMEDIA07...)
            let isUNC = normalizedPath.indexOf('\\\\') === 0;
            this.log(`🔍 [JS-FS] Analitzant ruta: ${normalizedPath} (UNC: ${isUNC})`, "DEBUG");
            
            // Si és UNC, el començament és \\SERVIDOR\RECURS
            if (isUNC) {
                currentPath = '\\\\' + parts[2] + '\\' + parts[3];
                var startIndex = 4;
            } else {
                currentPath = parts[0]; // Unitat C: o similar
                var startIndex = 1;
            }
        
            for (let i = startIndex; i < parts.length; i++) {
                if (!parts[i]) continue;
                currentPath += '\\' + parts[i];
                
                let stat = fs.stat(currentPath);
                
                // 📍 Si no existe (err 2) O si hay un error de acceso (err 3, etc.)
                // intentamos crearla de todos modos por si es un subdirectorio nuevo.
                if (stat.err !== 0) { 
                    let result = fs.makedir(currentPath);
                    
                    if (result.err === 0) {
                        this.log(`✅ [JS-FS] Carpeta creada: ${currentPath}`, "DEBUG");
                    } else if (result.err === 82) { // 82 = Ya existe (pero el stat falló por red)
                        this.log(`ℹ️ [JS-FS] La carpeta ya existía: ${currentPath}`, "DEBUG");
                    } else {
                        // Solo logueamos como error si realmente no podemos crearla
                        this.log(`⚠️ [JS-FS] Intentant crear ${currentPath}: Codi ${result.err}`, "DEBUG");
                    }
                }
            }
            return true;
        },


        /**
         * Ingesta de fitxers a Premiere Pro.
         * @param {Array} pathList - Llista de rutes (UNC o locals).
         * @param {string} binName - Nom del Bin de destí (o "root").
         */
        importList: async function(pathList, binName) {
            if (!pathList || !pathList.length) return;
        
            // Extraemos solo el path si es un objeto
            const rawPaths = pathList.map(item => item.path || item);
        
            try {
                // 📍 BLINDAJE: Convertimos a JSON y escapamos comillas simples para que no rompan el callJSX
                const payload = JSON.stringify(rawPaths).replace(/'/g, "\\'");
                
                //console.log("📤 Enviando Payload al JSX:", payload); // Veremos qué sale exactamente
                
                const res = await this.callJSX(`FASTPASS.IO.importFiles('${payload}', '${binName}')`);
                
                if (res !== "OK") throw new Error(res);
                //this.log(`✅ Ingesta OK a ${binName}`, "INFO");
            } catch (e) {
                this.log(`🔴 Error Ingesta: ${e.message}`, "ERROR");
            }
        },

        sanitizeName: function(str) {
            if (!str) return "Unnamed_Item";
            // 1. Treiem accents (normalize NFD + regex)
            const normalized = str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
            // 2. Treiem caràcters prohibits de fitxers i limitem a 60 caràcters
            var pattern = new RegExp('[<>:"/\\\\|?*#]', 'g'); 
            return normalized.replace(pattern, "").trim().substring(0, 60);
        },

        escape: function(str) {
            if (!str) return "";
            // Escapem caràcters perillosos per a injecció en literals ExtendScript (ES3).
            // Els caràcters de control (\n \r \t) es converteixen a seqüències d'escapada
            // per evitar que trenquin el literal de string dins d'evalScript().
            // Les barres invertides i comilles simples també s'escapen.
            return str
                .replace(/\\/g, "\\\\")
                .replace(/'/g, "\\'")
                .replace(/\n/g, "\\n")
                .replace(/\r/g, "\\r")
                .replace(/\t/g, "\\t");
        },

        delay: function(ms) { 
            return new Promise(resolve => setTimeout(resolve, ms)); 
        },

        getFormattedDate: function() {
            var d = new Date();
            var day = ("0" + d.getDate()).slice(-2);
            var month = ("0" + (d.getMonth() + 1)).slice(-2);
            var year = d.getFullYear();
            return year + "_" + month + "_" + day;
        },

        /**
         * getYesterdayDateDir: Retorna la data del dia natural anterior (YYYY_MM_DD).
         * MECÀNICA D'INICI (2026-09-04): usada pel Ctrl+clic (mode correcció) i Ctrl+FOTO.
         * @returns {string} Ex: "2026_09_06"
         */
        getYesterdayDateDir: function() {
            var d = new Date();
            d.setDate(d.getDate() - 1);
            var dd = ("0" + d.getDate()).slice(-2);
            var mm = ("0" + (d.getMonth() + 1)).slice(-2);
            return "" + d.getFullYear() + "_" + mm + "_" + dd;
        },

        /**
         * Valida que un dateDir (DD_MM_YYYY) estigui dins de la finestra
         * temporal permesa per a la cerca de projectes en directoris germans.
         *
         * Regles:
         *   - Sempre s'accepta el dia d'avui.
         *   - Sempre s'accepta ahir (l'editor pot necessitar obrir el projecte
         *     del dia anterior fins al dia següent).
         *   - Qualsevol data anterior (fa 2+ dies) es rebutja.
         *   - NO s'usa mtime del directori perquè no és fiable (s'actualitza
         *     amb auto-save, .lock, etc.).
         *
         * @param {string} dateDirStr - Data en format DD_MM_YYYY, ex: "26_05_2026"
         * @returns {boolean} true si la data està dins de la finestra permesa
         */
        isDateDirInTemporalWindow: function(dateDirStr) {
            if (!dateDirStr) return false;

            // Nomes s'accepten directoris d'avui o ahir (finestra de 22h implicita:
            // cada projecte viu al seu directori de data, i l'editor pot necessitar
            // obrir-lo fins al dia seguent). Qualsevol data anterior es rebutja.
            // NO usem dirMtime perque no es fiable (s'actualitza amb auto-save, locks...).
            // Format esperat: YYYY_MM_DD
            var parts = dateDirStr.split('_');
            if (parts.length !== 3) return false;
            var y = parseInt(parts[0], 10);
            var m = parseInt(parts[1], 10);
            var d = parseInt(parts[2], 10);
            if (isNaN(d) || isNaN(m) || isNaN(y)) return false;

            var dirDate = new Date(y, m - 1, d);
            var now = new Date();
            var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            var yesterday = new Date(today);
            yesterday.setDate(yesterday.getDate() - 1);

            var dirTime = dirDate.getTime();
            var accepted = (dirTime === today.getTime() || dirTime === yesterday.getTime());
            if (window.FASTPASS_UI && window.FASTPASS_UI.Utils) {
                window.FASTPASS_UI.Utils.log('🔒 [TemporalWindow] dir=' + dateDirStr + ' accepted=' + accepted, 'DEBUG');
            }
            return accepted;
        },

        /**
         * D7.5: Extreu la data d'emissió en format DD_MM_YYYY des del nom
         * d'un fitxer d'escaleta. És la FONT ÚNICA de dateDir.
         *
         * Format esperat del filename: TN_VESPRE_20260517_215504.json
         * Extrau el penúltim segment (YYYYMMDD) i el converteix a DD_MM_YYYY.
         *
         * @param {string} filename - Nom del fitxer (sense ruta), ex: "TN_VESPRE_20260517_215504.json"
         * @returns {string|null} Data en format DD_MM_YYYY, o null si no es pot extreure
         */
        extractDateFromEscaletaFilename: function(filename) {
            if (!filename) return null;
            var noExt = filename.replace(/\.json$/i, '');
            var parts = noExt.split('_');
            if (parts.length < 2) return null;
            var yyyymmdd = null;
            // Nou format: YYYYMMDD al segment [0]
            if (/^\d{8}$/.test(parts[0])) {
                yyyymmdd = parts[0];
            } else {
                // Fallback: format antic (data al penultim segment)
                var old = parts[parts.length - 2];
                if (old && old.length === 8 && /^\d{8}$/.test(old)) {
                    yyyymmdd = old;
                }
            }
            if (!yyyymmdd) return null;
            var dd = yyyymmdd.substring(6, 8);
            var mm = yyyymmdd.substring(4, 6);
            var yyyy = yyyymmdd.substring(0, 4);
            return yyyy + '_' + mm + '_' + dd;
        },

        /**
         * Extreu la data d'emissió en format YYYYMMDD (prefix) des del nom
         * d'un fitxer d'escaleta. S'usa per filtrar JSONs per data exacta.
         * @param {string} filename
         * @returns {string|null} "20260618" o null
         */
        extractDatePrefixFromFilename: function(filename) {
            if (!filename) return null;
            var noExt = filename.replace(/\.json$/i, '');
            var parts = noExt.split('_');
            if (parts.length >= 1 && /^\d{8}$/.test(parts[0])) {
                return parts[0];
            }
            return null;
        },

        /**
         * Converteix format "00.46" o "01.00" a segons (float).
         */
        timeToSeconds: function(tcStr) {
            if (!tcStr) return 0;
            const parts = tcStr.split('.');
            if (parts.length === 1) return parseFloat(parts[0]);
            const m = parseFloat(parts[0]) || 0;
            const s = parseFloat(parts[1]) || 0;
            return (m * 60) + s;
        },

        handleError: function(e, context) {
            this.log(`💥 [${context}] Error: ${e.message}`, "ERROR");
            this.status(`Error en ${context}`, "error");
        },

        status: function(msg, type) {
            const el = document.getElementById('estado');
            if (!el) return;
            el.innerText = msg;
            el.className = "status-" + (type || "debug");
        },

        updateUIState: function(state) {
            const main = document.getElementById('main-content');
            if (main) main.classList.toggle('busy', state === 'BUSY');
        },

        /**
         * 🛡️ SEGURETAT: Verifica si la seqüència activa en Premiere coincideix 
         * amb el context triat al panell.
         */
        validateActiveSequence: async function() {
            const state = window.FASTPASS_UI.State;
            const config = window.FASTPASS_UI.Config.get();
            const elProg = document.getElementById('programa');
            const elBloc = document.getElementById('bloc');
            
            if (!elProg || !elBloc) return true; // Fail-safe si no hi ha UI
            
            // Actualizar la secuencia activa desde Premiere
            const activeSeq = await this.refreshActiveSequence();
            
            const progKey = elProg.value;
            const blocVal = elBloc.value;
            
            // Si estem en una seqüència buida o NO n'hi ha cap de activa
            if (!activeSeq) {
                this.status("⚠️ Cap seqüència activa!", "error");
                return false;
            }

            // Validació per paraules clau (Tokens)
            // Busquem si el nom de la seqüència inclou el codi del programa i el bloc
            const progData = config.mapeoProgramas[progKey];
            const progFileName = progData ? progData.archivo : "";
            const progWott = progData ? progData.wott : "";
            
            const hasProg = activeSeq.indexOf(progFileName) !== -1 || activeSeq.indexOf(progWott) !== -1;
            const hasBloc = activeSeq.indexOf(blocVal) !== -1;

            if (!hasProg) {
                const msg = `⚠️ Sincronia Perduda! Estàs a '${activeSeq.substring(0,15)}...' però el panell diu ${progKey}`;
                this.status(msg, "error");
                this.log(msg, "WARN");
                return false;
            }
            // Opcional: advertir si el bloque no coincide pero no bloquear
            if (!hasBloc) {
                this.log(`⚠️ El bloque ${blocVal} no aparece en la secuencia activa. Continuando...`, "DEBUG");
            }

            return true;
        },

        /**
         * Obtiene el nombre de la secuencia activa desde Premiere y actualiza el estado.
         * @returns {Promise<string>} Nombre de la secuencia activa (vacío si no hay).
         */
        refreshActiveSequence: async function() {
            const state = window.FASTPASS_UI.State;
            try {
                const seqName = await this.callJSX("Context.activeSeq()");
                state.activeSequenceName = seqName && seqName.indexOf("ERROR") === -1 ? seqName : "";
                this.log(`🔍 Secuencia activa actualizada: ${state.activeSequenceName || "(ninguna)"}`, "DEBUG");
                return state.activeSequenceName;
            } catch (e) {
                this.log(`⚠️ Error al refrescar secuencia activa: ${e.message}`, "WARN");
                state.activeSequenceName = "";
                return "";
            }
        },

        /**
         * applyGlobalOffsetSec: Aplica el desplaçament global de TC (tcOffset) a un valor en segons.
         * La deriva sistemàtica d'ingesta (ex: 12 frames ~0.48s) es corregeix centralitzadament
         * des de Profile.json > general.tcOffset.
         * @param {number} seconds - Valor en segons a corregir
         * @returns {number} - Valor corregit amb l'offset configurat
         */
        applyGlobalOffsetSec: function(seconds) {
            const cfg = window.FASTPASS_UI.Config.get();
            const offset = cfg.tcOffset || 0;
            if (offset !== 0) {
                this.log(`📐 [GLOBAL_OFFSET] Aplicant offset de ${offset}s a ${seconds.toFixed(3)}s → ${(seconds + offset).toFixed(3)}s`, "DEBUG");
            }
            return seconds + offset;
        },

        deleteFile: function(path) {
            try {
                const fs = window.cep.fs;
                // Normalizamos barras para Node/CEP
                const normalizedPath = path.replace(/\//g, '\\');
                const result = fs.unlink(normalizedPath);
                
                if (result.err === 0) {
                    this.log(`✅ Arxiu eliminat del NAS: ${normalizedPath}`, "DEBUG");
                    return true;
                } else {
                    this.log(`⚠️ No s'ha pogut esborrar (Error ${result.err}): ${normalizedPath}`, "DEBUG");
                    return false;
                }
            } catch(e) { 
                return false; 
            }
        }

    };
})();