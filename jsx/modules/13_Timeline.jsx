/* 4_Timeline.jsx - SÓLO UTILIDADES COMPARTIDAS */

var FASTPASS = FASTPASS || {};
FASTPASS.Timeline = (function() {

    // --- HELPERS INTERNOS DE BAJO NIVEL ---
    // (Utilizados por los módulos especializados para no repetir código)

    function _getClipAtTime(track, time) {
        if (!track || !time) return null;
        for (var i = 0; i < track.clips.numItems; i++) {
            var clip = track.clips[i];
            if (clip.start.seconds <= time.seconds && clip.end.seconds > time.seconds) return clip;
        }
        return null;
    }

    function _sec(s) { 
        var t = new Time(); 
        t.seconds = parseFloat(s); 
        return t; 
    }

    return {
        // Hacemos públicos los helpers para que Sequences, Clips y KF puedan usarlos
        _getClipAtTime: _getClipAtTime,
        _sec: _sec,

        /**
         * getClipInfoUnderCTI: Utility compartida para Clips y Tracks
         */
        getClipInfoUnderCTI: function(trackIdx, type, optionalTime) {
            var seq = app.project.activeSequence;
            if (!seq) return { found: false };
            
            // Base 1 to Base 0 conversion
            var i = parseInt(trackIdx) - 1;
            if (i < 0) i = 0;
            
            var track;
            if (type === "audio") track = seq.audioTracks[i];
            else if (type === "subtitle") track = seq.subtitleTracks[i];
            else track = seq.videoTracks[i];
            
            if (!track || !track.clips) return { found: false };
            
            var timeToCheck = (optionalTime !== undefined) ? parseFloat(optionalTime) : seq.getPlayerPosition().seconds;
            
            for (var j = 0; j < track.clips.numItems; j++) {
                var c = track.clips[j];
                if (c.start.seconds <= timeToCheck && c.end.seconds > timeToCheck) {
                    return { found: true, index: j, start: c.start.seconds, end: c.end.seconds, name: c.name, obj: c };
                }
            }
            return { found: false };
        }
    };
})();