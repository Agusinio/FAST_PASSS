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
        
        $.writeln("[Timeline.range·DBG] in=" + inSec + " out=" + outSec + " seq=" + (seq.name || "?"));
        try {
            seq.setInPoint(parseFloat(inSec));
            $.writeln("[Timeline.range·DBG] setInPoint OK. inPoint prop=" + seq.inPoint + " type=" + (typeof seq.inPoint));
            seq.setOutPoint(parseFloat(outSec));
            $.writeln("[Timeline.range·DBG] setOutPoint OK. outPoint prop=" + seq.outPoint + " type=" + (typeof seq.outPoint) + " seconds=" + (seq.outPoint && seq.outPoint.seconds));
            return "OK|outProp=" + seq.outPoint + "|type=" + (typeof seq.outPoint) + "|sec=" + (seq.outPoint && seq.outPoint.seconds) + "|inSec=" + (seq.inPoint && seq.inPoint.seconds);
        } catch(e) {
            $.writeln("[Timeline.range·DBG] EXCEPTION: " + e.message + " (line " + e.line + ")");
            return "ERR:" + e.message + "|line=" + e.line;
        }
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
        if (!seq) return 0;
        return (typeof seq.outPoint !== "undefined") ? seq.outPoint.seconds : 0;
    },

    /**
     * in: Estableix el punt d'entrada (In).
     */
    inPoint: function(val) {
        var seq = ($.global.FASTPASS && FASTPASS.Context) ? FASTPASS.Context.getWorkSequence() : app.project.activeSequence;
        if (seq) { seq.setInPoint(parseFloat(val)); return "OK"; }
        return "ERR";
    },

    /**
     * out: Estableix el punt de sortida (Out).
     */
    outPoint: function(val) {
        var seq = ($.global.FASTPASS && FASTPASS.Context) ? FASTPASS.Context.getWorkSequence() : app.project.activeSequence;
        if (!seq) return "ERR";
        $.writeln("[Timeline.outPoint·DBG] val=" + val + " seq=" + (seq.name || "?"));
        try {
            seq.setOutPoint(parseFloat(val));
            $.writeln("[Timeline.outPoint·DBG] OK. outPoint prop=" + seq.outPoint + " type=" + (typeof seq.outPoint) + " seconds=" + (seq.outPoint && seq.outPoint.seconds));
            return "OK";
        } catch(e) {
            $.writeln("[Timeline.outPoint·DBG] EXCEPTION: " + e.message);
            return "ERR:" + e.message;
        }
    },

    /**
     * getIn: Obté el punt d'entrada actual en segons.
     */
    getIn: function() {
        var seq = ($.global.FASTPASS && FASTPASS.Context) ? FASTPASS.Context.getWorkSequence() : app.project.activeSequence;
        if (!seq) return 0;
        // Protecció: després de trims, inPoint pot ser undefined (mateix patró que zoomToSelection)
        return (typeof seq.inPoint !== "undefined") ? seq.inPoint.seconds : 0;
    },

    /**
     * getOut: Obté el punt de sortida actual en segons.
     */
    getOut: function() {
        var seq = ($.global.FASTPASS && FASTPASS.Context) ? FASTPASS.Context.getWorkSequence() : app.project.activeSequence;
        if (!seq) return 0;
        var op = seq.outPoint;
        $.writeln("[Timeline.getOut·DBG] seq.outPoint=" + op + " type=" + (typeof op) + " seconds=" + (op && op.seconds));
        // Vía canònica: getOutPointAsTime() sempre retorna un objecte Time amb .seconds
        try {
            if (typeof seq.getOutPointAsTime === "function") {
                var t = seq.getOutPointAsTime();
                $.writeln("[Timeline.getOut·DBG] getOutPointAsTime()=" + (t && t.seconds) + " ticks=" + (t && t.ticks));
                return (t && typeof t.seconds === "number") ? t.seconds : 0;
            }
        } catch(e) { $.writeln("[Timeline.getOut·DBG] getOutPointAsTime EXC: " + e.message); }
        return (typeof op !== "undefined") ? op.seconds : 0;
    },

    /**
     * zoomToSelection: Mou el CTI a l'inici del rang IN/OUT i ajusta
     * l'àrea de treball (Work Area) per a que coincideixi amb els
     * punts IN/OUT actuals de la seqüència.
     * Utilitza setPlayerPosition + setWorkAreaInPoint/setWorkAreaOutPoint.
     */
    zoomToSelection: function() {
        try {
            var seq = ($.global.FASTPASS && FASTPASS.Context) ? FASTPASS.Context.getWorkSequence() : app.project.activeSequence;
            if (!seq) return "ERR:NO_SEQ";

            // Llegir IN/OUT per la via canònica (getXAsTime), amb fallback a seq.inPoint/outPoint
            var inSec = 0, outSec = 0;
            try {
                var ti = seq.getInPointAsTime ? seq.getInPointAsTime() : null;
                var to = seq.getOutPointAsTime ? seq.getOutPointAsTime() : null;
                if (ti && typeof ti.seconds === "number") inSec = ti.seconds;
                if (to && typeof to.seconds === "number") outSec = to.seconds;
            } catch(e2) { /* fallback a propietats */ }
            if (inSec <= 0 && typeof seq.inPoint !== "undefined") inSec = seq.inPoint.seconds || 0;
            if (outSec <= 0 && typeof seq.outPoint !== "undefined") outSec = seq.outPoint.seconds || 0;

            // 1. Moure el CTI a l'inici del rang
            var tCti = new Time(); tCti.seconds = inSec;
            seq.setPlayerPosition(tCti.ticks);

            // 2. Àrea de treball al rang IN-OUT (l'API espera SEGONS, no Time)
            seq.setWorkAreaInPoint(inSec);
            seq.setWorkAreaOutPoint(outSec);

            // Nota: el zoom visual del timeline no és exposat per l'API de Premiere en
            // aquesta versió (ni PProDOM.setZoomToTimeRange, ni app.executeCommand, ni QEDOM).
            // L'usuari fa el zoom manual (tecla "\") sobre el Work Area ja ajustat.

            return "OK:cti=" + inSec.toFixed(2) + "s workArea=" + inSec.toFixed(2) + "-" + outSec.toFixed(2) + "s";
        } catch(e) {
            return "ERR:" + e.message;
        }
    },

    /**
     * exportFcpXml: Exporta la seqüència activa a FCP XML (per a processament extern).
     * @param {string} outputPath - Ruta completa de destí (.xml)
     * @returns {string} "OK" o "ERR:... "
     */
    exportFcpXml: function(outputPath) {
        try {
            var seq = app.project.activeSequence;
            if (!seq) return "ERR_NO_SEQ";
            seq.exportAsFinalCutProXML(outputPath, 1); // 1 = suppressUI
            return "OK";
        } catch(e) { return "ERR: " + e.message; }
    },

    // --- HELPER INTERNO (BAJO NIVEL) ---
    _sec: function(s) {
        var t = new Time();
        t.seconds = parseFloat(s);
        return t;
    }
};
