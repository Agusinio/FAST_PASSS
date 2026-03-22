/* * =================================================================================
 * 7_KF.jsx
 * Módulo especializado en la gestión física de Keyframes.
 * (v12 - VERSIÓN ULTRA-ATÓMICA)
 * =================================================================================
 */

var FASTPASS = $.global.FASTPASS || {};
FASTPASS.KF = (function() {

    /**
     * Troba l'índex d'un keyframe per el seu temps.
     * (Aquest bucle és necessari ja que Premiere no té getKeyIndexAtTime nativament).
     */
    function getKeyIndexByTime(prop, timeSec) {
        if (!prop || !prop.numKeys) return -1;
        var t = parseFloat(timeSec);
        for (var i = 0; i < prop.numKeys; i++) {
            if (Math.abs(prop.getKeyTime(i).seconds - t) < 0.01) return i;
        }
        return -1;
    }

    return {
        addKey: function(ti, ci, comp, prop, time) {
            var p = FASTPASS.Clips.getProperty(ti, ci, comp, prop, "video");
            if (!p) return "ERR_PROP_NOT_FOUND";
            p.setTimeVarying(true);
            p.addKey(parseFloat(time));
            return "OK";
        },

        removeKey: function(ti, ci, comp, prop, time) {
            var p = FASTPASS.Clips.getProperty(ti, ci, comp, prop, "video");
            var idx = getKeyIndexByTime(p, time);
            if (idx !== -1) { p.removeKey(idx); return "OK"; }
            return "ERR_NOT_FOUND";
        },

        setKeyValue: function(ti, ci, comp, prop, time, val) {
            var p = FASTPASS.Clips.getProperty(ti, ci, comp, prop, "video");
            var idx = getKeyIndexByTime(p, time);
            if (idx !== -1) {
                if (prop === "ADBE Video Position") p.setValueAtKey(idx, val, true);
                else p.setValueAtKey(idx, parseFloat(val), true);
                return "OK";
            }
            return "ERR_NOT_FOUND";
        },

        setInterpolation: function(ti, ci, comp, prop, time, interpType) {
            var p = FASTPASS.Clips.getProperty(ti, ci, comp, prop, "video");
            var idx = getKeyIndexByTime(p, time);
            if (idx !== -1) {
                p.setInterpolationTypeAtKey(idx, parseInt(interpType), true);
                return "OK";
            }
            return "ERR_NOT_FOUND";
        },

        getKeys: function(ti, ci, comp, prop) {
            var p = FASTPASS.Clips.getProperty(ti, ci, comp, prop, "video");
            if (!p) return "[]";
            var data = [];
            for (var i = 0; i < p.numKeys; i++) {
                data.push({
                    time: p.getKeyTime(i).seconds,
                    val: p.getValueAtTime(p.getKeyTime(i))
                });
            }
            return JSON.stringify(data);
        },

        getXPosition: function() {
            try {
                var seq = app.project.activeSequence;
                var trackV1 = seq.videoTracks[0];
                var cti = seq.getPlayerPosition();
                var info = FASTPASS.Timeline.getClipInfoUnderCTI(0, cti.seconds);
                if (!info.found) return 0.5;
                
                var p = FASTPASS.Clips.getProperty(0, info.index, "ADBE Motion", "ADBE Video Position", "video");
                if (!p) return 0.5;
                return p.getValueAtTime(cti)[0];
            } catch(e) { return 0.5; }
        },

        setXPosition: function(val, isFinal) {
            try {
                var valNorm = parseFloat(val) / 608; 
                var seq = app.project.activeSequence;
                var cti = seq.getPlayerPosition();
                var info = FASTPASS.Timeline.getClipInfoUnderCTI(0, cti.seconds);
                if (!info.found) return "ERR_NO_CLIP";

                var p = FASTPASS.Clips.getProperty(0, info.index, "ADBE Motion", "ADBE Video Position", "video");
                if (!p) return "ERR_NO_PROP";

                p.setTimeVarying(isFinal);
                var currentVal = p.getValueAtTime(cti);
                currentVal[0] = valNorm;
                
                if (isFinal) {
                   p.addKey(cti.seconds);
                   var idx = getKeyIndexByTime(p, cti.seconds);
                   p.setValueAtKey(idx, currentVal, true);
                } else {
                   p.setValue(currentVal, true);
                }
                return "OK";
            } catch(e) { return "ERR: " + e.message; }
        },

        addKeyframeAtCurrentTime: function() {
            try {
                var seq = app.project.activeSequence;
                var cti = seq.getPlayerPosition();
                var info = FASTPASS.Timeline.getClipInfoUnderCTI(0, cti.seconds);
                if (!info.found) return "ERR_NO_CLIP";
                
                var p = FASTPASS.Clips.getProperty(0, info.index, "ADBE Motion", "ADBE Video Position", "video");
                if (!p) return "ERR_NO_PROP";
                
                p.setTimeVarying(true);
                p.addKey(cti.seconds);
                return "OK_ADD";
            } catch(e) { return "ERR: " + e.message; }
        },

        applyAutoReframe: function() {
            try {
                var seq = app.project.activeSequence;
                var cti = seq.getPlayerPosition();
                var info = FASTPASS.Timeline.getClipInfoUnderCTI(0, cti.seconds);
                if (!info.found) return "ERR_NO_CLIP";
                
                var clip = seq.videoTracks[0].clips[info.index];
                
                // A Premiere Pro 25, podem aplicar l'efecte "Auto Reframe"
                // Busquem l'efecte a la base de dades de Premiere
                var effect = app.project.getVideoEffectByName("Auto Reframe");
                if (effect) {
                    clip.addVideoEffect(effect);
                    return "OK_REFRAME";
                }
                
                // Alternativa: Command ID de Premiere (depèn de la versió)
                // app.executeCommand( ... );
                
                return "ERR_EFFECT_NOT_FOUND";
            } catch(e) { return "ERR: " + e.message; }
        }
    };
})();