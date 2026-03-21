/* * =================================================================================
 * 8_Graphics.jsx
 * Módulo especializado en la gestión de exportación y grafismo.
 * (v12 - VERSIÓN LIPO: SOPORTE DE BÚSQUEDA Y COLOCACIÓN)
 * =================================================================================
 */

var FASTPASS = FASTPASS || {};
FASTPASS.Graphics = {

    /**
     * Captura el frame actual de la seqüència.
     */
    exportFrame: function(path) {
        try {
            var seq = app.project.activeSequence;
            if (!seq) return "ERR_NO_SEQ";
            var f = new File(path);
            if (!f.parent.exists) f.parent.create();
            var res = seq.exportFrame(seq.getPlayerPosition(), f.fsName);
            return res ? "OK" : "ERR_API";
        } catch(e) { return "EXC_EXPORT: " + e.message; }
    },

    /**
     * Busca el chyron principal (el más grande) en el Bin CHYRONS.
     */
    findLargeChyronVerbose: function() {
        try {
            var proj = app.project;
            var bin = null;
            for (var i = 0; i < proj.rootItem.children.numItems; i++) {
                if (proj.rootItem.children[i].name === "CHYRONS") { bin = proj.rootItem.children[i]; break; }
            }
            if (!bin) return "❌ No s'ha trobat el Bin CHYRONS";

            var maxItem = null;
            var maxSize = 0;
            for (var j = 0; j < bin.children.numItems; j++) {
                var item = bin.children[j];
                if (item.type === 1) { // Clip
                    var f = new File(item.getMediaPath());
                    if (f.exists && f.length > maxSize) {
                        maxSize = f.length;
                        maxItem = item;
                    }
                }
            }
            if (maxItem) return "✅ Trobat: " + maxItem.name + " (" + (maxSize/1048576).toFixed(1) + " MB)";
            return "⚠️ Bin buit o sense clips vàlids";
        } catch(e) { return "ERR_SCAN: " + e.message; }
    },

    /**
     * Coloca el chyron principal al timeline.
     */
    placeStoredChyron: function(trackIdx, tS, tE) {
        try {
            // Re-escaneo rápido para encontrar el item (Atomismo: no guardamos estado en JSX si es posible)
            var proj = app.project;
            var res = this.findLargeChyronVerbose();
            if (res.indexOf("✅") === -1) return "ERR_NOT_FOUND";
            
            var name = res.split(": ")[1].split(" (")[0];
            var item = FASTPASS.Project.findItem(name);
            if (!item) return "ERR_ITEM_LOST";

            var seq = proj.activeSequence;
            var track = seq.videoTracks[trackIdx];
            var timeStart = new Time(); timeStart.seconds = parseFloat(tS);
            
            track.overwriteClip(item, timeStart);
            
            // Ajustar duración (vía Clip final de pista ya que overwrite lo pone al final)
            var clip = track.clips[track.clips.numItems - 1];
            var timeEnd = new Time(); timeEnd.seconds = parseFloat(tE);
            clip.end = timeEnd;
            
            return "OK_PLACED";
        } catch(e) { return "ERR_PLACE: " + e.message; }
    }
};