/* * =================================================================================
 * 6_Clips.jsx
 * Módulo especializado en la manipulación física de objetos Clip en el Timeline.
 * (v18 - RECONSTRUCCIÓN LITERAL - DRY)
 * =================================================================================
 */

if (typeof $.global.FASTPASS === "undefined") { $.global.FASTPASS = {}; }
var FASTPASS = $.global.FASTPASS;

FASTPASS.Clips = {

    /**
     * _get: Helper privat: Obté un objecte Track segons context ancorat.
     */
    _get: function(idx, type) {
        try {
            var seq = ($.global.FASTPASS && FASTPASS.Context) ? FASTPASS.Context.getWorkSequence() : app.project.activeSequence;
            if (!seq) return null;
            var i = parseInt(idx) - 1; 
            if (i < 0) i = 0;
            var tracks = (type === "audio") ? seq.audioTracks : (type === "subtitle" ? seq.subtitleTracks : seq.videoTracks);
            if (!tracks || i >= tracks.numTracks) return null;
            return tracks[i];
        } catch(e) { return null; }
    },

    /**
     * count: Compta clips en una pista.
     */
    count: function(trackIdx, type) {
        try {
            var track = this._get(trackIdx, type);
            return (track && track.clips) ? track.clips.numItems : 0;
        } catch(e) { return 0; }
    },

    /**
     * get: Obté data bàsica d'un clip per índex.
     */
    get: function(trackIdx, clipIdx, type) {
        try {
            var track = this._get(trackIdx, type);
            if (!track || !track.clips) return "null";
            var clip = track.clips[clipIdx];
            if (!clip) return "null";

            return JSON.stringify({
                index: clipIdx,
                name: clip.name,
                start: clip.start.seconds,
                end: clip.end.seconds,
                inPoint: clip.inPoint.seconds,
                outPoint: clip.outPoint.seconds,
                duration: clip.duration.seconds,
                selected: clip.isSelected()
            });
        } catch(e) { return "null"; }
    },

    /**
     * at: Troba i retorna dades d'un clip en un temps determinat.
     */
    at: function(trackIdx, timeSec, type) {
        try {
            var track = this._get(trackIdx, type || "video");
            if (!track || !track.clips) return "null";
            var targetTime = (timeSec === -1) ? (app.project.activeSequence.getPlayerPosition().seconds) : parseFloat(timeSec);
            
            for (var i = 0; i < track.clips.numItems; i++) {
                var clip = track.clips[i];
                if (clip.start.seconds <= targetTime && clip.end.seconds > targetTime) {
                    return this.get(trackIdx, i, type);
                }
            }
            return "null";
        } catch(e) { return "null"; }
    },

    /**
     * remove: Elimina un clip.
     */
    remove: function(trackIdx, clipIdx, type) {
        try {
            var track = this._get(trackIdx, type);
            var clip = track.clips[clipIdx];
            if (clip) {
                clip.remove(true, true);
                return "OK";
            }
            return "ERR_NO_CLIP";
        } catch(e) { return "EXC: " + e.message; }
    },

    /**
     * clearTrack: Elimina tots els clips d'una pista (escombrat invers).
     */
    clearTrack: function(trackIdx, type) {
        try {
            var track = this._get(trackIdx, type || "video");
            if (!track) return "ERR_TRACK_NOT_FOUND";
            
            var n = track.clips.numItems;
            for (var i = n - 1; i >= 0; i--) {
                track.clips[i].remove(true, true);
            }
            return "OK_CLEARED_" + n;
        } catch(e) { return "EXC: " + e.message; }
    },

    /**
     * insert: Insereix un element del Bin (Overwrite) amb durada opcional.
     */
    insert: function(itemName, trackIdx, startSec, endSec, type) {
        try {
            var p = app.project;
            var seq = p.activeSequence;
            if (!seq) return "ERR_NO_ACTIVE_SEQUENCE";
    
            var nameToFind = decodeURIComponent(itemName);
            var item = FASTPASS.Project.find(nameToFind);
            
            // Buscador de respaldo sin extensión
            if (!item) {
                var lastDot = nameToFind.lastIndexOf(".");
                if (lastDot > 0) {
                    item = FASTPASS.Project.find(nameToFind.substring(0, lastDot));
                }
            }
            if (!item) return "ERR_ITEM_NOT_FOUND";
    
            // 1. Localizar la pista (Video o Audio)
            var targetTrack = null;
            var isVideo = (type !== "audio"); // Por defecto video
            
            if (isVideo) {
                targetTrack = seq.videoTracks[parseInt(trackIdx) - 1];
            } else {
                targetTrack = seq.audioTracks[parseInt(trackIdx) - 1];
            }
    
            if (!targetTrack) return "ERR_TRACK_NOT_FOUND";
    
            // 2. Configurar el tiempo de inserción
            var tStart = new Time();
            tStart.seconds = parseFloat(startSec || 0);
    
            // 3. LA LLAMADA REAL A PREMIERE (overwriteClip)
            // Esto es lo que faltaba. Usamos overwrite para no desplazar el resto
            targetTrack.overwriteClip(item, tStart);
    
            // 4. Ajustar duración si se especifica endSec
            if (endSec && parseFloat(endSec) > 0) {
                var clips = targetTrack.clips;
                var lastClip = clips[clips.numItems - 1];
                var tEnd = new Time(); 
                tEnd.seconds = parseFloat(endSec);
                lastClip.end = tEnd;
            }
    
            return "OK";
        } catch (e) { 
            return "ERR: " + e.message; 
        }
    },

    /**
     * start: Canvia el temps d'inici (posició) d'un clip.
     */
    start: function(trackIdx, clipIdx, seconds, type) {
        try {
            var track = this._get(trackIdx, type || "video");
            var clip = track.clips[clipIdx];
            var t = new Time(); 
            t.seconds = parseFloat(seconds);
            clip.start = t;
            return "OK";
        } catch ( e ) { return "ERR:" + e.message; }
    },

    /**
     * end: Canvia el temps final d'un clip.
     */
    end: function(trackIdx, clipIdx, seconds, type) {
        try {
            var track = this._get(trackIdx, type || "video");
            var clip = track.clips[clipIdx];
            var t = new Time(); t.seconds = parseFloat(seconds);
            clip.end = t;
            return "OK";
        } catch ( e ) { return "ERR: " + e.message; }
    },

    /**
     * inPoint: Canvia el punt d'entrada (inPoint) d'un clip.
     */
    inPoint: function(trackIdx, clipIdx, seconds, type) {
        try {
            var track = this._get(trackIdx, type || "video");
            var clip = track.clips[clipIdx];
            var t = new Time(); 
            t.seconds = parseFloat(seconds);
            clip.inPoint = t;
            return "OK";
        } catch ( e ) { return "ERR:" + e.message; }
    },

    /**
     * getProp: Obté el valor d'una propietat d'un clip.
     */
    getProp: function(trackIdx, clipIdx, compMatch, propMatch, type) {
        try {
            var track = this._get(trackIdx, type || "video");
            var clip = track.clips[clipIdx];
            if (!clip) return null;
            
            var comp = clip.components.getComponentByMatchName(compMatch);
            if (!comp) return null;
            var prop = comp.properties.getPropertyByMatchName(propMatch);
            return prop;
        } catch(e) { return null; }
    },

    /**
     * setProp: Estableix el valor d'una propietat d'un clip.
     */
    setProp: function(trackIdx, clipIdx, compMatch, propMatch, val, type) {
        try {
            var track = this._get(trackIdx, type || "video");
            var clip = track.clips[clipIdx];
            if (!clip) return "ERR_CLIP";
            var comp = clip.components.getComponentByMatchName(compMatch);
            var prop = comp.properties.getPropertyByMatchName(propMatch);
            if (!prop) return "ERR_PROP";
            
            if (propMatch == "ADBE Video Position") {
                prop.setValue(val, true);
            } else {
                prop.setValue(parseFloat(val), true);
            }
            return "OK";
        } catch (e) { return "ERR: " + e.message; }
    },

    /**
     * scenes: Executa el Scene Edit Detection.
     */
    scenes: function(trackIdx) {
        try {
            var track = this._get(trackIdx, "video");
            if (!track || track.clips.numItems == 0) return "ERR_EMPTY_TRACK";
            for (var i = 0; i < track.clips.numItems; i++) {
                track.clips[i].setSelected(true, true);
            }
            app.project.activeSequence.performSceneEditDetectionOnSelection();
            return "OK";
        } catch (e) { return "ERR: " + e.message; }
    },

    /**
     * getSubtitles: Busca clips de subtítols seleccionats.
     */
    getSubtitles: function() {
        try {
            var seq = ($.global.FASTPASS && FASTPASS.Context) ? FASTPASS.Context.getWorkSequence() : app.project.activeSequence;
            if (!seq) return "[]";
            var results = [];
            for (var t = 0; t < seq.subtitleTracks.numItems; t++) {
                var track = seq.subtitleTracks[t];
                for (var i = 0; i < track.clips.numItems; i++) {
                    var c = track.clips[i];
                    if (c.isSelected()) {
                        results.push({
                            trackIndex: t,
                            clipIndex: i,
                            name: c.name,
                            start: c.start.seconds,
                            end: c.end.seconds,
                            duration: c.duration.seconds
                        });
                    }
                }
            }
            return JSON.stringify(results);
        } catch(e) { return "[]"; }
    }
};