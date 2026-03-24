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
                var safeScript = "try{" + script + "}catch(e){'ERR:'+e.message}";
                csInterface.evalScript(safeScript, function(res) {
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

        readFolder: function(path) {
            // Usamos el FileSystem nativo de la extensión (CEP)
            var result = window.cep.fs.readdir(path);
            
            if (result.err === 0) { // 0 significa "sin errores"
                return result.data; // Devuelve un array de strings con los nombres
            } else {
                console.error("Error leyendo carpeta desde JS:", result.err);
                return [];
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
                
                // Verifiquem existència
                let stat = fs.stat(currentPath);
                if (stat.err === 2) { // 2 = No existeix
                    this.log(`📂 [JS-FS] Creant carpeta: ${currentPath}...`, "DEBUG");
                    let result = fs.makedir(currentPath);
                    if (result.err !== 0) {
                        this.log(`❌ [JS-FS] Error creant: ${currentPath} (Codi: ${result.err})`, "ERROR");
                    } else {
                        this.log(`✅ [JS-FS] Carpeta creada: ${currentPath}`, "DEBUG");
                    }
                } else if (stat.err !== 0) {
                    this.log(`⚠️ [JS-FS] Stat error a ${currentPath}: ${stat.err}`, "WARN");
                }
            }
            return true;
        },


        /**
         * Ingesta massiva de fitxers. Atòmic: Rep rutes i les envia.
         * La preparació de rutes es fa a la capa de Lògica/Inspectors.
         */
        importList: async function(pathList, binName) {
            if (!pathList || !pathList.length) return;
            
            this.log(`📦 Preparant importació de ${pathList.length} ítems a '${binName}'...`, "DEBUG");
        
            // 📍 DEBUG: Esto imprimirá la lista real en la consola del inspector
            console.log("🚀 [DEBUG] Rutes que s'enviaran a Premiere:", pathList);
            
            try {
                // 1. EL JS DECIDE: Si no és root, primer ens assegurem que el Bin existeix
                if (binName && binName !== "root") {
                    this.log(`📁 Assegurant existència del Bin: ${binName}`, "DEBUG");
                    // Cridem al teu àtom de Project.jsx
                    await this.callJSX(`jsx_createBin('${binName}')`);
                    await this.delay(200); // Pausa tàctica per a Premiere
                }
        
                // 2. PREPARACIÓ DE DADES: Escapem les rutes per a ExtendScript
                // (Això evita l'error de [object Object])
                const escapedPaths = pathList.map(p => this.escape(p));
                const payload = JSON.stringify(escapedPaths);
        
                // 3. ENVIAMENT AL OBRER: Cridem al teu àtom de IO.jsx
                this.log(`📥 Executant importFiles a Premiere...`, "DEBUG");
                const res = await this.callJSX(`jsx_importFiles('${payload}', '${binName}')`);
                
                if (res && res.indexOf("ERR") === 0) throw new Error(res);
                
                this.log(`✅ Importació a '${binName}' completada amb èxit.`, "INFO");
        
            } catch (e) {
                this.log(`❌ Error importList: ${e.message}`, "ERROR");
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
            if (typeof str !== 'string') return str;
            return str.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
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
            
            const progKey = elProg.value;
            const blocVal = elBloc.value;
            const activeSeq = state.activeSequenceName || "";
            
            // Si estem en una seqüència buida o NO n'hi ha cap de activa
            if (!activeSeq) {
                this.status("⚠️ Cap seqüència activa!", "error");
                return false;
            }

            // Validació per paraules clau (Tokens)
            // Busquem si el nom de la seqüència inclou el codi del programa i el bloc
            const progData = config.mapeoProgramas[progKey];
            const progFileName = progData ? progData.archivo : "";
            
            const hasProg = activeSeq.indexOf(progFileName) !== -1;
            const hasBloc = activeSeq.indexOf(blocVal) !== -1;

            if (!hasProg || !hasBloc) {
                const msg = `⚠️ Sincronia Perduda! Estàs a '${activeSeq.substring(0,15)}...' però el panell diu ${progKey}/${blocVal}`;
                this.status(msg, "error");
                this.log(msg, "WARN");
                return false;
            }

            return true;
        }
    };
})();