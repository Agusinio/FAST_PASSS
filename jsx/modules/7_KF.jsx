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
                var cti = seq.getPlayerPosition();
                var info = FASTPASS.Timeline.getClipInfoUnderCTI(1, "video", cti.seconds);
                if (!info.found) return 0.5;
                
                var p = FASTPASS.Clips.getProperty(1, info.index, "ADBE Motion", "ADBE Video Position", "video");
                if (!p) return 0.5;
                return p.getValueAtTime(cti)[0];
            } catch(e) { return 0.5; }
        },
    
        setXPosition: function(valNorm, isFinal) {
            try {
                var val = parseFloat(valNorm);
                var seq = app.project.activeSequence;
                var seqW = seq.frameRect[2] - seq.frameRect[0];
                
                var cti = seq.getPlayerPosition();
                var info = FASTPASS.Timeline.getClipInfoUnderCTI(1, "video", cti.seconds);
                if (!info.found) return "ERR_NO_CLIP";
    
                var idx = info.index;
                var pPos = FASTPASS.Clips.getProperty(1, idx, "ADBE Motion", "ADBE Video Position", "video");
                var pScale = FASTPASS.Clips.getProperty(1, idx, "ADBE Motion", "ADBE Video Scale", "video");
                
                if (!pPos || !pScale) return "ERR_NO_PROP";
    
                // --- CALCULA LÍMITS FÍSICS REALS (Anti-Negre) ---
                var scale = pScale.getValueAtTime(cti) / 100; // Premiere usa %
                var clipW = 1920 * scale; // Suposem que el clip base és 1920 (16:9)
                
                // Si el clip és més estret que la seqüència, no hi ha marge de moviment
                if (clipW <= seqW) {
                    val = 0.5; 
                } else {
                    var marginNorm = ((clipW - seqW) / 2) / seqW;
                    var minL = 0.5 - marginNorm;
                    var maxL = 0.5 + marginNorm;
                    
                    if (val < minL) val = minL;
                    if (val > maxL) val = maxL;
                }

                pPos.setTimeVarying(isFinal);
                var currentVal = pPos.getValueAtTime(cti);
                currentVal[0] = val; // Directament el valor normalitzat clamat
                
                if (isFinal) {
                   pPos.addKey(cti.seconds);
                   var kIdx = getKeyIndexByTime(pPos, cti.seconds);
                   pPos.setValueAtKey(kIdx, currentVal, true);
                } else {
                   pPos.setValue(currentVal, true);
                }
                return "OK";
            } catch(e) { return "ERR: " + e.message; }
        },

        addKeyframeAtCurrentTime: function() {
            try {
                var seq = app.project.activeSequence;
                var cti = seq.getPlayerPosition();
                var info = FASTPASS.Timeline.getClipInfoUnderCTI(1, "video", cti.seconds);
                if (!info.found) return "ERR_NO_CLIP";
                
                var p = FASTPASS.Clips.getProperty(1, info.index, "ADBE Motion", "ADBE Video Position", "video");
                if (!p) return "ERR_NO_PROP";
                
                p.setTimeVarying(true);
                p.addKey(cti.seconds);
                return "OK_ADD";
            } catch(e) { return "ERR: " + e.message; }
        },

        applyAutoReframe: function(trackIdx, clipIdx) {
            try {
                var seq = app.project.activeSequence;
                var track = seq.videoTracks[trackIdx - 1]; // Base 1 a Base 0
                if (!track) return "ERR_TRACK_NOT_FOUND";
                
                var clip = track.clips[clipIdx];
                if (!clip) return "ERR_CLIP_NOT_FOUND";
                
                var effect = app.project.getVideoEffectByName("Auto Reframe");
                if (effect) {
                    clip.addVideoEffect(effect);
                    return "OK_REFRAME";
                }
                
                return "ERR_EFFECT_NOT_FOUND";
            } catch(e) { return "ERR: " + e.message; }
        }
    };
})();