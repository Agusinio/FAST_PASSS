/* * =================================================================================
 * 9_Render.jsx
 * Módulo especializado en la exportación (AME y Snapshots).
 * (v12 - VERSIÓN ULTRA-ATÓMICA: SIN LÓGICA DE NEGOCIO NI POLLING)
 * =================================================================================
 */

var FASTPASS = $.global.FASTPASS;
$.writeln("✅ [9_Render.jsx] MODUL CARREGAT!");

/**
 * seqExportRange: Rang d'exportació de la seqüència (IN/OUT o, si no, l'ÀREA DE TREBALL).
 *
 * (2026-09-21) Necessari perquè `exportAsMediaDirect` NO accepta cap paràmetre de rang i
 * `encodeSequence` s'estava cridant amb workAreaType=0 (SEQÜÈNCIA SENCERA) → l'exportació
 * sortia SEMPRE amb la durada original, ignorant IN/OUT i l'àrea de treball (queixa d'usuari).
 *
 * @param {Object} seq - Sequence de Premiere
 * @returns {{mode:number, inSec:number, outSec:number, src:string}}
 *          mode: 0 = seqüència sencera · 1 = IN→OUT · 2 = àrea de treball
 */
function seqExportRange(seq) {
    var res = { mode: 0, inSec: 0, outSec: 0, src: 'seqüència sencera (sense rang)' };
    try {
        var inS = 0, outS = 0;
        try { var ti = seq.getInPointAsTime(); if (ti && ti.seconds != null) inS = ti.seconds; } catch(e1) {}
        try { var to = seq.getOutPointAsTime(); if (to && to.seconds != null) outS = to.seconds; } catch(e2) {}
        if (!(outS > inS + 0.05)) {
            try { if (seq.inPoint && seq.inPoint.seconds != null) inS = seq.inPoint.seconds; } catch(e3) {}
            try { if (seq.outPoint && seq.outPoint.seconds != null) outS = seq.outPoint.seconds; } catch(e4) {}
        }
        if (outS > inS + 0.05) {
            res.mode = 1; res.inSec = inS; res.outSec = outS; res.src = 'IN→OUT';
            return res;
        }
        var enabled = false;
        try { enabled = seq.isWorkAreaEnabled(); } catch(e5) {}
        if (enabled) {
            var wi = 0, wo = 0;
            try { var wti = seq.getWorkAreaInPointAsTime(); if (wti && wti.seconds != null) wi = wti.seconds; } catch(e6) {}
            try { var wto = seq.getWorkAreaOutPointAsTime(); if (wto && wto.seconds != null) wo = wto.seconds; } catch(e7) {}
            if (wo > wi + 0.05) {
                res.mode = 2; res.inSec = wi; res.outSec = wo; res.src = 'àrea de treball';
                return res;
            }
        }
    } catch (eR) { $.writeln("[9_Render.seqExportRange] EXC: " + e.message); }
    return res;
}

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

            // (2026-09-21) `exportAsMediaDirect` NO accepta cap paràmetre de rang → exporta el
            // que HI HA al timeline. El RETALL a l'OUT es fa ABANS, des de JS
            // (flow_render::_trimTailAtOut, composició d'àtoms Clips). Per això aquí NO es toca
            // l'àrea de treball: així l'exportació és exactament el contingut del timeline.
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

    /**
     * exportRange: Llegeix el RANG d'exportació actual de la seqüència activa.
     * Retorna JSON {mode, inSec, outSec, src}: mode 1 = IN→OUT, 2 = àrea de treball, 0 = sense rang.
     * (2026-09-21) És l'ÚNIC àtom que llegeix l'ÀREA DE TREBALL (`getWorkAreaOutPointAsTime`):
     * `Timeline.getOut()` només llegeix el punt OUT de la seqüència. El flux de render el fa
     * servir per retallar el timeline a l'OUT abans d'exportar.
     */
    exportRange: function() {
        try {
            var seq = FASTPASS.Context.getWorkSequence();
            if (!seq) return JSON.stringify({ mode: 0, inSec: 0, outSec: 0, src: 'sense seqüència' });
            return JSON.stringify(seqExportRange(seq));
        } catch (e) { return "EXC: " + e.message; }
    },

    /**
     * addToAME: Envia la seqüència a la cua d'AME exportant EL RANG de la seqüència.
     *
     * ⚠️ (2026-09-21) ABANS: `encodeSequence(seq, path, preset, 0, 1)` → workAreaType = 0 =
     * ENCODE_ENTIRE_SEQUENCE → sortia la durada sencera encara que hi hagués IN/OUT
     * (queixa d'usuari en directe: "el render ha de ser sempre segons els marcadors de la
     * seqüència"). ARA: workAreaType = 1 (IN→OUT) si hi ha IN/OUT, 2 (àrea de treball) si no,
     * i només 0 com a últim recurs. És l'ÚNICA API d'exportació de Premiere que accepta un rang.
     */
    addToAME: function(presetPath, outputFolder, outputFileName) {
        try {
            var seq = FASTPASS.Context.getWorkSequence();
            var f = new File(presetPath);
            if (!f.exists) return "ERR_PRESET_NOT_FOUND";

            var rng = seqExportRange(seq);
            app.encoder.launchEncoder();
            var fullOutputPath = outputFolder + "\\" + outputFileName;
            $.writeln("[9_Render.addToAME] rang=" + rng.src + " (" + rng.inSec + "→" + rng.outSec +
                ") workAreaType=" + rng.mode + " -> " + fullOutputPath);
            app.encoder.encodeSequence(seq, fullOutputPath, f.fsName, rng.mode, 1);
            app.encoder.startBatch();
            return "OK_QUEUE_" + rng.mode + "_" + rng.inSec + "-" + rng.outSec;
        } catch(e) { return "EXC: " + e.message; }
    }
};