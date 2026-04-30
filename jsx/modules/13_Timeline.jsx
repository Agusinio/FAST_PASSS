/**
 * =================================================================================
 * 13_Timeline.jsx
 * Módulo unificado para navegación del cabezal (CTI) y estado de la Secuencia.
 * (Fusión de Sequences + Timeline Utilities - v18 DRY)
 * =================================================================================
 */

if (typeof $.global.FASTPASS === "undefined") { $.global.FASTPASS = {}; }
var FASTPASS = $.global.FASTPASS;

FASTPASS.Timeline = {

    /**
     * get: Obtiene la posición actual del CTI en segundos.
     */
    get: function() {
        var seq = ($.global.FASTPASS && FASTPASS.Context) ? FASTPASS.Context.getWorkSequence() : app.project.activeSequence;
        return seq ? seq.getPlayerPosition().seconds : 0;
    },

    /**
     * set: Posiciona el CTI en un tiempo determinado.
     */
    set: function(seconds) {
        var seq = ($.global.FASTPASS && FASTPASS.Context) ? FASTPASS.Context.getWorkSequence() : app.project.activeSequence;
        if (!seq) return "ERR:NO_SEQ";
        
        var t = new Time(); 
        t.seconds = parseFloat(seconds);
        seq.setPlayerPosition(t.ticks);
        return "OK";
    },

    /**
     * range: Establece puntos de Entrada (In) y Salida (Out).
     */
    range: function(inSec, outSec) {
        var seq = ($.global.FASTPASS && FASTPASS.Context) ? FASTPASS.Context.getWorkSequence() : app.project.activeSequence;
        if (!seq) return "ERR:NO_SEQ";
        
        var tIn = new Time(); tIn.seconds = parseFloat(inSec);
        var tOut = new Time(); tOut.seconds = parseFloat(outSec);
        
        seq.setInPoint(tIn.ticks);
        seq.setOutPoint(tOut.ticks);
        return "OK";
    },

    /**
     * refresh: Realiza un 'nuclear refresh' para forzar actualizaciones de UI en Premiere.
     */
    refresh: function() {
        var seq = ($.global.FASTPASS && FASTPASS.Context) ? FASTPASS.Context.getWorkSequence() : app.project.activeSequence;
        if (!seq) return "ERR:NO_SEQ";
        
        var pos = seq.getPlayerPosition();
        var next = new Time(); 
        next.seconds = pos.seconds + 0.001; 
        
        seq.setPlayerPosition(next.ticks);
        seq.setPlayerPosition(pos.ticks);
        return "REFRESH_OK";
    },

    /**
     * duration: Retorna la durada total (Out point) de la seqüència.
     */
    duration: function() {
        var seq = ($.global.FASTPASS && FASTPASS.Context) ? FASTPASS.Context.getWorkSequence() : app.project.activeSequence;
        return seq ? seq.outPoint.seconds : 0;
    },

    /**
     * in: Estableix el punt d'entrada (In).
     */
    inPoint: function(val) {
        var seq = ($.global.FASTPASS && FASTPASS.Context) ? FASTPASS.Context.getWorkSequence() : app.project.activeSequence;
        if (seq) { seq.setInPoint(this._sec(val).ticks); return "OK"; }
        return "ERR";
    },

    /**
     * out: Estableix el punt de sortida (Out).
     */
    outPoint: function(val) {
        var seq = ($.global.FASTPASS && FASTPASS.Context) ? FASTPASS.Context.getWorkSequence() : app.project.activeSequence;
        if (seq) { seq.setOutPoint(this._sec(val).ticks); return "OK"; }
        return "ERR";
    },

    /**
     * getIn: Obté el punt d'entrada actual en segons.
     */
    getIn: function() {
        var seq = ($.global.FASTPASS && FASTPASS.Context) ? FASTPASS.Context.getWorkSequence() : app.project.activeSequence;
        return seq ? seq.inPoint.seconds : 0;
    },

    /**
     * getOut: Obté el punt de sortida actual en segons.
     */
    getOut: function() {
        var seq = ($.global.FASTPASS && FASTPASS.Context) ? FASTPASS.Context.getWorkSequence() : app.project.activeSequence;
        return seq ? seq.outPoint.seconds : 0;
    },

    // --- HELPER INTERNO (BAJO NIVEL) ---
    _sec: function(s) {
        var t = new Time(); 
        t.seconds = parseFloat(s);
        return t;
    }
};