/**
 * ============================================================================
 * LOGIC: RENDER (Exportación orquestada)
 * ============================================================================
 */

(function() {
    var FASTPASS_UI = window.FASTPASS_UI || {};
    FASTPASS_UI.Logic = FASTPASS_UI.Logic || {};

    FASTPASS_UI.Logic.Render = {
        
        /**
         * Exportación orquestada de Snapshot.
         * Sube la lógica de polling y gestión de archivos al JS.
         */
        exportSnapshot: async function(destPath) {
            const utils = window.FASTPASS_UI.Utils;
            
            // 1. Obtenemos el tiempo actual en formato Timecode (o usamos el CTI bruto)
            const cti = await utils.callJSX("jsx_getCTI()");
            if (!cti) return { success: false, log: "No hay CTI" };

            // 2. Ruta temporal (Usamos una carpeta de sistema)
            const tempBase = "fast_snap_" + Date.now();
            // In Premiere QE exportFramePNG adds .png automatically
            const tempFileNoExt = "C:\\temp\\" + tempBase; // Ajustar según OS si es necesario
            const tempFileFull = tempFileNoExt + ".png";

            // 3. Llamada atómica a QE
            const resExec = await utils.callJSX(`jsx_exportFrameQE('${tempFileNoExt}', '${cti}')`);
            if (resExec !== "OK_EXEC") return { success: false, log: resExec };

            // 4. Polling en JS (Mucho más eficiente que esperar en JSX)
            let found = false;
            for (let i = 0; i < 30; i++) {
                const stat = window.cep.fs.stat(tempFileFull);
                if (stat.err === 0) { found = true; break; }
                await utils.delay(100);
            }

            if (!found) return { success: false, log: "Timeout esperando frame" };

            // 5. Movemos a destino (Usando API de sistema de CEP)
            // Primero borramos el destino si existe
            window.cep.fs.deleteFile(destPath);
            const moveRes = window.cep.fs.rename(tempFileFull, destPath);
            
            if (moveRes.err === 0) {
                return { success: true, log: "OK" };
            } else {
                // Si falla el rename (entre discos distintos), intentamos copia manual si fuera necesario
                return { success: false, log: "Error moviendo archivo: " + moveRes.err };
            }
        },

        /**
         * Envío a AME.
         */
        queueRender: async function(preset, folder, name) {
            const utils = window.FASTPASS_UI.Utils;
            return await utils.callJSX(`jsx_renderActiveSequence('${preset}', '${folder}', '${name}')`);
        }
    };

    window.FASTPASS_UI = FASTPASS_UI;
})();
