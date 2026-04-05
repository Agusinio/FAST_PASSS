/**
 * =================================================================================
 * 31_Pistes.jsx
 * Módulo especializado en la gestión física de Tracks (Pistas).
 * =================================================================================
 */

if (typeof $.global.FASTPASS === "undefined") { $.global.FASTPASS = {}; }
var FASTPASS = $.global.FASTPASS;

FASTPASS.Pistes = {

    _get: function(idx, type) {
        var seq = FASTPASS.Entorn.getWorkSequence();
        if (!seq) return null;
        var i = parseInt(idx) - 1; 
        if (i < 0) i = 0;
        if (type === "audio") return seq.audioTracks[i];
        if (type === "subtitle") return seq.subtitleTracks[i];
        return seq.videoTracks[i];
    },

    count: function(type) {
        try {
            var seq = FASTPASS.Entorn.getWorkSequence();
            if (!seq) return 0;
            if (type === "audio") return seq.audioTracks.numTracks;
            if (type === "subtitle") return seq.subtitleTracks.numTracks;
            return seq.videoTracks.numTracks;
        } catch(e) { return 0; }
    },

    mute: function(idx, state, type) {
        try {
            var track = this._get(idx, type);
            if (track) { track.setMute(state); return "OK"; }
            return "ERR";
        } catch(e) { return "ERR:" + e.message; }
    },

    lock: function(idx, state, type) {
        try {
            var track = this._get(idx, type);
            if (track) { track.setLocked(state); return "OK"; }
            return "ERR";
        } catch(e) { return "ERR:" + e.message; }
    },

    target: function(idx, state, type) {
        try {
            var track = this._get(idx, type);
            if (track) { track.setTargeted(state); return "OK"; }
            return "ERR";
        } catch(e) { return "ERR:" + e.message; }
    }
};