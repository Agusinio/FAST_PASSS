/* * =================================================================================
 * 14_Anim.jsx (Sustituye a 7_KF.jsx)
 * Módulo especializado en la gestión literal de Keyframes y Animaciones.
 * (v18 - REFORMULACIÓN LITERAL - DRY)
 * =================================================================================
 */

if (typeof $.global.FASTPASS === "undefined") { $.global.FASTPASS = {}; }
var FASTPASS = $.global.FASTPASS;

FASTPASS.Anim = {

    // Caché dels límits de moviment (recalculats amb Anim.limits(); estables durant l'arrossegament)
    _limitsCache: null,

    /**
     * _get: Helper intern per trobar l'índex d'un keyframe per el seu temps.
     */
    _get: function(prop, timeSec) {
        if (!prop) return -1;
        var t = parseFloat(timeSec);
        // Preferir getKeys() si està disponible (més fiable en aquesta versió)
        try {
            var keys = prop.getKeys();
            if (keys && keys.length > 0) {
                for (var i = 0; i < keys.length; i++) {
                    if (Math.abs(keys[i].seconds - t) < 0.05) return i;
                }
                return -1;
            }
        } catch(e) {}
        // Fallback: numKeys/getKeyTime
        try {
            if (!prop.numKeys) return -1;
            for (var j = 0; j < prop.numKeys; j++) {
                if (Math.abs(prop.getKeyTime(j).seconds - t) < 0.05) return j;
            }
        } catch(e) {}
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
     * get: Retorna tots els KFs de posició del clip sota el CTI (sense paràmetres).
     * Usat per runSmoothKF() per obtenir els punts a suavitzar.
     */
    get: function() {
        try {
            var seq = (FASTPASS.Context) ? FASTPASS.Context.getWorkSequence() : app.project.activeSequence;
            if (!seq) return "[]";
            var cti = seq.getPlayerPosition();
            var info = FASTPASS.Clips.at(1, cti.seconds, "video");
            if (!info || info === "null") return "[]";
            var clip = seq.videoTracks[0].clips[JSON.parse(info).index];
            var mp = this._getMotionProps(clip);
            var p = mp ? mp.pos : null;
            if (!p || !p.numKeys) return "[]";
            var data = [];
            for (var i = 0; i < p.numKeys; i++) {
                var kTime = p.getKeyTime(i);
                data.push({ time: kTime.seconds, val: p.getValueAtTime(kTime) });
            }
            return JSON.stringify(data);
        } catch(e) { return "[]"; }
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
     * _getMotionProps: Retorna { motion, pos, scale, anchor } del clip donat,
     * cercant Motion per matchName/displayName i usant els índexos estàndard
     * (0=Position, 1=Scale, 2=Anchor Point).
     */
    _getMotionProps: function(clip) {
        try {
            if (!clip || !clip.components) return null;
            var n = clip.components.numItems || clip.components.length || 0;
            var motion = null;
            for (var i = 0; i < n; i++) {
                var c = clip.components[i];
                if (!c) continue;
                var mn = (c.matchName || "").toUpperCase();
                var dn = (c.displayName || "").toUpperCase();
                if (mn.indexOf("MOTION") !== -1 || dn === "MOTION" || dn === "MOVIMIENTO" || dn.indexOf("MOVIMIENTO") !== -1) {
                    motion = c;
                    break;
                }
            }
            if (!motion || !motion.properties) return null;
            return {
                motion: motion,
                pos: motion.properties[0] || null,
                scale: motion.properties[1] || null,
                anchor: motion.properties[2] || null
            };
        } catch(e) { return null; }
    },

    /**
     * _calcLimits: Calcula els límits de moviment normalitzats del clip sota el CTI.
     * Lògica pesada (accés a scale/frameSize) que NOMÉS s'executa aquí o quan
     * Anim.limits() es crida, NO a cada moviment del slider (per evitar latència).
     */
    _calcLimits: function() {
        try {
            var seq = (FASTPASS.Context) ? FASTPASS.Context.getWorkSequence() : app.project.activeSequence;
            if (!seq) return null;
            var cti = seq.getPlayerPosition();
            if (!cti) return null;
            var info = FASTPASS.Clips.at(1, cti.seconds, "video");
            if (!info || info === "null") return null;
            var idx = JSON.parse(info).index;
            var track = seq.videoTracks[0];
            if (!track || !track.clips) return null;
            var clip = track.clips[idx];
            if (!clip) return null;
            var mp = this._getMotionProps(clip);
            if (!mp || !mp.scale || !mp.pos) return null;
            var scale = mp.scale.getValue();
            if (scale == null) return null;
            scale = scale / 100;
            var seqW = seq.frameSizeHorizontal || (seq.frameRect ? (seq.frameRect[2] - seq.frameRect[0]) : 0);
            var seqH = seq.frameSizeVertical || (seq.frameRect ? (seq.frameRect[3] - seq.frameRect[1]) : 0);
            if (!seqW || !seqH) return null;
            var raw = mp.pos.getValue();
            var curNorm = (raw && typeof raw[0] === "number") ? raw[0] : 0.5;
            var canvasW = seqH * (9 / 16);
            var clipW = 1920 * scale;
            var margenNorm = Math.max(0, (clipW - canvasW) / (2 * seqW));
            var minNorm = curNorm - margenNorm;
            var maxNorm = curNorm + margenNorm;
            return { min: minNorm, max: maxNorm, cur: curNorm, margen: margenNorm, scale: scale, seqW: seqW, seqH: seqH, clipW: clipW, canvasW: canvasW };
        } catch(e) { return null; }
    },

    /**
     * x: Getter/Setter literal per a la posició X del clip sota CTI.
     */
    x: function(valNorm, isFinal) {
        try {
            var seq = (FASTPASS.Context) ? FASTPASS.Context.getWorkSequence() : app.project.activeSequence;
            if (!seq) return "ERR_NO_SEQ";
            var cti = seq.getPlayerPosition();
            if (!cti) return "ERR_NO_CTI";
            var info = FASTPASS.Clips.at(1, cti.seconds, "video");
            if (!info || info === "null") return "ERR_NO_CLIP_AT_CTI";

            var idx = JSON.parse(info).index;
            var track = seq.videoTracks[0];
            if (!track || !track.clips) return "ERR_NO_TRACK";
            var clip = track.clips[idx];
            if (!clip) return "ERR_NO_CLIP";
            var tKey = clip.inPoint.seconds + (cti.seconds - clip.start.seconds);

            var mp = this._getMotionProps(clip);

            if (arguments.length === 0) {
                if (!mp || !mp.pos) return 0.5;
                var gv = mp.pos.getValue();
                if (!gv) return 0.5;
                return gv[0];   // normalitzat 0..1
            }

            if (!mp || !mp.pos) return "ERR_NO_MOTION";

            var val = parseFloat(valNorm);   // 0..1 normalitzat (centre 0.5)
            var pPos = mp.pos;

            var raw = pPos.getValue();
            if (!raw) return "ERR_NO_POS_VAL";

            // Clampejar amb els límits cacheados (es recalculen a Anim.limits(),
            // NO a cada moviment del slider → menys latència)
            if (!this._limitsCache) this._limitsCache = this._calcLimits();
            var L = this._limitsCache;
            if (L) {
                if (val < L.min) val = L.min;
                if (val > L.max) val = L.max;
            }

            var newVal = [val, raw[1]];   // array literal nou (sense mutar getValue)

            if (isFinal) {
                var kIdx = this._get(pPos, tKey);
                if (kIdx === -1) {
                    pPos.setTimeVarying(true);
                    pPos.setValue(newVal, true);   // despertar motor
                    pPos.addKey(tKey);
                    kIdx = this._get(pPos, tKey);
                }
                if (kIdx === -1) return "ERR_NO_KIDX";
                pPos.setValueAtKey(kIdx, newVal, true);
            } else {
                pPos.setValue(newVal, true);
            }
            return "OK";
        } catch(e) { return "ERR: " + e.message; }
    },

    /**
     * limits: Retorna els límits de moviment lateral (pos X normalitzada 0..1)
     * per al clip sota el CTI, sense que la imatge surti del canvas.
     * El centre és 0.5, així que els límits són 0.5±margin (no simètrics a 0).
     */
    limits: function() {
        var L = this._calcLimits();
        this._limitsCache = L;   // actualitza la caché per al pròxim moviment del slider
        return L ? JSON.stringify(L) : "ERR:no-limits";
    },

    /**
     * addKF: Crea (o activa) un keyframe de Position al CTI amb el valor actual.
     * Usat pel botó KEYFRAME.
     */
    addKF: function() {
        try {
            var seq = (FASTPASS.Context) ? FASTPASS.Context.getWorkSequence() : app.project.activeSequence;
            if (!seq) return "ERR_NO_SEQ";
            var cti = seq.getPlayerPosition();
            if (!cti) return "ERR_NO_CTI";
            var info = FASTPASS.Clips.at(1, cti.seconds, "video");
            if (!info || info === "null") return "ERR_NO_CLIP_AT_CTI";

            var idx = JSON.parse(info).index;
            var track = seq.videoTracks[0];
            if (!track || !track.clips) return "ERR_NO_TRACK";
            var clip = track.clips[idx];
            if (!clip) return "ERR_NO_CLIP";
            var tKey = clip.inPoint.seconds + (cti.seconds - clip.start.seconds);

            var mp = this._getMotionProps(clip);
            if (!mp || !mp.pos) return "ERR_NO_MOTION";
            var pPos = mp.pos;

            var currentVal = pPos.getValue();   // array original per setValueAtKey
            if (!currentVal) return "ERR_NO_POS_VAL";

            var kIdx = this._get(pPos, tKey);
            if (kIdx === -1) {
                pPos.setTimeVarying(true);
                pPos.setValue(currentVal, true);   // despertar motor
                pPos.addKey(tKey);
                kIdx = this._get(pPos, tKey);
            }
            if (kIdx === -1) return "ERR_NO_KIDX";
            pPos.setValueAtKey(kIdx, currentVal, true);

            try { clip.setSelected(false, false); clip.setSelected(true, true); } catch(e) {}

            return "OK pos=" + JSON.stringify(currentVal);
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
    },

    /**
     * _getReframeComponent: Retorna el component "Auto Reframe" d'un clip (o null)
     */
    _getReframeComponent: function(clip) {
        try {
            if (!clip || !clip.components) return null;
            for (var i = 0; i < clip.components.numItems; i++) {
                var comp = clip.components[i];
                if (comp.displayName === "Auto Reframe" || comp.matchName === "AE.ADBE.AutoReframe") {
                    return comp;
                }
            }
        } catch(e) {}
        return null;
    },

    /**
     * _getReframeEffect: Retorna l'efecte "Auto Reframe" del projecte (o null)
     */
    _getReframeEffect: function() {
        try {
            var isReframe = function(name, match) {
                var dn = (name || "").toUpperCase();
                var mn = (match || "").toUpperCase();
                return dn === "AUTO REFRAME" || dn.indexOf("REFAME") !== -1 || mn.indexOf("REFAME") !== -1;
            };

            if (app.project && typeof app.project.getVideoEffectByName === 'function') {
                var e = app.project.getVideoEffectByName("Auto Reframe");
                if (e) return e;
            }
            if (app.project && app.project.videoEffects && typeof app.project.videoEffects.getVideoEffectByName === 'function') {
                var e2 = app.project.videoEffects.getVideoEffectByName("Auto Reframe");
                if (e2) return e2;
            }
            if (app.project && app.project.videoEffects) {
                var n = app.project.videoEffects.numItems || app.project.videoEffects.length || 0;
                for (var j = 0; j < n; j++) {
                    var eff = app.project.videoEffects[j];
                    if (eff && isReframe(eff.displayName, eff.matchName)) return eff;
                }
            }
            if (app.videoEffects) {
                var m = app.videoEffects.numItems || app.videoEffects.length || 0;
                for (var k = 0; k < m; k++) {
                    var e3 = app.videoEffects[k];
                    if (e3 && isReframe(e3.displayName, e3.matchName)) return e3;
                }
            }
            try {
                if (typeof app.enableQE === 'function') app.enableQE();
                if (typeof qe !== 'undefined' && qe.project && typeof qe.project.getVideoEffectByName === 'function') {
                    var qeEff = qe.project.getVideoEffectByName("Auto Reframe");
                    if (qeEff) return qeEff;
                }
            } catch(e2) {}
            return null;
        } catch(e) { return null; }
    },

    /**
     * debugVideoEffects: Diagnòstic de les APIs d'efectes disponibles (per loguejar).
     */
    debugVideoEffects: function() {
        var out = [];
        try {
            out.push("getByName=" + (app.project && typeof app.project.getVideoEffectByName === 'function'));
            out.push("proj.videoEffects=" + (app.project ? typeof app.project.videoEffects : "no-project"));
            if (app.project && app.project.videoEffects) {
                var n = app.project.videoEffects.numItems || app.project.videoEffects.length || 0;
                out.push("numItems=" + n);
                for (var j = 0; j < n; j++) {
                    var eff = app.project.videoEffects[j];
                    var dn = eff ? (eff.displayName || eff.name || "") : "";
                    var mn = eff ? (eff.matchName || "") : "";
                    if (dn.toUpperCase().indexOf("REFAME") !== -1 || mn.toUpperCase().indexOf("REFAME") !== -1) {
                        out.push("[" + j + "] dn=" + dn + " mn=" + mn);
                    }
                }
            }
            if (app.videoEffects) {
                var m = app.videoEffects.numItems || app.videoEffects.length || 0;
                out.push("app.videoEffects.numItems=" + m);
                for (var k = 0; k < m; k++) {
                    var e2 = app.videoEffects[k];
                    var dn2 = e2 ? (e2.displayName || e2.name || "") : "";
                    var mn2 = e2 ? (e2.matchName || "") : "";
                    if (dn2.toUpperCase().indexOf("REFAME") !== -1 || mn2.toUpperCase().indexOf("REFAME") !== -1) {
                        out.push("APP[" + k + "] dn=" + dn2 + " mn=" + mn2);
                    }
                }
            }
            try {
                if (typeof app.enableQE === 'function') app.enableQE();
                out.push("qe=" + (typeof qe));
                if (typeof qe !== 'undefined' && qe.project) {
                    out.push("qe.getVideoEffectByName=" + (typeof qe.project.getVideoEffectByName === 'function'));
                    var qeEff = qe.project.getVideoEffectByName("Auto Reframe");
                    out.push("qe.AutoReframe=" + (qeEff ? "FOUND dn=" + (qeEff.displayName || qeEff.name || "") + " mn=" + (qeEff.matchName || "") : "null"));
                    if (typeof qe.project.getVideoEffectList === 'function') {
                        var list = qe.project.getVideoEffectList();
                        var ln = list ? (list.numItems || list.length || 0) : 0;
                        out.push("qe.videoEffectList=" + ln);
                        for (var q = 0; q < ln; q++) {
                            var qf = list[q];
                            var qdn = qf ? (qf.displayName || qf.name || "") : "";
                            var qmn = qf ? (qf.matchName || "") : "";
                            if (qdn.toUpperCase().indexOf("REFAME") !== -1 || qmn.toUpperCase().indexOf("REFAME") !== -1) {
                                out.push("QE[" + q + "] dn=" + qdn + " mn=" + qmn);
                            }
                        }
                    }
                }
            } catch(e2) { out.push("qeERR=" + e2.message); }
        } catch(e) { out.push("ERR=" + e.message); }
        return out.join(" | ");
    },

    /**
     * _applyEffect: Aplica un efecte a un clip provant les diferents APIs disponibles.
     */
    _applyEffect: function(clip, effect, trackIndex, clipIndex) {
        try {
            if (!clip || !effect) return "ERR_NO_CLIP_OR_EFFECT";
            if (typeof clip.addVideoEffect === 'function') {
                clip.addVideoEffect(effect);
                return "OK";
            }
            if (clip.components && typeof clip.components.addVideoEffect === 'function') {
                clip.components.addVideoEffect(effect);
                return "OK";
            }
            if (clip.components && typeof clip.components.add === 'function') {
                clip.components.add(effect);
                return "OK";
            }
            if (clip.components && typeof clip.components.insert === 'function') {
                clip.components.insert(effect, 0);
                return "OK";
            }
            // QE DOM (via QETrack.addVideoEffect)
            var qeRes = this._applyEffectQE(trackIndex, clipIndex, effect);
            if (qeRes === "OK") return "OK";

            var keys = [];
            if (clip.components) { for (var k in clip.components) { keys.push(k); } }
            return "ERR_NO_ADD_METHOD " + qeRes +
                " comp.addVideoEffect=" + (clip.components ? typeof clip.components.addVideoEffect : "n/a") +
                " comp.add=" + (clip.components ? typeof clip.components.add : "n/a") +
                " comp.insert=" + (clip.components ? typeof clip.components.insert : "n/a") +
                " comp.keys=" + keys.join(",");
        } catch(e) { return "ERR: " + e.message; }
    },

    /**
     * _applyEffectQE: Aplica l'efecte via QE DOM (QETrack.addVideoEffect o QEClip).
     */
    _applyEffectQE: function(trackIndex, clipIndex, effect) {
        try {
            if (typeof app.enableQE === 'function') app.enableQE();
            if (typeof qe === 'undefined' || !qe.project) return "QE_NO_QE";
            var qeSeq = qe.project.getActiveSequence();
            if (!qeSeq) return "QE_NO_SEQ";
            var qeTrack = qeSeq.getVideoTrackAt(trackIndex);
            if (!qeTrack) return "QE_NO_TRACK";
            if (typeof qeTrack.addVideoEffect === 'function') {
                qeTrack.addVideoEffect(effect, clipIndex, true);
                return "OK";
            }
            if (typeof qeTrack.addEffect === 'function') {
                qeTrack.addEffect(effect, clipIndex, true);
                return "OK";
            }
            var qeItem = qeTrack.getItemAt(clipIndex);
            if (qeItem) {
                if (typeof qeItem.addVideoEffect === 'function') { qeItem.addVideoEffect(effect); return "OK"; }
                if (typeof qeItem.addEffect === 'function') { qeItem.addEffect(effect); return "OK"; }
            }
            var keys = [];
            for (var k in qeTrack) { keys.push(k); }
            var ikeys = [];
            if (qeItem) { for (var k2 in qeItem) { ikeys.push(k2); } }
            return "QE_NO_ADD track.keys=" + keys.join(",") + " item.keys=" + ikeys.join(",");
        } catch(e) { return "QE_ERR=" + e.message; }
    },

    /**
     * _removeEffectQE: Treu l'efecte via QE DOM.
     */
    _removeEffectQE: function(trackIndex, clipIndex, effect) {
        try {
            if (typeof app.enableQE === 'function') app.enableQE();
            if (typeof qe === 'undefined' || !qe.project) return "QE_NO_QE";
            var qeSeq = qe.project.getActiveSequence();
            if (!qeSeq) return "QE_NO_SEQ";
            var qeTrack = qeSeq.getVideoTrackAt(trackIndex);
            if (!qeTrack) return "QE_NO_TRACK";
            if (typeof qeTrack.removeVideoEffect === 'function') {
                qeTrack.removeVideoEffect(effect, clipIndex, true);
                return "OK";
            }
            if (typeof qeTrack.removeEffect === 'function') {
                qeTrack.removeEffect(effect, clipIndex, true);
                return "OK";
            }
            var qeItem = qeTrack.getItemAt(clipIndex);
            if (qeItem) {
                if (typeof qeItem.removeVideoEffect === 'function') { qeItem.removeVideoEffect(effect); return "OK"; }
                if (typeof qeItem.removeEffect === 'function') { qeItem.removeEffect(effect); return "OK"; }
                if (typeof qeItem.removeComponent === 'function') { qeItem.removeComponent(effect); return "OK"; }
            }
            var keys = [];
            for (var k in qeTrack) { keys.push(k); }
            var ikeys = [];
            if (qeItem) { for (var k2 in qeItem) { ikeys.push(k2); } }
            return "QE_NO_REMOVE track.keys=" + keys.join(",") + " item.keys=" + ikeys.join(",");
        } catch(e) { return "QE_ERR=" + e.message; }
    },

    /**
     * toggleReframe: Col·loca o treu l'efecte "Auto Reframe" del clip seleccionat
     * (si no hi ha selecció, del clip de V1 sota el cabezal).
     */
    toggleReframe: function() {
        try {
            var seq = ($.global.FASTPASS && FASTPASS.Context) ? FASTPASS.Context.getWorkSequence() : app.project.activeSequence;
            if (!seq) return "ERR_NO_SEQ";

            var trackIndex = -1, clipIndex = -1, clip = null;

            // 1. Clip seleccionat
            try {
                if (typeof seq.getSelection === 'function') {
                    var sel = seq.getSelection();
                    if (sel && sel.length > 0) {
                        clip = sel[0];
                        for (var t = 0; t < seq.videoTracks.numTracks; t++) {
                            var trk = seq.videoTracks[t];
                            for (var ci = 0; ci < trk.clips.numItems; ci++) {
                                var cc = trk.clips[ci];
                                if (cc === clip || (cc.nodeId && clip.nodeId && cc.nodeId === clip.nodeId)) {
                                    trackIndex = t; clipIndex = ci; break;
                                }
                            }
                            if (clipIndex !== -1) break;
                        }
                    }
                }
            } catch(e) {}

            // 2. Fallback: V1 sota el cabezal
            if (clipIndex === -1) {
                var cti = seq.getPlayerPosition().seconds;
                var track = seq.videoTracks[0];
                trackIndex = 0;
                for (var i = 0; i < track.clips.numItems; i++) {
                    var c = track.clips[i];
                    if (c.start.seconds <= cti && c.end.seconds > cti) { clip = c; clipIndex = i; break; }
                }
            }
            if (!clip || clipIndex === -1) return "ERR_CLIP_NOT_FOUND";

            var comp = this._getReframeComponent(clip);
            if (comp) {
                try {
                    if (typeof comp.remove === 'function') {
                        comp.remove();
                        return "OK_REMOVED_REFRAME";
                    }
                } catch(e) {}
                try {
                    var rmEffect = this._getReframeEffect();
                    if (rmEffect && typeof clip.removeVideoEffect === 'function') {
                        clip.removeVideoEffect(rmEffect);
                        return "OK_REMOVED_REFRAME";
                    }
                } catch(e) {}
                var qeRm = this._removeEffectQE(trackIndex, clipIndex, this._getReframeEffect());
                if (qeRm === "OK") return "OK_REMOVED_REFRAME";
                return "ERR_REMOVE_FAILED " + qeRm;
            }
            var effect = this._getReframeEffect();
            if (!effect) return "ERR_EFFECT_NOT_FOUND";
            var ap = this._applyEffect(clip, effect, trackIndex, clipIndex);
            return (ap === "OK") ? "OK_ADDED_REFRAME" : ap;
        } catch(e) { return "ERR: " + e.message; }
    },

    /**
     * reframeAtTime: Aplica (sense treure) l'efecte "Auto Reframe" al clip de V1
     * que conté el temps donat (usat pel botó NOM per reencuadrar el clip sota cada chyron).
     */
    reframeAtTime: function(timeSec) {
        try {
            var seq = ($.global.FASTPASS && FASTPASS.Context) ? FASTPASS.Context.getWorkSequence() : app.project.activeSequence;
            if (!seq) return "ERR_NO_SEQ";
            var t = parseFloat(timeSec);
            var track = seq.videoTracks[0];
            for (var i = 0; i < track.clips.numItems; i++) {
                var c = track.clips[i];
                if (c.start.seconds <= t && c.end.seconds > t) {
                    if (this._getReframeComponent(c)) return "INFO_ALREADY_HAS_REFRAME";
                    var effect = this._getReframeEffect();
                    if (!effect) return "ERR_EFFECT_NOT_FOUND";
                    var ap = this._applyEffect(c, effect, 0, i);
                    return (ap === "OK") ? "OK_ADDED_REFRAME" : ap;
                }
            }
            return "ERR_CLIP_NOT_FOUND";
        } catch(e) { return "ERR: " + e.message; }
    },

    /**
     * debugMotion: Diagnòstic dels components i propietats del clip sota CTI (V1).
     */
    debugMotion: function() {
        try {
            var seq = ($.global.FASTPASS && FASTPASS.Context) ? FASTPASS.Context.getWorkSequence() : app.project.activeSequence;
            if (!seq) return "NO_SEQ";
            var cti = seq.getPlayerPosition();
            var info = FASTPASS.Clips.at(1, cti.seconds, "video");
            if (!info || info === "null") return "NO_CLIP";
            var idx = JSON.parse(info).index;
            var clip = seq.videoTracks[0].clips[idx];
            if (!clip || !clip.components) return "NO_COMPONENTS";
            var out = [];
            var n = clip.components.numItems || clip.components.length || 0;
            out.push("comps=" + n);
            for (var i = 0; i < n; i++) {
                var c = clip.components[i];
                if (!c) continue;
                out.push("C[" + i + "] dn=" + (c.displayName || "") + " mn=" + (c.matchName || "") + " type=" + (c.type || ""));
                if (c.properties) {
                    var np = c.properties.numItems || c.properties.length || 0;
                    for (var j = 0; j < np; j++) {
                        var p = c.properties[j];
                        if (!p) continue;
                        out.push("P[" + j + "] dn=" + (p.displayName || "") + " mn=" + (p.matchName || ""));
                    }
                }
            }
            return out.join(" | ");
        } catch(e) { return "ERR: " + e.message; }
    },

    /**
     * debugPos: Diagnòstic del valor cru de Position/Scale al CTI (unitats/formato).
     */
    debugPos: function() {
        try {
            var seq = (FASTPASS.Context) ? FASTPASS.Context.getWorkSequence() : app.project.activeSequence;
            if (!seq) return "NO_SEQ";
            var cti = seq.getPlayerPosition();
            var info = FASTPASS.Clips.at(1, cti.seconds, "video");
            if (!info || info === "null") return "NO_CLIP";
            var idx = JSON.parse(info).index;
            var clip = seq.videoTracks[0].clips[idx];
            var mp = this._getMotionProps(clip);
            if (!mp || !mp.pos) return "NO_MOTION";
            var pv = mp.pos.getValue();
            var sv = mp.scale ? mp.scale.getValue() : null;
            return "pos=" + JSON.stringify(pv) + " len=" + (pv ? pv.length : 0) + " scale=" + sv;
        } catch(e) { return "ERR: " + e.message; }
    },

    /**
     * debugKF: Diagnòstic dels keyframes de Position del clip sota CTI (temps + valor).
     */
    debugKF: function() {
        try {
            var seq = (FASTPASS.Context) ? FASTPASS.Context.getWorkSequence() : app.project.activeSequence;
            if (!seq) return "NO_SEQ";
            var cti = seq.getPlayerPosition();
            var info = FASTPASS.Clips.at(1, cti.seconds, "video");
            if (!info || info === "null") return "NO_CLIP";
            var idx = JSON.parse(info).index;
            var clip = seq.videoTracks[0].clips[idx];
            var mp = this._getMotionProps(clip);
            if (!mp || !mp.pos) return "NO_MOTION";
            var pPos = mp.pos;
            var out = [];
            out.push("cti=" + cti.seconds + " start=" + clip.start.seconds + " inPoint=" + clip.inPoint.seconds + " tKey=" + (clip.inPoint.seconds + (cti.seconds - clip.start.seconds)));
            var keys = [];
            try { keys = pPos.getKeys(); } catch(e) {}
            out.push("kfs=" + (keys ? keys.length : -1));
            if (keys && keys.length > 0) {
                for (var k = 0; k < keys.length; k++) {
                    var kt = keys[k].seconds;
                    var kv = null;
                    try { if (typeof pPos.getValueAtKey === 'function') kv = pPos.getValueAtKey(k); } catch(e) {}
                    if (kv == null) { try { kv = pPos.getValueAtTime(keys[k]); } catch(e) {} }
                    out.push("K[" + k + "] t=" + kt + " v=" + JSON.stringify(kv));
                }
            }
            return out.join(" | ");
        } catch(e) { return "ERR: " + e.message; }
    },

    /**
     * setMotionValues: Aplica valors directes a les propietats de Motion d'un clip.
     * Funcio atomica: rep els valors com a JSON (tota la logica viu a la capa JS).
     * Indexs (segons "Propiedades del clip.txt"): 0=Position, 1=Scale,
     * 7=CropLeft, 8=CropTop, 9=CropRight, 10=CropBottom.
     *
     * @param {number} trackIdx - Pista (1-based)
     * @param {number} clipIdx - Index del clip (0-based)
     * @param {string} valuesJson - JSON amb {position:[x,y], scale, cropLeft, cropTop, cropRight, cropBottom}
     * @returns {string} "OK" o "ERR:..."
     */
    setMotionValues: function(trackIdx, clipIdx, valuesJson) {
        try {
            var seq = (FASTPASS.Context) ? FASTPASS.Context.getWorkSequence() : app.project.activeSequence;
            if (!seq) return "ERR_NO_SEQ";
            var track = seq.videoTracks[parseInt(trackIdx) - 1];
            if (!track || !track.clips) return "ERR_NO_TRACK";
            var clip = track.clips[parseInt(clipIdx)];
            if (!clip) return "ERR_NO_CLIP";
            var values = JSON.parse(valuesJson);
            var mp = this._getMotionProps(clip);
            if (!mp || !mp.motion || !mp.motion.properties) return "ERR_NO_MOTION";
            var props = mp.motion.properties;
            if (values.position) props[0].setValue(values.position);
            if (values.scale != null) props[1].setValue(values.scale);
            if (values.cropLeft != null) props[7].setValue(values.cropLeft);
            if (values.cropTop != null) props[8].setValue(values.cropTop);
            if (values.cropRight != null) props[9].setValue(values.cropRight);
            if (values.cropBottom != null) props[10].setValue(values.cropBottom);
            return "OK";
        } catch(e) { return "ERR: " + e.message; }
    }
};
