/**
 * =================================================================================
 * 33_Animacio.jsx
 * Módulo especializado en la gestión literal de Keyframes y Animaciones.
 * =================================================================================
 */

if (typeof $.global.FASTPASS === "undefined") { $.global.FASTPASS = {}; }
var FASTPASS = $.global.FASTPASS;

FASTPASS.Animacio = {

    _get: function(prop, timeSec) {
        if (!prop || !prop.numKeys) return -1;
        var t = parseFloat(timeSec);
        for (var i = 0; i < prop.numKeys; i++) {
            if (Math.abs(prop.getKeyTime(i).seconds - t) < 0.01) return i;
        }
        return -1;
    },

    add: function(ti, ci, comp, prop, time) {
        var p = FASTPASS.Segments.getProp(ti, ci, comp, prop, "video");
        if (!p) return "ERR_PROP";
        p.setTimeVarying(true);
        p.addKey(parseFloat(time));
        return "OK";
    },

    set: function(ti, ci, comp, prop, time, val) {
        var p = FASTPASS.Segments.getProp(ti, ci, comp, prop, "video");
        var idx = this._get(p, time);
        if (idx !== -1) {
            if (prop === "ADBE Video Position") p.setValueAtKey(idx, val, true);
            else p.setValueAtKey(idx, parseFloat(val), true);
            return "OK";
        }
        return "ERR_NOT_FOUND";
    },

    x: function(valNorm, isFinal) {
        try {
            var seq = (FASTPASS.Entorn) ? FASTPASS.Entorn.getWorkSequence() : app.project.activeSequence;
            if (!seq) return 0.5;
    
            var cti = seq.getPlayerPosition();
            
            // 🛡️ Usamos el argumento valNorm como trackIdx si no hay más argumentos (llamada de Polling)
            // O usamos 1 como fallback seguro.
            var tIdx = (arguments.length === 1 && !isNaN(parseInt(valNorm))) ? parseInt(valNorm) : 1;
    
            var info = FASTPASS.Segments.at(tIdx, cti.seconds, "video");
            if (!info || info === "null" || info === "[]") return 0.5;
    
            var clipData = JSON.parse(info);
            if (!clipData || typeof clipData.index === "undefined") return 0.5;
    
            var pPos = FASTPASS.Segments.getProp(tIdx, clipData.index, "ADBE Motion", "ADBE Video Position", "video");
            if (!pPos) return 0.5;
    
            // --- MODO LECTURA (Polling) ---
            if (arguments.length === 0 || (arguments.length === 1 && tIdx === parseInt(valNorm))) {
                var valAtTime = pPos.getValueAtTime(cti);
                return (valAtTime && valAtTime.length > 0) ? valAtTime[0] : 0.5;
            }
    
            // --- MODO ESCRITURA (Slider) ---
            var currentVal = pPos.getValueAtTime(cti);
            currentVal[0] = parseFloat(valNorm);
            pPos.setValue(currentVal, true);
            return "OK";
    
        } catch(e) { 
            $.writeln("💥 [JSX:Animacio] Error en x: " + e.message);
            return 0.5; 
        }
    }
};