/**
 * ============================================================================
 * 34_Exportacio.js (Exportació i Captura)
 * ============================================================================
 */

(function() {
    var FASTPASS_UI = window.FASTPASS_UI || {};
    FASTPASS_UI.Logic = FASTPASS_UI.Logic || {};

    const Eines = {
        callJSX: (s) => window.FASTPASS_UI.Eines.callJSX(s),
        delay: (ms) => window.FASTPASS_UI.Eines.delay(ms)
    };

    FASTPASS_UI.Logic.Render = {
        
        /**
         * capture: Orquestra la captura d'un frame (PNG) amb polling de seguretat.
         */
        capture: async function(destPath, timeSec = "-1") {
            const tempBase = "fast_snap_" + Date.now();
            const tempFileNoExt = "C:\\temp\\" + tempBase; // TODO: Millorar ruta temp segons OS
            const tempFileFull = tempFileNoExt + ".png";

            // 1. Exportació física via bridge literal
            const resExec = await Eines.callJSX(`Exportacio.snapshot('${tempFileNoExt}', '${timeSec}')`);
            if (resExec !== "OK_EXEC") return { success: false, log: resExec };

            // 2. Polling per verificar que s'ha escrit el fitxer
            let found = false;
            for (let i = 0; i < 30; i++) {
                const stat = window.cep.fs.stat(tempFileFull);
                if (stat.err === 0) { found = true; break; }
                await Eines.delay(100);
            }

            if (!found) return { success: false, log: "Timeout" };

            // 3. Movem al destí final
            window.cep.fs.deleteFile(destPath);
            const moveRes = window.cep.fs.rename(tempFileFull, destPath);
            
            return (moveRes.err === 0) 
                ? { success: true, log: "OK" } 
                : { success: false, log: "Error movent: " + moveRes.err };
        },

        /**
         * queue: Envia la seqüència activa a AME.
         */
        queue: async function(preset, folder, name) {
            return await Eines.callJSX(`Exportacio.queue('${preset}', '${folder}', '${name}')`);
        }
    };

    // Alias global literal window.Render
    window.Render = FASTPASS_UI.Logic.Render;

    window.FASTPASS_UI = FASTPASS_UI;
})();
