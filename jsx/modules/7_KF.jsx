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

    // Preset de la Doble Finestra (config Motion aplicada pel PAS4 a V2/V3). El slider
    // l'usa per saber quins recortes ha de tenir cada capa i re-aplicar-los si Premiere
    // els ha perdut en seleccionar/interactuar amb el clip (bug DF 2026-09-04).
    _dfPreset: null,

    /**
     * setDfPreset: Guarda la configuració Motion de la DF aplicada pel PAS4.
     * @param {string} jsonStr - JSON {v2:{...}, v3:{...}} amb els valors de cada capa.
     */
    setDfPreset: function(jsonStr) {
        try {
            this._dfPreset = JSON.parse(jsonStr);
            return "OK";
        } catch(e) { return "ERR: " + e.message; }
    },

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
     * _findMotionProp: Resol una propietat dins de motion.properties pel seu nom
     * (displayName o matchName, normalitzats sense accents/espais), amb possibilitat
     * de variantes EN/ES. Retorna null si no es troba.
     */
    _findMotionProp: function(props, names) {
        try {
            var n = props.length || props.numItems || 0;
            for (var i = 0; i < n; i++) {
                var p = props[i];
                if (!p) continue;
                var dn = (p.displayName || "").toUpperCase().replace(/[^A-Z]/g, "");
                var mn = (p.matchName || "").toUpperCase().replace(/[^A-Z]/g, "");
                for (var k = 0; k < names.length; k++) {
                    if (dn === names[k] || mn === names[k]) return p;
                }
            }
            return null;
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
            // [0,0] de fàbrica → centre
            if (curNorm === 0 && raw && raw.length >= 2 && parseFloat(raw[1]) === 0) curNorm = 0.5;

            // ── LÍMITS FIXOS DEL REENCUADRE HORITZONTAL ──────────────────────
            // El clip és sempre de 1920 px d'amplada. El centre (X) pot recórrer
            // [ seqW−1920/2 , 1920/2 ] cobrint tot el canvas sense forats.
            // CONFIRMAT amb probeRange (2026-09-02): el motor NewWorld accepta
            // valors fins a 960 px → no hi ha límit intern; usem la geometria.
            // Es deixa 1 px de seguretat als extrems → [-351, 959] px amb seqW=608.
            var CLIP_W_PX = 1920;          // amplada de la font (sempre 1920)
            var maxPx = Math.round(CLIP_W_PX / 2) - 1;                 // 959
            var minPx = Math.round(seqW - (CLIP_W_PX / 2)) + 1;        // -351 (seqW=608)
            var minNorm = minPx / seqW;
            var maxNorm = maxPx / seqW;
            var margenNorm = (maxNorm - minNorm) / 2;
            return {
                min: minNorm, max: maxNorm, cur: curNorm, margen: margenNorm,
                scale: scale, seqW: seqW, seqH: seqH,
                minPx: minPx, maxPx: maxPx, curPx: curNorm * seqW
            };
        } catch(e) { return null; }
    },

    /**
     * x: Getter/Setter literal per a la posició X del clip sota CTI.
     */
    x: function(valNorm, isFinal, addKey) {
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
            // Els keyframes de Motion d'un clip es referencien en el temps del CLIP
            // (media time), NO en el del timeline. tKey = inPoint + desplaçament dins
            // del clip.
            var tKey = clip.inPoint.seconds + (cti.seconds - clip.start.seconds);

            var mp = this._getMotionProps(clip);

            if (arguments.length === 0) {
                if (!mp || !mp.pos) return 0.5;
                var gv = null;
                try {
                    var tObjG = seq.getPlayerPosition();
                    tObjG.seconds = tKey;
                    if (typeof mp.pos.getValueAtTime === 'function') {
                        gv = mp.pos.getValueAtTime(tObjG);
                    }
                } catch(eT2) {}
                if (!gv) { try { gv = mp.pos.getValue(); } catch(eG2) {} }
                if (!gv) return 0.5;
                var gx = parseFloat(gv[0]);
                if (isNaN(gx)) return 0.5;
                // [0,0] sense inicialitzar → centre
                var gy2 = (gv.length >= 2) ? parseFloat(gv[1]) : NaN;
                if (gx === 0 && (isNaN(gy2) || gy2 === 0)) return 0.5;
                return gx;   // normalitzat 0..1 (el motor SEMPRE retorna normalitzat)
            }

            if (!mp || !mp.pos) return "ERR_NO_MOTION";

            // Si el clip porta Auto Reframe, la Position la controla l'efecte:
            // qualsevol setValue es reverteix en el següent refresc (per això el
            // slider "rebota" al valor que imposa l'efecte). Avisem clarament.
            try {
                if (this._getReframeComponent && this._getReframeComponent(clip)) {
                    return "ERR_AUTO_REFRAME: desactiva Auto Reframe (botó NOM) abans d'usar el slider";
                }
            } catch(eAR) {}

            var val = parseFloat(valNorm);   // 0..1 normalitzat (centre 0.5)
            var pPos = mp.pos;

            // Captura del valor actual. Si la propietat ja està animada es llegeix
            // amb getValueAtTime al mateix temps on es crearà el key (tKey);
            // si no, getValue() (valor estàtic). getValue() pot retornar [0,0]
            // en clips acabats d'inserir (NewWorld) → es sanejara després.
            var raw = null;
            try {
                var tObjR = seq.getPlayerPosition();
                tObjR.seconds = tKey;
                if (typeof pPos.getValueAtTime === 'function') {
                    raw = pPos.getValueAtTime(tObjR);
                }
            } catch(eT) {}
            if (!raw) { try { raw = pPos.getValue(); } catch(eG) {} }
            if (!raw) return "ERR_NO_POS_VAL";

            // ── DEFENSES (motor NewWorld) ────────────────────────────────────
            // El valor del slider ja ve NORMALITZAT (0..1, centre 0.5) i el motor
            // NewWorld treballa SEMPRE en normalitzat (mai píxels): NO es pot
            // re-normalitzar per magnitud perquè el rang legítim del reencuadre
            // supera 1.5 (959 px = 1.577) i dividir-lo el corrompria a ~0.
            // La Y es manté al centre (0.5): si el motor reporta 0 (eix vertical
            // mai inicialitzat), es considera "no tocat" i es deixa en 0.5.
            var yActual = 0.5;
            if (raw.length >= 2) {
                var ry = parseFloat(raw[1]);
                if (!isNaN(ry) && ry !== 0) yActual = ry;
            }

            // Clampejar amb els límits cacheados (es recalculen a Anim.limits(),
            // NO a cada moviment del slider → menys latència)
            if (!this._limitsCache) this._limitsCache = this._calcLimits();
            var L = this._limitsCache;
            if (L) {
                if (val < L.min) val = L.min;
                if (val > L.max) val = L.max;
            }

            var newVal = [val, yActual];   // array literal nou (sense mutar getValue)

            // Si la propietat JA està animada (té keyframes), el motor NewWorld només
            // registra canvis via keyframe (setValueAtKey); el setValue global es
            // descarta i el valor "rebota" al key més proper. Per tant, si el clip
            // és timeVarying, SEMPRE escrivim sobre el keyframe del CTI (creant-lo
            // si no existeix). Si no està animat i no es demana key → setValue.
            var usarKey = (isFinal && addKey);
            if (!usarKey && pPos.isTimeVarying && pPos.isTimeVarying()) usarKey = true;

            if (usarKey) {
                var kIdx = this._get(pPos, tKey);
                if (kIdx === -1) {
                    pPos.setTimeVarying(true);
                    pPos.setValue(newVal, true);   // despertar motor
                    pPos.addKey(tKey);
                }
                // Escriure el valor pel TEMPS del key (no per índex): el motor
                // NewWorld espera el temps com a primer argument.
                try { pPos.setValueAtKey(tKey, newVal, true); } catch(eSK2) {}
            } else {
                pPos.setValue(newVal, true);
            }

            // ── COMMIT (en soltar el slider) ─────────────────────────────────
            // El motor NewWorld no "registra" el valor a la UI/efecte fins que es
            // força un refresc del clip (toggle de selecció). Sense això, el valor
            // s'aplica a la vista però no queda fixat (el que veies al re-obrir).
            if (isFinal) {
                try { clip.setSelected(false, false); clip.setSelected(true, true); } catch(eSel) {}
            }

            // Verificació post-escriptura: si el motor no accepta el valor escrit
            // (p. ex. té un límit intern ~1.5 normalitzat), ho reportem per poder
            // ajustar el límit del slider al tope real.
            var check = null;
            try { check = pPos.getValue(); } catch(eCh) {}
            if (check && check.length >= 2) {
                var cx = parseFloat(check[0]);
                if (!isNaN(cx) && Math.abs(cx - val) > 0.01) {
                    var seqWv2 = seq.frameSizeHorizontal || 0;
                    var pxEscrit = Math.round(val * (seqWv2 || 1));
                    var pxLlegit = Math.round(cx * (seqWv2 || 1));
                    return "OK_WARN motor_reset escrit=" + pxEscrit + "px llegit=" + pxLlegit + "px (norm " + val.toFixed(4) + "->" + cx.toFixed(4) + ")";
                }
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
     * _clipV2BajoCTI: Helper per localitzar el clip de VÍDEO de la pista 2 (V2) que hi
     * ha sota el CTI (la capa inferior de la doble finestra). Retorna {clip, idx, mp} o null.
     */
    _clipV2BajoCTI: function(seq) {
        try {
            var cti = seq.getPlayerPosition();
            if (!cti) return null;
            var info = FASTPASS.Clips.at(2, cti.seconds, "video");
            if (!info || info === "null") return null;
            var idx = JSON.parse(info).index;
            var track = seq.videoTracks[1];
            if (!track || !track.clips) return null;
            var clip = track.clips[idx];
            if (!clip) return null;
            var mp = this._getMotionProps(clip);
            if (!mp || !mp.pos) return null;
            return { clip: clip, idx: idx, mp: mp };
        } catch(e) { return null; }
    },

    /**
     * panV2: Getter/Setter de PAN horitzontal per al clip de V2 sota el CTI.
     * A diferència de x() (que mou la posició del clip sencer), aquí el moviment
     * COMPENSA el recorte del costat que limita visualment (el que cau DINS del
     * canvas, normalment el que mira cap al centre de la seqüència): d'aquesta manera
     * el marc/encuadre ("catch") no es mou i només es desplaça el contingut interior.
     * El recorte de l'altre costat no es toca (cau fora del canvas).
     * Unitats: valNorm = X en fracció de frame (0..1, centre 0.5), com el slider general.
     */
    panV2: function(valNorm, isFinal) {
        try {
            var seq = (FASTPASS.Context) ? FASTPASS.Context.getWorkSequence() : app.project.activeSequence;
            if (!seq) return "ERR_NO_SEQ";
            var f = this._clipV2BajoCTI(seq);
            if (!f) return "ERR_NO_CLIP_V2_AT_CTI";
            var clip = f.clip, mp = f.mp;

            // ── Getter (sense arguments): retorna la X actual normalitzada del clip V2 ──
            if (arguments.length === 0) {
                var gv = null;
                try { gv = mp.pos.getValue(); } catch(eG) {}
                if (!gv) return "0.5";
                var gx = parseFloat(gv[0]);
                if (isNaN(gx)) return "0.5";
                if (gx === 0 && gv.length >= 2 && parseFloat(gv[1]) === 0) return "0.5";
                return gx.toString();
            }

            var props = mp.motion ? mp.motion.properties : null;
            var pCropL = this._findMotionProp(props, ["CROPLEFT", "RECORTEIZQUIERDA"]);
            var pCropR = this._findMotionProp(props, ["CROPRIGHT", "RECORTEDERECHA"]);
            var seqW = seq.frameSizeHorizontal || 0;
            if (!seqW) return "ERR_NO_SEQW";

            var val = parseFloat(valNorm);
            var targetPx = val * seqW;

            // Valor actual (X normalitzada) i Y (es preserva).
            var raw = null;
            try { raw = mp.pos.getValue(); } catch(eR) {}
            var curNorm = (raw && typeof raw[0] === "number") ? parseFloat(raw[0]) : 0.5;
            var yActual = 0.5;
            if (raw && raw.length >= 2 && !isNaN(parseFloat(raw[1])) && parseFloat(raw[1]) !== 0) yActual = parseFloat(raw[1]);
            if (curNorm === 0 && raw && raw.length >= 2 && parseFloat(raw[1]) === 0) curNorm = 0.5;
            var curPx = curNorm * seqW;
            var delta = targetPx - curPx;

            var scale = mp.scale ? mp.scale.getValue() : 100;
            if (scale == null) scale = 100;
            var CLIP_W_PX = 1920;
            var anchoImg = CLIP_W_PX * (scale / 100);       // amplada de la imatge a pantalla
            var cropL = (pCropL) ? (parseFloat(pCropL.getValue()) || 0) : 0;
            var cropR = (pCropR) ? (parseFloat(pCropR.getValue()) || 0) : 0;
            var cropLPx = (cropL / 100) * anchoImg;          // recorte físic (px pantalla)
            var cropRPx = (cropR / 100) * anchoImg;
            var bordeIzq = curPx - anchoImg / 2 + cropLPx;   // borde visible esquerre
            var bordeDer = curPx + anchoImg / 2 - cropRPx;   // borde visible dret

            // Costat que cal compensar: el recorte del costat que té el seu borde DINS del
            // canvas (l'altre costat cau fora i no té incidència visual).
            var compL = (bordeIzq >= 0 && bordeDer > seqW);
            var compR = (bordeIzq < 0 && bordeDer <= seqW);
            var compAmbdos = (bordeIzq >= 0 && bordeDer <= seqW); // cas simètric (ventana centrada)
            if (!compL && !compR && !compAmbdos) {
                // Per defecte, si és ambigu: compensar el recorte del costat que apunta al centre.
                compL = (curPx <= seqW / 2);
                compR = !compL;
            }

            var dCropPct = (anchoImg > 0) ? (delta / anchoImg) * 100 : 0;
            var newCropL = cropL;
            var newCropR = cropR;
            if (compL || compAmbdos) newCropL = Math.max(0, Math.min(100, cropL - dCropPct));
            if (compR || compAmbdos) newCropR = Math.max(0, Math.min(100, cropR + dCropPct));

            // Escriure posició (X nova, Y conservada) i recortes compensats.
            mp.pos.setValue([targetPx / seqW, yActual], true);
            if (compL || compAmbdos) { if (pCropL) pCropL.setValue(newCropL); }
            if (compR || compAmbdos) { if (pCropR) pCropR.setValue(newCropR); }

            // COMMIT: refresc NewWorld (toggle de selecció) perquè la UI mostri el canvi.
            if (isFinal) {
                try { clip.setSelected(false, false); clip.setSelected(true, true); } catch(eSel) {}
            }

            return "OK pan dx=" + Math.round(delta) + "px cropL=" + Math.round(newCropL * 10) / 10 + " cropR=" + Math.round(newCropR * 10) / 10;
        } catch(e) { return "ERR: " + e.message; }
    },

    /**
     * panV2Limits: Límits del PAN per al clip de V2 sota el CTI. Igual que el slider
     * general, el recorregut queda limitat per l'amplada del clip (1920 px) i, a més,
     * pels recortes actuals (el moviment no pot portar el recorte compensat fora de
     * [0..100]). Retorna JSON amb minPx/maxPx/seqW/curPx per ajustar el <input>.
     */
    panV2Limits: function() {
        try {
            var seq = (FASTPASS.Context) ? FASTPASS.Context.getWorkSequence() : app.project.activeSequence;
            if (!seq) return "ERR_NO_SEQ";
            var f = this._clipV2BajoCTI(seq);
            if (!f) return "ERR_NO_CLIP_V2_AT_CTI";
            var mp = f.mp;
            var props = mp.motion ? mp.motion.properties : null;
            var pCropL = this._findMotionProp(props, ["CROPLEFT", "RECORTEIZQUIERDA"]);
            var pCropR = this._findMotionProp(props, ["CROPRIGHT", "RECORTEDERECHA"]);
            var seqW = seq.frameSizeHorizontal || 0;
            if (!seqW) return "ERR_NO_SEQW";

            var raw = null;
            try { raw = mp.pos.getValue(); } catch(eR) {}
            var curNorm = (raw && typeof raw[0] === "number") ? parseFloat(raw[0]) : 0.5;
            if (curNorm === 0 && raw && raw.length >= 2 && parseFloat(raw[1]) === 0) curNorm = 0.5;
            var curPx = curNorm * seqW;
            var scale = mp.scale ? mp.scale.getValue() : 100;
            if (scale == null) scale = 100;
            var cropL = (pCropL) ? (parseFloat(pCropL.getValue()) || 0) : 0;
            var cropR = (pCropR) ? (parseFloat(pCropR.getValue()) || 0) : 0;

            var CLIP_W_PX = 1920;
            var anchoImg = CLIP_W_PX * (scale / 100);
            var minGral = Math.round(seqW - (CLIP_W_PX / 2)) + 1;   // igual que el slider general
            var maxGral = Math.round(CLIP_W_PX / 2) - 1;            // 959
            var limMin = minGral, limMax = maxGral;

            // Restricció pels recortes: el recorte compensat no pot sortir de [0..100].
            if (pCropL) {
                limMax = Math.min(limMax, Math.round(curPx + (cropL / 100) * anchoImg));
                limMin = Math.max(limMin, Math.round(curPx - ((100 - cropL) / 100) * anchoImg));
            }
            if (pCropR) {
                limMax = Math.min(limMax, Math.round(curPx + ((100 - cropR) / 100) * anchoImg));
                limMin = Math.max(limMin, Math.round(curPx - (cropR / 100) * anchoImg));
            }
            if (limMin > limMax) limMax = limMin; // rang mínim d'1px per no trencar el slider

            return JSON.stringify({ minPx: limMin, maxPx: limMax, curPx: Math.round(curPx * 100) / 100, seqW: seqW, scale: scale, cropL: cropL, cropR: cropR });
        } catch(e) { return "ERR: " + e.message; }
    },

    /**
     * _sliderTarget: Objectiu del slider = el clip de VÍDEO SELECCIONAT (per pista).
     * Si no n'hi ha cap de seleccionat, es fa servir el clip de V1 sota el CTI
     * (comportament històric del reencuadre). Retorna {track, clip} o null.
     */
    _sliderTarget: function(seq) {
        try {
            var selRaw = FASTPASS.Clips.getSelectedVideo();
            if (selRaw && selRaw !== "null") {
                var s = JSON.parse(selRaw);
                var trSel = seq.videoTracks[parseInt(s.track) - 1];
                if (trSel && trSel.clips && trSel.clips[parseInt(s.index)]) {
                    return { track: parseInt(s.track), clip: trSel.clips[parseInt(s.index)] };
                }
            }
        } catch(eS) {}
        try {
            var cti = seq.getPlayerPosition();
            var info = FASTPASS.Clips.at(1, cti.seconds, "video");
            if (info && info !== "null") {
                var c2 = seq.videoTracks[0].clips[JSON.parse(info).index];
                if (c2) return { track: 1, clip: c2 };
            }
        } catch(eC) {}
        return null;
    },

    /**
     * _esImatgeFons: True si el clip és una IMATGE (PNG/JPG...) de fons. Aquests clips
     * (p. ex. el fons de la Doble Finestra a V1) NO s'han de moure mai amb el slider.
     */
    _esImatgeFons: function(clip) {
        try {
            if (!clip || !clip.projectItem || !clip.projectItem.name) return false;
            var n = String(clip.projectItem.name).toLowerCase();
            if (n.indexOf("fons-per-videos") !== -1) return true;
            return /\.(png|jpg|jpeg|bmp|tga|tif|tiff)$/.test(n);
        } catch(e) { return false; }
    },



    /**
     * sliderApply: Getter/Setter del slider per al clip objectiu (el SELECCIONAT).
     * - Si el clip té RECORTE lateral (p. ex. V3 de la doble finestra) → PAN amb
     *   compensació del recorte: el marc/encuadre no es mou, només es desplaça el
     *   contingut interior (es compensa el recorte del costat amb crop>0).
     * - Si NO té recorte (V1, V2 simplificada, MAPA...) → moviment de posició normal.
     * Unitats: valNorm = X normalitzada (0..1, centre 0.5), com el slider general.
     */
    sliderApply: function(valNorm, isFinal, addKey) {
        try {
            var seq = (FASTPASS.Context) ? FASTPASS.Context.getWorkSequence() : app.project.activeSequence;
            if (!seq) return "ERR_NO_SEQ";
            var target = this._sliderTarget(seq);
            if (!target) return "ERR_NO_SLIDER_TARGET";
            var clip = target.clip;
            var mp = this._getMotionProps(clip);
            if (!mp || !mp.pos) return "ERR_NO_MOTION";
            var props = mp.motion ? mp.motion.properties : null;
            // ⚠️ Fallback per ÍNDEX (props[7..10]) igual que set/getMotionValues: la cerca
            // per nom pot fallar en certs Premiere i llavors pCropR=null → el slider mai
            // veu el recorte (bug DF 2026-09-04: el PAS4 escrivia cropRight=64.5 però el
            // slider el llegia com a 0).
            var pCropL = this._findMotionProp(props, ["CROPLEFT", "RECORTEIZQUIERDA"]) || props[7];
            var pCropR = this._findMotionProp(props, ["CROPRIGHT", "RECORTEDERECHA"]) || props[9];
            var pCropT = this._findMotionProp(props, ["CROPTOP", "RECORTESUPERIOR"]) || props[8];
            var pCropB = this._findMotionProp(props, ["CROPBOTTOM", "RECORTEINFERIOR"]) || props[10];

            var seqW = seq.frameSizeHorizontal || 0;
            if (!seqW) return "ERR_NO_SEQW";

            // ── Getter (sense arguments): X normalitzada actual del clip objectiu ──
            if (arguments.length === 0) {
                var gv = null;
                try { gv = mp.pos.getValue(); } catch(eG) {}
                if (!gv) return "0.5";
                var gx = parseFloat(gv[0]);
                if (isNaN(gx)) return "0.5";
                if (gx === 0 && gv.length >= 2 && parseFloat(gv[1]) === 0) return "0.5";
                return gx.toString();
            }

            // Un PNG de fons (p. ex. el de la Doble Finestra a V1) no es mou MAI.
            if (this._esImatgeFons(clip)) return "OK_IGNORAT_IMATGE_FONS";

            var val = parseFloat(valNorm);
            var targetPx = val * seqW;
            var raw = null;
            try { raw = mp.pos.getValue(); } catch(eR) {}
            var curNorm = (raw && typeof raw[0] === "number") ? parseFloat(raw[0]) : 0.5;
            var yActual = 0.5;
            if (raw && raw.length >= 2 && !isNaN(parseFloat(raw[1])) && parseFloat(raw[1]) !== 0) yActual = parseFloat(raw[1]);
            if (curNorm === 0 && raw && raw.length >= 2 && parseFloat(raw[1]) === 0) curNorm = 0.5;
            var delta = targetPx - curNorm * seqW;

            var scale = mp.scale ? mp.scale.getValue() : 100;
            if (scale == null) scale = 100;
            var cropL = (pCropL) ? (parseFloat(pCropL.getValue()) || 0) : 0;
            var cropR = (pCropR) ? (parseFloat(pCropR.getValue()) || 0) : 0;
            var cropT = (pCropT) ? (parseFloat(pCropT.getValue()) || 0) : 0;
            var cropB = (pCropB) ? (parseFloat(pCropB.getValue()) || 0) : 0;

            // 🎯 Doble Finestra: si el clip és de V2/V3 amb escala de DF (~68%) i li falten
            // els recortes de la DF (el PAS4 els escriu i persisteixen, però Premiere els
            // perd en seleccionar/interactuar amb el clip), re-aplicar-los ABANS de moure.
            var _dfReap = "noDF";
            if ((target.track === 2 || target.track === 3) && scale > 50 && scale < 90) {
                var _pKey2 = "v" + target.track;
                var _preset2 = (this._dfPreset) ? this._dfPreset[_pKey2] : null;
                var _pL2 = 0, _pR2 = 0, _pT2 = 0, _pB2 = 0;
                if (_preset2) {
                    _pL2 = (_preset2.cropLeft != null) ? parseFloat(_preset2.cropLeft) : 0;
                    _pR2 = (_preset2.cropRight != null) ? parseFloat(_preset2.cropRight) : 0;
                    _pT2 = (_preset2.cropTop != null) ? parseFloat(_preset2.cropTop) : 0;
                    _pB2 = (_preset2.cropBottom != null) ? parseFloat(_preset2.cropBottom) : 0;
                } else if (target.track === 3) {
                    // Fallback: configuració V3 de la DF (mantenir sincronitzada amb PAS4).
                    _pR2 = 64.5; _pT2 = 14; _pB2 = 15.5;
                }
                if (pCropL && _pL2 > 0.01 && cropL <= 0.01) { try { pCropL.setValue(_pL2); } catch(ePL) {} cropL = _pL2; }
                if (pCropR && _pR2 > 0.01 && cropR <= 0.01) { try { pCropR.setValue(_pR2); } catch(ePR) {} cropR = _pR2; }
                if (pCropT && _pT2 > 0.01 && cropT <= 0.01) { try { pCropT.setValue(_pT2); } catch(ePT) {} }
                if (pCropB && _pB2 > 0.01 && cropB <= 0.01) { try { pCropB.setValue(_pB2); } catch(ePB) {} }
                if (_pL2 > 0.01 || _pR2 > 0.01) _dfReap = "reap";
            }
            var teRecorte = (cropL > 0.01 || cropR > 0.01);

            // ── Sense recorte: moviment de posició normal ──
            if (!teRecorte) {
                // V1: delegar a x() per conservar tota la lògica de keyframes/límits actual.
                if (target.track === 1) {
                    return this.x(valNorm, !!isFinal, !!addKey);
                }
                var newVal = [val, yActual];
                var tKey = clip.inPoint.seconds + (seq.getPlayerPosition().seconds - clip.start.seconds);
                var usarKey = !!addKey;
                if (!usarKey && mp.pos.isTimeVarying && mp.pos.isTimeVarying()) usarKey = true;
                if (usarKey) {
                    var kIdx = this._get(mp.pos, tKey);
                    if (kIdx === -1) {
                        mp.pos.setTimeVarying(true);
                        mp.pos.setValue(newVal, true);
                        mp.pos.addKey(tKey);
                    }
                    try { mp.pos.setValueAtKey(tKey, newVal, true); } catch(eSK) {}
                } else {
                    mp.pos.setValue(newVal, true);
                }
                if (isFinal) { try { clip.setSelected(false, false); clip.setSelected(true, true); } catch(eSel) {} }
                // DIAGNÒSTIC: si el clip HA de tenir recorte i no s'ha detectat (teRecorte
                // false), el return mostra els valors reals llegits (cropL/cropR/scale/track)
                // i QUIN clip és (start/name) per detectar seleccions sobre clips equivocats.
                var _nm = "";
                try { _nm = clip.projectItem ? String(clip.projectItem.name) : ""; } catch(eN) {}
                var _st = "";
                try { _st = (clip.start && clip.start.seconds != null) ? clip.start.seconds.toFixed(2) : ""; } catch(eS) {}
                return "OK x=" + Math.round(targetPx) + "px [track=" + target.track + " start=" + _st + " \"" + _nm + "\" scale=" + scale + " cropL=" + cropL + " cropR=" + cropR + " repair=" + _dfReap + "]";
            }

            // ── Amb recorte: PAN amb compensació del recorte (el marc no es mou) ──
            // cropL -= t i cropR += t mantenen la finestra visible (marc) al mateix lloc
            // del canvas; el que es desplaça és la franja de material visible.
            // t (%) = delta px · 100 / amplada imatge.
            // ⚠️ LÍMITS REALS del moviment (bug DF 2026-09-04):
            //  - Cap a l'ESQUERRA (t<0): revela material cap a la dreta del pla. Límit:
            //    cropR+t ≥ 0 (el recorte dret no pot baixar de 0).
            //  - Cap a la DRETA (t>0): revela material cap a l'esquerra del pla. Límit:
            //    el marge ESQUERRE de la imatge (pos-half) pot arribar fins a x=0 del
            //    canvas (half-curPx px). NO limitar per cropL: amb cropLeft=0 això
            //    bloquejaria tot el moviment a la dreta quan en realitat hi ha marge
            //    (el costat esquerre de la finestra el retalla el canvas, no el crop).
            var CLIP_W_PX = 1920;
            var anchoImg = CLIP_W_PX * (scale / 100);
            var halfImg = anchoImg / 2;
            var tMin = Math.max(cropL - 100, -cropR);                 // t més negatiu permès
            var _margeDret = halfImg - curNorm * seqW;                // px fins que la imatge toca x=0
            var tMax = Math.min(100 - cropR, (anchoImg > 0 && _margeDret > 0) ? (_margeDret / anchoImg) * 100 : 0);
            var tDes = (anchoImg > 0) ? (delta / anchoImg) * 100 : 0;
            var t = Math.max(tMin, Math.min(tMax, tDes));
            var effPx = curNorm * seqW + (t * anchoImg) / 100;   // posició X efectiva (px)
            var effNorm = (seqW > 0) ? effPx / seqW : val;        // normalitzada per al motor

            mp.pos.setValue([effNorm, yActual], true);
            var newCropL = Math.max(0, Math.min(100, cropL - t));
            var newCropR = Math.max(0, Math.min(100, cropR + t));
            if (pCropL) pCropL.setValue(newCropL);
            if (pCropR) pCropR.setValue(newCropR);
            if (isFinal) {
                try { clip.setSelected(false, false); clip.setSelected(true, true); } catch(eSel) {}
            }
            return "OK panRecorte dx=" + Math.round(effPx - curNorm * seqW) + "px cropL=" + Math.round(newCropL * 10) / 10 + " cropR=" + Math.round(newCropR * 10) / 10;
        } catch(e) { return "ERR: " + e.message; }
    },


    /**
     * sliderLimits: Límits del slider per al clip objectiu (el SELECCIONAT).
     * Igual que el slider general: recorregut limitat per l'amplada del clip (1920 px),
     * més la restricció dels recortes (si n'hi ha) perquè el recorte compensat no surti
     * de [0..100]. Retorna JSON {minPx,maxPx,curPx,seqW,scale,cropL,cropR}.
     */
    sliderLimits: function() {
        try {
            var seq = (FASTPASS.Context) ? FASTPASS.Context.getWorkSequence() : app.project.activeSequence;
            if (!seq) return "ERR_NO_SEQ";
            var target = this._sliderTarget(seq);
            if (!target) return "ERR_NO_SLIDER_TARGET";
            var clip = target.clip;
            var mp = this._getMotionProps(clip);
            if (!mp || !mp.pos) return "ERR_NO_MOTION";
            var props = mp.motion ? mp.motion.properties : null;
            // ⚠️ Fallback per ÍNDEX (igual que set/getMotionValues) perquè el slider
            // detecti els recortes encara que la cerca per nom falli (bug DF 2026-09-04).
            var pCropL = this._findMotionProp(props, ["CROPLEFT", "RECORTEIZQUIERDA"]) || props[7];
            var pCropR = this._findMotionProp(props, ["CROPRIGHT", "RECORTEDERECHA"]) || props[9];
            var seqW = seq.frameSizeHorizontal || 0;
            if (!seqW) return "ERR_NO_SEQW";

            var raw = null;
            try { raw = mp.pos.getValue(); } catch(eR) {}
            var curNorm = (raw && typeof raw[0] === "number") ? parseFloat(raw[0]) : 0.5;
            if (curNorm === 0 && raw && raw.length >= 2 && parseFloat(raw[1]) === 0) curNorm = 0.5;
            var curPx = curNorm * seqW;
            var scale = mp.scale ? mp.scale.getValue() : 100;
            if (scale == null) scale = 100;
            var cropL = (pCropL) ? (parseFloat(pCropL.getValue()) || 0) : 0;
            var cropR = (pCropR) ? (parseFloat(pCropR.getValue()) || 0) : 0;
            // Un PNG de fons no es mou MAI: slider immobilitzat (rang zero a la X actual).
            if (this._esImatgeFons(clip)) {
                var rxF = curNorm * seqW;
                return JSON.stringify({ minPx: Math.round(rxF), maxPx: Math.round(rxF), curPx: Math.round(rxF), seqW: seqW, scale: scale, cropL: cropL, cropR: cropR });
            }


            // ── Càlcul de límits segons el tipus de clip ──
            // ⚠️ S'usa l'amplada REAL del clip escalat (1920 × scale/100), NO l'amplada
            // sense escalar: amb els límits genèrics de 1920px, un clip de la DF escalat
            // al 68% (1305px) es podia desplaçar fins a deixar el seu borde al CENTRE del
            // canvas (bug DF 2026-09-04: V3 s'aturava amb el borde esquerre de la imatge
            // al centre del canvas en lloc del borde del canvas).
            var CLIP_W_PX = 1920;
            var anchoImg = CLIP_W_PX * (scale / 100);
            var limMin, limMax;
            if (cropL > 0.01 || cropR > 0.01) {
                // Clip amb recorte (V3 de la DF): PAN amb marc FIX. El recorregut queda
                // limitat pel marge real de material:
                //  - cap a l'ESQUERRA: fins que cropR s'esgota → curPx - (cropR/100)·anchoImg.
                //  - cap a la DRETA: fins que el marge esquerre de la imatge toca x=0 del
                //    canvas → curPx + (halfImg - curPx). NO limitar per cropL (amb
                //    cropLeft=0 el costat esquerre de la finestra el retalla el canvas).
                limMin = curPx - (cropR / 100) * anchoImg;
                limMax = curPx + Math.min((100 - cropR) / 100 * anchoImg, Math.max(0, anchoImg / 2 - curPx));
            } else {
                // Sense recorte (V2 de la DF, MAPA, V1...): el recorregut ha de mantenir
                // el canvas COBERT per la imatge: el contingut es pot barrer fins que un
                // dels dos costats de la imatge toca el costat oposat del canvas.
                var half = anchoImg / 2;
                if (anchoImg >= seqW) {
                    limMin = seqW - half;   // borde dret de la imatge al borde dret del canvas
                    limMax = half;          // borde esquerre de la imatge al borde esquerre del canvas
                } else {
                    // Imatge més petita que el canvas: centrada (no pot cobrir-lo sencer).
                    limMin = seqW / 2 - half;
                    limMax = seqW / 2 + half;
                }
            }
            limMin = Math.round(limMin);
            limMax = Math.round(limMax);
            if (limMin > limMax) limMax = limMin; // rang mínim d'1px per no trencar el slider

            return JSON.stringify({ minPx: limMin, maxPx: limMax, curPx: Math.round(curPx * 100) / 100, seqW: seqW, scale: scale, cropL: cropL, cropR: cropR });
        } catch(e) { return "ERR: " + e.message; }
    },


    /**
     * addKF: Botó KEYFRAME (toggle) sobre el clip OBJECTIU del slider (el clip de
     * vídeo SELECCIONAT; si no n'hi ha, la V1 sota el CTI).
     * - Sense key a l'instant del CTI → CREA el key de Position amb el valor actual.
     * - Amb key a l'instant del CTI → EL TREU (i desactiva l'animació si era l'únic).
     * Usat pel botó KEYFRAME.
     */
    addKF: function() {
        try {
            var seq = (FASTPASS.Context) ? FASTPASS.Context.getWorkSequence() : app.project.activeSequence;
            if (!seq) return "ERR_NO_SEQ";
            var cti = seq.getPlayerPosition();
            if (!cti) return "ERR_NO_CTI";

            // 🎯 Objectiu = el MATEIX que el slider: el clip SELECCIONAT (o V1 sota
            // el CTI com a fallback). Abans el KEYFRAME queia SEMPRE a la V1 del
            // playhead i, en seleccionar un altre clip sense moure el cabezal (o en
            // V2/V3), el key es col·locava al clip del primer keyframe en comptes del
            // clip seleccionat.
            var target = this._sliderTarget(seq);
            if (!target) return "ERR_NO_SLIDER_TARGET";
            var clip = target.clip;
            var trackN = target.track;
            // Els clips de fons (PNG/JPG) no s'animen mai amb KF (mateix criteri slider).
            if (this._esImatgeFons(clip)) return "OK_IGNORAT_IMATGE_FONS";

            var mp = this._getMotionProps(clip);
            if (!mp || !mp.pos) return "ERR_NO_MOTION";
            var pPos = mp.pos;

            // Els keyframes de Motion d'un clip es referencien en el temps del CLIP
            // (media time), NO en el del timeline.
            var tKey = clip.inPoint.seconds + (cti.seconds - clip.start.seconds);

            // ── TOGGLE (QUITA): si el clip ja té un key a l'instant del CTI, el
            // botó KEYFRAME l'ELIMINA. Si amb això la propietat queda amb 0 o 1 keys,
            // es desactiva l'animació (timeVarying=false) i el clip torna al mode
            // SLIDER.
            var kIdx0 = this._get(pPos, tKey);
            if (kIdx0 !== -1) {
                try { pPos.removeKey(kIdx0); } catch(eRm) {}
                var nKeys0 = 0;
                try {
                    var _ka = (typeof pPos.getKeys === 'function') ? pPos.getKeys() : null;
                    nKeys0 = (_ka && _ka.length) ? _ka.length : ((pPos.numKeys) ? pPos.numKeys : 0);
                } catch(eKn) {
                    try { nKeys0 = (pPos.numKeys) ? pPos.numKeys : 0; } catch(eKn2) {}
                }
                // Amb un sol key la propietat no està realment animada → mode SLIDER.
                if (nKeys0 <= 1) { try { pPos.setTimeVarying(false); } catch(eTv) {} }
                try { clip.setSelected(false, false); clip.setSelected(true, true); } catch(eSel0) {}
                return "OK_REMOVED track=" + trackN + " tKey=" + tKey.toFixed(3) + " keysLeft=" + nKeys0;
            }

            var currentVal = null;
            var capturedRaw = null;   // per diagnòstic
            try {
                var tObjK = seq.getPlayerPosition();
                tObjK.seconds = tKey;
                // La doc del projecte (KEYFRAMES_REFERENCE): la captura del valor es fa
                // SEMPRE amb getValueAtTime (evita que el key salti a 0,0 / defaults).
                if (typeof pPos.getValueAtTime === 'function') {
                    currentVal = pPos.getValueAtTime(tObjK);
                }
            } catch(eT) {}
            if (!currentVal) { try { currentVal = pPos.getValue(); } catch(eG) {} }
            if (!currentVal) return "ERR_NO_POS_VAL";
            capturedRaw = currentVal;

            // Valor de fàbrica buit ([0,0] / [0] / null) → centre de pantalla.
            var esZeroInit = false;
            if (typeof currentVal === 'number') {
                esZeroInit = (currentVal === 0);
            } else if (!currentVal || typeof currentVal !== 'object') {
                esZeroInit = true;
            } else if (currentVal.length === 1) {
                esZeroInit = (parseFloat(currentVal[0]) === 0);
            } else if (currentVal.length >= 2) {
                esZeroInit = (parseFloat(currentVal[0]) === 0 && parseFloat(currentVal[1]) === 0);
            }
            if (esZeroInit) {
                currentVal = [0.5, 0.5];
            } else {
                var rawXk = parseFloat(currentVal[0]);
                var rawYk = (currentVal.length >= 2) ? parseFloat(currentVal[1]) : NaN;
                if (isNaN(rawXk)) rawXk = 0.5;
                if (isNaN(rawYk)) rawYk = 0.5;
                // En el reencuadre la Y no es toca (només X). Si el motor reporta
                // Y=0 (eix vertical mai inicialitzat), forcem el centre vertical 0.5.
                if (rawYk === 0) rawYk = 0.5;
                currentVal = [rawXk, rawYk];
            }

            // ── No existeix cap key a l'instant del CTI → CREAR-LO amb el valor
            // capturat (ja s'ha comprovat amb kIdx0 que el punt està lliure).
            pPos.setTimeVarying(true);
            pPos.setValue(currentVal, true);   // despertar motor
            pPos.addKey(tKey);
            // Índex real del key acabat de crear (el motor pot reordenar).
            var kIdx = this._get(pPos, tKey);
            // Escriure el valor del key pel seu TEMPS, no per índex: el motor
            // NewWorld espera el temps com a primer argument (veure
            // KEYFRAMES_REFERENCE §4: setValueAtKey(t1, [0.5,0.5], true)).
            try { pPos.setValueAtKey(tKey, currentVal, true); } catch(eSK) {}

            // Verificació: si el motor no ha respectat el valor al key (el deixa
            // a 0,0 o a un valor diferent), es reintenta sobre TOTS els keys del
            // voltant per si l'índex s'ha desviat en el motor NewWorld.
            var checkKey = null;
            try { if (typeof pPos.getValueAtKey === 'function') checkKey = pPos.getValueAtKey(kIdx); } catch(eCk) {}
            if (!checkKey) {
                try {
                    var tCk = seq.getPlayerPosition();
                    tCk.seconds = tKey;
                    if (typeof pPos.getValueAtTime === 'function') checkKey = pPos.getValueAtTime(tCk);
                } catch(eCk2) {}
            }
            var checkStr = (checkKey ? JSON.stringify(checkKey) : "null");
            if (checkKey && checkKey.length >= 1) {
                var ckx = parseFloat(checkKey[0]);
                var diffX = Math.abs(ckx - parseFloat(currentVal[0]));
                if (isNaN(ckx) || diffX > 0.01) {
                    // Reintentar escrivint pel TEMPS del key (NewWorld espera temps, no índex)
                    try { pPos.setValueAtKey(tKey, currentVal, true); } catch(eRk0) {}
                    try {
                        var keys2 = pPos.getKeys();
                        if (keys2) {
                            for (var k2 = 0; k2 < keys2.length; k2++) {
                                if (Math.abs(keys2[k2].seconds - tKey) < 0.1) {
                                    try { pPos.setValueAtKey(keys2[k2], currentVal, true); } catch(eRk2) {}
                                }
                            }
                        }
                    } catch(eRk3) {}
                }
            }

            try { clip.setSelected(false, false); clip.setSelected(true, true); } catch(e) {}

            return "OK pos=" + JSON.stringify(currentVal) + " cap=" + JSON.stringify(capturedRaw) +
                " check=" + checkStr + " tKey=" + tKey.toFixed(3) + " cti=" + cti.seconds.toFixed(3) +
                " track=" + trackN + " start=" + clip.start.seconds.toFixed(3) +
                " inPt=" + clip.inPoint.seconds.toFixed(3);
        } catch(e) { return "ERR: " + e.message; }
    },

    /**
     * modeInfo: Estat del clip OBJECTIU del slider (el SELECCIONAT, o V1 sota CTI
     * com a fallback): { track, start, name, kf }. kf=true si la Position del clip
     * està animada (timeVarying). Ho fa servir la UI per canviar automàticament al
     * mode del clip quan canvia la selecció: sense keyframes → mode SLIDER;
     * amb keyframes → mode KEYFRAME.
     */
    modeInfo: function() {
        try {
            var seq = (FASTPASS.Context) ? FASTPASS.Context.getWorkSequence() : app.project.activeSequence;
            if (!seq) return "null";
            var target = this._sliderTarget(seq);
            if (!target) return "null";
            var clip = target.clip;
            var kf = false;
            try {
                var mp = this._getMotionProps(clip);
                if (mp && mp.pos) {
                    if (typeof mp.pos.isTimeVarying === 'function') {
                        kf = !!mp.pos.isTimeVarying();
                    }
                    if (!kf) {
                        var _mk = (typeof mp.pos.getKeys === 'function') ? mp.pos.getKeys() : null;
                        kf = !!(_mk && _mk.length >= 1);
                    }
                }
            } catch(eM) {}
            var _nm = "";
            try { _nm = clip.projectItem ? String(clip.projectItem.name) : ""; } catch(eN) {}
            var _st = "";
            try { _st = (clip.start && clip.start.seconds != null) ? clip.start.seconds.toFixed(2) : ""; } catch(eS) {}
            return JSON.stringify({
                track: (target.track != null) ? String(target.track) : "",
                start: _st,
                name: _nm,
                kf: kf
            });
        } catch(e) { return "null"; }
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

            // Resoldre propietats per nom (més robust que assumir índexos), amb fallback a índex estàndard
            var pPos = this._findMotionProp(props, ["POSITION", "POSICION"]) || props[0];
            var pScale = this._findMotionProp(props, ["SCALE", "ESCALA"]) || props[1];
            var pScaleW = this._findMotionProp(props, ["SCALEWIDTH", "ANCHODEESCALA", "ANCHODELAESCALA"]) || props[2];
            var pUniform = this._findMotionProp(props, ["UNIFORMSCALE", "ESCALAUNIFORME"]) || props[3];
            var pCropL = this._findMotionProp(props, ["CROPLEFT", "RECORTEIZQUIERDA"]) || props[7];
            var pCropT = this._findMotionProp(props, ["CROPTOP", "RECORTESUPERIOR"]) || props[8];
            var pCropR = this._findMotionProp(props, ["CROPRIGHT", "RECORTEDERECHA"]) || props[9];
            var pCropB = this._findMotionProp(props, ["CROPBOTTOM", "RECORTEINFERIOR"]) || props[10];

            // ⚠️ POSICIÓ NORMALITZADA: en el motor NewWorld de Premiere 25+, Motion Position
            // s'expressa en fracció del frame (0..1, centre 0.5). La UI mostra PÍXELS, però la
            // API setValue espera normalitzat. Si enviem píxels (141, 451...) el motor els
            // satura a 32767 a la UI. Convertim: norm = px / frameSize.
            if (values.position && pPos) {
                var seqWp = seq.frameSizeHorizontal || 0;
                var seqHp = seq.frameSizeVertical || 0;
                if (seqWp > 0 && seqHp > 0 && values.position.length >= 2) {
                    pPos.setValue([values.position[0] / seqWp, values.position[1] / seqHp]);
                } else {
                    pPos.setValue(values.position);
                }
            }
            // Només la Y (px): conserva la X actual del clip (per no desplaçar-lo).
            if (values.positionY != null && pPos) {
                var seqHpy = seq.frameSizeVertical || 0;
                var curRaw = null;
                try { curRaw = pPos.getValue(); } catch(ePY) {}
                var curX = 0.5;
                if (curRaw && curRaw.length >= 1 && !isNaN(parseFloat(curRaw[0]))) curX = parseFloat(curRaw[0]);
                var yNorm = (seqHpy > 0) ? values.positionY / seqHpy : values.positionY;
                pPos.setValue([curX, yNorm]);
            }
            if (values.scale != null && pScale) {
                pScale.setValue(values.scale);
                // ⚠️ Escala UNIFORME garantitzada: si el clip té "Uniform Scale" desactivat
                // (o un Scale Width residual de 100), aplicar només scale deixaria l'eix X
                // al 100% i la imatge NO es veuria escalada al % indicat (bug DF 2026-09-04:
                // el log mostrava scale=68 però scaleWidth=100). Forcem Uniform Scale i
                // Scale Width = scale quan el caller no demani scaleWidth no uniforme.
                if (values.scaleWidth == null) {
                    if (pUniform && typeof pUniform.setValue === 'function') {
                        try { pUniform.setValue(true); } catch(eU2) {}
                    }
                    if (pScaleW) { try { pScaleW.setValue(values.scale); } catch(eW2) {} }
                }
            }
            // Escala NO uniforme (Scale Width / eix X): desactiva "Uniform Scale"
            // i escriu Scale Width (X), mantenint el Scale (Y) actual del clip.
            if (values.scaleWidth != null) {
                if (pUniform && typeof pUniform.setValue === 'function') {
                    try { pUniform.setValue(false); } catch(eU) {}
                }
                if (pScaleW) pScaleW.setValue(values.scaleWidth);
            }
            if (values.cropLeft != null && pCropL) pCropL.setValue(values.cropLeft);
            if (values.cropTop != null && pCropT) pCropT.setValue(values.cropTop);
            if (values.cropRight != null && pCropR) pCropR.setValue(values.cropRight);
            if (values.cropBottom != null && pCropB) pCropB.setValue(values.cropBottom);

            // Refresc NewWorld: sense el toggle de selecció la UI no mostra el canvi
            // fins que es clica el clip (mateix mecanisme que als keyframes).
            try { clip.setSelected(false, false); clip.setSelected(true, true); } catch(eSel) {}

            // Verificació immediata: rellegir els valors acabats d'escriure per detectar
            // si el motor els descarta a l'instant (bug DF 2026-09-04: cropR=0 malgrat
            // escriure cropRight=64.5).
            var _vL = "", _vR = "", _vS = "";
            try { if (pCropL) _vL = String(pCropL.getValue()); } catch(eVL) {}
            try { if (pCropR) _vR = String(pCropR.getValue()); } catch(eVR) {}
            try { if (pScale) _vS = String(pScale.getValue()); } catch(eVS) {}
            return "OK:scale=" + _vS + " cropL=" + _vL + " cropR=" + _vR;
        } catch(e) { return "ERR: " + e.message; }
    },

    /**
     * getMotionValues: Llegeix els valors actuals de Motion d'un clip concret.
     * @param {number} trackIdx - Pista (1-based)
     * @param {number} clipIdx - Index del clip (0-based)
     * @returns {string} JSON {position, scale, cropLeft, cropTop, cropRight, cropBottom} o "ERR:..."
     */
    getMotionValues: function(trackIdx, clipIdx) {
        try {
            var seq = (FASTPASS.Context) ? FASTPASS.Context.getWorkSequence() : app.project.activeSequence;
            if (!seq) return "ERR_NO_SEQ";
            var track = seq.videoTracks[parseInt(trackIdx) - 1];
            if (!track || !track.clips) return "ERR_NO_TRACK";
            var clip = track.clips[parseInt(clipIdx)];
            if (!clip) return "ERR_NO_CLIP";
            var mp = this._getMotionProps(clip);
            if (!mp || !mp.motion || !mp.motion.properties) return "ERR_NO_MOTION";
            var props = mp.motion.properties;

            // Resoldre propietats per nom amb fallback a índex estàndard (mateixa lògica que setMotionValues)
            var pPos = this._findMotionProp(props, ["POSITION", "POSICION"]) || props[0];
            var pScale = this._findMotionProp(props, ["SCALE", "ESCALA"]) || props[1];
            var pScaleW = this._findMotionProp(props, ["SCALEWIDTH", "ANCHODEESCALA", "ANCHODELAESCALA"]) || props[2];
            var pCropL = this._findMotionProp(props, ["CROPLEFT", "RECORTEIZQUIERDA"]) || props[7];
            var pCropT = this._findMotionProp(props, ["CROPTOP", "RECORTESUPERIOR"]) || props[8];
            var pCropR = this._findMotionProp(props, ["CROPRIGHT", "RECORTEDERECHA"]) || props[9];
            var pCropB = this._findMotionProp(props, ["CROPBOTTOM", "RECORTEINFERIOR"]) || props[10];

            var seqWp = seq.frameSizeHorizontal || 0;
            var seqHp = seq.frameSizeVertical || 0;

            // v: llegeix el valor. La POSICIÓ ve normalitzada (0..1) → es torna a PÍXELS
            // (× frameSize) perquè el log sigui comparable amb la UI de Premiere.
            function v(p, isPosition) {
                try {
                    if (!p) return null;
                    var raw = p.getValue();
                    if (raw && typeof raw === "object" && raw.length) {
                        var a = [];
                        for (var k = 0; k < raw.length; k++) {
                            var val = raw[k];
                            if (isPosition) val = val * (k === 0 ? seqWp : seqHp);
                            a.push(Math.round(val * 100) / 100);
                        }
                        return a;
                    }
                    return Math.round(raw * 100) / 100;
                } catch(e) { return null; }
            }
            return JSON.stringify({ position: v(pPos, true), scale: v(pScale), scaleWidth: v(pScaleW), cropLeft: v(pCropL), cropTop: v(pCropT), cropRight: v(pCropR), cropBottom: v(pCropB) });
        } catch(e) { return "ERR: " + e.message; }
    },

    /**
     * probeRange (DIAGNÒSTIC 2026-09-02): Per confirmar el límit REAL que el motor
     * NewWorld imposa a la Position del clip sota el CTI. Escriu temporalment
     * diverses posicions X (en px), llegeix què accepta el motor i restaura el
     * valor original. Resultat: "seqW=608 | 600->600 | ... | 960->960"
     * Si el motor clampea o descarta, ho veurem al "->".
     */
    probeRange: function() {
        try {
            var seq = (FASTPASS.Context) ? FASTPASS.Context.getWorkSequence() : app.project.activeSequence;
            if (!seq) return "ERR_NO_SEQ";
            var cti = seq.getPlayerPosition();
            if (!cti) return "ERR_NO_CTI";
            var info = FASTPASS.Clips.at(1, cti.seconds, "video");
            if (!info || info === "null") return "ERR_NO_CLIP";
            var idx = JSON.parse(info).index;
            var clip = seq.videoTracks[0].clips[idx];
            if (!clip) return "ERR_NO_CLIP2";
            var mp = this._getMotionProps(clip);
            if (!mp || !mp.pos) return "ERR_NO_MOTION";
            var pPos = mp.pos;
            var seqW = seq.frameSizeHorizontal || 0;
            if (!seqW) return "ERR_NO_SEQW";

            var original = null;
            try { original = pPos.getValue(); } catch(eO) {}
            var origY = (original && original.length >= 2) ? parseFloat(original[1]) : 0.5;
            if (isNaN(origY)) origY = 0.5;

            // Només cal veure a partir de 920 (fins aquí el motor accepta bé)
            var targets = [920, 930, 940, 950, 960];
            var out = ["seqW=" + seqW];
            for (var i = 0; i < targets.length; i++) {
                var px = targets[i];
                var norm = px / seqW;
                var llegit = "ERR";
                try {
                    pPos.setValue([norm, origY], true);
                    var r = pPos.getValue();
                    if (r && r.length >= 1) {
                        var rx = parseFloat(r[0]);
                        if (!isNaN(rx)) llegit = String(Math.round(rx * seqW));
                    }
                } catch(eW) {
                    llegit = "THROW:" + eW.message;
                }
                out.push(px + "->" + llegit);
            }
            if (original) {
                try { pPos.setValue(original, true); } catch(eR) {}
            }
            return out.join(" | ");
        } catch(e) { return "ERR: " + e.message; }
    }
};
