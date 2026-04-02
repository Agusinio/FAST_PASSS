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
            var seq = (FASTPASS.Entorn) ? FASTPASS.Entorn.getWorkSequence() : app.project.activeSequence;
            if (!seq) return null;
            var i = parseInt(idx) - 1; 
            var tracks = (type === "audio") ? seq.audioTracks : (type === "subtitle" ? seq.subtitleTracks : seq.videoTracks);
            if (!tracks || i >= tracks.numTracks) return null;
            return tracks[i];
        } catch(e) { return null; }
    },

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
                duration: clip.duration.seconds
            });
        } catch(e) { return "null"; }
    },

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
            var seq = app.project.activeSequence;
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

    inPoint: function(t, i, v, ty) {
        try {
            var track = this._get(t, ty);
            if (track && track.clips[i]) { track.clips[i].inPoint = parseFloat(v); return "OK"; }
            return "ERR";
        } catch(e) { return "ERR:" + e.message; }
    },

    outPoint: function(t, i, v, ty) {
        try {
            var track = this._get(t, ty);
            if (track && track.clips[i]) { track.clips[i].outPoint = parseFloat(v); return "OK"; }
            return "ERR";
        } catch(e) { return "ERR:" + e.message; }
    },

    start: function(t, i, v, ty) {
        try {
            var track = this._get(t, ty);
            if (track && track.clips[i]) { track.clips[i].start = parseFloat(v); return "OK"; }
            return "ERR";
        } catch(e) { return "ERR:" + e.message; }
    },

    end: function(t, i, v, ty) {
        try {
            var track = this._get(t, ty);
            if (track && track.clips[i]) { track.clips[i].end = parseFloat(v); return "OK"; }
            return "ERR";
        } catch(e) { return "ERR:" + e.message; }
    }
};