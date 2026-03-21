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
        }
    };
})();