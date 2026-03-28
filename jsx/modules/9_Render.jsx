/* * =================================================================================
 * 9_Render.jsx
 * Módulo especializado en la exportación (AME y Snapshots).
 * (v12 - VERSIÓN ULTRA-ATÓMICA: SIN LÓGICA DE NEGOCIO NI POLLING)
 * =================================================================================
 */

var FASTPASS = FASTPASS || {};
FASTPASS.Render = {

    /**
     * MÉTODE ATÒMIC: Exporta un frame PNG via QE.
     * @param {string} tempPathNoExt - Ruta absoluta sense extensió.
     */
    exportFrameQE: function(tempPathNoExt, timeSec) {
        try {
            app.enableQE();
            var qeSeq = qe.project.getActiveSequence();
            if (!qeSeq) return "ERR_NO_QE_SEQ";
            var time = (timeSec && timeSec !== "-1") ? timeSec : qeSeq.getPlayerPosition();
            qeSeq.exportFramePNG(time, tempPathNoExt);
            return "OK_EXEC";
        } catch(e) { return "EXC: " + e.message; }
    },

    /**
     * MÉTODE ATÒMIC: Exporta un frame via API estàndard (Motiu: Grafisme).
     */
    frame: function(path, timeSec) {
        try {
            var seq = FASTPASS.Context.getWorkSequence();
            if (!seq) return "ERR_NO_SEQ";
            var f = new File(path);
            if (!f.parent.exists) f.parent.create();
            var time = (timeSec && timeSec !== "-1") ? timeSec : seq.getPlayerPosition().seconds;
            var t = new Time(); t.seconds = parseFloat(time);
            var res = seq.exportFrame(t, f.fsName);
            return res ? "OK" : "ERR_API";
        } catch(e) { return "ERR: " + e.message; }
    },

    /**
     * MÉTODE ATÒMIC: Afegeix a la cua d'AME.
     */
    addToAME: function(presetPath, outputFolder, outputFileName) {
        try {
            var seq = FASTPASS.Context.getWorkSequence();
            var f = new File(presetPath);
            if (!f.exists) return "ERR_PRESET_NOT_FOUND";
            
            app.encoder.launchEncoder();
            var fullOutputPath = outputFolder + "\\" + outputFileName;
            app.encoder.encodeSequence(seq, fullOutputPath, f.fsName, 0, 1);
            app.encoder.startBatch();
            return "OK_QUEUE";
        } catch(e) { return "EXC: " + e.message; }
    }
};