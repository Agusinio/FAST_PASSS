// ============================================================================
// 19_Diagnosi.jsx (MÓDULO DE INSPECCIÓN REFACTORIZADO)
// ============================================================================

var FASTPASS = FASTPASS || {};

FASTPASS.Diagnosi = (function() {

    return {
        runFullReport: function() {
            try {
                var seq = FASTPASS.Entorn.getWorkSequence();
                if (!seq) return "DIAG: No hay secuencia activa.";
                
                var trackV1 = seq.videoTracks[0];
                var time = seq.getPlayerPosition();
                var clip = null;
                
                for (var i = 0; i < trackV1.clips.numItems; i++) {
                    var c = trackV1.clips[i];
                    if (c.start.seconds <= time.seconds && c.end.seconds > time.seconds) {
                        clip = c;
                        break;
                    }
                }

                if (!clip) return "DIAG: No hay clip en V1 bajo el cabezal.";

                var report = "📊 INFORME TÉCNICO V1: " + clip.name + "\n";
                report += "-----------------------------------------\n";
                
                var motion = null;
                for (var j = 0; j < clip.components.numItems; j++) {
                    if (clip.components[j].matchName === "AE.ADBE Motion") {
                        motion = clip.components[j];
                        break;
                    }
                }

                if (motion) {
                    var posProp = motion.properties[0];
                    var kfs = posProp.getKeys();
                    report += "💎 Keyframes en Posición: " + (kfs ? kfs.length : 0) + "\n";
                    report += "⏱️ Reloj: " + (posProp.isTimeVarying() ? "ACTIVADO" : "DESACTIVADO") + "\n";
                }

                return report;
            } catch(e) { return "EXC_DIAG: " + e.toString(); }
        }
    };
})();

$.global.jsx_getKFDiagnostic = function() { 
    return FASTPASS.Diagnosi.runFullReport(); 
};