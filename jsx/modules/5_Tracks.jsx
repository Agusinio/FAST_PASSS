/* * =================================================================================
 * 5_Tracks.jsx
 * Módulo especializado en la gestión física de Tracks (Pistas).
 * (v14 - VERSIÓN ULTRA-ATÓMICA SIN BUCLES)
 * =================================================================================
 */

var FASTPASS = FASTPASS || {};
FASTPASS.Tracks = {

    /**
     * Helper privat: Obté l'objecte track segons el tipus.
     */
    _getTrackObj: function(idx, type) {
        var seq = app.project.activeSequence;
        if (!seq) return null;
        var i = parseInt(idx) - 1; // Convert Base 1 to Base 0
        if (i < 0) i = 0;
        if (type === "audio") return seq.audioTracks[i];
        if (type === "subtitle") return seq.subtitleTracks[i];
        return seq.videoTracks[i];
    },

    setMute: function(idx, m, type) {
        try {
            var track = this._getTrackObj(idx, type);
            if (track) {
                track.setMute(m);
                return "OK";
            }
            return "ERR_NO_TRACK_INDEX_" + idx;
        } catch(e) { return "EXC: " + e.message; }
    },

    setLock: function(idx, l, type) {
        try {
            var track = this._getTrackObj(idx, type);
            if (track) {
                track.setLocked(l);
                return "OK";
            }
            return "ERR_NO_TRACK";
        } catch(e) { return "EXC: " + e.message; }
    },

    setTarget: function(idx, t, type) {
        try {
            var track = this._getTrackObj(idx, type);
            if (track) {
                track.setTargeted(t);
                return "OK";
            }
            return "ERR_NO_TRACK";
        } catch(e) { return "EXC: " + e.message; }
    },

    getTrackCount: function(type) {
        try {
            var seq = app.project.activeSequence;
            if (!seq) return 0;
            if (type === "audio") return seq.audioTracks.numTracks;
            if (type === "subtitle") return seq.subtitleTracks.numTracks;
            return seq.videoTracks.numTracks;
        } catch(e) { return 0; }
    }
};