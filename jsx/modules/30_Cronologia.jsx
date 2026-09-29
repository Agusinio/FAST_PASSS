/**
 * =================================================================================
 * 30_Cronologia.jsx
 * Módulo unificado para navegación del cabezal (CTI) y estado de la Secuencia.
 * =================================================================================
 */

if (typeof $.global.FASTPASS === "undefined") { $.global.FASTPASS = {}; }
var FASTPASS = $.global.FASTPASS;

FASTPASS.Cronologia = {

    makeTime: function(seconds) {
        var t = new Time(); 
        // Si el constructor falla, intentamos usar el tiempo de la secuencia de trabajo, no la activa
        if (!t || typeof t !== "object") {
            var seq = FASTPASS.Entorn.getWorkSequence();
            t = (seq) ? seq.getPlayerPosition() : new Time(); 
        }
        t.seconds = parseFloat(seconds || 0);
        return t;
    },

    get: function() {
        try {
            var seq = FASTPASS.Entorn.getWorkSequence();
            if (!seq) {
                $.writeln("⏲️ [JSX:Cronologia] get: activeSequence null (ignorable)");
                return 0;
            }
            var pos = seq.getPlayerPosition().seconds;
            $.writeln("⏲️ [JSX:Cronologia] get: " + pos);
            return pos;
        } catch(e) { return 0; }
    },

    set: function(seconds) {
        var seq = FASTPASS.Entorn.getWorkSequence();
        if (!seq) return "ERR_NO_SEQ";
        // ✅ Usamos la nueva fábrica
        var t = this.makeTime(seconds); 
        seq.setPlayerPosition(t.ticks);
        return "OK";
    },

    range: function(inSec, outSec) {
        var seq = FASTPASS.Entorn.getWorkSequence();
        if (!seq) return "ERR_NO_SEQ";
        // ✅ Usamos la nueva fábrica dos veces
        seq.setInPoint(this.makeTime(inSec).ticks);
        seq.setOutPoint(this.makeTime(outSec).ticks);
        return "OK";
    },

    refresh: function() {
        var seq = FASTPASS.Entorn.getWorkSequence();
        if (!seq) return "ERR_NO_SEQ";
        var pos = seq.getPlayerPosition();
        var next = new Time(); 
        next.seconds = pos.seconds + 0.001; 
        seq.setPlayerPosition(next.ticks);
        seq.setPlayerPosition(pos.ticks);
        return "OK";
    },

    duration: function() {
        var seq = FASTPASS.Entorn.getWorkSequence();
        return seq ? seq.outPoint.seconds : 0;
    }
};