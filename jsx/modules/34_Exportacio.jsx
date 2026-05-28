/**
 * =================================================================================
 * 34_Exportacio.jsx
 * Módulo especializado en la exportación (AME y Snapshots).
 * =================================================================================
 */

var FASTPASS = FASTPASS || {};
FASTPASS.Exportacio = {

    exportFrameQE: function(tempPathNoExt, timeSec) {
        try {
            app.enableQE();
            var qeSeq = qe.project.getActiveSequence();
            if (!qeSeq) return "ERR_NO_SEQ";
            var time = (timeSec && timeSec !== "-1") ? timeSec : qeSeq.getPlayerPosition();
            qeSeq.exportFramePNG(time, tempPathNoExt);
            return "OK";
        } catch(e) { return "ERR:" + e.message; }
    },

    frame: function(path, timeSec) {
        try {
            var seq = FASTPASS.Entorn.getWorkSequence();
            if (!seq) return "ERR_NO_SEQ";
            var f = new File(path);
            if (!f.parent.exists) f.parent.create();
            var time = (timeSec && timeSec !== "-1") ? timeSec : seq.getPlayerPosition().seconds;
            var t = new Time(); t.seconds = parseFloat(time);
            return seq.exportFrame(t, f.fsName) ? "OK" : "ERR";
        } catch(e) { return "ERR:" + e.message; }
    },

    addToAME: function(presetPath, outputFolder, outputFileName) {
        try {
            var seq = FASTPASS.Entorn.getWorkSequence();
            var f = new File(presetPath);
            if (!f.exists) return "ERR_PRESET";
            app.encoder.launchEncoder();
            app.encoder.encodeSequence(seq, outputFolder + "\\" + outputFileName, f.fsName, 0, 1);
            app.encoder.startBatch();
            return "OK";
        } catch(e) { return "ERR:" + e.message; }
    }
};