/**
 * =================================================================================
 * 30_Cronologia.jsx
 * Módulo unificado para navegación del cabezal (CTI) y estado de la Secuencia.
 * =================================================================================
 */

if (typeof $.global.FASTPASS === "undefined") { $.global.FASTPASS = {}; }
var FASTPASS = $.global.FASTPASS;

FASTPASS.Cronologia = {

    get: function() {
        var seq = (FASTPASS.Entorn) ? FASTPASS.Entorn.getWorkSequence() : app.project.activeSequence;
        return seq ? seq.getPlayerPosition().seconds : 0;
    },

    set: function(seconds) {
        var seq = (FASTPASS.Entorn) ? FASTPASS.Entorn.getWorkSequence() : app.project.activeSequence;
        if (!seq) return "ERR_NO_SEQ";
        var t = new Time(); 
        t.seconds = parseFloat(seconds);
        seq.setPlayerPosition(t.ticks);
        return "OK";
    },

    range: function(inSec, outSec) {
        var seq = (FASTPASS.Entorn) ? FASTPASS.Entorn.getWorkSequence() : app.project.activeSequence;
        if (!seq) return "ERR_NO_SEQ";
        var tIn = new Time(); tIn.seconds = parseFloat(inSec);
        var tOut = new Time(); tOut.seconds = parseFloat(outSec);
        seq.setInPoint(tIn.ticks);
        seq.setOutPoint(tOut.ticks);
        return "OK";
    },

    refresh: function() {
        var seq = (FASTPASS.Entorn) ? FASTPASS.Entorn.getWorkSequence() : app.project.activeSequence;
        if (!seq) return "ERR_NO_SEQ";
        var pos = seq.getPlayerPosition();
        var next = new Time(); 
        next.seconds = pos.seconds + 0.001; 
        seq.setPlayerPosition(next.ticks);
        seq.setPlayerPosition(pos.ticks);
        return "OK";
    },

    duration: function() {
        var seq = (FASTPASS.Entorn) ? FASTPASS.Entorn.getWorkSequence() : app.project.activeSequence;
        return seq ? seq.outPoint.seconds : 0;
    }
};