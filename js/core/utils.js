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
                    if (!res || res === "undefined") resolve("");
                    else resolve(res);
                });
            });
        },

        /**
         * Ingesta massiva de fitxers. Atòmic: Rep rutes i les envia.
         * La preparació de rutes es fa a la capa de Lògica/Inspectors.
         */
        importList: async function(pathList, binName) {
            if (!pathList || !pathList.length) return;
            this.log(`Important ${pathList.length} ítems a '${binName}'...`, "DEBUG");
            
            const payload = JSON.stringify(pathList);
            try {
                const res = await this.callJSX(`jsx_importFiles('${payload}', '${binName}')`);
                if (res && res.indexOf("ERR") === 0) throw new Error(res);
                await this.delay(300);
            } catch (e) {
                this.log(`❌ Error importList: ${e.message}`, "ERROR");
            }
        },

        sanitizeName: function(str) {
            if (!str) return "Unnamed_Item";
            var pattern = new RegExp('[<>:"/\\\\|?*#]', 'g'); 
            return str.replace(pattern, "").trim().substring(0, 60);
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