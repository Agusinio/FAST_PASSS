/**
 * =================================================================================
 * 32_Segments.jsx
 * Módulo especializado en la manipulación física de objetos Clip en el Timeline.
 * =================================================================================
 */

if (typeof $.global.FASTPASS === "undefined") { $.global.FASTPASS = {}; }
var FASTPASS = $.global.FASTPASS;

FASTPASS.Segments = {

    /**
     * _get: Obtiene la pista física (Video o Audio) de Premiere.
     */
    _get: function(idx, type) {
        try {
            var i = parseInt(idx || 1) - 1;
            var seq = FASTPASS.Entorn.getWorkSequence();
            
            if (!seq) { 
                $.writeln("🚨 [JSX:Segments] ERROR: getWorkSequence devolvió NULL"); 
                return null; 
            }

            var tracks = (type === "audio") ? seq.audioTracks : seq.videoTracks;
            
            if (!tracks) {
                $.writeln("🚨 [JSX:Segments] ERROR: El objeto 'tracks' es NULL para tipo: " + type);
                return null;
            }

            if (i < 0 || i >= tracks.numTracks) {
                $.writeln("🚨 [JSX:Segments] ERROR: Índice de pista fuera de rango. Pedido: " + idx + " | Máximo: " + tracks.numTracks);
                return null;
            }

            return tracks[i];
        } catch(e) { 
            $.writeln("💥 [JSX:Segments] CRASH en _get: " + e.message); 
            return null; 
        }
    },

    /**
     * get: Obtiene los datos de un clip específico y los devuelve como JSON string.
     * ESTA ES LA QUE FALTABA Y CAUSABA EL ERROR.
     */
    get: function(trackIdx, clipIdx, type) {
        try {
            var track = FASTPASS.Segments._get(trackIdx, type);
            if (!track || !track.clips) return "null";
            
            var clip = track.clips[clipIdx];
            // 🛡️ VALIDACIÓN 1: ¿Existe el clip?
            if (!clip) return "null";

            // 🛡️ VALIDACIÓN 2: ¿Los objetos de tiempo son válidos?
            // Si Premiere está ocupado, .start o .end pueden devolver null momentáneamente
            if (!clip.start || !clip.end || !clip.inPoint) {
                $.writeln("⚠️ [JSX:Segments] Propiedades de tiempo no disponibles en este frame.");
                return "null";
            }
    
            // 🛡️ VALIDACIÓN 3: Construcción segura del JSON
            return JSON.stringify({
                index: parseInt(clipIdx),
                name: String(clip.name),
                start: parseFloat(clip.start.seconds || 0),
                end: parseFloat(clip.end.seconds || 0),
                inPoint: parseFloat(clip.inPoint.seconds || 0),
                outPoint: parseFloat(clip.outPoint.seconds || 0),
                duration: parseFloat(clip.duration.seconds || 0)
            });
        } catch(e) { 
            $.writeln("💥 [JSX:Segments] CRASH en get: " + e.message);
            return "null"; 
        }
    },

    at: function(trackIdx, timeSec, type) {
        try {
            var seq = FASTPASS.Entorn.getWorkSequence();
            if (!seq) return "null";
    
            // 🛡️ Forzamos que trackIdx sea un número válido
            var tIdx = parseInt(trackIdx);
            if (isNaN(tIdx) || tIdx < 1) return "null";
    
            var track = FASTPASS.Segments._get(tIdx, type || "video");
            
            // 🚨 AQUÍ ESTÁ EL FIX: Si la pista no existe, no intentamos leer .clips
            if (!track || typeof track.clips === "undefined" || track.clips === null) {
                return "null";
            }
    
            var targetTime = (timeSec === -1) ? seq.getPlayerPosition().seconds : parseFloat(timeSec);
    
            // Si la pista existe pero está vacía
            if (track.clips.numItems === 0) return "null";
    
            for (var i = 0; i < track.clips.numItems; i++) {
                var clip = track.clips[i];
                if (clip && clip.start.seconds <= targetTime && clip.end.seconds > targetTime) {
                    return FASTPASS.Segments.get(tIdx, i, type);
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
        $.writeln("✂️ [JSX:Segments] Iniciando inPoint...");
        $.writeln("   > TrackIdx: " + t + " | ClipIdx: " + i + " | Time: " + v);
        
        try {
            var track = this._get(t, ty);
            if (!track) {
                $.writeln("🚨 [JSX:Segments] ERROR: Pista no encontrada");
                return "ERR_TRACK_NOT_FOUND";
            }
    
            var clip = track.clips[i];
            if (!clip) {
                $.writeln("🚨 [JSX:Segments] ERROR: No existe el clip con índice " + i + " en la pista " + t);
                return "ERR_CLIP_NOT_FOUND";
            }
    
            $.writeln("✅ [JSX:Segments] Clip localizado: " + clip.name);
            $.writeln("   > Start actual: " + clip.start.seconds);
    
            // 🔗 Aquí usamos la factoría segura que arreglamos
            var tObj = FASTPASS.Cronologia.makeTime(v); 
            
            $.writeln("⏳ [JSX:Segments] Aplicando nuevo InPoint: " + v);
            clip.inPoint = tObj; 
            
            $.writeln("🎉 [JSX:Segments] Operación completada con éxito");
            return "OK";
    
        } catch(e) { 
            $.writeln("💥 [JSX:Segments] CRASH en inPoint: " + e.message);
            return "ERR:" + e.message; 
        }
    },

    outPoint: function(t, i, v, ty) {
        try {
            var track = this._get(t, ty);
            if (track && track.clips[i]) { 
                // ✅ Cambio a factoría segura
                track.clips[i].outPoint = FASTPASS.Cronologia.makeTime(v); 
                return "OK"; 
            }
            return "ERR_NO_CLIP";
        } catch(e) { return "ERR:" + e.message; }
    },

    start: function(t, i, v, ty) {
        try {
            var track = this._get(t, ty);
            if (track && track.clips[i]) { 
                // ✅ Cambio a factoría segura
                track.clips[i].start = FASTPASS.Cronologia.makeTime(v); 
                return "OK"; 
            }
            return "ERR_NO_CLIP";
        } catch(e) { return "ERR:" + e.message; }
    },

    end: function(t, i, v, ty) {
        try {
            var track = this._get(t, ty);
            if (track && track.clips[i]) { 
                // ✅ Cambio a factoría segura
                track.clips[i].end = FASTPASS.Cronologia.makeTime(v); 
                return "OK"; 
            }
            return "ERR_NO_CLIP";
        } catch(e) { return "ERR:" + e.message; }
    }
};