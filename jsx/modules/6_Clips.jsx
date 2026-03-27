/* * =================================================================================
 * 6_Clips.jsx
 * Módulo especializado en la manipulación física de objetos Clip en el Timeline.
 * (v17 - RECONSTRUCCIÓN LÍNEA A LÍNEA - SIN REGEX)
 * =================================================================================
 */

if (typeof $.global.FASTPASS === "undefined") { $.global.FASTPASS = {}; }
var FASTPASS = $.global.FASTPASS;

FASTPASS.Clips = {

    /**
     * Helper: Obtiene la pista de forma segura.
     * REGLA: Recibe índice base 1 (V1 = 1) y entrega objeto Premiere (base 0).
     */
    _getTrack: function(idx, type) {
        try {
            var seq = app.project.activeSequence;
            if (!seq && app.project.sequences.numSequences > 0) seq = app.project.sequences[0];
            if (!seq) return null;

            // ÚNICA RESTA: Aquí convertimos el 1 de la UI al 0 de Premiere
            var i = parseInt(idx) - 1; 
            if (i < 0) i = 0;

            var tracks;
            if (type === "audio") tracks = seq.audioTracks;
            else if (type === "subtitle") tracks = seq.subtitleTracks;
            else tracks = seq.videoTracks;

            if (!tracks || i >= tracks.numTracks) return null;
            return tracks[i];
        } catch(e) { return null; }
    },

    getCount: function(trackIdx, type) {
        try {
            var track = this._getTrack(trackIdx, type);
            return (track && track.clips) ? track.clips.numItems : 0;
        } catch(e) { return 0; }
    },

    getDataByIndex: function(trackIdx, clipIdx, type) {
        try {
            var track = this._getTrack(trackIdx, type);
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

    getDataByTime: function(trackIdx, timeSec, type) {
        try {
            var track = this._getTrack(trackIdx, type || "video");
            if (!track || !track.clips) return "null";

            var targetTime = (timeSec === -1) ? app.project.activeSequence.getPlayerPosition().seconds : parseFloat(timeSec);
            
            for (var i = 0; i < track.clips.numItems; i++) {
                var clip = track.clips[i];
                if (clip.start.seconds <= targetTime && clip.end.seconds > targetTime) {
                    return this.getDataByIndex(trackIdx, i, type);
                }
            }
            return "null";
        } catch(e) { return "null"; }
    },

    remove: function(trackIdx, clipIdx, type) {
        try {
            var track = this._getTrack(trackIdx, type);
            var clip = track.clips[clipIdx];
            if (clip) {
                clip.remove(true, true);
                return "OK";
            }
            return "ERR_NO_CLIP";
        } catch(e) { return "EXC: " + e.message; }
    },

    overwrite: function(itemName, trackIdx, timeSec, type) {
        try {
            if (!app.project) return "ERR_NO_PROJECT";
            var nameToFind = decodeURIComponent(itemName);
            var item = FASTPASS.Project.findItem(nameToFind);
            
            // Si no lo encuentra, buscamos quitando la extensión manualmente (Sin Regex)
            if (!item) {
                var lastDot = nameToFind.lastIndexOf(".");
                if (lastDot > 0) {
                    var nameOnly = nameToFind.substring(0, lastDot);
                    item = FASTPASS.Project.findItem(nameOnly);
                }
            }

            if (!item) return "ERR_ITEM_NOT_FOUND";

            var track = this._getTrack(trackIdx, type || "video"); 
            if (!track) return "ERR_TRACK_NOT_FOUND";

            var tStart = new Time();
            tStart.seconds = parseFloat(timeSec);
            track.overwriteClip(item, tStart);
            return "OK";
        } catch (e) { return "ERR: " + e.message; }
    },

    /**
     * Mueve la posición (In-point en el timeline) de un clip.
     * @param {number} trackIdx - Índice de la pista.
     * @param {number} clipIdx - Índice del clip en la pista.
     * @param {number} seconds - Tiempo en segundos donde se quiere colocar.
     * @param {string} type - "video", "audio" o "subtitle".
     */
    setStart: function(trackIdx, clipIdx, seconds, type) {
        try {
            var track = this._getTrack(trackIdx, type || "video");
            if (!track || !track.clips) return "ERR:TRACK_NOT_FOUND";

            var clip = track.clips[clipIdx];
            if (!clip) return "ERR:CLIP_NOT_FOUND";

            var t = new Time(); 
            t.seconds = parseFloat(seconds);
            clip.start = t;
            return "OK";
        } catch (e) { return "ERR:" + e.message; }
    },

    setEnd: function(trackIdx, clipIdx, seconds, type) {
        try {
            var track = this._getTrack(trackIdx, type || "video");
            var clip = track.clips[clipIdx];
            var t = new Time(); t.seconds = parseFloat(seconds);
            clip.end = t;
            return "OK";
        } catch (e) { return "ERR: " + e.message; }
    },

    setInPoint: function(trackIdx, clipIdx, seconds, type) {
        try {
            var track = this._getTrack(trackIdx, type || "video");
            if (!track || !track.clips) return "ERR:TRACK_NOT_FOUND";
            
            var clip = track.clips[clipIdx];
            if (!clip) return "ERR:CLIP_NOT_FOUND";
            
            var t = new Time(); 
            t.seconds = parseFloat(seconds);
            clip.inPoint = t;
            return "OK";
        } catch (e) { return "ERR:" + e.message; }
    },

    getProperty: function(trackIdx, clipIdx, compMatch, propMatch, type) {
        try {
            var track = this._getTrack(trackIdx, type || "video");
            var clip = track.clips[clipIdx];
            if (!clip) return null;
            return clip.components.getComponentByMatchName(compMatch).properties.getPropertyByMatchName(propMatch);
        } catch(e) { return null; }
    },

    setProperty: function(trackIdx, clipIdx, compMatch, propMatch, val, type) {
        try {
            var prop = this.getProperty(trackIdx, clipIdx, compMatch, propMatch, type || "video");
            if (!prop) return "ERR_PROP";
            if (propMatch == "ADBE Video Position") {
                prop.setValue(val, true);
            } else {
                prop.setValue(parseFloat(val), true);
            }
            return "OK";
        } catch (e) { return "ERR: " + e.message; }
    },

    detectScenes: function(trackIdx) {
        try {
            var track = this._getTrack(trackIdx, "video");
            if (!track || track.clips.numItems == 0) return "ERR_EMPTY_TRACK";
            for (var i = 0; i < track.clips.numItems; i++) {
                track.clips[i].setSelected(true, true);
            }
            app.project.activeSequence.performSceneEditDetectionOnSelection();
            return "OK";
        } catch (e) { return "ERR: " + e.message; }
    },

    getSelectedSubtitleClips: function() {
        try {
            var seq = app.project.activeSequence;
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