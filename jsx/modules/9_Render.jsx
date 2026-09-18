/* * =================================================================================
 * 9_Render.jsx
 * Módulo especializado en la exportación (AME y Snapshots).
 * (v12 - VERSIÓN ULTRA-ATÓMICA: SIN LÓGICA DE NEGOCIO NI POLLING)
 * =================================================================================
 */

var FASTPASS = $.global.FASTPASS;
$.writeln("✅ [9_Render.jsx] MODUL CARREGAT!");
FASTPASS.Render = {

    /**
     * MÉTODE ATÒMIC: Exporta un frame PNG via QE.
     * @param {string} tempPathNoExt - Ruta absoluta sense extensió.
     */
    exportFrameQE: function(tempPathNoExt, timeSec) {
        try {
            $.writeln("[9_Render.exportFrameQE] INICI: path=" + tempPathNoExt + " time=" + timeSec);
            // Assegurar que la carpeta destí existeix (Snapshots/ del projecte)
            var f = new File(tempPathNoExt);
            if (!f.parent.exists) {
                f.parent.create();
                $.writeln("[9_Render.exportFrameQE] Created parent: " + f.parent.fsName);
            }
            app.enableQE();
            $.writeln("[9_Render.exportFrameQE] QE enabled");
            var qeSeq = qe.project.getActiveSequence();
            if (!qeSeq) { $.writeln("[9_Render.exportFrameQE] ERR: qeSeq is null"); return "ERR_NO_QE_SEQ"; }
            $.writeln("[9_Render.exportFrameQE] qeSeq.name=" + qeSeq.name);
            // Convertir segons a timecode HH:MM:SS:FF (25 fps) — QE espera string timecode
            var sec = (timeSec && timeSec !== "-1") ? Number(timeSec) : 0;
            var totalFrames = Math.round(sec * 25);
            var ff = totalFrames % 25;
            var totalS = Math.floor(totalFrames / 25);
            var ss = totalS % 60;
            var totalM = Math.floor(totalS / 60);
            var mm = totalM % 60;
            var hh = Math.floor(totalM / 60);
            var tc = (hh < 10 ? '0' + hh : hh) + ':' + (mm < 10 ? '0' + mm : mm) + ':' + (ss < 10 ? '0' + ss : ss) + ':' + (ff < 10 ? '0' + ff : ff);
            $.writeln("[9_Render.exportFrameQE] timecode=" + tc + " (sec=" + sec + ") path=" + f.fsName);
            qeSeq.exportFramePNG(tc, f.fsName);
            $.writeln("[9_Render.exportFrameQE] exportFramePNG OK → " + f.fsName + ".png");
            return "OK_EXEC";
        } catch(e) { $.writeln("[9_Render.exportFrameQE] EXC: " + e.message); return "EXC: " + e.message; }
    },

    /**
     * MÉTODE ATÒMIC: Exporta un frame via API estàndard (Motiu: Grafisme).
     */
    frame: function(path, timeSec) {
        try {
            $.writeln("[9_Render.frame] INICI: path=" + path + " time=" + timeSec);
            var seq = FASTPASS.Context.getWorkSequence();
            if (!seq) { $.writeln("[9_Render.frame] ERR: seq is null"); return "ERR_NO_SEQ"; }
            $.writeln("[9_Render.frame] seq.name=" + seq.name);
            var f = new File(path);
            $.writeln("[9_Render.frame] File.fsName=" + f.fsName + " parent.exists=" + f.parent.exists);
            if (!f.parent.exists) {
                $.writeln("[9_Render.frame] Creant carpeta parent...");
                var created = f.parent.create();
                $.writeln("[9_Render.frame] parent.create()=" + created);
            }
            var time = (timeSec && timeSec !== "-1") ? timeSec : seq.getPlayerPosition().seconds;
            var t = new Time(); t.seconds = parseFloat(time);
            $.writeln("[9_Render.frame] exportFrame time=" + t.seconds + " path=" + f.fsName);
            var res = seq.exportFrame(t, f.fsName);
            $.writeln("[9_Render.frame] exportFrame result=" + res);
            return res ? "OK" : "ERR_API";
        } catch(e) { $.writeln("[9_Render.frame] EXC: " + e.message); return "ERR: " + e.message; }
    },

    /**
     * MÉTODE ATÒMIC: Afegeix a la cua d'AME.
     */
    renderDirect: function(presetPath, outputFolder, outputFileName) {
        try {
            var seq = FASTPASS.Context.getWorkSequence();
            var f = new File(presetPath);
            if (!f.exists) return "ERR_PRESET_NOT_FOUND";

            var outFolder = new Folder(outputFolder);
            if (!outFolder.exists) {
                outFolder.create();
                $.writeln("[9_Render.direct] carpeta creada: " + outFolder.fsName);
            }
            var fullOutputPath = outFolder.fsName + "\\" + outputFileName;
            $.writeln("[9_Render.direct] exportAsMediaDirect -> " + fullOutputPath + " | preset=" + f.fsName);

            seq.exportAsMediaDirect(fullOutputPath, f.fsName, 0);

            var outF = new File(fullOutputPath);
            if (!outF.exists) return "ERR_NO_OUTPUT";
            return "OK_DIRECT";
        } catch(e) {
            $.writeln("[9_Render.direct] EXC: " + e.message);
            return "EXC: " + e.message;
        }
    },

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