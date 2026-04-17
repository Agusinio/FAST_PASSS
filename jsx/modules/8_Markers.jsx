/**
 * =================================================================================
 * 8_Markers.jsx
 * Gestió de marcadors de seqüència (v1.0)
 * =================================================================================
 */

if (typeof $.global.FASTPASS === "undefined") { $.global.FASTPASS = {}; }
var FASTPASS = $.global.FASTPASS;

FASTPASS.Markers = (function() {
    
    function _seq() {
        return app.project.activeSequence;
    }

    return {
        /**
         * get: Obté tots els marcadors de la seqüència activa.
         * @returns {string} JSON array de {time, name, comments}
         */
        get: function() {
            try {
                var s = _seq();
                if (!s) return "[]";
                var m = s.markers;
                var res = [];
                var current = m.getFirstMarker();
                while (current) {
                    res.push({
                        time: current.start.seconds,
                        name: current.name,
                        comments: current.comments
                    });
                    current = m.getNextMarker(current);
                }
                return JSON.stringify(res);
            } catch(e) { return "[]"; }
        },

        /**
         * set: Afegeix un marcador a la seqüència.
         */
        set: function(time, comment, name) {
            try {
                var s = _seq();
                if (!s) return "ERR:NO_SEQ";
                var m = s.markers.createMarker(time);
                m.name = name || "Línia Escaleta";
                m.comments = comment || "";
                return "OK";
            } catch(e) { return "ERR:" + e.message; }
        },

        /**
         * clear: Elimina tots els marcadors.
         */
        clear: function() {
            try {
                var s = _seq();
                if (!s) return "ERR:NO_SEQ";
                var m = s.markers;
                var current = m.getFirstMarker();
                while (current) {
                    m.deleteMarker(current);
                    current = m.getFirstMarker();
                }
                return "OK";
            } catch(e) { return "ERR:" + e.message; }
        }
    };
})();
