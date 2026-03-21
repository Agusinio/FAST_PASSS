/* =================================================================================
   Utils.js - VERSIÓN OPTIMIZADA (Lipo-Ready)
================================================================================= */
(function() {
    var csInterface = new CSInterface();
    window.FASTPASS_UI = window.FASTPASS_UI || {};
    
    window.FASTPASS_UI.Utils = {
        isJsxReady: false,
        csInterface: csInterface,

        log: function(msg) { console.log("🟢 [UTILS]: " + msg); },

        // --- COMUNICACIÓN ASÍNCRONA ---
        callJSX: function(script) {
            return new Promise(function(resolve) {
                // El try/catch aquí es vital para que JS no se quede esperando una promesa que nunca cierra
                var safeScript = "try{" + script + "}catch(e){'ERR:'+e.message}";
                csInterface.evalScript(safeScript, function(res) {
                    if (!res || res === "undefined") resolve("");
                    else resolve(res);
                });
            });
        },

        // --- IMPORTACIÓN CON LÓGICA SUBIDA ---
        importList: async function(fileList, binName) {
            if (!fileList || !fileList.length) return;
            
            this.log("Iniciando importación de " + fileList.length + " ítems.");
            
            // Subimos la lógica: Scanner prepara las rutas (UNC, barras, etc.)
            const cleanPaths = FASTPASS_UI.Logic.Scanner.preparePathsForImport(fileList);
            const payload = JSON.stringify(cleanPaths);
            
            try {
                // Llamamos al puente global que definimos en el 2_IO.jsx anterior
                const res = await this.callJSX("jsx_importFiles('" + payload + "', '" + binName + "')");
                
                if (res.indexOf("ERR") === 0) throw new Error(res);
                
                this.log("✅ Importación completada en Premiere.");
                await this.delay(500);
            } catch (e) {
                this.log("❌ Error en importList: " + e.message);
            }
        },

        sanitizeName: function(str) {
            if (!str) return "Unnamed_Item";
            // Quitamos caracteres prohibidos en rutas y nombres de Premiere
            var pattern = new RegExp('[<>:"/\\\\|?*#]', 'g'); 
            return str.replace(pattern, "").trim().substring(0, 60); // Limitamos longitud
        },

        delay: function(ms) { 
            return new Promise(resolve => setTimeout(resolve, ms)); 
        },

        // --- LÓGICA DE NEGOCIO MIGRADA DESDE JSX (SYSTEM) ---

        getFormattedDate: function() {
            var d = new Date();
            var day = ("0" + d.getDate()).slice(-2);
            var month = ("0" + (d.getMonth() + 1)).slice(-2);
            var year = d.getFullYear();
            return day + "_" + month + "_" + year;
        },

        validatePaths: function(routes) {
            if (!routes) return [];
            var failed = [];
            for (var key in routes) {
                var path = routes[key];
                // cep.fs.stat devuelve el código 0 si existe
                var result = window.cep.fs.stat(path);
                if (result.err !== 0) failed.push(key);
            }
            return failed;
        }
    };
})();

// --- ALIAS GLOBALES (Para mayor comodidad en workflows) ---
var log = function(m) { window.FASTPASS_UI.Utils.log(m); };
var callJSX = function(s) { return window.FASTPASS_UI.Utils.callJSX(s); };