/**
 * =================================================================================
 * 32_Segments.jsx
 * Módulo especializado en la manipulación física de objetos Clip en el Timeline.
 * =================================================================================
 */

if (typeof $.global.FASTPASS === "undefined") { $.global.FASTPASS = {}; }
var FASTPASS = $.global.FASTPASS;

FASTPASS.Segments = {

    _get: function(idx, type) {
        try {
            var i = parseInt(idx || 1) - 1;
            $.writeln("🧪 [JSX:Segments] _get -> Index: " + idx + " (calc:" + i + ") | Tipus: " + type);

            var seq = FASTPASS.Entorn.getWorkSequence();
            
            if (!seq) { $.writeln("❌ [JSX:Segments] _get: No hi ha seqüència!"); return null; }

            var tracks = (type === "audio") ? seq.audioTracks : seq.videoTracks;
            if (!tracks || i >= tracks.numTracks) {
                $.writeln("❌ [JSX:Segments] _get: Pista " + idx + " no existeix.");
                return null;
            }

            $.writeln("✅ [JSX:Segments] _get: Pista trobada.");
            return tracks[i];
        } catch(e) { $.writeln("💥 [JSX:Segments] _get CRASH: " + e.message); return null; }
    },

    get: function(trackIdx, clipIdx, type) {
        try {
            var track = FASTPASS.Segments._get(trackIdx, type);
            // 📍 BLINDAJE EXTRA:
            if (!track || typeof track.clips === "undefined" || track.clips === null) return "null";
            
            var clip = track.clips[clipIdx];
            if (!clip) return "null";
    
            return JSON.stringify({
                index: clipIdx,
                name: clip.name,
                start: clip.start.seconds,
                end: clip.end.seconds,
                inPoint: clip.inPoint.seconds,
                outPoint: clip.outPoint.seconds,
                duration: clip.duration.seconds
            });
        } catch(e) { return "null"; }
    },

    at: function(trackIdx, timeSec, type) {
        //alert("¡Nivel 2: Premiere ha recibido la orden de buscar el clip!");
        try {
            var seq = FASTPASS.Entorn.getWorkSequence(); // Obtenim la seqüència
            if (!seq) return "null"; // Si no n'hi ha, sortim sense petar
    
            var track = FASTPASS.Segments._get(trackIdx, type || "video");
            if (!track || !track.clips) return "null";
    
            // 📍 Usemp la seq que hem validat a la línia anterior
            var targetTime = (timeSec === -1) 
                ? (seq.getPlayerPosition().seconds) 
                : parseFloat(timeSec);
            
            for (var i = 0; i < track.clips.numItems; i++) {
                var clip = track.clips[i];
                if (clip && clip.start.seconds <= targetTime && clip.end.seconds > targetTime) {
                    return FASTPASS.Segments.get(trackIdx, i, type);
                }
            }
            return "null";
        } catch(e) { return "null"; }
    },

    remove: function(trackIdx, clipIdx, type) {
        try {
            var track = this._get(trackIdx, type);
            var clip = track.clips[clipIdx];
            if (clip) { clip.remove(true, true); return "OK"; }
            return "ERR";
        } catch(e) { return "ERR:" + e.message; }
    },

    insert: function(itemName, trackIdx, startSec, endSec, type) {
        try {
            var nameToFind = decodeURIComponent(itemName);
            var item = FASTPASS.Projecte.find(nameToFind);
            if (!item) return "ERR_NOT_FOUND";
            var seq = FASTPASS.Entorn.getWorkSequence();
            var targetTrack = (type === "audio") ? seq.audioTracks[parseInt(trackIdx)-1] : seq.videoTracks[parseInt(trackIdx)-1];
            if (!targetTrack) return "ERR_TRACK";
            var tStart = new Time(); tStart.seconds = parseFloat(startSec || 0);
            targetTrack.overwriteClip(item, tStart);
            return "OK";
        } catch (e) { return "ERR:" + e.message; }
    },

    getProp: function(trackIdx, clipIdx, compMatch, propMatch, type) {
        try {
            var track = this._get(trackIdx, type || "video");
            var clip = track.clips[clipIdx];
            if (!clip) return null;
            var comp = clip.components.getComponentByMatchName(compMatch);
            if (!comp) return null;
            return comp.properties.getPropertyByMatchName(propMatch);
        } catch(e) { return null; }
    },

    setProp: function(trackIdx, clipIdx, cm, pm, val, type) {
        try {
            var prop = this.getProp(trackIdx, clipIdx, cm, pm, type);
            if (!prop) return "ERR_PROP";
            if (pm === "ADBE Video Position") prop.setValue(val, true);
            else prop.setValue(parseFloat(val), true);
            return "OK";
        } catch (e) { return "ERR:" + e.message; }
    },

    count: function(trackIdx, type) {
        try {
            var track = this._get(trackIdx, type || "video");
            return (track && track.clips) ? track.clips.numItems : 0;
        } catch(e) { return 0; }
    },

    inPoint: function(t, i, v, ty) {
        try {
            var track = this._get(t, ty);
            if (track && track.clips[i]) { 
                // 🔗 Conexión quirúrgica con la fábrica de Cronologia
                track.clips[i].inPoint = FASTPASS.Cronologia.makeTime(v); 
                return "OK"; 
            }
            return "ERR_NO_CLIP";
        } catch(e) { return "ERR:" + e.message; }
    },

    outPoint: function(t, i, v, ty) {
        try {
            var track = this._get(t, ty);
            if (track && track.clips[i]) { 
                var tObj = new Time(); tObj.seconds = parseFloat(v);
                track.clips[i].outPoint = tObj; 
                return "OK"; 
            }
            return "ERR";
        } catch(e) { return "ERR:" + e.message; }
    },

    start: function(t, i, v, ty) {
        try {
            var track = this._get(t, ty);
            if (track && track.clips[i]) { 
                var tObj = new Time(); tObj.seconds = parseFloat(v);
                track.clips[i].start = tObj; 
                return "OK"; 
            }
            return "ERR";
        } catch(e) { return "ERR:" + e.message; }
    },

    end: function(t, i, v, ty) {
        try {
            var track = this._get(t, ty);
            if (track && track.clips[i]) { 
                var tObj = new Time(); tObj.seconds = parseFloat(v);
                track.clips[i].end = tObj; 
                return "OK"; 
            }
            return "ERR";
        } catch(e) { return "ERR:" + e.message; }
    }
};