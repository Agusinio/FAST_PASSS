/**
 * ============================================================================
 * LOGIC: RENDER (Exportació orquestrada i Captura) - v2.5.6 literal
 * ============================================================================
 */

(function() {
    var FASTPASS_UI = window.FASTPASS_UI || {};
    FASTPASS_UI.Logic = FASTPASS_UI.Logic || {};

    const utils = {
        callJSX: (s) => window.FASTPASS_UI.Utils.callJSX(s),
        delay: (ms) => window.FASTPASS_UI.Utils.delay(ms)
    };

    FASTPASS_UI.Logic.Render = {
        
        /**
         * capture: Orquestra la captura d'un frame (PNG) amb polling de seguretat.
         */
        capture: async function(destPath, timeSec = "-1") {
            const tempFileFull = "C:\\temp\\fast_snap_" + Date.now() + ".png";

            // 1. Exportació física via bridge literal.
            // (2026-10-05) `Render.snapshot` NO existeix al motor JSX (retornava «ERR:…» i
            // `callJSX` el convertia en "[]" → captura impossible). L'ÚNIC mecanisme és
            // `Render.frame` (= `seq.exportFrame`, l'API estàndard). Amb timeSec "-1" captura
            // la posició actual del cabezal.
            const resExec = await utils.callJSX(`Render.frame('${tempFileFull}', '${timeSec}')`);
            if (String(resExec).indexOf('OK') !== 0) return { success: false, log: resExec };

            // 2. Polling per verificar que s'ha escrit el fitxer
            let found = false;
            for (let i = 0; i < 30; i++) {
                const stat = window.cep.fs.stat(tempFileFull);
                if (stat.err === 0) { found = true; break; }
                await utils.delay(100);
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
            return await utils.callJSX(`Render.queue('${preset}', '${folder}', '${name}')`);
        }
    };

    // Alias global literal window.Render
    window.Render = FASTPASS_UI.Logic.Render;

    window.FASTPASS_UI = FASTPASS_UI;
})();
