/* * =================================================================================
 * 14_Anim.jsx (Sustituye a 7_KF.jsx)
 * Módulo especializado en la gestión literal de Keyframes y Animaciones.
 * (v18 - REFORMULACIÓN LITERAL - DRY)
 * =================================================================================
 */

if (typeof $.global.FASTPASS === "undefined") { $.global.FASTPASS = {}; }
var FASTPASS = $.global.FASTPASS;

FASTPASS.Anim = {

    /**
     * _get: Helper intern per trobar l'índex d'un keyframe per el seu temps.
     */
    _get: function(prop, timeSec) {
        if (!prop || !prop.numKeys) return -1;
        var t = parseFloat(timeSec);
        for (var i = 0; i < prop.numKeys; i++) {
            if (Math.abs(prop.getKeyTime(i).seconds - t) < 0.01) return i;
        }
        return -1;
    },

    /**
     * add: Afegeix un punt d'animació en un temps T.
     */
    add: function(ti, ci, comp, prop, time) {
        var p = FASTPASS.Clips.getProp(ti, ci, comp, prop, "video");
        if (!p) return "ERR_PROP";
        p.setTimeVarying(true);
        p.addKey(parseFloat(time));
        return "OK";
    },

    /**
     * remove: Esborra el punt d'animació en un temps T.
     */
    remove: function(ti, ci, comp, prop, time) {
        var p = FASTPASS.Clips.getProp(ti, ci, comp, prop, "video");
        var idx = this._get(p, time);
        if (idx !== -1) { p.removeKey(idx); return "OK"; }
        return "ERR_NOT_FOUND";
    },

    /**
     * set: Canvia el valor d'un punt d'animació existent.
     */
    set: function(ti, ci, comp, prop, time, val) {
        var p = FASTPASS.Clips.getProp(ti, ci, comp, prop, "video");
        var idx = this._get(p, time);
        if (idx !== -1) {
            if (prop === "ADBE Video Position") p.setValueAtKey(idx, val, true);
            else p.setValueAtKey(idx, parseFloat(val), true);
            return "OK";
        }
        return "ERR_NOT_FOUND";
    },

    /**
     * interp: Estableix la interpolació física (5=Bezier, 1=Lineal, etc).
     */
    interp: function(ti, ci, comp, prop, time, typeIdx) {
        var p = FASTPASS.Clips.getProp(ti, ci, comp, prop, "video");
        var idx = this._get(p, time);
        if (idx !== -1) {
            p.setInterpolationTypeAtKey(idx, parseInt(typeIdx), true);
            return "OK";
        }
        return "ERR_NOT_FOUND";
    },

    /**
     * list: Retorna l'estructura completa de punts d'una propietat.
     */
    list: function(ti, ci, comp, prop) {
        var p = FASTPASS.Clips.getProp(ti, ci, comp, prop, "video");
        if (!p) return "[]";
        var data = [];
        for (var i = 0; i < p.numKeys; i++) {
            var kTime = p.getKeyTime(i);
            data.push({ time: kTime.seconds, val: p.getValueAtTime(kTime) });
        }
        return JSON.stringify(data);
    },

    /**
     * x: Getter/Setter literal per a la posició X del clip sota CTI.
     */
    x: function(valNorm, isFinal) {
        try {
            var seq = (FASTPASS.Context) ? FASTPASS.Context.getWorkSequence() : app.project.activeSequence;
            if (!seq) return 0.5;
            var cti = seq.getPlayerPosition();
            var info = FASTPASS.Clips.at(1, cti.seconds, "video");
            if (!info || info === "null") return 0.5;
            
            var pPos = FASTPASS.Clips.getProp(1, JSON.parse(info).index, "ADBE Motion", "ADBE Video Position", "video");
            
            if (arguments.length === 0) {
                return pPos ? pPos.getValueAtTime(cti)[0] : 0.5;
            }

            var val = parseFloat(valNorm);
            var pScale = FASTPASS.Clips.getProp(1, JSON.parse(info).index, "ADBE Motion", "ADBE Video Scale", "video");
            if (!pPos || !pScale) return "ERR_NO_PROP";

            var seqW = seq.frameRect[2] - seq.frameRect[0];
            var scale = pScale.getValueAtTime(cti) / 100;
            var clipW = 1920 * scale; 
            
            if (clipW > seqW) {
                var margin = ((clipW - seqW) / 2) / seqW;
                var minL = 0.5 - margin;
                var maxL = 0.5 + margin;
                if (val < minL) val = minL;
                if (val > maxL) val = maxL;
            } else { val = 0.5; }

            pPos.setTimeVarying(isFinal);
            var currentVal = pPos.getValueAtTime(cti);
            currentVal[0] = val;
            
            if (isFinal) {
                pPos.addKey(cti.seconds);
                var kIdx = this._get(pPos, cti.seconds);
                pPos.setValueAtKey(kIdx, currentVal, true);
            } else {
                pPos.setValue(currentVal, true);
            }
            return "OK";
        } catch(e) { return "ERR: " + e.message; }
    },

    /**
     * reframe: Aplica l'efecte "Auto Reframe" a un clip (o avisa si ja existeix)
     */
    reframe: function(ti, ci) {
        try {
            var seq = ($.global.FASTPASS && FASTPASS.Context) ? FASTPASS.Context.getWorkSequence() : app.project.activeSequence;
            var track = seq.videoTracks[ti - 1];
            var clip = track.clips[ci];
            if (!clip) return "ERR_CLIP_NOT_FOUND";

            // Buscar si ja té l'efecte
            for (var i = 0; i < clip.components.numItems; i++) {
                var comp = clip.components[i];
                if (comp.displayName === "Auto Reframe" || comp.matchName === "AE.ADBE.AutoReframe") {
                    return "INFO_ALREADY_HAS_REFRAME";
                }
            }

            var effect = null;
            // Intentar varios métodos para obtener el efecto Auto Reframe
            if (app.project.getVideoEffectByName && typeof app.project.getVideoEffectByName === 'function') {
                effect = app.project.getVideoEffectByName("Auto Reframe");
            } else if (app.project.videoEffects && app.project.videoEffects.getVideoEffectByName) {
                effect = app.project.videoEffects.getVideoEffectByName("Auto Reframe");
            } else if (app.project.videoEffects) {
                // iterar sobre la colección de efectos de video
                for (var j = 0; j < app.project.videoEffects.numItems; j++) {
                    var eff = app.project.videoEffects[j];
                    if (eff.displayName === "Auto Reframe" || eff.matchName === "AE.ADBE.AutoReframe") {
                        effect = eff;
                        break;
                    }
                }
            }
            if (effect) {
                clip.addVideoEffect(effect);
                return "OK_ADDED_REFRAME";
            }
            return "ERR_EFFECT_NOT_FOUND";
        } catch(e) { return "ERR: " + e.message; }
    }
};