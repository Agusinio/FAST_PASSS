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
        getClipInfoUnderCTI: function(trackIdx, optionalTime) {
            var seq = app.project.activeSequence;
            if (!seq) return { found: false };
            var track = seq.videoTracks[trackIdx];
            var timeToCheck = (optionalTime !== undefined) ? optionalTime : seq.getPlayerPosition().seconds;
            
            for (var i = 0; i < track.clips.numItems; i++) {
                var c = track.clips[i];
                if (c.start.seconds <= timeToCheck && c.end.seconds > timeToCheck) {
                    return { found: true, index: i, start: c.start.seconds, end: c.end.seconds, name: c.name, obj: c };
                }
            }
            return { found: false };
        }
    };
})();