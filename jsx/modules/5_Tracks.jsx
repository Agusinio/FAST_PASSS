/**
 * =================================================================================
 * 5_Tracks.jsx
 * Módulo especializado en la gestión física de Tracks (Pistas).
 * (v15 - REFACCIÓ LITERAL DRY)
 * =================================================================================
 */

if (typeof $.global.FASTPASS === "undefined") { $.global.FASTPASS = {}; }
var FASTPASS = $.global.FASTPASS;

FASTPASS.Tracks = {

    /**
     * _get: Helper privat per obtenir l'objecte track.
     */
    _get: function(idx, type) {
        var seq = ($.global.FASTPASS && FASTPASS.Context) ? FASTPASS.Context.getWorkSequence() : app.project.activeSequence;
        if (!seq) return null;
        
        var i = parseInt(idx) - 1; // Base 1 (JS) a Base 0 (Premiere)
        if (i < 0) i = 0;
        
        if (type === "audio") return seq.audioTracks[i];
        if (type === "subtitle") return seq.subtitleTracks[i];
        return seq.videoTracks[i];
    },

    /**
     * count: Retorna el nombre total de pistes d'un tipus.
     */
    count: function(type) {
        try {
            var seq = ($.global.FASTPASS && FASTPASS.Context) ? FASTPASS.Context.getWorkSequence() : app.project.activeSequence;
            if (!seq) return 0;
            if (type === "audio") return seq.audioTracks.numTracks;
            if (type === "subtitle") return seq.subtitleTracks.numTracks;
            return seq.videoTracks.numTracks;
        } catch(e) { return 0; }
    },

    /**
     * mute: Silencia o activa una pista.
     */
    mute: function(idx, state, type) {
        try {
            $.writeln("[Tracks.mute] idx=" + idx + " state=" + state + " type=" + type);
            var track = this._get(idx, type);
            if (track) {
                // setMute falla amb booleà via bridge. Usar propietat directa.
                track.mute = state;
                $.writeln("[Tracks.mute] OK via track.mute=" + state);
                return "OK";
            }
            return "ERR_NO_TRACK";
        } catch(e) { $.writeln("[Tracks.mute] EXC: " + e.message); return "EXC: " + e.message; }
    },

    /**
     * lock: Bloqueja o desbloqueja una pista.
     */
    lock: function(idx, state, type) {
        try {
            var track = this._get(idx, type);
            if (track) {
                track.setLocked(state);
                return "OK";
            }
            return "ERR_NO_TRACK";
        } catch(e) { return "EXC: " + e.message; }
    },

    /**
     * target: Activa o desactiva el targeting de la pista.
     */
    target: function(idx, state, type) {
        try {
            var track = this._get(idx, type);
            if (track) {
                track.setTargeted(state);
                return "OK";
            }
            return "ERR_NO_TRACK";
        } catch(e) { return "EXC: " + e.message; }
    },

    /**
     * ensure: Assegura que existeixi almenys `idx` pistes del tipus donat.
     * Si no n'hi ha prou, crea les que faltin.
     * @param {number} idx - Nombre mínim de pista (1-based)
     * @param {string} type - "video", "audio" o "subtitle"
     * @returns {string} "OK" o "ERR"
     */
    ensure: function(idx, type) {
        try {
            var seq = ($.global.FASTPASS && FASTPASS.Context) ? FASTPASS.Context.getWorkSequence() : app.project.activeSequence;
            if (!seq) return "ERR_NO_SEQ";
            type = type || "video";
            var tracks = (type === "audio") ? seq.audioTracks : (type === "subtitle") ? seq.subtitleTracks : seq.videoTracks;
            var needed = parseInt(idx);
            while (tracks.numTracks < needed) {
                tracks.addTrack();
            }
            return "OK";
        } catch(e) { return "ERR: " + e.message; }
    }
};