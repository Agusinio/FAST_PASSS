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

        log: function(msg, level) { 
            const colors = { "INFO": "🔵", "DEBUG": "🟢", "ERROR": "🔴", "WARN": "🟡" };
            console.log(`${colors[level || "INFO"]} [FASTPASS]: ${msg}`); 
        },

        /**
         * Pont asíncron cap al motor ExtendScript (JSX).
         */
        callJSX: function(script) {
            return new Promise(function(resolve) {
                var isAnimX = script.indexOf("Anim.x") !== -1;
                if (!isAnimX) {
                    //window.FASTPASS_UI.Utils.log("🔍 [JSX CALL]: " + script, "INFO");
                }
                var safeScript = "try{" + script + "}catch(e){'ERR:'+e.message}";
                csInterface.evalScript(safeScript, function(res) {
                    if (!isAnimX) {
                        //window.FASTPASS_UI.Utils.log("🔍 [JSX RESULT]: " + res, "INFO");
                    }
                    if (!res || res === "undefined") {
                        resolve("");
                    } else if (res.indexOf("ERR:") === 0) {
                        // 📍 Si hay un error, lo logueamos pero NO intentamos parsearlo como JSON
                        window.FASTPASS_UI.Utils.log("💥 [JSX ERROR]: " + res, "ERROR");
                        resolve("[]"); // Devolvemos un array vacío para que el resto no explote
                    } else {
                        resolve(res);
                    }
                });
            });
        },

        readFolder: async function(path) {
            // 1. Intentar con CEP (más rápido para rutas locales)
            var result = window.cep.fs.readdir(path);
            
            if (result.err === 0) {
                var filenames = result.data;
                var filesWithStats = [];
        
                var folderPath = path.replace(/[\\/]*$/, "\\");
        
                for (var i = 0; i < filenames.length; i++) {
                    var name = filenames[i];
                    var fullPath = folderPath + name;
        
                    var stat = window.cep.fs.stat(fullPath);
                    
                    if (stat.err === 0) {
                        filesWithStats.push({
                            name: name,
                            mtime: stat.data.mtime
                        });
                    } else {
                        // Si falla el stat, guardamos con fecha 0
                        filesWithStats.push({ name: name, mtime: 0 });
                    }
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
                                mtime: item.modified || 0
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
            // 📍 Eliminem l'escapat de comilles simples (\') 
            // Només escapem barres invertides per a que el string de JS no trenqui
            return str.replace(/\\/g, "\\\\"); 
        },

        delay: function(ms) { 
            return new Promise(resolve => setTimeout(resolve, ms)); 
        },

        getFormattedDate: function() {
            var d = new Date();
            var day = ("0" + d.getDate()).slice(-2);
            var month = ("0" + (d.getMonth() + 1)).slice(-2);
            var year = d.getFullYear();
            return day + "_" + month + "_" + year;
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